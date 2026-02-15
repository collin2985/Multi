/**
 * DatabaseManager.js
 * PostgreSQL connection manager with retry logic
 * Handles database connection pooling and schema initialization
 *
 * Mode Detection:
 * - DATABASE_URL set = Online mode (DB required, no JSON fallback)
 * - DATABASE_URL not set = Local mode (JSON only, no DB)
 */

const { Pool } = require('pg');

class DatabaseManager {
    constructor() {
        this.pool = null;
        this.isConnected = false;
        // Online mode = DATABASE_URL is set AND LOCAL_MODE is not true
        // LOCAL_MODE=true in .env allows keeping DATABASE_URL for reference while running locally
        this.isOnlineMode = !!process.env.DATABASE_URL && process.env.LOCAL_MODE !== 'true';
    }

    /**
     * Connect with retry logic for online mode
     * Retries with exponential backoff: 5s, 10s, 20s, 30s, 30s, 30s (~2 min total)
     * @throws {Error} If all retries fail
     */
    async connectWithRetry() {
        const retryDelays = [0, 5000, 10000, 20000, 30000, 30000, 30000]; // ~2 minutes total
        let lastError;

        for (let attempt = 0; attempt < retryDelays.length; attempt++) {
            const delay = retryDelays[attempt];

            if (delay > 0) {
                await this._sleep(delay);
            }

            try {
                await this.connect();
                return true; // Success
            } catch (error) {
                lastError = error;
                console.error(`Connection attempt ${attempt + 1} failed: ${error.message}`);
            }
        }

        // All retries exhausted
        console.error('=== DATABASE CONNECTION FAILED ===');
        console.error(`All ${retryDelays.length} connection attempts failed after ~2 minutes`);
        console.error('Server cannot start in online mode without database');
        throw lastError;
    }

    /**
     * Sleep helper for retry delays
     * @private
     */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Initialize database connection (single attempt)
     * Uses DATABASE_URL environment variable (provided by Render)
     */
    async connect() {
        try {
            // Connection string from environment variable
            // Render automatically provides this
            this.pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? {
                    rejectUnauthorized: false // Required for Render PostgreSQL
                } : false,
                max: 50, // Maximum connections in pool
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 5000, // Increased from 2s to 5s for cold starts
            });

            // Test connection
            const client = await this.pool.connect();
            client.release();

            // Initialize schema
            await this.initializeSchema();

            this.isConnected = true;
            return true;
        } catch (error) {
            console.error('PostgreSQL connection failed:', error.message);
            throw error;
        }
    }

    /**
     * Initialize database schema (create tables if they don't exist)
     */
    async initializeSchema() {
        const createTablesQuery = `
            -- Chunks table (stores all chunk data as JSON)
            CREATE TABLE IF NOT EXISTS chunks (
                chunk_id VARCHAR(50) PRIMARY KEY,
                data JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            -- Create index on chunk_id for faster lookups
            CREATE INDEX IF NOT EXISTS idx_chunks_chunk_id ON chunks(chunk_id);

            -- Server state table (tick persistence across restarts)
            CREATE TABLE IF NOT EXISTS server_state (
                id INTEGER PRIMARY KEY DEFAULT 1,
                tick BIGINT DEFAULT 0,
                version INTEGER DEFAULT 0,
                updated_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT single_row CHECK (id = 1)
            );

            -- AUTHENTICATION TABLES --

            -- Players table (authentication)
            CREATE TABLE IF NOT EXISTS players (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                last_login TIMESTAMP,
                fingerprint_hash VARCHAR(64),
                fingerprint_signals JSONB,
                email VARCHAR(255) DEFAULT NULL
            );

            -- Sessions table (login tokens)
            CREATE TABLE IF NOT EXISTS sessions (
                token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                player_id UUID REFERENCES players(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT NOW(),
                expires_at TIMESTAMP NOT NULL,
                last_activity TIMESTAMP DEFAULT NOW()
            );

            -- Player data table (game state)
            CREATE TABLE IF NOT EXISTS player_data (
                player_id UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
                inventory JSONB DEFAULT '[]'::jsonb,
                position JSONB DEFAULT '{"x":0,"y":0,"z":0}'::jsonb,
                current_chunk VARCHAR(50),
                health INT DEFAULT 100,
                hunger INT DEFAULT 100,
                stats JSONB DEFAULT '{}'::jsonb,
                updated_at TIMESTAMP DEFAULT NOW(),
                -- Spawn system fields
                faction_id INT DEFAULT NULL,  -- 1=Southguard, 3=Northmen, NULL=neutral
                home_structure_id VARCHAR(100) DEFAULT NULL,
                home_position_x FLOAT DEFAULT NULL,
                home_position_z FLOAT DEFAULT NULL,
                can_change_faction BOOLEAN DEFAULT TRUE
            );

            -- Friends table (for spawn system)
            CREATE TABLE IF NOT EXISTS friends (
                id SERIAL PRIMARY KEY,
                player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
                friend_player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
                status VARCHAR(20) DEFAULT 'pending',  -- 'pending' or 'accepted'
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(player_id, friend_player_id)
            );

            -- Login attempts table (for rate limiting)
            CREATE TABLE IF NOT EXISTS login_attempts (
                ip_address INET,
                username VARCHAR(50),
                attempt_time TIMESTAMP DEFAULT NOW(),
                success BOOLEAN DEFAULT FALSE
            );

            -- Audit log table (for moderation/investigation)
            CREATE TABLE IF NOT EXISTS audit_log (
                id SERIAL PRIMARY KEY,
                ts BIGINT NOT NULL,
                action_type SMALLINT NOT NULL,
                chunk_x SMALLINT,
                chunk_z SMALLINT,
                obj_type VARCHAR(30),
                obj_id VARCHAR(60),
                actor_id VARCHAR(60),
                actor_account VARCHAR(60),
                actor_name VARCHAR(50),
                owner_id VARCHAR(60),
                data JSONB
            );

            -- Banned fingerprints table (ban evasion detection)
            CREATE TABLE IF NOT EXISTS banned_fingerprints (
                id SERIAL PRIMARY KEY,
                fingerprint_hash VARCHAR(64) NOT NULL,
                partial_hashes JSONB DEFAULT '[]'::jsonb,
                banned_at TIMESTAMP DEFAULT NOW(),
                banned_by VARCHAR(50),
                reason TEXT,
                original_account_id UUID,
                original_username VARCHAR(50),
                match_count INT DEFAULT 0,
                last_match_at TIMESTAMP,
                is_active BOOLEAN DEFAULT TRUE
            );

            -- Fingerprint sightings table (connection tracking for ban evasion detection)
            CREATE TABLE IF NOT EXISTS fingerprint_sightings (
                fingerprint_hash VARCHAR(64) PRIMARY KEY,
                partial_hashes JSONB DEFAULT '{}'::jsonb,
                first_seen TIMESTAMP DEFAULT NOW(),
                last_seen TIMESTAMP DEFAULT NOW(),
                connection_count INT DEFAULT 1,
                associated_accounts UUID[] DEFAULT ARRAY[]::UUID[],
                associated_names TEXT[] DEFAULT ARRAY[]::TEXT[]
            );

            -- Indexes for auth tables
            CREATE INDEX IF NOT EXISTS idx_players_username ON players(username);
            CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
            CREATE INDEX IF NOT EXISTS idx_sessions_player_id ON sessions(player_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
            CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address, attempt_time);

            -- Indexes for friends table
            CREATE INDEX IF NOT EXISTS idx_friends_player_id ON friends(player_id);
            CREATE INDEX IF NOT EXISTS idx_friends_friend_player_id ON friends(friend_player_id);
            CREATE INDEX IF NOT EXISTS idx_friends_status ON friends(status);

            -- Indexes for audit log
            CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
            CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_account);
            CREATE INDEX IF NOT EXISTS idx_audit_owner ON audit_log(owner_id);
            CREATE INDEX IF NOT EXISTS idx_audit_obj ON audit_log(obj_id);
            CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_log(action_type);

            -- Indexes for fingerprint tables
            CREATE INDEX IF NOT EXISTS idx_players_fingerprint ON players(fingerprint_hash);
            CREATE INDEX IF NOT EXISTS idx_banned_fp_hash ON banned_fingerprints(fingerprint_hash);
            CREATE INDEX IF NOT EXISTS idx_banned_fp_active ON banned_fingerprints(is_active);

            -- Indexes for fingerprint sightings
            CREATE INDEX IF NOT EXISTS idx_fp_sightings_last_seen ON fingerprint_sightings(last_seen DESC);
        `;

        // Migration: Add spawn system columns to existing player_data tables
        const migrationQuery = `
            DO $$
            BEGIN
                -- Add faction_id if not exists
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='player_data' AND column_name='faction_id') THEN
                    ALTER TABLE player_data ADD COLUMN faction_id INT DEFAULT NULL;
                END IF;

                -- Add home_structure_id if not exists
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='player_data' AND column_name='home_structure_id') THEN
                    ALTER TABLE player_data ADD COLUMN home_structure_id VARCHAR(100) DEFAULT NULL;
                END IF;

                -- Add home_position_x if not exists
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='player_data' AND column_name='home_position_x') THEN
                    ALTER TABLE player_data ADD COLUMN home_position_x FLOAT DEFAULT NULL;
                END IF;

                -- Add home_position_z if not exists
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='player_data' AND column_name='home_position_z') THEN
                    ALTER TABLE player_data ADD COLUMN home_position_z FLOAT DEFAULT NULL;
                END IF;

                -- Add can_change_faction if not exists
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='player_data' AND column_name='can_change_faction') THEN
                    ALTER TABLE player_data ADD COLUMN can_change_faction BOOLEAN DEFAULT TRUE;
                END IF;

                -- Add actor_name to audit_log if not exists
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='audit_log' AND column_name='actor_name') THEN
                    ALTER TABLE audit_log ADD COLUMN actor_name VARCHAR(50) DEFAULT NULL;
                END IF;

                -- Add fingerprint_hash to players if not exists
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='players' AND column_name='fingerprint_hash') THEN
                    ALTER TABLE players ADD COLUMN fingerprint_hash VARCHAR(64) DEFAULT NULL;
                END IF;

                -- Add fingerprint_signals to players if not exists
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='players' AND column_name='fingerprint_signals') THEN
                    ALTER TABLE players ADD COLUMN fingerprint_signals JSONB DEFAULT NULL;
                END IF;

                -- Inventory sync system columns (Resume Last Session feature)
                -- Add last_sync_at to player_data if not exists
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='player_data' AND column_name='last_sync_at') THEN
                    ALTER TABLE player_data ADD COLUMN last_sync_at BIGINT DEFAULT NULL;
                END IF;

                -- Add sling_item to player_data if not exists
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='player_data' AND column_name='sling_item') THEN
                    ALTER TABLE player_data ADD COLUMN sling_item JSONB DEFAULT NULL;
                END IF;

                -- Add was_on_water_vehicle to player_data if not exists
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='player_data' AND column_name='was_on_water_vehicle') THEN
                    ALTER TABLE player_data ADD COLUMN was_on_water_vehicle BOOLEAN DEFAULT FALSE;
                END IF;

                -- Add actor_fingerprint to audit_log if not exists
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='audit_log' AND column_name='actor_fingerprint') THEN
                    ALTER TABLE audit_log ADD COLUMN actor_fingerprint VARCHAR(64) DEFAULT NULL;
                END IF;

                -- Add email to players if not exists
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='players' AND column_name='email') THEN
                    ALTER TABLE players ADD COLUMN email VARCHAR(255) DEFAULT NULL;
                END IF;
            END $$;
        `;

        try {
            await this.pool.query(createTablesQuery);
            await this.pool.query(migrationQuery);
            // Create indexes for actor_fingerprint AFTER migration adds the column
            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_audit_log_fingerprint ON audit_log(actor_fingerprint);
                CREATE INDEX IF NOT EXISTS idx_audit_log_fp_time ON audit_log(actor_fingerprint, ts DESC);
            `);
        } catch (error) {
            console.error('✗ Schema initialization failed:', error.message);
            throw error;
        }
    }

    /**
     * Execute a query
     * @param {string} text - SQL query text
     * @param {Array} params - Query parameters
     * @returns {Promise} Query result
     */
    async query(text, params) {
        if (!this.isConnected) {
            throw new Error('Database not connected');
        }
        return this.pool.query(text, params);
    }

    /**
     * Close database connection
     */
    async close() {
        if (this.pool) {
            await this.pool.end();
            this.isConnected = false;
        }
    }
}

// Singleton instance
const databaseManager = new DatabaseManager();

module.exports = databaseManager;

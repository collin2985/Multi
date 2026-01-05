/**
 * DatabaseManager.js
 * Simple PostgreSQL connection manager
 * Handles database connection pooling and schema initialization
 */

const { Pool } = require('pg');

class DatabaseManager {
    constructor() {
        this.pool = null;
        this.isConnected = false;
    }

    /**
     * Initialize database connection
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
                max: 20, // Maximum connections in pool
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 2000,
            });

            // Test connection
            const client = await this.pool.connect();
            console.log('✓ PostgreSQL connected successfully');
            client.release();

            // Initialize schema
            await this.initializeSchema();

            this.isConnected = true;
            return true;
        } catch (error) {
            console.error('✗ PostgreSQL connection failed:', error.message);
            console.error('  Make sure DATABASE_URL environment variable is set');
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
                last_login TIMESTAMP
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
            END $$;
        `;

        try {
            await this.pool.query(createTablesQuery);
            await this.pool.query(migrationQuery);
            console.log('✓ Database schema initialized (chunks + auth + spawn tables)');
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
            console.log('Database connection closed');
        }
    }
}

// Singleton instance
const databaseManager = new DatabaseManager();

module.exports = databaseManager;

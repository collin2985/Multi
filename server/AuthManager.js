/**
 * AuthManager.js
 * Handles player authentication, sessions, and data persistence
 * Supports dual-mode operation: local (no database) and production (PostgreSQL)
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./DatabaseManager');

class AuthManager {
    constructor() {
        // Database availability flag
        this.useDatabase = false;

        // Local mode storage (for testing without database)
        this.localUsers = new Map();      // username -> { playerId, password, createdAt }
        this.localSessions = new Map();   // token -> { playerId, username, expiresAt }
        this.localPlayerData = new Map(); // playerId -> { inventory, position, chunk, health, hunger, factionId, home* }

        // Faction constants
        // CRITICAL SYNC POINT: Must match public/config.js FACTION_ZONES
        this.FACTIONS = {
            SOUTHGUARD: 1,
            NORTHMEN: 3
            // Note: Settlers (2) removed - only two factions now
        };

        this.FACTION_ZONES = {
            1: { name: 'Southguard', minX: -10000, maxX: 10000, minZ: -2000, maxZ: 0 },
            3: { name: 'Northmen', minX: -10000, maxX: 10000, minZ: 0, maxZ: 2000 }
        };

        // World bounds for neutral players
        this.WORLD_BOUNDS = {
            minZ: -50000,
            maxZ: 50000
        };

        // Configuration
        this.bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS) || 10;
        this.sessionDuration = this.parseSessionDuration(process.env.SESSION_DURATION || '7d');

        // Owner data cache for batch lookups (reduces N+1 queries)
        // playerId -> { factionId, username, expiresAt }
        this.ownerCache = new Map();
        this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes

        // Ban cache for efficient fingerprint checking (avoids N queries per tick)
        this.bannedFingerprintsCache = new Set();
        this.banCacheLastRefresh = 0;
        this.BAN_CACHE_REFRESH_INTERVAL = 60 * 1000; // 1 minute
    }

    /**
     * Initialize the AuthManager
     * Attempts to connect to database, falls back to local mode if unavailable
     */
    async initialize() {
        try {
            // Check if database is available
            if (db.isConnected) {
                this.useDatabase = true;
                // Auth tables are created by DatabaseManager.initializeSchema()
            } else {
                throw new Error('Database not connected');
            }
        } catch (error) {
            this.useDatabase = false;
        }

        // Start session cleanup timer
        this.startSessionCleanup();
    }

    /**
     * Invalidate cached owner data for a player
     * Call this when faction or username changes
     * @param {string} playerId - The player ID to invalidate
     */
    invalidateOwnerCache(playerId) {
        if (playerId) {
            this.ownerCache.delete(playerId);
        }
    }

    /**
     * Refresh the banned fingerprints cache from database
     * Called periodically to keep cache fresh
     */
    async refreshBanCache() {
        if (!this.useDatabase) return;

        try {
            const result = await db.query(
                'SELECT fingerprint_hash FROM banned_fingerprints WHERE is_active = TRUE'
            );
            this.bannedFingerprintsCache = new Set(
                result.rows.map(r => r.fingerprint_hash).filter(Boolean)
            );
            this.banCacheLastRefresh = Date.now();
        } catch (error) {
            console.error('Failed to refresh ban cache:', error);
        }
    }

    /**
     * Check if a fingerprint is banned using cache (O(1) lookup)
     * @param {string} fingerprintHash
     * @returns {boolean}
     */
    isFingerprintBannedCached(fingerprintHash) {
        if (!fingerprintHash) return false;
        return this.bannedFingerprintsCache.has(fingerprintHash);
    }

    /**
     * Invalidate ban cache (call when a new ban is added)
     * Forces refresh on next check
     */
    invalidateBanCache() {
        this.banCacheLastRefresh = 0;
    }

    /**
     * Register a new player account
     * @param {string} username - Unique username
     * @param {string} password - Plain text password (will be hashed)
     * @returns {Promise<{success: boolean, playerId?: string, token?: string, message?: string}>}
     */
    async register(username, password) {
        // Validate input
        if (!username || typeof username !== 'string' ||
            username.length < 3 || username.length > 20 ||
            !/^[a-zA-Z0-9_]+$/.test(username)) {
            return {
                success: false,
                message: 'Username must be 3-20 characters, alphanumeric with underscores only'
            };
        }
        if (this.containsBlockedWords(username)) {
            return {
                success: false,
                message: 'Username contains inappropriate content'
            };
        }

        if (!this.validatePassword(password)) {
            return {
                success: false,
                message: 'Password must be at least 8 characters'
            };
        }

        if (!this.useDatabase) {
            // LOCAL MODE: Simple in-memory storage
            // Use lowercase key for case-insensitive lookup, store original for display
            const usernameLower = username.toLowerCase();
            if (this.localUsers.has(usernameLower)) {
                return { success: false, message: 'Username already taken' };
            }

            const playerId = 'local_' + crypto.randomBytes(6).toString('hex');
            const token = 'token_' + crypto.randomBytes(16).toString('hex');
            const expiresAt = new Date(Date.now() + this.sessionDuration);

            // Store user with lowercase key, preserve display username
            this.localUsers.set(usernameLower, {
                playerId,
                displayUsername: username, // Original case for display
                password, // WARNING: Plain text for local testing only!
                createdAt: new Date()
            });

            // Create session
            this.localSessions.set(token, {
                playerId,
                username,
                expiresAt
            });

            // Get influence for new registration (returns default for local testing)
            const influence = await this.getInfluence(playerId);

            return { success: true, playerId, token, influence };
        }

        // PRODUCTION MODE: PostgreSQL with bcrypt
        const client = await db.pool.connect();
        try {
            // Check if username already exists (case-insensitive)
            const existingUser = await client.query(
                'SELECT id FROM players WHERE LOWER(username) = LOWER($1)',
                [username]
            );
            if (existingUser.rows.length > 0) {
                client.release();
                return { success: false, message: 'Username already taken' };
            }

            // Hash password
            const passwordHash = await bcrypt.hash(password, this.bcryptRounds);

            // Begin transaction on dedicated connection
            await client.query('BEGIN');

            // Create player (store original case for display)
            const playerResult = await client.query(
                `INSERT INTO players (username, password_hash)
                 VALUES ($1, $2)
                 RETURNING id`,
                [username, passwordHash]
            );

            const playerId = playerResult.rows[0].id;

            // Create player_data entry
            await client.query(
                `INSERT INTO player_data (player_id) VALUES ($1)`,
                [playerId]
            );

            // Create session
            const expiresAt = new Date(Date.now() + this.sessionDuration);
            const sessionResult = await client.query(
                `INSERT INTO sessions (player_id, expires_at)
                 VALUES ($1, $2)
                 RETURNING token`,
                [playerId, expiresAt]
            );

            const token = sessionResult.rows[0].token;

            await client.query('COMMIT');
            client.release();

            // Get influence for new registration
            const influence = await this.getInfluence(playerId);

            return { success: true, playerId, token, influence };

        } catch (error) {
            try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
            client.release();

            if (error.code === '23505') { // Unique violation
                return { success: false, message: 'Username already taken' };
            }

            console.error('Registration error:', error);
            return { success: false, message: 'Registration failed' };
        }
    }

    /**
     * Login with existing account
     * @param {string} username
     * @param {string} password
     * @returns {Promise<{success: boolean, playerId?: string, token?: string, message?: string}>}
     */
    async login(username, password) {
        if (!this.useDatabase) {
            // LOCAL MODE - case-insensitive lookup
            const usernameLower = username.toLowerCase();
            const user = this.localUsers.get(usernameLower);
            if (!user || user.password !== password) {
                return { success: false, message: 'Invalid username or password' };
            }

            // Create new session with display username
            const token = 'token_' + crypto.randomBytes(16).toString('hex');
            const expiresAt = new Date(Date.now() + this.sessionDuration);
            const displayUsername = user.displayUsername || username;

            this.localSessions.set(token, {
                playerId: user.playerId,
                username: displayUsername, // Use original case
                expiresAt
            });

            // Get influence for local mode
            const influence = await this.getInfluence(user.playerId);

            return { success: true, playerId: user.playerId, token, influence };
        }

        // PRODUCTION MODE
        // Check rate limit before attempting login
        const failures = await this.getRecentFailures(username);
        if (failures >= 5) {
            return { success: false, message: 'Too many failed attempts. Try again in 5 minutes.' };
        }

        try {
            // Get user (case-insensitive lookup, return original username for display)
            const userResult = await db.query(
                `SELECT id, username, password_hash FROM players WHERE LOWER(username) = LOWER($1)`,
                [username]
            );

            if (userResult.rows.length === 0) {
                await this.recordLoginAttempt(username, false);
                return { success: false, message: 'Invalid username or password' };
            }

            const user = userResult.rows[0];
            const displayUsername = user.username; // Original case from DB

            // Verify password
            const validPassword = await bcrypt.compare(password, user.password_hash);
            if (!validPassword) {
                await this.recordLoginAttempt(username, false);
                return { success: false, message: 'Invalid username or password' };
            }

            // Update last login
            await db.query(
                `UPDATE players SET last_login = NOW() WHERE id = $1`,
                [user.id]
            );

            // Create session
            const expiresAt = new Date(Date.now() + this.sessionDuration);
            const sessionResult = await db.query(
                `INSERT INTO sessions (player_id, expires_at)
                 VALUES ($1, $2)
                 RETURNING token`,
                [user.id, expiresAt]
            );

            const token = sessionResult.rows[0].token;

            // Clear failed attempts on successful login
            await this.recordLoginAttempt(username, true);

            // Get influence for production mode
            const influence = await this.getInfluence(user.id);

            return { success: true, playerId: user.id, token, influence };

        } catch (error) {
            console.error('Login error:', error);
            return { success: false, message: 'Login failed' };
        }
    }

    /**
     * Get count of recent failed login attempts for a username
     * @param {string} username
     * @returns {Promise<number>} Number of failures in last 5 minutes
     */
    async getRecentFailures(username) {
        if (!this.useDatabase) return 0;
        try {
            const result = await db.query(
                `SELECT COUNT(*) FROM login_attempts
                 WHERE LOWER(username) = LOWER($1)
                 AND success = FALSE
                 AND attempt_time > NOW() - INTERVAL '5 minutes'`,
                [username]
            );
            return parseInt(result.rows[0].count);
        } catch (error) {
            console.error('Check login attempts error:', error);
            return 0; // Fail open - don't block legitimate users on DB error
        }
    }

    /**
     * Record a login attempt (success clears failures, failure adds record)
     * @param {string} username
     * @param {boolean} success
     */
    async recordLoginAttempt(username, success) {
        if (!this.useDatabase) return;
        try {
            if (success) {
                await db.query(
                    `DELETE FROM login_attempts WHERE LOWER(username) = LOWER($1)`,
                    [username]
                );
            } else {
                await db.query(
                    `INSERT INTO login_attempts (username, success) VALUES ($1, FALSE)`,
                    [username]
                );
            }
        } catch (error) {
            console.error('Record login attempt error:', error);
        }
    }

    /**
     * Validate a session token
     * @param {string} token
     * @returns {Promise<{valid: boolean, playerId?: string, username?: string}>}
     */
    async validateSession(token) {
        if (!token) {
            return { valid: false };
        }

        if (!this.useDatabase) {
            // LOCAL MODE
            const session = this.localSessions.get(token);
            if (!session) {
                return { valid: false };
            }

            if (new Date() > session.expiresAt) {
                this.localSessions.delete(token);
                return { valid: false };
            }

            // Get influence for local mode
            const influence = await this.getInfluence(session.playerId);

            return {
                valid: true,
                playerId: session.playerId,
                username: session.username,
                influence
            };
        }

        // PRODUCTION MODE
        try {
            const result = await db.query(
                `SELECT s.player_id, s.expires_at, p.username
                 FROM sessions s
                 JOIN players p ON s.player_id = p.id
                 WHERE s.token = $1`,
                [token]
            );

            if (result.rows.length === 0) {
                return { valid: false };
            }

            const session = result.rows[0];

            if (new Date() > session.expires_at) {
                // Delete expired session
                await db.query('DELETE FROM sessions WHERE token = $1', [token]);
                return { valid: false };
            }

            // Update last activity
            await db.query(
                'UPDATE sessions SET last_activity = NOW() WHERE token = $1',
                [token]
            );

            // Get influence for production mode
            const influence = await this.getInfluence(session.player_id);

            return {
                valid: true,
                playerId: session.player_id,
                username: session.username,
                influence
            };

        } catch (error) {
            console.error('Session validation error:', error);
            return { valid: false };
        }
    }

    /**
     * Logout (invalidate session)
     * @param {string} token
     */
    async logout(token) {
        if (!this.useDatabase) {
            this.localSessions.delete(token);
            return { success: true };
        }

        try {
            await db.query('DELETE FROM sessions WHERE token = $1', [token]);
            return { success: true };
        } catch (error) {
            console.error('Logout error:', error);
            return { success: false };
        }
    }

    /**
     * Save player game data (includes spawn system fields)
     * @param {string} playerId
     * @param {object} data - { inventory, position, currentChunk, health, hunger, stats, factionId, home* }
     */
    async savePlayerData(playerId, data) {
        if (!playerId || String(playerId).startsWith('session_')) {
            return { success: false, message: 'Guest data not saved' };
        }

        if (!this.useDatabase) {
            // LOCAL MODE - merge with existing data
            const existing = this.localPlayerData.get(playerId) || {};
            this.localPlayerData.set(playerId, {
                ...existing,
                ...data,
                updatedAt: new Date()
            });
            return { success: true };
        }

        // PRODUCTION MODE
        try {
            await db.query(
                `UPDATE player_data
                 SET inventory = $1,
                     position = $2,
                     current_chunk = $3,
                     health = $4,
                     hunger = $5,
                     stats = $6,
                     faction_id = $7,
                     home_structure_id = $8,
                     home_position_x = $9,
                     home_position_z = $10,
                     can_change_faction = $11,
                     updated_at = NOW()
                 WHERE player_id = $12`,
                [
                    JSON.stringify(data.inventory || []),
                    JSON.stringify(data.position || { x: 0, y: 0, z: 0 }),
                    data.currentChunk,
                    data.health || 100,
                    data.hunger || 100,
                    JSON.stringify(data.stats || {}),
                    data.factionId !== undefined ? data.factionId : null,
                    data.homeStructureId || null,
                    data.homePositionX !== undefined ? data.homePositionX : null,
                    data.homePositionZ !== undefined ? data.homePositionZ : null,
                    true,
                    playerId
                ]
            );
            return { success: true };
        } catch (error) {
            console.error('Save player data error:', error);
            return { success: false, message: 'Failed to save data' };
        }
    }

    /**
     * Save player sync data (lightweight - just inventory, position, and water vehicle flag)
     * Used by the periodic inventory sync system for "Resume Last Session" feature
     * @param {string} playerId
     * @param {object} data - { inventory, slingItem, position, wasOnWaterVehicle, lastSyncAt }
     */
    async savePlayerSync(playerId, data) {
        if (!playerId || String(playerId).startsWith('session_')) {
            return { success: false, message: 'Guest data not saved' };
        }

        if (!this.useDatabase) {
            // LOCAL MODE
            const existing = this.localPlayerData.get(playerId) || {};
            existing.inventory = data.inventory;
            existing.slingItem = data.slingItem;
            existing.position = data.position;
            existing.wasOnWaterVehicle = data.wasOnWaterVehicle;
            existing.lastSyncAt = data.lastSyncAt;
            existing.updatedAt = new Date();
            this.localPlayerData.set(playerId, existing);
            return { success: true };
        }

        // PRODUCTION MODE
        try {
            await db.query(
                `UPDATE player_data
                 SET inventory = $1,
                     sling_item = $2,
                     position = $3,
                     was_on_water_vehicle = $4,
                     last_sync_at = $5,
                     updated_at = NOW()
                 WHERE player_id = $6`,
                [
                    JSON.stringify(data.inventory || []),
                    JSON.stringify(data.slingItem),
                    JSON.stringify(data.position || { x: 0, y: 0, z: 0 }),
                    data.wasOnWaterVehicle || false,
                    data.lastSyncAt,
                    playerId
                ]
            );
            return { success: true };
        } catch (error) {
            console.error('Save player sync error:', error);
            return { success: false, message: 'Failed to save sync data' };
        }
    }

    /**
     * Clear player session data (called on death to prevent Resume Last Session)
     * Nulls out position, inventory, and sync timestamp so player cannot resume at death location
     * @param {string} playerId
     */
    async clearPlayerSession(playerId) {
        if (!playerId || String(playerId).startsWith('session_')) {
            return { success: false, message: 'Guest data not cleared' };
        }

        if (!this.useDatabase) {
            // LOCAL MODE
            const existing = this.localPlayerData.get(playerId);
            if (existing) {
                existing.inventory = null;
                existing.slingItem = null;
                existing.position = null;
                existing.wasOnWaterVehicle = false;
                existing.lastSyncAt = null;
                existing.updatedAt = new Date();
                this.localPlayerData.set(playerId, existing);
            }
            return { success: true };
        }

        // PRODUCTION MODE
        try {
            await db.query(
                `UPDATE player_data
                 SET inventory = NULL,
                     sling_item = NULL,
                     position = NULL,
                     was_on_water_vehicle = false,
                     last_sync_at = NULL,
                     updated_at = NOW()
                 WHERE player_id = $1`,
                [playerId]
            );
            return { success: true };
        } catch (error) {
            console.error('Clear player session error:', error);
            return { success: false, message: 'Failed to clear session data' };
        }
    }

    /**
     * Update a single field in player data (for simple flags like tasksPanelClosed)
     * @param {string} playerId
     * @param {string} field - Field name to update
     * @param {any} value - Value to set
     */
    async updatePlayerField(playerId, field, value) {
        if (!playerId || String(playerId).startsWith('session_')) {
            return { success: false, message: 'Guest data not saved' };
        }

        if (!this.useDatabase) {
            // LOCAL MODE - merge with existing data
            const existing = this.localPlayerData.get(playerId) || {};
            existing[field] = value;
            existing.updatedAt = new Date();
            this.localPlayerData.set(playerId, existing);
            return { success: true };
        }

        // PRODUCTION MODE - store in stats JSON field
        try {
            // Load current stats, update field, save back
            const result = await db.query(
                `SELECT stats FROM player_data WHERE player_id = $1`,
                [playerId]
            );
            if (result.rows.length > 0) {
                const stats = result.rows[0].stats || {};
                stats[field] = value;
                await db.query(
                    `UPDATE player_data SET stats = $1, updated_at = NOW() WHERE player_id = $2`,
                    [JSON.stringify(stats), playerId]
                );
            }
            return { success: true };
        } catch (error) {
            console.error('Update player field error:', error);
            return { success: false, message: 'Failed to update field' };
        }
    }

    // ==========================================
    // INFLUENCE SYSTEM
    // ==========================================

    /**
     * Add influence points to a player's account
     * @param {string} playerId - The player's account ID
     * @param {number} amount - Amount of influence to add
     * @returns {Promise<{success: boolean, influence?: number, message?: string}>}
     */
    async addInfluence(playerId, amount) {
        // Convert to string for consistent comparison (playerId may be integer from database)
        const playerIdStr = String(playerId);
        if (!playerId || playerIdStr.startsWith('session_')) {
            return { success: false, message: 'Guest cannot gain influence' };
        }

        if (!this.useDatabase) {
            // LOCAL MODE
            const existing = this.localPlayerData.get(playerId) || {};
            const stats = existing.stats || {};
            // Use ?? 3 to match getInfluence default for local testing
            stats.influence = (stats.influence ?? 3) + amount;
            existing.stats = stats;
            existing.updatedAt = new Date();
            this.localPlayerData.set(playerId, existing);
            return { success: true, influence: stats.influence };
        }

        // PRODUCTION MODE - atomic increment in stats JSON
        try {
            const result = await db.query(
                `UPDATE player_data
                 SET stats = jsonb_set(
                     COALESCE(stats, '{}'::jsonb),
                     '{influence}',
                     (COALESCE((stats->>'influence')::int, 0) + $1)::text::jsonb
                 ),
                 updated_at = NOW()
                 WHERE player_id = $2
                 RETURNING (stats->>'influence')::int as influence`,
                [amount, playerId]
            );
            return {
                success: true,
                influence: result.rows[0]?.influence || amount
            };
        } catch (error) {
            console.error('Add influence error:', error);
            return { success: false, message: 'Failed to add influence' };
        }
    }

    /**
     * Get a player's current influence points
     * @param {string} playerId - The player's account ID
     * @returns {Promise<number>} The player's influence (0 if not found or guest)
     */
    async getInfluence(playerId) {
        if (!playerId || String(playerId).startsWith('session_')) {
            return 0;
        }

        if (!this.useDatabase) {
            const data = this.localPlayerData.get(playerId);
            // LOCAL TESTING: Start with 3 influence for militia testing
            return data?.stats?.influence ?? 3;
        }

        try {
            const result = await db.query(
                `SELECT (stats->>'influence')::int as influence
                 FROM player_data WHERE player_id = $1`,
                [playerId]
            );
            return result.rows[0]?.influence || 0;
        } catch (error) {
            console.error('Get influence error:', error);
            return 0;
        }
    }

    /**
     * Load player game data (includes spawn system fields and Resume Last Session data)
     * @param {string} playerId
     * @returns {Promise<object|null>} Player data or null if not found
     */
    async loadPlayerData(playerId) {
        if (!playerId || String(playerId).startsWith('session_')) {
            return null;
        }

        if (!this.useDatabase) {
            // LOCAL MODE
            const localData = this.localPlayerData.get(playerId);
            if (!localData) return null;

            // Calculate hasSavedSession for local mode
            const inventory = localData.inventory || [];
            const hasSavedSession = Boolean(localData.lastSyncAt);
            const canResume = hasSavedSession && !localData.wasOnWaterVehicle;

            return {
                ...localData,
                hasSavedSession,
                canResume,
                wasOnWaterVehicle: localData.wasOnWaterVehicle || false,
                savedPosition: hasSavedSession ? localData.position : null,
                savedInventory: hasSavedSession ? inventory : null,
                savedSlingItem: hasSavedSession ? localData.slingItem : null
            };
        }

        // PRODUCTION MODE
        try {
            const result = await db.query(
                `SELECT inventory, position, current_chunk, health, hunger, stats, updated_at,
                        faction_id, home_structure_id, home_position_x, home_position_z, can_change_faction,
                        last_sync_at, sling_item, was_on_water_vehicle
                 FROM player_data
                 WHERE player_id = $1`,
                [playerId]
            );

            if (result.rows.length === 0) {
                return null;
            }

            const data = result.rows[0];

            // Calculate hasSavedSession - player has synced at least once
            const inventory = data.inventory || [];
            const hasSavedSession = !!data.last_sync_at;

            // Can only resume if not on water vehicle when last saved
            const canResume = hasSavedSession && !data.was_on_water_vehicle;

            return {
                inventory: data.inventory,
                position: data.position,
                currentChunk: data.current_chunk,
                health: data.health,
                hunger: data.hunger,
                stats: data.stats,
                updatedAt: data.updated_at,
                factionId: data.faction_id,
                homeStructureId: data.home_structure_id,
                homePositionX: data.home_position_x,
                homePositionZ: data.home_position_z,
                canChangeFaction: data.can_change_faction,
                // Resume Last Session data
                hasSavedSession,
                canResume,
                wasOnWaterVehicle: data.was_on_water_vehicle || false,
                savedPosition: hasSavedSession ? data.position : null,
                savedInventory: hasSavedSession ? data.inventory : null,
                savedSlingItem: hasSavedSession ? data.sling_item : null
            };
        } catch (error) {
            console.error('Load player data error:', error);
            return null;
        }
    }

    // ==========================================
    // FACTION MANAGEMENT
    // ==========================================

    /**
     * Set player's faction (first time or via change)
     * @param {string} playerId
     * @param {number} factionId - 1=Southguard, 3=Northmen, null=neutral
     */
    async setFaction(playerId, factionId) {
        if (!playerId || String(playerId).startsWith('session_')) {
            return { success: false, message: 'Guests cannot set faction permanently' };
        }

        // Validate faction ID (1=Southguard, 3=Northmen, null=Neutral)
        if (factionId !== null && ![1, 3].includes(factionId)) {
            return { success: false, message: 'Invalid faction' };
        }

        if (!this.useDatabase) {
            // LOCAL MODE
            const data = this.localPlayerData.get(playerId) || {};
            data.factionId = factionId;
            this.localPlayerData.set(playerId, data);
            this.invalidateOwnerCache(playerId);
            return { success: true };
        }

        // PRODUCTION MODE
        try {
            await db.query(
                'UPDATE player_data SET faction_id = $1, updated_at = NOW() WHERE player_id = $2',
                [factionId, playerId]
            );
            this.invalidateOwnerCache(playerId);
            return { success: true };
        } catch (error) {
            console.error('Set faction error:', error);
            return { success: false, message: 'Failed to set faction' };
        }
    }

    /**
     * Join a faction (one-way, neutral -> faction only)
     * Only allows neutral players to join faction 1 or 3
     * @param {string} playerId
     * @param {number} factionId - 1=Southguard, 3=Northmen
     */
    async joinFaction(playerId, factionId) {
        if (!playerId || String(playerId).startsWith('session_')) {
            return { success: false, message: 'Guests cannot join a faction' };
        }

        // Validate faction ID (only 1=Southguard, 3=Northmen allowed)
        if (![1, 3].includes(factionId)) {
            return { success: false, message: 'Invalid faction' };
        }

        // Check player is currently neutral
        const playerData = await this.loadPlayerData(playerId);
        if (playerData && playerData.factionId !== null && playerData.factionId !== undefined) {
            return { success: false, message: 'You are already in a faction' };
        }

        if (!this.useDatabase) {
            // LOCAL MODE
            const data = this.localPlayerData.get(playerId) || {};
            data.factionId = factionId;
            this.localPlayerData.set(playerId, data);
            this.invalidateOwnerCache(playerId);
            return { success: true };
        }

        // PRODUCTION MODE
        try {
            await db.query(
                'UPDATE player_data SET faction_id = $1, updated_at = NOW() WHERE player_id = $2',
                [factionId, playerId]
            );
            this.invalidateOwnerCache(playerId);
            return { success: true };
        } catch (error) {
            console.error('Join faction error:', error);
            return { success: false, message: 'Failed to join faction' };
        }
    }

    // ==========================================
    // HOME MANAGEMENT
    // ==========================================

    /**
     * Set player's home (called when they build a tent or house)
     * @param {string} playerId
     * @param {string} structureId - The structure's unique ID
     * @param {number} x - World X position
     * @param {number} z - World Z position
     */
    async setHome(playerId, structureId, x, z) {
        if (!playerId || String(playerId).startsWith('session_')) {
            return { success: false, message: 'Guests cannot set home' };
        }

        if (!this.useDatabase) {
            // LOCAL MODE
            const data = this.localPlayerData.get(playerId) || {};
            data.homeStructureId = structureId;
            data.homePositionX = x;
            data.homePositionZ = z;
            this.localPlayerData.set(playerId, data);
            return { success: true };
        }

        // PRODUCTION MODE
        try {
            await db.query(
                `UPDATE player_data
                 SET home_structure_id = $1, home_position_x = $2, home_position_z = $3, updated_at = NOW()
                 WHERE player_id = $4`,
                [structureId, x, z, playerId]
            );
            return { success: true };
        } catch (error) {
            console.error('Set home error:', error);
            return { success: false, message: 'Failed to set home' };
        }
    }

    /**
     * Get player's home info and verify it still exists
     * @param {string} playerId
     * @param {object} chunkManager - ChunkManager instance to check if structure exists
     * @returns {Promise<{exists: boolean, x?: number, z?: number, structureId?: string}>}
     */
    async getHomeInfo(playerId, chunkManager) {
        const playerData = await this.loadPlayerData(playerId);

        if (!playerData || !playerData.homeStructureId) {
            return { exists: false };
        }

        // Determine which chunk the home is in
        const chunkX = Math.floor((playerData.homePositionX + 25) / 50);
        const chunkZ = Math.floor((playerData.homePositionZ + 25) / 50);
        const chunkId = `chunk_${chunkX},${chunkZ}`;

        // Check if structure still exists in chunk
        const structure = await chunkManager.findObjectChange(chunkId, playerData.homeStructureId);

        if (!structure) {
            // Home was destroyed - clear it from player data
            await this.clearHome(playerId);
            return { exists: false, destroyed: true };
        }

        return {
            exists: true,
            structureId: playerData.homeStructureId,
            x: playerData.homePositionX,
            z: playerData.homePositionZ
        };
    }

    /**
     * Clear player's home (called when home is destroyed or faction changes)
     * @param {string} playerId
     */
    async clearHome(playerId) {
        if (!playerId || String(playerId).startsWith('session_')) {
            return { success: false };
        }

        if (!this.useDatabase) {
            // LOCAL MODE
            const data = this.localPlayerData.get(playerId);
            if (data) {
                data.homeStructureId = null;
                data.homePositionX = null;
                data.homePositionZ = null;
            }
            return { success: true };
        }

        // PRODUCTION MODE
        try {
            await db.query(
                `UPDATE player_data
                 SET home_structure_id = NULL, home_position_x = NULL, home_position_z = NULL, updated_at = NOW()
                 WHERE player_id = $1`,
                [playerId]
            );
            return { success: true };
        } catch (error) {
            console.error('Clear home error:', error);
            return { success: false };
        }
    }

    /**
     * Set player's owned house (players can only own one house at a time)
     * @param {string} playerId
     * @param {string} houseId - Structure ID of the house
     * @param {string} chunkId - Chunk ID containing the house
     */
    async setOwnedHouse(playerId, houseId, chunkId) {
        if (!playerId || String(playerId).startsWith('session_')) {
            return { success: false, message: 'Guests cannot own houses' };
        }

        if (!this.useDatabase) {
            // LOCAL MODE
            const data = this.localPlayerData.get(playerId) || {};
            data.ownedHouseId = houseId;
            data.ownedHouseChunkId = chunkId;
            this.localPlayerData.set(playerId, data);
            return { success: true };
        }

        // PRODUCTION MODE - store in stats JSON field
        try {
            const result = await db.query(
                `SELECT stats FROM player_data WHERE player_id = $1`,
                [playerId]
            );

            let stats = {};
            if (result.rows.length > 0 && result.rows[0].stats) {
                stats = typeof result.rows[0].stats === 'string'
                    ? JSON.parse(result.rows[0].stats)
                    : result.rows[0].stats;
            }

            stats.ownedHouseId = houseId;
            stats.ownedHouseChunkId = chunkId;

            await db.query(
                `UPDATE player_data SET stats = $1, updated_at = NOW() WHERE player_id = $2`,
                [JSON.stringify(stats), playerId]
            );
            return { success: true };
        } catch (error) {
            console.error('Set owned house error:', error);
            return { success: false, message: 'Failed to set owned house' };
        }
    }

    /**
     * Get player's currently owned house info
     * @param {string} playerId
     * @returns {Promise<{houseId: string|null, chunkId: string|null}>}
     */
    async getOwnedHouse(playerId) {
        if (!playerId || String(playerId).startsWith('session_')) {
            return { houseId: null, chunkId: null };
        }

        if (!this.useDatabase) {
            // LOCAL MODE
            const data = this.localPlayerData.get(playerId) || {};
            return {
                houseId: data.ownedHouseId || null,
                chunkId: data.ownedHouseChunkId || null
            };
        }

        // PRODUCTION MODE
        try {
            const result = await db.query(
                `SELECT stats FROM player_data WHERE player_id = $1`,
                [playerId]
            );

            if (result.rows.length > 0 && result.rows[0].stats) {
                const stats = typeof result.rows[0].stats === 'string'
                    ? JSON.parse(result.rows[0].stats)
                    : result.rows[0].stats;
                return {
                    houseId: stats.ownedHouseId || null,
                    chunkId: stats.ownedHouseChunkId || null
                };
            }
            return { houseId: null, chunkId: null };
        } catch (error) {
            console.error('Get owned house error:', error);
            return { houseId: null, chunkId: null };
        }
    }

    /**
     * Get username by player ID
     * @param {string} playerId
     * @returns {Promise<string|null>}
     */
    async getUsernameById(playerId) {
        if (!playerId) return null;

        if (!this.useDatabase) {
            // LOCAL MODE - search through localUsers, return display username
            for (const [lowercaseKey, userData] of this.localUsers) {
                if (userData.playerId === playerId) {
                    return userData.displayUsername || lowercaseKey; // Return original case
                }
            }
            return null;
        }

        // PRODUCTION MODE
        try {
            const result = await db.query(
                'SELECT username FROM players WHERE id = $1',
                [playerId]
            );
            return result.rows.length > 0 ? result.rows[0].username : null;
        } catch (error) {
            console.error('Get username by ID error:', error);
            return null;
        }
    }

    /**
     * Get faction ID by player ID
     * @param {string} playerId
     * @returns {Promise<number|null>}
     */
    async getFactionById(playerId) {
        if (!playerId) return null;

        if (!this.useDatabase) {
            // LOCAL MODE - get from localPlayerData
            const playerData = this.localPlayerData.get(playerId);
            return playerData ? playerData.factionId : null;
        }

        // PRODUCTION MODE
        try {
            const result = await db.query(
                'SELECT faction_id FROM player_data WHERE player_id = $1',
                [playerId]
            );
            return result.rows.length > 0 ? result.rows[0].faction_id : null;
        } catch (error) {
            console.error('Get faction by ID error:', error);
            return null;
        }
    }

    /**
     * Batch fetch factions and usernames for multiple owners
     * Uses cache when available, batch-queries only uncached entries
     * @param {string[]} ownerIds - Array of player IDs to fetch
     * @returns {Promise<Map<string, {factionId: number|null, username: string|null}>>}
     */
    async getBatchOwnerData(ownerIds) {
        if (!ownerIds || ownerIds.length === 0) {
            return new Map();
        }

        const result = new Map();
        const uncachedIds = [];
        const now = Date.now();

        // Check cache first
        for (const ownerId of ownerIds) {
            const cached = this.ownerCache.get(ownerId);
            if (cached && cached.expiresAt > now) {
                result.set(ownerId, { factionId: cached.factionId, username: cached.username });
            } else {
                uncachedIds.push(ownerId);
            }
        }

        // If all cached, return early
        if (uncachedIds.length === 0) {
            return result;
        }

        // Batch fetch uncached entries
        if (!this.useDatabase) {
            // LOCAL MODE
            for (const ownerId of uncachedIds) {
                const playerData = this.localPlayerData.get(ownerId);
                let username = null;
                for (const [key, userData] of this.localUsers) {
                    if (userData.playerId === ownerId) {
                        username = userData.displayUsername || key;
                        break;
                    }
                }
                const data = { factionId: playerData?.factionId ?? null, username };
                result.set(ownerId, data);
                // Cache it
                this.ownerCache.set(ownerId, { ...data, expiresAt: now + this.CACHE_TTL });
            }
        } else {
            // PRODUCTION MODE - 2 batch queries instead of 2N individual queries
            try {
                const [factionResult, usernameResult] = await Promise.all([
                    db.query(
                        'SELECT player_id, faction_id FROM player_data WHERE player_id = ANY($1)',
                        [uncachedIds]
                    ),
                    db.query(
                        'SELECT id, username FROM players WHERE id = ANY($1)',
                        [uncachedIds]
                    )
                ]);

                // Build lookup maps from results
                const factionMap = new Map(factionResult.rows.map(r => [r.player_id, r.faction_id]));
                const usernameMap = new Map(usernameResult.rows.map(r => [r.id, r.username]));

                // Populate results and cache
                for (const ownerId of uncachedIds) {
                    const data = {
                        factionId: factionMap.get(ownerId) ?? null,
                        username: usernameMap.get(ownerId) ?? null
                    };
                    result.set(ownerId, data);
                    // Cache it
                    this.ownerCache.set(ownerId, { ...data, expiresAt: now + this.CACHE_TTL });
                }
            } catch (error) {
                console.error('Batch owner data fetch error:', error);
                // On error, return what we have (cached entries)
            }
        }

        return result;
    }

    // ==========================================
    // FINGERPRINT MANAGEMENT (Ban Evasion Detection)
    // ==========================================

    /**
     * Check fingerprint against banned list
     * @param {string} fingerprintHash - Full SHA-256 hash
     * @param {object} partialHashes - Partial signal hashes for fuzzy matching
     * @returns {Promise<{banned: boolean, type: string, reason?: string, flagged?: boolean}>}
     */
    async checkFingerprint(fingerprintHash, partialHashes) {
        if (!this.useDatabase || !fingerprintHash) {
            return { banned: false, type: 'none' };
        }

        try {
            // Check for exact match
            const exactResult = await db.query(
                `SELECT id, reason, original_username FROM banned_fingerprints
                 WHERE fingerprint_hash = $1 AND is_active = TRUE`,
                [fingerprintHash]
            );

            if (exactResult.rows.length > 0) {
                // Update match count
                await db.query(
                    `UPDATE banned_fingerprints SET match_count = match_count + 1,
                     last_match_at = NOW() WHERE id = $1`,
                    [exactResult.rows[0].id]
                );

                return {
                    banned: true,
                    type: 'exact',
                    reason: exactResult.rows[0].reason,
                    originalUser: exactResult.rows[0].original_username
                };
            }

            // Check for partial matches (fuzzy matching)
            if (partialHashes && (partialHashes.gpu || partialHashes.hardware || partialHashes.canvas)) {
                const partialResult = await db.query(
                    `SELECT id, reason, original_username, partial_hashes FROM banned_fingerprints
                     WHERE is_active = TRUE`,
                    []
                );

                for (const row of partialResult.rows) {
                    const storedPartials = row.partial_hashes || {};
                    let matchCount = 0;

                    if (storedPartials.gpu && storedPartials.gpu === partialHashes.gpu) matchCount++;
                    if (storedPartials.hardware && storedPartials.hardware === partialHashes.hardware) matchCount++;
                    if (storedPartials.canvas && storedPartials.canvas === partialHashes.canvas) matchCount++;

                    // 2+ partial matches = high suspicion, flag for review
                    if (matchCount >= 2) {
                        return {
                            banned: false,
                            type: 'partial',
                            matchCount,
                            originalUser: row.original_username,
                            flagged: true
                        };
                    }
                }
            }

            return { banned: false, type: 'none' };

        } catch (error) {
            console.error('Fingerprint check error:', error);
            return { banned: false, type: 'error' };
        }
    }

    /**
     * Store fingerprint with player account
     * @param {string} playerId - Player UUID
     * @param {string} fingerprintHash - Full hash
     * @param {object} partialHashes - Partial hashes for fuzzy matching
     */
    async storeFingerprint(playerId, fingerprintHash, partialHashes) {
        if (!this.useDatabase || !playerId || !fingerprintHash) return;

        try {
            await db.query(
                `UPDATE players SET fingerprint_hash = $1, fingerprint_signals = $2
                 WHERE id = $3`,
                [fingerprintHash, JSON.stringify(partialHashes || {}), playerId]
            );
        } catch (error) {
            console.error('Store fingerprint error:', error);
        }
    }

    /**
     * Ban a fingerprint (admin action)
     * @param {string} playerId - Account to ban fingerprint from
     * @param {string} reason - Ban reason
     * @param {string} adminUsername - Admin performing the ban
     * @returns {Promise<{success: boolean, message?: string}>}
     */
    async banFingerprint(playerId, reason, adminUsername) {
        if (!this.useDatabase) {
            return { success: false, message: 'Database required for fingerprint bans' };
        }

        try {
            // Get player's fingerprint
            const playerResult = await db.query(
                `SELECT username, fingerprint_hash, fingerprint_signals FROM players WHERE id = $1`,
                [playerId]
            );

            if (playerResult.rows.length === 0) {
                return { success: false, message: 'Player not found' };
            }

            const player = playerResult.rows[0];

            if (!player.fingerprint_hash) {
                return { success: false, message: 'Player has no fingerprint recorded' };
            }

            // Check if already banned
            const existingBan = await db.query(
                `SELECT id FROM banned_fingerprints WHERE fingerprint_hash = $1 AND is_active = TRUE`,
                [player.fingerprint_hash]
            );

            if (existingBan.rows.length > 0) {
                return { success: false, message: 'Fingerprint already banned' };
            }

            // Parse partial hashes from stored signals
            const partialHashes = typeof player.fingerprint_signals === 'string'
                ? JSON.parse(player.fingerprint_signals)
                : player.fingerprint_signals || {};

            // Insert into banned_fingerprints
            await db.query(
                `INSERT INTO banned_fingerprints
                 (fingerprint_hash, partial_hashes, banned_by, reason, original_account_id, original_username)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    player.fingerprint_hash,
                    JSON.stringify(partialHashes),
                    adminUsername,
                    reason,
                    playerId,
                    player.username
                ]
            );

            // Invalidate cache so banned player gets kicked on next check
            this.invalidateBanCache();

            return { success: true, fingerprintHash: player.fingerprint_hash };

        } catch (error) {
            console.error('Ban fingerprint error:', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Blocked words/patterns for usernames (case-insensitive)
     * Includes slurs, profanity, and offensive terms
     */
    static BLOCKED_USERNAME_PATTERNS = [
        // Racial slurs
        'nigger', 'nigga', 'n1gger', 'n1gga', 'chink', 'gook', 'spic', 'wetback', 'beaner',
        'kike', 'kyke', 'raghead', 'towelhead', 'coon', 'darkie', 'zipperhead', 'redskin',
        // Homophobic slurs
        'fag', 'faggot', 'f4g', 'f4ggot', 'dyke', 'd1ke', 'tranny',
        // Profanity
        'fuck', 'fuk', 'fck', 'shit', 'sh1t', 'cunt', 'c0ck',
        'pussy', 'bitch', 'b1tch', 'whore', 'slut', 'rape',
        // Nazi/hate symbols
        'nazi', 'n4zi', 'hitler', 'h1tler', 'kkk', 'aryan', 'whitepower', '1488',
        // Admin impersonation
        'admin', 'moderator', 'owner', 'developer', 'staff', 'official', 'system',
        // NPC names
        'baker', 'merchant', 'trapper', 'gardener', 'woodcutter'
    ];

    /**
     * Check if username contains blocked words/patterns
     * @param {string} username
     * @returns {boolean} true if username contains blocked content
     */
    containsBlockedWords(username) {
        const lowerName = username.toLowerCase();
        for (const pattern of AuthManager.BLOCKED_USERNAME_PATTERNS) {
            if (lowerName.includes(pattern)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Validate username format
     */
    validateUsername(username) {
        if (!username || typeof username !== 'string') return false;
        if (username.length < 3 || username.length > 20) return false;
        if (!/^[a-zA-Z0-9_]+$/.test(username)) return false;
        if (this.containsBlockedWords(username)) return false;
        return true;
    }

    /**
     * Validate password strength
     */
    validatePassword(password) {
        if (!password || typeof password !== 'string') return false;
        return password.length >= 8;
    }

    /**
     * Parse session duration string (e.g., "7d", "24h")
     */
    parseSessionDuration(duration) {
        const units = {
            'd': 24 * 60 * 60 * 1000,
            'h': 60 * 60 * 1000,
            'm': 60 * 1000
        };

        const match = duration.match(/^(\d+)([dhm])$/);
        if (!match) return 7 * 24 * 60 * 60 * 1000; // Default 7 days

        const [, num, unit] = match;
        return parseInt(num) * units[unit];
    }

    /**
     * Start periodic cleanup of expired sessions
     */
    startSessionCleanup() {
        setInterval(async () => {
            if (!this.useDatabase) {
                // Clean local sessions
                const now = new Date();
                for (const [token, session] of this.localSessions) {
                    if (now > session.expiresAt) {
                        this.localSessions.delete(token);
                    }
                }
            } else {
                // Clean database sessions
                try {
                    await db.query(
                        'DELETE FROM sessions WHERE expires_at < NOW()'
                    );
                } catch (error) {
                    console.error('Session cleanup error:', error);
                }
            }
        }, 60 * 60 * 1000); // Every hour
    }

    /**
     * Link a fingerprint to an account in fingerprint_sightings table
     * Called on successful login/register to track account associations
     */
    async linkFingerprintToAccount(fingerprintHash, accountId, username) {
        if (!this.useDatabase || !fingerprintHash || !accountId) return;

        try {
            await db.query(`
                UPDATE fingerprint_sightings
                SET associated_accounts = CASE
                        WHEN $2 = ANY(associated_accounts) THEN associated_accounts
                        ELSE array_append(COALESCE(associated_accounts, ARRAY[]::UUID[]), $2)
                    END,
                    associated_names = CASE
                        WHEN $3 = ANY(associated_names) THEN associated_names
                        ELSE array_append(COALESCE(associated_names, ARRAY[]::TEXT[]), $3)
                    END
                WHERE fingerprint_hash = $1
            `, [fingerprintHash, accountId, username]);
        } catch (err) {
            console.error('Link fingerprint to account failed:', err.message);
        }
    }
}

// Singleton instance
const authManager = new AuthManager();

module.exports = authManager;
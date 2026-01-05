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
        this.localPlayerData = new Map(); // playerId -> { inventory, position, chunk, health, hunger, factionId, home*, canChangeFaction }

        // Faction constants
        // CRITICAL SYNC POINT: Must match public/config.js FACTION_ZONES
        this.FACTIONS = {
            SOUTHGUARD: 1,
            NORTHMEN: 3
            // Note: Settlers (2) removed - only two factions now
        };

        this.FACTION_ZONES = {
            1: { name: 'Southguard', minZ: -50000, maxZ: 0 },
            3: { name: 'Northmen', minZ: 0, maxZ: 50000 }
        };

        // World bounds for neutral players
        this.WORLD_BOUNDS = {
            minZ: -50000,
            maxZ: 50000
        };

        // Configuration
        this.bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS) || 10;
        this.sessionDuration = this.parseSessionDuration(process.env.SESSION_DURATION || '7d');
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
                console.log('✓ AuthManager: Using PostgreSQL for authentication');
                // Auth tables are created by DatabaseManager.initializeSchema()
            } else {
                throw new Error('Database not connected');
            }
        } catch (error) {
            console.log('✓ AuthManager: Running in local mode (no database)');
            console.log('  Note: Player data will not persist between server restarts');
            this.useDatabase = false;
        }

        // Start session cleanup timer
        this.startSessionCleanup();
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

            console.log(`Local registration: ${username} -> ${playerId}`);
            return { success: true, playerId, token };
        }

        // PRODUCTION MODE: PostgreSQL with bcrypt
        try {
            // Check if username already exists (case-insensitive)
            const existingUser = await db.query(
                'SELECT id FROM players WHERE LOWER(username) = LOWER($1)',
                [username]
            );
            if (existingUser.rows.length > 0) {
                return { success: false, message: 'Username already taken' };
            }

            // Hash password
            const passwordHash = await bcrypt.hash(password, this.bcryptRounds);

            // Begin transaction
            await db.query('BEGIN');

            // Create player (store original case for display)
            const playerResult = await db.query(
                `INSERT INTO players (username, password_hash)
                 VALUES ($1, $2)
                 RETURNING id`,
                [username, passwordHash]
            );

            const playerId = playerResult.rows[0].id;

            // Create player_data entry
            await db.query(
                `INSERT INTO player_data (player_id) VALUES ($1)`,
                [playerId]
            );

            // Create session
            const expiresAt = new Date(Date.now() + this.sessionDuration);
            const sessionResult = await db.query(
                `INSERT INTO sessions (player_id, expires_at)
                 VALUES ($1, $2)
                 RETURNING token`,
                [playerId, expiresAt]
            );

            const token = sessionResult.rows[0].token;

            // Commit transaction
            await db.query('COMMIT');

            console.log(`Database registration: ${username} -> ${playerId}`);
            return { success: true, playerId, token };

        } catch (error) {
            await db.query('ROLLBACK');

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

            console.log(`Local login: ${displayUsername}`);
            return { success: true, playerId: user.playerId, token };
        }

        // PRODUCTION MODE
        try {
            // Get user (case-insensitive lookup, return original username for display)
            const userResult = await db.query(
                `SELECT id, username, password_hash FROM players WHERE LOWER(username) = LOWER($1)`,
                [username]
            );

            if (userResult.rows.length === 0) {
                return { success: false, message: 'Invalid username or password' };
            }

            const user = userResult.rows[0];
            const displayUsername = user.username; // Original case from DB

            // Verify password
            const validPassword = await bcrypt.compare(password, user.password_hash);
            if (!validPassword) {
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

            console.log(`Database login: ${displayUsername}`);
            return { success: true, playerId: user.id, token };

        } catch (error) {
            console.error('Login error:', error);
            return { success: false, message: 'Login failed' };
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

            return {
                valid: true,
                playerId: session.playerId,
                username: session.username
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

            return {
                valid: true,
                playerId: session.player_id,
                username: session.username
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
     * @param {object} data - { inventory, position, currentChunk, health, hunger, stats, factionId, home*, canChangeFaction }
     */
    async savePlayerData(playerId, data) {
        if (!playerId || playerId.startsWith('session_')) {
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
                    data.canChangeFaction !== undefined ? data.canChangeFaction : true,
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
     * Update a single field in player data (for simple flags like tasksPanelClosed)
     * @param {string} playerId
     * @param {string} field - Field name to update
     * @param {any} value - Value to set
     */
    async updatePlayerField(playerId, field, value) {
        if (!playerId || playerId.startsWith('session_')) {
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

    /**
     * Load player game data (includes spawn system fields)
     * @param {string} playerId
     * @returns {Promise<object|null>} Player data or null if not found
     */
    async loadPlayerData(playerId) {
        if (!playerId || playerId.startsWith('session_')) {
            return null;
        }

        if (!this.useDatabase) {
            // LOCAL MODE
            return this.localPlayerData.get(playerId) || null;
        }

        // PRODUCTION MODE
        try {
            const result = await db.query(
                `SELECT inventory, position, current_chunk, health, hunger, stats, updated_at,
                        faction_id, home_structure_id, home_position_x, home_position_z, can_change_faction
                 FROM player_data
                 WHERE player_id = $1`,
                [playerId]
            );

            if (result.rows.length === 0) {
                return null;
            }

            const data = result.rows[0];
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
                canChangeFaction: data.can_change_faction
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
        if (!playerId || playerId.startsWith('session_')) {
            return { success: false, message: 'Guests cannot set faction permanently' };
        }

        // Validate faction ID
        if (factionId !== null && ![1, 2, 3].includes(factionId)) {
            return { success: false, message: 'Invalid faction' };
        }

        if (!this.useDatabase) {
            // LOCAL MODE
            const data = this.localPlayerData.get(playerId) || {};
            data.factionId = factionId;
            this.localPlayerData.set(playerId, data);
            return { success: true };
        }

        // PRODUCTION MODE
        try {
            await db.query(
                'UPDATE player_data SET faction_id = $1, updated_at = NOW() WHERE player_id = $2',
                [factionId, playerId]
            );
            return { success: true };
        } catch (error) {
            console.error('Set faction error:', error);
            return { success: false, message: 'Failed to set faction' };
        }
    }

    /**
     * Change player's faction (with cooldown check, clears home and tent/house ownership)
     * @param {string} playerId
     * @param {number} newFactionId
     * @param {object} chunkManager - ChunkManager instance to clear structure ownership
     * @param {boolean} preserveOwnership - If true, don't clear home/ownership (player in target territory)
     */
    async changeFaction(playerId, newFactionId, chunkManager, preserveOwnership = false) {
        if (!playerId || playerId.startsWith('session_')) {
            return { success: false, message: 'Guests cannot change faction' };
        }

        // Validate faction ID
        if (newFactionId !== null && ![1, 2, 3].includes(newFactionId)) {
            return { success: false, message: 'Invalid faction' };
        }

        // Check cooldown
        const playerData = await this.loadPlayerData(playerId);
        if (playerData && playerData.canChangeFaction === false) {
            return { success: false, message: 'You can only change factions once per day' };
        }

        // Only clear ownership if not preserving (player not in target territory)
        if (!preserveOwnership && chunkManager) {
            await chunkManager.clearTentHouseOwnership(playerId);
        }

        if (!this.useDatabase) {
            // LOCAL MODE - change faction, conditionally clear home, set cooldown
            const data = this.localPlayerData.get(playerId) || {};
            data.factionId = newFactionId;
            if (!preserveOwnership) {
                data.homeStructureId = null;
                data.homePositionX = null;
                data.homePositionZ = null;
            }
            data.canChangeFaction = false;
            this.localPlayerData.set(playerId, data);
            console.log(`Local faction change: ${playerId} -> faction ${newFactionId}, preserved: ${preserveOwnership}`);
            return { success: true, preservedOwnership: preserveOwnership };
        }

        // PRODUCTION MODE
        try {
            if (preserveOwnership) {
                await db.query(
                    `UPDATE player_data
                     SET faction_id = $1,
                         can_change_faction = FALSE,
                         updated_at = NOW()
                     WHERE player_id = $2`,
                    [newFactionId, playerId]
                );
            } else {
                await db.query(
                    `UPDATE player_data
                     SET faction_id = $1,
                         home_structure_id = NULL,
                         home_position_x = NULL,
                         home_position_z = NULL,
                         can_change_faction = FALSE,
                         updated_at = NOW()
                     WHERE player_id = $2`,
                    [newFactionId, playerId]
                );
            }
            console.log(`Database faction change: ${playerId} -> faction ${newFactionId}, preserved: ${preserveOwnership}`);
            return { success: true, preservedOwnership: preserveOwnership };
        } catch (error) {
            console.error('Change faction error:', error);
            return { success: false, message: 'Failed to change faction' };
        }
    }

    /**
     * Reset faction change cooldown for all players (called at midnight UTC)
     */
    async resetDailyFactionCooldowns() {
        if (!this.useDatabase) {
            // LOCAL MODE
            for (const [playerId, data] of this.localPlayerData) {
                data.canChangeFaction = true;
            }
            console.log('Local faction cooldowns reset');
            return { success: true };
        }

        // PRODUCTION MODE
        try {
            const result = await db.query(
                'UPDATE player_data SET can_change_faction = TRUE WHERE can_change_faction = FALSE'
            );
            console.log(`Database faction cooldowns reset: ${result.rowCount} players`);
            return { success: true };
        } catch (error) {
            console.error('Reset faction cooldowns error:', error);
            return { success: false };
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
        if (!playerId || playerId.startsWith('session_')) {
            return { success: false, message: 'Guests cannot set home' };
        }

        if (!this.useDatabase) {
            // LOCAL MODE
            const data = this.localPlayerData.get(playerId) || {};
            data.homeStructureId = structureId;
            data.homePositionX = x;
            data.homePositionZ = z;
            this.localPlayerData.set(playerId, data);
            console.log(`Local home set: ${playerId} -> ${structureId} at (${x}, ${z})`);
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
            console.log(`Database home set: ${playerId} -> ${structureId} at (${x}, ${z})`);
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
        if (!playerId || playerId.startsWith('session_')) {
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
        if (!playerId || playerId.startsWith('session_')) {
            return { success: false, message: 'Guests cannot own houses' };
        }

        if (!this.useDatabase) {
            // LOCAL MODE
            const data = this.localPlayerData.get(playerId) || {};
            data.ownedHouseId = houseId;
            data.ownedHouseChunkId = chunkId;
            this.localPlayerData.set(playerId, data);
            console.log(`Local owned house set: ${playerId} -> ${houseId} in ${chunkId}`);
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
            console.log(`Database owned house set: ${playerId} -> ${houseId} in ${chunkId}`);
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
        if (!playerId || playerId.startsWith('session_')) {
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
}

// Singleton instance
const authManager = new AuthManager();

module.exports = authManager;
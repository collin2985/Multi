/**
 * ChunkManager.js
 * Handles chunk data persistence and caching - NO WebSocket logic
 *
 * Mode Detection (via DatabaseManager.isOnlineMode):
 * - Online mode (DATABASE_URL set): DB only, crash on failure, no JSON fallback
 * - Local mode (no DATABASE_URL): JSON files only, no DB attempts
 */

const fs = require('fs');
const path = require('path');
const { CONFIG } = require('./ServerConfig.js');
const db = require('./DatabaseManager');
const ChunkCoordinates = require('./ServerChunkCoords.js');

// Folder for chunk JSON files (local mode only)
const CHUNK_FOLDER = './public/chunks';

// File path for server state (local mode only)
const SERVER_STATE_FILE = './server-state.json';

class ChunkManager {
    static MAX_CACHE_SIZE = 2000;

    constructor(terrainSeed = 12345) {
        this.chunkCache = new Map();
        this.dirtyChunks = new Set();
        this.chunkAccessTimes = new Map();
        this.terrainSeed = terrainSeed;
        this.dbReady = false;
    }

    /**
     * Initialize storage based on mode
     * - Online mode: Connect to DB with retry, throw if fails
     * - Local mode: Use JSON files only
     */
    async initialize() {
        if (db.isOnlineMode) {
            // ONLINE MODE: Database required, no fallback
            await db.connectWithRetry(); // Throws if all retries fail
            this.dbReady = true;
            // Clear stale player data from previous server session
            await this._clearAllPlayersFromDatabase();
        } else {
            // LOCAL MODE: JSON files only, no database
            this.dbReady = false;

            // Ensure chunk folder exists for local mode
            if (!fs.existsSync(CHUNK_FOLDER)) {
                fs.mkdirSync(CHUNK_FOLDER, { recursive: true });
            }

            // Migrate existing chunks from old location (./public/) to new folder
            this._migrateOldChunks();

            // Clear stale player data from previous server session
            this._clearAllPlayersFromFiles();
        }
    }

    /**
     * Clear all players from database chunks on server startup
     * Prevents stale player IDs from causing P2P connection failures after restart
     * @private
     */
    async _clearAllPlayersFromDatabase() {
        try {
            const result = await db.query(`
                UPDATE chunks
                SET data = jsonb_set(data, '{players}', '[]'::jsonb)
                WHERE data->'players' IS NOT NULL
                  AND jsonb_array_length(data->'players') > 0
            `);
            // Silently clear stale players (no logging per project rules)
        } catch (error) {
            console.error('[ChunkStore] Error clearing stale players from database:', error.message);
        }
    }

    /**
     * Clear all players from JSON chunk files on server startup
     * Prevents stale player IDs from causing P2P connection failures after restart
     * @private
     */
    _clearAllPlayersFromFiles() {
        try {
            const chunkFiles = fs.readdirSync(CHUNK_FOLDER).filter(f => f.startsWith('chunk_') && f.endsWith('.JSON'));
            let clearedCount = 0;
            for (const file of chunkFiles) {
                const filePath = path.join(CHUNK_FOLDER, file);
                try {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    if (data.players && data.players.length > 0) {
                        data.players = [];
                        fs.writeFileSync(filePath, JSON.stringify(data));
                        clearedCount++;
                    }
                } catch (err) {
                    // Skip invalid files
                }
            }
            // Silently clear stale players (no logging per project rules)
        } catch (error) {
            console.error('[ChunkStore] Error clearing stale players from files:', error.message);
        }
    }

    /**
     * Migrate chunk files from old location (./public/) to new folder
     * @private
     */
    _migrateOldChunks() {
        try {
            const oldChunks = fs.readdirSync('./public').filter(f => f.startsWith('chunk_') && f.endsWith('.JSON'));
            if (oldChunks.length > 0) {
                for (const file of oldChunks) {
                    const oldPath = path.join('./public', file);
                    const newPath = path.join(CHUNK_FOLDER, file);
                    fs.renameSync(oldPath, newPath);
                }
            }
        } catch (error) {
            console.error('ChunkManager: Error migrating old chunks:', error.message);
        }
    }

    /**
     * Mark chunk as dirty for deferred save
     * @param {string} chunkId - Chunk identifier (e.g., "chunk_0,0")
     */
    async saveChunk(chunkId) {
        this.markDirty(chunkId);
    }

    /**
     * Save chunk immediately, bypassing dirty-flag system
     * @param {string} chunkId - Chunk identifier
     */
    async saveChunkImmediate(chunkId) {
        await this._writeChunkToStorage(chunkId);
        this.dirtyChunks.delete(chunkId);
    }

    /**
     * Flush all dirty chunks to storage
     * Called on a 5-second interval from server.js
     * @returns {Promise<number>} Number of chunks flushed
     */
    async flushDirtyChunks() {
        if (this.dirtyChunks.size === 0) return 0;

        const chunksToFlush = [...this.dirtyChunks];
        let flushed = 0;

        for (const chunkId of chunksToFlush) {
            try {
                await this._writeChunkToStorage(chunkId);
                this.dirtyChunks.delete(chunkId);
                flushed++;
            } catch (error) {
                // Leave in dirty set for retry on next cycle
                console.error(`Failed to flush chunk ${chunkId}:`, error.message);
            }
        }

        return flushed;
    }

    /**
     * Write chunk data to storage (called by flush cycle)
     * @private
     */
    async _writeChunkToStorage(chunkId) {
        if (!this.chunkCache.has(chunkId)) {
            return;
        }

        const chunkData = this.chunkCache.get(chunkId);

        if (this.dbReady) {
            // ONLINE MODE: Save to PostgreSQL, throw on error
            try {
                await db.query(
                    `INSERT INTO chunks (chunk_id, data, updated_at)
                     VALUES ($1, $2, NOW())
                     ON CONFLICT (chunk_id)
                     DO UPDATE SET data = $2, updated_at = NOW()`,
                    [chunkId, JSON.stringify(chunkData)]
                );
            } catch (error) {
                // Online mode: crash on DB error, no fallback
                console.error(`FATAL: Failed to save chunk ${chunkId} to database:`, error.message);
                throw error;
            }
        } else {
            // LOCAL MODE: Save to JSON file
            this._saveToFile(chunkId, chunkData);
        }
    }

    /**
     * Save chunk to JSON file (local mode only)
     * @private
     */
    _saveToFile(chunkId, chunkData) {
        try {
            const filePath = path.join(CHUNK_FOLDER, `${chunkId}.JSON`);
            fs.writeFileSync(filePath, JSON.stringify(chunkData, null, 2), 'utf8');
        } catch (error) {
            console.error(`Failed to save chunk ${chunkId} to file:`, error.message);
        }
    }

    /**
     * Load chunk data from storage or create empty chunk
     * - Online mode: DB only, throws on error
     * - Local mode: JSON files only
     * @param {string} chunkId - Chunk identifier
     * @returns {Promise<object>} - Chunk data
     */
    async loadChunk(chunkId) {
        // Check cache first
        if (this.chunkCache.has(chunkId)) {
            this.chunkAccessTimes.set(chunkId, Date.now());
            return this.chunkCache.get(chunkId);
        }

        let chunkData = null;

        if (this.dbReady) {
            // ONLINE MODE: Load from PostgreSQL only
            try {
                const result = await db.query(
                    'SELECT data FROM chunks WHERE chunk_id = $1',
                    [chunkId]
                );

                if (result.rows.length > 0) {
                    chunkData = result.rows[0].data;
                    this.chunkCache.set(chunkId, chunkData);
                    this.chunkAccessTimes.set(chunkId, Date.now());
                    return chunkData;
                }
                // Chunk not in DB - create empty (this is normal for new chunks)
            } catch (error) {
                // Online mode: crash on DB error, no fallback
                console.error(`FATAL: Failed to load chunk ${chunkId} from database:`, error.message);
                throw error;
            }
        } else {
            // LOCAL MODE: Load from JSON file
            chunkData = this._loadFromFile(chunkId);
            if (chunkData) {
                return chunkData;
            }
        }

        // Create empty chunk if not found
        const emptyChunkData = { players: [], objectChanges: [], seed: this.terrainSeed };
        this.chunkCache.set(chunkId, emptyChunkData);
        this.chunkAccessTimes.set(chunkId, Date.now());
        return emptyChunkData;
    }

    /**
     * Load chunk from JSON file (local mode only)
     * @private
     * @returns {object|null} - Chunk data or null if not found
     */
    _loadFromFile(chunkId) {
        try {
            const filePath = path.join(CHUNK_FOLDER, `${chunkId}.JSON`);
            const fileData = fs.readFileSync(filePath, 'utf8');
            const chunkData = JSON.parse(fileData);
            this.chunkCache.set(chunkId, chunkData);
            return chunkData;
        } catch (error) {
            // File doesn't exist, return null
            return null;
        }
    }

    /**
     * Get chunk data from cache (doesn't load from disk)
     * @param {string} chunkId
     * @returns {object|undefined}
     */
    getChunk(chunkId) {
        return this.chunkCache.get(chunkId);
    }

    /**
     * Get all cached chunk IDs
     * @returns {IterableIterator<string>}
     */
    getCachedChunkIds() {
        return this.chunkCache.keys();
    }

    /**
     * Get players in a grid of specified radius around a chunk
     * OPTIMIZED: Uses getChunk (cache only) instead of loadChunk to avoid disk I/O
     * @param {string} chunkId - Center chunk
     * @param {number} radius - Grid radius (0 = single chunk, 1 = 3x3, 2 = 5x5)
     * @returns {Array<{id: string, chunkId: string}>}
     */
    getPlayersInRadius(chunkId, radius) {
        const parsed = ChunkCoordinates.parseChunkIdSafe(chunkId);
        if (!parsed) {
            console.error(`[ChunkStore] Cannot get players for invalid chunk: ${chunkId}`);
            return [];
        }
        const { chunkX, chunkZ } = parsed;
        const players = [];

        for (let x = chunkX - radius; x <= chunkX + radius; x++) {
            for (let z = chunkZ - radius; z <= chunkZ + radius; z++) {
                const targetChunkId = `chunk_${x},${z}`;

                // Use getChunk (cache only) - if not in cache, no player is there
                const chunkData = this.getChunk(targetChunkId);

                if (chunkData && chunkData.players) {
                    chunkData.players.forEach(player => {
                        players.push({ id: player.id, chunkId: targetChunkId });
                    });
                }
            }
        }
        return players;
    }

    /**
     * Get players in proximity grid around a chunk (synced with client LOAD_RADIUS)
     * @param {string} chunkId - Center chunk
     * @returns {Array<{id: string, chunkId: string}>}
     */
    getPlayersInProximity(chunkId) {
        return this.getPlayersInRadius(chunkId, CONFIG.CHUNKS.LOAD_RADIUS);
    }

    /**
     * Get object changes for proximity grid around a chunk (synced with client LOAD_RADIUS)
     * @param {string} chunkId - Center chunk
     * @param {boolean} parallel - If true, load all chunks in parallel (use for initial spawn behind loading screen)
     * @returns {Promise<Array<object>>}
     */
    async getObjectChangesInProximity(chunkId, parallel = false) {
        const parsed = ChunkCoordinates.parseChunkIdSafe(chunkId);
        if (!parsed) {
            console.error(`[ChunkStore] Cannot get object changes for invalid chunk: ${chunkId}`);
            return [];
        }
        const { chunkX, chunkZ } = parsed;
        const objectChanges = [];
        const radius = CONFIG.CHUNKS.LOAD_RADIUS;

        // Build list of all chunk IDs to load
        const chunkIdsToLoad = [];
        for (let x = chunkX - radius; x <= chunkX + radius; x++) {
            for (let z = chunkZ - radius; z <= chunkZ + radius; z++) {
                chunkIdsToLoad.push(`chunk_${x},${z}`);
            }
        }

        let chunkResults;
        if (parallel) {
            // Batched parallel loading - limits concurrent DB connections
            const BATCH_SIZE = 5;
            chunkResults = [];
            for (let i = 0; i < chunkIdsToLoad.length; i += BATCH_SIZE) {
                const batch = chunkIdsToLoad.slice(i, i + BATCH_SIZE);
                const batchResults = await Promise.all(
                    batch.map(async (targetChunkId) => {
                        const targetChunkData = await this.loadChunk(targetChunkId);
                        return { chunkId: targetChunkId, data: targetChunkData };
                    })
                );
                chunkResults.push(...batchResults);
            }
        } else {
            // Sequential loading - smoother for in-game chunk border crossings
            chunkResults = [];
            for (const targetChunkId of chunkIdsToLoad) {
                const targetChunkData = await this.loadChunk(targetChunkId);
                chunkResults.push({ chunkId: targetChunkId, data: targetChunkData });
            }
        }

        // Process results
        for (const { chunkId: targetChunkId, data: targetChunkData } of chunkResults) {
            if (targetChunkData && targetChunkData.objectChanges) {
                targetChunkData.objectChanges.forEach(change => {
                    // Skip claimed mobile entities (being ridden/piloted by another player)
                    if (change.claimedBy) {
                        return;
                    }

                    // Initialize resources for logs if not present (backwards compatibility)
                    // IMPORTANT: Don't mutate cached object - create a copy with defaults
                    const modelType = change.name || change.objectType;
                    const isLog = modelType && (modelType === 'log' || modelType.endsWith('_log'));
                    const needsResourceInit = isLog && (change.totalResources == null || change.remainingResources == null);

                    objectChanges.push({
                        ...change,
                        chunkId: targetChunkId,
                        // Default logs to 5 resources (matches HARVEST_ORDER length)
                        totalResources: needsResourceInit ? 5 : change.totalResources,
                        remainingResources: needsResourceInit ? 5 : change.remainingResources
                    });
                });
            }
        }
        return objectChanges;
    }

    /**
     * Add a player to a chunk
     * @param {string} chunkId
     * @param {string} playerId
     */
    async addPlayerToChunk(chunkId, playerId) {
        const chunkData = await this.loadChunk(chunkId);
        const isPlayerInChunk = chunkData.players.some(p => p.id === playerId);
        if (!isPlayerInChunk) {
            chunkData.players.push({ id: playerId });
            await this.saveChunk(chunkId);
        }
    }

    /**
     * Remove a player from a chunk
     * @param {string} chunkId
     * @param {string} playerId
     */
    async removePlayerFromChunk(chunkId, playerId) {
        const chunkData = this.getChunk(chunkId);
        if (chunkData) {
            chunkData.players = chunkData.players.filter(p => p.id !== playerId);
            await this.saveChunk(chunkId);
        }
    }

    /**
     * Add an object change to a chunk
     * @param {string} chunkId
     * @param {object} change - Change data
     */
    async addObjectChange(chunkId, change) {
        const chunkData = await this.loadChunk(chunkId);
        const existingIndex = chunkData.objectChanges.findIndex(c => c.id === change.id);

        if (existingIndex !== -1) {
            chunkData.objectChanges[existingIndex] = change;
        } else {
            chunkData.objectChanges.push(change);
        }

        await this.saveChunk(chunkId);
    }

    /**
     * Find an object change by ID
     * @param {string} chunkId
     * @param {string} objectId
     * @returns {Promise<object|null>}
     */
    async findObjectChange(chunkId, objectId) {
        const chunkData = await this.loadChunk(chunkId);
        return chunkData.objectChanges.find(c => c.id === objectId && c.action === 'add') || null;
    }

    /**
     * Get all chunk file names from disk
     * @returns {Array<string>}
     */
    getAllChunkFiles() {
        try {
            return fs.readdirSync(CHUNK_FOLDER).filter(f => f.startsWith('chunk_') && f.endsWith('.JSON'));
        } catch (error) {
            // Folder doesn't exist yet
            return [];
        }
    }

    /**
     * Evict chunks from cache that are far from all players
     * Keeps chunks within LOAD_RADIUS of any active player
     * @param {Array<string>} activePlayerChunks - Array of chunk IDs where players currently are
     * @returns {number} - Number of chunks evicted
     */
    async evictDistantChunks(activePlayerChunks) {
        if (activePlayerChunks.length === 0) {
            // No players online - flush and evict everything to free memory
            let evictedCount = 0;
            for (const chunkId of [...this.chunkCache.keys()]) {
                if (this.dirtyChunks.has(chunkId)) {
                    try {
                        await this._writeChunkToStorage(chunkId);
                    } catch (error) {
                        console.error(`Failed to flush chunk ${chunkId} during zero-player eviction:`, error.message);
                    }
                    this.dirtyChunks.delete(chunkId);
                }
                this.chunkCache.delete(chunkId);
                this.chunkAccessTimes.delete(chunkId);
                evictedCount++;
            }
            return evictedCount;
        }

        const radius = CONFIG.CHUNKS.LOAD_RADIUS;
        const chunksToKeep = new Set();

        // Build set of all chunks that should be kept (near any player)
        for (const playerChunk of activePlayerChunks) {
            const parsed = ChunkCoordinates.parseChunkIdSafe(playerChunk);
            if (!parsed) continue; // Skip invalid chunk IDs
            const { chunkX, chunkZ } = parsed;

            for (let x = chunkX - radius; x <= chunkX + radius; x++) {
                for (let z = chunkZ - radius; z <= chunkZ + radius; z++) {
                    chunksToKeep.add(`chunk_${x},${z}`);
                }
            }
        }

        // Evict chunks not in the keep set (flush dirty ones first)
        let evictedCount = 0;
        for (const chunkId of [...this.chunkCache.keys()]) {
            if (!chunksToKeep.has(chunkId)) {
                if (this.dirtyChunks.has(chunkId)) {
                    try {
                        await this._writeChunkToStorage(chunkId);
                    } catch (error) {
                        console.error(`Failed to flush dirty chunk ${chunkId} before eviction:`, error.message);
                    }
                    this.dirtyChunks.delete(chunkId);
                }
                this.chunkCache.delete(chunkId);
                this.chunkAccessTimes.delete(chunkId);
                evictedCount++;
            }
        }

        // Also enforce max cache size via LRU
        await this._evictLRUChunks();

        return evictedCount;
    }

    /**
     * Evict least-recently-used chunks when cache exceeds MAX_CACHE_SIZE
     * @private
     */
    async _evictLRUChunks() {
        if (this.chunkCache.size <= ChunkManager.MAX_CACHE_SIZE) return 0;

        const excess = this.chunkCache.size - ChunkManager.MAX_CACHE_SIZE;

        // Sort by oldest access time
        const sorted = [...this.chunkAccessTimes.entries()]
            .sort((a, b) => a[1] - b[1]);

        let evicted = 0;
        for (const [chunkId] of sorted) {
            if (evicted >= excess) break;

            if (this.dirtyChunks.has(chunkId)) {
                try {
                    await this._writeChunkToStorage(chunkId);
                } catch (error) {
                    console.error(`Failed to flush chunk ${chunkId} during LRU eviction:`, error.message);
                }
                this.dirtyChunks.delete(chunkId);
            }

            this.chunkCache.delete(chunkId);
            this.chunkAccessTimes.delete(chunkId);
            evicted++;
        }

        return evicted;
    }

    /**
     * Get current cache size (for monitoring)
     * @returns {number}
     */
    getCacheSize() {
        return this.chunkCache.size;
    }

    markDirty(chunkId) {
        this.dirtyChunks.add(chunkId);
    }

    getDirtyCount() {
        return this.dirtyChunks.size;
    }

    /**
     * Clear ownership of a specific house by chunk and object ID
     * Used when player builds a new house (only one house allowed)
     * @param {string} chunkId - Chunk containing the house
     * @param {string} houseId - ID of the house to clear ownership
     * @returns {Promise<object|null>} - The house object (for broadcast) or null if not found
     */
    async clearHouseOwnershipById(chunkId, houseId) {
        const chunkData = await this.loadChunk(chunkId);
        const house = chunkData.objectChanges.find(o => o.id === houseId && o.name === 'house');

        if (house) {
            house.owner = null;
            await this.saveChunk(chunkId);
            return house;
        }

        return null;
    }

    /**
     * Load server state (tick only) from storage
     * - Online mode: DB only, throws on error
     * - Local mode: JSON file only
     * @returns {Promise<{tick: number}>}
     */
    async loadServerState() {
        if (this.dbReady) {
            // ONLINE MODE: Load from PostgreSQL only
            try {
                const result = await db.query('SELECT tick FROM server_state WHERE id = 1');
                if (result.rows.length > 0) {
                    const { tick } = result.rows[0];
                    return { tick: parseInt(tick) || 0 };
                }
                // No row exists yet, return defaults
                return { tick: 0 };
            } catch (error) {
                // Online mode: crash on DB error, no fallback
                console.error('FATAL: Failed to load server state from database:', error.message);
                throw error;
            }
        } else {
            // LOCAL MODE: Load from JSON file only
            try {
                if (fs.existsSync(SERVER_STATE_FILE)) {
                    const data = JSON.parse(fs.readFileSync(SERVER_STATE_FILE, 'utf8'));
                    return { tick: data.tick || 0 };
                }
            } catch (error) {
                console.error('ChunkManager: Failed to load server state from file:', error.message);
            }

            return { tick: 0 };
        }
    }

    /**
     * Save server tick to storage
     * - Online mode: DB only, throws on error (crashes server)
     * - Local mode: JSON file only
     * @param {number} tick - Current server tick
     */
    async saveServerState(tick) {
        if (this.dbReady) {
            // ONLINE MODE: Save to PostgreSQL, throw on error
            try {
                await db.query(
                    `INSERT INTO server_state (id, tick, updated_at)
                     VALUES (1, $1, NOW())
                     ON CONFLICT (id)
                     DO UPDATE SET tick = $1, updated_at = NOW()`,
                    [tick]
                );
            } catch (error) {
                // Online mode: crash on DB error, no fallback
                console.error('FATAL: Failed to save server tick to database:', error.message);
                throw error;
            }
        } else {
            // LOCAL MODE: Save to JSON file only
            this._saveServerStateToFile(tick);
        }
    }

    /**
     * Save server tick to JSON file (local mode only)
     * @private
     */
    _saveServerStateToFile(tick) {
        try {
            fs.writeFileSync(SERVER_STATE_FILE, JSON.stringify({ tick }, null, 2), 'utf8');
        } catch (error) {
            console.error('ChunkManager: Failed to save server tick to file:', error.message);
        }
    }
}

module.exports = ChunkManager;

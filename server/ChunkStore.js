/**
 * ChunkManager.js
 * Handles chunk data persistence and caching - NO WebSocket logic
 * Now uses PostgreSQL instead of JSON files
 */

const fs = require('fs');
const path = require('path');
const { CONFIG } = require('./ServerConfig.js');
const db = require('./DatabaseManager');
const ChunkCoordinates = require('./ServerChunkCoords.js');

// Folder for chunk JSON files (offline mode fallback)
const CHUNK_FOLDER = './public/chunks';

class ChunkManager {
    constructor(terrainSeed = 12345) {
        this.chunkCache = new Map();
        this.terrainSeed = terrainSeed;
        this.dbReady = false;
    }

    /**
     * Initialize database connection
     * Should be called before using the ChunkManager
     */
    async initialize() {
        // Ensure chunk folder exists
        if (!fs.existsSync(CHUNK_FOLDER)) {
            fs.mkdirSync(CHUNK_FOLDER, { recursive: true });
            console.log(`ChunkManager: Created chunk folder: ${CHUNK_FOLDER}`);
        }

        // Migrate existing chunks from old location (./public/) to new folder
        this._migrateOldChunks();

        try {
            await db.connect();
            this.dbReady = true;
            console.log('ChunkManager: Database ready');
        } catch (error) {
            console.error('ChunkManager: Database initialization failed, falling back to JSON files');
            this.dbReady = false;
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
                console.log(`ChunkManager: Migrating ${oldChunks.length} chunk files to ${CHUNK_FOLDER}`);
                for (const file of oldChunks) {
                    const oldPath = path.join('./public', file);
                    const newPath = path.join(CHUNK_FOLDER, file);
                    fs.renameSync(oldPath, newPath);
                }
                console.log('ChunkManager: Migration complete');
            }
        } catch (error) {
            console.error('ChunkManager: Error migrating old chunks:', error.message);
        }
    }

    /**
     * Save chunk data to database (or disk as fallback)
     * @param {string} chunkId - Chunk identifier (e.g., "chunk_0,0")
     */
    async saveChunk(chunkId) {
        if (!this.chunkCache.has(chunkId)) {
            return;
        }

        const chunkData = this.chunkCache.get(chunkId);

        if (this.dbReady) {
            // Save to PostgreSQL
            try {
                await db.query(
                    `INSERT INTO chunks (chunk_id, data, updated_at)
                     VALUES ($1, $2, NOW())
                     ON CONFLICT (chunk_id)
                     DO UPDATE SET data = $2, updated_at = NOW()`,
                    [chunkId, JSON.stringify(chunkData)]
                );
            } catch (error) {
                console.error(`Failed to save chunk ${chunkId} to database:`, error.message);
                // Fallback to file system on error
                this._saveToFile(chunkId, chunkData);
            }
        } else {
            // Fallback to JSON files if database not ready
            this._saveToFile(chunkId, chunkData);
        }
    }

    /**
     * Fallback method to save to JSON file
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
     * Load chunk data from database (or disk as fallback) or create empty chunk
     * @param {string} chunkId - Chunk identifier
     * @returns {Promise<object>} - Chunk data
     */
    async loadChunk(chunkId) {
        // Check cache first
        if (this.chunkCache.has(chunkId)) {
            return this.chunkCache.get(chunkId);
        }

        let chunkData = null;

        if (this.dbReady) {
            // Try loading from PostgreSQL
            try {
                const result = await db.query(
                    'SELECT data FROM chunks WHERE chunk_id = $1',
                    [chunkId]
                );

                if (result.rows.length > 0) {
                    chunkData = result.rows[0].data;
                    this.chunkCache.set(chunkId, chunkData);
                    return chunkData;
                }
            } catch (error) {
                console.error(`Failed to load chunk ${chunkId} from database:`, error.message);
                // Fall through to try file system
            }
        }

        // Try loading from file system (fallback or if database not ready)
        chunkData = this._loadFromFile(chunkId);
        if (chunkData) {
            return chunkData;
        }

        // Create empty chunk if not found anywhere
        console.log(`Chunk ${chunkId} has no saved data, creating empty state`);
        const emptyChunkData = { players: [], objectChanges: [], seed: this.terrainSeed };
        this.chunkCache.set(chunkId, emptyChunkData);
        return emptyChunkData;
    }

    /**
     * Fallback method to load from JSON file
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
     * Get players in proximity grid around a chunk (synced with client LOAD_RADIUS)
     * OPTIMIZED: Uses getChunk instead of loadChunk to avoid disk I/O for empty checks
     * @param {string} chunkId - Center chunk
     * @returns {Array<{id: string, chunkId: string}>}
     */
    getPlayersInProximity(chunkId) {
        const parsed = ChunkCoordinates.parseChunkIdSafe(chunkId);
        if (!parsed) {
            console.error(`[ChunkStore] Cannot get players for invalid chunk: ${chunkId}`);
            return [];
        }
        const { chunkX, chunkZ } = parsed;
        const players = [];
        const radius = CONFIG.CHUNKS.LOAD_RADIUS;

        // Check NxN grid based on config (e.g., radius=1 -> 3x3, radius=2 -> 5x5)
        for (let x = chunkX - radius; x <= chunkX + radius; x++) {
            for (let z = chunkZ - radius; z <= chunkZ + radius; z++) {
                const targetChunkId = `chunk_${x},${z}`;

                // CRITICAL FIX: Use getChunk (cache only) instead of loadChunk (disk/create)
                // If it's not in cache, no player is there, so we can skip it.
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
            // Parallel loading - faster for initial spawn behind loading screen
            chunkResults = await Promise.all(
                chunkIdsToLoad.map(async (targetChunkId) => {
                    const targetChunkData = await this.loadChunk(targetChunkId);
                    return { chunkId: targetChunkId, data: targetChunkData };
                })
            );
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
                    const modelType = change.name || change.objectType;
                    if (modelType && (modelType === 'log' || modelType.endsWith('_log')) &&
                        (change.totalResources == null || change.remainingResources == null)) {
                        change.totalResources = 1;
                        change.remainingResources = 1;
                    }
                    objectChanges.push({ ...change, chunkId: targetChunkId });
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
     * Clear ownership of all tents and houses for a player
     * Called when player changes faction
     * @param {string} ownerId - Player's account ID
     * @returns {Promise<number>} - Number of structures cleared
     */
    async clearTentHouseOwnership(ownerId) {
        let clearedCount = 0;
        const modifiedChunks = new Set();

        if (this.dbReady) {
            // Database mode - query all chunks and update
            try {
                const result = await db.query('SELECT chunk_id, data FROM chunks');

                for (const row of result.rows) {
                    const chunkData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
                    let modified = false;

                    if (chunkData.objectChanges) {
                        for (const obj of chunkData.objectChanges) {
                            if ((obj.name === 'tent' || obj.name === 'house') && obj.owner === ownerId) {
                                obj.owner = null;
                                clearedCount++;
                                modified = true;
                            }
                        }
                    }

                    if (modified) {
                        // Update cache
                        this.chunkCache.set(row.chunk_id, chunkData);
                        modifiedChunks.add(row.chunk_id);
                    }
                }

                // Save all modified chunks
                for (const chunkId of modifiedChunks) {
                    await this.saveChunk(chunkId);
                }
            } catch (error) {
                console.error('Error clearing tent/house ownership from database:', error);
            }
        } else {
            // Local mode - iterate through cache and files
            // First check cache
            for (const [chunkId, chunkData] of this.chunkCache) {
                if (chunkData.objectChanges) {
                    for (const obj of chunkData.objectChanges) {
                        if ((obj.name === 'tent' || obj.name === 'house') && obj.owner === ownerId) {
                            obj.owner = null;
                            clearedCount++;
                            modifiedChunks.add(chunkId);
                        }
                    }
                }
            }

            // Also check files not in cache
            const chunkFiles = this.getAllChunkFiles();
            for (const file of chunkFiles) {
                const chunkId = file.replace('.JSON', '');
                if (!this.chunkCache.has(chunkId)) {
                    const chunkData = await this.loadChunk(chunkId);
                    if (chunkData.objectChanges) {
                        for (const obj of chunkData.objectChanges) {
                            if ((obj.name === 'tent' || obj.name === 'house') && obj.owner === ownerId) {
                                obj.owner = null;
                                clearedCount++;
                                modifiedChunks.add(chunkId);
                            }
                        }
                    }
                }
            }

            // Save all modified chunks
            for (const chunkId of modifiedChunks) {
                await this.saveChunk(chunkId);
            }
        }

        console.log(`Cleared ownership of ${clearedCount} tent/house structures for player ${ownerId}`);
        return clearedCount;
    }

    /**
     * Evict chunks from cache that are far from all players
     * Keeps chunks within LOAD_RADIUS of any active player
     * @param {Array<string>} activePlayerChunks - Array of chunk IDs where players currently are
     * @returns {number} - Number of chunks evicted
     */
    evictDistantChunks(activePlayerChunks) {
        if (activePlayerChunks.length === 0) {
            // No players online - could evict everything, but keep cache for quick rejoin
            return 0;
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

        // Evict chunks not in the keep set
        let evictedCount = 0;
        for (const chunkId of this.chunkCache.keys()) {
            if (!chunksToKeep.has(chunkId)) {
                this.chunkCache.delete(chunkId);
                evictedCount++;
            }
        }

        if (evictedCount > 0) {
            console.log(`ChunkManager: Evicted ${evictedCount} distant chunks from cache (${this.chunkCache.size} remain)`);
        }

        return evictedCount;
    }

    /**
     * Get current cache size (for monitoring)
     * @returns {number}
     */
    getCacheSize() {
        return this.chunkCache.size;
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
            console.log(`Cleared ownership of house ${houseId} in ${chunkId}`);
            return house;
        }

        return null;
    }
}

module.exports = ChunkManager;

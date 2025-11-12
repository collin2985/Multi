/**
 * ChunkManager.js
 * Handles chunk data persistence and caching - NO WebSocket logic
 */

const fs = require('fs');
const { CONFIG } = require('./config.js');

class ChunkManager {
    constructor(terrainSeed = 12345) {
        this.chunkCache = new Map();
        this.terrainSeed = terrainSeed;
    }

    /**
     * Save chunk data to disk
     * @param {string} chunkId - Chunk identifier (e.g., "chunk_0,0")
     */
    saveChunk(chunkId) {
        if (this.chunkCache.has(chunkId)) {
            const filePath = `./public/${chunkId}.JSON`;
            const chunkData = this.chunkCache.get(chunkId);
            fs.writeFileSync(filePath, JSON.stringify(chunkData, null, 2), 'utf8');
            console.log(`Saved chunk: ${chunkId}`);
        }
    }

    /**
     * Load chunk data from disk or create empty chunk
     * @param {string} chunkId - Chunk identifier
     * @returns {object} - Chunk data
     */
    loadChunk(chunkId) {
        if (this.chunkCache.has(chunkId)) {
            return this.chunkCache.get(chunkId);
        }

        const filePath = `./public/${chunkId}.JSON`;

        try {
            const fileData = fs.readFileSync(filePath, 'utf8');
            const chunkData = JSON.parse(fileData);
            this.chunkCache.set(chunkId, chunkData);
            console.log(`Loaded chunk: ${chunkId}`);
            return chunkData;
        } catch (error) {
            // File doesn't exist = pristine chunk with no modifications
            console.log(`Chunk ${chunkId} has no saved data, creating empty state`);
            const emptyChunkData = { players: [], objectChanges: [], seed: this.terrainSeed };
            this.chunkCache.set(chunkId, emptyChunkData);
            return emptyChunkData;
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
     * @param {string} chunkId - Center chunk
     * @returns {Array<{id: string, chunkId: string}>}
     */
    getPlayersInProximity(chunkId) {
        const [chunkX, chunkZ] = chunkId.replace('chunk_', '').split(',').map(Number);
        const players = [];
        const radius = CONFIG.CHUNKS.LOAD_RADIUS;

        // Check NxN grid based on config (e.g., radius=1 -> 3x3, radius=2 -> 5x5)
        for (let x = chunkX - radius; x <= chunkX + radius; x++) {
            for (let z = chunkZ - radius; z <= chunkZ + radius; z++) {
                const targetChunkId = `chunk_${x},${z}`;
                const chunkData = this.loadChunk(targetChunkId);
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
     * @returns {Array<object>}
     */
    getObjectChangesInProximity(chunkId) {
        const [chunkX, chunkZ] = chunkId.replace('chunk_', '').split(',').map(Number);
        const objectChanges = [];
        const radius = CONFIG.CHUNKS.LOAD_RADIUS;

        for (let x = chunkX - radius; x <= chunkX + radius; x++) {
            for (let z = chunkZ - radius; z <= chunkZ + radius; z++) {
                const targetChunkId = `chunk_${x},${z}`;
                const targetChunkData = this.loadChunk(targetChunkId);
                if (targetChunkData && targetChunkData.objectChanges) {
                    targetChunkData.objectChanges.forEach(change => {
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
        }
        return objectChanges;
    }

    /**
     * Add a player to a chunk
     * @param {string} chunkId
     * @param {string} playerId
     */
    addPlayerToChunk(chunkId, playerId) {
        const chunkData = this.loadChunk(chunkId);
        const isPlayerInChunk = chunkData.players.some(p => p.id === playerId);
        if (!isPlayerInChunk) {
            chunkData.players.push({ id: playerId });
            this.saveChunk(chunkId);
            console.log(`Player ${playerId} added to chunk: ${chunkId}`);
        }
    }

    /**
     * Remove a player from a chunk
     * @param {string} chunkId
     * @param {string} playerId
     */
    removePlayerFromChunk(chunkId, playerId) {
        const chunkData = this.getChunk(chunkId);
        if (chunkData) {
            chunkData.players = chunkData.players.filter(p => p.id !== playerId);
            this.saveChunk(chunkId);
            console.log(`Player ${playerId} removed from chunk: ${chunkId}`);
        }
    }

    /**
     * Add an object change to a chunk
     * @param {string} chunkId
     * @param {object} change - Change data
     */
    addObjectChange(chunkId, change) {
        const chunkData = this.loadChunk(chunkId);
        const existingIndex = chunkData.objectChanges.findIndex(c => c.id === change.id);

        if (existingIndex !== -1) {
            chunkData.objectChanges[existingIndex] = change;
        } else {
            chunkData.objectChanges.push(change);
        }

        this.saveChunk(chunkId);
    }

    /**
     * Find an object change by ID
     * @param {string} chunkId
     * @param {string} objectId
     * @returns {object|null}
     */
    findObjectChange(chunkId, objectId) {
        const chunkData = this.loadChunk(chunkId);
        return chunkData.objectChanges.find(c => c.id === objectId && c.action === 'add') || null;
    }

    /**
     * Get all chunk file names from disk
     * @returns {Array<string>}
     */
    getAllChunkFiles() {
        return fs.readdirSync('./public').filter(f => f.startsWith('chunk_') && f.endsWith('.JSON'));
    }
}

module.exports = ChunkManager;

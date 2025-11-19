/**
 * AISpawnerSystem.js
 * Server-authoritative AI spawning system
 *
 * This system is the single source of truth for AI spawning.
 * It tracks spawner states (active, dead, cooldown) and sends
 * spawn commands to clients.
 */

const { SPAWNER_TYPES } = require('./SpawnerConfig');

class AISpawnerSystem {
    constructor(chunkManager, messageRouter, clients) {
        this.chunkManager = chunkManager;
        this.messageRouter = messageRouter;
        this.clients = clients; // Reference to connected clients

        // Runtime state: structureId -> { activeAI: [], deadUntil: timestamp }
        // This replaces client-side "deadTentAIs" set
        this.spawnerStates = new Map();

        // Track which structures have been processed this update cycle
        this.processedStructures = new Set();
    }

    /**
     * Main update loop - called from server game loop
     * Checks all active chunks for spawnable structures
     */
    update() {
        this.processedStructures.clear();

        // Get all chunks that have players in them
        const activeChunkIds = this.getActiveChunkIds();

        for (const chunkId of activeChunkIds) {
            const chunkData = this.chunkManager.getChunk(chunkId);
            if (!chunkData) continue;

            // Find structures in this chunk that match our config
            const structures = this.getStructuresInChunk(chunkData);

            for (const structure of structures) {
                // Avoid processing same structure multiple times
                if (this.processedStructures.has(structure.id)) continue;
                this.processedStructures.add(structure.id);

                const config = SPAWNER_TYPES[structure.name];
                if (!config) continue;

                this.processSpawner(structure, config, chunkId);
            }
        }
    }

    /**
     * Process a single spawner structure
     */
    processSpawner(structure, config, chunkId) {
        const state = this.getSpawnerState(structure.id);

        // CHECK: Is it permanently dead?
        if (state.deadUntil === -1) return;

        // CHECK: Is it on cooldown?
        if (state.deadUntil > 0 && state.deadUntil > Date.now()) return;

        // CHECK: Is AI already active?
        if (state.activeAI.length >= config.maxCount) return;

        // CHECK: Is a player in this chunk?
        // (Using chunk-based proximity - player in same chunk triggers spawn)
        const chunkData = this.chunkManager.getChunk(chunkId);
        if (!chunkData || !chunkData.players || chunkData.players.length === 0) return;

        // All conditions met - SPAWN IT!
        this.spawnAI(structure, config, chunkId, state);
    }

    /**
     * Spawn an AI for a structure
     */
    spawnAI(structure, config, chunkId, state) {
        const aiId = `ai_${structure.id}_${Date.now()}`;

        // Calculate spawn position (random offset from structure)
        const angle = Math.random() * Math.PI * 2;
        const distance = config.spawnOffset.min + Math.random() * (config.spawnOffset.max - config.spawnOffset.min);
        const spawnPosition = [
            structure.position[0] + Math.cos(angle) * distance,
            structure.position[1],
            structure.position[2] + Math.sin(angle) * distance
        ];

        // Mark as active so we don't double spawn
        state.activeAI.push(aiId);

        // Clear cooldown if it was on one
        if (state.deadUntil > 0) {
            state.deadUntil = 0;
        }

        // Broadcast spawn command to all clients in range
        this.messageRouter.broadcastTo3x3Grid(chunkId, {
            type: 'spawn_ai_command',
            payload: {
                aiId: aiId,
                aiType: config.aiType,
                spawnerId: structure.id,
                position: spawnPosition,
                aggro: config.aggro
            }
        });

        console.log(`[AISpawner] Spawned ${config.aiType} (${aiId}) at ${structure.name} ${structure.id}`);
    }

    /**
     * Handle AI death notification from client
     * @param {string} aiId - The AI that died
     * @param {string} spawnerId - The structure it belonged to
     */
    handleAIDeath(aiId, spawnerId) {
        const state = this.getSpawnerState(spawnerId);

        // Remove from active list
        state.activeAI = state.activeAI.filter(id => id !== aiId);

        // Find the structure type to get config
        const structureType = this.getStructureTypeById(spawnerId);
        if (!structureType) {
            console.warn(`[AISpawner] Unknown structure type for ${spawnerId}`);
            return;
        }

        const config = SPAWNER_TYPES[structureType];
        if (!config) return;

        // Set death/cooldown state
        if (config.respawnTime === -1) {
            state.deadUntil = -1; // Permadeath
            console.log(`[AISpawner] ${structureType} ${spawnerId} AI permanently dead`);
        } else {
            state.deadUntil = Date.now() + config.respawnTime;
            console.log(`[AISpawner] ${structureType} ${spawnerId} AI will respawn in ${config.respawnTime}ms`);
        }
    }

    /**
     * Get or create spawner state for a structure
     */
    getSpawnerState(structureId) {
        if (!this.spawnerStates.has(structureId)) {
            this.spawnerStates.set(structureId, {
                activeAI: [],
                deadUntil: 0 // 0 = ready, -1 = permadead, >0 = timestamp
            });
        }
        return this.spawnerStates.get(structureId);
    }

    /**
     * Get all chunk IDs that currently have players
     */
    getActiveChunkIds() {
        const activeChunks = new Set();

        for (const chunkId of this.chunkManager.getCachedChunkIds()) {
            const chunkData = this.chunkManager.getChunk(chunkId);
            if (chunkData && chunkData.players && chunkData.players.length > 0) {
                activeChunks.add(chunkId);
            }
        }

        return activeChunks;
    }

    /**
     * Get structures in a chunk that have spawner configs
     */
    getStructuresInChunk(chunkData) {
        const structures = [];

        if (!chunkData.objectChanges) return structures;

        for (const obj of chunkData.objectChanges) {
            if (obj.action === 'add' && SPAWNER_TYPES[obj.name]) {
                structures.push({
                    id: obj.id,
                    name: obj.name,
                    position: obj.position
                });
            }
        }

        return structures;
    }

    /**
     * Get structure type from its ID (e.g., "tent_123" -> "tent")
     */
    getStructureTypeById(structureId) {
        // Parse structure type from ID format: "type_uniqueId"
        const parts = structureId.split('_');
        if (parts.length >= 1) {
            return parts[0];
        }
        return null;
    }

    /**
     * Calculate distance between two positions [x, y, z]
     */
    getDistance(pos1, pos2) {
        const dx = pos1[0] - pos2[0];
        const dz = pos1[2] - pos2[2];
        return Math.sqrt(dx * dx + dz * dz);
    }

    /**
     * Get spawner states for persistence (if needed)
     */
    getStatesForSaving() {
        const states = {};
        for (const [id, state] of this.spawnerStates) {
            states[id] = {
                deadUntil: state.deadUntil
            };
        }
        return states;
    }

    /**
     * Load spawner states from persistence (if needed)
     */
    loadStates(states) {
        for (const [id, state] of Object.entries(states)) {
            this.spawnerStates.set(id, {
                activeAI: [],
                deadUntil: state.deadUntil
            });
        }
    }
}

module.exports = AISpawnerSystem;

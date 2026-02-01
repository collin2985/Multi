/**
 * BaseAIController - Abstract base class for AI entity controllers
 *
 * Provides shared infrastructure for:
 * - Authority management (P2P)
 * - Entity lifecycle (spawn, death, cleanup)
 * - State synchronization
 * - Interpolation
 *
 * Subclasses: BanditController, BrownBearController, DeerController
 */

export class BaseAIController {
    /**
     * @param {Object} config
     * @param {string} config.entityType - 'bandit' | 'deer' | 'brownbear'
     * @param {string} config.entityIdField - 'tentId' | 'chunkKey' | 'denId'
     * @param {string} config.messagePrefix - For P2P message types (e.g., 'bandit', 'brownbear')
     * @param {number} config.broadcastInterval - ms between state broadcasts (default: 1000)
     * @param {Object} [config.registry] - AIRegistry instance for cross-controller queries
     */
    constructor(config = {}) {
        this.entityType = config.entityType || 'unknown';
        this.entityIdField = config.entityIdField || 'id';
        this.messagePrefix = config.messagePrefix || this.entityType;
        this.broadcastInterval = config.broadcastInterval || 1000;
        this.registry = config.registry || null;

        // Core state
        this.entities = new Map();
        this.clientId = null;
        this.game = null;

        // Callbacks (set by GameInitializer)
        this.createVisual = null;
        this.destroyVisual = null;
        this.getTerrainHeight = null;
        this.getServerTick = null;
        this.broadcast = null;

        // Pending deaths queue (handles race condition: death message before model loads)
        this.pendingDeaths = new Map();

        // Chunk key cache - avoids creating 9 strings per call
        this._cachedChunkKeys = [];
        this._cachedChunkCenter = { x: null, z: null };
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    /**
     * Initialize with client ID and game reference
     * @param {string} clientId
     * @param {Object} game
     */
    init(clientId, game) {
        this.clientId = clientId;
        this.game = game;
    }

    // =========================================================================
    // AUTHORITY SYSTEM
    // =========================================================================

    /**
     * Check if this client is authority for an entity
     * @param {string} entityId
     * @returns {boolean}
     */
    isAuthority(entityId) {
        const entity = this.entities.get(entityId);
        return entity && entity.authorityId === this.clientId;
    }

    /**
     * Check if this client has an entity in its local Map
     * Used for kill processing when authority may be out of sync
     * @param {string} entityId
     * @returns {boolean}
     */
    hasEntity(entityId) {
        return this.entities.has(entityId);
    }

    /**
     * Calculate which client should be authority for an entity
     * @param {string} entityId
     * @param {Array<string>} [nearbyPlayerIds]
     * @returns {string} clientId that should be authority
     */
    _calculateAuthority(entityId, nearbyPlayerIds = []) {
        // Subclass should override with specific logic
        // Default: lowest clientId wins
        const candidates = [this.clientId, ...nearbyPlayerIds];
        candidates.sort();
        return candidates[0];
    }

    /**
     * Handle peer disconnect - transfer authority if needed
     * @param {string} peerId
     */
    onPeerDisconnected(peerId) {
        for (const [entityId, entity] of this.entities) {
            if (entity.authorityId === peerId) {
                // Recalculate authority
                entity.authorityId = this._calculateAuthority(entityId);
            }
        }
    }

    /**
     * Handle peer chunk change (for authority recalculation)
     * @param {string} peerId
     * @param {string} oldChunkKey
     * @param {string} newChunkKey
     */
    onPeerChunkChanged(peerId, oldChunkKey, newChunkKey) {
        // Subclass can override for chunk-specific authority logic
    }

    // =========================================================================
    // P2P MESSAGE HANDLERS (to be implemented by subclass)
    // =========================================================================

    /**
     * Handle spawn message from peer
     * @param {Object} data
     */
    handleSpawnMessage(data) {
        throw new Error(`${this.entityType}: handleSpawnMessage must be implemented by subclass`);
    }

    /**
     * Handle state update message from peer
     * @param {Object} data
     */
    handleStateMessage(data) {
        throw new Error(`${this.entityType}: handleStateMessage must be implemented by subclass`);
    }

    /**
     * Handle death message from peer
     * @param {Object} data
     */
    handleDeathMessage(data) {
        throw new Error(`${this.entityType}: handleDeathMessage must be implemented by subclass`);
    }

    /**
     * Handle despawn message from peer
     * @param {Object} data
     */
    handleDespawnMessage(data) {
        throw new Error(`${this.entityType}: handleDespawnMessage must be implemented by subclass`);
    }

    /**
     * Broadcast state for all entities we're authority over
     */
    broadcastAuthorityState() {
        throw new Error(`${this.entityType}: broadcastAuthorityState must be implemented by subclass`);
    }

    /**
     * Get all active entities for sync to new peer
     * @returns {Array<Object>}
     */
    getActiveEntitiesForSync() {
        throw new Error(`${this.entityType}: getActiveEntitiesForSync must be implemented by subclass`);
    }

    /**
     * Sync entities from peer
     * @param {Array<Object>} entityList
     */
    syncEntitiesFromPeer(entityList) {
        for (const data of entityList) {
            const entityId = data[this.entityIdField];
            if (!this.entities.has(entityId)) {
                this.handleSpawnMessage(data);
            }
        }
    }

    // =========================================================================
    // INTERPOLATION
    // =========================================================================

    /**
     * Interpolate entity position/rotation for smooth movement
     * @param {Object} entity
     * @param {number} deltaTime
     */
    _interpolateEntity(entity, deltaTime) {
        if (!entity.targetPosition) return;

        const lerpFactor = Math.min(1, deltaTime * 5);

        // Position interpolation
        entity.position.x += (entity.targetPosition.x - entity.position.x) * lerpFactor;
        entity.position.y += (entity.targetPosition.y - entity.position.y) * lerpFactor;
        entity.position.z += (entity.targetPosition.z - entity.position.z) * lerpFactor;

        // Rotation interpolation
        if (entity.targetRotation !== null && entity.targetRotation !== undefined) {
            let diff = entity.targetRotation - entity.rotation;
            // Handle wrap-around
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            entity.rotation += diff * lerpFactor;
        }

        // Update mesh if exists
        if (entity.mesh) {
            entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
            entity.mesh.rotation.y = entity.rotation;
        }
    }

    // =========================================================================
    // ENTITY LIFECYCLE
    // =========================================================================

    /**
     * Kill an entity
     * @param {string} entityId
     * @param {string} [killedBy]
     */
    killEntity(entityId, killedBy = null) {
        throw new Error(`${this.entityType}: killEntity must be implemented by subclass`);
    }

    /**
     * Destroy visual only but keep entity in map
     * @param {string} entityId
     */
    _destroyVisualOnly(entityId) {
        const entity = this.entities.get(entityId);
        if (!entity) return;

        if (entity.mesh && this.destroyVisual) {
            this.destroyVisual(entityId, entity.mesh);
        }

        entity.mesh = null;
        entity.mixer = null;
        entity.controller = null;
    }

    /**
     * Destroy entity completely (removes from map, allows respawn)
     * @param {string} entityId
     */
    _destroyEntity(entityId) {
        const entity = this.entities.get(entityId);
        if (!entity) return;

        if (entity.mesh && this.destroyVisual) {
            this.destroyVisual(entityId, entity.mesh);
        }

        this.entities.delete(entityId);
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    /**
     * Get 3x3 chunk keys around a center position (cached)
     * Returns cached array if center hasn't changed - avoids creating 9 strings per call
     * @param {number} centerX - chunk X coordinate
     * @param {number} centerZ - chunk Z coordinate
     * @returns {Array<string>}
     */
    _get3x3ChunkKeys(centerX, centerZ) {
        // Return cached if same chunk center
        if (this._cachedChunkCenter.x === centerX && this._cachedChunkCenter.z === centerZ) {
            return this._cachedChunkKeys;
        }

        // Rebuild cache - reuse array to avoid allocation
        this._cachedChunkKeys.length = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                this._cachedChunkKeys.push(`${centerX + dx},${centerZ + dz}`);
            }
        }
        this._cachedChunkCenter.x = centerX;
        this._cachedChunkCenter.z = centerZ;

        return this._cachedChunkKeys;
    }

    /**
     * Get entity by ID
     * @param {string} entityId
     * @returns {Object|null}
     */
    getEntity(entityId) {
        return this.entities.get(entityId) || null;
    }

    /**
     * Check if entity is alive
     * @param {string} entityId
     * @returns {boolean}
     */
    isAlive(entityId) {
        const entity = this.entities.get(entityId);
        return entity && !entity.isDead && entity.state !== 'dead';
    }

    /**
     * Count entities this client has authority over
     * @returns {number}
     */
    getAuthorityCount() {
        let count = 0;
        for (const entity of this.entities.values()) {
            if (entity.authorityId === this.clientId && entity.state !== 'dead') {
                count++;
            }
        }
        return count;
    }

    /**
     * Main update loop
     * @param {number} deltaTime
     * @param {number} chunkX - player's current chunk X
     * @param {number} chunkZ - player's current chunk Z
     */
    update(deltaTime, chunkX, chunkZ) {
        // Subclass implements specific update logic
        throw new Error(`${this.entityType}: update must be implemented by subclass`);
    }

    // =========================================================================
    // ABSTRACT METHODS (subclass MUST implement)
    // =========================================================================

    /**
     * Get spawn candidates for the current area
     * @param {number} chunkX
     * @param {number} chunkZ
     * @returns {Array} - Tents for bandits, chunks for bear/deer
     */
    _getSpawnCandidates(chunkX, chunkZ) {
        throw new Error(`${this.entityType}: _getSpawnCandidates must be implemented by subclass`);
    }

    /**
     * Check if should spawn at candidate location
     * @param {Object} candidate
     * @returns {boolean}
     */
    _shouldSpawn(candidate) {
        throw new Error(`${this.entityType}: _shouldSpawn must be implemented by subclass`);
    }

    /**
     * Create initial entity state object
     * @param {Object} candidate
     * @returns {Object}
     */
    _createEntityState(candidate) {
        throw new Error(`${this.entityType}: _createEntityState must be implemented by subclass`);
    }

    /**
     * Update entity when we're authority
     * @param {Object} entity
     * @param {number} deltaTime
     * @param {number} now
     * @param {Array} nearbyPlayers
     */
    _updateAuthorityEntity(entity, deltaTime, now, nearbyPlayers) {
        throw new Error(`${this.entityType}: _updateAuthorityEntity must be implemented by subclass`);
    }

    /**
     * Get extra data to include in state broadcasts
     * @param {Object} entity
     * @returns {Object}
     */
    _getExtraStateData(entity) {
        return {};
    }

    // =========================================================================
    // PENDING DEATHS QUEUE (race condition fix)
    // =========================================================================

    /**
     * Check and apply any pending deaths after model loads
     * @param {string} entityId
     */
    _checkPendingDeaths(entityId) {
        if (this.pendingDeaths.has(entityId)) {
            const deathData = this.pendingDeaths.get(entityId);
            this.pendingDeaths.delete(entityId);
            this._applyDeath(this.entities.get(entityId), deathData);
        }
    }

    /**
     * Apply death state to entity
     * @param {Object} entity
     * @param {Object} deathData
     */
    _applyDeath(entity, deathData) {
        // Subclass implements specific death application
        throw new Error(`${this.entityType}: _applyDeath must be implemented by subclass`);
    }
}

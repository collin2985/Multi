/**
 * AISpawnQueue.js
 * Spreads AI spawns across multiple frames to prevent stutter
 *
 * Problem: When multiple bandits/deer/bears spawn simultaneously, the game stutters
 * because SkeletonUtils.clone(), material creation, and physics setup are expensive.
 *
 * Solution: Queue spawn requests and process one per frame.
 *
 * Usage:
 *   const queue = getAISpawnQueue();
 *   queue.registerSpawnCallback('bandit', (data) => controller._executeBanditSpawn(data));
 *   queue.queueSpawn('bandit', { tent }, tent.id);
 *   // In game loop: queue.processQueue();
 */

// Priority order: higher priority entities spawn first
const SPAWN_PRIORITY = {
    bandit: 3,      // Highest - player threat
    militia: 3,     // Same as bandit - player-owned combat unit
    outpostMilitia: 3,
    artilleryMilitia: 3,
    brownbear: 2,   // Medium - environmental threat
    trapper: 1,     // Low - static NPC, non-threatening
    deer: 0,        // Lowest - ambient wildlife
};

class AISpawnQueue {
    constructor(options = {}) {
        // Configuration
        this.maxSpawnsPerFrame = options.maxSpawnsPerFrame || 1;
        this.frameDelay = options.frameDelay || 0; // Frames to skip between spawns

        // State
        this._framesSinceLastSpawn = 0;
        this._isProcessing = false;
        this._processedCount = 0;

        // Queue: array of { type, data, entityId, priority, queueTime }
        this._queue = [];

        // Track queued entity IDs to prevent duplicates
        // Map<type, Set<entityId>>
        this._queuedIds = new Map();

        // Spawn callbacks: Map<type, function>
        this._callbacks = new Map();
    }

    /**
     * Register a spawn callback for an entity type
     * @param {string} type - Entity type ('bandit', 'brownbear', 'deer')
     * @param {function} callback - Function to call with spawn data
     */
    registerSpawnCallback(type, callback) {
        this._callbacks.set(type, callback);
        if (!this._queuedIds.has(type)) {
            this._queuedIds.set(type, new Set());
        }
    }

    /**
     * Queue a spawn request
     * @param {string} type - Entity type
     * @param {object} data - Data to pass to spawn callback
     * @param {string} entityId - Unique ID for deduplication (e.g., tentId, denId)
     * @returns {boolean} - True if queued, false if already queued or no callback
     */
    queueSpawn(type, data, entityId) {
        // Check if callback registered
        if (!this._callbacks.has(type)) {
            console.warn(`[AISpawnQueue] No callback registered for type: ${type}`);
            return false;
        }

        // Check for duplicate
        const typeQueue = this._queuedIds.get(type);
        if (typeQueue && typeQueue.has(entityId)) {
            return false; // Already queued
        }

        // Add to queue via binary insert - O(log n) instead of O(n log n) sort
        const priority = SPAWN_PRIORITY[type] || 0;
        this._binaryInsert(this._queue, {
            type,
            data,
            entityId,
            priority,
            queueTime: Date.now(),
        });

        // Track as queued
        if (typeQueue) {
            typeQueue.add(entityId);
        }

        return true;
    }

    /**
     * Binary insert into sorted array - O(log n) vs O(n log n) for sort
     */
    _binaryInsert(arr, item) {
        let low = 0, high = arr.length;
        while (low < high) {
            const mid = (low + high) >>> 1;
            if (this._compare(item, arr[mid]) < 0) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }
        arr.splice(low, 0, item);
    }

    /**
     * Compare two queue items for sorting (higher priority first, older time first)
     */
    _compare(a, b) {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.queueTime - b.queueTime;
    }

    /**
     * Check if an entity is already queued
     * @param {string} type - Entity type
     * @param {string} entityId - Entity ID to check
     * @returns {boolean}
     */
    isQueued(type, entityId) {
        const typeQueue = this._queuedIds.get(type);
        return typeQueue ? typeQueue.has(entityId) : false;
    }

    /**
     * Process the spawn queue - call once per frame from game loop
     * @returns {number} - Number of spawns processed this frame
     */
    processQueue() {
        if (this._queue.length === 0) {
            this._isProcessing = false;
            return 0;
        }

        this._isProcessing = true;

        // Check frame delay
        if (this._frameDelay > 0) {
            this._framesSinceLastSpawn++;
            if (this._framesSinceLastSpawn <= this.frameDelay) {
                return 0;
            }
        }

        // Process up to maxSpawnsPerFrame
        let processed = 0;
        while (processed < this.maxSpawnsPerFrame && this._queue.length > 0) {
            const item = this._queue.shift();

            // Remove from queued tracking
            const typeQueue = this._queuedIds.get(item.type);
            if (typeQueue) {
                typeQueue.delete(item.entityId);
            }

            // Execute spawn callback
            const callback = this._callbacks.get(item.type);
            if (callback) {
                try {
                    callback(item.data);
                    processed++;
                    this._processedCount++;
                } catch (err) {
                    console.error(`[AISpawnQueue] Error spawning ${item.type}:`, err);
                }
            }
        }

        this._framesSinceLastSpawn = 0;
        return processed;
    }

    /**
     * Get queue statistics
     * @returns {object}
     */
    getStats() {
        const queued = {};
        let total = 0;

        for (const [type, ids] of this._queuedIds) {
            queued[type] = ids.size;
            total += ids.size;
        }
        queued.total = total;

        return {
            queued,
            processed: this._processedCount,
            isProcessing: this._isProcessing,
        };
    }

    /**
     * Clear all queued spawns (e.g., on disconnect)
     */
    clear() {
        this._queue = [];
        for (const typeQueue of this._queuedIds.values()) {
            typeQueue.clear();
        }
        this._isProcessing = false;
    }

    /**
     * Remove queued spawns for a specific entity
     * @param {string} type - Entity type
     * @param {string} entityId - Entity ID to remove
     */
    removeQueued(type, entityId) {
        const typeQueue = this._queuedIds.get(type);
        if (typeQueue) {
            typeQueue.delete(entityId);
        }

        // Remove from queue array
        const idx = this._queue.findIndex(
            item => item.type === type && item.entityId === entityId
        );
        if (idx !== -1) {
            this._queue.splice(idx, 1);
        }
    }
}

// Singleton instance
let _instance = null;

/**
 * Get the global AISpawnQueue instance
 * @param {object} options - Options for first initialization
 * @returns {AISpawnQueue}
 */
export function getAISpawnQueue(options) {
    if (!_instance) {
        _instance = new AISpawnQueue(options);
    }
    return _instance;
}

export { AISpawnQueue };

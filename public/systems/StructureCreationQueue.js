/**
 * StructureCreationQueue.js
 * Spreads structure creation across multiple frames to prevent stutter
 *
 * Problem: When bandit camps or many structures load simultaneously, the game stutters
 * because model cloning, material creation, and physics setup are expensive.
 *
 * Solution: Queue structure creation requests and process one per frame within a budget.
 *
 * Pattern: Based on AISpawnQueue.js with added frame budget timing.
 *
 * Usage:
 *   const queue = getStructureCreationQueue();
 *   queue.setCreateCallback((data, chunkKey) => factory.createObjectInScene(data, chunkKey));
 *   queue.queueStructure(data, chunkKey);
 *   // In game loop: queue.processQueue();
 */

import { CONFIG } from '../config.js';

// Priority order: higher priority structures are created first
const STRUCTURE_PRIORITY = {
    tent: 5,        // Highest - bandit camps are important
    outpost: 4,     // Player structures next
    house: 4,
    campfire: 3,
    market: 3,
    crate: 2,
    horse: 2,
    dock: 1,
    default: 0
};

class StructureCreationQueue {
    constructor(options = {}) {
        // Configuration from config.js with fallbacks
        this.frameBudgetMs = options.frameBudgetMs || CONFIG.LOD?.STRUCTURE_QUEUE_BUDGET_MS || 1.4;
        this.maxStructuresPerFrame = options.maxStructuresPerFrame || CONFIG.LOD?.STRUCTURE_QUEUE_MAX_PER_FRAME || 2;

        // State
        this._isProcessing = false;
        this._processedCount = 0;

        // Queue: array of { data, chunkKey, structureId, priority, queueTime }
        this._queue = [];

        // Track queued structure IDs to prevent duplicates
        this._queuedIds = new Set();

        // Callback for actual structure creation
        this._createCallback = null;
    }

    /**
     * Set the callback function for creating structures
     * @param {function} callback - Function(data, chunkKey) that creates the structure
     */
    setCreateCallback(callback) {
        this._createCallback = callback;
    }

    /**
     * Queue a structure for creation
     * @param {object} data - Structure data from server
     * @param {string} chunkKey - Chunk key (e.g., "0,0")
     * @returns {boolean} - True if queued, false if already queued or no callback
     */
    queueStructure(data, chunkKey) {
        if (!this._createCallback) {
            console.warn('[StructureCreationQueue] No create callback set');
            return false;
        }

        const structureId = data.id || data.objectId;
        if (!structureId) {
            console.warn('[StructureCreationQueue] Structure missing ID:', data);
            return false;
        }

        // Check for duplicate
        if (this._queuedIds.has(structureId)) {
            return false; // Already queued
        }

        // Determine priority based on structure type
        const structureType = data.name || data.objectType;
        const priority = STRUCTURE_PRIORITY[structureType] ?? STRUCTURE_PRIORITY.default;

        // Add to queue
        this._queue.push({
            data,
            chunkKey,
            structureId,
            priority,
            queueTime: Date.now()
        });

        // Track as queued
        this._queuedIds.add(structureId);

        // Sort by priority (highest first), then by queue time (oldest first)
        this._queue.sort((a, b) => {
            if (b.priority !== a.priority) {
                return b.priority - a.priority;
            }
            return a.queueTime - b.queueTime;
        });

        return true;
    }

    /**
     * Check if a structure is already queued
     * @param {string} structureId - Structure ID to check
     * @returns {boolean}
     */
    isQueued(structureId) {
        return this._queuedIds.has(structureId);
    }

    /**
     * Process the structure queue - call once per frame from game loop
     * Uses frame budget to limit work per frame
     * @returns {number} - Number of structures created this frame
     */
    processQueue() {
        if (this._queue.length === 0) {
            this._isProcessing = false;
            return 0;
        }

        this._isProcessing = true;
        const startTime = performance.now();
        let processed = 0;

        // Process structures within frame budget
        while (
            processed < this.maxStructuresPerFrame &&
            this._queue.length > 0 &&
            (performance.now() - startTime) < this.frameBudgetMs
        ) {
            const item = this._queue.shift();

            // Remove from queued tracking
            this._queuedIds.delete(item.structureId);

            // Execute creation callback
            if (this._createCallback) {
                try {
                    this._createCallback(item.data, item.chunkKey);
                    processed++;
                    this._processedCount++;
                } catch (err) {
                    console.error(`[StructureCreationQueue] Error creating structure:`, err);
                }
            }
        }

        return processed;
    }

    /**
     * Get queue statistics
     * @returns {object}
     */
    getStats() {
        return {
            queued: this._queue.length,
            processed: this._processedCount,
            isProcessing: this._isProcessing
        };
    }

    /**
     * Clear all queued structures (e.g., on disconnect)
     */
    clear() {
        this._queue = [];
        this._queuedIds.clear();
        this._isProcessing = false;
    }

    /**
     * Remove a specific structure from the queue
     * @param {string} structureId - Structure ID to remove
     */
    removeQueued(structureId) {
        this._queuedIds.delete(structureId);

        const idx = this._queue.findIndex(item => item.structureId === structureId);
        if (idx !== -1) {
            this._queue.splice(idx, 1);
        }
    }

    /**
     * Get the number of queued structures
     * @returns {number}
     */
    get length() {
        return this._queue.length;
    }
}

// Singleton instance
let _instance = null;

/**
 * Get the global StructureCreationQueue instance
 * @param {object} options - Options for first initialization
 * @returns {StructureCreationQueue}
 */
export function getStructureCreationQueue(options) {
    if (!_instance) {
        _instance = new StructureCreationQueue(options);
    }
    return _instance;
}

export { StructureCreationQueue };

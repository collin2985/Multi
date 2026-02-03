/**
 * ChunkTransitionQueue.js
 * Unified task queue for chunk border crossing operations.
 * Spreads expensive operations across multiple frames to prevent stuttering.
 */

import { ChunkPerfTimer } from '../core/PerformanceTimer.js';

export const PRIORITY = {
    CRITICAL: 0,
    HIGH: 1,
    NORMAL: 2,
    LOW: 3
};

export const TASK_TYPE = {
    SCENE_ADD: 'SCENE_ADD',
    SCENE_REMOVE: 'SCENE_REMOVE',
    NAV_MAP: 'NAV_MAP',
    PHYSICS: 'PHYSICS',
    AI_UPDATE: 'AI_UPDATE',
    PROXIMITY: 'PROXIMITY',
    CLEANUP: 'CLEANUP'
};

export class ChunkTransitionQueue {
    constructor() {
        this.queues = [[], [], [], []];
        this.FRAME_BUDGET_MS = 3.0;      // Higher normal budget for faster processing
        this.EMERGENCY_BUDGET_MS = 6;    // More budget when backlogged
        this.EMERGENCY_THRESHOLD = 800;  // Only trigger emergency for severe backlog

        this.TYPE_BUDGET_MS = {
            [TASK_TYPE.SCENE_ADD]: 2.5,   // Increased - scene.add is fast, let it process more
            [TASK_TYPE.SCENE_REMOVE]: 2.0,
            [TASK_TYPE.NAV_MAP]: 1.5,
            [TASK_TYPE.PHYSICS]: 1.5,
            [TASK_TYPE.AI_UPDATE]: 0.8,
            [TASK_TYPE.PROXIMITY]: 0.5,
            [TASK_TYPE.CLEANUP]: 0.5
        };

        this.frameTypeTime = new Map();
        this.pendingIds = new Set();

        // Counter for unique task IDs (prevents duplicate task collisions when re-entering chunks)
        this._taskIdCounter = 0;
    }

    /**
     * Get next unique ID for task naming
     * Ensures tasks for same chunk don't collide in pendingIds set
     */
    nextGeneration() {
        return ++this._taskIdCounter;
    }

    /**
     * Queue a task with priority
     * @param {string} type - Task type (TASK_TYPE enum)
     * @param {Function} task - Function to execute
     * @param {number} priority - Priority level (PRIORITY enum)
     * @param {string|null} id - Optional unique ID to prevent duplicates
     */
    queue(type, task, priority = PRIORITY.NORMAL, id = null) {
        priority = Math.max(0, Math.min(3, Math.floor(priority)));

        if (id !== null) {
            if (this.pendingIds.has(id)) return false;
            this.pendingIds.add(id);
        }

        this.queues[priority].push({
            type,
            task,
            id,
            queuedAt: performance.now()
        });

        return true;
    }

    /**
     * Queue a task with unique ID support
     * @param {number} generation - Used only for unique task ID, not for skipping
     */
    queueWithGeneration(type, task, priority, id, generation) {
        return this.queue(type, task, priority, id);
    }

    /**
     * Queue scene.add() operations with state validation
     * @param {number} generation - Used for unique task IDs only
     * @param {Function} isInRadiusFn - Validates chunk relevance at execution time
     */
    queueSceneAdds(scene, objects, priority, chunkKey, generation, isInRadiusFn) {
        if (!objects || objects.length === 0) return;

        const BATCH_SIZE = 80;

        for (let i = 0; i < objects.length; i += BATCH_SIZE) {
            const batch = objects.slice(i, i + BATCH_SIZE);
            const batchIndex = Math.floor(i / BATCH_SIZE);

            this.queue(
                TASK_TYPE.SCENE_ADD,
                () => {
                    // isInRadiusFn check validates relevance at execution time
                    for (const obj of batch) {
                        if (!obj || obj.userData?.addedToScene) continue;
                        if (isInRadiusFn && !isInRadiusFn(chunkKey)) continue;

                        scene.add(obj);
                        obj.userData.addedToScene = true;
                    }
                },
                priority,
                `scene_add_${chunkKey}_${generation}_${batchIndex}`
            );
        }
    }

    /**
     * Queue scene.remove() operations with state validation
     * @param {number} generation - Used for unique task IDs only
     * @param {Function} isInRadiusFn - Validates chunk relevance at execution time
     */
    queueSceneRemoves(scene, objects, priority, chunkKey, generation, isInRadiusFn) {
        if (!objects || objects.length === 0) return;

        const BATCH_SIZE = 100;

        for (let i = 0; i < objects.length; i += BATCH_SIZE) {
            const batch = objects.slice(i, i + BATCH_SIZE);
            const batchIndex = Math.floor(i / BATCH_SIZE);

            this.queue(
                TASK_TYPE.SCENE_REMOVE,
                () => {
                    // isInRadiusFn check validates relevance at execution time
                    for (const obj of batch) {
                        if (!obj || !obj.userData?.addedToScene) continue;
                        // Only remove if chunk is still outside radius
                        if (isInRadiusFn && isInRadiusFn(chunkKey)) continue;

                        scene.remove(obj);
                        obj.userData.addedToScene = false;
                    }
                },
                priority,
                `scene_remove_${chunkKey}_${generation}_${batchIndex}`
            );
        }
    }

    /**
     * Process queued tasks with frame budget
     * Call once per frame from game loop
     */
    processFrame() {
        const frameStart = performance.now();
        this.frameTypeTime.clear();

        const pending = this.getTotalPending();
        if (pending === 0) return { processed: 0, remaining: 0 };

        ChunkPerfTimer.start('TransitionQueue.processFrame');

        const isEmergency = pending > this.EMERGENCY_THRESHOLD;
        const budget = isEmergency ? this.EMERGENCY_BUDGET_MS : this.FRAME_BUDGET_MS;

        let processed = 0;

        for (let p = 0; p < this.queues.length; p++) {
            const queue = this.queues[p];

            while (queue.length > 0) {
                const elapsed = performance.now() - frameStart;
                if (elapsed >= budget) break;

                const item = queue[0];

                const typeTime = this.frameTypeTime.get(item.type) || 0;
                const typeBudget = this.TYPE_BUDGET_MS[item.type] || 1.0;
                if (typeTime >= typeBudget && queue.length > 1) {
                    queue.push(queue.shift());
                    continue;
                }

                queue.shift();

                if (item.id !== null) {
                    this.pendingIds.delete(item.id);
                }

                const taskStart = performance.now();

                try {
                    item.task();
                } catch (e) {
                    console.error(`[ChunkTransitionQueue] Task error (${item.type}):`, e);
                }

                const taskTime = performance.now() - taskStart;
                this.frameTypeTime.set(item.type, typeTime + taskTime);
                processed++;

                // Log slow individual tasks (> 0.5ms) with their type
                ChunkPerfTimer.log(`Queue.${item.type}`, taskTime);
            }

            if (performance.now() - frameStart >= budget) break;
        }

        ChunkPerfTimer.end('TransitionQueue.processFrame');
        return { processed, remaining: this.getTotalPending() };
    }

    getTotalPending() {
        return this.queues.reduce((sum, q) => sum + q.length, 0);
    }

    hasPendingWork() {
        return this.queues.some(q => q.length > 0);
    }

    /**
     * Clear all tasks for a specific chunk
     */
    clearChunk(chunkKey) {
        // Use delimiter matching to prevent false positives
        // e.g., clearing "0,0" should NOT match "10,0" or "100,0"
        const pattern = `_${chunkKey}_`;
        for (const queue of this.queues) {
            for (let i = queue.length - 1; i >= 0; i--) {
                if (queue[i].id && queue[i].id.includes(pattern)) {
                    this.pendingIds.delete(queue[i].id);
                    queue.splice(i, 1);
                }
            }
        }
    }

    /**
     * Clear all pending tasks
     */
    clear() {
        for (const queue of this.queues) {
            queue.length = 0;
        }
        this.pendingIds.clear();
    }
}

let instance = null;

export function getChunkTransitionQueue() {
    if (!instance) {
        instance = new ChunkTransitionQueue();
    }
    return instance;
}

export default ChunkTransitionQueue;

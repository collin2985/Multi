# Chunk Border Crossing Performance Implementation

## Overview

Spread expensive chunk transition operations across multiple frames using a unified task queue. Handles rapid back-and-forth crossing safely.

---

## File 1: Create `public/systems/ChunkTransitionQueue.js`

```javascript
/**
 * ChunkTransitionQueue.js
 * Unified task queue for chunk border crossing operations.
 * Spreads expensive operations across multiple frames to prevent stuttering.
 */

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
        this.FRAME_BUDGET_MS = 3.5;
        this.EMERGENCY_BUDGET_MS = 6;
        this.EMERGENCY_THRESHOLD = 100;
        
        this.TYPE_BUDGET_MS = {
            [TASK_TYPE.SCENE_ADD]: 1.5,
            [TASK_TYPE.SCENE_REMOVE]: 1.0,
            [TASK_TYPE.NAV_MAP]: 1.5,
            [TASK_TYPE.PHYSICS]: 1.0,
            [TASK_TYPE.AI_UPDATE]: 0.5,
            [TASK_TYPE.PROXIMITY]: 0.5,
            [TASK_TYPE.CLEANUP]: 0.5
        };
        
        this.frameTypeTime = new Map();
        this.pendingIds = new Set();
        
        // Generation tracking for invalidation
        this.currentGeneration = 0;
    }
    
    /**
     * Increment generation counter - call when player changes chunks
     * Returns new generation number for task validation
     */
    nextGeneration() {
        return ++this.currentGeneration;
    }
    
    getGeneration() {
        return this.currentGeneration;
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
     * Queue a task that validates generation before executing
     * Automatically skips if player moved again since queuing
     */
    queueWithGeneration(type, task, priority, id, generation) {
        return this.queue(type, () => {
            if (this.currentGeneration !== generation) return; // Stale, skip
            task();
        }, priority, id);
    }
    
    /**
     * Queue scene.add() operations with state validation
     */
    queueSceneAdds(scene, objects, priority, chunkKey, generation, isInRadiusFn) {
        if (!objects || objects.length === 0) return;
        
        const BATCH_SIZE = 8;
        
        for (let i = 0; i < objects.length; i += BATCH_SIZE) {
            const batch = objects.slice(i, i + BATCH_SIZE);
            const batchIndex = Math.floor(i / BATCH_SIZE);
            
            this.queue(
                TASK_TYPE.SCENE_ADD,
                () => {
                    // Validate generation
                    if (this.currentGeneration !== generation) return;
                    
                    for (const obj of batch) {
                        // Validate current state - chunk might have left radius
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
     */
    queueSceneRemoves(scene, objects, priority, chunkKey, generation, isInRadiusFn) {
        if (!objects || objects.length === 0) return;
        
        const BATCH_SIZE = 12;
        
        for (let i = 0; i < objects.length; i += BATCH_SIZE) {
            const batch = objects.slice(i, i + BATCH_SIZE);
            const batchIndex = Math.floor(i / BATCH_SIZE);
            
            this.queue(
                TASK_TYPE.SCENE_REMOVE,
                () => {
                    if (this.currentGeneration !== generation) return;
                    
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
        const budget = pending > this.EMERGENCY_THRESHOLD 
            ? this.EMERGENCY_BUDGET_MS 
            : this.FRAME_BUDGET_MS;
        
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
            }
            
            if (performance.now() - frameStart >= budget) break;
        }
        
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
        const pattern = new RegExp(`_${chunkKey.replace(',', ',')}(_|$)`);
        
        for (const queue of this.queues) {
            for (let i = queue.length - 1; i >= 0; i--) {
                if (queue[i].id && queue[i].id.includes(chunkKey)) {
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
```

---

## File 2: Modify `game.js`

### 2a. Add import at top of file

```javascript
import { getChunkTransitionQueue, PRIORITY, TASK_TYPE } from './systems/ChunkTransitionQueue.js';
```

### 2b. Add helper method to Game class

```javascript
/**
 * Check if a chunk is within physics radius of player
 */
isChunkInPhysicsRadius(chunkKey) {
    const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
    const playerChunkX = this.gameState.currentPlayerChunkX;
    const playerChunkZ = this.gameState.currentPlayerChunkZ;
    const radius = CONFIG.CHUNKS?.PHYSICS_RADIUS || 1;
    
    return Math.abs(chunkX - playerChunkX) <= radius && 
           Math.abs(chunkZ - playerChunkZ) <= radius;
}

/**
 * Queue physics collider creation for an object
 */
queuePhysicsColliderForObject(obj) {
    if (!this.physicsManager?.initialized) return;
    if (obj.userData?.physicsHandle) return;
    
    const modelType = obj.userData?.modelType;
    const dims = CONFIG.CONSTRUCTION?.GRID_DIMENSIONS?.[modelType];
    if (!dims) return;
    
    let shape, collisionGroup;
    
    if (dims.radius !== undefined) {
        shape = { type: 'cylinder', radius: dims.radius, height: dims.height || 1.0 };
        collisionGroup = COLLISION_GROUPS.NATURAL;
    } else if (dims.width !== undefined) {
        shape = { type: 'cuboid', width: dims.width, depth: dims.depth, height: dims.height || 1.0 };
        collisionGroup = (modelType === 'log' || modelType.endsWith('_log') || modelType === 'crate')
            ? COLLISION_GROUPS.PLACED
            : COLLISION_GROUPS.STRUCTURE;
    }
    
    if (shape) {
        this.physicsManager.queueCollider(
            obj.userData.objectId,
            shape,
            obj.position,
            obj.rotation?.y || 0,
            collisionGroup,
            obj
        );
        
        if (this.objectRegistry && obj.userData.objectId) {
            this.objectRegistry.set(obj.userData.objectId, obj);
        }
    }
}
```

### 2c. Modify `setupGameLoop()` - add at TOP of onUpdate callback

```javascript
setupGameLoop() {
    this.gameLoop.onUpdate((deltaTime, now) => {
        // === ADD THIS AT THE VERY TOP ===
        const transitionQueue = getChunkTransitionQueue();
        if (transitionQueue.hasPendingWork()) {
            transitionQueue.processFrame();
        }
        // === END ADDITION ===
        
        // Step physics simulation
        if (this.physicsManager && this.physicsManager.initialized) {
            // ... existing code continues ...
```

### 2d. Replace `runPeriodicChecks()` chunk change handling

Find the chunk change block in `runPeriodicChecks()` and replace:

```javascript
runPeriodicChecks(now) {
    if (now - this.gameState.lastChunkUpdateTime > CONFIG.GAME_LOOP.CHUNK_UPDATE_INTERVAL) {
        if (this.chunkManager.updatePlayerChunk(this.playerObject.position.x, this.playerObject.position.z)) {
            const queue = getChunkTransitionQueue();
            const generation = queue.nextGeneration(); // Invalidate stale tasks
            
            const { clientId, currentPlayerChunkX, currentPlayerChunkZ, lastChunkX, lastChunkZ } = this.gameState;
            
            // Network message - KEEP SYNCHRONOUS (critical)
            this.networkManager.sendMessage('chunk_update', {
                clientId,
                newChunkId: ChunkCoordinates.toChunkId(currentPlayerChunkX, currentPlayerChunkZ),
                lastChunkId: ChunkCoordinates.toChunkId(lastChunkX, lastChunkZ)
            });
            
            ui.updateStatus(`Player moved to chunk (${currentPlayerChunkX}, ${currentPlayerChunkZ})`);
            
            // Queue proximity check
            queue.queueWithGeneration(TASK_TYPE.PROXIMITY, () => {
                this.checkProximityToObjects();
            }, PRIORITY.HIGH, `proximity_${generation}`, generation);
            
            // Queue scene membership update
            queue.queueWithGeneration(TASK_TYPE.SCENE_ADD, () => {
                this.updateTreeSceneMembershipDeferred(
                    currentPlayerChunkX, currentPlayerChunkZ,
                    lastChunkX, lastChunkZ,
                    generation
                );
            }, PRIORITY.HIGH, `scene_membership_${generation}`, generation);
            
            // Queue nav map updates
            queue.queueWithGeneration(TASK_TYPE.NAV_MAP, () => {
                this.chunkManager?.updateNavMapsAroundPlayerDeferred(
                    currentPlayerChunkX, currentPlayerChunkZ,
                    lastChunkX, lastChunkZ,
                    generation
                );
            }, PRIORITY.NORMAL, `nav_maps_${generation}`, generation);
            
            // Queue AI updates
            if (this.banditController) {
                queue.queueWithGeneration(TASK_TYPE.AI_UPDATE, () => {
                    this.banditController.updateTentPresence(currentPlayerChunkX, currentPlayerChunkZ);
                }, PRIORITY.NORMAL, `bandit_presence_${generation}`, generation);
                
                queue.queueWithGeneration(TASK_TYPE.AI_UPDATE, () => {
                    const oldKey = `${lastChunkX},${lastChunkZ}`;
                    const newKey = `${currentPlayerChunkX},${currentPlayerChunkZ}`;
                    this.banditController.onPeerChunkChanged(this.gameState.clientId, oldKey, newKey);
                }, PRIORITY.LOW, `bandit_authority_${generation}`, generation);
            }
            
            if (this.brownBearController) {
                queue.queueWithGeneration(TASK_TYPE.AI_UPDATE, () => {
                    this.brownBearController.updateDenPresence(currentPlayerChunkX, currentPlayerChunkZ);
                }, PRIORITY.NORMAL, `bear_presence_${generation}`, generation);
            }
            
            if (this.trapperSystem) {
                queue.queueWithGeneration(TASK_TYPE.AI_UPDATE, () => {
                    this.trapperSystem.onPlayerChunkChanged(
                        currentPlayerChunkX, currentPlayerChunkZ,
                        lastChunkX, lastChunkZ
                    );
                }, PRIORITY.LOW, `trapper_${generation}`, generation);
            }
        }
        this.gameState.lastChunkUpdateTime = now;
    }
    
    // ... rest of method unchanged ...
}
```

### 2e. Replace `updateTreeSceneMembership()` with deferred version

```javascript
updateTreeSceneMembershipDeferred(currentChunkX, currentChunkZ, lastChunkX, lastChunkZ, generation) {
    const queue = getChunkTransitionQueue();
    const NATURAL_TYPES = ['oak', 'fir', 'pine', 'cypress', 'apple', 'vegetables', 
                          'limestone', 'sandstone', 'clay', 'iron',
                          'log', 'oak_log', 'pine_log', 'fir_log', 'cypress_log', 'apple_log'];
    const STRUCTURE_TYPES = ['tent', 'campfire', 'outpost', 'house', 'crate', 'garden', 
                            'market', 'dock', 'tileworks', 'ironworks', 'blacksmith', 
                            'bakery', 'gardener', 'miner', 'woodcutter', 'stonemason', 
                            'horse', 'cart', 'boat', 'ship', 'wall'];
    const physicsRadius = CONFIG.CHUNKS.PHYSICS_RADIUS;
    const chunkObjects = this.chunkManager?.chunkObjects;
    if (!chunkObjects) return;

    const oldPhysicsChunks = new Set();
    const newPhysicsChunks = new Set();
    
    for (let dx = -physicsRadius; dx <= physicsRadius; dx++) {
        for (let dz = -physicsRadius; dz <= physicsRadius; dz++) {
            oldPhysicsChunks.add(`${lastChunkX + dx},${lastChunkZ + dz}`);
            newPhysicsChunks.add(`${currentChunkX + dx},${currentChunkZ + dz}`);
        }
    }

    const isInRadius = (key) => this.isChunkInPhysicsRadius(key);

    // Chunks LEAVING physics radius
    for (const chunkKey of oldPhysicsChunks) {
        if (!newPhysicsChunks.has(chunkKey)) {
            const objects = chunkObjects.get(chunkKey);
            if (!objects) continue;
            
            const naturalsToRemove = objects.filter(obj => 
                obj.userData?.addedToScene && NATURAL_TYPES.includes(obj.userData.modelType)
            );
            
            const forColliderRemoval = objects.filter(obj => 
                obj.userData?.physicsHandle && 
                (NATURAL_TYPES.includes(obj.userData.modelType) || STRUCTURE_TYPES.includes(obj.userData.modelType))
            );
            
            if (naturalsToRemove.length > 0) {
                queue.queueSceneRemoves(this.scene, naturalsToRemove, PRIORITY.LOW, chunkKey, generation, isInRadius);
            }
            
            if (forColliderRemoval.length > 0) {
                queue.queueWithGeneration(TASK_TYPE.PHYSICS, () => {
                    if (isInRadius(chunkKey)) return; // Chunk came back into radius
                    for (const obj of forColliderRemoval) {
                        if (this.physicsManager && obj.userData.physicsHandle) {
                            this.physicsManager.removeCollider(obj.userData.objectId);
                            obj.userData.physicsHandle = null;
                        }
                    }
                }, PRIORITY.LOW, `collider_rm_${chunkKey}_${generation}`, generation);
            }
        }
    }

    // Chunks ENTERING physics radius
    for (const chunkKey of newPhysicsChunks) {
        if (!oldPhysicsChunks.has(chunkKey)) {
            const objects = chunkObjects.get(chunkKey);
            if (!objects) continue;
            
            const naturalsToAdd = objects.filter(obj => 
                !obj.userData?.addedToScene && NATURAL_TYPES.includes(obj.userData.modelType)
            );
            
            const forColliders = objects.filter(obj => 
                !obj.userData?.physicsHandle && 
                (NATURAL_TYPES.includes(obj.userData.modelType) || STRUCTURE_TYPES.includes(obj.userData.modelType))
            );
            
            if (naturalsToAdd.length > 0) {
                queue.queueSceneAdds(this.scene, naturalsToAdd, PRIORITY.HIGH, chunkKey, generation, isInRadius);
            }
            
            if (forColliders.length > 0) {
                queue.queueWithGeneration(TASK_TYPE.PHYSICS, () => {
                    if (!isInRadius(chunkKey)) return; // Chunk left radius
                    for (const obj of forColliders) {
                        this.queuePhysicsColliderForObject(obj);
                    }
                }, PRIORITY.NORMAL, `collider_add_${chunkKey}_${generation}`, generation);
            }
        }
    }
}
```

---

## File 3: Modify `ChunkManager.js`

### 3a. Add import at top

```javascript
import { getChunkTransitionQueue, PRIORITY, TASK_TYPE } from '../systems/ChunkTransitionQueue.js';
```

### 3b. Add deferred nav map update method

```javascript
/**
 * Update navigation maps with deferred processing
 */
updateNavMapsAroundPlayerDeferred(newChunkX, newChunkZ, oldChunkX, oldChunkZ, generation) {
    const queue = getChunkTransitionQueue();
    const physicsRadius = CONFIG.CHUNKS?.PHYSICS_RADIUS || 1;

    const oldNavChunks = new Set();
    const newNavChunks = new Set();

    for (let dx = -physicsRadius; dx <= physicsRadius; dx++) {
        for (let dz = -physicsRadius; dz <= physicsRadius; dz++) {
            oldNavChunks.add(`${oldChunkX + dx},${oldChunkZ + dz}`);
            newNavChunks.add(`${newChunkX + dx},${newChunkZ + dz}`);
        }
    }

    // Helper to check if chunk is currently in nav radius
    const isInNavRadius = (gx, gz) => {
        const playerChunkX = this.gameState.currentPlayerChunkX;
        const playerChunkZ = this.gameState.currentPlayerChunkZ;
        return Math.abs(gx - playerChunkX) <= physicsRadius && 
               Math.abs(gz - playerChunkZ) <= physicsRadius;
    };

    // Queue removals
    for (const chunkKey of oldNavChunks) {
        if (!newNavChunks.has(chunkKey)) {
            const [gx, gz] = chunkKey.split(',').map(Number);
            queue.queueWithGeneration(TASK_TYPE.NAV_MAP, () => {
                if (isInNavRadius(gx, gz)) return; // Came back into radius
                this.removeNavMapForChunk(gx, gz);
            }, PRIORITY.LOW, `nav_rm_${chunkKey}_${generation}`, generation);
        }
    }

    // Queue creations sorted by distance
    const chunksToCreate = [];
    for (const chunkKey of newNavChunks) {
        if (!oldNavChunks.has(chunkKey) && this.loadedChunks.has(chunkKey)) {
            const [gx, gz] = chunkKey.split(',').map(Number);
            const dist = Math.abs(gx - newChunkX) + Math.abs(gz - newChunkZ);
            chunksToCreate.push({ gx, gz, dist, key: chunkKey });
        }
    }
    
    chunksToCreate.sort((a, b) => a.dist - b.dist);
    
    for (const { gx, gz, key } of chunksToCreate) {
        queue.queueWithGeneration(TASK_TYPE.NAV_MAP, () => {
            if (!isInNavRadius(gx, gz)) return; // Left radius
            if (!this.loadedChunks.has(key)) return; // Chunk unloaded
            this.createNavMapForChunk(gx, gz);
        }, PRIORITY.NORMAL, `nav_add_${key}_${generation}`, generation);
    }
}
```

### 3c. Modify `disposeChunk()` - add at beginning

```javascript
disposeChunk(key) {
    // Clear any pending tasks for this chunk
    const queue = getChunkTransitionQueue();
    queue.clearChunk(key);
    
    // ... rest of existing disposeChunk code ...
}
```

---

## Testing

1. **Rapid crossing test**: Walk back and forth over a chunk border quickly
2. **Corner test**: Cross at a corner where 4 chunks change
3. **Fast movement**: Ride horse across multiple chunks quickly
4. **Check for orphaned objects**: Objects shouldn't appear/disappear incorrectly

## Expected Results

- Frame spikes reduced from 50-200ms to consistent ~16ms
- Work spread across 10-30 frames after chunk change
- No visual glitches from rapid back-and-forth movement

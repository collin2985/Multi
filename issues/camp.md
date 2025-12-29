# Bandit Camp Spawn Optimization & Structure LOD System

## Problem Summary

When a bandit camp spawns, the game experiences a significant stutter because **all structures are created synchronously in a single frame**. A bandit camp can have up to 7 structures (1 campfire + 3 tents + 2 outposts + 1 horse), and each one triggers expensive operations simultaneously:

### Expensive Operations Per Structure:
1. **Model cloning** via `objectPlacer.createInstance()`
2. **`SkeletonUtils.clone()`** for horses (very expensive for skinned meshes)
3. **`model.traverse()`** for material fixes and tinting
4. **Physics collider creation**
5. **Smoke effects** for campfires
6. **Multiple registry updates and proximity checks**

### Root Cause:
Unlike natural objects (trees, rocks) which use `ChunkObjectGenerator` with a **5ms frame budget**, structure creation has **no frame budgeting**. All structures spawn immediately when the server broadcasts `object_added`.

---

## Existing Code Reuse Analysis

Before implementing, leverage these existing patterns:

### Patterns to COPY directly:

| Pattern | Source File | Lines | Notes |
|---------|-------------|-------|-------|
| Singleton getter | `AISpawnQueue.js` | 1-20 | `getStructureCreationQueue()` pattern |
| Frame budget timing | `ChunkObjectGenerator.js` | ~100 | `performance.now()` budget checks |
| Priority sorting | `AISpawnQueue.js` | 50-70 | Sort by priority desc, then queueTime asc |
| Deduplication Set | `AISpawnQueue.js` | 25-30 | `_queuedIds = new Set()` |
| Chunk spatial partitioning | `RockModelSystem.js` | 386-420 | `structuresByChunk` Map pattern |
| Skip thresholds (hysteresis) | `RockModelSystem.js` | 421-433 | 70%-130% buffers reduce thrashing |
| Distance-based opacity | `RockModelSystem.js` | 450-473 | Squared distance + fade interpolation |

### Patterns to SIMPLIFY (don't copy):

| Pattern | Why Not | Alternative |
|---------|---------|-------------|
| Shader injection (`RockModelSystem`) | Structures aren't InstancedMesh | Direct `material.opacity` |
| InstancedBufferAttribute | Not instanced | Simple material traversal |
| DRACO loader setup | Already loaded normally | N/A |

### Integration Points (from analysis):

| Location | Line | Purpose |
|----------|------|---------|
| `GameInitializer.js` | ~84 | After `rockModelSystem` init - initialize `structureModelSystem` |
| `game.js` | ~2308 | After `getAISpawnQueue().processQueue()` - add queue processing |
| `game.js` | ~2593 | After `billboardSystem.updateBillboards()` - add structure LOD update |
| `MessageRouter.js` | ~633 | `handleObjectAdded()` - intercept for queue |
| `SceneObjectFactory.js` | ~461 | After userData.objectId is set - register with LOD systems |

---

## Solution Overview

Two-part fix:
1. **Structure Creation Queue** - Spread structure creation across multiple frames (like AI spawning)
2. **Structure Billboard LOD** - Render distant structures as billboards (like rocks do)

---

## Part 1: Structure Creation Queue

### New File: `public/systems/StructureCreationQueue.js`

**Note**: This follows the `AISpawnQueue.js` pattern almost exactly. Key differences:
- Uses frame budget (ms) in addition to count limit
- Calls `SceneObjectFactory.createObjectInScene()` instead of callbacks

```javascript
/**
 * StructureCreationQueue.js
 *
 * Spreads structure creation across frames to prevent stutters when
 * multiple structures spawn simultaneously (e.g., bandit camps).
 *
 * Pattern copied from: AISpawnQueue.js
 * Frame budget pattern from: ChunkObjectGenerator.js
 */

// Priority order: higher priority structures create first
const STRUCTURE_PRIORITY = {
    tent: 3,        // Highest - player can interact
    campfire: 3,    // High - has smoke effects
    house: 3,       // High - player shelter
    outpost: 2,     // Medium - climbable
    horse: 2,       // Medium - animated model
    crate: 1,       // Lower - storage
    garden: 1,      // Lower - production
    market: 1,      // Lower - trading
    bearden: 1,     // Lower - AI spawn point
    deertree: 0,    // Lowest - ambient
};

export class StructureCreationQueue {
    constructor(options = {}) {
        // Configuration
        this.maxCreationsPerFrame = options.maxCreationsPerFrame || 1;
        this.frameBudgetMs = options.frameBudgetMs || 4; // Max ms per frame

        // State
        this._queue = [];
        this._queuedIds = new Set();
        this._isProcessing = false;

        // Reference to SceneObjectFactory (set via setFactory)
        this._factory = null;

        // Stats for debugging
        this._stats = {
            totalQueued: 0,
            totalCreated: 0,
            maxQueueSize: 0,
        };
    }

    /**
     * Set the SceneObjectFactory reference
     * @param {SceneObjectFactory} factory
     */
    setFactory(factory) {
        this._factory = factory;
    }

    /**
     * Queue a structure for creation
     * @param {object} data - Structure data from object_added payload
     * @param {string} chunkKey - Chunk key for the structure
     * @returns {boolean} - True if queued, false if already queued
     */
    queueStructure(data, chunkKey) {
        const objectId = data.id || data.objectId;

        // Warn if factory not set (pattern from AISpawnQueue callback check)
        if (!this._factory) {
            console.warn('[StructureCreationQueue] Factory not set - queue will process once set');
        }

        // Skip if already queued
        if (this._queuedIds.has(objectId)) {
            return false;
        }

        const structureType = data.name || data.objectType;
        const priority = STRUCTURE_PRIORITY[structureType] || 0;

        this._queue.push({
            data,
            chunkKey,
            objectId,
            priority,
            queueTime: performance.now(),
        });

        this._queuedIds.add(objectId);
        this._stats.totalQueued++;
        this._stats.maxQueueSize = Math.max(this._stats.maxQueueSize, this._queue.length);

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
     * Check if a structure is queued
     * @param {string} objectId
     * @returns {boolean}
     */
    isQueued(objectId) {
        return this._queuedIds.has(objectId);
    }

    /**
     * Process queued structures within frame budget
     * Call this from the game loop
     * @returns {number} - Number of structures created this frame
     */
    processQueue() {
        if (this._queue.length === 0 || !this._factory) {
            return 0;
        }

        const startTime = performance.now();
        let created = 0;

        while (this._queue.length > 0) {
            // Check frame budget
            if (performance.now() - startTime >= this.frameBudgetMs) {
                break;
            }

            // Check max per frame
            if (created >= this.maxCreationsPerFrame) {
                break;
            }

            const item = this._queue.shift();
            this._queuedIds.delete(item.objectId);

            // Create the structure
            try {
                const result = this._factory.createObjectInScene(item.data, item.chunkKey);
                if (result) {
                    created++;
                    this._stats.totalCreated++;
                }
            } catch (error) {
                console.error(`[StructureCreationQueue] Failed to create ${item.objectId}:`, error);
            }
        }

        return created;
    }

    /**
     * Get queue length
     * @returns {number}
     */
    get length() {
        return this._queue.length;
    }

    /**
     * Get debug stats
     * @returns {object}
     */
    getStats() {
        return {
            ...this._stats,
            currentQueueSize: this._queue.length,
        };
    }

    /**
     * Clear the queue (e.g., on disconnect)
     */
    clear() {
        this._queue = [];
        this._queuedIds.clear();
    }
}

// Singleton instance (pattern from AISpawnQueue.js)
let _instance = null;

export function getStructureCreationQueue() {
    if (!_instance) {
        _instance = new StructureCreationQueue();
    }
    return _instance;
}

// Named export for direct class access (pattern from AISpawnQueue.js)
export { StructureCreationQueue };
```

### Integration Changes

#### In `MessageRouter.js` (around line 633):

```javascript
import { getStructureCreationQueue } from '../systems/StructureCreationQueue.js';

// In constructor:
this.structureCreationQueue = getStructureCreationQueue();
this.structureCreationQueue.setFactory(this.sceneObjectFactory);

// Structure types that should be queued (others create immediately)
const QUEUED_STRUCTURE_TYPES = new Set([
    'tent', 'campfire', 'outpost', 'horse', 'house',
    'crate', 'garden', 'market', 'bearden', 'deertree'
]);

// In handleObjectAdded():
handleObjectAdded(payload) {
    const { objectId, objectType } = payload;

    // Check if object already exists (fast registry lookup)
    const existingObject = this.findObjectById(objectId);
    if (existingObject && existingObject.parent) {
        // Update existing - handle immediately (no expensive creation)
        // ... existing update code ...
        return;
    }

    // NEW: Queue structure creation for expensive types
    const structureType = payload.objectType || payload.name;
    if (QUEUED_STRUCTURE_TYPES.has(structureType)) {
        // Build chunkKey - NOTE: worldToChunkKey() doesn't exist, use worldToChunk() instead
        let chunkKey = payload.chunkId?.replace('chunk_', '');
        if (!chunkKey) {
            const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(payload.position[0], payload.position[2]);
            chunkKey = `${chunkX},${chunkZ}`;
        }

        this.structureCreationQueue.queueStructure(payload, chunkKey);
        return; // Don't create immediately
    }

    // Non-queued types: create immediately (logs, roads, etc.)
    // ... existing immediate creation code ...
}
```

#### In `Game.js` update loop (after line ~2308, right after AISpawnQueue):

```javascript
// Existing code at line ~2308:
getAISpawnQueue().processQueue();

// ADD THIS RIGHT AFTER:
// Process structure creation queue (spreads expensive work across frames)
if (this.messageRouter?.structureCreationQueue) {
    this.messageRouter.structureCreationQueue.processQueue();
}
```

---

## Part 2: Structure Billboard LOD System

### Overview

Add billboards for distant structures using the existing `BillboardSystem` pattern. When structures are far from the player, render them as simple billboards. When close, use the full 3D model.

**LOD Distances (further than rocks since structures are larger):**
- 0-40: Full 3D model (opacity 1)
- 40-60: Transition zone (fade 3D out, fade billboard in)
- 60+: Billboard only

### Files You Need

Ensure these PNG/WebP files exist in `/models/`:
- `tent.png` or `tent.webp`
- `outpost.png` or `outpost.webp`
- `campfire.png` or `campfire.webp`
- `horse.png` or `horse.webp`

### Changes to `BillboardSystem.js` (~40 lines total)

#### Change 1: Add structure types to array (line ~23):

```javascript
// In constructor, update treeTypes array:
this.treeTypes = [
    // Trees
    'oak', 'fir', 'pine', 'cypress', 'apple', 'vegetables', 'deertree',
    // Rocks
    'limestone', 'sandstone', 'clay', 'iron',
    // Structures (NEW - 4 types)
    'tent', 'outpost', 'campfire', 'horse'
];
```

#### Change 2: Add to billboardConfig (lines ~26-39):

```javascript
// Add to billboardConfig after existing entries:
// Structure billboards (NEW)
tent: {
    width: 4.0, height: 3.5, yOffset: 0,
    brightness: 0.85, colorR: 1.0, colorG: 1.0, colorB: 1.0
},
outpost: {
    width: 2.0, height: 5.0, yOffset: 0,
    brightness: 0.9, colorR: 1.0, colorG: 1.0, colorB: 1.0
},
campfire: {
    width: 2.5, height: 2.0, yOffset: -0.3,
    brightness: 1.1, colorR: 1.0, colorG: 0.95, colorB: 0.9
},
horse: {
    width: 3.0, height: 2.5, yOffset: -0.2,
    brightness: 0.85, colorR: 1.0, colorG: 1.0, colorB: 1.0
},
```

#### Change 3: Update texture paths in `initializeShaderMaterials()` (line ~198):

```javascript
// Add after rock texture path logic:
else if (['tent', 'outpost', 'campfire', 'horse'].includes(treeType)) {
    texturePath = `./models/${treeType}.png`;
}
```

#### Change 4: Add structure LOD thresholds in `updateBillboards()` (line ~406):

```javascript
// Add after existing threshold definitions:
// Structure LOD thresholds (further than rocks)
const struct40Sq = 40 * 40;  // Structures start fade
const struct60Sq = 60 * 60;  // Structures fully billboard
const structSkipNearSq = struct40Sq * 0.7;  // Skip threshold
const structSkipFarSq = struct60Sq * 1.3;   // Skip threshold

// Add structure type set for LOD profile selection
const structureTypes = new Set(['tent', 'outpost', 'campfire', 'horse']);
```

#### Change 5: COMPLETE REFACTOR of opacity calculation (lines 459-508)

The current code has `distSq` calculated INSIDE the `else` block, which prevents adding structure support cleanly. Here's the complete replacement for lines 459-508:

```javascript
                const currentOpacity = opacityArray[index];
                let opacity = 0;

                // MOVED: Calculate distance FIRST (was inside else block before)
                const distX = position.x - camX;
                const distZ = position.z - camZ;
                const distSq = distX * distX + distZ * distZ;

                if (this.debugMode) {
                    opacity = 1;
                } else if (treeType === 'vegetables' || treeType === 'deertree') {
                    // Vegetables and deer spawn trees are always visible (no LOD)
                    opacity = 1;
                } else if (this.alwaysShowPineApple && (treeType === 'pine' || treeType === 'apple')) {
                    // TEMPORARY: Keep pine and apple billboards always visible for testing
                    opacity = 1;
                } else {
                    // Determine which LOD profile to use
                    const isStructure = structureTypes.has(treeType);
                    const uses3DModel = treeType === 'limestone' || treeType === 'sandstone' || treeType === 'clay' || treeType === 'iron';

                    if (isStructure) {
                        // NEW: Structure LOD (further distances than rocks)
                        // Skip stable billboards (hysteresis)
                        if (distSq < structSkipNearSq && currentOpacity === 0) continue;
                        if (distSq > structSkipFarSq && currentOpacity === 1) continue;

                        // Billboard: 0-40 hidden, 40-60 fade in, 60+ full
                        if (distSq < struct40Sq) {
                            opacity = 0;
                        } else if (distSq < struct60Sq) {
                            const distance = Math.sqrt(distSq);
                            opacity = (distance - 40) / 20;
                        } else {
                            opacity = 1;
                        }
                    } else if (uses3DModel) {
                        // Rock LOD (existing code)
                        if (distSq < modelSkipNearSq && currentOpacity === 0) continue;
                        if (distSq > modelSkipFarSq && currentOpacity === 1) continue;

                        if (distSq < model15Sq) {
                            opacity = 0;
                        } else if (distSq < model25Sq) {
                            const distance = Math.sqrt(distSq);
                            opacity = (distance - 15) / 10;
                        } else {
                            opacity = 1;
                        }
                    } else {
                        // Tree LOD (existing code)
                        if (distSq < otherSkipNearSq && currentOpacity === 0) continue;
                        if (distSq > otherSkipFarSq && currentOpacity === 1) continue;

                        if (distSq < other10Sq) {
                            opacity = 0;
                        } else if (distSq < other15Sq) {
                            const distance = Math.sqrt(distSq);
                            opacity = (distance - 10) / 5;
                        } else {
                            opacity = 1;
                        }
                    }
                }
```

**Key change:** Distance calculation (`distX`, `distZ`, `distSq`) moved from line 471-473 (inside else) to line 463-465 (before all branches). This allows skip thresholds to work for ALL types including the early-exit ones like vegetables.

---

## Part 3: Structure Model System (Simplified)

### Key Simplification from Analysis

**DO NOT use shader injection like RockModelSystem**. Structures are regular meshes (not InstancedMesh), so we can use direct `material.opacity` which is much simpler.

| RockModelSystem Approach | Our Simpler Approach |
|--------------------------|----------------------|
| Shader injection via `onBeforeCompile` | Direct `material.opacity = value` |
| InstancedBufferAttribute for opacity | Simple material traversal |
| ~489 lines | ~150 lines |

### New File: `public/systems/StructureModelSystem.js`

```javascript
/**
 * StructureModelSystem.js
 *
 * Manages opacity for structure 3D models to enable smooth LOD transitions.
 *
 * SIMPLIFIED from RockModelSystem:
 * - Uses direct material.opacity (not shader injection)
 * - Structures are regular meshes, not InstancedMesh
 *
 * Patterns REUSED from RockModelSystem:
 * - Chunk-based spatial partitioning (structuresByChunk)
 * - Skip thresholds for hysteresis (reduces thrashing)
 * - Squared distance calculations (avoids sqrt in hot loop)
 */

// NOTE: Path is '../core/' because this file is in /public/systems/
import ChunkCoordinates from '../core/ChunkCoordinates.js';

export class StructureModelSystem {
    // Accept scene parameter for consistency with RockModelSystem/BillboardSystem
    constructor(scene = null) {
        this.scene = scene;

        // Structure types with LOD billboards
        this.structureTypes = new Set(['tent', 'outpost', 'campfire', 'horse']);

        // Track structures for opacity updates
        // Pattern from RockModelSystem.instanceData
        this.structureData = new Map(); // objectId -> {type, mesh, position, chunkKey, currentOpacity}

        // Spatial partitioning for efficient updates
        // Pattern from RockModelSystem.rocksByChunk
        this.structuresByChunk = new Map(); // chunkKey -> Set of objectIds

        // LOD distances (inverse of billboard - fade OUT as distance increases)
        this.fadeStart = 40;  // Start fading at this distance
        this.fadeEnd = 60;    // Fully hidden at this distance

        // Pre-computed squared distances (pattern from RockModelSystem)
        this.fadeStartSq = this.fadeStart * this.fadeStart;
        this.fadeEndSq = this.fadeEnd * this.fadeEnd;
        this.fadeRange = this.fadeEnd - this.fadeStart;

        // Skip thresholds for hysteresis (pattern from RockModelSystem)
        // Prevents opacity thrashing when player is near threshold
        this.skipNearSq = this.fadeStartSq * 0.7;
        this.skipFarSq = this.fadeEndSq * 1.3;
    }

    /**
     * Register a structure for LOD management
     * Called from SceneObjectFactory when structure is created
     */
    registerStructure(objectId, structureType, mesh, position) {
        if (!this.structureTypes.has(structureType)) {
            return;
        }

        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(position.x, position.z);
        const chunkKey = `${chunkX},${chunkZ}`;

        // Make materials support opacity (simple approach - no shader injection)
        this.enableOpacity(mesh);

        this.structureData.set(objectId, {
            type: structureType,
            mesh,
            position: { x: position.x, y: position.y, z: position.z },
            chunkKey,
            currentOpacity: 1.0,
        });

        if (!this.structuresByChunk.has(chunkKey)) {
            this.structuresByChunk.set(chunkKey, new Set());
        }
        this.structuresByChunk.get(chunkKey).add(objectId);
    }

    /**
     * Unregister a structure (when destroyed)
     */
    unregisterStructure(objectId) {
        const data = this.structureData.get(objectId);
        if (!data) return;

        const chunkSet = this.structuresByChunk.get(data.chunkKey);
        if (chunkSet) {
            chunkSet.delete(objectId);
            if (chunkSet.size === 0) {
                this.structuresByChunk.delete(data.chunkKey);
            }
        }

        this.structureData.delete(objectId);
    }

    /**
     * Enable opacity on mesh materials
     * SIMPLIFIED: Direct material modification instead of shader injection
     */
    enableOpacity(mesh) {
        mesh.traverse((child) => {
            if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material)
                    ? child.material
                    : [child.material];

                materials.forEach((mat, idx) => {
                    if (!mat.transparent) {
                        // Clone material to avoid affecting other instances
                        const newMat = mat.clone();
                        newMat.transparent = true;
                        newMat.opacity = 1.0;
                        newMat.depthWrite = true; // Important for proper occlusion
                        newMat.needsUpdate = true;

                        if (Array.isArray(child.material)) {
                            child.material[idx] = newMat;
                        } else {
                            child.material = newMat;
                        }
                    }
                });
            }
        });
    }

    /**
     * Set opacity for a structure mesh
     * SIMPLIFIED: Direct material.opacity instead of buffer attributes
     */
    setOpacity(mesh, opacity) {
        mesh.traverse((child) => {
            if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material)
                    ? child.material
                    : [child.material];

                materials.forEach((mat) => {
                    mat.opacity = opacity;
                });

                // Hide completely if very transparent (optimization)
                child.visible = opacity > 0.01;
            }
        });
    }

    /**
     * Update structure opacities based on camera distance
     * Call every 60 frames from Game.js (same as BillboardSystem)
     *
     * Pattern from RockModelSystem.updateRockModels():
     * - 3x3 chunk iteration (not all structures)
     * - Squared distance comparisons
     * - Skip thresholds to reduce thrashing
     */
    updateLOD(cameraPosition) {
        const camX = cameraPosition.x;
        const camZ = cameraPosition.z;
        const { chunkX: camChunkX, chunkZ: camChunkZ } = ChunkCoordinates.worldToChunk(camX, camZ);

        // Only check structures in nearby chunks (3x3 grid - same as RockModelSystem)
        // 3x3 covers ~75 units which is sufficient for 60-unit LOD distance
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const chunkKey = `${camChunkX + dx},${camChunkZ + dz}`;
                const structuresInChunk = this.structuresByChunk.get(chunkKey);
                if (!structuresInChunk) continue;

                for (const objectId of structuresInChunk) {
                    const data = this.structureData.get(objectId);
                    // Null checks to prevent crashes on disposed/invalid structures
                    if (!data || !data.mesh || !data.mesh.parent) continue;

                    const distX = data.position.x - camX;
                    const distZ = data.position.z - camZ;
                    const distSq = distX * distX + distZ * distZ;

                    // Skip thresholds (hysteresis from RockModelSystem)
                    // Prevents thrashing when player is near transition zone
                    if (distSq < this.skipNearSq && data.currentOpacity === 1) continue;
                    if (distSq > this.skipFarSq && data.currentOpacity === 0) continue;

                    let targetOpacity;

                    // 3D model: full at close range, fade to hidden at distance
                    if (distSq < this.fadeStartSq) {
                        targetOpacity = 1.0;
                    } else if (distSq < this.fadeEndSq) {
                        // Only use sqrt in fade zone (optimization from RockModelSystem)
                        const distance = Math.sqrt(distSq);
                        targetOpacity = 1.0 - (distance - this.fadeStart) / this.fadeRange;
                    } else {
                        targetOpacity = 0.0;
                    }

                    // Only update if changed significantly (reduces GPU updates)
                    if (Math.abs(data.currentOpacity - targetOpacity) > 0.02) {
                        data.currentOpacity = targetOpacity;
                        this.setOpacity(data.mesh, targetOpacity);
                    }
                }
            }
        }
    }

    /**
     * Clear all tracked structures (e.g., on disconnect)
     */
    clear() {
        this.structureData.clear();
        this.structuresByChunk.clear();
    }
}
```

### Integration in `SceneObjectFactory.js`

**IMPORTANT:** The LOD registration must go AFTER `userData.objectId` is set (line 461),
not at line 447 which is inside the tree-only branch.

```javascript
// At top of createObjectInScene() or as module-level constant:
const STRUCTURE_LOD_TYPES = new Set(['tent', 'outpost', 'campfire', 'horse']);

// AFTER line 461 (after userData.objectId is set), add:
// Register structures with LOD systems
const objectType = data.name || data.objectType;
if (STRUCTURE_LOD_TYPES.has(objectType) && objectInstance) {
    // Register with 3D model LOD system (fades out at distance)
    if (this.game.structureModelSystem) {
        this.game.structureModelSystem.registerStructure(
            objectInstance.userData.objectId,
            objectType,
            objectInstance,
            objectPosition
        );
    }

    // Register with billboard system (fades in at distance)
    // NOTE: Requires BillboardSystem to have structure types in treeTypes array first!
    if (this.game.billboardSystem) {
        const billboardIndex = this.game.billboardSystem.addTreeBillboard(
            objectInstance,
            objectType,
            objectPosition
        );
        if (billboardIndex !== -1) {
            objectInstance.userData.billboardIndex = billboardIndex;
        }
    }
}
```

**Integration order matters:**
1. objectInstance created (line 448-457)
2. userData.objectId set (line 461)
3. **LOD registration goes here** (new code)
4. Rest of userData setup continues

### Integration in `GameInitializer.js` (System Initialization)

**Location:** After `rockModelSystem` initialization (~line 84)

```javascript
// In GameInitializer.js, add import at top:
import { StructureModelSystem } from '../systems/StructureModelSystem.js';

// After line 84 (after rockModelSystem init):
this.game.structureModelSystem = new StructureModelSystem(this.game.scene);
```

### Integration in `Game.js` (Update Loop)

#### Update loop (line ~2593, after billboardSystem.updateBillboards):

```javascript
// Existing code (line 2593-2594):
if (this.billboardSystem) {
    this.billboardSystem.updateBillboards(playerPos);
}

// ADD THIS RIGHT AFTER (line ~2596):
if (this.structureModelSystem) {
    this.structureModelSystem.updateLOD(playerPos);
}
```

**Note:** The LOD update runs every frame as part of `cullDistantTrees()`, using `playerPos` which is already available in that scope.

---

## Part 4: Config Settings

Add to `public/config.js` for easy adjustment:

```javascript
// Structure LOD settings
STRUCTURE_LOD: {
    ENABLED: true,
    FADE_START: 40,      // Distance where 3D starts fading
    FADE_END: 60,        // Distance where fully billboard
    BILLBOARD_TYPES: ['tent', 'outpost', 'campfire', 'horse'],
},

// Structure creation queue settings
STRUCTURE_QUEUE: {
    ENABLED: true,
    MAX_PER_FRAME: 1,    // Max structures to create per frame
    FRAME_BUDGET_MS: 4,  // Max ms to spend on structures per frame
},
```

---

## Summary of Changes

| File | Change | Lines Added |
|------|--------|-------------|
| `public/systems/StructureCreationQueue.js` | NEW - Queue system | ~170 |
| `public/systems/StructureModelSystem.js` | NEW - 3D opacity LOD (simplified) | ~150 |
| `public/BillboardSystem.js` | Add structure configs and LOD profile | ~40 |
| `public/network/MessageRouter.js` | Queue structures instead of immediate | ~15 |
| `public/network/SceneObjectFactory.js` | Register with both LOD systems | ~15 |
| `public/game.js` | Process queue, update LOD | ~10 |
| `public/config.js` | Add config settings | ~15 |

**Total**: ~415 lines (down from ~600 in original plan due to simplification)

---

## Implementation Order

1. **BillboardSystem changes** (~40 lines) - Smallest change, immediate visual benefit
2. **StructureCreationQueue** (~170 lines) - Eliminates spawn stutter
3. **StructureModelSystem** (~150 lines) - Smooth LOD transitions
4. **Integration wiring** (~40 lines) - Connect everything

---

## Testing

1. **Stutter Test**: Teleport to an area with no bandit camps, then move toward one. The stutter should be eliminated or greatly reduced.

2. **LOD Test**: Stand 80+ units from a bandit camp and verify you see billboards. Walk closer and verify smooth transition to 3D models at ~40-60 units.

3. **Performance Test**: Use browser DevTools Performance tab to compare frame times before/after the changes.

---

## Fallback / Disable

If issues arise, you can disable either system via config:

```javascript
// Disable structure queue (revert to immediate creation)
STRUCTURE_QUEUE: { ENABLED: false }

// Disable structure LOD (always use 3D models)
STRUCTURE_LOD: { ENABLED: false }
```

---

## Verified Implementation Notes (Bug Prevention)

Based on code analysis, these patterns are verified correct:

### Import Paths
| File Location | ChunkCoordinates Import |
|---------------|------------------------|
| `/public/*.js` (root) | `'./core/ChunkCoordinates.js'` |
| `/public/systems/*.js` | `'../core/ChunkCoordinates.js'` |
| `/public/network/*.js` | `'../core/ChunkCoordinates.js'` |

### Verified Method Signatures
```javascript
// SceneObjectFactory.createObjectInScene (line 290)
createObjectInScene(data, chunkKey)
// - data.position is [x,y,z] array (converted to Vector3 internally at line 345)
// - chunkKey is "x,z" format (no "chunk_" prefix)

// BillboardSystem.addTreeBillboard (line 295)
addTreeBillboard(treeObject, treeType, position)
// - position is THREE.Vector3
// - returns index (number) or -1 on failure
// - REQUIRES treeType to be in treeTypes array!

// AISpawnQueue.processQueue (line 119)
processQueue()
// - returns number of items processed
// - uses frame count delay, not ms budget

// ChunkCoordinates methods (IMPORTANT - worldToChunkKey does NOT exist!)
ChunkCoordinates.worldToChunk(x, z)     // returns {chunkX, chunkZ}
ChunkCoordinates.worldToChunkId(x, z)   // returns "chunk_X,Z" string
ChunkCoordinates.get3x3ChunkKeys(x, z)  // returns array of "X,Z" keys
// NO worldToChunkKey() method - use worldToChunk() + template literal
```

### Verified Access Patterns
```javascript
// In game.js:
this.messageRouter              // MessageRouter instance
this.billboardSystem            // BillboardSystem instance
this.gameLoop.frameCount        // Frame counter (not just frameCount)
playerPos                       // Available in cullDistantTrees scope

// In MessageRouter:
this.sceneObjectFactory         // SceneObjectFactory instance
this.game                       // Game instance reference
```

### BillboardSystem Modification Checklist
1. Line 23: Add `'tent', 'outpost', 'campfire', 'horse'` to `treeTypes` array
2. Lines 26-39: Add 4 new entries to `billboardConfig` object
3. Line ~198: Add texture path check for structure types (before final `else`)
4. Line ~433: Add `struct40Sq`, `struct60Sq`, skip thresholds, and `structureTypes` Set
5. Lines 462-507: **MAJOR REFACTOR** - Restructure to check `isStructure` BEFORE `uses3DModel`

### Critical: Opacity Calculation Refactor - COMPLETE
The existing opacity calculation had distance inside the `else` block. **Change 5 in Part 2** provides the complete refactored code:
1. ✅ `distX`, `distZ`, `distSq` moved OUTSIDE to lines 463-465 (before all branches)
2. ✅ `isStructure` check added FIRST (before `uses3DModel`)
3. ✅ Existing rock/tree logic preserved in subsequent branches
4. ✅ All skip threshold `continue` statements work correctly with distSq now available

### Bug Fixes Applied (from verification):
1. **worldToChunkKey() → worldToChunk()**: Method doesn't exist, use `worldToChunk()` + template literal
2. **5x5 → 3x3 chunks**: StructureModelSystem now uses 3x3 grid (matches RockModelSystem pattern)
3. **Constructor scene param**: StructureModelSystem now accepts `scene` parameter for consistency
4. **SceneObjectFactory line 447 → 461**: LOD registration must be AFTER userData.objectId is set
5. **Null checks added**: `!data.mesh.parent` check prevents crashes on disposed meshes
6. **Billboard index check**: Added `if (billboardIndex !== -1)` before storing

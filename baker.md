# Baker NPC Implementation Plan

## Overview

A worker NPC that spawns at bakeries and performs a resource gathering/delivery loop:
1. Collect apples from apple trees (up to 4)
2. Deposit apples at bakery
3. Collect firewood from market (1)
4. Deposit firewood at bakery
5. Pick up apple tarts from bakery
6. Deliver apple tarts to market
7. Repeat

**Key Principles:**
- Use existing code systems wherever possible
- Extreme performance focus (this is a real-time multiplayer game)
- Player communication via dialogue (like merchant system)

---

## CRITICAL DESIGN DECISIONS (Resolved)

### Apple Collection: Inventory-Based System

**Apples are stored IN the tree's inventory** (3x3 grid, 9 slots max). NOT a harvest action.

**Collection Flow:**
1. Baker finds nearest valid apple tree (not planted/growing)
2. Baker sends `npc_collect_apples` to server with tree ID
3. Server atomically removes up to 2 apples, returns them to baker
4. Server broadcasts `crate_inventory_updated` to sync clients
5. Baker stores apples in personal inventory

**Why this approach:**
- No lock system needed (instant server operation)
- Minimal server involvement (single message)
- Reuses existing inventory broadcast system

### Spawning: Ship Arrival at Connected Dock

**Baker spawns when ship arrives at a dock connected to a market near the bakery.**

**Requirements:**
- Bakery must be within 20 units of a market (validated on placement)
- Market must be within 20 units of a dock (for ship trading)
- Baker spawns when `dock_ship_spawned` event fires for connected dock

**Spawn Chain Logic:**
```
dock_ship_spawned event
    └─► Find market within 20 units of dock
        └─► Find bakery within 20 units of market
            └─► If bakery has no baker, spawn baker
```

**GameState Caching (Performance Optimization):**

Instead of iterating ALL objects in 9 chunks to find markets/bakeries, we cache their positions on registration:

```javascript
// In GameState.js constructor - add alongside existing banditStructuresByChunk
this.marketsByChunk = new Map();   // chunkKey → [{id, position}]
this.bakeriesByChunk = new Map();  // chunkKey → [{id, position}]

// Registration methods
registerMarket(chunkKey, marketData) {
    if (!this.marketsByChunk.has(chunkKey)) {
        this.marketsByChunk.set(chunkKey, []);
    }
    this.marketsByChunk.get(chunkKey).push(marketData);
}

unregisterMarket(chunkKey, marketId) {
    const markets = this.marketsByChunk.get(chunkKey);
    if (markets) {
        const index = markets.findIndex(m => m.id === marketId);
        if (index !== -1) markets.splice(index, 1);
    }
}

getMarketsInChunk(chunkKey) {
    return this.marketsByChunk.get(chunkKey) || [];
}

// Same pattern for bakeries
registerBakery(chunkKey, bakeryData) {
    if (!this.bakeriesByChunk.has(chunkKey)) {
        this.bakeriesByChunk.set(chunkKey, []);
    }
    this.bakeriesByChunk.get(chunkKey).push(bakeryData);
}

unregisterBakery(chunkKey, bakeryId) {
    const bakeries = this.bakeriesByChunk.get(chunkKey);
    if (bakeries) {
        const index = bakeries.findIndex(b => b.id === bakeryId);
        if (index !== -1) bakeries.splice(index, 1);
    }
}

getBakeriesInChunk(chunkKey) {
    return this.bakeriesByChunk.get(chunkKey) || [];
}
```

**SceneObjectFactory Registration:**

```javascript
// In createObjectInScene() - register markets and bakeries
if (structureType === 'market') {
    const chunkKey = `${Math.floor(x / 50)},${Math.floor(z / 50)}`;
    this.game.gameState.registerMarket(chunkKey, {
        id: objectInstance.userData.objectId,
        position: { x, y, z }
    });
}

if (structureType === 'bakery') {
    const chunkKey = `${Math.floor(x / 50)},${Math.floor(z / 50)}`;
    this.game.gameState.registerBakery(chunkKey, {
        id: objectInstance.userData.objectId,
        position: { x, y, z }
    });
}
```

---

## Structure & Inventory Access (Performance-Friendly)

**Problem:** Baker needs to access bakery/market/tree inventories frequently. Iterating scene objects every time is expensive.

**Solution:** Cache object references on registration, access inventory directly from cache.

### Enhanced GameState Caching

```javascript
// In GameState.js - store OBJECT REFERENCES, not just positions
this.marketsByChunk = new Map();   // chunkKey → [{id, position, object}]
this.bakeriesByChunk = new Map();  // chunkKey → [{id, position, object}]
this.structuresById = new Map();   // structureId → {chunkKey, position, object, type}

// Registration - store the actual object reference
registerMarket(chunkKey, marketData) {
    if (!this.marketsByChunk.has(chunkKey)) {
        this.marketsByChunk.set(chunkKey, []);
    }
    this.marketsByChunk.get(chunkKey).push(marketData);

    // Also register by ID for O(1) lookup
    this.structuresById.set(marketData.id, {
        chunkKey,
        position: marketData.position,
        object: marketData.object,
        type: 'market'
    });
}

registerBakery(chunkKey, bakeryData) {
    if (!this.bakeriesByChunk.has(chunkKey)) {
        this.bakeriesByChunk.set(chunkKey, []);
    }
    this.bakeriesByChunk.get(chunkKey).push(bakeryData);

    this.structuresById.set(bakeryData.id, {
        chunkKey,
        position: bakeryData.position,
        object: bakeryData.object,
        type: 'bakery'
    });
}

// O(1) lookup by ID - no scene traversal
getStructureById(structureId) {
    return this.structuresById.get(structureId) || null;
}

// Unregister - remove from both caches
unregisterMarket(chunkKey, marketId) {
    const markets = this.marketsByChunk.get(chunkKey);
    if (markets) {
        const index = markets.findIndex(m => m.id === marketId);
        if (index !== -1) markets.splice(index, 1);
    }
    this.structuresById.delete(marketId);
}

unregisterBakery(chunkKey, bakeryId) {
    const bakeries = this.bakeriesByChunk.get(chunkKey);
    if (bakeries) {
        const index = bakeries.findIndex(b => b.id === bakeryId);
        if (index !== -1) bakeries.splice(index, 1);
    }
    this.structuresById.delete(bakeryId);
}
```

### SceneObjectFactory - Store Object Reference

```javascript
// In createObjectInScene() - include object reference
if (structureType === 'market') {
    const chunkKey = `${Math.floor(x / 50)},${Math.floor(z / 50)}`;
    this.game.gameState.registerMarket(chunkKey, {
        id: objectInstance.userData.objectId,
        position: { x, y, z },
        object: objectInstance  // Store the actual Three.js object
    });
}

if (structureType === 'bakery') {
    const chunkKey = `${Math.floor(x / 50)},${Math.floor(z / 50)}`;
    this.game.gameState.registerBakery(chunkKey, {
        id: objectInstance.userData.objectId,
        position: { x, y, z },
        object: objectInstance  // Store the actual Three.js object
    });
}
```

### BakerController Inventory Access

```javascript
// O(1) inventory access - no iteration
_getInventory(structureId) {
    const structure = this.gameState.getStructureById(structureId);
    if (!structure || !structure.object) return null;
    return structure.object.userData.inventory || null;
}

_getBakeryInventory(bakeryId) {
    return this._getInventory(bakeryId);
}

_getMarketInventory(marketId) {
    return this._getInventory(marketId);
}

// Check if bakery has specific items (no allocation)
_bakeryHasFirewood(bakeryId) {
    const inv = this._getBakeryInventory(bakeryId);
    if (!inv?.items) return false;

    for (let i = 0; i < inv.items.length; i++) {
        const item = inv.items[i];
        if (item.type.endsWith('firewood') && item.durability > 0) {
            return true;
        }
    }
    return false;
}

_countBakeryApples(bakeryId) {
    const inv = this._getBakeryInventory(bakeryId);
    if (!inv?.items) return 0;

    let count = 0;
    for (let i = 0; i < inv.items.length; i++) {
        if (inv.items[i].type === 'apple') count++;
    }
    return count;
}

_getReadyTarts(bakeryId) {
    const inv = this._getBakeryInventory(bakeryId);
    if (!inv?.items) return [];

    // Reuse array to avoid allocation
    this._tartCache = this._tartCache || [];
    this._tartCache.length = 0;

    for (let i = 0; i < inv.items.length; i++) {
        if (inv.items[i].type === 'appletart') {
            this._tartCache.push(inv.items[i]);
        }
    }
    return this._tartCache;
}
```

### Server Inventory Operations

**IMPORTANT:** Baker is a hybrid pattern:
- P2P authority system (like bandit)
- Server inventory interaction (like player, but without locks)

**Existing code patterns:**
- Uses `networkManager.sendMessage('type', payload)` (not `.send()`)
- Fire-and-forget messages - no await/callback pattern
- Responses arrive via MessageRouter message handlers
- NPC inventory handlers are NEW (don't exist yet - must be added to server)

```javascript
// In BakerController constructor - get reference to networkManager
this.networkManager = null;  // Set during initialize()

// In initialize() - store networkManager reference
initialize(callbacks) {
    this.networkManager = callbacks.networkManager;
    // ... other callbacks
}
```

**Sending Inventory Requests (matches existing sendMessage pattern):**

```javascript
// Collect apples from tree - authority client sends this
_requestCollectApples(entity, treeId) {
    if (!this.networkManager) return;

    const tree = this._getTreeById(treeId);
    if (!tree) return;

    // Use same sendMessage pattern as other systems
    this.networkManager.sendMessage('npc_collect_apples', {
        npcType: 'baker',
        bakeryId: entity.bakeryId,
        treeId: treeId,
        chunkId: `chunk_${tree.chunkKey}`,
        maxCount: 2 - entity.carrying.length
    });
}

// Deposit items to structure
_requestDepositItems(entity, structureId, items) {
    if (!this.networkManager) return;

    const structure = this.gameState.getStructureById(structureId);
    if (!structure) return;

    this.networkManager.sendMessage('npc_deposit_inventory', {
        npcType: 'baker',
        bakeryId: entity.bakeryId,
        structureId: structureId,
        chunkId: `chunk_${structure.chunkKey}`,
        items: items
    });
}

// Collect tarts from bakery (grid-based inventory)
_requestCollectFromBakery(entity, itemType, count) {
    if (!this.networkManager) return;

    const structure = this.gameState.getStructureById(entity.bakeryId);
    if (!structure) return;

    // Uses grid-based handler (same pattern as apple trees)
    this.networkManager.sendMessage('npc_collect_from_structure', {
        npcType: 'baker',
        bakeryId: entity.bakeryId,
        structureId: entity.bakeryId,
        chunkId: `chunk_${structure.chunkKey}`,
        itemType: itemType,
        count: count
    });
}

// Collect firewood from market (quantity-based inventory)
_requestCollectFromMarket(entity, marketId, itemType, count) {
    if (!this.networkManager) return;

    const structure = this.gameState.getStructureById(marketId);
    if (!structure) return;

    // Uses quantity-based handler (same pattern as ship trading)
    this.networkManager.sendMessage('npc_collect_from_market', {
        npcType: 'baker',
        bakeryId: entity.bakeryId,
        marketId: marketId,
        chunkId: `chunk_${structure.chunkKey}`,
        itemType: itemType,
        count: count
    });
}
```

**Response Routing (MessageRouter.js):**

Server responses arrive via WebSocket and are routed to BakerController:

```javascript
// In MessageRouter.js handleMessage() - add NPC response handlers
case 'npc_collect_apples_response':
    this.game?.bakerController?.handleAppleCollectResponse(payload);
    break;

case 'npc_deposit_response':
    this.game?.bakerController?.handleDepositResponse(payload);
    break;

case 'npc_collect_response':
    this.game?.bakerController?.handleCollectResponse(payload);
    break;
```

**Response Handlers in BakerController:**

```javascript
// Handle server response - apples collected from tree
handleAppleCollectResponse(data) {
    const { success, collected, treeId, bakeryId } = data;

    const entity = this.bakers.get(bakeryId);
    if (!entity || entity.state !== 'collecting_apples') return;

    if (success && collected && collected.length > 0) {
        // Add to baker's personal inventory
        for (const item of collected) {
            entity.carrying.push(item);
        }
    }

    // Continue multi-tree logic or return
    this._onAppleCollectionComplete(entity, collected || [], treeId);
}

// Handle server response - items deposited
handleDepositResponse(data) {
    const { success, bakeryId, structureId } = data;

    const entity = this.bakers.get(bakeryId);
    if (!entity) return;

    if (success) {
        entity.carrying.length = 0;  // Clear inventory
    }

    entity.state = 'idle';
    entity.targetId = null;
}

// Handle server response - items collected from structure
handleCollectResponse(data) {
    const { success, collected, bakeryId, structureId, itemType } = data;

    const entity = this.bakers.get(bakeryId);
    if (!entity) return;

    if (success && collected && collected.length > 0) {
        for (const item of collected) {
            entity.carrying.push(item);
        }
    }

    // Transition based on what was collected
    if (itemType === 'firewood' || itemType.endsWith('firewood')) {
        entity.state = 'returning';
    } else if (itemType === 'appletart') {
        entity.state = 'delivering';
    }
}
```

**State Machine Integration (No awaitingResponse flag):**

Instead of blocking with `awaitingResponse`, use state-based waiting:

```javascript
case 'collecting_apples':
    // Only authority sends request
    if (entity.authorityId !== this.clientId) break;

    // Check if we already sent request (use timestamp)
    const now = Date.now();
    if (!entity.requestSentAt) {
        this._requestCollectApples(entity, entity.targetId);
        entity.requestSentAt = now;
    } else if (now - entity.requestSentAt > 5000) {
        // Timeout after 5 seconds - retry or fail
        entity.requestSentAt = null;  // Allow retry
    }
    // Response handler will transition state
    break;

case 'depositing':
    if (entity.authorityId !== this.clientId) break;

    if (!entity.requestSentAt && entity.carrying.length > 0) {
        this._requestDepositItems(entity, entity.bakeryId, entity.carrying);
        entity.requestSentAt = now;
    } else if (now - entity.requestSentAt > 5000) {
        entity.requestSentAt = null;
    }
    break;
```

**Clear requestSentAt on state transitions:**

```javascript
// In response handlers, clear the timestamp
handleAppleCollectResponse(data) {
    // ...
    entity.requestSentAt = null;  // Clear for next request
    // ...
}
```

### Apple Tree Access (Special Case)

Apple trees aren't registered in GameState caches. Use chunk object iteration with caching:

```javascript
// Cache apple trees per chunk (refreshed when chunk loads)
this._appleTreesByChunk = new Map();  // chunkKey → [{id, position, object}]

// Called when chunk objects are loaded/updated
onChunkObjectsLoaded(chunkKey, objects) {
    const trees = [];
    for (const obj of objects) {
        if (obj.userData?.modelType === 'apple') {
            // Filter out growing planted trees
            const id = obj.userData.objectId || '';
            if (id.startsWith('planted_apple_')) {
                if (obj.userData.isGrowing || obj.userData.plantedAtTick) {
                    continue;  // Still growing, skip
                }
            }
            trees.push({
                id: obj.userData.objectId,
                position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
                object: obj
            });
        }
    }
    this._appleTreesByChunk.set(chunkKey, trees);
}

onChunkUnloaded(chunkKey) {
    this._appleTreesByChunk.delete(chunkKey);
}

// Find nearest apple tree - uses cached trees, not all objects
_findNearestAppleTree(position, maxDist = 50) {
    const maxDistSq = maxDist * maxDist;
    const chunkX = Math.floor(position.x / 50);
    const chunkZ = Math.floor(position.z / 50);

    let nearest = null;
    let nearestDistSq = maxDistSq;

    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            const chunkKey = `${chunkX + dx},${chunkZ + dz}`;
            const trees = this._appleTreesByChunk.get(chunkKey);
            if (!trees) continue;

            for (let i = 0; i < trees.length; i++) {
                const tree = trees[i];

                // Skip trees we already checked this cycle
                if (this._checkedTrees?.has(tree.id)) continue;

                // Skip trees with no apples (check inventory)
                const inv = tree.object.userData.inventory;
                if (!inv?.items?.length) continue;

                const hasApples = inv.items.some(item => item.type === 'apple');
                if (!hasApples) continue;

                const tx = tree.position.x - position.x;
                const tz = tree.position.z - position.z;
                const distSq = tx * tx + tz * tz;

                if (distSq < nearestDistSq) {
                    nearestDistSq = distSq;
                    nearest = tree;
                }
            }
        }
    }

    return nearest;
}

// Get tree inventory for apple collection
_getTreeInventory(treeId) {
    // Search cached trees
    for (const [chunkKey, trees] of this._appleTreesByChunk) {
        for (const tree of trees) {
            if (tree.id === treeId) {
                return tree.object.userData.inventory || null;
            }
        }
    }
    return null;
}
```

### Performance Summary

| Operation | Before | After |
|-----------|--------|-------|
| Get bakery inventory | Iterate all scene objects | O(1) Map lookup |
| Get market inventory | Iterate all scene objects | O(1) Map lookup |
| Find nearest market | Iterate all objects in 9 chunks | Iterate only markets (0-5) |
| Find nearest tree | Iterate all objects in 9 chunks | Iterate only cached trees |
| Check for firewood | Array.some() with allocation | for loop, no allocation |
| Count apples | Array.filter().length | for loop counter |

---

## Pathfinding System (Reuse Bandit Pattern)

Baker uses the **same pathfinding system as bandits** - NavigationManager + A* algorithm.

### Callback Injection (GameInitializer.js)

```javascript
// BakerController receives findPath callback during initialization
// Same pattern as AIController (bandits)

// In GameInitializer.js initializeAISystems() - add baker:
const bakerCallbacks = {
    // ... other callbacks ...

    findPath: (fromX, fromZ, toX, toZ) => {
        if (this.game.navigationManager) {
            return findPath(this.game.navigationManager, fromX, fromZ, toX, toZ);
        }
        return null;
    },

    getTerrainHeight: (x, z) => {
        return this.game.terrainGenerator?.getHeight(x, z) ?? 0;
    },

    isWalkable: (x, z) => {
        return this.game.navigationManager?.isWalkable(x, z) ?? true;
    },
};

this.game.bakerController = new BakerController();
this.game.bakerController.initialize(bakerCallbacks);
```

### BakerController Constructor

```javascript
// In BakerController constructor - same pattern as AIController
this.findPath = null;           // Injected callback
this.getTerrainHeight = null;   // Injected callback
this.isWalkable = null;         // Injected callback

// In initialize() - validate required callbacks
initialize(callbacks) {
    const required = ['findPath', 'getTerrainHeight', 'isWalkable', ...];
    for (const key of required) {
        if (!callbacks[key]) {
            console.error(`[BakerController] Missing required callback: ${key}`);
        }
        this[key] = callbacks[key];
    }
}
```

### Path Calculation (Throttled)

```javascript
// Update pathfinding - same throttling as bandits (every 6 seconds)
_updatePathfinding(entity, targetX, targetZ) {
    const now = Date.now();

    // Throttle pathfinding to every 6 seconds
    if (now - entity.lastPathTime < 6000 && entity.path.length > 0) {
        return;
    }

    // Calculate new path
    const path = this.findPath(
        entity.position.x, entity.position.z,
        targetX, targetZ
    );

    entity.path = path || [];
    entity.pathIndex = 0;
    entity.lastPathTime = now;

    // If no path found, enter stuck state
    if (!path || path.length === 0) {
        entity.state = 'stuck';
        entity.stuckReason = 'I cannot reach my destination.';
    }
}
```

### Movement Along Path (Reuse Bandit _moveAlongPath)

```javascript
// Nearly identical to AIController._moveAlongPath()
_moveAlongPath(entity, deltaTime) {
    const config = BAKER_CONFIG;

    if (!entity.path || entity.path.length === 0) {
        // No path - stop moving, wait for pathfinding retry
        if (entity.visual) {
            entity.visual.update(deltaTime, false);  // isMoving = false
        }

        // Allow pathfinding retry after 6 seconds
        if (entity.lastPathTime > 0) {
            const timeSinceLastPath = Date.now() - entity.lastPathTime;
            if (timeSinceLastPath > 6000) {
                entity.lastPathTime = 0;  // Force recalculation
            }
        }
        return false;
    }

    if (entity.pathIndex >= entity.path.length) {
        // Reached end of path
        entity.path = [];
        entity.pathIndex = 0;
        return true;  // Arrived
    }

    // Get current waypoint
    const waypoint = entity.path[entity.pathIndex];
    const dx = waypoint.x - entity.position.x;
    const dz = waypoint.z - entity.position.z;
    const distSq = dx * dx + dz * dz;

    // Close enough to waypoint? Move to next
    const WAYPOINT_THRESHOLD_SQ = 1.0;  // 1 unit
    if (distSq < WAYPOINT_THRESHOLD_SQ) {
        entity.pathIndex++;
        if (entity.pathIndex >= entity.path.length) {
            entity.path = [];
            entity.pathIndex = 0;
            if (entity.visual) {
                entity.visual.update(deltaTime, false);
            }
            return true;  // Arrived at final destination
        }
        return false;  // More waypoints to go
    }

    // Move toward waypoint
    const dist = Math.sqrt(distSq);
    const moveSpeed = config.MOVE_SPEED;  // 0.8 for baker
    const moveAmount = moveSpeed * (deltaTime / 1000);

    if (moveAmount >= dist) {
        // Would overshoot - snap to waypoint
        entity.position.x = waypoint.x;
        entity.position.z = waypoint.z;
    } else {
        // Move partial distance
        entity.position.x += (dx / dist) * moveAmount;
        entity.position.z += (dz / dist) * moveAmount;
    }

    // Update Y from terrain
    entity.position.y = this.getTerrainHeight(entity.position.x, entity.position.z);

    // Face movement direction
    entity.rotation = Math.atan2(dx, dz);

    // Update visual
    if (entity.visual) {
        entity.visual.update(deltaTime, true);  // isMoving = true
    }

    // Sync mesh position
    if (entity.mesh) {
        entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
        entity.mesh.rotation.y = entity.rotation;
    }

    return false;  // Still moving
}
```

### Arrival Check Helper

```javascript
// Check if entity is within range of target position
_isAtPosition(entity, targetX, targetZ, threshold = 1.5) {
    const dx = targetX - entity.position.x;
    const dz = targetZ - entity.position.z;
    const distSq = dx * dx + dz * dz;
    return distSq < threshold * threshold;
}
```

---

**Unregister on Structure Destruction (SceneObjectFactory or removal handler):**

```javascript
// In removeObjectFromScene() or object_removed handler
if (objectType === 'market') {
    const chunkKey = `${Math.floor(position.x / 50)},${Math.floor(position.z / 50)}`;
    this.game.gameState.unregisterMarket(chunkKey, objectId);
}

if (objectType === 'bakery') {
    const chunkKey = `${Math.floor(position.x / 50)},${Math.floor(position.z / 50)}`;
    this.game.gameState.unregisterBakery(chunkKey, objectId);

    // Also despawn baker if one exists
    if (this.game.bakerController) {
        this.game.bakerController.onBakeryDestroyed(objectId);
    }
}
```

**Unregister on Chunk Unload (ChunkManager):**

```javascript
// In ChunkManager.disposeChunk() or unloadChunk()
const chunkKey = `${gridX},${gridZ}`;

// Clear market cache for this chunk
if (this.game.gameState?.marketsByChunk) {
    this.game.gameState.marketsByChunk.delete(chunkKey);
}

// Clear bakery cache for this chunk
if (this.game.gameState?.bakeriesByChunk) {
    this.game.gameState.bakeriesByChunk.delete(chunkKey);
}

// Notify baker controller of chunk unload (despawn bakers in this chunk)
if (this.game.bakerController) {
    this.game.bakerController.onChunkUnloaded(chunkKey);
}
```

---

## Queue Race Condition Fix (CRITICAL)

**Problem:** Bakeries/markets use `StructureCreationQueue` for frame-spread creation. This creates a race condition:

```
Timeline:
1. object_added arrives → Bakery queued (not yet created)
2. object_removed arrives → findObjectById returns null → unregister skipped!
3. Queue processes → Bakery created → registered in GameState
4. Result: "Ghost" registry entry - baker can spawn at non-existent bakery
```

**Fix: MessageRouter.js handleObjectRemoved**

Add bakery/market to the fallback unregister (alongside bandit, bear, deer structures):

```javascript
// In handleObjectRemoved(), at the very start:
// Remove from structure creation queue if still queued (prevents ghost registration)
const queue = getStructureCreationQueue();
queue.removeQueued(payload.objectId);

// Later, in the fallback unregister section:
if (this.game.gameState) {
    const chunkKey = objectToRemove?.userData?.chunkKey || payload.chunkId?.replace('chunk_', '');

    if (chunkKey) {
        // ... existing bandit/bear/deer unregisters ...

        // Baker structures: bakery
        const isBakeryStructure = objectToRemove?.userData?.type === 'bakery' ||
            payload.name === 'bakery';
        if (isBakeryStructure) {
            this.game.gameState.unregisterBakery(chunkKey, payload.objectId);
            // Also despawn baker if exists
            this.game.bakerController?.onBakeryDestroyed(payload.objectId);
        }

        // Market structures (baker also uses these)
        const isMarketStructure = objectToRemove?.userData?.type === 'market' ||
            payload.name === 'market';
        if (isMarketStructure) {
            this.game.gameState.unregisterMarket(chunkKey, payload.objectId);
        }
    }
}
```

**Why this matters for baker:**
1. Player places bakery near dock/market
2. Player removes bakery quickly (before queue processes)
3. Ship arrives at dock
4. Baker tries to spawn at "ghost" bakery registry entry
5. Baker spawns at empty ground / crashes

---

## Ship Arrival Timing Fix

**Problem:** When ship arrives, bakeries might still be queued (not yet registered). The `_findBakeryNearPosition()` won't find them.

**Solution:** The ship arrival event is infrequent, so this is less critical than tick-based spawn checks. However, we should handle it gracefully:

```javascript
onDockShipSpawned(payload) {
    const { dockId, dockPosition } = payload;

    // Find market near this dock (uses cached positions)
    const market = this._findMarketNearPosition(dockPosition, 20);
    if (!market) return;  // No market, or market still queued - skip this ship

    // Find bakery near this market (uses cached positions)
    const bakery = this._findBakeryNearPosition(market.position, 20);
    if (!bakery) return;  // No bakery, or bakery still queued - skip this ship

    // Check if bakery already has a baker
    if (this.bakers.has(bakery.id)) return;

    // Verify bakery object still exists (not a ghost entry)
    const structure = this.gameState.getStructureById(bakery.id);
    if (!structure?.object) {
        // Ghost entry - unregister and skip
        const chunkKey = `${Math.floor(bakery.position.x / 50)},${Math.floor(bakery.position.z / 50)}`;
        this.gameState.unregisterBakery(chunkKey, bakery.id);
        return;
    }

    // Spawn baker at this bakery
    this._spawnBaker(bakery);
}
```

**Key difference from tick-based AI:**
- Bandits check spawns every tick → timing fix critical
- Baker checks spawns only on ship arrival (infrequent) → graceful skip is acceptable
- Next ship arrival will find the bakery once it's registered

---

**BakerController Cleanup Handlers:**

```javascript
// When bakery is destroyed - despawn its baker
onBakeryDestroyed(bakeryId) {
    const entity = this.bakers.get(bakeryId);
    if (!entity) return;

    // Broadcast despawn to peers
    this.broadcastP2P({
        type: 'baker_despawn',
        bakeryId: bakeryId,
        reason: 'bakery_destroyed'
    });

    // Clean up visual
    this._disposeBaker(entity);
    this.bakers.delete(bakeryId);
}

// When chunk unloads - despawn bakers whose home is in that chunk
onChunkUnloaded(chunkKey) {
    for (const [bakeryId, entity] of this.bakers) {
        const homeChunkX = Math.floor(entity.homePosition.x / 50);
        const homeChunkZ = Math.floor(entity.homePosition.z / 50);
        const entityChunkKey = `${homeChunkX},${homeChunkZ}`;

        if (entityChunkKey === chunkKey) {
            this._disposeBaker(entity);
            this.bakers.delete(bakeryId);
        }
    }
}

_disposeBaker(entity) {
    // Remove name tag
    if (this.game?.nameTagManager && entity.mesh) {
        this.game.nameTagManager.removeNameTag(entity.mesh);
    }

    // Dispose visual
    if (entity.visual) {
        entity.visual.dispose();
    }

    // Remove mesh from scene
    if (entity.mesh?.parent) {
        entity.mesh.parent.remove(entity.mesh);
    }

    entity.mesh = null;
    entity.visual = null;
}
```

**Implementation (in BakerController or BakerManager):**
```javascript
// Listen for ship arrivals
onDockShipSpawned(payload) {
    const { dockId, dockPosition } = payload;

    // Find market near this dock (uses cached positions)
    const market = this._findMarketNearPosition(dockPosition, 20);
    if (!market) return;

    // Find bakery near this market (uses cached positions)
    const bakery = this._findBakeryNearPosition(market.position, 20);
    if (!bakery) return;

    // Check if bakery already has a baker
    if (this.bakers.has(bakery.id)) return;

    // Spawn baker at this bakery
    this._spawnBaker(bakery);
}

// Optimized search - only iterates cached markets (0-5 per 9 chunks)
// instead of ALL objects (100-500 per 9 chunks)
_findMarketNearPosition(position, maxDist) {
    const maxDistSq = maxDist * maxDist;
    const chunkX = Math.floor(position.x / 50);
    const chunkZ = Math.floor(position.z / 50);

    let nearest = null;
    let nearestDistSq = maxDistSq;

    // Search 3x3 chunks
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            const chunkKey = `${chunkX + dx},${chunkZ + dz}`;
            const markets = this.gameState.getMarketsInChunk(chunkKey);

            for (const market of markets) {
                const mx = market.position.x - position.x;
                const mz = market.position.z - position.z;
                const distSq = mx * mx + mz * mz;

                if (distSq < nearestDistSq) {
                    nearestDistSq = distSq;
                    nearest = market;
                }
            }
        }
    }

    return nearest;
}

// Same pattern for bakeries
_findBakeryNearPosition(position, maxDist) {
    const maxDistSq = maxDist * maxDist;
    const chunkX = Math.floor(position.x / 50);
    const chunkZ = Math.floor(position.z / 50);

    let nearest = null;
    let nearestDistSq = maxDistSq;

    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            const chunkKey = `${chunkX + dx},${chunkZ + dz}`;
            const bakeries = this.gameState.getBakeriesInChunk(chunkKey);

            for (const bakery of bakeries) {
                const bx = bakery.position.x - position.x;
                const bz = bakery.position.z - position.z;
                const distSq = bx * bx + bz * bz;

                if (distSq < nearestDistSq) {
                    nearestDistSq = distSq;
                    nearest = bakery;
                }
            }
        }
    }

    return nearest;
}
```

### No Death/Fleeing States

Baker is NOT targetable by enemies. Simplifies state machine significantly.

### Bakery Destruction = Baker Despawn

If bakery is destroyed, baker immediately despawns. No respawn logic needed.

### State Machine Gaps (Remaining)

| Gap | Issue | Required Addition |
|-----|-------|-------------------|
| Stuck Timeout | No auto-recovery after being stuck | Add 60-second timeout → retry previous task |
| Authority Persistence | State lost on authority transfer | Save `pendingTask`, `targetId`, `carryingItems` |
| Error Transitions | Incomplete error handling | All states need → stuck fallback |

### Performance Gaps

| Gap | Pattern Source | Required Addition |
|-----|----------------|-------------------|
| Detection Throttle | AIController.js:~line 450 | 500ms minimum between target scans |
| Frame Counter | TerrainSystem | Use `this._frameCount % N` for all periodic checks |
| Object Pools | AIController | Pool arrays for search results, path nodes |
| Pending State Queue | AIController | Queue state changes during transitions |
| Chunk Unload Cleanup | EntityManager | Listen for `chunkUnloaded` event, remove baker if home chunk unloads |
| Name Tag Cleanup | NameTagManager | Call `removeNameTag()` on disposal |

### Inventory/Server Gaps

| Gap | Issue | Required Addition |
|-----|-------|-------------------|
| NPC Handlers Missing | `npc_deposit_inventory` doesn't exist | Full server handler implementation |
| Lock Bypass | NPCs can't use player lock system | Add `isNPC: true` flag to bypass lock check |
| Race Conditions | Player and NPC accessing same inventory | Server-side queue for NPC operations |
| Grid Position | Plan doesn't specify slot selection | Find first empty slot (x,y) in 4x4 grid |
| Structure Destruction | Baker's bakery destroyed while away | Return to spawn point, enter `stuck` state |

### Visual/Animation Gaps

| Gap | Issue | Required Addition |
|-----|-------|-------------------|
| Animation Contradiction | Plan says "static" but baker walks | Use AIEnemy pattern: update mixer when `moving=true` |
| Name Tag Integration | Missing registration details | Call `NameTagManager.addNameTag(mesh, 'Baker', {...})` |
| Disposal Pattern | No cleanup on remove | Dispose geometry, materials, remove from scene |
| Position Updates | How mesh position syncs | `mesh.position.copy(entity.position)` in update loop |

### P2P Message Gaps

**Current message definitions are incomplete. Required fields:**

```javascript
// Spawn message - COMPLETE VERSION
{
    type: 'baker_spawn',
    bakeryId: string,
    position: {x, y, z},
    homePosition: {x, y, z},
    authorityId: string,
    spawnTime: number,        // MISSING - for respawn timing
    state: string,            // MISSING - initial state
    carrying: array           // MISSING - initial inventory
}

// State broadcast - COMPLETE VERSION
{
    type: 'baker_state',
    bakeryId: string,
    position: {x, y, z},
    rotation: number,         // Y-axis rotation
    state: string,
    carrying: array,
    moving: boolean,          // MISSING - for animation
    targetPosition: {x, y, z}, // MISSING - for interpolation
    velocity: {x, z},         // MISSING - for prediction
    health: number            // MISSING - if damageable
}

// Authority transfer - ENTIRELY MISSING
{
    type: 'baker_authority_transfer',
    bakeryId: string,
    newAuthorityId: string,
    pendingState: {
        state: string,
        targetId: string,
        carrying: array,
        taskProgress: number
    }
}
```

### Complete P2P System (From Bandit AIController.js)

The bandit code has been updated with robust P2P patterns. Baker should reuse these exactly.

#### Baker Entity Data Structure

```javascript
// All fields a baker entity needs (adapted from bandit)
const entity = {
    // === IDENTITY ===
    bakeryId: string,                // Unique ID (bakery structure ID)
    type: 'baker',                   // Entity type constant
    authorityId: string,             // Current simulating client
    spawnedBy: string,               // Original spawning client
    spawnTime: number,               // Spawn timestamp (ms)

    // === POSITION ===
    homePosition: { x, z },          // Bakery position (return point)
    position: { x, y, z },           // Current world position
    rotation: number,                // Y-axis rotation (radians)

    // === STATE MACHINE ===
    state: 'idle',                   // Current state
    targetId: null,                  // Current target (tree/market ID)
    stuckReason: null,               // Message if stuck
    stuckTime: 0,                    // Timestamp when stuck state entered (ms)
    previousTask: null,              // { task, target } - what to retry after stuck timeout

    // === PATHFINDING ===
    path: [],                        // Array of {x, z} waypoints
    pathIndex: 0,                    // Current waypoint index
    lastPathTime: 0,                 // Last pathfinding calculation time
    pathFailures: 0,                 // Consecutive path failures (3 → stuck)

    // === INVENTORY ===
    carrying: [],                    // Items being carried (max 2 apples)

    // === VISUAL/3D ===
    mesh: null,                      // THREE.Object3D reference
    visual: null,                    // BakerVisual controller instance

    // === NON-AUTHORITY INTERPOLATION ===
    targetPosition: null,            // {x, y, z} to interpolate toward
    targetRotation: null,            // Rotation to interpolate toward
};
```

#### Authority Calculation (Reuse Bandit Pattern)

```javascript
// From AIController.js lines 1404-1433
_calculateAuthority(bakeryId) {
    const entity = this.bakers.get(bakeryId);
    if (!entity) return null;

    const CHUNK_SIZE = 50;
    const homeChunkX = Math.floor(entity.homePosition.x / CHUNK_SIZE);
    const homeChunkZ = Math.floor(entity.homePosition.z / CHUNK_SIZE);

    // Get players in 3x3 chunks around bakery
    const chunkKeys = this._get3x3ChunkKeys(homeChunkX, homeChunkZ);
    const players = this.getPlayersInChunks(chunkKeys);

    if (!players || players.size === 0) return null;

    // Find LOWEST clientId - deterministic for all clients
    let lowestId = null;
    for (const playerId of players) {
        if (lowestId === null || playerId < lowestId) {
            lowestId = playerId;
        }
    }
    return lowestId;
}
```

#### Authority Transfer Events

```javascript
// When peer disconnects (AIController.js lines 1463-1500)
onPeerDisconnected(peerId) {
    for (const [bakeryId, entity] of this.bakers) {
        if (entity.authorityId === peerId) {
            const newAuthority = this._calculateAuthority(bakeryId);
            if (newAuthority) {
                entity.authorityId = newAuthority;

                // If WE are taking over authority
                if (newAuthority === this.clientId) {
                    // Snap position to last known authoritative position
                    if (entity.targetPosition) {
                        entity.position.x = entity.targetPosition.x;
                        entity.position.y = entity.targetPosition.y;
                        entity.position.z = entity.targetPosition.z;
                    }
                    // Sync mesh
                    if (entity.mesh) {
                        entity.mesh.position.set(
                            entity.position.x,
                            entity.position.y,
                            entity.position.z
                        );
                    }
                    // Immediately broadcast so other peers sync to us
                    this._broadcastEntityState(entity, bakeryId);
                }
            }
        }
    }
}

// When peer joins chunk (AIController.js lines 1579-1619)
onPeerJoinedChunk(peerId, chunkKey) {
    const [peerChunkX, peerChunkZ] = chunkKey.split(',').map(Number);

    for (const [bakeryId, entity] of this.bakers) {
        const homeChunkX = Math.floor(entity.homePosition.x / CHUNK_SIZE);
        const homeChunkZ = Math.floor(entity.homePosition.z / CHUNK_SIZE);
        const dx = Math.abs(peerChunkX - homeChunkX);
        const dz = Math.abs(peerChunkZ - homeChunkZ);

        if (dx <= 1 && dz <= 1) {
            // Peer is near this baker - recalculate authority
            const newAuthority = this._calculateAuthority(bakeryId);
            if (newAuthority && newAuthority !== entity.authorityId) {
                const wasMe = entity.authorityId === this.clientId;
                const isNowMe = newAuthority === this.clientId;
                entity.authorityId = newAuthority;

                if (isNowMe && !wasMe) {
                    // Snap and broadcast immediately
                    if (entity.targetPosition) {
                        entity.position.x = entity.targetPosition.x;
                        entity.position.y = entity.targetPosition.y;
                        entity.position.z = entity.targetPosition.z;
                    }
                    this._broadcastEntityState(entity, bakeryId);
                }
            }
        }
    }
}
```

#### Interpolation Algorithm (Velocity-Based, Not Lerp)

```javascript
// From AIController.js lines 1309-1391
_interpolateEntity(entity, deltaTime) {
    if (!entity.targetPosition) return;

    const MOVE_SPEED = 0.8; // Baker move speed
    const SNAP_THRESHOLD_SQ = 0.0025;  // 0.05^2
    const TELEPORT_THRESHOLD_SQ = 100; // 10^2 - desync recovery

    const dx = entity.targetPosition.x - entity.position.x;
    const dz = entity.targetPosition.z - entity.position.z;
    const distanceSq = dx * dx + dz * dz;

    if (distanceSq < SNAP_THRESHOLD_SQ) {
        // Close enough - snap
        entity.position.x = entity.targetPosition.x;
        entity.position.z = entity.targetPosition.z;
    } else if (distanceSq > TELEPORT_THRESHOLD_SQ) {
        // Too far - TELEPORT to recover from desync
        entity.position.x = entity.targetPosition.x;
        entity.position.z = entity.targetPosition.z;
    } else {
        // Move toward target at constant speed
        const secondsDelta = deltaTime / 1000;
        const moveStep = MOVE_SPEED * secondsDelta;
        const moveStepSq = moveStep * moveStep;

        if (moveStepSq >= distanceSq) {
            entity.position.x = entity.targetPosition.x;
            entity.position.z = entity.targetPosition.z;
        } else {
            const distance = Math.sqrt(distanceSq);
            entity.position.x += (dx / distance) * moveStep;
            entity.position.z += (dz / distance) * moveStep;
        }
    }

    // Y position - gentle lerp for terrain
    if (entity.targetPosition.y !== undefined) {
        entity.position.y += (entity.targetPosition.y - entity.position.y) * 0.1;
    }

    // Rotation - face movement direction or use synced rotation
    let targetRotation = (distanceSq > 0.01)
        ? Math.atan2(dx, dz)
        : (entity.targetRotation ?? entity.rotation);

    let rotDiff = targetRotation - entity.rotation;
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
    const maxRotation = 2.1 * (deltaTime / 1000);
    entity.rotation += Math.max(-maxRotation, Math.min(maxRotation, rotDiff));

    // Sync mesh
    if (entity.mesh) {
        entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
        entity.mesh.rotation.y = entity.rotation;
    }
}
```

#### Pending States (Race Condition Handling)

```javascript
// Handle state message arriving before spawn message
handleStateMessage(data) {
    const { bakeryId } = data;
    const entity = this.bakers.get(bakeryId);

    if (!entity) {
        // Entity doesn't exist yet - store pending state
        this.pendingStates = this.pendingStates || new Map();
        this.pendingStates.set(bakeryId, data);
        return;
    }

    // Ignore if we're authority
    if (entity.authorityId === this.clientId) return;

    // Apply state...
    entity.targetPosition = data.position;
    entity.targetRotation = data.rotation;
    entity.state = data.state;
    // ... etc
}

// When spawn message arrives, check for pending state
handleSpawnMessage(data) {
    // ... create entity ...

    // Apply any pending state that arrived before spawn
    if (this.pendingStates?.has(bakeryId)) {
        const pending = this.pendingStates.get(bakeryId);
        entity.targetPosition = pending.position;
        entity.state = pending.state;
        // ... etc
        this.pendingStates.delete(bakeryId);
    }
}
```

#### Sync for New Peers

```javascript
// Get all bakers for syncing to new peer
getActiveBakersForSync() {
    const result = [];
    for (const [bakeryId, entity] of this.bakers) {
        result.push({
            bakeryId,
            spawnedBy: entity.spawnedBy,
            spawnTime: entity.spawnTime,
            position: { ...entity.position },
            homePosition: { ...entity.homePosition },
            state: entity.state,
            carrying: [...entity.carrying],
            authorityId: entity.authorityId,
        });
    }
    return result;
}

// Receive sync from existing peer
syncBakersFromPeer(bakers) {
    for (const data of bakers) {
        if (this.bakers.has(data.bakeryId)) continue;

        const entity = {
            bakeryId: data.bakeryId,
            authorityId: data.authorityId || data.spawnedBy,
            spawnedBy: data.spawnedBy,
            spawnTime: data.spawnTime,
            homePosition: { ...data.homePosition },
            position: { ...data.position },
            state: data.state || 'idle',
            carrying: data.carrying || [],
            // ... initialize other fields
        };

        // Create visual
        this._createBakerVisual(entity);
        this.bakers.set(data.bakeryId, entity);
    }
}
```

---

## State Machine

```
┌─────────────────────────────────────────────────────────────────┐
│                         BAKER STATES                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  idle ──► seeking_apples ──► collecting_apples ──► returning    │
│    ▲                                                    │        │
│    │                                                    ▼        │
│    │◄─────────────────────────────────────────── depositing     │
│    │                                                             │
│    └──► seeking_firewood ──► collecting_firewood ──► returning  │
│    ▲                                                    │        │
│    │                                                    ▼        │
│    │◄─────────────────────────────────────────── depositing     │
│    │                                                             │
│    └──► waiting_for_tarts ──► collecting_tarts ──► delivering   │
│    ▲                                                    │        │
│    └────────────────────────────────────────────────────┘        │
│                                                                  │
│  SPECIAL STATE:                                                  │
│  stuck ◄── (any state, 60s timeout → retry previous task)       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### State Descriptions

| State | Description | Transition Condition |
|-------|-------------|---------------------|
| `idle` | At bakery, deciding next task | Check every 6 seconds → next task |
| `seeking_apples` | Pathfinding to nearest valid apple tree | Arrival → collecting_apples |
| `collecting_apples` | Sending server request to take apples | Server response → returning (or seek next tree) |
| `seeking_firewood` | Pathfinding to market with firewood | Arrival → collecting_firewood |
| `collecting_firewood` | Taking firewood from market inventory | Complete → returning |
| `waiting_for_tarts` | At bakery, waiting for production (60 ticks per apple) | Tarts ready → collecting_tarts |
| `collecting_tarts` | Taking tarts from bakery inventory | Complete → delivering |
| `delivering` | Pathfinding to market to deposit tarts | Arrival + deposit → idle |
| `returning` | Pathfinding back to bakery | Arrival → depositing |
| `depositing` | Putting items into bakery inventory | Complete → idle |
| `stuck` | Cannot complete current task | 60s timeout → retry, OR player resolves |

### Stuck Conditions & Messages

| Condition | Message to Player |
|-----------|-------------------|
| No apple trees in range | "I cannot find any apple trees nearby." |
| Apple trees have no apples | "The apple trees are empty." |
| No market nearby | "I cannot find a market nearby." |
| Market has no firewood | "The market has no firewood." |
| Bakery inventory full | "The bakery storage is full." |
| Market inventory full | "The market cannot hold more tarts." |
| Path blocked | "I cannot reach my destination." |

---

## Code Research Results

### 1. Apple Collection System (Inventory-Based)

**Files:** `SpawnTasks.js`, `MessageHandlers.js`, `CrateInventoryUI.js`

**Apple trees store apples in their INVENTORY (3x3 grid, 9 slots max).**
- Trees regrow 2 apples every 600 ticks (10 minutes)
- Players open tree like a crate and take apples
- Baker uses simplified server message (no lock needed)

#### Apple Tree Detection & Filtering

```javascript
// Find nearest VALID apple tree (exclude planted trees still growing)
_findNearestAppleTree(entityPosition, chunkX, chunkZ) {
    const chunkKeys = this._get3x3ChunkKeys(chunkX, chunkZ);
    const maxRangeSq = 50 * 50; // 50 unit search radius

    let nearestTree = null;
    let nearestDistSq = maxRangeSq;

    for (const chunkKey of chunkKeys) {
        const objects = this.chunkManager.chunkObjects.get(chunkKey);
        if (!objects) continue;

        for (const obj of objects) {
            if (!this._isValidAppleTree(obj)) continue;

            const dx = obj.position.x - entityPosition.x;
            const dz = obj.position.z - entityPosition.z;
            const distSq = dx * dx + dz * dz; // NO Math.sqrt!

            if (distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearestTree = obj;
            }
        }
    }

    return nearestTree;
}

// Filter: only natural trees OR fully-grown planted trees
_isValidAppleTree(obj) {
    if (obj.userData?.modelType !== 'apple') return false;

    // Check if planted and still growing
    const objectId = obj.userData?.objectId || '';
    const isPlanted = objectId.startsWith('planted_apple_');

    if (isPlanted) {
        // Planted tree - only valid if FULLY GROWN
        // (isGrowing removed and plantedAtTick removed = fully grown)
        if (obj.userData?.isGrowing || obj.userData?.plantedAtTick) {
            return false; // Still growing
        }
    }

    return true;
}
```

#### Apple Collection Flow (Server Message)

```javascript
// Baker sends this message when at tree
networkManager.sendMessage('npc_collect_apples', {
    npcType: 'baker',
    bakeryId: entity.bakeryId,
    treeId: tree.userData.objectId,
    chunkId: `chunk_${tree.userData.chunkKey}`,
    maxCount: 2  // Collect up to 2 apples
});

// Server responds with collected apples (or empty array if none)
// Baker adds to personal inventory and decides next action
```

#### Multi-Tree Collection Logic

Baker collects 2 apples every 10 minutes. If first tree has < 2:
1. Take what's available from first tree
2. Find next nearest tree
3. Continue until 2 apples collected or no trees with apples

```javascript
// In collecting_apples state handler
handleAppleCollectionResponse(data) {
    const { collected, treeId } = data;

    // Add collected apples to baker's inventory
    for (const apple of collected) {
        entity.carrying.push(apple);
    }

    // Need more apples?
    if (entity.carrying.length < 2) {
        // Mark this tree as checked (temporary, cleared on next cycle)
        this._checkedTrees.add(treeId);

        // Find next tree
        const nextTree = this._findNearestAppleTree(entity.position, chunkX, chunkZ);
        if (nextTree && !this._checkedTrees.has(nextTree.userData.objectId)) {
            entity.state = 'seeking_apples';
            entity.targetTree = nextTree;
        } else {
            // No more trees with apples - return with what we have
            if (entity.carrying.length > 0) {
                entity.state = 'returning';
            } else {
                entity.state = 'stuck';
                entity.stuckReason = 'The apple trees are empty.';
            }
        }
    } else {
        // Got 2 apples - return to bakery
        entity.state = 'returning';
        this._checkedTrees.clear();
    }
}
```

---

### 2. Merchant Dialogue System

**Files:** `DockMerchantSystem.js`, `TrapperSystem.js`, `InteractionManager.js`, `ui.js`

**Key Findings:**
- Proximity detection runs every frame in `InteractionManager.checkProximityToObjects()`
- Button shown when `nearMerchant && !isMoving`
- Dialogue modal with close button pattern
- Uses squared distances (no Math.sqrt)

**Baker Dialogue Pattern (copy from merchant):**
```javascript
// In BakerController - proximity check
getBakerNearPosition(playerPosition) {
    const INTERACTION_RADIUS_SQ = 2.0 * 2.0; // 2 units

    for (const [bakeryId, data] of this.bakers) {
        const dx = playerPosition.x - data.entity.position.x;
        const dz = playerPosition.z - data.entity.position.z;
        const distSq = dx * dx + dz * dz;

        if (distSq <= INTERACTION_RADIUS_SQ) {
            return { bakeryId, position: data.entity.position, state: data.state };
        }
    }
    return null;
}

// Dialogue message based on state
getBakerDialogue(bakeryId) {
    const data = this.bakers.get(bakeryId);
    if (!data) return "The baker is not available.";

    if (data.state === 'stuck') {
        return data.stuckReason || "I'm stuck and need help!";
    }

    const stateMessages = {
        'idle': "I'm ready to work. The bakery is running smoothly.",
        'seeking_apples': "I'm looking for apple trees.",
        'harvesting_apples': "I'm collecting apples.",
        'seeking_firewood': "I'm heading to the market for firewood.",
        'waiting_for_tarts': "The apple tarts are baking...",
        'delivering': "I'm delivering fresh tarts to the market."
    };

    return stateMessages[data.state] || "I'm busy right now.";
}
```

---

## Player Dialogue Integration (Copy Merchant Pattern Exactly)

### 1. domCache additions (ui.js, lines 29-32)

```javascript
// Add alongside existing merchant entries
talkBakerBtn: null,
bakerDialogueModal: null,
bakerDialogueText: null,
bakerDialogueClose: null,
```

### 2. initDOMCache additions (ui.js, lines 82-85)

```javascript
// Add alongside existing merchant entries
domCache.talkBakerBtn = document.getElementById('talkBakerBtn');
domCache.bakerDialogueModal = document.getElementById('bakerDialogueModal');
domCache.bakerDialogueText = document.getElementById('bakerDialogueText');
domCache.bakerDialogueClose = document.getElementById('bakerDialogueClose');
```

### 3. UI functions (ui.js, add after updateMerchantButton ~line 1264)

```javascript
// Show/hide the baker talk button (copy of updateMerchantButton)
updateBakerButton(nearBaker, isMoving = false) {
    if (!domCache.initialized) initDOMCache();

    const btn = domCache.talkBakerBtn;
    if (btn) {
        btn.style.display = (nearBaker && !isMoving) ? 'inline-block' : 'none';
    }
},

// Show the baker dialogue modal with text (copy of showMerchantDialogue)
showBakerDialogue(dialogueText) {
    if (!domCache.initialized) initDOMCache();

    const modal = domCache.bakerDialogueModal;
    const textEl = domCache.bakerDialogueText;

    if (modal && textEl) {
        textEl.textContent = dialogueText;
        modal.style.display = 'flex';
    }
},

// Hide the baker dialogue modal (copy of hideMerchantDialogue)
hideBakerDialogue() {
    if (!domCache.initialized) initDOMCache();

    const modal = domCache.bakerDialogueModal;
    if (modal) {
        modal.style.display = 'none';
    }
},

// Setup baker dialogue close button (copy of setupMerchantDialogue)
setupBakerDialogue() {
    if (!domCache.initialized) initDOMCache();

    const closeBtn = domCache.bakerDialogueClose;
    const modal = domCache.bakerDialogueModal;

    if (closeBtn) {
        closeBtn.onclick = () => {
            if (modal) modal.style.display = 'none';
        };
    }

    // Also close when clicking outside the dialogue content
    if (modal) {
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        };
    }
},
```

### 4. setupButtonCallbacks addition (ui.js, add after merchant button ~line 1898)

```javascript
// Baker talk button (copy of merchant pattern)
setupButton(document.getElementById('talkBakerBtn'), () => {
    if (callbacks.onTalkToBaker) {
        callbacks.onTalkToBaker();
    }
});

// Setup baker dialogue close button
this.setupBakerDialogue();
```

### 5. InteractionManager addition (InteractionManager.js, add after trapper ~line 541)

```javascript
// BAKER INTERACTION: Check if player is near a baker NPC
if (this.game.bakerController) {
    this.gameState.nearBaker = this.game.bakerController.getBakerNearPosition(this.game.playerObject.position);
}

// Update baker button visibility
ui.updateBakerButton(this.gameState.nearBaker, this.gameState.isMoving);
```

### 6. game.js callback (add after onTalkToTrapper ~line 670)

```javascript
onTalkToBaker: () => {
    // Talk to baker - show dialogue based on state
    if (this.gameState.nearBaker) {
        const dialogue = this.bakerController.getBakerDialogue(this.gameState.nearBaker.bakeryId);
        ui.showBakerDialogue(dialogue);
    }
},
```

### 7. client.html button (add after talkTrapperBtn ~line 404)

```html
<button id="talkBakerBtn" style="display: none;">Baker</button>
```

### 8. client.html modal (add after trapperDialogueModal ~line 853)

```html
<!-- BAKER DIALOGUE MODAL -->
<div id="bakerDialogueModal" class="baker-dialogue-modal" style="display: none;">
    <div class="baker-dialogue-content">
        <h3 class="baker-dialogue-title">Baker</h3>
        <p id="bakerDialogueText" class="baker-dialogue-text"></p>
        <div class="baker-dialogue-buttons">
            <button id="bakerDialogueClose" class="baker-dialogue-btn">OK</button>
        </div>
    </div>
</div>
```

### 9. client.html CSS (add after trapper styles ~line 2100)

```css
/* BAKER DIALOGUE STYLES (copy of merchant with different color) */
.baker-dialogue-modal {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
}

.baker-dialogue-content {
    background: #3A342D;
    border: 3px solid #CC7722;  /* Orange/brown for baker */
    border-radius: 8px;
    padding: 30px;
    max-width: 450px;
    text-align: center;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8);
}

.baker-dialogue-title {
    color: #CC7722;  /* Orange/brown for baker */
    font-size: 24px;
    font-weight: bold;
    margin: 0 0 20px 0;
    font-family: Arial, sans-serif;
}

.baker-dialogue-text {
    color: #ddd;
    font-size: 14px;
    line-height: 1.6;
    margin: 0 0 25px 0;
    text-align: left;
    white-space: pre-line;
}

.baker-dialogue-buttons {
    display: flex;
    justify-content: center;
}

.baker-dialogue-btn {
    padding: 12px 40px;
    background: #CC7722;  /* Orange/brown for baker */
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 16px;
    font-weight: bold;
    cursor: pointer;
    transition: background 0.2s;
}

.baker-dialogue-btn:hover {
    background: #AA5511;
}
```

---

### 3. Bakery Production System

**Files:** `server/BakerySystem.js`, `CrateInventoryUI.js`, `MessageHandlers.js`

**Key Findings:**
- Production: `apple` → `appletart` in **60 ticks (1 minute)**
- Requires active firewood (durability > 0)
- Firewood depletes at 2 durability/minute
- Quality = average of apple quality + bakery structure quality

**Check Bakery State:**
```javascript
// Check if bakery has ingredients
const inventory = bakery.userData.inventory;
const hasApple = inventory?.items?.some(i => i.type === 'apple') ?? false;
const hasFirewood = inventory?.items?.some(i =>
    i.type.endsWith('firewood') && i.durability > 0
) ?? false;

// Check for ready tarts
const readyTarts = inventory?.items?.filter(i => i.type === 'appletart') ?? [];

// Check processing progress
const processingApples = inventory?.items?.filter(i =>
    i.type === 'apple' && i.processingStartTick
) ?? [];

for (const apple of processingApples) {
    const ticksElapsed = serverTick - apple.processingStartTick;
    const progress = ticksElapsed / apple.processingDurationTicks; // 0 to 1
    if (progress >= 1.0) {
        // This apple is ready to become a tart
    }
}
```

**Allowed Bakery Items:**
- `apple` (input, transforms to appletart)
- `appletart` (output)
- `oakfirewood`, `pinefirewood`, `firfirewood`, `cypressfirewood`, `applefirewood` (fuel)

---

### 4. Banned Usernames List

**File:** `server/AuthManager.js` (lines 877-890)

**Current List Location:**
```javascript
static BLOCKED_USERNAME_PATTERNS = [
    // ... existing patterns ...
    // Admin impersonation
    'admin', 'moderator', 'owner', 'developer', 'staff', 'official', 'system'
];
```

**Action Required:** Add `'baker'` to the admin impersonation section (line 889)

---

### 5. AI State Machine Patterns (Performance)

**Files:** `AIController.js`, `DeerController.js`

**Key Performance Patterns to Use:**

1. **Authority System** - Only one client simulates, others interpolate:
```javascript
if (entity.authorityId !== this.clientId) {
    this._interpolateEntity(entity, deltaTime);
    return;
}
// Full simulation only for authority
```

2. **Throttled Idle Checks** - Check targets less often when idle:
```javascript
if (entity.state === 'idle') {
    if (this._frameCount % 90 === 0) { // Every 1.5 seconds at 60fps
        this._checkForWork(entity);
    }
}
```

3. **Squared Distances** - Never use Math.sqrt in hot paths:
```javascript
const distSq = dx * dx + dz * dz;
if (distSq < rangeSq) { ... } // Compare squared values
```

4. **Object Pooling** - Reuse arrays and objects:
```javascript
this._targetCache.length = 0; // Clear, don't allocate new
```

5. **Pathfinding Cache** - Only recalculate every 10 seconds:
```javascript
if (now - entity.lastPathTime < 10000) return;
entity.lastPathTime = now;
entity.path = this.findPath(from, to);
```

6. **Distance Culling** - Update distant bakers less often:
```javascript
if (distSq > 2500) { // > 50 units
    if (this._frameCount % 8 !== 0) continue; // Every 8th frame
}
```

7. **Broadcast Message Reuse** - Pre-allocate message template:
```javascript
this._broadcastMsg = { type: 'baker_state', bakeryId: '', position: {x:0,y:0,z:0}, state: '' };
// Reuse and mutate instead of creating new objects
```

8. **Spawn Presence Caching** - Cache bakery locations per chunk:
```javascript
updateBakeryPresence(chunkX, chunkZ) {
    if (chunkX === this._lastChunkX && chunkZ === this._lastChunkZ) return;
    this._hasBakeriesInRange = /* check 3x3 grid */;
}
```

---

### 6. Inventory Interaction

**Files:** `InventoryUI.js`, `CrateInventoryUI.js`, `MessageHandlers.js`

**Key Findings:**
- Requires **lock** before modifying inventory
- Use `save_crate_inventory` message to sync
- Bakery: 4x4 grid (16 slots)

**Baker Inventory Operations:**

```javascript
// Baker's personal inventory (simple array, no lock needed)
entity.carrying = []; // Max 4 items

// Deposit to bakery (grid-based)
networkManager.sendMessage('npc_deposit_inventory', {
    npcType: 'baker',
    bakeryId: entity.bakeryId,
    structureId: bakeryId,
    chunkId: `chunk_${chunkKey}`,
    items: items
});

// Collect tarts from bakery (grid-based - like apple trees)
networkManager.sendMessage('npc_collect_from_structure', {
    npcType: 'baker',
    bakeryId: entity.bakeryId,
    structureId: bakeryId,
    chunkId: `chunk_${chunkKey}`,
    itemType: 'appletart',
    count: 10
});

// Collect firewood from market (quantity-based - like ship trading)
networkManager.sendMessage('npc_collect_from_market', {
    npcType: 'baker',
    bakeryId: entity.bakeryId,
    marketId: marketId,
    chunkId: `chunk_${chunkKey}`,
    itemType: 'firewood',
    count: 1
});

// Deposit tarts to market (quantity-based - like ship trading)
networkManager.sendMessage('npc_deposit_to_market', {
    npcType: 'baker',
    bakeryId: entity.bakeryId,
    marketId: marketId,
    chunkId: `chunk_${chunkKey}`,
    items: entity.carrying
});
```

**Server-Side NPC Handlers Needed:**
```javascript
// Grid-based handlers (bakery, trees)
case 'npc_collect_apples':           // Trees → Baker
    await this.handleNPCCollectApples(ws, payload);
    break;
case 'npc_deposit_inventory':        // Baker → Bakery
    await this.handleNPCDeposit(ws, payload);
    break;
case 'npc_collect_from_structure':   // Bakery (tarts) → Baker
    await this.handleNPCCollectFromStructure(ws, payload);
    break;

// Quantity-based handlers (market - like ship trading)
case 'npc_collect_from_market':      // Market (firewood) → Baker
    await this.handleNPCCollectFromMarket(ws, payload);
    break;
case 'npc_deposit_to_market':        // Baker (tarts) → Market
    await this.handleNPCDepositToMarket(ws, payload);
    break;
```

---

## Performance Optimizations Summary

| Optimization | Impact | Implementation |
|--------------|--------|----------------|
| Authority system | HIGH - 75-90% less per-client work | One client per bakery |
| Throttled idle checks | HIGH - 80% fewer checks when idle | Check every 1.5 seconds |
| Squared distances | HIGH - 2-3x faster comparisons | All spatial checks |
| Pathfinding cache | HIGH - recalc only every 10s | Cache path results |
| Object pooling | MEDIUM - consistent frame times | Reuse arrays/objects |
| Distance culling | MEDIUM - far bakers update 75% less | Every 8th frame for distant |
| Broadcast reuse | LOW - saves 500 bytes/broadcast | Pre-allocated message template |
| Spawn caching | HIGH - skip 95% of spawn checks | Cache bakery presence |

---

## Files to Create/Modify

### New Files
| File | Purpose | Est. Lines |
|------|---------|------------|
| `public/ai/BakerController.js` | Main AI logic and state machine | ~600 |
| `public/entity/BakerManager.js` | Entity lifecycle, visual spawning | ~200 |

### Modified Files
| File | Changes |
|------|---------|
| `public/config.js` | Add `BAKER_CONFIG` section |
| `public/core/GameState.js` | Add `bakeryStructuresByChunk` Map |
| `public/network/GameStateManager.js` | Add baker P2P message handlers |
| `public/network/SceneObjectFactory.js` | Register bakery structures with `hasBaker` flag |
| `public/core/GameInitializer.js` | Initialize BakerController |
| `public/game.js` | Add to update loop |
| `public/ui.js` | Add baker dialogue UI (copy merchant pattern) |
| `public/systems/InteractionManager.js` | Add baker proximity check |
| `public/client.html` | Add baker dialogue modal + button |
| `server/AuthManager.js` | Add "baker" to banned usernames (line 889) |
| `server/MessageHandlers.js` | Add NPC inventory handlers |

---

## Implementation Phases

### Phase 1: Setup (~30 min)
- [ ] Add `BAKER_CONFIG` to `config.js`
- [ ] Add `bakeryStructuresByChunk` Map to `GameState.js`
- [ ] Add "baker" to banned usernames in `AuthManager.js`

### Phase 2: Core AI (~2-3 hours)
- [ ] Create `BakerController.js` skeleton (extend BaseAIController patterns)
- [ ] Implement state machine with all states
- [ ] Implement authority system (lowest clientId near bakery)
- [ ] Implement pathfinding (reuse NavigationManager)
- [ ] Implement personal inventory (simple array, max 4 items)

### Phase 3: Resource Interactions (~2 hours)
- [ ] Apple tree detection (reuse InteractionManager pattern)
- [ ] Apple harvesting (10-second timer like player)
- [ ] Server-side NPC inventory handlers
- [ ] Bakery inventory deposit/collect
- [ ] Market inventory deposit/collect

### Phase 4: Visual & Integration (~1-2 hours)
- [ ] Create `BakerManager.js` (clone man.glb with colored apron)
- [ ] Static idle pose (no per-frame animation)
- [ ] Add P2P message handlers to GameStateManager
- [ ] Add to game loop
- [ ] Add name tag "Baker"

### Phase 5: Player Communication (~1 hour)
- [ ] Add baker dialogue modal to client.html
- [ ] Add `updateBakerButton()` to ui.js
- [ ] Add `showBakerDialogue()` to ui.js
- [ ] Add proximity check to InteractionManager
- [ ] Add `onTalkToBaker()` callback to game.js
- [ ] Implement stuck state detection + messages

### Phase 6: Testing & Polish (~1-2 hours)
- [ ] Single-player testing
- [ ] Multiplayer authority transfer testing
- [ ] Performance profiling
- [ ] Edge case handling

---

## Configuration Constants

```javascript
// Add to public/config.js
BAKER_CONFIG: {
    ENABLED: true,

    // Spawning
    SPAWN_DISTANCE: 2.5,              // Units from bakery to spawn
    MARKET_MAX_DISTANCE: 20,          // Bakery must be within 20 units of market

    // Movement
    MOVE_SPEED: 0.8,                  // Slightly slower than player
    PATHFIND_INTERVAL: 10000,         // Recalculate path every 10 seconds

    // Work
    APPLES_PER_TRIP: 2,               // Collect 2 apples per cycle
    COLLECTION_INTERVAL: 600,         // 600 ticks = 10 minutes between apple runs
    APPLE_SEARCH_RADIUS_SQ: 2500,     // 50^2 - search radius for trees
    MARKET_SEARCH_RADIUS_SQ: 2500,    // 50^2 - search radius for markets

    // State Management
    STUCK_TIMEOUT: 60000,             // 60 seconds before auto-retry
    DETECTION_INTERVAL: 360,          // Frames between scans (6 seconds at 60fps)

    // Performance
    FAR_UPDATE_INTERVAL: 8,           // Frames between updates for distant bakers
    FAR_DISTANCE_SQ: 2500,            // 50^2 - distance threshold for culling
    BROADCAST_INTERVAL: 1000,         // ms between state broadcasts

    // Interaction
    INTERACTION_RADIUS_SQ: 4.0,       // 2.0^2 - distance for player to talk
},

// Add to server/ServerConfig.js
BAKERY: {
    MAX_DISTANCE: 20,                 // Must be within 20 units of market
},
```

---

## P2P Message Types (Matching Bandit Pattern)

```javascript
// Spawn message - sent when baker spawns at bakery
{
    type: 'baker_spawn',
    bakeryId: string,           // Bakery structure ID
    spawnedBy: string,          // Client that spawned this baker
    spawnTime: number,          // Date.now() timestamp
    position: {x, y, z},        // Spawn position
    homePosition: {x, z},       // Bakery center
}

// State broadcast - sent every ~1 second by authority client
// Uses POOLED message object to avoid GC pressure
{
    type: 'baker_state',
    bakeryId: string,
    position: {x, y, z},
    rotation: number,           // Y-axis rotation in radians
    state: string,              // Current state name
    targetId: string|null,      // Current target (tree/market ID)
    carrying: [{type, quality}], // Items being carried (max 2)
    moving: boolean,            // True if walking (for animation)
    stuckReason: string|null    // Message if in stuck state
}

// Sync message - sent to new peers joining the game
{
    type: 'baker_sync',
    bakers: [{
        bakeryId: string,
        spawnedBy: string,
        spawnTime: number,
        position: {x, y, z},
        homePosition: {x, z},
        state: string,
        carrying: array,
        authorityId: string,
    }]
}

// Despawn message - sent when bakery is destroyed
{
    type: 'baker_despawn',
    bakeryId: string,
    reason: 'bakery_destroyed'
}
```

**NO authority_transfer message needed** - authority is calculated deterministically by all clients using lowest clientId algorithm. When authority changes, the new authority just starts broadcasting.

**NO death message needed** - baker is not targetable.

### Pooled Broadcast Message (Performance)

```javascript
// In BakerController constructor - preallocate to avoid GC
this._broadcastMsg = {
    type: 'baker_state',
    bakeryId: '',
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
    state: '',
    targetId: null,
    carrying: [],
    moving: false,
    stuckReason: null
};

// Usage in broadcastAuthorityState()
broadcastAuthorityState() {
    for (const [bakeryId, entity] of this.bakers) {
        if (entity.authorityId !== this.clientId) continue;

        // Reuse pooled message object
        const msg = this._broadcastMsg;
        msg.bakeryId = bakeryId;
        msg.position.x = entity.position.x;
        msg.position.y = entity.position.y;
        msg.position.z = entity.position.z;
        msg.rotation = entity.rotation;
        msg.state = entity.state;
        msg.targetId = entity.targetId;
        msg.moving = entity.visual?.isMoving || false;
        msg.stuckReason = entity.stuckReason;

        // Reuse carrying array
        msg.carrying.length = 0;
        for (const item of entity.carrying) {
            msg.carrying.push(item);
        }

        this.broadcastP2P(msg);
    }
}
```

### GameStateManager Handler Registration

```javascript
// Add to GameStateManager.js P2P message routing
if (message.type === 'baker_spawn') {
    this.game?.bakerController?.handleSpawnMessage(message);
    return;
}
if (message.type === 'baker_state') {
    this.game?.bakerController?.handleStateMessage(message);
    return;
}
if (message.type === 'baker_sync') {
    this.game?.bakerController?.syncBakersFromPeer(message.bakers);
    return;
}
if (message.type === 'baker_despawn') {
    this.game?.bakerController?.handleDespawnMessage(message);
    return;
}
```

### NetworkManager Sync on Peer Connect

```javascript
// In NetworkManager - send bakers to newly connected peer
if (this.game?.bakerController) {
    const bakers = this.game.bakerController.getActiveBakersForSync();
    if (bakers.length > 0) {
        this.p2pTransport.sendToPeer(peerId, {
            type: 'baker_sync',
            bakers: bakers
        });
    }
}
```

---

## Visual Appearance

**Model:** `man.glb` (same as player/merchant/trapper)

**Distinguishing Features:**
- Shirt color: Orange/brown apron (#CC7722)
- Name tag: "Baker" (white text)
- Static idle pose (frame 1 of walk animation) when stationary
- Walking animation ONLY when moving

**Animation System (Simplified):**
```javascript
// Baker uses walking animation only, with static pose for idle
class BakerVisual {
    constructor(model, animations) {
        this.mesh = model;
        this.mixer = new THREE.AnimationMixer(model);

        // Only need walk animation
        const walkAnim = animations.find(a => a.name.toLowerCase().includes('walk'));
        if (walkAnim) {
            this.walkAction = this.mixer.clipAction(walkAnim);
        }

        this.isMoving = false;

        // Apply frame 1 of walk as static idle pose
        this._applyIdlePose();
    }

    _applyIdlePose() {
        if (this.walkAction) {
            this.walkAction.play();
            this.mixer.update(0.016); // Apply frame 1 (~16ms)
            this.walkAction.stop();
        }
    }

    update(deltaTime, isMoving) {
        if (isMoving !== this.isMoving) {
            this.isMoving = isMoving;
            if (isMoving) {
                this.walkAction?.play();
            } else {
                this.walkAction?.stop();
                this._applyIdlePose(); // Return to static pose
            }
        }

        // Only update mixer when moving
        if (this.isMoving && this.mixer) {
            this.mixer.update(deltaTime);
        }
    }

    dispose() {
        if (this.mixer) {
            this.mixer.stopAllAction();
            this.mixer = null;
        }
    }
}
```

**Shared Material Pattern (from DockMerchantSystem):**
```javascript
// Create once, reuse for all bakers
let sharedBakerApronMaterial = null;
if (!sharedBakerApronMaterial) {
    sharedBakerApronMaterial = new THREE.MeshStandardMaterial({
        color: 0xCC7722, // Orange/brown
        roughness: 0.8,
        metalness: 0.1
    });
}

// Apply to shirt mesh (Cube001_3)
mesh.traverse((child) => {
    if (child.name === 'Cube001_3' && child.material) {
        child.material = sharedBakerApronMaterial;
    }
});
```

**Name Tag Registration (uses existing NameTagManager pattern):**
```javascript
// Add name tag using existing NameTagManager (from game.nameTagManager)
// Pattern: registerEntity(entityId, displayName, mesh)
this.game.nameTagManager.registerEntity(
    entity.bakeryId,      // Unique ID for this baker
    'Baker',              // Display name
    entity.mesh           // THREE.Object3D to follow
);

// On disposal - IMPORTANT
this.game.nameTagManager.unregisterEntity(entity.bakeryId);
```

**Full Disposal Pattern:**
```javascript
_disposeBaker(entity, bakeryId) {
    // 1. Remove name tag
    if (this.game?.nameTagManager) {
        this.game.nameTagManager.unregisterEntity(bakeryId);
    }

    // 2. Stop animations
    if (entity.visual) {
        entity.visual.dispose();
    }

    // 3. Remove from scene
    if (entity.mesh?.parent) {
        entity.mesh.parent.remove(entity.mesh);
    }

    // 4. Dispose geometry/materials (only if not shared)
    if (entity.mesh) {
        entity.mesh.traverse((child) => {
            if (child.geometry && !child.geometry.isShared) {
                child.geometry.dispose();
            }
            // Don't dispose shared materials (sharedBakerApronMaterial)
        });
    }

    // 5. Clear references
    entity.mesh = null;
    entity.visual = null;
}
```

**Complete Visual Creation (follows DockMerchantSystem.spawnMerchant pattern):**
```javascript
// Shared material - create once at module level
let sharedBakerApronMaterial = null;

// In BakerController constructor
constructor(game) {
    this.game = game;
    this.bakers = new Map();
    // ... other init

    // Initialize shared material once
    if (!sharedBakerApronMaterial) {
        sharedBakerApronMaterial = new THREE.MeshStandardMaterial({
            color: 0xCC7722, // Orange/brown apron
            roughness: 0.8,
            metalness: 0.1
        });
    }
}

// Create visual for a baker entity
_createBakerVisual(entity) {
    const manGLTF = modelManager.getGLTF('man');
    if (!manGLTF) {
        console.error('[BakerController] Man model not loaded');
        return false;
    }

    // Clone model (same pattern as DockMerchantSystem)
    const mesh = SkeletonUtils.clone(manGLTF.scene);
    mesh.scale.set(1, 1, 1); // Same scale as player

    // Setup visibility and apply apron color
    mesh.traverse((child) => {
        if (child.isMesh || child.isSkinnedMesh) {
            child.visible = true;
            child.frustumCulled = true;

            // Cube001_3 is the shirt - apply shared apron material
            if (child.name === 'Cube001_3' && child.material) {
                child.material = sharedBakerApronMaterial;
            }
        }
    });

    // Position at spawn location
    mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
    mesh.rotation.y = entity.rotation;

    // Create BakerVisual for animation control
    entity.visual = new BakerVisual(mesh, manGLTF.animations);
    entity.mesh = mesh;

    // Add to scene
    this.game.scene.add(mesh);

    // Register name tag
    if (this.game.nameTagManager) {
        this.game.nameTagManager.registerEntity(entity.bakeryId, 'Baker', mesh);
    }

    return true;
}
```

---

## Task Decision Logic

**Key insight:** Bakery needs BOTH apples AND firewood to make tarts. Decision logic must ensure both are present before waiting.

**Corrected state flow:**
```
IDLE
 ├─ have tarts?    → COLLECTING_TARTS → DELIVERING → DEPOSITING_TARTS → IDLE
 ├─ need firewood? → SEEKING_FIREWOOD → COLLECTING → RETURNING → DEPOSITING → IDLE
 ├─ need apples?   → SEEKING_APPLES   → COLLECTING → RETURNING → DEPOSITING → IDLE
 └─ else           → WAITING_FOR_TARTS (bakery processing apples + firewood)
```

```javascript
// In BakerController._decideNextTask()
_decideNextTask(entity) {
    const bakeryInv = this._getBakeryInventory(entity.bakeryId);
    if (!bakeryInv) {
        return { task: 'stuck', reason: 'Lost connection to bakery.' };
    }

    // Use cached market lookup (O(1) from gameState.structuresById)
    const market = this._findMarketNearPosition(entity.homePosition, 20);

    // Priority 1: Deliver ready tarts (highest value action)
    const tartCount = this._countItemsOfType(bakeryInv, 'appletart');
    if (tartCount > 0) {
        if (!market) return { task: 'stuck', reason: 'I cannot find a market nearby.' };
        return { task: 'deliver_tarts', target: market.id };
    }

    // Priority 2: Get firewood if bakery needs it (REQUIRED for processing)
    const hasFirewood = this._bakeryHasFirewood(entity.bakeryId);
    if (!hasFirewood) {
        if (!market) return { task: 'stuck', reason: 'I cannot find a market nearby.' };

        // Check market has firewood (quantity-based inventory)
        const marketInv = this._getMarketInventory(market.id);
        if (!this._marketHasFirewood(marketInv)) {
            return { task: 'stuck', reason: 'The market has no firewood.' };
        }
        return { task: 'get_firewood', target: market.id };
    }

    // Priority 3: Get apples if bakery needs them
    const appleCount = this._countItemsOfType(bakeryInv, 'apple');
    if (appleCount < 2) {
        this._checkedTrees = this._checkedTrees || new Set();
        this._checkedTrees.clear();  // Reset for new search cycle

        const tree = this._findNearestAppleTree(entity.homePosition);
        if (tree) {
            return { task: 'get_apples', target: tree };
        }
        return { task: 'stuck', reason: 'I cannot find any apple trees nearby.' };
    }

    // Priority 4: Wait for tarts (bakery has BOTH apples AND firewood)
    // BakerySystem handles the actual processing server-side
    return { task: 'wait_for_tarts' };
}
```

### Helper Functions (Performance-Friendly)

```javascript
// Count items of type in grid-based inventory (no allocation)
_countItemsOfType(inventory, itemType) {
    if (!inventory?.items) return 0;
    let count = 0;
    for (let i = 0; i < inventory.items.length; i++) {
        if (inventory.items[i].type === itemType) count++;
    }
    return count;
}

// Check bakery has firewood (grid-based inventory)
_bakeryHasFirewood(bakeryId) {
    const inv = this._getBakeryInventory(bakeryId);
    if (!inv?.items) return false;

    for (let i = 0; i < inv.items.length; i++) {
        const item = inv.items[i];
        if (item.type.endsWith('firewood') && item.durability > 0) {
            return true;
        }
    }
    return false;
}

// Get market inventory from cached structure (O(1) lookup)
_getMarketInventory(marketId) {
    const structure = this.gameState.getStructureById(marketId);
    return structure?.object?.userData?.inventory || null;
}

// Check market has firewood (quantity-based inventory)
// Market format: inventory.items[type][qualityKey] = count
_marketHasFirewood(marketInv) {
    if (!marketInv?.items) return false;

    // Check any firewood variant (logfirewood, pinefirewood, etc.)
    for (const type of Object.keys(marketInv.items)) {
        if (type.endsWith('firewood')) {
            const tiers = marketInv.items[type];
            for (const key of Object.keys(tiers)) {
                if (tiers[key] > 0) return true;
            }
        }
    }
    return false;
}
```

### Response Handlers (Complete)

```javascript
// Handle apple collection response
handleAppleCollectResponse(data) {
    const { success, collected, treeId, bakeryId } = data;

    const entity = this.bakers.get(bakeryId);
    if (!entity || entity.state !== 'collecting_apples') return;

    entity.requestSentAt = null;

    if (success && collected?.length > 0) {
        for (const item of collected) {
            entity.carrying.push(item);
        }
    }

    // Track checked trees to avoid revisiting
    this._checkedTrees = this._checkedTrees || new Set();
    this._checkedTrees.add(treeId);

    // Need more apples?
    if (entity.carrying.length < 2) {
        const nextTree = this._findNearestAppleTree(entity.position);
        if (nextTree) {
            entity.state = 'seeking_apples';
            entity.targetId = nextTree.id;
            entity.path = [];
        } else if (entity.carrying.length > 0) {
            // Have some apples - return with what we have
            entity.state = 'returning';
            entity.targetId = null;
            this._checkedTrees.clear();
        } else {
            entity.state = 'stuck';
            entity.stuckReason = 'The apple trees are empty.';
            this._checkedTrees.clear();
        }
    } else {
        // Got enough apples - return to bakery
        entity.state = 'returning';
        entity.targetId = null;
        this._checkedTrees.clear();
    }
}

// Handle firewood/tart collection response
handleCollectResponse(data) {
    const { success, collected, bakeryId, structureId, itemType } = data;

    const entity = this.bakers.get(bakeryId);
    if (!entity) return;

    entity.requestSentAt = null;

    if (success && collected?.length > 0) {
        for (const item of collected) {
            entity.carrying.push(item);
        }
    }

    // Transition based on what was collected
    if (itemType === 'firewood' || itemType?.endsWith?.('firewood')) {
        // Got firewood from market - return to bakery
        entity.state = 'returning';
        entity.targetId = null;
    } else if (itemType === 'appletart') {
        // Got tarts from bakery - deliver to market
        entity.state = 'delivering';
        entity.targetId = null;
    }
}

// Handle deposit response (bakery or market)
handleDepositResponse(data) {
    const { success, bakeryId, structureId, added } = data;

    const entity = this.bakers.get(bakeryId);
    if (!entity) return;

    entity.requestSentAt = null;

    if (success) {
        entity.carrying.length = 0;  // Clear inventory
    }

    // Always return to idle - let decision logic figure out next task
    entity.state = 'idle';
    entity.targetId = null;
}
```

---

## Stuck State Handler (Pattern: Bandit Retry + Dialogue)

**Philosophy:** Baker uses explicit stuck state (unlike bandits) because:
1. Player dialogue needs to explain WHY baker is stuck
2. Different recovery strategies for different stuck reasons
3. 60-second timeout before auto-retry (gives player time to help)

**Pattern source:** Bandit 6-second retry (AIController.js:884-895) + dialogue system

### Helper: Enter Stuck State

```javascript
// Clean transition to stuck state with reason tracking
_enterStuckState(entity, reason, previousTask = null) {
    const wasAlreadyStuck = entity.state === 'stuck';

    entity.state = 'stuck';
    entity.stuckReason = reason;
    entity.stuckTime = Date.now();
    entity.path = [];
    entity.pathIndex = 0;

    // Save previous task for retry (only if not already stuck)
    if (!wasAlreadyStuck && previousTask) {
        entity.previousTask = previousTask;
    }

    // Stop walking animation
    if (entity.visual) {
        entity.visual.update(0, false);
    }
}
```

### Helper: Path Failure Tracking

```javascript
// Called when pathfinding fails (reuses bandit retry pattern)
_handlePathFailure(entity) {
    entity.pathFailures = (entity.pathFailures || 0) + 1;

    // After 3 consecutive failures, enter stuck state
    if (entity.pathFailures >= 3) {
        this._enterStuckState(entity, 'I cannot reach my destination.', {
            task: entity.state,
            target: entity.targetId
        });
        entity.pathFailures = 0;
        return;
    }

    // Allow retry after 6 seconds (bandit pattern)
    entity.lastPathTime = 0;  // Reset to trigger immediate retry next check
}

// Called when pathfinding succeeds - reset failure counter
_resetPathFailures(entity) {
    entity.pathFailures = 0;
}
```

### Stuck State Handler (60-Second Auto-Recovery)

```javascript
// Handle stuck state - wait for timeout or player resolution
_handleStuckState(entity) {
    const now = Date.now();
    const STUCK_TIMEOUT = 60000; // 60 seconds

    // Check if timeout elapsed
    if (now - entity.stuckTime >= STUCK_TIMEOUT) {
        // Auto-recover: return to idle and let decision logic retry
        entity.state = 'idle';
        entity.stuckReason = null;
        entity.stuckTime = 0;
        entity.previousTask = null;
        entity.targetId = null;
        entity.path = [];
        entity.pathIndex = 0;

        // Decision logic will re-evaluate and either find work or get stuck again
        return;
    }

    // While stuck: stay in place, do nothing
    // Player can talk to baker to see stuckReason in dialogue
}
```

### Integration in Main Update Loop

```javascript
// In _updateEntity() - add stuck state handling
_updateEntity(entity, deltaTime) {
    // Authority check (only authority simulates)
    if (entity.authorityId !== this.clientId) {
        this._interpolateEntity(entity, deltaTime);
        return;
    }

    // Handle stuck state first
    if (entity.state === 'stuck') {
        this._handleStuckState(entity);
        return;
    }

    // ... rest of state machine
}
```

### State-Specific Stuck Entry Points

All states that can fail should transition to stuck with appropriate reason:

```javascript
// In seeking_apples - if pathfinding fails 3 times
if (entity.pathFailures >= 3) {
    this._enterStuckState(entity, 'I cannot reach the apple tree.', {
        task: 'get_apples',
        target: entity.targetId
    });
}

// In seeking_firewood - if market unreachable
if (entity.pathFailures >= 3) {
    this._enterStuckState(entity, 'I cannot reach the market.', {
        task: 'get_firewood',
        target: entity.targetId
    });
}

// In delivering - if market unreachable with tarts
if (entity.pathFailures >= 3) {
    this._enterStuckState(entity, 'I cannot reach the market to deliver tarts.', {
        task: 'deliver_tarts',
        target: entity.targetId
    });
}

// In returning - if bakery unreachable
if (entity.pathFailures >= 3) {
    this._enterStuckState(entity, 'I cannot return to the bakery.', {
        task: 'return',
        target: entity.bakeryId
    });
}
```

### Stuck Condition Summary

| Trigger | Reason Message | Recovery |
|---------|----------------|----------|
| No market within 20 units | "I cannot find a market nearby." | Wait for market construction |
| Market has no firewood | "The market has no firewood." | Wait for ship/player to supply |
| No apple trees in range | "I cannot find any apple trees nearby." | Wait for tree to grow |
| Apple trees all empty | "The apple trees are empty." | Wait 10 min for regrowth |
| 3 consecutive path failures | "I cannot reach my destination." | 60s timeout → retry |
| Bakery inventory full | "The bakery storage is full." | Player needs to clear space |
| Market inventory full | "The market cannot hold more tarts." | Player needs to buy items |
| Lost bakery reference | "Lost connection to bakery." | Bakery destroyed → respawn? |

---

## Server-Side NPC Handlers (Follow Ship Trading Pattern)

**Philosophy:** Server is VERY minimally involved in AI. These handlers follow the **existing ship trading pattern** from `SpawnTasks.processShipTrading()`.

**Two inventory formats:**

| Structure | Format | Pattern Source |
|-----------|--------|----------------|
| Market | Quantity-based: `inventory.items[type][qualityKey] = count` | `processShipTrading()` |
| Bakery/Tree | Grid-based: `inventory.items = [{ id, type, x, y, ... }]` | `initializeAppleTree()` |

**Existing code to reuse:**
- `chunkManager.findObjectChange(chunkId, objectId)` - get live reference
- `chunkManager.saveChunk(chunkId)` - persist changes
- `messageRouter.broadcastTo3x3Grid()` - sync clients
- `spawnTasks.initializeAppleTree()` - init tree inventory if missing

Add to `server/MessageHandlers.js`:

### Apple Collection from Trees (Grid-Based Pattern)

```javascript
// Handle NPC collecting apples from apple tree
// Pattern: Same as initializeAppleTree + inverse operation
async handleNPCCollectApples(ws, payload) {
    const { npcType, bakeryId, treeId, chunkId, maxCount } = payload;

    if (npcType !== 'baker') {
        ws.send(JSON.stringify({ type: 'npc_collect_apples_response', success: false, reason: 'invalid_npc' }));
        return;
    }

    // Get live reference (same pattern as processShipTrading)
    let tree = await this.chunkManager.findObjectChange(chunkId, treeId);

    // Initialize tree if needed (reuse existing method)
    if (!tree?.inventory?.items) {
        if (treeId.includes('apple')) {
            const position = tree?.position || [0, 0, 0];
            const scale = tree?.scale || 1;
            const rotation = tree?.rotation || 0;
            tree = await this.spawnTasks.initializeAppleTree(treeId, chunkId, position, scale, rotation);
        }
        if (!tree?.inventory?.items) {
            ws.send(JSON.stringify({
                type: 'npc_collect_apples_response',
                success: false,
                bakeryId,
                treeId,
                collected: [],
                reason: 'tree_not_found'
            }));
            return;
        }
    }

    // Collect apples from grid-based inventory
    const collected = [];
    let remaining = maxCount;

    tree.inventory.items = tree.inventory.items.filter(item => {
        if (remaining > 0 && item.type === 'apple') {
            collected.push({ ...item }); // Copy item data
            remaining--;
            return false; // Remove from tree
        }
        return true;
    });

    // Save chunk (same pattern as processShipTrading)
    await this.chunkManager.saveChunk(chunkId);

    // Broadcast update (use crate pattern for grid-based)
    this.messageRouter.broadcastTo3x3Grid(chunkId, {
        type: 'crate_inventory_updated',
        payload: {
            structureId: treeId,
            chunkId,
            inventory: tree.inventory
        }
    });

    // Send response to requesting client
    ws.send(JSON.stringify({
        type: 'npc_collect_apples_response',
        success: true,
        bakeryId,
        treeId,
        collected
    }));
}

// Register handler
case 'npc_collect_apples':
    await this.handleNPCCollectApples(ws, payload);
    break;
```

### Deposit to Bakery (Grid-Based Pattern)

```javascript
// Handle NPC depositing items to bakery
// Pattern: Inverse of collecting - find empty grid slot, push item
async handleNPCDeposit(ws, payload) {
    const { npcType, bakeryId, structureId, chunkId, items } = payload;

    if (npcType !== 'baker') {
        ws.send(JSON.stringify({ type: 'npc_deposit_response', success: false, reason: 'invalid_npc' }));
        return;
    }

    // Get live reference
    const structure = await this.chunkManager.findObjectChange(chunkId, structureId);
    if (!structure?.inventory) {
        ws.send(JSON.stringify({
            type: 'npc_deposit_response',
            success: false,
            bakeryId,
            structureId,
            reason: 'structure_not_found'
        }));
        return;
    }

    // Grid-based: find empty slots (4x4 for bakery)
    const gridSize = 4;
    const occupiedSlots = new Set(
        (structure.inventory.items || []).map(i => `${i.x},${i.y}`)
    );

    if (!structure.inventory.items) {
        structure.inventory.items = [];
    }

    const addedItems = [];
    for (const item of items) {
        // Find first empty slot
        let foundSlot = false;
        for (let y = 0; y < gridSize && !foundSlot; y++) {
            for (let x = 0; x < gridSize && !foundSlot; x++) {
                const key = `${x},${y}`;
                if (!occupiedSlots.has(key)) {
                    // Assign grid position and add
                    item.x = x;
                    item.y = y;
                    structure.inventory.items.push(item);
                    occupiedSlots.add(key);
                    addedItems.push(item);
                    foundSlot = true;
                }
            }
        }
        if (!foundSlot) break; // Inventory full
    }

    if (addedItems.length === 0) {
        ws.send(JSON.stringify({
            type: 'npc_deposit_response',
            success: false,
            bakeryId,
            structureId,
            reason: 'inventory_full'
        }));
        return;
    }

    // Save chunk
    await this.chunkManager.saveChunk(chunkId);

    // Broadcast update
    this.messageRouter.broadcastTo3x3Grid(chunkId, {
        type: 'crate_inventory_updated',
        payload: {
            structureId,
            chunkId,
            inventory: structure.inventory
        }
    });

    // Trigger bakery processing if apples were added
    if (structure.name === 'bakery' && this.bakerySystem) {
        this.bakerySystem.checkForProcessableItems(structureId, chunkId, structure.inventory);
    }

    ws.send(JSON.stringify({
        type: 'npc_deposit_response',
        success: true,
        bakeryId,
        structureId,
        added: addedItems.length
    }));
}

case 'npc_deposit_inventory':
    await this.handleNPCDeposit(ws, payload);
    break;
```

### Collect from Bakery/Structure (Grid-Based Pattern)

```javascript
// Handle NPC collecting items from grid-based structure (bakery tarts, etc.)
// Pattern: Same as handleNPCCollectApples but for any structure
async handleNPCCollectFromStructure(ws, payload) {
    const { npcType, bakeryId, structureId, chunkId, itemType, count } = payload;

    if (npcType !== 'baker') {
        ws.send(JSON.stringify({ type: 'npc_collect_response', success: false, reason: 'invalid_npc' }));
        return;
    }

    // Get live reference
    const structure = await this.chunkManager.findObjectChange(chunkId, structureId);
    if (!structure?.inventory?.items) {
        ws.send(JSON.stringify({
            type: 'npc_collect_response',
            success: false,
            bakeryId,
            structureId,
            itemType,
            reason: 'structure_not_found'
        }));
        return;
    }

    // Collect items from grid-based inventory
    const collected = [];
    let remaining = count;

    structure.inventory.items = structure.inventory.items.filter(item => {
        if (remaining > 0 && item.type === itemType) {
            collected.push({ ...item }); // Copy item data
            remaining--;
            return false; // Remove from structure
        }
        return true;
    });

    if (collected.length === 0) {
        ws.send(JSON.stringify({
            type: 'npc_collect_response',
            success: false,
            bakeryId,
            structureId,
            itemType,
            reason: 'item_not_found'
        }));
        return;
    }

    // Save chunk
    await this.chunkManager.saveChunk(chunkId);

    // Broadcast update
    this.messageRouter.broadcastTo3x3Grid(chunkId, {
        type: 'crate_inventory_updated',
        payload: {
            structureId,
            chunkId,
            inventory: structure.inventory
        }
    });

    ws.send(JSON.stringify({
        type: 'npc_collect_response',
        success: true,
        bakeryId,
        structureId,
        itemType,
        collected
    }));
}

case 'npc_collect_from_structure':
    await this.handleNPCCollectFromStructure(ws, payload);
    break;
```

### Collect from Market (Quantity-Based Pattern - Like Ship Trading)

```javascript
// Handle NPC collecting firewood from market
// Pattern: Same as processShipTrading - quantity-based inventory
async handleNPCCollectFromMarket(ws, payload) {
    const { npcType, bakeryId, marketId, chunkId, itemType, count } = payload;

    if (npcType !== 'baker') {
        ws.send(JSON.stringify({ type: 'npc_collect_response', success: false, reason: 'invalid_npc' }));
        return;
    }

    // Get live reference (same pattern as processShipTrading)
    const market = await this.chunkManager.findObjectChange(chunkId, marketId);
    if (!market?.inventory?.items) {
        ws.send(JSON.stringify({
            type: 'npc_collect_response',
            success: false,
            bakeryId,
            structureId: marketId,
            reason: 'market_not_found'
        }));
        return;
    }

    const inventory = market.inventory;

    // Find matching items (any firewood variant for 'firewood' request)
    const matchingTypes = [];
    for (const type of Object.keys(inventory.items)) {
        if (type === itemType || (itemType === 'firewood' && type.endsWith('firewood'))) {
            matchingTypes.push(type);
        }
    }

    if (matchingTypes.length === 0) {
        ws.send(JSON.stringify({
            type: 'npc_collect_response',
            success: false,
            bakeryId,
            structureId: marketId,
            itemType,
            reason: 'item_not_found'
        }));
        return;
    }

    // Collect from first matching type with stock
    const collected = [];
    let remaining = count;

    for (const type of matchingTypes) {
        if (remaining <= 0) break;

        const qualityTiers = inventory.items[type];
        for (const qualityKey of Object.keys(qualityTiers)) {
            if (remaining <= 0) break;

            const available = qualityTiers[qualityKey];
            if (available <= 0) continue;

            const toTake = Math.min(remaining, available);

            // Parse quality/durability from key
            const parts = qualityKey.split(',');
            const quality = parseInt(parts[0]) || 50;
            const durability = parts[1] ? parseInt(parts[1]) : 100;

            // Create grid-based item for baker's inventory
            for (let i = 0; i < toTake; i++) {
                collected.push({
                    id: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    type: type,
                    x: 0, y: 0, width: 1, height: 1, rotation: 0,
                    quality: quality,
                    durability: durability
                });
            }

            // Decrement market stock (same pattern as processShipTrading)
            qualityTiers[qualityKey] = available - toTake;
            if (qualityTiers[qualityKey] <= 0) {
                delete qualityTiers[qualityKey];
            }

            remaining -= toTake;
        }
    }

    if (collected.length === 0) {
        ws.send(JSON.stringify({
            type: 'npc_collect_response',
            success: false,
            bakeryId,
            structureId: marketId,
            itemType,
            reason: 'no_stock'
        }));
        return;
    }

    // Save chunk
    await this.chunkManager.saveChunk(chunkId);

    // Broadcast market update (same pattern as processShipTrading)
    this.messageRouter.broadcastTo3x3Grid(chunkId, {
        type: 'market_inventory_updated',
        payload: {
            marketId,
            items: inventory.items
        }
    });

    ws.send(JSON.stringify({
        type: 'npc_collect_response',
        success: true,
        bakeryId,
        structureId: marketId,
        itemType,
        collected
    }));
}

case 'npc_collect_from_market':
    await this.handleNPCCollectFromMarket(ws, payload);
    break;
```

### Deposit to Market (Quantity-Based Pattern - Like Ship Trading)

```javascript
// Handle NPC depositing tarts to market
// Pattern: Same as processShipTrading Phase 2 - add items
async handleNPCDepositToMarket(ws, payload) {
    const { npcType, bakeryId, marketId, chunkId, items } = payload;

    if (npcType !== 'baker') {
        ws.send(JSON.stringify({ type: 'npc_deposit_response', success: false, reason: 'invalid_npc' }));
        return;
    }

    const market = await this.chunkManager.findObjectChange(chunkId, marketId);
    if (!market?.inventory?.items) {
        ws.send(JSON.stringify({
            type: 'npc_deposit_response',
            success: false,
            bakeryId,
            structureId: marketId,
            reason: 'market_not_found'
        }));
        return;
    }

    const inventory = market.inventory;
    const durabilityItems = CONFIG.MARKET.DURABILITY_ITEMS || [];

    // Add items to market (quantity-based)
    for (const item of items) {
        if (!inventory.items[item.type]) {
            inventory.items[item.type] = {};
        }

        // Use correct key format based on whether item has durability
        const hasDurability = durabilityItems.includes(item.type);
        const key = hasDurability
            ? `${item.quality},${item.durability}`
            : `${item.quality}`;

        const currentCount = inventory.items[item.type][key] || 0;
        inventory.items[item.type][key] = currentCount + 1;
    }

    // Save chunk
    await this.chunkManager.saveChunk(chunkId);

    // Broadcast market update
    this.messageRouter.broadcastTo3x3Grid(chunkId, {
        type: 'market_inventory_updated',
        payload: {
            marketId,
            items: inventory.items
        }
    });

    ws.send(JSON.stringify({
        type: 'npc_deposit_response',
        success: true,
        bakeryId,
        structureId: marketId,
        added: items.length
    }));
}

case 'npc_deposit_to_market':
    await this.handleNPCDepositToMarket(ws, payload);
    break;
```

**Race Condition Handling:**
Same as ship trading - JavaScript is single-threaded, so operations are queued and processed in order. NPC operations bypass player locks since they use different message types.

---

## Testing Checklist

### Basic Functionality
- [ ] Baker spawns when bakery is placed/loaded
- [ ] Baker displays correct model with orange apron
- [ ] Baker name tag shows "Baker"
- [ ] Baker detects and paths to apple trees
- [ ] Baker harvests apples (10 second duration)
- [ ] Baker returns to bakery and deposits apples
- [ ] Baker paths to market for firewood
- [ ] Baker collects firewood from market
- [ ] Baker deposits firewood in bakery
- [ ] Bakery processes apples into tarts
- [ ] Baker collects finished tarts
- [ ] Baker delivers tarts to market

### Player Interaction
- [ ] "Talk to Baker" button appears when near
- [ ] Button hides when player is moving
- [ ] Dialogue shows current baker state
- [ ] Stuck state shows reason message

### Multiplayer
- [ ] Only one client simulates (authority)
- [ ] Other clients see baker move smoothly (interpolation)
- [ ] Authority transfers when original authority leaves
- [ ] Baker syncs to new players joining

### Edge Cases
- [ ] No apple trees nearby → stuck state
- [ ] No market nearby → stuck state
- [ ] Market has no firewood → stuck state
- [ ] Bakery inventory full → stuck state
- [ ] Path blocked → stuck state
- [ ] Baker killed by bandits/bears → respawns

### Performance
- [ ] No frame drops with 10+ bakers visible
- [ ] Distant bakers update less frequently
- [ ] No memory leaks over time

---

## Design Decisions (Resolved)

| Decision | Resolution |
|----------|------------|
| Apple collection method | Inventory-based (apples stored in tree inventory, not harvested) |
| Apples per trip | 2 apples every 10 minutes |
| Tree selection | Nearest valid tree first, then next nearest if needed |
| Baker damageable | NO - not targeted by enemies |
| Bakery destruction | Baker despawns immediately, no respawn |
| Multiple bakers | ONE baker per bakery |
| Bakery-market distance | 20 units (same as dock) |
| Spawning trigger | Ship arrival at dock connected to market near bakery |
| Detection interval | Every 6 seconds (360 frames) |
| Animation | Static idle (frame 1 of walk), walking only when moving |

---

## Implementation Order

1. **Phase 1: Setup**
   - Add baker to banned usernames in `AuthManager.js`
   - Add `BAKER_CONFIG` to `config.js`
   - Add `BAKERY.MAX_DISTANCE` to `ServerConfig.js`

2. **Phase 2: Bakery-Market Validation**
   - Add `findNearestMarketToBakery()` in `SpawnTasks.js`
   - Validate on bakery placement (within 20 units of market)

3. **Phase 3: Server Handlers (Follow Existing Patterns)**
   - Add `npc_collect_apples` handler (tree → baker, grid-based)
   - Add `npc_deposit_inventory` handler (baker → bakery, grid-based)
   - Add `npc_collect_from_structure` handler (bakery tarts → baker, grid-based)
   - Add `npc_collect_from_market` handler (market firewood → baker, quantity-based)
   - Add `npc_deposit_to_market` handler (baker tarts → market, quantity-based)

4. **Phase 4: Core AI Controller**
   - Create `BakerController.js` with state machine
   - Authority system (reuse bandit pattern)
   - 6-second detection interval for tree/market scans
   - Pathfinding to targets

5. **Phase 5: Spawning System**
   - Listen for `dock_ship_spawned` events
   - Check if dock's market is within 20 units of a bakery
   - Spawn baker at bakery position

6. **Phase 6: Visual & Integration**
   - Create baker mesh (man.glb with orange apron)
   - Static idle pose + walking animation
   - Name tag "Baker"
   - Add to game loop

7. **Phase 7: Player Communication**
   - Add dialogue UI (copy merchant pattern)
   - State-based messages
   - Stuck state with reason

8. **Phase 8: Testing**
   - Single player functionality
   - Multiplayer authority transfer
   - Edge cases (no trees, no market, bakery destroyed)

---

# ACTUAL IMPLEMENTATION REFERENCE

> **Note**: This section documents the ACTUAL code that was implemented, including deviations from the original plan and additional code required. Use this as a reference for future AI implementations.

---

## Files Created/Modified Summary

| File | Type | Lines | Purpose |
|------|------|-------|---------|
| `server/BakerySystem.js` | New | ~460 | Apple→appletart processing, tick-based cooking |
| `server/MessageHandlers.js` | Modified | +400 | NPC inventory handlers (5 new handlers) |
| `server.js` | Modified | +15 | BakerySystem initialization and tick updates |
| `public/ai/BakerController.js` | New | ~2300 | Complete baker NPC behavior and P2P sync |
| `public/config.js` | Modified | +50 | Baker config, bakery structure definition |
| `public/core/GameState.js` | Modified | +60 | Bakery registration/lookup methods |
| `public/systems/EffectManager.js` | Modified | +15 | Bakery smoke effect |

---

## Server-Side Implementation

### 1. BakerySystem.js (`server/BakerySystem.js`)

Complete processing system for apple→appletart conversion:

```javascript
// Key constants
PROCESSING_DURATION_TICKS = 60;  // 1 minute (60 ticks at 1 tick/sec)
BASE_DURABILITY = 30;            // Base durability for tarts

// Allowed items (security filter)
ALLOWED_TYPES = ['apple', 'appletart', 'oakfirewood', 'pinefirewood',
                 'firfirewood', 'cypressfirewood', 'applefirewood'];

// Quality calculation (line ~180)
finalQuality = Math.round((appleQuality + bakeryQuality) / 2);

// Durability calculation (line ~185)
finalDurability = Math.round(BASE_DURABILITY * (finalQuality / 50));
```

**Key Methods:**
- `canBeProcessedItem(itemType)` - Returns true only for 'apple'
- `isItemAllowed(itemType)` - Security check for allowed items
- `filterInventory(inventory)` - Removes disallowed items
- `checkForProcessableItems(bakeryData)` - Auto-starts processing when apple + firewood present
- `startProcessing(item, bakeryData)` - Stamps `processingStartTick` and `processingDurationTicks`
- `completeProcessing(item, bakeryData)` - Transforms apple→appletart with quality/durability calc
- `cancelProcessing(item)` - Clears processing state when firewood depletes
- `checkAndCompleteProcessing(bakeryData)` - Called by NPC to auto-complete ready tarts

### 2. MessageHandlers.js - NPC Handlers

**Five new message handlers were added:**

#### a. `handleNPCCollectApples` (lines 4158-4251)
```javascript
// Message: 'npc_collect_apples'
// Payload: { npcType, bakeryId, treeId, chunkId, maxCount }
// Response: { success, collected: [{type, quality, durability}], treeId, bakeryId }
```
- Validates tree exists and has inventory
- Removes up to `maxCount` apples from tree
- Broadcasts `crate_inventory_updated` to sync clients
- Returns collected items to baker

#### b. `handleNPCDeposit` (lines 4254-4396)
```javascript
// Message: 'npc_deposit'
// Payload: { npcType, bakeryId, structureId, chunkId, items }
// Response: { success, bakeryId, structureId }
```
- Validates structure has 4x4 grid inventory
- Finds empty slots and places items
- Triggers `bakerySystem.checkForProcessableItems()` after deposit
- Broadcasts inventory update

#### c. `handleNPCCollectFromStructure` (lines 4399-4497)
```javascript
// Message: 'npc_collect_from_structure'
// Payload: { npcType, bakeryId, structureId, chunkId, itemType, count }
// Response: { success, collected: [...], bakeryId, structureId }
```
- Collects specific item type from grid inventory (e.g., appletart from bakery)
- Removes items from grid
- Broadcasts inventory update

#### d. `handleNPCCollectFromMarket` (lines 4500-4650)
```javascript
// Message: 'npc_collect_from_market'
// Payload: { npcType, bakeryId, marketId, chunkId, itemType, count }
// Response: { success, collected: [...], bakeryId }
```
- Collects from market's quantity-based inventory (like ship trading)
- Searches for any firewood type (oakfirewood, pinefirewood, etc.)
- Decrements quantity or removes item

#### e. `handleNPCCheckBakeryProcessing` (lines 4743-4786)
```javascript
// Message: 'npc_check_bakery_processing'
// Payload: { bakeryId, chunkId }
// Response: { success, completed: number }
```
- Allows tarts to complete without player opening bakery UI
- Called by baker when waiting for tarts
- Returns number of tarts that were completed

### 3. server.js Integration

```javascript
// Lines 42-50: Create BakerySystem
const BakerySystem = require('./server/BakerySystem');
const bakerySystem = new BakerySystem(sendToClient, broadcast);

// Line 90-91: Tick update
setInterval(() => {
    bakerySystem.serverTick++;
}, 1000);

// Line 368-369: Message routing
case 'npc_check_bakery_processing':
    await messageHandlers.handleNPCCheckBakeryProcessing(ws, payload);
    break;
```

---

## Client-Side Implementation

### 1. BakerController.js (`public/ai/BakerController.js`)

**2300+ lines implementing complete baker behavior:**

#### Configuration Defaults (lines 26-42)
```javascript
const BAKER_CONFIG_DEFAULTS = {
    MOVE_SPEED: 0.8,              // Units per second
    PATHFIND_INTERVAL: 6000,      // 6 seconds between path recalc
    MARKET_MAX_DISTANCE: 20,      // Units
    APPLE_SEARCH_RADIUS_SQ: 2500, // 50^2
    APPLES_PER_TRIP: 2,
    STUCK_TIMEOUT: 60000,         // 60 seconds
    NPC_COLOR: 0xCC7722,          // Orange/brown apron
    FAR_UPDATE_INTERVAL: 8,       // Frames between distant updates
    BROADCAST_INTERVAL: 1000,     // ms between state broadcasts
};
```

#### Baker States (lines 45-60)
```javascript
const BAKER_STATE = {
    IDLE: 'idle',
    SEEKING_APPLES: 'seeking_apples',
    COLLECTING_APPLES: 'collecting_apples',
    SEEKING_FIREWOOD: 'seeking_firewood',
    COLLECTING_FIREWOOD: 'collecting_firewood',
    RETURNING: 'returning',
    DEPOSITING: 'depositing',
    WAITING_FOR_TARTS: 'waiting_for_tarts',
    WAITING_FOR_APPLES: 'waiting_for_apples',
    WAITING_FOR_FIREWOOD: 'waiting_for_firewood',
    COLLECTING_TARTS: 'collecting_tarts',
    DELIVERING: 'delivering',
    DEPOSITING_TARTS: 'depositing_tarts',
    STUCK: 'stuck'
};
```

#### Key Class Structure
```javascript
class BakerController {
    constructor() {
        this.bakers = new Map();           // bakeryId → entity
        this.pendingStates = new Map();    // For P2P race conditions
        this._broadcastMsg = { ... };      // Pooled message object
        this._checkedTrees = new Set();    // Trees checked this cycle
        this._frameCount = 0;
        this._lastBroadcastTime = 0;
    }

    // Lifecycle
    initialize(callbacks)
    update(deltaTime)

    // Spawning
    checkBakerSpawn()                      // Called when ship arrives
    _spawnBaker(bakeryData)
    _createBakerVisual(entity)             // Clone man.glb, apply color

    // State Machine (lines 700-1600)
    _updateEntity(entity, deltaTime)
    _decideNextTask(entity)                // Priority-based task selection
    _handleIdleState(entity, deltaTime)
    _handleSeekingApplesState(entity, deltaTime)
    _handleCollectingApplesState(entity, deltaTime)
    // ... handlers for each state

    // Pathfinding
    _moveAlongPath(entity, deltaTime)      // Reuses bandit pattern
    _updatePathfinding(entity, targetX, targetZ)

    // Authority Management
    _calculateAuthority(bakeryId)          // Lowest clientId in 3x3 chunks
    onPeerDisconnected(peerId)
    onPeerJoinedChunk(peerId, chunkKey)

    // P2P Message Handlers
    handleSpawnMessage(data)
    handleStateMessage(data)
    handleDespawnMessage(data)
    syncBakersFromPeer(bakers)
    getActiveBakersForSync()
    broadcastAuthorityState()

    // Server Response Handlers
    handleAppleCollectResponse(data)
    handleCollectResponse(data)
    handleDepositResponse(data)

    // Cleanup
    _disposeBaker(entity)
    onBakeryDestroyed(bakeryId)
    onChunkUnloaded(chunkKey)
}
```

#### Task Decision Logic (lines 615-672)
```javascript
_decideNextTask(entity) {
    const bakeryInv = this._getBakeryInventory(entity.bakeryId);
    const hasFirewood = this._hasFirewood(bakeryInv);
    const tartCount = this._countTarts(bakeryInv);
    const appleCount = this._countApples(bakeryInv);

    // Priority 1: Ensure bakery has firewood
    if (!hasFirewood && entity.carrying.length === 0) {
        return BAKER_STATE.SEEKING_FIREWOOD;
    }

    // Priority 2: Deliver finished tarts to market
    if (tartCount > 0 || this._isCarryingTarts(entity)) {
        return BAKER_STATE.COLLECTING_TARTS;
    }

    // Priority 3: Collect more apples if needed
    if (appleCount < 2 && entity.carrying.length === 0) {
        return BAKER_STATE.SEEKING_APPLES;
    }

    // Priority 4: Wait for processing
    if (appleCount > 0 && hasFirewood) {
        return BAKER_STATE.WAITING_FOR_TARTS;
    }

    return BAKER_STATE.IDLE;
}
```

### 2. GameState.js Additions (`public/core/GameState.js`)

```javascript
// Lines 520-569: Bakery registration for AI detection
class GameState {
    constructor() {
        this.bakeriesByChunk = new Map();  // chunkKey → [{id, position, object}]
        this.structuresById = new Map();   // structureId → {chunkKey, position, object, type}
    }

    registerBakery(chunkKey, bakeryData) {
        if (!this.bakeriesByChunk.has(chunkKey)) {
            this.bakeriesByChunk.set(chunkKey, []);
        }
        this.bakeriesByChunk.get(chunkKey).push(bakeryData);

        this.structuresById.set(bakeryData.id, {
            chunkKey,
            position: bakeryData.position,
            object: bakeryData.object,
            type: 'bakery'
        });
    }

    unregisterBakery(chunkKey, bakeryId) {
        const bakeries = this.bakeriesByChunk.get(chunkKey);
        if (bakeries) {
            const index = bakeries.findIndex(b => b.id === bakeryId);
            if (index !== -1) bakeries.splice(index, 1);
        }
        this.structuresById.delete(bakeryId);
    }

    getBakeriesInChunk(chunkKey) {
        return this.bakeriesByChunk.get(chunkKey) || [];
    }

    getStructureById(structureId) {
        return this.structuresById.get(structureId) || null;
    }
}
```

### 3. config.js Additions (`public/config.js`)

```javascript
// Lines 553: Bakery structure definition
STRUCTURES: {
    bakery: { width: 1, depth: 1, height: 3.0 }
}

// Lines 685-686: Construction materials
CONSTRUCTION_MATERIALS: {
    bakery: [{ type: 'oakplank', count: 1 }]  // Minimal for testing
}

// Lines 740-742: Bakery inventory (4x4 grid like crate)
STRUCTURE_INVENTORIES: {
    bakery: { rows: 4, cols: 4 }
}

// Lines 1080-1109: Baker NPC configuration
BAKER: {
    ENABLED: true,
    SPAWN_DISTANCE: 2.5,
    MARKET_MAX_DISTANCE: 20,
    MOVE_SPEED: 0.8,
    PATHFIND_INTERVAL: 6000,
    APPLES_PER_TRIP: 2,
    STUCK_TIMEOUT: 60000,
    FAR_UPDATE_INTERVAL: 8,
    BROADCAST_INTERVAL: 1000,
    NPC_COLOR: 0xCC7722
}
```

### 4. EffectManager.js Smoke Effect (`public/systems/EffectManager.js`)

```javascript
// Lines 277-291: Bakery smoke (single centered chimney)
if (structureType === 'bakery') {
    this._addSmokeEffect(object, [
        { x: 0, y: 3.0, z: 0 }  // Center top
    ]);
}
```

---

## Data Flow: Apple → Appletart Conversion

```
1. Baker collects 2 apples from trees
   └─► npc_collect_apples message
   └─► Server removes apples from tree inventory
   └─► Response: collected items array

2. Baker deposits apples at bakery
   └─► npc_deposit message
   └─► Server places in 4x4 grid
   └─► Server calls bakerySystem.checkForProcessableItems()
   └─► Processing starts if firewood present

3. Processing (60 ticks = 1 minute)
   └─► processingStartTick stamped on item
   └─► processingDurationTicks = 60

4. Baker checks for ready tarts
   └─► npc_check_bakery_processing message
   └─► Server calls bakerySystem.checkAndCompleteProcessing()
   └─► If 60 ticks elapsed: apple → appletart
   └─► Quality = (appleQuality + bakeryQuality) / 2
   └─► Durability = 30 * (quality / 50)

5. Baker collects tarts
   └─► npc_collect_from_structure message
   └─► Tarts added to baker.carrying[]

6. Baker delivers to market
   └─► npc_deposit_to_market message
   └─► Market inventory updated
```

---

## Bug Fixes Implemented (from issues/baker.md)

### 1. Pending States Handling
**Problem**: State messages arriving before spawn caused lost updates.
**Fix**: Added `pendingStates` Map in constructor, check and apply in `handleSpawnMessage`.

### 2. Visual Creation Validation
**Problem**: Broken entities added when visual creation fails.
**Fix**: `_createBakerVisual` returns boolean, caller validates and removes failed entities.

### 3. Authority Calculation
**Problem**: Authority always used current clientId.
**Fix**: Added `_calculateAuthority()` method using lowest clientId in 3x3 chunks.

### 4. Peer Joined Chunk Handler
**Problem**: Authority not recalculated when new peers join.
**Fix**: Added `onPeerJoinedChunk()` and `onPeerChunkChanged()` methods.

### 5. Y Position Validation
**Problem**: Invalid Y values caused NaN/Infinity positions.
**Fix**: Validate Y in `handleStateMessage`, fallback to terrain height or current position.

### 6. Spawn Queue Integration
**Problem**: Frame stutter when spawning multiple bakers.
**Fix**: Integrated with `AISpawnQueue`, registered 'baker' callback.

### 7. Frame-Based Distance Culling
**Problem**: All bakers updated every frame regardless of distance.
**Fix**: Distant bakers (>50 units) update every 8th frame.

### 8. Improved Peer Disconnect Handler
**Problem**: Position not snapped, state not broadcast on authority transfer.
**Fix**: Snap to `targetPosition`, sync mesh, broadcast state immediately.

---

## P2P Message Types (Actual Implementation)

```javascript
// Spawn message
{ type: 'baker_spawn', bakeryId, spawnedBy, spawnTime, position: {x,y,z}, homePosition: {x,y,z} }

// State broadcast (every 1 second by authority)
{ type: 'baker_state', bakeryId, position: {x,y,z}, rotation, state, targetId, carrying: [], moving, stuckReason }

// Sync to new peers
{ type: 'baker_sync', bakers: [{ bakeryId, spawnedBy, spawnTime, position, homePosition, state, carrying, authorityId }] }

// Despawn
{ type: 'baker_despawn', bakeryId, reason: 'bakery_destroyed' }
```

---

## Integration Points

### GameInitializer.js
```javascript
// Baker callbacks (similar to AIController for bandits)
const bakerCallbacks = {
    findPath: (fromX, fromZ, toX, toZ) => findPath(navigationManager, fromX, fromZ, toX, toZ),
    getTerrainHeight: (x, z) => terrainGenerator?.getHeight(x, z) ?? 0,
    isWalkable: (x, z) => navigationManager?.isWalkable(x, z) ?? true,
    networkManager: this.game.networkManager,
    broadcastP2P: (msg) => this.game.networkManager?.broadcastP2P(msg),
    gameState: this.game.gameState,
    scene: this.game.scene,
    game: this.game
};

this.game.bakerController = new BakerController();
this.game.bakerController.initialize(bakerCallbacks);
```

### game.js Update Loop
```javascript
update(deltaTime) {
    // ... other updates ...
    if (this.bakerController) {
        this.bakerController.update(deltaTime);
    }
}
```

### GameStateManager.js P2P Routing
```javascript
if (message.type === 'baker_spawn') {
    this.game?.bakerController?.handleSpawnMessage(message);
}
if (message.type === 'baker_state') {
    this.game?.bakerController?.handleStateMessage(message);
}
if (message.type === 'baker_sync') {
    this.game?.bakerController?.syncBakersFromPeer(message.bakers);
}
if (message.type === 'baker_despawn') {
    this.game?.bakerController?.handleDespawnMessage(message);
}
```

### SceneObjectFactory.js Registration
```javascript
if (structureType === 'bakery') {
    const chunkKey = `${Math.floor(x / 50)},${Math.floor(z / 50)}`;
    this.game.gameState.registerBakery(chunkKey, {
        id: objectInstance.userData.objectId,
        position: { x, y, z },
        object: objectInstance
    });
}
```

### MessageRouter.js Object Removal
```javascript
// In handleObjectRemoved - unregister bakery and despawn baker
if (objectType === 'bakery') {
    this.game.gameState.unregisterBakery(chunkKey, objectId);
    this.game.bakerController?.onBakeryDestroyed(objectId);
}
```

---

## Key Differences from Plan

| Aspect | Original Plan | Actual Implementation |
|--------|---------------|----------------------|
| File count | 2 new files | 1 new major file (BakerController), 1 server file (BakerySystem) |
| Line count estimate | ~800 lines | ~2800 lines total |
| Inventory handlers | 2 handlers | 5 handlers (grid + quantity-based) |
| States | 10 states | 14 states (added WAITING_FOR_APPLES, WAITING_FOR_FIREWOOD, DEPOSITING_TARTS) |
| Bug fixes required | Not anticipated | 11 fixes documented |
| Spawn trigger | Simple ship event | Spawn queue integration for performance |
| Authority system | Basic | Full recalculation on peer join/leave/chunk change |

---

## Future AI Reference Checklist

When implementing similar worker NPCs, ensure:

- [ ] **Server handlers**: Create message handlers for NPC inventory operations (bypass player locks)
- [ ] **Processing system**: If item conversion needed, create dedicated system with tick-based timing
- [ ] **Controller class**: ~2000+ lines for complete behavior with all states
- [ ] **Pending states**: Handle P2P race conditions where state arrives before spawn
- [ ] **Visual validation**: Verify mesh creation succeeded before adding entity to map
- [ ] **Authority calculation**: Use lowest clientId among nearby players (deterministic)
- [ ] **Distance culling**: Update distant NPCs less frequently (every Nth frame)
- [ ] **Spawn queue**: Integrate with AISpawnQueue to prevent frame stutter
- [ ] **Y validation**: Always validate terrain height, fallback to current position
- [ ] **Structure registration**: Cache structures in GameState for O(1) lookup
- [ ] **Cleanup handlers**: Handle structure destruction, chunk unload, peer disconnect

# Baker Controller Bug Fixes & Missing Implementation

**Summary**: Deep analysis of BakerController.js compared against the working BanditController/AIController. This document contains all required code changes to fix issues.

---

## Table of Contents
1. [Critical Issues](#critical-issues)
2. [Fix 1: Add Pending States Handling](#fix-1-add-pending-states-handling)
3. [Fix 2: Add Visual Creation Validation](#fix-2-add-visual-creation-validation)
4. [Fix 3: Add Authority Calculation Method](#fix-3-add-authority-calculation-method)
5. [Fix 4: Add Peer Joined Chunk Handler](#fix-4-add-peer-joined-chunk-handler)
6. [Fix 5: Add Y Position Validation in State Handler](#fix-5-add-y-position-validation-in-state-handler)
7. [Fix 6: Add Spawn Queue Integration](#fix-6-add-spawn-queue-integration)
8. [Fix 7: Fix Animation Controller Reference](#fix-7-fix-animation-controller-reference)
9. [Fix 8: Add Frame-Based Distance Culling](#fix-8-add-frame-based-distance-culling)
10. [Fix 9: Improve Peer Disconnect Handler](#fix-9-improve-peer-disconnect-handler)
11. [Fix 10: Add Missing Configuration Constants](#fix-10-add-missing-configuration-constants)
12. [Fix 11: Robust Response Handler Validation](#fix-11-robust-response-handler-validation)

---

## Critical Issues

| Issue | Severity | Description |
|-------|----------|-------------|
| Missing pendingStates | HIGH | State messages arriving before spawn cause lost updates |
| No visual validation | HIGH | Broken entities added when visual creation fails |
| No proper authority calc | MEDIUM | Authority always uses clientId, not lowest ID |
| Missing onPeerJoinedChunk | MEDIUM | Authority not recalculated when new peers join |
| No Y position validation | MEDIUM | Invalid Y values cause NaN/Infinity positions |
| No spawn queue | LOW | Frame stutter when spawning multiple bakers |
| Inconsistent controller ref | LOW | Uses `visual` instead of `controller` pattern |

---

## Fix 1: Add Pending States Handling

**Problem**: When state messages arrive before spawn message, they're lost. Bandit stores these in `pendingStates` Map and applies them after spawn.

### File: `public/ai/BakerController.js`

**Add to constructor (after line ~5481):**

```javascript
// Add after: this._checkedTrees = new Set();

// Pending states for entities that haven't spawned yet
this.pendingStates = new Map();
```

**Modify `handleSpawnMessage` (around line 5486-5520) - add at the end before closing brace:**

```javascript
    handleSpawnMessage(data) {
        const { bakeryId, spawnedBy, spawnTime, position, homePosition } = data;

        if (this.bakers.has(bakeryId)) return;

        const entity = {
            bakeryId: bakeryId,
            position: { ...position },
            targetPosition: { ...position },
            rotation: 0,
            targetRotation: 0,
            homePosition: { ...homePosition },
            state: BAKER_STATE.IDLE,
            targetId: null,
            carrying: [],
            path: [],
            pathIndex: 0,
            lastPathTime: 0,
            pathFailures: 0,
            stuckReason: null,
            stuckTime: 0,
            previousTask: null,
            requestSentAt: null,
            spawnedBy: spawnedBy,
            spawnTime: spawnTime,
            authorityId: spawnedBy,
            mesh: null,
            visual: null,
            controller: null, // ADD: Consistent with Bandit pattern
            _lastDecisionTime: 0
        };

        this.bakers.set(bakeryId, entity);
        
        // Create visual - validate success
        const visualCreated = this._createBakerVisual(entity);
        if (!visualCreated) {
            console.warn(`[BakerController] Failed to create visual for ${bakeryId}, removing entity`);
            this.bakers.delete(bakeryId);
            return;
        }

        // ADD: Check for pending state that arrived before spawn
        if (this.pendingStates.has(bakeryId)) {
            const pendingState = this.pendingStates.get(bakeryId);
            this.pendingStates.delete(bakeryId);
            
            if (pendingState.position) {
                entity.targetPosition = { ...pendingState.position };
            }
            if (pendingState.rotation !== undefined) {
                entity.targetRotation = pendingState.rotation;
            }
            if (pendingState.state) {
                entity.state = pendingState.state;
            }
            if (pendingState.targetId !== undefined) {
                entity.targetId = pendingState.targetId;
            }
            if (pendingState.carrying) {
                entity.carrying = [...pendingState.carrying];
            }
            if (pendingState.stuckReason) {
                entity.stuckReason = pendingState.stuckReason;
            }
            if (pendingState.moving !== undefined) {
                this._setMoving(entity, pendingState.moving);
            }
        }

        console.log(`[BakerController] Received baker spawn for ${bakeryId} from ${spawnedBy}`);
    }
```

**Modify `handleStateMessage` (around line 5526-5543):**

```javascript
    handleStateMessage(data) {
        const { bakeryId, position, rotation, state, targetId, carrying, moving, stuckReason } = data;

        const entity = this.bakers.get(bakeryId);
        
        // ADD: Store pending state if entity doesn't exist yet
        if (!entity) {
            this.pendingStates.set(bakeryId, data);
            return;
        }

        // Skip if we're authority
        if (entity.authorityId === this.clientId) return;

        // ADD: Validate Y position before applying
        let validY = position.y;
        if (!Number.isFinite(validY) || validY <= 0) {
            if (this.getTerrainHeight) {
                validY = this.getTerrainHeight(position.x, position.z);
            }
            if (!Number.isFinite(validY) || validY <= 0) {
                validY = entity.position?.y || 0;
            }
        }

        // Update target position for interpolation
        entity.targetPosition = { x: position.x, y: validY, z: position.z };
        entity.targetRotation = rotation;
        entity.state = state;
        entity.targetId = targetId;
        entity.stuckReason = stuckReason;

        // Update carrying
        entity.carrying = carrying || [];

        // Update animation
        this._setMoving(entity, moving);
    }
```

---

## Fix 2: Add Visual Creation Validation

**Problem**: `_createBakerVisual` doesn't return failure status, and caller doesn't check. Bandit validates visual creation.

### File: `public/ai/BakerController.js`

**Modify `_spawnBaker` (around line 5676-5693):**

```javascript
        this.bakers.set(bakeryId, entity);

        // Create visual - ADD validation
        const visualCreated = this._createBakerVisual(entity);
        if (!visualCreated) {
            console.warn(`[BakerController] Failed to create visual for baker at ${bakeryId}, aborting spawn`);
            this.bakers.delete(bakeryId);
            return;
        }
        
        // Store controller reference (consistent with Bandit)
        entity.controller = entity.visual;

        // Broadcast spawn to peers
        if (this.broadcastP2P) {
            this.broadcastP2P({
                type: 'baker_spawn',
                bakeryId: bakeryId,
                spawnedBy: this.clientId,
                spawnTime: entity.spawnTime,
                position: entity.position,
                homePosition: entity.homePosition
            });
        }

        console.log(`[BakerController] Spawned baker at bakery ${bakeryId}`);
```

**The `_createBakerVisual` method already returns true/false - no changes needed there.**

---

## Fix 3: Add Authority Calculation Method

**Problem**: Baker doesn't have a proper `_calculateAuthority` method. Bandit uses lowest clientId among nearby players.

### File: `public/ai/BakerController.js`

**Add new method after `_interpolateEntity` (around line 6477):**

```javascript
    // =========================================================================
    // AUTHORITY MANAGEMENT
    // =========================================================================

    /**
     * Calculate which client should be authority for a baker
     * Uses lowest clientId among players near the bakery (consistent with Bandit)
     * @param {string} bakeryId
     * @returns {string} clientId that should be authority
     */
    _calculateAuthority(bakeryId) {
        const entity = this.bakers.get(bakeryId);
        if (!entity) return this.clientId;

        const CHUNK_SIZE = 50;
        const homeChunkX = Math.floor(entity.homePosition.x / CHUNK_SIZE);
        const homeChunkZ = Math.floor(entity.homePosition.z / CHUNK_SIZE);

        // Get players in 3x3 area around baker's home
        const chunkKeys = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                chunkKeys.push(`${homeChunkX + dx},${homeChunkZ + dz}`);
            }
        }

        // If we have a way to get players in chunks, use it
        // Otherwise fall back to current client
        if (!this.gameState?.getPlayersInChunks) {
            return this.clientId;
        }

        const players = this.gameState.getPlayersInChunks(chunkKeys);
        if (!players || players.size === 0) {
            return this.clientId;
        }

        // Find lowest clientId - deterministic for P2P sync
        let lowestId = this.clientId;
        for (const playerId of players) {
            if (playerId < lowestId) {
                lowestId = playerId;
            }
        }
        
        return lowestId;
    }
```

---

## Fix 4: Add Peer Joined Chunk Handler

**Problem**: Baker doesn't recalculate authority when new peers join the area. Bandit has `onPeerJoinedChunk`.

### File: `public/ai/BakerController.js`

**Add new method after `onPeerDisconnected` (around line 6782):**

```javascript
    /**
     * Handle new peer joining a chunk - recalculate authority for nearby bakers
     * Called when a peer's first position is received
     * @param {string} peerId - The new peer's ID
     * @param {string} chunkKey - The chunk the peer joined
     */
    onPeerJoinedChunk(peerId, chunkKey) {
        const CHUNK_SIZE = 50;
        const [peerChunkX, peerChunkZ] = chunkKey.split(',').map(Number);

        for (const [bakeryId, entity] of this.bakers) {
            // Check if peer is in 3x3 area around baker's home position
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

                    // If we gained authority, snap position and broadcast
                    if (isNowMe && !wasMe) {
                        if (entity.targetPosition) {
                            entity.position.x = entity.targetPosition.x;
                            entity.position.y = entity.targetPosition.y;
                            entity.position.z = entity.targetPosition.z;
                        }

                        if (entity.mesh) {
                            entity.mesh.position.set(
                                entity.position.x,
                                entity.position.y,
                                entity.position.z
                            );
                        }

                        // Immediately broadcast our state
                        this._broadcastSingleEntityState(entity, bakeryId);
                    }
                }
            }
        }
    }

    /**
     * Broadcast state for a single entity (used after authority transfer)
     * @param {object} entity
     * @param {string} bakeryId
     */
    _broadcastSingleEntityState(entity, bakeryId) {
        if (!this.broadcastP2P) return;

        this.broadcastP2P({
            type: 'baker_state',
            bakeryId: bakeryId,
            position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
            rotation: entity.rotation,
            state: entity.state,
            targetId: entity.targetId,
            carrying: [...entity.carrying],
            moving: entity.visual?.isMoving || false,
            stuckReason: entity.stuckReason
        });
    }

    /**
     * Handle peer changing chunks - recalculate authority if needed
     * @param {string} peerId
     * @param {string} oldChunkKey
     * @param {string} newChunkKey
     */
    onPeerChunkChanged(peerId, oldChunkKey, newChunkKey) {
        const CHUNK_SIZE = 50;
        const [newX, newZ] = newChunkKey.split(',').map(Number);

        for (const [bakeryId, entity] of this.bakers) {
            const homeChunkX = Math.floor(entity.homePosition.x / CHUNK_SIZE);
            const homeChunkZ = Math.floor(entity.homePosition.z / CHUNK_SIZE);
            const dx = Math.abs(newX - homeChunkX);
            const dz = Math.abs(newZ - homeChunkZ);
            const isNowInRange = dx <= 1 && dz <= 1;

            // Case 1: Current authority left the region
            if (entity.authorityId === peerId && !isNowInRange) {
                const newAuthority = this._calculateAuthority(bakeryId);
                if (newAuthority) {
                    const wasMe = entity.authorityId === this.clientId;
                    const isNowMe = newAuthority === this.clientId;
                    entity.authorityId = newAuthority;

                    if (isNowMe && !wasMe) {
                        // Snap to last known position
                        if (entity.targetPosition) {
                            entity.position.x = entity.targetPosition.x;
                            entity.position.y = entity.targetPosition.y;
                            entity.position.z = entity.targetPosition.z;
                        }
                        if (entity.mesh) {
                            entity.mesh.position.set(
                                entity.position.x,
                                entity.position.y,
                                entity.position.z
                            );
                        }
                        this._broadcastSingleEntityState(entity, bakeryId);
                    }
                }
            }
            // Case 2: A peer entered the region - might have lower clientId
            else if (isNowInRange && entity.authorityId !== peerId) {
                const newAuthority = this._calculateAuthority(bakeryId);
                if (newAuthority && newAuthority !== entity.authorityId) {
                    const wasMe = entity.authorityId === this.clientId;
                    const isNowMe = newAuthority === this.clientId;
                    entity.authorityId = newAuthority;

                    if (isNowMe && !wasMe) {
                        if (entity.targetPosition) {
                            entity.position.x = entity.targetPosition.x;
                            entity.position.y = entity.targetPosition.y;
                            entity.position.z = entity.targetPosition.z;
                        }
                        if (entity.mesh) {
                            entity.mesh.position.set(
                                entity.position.x,
                                entity.position.y,
                                entity.position.z
                            );
                        }
                        this._broadcastSingleEntityState(entity, bakeryId);
                    }
                }
            }
        }
    }
```

---

## Fix 5: Add Y Position Validation in State Handler

**(Already included in Fix 1)**

---

## Fix 6: Add Spawn Queue Integration

**Problem**: Baker spawns immediately, causing frame stutter when multiple bakers spawn at once. Bandit uses `AISpawnQueue`.

### File: `public/ai/BakerController.js`

**Add import at top of file (around line 5436-5440):**

```javascript
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from '../config.js';
import { modelManager } from '../objects.js';
import { ChunkCoordinates } from '../core/ChunkCoordinates.js';
import { getAISpawnQueue } from './AISpawnQueue.js'; // ADD
```

**Add to `initialize` method (around line 5530):**

```javascript
        console.log('[BakerController] Initialized');
        
        // ADD: Register spawn callback with queue system
        const spawnQueue = getAISpawnQueue();
        spawnQueue.registerSpawnCallback('baker', (data) => {
            this._executeSpawn(data);
        });
```

**Add new spawn execution method:**

```javascript
    /**
     * Execute spawn from queue (called by AISpawnQueue)
     * @param {object} data - Spawn data from queue { bakery }
     */
    _executeSpawn(data) {
        const { bakery } = data;

        // Race condition check - entity may have spawned while in queue
        if (this.bakers.has(bakery.id)) {
            return;
        }

        this._spawnBaker(bakery);
    }
```

**Modify `checkBakerSpawn` to use queue (around line 5598-5600):**

```javascript
                        if (distSq <= maxDistSq) {
                            // ADD: Queue spawn instead of immediate spawn
                            const spawnQueue = getAISpawnQueue();
                            if (!spawnQueue.isQueued('baker', bakery.id)) {
                                spawnQueue.queueSpawn('baker', { bakery }, bakery.id);
                            }
                        }
```

---

## Fix 7: Fix Animation Controller Reference

**Problem**: Baker uses `entity.visual` inconsistently. Bandit uses `entity.controller` for animation/movement state.

### File: `public/ai/BakerController.js`

**Modify entity creation in `_spawnBaker` to add controller field:**

```javascript
        const entity = {
            bakeryId: bakeryId,
            position: { x: spawnX, y: spawnY, z: spawnZ },
            targetPosition: { x: spawnX, y: spawnY, z: spawnZ },
            rotation: 0,
            targetRotation: 0,
            homePosition: { x: bakeryData.position.x, y: homeY, z: bakeryData.position.z },
            state: BAKER_STATE.IDLE,
            targetId: null,
            carrying: [],
            path: [],
            pathIndex: 0,
            lastPathTime: 0,
            pathFailures: 0,
            stuckReason: null,
            stuckTime: 0,
            previousTask: null,
            requestSentAt: null,
            spawnedBy: this.clientId,
            spawnTime: Date.now(),
            authorityId: this.clientId,
            mesh: null,
            visual: null,
            controller: null, // ADD: Reference to visual for animation control
            _lastDecisionTime: 0
        };
```

**After creating visual, set controller reference:**

```javascript
        // Create visual
        const visualCreated = this._createBakerVisual(entity);
        if (!visualCreated) {
            console.warn(`[BakerController] Failed to create visual for baker at ${bakeryId}, aborting spawn`);
            this.bakers.delete(bakeryId);
            return;
        }
        
        // Set controller reference for animation control (consistent with Bandit)
        entity.controller = entity.visual;
```

---

## Fix 8: Add Frame-Based Distance Culling

**Problem**: Baker updates all entities every frame. Bandit uses distance culling for performance.

### File: `public/ai/BakerController.js`

**Modify `update` method (around line 5771-5786):**

```javascript
    update(deltaTime) {
        if (!CONFIG.BAKER?.ENABLED) return;

        this._frameCount++;
        const now = Date.now();

        // ADD: Get local player position for distance culling
        let myPos = null;
        if (this.game?.playerObject?.position) {
            myPos = this.game.playerObject.position;
        }
        
        const NEAR_DISTANCE_SQ = 50 * 50;
        const FAR_UPDATE_INTERVAL = 4; // Update distant bakers every 4th frame

        // Update all bakers
        for (const [bakeryId, entity] of this.bakers) {
            // ADD: Distance culling for performance
            if (myPos) {
                const dx = entity.position.x - myPos.x;
                const dz = entity.position.z - myPos.z;
                const distSq = dx * dx + dz * dz;
                
                // Skip distant bakers most frames
                if (distSq > NEAR_DISTANCE_SQ) {
                    if (this._frameCount % FAR_UPDATE_INTERVAL !== 0) {
                        // Still update animation mixer for smooth visuals
                        if (entity.visual?.mixer) {
                            entity.visual.mixer.update(deltaTime);
                        }
                        continue;
                    }
                }
            }
            
            this._updateEntity(entity, deltaTime);
        }

        // Broadcast authority state periodically
        if (now - this._lastBroadcastTime >= (CONFIG.BAKER?.BROADCAST_INTERVAL || 1000)) {
            this._lastBroadcastTime = now;
            this.broadcastAuthorityState();
        }
    }
```

---

## Fix 9: Improve Peer Disconnect Handler

**Problem**: Baker's `onPeerDisconnected` doesn't snap position or broadcast state like Bandit does.

### File: `public/ai/BakerController.js`

**Replace `onPeerDisconnected` method (around line 6774-6782):**

```javascript
    /**
     * Handle peer disconnect - transfer authority and sync state
     */
    onPeerDisconnected(peerId) {
        for (const [bakeryId, entity] of this.bakers) {
            if (entity.authorityId === peerId) {
                // Recalculate authority
                const newAuthority = this._calculateAuthority(bakeryId);
                if (newAuthority) {
                    const wasMe = entity.authorityId === this.clientId;
                    const isNowMe = newAuthority === this.clientId;
                    entity.authorityId = newAuthority;

                    // If we're taking over authority, handle position transfer
                    if (isNowMe && !wasMe) {
                        // Snap position to last known authoritative position
                        if (entity.targetPosition) {
                            entity.position.x = entity.targetPosition.x;
                            entity.position.y = entity.targetPosition.y;
                            entity.position.z = entity.targetPosition.z;
                        }

                        // Sync mesh position
                        if (entity.mesh) {
                            entity.mesh.position.set(
                                entity.position.x,
                                entity.position.y,
                                entity.position.z
                            );
                        }

                        // Immediately broadcast our state so other peers sync
                        this._broadcastSingleEntityState(entity, bakeryId);
                    }

                    console.log(`[BakerController] Baker ${bakeryId} authority transferred from ${peerId} to ${newAuthority}`);
                }
            }
        }
    }
```

---

## Fix 10: Add Missing Configuration Constants

**Problem**: Baker relies on CONFIG.BAKER but some values might be missing. Add defaults like Bandit's AI_CONFIG.

### File: `public/ai/BakerController.js`

**Add after imports (around line 5441):**

```javascript
// Baker configuration defaults (matches Bandit pattern)
const BAKER_CONFIG = {
    CHUNK_SIZE: 50,
    MOVE_SPEED: 0.8,           // Units per second (slower than bandit)
    PATHFIND_INTERVAL: 6000,   // Recalculate path every 6 seconds
    IDLE_CHECK_INTERVAL: 1000, // Check for tasks every second
    BROADCAST_INTERVAL: 1000,  // Broadcast state every second
    MARKET_MAX_DISTANCE: 20,   // Max distance to market
    APPLE_SEARCH_RADIUS_SQ: 2500, // 50^2 units
    APPLES_PER_TRIP: 2,
    STUCK_TIMEOUT: 60000,      // Auto-recover after 60 seconds
    NPC_COLOR: 0xCC7722,       // Baker apron color
};

// Merge with CONFIG.BAKER if it exists
const getConfig = (key) => {
    return CONFIG.BAKER?.[key] ?? BAKER_CONFIG[key];
};
```

**Then update usages throughout the file to use `getConfig()` for fallbacks, e.g.:**

```javascript
// Instead of:
if (now - entity._lastDecisionTime < (CONFIG.BAKER?.IDLE_CHECK_INTERVAL || 1000))

// Use:
if (now - entity._lastDecisionTime < getConfig('IDLE_CHECK_INTERVAL'))
```

---

## Fix 11: Robust Response Handler Validation

**Problem**: Response handlers don't validate all data fields robustly.

### File: `public/ai/BakerController.js`

**Improve `handleAppleCollectResponse` (around line 6621):**

```javascript
    handleAppleCollectResponse(data) {
        if (!data) {
            console.warn('[BakerController] handleAppleCollectResponse called with undefined data');
            return;
        }
        
        const { success, collected, treeId, bakeryId } = data;
        
        // ADD: Validate bakeryId
        if (!bakeryId) {
            console.warn('[BakerController] handleAppleCollectResponse missing bakeryId');
            return;
        }

        const entity = this.bakers.get(bakeryId);
        if (!entity) {
            console.warn(`[BakerController] No entity found for bakeryId: ${bakeryId}`);
            return;
        }
        
        if (entity.state !== BAKER_STATE.COLLECTING_APPLES) {
            // State may have changed - ignore stale response
            return;
        }

        entity.requestSentAt = null;

        if (success && Array.isArray(collected) && collected.length > 0) {
            for (const item of collected) {
                if (item && item.type) {
                    entity.carrying.push(item);
                }
            }
        }

        if (treeId) {
            this._checkedTrees.add(treeId);
        }

        // ... rest of method unchanged
    }
```

**Apply similar validation to `handleCollectResponse` and `handleDepositResponse`.**

---

## Complete Changed File Structure

After applying all fixes, the BakerController should have:

```
BakerController
├── Constructor
│   ├── this.bakers Map
│   ├── this.pendingStates Map (NEW)
│   ├── this._broadcastMsg
│   └── this._checkedTrees
│
├── Initialization
│   └── initialize() - with spawn queue registration (NEW)
│
├── Spawning  
│   ├── checkBakerSpawn() - uses spawn queue (MODIFIED)
│   ├── _executeSpawn() (NEW)
│   └── _spawnBaker() - with visual validation (MODIFIED)
│
├── Visual
│   └── _createBakerVisual() - returns boolean
│
├── Update Loop
│   ├── update() - with distance culling (MODIFIED)
│   └── _updateEntity()
│
├── State Handlers
│   └── [existing handlers]
│
├── Authority Management (NEW SECTION)
│   ├── _calculateAuthority()
│   ├── _broadcastSingleEntityState()
│   ├── onPeerJoinedChunk()
│   └── onPeerChunkChanged()
│
├── P2P Message Handlers
│   ├── handleSpawnMessage() - with pendingStates (MODIFIED)
│   ├── handleStateMessage() - with Y validation, pendingStates (MODIFIED)
│   └── handleDespawnMessage()
│
├── Sync Methods
│   ├── syncBakersFromPeer()
│   ├── getActiveBakersForSync()
│   └── broadcastAuthorityState()
│
├── Server Response Handlers
│   ├── handleAppleCollectResponse() - improved validation
│   ├── handleCollectResponse()
│   └── handleDepositResponse()
│
├── Cleanup
│   ├── _disposeBaker()
│   ├── onBakeryDestroyed()
│   └── onPeerDisconnected() - improved (MODIFIED)
│
└── Utility
    └── getBakerDialogueData()
```

---

## Testing Checklist

After implementing fixes, verify:

- [ ] Baker spawns when ship arrives at dock near bakery
- [ ] Baker doesn't spawn if another player with lower clientId is closer
- [ ] Multiple bakers spawning at once don't cause frame stutter
- [ ] Baker position syncs correctly between peers
- [ ] Authority transfers correctly when original authority disconnects
- [ ] Authority recalculates when new peer joins the area
- [ ] State messages arriving before spawn are applied correctly
- [ ] Invalid Y positions don't cause NaN/floating issues
- [ ] Baker animations play correctly for walk/idle
- [ ] Distant bakers don't impact performance (distance culling works)

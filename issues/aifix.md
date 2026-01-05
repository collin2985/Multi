# AI Synchronization Fixes

---

## Code Analysis Findings (2025-12-26)

### Verified Line Numbers (actual codebase):

| File | Method | Actual Lines | Notes |
|------|--------|--------------|-------|
| AIController.js | handleStateMessage | 1629-1686 | Already has pendingStates Map (line 1635) |
| AIController.js | _broadcastEntityState | 1440-1457 | Missing authorityId, homePosition |
| AIController.js | _calculateAuthority | 1404-1433 | No sticky authority |
| AIController.js | _destroyEntity | 1864-1873 | Works correctly |
| AIController.js | onChunkUnloaded | N/A | **DOES NOT EXIST** |
| BrownBearController.js | handleStateMessage | 1248-1285 | Returns silently, **NO pendingStates** |
| BrownBearController.js | _broadcastState | 1224-1246 | Missing authorityId, homePosition |
| BrownBearController.js | onChunkUnloaded | 1488-1498 | Exists but no pending cleanup |
| BrownBearController.js | checkSpawnsOnTick | 965-1036 | Authority calc at 1011-1024 |
| DeerController.js | handleStateMessage | 782-830 | Has pendingStates (line 787) |
| DeerController.js | _broadcastEntityState | 1433-1446 | Uses _getExtraStateData |
| DeerController.js | _getExtraStateData | 446-462 | **ALREADY sends homeTreeX/Z!** |
| DeerController.js | onChunkUnloaded | 637-649 | Exists |
| DeerController.js | checkSpawnsOnTick | 517-581 | Authority calc at 570-576 |
| DeerController.js | pendingStates | line 119 | Initialized in constructor |
| ChunkManager.js | disposeChunk | 305-393 | **Method is disposeChunk(), NOT unloadChunk** |

### Key Corrections to Original Plan:

1. **Fix #1.6 NOT NEEDED** - DeerController already broadcasts `homeTreeX` and `homeTreeZ` via `_getExtraStateData()` (lines 449-450)

2. **ChunkManager method name**: The cleanup method is `disposeChunk()` (line 305), not `unloadChunk`

3. **ChunkManager cleanup location**: Structure cleanup and controller notifications are at lines 373-392

4. **AIController already has pendingStates**: Line 1635 creates `this.pendingStates` if needed - lazy spawn code should use this existing pattern

5. **AI_CONFIG locations**:
   - AIController: `AI_CONFIG.CHUNK_SIZE` (line 27) = 50
   - BrownBearController: `AI_CONFIG.BROWN_BEAR.CHUNK_SIZE` (line 63) = 50
   - DeerController: `DEER_CONFIG.CHUNK_SIZE` (line 31) = 50

### Safety Validations (verified by code analysis):

| Fix | Safety Status | Critical Requirements |
|-----|---------------|----------------------|
| Lazy Spawn | SAFE | Use `spawnedBy: null` for lazy entities; abort if `createVisual` returns null |
| Broadcast Changes | SAFE | Extra fields ignored by destructuring; DeerController already sends authorityId |
| onChunkUnloaded | SAFE | Use `this.game?.aiController` pattern; `_destroyEntity` is defensive |
| Sticky Authority | **CONDITIONAL** | MUST validate `players.has(entity.authorityId)` before returning sticky |

**Critical sticky authority requirement**: The fix MUST check that current authority is still in the player set before returning it. Without this check, authority can become "stuck" to a disconnected player, causing frozen entities.

---

## Issue #1: Late Join Handling (VALIDATED)

**Problem:** When a player enters a chunk where an AI already exists (managed by another player), the newcomer receives state updates but `handleStateMessage` returns early because the entity doesn't exist locally. They end up with no entity while the authority client continues simulating it.

**Evidence (corrected line numbers):**
- `AIController.js:1633-1638` - stores pending state and returns without creating entity
- `BrownBearController.js:1251-1252` - just returns silently, no pending queue
- `DeerController.js:785-788` - stores pending state and returns without creating entity

### Fix #1.1: AIController.js - Lazy Spawn from State

Replace the beginning of `handleStateMessage` (around line 1629) with:

```javascript
handleStateMessage(data) {
    const { tentId, position, rotation, state, target, shotCount, lastShotTime, pendingKills, moving, inCombatStance, speedMultiplier, authorityId, homePosition } = data;

    let entity = this.entities.get(tentId);

    // FIX: Lazy Spawn - If we receive state for a missing entity, create it
    if (!entity) {
        // Don't lazy spawn if we are the authority (we should have known about it)
        // Also validate authorityId exists
        if (!authorityId || authorityId === this.clientId) {
            this.pendingStates = this.pendingStates || new Map();
            this.pendingStates.set(tentId, data);
            return;
        }

        // ROBUSTNESS: Validate position data before proceeding
        if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) {
            console.warn(`[Bandit ${tentId}] Invalid position in state message, skipping lazy spawn`);
            return;
        }

        // Validate Y position
        let validY = position.y;
        if (!Number.isFinite(validY) || validY <= 0) {
            if (this.getTerrainHeight) {
                validY = this.getTerrainHeight(position.x, position.z);
            }
            if (!Number.isFinite(validY) || validY <= 0) validY = 10; // Safe default above water
        }

        // Need homePosition - estimate from current position if not available
        const home = homePosition && Number.isFinite(homePosition.x)
            ? homePosition
            : { x: position.x, z: position.z };

        // Create visual first - if it fails, store pending state
        const visual = this.createVisual ? this.createVisual(tentId, { x: position.x, y: validY, z: position.z }) : null;
        if (!visual) {
            this.pendingStates = this.pendingStates || new Map();
            this.pendingStates.set(tentId, data);
            return;
        }

        // ROBUSTNESS: Validate we got a real mesh
        const mesh = visual.mesh || visual.enemy || visual;
        if (!mesh || !mesh.position) {
            console.warn(`[Bandit ${tentId}] createVisual returned invalid mesh, skipping lazy spawn`);
            this.pendingStates = this.pendingStates || new Map();
            this.pendingStates.set(tentId, data);
            return;
        }

        // Create entity from state data
        entity = {
            tentId: tentId,
            type: 'bandit',
            authorityId: authorityId,
            spawnedBy: authorityId,
            spawnTime: Date.now(),

            homePosition: { x: home.x, z: home.z },
            position: { x: position.x, y: validY, z: position.z },
            rotation: rotation || 0,

            state: state || 'idle',
            target: target,

            path: [],
            pathIndex: 0,
            lastPathTime: 0,

            shotCount: shotCount || 0,
            lastShotTime: lastShotTime || 0,
            pendingKills: new Set(),

            mesh: mesh,
            controller: visual,

            targetPosition: { x: position.x, y: validY, z: position.z },
            targetRotation: rotation,

            _logged: { spawn: true, firstTarget: false, chasing: false, engagement: false,
                       firstShotWait: false, leashed: false, returning: false, idle: false, dead: false }
        };

        this.entities.set(tentId, entity);

        // Register name tag
        if (this.game?.nameTagManager && entity.mesh) {
            this.game.nameTagManager.registerEntity(`bandit_${tentId}`, 'Bandit', entity.mesh);
        }

        console.log(`[Bandit ${tentId}] Lazy spawned from peer state update`);
    }

    // Ignore if we're authority
    if (entity.authorityId === this.clientId) return;

    // ... rest of existing handleStateMessage code (validation and state updates) ...
```

### Fix #1.2: AIController.js - Update State Broadcast

**CRITICAL: Without this, lazy spawn will fail (missing homePosition).**

In `_broadcastEntityState` (around line 1899), the broadcast message object MUST include:

```javascript
// COMPLETE broadcast message structure for bandit_state:
const msg = {
    type: 'bandit_state',
    tentId: tentId,
    position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
    rotation: entity.rotation,
    state: entity.state,
    target: entity.target,
    shotCount: entity.shotCount,
    lastShotTime: entity.lastShotTime,
    pendingKills: Array.from(entity.pendingKills || []),
    moving: entity.controller?.moving || false,
    inCombatStance: entity.controller?.inCombatStance || false,
    speedMultiplier: entity.controller?.speedMultiplier || 1,
    // NEW REQUIRED FIELDS for lazy spawn:
    authorityId: entity.authorityId,
    homePosition: { x: entity.homePosition.x, z: entity.homePosition.z }
};
```

---

### Fix #1.3: BrownBearController.js - Lazy Spawn from State

Replace `handleStateMessage` (around line 1248) with:

```javascript
handleStateMessage(data) {
    const { denId, position, rotation, state, target, chaseTargetType, wanderDirection, fleeDirection, authorityId, homePosition } = data;

    let entity = this.entities.get(denId);

    // FIX: Lazy Spawn - If we receive state for a missing entity, create it
    if (!entity) {
        // Don't lazy spawn if we are the authority
        if (!authorityId || authorityId === this.clientId) {
            // ROBUSTNESS: Store pending state for retry (was missing!)
            this.pendingStates = this.pendingStates || new Map();
            this.pendingStates.set(denId, data);
            return;
        }

        // ROBUSTNESS: Validate position data
        if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) {
            console.warn(`[BrownBear ${denId}] Invalid position in state message, skipping lazy spawn`);
            return;
        }

        // Validate Y position
        let validY = position.y;
        if (!Number.isFinite(validY) || validY <= 0) {
            if (this.getTerrainHeight) {
                validY = this.getTerrainHeight(position.x, position.z);
            }
            if (!Number.isFinite(validY) || validY <= 0) validY = 10;
        }

        // Need homePosition for the entity
        const home = homePosition && Number.isFinite(homePosition.x)
            ? homePosition
            : { x: position.x, z: position.z };

        // Create visual first
        const visual = this.createVisual ? this.createVisual(denId, { x: position.x, y: validY, z: position.z }) : null;
        if (!visual) {
            // ROBUSTNESS: Store pending state for retry (was missing!)
            this.pendingStates = this.pendingStates || new Map();
            this.pendingStates.set(denId, data);
            console.log(`[BrownBear ${denId}] Lazy spawn deferred - visual creation pending`);
            return;
        }

        // ROBUSTNESS: Validate mesh
        const mesh = visual.mesh || visual;
        if (!mesh || !mesh.position) {
            this.pendingStates = this.pendingStates || new Map();
            this.pendingStates.set(denId, data);
            return;
        }

        // Create entity from state data (matches _spawnBear pattern)
        entity = {
            denId: denId,
            type: 'brownbear',
            authorityId: authorityId,
            spawnedBy: authorityId,
            spawnTime: Date.now(),

            homePosition: { x: home.x, z: home.z },
            position: { x: position.x, y: validY, z: position.z },
            rotation: rotation || 0,

            state: state || 'idle',
            target: target || null,
            chaseTargetType: chaseTargetType || null,

            wanderDirection: wanderDirection ? { x: wanderDirection.x, z: wanderDirection.z } : null,
            fleeDirection: fleeDirection ? { x: fleeDirection.x, z: fleeDirection.z } : null,

            lastWanderChange: Date.now(),
            lastFleeCheck: 0,

            mesh: mesh,
            controller: visual,
            mixer: visual.mixer || null,

            targetPosition: { x: position.x, y: validY, z: position.z },
            targetRotation: rotation,
        };

        this.entities.set(denId, entity);

        // Register name tag
        if (this.game?.nameTagManager && entity.mesh) {
            this.game.nameTagManager.registerEntity(`brownbear_${denId}`, 'Brown Bear', entity.mesh);
        }

        console.log(`[BrownBear ${denId}] Lazy spawned from peer state update`);
    }

    // Ignore if we're authority
    if (entity.authorityId === this.clientId) return;

    // Store for interpolation
    entity.targetPosition = { x: position.x, y: position.y, z: position.z };
    entity.targetRotation = rotation;
    entity.state = state;
    entity.target = target;
    entity.chaseTargetType = chaseTargetType || null;

    // Store wander direction
    if (wanderDirection) {
        entity.wanderDirection = { x: wanderDirection.x, z: wanderDirection.z };
    } else {
        entity.wanderDirection = null;
    }

    // Store flee direction
    if (fleeDirection) {
        entity.fleeDirection = { x: fleeDirection.x, z: fleeDirection.z };
    } else {
        entity.fleeDirection = null;
    }

    // Update visual controller flags
    if (entity.controller) {
        entity.controller.moving = state === 'chasing' || state === 'returning' || state === 'wandering' || state === 'fleeing';
        entity.controller.isWandering = state === 'wandering';
        entity.controller.isAttacking = state === 'attacking';
        entity.controller.isFleeing = state === 'fleeing';
    }
}
```

### Fix #1.4: BrownBearController.js - Update State Broadcast

**CRITICAL: Without this, lazy spawn will fail.**

In `_broadcastState` (around line 1224), the msg object MUST include:

```javascript
// COMPLETE broadcast message structure for brownbear_state:
const msg = {
    type: 'brownbear_state',
    denId: entity.denId,
    position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
    rotation: entity.rotation,
    state: entity.state,
    target: entity.target,
    chaseTargetType: entity.chaseTargetType,
    wanderDirection: entity.wanderDirection ? { x: entity.wanderDirection.x, z: entity.wanderDirection.z } : null,
    fleeDirection: entity.fleeDirection ? { x: entity.fleeDirection.x, z: entity.fleeDirection.z } : null,
    // NEW REQUIRED FIELDS for lazy spawn:
    authorityId: entity.authorityId,
    homePosition: { x: entity.homePosition.x, z: entity.homePosition.z }
};
```

---

### Fix #1.5: DeerController.js - Lazy Spawn from State

DeerController already stores pending states at line 787. The fix adds lazy entity creation. Replace `handleStateMessage` (around line 782):

```javascript
handleStateMessage(data) {
    const { treeId, position, rotation, state, authorityId, deathTick, wanderDirection, fleeDirection, homeTreeX, homeTreeZ } = data;

    let entity = this.entities.get(treeId);

    // FIX: Lazy Spawn - If we receive state for a missing entity, create it
    if (!entity) {
        // Don't lazy spawn if we are the authority
        if (!authorityId || authorityId === this.clientId) {
            this.pendingStates.set(treeId, { position, rotation, state, authorityId, deathTick, wanderDirection, fleeDirection, homeTreeX, homeTreeZ });
            return;
        }

        // ROBUSTNESS: Validate position data
        if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) {
            console.warn(`[Deer ${treeId}] Invalid position in state message, skipping lazy spawn`);
            return;
        }

        // Validate Y position - use terrain height or safe minimum
        let validY = position.y;
        if (!Number.isFinite(validY) || validY <= 0) {
            if (this.getTerrainHeight) {
                validY = this.getTerrainHeight(position.x, position.z);
            }
            // Use minimum spawn height instead of 0 (avoids underwater deer)
            if (!Number.isFinite(validY) || validY <= 0) {
                validY = DEER_CONFIG.SPAWN_HEIGHT_MIN || 10;
            }
        }

        // Create visual first
        const visual = this.createVisual ? this.createVisual(treeId, { x: position.x, y: validY, z: position.z }) : null;
        if (!visual) {
            this.pendingStates.set(treeId, { position, rotation, state, authorityId, deathTick, wanderDirection, fleeDirection, homeTreeX, homeTreeZ });
            return;
        }

        // ROBUSTNESS: Validate mesh
        const mesh = visual.mesh || visual;
        if (!mesh || !mesh.position) {
            this.pendingStates.set(treeId, { position, rotation, state, authorityId, deathTick, wanderDirection, fleeDirection, homeTreeX, homeTreeZ });
            return;
        }

        const chunkX = Math.floor(position.x / DEER_CONFIG.CHUNK_SIZE);
        const chunkZ = Math.floor(position.z / DEER_CONFIG.CHUNK_SIZE);

        // Create entity from state data
        entity = {
            treeId,
            chunkX,
            chunkZ,
            authorityId,
            spawnedBy: authorityId,

            homeTreeX: Number.isFinite(homeTreeX) ? homeTreeX : position.x,
            homeTreeZ: Number.isFinite(homeTreeZ) ? homeTreeZ : position.z,

            position: { x: position.x, y: validY, z: position.z },
            rotation: rotation || 0,
            targetRotation: rotation,

            state: state || 'idle',
            stateStartTime: Date.now(),
            wanderDirection: wanderDirection ? { ...wanderDirection } : null,
            fleeDirection: fleeDirection ? { ...fleeDirection } : null,

            mesh: mesh,
            mixer: visual.mixer || null,
            playAnimation: visual.playAnimation || null,

            targetPosition: { x: position.x, y: validY, z: position.z },
            lastBroadcast: 0,
            terrainFrameCount: 0,

            isDead: (state === 'dead'),
            deathStartTime: (state === 'dead') ? Date.now() : 0,
            deathTick: deathTick || 0,
            fallDirection: 1,
            killedBy: null,
            isHarvested: false,

            lastDetectionCheck: 0,
            cachedThreat: null,
            lastGunshotCheck: 0,
        };

        this.entities.set(treeId, entity);

        // Register name tag
        if (this.game?.nameTagManager && entity.mesh) {
            this.game.nameTagManager.registerEntity(`deer_${treeId}`, 'Deer', entity.mesh);
            if (entity.isDead) {
                this.game.nameTagManager.setEntityDead(`deer_${treeId}`);
            }
        }

        this._updateAnimation(entity);
        console.log(`[Deer ${treeId}] Lazy spawned from peer state update`);
        return; // State already applied during creation
    }

    // ... rest of existing handleStateMessage code ...
```

### Fix #1.6: DeerController.js - Update State Broadcast

**STATUS: NOT NEEDED - ALREADY IMPLEMENTED**

Code analysis confirmed that `_broadcastEntityState` (line 1433) calls `_getExtraStateData()` (lines 446-462) which already includes:
- `homeTreeX: entity.homeTreeX` (line 449)
- `homeTreeZ: entity.homeTreeZ` (line 450)

No changes required for DeerController broadcast.

---

## Issue #2: Infinite Respawn Loop (VALIDATED - Bandits Only)

**Problem:** When a bandit is killed and the chunk unloads, the dead entity remains in memory. Upon returning, `checkSpawnsOnTick()` finds the dead entity in the map and refuses to spawn a new one (line 238: `if (this.entities.has(tent.id)) continue`), but the dead entity has no mesh/visual. Result: invisible dead bandit blocks respawning forever.

**Evidence:**
- `BrownBearController.js:1488-1498` - HAS `onChunkUnloaded()` method
- `DeerController.js:637-648` - HAS `onChunkUnloaded()` method
- `AIController.js` - MISSING `onChunkUnloaded()` method
- `ChunkManager.js:382-391` - only calls cleanup for bears/deer, NOT bandits

### Fix #2.1: AIController.js - Add onChunkUnloaded Method

Add this method to AIController.js (around line 1874, after `_destroyEntity`):

```javascript
/**
 * Called when a chunk is unloaded - clean up entities in that chunk
 * Mirrors BrownBearController.onChunkUnloaded pattern
 * @param {string} chunkKey - e.g., "5,-3"
 */
onChunkUnloaded(chunkKey) {
    const CHUNK_SIZE = AI_CONFIG.CHUNK_SIZE;

    // Clean up entities in this chunk
    for (const [tentId, entity] of this.entities) {
        // ROBUSTNESS: Validate homePosition exists
        if (!entity.homePosition || !Number.isFinite(entity.homePosition.x)) {
            // Corrupted entity - destroy it
            if (this.game?.nameTagManager) {
                this.game.nameTagManager.unregisterEntity(`bandit_${tentId}`);
            }
            this._destroyEntity(tentId);
            continue;
        }

        const entityChunkX = Math.floor(entity.homePosition.x / CHUNK_SIZE);
        const entityChunkZ = Math.floor(entity.homePosition.z / CHUNK_SIZE);
        const entityChunkKey = `${entityChunkX},${entityChunkZ}`;

        if (entityChunkKey === chunkKey) {
            // Cleanup name tag
            if (this.game?.nameTagManager) {
                this.game.nameTagManager.unregisterEntity(`bandit_${tentId}`);
            }
            this._destroyEntity(tentId);
        }
    }

    // ROBUSTNESS: Clean up pending states for entities in this chunk (prevent memory leak)
    if (this.pendingStates) {
        for (const [tentId, pendingData] of this.pendingStates) {
            const pos = pendingData.position || pendingData.homePosition;
            if (!pos || !Number.isFinite(pos.x)) {
                this.pendingStates.delete(tentId);
                continue;
            }
            const chunkX = Math.floor(pos.x / CHUNK_SIZE);
            const chunkZ = Math.floor(pos.z / CHUNK_SIZE);
            const pendingChunkKey = `${chunkX},${chunkZ}`;

            if (pendingChunkKey === chunkKey) {
                this.pendingStates.delete(tentId);
            }
        }
    }
}
```

### Fix #2.2: BrownBearController.js - Add Pending State Cleanup

BrownBearController's `onChunkUnloaded` (line 1488) should also clean pending states. Add after the entity cleanup loop:

```javascript
onChunkUnloaded(chunkKey) {
    // ... existing entity cleanup code ...

    // ROBUSTNESS: Clean up pending states for this chunk
    if (this.pendingStates) {
        for (const [denId, pendingData] of this.pendingStates) {
            const pos = pendingData.position || pendingData.homePosition;
            if (!pos || !Number.isFinite(pos.x)) {
                this.pendingStates.delete(denId);
                continue;
            }
            const chunkX = Math.floor(pos.x / AI_CONFIG.BROWN_BEAR.CHUNK_SIZE);
            const chunkZ = Math.floor(pos.z / AI_CONFIG.BROWN_BEAR.CHUNK_SIZE);
            const pendingChunkKey = `${chunkX},${chunkZ}`;

            if (pendingChunkKey === chunkKey) {
                this.pendingStates.delete(denId);
            }
        }
    }
}
```

### Fix #2.3: ChunkManager.js - Call Bandit Cleanup on Chunk Unload

In `public/world/ChunkManager.js`, find the `disposeChunk` method (line 305). After the bandit structure registry cleanup (around line 374-376), add:

```javascript
// Around line 373-392, add bandit controller cleanup:

// Clear bandit structures registry for this chunk (will be re-registered when chunk loads again)
if (this.gameState.banditStructuresByChunk.has(key)) {
    this.gameState.banditStructuresByChunk.delete(key);
}
// ADD THIS: Notify bandit controller to clean up entities in this chunk
if (this.game?.aiController) {
    this.game.aiController.onChunkUnloaded(key);
}

// Existing bear den cleanup...
if (this.gameState.bearDenStructuresByChunk.has(key)) {
    this.gameState.bearDenStructuresByChunk.delete(key);
}
if (this.game?.brownBearController) {
    this.game.brownBearController.onChunkUnloaded(key);
}

// Existing deer cleanup...
if (this.gameState.deerTreeStructuresByChunk.has(key)) {
    this.gameState.deerTreeStructuresByChunk.delete(key);
}
if (this.game?.deerController) {
    this.game.deerController.onChunkUnloaded(key);
}
```

---

## Issue #3: Authority Conflicts (VALIDATED)

**Problem:** The `_calculateAuthority` method recalculates authority on every call without preferring the existing authority. When player lists are slightly out of sync due to latency, two players can both think they should spawn the same entity.

**Evidence:**
- `AIController.js:1404-1433` - no stickiness, just picks lowest ID every time
- `BrownBearController.js:1011-1024` - same pattern
- `DeerController.js:554-577` - same pattern

### Fix #3.1: AIController.js - Add Sticky Authority

Replace `_calculateAuthority` (around line 1404) with:

```javascript
/**
 * Calculate who should be authority for an entity
 * Uses "sticky authority" - prefers current authority if still valid
 * @param {string} tentId
 * @returns {string|null} clientId or null if no players nearby
 */
_calculateAuthority(tentId) {
    const entity = this.entities.get(tentId);
    if (!entity) return null;

    const currentAuthority = entity.authorityId;

    // ROBUSTNESS: Validate homePosition before chunk calculation
    if (!entity.homePosition || !Number.isFinite(entity.homePosition.x)) {
        return this.clientId; // Fallback to self if data corrupted
    }

    const CHUNK_SIZE = AI_CONFIG.CHUNK_SIZE;
    const homeChunkX = Math.floor(entity.homePosition.x / CHUNK_SIZE);
    const homeChunkZ = Math.floor(entity.homePosition.z / CHUNK_SIZE);
    const homeChunkKey = `${homeChunkX},${homeChunkZ}`;

    // Check home chunk first
    let players = this.getPlayersInChunks([homeChunkKey]);

    // Fallback: 3x3 around home
    if (!players || players.size === 0) {
        const chunkKeys = this._get3x3ChunkKeys(homeChunkX, homeChunkZ);
        players = this.getPlayersInChunks(chunkKeys);
    }

    if (!players || players.size === 0) return null;

    // FIX: Sticky authority - if current authority is still valid, keep them
    // This prevents authority "flapping" when distances are nearly equal
    // ROBUSTNESS: Validate currentAuthority is a string before has() check
    if (currentAuthority && typeof currentAuthority === 'string' && players.has(currentAuthority)) {
        return currentAuthority;
    }

    // Fallback: find lowest clientId
    let lowestId = null;
    for (const playerId of players) {
        if (lowestId === null || playerId < lowestId) {
            lowestId = playerId;
        }
    }
    return lowestId;
}
```

### Fix #3.2: BrownBearController.js - Add Sticky Authority to Spawn Check

In `checkSpawnsOnTick` (around line 1011), modify the authority calculation:

```javascript
// Replace the authority calculation section with:

// Find authority: prefer existing if valid, else lowest clientId in range
let authorityId = this.clientId;

// Check if there's an existing entity with valid authority
const existingEntity = this.entities.get(den.id);
const currentAuthority = existingEntity?.authorityId;

// Sticky: if current authority is still in range, keep them
let currentAuthorityValid = false;
if (currentAuthority && typeof currentAuthority === 'string') {
    const currentPos = playerPositions.get(currentAuthority);
    // ROBUSTNESS: Validate position exists and has valid coordinates
    if (currentPos && Number.isFinite(currentPos.x) && Number.isFinite(currentPos.z)) {
        const dxC = currentPos.x - denX;
        const dzC = currentPos.z - denZ;
        if (dxC * dxC + dzC * dzC < spawnRangeSq) {
            currentAuthorityValid = true;
            authorityId = currentAuthority;
        }
    }
}

// Only recalculate if current authority is invalid
if (!currentAuthorityValid) {
    for (const [playerId, pos] of playerPositions) {
        if (playerId === this.clientId) continue;
        // ROBUSTNESS: Validate position
        if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) continue;

        const dxP = pos.x - denX;
        const dzP = pos.z - denZ;
        if (dxP * dxP + dzP * dzP < spawnRangeSq) {
            if (playerId < authorityId) {
                authorityId = playerId;
            }
        }
    }
}

if (authorityId === this.clientId) {
    // ... existing spawn queue code ...
}
```

### Fix #3.3: DeerController.js - Add Sticky Authority to Spawn Check

In `checkSpawnsOnTick` (around line 554), apply the same sticky authority pattern:

```javascript
// Replace the authority calculation section with:

// Gather nearby players for authority check - use Set for O(1) lookup
const nearbyIdSet = new Set([this.clientId]);
const treeChunkX = Math.floor(treeX / DEER_CONFIG.CHUNK_SIZE);
const treeChunkZ = Math.floor(treeZ / DEER_CONFIG.CHUNK_SIZE);
const chunkKeys = this._get3x3ChunkKeys(treeChunkX, treeChunkZ);
const playerIds = this.getPlayersInChunks ? this.getPlayersInChunks(chunkKeys) : [];

if (playerIds) {
    for (const playerId of playerIds) {
        if (playerId !== this.clientId) {
            nearbyIdSet.add(playerId);
        }
    }
}

// FIX: Sticky authority - check if existing authority is still valid
const existingEntity = this.entities.get(tree.id);
const currentAuthority = existingEntity?.authorityId;

if (currentAuthority && typeof currentAuthority === 'string' && nearbyIdSet.has(currentAuthority)) {
    // Current authority is still in range, they keep control
    if (currentAuthority !== this.clientId) {
        continue; // Not our spawn to handle
    }
    // We are current authority, proceed with spawn check
} else {
    // No valid current authority, use lowest ID
    const nearbyIds = Array.from(nearbyIdSet).sort();
    if (nearbyIds[0] !== this.clientId) {
        continue; // Someone else should spawn
    }
}

// Queue spawn...
```

---

## Summary of Changes

| Fix # | File | Change | Status |
|-------|------|--------|--------|
| #1.1 | AIController.js | Add lazy spawn with position validation in handleStateMessage | NEEDED |
| #1.2 | AIController.js | Add homePosition + authorityId to state broadcast | NEEDED |
| #1.3 | BrownBearController.js | Add lazy spawn with position validation + pending state queue | NEEDED |
| #1.4 | BrownBearController.js | Add homePosition + authorityId to state broadcast | NEEDED |
| #1.5 | DeerController.js | Add lazy spawn with position validation | NEEDED |
| #1.6 | DeerController.js | Add homeTreeX/Z to state broadcast | **NOT NEEDED** (already in _getExtraStateData) |
| #2.1 | AIController.js | Add onChunkUnloaded with null checks + pending cleanup | NEEDED |
| #2.2 | BrownBearController.js | Add pending state cleanup to onChunkUnloaded | NEEDED |
| #2.3 | ChunkManager.js (disposeChunk) | Call aiController.onChunkUnloaded | NEEDED |
| #3.1 | AIController.js | Add sticky authority with type validation | NEEDED |
| #3.2 | BrownBearController.js | Add sticky authority with position validation | NEEDED |
| #3.3 | DeerController.js | Add sticky authority using Set for O(1) lookup | NEEDED |

---

## Robustness Improvements Added

| Category | Improvement | Files Affected |
|----------|-------------|----------------|
| Position Validation | Check `Number.isFinite()` on x, y, z before use | All lazy spawns |
| Mesh Validation | Verify mesh has `.position` property after createVisual | All lazy spawns |
| Null Checks | Validate homePosition exists before chunk calculations | onChunkUnloaded, _calculateAuthority |
| Memory Leak Prevention | Clean up pendingStates on chunk unload | AIController, BrownBearController |
| Missing Pending Queue | Add pendingStates to BrownBearController | BrownBearController |
| Type Validation | Check `typeof === 'string'` on authorityId | All authority calculations |
| Performance | Use Set instead of Array for O(1) lookup | DeerController sticky authority |
| Safe Defaults | Use minimum height (10) instead of 0 for Y fallback | All lazy spawns |

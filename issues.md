# Issues Tracker

## Template for Adding New Issues

```markdown
### [ISSUE-XXX] Title
**Severity:** CRITICAL | HIGH | MEDIUM | LOW
**Status:** OPEN | IN_PROGRESS | RESOLVED | WONT_FIX
**Category:** Authority | Networking | State | Animation | Performance | UI | Other
**Files:** `path/to/file.js:line-range`, `path/to/other.js:line`

**Description:**
Brief description of the issue.

**Root Cause:**
Technical explanation of why this happens.

**Impact:**
What the user/player experiences.

**Suggested Fix:**
Code changes or approach to resolve.

**Related Issues:** ISSUE-XXX, ISSUE-YYY
```

---

## Critical Issues

### [ISSUE-001] Authority Transfer Position Loss
**Severity:** CRITICAL
**Status:** RESOLVED
**Category:** Authority
**Files:** `public/ai/BearController.js:1854-1893`, `public/ai/DeerController.js:1401-1439`

**Description:**
When a new peer joins with a lower clientId, authority transfers but position gets lost or snaps to stale `targetPosition`. The new authority may have never received the current position.

**Root Cause:**
Authority transfer doesn't include current position state. New authority inherits entity with null or stale targetPosition.

**Impact:**
Entities teleport or freeze at wrong positions when players join/leave.

**Suggested Fix:**
Include current position in authority transfer handoff. New authority should immediately broadcast current state.

**Resolution:**
Fixed in `onPeerDisconnected()` and `onPeerChunkChanged()` for all three AI controllers:
- **BearController.js**: Position validated against terrain, mesh synced, immediate broadcast
- **DeerController.js**: Position validated against terrain, mesh synced, immediate broadcast
- **AIController.js** (bandits): Added `_broadcastEntityState()` helper, mesh synced, immediate broadcast

**Related Issues:** ISSUE-004, ISSUE-005

---

### [ISSUE-002] String Sorting Instead of Numeric for Authority
**Severity:** CRITICAL
**Status:** RESOLVED
**Category:** Authority
**Files:** `public/ai/BearController.js:685-700`, `public/ai/DeerController.js:644-659`

**Description:**
Authority determination uses lexicographic string sort instead of numeric sort.

**Root Cause:**
```javascript
candidates.sort();  // Lexicographic! "12" < "2"
```
This breaks deterministic authority - different clients can calculate different authorities.

**Impact:**
Dual-authority (two clients both simulating same entity) or no-authority (entity freezes) situations. Non-deterministic behavior across clients.

**Suggested Fix:**
```javascript
candidates.sort((a, b) => parseInt(a) - parseInt(b));
```

**Resolution:**
Fixed in all three AI controllers:
- **BearController.js**: `_determineAuthority()` now uses numeric sort
- **DeerController.js**: `_determineAuthority()` now uses numeric sort
- **AIController.js**: `_calculateAuthority()` (line 1359) and spawn check (line 229) now use numeric sort

**Related Issues:** ISSUE-001, ISSUE-003

---

### [ISSUE-003] Silent Kill Failures
**Severity:** CRITICAL
**Status:** RESOLVED
**Category:** State
**Files:** `public/ai/BearController.js:470-505`, `public/ai/DeerController.js:429-464`

**Description:**
Kill attempts fail silently when entity doesn't exist in controller's Map.

**Root Cause:**
```javascript
const entity = this.entities.get(chunkKey);
if (!entity || entity.isDead) return;  // SILENT FAILURE
```
If entity doesn't exist (authority mismatch, not yet spawned), kill fails with no death message, no animation.

**Impact:**
Entity appears frozen and invincible. Players shoot but nothing happens.

**Suggested Fix:**
Add logging/broadcast on kill failure. Consider forwarding kill request to authority if local entity not found.

**Resolution:**
Fixed in both BearController.js and DeerController.js:
1. `killBear()`/`killDeer()`: Now broadcasts death even if entity doesn't exist locally, so peers can apply it
2. `handleDeathMessage()`: Stores pending deaths in `pendingDeaths` Map when entity not found
3. `handleSpawnMessage()`: Checks for and applies pending deaths when entity spawns
4. Added logging for all failure cases (entity not found, already dead)

**Related Issues:** ISSUE-002

---

### [ISSUE-004] No Broadcast After Authority Takeover
**Severity:** CRITICAL
**Status:** RESOLVED
**Category:** Authority, Networking
**Files:** `public/ai/BearController.js:1854-1893`, `public/ai/DeerController.js:1401-1439`

**Description:**
When authority transfers, the new authority doesn't immediately broadcast state.

**Root Cause:**
Authority transfer sets `isAuthority = true` but doesn't trigger an immediate state broadcast.

**Impact:**
Other peers have stale positions for up to 100ms, causing visible position jumps.

**Suggested Fix:**
Call `broadcastAuthorityState()` immediately after authority transfer completes.

**Resolution:**
Fixed as part of ISSUE-001. All three controllers now call broadcast immediately after authority transfer:
- BearController: `this._broadcastState(entity)`
- DeerController: `this._broadcastState(entity)`
- AIController: `this._broadcastEntityState(entity, tentId)`

**Related Issues:** ISSUE-001

---

### [ISSUE-005] targetPosition Null on Authority-Spawned Entities
**Severity:** LOW
**Status:** WONT_FIX (Mitigated)
**Category:** State
**Files:** `public/ai/BearController.js:371`, `public/ai/DeerController.js:344`

**Description:**
Authority-spawned entities have null `targetPosition`, breaking interpolation on authority transfer.

**Root Cause:**
```javascript
const entity = {
    targetPosition: null,  // NULL for authority's own entities!
};
```
Non-authority entities have targetPosition, but authority-spawned ones don't.

**Impact:**
When authority transfers, interpolation can't start. Entity position undefined.

**Suggested Fix:**
Initialize `targetPosition` to current position for all entities, regardless of authority status.

**Analysis:**
After investigation, this is **design-as-intended** with adequate fallbacks:
- Authority entities don't use targetPosition (they run full simulation)
- ISSUE-001 fixes added fallback: if targetPosition is null, keeps current position + ensures Y on terrain
- Peer-spawned entities in Bear/Deer already initialize targetPosition (only authority-spawn is null)
- AIController bandits freeze ~100ms on peer spawn (acceptable)
- All interpolation code has `if (!entity.targetPosition) return;` guards

**Risk Assessment:**
| Risk | Severity | Mitigation |
|------|----------|------------|
| Authority transfer before broadcast | LOW | Fallback uses current position |
| Bandit freeze on peer spawn | LOW | 100ms until first broadcast |
| Design fragility | MEDIUM | Fallbacks work but implicit |

**Decision:** Not fixing - existing fallbacks are sufficient. Simple fix would be to initialize `targetPosition = { ...position }` for all spawns, but current behavior is acceptable.

**Related Issues:** ISSUE-001

---

## High Severity Issues

### [ISSUE-006] Death State Not Synced on Authority Transfer
**Severity:** HIGH
**Status:** RESOLVED
**Category:** Authority, State
**Files:** `public/ai/BearController.js:handleStateMessage`, `public/ai/DeerController.js:handleStateMessage`

**Description:**
Death state not preserved when authority transfers between peers.

**Root Cause:**
The `handleStateMessage()` method required BOTH `deathTick` AND `state === 'dead'` to sync death:
```javascript
if (deathTick && state === 'dead') {  // Fails when deathTick is 0/undefined!
```
When deathTick was falsy (0 or undefined), the condition failed even if `state === 'dead'`, causing `isDead` to not be set on the new authority.

**Impact:**
Dead entities come back alive after authority transfer.

**Resolution:**
Fixed in BearController.js and DeerController.js `handleStateMessage()`:
- Changed condition from `if (deathTick && state === 'dead')` to `if (state === 'dead')`
- Added fallback for deathTick: `deathTick || (this.getServerTick ? this.getServerTick() : 0)`
- Now death state is always synced when `state === 'dead'`, regardless of deathTick value

**Related Issues:** ISSUE-001, ISSUE-004

---

### [ISSUE-007] No State Switch Default Case
**Severity:** HIGH
**Status:** OPEN
**Category:** State
**Files:** `public/ai/BearController.js:_updateEntity`, `public/ai/DeerController.js:_updateEntity`

**Description:**
State machine switch statement lacks default case for unrecognized states.

**Root Cause:**
If state becomes invalid (empty string, undefined, typo), no case matches and entity receives no updates.

**Impact:**
Invalid state = complete entity freeze with no error indication.

**Suggested Fix:**
Add default case that logs warning and resets to 'idle' state.

**Related Issues:** None

---

### [ISSUE-008] Authority Check Before Kill in GameStateManager
**Severity:** HIGH
**Status:** OPEN
**Category:** Authority
**Files:** `public/network/GameStateManager.js:499-526`

**Description:**
Kill handler checks authority, but authority may not have the entity in their Map.

**Root Cause:**
`handlePlayerShootDeer/Bear` requires caller to be authority, but authority determination may be out of sync.

**Impact:**
Only authority can kill, but authority may not have entity - creates unkillable entities.

**Suggested Fix:**
Forward kill requests to whoever has the entity, or use coordinated kill protocol.

**Related Issues:** ISSUE-002, ISSUE-003

---

### [ISSUE-009] Race Condition in Peer Join Sync
**Severity:** HIGH
**Status:** OPEN
**Category:** Networking
**Files:** `public/network/NetworkManager.js:193-276`

**Description:**
State messages can arrive out of order during peer join synchronization.

**Root Cause:**
No message sequencing or ordering guarantees. State sync messages can arrive before entity exists.

**Impact:**
Entities spawn with wrong state, or state updates are dropped.

**Suggested Fix:**
Add message sequencing or queue state updates until entity is confirmed spawned.

**Related Issues:** ISSUE-006

---

### [ISSUE-010] Y Position Not Validated in State Messages
**Severity:** HIGH
**Status:** OPEN
**Category:** State
**Files:** `public/ai/BearController.js:handleStateMessage`, `public/ai/DeerController.js:handleStateMessage`

**Description:**
Y position from state messages not validated for NaN or invalid values.

**Root Cause:**
No validation on received Y coordinate before applying to entity.

**Impact:**
NaN or invalid Y causes entity freeze or disappearance.

**Suggested Fix:**
Validate Y is finite number within reasonable terrain bounds before applying.

**Related Issues:** None

---

### [ISSUE-011] Chunk Registry Not Updated on Peer Join
**Severity:** HIGH
**Status:** OPEN
**Category:** Networking, State
**Files:** `public/network/GameStateManager.js:325`

**Description:**
Chunk registry of nearby peers not updated when new peer joins.

**Root Cause:**
AI authority calculation uses stale peer list after new peer joins.

**Impact:**
AI authority doesn't see new peer, authority calculations wrong.

**Suggested Fix:**
Trigger chunk registry update immediately when peer joins.

**Related Issues:** ISSUE-002

---

### [ISSUE-012] First Spawn Race Condition
**Severity:** HIGH
**Status:** OPEN
**Category:** State
**Files:** `public/ai/BearController.js:checkSpawnsOnTick`, `public/ai/DeerController.js:checkSpawnsOnTick`

**Description:**
Chunk can be marked as occupied but spawn never completes.

**Root Cause:**
Race between marking chunk occupied and actually spawning entity.

**Impact:**
Chunk marked occupied, entity never spawns, chunk never respawns animals.

**Suggested Fix:**
Only mark chunk occupied after spawn succeeds. Add cleanup for failed spawns.

**Related Issues:** None

---

### [ISSUE-013] No Desync Recovery or Teleport Threshold
**Severity:** HIGH
**Status:** OPEN
**Category:** State
**Files:** `public/ai/BearController.js:_interpolateEntity:1662-1727`, `public/ai/DeerController.js:_interpolateEntity:1209-1274`

**Description:**
No threshold for snapping entity to correct position when severely desynced.

**Root Cause:**
Interpolation always smoothly moves toward target, even if target is very far away.

**Impact:**
Entities slowly drift instead of snapping to correct position. Large desyncs take too long to resolve.

**Suggested Fix:**
Add distance threshold (e.g., 10 units) - if exceeded, snap instantly instead of interpolating.

**Related Issues:** ISSUE-001

---

## Medium Severity Issues

### [ISSUE-014] targetPosition Not Cleared After Authority Snap
**Severity:** MEDIUM
**Status:** OPEN
**Category:** State
**Files:** `public/ai/BearController.js:_interpolateEntity`, `public/ai/DeerController.js:_interpolateEntity`

**Description:**
After snapping to position, stale targetPosition causes re-interpolation.

**Root Cause:**
targetPosition not cleared or updated after position snap.

**Impact:**
Entity re-interpolates back to stale position after being corrected.

**Suggested Fix:**
Clear or update targetPosition after any position snap.

**Related Issues:** ISSUE-001, ISSUE-005

---

### [ISSUE-015] Interpolation Speed Mismatch (1.5x)
**Severity:** MEDIUM
**Status:** OPEN
**Category:** State
**Files:** `public/ai/BearController.js:_interpolateEntity`, `public/ai/DeerController.js:_interpolateEntity`

**Description:**
Interpolation speed doesn't match entity movement speed.

**Root Cause:**
Interpolation uses different speed multiplier than actual entity movement.

**Impact:**
Overshooting, jittery movement, entities don't appear to move smoothly.

**Suggested Fix:**
Match interpolation speed to entity's configured movement speed.

**Related Issues:** None

---

### [ISSUE-016] Y Validation Too Loose (5 Unit Tolerance)
**Severity:** MEDIUM
**Status:** OPEN
**Category:** State
**Files:** `public/ai/BearController.js:handleStateMessage`, `public/ai/DeerController.js:handleStateMessage`

**Description:**
Y position validation allows 5 unit difference from terrain height.

**Root Cause:**
Tolerance too large - entities can appear floating or underground.

**Impact:**
Entities snap to wrong terrain height, visual glitches.

**Suggested Fix:**
Reduce tolerance to 1-2 units, or always use local terrain height.

**Related Issues:** ISSUE-010

---

### [ISSUE-017] Animation Mixer Only Updates Non-Authority
**Severity:** MEDIUM
**Status:** OPEN
**Category:** Animation
**Files:** `public/ai/BearController.js:_updateEntity`, `public/ai/DeerController.js:_updateEntity`

**Description:**
Animation mixer update may only run for non-authority entities.

**Root Cause:**
Animation update path differs between authority and non-authority.

**Impact:**
Animations freeze on authority transfer until next state change.

**Suggested Fix:**
Ensure animation mixer updates regardless of authority status.

**Related Issues:** ISSUE-001

---

### [ISSUE-018] Missing Intermediate State in Sync
**Severity:** MEDIUM
**Status:** OPEN
**Category:** Networking, State
**Files:** `public/ai/BearController.js:broadcastAuthorityState`, `public/ai/DeerController.js:broadcastAuthorityState`

**Description:**
Wander direction, flee direction, and other intermediate state not synced.

**Root Cause:**
State broadcast only includes position and main state, not behavior sub-state.

**Impact:**
After authority transfer, entity may wander in different direction or behave differently.

**Suggested Fix:**
Include wanderDirection, fleeDirection, and other behavior state in broadcasts.

**Related Issues:** ISSUE-001, ISSUE-006

---

### [ISSUE-019] No Acknowledgment of Initial Sync Messages
**Severity:** MEDIUM
**Status:** OPEN
**Category:** Networking
**Files:** `public/network/NetworkManager.js`, `public/network/P2PTransport.js`

**Description:**
Initial sync messages have no acknowledgment or retry mechanism.

**Root Cause:**
Fire-and-forget messaging for initial state sync.

**Impact:**
Lost messages not retried, entities may not sync on join.

**Suggested Fix:**
Add acknowledgment for critical sync messages, retry on timeout.

**Related Issues:** ISSUE-009

---

### [ISSUE-020] Avatar Spawns at Origin Before First Position
**Severity:** MEDIUM
**Status:** OPEN
**Category:** State
**Files:** `public/entity/AvatarManager.js`

**Description:**
New peer avatars briefly appear at world origin (0,0,0) before receiving position.

**Root Cause:**
Avatar created before position data arrives.

**Impact:**
Visual glitch - avatar pops in at origin then teleports to correct position.

**Suggested Fix:**
Hide avatar until first valid position received, or spawn at sender's reported position.

**Related Issues:** ISSUE-009

---

### [ISSUE-021] Division by Zero When Distance is Zero
**Severity:** MEDIUM
**Status:** OPEN
**Category:** State
**Files:** `public/ai/BearController.js:_updateEntity`, `public/ai/DeerController.js:_updateEntity`

**Description:**
Direction calculation divides by distance without zero check.

**Root Cause:**
```javascript
dirX = dx / distance;  // If distance = 0, dirX = Infinity or NaN
```

**Impact:**
Entity position becomes NaN, entity disappears or freezes.

**Suggested Fix:**
Check for zero distance before division, skip movement if already at target.

**Related Issues:** None

---

## Friend Respawn Issues

The following issues (ISSUE-022 through ISSUE-036) were identified during investigation of friend respawn failures where the progress bar hangs and objects/peers don't appear correctly.

---

### [ISSUE-022] completedChunks Tracking Corruption on Respawn
**Severity:** CRITICAL
**Status:** OPEN
**Category:** State
**Files:** `public/systems/DeathManager.js:705-731`, `public/ui/LoadingScreen.js:119-158`

**Description:**
When respawning, `completedChunks.clear()` wipes all chunk tracking, then attempts to restore using a flawed heuristic. When respawning near same location (e.g., near a friend), chunks stay loaded but aren't re-added to `completedChunks`.

**Root Cause:**
```javascript
// Line 705: Wipes tracking
this.game.chunkObjectGenerator.completedChunks.clear();

// Lines 725-731: Incomplete restoration
for (const chunkKey of this.game.chunkManager.loadedChunks) {
    if (this.game.chunkManager.chunkObjects.has(chunkKey)) {
        this.game.chunkObjectGenerator.completedChunks.add(chunkKey);
    }
}
```
The heuristic "has objects = generation complete" is wrong. Chunks that stayed loaded (not disposed) won't be re-queued for generation, so they're never added to `completedChunks`.

**Impact:**
LoadingScreen polls `completedChunks` expecting 441 chunks. Count never reaches target. Progress bar hangs indefinitely.

**Suggested Fix:**
Either don't clear `completedChunks` for chunks that remain loaded, or ensure all loaded chunks are properly restored to the set before showing loading screen.

**Related Issues:** ISSUE-023, ISSUE-030

---

### [ISSUE-023] receivedInitialServerState Race Condition
**Severity:** CRITICAL
**Status:** OPEN
**Category:** State, Networking
**Files:** `public/systems/DeathManager.js:712`, `public/world/ChunkManager.js:88-93`

**Description:**
`receivedInitialServerState` is reset to `false` BEFORE `joinChunkAtSpawn()` is called, causing chunks to queue instead of loading.

**Root Cause:**
```javascript
// DeathManager.js:712
this.gameState.receivedInitialServerState = false;

// ChunkManager.js:88-93 - chunks get blocked
if (!this.gameState.receivedInitialServerState) {
    this.pendingChunksAwaitingServerState.push({ chunkX, chunkZ });
    return;  // Chunks wait in limbo
}
```

**Impact:**
Chunks wait in `pendingChunksAwaitingServerState` instead of loading. If server response is delayed, chunk loading stalls completely.

**Suggested Fix:**
Only reset this flag if actually needed, or ensure chunks are properly processed after flag is set back to true.

**Related Issues:** ISSUE-022, ISSUE-029

---

### [ISSUE-024] pendingDeaths Map Never Cleared Between Respawns
**Severity:** CRITICAL
**Status:** OPEN
**Category:** State
**Files:** `public/network/GameStateManager.js:22,188`, `public/game.js:1200-1204`

**Description:**
Deaths are queued in `pendingDeaths` Map when avatar not yet created, but this Map is never cleared between respawns.

**Root Cause:**
```javascript
// GameStateManager.js:22
pendingDeaths = new Map();

// GameStateManager.js:188 - deaths queued
this.pendingDeaths.set(fromPeer, ...);

// game.js:1200-1204 - applied when avatar created
// BUT: Map never cleared on respawn!
```

**Impact:**
When respawning near a friend, the friend's old `player_death` message from 15+ seconds ago is still in the map. Friend's avatar is created and immediately marked as dead. Friend appears dead or invisible.

**Suggested Fix:**
Clear `pendingDeaths` at the start of `respawnPlayer()` or `respawnToPosition()`.

**Related Issues:** ISSUE-027

---

### [ISSUE-025] isDead Flag Reset Too Late in Respawn Sequence
**Severity:** HIGH
**Status:** OPEN
**Category:** State
**Files:** `public/systems/DeathManager.js:536-537,740`

**Description:**
`isDead = false` is only set in `respawnToPosition()`, which is called AFTER the spawn screen. During the 10-15 second spawn screen, player is still flagged as dead.

**Root Cause:**
```javascript
// Line 536-537 comment says:
// "NOTE: Death state (isDead, etc.) is NOT reset here
// Player stays 'dead' and protected until respawnToPosition()"

// Line 740 - finally set to false, but too late
this.game.isDead = false;
```

**Impact:**
During spawn screen, death animations/rotations may continue. Any systems checking `isDead` get wrong state. Position updates during spawn selection may behave incorrectly.

**Suggested Fix:**
Consider splitting death protection from the `isDead` flag, or reset `isDead` earlier with a separate protection mechanism.

**Related Issues:** ISSUE-024

---

### [ISSUE-026] No Server-Side Respawn Awareness
**Severity:** HIGH
**Status:** OPEN
**Category:** Networking, State
**Files:** `server/MessageHandlers.js:64-122`

**Description:**
Server's `handleJoinChunk` treats respawn identically to chunk border crossing. No state reset for inventory locks, mobile entity claims.

**Root Cause:**
Server receives `join_chunk` message but has no way to know if this is:
- Initial spawn
- Chunk border crossing
- Respawn after death

No explicit "respawn" message is sent to server.

**Impact:**
- Old chunk registration not explicitly cleared
- Server may have player registered in multiple chunks
- Inventory locks and mobile entity claims not reset
- Proximity updates may be incorrect

**Suggested Fix:**
Add explicit `respawn` message type that clears server-side state before processing as join_chunk.

**Related Issues:** ISSUE-028

---

### [ISSUE-027] Incomplete Peer State Reset on handlePlayerRespawn
**Severity:** HIGH
**Status:** OPEN
**Category:** State
**Files:** `public/network/GameStateManager.js:734-786`

**Description:**
`handlePlayerRespawn()` only resets `hasRifle` but leaves other peer state stale.

**Root Cause:**
```javascript
handlePlayerRespawn(payload, fromPeer, avatar) {
    // Resets:
    avatar.userData.isDead = false;
    peerData.hasRifle = false;

    // Does NOT reset:
    // - targetPosition (stale position data)
    // - lastUpdateTime
    // - harvestState (peer appears frozen chopping)
    // - onDock flag
    // - chunk registry
}
```

**Impact:**
Peers see stale animation states. Peer may appear frozen chopping. AI authority zones calculated incorrectly.

**Suggested Fix:**
Reset all relevant peer state in `handlePlayerRespawn()`, including targetPosition, harvestState, onDock, and trigger chunk registry update.

**Related Issues:** ISSUE-024, ISSUE-028

---

### [ISSUE-028] No Respawn Position Broadcast to Existing Peers
**Severity:** HIGH
**Status:** OPEN
**Category:** Networking
**Files:** `public/network/NetworkManager.js:192-276`

**Description:**
`onDataChannelOpen` sends position to newly connected peers only. Existing P2P connections stay open on respawn with no automatic re-sync.

**Root Cause:**
```javascript
// Lines 192-276: Only triggers on NEW data channel connection
this.p2pTransport.onDataChannelOpen((peerId) => {
    // Send initial position to peer
    // ...
});
// No equivalent for "respawn sync to existing peers"
```

**Impact:**
Existing peers don't receive new spawn position until next `player_pos` message. Peers may see player at death location momentarily.

**Suggested Fix:**
Broadcast position to all connected peers immediately after `respawnToPosition()` completes.

**Related Issues:** ISSUE-027

---

### [ISSUE-029] Deferred Chunk States Cleared Without Processing
**Severity:** HIGH
**Status:** OPEN
**Category:** State
**Files:** `public/systems/DeathManager.js:715-717`, `public/network/MessageRouter.js:365-378`

**Description:**
`_deferredChunkStates` is cleared on respawn but never verified as processed first.

**Root Cause:**
```javascript
// DeathManager.js:715-717
this.game.messageRouter._deferredChunkStates = [];

// MessageRouter.js:365-378 - chunks deferred until game initialized
// When respawning, these are cleared without processing!
```

**Impact:**
Chunk state messages arriving during respawn transition may be lost. Objects don't appear in new spawn location.

**Suggested Fix:**
Either process deferred states before clearing, or don't clear them during respawn.

**Related Issues:** ISSUE-022, ISSUE-023

---

### [ISSUE-030] Loading Screen Completion Check Flawed
**Severity:** HIGH
**Status:** OPEN
**Category:** UI, State
**Files:** `public/ui/LoadingScreen.js:119-158`

**Description:**
Loading screen completion requires both chunk count AND empty queue, which creates impossible conditions on near-location respawns.

**Root Cause:**
```javascript
// Line 150
if (this.chunksLoaded >= this.totalChunks && queueEmpty) {
    // Done!
}
```
Near-friend respawn: chunks already loaded → not re-queued → queue empty immediately. But `completedChunks` count is wrong (see ISSUE-022) → condition never satisfied.

**Impact:**
Progress bar reaches near 100% but never completes. 90-second safety timeout eventually fires, revealing incomplete world.

**Suggested Fix:**
Fix root cause (ISSUE-022) or add logic to detect "chunks already loaded" scenario and skip progress tracking for those chunks.

**Related Issues:** ISSUE-022

---

### [ISSUE-031] No Terrain Validation for Friend's Position
**Severity:** HIGH
**Status:** OPEN
**Category:** State
**Files:** `public/network/MessageRouter.js:2013-2080`

**Description:**
`handlePositionRequest()` validates friend's status (spawned, alive, not on mobile, etc.) but never validates if friend's position is on valid land.

**Root Cause:**
```javascript
handlePositionRequest(payload) {
    // Checks: not spawned, is dead, on mobile, climbing, on dock
    // Does NOT check terrain height!

    this.networkManager.sendMessage('position_response', {
        x: this.game.playerObject.position.x,
        z: this.game.playerObject.position.z
    });
}
```

**Impact:**
If friend is in water or low terrain (height < 7.5), position is sent without validation. Spawner tries to place player at invalid coordinates, all 50 attempts fail.

**Suggested Fix:**
Add terrain height check to `handlePositionRequest()`. Reject if friend is in water or on invalid terrain.

**Related Issues:** ISSUE-032, ISSUE-033

---

### [ISSUE-032] Friend Spawn Radius Too Small
**Severity:** MEDIUM
**Status:** OPEN
**Category:** State
**Files:** `public/spawn/SpawnSystem.js:150-186`

**Description:**
Friend spawn only searches within 10-unit radius with 50 random attempts. No terrain search algorithm like random spawn uses.

**Root Cause:**
```javascript
getSpawnNearFriend(friendX, friendZ) {
    const distance = Math.random() * FRIEND_SPAWN_RADIUS;  // MAX 10 units
    // ...
}

findValidSpawnNearFriend(friendX, friendZ, ..., maxAttempts = 50) {
    // Only 50 random attempts, no directed search
}
```

**Impact:**
If friend is near water/cliffs, all spawn attempts fail. Fallback uses friend's exact position which may also be invalid.

**Suggested Fix:**
Increase radius, add directed terrain search (like random spawn's "westward march"), or expand search area on failures.

**Related Issues:** ISSUE-031

---

### [ISSUE-033] Missing Error Messages for Invalid Terrain Spawn
**Severity:** LOW
**Status:** OPEN
**Category:** UI
**Files:** `public/ui/SpawnScreen.js:323-387`

**Description:**
Error messages exist for many spawn failures but not for terrain-related failures.

**Root Cause:**
```javascript
const errorMessages = {
    'not_spawned': `${friendUsername} hasn't spawned yet`,
    'timeout': `Could not reach ${friendUsername}`,
    'unavailable': `${friendUsername} is not available`,
    'dead': `${friendUsername} is dead`,
    // No error for: "friend is in water" or "invalid terrain"
};
```

**Impact:**
User gets confusing "unavailable" message when spawn fails due to terrain. No indication of actual problem.

**Suggested Fix:**
Add error messages for terrain-related spawn failures: "in water", "on steep terrain", "no valid ground nearby".

**Related Issues:** ISSUE-031, ISSUE-032

---

### [ISSUE-034] Object Deduplication Missing on Same-Area Respawn
**Severity:** MEDIUM
**Status:** OPEN
**Category:** State
**Files:** `public/network/MessageRouter.js:620-790`

**Description:**
When respawning in same area, chunks stay loaded with objects. Server sends `chunk_objects_state` but deduplication is incomplete.

**Root Cause:**
```javascript
const existingObject = this.findObjectById(objectId);
const objectIsValid = existingObject && existingObject.parent;

if (objectIsValid) {
    return;  // Skip - but what if object state changed?
}

// Creates new object even if similar object exists
```

**Impact:**
Double objects can appear in scene. Duplicate physics colliders created. Visual glitches.

**Suggested Fix:**
Improve object deduplication to handle respawn scenarios. Check by position/type, not just ID.

**Related Issues:** ISSUE-022

---

### [ISSUE-035] Chunk vs Proximity Update Race Condition
**Severity:** MEDIUM
**Status:** OPEN
**Category:** Networking, State
**Files:** `public/systems/DeathManager.js:768`, `public/network/MessageRouter.js:854-873`

**Description:**
After respawn, `chunk_objects_state` and `proximity_update` messages can arrive in unpredictable order, causing coordination issues.

**Root Cause:**
```
T=0:  respawnToPosition() called
T=1:  joinChunkAtSpawn() sends 'join_chunk'
T=2:  receivedInitialServerState = false (chunks blocked)
T=50: chunk_objects_state arrives → sets flag true
T=51: proximity_update arrives → tries to create avatars
      But: completedChunks tracking is broken!
```

**Impact:**
Avatars may be created before chunks are ready. Peer positions may not align with terrain. Visual glitches.

**Suggested Fix:**
Ensure chunk loading completes before processing proximity updates, or queue proximity updates until chunks ready.

**Related Issues:** ISSUE-023, ISSUE-024

---

### [ISSUE-036] Stale targetPosition in Avatar Rendering After Respawn
**Severity:** MEDIUM
**Status:** OPEN
**Category:** State
**Files:** `public/entity/AvatarManager.js:243-668`

**Description:**
Avatar movement uses cached `targetPosition`. After respawn, this may still point to old position.

**Root Cause:**
```javascript
const target = peer?.targetPosition;
// If respawn happened, target still points to pre-respawn position
if (target && !isPilotingVehicle) {
    // Avatar lerps toward stale position
}
```

**Impact:**
Friend's avatar may snap to old location or lerp toward stale target. Peer appears in wrong position momentarily.

**Suggested Fix:**
Clear or update `targetPosition` for all peers when local player respawns, or when receiving respawn notification from peer.

**Related Issues:** ISSUE-014, ISSUE-027

---

## Friend Respawn Root Cause Chain

When respawning near a friend, the following chain of failures occurs:

```
1. Player dies near friend
   |
   v
2. Spawn screen shows, player still isDead=true (ISSUE-025)
   |
   v
3. Player selects "Spawn Near Friend"
   |
   v
4. Friend's position requested (ISSUE-031 - no terrain validation)
   |
   v
5. respawnToPosition() called:
   |-- a. completedChunks.clear() (ISSUE-022)
   |-- b. receivedInitialServerState = false (ISSUE-023)
   |-- c. _deferredChunkStates.clear() (ISSUE-029)
   |
   v
6. Chunks near friend already loaded, not re-queued
   |
   v
7. completedChunks restoration incomplete (ISSUE-022)
   |
   v
8. LoadingScreen polls completedChunks:
   |-- Count: 25/441 (only newly generated chunks)
   |-- Queue empty (chunks already loaded)
   |-- Condition never satisfied (ISSUE-030)
   |
   v
9. Progress bar HANGS
   |
   v
10. Meanwhile, proximity_update arrives:
    |-- pendingDeaths has stale friend death (ISSUE-024)
    |-- Friend avatar created → marked dead
    |
    v
11. Friend appears dead or invisible
    |
    v
12. 90-second safety timeout fires, hides loading screen
    |
    v
13. Player sees incomplete world with missing peers/objects
```

---

## Root Cause Chain Analysis

When a new peer spawns in, the following chain of failures can occur:

```
1. New peer joins with lower clientId
   |
   v
2. Authority recalculation uses string sort (ISSUE-002)
   |
   v
3. Multiple clients think they're authority OR no client is authority
   |
   v
4. If authority transfers:
   |-- a. New authority has null targetPosition (ISSUE-005)
   |-- b. Position snaps to stale targetPosition (ISSUE-001)
   |-- c. No immediate broadcast (ISSUE-004)
   |
   v
5. Other clients see entity at wrong position
   |
   v
6. Entity state machine runs with invalid position
   |
   v
7. State becomes 'idle' or unrecognized -> no updates (ISSUE-007)
   |
   v
8. Player shoots frozen entity
   |
   v
9. Kill called but entity not in Map or authority check fails (ISSUE-003)
   |
   v
10. Kill returns silently, no death broadcast
    |
    v
11. Entity appears frozen and invincible
```

---

## Key Code Paths Reference

### Authority Determination
- `public/ai/BearController.js:_determineAuthority()` - lines 685-700
- `public/ai/DeerController.js:_determineAuthority()` - lines 644-659

### Authority Transfer
- `public/ai/BearController.js:onPeerChunkChanged()` - lines 1854-1893
- `public/ai/DeerController.js:onPeerChunkChanged()` - lines 1401-1439

### Kill Handling
- `public/ai/BearController.js:killBear()` - lines 470-505
- `public/ai/DeerController.js:killDeer()` - lines 429-464
- `public/network/GameStateManager.js:handlePlayerShootBear/Deer()` - lines 499-526

### Interpolation
- `public/ai/BearController.js:_interpolateEntity()` - lines 1662-1727
- `public/ai/DeerController.js:_interpolateEntity()` - lines 1209-1274

### State Machine
- `public/ai/BearController.js:_updateEntity()` - lines 1220-1437
- `public/ai/DeerController.js:_updateEntity()` - lines 1047-1148

---

## Horse/Mobile Entity Interaction Issues

The following issues (ISSUE-037 through ISSUE-044) were identified during investigation of horses becoming unmountable after a peer dies while riding.

---

### [ISSUE-037] Horse Occupancy NOT Cleared on Peer Death
**Severity:** CRITICAL
**Status:** OPEN
**Category:** State
**Files:** `public/network/GameStateManager.js:661-728`

**Description:**
When a peer dies while mounted on a horse, `mobileEntitySystem.clearOccupied(entityId)` is never called. The horse remains permanently marked as "occupied" by the dead peer.

**Root Cause:**
```javascript
handlePlayerDeath(fromPeer, avatar) {
    const peerData = this.peerGameData.get(fromPeer);

    if (peerData && peerData.mobileEntity) {
        // Stops animations...
        // Moves avatar to ground position...
        // BUT: No call to this.game.mobileEntitySystem.clearOccupied(entityId)!
    }
}
```

**Impact:**
Horse appears available in the world but cannot be mounted. `MobileEntitySystem.isOccupied(horseId)` returns `true`, blocking all interaction buttons. Horse is permanently locked until page refresh.

**Suggested Fix:**
Add occupancy clearing in `handlePlayerDeath()`:
```javascript
if (peerData.mobileEntity?.entityId && this.game?.mobileEntitySystem) {
    this.game.mobileEntitySystem.clearOccupied(peerData.mobileEntity.entityId);
}
peerData.mobileEntity = null;
peerData.isPiloting = false;
```

**Related Issues:** ISSUE-038, ISSUE-039, ISSUE-040

---

### [ISSUE-038] Horse Occupancy NOT Cleared on Peer Disconnect
**Severity:** CRITICAL
**Status:** OPEN
**Category:** State, Networking
**Files:** `public/network/NetworkManager.js:363-420`

**Description:**
When a peer disconnects while mounted on a horse, the horse mesh is removed but `mobileEntitySystem.clearOccupied()` is never called.

**Root Cause:**
```javascript
cleanupPeer(peerId) {
    const peerData = this.peerGameData.get(peerId);

    if (peerData?.mobileEntity?.mesh) {
        // Removes mesh from scene ✓
        // Disposes geometry/materials ✓
        // BUT: No mobileEntitySystem.clearOccupied(entityId)!
    }

    this.peerGameData.delete(peerId);  // Data deleted, reference lost
}
```

**Impact:**
Horse's entityId remains in `occupiedEntities` Map permanently, claimed by a non-existent peer. Horse is unmountable until page refresh.

**Suggested Fix:**
Add before mesh cleanup:
```javascript
if (peerData?.mobileEntity?.entityId && this.game?.mobileEntitySystem) {
    this.game.mobileEntitySystem.clearOccupied(peerData.mobileEntity.entityId);
}
```

**Related Issues:** ISSUE-037, ISSUE-043, ISSUE-044

---

### [ISSUE-039] Mount State NOT Cleared on Peer Respawn
**Severity:** HIGH
**Status:** OPEN
**Category:** State
**Files:** `public/network/GameStateManager.js:734-786`

**Description:**
When a peer respawns after dying on a horse, the respawn handler does not clear `peerData.isPiloting` or `peerData.mobileEntity`.

**Root Cause:**
```javascript
handlePlayerRespawn(payload, fromPeer, avatar) {
    // Resets:
    avatar.userData.isDead = false;
    peerData.hasRifle = false;

    // Does NOT reset:
    // - peerData.isPiloting (stays true!)
    // - peerData.mobileEntity (stale object reference)
    // - peerData.towedCart
    // - peerData.loadedCrate
}
```

**Impact:**
- Avatar may snap back to old horse position due to stale `isPiloting=true`
- `AvatarManager.updateAvatarMovement()` may skip position updates incorrectly
- Stale state causes inconsistent behavior

**Suggested Fix:**
Add state clearing in `handlePlayerRespawn()`:
```javascript
peerData.isPiloting = false;
peerData.mobileEntity = null;
peerData.towedCart = null;
peerData.loadedCrate = null;
```

**Related Issues:** ISSUE-037, ISSUE-027

---

### [ISSUE-040] Race Condition: Death Message vs Exit Message
**Severity:** HIGH
**Status:** OPEN
**Category:** Networking, State
**Files:** `public/systems/DeathManager.js:84-108`, `public/network/GameStateManager.js:661-728,1034-1136`

**Description:**
When a peer dies on a horse, two P2P messages are sent: `mobile_entity_exit` and `player_death`. The order of arrival is not guaranteed, causing state inconsistencies.

**Root Cause:**
```javascript
// DeathManager.js - sends exit BEFORE death
this.networkManager.broadcastP2P({ type: 'mobile_entity_exit', ... });  // Line 99
// ... later ...
this.networkManager.broadcastP2P({ type: 'player_death', ... });  // Line 453

// But P2P is unordered! Other client may receive:
// 1. player_death → calls handlePlayerDeath() → death animation starts
// 2. mobile_entity_exit → arrives late, calls handleMobileEntityExit()
// OR exit message is dropped/delayed
```

**Impact:**
- If `player_death` arrives first: death animation starts but horse still marked occupied
- If `mobile_entity_exit` is dropped: horse permanently locked
- Window of time where horse is unmountable even if messages arrive correctly

**Suggested Fix:**
Handle mobile entity cleanup directly in `handlePlayerDeath()` instead of relying on a separate message. Or add message sequencing/acknowledgment.

**Related Issues:** ISSUE-037

---

### [ISSUE-041] Exception During Death Cleanup Skips Occupancy Clear
**Severity:** HIGH
**Status:** OPEN
**Category:** State
**Files:** `public/systems/DeathManager.js:40-79`

**Description:**
In `killEntity()`, animation/sound/physics cleanup runs before `clearOccupied()`. Any exception in cleanup code skips the critical occupancy clearing.

**Root Cause:**
```javascript
// Lines 40-68: Cleanup that can throw exceptions
mobileState.entityWalkAction.stop();       // Could be null
mobileState.entityMixer.stopAllAction();   // Could be null
mobileState.horseSound.stop();             // Could be null
// Physics cleanup...

// Line 79: Only runs if above succeeds!
this.game.mobileEntitySystem.clearOccupied(entityId);
```
No try/catch protection around cleanup code.

**Impact:**
If any cleanup step throws (e.g., null reference), `clearOccupied()` is never called. Horse becomes permanently locked for the local player.

**Suggested Fix:**
Wrap cleanup in try/catch or move `clearOccupied()` to run FIRST:
```javascript
// Clear occupancy FIRST, before any cleanup that might throw
if (this.game.mobileEntitySystem) {
    this.game.mobileEntitySystem.clearOccupied(entityId);
}
try {
    // Then do cleanup...
} catch (e) {
    console.error('Mobile entity cleanup error:', e);
}
```

**Related Issues:** ISSUE-037

---

### [ISSUE-042] Occupancy Set Before Server Claim Confirmed
**Severity:** HIGH
**Status:** OPEN
**Category:** State, Networking
**Files:** `public/game.js:3100-3133`

**Description:**
When mounting a horse, local occupancy is marked immediately, but server claim is sent afterward. If server claim fails, occupancy stays set locally but server doesn't recognize the claim.

**Root Cause:**
```javascript
// Line 3100: Occupancy set IMMEDIATELY
this.mobileEntitySystem.setOccupied(entityId, clientId);

// Line 3114: State marked active
state.isActive = true;

// Lines 3128-3133: Server claim sent LATER
this.networkManager.sendMessage('claim_mobile_entity', { ... });
```

**Impact:**
- Client thinks horse is occupied, server thinks it's free
- Another player may mount on server side
- Client-server desync on occupancy state
- Subsequent mount attempts fail locally but succeed on server

**Suggested Fix:**
Move `setOccupied()` after server claim confirmation, or add rollback on failure.

**Related Issues:** ISSUE-037

---

### [ISSUE-043] Cart/Crate Occupancy NOT Cleared on Peer Disconnect
**Severity:** MEDIUM
**Status:** OPEN
**Category:** State
**Files:** `public/network/NetworkManager.js:363-420`

**Description:**
When a peer disconnects while towing a cart or carrying a crate, their cart/crate occupancy is not cleared in `MobileEntitySystem`.

**Root Cause:**
```javascript
cleanupPeer(peerId) {
    // Mobile entity mesh cleanup ✓
    // BUT: No cleanup for:
    // - peerData.towedCart
    // - peerData.loadedCrate
    // - Associated occupancy in MobileEntitySystem

    this.peerGameData.delete(peerId);
}
```
The `handleCartAttachmentEnd` and `handleCrateUnload` handlers that normally clear occupancy are never called on disconnect.

**Impact:**
Carts and crates remain marked as occupied by disconnected peer. Cannot be used until page refresh.

**Suggested Fix:**
Add cart/crate occupancy clearing in `cleanupPeer()`:
```javascript
if (peerData?.towedCart?.cartId) {
    this.game.mobileEntitySystem.clearOccupied(peerData.towedCart.cartId);
}
if (peerData?.loadedCrate?.crateId) {
    this.game.mobileEntitySystem.clearOccupied(peerData.loadedCrate.crateId);
}
```

**Related Issues:** ISSUE-038, ISSUE-044

---

### [ISSUE-044] No Safety Net for Horse State in respawnPlayer()
**Severity:** MEDIUM
**Status:** OPEN
**Category:** State
**Files:** `public/systems/DeathManager.js:470-534`

**Description:**
`respawnPlayer()` has safety net cleanup for cart and crate state, but no equivalent safety net for horse/mobile entity state.

**Root Cause:**
```javascript
respawnPlayer() {
    // Cart safety net (lines 504-521)
    const cartState = this.gameState.cartAttachmentState;
    if (cartState && cartState.isAttached) {
        console.warn('[Respawn] Cart state still attached - forcing cleanup');
        this.game.mobileEntitySystem.clearOccupied(cartState.cartId);
        // ... clear state
    }

    // Crate safety net (lines 523-534)
    const crateState = this.gameState.crateLoadState;
    if (crateState && crateState.isLoaded) {
        // ... clear crate occupancy
    }

    // NO equivalent for mobileEntityState (horse/boat)!
}
```

**Impact:**
If horse mount state persists through death (due to exception or race condition), it won't be cleaned up on respawn. Horse remains locked.

**Suggested Fix:**
Add horse safety net:
```javascript
const mobileState = this.gameState.mobileEntityState;
if (mobileState && mobileState.isActive && mobileState.entityId) {
    console.warn('[Respawn] Mobile entity state still active - forcing cleanup');
    if (this.game.mobileEntitySystem) {
        this.game.mobileEntitySystem.clearOccupied(mobileState.entityId);
    }
    mobileState.isActive = false;
    mobileState.entityId = null;
    // ... clear remaining state
}
```

**Related Issues:** ISSUE-041

---

## Horse Interaction Root Cause Chain

When a peer dies on a horse and you can no longer interact with it:

```
1. Peer mounts horse
   |-- MobileEntitySystem.setOccupied(horseId, peerId)
   |-- peerData.mobileEntity = { entityId: horseId, ... }
   |-- peerData.isPiloting = true
   |
   v
2. Peer dies while mounted
   |
   v
3. Peer's client sends two P2P messages:
   |-- 'mobile_entity_exit' (should clear occupancy)
   |-- 'player_death' (triggers death animation)
   |
   v
4. Messages arrive at your client (order not guaranteed!)
   |
   v
5. SCENARIO A: 'player_death' arrives first (ISSUE-040)
   |-- handlePlayerDeath() called
   |-- Stops horse animations
   |-- Moves avatar to ground
   |-- BUT: No clearOccupied() call! (ISSUE-037)
   |-- Death animation starts
   |
   v
6. SCENARIO B: 'mobile_entity_exit' arrives late or dropped
   |-- If late: handleMobileEntityExit() clears occupancy (works)
   |-- If dropped: occupancy never cleared (broken)
   |
   v
7. You try to mount the horse
   |
   v
8. MobileEntitySystem.checkNearestStructure() called
   |-- isOccupied(horseId) returns TRUE (stale entry)
   |-- Returns null → no mount button shown
   |
   v
9. Horse appears available but is unmountable

ALTERNATE PATH: Peer disconnects (ISSUE-038)
   |
   v
10. cleanupPeer() called
    |-- Removes mesh from scene ✓
    |-- Deletes peerGameData ✓
    |-- BUT: No clearOccupied() call!
    |
    v
11. Horse permanently locked (same as step 8-9)
```

---

## Key Code Paths Reference (Horse Issues)

### Occupancy Tracking
- `public/systems/MobileEntitySystem.js:63-156` - occupiedEntities Map, setOccupied(), clearOccupied(), isOccupied()

### Mount/Dismount
- `public/game.js:3081-3183` - startBoarding(), completeBoarding()
- `public/game.js:3272-3375` - completeDisembark()

### Death Cleanup
- `public/systems/DeathManager.js:32-143` - killEntity() mobile entity handling
- `public/systems/DeathManager.js:470-534` - respawnPlayer() safety nets

### Peer State Handling
- `public/network/GameStateManager.js:661-728` - handlePlayerDeath()
- `public/network/GameStateManager.js:734-786` - handlePlayerRespawn()
- `public/network/GameStateManager.js:889-977` - handleMobileEntityEnter()
- `public/network/GameStateManager.js:1034-1136` - handleMobileEntityExit()

### Peer Cleanup
- `public/network/NetworkManager.js:363-420` - cleanupPeer()

---

## Distance/Coordinate Issues

The following issues (ISSUE-045 through ISSUE-065) were identified during investigation of object interactions failing when players travel far from spawn location.

---

### [ISSUE-045] Physics Radius vs Visual Load Radius Mismatch
**Severity:** CRITICAL
**Status:** OPEN
**Category:** Performance, State
**Files:** `public/network/SceneObjectFactory.js:717-734`, `public/systems/InteractionManager.js:97`, `public/config.js:386-398`

**Description:**
Objects are visible within LOAD_RADIUS (10 chunks = 500 units) but only have physics colliders within PHYSICS_RADIUS (1 chunk = 75 units). Objects beyond ~75 units from player are visible but have no physics colliders created.

**Root Cause:**
```javascript
// SceneObjectFactory.js:732-733
withinPhysicsRadius = chunkDistX <= CONFIG.CHUNKS.PHYSICS_RADIUS &&
                      chunkDistZ <= CONFIG.CHUNKS.PHYSICS_RADIUS;

if (withinPhysicsRadius) {
    // Create collider - ONLY within 1 chunk radius!
}
```
InteractionManager.checkProximityToObjects() queries physics via querySphere() - returns nothing for objects outside physics radius.

**Impact:**
Players can see objects but cannot interact with them. Clicking on trees/rocks beyond ~75 units does nothing. No visual feedback that objects are non-interactive.

**Suggested Fix:**
Either increase PHYSICS_RADIUS to 2-3 chunks, or dynamically create colliders when player approaches objects, or add visual indicator for non-interactive objects.

**Related Issues:** ISSUE-046, ISSUE-049

---

### [ISSUE-046] Floating-Point Precision Loss in Rapier Physics
**Severity:** CRITICAL
**Status:** OPEN
**Category:** State
**Files:** `public/core/PhysicsManager.js:153-159`, `public/core/PhysicsManager.js:458-476`

**Description:**
Rapier physics uses 32-bit floats internally. At world coordinates >100,000 units, precision degrades to ~1 unit, causing spatial queries to miss nearby colliders.

**Root Cause:**
```javascript
// PhysicsManager.js:153-159 - coordinates converted to 32-bit
const translation = new RAPIER.Vector3(position.x, colliderY, position.z);
colliderDesc.setTranslation(translation.x, translation.y, translation.z);

// PhysicsManager.js:463 - query also uses 32-bit
const translation = new RAPIER.Vector3(center.x, center.y, center.z);
```
JavaScript Numbers are 64-bit, but Rapier WASM uses 32-bit floats. At coordinates like 500,000, precision loss causes colliders and queries to be offset by multiple units.

**Impact:**
Physics queries return incorrect results at large distances. Colliders appear to be in wrong positions. Interactions fail silently.

**Suggested Fix:**
Implement origin-shifting (recenter world around player periodically) or use relative coordinates for physics calculations.

**Related Issues:** ISSUE-045, ISSUE-055

---

### [ISSUE-047] Integer Overflow in Chunk Seeding
**Severity:** CRITICAL
**Status:** OPEN
**Category:** State
**Files:** `public/objects.js:757`, `public/core/QualityGenerator.js:49`, `public/ai/DeerController.js:144`, `public/ai/BearController.js:171`

**Description:**
Chunk seeding calculations overflow 32-bit integer range at large coordinates, causing different distant chunks to produce identical seeds and object ID collisions.

**Root Cause:**
```javascript
// QualityGenerator.js:49
const chunkSeed = worldSeed + chunkX * 73856093 + chunkZ * 19349663;

// At chunkX = 50000:
// 50000 * 73856093 = 3,692,804,650,000 (exceeds 32-bit!)
```
JavaScript bitwise operations use 32-bit integers, causing silent wraparound. Two chunks at different large coordinates can hash to identical values.

**Impact:**
Object IDs collide at distant chunks. Objects may not spawn correctly. Quality generation becomes non-deterministic. AI spawning breaks.

**Suggested Fix:**
Use `Math.imul()` for 32-bit multiplication that handles overflow properly, or use BigInt for seed calculations, or limit world size.

**Related Issues:** ISSUE-053

---

### [ISSUE-048] Object Registry 300-Frame Refresh Delay
**Severity:** CRITICAL
**Status:** OPEN
**Category:** State
**Files:** `public/systems/InteractionManager.js:76-91`

**Description:**
The object registry only refreshes every 300 frames (~5 seconds). Objects added between refreshes exist in chunkObjects but not in objectRegistry, causing physics queries to find colliders but object lookup to fail.

**Root Cause:**
```javascript
// InteractionManager.js:76-77 - only populated when empty
if (this.objectRegistry.size === 0 && this.chunkManager.chunkObjects.size > 0) {
    this.populateObjectRegistry();
}

// InteractionManager.js:83 - only refreshes every 300 frames
this.registryRefreshCounter++;
if (this.registryRefreshCounter >= 300) {
    this.registryRefreshCounter = 0;
    // ... refresh
}
```

**Impact:**
Newly loaded objects are invisible to interactions for up to 5 seconds. Physics queries succeed but `objectRegistry.get(objectId)` returns undefined. Console shows "Object not found in registry" warnings.

**Suggested Fix:**
Add objects to registry immediately when created in SceneObjectFactory, or use event-driven registry updates instead of polling.

**Related Issues:** ISSUE-045, ISSUE-050

---

### [ISSUE-049] Chunk ID Parsing Without Validation
**Severity:** HIGH
**Status:** OPEN
**Category:** State, Networking
**Files:** `server/Broadcaster.js:40`, `server/ChunkStore.js:199,229,454`, `server/MessageHandlers.js:1406,2951`, `public/core/ChunkCoordinates.js:72`

**Description:**
Chunk IDs are parsed using simple string splitting without validation for NaN, Infinity, or bounds. Large coordinates can produce invalid chunk IDs that break broadcasts.

**Root Cause:**
```javascript
// Used everywhere:
const [chunkX, chunkZ] = chunkId.replace('chunk_', '').split(',').map(Number);
// No validation! If malformed: NaN propagates silently
```
No checking for `Number.isFinite()`, no bounds checking against `Number.MAX_SAFE_INTEGER`.

**Impact:**
Invalid chunk IDs like `chunk_NaN,NaN` break chunk loading and broadcasting. Objects in affected chunks become inaccessible. Silent failures throughout the system.

**Suggested Fix:**
Add validation after parsing:
```javascript
if (!Number.isFinite(chunkX) || !Number.isFinite(chunkZ)) {
    console.error('Invalid chunk ID:', chunkId);
    return null;
}
```

**Related Issues:** ISSUE-056

---

### [ISSUE-050] 3x3 Broadcast Radius Hardcoded vs 5x5 Config
**Severity:** HIGH
**Status:** OPEN
**Category:** Networking
**Files:** `server/Broadcaster.js:39-60`, `server/ServerConfig.js:47`

**Description:**
`broadcastTo3x3Grid()` uses hardcoded `radius = 1` but server config has `LOAD_RADIUS: 2`. Only 9 neighbors receive broadcasts when 25 should.

**Root Cause:**
```javascript
// Broadcaster.js:43
const radius = 1;  // HARD-CODED! Should use CONFIG.CHUNKS.LOAD_RADIUS

// ServerConfig.js:47
LOAD_RADIUS: 2  // Server loads 5x5 but only broadcasts to 3x3
```

**Impact:**
Objects 2+ chunks away don't receive server updates. Harvesting, building, and structure changes are invisible to players outside immediate 3x3 area. Creates "ghost" objects that exist on some clients but not others.

**Suggested Fix:**
Replace hardcoded radius with `CONFIG.CHUNKS.LOAD_RADIUS` or create separate broadcast config.

**Related Issues:** ISSUE-045

---

### [ISSUE-051] Removed Objects Cache Never Cleared Per-Chunk
**Severity:** HIGH
**Status:** OPEN
**Category:** State
**Files:** `public/core/GameState.js:56`, `public/world/ChunkManager.js:291-363`

**Description:**
`removedObjectsCache` persists across chunk unload/reload cycles. Harvested objects in revisited distant chunks never respawn.

**Root Cause:**
```javascript
// GameState.js:56
this.removedObjectsCache = new Map(); // Never cleared per-chunk

// ChunkManager.js:291-363 - disposeChunk()
disposeChunk(key) {
    this.loadedChunks.delete(key);
    // ... disposal code ...
    // NOTE: removedObjectsCache NOT cleared for this chunk!
}
```

**Impact:**
Trees/rocks harvested before traveling away permanently disappear from those chunks. World becomes increasingly barren as player explores. Resources don't respawn on return.

**Suggested Fix:**
Clear removedObjectsCache entries for a chunk when it's disposed, or add expiration time to cache entries.

**Related Issues:** None

---

### [ISSUE-052] Terrain Height Precision Loss at Large Coordinates
**Severity:** HIGH
**Status:** OPEN
**Category:** State
**Files:** `public/terrainsystem.js:1225-1263`, `public/objects.js:779`

**Description:**
Terrain height calculations lose precision at large world coordinates due to floating-point multiplication with small frequency values.

**Root Cause:**
```javascript
// terrainsystem.js:1227
const raw = this.terrain(worldX * freq, worldZ * freq);
// freq = 0.008, worldX = 2,000,000 → 16000.0 (loses sub-unit precision)
```
At coordinates >1,000,000, Perlin noise inputs lose fractional precision. Two objects separated by 0.1 units return identical height values.

**Impact:**
Objects placed at wrong Y heights. Height range checks pass incorrectly. Physical colliders misaligned with visuals. Structures float or sink into terrain.

**Suggested Fix:**
Use modular arithmetic to keep noise inputs in a smaller range while maintaining continuity, or implement origin-shifting.

**Related Issues:** ISSUE-055, ISSUE-058

---

### [ISSUE-053] Grid Snapping Precision Loss
**Severity:** HIGH
**Status:** OPEN
**Category:** State
**Files:** `public/world/StructureManager.js:218-220`

**Description:**
Structure placement grid snapping uses division by 0.25 which amplifies precision errors at large coordinates.

**Root Cause:**
```javascript
// StructureManager.js:218-220
placement.position.x = Math.round(mouseX / 0.25) * 0.25;
placement.position.z = Math.round(mouseZ / 0.25) * 0.25;

// At mouseX = 1,000,000:
// 1,000,000 / 0.25 = 4,000,000 (high-magnitude float)
// Precision loss in rounding, then multiplication doesn't recover it
```

**Impact:**
Structure placement drifts from intended position. Grid snapping becomes unreliable. Structures may not align properly.

**Suggested Fix:**
Use integer grid coordinates internally: `Math.round(mouseX * 4) / 4` instead of dividing by 0.25.

**Related Issues:** ISSUE-052

---

### [ISSUE-054] World Bounds vs Chunk Bounds Mismatch
**Severity:** MEDIUM
**Status:** OPEN
**Category:** State
**Files:** `public/config.js:126-131`, `public/config.js:394-397`

**Description:**
WORLD_BOUNDS extends to ±50,000 units but actual chunk grid only covers ±15 chunks = ±750 units. No validation prevents operations beyond chunk bounds.

**Root Cause:**
```javascript
// config.js:127-130
WORLD_BOUNDS: {
    minX: -50000, maxX: 50000,
    minZ: -50000, maxZ: 50000
}

// config.js:394-397
CHUNKS: {
    MIN_CHUNK_X: -15, MAX_CHUNK_X: 15,
    MIN_CHUNK_Z: -15, MAX_CHUNK_Z: 15
}
// 15 * 50 = 750 units max, NOT 50000!
```

**Impact:**
Players can theoretically move beyond chunk system bounds. Objects placed beyond ±750 units may not load properly. Configuration is misleading.

**Suggested Fix:**
Either align WORLD_BOUNDS with actual chunk limits, or extend chunk system to match WORLD_BOUNDS, or add validation.

**Related Issues:** ISSUE-056

---

### [ISSUE-055] isWithinWorldBounds() Never Called
**Severity:** MEDIUM
**Status:** OPEN
**Category:** State
**Files:** `public/core/ChunkCoordinates.js:157-165`, `server/ServerChunkCoords.js:157-165`

**Description:**
`isWithinWorldBounds()` function exists but is never called anywhere in production code. Boundary violations go undetected.

**Root Cause:**
```javascript
// ChunkCoordinates.js:157-165 - exists but unused!
static isWithinWorldBounds(chunkX, chunkZ) {
    const minX = CONFIG.CHUNKS.MIN_CHUNK_X;
    const maxX = CONFIG.CHUNKS.MAX_CHUNK_X;
    // ...
    return chunkX >= minX && chunkX <= maxX &&
           chunkZ >= minZ && chunkZ <= maxZ;
}
// Grep shows: NEVER CALLED in production code
```

**Impact:**
Operations proceed even if chunks are out of bounds. No warnings when players move beyond world limits. Potential crashes or undefined behavior.

**Suggested Fix:**
Call `isWithinWorldBounds()` before chunk operations, especially in `worldToChunk()` and chunk loading.

**Related Issues:** ISSUE-054

---

### [ISSUE-056] Race Condition: Chunk Loading vs Object Registration
**Severity:** MEDIUM
**Status:** OPEN
**Category:** State
**Files:** `public/world/ChunkManager.js:216-235`, `public/network/SceneObjectFactory.js:794-796`, `public/network/MessageRouter.js:1563-1567`

**Description:**
Chunk loading and object registration are separate non-atomic operations. Server messages arriving mid-creation can be lost or use stale references.

**Root Cause:**
```javascript
// ChunkManager.js:233-235 - initializes empty array
if (!this.chunkObjects.has(chunkKey)) {
    this.chunkObjects.set(chunkKey, []);
}

// SceneObjectFactory.js:794-796 - adds objects LATER
const chunkObjects = this.game.chunkManager.chunkObjects.get(chunkKey) || [];
chunkObjects.push(objectInstance);
this.game.chunkManager.chunkObjects.set(chunkKey, chunkObjects);
```
If server sends objects BEFORE client finishes createChunk(), objects get added to stale array reference.

**Impact:**
Objects may appear in wrong chunks or disappear entirely. Chunk state becomes inconsistent between clients.

**Suggested Fix:**
Use atomic chunk creation that includes initial objects, or add message queuing until chunk is fully initialized.

**Related Issues:** ISSUE-048

---

### [ISSUE-057] Catastrophic Cancellation in Shader Coordinates
**Severity:** MEDIUM
**Status:** OPEN
**Category:** Performance
**Files:** `public/terrainsystem.js:2071-2072`, `public/terrainsystem.js:687-689`

**Description:**
Shader uniforms computed by subtracting two large similar world coordinates suffer catastrophic cancellation, losing precision in the difference.

**Root Cause:**
```javascript
// terrainsystem.js:2071-2072
const offsetX = realViewerX - snappedCenterX;
const offsetY = realViewerY - snappedCenterY;
// At large coords: 500000.123 - 500000.000 = imprecise result
```
When both numbers are large and similar, the difference loses significant digits. This imprecise offset is sent to GPU.

**Impact:**
GPU morph transitions and LOD blending have visible artifacts at large world coordinates. Terrain seams appear. Visual popping during movement.

**Suggested Fix:**
Use coordinate wrapping to keep viewer offset in smaller range, or implement origin-shifting.

**Related Issues:** ISSUE-052, ISSUE-058

---

### [ISSUE-058] Exact Equality Comparisons on Floats
**Severity:** MEDIUM
**Status:** OPEN
**Category:** State
**Files:** `public/terrainsystem.js:1663`, `public/terrainsystem.js:2037`, `public/terrainsystem.js:3020`

**Description:**
Exact equality (`===`) comparisons on floating-point coordinates can fail due to rounding errors in the snapping calculation.

**Root Cause:**
```javascript
// terrainsystem.js:1663
if (this.initialized && snappedX === this.dataCenterX && snappedY === this.dataCenterY) {
    return;  // May fail to match due to float rounding!
}

// terrainsystem.js:2037
const needsUpdate = deltaGridX !== 0 || deltaGridY !== 0;
```
`Math.round(viewerX / snapGrid) * snapGrid` can produce slightly different results due to float arithmetic.

**Impact:**
Terrain updates missed or triggered unnecessarily. Visual popping as terrain unexpectedly regenerates. Performance issues from excessive updates.

**Suggested Fix:**
Use epsilon comparison: `Math.abs(snappedX - this.dataCenterX) < 0.001`

**Related Issues:** ISSUE-057

---

### [ISSUE-059] Coordinate Wrapping Not Applied Consistently
**Severity:** MEDIUM
**Status:** OPEN
**Category:** State
**Files:** `public/terrainsystem.js:75-78`, `public/systems/InteractionManager.js`

**Description:**
Terrain system uses `wrapCoord()` for texture tiling but InteractionManager and other systems don't apply wrapping when comparing positions.

**Root Cause:**
```javascript
// terrainsystem.js:75-78 - wraps terrain coords
export function wrapCoord(v) {
    const p = TERRAIN_CONFIG.TILE_PERIOD;
    return ((v % p) + p) % p;
}

// InteractionManager - no wrapping applied
const dx = this.game.playerObject.position.x - object.position.x;
```

**Impact:**
Terrain wraps visually but object positions don't. At extreme distances, terrain and objects become desynchronized.

**Suggested Fix:**
Apply consistent coordinate system across all systems, or implement origin-shifting to avoid the need for wrapping.

**Related Issues:** ISSUE-057

---

### [ISSUE-060] Camera Far Plane Wastes Depth Precision
**Severity:** LOW
**Status:** OPEN
**Category:** Performance
**Files:** `public/core/SceneManager.js:34`

**Description:**
Camera far clip plane set to 20,000 with near plane of 1.0 creates 20,000:1 ratio, wasting depth buffer precision.

**Root Cause:**
```javascript
// SceneManager.js:34
this.camera = new THREE.PerspectiveCamera(75, aspect, 1.0, 20000);
// 20000:1 ratio causes Z-fighting and precision issues
```

**Impact:**
Z-fighting artifacts on overlapping geometry. Raycaster numerical instability at large coordinates. Depth buffer precision wasted on distant geometry.

**Suggested Fix:**
Reduce far plane to actual visible distance (~500-1000 units) or use logarithmic depth buffer.

**Related Issues:** ISSUE-046

---

### [ISSUE-061] Object Position Uses Local Not World Coordinates
**Severity:** LOW
**Status:** OPEN
**Category:** State
**Files:** `public/systems/InteractionManager.js:170-172`

**Description:**
Distance calculations use `object.position` (local) instead of `object.getWorldPosition()` (world). Objects with parent transforms calculate incorrect distances.

**Root Cause:**
```javascript
// InteractionManager.js:170-172
const dx = this.game.playerObject.position.x - object.position.x;
const dz = this.game.playerObject.position.z - object.position.z;
// object.position is LOCAL to parent, not world position!
```

**Impact:**
Objects with parent transforms (grouped structures, loaded crates) have wrong interaction distances. May be interactive from wrong positions.

**Suggested Fix:**
```javascript
const worldPos = new THREE.Vector3();
object.getWorldPosition(worldPos);
const dx = this.game.playerObject.position.x - worldPos.x;
```

**Related Issues:** ISSUE-045

---

### [ISSUE-062] Quality Generation Uses Math.random()
**Severity:** LOW
**Status:** OPEN
**Category:** State
**Files:** `public/core/QualityGenerator.js:129-134`

**Description:**
While `getQualityRange()` uses deterministic seeding, the final quality value uses non-deterministic `Math.random()`.

**Root Cause:**
```javascript
// QualityGenerator.js:129-134
getQuality(worldSeed, chunkX, chunkZ, resourceType) {
    const range = this.getQualityRange(...);  // Seeded, deterministic
    return Math.floor(Math.random() * (max - min + 1)) + min;
    // ↑ Uses Math.random(), NOT seeded!
}
```

**Impact:**
Same object generates different quality on each client or respawn. Client/server desync on resource quality in multiplayer.

**Suggested Fix:**
Use the seeded RNG for final quality calculation, not `Math.random()`.

**Related Issues:** ISSUE-047

---

### [ISSUE-063] Neighbor Lookup Uses Float Keys
**Severity:** LOW
**Status:** OPEN
**Category:** State
**Files:** `public/systems/ChunkObjectGenerator.js:400-450`

**Description:**
Neighbor chunk lookup divides by chunkSize producing floats, then uses these as Map keys. But chunkObjects uses integer string keys.

**Root Cause:**
```javascript
// ChunkObjectGenerator.js
const gridX = chunkX / chunkSize;  // Produces float like 37.5
const neighborKey = `${nx},${nz}`;  // "37.5,50" - won't match "37,50"!
const neighborObjects = this.chunkManager.chunkObjects.get(neighborKey);
// Returns undefined - lookup fails!
```

**Impact:**
Minimum distance checks between objects fail. Objects can spawn too close together in distant chunks.

**Suggested Fix:**
Use `Math.floor(chunkX / chunkSize)` or ensure consistent key formatting.

**Related Issues:** ISSUE-047

---

### [ISSUE-064] No Position Validation on Server
**Severity:** LOW
**Status:** OPEN
**Category:** Networking
**Files:** `server/MessageHandlers.js:233,387,432,505,576,680,960`

**Description:**
Client-provided positions are used directly without validation for NaN, Infinity, or bounds.

**Root Cause:**
```javascript
// MessageHandlers.js - used throughout
const chunkId = ChunkCoordinates.worldToChunkId(position[0], position[2]);
// No check for isFinite(), no bounds validation
// position could be [Infinity, 0, NaN]
```

**Impact:**
Malicious or buggy clients can crash chunk calculations. Invalid positions stored in database. Server state corruption.

**Suggested Fix:**
Add validation wrapper:
```javascript
function validatePosition(pos) {
    return Array.isArray(pos) && pos.length >= 3 &&
           pos.every(v => Number.isFinite(v));
}
```

**Related Issues:** ISSUE-049

---

### [ISSUE-065] Leveled Area Tolerance Too Small for Large Coordinates
**Severity:** LOW
**Status:** OPEN
**Category:** State
**Files:** `public/terrainsystem.js:1308-1312`

**Description:**
Leveled area matching uses fixed 0.5 unit tolerance which is inadequate at large coordinates where precision errors exceed this tolerance.

**Root Cause:**
```javascript
// terrainsystem.js:1308-1312
removeLeveledArea(centerX, centerZ, tolerance = 0.5) {
    const idx = this.leveledAreas.findIndex(area =>
        Math.abs(area.centerX - centerX) < tolerance &&
        Math.abs(area.centerZ - centerZ) < tolerance
    );
}
// At position 1,000,000: precision error can be > 0.5 units
```

**Impact:**
Structure removal at large distances fails to find matching leveled area. Terrain doesn't restore properly when structures demolished.

**Suggested Fix:**
Scale tolerance with coordinate magnitude or use relative tolerance.

**Related Issues:** ISSUE-052, ISSUE-058

---

## Distance Issues Root Cause Chain

When a player travels far from spawn and can't interact with objects:

```
1. Player moves to distant chunks (>100 chunks from origin)
   |
   v
2. Chunks load visually (LOAD_RADIUS = 10)
   |-- Objects appear in scene ✓
   |-- Billboards render ✓
   |
   v
3. But PHYSICS_RADIUS = 1 (ISSUE-045)
   |-- Only 3x3 chunks get physics colliders
   |-- Distant visible objects have NO colliders
   |
   v
4. Player clicks on distant object
   |
   v
5. InteractionManager.checkProximityToObjects()
   |-- Calls physicsManager.querySphere()
   |-- Query returns EMPTY (no colliders!)
   |
   v
6. Even if within physics radius:
   |-- Rapier 32-bit precision loss (ISSUE-046)
   |-- Collider positions slightly wrong
   |-- Query may miss nearby objects
   |
   v
7. If collider found but object not in registry:
   |-- Registry only refreshes every 300 frames (ISSUE-048)
   |-- objectRegistry.get(objectId) returns undefined
   |-- "Object not found in registry" warning
   |
   v
8. Additionally at very large coordinates:
   |-- Integer overflow in chunk seeding (ISSUE-047)
   |-- Object IDs may collide
   |-- Terrain height queries imprecise (ISSUE-052)
   |-- Grid snapping fails (ISSUE-053)
   |
   v
9. Result: Player sees objects but cannot interact
   |-- No click feedback
   |-- No interaction buttons appear
   |-- Silent failure
```

---

## Key Code Paths Reference (Distance Issues)

### Physics Collider Creation
- `public/network/SceneObjectFactory.js:717-734` - withinPhysicsRadius check
- `public/core/PhysicsManager.js:109-181` - createStaticCollider()

### Interaction Detection
- `public/systems/InteractionManager.js:69-134` - checkProximityToObjects()
- `public/systems/InteractionManager.js:45-66` - populateObjectRegistry()

### Chunk Coordinate System
- `public/core/ChunkCoordinates.js:46-47` - worldToChunk()
- `public/core/ChunkCoordinates.js:72` - parseChunkId()
- `server/ServerChunkCoords.js` - server-side equivalent

### Terrain Height
- `public/terrainsystem.js:1225-1263` - getHeight(), getWorldHeight()

### Server Broadcasting
- `server/Broadcaster.js:39-60` - broadcastTo3x3Grid()

---

## Long-Distance Travel Freeze Issues

The following issues (ISSUE-066 through ISSUE-085) were identified during investigation of 10-20 second freezes when traveling long distances across many chunks.

---

### [ISSUE-066] O(n²) Scene Traversal For Each Object Add
**Severity:** CRITICAL
**Status:** OPEN
**Category:** Performance
**Files:** `public/network/SceneObjectFactory.js:236-267`

**Description:**
When adding objects from server messages, `scene.traverse()` is called for EVERY object to check for duplicates. With 500 objects arriving and 500 already in scene, this creates 250,000 comparisons in a single frame.

**Root Cause:**
```javascript
this.scene.traverse((object) => {
    if (object.userData && object.userData.objectId) {
        searchCount++;
        if (!object.userData.isBoundingBox && object.userData.objectId === change.id) {
            existingObject = object;
            exactMatchFound = true;
            // NO BREAK - traverse() cannot be stopped early!
        }
    }
});
```
For each of 500+ objects in `chunk_objects_state`, this traverses the entire scene graph. Frame budgeting only applies to procedural generation, not message handlers.

**Impact:**
Primary cause of 10-20 second freezes. Blocks main thread completely during chunk loading.

**Suggested Fix:**
Use a Map-based object registry indexed by objectId for O(1) lookups instead of O(n) scene traversal.

**Related Issues:** ISSUE-068, ISSUE-072

---

### [ISSUE-067] Synchronous Navigation Map Building
**Severity:** CRITICAL
**Status:** OPEN
**Category:** Performance
**Files:** `public/navigation/NavigationMap.js:735-787`, `public/world/ChunkManager.js:605-633`

**Description:**
Navigation map building is completely synchronous. Each chunk requires 10,000 cells × 5 height queries = 50,000 terrain lookups. When player crosses chunk boundary, up to 9 nav maps rebuild = 450,000 height queries in one frame.

**Root Cause:**
```javascript
// NavigationMap.js:736-787 - nested loop with expensive operations
for (let cellZ = 0; cellZ < 100; cellZ++) {
    for (let cellX = 0; cellX < 100; cellX++) {
        const height = getHeight(worldX, worldZ);           // Terrain lookup
        const slope = this.calculateSlope(worldX, worldZ);  // 4 more lookups
        // ... repeated 10,000 times per chunk
    }
}

// ChunkManager.js:628-631 - creates all nav maps synchronously
for (const chunkKey of newNavChunks) {
    if (!oldNavChunks.has(chunkKey)) {
        this.createNavMapForChunk(gx, gz);  // BLOCKING
    }
}
```

**Impact:**
450,000 synchronous height queries block main thread for several seconds.

**Suggested Fix:**
Move navigation map building to Web Worker, or spread across frames using frame budgeting.

**Related Issues:** ISSUE-070

---

### [ISSUE-068] Mass Physics Collider Creation On Chunk Entry
**Severity:** CRITICAL
**Status:** OPEN
**Category:** Performance
**Files:** `public/game.js:2574-2593`, `public/systems/ChunkObjectGenerator.js:335-393`

**Description:**
When chunks enter physics radius, 450+ physics colliders are created synchronously in a single frame. Each `createStaticCollider()` call updates the Rapier physics world.

**Root Cause:**
```javascript
// game.js:2574 - creates collider for EVERY tree/rock entering physics radius
for (const obj of objects) {
    if (!obj.userData.physicsHandle) {
        const collider = this.physicsManager.createStaticCollider(...);  // BLOCKING
        obj.userData.physicsHandle = collider;
    }
}

// ChunkObjectGenerator.js:382 - creates all colliders after generation completes
for (const obj of objects) {
    const collider = physicsManager.createStaticCollider(...);  // BLOCKING
}
```
Frame budgeting spreads object generation across frames, but collider creation happens all at once when generation finishes.

**Impact:**
Hundreds of Rapier operations in one frame cause multi-second freeze.

**Suggested Fix:**
Batch collider creation across multiple frames, or create colliders incrementally during object generation.

**Related Issues:** ISSUE-069

---

### [ISSUE-069] O(n²) Contact Lookup in PhysicsManager
**Severity:** CRITICAL
**Status:** OPEN
**Category:** Performance
**Files:** `public/core/PhysicsManager.js:388-400`

**Description:**
`getCharacterContacts()` performs a linear search through ALL colliders for each contact pair, making it O(collisions × total_colliders).

**Root Cause:**
```javascript
this.world.contactPairsWith(collider.handle, (otherColliderHandle) => {
    // Linear search through ALL colliders!
    for (const [oid, handle] of this.colliderHandles) {
        if (handle.handle === otherColliderHandle) {
            contacts.push({...});
            break;
        }
    }
});
```
A reverse lookup Map `colliderToObjectId` exists (line 38) but isn't used here.

**Impact:**
With 4,500+ colliders in physics radius, contact detection becomes extremely slow during movement.

**Suggested Fix:**
Use the existing `colliderToObjectId` Map for O(1) lookups:
```javascript
const oid = this.colliderToObjectId.get(otherColliderHandle);
```

**Related Issues:** ISSUE-068

---

### [ISSUE-070] Terrain Clipmap Full Rebuild On Long Travel
**Severity:** CRITICAL
**Status:** OPEN
**Category:** Performance
**Files:** `public/terrainsystem.js:2104-2118`, `public/terrainsystem.js:2039-2051`

**Description:**
When player moves more than 32 units (maxIncrementalShift), all 6 clipmap levels trigger `fullUpdate()` which processes 16,641 vertices × 2 passes = 199,692 synchronous operations.

**Root Cause:**
```javascript
// terrainsystem.js:2039-2051 - decision logic
const maxIncrementalShift = Math.floor(size / 4);  // 32.25 for 129x129
const useIncremental = this.initialized &&
    Math.abs(deltaGridX) <= maxIncrementalShift &&
    Math.abs(deltaGridY) <= maxIncrementalShift;

if (!useIncremental) {
    this.fullUpdate(...);  // BLOCKS MAIN THREAD
}

// terrainsystem.js:2104-2118 - two nested loops
for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
        this.computeVertexData(...);   // Height + noise
    }
}
for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
        this.computeVertexNormals(...);  // More calculations
    }
}
```

**Impact:**
200,000 synchronous terrain operations when moving fast or teleporting.

**Suggested Fix:**
Spread fullUpdate() across multiple frames, or use Web Worker for terrain generation.

**Related Issues:** ISSUE-067, ISSUE-075

---

### [ISSUE-071] Memory Pressure From Array Spread Operations
**Severity:** CRITICAL
**Status:** OPEN
**Category:** Performance
**Files:** `public/systems/ChunkObjectGenerator.js:146,213,288,541`, `public/objects.js:566-567`

**Description:**
Massive array spread operations create thousands of temporary objects, triggering garbage collection pauses. Combined with model cloning, this creates GC pressure during chunk loading.

**Root Cause:**
```javascript
// ChunkObjectGenerator.js:146 - copies neighbor positions array
placedPositions: [...neighborPositions]  // Can have 1000s of entries

// ChunkObjectGenerator.js:213 - copies again every batch
[...progress.placedPositions]  // Grows unbounded

// objects.js:566-567 - clones entire model for each object
SkeletonUtils.clone(model);
model.clone();  // 30+ per frame during generation
```
`placedPositions` accumulates ALL placed positions and is never cleared between model types.

**Impact:**
Rapid allocation triggers GC. Combined with other freezes, adds 2-5 seconds of GC pause.

**Suggested Fix:**
Pre-allocate and reuse arrays. Clear `placedPositions` between model types. Use object pooling for Vector3.

**Related Issues:** ISSUE-076

---

### [ISSUE-072] Unthrottled Message Handler Processing
**Severity:** HIGH
**Status:** OPEN
**Category:** Performance
**Files:** `public/network/MessageRouter.js:385-410,454-466`

**Description:**
When server sends `chunk_objects_state` with 500+ objects, the message handler processes ALL objects synchronously with multiple forEach loops and O(n×m) filter operations.

**Root Cause:**
```javascript
// MessageRouter.js:405-410 - processes all objects synchronously
objectChanges.forEach(change => {
    if (change.action === 'add') {
        this.sceneObjectFactory.addObjectFromChange(change);  // Triggers scene.traverse()!
    }
});

// MessageRouter.js:454-466 - 25 filter operations
for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
        const chunkChanges = objectChanges.filter(c => c.chunkId === checkChunkId);
        // 25 iterations × 500 objects = 12,500 comparisons
    }
}
```
Frame budgeting only applies to procedural generation, not to server message processing.

**Impact:**
Blocks main thread processing network messages. Compounds with ISSUE-066.

**Suggested Fix:**
Add frame budgeting to message handler. Process objects in batches across frames.

**Related Issues:** ISSUE-066

---

### [ISSUE-073] Cascading Synchronous Updates On Chunk Crossing
**Severity:** HIGH
**Status:** OPEN
**Category:** Performance
**Files:** `public/game.js:2414-2452`

**Description:**
When player crosses a chunk boundary, multiple expensive systems ALL trigger synchronously in the same frame.

**Root Cause:**
```javascript
// game.js:2414-2452 - all in one frame!
if (this.chunkManager.updatePlayerChunk(...)) {
    this.checkProximityToObjects();               // Physics queries
    this.updateTreeSceneMembership(...);          // 450+ scene.add/remove
    this.chunkManager.updateNavMapsAroundPlayer(); // 450k height queries
    this.banditController.updateTentPresence();   // AI calculations
    this.trapperSystem.onPlayerChunkChanged();    // More processing
}
```
Each of these is expensive individually. Combined, they cause multi-second freezes.

**Impact:**
All chunk-crossing overhead happens in one frame instead of spread across time.

**Suggested Fix:**
Defer expensive operations to subsequent frames. Use a priority queue for chunk updates.

**Related Issues:** ISSUE-067, ISSUE-068

---

### [ISSUE-074] Billboard instanceMatrix.needsUpdate Per-Object
**Severity:** HIGH
**Status:** OPEN
**Category:** Performance
**Files:** `public/BillboardSystem.js:335,365-367`, `public/RockModelSystem.js:317,334-335`

**Description:**
Setting `instanceMatrix.needsUpdate = true` for each individual object causes the entire 100,000-element buffer to be reuploaded to GPU multiple times per frame.

**Root Cause:**
```javascript
// BillboardSystem.js:335
mesh.setMatrixAt(index, matrix);
mesh.instanceMatrix.needsUpdate = true;  // Set for EACH object!

// With 500 trees loading:
// - 500 setMatrixAt() calls
// - 500 needsUpdate = true assignments
// - Each triggers full buffer reupload on next render
```

**Impact:**
GPU buffer uploaded multiple times per frame. 1-2 second stalls during chunk loading.

**Suggested Fix:**
Batch updates: set `needsUpdate = true` only once after all objects are processed.

**Related Issues:** ISSUE-075

---

### [ISSUE-075] Water Chunk Creation Storm
**Severity:** HIGH
**Status:** OPEN
**Category:** Performance
**Files:** `public/terrainsystem.js:3141-3251,3263-3301`

**Description:**
When teleporting or traveling far, up to 81 water chunks are created synchronously. Each creates PlaneGeometry (2,178 vertices), ShaderMaterial (45 uniforms), and triggers shader compilation.

**Root Cause:**
```javascript
// terrainsystem.js:3292-3301 - creates all needed chunks at once
for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
        if (!this.chunks.has(key)) {
            this.createChunk(cx, cz);  // Expensive!
        }
    }
}

// createChunk() at lines 3141-3251:
// - new PlaneGeometry with 32x32 segments
// - new ShaderMaterial with 45 uniforms
// - Clones wave/color uniforms
// - scene.add()
```

**Impact:**
81 chunk × shader compilation = 500ms-1500ms freeze.

**Suggested Fix:**
Spread water chunk creation across frames. Create 2-3 chunks per frame maximum.

**Related Issues:** ISSUE-070

---

### [ISSUE-076] Material Cloning Without Disposal
**Severity:** HIGH
**Status:** OPEN
**Category:** Performance
**Files:** `public/objects.js:614-645`

**Description:**
When applying tints to objects, materials are cloned but original materials are not disposed, causing memory leaks.

**Root Cause:**
```javascript
// objects.js:614-645
if (tint) {
    materials.forEach((mat, idx) => {
        const clonedMat = mat.clone();  // NEW material allocated
        if (clonedMat.color) { ... }
        if (Array.isArray(child.material)) {
            child.material[idx] = clonedMat;  // Original mat orphaned!
        } else {
            child.material = clonedMat;  // Original mat orphaned!
        }
        // MISSING: mat.dispose()
    });
}
```

**Impact:**
Each tinted object (bandit structures) leaks its original material. Memory grows over time, eventually triggering longer GC pauses.

**Suggested Fix:**
Call `mat.dispose()` before replacing with cloned material.

**Related Issues:** ISSUE-071

---

### [ISSUE-077] Dirt Overlay Full Canvas Repaint
**Severity:** MEDIUM
**Status:** OPEN
**Category:** Performance
**Files:** `public/systems/DirtOverlaySystem.js:141-162,204-289`

**Description:**
On every chunk boundary crossing, the entire 512×512 dirt overlay canvas is cleared and repainted with all objects from 9 chunks.

**Root Cause:**
```javascript
// DirtOverlaySystem.js:141-162 - triggers on any chunk change
if (chunkX !== this.currentChunkX || chunkZ !== this.currentChunkZ) {
    this.rebuildFrom3x3Chunks();  // FULL rebuild
}

// rebuildFrom3x3Chunks():204-289
this.ctx.clearRect(0, 0, this.textureSize, this.textureSize);  // Clear 512x512
for (const chunkKey of this.current3x3Keys) {
    const objects = this.chunkManager.chunkObjects.get(chunkKey);
    for (const obj of objects) {
        // Canvas drawing operations...
    }
}
this.needsUpload = true;  // Texture upload to GPU
```

**Impact:**
500ms-2000ms per chunk crossing depending on object count.

**Suggested Fix:**
Only repaint changed chunks. Use dirty rectangles instead of full clear.

**Related Issues:** None

---

### [ISSUE-078] Seam Mesh Height Sampling
**Severity:** MEDIUM
**Status:** OPEN
**Category:** Performance
**Files:** `public/terrainsystem.js:1673-1743`

**Description:**
7 seam meshes between clipmap levels each update with ~257 edge vertices, requiring multiple height samples per vertex during terrain updates.

**Root Cause:**
```javascript
// terrainsystem.js:1673-1743 - updateHeights()
for (let edge = 0; edge < 4; edge++) {
    for (let i = 0; i < n; i++) {  // n = ~257
        const innerHeight = this.sampleFineHeight(worldInnerX, worldInnerZ);
        const hL = this.getTerrainHeight(worldInnerX - fineSpacing, worldInnerZ);
        const hR = this.getTerrainHeight(worldInnerX + fineSpacing, worldInnerZ);
        // Multiple samples per vertex
    }
}
```

**Impact:**
7 seams × 1,792 samples = 12,544 additional height queries during terrain updates.

**Suggested Fix:**
Cache seam heights when clipmap levels update. Only recalculate on major shifts.

**Related Issues:** ISSUE-070

---

### [ISSUE-079] Synchronous Texture Loading in Billboard Systems
**Severity:** MEDIUM
**Status:** OPEN
**Category:** Performance
**Files:** `public/BillboardSystem.js:54`

**Description:**
Billboard textures are loaded synchronously during initialization, blocking the main thread.

**Root Cause:**
```javascript
// BillboardSystem.js:54
const texture = new THREE.TextureLoader().load(texturePath);
// Synchronous load blocks during decoding
```

**Impact:**
2-5 seconds during initial load while 10+ textures decode.

**Suggested Fix:**
Use async texture loading with loading manager. Show loading indicator.

**Related Issues:** ISSUE-074

---

### [ISSUE-080] Continent Cache Eviction Storm
**Severity:** MEDIUM
**Status:** OPEN
**Category:** Performance
**Files:** `public/terrainsystem.js:1131-1180`

**Description:**
When continent cache exceeds 50,000 entries, 10,000 entries are deleted synchronously in a loop.

**Root Cause:**
```javascript
// terrainsystem.js:1149
if (this.continentCache.size > 50000) {
    const keys = this.continentCache.keys();
    for (let i = 0; i < 10000; i++) {
        this.continentCache.delete(keys.next().value);
    }
}
```

**Impact:**
Periodic stalls when cache fills up during long travel.

**Suggested Fix:**
Use LRU cache with incremental eviction, or evict during idle frames.

**Related Issues:** ISSUE-070

---

### [ISSUE-081] Server Sends Entire 5x5 Grid At Once
**Severity:** MEDIUM
**Status:** OPEN
**Category:** Performance, Networking
**Files:** `server/MessageHandlers.js:96-121`

**Description:**
Server sends ALL 25 chunks worth of objects (500+ items) in a single `chunk_objects_state` message, overwhelming the client's message handler.

**Root Cause:**
```javascript
// MessageHandlers.js:96-121
const objectChanges = await this.chunkManager.getObjectChangesInProximity(chunkId, true);
// Loads 5x5 = 25 chunks worth of data

ws.send(JSON.stringify({
    type: 'chunk_objects_state',
    payload: { chunkId, objectChanges: enrichedObjectChanges, serverTick }
}));
// Sends ALL objects in one message
```

**Impact:**
Client receives massive JSON payload, triggering expensive parsing and ISSUE-066/ISSUE-072.

**Suggested Fix:**
Send chunks incrementally. Prioritize by distance. Limit objects per message.

**Related Issues:** ISSUE-066, ISSUE-072

---

### [ISSUE-082] Shader Recompilation in RockModelSystem
**Severity:** MEDIUM
**Status:** OPEN
**Category:** Performance
**Files:** `public/RockModelSystem.js:178-205`

**Description:**
`onBeforeCompile` hook modifies shaders on every material creation. With a static cache key, shader compilation can still occur multiple times.

**Root Cause:**
```javascript
// RockModelSystem.js:178-205
material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(...);
    shader.fragmentShader = shader.fragmentShader.replace(...);
};

material.customProgramCacheKey = () => {
    return 'rock_instanced_opacity';  // Static key
};
```
Shader compilation is synchronous and blocks for 100-300ms per compilation.

**Impact:**
Initial load stalls. Potential recompilation on chunk loading.

**Suggested Fix:**
Pre-compile shaders during loading screen. Verify cache key prevents recompilation.

**Related Issues:** ISSUE-079

---

### [ISSUE-083] Duplicate Height Query in Navigation Cells
**Severity:** LOW
**Status:** OPEN
**Category:** Performance
**Files:** `public/navigation/NavigationMap.js:742,351`

**Description:**
Center height is fetched twice per cell - once at line 742 and again inside `calculateSlope()` at line 351.

**Root Cause:**
```javascript
// NavigationMap.js:742
const height = getHeight(worldX, worldZ);  // Query #1

// NavigationMap.js:745 calls calculateSlope() which does:
// Line 351
const centerH = heightProvider(worldX, worldZ);  // Query #2 - DUPLICATE!
```

**Impact:**
10% extra height queries = 45,000 wasted calculations per full nav rebuild.

**Suggested Fix:**
Pass center height to `calculateSlope()` instead of recalculating.

**Related Issues:** ISSUE-067

---

### [ISSUE-084] Height Provider Type Check In Loop
**Severity:** LOW
**Status:** OPEN
**Category:** Performance
**Files:** `public/navigation/NavigationMap.js:344-348,731-733`

**Description:**
Height provider type is checked inside the 50,000-iteration loop instead of once before.

**Root Cause:**
```javascript
// NavigationMap.js:731-733
const getHeight = heightProvider.getWorldHeight
    ? (x, z) => heightProvider.getWorldHeight(x, z)
    : heightProvider.getHeightFast
        ? (x, z) => heightProvider.getHeightFast(x, z)
        : (x, z) => heightProvider.calculateHeight(x, z);
// This closure is created once, but the checks add complexity
```

**Impact:**
Minor overhead, but contributes to overall nav map generation time.

**Suggested Fix:**
Resolve provider method once before loop. Use direct function reference.

**Related Issues:** ISSUE-067

---

### [ISSUE-085] computeBoundingSphere Called Per Clipmap Level
**Severity:** LOW
**Status:** OPEN
**Category:** Performance
**Files:** `public/terrainsystem.js:2095-2100`

**Description:**
After updating clipmap level geometry, `computeBoundingSphere()` is called which iterates all 16,641 vertices. This happens for each of 6 levels.

**Root Cause:**
```javascript
// terrainsystem.js:2100
this.geometry.computeBoundingSphere();  // O(n) iteration
// Called 6 times = 99,846 vertex iterations
```

**Impact:**
Additional 100k vertex iterations during terrain update.

**Suggested Fix:**
Manually set bounding sphere based on known clipmap dimensions instead of computing.

**Related Issues:** ISSUE-070

---

## Long-Distance Travel Freeze Root Cause Chain

When player travels far across many chunks, freezes occur due to this cascade:

```
1. Player crosses chunk boundary
   |
   v
2. ChunkManager detects chunk change
   |-- Queues new chunks for generation
   |-- Triggers updatePlayerChunk()
   |
   v
3. SAME FRAME: Cascading synchronous operations (ISSUE-073)
   |
   |-- updateTreeSceneMembership() (ISSUE-068)
   |   |-- 450+ scene.add/remove calls
   |   |-- 450+ createStaticCollider() calls
   |
   |-- updateNavMapsAroundPlayer() (ISSUE-067)
   |   |-- Up to 9 nav maps rebuild
   |   |-- 450,000 height queries
   |
   |-- Terrain clipmap.update() (ISSUE-070)
   |   |-- 6 levels × fullUpdate()
   |   |-- 199,692 sync operations
   |
   |-- Water system update (ISSUE-075)
   |   |-- 81 water chunks created
   |   |-- Shader compilations
   |
   v
4. Server sends chunk_objects_state (ISSUE-081)
   |-- 500+ objects in one message
   |
   v
5. MessageRouter.handleChunkObjectsState (ISSUE-072)
   |-- 3 forEach loops
   |-- 25 filter operations (O(n×m))
   |
   v
6. SceneObjectFactory.addObjectFromChange (ISSUE-066)
   |-- scene.traverse() for EACH object
   |-- 500 objects × 500 scene objects = 250,000 comparisons
   |
   v
7. Billboard systems update (ISSUE-074)
   |-- needsUpdate = true per object
   |-- Full GPU buffer reuploads
   |
   v
8. Memory pressure builds (ISSUE-071)
   |-- Array spreads create garbage
   |-- Model clones create garbage
   |-- Material leaks (ISSUE-076)
   |
   v
9. GC triggered
   |-- Full garbage collection
   |-- Additional 2-5 second pause
   |
   v
TOTAL: 10-20 second freeze
```

---

## Key Code Paths Reference (Freeze Issues)

### Message Processing
- `public/network/MessageRouter.js:385-410` - object add loop
- `public/network/MessageRouter.js:454-466` - chunk filter loop
- `public/network/SceneObjectFactory.js:236-267` - scene.traverse()

### Navigation
- `public/navigation/NavigationMap.js:735-787` - buildTerrainGrid()
- `public/world/ChunkManager.js:605-633` - updateNavMapsAroundPlayer()

### Physics
- `public/core/PhysicsManager.js:388-400` - getCharacterContacts()
- `public/game.js:2574-2593` - mass collider creation

### Terrain
- `public/terrainsystem.js:2039-2051` - incremental vs full update decision
- `public/terrainsystem.js:2104-2118` - fullUpdate()
- `public/terrainsystem.js:3263-3301` - water chunk creation

### Chunk Updates
- `public/game.js:2414-2452` - runPeriodicChecks()

### Billboard/LOD
- `public/BillboardSystem.js:335` - instanceMatrix.needsUpdate
- `public/systems/ChunkObjectGenerator.js:146,213` - array spreads

---

## Horse Disconnect Y Position Issues

### [ISSUE-086] Server Preserves Stale Y on Disconnect Recovery
**Severity:** HIGH
**Status:** OPEN
**Category:** State
**Files:** `server/MessageHandlers.js:1407-1409`

**Description:**
When a peer disconnects while mounted on a horse, the server repositions the horse to the chunk center but preserves the original Y position from when the horse was claimed.

**Root Cause:**
```javascript
// MessageHandlers.js:1407
const newPosition = [chunkX * 50 + 25, entity.position[1], chunkZ * 50 + 25];
//                                       ^^^^^^^^^^^^^^^^^ STALE Y PRESERVED
```
The server has no terrain height calculation (terrain is client-side only), so it cannot correct Y for the new X/Z position. The Y value stored when the horse was claimed may not match terrain height at chunk center.

**Impact:**
Horses appear floating high in the air or underground after a peer disconnects while riding. The Y position from the original claim location is used at the new chunk-center location.

**Suggested Fix:**
Option A: Client receiving `object_added` with `isMobileRelease: true` should correct Y to terrain.
Option B: Send terrain height hints from client to server periodically while riding.
Option C: Mark released horses as needing terrain correction; clients correct on first render.

**Related Issues:** ISSUE-087, ISSUE-088

---

### [ISSUE-087] object_added Handler Doesn't Correct Horse Y to Terrain
**Severity:** HIGH
**Status:** OPEN
**Category:** State
**Files:** `public/network/MessageRouter.js` (object_added handling), `public/network/SceneObjectFactory.js`

**Description:**
When a client receives an `object_added` message for a horse (after peer disconnect or normal spawn), the mesh is created at the exact server-sent position without terrain height correction.

**Root Cause:**
```javascript
// SceneObjectFactory - object creation
mesh.position.set(obj.position[0], obj.position[1], obj.position[2]);
// Y is whatever server sent - no terrain height lookup
```
Compare to peer-controlled horses which get Y corrected every frame in AvatarManager:
```javascript
const terrainY = this.terrainGenerator.getWorldHeight(mesh.position.x, mesh.position.z);
mesh.position.y = terrainY;  // Always corrected for peer horses
```
Static horses from `object_added` don't receive this treatment.

**Impact:**
Horses spawned or recovered from disconnect appear at wrong Y level until something triggers a position update.

**Suggested Fix:**
In object_added handling for mobile entities (horse, boat), add terrain height correction:
```javascript
if (obj.name === 'horse' && terrainGenerator) {
    const terrainY = terrainGenerator.getWorldHeight(obj.position[0], obj.position[2]);
    mesh.position.y = terrainY;
}
```

**Related Issues:** ISSUE-086, ISSUE-088

---

### [ISSUE-088] No Terrain Height Correction on release_mobile_entity
**Severity:** HIGH
**Status:** OPEN
**Category:** State
**Files:** `server/MessageHandlers.js:1258-1357` (handleReleaseMobileEntity)

**Description:**
When the server receives a `release_mobile_entity` message, it accepts the position array directly without any validation or terrain height correction.

**Root Cause:**
```javascript
// handleReleaseMobileEntity
position: payload.position,  // Used as-is from client
```
The server trusts whatever Y the client sends. If the client had a desync, was mid-animation, or had stale terrain data, that incorrect Y persists and is broadcast to all clients.

**Impact:**
Horses can be released at incorrect Y positions if the dismounting client has any position desync.

**Suggested Fix:**
Client should ensure terrain-corrected Y before sending release. Add validation comment or client-side terrain lookup before release message.

**Related Issues:** ISSUE-086, ISSUE-087

---

### [ISSUE-089] Peer Horse Cleanup Race Condition with object_added
**Severity:** MEDIUM
**Status:** OPEN
**Category:** Networking
**Files:** `public/network/NetworkManager.js:384-401`, `public/network/GameStateManager.js:893-977`

**Description:**
When a peer disconnects while riding a horse, there's a race condition between peer cleanup and server's object_added broadcast.

**Root Cause:**
Sequence of events:
1. `cleanupPeer()` removes the peer's mobile entity mesh from scene
2. Server broadcasts `object_added` with recovered horse position
3. Client creates NEW static mesh at server position

If these overlap or arrive out of order:
- Duplicate meshes may appear
- No deduplication check for existing horse ID before creating new mesh
- The dual mesh system (static mesh in objectRegistry vs peer-controlled mesh) can desync

**Impact:**
Duplicate horse meshes, horses at wrong position, or visual glitches after peer disconnect.

**Suggested Fix:**
Add deduplication: before creating mesh from `object_added`, check if mesh with same entityId already exists. Clear any existing mesh first.

**Related Issues:** ISSUE-086, ISSUE-087

---

### [ISSUE-090] Position Broadcast During Dismount Animation
**Severity:** MEDIUM
**Status:** OPEN
**Category:** State
**Files:** `public/game.js:3279-3314` (completeDisembark)

**Description:**
When dismounting, `completeDisembark()` sends the release message with current entity position BEFORE the player position is corrected to terrain.

**Root Cause:**
```javascript
// game.js:3279-3287 - Release sent FIRST
this.networkManager.sendMessage('release_mobile_entity', {
    position: entity.position.toArray(),  // May be mid-lerp Y value
});

// game.js:3302-3314 - THEN player Y corrected to terrain
this.playerObject.position.y = terrainY + 0.03;
```
If disconnect happens during the disembark animation, or if there's any timing issue, the position captured could be an interpolated value between mounted height and ground.

**Impact:**
Horse may be released at slightly incorrect Y position during normal dismount.

**Suggested Fix:**
Correct entity Y to terrain height BEFORE sending release message, not after.

**Related Issues:** ISSUE-088

---

### [ISSUE-091] No Client mobileEntityState Cleanup on Disconnect
**Severity:** LOW
**Status:** OPEN
**Category:** State
**Files:** `public/network/NetworkManager.js:102-129` (onDisconnect handler)

**Description:**
The client's `onDisconnect` handler doesn't clean up `mobileEntityState` when WebSocket disconnects.

**Root Cause:**
```javascript
// NetworkManager onDisconnect - hides buttons, updates UI, but...
// Missing:
// gameState.mobileEntityState.isActive = false;
// gameState.mobileEntityState.currentEntity = null;
// gameState.mobileEntityState.entityMixer = null; // Memory leak
```
If player was actively riding when disconnected:
- `mobileEntityState.isActive` remains `true`
- `mobileEntityState.currentEntity` still holds mesh reference
- `mobileEntityState.entityMixer` animation mixer may leak memory

**Impact:**
Memory leaks from animation mixers, potential stale state issues on rapid reconnect.

**Suggested Fix:**
Add mobileEntityState cleanup to disconnect handler:
```javascript
if (gameState.mobileEntityState.isActive) {
    gameState.mobileEntityState.entityMixer?.stopAllAction();
    // Reset all mobileEntityState fields to null/false
}
```

**Related Issues:** ISSUE-086

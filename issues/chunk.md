# Chunk Border Crossing Stutter - Investigation Report

## Summary
Crossing chunk borders causes noticeable stutter due to multiple systems contending for resources in a single frame, synchronous operations blocking the main thread, and configuration mismatches between client and server.

---

## CRITICAL ISSUES

### 1. LOAD_RADIUS Mismatch (Client vs Server)
**Location**: `public/config.js:387` vs `server/ServerConfig.js`
**Severity**: CRITICAL

- Client expects: `LOAD_RADIUS: 10` (21x21 grid = 441 chunks)
- Server provides: `LOAD_RADIUS: 2` (5x5 grid = 25 chunks)

**Impact**:
- Client continuously requests missing chunks
- Server repeatedly sends partial chunk data
- Creates massive pending queue of 441 chunks
- At 1 chunk/frame = 7+ seconds to clear queue

---

### 2. Synchronous File I/O on Server
**Location**: `server/ChunkStore.js:166`
**Severity**: CRITICAL

```javascript
_loadFromFile(chunkId) {
    const fileData = fs.readFileSync(filePath, 'utf8');  // BLOCKS EVENT LOOP
}
```

**Impact**:
- Blocks entire Node.js event loop during disk read
- Can cause 100+ ms stalls if chunks not in database
- Blocks all other player updates during load

---

### 3. Sequential vs Parallel Chunk Loading
**Location**: `server/MessageHandlers.js:119,169`
**Severity**: HIGH

- Initial spawn uses **parallel** loading (`parallel = true`)
- Border crossing uses **sequential** loading (`parallel = false`)
- With 25 chunks and sync file I/O, border crossing is much slower

---

### 4. Large Uncompressed WebSocket Payloads
**Location**: `server/MessageHandlers.js`, `public/network/MessageRouter.js`
**Severity**: CRITICAL

- 25 chunks x 500 objects x ~200 bytes = 2-5 MB per chunk transition
- No WebSocket compression enabled
- Client must parse entire JSON structure synchronously

---

### 5. Synchronous Object Processing on Client
**Location**: `public/network/MessageRouter.js:358-485`
**Severity**: CRITICAL

- `handleChunkObjectsState()` processes all objects at once from 5x5 grid
- Synchronous removal cache population (lines 390-408)
- Synchronous object adds without frame budgeting (lines 411-415)
- N-squared loop checking 5x5 grid for bandit camps (lines 449-483)

---

## HIGH SEVERITY ISSUES

### 6. Clipmap Terrain Full Rebuilds
**Location**: `public/terrainsystem.js:2170-2320`
**Severity**: HIGH

- When player crosses chunk boundary, clipmap levels snap to new grid
- Levels use **full geometry rebuild** when delta > 25% of level size
- Full update: 16,641 vertices x 2 passes x up to 6 LOD levels
- Multiple levels can trigger simultaneously

---

### 7. Physics Colliders Created Synchronously
**Location**: `public/network/SceneObjectFactory.js:290-349`
**Severity**: HIGH

- `createObjectInScene()` creates physics colliders synchronously
- Up to 12,500 synchronous Rapier3D collider creations during spawn
- Each collider creation stalls main thread

---

### 8. Object Generation Queue Accumulation
**Location**: `public/systems/ChunkObjectGenerator.js:196-198`
**Severity**: HIGH

- 5ms frame budget, 1 chunk per frame
- With LOAD_RADIUS=10: 441 chunks queued
- Clipmap updating simultaneously creates contention

---

## MEDIUM SEVERITY ISSUES

### 9. Water System Synchronous Chunk Allocation
**Location**: `public/terrainsystem.js:3414-3453`
**Severity**: MEDIUM

- All water chunk removals happen before all creations
- Up to 9 new water chunks created sequentially on boundary crossing
- Each includes geometry + shader setup

---

### 10. Navigation Map Sync Creation
**Location**: `public/world/ChunkManager.js:557-596`
**Severity**: MEDIUM

- Navigation maps built synchronously with no frame budgeting
- Happens when new chunks enter physics radius (3x3 grid)
- Iterates through all objects in chunk

---

### 11. Physics Collider Sync Initialization
**Location**: `public/world/ChunkManager.js:692-790`
**Severity**: MEDIUM

- All physics colliders created at once for 3x3 grid
- No batching or frame budgeting

---

### 12. Deferred Chunk Disposal
**Location**: `public/world/ChunkManager.js:154-163`
**Severity**: MEDIUM

- 4-second delay before cleanup
- Only 4 chunks disposed per cycle
- Memory pressure + occasional cleanup stutters

---

### 13. Dirt Overlay Rebuild
**Location**: `public/systems/DirtOverlaySystem.js:133-200`
**Severity**: MEDIUM

- Rebuilds from 3x3 chunks on boundary crossing
- Multiple `paintStructureVertices()` calls
- Triggers GPU texture upload

---

## MULTI-SYSTEM CONTENTION (ROOT CAUSE)

When player crosses a chunk border, ALL of these systems trigger in a SINGLE FRAME:

1. ChunkManager queues new chunks
2. ChunkObjectGenerator processes queue (5ms budget)
3. Clipmap terrain updates (potentially full rebuild)
4. Water system creates/destroys chunks
5. Dirt overlay rebuilds texture
6. Navigation maps build for physics radius
7. Physics colliders initialize
8. Server sends large JSON payload
9. Client parses and processes objects

**Result**: 30-200ms frame spike, lasting 3-10 frames

---

## FILE LOCATIONS - CRITICAL PATHS

| Issue | File | Lines | Fix Priority |
|-------|------|-------|--------------|
| LOAD_RADIUS mismatch | `public/config.js` | 387 | 1 |
| Sync file I/O | `server/ChunkStore.js` | 166 | 2 |
| Sequential loading | `server/MessageHandlers.js` | 169 | 3 |
| Large payloads | `server/MessageHandlers.js` | 119, 169 | 4 |
| Sync object processing | `public/network/MessageRouter.js` | 358-485 | 5 |
| Clipmap full updates | `public/terrainsystem.js` | 2170-2320 | 6 |
| Physics sync creation | `public/network/SceneObjectFactory.js` | 290-349 | 7 |
| Object queue | `public/systems/ChunkObjectGenerator.js` | 196-198 | 8 |
| Water chunks sync | `public/terrainsystem.js` | 3414-3453 | 9 |
| Nav map sync | `public/world/ChunkManager.js` | 557-596 | 10 |

---

## RECOMMENDED FIXES

### Priority 1: Fix Configuration
- Align LOAD_RADIUS between client and server (use server's value of 2)
- Reduces chunk queue from 441 to 25

### Priority 2: Async File I/O
- Replace `fs.readFileSync` with `fs.promises.readFile` in ChunkStore.js
- Already wrapped in async function, just change the call

### Priority 3: Parallel Chunk Loading
- Change `handleChunkUpdate()` to use `parallel = true` like `handleJoinChunk()`

### Priority 4: Chunk Streaming
- Send chunks incrementally instead of all at once
- Prioritize chunks in player's movement direction
- Enable WebSocket compression (permessage-deflate)

### Priority 5: Frame Budget Everything
- Add frame budgeting to navigation map creation
- Add frame budgeting to physics collider initialization
- Stagger water chunk creation across frames
- Limit object processing when clipmap is updating

### Priority 6: Clipmap Threshold
- Increase full update threshold from 25% to 33-50%
- Implement partial update strategy for boundary regions

### Priority 7: Reduce Contention
- Stagger clipmap, water, and dirt overlay updates
- Monitor frame time; skip non-critical updates if budget exceeded
- Process only 1 system per frame during rapid movement

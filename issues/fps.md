# FPS Performance Audit

Last Updated: 2025-12-26
Status: Investigated with code analysis agents

---

## CONFIRMED CRITICAL - Fix These First

### 1. Camera Controller Vector3 Allocations
**File:** `public/core/CameraController.js`
**Status:** FIXED (2025-12-26)

Added 4 pre-allocated vectors to constructor and refactored `update()` to reuse them.
See `issues/fps1.md` for implementation details.

---

### 4. Physics Manager RAPIER/Vector3 Allocations
**File:** `public/core/PhysicsManager.js`
**Status:** FIXED (2025-12-26)

Added 2 pre-allocated plain JS objects to constructor and refactored `updateKinematicPosition()` and `computeCharacterMovement()` to reuse them. Kept THREE.Vector3 allocation on return value for caller safety.
See `issues/fps4.md` for implementation details.

---

### 7. Template String Chunk Key Allocations
**Files:** `ChunkCoordinates.js`, `BillboardSystem.js`, `RockModelSystem.js`, `game.js`
**Status:** FIXED (2025-12-26)

Added cached `get3x3ChunkKeys()` method to ChunkCoordinates.js. Cache invalidates only when center chunk changes. Updated 3 hot-path methods to use cached keys.
See `issues/fps7.md` for implementation details.

---

### 5. getLeveledHeight O(n) Iteration
**File:** `public/terrainsystem.js` (lines 1430-1464)
**Status:** FIXED (2025-12-26)

Added AABB pre-filter before expensive rotation transform. Skips areas where `Math.abs(worldX - area.centerX) > area.maxReach`. Expected 30-70% reduction in iterations.

---

## CONFIRMED MEDIUM - Worth Fixing

---

### 8. AnimationSystem Terrain Height Calls
**File:** `public/systems/AnimationSystem.js` (lines 79-97)
**Status:** CONFIRMED - 0.5-2ms per frame with 5-10 ships

Calls `getTerrainHeight()` for every animated ship every frame. Each call:
- 6-octave Perlin noise evaluation (~65-150 microseconds)
- getLeveledHeight iteration
- Wave height calculation (~100-200 microseconds)

**Fix:** Cache terrain height per ship, only update when position changes >1 unit.

---

## CONDITIONAL/LOW PRIORITY

### 2. RockModelSystem.updateInstanceMatrix Allocations
**File:** `public/RockModelSystem.js` (lines 305-327)
**Status:** LOW PRIORITY - Only during chunk generation, already frame-budgeted (5ms/frame)

Creates 5 objects per rock placement, but placement is spread across frames.
Not a hot path during normal gameplay.

**Fix if needed:** Add pre-allocated objects following BillboardSystem pattern.

---

### 3. AvatarManager cartDir Allocation
**File:** `public/entity/AvatarManager.js` (lines 451-455)
**Status:** CONDITIONAL - Only when peers tow loaded carts

Allocates Vector3 inside nested loop, but only executes when:
- Peer has towedCart AND
- Cart has loadedCrate with mesh

Typical impact: 0-3 allocations/frame (most players don't tow loaded carts).

**Fix if needed:** Add `this._tempCartDir` to class.

---

### 12. Water System Uniform Updates
**File:** `public/terrainsystem.js` (lines 3467-3471)
**Status:** LOW IMPACT - 81 chunks x 2 uniforms = 162 updates, but <1% of water render cost

Updates `time` and `foamTime` uniforms per water chunk per frame.
The real water bottleneck is vertex/fragment shader complexity, not uniforms.

**Fix if needed:** Share single material instance across all water chunks.

---

## NEEDS MORE INVESTIGATION

The following items showed minimal impact in initial analysis but should be more thoroughly investigated later with actual profiling:

### 6. updateBillboards Map Creation
**File:** `public/BillboardSystem.js` (lines 436-439)
**Initial Finding:** Only called once per 60 frames (~1/sec), 11-entry Map is negligible.
**Investigate:** Profile actual GC impact during extended gameplay sessions.

---

### 9. Date.now() Multiple Calls
**File:** `public/game.js` (lines 1484, 1917)
**Initial Finding:** Only 2 redundant calls/frame, GameLoop already provides `now` parameter.
**Investigate:** Verify no other hidden Date.now() calls in hot paths.

---

### 10. Avatar Combat Stance Iteration
**File:** `public/entity/AvatarManager.js` (lines 514-613)
**Initial Finding:** Already throttled to every 10 frames with spatial filtering (3x3 chunk check).
**Investigate:** Profile with many peers (10+) and many AI entities (50+).

---

### 11. Billboard needsUpdate GPU Uploads
**File:** `public/BillboardSystem.js` (lines 520-527)
**Initial Finding:** Skip thresholds (70%-130%) prevent 60-70% of redundant uploads. Per-type granularity is reasonable.
**Investigate:** Use WebGL profiler to measure actual GPU buffer upload frequency.

---

### 13. InstancedMesh.setMatrixAt Batching
**Files:** `BillboardSystem.js`, `RockModelSystem.js`, `SmokeParticleSystem.js`
**Initial Finding:** Code already sets `needsUpdate = true` once after loops, not inside.
**Investigate:** Verify no edge cases where batching breaks down.

---

### 14. forEach vs for-of Overhead
**File:** `public/game.js` (lines 2300, 2579)
**Initial Finding:** <1 microsecond difference per iteration, peerGameData is small Map (2-20 entries).
**Investigate:** Profile with large peer counts to verify assumption.

---

### 15. Math.sqrt() Usage
**Files:** Various (66 total calls in public/)
**Initial Finding:** Most comparisons already use squared distances. Remaining sqrt calls are for actual distance values needed in calculations.
**Investigate:** Profile `PlayerController.js:362` which calls sqrt every frame during movement.

---

### 16. Collision Callback Iteration
**File:** `public/core/PhysicsManager.js` (lines 87-100)
**Initial Finding:** Zero callbacks registered - `onCollisionEnter()` is never called anywhere. Dead code.
**Investigate:** Consider removing unused collision callback system.

---

### 17. getWaterChunks() Array Creation
**File:** `public/terrainsystem.js` (lines 3559-3561)
**Initial Finding:** Only called during structure placement mode (not every frame).
**Investigate:** Profile during extended building sessions.

---

### 18. isPositionInStructure O(n) Iteration
**File:** `public/game.js` (lines 1272-1307)
**Initial Finding:** Function exists but is NEVER CALLED anywhere in codebase. Dead code.
**Investigate:** Consider removing unused function.

---

### 19. Multiple isRunning() Checks
**File:** `public/game.js` (lines 2186-2288)
**Initial Finding:** 13 calls/frame but each is simple property access (<1 microsecond total).
**Investigate:** Profile animation system during complex combat scenarios.

---

### 20. Terrain Height Throttling Inconsistency
**Files:** `AIController.js` (every 5 frames), `MobileEntitySystem.js` (every frame), `AnimationSystem.js` (every frame)
**Initial Finding:** Different rates are intentional - collision detection needs real-time, AI movement doesn't.
**Investigate:** Verify bears (2.5 u/s) don't miss slope changes with 5-frame throttle.

---

### 21. processChunkQueue One-at-a-Time
**File:** `public/world/ChunkManager.js` (lines 183-201)
**Initial Finding:** Conservative but safe. Real bottleneck is ChunkObjectGenerator's 5ms/frame budget, not chunk metadata.
**Investigate:** Test processing 2-4 chunks/frame during low-load frames.

---

## Priority Fix Order

1. ~~**Camera Controller**~~ - DONE
2. ~~**Physics Manager**~~ - DONE
3. ~~**Chunk key strings**~~ - DONE
4. ~~**getLeveledHeight**~~ - DONE
5. **AnimationSystem** - Cache terrain height per ship (NEXT)

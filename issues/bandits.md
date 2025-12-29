# Bandit Lag Reduction Strategies

## Spawn & Loading

1. **Spawn Queue System** (public/ai/AISpawnQueue.js)
   - Queues spawn requests and processes one bandit per frame
   - Spreads expensive `SkeletonUtils.clone()` calls across multiple frames
   - Prevents frame stutters from simultaneous spawns

2. **Priority-Based Spawn Queue** (AISpawnQueue.js)
   - Bandits priority 3, brownbears priority 2, deer priority 1
   - Higher priority entities spawn first
   - Tracks queued entity IDs to prevent duplicates

3. **Early-Out Tent Check** (public/ai/AIController.js:89-204)
   - Caches `_hasTentsInRange` flag for 3x3 chunk grid
   - Skips entire spawn check if no bandit camps nearby
   - Updated only when player changes chunks

## Math Optimizations

4. **Squared Distance Comparisons** (AIController.js - 24 instances)
   - Uses `dx*dx + dz*dz` instead of `Math.sqrt(distance)`
   - Applied to spawn range, chase range, shooting range, leash range
   - Avoids expensive square root calculations in hot paths

5. **Deterministic O(n) Targeting** (AIController.js:719-800)
   - Single-pass algorithm to find closest player
   - Avoids O(n log n) sorting
   - String comparison tie-breaker for deterministic results

## Memory & Allocation

6. **Player List Object Pool** (AIController.js:94-97)
   - Reusable `_playerListCache` array
   - Pre-allocated player objects (id, x, z, y, type)
   - Avoids creating new objects each frame

7. **Candidates Cache Pool** (AIController.js:651-800)
   - Reusable `_candidatesCache` array
   - Stores distance calculations without allocating

8. **Broadcast Message Pooling** (AIController.js:99-113, 1893-1922)
   - Pre-allocated `_broadcastMsg` object
   - Modified in-place instead of creating new message each tick
   - Reduces P2P message allocation pressure

9. **Lazy Material Cloning** (public/ai-enemy.js:103-106)
   - Only clones shirt material per bandit
   - Other materials reused from original model
   - Reduces memory and allocation overhead

## Query Optimizations

10. **Hoisted Position Queries** (AIController.js:213-227)
    - Pre-fetches all player positions once per tick
    - Reuses in tent loop instead of querying per tent per player
    - Reduces O(tents x players) to O(players)

11. **Chunk-Based Tent Registry** (GameState.js)
    - `banditStructuresByChunk` Map for O(1) tent lookups
    - Prevents scanning entire world for tents
    - Updated when structures added/removed

12. **3x3 Chunk Grid Checking** (AIController.js)
    - Only checks nearby chunks within physics radius
    - Skips distant chunks entirely

## Update Throttling

13. **Distance-Based Update Culling** (AIController.js:1941-1957)
    - Far bandits (>50 units) update every 4 frames
    - Nearby bandits (<50 units) update every frame
    - Configurable via `NEAR_DISTANCE_SQ` and `FAR_UPDATE_INTERVAL`

14. **Idle Check Throttling** (AIController.js:53)
    - Idle bandits check for targets every 30 frames
    - Active bandits check every frame
    - Configured via `IDLE_CHECK_INTERVAL: 30`

15. **Pathfinding Interval** (AIController.js:806-865)
    - Recalculates path every 6 seconds (`PATHFIND_INTERVAL: 6000`)
    - Not every frame
    - Caches road status for speed calculations

16. **Terrain Slope Throttling** (AIController.js)
    - Terrain slope checked every 5 frames
    - Uses cached slope multiplier for movement between checks

## Distributed Authority

17. **Single Authority Per Bandit** (AIController.js)
    - Only client with lowest clientId near tent runs full AI simulation
    - Other clients interpolate toward received positions
    - Reduces CPU load from duplicate simulations

18. **Velocity-Based Interpolation** (AIController.js:1309-1391)
    - Non-authority clients use constant speed toward target position
    - More natural than position lerp
    - No sqrt() when approaching target (uses squared threshold)

19. **Desync Recovery Thresholds** (AIController.js)
    - Teleports if desync > 10 units (`TELEPORT_THRESHOLD_SQ = 100`)
    - Snaps when < 0.05 units away (`SNAP_THRESHOLD_SQ = 0.0025`)

## Model & Rendering

20. **Shared Rifle Material** (public/ai-enemy.js:12-23)
    - Creates once, reuses for all AI instances
    - Avoids creating new material per bandit

21. **Single-Pass Model Setup** (ai-enemy.js:76-108)
    - Finds hand bone AND applies materials in one `traverse()` call
    - Previously was 2 separate traversals

22. **Frustum Culling Enabled** (ai-enemy.js:90)
    - Enables Three.js frustum culling per mesh
    - Automatically skips off-screen rendering

23. **Animation State Optimization** (ai-enemy.js:196-276)
    - Only updates animation mixer when needed
    - Freezes combat animation at frame 2 when idle
    - Scales animation speed based on movement

## Network

24. **Selective Broadcasting** (AIController.js)
    - Only authority broadcasts bandit state
    - Non-authority clients interpolate locally
    - Reduces network traffic

25. **Tick-Based Deterministic Sync** (TickManager.js)
    - Uses TickManager for deterministic player positions
    - Authority bandits use tick-synchronized positions
    - Prevents divergence between clients

## Server-Side

26. **Serverless Authority Model**
    - AI authority runs on clients, not server
    - Server only handles loot generation and persistence

27. **Deterministic Loot Generation** (server/BanditLootGenerator.js)
    - Seeded RNG for consistent loot
    - No server-side AI computation

28. **Chunk Broadcasting Limits** (server.js)
    - Only broadcasts to 5x5 grid (25 chunks)
    - Not entire world

# Guns Horses & Ships - Game Context & Architecture

## Overview

A real-time multiplayer 3D survival game built with:
- **Client**: Three.js, WebGL, WebRTC (P2P networking)
- **Server**: Node.js with WebSocket
- **Database**: PostgreSQL with JSON file fallback
- **Physics**: Rapier 3D

---

## Directory Structure

```
horses/
├── server/                     # Backend Node.js server
│   ├── server.js              # Entry point, WebSocket server
│   ├── ChunkStore.js          # World chunk management & persistence
│   ├── MessageHandlers.js     # Game logic for all message types
│   ├── Broadcaster.js         # Message broadcasting
│   ├── AuthManager.js         # Authentication & sessions
│   ├── FriendsManager.js      # Friend system
│   ├── DatabaseManager.js     # PostgreSQL connection
│   ├── CookingSystem.js       # Food cooking mechanics
│   ├── TileworksSystem.js     # Tile production system
│   ├── StructureDecayUtils.js # Decay formula calculations
│   ├── TimeTrackerService.js  # Server-side time events
│   ├── ServerConfig.js        # Server configuration
│   └── ServerChunkCoords.js   # Coordinate utilities (matches client)
│
├── public/                     # Client web application
│   ├── client.html            # Main HTML entry point
│   ├── game.js                # Main game engine
│   ├── config.js              # Game constants & balancing
│   ├── objects.js             # 3D model loading & placement
│   ├── ui.js                  # HUD & status displays
│   ├── audio.js               # Sound & music system
│   ├── terrainsystem.js       # Clipmap terrain + Gerstner water system
│   ├── RockModelSystem.js     # Instanced 3D rocks with LOD (0-35 units)
│   ├── BillboardSystem.js     # Far-distance rotating billboards (25+ units)
│   ├── ai-enemy.js            # AI visual controller (animations, death)
│   │
│   ├── core/                  # Core game systems
│   │   ├── GameState.js       # Central state management
│   │   ├── GameLoop.js        # Frame loop & timing
│   │   ├── GameInitializer.js # Initialization sequence
│   │   ├── SceneManager.js    # Three.js scene setup
│   │   ├── CameraController.js# Player camera
│   │   ├── InputManager.js    # Keyboard/mouse input
│   │   ├── PhysicsManager.js  # Rapier 3D physics
│   │   ├── ChunkCoordinates.js# World coordinate system
│   │   └── TickManager.js     # Deterministic tick sync for AI
│   │
│   ├── network/               # Networking layer
│   │   ├── NetworkManager.js  # High-level networking
│   │   ├── WebSocketTransport.js # Server connection
│   │   ├── P2PTransport.js    # WebRTC peer connections
│   │   ├── MessageRouter.js   # Message handling
│   │   ├── GameStateManager.js# Network state sync
│   │   ├── MessageQueue.js    # Incoming message buffer
│   │   └── AuthClient.js      # Client-side auth
│   │
│   ├── player/                # Player systems
│   │   ├── PlayerController.js# Movement & controls
│   │   ├── PlayerInventory.js # Backpack management
│   │   ├── PlayerHunger.js    # Hunger/starvation
│   │   ├── PlayerActions.js   # Action capabilities
│   │   └── PlayerCombat.js    # Combat system
│   │
│   ├── systems/               # Game feature systems
│   │   ├── ResourceManager.js # Resource harvesting
│   │   ├── BuildingSystem.js  # Construction mechanics
│   │   ├── CraftingSystem.js  # Crafting & chiseling
│   │   ├── ActionManager.js   # Action state machine
│   │   ├── AnimationSystem.js # Character animations
│   │   ├── EffectManager.js   # Visual effects
│   │   ├── InteractionManager.js # Object interactions
│   │   ├── GrassGathering.js  # Gathering mechanics
│   │   ├── DockMerchantSystem.js # Merchant NPCs
│   │   ├── ScheduledShipSystem.js # Ship spawning
│   │   ├── ChunkObjectGenerator.js # Procedural objects
│   │   ├── DeathManager.js    # Death mechanics
│   │   ├── AmbientSoundSystem.js # Background audio
│   │   ├── MobileEntitySystem.js # Boats, carts, horses
│   │   └── TrapperSystem.js   # Trapper NPCs for quality info
│   │
│   ├── ui/                    # UI components
│   │   ├── InventoryUI.js     # Backpack interface
│   │   ├── BuildMenu.js       # Construction menu
│   │   ├── LoginModal.js      # Auth interface
│   │   ├── DeathScreen.js     # Death UI
│   │   ├── FriendsPanel.js    # Friends list
│   │   ├── FactionPanel.js    # Faction UI
│   │   ├── SpawnScreen.js     # Spawn selection
│   │   ├── MarketUI.js        # Trading interface
│   │   ├── RotationControls.js# Object rotation UI
│   │   ├── CombatHUD.js       # Combat stats display
│   │   └── ThreatIndicator.js # Enemy direction glow
│   │
│   ├── effects/               # Visual effects
│   │   ├── MuzzleFlash.js     # Rifle muzzle flash
│   │   ├── DirtKickup.js      # Bullet miss particles
│   │   └── GunSmokeParticleSystem.js # Instanced gun smoke
│   │
│   ├── spawn/                 # Respawn system
│   │   └── SpawnUtils.js
│   │
│   ├── navigation/            # Pathfinding
│   │   ├── NavigationMap.js   # Navigation grid
│   │   ├── NavigationManager.js # Pathfinding coordination
│   │   ├── NavigationWorkerClient.js # Web Worker client
│   │   └── AStar.js           # A* algorithm
│   │
│   ├── workers/               # Web Workers
│   │   └── NavigationWorker.js # Off-thread pathfinding
│   │
│   ├── world/                 # World management
│   │   ├── ChunkManager.js    # Chunk loading/unloading
│   │   ├── StructureManager.js# Structure placement
│   │   ├── SkyManager.js      # Three.js Sky with sun/reflections
│   │   └── SkyboxManager.js   # [LEGACY] Old skybox rendering
│   │
│   ├── entity/                # Entity systems
│   │   ├── AIEnemyManager.js  # AI enemy management
│   │   ├── AvatarManager.js   # Player avatars
│   │   ├── BrownBearManager.js # Brown bear visuals (den-spawned)
│   │   ├── DeerManager.js     # Deer entity spawning/lifecycle
│   │   ├── NameTagManager.js  # Player name tags
│   │   └── DeathSystem.js     # Death handling
│   │
│   ├── ai/                    # AI behavior system
│   │   ├── AIController.js    # Deterministic bandit AI
│   │   ├── BrownBearController.js # Brown bear AI
│   │   ├── DeerController.js  # Deer AI (passive, fleeing)
│   │   ├── BaseWorkerController.js # Worker NPC base class
│   │   ├── WoodcutterController.js # Woodcutter NPC
│   │   ├── BakerController.js # Baker NPC
│   │   ├── GardenerController.js # Gardener NPC
│   │   ├── MinerController.js # Miner NPC
│   │   ├── StoneMasonController.js # StoneMason NPC
│   │   ├── BlacksmithController.js # Blacksmith NPC
│   │   ├── IronWorkerController.js # IronWorker NPC
│   │   ├── TileWorkerController.js # TileWorker NPC
│   │   └── FishermanController.js # Fisherman NPC
│   │
│   ├── models/                # 3D model files (.glb)
│   ├── sounds/                # Audio files
│   ├── textures/              # Texture images
│   ├── terrain/               # Terrain textures
│   ├── items/                 # Item sprites
│   ├── vehicles/              # Vehicle models
│   └── chunks/                # Chunk JSON files (offline mode)
```

---

## Server Architecture

### Entry Point (server.js)
- WebSocket server on port 8080
- Creates all modular systems asynchronously
- Registers 30+ message handlers
- Handles player connections and authentication

### Key Server Systems

**ChunkStore**: Manages 50x50 world chunks, loads from PostgreSQL or JSON fallback (stored in `public/chunks/`), caches in memory, tracks players per chunk. Auto-migrates old chunk files from `public/` on startup. Broadcasts to 5x5 grid around player (LOAD_RADIUS=2).

**MessageHandlers**: Processes all message types (`join_chunk`, `place_construction_site`, `harvest_resource_request`, `build_construction`, etc.). Implements game logic, structure decay, ownership.

**MessageRouter**: Broadcasts to specific chunks, 3x3 grids, or individual clients. Rate-limited proximity updates (100ms).

**AuthManager**: Register/login with bcrypt hashing, session management (7-day expiration), player data persistence.

**TimeTrackerService**: Per-minute events (player cleanup). Note: Many timed events (cooking, tree growth, decay, ships) moved to client-triggered for server efficiency.

**Specialized Systems**:
- CookingSystem: Food preparation in campfires
- TileworksSystem: Tile production
- FriendsManager: Friend lists and requests
- AuditLogger: Player action tracking for moderation

### Audit Logging System
Tracks player actions for moderation and investigation. Dual-mode storage:
- **Online mode**: PostgreSQL `audit_log` table (indexed by timestamp, actor, owner, object)
- **Offline mode**: Daily JSONL files in `./logs/` directory

**Tracked Actions:**
| Code | Action | Description |
|------|--------|-------------|
| 1 | STRUCT_ADD | Structure placed |
| 2 | STRUCT_REMOVE | Structure removed (tree chopped, building destroyed) |
| 3 | INV_OPEN | Player opened inventory |
| 4 | INV_SAVE | Player modified inventory |
| 5 | MARKET_BUY | Market purchase |
| 6 | MARKET_SELL | Market sale |
| 7 | PLAYER_CONNECT | Player joined server |
| 8 | PLAYER_DISCONNECT | Player left server |
| 9 | CHUNK_ENTER | Player moved to new chunk |
| 10 | HARVEST | Resource harvested |
| 11 | FINGERPRINT_CHECK | Fingerprint validated on login |
| 12 | FINGERPRINT_BAN | Admin banned a fingerprint |

**Query Tool** (`node server/AuditQuery.js`):
```bash
# Summary of last 24 hours
node server/AuditQuery.js

# Filter by player, output JSON for AI review
node server/AuditQuery.js --player bob --format json

# Detect suspicious activity
node server/AuditQuery.js --suspicious --hours 12

# Other filters: --action, --chunk, --account, --obj, --limit
```

**Direct Database Query** (if AuditQuery.js fails):

**Important:** Always write queries to a `.js` file and run with `node filename.js`. Do NOT use inline `node -e` - it has shell escaping issues on Windows.

**audit_log table schema:**
```
id: integer
ts: bigint (milliseconds timestamp)
action_type: smallint
chunk_x: smallint
chunk_z: smallint (NOTE: Z not Y)
obj_type: varchar
obj_id: varchar
actor_id: varchar (session ID)
actor_account: varchar
actor_name: varchar (player display name)
owner_id: varchar
data: jsonb
```

**Example query file (write to query-temp.js, run with node):**
```javascript
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'DATABASE_URL_FROM_ENV_FILE',
  ssl: { rejectUnauthorized: false }
});

async function query() {
  const result = await pool.query(`
    SELECT ts, action_type, obj_type, actor_name, chunk_x, chunk_z
    FROM audit_log ORDER BY ts DESC LIMIT 50
  `);
  result.rows.forEach(r => {
    const date = new Date(Number(r.ts)).toISOString();
    console.log(`[${date}] ${r.action_type} | ${r.obj_type} | ${r.actor_name} | chunk ${r.chunk_x},${r.chunk_z}`);
  });
  await pool.end();
}
query();
```

**Key tables:** `audit_log`, `players`, `banned_fingerprints`, `player_data`

### Ban System (Hardware Fingerprinting)
Detects ban evasion by collecting browser/hardware fingerprints on login. Fingerprints include WebGL GPU info, canvas rendering hash, screen resolution, CPU cores, and device memory.

**How it works:**
1. Client collects fingerprint on login (~15ms, no gameplay impact)
2. Server checks hash against `banned_fingerprints` table
3. Exact match = blocked ("Access denied")
4. 2+ partial signal matches = allowed but flagged for review
5. Fingerprint stored with player account
6. Players already in-game are kicked within 30 seconds of being banned

**Ban Tool** (`node server/BanPlayer.js`):
```bash
# Ban a player (blocks their hardware from logging in)
node server/BanPlayer.js cheaterName --reason "Speed hacking"

# List all bans
node server/BanPlayer.js list

# Remove a ban
node server/BanPlayer.js unban 5

# Check if a player is banned or flagged
node server/BanPlayer.js check suspiciousPlayer
```

**Key files:**
- `public/network/FingerprintCollector.js` - Client-side collection
- `server/AuthManager.js` - checkFingerprint(), storeFingerprint(), banFingerprint()
- `server/BanPlayer.js` - CLI admin tool

### Admin Broadcast System
Send announcements to all connected players. Useful for server restart warnings, update announcements, or event notifications.

**How it works:**
1. Admin runs CLI script locally with a message
2. Script connects to production server via WebSocket
3. Server validates `ADMIN_SECRET` from request
4. If valid, broadcasts message to all connected clients
5. Clients display big centered banner for 10 seconds

**Admin Tool** (`node server/AdminBroadcast.js`):
```bash
node server/AdminBroadcast.js "Server restarting in 5 minutes!"
node server/AdminBroadcast.js "New update: Horses can now swim!"
```

**Setup:**
- Add `ADMIN_SECRET=your-secret` to `.env` file
- Add same `ADMIN_SECRET` to Render environment variables

**Key files:**
- `server/AdminBroadcast.js` - CLI tool (runs locally, connects to production)
- `server.js` - Handles `admin_broadcast` message type with secret validation
- `public/network/MessageRouter.js` - Routes broadcast to UI
- `public/ui.js` - `showAdminBroadcast()` displays the banner

**Security:** Only the CLI script with the correct `ADMIN_SECRET` can trigger broadcasts. Client has no ability to send admin messages.

### Database Schema
```sql
chunks (chunk_id, data, created_at, updated_at)
players (id, username, password_hash, created_at, fingerprint_hash, fingerprint_signals)
sessions (token, player_id, expires_at)
player_data (player_id, inventory, position, health, hunger, faction_id, etc.)
friends (requester_id, target_id, status, created_at)
server_state (id, tick, version, updated_at)  -- Single row, persists tick across restarts
audit_log (id, ts, action_type, chunk_x, chunk_z, obj_type, obj_id, actor_id, actor_account, actor_name, owner_id, data)
banned_fingerprints (id, fingerprint_hash, partial_hashes, banned_at, banned_by, reason, original_account_id, original_username, match_count, is_active)
```

### Server State Persistence
The server tick and version are persisted to survive restarts:
- **Tick**: Continuous counter (1/second), used for growth timers, cooking, etc.
- **Version**: Increments each server startup, useful for debugging/cache invalidation
- **Storage**: PostgreSQL (online) or `./server-state.json` (local mode)
- **Save frequency**: Every 60 ticks (1 minute)
- **Why needed**: Planted trees store `plantedAtTick`; if tick reset to 0, growth calculations would break (negative elapsed time)

---

## Client Architecture

### Main Game Loop (game.js)
1. Three.js scene setup (camera, lighting, renderer)
2. Player model loading with animations
3. Physics engine initialization (Rapier3D)
4. Terrain generation and chunk loading
5. WebSocket & WebRTC connection

Per-frame:
- Update player position
- Proximity detection
- P2P sync (position, animations, harvesting)
- Process message queue
- Update chunk visibility
- Animate entities

### Core Systems

**GameState**: Dual ID system (`clientId` for P2P, `accountId` for auth), chunk tracking, player state, inventory (50 slots), action state, bandit structure registry (`banditStructuresByChunk` Map for O(1) AI detection lookups).

**NetworkManager**: WebSocket to server, WebRTC to players, state sync, message queue.

**PhysicsManager**: Rapier 3D, static colliders for terrain/objects/structures, collision groups, proximity queries.

**Terrain Generation**: New clipmap-based system (`terrainsystem.js`) with 6 LOD levels, triplanar procedural texturing (grass/rock/sand/snow), continent generation system. Supports terrain leveling for structures via `TerrainGenerator.addLeveledArea()` with rotated rectangle support and smoothstep transition blending.

**Water System**: Integrated Gerstner wave water (`WaterSystem` in `terrainsystem.js`) with depth texture for transparency, shore foam effects, environment map reflections. Distance-based shader LOD reduces texture samples at range:
- **Close (0-150 units)**: Full quality - detail normals, shimmer, SSS glow, 3-layer foam texture, full shore foam (13 samples)
- **Medium (150-250 units)**: Reduced - no shimmer, simplified SSS, 1-layer foam, simplified shore foam (5 samples)
- **Far (250+ units)**: Minimal - depth texture only, no foam texturing, basic color (1 sample)
- Continent mask in depth texture G channel controls foam visibility (ocean vs inland water)

**Dirt/Road Overlay System** (`DirtOverlaySystem.js`): 512x512 canvas texture painted around player's 3x3 chunk grid. Two channels:
- **R channel**: Dirt patches under structures/trees (grayscale gradients)
- **G channel**: Road patches (painted by players via build menu)
Repainted on chunk boundary crossing. Shader samples both channels and blends dirt/road textures over terrain. Roads persist via `gameState.roads` Map (keyed by chunkKey).

**Tree LOD System**: 2-tier rendering for thousands of trees with smooth transitions:
- **Tier 1 (0-35 units)**: 3D models or close-range rendering
- **Tier 2 (35+ units)**: Camera-facing rotating billboards (`BillboardSystem`)
- Per-instance opacity via shader injection, chunk-based spatial partitioning for efficient updates

**Rock LOD System**: Similar to trees, `RockModelSystem` renders 3D rocks (limestone, sandstone, clay, iron) with LOD fading to billboards.

**Ambient Sound System** (`AmbientSoundSystem.js`): Altitude and continent-based environmental audio:
- **Ocean** (Y -30 to 10): Full volume at Y≤4, fades out by Y=10. Uses `getContinentMask()` to only play near ocean (not inland).
- **Plains/Forest** (Y 0-22): Fade in Y 0→4, full Y 4-18, fade out Y 18→22. Only on land (continent mask).
- **Mountain** (Y 18+): Fade in Y 18→22, full above Y=22. Crossfades with plains. Only on land.
- **Campfire**: Distance-based (1-7 units) to active campfires with smoke.
- Combat silence: Plains fades out during gunfights, fades back in over 30 seconds.

---

## Chunk System Architecture

### Overview
The game uses a **center-based chunk system** where each 50x50 unit chunk is referenced by its center point. Chunk (0,0) spans -25 to +25 on both axes.

### Client-Side (ChunkManager.js)
- **LOAD_RADIUS: 10** = 21x21 grid = 441 chunks loaded for visuals
- **PHYSICS_RADIUS: 1** = 3x3 grid = 9 chunks with physics/navigation
- Manages object lifecycle: creation, updates, disposal
- **NOT** terrain meshes (clipmap terrain is independent)

**Queue-Based Loading:**
- `pendingChunkCreations`: Prioritized by movement direction
- `pendingChunkDisposals`: Processed every 4 seconds, 4 chunks per batch
- One chunk created per frame during gameplay (frame budgeting)

**Object Tracking:**
- `chunkObjects` Map: `"gridX,gridZ"` → array of THREE.Object3D
- `removedObjectsCache` Map: Tracks harvested objects to prevent regeneration

### Server-Side (ChunkStore.js)
- **LOAD_RADIUS: 2** = 5x5 grid = 25 chunks for broadcasting
- Dual storage: PostgreSQL (primary) or JSON files (fallback)
- Caches chunks in memory, evicts distant chunks

**Chunk Data Structure:**
```javascript
{
  players: [{ id: playerId }],
  objectChanges: [{ id, name, position, quality, owner, rotation, ... }],
  seed: terrainSeed
}
```

### Object Generation (ChunkObjectGenerator.js)
- Frame-budgeted: 5ms max per frame, 30 objects per batch
- Generates 11 types: oak, fir, pine, cypress, limestone, sandstone, clay, iron, apple, log, vegetables
- ~500 objects per type based on density settings

### Network Flow
1. Client sends `join_chunk` on spawn
2. Server loads 5x5 grid, sends `chunk_objects_state`
3. Client processes adds/removes, queues natural object generation
4. On border crossing: `chunk_update` → server sends new proximity data

### Related Systems
- **Navigation Maps**: Only created in PHYSICS_RADIUS (3x3)
- **Billboard/LOD Systems**: Organized by chunk for efficient updates
- **Water System**: Uses separate chunk size (100 units, radius 4)

---

## Game Systems

### Resource Harvesting
- Types: Firewood (axe), Planks (saw), Stone (pickaxe)
- 10-second harvest duration
- Tool durability: `loss = resourceQuality / toolQuality`
- Trees → logs → resources flow

### Construction
1. Place construction site (1 plank, instant)
2. Build structure (6 seconds, requires hammer + materials from nearby crates)
3. Structure types: house, crate, garden, outpost, dock, market, ship

### Structure Decay (Client-Triggered)
- Durability calculated client-side using exponential formula
- Client sends `convert_to_ruin` when durability reaches 0
- Server converts structure to ruin, broadcasts to clients
- Ruins expire after 1 hour via `remove_ruin` message
- Quality caps: tent (15, ~2 days), campfire (2, ~1.6 hours)
- Pattern reduces server load by offloading calculations to clients

### Crafting
- Stone → chiseled stone (6 seconds)
- Grass → rope (5 grass)
- Rope → fishing net (5 ropes)
- Logs → planks (in crates)

### Food & Hunger
- **Sources**: Apple trees (auto-spawn), gardens (auto-spawn), mushrooms (10% on grass), fishing (10s), cooking (1min)
- **Durability**: apple/mushroom (10), vegetables (20), roastedvegetables (40), fish/cookedfish (60, min 10), cookedmeat (80)
- **Consumption**: 1 durability/min split across all food. Variety bonus: 10%/type (max 40%)
- **Starvation**: 5min hungry → 6min death
- **Cooking**: Campfire/house/tileworks cook fish/vegetables/clay. Progress bars show immediately via `cookingStartTime` merge

### Crafting Quality
- Tools have minimum quality floor of 25 when crafted
- Affected: fishingnet, axe, pickaxe, saw, hammer, chisel

### Combat
- Rifle weapon with ammunition
- AI enemies spawned in tents
- Death system with respawn

### AI System Architecture
Authority-based client-side AI with P2P state synchronization. One client (authority) simulates each AI; others interpolate.

**Two-Layer Design:**
```
AIController (behavior) --> AIEnemy (visual)
BrownBearController (behavior) --> BrownBearManager (visual)
DeerController (behavior) --> DeerManager (visual)

BaseWorkerController (shared) --> WoodcutterController --> man model
                              --> BakerController --> man model
                              --> GardenerController --> man model
                              --> MinerController --> man model
                              --> StoneMasonController --> man model
                              --> BlacksmithController --> man model
                              --> IronWorkerController --> man model
                              --> TileWorkerController --> man model
                              --> FishermanController --> man model
```

#### Combat AI (Bandits, Bears, Deer)

- **AIController** (`public/ai/AIController.js`): Bandit behavior + state
  - Modular callback-based design via `initialize(config)`
  - One authority per AI entity (lowest clientId near home tent)
  - Authority runs full simulation, broadcasts state every tick
  - Non-authority clients interpolate toward received positions
  - Authority transfers on peer disconnect or chunk change
  - States: idle/chasing/leashed/returning/dead
  - A* pathfinding, deterministic targeting (2-unit tie-breaker threshold)
  - Deterministic shooting (pseudo-random based on tentId + shotCount)
  - P2P messages: `bandit_spawn`, `bandit_death`, `bandit_state`, `bandit_shoot`, `bandit_kill_ack`
  - Sets `moving` and `inCombatStance` on visual controller

- **BrownBearController** (`public/ai/BrownBearController.js`): Brown bear AI
  - Aggressive melee behavior, chases players
  - States: idle/chasing/attacking/returning
  - Spawns from bearden structures (bear dens)

- **DeerController** (`public/ai/DeerController.js`): Deer AI
  - Passive/fleeing behavior, runs from players
  - States: idle/grazing/fleeing
  - Can be hunted for resources

#### Worker NPCs

Worker NPCs use a shared base class (`BaseWorkerController`) with specialized behavior in subclasses. Workers spawn via **proximity-based spawning** when players approach structures that have been **sold to a proprietor**.

**Seek Proprietor System:**
- Player owns a worker structure (bakery, woodcutter, gardener, miner, stonemason, blacksmith, ironworks, tileworks, fisherman) within 20 units of a market
- "Seek Proprietor" button appears, costing 10 coins
- Once sold: structure stops decaying, inventory locked for all players, worker spawns when players approach
- Sold structures can still be destroyed by enemy artillery
- Server marks structure with `isSoldWorkerStructure: true` and `proprietor: 'npc'`

- **BaseWorkerController** (`public/ai/BaseWorkerController.js`): Abstract base class
  - Shared infrastructure: P2P authority, movement, pathfinding, animations
  - Template Method pattern: subclasses implement `_getMovementTarget()`, `_onArrival()`, `_handleIdleState()`
  - `checkProprietorSpawnsOnTick(chunkX, chunkZ)`: Called every server tick, spawns workers near sold structures
  - Movement states handled generically; worker-specific states in subclasses
  - Config defaults: MOVE_SPEED (0.8), PATHFIND_INTERVAL (6s), STUCK_TIMEOUT (60s)

- **WoodcutterController** (`public/ai/WoodcutterController.js`): Woodcutter behavior
  - Spawns at woodcutter buildings
  - States: idle/seeking_tree/cutting_tree/seeking_log/processing_log/delivering/depositing/returning/stuck
  - Behavior: Find pine tree → Cut (10s) → Process log (5 harvests) → Deliver to market → Return

- **BakerController** (`public/ai/BakerController.js`): Baker behavior
  - Spawns at bakery buildings
  - States: idle/seeking_grain/processing/delivering/depositing/returning/stuck
  - Behavior: Collect grain from gardens → Process into bread → Deliver to market → Return

- **GardenerController** (`public/ai/GardenerController.js`): Gardener behavior
  - Spawns at gardener buildings
  - States: idle/seeking_plant_spot/planting/waiting_for_harvest/seeking_harvest/harvesting/delivering/depositing/returning/seeking_tree_spot/planting_tree/stuck
  - Behavior: Plant vegetables (23 slots) → Wait 30 min → Harvest FIFO → Deliver → Plant trees during downtime

- **MinerController** (`public/ai/MinerController.js`): Miner behavior
  - Spawns at miner buildings
  - States: idle/seeking_rock/mining/delivering/depositing/returning/stuck
  - Behavior: Find rock (50-unit radius) → Mine 5 times (10s each) → Deliver stone to market → Return

- **StoneMasonController** (`public/ai/StoneMasonController.js`): StoneMason behavior
  - Spawns at stonemason buildings
  - States: idle/going_to_market/collecting/returning/chiseling/delivering/depositing/stuck
  - Behavior: Collect raw stone (5) from market → Chisel each (6s) → Deliver chiseled stone → Return

- **BlacksmithController** (`public/ai/BlacksmithController.js`): Blacksmith behavior
  - Spawns at blacksmith buildings
  - States: 18 states including assessment, collection, depositing, waiting, excess firewood handling
  - Behavior: Collect ironingot (5) + firewood (1) → Deposit → Wait 62 ticks → Collect parts → Deliver

- **IronWorkerController** (`public/ai/IronWorkerController.js`): IronWorker behavior
  - Spawns at ironworks buildings
  - States: 18 states (matches BlacksmithController pattern)
  - Behavior: Collect iron (5) + firewood (1) → Deposit → Wait 62 ticks → Collect ironingot → Deliver

- **TileWorkerController** (`public/ai/TileWorkerController.js`): TileWorker behavior
  - Spawns at tileworks buildings
  - States: 18 states (matches BlacksmithController pattern)
  - Behavior: Collect clay (5) + firewood (1) → Deposit → Wait 62 ticks → Collect tiles → Deliver

- **FishermanController** (`public/ai/FishermanController.js`): Fisherman behavior
  - Spawns at fisherman buildings
  - States: 15 states - assessment, seeking_water, fishing, collecting firewood, waiting, delivery
  - Behavior: Find water (Y<0) → Fish 8 times (10s each) → Collect firewood → Process → Deliver cooked fish

#### Support Systems

- **TickManager** (`public/core/TickManager.js`): Position sync (optional)
  - Server broadcasts tick number every 1 second
  - Clients capture all player positions at each tick
  - Used by authority for consistent targeting decisions

- **AIEnemy** (`public/ai-enemy.js`): Visual-only controller for bandits
  - Model setup, materials, rifle attachment, muzzle flash
  - Animation state machine (walk, combat, shoot, death)
  - Methods: `update()` (animation only), `playShootAnimation()`, `kill()`

- **AISpawnQueue** (`public/ai/AISpawnQueue.js`): Frame-budgeted spawn system
  - Queues spawn requests, processes one per frame to prevent stutter
  - Priority: bandits (3) > brownbears (2) > deer (1) > workers (0)

**Key Optimizations:**
- Object pooling in `_buildPlayerList()` to avoid per-frame allocations
- Spawn optimization: tent presence cached per chunk, early-out if none nearby
- A* pathfinding every 6 seconds with waypoint following
- Squared distance comparisons (no `Math.sqrt()` in hot paths)
- Distance culling: far entities update every 4th frame

### Mobile Entities (Boats, Carts, Horses, Crates)
Pilotable/rideable entities managed by `MobileEntitySystem.js`:
- **Boats**: Water vehicles, spawn at docks
- **Carts**: Land vehicles for cargo transport
- **Horses**: Rideable mounts for faster land travel
- **Crates**: Mobile storage (10x10 inventory), can be loaded onto carts
  - Uses instant 6-second build (like tent), no construction site
  - When cart is attached, "Load Crate" button appears near crates
  - Loaded crate parented to cart mesh (auto-follows cart)
  - "Unload Crate" drops crate behind cart with inventory intact
  - **Security**: Server-side `loadedCrates` Map tracks all loaded crates
  - **Locking**: Inventory lock acquired on load, released on unload
  - **Validation**: Inventory format validated on server, position validated on drop
  - **Disconnect cleanup**: Crates restored to original position if player disconnects
- Proximity detection for boarding, occupancy tracking, movement physics
- P2P sync for multiplayer, disembark validation (water depth, terrain)

### Artillery System
Two-mode cannon system:
- **Towing Mode**: Horse-only. Attach artillery like cart, tow to positions
- **Manning Mode**: Player stands behind, uses A/D to aim, F to fire
  - State: `gameState.artilleryManningState` (isManning, mannedArtillery, heading, lastFireTime)
  - Config: `CONFIG.ARTILLERY_COMBAT` (turnRate, cooldown, range, accuracy, barrelOffset)
  - Movement blocked via `PlayerController.artilleryManningState` check
  - Rotation broadcasts via P2P `artillery_aim` messages
- **Targeting**: 15-degree firing cone, finds nearest bandit/bear/player in range (28 units)
- **Combat**: Hit chance matches rifle formula (35% base, +quality bonus, +height bonus, +distance bonus)
- **Effects**: Muzzle flash, smoke cloud, impact effects (dirt/blood based on hit/miss)
- **CombatHUD**: Artillery mode with cooldown bar, hides rifle-specific elements
- **Death handling**: Auto-leaves artillery, clears occupied status
- **P2P messages**: `artillery_manned`, `artillery_unmanned`, `artillery_aim`, `artillery_fire`, `artillery_damage`
- Cooldown: 12 seconds between shots

### Trapper NPCs
Regional resource quality information system (`TrapperSystem.js`):
- One trapper tent + NPC spawns per chunk in player's 3x3 area
- Trapper tents don't decay (`isTrapperStructure: true`)
- Players can pay coins to learn resource quality in surrounding regions

### Inventory
- Backpack: 5×10 = 50 slots
- Crate: 10×10 = 100 slots
- **Sling Slot**: Single-item slot for rifles only, separate from backpack grid
  - Located in backpack header next to "Backpack" label
  - Accepts only `rifle` type items
  - Saves backpack space (rifle is 2×5 = 10 slots in backpack)
  - Bidirectional drag: sling ↔ backpack ↔ crate
- Drag-and-drop, rotation (0°, 90°, 180°, 270°), stacking, quality tracking

### Trading
- Market stalls for buy/sell
- Ships triggered by client when 30 min elapsed (client sends `trigger_dock_ship`)
- Server processes trade, updates dock timestamp, broadcasts
- Dynamic prices based on quality

---

## Networking

### Dual-Transport Model

**WebSocket (Server)**:
- Persistent connection
- Authoritative state validation
- Messages: chunk ops, building, harvesting, auth

**WebRTC (P2P)**:
- Direct player-to-player in same chunk
- Lower latency for real-time
- Messages: position sync, harvest progress, sounds, animations

### Position Sync (Hybrid Event + Tick)
- **Event-driven**: `player_move` sent on click for immediate response
- **Tick-based**: `player_tick` broadcast every server tick (1/sec) as safety net
- Tick corrects drift >1.5 units, syncs missed stop events
- Stale tick protection: only trusts "stop" if positions are consistent (<2.0 units)

### Message Flow Example (Harvesting)
```
1. Client clicks resource
2. ResourceManager starts 10s harvest
3. Broadcasts "player_harvest" to peers (P2P)
4. After 10s, sends "harvest_resource_request" to server
5. Server validates, removes object, adds to inventory
6. Server broadcasts removal to 3×3 chunk grid
```

---

## Multiplayer Features

### Player Avatars
- Position synced via P2P
- Animations: walking, chopping, building, carrying
- Health/hunger visible

### Ownership System
- Structures owned by builder (stored as `owner` property in chunk data)
- Transferable on account upgrade
- Persists with accountId

**Tents**: Shared inventory - anyone can access regardless of owner

**Owner-Protected Structures**: Only the builder can access inventory
- Protected types: `house`, `tileworks`, `ironworks`, `blacksmith`, `bakery`, `fisherman`
- Non-owners see "Locked [StructureName]" button, disabled interaction
- Server validates ownership in `handleLockInventory`, `handleGetCrateInventory`, `handleSaveCrateInventory`
- Checks both `clientId` (session) and `accountId` (logged in)

**Houses** (additional restrictions):
- Players can only own ONE house at a time
- Building a new house clears ownership of previous house
- Previous house becomes abandoned (inaccessible, `owner: null`)
- Tracked via `ownedHouseId` and `ownedHouseChunkId` in player data
- Warning shown in build menu when selecting house
- Server broadcasts `object_added` with `owner: null` to update nearby clients

### Dual ID Strategy
- `clientId`: Temporary session for P2P
- `accountId`: Persistent after login

### Factions
- Southguard (South Z:-50000 to 0), Northmen (North Z:0 to 50000)
- Guests are always Neutral (no faction selection)
- Zone-based spawning: players spawn in their faction's territory
- Faction change consequences:
  - Kills player and respawns in new territory
  - Clears ownership of ALL tents and houses (server-side via `ChunkStore.clearTentHouseOwnership()`)
  - Clears home spawn point
- Daily change cooldown (can only change once per 24 hours)
- Guest upgrade to account: shows faction selection, choosing non-neutral triggers same consequences as faction change

### Friends
- Add by username, accept/decline requests
- Online status, remove friends

### Home Spawn
- Building a tent or house auto-sets it as player's home
- Server sends `home_set` message to client on build completion
- Spawn screen shows "Spawn at Home" option when home is set
- Home persists in database, loaded on login/session validation
- Faction change clears home

---

## Configuration

### Client (public/config.js)
```javascript
INVENTORY: {
    BACKPACK_COLS: 5,
    BACKPACK_ROWS: 10,
    CRATE_COLS: 10,
    CRATE_ROWS: 10
}

ACTIONS: {
    CHOP_TREE_DURATION: 10000,
    HARVEST_LOG_DURATION: 10000,
    HARVEST_STONE_DURATION: 10000,
    BUILD_DURATION: 6000,
    CHISELING_DURATION: 6000
}

CHUNKS: {
    CHUNK_SIZE: 50,                  // World units per chunk
    LOAD_RADIUS: 10,                 // 21×21 grid = 441 chunks (500 units visible)
    PHYSICS_RADIUS: 1,               // 3×3 grid for physics/colliders/navigation
    UNLOAD_DISTANCE: 11              // Unload beyond this
}
```

### Server (server/ServerConfig.js)
```javascript
CHUNKS: {
    CHUNK_SIZE: 50,                  // MUST match client
    LOAD_RADIUS: 2                   // Broadcast radius (5×5) - NOT visual load
}

CONSTRUCTION_QUALITY_CAPS: {
    tent: 15,
    campfire: 2
}

SHIP_TRADING: {
    MAX_DISTANCE: 20,
    BUY_MATERIALS: [...],
    SELL_ITEMS: [...],
    PRICES: {...}
}
```

---

## Critical Sync Points (Client ↔ Server)

These MUST match:
1. CHUNK_SIZE (50)
2. Chunk coordinate calculations (center-based chunks)
3. Chunk ID format: `"chunk_X,Z"`
4. Tool durability formula
5. Action durations
6. Terrain seed (12345)
7. Structure quality caps

**Intentionally Different:**
- Client LOAD_RADIUS (10) = visual loading, 441 chunks
- Server LOAD_RADIUS (2) = broadcast proximity, 25 chunks

---

## Game Balance

**Resource Density**:
- Trees: 1.0 (high)
- Rocks: 0.3 (medium)
- Vegetables/Apples: 0.1 (rare)

**Harvest Times**: 10 seconds each

**Tool Durability**: Max 100, loss based on quality differential

**Market Prices**:
- Limestone: 2 coins
- Plank: 3 coins
- Axe: 60 coins
- Rifle: 200 coins

---

## Technology Stack

**Backend**: Node.js, WebSocket (ws), PostgreSQL (pg), bcrypt

**Frontend**: Three.js, Rapier3D WASM, Web Workers, WebRTC, WebGL 2.0

---

## Deployment & Environments

### Folder Structure
```
Desktop/
├── test Horses/Horses/   # Development (local testing)
└── Horses/               # Production (git push to Render)
```

### The Toggle (public/config.js)
```javascript
NETWORKING: {
    USE_ONLINE_SERVER: false,  // Toggle this for deployment
    LOCAL_SERVER_URL: 'ws://localhost:8080',
    ONLINE_SERVER_URL: 'wss://multiplayer-game-dcwy.onrender.com',
}
```

### Deployment Steps
1. Increment `SERVER_VERSION` in `server.js` (line 25) - forces client cache refresh
2. Set `USE_ONLINE_SERVER: true` in `public/config.js`
3. Copy folder contents from `test Horses/Horses` to `Horses`
4. Git push from `Desktop/Horses`
5. Render auto-deploys from git

### Server Version (server.js:25)
```javascript
const SERVER_VERSION = 2;  // Increment on each deployment
```
- Sent to clients in welcome message
- Clients compare with cached version and hard-refresh if outdated
- **Always increment when deploying code changes**

### Server Environment (Automatic)
The server adapts automatically via environment variables:
- **DATABASE_URL**: PostgreSQL connection (Render provides this)
- **NODE_ENV**: `production` enables SSL for database

```javascript
// DatabaseManager.js - auto-detects environment
ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
} : false
```

### Render Services
| Service | Type | URL |
|---------|------|-----|
| Server | Node.js | `wss://multiplayer-game-dcwy.onrender.com` |
| Client | Static Site | `https://multiplayer-game-client.onrender.com/client.html` |
| Database | PostgreSQL | (internal, auto-connected) |

### Local Development
1. Install PostgreSQL locally
2. Create `.env` file with `DATABASE_URL=postgresql://user:pass@localhost:5432/horses`
3. Keep `USE_ONLINE_SERVER: false`
4. Run `node server.js` and open `client.html`

---

## Angle Conventions

**Root Rule: RADIANS everywhere, except UI display**

The game uses radians for all angle storage, computation, and networking. Degrees are only used when displaying angles to the user in the UI.

### Radians Used For
- **Storage**: Config values, network messages, database, chunk data
- **Computation**: `Math.sin()`, `Math.cos()`, `Math.atan2()`
- **THREE.js**: All `mesh.rotation.y` values, quaternions
- **Physics (Rapier)**: All rotation parameters
- **Movement**: Heading, direction vectors, turn rates
- **Structure rotations**: 0, π/2, π, 3π/2 (not 0°, 90°, 180°, 270°)

### Degrees Used For
- **UI display only**: When showing rotation values to the player in the interface

### Conversion (only for UI display)
```javascript
// Radians → Degrees (for UI display)
const displayDeg = radians * (180 / Math.PI);
```

### Reference Values
| Radians | Degrees | Constant |
|---------|---------|----------|
| 0 | 0° | |
| π/4 | 45° | `Math.PI / 4` |
| π/2 | 90° | `Math.PI / 2` |
| π | 180° | `Math.PI` |
| 3π/2 | 270° | `Math.PI * 1.5` |
| 2π | 360° | `Math.PI * 2` |

---

## Performance Notes

- Proximity detection runs ~500 times/sec
- Web Workers for terrain generation
- Instanced rendering for trees (TreeInstanceManager)
- Physics query caching
- Rate-limited broadcasts (100ms)

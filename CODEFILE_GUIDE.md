# Codefile Guide - Horses Game

**Last Updated:** 2026-01-05 | **Files:** 134 | **Lines:** ~86,000

---

## Maintaining This Guide

**When to update:**
- Added a new .js file
- Deleted or renamed a file
- Major refactor that changes a file's purpose
- Line count changed significantly (run `node generate-docs.js` to check)

### File Entry Format (copy this template)
```
### filename.js (~XXX lines)
Purpose description in one sentence.
- **Exports:** `ExportName1`, `ExportName2`
- **Interacts with:** other files it imports/uses
```

### Quick Reference Row Format
```
| **Feature Name** | `path/to/file.js`, `path/to/other.js` |
```

### After Making Changes
1. Update the file entry in the appropriate section
2. Update Quick Reference table if it's a primary file for a feature
3. Update the header line count: run `node generate-docs.js` and copy total
4. If adding new section, follow existing heading hierarchy

---

## Quick Reference: Where to Find Code

| Feature | Primary Files |
|---------|---------------|
| **Player Movement** | `public/player/PlayerController.js`, `public/core/InputManager.js` |
| **Inventory** | `public/ui/InventoryUI.js`, `public/ui/CrateInventoryUI.js`, `public/ui/InventoryTooltipUI.js` |
| **Building/Construction** | `public/systems/BuildingSystem.js`, `public/ui/BuildMenu.js` |
| **Combat** | `public/player/PlayerCombat.js`, `public/ai-enemy.js`, `public/ui/CombatHUD.js`, `public/ui/ThreatIndicator.js` |
| **Combat Effects** | `public/effects/MuzzleFlash.js`, `public/effects/DirtKickup.js`, `public/effects/GunSmokeParticleSystem.js` |
| **Crafting** | `public/systems/CraftingSystem.js` |
| **Resource Harvesting** | `public/systems/ResourceManager.js`, `public/systems/GrassGathering.js` |
| **Terrain Generation** | `public/terrainsystem.js`, `public/TerrainConfig.js`, `public/core/TerrainAccess.js` |
| **Dirt/Road Painting** | `public/systems/DirtOverlaySystem.js` (renders dirt patches under buildings/trees, road textures) |
| **Water/Waves** | `public/terrainsystem.js` |
| **Sky/Sun** | `public/world/SkyManager.js` |
| **3D Models/Objects** | `public/objects.js` |
| **Tree LOD System** | `public/BillboardSystem.js` |
| **Rock LOD System** | `public/RockModelSystem.js`, `public/BillboardSystem.js` |
| **Structure LOD System** | `public/systems/StructureModelSystem.js`, `public/BillboardSystem.js`, `public/systems/StructureCreationQueue.js` |
| **Networking (Server)** | `public/network/WebSocketTransport.js`, `public/network/MessageRouter.js` |
| **Networking (P2P)** | `public/network/P2PTransport.js`, `public/network/GameStateManager.js` |
| **AI Enemies (Bandits)** | `public/ai/AIController.js` (logic/authority), `public/ai-enemy.js` (visual), `public/ai/AISpawnQueue.js` (spawn stutter fix), `public/entity/AIEnemyManager.js` |
| **Brown Bears** | `public/ai/BrownBearController.js` (behavior), `public/entity/BrownBearManager.js` (spawning from dens) |
| **Deer** | `public/ai/DeerController.js` (behavior), `public/entity/DeerManager.js` (spawning) |
| **Baker NPCs** | `public/ai/BakerController.js` (worker behavior at bakeries) |
| **Gardener NPCs** | `public/ai/GardenerController.js` (worker behavior at gardener buildings) |
| **Woodcutter NPCs** | `public/ai/WoodcutterController.js` (worker behavior at woodcutter buildings) |
| **Miner NPCs** | `public/ai/MinerController.js` (mines rocks, delivers stone to market) |
| **StoneMason NPCs** | `public/ai/StoneMasonController.js` (chisels raw stone into finished stone) |
| **Blacksmith NPCs** | `public/ai/BlacksmithController.js` (produces parts from ironingot) |
| **IronWorker NPCs** | `public/ai/IronWorkerController.js` (processes iron ore at ironworks) |
| **TileWorker NPCs** | `public/ai/TileWorkerController.js` (processes clay into tiles) |
| **Fisherman NPCs** | `public/ai/FishermanController.js` (fishes in water, delivers cooked fish) |
| **Name Tags** | `public/entity/NameTagManager.js` |
| **Tick Sync** | `public/core/TickManager.js` (client), tick broadcast in `server.js`, persistence in `server/ChunkStore.js` |
| **Pathfinding** | `public/navigation/AStar.js`, `public/navigation/NavigationMap.js`, `public/navigation/NavigationWorkerClient.js`, `public/workers/NavigationWorker.js` |
| **Audio** | `public/audio.js` |
| **UI/HUD** | `public/ui.js`, `public/ui/*` |
| **Authentication** | `server/AuthManager.js`, `public/network/AuthClient.js` |
| **Ban Evasion Detection** | `public/network/FingerprintCollector.js`, `server/AuthManager.js` (fingerprint methods) |
| **Chunk Management** | `server/ChunkStore.js`, `public/world/ChunkManager.js` |
| **Game State** | `public/core/GameState.js` |
| **Physics** | `public/core/PhysicsManager.js` |
| **Config/Constants** | `public/config.js`, `server/ServerConfig.js` |
| **Food/Hunger** | `public/player/PlayerHunger.js`, `server/CookingSystem.js`, `public/systems/GrassGathering.js` |
| **Mobile Entities** | `public/systems/MobileEntitySystem.js` (boats, carts, horses piloting) |
| **Trapper NPCs** | `public/systems/TrapperSystem.js` (regional resource quality info) |

---

## Rules for AI Contributors

1. **Use existing systems** - Check this guide before implementing new systems
2. **Performance first** - This is a real-time multiplayer game
3. **No emojis** - Do not add emojis to in-game text
4. **Keep files under 2000 lines** - Split large files if needed
5. **Client-side preferred** - Only use server when necessary to reduce server load
6. **Document changes** - Update GAME_CONTEXT.md for significant changes

### Critical Sync Points (Client/Server MUST match)
- `CHUNK_SIZE`: 50
- Chunk coordinate format: `"chunk_X,Z"` (center-based)
- Terrain seed: 12345
- Chunk coordinate calculations
- Tool durability formula
- Action durations
- `FACTION_ZONES`: public/config.js ↔ server/AuthManager.js
- Bandit AI config: `SPAWN_RANGE: 50`, `LEASH_RANGE: 30`, `SHOOT_INTERVAL: 6000`, `FIRST_SHOT_DELAY: 3000`
- Deterministic random seed: `tentId + shotCount` hash

### Intentionally Different (Client vs Server)
- Client `LOAD_RADIUS`: 10 (21x21 = 441 chunks for visuals)
- Server `LOAD_RADIUS`: 2 (5x5 = 25 chunks for broadcasting)
- Client `PHYSICS_RADIUS`: 1 (3x3 = 9 chunks for physics/navigation)

---

## Architecture Overview

```
Client (Browser)                    Server (Node.js)
+------------------+               +------------------+
| Three.js Scene   |               | WebSocket Server |
| Rapier Physics   |<--WebSocket-->| ChunkManager     |
| WebRTC P2P       |               | MessageHandlers  |
| Game Systems     |               | PostgreSQL       |
+------------------+               +------------------+
```

**Networking Model:**
- **WebSocket**: Server connection for authoritative state (building, harvesting, auth)
- **WebRTC P2P**: Direct player-to-player for real-time sync (position, animations)

---

## Server Files (~8,600 lines)

### server.js (~860 lines)
Main entry point. Initializes WebSocket server on port 8080, creates all modular systems, registers message handlers. Routes client-triggered messages (decay, ship spawns) to handlers. Loads persisted tick on startup, saves every 60 ticks.
- **Interacts with:** All server modules

### server/AuthManager.js (~972 lines)
Player authentication, session management (7-day expiration), player data persistence. Dual-mode: PostgreSQL or local fallback.
- **Exports:** `AuthManager`
- **Interacts with:** DatabaseManager

### server/AuditLogger.js (~297 lines)
Tracks player actions for moderation/investigation. Buffered writes to PostgreSQL (online) or JSONL files (offline). Logs: structure add/remove, inventory access, market transactions, connections, harvesting.
- **Exports:** `AuditLogger`
- **Interacts with:** DatabaseManager

### server/AuditQuery.js (~350 lines)
CLI tool for querying audit logs from PostgreSQL. Filters by player, action type, chunk, time range. Output formats: summary, json, timeline. Includes suspicious activity detection.
- **Usage:** `node server/AuditQuery.js --player bob --hours 24 --format json`

### server/ChunkStore.js (~590 lines)
Chunk data persistence with caching, database fallback to JSON files. Also handles server state persistence (tick/version) for restart survival.
- **Exports:** `ChunkManager`
- **Key methods:** `loadServerState()`, `saveServerState(tick, version)`
- **Interacts with:** DatabaseManager, ServerConfig.js

### server/ServerChunkCoords.js (~168 lines)
Server-side chunk coordinate system. Center-based chunks (50x50). Must match client's `public/core/ChunkCoordinates.js`.
- **Exports:** `ChunkCoordinates`

### server/ServerConfig.js (~114 lines)
Server configuration: market items, chunk system, construction models, quality caps, ship trading.
- **Exports:** `CONFIG`

### server/CookingSystem.js (~409 lines)
Campfire cooking mechanics. Transforms: fish->cookedfish, vegetables->roastedvegetables, clay->tile.
- **Exports:** `CookingSystem`
- **Interacts with:** ChunkManager, MessageRouter

### server/DatabaseManager.js (~220 lines)
PostgreSQL connection manager with schema initialization. Creates tables: chunks, players, sessions, player_data, friends, server_state.
- **Exports:** `DatabaseManager`

### server/FriendsManager.js (~511 lines)
Friend requests, accept/decline, friends list with online status.
- **Exports:** `FriendsManager`

### server/BanditLootGenerator.js (~118 lines)
Pure functions for generating deterministic bandit loot in tents and campfires.
- **Exports:** `createSeededRNG`, `generateBanditTentLoot`, `generateBanditCampfireLoot`
- **Interacts with:** None (pure functions)

### server/MessageHandlers.js (~2,797 lines)
Core game logic dispatcher. Handles all client messages: chunk updates, structure placement, construction, repairs, inventory, player state. Also handles client-triggered decay (convert_to_ruin, remove_ruin) and ship spawns (trigger_dock_ship).
- **Exports:** `MessageHandlers`
- **Interacts with:** All server modules, SpawnTasks, BanditLootGenerator

### server/Broadcaster.js (~191 lines)
Pure message broadcasting layer. Chunk/proximity broadcasting, notification queue.
- **Exports:** `MessageRouter`

### server/SpawnerConfig.js (~44 lines)
AI spawning configuration for structures (tents, gardens).
- **Exports:** `SPAWNER_TYPES`

### server/SpawnTasks.js (~550 lines)
Handles on-demand spawning for Gardens/Apple Trees (spawn triggered when inventory opens based on tick count). Processes ship trading when triggered by client.
- **Exports:** `SpawnTasks`
- **Interacts with:** ChunkManager, MessageRouter, ChunkCoordinates, config.js

### server/StructureDecayUtils.js (~137 lines)
Utility functions for durability calculations (exponential decay formula).
- **Exports:** `getCurrentDurability`, `getHoursUntilRuin`, `clampQuality`, etc.

### server/TileworksSystem.js (~328 lines)
Tileworks clay-to-tile processing with firewood requirement.
- **Exports:** `TileworksSystem`

### server/IronworksSystem.js (~320 lines)
Ironworks iron-to-ironingot processing with firewood requirement. Iron can only be smelted here (not in campfire/house).
- **Exports:** `IronworksSystem`
- **Interacts with:** ChunkManager, MessageRouter

### server/FishermanSystem.js (~400 lines)
Fisherman fish-to-cookedfish processing with firewood requirement. Based on BakerySystem pattern.
- **Exports:** `FishermanSystem`
- **Interacts with:** ChunkManager, MessageRouter

### server/TimeTrackerService.js (~175 lines)
Centralized time-based event scheduler. 1-minute and 10-minute event buckets.
- **Exports:** `TimeTrackerService`

### server/BaseProcessingSystem.js (~485 lines)
Abstract base class for all structure processing systems (Bakery, Tileworks, Ironworks, Blacksmith, Fisherman). Provides tick-based item transformation with recipes.
- **Exports:** `BaseProcessingSystem`
- **Key methods:** `checkForProcessableItems()`, `startProcessingBatch()`, `completeProcessing()`, `cancelProcessing()`
- **Interacts with:** ChunkManager, MessageRouter, extended by all processing systems

### server/BakerySystem.js (~42 lines)
Bakery processing: apple -> appletart. Extends BaseProcessingSystem with food-specific durability calculation.
- **Exports:** `BakerySystem`
- **Config:** Duration 60 ticks, durability = quality/50 * 30
- **Interacts with:** BaseProcessingSystem

### server/BlacksmithSystem.js (~34 lines)
Blacksmith processing: ironingot -> parts. Extends BaseProcessingSystem for metal items.
- **Exports:** `BlacksmithSystem`
- **Config:** Duration 60 ticks, durability 100 (metal doesn't decay)
- **Interacts with:** BaseProcessingSystem

---

## Client: Core (public/core/) - ~4,081 lines

### GameState.js (~534 lines)
Central state container. Player data, chunk tracking, inventory (50 slots), UI state, spatial partitioning. Dual ID system: `clientId` (P2P) and `accountId` (auth). Roads stored in `roads` Map for persistence across chunk rebuilds.
- **Exports:** `GameState`

### PhysicsManager.js (~691 lines)
Rapier 3D physics wrapper. Collision detection, rigid bodies, character controllers, spatial queries.
- **Exports:** `PhysicsManager`, `COLLISION_GROUPS`


### GameInitializer.js (~931 lines)
Orchestrates complete game initialization sequence.
- **Exports:** `GameInitializer`

### PlayerModelSetup.js (~309 lines)
Loads player GLB model, configures animations (walk, chop, shoot), attaches rifle.
- **Exports:** `PlayerModelSetup`

### SceneManager.js (~307 lines)
Three.js scene initialization: camera, renderer, lighting, fog, skybox.
- **Exports:** `SceneManager`

### InputManager.js (~346 lines)
Unified input handling: mouse, keyboard, touch, raycasting.
- **Exports:** `InputManager`

### QualityGenerator.js (~193 lines)
Procedural chunk-based quality generation using deterministic seeding.
- **Exports:** `QualityGenerator`

### ChunkCoordinates.js (~169 lines)
Client-side chunk coordinate utilities.
- **Exports:** `ChunkCoordinates`

### CameraController.js (~234 lines)
Isometric camera following, zoom, rotation around player.
- **Exports:** `CameraController`

### TerrainAccess.js (~40 lines)
Global accessor for terrain generator instance. Allows any module to query terrain heights without needing a game reference.
- **Exports:** `setTerrainGenerator`, `getTerrainHeight`, `getTerrainGenerator`
- **Interacts with:** `terrainsystem.js` (TerrainGenerator)

### GameLoop.js (~116 lines)
Core frame-timing engine using requestAnimationFrame.
- **Exports:** `GameLoop`

### TickManager.js (~200 lines)
Deterministic tick synchronization for P2P simulation. Receives authoritative ticks from server, buffers player positions by tick, provides delayed positions for AI targeting.
- **Exports:** `TickManager`
- **Key methods:** `onServerTick()`, `getSimulationPositions()`, `hasSimulationData()`
- **Performance:** Map pooling to reduce GC pressure
- **Used by:** `BanditController.js` for deterministic AI

---

## Client: Network (public/network/) - ~5,476 lines

### MessageRouter.js (~2,006 lines)
Centralized routing of all server messages. Handles objects, structures, resources, auth, WebRTC signaling. Object creation delegated to SceneObjectFactory. Also handles client-side structure decay checking and triggers ruin conversion.
- **Exports:** `MessageRouter`
- **Interacts with:** game.js, GameStateManager, NetworkManager, SceneObjectFactory

### SceneObjectFactory.js (~903 lines)
Creates 3D objects in scene from server data. Handles trees, structures, billboards, physics colliders, smoke effects.
- **Exports:** `SceneObjectFactory`
- **Interacts with:** game systems, Three.js scene, PhysicsManager, objectPlacer

### GameStateManager.js (~1,131 lines)
Translates P2P messages into game state changes (player movement, AI updates, combat).
- **Exports:** `GameStateManager`

### NetworkManager.js (~476 lines)
Central hub for all networking: WebSocket, P2P, message queuing.
- **Exports:** `NetworkManager`

### AuthClient.js (~330 lines)
Client-side authentication: register, login, logout, session validation. Collects hardware fingerprint on auth requests for ban evasion detection.
- **Exports:** `AuthClient`
- **Interacts with:** FingerprintCollector, NetworkManager

### FingerprintCollector.js (~165 lines)
Hardware fingerprinting for ban evasion detection. Collects WebGL, canvas, screen, and hardware signals. Only runs at login, not during gameplay.
- **Exports:** `FingerprintCollector`
- **Key methods:** `collect()`, `getHash()`, `getPartialHashes()`
- **Used by:** AuthClient.js

### P2PTransport.js (~283 lines)
WebRTC connection management for peer-to-peer data channels.
- **Exports:** `P2PTransport`

### WebSocketTransport.js (~257 lines)
WebSocket connection management with auto-reconnection.
- **Exports:** `WebSocketTransport`

### MessageQueue.js (~70 lines)
Message buffering between reception and processing.
- **Exports:** `MessageQueue`

### EventEmitter.js (~56 lines)
Simple pub/sub event emitter.
- **Exports:** `EventEmitter`

---

## Client: Systems (public/systems/) - ~8,696 lines

### ResourceManager.js (~800 lines)
Resource harvesting (firewood/planks/stone), tool durability, fishing, log spawning.
- **Exports:** `ResourceManager`

### ChunkObjectGenerator.js (~668 lines)
Frame-budgeted procedural generation. Spreads object placement across frames.
- **Exports:** `ChunkObjectGenerator`, `DirtPaintingQueue`

### ActionManager.js (~516 lines)
Orchestrates all timed player actions (chopping, building, demolishing) with progress tracking.
- **Exports:** `ActionManager`

### GrassGathering.js (~506 lines)
Grass terrain detection, gathering for grass/mushrooms/vegetables.
- **Exports:** `GrassGathering`

### CraftingSystem.js (~474 lines)
Item crafting: chiseling, tool durability, item combining (grass->rope->fishingnet).
- **Exports:** `CraftingSystem`

### BuildingSystem.js (~472 lines)
Construction site mechanics: hammer durability, material tracking, build execution.
- **Exports:** `BuildingSystem`

### DockMerchantSystem.js (~461 lines)
Spawns/animates merchant NPCs at docks.
- **Exports:** `DockMerchantSystem`

### InteractionManager.js (~461 lines)
Fast proximity detection using physics spatial queries. O(1) object lookups.
- **Exports:** `InteractionManager`

### ScheduledShipSystem.js (~480 lines)
Deterministic ship schedules at docks with multi-phase movement. Client-triggered ship spawns (checks every 60 ticks, triggers server after 30 minutes).
- **Exports:** `ScheduledShipSystem`, `PHASE`

### DeathManager.js (~355 lines)
Player/AI death sequences: animation, cleanup, state reset, respawn.
- **Exports:** `DeathManager`

### AmbientSoundSystem.js (~289 lines)
Environmental audio based on player position (ocean/plains/mountain/campfire).
- **Exports:** `AmbientSoundSystem`

### EffectManager.js (~403 lines)
Visual particle effects (smoke) for campfires, houses, tileworks. Manages centralized SmokeParticleSystem for instanced smoke rendering.
- **Exports:** `EffectManager`
- **Interacts with:** `SmokeParticleSystem`, `SmokeEffect`

### SmokeParticleSystem.js (~320 lines)
Centralized instanced smoke particle renderer. Uses single InstancedMesh with GPU billboarding for all smoke effects. Includes LOD system (0-50-100 unit thresholds).
- **Exports:** `SmokeParticleSystem`
- **Performance:** Single draw call for all smoke particles (vs 800-1200 previously)

### AnimationSystem.js (~121 lines)
Wave animation and ship rocking motion.
- **Exports:** `AnimationSystem`

### MobileEntitySystem.js (~230 lines)
Handles pilotable/rideable entities (boats, carts, horses). Manages proximity detection, occupancy tracking, movement physics, and disembark validation.
- **Exports:** `MobileEntitySystem`
- **Interacts with:** `GameState.mobileEntityState`, `TerrainAccess`, P2P network

### DirtOverlaySystem.js (~250 lines)
Manages a canvas-based texture overlay to paint dirt patches under structures and trees, and render road textures onto the terrain shader.
- **Exports:** `DirtOverlaySystem`
- **Interacts with:** `GeometryClipmap` (updates shader uniforms)

### TrapperSystem.js (~370 lines)
Manages Trapper NPCs that provide regional resource quality information. One trapper tent + NPC spawns per chunk.
- **Exports:** `TrapperSystem`, `TRAPPER_CONSTANTS`, `RESOURCE_TYPES`, `RESOURCE_DISPLAY_NAMES`
- **Interacts with:** `QualityGenerator`, `modelManager`, `terrainGenerator`

### StructureCreationQueue.js (~200 lines)
Frame-budgeted queue for structure creation. Spreads bandit camp structure spawning across frames to prevent stutter.
- **Exports:** `StructureCreationQueue`, `getStructureCreationQueue`
- **Pattern:** Singleton with priority sorting (based on AISpawnQueue.js)

### ChunkTransitionQueue.js (~260 lines)
Frame-budgeted queue for chunk border crossing operations. Spreads expensive scene adds/removes, physics collider updates, and nav map updates across frames to prevent stuttering when crossing chunk boundaries.
- **Exports:** `ChunkTransitionQueue`, `getChunkTransitionQueue`, `PRIORITY`, `TASK_TYPE`
- **Pattern:** Singleton with priority queues and generation-based invalidation for rapid back-and-forth movement
- **Interacts with:** `game.js` (called from game loop), `ChunkManager.js` (chunk disposal cleanup)

### StructureModelSystem.js (~200 lines)
LOD system for structures (tent, outpost, campfire, horse). Manages visibility of 3D models based on camera distance.
- **Exports:** `StructureModelSystem`
- **Interacts with:** `BillboardSystem` (coordinates LOD transitions)

### FallingTreeSystem.js (~220 lines)
Manages falling tree animations when pine/apple trees are cut down. 2-phase animation: rotation (0-1s) and sinking (1-2s).
- **Exports:** `FallingTreeSystem`
- **Key methods:** `spawnFallingTree()`, `update()`, `removeFallingTree()`
- **Interacts with:** Three.js scene, BillboardSystem

---

## Client: UI (public/ui/) - ~9,758 lines

### InventoryUI.js (~2,358 lines)
Complete inventory system: drag-and-drop, backpack/crate, chisel targeting, item combining.
- **Exports:** `InventoryUI`
- Delegates to CrateInventoryUI, InventoryTooltipUI

### CrateInventoryUI.js (~900 lines)
Crate/structure inventory rendering: crate section display, progress bars for cooking/processing.
- **Exports:** `CrateInventoryUI`

### InventoryTooltipUI.js (~147 lines)
Item tooltip system: quality/durability display, market pricing breakdown.
- **Exports:** `InventoryTooltipUI`

### BuildMenu.js (~1,359 lines)
Build menu for structures. Placement workflow: position -> rotation -> confirm.
- **Exports:** `BuildMenu`

### MarketUI.js (~892 lines)
Market trading UI: buy/sell dialogs, price calculations with quality/durability modifiers.
- **Exports:** `MarketUI`

### LoginModal.js (~707 lines)
Login/registration modal with guest play and account upgrade.
- **Exports:** `LoginModal`

### SpawnScreen.js (~531 lines)
Post-auth spawn selection: home/random/friend spawn options.
- **Exports:** `SpawnScreen`

### FriendsPanel.js (~407 lines)
Friend management: add, accept/decline requests, remove.
- **Exports:** `FriendsPanel`

### TasksPanel.js (~345 lines)
Beginner tutorial task tracker (14 sequential tasks).
- **Exports:** `TasksPanel`

### FactionPanel.js (~271 lines)
Faction selection with territory info and cooldown.
- **Exports:** `FactionPanel`

### SettingsPanel.js (~160 lines)
Settings menu with volume control and access to Friends/Faction panels.
- **Exports:** `SettingsPanel`
- **Interacts with:** AudioManager, FriendsPanel, FactionPanel

### InventoryHelpers.js (~170 lines)
Pure utility functions for inventory logic.
- **Exports:** `isPlankType`, `getTotalPlankQuantity`, `formatMaterialName`, etc.

### ConstructionUI.js (~168 lines)
Construction site material display.
- **Exports:** `ConstructionUI`

### LoadingScreen.js (~137 lines)
Multi-phase loading overlay.
- **Exports:** `LoadingScreen`

### GridUIHelpers.js (~124 lines)
Grid-based UI calculations.
- **Exports:** `GridUIHelpers`, `TooltipHelper`

### DeathScreen.js (~92 lines)
Death overlay with respawn countdown.
- **Exports:** `DeathScreen`

### ThreatIndicator.js (~192 lines)
Red screen-edge glow pointing toward nearest enemy during combat. Uses screen-space projection.
- **Exports:** `ThreatIndicator`

### CombatHUD.js (~276 lines)
Top-center combat stats display: "ENEMIES NEARBY" warning, accuracy %, range status.
- **Exports:** `CombatHUD`

### ControlsTutorial.js (~117 lines)
Tutorial overlay showing game controls to new players.
- **Exports:** `ControlsTutorial`

---

## Client: Player (public/player/) - ~2,516 lines

### PlayerController.js (~687 lines)
Player movement, position interpolation, collision, dock/water detection, climbing.
- **Exports:** `PlayerController`

### PlayerCombat.js (~719 lines)
Combat mechanics: targeting, shooting, hit chances (height advantage), death animations.
- **Exports:** `PlayerCombat`

### PlayerActions.js (~388 lines)
Player actions (harvesting, building, chiseling) with cooldowns.
- **Exports:** `PlayerActions`

### PlayerInventory.js (~331 lines)
Grid-based inventory: item placement, rotation, coins, durability.
- **Exports:** `PlayerInventory`

### PlayerHunger.js (~287 lines)
Hunger system: food variety bonuses, starvation (death after 6 minutes).
- **Exports:** `PlayerHunger`

---

## Client: Entity (public/entity/) - ~2,106 lines

### AvatarManager.js (~733 lines)
Peer player avatars: animations, death, LOD optimization.
- **Exports:** `AvatarManager`

### AIEnemyManager.js (~443 lines)
AI enemy spawning from tents, lifecycle management.
- **Exports:** `AIEnemyManager`

### DeathSystem.js (~125 lines)
Death animations for all entities.
- **Exports:** `DeathSystem`

### BrownBearManager.js
Brown bear entity spawning and lifecycle management. Spawns bears from bearden structures.
- **Exports:** `BrownBearManager`
- **Interacts with:** BrownBearController, structure system

### DeerManager.js (~240 lines)
Deer entity spawning and lifecycle management.
- **Exports:** `DeerManager`
- **Interacts with:** DeerController, AIEnemyManager patterns

### NameTagManager.js (~281 lines)
Floating name tags above player avatars.
- **Exports:** `NameTagManager`
- **Interacts with:** AvatarManager, Three.js sprites

---

## Client: AI System (public/ai/) - ~15,000 lines

Authority-based AI with P2P state synchronization. One client simulates each AI; others interpolate.

**Architecture:**
```
Combat AI:
  AIController (behavior) --> AIEnemy (visual)
  BrownBearController (behavior) --> BrownBearManager (visual)
  DeerController (behavior) --> DeerManager (visual)

Worker NPCs:
  BaseWorkerController (shared base) --> WoodcutterController
                                     --> BakerController
                                     --> GardenerController
                                     --> MinerController
                                     --> StoneMasonController
                                     --> BlacksmithController
                                     --> IronWorkerController
                                     --> TileWorkerController
                                     --> FishermanController
```

### AIController.js (~1,800 lines)
Authority-based distributed AI with deterministic multiplayer sync. One client (lowest clientId) simulates each bandit; others interpolate.
- **Exports:** `AIController`, `BanditController` (alias)
- **State Machine:** `idle` → `chasing` → `leashed` → `returning` → `dead`
- **P2P Messages:** `bandit_spawn`, `bandit_state`, `bandit_shoot`, `bandit_death`, `bandit_kill_ack`, `bandit_sync`
- **Key methods:** `checkSpawnsOnTick()`, `_updateEntity()`, `_tryShoot()`, `broadcastAuthorityState()`
- **Interacts with:** TickManager (deterministic positions), NavigationManager (pathfinding), AIEnemyManager (visuals)

### BrownBearController.js (~800 lines)
Authority-based brown bear AI with aggressive/fleeing behavior. Spawns from bearden structures.
- **Exports:** `BrownBearController`
- **State Machine:** idle ↔ wandering ↔ fleeing ↔ chasing → attacking → dead
- **Behavior:** Flees from structures, chases players in wilderness, wanders when idle
- **Interacts with:** BrownBearManager, NavigationManager, TickManager

### DeerController.js (~1,219 lines)
Authority-based deer AI with passive/fleeing behavior.
- **Exports:** `DeerController`
- **State Machine:** idle ↔ wandering ↔ fleeing → dead
- **Behavior:** Wanders when idle, flees from players, can be hunted
- **Interacts with:** DeerManager, NavigationManager, TickManager

### AISpawnQueue.js (~220 lines)
Spawn queue system to prevent frame stutter when multiple AI entities spawn.
- **Exports:** `getAISpawnQueue`, `AISpawnQueue`
- **Purpose:** Queues spawn requests and processes one per frame to spread expensive SkeletonUtils.clone() and physics setup across multiple frames
- **Priority:** bandits (3) > brownbears (2) > deer (1) > workers (0)
- **Interacts with:** AIController, DeerController, BrownBearController, game.js (processQueue in game loop)

### BaseWorkerController.js (~1,600 lines)
Abstract base class for worker NPCs (woodcutter, baker, gardener). Provides shared infrastructure.
- **Exports:** `BaseWorkerController`
- **Pattern:** Template Method - subclasses implement `_getMovementTarget()`, `_onArrival()`, `_handleIdleState()`, `_decideNextTask()`
- **Handles:** P2P authority, movement along paths, pathfinding, animations, stuck recovery
- **Config defaults:** MOVE_SPEED (0.8), PATHFIND_INTERVAL (6s), STUCK_TIMEOUT (60s), BROADCAST_INTERVAL (1s)
- **Interacts with:** NavigationManager, ChunkManager, P2P network

### WoodcutterController.js (~950 lines)
Woodcutter NPC behavior. Spawns at woodcutter buildings.
- **Exports:** `WoodcutterController`
- **State Machine:** idle → seeking_tree → cutting_tree → seeking_log → processing_log → delivering → depositing → returning
- **Behavior:** Find pine tree → Cut (10s) → Process log (5 harvests) → Deliver to market → Return
- **Config:** TREE_SEARCH_RADIUS (50), INTERACTION_RANGE (5), HARVEST_ORDER (firewood, plank, firewood, plank, firewood)
- **Interacts with:** BaseWorkerController, ChunkManager (tree/log lookup)

### BakerController.js (~700 lines)
Baker NPC behavior. Spawns at bakery buildings.
- **Exports:** `BakerController`
- **State Machine:** idle → seeking_grain → processing → delivering → depositing → returning
- **Behavior:** Collect grain from gardens → Process into bread → Deliver to market → Return
- **Interacts with:** BaseWorkerController, server (baking requests)

### GardenerController.js (~1,100 lines)
Gardener NPC behavior. Spawns at gardener buildings.
- **Exports:** `GardenerController`
- **State Machine:** idle → seeking_plant_spot → planting → waiting_for_harvest → seeking_harvest → harvesting → delivering → depositing → returning → seeking_tree_spot → planting_tree
- **Behavior:** Plant vegetables (23 slots, US flag pattern) → Wait 30 min → Harvest FIFO → Deliver → Plant trees during downtime
- **Config:** ROW_SPACING (0.75), COL_SPACING (0.75), FIELD_DEPTH (3.0), TREE_PINE_CHANCE (0.8)
- **Interacts with:** BaseWorkerController, server (plant/harvest requests)

### MinerController.js (~718 lines)
Miner NPC behavior. Spawns at miner buildings.
- **Exports:** `MinerController`, `minerController`, `MINER_STATE`
- **State Machine:** idle → seeking_rock → mining → delivering → depositing → returning → stuck
- **Behavior:** Find rock (50-unit radius) → Mine 5 times (10s each) → Deliver stone to market → Return
- **Interacts with:** BaseWorkerController, ChunkManager (rock lookup), audioManager (pickaxe sounds)

### StoneMasonController.js (~566 lines)
StoneMason NPC behavior. Spawns at stonemason buildings.
- **Exports:** `StoneMasonController`, `stoneMasonController`, `STONEMASON_STATE`
- **State Machine:** idle → going_to_market → collecting → returning → chiseling → delivering → depositing → stuck
- **Behavior:** Collect raw stone (5) from market → Chisel each (6s) → Deliver chiseled stone → Return
- **Interacts with:** BaseWorkerController, CraftingSystem (stone conversion)

### BlacksmithController.js (~703 lines)
Blacksmith NPC behavior. Spawns at blacksmith buildings.
- **Exports:** `BlacksmithController`, `blacksmithController`, `BLACKSMITH_STATE`
- **State Machine:** 18 states including assessment, collection, depositing, waiting, excess firewood handling
- **Behavior:** Collect ironingot (5) + firewood (1) from market → Deposit → Wait 62 ticks → Collect parts → Deliver to market
- **Interacts with:** BaseWorkerController, server (deposit/collect/processing messages)

### IronWorkerController.js (~696 lines)
IronWorker NPC behavior. Spawns at ironworks buildings.
- **Exports:** `IronWorkerController`, `ironWorkerController`, `IRONWORKER_STATE`
- **State Machine:** 18 states (matches BlacksmithController pattern)
- **Behavior:** Collect iron (5) + firewood (1) from market → Deposit → Wait 62 ticks → Collect ironingot → Deliver to market
- **Interacts with:** BaseWorkerController, server (deposit/collect/processing messages)

### TileWorkerController.js (~696 lines)
TileWorker NPC behavior. Spawns at tileworks buildings.
- **Exports:** `TileWorkerController`, `tileWorkerController`, `TILEWORKER_STATE`
- **State Machine:** 18 states (matches BlacksmithController pattern)
- **Behavior:** Collect clay (5) + firewood (1) from market → Deposit → Wait 62 ticks → Collect tiles → Deliver to market
- **Interacts with:** BaseWorkerController, server (deposit/collect/processing messages)

### FishermanController.js (~749 lines)
Fisherman NPC behavior. Spawns at fisherman buildings.
- **Exports:** `FishermanController`, `fishermanController`, `FISHERMAN_STATE`
- **State Machine:** 15 states - assessment, seeking_water, fishing, collecting firewood, waiting, delivery
- **Behavior:** Find water (Y<0) → Fish 8 times (10s each) → Collect firewood → Process → Deliver cooked fish
- **Interacts with:** BaseWorkerController, QualityGenerator (fish quality), server (processing messages)

### AIRegistry.js (~100 lines)
Central registry for AI controller instances.
- **Exports:** `AIRegistry`
- **Purpose:** Allows lookup of AI entities across controller types

### BaseAIController.js (~200 lines)
Base class for all AI controllers with common utilities.
- **Exports:** `BaseAIController`
- **Provides:** Common config access, chunk coordinate utilities

---

## Client: Navigation (public/navigation/) - ~2,680 lines

### NavigationMap.js (~1,550 lines)
Per-chunk navigation grid: walkability, surface types, movement costs.
- **Exports:** `NavigationMap`, `NAV_FLAGS`, `SURFACE_TYPE`, `MOVEMENT_SPEED`

### NavigationManager.js (~559 lines)
Coordinates navigation across chunks.
- **Exports:** `NavigationManager`

### AStar.js (~444 lines)
A* pathfinding with MinHeap optimization.
- **Exports:** `AStar`

### NavigationWorkerClient.js (~112 lines)
Client interface for pathfinding Web Worker. Handles message passing and promise-based async path requests.
- **Exports:** `NavigationWorkerClient`, `getNavigationWorker`, `initializeNavigationWorker`
- **Key methods:** `registerChunk()`, `unregisterChunk()`, `findPath()`
- **Interacts with:** `public/workers/NavigationWorker.js`

---

## Client: Workers (public/workers/) - ~508 lines

### NavigationWorker.js (~508 lines)
Web Worker for off-main-thread A* pathfinding with JPS (Jump Point Search) optimization.
- **Exports:** None (communicates via messages)
- **Messages:** `register_chunk`, `unregister_chunk`, `find_path` → `path_result`
- **Config:** CELL_SIZE (0.25), MAX_POOL_SIZE (500)
- **Features:** Node object pooling, chunk grid management, waypoint path reconstruction

---

## Client: World (public/world/) - ~1,894 lines

### StructureManager.js (~642 lines)
Structure placement validation, collision detection, dock positioning.
- **Exports:** `StructureManager`

### SkyManager.js (~160 lines)
Three.js Sky-based atmosphere with sun position control and PMREM environment reflections.
- **Exports:** `SkyManager`

### SkyboxManager.js (~423 lines) [LEGACY]
Old skybox rendering: cube maps and gradient skyboxes.
- **Exports:** `SkyboxManager`

### ChunkManager.js (~388 lines)
Client-side chunk loading/unloading, object lifecycle.
- **Exports:** `ChunkManager`

---

## Client: Spawn (public/spawn/) - ~105 lines

### SpawnUtils.js (~105 lines)
Utility functions for finding valid spawn points using TerrainGenerator.
- **Exports:** `findValidSpawnPoint`, `findValidSpawnNearStructure`

---

## Client: Effects (public/effects/) - ~654 lines

### MuzzleFlash.js (~179 lines)
Sprite-based muzzle flash for rifles. Shared procedural texture, attaches to rifle barrel.
- **Exports:** `MuzzleFlash`
- **Used by:** `ai-enemy.js`, `PlayerModelSetup.js`

### DirtKickup.js (~179 lines)
Particle burst for bullet miss impacts. Scatters directionally away from shooter position.
- **Exports:** `DirtKickup`, `spawnMissEffect`
- **Used by:** `EffectManager.js`

### GunSmokeParticleSystem.js (~296 lines)
Instanced particle system for gun smoke effects. Single InstancedMesh with GPU billboarding for efficient rendering.
- **Exports:** `GunSmokeParticleSystem`
- **Key methods:** `spawnBurst()`, `spawnParticle()`, `update()`
- **Features:** Stack-based slot allocation (O(1)), max 100 instances, custom billboard shader
- **Used by:** `EffectManager.js`

---

## Client: Root Public Files - ~16,700 lines

### terrainsystem.js (~3,391 lines)
**NEW PRIMARY TERRAIN/WATER SYSTEM.** Modular clipmap-based terrain with integrated Gerstner wave water. Features geometry clipmaps for LOD, triplanar procedural texturing, depth-based water rendering, and shore foam effects.
- **Exports:** `TERRAIN_CONFIG`, `wrapCoord`, `SHADERS`, `TerrainGenerator`, `SeamMesh`, `ClipmapLevel`, `GeometryClipmap`, `DepthTextureSystem`, `WaterSystem`
- **Key classes:**
  - `GeometryClipmap`: Main clipmap terrain renderer with 6 LOD levels
  - `TerrainGenerator`: Procedural height/normal generation with continent system
  - `DepthTextureSystem`: Renders terrain depth for water transparency
  - `WaterSystem`: Chunk-based Gerstner wave water with foam and reflections
- **Interacts with:** Three.js, lil-gui (dev only)

### TerrainConfig.js (~60 lines)
Terrain configuration constants and RNG utilities.
- **Exports:** `CONFIG`, `Utilities`

### game.js (~3,074 lines)
**MAIN ENTRY POINT.** Coordinates initialization, player controls, networking, chunk management.
- **Interacts with:** Everything

### objects.js (~1,405 lines)
3D model loading/placement, terrain object generation. Uses `generateChunkObjectsBatch` for frame-budgeting to spread object placement across multiple frames and prevent lag spikes.
- **Exports:** `generateChunkObjects`, `objectPlacer`, `modelManager`

### audio.js (~1,136 lines)
3D positional audio, environmental biome sounds.
- **Exports:** `AudioManager`, `OceanSoundManager`, etc.

### ui.js (~1,796 lines)
DOM management, UI event handlers, status displays.
- **Exports:** `ui`

### ai-enemy.js (~385 lines)
AI enemy visual controller. Handles model setup, animations, death effects. Behavior logic is managed by BanditController.
- **Exports:** `AIEnemy`
- **Key methods:** `update()` (animation only), `playShootAnimation()`, `kill()`, `dispose()`
- **Interacts with:** BanditController (receives state via `moving`, `inCombatStance` properties)

### config.js (~761 lines)
**ALL GAME CONSTANTS.** Inventory, UI, combat, gameplay balance.
- **Exports:** `CONFIG`, `COMPUTED`

### RockModelSystem.js (~420 lines)
Instanced 3D rock models (limestone, sandstone, clay, iron) with distance-based LOD fading. Uses DRACO-compressed GLB models with per-instance opacity via shader injection. Spatial partitioning by chunk for efficient LOD updates.
- **Exports:** `RockModelSystem`
- **LOD:** 0-25 full opacity, 25-35 fade out, 35+ hidden (billboard takes over)
- **Rock types:** limestone, sandstone, clay, iron
- **Interacts with:** BillboardSystem (distance-based LOD handoff)

### BillboardSystem.js (~590 lines)
Instanced rotating billboards for far distance (trees and rocks). Camera-facing cylindrical billboarding with per-instance opacity. Spatial partitioning by chunk for efficient updates.
- **Exports:** `BillboardSystem`
- **LOD:** Pine/apple/rocks: 25-35 fade in, 35+ full. Other trees: 20-25 fade in, 25+ full.
- **Types:** oak, fir, pine, cypress, apple, vegetables, limestone, sandstone, clay, iron
- **Interacts with:** RockModelSystem (receives objects at far distances)

### TreeGUI.js (~533 lines)
Debug GUI controls for tree billboard and rock model parameters using lil-gui. Controls scale, y-offset, and brightness for billboards and rock models.
- **Exports:** `TreeGUI`
- **Interacts with:** BillboardSystem, RockModelSystem, lil-gui

### SmokeEffect.js (~111 lines)
Lightweight smoke effect controller. Manages spawn timing and LOD, delegates rendering to SmokeParticleSystem.
- **Exports:** `SmokeEffect`
- **Interacts with:** `SmokeParticleSystem`

### visualize-navigation.js (~184 lines)
Debug utility for navigation grid visualization.

### client.html (~1,910 lines)
Main HTML entry point with embedded styles.

---

## Common Patterns

### Adding a New Item
1. Add to `public/config.js` item definitions
2. Add sprite to `public/items/`
3. Update `InventoryHelpers.js` if special handling needed
4. Add crafting recipe to `CraftingSystem.js` if craftable

### Adding a New Structure
1. Add to `server/config.js` CONSTRUCTION_MODELS
2. Add GLB model to `public/models/`
3. Add to `public/ui/BuildMenu.js` structure list
4. Update `server/MessageHandlers.js` for special behavior

### Adding Server Message Handler
1. Add handler in `server/MessageHandlers.js`
2. Register in `server.js` message handlers
3. Add client handler in `public/network/MessageRouter.js`

### Adding/Modifying AI Behavior
1. Config in `public/config.js` under `BANDIT_CAMPS` and `AI_CONFIG` in AIController.js
2. State machine in `AIController._updateEntity()`
3. Combat logic in `AIController._tryShoot()` (deterministic random required)
4. P2P sync: authority broadcasts via `broadcastAuthorityState()`, non-authority handles via `handleStateMessage()`
5. Visual controller in `ai-enemy.js` (receives `moving`, `inCombatStance` from AIController)

### Modifying Player Behavior
1. Check `public/player/PlayerController.js` for movement
2. Check `public/player/PlayerActions.js` for action cooldowns
3. Check `public/systems/ActionManager.js` for timed actions

### Working with Chunks
- World position to chunk: `ChunkCoordinates.worldToChunk(x, z)`
- Chunk size: 50 units (center-based: chunk 0,0 spans -25 to +25)
- Client load radius: 10 (21x21 = 441 chunks visible)
- Physics/navigation radius: 1 (3x3 = 9 chunks)
- Server broadcast radius: 2 (5x5 = 25 chunks)
- Disposal: queued, 4 chunks every 4 seconds

---

## Performance Guidelines

1. **Use squared distances** - Avoid `Math.sqrt()` in hot paths
2. **Object pooling** - Reuse THREE.Vector3 instances
3. **Frame budgeting** - Use `ChunkObjectGenerator` pattern for heavy work
4. **LOD systems** - RockModelSystem for close 3D rocks; BillboardSystem for distant trees/rocks
5. **Spatial queries** - Use PhysicsManager for proximity, not iteration
6. **Rate limiting** - Network broadcasts limited to 100ms intervals

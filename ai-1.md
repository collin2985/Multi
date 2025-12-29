# AI Implementation Guide v2

> **Note for AI Assistants:** This codebase also contains `BrownBearController.js` and `DeerController.js` (~1,219 lines) which implement melee predator and passive prey AI respectively. However, this guide uses **only the bandit code** (`AIController.js`) as the reference example. Do not use bear or deer code as references when following this guide.

This guide walks through implementing a new AI type using the bandit system as the template. Each step includes the exact code to copy and questions to determine what changes are needed.

**How to use this guide:**
1. Read each step completely before making changes
2. Answer the questions to determine if modifications are needed
3. Copy the code blocks, making only the changes identified by your answers
4. Test after each major phase before proceeding

---

## Table of Contents

### Overview
- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Quick Start: Choosing Your Path](#quick-start-choosing-your-path)

### Phase 1: Setup
- [Step 1: Configuration Constants](#step-1-configuration-constants)
- [Step 2: GameState Registration](#step-2-gamestate-registration)

### Phase 2: Core AI Logic
- [Step 3: Controller Class Skeleton](#step-3-controller-class-skeleton)
- [Step 4: Entity Data Structure](#step-4-entity-data-structure)
- [Step 5: State Machine](#step-5-state-machine)
- [Step 6: Spawn Logic](#step-6-spawn-logic)
- [Step 7: Movement & Pathfinding](#step-7-movement--pathfinding)
- [Step 8: Combat Logic](#step-8-combat-logic)
- [Step 9: Authority System](#step-9-authority-system)

### Phase 3: Visual Layer
- [Step 10: Visual Controller](#step-10-visual-controller)
- [Step 11: Entity Manager](#step-11-entity-manager)

### Phase 4: Game Integration
- [Step 12: P2P Message Handlers](#step-12-p2p-message-handlers)
- [Step 13: Game Initialization](#step-13-game-initialization)
- [Step 14: Game Loop Integration](#step-14-game-loop-integration)
- [Step 15: Combat Hit Detection](#step-15-combat-hit-detection)

### Phase 5: World Integration
- [Step 16: Procedural Structure Generation](#step-16-procedural-structure-generation)
- [Step 17: Structure Factory Registration](#step-17-structure-factory-registration)
- [Step 18: Chunk Lifecycle Management](#step-18-chunk-lifecycle-management)

### Phase 6: Polish (Optional)
- [Step 19: UI & Feedback](#step-19-ui--feedback)
- [Step 20: Loot Generation](#step-20-loot-generation)

### Phase 7: Optimization
- [Step 21: TickManager Integration](#step-21-tickmanager-integration)
- [Step 22: Performance Optimizations](#step-22-performance-optimizations)

### Reference
- [Testing Checklist](#testing-checklist)
- [File Changes Summary](#file-changes-summary)
- [P2P Message Types](#p2p-message-types)

---

## Architecture Overview

The AI system uses a **two-layer architecture**:

```
+-------------------------------------------------------------+
|                    AI CONTROLLER                             |
|  (Behavior: spawning, pathfinding, combat, state machine)   |
|  File: public/ai/[YourAI]Controller.js                      |
+-------------------------------------------------------------+
                              |
                              | sets properties:
                              | - moving (boolean)
                              | - inCombatStance (boolean)
                              | - speedMultiplier (number)
                              v
+-------------------------------------------------------------+
|                    VISUAL CONTROLLER                         |
|  (Visuals: model, animations, effects, death)               |
|  File: public/ai-enemy.js (or new file)                     |
+-------------------------------------------------------------+
```

**Authority-Based P2P Model:**
- One client (lowest clientId near the AI's home) runs the full simulation
- Other clients receive state updates and interpolate positions
- Authority transfers automatically when players move or disconnect

**Key Files That Will Be Modified/Created:**

| File | Lines | Purpose |
|------|-------|---------|
| `public/config.js` | - | Add AI configuration constants |
| `public/core/GameState.js` | - | Add structure tracking Map |
| `public/ai/[Name]Controller.js` | **NEW** | AI behavior logic (see AIController.js ~1,885 lines) |
| `public/ai/AIRegistry.js` | ~206 | Register controller for cross-AI queries |
| `public/ai/BaseAIController.js` | ~406 | Base class to extend (optional) |
| `public/[name]-visual.js` | **NEW** | Visual controller (or reuse `ai-enemy.js` ~398 lines) |
| `public/entity/[Name]Manager.js` | **NEW** | Entity lifecycle management (see AIEnemyManager.js ~443 lines) |
| `public/network/GameStateManager.js` | - | Add P2P message handlers |
| `public/network/SceneObjectFactory.js` | - | Register structures with `is[YourAI]Structure` flag |
| `public/core/GameInitializer.js` | - | Initialize the controller |
| `public/core/TickManager.js` | ~205 | Deterministic position sync for AI targeting |
| `public/game.js` | - | Add to update loop |
| `public/systems/ChunkObjectGenerator.js` | - | Procedural structure placement |
| `public/spawn/SpawnUtils.js` | - | Prevent player respawn near AI |
| `public/world/ChunkManager.js` | - | Cleanup on chunk unload |
| `public/ui/CombatHUD.js` | - | Show "[AI] NEARBY" warning |
| `public/systems/TrapperSystem.js` | - | Add AI type to RESOURCE_TYPES and RESOURCE_DISPLAY_NAMES |
| `public/navigation/NavigationMap.js` | - | Register obstacles for pathfinding |
| `server/[YourAI]LootGenerator.js` | **NEW** | (optional) Deterministic loot |
| `server/MessageHandlers.js` | - | Handle structure placement with loot |

**AIController.js Key Sections (Line References):**

| Section | Lines | Description |
|---------|-------|-------------|
| Configuration Constants | 24-54 | `AI_CONFIG.BANDIT` settings |
| Class Constructor | 60-97 | State initialization, callbacks |
| `initialize()` | 107-138 | Required callbacks setup |
| Spawn Optimization | 144-249 | `updateTentPresence()`, `checkSpawnsOnTick()` |
| `_spawnBandit()` | 259-370 | Entity creation and broadcast |
| `handleSpawnMessage()` | 376-493 | Peer spawn handling |
| Target Acquisition | 609-758 | `_buildPlayerList()`, `_findClosestPlayer()` |
| Pathfinding | 771-823 | `_updatePathfinding()` with leash |
| Movement | 835-958 | `_moveAlongPath()` with terrain slope |
| Combat | 970-1090 | `_deterministicRandom()`, `_tryShoot()` |
| State Machine | 1103-1255 | `_updateEntity()` state transitions |
| Interpolation | 1267-1349 | `_interpolateEntity()` for non-authority |
| Authority System | 1362-1542 | `_calculateAuthority()`, peer handlers |
| P2P Handlers | 1552-1649 | `handleStateMessage()`, `handleShootMessage()` |
| Death Handling | 1664-1754 | `killEntity()`, `handleDeathMessage()` |
| Main Update Loop | 1848-1876 | `update()` with distance culling |

---

## Prerequisites

Before starting, you need:

### Required Assets
- [ ] 3D model (.glb file) in `public/models/`
- [ ] Model must have skeleton/bones if animated
- [ ] Animations in the model: walk, idle, attack (names vary)

### Answer These Questions First

Keep your answers handy - you'll reference them throughout the guide.

**Q1: What is the AI called?**
- Answer: _____________ (e.g., "wolf", "guard", "zombie")
- This name will be used for: file names, message types, config keys

**Q2: What structure spawns this AI?**
- Answer: _____________ (e.g., "tent", "den", "grave")
- Bandits spawn from "tent" structures

**Q3: Does this AI use ranged or melee combat?**
- [ ] Ranged (like bandits - has rifle, shoots projectiles)
- [ ] Melee (like bears - attacks at close range)
- [ ] Passive (like deer - no combat, flees)

**Q4: Does this AI use the same model as bandits (man.glb)?**
- [ ] Yes - reuse `AIEnemy` class from `ai-enemy.js`
- [ ] No - create new visual controller file

**Q5: What is the AI's home behavior?**
- [ ] Stays near spawn structure (like bandits with leash)
- [ ] Wanders freely (no home tether)
- [ ] Patrols between points

**Q6: Are spawn structures procedurally generated?**
- [ ] Yes - need ChunkObjectGenerator integration
- [ ] No - structures placed by players or pre-defined

---

## Quick Start: Choosing Your Path

Based on your answers above, here's what you need to implement:

### Minimum Viable AI (Passive, like deer)
Required phases:
- Phase 1: Setup (Steps 1-2)
- Phase 2: Steps 3-7 only (skip Step 8: Combat)
- Phase 3: Visual Layer (Steps 10-11)
- Phase 4: Game Integration (Steps 12-14, skip Step 15)

Skip entirely:
- Step 8: Combat Logic
- Step 15: Combat Hit Detection
- Step 20: Loot Generation
- Most of Phase 6

### Standard Combat AI (like bandits)
Required phases:
- All of Phases 1-5
- Phase 6 as needed
- Phase 7 for polish

### Reusing Bandit Visuals
If Q4 = Yes (same model as bandits):
- Skip creating new visual controller in Step 10
- Use `AIEnemy` class directly

---

# Phase 1: Setup

## Step 1: Configuration Constants

### File: `public/config.js`

Find the `BANDIT_CAMPS` section (around line 863). Add a new section for your AI.

### Bandit Reference Code:

```javascript
BANDIT_CAMPS: {
    ENABLED: true,
    CHUNK_PROBABILITY: 3,           // 1 in 3 chunks
    MIN_TENTS: 1,
    MAX_TENTS: 3,
    MIN_OUTPOSTS: 0,
    MAX_OUTPOSTS: 2,
    PLACEMENT_RADIUS_TIERS: [4, 6, 8],
    PLACEMENT_ATTEMPTS_PER_TIER: 12,
    MIN_STRUCTURE_SEPARATION: 1.5,
    DETECTION_RANGE: 15,
    WAIT_DURATION_MS: 30000,
    RESPAWN_TIME_MS: 120000,
    SPAWN_TRIGGER_DISTANCE: 50,
},
```

### Questions:

**Q1.1: How common should spawn structures be?**
- Bandits: 1 in 3 eligible chunks (`CHUNK_PROBABILITY: 3`)
- Your AI: 1 in ___ chunks

**Q1.2: How many spawn structures per location?**
- Bandits: 1-3 tents per camp
- Your AI: ___ to ___ structures

**Q1.3: What is the spawn trigger distance?**
- Bandits: 50 units (player must be within 50 units to trigger spawn)
- Your AI: ___ units

**Q1.4: What is the detection/aggro range?**
- Bandits: 15 units (matches rifle range)
- Your AI: ___ units

**Q1.5: How long before respawn after death?**
- Bandits: 120000ms (2 minutes)
- Your AI: ___ ms

### Code to Add:

```javascript
// Add after BANDIT_CAMPS section
[YourAI]_CONFIG: {
    ENABLED: true,
    CHUNK_PROBABILITY: [answer Q1.1],
    MIN_STRUCTURES: [answer Q1.2 min],
    MAX_STRUCTURES: [answer Q1.2 max],
    SPAWN_TRIGGER_DISTANCE: [answer Q1.3],
    DETECTION_RANGE: [answer Q1.4],
    RESPAWN_TIME_MS: [answer Q1.5],
},
```

---

## Step 2: GameState Registration

### File: `public/core/GameState.js`

The GameState tracks AI spawn structures by chunk for O(1) lookups.

### Bandit Reference Code (around line 63):

```javascript
// In constructor:
this.banditStructuresByChunk = new Map();
```

```javascript
// Methods (around line 280-319):
registerBanditStructure(chunkKey, structureData) {
    if (!this.banditStructuresByChunk.has(chunkKey)) {
        this.banditStructuresByChunk.set(chunkKey, []);
    }
    this.banditStructuresByChunk.get(chunkKey).push(structureData);
}

unregisterBanditStructure(chunkKey, structureId) {
    const structures = this.banditStructuresByChunk.get(chunkKey);
    if (structures) {
        const index = structures.findIndex(s => s.id === structureId);
        if (index !== -1) {
            structures.splice(index, 1);
        }
    }
}

getBanditStructuresInChunk(chunkKey) {
    return this.banditStructuresByChunk.get(chunkKey) || [];
}
```

### Questions:

**Q2.1: What is your structure type name?**
- Bandits use: "tent"
- Your AI uses: _____________ (from Q2 in Prerequisites)

### Code to Add:

In the constructor, add:
```javascript
this.[YourAI]StructuresByChunk = new Map();
```

Add these methods (replace `[YourAI]` and `[YourAI]` with your names):
```javascript
register[YourAI]Structure(chunkKey, structureData) {
    if (!this.[YourAI]StructuresByChunk.has(chunkKey)) {
        this.[YourAI]StructuresByChunk.set(chunkKey, []);
    }
    this.[YourAI]StructuresByChunk.get(chunkKey).push(structureData);
}

unregister[YourAI]Structure(chunkKey, structureId) {
    const structures = this.[YourAI]StructuresByChunk.get(chunkKey);
    if (structures) {
        const index = structures.findIndex(s => s.id === structureId);
        if (index !== -1) {
            structures.splice(index, 1);
        }
    }
}

get[YourAI]StructuresInChunk(chunkKey) {
    return this.[YourAI]StructuresByChunk.get(chunkKey) || [];
}
```

---

# Phase 2: Core AI Logic

## Step 3: Controller Class Skeleton

### File: Create `public/ai/[YourAI]Controller.js`

This is the main AI behavior file. Start with the skeleton, then fill in sections from subsequent steps.

### Configuration Constants

**Bandit Code (lines 24-54):**

```javascript
const AI_CONFIG = {
    BANDIT: {
        // Spawning
        SPAWN_RANGE: 50,              // Distance to trigger spawn

        // Movement
        MOVE_SPEED: 1.0,              // Units per second
        CHASE_RANGE: 30,              // Detection radius
        LEASH_RANGE: 30,              // Max distance from home
        PATHFIND_INTERVAL: 6000,      // Recalculate path every 6s

        // Combat
        ENGAGEMENT_DISTANCE: 8,       // Stop moving, start shooting
        SHOOT_RANGE_MIN: 10,
        SHOOT_RANGE_MAX: 15,
        SHOOT_RANGE_HEIGHT_BONUS: 2.5,
        HIT_CHANCE_MIN: 0.35,
        HIT_CHANCE_MAX: 0.8,
        HIT_CHANCE_HEIGHT_BONUS: 0.15,
        POINT_BLANK_RANGE: 4,         // 100% hit chance
        FIRST_SHOT_DELAY: 3000,       // Wait 3s before first shot
        SHOOT_INTERVAL: 6000,         // 6s between shots

        // Performance
        IDLE_CHECK_INTERVAL: 30,      // Frames between target checks when idle
        CHUNK_SIZE: 50
    }
};
```

### Questions:

**Q3.1: Movement speed?**
- Bandits: 1.0 units/second
- Your AI: ___ units/second (faster = more aggressive feel)

**Q3.2: Chase/detection range?**
- Bandits: 30 units
- Your AI: ___ units

**Q3.3: Leash range (max distance from home)?**
- Bandits: 30 units (same as chase range)
- Your AI: ___ units (or "none" for free-roaming)

**Q3.4: Combat type?**
- [ ] Ranged - needs SHOOT_RANGE, HIT_CHANCE, SHOOT_INTERVAL (instant kill on hit)
- [ ] Melee - needs ATTACK_RANGE, ATTACK_COOLDOWN (instant kill)
- [ ] Passive - no combat constants needed

### Code Template:

```javascript
// public/ai/[YourAI]Controller.js

import { BaseAIController } from './BaseAIController.js';

const AI_CONFIG = {
    [YourAI]: {
        // Spawning
        SPAWN_RANGE: [from prerequisites Q1.3],

        // Movement
        MOVE_SPEED: [answer Q3.1],
        CHASE_RANGE: [answer Q3.2],
        LEASH_RANGE: [answer Q3.3],        // Remove if free-roaming
        PATHFIND_INTERVAL: 6000,

        // Combat - choose based on type:
        // For ranged:
        ENGAGEMENT_DISTANCE: 8,
        SHOOT_RANGE_MIN: 10,
        SHOOT_RANGE_MAX: 15,
        FIRST_SHOT_DELAY: 3000,
        SHOOT_INTERVAL: 6000,
        HIT_CHANCE_MIN: 0.35,
        HIT_CHANCE_MAX: 0.8,

        // For melee:
        ATTACK_RANGE: 2,
        ATTACK_COOLDOWN: 2000,

        // Performance
        IDLE_CHECK_INTERVAL: 30,
        CHUNK_SIZE: 50
    }
};

export class [YourAI]Controller extends BaseAIController {
    constructor() {
        super({
            entityType: '[YourAI]',
            entityIdField: '[structureId]',  // e.g., 'denId', 'graveId'
            messagePrefix: '[YourAI]'
        });

        // State tracking
        this.entities = new Map();
        this._frameCount = 0;

        // Spawn optimization caches
        this._lastCheckedChunkX = null;
        this._lastCheckedChunkZ = null;
        this._hasStructuresInRange = false;

        // Object pools (for performance)
        this._playerListCache = [];
        this._playerObjectPool = [];
    }

    // Required callbacks - filled in Step 13
    initialize(config) {
        // See Step 13: Game Initialization
    }

    // Main update loop
    update(deltaTime, chunkX, chunkZ) {
        this._frameCount++;
        const now = Date.now();

        // Build player list for targeting
        const players = this._buildPlayerList(chunkX, chunkZ);

        // Update each entity
        for (const [id, entity] of this.entities) {
            if (entity.state === 'dead') continue;
            this._updateEntity(entity, deltaTime, now, players);
        }
    }

    // Per-entity update - filled in Step 5
    _updateEntity(entity, deltaTime, now, players) {
        // See Step 5: State Machine
    }

    // Spawn logic - filled in Step 6
    _spawnEntity(structure) {
        // See Step 6: Spawn Logic
    }

    // Target finding - used by state machine
    _findClosestPlayer(position, range, players) {
        // See Step 5: State Machine
    }

    // Pathfinding - filled in Step 7
    _updatePathfinding(entity, target, now) {
        // See Step 7: Movement & Pathfinding
    }

    _moveAlongPath(entity, deltaTime) {
        // See Step 7: Movement & Pathfinding
    }

    // Combat - filled in Step 8 (skip for passive AI)
    _tryShoot(entity, target, now) {
        // See Step 8: Combat Logic
    }

    // Authority - filled in Step 9
    _calculateAuthority(structureId) {
        // See Step 9: Authority System
    }

    // P2P handlers - filled in Step 12
    handleSpawnMessage(data) {}
    handleStateMessage(data) {}
    handleDeathMessage(data) {}

    // Death handling
    killEntity(structureId, killedBy) {
        // See Step 8: Combat Logic
    }
}
```

---

## Step 4: Entity Data Structure

Each AI entity needs a data object to track its state. This is created in spawn logic but defined here for reference.

### Bandit Entity Object:

```javascript
const entity = {
    // Identity
    tentId: tent.id,                    // Unique ID (same as spawn structure)
    type: 'bandit',
    authorityId: this.clientId,
    spawnedBy: this.clientId,
    spawnTime: Date.now(),

    // Position
    homePosition: { x: tent.position.x, z: tent.position.z },
    position: { x: spawnX, y: spawnY, z: spawnZ },
    rotation: 0,

    // State
    state: 'idle',
    target: null,

    // Pathfinding
    path: [],
    pathIndex: 0,
    lastPathTime: 0,

    // Combat (ranged)
    shotCount: 0,
    lastShotTime: 0,
    pendingKills: new Set(),

    // Combat (melee) - use these instead for melee AI
    // attackCount: 0,
    // lastAttackTime: 0,

    // Visual references
    mesh: null,
    controller: null,

    // Interpolation (non-authority)
    targetPosition: null,
    targetRotation: null,

    // Performance cache
    terrainFrameCount: 0,
    cachedSpeedMultiplier: 1.0,
};
```

### Questions:

**Q4.1: What is your structure ID field name?**
- Bandits use `tentId` (named after spawn structure)
- Your AI uses: `[structureName]Id` = _______________

**Q4.2: What combat tracking is needed?**
- Ranged: `shotCount`, `lastShotTime`, `pendingKills`
- Melee: `attackCount`, `lastAttackTime`
- Passive: none

### Code Template:

```javascript
// In _spawnEntity() - creates this object
const entity = {
    // Identity - change field name to match your structure
    [structureId]: structure.id,        // e.g., denId, graveId
    type: '[yourAIType]',               // e.g., 'wolf', 'zombie'
    authorityId: this.clientId,
    spawnedBy: this.clientId,
    spawnTime: Date.now(),

    // Position
    homePosition: { x: structure.position.x, z: structure.position.z },
    position: { x: spawnX, y: spawnY, z: spawnZ },
    rotation: 0,

    // State
    state: 'idle',
    target: null,

    // Pathfinding
    path: [],
    pathIndex: 0,
    lastPathTime: 0,

    // Combat (choose based on type)
    // Ranged:
    shotCount: 0,
    lastShotTime: 0,
    pendingKills: new Set(),
    // Melee:
    // attackCount: 0,
    // lastAttackTime: 0,

    // Visual
    mesh: null,
    controller: null,

    // Interpolation
    targetPosition: null,
    targetRotation: null,

    // Performance
    terrainFrameCount: 0,
    cachedSpeedMultiplier: 1.0,
};
```

---

## Step 5: State Machine

The state machine controls AI behavior transitions.

### Bandit States:
```
idle -> chasing -> leashed -> returning -> dead
           |          |
        (shooting) (shooting)
```

### Target Acquisition

```javascript
_buildPlayerList(chunkX, chunkZ) {
    this._playerListCache.length = 0;
    let poolIndex = 0;

    const getPlayerObj = (id, x, z, y, type = 'player') => {
        if (poolIndex >= this._playerObjectPool.length) {
            this._playerObjectPool.push({ id: '', x: 0, z: 0, y: 0, type: 'player' });
        }
        const obj = this._playerObjectPool[poolIndex++];
        obj.id = id;
        obj.x = x;
        obj.z = z;
        obj.y = y;
        obj.type = type;
        return obj;
    };

    // Prefer TickManager for deterministic positions (see Step 21)
    if (this.tickManager && this.tickManager.hasSimulationData()) {
        const tickPositions = this.tickManager.getSimulationPositions();
        for (const [playerId, pos] of tickPositions) {
            if (this.isPlayerDead && this.isPlayerDead(playerId)) continue;
            this._playerListCache.push(getPlayerObj(playerId, pos.x, pos.z, pos.y || 0, 'player'));
        }
        return this._playerListCache;
    }

    // Fallback: live positions
    const chunkKeys = this._get3x3ChunkKeys(chunkX, chunkZ);
    const playerIds = this.getPlayersInChunks(chunkKeys);

    for (const playerId of playerIds) {
        if (this.isPlayerDead && this.isPlayerDead(playerId)) continue;
        const pos = this.getPlayerPosition(playerId);
        if (pos) {
            this._playerListCache.push(getPlayerObj(playerId, pos.x, pos.z, pos.y || 0, 'player'));
        }
    }

    return this._playerListCache;
}

_findClosestPlayer(position, range, players) {
    const rangeSq = range * range;
    let closest = null;
    let closestDistSq = rangeSq;

    for (const player of players) {
        const dx = player.x - position.x;
        const dz = player.z - position.z;
        const distSq = dx * dx + dz * dz;

        if (distSq < closestDistSq) {
            closestDistSq = distSq;
            closest = player;
        }
    }

    return closest;
}
```

### State Transition Logic

```javascript
_updateEntity(entity, deltaTime, now, players) {
    const config = AI_CONFIG.[YourAI];

    // Check/update authority
    const newAuthority = this._calculateAuthority(entity.[structureId]);
    if (newAuthority !== entity.authorityId) {
        entity.authorityId = newAuthority;
    }

    // Non-authority: interpolate only
    if (entity.authorityId !== this.clientId) {
        this._interpolateEntity(entity, deltaTime);
        return;
    }

    // Find target (throttled when idle)
    let target = null;
    if (entity.state === 'idle') {
        if (this._frameCount % config.IDLE_CHECK_INTERVAL === 0) {
            target = this._findClosestPlayer(entity.position, config.CHASE_RANGE, players);
        }
    } else {
        target = this._findClosestPlayer(entity.position, config.CHASE_RANGE, players);
    }

    // Check leash distance
    const homeDistSq = this._distanceSq(entity.position, entity.homePosition);
    const isLeashed = homeDistSq > config.LEASH_RANGE * config.LEASH_RANGE;

    // State transitions
    switch (entity.state) {
        case 'idle':
            if (target) {
                entity.state = 'chasing';
                entity.target = target.id;
            }
            break;

        case 'chasing':
            if (!target) {
                entity.state = 'returning';
                entity.target = null;
            } else if (isLeashed) {
                entity.state = 'leashed';
            }
            break;

        case 'leashed':
            if (!target) {
                entity.state = 'returning';
                entity.target = null;
            }
            // Can still attack while leashed, just won't chase further
            break;

        case 'returning':
            if (target) {
                entity.state = 'chasing';
                entity.target = target.id;
            } else if (homeDistSq < 4) {  // Within 2 units of home
                entity.state = 'idle';
            }
            break;
    }

    // Execute current state behavior
    if (entity.state === 'chasing' || entity.state === 'leashed') {
        // Update pathfinding and movement
        this._updatePathfinding(entity, target, now);
        this._moveAlongPath(entity, deltaTime);

        // Try to attack if in range (skip for passive AI)
        if (target) {
            this._tryShoot(entity, target, now);  // or _tryAttack for melee
        }
    } else if (entity.state === 'returning') {
        // Path back home
        this._updatePathfinding(entity, { x: entity.homePosition.x, z: entity.homePosition.z }, now);
        this._moveAlongPath(entity, deltaTime);
    }

    // Update visual controller state flags
    // IMPORTANT: Visual's update() method reads these flags and handles animations
    // Do NOT call animation methods directly from here
    if (entity.controller) {
        entity.controller.moving = entity.state === 'chasing' || entity.state === 'returning';
        entity.controller.inCombatStance = entity.state === 'chasing' || entity.state === 'leashed';
        // For melee AI, use: entity.controller.isAttacking = entity.state === 'attacking';
    }
}

_distanceSq(a, b) {
    const dx = a.x - b.x;
    const dz = (a.z !== undefined ? a.z : 0) - (b.z !== undefined ? b.z : 0);
    return dx * dx + dz * dz;
}

_interpolateEntity(entity, deltaTime) {
    if (!entity.targetPosition) return;

    const config = AI_CONFIG.[YourAI];

    // Thresholds for position correction
    const SNAP_THRESHOLD_SQ = 0.0025;    // 0.05 units - close enough to snap
    const TELEPORT_THRESHOLD_SQ = 100;   // 10 units - too far, teleport

    // Calculate delta to target
    const dx = entity.targetPosition.x - entity.position.x;
    const dy = entity.targetPosition.y - entity.position.y;
    const dz = entity.targetPosition.z - entity.position.z;
    const distSq = dx * dx + dy * dy + dz * dz;

    if (distSq < SNAP_THRESHOLD_SQ) {
        // Close enough - snap to target
        entity.position.x = entity.targetPosition.x;
        entity.position.y = entity.targetPosition.y;
        entity.position.z = entity.targetPosition.z;
    } else if (distSq > TELEPORT_THRESHOLD_SQ) {
        // Too far - teleport (desync recovery)
        entity.position.x = entity.targetPosition.x;
        entity.position.y = entity.targetPosition.y;
        entity.position.z = entity.targetPosition.z;
    } else {
        // Velocity-based interpolation - move at MOVE_SPEED toward target
        const dist = Math.sqrt(distSq);
        const moveSpeed = config.MOVE_SPEED;
        const maxMove = moveSpeed * (deltaTime / 1000);

        if (dist <= maxMove) {
            // Would overshoot - snap to target
            entity.position.x = entity.targetPosition.x;
            entity.position.y = entity.targetPosition.y;
            entity.position.z = entity.targetPosition.z;
        } else {
            // Move toward target at constant speed
            const ratio = maxMove / dist;
            entity.position.x += dx * ratio;
            entity.position.y += dy * ratio;
            entity.position.z += dz * ratio;
        }
    }

    // Rotation interpolation with wrap-around
    if (entity.targetRotation !== null) {
        let diff = entity.targetRotation - entity.rotation;
        if (diff > Math.PI) diff -= Math.PI * 2;
        if (diff < -Math.PI) diff += Math.PI * 2;

        const ROTATION_SPEED = 5;  // radians per second
        const maxRotation = ROTATION_SPEED * (deltaTime / 1000);

        if (Math.abs(diff) < maxRotation) {
            entity.rotation = entity.targetRotation;
        } else {
            entity.rotation += Math.sign(diff) * maxRotation;
        }
    }

    // Update mesh position
    if (entity.mesh) {
        entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
        entity.mesh.rotation.y = entity.rotation;
    }
}
```

### Questions:

**Q5.1: What states does your AI need?**
- [ ] idle - standing still at home
- [ ] chasing - pursuing a target
- [ ] leashed - at max range, can't go further
- [ ] returning - walking back home
- [ ] attacking - melee attack animation
- [ ] fleeing - running away from threat (passive AI)
- [ ] wandering - random movement
- [ ] dead - killed

**Q5.2: Draw your state transitions:**
```
[your states and arrows here]
```

---

## Step 6: Spawn Logic

### Spawn Presence Caching (Performance)

**IMPORTANT - Timing Fix:** The `checkSpawnsOnTick` method must call `updateStructurePresence` internally to catch newly registered structures. This fixes a timing issue where structures are queued via `StructureCreationQueue` during initial load and may not be registered when the first presence check runs.

```javascript
updateStructurePresence(chunkX, chunkZ, force = false) {
    // Skip if same chunk (unless forced)
    if (!force && chunkX === this._lastCheckedChunkX && chunkZ === this._lastCheckedChunkZ) {
        return;
    }

    this._lastCheckedChunkX = chunkX;
    this._lastCheckedChunkZ = chunkZ;
    this._hasStructuresInRange = false;

    // Check 3x3 grid for any structures
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            const key = `${chunkX + dx},${chunkZ + dz}`;
            const structures = this.get[YourAI]Structures(key);
            if (structures && structures.length > 0) {
                this._hasStructuresInRange = true;
                return;
            }
        }
    }
}

checkSpawnsOnTick(chunkX, chunkZ) {
    // Always refresh structure presence to catch newly registered structures
    // (Fixes timing issue where structures are queued during initial load)
    this.updateStructurePresence(chunkX, chunkZ);

    // Early-out if no structures nearby
    if (!this._hasStructuresInRange) return;

    const config = AI_CONFIG.[YourAI];
    const myPos = this.getPlayerPosition(this.clientId);
    if (!myPos) return;

    // Check structures in range
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            const key = `${chunkX + dx},${chunkZ + dz}`;
            const structures = this.get[YourAI]Structures(key);

            for (const structure of structures) {
                // Skip if already spawned
                if (this.entities.has(structure.id)) continue;

                // Check distance
                const distSq = this._distanceSq(myPos, structure.position);
                if (distSq > config.SPAWN_RANGE * config.SPAWN_RANGE) continue;

                // Check authority
                const authority = this._calculateAuthority(structure.id);
                if (authority !== this.clientId) continue;

                // Spawn!
                this._spawnEntity(structure);
            }
        }
    }
}
```

### Entity Creation

```javascript
_spawnEntity(structure) {
    const config = AI_CONFIG.[YourAI];
    const now = Date.now();

    // Find valid spawn position (2.5 unit radius around structure)
    let spawnX = structure.position.x;
    let spawnZ = structure.position.z;
    const spawnRadius = 2.5;
    const startAngle = Math.random() * Math.PI * 2;

    for (let attempt = 0; attempt < 8; attempt++) {
        const angle = startAngle + (attempt / 8) * Math.PI * 2;
        const testX = structure.position.x + Math.cos(angle) * spawnRadius;
        const testZ = structure.position.z + Math.sin(angle) * spawnRadius;

        if (this.isWalkable && this.isWalkable(testX, testZ)) {
            spawnX = testX;
            spawnZ = testZ;
            break;
        }
    }

    const spawnY = this.getTerrainHeight(spawnX, spawnZ) || 0;

    // Create entity object (see Step 4)
    const entity = {
        [this.entityIdField]: structure.id,
        type: this.entityType,
        authorityId: this.clientId,
        spawnedBy: this.clientId,
        spawnTime: now,

        homePosition: { x: structure.position.x, z: structure.position.z },
        position: { x: spawnX, y: spawnY, z: spawnZ },
        rotation: 0,

        state: 'idle',
        target: null,

        path: [],
        pathIndex: 0,
        lastPathTime: 0,

        // Combat tracking (choose based on type)
        shotCount: 0,
        lastShotTime: 0,
        pendingKills: new Set(),

        mesh: null,
        controller: null,
        targetPosition: null,
        targetRotation: null,
        terrainFrameCount: 0,
        cachedSpeedMultiplier: 1.0,
    };

    // Store entity
    this.entities.set(structure.id, entity);

    // Create visual
    entity.controller = this.createVisual(structure.id, entity.position);
    entity.mesh = entity.controller?.enemy || entity.controller?.mesh;

    // Register name tag
    if (this.game?.nameTagManager) {
        this.game.nameTagManager.registerEntity(
            `${this.entityType}_${structure.id}`,
            '[Display Name]',  // e.g., 'Wolf', 'Zombie'
            entity.mesh
        );
    }

    // Broadcast to peers
    this.broadcastP2P({
        type: `${this.messagePrefix}_spawn`,
        structureId: structure.id,
        spawnedBy: this.clientId,
        spawnTime: now,
        position: entity.position,
        homePosition: entity.homePosition
    });
}
```

### Questions:

**Q6.1: What spawn radius around the structure?**
- Bandits: 2.5 units
- Your AI: ___ units

**Q6.2: What name displays above the AI?**
- Bandits: "Bandit"
- Your AI: _______________

---

## Step 7: Movement & Pathfinding

### Pathfinding Update

```javascript
_updatePathfinding(entity, target, now) {
    const config = AI_CONFIG.[YourAI];

    // Only update at interval
    if (now - entity.lastPathTime < config.PATHFIND_INTERVAL) {
        return;
    }

    if (!target) return;

    // Request new path
    const path = this.findPath(
        entity.position.x,
        entity.position.z,
        target.x,
        target.z
    );

    if (path && path.length > 0) {
        entity.path = path;
        entity.pathIndex = 0;
        entity.lastPathTime = now;
    }
}
```

### Movement Along Path

```javascript
_moveAlongPath(entity, deltaTime) {
    const config = AI_CONFIG.[YourAI];

    if (!entity.path || entity.pathIndex >= entity.path.length) {
        if (entity.controller) entity.controller.moving = false;
        return;
    }

    const waypoint = entity.path[entity.pathIndex];
    const dx = waypoint.x - entity.position.x;
    const dz = waypoint.z - entity.position.z;
    const distSq = dx * dx + dz * dz;

    // Reached waypoint?
    if (distSq < 1) {
        entity.pathIndex++;
        if (entity.pathIndex >= entity.path.length) {
            if (entity.controller) entity.controller.moving = false;
            return;
        }
    }

    // Calculate direction
    const dist = Math.sqrt(distSq);
    const dirX = dx / dist;
    const dirZ = dz / dist;

    // Calculate speed with terrain slope (throttled)
    entity.terrainFrameCount = (entity.terrainFrameCount || 0) + 1;
    let speedMultiplier = entity.cachedSpeedMultiplier || 1.0;

    if (entity.terrainFrameCount % 5 === 0 && this.getTerrainHeight) {
        const currentHeight = this.getTerrainHeight(entity.position.x, entity.position.z) || 0;
        const aheadHeight = this.getTerrainHeight(
            entity.position.x + dirX,
            entity.position.z + dirZ
        ) || 0;

        const slope = aheadHeight - currentHeight;
        if (slope > 0.3) {
            speedMultiplier = 0.6;  // Uphill slow
        } else if (slope < -0.3) {
            speedMultiplier = 1.3;  // Downhill fast
        } else {
            speedMultiplier = 1.0;
        }

        // Road bonus
        if (this.isOnRoad && this.isOnRoad(entity.position.x, entity.position.z)) {
            speedMultiplier *= 1.2;
        }

        entity.cachedSpeedMultiplier = speedMultiplier;
    }

    // Move
    const speed = config.MOVE_SPEED * speedMultiplier;
    const moveDistance = speed * (deltaTime / 1000);

    entity.position.x += dirX * moveDistance;
    entity.position.z += dirZ * moveDistance;
    entity.position.y = this.getTerrainHeight(entity.position.x, entity.position.z) || 0;

    // Update rotation to face movement direction
    entity.rotation = Math.atan2(dirX, dirZ);

    // Update mesh
    if (entity.mesh) {
        entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
        entity.mesh.rotation.y = entity.rotation;
    }

    // Update visual state
    if (entity.controller) {
        entity.controller.moving = true;
        entity.controller.speedMultiplier = speedMultiplier;
    }
}
```

---

## Step 8: Combat Logic

**Skip this step for passive AI (deer-like behavior).**

### Ranged Combat (like bandits)

```javascript
_tryShoot(entity, target, now) {
    const config = AI_CONFIG.[YourAI];

    // First shot delay
    const timeSinceSpawn = now - entity.spawnTime;
    if (timeSinceSpawn < config.FIRST_SHOT_DELAY) return;

    // Shot pacing
    const shootingTime = timeSinceSpawn - config.FIRST_SHOT_DELAY;
    const expectedShots = 1 + Math.floor(shootingTime / config.SHOOT_INTERVAL);
    if (entity.shotCount >= expectedShots) return;

    // Range check (squared for performance)
    const dx = target.x - entity.position.x;
    const dz = target.z - entity.position.z;
    const distanceSq = dx * dx + dz * dz;

    // Calculate shooting range with height advantage bonus
    const heightAdvantage = entity.position.y - (target.y || 0);
    const shootingRange = Math.min(
        config.SHOOT_RANGE_MAX,
        config.SHOOT_RANGE_MIN + Math.max(0, heightAdvantage) * config.SHOOT_RANGE_HEIGHT_BONUS
    );

    if (distanceSq > shootingRange * shootingRange) return;

    // Hit chance calculation with height advantage
    const distance = Math.sqrt(distanceSq);
    const baseHitChance = Math.min(
        config.HIT_CHANCE_MAX,
        config.HIT_CHANCE_MIN + Math.max(0, heightAdvantage * config.HIT_CHANCE_HEIGHT_BONUS)
    );

    let hitChance = baseHitChance;

    // Point blank bonus
    if (distance < config.POINT_BLANK_RANGE) {
        const bonus = (config.POINT_BLANK_RANGE - distance) / config.POINT_BLANK_RANGE;
        hitChance += (1.0 - hitChance) * bonus;
    }

    hitChance = Math.min(hitChance, config.HIT_CHANCE_MAX);

    // Deterministic hit/miss (same result on all clients)
    const roll = this._deterministicRandom(entity.[structureId], entity.shotCount);
    const didHit = roll < hitChance;

    // Update state
    entity.shotCount++;
    entity.lastShotTime = now;

    if (didHit) {
        entity.pendingKills.add(target.id);
    }

    // Broadcast
    this.broadcastP2P({
        type: `${this.messagePrefix}_shoot`,
        structureId: entity.[structureId],
        targetId: target.id,
        targetType: target.type || 'player',
        didHit: didHit,
        position: entity.position
    });

    // Local effects
    if (this.onShoot) {
        this.onShoot(entity.[structureId], target.id, didHit, entity.position);
    }
}

// Deterministic random - same result on all clients
_deterministicRandom(structureId, actionCount) {
    let hash = (actionCount * 2654435761) | 0;
    const str = structureId + '_' + actionCount;

    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash ^= (actionCount * 31);
        hash |= 0;
    }

    return (hash >>> 0) / 4294967295;
}
```

### Melee Combat (alternative)

```javascript
_tryAttack(entity, target, now) {
    const config = AI_CONFIG.[YourAI];

    // Attack cooldown
    if (now - entity.lastAttackTime < config.ATTACK_COOLDOWN) return;

    // Range check
    const dx = target.x - entity.position.x;
    const dz = target.z - entity.position.z;
    const distanceSq = dx * dx + dz * dz;

    if (distanceSq > config.ATTACK_RANGE * config.ATTACK_RANGE) return;

    // Execute attack
    entity.attackCount++;
    entity.lastAttackTime = now;

    // Broadcast
    this.broadcastP2P({
        type: `${this.messagePrefix}_attack`,
        structureId: entity.[structureId],
        targetId: target.id,
        position: entity.position
    });

    // Local callback (instant kill handled in GameInitializer)
    if (this.onAttack) {
        this.onAttack(entity.[structureId], target.id, entity.position);
    }

    // Play attack animation
    if (entity.controller?.playAttackAnimation) {
        entity.controller.playAttackAnimation();
    }
}
```

### Death Handling

**IMPORTANT - Respawn Prevention:**

The spawn check uses `if (this.entities.has(structure.id)) continue;` to skip structures that already have an entity. To prevent immediate respawning after death:

1. **Keep the entity in the map** with `state = 'dead'`
2. **Only remove the visual**, not the entity data
3. **Entity is only deleted when chunk unloads** (via `onChunkUnloaded`)

This means a dead AI won't respawn until the player leaves the area (chunk unloads).

```javascript
/**
 * Destroy visual only - keeps entity in map to prevent respawn
 * Used for death handling
 */
_destroyVisualOnly(structureId) {
    const entity = this.entities.get(structureId);
    if (!entity) return;

    // Unregister name tag
    if (this.game?.nameTagManager) {
        this.game.nameTagManager.unregisterEntity(`${this.entityType}_${structureId}`);
    }

    // Remove visual
    if (entity.mesh) {
        this.destroyVisual(structureId, entity.mesh);
    }

    // Clear visual references but KEEP entity in map
    entity.mesh = null;
    entity.controller = null;
}

killEntity(structureId, killedBy) {
    const entity = this.entities.get(structureId);
    if (!entity || entity.state === 'dead') return;

    entity.state = 'dead';

    // Visual death animation
    if (entity.controller?.kill) {
        entity.controller.kill();
    }

    // Update name tag to show dead
    if (this.game?.nameTagManager) {
        this.game.nameTagManager.updateEntityName(
            `${this.entityType}_${structureId}`,
            '[Name] (DEAD)'
        );
    }

    // Broadcast death
    this.broadcastP2P({
        type: `${this.messagePrefix}_death`,
        structureId: structureId,
        killedBy: killedBy
    });

    // Schedule visual cleanup - but DON'T delete entity from map!
    // Entity stays in map with state='dead' to prevent respawn
    setTimeout(() => {
        this._destroyVisualOnly(structureId);
    }, 5000);  // 5 second delay for death animation
}

handleDeathMessage(data) {
    const entity = this.entities.get(data.structureId);
    if (!entity || entity.state === 'dead') return;

    entity.state = 'dead';

    if (entity.controller?.kill) {
        entity.controller.kill();
    }

    // Visual cleanup only - keep entity in map
    setTimeout(() => {
        this._destroyVisualOnly(data.structureId);
    }, 5000);
}
```

**Why this pattern works:**

```
Player kills AI → entity.state = 'dead', visual removed after 5s
                → entity stays in map
                → spawn check: entities.has(structure.id) = true → skip
                → NO RESPAWN

Player leaves area → chunk unloads → onChunkUnloaded() called
                   → entities.delete(structureId)
                   → entity removed from map

Player returns → spawn check: entities.has(structure.id) = false
              → AI spawns fresh
```

---

## Step 9: Authority System

Authority determines which client runs the AI simulation. All other clients interpolate.

**Key Principle:** Authority is calculated **deterministically** by all clients using the same algorithm (lowest clientId). No authority transfer messages are needed - when authority changes, the new authority just starts broadcasting.

### Authority Calculation

```javascript
_calculateAuthority(structureId) {
    const entity = this.entities.get(structureId);
    if (!entity) return null;

    const CHUNK_SIZE = 50;
    const homeChunkX = Math.floor(entity.homePosition.x / CHUNK_SIZE);
    const homeChunkZ = Math.floor(entity.homePosition.z / CHUNK_SIZE);

    // Get 3x3 chunk grid around home
    const chunkKeys = this._get3x3ChunkKeys(homeChunkX, homeChunkZ);
    const players = this.getPlayersInChunks(chunkKeys);

    if (!players || players.size === 0) return null;

    // Find LOWEST clientId - deterministic for all clients
    // Uses string comparison which is deterministic for "session_xxx" format
    let lowestId = null;
    for (const playerId of players) {
        if (lowestId === null || playerId < lowestId) {
            lowestId = playerId;
        }
    }

    return lowestId;
}

_get3x3ChunkKeys(chunkX, chunkZ) {
    // Cache to avoid allocating 9 strings per call
    if (this._cachedChunkCenter?.x === chunkX && this._cachedChunkCenter?.z === chunkZ) {
        return this._cachedChunkKeys;
    }

    this._cachedChunkKeys = this._cachedChunkKeys || [];
    this._cachedChunkKeys.length = 0;

    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            this._cachedChunkKeys.push(`${chunkX + dx},${chunkZ + dz}`);
        }
    }

    this._cachedChunkCenter = { x: chunkX, z: chunkZ };
    return this._cachedChunkKeys;
}
```

### Authority Transfer Events

These handlers must be called by GameStateManager/NetworkManager when peer events occur:

```javascript
// When peer disconnects
onPeerDisconnected(peerId) {
    for (const [structureId, entity] of this.entities) {
        if (entity.authorityId === peerId) {
            const newAuthority = this._calculateAuthority(structureId);
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
                    this._broadcastEntityState(entity, structureId);
                }
            }
        }

        // Clean up pending kills for disconnected peer
        if (entity.pendingKills?.has(peerId)) {
            entity.pendingKills.delete(peerId);
        }
    }
}

// When peer joins a chunk (new peer or peer moved)
onPeerJoinedChunk(peerId, chunkKey) {
    const CHUNK_SIZE = 50;
    const [peerChunkX, peerChunkZ] = chunkKey.split(',').map(Number);

    for (const [structureId, entity] of this.entities) {
        const homeChunkX = Math.floor(entity.homePosition.x / CHUNK_SIZE);
        const homeChunkZ = Math.floor(entity.homePosition.z / CHUNK_SIZE);
        const dx = Math.abs(peerChunkX - homeChunkX);
        const dz = Math.abs(peerChunkZ - homeChunkZ);

        if (dx <= 1 && dz <= 1) {
            // Peer is near this entity - recalculate authority
            const newAuthority = this._calculateAuthority(structureId);
            if (newAuthority && newAuthority !== entity.authorityId) {
                const wasMe = entity.authorityId === this.clientId;
                const isNowMe = newAuthority === this.clientId;
                entity.authorityId = newAuthority;

                if (isNowMe && !wasMe) {
                    // Snap position and broadcast immediately
                    if (entity.targetPosition) {
                        entity.position.x = entity.targetPosition.x;
                        entity.position.y = entity.targetPosition.y;
                        entity.position.z = entity.targetPosition.z;
                    }
                    this._broadcastEntityState(entity, structureId);
                }
            }
        }
    }
}

// When peer changes chunk
onPeerChunkChanged(peerId, oldChunkKey, newChunkKey) {
    const CHUNK_SIZE = 50;
    const [newX, newZ] = newChunkKey.split(',').map(Number);

    for (const [structureId, entity] of this.entities) {
        const homeChunkX = Math.floor(entity.homePosition.x / CHUNK_SIZE);
        const homeChunkZ = Math.floor(entity.homePosition.z / CHUNK_SIZE);
        const dx = Math.abs(newX - homeChunkX);
        const dz = Math.abs(newZ - homeChunkZ);
        const isNowInRange = dx <= 1 && dz <= 1;

        // Case 1: Current authority left the region
        if (entity.authorityId === peerId && !isNowInRange) {
            const newAuthority = this._calculateAuthority(structureId);
            if (newAuthority) {
                entity.authorityId = newAuthority;
                if (newAuthority === this.clientId) {
                    if (entity.targetPosition) {
                        entity.position.x = entity.targetPosition.x;
                        entity.position.y = entity.targetPosition.y;
                        entity.position.z = entity.targetPosition.z;
                    }
                    this._broadcastEntityState(entity, structureId);
                }
            }
        }
        // Case 2: A peer entered the region (might have lower clientId)
        else if (isNowInRange && entity.authorityId !== peerId) {
            const newAuthority = this._calculateAuthority(structureId);
            if (newAuthority && newAuthority !== entity.authorityId) {
                entity.authorityId = newAuthority;
            }
        }
    }
}
```

### State Broadcasting (with Message Pooling)

```javascript
// In constructor - preallocate to avoid GC pressure
this._broadcastMsg = {
    type: '',
    structureId: '',
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
    state: '',
    target: null,
    shotCount: 0,
    lastShotTime: 0,
    pendingKills: [],
    moving: false,
    inCombatStance: false,
    speedMultiplier: 1.0
};

// Broadcast state to peers (called every tick by authority)
broadcastAuthorityState() {
    for (const [structureId, entity] of this.entities) {
        if (entity.authorityId !== this.clientId) continue;
        if (entity.state === 'dead') continue;

        this._broadcastEntityState(entity, structureId);
    }
}

_broadcastEntityState(entity, structureId) {
    // Reuse pooled message object to avoid GC
    const msg = this._broadcastMsg;
    msg.type = `${this.messagePrefix}_state`;
    msg.structureId = structureId;
    msg.position.x = entity.position.x;
    msg.position.y = entity.position.y;
    msg.position.z = entity.position.z;
    msg.rotation = entity.rotation;
    msg.state = entity.state;
    msg.target = entity.target;
    msg.shotCount = entity.shotCount || 0;
    msg.lastShotTime = entity.lastShotTime || 0;
    msg.moving = entity.controller?.moving || false;
    msg.inCombatStance = entity.controller?.inCombatStance || false;
    msg.speedMultiplier = entity.controller?.speedMultiplier || 1.0;

    // Reuse pendingKills array
    msg.pendingKills.length = 0;
    if (entity.pendingKills) {
        for (const kill of entity.pendingKills) {
            msg.pendingKills.push(kill);
        }
    }

    this.broadcastP2P(msg);
}
```

### State Message Handler (with Pending States)

```javascript
// In constructor
this.pendingStates = new Map();  // Handle race condition: state arrives before spawn

handleStateMessage(data) {
    let entity = this.entities.get(data.structureId);

    if (!entity) {
        // Entity doesn't exist yet - store pending state for when it spawns
        // This handles race condition where state message arrives before spawn message
        this.pendingStates.set(data.structureId, data);
        return;
    }

    // Ignore if we're authority (we're the source of truth)
    if (entity.authorityId === this.clientId) return;

    // Update interpolation targets
    entity.targetPosition = {
        x: data.position.x,
        y: data.position.y,
        z: data.position.z
    };
    entity.targetRotation = data.rotation;
    entity.state = data.state;
    entity.target = data.target;
    entity.shotCount = data.shotCount;
    entity.lastShotTime = data.lastShotTime;

    // Update visual state
    if (entity.controller) {
        entity.controller.moving = data.moving;
        entity.controller.inCombatStance = data.inCombatStance;
        entity.controller.speedMultiplier = data.speedMultiplier;
    }
}

// In handleSpawnMessage - apply pending state if exists
handleSpawnMessage(data) {
    // ... entity creation code ...

    // Check for pending state that arrived before spawn
    if (this.pendingStates?.has(data.structureId)) {
        const pendingState = this.pendingStates.get(data.structureId);
        if (pendingState.position) {
            entity.targetPosition = pendingState.position;
        }
        if (pendingState.rotation !== undefined) {
            entity.targetRotation = pendingState.rotation;
        }
        if (pendingState.state) {
            entity.state = pendingState.state;
        }
        this.pendingStates.delete(data.structureId);
    }
}
```

---


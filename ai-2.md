# Phase 3: Visual Layer

## Step 10: Visual Controller

The visual controller handles **all animation logic** based on state flags set by the AI controller. This is a key architectural pattern:

**IMPORTANT - Animation Architecture:**
```
Controller (behavior)              Visual Controller (animations)
─────────────────────              ─────────────────────────────
Sets flags:                        Reads flags in update():
  entity.controller.moving = true    if (this.moving) playWalk()
  entity.controller.isAttacking      if (this.isAttacking) playAttack()

NEVER calls animation methods      Owns all animation logic
directly (except one-shots)        Calls mixer.update() internally
```

### If reusing bandit visuals (Q4 = Yes)

You can use the `AIEnemy` class directly:

```javascript
// In your createVisual callback (Step 13):
const visual = new AIEnemy(game, scene, networkManager, position, null, structureId);
return visual;
```

### If creating new visual controller

Create `public/[YourAI]-visual.js` or embed in your Manager file.

**Key pattern from AIEnemy (bandit visual controller):**

```javascript
// State flags - set by controller, read by update()
this.moving = false;           // Is entity moving?
this.inCombatStance = false;   // Is entity in combat? (ranged AI)
this.isAttacking = false;      // Is entity attacking? (melee AI)
this.speedMultiplier = 1.0;    // Animation speed
this.isDead = false;           // Death state
```

**Visual Controller Template:**

```javascript
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { modelManager } from './objects.js';

export class [YourAI]Visual {
    constructor(scene, mesh, mixer, animations) {
        this.scene = scene;
        this.mesh = mesh;
        this.mixer = mixer;

        // Animation state flags (SET BY CONTROLLER, read here)
        this.moving = false;
        this.isAttacking = false;  // For melee AI
        this.inCombatStance = false;  // For ranged AI
        this.speedMultiplier = 1.0;

        // Death state
        this.isDead = false;
        this.deathStartTime = 0;
        this.fallDirection = 1;

        // Setup animation actions
        this.walkAction = null;
        this.runAction = null;
        this.attackAction = null;

        for (const clip of animations) {
            const name = clip.name.toLowerCase();
            const action = mixer.clipAction(clip);

            if (name.includes('walk')) {
                this.walkAction = action;
                this.walkAction.setLoop(THREE.LoopRepeat);
            } else if (name.includes('run')) {
                this.runAction = action;
                this.runAction.setLoop(THREE.LoopRepeat);
            } else if (name.includes('attack')) {
                this.attackAction = action;
                this.attackAction.setLoop(THREE.LoopOnce);
                this.attackAction.clampWhenFinished = true;
            }
        }

        // Start in idle pose (frozen walk frame)
        if (this.walkAction) {
            this.walkAction.play();
            this.walkAction.paused = true;
            this.walkAction.time = 0.033;
            this.mixer.update(0.001);
        }
    }

    /**
     * Update animations based on state flags
     * Called every frame by manager.update() or game loop
     * THIS method handles all animation logic - controller just sets flags
     */
    update(deltaTime) {
        if (this.isDead) {
            this.updateDeathAnimation(deltaTime);
            return;
        }

        if (!this.mixer) return;

        // Check if attack animation is still playing
        const isAttackPlaying = this.attackAction &&
            this.attackAction.isRunning() && !this.attackAction.paused;

        if (isAttackPlaying) {
            // Let attack animation complete
            this.mixer.update(deltaTime / 1000);
        } else if (this.isAttacking) {
            // Start attack animation
            if (this.attackAction) {
                if (this.walkAction) this.walkAction.stop();
                if (this.runAction) this.runAction.stop();
                this.attackAction.reset();
                this.attackAction.play();
                this.mixer.update(deltaTime / 1000);
            }
        } else if (this.moving) {
            // Play movement animation (run or walk)
            const moveAction = this.runAction || this.walkAction;
            if (moveAction) {
                if (!moveAction.isRunning()) {
                    if (this.walkAction) this.walkAction.stop();
                    if (this.runAction) this.runAction.stop();
                    if (this.attackAction) this.attackAction.stop();
                    moveAction.reset();
                    moveAction.play();
                }
                this.mixer.update((deltaTime / 1000) * this.speedMultiplier);
            }
        } else {
            // Idle - freeze on first frame of walk
            if (this.runAction && this.runAction.isRunning()) this.runAction.stop();
            if (this.attackAction && this.attackAction.isRunning()) this.attackAction.stop();

            if (this.walkAction) {
                if (!this.walkAction.isRunning()) {
                    this.walkAction.reset();
                    this.walkAction.play();
                }
                this.walkAction.paused = true;
                this.walkAction.time = 0.033;
                this.mixer.update(0.001);
            }
        }
    }

    /**
     * Play attack animation (one-shot)
     * Called by controller when attack occurs
     */
    playAttackAnimation() {
        if (this.attackAction) {
            if (this.walkAction) this.walkAction.stop();
            if (this.runAction) this.runAction.stop();
            this.attackAction.reset();
            this.attackAction.play();
        }
    }

    /**
     * Trigger death state
     */
    kill() {
        this.isDead = true;
        this.deathStartTime = Date.now();
        this.fallDirection = Math.random() < 0.5 ? -1 : 1;
        if (this.mixer) {
            this.mixer.stopAllAction();
        }
    }

    updateDeathAnimation(deltaTime) {
        const DEATH_DURATION = 500;
        const elapsed = Date.now() - this.deathStartTime;
        const progress = Math.min(elapsed / DEATH_DURATION, 1);

        if (this.mesh) {
            const angle = (Math.PI / 2) * progress * this.fallDirection;
            this.mesh.rotation.z = angle;
        }
    }

    dispose() {
        if (this.mixer) {
            this.mixer.stopAllAction();
            this.mixer = null;
        }
        if (this.mesh && this.scene) {
            this.scene.remove(this.mesh);
        }
    }
}
```

### Controller Integration

In your AI controller, set flags instead of calling animation methods:

```javascript
// In _updateEntity() - after state machine:
if (entity.controller) {
    entity.controller.moving = entity.state === 'chasing' || entity.state === 'returning';
    entity.controller.isAttacking = entity.state === 'attacking';  // melee
    // entity.controller.inCombatStance = !!target;  // ranged
}

// For one-shot effects (attack/shoot), call the method:
if (entity.controller?.playAttackAnimation) {
    entity.controller.playAttackAnimation();
}

// For death:
if (entity.controller?.kill) {
    entity.controller.kill();
}
```

### Game Loop Integration

The visual's `update()` must be called each frame. This is typically done by the Manager:

```javascript
// In Manager.update() or game loop:
update(deltaTime) {
    for (const [id, visual] of this.visuals) {
        visual.update(deltaTime);
    }
}
```

---

## Step 11: Entity Manager

### File: Create `public/entity/[YourAI]Manager.js`

The entity manager coordinates between the controller and visual systems.

```javascript
import { [YourAI]Visual } from '../[YourAI]-visual.js';
// Or if reusing: import { AIEnemy } from '../ai-enemy.js';

export class [YourAI]Manager {
    constructor(game) {
        this.game = game;
        this.entities = new Map();      // structureId -> { visual, isDead }
        this.deadEntities = new Set();  // Prevent respawn
    }

    createVisual(structureId, position) {
        if (this.entities.has(structureId)) {
            return this.entities.get(structureId).visual;
        }

        const visual = new [YourAI]Visual(
            this.game,
            this.game.scene,
            position,
            structureId
        );

        this.entities.set(structureId, {
            visual: visual,
            isDead: false
        });

        return visual;
    }

    destroyVisual(structureId) {
        const entry = this.entities.get(structureId);
        if (entry && entry.visual) {
            entry.visual.dispose();
        }
        this.entities.delete(structureId);
    }

    markDead(structureId) {
        this.deadEntities.add(structureId);
        const entry = this.entities.get(structureId);
        if (entry) {
            entry.isDead = true;
        }
    }

    isDead(structureId) {
        return this.deadEntities.has(structureId);
    }

    update(deltaTime, now) {
        for (const [id, entry] of this.entities) {
            if (entry.visual && typeof entry.visual.update === 'function') {
                entry.visual.update(deltaTime, now);
            }
        }
    }
}
```

---

# Phase 4: Game Integration

## Step 12: P2P Message Handlers

### File: `public/network/GameStateManager.js`

Add handlers for your AI's P2P messages.

Find the message handling switch statement and add:

```javascript
case '[YourAI]_spawn':
    this.game.[YourAI]Controller?.handleSpawnMessage(data);
    break;
case '[YourAI]_death':
    this.game.[YourAI]Controller?.handleDeathMessage(data);
    break;
case '[YourAI]_sync':
    this.game.[YourAI]Controller?.syncEntitiesFromPeer(data.entities || data);
    break;
case '[YourAI]_state':
    this.game.[YourAI]Controller?.handleStateMessage(data);
    break;
case '[YourAI]_shoot':  // For ranged AI
    this.game.[YourAI]Controller?.handleShootMessage(data);
    break;
case '[YourAI]_attack':  // For melee AI
    this.game.[YourAI]Controller?.handleAttackMessage(data);
    break;
case '[YourAI]_kill_ack':
    this.game.[YourAI]Controller?.handleKillAck(data);
    break;
```

---

## Step 13: Game Initialization

### File: `public/core/GameInitializer.js`

Create initialization method and call it in `finalizeNetworking()`:

```javascript
initialize[YourAI]Controller() {
    // Import at top of file:
    // import { [YourAI]Controller } from '../ai/[YourAI]Controller.js';
    // import { [YourAI]Manager } from '../entity/[YourAI]Manager.js';

    // Create manager first
    this.game.[YourAI]Manager = new [YourAI]Manager(this.game);

    // Create controller
    this.game.[YourAI]Controller = new [YourAI]Controller();

    const success = this.game.[YourAI]Controller.initialize({
        clientId: this.game.gameState.clientId,

        getPlayersInChunks: (chunkKeys) => {
            const players = new Set();
            for (const key of chunkKeys) {
                const chunk = this.game.gameState.playersByChunk.get(key);
                if (chunk) {
                    for (const id of chunk) players.add(id);
                }
            }
            return Array.from(players);
        },

        getPlayerPosition: (playerId) => {
            if (playerId === this.game.gameState.clientId) {
                return this.game.playerObject?.position;
            }
            const avatar = this.game.avatarManager?.avatars.get(playerId);
            return avatar?.group?.position;
        },

        get[YourAI]Structures: (chunkKey) => {
            return this.game.gameState.get[YourAI]StructuresInChunk(chunkKey);
        },

        getTerrainHeight: (x, z) => {
            return this.game.terrainGenerator?.getHeight(x, z) || 0;
        },

        isOnRoad: (x, z) => {
            return this.game.terrainGenerator?.isOnRoad(x, z) || false;
        },

        isWalkable: (x, z) => {
            return this.game.navigationManager?.isWalkable(x, z) ?? true;
        },

        findPath: (fromX, fromZ, toX, toZ) => {
            return this.game.navigationManager?.findPath(fromX, fromZ, toX, toZ);
        },

        createVisual: (structureId, position) => {
            return this.game.[YourAI]Manager.createVisual(structureId, position);
        },

        destroyVisual: (structureId) => {
            this.game.[YourAI]Manager.destroyVisual(structureId);
        },

        broadcastP2P: (message) => {
            this.game.networkManager?.broadcastP2P(message);
        },

        // For ranged AI (instant kill on hit):
        onShoot: (structureId, targetId, didHit, position) => {
            this.game.audioManager?.playPositionalSound('rifle', position);
            if (didHit && targetId === this.game.gameState.clientId) {
                if (this.game.loadingScreen?.isActive) return;
                this.game.deathReason = 'Killed by [YourAI]';
                this.game.playerCombat?.die();
            }
        },

        // For melee AI (instant kill):
        onAttack: (structureId, targetId, position) => {
            this.game.audioManager?.playPositionalSound('[attackSound]', position);
            if (targetId === this.game.gameState.clientId) {
                if (this.game.loadingScreen?.isActive) return;
                this.game.deathReason = 'Killed by [YourAI]';
                this.game.playerCombat?.die();
            }
        },

        isPlayerDead: (playerId) => {
            if (playerId === this.game.gameState.clientId) {
                return this.game.gameState.isDead;
            }
            const avatar = this.game.avatarManager?.avatars.get(playerId);
            return avatar?.isDead || false;
        },

        tickManager: this.game.tickManager,
        game: this.game
    });

    if (!success) {
        console.error('[YourAI]Controller initialization failed');
    }

    // Register with AIRegistry for cross-AI communication
    if (this.game.aiRegistry) {
        this.game.aiRegistry.register('[YourAI]', this.game.[YourAI]Controller);
    }
}
```

In `finalizeNetworking()`:
```javascript
// After bandit controller initialization
this.initialize[YourAI]Controller();
```

---

## Step 14: Game Loop Integration

### File: `public/game.js`

Add to the update/animation loop:

```javascript
// Update [YourAI] controller
if (this.[YourAI]Controller && this.playerObject) {
    this.[YourAI]Controller.update(deltaTime, chunkX, chunkZ);
}

// Update [YourAI] manager (for animations)
if (this.[YourAI]Manager) {
    this.[YourAI]Manager.update(deltaTime, Date.now());
}
```

### File: `public/network/MessageRouter.js`

In the `handleTick()` method:

```javascript
// [YourAI] spawn checking and state broadcast
if (this.game.[YourAI]Controller) {
    this.game.[YourAI]Controller.updateStructurePresence(chunkX, chunkZ);
    this.game.[YourAI]Controller.checkSpawnsOnTick(chunkX, chunkZ);
    this.game.[YourAI]Controller.broadcastAuthorityState();
}
```

---

## Step 15: Combat Hit Detection

**Skip this step for passive AI.**

### File: `public/player/PlayerCombat.js`

In `checkProjectileHits()`:

```javascript
// Check for [YourAI] hits
if (this.game.[YourAI]Controller) {
    for (const [structureId, entity] of this.game.[YourAI]Controller.entities) {
        if (entity.state === 'dead') continue;
        if (!entity.mesh) continue;

        const dx = entity.position.x - hitPoint.x;
        const dy = entity.position.y - hitPoint.y;
        const dz = entity.position.z - hitPoint.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq < hitRadius * hitRadius) {
            this.game.[YourAI]Controller.killEntity(
                structureId,
                this.game.gameState.clientId
            );
            return { hit: true, target: '[YourAI]', id: structureId };
        }
    }
}
```

---

# Phase 5: World Integration

## Model Registration (Required)

**File: `public/objects.js`**

Your AI structure model must be registered in MODEL_CONFIGS before it can be loaded and rendered:

```javascript
    [structureType]: {
        path: './models/[structureType].glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
```

Without this registration, you'll get "Model [structureType] not loaded" errors when chunks try to render your structures.

---

## Step 16: Procedural Structure Generation

**Skip if structures are player-placed (Q6 = No).**

### File: `public/systems/ChunkObjectGenerator.js`

```javascript
// Add constant at top of file
const [YourAI]_SEED_OFFSET = 0x[UNIQUE_HEX];  // Unique hex value, e.g., 0xW01F5

// Add chunk check method
is[YourAI]Chunk(chunkX, chunkZ) {
    if (!GAME_CONFIG.[YourAI]_CONFIG?.ENABLED) return false;

    const worldX = chunkX * 50;
    const worldZ = chunkZ * 50;
    const continentMask = this.terrainGenerator?.getContinentMask(worldX, worldZ) || 0;

    // Your terrain requirements (e.g., forests, mountains)
    if (continentMask < 0.8) return false;

    const hash = this._fnvHash(`${chunkX},${chunkZ}_[YourAI]`);
    return (hash % GAME_CONFIG.[YourAI]_CONFIG.CHUNK_PROBABILITY) === 0;
}

// Position validation - CRITICAL for proper placement
findValid[YourAI]Position(centerX, centerZ, radiusTiers, placedPositions, rng) {
    if (!this.terrainGenerator) return null;

    const config = GAME_CONFIG.[YourAI]_CONFIG;
    const attemptsPerTier = config?.PLACEMENT_ATTEMPTS_PER_TIER || 8;
    const minSeparation = config?.MIN_STRUCTURE_SEPARATION || 2;
    const tiers = Array.isArray(radiusTiers) ? radiusTiers : [radiusTiers];

    for (const radius of tiers) {
        for (let attempt = 0; attempt < attemptsPerTier; attempt++) {
            const angle = rng() * Math.PI * 2;
            const dist = radius > 0 ? radius * (0.8 + rng() * 0.4) : 0;
            const x = centerX + Math.cos(angle) * dist;
            const z = centerZ + Math.sin(angle) * dist;

            // Check collision with existing structures
            let valid = true;
            for (const placed of placedPositions) {
                const dx = x - placed.x;
                const dz = z - placed.z;
                const distSq = dx * dx + dz * dz;
                if (distSq < minSeparation * minSeparation) {
                    valid = false;
                    break;
                }
            }
            if (!valid) continue;

            // Snap to grid
            const snappedX = Math.round(x / 0.25) * 0.25;
            const snappedZ = Math.round(z / 0.25) * 0.25;

            // Get terrain height
            const y = this.terrainGenerator.getWorldHeight(snappedX, snappedZ);

            // WATER CHECK - Skip underwater positions
            const waterLevel = GAME_CONFIG.WATER?.LEVEL || 0;
            if (y < waterLevel) continue;

            return { x: snappedX, y, z: snappedZ };
        }
    }
    return null;
}

// Add generation method
generate[YourAI]Structures(chunkX, chunkZ, chunkSeed, existingPositions) {
    const structures = [];
    const rng = this.createSeededRNG(chunkSeed + [YourAI]_SEED_OFFSET);
    const centerX = chunkX * 50;
    const centerZ = chunkZ * 50;

    const config = GAME_CONFIG.[YourAI]_CONFIG;
    const count = config.MIN_STRUCTURES +
        Math.floor(rng() * (config.MAX_STRUCTURES - config.MIN_STRUCTURES + 1));

    for (let i = 0; i < count; i++) {
        // Use validated position finding with collision avoidance
        const pos = this.findValid[YourAI]Position(
            centerX, centerZ,
            config.PLACEMENT_RADIUS_TIERS || [5, 10, 15],
            existingPositions,
            rng
        );
        if (pos) {
            structures.push({
                type: '[structureType]',  // e.g., 'den', 'grave'
                id: `[YourAI]_${chunkX},${chunkZ}_${i}`,
                position: pos,
                is[YourAI]Structure: true
            });
            existingPositions.push({ x: pos.x, z: pos.z, radius: 2 });
        }
    }

    return structures;
}

// Called from MessageRouter when chunk loads
checkAndGenerate[YourAI]Structures(chunkId, objectChanges, networkManager) {
    const [chunkX, chunkZ] = this.parseChunkId(chunkId);

    if (!this.is[YourAI]Chunk(chunkX, chunkZ)) return;

    // Check if structures already exist
    const hasExisting = objectChanges.some(obj =>
        obj.id?.startsWith('[YourAI]_')
    );
    if (hasExisting) return;

    // Generate and send to server
    const structures = this.generate[YourAI]Structures(chunkX, chunkZ, this.chunkSeed, []);
    for (const struct of structures) {
        networkManager.send({
            type: `place_${struct.type}`,
            objectId: struct.id,
            position: struct.position,
            is[YourAI]Structure: true,
            materialQuality: 30
        });
    }
}
```

---

## Step 17: Structure Factory Registration

### File: `public/network/SceneObjectFactory.js`

In `createObjectInScene()`:

```javascript
// Set structure flag on mesh userData
objectInstance.userData.is[YourAI]Structure = data.is[YourAI]Structure || false;

// Register for AI detection
if (data.is[YourAI]Structure && this.game.gameState) {
    const chunkKey = `${Math.floor(x / 50)},${Math.floor(z / 50)}`;
    this.game.gameState.register[YourAI]Structure(chunkKey, {
        id: objectInstance.userData.objectId,
        position: { x, y, z },
        type: structureType,
        object: objectInstance
    });
}
```

---

## Step 18: Chunk Lifecycle Management

### File: `public/world/ChunkManager.js`

In chunk disposal:

```javascript
// Clear structure registry
const chunkKey = `${gridX},${gridZ}`;
if (this.game.gameState?.[YourAI]StructuresByChunk) {
    this.game.gameState.[YourAI]StructuresByChunk.delete(chunkKey);
}

// Notify controller
if (this.game.[YourAI]Controller) {
    this.game.[YourAI]Controller.onChunkUnloaded(chunkKey);
}
```

### Add to your controller:

```javascript
onChunkUnloaded(chunkKey) {
    // Remove entities in this chunk
    // THIS is where dead entities finally get removed from the map,
    // enabling respawn when player returns (see Step 8: Death Handling)
    for (const [id, entity] of this.entities) {
        const entityChunkX = Math.floor(entity.homePosition.x / 50);
        const entityChunkZ = Math.floor(entity.homePosition.z / 50);
        const entityChunkKey = `${entityChunkX},${entityChunkZ}`;

        if (entityChunkKey === chunkKey) {
            this.destroyVisual(id);
            this.entities.delete(id);  // Now respawn is allowed when chunk reloads
        }
    }
}
```

---

# Phase 6: Polish (Optional)

## Step 19: UI & Feedback

This step combines several small integrations.

### CombatHUD Warning

**File: `public/ui/CombatHUD.js`**

The CombatHUD displays in the **lower-right corner** of the screen during combat.

In `update()`, add a case for your AI type in the targetType check:

```javascript
} else if (targetType === '[yourai]') {
    this.warningEl.textContent = '[YOURAI] NEARBY';
}
```

**File: `public/game.js`**

Also update the targetType determination where `combatHUD.update()` is called:

```javascript
const targetType = target.isDeer ? 'deer' : (target.isBear ? 'bear' : (target.is[YourAI] ? '[yourai]' : 'bandit'));
```

### Spawn Avoidance

**File: `public/spawn/SpawnUtils.js`**

```javascript
const [YourAI]_RADIUS = 30;  // Don't spawn players within 30 units

// In findValidSpawnPoint():
if (game.[YourAI]Controller) {
    const hasNearby = game.[YourAI]Controller.hasNearbyEntities(
        testX, testZ, [YourAI]_RADIUS
    );
    if (hasNearby) {
        continue;  // Skip this spawn point
    }
}
```

Add to your controller:
```javascript
hasNearbyEntities(x, z, radius) {
    const radiusSq = radius * radius;
    for (const [id, entity] of this.entities) {
        if (entity.state === 'dead') continue;
        const dx = entity.position.x - x;
        const dz = entity.position.z - z;
        if (dx * dx + dz * dz < radiusSq) {
            return true;
        }
    }
    return false;
}
```

### Navigation Obstacles

**File: `public/navigation/NavigationMap.js`**

If your structures need custom obstacle shapes:

```javascript
// In addObstaclesFromObjectList():
if (object.userData.is[YourAI]Structure) {
    this.addObstacle({
        x: object.position.x,
        z: object.position.z,
        radius: [your radius],
        type: 'cylinder'
    });
}
```

### AI Sounds (Chase/Attack)

To add sounds that play during AI chase or attack behaviors (like bear roars):

**1. Register the sound in `public/audio.js`:**

```javascript
// In the soundsToLoad array:
{ name: '[yourai]', path: 'sounds/[yourai].mp3' },
```

**2. Add sound config to your AI controller:**

```javascript
// In AI_CONFIG.[YourAI]:
ROAR_INTERVAL: 3000,       // Play sound every 3 seconds while chasing/attacking
```

**3. Add lastRoarTime to entity creation:**

```javascript
// In _spawnEntity() and handleSpawnMessage():
const entity = {
    // ... other fields
    lastRoarTime: 0,
};
```

**4. Add _playRoar method to controller:**

```javascript
_playRoar(entity) {
    // Play sound through AudioManager as positional audio
    if (this.game?.audioManager && entity.mesh) {
        this.game.audioManager.playPositionalSound('[yourai]', entity.mesh);
    }
}
```

**5. Add roar calls in state machine:**

```javascript
// When transitioning to chase (idle -> chasing):
case 'idle':
    if (target) {
        entity.state = 'chasing';
        // Play roar immediately when starting chase
        entity.lastRoarTime = now;
        this._playRoar(entity);
    }
    break;

// During chasing state (play periodically):
case 'chasing':
    if (!target || isLeashed) {
        entity.state = 'returning';
    } else {
        // ... movement logic ...

        // Play roar periodically while chasing
        if (now - entity.lastRoarTime >= config.ROAR_INTERVAL) {
            entity.lastRoarTime = now;
            this._playRoar(entity);
        }
    }
    break;

// During attacking state (play periodically):
case 'attacking':
    // ... attack logic ...

    // Play roar periodically while attacking
    if (now - entity.lastRoarTime >= config.ROAR_INTERVAL) {
        entity.lastRoarTime = now;
        this._playRoar(entity);
    }
    break;

// When re-engaging from returning state:
case 'returning':
    if (target && !isLeashed) {
        entity.state = 'chasing';
        // Play roar when re-engaging target
        entity.lastRoarTime = now;
        this._playRoar(entity);
    }
    break;
```

**Note:** If your AI should use the same sound file as another AI (e.g., brown bear using bear.mp3), register it with a different name but the same path:

```javascript
{ name: 'bear', path: 'sounds/bear.mp3' },
{ name: 'brownbear', path: 'sounds/bear.mp3' },  // Same file, different name
```

---

## Step 20: Loot Generation

**Skip if your AI's structures don't contain loot.**

### File: Create `server/[YourAI]LootGenerator.js`

```javascript
function createSeededRNG(seed) {
    let state = seed;
    return function() {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function generate[YourAI]Loot(structureId) {
    // Create seed from structureId string
    let seed = 0;
    for (let i = 0; i < structureId.length; i++) {
        seed = ((seed << 5) - seed) + structureId.charCodeAt(i);
        seed |= 0;
    }
    const rng = createSeededRNG(seed);

    const items = [];

    // Add your loot generation logic
    // Example:
    const goldAmount = Math.floor(rng() * 30) + 5;
    items.push({
        type: 'coin',
        id: `${structureId}_coin`,
        quantity: goldAmount,
        gridX: 0,
        gridY: 0
    });

    return items;
}

module.exports = { generate[YourAI]Loot };
```

### File: `server.js` (Add Message Case)

**IMPORTANT**: You must add a case for your structure's place message:

```javascript
// In the message handler switch statement:
case 'place_[structureType]':
    await messageHandlers.handlePlace[StructureType](payload);
    break;
```

### File: `server/MessageHandlers.js` (Full Handler)

```javascript
// Import at top (if using loot)
const { generate[YourAI]Loot } = require('./[YourAI]LootGenerator.js');

/**
 * Handle place_[structureType] message
 * Creates [YourAI] structure (procedurally generated)
 */
async handlePlace[StructureType](payload) {
    try {
        const { position, rotation, materialQuality, is[YourAI]Structure, objectId } = payload;

        // Validate position
        if (!validatePosition(position)) {
            console.warn('[Place[StructureType]] Invalid position:', position);
            return;
        }

        // Calculate chunk from position
        const chunkId = ChunkCoordinates.worldToChunkId(position[0], position[2]);

        // Use provided objectId or generate unique ID
        const structureId = objectId || `[structureType]_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Quality for procedural structures
        const quality = materialQuality || 30;

        // Generate loot if applicable
        const inventory = is[YourAI]Structure ? generate[YourAI]Loot(structureId) : [];

        // Create structure object
        const structureChange = {
            action: 'add',
            id: structureId,
            name: '[structureType]',
            position: position,
            rotation: rotation || 0,
            scale: 1.0,
            quality: quality,
            lastRepairTime: Date.now(),
            chunkId: chunkId,
            is[YourAI]Structure: is[YourAI]Structure || false,
            inventory: inventory
        };

        // Save to chunk file
        await this.chunkManager.addObjectChange(chunkId, structureChange);

        // Calculate durability for broadcast
        const durabilityInfo = enrichStructureWithDurability(structureChange);

        // Broadcast to all clients in 3x3 grid
        this.messageRouter.broadcastTo3x3Grid(chunkId, {
            type: 'object_added',
            payload: {
                chunkId: chunkId,
                objectId: structureId,
                objectType: '[structureType]',
                position: position,
                rotation: rotation || 0,
                scale: 1.0,
                quality: quality,
                currentDurability: durabilityInfo.currentDurability,
                hoursUntilRuin: durabilityInfo.hoursUntilRuin,
                is[YourAI]Structure: is[YourAI]Structure || false
            }
        });
    } catch (error) {
        console.error('ERROR in place_[structureType]:', error);
    }
}
```

---

# Phase 7: Optimization

## Step 21: TickManager Integration

The TickManager provides **deterministic position synchronization** for AI targeting.

### Why It Matters:

```
Without TickManager:
  Client A sees player at (10, 0, 5)
  Client B sees player at (10.2, 0, 5.1)  <- network latency
  -> AI on Client A targets player
  -> AI on Client B doesn't (player out of range)
  -> Inconsistent behavior!

With TickManager:
  Both clients use position from tick N-1
  -> Both see player at same position
  -> Both make same AI decision
  -> Deterministic!
```

### How It Works:

1. **Server broadcasts tick** every second with tick number
2. **TickManager captures positions** of all players at each tick
3. **AI uses delayed positions** (1 tick behind) for targeting decisions
4. **All clients use same tick data** = same decisions

### TickManager Methods:

| Method | Returns | Description |
|--------|---------|-------------|
| `hasSimulationData()` | boolean | True if position buffer has data |
| `getSimulationPositions()` | Map | `playerId -> {x, y, z}` at simulation tick |
| `getSimulationTick()` | number | Current tick minus delay (default: 1) |
| `getPlayerSimulationPosition(id)` | object | Single player's position |

### Integration:

Already included in Step 5's `_buildPlayerList()` - just make sure you:

1. Pass `tickManager` in the initialize config (Step 13)
2. Store the reference: `this.tickManager = config.tickManager`
3. Use `this.tickManager.getSimulationPositions()` for targeting

---

## Step 22: Performance Optimizations

### 1. Squared Distance Comparisons

```javascript
// BAD - uses sqrt every frame
const distance = Math.sqrt(dx * dx + dz * dz);
if (distance < range) { ... }

// GOOD - avoids sqrt
const distanceSq = dx * dx + dz * dz;
if (distanceSq < range * range) { ... }
```

### 2. Distance Culling

Update distant AI less frequently:

```javascript
// In update():
const NEAR_DISTANCE_SQ = 50 * 50;
const FAR_UPDATE_INTERVAL = 4;

for (const [id, entity] of this.entities) {
    if (myPos && entity.state !== 'dead') {
        const dx = entity.position.x - myPos.x;
        const dz = entity.position.z - myPos.z;
        const distSq = dx * dx + dz * dz;

        if (distSq > NEAR_DISTANCE_SQ) {
            if (this._frameCount % FAR_UPDATE_INTERVAL !== 0) {
                continue;  // Skip this frame
            }
        }
    }

    this._updateEntity(entity, deltaTime, now, players);
}
```

### 3. Idle Check Throttling

```javascript
// Only check for targets periodically when idle
if (entity.state === 'idle') {
    if (this._frameCount % config.IDLE_CHECK_INTERVAL === 0) {
        target = this._findClosestPlayer(...);
    }
} else {
    target = this._findClosestPlayer(...);
}
```

### 4. Pathfinding Throttling

Already included in Step 7 - only recalculate every `PATHFIND_INTERVAL` ms.

### 5. Terrain Height Caching

Already included in Step 7 - only recalculate every 5 frames.

### 6. Object Pooling

Already included in Step 5's `_buildPlayerList()`.

### 7. Spawn Presence Caching

Already included in Step 6's `updateStructurePresence()`.

### Performance Checklist:

- [ ] Use squared distances for range checks
- [ ] Implement distance culling for far entities
- [ ] Throttle idle state target checks
- [ ] Throttle pathfinding recalculation
- [ ] Cache terrain height queries
- [ ] Pool frequently created objects
- [ ] Cache spawn structure presence

---

# Reference

## Testing Checklist

### Basic Functionality
- [ ] AI spawns when player approaches spawn structure
- [ ] AI displays correct model and animations
- [ ] AI name tag shows above entity
- [ ] AI detects and targets player
- [ ] AI moves toward player (pathfinding works)
- [ ] AI stops at leash range (if applicable)
- [ ] AI returns home when player leaves

### Combat
- [ ] AI attacks/shoots at correct range
- [ ] Hit chance feels appropriate
- [ ] Player takes damage when hit
- [ ] Attack sounds play
- [ ] Visual effects display (muzzle flash, etc.)

### Death
- [ ] AI can be killed by player
- [ ] Death animation plays
- [ ] AI stops all behavior when dead
- [ ] Name tag updates to show "(DEAD)"
- [ ] Visual cleanup happens after delay

### Multiplayer
- [ ] Only one client spawns each AI (authority)
- [ ] Other clients see AI spawn
- [ ] Position syncs smoothly between clients
- [ ] Authority transfers when original authority leaves
- [ ] Combat results are consistent across clients

### Edge Cases
- [ ] AI handles player disconnect
- [ ] AI handles chunk unloading
- [ ] Multiple AIs don't interfere with each other
- [ ] Performance is acceptable with many AIs

---

## File Changes Summary

| File | Changes |
|------|---------|
| `public/config.js` | Add `[YourAI]_CONFIG` section |
| `public/core/GameState.js` | Add `[YourAI]StructuresByChunk` Map and methods |
| `public/ai/[YourAI]Controller.js` | **NEW FILE** - Main AI logic |
| `public/ai/AIRegistry.js` | Register controller, add fear relationships |
| `public/[YourAI]-visual.js` | **NEW FILE** (or reuse ai-enemy.js) |
| `public/entity/[YourAI]Manager.js` | **NEW FILE** - Entity management |
| `public/network/GameStateManager.js` | Add message handlers (6 types) |
| `public/network/SceneObjectFactory.js` | Register `is[YourAI]Structure` flag |
| `public/core/GameInitializer.js` | Add `initialize[YourAI]Controller()`, pass TickManager |
| `public/core/TickManager.js` | Pass to controller for deterministic targeting |
| `public/game.js` | Add to update loop |
| `public/network/MessageRouter.js` | Add to tick handler, structure generation |
| `public/player/PlayerCombat.js` | Add hit detection |
| `public/systems/ChunkObjectGenerator.js` | Add procedural generation (if needed) |
| `public/spawn/SpawnUtils.js` | Add spawn avoidance radius |
| `public/world/ChunkManager.js` | Add chunk unload cleanup |
| `public/ui/CombatHUD.js` | Add warning text |
| `server/[YourAI]LootGenerator.js` | **NEW FILE** (if loot needed) |
| `server/MessageHandlers.js` | Add loot generation on structure place |

---

## P2P Message Types

### Spawn Message
```javascript
{
    type: '[YourAI]_spawn',
    structureId: string,
    spawnedBy: string,      // clientId
    spawnTime: number,      // timestamp
    position: {x, y, z},
    homePosition: {x, z}
}
```

### State Message (broadcast every tick by authority)
```javascript
{
    type: '[YourAI]_state',
    structureId: string,
    position: {x, y, z},
    rotation: number,
    state: string,          // 'idle', 'chasing', etc.
    target: string|null,    // targetId
    shotCount: number,      // or attackCount
    pendingKills: string[], // playerIds hit
    moving: boolean,
    inCombatStance: boolean,
    speedMultiplier: number
}
```

### Combat Message (ranged)
```javascript
{
    type: '[YourAI]_shoot',
    structureId: string,
    targetId: string,
    targetType: string,     // 'player' or other AI type
    didHit: boolean,
    position: {x, y, z}
}
```

### Combat Message (melee)
```javascript
{
    type: '[YourAI]_attack',
    structureId: string,
    targetId: string,
    position: {x, y, z}
}
```

### Death Message
```javascript
{
    type: '[YourAI]_death',
    structureId: string,
    killedBy: string        // clientId
}
```

### Kill Acknowledgment
```javascript
{
    type: '[YourAI]_kill_ack',
    structureId: string,
    playerId: string        // who was killed
}
```

### Sync Message (when peer joins)
```javascript
{
    type: '[YourAI]_sync',
    entities: [
        {
            structureId: string,
            position: {x, y, z},
            homePosition: {x, z},
            state: string,
            authorityId: string,
            spawnTime: number
        },
        // ... all active entities
    ]
}
```

### Sync Flow:

1. New peer joins game
2. Authority sends `[YourAI]_sync` with all active entities
3. New peer creates visuals for each entity
4. New peer starts receiving regular `_state` updates

### Sync Handler

```javascript
// In your controller:
syncEntitiesFromPeer(entities) {
    for (const data of entities) {
        if (this.entities.has(data.structureId)) continue;

        const entity = {
            [this.entityIdField]: data.structureId,
            type: this.entityType,
            authorityId: data.authorityId,
            spawnedBy: data.authorityId,
            spawnTime: data.spawnTime,
            homePosition: data.homePosition,
            position: { ...data.position },
            state: data.state || 'idle',
            // ... other fields
        };

        this.entities.set(data.structureId, entity);
        entity.controller = this.createVisual(data.structureId, entity.position);
        entity.mesh = entity.controller?.enemy;
    }
}

getActiveEntitiesForSync() {
    const active = [];
    for (const [id, entity] of this.entities) {
        if (entity.state === 'dead') continue;
        active.push({
            structureId: id,
            position: entity.position,
            homePosition: entity.homePosition,
            state: entity.state,
            authorityId: entity.authorityId,
            spawnTime: entity.spawnTime
        });
    }
    return active;
}
```

---

# Appendix: Adding Wandering Behavior

This worked example shows how to add **wandering behavior** to an existing AI. The AI will:
- Stand idle for a duration
- Pick a random direction and walk slowly
- Repeat the cycle
- Still detect and react to threats while wandering

This example uses **BrownBearController** but the pattern applies to any AI.

---

## Overview

```
idle (10s) ──→ wandering (5s) ──→ idle ──→ ...
     │              │
     └──→ chasing ←─┘
```

Key differences from pathfinding-based movement:
- **Direction-based**: Picks a random angle, walks that direction
- **Time-limited**: Wanders for fixed duration, not until reaching a destination
- **Collision handling**: Stops if hitting water/obstacles

---

## Step 1: Add Config Values

```javascript
// In AI_CONFIG.[YourAI]:
SPAWN_HEIGHT_MIN: 0.5,     // Water level check
WANDER_SPEED: 0.5,         // Slow walk (vs MOVE_SPEED for chasing)
WANDER_DURATION: 5000,     // 5 seconds of wandering
IDLE_DURATION: 10000,      // 10 seconds idle before wandering
```

---

## Step 2: Add Entity Fields

```javascript
// In entity creation (_spawnEntity and handleSpawnMessage):
const entity = {
    // ... existing fields ...

    // State timing
    stateStartTime: now,      // When current state began
    wanderDirection: null,    // { x, z } normalized direction vector
};
```

---

## Step 3: Add Movement Method

Unlike `_moveAlongPath` which follows waypoints, `_moveInDirection` walks in a fixed direction:

```javascript
_moveInDirection(entity, dirX, dirZ, speed, deltaTime) {
    const config = AI_CONFIG.[YourAI];
    const moveAmount = speed * (deltaTime / 1000);

    const newX = entity.position.x + dirX * moveAmount;
    const newZ = entity.position.z + dirZ * moveAmount;
    const newY = this.getTerrainHeight(newX, newZ);

    // Stop at water
    if (newY < config.SPAWN_HEIGHT_MIN) {
        return false;  // Hit water, caller should handle
    }

    entity.position.x = newX;
    entity.position.z = newZ;
    entity.position.y = newY;
    entity.rotation = Math.atan2(dirX, dirZ);

    return true;  // Movement succeeded
}
```

---

## Step 4: Add State Transition Methods

```javascript
_startIdle(entity, now) {
    entity.state = 'idle';
    entity.stateStartTime = now;
    entity.wanderDirection = null;
}

_startWandering(entity, now) {
    entity.state = 'wandering';
    entity.stateStartTime = now;

    // Pick random direction (0 to 2π)
    const angle = Math.random() * Math.PI * 2;
    entity.wanderDirection = {
        x: Math.sin(angle),
        z: Math.cos(angle)
    };
}
```

---

## Step 5: Update State Machine

```javascript
_updateEntity(entity, deltaTime, now, players) {
    const config = AI_CONFIG.[YourAI];

    // ... authority check, target finding ...

    // Time in current state
    const elapsed = now - entity.stateStartTime;

    switch (entity.state) {
        case 'idle':
            if (target) {
                entity.state = 'chasing';
                entity.wanderDirection = null;
                // ... chase setup ...
            } else if (elapsed >= config.IDLE_DURATION) {
                this._startWandering(entity, now);
            }
            break;

        case 'wandering': {
            // Can still detect threats while wandering
            if (target) {
                entity.state = 'chasing';
                entity.wanderDirection = null;
                break;
            }

            if (elapsed >= config.WANDER_DURATION) {
                this._startIdle(entity, now);
            } else if (entity.wanderDirection) {
                const moved = this._moveInDirection(
                    entity,
                    entity.wanderDirection.x,
                    entity.wanderDirection.z,
                    config.WANDER_SPEED,
                    deltaTime
                );
                if (!moved) {
                    // Hit water/obstacle, stop and go idle
                    this._startIdle(entity, now);
                }
            }
            break;
        }

        case 'chasing':
            // ... existing chase logic ...
            break;

        case 'returning':
            if (atHome) {
                this._startIdle(entity, now);  // Use helper instead of direct assignment
            }
            // ... existing return logic ...
            break;
    }

    // Update visual flags
    if (entity.controller) {
        entity.controller.moving = entity.state === 'chasing' ||
                                   entity.state === 'returning' ||
                                   entity.state === 'wandering';
        entity.controller.isWandering = entity.state === 'wandering';
    }
}
```

---

## Step 6: Add Visual Flag for Walk Animation

The visual controller needs to use a **walk animation** for wandering (slow) vs **run animation** for chasing (fast).

```javascript
// In Visual Controller constructor:
this.isWandering = false;  // Add new flag

// In Visual Controller update():
} else if (this.moving) {
    // Wandering uses walk, chasing uses run
    if (this.isWandering && this.walkAction) {
        // Stop run if playing
        if (this.runAction && this.runAction.isRunning()) this.runAction.stop();

        if (!this.walkAction.isRunning() || this.walkAction.paused) {
            this.walkAction.reset();
            this.walkAction.play();
            this.walkAction.paused = false;
        }
        this.mixer.update((deltaTime / 1000) * this.speedMultiplier);
    } else if (this.runAction) {
        // Use run animation for chasing/returning
        if (!this.runAction.isRunning()) {
            if (this.walkAction) this.walkAction.stop();
            this.runAction.reset();
            this.runAction.play();
        }
        this.mixer.update((deltaTime / 1000) * this.speedMultiplier);
    }
}
```

---

## Step 7: Update P2P Sync

Include `wanderDirection` in state broadcasts so all clients walk the same direction:

```javascript
// In _broadcastState():
_broadcastState(entity) {
    const msg = {
        type: '[YourAI]_state',
        structureId: entity.[structureId],
        position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
        rotation: entity.rotation,
        state: entity.state,
        target: entity.target,
    };

    // Include wander direction if wandering
    if (entity.wanderDirection) {
        msg.wanderDirection = { x: entity.wanderDirection.x, z: entity.wanderDirection.z };
    }

    this.broadcastP2P(msg);
}

// In handleStateMessage():
handleStateMessage(data) {
    const { structureId, position, rotation, state, target, wanderDirection } = data;

    // ... existing code ...

    // Store wander direction
    if (wanderDirection) {
        entity.wanderDirection = { x: wanderDirection.x, z: wanderDirection.z };
    } else {
        entity.wanderDirection = null;
    }

    // Update visual flags
    if (entity.controller) {
        entity.controller.moving = state === 'chasing' || state === 'returning' || state === 'wandering';
        entity.controller.isWandering = state === 'wandering';
    }
}
```

---

## Summary of Changes

| File | Changes |
|------|---------|
| Controller config | Add `WANDER_SPEED`, `WANDER_DURATION`, `IDLE_DURATION`, `SPAWN_HEIGHT_MIN` |
| Entity object | Add `stateStartTime`, `wanderDirection` |
| Controller methods | Add `_moveInDirection()`, `_startIdle()`, `_startWandering()` |
| State machine | Add `wandering` case, update `idle` to transition after duration |
| Visual controller | Add `isWandering` flag, update animation logic |
| P2P sync | Include `wanderDirection` in state messages |

---

## Design Notes

**Q: Why not use pathfinding for wandering?**

Pathfinding is expensive and designed for goal-directed movement. Wandering is simpler:
- Pick direction → walk → stop
- No destination, no path recalculation
- Lower CPU cost

**Q: What if the AI wanders too far from home?**

Two options:
1. **Ignore it** (self-correcting): When the AI eventually chases a player and gets leashed, it returns home via the `returning` state
2. **Leash check**: Add a distance check in the wandering state to trigger `returning` if too far

**Q: Should wandering respect the leash?**

For most AIs, no. The drift is slow (0.5 u/s × 5s = 2.5 units per cycle) and the returning state naturally corrects it. Only add a leash check if your AI wanders very fast or for very long durations.

---

# Appendix: Structure Demolition and Decay

This appendix covers how to configure your AI's spawn structure for:
1. **Player demolition**: Allow/prevent players from destroying the structure
2. **Durability decay**: Allow/prevent the structure from degrading over time

---

## Overview

By default, AI spawn structures (like `bearden` for brown bears or `tent` for bandits) may or may not be:
- Demolishable by players with a hammer
- Subject to durability decay over time

These are controlled by separate systems:

| Feature | Controlled By |
|---------|---------------|
| Demolition | `structureTypes` arrays in 3 files |
| Decay | `isBrownBearStructure` / `isBanditStructure` flags |

---

## Making a Structure Demolishable

To allow players to demolish your AI's spawn structure, add your structure type to three `structureTypes` arrays:

### File 1: `public/systems/InteractionManager.js`

Find the `structureTypes` array in `checkProximityToObjects()` (around line 139):

```javascript
// Before:
const structureTypes = ['crate', 'tent', 'house', 'garden', 'market', 'outpost', 'ship', 'dock', 'campfire', 'tileworks'];

// After:
const structureTypes = ['crate', 'tent', 'house', 'garden', 'market', 'outpost', 'ship', 'dock', 'campfire', 'tileworks', '[yourStructure]'];
```

This enables the structure to be detected as a "nearby structure" for interaction.

### File 2: `public/ui.js`

Find the `structureTypes` array in the UI button logic (around line 870):

```javascript
// Before:
const structureTypes = ['crate', 'tent', 'house', 'garden', 'market', 'outpost', 'ship', 'dock', 'campfire', 'tileworks'];

// After:
const structureTypes = ['crate', 'tent', 'house', 'garden', 'market', 'outpost', 'ship', 'dock', 'campfire', 'tileworks', '[yourStructure]'];
```

This shows the "Demolish [Structure]" button when the player is near the structure.

### File 3: `public/systems/ActionManager.js`

Find the `structureTypes` array in `startRemovalAction()` (around line 25):

```javascript
// Before:
const structureTypes = ['construction', 'foundation', 'foundationcorner', 'foundationroundcorner',
    'crate', 'tent', 'house', 'garden', 'market', 'outpost', 'ship', 'dock', 'tileworks'];

// After:
const structureTypes = ['construction', 'foundation', 'foundationcorner', 'foundationroundcorner',
    'crate', 'tent', 'house', 'garden', 'market', 'outpost', 'ship', 'dock', 'tileworks', '[yourStructure]'];
```

This allows the demolish action to execute on the structure.

---

## Preventing Durability Decay

To prevent your AI's spawn structure from decaying over time (losing durability until it becomes a ruin), add a check in the decay system:

### File: `public/network/MessageRouter.js`

Find the decay check loop in `updateStructureDecay()` (around line 2186-2188):

```javascript
// Before:
// Skip bandit structures (shouldn't be in set, but double-check)
if (object.userData.isBanditStructure) continue;

// After:
// Skip bandit structures (shouldn't be in set, but double-check)
if (object.userData.isBanditStructure) continue;

// Skip [YourAI] structures (no decay)
if (object.userData.is[YourAI]Structure) continue;
```

**Note:** This requires your structure to have the `is[YourAI]Structure` flag set when created. This is already done if you followed Step 16-17 of the main guide:

```javascript
// In ChunkObjectGenerator.js:
{
    type: '[structureType]',
    id: `[yourAI]_${chunkX},${chunkZ}`,
    is[YourAI]Structure: true  // This flag
}

// In SceneObjectFactory.js:
objectInstance.userData.is[YourAI]Structure = data.is[YourAI]Structure || false;
```

---

## Example: Brown Bear Den

The `bearden` structure was configured to be:
- ✅ Demolishable by players
- ✅ Protected from decay

### Changes Made:

**1. InteractionManager.js:139**
```javascript
const structureTypes = ['crate', 'tent', 'house', 'garden', 'market', 'outpost', 'ship', 'dock', 'campfire', 'tileworks', 'bearden'];
```

**2. ui.js:870**
```javascript
const structureTypes = ['crate', 'tent', 'house', 'garden', 'market', 'outpost', 'ship', 'dock', 'campfire', 'tileworks', 'bearden'];
```

**3. ActionManager.js:25-26**
```javascript
const structureTypes = ['construction', 'foundation', 'foundationcorner', 'foundationroundcorner',
    'crate', 'tent', 'house', 'garden', 'market', 'outpost', 'ship', 'dock', 'tileworks', 'bearden'];
```

**4. MessageRouter.js:2190-2191**
```javascript
// Skip brown bear den structures (no decay)
if (object.userData.isBrownBearStructure) continue;
```

---

## Design Considerations

**Q: Why would I want players to demolish AI spawn structures?**

- Allows players to "clear out" dangerous areas
- Prevents permanent AI presence in desirable locations
- Gives players agency over the world

**Q: Why would I want to prevent demolition?**

- Ensures AI always has a home location to return to
- Prevents players from trivially eliminating AI threat
- Maintains world structure integrity

**Q: Why protect from decay?**

AI spawn structures are typically procedurally generated and not owned by players. Without decay protection, they would eventually turn to ruins and stop spawning AI. For player-built structures, decay creates maintenance gameplay. For AI structures, decay would just make them disappear with no way to rebuild.

**Q: What happens when a demolishable AI structure is destroyed?**

- The AI entity associated with that structure will continue to exist until killed or chunk unloads
- When the chunk reloads, no new AI will spawn (no structure to spawn from)
- The structure removal is saved to the chunk file permanently

---

## Summary

| Goal | Files to Modify |
|------|-----------------|
| Allow demolition | InteractionManager.js, ui.js, ActionManager.js (add to `structureTypes` arrays) |
| Prevent decay | MessageRouter.js (add `is[YourAI]Structure` check in decay loop) |

---

## Structure Removal and Registry Cleanup

When a spawn structure is removed (demolished by player or destroyed), the AI spawn registry must be properly cleaned up. **A race condition can cause "ghost" registry entries** that spawn AI from non-existent structures.

### The Problem: Queue Race Condition

AI spawn structures use `StructureCreationQueue` for frame-spread creation (prevents stutter). This creates a race condition:

```
Timeline:
1. object_added arrives → Structure queued (not yet created)
2. object_removed arrives → findObjectById returns null → unregister skipped!
3. Queue processes → Structure created → registered in spawn registry
4. Result: "Ghost" registry entry - no object exists but AI can spawn from it
```

### The Fix: MessageRouter.js handleObjectRemoved

The fix has two parts:

**Part 1: Remove from queue BEFORE processing**

```javascript
// In handleObjectRemoved(), at the very start:
// Remove from structure creation queue if still queued (prevents ghost registration)
const queue = getStructureCreationQueue();
queue.removeQueued(payload.objectId);
```

**Part 2: Fallback unregister using payload data**

When `findObjectById()` returns null (object never created), use the message payload to unregister:

```javascript
// Unregister AI spawn structures from detection registries
// Uses fallback to payload data when objectToRemove is null (handles queue race condition)
if (this.game.gameState) {
    const chunkKey = objectToRemove?.userData?.chunkKey || payload.chunkId?.replace('chunk_', '');

    if (chunkKey) {
        // Bandit structures: tent, outpost, campfire, horse
        const banditTypes = new Set(['tent', 'outpost', 'campfire', 'horse']);
        const isBanditStructure = objectToRemove?.userData?.isBanditStructure ||
            banditTypes.has(payload.name);
        if (isBanditStructure) {
            this.game.gameState.unregisterBanditStructure(chunkKey, payload.objectId);
        }

        // Brown bear structures: bearden
        const isBrownBearStructure = objectToRemove?.userData?.isBrownBearStructure ||
            payload.name === 'bearden';
        if (isBrownBearStructure) {
            this.game.gameState.unregisterBrownBearStructure(chunkKey, payload.objectId);
        }

        // Deer structures: deertree
        const isDeerTreeStructure = objectToRemove?.userData?.isDeerTreeStructure ||
            payload.name === 'deertree';
        if (isDeerTreeStructure) {
            this.game.gameState.unregisterDeerTreeStructure(chunkKey, payload.objectId);
        }
    }
}
```

### Why This Matters

Without this fix:
1. Player spawns near a tent structure
2. Player removes the tent quickly (before queue processes)
3. Player leaves and returns
4. AI spawns from the "ghost" registry entry
5. Player sees AI spawning from empty ground

### Adding Your AI Structure

When adding a new AI type, add a cleanup block to the fallback unregister:

```javascript
// [YourAI] structures: [structureType]
const is[YourAI]Structure = objectToRemove?.userData?.is[YourAI]Structure ||
    payload.name === '[structureType]';
if (is[YourAI]Structure) {
    this.game.gameState.unregister[YourAI]Structure(chunkKey, payload.objectId);
}
```

---

# Appendix: Structure Avoidance (Fleeing) Behavior

This appendix shows how to add **structure avoidance behavior** to an AI. The AI will:
- Detect player structures (tents, houses, campfires, etc.) within a detection range
- Flee in the opposite direction when a structure is detected
- Ignore natural objects (trees, rocks, etc.) and mobile entities (horses, carts)
- Override all other behaviors (flee has highest priority)

This example uses **BrownBearController** but the pattern applies to any AI.

---

## Overview

```
idle/wandering/chasing/attacking
         │
         └──→ [structure detected] ──→ fleeing (20s) ──→ idle
```

Key features:
- **Structure detection**: Scans chunk objects, filters out natural objects
- **Priority behavior**: Flee overrides chase, attack, and idle
- **Direction-based fleeing**: Runs directly away from the structure
- **Time-limited**: Flees for a fixed duration, then returns to idle

---

## Step 1: Add Config Values

```javascript
// In AI_CONFIG.[YourAI]:
FLEE_SPEED: 2.5,           // Units per second when fleeing
FLEE_DURATION: 20000,      // 20 seconds of fleeing
OBJECT_DETECT_RANGE: 10,   // Distance to detect structures
DETECTION_INTERVAL: 500,   // Ms between structure detection checks (throttled)

// Objects to IGNORE (don't flee from these)
NATURAL_OBJECTS: [
    'tree', 'pine', 'oak', 'fir', 'cypress', 'apple',
    'rock', 'limestone', 'sandstone', 'clay', 'iron',
    'vegetable', 'vegetables', 'grass', 'bush', 'flower',
    'horse', 'cart', 'crate', 'mobilecrate', 'bearden'  // Also ignore own spawn structures
],
```

---

## Step 2: Add Constructor Properties

```javascript
// In constructor:

// Callback for chunk objects (set in initialize)
this.getChunkObjects = null;

// Structure detection caches
this._naturalObjectsSet = new Set(AI_CONFIG.[YourAI].NATURAL_OBJECTS);
this._chunkObjectsCache = new Map();
this._chunkCacheFrame = 0;
```

---

## Step 3: Add Entity Fields

```javascript
// In entity creation (_spawnEntity and handleSpawnMessage):
const entity = {
    // ... existing fields ...

    // Flee behavior
    fleeDirection: null,       // { x, z } normalized direction vector

    // Structure detection cache
    cachedStructure: null,     // Nearest detected structure
    lastDetectionCheck: 0,     // Last time we checked for structures
};
```

---

## Step 4: Add Detection Methods

```javascript
/**
 * Get cached chunk objects for 3x3 area around entity
 * Cache is invalidated each frame to avoid stale data
 */
_getCachedChunkObjects(entity) {
    if (!this.getChunkObjects) return [];

    const config = AI_CONFIG.[YourAI];
    const chunkX = Math.floor(entity.position.x / config.CHUNK_SIZE);
    const chunkZ = Math.floor(entity.position.z / config.CHUNK_SIZE);
    const cacheKey = `${chunkX},${chunkZ}`;

    // Return cached if valid for this frame
    if (this._chunkObjectsCache.has(cacheKey) && this._chunkCacheFrame === this._frameCount) {
        return this._chunkObjectsCache.get(cacheKey);
    }

    // Build objects array for 3x3 chunk area
    const allObjects = [];
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            const key = `${chunkX + dx},${chunkZ + dz}`;
            const objs = this.getChunkObjects(key);
            if (objs) {
                for (let i = 0; i < objs.length; i++) {
                    allObjects.push(objs[i]);
                }
            }
        }
    }

    // Store in cache
    this._chunkObjectsCache.set(cacheKey, allObjects);
    this._chunkCacheFrame = this._frameCount;

    return allObjects;
}

_isNaturalObject(objectType) {
    if (!objectType) return false;
    const lower = objectType.toLowerCase();
    // O(1) check for exact match
    if (this._naturalObjectsSet.has(lower)) return true;
    // Check if type contains any natural object keyword
    for (const nat of this._naturalObjectsSet) {
        if (lower.includes(nat)) return true;
    }
    return false;
}

/**
 * Find nearest structure (for fleeing) - excludes natural objects
 */
_findNearestStructure(entity) {
    const config = AI_CONFIG.[YourAI];
    const objectRange = config.OBJECT_DETECT_RANGE;
    const objectRangeSq = objectRange * objectRange;

    let nearestStructure = null;
    let nearestDistSq = Infinity;

    const allObjects = this._getCachedChunkObjects(entity);

    for (const obj of allObjects) {
        // Skip natural objects
        if (this._isNaturalObject(obj.type)) continue;

        const pos = obj.position;
        if (!pos) continue;

        const objDx = pos.x - entity.position.x;
        const objDz = pos.z - entity.position.z;
        const distSq = objDx * objDx + objDz * objDz;

        if (distSq < objectRangeSq && distSq < nearestDistSq) {
            nearestDistSq = distSq;
            nearestStructure = { x: pos.x, z: pos.z };
        }
    }

    return nearestStructure;
}

/**
 * Update detection cache (throttled for performance)
 */
_updateDetectionCache(entity, now) {
    const config = AI_CONFIG.[YourAI];
    if (now - entity.lastDetectionCheck < config.DETECTION_INTERVAL) {
        return; // Use cached results
    }

    entity.lastDetectionCheck = now;
    entity.cachedStructure = this._findNearestStructure(entity);
}
```

---

## Step 5: Add State Transition Method

```javascript
_startFleeing(entity, threat, now) {
    entity.state = 'fleeing';
    entity.stateStartTime = now;
    entity.chaseTarget = null;

    // Direction away from threat
    const dx = entity.position.x - threat.x;
    const dz = entity.position.z - threat.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 0.001) {
        // Threat exactly on top, pick random direction
        const angle = Math.random() * Math.PI * 2;
        entity.fleeDirection = { x: Math.sin(angle), z: Math.cos(angle) };
    } else {
        entity.fleeDirection = { x: dx / dist, z: dz / dist };
    }
}
```

---

## Step 6: Update State Machine

Add detection cache update before the switch statement:

```javascript
_updateEntity(entity, deltaTime, now, players) {
    const config = AI_CONFIG.[YourAI];

    // ... authority check ...

    // Time in current state
    const elapsed = now - entity.stateStartTime;

    // Update structure detection cache (throttled)
    this._updateDetectionCache(entity, now);

    // State transitions
    switch (entity.state) {
```

Add structure check as **highest priority** at the start of each relevant state:

```javascript
        case 'idle':
            // Structure flee takes priority
            if (entity.cachedStructure) {
                this._startFleeing(entity, entity.cachedStructure, now);
                break;
            }
            // ... existing idle logic ...
            break;

        case 'wandering': {
            // Structure flee takes priority
            if (entity.cachedStructure) {
                this._startFleeing(entity, entity.cachedStructure, now);
                break;
            }
            // ... existing wandering logic ...
            break;
        }

        case 'chasing':
            // Structure flee takes priority
            if (entity.cachedStructure) {
                this._startFleeing(entity, entity.cachedStructure, now);
                break;
            }
            // ... existing chasing logic ...
            break;

        case 'attacking':
            // Structure flee takes priority
            if (entity.cachedStructure) {
                this._startFleeing(entity, entity.cachedStructure, now);
                break;
            }
            // ... existing attacking logic ...
            break;
```

Add the fleeing state case:

```javascript
        case 'fleeing': {
            // Flee from structures for FLEE_DURATION
            if (elapsed >= config.FLEE_DURATION) {
                this._startIdle(entity, now);
            } else if (entity.fleeDirection) {
                const moved = this._moveInDirection(
                    entity,
                    entity.fleeDirection.x,
                    entity.fleeDirection.z,
                    config.FLEE_SPEED,
                    deltaTime
                );
                if (!moved) {
                    // Hit water/obstacle, pick new random flee direction
                    const angle = Math.random() * Math.PI * 2;
                    entity.fleeDirection = {
                        x: Math.sin(angle),
                        z: Math.cos(angle)
                    };
                }
            }
            break;
        }
```

Update visual controller flags:

```javascript
    // Update visual controller state flags
    if (entity.controller) {
        entity.controller.moving = entity.state === 'chasing' ||
                                   entity.state === 'returning' ||
                                   entity.state === 'wandering' ||
                                   entity.state === 'fleeing';
        entity.controller.isWandering = entity.state === 'wandering';
        entity.controller.isAttacking = entity.state === 'attacking';
        entity.controller.isFleeing = entity.state === 'fleeing';
    }
```

---

## Step 7: Update P2P Sync

Include `fleeDirection` in state broadcasts:

```javascript
// In _broadcastState():
_broadcastState(entity) {
    const msg = {
        type: '[YourAI]_state',
        // ... existing fields ...
    };

    // Include wander direction if wandering
    if (entity.wanderDirection) {
        msg.wanderDirection = { x: entity.wanderDirection.x, z: entity.wanderDirection.z };
    }

    // Include flee direction if fleeing
    if (entity.fleeDirection) {
        msg.fleeDirection = { x: entity.fleeDirection.x, z: entity.fleeDirection.z };
    }

    this.broadcastP2P(msg);
}

// In handleStateMessage():
handleStateMessage(data) {
    const { ..., wanderDirection, fleeDirection } = data;

    // ... existing code ...

    // Store flee direction
    if (fleeDirection) {
        entity.fleeDirection = { x: fleeDirection.x, z: fleeDirection.z };
    } else {
        entity.fleeDirection = null;
    }

    // Update visual flags
    if (entity.controller) {
        entity.controller.moving = state === 'chasing' || state === 'returning' ||
                                   state === 'wandering' || state === 'fleeing';
        entity.controller.isWandering = state === 'wandering';
        entity.controller.isAttacking = state === 'attacking';
        entity.controller.isFleeing = state === 'fleeing';
    }
}
```

---

## Step 8: Add getChunkObjects Callback

In `GameInitializer.js`, add the callback to your controller's initialize config:

```javascript
getChunkObjects: (chunkKey) => {
    // Return objects in this chunk from ChunkManager
    const objects = this.game.chunkManager?.chunkObjects?.get(chunkKey);
    if (!objects) return [];
    // Map to simple format for structure detection
    return objects.map(obj => ({
        type: obj.userData?.modelType || obj.userData?.type,
        position: obj.position ? {
            x: obj.position.x,
            y: obj.position.y,
            z: obj.position.z
        } : null
    })).filter(o => o.position);
},
```

---

## Summary of Changes

| File | Changes |
|------|---------|
| Controller config | Add `FLEE_SPEED`, `FLEE_DURATION`, `OBJECT_DETECT_RANGE`, `DETECTION_INTERVAL`, `NATURAL_OBJECTS` |
| Controller constructor | Add `getChunkObjects`, `_naturalObjectsSet`, `_chunkObjectsCache`, `_chunkCacheFrame` |
| Entity object | Add `fleeDirection`, `cachedStructure`, `lastDetectionCheck` |
| Controller methods | Add `_getCachedChunkObjects()`, `_isNaturalObject()`, `_findNearestStructure()`, `_updateDetectionCache()`, `_startFleeing()` |
| State machine | Add structure checks at start of each state, add `fleeing` case |
| Visual flags | Add `isFleeing` flag |
| P2P sync | Include `fleeDirection` in state messages |
| GameInitializer | Add `getChunkObjects` callback |

---

## Design Notes

**Q: Why check at the start of each state instead of once before the switch?**

Each state handles the structure detection differently:
- Most states immediately transition to fleeing
- Some states (like `returning`) might ignore structures
- Checking inside allows per-state customization

**Q: Why use a NATURAL_OBJECTS list instead of a STRUCTURE list?**

It's easier to enumerate natural objects (limited set: trees, rocks, resources) than player structures (tents, houses, markets, docks, ships, etc.). Any object NOT in the natural list is treated as a structure.

**Q: What about mobile entities like horses and carts?**

These are explicitly added to NATURAL_OBJECTS. Whether the player is riding a horse or it's wild, the bear won't flee from it. Adjust this based on your AI's intended behavior.

**Q: Why cache detection results?**

Structure detection scans all objects in a 3x3 chunk area - potentially hundreds of objects. Caching reduces this to once every `DETECTION_INTERVAL` (500ms) instead of every frame.

**Q: What if the flee direction leads to water?**

The `_moveInDirection` method returns `false` when hitting water. When this happens, the fleeing state picks a new random direction and continues fleeing.

import { BaseAIController } from './BaseAIController.js';
import { getAISpawnQueue } from './AISpawnQueue.js';

/**
 * DeerController.js
 * Ambient deer AI with authority-based P2P sync
 *
 * Architecture:
 * - Spawns from deertree structures (like brown bears spawn from dens)
 * - One authority client simulates each deer
 * - Authority broadcasts state; non-authority interpolates
 *
 * States:
 * - idle: Standing still for 10 seconds, checks for threats on exit
 * - wandering: Walking in random direction at 0.5u/s for 5 seconds
 * - fleeing: Running away from threat at 2u/s for 20 seconds
 * - dead: Fallen corpse waiting for cleanup/harvest
 *
 * Threat detection:
 * - Player within 10 units
 * - Gunshot within 50 units
 * - Any non-natural object within 10 units (not tree/rock/vegetable)
 * - Bears within 10 units
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEER_CONFIG = {
    CHUNK_SIZE: 50,

    // Spawning (structure-based)
    SPAWN_RANGE: 50,        // Distance from tree to trigger spawn
    SPAWN_HEIGHT_MIN: 0.5,  // Don't spawn in water
    SPAWN_OFFSET_MIN: 2,    // Min distance from tree to spawn
    SPAWN_OFFSET_MAX: 5,    // Max distance from tree to spawn

    // Movement speeds
    WANDER_SPEED: 0.5,      // Units per second
    FLEE_SPEED: 2.0,        // Units per second

    // Leash
    LEASH_RANGE: 50,        // Max distance from home tree

    // State durations (ms)
    IDLE_DURATION: 10000,
    WANDER_DURATION: 5000,
    FLEE_DURATION: 20000,

    // Detection
    PLAYER_DETECT_RANGE: 10,
    OBJECT_DETECT_RANGE: 10,
    GUNSHOT_DETECT_RANGE: 50,
    BEAR_DETECT_RANGE: 10,

    // Rotation
    TURN_SPEED: 5.0,        // Radians per second

    // P2P sync
    BROADCAST_INTERVAL: 100,  // ms between position broadcasts

    // Natural objects (don't flee from these)
    NATURAL_OBJECTS: [
        'tree', 'pine', 'oak', 'fir', 'cypress', 'apple',
        'rock', 'limestone', 'sandstone', 'clay', 'iron',
        'vegetable', 'vegetables', 'grass', 'bush', 'flower',
        'deertree'  // Don't flee from own spawn tree
    ],

    // Detection throttling
    DETECTION_INTERVAL: 500,  // ms between threat detection checks

    // Combat (deer are targets, not shooters)
    DEATH_ANIMATION_DURATION: 500,
    CORPSE_DURATION_TICKS: 120,  // Server ticks before corpse cleanup (2 minutes at 1 tick/sec)
    HARVEST_RANGE: 3,
    RESPAWN_COOLDOWN_MS: 60 * 60 * 1000,  // 60 minutes before deer can respawn from same tree

    // Performance
    IDLE_CHECK_INTERVAL: 30,  // Frames between target checks when idle
};

// =============================================================================
// DEER CONTROLLER CLASS
// =============================================================================

export class DeerController extends BaseAIController {
    constructor() {
        super({
            entityType: 'deer',
            entityIdField: 'treeId',  // Now uses tree ID like brown bear uses denId
            messagePrefix: 'deer',
            broadcastInterval: DEER_CONFIG.BROADCAST_INTERVAL,
        });

        // Deer-specific callbacks
        this.getPlayersInChunks = null;
        this.getPlayerPosition = null;
        this.getChunkObjects = null;
        this.getDeerTreeStructures = null;  // New: get deer trees in chunk

        // Gunshot tracking
        this._recentGunshots = [];

        // FIX: Track trees currently being spawned to prevent race conditions
        this._spawnInProgress = new Set();

        // Performance: Pre-computed natural objects Set for O(1) lookup
        this._naturalObjectsSet = new Set(DEER_CONFIG.NATURAL_OBJECTS);

        // Performance: Chunk objects cache (invalidated each frame)
        this._chunkObjectsCache = new Map();
        this._chunkCacheFrame = 0;
        this._frameCount = 0;

        // Spawn optimization (like brown bear)
        this._hasDeerTreesInRange = false;
        this._lastCheckedChunkX = null;
        this._lastCheckedChunkZ = null;

        // Pending states queue (handles race condition: state message before spawn)
        this.pendingStates = new Map();

        // Respawn cooldown tracking: treeId -> deathTimestamp (ms)
        // Persists after corpse cleanup to prevent immediate respawn
        this._treeDeathTimes = new Map();
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    /**
     * Initialize controller with callbacks
     * @param {string} clientId
     * @param {Object} game
     */
    init(clientId, game) {
        super.init(clientId, game);
    }

    /**
     * Set additional deer-specific callbacks
     * @param {Object} config
     */
    setCallbacks(config) {
        if (config.getPlayersInChunks) this.getPlayersInChunks = config.getPlayersInChunks;
        if (config.getPlayerPosition) this.getPlayerPosition = config.getPlayerPosition;
        if (config.getChunkObjects) this.getChunkObjects = config.getChunkObjects;
        if (config.getDeerTreeStructures) this.getDeerTreeStructures = config.getDeerTreeStructures;
        if (config.getTerrainHeight) this.getTerrainHeight = config.getTerrainHeight;
        if (config.getServerTick) this.getServerTick = config.getServerTick;
        if (config.createVisual) this.createVisual = config.createVisual;
        if (config.destroyVisual) this.destroyVisual = config.destroyVisual;
        if (config.broadcastP2P) this.broadcast = config.broadcastP2P;

        // Register spawn callback with queue system
        const spawnQueue = getAISpawnQueue();
        spawnQueue.registerSpawnCallback('deer', (data) => {
            this._executeSpawn(data);
        });
    }

    /**
     * Execute spawn from queue (called by AISpawnQueue)
     * @param {object} data - Spawn data from queue { tree }
     */
    _executeSpawn(data) {
        const { tree } = data;

        // Race condition check - entity may have spawned while in queue
        if (this.entities.has(tree.id)) {
            return;
        }

        this._spawnFromTree(tree);
    }

    // =========================================================================
    // MAIN UPDATE LOOP
    // =========================================================================

    update(deltaTime, chunkX, chunkZ) {
        this._frameCount++;
        const now = Date.now();
        const currentTick = this.getServerTick ? this.getServerTick() : 0;

        const corpsesToCleanup = [];

        for (const [treeId, entity] of this.entities) {
            this._updateEntity(entity, deltaTime, now);

            // Corpse cleanup check
            if (entity.isDead && entity.deathTick > 0 && currentTick > 0) {
                const ticksElapsed = currentTick - entity.deathTick;
                if (ticksElapsed >= DEER_CONFIG.CORPSE_DURATION_TICKS) {
                    corpsesToCleanup.push(treeId);
                }
            }
        }

        // Cleanup corpses
        for (const treeId of corpsesToCleanup) {
            const entity = this.entities.get(treeId);
            if (entity) {
                if (this.game?.nameTagManager) {
                    this.game.nameTagManager.unregisterEntity(`deer_${treeId}`);
                }
                if (entity.mesh && this.destroyVisual) {
                    this.destroyVisual(treeId, entity.mesh);
                }
                this.entities.delete(treeId);
            }
        }
    }

    _updateEntity(entity, deltaTime, now) {
        if (entity.authorityId === this.clientId) {
            this._updateAuthorityEntity(entity, deltaTime, now, []);
        } else {
            // Non-authority: interpolate
            if (entity.isDead) {
                this._updateDeathAnimation(entity, deltaTime);
            } else {
                this._interpolateEntity(entity, deltaTime);
            }
        }
    }

    // =========================================================================
    // ABSTRACT METHOD IMPLEMENTATIONS (BaseAIController)
    // =========================================================================

    _getSpawnCandidates(chunkX, chunkZ) {
        // Not used - we use checkSpawnsOnTick with tree structures
        return [];
    }

    _shouldSpawn(candidate) {
        // Not used - handled in checkSpawnsOnTick
        return false;
    }

    _createEntityState(treeData) {
        const now = Date.now();
        const treeId = treeData.id;
        const treePos = treeData.position;

        // Spawn at offset from tree
        const angle = Math.random() * Math.PI * 2;
        const dist = DEER_CONFIG.SPAWN_OFFSET_MIN +
            Math.random() * (DEER_CONFIG.SPAWN_OFFSET_MAX - DEER_CONFIG.SPAWN_OFFSET_MIN);

        const spawnX = treePos.x + Math.cos(angle) * dist;
        const spawnZ = treePos.z + Math.sin(angle) * dist;
        const spawnY = this.getTerrainHeight ? this.getTerrainHeight(spawnX, spawnZ) : treePos.y;

        // Initial rotation faces away from tree
        const initialRotation = angle;

        // Calculate chunk for this entity
        const chunkX = Math.floor(spawnX / DEER_CONFIG.CHUNK_SIZE);
        const chunkZ = Math.floor(spawnZ / DEER_CONFIG.CHUNK_SIZE);

        return {
            treeId,
            chunkX,
            chunkZ,
            authorityId: this.clientId,
            spawnedBy: this.clientId,

            // Home tree position (for leash checking)
            homeTreeX: treePos.x,
            homeTreeZ: treePos.z,

            position: { x: spawnX, y: spawnY, z: spawnZ },
            rotation: initialRotation,
            targetRotation: null,

            // State machine
            state: 'idle',
            stateStartTime: now,
            wanderDirection: null,
            fleeDirection: null,

            // Visual
            mesh: null,
            mixer: null,
            playAnimation: null,

            // Interpolation (non-authority)
            targetPosition: null,

            // Broadcast timing
            lastBroadcast: 0,

            // Terrain update counter
            terrainFrameCount: 0,

            // Death state
            isDead: false,
            deathStartTime: 0,
            deathTick: 0,
            fallDirection: 1,
            killedBy: null,
            isHarvested: false,

            // Detection cache (throttled)
            lastDetectionCheck: 0,
            cachedThreat: null,
            lastGunshotCheck: 0,
        };
    }

    _updateAuthorityEntity(entity, deltaTime, now, nearbyPlayers) {
        // Dead deer: only update death animation
        if (entity.isDead) {
            this._updateDeathAnimation(entity, deltaTime);
            return;
        }

        // Update Y position every 5 frames
        entity.terrainFrameCount++;
        if (entity.terrainFrameCount % 5 === 0 && this.getTerrainHeight) {
            const h = this.getTerrainHeight(entity.position.x, entity.position.z);
            entity.position.y = h !== null && h !== undefined ? h : entity.position.y;
            if (entity.mesh) {
                entity.mesh.position.y = entity.position.y;
            }
        }

        // Periodic gunshot check every 500ms
        if (!entity.lastGunshotCheck || now - entity.lastGunshotCheck >= 500) {
            entity.lastGunshotCheck = now;
            const gunshot = this._checkGunshotThreat(entity);
            if (gunshot) {
                if (entity.state === 'fleeing') {
                    // Update flee direction
                    const dx = entity.position.x - gunshot.x;
                    const dz = entity.position.z - gunshot.z;
                    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
                    entity.fleeDirection = { x: dx / dist, z: dz / dist };
                } else {
                    this._startFleeing(entity, gunshot, now);
                    if (entity.mixer) entity.mixer.update(deltaTime / 1000);
                    return;
                }
            }
        }

        // Update detection cache (throttled)
        this._updateDetectionCache(entity, now);

        const elapsed = now - entity.stateStartTime;

        switch (entity.state) {
            case 'idle':
                if (elapsed >= DEER_CONFIG.IDLE_DURATION) {
                    if (entity.cachedThreat) {
                        this._startFleeing(entity, entity.cachedThreat, now);
                    } else {
                        this._startWandering(entity, now);
                    }
                }
                break;

            case 'wandering':
                if (elapsed >= DEER_CONFIG.WANDER_DURATION) {
                    this._startIdle(entity, now);
                } else if (entity.wanderDirection) {
                    // Check leash before moving
                    const newX = entity.position.x + entity.wanderDirection.x * DEER_CONFIG.WANDER_SPEED * (deltaTime / 1000);
                    const newZ = entity.position.z + entity.wanderDirection.z * DEER_CONFIG.WANDER_SPEED * (deltaTime / 1000);
                    const distFromHome = Math.sqrt(
                        (newX - entity.homeTreeX) ** 2 + (newZ - entity.homeTreeZ) ** 2
                    );

                    if (distFromHome > DEER_CONFIG.LEASH_RANGE) {
                        // Turn back toward home
                        const dx = entity.homeTreeX - entity.position.x;
                        const dz = entity.homeTreeZ - entity.position.z;
                        const dist = Math.sqrt(dx * dx + dz * dz) || 1;
                        entity.wanderDirection = { x: dx / dist, z: dz / dist };
                    }

                    const moved = this._moveEntity(
                        entity,
                        entity.wanderDirection.x,
                        entity.wanderDirection.z,
                        DEER_CONFIG.WANDER_SPEED,
                        deltaTime
                    );
                    if (!moved) {
                        this._startIdle(entity, now);
                    }
                }
                break;

            case 'fleeing':
                if (elapsed >= DEER_CONFIG.FLEE_DURATION) {
                    this._startIdle(entity, now);
                } else if (entity.fleeDirection) {
                    // Check leash - if fleeing would take us too far, change direction
                    const newX = entity.position.x + entity.fleeDirection.x * DEER_CONFIG.FLEE_SPEED * (deltaTime / 1000);
                    const newZ = entity.position.z + entity.fleeDirection.z * DEER_CONFIG.FLEE_SPEED * (deltaTime / 1000);
                    const distFromHome = Math.sqrt(
                        (newX - entity.homeTreeX) ** 2 + (newZ - entity.homeTreeZ) ** 2
                    );

                    if (distFromHome > DEER_CONFIG.LEASH_RANGE) {
                        // Redirect perpendicular to home direction
                        const dx = entity.homeTreeX - entity.position.x;
                        const dz = entity.homeTreeZ - entity.position.z;
                        const dist = Math.sqrt(dx * dx + dz * dz) || 1;
                        // Perpendicular vector
                        entity.fleeDirection = { x: -dz / dist, z: dx / dist };
                    }

                    const moved = this._moveEntity(
                        entity,
                        entity.fleeDirection.x,
                        entity.fleeDirection.z,
                        DEER_CONFIG.FLEE_SPEED,
                        deltaTime
                    );
                    if (!moved) {
                        const angle = Math.random() * Math.PI * 2;
                        entity.fleeDirection = {
                            x: Math.sin(angle),
                            z: Math.cos(angle)
                        };
                    }
                }
                break;

            default:
                this._startIdle(entity, now);
                break;
        }

        // Broadcast state to peers
        if (now - entity.lastBroadcast > DEER_CONFIG.BROADCAST_INTERVAL) {
            this._broadcastEntityState(entity);
            entity.lastBroadcast = now;
        }

        // Update animation mixer
        if (entity.mixer) {
            entity.mixer.update(deltaTime / 1000);
        }
    }

    _getExtraStateData(entity) {
        const extra = {
            spawnedBy: entity.spawnedBy || entity.authorityId,
            homeTreeX: entity.homeTreeX,
            homeTreeZ: entity.homeTreeZ,
        };
        if (entity.wanderDirection) {
            extra.wanderDirection = { ...entity.wanderDirection };
        }
        if (entity.fleeDirection) {
            extra.fleeDirection = { ...entity.fleeDirection };
        }
        if (entity.isDead) {
            extra.deathTick = entity.deathTick;
        }
        return extra;
    }

    _applyDeath(entity, deathData) {
        entity.isDead = true;
        entity.deathStartTime = Date.now();
        entity.deathTick = deathData.deathTick || (this.getServerTick ? this.getServerTick() : 0);
        entity.fallDirection = deathData.fallDirection || 1;
        entity.killedBy = deathData.killedBy;
        entity.state = 'dead';
        entity.wanderDirection = null;
        entity.fleeDirection = null;

        // Record death time for respawn cooldown (persists after corpse cleanup)
        this._treeDeathTimes.set(entity.treeId, Date.now());

        if (this.game?.nameTagManager) {
            this.game.nameTagManager.setEntityDead(`deer_${entity.treeId}`);
        }

        if (entity.mixer) {
            entity.mixer.stopAllAction();
        }
    }

    // =========================================================================
    // SPAWNING SYSTEM (Structure-based like BrownBearController)
    // =========================================================================

    /**
     * Update deer tree presence check when player changes chunks
     * @param {number} chunkX - Player's chunk X coordinate
     * @param {number} chunkZ - Player's chunk Z coordinate
     * @param {boolean} force - Force refresh even if same chunk (Bug 2b Fix)
     */
    _updateDeerTreePresence(chunkX, chunkZ, force = false) {
        // Skip if same chunk (unless forced)
        if (!force && chunkX === this._lastCheckedChunkX && chunkZ === this._lastCheckedChunkZ) {
            return;
        }

        this._lastCheckedChunkX = chunkX;
        this._lastCheckedChunkZ = chunkZ;
        this._hasDeerTreesInRange = false;

        if (!this.getDeerTreeStructures) return;

        // Check 3x3 area around player
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = `${chunkX + dx},${chunkZ + dz}`;
                const trees = this.getDeerTreeStructures(key);
                if (trees && trees.length > 0) {
                    this._hasDeerTreesInRange = true;
                    return;
                }
            }
        }
    }

    /**
     * Check spawns on server tick (coordinates spawn decisions across peers)
     */
    checkSpawnsOnTick(chunkX, chunkZ) {
        if (chunkX === null || chunkZ === null ||
            chunkX === undefined || chunkZ === undefined ||
            isNaN(chunkX) || isNaN(chunkZ)) {
            return;
        }

        // Update deer tree presence - always force refresh to catch newly registered structures
        this._updateDeerTreePresence(chunkX, chunkZ, true);  // Bug 3 Fix: force=true

        // Early-out if no trees nearby
        if (!this._hasDeerTreesInRange) return;

        const spawnRangeSq = DEER_CONFIG.SPAWN_RANGE * DEER_CONFIG.SPAWN_RANGE;

        // Get my position
        const myPos = this.getPlayerPosition ? this.getPlayerPosition(this.clientId) : null;
        if (!myPos) return;

        // Check 3x3 area for deer trees
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = `${chunkX + dx},${chunkZ + dz}`;
                const trees = this.getDeerTreeStructures ? this.getDeerTreeStructures(key) : null;
                if (!trees) continue;

                for (const tree of trees) {
                    // Only spawn from actual deertree structures, not apple trees
                    // (apple trees are registered for Baker AI, not deer spawning)
                    if (tree.type !== 'deertree') continue;

                    // Skip if already spawned or spawn in progress
                    if (this.entities.has(tree.id)) continue;
                    if (this._spawnInProgress.has(tree.id)) continue;  // FIX: Prevent race condition

                    // Check respawn cooldown (60 min after deer death)
                    const deathTime = this._treeDeathTimes.get(tree.id);
                    if (deathTime) {
                        const elapsed = Date.now() - deathTime;
                        if (elapsed < DEER_CONFIG.RESPAWN_COOLDOWN_MS) {
                            continue;  // Still on cooldown
                        }
                        // Cooldown expired, clear the entry
                        this._treeDeathTimes.delete(tree.id);
                    }

                    const treeX = tree.position.x;
                    const treeZ = tree.position.z;

                    // Check if I'm in range
                    const distSq = (myPos.x - treeX) ** 2 + (myPos.z - treeZ) ** 2;
                    if (distSq > spawnRangeSq) continue;

                    // Gather nearby players for authority check
                    const nearbyIds = [this.clientId];
                    const treeChunkX = Math.floor(treeX / DEER_CONFIG.CHUNK_SIZE);
                    const treeChunkZ = Math.floor(treeZ / DEER_CONFIG.CHUNK_SIZE);
                    const chunkKeys = this._get3x3ChunkKeys(treeChunkX, treeChunkZ);
                    const playerIds = this.getPlayersInChunks ? this.getPlayersInChunks(chunkKeys) : [];

                    if (playerIds) {
                        for (const playerId of playerIds) {
                            if (playerId !== this.clientId) {
                                nearbyIds.push(playerId);
                            }
                        }
                    }

                    // Only lowest clientId spawns
                    nearbyIds.sort();
                    if (nearbyIds[0] === this.clientId) {
                        // Queue spawn instead of immediate spawn to prevent frame stutter
                        const spawnQueue = getAISpawnQueue();
                        if (!spawnQueue.isQueued('deer', tree.id)) {
                            this._spawnInProgress.add(tree.id);  // FIX: Mark as spawning
                            spawnQueue.queueSpawn('deer', { tree }, tree.id);
                        }
                    }
                }
            }
        }
    }

    /**
     * Spawn deer from a tree structure
     */
    _spawnFromTree(tree) {
        const treeId = tree.id;

        // Clear spawn-in-progress flag
        this._spawnInProgress.delete(treeId);

        if (this.entities.has(treeId)) {
            return;
        }

        const entity = this._createEntityState(tree);

        // Check spawn position is valid (not underwater)
        if (entity.position.y < DEER_CONFIG.SPAWN_HEIGHT_MIN) {
            return;
        }

        // FIX: Add to entities FIRST to prevent duplicate spawn attempts
        // (matches brown bear pattern - entity exists even if visual pending)
        this.entities.set(treeId, entity);

        // Create visual - may return null if model not loaded yet
        // DeerManager.pendingSpawns will update entity.mesh when model loads
        const visual = this.createVisual ? this.createVisual(treeId, entity.position) : null;
        if (visual) {
            entity.mesh = visual.mesh || visual;
            entity.mixer = visual.mixer || null;
            entity.playAnimation = visual.playAnimation || null;
            this._updateAnimation(entity);
        }
        // If no visual yet, entity exists but with null mesh

        // Register name tag only if mesh exists
        if (this.game?.nameTagManager && entity.mesh) {
            this.game.nameTagManager.registerEntity(`deer_${treeId}`, 'Deer', entity.mesh);
        }

        // Broadcast spawn
        if (this.broadcast) {
            this.broadcast({
                type: 'deer_spawn',
                treeId,
                position: { ...entity.position },
                rotation: entity.rotation,
                state: entity.state,
                authorityId: this.clientId,
                spawnedBy: this.clientId,
                homeTreeX: entity.homeTreeX,
                homeTreeZ: entity.homeTreeZ,
            });
        }

        console.log(`[Deer ${treeId}] Spawned from tree at (${entity.position.x.toFixed(1)}, ${entity.position.z.toFixed(1)})`);
    }

    /**
     * Handle chunk unload
     */
    onChunkUnloaded(chunkKey) {
        // Despawn any deer whose home tree was in this chunk
        const [chunkX, chunkZ] = chunkKey.split(',').map(Number);

        for (const [treeId, entity] of this.entities) {
            const homeChunkX = Math.floor(entity.homeTreeX / DEER_CONFIG.CHUNK_SIZE);
            const homeChunkZ = Math.floor(entity.homeTreeZ / DEER_CONFIG.CHUNK_SIZE);

            if (homeChunkX === chunkX && homeChunkZ === chunkZ) {
                this._despawnEntity(treeId);
            }
        }
    }

    /**
     * Despawn deer by tree ID
     */
    _despawnEntity(treeId) {
        const entity = this.entities.get(treeId);
        if (!entity) return;

        if (this.game?.nameTagManager) {
            this.game.nameTagManager.unregisterEntity(`deer_${treeId}`);
        }

        if (entity.mesh && this.destroyVisual) {
            this.destroyVisual(treeId, entity.mesh);
        }

        this.entities.delete(treeId);
    }

    // =========================================================================
    // P2P MESSAGE HANDLERS
    // =========================================================================

    handleSpawnMessage(data) {
        const { treeId, position, rotation, state, authorityId, spawnedBy, homeTreeX, homeTreeZ } = data;

        if (this.entities.has(treeId)) {
            const existing = this.entities.get(treeId);
            const existingSpawnedBy = existing.spawnedBy || existing.authorityId;
            const incomingSpawnedBy = spawnedBy || authorityId;

            if (incomingSpawnedBy < existingSpawnedBy) {
                console.log(`[Deer ${treeId}] Spawn conflict: ${incomingSpawnedBy} wins over ${existingSpawnedBy}`);
                this._despawnEntity(treeId);
            } else {
                return;
            }
        }

        // Validate Y position
        let validatedY = position.y;
        if (!validatedY || validatedY <= 0 || isNaN(validatedY)) {
            if (this.getTerrainHeight) {
                validatedY = this.getTerrainHeight(position.x, position.z);
            }
            if (!validatedY || validatedY <= 0) validatedY = 0;
        }

        const chunkX = Math.floor(position.x / DEER_CONFIG.CHUNK_SIZE);
        const chunkZ = Math.floor(position.z / DEER_CONFIG.CHUNK_SIZE);

        const entity = {
            treeId,
            chunkX,
            chunkZ,
            authorityId,
            spawnedBy: spawnedBy || authorityId,

            homeTreeX: homeTreeX || position.x,
            homeTreeZ: homeTreeZ || position.z,

            position: { x: position.x, y: validatedY, z: position.z },
            rotation,
            targetRotation: null,

            state,
            stateStartTime: Date.now(),
            wanderDirection: null,
            fleeDirection: null,

            mesh: null,
            mixer: null,
            playAnimation: null,

            targetPosition: { x: position.x, y: validatedY, z: position.z },
            lastBroadcast: 0,
            terrainFrameCount: 0,

            isDead: (state === 'dead'),
            deathStartTime: (state === 'dead') ? Date.now() : 0,
            deathTick: data.deathTick || 0,
            fallDirection: data.fallDirection || 1,
            killedBy: data.killedBy || null,
            isHarvested: data.isHarvested || false,

            lastDetectionCheck: 0,
            cachedThreat: null,
            lastGunshotCheck: 0,
        };

        const visual = this.createVisual ? this.createVisual(treeId, entity.position) : null;
        if (!visual) {
            console.log(`[Deer ${treeId}] Visual pending, deferring entity creation`);
            return;
        }

        entity.mesh = visual.mesh || visual;
        entity.mixer = visual.mixer || null;
        entity.playAnimation = visual.playAnimation || null;

        this.entities.set(treeId, entity);

        // Check pending deaths
        this._checkPendingDeaths(treeId);

        // Check pending states
        if (this.pendingStates.has(treeId)) {
            const pending = this.pendingStates.get(treeId);
            entity.targetPosition = { ...pending.position };
            entity.targetRotation = pending.rotation;
            if (pending.state && pending.state !== entity.state) {
                entity.state = pending.state;
                entity.stateStartTime = Date.now();
            }
            if (pending.authorityId) {
                entity.authorityId = pending.authorityId;
            }
            this.pendingStates.delete(treeId);
        }

        // Register name tag
        if (this.game?.nameTagManager && entity.mesh) {
            this.game.nameTagManager.registerEntity(`deer_${treeId}`, 'Deer', entity.mesh);
            if (entity.isDead) {
                this.game.nameTagManager.setEntityDead(`deer_${treeId}`);
            }
        }

        this._updateAnimation(entity);
        console.log(`[Deer ${treeId}] Spawned from peer ${spawnedBy}, authority: ${authorityId}`);
    }

    handleStateMessage(data) {
        const { treeId, position, rotation, state, authorityId, deathTick, wanderDirection, fleeDirection } = data;

        const entity = this.entities.get(treeId);
        if (!entity) {
            this.pendingStates.set(treeId, { position, rotation, state, authorityId, deathTick, wanderDirection, fleeDirection });
            return;
        }

        if (authorityId !== this.clientId) {
            entity.authorityId = authorityId;

            let validY = position.y;
            if (!Number.isFinite(validY) || validY <= 0) {
                if (this.getTerrainHeight) {
                    validY = this.getTerrainHeight(position.x, position.z);
                }
                if (!Number.isFinite(validY) || validY <= 0) {
                    validY = entity.position?.y || 0;
                }
            }
            entity.targetPosition = { x: position.x, y: validY, z: position.z };
            entity.targetRotation = rotation;

            if (entity.state !== state) {
                entity.state = state;
                entity.stateStartTime = Date.now();
                this._updateAnimation(entity);
            }

            if (wanderDirection) {
                entity.wanderDirection = { ...wanderDirection };
            }
            if (fleeDirection) {
                entity.fleeDirection = { ...fleeDirection };
            }

            if (state === 'dead') {
                entity.deathTick = deathTick || (this.getServerTick ? this.getServerTick() : 0);
                if (!entity.isDead) {
                    entity.isDead = true;
                    entity.deathStartTime = Date.now();
                    if (this.game?.nameTagManager) {
                        this.game.nameTagManager.setEntityDead(`deer_${treeId}`);
                    }
                }
            }
        }
    }

    handleDeathMessage(data) {
        const { treeId, killedBy, fallDirection, deathTick } = data;
        const entity = this.entities.get(treeId);

        // Always record death time for respawn cooldown (even if entity not found)
        this._treeDeathTimes.set(treeId, Date.now());

        if (!entity) {
            console.warn(`[Deer ${treeId}] Death message but entity not found - storing pending`);
            this.pendingDeaths.set(treeId, { killedBy, fallDirection, deathTick });
            return;
        }

        if (entity.isDead) return;

        this._applyDeath(entity, { killedBy, fallDirection, deathTick });
    }

    handleDespawnMessage(data) {
        const { treeId } = data;
        const entity = this.entities.get(treeId);

        if (!entity) {
            return;
        }

        console.log(`[Deer ${treeId}] Despawn received from authority - removing`);
        this._despawnEntity(treeId);
    }

    handleHarvestMessage(data) {
        const { treeId } = data;
        const entity = this.entities.get(treeId);

        // Ensure death time is recorded for respawn cooldown (in case death message was missed)
        if (!this._treeDeathTimes.has(treeId)) {
            this._treeDeathTimes.set(treeId, Date.now());
        }

        if (!entity) return;

        entity.isHarvested = true;

        if (this.game?.nameTagManager) {
            this.game.nameTagManager.unregisterEntity(`deer_${treeId}`);
        }

        if (entity.mesh && this.destroyVisual) {
            this.destroyVisual(treeId, entity.mesh);
            entity.mesh = null;
        }

        this.entities.delete(treeId);
    }

    broadcastAuthorityState() {
        const now = Date.now();
        for (const [treeId, entity] of this.entities) {
            if (entity.authorityId === this.clientId) {
                this._broadcastEntityState(entity);
                entity.lastBroadcast = now;
            }
        }
    }

    getActiveEntitiesForSync() {
        const result = [];
        for (const [treeId, entity] of this.entities) {
            result.push({
                treeId,
                position: { ...entity.position },
                rotation: entity.rotation,
                state: entity.state,
                authorityId: entity.authorityId,
                spawnedBy: entity.spawnedBy || entity.authorityId,
                homeTreeX: entity.homeTreeX,
                homeTreeZ: entity.homeTreeZ,
                deathTick: entity.deathTick || 0,
                fallDirection: entity.fallDirection || 1,
                killedBy: entity.killedBy || null,
                isHarvested: entity.isHarvested || false,
            });
        }
        return result;
    }

    // Backward compatibility aliases
    getActiveDeerForSync() {
        return this.getActiveEntitiesForSync();
    }

    syncDeerFromPeer(deerList) {
        this.syncEntitiesFromPeer(deerList);
    }

    // =========================================================================
    // ENTITY LIFECYCLE
    // =========================================================================

    killEntity(entityId, killedBy = null) {
        const entity = this.entities.get(entityId);
        const deathTick = this.getServerTick ? this.getServerTick() : 0;
        const fallDirection = Math.random() < 0.5 ? -1 : 1;

        if (!entity) {
            if (this.broadcast) {
                this.broadcast({
                    type: 'deer_death',
                    treeId: entityId,
                    killedBy: killedBy,
                    fallDirection: fallDirection,
                    deathTick: deathTick
                });
            }
            return;
        }

        if (entity.isDead) {
            return;
        }

        this._applyDeath(entity, { killedBy, fallDirection, deathTick });

        if (this.broadcast) {
            this.broadcast({
                type: 'deer_death',
                treeId: entityId,
                killedBy: killedBy,
                fallDirection: entity.fallDirection,
                deathTick: entity.deathTick
            });
        }
    }

    // Backward compatibility
    killDeer(treeId, killedBy) {
        this.killEntity(treeId, killedBy);
    }

    harvestDeer(treeId) {
        const entity = this.entities.get(treeId);
        if (!entity || !entity.isDead || entity.isHarvested) {
            return false;
        }

        entity.isHarvested = true;

        if (this.game?.nameTagManager) {
            this.game.nameTagManager.unregisterEntity(`deer_${treeId}`);
        }

        if (entity.mesh && this.destroyVisual) {
            this.destroyVisual(treeId, entity.mesh);
            entity.mesh = null;
        }

        this.entities.delete(treeId);

        if (this.broadcast) {
            this.broadcast({
                type: 'deer_harvested',
                treeId: treeId
            });
        }

        return true;
    }

    // =========================================================================
    // QUERY METHODS
    // =========================================================================

    getLivingDeerNear(playerX, playerZ, maxRange) {
        const results = [];
        const maxRangeSq = maxRange * maxRange;

        for (const [treeId, entity] of this.entities) {
            if (entity.isDead) continue;

            const dx = entity.position.x - playerX;
            const dz = entity.position.z - playerZ;
            const distSq = dx * dx + dz * dz;

            if (distSq <= maxRangeSq) {
                results.push({
                    treeId,
                    position: { ...entity.position },
                    entity: entity,
                    mesh: entity.mesh,
                    distance: Math.sqrt(distSq)
                });
            }
        }

        results.sort((a, b) => a.distance - b.distance);
        return results;
    }

    getNearestHarvestableDeer(playerX, playerZ) {
        let nearest = null;
        let nearestDistSq = DEER_CONFIG.HARVEST_RANGE * DEER_CONFIG.HARVEST_RANGE;

        for (const [treeId, entity] of this.entities) {
            if (!entity.isDead || entity.isHarvested || !entity.mesh) continue;

            const dx = entity.position.x - playerX;
            const dz = entity.position.z - playerZ;
            const distSq = dx * dx + dz * dz;

            if (distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearest = {
                    treeId,
                    position: { ...entity.position },
                    distance: Math.sqrt(distSq)
                };
            }
        }
        return nearest;
    }

    // =========================================================================
    // GUNSHOT DETECTION
    // =========================================================================

    registerGunshot(x, z) {
        const now = Date.now();
        this._recentGunshots.push({ x, z, time: now });

        // Clean old gunshots
        for (let i = this._recentGunshots.length - 1; i >= 0; i--) {
            if (now - this._recentGunshots[i].time >= 1000) {
                this._recentGunshots.splice(i, 1);
            }
        }
    }

    _checkGunshotThreat(entity) {
        const now = Date.now();
        const rangeSq = DEER_CONFIG.GUNSHOT_DETECT_RANGE * DEER_CONFIG.GUNSHOT_DETECT_RANGE;

        for (const gunshot of this._recentGunshots) {
            if (now - gunshot.time > 500) continue;

            const dx = gunshot.x - entity.position.x;
            const dz = gunshot.z - entity.position.z;
            if (dx * dx + dz * dz < rangeSq) {
                return { x: gunshot.x, z: gunshot.z };
            }
        }
        return null;
    }

    // =========================================================================
    // THREAT DETECTION
    // =========================================================================

    _getCachedChunkObjects(entity) {
        const cacheKey = `${entity.chunkX},${entity.chunkZ}`;

        if (this._chunkObjectsCache.has(cacheKey) && this._chunkCacheFrame === this._frameCount) {
            return this._chunkObjectsCache.get(cacheKey);
        }

        const allObjects = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = `${entity.chunkX + dx},${entity.chunkZ + dz}`;
                const objs = this.getChunkObjects ? this.getChunkObjects(key) : null;
                if (objs) {
                    for (let i = 0; i < objs.length; i++) {
                        allObjects.push(objs[i]);
                    }
                }
            }
        }

        this._chunkObjectsCache.set(cacheKey, allObjects);
        this._chunkCacheFrame = this._frameCount;

        return allObjects;
    }

    _isNaturalObject(objectType) {
        if (!objectType) return false;
        const lower = objectType.toLowerCase();
        if (this._naturalObjectsSet.has(lower)) return true;
        for (const nat of this._naturalObjectsSet) {
            if (lower.includes(nat)) return true;
        }
        return false;
    }

    _findNearestThreat(entity) {
        const playerRange = DEER_CONFIG.PLAYER_DETECT_RANGE;
        const objectRange = DEER_CONFIG.OBJECT_DETECT_RANGE;

        let nearestThreat = null;
        let nearestDistSq = Infinity;

        // Check players
        const chunkKeys = this._get3x3ChunkKeys(entity.chunkX, entity.chunkZ);
        const playerIds = this.getPlayersInChunks ? this.getPlayersInChunks(chunkKeys) : [];
        const playerRangeSq = playerRange * playerRange;

        for (const playerId of playerIds) {
            const pos = this.getPlayerPosition ? this.getPlayerPosition(playerId) : null;
            if (!pos) continue;

            const dx = pos.x - entity.position.x;
            const dz = pos.z - entity.position.z;
            const distSq = dx * dx + dz * dz;

            if (distSq < playerRangeSq && distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearestThreat = { x: pos.x, z: pos.z };
            }
        }

        // Check local player
        const localPos = this.getPlayerPosition ? this.getPlayerPosition(this.clientId) : null;
        if (localPos) {
            const dx = localPos.x - entity.position.x;
            const dz = localPos.z - entity.position.z;
            const distSq = dx * dx + dz * dz;

            if (distSq < playerRangeSq && distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearestThreat = { x: localPos.x, z: localPos.z };
            }
        }

        // Check objects
        const allObjects = this._getCachedChunkObjects(entity);
        const objectRangeSq = objectRange * objectRange;

        for (const obj of allObjects) {
            if (this._isNaturalObject(obj.type)) continue;

            const pos = obj.position;
            if (!pos) continue;

            const objDx = pos.x - entity.position.x;
            const objDz = pos.z - entity.position.z;
            const distSq = objDx * objDx + objDz * objDz;

            if (distSq < objectRangeSq && distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearestThreat = { x: pos.x, z: pos.z };
            }
        }

        // Check brown bears via registry
        const bearRangeSq = DEER_CONFIG.BEAR_DETECT_RANGE * DEER_CONFIG.BEAR_DETECT_RANGE;
        const brownBearController = this.registry?.get('brownbear');
        if (brownBearController?.entities) {
            for (const [denId, bear] of brownBearController.entities) {
                if (bear.state === 'dead') continue;
                const pos = bear.position;

                const dx = pos.x - entity.position.x;
                const dz = pos.z - entity.position.z;
                const distSq = dx * dx + dz * dz;

                if (distSq < bearRangeSq && distSq < nearestDistSq) {
                    nearestDistSq = distSq;
                    nearestThreat = { x: pos.x, z: pos.z };
                }
            }
        }

        return nearestThreat;
    }

    _updateDetectionCache(entity, now) {
        if (now - entity.lastDetectionCheck < DEER_CONFIG.DETECTION_INTERVAL) {
            return;
        }
        entity.lastDetectionCheck = now;
        entity.cachedThreat = this._findNearestThreat(entity);
    }

    // =========================================================================
    // MOVEMENT
    // =========================================================================

    _moveEntity(entity, dirX, dirZ, speed, deltaTime) {
        const moveAmount = speed * (deltaTime / 1000);

        const newX = entity.position.x + dirX * moveAmount;
        const newZ = entity.position.z + dirZ * moveAmount;
        const newY = this.getTerrainHeight ? this.getTerrainHeight(newX, newZ) : entity.position.y;

        if (newY < DEER_CONFIG.SPAWN_HEIGHT_MIN) {
            return false;
        }

        entity.position.x = newX;
        entity.position.z = newZ;
        entity.position.y = newY;

        // Update chunk tracking
        entity.chunkX = Math.floor(newX / DEER_CONFIG.CHUNK_SIZE);
        entity.chunkZ = Math.floor(newZ / DEER_CONFIG.CHUNK_SIZE);

        // Face movement direction
        const targetRot = Math.atan2(dirX, dirZ);
        let rotDiff = targetRot - entity.rotation;
        while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
        while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;

        const turnAmount = DEER_CONFIG.TURN_SPEED * (deltaTime / 1000);
        if (Math.abs(rotDiff) < turnAmount) {
            entity.rotation = targetRot;
        } else {
            entity.rotation += Math.sign(rotDiff) * turnAmount;
        }

        if (entity.mesh) {
            entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
            entity.mesh.rotation.y = entity.rotation;
        }

        return true;
    }

    // =========================================================================
    // STATE MACHINE
    // =========================================================================

    _startIdle(entity, now) {
        entity.state = 'idle';
        entity.stateStartTime = now;
        entity.wanderDirection = null;
        entity.fleeDirection = null;
        this._updateAnimation(entity);
    }

    _startWandering(entity, now) {
        entity.state = 'wandering';
        entity.stateStartTime = now;

        const angle = Math.random() * Math.PI * 2;
        entity.wanderDirection = {
            x: Math.sin(angle),
            z: Math.cos(angle)
        };

        this._updateAnimation(entity);
    }

    _startFleeing(entity, threat, now) {
        entity.state = 'fleeing';
        entity.stateStartTime = now;

        const dx = entity.position.x - threat.x;
        const dz = entity.position.z - threat.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < 0.001) {
            const angle = Math.random() * Math.PI * 2;
            entity.fleeDirection = { x: Math.sin(angle), z: Math.cos(angle) };
        } else {
            entity.fleeDirection = { x: dx / dist, z: dz / dist };
        }

        this._updateAnimation(entity);
    }

    // =========================================================================
    // ANIMATION
    // =========================================================================

    _updateAnimation(entity) {
        if (!entity.playAnimation) return;

        switch (entity.state) {
            case 'idle':
                entity.playAnimation('walk', 0);
                break;
            case 'wandering':
                entity.playAnimation('walk', 1.0);
                break;
            case 'fleeing':
                entity.playAnimation('run', 1.0);
                break;
            default:
                entity.playAnimation('walk', 0);
                break;
        }
    }

    _updateDeathAnimation(entity, deltaTime) {
        if (!entity.mesh) return;

        const elapsed = Date.now() - entity.deathStartTime;
        const duration = DEER_CONFIG.DEATH_ANIMATION_DURATION;

        if (elapsed < duration) {
            const progress = elapsed / duration;
            const angle = (Math.PI / 2) * progress * entity.fallDirection;

            if (entity.mesh.children && entity.mesh.children[0]) {
                entity.mesh.children[0].rotation.z = angle;
            }
        } else {
            const angle = (Math.PI / 2) * entity.fallDirection;
            if (entity.mesh.children && entity.mesh.children[0]) {
                entity.mesh.children[0].rotation.z = angle;
            }
        }
    }

    // =========================================================================
    // INTERPOLATION
    // =========================================================================

    _interpolateEntity(entity, deltaTime) {
        if (!entity.targetPosition) return;

        const secondsDelta = deltaTime / 1000;
        const SNAP_THRESHOLD = 0.05;
        const TELEPORT_THRESHOLD = 10;

        const dx = entity.targetPosition.x - entity.position.x;
        const dz = entity.targetPosition.z - entity.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        if (distance < SNAP_THRESHOLD) {
            entity.position.x = entity.targetPosition.x;
            entity.position.z = entity.targetPosition.z;
        } else if (distance > TELEPORT_THRESHOLD) {
            entity.position.x = entity.targetPosition.x;
            entity.position.z = entity.targetPosition.z;
        } else {
            let baseSpeed;
            switch (entity.state) {
                case 'fleeing':
                    baseSpeed = DEER_CONFIG.FLEE_SPEED;
                    break;
                case 'wandering':
                    baseSpeed = DEER_CONFIG.WANDER_SPEED;
                    break;
                default:
                    baseSpeed = DEER_CONFIG.WANDER_SPEED;
                    break;
            }
            const moveSpeed = baseSpeed * 1.2;
            const moveStep = moveSpeed * secondsDelta;

            if (moveStep >= distance) {
                entity.position.x = entity.targetPosition.x;
                entity.position.z = entity.targetPosition.z;
            } else {
                const dirX = dx / distance;
                const dirZ = dz / distance;
                entity.position.x += dirX * moveStep;
                entity.position.z += dirZ * moveStep;
            }
        }

        // Update chunk tracking
        entity.chunkX = Math.floor(entity.position.x / DEER_CONFIG.CHUNK_SIZE);
        entity.chunkZ = Math.floor(entity.position.z / DEER_CONFIG.CHUNK_SIZE);

        // Y interpolation
        if (entity.targetPosition.y !== undefined && entity.targetPosition.y > 0) {
            const dy = entity.targetPosition.y - entity.position.y;

            if (Math.abs(dy) > 2) {
                if (this.getTerrainHeight) {
                    entity.position.y = this.getTerrainHeight(entity.position.x, entity.position.z);
                    entity.targetPosition.y = entity.position.y;
                }
            } else {
                entity.position.y += dy * 0.1;
            }
        }

        // Rotation
        let targetRotation = entity.rotation;
        if (distance > 0.1) {
            targetRotation = Math.atan2(dx, dz);
        } else if (entity.targetRotation !== null) {
            targetRotation = entity.targetRotation;
        }

        let rotDiff = targetRotation - entity.rotation;
        while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
        while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;

        const maxRotation = 2.1 * secondsDelta;
        entity.rotation += Math.max(-maxRotation, Math.min(maxRotation, rotDiff));

        // Sync mesh
        if (entity.mesh) {
            entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
            entity.mesh.rotation.y = entity.rotation;
        }

        // Update mixer
        if (entity.mixer) {
            entity.mixer.update(secondsDelta);
        }
    }

    // =========================================================================
    // BROADCAST
    // =========================================================================

    _broadcastEntityState(entity) {
        if (!this.broadcast) return;

        const msg = {
            type: 'deer_state',
            treeId: entity.treeId,
            position: { ...entity.position },
            rotation: entity.rotation,
            state: entity.state,
            authorityId: entity.authorityId,
            ...this._getExtraStateData(entity)
        };
        this.broadcast(msg);
    }

    // =========================================================================
    // AUTHORITY MANAGEMENT
    // =========================================================================

    _determineAuthority(chunkX, chunkZ) {
        const chunkKeys = this._get3x3ChunkKeys(chunkX, chunkZ);
        const playerIds = this.getPlayersInChunks ? this.getPlayersInChunks(chunkKeys) : [];

        let lowestId = this.clientId;
        for (const playerId of playerIds) {
            if (playerId < lowestId) {
                lowestId = playerId;
            }
        }
        return lowestId;
    }

    onPeerDisconnected(peerId) {
        for (const [treeId, entity] of this.entities) {
            if (entity.authorityId === peerId) {
                const newAuthority = this._determineAuthority(entity.chunkX, entity.chunkZ);
                if (newAuthority) {
                    entity.authorityId = newAuthority;
                    console.log(`[Deer ${treeId}] Authority transfer: ${peerId} -> ${newAuthority}`);

                    if (newAuthority === this.clientId) {
                        if (entity.targetPosition) {
                            const terrainY = this.getTerrainHeight ?
                                this.getTerrainHeight(entity.targetPosition.x, entity.targetPosition.z) :
                                entity.targetPosition.y;

                            if (entity.targetPosition.y > 0 && Math.abs(entity.targetPosition.y - terrainY) < 2) {
                                entity.position.x = entity.targetPosition.x;
                                entity.position.y = terrainY;
                                entity.position.z = entity.targetPosition.z;
                            }
                        }
                        if (this.getTerrainHeight) {
                            entity.position.y = this.getTerrainHeight(entity.position.x, entity.position.z);
                        }

                        if (entity.mesh) {
                            entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
                        }

                        this._broadcastEntityState(entity);
                    }
                }
            }
        }
    }

    onPeerChunkChanged(peerId, oldChunkKey, newChunkKey) {
        for (const [treeId, entity] of this.entities) {
            if (entity.authorityId !== peerId) continue;

            const [newX, newZ] = newChunkKey.split(',').map(Number);
            const dx = Math.abs(newX - entity.chunkX);
            const dz = Math.abs(newZ - entity.chunkZ);

            if (dx > 1 || dz > 1) {
                const newAuthority = this._determineAuthority(entity.chunkX, entity.chunkZ);
                if (newAuthority) {
                    entity.authorityId = newAuthority;

                    if (newAuthority === this.clientId) {
                        if (entity.targetPosition) {
                            const targetY = entity.targetPosition.y;
                            const terrainY = this.getTerrainHeight ?
                                this.getTerrainHeight(entity.targetPosition.x, entity.targetPosition.z) : targetY;

                            if (targetY > 0 && Math.abs(targetY - terrainY) < 2) {
                                entity.position.x = entity.targetPosition.x;
                                entity.position.y = terrainY;
                                entity.position.z = entity.targetPosition.z;
                            }
                        }
                        if (this.getTerrainHeight) {
                            entity.position.y = this.getTerrainHeight(entity.position.x, entity.position.z);
                        }

                        if (entity.mesh) {
                            entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
                        }

                        this._broadcastEntityState(entity);
                    }
                }
            }
        }
    }

    onPeerJoinedChunk(peerId, chunkKey) {
        const [peerChunkX, peerChunkZ] = chunkKey.split(',').map(Number);

        for (const [treeId, entity] of this.entities) {
            if (entity.authorityId === peerId) continue;

            const dx = Math.abs(peerChunkX - entity.chunkX);
            const dz = Math.abs(peerChunkZ - entity.chunkZ);

            if (dx <= 1 && dz <= 1) {
                const newAuthority = this._determineAuthority(entity.chunkX, entity.chunkZ);
                if (newAuthority && newAuthority !== entity.authorityId) {
                    const oldAuthority = entity.authorityId;
                    entity.authorityId = newAuthority;
                    console.log(`[Deer ${treeId}] Authority transfer on peer join: ${oldAuthority} -> ${newAuthority}`);
                }
            }
        }
    }
}

export { DEER_CONFIG };

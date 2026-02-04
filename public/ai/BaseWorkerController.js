/**
 * BaseWorkerController.js (OPTIMIZED)
 * Abstract base class for NPC workers (Woodcutter, Baker, Gardener, etc.)
 *
 * PERFORMANCE OPTIMIZATIONS APPLIED:
 * 1. Cached config values at init (avoid repeated lookups)
 * 2. Pre-computed squared distance thresholds
 * 3. Reusable vector objects for calculations
 * 4. Reduced object allocations in hot paths
 * 5. Local variable caching in tight loops
 * 6. Optimized chunk key generation
 * 7. Consolidated broadcast logic (DRY)
 * 8. Avoided repeated optional chaining in loops
 * 9. Pre-allocated arrays where beneficial
 * 10. Inlined simple getters in performance-critical code
 */

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from '../config.js';
import { modelManager, applyEuclideanFog } from '../objects.js';
import { ChunkCoordinates } from '../core/ChunkCoordinates.js';
import { getAISpawnQueue } from './AISpawnQueue.js';

// Default configuration shared by all workers
const BASE_CONFIG_DEFAULTS = {
    CHUNK_SIZE: 50,
    MOVE_SPEED: 1.25,
    PATHFIND_INTERVAL: 1000,
    IDLE_CHECK_INTERVAL: 1000,
    BROADCAST_INTERVAL: 1000,
    MARKET_MAX_DISTANCE: 20,
    STUCK_TIMEOUT: 2000,
    FAR_DISTANCE_SQ: 2500,
    FAR_UPDATE_INTERVAL: 4,
    WAYPOINT_THRESHOLD_SQ: 0.25,
    TELEPORT_THRESHOLD_SQ: 100,
    SNAP_THRESHOLD_SQ: 0.0025,
};

export class BaseWorkerController {
    constructor(config) {
        // Type identification
        this.workerType = config.workerType;
        this.configKey = config.configKey;
        this.displayName = config.displayName || config.workerType.charAt(0).toUpperCase() + config.workerType.slice(1);
        this.movementStates = new Set(config.movementStates || []);

        // Assessment state name - subclasses should set this to their "assess what to do next" state
        // e.g., 'ASSESSING_BAKERY' for Baker, 'ASSESSING_STRUCTURE' for IronWorker
        this.assessmentStateName = config.assessmentStateName || 'ASSESSING_STRUCTURE';

        // Entity storage
        this.entities = new Map();
        this.pendingStates = new Map();
        this._lastPendingStatesCleanup = 0;

        // Core references (set via initialize)
        this.clientId = null;
        this.game = null;
        this.gameState = null;
        this.networkManager = null;
        this.chunkManager = null;

        // Frame/timing
        this._frameCount = 0;
        this._lastBroadcastTime = 0;

        // Callbacks
        this.getPlayersInChunks = null;
        this.getPlayerPosition = null;
        this.getTerrainHeight = null;
        this.isWalkable = null;
        this.isOnRoad = null;
        this.findPath = null;
        this.findPathAsync = null;
        this.getSpeedMultiplier = null;
        this.broadcastP2P = null;
        this.isPlayerActive = null;

        // OPTIMIZATION: Pre-allocate reusable arrays
        this._nearbyChunkKeys = new Array(9); // 3x3 grid = 9 chunks max

        // Per-faction material caching for owner-colored shirts
        this._baseNpcColor = config.npcColor;
        this._factionMaterials = new Map();

        // Create reusable broadcast message
        this._broadcastMsg = this._createBroadcastMessage();

        // OPTIMIZATION: Cache config values (will be populated in _cacheConfigValues)
        this._cachedConfig = null;
    }

    /**
     * Get or create a material for a specific faction
     * Materials are cached per-faction for performance (max 4 per worker type)
     */
    _getFactionMaterial(factionId) {
        const key = factionId ?? 'default';
        if (this._factionMaterials.has(key)) {
            return this._factionMaterials.get(key);
        }
        const factionConfig = CONFIG.FACTION_COLORS[factionId];
        const color = factionConfig?.shirt ?? this._baseNpcColor;
        const material = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.8,
            metalness: 0.1
        });
        applyEuclideanFog(material);
        this._factionMaterials.set(key, material);
        return material;
    }

    /**
     * OPTIMIZATION: Cache all config values at init to avoid repeated lookups
     */
    _cacheConfigValues() {
        const cfg = CONFIG[this.configKey] || {};
        this._cachedConfig = {
            CHUNK_SIZE: cfg.CHUNK_SIZE ?? BASE_CONFIG_DEFAULTS.CHUNK_SIZE,
            MOVE_SPEED: cfg.MOVE_SPEED ?? BASE_CONFIG_DEFAULTS.MOVE_SPEED,
            PATHFIND_INTERVAL: cfg.PATHFIND_INTERVAL ?? BASE_CONFIG_DEFAULTS.PATHFIND_INTERVAL,
            IDLE_CHECK_INTERVAL: cfg.IDLE_CHECK_INTERVAL ?? BASE_CONFIG_DEFAULTS.IDLE_CHECK_INTERVAL,
            BROADCAST_INTERVAL: cfg.BROADCAST_INTERVAL ?? BASE_CONFIG_DEFAULTS.BROADCAST_INTERVAL,
            MARKET_MAX_DISTANCE: cfg.MARKET_MAX_DISTANCE ?? BASE_CONFIG_DEFAULTS.MARKET_MAX_DISTANCE,
            STUCK_TIMEOUT: cfg.STUCK_TIMEOUT ?? BASE_CONFIG_DEFAULTS.STUCK_TIMEOUT,
            FAR_DISTANCE_SQ: cfg.FAR_DISTANCE_SQ ?? BASE_CONFIG_DEFAULTS.FAR_DISTANCE_SQ,
            FAR_UPDATE_INTERVAL: cfg.FAR_UPDATE_INTERVAL ?? BASE_CONFIG_DEFAULTS.FAR_UPDATE_INTERVAL,
            WAYPOINT_THRESHOLD_SQ: cfg.WAYPOINT_THRESHOLD_SQ ?? BASE_CONFIG_DEFAULTS.WAYPOINT_THRESHOLD_SQ,
            TELEPORT_THRESHOLD_SQ: cfg.TELEPORT_THRESHOLD_SQ ?? BASE_CONFIG_DEFAULTS.TELEPORT_THRESHOLD_SQ,
            SNAP_THRESHOLD_SQ: cfg.SNAP_THRESHOLD_SQ ?? BASE_CONFIG_DEFAULTS.SNAP_THRESHOLD_SQ,
        };
        // OPTIMIZATION: Pre-compute squared values
        this._cachedConfig.MARKET_MAX_DISTANCE_SQ = this._cachedConfig.MARKET_MAX_DISTANCE * this._cachedConfig.MARKET_MAX_DISTANCE;
        this._cachedConfig.CATCHUP_THRESHOLD_SQ = 1.0;
    }

    /**
     * Create reusable broadcast message object
     */
    _createBroadcastMessage() {
        return {
            type: `${this.workerType}_state`,
            buildingId: '',
            term: 1,
            authorityTerm: 1,
            authorityId: '',
            position: { x: 0, y: 0, z: 0 },
            rotation: 0,
            state: '',
            targetId: null,
            carrying: [],
            moving: false,
            stuckReason: null
        };
    }

    /**
     * OPTIMIZATION: Inline config access for hot paths
     */
    _getConfig(key) {
        // Use cached values when available (hot path)
        if (this._cachedConfig) {
            return this._cachedConfig[key];
        }
        // Fallback for before init
        return CONFIG[this.configKey]?.[key] ?? BASE_CONFIG_DEFAULTS[key];
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    initialize(config) {
        const required = ['clientId', 'game', 'gameState', 'networkManager', 'getTerrainHeight', 'findPath', 'broadcastP2P'];
        for (let i = 0; i < required.length; i++) {
            const key = required[i];
            if (config[key] === undefined) {
                console.error(`[${this.constructor.name}] Missing required config: ${key}`);
            }
            this[key] = config[key];
        }

        // Optional callbacks
        if (config.getPlayersInChunks) this.getPlayersInChunks = config.getPlayersInChunks;
        if (config.getPlayerPosition) this.getPlayerPosition = config.getPlayerPosition;
        if (config.isWalkable) this.isWalkable = config.isWalkable;
        if (config.isOnRoad) this.isOnRoad = config.isOnRoad;
        if (config.getSpeedMultiplier) this.getSpeedMultiplier = config.getSpeedMultiplier;
        if (config.chunkManager) this.chunkManager = config.chunkManager;
        if (config.isPlayerActive) this.isPlayerActive = config.isPlayerActive;
        if (config.findPathAsync) this.findPathAsync = config.findPathAsync;

        // OPTIMIZATION: Cache config values after init
        this._cacheConfigValues();

        // Register with spawn queue
        const spawnQueue = getAISpawnQueue();
        if (spawnQueue) {
            spawnQueue.registerSpawnCallback(this.workerType, (data) => {
                this._executeSpawn(data);
            });
        }
    }

    getWorkerDialogueData(buildingId) {
        const entity = this.entities.get(buildingId);
        if (!entity) return null;

        return {
            state: entity.state,
            stuckReason: entity.stuckReason,
            carrying: entity.carrying ? entity.carrying.length : 0,
            buildingId: buildingId,
            ...this._getExtraDialogueData(entity)
        };
    }

    _getExtraDialogueData(entity) {
        return {};
    }

    dispose() {
        // OPTIMIZATION: Collect keys first to avoid iterator invalidation
        const keys = Array.from(this.entities.keys());
        for (let i = 0; i < keys.length; i++) {
            this._removeWorker(keys[i]);
        }
        this.entities.clear();
        this.pendingStates.clear();
    }

    // =========================================================================
    // SPAWN SYSTEM
    // =========================================================================

    checkWorkerSpawn(dockData) {
        if (!CONFIG[this.configKey]?.ENABLED) return;

        const { dockPosition, chunkId } = dockData;
        const dockX = dockPosition?.x ?? dockPosition?.[0];
        const dockZ = dockPosition?.z ?? dockPosition?.[2];

        if (dockX === undefined || dockZ === undefined) return;

        // OPTIMIZATION: Use cached squared distance (with fallback before init)
        const maxDist = this._cachedConfig?.MARKET_MAX_DISTANCE ?? this._getConfig('MARKET_MAX_DISTANCE');
        const maxDistSq = this._cachedConfig?.MARKET_MAX_DISTANCE_SQ ?? (maxDist * maxDist);
        const spawnRangeSq = maxDistSq;
        const chunkSize = this._cachedConfig?.CHUNK_SIZE ?? this._getConfig('CHUNK_SIZE');

        const dockChunkMatch = chunkId?.match(/chunk_(-?\d+),(-?\d+)/);
        if (!dockChunkMatch) return;

        const dockChunkX = parseInt(dockChunkMatch[1], 10);
        const dockChunkZ = parseInt(dockChunkMatch[2], 10);

        // OPTIMIZATION: Pre-allocate markets array with estimated capacity
        const marketsNearDock = [];
        
        // OPTIMIZATION: Cache gameState reference
        const gameState = this.gameState;
        
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = `${dockChunkX + dx},${dockChunkZ + dz}`;
                const markets = gameState.getMarketsInChunk(key);
                
                // OPTIMIZATION: Use indexed loop instead of for-of
                for (let i = 0, len = markets.length; i < len; i++) {
                    const market = markets[i];
                    const mdx = market.position.x - dockX;
                    const mdz = market.position.z - dockZ;
                    const distSq = mdx * mdx + mdz * mdz;
                    if (distSq <= maxDistSq) {
                        marketsNearDock.push(market);
                    }
                }
            }
        }

        if (marketsNearDock.length === 0) return;

        // OPTIMIZATION: Cache method references
        const clientId = this.clientId;
        const getPlayersInChunks = this.getPlayersInChunks;
        const getPlayerPosition = this.getPlayerPosition;
        const entities = this.entities;

        for (let m = 0; m < marketsNearDock.length; m++) {
            const market = marketsNearDock[m];
            const { chunkX: mChunkX, chunkZ: mChunkZ } = ChunkCoordinates.worldToChunk(market.position.x, market.position.z);

            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const key = `${mChunkX + dx},${mChunkZ + dz}`;
                    const buildings = this._getStructuresInChunk(key);

                    for (let b = 0, bLen = buildings.length; b < bLen; b++) {
                        const building = buildings[b];
                        const bdx = building.position.x - market.position.x;
                        const bdz = building.position.z - market.position.z;
                        const distSq = bdx * bdx + bdz * bdz;

                        if (distSq <= maxDistSq) {
                            if (entities.has(building.id)) continue;

                            const { chunkX: bChunkX, chunkZ: bChunkZ } = ChunkCoordinates.worldToChunk(building.position.x, building.position.z);

                            // OPTIMIZATION: Fill pre-allocated array instead of creating new one
                            let keyIdx = 0;
                            for (let cdx = -1; cdx <= 1; cdx++) {
                                for (let cdz = -1; cdz <= 1; cdz++) {
                                    this._nearbyChunkKeys[keyIdx++] = `${bChunkX + cdx},${bChunkZ + cdz}`;
                                }
                            }
                            
                            const playerIds = getPlayersInChunks?.(this._nearbyChunkKeys);

                            let authorityId = clientId;
                            if (playerIds) {
                                for (let p = 0, pLen = playerIds.length; p < pLen; p++) {
                                    const playerId = playerIds[p];
                                    if (playerId === clientId) continue;
                                    const pos = getPlayerPosition?.(playerId);
                                    if (!pos) continue;

                                    const dxP = pos.x - building.position.x;
                                    const dzP = pos.z - building.position.z;
                                    if (dxP * dxP + dzP * dzP < spawnRangeSq) {
                                        if (playerId < authorityId) {
                                            authorityId = playerId;
                                        }
                                    }
                                }
                            }

                            if (authorityId !== clientId) continue;

                            // Skip spawn if at authority cap - let another peer handle it
                            if (this.getAuthorityCount() >= CONFIG.AI_AUTHORITY.SOFT_CAP) {
                                continue;
                            }

                            const spawnQueue = getAISpawnQueue();
                            if (spawnQueue && !spawnQueue.isQueued(this.workerType, building.id)) {
                                spawnQueue.queueSpawn(this.workerType, { building }, building.id);
                            } else if (!spawnQueue) {
                                this._spawnWorker(building);
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Check for proprietor-owned structure spawns on tick
     * Called every server tick (once per second)
     * Only spawns workers for structures with isSoldWorkerStructure flag
     */
    checkProprietorSpawnsOnTick(chunkX, chunkZ) {
        if (!CONFIG[this.configKey]?.ENABLED) return;

        // OPTIMIZATION: Use cached values
        const spawnRange = this._cachedConfig?.MARKET_MAX_DISTANCE ?? this._getConfig('MARKET_MAX_DISTANCE');
        const spawnRangeSq = spawnRange * spawnRange;
        const chunkSize = this._cachedConfig?.CHUNK_SIZE ?? this._getConfig('CHUNK_SIZE');

        // Get my position
        const myPos = this.getPlayerPosition?.(this.clientId);
        if (!myPos) return;

        // Cache method references
        const clientId = this.clientId;
        const getPlayersInChunks = this.getPlayersInChunks;
        const getPlayerPosition = this.getPlayerPosition;
        const entities = this.entities;

        // Check 3x3 chunk grid for sold structures
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = `${chunkX + dx},${chunkZ + dz}`;
                const buildings = this._getStructuresInChunk(key);

                for (let b = 0, bLen = buildings.length; b < bLen; b++) {
                    const building = buildings[b];

                    // Only spawn for sold worker structures
                    if (!building.object?.userData?.isSoldWorkerStructure) continue;

                    // Skip if already spawned
                    if (entities.has(building.id)) continue;

                    // Check if player is in range
                    const bdx = building.position.x - myPos.x;
                    const bdz = building.position.z - myPos.z;
                    const distSq = bdx * bdx + bdz * bdz;
                    if (distSq >= spawnRangeSq) continue;

                    // Find authority: lowest clientId in range
                    const { chunkX: bChunkX, chunkZ: bChunkZ } = ChunkCoordinates.worldToChunk(building.position.x, building.position.z);

                    let keyIdx = 0;
                    for (let cdx = -1; cdx <= 1; cdx++) {
                        for (let cdz = -1; cdz <= 1; cdz++) {
                            this._nearbyChunkKeys[keyIdx++] = `${bChunkX + cdx},${bChunkZ + cdz}`;
                        }
                    }

                    const playerIds = getPlayersInChunks?.(this._nearbyChunkKeys);

                    let authorityId = clientId;
                    if (playerIds) {
                        for (let p = 0, pLen = playerIds.length; p < pLen; p++) {
                            const playerId = playerIds[p];
                            if (playerId === clientId) continue;
                            const pos = getPlayerPosition?.(playerId);
                            if (!pos) continue;

                            const dxP = pos.x - building.position.x;
                            const dzP = pos.z - building.position.z;
                            if (dxP * dxP + dzP * dzP < spawnRangeSq) {
                                if (playerId < authorityId) {
                                    authorityId = playerId;
                                }
                            }
                        }
                    }

                    if (authorityId !== clientId) continue;

                    // Skip spawn if at authority cap - let another peer handle it
                    if (this.getAuthorityCount() >= CONFIG.AI_AUTHORITY.SOFT_CAP) {
                        continue;
                    }

                    const spawnQueue = getAISpawnQueue();
                    if (spawnQueue && !spawnQueue.isQueued(this.workerType, building.id)) {
                        spawnQueue.queueSpawn(this.workerType, { building }, building.id);
                    } else if (!spawnQueue) {
                        this._spawnWorker(building);
                    }
                }
            }
        }
    }

    _executeSpawn(data) {
        const { building } = data;
        if (this.entities.has(building.id)) return;
        this._spawnWorker(building);
    }

    _spawnWorker(buildingData) {
        const buildingId = buildingData.id;
        const buildingPos = buildingData.position;

        const spawnRadius = 1.5;
        const startAngle = Math.random() * Math.PI * 2;
        let spawnX = buildingPos.x;
        let spawnZ = buildingPos.z;

        // OPTIMIZATION: Cache isWalkable check
        const isWalkable = this.isWalkable;
        
        for (let attempt = 0; attempt < 8; attempt++) {
            const angle = startAngle + (attempt * 0.785398163); // PI/4 pre-computed
            const testX = buildingPos.x + Math.cos(angle) * spawnRadius;
            const testZ = buildingPos.z + Math.sin(angle) * spawnRadius;

            if (!isWalkable || isWalkable(testX, testZ)) {
                spawnX = testX;
                spawnZ = testZ;
                break;
            }
        }

        const spawnY = this.getTerrainHeight?.(spawnX, spawnZ) ?? buildingPos.y ?? 0;

        const entity = this._createBaseEntityState(buildingId, buildingPos, spawnX, spawnY, spawnZ);
        Object.assign(entity, this._createWorkerSpecificState(buildingData));

        // Store owner faction for shirt color and nametag
        entity.ownerFactionId = buildingData.object?.userData?.ownerFactionId ?? null;

        if (!this._createWorkerVisual(entity)) {
            console.warn(`[${this.constructor.name}] Failed to create visual for ${buildingId}`);
            return;
        }

        this.entities.set(buildingId, entity);

        if (this.pendingStates.has(buildingId)) {
            const pendingState = this.pendingStates.get(buildingId);
            this.pendingStates.delete(buildingId);
            this._applyStateMessage(entity, pendingState);
        }

        if (this.broadcastP2P) {
            this.broadcastP2P({
                type: `${this.workerType}_spawn`,
                buildingId: buildingId,
                position: entity.position,
                rotation: entity.rotation,
                homePosition: entity.homePosition,
                spawnedBy: this.clientId,
                spawnTime: entity.spawnTime,
                ownerFactionId: entity.ownerFactionId,
                ...this._getSpawnBroadcastExtra(entity)
            });
        }
    }

    _createBaseEntityState(buildingId, buildingPos, spawnX, spawnY, spawnZ) {
        const STATES = this._getStateEnum();
        return {
            buildingId: buildingId,
            position: { x: spawnX, y: spawnY, z: spawnZ },
            targetPosition: { x: spawnX, y: spawnY, z: spawnZ },
            rotation: Math.random() * 6.283185307, // PI*2 pre-computed
            targetRotation: 0,
            homePosition: { x: buildingPos.x, y: buildingPos.y ?? spawnY, z: buildingPos.z },

            state: STATES.IDLE,
            targetId: null,
            carrying: [],

            path: [],
            pathIndex: 0,
            lastPathTime: Date.now() - Math.random() * 6000, // Stagger to prevent synchronized pathfinding
            pathFailures: 0,
            pathPending: false,
            lastTargetId: null,

            stuckReason: null,
            stuckTime: 0,
            requestSentAt: null,

            spawnedBy: this.clientId,
            spawnTime: Date.now(),
            authorityId: this.clientId,
            authorityTerm: 1,

            mesh: null,
            visual: null,

            _lastDecisionTime: 0,
            _failedTargets: new Map(),
            _pathfindStuck: false,
            _lastTerrainCheck: 0,
            _cachedOnRoad: false,
            _cachedSlopeMultiplier: 1.0,
            _cachedWalkable: true,
            _cachedWalkablePos: { x: spawnX, z: spawnZ },
            lastSafePosition: { x: spawnX, z: spawnZ },
            retreatTarget: null,
            _skipNextArrival: false,
            _forceReturnHome: false
        };
    }

    _createWorkerVisual(entity) {
        const manGLTF = modelManager.getGLTF('man');
        if (!manGLTF) {
            console.error(`[${this.constructor.name}] Man model not loaded`);
            return false;
        }

        const mesh = SkeletonUtils.clone(manGLTF.scene);
        mesh.scale.set(1, 1, 1);

        let handBone = null;

        // Get faction-specific material for owner's faction color
        const shirtMaterial = this._getFactionMaterial(entity.ownerFactionId);

        mesh.traverse((child) => {
            if (child.isBone && child.name === 'Bone014') {
                handBone = child;
            }
            if (child.isMesh || child.isSkinnedMesh) {
                child.visible = true;
                child.frustumCulled = true;
                if (child.name === 'Cube001_3' && child.material) {
                    child.material = shirtMaterial;
                } else if (child.material) {
                    // Apply euclidean fog fix to other materials
                    applyEuclideanFog(child.material);
                }
            }
        });

        if (handBone) {
            const children = handBone.children;
            for (let i = 0, len = children.length; i < len; i++) {
                const child = children[i];
                if (child.isMesh || child.isGroup) {
                    child.visible = false;
                }
            }
        }

        mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
        mesh.rotation.y = entity.rotation;

        const mixer = new THREE.AnimationMixer(mesh);
        const animations = manGLTF.animations;
        
        // OPTIMIZATION: Use indexed search instead of .find()
        let walkAnim = null;
        let idleAnim = null;
        for (let i = 0, len = animations.length; i < len; i++) {
            const anim = animations[i];
            const nameLower = anim.name.toLowerCase();
            if (!walkAnim && nameLower.includes('walk')) walkAnim = anim;
            if (!idleAnim && nameLower.includes('idle')) idleAnim = anim;
            if (walkAnim && idleAnim) break;
        }

        let walkAction = null;
        let idleAction = null;

        if (walkAnim) {
            walkAction = mixer.clipAction(walkAnim);
        }
        if (idleAnim) {
            idleAction = mixer.clipAction(idleAnim);
            idleAction.loop = THREE.LoopRepeat;
        }

        entity.visual = {
            mixer: mixer,
            walkAction: walkAction,
            idleAction: idleAction,
            isMoving: false
        };
        entity.mesh = mesh;

        this._setupExtraAnimations(entity, mixer, animations);

        if (idleAction) {
            idleAction.play();
        } else if (walkAction) {
            walkAction.play();
            mixer.update(0.001);
            walkAction.stop();
        }

        if (this.game?.scene) {
            this.game.scene.add(mesh);
        }

        if (this.game?.nameTagManager) {
            this.game.nameTagManager.registerEntity(entity.buildingId, this.displayName, mesh);
            if (entity.ownerFactionId) {
                this.game.nameTagManager.setEntityFaction(entity.buildingId, entity.ownerFactionId);
            }
        }

        return true;
    }

    _setupExtraAnimations(entity, mixer, animations) {}

    _getSpawnBroadcastExtra(entity) {
        return {};
    }

    // =========================================================================
    // UPDATE LOOP
    // =========================================================================

    update(deltaTime) {
        if (!CONFIG[this.configKey]?.ENABLED) return;

        this._frameCount++;
        const now = Date.now();

        // Cleanup orphaned pendingStates entries (TTL: 10 seconds)
        if (now - this._lastPendingStatesCleanup > 10000) {
            this._lastPendingStatesCleanup = now;
            for (const [id, entry] of this.pendingStates) {
                if (now - entry._timestamp > 10000) {
                    this.pendingStates.delete(id);
                }
            }
        }

        // OPTIMIZATION: Cache frequently accessed values (with fallbacks before init)
        const myPos = this.game?.playerObject?.position;
        const nearDistSq = this._cachedConfig?.FAR_DISTANCE_SQ ?? this._getConfig('FAR_DISTANCE_SQ');
        const farUpdateInterval = this._cachedConfig?.FAR_UPDATE_INTERVAL ?? this._getConfig('FAR_UPDATE_INTERVAL');
        const frameCount = this._frameCount;
        const deltaSeconds = deltaTime / 1000;

        // OPTIMIZATION: Use iterator directly for better performance on large Maps
        const entities = this.entities;
        for (const entry of entities) {
            const entity = entry[1];
            
            // Distance-based update throttling
            if (myPos) {
                const dx = entity.position.x - myPos.x;
                const dz = entity.position.z - myPos.z;
                const distSq = dx * dx + dz * dz;

                if (distSq > nearDistSq) {
                    if (frameCount % farUpdateInterval !== 0) {
                        // Just update animation for far entities
                        const mixer = entity.visual?.mixer;
                        if (mixer) {
                            mixer.update(deltaSeconds);
                        }
                        continue;
                    }
                }
            }

            this._updateEntity(entity, deltaTime);
        }

        // Broadcast state periodically
        const broadcastInterval = this._cachedConfig?.BROADCAST_INTERVAL ?? this._getConfig('BROADCAST_INTERVAL');
        if (now - this._lastBroadcastTime >= broadcastInterval) {
            this._lastBroadcastTime = now;
            this._broadcastAuthorityState();
        }
    }

    _updateEntity(entity, deltaTime) {
        // Update animation mixer
        const deltaSeconds = deltaTime / 1000;
        const mixer = entity.visual?.mixer;
        if (mixer) {
            mixer.update(deltaSeconds);
        }

        // Non-authority clients interpolate only
        if (entity.authorityId !== this.clientId) {
            this._interpolateEntity(entity, deltaTime);
            return;
        }

        // Authority runs state machine
        const STATES = this._getStateEnum();
        const state = entity.state;

        if (state === STATES.IDLE) {
            this._handleIdleState(entity);
        } else if (state === STATES.STUCK) {
            this._handleStuckState(entity);
        } else if (this.movementStates.has(state)) {
            this._handleMovementState(entity, deltaTime);
        } else {
            this._handleWorkerSpecificState(entity, deltaTime);
        }
    }

    // =========================================================================
    // STATE HANDLERS
    // =========================================================================

    _handleStuckState(entity) {
        const now = Date.now();
        const baseTimeout = this._cachedConfig?.STUCK_TIMEOUT ?? this._getConfig('STUCK_TIMEOUT');
        const timeout = entity._pathfindStuck ? 3000 : baseTimeout;
        if (now - entity.stuckTime >= timeout) {
            const STATES = this._getStateEnum();
            entity.stuckReason = null;
            entity.pathFailures = 0;
            entity.path = [];
            entity.pathIndex = 0;
            entity.pathPending = false;
            entity._pathfindStuck = false;

            // Clean up expired failed targets
            if (entity._failedTargets?.size > 0) {
                for (const [targetId, failedAt] of entity._failedTargets) {
                    if (now - failedAt > 6000) {
                        entity._failedTargets.delete(targetId);
                    }
                }
            }

            // Force return home ignoring obstacles
            if (STATES.RETURNING !== undefined) {
                entity._forceReturnHome = true;
                entity.state = STATES.RETURNING;
                entity.targetId = null;
                entity.lastPathTime = 0;
            } else {
                entity.state = STATES.IDLE;
            }
        }
    }

    _enterStuckState(entity, reason) {
        const STATES = this._getStateEnum();
        entity.state = STATES.STUCK;
        entity.stuckReason = reason;
        entity.stuckTime = Date.now();
        entity._forceReturnHome = false;
        this._setMoving(entity, false);
    }

    _isBuildingDestroyed(entity) {
        if (!this.gameState?.getStructureById(entity.buildingId)) {
            this._enterStuckState(entity, 'Building was destroyed');
            return true;
        }
        return false;
    }

    /**
     * Check if this client has authority over the entity
     */
    _hasAuthority(entity) {
        return entity.authorityId === this.clientId;
    }

    /**
     * Count entities this client has authority over
     * @returns {number}
     */
    getAuthorityCount() {
        let count = 0;
        for (const entity of this.entities.values()) {
            if (entity.authorityId === this.clientId && entity.state !== 'dead') {
                count++;
            }
        }
        return count;
    }

    _handleMovementState(entity, deltaTime) {
        if (entity.pathPending) {
            const path = entity.path;
            if (path && path.length > 0 && entity.pathIndex < path.length) {
                this._setMoving(entity, true);
                const arrived = this._moveAlongPath(entity, deltaTime);
                if (arrived) {
                    entity.path = [];
                    entity.pathIndex = 0;
                    this._setMoving(entity, false);
                    this._checkRetreatOrArrival(entity);
                }
            } else {
                // Don't walk in place while waiting for path
                this._setMoving(entity, false);
            }
            return;
        }

        const now = Date.now();
        const pathfindInterval = this._cachedConfig?.PATHFIND_INTERVAL ?? this._getConfig('PATHFIND_INTERVAL');

        if (now - entity.lastPathTime < pathfindInterval) {
            const path = entity.path;
            if (path && path.length > 0 && entity.pathIndex < path.length) {
                this._setMoving(entity, true);
                const arrived = this._moveAlongPath(entity, deltaTime);
                if (arrived) {
                    entity.path = [];
                    entity.pathIndex = 0;
                    this._setMoving(entity, false);
                    this._checkRetreatOrArrival(entity);
                }
            } else {
                this._setMoving(entity, false);
            }
            return;
        }

        const target = this._getMovementTarget(entity);
        if (!target) {
            const STATES = this._getStateEnum();
            entity.state = STATES.IDLE;
            entity.pathFailures = 0;
            this._setMoving(entity, false);
            return;
        }

        const currentTargetId = target.id || `${target.x},${target.z}`;
        if (entity.lastTargetId !== currentTargetId) {
            entity.lastTargetId = currentTargetId;
            entity.pathFailures = 0;
        }

        // Skip targets that recently failed pathfinding
        const failedAt = entity._failedTargets?.get(currentTargetId);
        if (failedAt && Date.now() - failedAt < 6000) {
            const STATES = this._getStateEnum();
            entity.state = STATES.IDLE;
            entity._lastDecisionTime = Date.now();
            this._setMoving(entity, false);
            return;
        }

        if (this.findPathAsync) {
            entity.pathPending = true;
            entity.lastPathTime = now;
            const requestTargetId = currentTargetId;
            const pathOptions = entity._forceReturnHome ? { ignoreObstacles: true } : {};

            this.findPathAsync(entity.position, target, pathOptions)
                .then(path => {
                    entity.pathPending = false;

                    if (!this._hasAuthority(entity)) return;
                    if (entity.lastTargetId !== requestTargetId) return;

                    if (path && path.length > 0) {
                        entity.path = path;
                        entity.pathIndex = 0;
                        entity.pathFailures = 0;
                    } else {
                        const currentTarget = this._getMovementTarget(entity);
                        if (!currentTarget) return;

                        const dx = currentTarget.x - entity.position.x;
                        const dz = currentTarget.z - entity.position.z;
                        const distSq = dx * dx + dz * dz;

                        if (distSq < 0.25) {
                            entity.pathFailures = 0;
                            this._setMoving(entity, false);
                            this._checkRetreatOrArrival(entity);
                            return;
                        }

                        entity.pathFailures = (entity.pathFailures || 0) + 1;
                        if (entity.pathFailures >= 3) {
                            // DEBUG: Log why worker is entering stuck (throttled per-entity, once per 30s)
                            const now2 = Date.now();
                            if (!entity._lastStuckLog || now2 - entity._lastStuckLog > 30000) {
                                entity._lastStuckLog = now2;
                                const chunkX = Math.floor((entity.position.x + 25) / 50);
                                const chunkZ = Math.floor((entity.position.z + 25) / 50);
                                const tChunkX = Math.floor((currentTarget.x + 25) / 50);
                                const tChunkZ = Math.floor((currentTarget.z + 25) / 50);
                                console.error(`[WorkerStuck] ${this.workerType} | state=${entity.state} | pos=(${entity.position.x.toFixed(1)},${entity.position.z.toFixed(1)}) chunk(${chunkX},${chunkZ}) | target=(${currentTarget.x.toFixed(1)},${currentTarget.z.toFixed(1)}) chunk(${tChunkX},${tChunkZ}) | dist=${Math.sqrt(distSq).toFixed(1)} | building=${entity.buildingId}`);
                            }
                            entity._failedTargets?.set(requestTargetId, Date.now());
                            entity._pathfindStuck = true;
                            entity.pathFailures = 0;
                            const STATES = this._getStateEnum();
                            entity.state = STATES.STUCK;
                            entity.stuckTime = Date.now();
                            this._setMoving(entity, false);
                        }
                    }
                })
                .catch(() => {
                    entity.pathPending = false;
                });
            return;
        }

        entity.lastPathTime = now;

        if (this.findPath) {
            const path = this.findPath(entity.position, target);
            if (path && path.length > 0) {
                entity.path = path;
                entity.pathIndex = 0;
                entity.pathFailures = 0;
            } else {
                const dx = target.x - entity.position.x;
                const dz = target.z - entity.position.z;
                const distSq = dx * dx + dz * dz;

                if (distSq < 0.25) {
                    entity.pathFailures = 0;
                    this._setMoving(entity, false);
                    this._checkRetreatOrArrival(entity);
                    return;
                }

                entity.pathFailures = (entity.pathFailures || 0) + 1;
                if (entity.pathFailures >= 3) {
                    entity._failedTargets?.set(currentTargetId, Date.now());
                    entity._pathfindStuck = true;
                    entity.pathFailures = 0;
                    const STATES = this._getStateEnum();
                    entity.state = STATES.STUCK;
                    entity.stuckTime = Date.now();
                    this._setMoving(entity, false);
                    return;
                }
            }
        } else {
            if (!entity._loggedNoPathfinder) {
                entity._loggedNoPathfinder = true;
                console.error(`[NavDiag] ${this.workerType} entity=${entity.id} has NO findPath or findPathAsync callback`);
            }
        }

        const path = entity.path;
        if (!path || path.length === 0) {
            this._setMoving(entity, false);
            return;
        }

        if (entity.pathIndex >= path.length) {
            entity.path = [];
            entity.pathIndex = 0;
            this._setMoving(entity, false);
            this._checkRetreatOrArrival(entity);
            return;
        }

        this._setMoving(entity, true);

        const arrived = this._moveAlongPath(entity, deltaTime);
        if (arrived) {
            entity.path = [];
            entity.pathIndex = 0;
            this._setMoving(entity, false);
            this._checkRetreatOrArrival(entity);
        }
    }

    // =========================================================================
    // PATHFINDING & MOVEMENT
    // =========================================================================

    /**
     * OPTIMIZATION: Reduced function call overhead, cached values
     */
    _calculateTerrainSpeed(entity, dirX, dirZ) {
        const now = Date.now();

        // Refresh terrain cache every 250ms
        if (now - entity._lastTerrainCheck > 250) {
            entity._lastTerrainCheck = now;

            const posX = entity.position.x;
            const posZ = entity.position.z;

            // Road check
            entity._cachedOnRoad = this.isOnRoad ? this.isOnRoad(posX, posZ) : false;

            // Slope check
            const getTerrainHeight = this.getTerrainHeight;
            if (getTerrainHeight) {
                const currentHeight = getTerrainHeight(posX, posZ) || 0;
                const aheadHeight = getTerrainHeight(posX + dirX, posZ + dirZ) || 0;

                const slope = Math.abs(aheadHeight - currentHeight);
                // OPTIMIZATION: Pre-computed: 180/PI ≈ 57.2957795, 1/45 ≈ 0.0222222
                const slopeDegrees = Math.atan(slope) * 57.2957795;
                const normalized = slopeDegrees * 0.0222222; // /45
                const clamped = normalized > 1.0 ? 1.0 : normalized;
                const slopeMultiplier = 1.0 - clamped * 0.9; // (1 - 0.1)
                entity._cachedSlopeMultiplier = slopeMultiplier > 0.1 ? slopeMultiplier : 0.1;
            }
        }

        // Use cached values
        const speedMultiplier = (entity._cachedOnRoad ? 1.5 : 1.0) * (entity._cachedSlopeMultiplier || 1.0);
        const moveSpeed = this._cachedConfig?.MOVE_SPEED ?? this._getConfig('MOVE_SPEED');
        return moveSpeed * speedMultiplier;
    }

    _moveAlongPath(entity, deltaTime) {
        const path = entity.path;
        let pathIndex = entity.pathIndex;
        const pathLength = path.length;

        if (pathLength === 0 || pathIndex >= pathLength) {
            return true;
        }

        // OPTIMIZATION: Cache position reference
        const pos = entity.position;
        
        let target = path[pathIndex];
        let dx = target.x - pos.x;
        let dz = target.z - pos.z;
        let distSq = dx * dx + dz * dz;
        let dist = Math.sqrt(distSq);
        let dirX = dist > 0.01 ? dx / dist : 0;
        let dirZ = dist > 0.01 ? dz / dist : 0;

        const speed = this._calculateTerrainSpeed(entity, dirX, dirZ);
        let remainingMove = speed * (deltaTime / 1000);

        while (remainingMove > 0.0001 && pathIndex < pathLength) {
            target = path[pathIndex];
            dx = target.x - pos.x;
            dz = target.z - pos.z;
            distSq = dx * dx + dz * dz;
            dist = Math.sqrt(distSq);

            if (dist <= remainingMove) {
                pos.x = target.x;
                pos.z = target.z;
                remainingMove -= dist;
                pathIndex++;
            } else {
                dirX = dx / dist;
                dirZ = dz / dist;
                pos.x += dirX * remainingMove;
                pos.z += dirZ * remainingMove;
                remainingMove = 0;
                entity.rotation = Math.atan2(dx, dz);
            }
        }
        
        entity.pathIndex = pathIndex;

        // Update terrain height
        const getTerrainHeight = this.getTerrainHeight;
        if (getTerrainHeight) {
            pos.y = getTerrainHeight(pos.x, pos.z);

            // Steep slope detection (throttled to every 500ms) - skip when force-returning home
            if (!entity._forceReturnHome && (!entity._lastSteepCheck || Date.now() - entity._lastSteepCheck > 500)) {
                entity._lastSteepCheck = Date.now();
                const sd = 0.5;
                const cy = pos.y;
                // tan(45°) * 0.5 = 0.5 — block terrain steeper than 45°
                const maxDiff = Math.max(
                    Math.abs((getTerrainHeight(pos.x + sd, pos.z) || 0) - cy),
                    Math.abs((getTerrainHeight(pos.x - sd, pos.z) || 0) - cy),
                    Math.abs((getTerrainHeight(pos.x, pos.z + sd) || 0) - cy),
                    Math.abs((getTerrainHeight(pos.x, pos.z - sd) || 0) - cy)
                );
                if (maxDiff > 0.5) {
                    this._handleSteepSlopeDetected(entity, pos.x, pos.z);
                    return true;
                }
            }

            // Water detection - mark water and retreat if height < 0.3
            const WATER_THRESHOLD = 0.3;
            if (pos.y < WATER_THRESHOLD) {
                this._handleWaterDetected(entity, pos.x, pos.z);
                return true; // Stop movement this tick
            }
            // Track last safe position for retreat
            entity.lastSafePosition = { x: pos.x, z: pos.z };
        }

        // Update mesh
        const mesh = entity.mesh;
        if (mesh) {
            mesh.position.set(pos.x, pos.y, pos.z);
            // Smooth rotation to avoid jerky snaps on tiny path corrections
            let rotDiff = entity.rotation - mesh.rotation.y;
            if (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
            if (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
            mesh.rotation.y += rotDiff * Math.min(1, 12 * deltaTime / 1000);
        }

        return pathIndex >= pathLength;
    }

    /**
     * Handle water detection - mark water cell and retreat to last safe position
     * Called when AI steps on terrain with height < 0.3
     */
    _handleWaterDetected(entity, waterX, waterZ) {
        this.game?.navigationManager?.scanAreaWalkability(waterX, waterZ, 3, this.getTerrainHeight);
        entity.path = [];
        entity.pathIndex = 0;
        entity._skipNextArrival = true;
        if (entity.lastSafePosition) {
            entity.lastPathTime = 0;
        }
    }

    _handleSteepSlopeDetected(entity, slopeX, slopeZ) {
        this.game?.navigationManager?.scanAreaWalkability(slopeX, slopeZ, 3, this.getTerrainHeight);
        entity.path = [];
        entity.pathIndex = 0;
        entity._skipNextArrival = true;
        if (entity.lastSafePosition) {
            entity.lastPathTime = 0;
        }
    }

    // =========================================================================
    // ANIMATION
    // =========================================================================

    _setMoving(entity, isMoving) {
        const visual = entity.visual;
        if (!visual) return;
        if (visual.isMoving === isMoving) return;

        visual.isMoving = isMoving;
        this._onMovingChanged(entity, isMoving);

        if (isMoving) {
            visual.idleAction?.stop();
            visual.walkAction?.reset().play();
        } else {
            visual.walkAction?.stop();
            if (visual.idleAction) {
                visual.idleAction.reset().play();
            } else if (visual.walkAction) {
                visual.walkAction.play();
                visual.mixer?.update(0.001);
                visual.walkAction.stop();
            }
        }
    }

    _onMovingChanged(entity, isMoving) {}

    /**
     * OPTIMIZATION: Reduced object access depth, cached thresholds
     */
    _interpolateEntity(entity, deltaTime) {
        const target = entity.targetPosition;
        if (!target) return;

        const pos = entity.position;
        const dx = target.x - pos.x;
        const dy = target.y - pos.y;
        const dz = target.z - pos.z;
        const distSq = dx * dx + dz * dz;

        const cfg = this._cachedConfig;
        let isMoving = false;

        if (distSq > cfg.TELEPORT_THRESHOLD_SQ) {
            pos.x = target.x;
            pos.z = target.z;
        } else if (distSq < cfg.SNAP_THRESHOLD_SQ) {
            pos.x = target.x;
            pos.z = target.z;
        } else {
            isMoving = true;
            const dist = Math.sqrt(distSq);
            const dirX = dx / dist;
            const dirZ = dz / dist;

            const baseSpeed = this._calculateTerrainSpeed(entity, dirX, dirZ);
            const catchUpMultiplier = distSq > cfg.CATCHUP_THRESHOLD_SQ ? 1.5 : 1.0;
            const speed = baseSpeed * catchUpMultiplier;
            const deltaSeconds = deltaTime / 1000;
            const moveDist = speed * deltaSeconds;
            const actualMove = moveDist < dist ? moveDist : dist;

            pos.x += dirX * actualMove;
            pos.z += dirZ * actualMove;
        }

        // Y position
        const getTerrainHeight = this.getTerrainHeight;
        if (getTerrainHeight) {
            const targetY = getTerrainHeight(pos.x, pos.z);
            const yLerpFactor = 8.0 * (deltaTime / 1000);
            const clampedLerp = yLerpFactor > 1.0 ? 1.0 : yLerpFactor;
            pos.y += (targetY - pos.y) * clampedLerp;
        }

        // Rotation
        let targetRotation;
        if (isMoving) {
            targetRotation = Math.atan2(dx, dz);
        } else if (entity.targetRotation !== undefined) {
            targetRotation = entity.targetRotation;
        } else {
            targetRotation = entity.rotation;
        }

        let rotDiff = targetRotation - entity.rotation;
        // OPTIMIZATION: Pre-computed PI*2 = 6.283185307
        while (rotDiff > 3.14159265) rotDiff -= 6.283185307;
        while (rotDiff < -3.14159265) rotDiff += 6.283185307;

        const maxRotation = 2.1 * (deltaTime / 1000);
        if (rotDiff > maxRotation) rotDiff = maxRotation;
        else if (rotDiff < -maxRotation) rotDiff = -maxRotation;
        entity.rotation += rotDiff;

        // Update mesh
        const mesh = entity.mesh;
        if (mesh) {
            mesh.position.set(pos.x, pos.y, pos.z);
            mesh.rotation.y = entity.rotation;
        }

        this._setMoving(entity, isMoving);
    }

    // =========================================================================
    // AUTHORITY SYSTEM
    // =========================================================================

    _calculateAuthority(buildingId) {
        const entity = this.entities.get(buildingId);
        if (!entity) return this.clientId;

        const pos = entity.position;
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(pos.x, pos.z);
        
        // OPTIMIZATION: Fill pre-allocated array
        let keyIdx = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                this._nearbyChunkKeys[keyIdx++] = `${chunkX + dx},${chunkZ + dz}`;
            }
        }

        const players = this.getPlayersInChunks?.(this._nearbyChunkKeys);
        if (!players || players.length === 0) return this.clientId;

        let lowestId = this.clientId;
        const isPlayerActive = this.isPlayerActive;
        
        for (let i = 0, len = players.length; i < len; i++) {
            const playerId = players[i];
            if (isPlayerActive && !isPlayerActive(playerId)) continue;
            if (lowestId === null || playerId < lowestId) {
                lowestId = playerId;
            }
        }

        return lowestId;
    }

    _checkStaleAuthorities() {
        const isPlayerActive = this.isPlayerActive;
        if (!isPlayerActive) return;

        const STATES = this._getStateEnum();
        const clientId = this.clientId;

        for (const [buildingId, entity] of this.entities) {
            if (entity.authorityId === clientId) continue;
            if (entity.state === STATES.STUCK) continue;

            // Check 1: Reclaim from inactive authority
            if (!isPlayerActive(entity.authorityId)) {
                const newAuthority = this._calculateAuthority(buildingId);
                if (newAuthority === clientId) {
                    this._claimAuthority(buildingId, entity);
                }
                entity._pendingAuthorityCheck = false;
            }
            // Check 2: Reclaim from wrong-but-active authority
            // This fixes a race condition where authority incorrectly transfers
            // to a higher-clientId player due to transient network issues
            else if (entity.authorityId > clientId) {
                const newAuthority = this._calculateAuthority(buildingId);
                if (newAuthority === clientId) {
                    this._claimAuthority(buildingId, entity);
                }
            }
        }
    }

    onPeerDisconnected(peerId) {
        const clientId = this.clientId;
        for (const [buildingId, entity] of this.entities) {
            if (entity.authorityId === peerId) {
                const newAuthority = this._calculateAuthority(buildingId);
                if (newAuthority === clientId) {
                    this._claimAuthority(buildingId, entity);
                }
            }
        }
    }

    onPeerJoinedChunk(peerId, chunkKey) {
        const [peerChunkX, peerChunkZ] = chunkKey.split(',').map(Number);
        const clientId = this.clientId;
        
        for (const [buildingId, entity] of this.entities) {
            const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(entity.homePosition.x, entity.homePosition.z);

            const dx = peerChunkX - chunkX;
            const dz = peerChunkZ - chunkZ;
            
            // OPTIMIZATION: Use comparison instead of Math.abs
            if (dx >= -1 && dx <= 1 && dz >= -1 && dz <= 1) {
                const newAuthority = this._calculateAuthority(buildingId);
                if (newAuthority !== entity.authorityId) {
                    if (newAuthority === clientId) {
                        this._claimAuthority(buildingId, entity);
                    } else {
                        entity.authorityId = newAuthority;
                    }
                }
            }
        }
    }

    onPeerChunkChanged(peerId, oldChunkKey, newChunkKey) {
        if (oldChunkKey) {
            const [oldChunkX, oldChunkZ] = oldChunkKey.split(',').map(Number);
            const clientId = this.clientId;
            
            for (const [buildingId, entity] of this.entities) {
                const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(entity.homePosition.x, entity.homePosition.z);
                const dx = oldChunkX - chunkX;
                const dz = oldChunkZ - chunkZ;

                if (dx >= -1 && dx <= 1 && dz >= -1 && dz <= 1) {
                    if (entity.authorityId === peerId) {
                        const newAuthority = this._calculateAuthority(buildingId);
                        if (newAuthority === clientId) {
                            this._claimAuthority(buildingId, entity);
                        } else {
                            entity.authorityId = newAuthority;
                        }
                    }
                }
            }
        }

        this.onPeerJoinedChunk(peerId, newChunkKey);
    }

    _claimAuthority(buildingId, entity) {
        const newAuthority = this._calculateAuthority(buildingId);
        if (newAuthority === this.clientId) {
            entity.authorityId = this.clientId;
            entity.authorityTerm = (entity.authorityTerm || 0) + 1;

            entity.path = [];
            entity.pathIndex = 0;
            entity.pathPending = false;
            entity.pathFailures = 0;
            entity.lastPathTime = 0;

            const target = entity.targetPosition;
            if (target) {
                entity.position.x = target.x;
                entity.position.y = target.y;
                entity.position.z = target.z;
            }

            const mesh = entity.mesh;
            if (mesh) {
                const pos = entity.position;
                mesh.position.set(pos.x, pos.y, pos.z);
            }

            this._broadcastSingleEntityState(buildingId, entity);
        }
    }

    /**
     * OPTIMIZATION: Consolidated broadcast logic to reduce duplication
     */
    _fillBroadcastMessage(buildingId, entity) {
        const msg = this._broadcastMsg;
        msg.buildingId = buildingId;
        msg.term = entity.authorityTerm || 1;
        msg.authorityTerm = entity.authorityTerm || 1;
        msg.authorityId = entity.authorityId;
        
        const pos = entity.position;
        msg.position.x = pos.x;
        msg.position.y = pos.y;
        msg.position.z = pos.z;
        
        msg.rotation = entity.rotation;
        msg.state = entity.state;
        msg.targetId = entity.targetId;
        msg.moving = entity.visual?.isMoving || false;
        msg.stuckReason = entity.stuckReason;

        // OPTIMIZATION: Clear and fill array without creating new one
        const msgCarrying = msg.carrying;
        const entityCarrying = entity.carrying;
        msgCarrying.length = 0;
        for (let i = 0, len = entityCarrying.length; i < len; i++) {
            msgCarrying.push(entityCarrying[i]);
        }

        this._addBroadcastExtraFields(entity, msg);
    }

    _broadcastSingleEntityState(buildingId, entity) {
        if (!this.broadcastP2P) return;
        this._fillBroadcastMessage(buildingId, entity);
        this.broadcastP2P(this._broadcastMsg);
    }

    // =========================================================================
    // P2P NETWORKING
    // =========================================================================

    _broadcastAuthorityState() {
        if (!this.broadcastP2P) return;

        this._checkStaleAuthorities();

        const clientId = this.clientId;
        const broadcastP2P = this.broadcastP2P;
        
        for (const [buildingId, entity] of this.entities) {
            if (entity.authorityId !== clientId) continue;
            
            this._fillBroadcastMessage(buildingId, entity);
            broadcastP2P(this._broadcastMsg);
        }
    }

    _addBroadcastExtraFields(entity, msg) {}

    handleStateMessage(message) {
        const { buildingId, term, authorityTerm, authorityId, position, rotation, state, targetId, moving, carrying, stuckReason } = message;

        const entity = this.entities.get(buildingId);
        if (!entity) {
            message._timestamp = Date.now();
            this.pendingStates.set(buildingId, message);
            return;
        }

        const remoteTerm = term || authorityTerm || 0;
        const localTerm = entity.authorityTerm || 0;
        const remoteAuthority = authorityId || message.senderId;

        if (remoteTerm > localTerm) {
            entity.authorityTerm = remoteTerm;
            entity.authorityId = remoteAuthority;
        } else if (remoteTerm === localTerm && remoteAuthority && remoteAuthority !== entity.authorityId) {
            if (remoteAuthority < entity.authorityId) {
                entity.authorityId = remoteAuthority;
            }
        }

        if (entity.authorityId === this.clientId) return;

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
        entity.state = state;
        entity.targetId = targetId;
        entity.stuckReason = stuckReason;

        if (carrying) {
            entity.carrying = carrying;
        }

        this._setMoving(entity, moving);
        this._applyExtraStateFields(entity, message);
    }

    _applyExtraStateFields(entity, message) {}

    handleSpawnMessage(message) {
        const { buildingId, position, rotation, homePosition, spawnedBy, spawnTime } = message;

        if (this.entities.has(buildingId)) {
            const existingEntity = this.entities.get(buildingId);

            if (spawnedBy < existingEntity.spawnedBy) {
                this._removeWorker(buildingId);
            } else {
                return;
            }
        }

        const building = this.gameState?.getStructureById(buildingId);
        if (!building) {
            message._timestamp = Date.now();
            this.pendingStates.set(buildingId, message);
            return;
        }

        const spawnY = this.getTerrainHeight?.(position.x, position.z) ?? position.y ?? 0;

        const entity = this._createBaseEntityState(buildingId, homePosition, position.x, spawnY, position.z);
        entity.rotation = rotation;
        entity.targetRotation = rotation;
        entity.spawnedBy = spawnedBy;
        entity.spawnTime = spawnTime || Date.now();
        entity.authorityId = spawnedBy;

        Object.assign(entity, this._createWorkerSpecificState(building));
        this._applySpawnMessageExtra(entity, message);

        // Apply owner faction from message (for shirt color and nametag)
        entity.ownerFactionId = message.ownerFactionId ?? null;

        if (!this._createWorkerVisual(entity)) {
            return;
        }

        this.entities.set(buildingId, entity);
    }

    _applySpawnMessageExtra(entity, message) {}

    handleDespawnMessage(message) {
        const { buildingId } = message;
        this._removeWorker(buildingId);
    }

    _applyStateMessage(entity, message) {
        entity.targetPosition = { ...message.position };
        entity.targetRotation = message.rotation;
        entity.state = message.state;
        if (message.carrying) {
            // Deep copy to avoid mutation issues
            entity.carrying = message.carrying.map(c => ({ ...c }));
        }
        this._setMoving(entity, message.moving);
        this._applyExtraStateFields(entity, message);
    }

    getActiveWorkersForSync() {
        const result = [];
        const clientId = this.clientId;

        for (const [buildingId, entity] of this.entities) {
            if (entity.authorityId === clientId) {
                result.push({
                    buildingId,
                    spawnedBy: entity.spawnedBy,
                    spawnTime: entity.spawnTime,
                    position: { ...entity.position },
                    rotation: entity.rotation,
                    homePosition: { ...entity.homePosition },
                    state: entity.state,
                    carrying: entity.carrying.slice(), // OPTIMIZATION: slice vs spread for arrays
                    authorityId: entity.authorityId,
                    authorityTerm: entity.authorityTerm || 1,
                    moving: entity.visual?.isMoving || false,
                    ownerFactionId: entity.ownerFactionId,
                    ...this._getSyncExtraFields(entity)
                });
            }
        }
        return result;
    }

    _getSyncExtraFields(entity) {
        return {};
    }

    syncWorkersFromPeer(workerList, peerId) {
        for (let i = 0, len = workerList.length; i < len; i++) {
            const data = workerList[i];
            if (!this.entities.has(data.buildingId)) {
                this.handleSpawnMessage({
                    ...data,
                    spawnedBy: data.spawnedBy || peerId
                });

                const entity = this.entities.get(data.buildingId);
                if (entity) {
                    if (data.state) entity.state = data.state;
                    if (data.carrying && Array.isArray(data.carrying)) {
                        entity.carrying = data.carrying.slice();
                    }
                    if (data.authorityId) entity.authorityId = data.authorityId;
                    if (data.authorityTerm) entity.authorityTerm = data.authorityTerm;
                    if (data.rotation !== undefined) {
                        entity.rotation = data.rotation;
                        entity.targetRotation = data.rotation;
                    }
                    if (data.position && entity.mesh) {
                        const pos = entity.position;
                        pos.x = data.position.x;
                        pos.y = data.position.y;
                        pos.z = data.position.z;
                        entity.targetPosition = { ...data.position };
                        entity.mesh.position.set(pos.x, pos.y, pos.z);
                        if (data.rotation !== undefined) {
                            entity.mesh.rotation.y = data.rotation;
                        }
                    }
                    if (data.moving !== undefined) {
                        this._setMoving(entity, data.moving);
                    }
                    this._applyExtraStateFields(entity, data);
                }
            }
        }
    }

    // =========================================================================
    // STATE HELPER
    // =========================================================================

    /**
     * Get the assessment state for this worker type
     * This is the "figure out what to do next" state (ASSESSING_BAKERY, ASSESSING_STRUCTURE, etc.)
     */
    _getAssessmentState() {
        const STATES = this._getStateEnum();
        return STATES[this.assessmentStateName];
    }

    // =========================================================================
    // SHARED INVENTORY HELPERS
    // =========================================================================

    /**
     * Calculate current firewood durability based on tick elapsed
     * Matches CrateInventoryUI._calculateFirewoodDurability and EffectManager._calculateFirewoodDurability
     * @param {object} item - Firewood item with durability and placedAtTick
     * @returns {number} Current calculated durability
     */
    _calculateFirewoodDurability(item) {
        if (!item.placedAtTick) {
            // No tick stamp = not burning (in regular inventory or legacy data)
            return item.durability;
        }

        const currentTick = this.gameState?.serverTick || 0;
        const ticksElapsed = currentTick - item.placedAtTick;
        const minutesElapsed = ticksElapsed / 60; // 60 ticks per minute
        // Firewood depletes at 2 durability per minute
        const durabilityLost = minutesElapsed * 2;
        const currentDurability = item.durability - durabilityLost;

        return Math.max(0, currentDurability);
    }

    /**
     * Cleanup depleted firewood from structure inventory
     * Same logic as CrateInventoryUI._processInventoryOnLoad
     * @param {string} structureId - Structure object ID
     * @param {object} inventory - Structure inventory { items: [...] }
     * @param {string} chunkId - Chunk ID (e.g. 'chunk_0_0')
     * @returns {boolean} True if changes were made and saved
     */
    _cleanupDepletedFirewood(structureId, inventory, chunkId) {
        if (!inventory?.items || !this.networkManager) return false;

        const items = inventory.items;
        const depletedFirewood = [];

        // Find depleted firewood
        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            if (item?.type?.endsWith('firewood') && item.placedAtTick) {
                const currentDurability = this._calculateFirewoodDurability(item);
                if (currentDurability <= 0) {
                    depletedFirewood.push({ item, index: i });
                }
            }
        }

        if (depletedFirewood.length === 0) return false;

        // Remove depleted firewood from inventory
        for (const { item, index } of depletedFirewood) {
            items.splice(index, 1);
        }

        // Check if any firewood remains
        const hasFirewoodLeft = items.some(item =>
            item?.type?.endsWith('firewood') && this._calculateFirewoodDurability(item) > 0
        );

        // If no firewood left, cancel any active processing/cooking
        if (!hasFirewoodLeft) {
            for (const item of items) {
                if (item.processingStartTick) {
                    delete item.processingStartTick;
                    delete item.processingDurationTicks;
                }
                if (item.cookingStartTick) {
                    delete item.cookingStartTick;
                    delete item.cookingDurationTicks;
                }
            }
        }

        // Save updated inventory to server
        this.networkManager.sendMessage('save_crate_inventory', {
            crateId: structureId,
            chunkId: chunkId,
            inventory: inventory
        });

        return true;
    }

    /**
     * Cleanup depleted firewood and return count of remaining firewood
     * Combines cleanup + count in one call for assessment methods
     * @param {string} structureId - Structure object ID
     * @param {object} inventory - Structure inventory { items: [...] }
     * @param {string} chunkId - Chunk ID (e.g. 'chunk_0_0')
     * @returns {number} Count of remaining firewood with durability > 0
     */
    _cleanupAndCountFirewood(structureId, inventory, chunkId) {
        // First cleanup any depleted firewood
        this._cleanupDepletedFirewood(structureId, inventory, chunkId);
        // Then count remaining
        return this._countFirewood(inventory);
    }

    /**
     * Count firewood items in an inventory (array-based inventory)
     * Uses tick-based durability calculation
     */
    _countFirewood(inventory) {
        if (!inventory?.items) return 0;
        let count = 0;
        for (const item of inventory.items) {
            if (item?.type?.endsWith('firewood') && this._calculateFirewoodDurability(item) > 0) {
                count++;
            }
        }
        return count;
    }

    /**
     * Count items of a specific type in an inventory (array-based inventory)
     */
    _countItemsOfType(inventory, itemType) {
        if (!inventory?.items) return 0;
        let count = 0;
        for (const item of inventory.items) {
            if (item?.type === itemType) count++;
        }
        return count;
    }

    /**
     * Check if market has firewood (market uses object-based inventory)
     */
    _marketHasFirewood(inventory) {
        if (!inventory?.items) return false;

        for (const type of Object.keys(inventory.items)) {
            if (type.endsWith('firewood')) {
                const tiers = inventory.items[type];
                for (const key of Object.keys(tiers)) {
                    if (tiers[key] > 0) return true;
                }
            }
        }
        return false;
    }

    /**
     * Check if market has enough of a specific item
     * @param {object} inventory - Market inventory (object-based)
     * @param {string} itemType - Item type to check
     * @param {number} minCount - Minimum count required
     * @returns {boolean} True if market has enough
     */
    _marketHasItem(inventory, itemType, minCount = 1) {
        if (!inventory?.items) return false;

        const itemData = inventory.items[itemType];
        if (!itemData) return false;

        let total = 0;
        for (const key of Object.keys(itemData)) {
            total += itemData[key] || 0;
        }
        return total >= minCount;
    }

    /**
     * Update local structure inventory cache after NPC operations
     * Prevents stale reads before server sync arrives
     * @param {string} structureId - Structure to update
     * @param {Array} itemsToAdd - Items to add to inventory
     * @param {Array} itemsToRemove - Items to remove from inventory (by id or type)
     */
    _updateLocalInventoryCache(structureId, itemsToAdd = [], itemsToRemove = []) {
        const structureData = this.gameState?.getStructureById(structureId);
        if (!structureData?.object?.userData) return;

        // BUGFIX: Skip markets - they use object-based inventory (not array)
        // and receive proper updates via market_inventory_updated broadcasts
        if (structureData.object.userData.modelType === 'market') {
            return;
        }

        // Ensure inventory exists
        if (!structureData.object.userData.inventory) {
            structureData.object.userData.inventory = { items: [] };
        }
        const inv = structureData.object.userData.inventory;
        if (!Array.isArray(inv.items)) inv.items = [];

        // Remove items first
        for (const removeItem of itemsToRemove) {
            const idx = inv.items.findIndex(item =>
                item.id === removeItem.id ||
                (removeItem.type && item.type === removeItem.type)
            );
            if (idx !== -1) {
                inv.items.splice(idx, 1);
            }
        }

        // Add items
        for (const addItem of itemsToAdd) {
            inv.items.push({ ...addItem });
        }
    }

    // =========================================================================
    // SHARED FIREWOOD HANDLING
    // =========================================================================

    /**
     * Handle collecting firewood from market
     * Used by Baker, IronWorker, TileWorker, etc.
     */
    _handleCollectingFirewood(entity) {
        if (!entity.requestSentAt) {
            entity.requestSentAt = Date.now();

            if (this.networkManager) {
                const marketData = this.gameState?.getStructureById(entity.targetId);
                if (marketData) {
                    this.networkManager.sendMessage('npc_collect_from_market', {
                        npcType: this.workerType,
                        structureId: entity.buildingId,
                        marketId: entity.targetId,
                        chunkId: `chunk_${marketData.chunkKey}`,
                        itemType: 'firewood',
                        count: 1
                    });
                }
            }
        }

        if (Date.now() - entity.requestSentAt > 10000) {
            entity.requestSentAt = null;
            const STATES = this._getStateEnum();
            entity.state = STATES.RETURNING;
            entity.targetId = null;
        }
    }

    /**
     * Handle waiting for firewood at market
     */
    _handleWaitingForFirewood(entity) {
        const now = Date.now();
        if (now - entity._lastDecisionTime < 30000) return;
        entity._lastDecisionTime = now;
        if (this._isBuildingDestroyed(entity)) return;

        const market = this._findMarketNearPosition(entity.homePosition, this._getConfig('MARKET_MAX_DISTANCE'));
        if (market) {
            const marketData = this.gameState?.getStructureById(market.id);
            const marketInv = marketData?.object?.userData?.inventory;
            if (this._marketHasFirewood(marketInv)) {
                const STATES = this._getStateEnum();
                // Go to assessing state (ASSESSING_BAKERY or ASSESSING_STRUCTURE)
                entity.state = this._getAssessmentState();
            }
        }
    }

    /**
     * Handle removing excess firewood from structure
     */
    _handleRemovingExcessFirewood(entity) {
        if (!entity.requestSentAt) {
            entity.requestSentAt = Date.now();

            if (this.networkManager) {
                const structureData = this.gameState?.getStructureById(entity.buildingId);
                if (structureData) {
                    this.networkManager.sendMessage('npc_remove_excess_firewood', {
                        npcType: this.workerType,
                        structureId: entity.buildingId,
                        chunkId: `chunk_${structureData.chunkKey}`,
                        keepCount: 1
                    });
                }
            }
        }

        if (Date.now() - entity.requestSentAt > 10000) {
            entity.requestSentAt = null;
            const STATES = this._getStateEnum();
            entity.state = this._getAssessmentState();
        }
    }

    /**
     * Handle clearing left slot and depositing firewood
     */
    _handleClearingSlotForFirewood(entity) {
        if (!entity.requestSentAt) {
            entity.requestSentAt = Date.now();

            if (this.networkManager) {
                const structureData = this.gameState?.getStructureById(entity.buildingId);
                if (structureData) {
                    const firewoodItem = entity.carrying.find(item => item?.type?.endsWith('firewood'));
                    this.networkManager.sendMessage('npc_clear_left_slot_and_deposit', {
                        npcType: this.workerType,
                        structureId: entity.buildingId,
                        chunkId: `chunk_${structureData.chunkKey}`,
                        itemToDeposit: firewoodItem
                    });
                }
            }
        }

        if (Date.now() - entity.requestSentAt > 10000) {
            entity.requestSentAt = null;
            const STATES = this._getStateEnum();
            entity.state = this._getAssessmentState();
        }
    }

    /**
     * Handle response from removing excess firewood
     */
    handleRemoveFirewoodResponse(data) {
        if (!data) return;
        const { success, structureId, removedCount } = data;
        if (!structureId) return;

        const entity = this.entities.get(structureId);
        if (!entity) return;

        const STATES = this._getStateEnum();
        if (entity.state !== STATES.REMOVING_EXCESS_FIREWOOD) return;

        entity.requestSentAt = null;
        entity.state = this._getAssessmentState();
    }

    /**
     * Handle response from clearing slot and depositing firewood
     */
    handleClearDepositResponse(data) {
        if (!data) return;
        const { success, structureId, clearedCount } = data;
        if (!structureId) return;

        const entity = this.entities.get(structureId);
        if (!entity) return;

        const STATES = this._getStateEnum();
        if (entity.state !== STATES.CLEARING_SLOT_FOR_FIREWOOD) return;

        entity.requestSentAt = null;

        if (success) {
            const idx = entity.carrying.findIndex(item => item?.type?.endsWith('firewood'));
            if (idx !== -1) {
                entity.carrying.splice(idx, 1);
            }
        }

        entity.state = this._getAssessmentState();
    }

    // =========================================================================
    // SHARED DEPOSITING HANDLERS
    // =========================================================================

    /**
     * Handle depositing items to home structure
     * Used by workers that deposit to their own structure (Baker, IronWorker, etc.)
     */
    _handleDepositingToStructure(entity) {
        if (!entity.requestSentAt) {
            if (this.networkManager && entity.carrying.length > 0) {
                const structureData = this.gameState?.getStructureById(entity.buildingId);
                if (structureData) {
                    this.networkManager.sendMessage('npc_deposit_inventory', {
                        npcType: this.workerType,
                        structureId: entity.buildingId,
                        chunkId: `chunk_${structureData.chunkKey}`,
                        items: entity.carrying
                    });
                }
                entity.requestSentAt = Date.now();
            } else {
                const STATES = this._getStateEnum();
                entity.state = this._getAssessmentState();
            }
        }

        if (entity.requestSentAt && Date.now() - entity.requestSentAt > 10000) {
            entity.requestSentAt = null;
            entity.carrying.length = 0;
            const STATES = this._getStateEnum();
            entity.state = this._getAssessmentState();
        }
    }

    /**
     * Handle depositing output items to market
     * Used by workers that deliver processed goods to market
     */
    _handleDepositingToMarket(entity) {
        if (!entity.requestSentAt) {
            if (this.networkManager && entity.carrying.length > 0) {
                const marketData = this.gameState?.getStructureById(entity.targetId);
                if (marketData) {
                    this.networkManager.sendMessage('npc_deposit_to_market', {
                        npcType: this.workerType,
                        structureId: entity.buildingId,
                        marketId: entity.targetId,
                        chunkId: `chunk_${marketData.chunkKey}`,
                        items: entity.carrying
                    });
                }
                entity.requestSentAt = Date.now();
            } else {
                const STATES = this._getStateEnum();
                entity.state = STATES.RETURNING;
                entity.targetId = null;
                entity.path = [];
            }
        }

        if (entity.requestSentAt && Date.now() - entity.requestSentAt > 10000) {
            entity.requestSentAt = null;
            entity.carrying.length = 0;
            const STATES = this._getStateEnum();
            entity.state = STATES.RETURNING;
            entity.targetId = null;
            entity.path = [];
        }
    }

    /**
     * Handle deposit response (for depositing to structure)
     */
    handleStructureDepositResponse(data) {
        if (!data) return;
        const { success, structureId } = data;
        if (!structureId) return;

        const entity = this.entities.get(structureId);
        if (!entity) return;

        entity.requestSentAt = null;
        const STATES = this._getStateEnum();

        if (success) {
            entity.carrying = [];
        } else {
            entity.carrying = [];
        }

        entity.state = STATES.RETURNING;
        entity.targetId = null;
        entity.path = [];
    }

    /**
     * Handle collect response for items from market or structure
     * Uses _routeAfterCollect hook for item-type specific routing
     */
    handleCollectResponse(data) {
        if (!data) return;
        const { success, collected, structureId, itemType, marketId } = data;
        if (!structureId) return;

        const entity = this.entities.get(structureId);
        if (!entity) return;

        entity.requestSentAt = null;

        if (success && Array.isArray(collected) && collected.length > 0) {
            for (const item of collected) {
                if (item?.type) {
                    entity.carrying.push(item);
                }
            }
            // Update local cache to prevent stale reads
            const sourceId = marketId || structureId;
            this._updateLocalInventoryCache(sourceId, [], collected);
        }

        // Use hook for item-type routing - subclasses override for custom behavior
        this._routeAfterCollect(entity, itemType);
    }

    /**
     * Route entity to next state after collecting items
     * Override in subclasses for custom item-type routing
     * e.g., Baker routes appletarts to DELIVERING, IronWorker routes ironingots to DELIVERING
     * @param {object} entity - The worker entity
     * @param {string} itemType - Type of item collected
     */
    _routeAfterCollect(entity, itemType) {
        const STATES = this._getStateEnum();

        // Default: firewood and all other items return to structure
        if (itemType === 'firewood' || itemType?.endsWith?.('firewood')) {
            entity.state = STATES.RETURNING;
            entity.targetId = null;
        } else {
            // Default behavior - return to structure
            // Subclasses should override to route output items (appletart, ironingot) to DELIVERING
            entity.state = STATES.RETURNING;
            entity.targetId = null;
        }
    }

    // =========================================================================
    // AUTHORITY OVERRIDE FOR STRUCTURE-BASED WORKERS
    // =========================================================================

    /**
     * Calculate authority using homePosition (building location) instead of current position
     * Used by Baker, IronWorker, TileWorker - workers that stay near their building
     * Override the default _calculateAuthority if your worker should use this behavior
     */
    _calculateAuthorityByHome(buildingId) {
        const entity = this.entities.get(buildingId);
        if (!entity) return this.clientId;

        // Use homePosition (building location) for stable authority
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(entity.homePosition.x, entity.homePosition.z);
        this._nearbyChunkKeys.length = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                this._nearbyChunkKeys.push(`${chunkX + dx},${chunkZ + dz}`);
            }
        }

        const players = this.getPlayersInChunks?.(this._nearbyChunkKeys);
        if (!players || players.length === 0) return this.clientId;

        let lowestId = this.clientId;
        for (const playerId of players) {
            if (this.isPlayerActive && !this.isPlayerActive(playerId)) continue;

            if (lowestId === null || playerId < lowestId) {
                lowestId = playerId;
            }
        }

        return lowestId;
    }

    /**
     * Get ALL entities for sync (not just authority-owned)
     * Used by Baker, IronWorker, TileWorker for full state sync
     */
    getAllWorkersForSync() {
        const result = [];
        for (const [buildingId, entity] of this.entities) {
            result.push({
                buildingId,
                spawnedBy: entity.spawnedBy,
                spawnTime: entity.spawnTime,
                position: { ...entity.position },
                rotation: entity.rotation,
                homePosition: { ...entity.homePosition },
                state: entity.state,
                carrying: [...entity.carrying],
                authorityId: entity.authorityId,
                authorityTerm: entity.authorityTerm || 1,
                moving: entity.visual?.isMoving || false,
                ownerFactionId: entity.ownerFactionId,
                ...this._getSyncExtraFields(entity)
            });
        }
        return result;
    }

    // =========================================================================
    // MARKET & STRUCTURE HELPERS
    // =========================================================================

    _findMarketNearPosition(position, maxDist) {
        const maxDistSq = maxDist * maxDist;
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(position.x, position.z);
        const gameState = this.gameState;

        let nearest = null;
        let nearestDistSq = maxDistSq;

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = `${chunkX + dx},${chunkZ + dz}`;
                const markets = gameState?.getMarketsInChunk(key) || [];

                for (let i = 0, len = markets.length; i < len; i++) {
                    const market = markets[i];
                    const mdx = market.position.x - position.x;
                    const mdz = market.position.z - position.z;
                    const distSq = mdx * mdx + mdz * mdz;

                    if (distSq < nearestDistSq) {
                        nearestDistSq = distSq;
                        nearest = market;
                    }
                }
            }
        }

        return nearest;
    }

    _findMarketById(marketId) {
        return this.gameState?.getStructureById(marketId);
    }

    _calculateApproachPosition(structure, fromPosition, approachDistance = 3.0) {
        const centerX = structure.position?.x ?? structure.x;
        const centerZ = structure.position?.z ?? structure.z;

        const dx = fromPosition.x - centerX;
        const dz = fromPosition.z - centerZ;
        const distSq = dx * dx + dz * dz;

        let dirX, dirZ;
        if (distSq < 0.01) {
            dirX = 1;
            dirZ = 0;
        } else {
            const dist = Math.sqrt(distSq);
            dirX = dx / dist;
            dirZ = dz / dist;
        }

        let targetX = centerX + dirX * approachDistance;
        let targetZ = centerZ + dirZ * approachDistance;

        const isWalkable = this.isWalkable;
        if (isWalkable && !isWalkable(targetX, targetZ)) {
            // OPTIMIZATION: Pre-computed angle increment
            for (let i = 1; i <= 8; i++) {
                const angle = i * 0.785398163; // PI/4
                const testX = centerX + Math.cos(angle) * approachDistance;
                const testZ = centerZ + Math.sin(angle) * approachDistance;
                if (isWalkable(testX, testZ)) {
                    targetX = testX;
                    targetZ = testZ;
                    break;
                }
            }
        }

        return { x: targetX, z: targetZ };
    }

    // =========================================================================
    // BASE DEPOSIT HANDLING
    // =========================================================================

    /**
     * Base market deposit handler - fire-and-forget pattern
     * Sends deposit request, clears inventory immediately, transitions to RETURNING
     * Does not wait for server response to prevent stuck states
     */
    _handleMarketDeposit(entity) {
        const market = this._findMarketById(entity.targetId);
        const items = this._getCarriedItems(entity);

        // If no market or items, just return home
        if (!market || !items || items.length === 0) {
            entity.state = this._getStateEnum().RETURNING;
            entity.targetId = null;
            entity.path = [];
            return;
        }

        // Fire-and-forget: send request, clear inventory, move on immediately
        this._sendMarketDepositRequest(entity, entity.targetId, items);
        this._clearCarriedItems(entity);

        entity.state = this._getStateEnum().RETURNING;
        entity.targetId = null;
        entity.path = [];
        // Note: Don't call _setMoving(true) here - let _handleMovementState
        // start the animation only when a path is available to avoid walking in place
    }

    _sendMarketDepositRequest(entity, marketId, items) {
        const market = this._findMarketById(marketId);
        if (!market || !items || items.length === 0) return;

        const chunkKey = market.chunkKey || ChunkCoordinates.worldToChunkKey(
            market.position.x, market.position.z
        );

        if (this.networkManager) {
            this.networkManager.sendMessage('npc_deposit_to_market', {
                npcType: this.workerType,
                [this._getDepositIdField()]: entity.buildingId,
                marketId: marketId,
                chunkId: `chunk_${chunkKey}`,
                items: items
            });
        }
    }

    /**
     * Override in subclasses if using different field (e.g., chiseledStone)
     */
    _getCarriedItems(entity) {
        return entity.carrying || [];
    }

    /**
     * Override in subclasses if using different ID field name
     */
    _getDepositIdField() {
        return `${this.workerType}Id`;
    }

    /**
     * Override in subclasses if using different field
     */
    _clearCarriedItems(entity) {
        entity.carrying = [];
    }

    // =========================================================================
    // CLEANUP
    // =========================================================================

    onBuildingDestroyed(buildingId) {
        this._removeWorker(buildingId);

        if (this.broadcastP2P) {
            this.broadcastP2P({
                type: `${this.workerType}_despawn`,
                buildingId: buildingId
            });
        }
    }

    onMarketDestroyed(marketPosition) {
        if (!marketPosition) return;

        // OPTIMIZATION: Use cached squared distance (with fallback before init)
        const maxDist = this._cachedConfig?.MARKET_MAX_DISTANCE ?? this._getConfig('MARKET_MAX_DISTANCE');
        const maxDistSq = this._cachedConfig?.MARKET_MAX_DISTANCE_SQ ?? (maxDist * maxDist);
        const toDespawn = [];

        for (const [buildingId, entity] of this.entities) {
            const dx = entity.homePosition.x - marketPosition.x;
            const dz = entity.homePosition.z - marketPosition.z;
            const distSq = dx * dx + dz * dz;

            if (distSq <= maxDistSq) {
                toDespawn.push(buildingId);
            }
        }

        const broadcastP2P = this.broadcastP2P;
        for (let i = 0, len = toDespawn.length; i < len; i++) {
            const buildingId = toDespawn[i];
            this._removeWorker(buildingId);

            if (broadcastP2P) {
                broadcastP2P({
                    type: `${this.workerType}_despawn`,
                    buildingId: buildingId
                });
            }
        }
    }

    /**
     * Called when a chunk is unloaded - clean up workers whose home building was in that chunk
     */
    onChunkUnloaded(chunkKey) {
        const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
        const chunkSize = 50;
        const toRemove = [];

        for (const [buildingId, entity] of this.entities) {
            const { chunkX: homeChunkX, chunkZ: homeChunkZ } = ChunkCoordinates.worldToChunk(entity.homePosition.x, entity.homePosition.z);

            if (homeChunkX === chunkX && homeChunkZ === chunkZ) {
                toRemove.push(buildingId);
            }
        }

        for (const buildingId of toRemove) {
            this._removeWorker(buildingId);
        }
    }

    _removeWorker(buildingId) {
        const entity = this.entities.get(buildingId);
        if (!entity) return;

        this._onWorkerRemoved(entity);

        const mesh = entity.mesh;
        const scene = this.game?.scene;
        if (mesh && scene) {
            scene.remove(mesh);
            mesh.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
            });
        }

        if (this.game?.nameTagManager) {
            this.game.nameTagManager.unregisterEntity(buildingId);
        }

        this.entities.delete(buildingId);
    }

    _onWorkerRemoved(entity) {}

    // =========================================================================
    // ABSTRACT METHODS - Subclass MUST implement
    // =========================================================================

    _getStructuresInChunk(chunkKey) {
        throw new Error(`${this.constructor.name} must implement _getStructuresInChunk()`);
    }

    _getStateEnum() {
        throw new Error(`${this.constructor.name} must implement _getStateEnum()`);
    }

    _createWorkerSpecificState(buildingData) {
        throw new Error(`${this.constructor.name} must implement _createWorkerSpecificState()`);
    }

    _handleIdleState(entity) {
        throw new Error(`${this.constructor.name} must implement _handleIdleState()`);
    }

    _handleWorkerSpecificState(entity, deltaTime) {
        throw new Error(`${this.constructor.name} must implement _handleWorkerSpecificState()`);
    }

    _getMovementTarget(entity) {
        throw new Error(`${this.constructor.name} must implement _getMovementTarget()`);
    }

    _onArrival(entity) {
        throw new Error(`${this.constructor.name} must implement _onArrival()`);
    }

    /**
     * Check for water retreat completion before calling _onArrival
     * If entity has a retreatTarget (was backing away from water),
     * set it as new target and re-path instead of normal arrival handling
     */
    _checkRetreatOrArrival(entity) {
        if (entity._skipNextArrival) {
            entity._skipNextArrival = false;
            entity.lastPathTime = 0;
            return;
        }
        entity._forceReturnHome = false;
        this._onArrival(entity);
    }
}

/**
 * BakerController.js
 * Manages Baker NPCs that work at bakeries
 *
 * Baker behavior loop:
 * 1. Collect apples from nearby apple trees
 * 2. Deposit apples at bakery
 * 3. Collect firewood from market
 * 4. Deposit firewood at bakery
 * 5. Wait for bakery to process apples into tarts
 * 6. Collect tarts from bakery
 * 7. Deliver tarts to market
 * 8. Repeat
 *
 * Authority-based P2P: one client simulates, others interpolate
 */

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from '../config.js';
import { modelManager } from '../objects.js';
import { ChunkCoordinates } from '../core/ChunkCoordinates.js';
import { getAISpawnQueue } from './AISpawnQueue.js';

// Baker configuration defaults (Fix 10: matches Bandit pattern)
const BAKER_CONFIG_DEFAULTS = {
    CHUNK_SIZE: 50,
    MOVE_SPEED: 0.8,           // Units per second (slower than bandit)
    PATHFIND_INTERVAL: 6000,   // Recalculate path every 6 seconds
    IDLE_CHECK_INTERVAL: 1000, // Check for tasks every second
    BROADCAST_INTERVAL: 1000,  // Broadcast state every second
    MARKET_MAX_DISTANCE: 20,   // Max distance to market
    APPLE_SEARCH_RADIUS_SQ: 2500, // 50^2 units
    APPLES_PER_TRIP: 2,
    STUCK_TIMEOUT: 60000,      // Auto-recover after 60 seconds
    NPC_COLOR: 0xCC7722,       // Baker apron color
};

// Helper to get config with fallback to defaults
const getConfig = (key) => {
    return CONFIG.BAKER?.[key] ?? BAKER_CONFIG_DEFAULTS[key];
};

// Baker states
const BAKER_STATE = {
    IDLE: 'idle',
    SEEKING_APPLES: 'seeking_apples',
    COLLECTING_APPLES: 'collecting_apples',
    SEEKING_FIREWOOD: 'seeking_firewood',
    COLLECTING_FIREWOOD: 'collecting_firewood',
    RETURNING: 'returning',
    DEPOSITING: 'depositing',
    WAITING_FOR_TARTS: 'waiting_for_tarts',
    WAITING_FOR_APPLES: 'waiting_for_apples',     // Wait for apple trees to respawn
    WAITING_FOR_FIREWOOD: 'waiting_for_firewood', // Wait for market to have firewood
    COLLECTING_TARTS: 'collecting_tarts',
    DELIVERING: 'delivering',
    DEPOSITING_TARTS: 'depositing_tarts',
    STUCK: 'stuck'
};

// Shared material for all bakers (reduces draw calls)
let sharedBakerApronMaterial = null;

export class BakerController {
    constructor() {
        // Core state
        this.bakers = new Map(); // bakeryId -> bakerEntity
        this.clientId = null;
        this.game = null;
        this.gameState = null;
        this.networkManager = null;

        // Frame counter for throttling
        this._frameCount = 0;
        this._lastBroadcastTime = 0;

        // Callbacks (set via initialize)
        this.getTerrainHeight = null;
        this.isWalkable = null;
        this.findPath = null;
        this.broadcastP2P = null;

        // Performance: checked trees cache to avoid revisiting empty trees
        this._checkedTrees = new Set();

        // Fix 1: Pending states for entities that haven't spawned yet
        this.pendingStates = new Map();

        // Performance: Reusable broadcast message object
        this._broadcastMsg = {
            type: 'baker_state',
            bakeryId: '',
            position: { x: 0, y: 0, z: 0 },
            rotation: 0,
            state: '',
            targetId: null,
            carrying: [],
            moving: false,
            stuckReason: null
        };

        // Initialize shared material
        if (!sharedBakerApronMaterial) {
            sharedBakerApronMaterial = new THREE.MeshStandardMaterial({
                color: CONFIG.BAKER?.NPC_COLOR || 0xCC7722,
                roughness: 0.8,
                metalness: 0.1
            });
        }
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    /**
     * Initialize with game callbacks
     * @param {object} config
     */
    initialize(config) {
        const required = [
            'clientId',
            'game',
            'gameState',
            'networkManager',
            'getTerrainHeight',
            'findPath',
            'broadcastP2P'
        ];

        for (const key of required) {
            if (config[key] === undefined) {
                console.error(`[BakerController] Missing required config: ${key}`);
            }
            this[key] = config[key];
        }

        console.log('[BakerController] Initialized');

        // Fix 6: Register spawn callback with queue system
        const spawnQueue = getAISpawnQueue();
        if (spawnQueue) {
            spawnQueue.registerSpawnCallback('baker', (data) => {
                this._executeSpawn(data);
            });
        }
    }

    // =========================================================================
    // SPAWNING
    // =========================================================================

    /**
     * Fix 6: Execute spawn from queue (called by AISpawnQueue)
     * @param {object} data - Spawn data from queue { bakery }
     */
    _executeSpawn(data) {
        const { bakery } = data;

        // Race condition check - entity may have spawned while in queue
        if (this.bakers.has(bakery.id)) {
            return;
        }

        this._spawnBaker(bakery);
    }

    /**
     * Check if a baker should spawn for a bakery when ship arrives
     * Called from MessageRouter.handleDockShipSpawned
     * @param {object} dockData - { dockId, dockPosition, chunkId }
     */
    checkBakerSpawn(dockData) {
        if (!CONFIG.BAKER?.ENABLED) return;

        const { dockPosition, chunkId } = dockData;
        if (!dockPosition || !chunkId) return;

        // Parse dock position
        const dockX = Array.isArray(dockPosition) ? dockPosition[0] : dockPosition.x;
        const dockZ = Array.isArray(dockPosition) ? dockPosition[2] : dockPosition.z;

        // Find nearby bakeries (within 20 units of dock's market)
        const maxDistSq = CONFIG.BAKER.MARKET_MAX_DISTANCE * CONFIG.BAKER.MARKET_MAX_DISTANCE;

        // First find markets near dock
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(dockX, dockZ);
        const marketsNearDock = [];

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = `${chunkX + dx},${chunkZ + dz}`;
                const markets = this.gameState.getMarketsInChunk(key);
                for (const market of markets) {
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

        // Now find bakeries near those markets
        for (const market of marketsNearDock) {
            const { chunkX: mChunkX, chunkZ: mChunkZ } = ChunkCoordinates.worldToChunk(
                market.position.x, market.position.z
            );

            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const key = `${mChunkX + dx},${mChunkZ + dz}`;
                    const bakeries = this.gameState.getBakeriesInChunk(key);

                    for (const bakery of bakeries) {
                        // Skip if baker already exists for this bakery
                        if (this.bakers.has(bakery.id)) continue;

                        // Check distance from bakery to market
                        const bdx = bakery.position.x - market.position.x;
                        const bdz = bakery.position.z - market.position.z;
                        const distSq = bdx * bdx + bdz * bdz;

                        if (distSq <= maxDistSq) {
                            // Fix 6: Queue spawn instead of immediate spawn
                            const spawnQueue = getAISpawnQueue();
                            if (spawnQueue && !spawnQueue.isQueued('baker', bakery.id)) {
                                spawnQueue.queueSpawn('baker', { bakery }, bakery.id);
                            } else if (!spawnQueue) {
                                // Fallback to direct spawn if queue not available
                                this._spawnBaker(bakery);
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Spawn a baker at a bakery
     * @param {object} bakeryData - { id, position, object }
     */
    _spawnBaker(bakeryData) {
        const bakeryId = bakeryData.id;

        // Calculate spawn position - try 8 angles at 1.5 units until finding walkable spot
        const spawnRadius = 1.5;
        const startAngle = Math.random() * Math.PI * 2;
        let spawnX, spawnZ;

        for (let attempt = 0; attempt < 8; attempt++) {
            const angle = startAngle + (attempt / 8) * Math.PI * 2;
            const testX = bakeryData.position.x + Math.cos(angle) * spawnRadius;
            const testZ = bakeryData.position.z + Math.sin(angle) * spawnRadius;

            // Check if position is walkable (if callback exists)
            if (this.isWalkable) {
                if (this.isWalkable(testX, testZ)) {
                    spawnX = testX;
                    spawnZ = testZ;
                    break;
                }
            } else {
                // No walkability check available - use first position
                spawnX = testX;
                spawnZ = testZ;
                break;
            }
        }

        // Fallback if no walkable position found
        if (spawnX === undefined) {
            spawnX = bakeryData.position.x + Math.cos(startAngle) * spawnRadius;
            spawnZ = bakeryData.position.z + Math.sin(startAngle) * spawnRadius;
        }

        const spawnY = this.getTerrainHeight ? this.getTerrainHeight(spawnX, spawnZ) : 0;
        const homeY = this.getTerrainHeight ? this.getTerrainHeight(bakeryData.position.x, bakeryData.position.z) : 0;

        // Create entity
        const entity = {
            bakeryId: bakeryId,
            position: { x: spawnX, y: spawnY, z: spawnZ },
            targetPosition: { x: spawnX, y: spawnY, z: spawnZ },
            rotation: 0,
            targetRotation: 0,
            homePosition: { x: bakeryData.position.x, y: homeY, z: bakeryData.position.z },
            state: BAKER_STATE.IDLE,
            targetId: null,
            carrying: [], // Max 4 items
            path: [],
            pathIndex: 0,
            lastPathTime: 0,
            pathFailures: 0,
            stuckReason: null,
            stuckTime: 0,
            previousTask: null,
            requestSentAt: null,
            spawnedBy: this.clientId,
            spawnTime: Date.now(),
            authorityId: this.clientId,
            mesh: null,
            visual: null,
            controller: null, // Fix 7: Consistent with Bandit pattern
            _lastDecisionTime: 0
        };

        this.bakers.set(bakeryId, entity);

        // Fix 2: Create visual - validate success
        const visualCreated = this._createBakerVisual(entity);
        if (!visualCreated) {
            console.warn(`[BakerController] Failed to create visual for baker at ${bakeryId}, aborting spawn`);
            this.bakers.delete(bakeryId);
            return;
        }

        // Fix 7: Set controller reference for animation control (consistent with Bandit)
        entity.controller = entity.visual;

        // Broadcast spawn to peers
        if (this.broadcastP2P) {
            this.broadcastP2P({
                type: 'baker_spawn',
                bakeryId: bakeryId,
                spawnedBy: this.clientId,
                spawnTime: entity.spawnTime,
                position: entity.position,
                homePosition: entity.homePosition
            });
        }

        console.log(`[BakerController] Spawned baker at bakery ${bakeryId}`);
    }

    /**
     * Create visual for a baker entity
     * @param {object} entity
     */
    _createBakerVisual(entity) {
        const manGLTF = modelManager.getGLTF('man');
        if (!manGLTF) {
            console.error('[BakerController] Man model not loaded');
            return false;
        }

        // Clone model
        const mesh = SkeletonUtils.clone(manGLTF.scene);
        mesh.scale.set(1, 1, 1);

        // Setup visibility and apply apron color
        // Also find hand bone to hide any rifle attachments
        let handBone = null;
        mesh.traverse((child) => {
            // Find hand bone (Bone014) to hide rifle
            if (child.isBone && child.name === 'Bone014') {
                handBone = child;
            }

            if (child.isMesh || child.isSkinnedMesh) {
                child.visible = true;
                child.frustumCulled = true;

                // Cube001_3 is the shirt - apply shared apron material
                if (child.name === 'Cube001_3' && child.material) {
                    child.material = sharedBakerApronMaterial;
                }
            }
        });

        // Hide any rifle attached to hand bone (baker shouldn't have a weapon)
        if (handBone) {
            handBone.children.forEach(child => {
                if (child.isMesh || child.isGroup) {
                    child.visible = false;
                }
            });
        }

        // Position at spawn location
        mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
        mesh.rotation.y = entity.rotation;

        // Create animation mixer
        const mixer = new THREE.AnimationMixer(mesh);
        const walkAnim = manGLTF.animations.find(a => a.name.toLowerCase().includes('walk'));
        const idleAnim = manGLTF.animations.find(a => a.name.toLowerCase().includes('idle'));

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

        // Start with idle animation
        if (idleAction) {
            idleAction.play();
        } else if (walkAction) {
            // Fallback: freeze walk animation at frame 1
            walkAction.play();
            mixer.update(0.001);
            walkAction.stop();
        }

        // Add to scene
        if (this.game?.scene) {
            this.game.scene.add(mesh);
        }

        // Register name tag
        if (this.game?.nameTagManager) {
            this.game.nameTagManager.registerEntity(entity.bakeryId, 'Baker', mesh);
        }

        return true;
    }

    // =========================================================================
    // UPDATE LOOP
    // =========================================================================

    /**
     * Main update loop - called every frame
     * @param {number} deltaTime
     */
    update(deltaTime) {
        if (!CONFIG.BAKER?.ENABLED) return;

        this._frameCount++;
        const now = Date.now();

        // Fix 8: Get local player position for distance culling
        let myPos = null;
        if (this.game?.playerObject?.position) {
            myPos = this.game.playerObject.position;
        }

        const NEAR_DISTANCE_SQ = 50 * 50;
        const FAR_UPDATE_INTERVAL = 4; // Update distant bakers every 4th frame

        // Update all bakers
        for (const [bakeryId, entity] of this.bakers) {
            // Fix 8: Distance culling for performance
            if (myPos) {
                const dx = entity.position.x - myPos.x;
                const dz = entity.position.z - myPos.z;
                const distSq = dx * dx + dz * dz;

                // Skip distant bakers most frames
                if (distSq > NEAR_DISTANCE_SQ) {
                    if (this._frameCount % FAR_UPDATE_INTERVAL !== 0) {
                        // Still update animation mixer for smooth visuals
                        if (entity.visual?.mixer) {
                            // Problem 5 Fix: Divide by 1000 - mixer expects seconds, deltaTime is in ms
                            entity.visual.mixer.update(deltaTime / 1000);
                        }
                        continue;
                    }
                }
            }

            this._updateEntity(entity, deltaTime);
        }

        // Broadcast authority state periodically
        if (now - this._lastBroadcastTime >= getConfig('BROADCAST_INTERVAL')) {
            this._lastBroadcastTime = now;
            this.broadcastAuthorityState();
        }
    }

    /**
     * Update a single baker entity
     * @param {object} entity
     * @param {number} deltaTime
     */
    _updateEntity(entity, deltaTime) {
        // Update animation
        if (entity.visual?.mixer) {
            // Problem 5 Fix: Divide by 1000 - mixer expects seconds, deltaTime is in ms
            entity.visual.mixer.update(deltaTime / 1000);
        }

        // Non-authority clients just interpolate
        if (entity.authorityId !== this.clientId) {
            this._interpolateEntity(entity, deltaTime);
            return;
        }

        // Authority client simulates behavior
        switch (entity.state) {
            case BAKER_STATE.IDLE:
                this._handleIdleState(entity);
                break;
            case BAKER_STATE.SEEKING_APPLES:
            case BAKER_STATE.SEEKING_FIREWOOD:
            case BAKER_STATE.RETURNING:
            case BAKER_STATE.DELIVERING:
                this._handleMovementState(entity, deltaTime);
                break;
            case BAKER_STATE.COLLECTING_APPLES:
                this._handleCollectingApples(entity);
                break;
            case BAKER_STATE.COLLECTING_FIREWOOD:
                this._handleCollectingFirewood(entity);
                break;
            case BAKER_STATE.DEPOSITING:
                this._handleDepositing(entity);
                break;
            case BAKER_STATE.WAITING_FOR_TARTS:
                this._handleWaitingForTarts(entity);
                break;
            case BAKER_STATE.WAITING_FOR_APPLES:
                this._handleWaitingForApples(entity);
                break;
            case BAKER_STATE.WAITING_FOR_FIREWOOD:
                this._handleWaitingForFirewood(entity);
                break;
            case BAKER_STATE.COLLECTING_TARTS:
                this._handleCollectingTarts(entity);
                break;
            case BAKER_STATE.DEPOSITING_TARTS:
                this._handleDepositingTarts(entity);
                break;
            case BAKER_STATE.STUCK:
                this._handleStuckState(entity);
                break;
        }
    }

    // =========================================================================
    // STATE HANDLERS
    // =========================================================================

    /**
     * Handle idle state - decide next task
     */
    _handleIdleState(entity) {
        const now = Date.now();

        // Throttle decision checks (every 1 second)
        if (now - entity._lastDecisionTime < getConfig('IDLE_CHECK_INTERVAL')) {
            return;
        }
        entity._lastDecisionTime = now;

        const task = this._decideNextTask(entity);

        switch (task.task) {
            case 'deliver_tarts':
                entity.state = BAKER_STATE.COLLECTING_TARTS;
                entity.targetId = task.target;
                break;
            case 'get_firewood':
                entity.state = BAKER_STATE.SEEKING_FIREWOOD;
                entity.targetId = task.target;
                entity.path = [];
                break;
            case 'get_apples':
                entity.state = BAKER_STATE.SEEKING_APPLES;
                entity.targetId = task.target?.id || null;
                entity.path = [];
                break;
            case 'wait_for_tarts':
            case 'wait_for_apples':
            case 'wait_for_firewood':
                // All waiting tasks require being at the bakery first
                const homeDx = entity.position.x - entity.homePosition.x;
                const homeDz = entity.position.z - entity.homePosition.z;
                const homeDistSq = homeDx * homeDx + homeDz * homeDz;
                const HOME_RADIUS_SQ = 3 * 3; // Must be within 3 units of bakery

                if (homeDistSq > HOME_RADIUS_SQ) {
                    // Too far from bakery - go home first
                    entity.state = BAKER_STATE.RETURNING;
                    entity.targetId = null;
                    entity.path = [];
                    entity.carrying.length = 0; // Clear carrying so DEPOSITING skips to IDLE
                } else {
                    // At bakery - enter appropriate waiting state
                    if (task.task === 'wait_for_tarts') {
                        entity.state = BAKER_STATE.WAITING_FOR_TARTS;
                    } else if (task.task === 'wait_for_apples') {
                        entity.state = BAKER_STATE.WAITING_FOR_APPLES;
                    } else {
                        entity.state = BAKER_STATE.WAITING_FOR_FIREWOOD;
                    }
                }
                break;
            case 'stuck':
                this._enterStuckState(entity, task.reason);
                break;
        }
    }

    /**
     * Decide next task based on bakery/market state
     * This is called ONCE when entering IDLE - task runs to completion before re-evaluating
     *
     * Priority order:
     * 1. Firewood check - bakery needs exactly 1 firewood
     * 2. Tarts check - deliver if bakery has any
     * 3. Apples check - get if bakery needs them (and has firewood)
     * 4. Wait - firewood + apples present, wait for tarts to be made
     */
    _decideNextTask(entity) {
        const bakeryData = this.gameState.getStructureById(entity.bakeryId);
        if (!bakeryData) {
            return { task: 'stuck', reason: 'Lost connection to bakery.' };
        }

        const bakeryInv = bakeryData.object?.userData?.inventory;
        const market = this._findMarketNearPosition(entity.homePosition, getConfig('MARKET_MAX_DISTANCE'));

        // Priority 1: FIREWOOD - bakery should have exactly 1
        const firewoodCount = this._countFirewood(bakeryInv);
        if (firewoodCount === 0) {
            // No firewood - must get some
            if (!market) return { task: 'stuck', reason: 'I cannot find a market nearby.' };

            const marketData = this.gameState.getStructureById(market.id);
            const marketInv = marketData?.object?.userData?.inventory;
            if (!this._marketHasFirewood(marketInv)) {
                // Market has no firewood - wait and retry periodically
                return { task: 'wait_for_firewood' };
            }
            return { task: 'get_firewood', target: market.id };
        } else if (firewoodCount > 1) {
            // Too much firewood - discard extras (TODO: implement discard mechanism)
            // For now, continue - the extra will be consumed
        }

        // Priority 2: TARTS - deliver if bakery has any ready
        const tartCount = this._countItemsOfType(bakeryInv, 'appletart');
        if (tartCount > 0) {
            if (!market) return { task: 'stuck', reason: 'I cannot find a market nearby.' };
            return { task: 'deliver_tarts', target: market.id };
        }

        // Priority 3: APPLES - get if bakery needs them (firewood is already present)
        const appleCount = this._countItemsOfType(bakeryInv, 'apple');
        if (appleCount < getConfig('APPLES_PER_TRIP')) {
            this._checkedTrees.clear();
            const tree = this._findNearestAppleTree(entity.homePosition);
            if (tree) {
                return { task: 'get_apples', target: tree };
            }
            // No trees found - wait and try later (trees respawn)
            return { task: 'wait_for_apples' };
        }

        // Priority 4: WAIT - firewood + apples present, bakery is making tarts
        return { task: 'wait_for_tarts' };
    }

    /**
     * Count firewood items in bakery inventory
     */
    _countFirewood(inventory) {
        if (!inventory?.items) return 0;
        let count = 0;
        for (let i = 0; i < inventory.items.length; i++) {
            const item = inventory.items[i];
            if (item?.type?.endsWith('firewood') && item.durability > 0) {
                count++;
            }
        }
        return count;
    }

    /**
     * Handle movement states (seeking, returning, delivering)
     */
    _handleMovementState(entity, deltaTime) {
        // Bug 1 Fix: Get path if needed - RETURNING state has null targetId but still needs path
        if (entity.path.length === 0 && (entity.targetId || entity.state === BAKER_STATE.RETURNING)) {
            const now = Date.now();
            if (now - entity.lastPathTime < getConfig('PATHFIND_INTERVAL')) {
                return;
            }
            entity.lastPathTime = now;

            const target = this._getTargetPosition(entity);
            if (!target) {
                this._handlePathFailure(entity);
                return;
            }

            if (this.findPath) {
                const path = this.findPath(entity.position, target);
                if (path && path.length > 0) {
                    entity.path = path;
                    entity.pathIndex = 0;
                    this._resetPathFailures(entity);
                } else {
                    this._handlePathFailure(entity);
                    return;
                }
            }
        }

        // Follow path
        if (entity.path.length > 0 && entity.pathIndex < entity.path.length) {
            const target = entity.path[entity.pathIndex];
            const dx = target.x - entity.position.x;
            const dz = target.z - entity.position.z;
            const distSq = dx * dx + dz * dz;

            // Bug 3 Fix: Use 0.25 threshold (0.5 units) like Bandit
            if (distSq < 0.25) {
                // Reached waypoint
                entity.pathIndex++;
                if (entity.pathIndex >= entity.path.length) {
                    // Reached destination
                    this._onReachedDestination(entity);
                }
            } else {
                // Move toward waypoint
                const dist = Math.sqrt(distSq);
                // Bug 2 Fix: Divide deltaTime by 1000 (deltaTime is in ms, need seconds)
                const speed = getConfig('MOVE_SPEED') * (deltaTime / 1000);
                const moveX = (dx / dist) * Math.min(speed, dist);
                const moveZ = (dz / dist) * Math.min(speed, dist);

                // Bug 7 Fix: Validate walkability before movement
                const newX = entity.position.x + moveX;
                const newZ = entity.position.z + moveZ;

                if (this.isWalkable && !this.isWalkable(newX, newZ)) {
                    // Blocked - trigger path recalculation
                    entity.path = [];
                    entity.lastPathTime = 0;
                    this._setMoving(entity, false);
                    return;
                }

                entity.position.x = newX;
                entity.position.z = newZ;

                // Update Y to terrain height
                if (this.getTerrainHeight) {
                    entity.position.y = this.getTerrainHeight(entity.position.x, entity.position.z);
                }

                // Update rotation
                entity.rotation = Math.atan2(dx, dz);

                // Update mesh
                if (entity.mesh) {
                    entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
                    entity.mesh.rotation.y = entity.rotation;
                }

                // Play walk animation
                this._setMoving(entity, true);
            }
        } else {
            this._setMoving(entity, false);
            // Bug 4 Fix: Allow path retry when empty
            if (entity.lastPathTime > 0) {
                const timeSinceLastPath = Date.now() - entity.lastPathTime;
                if (timeSinceLastPath > getConfig('PATHFIND_INTERVAL')) {
                    entity.lastPathTime = 0; // Reset to trigger retry
                }
            }
        }
    }

    /**
     * Handle reaching destination based on current state
     */
    _onReachedDestination(entity) {
        entity.path = [];
        entity.pathIndex = 0;
        this._setMoving(entity, false);

        switch (entity.state) {
            case BAKER_STATE.SEEKING_APPLES:
                entity.state = BAKER_STATE.COLLECTING_APPLES;
                entity.requestSentAt = null;
                break;
            case BAKER_STATE.SEEKING_FIREWOOD:
                entity.state = BAKER_STATE.COLLECTING_FIREWOOD;
                entity.requestSentAt = null;
                break;
            case BAKER_STATE.RETURNING:
                entity.state = BAKER_STATE.DEPOSITING;
                entity.requestSentAt = null;
                break;
            case BAKER_STATE.DELIVERING:
                entity.state = BAKER_STATE.DEPOSITING_TARTS;
                entity.requestSentAt = null;
                break;
        }
    }

    /**
     * Handle collecting apples state
     */
    _handleCollectingApples(entity) {
        // Send collection request if not already sent
        if (!entity.requestSentAt) {
            entity.requestSentAt = Date.now();

            if (this.networkManager) {
                const treeData = this._getAppleTreeData(entity.targetId);
                if (treeData) {
                    this.networkManager.sendMessage('npc_collect_apples', {
                        npcType: 'baker',
                        bakeryId: entity.bakeryId,
                        treeId: entity.targetId,
                        chunkId: treeData.chunkId,
                        maxCount: getConfig('APPLES_PER_TRIP')
                    });
                }
            }
        }

        // Timeout after 10 seconds - assume collection failed, continue task
        if (Date.now() - entity.requestSentAt > 10000) {
            entity.requestSentAt = null;
            // Mark this tree as checked (empty/failed)
            if (entity.targetId) {
                this._checkedTrees.add(entity.targetId);
            }
            // Try to find another tree, or return home with what we have
            const nextTree = this._findNearestAppleTree(entity.position);
            if (nextTree) {
                entity.state = BAKER_STATE.SEEKING_APPLES;
                entity.targetId = nextTree.id;
                entity.path = [];
            } else {
                // No more trees - return home (IDLE will handle wait_for_apples)
                entity.state = BAKER_STATE.RETURNING;
                entity.targetId = null;
                this._checkedTrees.clear();
            }
        }
    }

    /**
     * Handle collecting firewood state
     */
    _handleCollectingFirewood(entity) {
        if (!entity.requestSentAt) {
            entity.requestSentAt = Date.now();

            if (this.networkManager) {
                const marketData = this.gameState.getStructureById(entity.targetId);
                if (marketData) {
                    this.networkManager.sendMessage('npc_collect_from_market', {
                        npcType: 'baker',
                        bakeryId: entity.bakeryId,
                        marketId: entity.targetId,
                        chunkId: `chunk_${marketData.chunkKey}`,
                        itemType: 'firewood',
                        count: 1
                    });
                }
            }
        }

        // Timeout after 10 seconds - return home (IDLE will retry firewood if needed)
        if (Date.now() - entity.requestSentAt > 10000) {
            entity.requestSentAt = null;
            entity.state = BAKER_STATE.RETURNING;
            entity.targetId = null;
        }
    }

    /**
     * Handle depositing state
     * Note: Already at bakery, so IDLE is safe here
     */
    _handleDepositing(entity) {
        if (!entity.requestSentAt) {
            entity.requestSentAt = Date.now();

            if (this.networkManager && entity.carrying.length > 0) {
                const bakeryData = this.gameState.getStructureById(entity.bakeryId);
                if (bakeryData) {
                    this.networkManager.sendMessage('npc_deposit_inventory', {
                        npcType: 'baker',
                        bakeryId: entity.bakeryId,
                        structureId: entity.bakeryId,
                        chunkId: `chunk_${bakeryData.chunkKey}`,
                        items: entity.carrying
                    });
                }
            } else {
                // Nothing to deposit - go to IDLE (we're at bakery, this is safe)
                entity.state = BAKER_STATE.IDLE;
            }
        }

        // Timeout after 10 seconds - assume deposit succeeded, clear carrying and continue
        if (Date.now() - entity.requestSentAt > 10000) {
            entity.requestSentAt = null;
            entity.carrying.length = 0; // Clear to avoid duplicate deposits
            entity.state = BAKER_STATE.IDLE; // Already at bakery, safe to re-evaluate
        }
    }

    /**
     * Handle waiting for tarts state
     * Baker waits at bakery for tarts to be produced
     * Sends message to server to check/complete processing (tarts won't complete without this)
     */
    _handleWaitingForTarts(entity) {
        const now = Date.now();
        if (now - entity._lastDecisionTime < 5000) return;
        entity._lastDecisionTime = now;

        // Send message to server to check and complete any finished processing
        // This is needed because tarts only complete when checked (normally by player opening bakery)
        if (this.networkManager) {
            const bakeryData = this.gameState.getStructureById(entity.bakeryId);
            if (bakeryData) {
                this.networkManager.sendMessage('npc_check_bakery_processing', {
                    bakeryId: entity.bakeryId,
                    chunkId: `chunk_${bakeryData.chunkKey}`
                });
            }
        }

        // Check local inventory for tarts (server will broadcast update if any completed)
        const bakeryData = this.gameState.getStructureById(entity.bakeryId);
        const bakeryInv = bakeryData?.object?.userData?.inventory;
        const tartCount = this._countItemsOfType(bakeryInv, 'appletart');

        if (tartCount > 0) {
            entity.state = BAKER_STATE.IDLE; // Will trigger deliver_tarts task
        }
    }

    /**
     * Handle waiting for apples state
     * Baker waits at bakery for apple trees to respawn (checked every 30 seconds)
     */
    _handleWaitingForApples(entity) {
        const now = Date.now();
        // Check less frequently - trees take time to respawn
        if (now - entity._lastDecisionTime < 30000) return;
        entity._lastDecisionTime = now;

        // Clear checked trees cache so we re-check all trees
        this._checkedTrees.clear();

        // Look for available apple trees
        const tree = this._findNearestAppleTree(entity.homePosition);
        if (tree) {
            // Found a tree - go get apples
            entity.state = BAKER_STATE.IDLE; // Will trigger get_apples task
        }
        // Otherwise keep waiting
    }

    /**
     * Handle waiting for firewood state
     * Baker waits at bakery for market to have firewood (checked every 30 seconds)
     */
    _handleWaitingForFirewood(entity) {
        const now = Date.now();
        // Check every 30 seconds
        if (now - entity._lastDecisionTime < 30000) return;
        entity._lastDecisionTime = now;

        // Check if market now has firewood
        const market = this._findMarketNearPosition(entity.homePosition, getConfig('MARKET_MAX_DISTANCE'));
        if (market) {
            const marketData = this.gameState.getStructureById(market.id);
            const marketInv = marketData?.object?.userData?.inventory;
            if (this._marketHasFirewood(marketInv)) {
                // Market has firewood - go get it
                entity.state = BAKER_STATE.IDLE; // Will trigger get_firewood task
            }
        }
        // Otherwise keep waiting
    }

    /**
     * Handle collecting tarts state
     * Note: Baker should be at bakery for this
     */
    _handleCollectingTarts(entity) {
        if (!entity.requestSentAt) {
            entity.requestSentAt = Date.now();

            if (this.networkManager) {
                const bakeryData = this.gameState.getStructureById(entity.bakeryId);
                if (bakeryData) {
                    this.networkManager.sendMessage('npc_collect_from_structure', {
                        npcType: 'baker',
                        bakeryId: entity.bakeryId,
                        structureId: entity.bakeryId,
                        chunkId: `chunk_${bakeryData.chunkKey}`,
                        itemType: 'appletart',
                        count: 10
                    });
                }
            }
        }

        // Timeout after 10 seconds - at bakery, safe to go to IDLE and retry
        if (Date.now() - entity.requestSentAt > 10000) {
            entity.requestSentAt = null;
            entity.state = BAKER_STATE.IDLE; // At bakery, will retry deliver_tarts
        }
    }

    /**
     * Handle depositing tarts state
     * Note: Baker is at market - must return to bakery after
     */
    _handleDepositingTarts(entity) {
        if (!entity.requestSentAt) {
            entity.requestSentAt = Date.now();

            if (this.networkManager && entity.carrying.length > 0) {
                const marketData = this.gameState.getStructureById(entity.targetId);
                if (marketData) {
                    this.networkManager.sendMessage('npc_deposit_to_market', {
                        npcType: 'baker',
                        bakeryId: entity.bakeryId,
                        marketId: entity.targetId,
                        chunkId: `chunk_${marketData.chunkKey}`,
                        items: entity.carrying
                    });
                }
            } else {
                // No tarts to deposit - return to bakery
                entity.state = BAKER_STATE.RETURNING;
                entity.targetId = null;
                entity.path = [];
            }
        }

        // Timeout after 10 seconds - assume deposit succeeded, return to bakery
        if (Date.now() - entity.requestSentAt > 10000) {
            entity.requestSentAt = null;
            entity.carrying.length = 0; // Clear to avoid duplicate deposits
            // Return to bakery instead of staying at market
            entity.state = BAKER_STATE.RETURNING;
            entity.targetId = null;
            entity.path = [];
        }
    }

    /**
     * Handle stuck state
     */
    _handleStuckState(entity) {
        const now = Date.now();
        const timeout = getConfig('STUCK_TIMEOUT');

        if (now - entity.stuckTime >= timeout) {
            // Auto-recover - but remember failed target to avoid it
            const failedTargetId = entity.previousTask?.target;

            entity.state = BAKER_STATE.IDLE;
            entity.stuckReason = null;
            entity.stuckTime = 0;
            entity.targetId = null;
            entity.path = [];
            entity.pathIndex = 0;
            entity.pathFailures = 0;

            // Track failed target to avoid retrying it immediately
            if (failedTargetId) {
                entity._failedTargets = entity._failedTargets || new Set();
                entity._failedTargets.add(failedTargetId);
                // Clear failed targets after 5 minutes
                setTimeout(() => {
                    entity._failedTargets?.delete(failedTargetId);
                }, 300000);
            }

            entity.previousTask = null;
        }
    }

    // =========================================================================
    // HELPER METHODS
    // =========================================================================

    /**
     * Enter stuck state with reason
     */
    _enterStuckState(entity, reason, previousTask = null) {
        const wasAlreadyStuck = entity.state === BAKER_STATE.STUCK;

        entity.state = BAKER_STATE.STUCK;
        entity.stuckReason = reason;
        entity.stuckTime = Date.now();
        entity.path = [];
        entity.pathIndex = 0;

        if (!wasAlreadyStuck && previousTask) {
            entity.previousTask = previousTask;
        }

        this._setMoving(entity, false);
    }

    /**
     * Enhanced repositioning - try multiple strategies to find a walkable position
     * Returns true if successfully repositioned
     */
    _tryReposition(entity, strategy) {
        // Strategy 1: Nudge at multiple distances and angles
        if (strategy === 'nudge' || strategy === 'all') {
            const distances = [1.5, 3.0, 5.0, 7.0];
            const numAngles = 12;

            for (const dist of distances) {
                for (let i = 0; i < numAngles; i++) {
                    const angle = (i / numAngles) * Math.PI * 2;
                    const testX = entity.position.x + Math.cos(angle) * dist;
                    const testZ = entity.position.z + Math.sin(angle) * dist;

                    if (this.isWalkable && this.isWalkable(testX, testZ)) {
                        this._moveEntityTo(entity, testX, testZ);
                        return true;
                    }
                }
            }
        }

        // Strategy 2: Move toward home (bakery) - often a clear path
        if (strategy === 'toward_home' || strategy === 'all') {
            const dx = entity.homePosition.x - entity.position.x;
            const dz = entity.homePosition.z - entity.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist > 2) {
                const steps = [2, 4, 6, 8];
                for (const stepDist of steps) {
                    const testX = entity.position.x + (dx / dist) * stepDist;
                    const testZ = entity.position.z + (dz / dist) * stepDist;

                    if (this.isWalkable && this.isWalkable(testX, testZ)) {
                        this._moveEntityTo(entity, testX, testZ);
                        return true;
                    }
                }
            }
        }

        // Strategy 3: Move toward target - might clear an obstacle
        if (strategy === 'toward_target' || strategy === 'all') {
            const target = this._getTargetPosition(entity);
            if (target) {
                const dx = target.x - entity.position.x;
                const dz = target.z - entity.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);

                if (dist > 2) {
                    const steps = [1, 2, 3];
                    for (const stepDist of steps) {
                        const testX = entity.position.x + (dx / dist) * stepDist;
                        const testZ = entity.position.z + (dz / dist) * stepDist;

                        if (this.isWalkable && this.isWalkable(testX, testZ)) {
                            this._moveEntityTo(entity, testX, testZ);
                            return true;
                        }
                    }
                }
            }
        }

        // Strategy 4: Random jitter - sometimes breaks out of edge cases
        if (strategy === 'jitter' || strategy === 'all') {
            for (let attempt = 0; attempt < 8; attempt++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = 1 + Math.random() * 4;
                const testX = entity.position.x + Math.cos(angle) * dist;
                const testZ = entity.position.z + Math.sin(angle) * dist;

                if (this.isWalkable && this.isWalkable(testX, testZ)) {
                    this._moveEntityTo(entity, testX, testZ);
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Move entity to a new position and update mesh
     */
    _moveEntityTo(entity, x, z) {
        entity.position.x = x;
        entity.position.z = z;
        if (this.getTerrainHeight) {
            entity.position.y = this.getTerrainHeight(x, z);
        }
        if (entity.mesh) {
            entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
        }
        entity.lastPathTime = 0; // Retry path immediately
    }

    /**
     * Try a different approach angle to the target
     * Returns new target position or null
     */
    _tryAlternateApproach(entity) {
        const target = this._getTargetPosition(entity);
        if (!target) return null;

        // Get the structure we're approaching
        let structurePos = null;
        if (entity.state === BAKER_STATE.SEEKING_APPLES) {
            const tree = this._getAppleTreeData(entity.targetId);
            if (tree) structurePos = tree.position;
        } else if (entity.state === BAKER_STATE.SEEKING_FIREWOOD || entity.state === BAKER_STATE.DELIVERING) {
            const market = this.gameState.getStructureById(entity.targetId);
            if (market) structurePos = market.position;
        } else if (entity.state === BAKER_STATE.RETURNING) {
            const bakery = this.gameState.getStructureById(entity.bakeryId);
            if (bakery) structurePos = bakery.position;
        }

        if (!structurePos) return null;

        // Track which approach angles we've tried
        entity._approachAttempts = (entity._approachAttempts || 0) + 1;

        // Try 8 different approach angles
        const approachAngle = (entity._approachAttempts / 8) * Math.PI * 2;
        const approachDist = 1.0; // Close approach

        const newTarget = {
            x: structurePos.x + Math.cos(approachAngle) * approachDist,
            z: structurePos.z + Math.sin(approachAngle) * approachDist
        };

        // Check if this approach point is walkable
        if (this.isWalkable && this.isWalkable(newTarget.x, newTarget.z)) {
            return newTarget;
        }

        return null;
    }

    /**
     * Handle path failure - comprehensive recovery system
     * Strategies tried in order:
     * 1. Retry with same target (might be transient)
     * 2. Reposition (nudge/move to walkable spot)
     * 3. Try different approach angle to target
     * 4. Move toward home, then retry
     * 5. Go home and wait briefly, then retry task
     */
    _handlePathFailure(entity) {
        entity.pathFailures = (entity.pathFailures || 0) + 1;
        const failures = entity.pathFailures;

        console.log(`[BakerController] Path failure #${failures} for ${entity.bakeryId}`);

        // Attempt 1-2: Simple retry (might be transient issue)
        if (failures <= 2) {
            entity.lastPathTime = Date.now() - getConfig('PATHFIND_INTERVAL') + 3000; // 3 sec retry
            return;
        }

        // Attempt 3-4: Try repositioning with nudge
        if (failures <= 4) {
            if (this._tryReposition(entity, 'nudge')) {
                console.log(`[BakerController] Repositioned via nudge`);
                return;
            }
            entity.lastPathTime = Date.now() - getConfig('PATHFIND_INTERVAL') + 3000;
            return;
        }

        // Attempt 5-6: Try different approach angle to target
        if (failures <= 6) {
            const altTarget = this._tryAlternateApproach(entity);
            if (altTarget) {
                // Override the approach position temporarily
                entity._overrideTarget = altTarget;
                console.log(`[BakerController] Trying alternate approach angle`);
            }
            entity.lastPathTime = Date.now() - getConfig('PATHFIND_INTERVAL') + 3000;
            return;
        }

        // Attempt 7-8: Move toward home and retry
        if (failures <= 8) {
            if (this._tryReposition(entity, 'toward_home')) {
                console.log(`[BakerController] Moved toward home`);
                return;
            }
            // Try random jitter as fallback
            if (this._tryReposition(entity, 'jitter')) {
                console.log(`[BakerController] Repositioned via jitter`);
                return;
            }
            entity.lastPathTime = Date.now() - getConfig('PATHFIND_INTERVAL') + 3000;
            return;
        }

        // Attempt 9+: Go home and wait 6 seconds, then retry the task
        console.log(`[BakerController] Too many failures, returning home to retry`);
        entity.pathFailures = 0;
        entity._approachAttempts = 0;
        entity._overrideTarget = null;

        // Remember what we were trying to do
        entity._retryTask = {
            state: entity.state,
            targetId: entity.targetId
        };

        // Go home - RETURNING with empty carrying goes to IDLE
        entity.state = BAKER_STATE.RETURNING;
        entity.targetId = null;
        entity.path = [];
        entity.carrying.length = 0;

        // Set a short wait time before retrying (6 seconds handled by IDLE check interval)
    }

    /**
     * Reset path failure counter
     */
    _resetPathFailures(entity) {
        entity.pathFailures = 0;
        entity._approachAttempts = 0;
        entity._overrideTarget = null;
    }

    /**
     * Set moving state and animation
     */
    _setMoving(entity, isMoving) {
        if (!entity.visual) return;

        if (isMoving !== entity.visual.isMoving) {
            entity.visual.isMoving = isMoving;
            if (isMoving) {
                // Stop idle, play walk
                entity.visual.idleAction?.stop();
                entity.visual.walkAction?.play();
            } else {
                // Stop walk, play idle
                entity.visual.walkAction?.stop();
                if (entity.visual.idleAction) {
                    entity.visual.idleAction.play();
                } else if (entity.visual.walkAction) {
                    // Fallback: freeze walk animation at frame 1
                    entity.visual.walkAction.play();
                    entity.visual.mixer?.update(0.001);
                    entity.visual.walkAction.stop();
                }
            }
        }
    }

    /**
     * Problem 1 Fix: Calculate approach offset for a structure
     * Returns position on perimeter instead of center
     * @param {object} structure - Structure data with position and object
     * @param {object} fromPosition - Position to approach from (entity position)
     * @param {number} approachDistance - How far from center to approach
     * @returns {{x: number, z: number}} Approach position
     */
    _calculateApproachPosition(structure, fromPosition, approachDistance = 3.0) {
        const centerX = structure.position.x;
        const centerZ = structure.position.z;

        // Get direction from structure to entity
        const dx = fromPosition.x - centerX;
        const dz = fromPosition.z - centerZ;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < 0.1) {
            // Entity is at center, pick a default direction
            return { x: centerX + approachDistance, z: centerZ };
        }

        // Normalize direction and apply approach distance
        const dirX = dx / dist;
        const dirZ = dz / dist;

        return {
            x: centerX + dirX * approachDistance,
            z: centerZ + dirZ * approachDistance
        };
    }

    /**
     * Get target position for current state
     */
    _getTargetPosition(entity) {
        // Check for override target (set by pathfinding recovery)
        if (entity._overrideTarget) {
            const override = entity._overrideTarget;
            entity._overrideTarget = null; // Use once
            return override;
        }

        switch (entity.state) {
            case BAKER_STATE.SEEKING_APPLES:
                const tree = this._getAppleTreeData(entity.targetId);
                // Trees are small, approach close (within 1.25 units)
                if (!tree) return null;
                return this._calculateApproachPosition(tree, entity.position, 0.75);

            case BAKER_STATE.SEEKING_FIREWOOD:
            case BAKER_STATE.DELIVERING:
                const market = this.gameState.getStructureById(entity.targetId);
                if (!market) return null;
                // Problem 1 Fix: Market is 2x8, approach from ~3 units away
                return this._calculateApproachPosition(market, entity.position, 3.0);

            case BAKER_STATE.RETURNING:
                // Approach bakery close (within 1.25 units)
                const bakery = this.gameState.getStructureById(entity.bakeryId);
                if (!bakery) {
                    return { x: entity.homePosition.x, z: entity.homePosition.z };
                }
                return this._calculateApproachPosition(bakery, entity.position, 0.75);

            default:
                return null;
        }
    }

    /**
     * Find market near position
     */
    _findMarketNearPosition(position, maxDistance) {
        const maxDistSq = maxDistance * maxDistance;
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(position.x, position.z);

        let nearest = null;
        let nearestDistSq = Infinity;

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = `${chunkX + dx},${chunkZ + dz}`;
                const markets = this.gameState.getMarketsInChunk(key);

                for (const market of markets) {
                    const mdx = market.position.x - position.x;
                    const mdz = market.position.z - position.z;
                    const distSq = mdx * mdx + mdz * mdz;

                    if (distSq <= maxDistSq && distSq < nearestDistSq) {
                        nearest = market;
                        nearestDistSq = distSq;
                    }
                }
            }
        }

        return nearest;
    }

    /**
     * Find nearest apple tree with apples
     */
    _findNearestAppleTree(position) {
        const maxDistSq = getConfig('APPLE_SEARCH_RADIUS_SQ');
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(position.x, position.z);

        let nearest = null;
        let nearestDistSq = Infinity;

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = `${chunkX + dx},${chunkZ + dz}`;
                const trees = this.gameState.getDeerTreeStructuresInChunk(key);

                for (const tree of trees) {
                    // Skip non-apple trees
                    if (!tree.id?.includes('apple')) continue;
                    // Skip already checked trees
                    if (this._checkedTrees.has(tree.id)) continue;

                    const tdx = tree.position.x - position.x;
                    const tdz = tree.position.z - position.z;
                    const distSq = tdx * tdx + tdz * tdz;

                    if (distSq <= maxDistSq && distSq < nearestDistSq) {
                        // Fix 3: Don't check inventory - trees are lazily initialized by server
                        nearest = tree;
                        nearestDistSq = distSq;
                    }
                }
            }
        }

        return nearest;
    }

    /**
     * Get apple tree data by ID
     */
    _getAppleTreeData(treeId) {
        if (!treeId) return null;

        // Search through deer tree structures (apple trees are registered there)
        for (const [chunkKey, trees] of this.gameState.deerTreeStructuresByChunk) {
            for (const tree of trees) {
                if (tree.id === treeId) {
                    return { ...tree, chunkId: `chunk_${chunkKey}` };
                }
            }
        }
        return null;
    }

    /**
     * Count items of type in inventory
     */
    _countItemsOfType(inventory, itemType) {
        if (!inventory?.items) return 0;
        let count = 0;
        for (let i = 0; i < inventory.items.length; i++) {
            if (inventory.items[i]?.type === itemType) count++;
        }
        return count;
    }

    /**
     * Check if bakery has firewood
     */
    _bakeryHasFirewood(inventory) {
        if (!inventory?.items) return false;
        for (let i = 0; i < inventory.items.length; i++) {
            const item = inventory.items[i];
            if (item?.type?.endsWith('firewood') && item.durability > 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * Check if market has firewood (quantity-based inventory)
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
     * Interpolate entity position/rotation
     */
    _interpolateEntity(entity, deltaTime) {
        if (!entity.targetPosition) return;

        const lerpFactor = Math.min(1, deltaTime * 5);

        entity.position.x += (entity.targetPosition.x - entity.position.x) * lerpFactor;
        entity.position.y += (entity.targetPosition.y - entity.position.y) * lerpFactor;
        entity.position.z += (entity.targetPosition.z - entity.position.z) * lerpFactor;

        if (entity.targetRotation !== null && entity.targetRotation !== undefined) {
            let diff = entity.targetRotation - entity.rotation;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            entity.rotation += diff * lerpFactor;
        }

        if (entity.mesh) {
            entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
            entity.mesh.rotation.y = entity.rotation;
        }
    }

    // =========================================================================
    // P2P MESSAGE HANDLERS
    // =========================================================================

    /**
     * Handle spawn message from peer
     */
    handleSpawnMessage(data) {
        const { bakeryId, spawnedBy, spawnTime, position, homePosition } = data;

        if (this.bakers.has(bakeryId)) return;

        const entity = {
            bakeryId: bakeryId,
            position: { ...position },
            targetPosition: { ...position },
            rotation: 0,
            targetRotation: 0,
            homePosition: { ...homePosition },
            state: BAKER_STATE.IDLE,
            targetId: null,
            carrying: [],
            path: [],
            pathIndex: 0,
            lastPathTime: 0,
            pathFailures: 0,
            stuckReason: null,
            stuckTime: 0,
            previousTask: null,
            requestSentAt: null,
            spawnedBy: spawnedBy,
            spawnTime: spawnTime,
            authorityId: spawnedBy,
            mesh: null,
            visual: null,
            controller: null, // Fix 7: Consistent with Bandit pattern
            _lastDecisionTime: 0
        };

        this.bakers.set(bakeryId, entity);

        // Fix 2: Create visual - validate success
        const visualCreated = this._createBakerVisual(entity);
        if (!visualCreated) {
            console.warn(`[BakerController] Failed to create visual for ${bakeryId}, removing entity`);
            this.bakers.delete(bakeryId);
            return;
        }

        // Fix 7: Set controller reference
        entity.controller = entity.visual;

        // Fix 1: Check for pending state that arrived before spawn
        if (this.pendingStates.has(bakeryId)) {
            const pendingState = this.pendingStates.get(bakeryId);
            this.pendingStates.delete(bakeryId);

            if (pendingState.position) {
                entity.targetPosition = { ...pendingState.position };
            }
            if (pendingState.rotation !== undefined) {
                entity.targetRotation = pendingState.rotation;
            }
            if (pendingState.state) {
                entity.state = pendingState.state;
            }
            if (pendingState.targetId !== undefined) {
                entity.targetId = pendingState.targetId;
            }
            if (pendingState.carrying) {
                entity.carrying = [...pendingState.carrying];
            }
            if (pendingState.stuckReason) {
                entity.stuckReason = pendingState.stuckReason;
            }
            if (pendingState.moving !== undefined) {
                this._setMoving(entity, pendingState.moving);
            }
        }

        console.log(`[BakerController] Received baker spawn for ${bakeryId} from ${spawnedBy}`);
    }

    /**
     * Handle state update message from peer
     */
    handleStateMessage(data) {
        const { bakeryId, position, rotation, state, targetId, carrying, moving, stuckReason } = data;

        const entity = this.bakers.get(bakeryId);

        // Fix 1: Store pending state if entity doesn't exist yet
        if (!entity) {
            this.pendingStates.set(bakeryId, data);
            return;
        }

        // Skip if we're authority
        if (entity.authorityId === this.clientId) return;

        // Fix 5: Validate Y position before applying
        let validY = position.y;
        if (!Number.isFinite(validY) || validY <= 0) {
            if (this.getTerrainHeight) {
                validY = this.getTerrainHeight(position.x, position.z);
            }
            if (!Number.isFinite(validY) || validY <= 0) {
                validY = entity.position?.y || 0;
            }
        }

        // Update target position for interpolation
        entity.targetPosition = { x: position.x, y: validY, z: position.z };
        entity.targetRotation = rotation;
        entity.state = state;
        entity.targetId = targetId;
        entity.stuckReason = stuckReason;

        // Update carrying
        entity.carrying = carrying || [];

        // Update animation
        this._setMoving(entity, moving);
    }

    /**
     * Handle despawn message from peer
     */
    handleDespawnMessage(data) {
        const { bakeryId } = data;
        this._disposeBaker(bakeryId);
    }

    /**
     * Sync bakers from peer
     */
    syncBakersFromPeer(bakerList) {
        for (const data of bakerList) {
            if (!this.bakers.has(data.bakeryId)) {
                this.handleSpawnMessage(data);
            }
        }
    }

    /**
     * Get active bakers for sync to new peer
     */
    getActiveBakersForSync() {
        const result = [];
        for (const [bakeryId, entity] of this.bakers) {
            result.push({
                bakeryId: bakeryId,
                spawnedBy: entity.spawnedBy,
                spawnTime: entity.spawnTime,
                position: { ...entity.position },
                homePosition: { ...entity.homePosition },
                state: entity.state,
                carrying: [...entity.carrying],
                authorityId: entity.authorityId
            });
        }
        return result;
    }

    /**
     * Broadcast authority state
     */
    broadcastAuthorityState() {
        if (!this.broadcastP2P) return;

        for (const [bakeryId, entity] of this.bakers) {
            if (entity.authorityId !== this.clientId) continue;

            const msg = this._broadcastMsg;
            msg.bakeryId = bakeryId;
            msg.position.x = entity.position.x;
            msg.position.y = entity.position.y;
            msg.position.z = entity.position.z;
            msg.rotation = entity.rotation;
            msg.state = entity.state;
            msg.targetId = entity.targetId;
            msg.moving = entity.visual?.isMoving || false;
            msg.stuckReason = entity.stuckReason;

            msg.carrying.length = 0;
            for (const item of entity.carrying) {
                msg.carrying.push(item);
            }

            this.broadcastP2P(msg);
        }
    }

    // =========================================================================
    // SERVER RESPONSE HANDLERS
    // =========================================================================

    /**
     * Fix 11: Handle apple collection response with robust validation
     */
    handleAppleCollectResponse(data) {
        if (!data) {
            console.warn('[BakerController] handleAppleCollectResponse called with undefined data');
            return;
        }
        const { success, collected, treeId, bakeryId } = data;

        // Fix 11: Validate bakeryId
        if (!bakeryId) {
            console.warn('[BakerController] handleAppleCollectResponse missing bakeryId');
            return;
        }

        const entity = this.bakers.get(bakeryId);
        if (!entity) {
            console.warn(`[BakerController] No entity found for bakeryId: ${bakeryId}`);
            return;
        }

        // State may have changed - ignore stale response
        if (entity.state !== BAKER_STATE.COLLECTING_APPLES) return;

        entity.requestSentAt = null;

        // Fix 11: Validate collected array
        if (success && Array.isArray(collected) && collected.length > 0) {
            for (const item of collected) {
                if (item && item.type) {
                    entity.carrying.push(item);
                }
            }

            // Problem 3/4 Fix: Update tree's local cache - remove collected apples
            if (treeId) {
                this._updateLocalInventoryCache(treeId, [], collected);
            }
        }

        // Problem 4 Fix: Only mark tree as checked if collection FAILED (tree was empty)
        // Don't mark successful trees - they might have more apples
        if (treeId && (!success || !collected || collected.length === 0)) {
            this._checkedTrees.add(treeId);
        }

        if (entity.carrying.length < getConfig('APPLES_PER_TRIP')) {
            // Need more apples - try to find another tree
            const nextTree = this._findNearestAppleTree(entity.position);
            if (nextTree) {
                // Found another tree - go to it
                entity.state = BAKER_STATE.SEEKING_APPLES;
                entity.targetId = nextTree.id;
                entity.path = [];
            } else {
                // No more trees available
                // Return home with whatever we have (even 0)
                // IDLE will trigger wait_for_apples if we still need them
                entity.state = BAKER_STATE.RETURNING;
                entity.targetId = null;
                this._checkedTrees.clear();
            }
        } else {
            // Have enough apples - return home
            entity.state = BAKER_STATE.RETURNING;
            entity.targetId = null;
            this._checkedTrees.clear();
        }
    }

    /**
     * Fix 11: Handle collect response (firewood, tarts) with robust validation
     */
    handleCollectResponse(data) {
        if (!data) {
            console.warn('[BakerController] handleCollectResponse called with undefined data');
            return;
        }
        const { success, collected, bakeryId, itemType, sourceId } = data;

        // Fix 11: Validate bakeryId
        if (!bakeryId) {
            console.warn('[BakerController] handleCollectResponse missing bakeryId');
            return;
        }

        const entity = this.bakers.get(bakeryId);
        if (!entity) {
            console.warn(`[BakerController] No entity found for bakeryId: ${bakeryId}`);
            return;
        }

        entity.requestSentAt = null;

        // Fix 11: Validate collected array
        if (success && Array.isArray(collected) && collected.length > 0) {
            for (const item of collected) {
                if (item && item.type) {
                    entity.carrying.push(item);
                }
            }

            // Problem 3 Fix: Update source structure's local cache
            // If collecting from bakery (tarts), remove items from bakery cache
            if (itemType === 'appletart' && sourceId) {
                this._updateLocalInventoryCache(sourceId, [], collected);
            }
        }

        if (itemType === 'firewood' || itemType?.endsWith?.('firewood')) {
            entity.state = BAKER_STATE.RETURNING;
            entity.targetId = null;
        } else if (itemType === 'appletart') {
            entity.state = BAKER_STATE.DELIVERING;
            // Find market for delivery
            const market = this._findMarketNearPosition(entity.homePosition, getConfig('MARKET_MAX_DISTANCE'));
            entity.targetId = market?.id || null;
            entity.path = [];
        }
    }

    /**
     * Problem 3 Fix: Update local structure inventory cache
     * Called after successful NPC operations to prevent stale reads
     * @param {string} structureId - Structure to update
     * @param {Array} itemsToAdd - Items to add to inventory
     * @param {Array} itemsToRemove - Items to remove from inventory (by id or type)
     */
    _updateLocalInventoryCache(structureId, itemsToAdd = [], itemsToRemove = []) {
        const structureData = this.gameState.getStructureById(structureId);
        if (!structureData?.object?.userData) return;

        // Ensure inventory exists
        if (!structureData.object.userData.inventory) {
            structureData.object.userData.inventory = { items: [] };
        }
        const inv = structureData.object.userData.inventory;
        if (!inv.items) inv.items = [];

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

    /**
     * Handle deposit response - works for both bakery deposits and market deposits
     */
    handleDepositResponse(data) {
        if (!data) {
            console.warn('[BakerController] handleDepositResponse called with undefined data');
            return;
        }
        const { success, bakeryId, depositedItems, depositType } = data;

        if (!bakeryId) {
            console.warn('[BakerController] handleDepositResponse missing bakeryId');
            return;
        }

        const entity = this.bakers.get(bakeryId);
        if (!entity) {
            console.warn(`[BakerController] No entity found for bakeryId: ${bakeryId}`);
            return;
        }

        // Remember current state before changing it
        const wasAtMarket = entity.state === BAKER_STATE.DEPOSITING_TARTS;

        entity.requestSentAt = null;

        if (success) {
            // Update local inventory cache
            const itemsDeposited = depositedItems || [...entity.carrying];
            if (!wasAtMarket) {
                // Deposited to bakery - update bakery cache
                this._updateLocalInventoryCache(bakeryId, itemsDeposited, []);
            }
            // Note: Market inventory is not tracked locally

            entity.carrying.length = 0;
        }

        if (wasAtMarket) {
            // Was at market - return to bakery before re-evaluating
            entity.state = BAKER_STATE.RETURNING;
            entity.targetId = null;
            entity.path = [];
        } else {
            // Was at bakery - safe to go to IDLE
            entity.state = BAKER_STATE.IDLE;
            entity.targetId = null;
        }
    }

    // =========================================================================
    // CLEANUP
    // =========================================================================

    /**
     * Dispose baker when bakery destroyed
     */
    _disposeBaker(bakeryId) {
        const entity = this.bakers.get(bakeryId);
        if (!entity) return;

        // Remove name tag
        if (this.game?.nameTagManager) {
            this.game.nameTagManager.unregisterEntity(bakeryId);
        }

        // Stop animations
        if (entity.visual?.mixer) {
            entity.visual.mixer.stopAllAction();
        }

        // Remove from scene
        if (entity.mesh?.parent) {
            entity.mesh.parent.remove(entity.mesh);
        }

        // Clear references
        entity.mesh = null;
        entity.visual = null;

        this.bakers.delete(bakeryId);

        console.log(`[BakerController] Disposed baker for ${bakeryId}`);
    }

    /**
     * Handle bakery destruction
     */
    onBakeryDestroyed(bakeryId) {
        if (this.bakers.has(bakeryId)) {
            // Broadcast despawn
            if (this.broadcastP2P) {
                this.broadcastP2P({
                    type: 'baker_despawn',
                    bakeryId: bakeryId,
                    reason: 'bakery_destroyed'
                });
            }

            this._disposeBaker(bakeryId);
        }
    }

    // =========================================================================
    // AUTHORITY MANAGEMENT (Fix 3, Fix 4, Fix 9)
    // =========================================================================

    /**
     * Fix 3: Calculate which client should be authority for a baker
     * Uses lowest clientId among players near the bakery (consistent with Bandit)
     * @param {string} bakeryId
     * @returns {string} clientId that should be authority
     */
    _calculateAuthority(bakeryId) {
        const entity = this.bakers.get(bakeryId);
        if (!entity) return this.clientId;

        const CHUNK_SIZE = getConfig('CHUNK_SIZE');
        const homeChunkX = Math.floor(entity.homePosition.x / CHUNK_SIZE);
        const homeChunkZ = Math.floor(entity.homePosition.z / CHUNK_SIZE);

        // Get players in 3x3 area around baker's home
        const chunkKeys = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                chunkKeys.push(`${homeChunkX + dx},${homeChunkZ + dz}`);
            }
        }

        // If we have a way to get players in chunks, use it
        if (!this.gameState?.getPlayersInChunks) {
            return this.clientId;
        }

        const players = this.gameState.getPlayersInChunks(chunkKeys);
        if (!players || players.size === 0) {
            return this.clientId;
        }

        // Find lowest clientId - deterministic for P2P sync
        let lowestId = this.clientId;
        for (const playerId of players) {
            if (playerId < lowestId) {
                lowestId = playerId;
            }
        }

        return lowestId;
    }

    /**
     * Fix 4: Broadcast state for a single entity (used after authority transfer)
     * @param {object} entity
     * @param {string} bakeryId
     */
    _broadcastSingleEntityState(entity, bakeryId) {
        if (!this.broadcastP2P) return;

        this.broadcastP2P({
            type: 'baker_state',
            bakeryId: bakeryId,
            position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
            rotation: entity.rotation,
            state: entity.state,
            targetId: entity.targetId,
            carrying: [...entity.carrying],
            moving: entity.visual?.isMoving || false,
            stuckReason: entity.stuckReason
        });
    }

    /**
     * Fix 9: Handle peer disconnect - transfer authority and sync state
     */
    onPeerDisconnected(peerId) {
        for (const [bakeryId, entity] of this.bakers) {
            if (entity.authorityId === peerId) {
                // Recalculate authority
                const newAuthority = this._calculateAuthority(bakeryId);
                if (newAuthority) {
                    const wasMe = entity.authorityId === this.clientId;
                    const isNowMe = newAuthority === this.clientId;
                    entity.authorityId = newAuthority;

                    // If we're taking over authority, handle position transfer
                    if (isNowMe && !wasMe) {
                        // Snap position to last known authoritative position
                        if (entity.targetPosition) {
                            entity.position.x = entity.targetPosition.x;
                            entity.position.y = entity.targetPosition.y;
                            entity.position.z = entity.targetPosition.z;
                        }

                        // Sync mesh position
                        if (entity.mesh) {
                            entity.mesh.position.set(
                                entity.position.x,
                                entity.position.y,
                                entity.position.z
                            );
                        }

                        // Immediately broadcast our state so other peers sync
                        this._broadcastSingleEntityState(entity, bakeryId);
                    }

                    console.log(`[BakerController] Baker ${bakeryId} authority transferred from ${peerId} to ${newAuthority}`);
                }
            }
        }
    }

    /**
     * Fix 4: Handle new peer joining a chunk - recalculate authority for nearby bakers
     * @param {string} peerId - The new peer's ID
     * @param {string} chunkKey - The chunk the peer joined
     */
    onPeerJoinedChunk(peerId, chunkKey) {
        const CHUNK_SIZE = getConfig('CHUNK_SIZE');
        const [peerChunkX, peerChunkZ] = chunkKey.split(',').map(Number);

        for (const [bakeryId, entity] of this.bakers) {
            // Check if peer is in 3x3 area around baker's home position
            const homeChunkX = Math.floor(entity.homePosition.x / CHUNK_SIZE);
            const homeChunkZ = Math.floor(entity.homePosition.z / CHUNK_SIZE);
            const dx = Math.abs(peerChunkX - homeChunkX);
            const dz = Math.abs(peerChunkZ - homeChunkZ);

            if (dx <= 1 && dz <= 1) {
                // Peer is near this baker - recalculate authority
                const newAuthority = this._calculateAuthority(bakeryId);
                if (newAuthority && newAuthority !== entity.authorityId) {
                    const wasMe = entity.authorityId === this.clientId;
                    const isNowMe = newAuthority === this.clientId;
                    entity.authorityId = newAuthority;

                    // If we gained authority, snap position and broadcast
                    if (isNowMe && !wasMe) {
                        if (entity.targetPosition) {
                            entity.position.x = entity.targetPosition.x;
                            entity.position.y = entity.targetPosition.y;
                            entity.position.z = entity.targetPosition.z;
                        }

                        if (entity.mesh) {
                            entity.mesh.position.set(
                                entity.position.x,
                                entity.position.y,
                                entity.position.z
                            );
                        }

                        // Immediately broadcast our state
                        this._broadcastSingleEntityState(entity, bakeryId);
                    }
                }
            }
        }
    }

    /**
     * Fix 4: Handle peer changing chunks - recalculate authority if needed
     * @param {string} peerId
     * @param {string} oldChunkKey
     * @param {string} newChunkKey
     */
    onPeerChunkChanged(peerId, oldChunkKey, newChunkKey) {
        const CHUNK_SIZE = getConfig('CHUNK_SIZE');
        const [newX, newZ] = newChunkKey.split(',').map(Number);

        for (const [bakeryId, entity] of this.bakers) {
            const homeChunkX = Math.floor(entity.homePosition.x / CHUNK_SIZE);
            const homeChunkZ = Math.floor(entity.homePosition.z / CHUNK_SIZE);
            const dx = Math.abs(newX - homeChunkX);
            const dz = Math.abs(newZ - homeChunkZ);
            const isNowInRange = dx <= 1 && dz <= 1;

            // Case 1: Current authority left the region
            if (entity.authorityId === peerId && !isNowInRange) {
                const newAuthority = this._calculateAuthority(bakeryId);
                if (newAuthority) {
                    const wasMe = entity.authorityId === this.clientId;
                    const isNowMe = newAuthority === this.clientId;
                    entity.authorityId = newAuthority;

                    if (isNowMe && !wasMe) {
                        if (entity.targetPosition) {
                            entity.position.x = entity.targetPosition.x;
                            entity.position.y = entity.targetPosition.y;
                            entity.position.z = entity.targetPosition.z;
                        }
                        if (entity.mesh) {
                            entity.mesh.position.set(
                                entity.position.x,
                                entity.position.y,
                                entity.position.z
                            );
                        }
                        this._broadcastSingleEntityState(entity, bakeryId);
                    }
                }
            }
            // Case 2: A peer entered the region - might have lower clientId
            else if (isNowInRange && entity.authorityId !== peerId) {
                const newAuthority = this._calculateAuthority(bakeryId);
                if (newAuthority && newAuthority !== entity.authorityId) {
                    const wasMe = entity.authorityId === this.clientId;
                    const isNowMe = newAuthority === this.clientId;
                    entity.authorityId = newAuthority;

                    if (isNowMe && !wasMe) {
                        if (entity.targetPosition) {
                            entity.position.x = entity.targetPosition.x;
                            entity.position.y = entity.targetPosition.y;
                            entity.position.z = entity.targetPosition.z;
                        }
                        if (entity.mesh) {
                            entity.mesh.position.set(
                                entity.position.x,
                                entity.position.y,
                                entity.position.z
                            );
                        }
                        this._broadcastSingleEntityState(entity, bakeryId);
                    }
                }
            }
        }
    }

    /**
     * Get baker data for dialogue
     */
    getBakerDialogueData(bakeryId) {
        const entity = this.bakers.get(bakeryId);
        if (!entity) return null;

        return {
            state: entity.state,
            stuckReason: entity.stuckReason,
            carrying: entity.carrying.length,
            bakeryId: bakeryId
        };
    }
}

// Export singleton instance
export const bakerController = new BakerController();

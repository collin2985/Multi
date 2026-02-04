/**
 * BrownBearController.js
 * Melee predator AI with authority-based multiplayer sync
 *
 * Architecture:
 * - Spawns from bearden structures
 * - Melee combat (not ranged like bandits)
 * - One authority client simulates each bear
 * - Authority broadcasts state; non-authority interpolates
 */

import { BaseAIController } from './BaseAIController.js';
import { getAISpawnQueue } from './AISpawnQueue.js';
import { CONFIG } from '../config.js';
import { ChunkCoordinates } from '../core/ChunkCoordinates.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const AI_CONFIG = {
    BROWN_BEAR: {
        // Spawning
        SPAWN_RANGE: 50,           // Distance from den to trigger spawn
        SPAWN_HEIGHT_MIN: 0.5,     // Don't spawn/walk in water

        // Movement
        MOVE_SPEED: CONFIG.BROWN_BEAR?.MOVE_SPEED ?? 2.75,      // Units per second (faster than bandits)
        WANDER_SPEED: CONFIG.BROWN_BEAR?.WANDER_SPEED ?? 0.75,  // Slow walk speed for wandering
        FLEE_SPEED: CONFIG.BROWN_BEAR?.FLEE_SPEED ?? 2.75,      // Units per second when fleeing
        CHASE_RANGE: 30,           // Distance to detect/chase players
        LEASH_RANGE: 50,           // Max distance from home den
        TURN_SPEED: 4.0,           // Radians per second (~229 deg/sec)

        // State durations
        IDLE_DURATION: 10000,      // 10 seconds idle before wandering
        WANDER_DURATION: 5000,     // 5 seconds of wandering
        FLEE_DURATION: 20000,      // 20 seconds of fleeing from structures

        // Structure detection
        OBJECT_DETECT_RANGE: 7,    // Distance to detect structures
        DETECTION_INTERVAL: 500,   // Ms between structure detection checks

        // Structures the bear will flee from
        FLEE_STRUCTURES: [
            'house', 'market', 'dock', 'bakery', 'blacksmith',
            'ironworks', 'tileworks', 'stonemason', 'woodcutter',
            'fisherman', 'gardener', 'miner'
        ],

        // Melee Combat
        ATTACK_RANGE: 1,           // Distance to deal damage (instant kill)
        ATTACK_COOLDOWN: 1000,     // Ms between attacks

        // Sound
        ROAR_INTERVAL: 6000,       // Play roar every 6 seconds while chasing/attacking

        // Harvesting
        HARVEST_RANGE: 3,          // Distance to harvest corpse

        // Performance
        IDLE_CHECK_INTERVAL: 30,   // Frames between target checks when idle
        TARGET_VALIDATE_INTERVAL: 5,  // Frames between current target validation (chasing/attacking)
        TARGET_RESCAN_INTERVAL: 60,   // Frames between full target re-scan (chasing/attacking)
        CHUNK_SIZE: 50,
    },
};

// =============================================================================
// BROWN BEAR CONTROLLER CLASS
// =============================================================================

export class BrownBearController extends BaseAIController {
    constructor() {
        super({
            entityType: 'brownbear',
            entityIdField: 'denId',
            messagePrefix: 'brownbear',
            broadcastInterval: 1000,
        });

        // State (entities Map inherited from BaseAIController)
        this._frameCount = 0;

        // Callbacks (set via initialize)
        this.getPlayersInChunks = null;
        this.getPlayerPosition = null;
        this.getBrownBearStructures = null;
        this.getTerrainHeight = null;
        this.getChunkObjects = null;
        this.createVisual = null;
        this.destroyVisual = null;
        this.broadcastP2P = null;
        this.onAttack = null;
        this.isPlayerDead = null;
        this.isPlayerClimbing = null;
        this.isPlayerActive = null;  // Heartbeat: checks if player has recent updates
        this.isPlayerSpawnProtected = null;  // Spawn protection: skip targeting for 2 min after random spawn

        // AIRegistry for cross-controller queries (bandits, deer, etc.)
        this.registry = null;

        // Spawn optimization
        this._hasDensInRange = false;
        this._lastCheckedChunkX = null;
        this._lastCheckedChunkZ = null;
        this._denCheckIndex = 0;          // Which den to check this tick
        this._collectedDens = [];         // Reusable array for dens

        // Performance caches
        this._playerListCache = [];
        this._playerObjectPool = [];
        this._candidatesCache = [];
        this._candidateObjectPool = [];

        // Structure detection caches
        this._fleeStructuresSet = new Set(AI_CONFIG.BROWN_BEAR.FLEE_STRUCTURES);
        this._chunkObjectsCache = new Map();
        this._chunkCacheFrame = 0;

        // Pending states queue (handles race condition: state message before spawn)
        this.pendingStates = new Map();
        this._lastPendingStatesCleanup = 0;

        // Performance: Reusable broadcast message to avoid GC pressure
        this._broadcastMsg = {
            type: 'brownbear_state',
            denId: '',
            authorityId: '',
            authorityTerm: 1,
            position: { x: 0, y: 0, z: 0 },
            rotation: 0,
            state: '',
            target: null,
            chaseTargetType: null,
            homePosition: { x: 0, z: 0 },
            wanderDirection: null,
            fleeDirection: null
        };
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    initialize(config) {
        this.clientId = config.clientId;
        this.game = config.game;
        this.getPlayersInChunks = config.getPlayersInChunks;
        this.getPlayerPosition = config.getPlayerPosition;
        this.getBrownBearStructures = config.getBrownBearStructures;
        this.getTerrainHeight = config.getTerrainHeight;
        this.getChunkObjects = config.getChunkObjects;
        this.createVisual = config.createVisual;
        this.destroyVisual = config.destroyVisual;
        this.broadcastP2P = config.broadcastP2P;
        this.isPlayerDead = config.isPlayerDead;
        this.isPlayerClimbing = config.isPlayerClimbing || null;
        this.onAttack = config.onAttack;
        this.isPlayerActive = config.isPlayerActive || null;  // Heartbeat callback
        this.isPlayerSpawnProtected = config.isPlayerSpawnProtected || null;

        // Registry is set automatically when registered with AIRegistry
        // but can also be passed explicitly
        if (config.registry) {
            this.registry = config.registry;
        }

        // Register spawn callback with queue system
        const spawnQueue = getAISpawnQueue();
        spawnQueue.registerSpawnCallback('brownbear', (data) => {
            this._executeSpawn(data);
        });

        return true;
    }

    /**
     * Execute spawn from queue (called by AISpawnQueue)
     * @param {object} data - Spawn data from queue { den }
     */
    _executeSpawn(data) {
        const { den } = data;

        // Race condition check - entity may have spawned while in queue
        if (this.entities.has(den.id)) {
            return;
        }

        this._spawnBrownBear(den);
    }

    // =========================================================================
    // MAIN UPDATE LOOP
    // =========================================================================

    update(deltaTime, chunkX, chunkZ) {
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

        // Build player list for targeting
        const players = this._buildPlayerList(chunkX, chunkZ);

        // Update all entities
        for (const [denId, entity] of this.entities) {
            this._updateEntity(entity, deltaTime, now, players);
        }
    }

    // =========================================================================
    // TARGET ACQUISITION
    // =========================================================================

    _buildPlayerList(chunkX, chunkZ) {
        this._playerListCache.length = 0;
        let poolIndex = 0;

        const getPlayerObj = (id, x, z, y) => {
            if (poolIndex >= this._playerObjectPool.length) {
                this._playerObjectPool.push({ id: '', x: 0, z: 0, y: 0 });
            }
            const obj = this._playerObjectPool[poolIndex++];
            obj.id = id;
            obj.x = x;
            obj.z = z;
            obj.y = y;
            return obj;
        };

        // Get players in 3x3 chunk area
        const chunkKeys = this._get3x3ChunkKeys(chunkX, chunkZ);
        const playerIds = this.getPlayersInChunks(chunkKeys);

        for (const playerId of playerIds) {
            if (this.isPlayerDead && this.isPlayerDead(playerId)) {
                console.log(`[Bear] FILTERED dead player: ${playerId}`);
                continue;
            }
            if (this.isPlayerClimbing && this.isPlayerClimbing(playerId)) continue;
            if (this.isPlayerSpawnProtected && this.isPlayerSpawnProtected(playerId)) continue;
            const pos = this.getPlayerPosition(playerId);
            if (pos) {
                this._playerListCache.push(getPlayerObj(playerId, pos.x, pos.z, pos.y || 0));
            }
        }

        return this._playerListCache;
    }

    _get3x3ChunkKeys(chunkX, chunkZ) {
        const keys = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                keys.push(`${chunkX + dx},${chunkZ + dz}`);
            }
        }
        return keys;
    }

    _findClosestPlayer(pos, range, players) {
        const rangeSq = range * range;

        // Clear cache
        this._candidatesCache.length = 0;
        let poolIndex = 0;

        // Find all players in range
        for (const player of players) {
            const dx = player.x - pos.x;
            const dz = player.z - pos.z;
            const distSq = dx * dx + dz * dz;

            if (distSq < rangeSq) {
                if (poolIndex >= this._candidateObjectPool.length) {
                    this._candidateObjectPool.push({ player: null, distSq: 0 });
                }
                const obj = this._candidateObjectPool[poolIndex++];
                obj.player = player;
                obj.distSq = distSq;
                this._candidatesCache.push(obj);
            }
        }

        if (this._candidatesCache.length === 0) return null;
        if (this._candidatesCache.length === 1) return this._candidatesCache[0].player;

        // Find minimum distance
        let minDistSq = Infinity;
        for (const c of this._candidatesCache) {
            if (c.distSq < minDistSq) minDistSq = c.distSq;
        }

        // Tie-breaker: players within 2 units of closest are "equally close"
        const thresholdSq = 4;

        // Move near-equal candidates to front
        let nearEqualCount = 0;
        for (let i = 0; i < this._candidatesCache.length; i++) {
            if (this._candidatesCache[i].distSq <= minDistSq + thresholdSq) {
                if (i !== nearEqualCount) {
                    const temp = this._candidatesCache[nearEqualCount];
                    this._candidatesCache[nearEqualCount] = this._candidatesCache[i];
                    this._candidatesCache[i] = temp;
                }
                nearEqualCount++;
            }
        }

        // Find minimum player id among near-equal candidates (deterministic)
        if (nearEqualCount > 1) {
            let minIndex = 0;
            let minId = this._candidatesCache[0].player.id;

            for (let i = 1; i < nearEqualCount; i++) {
                const id = this._candidatesCache[i].player.id;
                if (id < minId) {
                    minIndex = i;
                    minId = id;
                }
            }

            if (minIndex !== 0) {
                const temp = this._candidatesCache[0];
                this._candidatesCache[0] = this._candidatesCache[minIndex];
                this._candidatesCache[minIndex] = temp;
            }
        }

        return this._candidatesCache[0].player;
    }

    /**
     * Find nearest chase target (players, bandits, deer) within range
     * Bears are aggressive toward all living things
     */
    _findNearestTarget(entity, range, players) {
        const rangeSq = range * range;

        let nearestTarget = null;
        let nearestDistSq = Infinity;

        // Check players
        for (const player of players) {
            const dx = player.x - entity.position.x;
            const dz = player.z - entity.position.z;
            const distSq = dx * dx + dz * dz;

            if (distSq < rangeSq && distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearestTarget = { id: player.id, x: player.x, z: player.z, type: 'player' };
            }
        }

        // Check bandits (through registry)
        const banditController = this.registry?.get('bandit');
        if (banditController?.entities) {
            for (const [tentId, bandit] of banditController.entities) {
                if (!bandit.mesh || bandit.state === 'dead') continue;
                if (bandit.isTowerMilitia) continue;
                const pos = bandit.mesh.position;

                const dx = pos.x - entity.position.x;
                const dz = pos.z - entity.position.z;
                const distSq = dx * dx + dz * dz;

                if (distSq < rangeSq && distSq < nearestDistSq) {
                    nearestDistSq = distSq;
                    nearestTarget = { id: tentId, x: pos.x, z: pos.z, type: 'bandit' };
                }
            }
        }

        // Check deer (through registry)
        const deerController = this.registry?.get('deer');
        if (deerController?.entities) {
            for (const [chunkKey, deer] of deerController.entities) {
                if (!deer.mesh || deer.isDead) continue;
                const pos = deer.position;

                const dx = pos.x - entity.position.x;
                const dz = pos.z - entity.position.z;
                const distSq = dx * dx + dz * dz;

                if (distSq < rangeSq && distSq < nearestDistSq) {
                    nearestDistSq = distSq;
                    nearestTarget = { id: chunkKey, x: pos.x, z: pos.z, type: 'deer' };
                }
            }
        }

        return nearestTarget;
    }

    /**
     * Validate current cached target still exists and is in range
     * Cheap check - only looks up the specific target, doesn't iterate all entities
     */
    _validateCurrentTarget(entity, range, players) {
        const cached = entity.cachedTarget;
        if (!cached) return null;

        const rangeSq = range * range;

        // Get current position of the cached target
        let currentPos = null;

        switch (cached.type) {
            case 'player': {
                // Check if player still exists and get position
                const player = players.find(p => p.id === cached.id);
                if (player) {
                    currentPos = { x: player.x, z: player.z };
                }
                break;
            }
            case 'bandit': {
                const banditController = this.registry?.get('bandit');
                const bandit = banditController?.entities?.get(cached.id);
                if (bandit?.mesh && bandit.state !== 'dead') {
                    currentPos = { x: bandit.mesh.position.x, z: bandit.mesh.position.z };
                }
                break;
            }
            case 'deer': {
                const deerController = this.registry?.get('deer');
                const deer = deerController?.entities?.get(cached.id);
                if (deer?.mesh && !deer.isDead) {
                    currentPos = { x: deer.position.x, z: deer.position.z };
                }
                break;
            }
        }

        if (!currentPos) return null;

        // Check if still in range
        const dx = currentPos.x - entity.position.x;
        const dz = currentPos.z - entity.position.z;
        const distSq = dx * dx + dz * dz;

        if (distSq < rangeSq) {
            // Update cached position and return
            return { id: cached.id, x: currentPos.x, z: currentPos.z, type: cached.type };
        }

        return null;
    }

    _moveToward(entity, targetX, targetZ, speed, deltaTime) {
        const config = AI_CONFIG.BROWN_BEAR;
        const dx = targetX - entity.position.x;
        const dz = targetZ - entity.position.z;
        const distSq = dx * dx + dz * dz;

        if (distSq < 0.01) return true; // Already there

        const dist = Math.sqrt(distSq);
        const dirX = dx / dist;
        const dirZ = dz / dist;

        // Gradual rotation toward target
        const targetRot = Math.atan2(dirX, dirZ);
        let rotDiff = targetRot - entity.rotation;
        while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
        while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;

        const turnAmount = config.TURN_SPEED * (deltaTime / 1000);
        if (Math.abs(rotDiff) < turnAmount) {
            entity.rotation = targetRot;
        } else {
            entity.rotation += Math.sign(rotDiff) * turnAmount;
        }

        // Speed scaling based on alignment - no movement until within 45 degrees
        const absRotDiff = Math.abs(rotDiff);
        let alignmentFactor;
        if (absRotDiff > Math.PI / 4) {
            alignmentFactor = 0; // Turn in place
        } else {
            alignmentFactor = 1 - (absRotDiff / (Math.PI / 4));
        }

        // Store alignment factor for animation scaling
        entity.alignmentFactor = alignmentFactor;

        const adjustedSpeed = speed * alignmentFactor;
        const moveAmount = adjustedSpeed * (deltaTime / 1000);

        if (moveAmount < 0.001) {
            // Just turning, no movement
            return true;
        }

        let newX, newZ;
        if (moveAmount >= dist) {
            newX = targetX;
            newZ = targetZ;
        } else {
            newX = entity.position.x + dirX * moveAmount;
            newZ = entity.position.z + dirZ * moveAmount;
        }

        // Stop at water - don't chase into water
        if (this.getTerrainHeight) {
            const newY = this.getTerrainHeight(newX, newZ);
            if (newY < config.SPAWN_HEIGHT_MIN) {
                // Mark water in navmap so pathfinding avoids it
                this.game?.navigationManager?.markWater(newX, newZ);
                return false; // Water boundary - stop chasing
            }
            entity.position.x = newX;
            entity.position.z = newZ;
            entity.position.y = newY;
        } else {
            entity.position.x = newX;
            entity.position.z = newZ;
        }

        return true;
    }

    _moveInDirection(entity, dirX, dirZ, speed, deltaTime) {
        const config = AI_CONFIG.BROWN_BEAR;

        // Gradual rotation toward movement direction
        const targetRot = Math.atan2(dirX, dirZ);
        let rotDiff = targetRot - entity.rotation;
        while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
        while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;

        const turnAmount = config.TURN_SPEED * (deltaTime / 1000);
        if (Math.abs(rotDiff) < turnAmount) {
            entity.rotation = targetRot;
        } else {
            entity.rotation += Math.sign(rotDiff) * turnAmount;
        }

        // Speed scaling based on alignment - no movement until within 45 degrees
        const absRotDiff = Math.abs(rotDiff);
        let alignmentFactor;
        if (absRotDiff > Math.PI / 4) {
            alignmentFactor = 0; // Turn in place
        } else {
            alignmentFactor = 1 - (absRotDiff / (Math.PI / 4));
        }

        // Store alignment factor for animation scaling
        entity.alignmentFactor = alignmentFactor;

        const adjustedSpeed = speed * alignmentFactor;
        const moveAmount = adjustedSpeed * (deltaTime / 1000);

        if (moveAmount < 0.001) {
            // Just turning, no movement
            return true;
        }

        const newX = entity.position.x + dirX * moveAmount;
        const newZ = entity.position.z + dirZ * moveAmount;
        const newY = this.getTerrainHeight(newX, newZ);

        // Stop at water
        if (newY < config.SPAWN_HEIGHT_MIN) {
            // Mark water in navmap so pathfinding avoids it
            this.game?.navigationManager?.markWater(newX, newZ);
            return false;
        }

        entity.position.x = newX;
        entity.position.z = newZ;
        entity.position.y = newY;

        return true;
    }

    _startIdle(entity, now) {
        entity.state = 'idle';
        entity.stateStartTime = now;
        entity.wanderDirection = null;
    }

    _startWandering(entity, now) {
        entity.state = 'wandering';
        entity.stateStartTime = now;

        // Random direction
        const angle = Math.random() * Math.PI * 2;
        entity.wanderDirection = {
            x: Math.sin(angle),
            z: Math.cos(angle)
        };
    }

    _startFleeing(entity, threat, now) {
        entity.state = 'fleeing';
        entity.stateStartTime = now;
        entity.chaseTarget = null;

        // Direction away from threat
        const dx = entity.position.x - threat.x;
        const dz = entity.position.z - threat.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < 0.001) {
            // Threat exactly on top of bear, pick random direction
            const angle = Math.random() * Math.PI * 2;
            entity.fleeDirection = { x: Math.sin(angle), z: Math.cos(angle) };
        } else {
            entity.fleeDirection = { x: dx / dist, z: dz / dist };
        }
    }

    _performAttack(entity, target, now) {
        const config = AI_CONFIG.BROWN_BEAR;

        // Check cooldown
        if (now - entity.lastAttackTime < config.ATTACK_COOLDOWN) return;

        entity.lastAttackTime = now;
        entity.attackCount++;

        // Face target
        const dx = target.x - entity.position.x;
        const dz = target.z - entity.position.z;
        entity.rotation = Math.atan2(dx, dz);

        // Play attack animation
        if (entity.controller?.playAttackAnimation) {
            entity.controller.playAttackAnimation();
        }

        const targetType = entity.chaseTargetType || 'player';
        const bearPos = { x: entity.position.x, y: entity.position.y, z: entity.position.z };
        const targetPos = { x: target.x, y: entity.position.y + 0.5, z: target.z };

        // Spawn blood effect at target position
        if (this.game?.effectManager) {
            this.game.effectManager.spawnBloodEffect(targetPos, bearPos);
        }

        // Handle damage based on target type
        switch (targetType) {
            case 'player':
                // Deal damage to player via callback
                if (this.onAttack) {
                    this.onAttack(entity.denId, target.id, bearPos);
                }
                break;

            case 'deer':
                // Kill deer via registry
                this.registry?.killEntity('deer', target.id, entity.denId);
                break;

            case 'bandit':
                // Kill bandit via registry
                this.registry?.killEntity('bandit', target.id, entity.denId);
                break;
        }

        // Broadcast attack
        this.broadcastP2P({
            type: 'brownbear_attack',
            denId: entity.denId,
            targetId: target.id,
            targetType: targetType,
            position: bearPos
        });
    }

    _playRoar(entity) {
        // Play bear sound through AudioManager as positional audio
        if (this.game?.audioManager && entity.mesh) {
            this.game.audioManager.playPositionalSound('brownbear', entity.mesh);
        }
    }

    // =========================================================================
    // STRUCTURE DETECTION
    // =========================================================================

    /**
     * Get cached chunk objects for 3x3 area around entity
     * Cache is invalidated each frame to avoid stale data
     */
    _getCachedChunkObjects(entity) {
        if (!this.getChunkObjects) return [];

        const config = AI_CONFIG.BROWN_BEAR;
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

    _shouldFleeFrom(objectType) {
        if (!objectType) return false;
        const lower = objectType.toLowerCase();
        // O(1) check for exact match
        if (this._fleeStructuresSet.has(lower)) return true;
        // Check if type contains any flee structure keyword
        for (const struct of this._fleeStructuresSet) {
            if (lower.includes(struct)) return true;
        }
        return false;
    }

    /**
     * Find nearest structure (for fleeing) - only checks specific flee structures
     */
    _findNearestStructure(entity) {
        const config = AI_CONFIG.BROWN_BEAR;
        const objectRange = config.OBJECT_DETECT_RANGE;
        const objectRangeSq = objectRange * objectRange;

        let nearestStructure = null;
        let nearestDistSq = Infinity;

        const allObjects = this._getCachedChunkObjects(entity);

        for (const obj of allObjects) {
            // Only flee from specific structures
            if (!this._shouldFleeFrom(obj.type)) continue;

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
        const config = AI_CONFIG.BROWN_BEAR;
        if (now - entity.lastDetectionCheck < config.DETECTION_INTERVAL) {
            return; // Use cached results
        }

        entity.lastDetectionCheck = now;
        entity.cachedStructure = this._findNearestStructure(entity);
    }

    // =========================================================================
    // STATE MACHINE
    // =========================================================================

    _updateEntity(entity, deltaTime, now, players) {
        const config = AI_CONFIG.BROWN_BEAR;

        // Dead entities do nothing
        if (entity.state === 'dead') {
            return;
        }

        // Non-authority: interpolate only
        if (entity.authorityId !== this.clientId) {
            this._interpolateEntity(entity, deltaTime);
            return;
        }

        // === AUTHORITY LOGIC ===

        // Track whether actual movement occurred this frame (for animation)
        let didMove = false;

        // Find target with throttling to reduce iteration overhead (staggered by entity offset)
        // - Idle/wandering: full scan every IDLE_CHECK_INTERVAL frames
        // - Chasing/attacking: validate current target every TARGET_VALIDATE_INTERVAL frames,
        //   full re-scan every TARGET_RESCAN_INTERVAL frames
        let target = entity.cachedTarget || null;
        const offset = entity._frameOffset || 0;

        if (entity.state === 'idle' || entity.state === 'wandering') {
            // Idle/wandering: periodic full scan
            if ((this._frameCount + offset) % config.IDLE_CHECK_INTERVAL === 0) {
                target = this._findNearestTarget(entity, config.CHASE_RANGE, players);
                entity.cachedTarget = target;
            }
        } else if (entity.state === 'chasing') {
            // Chasing: validate current target frequently, full re-scan rarely
            const hadTarget = entity.cachedTarget !== null;
            if ((this._frameCount + offset) % config.TARGET_RESCAN_INTERVAL === 0) {
                // Full re-scan for possibly closer target
                target = this._findNearestTarget(entity, config.CHASE_RANGE, players);
                entity.cachedTarget = target;
            } else if ((this._frameCount + offset) % config.TARGET_VALIDATE_INTERVAL === 0) {
                // Validate current target still exists and in range
                target = this._validateCurrentTarget(entity, config.CHASE_RANGE, players);
                entity.cachedTarget = target;
            }
            // Track when target is lost (for anti-oscillation)
            if (hadTarget && !entity.cachedTarget) {
                entity.targetLostTime = now;
            }
            // Otherwise use cached target
        } else if (entity.state === 'returning') {
            // Returning: scan for targets at a slower rate than idle/wandering
            // The state machine handles the 2-second reacquire delay to prevent oscillation
            if ((this._frameCount + offset) % config.TARGET_RESCAN_INTERVAL === 0) {
                target = this._findNearestTarget(entity, config.CHASE_RANGE, players);
                entity.cachedTarget = target;
            } else {
                target = entity.cachedTarget;
            }
        }
        // Attacking state: don't re-scan, wait for animation to finish

        entity.target = target ? target.id : null;
        entity.chaseTargetType = target ? target.type : null;

        // Distance to home
        const dxHome = entity.position.x - entity.homePosition.x;
        const dzHome = entity.position.z - entity.homePosition.z;
        const distFromHomeSq = dxHome * dxHome + dzHome * dzHome;
        const atHome = distFromHomeSq < 4; // Within 2 units
        const isLeashed = distFromHomeSq > config.LEASH_RANGE * config.LEASH_RANGE;

        // Time in current state
        const elapsed = now - entity.stateStartTime;

        // Update structure detection cache (throttled)
        this._updateDetectionCache(entity, now);

        // State transitions
        switch (entity.state) {
            case 'idle':
                // Structure flee takes priority
                if (entity.cachedStructure) {
                    this._startFleeing(entity, entity.cachedStructure, now);
                    break;
                }
                if (target) {
                    entity.state = 'chasing';
                    entity.stateStartTime = now;
                    entity.wanderDirection = null;
                    // Play roar only if cooldown has elapsed (don't reset timer on every state entry)
                    if (now - entity.lastRoarTime >= config.ROAR_INTERVAL) {
                        entity.lastRoarTime = now;
                        this._playRoar(entity);
                    }
                } else if (elapsed >= config.IDLE_DURATION) {
                    this._startWandering(entity, now);
                }
                break;

            case 'wandering': {
                // Structure flee takes priority
                if (entity.cachedStructure) {
                    this._startFleeing(entity, entity.cachedStructure, now);
                    break;
                }

                // Can still detect and chase targets while wandering
                if (target) {
                    entity.state = 'chasing';
                    entity.stateStartTime = now;
                    entity.wanderDirection = null;
                    // Play roar only if cooldown has elapsed
                    if (now - entity.lastRoarTime >= config.ROAR_INTERVAL) {
                        entity.lastRoarTime = now;
                        this._playRoar(entity);
                    }
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
                        // Hit water, stop and go idle
                        this._startIdle(entity, now);
                    } else {
                        didMove = true;
                    }
                }
                break;
            }

            case 'chasing':
                // Structure flee takes priority
                if (entity.cachedStructure) {
                    this._startFleeing(entity, entity.cachedStructure, now);
                    break;
                }

                if (!target || isLeashed) {
                    entity.state = 'returning';
                    entity.stateStartTime = now;
                    // FIX: Clear cached target to prevent oscillation from stale data
                    entity.cachedTarget = null;
                    entity.targetLostTime = now;
                } else {
                    // Check if close enough to attack
                    const dx = target.x - entity.position.x;
                    const dz = target.z - entity.position.z;
                    const distSq = dx * dx + dz * dz;
                    if (distSq < config.ATTACK_RANGE * config.ATTACK_RANGE) {
                        // COMMIT: Deal damage immediately when entering attack
                        this._performAttack(entity, target, now);
                        entity.state = 'attacking';
                        entity.stateStartTime = now;
                    } else {
                        // Move toward target
                        const moved = this._moveToward(entity, target.x, target.z, config.MOVE_SPEED, deltaTime);

                        // If couldn't move (hit water), stop chasing and return home
                        if (!moved) {
                            entity.state = 'returning';
                            entity.stateStartTime = now;
                            entity.cachedTarget = null;
                            entity.targetLostTime = now;
                            break;
                        }

                        didMove = true;

                        // Play roar periodically while chasing
                        if (now - entity.lastRoarTime >= config.ROAR_INTERVAL) {
                            entity.lastRoarTime = now;
                            this._playRoar(entity);
                        }
                    }
                }
                break;

            case 'attacking':
                // Wait for attack animation to complete before any state changes
                if (entity.controller?.isAttackAnimationPlaying?.()) {
                    break;
                }

                // Animation done - decide next action
                // Structure flee takes priority
                if (entity.cachedStructure) {
                    this._startFleeing(entity, entity.cachedStructure, now);
                    break;
                }

                // After attack, find ANY nearby target (not just validate current one)
                // This allows bear to pursue new targets after killing current one
                const nextTarget = this._findNearestTarget(entity, config.CHASE_RANGE, players);
                entity.cachedTarget = nextTarget;

                if (!nextTarget) {
                    // No targets nearby - return home
                    entity.state = 'returning';
                    entity.stateStartTime = now;
                } else {
                    // Check distance to next target
                    const dx = nextTarget.x - entity.position.x;
                    const dz = nextTarget.z - entity.position.z;
                    const distSq = dx * dx + dz * dz;
                    if (distSq < config.ATTACK_RANGE * config.ATTACK_RANGE) {
                        // In range - attack
                        this._performAttack(entity, nextTarget, now);
                    } else {
                        // Out of range - chase
                        entity.state = 'chasing';
                        entity.stateStartTime = now;
                    }
                }
                break;

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
                    } else {
                        didMove = true;
                    }
                }
                break;
            }

            case 'returning': {
                // FIX: Add 2-second delay before re-engaging targets to prevent oscillation
                const TARGET_REACQUIRE_DELAY = 2000;
                const canReacquire = now - (entity.targetLostTime || 0) >= TARGET_REACQUIRE_DELAY;

                if (target && !isLeashed && canReacquire) {
                    entity.state = 'chasing';
                    entity.stateStartTime = now;
                    // Play roar only if cooldown has elapsed
                    if (now - entity.lastRoarTime >= config.ROAR_INTERVAL) {
                        entity.lastRoarTime = now;
                        this._playRoar(entity);
                    }
                } else if (atHome) {
                    this._startIdle(entity, now);
                } else {
                    // Move toward home at walk speed (not chase speed)
                    const moved = this._moveToward(entity, entity.homePosition.x, entity.homePosition.z, config.WANDER_SPEED, deltaTime);
                    if (moved) {
                        didMove = true;
                    }
                }
                break;
            }
        }

        // Update visual controller state flags based on ACTUAL movement (animation handled by visual's update())
        if (entity.controller) {
            entity.controller.moving = didMove;
            entity.controller.speedRatio = entity.alignmentFactor ?? 1.0;
            entity.controller.isWandering = entity.state === 'wandering' || entity.state === 'returning';
            entity.controller.isAttacking = entity.state === 'attacking';
            entity.controller.isFleeing = entity.state === 'fleeing';
        }

        // Update mesh position
        if (entity.mesh) {
            entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
            entity.mesh.rotation.y = entity.rotation;
        }
    }

    /**
     * Sync visual animation flags based on entity state
     * Called when model loads after entity was already created
     */
    _syncVisualFlags(entity) {
        if (!entity.controller) return;

        // Start with moving = false; actual movement will be determined on next frame update
        entity.controller.moving = false;
        entity.controller.speedRatio = 1.0;
        entity.controller.isWandering = entity.state === 'wandering' || entity.state === 'returning';
        entity.controller.isAttacking = entity.state === 'attacking';
        entity.controller.isFleeing = entity.state === 'fleeing';

        // If already dead, trigger death animation
        if (entity.state === 'dead' && !entity.controller.isDead) {
            entity.controller.kill();
        }
    }

    // =========================================================================
    // INTERPOLATION (NON-AUTHORITY)
    // =========================================================================

    _interpolateEntity(entity, deltaTime) {
        if (!entity.targetPosition) return;

        const config = AI_CONFIG.BROWN_BEAR;
        const dx = entity.targetPosition.x - entity.position.x;
        const dz = entity.targetPosition.z - entity.position.z;
        const distSq = dx * dx + dz * dz;

        // Thresholds for smooth interpolation
        const TELEPORT_THRESHOLD_SQ = 100;   // 10^2 units - major desync recovery
        const SNAP_THRESHOLD_SQ = 0.0025;    // 0.05^2 units - close enough to snap
        const CATCHUP_THRESHOLD_SQ = 1.0;    // 1^2 units - speed up if falling behind

        let isMoving = false;

        if (distSq > TELEPORT_THRESHOLD_SQ) {
            // Teleport XZ if too far - major desync recovery
            entity.position.x = entity.targetPosition.x;
            entity.position.z = entity.targetPosition.z;
        } else if (distSq < SNAP_THRESHOLD_SQ) {
            // Snap to target if very close
            entity.position.x = entity.targetPosition.x;
            entity.position.z = entity.targetPosition.z;
        } else {
            // Velocity-based movement toward target
            isMoving = true;
            const dist = Math.sqrt(distSq);
            const dirX = dx / dist;
            const dirZ = dz / dist;

            // Select speed based on state
            let baseSpeed;
            switch (entity.state) {
                case 'wandering':
                    baseSpeed = config.WANDER_SPEED;
                    break;
                case 'fleeing':
                    baseSpeed = config.FLEE_SPEED;
                    break;
                case 'chasing':
                case 'returning':
                    baseSpeed = config.MOVE_SPEED;
                    break;
                default:
                    baseSpeed = config.MOVE_SPEED;
            }

            // Apply catch-up multiplier if falling behind (> 1 unit)
            const catchUpMultiplier = distSq > CATCHUP_THRESHOLD_SQ ? 1.5 : 1.0;
            const speed = baseSpeed * catchUpMultiplier;

            const moveDist = Math.min(speed * (deltaTime / 1000), dist);

            entity.position.x += dirX * moveDist;
            entity.position.z += dirZ * moveDist;
        }

        // Y position - sample terrain at current XZ (same as authority)
        if (this.getTerrainHeight) {
            const targetY = this.getTerrainHeight(entity.position.x, entity.position.z);
            // Smooth lerp for Y with deltaTime
            const yLerpFactor = Math.min(1.0, 8.0 * (deltaTime / 1000));
            entity.position.y += (targetY - entity.position.y) * yLerpFactor;
        }

        // Calculate target rotation - face movement direction when moving, use synced when stationary
        let targetRotation;
        if (isMoving) {
            targetRotation = Math.atan2(dx, dz);
        } else if (entity.targetRotation !== null) {
            targetRotation = entity.targetRotation;
        } else {
            targetRotation = entity.rotation;
        }

        // Smoothly interpolate rotation using same turn speed as authority
        let rotDiff = targetRotation - entity.rotation;
        while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
        while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;

        const maxRotation = config.TURN_SPEED * (deltaTime / 1000);
        if (Math.abs(rotDiff) > maxRotation) {
            rotDiff = Math.sign(rotDiff) * maxRotation;
        }
        entity.rotation += rotDiff;

        // Update mesh
        if (entity.mesh) {
            entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
            entity.mesh.rotation.y = entity.rotation;
        }

        // Update animation based on ACTUAL movement (not just state)
        if (entity.controller) {
            entity.controller.moving = isMoving;
            entity.controller.speedRatio = isMoving ? 1.0 : 0;
            entity.controller.isWandering = entity.state === 'wandering' || entity.state === 'returning';
            entity.controller.isAttacking = entity.state === 'attacking';
            entity.controller.isFleeing = entity.state === 'fleeing';
        }
    }

    // =========================================================================
    // SPAWNING
    // =========================================================================

    /**
     * Update den presence cache - call on chunk change
     * Sets _hasDensInRange flag for spawn early-out optimization
     */
    updateDenPresence(chunkX, chunkZ, force = false) {
        // Skip if same chunk (unless forced)
        if (!force && chunkX === this._lastCheckedChunkX && chunkZ === this._lastCheckedChunkZ) {
            return;
        }

        this._lastCheckedChunkX = chunkX;
        this._lastCheckedChunkZ = chunkZ;
        this._hasDensInRange = false;

        // Check 3x3 grid for any dens
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = `${chunkX + dx},${chunkZ + dz}`;
                const dens = this.getBrownBearStructures(key);
                if (dens && dens.length > 0) {
                    this._hasDensInRange = true;
                    return;
                }
            }
        }
    }

    checkSpawnsOnTick(chunkX, chunkZ) {
        // Always refresh den presence to catch newly registered structures
        // (Fixes timing issue where structures are queued during initial load)
        this.updateDenPresence(chunkX, chunkZ, true);  // Bug 3 Fix: force=true

        // Early-out if no dens nearby
        if (!this._hasDensInRange) return;

        const config = AI_CONFIG.BROWN_BEAR;
        const spawnRangeSq = config.SPAWN_RANGE * config.SPAWN_RANGE;

        // Get my position
        const myPos = this.getPlayerPosition(this.clientId);
        if (!myPos) return;

        // Get players once for all dens
        const chunkKeys = this._get3x3ChunkKeys(chunkX, chunkZ);
        const playerIds = this.getPlayersInChunks(chunkKeys);

        // Pre-fetch all player positions
        const playerPositions = new Map();
        playerPositions.set(this.clientId, myPos);
        if (playerIds) {
            for (const playerId of playerIds) {
                if (playerId !== this.clientId) {
                    const pos = this.getPlayerPosition(playerId);
                    if (pos) playerPositions.set(playerId, pos);
                }
            }
        }

        // Collect all unspawned dens from 3x3 grid (reuse array)
        // 60-minute respawn cooldown: skip dens with recent bearDeathTime
        const RESPAWN_COOLDOWN_MS = 60 * 60 * 1000;
        this._collectedDens.length = 0;
        for (const key of chunkKeys) {
            const dens = this.getBrownBearStructures(key);
            if (dens) {
                for (const den of dens) {
                    if (this.entities.has(den.id)) continue;
                    // Check 60-minute respawn cooldown
                    if (den.bearDeathTime) {
                        const elapsed = Date.now() - den.bearDeathTime;
                        if (elapsed < RESPAWN_COOLDOWN_MS) {
                            continue; // Still on cooldown
                        }
                    }
                    this._collectedDens.push(den);
                }
            }
        }

        // Process ONE den per tick (spreads work over multiple ticks)
        if (this._collectedDens.length === 0) return;
        this._denCheckIndex = this._denCheckIndex % this._collectedDens.length;
        const den = this._collectedDens[this._denCheckIndex];
        this._denCheckIndex++;

        const denX = den.position.x;
        const denZ = den.position.z;

        // Check if I'm in range
        const dxMe = myPos.x - denX;
        const dzMe = myPos.z - denZ;
        if (dxMe * dxMe + dzMe * dzMe >= spawnRangeSq) return;

        // Find authority: lowest clientId in range
        let authorityId = this.clientId;

        for (const [playerId, pos] of playerPositions) {
            if (playerId === this.clientId) continue;

            const dxP = pos.x - denX;
            const dzP = pos.z - denZ;
            if (dxP * dxP + dzP * dzP < spawnRangeSq) {
                if (playerId < authorityId) {
                    authorityId = playerId;
                }
            }
        }

        if (authorityId === this.clientId) {
            // Skip spawn if at authority cap - let another peer handle it
            if (this.getAuthorityCount() >= CONFIG.AI_AUTHORITY.SOFT_CAP) {
                return;
            }
            // Queue spawn instead of immediate spawn to prevent frame stutter
            const spawnQueue = getAISpawnQueue();
            if (!spawnQueue.isQueued('brownbear', den.id)) {
                spawnQueue.queueSpawn('brownbear', { den }, den.id);
            }
        }
    }

    _spawnBrownBear(den) {
        const now = Date.now();

        // Spawn position near den
        const spawnRadius = 2.5;
        const angle = Math.random() * Math.PI * 2;
        const spawnX = den.position.x + Math.cos(angle) * spawnRadius;
        const spawnZ = den.position.z + Math.sin(angle) * spawnRadius;
        const spawnY = this.getTerrainHeight(spawnX, spawnZ);

        const entity = {
            // Identity
            denId: den.id,
            type: 'brownbear',
            authorityId: this.clientId,
            authorityTerm: 1,  // Heartbeat: increments on authority takeover
            spawnedBy: this.clientId,
            spawnTime: now,

            // Position
            homePosition: { x: den.position.x, z: den.position.z },
            position: { x: spawnX, y: spawnY, z: spawnZ },
            rotation: 0,

            // State
            state: 'idle',
            stateStartTime: now,
            target: null,
            cachedTarget: null,  // Full target object for throttled validation
            chaseTargetType: null,  // 'player', 'bandit', or 'deer'
            wanderDirection: null,
            fleeDirection: null,

            // Structure detection cache
            cachedStructure: null,
            lastDetectionCheck: 0,

            // Melee combat
            attackCount: 0,
            lastAttackTime: 0,

            // Sound
            lastRoarTime: 0,

            // Target tracking (anti-oscillation)
            targetLostTime: 0,

            // Visual (controller is the BrownBearVisual instance)
            mesh: null,
            controller: null,

            // Interpolation
            targetPosition: null,
            targetRotation: null,

            // Frame offset for staggered checks (computed once from ID)
            _frameOffset: (den.id.charCodeAt(0) + (den.id.charCodeAt(5) || 0)) % 60,
        };

        // Create visual
        const visual = this.createVisual(den.id, entity.position);
        if (visual) {
            entity.controller = visual;
            entity.mesh = visual.mesh;
        }

        this.entities.set(den.id, entity);

        // Register name tag
        if (this.game?.nameTagManager && entity.mesh) {
            this.game.nameTagManager.registerEntity(`brownbear_${den.id}`, 'Brown Bear', entity.mesh);
        }

        // Broadcast spawn
        this.broadcastP2P({
            type: 'brownbear_spawn',
            denId: den.id,
            spawnedBy: this.clientId,
            spawnTime: now,
            position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
            homePosition: { x: den.position.x, z: den.position.z },
        });
    }

    handleSpawnMessage(data) {
        const {
            denId, spawnedBy, spawnTime, position, homePosition,
            state, authorityTerm, target, chaseTargetType, wanderDirection, fleeDirection, isHarvested
        } = data;

        // Skip if already exists
        if (this.entities.has(denId)) {
            const existing = this.entities.get(denId);

            // Lowest clientId wins conflicts
            if (spawnedBy < existing.spawnedBy) {
                this._destroyEntity(denId);
            } else {
                return;
            }
        }

        const entity = {
            denId,
            type: 'brownbear',
            authorityId: spawnedBy,
            authorityTerm: authorityTerm || 1,
            spawnedBy,
            spawnTime,

            homePosition: { x: homePosition.x, z: homePosition.z },
            position: { x: position.x, y: position.y, z: position.z },
            rotation: 0,

            state: state || 'idle',
            stateStartTime: Date.now(),
            target: target || null,
            cachedTarget: null,
            chaseTargetType: chaseTargetType || null,
            wanderDirection: wanderDirection || null,
            fleeDirection: fleeDirection || null,

            isHarvested: isHarvested || false,

            cachedStructure: null,
            lastDetectionCheck: 0,

            attackCount: 0,
            lastAttackTime: 0,

            lastRoarTime: 0,

            // Target tracking (anti-oscillation)
            targetLostTime: 0,

            mesh: null,
            controller: null,

            targetPosition: { x: position.x, y: position.y, z: position.z },
            targetRotation: 0,

            // Frame offset for staggered checks (computed once from ID)
            _frameOffset: (denId.charCodeAt(0) + (denId.charCodeAt(5) || 0)) % 60,
        };

        const visual = this.createVisual(denId, entity.position);
        if (visual) {
            entity.controller = visual;
            entity.mesh = visual.mesh;
        }

        this.entities.set(denId, entity);

        // Check pending deaths (race condition: death message before spawn)
        this._checkPendingDeaths(denId);

        // Check pending states
        if (this.pendingStates.has(denId)) {
            const pending = this.pendingStates.get(denId);
            entity.targetPosition = { ...pending.position };
            entity.targetRotation = pending.rotation;
            if (pending.state && pending.state !== entity.state) {
                entity.state = pending.state;
                entity.stateStartTime = Date.now();
            }
            if (pending.authorityId) {
                entity.authorityId = pending.authorityId;
            }
            this.pendingStates.delete(denId);
        }

        // Handle dead state from sync data
        if (entity.state === 'dead') {
            if (entity.controller?.kill) {
                entity.controller.kill();
            }
            // Schedule visual cleanup after death animation (2 minutes for harvesting)
            setTimeout(() => {
                this._destroyVisualOnly(denId);
            }, 120000);
        }

        // Handle already-harvested corpse
        if (entity.isHarvested) {
            if (this.game?.nameTagManager) {
                this.game.nameTagManager.unregisterEntity(`brownbear_${denId}`);
            }
            if (entity.mesh && this.destroyVisual) {
                this.destroyVisual(denId, entity.mesh);
                entity.mesh = null;
            }
            return;
        }

        // Register name tag
        if (this.game?.nameTagManager && entity.mesh) {
            this.game.nameTagManager.registerEntity(`brownbear_${denId}`, 'Brown Bear', entity.mesh);
            if (entity.state === 'dead') {
                this.game.nameTagManager.setEntityDead(`brownbear_${denId}`);
            }
        }
    }

    /**
     * Destroy visual only but keep entity in map to prevent respawn
     */
    _destroyVisualOnly(denId) {
        const entity = this.entities.get(denId);
        if (!entity) return;

        // Cleanup name tag
        if (this.game?.nameTagManager) {
            this.game.nameTagManager.unregisterEntity(`brownbear_${denId}`);
        }

        if (entity.mesh) {
            this.destroyVisual(denId, entity.mesh);
        }

        // Clear references but keep entity in map to prevent respawn
        entity.mesh = null;
        entity.controller = null;
    }

    /**
     * Destroy entity completely (removes from map, allows respawn)
     * Used for chunk unload cleanup
     */
    _destroyEntity(denId) {
        this._destroyVisualOnly(denId);
        this.entities.delete(denId);
    }

    // =========================================================================
    // HEARTBEAT AUTHORITY SYSTEM
    // =========================================================================

    /**
     * Calculate authority for an entity (lowest active clientId in range)
     */
    _calculateAuthority(denId) {
        const entity = this.entities.get(denId);
        if (!entity) return null;

        const homeChunkX = ChunkCoordinates.worldToChunk(entity.homePosition.x);
        const homeChunkZ = ChunkCoordinates.worldToChunk(entity.homePosition.z);

        // Get players in 3x3 chunk area around home
        const chunkKeys = this._get3x3ChunkKeys(homeChunkX, homeChunkZ);
        const players = this.getPlayersInChunks(chunkKeys);

        if (!players || players.size === 0) return null;

        // Find lowest clientId among active players
        let lowestId = null;
        for (const playerId of players) {
            // Heartbeat: skip stale players
            if (this.isPlayerActive && !this.isPlayerActive(playerId)) continue;

            if (lowestId === null || playerId < lowestId) {
                lowestId = playerId;
            }
        }
        return lowestId;
    }

    /**
     * Check for stale authorities and reclaim if needed (Heartbeat system)
     */
    _checkStaleAuthorities() {
        if (!this.isPlayerActive) return;

        for (const [entityId, entity] of this.entities) {
            // Skip if I'm already authority or entity is dead
            if (entity.authorityId === this.clientId) continue;
            if (entity.state === 'dead') continue;

            // Check 1: Reclaim from inactive authority
            if (!this.isPlayerActive(entity.authorityId)) {
                // Deterministic: only the lowest active clientId claims authority
                const newAuthority = this._calculateAuthority(entityId);
                if (newAuthority === this.clientId) {
                    this._claimAuthority(entityId, entity);
                }
                // Clear legacy pending flag
                entity._pendingAuthorityCheck = false;
            }
            // Check 2: Reclaim from wrong-but-active authority
            // This fixes a race condition where authority incorrectly transfers
            // to a higher-clientId player due to transient network issues
            else if (entity.authorityId > this.clientId) {
                const newAuthority = this._calculateAuthority(entityId);
                if (newAuthority === this.clientId) {
                    this._claimAuthority(entityId, entity);
                }
            }
        }
    }

    /**
     * Claim authority over an entity (Heartbeat system)
     */
    _claimAuthority(entityId, entity) {
        const newAuthority = this._calculateAuthority(entityId);
        if (newAuthority === this.clientId) {
            // Take over authority with incremented term
            entity.authorityId = this.clientId;
            entity.authorityTerm = (entity.authorityTerm || 0) + 1;

            // Snap position to last known and broadcast immediately
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
            this._broadcastState(entity);
        }
    }

    /**
     * Handle new peer joining a chunk - recalculate authority for nearby entities
     * Called when a peer's first position is received
     * @param {string} peerId - The new peer's ID
     * @param {string} chunkKey - The chunk the peer joined
     */
    onPeerJoinedChunk(peerId, chunkKey) {
        const [peerChunkX, peerChunkZ] = chunkKey.split(',').map(Number);

        for (const [denId, entity] of this.entities) {
            // Check if peer is in 3x3 area around entity's home position
            const homeChunkX = ChunkCoordinates.worldToChunk(entity.homePosition.x);
            const homeChunkZ = ChunkCoordinates.worldToChunk(entity.homePosition.z);
            const dx = Math.abs(peerChunkX - homeChunkX);
            const dz = Math.abs(peerChunkZ - homeChunkZ);

            if (dx <= 1 && dz <= 1) {
                // Peer is near this entity - recalculate authority
                const newAuthority = this._calculateAuthority(denId);
                if (newAuthority && newAuthority !== entity.authorityId) {
                    const wasMe = entity.authorityId === this.clientId;
                    const isNowMe = newAuthority === this.clientId;
                    entity.authorityId = newAuthority;

                    // If we gained authority, snap position and broadcast immediately
                    if (isNowMe && !wasMe) {
                        if (entity.targetPosition) {
                            entity.position.x = entity.targetPosition.x;
                            entity.position.y = entity.targetPosition.y;
                            entity.position.z = entity.targetPosition.z;
                        }
                        if (entity.mesh) {
                            entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
                        }
                        this._broadcastState(entity);
                    }
                }
            }
        }
    }

    // =========================================================================
    // P2P SYNC
    // =========================================================================

    /**
     * Broadcast state for all entities we're authority over
     * Called on server tick from MessageRouter
     */
    broadcastAuthorityState() {
        // Heartbeat: check for stale authorities before broadcasting
        this._checkStaleAuthorities();

        for (const [denId, entity] of this.entities) {
            if (entity.authorityId !== this.clientId) continue;
            if (entity.state === 'dead') continue;
            this._broadcastState(entity);
        }
    }

    _broadcastState(entity) {
        const msg = this._broadcastMsg;
        msg.type = 'brownbear_state';
        msg.denId = entity.denId;
        msg.authorityId = entity.authorityId;
        msg.authorityTerm = entity.authorityTerm || 1;
        msg.position.x = entity.position.x;
        msg.position.y = entity.position.y;
        msg.position.z = entity.position.z;
        msg.rotation = entity.rotation;
        msg.state = entity.state;
        msg.target = entity.target;
        msg.chaseTargetType = entity.chaseTargetType;
        msg.homePosition.x = entity.homePosition.x;
        msg.homePosition.z = entity.homePosition.z;
        msg.wanderDirection = entity.wanderDirection || null;
        msg.fleeDirection = entity.fleeDirection || null;
        this.broadcastP2P(msg);
    }

    handleStateMessage(data) {
        const { denId, authorityId, authorityTerm, position, rotation, state, target, chaseTargetType, wanderDirection, fleeDirection, homePosition } = data;

        const entity = this.entities.get(denId);
        if (!entity) {
            // Entity doesn't exist yet - store pending state for when it spawns
            // This handles race condition where state arrives before spawn message
            this.pendingStates.set(denId, { position, rotation, state, authorityId, authorityTerm, target, chaseTargetType, wanderDirection, fleeDirection, homePosition, _timestamp: Date.now() });
            return;
        }

        // Heartbeat: Term-based authority resolution
        const remoteTerm = authorityTerm || 0;
        const localTerm = entity.authorityTerm || 0;
        const remoteAuthority = authorityId || data.senderId;

        if (remoteTerm > localTerm) {
            // Remote has higher term - they win unconditionally
            entity.authorityTerm = remoteTerm;
            entity.authorityId = remoteAuthority;
        } else if (remoteTerm === localTerm && remoteAuthority && remoteAuthority !== entity.authorityId) {
            // Same term, different authority claim - lowest clientId wins (tie-breaker)
            if (remoteAuthority < entity.authorityId) {
                entity.authorityId = remoteAuthority;
            }
        }

        // Ignore state updates if we're authority
        if (entity.authorityId === this.clientId) return;

        // Store for interpolation
        entity.targetPosition = { x: position.x, y: position.y, z: position.z };
        entity.targetRotation = rotation;
        entity.state = state;
        entity.target = target;
        entity.chaseTargetType = chaseTargetType || null;

        // Store wander direction
        if (wanderDirection) {
            entity.wanderDirection = { x: wanderDirection.x, z: wanderDirection.z };
        } else {
            entity.wanderDirection = null;
        }

        // Store flee direction
        if (fleeDirection) {
            entity.fleeDirection = { x: fleeDirection.x, z: fleeDirection.z };
        } else {
            entity.fleeDirection = null;
        }

        // Update visual controller flags (animation handled by visual's update())
        if (entity.controller) {
            entity.controller.moving = state === 'chasing' || state === 'returning' || state === 'wandering' || state === 'fleeing';
            entity.controller.speedRatio = 1.0;
            entity.controller.isWandering = state === 'wandering' || state === 'returning';
            entity.controller.isAttacking = state === 'attacking';
            entity.controller.isFleeing = state === 'fleeing';
        }
    }

    handleAttackMessage(data) {
        const { denId, targetId, targetType, position } = data;

        // Handle attack based on target type
        switch (targetType) {
            case 'player':
                // Deal damage to player via callback
                if (this.onAttack) {
                    this.onAttack(denId, targetId, position);
                }
                break;

            case 'deer':
                // Kill deer via registry
                this.registry?.killEntity('deer', targetId, denId);
                break;

            case 'bandit':
                // Kill bandit via registry
                this.registry?.killEntity('bandit', targetId, denId);
                break;

            default:
                // Fallback for old messages without targetType
                if (this.onAttack) {
                    this.onAttack(denId, targetId, position);
                }
        }
    }

    // =========================================================================
    // DEATH HANDLING
    // =========================================================================

    /**
     * Kill an entity (called when player kills the bear)
     */
    killEntity(denId, killedBy) {
        const entity = this.entities.get(denId);
        if (!entity || entity.state === 'dead') return;

        entity.state = 'dead';

        // Update name tag to show (DEAD)
        if (this.game?.nameTagManager) {
            this.game.nameTagManager.setEntityDead(`brownbear_${denId}`);
        }

        // Trigger death animation on visual controller
        if (entity.controller?.kill) {
            entity.controller.kill();
        }

        // Broadcast death to peers
        this.broadcastP2P({
            type: 'brownbear_death',
            denId: denId,
            killedBy: killedBy
        });

        // Send to server for persistent tracking (60-minute respawn cooldown)
        if (this.game?.networkManager) {
            const chunkX = ChunkCoordinates.worldToChunk(entity.homePosition.x);
            const chunkZ = ChunkCoordinates.worldToChunk(entity.homePosition.z);
            this.game.networkManager.sendMessage('bear_death', {
                denId: denId,
                chunkId: `chunk_${chunkX},${chunkZ}`
            });
        }

        // Schedule visual cleanup after death animation (2 minutes for harvesting)
        // Entity stays in map to prevent respawn until chunk unloads
        setTimeout(() => {
            this._destroyVisualOnly(denId);
        }, 120000);
    }

    handleDeathMessage(data) {
        const { denId } = data;

        const entity = this.entities.get(denId);
        if (!entity) {
            // Entity doesn't exist yet - store pending death for when it spawns
            // This handles race condition where death message arrives before spawn
            this.pendingDeaths.set(denId, {});
            return;
        }
        if (entity.state === 'dead') return;

        this._applyDeath(entity, {});
    }

    /**
     * Apply death state to entity (required by BaseAIController._checkPendingDeaths)
     * @param {Object} entity
     * @param {Object} deathData - Currently unused for brown bears but required by interface
     */
    _applyDeath(entity, deathData) {
        if (!entity || entity.state === 'dead') return;

        entity.state = 'dead';

        // Update name tag to show (DEAD)
        if (this.game?.nameTagManager) {
            this.game.nameTagManager.setEntityDead(`brownbear_${entity.denId}`);
        }

        // Trigger death animation on visual controller
        if (entity.controller?.kill) {
            entity.controller.kill();
        }

        // Schedule visual cleanup after death animation (2 minutes for harvesting)
        // Entity stays in map to prevent respawn until chunk unloads
        setTimeout(() => {
            this._destroyVisualOnly(entity.denId);
        }, 120000);
    }

    // =========================================================================
    // HARVESTING
    // =========================================================================

    /**
     * Harvest a dead brownbear corpse
     * @param {string} denId - The bear's den ID
     * @returns {boolean} - True if harvested successfully
     */
    harvestBrownbear(denId) {
        const entity = this.entities.get(denId);
        if (!entity || entity.state !== 'dead' || entity.isHarvested) {
            return false;
        }

        entity.isHarvested = true;

        // Unregister name tag
        if (this.game?.nameTagManager) {
            this.game.nameTagManager.unregisterEntity(`brownbear_${denId}`);
        }

        // Destroy visual
        if (entity.mesh && this.destroyVisual) {
            this.destroyVisual(denId, entity.mesh);
            entity.mesh = null;
        }

        // Keep entity in map to prevent respawn (like bandits)
        // Entity will be cleaned up on chunk unload

        // Broadcast to peers
        if (this.broadcastP2P) {
            this.broadcastP2P({
                type: 'brownbear_harvested',
                denId: denId
            });
        }

        return true;
    }

    /**
     * Handle harvest message from peer
     * @param {object} data - { denId }
     */
    handleHarvestMessage(data) {
        const { denId } = data;
        const entity = this.entities.get(denId);
        if (!entity) return;

        entity.isHarvested = true;

        // Unregister name tag
        if (this.game?.nameTagManager) {
            this.game.nameTagManager.unregisterEntity(`brownbear_${denId}`);
        }

        // Destroy visual
        if (entity.mesh && this.destroyVisual) {
            this.destroyVisual(denId, entity.mesh);
            entity.mesh = null;
        }

        // Keep entity in map to prevent respawn (like bandits)
        // Entity will be cleaned up on chunk unload
    }

    // =========================================================================
    // PEER SYNC
    // =========================================================================

    getActiveEntitiesForSync() {
        const result = [];
        for (const [denId, entity] of this.entities) {
            result.push({
                denId,
                position: { ...entity.position },
                rotation: entity.rotation,
                state: entity.state,
                authorityId: entity.authorityId,
                authorityTerm: entity.authorityTerm || 1,
                spawnedBy: entity.spawnedBy || entity.authorityId,
                homePosition: { x: entity.homePosition.x, z: entity.homePosition.z },
                target: entity.target,
                chaseTargetType: entity.chaseTargetType,
                wanderDirection: entity.wanderDirection,
                fleeDirection: entity.fleeDirection,
                isHarvested: entity.isHarvested || false,
            });
        }
        return result;
    }

    // Backward compatibility aliases
    getActiveBrownBearsForSync() {
        return this.getActiveEntitiesForSync();
    }

    syncBrownBearsFromPeer(bearList) {
        this.syncEntitiesFromPeer(bearList);
    }

    /**
     * Get the nearest harvestable dead brownbear
     * @param {number} playerX - Player X position
     * @param {number} playerZ - Player Z position
     * @returns {object|null} - { denId, position, distance, chunkX, chunkZ } or null
     */
    getNearestHarvestableBrownbear(playerX, playerZ) {
        let nearest = null;
        let nearestDistSq = AI_CONFIG.BROWN_BEAR.HARVEST_RANGE * AI_CONFIG.BROWN_BEAR.HARVEST_RANGE;

        for (const [denId, entity] of this.entities) {
            // Must be dead, not harvested, and have a mesh
            if (entity.state !== 'dead' || entity.isHarvested || !entity.mesh) continue;

            const dx = entity.position.x - playerX;
            const dz = entity.position.z - playerZ;
            const distSq = dx * dx + dz * dz;

            if (distSq < nearestDistSq) {
                nearestDistSq = distSq;
                const chunkX = Math.floor(entity.position.x / AI_CONFIG.BROWN_BEAR.CHUNK_SIZE);
                const chunkZ = Math.floor(entity.position.z / AI_CONFIG.BROWN_BEAR.CHUNK_SIZE);
                nearest = {
                    denId,
                    position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
                    distance: Math.sqrt(distSq),
                    chunkX,
                    chunkZ
                };
            }
        }
        return nearest;
    }

    // =========================================================================
    // CHUNK LIFECYCLE
    // =========================================================================

    /**
     * Called when a chunk is unloaded - clean up entities in that chunk
     */
    onChunkUnloaded(chunkKey) {
        for (const [denId, entity] of this.entities) {
            const entityChunkX = Math.floor(entity.homePosition.x / AI_CONFIG.BROWN_BEAR.CHUNK_SIZE);
            const entityChunkZ = Math.floor(entity.homePosition.z / AI_CONFIG.BROWN_BEAR.CHUNK_SIZE);
            const entityChunkKey = `${entityChunkX},${entityChunkZ}`;

            if (entityChunkKey === chunkKey) {
                this._destroyEntity(denId);
            }
        }
    }
}

export { AI_CONFIG };

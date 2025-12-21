/**
 * AIController.js
 * Modular AI system with authority-based multiplayer sync
 *
 * Architecture:
 * - One authority client simulates each AI entity
 * - Authority broadcasts state; non-authority interpolates
 * - Authority determined by lowest clientId near AI's home
 *
 * Integration points:
 * - GameInitializer.js: initialize() with callbacks
 * - game.js: update() every frame
 * - MessageRouter.js: checkSpawnsOnTick() on server tick
 * - GameStateManager.js: P2P message handlers
 * - NetworkManager.js: peer connect/disconnect hooks
 */

import { BaseAIController } from './BaseAIController.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const AI_CONFIG = {
    // Shared across all AI types
    CHUNK_SIZE: 50,
    
    // Bandit-specific
    BANDIT: {
        // Spawning
        SPAWN_RANGE: 50,           // Distance from tent to trigger spawn
        
        // Movement
        MOVE_SPEED: 1.0,           // Units per second
        CHASE_RANGE: 30,           // Distance to detect/chase players
        LEASH_RANGE: 30,           // Max distance from home tent
        PATHFIND_INTERVAL: 6000,   // Recalculate path every 6 seconds
        
        // Combat
        ENGAGEMENT_DISTANCE: 8,    // Stop moving, start shooting
        SHOOT_RANGE_MIN: 10,
        SHOOT_RANGE_MAX: 15,
        SHOOT_RANGE_HEIGHT_BONUS: 2.5,  // 2 units height = max range (5 bonus / 2 = 2.5 per unit)
        HIT_CHANCE_MIN: 0.35,
        HIT_CHANCE_MAX: 0.8,
        HIT_CHANCE_HEIGHT_BONUS: 0.15,
        POINT_BLANK_RANGE: 4,      // 100% hit chance at 0 distance
        FIRST_SHOT_DELAY: 3000,    // Wait before first shot after spawn
        SHOOT_INTERVAL: 6000,      // Time between shots
        
        // Performance
        IDLE_CHECK_INTERVAL: 30,   // Frames between target checks when idle
    },
};

// =============================================================================
// AI CONTROLLER CLASS
// =============================================================================

export class AIController extends BaseAIController {
    constructor() {
        super({
            entityType: 'bandit',
            entityIdField: 'tentId',
            messagePrefix: 'bandit',
            broadcastInterval: 1000,
        });

        // State (entities Map inherited from BaseAIController)
        this._frameCount = 0;

        // Callbacks (set via initialize) - some inherited from BaseAIController
        this.getPlayersInChunks = null;
        this.getPlayerPosition = null;
        this.getBanditStructures = null;
        this.getTerrainHeight = null;
        this.isOnRoad = null;
        this.isWalkable = null;
        this.findPath = null;
        this.createVisual = null;
        this.destroyVisual = null;
        this.broadcastP2P = null;
        this.onShoot = null;
        this.isPlayerDead = null;
        this.tickManager = null;
        
        // Spawn optimization (Phase 1)
        this._hasTentsInRange = false;
        this._lastCheckedChunkX = null;
        this._lastCheckedChunkZ = null;
        
        // Performance caches
        this._playerListCache = [];
        this._playerObjectPool = [];
        this._candidatesCache = [];
        this._candidateObjectPool = [];
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    /**
     * Initialize with game callbacks
     * @param {object} config - Configuration with callbacks
     */
    initialize(config) {
        const required = [
            'clientId',
            'getPlayersInChunks',
            'getPlayerPosition',
            'getBanditStructures',
            'getTerrainHeight',
            'findPath',
            'createVisual',
            'destroyVisual',
            'broadcastP2P',
            'onShoot',
            'isPlayerDead',
        ];
        
        for (const key of required) {
            if (config[key] === undefined) {
                console.error(`[AIController] Missing required config: ${key}`);
            }
            this[key] = config[key];
        }
        
        // Optional
        this.isOnRoad = config.isOnRoad || null;
        this.isWalkable = config.isWalkable || null;
        this.tickManager = config.tickManager || null;

        // Optional: game reference for name tags
        if (config.game) {
            this.game = config.game;
        }
    }

    // =========================================================================
    // SPAWN OPTIMIZATION (Phase 1)
    // =========================================================================

    /**
     * Update tent presence cache when player changes chunk
     * @param {number} chunkX - Player's current chunk X
     * @param {number} chunkZ - Player's current chunk Z
     */
    updateTentPresence(chunkX, chunkZ, force = false) {
        // Skip if same chunk (unless forced)
        if (!force && chunkX === this._lastCheckedChunkX && chunkZ === this._lastCheckedChunkZ) {
            return;
        }

        this._lastCheckedChunkX = chunkX;
        this._lastCheckedChunkZ = chunkZ;
        this._hasTentsInRange = false;

        // Check 3x3 grid for any bandit structures
        let totalTents = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = `${chunkX + dx},${chunkZ + dz}`;
                const structures = this.getBanditStructures(key);
                if (structures && structures.length > 0) {
                    totalTents += structures.length;
                    this._hasTentsInRange = true;
                }
            }
        }
    }

    /**
     * Check spawns on server tick (called from MessageRouter.handleTick)
     * Only runs if tents are in range (early-out optimization)
     * @param {number} chunkX - Player's current chunk X
     * @param {number} chunkZ - Player's current chunk Z
     */
    checkSpawnsOnTick(chunkX, chunkZ) {
        // Early-out if no tents nearby
        if (!this._hasTentsInRange) return;
        
        const SPAWN_RANGE = AI_CONFIG.BANDIT.SPAWN_RANGE;
        const spawnRangeSq = SPAWN_RANGE * SPAWN_RANGE;
        
        // Get my position
        const myPos = this.getPlayerPosition(this.clientId);
        if (!myPos) return;
        
        // Check 3x3 grid
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = `${chunkX + dx},${chunkZ + dz}`;
                const tents = this.getBanditStructures(key);
                if (!tents) continue;
                
                for (const tent of tents) {
                    // Skip if already spawned
                    if (this.entities.has(tent.id)) continue;
                    
                    const tentX = tent.position.x;
                    const tentZ = tent.position.z;
                    
                    // Check if I'm in range
                    const dxMe = myPos.x - tentX;
                    const dzMe = myPos.z - tentZ;
                    if (dxMe * dxMe + dzMe * dzMe >= spawnRangeSq) continue;
                    
                    // Gather all players in range
                    const nearbyIds = [this.clientId];
                    const chunkKeys = this._get3x3ChunkKeys(chunkX, chunkZ);
                    const playerIds = this.getPlayersInChunks(chunkKeys);
                    
                    if (playerIds) {
                        for (const playerId of playerIds) {
                            if (playerId === this.clientId) continue;
                            const pos = this.getPlayerPosition(playerId);
                            if (!pos) continue;
                            
                            const dxP = pos.x - tentX;
                            const dzP = pos.z - tentZ;
                            if (dxP * dxP + dzP * dzP < spawnRangeSq) {
                                nearbyIds.push(playerId);
                            }
                        }
                    }
                    
                    // Authority: lowest clientId spawns (numeric sort, not lexicographic!)
                    nearbyIds.sort((a, b) => parseInt(a) - parseInt(b));
                    if (nearbyIds[0] === this.clientId) {
                        this._spawnBandit(tent);
                    }
                }
            }
        }
    }

    // =========================================================================
    // SPAWNING
    // =========================================================================

    /**
     * Spawn a bandit at a tent (authority only)
     * @param {object} tent - Tent structure {id, position}
     */
    _spawnBandit(tent) {
        const now = Date.now();

        // Try multiple spawn positions around tent to find walkable location
        // Start with random angle, try 8 positions in a circle at 2.5 unit radius
        let spawnX, spawnZ, spawnY;
        const spawnRadius = 2.5; // Far enough to avoid tent collision
        const startAngle = Math.random() * Math.PI * 2;

        for (let attempt = 0; attempt < 8; attempt++) {
            const angle = startAngle + (attempt / 8) * Math.PI * 2;
            const testX = tent.position.x + Math.cos(angle) * spawnRadius;
            const testZ = tent.position.z + Math.sin(angle) * spawnRadius;

            // Check if position is walkable (if isWalkable callback exists)
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

        // Fallback if no walkable position found - use tent center offset
        if (spawnX === undefined) {
            spawnX = tent.position.x + Math.cos(startAngle) * spawnRadius;
            spawnZ = tent.position.z + Math.sin(startAngle) * spawnRadius;
        }

        spawnY = this.getTerrainHeight(spawnX, spawnZ);

        const entity = {
            // Identity
            tentId: tent.id,
            type: 'bandit',
            authorityId: this.clientId,
            spawnedBy: this.clientId,
            spawnTime: now,

            // Position (offset from tent, home is still tent center)
            homePosition: { x: tent.position.x, z: tent.position.z },
            position: { x: spawnX, y: spawnY, z: spawnZ },
            rotation: 0,
            
            // State machine
            state: 'idle',  // idle, chasing, leashed, returning, dead
            target: null,   // playerId being chased
            
            // Pathfinding
            path: [],
            pathIndex: 0,
            lastPathTime: 0,
            
            // Combat
            shotCount: 0,
            lastShotTime: 0,
            pendingKills: new Set(),  // PlayerIds hit, awaiting ACK
            
            // Visual
            mesh: null,
            controller: null,
            
            // Non-authority interpolation
            targetPosition: null,
            targetRotation: null,

            // Debug logging flags (fire once)
            _logged: {
                spawn: false,
                firstTarget: false,
                chasing: false,
                engagement: false,
                firstShotWait: false,
                leashed: false,
                returning: false,
                idle: false,
                dead: false,
            },
        };

        // Create visual
        const visual = this.createVisual(tent.id, entity.position);
        if (visual) {
            entity.mesh = visual.mesh || visual.enemy || visual;
            entity.controller = visual;
        }

        this.entities.set(tent.id, entity);

        // Register name tag for bandit
        if (this.game?.nameTagManager && entity.mesh) {
            this.game.nameTagManager.registerEntity(`bandit_${tent.id}`, 'Bandit', entity.mesh);
        }
        
        // Broadcast spawn
        this.broadcastP2P({
            type: 'bandit_spawn',
            tentId: tent.id,
            spawnedBy: this.clientId,
            spawnTime: now,
            position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
            homePosition: { x: tent.position.x, z: tent.position.z },
        });
        
        console.log(`[Bandit ${tent.id}] #1 SPAWN - Player within 50 units of tent, spawned at (${entity.position.x.toFixed(1)}, ${entity.position.z.toFixed(1)}), initial state: idle`);
        entity._logged.spawn = true;
    }

    /**
     * Handle spawn message from peer
     * @param {object} data - Spawn data
     */
    handleSpawnMessage(data) {
        const { tentId, spawnedBy, spawnTime, position, homePosition } = data;

        // Skip if already exists - use deterministic authority (lowest clientId wins)
        if (this.entities.has(tentId)) {
            const existing = this.entities.get(tentId);

            // Deterministic conflict resolution: lowest clientId always wins
            // This handles the case where both players spawn before P2P connects
            if (spawnedBy < existing.spawnedBy) {
                console.log(`[AIController] Spawn conflict for ${tentId}: ${spawnedBy} wins over ${existing.spawnedBy} (lower clientId)`);
                this._destroyEntity(tentId);
                // Fall through to create from peer's data
            } else if (spawnedBy === existing.spawnedBy) {
                // Same spawner - true duplicate, ignore
                return;
            } else {
                // We have lower clientId, we win - but update authority if needed
                if (existing.authorityId !== existing.spawnedBy) {
                    // Authority may have transferred, recalculate
                    const newAuthority = this._calculateAuthority(tentId);
                    if (newAuthority && newAuthority !== existing.authorityId) {
                        existing.authorityId = newAuthority;
                    }
                }
                return; // Keep our spawn
            }
        }
        
        const entity = {
            tentId,
            type: 'bandit',
            authorityId: spawnedBy,
            spawnedBy,
            spawnTime,
            
            homePosition: { x: homePosition.x, z: homePosition.z },
            position: { ...position },
            rotation: 0,
            
            state: 'idle',
            target: null,
            
            path: [],
            pathIndex: 0,
            lastPathTime: 0,
            
            shotCount: 0,
            lastShotTime: 0,
            pendingKills: new Set(),
            
            mesh: null,
            controller: null,

            targetPosition: null,
            targetRotation: null,

            // Debug logging flags (fire once)
            _logged: {
                spawn: true, // Already spawned by peer
                firstTarget: false,
                chasing: false,
                engagement: false,
                firstShotWait: false,
                leashed: false,
                returning: false,
                idle: false,
                dead: false,
            },
        };

        // Create visual - required for entity to function
        const visual = this.createVisual(tentId, position);
        if (visual) {
            entity.mesh = visual.mesh || visual.enemy || visual;
            entity.controller = visual;
        } else {
            // Visual creation failed - don't add broken entity
            console.warn(`[Bandit ${tentId}] Failed to create visual, skipping spawn`);
            return;
        }

        this.entities.set(tentId, entity);

        // Register name tag for peer-spawned bandit
        if (this.game?.nameTagManager && entity.mesh) {
            this.game.nameTagManager.registerEntity(`bandit_${tentId}`, 'Bandit', entity.mesh);
        }

        console.log(`[Bandit ${tentId}] #1 SPAWN (from peer) - Peer ${spawnedBy} spawned bandit, I am non-authority (interpolating only)`);
    }

    // =========================================================================
    // HELPER METHODS
    // =========================================================================

    // _get3x3ChunkKeys and getEntity inherited from BaseAIController

    /**
     * Get all active entities for sync to new peer
     * @returns {Array}
     */
    getActiveBanditsForSync() {
        const result = [];
        for (const [tentId, entity] of this.entities) {
            result.push({
                tentId,
                spawnedBy: entity.spawnedBy,
                spawnTime: entity.spawnTime,
                position: { ...entity.position },
                homePosition: { ...entity.homePosition },
                state: entity.state,
                shotCount: entity.shotCount,
                authorityId: entity.authorityId,
            });
        }
        return result;
    }

    /**
     * Sync bandits from peer (when joining)
     * @param {Array} bandits
     */
    syncBanditsFromPeer(bandits) {
        for (const data of bandits) {
            if (this.entities.has(data.tentId)) continue;
            
            const home = data.homePosition || { x: data.position.x, z: data.position.z };
            
            const entity = {
                tentId: data.tentId,
                type: 'bandit',
                authorityId: data.authorityId || data.spawnedBy,
                spawnedBy: data.spawnedBy,
                spawnTime: data.spawnTime,
                
                homePosition: { x: home.x, z: home.z },
                position: { ...data.position },
                rotation: 0,
                
                state: data.state || 'idle',
                target: null,
                
                path: [],
                pathIndex: 0,
                lastPathTime: 0,
                
                shotCount: data.shotCount || 0,
                lastShotTime: 0,
                pendingKills: new Set(),
                
                mesh: null,
                controller: null,

                targetPosition: null,
                targetRotation: null,

                // Debug logging flags (fire once)
                _logged: {
                    spawn: true,
                    firstTarget: false,
                    chasing: false,
                    engagement: false,
                    firstShotWait: false,
                    leashed: false,
                    returning: false,
                    idle: false,
                    dead: (data.state === 'dead'),
                },
            };

            // Create visual
            const visual = this.createVisual(data.tentId, entity.position);
            if (visual) {
                entity.mesh = visual.mesh || visual.enemy || visual;
                entity.controller = visual;

                // If dead, trigger death animation
                if (entity.state === 'dead' && entity.controller) {
                    entity.controller.moving = false;
                    if (typeof entity.controller.kill === 'function') {
                        entity.controller.kill();
                    }
                }
            }

            this.entities.set(data.tentId, entity);

            // Register name tag for synced bandit
            if (this.game?.nameTagManager && entity.mesh) {
                this.game.nameTagManager.registerEntity(`bandit_${data.tentId}`, 'Bandit', entity.mesh);
            }
            console.log(`[Bandit ${data.tentId}] SYNC - Synced from peer, state: ${entity.state}, authority: ${entity.authorityId}`);
        }
    }

    // =========================================================================
    // TARGET ACQUISITION
    // =========================================================================

    /**
     * Build list of players in 3x3 chunk grid around position
     * Uses TickManager for deterministic positions when available
     * @param {number} chunkX - Center chunk X
     * @param {number} chunkZ - Center chunk Z
     * @returns {Array} [{id, x, z, y}]
     */
    _buildPlayerList(chunkX, chunkZ) {
        const chunkKeys = this._get3x3ChunkKeys(chunkX, chunkZ);
        
        // Clear cache, reuse array
        this._playerListCache.length = 0;
        let poolIndex = 0;
        
        // Helper to get/create pooled player object
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
        
        // Prefer TickManager for deterministic positions
        if (this.tickManager && this.tickManager.hasSimulationData()) {
            const tickPositions = this.tickManager.getSimulationPositions();

            for (const [playerId, pos] of tickPositions) {
                if (this.isPlayerDead && this.isPlayerDead(playerId)) continue;
                this._playerListCache.push(getPlayerObj(playerId, pos.x, pos.z, pos.y || 0, 'player'));
            }

            // Also add bears when using TickManager (via registry)
            const bearController = this.registry?.get('bear');
            if (bearController?.entities) {
                for (const [chunkKey, bear] of bearController.entities) {
                    if (bear.isDead) continue;
                    const pos = bear.position;
                    this._playerListCache.push(getPlayerObj(chunkKey, pos.x, pos.z, pos.y || 0, 'bear'));
                }
            }

            return this._playerListCache;
        }
        
        // Fallback: live positions
        const playerIds = this.getPlayersInChunks(chunkKeys);
        if (playerIds) {
            for (const playerId of playerIds) {
                if (this.isPlayerDead && this.isPlayerDead(playerId)) continue;
                const pos = this.getPlayerPosition(playerId);
                if (pos) {
                    this._playerListCache.push(getPlayerObj(playerId, pos.x, pos.z, pos.y || 0, 'player'));
                }
            }
        }

        // Add bears as targets (same priority as players) via registry
        const bearCtrl = this.registry?.get('bear');
        if (bearCtrl?.entities) {
            for (const [chunkKey, bear] of bearCtrl.entities) {
                if (bear.isDead) continue;
                const pos = bear.position;
                this._playerListCache.push(getPlayerObj(chunkKey, pos.x, pos.z, pos.y || 0, 'bear'));
            }
        }

        return this._playerListCache;
    }

    /**
     * Find closest player to a position within range
     * Deterministic: ties within 2 units resolved by lowest clientId
     * @param {object} pos - {x, z}
     * @param {number} range - Max distance
     * @param {Array} players - [{id, x, z, y}]
     * @returns {object|null} Closest player or null
     */
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
        
        // Sort near-equal by player id (deterministic)
        if (nearEqualCount > 1) {
            for (let i = 0; i < nearEqualCount - 1; i++) {
                for (let j = i + 1; j < nearEqualCount; j++) {
                    if (this._candidatesCache[j].player.id.localeCompare(this._candidatesCache[i].player.id) < 0) {
                        const temp = this._candidatesCache[i];
                        this._candidatesCache[i] = this._candidatesCache[j];
                        this._candidatesCache[j] = temp;
                    }
                }
            }
        }
        
        return this._candidatesCache[0].player;
    }

    // =========================================================================
    // PATHFINDING
    // =========================================================================

    /**
     * Update pathfinding for an entity
     * Respects leash range - paths to leash edge if target beyond
     * @param {object} entity - Entity state
     * @param {object} target - Target {x, z} or null
     * @param {number} now - Current timestamp
     */
    _updatePathfinding(entity, target, now) {
        const config = AI_CONFIG.BANDIT;
        
        // Only update at interval
        if (now - entity.lastPathTime < config.PATHFIND_INTERVAL) {
            return;
        }
        
        entity.lastPathTime = now;
        
        // Cache road status for movement speed
        if (this.isOnRoad) {
            entity.cachedOnRoad = this.isOnRoad(entity.position.x, entity.position.z);
        }
        
        if (!target) {
            // No target - path home if returning
            if (entity.state === 'returning') {
                const path = this.findPath(
                    entity.position.x, entity.position.z,
                    entity.homePosition.x, entity.homePosition.z
                );
                entity.path = path || [];
                entity.pathIndex = 0;
            }
            return;
        }
        
        // Check leash
        const dxHome = target.x - entity.homePosition.x;
        const dzHome = target.z - entity.homePosition.z;
        const distToHomeSq = dxHome * dxHome + dzHome * dzHome;
        const leashSq = config.LEASH_RANGE * config.LEASH_RANGE;
        
        let goalX = target.x;
        let goalZ = target.z;
        
        if (distToHomeSq > leashSq) {
            // Target beyond leash - path to edge instead
            const dist = Math.sqrt(distToHomeSq);
            const ratio = config.LEASH_RANGE / dist;
            goalX = entity.homePosition.x + dxHome * ratio;
            goalZ = entity.homePosition.z + dzHome * ratio;
        }
        
        const path = this.findPath(
            entity.position.x, entity.position.z,
            goalX, goalZ
        );
        
        entity.path = path || [];
        entity.pathIndex = 0;
    }

    // =========================================================================
    // MOVEMENT
    // =========================================================================

    /**
     * Move entity along its path
     * Handles terrain slope, road speed bonus, leash enforcement
     * @param {object} entity - Entity state
     * @param {number} deltaTime - Time since last frame (ms)
     */
    _moveAlongPath(entity, deltaTime) {
        const config = AI_CONFIG.BANDIT;

        if (!entity.path || entity.path.length === 0) {
            // No path available - stop moving and wait for pathfinding retry
            // Do NOT use direct movement as it bypasses navigation and terrain
            if (entity.controller) {
                entity.controller.moving = false;
            }
            // Allow pathfinding retry after normal interval (6 seconds)
            if (entity.lastPathTime > 0) {
                const timeSinceLastPath = Date.now() - entity.lastPathTime;
                if (timeSinceLastPath > 6000) {
                    entity.lastPathTime = 0; // Reset to trigger retry
                }
            }
            return;
        }
        
        if (entity.pathIndex >= entity.path.length) {
            entity.path = [];
            entity.pathIndex = 0;
            return;
        }
        
        const waypoint = entity.path[entity.pathIndex];
        const dx = waypoint.x - entity.position.x;
        const dz = waypoint.z - entity.position.z;
        const distSq = dx * dx + dz * dz;
        
        // Reached waypoint?
        if (distSq < 0.25) {  // 0.5^2
            entity.pathIndex++;
            return;
        }
        
        const dist = Math.sqrt(distSq);
        
        // Initialize terrain frame counter
        if (entity.terrainFrameCount === undefined) {
            entity.terrainFrameCount = 0;
            entity.cachedSpeedMultiplier = 1.0;
        }
        entity.terrainFrameCount++;
        
        let speedMultiplier = entity.cachedSpeedMultiplier;
        
        // Recalculate slope every 5 frames
        if (entity.terrainFrameCount % 5 === 0 && this.getTerrainHeight) {
            const currentHeight = this.getTerrainHeight(entity.position.x, entity.position.z) || 0;
            const aheadHeight = this.getTerrainHeight(
                entity.position.x + dx / dist,
                entity.position.z + dz / dist
            ) || 0;
            
            const slope = Math.abs(aheadHeight - currentHeight);
            const slopeDegrees = Math.atan(slope) * 57.2957795;
            const MAX_WALKABLE_SLOPE = 45;
            const MIN_SPEED_MULTIPLIER = 0.10;
            const normalized = Math.min(slopeDegrees / MAX_WALKABLE_SLOPE, 1.0);
            speedMultiplier = 1.0 - normalized * (1.0 - MIN_SPEED_MULTIPLIER);
            speedMultiplier = Math.max(speedMultiplier, MIN_SPEED_MULTIPLIER);
            entity.cachedSpeedMultiplier = speedMultiplier;
        }
        
        // Road speed bonus
        if (entity.cachedOnRoad) {
            speedMultiplier *= 1.6;
        }
        
        const moveSpeed = config.MOVE_SPEED * speedMultiplier * (deltaTime / 1000);
        const moveAmount = Math.min(moveSpeed, dist);
        
        const dirX = dx / dist;
        const dirZ = dz / dist;
        
        const newX = entity.position.x + dirX * moveAmount;
        const newZ = entity.position.z + dirZ * moveAmount;
        
        // Check leash
        const dxHome = newX - entity.homePosition.x;
        const dzHome = newZ - entity.homePosition.z;
        const distFromHomeSq = dxHome * dxHome + dzHome * dzHome;
        const leashSq = config.LEASH_RANGE * config.LEASH_RANGE;
        
        if (distFromHomeSq > leashSq) {
            entity.state = 'leashed';
            return;
        }
        
        // Apply movement
        entity.position.x = newX;
        entity.position.z = newZ;
        
        // Update Y every 5 frames
        if (entity.terrainFrameCount % 5 === 0 && this.getTerrainHeight) {
            entity.position.y = this.getTerrainHeight(newX, newZ) || entity.position.y;
        }
        
        // Face movement direction
        entity.rotation = Math.atan2(dirX, dirZ);
        
        // Sync mesh
        if (entity.mesh) {
            entity.mesh.position.x = entity.position.x;
            entity.mesh.position.y = entity.position.y;
            entity.mesh.position.z = entity.position.z;
            entity.mesh.rotation.y = entity.rotation;
        }
        
        // Update controller
        if (entity.controller) {
            entity.controller.moving = true;
            entity.controller.speedMultiplier = speedMultiplier;
        }
    }

    // =========================================================================
    // COMBAT
    // =========================================================================

    /**
     * Deterministic random - same inputs always produce same output
     * @param {string} tentId
     * @param {number} shotCount
     * @returns {number} 0-1
     */
    _deterministicRandom(tentId, shotCount) {
        // Initialize hash with shotCount mixed via large prime (2654435761 is golden ratio prime)
        let hash = (shotCount * 2654435761) | 0;
        const str = tentId + '_' + shotCount;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash ^= (shotCount * 31);  // XOR shotCount each iteration for better mixing
            hash |= 0;
        }
        return (hash >>> 0) / 4294967295;
    }

    /**
     * Try to shoot at target (authority only)
     * @param {object} entity - Entity state
     * @param {object} target - Target {id, x, z, y}
     * @param {number} now - Timestamp
     */
    _tryShoot(entity, target, now) {
        const config = AI_CONFIG.BANDIT;
        
        // First shot delay
        const timeSinceSpawn = now - entity.spawnTime;
        if (timeSinceSpawn < config.FIRST_SHOT_DELAY) {
            if (!entity._logged.firstShotWait) {
                const remaining = ((config.FIRST_SHOT_DELAY - timeSinceSpawn) / 1000).toFixed(1);
                console.log(`[Bandit ${entity.tentId}] #9 FIRST SHOT DELAY - Waiting ${remaining}s before first shot (3s delay after spawn)`);
                entity._logged.firstShotWait = true;
            }
            return;
        }
        
        // Time-based shot pacing
        const shootingTime = timeSinceSpawn - config.FIRST_SHOT_DELAY;
        const expectedShots = 1 + Math.floor(shootingTime / config.SHOOT_INTERVAL);

        if (entity.shotCount >= expectedShots) {
            return;
        }

        // Prevent catch-up machine gun fire AND ensure minimum time between actual shots
        const timeSinceLastShot = now - entity.lastShotTime;
        if (timeSinceLastShot < config.SHOOT_INTERVAL && entity.shotCount > 0) {
            // Not enough time since last actual shot
            return;
        }

        // Skip missed shot opportunities (catch-up) but don't burst fire
        if (entity.shotCount < expectedShots - 1) {
            entity.shotCount = expectedShots - 1;
        }
        
        // Distance to target
        const dx = target.x - entity.position.x;
        const dz = target.z - entity.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        // Shooting range (height advantage bonus - max at 2 units height)
        const heightAdvantage = entity.position.y - (target.y || 0);
        const shootingRange = Math.min(
            config.SHOOT_RANGE_MAX,
            config.SHOOT_RANGE_MIN + Math.max(0, heightAdvantage) * config.SHOOT_RANGE_HEIGHT_BONUS
        );
        
        if (distance > shootingRange) {
            return;
        }
        
        // Hit chance (height + distance bonuses)
        const baseHitChance = Math.min(
            config.HIT_CHANCE_MAX,
            config.HIT_CHANCE_MIN + Math.max(0, heightAdvantage * config.HIT_CHANCE_HEIGHT_BONUS)
        );
        
        const distanceBonus = Math.max(0, (config.POINT_BLANK_RANGE - distance) / config.POINT_BLANK_RANGE);
        const hitChance = baseHitChance + (1.0 - baseHitChance) * distanceBonus;
        
        // Deterministic hit/miss
        const roll = this._deterministicRandom(entity.tentId, entity.shotCount);
        const didHit = roll < hitChance;
        
        // Log shot (before increment so we show actual shot number)
        const shotNum = entity.shotCount + 1;
        const targetDesc = target.type === 'bear' ? `bear ${target.id}` : `player ${target.id}`;
        console.log(`[Bandit ${entity.tentId}] #10 SHOT FIRED - Shot #${shotNum} at ${targetDesc}, distance: ${distance.toFixed(1)}, hit chance: ${(hitChance * 100).toFixed(0)}%, roll: ${(roll * 100).toFixed(0)}%, result: ${didHit ? 'HIT (lethal)' : 'MISS'}, timeSinceSpawn: ${((now - entity.spawnTime) / 1000).toFixed(1)}s`);

        // Update state
        entity.shotCount++;
        entity.lastShotTime = now;

        // Face target
        entity.rotation = Math.atan2(dx, dz);
        if (entity.mesh) {
            entity.mesh.rotation.y = entity.rotation;
        }
        
        // Track pending kill (authority)
        if (didHit) {
            if (target.type === 'bear') {
                // Kill bear immediately via registry
                this.registry?.killEntity('bear', target.id, entity.tentId);
            } else {
                // Player kill - track pending
                entity.pendingKills.add(target.id);
            }
        }

        // Broadcast shoot to peers
        this.broadcastP2P({
            type: 'bandit_shoot',
            tentId: entity.tentId,
            targetId: target.id,
            targetType: target.type || 'player',
            didHit: didHit,
            banditPos: { x: entity.position.x, y: entity.position.y, z: entity.position.z }
        });
        
        // Local effects via callback
        if (this.onShoot) {
            this.onShoot(entity.tentId, target.id, didHit, {
                x: entity.position.x,
                y: entity.position.y,
                z: entity.position.z
            });
        }
    }

    // =========================================================================
    // STATE MACHINE
    // =========================================================================

    /**
     * Update single entity (authority only runs full logic)
     * @param {object} entity - Entity state
     * @param {number} deltaTime - ms since last frame
     * @param {number} now - Timestamp
     * @param {Array} players - [{id, x, z, y}]
     */
    _updateEntity(entity, deltaTime, now, players) {
        const config = AI_CONFIG.BANDIT;
        
        // Dead entities do nothing
        if (entity.state === 'dead') {
            return;
        }
        
        // Non-authority: interpolate only
        if (entity.authorityId !== this.clientId) {
            this._interpolateEntity(entity, deltaTime);
            return;
        }
        
        // === AUTHORITY LOGIC BELOW ===
        
        // Find target (idle: throttled, active: every frame)
        let target = null;
        if (entity.state === 'idle') {
            if (this._frameCount % config.IDLE_CHECK_INTERVAL === 0) {
                target = this._findClosestPlayer(entity.position, config.CHASE_RANGE, players);
            }
        } else {
            target = this._findClosestPlayer(entity.position, config.CHASE_RANGE, players);
        }
        
        // Store target for broadcast
        entity.target = target ? target.id : null;

        // Log first target detection
        if (target && !entity._logged.firstTarget) {
            const dx = target.x - entity.position.x;
            const dz = target.z - entity.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz).toFixed(1);
            console.log(`[Bandit ${entity.tentId}] #4 TARGET DETECTED - Found player ${target.id} at distance ${dist} (chase range: 30)`);
            entity._logged.firstTarget = true;
        }

        // Distance to home
        const dxHome = entity.position.x - entity.homePosition.x;
        const dzHome = entity.position.z - entity.homePosition.z;
        const distFromHomeSq = dxHome * dxHome + dzHome * dzHome;
        const atHome = distFromHomeSq < 4; // Within 2 units
        
        // State transitions
        const prevState = entity.state;
        if (entity.state === 'chasing') {
            if (!target) {
                entity.state = 'returning';
                entity.lastPathTime = 0;
            }
        } else if (entity.state === 'leashed') {
            if (!target) {
                entity.state = 'returning';
                entity.lastPathTime = 0;
            }
        } else if (entity.state === 'returning') {
            if (target) {
                entity.state = 'chasing';
                entity.lastPathTime = 0;
            } else if (atHome) {
                entity.state = 'idle';
                entity.path = [];
                entity.pathIndex = 0;
            }
        } else if (entity.state === 'idle') {
            if (target) {
                entity.state = 'chasing';
                entity.lastPathTime = 0;
            }
        }

        // Log state transitions (once per transition type)
        if (prevState !== entity.state) {
            if (entity.state === 'chasing' && !entity._logged.chasing) {
                console.log(`[Bandit ${entity.tentId}] #6 CHASE BEGINS - State: ${prevState} -> chasing, pathfinding to target`);
                entity._logged.chasing = true;
                entity._logged.returning = false; // Reset so we can log return later
                entity._logged.idle = false;
            } else if (entity.state === 'returning' && !entity._logged.returning) {
                console.log(`[Bandit ${entity.tentId}] #18 TARGET LOST - State: ${prevState} -> returning, pathfinding home`);
                entity._logged.returning = true;
                entity._logged.chasing = false;
                entity._logged.leashed = false;
            } else if (entity.state === 'idle' && !entity._logged.idle) {
                console.log(`[Bandit ${entity.tentId}] #20 ARRIVED HOME - State: returning -> idle, within 2 units of tent`);
                entity._logged.idle = true;
                entity._logged.returning = false;
                entity._logged.firstTarget = false; // Reset to log next target
            }
        }
        
        // Default: not moving
        if (entity.controller) {
            entity.controller.moving = false;
        }
        
        // Per-state behavior
        switch (entity.state) {
            case 'chasing':
                if (entity.controller) {
                    entity.controller.inCombatStance = !!target;
                }
                
                if (target) {
                    const dx = target.x - entity.position.x;
                    const dz = target.z - entity.position.z;
                    const distToTarget = Math.sqrt(dx * dx + dz * dz);
                    
                    if (distToTarget <= config.ENGAGEMENT_DISTANCE) {
                        // Close enough - stop and shoot
                        if (!entity._logged.engagement) {
                            console.log(`[Bandit ${entity.tentId}] #8 ENGAGEMENT - Within ${config.ENGAGEMENT_DISTANCE} units, stopped moving, ready to shoot`);
                            entity._logged.engagement = true;
                        }
                        entity.path = [];
                        entity.pathIndex = 0;
                        if (entity.controller) {
                            entity.controller.moving = false;
                        }
                        entity.rotation = Math.atan2(dx, dz);
                        if (entity.mesh) {
                            entity.mesh.rotation.y = entity.rotation;
                        }
                    } else {
                        // Reset engagement log when moving again
                        entity._logged.engagement = false;
                        // Approach
                        this._updatePathfinding(entity, { x: target.x, z: target.z }, now);
                        this._moveAlongPath(entity, deltaTime);
                    }
                    
                    this._tryShoot(entity, target, now);
                } else {
                    this._moveAlongPath(entity, deltaTime);
                }
                break;
                
            case 'leashed':
                if (!entity._logged.leashed) {
                    const distFromHome = Math.sqrt(distFromHomeSq).toFixed(1);
                    console.log(`[Bandit ${entity.tentId}] #15 LEASHED - At leash edge (${distFromHome} units from home, max: 30), stopped but still shooting`);
                    entity._logged.leashed = true;
                }
                if (entity.controller) {
                    entity.controller.inCombatStance = !!target;
                    entity.controller.moving = false;
                }

                if (target) {
                    const dx = target.x - entity.position.x;
                    const dz = target.z - entity.position.z;
                    entity.rotation = Math.atan2(dx, dz);
                    if (entity.mesh) {
                        entity.mesh.rotation.y = entity.rotation;
                    }
                    this._tryShoot(entity, target, now);
                }
                break;
                
            case 'returning':
                if (entity.controller) {
                    entity.controller.inCombatStance = false;
                }
                this._updatePathfinding(entity, null, now);
                this._moveAlongPath(entity, deltaTime);
                break;
                
            case 'idle':
                if (entity.controller) {
                    entity.controller.inCombatStance = false;
                    entity.controller.moving = false;
                }
                break;
        }

        // Update animation mixer for authority client
        if (entity.controller && typeof entity.controller.update === 'function') {
            entity.controller.update(deltaTime, Date.now());
        }
    }

    // =========================================================================
    // NON-AUTHORITY INTERPOLATION
    // =========================================================================

    /**
     * Interpolate entity toward authority state with smooth walking
     * Uses velocity-based movement instead of position lerp for natural walking
     * @param {object} entity
     * @param {number} deltaTime - ms
     */
    _interpolateEntity(entity, deltaTime) {
        if (!entity.targetPosition) return;

        const MOVE_SPEED = AI_CONFIG.BANDIT.MOVE_SPEED; // Units per second (1.0)
        const SNAP_THRESHOLD = 0.05; // Snap when very close
        const TELEPORT_THRESHOLD = 10; // Teleport if too far (desync recovery)

        // Calculate distance to target
        const dx = entity.targetPosition.x - entity.position.x;
        const dz = entity.targetPosition.z - entity.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        // Handle edge cases
        if (distance < SNAP_THRESHOLD) {
            // Close enough - snap to target
            entity.position.x = entity.targetPosition.x;
            entity.position.z = entity.targetPosition.z;
        } else if (distance > TELEPORT_THRESHOLD) {
            // Too far - teleport to recover from major desync
            entity.position.x = entity.targetPosition.x;
            entity.position.z = entity.targetPosition.z;
            console.log(`[Bandit ${entity.tentId}] Teleported to recover from ${distance.toFixed(1)} unit desync`);
        } else {
            // Calculate movement step based on speed and deltaTime
            const secondsDelta = deltaTime / 1000;
            const moveStep = MOVE_SPEED * secondsDelta;

            // Move toward target at constant speed
            if (moveStep >= distance) {
                // Would overshoot - snap to target
                entity.position.x = entity.targetPosition.x;
                entity.position.z = entity.targetPosition.z;
            } else {
                // Normalize direction and apply movement
                const dirX = dx / distance;
                const dirZ = dz / distance;
                entity.position.x += dirX * moveStep;
                entity.position.z += dirZ * moveStep;
            }
        }

        // Handle Y position (terrain height) - lerp smoothly
        if (entity.targetPosition.y !== undefined) {
            const dy = entity.targetPosition.y - entity.position.y;
            entity.position.y += dy * 0.1; // Gentle Y lerp for terrain changes
        }

        // Rotation - face movement direction when moving, use synced rotation when stationary
        let targetRotation;
        if (distance > 0.1) {
            // Moving: face movement direction
            targetRotation = Math.atan2(dx, dz);
        } else if (entity.targetRotation !== undefined) {
            // Stationary: use synced rotation from authority
            targetRotation = entity.targetRotation;
        } else {
            // No update needed
            targetRotation = entity.rotation;
        }

        let rotDiff = targetRotation - entity.rotation;

        // Wrap to [-PI, PI]
        while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
        while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;

        // Smooth rotation (120 degrees per second max)
        const secondsDelta = deltaTime / 1000;
        const maxRotation = 2.1 * secondsDelta;
        entity.rotation += Math.max(-maxRotation, Math.min(maxRotation, rotDiff));

        // Sync mesh
        if (entity.mesh) {
            entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
            entity.mesh.rotation.y = entity.rotation;
        }

        // Update animation mixer for non-authority client
        if (entity.controller && typeof entity.controller.update === 'function') {
            entity.controller.update(deltaTime, Date.now());
        }
    }

    // =========================================================================
    // AUTHORITY SYSTEM
    // =========================================================================

    // isAuthority inherited from BaseAIController

    /**
     * Calculate who should be authority for an entity
     * @param {string} tentId
     * @returns {string|null} clientId or null if no players nearby
     */
    _calculateAuthority(tentId) {
        const entity = this.entities.get(tentId);
        if (!entity) return null;
        
        const CHUNK_SIZE = AI_CONFIG.CHUNK_SIZE;
        const homeChunkX = Math.floor(entity.homePosition.x / CHUNK_SIZE);
        const homeChunkZ = Math.floor(entity.homePosition.z / CHUNK_SIZE);
        const homeChunkKey = `${homeChunkX},${homeChunkZ}`;
        
        // Check home chunk first
        let players = this.getPlayersInChunks([homeChunkKey]);
        
        // Fallback: 3x3 around home
        if (!players || players.size === 0) {
            const chunkKeys = this._get3x3ChunkKeys(homeChunkX, homeChunkZ);
            players = this.getPlayersInChunks(chunkKeys);
        }
        
        if (!players || players.size === 0) return null;

        // Lowest clientId wins (numeric sort, not lexicographic!)
        const sorted = Array.from(players).sort((a, b) => parseInt(a) - parseInt(b));
        return sorted[0];
    }

    /**
     * Broadcast state for a single entity (used after authority transfer)
     * @param {object} entity
     * @param {string} tentId
     */
    _broadcastEntityState(entity, tentId) {
        if (entity.state === 'dead') return;

        this.broadcastP2P({
            type: 'bandit_state',
            tentId: tentId,
            position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
            rotation: entity.rotation,
            state: entity.state,
            target: entity.target,
            shotCount: entity.shotCount,
            lastShotTime: entity.lastShotTime,
            pendingKills: Array.from(entity.pendingKills || []),
            moving: entity.controller?.moving || false,
            inCombatStance: entity.controller?.inCombatStance || false,
            speedMultiplier: entity.controller?.speedMultiplier || 1.0
        });
    }

    /**
     * Called when a peer disconnects
     * @param {string} peerId
     */
    onPeerDisconnected(peerId) {
        for (const [tentId, entity] of this.entities) {
            // Transfer authority if this peer was authority
            if (entity.authorityId === peerId) {
                const newAuthority = this._calculateAuthority(tentId);
                if (newAuthority) {
                    const wasMe = newAuthority === this.clientId;
                    entity.authorityId = newAuthority;

                    // If we're taking over authority, handle position transfer
                    if (wasMe) {
                        // Snap position to last known authoritative position to prevent visual jump
                        if (entity.targetPosition) {
                            entity.position.x = entity.targetPosition.x;
                            entity.position.y = entity.targetPosition.y;
                            entity.position.z = entity.targetPosition.z;
                        }

                        // Sync mesh position
                        if (entity.controller?.mesh) {
                            entity.controller.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
                        }

                        // Immediately broadcast our state so other peers sync
                        this._broadcastEntityState(entity, tentId);
                    }

                    console.log(`[Bandit ${tentId}] #25 AUTHORITY TRANSFER - Peer ${peerId} disconnected, new authority: ${newAuthority}${wasMe ? ' (me - now simulating)' : ''}`);
                } else {
                    console.log(`[Bandit ${tentId}] #26 NO AUTHORITY - Peer ${peerId} disconnected, no players in range to take over`);
                }
            }

            // Clean up any pending kills for disconnected peer
            if (entity.pendingKills && entity.pendingKills.has(peerId)) {
                entity.pendingKills.delete(peerId);
            }
        }
    }

    /**
     * Called when a peer changes chunk
     * @param {string} peerId
     * @param {string} oldChunkKey
     * @param {string} newChunkKey
     */
    onPeerChunkChanged(peerId, oldChunkKey, newChunkKey) {
        const CHUNK_SIZE = AI_CONFIG.CHUNK_SIZE;

        for (const [tentId, entity] of this.entities) {
            if (entity.authorityId !== peerId) continue;

            // Check if peer left authority region (3x3 around home)
            const homeChunkX = Math.floor(entity.homePosition.x / CHUNK_SIZE);
            const homeChunkZ = Math.floor(entity.homePosition.z / CHUNK_SIZE);

            const [newX, newZ] = newChunkKey.split(',').map(Number);
            const dx = Math.abs(newX - homeChunkX);
            const dz = Math.abs(newZ - homeChunkZ);

            if (dx > 1 || dz > 1) {
                const newAuthority = this._calculateAuthority(tentId);
                if (newAuthority) {
                    const wasMe = newAuthority === this.clientId;
                    entity.authorityId = newAuthority;

                    // If we're taking over authority, handle position transfer
                    if (wasMe) {
                        // Snap position to last known authoritative position to prevent visual jump
                        if (entity.targetPosition) {
                            entity.position.x = entity.targetPosition.x;
                            entity.position.y = entity.targetPosition.y;
                            entity.position.z = entity.targetPosition.z;
                        }

                        // Sync mesh position
                        if (entity.controller?.mesh) {
                            entity.controller.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
                        }

                        // Immediately broadcast our state so other peers sync
                        this._broadcastEntityState(entity, tentId);
                    }

                    console.log(`[Bandit ${tentId}] #25 AUTHORITY TRANSFER - Peer ${peerId} left area (chunk ${oldChunkKey} -> ${newChunkKey}), new authority: ${newAuthority}${wasMe ? ' (me - now simulating)' : ''}`);
                } else {
                    console.log(`[Bandit ${tentId}] #26 NO AUTHORITY - Peer ${peerId} left area, no players in range`);
                }
            }
        }
    }

    // =========================================================================
    // P2P MESSAGE HANDLERS
    // =========================================================================

    /**
     * Handle state broadcast from authority
     * @param {object} data
     */
    handleStateMessage(data) {
        const { tentId, position, rotation, state, target, shotCount, lastShotTime, pendingKills, moving, inCombatStance, speedMultiplier } = data;

        const entity = this.entities.get(tentId);
        if (!entity) return;

        // Ignore if we're authority
        if (entity.authorityId === this.clientId) return;

        // Store for interpolation
        entity.targetPosition = position;
        entity.targetRotation = rotation;

        // Direct state updates
        entity.state = state;
        entity.target = target;
        entity.shotCount = shotCount;
        entity.lastShotTime = lastShotTime || entity.lastShotTime;

        // Controller state
        if (entity.controller) {
            entity.controller.moving = moving || false;
            entity.controller.inCombatStance = inCombatStance || false;
            entity.controller.speedMultiplier = speedMultiplier || 1.0;
        }
        
        // Check if we were killed
        if (pendingKills && pendingKills.includes(this.clientId)) {
            if (this.onShoot) {
                // Trigger death via onShoot callback (didHit=true for local player)
                this.onShoot(tentId, this.clientId, true, position);
            }
            // ACK the kill
            this.broadcastP2P({
                type: 'bandit_kill_ack',
                tentId: tentId,
                playerId: this.clientId
            });
        }
    }

    /**
     * Handle kill ACK from player
     * @param {object} data
     */
    handleKillAck(data) {
        const { tentId, playerId } = data;
        const entity = this.entities.get(tentId);
        if (!entity) return;
        
        // Only authority processes ACKs
        if (entity.authorityId !== this.clientId) return;
        
        entity.pendingKills.delete(playerId);
    }

    /**
     * Handle shoot broadcast from authority
     * Triggers effects on non-authority clients
     * @param {object} data
     */
    handleShootMessage(data) {
        const { tentId, targetId, targetType, didHit, banditPos } = data;

        const entity = this.entities.get(tentId);

        // If we're authority, we already triggered this locally
        if (entity && entity.authorityId === this.clientId) return;

        // Handle bear kills from peers via registry
        if (didHit && targetType === 'bear') {
            this.registry?.killEntity('bear', targetId, tentId);
        }

        // CRITICAL: Always trigger onShoot callback, even if entity doesn't exist locally
        // This ensures player death is processed even if bandit sync failed
        if (this.onShoot) {
            this.onShoot(tentId, targetId, didHit, banditPos);
        }
    }

    // =========================================================================
    // DEATH HANDLING
    // =========================================================================

    // isAlive inherited from BaseAIController

    /**
     * Check if there are any bandits near a position
     * @param {number} x - X coordinate
     * @param {number} z - Z coordinate
     * @param {number} radius - Search radius
     * @returns {boolean} True if bandits within radius
     */
    hasNearbyBandits(x, z, radius) {
        const radiusSq = radius * radius;
        for (const [tentId, entity] of this.entities) {
            if (entity.state === 'dead') continue;
            const dx = entity.position.x - x;
            const dz = entity.position.z - z;
            const distSq = dx * dx + dz * dz;
            if (distSq <= radiusSq) {
                return true;
            }
        }
        return false;
    }

    /**
     * Kill an entity (any player can kill)
     * @param {string} tentId
     * @param {string} killedBy - clientId of killer
     */
    killEntity(tentId, killedBy) {
        const entity = this.entities.get(tentId);
        if (!entity || entity.state === 'dead') return;

        entity.state = 'dead';
        entity.path = [];
        entity.pathIndex = 0;

        // Update name tag to show (DEAD)
        if (this.game?.nameTagManager) {
            this.game.nameTagManager.setEntityDead(`bandit_${tentId}`);
        }

        if (entity.controller) {
            entity.controller.moving = false;
            entity.controller.inCombatStance = false;
            if (typeof entity.controller.kill === 'function') {
                entity.controller.kill();
            }
        }

        // Broadcast death
        this.broadcastP2P({
            type: 'bandit_death',
            tentId: tentId,
            killedBy: killedBy
        });

        // Log death
        if (!entity._logged || !entity._logged.dead) {
            console.log(`[Bandit ${tentId}] #21 DEATH - Killed by player ${killedBy}, shots fired: ${entity.shotCount}, state was: ${entity.state}`);
            if (entity._logged) entity._logged.dead = true;
        }

        // Schedule visual cleanup after death animation (5 seconds)
        // Entity stays in map to prevent respawn until player leaves area
        setTimeout(() => {
            this._destroyVisualOnly(tentId);
        }, 5000);
    }

    /**
     * Handle death message from peer
     * @param {object} data
     */
    handleDeathMessage(data) {
        const { tentId, killedBy } = data;
        const entity = this.entities.get(tentId);

        if (!entity || entity.state === 'dead') return;

        entity.state = 'dead';
        entity.path = [];
        entity.pathIndex = 0;

        // Update name tag to show (DEAD)
        if (this.game?.nameTagManager) {
            this.game.nameTagManager.setEntityDead(`bandit_${tentId}`);
        }

        if (entity.controller) {
            entity.controller.moving = false;
            entity.controller.inCombatStance = false;
            if (typeof entity.controller.kill === 'function') {
                entity.controller.kill();
            }
        }

        console.log(`[AIController] Received death for ${tentId} from ${killedBy}`);

        // Schedule visual cleanup after death animation (5 seconds)
        // Entity stays in map to prevent respawn until player leaves area
        setTimeout(() => {
            this._destroyVisualOnly(tentId);
        }, 5000);
    }

    // =========================================================================
    // CLEANUP
    // =========================================================================

    /**
     * Destroy visual only (mesh) but keep entity in map to prevent respawn
     * @param {string} tentId
     */
    _destroyVisualOnly(tentId) {
        const entity = this.entities.get(tentId);
        if (!entity) return;

        // Cleanup name tag
        if (this.game?.nameTagManager) {
            this.game.nameTagManager.unregisterEntity(`bandit_${tentId}`);
        }

        if (this.destroyVisual) {
            this.destroyVisual(tentId);
        }

        // Clear mesh/controller references but keep entity in map
        entity.mesh = null;
        entity.controller = null;
    }

    /**
     * Destroy an entity completely (removes from map, allows respawn)
     * Only call when chunk unloads or player leaves area
     * @param {string} tentId
     */
    _destroyEntity(tentId) {
        const entity = this.entities.get(tentId);
        if (!entity) return;

        if (this.destroyVisual) {
            this.destroyVisual(tentId);
        }

        this.entities.delete(tentId);
    }

    /**
     * Clean up dead entity visuals (keeps entities in map to prevent respawn)
     */
    cleanupDeadEntities() {
        for (const [tentId, entity] of this.entities) {
            if (entity.state === 'dead' && entity.mesh) {
                this._destroyVisualOnly(tentId);
            }
        }
    }

    // =========================================================================
    // AUTHORITY BROADCAST (called on server tick)
    // =========================================================================

    /**
     * Broadcast state for all entities we're authority over
     */
    broadcastAuthorityState() {
        for (const [tentId, entity] of this.entities) {
            if (entity.authorityId !== this.clientId) continue;
            if (entity.state === 'dead') continue;
            
            this.broadcastP2P({
                type: 'bandit_state',
                tentId: tentId,
                position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
                rotation: entity.rotation,
                state: entity.state,
                target: entity.target,
                shotCount: entity.shotCount,
                lastShotTime: entity.lastShotTime,
                pendingKills: Array.from(entity.pendingKills),
                moving: entity.controller?.moving || false,
                inCombatStance: entity.controller?.inCombatStance || false,
                speedMultiplier: entity.controller?.speedMultiplier || 1.0
            });
        }
    }

    // =========================================================================
    // MAIN UPDATE LOOP
    // =========================================================================

    /**
     * Main update - called every frame from game.js
     * @param {number} deltaTime - ms since last frame
     * @param {number} chunkX - Player's current chunk X
     * @param {number} chunkZ - Player's current chunk Z
     */
    update(deltaTime, chunkX, chunkZ) {
        this._frameCount++;
        const now = Date.now();
        
        // Build player list
        const players = this._buildPlayerList(chunkX, chunkZ);
        
        // Get local player position for distance culling
        const myPos = this.getPlayerPosition(this.clientId);
        const NEAR_DISTANCE_SQ = 50 * 50;
        const FAR_UPDATE_INTERVAL = 4;
        
        for (const [tentId, entity] of this.entities) {
            // Distance culling for performance
            if (myPos && entity.state !== 'dead') {
                const dx = entity.position.x - myPos.x;
                const dz = entity.position.z - myPos.z;
                const distSq = dx * dx + dz * dz;
                
                if (distSq > NEAR_DISTANCE_SQ) {
                    if (this._frameCount % FAR_UPDATE_INTERVAL !== 0) {
                        continue;
                    }
                }
            }
            
            this._updateEntity(entity, deltaTime, now, players);
        }
    }
}

// =============================================================================
// LEGACY ALIAS
// =============================================================================

// For backwards compatibility with existing code
export const BanditController = AIController;

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
import { getAISpawnQueue } from './AISpawnQueue.js';
import { CONFIG } from '../config.js';

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
        this.isPlayerActive = null;  // Heartbeat: checks if player has recent updates
        
        // Spawn optimization (Phase 1)
        this._hasTentsInRange = false;
        this._lastCheckedChunkX = null;
        this._lastCheckedChunkZ = null;
        
        // Performance caches
        this._playerListCache = [];
        this._playerObjectPool = [];
        this._candidatesCache = [];
        this._lastPlayerListTick = -1; // Track tick for player list caching
        this._candidateObjectPool = [];

        // Spawn check optimization (one tent per tick)
        this._spawnCheckPlayerPositions = new Map(); // Pooled Map for spawn checks
        this._tentCheckIndex = 0;                     // Which tent to check this tick
        this._collectedTents = [];                    // Reusable array for tent collection

        // Performance: Reusable broadcast message object to avoid GC pressure
        this._broadcastMsg = {
            type: 'bandit_state',
            tentId: '',
            authorityId: '',      // Heartbeat: current authority's clientId
            authorityTerm: 1,     // Heartbeat: increments on authority takeover
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
        this.isPlayerActive = config.isPlayerActive || null;  // Heartbeat callback
        this.getPlayerFaction = config.getPlayerFaction || null;  // For militia targeting

        // Optional: game reference for name tags
        if (config.game) {
            this.game = config.game;
        }

        // Register spawn callback with queue system
        const spawnQueue = getAISpawnQueue();
        spawnQueue.registerSpawnCallback('bandit', (data) => {
            this._executeSpawn(data);
        });
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
     * @param {number} chunkX - Player's current chunk X
     * @param {number} chunkZ - Player's current chunk Z
     */
    checkSpawnsOnTick(chunkX, chunkZ) {
        // Always refresh tent presence to catch newly registered structures
        // (Fixes timing issue where structures are queued during initial load)
        this.updateTentPresence(chunkX, chunkZ, true);  // Bug 3 Fix: force=true

        // Early-out if no tents nearby
        if (!this._hasTentsInRange) return;

        const SPAWN_RANGE = AI_CONFIG.BANDIT.SPAWN_RANGE;
        const spawnRangeSq = SPAWN_RANGE * SPAWN_RANGE;

        // Get my position
        const myPos = this.getPlayerPosition(this.clientId);
        if (!myPos) return;

        // HOISTED: Get players once for all tents (was inside tent loop)
        const chunkKeys = this._get3x3ChunkKeys(chunkX, chunkZ);
        const playerIds = this.getPlayersInChunks(chunkKeys);

        // HOISTED: Pre-fetch all player positions once (reuse pooled Map)
        const playerPositions = this._spawnCheckPlayerPositions;
        playerPositions.clear();
        playerPositions.set(this.clientId, myPos);
        if (playerIds) {
            for (const playerId of playerIds) {
                if (playerId !== this.clientId) {
                    const pos = this.getPlayerPosition(playerId);
                    if (pos) playerPositions.set(playerId, pos);
                }
            }
        }

        // Collect all unspawned tents from 3x3 grid (reuse array, reuse chunkKeys from above)
        this._collectedTents.length = 0;
        for (const key of chunkKeys) {
            const tents = this.getBanditStructures(key);
            if (tents) {
                for (const tent of tents) {
                    if (!this.entities.has(tent.id)) {
                        this._collectedTents.push(tent);
                    }
                }
            }
        }

        // Process ONE tent per tick (spreads work over multiple ticks)
        if (this._collectedTents.length === 0) return;
        this._tentCheckIndex = this._tentCheckIndex % this._collectedTents.length;
        const tent = this._collectedTents[this._tentCheckIndex];
        this._tentCheckIndex++;

        // Process this one tent (same logic as before, just for one tent)
        const tentX = tent.position.x;
        const tentZ = tent.position.z;

        // Check if I'm in range
        const dxMe = myPos.x - tentX;
        const dzMe = myPos.z - tentZ;
        if (dxMe * dxMe + dzMe * dzMe >= spawnRangeSq) return;

        // Find authority: lowest clientId in range
        let authorityId = this.clientId;

        for (const [playerId, pos] of playerPositions) {
            if (playerId === this.clientId) continue;

            const dxP = pos.x - tentX;
            const dzP = pos.z - tentZ;
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
            const spawnQueue = getAISpawnQueue();
            if (!spawnQueue.isQueued('bandit', tent.id)) {
                spawnQueue.queueSpawn('bandit', { tent }, tent.id);
            }
        }
    }

    // =========================================================================
    // SPAWNING
    // =========================================================================

    /**
     * Execute spawn from queue (called by AISpawnQueue)
     * @param {object} data - Spawn data from queue { tent }
     */
    _executeSpawn(data) {
        const { tent } = data;

        // Race condition check - entity may have spawned while in queue
        if (this.entities.has(tent.id)) {
            return;
        }

        this._spawnBandit(tent);
    }

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
            entityType: 'bandit',  // 'bandit' or 'militia'
            factionId: null,       // Only set for militia
            ownerId: null,         // Only set for militia (who spawned it)
            authorityId: this.clientId,
            authorityTerm: 1,  // Heartbeat: increments on authority takeover
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
            lastPathTime: Date.now() - Math.random() * 6000, // Stagger to prevent synchronized pathfinding
            
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
        
        entity._logged.spawn = true;
    }

    /**
     * Spawn militia for a player-owned tent
     * Called from game.js when player clicks Request Militia button
     * @param {object} tent - Tent structure {id, position}
     * @param {number} factionId - Militia faction (1=Southguard, 3=Northmen)
     * @param {string} ownerId - Player who spawned the militia
     * @param {number} shirtColor - Faction shirt color (hex)
     */
    spawnMilitiaForTent(tent, factionId, ownerId, shirtColor) {
        // Check if militia already exists for this tent
        if (this.entities.has(tent.id)) {
            console.warn(`[Militia] Entity already exists for tent ${tent.id}`);
            return false;
        }

        const now = Date.now();

        // Find walkable spawn position around tent
        let spawnX, spawnZ, spawnY;
        const spawnRadius = 2.5;
        const startAngle = Math.random() * Math.PI * 2;

        for (let attempt = 0; attempt < 8; attempt++) {
            const angle = startAngle + (attempt / 8) * Math.PI * 2;
            const testX = tent.position.x + Math.cos(angle) * spawnRadius;
            const testZ = tent.position.z + Math.sin(angle) * spawnRadius;

            if (this.isWalkable && this.isWalkable(testX, testZ)) {
                spawnX = testX;
                spawnZ = testZ;
                break;
            } else if (!this.isWalkable) {
                spawnX = testX;
                spawnZ = testZ;
                break;
            }
        }

        if (spawnX === undefined) {
            spawnX = tent.position.x + Math.cos(startAngle) * spawnRadius;
            spawnZ = tent.position.z + Math.sin(startAngle) * spawnRadius;
        }

        spawnY = this.getTerrainHeight(spawnX, spawnZ);

        const entity = {
            // Identity
            tentId: tent.id,
            type: 'militia',
            entityType: 'militia',
            factionId: factionId,
            ownerId: ownerId,
            authorityId: this.clientId,
            authorityTerm: 1,
            spawnedBy: this.clientId,
            spawnTime: now,

            // Position
            homePosition: { x: tent.position.x, z: tent.position.z },
            position: { x: spawnX, y: spawnY, z: spawnZ },
            rotation: 0,

            // State machine
            state: 'idle',
            target: null,

            // Pathfinding
            path: [],
            pathIndex: 0,
            lastPathTime: Date.now() - Math.random() * 6000,

            // Combat
            shotCount: 0,
            lastShotTime: 0,
            pendingKills: new Set(),

            // Visual
            mesh: null,
            controller: null,

            // Non-authority interpolation
            targetPosition: null,
            targetRotation: null,

            // Debug logging flags
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

        // Create visual with faction shirt color
        const visual = this.createVisual(tent.id, entity.position, { shirtColor, entityType: 'militia', factionId });
        if (visual) {
            entity.mesh = visual.mesh || visual.enemy || visual;
            entity.controller = visual;
        }

        this.entities.set(tent.id, entity);

        // Register name tag with faction color
        if (this.game?.nameTagManager && entity.mesh) {
            this.game.nameTagManager.registerEntity(`militia_${tent.id}`, 'Militia', entity.mesh, { factionId });
        }

        // Broadcast spawn to peers
        this.broadcastP2P({
            type: 'bandit_spawn',  // Reuse bandit_spawn message type
            tentId: tent.id,
            spawnedBy: this.clientId,
            spawnTime: now,
            position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
            homePosition: { x: tent.position.x, z: tent.position.z },
            entityType: 'militia',
            factionId: factionId,
            ownerId: ownerId,
            shirtColor: shirtColor,
        });

        entity._logged.spawn = true;
        console.log(`[Militia] Spawned for tent ${tent.id} (faction: ${factionId})`);
        return true;
    }

    /**
     * Spawn militia at an outpost tower
     * Militia spawns at tower height (Y+1.5) and stays stationary
     * @param {THREE.Object3D} outpost - Outpost mesh
     * @param {number} factionId - Player's faction (1=Southguard, 3=Northmen)
     * @param {string} ownerId - Player who spawned the militia
     * @param {number} shirtColor - Faction shirt color (hex)
     */
    spawnOutpostMilitia(outpost, factionId, ownerId, shirtColor) {
        const outpostId = outpost.userData?.objectId;
        if (!outpostId) {
            console.warn('[OutpostMilitia] No objectId on outpost');
            return false;
        }

        // Check if militia already exists for this outpost
        if (this.entities.has(outpostId)) {
            console.warn(`[OutpostMilitia] Entity already exists for outpost ${outpostId}`);
            return false;
        }

        const now = Date.now();

        // Tower position: outpost position + 1.5 Y (same as player climbing)
        const outpostPos = outpost.position;
        const groundY = this.getTerrainHeight(outpostPos.x, outpostPos.z);
        const towerY = groundY + 1.5;

        const entity = {
            // Identity
            tentId: outpostId,  // Reuse tentId field for structure tracking
            type: 'outpostMilitia',
            entityType: 'outpostMilitia',
            factionId: factionId,
            ownerId: ownerId,
            authorityId: this.clientId,
            authorityTerm: 1,
            spawnedBy: this.clientId,
            spawnTime: now,

            // Tower-specific flags
            isTowerMilitia: true,
            groundPosition: { x: outpostPos.x, y: groundY, z: outpostPos.z },

            // Position (at tower height)
            homePosition: { x: outpostPos.x, z: outpostPos.z },
            position: { x: outpostPos.x, y: towerY, z: outpostPos.z },
            rotation: 0,

            // State machine (simplified - no movement states)
            state: 'idle',
            target: null,

            // No pathfinding needed for tower militia
            path: [],
            pathIndex: 0,
            lastPathTime: now,

            // Combat
            shotCount: 0,
            lastShotTime: 0,
            pendingKills: new Set(),

            // Visual
            mesh: null,
            controller: null,

            // Non-authority interpolation
            targetPosition: null,
            targetRotation: null,

            // Death descent tracking
            descentStartTime: null,
            descentDuration: 2000,  // 2 seconds like player climbing

            // Debug logging flags
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

        // Create visual with faction shirt color
        const visual = this.createVisual(outpostId, entity.position, { shirtColor, entityType: 'outpostMilitia', factionId });
        if (visual) {
            entity.mesh = visual.mesh || visual.enemy || visual;
            entity.controller = visual;
        }

        this.entities.set(outpostId, entity);

        // Register in outpostMilitia tracking
        if (this.game?.outpostMilitia) {
            this.game.outpostMilitia.set(outpostId, outpostId);
        }

        // Register name tag with faction color
        if (this.game?.nameTagManager && entity.mesh) {
            this.game.nameTagManager.registerEntity(`outpostMilitia_${outpostId}`, 'Militia', entity.mesh, { factionId });
        }

        // Broadcast spawn to peers
        this.broadcastP2P({
            type: 'bandit_spawn',  // Reuse bandit_spawn message type
            tentId: outpostId,
            spawnedBy: this.clientId,
            spawnTime: now,
            position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
            homePosition: { x: outpostPos.x, z: outpostPos.z },
            groundPosition: { x: outpostPos.x, y: groundY, z: outpostPos.z },
            entityType: 'outpostMilitia',
            isTowerMilitia: true,
            factionId: factionId,
            ownerId: ownerId,
            shirtColor: shirtColor,
        });

        entity._logged.spawn = true;
        console.log(`[OutpostMilitia] Spawned at outpost ${outpostId} tower (faction: ${factionId})`);
        return true;
    }

    /**
     * Spawn artillery militia (gunner) at an artillery piece
     * @param {THREE.Object3D} artillery - The artillery mesh
     * @param {number} factionId - Player's faction (1=Southguard, 3=Northmen)
     * @param {string} ownerId - Player who spawned the militia
     * @param {number} shirtColor - Faction shirt color (hex)
     */
    spawnArtilleryMilitia(artillery, factionId, ownerId, shirtColor) {
        const artilleryId = artillery.userData?.objectId;
        if (!artilleryId) {
            console.warn('[ArtilleryMilitia] No objectId on artillery');
            return false;
        }

        // Check if militia already exists for this artillery
        if (this.entities.has(artilleryId)) {
            console.warn(`[ArtilleryMilitia] Entity already exists for artillery ${artilleryId}`);
            return false;
        }

        const now = Date.now();

        // Position at artillery location
        const artilleryPos = artillery.position;
        const groundY = this.getTerrainHeight(artilleryPos.x, artilleryPos.z);

        const entity = {
            // Identity
            tentId: artilleryId,  // Reuse tentId field for structure tracking
            type: 'artilleryMilitia',
            entityType: 'artilleryMilitia',
            factionId: factionId,
            ownerId: ownerId,
            authorityId: this.clientId,
            authorityTerm: 1,
            spawnedBy: this.clientId,
            spawnTime: now,

            // Artillery-specific flags
            isArtilleryMilitia: true,
            artilleryMesh: artillery,  // Reference to track position/state
            artilleryId: artilleryId,

            // Position (at artillery)
            homePosition: { x: artilleryPos.x, z: artilleryPos.z },
            position: { x: artilleryPos.x, y: groundY + 0.1, z: artilleryPos.z },
            rotation: artillery.rotation.y,

            // State machine (simplified - no movement states)
            state: 'idle',
            target: null,

            // No pathfinding needed for artillery militia
            path: [],
            pathIndex: 0,
            lastPathTime: now,

            // Combat (artillery-specific)
            shotCount: 0,
            lastShotTime: 0,
            lastFireTime: 0,  // For 12s artillery cooldown
            pendingKills: new Set(),

            // Visual
            mesh: null,
            controller: null,

            // Non-authority interpolation
            targetPosition: null,
            targetRotation: null,

            // Debug logging flags
            _logged: {
                spawn: false,
                firstTarget: false,
                noArtillery: false,
                firing: false,
                dead: false,
            },
        };

        // Create visual with faction shirt color
        const visual = this.createVisual(artilleryId, entity.position, { shirtColor, entityType: 'artilleryMilitia', factionId });
        if (visual) {
            entity.mesh = visual.mesh || visual.enemy || visual;
            entity.controller = visual;
        }

        this.entities.set(artilleryId, entity);

        // Register in artilleryMilitia tracking
        if (this.game?.artilleryMilitia) {
            this.game.artilleryMilitia.set(artilleryId, artilleryId);
        }

        // Mark artillery as occupied
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.setOccupied(artilleryId, 'militia');
        }

        // Register name tag with faction color
        if (this.game?.nameTagManager && entity.mesh) {
            this.game.nameTagManager.registerEntity(`artilleryMilitia_${artilleryId}`, 'Gunner', entity.mesh, { factionId });
        }

        // Broadcast spawn to peers
        this.broadcastP2P({
            type: 'bandit_spawn',  // Reuse bandit_spawn message type
            tentId: artilleryId,
            spawnedBy: this.clientId,
            spawnTime: now,
            position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
            homePosition: { x: artilleryPos.x, z: artilleryPos.z },
            entityType: 'artilleryMilitia',
            isArtilleryMilitia: true,
            factionId: factionId,
            ownerId: ownerId,
            shirtColor: shirtColor,
        });

        entity._logged.spawn = true;
        console.log(`[ArtilleryMilitia] Spawned gunner at artillery ${artilleryId} (faction: ${factionId})`);
        return true;
    }

    /**
     * Handle spawn message from peer
     * @param {object} data - Spawn data
     */
    handleSpawnMessage(data) {
        const { tentId, spawnedBy, spawnTime, position, homePosition } = data;
        // Militia fields (optional, defaults to bandit)
        const entityType = data.entityType || 'bandit';
        const factionId = data.factionId || null;
        const ownerId = data.ownerId || null;
        const shirtColor = data.shirtColor || null;

        // Skip if already exists - use deterministic authority (lowest clientId wins)
        if (this.entities.has(tentId)) {
            const existing = this.entities.get(tentId);

            // Deterministic conflict resolution: lowest clientId always wins
            // This handles the case where both players spawn before P2P connects
            if (spawnedBy < existing.spawnedBy) {
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
            type: entityType,
            entityType: entityType,
            factionId: factionId,
            ownerId: ownerId,
            authorityId: spawnedBy,
            authorityTerm: 1,  // Heartbeat: increments on authority takeover
            spawnedBy,
            spawnTime,

            homePosition: { x: homePosition.x, z: homePosition.z },
            position: { ...position },
            rotation: 0,

            state: 'idle',
            target: null,

            path: [],
            pathIndex: 0,
            lastPathTime: Date.now() - Math.random() * 6000, // Stagger to prevent synchronized pathfinding

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

        // Add tower militia flags if outpostMilitia type
        if (entityType === 'outpostMilitia') {
            entity.isTowerMilitia = true;  // outpostMilitia is always tower militia
            entity.groundPosition = data.groundPosition || { x: homePosition.x, y: position.y - 1.5, z: homePosition.z };
            entity.descentStartTime = null;
            entity.deathApplied = false;  // Initialize death tracking flag
            entity.descentDuration = 2000;  // 2 seconds like player climbing
        }

        // Add artillery militia flags if artilleryMilitia type
        if (entityType === 'artilleryMilitia') {
            entity.isArtilleryMilitia = true;
            entity.artilleryId = tentId;  // Artillery ID is the tentId
            entity.artilleryMesh = null;  // Will be looked up when needed
            entity.lastFireTime = 0;  // For 12s artillery cooldown
        }

        // Create visual - required for entity to function
        // Pass options for militia (shirt color) - compute from factionId if not provided
        const isMilitiaType = entityType === 'militia' || entityType === 'outpostMilitia' || entityType === 'artilleryMilitia';
        const effectiveShirtColor = shirtColor || (isMilitiaType && factionId
            ? (CONFIG.FACTION_COLORS?.[factionId]?.shirt || CONFIG.FACTION_COLORS?.default?.shirt)
            : null);
        const visualOptions = isMilitiaType ? { shirtColor: effectiveShirtColor, entityType, factionId } : {};
        const visual = this.createVisual(tentId, position, visualOptions);
        if (visual) {
            entity.mesh = visual.mesh || visual.enemy || visual;
            entity.controller = visual;
        } else {
            // Visual creation failed - don't add broken entity
            console.warn(`[${entityType} ${tentId}] Failed to create visual, skipping spawn`);
            return;
        }

        this.entities.set(tentId, entity);

        // Check for pending state that arrived before spawn
        if (this.pendingStates?.has(tentId)) {
            const pendingState = this.pendingStates.get(tentId);
            if (pendingState.position) {
                entity.targetPosition = pendingState.position;
            }
            if (pendingState.rotation !== undefined) {
                entity.targetRotation = pendingState.rotation;
            }
            if (pendingState.state) {
                entity.state = pendingState.state;
            }
            if (pendingState.target) {
                entity.target = pendingState.target;
            }
            if (pendingState.shotCount !== undefined) {
                entity.shotCount = pendingState.shotCount;
            }
            if (pendingState.lastShotTime) {
                entity.lastShotTime = pendingState.lastShotTime;
            }
            if (entity.controller) {
                entity.controller.moving = pendingState.moving || false;
                entity.controller.inCombatStance = pendingState.inCombatStance || false;
                entity.controller.speedMultiplier = pendingState.speedMultiplier || 1.0;
            }
            this.pendingStates.delete(tentId);
        }

        // Register name tag based on entity type
        if (this.game?.nameTagManager && entity.mesh) {
            if (entityType === 'militia') {
                this.game.nameTagManager.registerEntity(`militia_${tentId}`, 'Militia', entity.mesh, { factionId });
            } else if (entityType === 'outpostMilitia') {
                this.game.nameTagManager.registerEntity(`outpostMilitia_${tentId}`, 'Militia', entity.mesh, { factionId });
            } else if (entityType === 'artilleryMilitia') {
                this.game.nameTagManager.registerEntity(`artilleryMilitia_${tentId}`, 'Gunner', entity.mesh, { factionId });
            } else {
                this.game.nameTagManager.registerEntity(`bandit_${tentId}`, 'Bandit', entity.mesh);
            }
        }

        // Register in outpostMilitia tracking if tower militia
        if (entityType === 'outpostMilitia' && this.game?.outpostMilitia) {
            this.game.outpostMilitia.set(tentId, tentId);
        }

        // Register in artilleryMilitia tracking if artillery militia
        if (entityType === 'artilleryMilitia' && this.game?.artilleryMilitia) {
            this.game.artilleryMilitia.set(tentId, tentId);
        }

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
            const syncData = {
                tentId,
                spawnedBy: entity.spawnedBy,
                spawnTime: entity.spawnTime,
                position: { ...entity.position },
                homePosition: { ...entity.homePosition },
                state: entity.state,
                shotCount: entity.shotCount,
                authorityId: entity.authorityId,
                authorityTerm: entity.authorityTerm || 1,  // Heartbeat: include term in sync
            };
            // Include militia fields if present
            if (entity.entityType === 'militia') {
                syncData.entityType = 'militia';
                syncData.factionId = entity.factionId;
                syncData.ownerId = entity.ownerId;
            } else if (entity.entityType === 'outpostMilitia') {
                syncData.entityType = 'outpostMilitia';
                syncData.factionId = entity.factionId;
                syncData.ownerId = entity.ownerId;
                syncData.isTowerMilitia = true;
                syncData.groundPosition = entity.groundPosition;
            } else if (entity.entityType === 'artilleryMilitia') {
                syncData.entityType = 'artilleryMilitia';
                syncData.factionId = entity.factionId;
                syncData.ownerId = entity.ownerId;
                syncData.isArtilleryMilitia = true;
            }
            result.push(syncData);
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
            const entityType = data.entityType || 'bandit';
            const factionId = data.factionId || null;
            const ownerId = data.ownerId || null;

            const entity = {
                tentId: data.tentId,
                type: entityType,
                entityType: entityType,
                factionId: factionId,
                ownerId: ownerId,
                authorityId: data.authorityId || data.spawnedBy,
                authorityTerm: data.authorityTerm || 1,  // Heartbeat: from sync data or default
                spawnedBy: data.spawnedBy,
                spawnTime: data.spawnTime,

                homePosition: { x: home.x, z: home.z },
                position: { ...data.position },
                rotation: 0,

                state: data.state || 'idle',
                target: null,

                path: [],
                pathIndex: 0,
                lastPathTime: Date.now() - Math.random() * 6000, // Stagger to prevent synchronized pathfinding

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

            // Create visual - pass options for militia
            // Compute shirtColor from factionId using CONFIG
            const shirtColor = entityType === 'militia' && factionId
                ? (CONFIG.FACTION_COLORS?.[factionId]?.shirt || CONFIG.FACTION_COLORS?.default?.shirt)
                : null;
            const visualOptions = entityType === 'militia' ? { entityType, factionId, shirtColor } : {};
            const visual = this.createVisual(data.tentId, entity.position, visualOptions);
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

            // Register name tag based on entity type
            if (this.game?.nameTagManager && entity.mesh) {
                if (entityType === 'militia') {
                    this.game.nameTagManager.registerEntity(`militia_${data.tentId}`, 'Militia', entity.mesh, { factionId });
                } else {
                    this.game.nameTagManager.registerEntity(`bandit_${data.tentId}`, 'Bandit', entity.mesh);
                }
            }
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
        // Cache until next tick - positions are captured per tick anyway
        const currentTick = this.tickManager?.getCurrentTick() || 0;
        if (currentTick === this._lastPlayerListTick && this._playerListCache.length > 0) {
            return this._playerListCache;
        }
        this._lastPlayerListTick = currentTick;

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

            // Also add brown bears when using TickManager (via registry)
            const brownBearController = this.registry?.get('brownbear');
            if (brownBearController?.entities) {
                for (const [denId, bear] of brownBearController.entities) {
                    if (bear.state === 'dead') continue;
                    const pos = bear.position;
                    this._playerListCache.push(getPlayerObj(denId, pos.x, pos.z, pos.y || 0, 'brownbear'));
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

        // Add brown bears as targets (same priority as players) via registry
        const brownBearCtrl = this.registry?.get('brownbear');
        if (brownBearCtrl?.entities) {
            for (const [denId, bear] of brownBearCtrl.entities) {
                if (bear.state === 'dead') continue;
                const pos = bear.position;
                this._playerListCache.push(getPlayerObj(denId, pos.x, pos.z, pos.y || 0, 'brownbear'));
            }
        }

        return this._playerListCache;
    }

    /**
     * Build target list for militia entities
     * Militia target: enemy faction players + bandits + brown bears
     * @param {number} chunkX - Center chunk X
     * @param {number} chunkZ - Center chunk Z
     * @param {number} militiaFactionId - Militia's faction (1=Southguard, 3=Northmen)
     * @returns {Array} [{id, x, z, y, type}]
     */
    _buildMilitiaTargetList(chunkX, chunkZ, militiaFactionId) {
        const result = [];
        const chunkKeys = this._get3x3ChunkKeys(chunkX, chunkZ);

        // Helper to create target object
        const createTarget = (id, x, z, y, type) => ({ id, x, z, y: y || 0, type });

        // 1. Add enemy faction players
        if (this.tickManager && this.tickManager.hasSimulationData()) {
            const tickPositions = this.tickManager.getSimulationPositions();
            for (const [playerId, pos] of tickPositions) {
                if (this.isPlayerDead && this.isPlayerDead(playerId)) continue;
                // Check if player is enemy faction
                const playerFaction = this.getPlayerFaction ? this.getPlayerFaction(playerId) : null;
                if (this._isEnemyFaction(militiaFactionId, playerFaction)) {
                    result.push(createTarget(playerId, pos.x, pos.z, pos.y, 'player'));
                }
            }
        } else {
            // Fallback: live positions
            const playerIds = this.getPlayersInChunks(chunkKeys);
            if (playerIds) {
                for (const playerId of playerIds) {
                    if (this.isPlayerDead && this.isPlayerDead(playerId)) continue;
                    const pos = this.getPlayerPosition(playerId);
                    if (!pos) continue;
                    const playerFaction = this.getPlayerFaction ? this.getPlayerFaction(playerId) : null;
                    if (this._isEnemyFaction(militiaFactionId, playerFaction)) {
                        result.push(createTarget(playerId, pos.x, pos.z, pos.y, 'player'));
                    }
                }
            }
        }

        // 2. Add bandits as targets (militia attacks bandits)
        for (const [tentId, entity] of this.entities) {
            if (entity.entityType === 'militia' || entity.entityType === 'outpostMilitia' || entity.entityType === 'artilleryMilitia') continue; // Don't target militia
            if (entity.state === 'dead') continue;
            const pos = entity.position;
            result.push(createTarget(tentId, pos.x, pos.z, pos.y, 'bandit'));
        }

        // 3. Add brown bears as targets
        const brownBearController = this.registry?.get('brownbear');
        if (brownBearController?.entities) {
            for (const [denId, bear] of brownBearController.entities) {
                if (bear.state === 'dead') continue;
                const pos = bear.position;
                result.push(createTarget(denId, pos.x, pos.z, pos.y, 'brownbear'));
            }
        }

        return result;
    }

    /**
     * Update tower militia (stationary shooter)
     * Tower militia stays in position and only shoots at targets in range
     * @param {object} entity - The tower militia entity
     * @param {number} deltaTime - Time since last update
     * @param {number} now - Current timestamp
     * @param {Array} players - Player list (unused, we build our own target list)
     */
    _updateTowerMilitia(entity, deltaTime, now, players) {
        const config = AI_CONFIG.BANDIT;

        // Build target list (enemy faction players + bandits + bears)
        const chunkX = Math.floor(entity.position.x / AI_CONFIG.CHUNK_SIZE);
        const chunkZ = Math.floor(entity.position.z / AI_CONFIG.CHUNK_SIZE);
        const targetList = this._buildMilitiaTargetList(chunkX, chunkZ, entity.factionId);

        // Find closest target in range
        const target = this._findClosestPlayer(entity.position, config.CHASE_RANGE, targetList);
        entity.target = target ? target.id : null;

        // Update visual state
        if (entity.controller) {
            entity.controller.moving = false;  // Tower militia never moves
            entity.controller.inCombatStance = !!target;
        }

        // If we have a target, try to shoot
        if (target) {
            // Face the target
            const dx = target.x - entity.position.x;
            const dz = target.z - entity.position.z;
            entity.rotation = Math.atan2(dx, dz);

            // Update mesh rotation
            if (entity.mesh) {
                entity.mesh.rotation.y = entity.rotation;
            }

            // Try to shoot
            this._tryShoot(entity, target, now);
        }

        // Broadcast state periodically
        if (this._frameCount % 30 === 0) {
            this.broadcastP2P({
                type: 'bandit_state',
                tentId: entity.tentId,
                position: { ...entity.position },
                rotation: entity.rotation,
                state: entity.state,
                target: entity.target,
                shotCount: entity.shotCount,
                moving: false,
                inCombatStance: !!target,
            });
        }
    }

    /**
     * Update artillery militia (stationary gunner operating cannon)
     * Artillery militia stays on artillery, rotates cannon toward targets, and fires
     * @param {object} entity - The artillery militia entity
     * @param {number} deltaTime - Time since last update (ms)
     * @param {number} now - Current timestamp
     * @param {Array} players - Player list (unused, we build our own target list)
     */
    _updateArtilleryMilitia(entity, deltaTime, now, players) {
        // Get artillery reference (may need to look up if not set)
        let artillery = entity.artilleryMesh;
        if (!artillery && entity.artilleryId) {
            // Try to find artillery by ID
            artillery = this._findArtilleryById(entity.artilleryId);
            if (artillery) {
                entity.artilleryMesh = artillery;
            }
        }

        if (!artillery) {
            // Artillery was destroyed or moved out of range - militia dies
            if (!entity._logged.noArtillery) {
                console.warn(`[ArtilleryMilitia] Lost artillery reference for ${entity.tentId} - killing entity`);
                entity._logged.noArtillery = true;

                // Mark as dead so death handling kicks in
                entity.state = 'dead';

                // Broadcast death
                this.broadcastP2P({
                    type: 'bandit_death',
                    tentId: entity.tentId,
                    entityType: 'artilleryMilitia',
                });
            }
            return;
        }

        // Check if artillery is being towed - don't fire, just follow
        const attachState = this.game?.gameState?.artilleryAttachmentState;
        if (attachState?.isAttached && attachState?.artilleryId === entity.artilleryId) {
            // Update position to follow artillery but don't fire
            entity.position.x = artillery.position.x;
            entity.position.z = artillery.position.z;
            entity.position.y = artillery.position.y + 0.1;
            entity.rotation = artillery.rotation.y;
            if (entity.mesh) {
                entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
                entity.mesh.rotation.y = entity.rotation;
            }
            if (entity.controller) {
                entity.controller.moving = false;
                entity.controller.inCombatStance = false;
            }
            return;
        }

        // Update militia position to artillery position (handles ship movement)
        const artilleryWorldPos = new THREE.Vector3();
        artillery.getWorldPosition(artilleryWorldPos);
        entity.position.x = artilleryWorldPos.x;
        entity.position.y = artilleryWorldPos.y + 0.1;
        entity.position.z = artilleryWorldPos.z;

        // Update mesh position
        if (entity.mesh) {
            entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
        }

        // Build target list (enemy faction players + bandits + bears)
        const chunkX = Math.floor(entity.position.x / AI_CONFIG.CHUNK_SIZE);
        const chunkZ = Math.floor(entity.position.z / AI_CONFIG.CHUNK_SIZE);
        const targetList = this._buildMilitiaTargetList(chunkX, chunkZ, entity.factionId);

        // Find nearest target within artillery range
        const ARTILLERY_COMBAT = CONFIG.ARTILLERY_COMBAT || {};
        const range = ARTILLERY_COMBAT.RANGE || 28;
        const target = this._findClosestPlayer(entity.position, range, targetList);
        entity.target = target ? target.id : null;

        // Update visual state
        if (entity.controller) {
            entity.controller.moving = false;  // Artillery militia never moves
            entity.controller.inCombatStance = !!target;
        }

        // If we have a target, rotate artillery and try to fire
        if (target) {
            // Calculate target heading
            const dx = target.x - artilleryWorldPos.x;
            const dz = target.z - artilleryWorldPos.z;
            const targetHeading = Math.atan2(dx, dz);

            // Rotate artillery toward target (gradual rotation using turn rate)
            const turnRate = ARTILLERY_COMBAT.TURN_RATE || (Math.PI * 2) / 6000;
            const maxTurnThisFrame = turnRate * deltaTime;

            // Get current artillery heading
            let currentHeading = artillery.rotation.y;

            // For ship-mounted artillery, apply rotation limits
            const isShipMounted = artillery.parent?.userData?.modelType === 'ship2';
            if (isShipMounted) {
                // Get slot info for rotation limits
                const artilleryShipState = this.game?.gameState?.artilleryShipLoadState;
                const loadedArtillery = artilleryShipState?.loadedArtillery || [];
                const artilleryData = loadedArtillery.find(a => a.artilleryId === entity.artilleryId);

                if (artilleryData) {
                    const slotConfig = CONFIG.CRATE_VEHICLES?.ship2_artillery?.slots?.[artilleryData.slotIndex];
                    if (slotConfig) {
                        const baseRotation = slotConfig.rotation;
                        const maxDeviation = Math.PI / 2;  // +-90 degrees

                        // Calculate rotation toward target with limits
                        let newHeading = this._rotateTowardTarget(currentHeading, targetHeading, maxTurnThisFrame);

                        // Clamp to within +-90 degrees of base rotation
                        const minRotation = baseRotation - maxDeviation;
                        const maxRotation = baseRotation + maxDeviation;
                        newHeading = Math.max(minRotation, Math.min(maxRotation, newHeading));

                        artillery.rotation.y = newHeading;
                    }
                }
            } else {
                // Land artillery: free rotation
                artillery.rotation.y = this._rotateTowardTarget(currentHeading, targetHeading, maxTurnThisFrame);
            }

            // Update militia rotation to match artillery
            entity.rotation = artillery.rotation.y;
            if (entity.mesh) {
                entity.mesh.rotation.y = entity.rotation;
            }

            // Check if target is within firing cone (15 degrees)
            const barrelDir = ARTILLERY_COMBAT.BARREL_DIRECTION || -1;
            const firingHeading = artillery.rotation.y;
            const angleDiff = this._normalizeAngle(targetHeading - firingHeading);
            const CONE_ANGLE = Math.PI / 12;  // 15 degrees

            if (Math.abs(angleDiff) <= CONE_ANGLE) {
                // Target is in cone - try to fire
                this._tryFireArtillery(entity, artillery, target, now);
            }
        }

        // Broadcast state periodically
        if (this._frameCount % 30 === 0) {
            this.broadcastP2P({
                type: 'bandit_state',
                tentId: entity.tentId,
                position: { ...entity.position },
                rotation: entity.rotation,
                state: entity.state,
                target: entity.target,
                shotCount: entity.shotCount,
                moving: false,
                inCombatStance: !!target,
                entityType: 'artilleryMilitia',
            });
        }
    }

    /**
     * Try to fire artillery cannon at target
     * @param {object} entity - The artillery militia entity
     * @param {THREE.Object3D} artillery - The artillery mesh
     * @param {object} target - The target { id, x, y, z, type }
     * @param {number} now - Current timestamp
     */
    _tryFireArtillery(entity, artillery, target, now) {
        const ARTILLERY_COMBAT = CONFIG.ARTILLERY_COMBAT || {};
        const cooldown = ARTILLERY_COMBAT.FIRE_COOLDOWN || 12000;

        // Check cooldown
        if (now - entity.lastFireTime < cooldown) {
            return;
        }

        // Artillery militia doesn't require shells - unlimited ammo

        // Fire!
        entity.lastFireTime = now;
        entity.shotCount++;

        const barrelDir = ARTILLERY_COMBAT.BARREL_DIRECTION || -1;
        const barrelOffset = ARTILLERY_COMBAT.BARREL_OFFSET || { x: 0, y: 0.6, z: 1.2 };

        // Get world position and heading
        const artilleryWorldPos = new THREE.Vector3();
        artillery.getWorldPosition(artilleryWorldPos);

        let worldHeading = artillery.rotation.y;
        const isShipMounted = artillery.parent?.userData?.modelType === 'ship2';
        if (isShipMounted) {
            const artilleryWorldQuat = new THREE.Quaternion();
            artillery.getWorldQuaternion(artilleryWorldQuat);
            const euler = new THREE.Euler().setFromQuaternion(artilleryWorldQuat);
            worldHeading = euler.y;
        }

        // Calculate barrel position for effects
        const barrelPos = {
            x: artilleryWorldPos.x + barrelDir * Math.sin(worldHeading) * barrelOffset.z,
            y: artilleryWorldPos.y + barrelOffset.y,
            z: artilleryWorldPos.z + barrelDir * Math.cos(worldHeading) * barrelOffset.z
        };

        // Play artillery sound
        if (this.game?.audioManager) {
            this.game.audioManager.playPositionalSound('artillery', artillery);
        }

        // Spawn effects
        if (this.game?.effectManager) {
            if (typeof this.game.effectManager.spawnArtilleryMuzzleFlash === 'function') {
                this.game.effectManager.spawnArtilleryMuzzleFlash(barrelPos);
            }
            if (typeof this.game.effectManager.spawnArtillerySmoke === 'function') {
                this.game.effectManager.spawnArtillerySmoke(barrelPos);
            }
        }

        // Calculate distance to target
        const dx = target.x - artilleryWorldPos.x;
        const dz = target.z - artilleryWorldPos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        // Calculate hit chance
        const hitChance = this._calculateArtilleryMilitiaHitChance(
            artilleryWorldPos.y,
            target.y || artilleryWorldPos.y,
            distance,
            artillery.userData?.quality || 50
        );

        const roll = this._deterministicRandom(entity.tentId, entity.shotCount);
        const isHit = roll < hitChance;

        // Process hit/miss
        if (isHit) {
            this._applyArtilleryMilitiaDamage(entity, target);
            if (!entity._logged.firing) {
                console.log(`[ArtilleryMilitia] HIT ${target.type} at ${distance.toFixed(1)}u`);
                entity._logged.firing = true;
            }
        } else {
            console.log(`[ArtilleryMilitia] MISS ${target.type} at ${distance.toFixed(1)}u`);
        }

        // Spawn impact effect
        const impactPos = isHit ? { x: target.x, y: target.y || artilleryWorldPos.y, z: target.z } :
            this._calculateMissPosition(target, worldHeading, artilleryWorldPos);
        if (this.game?.effectManager && impactPos) {
            if (typeof this.game.effectManager.spawnArtilleryImpact === 'function') {
                this.game.effectManager.spawnArtilleryImpact(impactPos, isHit);
            }
        }

        // Broadcast fire event to peers
        this.broadcastP2P({
            type: 'artillery_militia_fire',
            artilleryId: entity.artilleryId,
            heading: worldHeading,
            impactPos: [impactPos.x, impactPos.y, impactPos.z],
            isHit: isHit,
            targetType: target.type,
        });
    }

    /**
     * Calculate hit chance for artillery militia
     * @param {number} shooterY - Shooter Y position
     * @param {number} targetY - Target Y position
     * @param {number} distance - Distance to target
     * @param {number} quality - Artillery quality (0-100)
     * @returns {number} Hit chance (0-1)
     */
    _calculateArtilleryMilitiaHitChance(shooterY, targetY, distance, quality) {
        const ARTILLERY = CONFIG.ARTILLERY_COMBAT || {};
        const baseChance = ARTILLERY.BASE_HIT_CHANCE || 0.35;
        const maxChance = ARTILLERY.MAX_HIT_CHANCE || 0.8;
        const pointBlank = ARTILLERY.POINT_BLANK_RANGE || 8;
        const heightBonus = ARTILLERY.HEIGHT_BONUS || 0.15;

        const heightAdvantage = Math.max(0, shooterY - targetY);
        let hitChance = Math.min(maxChance, baseChance + heightAdvantage * heightBonus);

        // Distance bonus (closer = better)
        const distanceBonus = Math.max(0, (pointBlank - distance) / pointBlank);
        hitChance = hitChance + (1.0 - hitChance) * distanceBonus;

        // Quality bonus
        hitChance = hitChance * (0.8 + quality * 0.004);

        return Math.min(maxChance, hitChance);
    }

    /**
     * Apply damage from artillery militia hit
     * @param {object} entity - The artillery militia entity
     * @param {object} target - The target { id, x, y, z, type }
     */
    _applyArtilleryMilitiaDamage(entity, target) {
        if (target.type === 'bandit') {
            // Kill bandit via registry
            if (this.registry) {
                this.registry.killEntity('bandit', target.id, entity.tentId);
            }
        } else if (target.type === 'brownbear') {
            // Kill brown bear via registry
            if (this.registry) {
                this.registry.killEntity('brownbear', target.id, entity.tentId);
            }
        } else if (target.type === 'player') {
            // Add to pending kills and broadcast
            entity.pendingKills.add(target.id);
            this.broadcastP2P({
                type: 'bandit_shoot',  // Reuse bandit shoot message for damage
                tentId: entity.tentId,
                targetId: target.id,
                didHit: true,
                shotCount: entity.shotCount,
                isArtillery: true,  // Flag to indicate artillery damage
            });
        }
    }

    /**
     * Calculate miss position for artillery
     * @param {object} target - Target position
     * @param {number} heading - Artillery heading
     * @param {THREE.Vector3} artilleryPos - Artillery world position
     * @returns {object} Miss position { x, y, z }
     */
    _calculateMissPosition(target, heading, artilleryPos) {
        const spread = 2 + Math.random() * 3;
        const angle = heading + (Math.random() - 0.5) * Math.PI / 4;
        return {
            x: target.x + Math.sin(angle) * spread,
            y: target.y || artilleryPos.y,
            z: target.z + Math.cos(angle) * spread
        };
    }

    /**
     * Rotate toward target heading with max turn amount
     * @param {number} current - Current heading
     * @param {number} target - Target heading
     * @param {number} maxTurn - Maximum turn amount
     * @returns {number} New heading
     */
    _rotateTowardTarget(current, target, maxTurn) {
        let angleDiff = target - current;
        // Normalize to -PI to PI
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        // Clamp rotation amount
        const turnAmount = Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), maxTurn);
        return current + turnAmount;
    }

    /**
     * Normalize angle to -PI to PI
     * @param {number} angle
     * @returns {number}
     */
    _normalizeAngle(angle) {
        while (angle > Math.PI) angle -= Math.PI * 2;
        while (angle < -Math.PI) angle += Math.PI * 2;
        return angle;
    }

    /**
     * Find artillery mesh by ID
     * @param {string} artilleryId - Artillery object ID
     * @returns {THREE.Object3D|null}
     */
    _findArtilleryById(artilleryId) {
        // Search in chunk objects
        if (this.game?.chunkLoader?.loadedChunks) {
            for (const [chunkKey, chunk] of this.game.chunkLoader.loadedChunks) {
                if (chunk.objects) {
                    for (const obj of chunk.objects) {
                        if (obj.userData?.objectId === artilleryId && obj.userData?.modelType === 'artillery') {
                            return obj;
                        }
                    }
                }
            }
        }
        // Also check scene directly
        if (this.game?.scene) {
            let found = null;
            this.game.scene.traverse((child) => {
                if (child.userData?.objectId === artilleryId && child.userData?.modelType === 'artillery') {
                    found = child;
                }
            });
            if (found) return found;
        }
        return null;
    }

    /**
     * Check if two factions are enemies
     * Southguard (1) and Northmen (3) are enemies
     * @param {number} factionA
     * @param {number} factionB
     * @returns {boolean}
     */
    _isEnemyFaction(factionA, factionB) {
        // Neutral players (null) have no enemies
        if (factionA === null || factionB === null) return false;
        // Southguard (1) and Northmen (3) are enemies
        return factionA !== factionB;
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
        
        // Find minimum player id among near-equal candidates (deterministic)
        // O(n) single-pass instead of O(n²) bubble sort
        if (nearEqualCount > 1) {
            let minIndex = 0;
            let minId = this._candidatesCache[0].player.id;

            for (let i = 1; i < nearEqualCount; i++) {
                const id = this._candidatesCache[i].player.id;
                // Simple string comparison - lexicographic, deterministic, fast
                if (id < minId) {
                    minIndex = i;
                    minId = id;
                }
            }

            // Swap minimum to front
            if (minIndex !== 0) {
                const temp = this._candidatesCache[0];
                this._candidatesCache[0] = this._candidatesCache[minIndex];
                this._candidatesCache[minIndex] = temp;
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

        // Initialize terrain frame counter
        if (entity.terrainFrameCount === undefined) {
            entity.terrainFrameCount = 0;
            entity.cachedSpeedMultiplier = 1.0;
        }
        entity.terrainFrameCount++;

        let speedMultiplier = entity.cachedSpeedMultiplier;

        // Road speed bonus
        if (entity.cachedOnRoad) {
            speedMultiplier *= 1.6;
        }

        const moveSpeed = config.MOVE_SPEED * speedMultiplier * (deltaTime / 1000);
        const moveSpeedSq = moveSpeed * moveSpeed;

        let newX, newZ;

        // Check if we can reach waypoint this frame (avoid sqrt when possible)
        if (moveSpeedSq >= distSq) {
            // Would overshoot - snap directly to waypoint
            newX = waypoint.x;
            newZ = waypoint.z;
        } else {
            // Need actual distance for direction normalization
            const dist = Math.sqrt(distSq);
            const dirX = dx / dist;
            const dirZ = dz / dist;
            newX = entity.position.x + dirX * moveSpeed;
            newZ = entity.position.z + dirZ * moveSpeed;

            // Recalculate slope every 5 frames (uses normalized direction)
            if (entity.terrainFrameCount % 5 === 0 && this.getTerrainHeight) {
                const currentHeight = this.getTerrainHeight(entity.position.x, entity.position.z) || 0;
                const aheadHeight = this.getTerrainHeight(
                    entity.position.x + dirX,
                    entity.position.z + dirZ
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
        }
        
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

        // Face movement direction (atan2 doesn't need normalized vectors)
        entity.rotation = Math.atan2(dx, dz);
        
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

    /**
     * Calculate terrain-aware speed for non-authority interpolation
     * Matches authority movement speed calculation for smooth prediction
     * @param {object} entity - Entity state
     * @param {number} dirX - Movement direction X (normalized)
     * @param {number} dirZ - Movement direction Z (normalized)
     * @returns {number} Speed in units per second
     */
    _calculateTerrainSpeed(entity, dirX, dirZ) {
        const config = AI_CONFIG.BANDIT;
        const now = Date.now();

        // Refresh terrain cache every 250ms
        if (now - (entity._lastTerrainCheck || 0) > 250) {
            entity._lastTerrainCheck = now;

            const posX = entity.position.x;
            const posZ = entity.position.z;

            // Road check
            entity._cachedOnRoad = this.isOnRoad ? this.isOnRoad(posX, posZ) : false;

            // Slope check
            if (this.getTerrainHeight) {
                const currentHeight = this.getTerrainHeight(posX, posZ) || 0;
                const aheadHeight = this.getTerrainHeight(posX + dirX, posZ + dirZ) || 0;

                const slope = Math.abs(aheadHeight - currentHeight);
                const slopeDegrees = Math.atan(slope) * 57.2957795;
                const normalized = slopeDegrees * 0.0222222; // /45
                const clamped = normalized > 1.0 ? 1.0 : normalized;
                const slopeMultiplier = 1.0 - clamped * 0.9;
                entity._cachedSlopeMultiplier = slopeMultiplier > 0.1 ? slopeMultiplier : 0.1;
            } else {
                entity._cachedSlopeMultiplier = 1.0;
            }
        }

        // Road bonus (1.6x) and slope penalty
        const speedMultiplier = (entity._cachedOnRoad ? 1.6 : 1.0) * (entity._cachedSlopeMultiplier || 1.0);
        return config.MOVE_SPEED * speedMultiplier;
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
        
        // Distance to target (use squared for range check first)
        const dx = target.x - entity.position.x;
        const dz = target.z - entity.position.z;
        const distanceSq = dx * dx + dz * dz;

        // Shooting range (height advantage bonus - max at 2 units height)
        const heightAdvantage = entity.position.y - (target.y || 0);
        const shootingRange = Math.min(
            config.SHOOT_RANGE_MAX,
            config.SHOOT_RANGE_MIN + Math.max(0, heightAdvantage) * config.SHOOT_RANGE_HEIGHT_BONUS
        );
        const shootingRangeSq = shootingRange * shootingRange;

        // Early out with squared comparison (avoid sqrt when out of range)
        if (distanceSq > shootingRangeSq) {
            return;
        }

        // Only compute actual distance when in range (needed for accuracy calculation)
        const distance = Math.sqrt(distanceSq);

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
            if (target.type === 'brownbear') {
                // Kill brown bear immediately via registry
                this.registry?.killEntity('brownbear', target.id, entity.tentId);
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

        // Dead entities do nothing - except tower militia doing descent animation
        if (entity.state === 'dead') {
            // Artillery militia: just die at position (release artillery)
            if (entity.isArtilleryMilitia && !entity.deathApplied) {
                entity.deathApplied = true;

                // Clear artillery occupied status
                if (this.game?.mobileEntitySystem && entity.artilleryId) {
                    this.game.mobileEntitySystem.clearOccupied(entity.artilleryId);
                }

                // Remove from artilleryMilitia tracking
                if (this.game?.artilleryMilitia) {
                    this.game.artilleryMilitia.delete(entity.tentId);
                }

                // Trigger death animation
                if (entity.controller && typeof entity.controller.kill === 'function') {
                    entity.controller.kill();
                }

                // Schedule entity removal after death animation (5 seconds)
                const entityId = entity.tentId;
                setTimeout(() => {
                    this._destroyEntity(entityId);
                }, 5000);

                console.log(`[ArtilleryMilitia] Gunner killed at artillery ${entity.artilleryId}`);
                return;
            }

            // Tower militia: handle descent animation before death (both authority and non-authority)
            if (entity.isTowerMilitia && !entity.deathApplied) {
                // Authority: run descent animation
                if (entity.authorityId === this.clientId) {
                    // Start descent if not started
                    if (!entity.descentStartTime) {
                        entity.descentStartTime = now;
                        entity.descentStartY = entity.position.y;
                        entity.descentEndY = entity.groundPosition?.y || (entity.position.y - 1.5);
                        console.log(`[OutpostMilitia] Starting descent from Y=${entity.descentStartY} to Y=${entity.descentEndY}`);
                    }

                    // Animate descent (2 seconds)
                    const elapsed = now - entity.descentStartTime;
                    const progress = Math.min(1.0, elapsed / entity.descentDuration);

                    // Lerp Y position
                    entity.position.y = entity.descentStartY + (entity.descentEndY - entity.descentStartY) * progress;

                    // Update visual
                    if (entity.mesh) {
                        entity.mesh.position.y = entity.position.y;
                    }

                    // Broadcast position during descent
                    if (this._frameCount % 10 === 0) {
                        this.broadcastP2P({
                            type: 'bandit_state',
                            tentId: entity.tentId,
                            position: { ...entity.position },
                            rotation: entity.rotation,
                            state: 'dead',
                            descentProgress: progress,
                        });
                    }

                    // At end of descent, trigger death animation
                    if (progress >= 1.0) {
                        entity.deathApplied = true;
                        console.log(`[OutpostMilitia] Descent complete, applying death`);

                        // Remove from outpostMilitia tracking
                        if (this.game?.outpostMilitia) {
                            this.game.outpostMilitia.delete(entity.tentId);
                        }

                        // Trigger death animation
                        if (entity.controller && typeof entity.controller.kill === 'function') {
                            entity.controller.kill();
                        }

                        // Schedule entity removal after death animation (5 seconds)
                        const entityId = entity.tentId;
                        setTimeout(() => {
                            this._destroyEntity(entityId);
                        }, 5000);
                    }
                } else {
                    // Non-authority: interpolate Y position during descent
                    this._interpolateEntity(entity, deltaTime);

                    // Update visual
                    if (entity.mesh) {
                        entity.mesh.position.copy(entity.position);
                    }

                    // Check if descent is complete (use stored groundPosition Y)
                    const groundY = entity.groundPosition?.y;
                    if (groundY !== undefined && Math.abs(entity.position.y - groundY) < 0.1 && !entity.deathApplied) {
                        entity.deathApplied = true;

                        // Remove from outpostMilitia tracking
                        if (this.game?.outpostMilitia) {
                            this.game.outpostMilitia.delete(entity.tentId);
                        }

                        // Trigger death animation
                        if (entity.controller && typeof entity.controller.kill === 'function') {
                            entity.controller.kill();
                        }

                        // Schedule entity removal after death animation (5 seconds)
                        const entityId = entity.tentId;
                        setTimeout(() => {
                            this._destroyEntity(entityId);
                        }, 5000);
                    }
                }
                return; // Don't process any other state logic
            }
            return;
        }

        // Non-authority: interpolate only
        if (entity.authorityId !== this.clientId) {
            this._interpolateEntity(entity, deltaTime);
            return;
        }

        // === AUTHORITY LOGIC BELOW ===

        // Tower militia: stationary, only shoots - no movement logic
        if (entity.isTowerMilitia) {
            this._updateTowerMilitia(entity, deltaTime, now, players);
            return;
        }

        // Artillery militia: stationary on artillery, fires cannon
        if (entity.isArtilleryMilitia) {
            this._updateArtilleryMilitia(entity, deltaTime, now, players);
            return;
        }

        // Get target list based on entity type
        // Militia use different targeting (enemy faction players + bandits + bears)
        let targetList = players;
        if (entity.entityType === 'militia' && entity.factionId) {
            const chunkX = Math.floor(entity.position.x / AI_CONFIG.CHUNK_SIZE);
            const chunkZ = Math.floor(entity.position.z / AI_CONFIG.CHUNK_SIZE);
            targetList = this._buildMilitiaTargetList(chunkX, chunkZ, entity.factionId);
        }

        // Find target (idle: throttled, active: every frame)
        let target = null;
        if (entity.state === 'idle') {
            if (this._frameCount % config.IDLE_CHECK_INTERVAL === 0) {
                target = this._findClosestPlayer(entity.position, config.CHASE_RANGE, targetList);
            }
        } else {
            target = this._findClosestPlayer(entity.position, config.CHASE_RANGE, targetList);
        }
        
        // Store target for broadcast
        entity.target = target ? target.id : null;

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
                    const distToTargetSq = dx * dx + dz * dz;
                    const engagementDistSq = config.ENGAGEMENT_DISTANCE * config.ENGAGEMENT_DISTANCE;

                    if (distToTargetSq <= engagementDistSq) {
                        // Close enough - stop and shoot
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

            default:
                console.warn(`[Bandit ${entity.tentId}] Invalid state: "${entity.state}", resetting to idle`);
                entity.state = 'idle';
                entity.path = [];
                entity.pathIndex = 0;
                if (entity.controller) {
                    entity.controller.inCombatStance = false;
                    entity.controller.moving = false;
                }
                break;
        }

        // Update animation mixer for authority client
        if (entity.controller && typeof entity.controller.update === 'function') {
            entity.controller.update(deltaTime);
        }
    }

    // =========================================================================
    // NON-AUTHORITY INTERPOLATION
    // =========================================================================

    /**
     * Interpolate entity toward authority state with smooth walking
     * Uses terrain-aware speed matching authority for smooth prediction
     * @param {object} entity
     * @param {number} deltaTime - ms
     */
    _interpolateEntity(entity, deltaTime) {
        const target = entity.targetPosition;
        if (!target) return;

        const SNAP_THRESHOLD_SQ = 0.0025; // 0.05^2 - Snap when very close
        const TELEPORT_THRESHOLD_SQ = 100; // 10^2 - Teleport if too far (desync recovery)
        const CATCHUP_THRESHOLD_SQ = 1.0; // 1 unit - speed up if lagging behind

        const pos = entity.position;
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        const distSq = dx * dx + dz * dz;

        let isMoving = false;

        if (distSq > TELEPORT_THRESHOLD_SQ) {
            // Too far - teleport to recover from major desync
            pos.x = target.x;
            pos.z = target.z;
        } else if (distSq < SNAP_THRESHOLD_SQ) {
            // Close enough - snap to target
            pos.x = target.x;
            pos.z = target.z;
        } else {
            isMoving = true;
            const dist = Math.sqrt(distSq);
            const dirX = dx / dist;
            const dirZ = dz / dist;

            // Use terrain-aware speed (matches authority calculation)
            const baseSpeed = this._calculateTerrainSpeed(entity, dirX, dirZ);
            // Catch-up multiplier when lagging behind
            const catchUpMultiplier = distSq > CATCHUP_THRESHOLD_SQ ? 1.5 : 1.0;
            const speed = baseSpeed * catchUpMultiplier;

            const deltaSeconds = deltaTime / 1000;
            const moveDist = speed * deltaSeconds;
            const actualMove = moveDist < dist ? moveDist : dist;

            pos.x += dirX * actualMove;
            pos.z += dirZ * actualMove;
        }

        // Y position - fast lerp to match terrain (8.0 factor like BaseWorkerController)
        // Exception: tower militia uses target Y (elevated position or descending)
        if (entity.isTowerMilitia && target.y !== undefined) {
            // Tower militia: use target Y directly (tower height or descending)
            const yLerpFactor = 8.0 * (deltaTime / 1000);
            const clampedLerp = yLerpFactor > 1.0 ? 1.0 : yLerpFactor;
            pos.y += (target.y - pos.y) * clampedLerp;
        } else if (this.getTerrainHeight) {
            const targetY = this.getTerrainHeight(pos.x, pos.z);
            const yLerpFactor = 8.0 * (deltaTime / 1000);
            const clampedLerp = yLerpFactor > 1.0 ? 1.0 : yLerpFactor;
            pos.y += (targetY - pos.y) * clampedLerp;
        } else if (target.y !== undefined) {
            const yLerpFactor = 8.0 * (deltaTime / 1000);
            const clampedLerp = yLerpFactor > 1.0 ? 1.0 : yLerpFactor;
            pos.y += (target.y - pos.y) * clampedLerp;
        }

        // Rotation - face movement direction when moving
        let targetRotation;
        if (isMoving) {
            targetRotation = Math.atan2(dx, dz);
        } else if (entity.targetRotation !== undefined) {
            targetRotation = entity.targetRotation;
        } else {
            targetRotation = entity.rotation;
        }

        let rotDiff = targetRotation - entity.rotation;
        while (rotDiff > 3.14159265) rotDiff -= 6.283185307;
        while (rotDiff < -3.14159265) rotDiff += 6.283185307;

        const maxRotation = 2.1 * (deltaTime / 1000);
        if (rotDiff > maxRotation) rotDiff = maxRotation;
        else if (rotDiff < -maxRotation) rotDiff = -maxRotation;
        entity.rotation += rotDiff;

        // Sync mesh
        const mesh = entity.mesh;
        if (mesh) {
            mesh.position.set(pos.x, pos.y, pos.z);
            mesh.rotation.y = entity.rotation;
        }

        // Update animation - sync moving state
        if (entity.controller) {
            entity.controller.moving = isMoving;
            if (typeof entity.controller.update === 'function') {
                entity.controller.update(deltaTime);
            }
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

        // Find lowest clientId - O(n) single-pass instead of O(n log n) sort
        // Uses string < comparison - deterministic for "session_xxx" format IDs
        let lowestId = null;
        for (const playerId of players) {
            // Heartbeat: skip stale players (no recent updates)
            if (this.isPlayerActive && !this.isPlayerActive(playerId)) continue;

            if (lowestId === null || playerId < lowestId) {
                lowestId = playerId;
            }
        }
        return lowestId;
    }

    /**
     * Check for stale authorities and reclaim if needed (Heartbeat system)
     * Called before broadcasting state each tick
     * Uses deterministic authority calculation to prevent race conditions
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
                    console.log(`[AIController] Reclaiming bandit ${entityId} from wrong authority ${entity.authorityId}`);
                    this._claimAuthority(entityId, entity);
                }
            }
        }
    }

    /**
     * Claim authority over an entity (Heartbeat system)
     * @param {string} entityId
     * @param {object} entity
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
            if (entity.controller?.mesh) {
                entity.controller.mesh.position.set(
                    entity.position.x,
                    entity.position.y,
                    entity.position.z
                );
            }
            this._broadcastEntityState(entity, entityId);
        }
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
            authorityId: entity.authorityId,           // Heartbeat: include authority
            authorityTerm: entity.authorityTerm || 1,  // Heartbeat: include term
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

                } else {
                    // No players in range to take over authority
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
        const [newX, newZ] = newChunkKey.split(',').map(Number);

        for (const [tentId, entity] of this.entities) {
            const homeChunkX = Math.floor(entity.homePosition.x / CHUNK_SIZE);
            const homeChunkZ = Math.floor(entity.homePosition.z / CHUNK_SIZE);
            const dx = Math.abs(newX - homeChunkX);
            const dz = Math.abs(newZ - homeChunkZ);
            const isNowInRange = dx <= 1 && dz <= 1;

            // Case 1: Current authority left the region
            if (entity.authorityId === peerId && !isNowInRange) {
                const newAuthority = this._calculateAuthority(tentId);
                if (newAuthority) {
                    const wasMe = entity.authorityId === this.clientId;
                    const isNowMe = newAuthority === this.clientId;
                    entity.authorityId = newAuthority;

                    // If we're taking over authority, handle position transfer
                    if (isNowMe && !wasMe) {
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
                }
            }
            // Case 2: A peer entered the region - they might have lower clientId
            else if (isNowInRange && entity.authorityId !== peerId) {
                const newAuthority = this._calculateAuthority(tentId);
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

                        if (entity.controller?.mesh) {
                            entity.controller.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
                        }

                        this._broadcastEntityState(entity, tentId);
                    }
                }
            }
        }
    }

    /**
     * Handle new peer joining a chunk - recalculate authority for nearby entities
     * Called when a peer's first position is received
     * @param {string} peerId - The new peer's ID
     * @param {string} chunkKey - The chunk the peer joined
     */
    onPeerJoinedChunk(peerId, chunkKey) {
        const CHUNK_SIZE = AI_CONFIG.CHUNK_SIZE;
        const [peerChunkX, peerChunkZ] = chunkKey.split(',').map(Number);

        for (const [tentId, entity] of this.entities) {
            // Check if peer is in 3x3 area around entity's home position
            const homeChunkX = Math.floor(entity.homePosition.x / CHUNK_SIZE);
            const homeChunkZ = Math.floor(entity.homePosition.z / CHUNK_SIZE);
            const dx = Math.abs(peerChunkX - homeChunkX);
            const dz = Math.abs(peerChunkZ - homeChunkZ);

            if (dx <= 1 && dz <= 1) {
                // Peer is near this entity - always recalculate authority
                // (removed skip condition that caused authority desync)
                const newAuthority = this._calculateAuthority(tentId);
                if (newAuthority && newAuthority !== entity.authorityId) {
                    const wasMe = entity.authorityId === this.clientId;
                    const isNowMe = newAuthority === this.clientId;
                    entity.authorityId = newAuthority;

                    // If we gained authority, snap position and broadcast immediately
                    if (isNowMe && !wasMe) {
                        // Snap to last known target position if available
                        if (entity.targetPosition) {
                            entity.position.x = entity.targetPosition.x;
                            entity.position.y = entity.targetPosition.y;
                            entity.position.z = entity.targetPosition.z;
                        }

                        // Sync mesh position
                        if (entity.controller?.mesh) {
                            entity.controller.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
                        }

                        // Immediately broadcast so other peers sync to us
                        this._broadcastEntityState(entity, tentId);
                    }
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
        const { tentId, authorityId, authorityTerm, position, rotation, state, target, shotCount, lastShotTime, pendingKills, moving, inCombatStance, speedMultiplier } = data;

        const entity = this.entities.get(tentId);
        if (!entity) {
            // Entity doesn't exist yet - store pending state for when it spawns
            // This handles race condition where state arrives before spawn/sync
            this.pendingStates = this.pendingStates || new Map();
            this.pendingStates.set(tentId, data);
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

        // Validate Y position before applying
        let validY = position.y;
        if (!Number.isFinite(validY) || validY <= 0) {
            // Invalid Y - use terrain height as fallback
            if (this.getTerrainHeight) {
                validY = this.getTerrainHeight(position.x, position.z);
            }
            if (!Number.isFinite(validY) || validY <= 0) {
                validY = entity.position?.y || 0;
            }
        }

        // Store for interpolation
        entity.targetPosition = { x: position.x, y: validY, z: position.z };
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

        // Handle brown bear kills from peers via registry
        if (didHit && targetType === 'brownbear') {
            this.registry?.killEntity('brownbear', targetId, tentId);
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

        if (entity._logged) {
            entity._logged.dead = true;
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
        // Heartbeat: check for stale authorities before broadcasting
        this._checkStaleAuthorities();

        for (const [tentId, entity] of this.entities) {
            if (entity.authorityId !== this.clientId) continue;
            if (entity.state === 'dead') continue;

            // Performance: Reuse pre-allocated message object to avoid GC pressure
            const msg = this._broadcastMsg;
            msg.tentId = tentId;
            msg.authorityId = entity.authorityId;           // Heartbeat: include authority
            msg.authorityTerm = entity.authorityTerm || 1;  // Heartbeat: include term
            msg.position.x = entity.position.x;
            msg.position.y = entity.position.y;
            msg.position.z = entity.position.z;
            msg.rotation = entity.rotation;
            msg.state = entity.state;
            msg.target = entity.target;
            msg.shotCount = entity.shotCount;
            msg.lastShotTime = entity.lastShotTime;

            // Reuse pendingKills array - clear and copy elements
            msg.pendingKills.length = 0;
            for (const kill of entity.pendingKills) {
                msg.pendingKills.push(kill);
            }

            msg.moving = entity.controller?.moving || false;
            msg.inCombatStance = entity.controller?.inCombatStance || false;
            msg.speedMultiplier = entity.controller?.speedMultiplier || 1.0;

            this.broadcastP2P(msg);
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

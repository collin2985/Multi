import { BaseAIController } from './BaseAIController.js';

/**
 * DeerController.js
 * Ambient deer AI with authority-based P2P sync
 * 
 * States:
 * - IDLE: Standing still for 10 seconds, checks for threats on exit
 * - WANDERING: Walking in random direction at 0.5u/s for 5 seconds
 * - FLEEING: Running away from threat at 2u/s for 20 seconds
 * 
 * Threat detection:
 * - Player within 10 units
 * - Gunshot within 50 units
 * - Any non-natural object within 10 units (not tree/rock/vegetable)
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEER_CONFIG = {
    CHUNK_SIZE: 50,
    
    // Spawning
    SPAWN_HEIGHT_MIN: 0.5,  // Don't spawn in water
    
    // Movement speeds
    WANDER_SPEED: 0.5,      // Units per second
    FLEE_SPEED: 2.0,        // Units per second
    
    // State durations (ms)
    IDLE_DURATION: 10000,
    WANDER_DURATION: 5000,
    FLEE_DURATION: 20000,
    
    // Detection
    PLAYER_DETECT_RANGE: 10,
    OBJECT_DETECT_RANGE: 10,
    GUNSHOT_DETECT_RANGE: 50,
    
    // Rotation
    TURN_SPEED: 5.0,        // Radians per second
    
    // P2P sync
    BROADCAST_INTERVAL: 100,  // ms between position broadcasts
    
    // Natural objects (don't flee from these)
    NATURAL_OBJECTS: [
        'tree', 'pine', 'oak', 'fir', 'cypress', 'apple',
        'rock', 'limestone', 'sandstone', 'clay', 'iron',
        'vegetable', 'vegetables', 'grass', 'bush', 'flower'
    ],

    // Combat (deer are targets, not shooters)
    COMBAT_RANGE: 35,              // Player enters combat when this close
    DEATH_ANIMATION_DURATION: 500, // ms for fall animation
    CORPSE_DURATION_TICKS: 120,    // Server ticks before corpse cleanup (2 minutes at 1 tick/sec)
    HARVEST_RANGE: 3,              // Units to be near corpse for harvesting
};

// =============================================================================
// DEER CONTROLLER CLASS
// =============================================================================

export class DeerController extends BaseAIController {
    constructor() {
        super({
            entityType: 'deer',
            entityIdField: 'chunkKey',
            messagePrefix: 'deer',
            broadcastInterval: DEER_CONFIG.BROADCAST_INTERVAL,
        });

        // State (entities Map inherited from BaseAIController)
        this._frameCount = 0;

        // Deer-specific callbacks (some inherited from BaseAIController)
        this.getPlayersInChunks = null;
        this.getPlayerPosition = null;
        this.getChunkObjects = null;
        this.broadcastP2P = null;

        // Gunshot tracking
        this._recentGunshots = [];  // [{x, z, time}]

        // Seeded RNG for deterministic spawns
        this._rngState = 12345;

        // Area occupancy tracking for coordinated despawn
        // Tracks chunks where deer previously existed but were despawned due to all players leaving
        // Respawn is only allowed for chunks in this set (prevents immediate respawn on re-entry)
        this._vacantChunks = new Set();  // chunkKeys where all players left -> can respawn

        // Track which chunks we've seen with players (for detecting "all players left")
        this._occupiedChunks = new Set();  // chunkKeys that currently have players in 3x3 area
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    initialize(config) {
        const required = [
            'clientId',
            'getPlayersInChunks',
            'getPlayerPosition',
            'getTerrainHeight',
            'getChunkObjects',
            'getServerTick',
            'createVisual',
            'destroyVisual',
            'broadcastP2P',
        ];
        
        for (const key of required) {
            if (config[key] === undefined) {
                console.error(`[DeerController] Missing required config: ${key}`);
            }
            this[key] = config[key];
        }

        // Optional: game reference for name tags
        if (config.game) {
            this.game = config.game;
        }
    }

    // =========================================================================
    // SEEDED RANDOM
    // =========================================================================

    _seededRandom(seed) {
        // Simple LCG
        const a = 1664525;
        const c = 1013904223;
        const m = Math.pow(2, 32);
        seed = (a * seed + c) % m;
        return seed / m;
    }

    _getChunkSpawnPosition(chunkX, chunkZ) {
        // Deterministic position based on chunk coordinates
        const seed = chunkX * 73856093 ^ chunkZ * 19349663;
        const r1 = this._seededRandom(seed);
        const r2 = this._seededRandom(seed + 1);
        
        const x = (chunkX * DEER_CONFIG.CHUNK_SIZE) + (r1 * DEER_CONFIG.CHUNK_SIZE);
        const z = (chunkZ * DEER_CONFIG.CHUNK_SIZE) + (r2 * DEER_CONFIG.CHUNK_SIZE);
        
        return { x, z };
    }

    // =========================================================================
    // SPAWNING
    // =========================================================================

    // _get3x3ChunkKeys inherited from BaseAIController

    /**
     * Check spawns on server tick (like bandits)
     * Called from game loop on tick - coordinates spawn decisions across peers
     * @param {number} chunkX - Player's current chunk X
     * @param {number} chunkZ - Player's current chunk Z
     */
    checkSpawnsOnTick(chunkX, chunkZ) {
        // Guard against invalid chunk coordinates
        if (chunkX === null || chunkZ === null ||
            chunkX === undefined || chunkZ === undefined ||
            isNaN(chunkX) || isNaN(chunkZ)) {
            return;
        }

        // Check 3x3 grid around player
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const cx = chunkX + dx;
                const cz = chunkZ + dz;
                const chunkKey = `${cx},${cz}`;

                // Skip if already exists
                if (this.entities.has(chunkKey)) {
                    // Mark as occupied and continue
                    this._occupiedChunks.add(chunkKey);
                    continue;
                }

                // Respawn gating: only spawn if this is a fresh chunk OR all players previously left
                // First-time spawns are allowed (chunk never seen before)
                // Re-spawns only allowed after confirmed vacancy (all players left 3x3 area)
                const isFirstSpawn = !this._occupiedChunks.has(chunkKey);
                const canRespawn = this._vacantChunks.has(chunkKey);

                // Mark as occupied AFTER checking isFirstSpawn
                this._occupiedChunks.add(chunkKey);

                if (!isFirstSpawn && !canRespawn) {
                    // Chunk was occupied but deer doesn't exist and wasn't marked vacant
                    // This means deer was killed/harvested but area never became vacant - skip spawn
                    continue;
                }

                // Skip if position is underwater
                const pos = this._getChunkSpawnPosition(cx, cz);
                const y = this.getTerrainHeight(pos.x, pos.z);
                if (y < DEER_CONFIG.SPAWN_HEIGHT_MIN) continue;

                // Gather all players in 3x3 area around this chunk
                const nearbyIds = [this.clientId];
                const chunkKeys = this._get3x3ChunkKeys(cx, cz);
                const playerIds = this.getPlayersInChunks(chunkKeys);

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
                    // Clear vacant status since we're spawning
                    this._vacantChunks.delete(chunkKey);
                    this._spawnDeer(cx, cz);
                }
            }
        }

        // Check area occupancy for existing entities (authority-only despawn check)
        this._checkAreaOccupancy();
    }

    /**
     * Check if all players have left the 3x3 area around each deer
     * If so, despawn the deer and broadcast to peers
     * Only authority performs this check
     */
    _checkAreaOccupancy() {
        const toDespawn = [];

        for (const [chunkKey, entity] of this.entities) {
            // Only authority checks for despawn
            if (entity.authorityId !== this.clientId) continue;

            // Don't despawn dead deer (let corpse timer handle it)
            if (entity.isDead) continue;

            // Get all players in 3x3 area around this deer's spawn chunk
            const chunkKeys = this._get3x3ChunkKeys(entity.chunkX, entity.chunkZ);
            const playerIds = this.getPlayersInChunks(chunkKeys) || [];

            // Check if ANY player (including self) is in the 3x3 area
            let hasPlayersInArea = false;

            // Check peers
            for (const playerId of playerIds) {
                hasPlayersInArea = true;
                break;
            }

            // Check self
            if (!hasPlayersInArea && this.getPlayerPosition) {
                const myPos = this.getPlayerPosition(this.clientId);
                if (myPos) {
                    const myChunkX = Math.floor(myPos.x / DEER_CONFIG.CHUNK_SIZE);
                    const myChunkZ = Math.floor(myPos.z / DEER_CONFIG.CHUNK_SIZE);
                    const dx = Math.abs(myChunkX - entity.chunkX);
                    const dz = Math.abs(myChunkZ - entity.chunkZ);
                    if (dx <= 1 && dz <= 1) {
                        hasPlayersInArea = true;
                    }
                }
            }

            if (!hasPlayersInArea) {
                toDespawn.push(chunkKey);
            }
        }

        // Despawn deer that have no players in area
        for (const chunkKey of toDespawn) {
            const entity = this.entities.get(chunkKey);
            if (!entity) continue;

            console.log(`[Deer ${chunkKey}] All players left 3x3 area - despawning`);

            // Mark chunk as vacant (allows respawn when player re-enters)
            this._vacantChunks.add(chunkKey);

            // Broadcast despawn to peers before removing
            this.broadcastP2P({
                type: 'deer_despawn',
                chunkKey: chunkKey
            });

            // Remove the deer
            this.despawnForChunk(entity.chunkX, entity.chunkZ);
        }
    }

    /**
     * Internal spawn method (called only when we're the authority to spawn)
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     */
    _spawnDeer(chunkX, chunkZ) {
        const chunkKey = `${chunkX},${chunkZ}`;
        if (this.entities.has(chunkKey)) return;

        const pos = this._getChunkSpawnPosition(chunkX, chunkZ);
        const y = this.getTerrainHeight(pos.x, pos.z);
        if (y < DEER_CONFIG.SPAWN_HEIGHT_MIN) return;

        const now = Date.now();

        // Deterministic initial rotation based on chunk
        const rotSeed = chunkX * 31337 ^ chunkZ * 73856093;
        const initialRotation = this._seededRandom(rotSeed) * Math.PI * 2;

        const entity = {
            chunkKey,
            chunkX,
            chunkZ,
            authorityId: this.clientId,
            spawnedBy: this.clientId,  // Track original spawner for conflict resolution

            position: { x: pos.x, y, z: pos.z },
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

            // Interpolation (non-authority)
            targetPosition: null,

            // Last broadcast time
            lastBroadcast: 0,

            // Terrain update counter (like bandits)
            terrainFrameCount: 0,

            // Death state
            isDead: false,
            deathStartTime: 0,
            deathTick: 0,
            fallDirection: 1,
            killedBy: null,
            isHarvested: false,
        };

        // Create visual
        const visual = this.createVisual(chunkKey, entity.position);
        if (visual) {
            entity.mesh = visual.mesh || visual;
            entity.mixer = visual.mixer || null;
            entity.playAnimation = visual.playAnimation || null;
        }

        this.entities.set(chunkKey, entity);

        // Register name tag for deer
        if (this.game?.nameTagManager && entity.mesh) {
            this.game.nameTagManager.registerEntity(`deer_${chunkKey}`, 'Deer', entity.mesh);
        }

        // Broadcast spawn to peers
        this.broadcastP2P({
            type: 'deer_spawn',
            chunkKey,
            position: { ...entity.position },
            rotation: entity.rotation,
            state: entity.state,
            authorityId: this.clientId,
            spawnedBy: this.clientId,  // Include in broadcast for conflict resolution
        });

        console.log(`[Deer ${chunkKey}] Spawned as authority`);
    }

    /**
     * Spawn deer for a chunk (called when chunk loads)
     * Now deferred to checkSpawnsOnTick for proper coordination
     * @deprecated Use checkSpawnsOnTick instead - this is kept for backwards compatibility
     */
    spawnForChunk(chunkX, chunkZ) {
        // NO-OP: Spawning is now handled by checkSpawnsOnTick on server tick
        // This prevents race conditions when multiple players load the same chunk
    }

    /**
     * Despawn deer for a chunk (called when chunk unloads)
     */
    despawnForChunk(chunkX, chunkZ) {
        const chunkKey = `${chunkX},${chunkZ}`;
        const entity = this.entities.get(chunkKey);
        if (!entity) return;

        // Cleanup name tag
        if (this.game?.nameTagManager) {
            this.game.nameTagManager.unregisterEntity(`deer_${chunkKey}`);
        }

        if (entity.mesh) {
            this.destroyVisual(chunkKey, entity.mesh);
        }

        this.entities.delete(chunkKey);
    }

    // =========================================================================
    // COMBAT / DEATH
    // =========================================================================

    /**
     * Kill a deer (any player can kill)
     * @param {string} chunkKey - Deer identifier
     * @param {string} killedBy - clientId of killer
     */
    killDeer(chunkKey, killedBy) {
        const entity = this.entities.get(chunkKey);
        const deathTick = this.getServerTick ? this.getServerTick() : 0;
        const fallDirection = Math.random() < 0.5 ? -1 : 1;

        // If entity doesn't exist locally, still broadcast death so peers can apply it
        if (!entity) {
            console.warn(`[Deer ${chunkKey}] Kill request but entity not found locally - broadcasting anyway`);
            this.broadcastP2P({
                type: 'deer_death',
                chunkKey: chunkKey,
                killedBy: killedBy,
                fallDirection: fallDirection,
                deathTick: deathTick
            });
            return;
        }

        // Already dead - no need to rebroadcast
        if (entity.isDead) {
            console.log(`[Deer ${chunkKey}] Kill request but already dead`);
            return;
        }

        entity.isDead = true;
        entity.deathStartTime = Date.now();
        entity.deathTick = deathTick;
        entity.fallDirection = fallDirection;
        entity.killedBy = killedBy;
        entity.state = 'dead';

        // Update nametag to show (DEAD)
        if (this.game?.nameTagManager) {
            this.game.nameTagManager.setEntityDead(`deer_${chunkKey}`);
        }

        // Stop all movement
        entity.wanderDirection = null;
        entity.fleeDirection = null;

        // Stop animations
        if (entity.mixer) {
            entity.mixer.stopAllAction();
        }

        // Broadcast death
        this.broadcastP2P({
            type: 'deer_death',
            chunkKey: chunkKey,
            killedBy: killedBy,
            fallDirection: entity.fallDirection,
            deathTick: entity.deathTick
        });

        // Corpse cleanup handled in update() via server ticks
    }

    /**
     * Handle death message from peer
     */
    handleDeathMessage(data) {
        const { chunkKey, killedBy, fallDirection, deathTick } = data;
        const entity = this.entities.get(chunkKey);

        if (!entity) {
            // Entity doesn't exist locally - store pending death for when it spawns
            console.warn(`[Deer ${chunkKey}] Death message received but entity not found - storing pending death`);
            this.pendingDeaths = this.pendingDeaths || new Map();
            this.pendingDeaths.set(chunkKey, { killedBy, fallDirection, deathTick });
            return;
        }

        if (entity.isDead) {
            // Already dead, ignore duplicate
            return;
        }

        entity.isDead = true;
        entity.deathStartTime = Date.now();
        entity.deathTick = deathTick || (this.getServerTick ? this.getServerTick() : 0);
        entity.fallDirection = fallDirection || 1;
        entity.killedBy = killedBy;
        entity.state = 'dead';
        entity.wanderDirection = null;
        entity.fleeDirection = null;

        // Update nametag to show (DEAD)
        if (this.game?.nameTagManager) {
            this.game.nameTagManager.setEntityDead(`deer_${chunkKey}`);
        }

        if (entity.mixer) {
            entity.mixer.stopAllAction();
        }

        // Corpse cleanup handled in update() via server ticks
    }

    /**
     * Destroy visual and remove entity from map (allows respawn)
     * Called during corpse cleanup after timeout
     */
    _destroyVisualOnly(chunkKey) {
        const entity = this.entities.get(chunkKey);
        if (!entity) return;

        if (entity.mesh) {
            this.destroyVisual(chunkKey, entity.mesh);
        }

        entity.mesh = null;
        entity.mixer = null;
        entity.playAnimation = null;

        // Remove from entities map to allow respawning in this chunk
        this.entities.delete(chunkKey);
    }

    // isAlive and isAuthority inherited from BaseAIController

    /**
     * Get all living deer for combat targeting
     * Returns array of {chunkKey, position, distance} sorted by distance
     */
    getLivingDeerNear(playerX, playerZ, maxRange) {
        const results = [];
        const maxRangeSq = maxRange * maxRange;

        for (const [chunkKey, entity] of this.entities) {
            if (entity.isDead) continue;

            const dx = entity.position.x - playerX;
            const dz = entity.position.z - playerZ;
            const distSq = dx * dx + dz * dz;

            if (distSq <= maxRangeSq) {
                results.push({
                    chunkKey,
                    position: { ...entity.position },
                    entity: entity,
                    mesh: entity.mesh,
                    distance: Math.sqrt(distSq)
                });
            }
        }

        // Sort by distance
        results.sort((a, b) => a.distance - b.distance);
        return results;
    }

    /**
     * Get nearest dead deer corpse within harvest range
     * @returns {object|null} {chunkKey, position, distance, chunkX, chunkZ} or null
     */
    getNearestHarvestableDeer(playerX, playerZ) {
        let nearest = null;
        let nearestDistSq = DEER_CONFIG.HARVEST_RANGE * DEER_CONFIG.HARVEST_RANGE;

        for (const [chunkKey, entity] of this.entities) {
            // Must be dead, not harvested, and have mesh visible
            if (!entity.isDead || entity.isHarvested || !entity.mesh) continue;

            const dx = entity.position.x - playerX;
            const dz = entity.position.z - playerZ;
            const distSq = dx * dx + dz * dz;

            if (distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearest = {
                    chunkKey,
                    position: { ...entity.position },
                    distance: Math.sqrt(distSq),
                    chunkX: entity.chunkX,
                    chunkZ: entity.chunkZ
                };
            }
        }
        return nearest;
    }

    /**
     * Mark deer as harvested and remove from world
     * @param {string} chunkKey
     */
    harvestDeer(chunkKey) {
        console.log('[DEBUG] harvestDeer called with:', chunkKey);
        const entity = this.entities.get(chunkKey);
        console.log('[DEBUG] entity found:', !!entity);
        if (entity) {
            console.log('[DEBUG] entity.isDead:', entity.isDead);
            console.log('[DEBUG] entity.isHarvested:', entity.isHarvested);
        }
        if (!entity || !entity.isDead || entity.isHarvested) {
            console.log('[DEBUG] harvestDeer early return - condition failed');
            return false;
        }

        entity.isHarvested = true;

        // Cleanup name tag
        if (this.game?.nameTagManager) {
            this.game.nameTagManager.unregisterEntity(`deer_${chunkKey}`);
        }

        // Immediately remove visual
        if (entity.mesh) {
            this.destroyVisual(chunkKey, entity.mesh);
            entity.mesh = null;
        }

        // Remove entity entirely (allows respawn when chunk reloads)
        this.entities.delete(chunkKey);

        // Broadcast to peers
        this.broadcastP2P({
            type: 'deer_harvested',
            chunkKey: chunkKey
        });

        return true;
    }

    /**
     * Handle harvest message from peer
     */
    handleHarvestMessage(data) {
        const { chunkKey } = data;
        const entity = this.entities.get(chunkKey);
        if (!entity) return;

        entity.isHarvested = true;

        // Cleanup name tag
        if (this.game?.nameTagManager) {
            this.game.nameTagManager.unregisterEntity(`deer_${chunkKey}`);
        }

        if (entity.mesh) {
            this.destroyVisual(chunkKey, entity.mesh);
            entity.mesh = null;
        }

        this.entities.delete(chunkKey);
    }

    _determineAuthority(chunkX, chunkZ) {
        // Get all players in 3x3 chunk area
        const chunkKeys = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                chunkKeys.push(`${chunkX + dx},${chunkZ + dz}`);
            }
        }
        
        const playerIds = this.getPlayersInChunks(chunkKeys) || [];
        const candidates = [this.clientId, ...playerIds];
        
        // Sort numerically and pick lowest (not lexicographic!)
        candidates.sort((a, b) => parseInt(a) - parseInt(b));
        return candidates[0];
    }

    // =========================================================================
    // P2P MESSAGE HANDLERS
    // =========================================================================

    handleSpawnMessage(data) {
        const { chunkKey, position, rotation, state, authorityId, spawnedBy } = data;

        if (this.entities.has(chunkKey)) {
            const existing = this.entities.get(chunkKey);

            // Deterministic conflict resolution: lowest spawnedBy clientId wins
            const existingSpawnedBy = existing.spawnedBy || existing.authorityId;
            const incomingSpawnedBy = spawnedBy || authorityId;

            if (incomingSpawnedBy < existingSpawnedBy) {
                console.log(`[Deer ${chunkKey}] Spawn conflict: ${incomingSpawnedBy} wins over ${existingSpawnedBy}`);
                // Destroy our version, create from peer's data
                this.despawnForChunk(existing.chunkX, existing.chunkZ);
                // Fall through to create from peer's data
            } else if (incomingSpawnedBy === existingSpawnedBy) {
                // Same spawner - true duplicate, ignore
                return;
            } else {
                // We have lower clientId, we win
                return;
            }
        }

        // Validate Y position - use terrain height if invalid
        let validatedY = position.y;
        if (!validatedY || validatedY <= 0 || isNaN(validatedY)) {
            if (this.getTerrainHeight) {
                validatedY = this.getTerrainHeight(position.x, position.z);
            }
            if (!validatedY || validatedY <= 0) validatedY = 0;
            console.warn(`[Deer ${chunkKey}] Invalid Y position from peer, using terrain height: ${validatedY}`);
        }

        const entity = {
            chunkKey,
            chunkX: parseInt(chunkKey.split(',')[0]),
            chunkZ: parseInt(chunkKey.split(',')[1]),
            authorityId,
            spawnedBy: spawnedBy || authorityId,  // Store original spawner

            position: { x: position.x, y: validatedY, z: position.z },
            rotation,
            targetRotation: null,

            state,
            stateStartTime: Date.now(),
            wanderDirection: null,
            fleeDirection: null,

            mesh: null,
            mixer: null,

            targetPosition: { x: position.x, y: validatedY, z: position.z },
            lastBroadcast: 0,

            // Terrain update counter (like bandits)
            terrainFrameCount: 0,

            // Death state - sync from spawn data if dead
            isDead: (state === 'dead'),
            deathStartTime: (state === 'dead') ? Date.now() : 0,
            deathTick: data.deathTick || 0,
            fallDirection: data.fallDirection || 1,
            killedBy: data.killedBy || null,
            isHarvested: data.isHarvested || false,
        };

        const visual = this.createVisual(chunkKey, entity.position);
        if (visual) {
            entity.mesh = visual.mesh || visual;
            entity.mixer = visual.mixer || null;
            entity.playAnimation = visual.playAnimation || null;
        }

        this.entities.set(chunkKey, entity);

        // Check for pending death that arrived before spawn
        if (this.pendingDeaths?.has(chunkKey)) {
            const pendingDeath = this.pendingDeaths.get(chunkKey);
            console.log(`[Deer ${chunkKey}] Applying pending death from before spawn`);
            entity.isDead = true;
            entity.deathStartTime = Date.now();
            entity.deathTick = pendingDeath.deathTick || 0;
            entity.fallDirection = pendingDeath.fallDirection || 1;
            entity.killedBy = pendingDeath.killedBy;
            entity.state = 'dead';
            this.pendingDeaths.delete(chunkKey);
        }

        // Register name tag for peer-spawned deer
        if (this.game?.nameTagManager && entity.mesh) {
            this.game.nameTagManager.registerEntity(`deer_${chunkKey}`, 'Deer', entity.mesh);
            // If entity is dead, update nametag immediately
            if (entity.isDead) {
                this.game.nameTagManager.setEntityDead(`deer_${chunkKey}`);
            }
        }

        this._updateAnimation(entity);
        console.log(`[Deer ${chunkKey}] Spawned from peer ${spawnedBy}, authority: ${authorityId}, dead: ${entity.isDead}`);
    }

    handleStateMessage(data) {
        const { chunkKey, position, rotation, state, authorityId, deathTick } = data;

        const entity = this.entities.get(chunkKey);
        if (!entity) return;

        // Only update from peer if we're NOT authority
        // If we ARE authority, ignore - our local state is authoritative
        if (authorityId !== this.clientId) {
            // We're not authority - accept updates from the authority peer
            entity.authorityId = authorityId;
            entity.targetPosition = { ...position };
            entity.targetRotation = rotation;

            // State change
            if (entity.state !== state) {
                entity.state = state;
                entity.stateStartTime = Date.now();
                this._updateAnimation(entity);
            }

            // Sync deathTick for corpse cleanup timing and ensure dead state is properly set
            // Only check state === 'dead', not deathTick, to prevent resurrection when deathTick is falsy
            if (state === 'dead') {
                entity.deathTick = deathTick || (this.getServerTick ? this.getServerTick() : 0);
                // Ensure isDead is set and nametag is updated (in case death message was missed)
                if (!entity.isDead) {
                    entity.isDead = true;
                    entity.deathStartTime = Date.now();
                    if (this.game?.nameTagManager) {
                        this.game.nameTagManager.setEntityDead(`deer_${chunkKey}`);
                    }
                }
            }
        }
    }

    /**
     * Handle despawn message from peer (authority says all players left)
     */
    handleDespawnMessage(data) {
        const { chunkKey } = data;
        const entity = this.entities.get(chunkKey);

        if (!entity) {
            console.log(`[Deer ${chunkKey}] Received despawn but entity doesn't exist locally`);
            return;
        }

        console.log(`[Deer ${chunkKey}] Despawn received from authority - removing`);

        // Mark as vacant for respawn gating
        this._vacantChunks.add(chunkKey);

        // Remove the deer
        this.despawnForChunk(entity.chunkX, entity.chunkZ);
    }

    // =========================================================================
    // GUNSHOT DETECTION
    // =========================================================================

    /**
     * Register a gunshot (call from PlayerCombat or BanditController)
     */
    registerGunshot(x, z) {
        const now = Date.now();
        this._recentGunshots.push({ x, z, time: now });

        // Clean old gunshots in-place (older than 1 second) - avoids array allocation
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
            // Only react to gunshots from last 500ms
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

    _isNaturalObject(objectType) {
        if (!objectType) return false;
        const lower = objectType.toLowerCase();
        return DEER_CONFIG.NATURAL_OBJECTS.some(nat => lower.includes(nat));
    }

    _findNearestThreat(entity) {
        const playerRange = DEER_CONFIG.PLAYER_DETECT_RANGE;
        const objectRange = DEER_CONFIG.OBJECT_DETECT_RANGE;
        
        let nearestThreat = null;
        let nearestDistSq = Infinity;
        
        // Check players
        const chunkKeys = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                chunkKeys.push(`${entity.chunkX + dx},${entity.chunkZ + dz}`);
            }
        }
        
        const playerIds = this.getPlayersInChunks(chunkKeys) || [];
        const playerRangeSq = playerRange * playerRange;
        
        for (const playerId of playerIds) {
            const pos = this.getPlayerPosition(playerId);
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
        const localPos = this.getPlayerPosition(this.clientId);
        if (localPos) {
            const dx = localPos.x - entity.position.x;
            const dz = localPos.z - entity.position.z;
            const distSq = dx * dx + dz * dz;
            
            if (distSq < playerRangeSq && distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearestThreat = { x: localPos.x, z: localPos.z };
            }
        }
        
        // Check objects (structures, etc.) in 3x3 chunk area
        const allObjects = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = `${entity.chunkX + dx},${entity.chunkZ + dz}`;
                const objs = this.getChunkObjects(key) || [];
                allObjects.push(...objs);
            }
        }
        const objectRangeSq = objectRange * objectRange;

        for (const obj of allObjects) {
            // Skip natural objects
            if (this._isNaturalObject(obj.type)) continue;
            
            const pos = obj.position;
            if (!pos) continue;
            
            const dx = pos.x - entity.position.x;
            const dz = pos.z - entity.position.z;
            const distSq = dx * dx + dz * dz;
            
            if (distSq < objectRangeSq && distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearestThreat = { x: pos.x, z: pos.z };
            }
        }

        // Check bears (flee from bears within 10 units) via registry
        const bearRange = 10;
        const bearRangeSq = bearRange * bearRange;
        const bearController = this.registry?.get('bear');
        if (bearController?.entities) {
            for (const [chunkKey, bear] of bearController.entities) {
                if (bear.isDead) continue;
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

    // =========================================================================
    // MOVEMENT
    // =========================================================================

    _moveEntity(entity, dirX, dirZ, speed, deltaTime) {
        const moveAmount = speed * (deltaTime / 1000);
        
        const newX = entity.position.x + dirX * moveAmount;
        const newZ = entity.position.z + dirZ * moveAmount;
        const newY = this.getTerrainHeight(newX, newZ);
        
        // Stop at water (consistent with spawn check)
        if (newY < DEER_CONFIG.SPAWN_HEIGHT_MIN) {
            return false;  // Hit water
        }
        
        entity.position.x = newX;
        entity.position.z = newZ;
        entity.position.y = newY;
        
        // Face movement direction (smooth rotation)
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
        
        // Sync mesh
        if (entity.mesh) {
            entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
            entity.mesh.rotation.y = entity.rotation;
        }
        
        return true;
    }

    // =========================================================================
    // ANIMATION
    // =========================================================================

    _updateAnimation(entity) {
        if (!entity.playAnimation) return;
        
        switch (entity.state) {
            case 'idle':
                entity.playAnimation('walk', 0);  // Frozen frame 1
                break;
            case 'wandering':
                entity.playAnimation('walk', 1.0);
                break;
            case 'fleeing':
                entity.playAnimation('run', 1.0);
                break;
        }
    }

    /**
     * Update death animation (fall over sideways)
     */
    _updateDeathAnimation(entity, deltaTime) {
        if (!entity.mesh) return;

        const elapsed = Date.now() - entity.deathStartTime;
        const duration = DEER_CONFIG.DEATH_ANIMATION_DURATION;

        if (elapsed < duration) {
            const progress = elapsed / duration;
            // Rotate 90 degrees around Z axis (fall to side)
            const angle = (Math.PI / 2) * progress * entity.fallDirection;

            // Apply to first child (the actual model mesh)
            if (entity.mesh.children && entity.mesh.children[0]) {
                entity.mesh.children[0].rotation.z = angle;
            }
        } else {
            // Animation complete - hold final pose
            const angle = (Math.PI / 2) * entity.fallDirection;
            if (entity.mesh.children && entity.mesh.children[0]) {
                entity.mesh.children[0].rotation.z = angle;
            }
        }
    }

    // =========================================================================
    // STATE MACHINE
    // =========================================================================

    _updateEntity(entity, deltaTime, now) {
        // Dead deer: only update death animation
        if (entity.isDead) {
            this._updateDeathAnimation(entity, deltaTime);
            return;
        }

        // Increment terrain frame counter
        entity.terrainFrameCount++;

        // Non-authority: interpolate only
        if (entity.authorityId !== this.clientId) {
            this._interpolateEntity(entity, deltaTime);
            return;
        }

        // Authority: update Y position every 5 frames (like bandits)
        if (entity.terrainFrameCount % 5 === 0 && this.getTerrainHeight) {
            const h = this.getTerrainHeight(entity.position.x, entity.position.z);
            entity.position.y = h !== null && h !== undefined ? h : entity.position.y;
            // Sync mesh position
            if (entity.mesh) {
                entity.mesh.position.y = entity.position.y;
            }
        }

        // Authority logic
        const elapsed = now - entity.stateStartTime;

        // Periodic gunshot check every 500ms (matches gunshot expiry window)
        // Deer flee from gunshots or update flee direction if already fleeing
        if (!entity.lastGunshotCheck || now - entity.lastGunshotCheck >= 500) {
            entity.lastGunshotCheck = now;
            const gunshot = this._checkGunshotThreat(entity);
            if (gunshot) {
                if (entity.state === 'fleeing') {
                    // Update flee direction away from new gunshot
                    const dx = entity.position.x - gunshot.x;
                    const dz = entity.position.z - gunshot.z;
                    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
                    entity.fleeDirection = { x: dx / dist, z: dz / dist };
                } else {
                    // Start fleeing from gunshot
                    this._startFleeing(entity, gunshot, now);
                    return; // State changed, skip rest of update
                }
            }
        }

        switch (entity.state) {
            case 'idle':
                if (elapsed >= DEER_CONFIG.IDLE_DURATION) {
                    // Check for threats before transitioning
                    const threat = this._findNearestThreat(entity);
                    if (threat) {
                        this._startFleeing(entity, threat, now);
                    } else {
                        this._startWandering(entity, now);
                    }
                }
                break;
                
            case 'wandering':
                if (elapsed >= DEER_CONFIG.WANDER_DURATION) {
                    this._startIdle(entity, now);
                } else if (entity.wanderDirection) {
                    const moved = this._moveEntity(
                        entity,
                        entity.wanderDirection.x,
                        entity.wanderDirection.z,
                        DEER_CONFIG.WANDER_SPEED,
                        deltaTime
                    );
                    if (!moved) {
                        // Hit water, stop and go idle
                        this._startIdle(entity, now);
                    }
                }
                break;
                
            case 'fleeing':
                if (elapsed >= DEER_CONFIG.FLEE_DURATION) {
                    this._startIdle(entity, now);
                } else if (entity.fleeDirection) {
                    const moved = this._moveEntity(
                        entity,
                        entity.fleeDirection.x,
                        entity.fleeDirection.z,
                        DEER_CONFIG.FLEE_SPEED,
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
        
        // Broadcast state to peers
        if (now - entity.lastBroadcast > DEER_CONFIG.BROADCAST_INTERVAL) {
            this._broadcastState(entity);
            entity.lastBroadcast = now;
        }

        // Update animation mixer (authority)
        if (entity.mixer) {
            entity.mixer.update(deltaTime / 1000);
        }
    }

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
        
        // Random direction
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

        // Direction away from threat
        const dx = entity.position.x - threat.x;
        const dz = entity.position.z - threat.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < 0.001) {
            // Threat exactly on top of deer, pick random direction
            const angle = Math.random() * Math.PI * 2;
            entity.fleeDirection = { x: Math.sin(angle), z: Math.cos(angle) };
        } else {
            entity.fleeDirection = { x: dx / dist, z: dz / dist };
        }

        this._updateAnimation(entity);
        console.log(`[Deer ${entity.chunkKey}] Fleeing from threat at (${threat.x.toFixed(1)}, ${threat.z.toFixed(1)})`);
    }

    // =========================================================================
    // INTERPOLATION (NON-AUTHORITY)
    // =========================================================================

    _interpolateEntity(entity, deltaTime) {
        if (!entity.targetPosition) return;

        const dx = entity.targetPosition.x - entity.position.x;
        const dz = entity.targetPosition.z - entity.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        // XZ movement: constant speed interpolation (like bandits)
        const secondsDelta = deltaTime / 1000;
        const moveSpeed = DEER_CONFIG.FLEE_SPEED * 1.5; // Slightly faster than max speed for smooth catch-up
        const moveStep = moveSpeed * secondsDelta;

        if (distance > 0.1) {
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

        // Y position: validate and interpolate
        if (entity.targetPosition.y !== undefined && entity.targetPosition.y > 0) {
            const dy = entity.targetPosition.y - entity.position.y;

            // If Y difference is too large (> 5 units), snap to terrain height
            // This prevents slow floating when bad data is received
            if (Math.abs(dy) > 5) {
                if (this.getTerrainHeight) {
                    entity.position.y = this.getTerrainHeight(entity.position.x, entity.position.z);
                }
            } else {
                // Normal interpolation for small differences
                entity.position.y += dy * 0.1;
            }
        }

        // Rotation: smooth with max rate (like bandits)
        let targetRotation = entity.rotation;
        if (distance > 0.1) {
            targetRotation = Math.atan2(dx, dz);
        } else if (entity.targetRotation !== null) {
            targetRotation = entity.targetRotation;
        }

        let rotDiff = targetRotation - entity.rotation;
        while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
        while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;

        const maxRotation = 2.1 * secondsDelta; // 120 degrees per second
        entity.rotation += Math.max(-maxRotation, Math.min(maxRotation, rotDiff));

        // Sync mesh
        if (entity.mesh) {
            entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
            entity.mesh.rotation.y = entity.rotation;
        }

        // Update animation mixer (like bandits)
        if (entity.mixer) {
            entity.mixer.update(secondsDelta);
        }
    }

    // =========================================================================
    // BROADCAST
    // =========================================================================

    _broadcastState(entity) {
        const msg = {
            type: 'deer_state',
            chunkKey: entity.chunkKey,
            position: { ...entity.position },
            rotation: entity.rotation,
            state: entity.state,
            authorityId: entity.authorityId,
            spawnedBy: entity.spawnedBy || entity.authorityId,
        };
        // Include deathTick for corpse cleanup timing sync
        if (entity.isDead) {
            msg.deathTick = entity.deathTick;
        }
        this.broadcastP2P(msg);
    }

    // =========================================================================
    // MAIN UPDATE
    // =========================================================================

    update(deltaTime) {
        this._frameCount++;
        const now = Date.now();
        const currentTick = this.getServerTick ? this.getServerTick() : 0;

        // Collect dead deer for corpse cleanup
        const corpsesToCleanup = [];
        // Collect deer that wandered outside 3x3 of spawn chunk
        const wanderedTooFar = [];

        for (const [chunkKey, entity] of this.entities) {
            this._updateEntity(entity, deltaTime, now);

            // Note: Animation mixer is updated inside _updateEntity/_interpolateEntity
            // Don't double-update here

            // Check for corpse cleanup (2 minutes via server ticks)
            if (entity.isDead && entity.deathTick > 0 && currentTick > 0) {
                const ticksElapsed = currentTick - entity.deathTick;
                if (ticksElapsed >= DEER_CONFIG.CORPSE_DURATION_TICKS) {
                    corpsesToCleanup.push(chunkKey);
                }
            }

            // Check if deer wandered outside 3x3 of spawn chunk (despawn to avoid orphaned entities)
            if (!entity.isDead) {
                const currentChunkX = Math.floor(entity.position.x / DEER_CONFIG.CHUNK_SIZE);
                const currentChunkZ = Math.floor(entity.position.z / DEER_CONFIG.CHUNK_SIZE);
                const dx = Math.abs(currentChunkX - entity.chunkX);
                const dz = Math.abs(currentChunkZ - entity.chunkZ);
                if (dx > 1 || dz > 1) {
                    wanderedTooFar.push(chunkKey);
                }
            }
        }

        // Cleanup corpses (separate loop to avoid modifying map during iteration)
        for (const chunkKey of corpsesToCleanup) {
            this._destroyVisualOnly(chunkKey);
        }

        // Despawn deer that wandered too far from spawn chunk
        for (const chunkKey of wanderedTooFar) {
            this.despawnForChunk(
                this.entities.get(chunkKey)?.chunkX,
                this.entities.get(chunkKey)?.chunkZ
            );
        }
    }

    // =========================================================================
    // SYNC HELPERS
    // =========================================================================

    getActiveDeerForSync() {
        const result = [];
        for (const [chunkKey, entity] of this.entities) {
            result.push({
                chunkKey,
                position: { ...entity.position },
                rotation: entity.rotation,
                state: entity.state,
                authorityId: entity.authorityId,
                spawnedBy: entity.spawnedBy || entity.authorityId,  // Include spawnedBy for conflict resolution
                // Include death data for proper sync
                deathTick: entity.deathTick || 0,
                fallDirection: entity.fallDirection || 1,
                killedBy: entity.killedBy || null,
                isHarvested: entity.isHarvested || false,
            });
        }
        return result;
    }

    syncDeerFromPeer(deerList) {
        for (const data of deerList) {
            if (this.entities.has(data.chunkKey)) continue;
            this.handleSpawnMessage(data);
        }
    }

    /**
     * Handle peer disconnect - transfer authority if needed
     */
    onPeerDisconnected(peerId) {
        for (const [chunkKey, entity] of this.entities) {
            if (entity.authorityId === peerId) {
                // Recalculate authority
                const newAuthority = this._determineAuthority(entity.chunkX, entity.chunkZ);
                if (newAuthority) {
                    const wasMe = newAuthority === this.clientId;
                    entity.authorityId = newAuthority;
                    console.log(`[Deer ${chunkKey}] Authority transfer: ${peerId} -> ${newAuthority}`);

                    // If we're taking over authority, snap to last known position
                    if (wasMe) {
                        // Use targetPosition if available (from previous broadcasts)
                        // Otherwise keep current interpolated position
                        if (entity.targetPosition) {
                            const terrainY = this.getTerrainHeight ?
                                this.getTerrainHeight(entity.targetPosition.x, entity.targetPosition.z) :
                                entity.targetPosition.y;

                            // Validate position before snapping
                            if (entity.targetPosition.y > 0 && Math.abs(entity.targetPosition.y - terrainY) < 5) {
                                entity.position.x = entity.targetPosition.x;
                                entity.position.y = terrainY;
                                entity.position.z = entity.targetPosition.z;
                            }
                        }
                        // Ensure position is on terrain
                        if (this.getTerrainHeight) {
                            entity.position.y = this.getTerrainHeight(entity.position.x, entity.position.z);
                        }

                        // Sync mesh position
                        if (entity.mesh) {
                            entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
                        }

                        // Immediately broadcast our state so other peers know our position
                        this._broadcastState(entity);
                    }
                }
            }
        }
    }

    /**
     * Handle peer chunk change - transfer authority if peer left deer's area
     */
    onPeerChunkChanged(peerId, oldChunkKey, newChunkKey) {
        for (const [chunkKey, entity] of this.entities) {
            if (entity.authorityId !== peerId) continue;

            // Check if peer left authority region (3x3 around deer's chunk)
            const [newX, newZ] = newChunkKey.split(',').map(Number);
            const dx = Math.abs(newX - entity.chunkX);
            const dz = Math.abs(newZ - entity.chunkZ);

            if (dx > 1 || dz > 1) {
                // Peer left the 3x3 area, recalculate authority
                const newAuthority = this._determineAuthority(entity.chunkX, entity.chunkZ);
                if (newAuthority) {
                    const wasMe = newAuthority === this.clientId;
                    entity.authorityId = newAuthority;

                    // If we're taking over authority, handle position transfer
                    if (wasMe) {
                        // Use targetPosition if available and valid (from previous broadcasts)
                        // Otherwise keep current interpolated position (which is still valid)
                        if (entity.targetPosition) {
                            const targetY = entity.targetPosition.y;
                            const terrainY = this.getTerrainHeight ?
                                this.getTerrainHeight(entity.targetPosition.x, entity.targetPosition.z) : targetY;

                            // Only snap if target position is valid (Y > 0 and close to terrain)
                            if (targetY > 0 && Math.abs(targetY - terrainY) < 5) {
                                entity.position.x = entity.targetPosition.x;
                                entity.position.y = terrainY;
                                entity.position.z = entity.targetPosition.z;
                            }
                        }
                        // Ensure position is on terrain (whether from targetPosition or interpolated)
                        if (this.getTerrainHeight) {
                            entity.position.y = this.getTerrainHeight(entity.position.x, entity.position.z);
                        }

                        // Sync mesh position immediately
                        if (entity.mesh) {
                            entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
                        }

                        // Immediately broadcast our state so other peers sync to our position
                        this._broadcastState(entity);
                    }
                }
            }
        }
    }
}

export { DEER_CONFIG };

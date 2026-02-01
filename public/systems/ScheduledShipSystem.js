/**
 * ScheduledShipSystem.js
 * Manages scheduled ship arrivals at docks
 * Ships follow a deterministic script: spawn -> approach -> dock -> backup -> rotate -> depart -> despawn
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { objectPlacer } from '../objects.js';
import ChunkCoordinates from '../core/ChunkCoordinates.js';

// Ship script constants
const SHIP_CONSTANTS = {
    // Positioning
    SPAWN_OFFSET: 50,         // Units from dock in approach direction
    DOCK_OFFSET: 5,           // Final position relative to dock (towards sea)
    PARALLEL_OFFSET: 2.8,     // Offset perpendicular to approach direction (adjusted for 4-wide dock)
    BACKUP_DISTANCE: 7,       // Units to back up before rotating
    WATER_LEVEL: 0,           // Ship Y position (water level)

    // Speeds
    CRUISE_SPEED: 1.0,        // Units per second (200% of player 0.5 u/s)
    BACKUP_SPEED: 0.7,        // Units per second for backing up (was 0.2)
    ROTATION_SPEED: 6,        // Degrees per second (180° over 30s)

    // Durations (seconds)
    EASE_DURATION: 5,         // Ease in/out duration for starts/stops (was 10)
    DOCK_WAIT_TIME: 10,       // 10 seconds waiting at dock (was 180)
    ROTATE_DURATION: 30,      // 30 seconds to rotate 180° (was 60)

    // Total cycle (calculated properly)
    // Approach: 45 units at 1 u/s + 5s ease = 50s
    // Dock: 10s
    // Backup: 7 units at 0.7 u/s + 5s ease = 15s
    // Rotate: 30s
    // Depart: 38 units at 1 u/s + 5s ease = 43s
    // Total: 148s (use 160 for safety margin)
    TOTAL_CYCLE_DURATION: 160
};

/**
 * Get direction vectors based on dock rotation
 * Convention (Option A - Mathematical):
 *   0 rad (0°)       = water to South (-Z)
 *   PI/2 rad (90°)   = water to East (+X)  <- current working behavior
 *   PI rad (180°)    = water to North (+Z)
 *   3PI/2 rad (270°) = water to West (-X)
 *
 * @param {number} rotationRad - Dock rotation in radians (0, PI/2, PI, 3PI/2)
 * @returns {object} - Direction vectors and ship rotation
 */
function getDockDirections(rotationRad) {
    // Convert radians to nearest 90-degree increment for switch
    const degrees = Math.round((rotationRad * 180 / Math.PI) / 90) * 90 % 360;
    switch (degrees) {
        case 0:   // Water to South - ship comes from South
            return {
                approach: { x: 0, z: -1 },  // Ship approaches from -Z, moves toward +Z
                parallel: { x: 1, z: 0 },   // Parallel offset is +X
                shipRotation: 0,             // Ship faces North (0°) toward dock
                merchantRotation: Math.PI    // Merchant faces South (toward water)
            };
        case 90:  // Water to East - ship comes from East (CURRENT)
            return {
                approach: { x: 1, z: 0 },   // Ship approaches from +X, moves toward -X
                parallel: { x: 0, z: 1 },   // Parallel offset is +Z
                shipRotation: Math.PI * 1.5, // Ship faces West (270°) toward dock
                merchantRotation: Math.PI / 2 // Merchant faces East (toward water)
            };
        case 180: // Water to North - ship comes from North
            return {
                approach: { x: 0, z: 1 },   // Ship approaches from +Z, moves toward -Z
                parallel: { x: -1, z: 0 },  // Parallel offset is -X
                shipRotation: Math.PI,       // Ship faces South (180°) toward dock
                merchantRotation: 0          // Merchant faces North (toward water)
            };
        case 270: // Water to West - ship comes from West
            return {
                approach: { x: -1, z: 0 },  // Ship approaches from -X, moves toward +X
                parallel: { x: 0, z: -1 },  // Parallel offset is -Z
                shipRotation: Math.PI / 2,   // Ship faces East (90°) toward dock
                merchantRotation: Math.PI * 1.5 // Merchant faces West (toward water)
            };
        default:
            console.warn(`Unknown dock rotation: ${rotationRad} rad, defaulting to PI/2`);
            return getDockDirections(Math.PI / 2);
    }
}

// Ship phases
const PHASE = {
    APPROACH: 'approach',
    DOCKED: 'docked',
    BACKUP: 'backup',
    ROTATE: 'rotate',
    DEPART: 'depart',
    DESPAWNED: 'despawned'
};

export class ScheduledShipSystem {
    constructor(scene, animationSystem) {
        this.scene = scene;
        this.animationSystem = animationSystem;

        // Track active scheduled ships: Map<dockId, { ship, dockData, startTime, phase }>
        this.activeShips = new Map();

        // Track docks with their lastShipSpawn: Map<dockId, { position, rotation, lastShipSpawn }>
        this.docks = new Map();

        // Network manager reference (set by game.js after construction)
        this.networkManager = null;

        // Track which ships have already triggered departure trade (to avoid duplicates)
        this.departureTradeTriggered = new Set();

        // Track boats already sunk by merchant ships (prevent duplicate processing)
        this.sunkBoats = new Set();

        // References for boat collision handling (set by game.js)
        this.boatSinkingSystem = null;
        this.audioManager = null;

        // Cache phase timings (constants don't change, avoid recalculation per frame)
        this._phaseTimings = this._calculatePhaseTimings();
    }

    /**
     * Set network manager reference for sending messages
     */
    setNetworkManager(networkManager) {
        this.networkManager = networkManager;
    }

    /**
     * Set game reference for physics manager access
     */
    setGame(game) {
        this.game = game;
    }

    /**
     * Set boat sinking system for collision animations
     */
    setBoatSinkingSystem(boatSinkingSystem) {
        this.boatSinkingSystem = boatSinkingSystem;
    }

    /**
     * Set audio manager for crash sounds
     */
    setAudioManager(audioManager) {
        this.audioManager = audioManager;
    }

    /**
     * Easing function for smooth starts/stops
     * @param {number} t - Progress from 0 to 1
     * @returns {number} - Eased value from 0 to 1
     */
    easeInOut(t) {
        return t < 0.5
            ? 2 * t * t
            : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    /**
     * Calculate eased speed multiplier for movement
     * @param {number} progress - Overall progress (0-1) through movement phase
     * @param {number} totalDistance - Total distance to travel
     * @param {number} easeDistance - Distance over which to ease
     * @returns {number} - Speed multiplier (0-1)
     */
    getEasedSpeedMultiplier(progress, totalDistance, easeDistance) {
        const easeRatio = easeDistance / totalDistance;

        if (progress < easeRatio) {
            // Ease in
            return this.easeInOut(progress / easeRatio);
        } else if (progress > 1 - easeRatio) {
            // Ease out
            return this.easeInOut((1 - progress) / easeRatio);
        }
        // Cruise at full speed
        return 1.0;
    }

    /**
     * Register a dock for ship tracking
     * Called when dock data is received from server
     */
    registerDock(dockId, position, rotation, lastShipSpawn, chunkId = null) {
        this.docks.set(dockId, {
            position: position,
            rotation: rotation,
            lastShipSpawn: lastShipSpawn || 0,
            chunkId: chunkId
        });

        // Check if a ship should currently be visible
        if (lastShipSpawn) {
            this.checkAndSpawnShip(dockId);
        }
    }

    /**
     * Update dock's lastShipSpawn (called when dock_ship_spawned message received)
     */
    updateDockShipSpawn(dockId, position, rotation, lastShipSpawn, chunkId = null) {
        const dock = this.docks.get(dockId);
        if (dock) {
            dock.lastShipSpawn = lastShipSpawn;
            dock.position = position;
            dock.rotation = rotation;
            if (chunkId) dock.chunkId = chunkId;
            // Reset trigger flag since server confirmed spawn
            dock._shipTriggerSent = false;
            // Reset departure trade flag for new ship cycle
            this.departureTradeTriggered.delete(dockId);
            // Clear sunk boats tracking for new ship cycle
            // This allows rebuilt boats to be processed by the new merchant ship
            this.sunkBoats.clear();
        } else {
            this.registerDock(dockId, position, rotation, lastShipSpawn, chunkId);
        }

        // Spawn or update ship
        this.checkAndSpawnShip(dockId);
    }

    /**
     * Remove a dock from tracking (called when dock is removed)
     */
    unregisterDock(dockId) {
        this.docks.delete(dockId);
        this.removeShip(dockId);
    }

    /**
     * Check if ship should be visible and spawn/update accordingly
     */
    checkAndSpawnShip(dockId) {
        const dock = this.docks.get(dockId);
        if (!dock || !dock.lastShipSpawn) return;

        const elapsed = (Date.now() - dock.lastShipSpawn) / 1000; // seconds

        // If beyond cycle duration, ship has despawned
        if (elapsed >= SHIP_CONSTANTS.TOTAL_CYCLE_DURATION) {
            this.removeShip(dockId);
            return;
        }

        // Ship should be visible - create if needed
        if (!this.activeShips.has(dockId)) {
            this.createShip(dockId, dock);
        }
    }

    /**
     * Create ship model for a dock
     */
    createShip(dockId, dock) {
        // Get direction vectors based on dock rotation
        const dirs = getDockDirections(dock.rotation ?? (Math.PI / 2));

        // Calculate spawn position using direction vectors
        const spawnX = dock.position[0]
            + dirs.approach.x * SHIP_CONSTANTS.SPAWN_OFFSET
            + dirs.parallel.x * SHIP_CONSTANTS.PARALLEL_OFFSET;
        const spawnZ = dock.position[2]
            + dirs.approach.z * SHIP_CONSTANTS.SPAWN_OFFSET
            + dirs.parallel.z * SHIP_CONSTANTS.PARALLEL_OFFSET;
        const spawnY = SHIP_CONSTANTS.WATER_LEVEL;

        // Calculate dock position (where ship stops)
        const dockPosX = dock.position[0]
            + dirs.approach.x * SHIP_CONSTANTS.DOCK_OFFSET
            + dirs.parallel.x * SHIP_CONSTANTS.PARALLEL_OFFSET;
        const dockPosZ = dock.position[2]
            + dirs.approach.z * SHIP_CONSTANTS.DOCK_OFFSET
            + dirs.parallel.z * SHIP_CONSTANTS.PARALLEL_OFFSET;

        // Calculate backup position
        const backupX = dockPosX + dirs.approach.x * SHIP_CONSTANTS.BACKUP_DISTANCE;
        const backupZ = dockPosZ + dirs.approach.z * SHIP_CONSTANTS.BACKUP_DISTANCE;

        // Ship rotation (faces toward dock)
        const initialRotation = dirs.shipRotation;

        // Create ship using objectPlacer
        const shipPosition = new THREE.Vector3(spawnX, spawnY, spawnZ);
        const ship = objectPlacer.createInstance(
            'ship',
            shipPosition,
            1.15, // scale - 15% larger for better visibility and collision
            initialRotation,
            this.scene
        );

        if (!ship) {
            console.error('[ScheduledShipSystem] Failed to create ship for dock:', dockId);
            return;
        }

        // Set metadata
        ship.userData.objectId = `scheduled_ship_${dockId}`;
        ship.userData.modelType = 'ship';
        ship.userData.isScheduledShip = true;
        ship.userData.dockId = dockId;

        // Add to scene
        this.scene.add(ship);

        // Register with animation system for rocking
        if (this.animationSystem) {
            this.animationSystem.registerShip(ship);
        }

        // Create kinematic collider for merchant ship collision detection
        if (this.game?.physicsManager) {
            const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS.ship;
            const SHIP_SCALE = 1.15; // Must match model scale above
            const shape = {
                type: 'cuboid',
                width: dims.width * SHIP_SCALE,
                depth: dims.depth * SHIP_SCALE,
                height: dims.height * SHIP_SCALE
            };
            const colliderId = `merchant_ship_${dockId}`;
            this.game.physicsManager.createKinematicBody(colliderId, shape, ship.position);
            ship.userData.physicsBodyId = colliderId;
        }

        // Store ship data
        this.activeShips.set(dockId, {
            ship: ship,
            dockData: dock,
            directions: dirs,  // Store direction vectors for movement
            spawnPosition: { x: spawnX, y: spawnY, z: spawnZ },
            dockPosition: { x: dockPosX, y: spawnY, z: dockPosZ },
            backupPosition: { x: backupX, y: spawnY, z: backupZ },
            initialRotation: initialRotation,
            currentPhase: PHASE.APPROACH
        });
    }

    /**
     * Remove ship for a dock
     */
    removeShip(dockId) {
        const shipData = this.activeShips.get(dockId);
        if (!shipData) return;

        // Unregister from animation system
        if (this.animationSystem && shipData.ship.userData.objectId) {
            this.animationSystem.unregister(shipData.ship.userData.objectId);
        }

        // Remove merchant ship collider
        if (this.game?.physicsManager && shipData.ship?.userData?.physicsBodyId) {
            this.game.physicsManager.removeKinematicBody(shipData.ship.userData.physicsBodyId);
        }

        // Remove from scene
        this.scene.remove(shipData.ship);

        // Dispose geometry and materials
        shipData.ship.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });

        this.activeShips.delete(dockId);
    }

    /**
     * Get cached phase timings (optimization - avoids recalculation per frame)
     * @returns {object} - Phase start times and durations
     */
    getPhaseTimings() {
        return this._phaseTimings;
    }

    /**
     * Calculate phase timings (called once in constructor)
     * @returns {object} - Phase start times and durations
     */
    _calculatePhaseTimings() {
        const approachDistance = SHIP_CONSTANTS.SPAWN_OFFSET - SHIP_CONSTANTS.DOCK_OFFSET;
        const approachTime = approachDistance / SHIP_CONSTANTS.CRUISE_SPEED + SHIP_CONSTANTS.EASE_DURATION;

        const backupTime = SHIP_CONSTANTS.BACKUP_DISTANCE / SHIP_CONSTANTS.BACKUP_SPEED + SHIP_CONSTANTS.EASE_DURATION;

        const departDistance = SHIP_CONSTANTS.SPAWN_OFFSET - SHIP_CONSTANTS.DOCK_OFFSET - SHIP_CONSTANTS.BACKUP_DISTANCE;
        const departTime = departDistance / SHIP_CONSTANTS.CRUISE_SPEED + SHIP_CONSTANTS.EASE_DURATION;

        return {
            approach: { start: 0, duration: approachTime },
            docked: { start: approachTime, duration: SHIP_CONSTANTS.DOCK_WAIT_TIME },
            backup: { start: approachTime + SHIP_CONSTANTS.DOCK_WAIT_TIME, duration: backupTime },
            rotate: { start: approachTime + SHIP_CONSTANTS.DOCK_WAIT_TIME + backupTime, duration: SHIP_CONSTANTS.ROTATE_DURATION },
            depart: {
                start: approachTime + SHIP_CONSTANTS.DOCK_WAIT_TIME + backupTime + SHIP_CONSTANTS.ROTATE_DURATION,
                duration: departTime
            }
        };
    }

    /**
     * Get current phase based on elapsed time
     */
    getCurrentPhase(elapsed) {
        const timings = this.getPhaseTimings();

        if (elapsed < timings.approach.duration) {
            return { phase: PHASE.APPROACH, phaseElapsed: elapsed, phaseDuration: timings.approach.duration };
        }

        if (elapsed < timings.docked.start + timings.docked.duration) {
            return { phase: PHASE.DOCKED, phaseElapsed: elapsed - timings.docked.start, phaseDuration: timings.docked.duration };
        }

        if (elapsed < timings.backup.start + timings.backup.duration) {
            return { phase: PHASE.BACKUP, phaseElapsed: elapsed - timings.backup.start, phaseDuration: timings.backup.duration };
        }

        if (elapsed < timings.rotate.start + timings.rotate.duration) {
            return { phase: PHASE.ROTATE, phaseElapsed: elapsed - timings.rotate.start, phaseDuration: timings.rotate.duration };
        }

        if (elapsed < timings.depart.start + timings.depart.duration) {
            return { phase: PHASE.DEPART, phaseElapsed: elapsed - timings.depart.start, phaseDuration: timings.depart.duration };
        }

        return { phase: PHASE.DESPAWNED, phaseElapsed: 0, phaseDuration: 0 };
    }

    /**
     * Update all active ships
     * Called every frame from game loop
     */
    update(deltaTime) {
        for (const [dockId, shipData] of this.activeShips) {
            const dock = this.docks.get(dockId);
            if (!dock || !dock.lastShipSpawn) {
                this.removeShip(dockId);
                continue;
            }

            const elapsed = (Date.now() - dock.lastShipSpawn) / 1000;
            const phaseInfo = this.getCurrentPhase(elapsed);

            // Check for despawn
            if (phaseInfo.phase === PHASE.DESPAWNED) {
                this.removeShip(dockId);
                // Clean up departure trade tracking
                this.departureTradeTriggered.delete(dockId);
                continue;
            }

            // Detect transition to BACKUP phase (ship starting to depart) - trigger trade
            if (phaseInfo.phase === PHASE.BACKUP && !this.departureTradeTriggered.has(dockId)) {
                this.departureTradeTriggered.add(dockId);
                this.triggerDepartureTrade(dockId, dock);
            }

            // Update ship position/rotation based on phase
            this.updateShipPhase(shipData, phaseInfo);

            // Check for boat collisions and update physics only during movement phases
            const isMovingPhase = phaseInfo.phase === PHASE.APPROACH ||
                                  phaseInfo.phase === PHASE.BACKUP ||
                                  phaseInfo.phase === PHASE.DEPART;

            if (isMovingPhase && this.game?.physicsManager && shipData.ship?.userData?.physicsBodyId) {
                this.game.physicsManager.updateKinematicPosition(
                    shipData.ship.userData.physicsBodyId,
                    shipData.ship.position
                );
                this.checkBoatCollisions(shipData.ship.userData.physicsBodyId);
            }
        }
    }

    /**
     * Check for unoccupied player boats overlapping with merchant ship and sink them
     * @param {string} merchantShipId - The merchant ship's physics body ID
     */
    checkBoatCollisions(merchantShipId) {
        if (!this.game?.physicsManager || !this.boatSinkingSystem) return;

        const overlappingBoats = this.game.physicsManager.checkMerchantShipOverlaps(merchantShipId);

        for (const boatInfo of overlappingBoats) {
            // Skip if already processed by this system
            if (this.sunkBoats.has(boatInfo.objectId)) continue;

            // Skip if already sinking via another code path (artillery, peer collision, etc.)
            if (this.boatSinkingSystem.isSinking(boatInfo.objectId)) continue;

            // Find the boat mesh from objectRegistry
            const boatMesh = this.game.objectRegistry?.get(boatInfo.objectId);

            if (!boatMesh) {
                console.error(`[Ship] Boat ${boatInfo.objectId} not in objectRegistry - skipping collision`);
                continue;
            }

            // Mark as processed AFTER confirming mesh exists (prevents orphaned sunk state)
            this.sunkBoats.add(boatInfo.objectId);

            // Play crash sound
            if (this.audioManager) {
                this.audioManager.playBoatCrashSound(boatInfo.entityType);
            }

            // Start sinking animation
            this.boatSinkingSystem.startSinking(boatMesh, boatInfo.objectId, null);

            // Remove boat's static physics collider (unoccupied boats use static colliders, not character controllers)
            this.game.physicsManager.removeCollider(boatInfo.objectId);

            // Get chunk info from boat mesh
            const chunkKey = boatMesh.userData.chunkKey;
            if (!chunkKey) {
                console.warn(`[Ship] Boat ${boatInfo.objectId} has no chunkKey`);
                continue;
            }

            // Send removal request to server (matches ActionManager pattern)
            if (this.networkManager) {
                this.networkManager.sendMessage('remove_object_request', {
                    chunkId: `chunk_${chunkKey}`,
                    objectId: boatInfo.objectId,
                    name: boatInfo.entityType,
                    position: boatMesh.position.toArray(),
                    quality: boatMesh.userData.quality || 50,
                    scale: boatMesh.userData.scale || 1,
                    objectData: {
                        name: boatInfo.entityType,
                        position: boatMesh.position.toArray(),
                        quality: boatMesh.userData.quality || 50,
                        scale: boatMesh.userData.scale || 1
                    },
                    clientId: this.game.gameState?.clientId
                });
            }
        }
    }

    /**
     * Trigger ship departure trade - sends message to server
     * @param {string} dockId - The dock ID
     * @param {object} dock - The dock data
     */
    triggerDepartureTrade(dockId, dock) {
        if (!this.networkManager) {
            console.warn('[Ship] Cannot trigger departure trade - no network manager');
            return;
        }

        // Send message to server to process trade
        this.networkManager.sendMessage('ship_departing', {
            dockId: dockId,
            chunkId: dock.chunkId
        });
    }

    /**
     * Update ship based on current phase
     */
    updateShipPhase(shipData, phaseInfo) {
        const { ship, spawnPosition, dockPosition, backupPosition, initialRotation } = shipData;
        const { phase, phaseElapsed, phaseDuration } = phaseInfo;
        const progress = Math.min(phaseElapsed / phaseDuration, 1);

        switch (phase) {
            case PHASE.APPROACH: {
                // Move from spawn to dock position (lerp both X and Z for rotated docks)
                const easedProgress = this.getEasedProgress(progress);
                ship.position.x = spawnPosition.x + (dockPosition.x - spawnPosition.x) * easedProgress;
                ship.position.z = spawnPosition.z + (dockPosition.z - spawnPosition.z) * easedProgress;
                break;
            }

            case PHASE.DOCKED: {
                // Stay at dock position
                ship.position.x = dockPosition.x;
                ship.position.z = dockPosition.z;
                break;
            }

            case PHASE.BACKUP: {
                // Move backward from dock to backup position (lerp both X and Z)
                const easedProgress = this.getEasedProgress(progress);
                ship.position.x = dockPosition.x + (backupPosition.x - dockPosition.x) * easedProgress;
                ship.position.z = dockPosition.z + (backupPosition.z - dockPosition.z) * easedProgress;
                break;
            }

            case PHASE.ROTATE: {
                // Rotate 180 degrees with easing
                const easedProgress = this.easeInOut(progress);
                // AnimationSystem stores originalRotation, we need to update it
                const animData = this.animationSystem?.animatedObjects.get(ship.userData.objectId);
                if (animData) {
                    animData.originalRotation.y = initialRotation + (Math.PI * easedProgress);
                }
                break;
            }

            case PHASE.DEPART: {
                // Move from backup position back to spawn (lerp both X and Z)
                const easedProgress = this.getEasedProgress(progress);
                ship.position.x = backupPosition.x + (spawnPosition.x - backupPosition.x) * easedProgress;
                ship.position.z = backupPosition.z + (spawnPosition.z - backupPosition.z) * easedProgress;
                break;
            }
        }
    }

    /**
     * Get eased progress for movement phases
     * Applies smooth ease-in-out for entire movement (slow start, slow stop)
     */
    getEasedProgress(linearProgress) {
        // Clamp to valid range and apply smooth easing to entire movement
        const progress = Math.max(0, Math.min(1, linearProgress));
        return this.easeInOut(progress);
    }

    /**
     * Check all registered docks and spawn ships if needed
     * Called when player joins/changes chunks
     */
    checkAllDocks() {
        for (const [dockId] of this.docks) {
            this.checkAndSpawnShip(dockId);
        }
    }

    /**
     * Clear all ships (used when changing areas)
     */
    clearAll() {
        for (const [dockId] of this.activeShips) {
            this.removeShip(dockId);
        }
        this.docks.clear();
        this.sunkBoats.clear();
    }

    /**
     * Get count of active ships
     */
    getActiveShipCount() {
        return this.activeShips.size;
    }

    /**
     * Get count of tracked docks
     */
    getDockCount() {
        return this.docks.size;
    }

    /**
     * Check if merchant ships are enabled for a dock
     * Returns true only if there's a market within 20 units AND merchantShipsEnabled is true
     * @param {string} dockId - The dock ID to check
     * @returns {boolean} - True if merchant ships are enabled
     */
    isMerchantShipsEnabledForDock(dockId) {
        const dock = this.docks.get(dockId);
        if (!dock) {
            return false;
        }

        const dockPos = new THREE.Vector3(dock.position[0], 0, dock.position[2]);
        let nearestMarket = null;
        let nearestDist = 20; // Max distance to search (matches server CONFIG.SHIP_TRADING.MAX_DISTANCE)

        // Use market registry instead of scene.traverse for O(1) chunk lookup
        // Check 3x3 chunk grid around dock (20 units < 50 unit chunk size)
        const chunkSize = 50;
        const dockChunkX = Math.floor(dock.position[0] / chunkSize);
        const dockChunkZ = Math.floor(dock.position[2] / chunkSize);

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const chunkKey = `${dockChunkX + dx},${dockChunkZ + dz}`;
                const markets = this.game?.gameState?.getMarketsInChunk(chunkKey) || [];

                for (const marketData of markets) {
                    if (!marketData.object) continue;
                    const dist = dockPos.distanceTo(marketData.object.position);
                    if (dist < nearestDist) {
                        nearestDist = dist;
                        nearestMarket = marketData.object;
                    }
                }
            }
        }

        const enabled = nearestMarket?.userData?.merchantShipsEnabled;

        // Must have a market AND merchantShipsEnabled must be true
        return enabled === true;
    }

    /**
     * Check if any dock needs a ship spawn triggered
     * Called periodically by MessageRouter (every 60 ticks)
     * @param {function} sendMessage - Function to send network message
     */
    checkAndTriggerShipSpawns(sendMessage) {
        const SHIP_SPAWN_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
        const now = Date.now();

        for (const [dockId, dock] of this.docks) {
            // Skip if already triggered recently (prevent duplicate sends)
            if (dock._shipTriggerSent) {
                continue;
            }

            // Skip if no market with merchant ships enabled near this dock
            const merchantEnabled = this.isMerchantShipsEnabledForDock(dockId);
            if (!merchantEnabled) {
                continue;
            }

            // Check if 30 minutes elapsed
            const elapsed = now - (dock.lastShipSpawn || 0);

            if (elapsed >= SHIP_SPAWN_INTERVAL_MS) {
                dock._shipTriggerSent = true;

                // Reset flag after a delay (in case message fails)
                setTimeout(() => {
                    dock._shipTriggerSent = false;
                }, 10000);

                // Get chunkId from dock position using center-based chunk coordinates
                const chunkId = ChunkCoordinates.worldToChunkId(dock.position[0], dock.position[2]);

                sendMessage('trigger_dock_ship', {
                    dockId: dockId,
                    chunkId: chunkId
                });
            }
        }
    }

    /**
     * Reset trigger flag when ship spawn is confirmed by server
     * Called when dock_ship_spawned message received
     */
    onShipSpawnConfirmed(dockId) {
        const dock = this.docks.get(dockId);
        if (dock) {
            dock._shipTriggerSent = false;
        }
    }
}

// Export constants and helpers for reference
export { SHIP_CONSTANTS, PHASE, getDockDirections };

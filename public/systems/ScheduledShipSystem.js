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
    SPAWN_OFFSET_X: 100,      // Units from dock in +X direction
    DOCK_OFFSET_X: 5,         // Final X position relative to dock (towards sea)
    DOCK_OFFSET_Z: 1.3,       // Z offset from dock (parallel offset)
    BACKUP_DISTANCE: 7,       // Units to back up before rotating
    WATER_LEVEL: 0,           // Ship Y position (water level)

    // Speeds
    CRUISE_SPEED: 1.0,        // Units per second (200% of player 0.5 u/s)
    BACKUP_SPEED: 0.2,        // Units per second for backing up
    ROTATION_SPEED: 3,        // Degrees per second (180° over 60s)

    // Durations (seconds)
    EASE_DURATION: 10,        // Ease in/out duration for starts/stops
    DOCK_WAIT_TIME: 180,      // 3 minutes waiting at dock
    ROTATE_DURATION: 60,      // 1 minute to rotate 180°

    // Total cycle (calculated properly)
    // Approach: 97 units at 1 u/s + 10s ease = 107s
    // Dock: 180s
    // Backup: 7 units at 0.2 u/s + 10s ease = 45s
    // Rotate: 60s
    // Depart: 90 units at 1 u/s + 10s ease = 100s
    // Total: 492s (use 500 for safety margin)
    TOTAL_CYCLE_DURATION: 500
};

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
    }

    /**
     * Set network manager reference for sending messages
     */
    setNetworkManager(networkManager) {
        this.networkManager = networkManager;
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
        // Calculate spawn position
        const spawnX = dock.position[0] + SHIP_CONSTANTS.SPAWN_OFFSET_X;
        const spawnZ = dock.position[2] + SHIP_CONSTANTS.DOCK_OFFSET_Z;
        const spawnY = SHIP_CONSTANTS.WATER_LEVEL;

        // Ship starts facing west (toward dock) = rotation 270° = Math.PI * 1.5
        // (Ship model's forward is rotated 90° from expected, so we add π/2)
        const initialRotation = Math.PI * 1.5;

        // Create ship using objectPlacer
        const shipPosition = new THREE.Vector3(spawnX, spawnY, spawnZ);
        const ship = objectPlacer.createInstance(
            'ship',
            shipPosition,
            1.0, // scale
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

        // Store ship data
        this.activeShips.set(dockId, {
            ship: ship,
            dockData: dock,
            spawnPosition: { x: spawnX, y: spawnY, z: spawnZ },
            dockPosition: {
                x: dock.position[0] + SHIP_CONSTANTS.DOCK_OFFSET_X,
                y: spawnY,
                z: spawnZ
            },
            backupPosition: {
                x: dock.position[0] + SHIP_CONSTANTS.DOCK_OFFSET_X + SHIP_CONSTANTS.BACKUP_DISTANCE,
                y: spawnY,
                z: spawnZ
            },
            initialRotation: initialRotation,
            currentPhase: PHASE.APPROACH
        });

        console.log(`[ScheduledShipSystem] Created ship for dock ${dockId} at (${spawnX.toFixed(1)}, ${spawnY}, ${spawnZ.toFixed(1)})`);
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
        console.log(`[ScheduledShipSystem] Removed ship for dock ${dockId}`);
    }

    /**
     * Calculate phase timings
     * @returns {object} - Phase start times and durations
     */
    getPhaseTimings() {
        const approachDistance = SHIP_CONSTANTS.SPAWN_OFFSET_X - SHIP_CONSTANTS.DOCK_OFFSET_X;
        const approachTime = approachDistance / SHIP_CONSTANTS.CRUISE_SPEED + SHIP_CONSTANTS.EASE_DURATION;

        const backupTime = SHIP_CONSTANTS.BACKUP_DISTANCE / SHIP_CONSTANTS.BACKUP_SPEED + SHIP_CONSTANTS.EASE_DURATION;

        const departDistance = SHIP_CONSTANTS.SPAWN_OFFSET_X - SHIP_CONSTANTS.DOCK_OFFSET_X - SHIP_CONSTANTS.BACKUP_DISTANCE;
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
                console.log(`[Ship] Despawning - elapsed ${elapsed.toFixed(1)}s exceeds cycle`);
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

        console.log(`[Ship] Ship departing from dock ${dockId}, triggering trade...`);

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
                // Move from spawn to dock position
                const easedProgress = this.getEasedProgress(progress);
                ship.position.x = spawnPosition.x + (dockPosition.x - spawnPosition.x) * easedProgress;
                ship.position.z = spawnPosition.z; // Z stays constant
                break;
            }

            case PHASE.DOCKED: {
                // Stay at dock position
                ship.position.x = dockPosition.x;
                ship.position.z = dockPosition.z;
                break;
            }

            case PHASE.BACKUP: {
                // Move backward from dock to backup position
                const easedProgress = this.getEasedProgress(progress);
                ship.position.x = dockPosition.x + (backupPosition.x - dockPosition.x) * easedProgress;
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
                // Move from backup position back to spawn (now facing east)
                const easedProgress = this.getEasedProgress(progress);
                ship.position.x = backupPosition.x + (spawnPosition.x - backupPosition.x) * easedProgress;
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
     * Check if any dock needs a ship spawn triggered
     * Called periodically by MessageRouter (every 60 ticks)
     * @param {function} sendMessage - Function to send network message
     */
    checkAndTriggerShipSpawns(sendMessage) {
        const SHIP_SPAWN_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
        const now = Date.now();

        for (const [dockId, dock] of this.docks) {
            // Skip if already triggered recently (prevent duplicate sends)
            if (dock._shipTriggerSent) continue;

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

                console.log(`[ScheduledShipSystem] Sent trigger_dock_ship for dock ${dockId}`);
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

// Export constants for reference
export { SHIP_CONSTANTS, PHASE };

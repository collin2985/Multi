/**
 * MobileEntitySystem.js
 * Handles pilotable/rideable entities (boats, carts, horses)
 * Manages proximity detection, occupancy tracking, movement physics, and disembark validation
 */

import { getTerrainHeight } from '../core/TerrainAccess.js';
import { CONFIG } from '../config.js';
import { COLLISION_GROUPS } from '../core/PhysicsManager.js';

// Entity type configurations
const ENTITY_CONFIGS = {
    boat: {
        proximityRange: 3,
        buttonLabel: 'Enter Boat',
        exitButtonLabel: 'Exit Boat',
        terrainConstraint: 'water',
        minWaterDepth: 0,                   // Can go to shore edge (terrainY < 0)
        playerYOffset: -0.1,
        boardingDuration: 1000,  // ms for boarding animation
        // Physics constants
        maxSpeed: 0.001,                    // 1.0 units/sec
        acceleration: 0.001 / 3000,         // 3 seconds to reach max speed
        deceleration: 0.001 / 4000,         // 4 seconds to drift to stop
        reverseDecel: 0.001 / 2000,         // 2 seconds to slow before reversing
        baseTurnRate: (Math.PI * 2) / 12000, // 360 deg in 12s at rest (radians per ms)
        // Collision (character controller dimensions)
        collisionRadius: 0.5,               // Wider than horse (0.15) for boat width
        collisionHeight: 1.5,               // Matches boat height
        // Hull dimensions for corner-based water depth check
        halfWidth: 0.35,                    // 0.7 / 2
        halfDepth: 0.7                      // 1.4 / 2
    },
    sailboat: {
        proximityRange: 3,
        buttonLabel: 'Enter Sailboat',
        exitButtonLabel: 'Exit Sailboat',
        terrainConstraint: 'water',
        minWaterDepth: -0.3,                    // Needs 0.3 depth
        playerYOffset: -0.1,
        boardingDuration: 1000,
        maxSpeed: 0.0015,                       // 1.5 units/sec
        acceleration: 0.0015 / 3000,
        deceleration: 0.0015 / 4000,
        reverseDecel: 0.0015 / 2000,
        baseTurnRate: (Math.PI * 2) / 16000,    // 360 deg in 16s
        collisionRadius: 0.6,
        collisionHeight: 2.0,
        // Hull dimensions for corner-based water depth check
        halfWidth: 0.35,                        // 0.7 / 2
        halfDepth: 1.0                          // 2.0 / 2
    },
    ship2: {
        proximityRange: 4,
        buttonLabel: 'Board Ship',
        exitButtonLabel: 'Disembark',
        terrainConstraint: 'water',
        minWaterDepth: -1.5,                    // Needs 1.5 depth
        playerYOffset: 1.2,
        playerZOffset: -2.5,                    // Helm position toward stern
        boardingDuration: 1000,
        maxSpeed: 0.00125,                      // 1.25 units/sec
        acceleration: 0.00125 / 3000,
        deceleration: 0.00125 / 4000,
        reverseDecel: 0.00125 / 2000,
        baseTurnRate: (Math.PI * 2) / 20000,    // 360 deg in 20s
        collisionRadius: 0.8,
        collisionHeight: 3.0,
        // Hull dimensions for corner-based water depth check
        halfWidth: 1.0,                         // 2.0 / 2
        halfDepth: 4.0                          // 8.0 / 2
    },
    horse: {
        proximityRange: 2,
        buttonLabel: 'Mount Horse',
        exitButtonLabel: 'Dismount',
        terrainConstraint: 'land',          // terrain height >= 0
        playerYOffset: 0.25,                // 0.1 down from default for better alignment
        playerForwardOffset: 0.05,          // 0.05 forward for better alignment
        boardingDuration: 1000,             // 1 second mount animation

        // Physics
        maxSpeed: 0.0015,                   // 1.5 units/sec (1.5x player walk)
        acceleration: 0.0015 / 2000,        // 2 seconds to full speed
        deceleration: 0.0015 / 1000,        // 1 second to stop
        baseTurnRate: (Math.PI * 2) / 4000, // 360 deg in 4 seconds
        slopeSpeedMin: 0.05,                // 5% speed when slope > 50 deg (prevents getting stuck)

        // Horse-specific
        canReverse: false,                  // No backward movement
        maxWalkableSlope: 50,               // Degrees - 5% speed above this (not blocked)

        // Animation (horse.glb has 'walk' animation)
        hasAnimation: true,
        animationName: 'walk',
        animationFallbackPatterns: ['walk', 'run', 'gallop', 'trot'],
        idleFrame: 0,                       // Use frame 0 for idle (frozen pose)
        baseAnimationSpeed: 2.0,            // Doubled for faster animation
        minAnimationSpeed: 0.6,             // Min speed when turning in place
        turningAnimationSpeed: 1.0,         // Animation speed when turning but not moving

        // Sound (horse.mp3 exists in sounds folder)
        soundFile: 'horse',                 // Registered name in AudioManager
        soundLoopDuration: 4000,            // Loop first 4 seconds of horse.mp3
        soundMinPlaybackRate: 0.5,          // Playback rate when slow
        soundMaxPlaybackRate: 1.0           // Playback rate at max speed
    }
};

export class MobileEntitySystem {
    // Precomputed grid offsets for landing position search (computed once, reused)
    static _cachedOffsets = null;
    static _cachedMaxRadius = 0;
    static _cachedSpacing = 0;

    /**
     * Get precomputed grid offsets sorted by distance
     * Computed once and cached for reuse across all unload operations
     * @private
     */
    static _getOffsets(maxRadius, spacing) {
        // Return cached if params match
        if (MobileEntitySystem._cachedOffsets &&
            MobileEntitySystem._cachedMaxRadius === maxRadius &&
            MobileEntitySystem._cachedSpacing === spacing) {
            return MobileEntitySystem._cachedOffsets;
        }

        // Generate and cache offsets
        const offsets = [];
        const steps = Math.ceil(maxRadius / spacing);
        const maxRadiusSq = maxRadius * maxRadius;

        for (let gx = -steps; gx <= steps; gx++) {
            for (let gz = -steps; gz <= steps; gz++) {
                if (gx === 0 && gz === 0) continue;
                const lx = gx * spacing;
                const lz = gz * spacing;
                const distSq = lx * lx + lz * lz;
                if (distSq > maxRadiusSq) continue;
                offsets.push({ lx, lz, distSq });
            }
        }

        offsets.sort((a, b) => a.distSq - b.distSq);

        MobileEntitySystem._cachedOffsets = offsets;
        MobileEntitySystem._cachedMaxRadius = maxRadius;
        MobileEntitySystem._cachedSpacing = spacing;

        return offsets;
    }

    constructor() {
        // Track which entities are occupied (entityId -> clientId)
        this.occupiedEntities = new Map();

        // Ship crew roster - tracks all crew members by role for ship2
        // shipId -> { pilot: clientId|null, portGunner: clientId|null, starboardGunner: clientId|null }
        this.shipCrewRoster = new Map();

        // Movement state (for piloting)
        this.velocity = 0;
        this.heading = 0;
        this.canDisembark = false;
        this.disembarkPosition = null;

        // Cart towing state
        this.isReversingWithCart = false;  // Track reverse mode for horse
        this.navigationManager = null;     // Set by Game class for road speed bonus

        // Cached trig values for water boundary checks (optimization)
        this._cachedHeading = null;
        this._cachedCosH = 0;
        this._cachedSinH = 0;
    }

    /**
     * Set navigation manager for road speed checks
     * @param {NavigationManager} navManager
     */
    setNavigationManager(navManager) {
        this.navigationManager = navManager;
    }

    /**
     * Check if an entity is currently occupied
     * @param {string} entityId
     * @returns {boolean}
     */
    isOccupied(entityId) {
        return this.occupiedEntities.has(entityId);
    }

    /**
     * Mark an entity as occupied
     * @param {string} entityId
     * @param {string} clientId
     */
    setOccupied(entityId, clientId) {
        this.occupiedEntities.set(entityId, clientId);
    }

    /**
     * Clear occupancy of an entity
     * @param {string} entityId
     */
    clearOccupied(entityId) {
        this.occupiedEntities.delete(entityId);
    }

    /**
     * Get the client ID occupying an entity
     * @param {string} entityId
     * @returns {string|null}
     */
    getOccupant(entityId) {
        return this.occupiedEntities.get(entityId) || null;
    }

    // ==========================================
    // SHIP CREW ROSTER (ship2 multi-crew tracking)
    // ==========================================

    /**
     * Initialize an empty crew roster for a ship
     * @param {string} shipId
     */
    initShipCrew(shipId) {
        if (!this.shipCrewRoster.has(shipId)) {
            this.shipCrewRoster.set(shipId, {
                pilot: null,
                portGunner: null,
                starboardGunner: null
            });
        }
    }

    /**
     * Set a crew member in a specific role
     * @param {string} shipId
     * @param {string} role - 'pilot', 'portGunner', or 'starboardGunner'
     * @param {string} clientId
     */
    setShipCrewMember(shipId, role, clientId) {
        this.initShipCrew(shipId);
        const roster = this.shipCrewRoster.get(shipId);
        if (roster && (role === 'pilot' || role === 'portGunner' || role === 'starboardGunner')) {
            roster[role] = clientId;
        }
    }

    /**
     * Clear a crew member from a specific role
     * @param {string} shipId
     * @param {string} role - 'pilot', 'portGunner', or 'starboardGunner'
     */
    clearShipCrewMember(shipId, role) {
        const roster = this.shipCrewRoster.get(shipId);
        if (roster && (role === 'pilot' || role === 'portGunner' || role === 'starboardGunner')) {
            roster[role] = null;
        }
    }

    /**
     * Get the full crew roster for a ship
     * @param {string} shipId
     * @returns {object|null} - { pilot, portGunner, starboardGunner } or null
     */
    getShipCrew(shipId) {
        return this.shipCrewRoster.get(shipId) || null;
    }

    /**
     * Check if anyone is aboard the ship
     * @param {string} shipId
     * @returns {boolean}
     */
    isAnyoneAboard(shipId) {
        const roster = this.shipCrewRoster.get(shipId);
        if (!roster) return false;
        return roster.pilot !== null || roster.portGunner !== null || roster.starboardGunner !== null;
    }

    /**
     * Check if a gunner slot is occupied on a ship
     * @param {string} shipId
     * @param {number} slotIndex - 0 for starboard, 1 for port
     * @returns {boolean}
     */
    isGunnerSlotOccupied(shipId, slotIndex) {
        const roster = this.shipCrewRoster.get(shipId);
        if (!roster) return false;
        const role = slotIndex === 0 ? 'starboardGunner' : 'portGunner';
        return roster[role] != null;
    }

    /**
     * Clear entire crew roster (ship destroyed/sunk)
     * @param {string} shipId
     */
    clearShipCrew(shipId) {
        this.shipCrewRoster.delete(shipId);
    }

    /**
     * Find which role a client has on a ship
     * @param {string} shipId
     * @param {string} clientId
     * @returns {string|null} - 'pilot', 'portGunner', 'starboardGunner', or null
     */
    getCrewRole(shipId, clientId) {
        const roster = this.shipCrewRoster.get(shipId);
        if (!roster) return null;
        if (roster.pilot === clientId) return 'pilot';
        if (roster.portGunner === clientId) return 'portGunner';
        if (roster.starboardGunner === clientId) return 'starboardGunner';
        return null;
    }

    /**
     * Get configuration for an entity type
     * @param {string} entityType
     * @returns {object|null}
     */
    getConfig(entityType) {
        return ENTITY_CONFIGS[entityType] || null;
    }

    /**
     * Initialize movement state when starting to pilot
     * @param {THREE.Object3D} entity - The entity being piloted
     */
    initMovement(entity) {
        this.velocity = 0;
        this.heading = entity.rotation.y;
        this.canDisembark = false;
        this.disembarkPosition = null;
        this.isReversingWithCart = false; // Reset stale cart state
    }

    /**
     * Check if player can disembark/dismount at current position
     * For boats: need valid land nearby (y >= 0) OR inside a dock sensor - dismounting FROM water TO land/dock
     * For horses: need valid flat land nearby (y >= 0, slope <= 50 deg) - already on land
     * @param {THREE.Vector3} position - Current entity position
     * @param {string} entityType - 'boat' or 'horse' (default: 'boat')
     * @param {PhysicsManager} physicsManager - Physics manager for dock detection (optional)
     */
    checkDisembarkable(position, entityType = 'boat', physicsManager = null) {
        this.canDisembark = false;
        this.disembarkPosition = null;

        // Dismount distance: horses dismount close (0.3), boats need to reach shore (2)
        const dismountDistance = entityType === 'horse' ? 0.3 : 2;

        // Sample 8 points in circle
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const x = position.x + Math.cos(angle) * dismountDistance;
            const z = position.z + Math.sin(angle) * dismountDistance;
            const y = getTerrainHeight(x, z);  // Includes dock height via leveled areas

            // Valid terrain (land with y >= 0, includes docks)
            // Note: Slope check removed - player can stand on any terrain, even if horse can't traverse it
            if (y >= 0) {
                // Valid dismount point found
                this.canDisembark = true;
                this.disembarkPosition = { x, y: y + 0.03, z };
                return;  // First valid point is enough
            }
        }
    }

    /**
     * Check disembark at current position (called when boat stops or on demand)
     * @param {THREE.Object3D} entity - The entity
     * @param {string} entityType - 'boat' or 'horse'
     * @param {PhysicsManager} physicsManager - Physics manager for dock detection (optional)
     */
    updateDisembarkCheck(entity, entityType = 'boat', physicsManager = null) {
        if (this.velocity === 0) {
            this.checkDisembarkable(entity.position, entityType, physicsManager);
        }
    }

    /**
     * Find valid landing position for crate unload from boat
     * Uses same algorithm as checkDisembarkable but returns position
     * @param {THREE.Vector3} boatPosition - Current boat position
     * @param {number} boatHeading - Boat rotation to prioritize search direction
     * @returns {object|null} - { x, y, z } or null if no valid land found
     */
    /**
     * Generate grid points sorted by distance from origin
     * Uses precomputed offsets for performance - only does rotation/translation at runtime
     * @private
     */
    _generateGridPoints(shipPosition, shipHeading, maxRadius = 8, spacing = 0.15) {
        // Get precomputed offsets (cached after first call)
        const offsets = MobileEntitySystem._getOffsets(maxRadius, spacing);
        const cosH = Math.cos(shipHeading);
        const sinH = Math.sin(shipHeading);

        // Transform precomputed local offsets to world coordinates
        const points = [];
        for (const o of offsets) {
            points.push({
                x: shipPosition.x + o.lx * cosH - o.lz * sinH,
                z: shipPosition.z + o.lx * sinH + o.lz * cosH,
                distSq: o.distSq
            });
        }
        return points;
    }

    findCrateLandingPosition(boatPosition, boatHeading, physicsManager = null) {
        const gridPoints = this._generateGridPoints(boatPosition, boatHeading, 8, 0.15);

        // Shape for collision testing (crate-sized)
        const shape = { type: 'cuboid', width: 1.0, depth: 1.0, height: 1.5 };
        const collisionMask = COLLISION_GROUPS.STRUCTURE | COLLISION_GROUPS.NATURAL |
                              COLLISION_GROUPS.PLACED | COLLISION_GROUPS.PLAYER | COLLISION_GROUPS.PEER;

        // Find first valid land position without collisions
        for (const point of gridPoints) {
            const y = getTerrainHeight(point.x, point.z);
            if (y < 0) continue;  // Not land

            // Check for collisions if physics manager available
            if (physicsManager?.testShapeOverlap) {
                const hasCollision = physicsManager.testShapeOverlap(
                    shape, { x: point.x, y: y, z: point.z }, 0, collisionMask
                );
                if (hasCollision) continue;  // Blocked by something
            }

            return { x: point.x, y: y + 0.1, z: point.z };
        }
        return null;  // No valid land found
    }

    /**
     * Find multiple valid landing positions for bulk unloading from ship
     * Uses grid pattern with 0.15 spacing, aligned with ship heading
     * Searches closest to ship first within 8 unit radius
     *
     * @param {THREE.Vector3} shipPosition - Current ship position
     * @param {number} shipHeading - Ship rotation (radians)
     * @param {number} count - Number of positions needed
     * @param {number} minSpacing - Minimum distance between positions (default 0.4)
     * @param {PhysicsManager} physicsManager - Optional physics manager for collision checking
     * @returns {Array<{x,y,z}>} - Array of valid positions (may be fewer than requested)
     */
    findMultipleLandingPositions(shipPosition, shipHeading, count, minSpacing = 0.4, physicsManager = null) {
        const positions = [];
        if (count <= 0) return positions;

        const minSpacingSq = minSpacing * minSpacing;
        const gridPoints = this._generateGridPoints(shipPosition, shipHeading, 8, 0.15);

        // Shape for collision testing (crate-sized)
        const shape = { type: 'cuboid', width: 1.0, depth: 1.0, height: 1.5 };
        const collisionMask = COLLISION_GROUPS.STRUCTURE | COLLISION_GROUPS.NATURAL |
                              COLLISION_GROUPS.PLACED | COLLISION_GROUPS.PLAYER | COLLISION_GROUPS.PEER;

        // Helper to check if position is far enough from all existing positions
        const isFarEnough = (x, z) => {
            for (const pos of positions) {
                const dx = x - pos.x;
                const dz = z - pos.z;
                if (dx * dx + dz * dz < minSpacingSq) {
                    return false;
                }
            }
            return true;
        };

        // Search grid points (already sorted by distance)
        for (const point of gridPoints) {
            if (positions.length >= count) break;

            const y = getTerrainHeight(point.x, point.z);
            if (y < 0) continue;  // Not land

            // Check spacing from other found positions
            if (!isFarEnough(point.x, point.z)) continue;

            // Check for collisions if physics manager available
            if (physicsManager?.testShapeOverlap) {
                const hasCollision = physicsManager.testShapeOverlap(
                    shape, { x: point.x, y: y, z: point.z }, 0, collisionMask
                );
                if (hasCollision) continue;  // Blocked by something
            }

            positions.push({ x: point.x, y: y + 0.1, z: point.z });
        }

        return positions;
    }

}

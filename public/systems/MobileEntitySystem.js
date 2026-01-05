/**
 * MobileEntitySystem.js
 * Handles pilotable/rideable entities (boats, carts, horses)
 * Manages proximity detection, occupancy tracking, movement physics, and disembark validation
 */

import { getTerrainHeight } from '../core/TerrainAccess.js';
import { CONFIG } from '../config.js';

// Entity type configurations
const ENTITY_CONFIGS = {
    boat: {
        proximityRange: 3,
        buttonLabel: 'Enter Boat',
        exitButtonLabel: 'Exit Boat',
        terrainConstraint: 'water',
        playerYOffset: -0.1,
        boardingDuration: 1000,  // ms for boarding animation
        // Physics constants
        maxSpeed: 0.005,                    // 5.0 units/sec (fast for testing)
        acceleration: 0.005 / 3000,         // 3 seconds to reach max speed
        deceleration: 0.005 / 4000,         // 4 seconds to drift to stop
        reverseDecel: 0.005 / 2000,         // 2 seconds to slow before reversing
        baseTurnRate: (Math.PI * 2) / 12000 // 360 deg in 12s at rest (radians per ms)
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
    constructor() {
        // Track which entities are occupied (entityId -> clientId)
        this.occupiedEntities = new Map();

        // Movement state (for piloting)
        this.velocity = 0;
        this.heading = 0;
        this.canDisembark = false;
        this.disembarkPosition = null;

        // Cart towing state
        this.isReversingWithCart = false;  // Track reverse mode for horse
        this.navigationManager = null;     // Set by Game class for road speed bonus

        // Mount grace period - ignore collisions for first N frames after mounting
        // This prevents getting stuck when mounting near obstacles
        // Extended to 90 frames (~1.5s) to cover the 1-second boarding animation + buffer for player input
        this.MOUNT_GRACE_FRAMES = 90;      // ~1.5 seconds at 60fps
        this.mountFrameCount = 0;          // Frames since mount started
    }

    /**
     * Set navigation manager for road speed checks
     * @param {NavigationManager} navManager
     */
    setNavigationManager(navManager) {
        this.navigationManager = navManager;
    }

    /**
     * Check if a structure is a mobile entity type and available for boarding
     * @param {THREE.Object3D} nearestStructure - The nearest structure object
     * @param {number} distance - Distance to the structure
     * @returns {object|null} - { type: 'boat', object } or null
     */
    checkNearestStructure(nearestStructure, distance) {
        if (!nearestStructure || !nearestStructure.userData) {
            return null;
        }

        const modelType = nearestStructure.userData.modelType;
        const config = ENTITY_CONFIGS[modelType];

        if (!config) {
            return null;
        }

        // Check if within proximity range
        if (distance > config.proximityRange) {
            return null;
        }

        // Check if already occupied
        const entityId = nearestStructure.userData.objectId;
        if (this.isOccupied(entityId)) {
            return null;
        }

        return {
            type: modelType,
            object: nearestStructure
        };
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

    /**
     * Get configuration for an entity type
     * @param {string} entityType
     * @returns {object|null}
     */
    getConfig(entityType) {
        return ENTITY_CONFIGS[entityType] || null;
    }

    /**
     * Get button label based on entity type and piloting state
     * @param {string} entityType
     * @param {boolean} isPiloting
     * @returns {string}
     */
    getButtonLabel(entityType, isPiloting) {
        const config = ENTITY_CONFIGS[entityType];
        if (!config) return 'Enter';
        return isPiloting ? config.exitButtonLabel : config.buttonLabel;
    }

    /**
     * Initialize movement state when starting to pilot
     * @param {THREE.Object3D} entity - The entity being piloted
     */
    initMovement(entity) {
        // Debug: Log previous state to detect stale values
        console.log('[Horse Mount] initMovement called:', {
            prevVelocity: this.velocity,
            prevHeading: this.heading,
            prevIsReversingWithCart: this.isReversingWithCart,
            entityRotationY: entity.rotation.y,
            entityPosition: [entity.position.x, entity.position.y, entity.position.z]
        });
        this.velocity = 0;
        this.heading = entity.rotation.y;
        this.canDisembark = false;
        this.disembarkPosition = null;
        this.isReversingWithCart = false; // Reset stale cart state
        this.mountFrameCount = 0;         // Reset grace period counter
    }

    /**
     * Update boat movement based on WASD input
     * @param {object} keys - { w, a, s, d } boolean states
     * @param {number} deltaTime - Time since last frame in ms
     * @param {THREE.Object3D} entity - The boat entity
     * @param {string} entityType - Entity type for config lookup (default: 'boat')
     * @param {boolean} isDead - Whether player is dead (no input, just drift)
     * @returns {boolean} - Whether the boat moved
     */
    updateBoatMovement(keys, deltaTime, entity, entityType = 'boat', isDead = false) {
        const config = ENTITY_CONFIGS[entityType];
        const wasStopped = this.velocity === 0;

        // If dead, ignore input - just apply drag to stop
        if (isDead) {
            if (this.velocity > 0) {
                this.velocity = Math.max(0, this.velocity - config.deceleration * deltaTime);
            } else if (this.velocity < 0) {
                this.velocity = Math.min(0, this.velocity + config.deceleration * deltaTime);
            }
        } else {
            // Normal input processing
            const wantsForward = keys.w;
            const wantsBackward = keys.s;
            const wantsLeft = keys.a;
            const wantsRight = keys.d;

            // Turn rate: slower when moving fast (100% at rest, 50% at full speed)
            const speedRatio = Math.abs(this.velocity) / config.maxSpeed;
            const turnRate = config.baseTurnRate * (1 - speedRatio * 0.5);

            // Apply turning
            if (wantsLeft) this.heading += turnRate * deltaTime;
            if (wantsRight) this.heading -= turnRate * deltaTime;

            // Forward/backward with momentum
            if (wantsForward) {
                if (this.velocity >= 0) {
                    this.velocity += config.acceleration * deltaTime;
                } else {
                    this.velocity += config.reverseDecel * deltaTime;
                }
            } else if (wantsBackward) {
                if (this.velocity <= 0) {
                    this.velocity -= config.acceleration * deltaTime;
                } else {
                    this.velocity -= config.reverseDecel * deltaTime;
                }
            } else {
                // No input - drag toward 0
                if (this.velocity > 0) {
                    this.velocity = Math.max(0, this.velocity - config.deceleration * deltaTime);
                } else if (this.velocity < 0) {
                    this.velocity = Math.min(0, this.velocity + config.deceleration * deltaTime);
                }
            }
        }

        // Clamp to max speed
        this.velocity = Math.max(-config.maxSpeed, Math.min(config.maxSpeed, this.velocity));

        // Calculate next position
        const nextX = entity.position.x + Math.sin(this.heading) * this.velocity * deltaTime;
        const nextZ = entity.position.z + Math.cos(this.heading) * this.velocity * deltaTime;

        // Water boundary check (terrain Y must be < 0 for water)
        const terrainY = getTerrainHeight(nextX, nextZ);
        if (terrainY >= 0) {
            // Hit shore - stop
            this.velocity = 0;
        } else {
            // Apply movement (X/Z only - AnimationSystem handles Y via wave height)
            entity.position.x = nextX;
            entity.position.z = nextZ;
        }
        entity.rotation.y = this.heading;

        // Check for disembark on stop (one-time check)
        const nowStopped = this.velocity === 0;
        if (!wasStopped && nowStopped) {
            this.checkDisembarkable(entity.position);
        }

        // Clear disembark if moving again
        if (!nowStopped) {
            this.canDisembark = false;
            this.disembarkPosition = null;
        }

        return this.velocity !== 0;
    }

    /**
     * Check if player can disembark/dismount at current position
     * For boats: need valid land nearby (y >= 0) - dismounting FROM water TO land
     * For horses: need valid flat land nearby (y >= 0, slope <= 50 deg) - already on land
     * @param {THREE.Vector3} position - Current entity position
     * @param {string} entityType - 'boat' or 'horse' (default: 'boat')
     */
    checkDisembarkable(position, entityType = 'boat') {
        this.canDisembark = false;
        this.disembarkPosition = null;

        // Dismount distance: horses dismount close (0.5), boats need to reach shore (2)
        const dismountDistance = entityType === 'horse' ? 0.5 : 2;

        // Sample 8 points in circle
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const x = position.x + Math.cos(angle) * dismountDistance;
            const z = position.z + Math.sin(angle) * dismountDistance;
            const y = getTerrainHeight(x, z);

            // Both boats and horses need to dismount onto land (y >= 0)
            // Boats: player exits from water onto shore
            // Horses: player dismounts onto nearby land (can't dismount into water)
            if (y < 0) continue;

            // For horses, also check slope at dismount point isn't too steep
            if (entityType === 'horse') {
                const slopeCheck = this.calculateSlopeEffect({ x, y, z }, 0);
                // Skip if slope would reduce speed to minimum (too steep to dismount safely)
                if (slopeCheck.multiplier <= ENTITY_CONFIGS.horse.slopeSpeedMin) continue;
            }

            // Valid dismount point found
            this.canDisembark = true;
            this.disembarkPosition = { x, y: y + 0.03, z };
            return;  // First valid point is enough
        }
    }

    /**
     * Check disembark at current position (called when boat stops or on demand)
     * @param {THREE.Object3D} entity - The entity
     * @param {string} entityType - 'boat' or 'horse'
     */
    updateDisembarkCheck(entity, entityType = 'boat') {
        if (this.velocity === 0) {
            this.checkDisembarkable(entity.position, entityType);
        }
    }

    /**
     * Update horse movement with vehicle-style towing support and road bonus
     * @param {object} keys - Input keys { w, a, s, d }
     * @param {number} deltaTime - Frame delta in ms
     * @param {THREE.Object3D} entity - Horse mesh
     * @param {boolean} isDead - Whether player is dead
     * @param {PhysicsManager} physicsManager - For collision detection
     * @param {string} entityId - Entity ID for collision
     * @param {object} cartAttachmentState - Cart towing state (optional)
     * @param {object} crateLoadState - Crate load state (optional)
     * @returns {object} { moved, hitWater, speedRatio, isTurning, hitObstacle }
     */
    updateHorseMovement(keys, deltaTime, entity, isDead = false, physicsManager = null, entityId = null, cartAttachmentState = null, crateLoadState = null, artilleryAttachmentState = null) {
        const config = ENTITY_CONFIGS.horse;
        const wasStopped = this.velocity === 0;
        let hitWater = false;
        let isTurning = false;
        let hitObstacle = false;

        // Use CONFIG with fallback for safety
        const CART = CONFIG.CART_PHYSICS || {
            ROAD_SPEED_MULTIPLIER: 2.0,
            LOADED_CART_SPEED_MULTIPLIER: 0.5,
            MOUNTED_LOADED_CART_SPEED_MULTIPLIER: 0.667,  // Horse-specific
            EMPTY_CART_SPEED_MULTIPLIER: 0.9,
            MOUNTED_TURN_RATE_MULTIPLIER: 0.5,
            REVERSE_SPEED_MULTIPLIER: 0.3,
            REVERSE_ALIGN_SPEED: 0.15
        };

        const ARTILLERY = CONFIG.ARTILLERY_PHYSICS || {
            SPEED_MULTIPLIER: 0.7,
            ROAD_SPEED_MULTIPLIER: 1.4,
            MOUNTED_TURN_RATE_MULTIPLIER: 0.5
        };

        // Calculate slope effect BEFORE processing movement
        const slopeEffect = this.calculateSlopeEffect(entity.position, this.heading);

        // Check if towing a cart or artillery
        const isTowingCart = cartAttachmentState?.isAttached || false;
        const isTowingArtillery = artilleryAttachmentState?.isAttached || false;
        const cart = cartAttachmentState?.attachedCart;
        const artillery = artilleryAttachmentState?.attachedArtillery;
        const hasCrate = crateLoadState?.isLoaded || false;

        // Combined towing state (either cart or artillery)
        const isTowing = isTowingCart || isTowingArtillery;
        const towedEntity = isTowingCart ? cart : (isTowingArtillery ? artillery : null);

        // Calculate base max speed with slope
        let effectiveMaxSpeed = config.maxSpeed * slopeEffect.multiplier;

        // Apply road speed bonus
        if (this.navigationManager?.isOnRoad) {
            if (this.navigationManager.isOnRoad(entity.position.x, entity.position.z)) {
                if (isTowingArtillery) {
                    effectiveMaxSpeed *= ARTILLERY.ROAD_SPEED_MULTIPLIER;
                } else {
                    effectiveMaxSpeed *= CART.ROAD_SPEED_MULTIPLIER;
                }
            }
        }

        // Apply towing speed penalties
        if (isTowingCart) {
            if (hasCrate) {
                // Cart with crate: use mounted multiplier (horse = 1.0 off-road)
                effectiveMaxSpeed *= CART.MOUNTED_LOADED_CART_SPEED_MULTIPLIER;
            } else {
                // Empty cart: 90% speed
                effectiveMaxSpeed *= CART.EMPTY_CART_SPEED_MULTIPLIER;
            }
        } else if (isTowingArtillery) {
            // Artillery: horse = 1.0 off-road
            effectiveMaxSpeed *= ARTILLERY.SPEED_MULTIPLIER;
        }

        // If dead, ignore input - just decelerate to stop
        if (isDead) {
            if (this.velocity > 0) {
                this.velocity = Math.max(0, this.velocity - config.deceleration * deltaTime);
            }
            this.isReversingWithCart = false;
        } else if (isTowing && towedEntity) {
            // === VEHICLE-STYLE MOVEMENT WHEN TOWING (cart or artillery) ===
            const towingConfig = isTowingArtillery ? ARTILLERY : CART;
            const wantsForward = keys.w;
            const wantsReverse = keys.s;
            const wantsLeft = keys.a;
            const wantsRight = keys.d;

            // Turn rate reduced when towing (uses towingConfig from above)
            const effectiveTurnRate = config.baseTurnRate * towingConfig.MOUNTED_TURN_RATE_MULTIPLIER;

            // Horses cannot reverse with cart attached - S key does nothing
            this.isReversingWithCart = false;

            if (wantsForward) {
                // FORWARD MODE: Can turn with A/D
                this.isReversingWithCart = false;

                // Turn rate reduced, and only while moving
                const speedRatio = this.velocity / effectiveMaxSpeed;
                const turnRate = effectiveTurnRate * (1 - speedRatio * 0.5);

                if (wantsLeft) {
                    this.heading += turnRate * deltaTime;
                    isTurning = true;
                }
                if (wantsRight) {
                    this.heading -= turnRate * deltaTime;
                    isTurning = true;
                }

                // Accelerate forward (capped by effective max speed which includes all modifiers)
                this.velocity += config.acceleration * deltaTime;
                this.velocity = Math.min(this.velocity, effectiveMaxSpeed);

            } else {
                // No W or S - decelerate, no turning allowed (prevents spin in place)
                this.isReversingWithCart = false;
                if (this.velocity > 0) {
                    this.velocity = Math.max(0, this.velocity - config.deceleration * deltaTime);
                }
                // A/D ignored when stopped
                isTurning = false;
            }

        } else {
            // === NORMAL HORSE MOVEMENT (not towing) ===
            this.isReversingWithCart = false;

            const wantsForward = keys.w;
            const wantsStop = keys.s;  // S key = slow down / stop (no reverse)
            const wantsLeft = keys.a;
            const wantsRight = keys.d;
            isTurning = wantsLeft || wantsRight;

            // Turn rate: slower when moving fast (100% at rest, 50% at full speed)
            const speedRatio = this.velocity / effectiveMaxSpeed;
            const turnRate = config.baseTurnRate * (1 - speedRatio * 0.5);

            // Apply turning
            if (wantsLeft) this.heading += turnRate * deltaTime;
            if (wantsRight) this.heading -= turnRate * deltaTime;

            // Forward movement
            if (wantsForward) {
                this.velocity += config.acceleration * deltaTime;
                this.velocity = Math.min(this.velocity, effectiveMaxSpeed);
            } else if (wantsStop) {
                // Active braking - faster than passive deceleration
                this.velocity = Math.max(0, this.velocity - config.deceleration * 2 * deltaTime);
            } else {
                // No input - passive deceleration
                if (this.velocity > 0) {
                    this.velocity = Math.max(0, this.velocity - config.deceleration * deltaTime);
                }
            }
        }

        // Ensure velocity never goes negative
        this.velocity = Math.max(0, this.velocity);

        // Calculate movement direction (forward or reverse)
        let moveDirection = 1;  // Forward
        if (this.isReversingWithCart) {
            moveDirection = -1;  // Reverse
        }

        // Calculate desired movement
        const moveX = Math.sin(this.heading) * this.velocity * deltaTime * moveDirection;
        const moveZ = Math.cos(this.heading) * this.velocity * deltaTime * moveDirection;

        // Track frames since mount for grace period
        this.mountFrameCount++;
        const inGracePeriod = this.mountFrameCount <= this.MOUNT_GRACE_FRAMES;

        // === COLLISION DETECTION using physics (same as player walking) ===
        let finalMoveX = moveX;
        let finalMoveZ = moveZ;

        if (physicsManager && entityId && (moveX !== 0 || moveZ !== 0)) {
            const movementVector = { x: moveX, y: 0, z: moveZ };
            const result = physicsManager.computeCharacterMovement(entityId, movementVector);

            // During grace period, use desired movement to escape overlap
            // After grace period, use corrected movement for normal collision
            if (inGracePeriod) {
                // Grace period: ignore collision blocking, use full desired movement
                // This allows horse to move out of overlapping obstacles after mounting
                finalMoveX = moveX;
                finalMoveZ = moveZ;
            } else {
                // Normal: use corrected movement from physics - allows sliding along obstacles
                finalMoveX = result.correctedMovement.x;
                finalMoveZ = result.correctedMovement.z;

                // Only consider "stuck" if corrected movement is nearly zero compared to desired.
                // hasCollision just means "touching something" - Rapier's character controller
                // handles sliding along obstacles via correctedMovement.
                if (result.hasCollision) {
                    const desiredMag = Math.sqrt(moveX * moveX + moveZ * moveZ);
                    const correctedMag = Math.sqrt(finalMoveX * finalMoveX + finalMoveZ * finalMoveZ);
                    const movementRatio = desiredMag > 0.0001 ? correctedMag / desiredMag : 1;

                    if (movementRatio < 0.1) {
                        // Truly blocked - less than 10% of desired movement possible
                        // Don't zero velocity - let it accumulate so rotation to clear path works
                        hitObstacle = true;
                        finalMoveX = 0;
                        finalMoveZ = 0;
                    }
                }
            }
        }

        // Calculate next position
        const nextX = entity.position.x + finalMoveX;
        const nextZ = entity.position.z + finalMoveZ;

        // === WATER BOUNDARY CHECK (same pattern as boat shore detection) ===
        const terrainY = getTerrainHeight(nextX, nextZ);

        if (terrainY < 0 && !hitObstacle) {
            // Hit water - block movement but don't kill velocity
            // This lets velocity accumulate so rotation to clear path works immediately
            hitWater = true;
            // Don't update position - stay where we are
        } else if (!hitObstacle) {
            // Apply movement
            entity.position.x = nextX;
            entity.position.z = nextZ;
            // Update Y to follow terrain
            entity.position.y = terrainY;

            // Update physics body position to match
            if (physicsManager && entityId) {
                physicsManager.updateKinematicPosition(entityId, entity.position);
            }
        }

        entity.rotation.y = this.heading;

        // Check for dismount availability when stopped
        const nowStopped = this.velocity === 0;
        if (!wasStopped && nowStopped) {
            this.checkDisembarkable(entity.position, 'horse');
        }

        // Clear dismount if moving again
        if (!nowStopped) {
            this.canDisembark = false;
            this.disembarkPosition = null;
        }

        // Calculate speed ratio for animation
        const speedRatio = effectiveMaxSpeed > 0 ? this.velocity / effectiveMaxSpeed : 0;

        return {
            moved: this.velocity > 0 || this.isReversingWithCart,
            speedRatio: speedRatio,  // For animation/sound
            hitWater: hitWater,  // Caller can show toast if needed
            hitObstacle: hitObstacle,  // Caller can show toast if needed
            isTurning: isTurning  // For animation when turning in place
        };
    }

    /**
     * Calculate slope-based speed multiplier for horse
     * @param {THREE.Vector3|object} currentPos - Current position {x, y, z}
     * @param {number} heading - Current heading in radians
     * @returns {object} { multiplier: number }
     */
    calculateSlopeEffect(currentPos, heading) {
        const config = ENTITY_CONFIGS.horse;

        // Sample 1 unit ahead in movement direction
        const aheadX = currentPos.x + Math.sin(heading) * 1.0;
        const aheadZ = currentPos.z + Math.cos(heading) * 1.0;

        const currentHeight = getTerrainHeight(currentPos.x, currentPos.z);
        const aheadHeight = getTerrainHeight(aheadX, aheadZ);

        // Calculate slope (rise over 1 unit run)
        const rise = aheadHeight - currentHeight;
        const slopeDegrees = Math.atan(Math.abs(rise)) * (180 / Math.PI);

        // Only penalize uphill movement
        if (rise > 0 && slopeDegrees > 0) {
            if (slopeDegrees >= config.maxWalkableSlope) {
                // Very steep slope (>= 50 deg) - minimum speed (5%)
                // NEVER block - prevents getting stuck
                return { multiplier: config.slopeSpeedMin };  // 0.05 = 5%
            }

            // Moderate slope - linear interpolation: 0 deg = 100%, 50 deg = 5%
            const normalized = slopeDegrees / config.maxWalkableSlope;
            const multiplier = 1.0 - normalized * (1.0 - config.slopeSpeedMin);
            return { multiplier: Math.max(multiplier, config.slopeSpeedMin) };
        }

        // Downhill or flat - full speed
        return { multiplier: 1.0 };
    }
}

/**
 * LandVehicle.js
 * Vehicle class for land-based vehicles (horse)
 *
 * Extends BaseVehicle with land-specific physics:
 * - Forward-only movement (no reverse)
 * - Slope-based speed penalty (uphill slows down)
 * - Road speed bonus
 * - Towing support (cart/artillery with speed/turn modifiers)
 * - Animation support
 */

import { BaseVehicle } from './BaseVehicle.js';
import { getTerrainHeight } from '../core/TerrainAccess.js';
import { CONFIG } from '../config.js';

export class LandVehicle extends BaseVehicle {
    constructor(type, config) {
        super(type, config);

        // Animation state
        this.animationMixer = null;
        this.walkAction = null;

        // Land-specific config
        this.maxWalkableSlope = config.maxWalkableSlope ?? 50;
        this.slopeSpeedMin = config.slopeSpeedMin ?? 0.05;

        // Navigation manager reference (for road detection)
        this.navigationManager = null;
    }

    // === ABSTRACT METHOD IMPLEMENTATIONS ===

    /**
     * @returns {'land'}
     */
    getTerrainConstraint() {
        return 'land';
    }

    /**
     * Create character controller for horse collision
     * @param {PhysicsManager} physicsManager
     * @returns {string} Controller ID
     */
    createCharacterController(physicsManager) {
        if (!this.mesh || !physicsManager) return null;

        // Create radius-based controller for horse
        const radius = this.config.collisionRadius ?? 0.15;
        const height = this.config.collisionHeight ?? 2.0;

        this.characterController = physicsManager.createHorseController(
            this.mesh.position,
            radius,
            height
        );

        return this.characterController;
    }

    /**
     * Update horse movement based on input
     * @param {object} keys - Input state { w, s, a, d }
     * @param {number} deltaTime - Time since last frame (ms)
     * @param {TerrainGenerator} terrainGenerator - For height queries (unused, uses getTerrainHeight)
     * @param {PhysicsManager} physicsManager - For collision detection
     * @param {object} options - Additional options { isDead, towedEntity, cargo }
     * @returns {object} { moved, speedRatio, hitWater, hitObstacle, isTurning }
     */
    updateMovement(keys, deltaTime, terrainGenerator, physicsManager, options = {}) {
        const { isDead = false, towedEntity = null, cargo = null } = options;
        const config = this.config;

        const wasStopped = this.velocity === 0;
        let hitWater = false;
        let hitObstacle = false;
        let isTurning = false;

        // Calculate slope effect BEFORE processing movement
        const slopeEffect = this.calculateSlopeEffect();

        // Check towing state
        const isTowing = towedEntity?.isAttached || false;
        const isTowingCart = isTowing && towedEntity?.type === 'cart';
        const isTowingArtillery = isTowing && towedEntity?.type === 'artillery';
        const hasCrate = cargo?.hasItems() || false;

        // Get towed entity configs from CONFIG.TOWED_ENTITIES
        const cartConfig = CONFIG.TOWED_ENTITIES?.cart || {};
        const artilleryConfig = CONFIG.TOWED_ENTITIES?.artillery || {};
        const sharedConfig = CONFIG.TOWED_ENTITIES?.SHARED || {};

        // Calculate base max speed with slope
        let effectiveMaxSpeed = config.maxSpeed * slopeEffect.multiplier;

        // Apply road speed bonus
        if (this.navigationManager?.isOnRoad) {
            if (this.navigationManager.isOnRoad(this.mesh.position.x, this.mesh.position.z)) {
                effectiveMaxSpeed *= sharedConfig.ROAD_SPEED_MULTIPLIER ?? 1.5;
            }
        }

        // Apply towing speed penalties
        if (isTowingCart) {
            if (hasCrate) {
                // Cart with crate: reduced speed
                effectiveMaxSpeed *= cartConfig.MOUNTED_LOADED_SPEED_MULTIPLIER ?? 0.667;
            } else {
                // Empty cart: 90% speed
                effectiveMaxSpeed *= cartConfig.EMPTY_SPEED_MULTIPLIER ?? 0.9;
            }
        } else if (isTowingArtillery) {
            // Artillery: use artillery multiplier
            effectiveMaxSpeed *= artilleryConfig.SPEED_MULTIPLIER ?? 1.0;
        }

        // If dead, ignore input - just decelerate to stop
        if (isDead) {
            if (this.velocity > 0) {
                this.velocity = Math.max(0, this.velocity - config.deceleration * deltaTime);
            }
        } else if (isTowing && towedEntity?.mesh) {
            // VEHICLE-STYLE MOVEMENT WHEN TOWING
            const towingConfig = isTowingArtillery ? artilleryConfig : cartConfig;
            const turnRateMultiplier = towingConfig.TURN_RATE_MULTIPLIER ?? 0.6;

            const wantsForward = keys.w;
            const wantsLeft = keys.a;
            const wantsRight = keys.d;

            // Turn rate reduced when towing
            const effectiveTurnRate = config.baseTurnRate * turnRateMultiplier;

            if (wantsForward) {
                // FORWARD MODE: Can turn with A/D
                const speedRatio = effectiveMaxSpeed > 0 ? this.velocity / effectiveMaxSpeed : 0;
                const turnRate = effectiveTurnRate * (1 - speedRatio * 0.5);

                if (wantsLeft) {
                    this.heading += turnRate * deltaTime;
                    isTurning = true;
                }
                if (wantsRight) {
                    this.heading -= turnRate * deltaTime;
                    isTurning = true;
                }

                // Accelerate forward
                this.velocity += config.acceleration * deltaTime;
                this.velocity = Math.min(this.velocity, effectiveMaxSpeed);
            } else {
                // No W - decelerate, no turning allowed (prevents spin in place)
                if (this.velocity > 0) {
                    this.velocity = Math.max(0, this.velocity - config.deceleration * deltaTime);
                }
            }
        } else {
            // NORMAL HORSE MOVEMENT (not towing)
            const wantsForward = keys.w;
            const wantsStop = keys.s;  // S key = slow down / stop (no reverse)
            const wantsLeft = keys.a;
            const wantsRight = keys.d;
            isTurning = wantsLeft || wantsRight;

            // Turn rate: slower when moving fast (100% at rest, 50% at full speed)
            const speedRatio = effectiveMaxSpeed > 0 ? this.velocity / effectiveMaxSpeed : 0;
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

        // Calculate desired movement (always forward)
        const moveX = Math.sin(this.heading) * this.velocity * deltaTime;
        const moveZ = Math.cos(this.heading) * this.velocity * deltaTime;

        // Collision detection using physics
        let finalMoveX = moveX;
        let finalMoveZ = moveZ;

        if (physicsManager && this.characterController && (moveX !== 0 || moveZ !== 0)) {
            const movementVector = { x: moveX, y: 0, z: moveZ };
            const result = physicsManager.computeCharacterMovement(this.characterController, movementVector);

            // Use corrected movement from physics - allows sliding along obstacles
            finalMoveX = result.correctedMovement.x;
            finalMoveZ = result.correctedMovement.z;

            // Only consider "stuck" if corrected movement is nearly zero
            if (result.hasCollision) {
                const desiredMag = Math.sqrt(moveX * moveX + moveZ * moveZ);
                const correctedMag = Math.sqrt(finalMoveX * finalMoveX + finalMoveZ * finalMoveZ);
                const movementRatio = desiredMag > 0.0001 ? correctedMag / desiredMag : 1;

                if (movementRatio < 0.1) {
                    // Truly blocked - less than 10% of desired movement possible
                    hitObstacle = true;
                    finalMoveX = 0;
                    finalMoveZ = 0;
                }
            }
        }

        // Calculate next position
        const nextX = this.mesh.position.x + finalMoveX;
        const nextZ = this.mesh.position.z + finalMoveZ;

        // Water boundary check (terrain includes docks via leveled areas)
        const terrainY = getTerrainHeight(nextX, nextZ);

        if (terrainY < 0 && !hitObstacle) {
            // Hit water - block movement but don't kill velocity
            // This lets velocity accumulate so rotation to clear path works immediately
            hitWater = true;
        } else if (!hitObstacle) {
            // Apply movement
            this.mesh.position.x = nextX;
            this.mesh.position.z = nextZ;
            this.mesh.position.y = terrainY;

            // Update physics body position to match
            if (physicsManager && this.characterController) {
                physicsManager.updateKinematicPosition(this.characterController, this.mesh.position);
            }
        }

        // Update rotation
        this.mesh.rotation.y = this.heading;

        // Update physics collider rotation
        if (physicsManager && this.characterController) {
            physicsManager.updateKinematicRotation(this.characterController, this.heading);
        }

        // Check for dismount availability when stopped
        const nowStopped = this.velocity === 0;
        if (!wasStopped && nowStopped) {
            this.checkDisembarkable();
        }

        // Clear dismount if moving again
        if (!nowStopped) {
            this.canDisembark = false;
            this.disembarkPosition = null;
        }

        // Calculate speed ratio for animation
        const speedRatio = effectiveMaxSpeed > 0 ? this.velocity / effectiveMaxSpeed : 0;

        return {
            moved: this.velocity > 0,
            speedRatio: speedRatio,  // For animation/sound
            hitWater: hitWater,
            hitObstacle: hitObstacle,
            isTurning: isTurning
        };
    }

    // === LAND-SPECIFIC METHODS ===

    /**
     * Calculate slope-based speed multiplier
     * @returns {object} { multiplier: number }
     */
    calculateSlopeEffect() {
        if (!this.mesh) return { multiplier: 1.0 };

        const currentPos = this.mesh.position;

        // Sample 1 unit ahead in movement direction
        const aheadX = currentPos.x + Math.sin(this.heading) * 1.0;
        const aheadZ = currentPos.z + Math.cos(this.heading) * 1.0;

        const currentHeight = getTerrainHeight(currentPos.x, currentPos.z);
        const aheadHeight = getTerrainHeight(aheadX, aheadZ);

        // Calculate slope (rise over 1 unit run)
        const rise = aheadHeight - currentHeight;
        const slopeDegrees = Math.atan(Math.abs(rise)) * (180 / Math.PI);

        // Only penalize uphill movement
        if (rise > 0 && slopeDegrees > 0) {
            if (slopeDegrees >= this.maxWalkableSlope) {
                // Very steep slope (>= 50 deg) - minimum speed (5%)
                // NEVER block - prevents getting stuck
                return { multiplier: this.slopeSpeedMin };
            }

            // Moderate slope - linear interpolation: 0 deg = 100%, 50 deg = 5%
            const normalized = slopeDegrees / this.maxWalkableSlope;
            const multiplier = 1.0 - normalized * (1.0 - this.slopeSpeedMin);
            return { multiplier: Math.max(multiplier, this.slopeSpeedMin) };
        }

        // Downhill or flat - full speed
        return { multiplier: 1.0 };
    }

    /**
     * Set up animations from GLTF
     * @param {THREE.AnimationMixer} mixer - Animation mixer
     * @param {THREE.AnimationClip[]} clips - Available animation clips
     */
    setupAnimations(mixer, clips) {
        this.animationMixer = mixer;

        if (!clips || clips.length === 0) return;

        // Find walk animation by name patterns
        const patterns = this.config.animationFallbackPatterns || ['walk', 'run', 'gallop', 'trot'];
        let walkClip = null;

        for (const pattern of patterns) {
            walkClip = clips.find(c => c.name.toLowerCase().includes(pattern));
            if (walkClip) break;
        }

        // Use first clip as fallback
        if (!walkClip && clips.length > 0) {
            walkClip = clips[0];
        }

        if (walkClip) {
            this.walkAction = mixer.clipAction(walkClip);
            this.walkAction.play();
            this.walkAction.setEffectiveTimeScale(0); // Start paused
        }
    }

    /**
     * Update animation based on movement
     * @param {number} deltaTime - Time since last frame (ms)
     * @param {number} speedRatio - Current speed as fraction of max (0-1)
     * @param {boolean} isTurning - Whether turning in place
     */
    updateAnimation(deltaTime, speedRatio, isTurning) {
        if (!this.animationMixer) return;

        // Update mixer
        this.animationMixer.update(deltaTime / 1000);

        if (!this.walkAction) return;

        const config = this.config;
        const baseSpeed = config.baseAnimationSpeed ?? 2.0;
        const minSpeed = config.minAnimationSpeed ?? 0.6;
        const turningSpeed = config.turningAnimationSpeed ?? 1.0;

        if (speedRatio > 0.01 || isTurning) {
            // Moving or turning - play animation if not already running
            if (!this.walkAction.isRunning()) {
                this.walkAction.play();
            }

            if (speedRatio > 0.01) {
                // Moving - scale animation with speed
                const animSpeed = baseSpeed * Math.max(speedRatio, minSpeed);
                this.walkAction.setEffectiveTimeScale(animSpeed);
            } else {
                // Turning in place - slow walk animation
                this.walkAction.setEffectiveTimeScale(turningSpeed);
            }
        } else {
            // Stopped - stop animation
            if (this.walkAction.isRunning()) {
                this.walkAction.stop();
            }
        }
    }

    /**
     * Set navigation manager for road detection
     * @param {NavigationManager} navigationManager
     */
    setNavigationManager(navigationManager) {
        this.navigationManager = navigationManager;
    }

    /**
     * Board this land vehicle
     * @override
     */
    board(mesh, id, chunkKey, quality, lastRepairTime, owner) {
        super.board(mesh, id, chunkKey, quality, lastRepairTime, owner);

        // Animation will be set up separately via setupAnimations()
    }

    /**
     * @override
     */
    disembark() {
        super.disembark();

        // Stop animation
        if (this.walkAction) {
            this.walkAction.setEffectiveTimeScale(0);
        }
    }

    /**
     * @override
     */
    cleanup() {
        super.cleanup();

        // Clean up animation
        this.animationMixer = null;
        this.walkAction = null;
        this.navigationManager = null;
    }
}

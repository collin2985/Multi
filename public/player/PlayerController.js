/**
 * PlayerController.js
 * Manages player movement, position, rotation, and basic state
 */

import * as THREE from 'three';
import { ui } from '../ui.js';
import { CONFIG } from '../config.js';

export class PlayerController {
    constructor(playerObject, terrainGenerator, physicsManager = null, navigationManager = null, game = null) {
        this.playerObject = playerObject;
        this.terrainGenerator = terrainGenerator;
        this.physicsManager = physicsManager;
        this.navigationManager = navigationManager;
        this.game = game; // Reference to game instance for canWalkTo()

        // Movement state
        this.isMoving = false;
        this.targetPosition = new THREE.Vector3();
        this._baseSpeed = 0.000625; // Fallback: 0.625 units/sec in units/ms (matches AvatarManager)
        this.stopThreshold = 0.01; // Precise arrival threshold

        // Safe position tracking for water reversal (reused Vector3, no allocations)
        this.lastSafePosition = new THREE.Vector3(
            playerObject.position.x,
            playerObject.position.y,
            playerObject.position.z
        );

        // Water reversal lockout (prevents spam clicking to override)
        this.waterReversalLockout = false;
        this.waterReversalLockoutTime = 0;
        this.WATER_LOCKOUT_DURATION = 500; // ms

        // Path blocked toast cooldown (prevents spam)
        this.lastPathBlockedToast = 0;
        this.PATH_BLOCKED_COOLDOWN = 2000; // ms

        // Directional slope speed modifier
        this.cachedSpeedMultiplier = 1.0;
        this.lastSpeedUpdateTime = 0;
        this.SPEED_UPDATE_INTERVAL = 250; // Recalculate slope/road speed every 250ms

        // Raycaster for terrain height detection
        this.playerRaycaster = new THREE.Raycaster();
        this.targetY = playerObject.position.y; // Cached terrain Y position for smooth interpolation
        this.RAYCAST_UPDATE_INTERVAL = 20; // Update Y position every 20 frames (3 times per second at 60 FPS)
        this.frameCounter = 0;

        // Callbacks
        this.onArriveCallback = null;
        this.onBlockedCallback = null;
        this.onWaterReversalCallback = null;
        this.onSpeedChangedCallback = null; // Called when speed multiplier changes (for P2P sync)

        // WASD movement state
        this.wasdDirection = new THREE.Vector3();
        this.isWASDMoving = false;

        // Vehicle state references (set by Game class)
        this.gameState = null;  // Reference to gameState for vehicleState access
        this.inputManager = null;  // Reference to inputManager for auto-run
        this.isReversingWithCart = false; // Track reverse mode state

        // Cart towing velocity-based movement (mirrors horse physics but at half speed)
        this.towingVelocity = 0;          // Current velocity when towing
        this.towingHeading = 0;           // Current heading when towing (radians)

        // Player towing speed config (half of horse speed: 0.0015 / 2 = 0.00075)
        this.PLAYER_TOWING_CONFIG = {
            maxSpeed: 0.00075,                    // Half of horse (0.75 units/sec)
            acceleration: 0.00075 / 2000,         // 2 seconds to full speed
            deceleration: 0.00075 / 1000,         // 1 second to stop
            baseTurnRate: (Math.PI * 2) / 6000,   // Slower turn rate than horse (6 sec for 360)
        };
    }

    /**
     * Set physics manager reference for collision detection
     * @param {PhysicsManager} physicsManager
     */
    setPhysicsManager(physicsManager) {
        this.physicsManager = physicsManager;
    }

    /**
     * Set input manager reference for auto-run state
     * @param {InputManager} inputManager
     */
    setInputManager(inputManager) {
        this.inputManager = inputManager;
    }

    /**
     * Set callback for when player arrives at destination
     * @param {function} callback
     */
    setOnArriveCallback(callback) {
        this.onArriveCallback = callback;
    }

    /**
     * Set callback for when player is blocked by structure
     * @param {function} callback - Called with (position)
     */
    setOnBlockedCallback(callback) {
        this.onBlockedCallback = callback;
    }

    /**
     * Set callback for when player is reversed due to water
     * @param {function} callback - Called with (position)
     */
    setOnWaterReversalCallback(callback) {
        this.onWaterReversalCallback = callback;
    }

    /**
     * Set callback for when speed multiplier changes (for P2P sync)
     * @param {function} callback - Called with (speedMultiplier)
     */
    setOnSpeedChangedCallback(callback) {
        this.onSpeedChangedCallback = callback;
    }

    /**
     * Calculate directional slope speed multiplier
     * Samples height 1 unit ahead in movement direction
     * Uses absolute slope (uphill and downhill both slow you down)
     *
     * @param {THREE.Vector3} fromPos - Current position
     * @param {THREE.Vector3} toPos - Target position
     * @returns {number} Speed multiplier (0.10 to 1.0)
     */
    calculateDirectionalSlopeSpeed(fromPos, toPos) {
        if (!this.terrainGenerator) return 1.0;

        // Calculate direction to target
        const dx = toPos.x - fromPos.x;
        const dz = toPos.z - fromPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < 0.01) return this.cachedSpeedMultiplier; // Keep current speed when near target

        // Normalize direction
        const dirX = dx / dist;
        const dirZ = dz / dist;

        // Get height at current position and 1 unit ahead
        const currentHeight = this.terrainGenerator.getWorldHeight(fromPos.x, fromPos.z);
        const aheadHeight = this.terrainGenerator.getWorldHeight(
            fromPos.x + dirX,
            fromPos.z + dirZ
        );

        // Calculate slope (rise over run = height diff over 1 unit)
        const slope = Math.abs(aheadHeight - currentHeight);

        // Convert to degrees: atan(slope) * (180/PI)
        const slopeDegrees = Math.atan(slope) * 57.2957795;

        // Same formula as NavigationMap.getSlopeSpeedMultiplier:
        // Linear interpolation from 1.0 at 0° to 0.10 at 45°+
        const MAX_WALKABLE_SLOPE = 45;
        const MIN_SPEED_MULTIPLIER = 0.10;
        const normalized = Math.min(slopeDegrees / MAX_WALKABLE_SLOPE, 1.0);
        const speedMultiplier = 1.0 - normalized * (1.0 - MIN_SPEED_MULTIPLIER);

        return Math.max(speedMultiplier, MIN_SPEED_MULTIPLIER);
    }

    /**
     * Update speed multiplier and notify if changed
     * Combines directional slope speed with road bonus from navigation system
     * @private
     */
    _updateSpeedMultiplier() {
        // Get slope-based speed (directional, more precise for current movement)
        let newSpeed = this.calculateDirectionalSlopeSpeed(
            this.playerObject.position,
            this.targetPosition
        );

        // Apply road bonus from navigation system (1.5x on roads)
        if (this.navigationManager?.isOnRoad) {
            const pos = this.playerObject.position;
            if (this.navigationManager.isOnRoad(pos.x, pos.z)) {
                newSpeed *= 1.5;
                window.tasksPanel?.onRoadWalked();
            }
        }

        // Apply cart towing speed penalty
        const towedEntity = this.gameState?.towedEntity;
        if (towedEntity?.isAttached && towedEntity?.type === 'cart') {
            const hasLoadedCargo = this.gameState?.cargo?.hasItems() || false;
            newSpeed *= towedEntity.getSpeedMultiplier(hasLoadedCargo, false);  // false = on foot
        }

        // Only notify if speed changed significantly (>5% difference)
        if (Math.abs(newSpeed - this.cachedSpeedMultiplier) > 0.05) {
            this.cachedSpeedMultiplier = newSpeed;
            if (this.onSpeedChangedCallback) {
                this.onSpeedChangedCallback(newSpeed);
            }
        } else {
            this.cachedSpeedMultiplier = newSpeed;
        }

        this.lastSpeedUpdateTime = performance.now();
    }

    /**
     * Set target position for player to move to
     * @param {THREE.Vector3} position
     */
    setTargetPosition(position) {
        // Block movement while manning artillery
        if (this.gameState?.mannedArtillery?.manningState?.isManning) {
            return;
        }

        // Block new movement commands during water reversal lockout
        if (this.waterReversalLockout) {
            const elapsed = performance.now() - this.waterReversalLockoutTime;
            if (elapsed < this.WATER_LOCKOUT_DURATION) {
                return; // Still locked out
            }
            this.waterReversalLockout = false;
        }

        this.targetPosition.copy(position);
        this.isMoving = true;

        // Calculate directional slope speed on click
        this._updateSpeedMultiplier();
    }

    /**
     * Get current speed multiplier (for P2P sync)
     * @returns {number}
     */
    getSpeedMultiplier() {
        return this.cachedSpeedMultiplier;
    }

    /**
     * Stop player movement
     */
    stopMovement() {
        this.isMoving = false;
        this.isWASDMoving = false;
        // Keep current height - no adjustment needed
    }

    /**
     * Update player movement with full collision detection and callbacks
     * @param {number} deltaTime - Time since last frame
     * @param {boolean} isDead - Whether player is dead
     * @returns {boolean} - Whether player is currently moving
     */
    updateMovement(deltaTime, isDead = false) {
        const { position } = this.playerObject;

        // Don't move if player is dead
        if (isDead) {
            this.isMoving = false;
            // Keep current height when dying - no adjustment needed
            return false;
        }

        // Skip if towing a cart - movement is handled by _updateVehicleStyleMovement()
        // This prevents the click-to-move system from fighting with vehicle-style cart movement
        if (this.gameState?.towedEntity?.isAttached) {
            return this.isMoving;
        }

        // Skip movement logic when on a vehicle (boats/ships/horses handle their own positioning)
        // This prevents false "Cannot enter water" warnings for ship gunners
        if (this.gameState?.vehicleState?.isActive()) {
            return this.isMoving;
        }

        // If not moving, check if terrain changed beneath us
        if (!this.isMoving) {
            // Performance-friendly: Only update height if terrain was actually modified
            if (this.playerObject.userData.terrainChanged) {
                this.playerObject.userData.terrainChanged = false;

                // One-time height adjustment after terrain change
                if (this.terrainGenerator) {
                    const terrainHeight = this.terrainGenerator.getWorldHeight(position.x, position.z);
                    position.y = terrainHeight + 0.03;
                    this.targetY = position.y;
                }

                // Update physics position if needed
                if (this.physicsManager?.updateKinematicPosition) {
                    this.physicsManager.updateKinematicPosition(
                        this.playerObject.userData.objectId || 'player',
                        position
                    );
                }
            }
            return false;
        }

        // Calculate 2D distance (X, Z only) since Y follows terrain
        const dx = position.x - this.targetPosition.x;
        const dz = position.z - this.targetPosition.z;
        const distanceSquared = dx * dx + dz * dz;  // PERFORMANCE: No Math.sqrt() needed for comparison
        const stopThresholdSquared = this.stopThreshold * this.stopThreshold;

        if (distanceSquared <= stopThresholdSquared) {
            // Arrived at target
            position.x = this.targetPosition.x;
            position.z = this.targetPosition.z;
            // Y position already handled by per-frame interpolation - no adjustment needed

            this.isMoving = false;

            ui.updateStatus("✅ Arrived at destination.");

            // Trigger arrival callback
            if (this.onArriveCallback) {
                this.onArriveCallback();
            }

            return false;
        } else {
            // Continue moving
            this.frameCounter++;

            // Update directional slope speed every 1 second
            const now = performance.now();
            if (now - this.lastSpeedUpdateTime >= this.SPEED_UPDATE_INTERVAL) {
                this._updateSpeedMultiplier();
            }

            // Apply slope speed modifier to base speed
            const baseSpeed = (CONFIG.PLAYER?.MOVE_SPEED / 1000) || this._baseSpeed;
            const actualSpeed = baseSpeed * this.cachedSpeedMultiplier;
            const moveStep = actualSpeed * deltaTime;
            // Only calculate actual distance when needed for lerp alpha calculation
            const distance = Math.sqrt(distanceSquared);
            const alpha = Math.min(1, moveStep / distance);

            // Calculate desired next position
            const nextPosition = position.clone();
            nextPosition.lerp(this.targetPosition, alpha);

            // === PHYSICS: Apply movement with collision detection ===
            if (this.physicsManager && this.physicsManager.initialized) {
                const movementVector = new THREE.Vector3().subVectors(nextPosition, position);
                const result = this.physicsManager.computeCharacterMovement(
                    this.playerObject.userData.objectId || 'player',
                    movementVector
                );

                if (result.hasCollision) {
                    // Hit an obstacle - STOP
                    this.isMoving = false;
                    this.isWASDMoving = false;
                    this.inputManager?.cancelAutoRun();
                    if (this.onBlockedCallback) {
                        this.onBlockedCallback(position.clone());
                    }
                    return false;
                }

                // Apply movement
                position.add(result.correctedMovement);
            } else {
                // Fallback: no physics
                position.copy(nextPosition);
            }

            // === TERRAIN HEIGHT CHECK (terrain is now raised at dock locations) ===
            const terrainHeight = this.terrainGenerator?.getWorldHeight(position.x, position.z) ?? 0;

            if (terrainHeight < CONFIG.WATER.MIN_WALKABLE_HEIGHT) {
                // Water! Return to last safe position
                this.targetPosition.copy(this.lastSafePosition);
                ui.showToast('Cannot enter water', 'warning');

                // Lockout to prevent spam clicking
                this.waterReversalLockout = true;
                this.waterReversalLockoutTime = performance.now();
                this.isWASDMoving = false;
                this.inputManager?.cancelAutoRun();

                // Broadcast water reversal (new target)
                if (this.onWaterReversalCallback) {
                    this.onWaterReversalCallback(this.lastSafePosition.clone());
                }
                return true;
            }

            // Skip terrain Y updates when on a vehicle (boats/ships/horses handle their own Y positioning)
            const isOnVehicle = this.gameState?.vehicleState?.isActive();
            if (!isOnVehicle) {
                // Update terrain Y (every N frames for performance)
                if (this.frameCounter % this.RAYCAST_UPDATE_INTERVAL === 0) {
                    this.targetY = terrainHeight + 0.03;
                    // Save safe position
                    this.lastSafePosition.set(position.x, position.y, position.z);
                }

                // Lerp to target Y every frame for smooth transitions
                if (this.targetY !== undefined) {
                    position.y = THREE.MathUtils.lerp(position.y, this.targetY, 0.2);
                }
            }

            // Update physics position after Y adjustment
            if (this.physicsManager?.updateKinematicPosition) {
                this.physicsManager.updateKinematicPosition(
                    this.playerObject.userData.objectId,
                    position
                );
            }

            // Rotate player to face movement direction (smooth turn)
            const direction = new THREE.Vector3();
            direction.subVectors(this.targetPosition, position).normalize();
            if (direction.length() > 0) {
                const targetRotation = Math.atan2(direction.x, direction.z);
                const currentRotation = this.playerObject.rotation.y;

                // Smoothly interpolate rotation
                let rotationDiff = targetRotation - currentRotation;
                while (rotationDiff > Math.PI) rotationDiff -= Math.PI * 2;
                while (rotationDiff < -Math.PI) rotationDiff += Math.PI * 2;

                const rotationSpeed = 0.15;
                this.playerObject.rotation.y += rotationDiff * rotationSpeed;
            }

            return true;
        }
    }

    /**
     * Update player movement (legacy simple method)
     * @param {number} deltaTime - Time since last frame
     * @returns {boolean} - Whether player is currently moving
     */
    update(deltaTime) {
        return this.updateMovement(deltaTime, false);
    }

    /**
     * Update player's vertical position based on terrain
     * @private
     */
    updateVerticalPosition(position) {
        // Update to terrain height
        if (this.terrainGenerator) {
            const terrainHeight = this.terrainGenerator.getWorldHeight(position.x, position.z);
            const targetY = terrainHeight + 0.03;
            position.y = THREE.MathUtils.lerp(position.y, targetY, 0.2);
        }
    }

    /**
     * Get current player position
     * @returns {THREE.Vector3}
     */
    getPosition() {
        return this.playerObject.position;
    }

    /**
     * Get current movement state
     * @returns {boolean}
     */
    getIsMoving() {
        return this.isMoving;
    }

    /**
     * Get target position
     * @returns {THREE.Vector3}
     */
    getTargetPosition() {
        return this.targetPosition;
    }

    /**
     * Vehicle-style movement when towing a cart (velocity-based, like horse)
     * Uses physics-based velocity system for smooth, natural movement
     * Speed is HALF of horse towing speed
     *
     * @param {object} keys - { w, a, s, d }
     * @param {number} deltaTime - Frame delta in ms
     * @returns {object} { isMoving, speedRatio, isTurning }
     * @private
     */
    _updateVehicleStyleMovement(keys, deltaTime) {
        const CART = CONFIG.CART_PHYSICS || {
            LOADED_CART_SPEED_MULTIPLIER: 0.5,
            EMPTY_CART_SPEED_MULTIPLIER: 0.9,
            ROAD_SPEED_MULTIPLIER: 1.5,  // 50% faster on roads
            REVERSE_SPEED_MULTIPLIER: 0.3,
            REVERSE_ALIGN_SPEED: 0.15,
            TOWING_TURN_RATE_MULTIPLIER: 0.25
        };

        const config = this.PLAYER_TOWING_CONFIG;
        const cart = this.gameState?.vehicleState?.towedEntity?.mesh;
        const hasCrate = this.gameState?.vehicleState?.shipCrates?.length > 0 || false;
        let isTurning = false;

        if (!cart) {
            this.isReversingWithCart = false;
            this.towingVelocity = 0;
            return { isMoving: false, speedRatio: 0, isTurning: false };
        }

        // Initialize heading from player rotation on first frame
        if (this.towingHeading === 0 && this.playerObject.rotation.y !== 0) {
            this.towingHeading = this.playerObject.rotation.y;
        }

        const wantsForward = keys.w;
        const wantsReverse = keys.s;
        const wantsLeft = keys.a;
        const wantsRight = keys.d;

        // Calculate effective max speed with all modifiers
        let effectiveMaxSpeed = config.maxSpeed;

        // Apply road speed bonus
        if (this.navigationManager?.isOnRoad) {
            const pos = this.playerObject.position;
            if (this.navigationManager.isOnRoad(pos.x, pos.z)) {
                effectiveMaxSpeed *= CART.ROAD_SPEED_MULTIPLIER;
                window.tasksPanel?.onRoadWalked();
            }
        }

        // Apply cart/crate speed penalties
        if (hasCrate) {
            effectiveMaxSpeed *= CART.LOADED_CART_SPEED_MULTIPLIER;
        } else {
            effectiveMaxSpeed *= CART.EMPTY_CART_SPEED_MULTIPLIER;
        }

        // === MOVEMENT LOGIC (mirrors horse towing) ===

        if (wantsReverse && !wantsForward) {
            // REVERSE MODE: Align with cart and back up straight
            this.isReversingWithCart = true;

            const cartHeading = cart.rotation.y;

            // Lerp player heading toward cart heading
            let headingDiff = cartHeading - this.towingHeading;
            while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
            while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;
            this.towingHeading += headingDiff * CART.REVERSE_ALIGN_SPEED;

            // Accelerate backward (at reduced reverse speed)
            const reverseMaxSpeed = effectiveMaxSpeed * CART.REVERSE_SPEED_MULTIPLIER;
            this.towingVelocity += config.acceleration * deltaTime;
            this.towingVelocity = Math.min(this.towingVelocity, reverseMaxSpeed);

            // No turning in reverse
            isTurning = false;

        } else if (wantsForward) {
            // FORWARD MODE: Can turn with A/D
            this.isReversingWithCart = false;

            // Turn rate reduced when towing, and scales with speed
            const effectiveTurnRate = config.baseTurnRate * CART.TOWING_TURN_RATE_MULTIPLIER;
            const speedRatio = effectiveMaxSpeed > 0 ? this.towingVelocity / effectiveMaxSpeed : 0;
            const turnRate = effectiveTurnRate * (1 - speedRatio * 0.5);

            if (wantsLeft) {
                this.towingHeading += turnRate * deltaTime;
                isTurning = true;
            }
            if (wantsRight) {
                this.towingHeading -= turnRate * deltaTime;
                isTurning = true;
            }

            // Accelerate forward
            this.towingVelocity += config.acceleration * deltaTime;
            this.towingVelocity = Math.min(this.towingVelocity, effectiveMaxSpeed);

        } else {
            // NO INPUT: Decelerate to stop, no turning allowed
            this.isReversingWithCart = false;
            if (this.towingVelocity > 0) {
                this.towingVelocity = Math.max(0, this.towingVelocity - config.deceleration * deltaTime);
            }
            isTurning = false;
        }

        // Ensure velocity never goes negative
        this.towingVelocity = Math.max(0, this.towingVelocity);

        // === APPLY MOVEMENT ===

        if (this.towingVelocity > 0) {
            // Calculate movement direction
            const moveDirection = this.isReversingWithCart ? -1 : 1;
            let moveX = Math.sin(this.towingHeading) * this.towingVelocity * deltaTime * moveDirection;
            let moveZ = Math.cos(this.towingHeading) * this.towingVelocity * deltaTime * moveDirection;

            // Apply physics collision detection
            if (this.physicsManager) {
                const movementVector = { x: moveX, y: 0, z: moveZ };
                const result = this.physicsManager.computeCharacterMovement(
                    this.playerObject.userData.objectId || 'player',
                    movementVector
                );

                if (result && result.hasCollision) {
                    // Hit obstacle - stop
                    this.towingVelocity = 0;
                    moveX = 0;
                    moveZ = 0;
                } else if (result && result.correctedMovement) {
                    moveX = result.correctedMovement.x;
                    moveZ = result.correctedMovement.z;
                }
            }

            // Calculate next position
            const nextX = this.playerObject.position.x + moveX;
            const nextZ = this.playerObject.position.z + moveZ;

            // Water boundary check
            const terrainY = this.terrainGenerator?.getWorldHeight(nextX, nextZ) ?? 0;
            const waterLevel = CONFIG.WATER?.LEVEL ?? 0;

            if (terrainY < waterLevel) {
                // Hit water - stop
                this.towingVelocity = 0;
            } else {
                // Apply position
                this.playerObject.position.x = nextX;
                this.playerObject.position.z = nextZ;
                this.playerObject.position.y = terrainY + 0.03;

                // Update physics body
                if (this.physicsManager) {
                    this.physicsManager.updateKinematicPosition(this.playerObject.userData.objectId || 'player', this.playerObject.position);
                }
            }

            // Update player rotation to match heading
            this.playerObject.rotation.y = this.towingHeading;

            // Store direction for other systems
            this.wasdDirection.set(Math.sin(this.towingHeading), 0, Math.cos(this.towingHeading));
        }

        // Update cached speed multiplier for animation sync
        this.cachedSpeedMultiplier = config.maxSpeed > 0
            ? this.towingVelocity / config.maxSpeed
            : 0;

        const isMoving = this.towingVelocity > 0;
        this.isMoving = isMoving;
        this.isWASDMoving = isMoving;

        return {
            isMoving,
            speedRatio: this.cachedSpeedMultiplier,
            isTurning
        };
    }

    /**
     * Update movement from WASD input (continuous movement)
     * @param {object} keys - { w: bool, a: bool, s: bool, d: bool }
     * @param {number} cameraRotation - Camera Y rotation in radians
     * @param {number} deltaTime - Frame delta in ms
     * @returns {boolean} Whether player is moving via WASD
     */
    updateWASDMovement(keys, cameraRotation, deltaTime) {
        // Block movement while manning artillery
        if (this.gameState?.mannedArtillery?.manningState?.isManning) {
            return false;
        }

        // Block during water reversal lockout
        if (this.waterReversalLockout) {
            const elapsed = performance.now() - this.waterReversalLockoutTime;
            if (elapsed < this.WATER_LOCKOUT_DURATION) {
                return false;
            }
            this.waterReversalLockout = false;
        }

        // Check if towing a cart - use vehicle-style movement
        const isTowing = this.gameState?.towedEntity?.isAttached || false;

        if (isTowing) {
            const result = this._updateVehicleStyleMovement(keys, deltaTime);
            // Return true if moving OR turning (for animation purposes)
            return result.isMoving || result.isTurning;
        }

        // --- NORMAL WASD MOVEMENT (not towing) ---

        // Calculate movement direction from keys
        let dirX = 0;
        let dirZ = 0;

        // Check for auto-run (double-tap W) or regular W key
        const wantForward = keys.w || this.inputManager?.autoRun;
        if (wantForward) dirZ -= 1;  // Forward (into screen)
        if (keys.s) dirZ += 1;  // Backward
        if (keys.a) dirX -= 1;  // Left
        if (keys.d) dirX += 1;  // Right

        // No movement if no keys pressed (and no auto-run)
        if (dirX === 0 && dirZ === 0) {
            if (this.isWASDMoving) {
                this.isWASDMoving = false;
                this.isMoving = false;  // Stop movement immediately when WASD released
            }
            return false;
        }

        // Normalize diagonal movement (prevent faster diagonal speed)
        const length = Math.sqrt(dirX * dirX + dirZ * dirZ);
        dirX /= length;
        dirZ /= length;

        // Rotate direction by camera rotation to get world-space direction
        const cos = Math.cos(cameraRotation);
        const sin = Math.sin(cameraRotation);
        const worldDirX = dirX * cos - dirZ * sin;
        const worldDirZ = dirX * sin + dirZ * cos;

        // Store direction for player rotation
        this.wasdDirection.set(worldDirX, 0, worldDirZ);

        // Project target position ahead of player
        const targetDistance = CONFIG.WASD?.TARGET_DISTANCE || 2.0;
        const targetX = this.playerObject.position.x + worldDirX * targetDistance;
        const targetZ = this.playerObject.position.z + worldDirZ * targetDistance;

        // Update target position (reuses existing movement system)
        this.targetPosition.set(targetX, this.playerObject.position.y, targetZ);
        this.isMoving = true;
        this.isWASDMoving = true;

        // Update speed multiplier periodically
        const now = performance.now();
        if (now - this.lastSpeedUpdateTime >= this.SPEED_UPDATE_INTERVAL) {
            this._updateSpeedMultiplier();
        }

        return true;
    }

    /**
     * Get WASD movement direction (normalized world-space vector)
     * @returns {THREE.Vector3}
     */
    getWASDDirection() {
        return this.wasdDirection;
    }

    /**
     * Check if currently using WASD movement
     * @returns {boolean}
     */
    isUsingWASD() {
        return this.isWASDMoving;
    }

    /**
     * Start climbing an outpost
     * @param {THREE.Object3D} outpost - The outpost object to climb
     * @param {object} gameState - Reference to game state
     * @returns {THREE.Vector3} Target position at top of outpost
     */
    startClimbing(outpost, gameState) {
        // Store original position for descent
        gameState.climbingState.originalPosition = this.playerObject.position.clone();

        // Calculate center of outpost (outpost position is already centered)
        const outpostCenter = outpost.position.clone();

        // Calculate target position (center + climb height)
        const targetPosition = outpostCenter.clone();
        targetPosition.y += gameState.climbingState.climbHeight;

        // Store climbing data
        gameState.climbingState.climbingOutpost = outpost;
        gameState.climbingState.outpostId = outpost.userData.objectId;
        gameState.climbingState.targetPosition = targetPosition;
        gameState.climbingState.climbingStartTime = performance.now();  // Use performance.now() to match game loop
        gameState.climbingState.climbingPhase = 'ascending';
        gameState.climbingState.isClimbing = true;

        // Stop any current movement
        this.stopMovement();

        return targetPosition;
    }

    /**
     * Start descending from outpost
     * @param {object} gameState - Reference to game state
     * @returns {THREE.Vector3} Position to move away from outpost
     */
    endClimbing(gameState) {
        // Calculate exit position (move away from center)
        const outpostPos = gameState.climbingState.climbingOutpost.position.clone();
        const playerPos = this.playerObject.position.clone();

        // Calculate direction away from outpost
        const awayDirection = new THREE.Vector3();
        awayDirection.subVectors(gameState.climbingState.originalPosition, outpostPos);
        awayDirection.y = 0; // Keep horizontal
        awayDirection.normalize();

        // Exit position is 0.7 units away from outpost center
        const exitPosition = outpostPos.clone();
        exitPosition.x += awayDirection.x * 0.7;
        exitPosition.z += awayDirection.z * 0.7;

        // Set terrain height for exit position
        if (this.terrainGenerator) {
            const terrainHeight = this.terrainGenerator.getWorldHeight(exitPosition.x, exitPosition.z);
            exitPosition.y = terrainHeight + 0.03;
        }

        // Update climbing phase
        gameState.climbingState.climbingPhase = 'descending';
        gameState.climbingState.climbingStartTime = performance.now();  // Use performance.now() to match game loop
        gameState.climbingState.targetPosition = exitPosition;

        return exitPosition;
    }

    /**
     * Check if player is currently climbing
     * @param {object} gameState - Reference to game state
     * @returns {boolean}
     */
    isClimbing(gameState) {
        return gameState.climbingState.isClimbing;
    }
}

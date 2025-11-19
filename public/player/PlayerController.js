/**
 * PlayerController.js
 * Manages player movement, position, rotation, and basic state
 */

import * as THREE from 'three';
import { ui } from '../ui.js';
import { CONFIG } from '../config.js';

export class PlayerController {
    constructor(playerObject, terrainRenderer, physicsManager = null, navigationManager = null) {
        this.playerObject = playerObject;
        this.terrainRenderer = terrainRenderer;
        this.physicsManager = physicsManager;
        this.navigationManager = navigationManager;

        // Movement state
        this.isMoving = false;
        this.targetPosition = new THREE.Vector3();
        this.speed = 0.0005; // Base speed (units per millisecond)
        this.stopThreshold = 0.01;

        // Track actual movement for stuck detection
        this.lastPosition = new THREE.Vector3();
        this.minMovementSpeed = 0.00001; // Stop if moving slower than this per frame (lowered to allow slow terrain movement)

        // Terrain speed modifier (cached for performance)
        this.cachedSpeedMultiplier = 1.0;
        this.frameCounter = 0;

        // Callbacks
        this.onArriveCallback = null;
        this.onBlockedCallback = null;
    }

    /**
     * Set physics manager reference for collision detection
     * @param {PhysicsManager} physicsManager
     */
    setPhysicsManager(physicsManager) {
        this.physicsManager = physicsManager;
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
     * Check if a position is in water (terrain below water level)
     * @param {number} x - X coordinate
     * @param {number} z - Z coordinate
     * @returns {boolean} - True if position is in water
     */
    isPositionInWater(x, z) {
        if (!this.terrainRenderer) return false;
        const terrainHeight = this.terrainRenderer.getHeightFast(x, z);
        return terrainHeight < CONFIG.WATER.MIN_WALKABLE_HEIGHT;
    }

    /**
     * Check if player can move to a position (not in water)
     * @param {number} x - X coordinate
     * @param {number} z - Z coordinate
     * @returns {boolean} - True if position is walkable
     */
    canMoveToPosition(x, z) {
        return !this.isPositionInWater(x, z);
    }

    /**
     * Set target position for player to move to
     * @param {THREE.Vector3} position
     */
    setTargetPosition(position) {
        // Check if target is in water and block if needed
        if (!this.canMoveToPosition(position.x, position.z)) {
            ui.updateStatusLine1("Cannot enter water", 3000);
            return;
        }
        this.targetPosition.copy(position);
        this.isMoving = true;
        // Initialize last position to current position for stuck detection
        this.lastPosition.copy(this.playerObject.position);
    }

    /**
     * Stop player movement
     */
    stopMovement() {
        this.isMoving = false;
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

        // Physics manager state check (disabled - only enable for debugging)
        // if (this.isMoving) {
        //     console.log('[DEBUG] Moving - Physics Manager:', this.physicsManager ? 'EXISTS' : 'NULL',
        //                'Initialized:', this.physicsManager?.initialized,
        //                'Player ID:', this.playerObject.userData.objectId);
        // }

        // Don't move if player is dead
        if (isDead) {
            this.isMoving = false;
            // Keep current height when dying - no adjustment needed
            return false;
        }

        // If not moving, just return (no constant height updates)
        if (!this.isMoving) {
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
            this.isMoving = false;
            // Keep the height from last movement frame - no adjustment needed

            // Log player coordinates and height on arrival
            console.log(`🎯 Player arrived at: X=${position.x.toFixed(2)}, Y=${position.y.toFixed(2)}, Z=${position.z.toFixed(2)}`);

            ui.updateStatus("✅ Arrived at destination.");

            // Trigger arrival callback
            if (this.onArriveCallback) {
                this.onArriveCallback();
            }

            return false;
        } else {
            // Continue moving
            // Update terrain speed modifier (cached for performance - every 5 frames)
            this.frameCounter++;
            if (this.frameCounter % 5 === 0 && this.navigationManager) {
                this.cachedSpeedMultiplier = this.navigationManager.getMovementSpeedMultiplier(
                    position.x,
                    position.z
                );
            }

            // Apply terrain speed modifier to base speed
            const actualSpeed = this.speed * this.cachedSpeedMultiplier;
            const moveStep = actualSpeed * deltaTime;
            // Only calculate actual distance when needed for lerp alpha calculation
            const distance = Math.sqrt(distanceSquared);
            const alpha = Math.min(1, moveStep / distance);

            // Calculate desired next position
            const nextPosition = position.clone();
            nextPosition.lerp(this.targetPosition, alpha);

            // Check for water boundary - stop if trying to enter water
            if (this.isPositionInWater(nextPosition.x, nextPosition.z)) {
                // Stop at water's edge
                this.isMoving = false;
                ui.updateStatusLine1("Cannot enter water", 3000);
                ui.updateStatus("Stopped at water's edge");

                // Trigger blocked callback
                if (this.onBlockedCallback) {
                    this.onBlockedCallback(position);
                }

                return false;
            }

            // Store position before movement for stuck detection
            this.lastPosition.copy(position);

            // Use physics collision detection if available
            if (this.physicsManager && this.physicsManager.initialized) {
                const movementVector = new THREE.Vector3().subVectors(nextPosition, position);
                const result = this.physicsManager.computeCharacterMovement(
                    this.playerObject.userData.objectId || 'player',
                    movementVector
                );

                // Collision detection logging (disabled - only enable for debugging)
                // const originalLen = movementVector.length();
                // const correctedLen = result.correctedMovement.length();
                // if (Math.abs(originalLen - correctedLen) > 0.001) {
                //     console.log('[COLLISION] Movement blocked! Original:', originalLen.toFixed(4), 'Corrected:', correctedLen.toFixed(4), 'HasCollision:', result.hasCollision);
                // }

                // Apply collision-corrected movement
                position.add(result.correctedMovement);

                // If collision blocked movement significantly, trigger callback
                if (result.hasCollision && result.correctedMovement.length() < movementVector.length() * 0.5) {
                    ui.updateStatusLine1("Path blocked", 2000);
                    if (this.onBlockedCallback) {
                        this.onBlockedCallback(position);
                    }
                }
            } else {
                // Fallback: apply movement without collision detection
                position.copy(nextPosition);
            }

            // Check if player is barely moving (stuck against collision)
            // Calculate actual 2D movement this frame
            const moveDx = position.x - this.lastPosition.x;
            const moveDz = position.z - this.lastPosition.z;
            const actualMovementSquared = moveDx * moveDx + moveDz * moveDz;  // PERFORMANCE: No Math.pow() or Math.sqrt()
            const minSpeedSquared = this.minMovementSpeed * this.minMovementSpeed;

            // If moving too slowly, stop completely (prevents slow crawl against walls)
            if (actualMovementSquared < minSpeedSquared) {
                this.isMoving = false;
                ui.updateStatusLine1("Blocked", 1500);
                return false;
            }

            // Update Y position to follow terrain
            if (this.terrainRenderer) {
                const terrainHeight = this.terrainRenderer.getHeightFast(position.x, position.z);
                const targetY = terrainHeight + 0.03;
                position.y = THREE.MathUtils.lerp(position.y, targetY, 0.2);

                // Update physics position after Y adjustment
                if (this.physicsManager?.updateKinematicPosition) {
                    this.physicsManager.updateKinematicPosition(
                        this.playerObject.userData.objectId,
                        position
                    );
                }
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
        if (this.terrainRenderer) {
            const terrainHeight = this.terrainRenderer.getHeightFast(position.x, position.z);
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
}

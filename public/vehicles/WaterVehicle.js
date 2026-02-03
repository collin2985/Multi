/**
 * WaterVehicle.js
 * Vehicle class for water-based vehicles (boat, sailboat, ship2)
 *
 * Extends BaseVehicle with water-specific physics:
 * - Cuboid character controller with rotation
 * - WASD movement with bidirectional velocity
 * - Turn rate scaling (100% at rest → 50% at full speed)
 * - 6-point water depth validation (4 corners + 2 mid-sides)
 * - Boat-to-boat collision detection
 */

import { BaseVehicle } from './BaseVehicle.js';
import { getTerrainHeight } from '../core/TerrainAccess.js';
import * as THREE from 'three';

// DEBUG: Set to true to show depth check visualization
const DEBUG_SHOW_DEPTH_CHECKS = false;

export class WaterVehicle extends BaseVehicle {
    constructor(type, config) {
        super(type, config);

        // Water-specific properties from config
        this.minWaterDepth = config.minWaterDepth ?? 0;
        this.halfWidth = config.halfWidth ?? 0.5;
        this.halfDepth = config.halfDepth ?? 0.5;

        // Cached trig values for water boundary checks
        this._cachedHeading = null;
        this._cachedCosH = 1;
        this._cachedSinH = 0;

        // DEBUG: Visualization lines
        this._debugLines = null;
    }

    // === ABSTRACT METHOD IMPLEMENTATIONS ===

    /**
     * @returns {'water'}
     */
    getTerrainConstraint() {
        return 'water';
    }

    /**
     * Create cuboid character controller for boat collision
     * @param {PhysicsManager} physicsManager
     * @returns {string} Controller ID
     */
    createCharacterController(physicsManager) {
        if (!this.mesh || !physicsManager) return null;

        // Create cuboid with rotation (halfWidth x 1.0 x halfDepth)
        this.characterController = physicsManager.createBoatController(
            this.mesh.position,
            this.halfWidth,
            this.halfDepth,
            this.heading
        );

        return this.characterController;
    }

    /**
     * Update boat movement based on input
     * @param {object} keys - Input state { w, s, a, d }
     * @param {number} deltaTime - Time since last frame (ms)
     * @param {TerrainGenerator} terrainGenerator - For height queries (unused, uses getTerrainHeight)
     * @param {PhysicsManager} physicsManager - For collision detection
     * @param {object} options - Additional options { isDead, gameStateManager }
     * @returns {object} { moved, hitObstacle, hitMerchantShip, hitPeerBoat, hitUnoccupiedBoat, isTurning }
     */
    updateMovement(keys, deltaTime, terrainGenerator, physicsManager, options = {}) {
        const { isDead = false, gameStateManager = null } = options;
        const config = this.config;

        const wasStopped = this.velocity === 0;
        let hitObstacle = false;
        let isTurning = false;

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

            // Save heading before rotation (to revert if boundary check fails)
            this._previousHeading = this.heading;

            // Apply turning
            if (wantsLeft) {
                this.heading += turnRate * deltaTime;
                isTurning = true;
            }
            if (wantsRight) {
                this.heading -= turnRate * deltaTime;
                isTurning = true;
            }

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

        // Clamp to max speed (reverse is slower)
        const reverseMaxSpeed = config.maxSpeed * (config.reverseSpeedMultiplier ?? 1);
        this.velocity = Math.max(-reverseMaxSpeed, Math.min(config.maxSpeed, this.velocity));

        // Calculate desired movement
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

            // Only consider "stuck" if corrected movement is nearly zero compared to desired
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

        // Check for boat collisions (merchant ships and peer boats)
        if (physicsManager && this.characterController) {
            const collisions = physicsManager.checkBoatCollisions(this.characterController, this.type, this.heading);

            // Merchant ship collision - always fatal
            if (collisions.merchant) {
                return { moved: false, hitObstacle: true, hitMerchantShip: true };
            }

            // Peer boat collision - check speed
            if (collisions.peerBoat) {
                const SPEED_THRESHOLD = 0.0005;
                const localSpeed = Math.abs(this.velocity);
                const peerInfo = gameStateManager?.getPeerBoatInfo(collisions.peerBoat.peerId);
                const peerSpeed = peerInfo?.speed || 0;

                if (localSpeed >= SPEED_THRESHOLD || peerSpeed >= SPEED_THRESHOLD) {
                    // Hierarchy: ship2 (3) > sailboat (2) > boat (1)
                    const typeRank = { boat: 1, sailboat: 2, ship2: 3 };
                    const myRank = typeRank[this.type] || 1;
                    const peerRank = typeRank[collisions.peerBoat.entityType] || 1;

                    // I sink if my rank is <= peer's rank
                    if (myRank <= peerRank) {
                        return {
                            moved: false,
                            hitObstacle: true,
                            hitPeerBoat: {
                                peerId: collisions.peerBoat.peerId,
                                peerEntityType: collisions.peerBoat.entityType
                            }
                        };
                    }
                }
            }

            // Unoccupied boat collision - same hierarchy
            if (collisions.unoccupiedBoat) {
                const SPEED_THRESHOLD = 0.0005;
                const localSpeed = Math.abs(this.velocity);

                if (localSpeed >= SPEED_THRESHOLD) {
                    const typeRank = { boat: 1, sailboat: 2, ship2: 3 };
                    const myRank = typeRank[this.type] || 1;
                    const targetRank = typeRank[collisions.unoccupiedBoat.entityType] || 1;

                    if (myRank <= targetRank) {
                        // I lose - I sink
                        return {
                            moved: false,
                            hitObstacle: true,
                            hitUnoccupiedBoat: {
                                colliderId: collisions.unoccupiedBoat.colliderId,
                                entityType: collisions.unoccupiedBoat.entityType
                            }
                        };
                    } else {
                        // I win - they sink, I continue moving
                        return {
                            moved: true,
                            hitObstacle: false,
                            isTurning,
                            destroyedUnoccupiedBoat: {
                                colliderId: collisions.unoccupiedBoat.colliderId,
                                entityType: collisions.unoccupiedBoat.entityType
                            }
                        };
                    }
                }
            }
        }

        // Calculate next position with collision-corrected movement
        const nextX = this.mesh.position.x + finalMoveX;
        const nextZ = this.mesh.position.z + finalMoveZ;

        // Water boundary check - 6-point hull check (4 corners + 2 mid-sides)
        const waterBoundaryHit = this.checkWaterBoundary(nextX, nextZ);

        if (waterBoundaryHit || hitObstacle) {
            // Hit shallow water/shore or obstacle - stop
            this.velocity = 0;
            // Revert heading if rotation caused boundary violation
            if (this._previousHeading !== undefined) {
                this.heading = this._previousHeading;
            }
        } else {
            // Apply movement (X/Z only - AnimationSystem handles Y via wave height)
            this.mesh.position.x = nextX;
            this.mesh.position.z = nextZ;

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

        // Check for disembark on stop (one-time check)
        const nowStopped = this.velocity === 0;
        if (!wasStopped && nowStopped) {
            this.checkDisembarkable();
        }

        // Clear disembark if moving again
        if (!nowStopped) {
            this.canDisembark = false;
            this.disembarkPosition = null;
        }

        return { moved: this.velocity !== 0, hitObstacle, isTurning };
    }

    // === WATER-SPECIFIC METHODS ===

    /**
     * Check if position is valid water (all 6 check points deep enough)
     * @param {number} nextX - Target X position
     * @param {number} nextZ - Target Z position
     * @returns {boolean} True if hit boundary (water too shallow)
     */
    checkWaterBoundary(nextX, nextZ) {
        // Cache trig values - only recalculate when heading changes
        // Note: sin is negated to match quaternion rotation convention used by physics collider
        if (this._cachedHeading !== this.heading) {
            this._cachedHeading = this.heading;
            this._cachedCosH = Math.cos(this.heading);
            this._cachedSinH = -Math.sin(this.heading);
        }

        const cosH = this._cachedCosH;
        const sinH = this._cachedSinH;
        const hw = this.halfWidth;
        const hd = this.halfDepth;

        // Check 4 corners + 2 mid-sides, find shallowest (highest terrain Y)
        // Standard rotation: rotatedX = dx * cos - dz * sin, rotatedZ = dx * sin + dz * cos
        // Where dx = ±hw (width, side-to-side), dz = ±hd (depth, bow-to-stern)
        const terrainY = Math.max(
            getTerrainHeight(nextX - hw * cosH - hd * sinH, nextZ - hw * sinH + hd * cosH),  // front-left
            getTerrainHeight(nextX + hw * cosH - hd * sinH, nextZ + hw * sinH + hd * cosH),  // front-right
            getTerrainHeight(nextX - hw * cosH + hd * sinH, nextZ - hw * sinH - hd * cosH),  // back-left
            getTerrainHeight(nextX + hw * cosH + hd * sinH, nextZ + hw * sinH - hd * cosH),  // back-right
            getTerrainHeight(nextX - hw * cosH, nextZ - hw * sinH),                          // mid-left
            getTerrainHeight(nextX + hw * cosH, nextZ + hw * sinH)                           // mid-right
        );

        // Hit boundary if shallowest point is above minimum depth
        return terrainY >= this.minWaterDepth;
    }

    /**
     * Board this water vehicle
     * @override
     */
    board(mesh, id, chunkKey, quality, lastRepairTime, owner) {
        super.board(mesh, id, chunkKey, quality, lastRepairTime, owner);

        // Reset cached trig values
        this._cachedHeading = null;
        this._cachedCosH = 1;
        this._cachedSinH = 0;
    }

    // === DEBUG VISUALIZATION ===

    /**
     * DEBUG: Create or update visualization lines for depth check corners
     * @param {THREE.Scene} scene - Scene to add lines to
     */
    updateDebugVisualization(scene) {
        if (!DEBUG_SHOW_DEPTH_CHECKS || !this.mesh || !scene) return;

        const cosH = this._cachedCosH;
        const sinH = this._cachedSinH;
        const hw = this.halfWidth;
        const hd = this.halfDepth;
        const posX = this.mesh.position.x;
        const posZ = this.mesh.position.z;

        // Calculate 4 corner + 2 mid-side positions (exact same formula as checkWaterBoundary)
        // Format: { x: worldX offset, z: worldZ offset }
        const checkPoints = [
            { x: -hw * cosH - hd * sinH, z: -hw * sinH + hd * cosH, color: 0xff0000 },   // front-left (red)
            { x:  hw * cosH - hd * sinH, z:  hw * sinH + hd * cosH, color: 0x00ff00 },   // front-right (green)
            { x: -hw * cosH + hd * sinH, z: -hw * sinH - hd * cosH, color: 0x0000ff },   // back-left (blue)
            { x:  hw * cosH + hd * sinH, z:  hw * sinH - hd * cosH, color: 0xffff00 },   // back-right (yellow)
            { x: -hw * cosH,             z: -hw * sinH,             color: 0xff00ff },   // mid-left (magenta)
            { x:  hw * cosH,             z:  hw * sinH,             color: 0x00ffff },   // mid-right (cyan)
        ];

        // Create debug lines if they don't exist
        if (!this._debugLines) {
            this._debugLines = [];
            const lineMaterial = new THREE.LineBasicMaterial({
                depthTest: false,  // Render through water
                depthWrite: false,
                transparent: true,
                opacity: 1.0
            });

            for (let i = 0; i < 6; i++) {
                const geometry = new THREE.BufferGeometry();
                const positions = new Float32Array(6); // 2 points x 3 coords
                geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

                const material = lineMaterial.clone();
                material.color.setHex(checkPoints[i].color);

                const line = new THREE.Line(geometry, material);
                line.renderOrder = 9999; // Render on top
                line.frustumCulled = false;
                scene.add(line);
                this._debugLines.push(line);
            }
        }

        // Update line positions
        for (let i = 0; i < 6; i++) {
            const corner = checkPoints[i];
            // World position using pre-calculated offsets
            const worldX = posX + corner.x;
            const worldZ = posZ + corner.z;
            const terrainY = getTerrainHeight(worldX, worldZ);

            const positions = this._debugLines[i].geometry.attributes.position.array;
            // Top point (at water level + some height to be visible)
            positions[0] = worldX;
            positions[1] = 2.0;  // Above water
            positions[2] = worldZ;
            // Bottom point (at terrain)
            positions[3] = worldX;
            positions[4] = terrainY;
            positions[5] = worldZ;

            this._debugLines[i].geometry.attributes.position.needsUpdate = true;
        }
    }

    /**
     * DEBUG: Remove visualization lines from scene
     * @param {THREE.Scene} scene - Scene to remove lines from
     */
    removeDebugVisualization(scene) {
        if (this._debugLines && scene) {
            for (const line of this._debugLines) {
                scene.remove(line);
                line.geometry.dispose();
                line.material.dispose();
            }
            this._debugLines = null;
        }
    }

    /**
     * DEBUG: Create or update visualization for physics collider box
     * Uses quaternion rotation (same as PhysicsManager) to show collider bounds
     * @param {THREE.Scene} scene - Scene to add lines to
     */
    updateColliderDebugVisualization(scene) {
        if (!DEBUG_SHOW_DEPTH_CHECKS || !this.mesh || !scene) return;

        const hw = this.halfWidth;
        const hd = this.halfDepth;
        const posX = this.mesh.position.x;
        const posZ = this.mesh.position.z;
        const posY = 1.5; // Draw at water level for visibility

        // Use quaternion rotation (same approach as PhysicsManager.createStaticCollider)
        const quaternion = new THREE.Quaternion();
        quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.heading);

        // 4 corners in local space (before rotation)
        const localCorners = [
            new THREE.Vector3(-hw, 0, -hd),  // 0: back-left
            new THREE.Vector3( hw, 0, -hd),  // 1: back-right
            new THREE.Vector3( hw, 0,  hd),  // 2: front-right
            new THREE.Vector3(-hw, 0,  hd),  // 3: front-left
        ];

        // Apply quaternion rotation to each corner
        const worldCorners = localCorners.map(c => {
            const rotated = c.clone().applyQuaternion(quaternion);
            return new THREE.Vector3(posX + rotated.x, posY, posZ + rotated.z);
        });

        // Create white box outline if it doesn't exist
        if (!this._colliderDebugBox) {
            const material = new THREE.LineBasicMaterial({
                color: 0xffffff,
                depthTest: false,
                depthWrite: false,
                transparent: true,
                opacity: 1.0
            });

            // Create line loop for box outline (4 edges connecting corners)
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(15); // 5 points x 3 coords (close the loop)
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

            this._colliderDebugBox = new THREE.Line(geometry, material);
            this._colliderDebugBox.renderOrder = 9998; // Just below depth check lines
            this._colliderDebugBox.frustumCulled = false;
            scene.add(this._colliderDebugBox);
        }

        // Update box positions (0 -> 1 -> 2 -> 3 -> 0 to close loop)
        const positions = this._colliderDebugBox.geometry.attributes.position.array;
        for (let i = 0; i < 4; i++) {
            positions[i * 3] = worldCorners[i].x;
            positions[i * 3 + 1] = worldCorners[i].y;
            positions[i * 3 + 2] = worldCorners[i].z;
        }
        // Close the loop
        positions[12] = worldCorners[0].x;
        positions[13] = worldCorners[0].y;
        positions[14] = worldCorners[0].z;

        this._colliderDebugBox.geometry.attributes.position.needsUpdate = true;
    }

    /**
     * DEBUG: Remove collider visualization from scene
     * @param {THREE.Scene} scene - Scene to remove from
     */
    removeColliderDebugVisualization(scene) {
        if (this._colliderDebugBox && scene) {
            scene.remove(this._colliderDebugBox);
            this._colliderDebugBox.geometry.dispose();
            this._colliderDebugBox.material.dispose();
            this._colliderDebugBox = null;
        }
    }

    /**
     * @override - Clean up debug visualization on disembark
     */
    cleanup() {
        // Note: Scene reference needed - caller should call removeDebugVisualization first
        super.cleanup();
    }
}

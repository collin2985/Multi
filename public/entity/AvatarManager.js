/**
 * AvatarManager.js
 * Manages peer player avatars - creation, movement, animations, death
 */

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from '../config.js';

export class AvatarManager {
    constructor(scene, networkManager, structureManager, terrainRenderer, modelManager, navigationManager = null, playerScale = 1) {
        this.scene = scene;
        this.networkManager = networkManager;
        this.structureManager = structureManager;
        this.terrainRenderer = terrainRenderer;
        this.modelManager = modelManager;
        this.navigationManager = navigationManager;

        this.playerScale = playerScale; // Use the same scale as main player
        this.playerSpeed = 0.002; // Base speed
        this.stopThreshold = 0.01;

        // Frame counter for speed multiplier updates (shared across all avatars)
        this.frameCounter = 0;
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
     * Create a new avatar for a peer player
     * @returns {THREE.Object3D|null}
     */
    createAvatar() {
        const manGLTF = this.modelManager.getGLTF('man');
        if (!manGLTF) {
            console.error('Man model not loaded for avatar');
            return null;
        }

        // Use SkeletonUtils.clone() to preserve skeleton binding for animations
        const avatarMesh = SkeletonUtils.clone(manGLTF.scene);
        avatarMesh.scale.set(this.playerScale, this.playerScale, this.playerScale);

        // Setup materials (same as main player)
        avatarMesh.traverse((child) => {
            if (child.isMesh || child.isSkinnedMesh) {
                child.visible = true;
                child.frustumCulled = true;  // PERFORMANCE: Enable frustum culling to skip off-screen rendering
                child.renderOrder = 1;

                if (child.material) {
                    child.material.depthWrite = true;
                    child.material.depthTest = true;
                    if (child.material.type === 'MeshStandardMaterial') {
                        child.material.needsUpdate = true;
                    }
                }
            }
        });

        // Create animation mixer for this avatar
        if (manGLTF.animations && manGLTF.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(avatarMesh);
            const walkAnimation = manGLTF.animations.find(anim =>
                anim.name.toLowerCase().includes('walk')
            );

            if (walkAnimation) {
                const action = mixer.clipAction(walkAnimation);
                action.play();
                // Store mixer and action in userData
                avatarMesh.userData.mixer = mixer;
                avatarMesh.userData.action = action;
            }
        }

        // Store last position for rotation calculation
        avatarMesh.userData.lastPosition = new THREE.Vector3();
        avatarMesh.userData.isMoving = false;

        // Terrain speed modifier (cached for performance)
        avatarMesh.userData.cachedSpeedMultiplier = 1.0;

        // Note: Character controller will be created when avatar is added to scene with objectId

        return avatarMesh;
    }

    /**
     * Create physics character controller for peer avatar
     * @param {THREE.Object3D} avatar - Avatar mesh
     * @param {string} peerId - Peer client ID
     */
    createAvatarPhysics(avatar, peerId) {
        const game = this.networkManager.game;
        if (game && game.physicsManager && game.physicsManager.initialized) {
            const avatarObjectId = `peer_${peerId}`;
            avatar.userData.objectId = avatarObjectId;

            // Create character controller (radius: 0.3, height: 1.0)
            game.physicsManager.createCharacterController(
                avatarObjectId,
                0.3,  // Capsule radius
                1.0,  // Capsule height
                avatar.position
            );

            console.log(`[PHYSICS] Created character controller for peer ${peerId} at (${avatar.position.x.toFixed(2)}, ${avatar.position.y.toFixed(2)}, ${avatar.position.z.toFixed(2)})`);
        }
    }

    /**
     * Update all avatar movements and animations
     * @param {number} deltaTime
     */
    updateAvatarMovement(deltaTime) {
        // Update speed multiplier cache every 5 frames
        this.frameCounter++;
        const shouldUpdateSpeed = (this.frameCounter % 5 === 0);

        this.networkManager.avatars.forEach((avatar, peerId) => {
            const peer = this.networkManager.peerGameData.get(peerId);
            if (peer?.targetPosition) {
                // Store last position before moving
                avatar.userData.lastPosition.copy(avatar.position);

                const distance = avatar.position.distanceTo(peer.targetPosition);
                if (distance <= this.stopThreshold) {
                    // Check if target position is in water before setting
                    if (!this.isPositionInWater(peer.targetPosition.x, peer.targetPosition.z)) {
                        avatar.position.copy(peer.targetPosition);
                    }
                    peer.targetPosition = null;
                    avatar.userData.isMoving = false;
                } else {
                    // Update terrain speed modifier (cached for performance)
                    if (shouldUpdateSpeed && this.navigationManager) {
                        avatar.userData.cachedSpeedMultiplier = this.navigationManager.getMovementSpeedMultiplier(
                            avatar.position.x,
                            avatar.position.z
                        );
                    }

                    // Calculate next position with terrain speed modifier
                    const nextPosition = avatar.position.clone();
                    const actualSpeed = this.playerSpeed * avatar.userData.cachedSpeedMultiplier;
                    const moveStep = actualSpeed * deltaTime;
                    const alpha = Math.min(1, moveStep / distance);
                    nextPosition.lerp(peer.targetPosition, alpha);

                    // Check if next position would be in water
                    if (!this.isPositionInWater(nextPosition.x, nextPosition.z)) {
                        // Use physics collision detection if available
                        const game = this.networkManager.game;
                        if (game && game.physicsManager && game.physicsManager.initialized && avatar.userData.objectId) {
                            const movementVector = new THREE.Vector3().subVectors(nextPosition, avatar.position);
                            const result = game.physicsManager.computeCharacterMovement(
                                avatar.userData.objectId,
                                movementVector
                            );

                            // Apply collision-corrected movement
                            avatar.position.add(result.correctedMovement);
                        } else {
                            // Fallback: apply movement without collision detection
                            avatar.position.copy(nextPosition);
                        }

                        avatar.userData.isMoving = true;

                        // Calculate rotation from movement direction when moving
                        const direction = new THREE.Vector3();
                        direction.subVectors(peer.targetPosition, avatar.position).normalize();
                        if (direction.length() > 0) {
                            const targetRotation = Math.atan2(direction.x, direction.z);
                            const currentRotation = avatar.rotation.y;

                            // Smoothly interpolate rotation
                            let rotationDiff = targetRotation - currentRotation;
                            // Normalize to -PI to PI range
                            while (rotationDiff > Math.PI) rotationDiff -= Math.PI * 2;
                            while (rotationDiff < -Math.PI) rotationDiff += Math.PI * 2;

                            const rotationSpeed = 0.15;
                            avatar.rotation.y += rotationDiff * rotationSpeed;
                        }
                    } else {
                        // Stop at water edge
                        peer.targetPosition = null;
                        avatar.userData.isMoving = false;
                    }
                }

                // Update Y position to follow terrain or foundations
                if (this.terrainRenderer) {
                    // Check if avatar is on/near a foundation
                    const collision = this.structureManager.checkStructureCollision(avatar.position);

                    if (collision.hasCollision && collision.objectHeight) {
                        // Avatar should be on foundation - smooth lerp
                        const targetY = collision.objectHeight + 0.03;
                        avatar.position.y = THREE.MathUtils.lerp(avatar.position.y, targetY, 0.2);
                    } else {
                        // Avatar on terrain - smooth lerp
                        const terrainHeight = this.terrainRenderer.getHeightFast(avatar.position.x, avatar.position.z);
                        const targetY = terrainHeight + 0.03;
                        avatar.position.y = THREE.MathUtils.lerp(avatar.position.y, targetY, 0.2);
                    }
                }
            }

            // Check if peer is harvesting and update harvest animation
            if (peer?.harvestState) {
                const now = Date.now();
                if (now >= peer.harvestState.endTime) {
                    // Harvest complete, stop chopping animation
                    if (peer.choppingAction) {
                        peer.choppingAction.stop();
                    }
                    peer.harvestState = null;
                }
            }

            // Update animation mixer
            if (avatar.userData.mixer) {
                if (avatar.userData.isMoving) {
                    // Play walk animation when moving (1x speed like main player)
                    avatar.userData.mixer.update((deltaTime / 1000) * 1);
                } else {
                    // Idle: freeze on first frame
                    avatar.userData.mixer.setTime(0);
                }
            }
        });
    }

    /**
     * Update death animations for all avatars
     * @param {number} deltaTime
     * @param {function} updateDeathAnimationCallback - Callback to update death animation
     */
    updateAvatarDeathAnimations(deltaTime, updateDeathAnimationCallback) {
        this.networkManager.avatars.forEach((avatar, peerId) => {
            if (avatar.userData.isDead) {
                updateDeathAnimationCallback(
                    avatar,
                    avatar.userData.deathStartTime,
                    deltaTime,
                    avatar.userData.fallDirection || 1,
                    false
                );
            }
        });
    }

    /**
     * Remove avatar for disconnected peer
     * @param {string} peerId
     */
    removeAvatar(peerId) {
        const avatar = this.networkManager.avatars.get(peerId);
        if (avatar) {
            // Remove physics collider
            const game = this.networkManager.game;
            if (game && game.physicsManager && avatar.userData.objectId) {
                game.physicsManager.removeCollider(avatar.userData.objectId);
                console.log(`[PHYSICS] Removed collider for peer ${peerId}`);
            }

            this.scene.remove(avatar);
            if (avatar.geometry) avatar.geometry.dispose();
            if (avatar.material) avatar.material.dispose();
            this.networkManager.avatars.delete(peerId);
            return true;
        }
        return false;
    }

    /**
     * Get all avatars
     * @returns {Map}
     */
    getAvatars() {
        return this.networkManager.avatars;
    }

    /**
     * Get avatar by peer ID
     * @param {string} peerId
     * @returns {THREE.Object3D|null}
     */
    getAvatar(peerId) {
        return this.networkManager.avatars.get(peerId);
    }

    /**
     * Check if avatar is alive
     * @param {string} peerId
     * @returns {boolean}
     */
    isAvatarAlive(peerId) {
        const avatar = this.networkManager.avatars.get(peerId);
        return avatar && !avatar.userData.isDead;
    }
}

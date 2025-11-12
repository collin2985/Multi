/**
 * AIEnemyManager.js
 * Manages AI enemies - spawning from tents, movement updates, death tracking
 */

import * as THREE from 'three';
import { AIEnemy } from '../ai-enemy.js';
import { CONFIG } from '../config.js';

export class AIEnemyManager {
    constructor(scene, networkManager, structureManager, terrainRenderer, playerCollision = null) {
        this.scene = scene;
        this.networkManager = networkManager;
        this.structureManager = structureManager;
        this.terrainRenderer = terrainRenderer;
        this.playerCollision = playerCollision;

        // Track AI enemies spawned from tents
        this.tentAIEnemies = new Map(); // tentId -> {controller, tentObjectId, isDead}
        this.deadTentAIs = new Set(); // tentIds that had AI die (no respawn)

        // Legacy references for backward compatibility
        this.aiEnemyController = null;
        this.aiEnemy = null;

        // Movement parameters
        this.playerSpeed = 0.002;
        this.stopThreshold = 0.01;
    }

    /**
     * Try to spawn AI enemies at tents that don't have enemies yet
     * @param {THREE.Object3D} playerObject - Player position for distance check
     * @param {boolean} isDead - Is local player dead
     */
    trySpawnAI(playerObject, isDead) {
        // Find all tents in the scene
        const tents = [];
        this.scene.traverse((object) => {
            if (object.userData && object.userData.objectId && object.userData.modelType === 'tent') {
                tents.push(object);
            }
        });

        if (tents.length === 0) {
            return;
        }

        // Check each tent for AI spawning
        for (const tent of tents) {
            const tentId = tent.userData.objectId;

            // Skip if this tent already has an AI
            if (this.tentAIEnemies.has(tentId)) {
                continue;
            }

            // Skip if this tent's AI has died (no respawn)
            if (this.deadTentAIs.has(tentId)) {
                continue;
            }

            // Check if any player is within 15 units of this tent
            let playerNearby = false;

            // Check local player
            if (!isDead) {
                const distToLocal = Math.sqrt(
                    Math.pow(playerObject.position.x - tent.position.x, 2) +
                    Math.pow(playerObject.position.z - tent.position.z, 2)
                );
                if (distToLocal < 15) {
                    playerNearby = true;
                }
            }

            // Check peer players
            if (!playerNearby) {
                this.networkManager.avatars.forEach((avatar, peerId) => {
                    if (!avatar.userData.isDead) {
                        const distToPeer = Math.sqrt(
                            Math.pow(avatar.position.x - tent.position.x, 2) +
                            Math.pow(avatar.position.z - tent.position.z, 2)
                        );
                        if (distToPeer < 15) {
                            playerNearby = true;
                        }
                    }
                });
            }

            // Skip this tent if players are too close
            if (playerNearby) {
                continue;
            }

            // All conditions met - spawn AI for this tent!
            const distance = 2 + Math.random(); // Random distance between 2 and 3
            const angle = Math.random() * Math.PI * 2; // Random angle
            const aiSpawnPosition = new THREE.Vector3(
                tent.position.x + Math.cos(angle) * distance,
                tent.position.y,
                tent.position.z + Math.sin(angle) * distance
            );

            // Create AI enemy controller (passing game reference and collision system)
            const aiController = new AIEnemy(
                this.gameReference,
                this.scene,
                this.networkManager,
                aiSpawnPosition,
                this.playerCollision
            );

            // Store AI data for this tent
            this.tentAIEnemies.set(tentId, {
                controller: aiController,
                tentObjectId: tentId,
                isDead: false
            });

            // Update legacy references (use first spawned AI for backward compatibility)
            if (!this.aiEnemyController) {
                this.aiEnemyController = aiController;
                this.aiEnemy = aiController.enemy;
                this.networkManager.setAIEnemy(this.aiEnemy);
            }
        }
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
     * Set game reference for AI enemy spawning
     * @param {object} game - Game instance
     */
    setGameReference(game) {
        this.gameReference = game;
    }

    /**
     * Update all tent AI enemies
     * @param {number} deltaTime
     * @param {number} now - Current timestamp
     */
    updateTentAIEnemies(deltaTime, now) {
        for (const [tentId, aiData] of this.tentAIEnemies.entries()) {
            if (!aiData.isDead && aiData.controller) {
                aiData.controller.update(deltaTime, now);
            }
        }
    }

    /**
     * Update peer AI enemy movements
     * @param {number} deltaTime
     */
    updatePeerAIEnemies(deltaTime) {
        this.networkManager.peerGameData.forEach((peer, peerId) => {
            if (peer.aiEnemy && peer.aiEnemyTargetPosition) {
                const aiEnemy = peer.aiEnemy;
                const distance = aiEnemy.position.distanceTo(peer.aiEnemyTargetPosition);

                // Use same movement threshold as player
                if (distance <= this.stopThreshold) {
                    // Check if target position is in water before setting
                    if (!this.isPositionInWater(peer.aiEnemyTargetPosition.x, peer.aiEnemyTargetPosition.z)) {
                        aiEnemy.position.copy(peer.aiEnemyTargetPosition);
                    }
                } else {
                    // Calculate next position
                    const nextPosition = aiEnemy.position.clone();
                    const moveStep = this.playerSpeed * deltaTime;
                    const alpha = Math.min(1, moveStep / distance);
                    nextPosition.lerp(peer.aiEnemyTargetPosition, alpha);

                    // Check if next position would be in water
                    if (!this.isPositionInWater(nextPosition.x, nextPosition.z)) {
                        // Safe to move - apply the interpolation
                        aiEnemy.position.copy(nextPosition);

                        // Calculate rotation from movement direction if moving
                        if (peer.aiEnemyMoving) {
                            const direction = new THREE.Vector3();
                            direction.subVectors(peer.aiEnemyTargetPosition, aiEnemy.position).normalize();
                            if (direction.length() > 0) {
                                const targetRotation = Math.atan2(direction.x, direction.z);
                                const currentRotation = aiEnemy.rotation.y;

                                // Smoothly interpolate rotation
                                let rotationDiff = targetRotation - currentRotation;
                                while (rotationDiff > Math.PI) rotationDiff -= Math.PI * 2;
                                while (rotationDiff < -Math.PI) rotationDiff += Math.PI * 2;

                                const rotationSpeed = 0.15;
                                aiEnemy.rotation.y += rotationDiff * rotationSpeed;
                            }
                        }
                    }
                    // If would enter water, just keep current position (stop at water edge)
                }

                // Update Y position to follow terrain or foundations
                if (this.terrainRenderer) {
                    const collision = this.structureManager.checkStructureCollision(aiEnemy.position);

                    if (collision.hasCollision && collision.objectHeight) {
                        const targetY = collision.objectHeight + 0.03;
                        aiEnemy.position.y = THREE.MathUtils.lerp(aiEnemy.position.y, targetY, 0.2);
                    } else {
                        const terrainHeight = this.terrainRenderer.getHeightFast(aiEnemy.position.x, aiEnemy.position.z);
                        const targetY = terrainHeight + 0.03;
                        aiEnemy.position.y = THREE.MathUtils.lerp(aiEnemy.position.y, targetY, 0.2);
                    }
                }
            }
        });
    }

    /**
     * Mark tent AI as dead (no respawn)
     * @param {string} tentId
     */
    markTentAIDead(tentId) {
        const aiData = this.tentAIEnemies.get(tentId);
        if (aiData) {
            aiData.isDead = true;
            this.deadTentAIs.add(tentId);
        }
    }

    /**
     * Get all tent AI enemies
     * @returns {Map}
     */
    getTentAIEnemies() {
        return this.tentAIEnemies;
    }

    /**
     * Get legacy AI enemy controller (first spawned)
     * @returns {AIEnemy|null}
     */
    getAIEnemyController() {
        return this.aiEnemyController;
    }

    /**
     * Get legacy AI enemy mesh (first spawned)
     * @returns {THREE.Object3D|null}
     */
    getAIEnemy() {
        return this.aiEnemy;
    }
}

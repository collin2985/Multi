/**
 * AIEnemyManager.js
 * Manages AI enemies - spawning from tents, movement updates, death tracking
 */

import * as THREE from 'three';
import { AIEnemy } from '../ai-enemy.js';
import { CONFIG } from '../config.js';
import { ChunkCoordinates } from '../core/ChunkCoordinates.js';

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

        // PERFORMANCE OPTIMIZATION: Reusable vectors to avoid allocations in hot loops
        this._tempVector3 = new THREE.Vector3();
        this._tempDirection = new THREE.Vector3();
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
            // PERFORMANCE OPTIMIZATION: Use squared distances to avoid Math.sqrt and Math.pow
            const minDistanceSquared = 15 * 15; // 225

            // Check local player
            if (!isDead) {
                const dx = playerObject.position.x - tent.position.x;
                const dz = playerObject.position.z - tent.position.z;
                const distSquaredToLocal = dx * dx + dz * dz;  // No Math.pow() or Math.sqrt() needed!
                if (distSquaredToLocal < minDistanceSquared) {
                    playerNearby = true;
                }
            }

            // Check peer players
            if (!playerNearby) {
                this.networkManager.avatars.forEach((avatar, peerId) => {
                    if (!avatar.userData.isDead) {
                        const dx = avatar.position.x - tent.position.x;
                        const dz = avatar.position.z - tent.position.z;
                        const distSquaredToPeer = dx * dx + dz * dz;  // No Math.pow() or Math.sqrt() needed!
                        if (distSquaredToPeer < minDistanceSquared) {
                            playerNearby = true;
                        }
                    }
                });
            }

            // Skip this tent if players are too close
            if (playerNearby) {
                continue;
            }

            // Determine spawn authority - only lowest client ID in chunk can spawn
            const tentChunkId = ChunkCoordinates.worldToChunkId(tent.position.x, tent.position.z);
            const peersInChunk = this.networkManager.getPeersInChunk(tentChunkId);
            const myId = this.gameReference.gameState.clientId;
            const allClientsInChunk = [...peersInChunk, myId];
            allClientsInChunk.sort(); // Alphabetical sort for determinism

            const authority = allClientsInChunk[0];
            if (myId !== authority) {
                continue; // Not the authority for this chunk, skip spawn
            }

            // All conditions met - spawn AI for this tent!
            const distance = 2 + Math.random(); // Random distance between 2 and 3
            const angle = Math.random() * Math.PI * 2; // Random angle
            const aiSpawnPosition = new THREE.Vector3(
                tent.position.x + Math.cos(angle) * distance,
                tent.position.y,
                tent.position.z + Math.sin(angle) * distance
            );

            // Create AI enemy controller (passing game reference, collision system, and tentId)
            const aiController = new AIEnemy(
                this.gameReference,
                this.scene,
                this.networkManager,
                aiSpawnPosition,
                this.playerCollision,
                tentId  // Pass tentId for spawn broadcast
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
                    // Calculate next position using reusable vector (no clone!)
                    const nextPosition = this._tempVector3;
                    nextPosition.copy(aiEnemy.position);  // Copy current position to temp vector
                    const moveStep = this.playerSpeed * deltaTime;
                    const alpha = Math.min(1, moveStep / distance);
                    nextPosition.lerp(peer.aiEnemyTargetPosition, alpha);

                    // Check if next position would be in water
                    if (!this.isPositionInWater(nextPosition.x, nextPosition.z)) {
                        // Safe to move - apply the interpolation
                        aiEnemy.position.copy(nextPosition);

                        // Calculate rotation from movement direction if moving
                        if (peer.aiEnemyMoving) {
                            const direction = this._tempDirection;
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
     * Mark a tent as spawned by a peer (prevents local spawn attempts)
     * Called when receiving ai_enemy_spawn from another client
     * @param {string} tentId
     */
    markTentSpawnedByPeer(tentId) {
        if (!this.tentAIEnemies.has(tentId)) {
            // Mark tent as having an AI spawned by peer
            this.tentAIEnemies.set(tentId, {
                controller: null,  // No local controller
                tentObjectId: tentId,
                isDead: false,
                fromPeer: true
            });
        }
    }

    /**
     * Spawn AI from server command (server-authoritative spawning)
     * Factory method that creates AI based on type
     * @param {object} data - Spawn data from server
     * @param {string} data.aiId - Unique AI ID
     * @param {string} data.aiType - Type of AI to spawn ('combat_enemy', 'gardener_npc', etc.)
     * @param {string} data.spawnerId - ID of the spawner structure
     * @param {Array<number>} data.position - Spawn position [x, y, z]
     * @param {boolean} data.aggro - Whether AI is aggressive
     */
    spawnFromServer(data) {
        const { aiId, aiType, spawnerId, position, aggro } = data;

        // Idempotency check - don't spawn if already exists
        if (this.tentAIEnemies.has(spawnerId)) {
            const existing = this.tentAIEnemies.get(spawnerId);
            if (existing && !existing.isDead) {
                console.log(`[AIEnemyManager] AI already exists for spawner ${spawnerId}, skipping`);
                return;
            }
        }

        // Also check deadTentAIs (shouldn't happen with server authority, but safety check)
        if (this.deadTentAIs.has(spawnerId)) {
            console.log(`[AIEnemyManager] Spawner ${spawnerId} is marked dead, skipping`);
            return;
        }

        let aiController = null;
        const spawnPosition = new THREE.Vector3(position[0], position[1], position[2]);

        // Factory switch based on AI type
        switch (aiType) {
            case 'combat_enemy':
                // Create combat AI enemy
                aiController = new AIEnemy(
                    this.gameReference,
                    this.scene,
                    this.networkManager,
                    spawnPosition,
                    this.playerCollision,
                    spawnerId  // Pass spawnerId for death notification
                );
                break;

            case 'gardener_npc':
                // Future implementation
                console.log(`[AIEnemyManager] gardener_npc AI type not yet implemented`);
                // aiController = new GardenerAI(...);
                return;

            default:
                console.warn(`[AIEnemyManager] Unknown AI type: ${aiType}`);
                return;
        }

        if (aiController) {
            // Tag the entity with server-assigned ID and spawner ID
            aiController.aiId = aiId;
            aiController.tentId = spawnerId;
            if (aiController.enemy) {
                aiController.enemy.userData.aiId = aiId;
                aiController.enemy.userData.spawnerId = spawnerId;
            }

            // Track in our map
            this.tentAIEnemies.set(spawnerId, {
                controller: aiController,
                tentObjectId: spawnerId,
                isDead: false,
                aiId: aiId
            });

            // Update legacy references for backward compatibility
            if (!this.aiEnemyController) {
                this.aiEnemyController = aiController;
                this.aiEnemy = aiController.enemy;
                this.networkManager.setAIEnemy(this.aiEnemy);
            }

            console.log(`[AIEnemyManager] Spawned ${aiType} (${aiId}) from server at spawner ${spawnerId}`);
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

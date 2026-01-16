/**
 * AIEnemyManager.js
 * Manages AI enemies - spawning from tents, movement updates, death tracking
 */

import * as THREE from 'three';
import { AIEnemy } from '../ai-enemy.js';
import { CONFIG } from '../config.js';
import { ChunkCoordinates } from '../core/ChunkCoordinates.js';

export class AIEnemyManager {
    constructor(scene, networkManager, structureManager, terrainGenerator, playerCollision = null) {
        this.scene = scene;
        this.networkManager = networkManager;
        this.structureManager = structureManager;
        this.terrainGenerator = terrainGenerator;
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

        // PERFORMANCE: Frame counter for throttled updates
        this._frameCount = 0;
        this.HEIGHT_UPDATE_INTERVAL = 10; // Update terrain Y every 10 frames
    }

    /**
     * OLD CODE - Try to spawn AI enemies at tents that don't have enemies yet
     *
     * ⚠️ DEPRECATED: This method will be replaced by distributed spawning (AI.txt Part 1-2)
     * The new system uses chunk master election instead of distance-based spawning.
     *
     * @param {THREE.Object3D} playerObject - Player position for distance check
     * @param {boolean} isDead - Is local player dead
     */
    trySpawnAI(playerObject, isDead) {
        /* OLD CODE - COMMENTED OUT - This entire method is replaced by distributed spawning system

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

        END OF OLD CODE */

        // No-op: Distributed spawning system handles this on client-side via chunk master election
        return;
    }

    /**
     * Check if a position is in water (terrain below water level)
     * @param {number} x - X coordinate
     * @param {number} z - Z coordinate
     * @returns {boolean} - True if position is in water
     */
    isPositionInWater(x, z) {
        if (!this.terrainGenerator) return false;
        const terrainHeight = this.terrainGenerator.getWorldHeight(x, z);
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
     */
    updateTentAIEnemies(deltaTime) {
        for (const [tentId, aiData] of this.tentAIEnemies.entries()) {
            if (!aiData.isDead && aiData.controller) {
                aiData.controller.update(deltaTime);
            }
        }
    }

    /**
     * Update peer AI enemy movements
     * PERFORMANCE: Terrain height lookups throttled to every 10 frames
     * @param {number} deltaTime
     */
    updatePeerAIEnemies(deltaTime) {
        this._frameCount++;
        const shouldUpdateTerrain = (this._frameCount % this.HEIGHT_UPDATE_INTERVAL === 0);

        this.networkManager.peerGameData.forEach((peer, peerId) => {
            if (peer.aiEnemy && peer.aiEnemyTargetPosition) {
                const aiEnemy = peer.aiEnemy;

                // PERFORMANCE: Use squared distance to avoid sqrt
                const dx = peer.aiEnemyTargetPosition.x - aiEnemy.position.x;
                const dz = peer.aiEnemyTargetPosition.z - aiEnemy.position.z;
                const distSq = dx * dx + dz * dz;
                const stopThresholdSq = this.stopThreshold * this.stopThreshold;

                // Use same movement threshold as player
                if (distSq <= stopThresholdSq) {
                    // PERFORMANCE: Only check water on terrain update frames
                    if (shouldUpdateTerrain) {
                        peer.cachedTargetInWater = this.isPositionInWater(peer.aiEnemyTargetPosition.x, peer.aiEnemyTargetPosition.z);
                    }
                    if (!peer.cachedTargetInWater) {
                        aiEnemy.position.copy(peer.aiEnemyTargetPosition);
                    }
                } else {
                    const distance = Math.sqrt(distSq);

                    // Calculate next position using reusable vector (no clone!)
                    const nextPosition = this._tempVector3;
                    nextPosition.copy(aiEnemy.position);  // Copy current position to temp vector
                    // Use 2x speed when catching up to correct position desync
                    const catchUpMultiplier = peer.aiEnemyCatchingUp ? 2.0 : 1.0;
                    const moveStep = this.playerSpeed * catchUpMultiplier * deltaTime;
                    const alpha = Math.min(1, moveStep / distance);
                    nextPosition.lerp(peer.aiEnemyTargetPosition, alpha);

                    // Clear catch-up flag when close enough
                    if (distance < 0.1 && peer.aiEnemyCatchingUp) {
                        peer.aiEnemyCatchingUp = false;
                    }

                    // PERFORMANCE: Only check water on terrain update frames
                    let nextInWater = peer.cachedNextInWater || false;
                    if (shouldUpdateTerrain) {
                        nextInWater = this.isPositionInWater(nextPosition.x, nextPosition.z);
                        peer.cachedNextInWater = nextInWater;
                    }

                    // Check if next position would be in water
                    if (!nextInWater) {
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

                // PERFORMANCE: Update terrain Y only every 10 frames, lerp every frame
                if (this.terrainGenerator) {
                    if (shouldUpdateTerrain) {
                        const terrainHeight = this.terrainGenerator.getWorldHeight(aiEnemy.position.x, aiEnemy.position.z);
                        peer.cachedTerrainY = terrainHeight + 0.03;
                    }
                    if (peer.cachedTerrainY !== undefined) {
                        aiEnemy.position.y = THREE.MathUtils.lerp(aiEnemy.position.y, peer.cachedTerrainY, 0.2);
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
     * Create AI visual/entity from spawn data
     * Factory method that creates AI based on type
     * @param {object} data - Spawn data
     * @param {string} data.aiId - Unique AI ID
     * @param {string} data.aiType - Type of AI to spawn ('combat_enemy', 'bandit', 'gardener_npc', etc.)
     * @param {string} data.spawnerId - ID of the spawner structure
     * @param {Array<number>} data.position - Spawn position [x, y, z]
     * @param {boolean} data.aggro - Whether AI is aggressive
     */
    createAIVisual(data) {
        const { aiId, aiType, spawnerId, position, aggro, shirtColor, factionId } = data;

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

            case 'bandit':
                // Create bandit camp guard
                // Uses same AIEnemy class but will get bandit behavior from AIBehaviorManager
                aiController = new AIEnemy(
                    this.gameReference,
                    this.scene,
                    this.networkManager,
                    spawnPosition,
                    this.playerCollision,
                    spawnerId
                );
                // Mark as bandit type for behavior system
                if (aiController) {
                    aiController.aiType = 'bandit';
                    if (aiController.enemy) {
                        aiController.enemy.userData.aiType = 'bandit';
                    }
                }
                break;

            case 'militia':
                // Create militia - faction defender spawned by player
                // Uses same AIEnemy class but with faction-colored shirt
                aiController = new AIEnemy(
                    this.gameReference,
                    this.scene,
                    this.networkManager,
                    spawnPosition,
                    this.playerCollision,
                    spawnerId,
                    { shirtColor, entityType: 'militia', factionId }  // Pass options for shirt color
                );
                // Mark as militia type
                if (aiController) {
                    aiController.aiType = 'militia';
                    aiController.factionId = factionId;
                    if (aiController.enemy) {
                        aiController.enemy.userData.aiType = 'militia';
                        aiController.enemy.userData.factionId = factionId;
                    }
                }
                break;

            case 'gardener_npc':
                // Future implementation
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

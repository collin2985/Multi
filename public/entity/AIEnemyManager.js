/**
 * AIEnemyManager.js
 * Manages AI enemies - spawning from tents, movement updates, death tracking
 */

import * as THREE from 'three';
import { AIEnemy } from '../ai-enemy.js';
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
                return;
            }
        }

        // Also check deadTentAIs (shouldn't happen with server authority, but safety check)
        if (this.deadTentAIs.has(spawnerId)) {
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
            case 'artilleryMilitia':
            case 'outpostMilitia':
                // Create militia - faction defender spawned by player
                // artilleryMilitia/outpostMilitia use same visual but different behavior
                aiController = new AIEnemy(
                    this.gameReference,
                    this.scene,
                    this.networkManager,
                    spawnPosition,
                    this.playerCollision,
                    spawnerId,
                    { shirtColor, entityType: aiType, factionId }
                );
                // Mark with correct type
                if (aiController) {
                    aiController.aiType = aiType;
                    aiController.factionId = factionId;
                    if (aiController.enemy) {
                        aiController.enemy.userData.aiType = aiType;
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

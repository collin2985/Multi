// ==========================================
// AI ENEMY CLASS
// Handles all AI enemy behavior, animations, combat, and multiplayer ownership
// ==========================================

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { modelManager } from './objects.js';
import { CONFIG } from './config.js';

export class AIEnemy {
    constructor(game, scene, networkManager, spawnPosition) {
        this.game = game;
        this.scene = scene;
        this.networkManager = networkManager;
        this.gameState = game.gameState;

        // AI enemy 3D object (Three.js Group)
        this.enemy = new THREE.Group();
        this.enemy.position.copy(spawnPosition);
        this.scene.add(this.enemy);

        // Scale
        this.scale = 0.0325; // Same as player

        // Animation support
        this.animationMixer = null;
        this.walkAction = null;
        this.shootAction = null;

        // Movement state
        this.moving = false;
        this.speed = 0.0003; // Slightly slower than player
        this.rotationSpeed = 0.003;
        this.stopDistance = 2.5;
        this.lastRotationUpdateTime = 0;
        this.rotationUpdateInterval = 1000;
        this.targetRotation = 0;

        // Combat state
        this.lastShootTime = 0;
        this.shootInterval = 6000; // 6 seconds between shots
        this.target = null; // Current target player object
        this.lastTargetCheckTime = 0;
        this.inCombatStance = false;
        this.shootingPauseEndTime = 0;

        // Ownership tracking (for P2P control handoff)
        this.owner = this.gameState.clientId; // This client owns the AI initially
        this.lastControlCheckTime = 0;

        // Death state
        this.isDead = false;
        this.deathStartTime = 0;
        this.deathRotationProgress = 0;
        this.fallDirection = 1;

        // Load and setup the AI model
        this.setupModel();
    }

    setupModel() {
        const manGLTF = modelManager.getGLTF('man');
        if (!manGLTF) {
            console.error('Man model not loaded for AI enemy');
            return;
        }

        // Clone the man model for AI enemy
        const aiEnemyMesh = SkeletonUtils.clone(manGLTF.scene);
        aiEnemyMesh.scale.set(this.scale, this.scale, this.scale);

        // Setup materials
        aiEnemyMesh.traverse((child) => {
            if (child.isMesh || child.isSkinnedMesh) {
                child.visible = true;
                child.frustumCulled = false;  // Disable frustum culling (CPU overhead)
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

        this.enemy.add(aiEnemyMesh);

        // Setup animations
        if (manGLTF.animations && manGLTF.animations.length > 0) {
            this.animationMixer = new THREE.AnimationMixer(aiEnemyMesh);

            const walkAnimation = manGLTF.animations.find(anim =>
                anim.name.toLowerCase().includes('walk')
            );
            const shootAnimation = manGLTF.animations.find(anim =>
                anim.name.toLowerCase().includes('shoot')
            );

            if (walkAnimation) {
                this.walkAction = this.animationMixer.clipAction(walkAnimation);
                this.walkAction.play();
            }

            if (shootAnimation) {
                this.shootAction = this.animationMixer.clipAction(shootAnimation);
                this.shootAction.setLoop(THREE.LoopOnce);
                this.shootAction.clampWhenFinished = false;
            }
        }

        // Set AI enemy metadata for identification
        this.enemy.userData.objectId = 'ai_' + this.id;
        this.enemy.userData.modelType = 'ai_enemy';

        // Create physics character controller for AI
        if (this.game.physicsManager && this.game.physicsManager.initialized) {
            const aiObjectId = `ai_enemy_${Date.now()}_${Math.random()}`;
            this.enemy.userData.objectId = aiObjectId;

            // Create character controller (radius: 0.3, height: 1.0)
            this.game.physicsManager.createCharacterController(
                aiObjectId,
                0.3,  // Capsule radius
                1.0,  // Capsule height
                this.enemy.position
            );

            console.log(`[PHYSICS] Created character controller for AI at (${this.enemy.position.x.toFixed(2)}, ${this.enemy.position.y.toFixed(2)}, ${this.enemy.position.z.toFixed(2)})`);
        }

        // Broadcast AI spawn to all peers
        this.networkManager.broadcastP2P({
            type: 'ai_enemy_spawn',
            payload: {
                position: this.enemy.position.toArray(),
                moving: false
            }
        });
    }

    update(deltaTime, currentTime) {
        if (this.isDead) {
            this.updateDeathAnimation(deltaTime);
            return;
        }

        // Update animations
        if (this.animationMixer) {
            const isShootPlaying = this.shootAction && this.shootAction.isRunning();

            if (isShootPlaying) {
                // Shoot animation is playing - update at 3x speed
                this.animationMixer.update((deltaTime / 1000) * 3);
            } else if (this.inCombatStance) {
                // In combat stance: hold frame 1 of shoot animation while walking
                if (this.shootAction) {
                    this.shootAction.paused = false;
                    this.shootAction.time = 0; // Frame 1
                    this.shootAction.weight = 1.0;
                    if (!this.shootAction.isRunning()) {
                        this.shootAction.play();
                    }
                    this.shootAction.paused = true; // Freeze on frame 1
                }

                if (this.moving) {
                    // Walk animation continues (blend with frame 1 hold)
                    this.animationMixer.update((deltaTime / 1000) * 2.5);
                }
            } else {
                // Normal walk animation at 2.5x speed
                this.animationMixer.update((deltaTime / 1000) * 2.5);
            }
        }

        // Check ownership every 1 second
        if (currentTime - this.lastControlCheckTime > 1000) {
            this.checkOwnership();
            this.lastControlCheckTime = currentTime;
        }

        // Only execute AI behavior if this client is the owner
        if (this.owner !== this.gameState.clientId) {
            return;
        }

        // Find nearest target
        this.findNearestTarget();

        if (!this.target) {
            this.inCombatStance = false;
            return;
        }

        // Update movement and shooting
        this.updateMovement(deltaTime, currentTime);
        this.updateShooting(currentTime);
    }

    findNearestTarget() {
        const position = this.enemy.position;
        let nearestPlayer = null;
        let nearestDistance = Infinity;

        // Check local player (if alive)
        if (!this.game.isDead) {
            const localDist = Math.sqrt(
                Math.pow(this.game.playerObject.position.x - position.x, 2) +
                Math.pow(this.game.playerObject.position.z - position.z, 2)
            );

            if (localDist < nearestDistance) {
                nearestDistance = localDist;
                nearestPlayer = {
                    position: this.game.playerObject.position,
                    y: this.game.playerObject.position.y,
                    clientId: this.gameState.clientId,
                    isLocal: true
                };
            }
        }

        // Check all peer players (if alive)
        this.networkManager.avatars.forEach((avatar, peerId) => {
            if (!avatar.userData.isDead) {
                const peerDist = Math.sqrt(
                    Math.pow(avatar.position.x - position.x, 2) +
                    Math.pow(avatar.position.z - position.z, 2)
                );

                if (peerDist < nearestDistance) {
                    nearestDistance = peerDist;
                    nearestPlayer = {
                        position: avatar.position,
                        y: avatar.position.y,
                        clientId: peerId,
                        isLocal: false
                    };
                }
            }
        });

        this.target = nearestPlayer;
    }

    checkOwnership() {
        if (!this.target) return;

        const position = this.enemy.position;

        // Build list of all ALIVE players with their distances
        const playerDistances = [];

        // Calculate local player distance
        const localDist = Math.sqrt(
            Math.pow(this.game.playerObject.position.x - position.x, 2) +
            Math.pow(this.game.playerObject.position.z - position.z, 2)
        );

        // Add local player (only if alive)
        if (!this.game.isDead) {
            playerDistances.push({
                clientId: this.gameState.clientId,
                distance: localDist,
                isLocal: true
            });
        }

        // Add all peer players (only if alive)
        this.networkManager.avatars.forEach((avatar, peerId) => {
            if (!avatar.userData.isDead) {
                const peerDist = Math.sqrt(
                    Math.pow(avatar.position.x - position.x, 2) +
                    Math.pow(avatar.position.z - position.z, 2)
                );
                playerDistances.push({
                    clientId: peerId,
                    distance: peerDist,
                    isLocal: false
                });
            }
        });

        // Check if there are any alive players
        if (playerDistances.length === 0) {
            console.warn('No alive players for AI ownership - AI will be inactive');
            this.owner = null;
            return;
        }

        // Sort by distance, then by clientId for deterministic conflict resolution
        playerDistances.sort((a, b) => {
            if (Math.abs(a.distance - b.distance) < 0.01) {
                // Distances effectively equal, use clientId for tie-breaking
                return a.clientId.localeCompare(b.clientId);
            }
            return a.distance - b.distance;
        });

        // Closest player should control the AI
        const newOwner = playerDistances[0].clientId;

        // Check if ownership needs to change
        if (newOwner !== this.owner) {
            console.log(`AI control handoff: ${this.owner} -> ${newOwner}`);
            this.owner = newOwner;

            // Broadcast control handoff to all peers
            this.networkManager.broadcastP2P({
                type: 'ai_control_handoff',
                payload: {
                    newOwner: newOwner,
                    position: this.enemy.position.toArray(),
                    timestamp: Date.now()
                }
            });
        }
    }

    /**
     * Check if a position is in water (terrain below water level)
     * @param {number} x - X coordinate
     * @param {number} z - Z coordinate
     * @returns {boolean} - True if position is in water
     */
    isPositionInWater(x, z) {
        if (!this.game.terrainRenderer) return false;
        const terrainHeight = this.game.terrainRenderer.getHeightFast(x, z);
        return terrainHeight < CONFIG.WATER.MIN_WALKABLE_HEIGHT;
    }

    updateMovement(deltaTime, currentTime) {
        if (!this.target) return;

        const targetPos = this.target.position;
        const dx = targetPos.x - this.enemy.position.x;
        const dz = targetPos.z - this.enemy.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        // Check if within shooting range (with height advantage bonus)
        const shootingRange = this.calculateShootingRange(this.enemy.position.y, this.target.y);
        const withinShootingRange = distance <= shootingRange;

        // Set combat stance if within 15 units
        this.inCombatStance = distance <= 15;

        // Check if currently in shooting pause
        const inShootingPause = currentTime < this.shootingPauseEndTime;

        // Track previous moving state for P2P sync
        const wasMoving = this.moving;

        if (distance > this.stopDistance && !inShootingPause) {
            // Move towards target
            const moveX = (dx / distance) * this.speed * deltaTime;
            const moveZ = (dz / distance) * this.speed * deltaTime;

            // Calculate next position
            let nextX = this.enemy.position.x + moveX;
            let nextZ = this.enemy.position.z + moveZ;

            // Check if next position would be in water
            if (this.isPositionInWater(nextX, nextZ)) {
                // Stop at water's edge - clear target and stop moving
                this.target = null;
                this.moving = false;

                // Face water but don't enter
                const targetAngle = Math.atan2(dx, dz);
                this.enemy.rotation.y = targetAngle;

                console.log('[AI] Stopped at water edge, target unreachable');
                return; // Don't apply movement
            }

            // Use physics collision detection if available
            if (this.game.physicsManager && this.game.physicsManager.initialized && this.enemy.userData.objectId) {
                const movementVector = new THREE.Vector3(moveX, 0, moveZ);
                const result = this.game.physicsManager.computeCharacterMovement(
                    this.enemy.userData.objectId,
                    movementVector
                );

                // Apply collision-corrected movement
                this.enemy.position.x += result.correctedMovement.x;
                this.enemy.position.z += result.correctedMovement.z;
            } else {
                // Fallback: apply movement without collision detection
                this.enemy.position.x = nextX;
                this.enemy.position.z = nextZ;
            }

            // Update Y position based on terrain
            const terrainY = this.game.terrainRenderer.getHeightFast(
                this.enemy.position.x,
                this.enemy.position.z
            );
            this.enemy.position.y = terrainY + 0.03;

            // Smooth rotation towards target
            if (currentTime - this.lastRotationUpdateTime > this.rotationUpdateInterval) {
                this.targetRotation = Math.atan2(dx, dz);
                this.lastRotationUpdateTime = currentTime;
            }

            const currentRotation = this.enemy.rotation.y;
            let rotationDiff = this.targetRotation - currentRotation;

            while (rotationDiff > Math.PI) rotationDiff -= 2 * Math.PI;
            while (rotationDiff < -Math.PI) rotationDiff += 2 * Math.PI;

            const rotationStep = Math.sign(rotationDiff) * Math.min(Math.abs(rotationDiff), this.rotationSpeed * deltaTime);
            this.enemy.rotation.y += rotationStep;

            this.moving = true;

            // Broadcast position update only when movement state changes (start moving)
            // Like player movement, send once when starting, peers will interpolate
            if (!wasMoving) {
                this.networkManager.broadcastP2P({
                    type: 'ai_enemy_update',
                    payload: {
                        position: this.enemy.position.toArray(),
                        moving: true
                    }
                });
            }
        } else {
            this.moving = false;

            // Broadcast position update when stopping (like player_sync)
            if (wasMoving) {
                this.networkManager.broadcastP2P({
                    type: 'ai_enemy_update',
                    payload: {
                        position: this.enemy.position.toArray(),
                        moving: false
                    }
                });
            }
        }
    }

    updateShooting(currentTime) {
        if (!this.target) return;

        const dx = this.target.position.x - this.enemy.position.x;
        const dz = this.target.position.z - this.enemy.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        const shootingRange = this.calculateShootingRange(this.enemy.position.y, this.target.y);

        if (distance <= shootingRange && currentTime - this.lastShootTime > this.shootInterval) {
            this.shoot();
            this.lastShootTime = currentTime;
        }
    }

    shoot() {
        if (!this.target) return;

        // Play shoot animation
        if (this.shootAction) {
            this.shootAction.reset();
            this.shootAction.play();
        }

        // Play rifle sound
        if (this.game.audioManager) {
            this.game.audioManager.playPositionalSound('rifle', this.enemy);
        }

        // Set shooting pause (1 second)
        this.shootingPauseEndTime = performance.now() + 1000;

        // Calculate hit chance
        const hitChance = this.game.calculateHitChance(this.enemy.position.y, this.target.y);
        const isHit = Math.random() < hitChance;

        console.log(`AI shooting at ${this.target.isLocal ? 'local player' : 'peer'}! Hit chance: ${(hitChance * 100).toFixed(1)}%, Result: ${isHit ? 'HIT' : 'MISS'}`);

        // Broadcast shoot event to all peers
        this.networkManager.broadcastP2P({
            type: 'ai_enemy_shoot',
            payload: {
                isHit: isHit,
                targetIsLocalPlayer: this.target.isLocal,
                targetClientId: this.target.clientId
            }
        });

        // Apply hit if successful
        if (isHit) {
            if (this.target.isLocal) {
                this.game.killEntity(this.game.playerObject, false, false);
                console.log('Local player was killed by AI!');
            }
            // If target is peer, they will handle their own death from the broadcast
        }
    }

    calculateShootingRange(shooterY, targetY) {
        const BASE_RANGE = 10;
        const MAX_RANGE = 15;
        const heightAdvantage = shooterY - targetY;
        const bonusRange = heightAdvantage * 0.5;
        const shootingRange = Math.min(MAX_RANGE, Math.max(BASE_RANGE, BASE_RANGE + bonusRange));
        return shootingRange;
    }

    updateDeathAnimation(deltaTime) {
        const DEATH_DURATION = 500; // 0.5 seconds
        const elapsed = Date.now() - this.deathStartTime;

        if (elapsed < DEATH_DURATION) {
            const progress = elapsed / DEATH_DURATION;

            // Rotate child mesh
            if (this.enemy.children[0]) {
                this.enemy.children[0].rotation.z = (Math.PI / 2) * progress * this.fallDirection;
            }
        } else {
            // Death animation complete
            if (this.enemy.children[0]) {
                this.enemy.children[0].rotation.z = (Math.PI / 2) * this.fallDirection;
            }
        }
    }

    kill() {
        // Random fall direction: -1 for left, 1 for right
        this.fallDirection = Math.random() < 0.5 ? -1 : 1;

        this.isDead = true;
        this.deathStartTime = Date.now();
        this.deathRotationProgress = 0;

        // Stop animations
        if (this.animationMixer) {
            this.animationMixer.stopAllAction();
        }

        console.log('AI enemy killed!');

        // Broadcast death to all peers
        this.networkManager.broadcastP2P({
            type: 'ai_enemy_death',
            payload: {
                position: this.enemy.position.toArray()
            }
        });
    }

    // Static method to create peer AI enemies
    static createPeerAIEnemy() {
        const manGLTF = modelManager.getGLTF('man');
        if (!manGLTF) {
            console.error('Man model not loaded for peer AI enemy');
            return null;
        }

        // Clone the man model for peer's AI enemy
        const aiEnemyMesh = SkeletonUtils.clone(manGLTF.scene);
        const scale = 0.0325;
        aiEnemyMesh.scale.set(scale, scale, scale);

        // Setup materials
        aiEnemyMesh.traverse((child) => {
            if (child.isMesh || child.isSkinnedMesh) {
                child.visible = true;
                child.frustumCulled = false;  // Disable frustum culling (CPU overhead)
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

        const aiEnemyGroup = new THREE.Group();
        aiEnemyGroup.add(aiEnemyMesh);

        return aiEnemyGroup;
    }

    /**
     * Cleanup AI resources including physics collider
     */
    dispose() {
        // Remove physics collider
        if (this.game.physicsManager && this.enemy.userData.objectId) {
            this.game.physicsManager.removeCollider(this.enemy.userData.objectId);
            console.log(`[PHYSICS] Removed collider for AI ${this.enemy.userData.objectId}`);
        }

        // Remove from scene
        if (this.enemy && this.scene) {
            this.scene.remove(this.enemy);
        }

        // Clean up animation mixer
        if (this.animationMixer) {
            this.animationMixer.stopAllAction();
            this.animationMixer = null;
        }
    }
}

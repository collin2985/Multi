// ==========================================
// AI ENEMY CLASS
// Handles all AI enemy behavior, animations, combat, and multiplayer ownership
// ==========================================

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { modelManager } from './objects.js';
import { CONFIG } from './config.js';
import { findPath } from './navigation/AStar.js';

export class AIEnemy {
    constructor(game, scene, networkManager, spawnPosition, playerCollision = null, tentId = null) {
        this.game = game;
        this.scene = scene;
        this.networkManager = networkManager;
        this.gameState = game.gameState;
        this.tentId = tentId; // Track which tent this AI belongs to

        // AI enemy 3D object (Three.js Group)
        this.enemy = new THREE.Group();
        this.enemy.position.copy(spawnPosition);
        this.scene.add(this.enemy);

        // Scale
        this.scale = 1; // Same as player

        // Animation support
        this.animationMixer = null;
        this.walkAction = null;
        this.shootAction = null;
        this.combatAction = null;

        // Movement state
        this.moving = false;
        this.speed = 0.0003; // Base speed (slightly slower than player)
        this.rotationSpeed = 0.003;
        this.stopDistance = 2.5;
        this.lastRotationUpdateTime = 0;
        this.rotationUpdateInterval = 1000;
        this.targetRotation = 0;

        // Pathfinding state
        this.path = null;
        this.currentWaypointIndex = 0;
        this.lastPathCalcTime = 0;
        this.pathUpdateInterval = 1000; // Recalculate path every 1 second

        // Terrain speed modifier (cached for performance)
        this.cachedSpeedMultiplier = 1.0;
        this.frameCounter = 0;

        // Combat state
        // Randomize initial shoot time so AI and player don't always shoot at exactly the same moment
        this.lastShootTime = -Math.random() * 3000; // First shot between 3-6 seconds
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

            // Search for combat animation
            const combatAnimation = manGLTF.animations.find(anim =>
                anim.name.toLowerCase().includes('combat')
            );

            if (combatAnimation) {
                this.combatAction = this.animationMixer.clipAction(combatAnimation);
                this.combatAction.loop = THREE.LoopRepeat;
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
                tentId: this.tentId,  // Include tent ID to prevent duplicate spawns
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
                // Stop walk animation during combat
                if (this.walkAction && this.walkAction.isRunning()) {
                    this.walkAction.stop();
                }

                if (this.moving) {
                    // Combat movement: loop combat animation at speed 1.0
                    if (this.combatAction) {
                        this.combatAction.paused = false;
                        if (!this.combatAction.isRunning()) {
                            this.combatAction.play();
                        }
                    }
                    this.animationMixer.update((deltaTime / 1000) * 1.0);
                } else {
                    // Combat idle: freeze combat animation at frame 2
                    if (this.combatAction) {
                        this.combatAction.paused = false;
                        // Calculate time for frame 2 (assuming 24fps animation)
                        const frameTime = 2 / 24;
                        this.combatAction.time = frameTime;
                        this.combatAction.weight = 1.0;
                        if (!this.combatAction.isRunning()) {
                            this.combatAction.play();
                        }
                        this.combatAction.paused = true;
                    }
                    // No animation update for frozen pose
                }
            } else {
                // Normal state: stop combat animation and use walk
                if (this.combatAction && (this.combatAction.isRunning() || this.combatAction.paused)) {
                    this.combatAction.stop();
                    this.combatAction.reset();
                }
                // Make sure walk animation is playing
                if (this.walkAction && !this.walkAction.isRunning()) {
                    this.walkAction.play();
                }
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

        const closestPlayer = playerDistances[0];

        // HYSTERESIS CHECK - current owner keeps control unless challenger is 20% closer
        // This prevents rapid ownership toggling when players are similar distances
        const HYSTERESIS_FACTOR = 0.8; // Challenger must be 20% closer to take ownership
        const currentOwnerData = playerDistances.find(p => p.clientId === this.owner);

        if (currentOwnerData && closestPlayer.clientId !== this.owner) {
            const threshold = currentOwnerData.distance * HYSTERESIS_FACTOR;
            if (closestPlayer.distance >= threshold) {
                // Challenger is not significantly closer - keep current owner
                return;
            }
        }

        // Check if ownership needs to change
        if (closestPlayer.clientId !== this.owner) {
            console.log(`AI control handoff: ${this.owner} -> ${closestPlayer.clientId}`);
            this.owner = closestPlayer.clientId;

            // Broadcast control handoff to all peers
            this.networkManager.broadcastP2P({
                type: 'ai_control_handoff',
                payload: {
                    newOwner: closestPlayer.clientId,
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
        const distanceSquared = dx * dx + dz * dz;
        const distanceToTarget = Math.sqrt(distanceSquared);

        // Check if within shooting range (with height advantage bonus)
        const shootingRange = this.calculateShootingRange(this.enemy.position.y, this.target.y);
        const shootingRangeSquared = shootingRange * shootingRange;
        const withinShootingRange = distanceSquared <= shootingRangeSquared;

        // Set combat stance if within 15 units
        const combatDistanceSquared = 15 * 15;  // 225
        this.inCombatStance = distanceSquared <= combatDistanceSquared;

        // Check if currently in shooting pause
        const inShootingPause = currentTime < this.shootingPauseEndTime;

        // Track previous moving state for P2P sync
        const wasMoving = this.moving;

        // Recalculate path periodically
        if (currentTime - this.lastPathCalcTime > this.pathUpdateInterval) {
            const navManager = this.game.navigationManager;
            if (navManager) {
                // Use NavigationManager directly for cross-chunk pathfinding
                this.path = findPath(
                    navManager,
                    this.enemy.position.x,
                    this.enemy.position.z,
                    targetPos.x,
                    targetPos.z
                );

                // Handle pathfinding result
                if (!this.path || this.path.length === 0) {
                    // No path found - AI stops and waits before retrying
                    this.pathUpdateInterval = 2000;
                    console.log('[AI] No path found, waiting 2s before retry');
                } else {
                    // Path found successfully - use normal update rate
                    this.pathUpdateInterval = 1000;
                }

                this.currentWaypointIndex = 0;
            }
            this.lastPathCalcTime = currentTime;
        }

        if (distanceToTarget > this.stopDistance && !inShootingPause) {
            // Update terrain speed modifier (cached for performance - every 5 frames)
            this.frameCounter++;
            if (this.frameCounter % 5 === 0 && this.game.navigationManager) {
                this.cachedSpeedMultiplier = this.game.navigationManager.getMovementSpeedMultiplier(
                    this.enemy.position.x,
                    this.enemy.position.z
                );
            }

            // Determine movement direction - use waypoint if path exists, otherwise fall back to direct
            let moveDx, moveDz;

            if (this.path && this.currentWaypointIndex < this.path.length) {
                // Move toward current waypoint
                const waypoint = this.path[this.currentWaypointIndex];
                moveDx = waypoint.x - this.enemy.position.x;
                moveDz = waypoint.z - this.enemy.position.z;
                const distToWaypoint = Math.sqrt(moveDx * moveDx + moveDz * moveDz);

                // Check if reached waypoint
                if (distToWaypoint < 0.5) {
                    this.currentWaypointIndex++;
                    // Recalculate movement for next waypoint
                    if (this.currentWaypointIndex < this.path.length) {
                        const nextWaypoint = this.path[this.currentWaypointIndex];
                        moveDx = nextWaypoint.x - this.enemy.position.x;
                        moveDz = nextWaypoint.z - this.enemy.position.z;
                    } else {
                        // Reached end of path, move directly to target
                        moveDx = dx;
                        moveDz = dz;
                    }
                }
            } else {
                // No path available, fall back to direct movement
                moveDx = dx;
                moveDz = dz;
            }

            // Normalize movement direction
            const moveDistance = Math.sqrt(moveDx * moveDx + moveDz * moveDz);
            if (moveDistance < 0.01) {
                this.moving = false;
                return;
            }

            // Move with terrain speed modifier
            const actualSpeed = this.speed * this.cachedSpeedMultiplier;
            const moveX = (moveDx / moveDistance) * actualSpeed * deltaTime;
            const moveZ = (moveDz / moveDistance) * actualSpeed * deltaTime;

            // Calculate next position
            let nextX = this.enemy.position.x + moveX;
            let nextZ = this.enemy.position.z + moveZ;

            // Check if next position would be in water
            if (this.isPositionInWater(nextX, nextZ)) {
                // Stop at water's edge - clear target and stop moving
                this.target = null;
                this.moving = false;
                this.path = null;

                // Face water but don't enter
                const targetAngle = Math.atan2(moveDx, moveDz);
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

            // Smooth rotation towards movement direction
            if (currentTime - this.lastRotationUpdateTime > this.rotationUpdateInterval) {
                this.targetRotation = Math.atan2(moveDx, moveDz);
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
        const distanceSquared = dx * dx + dz * dz;  // PERFORMANCE: No Math.sqrt() for comparison

        const shootingRange = this.calculateShootingRange(this.enemy.position.y, this.target.y);
        const shootingRangeSquared = shootingRange * shootingRange;

        if (distanceSquared <= shootingRangeSquared && currentTime - this.lastShootTime > this.shootInterval) {
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
        this.shootingPauseEndTime = Date.now() + 1000;

        // Calculate hit chance
        const hitChance = this.calculateHitChance(this.enemy.position.y, this.target.position.y);
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

    calculateHitChance(shooterY, targetY) {
        // Base hit chance is 20%
        const BASE_HIT_CHANCE = 0.2;
        const MAX_HIT_CHANCE = 0.8;

        // Height advantage (positive if shooter is above target)
        const heightAdvantage = shooterY - targetY;

        // Only apply bonus for height advantage (being higher improves accuracy)
        // Being lower doesn't penalize base accuracy
        const bonusChance = Math.max(0, heightAdvantage * 0.2);

        // Calculate final hit chance (capped at 80%)
        const hitChance = Math.min(MAX_HIT_CHANCE, BASE_HIT_CHANCE + bonusChance);

        return hitChance;
    }

    updateDeathAnimation(deltaTime) {
        const DEATH_DURATION = 500; // 0.5 seconds
        const elapsed = Date.now() - this.deathStartTime;

        if (elapsed < DEATH_DURATION) {
            const progress = elapsed / DEATH_DURATION;

            // Rotate to fall along world X axis (east/west)
            // Compensate for entity's Y rotation
            if (this.enemy.children[0]) {
                const yRot = this.enemy.rotation.y;
                const angle = (Math.PI / 2) * progress * this.fallDirection;
                this.enemy.children[0].rotation.x = angle * Math.sin(yRot);
                this.enemy.children[0].rotation.z = angle * Math.cos(yRot);
            }
        } else {
            // Death animation complete
            if (this.enemy.children[0]) {
                const yRot = this.enemy.rotation.y;
                const angle = (Math.PI / 2) * this.fallDirection;
                this.enemy.children[0].rotation.x = angle * Math.sin(yRot);
                this.enemy.children[0].rotation.z = angle * Math.cos(yRot);
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

        // Broadcast death to all peers (include tentId for sync)
        this.networkManager.broadcastP2P({
            type: 'ai_enemy_death',
            payload: {
                tentId: this.tentId,
                position: this.enemy.position.toArray()
            }
        });

        // Notify server for server-authoritative spawner system
        // This allows the server to track death and apply respawn cooldowns
        if (this.tentId) {
            this.networkManager.sendMessage('ai_death', {
                aiId: this.aiId || `ai_${this.tentId}`,
                spawnerId: this.tentId
            });
        }
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
        const scale = 1;
        aiEnemyMesh.scale.set(scale, scale, scale);

        // Setup materials
        aiEnemyMesh.traverse((child) => {
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

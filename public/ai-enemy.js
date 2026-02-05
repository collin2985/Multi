// ==========================================
// AI ENEMY CLASS - Visual Controller
// Handles AI visual representation, animations, and death effects
// Behavior logic is managed by distributed AISystem/AIStateMachine
// ==========================================

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { modelManager, applyEuclideanFog } from './objects.js';
import { MuzzleFlash } from './effects/MuzzleFlash.js';
import { CONFIG } from './config.js';

// PERFORMANCE: Shared rifle material (created once, reused for all AI instances)
let _sharedRifleMaterial = null;
function getSharedRifleMaterial() {
    if (!_sharedRifleMaterial) {
        _sharedRifleMaterial = new THREE.MeshStandardMaterial({
            color: 0x000000,
            metalness: 0.7,
            roughness: 0.3
        });
        applyEuclideanFog(_sharedRifleMaterial);
    }
    return _sharedRifleMaterial;
}

export class AIEnemy {
    constructor(game, scene, networkManager, spawnPosition, playerCollision = null, tentId = null, options = {}) {
        this.game = game;
        this.scene = scene;
        this.networkManager = networkManager;
        this.gameState = game.gameState;
        this.tentId = tentId; // Track which tent this AI belongs to
        this.options = options; // Options: { shirtColor, entityType, factionId }

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

        // Animation state (set by distributed AISystem)
        this.moving = false;
        this.inCombatStance = false;
        this.speedMultiplier = 1.0; // Animation speed multiplier (can be set by BanditController)
        this._combatIdlePoseSet = false; // Track if combat idle pose is already applied

        // Ownership tracking (managed by distributed AISystem)
        this.owner = this.gameState.clientId;

        // Death state
        this.isDead = false;
        this.deathStartTime = 0;
        this.deathRotationProgress = 0;
        this.fallDirection = 1;

        // Load and setup the AI model
        this.setupModel();
    }

    setupModel() {
        const cloneSource = modelManager.getCloneSource('man');
        const manGLTF = modelManager.getGLTF('man'); // Need GLTF for animations
        if (!cloneSource || !manGLTF) {
            console.error('Man model not loaded for AI enemy');
            return;
        }

        // Clone from pristine source to avoid inheriting animation poses from main player
        const aiEnemyMesh = SkeletonUtils.clone(cloneSource);
        aiEnemyMesh.scale.set(this.scale, this.scale, this.scale);

        // PERFORMANCE: Single-pass traverse - setup materials AND find hand bone in one traversal
        // Previously this was 2 separate traverse() calls
        const shirtColor = this.options?.shirtColor || CONFIG.FACTION_COLORS.default?.shirt || 0x5a5a5a;
        let handBone = null;

        aiEnemyMesh.traverse((child) => {
            // Find hand bone (Bone014) for rifle attachment
            if (child.isBone && child.name === 'Bone014') {
                handBone = child;
            }

            // Setup mesh materials
            if (child.isMesh || child.isSkinnedMesh) {
                child.visible = true;
                child.frustumCulled = true;  // PERFORMANCE: Enable frustum culling
                child.renderOrder = 1;

                if (child.material) {
                    child.material.depthWrite = true;
                    child.material.depthTest = true;

                    if (child.material.type === 'MeshStandardMaterial') {
                        applyEuclideanFog(child.material);
                        child.material.needsUpdate = true;
                    }
                }

                // Color the shirt (Cube001_3 is the shirt mesh)
                // Bandits: dark brown, Militia: faction color
                if (child.name === 'Cube001_3' && child.material) {
                    child.material = child.material.clone();
                    child.material.color.setHex(shirtColor);
                    applyEuclideanFog(child.material);
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

        // Attach rifle to AI's hand (using handBone found during single-pass traverse)
        const rifleModel = modelManager.getModel('rifle');
        if (rifleModel && handBone) {
            const rifleMesh = rifleModel.clone();

            // Set rifle position, scale, and rotation (finalized values)
            rifleMesh.position.set(0.33, 1.8, 0.33);
            rifleMesh.scale.set(21.4, 23.9, 14);
            rifleMesh.rotation.set(-1.26, -0.02, 0.82);

            // PERFORMANCE: Use shared rifle material instead of creating new one per AI
            const sharedMaterial = getSharedRifleMaterial();
            rifleMesh.traverse((child) => {
                if (child.isMesh) {
                    child.material = sharedMaterial;
                }
            });

            // Attach rifle to hand bone
            handBone.add(rifleMesh);
            this.rifle = rifleMesh;

            // Create muzzle flash effect
            this.muzzleFlash = new MuzzleFlash();
            this.muzzleFlash.attachTo(rifleMesh);

        } else if (rifleModel && !handBone) {
            console.warn('[AI] Could not find Bone014 for rifle attachment');
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
        }

        // Note: Spawn broadcast handled by distributed AISystem
    }

    update(deltaTime) {
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
                // Show rifle in combat stance
                if (this.rifle) {
                    this.rifle.visible = true;
                }

                // Stop walk animation during combat
                if (this.walkAction && this.walkAction.isRunning()) {
                    this.walkAction.stop();
                }

                if (this.moving) {
                    // Combat movement: loop combat animation, scaled with movement speed
                    this._combatIdlePoseSet = false; // Clear idle pose flag when moving
                    if (this.combatAction) {
                        this.combatAction.paused = false;
                        if (!this.combatAction.isRunning()) {
                            this.combatAction.play();
                        }
                    }
                    // Base walk animation speed increased by 25%
                    this.animationMixer.update((deltaTime / 1000) * this.speedMultiplier * 1.25);
                } else {
                    // Combat idle: freeze combat animation at frame 2
                    // Only set pose once, skip redundant work on subsequent frames
                    if (this.combatAction && !this._combatIdlePoseSet) {
                        // Reset to ensure clean frame positioning
                        this.combatAction.reset();
                        // Calculate time for frame 2 (assuming 24fps animation)
                        const frameTime = 2 / 24;
                        this.combatAction.time = frameTime;
                        this.combatAction.weight = 1.0;
                        this.combatAction.play();
                        this.combatAction.paused = true;
                        // Update mixer once to apply the pose (prevents T-pose)
                        this.animationMixer.update(0.001);
                        this._combatIdlePoseSet = true;
                    }
                    // No animation update for frozen pose
                }
            } else {
                // Hide rifle when not in combat
                if (this.rifle) {
                    this.rifle.visible = false;
                }

                // Clear combat idle pose flag when leaving combat stance
                this._combatIdlePoseSet = false;

                // Normal state: stop combat animation and use walk
                if (this.combatAction && (this.combatAction.isRunning() || this.combatAction.paused)) {
                    this.combatAction.stop();
                    this.combatAction.reset();
                }

                if (this.moving) {
                    // Clear idle pose flag when starting to move
                    this._walkIdlePoseSet = false;

                    // Make sure walk animation is playing when moving
                    if (this.walkAction && (!this.walkAction.isRunning() || this.walkAction.paused)) {
                        this.walkAction.reset();
                        this.walkAction.play();
                        this.walkAction.paused = false;
                    }
                    // Walk animation scaled with movement speed
                    // Base walk animation speed increased by 25%
                    this.animationMixer.update((deltaTime / 1000) * this.speedMultiplier * 1.25);
                } else {
                    // Idle - freeze on first walk frame
                    // Only set pose once, skip redundant work on subsequent frames
                    if (this.walkAction && !this._walkIdlePoseSet) {
                        this.walkAction.reset();
                        this.walkAction.play();
                        this.walkAction.paused = true;
                        this.walkAction.time = 0.033;  // First frame
                        this.animationMixer.update(0.001);
                        this._walkIdlePoseSet = true;
                    }
                }
            }
        }

        // Note: All behavior (target finding, movement, shooting) is now handled
        // by the distributed AISystem. This class only manages visual/animation state.
    }

    /**
     * Play shoot animation and muzzle flash
     * Called by BanditController when this AI attacks
     */
    playShootAnimation() {
        // Force rifle visible for muzzle flash (in case visual update hasn't run yet)
        if (this.rifle) {
            this.rifle.visible = true;
        }
        if (this.shootAction) {
            this.shootAction.reset();
            this.shootAction.play();
        }
        if (this.muzzleFlash) {
            this.muzzleFlash.flash();
            // Spawn gunsmoke at barrel position
            if (this.game.effectManager) {
                const barrelPos = new THREE.Vector3();
                this.muzzleFlash.sprite.getWorldPosition(barrelPos);
                this.game.effectManager.spawnGunSmoke(barrelPos);
            }
        }
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

    /**
     * Trigger death animation
     * Called by AISystem when this AI dies
     * Note: P2P broadcast and server notification handled by distributed system
     */
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
    }

    /**
     * Cleanup AI resources including physics collider
     */
    dispose() {
        // Remove physics collider
        if (this.game.physicsManager && this.enemy.userData.objectId) {
            this.game.physicsManager.removeCollider(this.enemy.userData.objectId);
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

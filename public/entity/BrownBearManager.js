/**
 * BrownBearManager.js
 * Manages brown bear visual creation from bearden structures
 * Uses flag-based animation pattern (like AIEnemy/bandits)
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { applyEuclideanFog } from '../objects.js';

/**
 * BrownBearVisual - Visual controller for a single brown bear
 * Handles animations based on state flags set by controller
 */
class BrownBearVisual {
    constructor(scene, mesh, mixer, animations) {
        this.scene = scene;
        this.mesh = mesh;
        this.mixer = mixer;

        // Animation state flags (set by controller)
        this.moving = false;
        this.isWandering = false;
        this.isAttacking = false;
        this.speedMultiplier = 1.5;
        this.speedRatio = 1.0;  // 0 = turning in place, 1 = full speed

        // Death state
        this.isDead = false;
        this.deathStartTime = 0;
        this.fallDirection = 1;

        // Setup animation actions
        this.walkAction = null;
        this.runAction = null;
        this.attackAction = null;

        for (const clip of animations) {
            const name = clip.name.toLowerCase();
            const action = mixer.clipAction(clip);

            if (name.includes('walk')) {
                this.walkAction = action;
                this.walkAction.setLoop(THREE.LoopRepeat);
            } else if (name.includes('run')) {
                this.runAction = action;
                this.runAction.setLoop(THREE.LoopRepeat);
            } else if (name.includes('attack')) {
                this.attackAction = action;
                this.attackAction.setLoop(THREE.LoopOnce);
                this.attackAction.clampWhenFinished = true;
                this.attackAction.timeScale = 0.5;  // Half speed (2x duration)
            }
        }

        // Start in idle pose (frozen walk frame)
        if (this.walkAction) {
            this.walkAction.play();
            this.walkAction.paused = true;
            this.walkAction.time = 0.033;
            this.mixer.update(0.001);
        }
    }

    /**
     * Update animations based on state flags
     * Called every frame by the game loop
     */
    update(deltaTime) {
        if (this.isDead) {
            this.updateDeathAnimation(deltaTime);
            return;
        }

        if (!this.mixer) return;

        const isAttackPlaying = this.attackAction && this.attackAction.isRunning() && !this.attackAction.paused;

        if (isAttackPlaying) {
            // Attack animation is playing - let it complete
            this.mixer.update(deltaTime / 1000);
        } else if (this.isAttacking) {
            // In attack state but animation not playing - play attack
            if (this.attackAction) {
                // Stop other animations
                if (this.walkAction) this.walkAction.stop();
                if (this.runAction) this.runAction.stop();

                this.attackAction.reset();
                this.attackAction.play();
                this.mixer.update(deltaTime / 1000);
            }
        } else if (this.moving) {
            // Turning in place (speedRatio === 0) - use slow walk animation
            if (this.speedRatio === 0 && this.walkAction) {
                if (this.runAction?.isRunning()) this.runAction.stop();
                if (this.attackAction?.isRunning()) this.attackAction.stop();
                if (!this.walkAction.isRunning() || this.walkAction.paused) {
                    this.walkAction.reset();
                    this.walkAction.play();
                    this.walkAction.paused = false;
                }
                this.mixer.update((deltaTime / 1000) * this.speedMultiplier * 0.5);
            } else if (this.isWandering && this.walkAction) {
                // Wandering/returning - use walk animation
                if (this.runAction?.isRunning()) this.runAction.stop();
                if (this.attackAction?.isRunning()) this.attackAction.stop();
                if (!this.walkAction.isRunning() || this.walkAction.paused) {
                    this.walkAction.reset();
                    this.walkAction.play();
                    this.walkAction.paused = false;
                }
                this.mixer.update((deltaTime / 1000) * this.speedMultiplier);
            } else if (this.runAction) {
                // Chasing - use run animation, scaled by speedRatio
                if (!this.runAction.isRunning()) {
                    if (this.walkAction) this.walkAction.stop();
                    if (this.attackAction) this.attackAction.stop();
                    this.runAction.reset();
                    this.runAction.play();
                }
                // Scale animation speed by movement ratio (min 0.3 to avoid frozen look)
                const animSpeed = Math.max(0.3, this.speedRatio);
                this.mixer.update((deltaTime / 1000) * this.speedMultiplier * animSpeed * 1.2);
            } else if (this.walkAction) {
                // Fallback to walk if no run animation
                if (!this.walkAction.isRunning() || this.walkAction.paused) {
                    if (this.attackAction) this.attackAction.stop();
                    this.walkAction.reset();
                    this.walkAction.play();
                    this.walkAction.paused = false;
                }
                this.mixer.update((deltaTime / 1000) * this.speedMultiplier);
            }
        } else {
            // Idle - freeze on walk frame
            if (this.runAction && this.runAction.isRunning()) {
                this.runAction.stop();
            }
            if (this.attackAction && this.attackAction.isRunning()) {
                this.attackAction.stop();
            }

            if (this.walkAction) {
                if (!this.walkAction.isRunning()) {
                    this.walkAction.reset();
                    this.walkAction.play();
                }
                this.walkAction.paused = true;
                this.walkAction.time = 0.033;
                this.mixer.update(0.001);
            }
        }
    }

    /**
     * Play attack animation
     * Called by controller when bear attacks
     */
    playAttackAnimation() {
        if (this.attackAction) {
            if (this.walkAction) this.walkAction.stop();
            if (this.runAction) this.runAction.stop();
            this.attackAction.reset();
            this.attackAction.play();
        }
    }

    /**
     * Check if attack animation is currently playing
     * Used by controller to wait for animation to complete
     */
    isAttackAnimationPlaying() {
        return this.attackAction && this.attackAction.isRunning() && !this.attackAction.paused;
    }

    /**
     * Trigger death state
     */
    kill() {
        this.isDead = true;
        this.deathStartTime = Date.now();
        this.fallDirection = Math.random() < 0.5 ? -1 : 1;

        if (this.mixer) {
            this.mixer.stopAllAction();
        }
    }

    /**
     * Update death animation (fall over)
     */
    updateDeathAnimation(deltaTime) {
        const DEATH_DURATION = 500;
        const elapsed = Date.now() - this.deathStartTime;

        if (this.mesh && this.mesh.children[0]) {
            const progress = Math.min(elapsed / DEATH_DURATION, 1);
            const angle = (Math.PI / 2) * progress * this.fallDirection;
            this.mesh.children[0].rotation.z = angle;
        }
    }

    /**
     * Cleanup resources
     */
    dispose() {
        if (this.mixer) {
            this.mixer.stopAllAction();
            this.mixer = null;
        }
        if (this.mesh && this.scene) {
            this.scene.remove(this.mesh);
        }
    }
}

export class BrownBearManager {
    constructor(scene) {
        this.scene = scene;

        // Visuals
        this.visuals = new Map();  // denId -> BrownBearVisual

        // Model cache
        this.modelLoaded = false;
        this.modelTemplate = null;
        this.animations = null;
        this.pendingSpawns = [];

        // Controller reference
        this.controller = null;

        this._loadModel();
    }

    setController(controller) {
        this.controller = controller;
    }

    async _loadModel() {
        const loader = new GLTFLoader();

        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
        loader.setDRACOLoader(dracoLoader);

        try {
            const gltf = await loader.loadAsync('./models/brownbear.glb');

            this.modelTemplate = gltf.scene;
            this.animations = gltf.animations;
            this.modelLoaded = true;

            // Process pending spawns
            for (const spawn of this.pendingSpawns) {
                if (!this.controller) continue;

                const entity = this.controller.entities.get(spawn.denId);
                if (!entity) {
                    // Spawn was aborted, skip to avoid orphaned mesh
                    continue;
                }

                // Skip if entity already has a controller (from a successful retry)
                if (entity.controller) {
                    continue;
                }

                const visual = this._createVisualInternal(spawn.denId, spawn.position);
                if (visual) {
                    entity.mesh = visual.mesh;
                    entity.controller = visual;

                    // Sync animation flags based on current entity state
                    this.controller._syncVisualFlags(entity);

                    // Register name tag now that mesh exists
                    const game = this.controller.game;
                    if (game?.nameTagManager && entity.mesh) {
                        game.nameTagManager.registerEntity(`brownbear_${spawn.denId}`, 'Brown Bear', entity.mesh);
                        // If entity died before model loaded, update nametag to show (DEAD)
                        if (entity.state === 'dead') {
                            game.nameTagManager.setEntityDead(`brownbear_${spawn.denId}`);
                        }
                    }

                    // Check for pending deaths that arrived before model loaded
                    this.controller._checkPendingDeaths(spawn.denId);
                }
            }
            this.pendingSpawns = [];

        } catch (err) {
            console.error('[BrownBearManager] Failed to load brownbear.glb:', err);
        }
    }

    createVisual(denId, position) {
        if (!this.modelLoaded) {
            console.warn(`[BrownBearManager] Model not loaded, queuing spawn for den ${denId}`);
            this.pendingSpawns.push({ denId, position: { ...position } });
            return null;
        }

        return this._createVisualInternal(denId, position);
    }

    _createVisualInternal(denId, position) {
        const mesh = SkeletonUtils.clone(this.modelTemplate);

        mesh.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                child.frustumCulled = true;
                if (child.material) {
                    child.material = child.material.clone();
                    applyEuclideanFog(child.material);
                }
            }
        });

        mesh.position.set(position.x, position.y, position.z);
        mesh.scale.set(0.1, 0.1, 0.1);

        this.scene.add(mesh);

        // Setup animation mixer
        const mixer = new THREE.AnimationMixer(mesh);

        // Create visual controller
        const visual = new BrownBearVisual(this.scene, mesh, mixer, this.animations);
        this.visuals.set(denId, visual);

        return visual;
    }

    destroyVisual(denId) {
        const visual = this.visuals.get(denId);
        if (visual) {
            visual.dispose();

            // Dispose geometry and materials
            if (visual.mesh) {
                visual.mesh.traverse((child) => {
                    if (child.isMesh) {
                        if (child.geometry) child.geometry.dispose();
                        if (child.material) {
                            if (Array.isArray(child.material)) {
                                child.material.forEach(m => m.dispose());
                            } else {
                                child.material.dispose();
                            }
                        }
                    }
                });
            }

            this.visuals.delete(denId);
        }
    }

    /**
     * Update all visuals (call from game loop)
     */
    update(deltaTime) {
        for (const [denId, visual] of this.visuals) {
            visual.update(deltaTime);
        }
    }

    dispose() {
        for (const [denId, visual] of this.visuals) {
            this.destroyVisual(denId);
        }
        this.visuals.clear();
    }
}

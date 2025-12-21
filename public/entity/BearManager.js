/**
 * BearManager.js
 * Manages bear spawning/despawning per chunk and visual creation
 *
 * Integration:
 * - GameInitializer.js: initialize BearController
 * - ChunkManager.js or game.js: call spawnForChunk/despawnForChunk on chunk load/unload
 * - GameStateManager.js: P2P message handlers for bear_spawn, bear_state
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export class BearManager {
    constructor(scene, terrainGenerator) {
        this.scene = scene;
        this.terrainGenerator = terrainGenerator;

        // Bear visuals
        this.bearMeshes = new Map();  // chunkKey -> { mesh, mixer, animations }

        // Model cache
        this.modelLoaded = false;
        this.modelTemplate = null;
        this.animations = null;
        this.pendingSpawns = [];  // Queue spawns until model loads

        // Controller reference (set via setController)
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
            const gltf = await loader.loadAsync('./models/bear.glb');

            this.modelTemplate = gltf.scene;
            this.animations = gltf.animations;
            this.modelLoaded = true;

            // Process pending spawns and update controller entities
            for (const spawn of this.pendingSpawns) {
                const visual = this._createVisualInternal(spawn.chunkKey, spawn.position);
                // Update the controller's entity with the mesh reference
                if (visual && this.controller) {
                    const entity = this.controller.entities.get(spawn.chunkKey);
                    if (entity) {
                        entity.mesh = visual.mesh || visual;
                        entity.mixer = visual.mixer || null;
                        entity.playAnimation = visual.playAnimation || null;

                        // Set up attack animation finished callback
                        if (visual.setOnAttackFinished) {
                            visual.setOnAttackFinished(() => {
                                this.controller._onAttackAnimationFinished(entity);
                            });
                        }

                        this.controller._updateAnimation(entity);

                        // Register name tag now that mesh exists
                        const game = this.controller.game;
                        if (game?.nameTagManager && entity.mesh) {
                            game.nameTagManager.registerEntity(`bear_${spawn.chunkKey}`, 'Bear', entity.mesh);
                            // If entity died before model loaded, update nametag to show (DEAD)
                            if (entity.isDead) {
                                game.nameTagManager.setEntityDead(`bear_${spawn.chunkKey}`);
                            }
                        }
                    }
                }
            }
            this.pendingSpawns = [];

        } catch (err) {
            console.error('[BearManager] Failed to load bear.glb:', err);
        }
    }

    /**
     * Create visual for a bear (called by BearController)
     */
    createVisual(chunkKey, position) {
        if (!this.modelLoaded) {
            this.pendingSpawns.push({ chunkKey, position: { ...position } });
            return null;
        }

        return this._createVisualInternal(chunkKey, position);
    }

    _createVisualInternal(chunkKey, position) {
        // Clone the model (must use SkeletonUtils for animated/skinned models)
        const mesh = SkeletonUtils.clone(this.modelTemplate);

        // Setup materials for cloned mesh
        mesh.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                // Clone material to avoid shared state
                if (child.material) {
                    child.material = child.material.clone();
                }
            }
        });

        // Position
        mesh.position.set(position.x, position.y, position.z);

        // Scale (adjust as needed for your model)
        mesh.scale.set(0.1275, 0.1275, 0.1275);

        // Apply dark brown tint to materials
        
        mesh.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material.color.setRGB(0.35, 0.2, 0.1);
            }
        });

        // Add to scene
        this.scene.add(mesh);

        // Setup animation mixer
        const mixer = new THREE.AnimationMixer(mesh);
        const actions = {};

        for (const clip of this.animations) {
            const action = mixer.clipAction(clip);
            actions[clip.name.toLowerCase()] = action;

            // Configure attack animation to play once and hold final pose
            if (clip.name.toLowerCase() === 'attack') {
                action.loop = THREE.LoopOnce;
                action.clampWhenFinished = true;
            }
        }

        // Track currently playing animation
        let currentAnimation = null;

        // Callback for when attack animation finishes
        let onAttackFinished = null;

        // Listen for animation finished events
        mixer.addEventListener('finished', (e) => {
            const finishedAction = e.action;
            // Check if this was the attack animation
            if (finishedAction === actions['attack'] && onAttackFinished) {
                onAttackFinished();
            }
        });

        // Helper to play animation
        const playAnimation = (name, timeScale = 1.0) => {
            const action = actions[name.toLowerCase()];
            if (!action) {
                console.warn(`[BearManager] Animation "${name}" not found`);
                return;
            }

            // Skip if same animation already playing and still running
            // Allow replay if animation finished (clamped) or is paused/frozen
            const isStillRunning = action.isRunning() && !action.paused;
            if (currentAnimation === name.toLowerCase() && timeScale !== 0 && isStillRunning) {
                return;
            }

            // Stop all other actions
            for (const a of Object.values(actions)) {
                if (a !== action) {
                    a.fadeOut(0.2);
                }
            }

            action.reset();
            action.setEffectiveTimeScale(timeScale);
            action.setEffectiveWeight(1);
            action.fadeIn(0.2);
            action.play();

            currentAnimation = name.toLowerCase();

            // If timeScale is 0, pause at frame 1
            if (timeScale === 0) {
                action.paused = true;
                action.time = 0.033;  // ~1 frame at 30fps
            }
        };

        // Helper to set attack finished callback
        const setOnAttackFinished = (callback) => {
            onAttackFinished = callback;
        };

        // Start with idle (frozen walk)
        playAnimation('walk', 0);

        const visual = {
            mesh,
            mixer,
            actions,
            playAnimation,
            setOnAttackFinished,
        };

        this.bearMeshes.set(chunkKey, visual);

        return visual;
    }

    /**
     * Destroy visual for a bear (called by BearController)
     */
    destroyVisual(chunkKey, mesh) {
        const visual = this.bearMeshes.get(chunkKey);
        if (visual) {
            // Stop all animations
            if (visual.mixer) {
                visual.mixer.stopAllAction();
            }

            // Remove from scene
            this.scene.remove(visual.mesh);

            // Dispose geometry, materials, and textures
            visual.mesh.traverse((child) => {
                if (child.isMesh) {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        const materials = Array.isArray(child.material) ? child.material : [child.material];
                        for (const mat of materials) {
                            // Dispose textures
                            if (mat.map) mat.map.dispose();
                            if (mat.normalMap) mat.normalMap.dispose();
                            if (mat.roughnessMap) mat.roughnessMap.dispose();
                            if (mat.metalnessMap) mat.metalnessMap.dispose();
                            if (mat.aoMap) mat.aoMap.dispose();
                            if (mat.emissiveMap) mat.emissiveMap.dispose();
                            mat.dispose();
                        }
                    }
                }
            });

            this.bearMeshes.delete(chunkKey);
        }
    }

    /**
     * Update all animation mixers
     */
    update(deltaTime) {
        // Animation updates are handled by BearController calling mixer.update
        // This method is here if we need global updates
    }

    /**
     * Get bear visual by chunk key
     */
    getVisual(chunkKey) {
        return this.bearMeshes.get(chunkKey) || null;
    }

    /**
     * Dispose all bears
     */
    dispose() {
        for (const [chunkKey, visual] of this.bearMeshes) {
            this.destroyVisual(chunkKey, visual.mesh);
        }
        this.bearMeshes.clear();
    }
}

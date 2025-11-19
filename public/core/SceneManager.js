/**
 * SceneManager.js
 * Manages THREE.js scene, camera, renderer, lighting, and skybox
 */

import * as THREE from 'three';
import { SkyboxManager } from '../world/SkyboxManager.js';
import { CONFIG } from '../config.js';

export class SceneManager {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.sunLight = null;
        this.skyLight = null;
        this.skyboxManager = null;
        this.lastTime = 0;
    }

    /**
     * Initialize the scene, camera, renderer, lighting, and skybox
     * @returns {Promise<void>}
     */
    async initialize() {
        // Create scene
        this.scene = new THREE.Scene();

        // Create camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            1.0,
            200  // Optimized for skybox at 141 units + safety margin
        );

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x000011);

        // Renderer settings for softer, more cinematic appearance
        if (CONFIG.RENDERING.TONE_MAPPING) {
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = CONFIG.RENDERING.TONE_MAPPING_EXPOSURE;
        }

        document.body.appendChild(this.renderer.domElement);

        // Setup fog
        this.setupFog();

        // Setup lighting
        this.setupLighting();

        // Setup skybox and await its loading
        await this.setupSkybox();
    }

    /**
     * Setup atmospheric fog
     * @private
     */
    setupFog() {
        if (CONFIG.RENDERING.FOG_ENABLED && !CONFIG.DEBUG.DISABLE_FOG) {
            // Exponential fog for atmospheric haze
            this.scene.fog = new THREE.FogExp2(
                CONFIG.RENDERING.FOG_COLOR,
                CONFIG.RENDERING.FOG_DENSITY
            );
        }
    }

    /**
     * Setup scene lighting with warm/cool contrast
     * @private
     */
    setupLighting() {
        // Hemisphere light for ambient sky/ground lighting (cool sky, warm ground)
        this.skyLight = new THREE.HemisphereLight(
            CONFIG.LIGHTING.SKY_COLOR,
            CONFIG.LIGHTING.GROUND_COLOR,
            CONFIG.LIGHTING.SKY_INTENSITY
        );
        this.scene.add(this.skyLight);

        // Main directional sun light (warm)
        this.sunLight = new THREE.DirectionalLight(
            CONFIG.LIGHTING.SUN_COLOR,
            CONFIG.LIGHTING.SUN_INTENSITY
        );
        this.sunLight.position.set(15, 20, 0);
        this.scene.add(this.sunLight);
    }

    /**
     * Setup skybox based on configuration
     * @private
     * @returns {Promise<void>}
     */
    async setupSkybox() {
        this.skyboxManager = new SkyboxManager(this.scene, this.renderer);

        // Initialize skybox based on config
        if (CONFIG.SKYBOX.ENABLED) {
            const startTime = performance.now();

            try {
                switch (CONFIG.SKYBOX.TYPE) {
                    case 'gradient':
                        this.skyboxManager.createGradientSkybox({
                            top: CONFIG.SKYBOX.GRADIENT.TOP,
                            bottom: CONFIG.SKYBOX.GRADIENT.BOTTOM
                        });
                        break;

                    case 'solid':
                        this.skyboxManager.createSolidColorSkybox(CONFIG.SKYBOX.SOLID_COLOR);
                        break;

                    case 'sphere':
                        await this.skyboxManager.loadSphereSkybox(
                            CONFIG.SKYBOX.SPHERE.TEXTURE_PATH,
                            CONFIG.SKYBOX.SPHERE.RADIUS
                        );
                        break;

                    case 'cylinder':
                        await this.skyboxManager.loadCylindricalSkybox(
                            CONFIG.SKYBOX.CYLINDER.TEXTURE_PATH,
                            CONFIG.SKYBOX.CYLINDER.RADIUS_X,
                            CONFIG.SKYBOX.CYLINDER.RADIUS_Z,
                            CONFIG.SKYBOX.CYLINDER.HEIGHT,
                            CONFIG.SKYBOX.CYLINDER.SCROLL_SPEED || 0.01
                        );
                        break;

                    case 'cubemap':
                        await this.skyboxManager.loadCubeMapSkybox(
                            CONFIG.SKYBOX.CUBEMAP.TEXTURE_PATHS
                        );
                        break;

                    case 'none':
                        // No skybox
                        break;

                    default:
                        console.warn(`Unknown skybox type: ${CONFIG.SKYBOX.TYPE}, using gradient (supported types: gradient, solid, sphere, cylinder, cubemap, none)`);
                        this.skyboxManager.createGradientSkybox({
                            top: CONFIG.SKYBOX.GRADIENT.TOP,
                            bottom: CONFIG.SKYBOX.GRADIENT.BOTTOM
                        });
                }

                const loadTime = performance.now() - startTime;
            } catch (err) {
                // If any skybox loading fails, fall back to gradient
                console.warn(`[SceneManager] Failed to load ${CONFIG.SKYBOX.TYPE} skybox, falling back to gradient:`, err);
                this.skyboxManager.createGradientSkybox({
                    top: CONFIG.SKYBOX.GRADIENT.TOP,
                    bottom: CONFIG.SKYBOX.GRADIENT.BOTTOM
                });

                const loadTime = performance.now() - startTime;
            }
        }
    }

    /**
     * Update camera and lighting based on player position
     * @param {THREE.Vector3} playerPosition
     * @param {number} cameraZoom - Zoom level (0.75-1.0)
     */
    updateCameraAndLighting(playerPosition, cameraZoom = 1.0) {
        if (!playerPosition) return;

        // Update camera position
        const baseDist = 15;
        const dist = baseDist * cameraZoom;
        const angle = Math.PI / 4;

        this.camera.position.set(
            playerPosition.x + dist * Math.cos(angle),
            playerPosition.y + 12,
            playerPosition.z + dist * Math.sin(angle)
        );
        this.camera.lookAt(playerPosition.x, playerPosition.y + 1, playerPosition.z);

        // Update sun light to follow player
        if (this.sunLight) {
            this.sunLight.position.set(
                playerPosition.x + 15,
                20,
                playerPosition.z
            );
            this.sunLight.target.position.copy(playerPosition);
            this.sunLight.target.updateMatrixWorld();
        }
    }

    /**
     * Render the scene
     * @param {WaterRenderer} waterRenderer - Optional water renderer for skybox offset
     */
    render(waterRenderer = null) {
        if (this.renderer && this.scene && this.camera) {
            // Calculate delta time in seconds
            const currentTime = performance.now();
            const deltaTime = (currentTime - this.lastTime) / 1000; // Convert to seconds
            this.lastTime = currentTime;

            // Get skybox Y offset from water renderer if available
            const yOffset = waterRenderer?.skyboxYOffset || 0;

            // Update skybox position to follow camera and animate
            if (this.skyboxManager) {
                this.skyboxManager.update(this.camera, deltaTime, yOffset);
            }

            this.renderer.render(this.scene, this.camera);
        }
    }

    /**
     * Handle window resize
     */
    onWindowResize() {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    /**
     * Add an object to the scene
     * @param {THREE.Object3D} object
     */
    add(object) {
        if (this.scene) {
            this.scene.add(object);
        }
    }

    /**
     * Remove an object from the scene
     * @param {THREE.Object3D} object
     */
    remove(object) {
        if (this.scene) {
            this.scene.remove(object);
        }
    }

    /**
     * Get the scene
     * @returns {THREE.Scene}
     */
    getScene() {
        return this.scene;
    }

    /**
     * Get the camera
     * @returns {THREE.PerspectiveCamera}
     */
    getCamera() {
        return this.camera;
    }

    /**
     * Get the renderer
     * @returns {THREE.WebGLRenderer}
     */
    getRenderer() {
        return this.renderer;
    }

    /**
     * Get the skybox manager
     * @returns {SkyboxManager}
     */
    getSkyboxManager() {
        return this.skyboxManager;
    }

    /**
     * Cleanup resources
     */
    dispose() {
        // Dispose skybox
        if (this.skyboxManager) {
            this.skyboxManager.dispose();
            this.skyboxManager = null;
        }

        // Dispose renderer
        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement.parentElement) {
                this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
            }
        }
    }
}

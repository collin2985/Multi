/**
 * SceneManager.js
 * Manages THREE.js scene, camera, renderer, lighting, and skybox
 */

import * as THREE from 'three';
import { SkyManager } from '../world/SkyManager.js';
import { CONFIG } from '../config.js';

export class SceneManager {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.sunLight = null;
        this.skyLight = null;
        this.skyManager = null;
        this.skyboxManager = null; // Kept for compatibility
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
            1500  // Reduced from 20000 for better depth precision (ISSUE-060)
        );

        // Create renderer (stencil enabled for occlusion outline effects)
        // powerPreference hints to browser to use discrete GPU on laptops with dual graphics
        this.renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true, powerPreference: 'high-performance' });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000011);

        // Renderer settings for softer, more cinematic appearance
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.5;

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
            if (CONFIG.RENDERING.FOG_TYPE === 'linear') {
                // Linear fog (terrain5 style)
                this.scene.fog = new THREE.Fog(
                    CONFIG.RENDERING.FOG_COLOR,
                    CONFIG.RENDERING.FOG_NEAR,
                    CONFIG.RENDERING.FOG_FAR
                );
            } else {
                // Exponential fog (legacy)
                this.scene.fog = new THREE.FogExp2(
                    CONFIG.RENDERING.FOG_COLOR,
                    CONFIG.RENDERING.FOG_DENSITY
                );
            }
        }
    }

    /**
     * Update fog distances dynamically (for quality settings)
     * @param {number} near - Fog start distance
     * @param {number} far - Fog end distance
     */
    updateFog(near, far) {
        if (this.scene.fog) {
            this.scene.fog.near = near;
            this.scene.fog.far = far;
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
     * Setup sky using Three.js Sky for realistic sun/atmosphere
     * @private
     * @returns {Promise<void>}
     */
    async setupSkybox() {
        // Create new Sky-based manager for realistic sun and reflections
        this.skyManager = new SkyManager(this.scene, this.renderer);

        // Set initial sun position from config if available
        if (CONFIG.SKY?.SUN_ELEVATION !== undefined) {
            this.skyManager.setSunElevation(CONFIG.SKY.SUN_ELEVATION);
        }
        if (CONFIG.SKY?.SUN_AZIMUTH !== undefined) {
            this.skyManager.setSunAzimuth(CONFIG.SKY.SUN_AZIMUTH);
        }

        // Alias for compatibility with old code
        this.skyboxManager = this.skyManager;
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
     * @param {WaterRenderer} waterRenderer - Optional water renderer (unused with new sky system)
     */
    render(waterRenderer = null) {
        if (this.renderer && this.scene && this.camera) {
            // Update sky position to follow camera
            if (this.skyManager) {
                this.skyManager.update(this.camera);
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
        // Dispose sky manager
        if (this.skyManager) {
            this.skyManager.dispose();
            this.skyManager = null;
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

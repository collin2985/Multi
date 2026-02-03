// File: public/world/SkyManager.js
// Three.js Sky-based sky system with sun control and PMREM reflections

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { CONFIG } from '../config.js';

export class SkyManager {
    constructor(scene, renderer) {
        this.scene = scene;
        this.renderer = renderer;

        this.sky = null;
        this.sun = new THREE.Vector3();
        this.pmremGenerator = null;
        this.renderTarget = null;

        // Sun parameters (from config)
        this.parameters = {
            elevation: CONFIG.SKY?.SUN_ELEVATION ?? 90,
            azimuth: CONFIG.SKY?.SUN_AZIMUTH ?? 180
        };

        // Sky parameters (from config)
        this.skyParameters = {
            turbidity: CONFIG.SKY?.TURBIDITY ?? 2,
            rayleigh: CONFIG.SKY?.RAYLEIGH ?? 1,
            mieCoefficient: CONFIG.SKY?.MIE_COEFFICIENT ?? 0.003,
            mieDirectionalG: CONFIG.SKY?.MIE_DIRECTIONAL_G ?? 0.7
        };

        // Callbacks for when sun changes
        this.onSunChangeCallbacks = [];

        this.init();
    }

    init() {
        // Create sky
        this.sky = new Sky();
        this.sky.scale.setScalar(1400);  // Reduced from 10000 to fit within camera far plane (ISSUE-060)
        this.scene.add(this.sky);

        // Set sky uniforms
        const uniforms = this.sky.material.uniforms;
        uniforms['turbidity'].value = this.skyParameters.turbidity;
        uniforms['rayleigh'].value = this.skyParameters.rayleigh;
        uniforms['mieCoefficient'].value = this.skyParameters.mieCoefficient;
        uniforms['mieDirectionalG'].value = this.skyParameters.mieDirectionalG;

        // Create PMREM generator for environment reflections
        this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);

        // Initial sun update
        this.updateSun();
    }

    updateSun() {
        // Convert elevation and azimuth to sun direction vector
        const phi = THREE.MathUtils.degToRad(90 - this.parameters.elevation);
        const theta = THREE.MathUtils.degToRad(this.parameters.azimuth);

        this.sun.setFromSphericalCoords(1, phi, theta);

        // Update sky
        this.sky.material.uniforms['sunPosition'].value.copy(this.sun);

        // Update environment map for reflections
        if (this.renderTarget) {
            this.renderTarget.dispose();
        }
        this.renderTarget = this.pmremGenerator.fromScene(this.sky);
        this.scene.environment = this.renderTarget.texture;

        // Notify callbacks (e.g., water renderer)
        this.onSunChangeCallbacks.forEach(callback => {
            callback(this.sun.clone());
        });
    }

    // Register callback for sun direction changes
    onSunChange(callback) {
        this.onSunChangeCallbacks.push(callback);
        // Immediately call with current sun direction
        callback(this.sun.clone());
    }

    // Set sun elevation (degrees above horizon, 0-90)
    setSunElevation(degrees) {
        this.parameters.elevation = Math.max(0, Math.min(90, degrees));
        this.updateSun();
    }

    // Set sun azimuth (degrees around horizon, -180 to 180)
    setSunAzimuth(degrees) {
        this.parameters.azimuth = degrees;
        this.updateSun();
    }

    // Set both sun position at once
    setSunPosition(elevation, azimuth) {
        this.parameters.elevation = Math.max(0, Math.min(90, elevation));
        this.parameters.azimuth = azimuth;
        this.updateSun();
    }

    // Get current sun direction vector
    getSunDirection() {
        return this.sun.clone();
    }

    // Sky atmosphere controls
    setTurbidity(value) {
        this.skyParameters.turbidity = value;
        this.sky.material.uniforms['turbidity'].value = value;
        this.updateSun(); // Refresh environment
    }

    setRayleigh(value) {
        this.skyParameters.rayleigh = value;
        this.sky.material.uniforms['rayleigh'].value = value;
        this.updateSun();
    }

    setMieCoefficient(value) {
        this.skyParameters.mieCoefficient = value;
        this.sky.material.uniforms['mieCoefficient'].value = value;
        this.updateSun();
    }

    setMieDirectionalG(value) {
        this.skyParameters.mieDirectionalG = value;
        this.sky.material.uniforms['mieDirectionalG'].value = value;
        this.updateSun();
    }

    // Set sky scale (default 10000, smaller values for small game worlds)
    setScale(value) {
        if (this.sky) {
            this.sky.scale.setScalar(value);
        }
    }

    // Get current scale
    getScale() {
        return this.sky ? this.sky.scale.x : 10000;
    }

    // Update sky position to follow camera
    update(camera) {
        if (this.sky && camera) {
            this.sky.position.x = camera.position.x;
            this.sky.position.z = camera.position.z;
        }
    }

    // Get parameters for GUI
    getParameters() {
        return {
            sun: { ...this.parameters },
            sky: { ...this.skyParameters }
        };
    }

    dispose() {
        if (this.sky) {
            this.scene.remove(this.sky);
            this.sky.geometry.dispose();
            this.sky.material.dispose();
        }

        if (this.renderTarget) {
            this.renderTarget.dispose();
        }

        if (this.pmremGenerator) {
            this.pmremGenerator.dispose();
        }

        this.onSunChangeCallbacks = [];
    }
}

export default SkyManager;

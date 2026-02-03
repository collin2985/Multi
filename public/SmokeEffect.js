// File: public/SmokeEffect.js
// Lightweight smoke effect controller - uses centralized SmokeParticleSystem for rendering

import { CONFIG } from './config.js';

/**
 * SmokeEffect - Lightweight controller for a single smoke source
 * Manages spawn timing and LOD, delegates rendering to SmokeParticleSystem
 *
 * This class no longer creates any THREE.Mesh objects - all rendering
 * is handled by the shared SmokeParticleSystem for maximum performance.
 */
export class SmokeEffect {
    /**
     * @param {string} effectId - Unique identifier for this effect
     * @param {SmokeParticleSystem} particleSystem - Shared particle system
     * @param {object} position - {x, y, z} position
     */
    constructor(effectId, particleSystem, position = { x: 0, y: 0, z: 0 }, opacityMult = 1.0) {
        this.effectId = effectId;
        this.particleSystem = particleSystem;
        this.position = { ...position };
        this.opacityMult = opacityMult;

        this.spawnTimer = 0;
        this.active = false; // Start inactive, activated when firewood present
        this.camera = null;  // Set by EffectManager for distance calculations

        // LOD state
        this.currentLODTier = 0;
        this.spawnInterval = 0.25;
        this.maxParticles = 40;
    }

    /**
     * Update spawn timing and LOD
     * @param {number} delta - Time since last frame in seconds
     */
    update(delta) {
        // Skip entirely if smoke is disabled
        if (!CONFIG.SMOKE_ENABLED) return;

        // Cap delta to prevent issues when tab is inactive
        const cappedDelta = Math.min(delta, 0.1);

        // Update LOD based on camera distance (using squared distance to avoid sqrt)
        if (this.camera) {
            const dx = this.position.x - this.camera.position.x;
            const dy = this.position.y - this.camera.position.y;
            const dz = this.position.z - this.camera.position.z;
            const distanceSq = dx * dx + dy * dy + dz * dz;

            const newLODTier = this.particleSystem.getLODTierSq(distanceSq);
            if (newLODTier !== this.currentLODTier) {
                this.currentLODTier = newLODTier;
                this.spawnInterval = this.particleSystem.getSpawnInterval(newLODTier);
                this.maxParticles = this.particleSystem.getMaxParticles(newLODTier);
            }
        }

        // Only spawn if active
        if (!this.active) return;

        // Check if we're at max particles for current LOD
        const currentCount = this.particleSystem.getActiveCount(this.effectId);
        if (currentCount >= this.maxParticles) return;

        // Spawn timer
        this.spawnTimer += cappedDelta;
        if (this.spawnTimer >= this.spawnInterval) {
            this.particleSystem.spawnParticle(this.effectId, this.position, this.currentLODTier, this.opacityMult);
            this.spawnTimer -= this.spawnInterval;
        }
    }

    /**
     * Update the position (useful if structure moves)
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    setPosition(x, y, z) {
        this.position.x = x;
        this.position.y = y;
        this.position.z = z;
    }

    /**
     * Stop spawning new particles (existing ones continue to fade out)
     */
    stop() {
        this.active = false;
    }

    /**
     * Resume spawning particles
     */
    start() {
        this.active = true;
    }

    /**
     * Check if any particles are still active for this effect
     * @returns {boolean}
     */
    hasActiveParticles() {
        return this.particleSystem.getActiveCount(this.effectId) > 0;
    }

    /**
     * Immediately remove all particles and clean up
     */
    dispose() {
        this.active = false;
        this.particleSystem.removeEffectParticles(this.effectId);
    }
}

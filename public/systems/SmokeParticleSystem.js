// File: public/systems/SmokeParticleSystem.js
// Centralized instanced smoke particle renderer for performance optimization

import * as THREE from 'three';
import { CONFIG } from '../config.js';

/**
 * SmokeParticleSystem - Manages ALL smoke particles across all effects
 * Uses a single InstancedMesh with GPU billboarding for maximum performance
 */

// Particle data field indices (stride = 16 floats per particle)
const P_SLOT_INDEX = 0;   // Slot index in InstancedMesh (also used as data slot)
const P_EFFECT_ID = 1;    // Effect ID (stored as hash)
const P_START_X = 2;
const P_START_Y = 3;
const P_START_Z = 4;
const P_VELOCITY = 5;
const P_MAX_OPACITY = 6;
const P_ARC_STRENGTH = 7;
const P_WOBBLE = 8;
const P_AGE = 9;
const P_FADE_IN = 10;
const P_FADE_OUT = 11;
const P_RISE_HEIGHT = 12;
const P_TOTAL_LIFESPAN = 13;
const P_INV_FADE_IN = 14;
const P_INV_FADE_OUT = 15;
const PARTICLE_STRIDE = 16;

export class SmokeParticleSystem {
    constructor(scene) {
        this.scene = scene;

        // Check smoke quality mode
        this.minimalMode = CONFIG.SMOKE_ENABLED === 'minimal';

        // Minimal mode: 1000 particles max (allows multiple structures)
        // Full mode: 2000 particles with LOD system
        this.maxInstances = this.minimalMode ? 1000 : 2000;

        // TypedArray for particle data - indexed by SLOT, not by active index
        // Each slot has its own fixed region: slot N uses offset N * PARTICLE_STRIDE
        this.particleData = new Float32Array(this.maxInstances * PARTICLE_STRIDE);

        // Track which slots are currently active (for iteration)
        this.activeSlots = new Set();

        // Stack-based slot allocation (O(1) push/pop)
        this.availableSlots = [];
        for (let i = this.maxInstances - 1; i >= 0; i--) {
            this.availableSlots.push(i);
        }

        // O(1) particle counting per effect
        this.effectParticleCounts = new Map();
        this.effectIdToHash = new Map();
        this.nextEffectHash = 1;

        // Reusable objects to avoid allocations
        this._tempMatrix = new THREE.Matrix4();

        // LOD thresholds
        this.LOD_FULL = 50;
        this.LOD_REDUCED = 100;

        // Minimal mode: global spawn timer (1 particle per second total)
        this._minimalSpawnTimer = 0;
        this._minimalSpawnInterval = 1.0; // 1 second between spawns
        this._minimalMaxDistance = 50; // Only spawn within 50 units
        this._minimalMaxDistanceSq = 2500; // 50^2

        this.init();
    }

    getEffectHash(effectId) {
        let hash = this.effectIdToHash.get(effectId);
        if (hash === undefined) {
            hash = this.nextEffectHash++;
            this.effectIdToHash.set(effectId, hash);
            this.effectParticleCounts.set(hash, 0);
        }
        return hash;
    }

    init() {
        const smokeTexture = new THREE.TextureLoader().load('./terrain/smoke.png');
        smokeTexture.minFilter = THREE.LinearMipmapLinearFilter;
        smokeTexture.magFilter = THREE.LinearFilter;

        const vertexShader = `
            attribute float instanceOpacity;
            attribute float instanceScale;

            varying float vOpacity;
            varying vec2 vUv;
            varying float vFogDepth;

            void main() {
                vOpacity = instanceOpacity;
                vUv = uv;

                vec3 instancePos = vec3(instanceMatrix[3].x, instanceMatrix[3].y, instanceMatrix[3].z);
                float baseScale = length(instanceMatrix[0].xyz) * instanceScale;

                vec3 toCamera = normalize(cameraPosition - instancePos);
                vec3 worldUp = vec3(0.0, 1.0, 0.0);
                vec3 right = normalize(cross(worldUp, toCamera));
                vec3 up = cross(toCamera, right);

                vec3 vertexPos = instancePos + right * position.x * baseScale + up * position.y * baseScale;

                vec4 mvPosition = modelViewMatrix * vec4(vertexPos, 1.0);
                gl_Position = projectionMatrix * mvPosition;

                // Euclidean fog depth (matches terrain fog for uniform fade in all directions)
                vFogDepth = length(mvPosition.xyz);
            }
        `;

        const fragmentShader = `
            uniform sampler2D map;
            uniform vec3 fogColor;
            uniform float fogNear;
            uniform float fogFar;

            varying float vOpacity;
            varying vec2 vUv;
            varying float vFogDepth;

            void main() {
                vec4 texColor = texture2D(map, vUv);

                float alpha = texColor.a * vOpacity;
                if (alpha < 0.01) discard;

                vec3 smokeColor = texColor.rgb * 0.6;

                float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
                fogFactor = clamp(fogFactor, 0.0, 1.0);

                vec3 finalColor = mix(smokeColor, fogColor, fogFactor);
                float alphaFade = 1.0 - fogFactor;

                gl_FragColor = vec4(finalColor, alpha * alphaFade);
            }
        `;

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                map: { value: smokeTexture },
                fogColor: { value: new THREE.Color(0.7, 0.75, 0.8) },
                fogNear: { value: 200 },
                fogFar: { value: 500 }
            },
            vertexShader,
            fragmentShader,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        const geometry = new THREE.PlaneGeometry(1.5, 1.5);

        this.mesh = new THREE.InstancedMesh(geometry, this.material, this.maxInstances);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 999;

        // Initialize all instances as invisible
        const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
        for (let i = 0; i < this.maxInstances; i++) {
            this.mesh.setMatrixAt(i, zeroMatrix);
        }
        this.mesh.instanceMatrix.needsUpdate = true;

        this.opacityArray = new Float32Array(this.maxInstances);
        this.scaleArray = new Float32Array(this.maxInstances);
        this.opacityArray.fill(0);
        this.scaleArray.fill(1);

        geometry.setAttribute('instanceOpacity', new THREE.InstancedBufferAttribute(this.opacityArray, 1));
        geometry.setAttribute('instanceScale', new THREE.InstancedBufferAttribute(this.scaleArray, 1));

        this.scene.add(this.mesh);
    }

    allocateSlot() {
        if (this.availableSlots.length === 0) return -1;
        return this.availableSlots.pop();
    }

    releaseSlot(slotIndex) {
        this.availableSlots.push(slotIndex);
        this.activeSlots.delete(slotIndex);

        // Hide the instance
        this._tempMatrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(slotIndex, this._tempMatrix);
        this.opacityArray[slotIndex] = 0;
    }

    spawnParticle(effectId, position, lodTier = 0, opacityMult = 1.0) {
        const slotIndex = this.allocateSlot();
        if (slotIndex === -1) return false;

        const effectHash = this.getEffectHash(effectId);

        // KEY FIX: Use slotIndex for data offset - each slot has its own fixed region
        const offset = slotIndex * PARTICLE_STRIDE;

        const d = this.particleData;
        d[offset + P_SLOT_INDEX] = slotIndex;
        d[offset + P_EFFECT_ID] = effectHash;
        d[offset + P_START_X] = position.x + (Math.random() * 0.3 - 0.15);
        d[offset + P_START_Y] = position.y + 1.0;
        d[offset + P_START_Z] = position.z + (Math.random() * 0.3 - 0.15);
        d[offset + P_AGE] = 0;

        if (this.minimalMode) {
            // Minimal mode: shorter lifespan, simpler values
            d[offset + P_VELOCITY] = 0.6;
            d[offset + P_MAX_OPACITY] = 0.4 * opacityMult;
            d[offset + P_ARC_STRENGTH] = 0;
            d[offset + P_WOBBLE] = 0;
            d[offset + P_FADE_IN] = 0.3;
            d[offset + P_FADE_OUT] = 1.0;
            d[offset + P_RISE_HEIGHT] = 6.0;  // ~10s lifespan total
        } else {
            // Full mode: longer lifespan, more variation
            d[offset + P_VELOCITY] = Math.random() * 0.35 + 0.56;
            d[offset + P_MAX_OPACITY] = (Math.random() * 0.4 + 0.3) * opacityMult;
            d[offset + P_ARC_STRENGTH] = lodTier === 2 ? 0 : (Math.random() * 0.3 + 0.2);
            d[offset + P_WOBBLE] = lodTier === 2 ? 0 : (Math.random() * 0.1 + 0.05);
            d[offset + P_FADE_IN] = 0.5;
            d[offset + P_FADE_OUT] = 1.5;
            d[offset + P_RISE_HEIGHT] = 11.2;
        }

        const risingTime = d[offset + P_RISE_HEIGHT] / d[offset + P_VELOCITY];
        d[offset + P_TOTAL_LIFESPAN] = d[offset + P_FADE_IN] + risingTime + d[offset + P_FADE_OUT];

        d[offset + P_INV_FADE_IN] = 1.0 / d[offset + P_FADE_IN];
        d[offset + P_INV_FADE_OUT] = 1.0 / d[offset + P_FADE_OUT];

        // Track this slot as active
        this.activeSlots.add(slotIndex);

        // Update effect particle count
        this.effectParticleCounts.set(effectHash, (this.effectParticleCounts.get(effectHash) || 0) + 1);

        // Set initial position
        this._tempMatrix.makeTranslation(d[offset + P_START_X], d[offset + P_START_Y], d[offset + P_START_Z]);
        this.mesh.setMatrixAt(slotIndex, this._tempMatrix);

        return true;
    }

    /**
     * Spawn a simple particle for minimal mode - no wobble/arc, just straight up
     * Maximum performance with minimal calculations
     */
    spawnMinimalParticle(position) {
        if (this.activeSlots.size >= this.maxInstances) return false;

        const slotIndex = this.allocateSlot();
        if (slotIndex === -1) return false;

        const offset = slotIndex * PARTICLE_STRIDE;
        const d = this.particleData;

        d[offset + P_SLOT_INDEX] = slotIndex;
        d[offset + P_EFFECT_ID] = 0; // No effect tracking in minimal mode
        d[offset + P_START_X] = position.x;
        d[offset + P_START_Y] = position.y + 1.0;
        d[offset + P_START_Z] = position.z;
        d[offset + P_VELOCITY] = 0.5; // Fixed velocity - no randomness
        d[offset + P_MAX_OPACITY] = 0.5;
        d[offset + P_ARC_STRENGTH] = 0; // No arc
        d[offset + P_WOBBLE] = 0; // No wobble
        d[offset + P_AGE] = 0;
        d[offset + P_FADE_IN] = 0.5;
        d[offset + P_FADE_OUT] = 1.5;
        d[offset + P_RISE_HEIGHT] = 10;

        const risingTime = d[offset + P_RISE_HEIGHT] / d[offset + P_VELOCITY];
        d[offset + P_TOTAL_LIFESPAN] = d[offset + P_FADE_IN] + risingTime + d[offset + P_FADE_OUT];
        d[offset + P_INV_FADE_IN] = 1.0 / d[offset + P_FADE_IN];
        d[offset + P_INV_FADE_OUT] = 1.0 / d[offset + P_FADE_OUT];

        this.activeSlots.add(slotIndex);

        this._tempMatrix.makeTranslation(d[offset + P_START_X], d[offset + P_START_Y], d[offset + P_START_Z]);
        this.mesh.setMatrixAt(slotIndex, this._tempMatrix);

        return true;
    }

    /**
     * Update minimal mode - call this with active smoke positions and camera
     * Spawns 1 particle per second from closest active smoke source within 50 units
     * @param {number} delta - Time delta in seconds
     * @param {Array} smokePositions - Array of {x, y, z} positions of active smoke sources
     * @param {THREE.Camera} camera - Camera for distance check
     */
    updateMinimalMode(delta, smokePositions, camera) {
        if (!this.minimalMode || !smokePositions || smokePositions.length === 0) return;

        this._minimalSpawnTimer += delta;

        if (this._minimalSpawnTimer >= this._minimalSpawnInterval) {
            this._minimalSpawnTimer = 0;

            // Find closest active smoke source within range
            let closestPos = null;
            let closestDistSq = this._minimalMaxDistanceSq;

            const camX = camera.position.x;
            const camZ = camera.position.z;

            for (const pos of smokePositions) {
                const dx = pos.x - camX;
                const dz = pos.z - camZ;
                const distSq = dx * dx + dz * dz;

                if (distSq < closestDistSq) {
                    closestDistSq = distSq;
                    closestPos = pos;
                }
            }

            if (closestPos) {
                this.spawnMinimalParticle(closestPos);
            }
        }
    }

    update(delta) {
        // Cap delta for smooth animation
        const cappedDelta = Math.min(delta, 0.05);

        if (this.activeSlots.size === 0) return;

        const d = this.particleData;
        const slotsToRemove = [];

        // Iterate over active slots
        for (const slotIndex of this.activeSlots) {
            const offset = slotIndex * PARTICLE_STRIDE;

            // Age the particle
            d[offset + P_AGE] += cappedDelta;
            const age = d[offset + P_AGE];
            const totalLifespan = d[offset + P_TOTAL_LIFESPAN];

            // Check if expired
            if (age >= totalLifespan) {
                const effectHash = d[offset + P_EFFECT_ID] | 0;

                // Decrement effect count
                const count = this.effectParticleCounts.get(effectHash);
                if (count > 1) {
                    this.effectParticleCounts.set(effectHash, count - 1);
                } else {
                    this.effectParticleCounts.set(effectHash, 0);
                }

                slotsToRemove.push(slotIndex);
                continue;
            }

            // Calculate position
            const velocity = d[offset + P_VELOCITY];
            const distanceTraveled = velocity * age;
            const startY = d[offset + P_START_Y];
            const y = startY + distanceTraveled;

            const startX = d[offset + P_START_X];
            const startZ = d[offset + P_START_Z];
            let x, z;

            let scale;

            // Minimal mode: straight up, no drift/wobble, fixed scale (max performance)
            if (this.minimalMode) {
                x = startX;
                z = startZ;
                scale = 1.0;
            } else {
                // Full mode: wind drift and wobble
                const riseHeight = d[offset + P_RISE_HEIGHT];
                let riseProgress = distanceTraveled / riseHeight;
                if (riseProgress > 1) riseProgress = 1;

                const rp2 = riseProgress * riseProgress;
                const windDrift = rp2 * Math.sqrt(riseProgress);

                const arcStrength = d[offset + P_ARC_STRENGTH];
                const wobble = d[offset + P_WOBBLE];
                const leftwardDrift = -windDrift * 3 * arcStrength;
                const wobbleOffset = Math.sin(age * 2) * wobble * 0.3;

                x = startX + leftwardDrift + wobbleOffset;
                z = startZ + Math.cos(age * 1.5) * 0.1 * (1 + riseProgress * 0.5);

                // Scale grows as particle rises
                scale = 1.0 + riseProgress * 0.5;
            }

            // Update matrix
            this._tempMatrix.makeTranslation(x, y, z);
            this.mesh.setMatrixAt(slotIndex, this._tempMatrix);
            this.scaleArray[slotIndex] = scale;

            // Calculate opacity
            const fadeInDuration = d[offset + P_FADE_IN];
            const fadeOutDuration = d[offset + P_FADE_OUT];
            const maxOpacity = d[offset + P_MAX_OPACITY];

            let opacity;
            if (age < fadeInDuration) {
                opacity = age * d[offset + P_INV_FADE_IN] * maxOpacity;
            } else if (age < totalLifespan - fadeOutDuration) {
                opacity = maxOpacity;
            } else {
                const fadeOutProgress = (age - (totalLifespan - fadeOutDuration)) * d[offset + P_INV_FADE_OUT];
                opacity = maxOpacity * (1 - fadeOutProgress);
            }

            this.opacityArray[slotIndex] = opacity > 0 ? opacity : 0;
        }

        // Remove expired particles
        for (const slotIndex of slotsToRemove) {
            this.releaseSlot(slotIndex);
        }

        // Update GPU buffers
        this.mesh.instanceMatrix.needsUpdate = true;
        this.mesh.geometry.attributes.instanceOpacity.needsUpdate = true;
        this.mesh.geometry.attributes.instanceScale.needsUpdate = true;
    }

    removeEffectParticles(effectId) {
        const effectHash = this.effectIdToHash.get(effectId);
        if (effectHash === undefined) return;

        const d = this.particleData;
        const slotsToRemove = [];

        for (const slotIndex of this.activeSlots) {
            const offset = slotIndex * PARTICLE_STRIDE;
            if ((d[offset + P_EFFECT_ID] | 0) === effectHash) {
                slotsToRemove.push(slotIndex);
            }
        }

        for (const slotIndex of slotsToRemove) {
            this.releaseSlot(slotIndex);
        }

        this.effectParticleCounts.set(effectHash, 0);

        this.mesh.instanceMatrix.needsUpdate = true;
        this.mesh.geometry.attributes.instanceOpacity.needsUpdate = true;
    }

    getActiveCount(effectId) {
        const effectHash = this.effectIdToHash.get(effectId);
        if (effectHash === undefined) return 0;
        return this.effectParticleCounts.get(effectHash) || 0;
    }

    getLODTier(distance) {
        if (distance < this.LOD_FULL) return 0;
        if (distance < this.LOD_REDUCED) return 1;
        if (distance < 200) return 2;
        return 3;
    }

    // Squared distance version - avoids sqrt in hot path
    getLODTierSq(distanceSq) {
        if (this.minimalMode) {
            // Minimal mode: only within 50 units, or off
            return distanceSq < this._minimalMaxDistanceSq ? 0 : 3;
        }
        // Full mode
        if (distanceSq < 2500) return 0;   // 50^2
        if (distanceSq < 10000) return 1;  // 100^2
        if (distanceSq < 40000) return 2;  // 200^2
        return 3;
    }

    getSpawnInterval(lodTier) {
        if (this.minimalMode) {
            return 1.0;  // Fixed: 1 particle/sec regardless of distance
        }
        // Full mode
        switch (lodTier) {
            case 0: return 0.25;
            case 1: return 0.5;
            case 2: return 1.0;
            case 3: return 3.0;
            default: return 0.25;
        }
    }

    getMaxParticles(lodTier) {
        if (this.minimalMode) {
            return 1000;  // No per-structure limit, only global max matters
        }
        // Full mode
        switch (lodTier) {
            case 0: return 40;
            case 1: return 20;
            case 2: return 10;
            case 3: return 3;
            default: return 40;
        }
    }

    updateFog(fog) {
        if (fog) {
            this.material.uniforms.fogColor.value.copy(fog.color);
            this.material.uniforms.fogNear.value = fog.near;
            this.material.uniforms.fogFar.value = fog.far;
        }
    }

    getStats() {
        return {
            activeParticles: this.activeSlots.size,
            availableSlots: this.availableSlots.length,
            maxInstances: this.maxInstances
        };
    }

    dispose() {
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.material.dispose();
        this.activeSlots.clear();
        this.availableSlots = [];
        this.effectParticleCounts.clear();
        this.effectIdToHash.clear();
    }
}

// File: public/effects/GunSmokeParticleSystem.js
// Instanced particle system for gun smoke - single draw call for all particles

import * as THREE from 'three';

// Particle data field indices (stride = 12 floats per particle)
const P_POS_X = 0;
const P_POS_Y = 1;
const P_POS_Z = 2;
const P_VEL_Y = 3;
const P_DRIFT_X = 4;
const P_DRIFT_Z = 5;
const P_AGE = 6;
const P_LIFESPAN = 7;
const P_START_OPACITY = 8;
const P_BASE_SIZE = 9;
const P_ROT_SPEED = 10;
const P_SLOT = 11;
const PARTICLE_STRIDE = 12;

// Shared canvas texture - created once
let sharedTexture = null;

function createSmokeTexture() {
    if (sharedTexture) return sharedTexture;

    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Soft circular gradient - white/light gray for gunsmoke
    const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    gradient.addColorStop(0, 'rgba(230, 230, 235, 1)');
    gradient.addColorStop(0.4, 'rgba(210, 210, 215, 0.7)');
    gradient.addColorStop(1, 'rgba(180, 180, 185, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    sharedTexture = new THREE.CanvasTexture(canvas);
    return sharedTexture;
}

export class GunSmokeParticleSystem {
    constructor(scene) {
        this.scene = scene;
        this.maxInstances = 100; // Gun smoke is short-lived, 2-3 per shot

        // TypedArray for particle data
        this.particleData = new Float32Array(this.maxInstances * PARTICLE_STRIDE);

        // Track active slots
        this.activeSlots = new Set();

        // Stack-based slot allocation (O(1) push/pop)
        this.availableSlots = [];
        for (let i = this.maxInstances - 1; i >= 0; i--) {
            this.availableSlots.push(i);
        }

        // Reusable objects
        this._tempMatrix = new THREE.Matrix4();

        this.init();
    }

    init() {
        const texture = createSmokeTexture();

        const vertexShader = `
            attribute float instanceOpacity;
            attribute float instanceScale;

            varying float vOpacity;
            varying vec2 vUv;

            void main() {
                vOpacity = instanceOpacity;
                vUv = uv;

                vec3 instancePos = vec3(instanceMatrix[3].x, instanceMatrix[3].y, instanceMatrix[3].z);
                float baseScale = instanceScale;

                // Billboard facing camera
                vec3 toCamera = normalize(cameraPosition - instancePos);
                vec3 worldUp = vec3(0.0, 1.0, 0.0);
                vec3 right = normalize(cross(worldUp, toCamera));
                vec3 up = cross(toCamera, right);

                vec3 vertexPos = instancePos + right * position.x * baseScale + up * position.y * baseScale;

                gl_Position = projectionMatrix * modelViewMatrix * vec4(vertexPos, 1.0);
            }
        `;

        const fragmentShader = `
            uniform sampler2D map;

            varying float vOpacity;
            varying vec2 vUv;

            void main() {
                vec4 texColor = texture2D(map, vUv);
                float alpha = texColor.a * vOpacity;
                if (alpha < 0.01) discard;
                gl_FragColor = vec4(texColor.rgb, alpha);
            }
        `;

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                map: { value: texture }
            },
            vertexShader,
            fragmentShader,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        // Smaller geometry for gun smoke (0.6-0.9 units)
        const geometry = new THREE.PlaneGeometry(1, 1);

        this.mesh = new THREE.InstancedMesh(geometry, this.material, this.maxInstances);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 1000;

        // Initialize all instances as invisible
        const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
        for (let i = 0; i < this.maxInstances; i++) {
            this.mesh.setMatrixAt(i, zeroMatrix);
        }
        this.mesh.instanceMatrix.needsUpdate = true;

        this.opacityArray = new Float32Array(this.maxInstances);
        this.scaleArray = new Float32Array(this.maxInstances);
        this.opacityArray.fill(0);
        this.scaleArray.fill(0);

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
        this.scaleArray[slotIndex] = 0;
    }

    /**
     * Spawn a burst of gun smoke particles at a position
     * @param {{x,y,z}} position - World position of gun barrel
     * @param {number} count - Number of particles (2-3 typical)
     */
    spawnBurst(position, count = 2) {
        for (let i = 0; i < count; i++) {
            this.spawnParticle(position);
        }
    }

    spawnParticle(position) {
        const slotIndex = this.allocateSlot();
        if (slotIndex === -1) return false;

        const offset = slotIndex * PARTICLE_STRIDE;
        const d = this.particleData;

        // Position with slight variation
        d[offset + P_POS_X] = position.x + (Math.random() - 0.5) * 0.1;
        d[offset + P_POS_Y] = position.y + (Math.random() - 0.5) * 0.1;
        d[offset + P_POS_Z] = position.z + (Math.random() - 0.5) * 0.1;

        // Velocity and drift
        d[offset + P_VEL_Y] = 0.6 + Math.random() * 0.4;
        d[offset + P_DRIFT_X] = (Math.random() - 0.5) * 0.3;
        d[offset + P_DRIFT_Z] = (Math.random() - 0.5) * 0.3;

        // Timing
        d[offset + P_AGE] = 0;
        d[offset + P_LIFESPAN] = 1.8 + Math.random() * 0.4;

        // Appearance
        d[offset + P_START_OPACITY] = 0.7 + Math.random() * 0.2;
        d[offset + P_BASE_SIZE] = 0.6 + Math.random() * 0.3;
        d[offset + P_ROT_SPEED] = (Math.random() - 0.5) * 0.5;
        d[offset + P_SLOT] = slotIndex;

        this.activeSlots.add(slotIndex);

        // Set initial position
        this._tempMatrix.makeTranslation(d[offset + P_POS_X], d[offset + P_POS_Y], d[offset + P_POS_Z]);
        this.mesh.setMatrixAt(slotIndex, this._tempMatrix);
        this.scaleArray[slotIndex] = d[offset + P_BASE_SIZE];

        return true;
    }

    update(delta) {
        if (this.activeSlots.size === 0) return;

        const cappedDelta = Math.min(delta, 0.05);
        const d = this.particleData;
        const slotsToRemove = [];

        for (const slotIndex of this.activeSlots) {
            const offset = slotIndex * PARTICLE_STRIDE;

            // Age the particle
            d[offset + P_AGE] += cappedDelta;
            const age = d[offset + P_AGE];
            const lifespan = d[offset + P_LIFESPAN];

            // Check if expired
            if (age >= lifespan) {
                slotsToRemove.push(slotIndex);
                continue;
            }

            const progress = age / lifespan;

            // Update position
            const velY = d[offset + P_VEL_Y];
            d[offset + P_POS_Y] += velY * cappedDelta;
            d[offset + P_POS_X] += d[offset + P_DRIFT_X] * cappedDelta;
            d[offset + P_POS_Z] += d[offset + P_DRIFT_Z] * cappedDelta;

            // Slow down rise over time
            d[offset + P_VEL_Y] *= 0.995;

            // Update matrix
            this._tempMatrix.makeTranslation(
                d[offset + P_POS_X],
                d[offset + P_POS_Y],
                d[offset + P_POS_Z]
            );
            this.mesh.setMatrixAt(slotIndex, this._tempMatrix);

            // Scale grows as it rises
            const baseSize = d[offset + P_BASE_SIZE];
            const growFactor = 1 + progress * 0.8;
            this.scaleArray[slotIndex] = baseSize * growFactor;

            // Opacity fades after 25% of lifespan
            const fadeStart = 0.25;
            let opacity = d[offset + P_START_OPACITY];
            if (progress > fadeStart) {
                const fadeProgress = (progress - fadeStart) / (1 - fadeStart);
                opacity *= (1 - fadeProgress);
            }
            this.opacityArray[slotIndex] = opacity > 0 ? opacity : 0;
        }

        // Remove expired particles
        for (const slotIndex of slotsToRemove) {
            this.releaseSlot(slotIndex);
        }

        // Update GPU buffers only if we have active particles
        if (this.activeSlots.size > 0 || slotsToRemove.length > 0) {
            this.mesh.instanceMatrix.needsUpdate = true;
            this.mesh.geometry.attributes.instanceOpacity.needsUpdate = true;
            this.mesh.geometry.attributes.instanceScale.needsUpdate = true;
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
    }
}

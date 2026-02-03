/**
 * DirtKickup.js
 * Small dirt/dust particle burst for bullet impacts (misses)
 * Lighter weight than SmokeEffect - one-shot burst, auto-disposes
 */

import * as THREE from 'three';

// Cached textures by color key
const textureCache = new Map();

// Color presets
const COLOR_PRESETS = {
    grey: {
        center: 'rgba(180, 180, 180, 1)',
        mid: 'rgba(160, 160, 160, 0.7)',
        edge: 'rgba(140, 140, 140, 0)'
    },
    red: {
        center: 'rgba(130, 15, 15, 1)',
        mid: 'rgba(110, 10, 10, 0.7)',
        edge: 'rgba(90, 5, 5, 0)'
    }
};

function createDirtTexture(colorKey = 'grey') {
    if (textureCache.has(colorKey)) return textureCache.get(colorKey);

    const colors = COLOR_PRESETS[colorKey] || COLOR_PRESETS.grey;

    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    gradient.addColorStop(0, colors.center);
    gradient.addColorStop(0.5, colors.mid);
    gradient.addColorStop(1, colors.edge);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    textureCache.set(colorKey, texture);
    return texture;
}

export class DirtKickup {
    /**
     * Create and trigger a dirt kickup effect
     * @param {THREE.Scene} scene - Scene to add particles to
     * @param {THREE.Vector3|{x,y,z}} position - World position for the effect
     * @param {{x,y,z}} shooterPosition - Shooter position (particles scatter away from this)
     * @param {THREE.Camera} camera - Camera for billboarding (optional)
     * @param {string} colorKey - Color preset: 'grey' for miss, 'red' for hit
     */
    constructor(scene, position, shooterPosition = null, camera = null, colorKey = 'grey') {
        this.scene = scene;
        this.camera = camera;
        this.particles = [];
        this.disposed = false;

        // Calculate direction away from shooter
        let awayAngle = Math.random() * Math.PI * 2; // Default random
        if (shooterPosition) {
            const dx = position.x - shooterPosition.x;
            const dz = position.z - shooterPosition.z;
            awayAngle = Math.atan2(dz, dx); // Angle pointing away from shooter
        }

        const texture = createDirtTexture(colorKey);
        const particleCount = 5 + Math.floor(Math.random() * 3); // 5-7 particles

        for (let i = 0; i < particleCount; i++) {
            const material = new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                opacity: 0.8 + Math.random() * 0.2,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });

            const sprite = new THREE.Sprite(material);

            // Particle size - 0.25 to 0.4 units
            const size = 0.25 + Math.random() * 0.15;
            sprite.scale.set(size, size, 1);

            // Start at impact position with slight variation
            sprite.position.set(
                position.x + (Math.random() - 0.5) * 0.3,
                position.y + 0.1,
                position.z + (Math.random() - 0.5) * 0.3
            );

            // Scatter away from shooter with some spread
            const spreadAngle = awayAngle + (Math.random() - 0.5) * 1.2; // ~70 degree spread
            const speed = 1.5 + Math.random() * 1.5;
            sprite.userData = {
                velocityX: Math.cos(spreadAngle) * speed,
                velocityY: 2 + Math.random() * 2, // Upward
                velocityZ: Math.sin(spreadAngle) * speed,
                gravity: 6 + Math.random() * 3, // Slower gravity for longer hang time
                age: 0,
                lifespan: 0.6 + Math.random() * 0.3, // 600-900ms (longer duration)
                startOpacity: material.opacity
            };

            scene.add(sprite);
            this.particles.push(sprite);
        }
    }

    /**
     * Update particles - call each frame
     * @param {number} delta - Time since last frame in seconds
     * @returns {boolean} - True if effect is still active, false if done
     */
    update(delta) {
        if (this.disposed) return false;

        let allDone = true;

        for (const particle of this.particles) {
            const data = particle.userData;
            data.age += delta;

            if (data.age < data.lifespan) {
                allDone = false;

                // Apply velocity
                particle.position.x += data.velocityX * delta;
                particle.position.y += data.velocityY * delta;
                particle.position.z += data.velocityZ * delta;

                // Apply gravity
                data.velocityY -= data.gravity * delta;

                // Fade out
                const progress = data.age / data.lifespan;
                particle.material.opacity = data.startOpacity * (1 - progress);

                // Slight size increase as it fades
                const scale = particle.scale.x * (1 + delta * 0.5);
                particle.scale.set(scale, scale, 1);
            } else {
                particle.visible = false;
            }
        }

        if (allDone) {
            this.dispose();
            return false;
        }

        return true;
    }

    /**
     * Clean up resources
     */
    dispose() {
        if (this.disposed) return;
        this.disposed = true;

        for (const particle of this.particles) {
            this.scene.remove(particle);
            particle.material.dispose();
        }
        this.particles = [];
    }
}

/**
 * Helper to spawn dirt kickup at a position offset from target (for misses)
 * @param {THREE.Scene} scene
 * @param {{x,y,z}} targetPosition - Position being shot at
 * @param {{x,y,z}} shooterPosition - Position of shooter (for directional scatter)
 * @param {THREE.Camera} camera
 * @returns {DirtKickup}
 */
export function spawnMissEffect(scene, targetPosition, shooterPosition = null, camera = null) {
    // Random offset from target (0.5-2 units away)
    const angle = Math.random() * Math.PI * 2;
    const distance = 0.5 + Math.random() * 1.5;

    const impactPos = {
        x: targetPosition.x + Math.cos(angle) * distance,
        y: targetPosition.y,
        z: targetPosition.z + Math.sin(angle) * distance
    };

    return new DirtKickup(scene, impactPos, shooterPosition, camera, 'grey');
}

/**
 * Helper to spawn red hit effect at exact target position
 * @param {THREE.Scene} scene
 * @param {{x,y,z}} targetPosition - Position of the hit target
 * @param {{x,y,z}} shooterPosition - Position of shooter (for directional scatter)
 * @param {THREE.Camera} camera
 * @returns {DirtKickup}
 */
export function spawnHitEffect(scene, targetPosition, shooterPosition = null, camera = null) {
    return new DirtKickup(scene, targetPosition, shooterPosition, camera, 'red');
}

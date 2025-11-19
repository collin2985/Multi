// File: public/SmokeEffect.js
// Reusable smoke particle effect for campfires and other structures

import * as THREE from 'three';

export class SmokeEffect {
    constructor(scene, position = { x: 0, y: 0, z: 0 }) {
        this.scene = scene;
        this.position = position;
        this.smokeParticles = [];
        this.particlePool = [];
        this.spawnTimer = 0;
        this.spawnInterval = 0.08; // Spawn rate
        this.active = true;

        this.init();
    }

    init() {
        // Load smoke texture
        const smokeTexture = new THREE.TextureLoader().load('https://s3-us-west-2.amazonaws.com/s.cdpn.io/95637/Smoke-Element.png');

        const smokeMaterial = new THREE.MeshLambertMaterial({
            color: 0x888888,
            map: smokeTexture,
            transparent: true,
            opacity: 0,
            depthWrite: false // Important for proper transparency
        });

        const smokeGeo = new THREE.PlaneGeometry(1.5, 1.5); // Scaled to game units

        // Create particle pool
        for (let p = 0; p < 30; p++) { // Fewer particles per campfire
            const particle = new THREE.Mesh(smokeGeo, smokeMaterial.clone());

            particle.position.set(
                this.position.x,
                this.position.y,
                this.position.z
            );

            particle.rotation.z = Math.random() * Math.PI * 2;

            // Initialize as inactive
            particle.userData = {
                active: false,
                startX: 0,
                startY: 0,
                startZ: 0,
                velocity: 0,
                rotationSpeed: 0,
                maxOpacity: 0,
                fadeInDuration: 0.5,
                fadeOutDuration: 1.5,
                riseHeight: 8, // Height in game units
                age: 0,
                totalLifespan: 0,
                arcStrength: 0,
                wobble: 0
            };

            particle.material.opacity = 0;
            particle.visible = false;

            this.scene.add(particle);
            this.particlePool.push(particle);
        }
    }

    spawnParticle() {
        // Find an inactive particle
        for (let i = 0; i < this.particlePool.length; i++) {
            const particle = this.particlePool[i];

            if (!particle.userData.active) {
                // Activate this particle
                particle.userData.active = true;
                particle.visible = true;

                // Set starting position with slight variation
                particle.userData.startX = this.position.x + (Math.random() * 0.3 - 0.15);
                particle.userData.startY = this.position.y + 1.0; // Start above the campfire
                particle.userData.startZ = this.position.z + (Math.random() * 0.3 - 0.15);

                particle.position.set(
                    particle.userData.startX,
                    particle.userData.startY,
                    particle.userData.startZ
                );

                // Set random properties
                particle.userData.velocity = Math.random() * 0.5 + 0.8; // Rise speed
                particle.userData.rotationSpeed = Math.random() * 0.4 - 0.2;
                particle.userData.maxOpacity = Math.random() * 0.4 + 0.3;
                particle.userData.arcStrength = Math.random() * 0.3 + 0.2;
                particle.userData.wobble = Math.random() * 0.1 + 0.05;
                particle.userData.age = 0;

                // Calculate lifespan
                const risingTime = particle.userData.riseHeight / particle.userData.velocity;
                particle.userData.totalLifespan = particle.userData.fadeInDuration + risingTime + particle.userData.fadeOutDuration;

                particle.rotation.z = Math.random() * Math.PI * 2;

                this.smokeParticles.push(particle);
                break;
            }
        }
    }

    update(delta) {
        // Only spawn new particles if active
        if (this.active) {
            this.spawnTimer += delta;
            if (this.spawnTimer >= this.spawnInterval) {
                this.spawnParticle();
                this.spawnTimer -= this.spawnInterval;
            }
        }

        // Always update existing particles so they can fade out gracefully
        this.evolveSmoke(delta);
    }

    evolveSmoke(delta) {
        // Iterate backwards so we can remove particles safely
        for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
            const particle = this.smokeParticles[i];

            if (!particle.userData.active) continue;

            // Age the particle
            particle.userData.age += delta;

            const age = particle.userData.age;
            const fadeInDuration = particle.userData.fadeInDuration;
            const fadeOutDuration = particle.userData.fadeOutDuration;
            const totalLifespan = particle.userData.totalLifespan;
            const maxOpacity = particle.userData.maxOpacity;

            // Rotate the particle
            particle.rotation.z += delta * particle.userData.rotationSpeed;

            // Calculate how far up the particle should be
            const distanceTraveled = particle.userData.velocity * age;

            // Position Y - straight up
            particle.position.y = particle.userData.startY + distanceTraveled;

            // Calculate progress through the rise (0 to 1)
            let riseProgress = distanceTraveled / particle.userData.riseHeight;
            riseProgress = Math.min(riseProgress, 1);

            // Wind-like drift - starts gentle, increases as it rises
            const windDrift = Math.pow(riseProgress, 1.8);

            // Apply leftward drift that accelerates with height
            const leftwardDrift = -windDrift * 3 * particle.userData.arcStrength;

            // Reduced wobble for cleaner arc
            const wobble = Math.sin(age * 2) * particle.userData.wobble * 0.3;

            particle.position.x = particle.userData.startX + leftwardDrift + wobble;

            // Z-axis drift for depth
            particle.position.z = particle.userData.startZ +
                Math.cos(age * 1.5) * 0.1 * (1 + riseProgress * 0.5);

            // Calculate opacity based on age
            let opacity = 0;

            // Phase 1: Fade IN
            if (age < fadeInDuration) {
                opacity = (age / fadeInDuration) * maxOpacity;
            }
            // Phase 2: Full opacity
            else if (age < totalLifespan - fadeOutDuration) {
                opacity = maxOpacity;
            }
            // Phase 3: Fade OUT
            else if (age < totalLifespan) {
                const fadeOutProgress = (age - (totalLifespan - fadeOutDuration)) / fadeOutDuration;
                opacity = maxOpacity * (1 - fadeOutProgress);
            }

            particle.material.opacity = Math.max(0, opacity);

            // Deactivate particle when it completes its lifecycle
            if (particle.userData.age >= particle.userData.totalLifespan) {
                particle.userData.active = false;
                particle.visible = false;
                particle.material.opacity = 0;
                this.smokeParticles.splice(i, 1); // Remove from active array
            }
        }
    }

    // Update the position (useful if campfire moves or is placed dynamically)
    setPosition(x, y, z) {
        this.position.x = x;
        this.position.y = y;
        this.position.z = z;
    }

    // Stop spawning new particles
    stop() {
        this.active = false;
    }

    // Resume spawning particles
    start() {
        this.active = true;
    }

    // Check if all particles have faded out
    hasActiveParticles() {
        return this.smokeParticles.length > 0;
    }

    // Clean up all particles and remove from scene
    dispose() {
        this.active = false;

        // Remove all particles from scene
        for (const particle of this.particlePool) {
            this.scene.remove(particle);
            particle.geometry.dispose();
            particle.material.dispose();
        }

        this.particlePool = [];
        this.smokeParticles = [];
    }
}

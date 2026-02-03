/**
 * FallingTreeSystem.js
 * Manages falling tree animations when pine/apple trees are cut
 *
 * Animation phases:
 * - Phase 1 (0-1s): Rotate 90 degrees to the left from player's perspective
 * - Phase 2 (1-2s): Sink 5 units straight down
 * - After 2s: Remove mesh and dispose geometry
 */

import * as THREE from 'three';

export class FallingTreeSystem {
    constructor(scene) {
        this.scene = scene;
        this.fallingTrees = new Map(); // objectId -> animation data

        // Shared materials (created once, reused)
        this.materials = new Map();

        // Billboard configs (must match BillboardSystem.js exactly)
        this.configs = {
            pine: { width: 4, height: 6, yOffset: -0.5, brightness: 0.95, colorR: 1.0, colorG: 1.0, colorB: 1.0, texture: './models/pinefinal.webp' },
            apple: { width: 8.4, height: 5, yOffset: -1.3, brightness: 0.55, colorR: 1.0, colorG: 1.0, colorB: 1.0, texture: './models/applefinal.webp' }
        };

        // Animation timing constants
        this.FALL_DURATION = 1000;  // ms for rotation phase
        this.SINK_DURATION = 1000;  // ms for sinking phase
        this.SINK_DISTANCE = 5;     // units to sink

        // Reusable objects to avoid GC
        this._tempQuaternion = new THREE.Quaternion();

        this.initializeMaterials();
    }

    initializeMaterials() {
        const loader = new THREE.TextureLoader();

        for (const [treeType, config] of Object.entries(this.configs)) {
            const texture = loader.load(config.texture);
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.magFilter = THREE.LinearFilter;

            // Apply brightness and color tone to match billboard shader:
            // adjustedColor = texColor.rgb * colorTone * brightness
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                alphaTest: 0.3,
                side: THREE.DoubleSide,
                color: new THREE.Color(
                    config.colorR * config.brightness,
                    config.colorG * config.brightness,
                    config.colorB * config.brightness
                )
            });

            this.materials.set(treeType, material);
        }
    }

    /**
     * Spawn a falling tree animation
     * @param {THREE.Object3D} treeObject - The tree being cut
     * @param {THREE.Vector3} playerPosition - Player position at cut moment
     * @returns {boolean} - True if animation was spawned
     */
    spawnFallingTree(treeObject, playerPosition) {
        const treeType = treeObject.userData?.modelType;
        if (treeType !== 'pine' && treeType !== 'apple') {
            return false;
        }

        const config = this.configs[treeType];
        const material = this.materials.get(treeType);
        if (!material) {
            return false;
        }

        const objectId = treeObject.userData?.objectId;
        if (!objectId) {
            return false;
        }

        // Prevent duplicate spawns - if already animating this tree, clean up the old one first
        if (this.fallingTrees.has(objectId)) {
            this.removeFallingTree(objectId);
        }

        const position = treeObject.position.clone();

        // Calculate camera-facing orientation (horizontal only)
        const toPlayer = new THREE.Vector3()
            .subVectors(playerPosition, position)
            .setY(0)
            .normalize();

        // Left axis = perpendicular to player direction, horizontal
        // cross(toPlayer, worldUp) gives left direction
        const leftAxis = new THREE.Vector3()
            .crossVectors(toPlayer, new THREE.Vector3(0, 1, 0))
            .normalize();

        // Create geometry with pivot at bottom (matching billboard)
        const geometry = new THREE.PlaneGeometry(config.width, config.height);
        geometry.translate(0, config.height / 2 + config.yOffset, 0);

        // Create mesh
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(position);

        // Orient to face player (cylindrical billboarding)
        const targetPos = new THREE.Vector3(playerPosition.x, mesh.position.y, playerPosition.z);
        mesh.lookAt(targetPos);

        // Store initial quaternion for animation
        const initialQuaternion = mesh.quaternion.clone();

        this.scene.add(mesh);

        this.fallingTrees.set(objectId, {
            mesh,
            geometry,  // Store for disposal
            startTime: performance.now(),
            rotationAxis: leftAxis,
            initialQuaternion,
            originalY: position.y,
            treeType
        });

        return true;
    }

    /**
     * Update all falling tree animations
     * @param {number} deltaTime - Time since last frame (ms)
     */
    update(deltaTime) {
        const now = performance.now();
        const toRemove = [];

        for (const [objectId, data] of this.fallingTrees) {
            const elapsed = now - data.startTime;
            const totalDuration = this.FALL_DURATION + this.SINK_DURATION;

            if (elapsed >= totalDuration) {
                // Animation complete - mark for removal
                toRemove.push(objectId);
                continue;
            }

            if (elapsed < this.FALL_DURATION) {
                // Phase 1: Rotation (0 to 90 degrees)
                const progress = elapsed / this.FALL_DURATION;
                const angle = progress * (Math.PI / 2);

                // Apply rotation around left axis relative to initial orientation
                this._tempQuaternion.setFromAxisAngle(data.rotationAxis, angle);
                data.mesh.quaternion.copy(data.initialQuaternion);
                data.mesh.quaternion.premultiply(this._tempQuaternion);
            } else {
                // Phase 2: Sinking
                const sinkProgress = (elapsed - this.FALL_DURATION) / this.SINK_DURATION;

                // Keep rotation at 90 degrees
                this._tempQuaternion.setFromAxisAngle(data.rotationAxis, Math.PI / 2);
                data.mesh.quaternion.copy(data.initialQuaternion);
                data.mesh.quaternion.premultiply(this._tempQuaternion);

                // Sink down
                data.mesh.position.y = data.originalY - (sinkProgress * this.SINK_DISTANCE);
            }
        }

        // Remove completed animations
        for (const objectId of toRemove) {
            this.removeFallingTree(objectId);
        }
    }

    /**
     * Remove a falling tree and dispose its resources
     */
    removeFallingTree(objectId) {
        const data = this.fallingTrees.get(objectId);
        if (!data) return;

        this.scene.remove(data.mesh);
        data.geometry.dispose();
        // Material is shared, do not dispose

        this.fallingTrees.delete(objectId);
    }

    /**
     * Get count of active falling trees (for debugging)
     */
    getActiveCount() {
        return this.fallingTrees.size;
    }

    /**
     * Dispose all resources
     */
    dispose() {
        // Remove all active falling trees
        for (const objectId of this.fallingTrees.keys()) {
            this.removeFallingTree(objectId);
        }

        // Dispose shared materials
        for (const material of this.materials.values()) {
            if (material.map) material.map.dispose();
            material.dispose();
        }
        this.materials.clear();
    }
}

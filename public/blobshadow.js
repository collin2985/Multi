// File: public/blobshadow.js
// Location: C:\Users\colli\Desktop\test Horses\Horses\public\blobshadow.js

import * as THREE from 'three';

/**
 * Shared shadow texture - created once and reused by all blob shadows
 */
class ShadowTextureManager {
    constructor() {
        this.texture = null;
    }

    getTexture() {
        if (!this.texture) {
            // Create a canvas to draw a radial gradient shadow
            const canvas = document.createElement('canvas');
            canvas.width = 128;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');

            // Draw radial gradient (dark in center, transparent at edges)
            const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
            gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
            gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.5)');
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 128, 128);

            // Create texture from canvas (shared by all shadows)
            this.texture = new THREE.CanvasTexture(canvas);
        }
        return this.texture;
    }

    dispose() {
        if (this.texture) {
            this.texture.dispose();
            this.texture = null;
        }
    }
}

// Singleton instance
const shadowTextureManager = new ShadowTextureManager();

/**
 * Simple blob shadow system - creates circular shadows under objects
 * No shadow mapping, no flickering, super fast
 * Uses shared texture for all instances (much more efficient!)
 */
export class BlobShadow {
    /**
     * Create a blob shadow for an object
     * @param {THREE.Object3D} targetObject - Object to attach shadow to
     * @param {THREE.Scene} scene - Scene to add shadow to
     * @param {number} size - Diameter of shadow circle
     * @param {number} opacity - Shadow opacity (0-1, default 0.3)
     */
    constructor(targetObject, scene, size = 2, opacity = 0.3) {
        this.targetObject = targetObject;
        this.scene = scene;
        this.size = size;
        this.opacity = opacity;

        // Create shadow sprite
        this.createShadowSprite();
    }

    createShadowSprite() {
        // Get shared texture (created once, reused by all shadows)
        const texture = shadowTextureManager.getTexture();

        // Create material (each shadow has its own material for opacity control)
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: this.opacity,
            depthWrite: false,
            color: 0x000000
        });

        // Create geometry (a flat circle)
        const geometry = new THREE.CircleGeometry(this.size / 2, 16);

        // Create mesh
        this.shadowMesh = new THREE.Mesh(geometry, material);
        this.shadowMesh.rotation.x = -Math.PI / 2; // Rotate to lie flat on ground
        this.shadowMesh.renderOrder = -1; // Render before other objects

        this.scene.add(this.shadowMesh);
    }

    /**
     * Update shadow position to follow target object
     * @param {Function} getTerrainHeight - Function to get terrain height at (x, z)
     * @param {THREE.Vector3} lightPosition - Position of the directional light (optional)
     * @param {Function} getTerrainNormal - Function to get terrain normal at (x, z) (optional)
     */
    update(getTerrainHeight, lightPosition = null, getTerrainNormal = null) {
        if (!this.targetObject || !this.shadowMesh) return;

        // Position shadow under the object
        const targetPos = this.targetObject.position;

        // Calculate shadow offset based on light direction
        let shadowX = targetPos.x;
        let shadowZ = targetPos.z;

        if (lightPosition) {
            // Calculate 2D direction from object to light (top-down view)
            const lightDirX = lightPosition.x - targetPos.x;
            const lightDirZ = lightPosition.z - targetPos.z;
            const lightDist = Math.sqrt(lightDirX * lightDirX + lightDirZ * lightDirZ);

            if (lightDist > 0.01) {
                // Normalize light direction
                const normX = lightDirX / lightDist;
                const normZ = lightDirZ / lightDist;

                // Shadow moves AWAY from light (opposite direction)
                // Small offset for the small scale of the game
                const offsetDistance = 0.05;
                shadowX = targetPos.x - normX * offsetDistance;
                shadowZ = targetPos.z - normZ * offsetDistance;
            }
        }

        // Get terrain height at shadow position
        const groundY = getTerrainHeight ? getTerrainHeight(shadowX, shadowZ) : 0;

        // Apply 0.125 unit left offset for more realistic shadow positioning
        const offsetX = shadowX - 0.125;

        // Place shadow slightly above terrain to avoid z-fighting
        this.shadowMesh.position.set(offsetX, groundY + 0.05, shadowZ);

        // Align shadow with terrain slope if normal is available
        if (getTerrainNormal) {
            const normal = getTerrainNormal(shadowX, shadowZ);
            if (normal) {
                // Create rotation to align with terrain normal
                // Default up vector is (0, 1, 0)
                const up = new THREE.Vector3(0, 1, 0);
                const quaternion = new THREE.Quaternion();
                quaternion.setFromUnitVectors(up, normal);

                // Apply rotation (keeping the flat orientation)
                this.shadowMesh.quaternion.copy(quaternion);
                this.shadowMesh.rotateX(-Math.PI / 2); // Still needs base rotation to lie flat
            }
        }
    }

    /**
     * Set shadow opacity
     * @param {number} opacity - New opacity (0-1)
     */
    setOpacity(opacity) {
        this.opacity = opacity;
        if (this.shadowMesh && this.shadowMesh.material) {
            this.shadowMesh.material.opacity = opacity;
        }
    }

    /**
     * Set shadow size
     * @param {number} size - New diameter
     */
    setSize(size) {
        this.size = size;
        if (this.shadowMesh) {
            this.shadowMesh.scale.set(size / 2, size / 2, 1);
        }
    }

    /**
     * Remove shadow from scene
     */
    dispose() {
        if (this.shadowMesh) {
            this.scene.remove(this.shadowMesh);
            if (this.shadowMesh.geometry) this.shadowMesh.geometry.dispose();
            if (this.shadowMesh.material) {
                // Don't dispose the shared texture, only the material
                this.shadowMesh.material.dispose();
            }
            this.shadowMesh = null;
        }
    }
}

/**
 * Export shadow texture manager for cleanup if needed
 */
export { shadowTextureManager };

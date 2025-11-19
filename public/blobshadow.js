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
 * GPU Instanced Shadow Manager - renders ALL shadows with a single InstancedMesh
 * Massive performance improvement over individual meshes
 */
class ShadowInstanceManager {
    constructor(scene, maxInstances = 15000) {
        this.scene = scene;
        this.maxInstances = maxInstances;
        this.freeSlots = []; // Stack of freed instance IDs for reuse
        this.nextInstanceId = 0;
        this.instancedMesh = null;
        this.tempMatrix = new THREE.Matrix4();
        this.tempPosition = new THREE.Vector3();
        this.tempQuaternion = new THREE.Quaternion();
        this.tempScale = new THREE.Vector3();

        this.createInstancedMesh();
    }

    createInstancedMesh() {
        // Single shared geometry for all shadows
        const geometry = new THREE.CircleGeometry(0.5, 16); // Base radius 0.5, scale per instance

        // Get shared texture
        const texture = shadowTextureManager.getTexture();

        // Single shared material with transparency
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
            color: 0x000000
        });

        // Create instanced mesh with max capacity
        this.instancedMesh = new THREE.InstancedMesh(geometry, material, this.maxInstances);
        // Don't rotate the InstancedMesh itself - each instance will have its own rotation
        this.instancedMesh.renderOrder = -1;

        // Initialize all instances as hidden (scale to 0)
        for (let i = 0; i < this.maxInstances; i++) {
            this.tempMatrix.makeScale(0, 0, 0);
            this.instancedMesh.setMatrixAt(i, this.tempMatrix);
        }
        this.instancedMesh.instanceMatrix.needsUpdate = true;

        this.scene.add(this.instancedMesh);
    }

    /**
     * Allocate a new shadow instance
     * @returns {number} Instance ID
     */
    allocateInstance() {
        // Reuse freed slot if available
        if (this.freeSlots.length > 0) {
            return this.freeSlots.pop();
        }

        // Allocate new slot if capacity allows
        if (this.nextInstanceId < this.maxInstances) {
            return this.nextInstanceId++;
        }

        console.warn('Shadow instance pool exhausted!');
        return -1;
    }

    /**
     * Free a shadow instance for reuse
     * @param {number} instanceId
     */
    freeInstance(instanceId) {
        if (instanceId < 0 || instanceId >= this.maxInstances) return;

        // Hide the instance by scaling to 0
        this.tempMatrix.makeScale(0, 0, 0);
        this.instancedMesh.setMatrixAt(instanceId, this.tempMatrix);
        this.instancedMesh.instanceMatrix.needsUpdate = true;

        // Add to free pool
        this.freeSlots.push(instanceId);
    }

    /**
     * Update shadow instance transform
     * @param {number} instanceId
     * @param {number} x - World X position
     * @param {number} y - World Y position (height)
     * @param {number} z - World Z position
     * @param {number} size - Shadow diameter
     * @param {THREE.Quaternion} rotation - Optional rotation quaternion
     */
    updateInstance(instanceId, x, y, z, size, rotation = null) {
        if (instanceId < 0 || instanceId >= this.maxInstances) return;

        this.tempPosition.set(x, y, z);
        this.tempScale.set(size, size, 1);

        if (rotation) {
            this.tempQuaternion.copy(rotation);
        } else {
            // Default: flat on ground (rotate -90 degrees on X axis)
            this.tempQuaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
        }

        this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
        this.instancedMesh.setMatrixAt(instanceId, this.tempMatrix);
        this.instancedMesh.instanceMatrix.needsUpdate = true;
    }

    /**
     * Hide a shadow instance (set scale to 0)
     * @param {number} instanceId
     */
    hideInstance(instanceId) {
        if (instanceId < 0 || instanceId >= this.maxInstances) return;

        // Get current matrix
        this.instancedMesh.getMatrixAt(instanceId, this.tempMatrix);
        this.tempMatrix.decompose(this.tempPosition, this.tempQuaternion, this.tempScale);

        // Set scale to 0
        this.tempScale.set(0, 0, 0);
        this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);

        this.instancedMesh.setMatrixAt(instanceId, this.tempMatrix);
        this.instancedMesh.instanceMatrix.needsUpdate = true;
    }

    /**
     * Show a shadow instance (restore its size)
     * @param {number} instanceId
     * @param {number} size - Shadow diameter
     */
    showInstance(instanceId, size) {
        if (instanceId < 0 || instanceId >= this.maxInstances) return;

        // Get current matrix
        this.instancedMesh.getMatrixAt(instanceId, this.tempMatrix);
        this.tempMatrix.decompose(this.tempPosition, this.tempQuaternion, this.tempScale);

        // Restore scale
        this.tempScale.set(size, size, 1);
        this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);

        this.instancedMesh.setMatrixAt(instanceId, this.tempMatrix);
        this.instancedMesh.instanceMatrix.needsUpdate = true;
    }

    dispose() {
        if (this.instancedMesh) {
            this.scene.remove(this.instancedMesh);
            if (this.instancedMesh.geometry) this.instancedMesh.geometry.dispose();
            if (this.instancedMesh.material) this.instancedMesh.material.dispose();
            this.instancedMesh = null;
        }
    }
}

// Global singleton shadow instance manager (created when first shadow is added)
let globalShadowManager = null;

/**
 * Initialize the global shadow manager
 * @param {THREE.Scene} scene
 */
export function initShadowManager(scene) {
    if (!globalShadowManager) {
        globalShadowManager = new ShadowInstanceManager(scene);
    }
    return globalShadowManager;
}

/**
 * Get the global shadow manager
 */
export function getShadowManager() {
    return globalShadowManager;
}

/**
 * Lightweight blob shadow - now just a reference to an instance in the InstancedMesh
 */
export class BlobShadow {
    /**
     * Create a blob shadow for an object
     * @param {THREE.Object3D} targetObject - Object to attach shadow to
     * @param {THREE.Scene} scene - Scene to add shadow to
     * @param {number} size - Diameter of shadow circle
     * @param {number} opacity - Shadow opacity (0-1, ignored in instanced version)
     */
    constructor(targetObject, scene, size = 2, opacity = 0.3) {
        this.targetObject = targetObject;
        this.scene = scene;
        this.size = size;
        this.opacity = opacity;

        // Initialize global shadow manager if needed
        if (!globalShadowManager) {
            initShadowManager(scene);
        }

        // Allocate an instance from the pool
        this.instanceId = globalShadowManager.allocateInstance();

        if (this.instanceId === -1) {
            console.warn('Failed to allocate shadow instance');
            return;
        }

        // Initialize instance position (hidden at 0,0,0 until first update)
        globalShadowManager.hideInstance(this.instanceId);
    }

    /**
     * Update shadow position to follow target object
     * @param {Function} getTerrainHeight - Function to get terrain height at (x, z)
     * @param {THREE.Vector3} lightPosition - Position of the directional light (optional)
     * @param {Function} getTerrainNormal - Function to get terrain normal at (x, z) (optional)
     */
    update(getTerrainHeight, lightPosition = null, getTerrainNormal = null) {
        if (!this.targetObject || this.instanceId === -1 || !globalShadowManager) return;

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
        const finalY = groundY + 0.05;

        // Create base flat rotation (lie flat on ground)
        const flatRotation = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0),
            -Math.PI / 2
        );

        // Handle terrain normal alignment if available
        let quaternion = flatRotation;
        if (getTerrainNormal) {
            const normal = getTerrainNormal(shadowX, shadowZ);
            if (normal) {
                const up = new THREE.Vector3(0, 1, 0);
                const normalRotation = new THREE.Quaternion();
                normalRotation.setFromUnitVectors(up, normal);
                // Combine normal rotation with flat rotation
                quaternion = normalRotation.multiply(flatRotation);
            }
        }

        // Update instance transform
        globalShadowManager.updateInstance(
            this.instanceId,
            offsetX,
            finalY,
            shadowZ,
            this.size,
            quaternion
        );
    }

    /**
     * Set shadow visibility
     * @param {boolean} visible
     */
    setVisible(visible) {
        if (this.instanceId === -1 || !globalShadowManager) return;

        if (visible) {
            globalShadowManager.showInstance(this.instanceId, this.size);
        } else {
            globalShadowManager.hideInstance(this.instanceId);
        }
    }

    /**
     * Set shadow size
     * @param {number} size - New diameter
     */
    setSize(size) {
        this.size = size;
        // Size will be updated on next update() call
    }

    /**
     * Remove shadow from scene
     */
    dispose() {
        if (this.instanceId !== -1 && globalShadowManager) {
            globalShadowManager.freeInstance(this.instanceId);
            this.instanceId = -1;
        }
    }
}

/**
 * Export shadow texture manager for cleanup if needed
 */
export { shadowTextureManager, ShadowInstanceManager };

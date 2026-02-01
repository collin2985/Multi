/**
 * AnimationSystem.js
 * Manages animations for dynamic objects (ships, flags, etc.)
 */

import { CONFIG } from '../config.js';
import { getTerrainHeight } from '../core/TerrainAccess.js';

export class AnimationSystem {
    constructor(scene) {
        this.scene = scene;
        this.animatedObjects = new Map();  // objectId -> animation data
    }

    /**
     * Register a ship for wave animation
     * @param {THREE.Object3D} ship - Ship object to animate
     */
    registerShip(ship) {
        if (!ship || !ship.userData.objectId) {
            console.warn('Cannot register ship: missing object or objectId');
            return;
        }

        const objectId = ship.userData.objectId;

        // Store original transform to apply animation relative to it
        const originalRotation = {
            x: ship.rotation.x,
            y: ship.rotation.y,
            z: ship.rotation.z
        };
        const originalY = ship.position.y;

        // Cache terrain height for stationary boats (avoids recalculating every frame)
        const cachedTerrainY = getTerrainHeight(ship.position.x, ship.position.z);

        this.animatedObjects.set(objectId, {
            type: 'ship',
            object: ship,
            originalRotation: originalRotation,
            originalY: originalY,
            startTime: Date.now(),
            cachedTerrainY: cachedTerrainY,
            lastPosX: ship.position.x,
            lastPosZ: ship.position.z
        });
    }

    /**
     * Update all animated objects
     * @param {number} deltaTime - Time since last frame in seconds
     */
    update(deltaTime) {
        const time = Date.now() * 0.001;  // Convert to seconds

        for (const [objectId, data] of this.animatedObjects) {
            if (data.type === 'ship') {
                this.updateShip(data, time);
            }
        }
    }

    /**
     * Update ship/boat wave animation
     * @param {object} data - Animation data for ship/boat
     * @param {number} time - Current time in seconds
     */
    updateShip(data, time) {
        const { object, originalRotation } = data;

        if (!object || !object.parent) {
            // Object was removed from scene, unregister it
            this.unregister(object?.userData?.objectId);
            return;
        }

        // Skip wave animation for ships showing as billboards (LOD culling)
        // _lodOpacity is set by StructureModelSystem: 0 = billboard, 1 = 3D model
        const lodOpacity = object.userData._lodOpacity;
        if (lodOpacity !== undefined && lodOpacity < 0.1) {
            return;
        }

        // Get properties based on object type (ship or boat)
        const objectType = object.userData.modelType || 'ship';
        const props = CONFIG.CONSTRUCTION.STRUCTURE_PROPERTIES[objectType] ||
                      CONFIG.CONSTRUCTION.STRUCTURE_PROPERTIES.ship;

        // Calculate water depth at boat position for wave damping
        // This matches the shader's waveDamping formula with dead zone
        // Use cached terrain height for stationary boats (only recalculate if moved)
        let terrainY = data.cachedTerrainY;
        if (terrainY === undefined ||
            object.position.x !== data.lastPosX ||
            object.position.z !== data.lastPosZ) {
            terrainY = getTerrainHeight(object.position.x, object.position.z);
            data.cachedTerrainY = terrainY;
            data.lastPosX = object.position.x;
            data.lastPosZ = object.position.z;
        }
        const depth = Math.max(0, -terrainY);  // Water surface is at y=0
        // Match shader: TERRAIN_CONFIG.WAVE_DAMPING_MIN_DEPTH=0.5, MAX_DEPTH=3.0
        const damping = Math.max(0, Math.min(1, (depth - 0.5) / 2.5));

        // Gentle rocking motion on Z axis (side to side) - damped near shore
        const rockZ = Math.sin(time * props.animationSpeed) * props.animationAmplitude * damping;

        // Slower pitch on X axis (front to back) - damped near shore
        const rockX = Math.sin(time * props.animationSpeed * 0.6) * (props.animationAmplitude * 0.4) * damping;

        // Get accurate Gerstner wave height at position, damped to match shader
        const waterSystem = window.game?.waterSystem;
        const rawWaveHeight = waterSystem ?
            waterSystem.getWaveHeight(object.position.x, object.position.z) : 0;
        const waveHeight = rawWaveHeight * damping;

        // Apply animation relative to original transform
        object.rotation.x = originalRotation.x + rockX;

        // Only reset Y rotation for non-peer boats (peer boats are rotated by AvatarManager)
        if (!object.userData.isPeerBoat) {
            object.rotation.y = originalRotation.y;
        }

        object.rotation.z = originalRotation.z + rockZ;
        object.position.y = waveHeight + 0.2;
    }

    /**
     * Unregister an object from animation
     * @param {string} objectId - Object ID to unregister
     */
    unregister(objectId) {
        if (this.animatedObjects.has(objectId)) {
            this.animatedObjects.delete(objectId);
        }
    }

    /**
     * Check if an object is registered for animation
     * @param {string} objectId - Object ID to check
     * @returns {boolean}
     */
    isRegistered(objectId) {
        return this.animatedObjects.has(objectId);
    }

    /**
     * Get count of currently animated objects
     * @returns {number}
     */
    getAnimatedCount() {
        return this.animatedObjects.size;
    }

    /**
     * Clear all animated objects (useful for chunk unloading)
     */
    clear() {
        this.animatedObjects.clear();
    }
}

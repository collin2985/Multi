/**
 * AnimationSystem.js
 * Manages animations for dynamic objects (ships, flags, etc.)
 */

import { CONFIG } from '../config.js';

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

        // Store original rotation to apply animation relative to it
        const originalRotation = {
            x: ship.rotation.x,
            y: ship.rotation.y,
            z: ship.rotation.z
        };

        this.animatedObjects.set(objectId, {
            type: 'ship',
            object: ship,
            originalRotation: originalRotation,
            startTime: Date.now()
        });

        console.log(`[AnimationSystem] Registered ship ${objectId} for animation`);
    }

    /**
     * Update all animated objects
     * @param {number} deltaTime - Time since last frame in seconds
     */
    update(deltaTime) {
        const time = Date.now() * 0.001;  // Convert to seconds

        this.animatedObjects.forEach((data, objectId) => {
            if (data.type === 'ship') {
                this.updateShip(data, time);
            }
        });
    }

    /**
     * Update ship wave animation
     * @param {object} data - Animation data for ship
     * @param {number} time - Current time in seconds
     */
    updateShip(data, time) {
        const { object, originalRotation } = data;

        if (!object || !object.parent) {
            // Object was removed from scene, unregister it
            this.unregister(object?.userData?.objectId);
            return;
        }

        const shipProps = CONFIG.CONSTRUCTION.STRUCTURE_PROPERTIES.ship;

        // Gentle rocking motion on Z axis (side to side)
        const rockZ = Math.sin(time * shipProps.animationSpeed) * shipProps.animationAmplitude;

        // Slower pitch on X axis (front to back)
        const rockX = Math.sin(time * shipProps.animationSpeed * 0.6) * (shipProps.animationAmplitude * 0.4);

        // Apply animation relative to original rotation
        object.rotation.x = originalRotation.x + rockX;
        object.rotation.y = originalRotation.y;  // Keep Y (heading) unchanged
        object.rotation.z = originalRotation.z + rockZ;
    }

    /**
     * Unregister an object from animation
     * @param {string} objectId - Object ID to unregister
     */
    unregister(objectId) {
        if (this.animatedObjects.has(objectId)) {
            console.log(`[AnimationSystem] Unregistered ${objectId} from animation`);
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
        console.log(`[AnimationSystem] Clearing ${this.animatedObjects.size} animated objects`);
        this.animatedObjects.clear();
    }
}

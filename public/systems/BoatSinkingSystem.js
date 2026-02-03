/**
 * BoatSinkingSystem.js
 * Handles sinking animation for boats destroyed by merchant ship collision
 * Animation: 90 degree roll right, sink 20 units, fade out over 7 seconds
 */

export class BoatSinkingSystem {
    constructor(scene, animationSystem) {
        this.scene = scene;
        this.animationSystem = animationSystem;
        this.sinkingBoats = new Map(); // entityId -> {mesh, startTime, startY, startRotZ, onComplete}
    }

    /**
     * Start sinking animation for a boat
     * @param {THREE.Object3D} mesh - The boat mesh
     * @param {string} entityId - Entity ID for tracking
     * @param {function} onComplete - Callback when sinking completes
     */
    startSinking(mesh, entityId, onComplete) {
        if (!mesh) {
            console.warn(`[BoatSinking] startSinking called with null mesh for entity ${entityId}`);
            return;
        }

        // Unregister from wave animation (we're taking over)
        if (this.animationSystem) {
            this.animationSystem.unregister(entityId);
        }

        // Collect materials once and set up transparency (avoids traverse every frame)
        const materials = [];
        mesh.traverse(child => {
            if (child.material) {
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach(mat => {
                    mat.transparent = true;
                    if (!materials.includes(mat)) {  // Avoid duplicates (shared materials)
                        materials.push(mat);
                    }
                });
            }
        });

        // Store initial state with cached materials
        this.sinkingBoats.set(entityId, {
            mesh,
            materials,
            startTime: Date.now(),
            startY: mesh.position.y,
            startRotZ: mesh.rotation.z,
            onComplete
        });
    }

    /**
     * Update all sinking boats - call each frame
     */
    update() {
        if (this.sinkingBoats.size === 0) return;

        const now = Date.now();
        const SINK_DURATION = 7000; // 7 seconds
        const SINK_DEPTH = 20;      // 20 units down
        const ROLL_ANGLE = Math.PI / 2; // 90 degrees

        for (const [entityId, data] of this.sinkingBoats) {
            const elapsed = now - data.startTime;
            const progress = Math.min(elapsed / SINK_DURATION, 1);

            // Ease-in for more dramatic effect (slow start, faster as it sinks)
            const eased = progress * progress;

            // Roll 90 degrees to right (positive Z rotation)
            data.mesh.rotation.z = data.startRotZ + (ROLL_ANGLE * eased);

            // Sink straight down
            data.mesh.position.y = data.startY - (SINK_DEPTH * eased);

            // Fade opacity (using cached materials - no traverse needed)
            const opacity = 1 - eased;
            for (const mat of data.materials) {
                mat.opacity = opacity;
            }

            // Complete - remove from scene and call callback
            if (progress >= 1) {

                // Remove from scene
                if (this.scene) {
                    this.scene.remove(data.mesh);
                }

                // Dispose geometry/materials
                data.mesh.traverse(child => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                });

                // Call completion callback (triggers player death)
                if (data.onComplete) {
                    data.onComplete();
                }

                this.sinkingBoats.delete(entityId);
            }
        }
    }

    /**
     * Check if a boat is currently sinking
     * @param {string} entityId
     * @returns {boolean}
     */
    isSinking(entityId) {
        return this.sinkingBoats.has(entityId);
    }

    /**
     * Clear all sinking boats (e.g., on disconnect)
     */
    clear() {
        this.sinkingBoats.clear();
    }
}

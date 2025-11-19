/**
 * DeathSystem.js
 * Manages entity death animations and state
 */

export class DeathSystem {
    constructor() {
        this.DEATH_DURATION = 500; // 0.5 seconds
    }

    /**
     * Update death animation for an entity
     * @param {THREE.Object3D} entity - Entity to animate
     * @param {number} deathStartTime - Timestamp when death started
     * @param {number} deltaTime - Delta time (unused but kept for compatibility)
     * @param {number} fallDirection - Direction to fall (-1 left, 1 right)
     * @param {boolean} isLocal - Whether this is the local player (unused but kept for compatibility)
     * @returns {boolean} - True if animation complete, false if still animating
     */
    updateDeathAnimation(entity, deathStartTime, deltaTime, fallDirection = 1, isLocal = false) {
        const elapsed = Date.now() - deathStartTime;

        if (elapsed < this.DEATH_DURATION) {
            // Calculate rotation progress (0 to 1)
            const progress = elapsed / this.DEATH_DURATION;

            // Rotate 90 degrees to fall along world X axis (east/west)
            // fallDirection: -1 for west, 1 for east
            // Compensate for entity's Y rotation so fall direction is always east/west in world space
            if (entity.children[0]) {
                const yRot = entity.rotation.y;
                const angle = (Math.PI / 2) * progress * fallDirection;
                entity.children[0].rotation.x = angle * Math.sin(yRot);
                entity.children[0].rotation.z = angle * Math.cos(yRot);
            }

            return false; // Still animating
        } else {
            // Death animation complete
            if (entity.children[0]) {
                const yRot = entity.rotation.y;
                const angle = (Math.PI / 2) * fallDirection;
                entity.children[0].rotation.x = angle * Math.sin(yRot);
                entity.children[0].rotation.z = angle * Math.cos(yRot);
            }
            return true; // Animation complete
        }
    }

    /**
     * Mark entity as dead (peer or local)
     * @param {THREE.Object3D} entity - Entity object
     * @param {boolean} isPeer - Whether this is a peer entity
     * @returns {object} - Death data {fallDirection, deathStartTime, deathRotationProgress}
     */
    markEntityDead(entity, isPeer = false) {
        // Random fall direction: -1 for left, 1 for right
        const fallDirection = Math.random() < 0.5 ? -1 : 1;
        const deathStartTime = Date.now();

        if (isPeer) {
            // Store in userData for peer entities
            entity.userData.isDead = true;
            entity.userData.deathStartTime = deathStartTime;
            entity.userData.deathRotationProgress = 0;
            entity.userData.fallDirection = fallDirection;
        }

        return {
            fallDirection,
            deathStartTime,
            deathRotationProgress: 0
        };
    }

    /**
     * Stop animations for dead entity
     * @param {THREE.AnimationMixer} mixer - Animation mixer to stop
     */
    stopAnimations(mixer) {
        if (mixer) {
            mixer.stopAllAction();
        }
    }

    /**
     * Get death duration
     * @returns {number} - Death animation duration in milliseconds
     */
    getDeathDuration() {
        return this.DEATH_DURATION;
    }

    /**
     * Set death duration
     * @param {number} duration - Duration in milliseconds
     */
    setDeathDuration(duration) {
        this.DEATH_DURATION = duration;
    }
}

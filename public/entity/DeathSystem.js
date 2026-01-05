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
            } else {
                // Fallback: animate entity directly if no children (unusual model hierarchy)
                console.warn('[DeathSystem] No children[0], animating entity directly');
                const angle = (Math.PI / 2) * progress * fallDirection;
                entity.rotation.z = angle;
            }

            return false; // Still animating
        } else {
            // Death animation complete
            if (entity.children[0]) {
                const yRot = entity.rotation.y;
                const angle = (Math.PI / 2) * fallDirection;
                entity.children[0].rotation.x = angle * Math.sin(yRot);
                entity.children[0].rotation.z = angle * Math.cos(yRot);
            } else {
                // Fallback: animate entity directly
                const angle = (Math.PI / 2) * fallDirection;
                entity.rotation.z = angle;
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
            console.log(`[DeathSystem] Marked peer dead: isDead=${entity.userData.isDead} startTime=${deathStartTime} fallDir=${fallDirection} children=${entity.children?.length}`);
        }

        return {
            fallDirection,
            deathStartTime,
            deathRotationProgress: 0
        };
    }

    /**
     * Stop animations for dead entity and freeze at idle frame 1
     * @param {THREE.AnimationMixer} mixer - Animation mixer to stop
     * @param {THREE.AnimationAction} idleAction - Idle animation action (optional)
     */
    stopAnimations(mixer, idleAction = null) {
        if (mixer) {
            // Stop all animations
            mixer.stopAllAction();

            // Freeze at idle frame 1 if idle animation is available
            if (idleAction) {
                idleAction.reset();
                const frameTime = 1 / 24;  // Frame 1 at 24fps
                idleAction.time = frameTime;
                idleAction.weight = 1.0;
                idleAction.play();
                idleAction.paused = true;
                // Update mixer once to apply the pose (prevents T-pose)
                mixer.update(0.001);
            }
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

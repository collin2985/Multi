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
     * @param {boolean} isLocal - Whether this is the local player (affects rotation target)
     * @returns {boolean} - True if animation complete, false if still animating
     */
    updateDeathAnimation(entity, deathStartTime, deltaTime, fallDirection = 1, isLocal = false) {
        const elapsed = Date.now() - deathStartTime;

        // Determine rotation target:
        // - Local player: playerObject contains playerMesh as children[0], rotate that
        // - Peer avatar: avatarMesh IS the model (cloned scene), rotate it directly
        const rotationTarget = isLocal ? (entity.children[0] || entity) : entity;

        if (elapsed < this.DEATH_DURATION) {
            // Calculate rotation progress (0 to 1)
            const progress = elapsed / this.DEATH_DURATION;

            // Rotate 90 degrees to fall along world X axis (east/west)
            // fallDirection: -1 for west, 1 for east
            // Compensate for entity's Y rotation so fall direction is always east/west in world space
            const yRot = entity.rotation.y;
            const angle = (Math.PI / 2) * progress * fallDirection;
            rotationTarget.rotation.x = angle * Math.sin(yRot);
            rotationTarget.rotation.z = angle * Math.cos(yRot);

            return false; // Still animating
        } else {
            // Death animation complete - hold final rotation
            const yRot = entity.rotation.y;
            const angle = (Math.PI / 2) * fallDirection;
            rotationTarget.rotation.x = angle * Math.sin(yRot);
            rotationTarget.rotation.z = angle * Math.cos(yRot);
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

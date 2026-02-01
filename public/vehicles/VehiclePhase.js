/**
 * VehiclePhase.js - Vehicle phase state machine
 *
 * Manages vehicle boarding/piloting/disembarking phases with validated transitions.
 * Replaces string-based phase tracking with a proper state machine.
 */

// Enum for all valid phases
export const VehiclePhase = Object.freeze({
    IDLE: 'idle',               // Not on vehicle (replaces null)
    BOARDING: 'boarding',       // Lerp animation mounting (1000ms)
    PILOTING: 'piloting',       // Active WASD control
    CREWING: 'crewing',         // Ship2 gunner (manning artillery, not piloting)
    DISEMBARKING: 'disembarking' // Lerp animation dismounting (1000ms)
});

// Valid transitions map
// Each key maps to an array of valid target phases
const VALID_TRANSITIONS = {
    [VehiclePhase.IDLE]: [VehiclePhase.BOARDING, VehiclePhase.CREWING],  // CREWING for external gunners boarding directly
    [VehiclePhase.BOARDING]: [VehiclePhase.PILOTING, VehiclePhase.IDLE],
    [VehiclePhase.PILOTING]: [VehiclePhase.DISEMBARKING, VehiclePhase.CREWING, VehiclePhase.IDLE],
    [VehiclePhase.CREWING]: [VehiclePhase.DISEMBARKING, VehiclePhase.PILOTING, VehiclePhase.IDLE],
    [VehiclePhase.DISEMBARKING]: [VehiclePhase.IDLE]
};

/**
 * VehiclePhaseManager - State machine for vehicle phases
 *
 * Validates all phase transitions and logs them for debugging.
 * Tracks previous phase to handle special cases like gunner disembark.
 */
export class VehiclePhaseManager {
    constructor() {
        this._phase = VehiclePhase.IDLE;
        this._previousPhase = null;
        this._transitionTime = 0;
    }

    get phase() {
        return this._phase;
    }

    get previousPhase() {
        return this._previousPhase;
    }

    get transitionTime() {
        return this._transitionTime;
    }

    /**
     * Check if a transition to the given phase is valid
     * @param {string} newPhase - Target phase from VehiclePhase enum
     * @returns {boolean}
     */
    canTransitionTo(newPhase) {
        const validTargets = VALID_TRANSITIONS[this._phase];
        return validTargets && validTargets.includes(newPhase);
    }

    /**
     * Attempt a validated transition to a new phase
     * @param {string} newPhase - Target phase from VehiclePhase enum
     * @param {string} reason - Debug label for logging
     * @returns {boolean} - True if transition succeeded
     */
    transitionTo(newPhase, reason = '') {
        if (!this.canTransitionTo(newPhase)) {
            console.warn(`[VehiclePhase] Invalid transition: ${this._phase} -> ${newPhase} (${reason})`);
            return false;
        }
        this._previousPhase = this._phase;
        this._phase = newPhase;
        this._transitionTime = performance.now();
        return true;
    }

    /**
     * Force a transition without validation (for edge cases like death/disconnect)
     * @param {string} newPhase - Target phase from VehiclePhase enum
     * @param {string} reason - Debug label for logging
     */
    forceTransition(newPhase, reason = '') {
        this._previousPhase = this._phase;
        this._phase = newPhase;
        this._transitionTime = performance.now();
    }

    /**
     * Reset to IDLE state (convenience method for cleanup)
     */
    reset() {
        this.forceTransition(VehiclePhase.IDLE, 'reset');
    }

    // Convenience phase checks
    isIdle() {
        return this._phase === VehiclePhase.IDLE;
    }

    isBoarding() {
        return this._phase === VehiclePhase.BOARDING;
    }

    isPiloting() {
        return this._phase === VehiclePhase.PILOTING;
    }

    isCrewing() {
        return this._phase === VehiclePhase.CREWING;
    }

    isDisembarking() {
        return this._phase === VehiclePhase.DISEMBARKING;
    }

    isActive() {
        return this._phase !== VehiclePhase.IDLE;
    }

    /**
     * Check if player was crewing (gunner) before current disembark
     * Used to determine gunner vs pilot disembark path
     * @returns {boolean}
     */
    wasCrewingBeforeDisembark() {
        return this._phase === VehiclePhase.DISEMBARKING &&
               this._previousPhase === VehiclePhase.CREWING;
    }
}

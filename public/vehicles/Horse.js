/**
 * Horse.js
 * Land vehicle for mounted movement
 *
 * Thin wrapper around LandVehicle with sound integration.
 * Movement, animation, and towing are handled by LandVehicle.
 */

import { LandVehicle } from './LandVehicle.js';
import { CONFIG } from '../config.js';

export class Horse extends LandVehicle {
    constructor() {
        super('horse', CONFIG.VEHICLES.horse);

        // Sound reference (set by game.js)
        this.sound = null;
    }

    /**
     * Set sound object for horse movement sounds
     * @param {THREE.Audio|THREE.PositionalAudio} audioObject
     */
    setSound(audioObject) {
        this.sound = audioObject;
    }

    /**
     * Update sound based on movement state
     * @param {number} speedRatio - Current speed as fraction of max (0-1)
     * @param {boolean} isTurning - Whether turning in place
     * @param {boolean} isMoving - Whether actively moving forward
     */
    updateSound(speedRatio, isTurning, isMoving) {
        if (!this.sound) return;

        if (isMoving || isTurning) {
            // Playback rate: 0.5 (turning) to 1.0 (full speed)
            const rate = isMoving ? 0.5 + speedRatio * 0.5 : 0.5;
            this.sound.setPlaybackRate(rate);
            if (!this.sound.isPlaying) {
                this.sound.play();
            }
        } else {
            // Stopped - stop sound
            if (this.sound.isPlaying) {
                this.sound.stop();
            }
        }
    }

    /**
     * @override
     */
    disembark() {
        // Stop sound before disembarking
        if (this.sound?.isPlaying) {
            this.sound.stop();
        }
        super.disembark();
    }

    /**
     * @override
     */
    cleanup() {
        // Stop sound and clear reference
        if (this.sound?.isPlaying) {
            this.sound.stop();
        }
        this.sound = null;
        super.cleanup();
    }
}

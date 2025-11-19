// File: public/audio.js
// Location: C:\Users\colli\Desktop\test Horses\Horses\public\audio.js
// Audio manager for game sounds using THREE.js Audio API

import * as THREE from 'three';

export class AudioManager {
    constructor(camera) {
        this.camera = camera;
        this.listener = new THREE.AudioListener();
        this.camera.add(this.listener);

        this.audioLoader = new THREE.AudioLoader();
        this.sounds = {};
        this.isInitialized = false;
        this.contextResumed = false;
    }

    /**
     * Resume AudioContext after user gesture (required by browsers)
     * Call this on first user interaction (click, touch, etc.)
     */
    resumeContext() {
        if (!this.contextResumed && this.listener.context) {
            if (this.listener.context.state === 'suspended') {
                this.listener.context.resume().then(() => {
                    this.contextResumed = true;
                });
            } else {
                this.contextResumed = true;
            }
        }
    }

    async loadSounds() {
        try {
            // Load axe sound
            const axeBuffer = await this.loadSound('sounds/axe.mp3');
            this.sounds.axe = axeBuffer;

            // Load saw sound
            const sawBuffer = await this.loadSound('sounds/saw.mp3');
            this.sounds.saw = sawBuffer;

            // Load pickaxe sound
            const pickaxeBuffer = await this.loadSound('sounds/pickaxe.mp3');
            this.sounds.pickaxe = pickaxeBuffer;

            // Load chisel sound
            const chiselBuffer = await this.loadSound('sounds/chisel.mp3');
            this.sounds.chisel = chiselBuffer;

            // Load hammer sound
            const hammerBuffer = await this.loadSound('sounds/hammer.mp3');
            this.sounds.hammer = hammerBuffer;

            // Load rifle sound
            const rifleBuffer = await this.loadSound('sounds/rifle.mp3');
            this.sounds.rifle = rifleBuffer;

            // Load grass sound
            const grassBuffer = await this.loadSound('sounds/grass.mp3');
            this.sounds.grass = grassBuffer;

            // Load fishing sound
            const fishingBuffer = await this.loadSound('sounds/fishing.mp3');
            this.sounds.fishing = fishingBuffer;

            // Load ocean sound (ambient)
            const oceanBuffer = await this.loadSound('sounds/ocean.mp3');
            this.sounds.ocean = oceanBuffer;

            // Load plains sound (ambient)
            const plainsBuffer = await this.loadSound('sounds/plains.mp3');
            this.sounds.plains = plainsBuffer;

            // Load mountain sound (ambient)
            const mountainBuffer = await this.loadSound('sounds/mountain.mp3');
            this.sounds.mountain = mountainBuffer;

            // Load campfire sound (ambient)
            const campfireBuffer = await this.loadSound('sounds/campfire.mp3');
            this.sounds.campfire = campfireBuffer;

            this.isInitialized = true;
        } catch (error) {
            console.error('Failed to load sounds:', error);
        }
    }

    loadSound(path) {
        return new Promise((resolve, reject) => {
            this.audioLoader.load(
                path,
                (buffer) => resolve(buffer),
                (progress) => {
                    // Loading progress
                },
                (error) => reject(error)
            );
        });
    }

    playAxeSound() {
        if (!this.isInitialized || !this.sounds.axe) {
            console.warn('Axe sound not loaded');
            return null;
        }

        const sound = new THREE.Audio(this.listener);
        sound.setBuffer(this.sounds.axe);
        sound.setLoop(true);
        sound.setVolume(0.5);
        sound.play();

        // Auto-stop after 10 seconds
        setTimeout(() => {
            if (sound.isPlaying) {
                sound.stop();
            }
        }, 10000);

        return sound;
    }

    playSawSound() {
        if (!this.isInitialized || !this.sounds.saw) {
            console.warn('Saw sound not loaded');
            return null;
        }

        const sound = new THREE.Audio(this.listener);
        sound.setBuffer(this.sounds.saw);
        sound.setLoop(false);  // Saw is 12s, we'll stop it at 10s
        sound.setVolume(0.5);
        sound.play();

        // Auto-stop after 10 seconds (original file is 12s)
        setTimeout(() => {
            if (sound.isPlaying) {
                sound.stop();
            }
        }, 10000);

        return sound;
    }

    playPickaxeSound() {
        if (!this.isInitialized || !this.sounds.pickaxe) {
            console.warn('Pickaxe sound not loaded');
            return null;
        }

        const sound = new THREE.Audio(this.listener);
        sound.setBuffer(this.sounds.pickaxe);
        sound.setLoop(true);  // Pickaxe is 1s, loop it for 10s
        sound.setVolume(0.1875);
        sound.play();

        // Auto-stop after 10 seconds
        setTimeout(() => {
            if (sound.isPlaying) {
                sound.stop();
            }
        }, 10000);

        return sound;
    }

    playChiselSound() {
        if (!this.isInitialized || !this.sounds.chisel) {
            console.warn('Chisel sound not loaded');
            return null;
        }

        const sound = new THREE.Audio(this.listener);
        sound.setBuffer(this.sounds.chisel);
        sound.setLoop(false);  // Chisel plays once for 6s duration
        sound.setVolume(0.5);
        sound.play();

        // Auto-stop after 6 seconds
        setTimeout(() => {
            if (sound.isPlaying) {
                sound.stop();
            }
        }, 6000);

        return sound;
    }

    playHammerSound() {
        if (!this.isInitialized || !this.sounds.hammer) {
            console.warn('Hammer sound not loaded');
            return null;
        }

        const sound = new THREE.Audio(this.listener);
        sound.setBuffer(this.sounds.hammer);
        sound.setLoop(false);  // Hammer is 11s, we'll stop it at 6s
        sound.setVolume(0.5);
        sound.play();

        // Auto-stop after 6 seconds (original file is 11s)
        setTimeout(() => {
            if (sound.isPlaying) {
                sound.stop();
            }
        }, 6000);

        return sound;
    }

    playGrassSound() {
        if (!this.isInitialized || !this.sounds.grass) {
            console.warn('Grass sound not loaded');
            return null;
        }

        const sound = new THREE.Audio(this.listener);
        sound.setBuffer(this.sounds.grass);
        sound.setLoop(false);
        sound.setVolume(0.5);
        sound.play();

        // Fade out over 2 seconds starting at 4 seconds (total 6 seconds)
        const fadeOutStart = 4000; // Start fade at 4 seconds
        const fadeOutDuration = 2000; // Fade for 2 seconds
        const startVolume = 0.5;
        const fadeSteps = 20; // Number of volume steps
        const stepInterval = fadeOutDuration / fadeSteps;

        setTimeout(() => {
            if (sound.isPlaying) {
                let step = 0;
                const fadeInterval = setInterval(() => {
                    step++;
                    const progress = step / fadeSteps;
                    const newVolume = startVolume * (1 - progress);
                    sound.setVolume(Math.max(0, newVolume));

                    if (step >= fadeSteps) {
                        clearInterval(fadeInterval);
                        sound.stop();
                    }
                }, stepInterval);
            }
        }, fadeOutStart);

        return sound;
    }

    playFishingSound() {
        if (!this.isInitialized || !this.sounds.fishing) {
            console.warn('Fishing sound not loaded');
            return null;
        }

        const sound = new THREE.Audio(this.listener);
        sound.setBuffer(this.sounds.fishing);
        sound.setLoop(false);
        sound.setVolume(0.5);
        sound.play();

        // Fade out over 2 seconds starting at 8 seconds (total 10 seconds)
        const fadeOutStart = 8000; // Start fade at 8 seconds
        const fadeOutDuration = 2000; // Fade for 2 seconds
        const startVolume = 0.5;
        const fadeSteps = 20; // Number of volume steps
        const stepInterval = fadeOutDuration / fadeSteps;

        setTimeout(() => {
            if (sound.isPlaying) {
                let step = 0;
                const fadeInterval = setInterval(() => {
                    step++;
                    const progress = step / fadeSteps;
                    const newVolume = startVolume * (1 - progress);
                    sound.setVolume(Math.max(0, newVolume));

                    if (step >= fadeSteps) {
                        clearInterval(fadeInterval);
                        sound.stop();
                    }
                }, stepInterval);
            }
        }, fadeOutStart);

        return sound;
    }

    /**
     * Play positional sound attached to an avatar (for other players)
     * @param {string} soundType - 'axe', 'saw', 'pickaxe', 'chisel', 'hammer', 'rifle', 'grass', or 'fishing'
     * @param {THREE.Object3D} avatar - Avatar to attach sound to
     * @returns {THREE.PositionalAudio} The created sound object
     */
    playPositionalSound(soundType, avatar) {
        if (!this.isInitialized) {
            console.warn('Audio system not initialized');
            return null;
        }

        let buffer, duration;
        if (soundType === 'axe') {
            buffer = this.sounds.axe;
            duration = 10000;
        } else if (soundType === 'saw') {
            buffer = this.sounds.saw;
            duration = 10000;
        } else if (soundType === 'pickaxe') {
            buffer = this.sounds.pickaxe;
            duration = 10000;
        } else if (soundType === 'chisel') {
            buffer = this.sounds.chisel;
            duration = 6000;
        } else if (soundType === 'hammer') {
            buffer = this.sounds.hammer;
            duration = 6000;
        } else if (soundType === 'rifle') {
            buffer = this.sounds.rifle;
            duration = 3000; // Allow 3 seconds for full rifle sound
        } else if (soundType === 'grass') {
            buffer = this.sounds.grass;
            duration = 6000;
        } else if (soundType === 'fishing') {
            buffer = this.sounds.fishing;
            duration = 10000;
        }

        if (!buffer) {
            console.warn(`${soundType} sound not loaded`);
            return null;
        }

        // Create positional audio (3D spatial sound)
        const sound = new THREE.PositionalAudio(this.listener);
        sound.setBuffer(buffer);
        sound.setRefDistance(5);  // Full volume within 5 units
        sound.setMaxDistance(50); // Silent at 50 units
        sound.setRolloffFactor(1); // Linear falloff
        sound.setDistanceModel('linear');

        // Set loop based on sound type (axe and pickaxe loop, saw and chisel don't)
        if (soundType === 'axe' || soundType === 'pickaxe') {
            sound.setLoop(true);
        } else {
            sound.setLoop(false);
        }

        // Set volume based on sound type
        if (soundType === 'pickaxe') {
            sound.setVolume(0.1875); // Reduced by 50%
        } else {
            sound.setVolume(0.5); // Base volume
        }

        // Attach sound to avatar as child (moves with avatar)
        avatar.add(sound);
        sound.play();

        // Grass and fishing sounds get special fade-out treatment
        if (soundType === 'grass' || soundType === 'fishing') {
            // Grass: 4s full, 2s fade (6s total)
            // Fishing: 8s full, 2s fade (10s total)
            const fadeOutStart = soundType === 'grass' ? 4000 : 8000;
            const fadeOutDuration = 2000; // Fade for 2 seconds
            const startVolume = 0.5;
            const fadeSteps = 20;
            const stepInterval = fadeOutDuration / fadeSteps;

            setTimeout(() => {
                if (sound.isPlaying) {
                    let step = 0;
                    const fadeInterval = setInterval(() => {
                        step++;
                        const progress = step / fadeSteps;
                        const newVolume = startVolume * (1 - progress);
                        sound.setVolume(Math.max(0, newVolume));

                        if (step >= fadeSteps) {
                            clearInterval(fadeInterval);
                            sound.stop();
                            avatar.remove(sound);
                            sound.disconnect();
                        }
                    }, stepInterval);
                }
            }, fadeOutStart);
        } else {
            // Auto-stop and cleanup after duration for other sounds
            setTimeout(() => {
                if (sound.isPlaying) {
                    sound.stop();
                }
                avatar.remove(sound);
                sound.disconnect();
            }, duration);
        }

        return sound;
    }

    cleanup() {
        if (this.listener) {
            this.camera.remove(this.listener);
        }
    }
}

/**
 * OceanSoundManager
 * Manages ambient ocean sound with seamless crossfade looping
 * Uses two audio instances to crossfade between loops for smooth playback
 */
export class OceanSoundManager {
    constructor(audioManager) {
        this.audioManager = audioManager;
        this.listener = audioManager.listener;

        // Two audio instances for crossfading
        this.instanceA = null;
        this.instanceB = null;

        // Track which instance is currently active
        this.activeInstance = null;
        this.inactiveInstance = null;

        // Playback tracking
        this.elapsedTime = 0;
        this.audioDuration = 0;
        this.crossfadeDuration = 6; // 6 seconds for crossfade
        this.isPlaying = false;
        this.isCrossfading = false;

        // Volume control
        this.targetVolume = 0;
        this.currentVolume = 0;

        // Warning flag to prevent spam
        this.hasWarnedNotLoaded = false;
    }

    /**
     * Start playing ocean sound with fade-in
     */
    start() {
        if (this.isPlaying) return;

        const oceanBuffer = this.audioManager.sounds.ocean;
        if (!oceanBuffer) {
            if (!this.hasWarnedNotLoaded) {
                console.warn('Ocean sound not loaded yet, waiting...');
                this.hasWarnedNotLoaded = true;
            }
            return;
        }

        // Get audio duration from buffer
        this.audioDuration = oceanBuffer.duration;

        // Create first instance
        this.instanceA = new THREE.Audio(this.listener);
        this.instanceA.setBuffer(oceanBuffer);
        this.instanceA.setLoop(false); // Manual loop control for crossfade
        this.instanceA.setVolume(0);
        this.instanceA.play();

        // Create second instance (ready for crossfade)
        this.instanceB = new THREE.Audio(this.listener);
        this.instanceB.setBuffer(oceanBuffer);
        this.instanceB.setLoop(false);
        this.instanceB.setVolume(0);

        // Set active instance
        this.activeInstance = this.instanceA;
        this.inactiveInstance = this.instanceB;

        this.elapsedTime = 0;
        this.isPlaying = true;
        this.isCrossfading = false;
        this.currentVolume = 0;
    }

    /**
     * Update ocean sound - handle crossfade and volume
     * @param {number} deltaTime - Time since last update (seconds)
     * @param {number} targetVolume - Desired volume (0-1)
     */
    update(deltaTime, targetVolume) {
        if (!this.isPlaying) return;

        this.targetVolume = targetVolume;

        // Get actual playback time from the audio source instead of manually tracking
        // This is more accurate than deltaTime accumulation
        const currentTime = this.activeInstance.source ? this.activeInstance.source.context.currentTime - this.activeInstance._startedAt : 0;
        this.elapsedTime = currentTime;

        // Check if we need to start crossfade (6 seconds before end)
        const crossfadeStartTime = this.audioDuration - this.crossfadeDuration;

        if (this.elapsedTime >= crossfadeStartTime && !this.isCrossfading) {
            // Start crossfade - ensure inactive instance is ready to play
            this.isCrossfading = true;

            // Reset the inactive instance if it's not playing
            if (!this.inactiveInstance.isPlaying) {
                // Reconnect the buffer to ensure clean playback
                const oceanBuffer = this.audioManager.sounds.ocean;
                this.inactiveInstance.setBuffer(oceanBuffer);
            }

            this.inactiveInstance.setVolume(0);
            this.inactiveInstance.play();
        }

        // Handle crossfade
        if (this.isCrossfading) {
            const crossfadeProgress = (this.elapsedTime - crossfadeStartTime) / this.crossfadeDuration;

            if (crossfadeProgress >= 1.0) {
                // Crossfade complete - swap instances
                const temp = this.activeInstance;
                this.activeInstance = this.inactiveInstance;
                this.inactiveInstance = temp;

                // Stop old instance
                this.inactiveInstance.stop();
                this.inactiveInstance.setVolume(0);

                // Reset tracking - new active instance just started
                this.elapsedTime = 0;
                this.isCrossfading = false;
            } else {
                // Apply crossfade volumes
                const fadeOut = 1.0 - crossfadeProgress;
                const fadeIn = crossfadeProgress;

                const activeVol = fadeOut * this.targetVolume;
                const inactiveVol = fadeIn * this.targetVolume;

                this.activeInstance.setVolume(activeVol);
                this.inactiveInstance.setVolume(inactiveVol);
            }
        } else {
            // Normal playback - just update volume
            this.activeInstance.setVolume(this.targetVolume);
        }

        // Safety check: if audio ended but we didn't crossfade, restart
        if (this.elapsedTime >= this.audioDuration && !this.isCrossfading) {
            this.activeInstance.stop();
            this.activeInstance.play();
            this.elapsedTime = 0;
        }
    }

    /**
     * Stop ocean sound with fade-out
     */
    stop() {
        if (!this.isPlaying) return;

        // Stop both instances - check if playing first to avoid null errors
        if (this.instanceA && this.instanceA.isPlaying) {
            this.instanceA.stop();
        }
        if (this.instanceB && this.instanceB.isPlaying) {
            this.instanceB.stop();
        }

        // Clean up references
        this.instanceA = null;
        this.instanceB = null;
        this.activeInstance = null;
        this.inactiveInstance = null;
        this.isPlaying = false;
        this.isCrossfading = false;
        this.elapsedTime = 0;
    }
}

/**
 * PlainsSoundManager
 * Manages ambient plains sound with seamless crossfade looping
 * Uses two audio instances to crossfade between loops for smooth playback
 */
export class PlainsSoundManager {
    constructor(audioManager) {
        this.audioManager = audioManager;
        this.listener = audioManager.listener;

        // Two audio instances for crossfading
        this.instanceA = null;
        this.instanceB = null;

        // Track which instance is currently active
        this.activeInstance = null;
        this.inactiveInstance = null;

        // Playback tracking
        this.elapsedTime = 0;
        this.audioDuration = 0;
        this.crossfadeDuration = 6; // 6 seconds for crossfade
        this.isPlaying = false;
        this.isCrossfading = false;

        // Volume control
        this.targetVolume = 0;
        this.currentVolume = 0;

        // Warning flag to prevent spam
        this.hasWarnedNotLoaded = false;
    }

    /**
     * Start playing plains sound with fade-in
     */
    start() {
        if (this.isPlaying) return;

        const plainsBuffer = this.audioManager.sounds.plains;
        if (!plainsBuffer) {
            if (!this.hasWarnedNotLoaded) {
                console.warn('Plains sound not loaded yet, waiting...');
                this.hasWarnedNotLoaded = true;
            }
            return;
        }

        // Get audio duration from buffer
        this.audioDuration = plainsBuffer.duration;

        // Create first instance
        this.instanceA = new THREE.Audio(this.listener);
        this.instanceA.setBuffer(plainsBuffer);
        this.instanceA.setLoop(false); // Manual loop control for crossfade
        this.instanceA.setVolume(0);
        this.instanceA.play();

        // Create second instance (ready for crossfade)
        this.instanceB = new THREE.Audio(this.listener);
        this.instanceB.setBuffer(plainsBuffer);
        this.instanceB.setLoop(false);
        this.instanceB.setVolume(0);

        // Set active instance
        this.activeInstance = this.instanceA;
        this.inactiveInstance = this.instanceB;

        this.elapsedTime = 0;
        this.isPlaying = true;
        this.isCrossfading = false;
        this.currentVolume = 0;
    }

    /**
     * Update plains sound - handle crossfade and volume
     * @param {number} deltaTime - Time since last update (seconds)
     * @param {number} targetVolume - Desired volume (0-1)
     */
    update(deltaTime, targetVolume) {
        if (!this.isPlaying) return;

        this.targetVolume = targetVolume;

        // Get actual playback time from the audio source instead of manually tracking
        // This is more accurate than deltaTime accumulation
        const currentTime = this.activeInstance.source ? this.activeInstance.source.context.currentTime - this.activeInstance._startedAt : 0;
        this.elapsedTime = currentTime;

        // Check if we need to start crossfade (6 seconds before end)
        const crossfadeStartTime = this.audioDuration - this.crossfadeDuration;

        if (this.elapsedTime >= crossfadeStartTime && !this.isCrossfading) {
            // Start crossfade - ensure inactive instance is ready to play
            this.isCrossfading = true;

            // Reset the inactive instance if it's not playing
            if (!this.inactiveInstance.isPlaying) {
                // Reconnect the buffer to ensure clean playback
                const plainsBuffer = this.audioManager.sounds.plains;
                this.inactiveInstance.setBuffer(plainsBuffer);
            }

            this.inactiveInstance.setVolume(0);
            this.inactiveInstance.play();
        }

        // Handle crossfade
        if (this.isCrossfading) {
            const crossfadeProgress = (this.elapsedTime - crossfadeStartTime) / this.crossfadeDuration;

            if (crossfadeProgress >= 1.0) {
                // Crossfade complete - swap instances
                const temp = this.activeInstance;
                this.activeInstance = this.inactiveInstance;
                this.inactiveInstance = temp;

                // Stop old instance
                this.inactiveInstance.stop();
                this.inactiveInstance.setVolume(0);

                // Reset tracking - new active instance just started
                this.elapsedTime = 0;
                this.isCrossfading = false;
            } else {
                // Apply crossfade volumes
                const fadeOut = 1.0 - crossfadeProgress;
                const fadeIn = crossfadeProgress;

                const activeVol = fadeOut * this.targetVolume;
                const inactiveVol = fadeIn * this.targetVolume;

                this.activeInstance.setVolume(activeVol);
                this.inactiveInstance.setVolume(inactiveVol);
            }
        } else {
            // Normal playback - just update volume
            this.activeInstance.setVolume(this.targetVolume);
        }

        // Safety check: if audio ended but we didn't crossfade, restart
        if (this.elapsedTime >= this.audioDuration && !this.isCrossfading) {
            this.activeInstance.stop();
            this.activeInstance.play();
            this.elapsedTime = 0;
        }
    }

    /**
     * Stop plains sound with fade-out
     */
    stop() {
        if (!this.isPlaying) return;

        // Stop both instances - check if playing first to avoid null errors
        if (this.instanceA && this.instanceA.isPlaying) {
            this.instanceA.stop();
        }
        if (this.instanceB && this.instanceB.isPlaying) {
            this.instanceB.stop();
        }

        // Clean up references
        this.instanceA = null;
        this.instanceB = null;
        this.activeInstance = null;
        this.inactiveInstance = null;
        this.isPlaying = false;
        this.isCrossfading = false;
        this.elapsedTime = 0;
    }
}

/**
 * MountainSoundManager
 * Manages ambient mountain sound with seamless crossfade looping
 * Uses two audio instances to crossfade between loops for smooth playback
 */
export class MountainSoundManager {
    constructor(audioManager) {
        this.audioManager = audioManager;
        this.listener = audioManager.listener;

        // Two audio instances for crossfading
        this.instanceA = null;
        this.instanceB = null;

        // Track which instance is currently active
        this.activeInstance = null;
        this.inactiveInstance = null;

        // Playback tracking
        this.elapsedTime = 0;
        this.audioDuration = 0;
        this.crossfadeDuration = 6; // 6 seconds for crossfade
        this.isPlaying = false;
        this.isCrossfading = false;

        // Volume control
        this.targetVolume = 0;
        this.currentVolume = 0;

        // Warning flag to prevent spam
        this.hasWarnedNotLoaded = false;
    }

    /**
     * Start playing mountain sound with fade-in
     */
    start() {
        if (this.isPlaying) return;

        const mountainBuffer = this.audioManager.sounds.mountain;
        if (!mountainBuffer) {
            if (!this.hasWarnedNotLoaded) {
                console.warn('Mountain sound not loaded yet, waiting...');
                this.hasWarnedNotLoaded = true;
            }
            return;
        }

        // Get audio duration from buffer
        this.audioDuration = mountainBuffer.duration;

        // Create first instance
        this.instanceA = new THREE.Audio(this.listener);
        this.instanceA.setBuffer(mountainBuffer);
        this.instanceA.setLoop(false); // Manual loop control for crossfade
        this.instanceA.setVolume(0);
        this.instanceA.play();

        // Create second instance (ready for crossfade)
        this.instanceB = new THREE.Audio(this.listener);
        this.instanceB.setBuffer(mountainBuffer);
        this.instanceB.setLoop(false);
        this.instanceB.setVolume(0);

        // Set active instance
        this.activeInstance = this.instanceA;
        this.inactiveInstance = this.instanceB;

        this.elapsedTime = 0;
        this.isPlaying = true;
        this.isCrossfading = false;
        this.currentVolume = 0;
    }

    /**
     * Update mountain sound - handle crossfade and volume
     * @param {number} deltaTime - Time since last update (seconds)
     * @param {number} targetVolume - Desired volume (0-1)
     */
    update(deltaTime, targetVolume) {
        if (!this.isPlaying) return;

        this.targetVolume = targetVolume;

        // Get actual playback time from the audio source instead of manually tracking
        // This is more accurate than deltaTime accumulation
        const currentTime = this.activeInstance.source ? this.activeInstance.source.context.currentTime - this.activeInstance._startedAt : 0;
        this.elapsedTime = currentTime;

        // Check if we need to start crossfade (6 seconds before end)
        const crossfadeStartTime = this.audioDuration - this.crossfadeDuration;

        if (this.elapsedTime >= crossfadeStartTime && !this.isCrossfading) {
            // Start crossfade - ensure inactive instance is ready to play
            this.isCrossfading = true;

            // Reset the inactive instance if it's not playing
            if (!this.inactiveInstance.isPlaying) {
                // Reconnect the buffer to ensure clean playback
                const mountainBuffer = this.audioManager.sounds.mountain;
                this.inactiveInstance.setBuffer(mountainBuffer);
            }

            this.inactiveInstance.setVolume(0);
            this.inactiveInstance.play();
        }

        // Handle crossfade
        if (this.isCrossfading) {
            const crossfadeProgress = (this.elapsedTime - crossfadeStartTime) / this.crossfadeDuration;

            if (crossfadeProgress >= 1.0) {
                // Crossfade complete - swap instances
                const temp = this.activeInstance;
                this.activeInstance = this.inactiveInstance;
                this.inactiveInstance = temp;

                // Stop old instance
                this.inactiveInstance.stop();
                this.inactiveInstance.setVolume(0);

                // Reset tracking - new active instance just started
                this.elapsedTime = 0;
                this.isCrossfading = false;
            } else {
                // Apply crossfade volumes
                const fadeOut = 1.0 - crossfadeProgress;
                const fadeIn = crossfadeProgress;

                const activeVol = fadeOut * this.targetVolume;
                const inactiveVol = fadeIn * this.targetVolume;

                this.activeInstance.setVolume(activeVol);
                this.inactiveInstance.setVolume(inactiveVol);
            }
        } else {
            // Normal playback - just update volume
            this.activeInstance.setVolume(this.targetVolume);
        }

        // Safety check: if audio ended but we didn't crossfade, restart
        if (this.elapsedTime >= this.audioDuration && !this.isCrossfading) {
            this.activeInstance.stop();
            this.activeInstance.play();
            this.elapsedTime = 0;
        }
    }

    /**
     * Stop mountain sound with fade-out
     */
    stop() {
        if (!this.isPlaying) return;

        // Stop both instances - check if playing first to avoid null errors
        if (this.instanceA && this.instanceA.isPlaying) {
            this.instanceA.stop();
        }
        if (this.instanceB && this.instanceB.isPlaying) {
            this.instanceB.stop();
        }

        // Clean up references
        this.instanceA = null;
        this.instanceB = null;
        this.activeInstance = null;
        this.inactiveInstance = null;
        this.isPlaying = false;
        this.isCrossfading = false;
        this.elapsedTime = 0;
    }
}

/**
 * CampfireSoundManager
 * Manages ambient campfire sound with seamless crossfade looping
 * Uses two audio instances to crossfade between loops for smooth playback
 */
export class CampfireSoundManager {
    constructor(audioManager) {
        this.audioManager = audioManager;
        this.listener = audioManager.listener;

        // Two audio instances for crossfading
        this.instanceA = null;
        this.instanceB = null;

        // Track which instance is currently active
        this.activeInstance = null;
        this.inactiveInstance = null;

        // Playback tracking
        this.elapsedTime = 0;
        this.audioDuration = 0;
        this.crossfadeDuration = 6; // 6 seconds for crossfade
        this.isPlaying = false;
        this.isCrossfading = false;

        // Volume control
        this.targetVolume = 0;
        this.currentVolume = 0;

        // Warning flag to prevent spam
        this.hasWarnedNotLoaded = false;
    }

    /**
     * Start playing campfire sound with fade-in
     */
    start() {
        if (this.isPlaying) return;

        const campfireBuffer = this.audioManager.sounds.campfire;
        if (!campfireBuffer) {
            if (!this.hasWarnedNotLoaded) {
                console.warn('Campfire sound not loaded yet, waiting...');
                this.hasWarnedNotLoaded = true;
            }
            return;
        }

        // Get audio duration from buffer
        this.audioDuration = campfireBuffer.duration;

        // Create first instance
        this.instanceA = new THREE.Audio(this.listener);
        this.instanceA.setBuffer(campfireBuffer);
        this.instanceA.setLoop(false); // Manual loop control for crossfade
        this.instanceA.setVolume(0);
        this.instanceA.play();

        // Create second instance (ready for crossfade)
        this.instanceB = new THREE.Audio(this.listener);
        this.instanceB.setBuffer(campfireBuffer);
        this.instanceB.setLoop(false);
        this.instanceB.setVolume(0);

        // Set active instance
        this.activeInstance = this.instanceA;
        this.inactiveInstance = this.instanceB;

        this.elapsedTime = 0;
        this.isPlaying = true;
        this.isCrossfading = false;
        this.currentVolume = 0;
    }

    /**
     * Update campfire sound - handle crossfade and volume
     * @param {number} deltaTime - Time since last update (seconds)
     * @param {number} targetVolume - Desired volume (0-1)
     */
    update(deltaTime, targetVolume) {
        if (!this.isPlaying) return;

        this.targetVolume = targetVolume;

        // Get actual playback time from the audio source instead of manually tracking
        // This is more accurate than deltaTime accumulation
        const currentTime = this.activeInstance.source ? this.activeInstance.source.context.currentTime - this.activeInstance._startedAt : 0;
        this.elapsedTime = currentTime;

        // Check if we need to start crossfade (6 seconds before end)
        const crossfadeStartTime = this.audioDuration - this.crossfadeDuration;

        if (this.elapsedTime >= crossfadeStartTime && !this.isCrossfading) {
            // Start crossfade - ensure inactive instance is ready to play
            this.isCrossfading = true;

            // Reset the inactive instance if it's not playing
            if (!this.inactiveInstance.isPlaying) {
                // Reconnect the buffer to ensure clean playback
                const campfireBuffer = this.audioManager.sounds.campfire;
                this.inactiveInstance.setBuffer(campfireBuffer);
            }

            this.inactiveInstance.setVolume(0);
            this.inactiveInstance.play();
        }

        // Handle crossfade
        if (this.isCrossfading) {
            const crossfadeProgress = (this.elapsedTime - crossfadeStartTime) / this.crossfadeDuration;

            if (crossfadeProgress >= 1.0) {
                // Crossfade complete - swap instances
                const temp = this.activeInstance;
                this.activeInstance = this.inactiveInstance;
                this.inactiveInstance = temp;

                // Stop old instance
                this.inactiveInstance.stop();
                this.inactiveInstance.setVolume(0);

                // Reset tracking - new active instance just started
                this.elapsedTime = 0;
                this.isCrossfading = false;
            } else {
                // Apply crossfade volumes
                const fadeOut = 1.0 - crossfadeProgress;
                const fadeIn = crossfadeProgress;

                const activeVol = fadeOut * this.targetVolume;
                const inactiveVol = fadeIn * this.targetVolume;

                this.activeInstance.setVolume(activeVol);
                this.inactiveInstance.setVolume(inactiveVol);
            }
        } else {
            // Normal playback - just update volume
            this.activeInstance.setVolume(this.targetVolume);
        }

        // Safety check: if audio ended but we didn't crossfade, restart
        if (this.elapsedTime >= this.audioDuration && !this.isCrossfading) {
            this.activeInstance.stop();
            this.activeInstance.play();
            this.elapsedTime = 0;
        }
    }

    /**
     * Stop campfire sound with fade-out
     */
    stop() {
        if (!this.isPlaying) return;

        // Stop both instances - check if playing first to avoid null errors
        if (this.instanceA && this.instanceA.isPlaying) {
            this.instanceA.stop();
        }
        if (this.instanceB && this.instanceB.isPlaying) {
            this.instanceB.stop();
        }

        // Clean up references
        this.instanceA = null;
        this.instanceB = null;
        this.activeInstance = null;
        this.inactiveInstance = null;
        this.isPlaying = false;
        this.isCrossfading = false;
        this.elapsedTime = 0;
    }
}

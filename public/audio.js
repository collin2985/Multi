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

    /**
     * Set master volume for all audio (0.0 to 1.0)
     * @param {number} volume - Volume level (0.0 = muted, 1.0 = full)
     */
    setMasterVolume(volume) {
        const clampedVolume = Math.max(0, Math.min(1, volume));
        this.listener.setMasterVolume(clampedVolume);
    }

    /**
     * Get current master volume
     * @returns {number} Current master volume (0.0 to 1.0)
     */
    getMasterVolume() {
        return this.listener.getMasterVolume();
    }

    async loadSounds() {
        // Load each sound independently so one failure doesn't break all sounds
        const soundsToLoad = [
            { name: 'axe', path: 'sounds/axe.mp3' },
            { name: 'saw', path: 'sounds/saw.mp3' },
            { name: 'pickaxe', path: 'sounds/pickaxe.mp3' },
            { name: 'chisel', path: 'sounds/chisel.mp3' },
            { name: 'hammer', path: 'sounds/hammer.mp3' },
            { name: 'rifle', path: 'sounds/rifle.mp3' },
            { name: 'vines', path: 'sounds/grass.mp3' },
            { name: 'tree', path: 'sounds/tree.mp3' },
            { name: 'fishing', path: 'sounds/fishing.mp3' },
            { name: 'ocean', path: 'sounds/ocean.mp3' },
            { name: 'plains', path: 'sounds/plains.mp3' },
            { name: 'forest', path: 'sounds/forest.mp3' },
            { name: 'mountain', path: 'sounds/mountain.mp3' },
            { name: 'campfire', path: 'sounds/campfire.mp3' },
            { name: 'coins', path: 'sounds/coins.mp3' },
            { name: 'bear', path: 'sounds/bear.mp3' },
            { name: 'brownbear', path: 'sounds/bear.mp3' },
            { name: 'horse', path: 'sounds/horse.mp3' },
            { name: 'artillery', path: 'sounds/artillery.mp3' },
            { name: 'boatcrash', path: 'sounds/boatcrash.m4a' },
            { name: 'buildingfire', path: 'sounds/buildingfire.mp3' }
        ];

        await Promise.all(soundsToLoad.map(async ({ name, path }) => {
            try {
                const buffer = await this.loadSound(path);
                this.sounds[name] = buffer;
            } catch (error) {
                console.warn(`Failed to load sound: ${name}`, error);
            }
        }));

        this.isInitialized = true;
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
            console.warn('Axe sound not loaded - isInitialized:', this.isInitialized, 'sounds.axe:', !!this.sounds.axe);
            return null;
        }

        const sound = new THREE.Audio(this.listener);
        sound.setBuffer(this.sounds.axe);
        sound.setLoop(true);
        sound.setVolume(0.375);  // Reduced by 25%
        sound.play();

        // Auto-stop after 10 seconds
        setTimeout(() => {
            if (sound.isPlaying) {
                sound.stop();
            }
            sound.disconnect();
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
        sound.setVolume(0.25);  // Reduced by 50%
        sound.play();

        // Auto-stop after 10 seconds (original file is 12s)
        setTimeout(() => {
            if (sound.isPlaying) {
                sound.stop();
            }
            sound.disconnect();
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
            sound.disconnect();
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
        sound.setVolume(0.25);
        sound.play();

        // Auto-stop after 6 seconds
        setTimeout(() => {
            if (sound.isPlaying) {
                sound.stop();
            }
            sound.disconnect();
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
            sound.disconnect();
        }, 6000);

        return sound;
    }

    playTreeSound() {
        if (!this.isInitialized || !this.sounds.tree) {
            console.warn('Tree sound not loaded');
            return null;
        }

        const sound = new THREE.Audio(this.listener);
        sound.setBuffer(this.sounds.tree);
        sound.setLoop(false);
        sound.setVolume(0.6);
        sound.play();

        return sound;
    }

    playVinesSound() {
        if (!this.isInitialized || !this.sounds.vines) {
            console.warn('Vines sound not loaded');
            return null;
        }

        const sound = new THREE.Audio(this.listener);
        sound.setBuffer(this.sounds.vines);
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
                        sound.disconnect();
                    }
                }, stepInterval);
            }
        }, fadeOutStart);

        return sound;
    }

    playHorseSound() {
        if (!this.isInitialized || !this.sounds.horse) {
            console.warn('Horse sound not loaded');
            return null;
        }

        const sound = new THREE.Audio(this.listener);
        sound.setBuffer(this.sounds.horse);
        sound.setLoop(true);
        sound.setLoopStart(0);
        sound.setLoopEnd(4);  // Loop first 4 seconds
        sound.setVolume(0.125);
        sound.setPlaybackRate(0.5);  // Start at min speed
        sound.play();

        return sound;
    }

    /**
     * Play boat crash sound when boat is destroyed by merchant ship
     * @param {string} entityType - 'boat', 'sailboat', or 'ship2'
     * @returns {THREE.Audio|null} The created sound object
     */
    playBoatCrashSound(entityType = 'boat') {
        if (!this.isInitialized || !this.sounds.boatcrash) {
            console.warn('Boat crash sound not loaded');
            return null;
        }

        const sound = new THREE.Audio(this.listener);
        sound.setBuffer(this.sounds.boatcrash);
        sound.setLoop(false);

        // Volume based on entity type: ship2=50%, sailboat=25%, boat=10%
        const volumeMap = {
            ship2: 0.5,
            sailboat: 0.25,
            boat: 0.1
        };
        const startVolume = volumeMap[entityType] || 0.1;
        sound.setVolume(startVolume);

        // Slow down by 25% (playback rate of 0.75)
        sound.setPlaybackRate(0.75);
        sound.play();

        // Calculate actual duration with slowed playback
        const baseDuration = this.sounds.boatcrash.duration * 1000; // ms
        const actualDuration = baseDuration / 0.75; // Longer due to slower playback

        // Fade from 100% to 0% over the entire duration
        const fadeSteps = 30;
        const stepInterval = actualDuration / fadeSteps;
        let step = 0;

        const fadeInterval = setInterval(() => {
            step++;
            const progress = step / fadeSteps;
            const newVolume = startVolume * (1 - progress);
            sound.setVolume(Math.max(0, newVolume));

            if (step >= fadeSteps) {
                clearInterval(fadeInterval);
                if (sound.isPlaying) {
                    sound.stop();
                }
                sound.disconnect();
            }
        }, stepInterval);

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
                        sound.disconnect();
                    }
                }, stepInterval);
            }
        }, fadeOutStart);

        return sound;
    }

    /**
     * Play positional sound attached to an avatar (for other players)
     * @param {string} soundType - 'axe', 'saw', 'pickaxe', 'chisel', 'hammer', 'rifle', 'vines', 'tree', or 'fishing'
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
        } else if (soundType === 'vines') {
            buffer = this.sounds.vines;
            duration = 6000;
        } else if (soundType === 'fishing') {
            buffer = this.sounds.fishing;
            duration = 10000;
        } else if (soundType === 'tree') {
            buffer = this.sounds.tree;
            duration = 3000; // Tree falling sound is short
        } else if (soundType === 'bear' || soundType === 'brownbear') {
            buffer = this.sounds.bear;
            duration = 3000; // Bear roar sound
        } else if (soundType === 'artillery') {
            buffer = this.sounds.artillery;
            duration = 3000; // Artillery cannon sound
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
            sound.setVolume(0.09375); // Reduced by 75% total
        } else if (soundType === 'chisel') {
            sound.setVolume(0.25); // Reduced by 50%
        } else if (soundType === 'artillery') {
            sound.setVolume(0.25); // Reduced by 50%
        } else {
            sound.setVolume(0.5); // Base volume
        }

        // Attach sound to avatar as child (moves with avatar)
        avatar.add(sound);
        sound.play();

        // Vines and fishing sounds get special fade-out treatment
        if (soundType === 'vines' || soundType === 'fishing') {
            // Vines: 4s full, 2s fade (6s total)
            // Fishing: 8s full, 2s fade (10s total)
            const fadeOutStart = soundType === 'vines' ? 4000 : 8000;
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
        } else if (soundType === 'rifle') {
            // Rifle: 1.5s full, 0.42s fade (1.92s total clip)
            const fadeOutStart = 1500; // Start fade at 1.5 seconds
            const fadeOutDuration = 420; // Fade for 0.42 seconds
            const startVolume = 0.5;
            const fadeSteps = 10; // Fewer steps for short fade
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
                try { sound.disconnect(); } catch (e) { /* already disconnected by stop() */ }
            }, duration);
        }

        return sound;
    }

    /**
     * Play a simple non-looping sound by name
     * @param {string} soundName - Name of the sound (e.g., 'coins')
     * @param {number} duration - Optional max duration in ms (default: play full sound)
     * @returns {THREE.Audio|null} The created sound object or null if not loaded
     */
    playSound(soundName, duration = null) {
        if (!this.isInitialized || !this.sounds[soundName]) {
            console.warn(`${soundName} sound not loaded`);
            return null;
        }

        const sound = new THREE.Audio(this.listener);
        sound.setBuffer(this.sounds[soundName]);
        sound.setLoop(false);
        sound.setVolume(0.5);
        sound.play();

        // Stop after duration if specified
        if (duration) {
            setTimeout(() => {
                if (sound.isPlaying) {
                    sound.stop();
                }
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
 * PlainsForestSoundManager (replaces PlainsSoundManager)
 * Alternates between plains and forest ambient sounds with crossfade
 * Uses two audio instances to crossfade between different sounds
 */
export class PlainsForestSoundManager {
    constructor(audioManager) {
        this.audioManager = audioManager;
        this.listener = audioManager.listener;

        // Two audio instances for crossfading
        this.instanceA = null;
        this.instanceB = null;

        // Track which instance is currently active
        this.activeInstance = null;
        this.inactiveInstance = null;

        // Track which sound type is playing: 'plains' or 'forest'
        this.currentSoundType = 'plains';
        this.nextSoundType = 'forest';

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
     * Get the buffer for a sound type
     */
    getBuffer(soundType) {
        return soundType === 'plains'
            ? this.audioManager.sounds.plains
            : this.audioManager.sounds.forest;
    }

    /**
     * Start playing with plains sound
     */
    start() {
        if (this.isPlaying) return;

        const plainsBuffer = this.audioManager.sounds.plains;
        const forestBuffer = this.audioManager.sounds.forest;
        if (!plainsBuffer || !forestBuffer) {
            if (!this.hasWarnedNotLoaded) {
                console.warn('Plains or forest sound not loaded yet, waiting...');
                this.hasWarnedNotLoaded = true;
            }
            return;
        }

        // Start with plains
        this.currentSoundType = 'plains';
        this.nextSoundType = 'forest';

        // Get audio duration from current buffer
        this.audioDuration = plainsBuffer.duration;

        // Create first instance with plains
        this.instanceA = new THREE.Audio(this.listener);
        this.instanceA.setBuffer(plainsBuffer);
        this.instanceA.setLoop(false);
        this.instanceA.setVolume(0);
        this.instanceA.play();

        // Create second instance (will be set to forest when crossfading)
        this.instanceB = new THREE.Audio(this.listener);
        this.instanceB.setBuffer(forestBuffer);
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
     * Update sound - handle crossfade between plains and forest
     * @param {number} deltaTime - Time since last update (seconds)
     * @param {number} targetVolume - Desired volume (0-1)
     */
    update(deltaTime, targetVolume) {
        if (!this.isPlaying) return;

        this.targetVolume = targetVolume;

        // Get actual playback time from the audio source
        const currentTime = this.activeInstance.source
            ? this.activeInstance.source.context.currentTime - this.activeInstance._startedAt
            : 0;
        this.elapsedTime = currentTime;

        // Check if we need to start crossfade (6 seconds before end)
        const crossfadeStartTime = this.audioDuration - this.crossfadeDuration;

        if (this.elapsedTime >= crossfadeStartTime && !this.isCrossfading) {
            // Start crossfade to the OTHER sound type
            this.isCrossfading = true;

            // Set the inactive instance to the next sound type's buffer
            const nextBuffer = this.getBuffer(this.nextSoundType);
            this.inactiveInstance.setBuffer(nextBuffer);
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

                // Swap sound types
                const tempType = this.currentSoundType;
                this.currentSoundType = this.nextSoundType;
                this.nextSoundType = tempType;

                // Update duration for the new sound
                this.audioDuration = this.getBuffer(this.currentSoundType).duration;

                // Reset tracking
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

        // Safety check: if audio ended but we didn't crossfade, restart with next sound
        if (this.elapsedTime >= this.audioDuration && !this.isCrossfading) {
            this.activeInstance.stop();

            // Switch to next sound type
            const tempType = this.currentSoundType;
            this.currentSoundType = this.nextSoundType;
            this.nextSoundType = tempType;

            // Set new buffer and play
            const newBuffer = this.getBuffer(this.currentSoundType);
            this.activeInstance.setBuffer(newBuffer);
            this.audioDuration = newBuffer.duration;
            this.activeInstance.play();
            this.elapsedTime = 0;
        }
    }

    /**
     * Stop sound
     */
    stop() {
        if (!this.isPlaying) return;

        // Stop both instances
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
        this.currentSoundType = 'plains';
        this.nextSoundType = 'forest';
    }
}

// Keep PlainsSoundManager as an alias for backwards compatibility
export const PlainsSoundManager = PlainsForestSoundManager;

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

/**
 * BuildingFireSoundManager
 * Manages ambient building fire sound for dying structures
 * Uses two audio instances to crossfade between loops for smooth playback
 * (Follows CampfireSoundManager pattern)
 */
export class BuildingFireSoundManager {
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
     * Start playing building fire sound
     */
    start() {
        if (this.isPlaying) return;

        const buffer = this.audioManager.sounds.buildingfire;
        if (!buffer) {
            if (!this.hasWarnedNotLoaded) {
                console.warn('Building fire sound not loaded yet, waiting...');
                this.hasWarnedNotLoaded = true;
            }
            return;
        }

        // Get audio duration from buffer
        this.audioDuration = buffer.duration;

        // Create first instance
        this.instanceA = new THREE.Audio(this.listener);
        this.instanceA.setBuffer(buffer);
        this.instanceA.setLoop(false); // Manual loop control for crossfade
        this.instanceA.setVolume(0);
        this.instanceA.play();

        // Create second instance (ready for crossfade)
        this.instanceB = new THREE.Audio(this.listener);
        this.instanceB.setBuffer(buffer);
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
     * Update building fire sound - handle crossfade and volume
     * @param {number} deltaTime - Time since last update (seconds)
     * @param {number} targetVolume - Desired volume (0-1)
     */
    update(deltaTime, targetVolume) {
        if (!this.isPlaying) return;

        this.targetVolume = targetVolume;

        // Get actual playback time from the audio source
        const currentTime = this.activeInstance.source ? this.activeInstance.source.context.currentTime - this.activeInstance._startedAt : 0;
        this.elapsedTime = currentTime;

        // Check if we need to start crossfade (6 seconds before end)
        const crossfadeStartTime = this.audioDuration - this.crossfadeDuration;

        if (this.elapsedTime >= crossfadeStartTime && !this.isCrossfading) {
            // Start crossfade
            this.isCrossfading = true;

            if (!this.inactiveInstance.isPlaying) {
                const buffer = this.audioManager.sounds.buildingfire;
                this.inactiveInstance.setBuffer(buffer);
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

                // Reset tracking
                this.elapsedTime = 0;
                this.isCrossfading = false;
            } else {
                // Apply crossfade volumes
                const fadeOut = 1.0 - crossfadeProgress;
                const fadeIn = crossfadeProgress;

                this.activeInstance.setVolume(fadeOut * this.targetVolume);
                this.inactiveInstance.setVolume(fadeIn * this.targetVolume);
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
     * Stop building fire sound
     */
    stop() {
        if (!this.isPlaying) return;

        if (this.instanceA && this.instanceA.isPlaying) {
            this.instanceA.stop();
        }
        if (this.instanceB && this.instanceB.isPlaying) {
            this.instanceB.stop();
        }

        this.instanceA = null;
        this.instanceB = null;
        this.activeInstance = null;
        this.inactiveInstance = null;
        this.isPlaying = false;
        this.isCrossfading = false;
        this.elapsedTime = 0;
    }
}

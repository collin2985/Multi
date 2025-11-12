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

    /**
     * Play positional sound attached to an avatar (for other players)
     * @param {string} soundType - 'axe', 'saw', 'pickaxe', 'chisel', 'hammer', or 'rifle'
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

        sound.setVolume(0.5); // Base volume

        // Attach sound to avatar as child (moves with avatar)
        avatar.add(sound);
        sound.play();

        // Auto-stop and cleanup after duration
        setTimeout(() => {
            if (sound.isPlaying) {
                sound.stop();
            }
            avatar.remove(sound);
            sound.disconnect();
        }, duration);

        return sound;
    }

    cleanup() {
        if (this.listener) {
            this.camera.remove(this.listener);
        }
    }
}

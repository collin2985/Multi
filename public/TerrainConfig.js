// File: public/TerrainConfig.js
// Terrain configuration and utilities extracted from terrain.js
// This breaks the circular dependency between terrain.js and objects.js

import { CONFIG as GAME_CONFIG } from './config.js';

// --- CONFIG ---
export const CONFIG = Object.freeze({
    TERRAIN: {
        chunkSize: 50,
        segments: 100,
        renderDistance: GAME_CONFIG.CHUNKS.LOAD_RADIUS, // Synced with server
        seed: 12345, // Centralized seed
        // Terrain generation parameters
        noise: {
            baseOctaves: 3,
            baseAmplitude: 1,
            baseFrequency: 0.02,
            mountainOctaves: 4,
            mountainAmplitude: 1,
            mountainFrequency: 0.04,
            mountainScale: 40,
            maskFrequency: 0.006,
            jaggedFrequency1: 0.8,
            jaggedAmplitude1: 1.2,
            jaggedFrequency2: 1.6,
            jaggedAmplitude2: 0.6,
            jaggedNoiseOffset1: 900,
            jaggedNoiseOffset2: 901
        }
    },
    PERFORMANCE: {
        updateThrottle: 100,
        maxCacheSize: 20000
    },
    GRAPHICS: {
        textureSize: 256,
        textureRepeat: 0.25
    },
    CAMERA: {
        offset: { x: 0, y: 35, z: -20 }
    }
});

// --- UTILITIES ---
export const Utilities = {
    mulberry32(seed) {
        return function() {
            let t = seed += 0x6D2B79F5;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    },

    getChunkRNG(seed, chunkX, chunkZ) {
        const chunkSeed = seed + chunkX * 73856093 + chunkZ * 19349663;
        return Utilities.mulberry32(chunkSeed);
    }
};

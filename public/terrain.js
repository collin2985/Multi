// File: public/terrain.js
// Location: C:\Users\colli\Desktop\test Horses\Horses\public\terrain.js

import * as THREE from 'three';
import { addTreesToChunk, removeTrees } from './objects.js';



export const roundCoord = (coord) => Math.round(coord * FLOAT_PRECISION) / FLOAT_PRECISION;

// --- CONFIG ---
export const CONFIG = Object.freeze({
    TERRAIN: {
        chunkSize: 50,
        segments: 100,
        renderDistance: 1,
        seed: 12345, // Centralized seed
        // NEW: Terrain generation parameters
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

    limitCacheSize(cache, maxSize) {
        if (cache.size > maxSize) {
            const entriesToRemove = Math.floor(cache.size * 0.25);
            const keysToDelete = Array.from(cache.keys()).slice(0, entriesToRemove);
            keysToDelete.forEach(key => cache.delete(key));
            //console.log(`Cache cleanup: removed ${entriesToRemove} entries, ${cache.size} remaining`);
        }
    },

    getChunkRNG(seed, chunkX, chunkZ) {
        const chunkSeed = seed + chunkX * 73856093 + chunkZ * 19349663;
        return Utilities.mulberry32(chunkSeed);
    },

    logError(message, error) {
        console.error(`${message}:`, error);
    }
};

// --- OPTIMIZED PERLIN ---
export class OptimizedPerlin {
    constructor(seed = CONFIG.TERRAIN.seed) {
        this.p = new Array(512);
        const perm = [];
        const rng = Utilities.mulberry32(seed);
        
        for (let i = 0; i < 256; i++) perm[i] = i;
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [perm[i], perm[j]] = [perm[j], perm[i]];
        }
        for (let i = 0; i < 256; i++) {
            this.p[i] = this.p[i + 256] = perm[i];
        }
    }

    fade(t) { 
        return t * t * t * (t * (t * 6 - 15) + 10); 
    }

    lerp(t, a, b) { 
        return a + t * (b - a); 
    }

    grad(hash, x, y, z) {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    noise(x, y, z) {
        let X = Math.floor(x) & 255;
        let Y = Math.floor(y) & 255;
        let Z = Math.floor(z) & 255;
        
        x -= Math.floor(x);
        y -= Math.floor(y);
        z -= Math.floor(z);
        
        let u = this.fade(x);
        let v = this.fade(y);
        let w = this.fade(z);
        
        let A = this.p[X] + Y;
        let AA = this.p[A] + Z;
        let AB = this.p[A + 1] + Z;
        let B = this.p[X + 1] + Y;
        let BA = this.p[B] + Z;
        let BB = this.p[B + 1] + Z;

        return this.lerp(w,
            this.lerp(v,
                this.lerp(u, this.grad(this.p[AA], x, y, z), this.grad(this.p[BA], x - 1, y, z)),
                this.lerp(u, this.grad(this.p[AB], x, y - 1, z), this.grad(this.p[BB], x - 1, y - 1, z))
            ),
            this.lerp(v,
                this.lerp(u, this.grad(this.p[AA + 1], x, y, z - 1), this.grad(this.p[BA + 1], x - 1, y, z - 1)),
                this.lerp(u, this.grad(this.p[AB + 1], x, y - 1, z - 1), this.grad(this.p[BB + 1], x - 1, y - 1, z - 1))
            )
        );
    }
}

// --- HEIGHT CALCULATOR ---
// Increased precision for better edge matching
const FLOAT_PRECISION = 1000000.0;

export class HeightCalculator {
    constructor(seed = CONFIG.TERRAIN.seed) {
        this.perlin = new OptimizedPerlin(seed);
        this.heightCache = new Map();
        this.MAX_CACHE_SIZE = CONFIG.PERFORMANCE.maxCacheSize;
    }

    clamp(v, a, b) {
        return Math.max(a, Math.min(b, v));
    }

    calculateHeight(x, z) {
    // ⚠️ ============================================================================
    // ⚠️ CRITICAL SYNCHRONIZATION WARNING - TERRAIN GENERATION CODE
    // ⚠️ ============================================================================
    // ⚠️ This terrain generation algorithm is DUPLICATED in THREE locations:
    // ⚠️
    // ⚠️   1. HERE: terrain.js HeightCalculator.calculateHeight() (MAIN THREAD)
    // ⚠️   2. terrain.js worker calculateHeight() (WEB WORKER - line ~611)
    // ⚠️   3. WaterRenderer.js calculateTerrainHeight() (GPU SHADER - lines ~107 & ~348)
    // ⚠️
    // ⚠️ ANY CHANGES TO THIS ALGORITHM MUST BE MANUALLY REPLICATED TO ALL 3 LOCATIONS!
    // ⚠️
    // ⚠️ Failure to synchronize will cause:
    // ⚠️   - Water/terrain height mismatches
    // ⚠️   - Visual seams between chunks
    // ⚠️   - Incorrect collision detection
    // ⚠️   - Physics glitches
    // ⚠️
    // ⚠️ Parameters must match exactly:
    // ⚠️   - Perlin noise octaves, frequencies, amplitudes
    // ⚠️   - Terrain floor compression (lines 209-215)
    // ⚠️   - Ocean generation (lines 217-251)
    // ⚠️   - All magic numbers and constants
    // ⚠️ ============================================================================

    const rx = roundCoord(x);
    const rz = roundCoord(z);

    const key = `${rx},${rz}`;
    if (this.heightCache.has(key)) {
        return this.heightCache.get(key);
    }

    // Use CONFIG parameters
    const noiseConfig = CONFIG.TERRAIN.noise;
    
    let base = 0;
    let amplitude = noiseConfig.baseAmplitude;
    let frequency = noiseConfig.baseFrequency;
    
    for (let octave = 0; octave < noiseConfig.baseOctaves; octave++) {
        base += this.perlin.noise(rx * frequency, rz * frequency, 10 + octave * 7) * amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }

    let maskRaw = this.perlin.noise(rx * noiseConfig.maskFrequency, rz * noiseConfig.maskFrequency, 400);
    let mask = Math.pow((maskRaw + 1) * 0.5, 3);

    let mountain = 0;
    amplitude = noiseConfig.mountainAmplitude;
    frequency = noiseConfig.mountainFrequency;
    
    for (let octave = 0; octave < noiseConfig.mountainOctaves; octave++) {
        mountain += Math.abs(this.perlin.noise(rx * frequency, rz * frequency, 500 + octave * 11)) * amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }
    mountain *= noiseConfig.mountainScale * mask;
    
    let heightBeforeJagged = base + mountain;


    const elevNorm = this.clamp((heightBeforeJagged + 2) / 25, 0, 1);
    let jaggedScale = heightBeforeJagged < 1.5 ? Math.max(0.1, (heightBeforeJagged + 0.5) / 10.0) : 1.0;
    let jagged = this.perlin.noise(rx * noiseConfig.jaggedFrequency1, rz * noiseConfig.jaggedFrequency1, noiseConfig.jaggedNoiseOffset1) * noiseConfig.jaggedAmplitude1 * elevNorm * jaggedScale +
             this.perlin.noise(rx * noiseConfig.jaggedFrequency2, rz * noiseConfig.jaggedFrequency2, noiseConfig.jaggedNoiseOffset2) * noiseConfig.jaggedAmplitude2 * elevNorm * jaggedScale;


    let height = heightBeforeJagged + jagged;

    // ========== TERRAIN FLOOR START (DELETE FROM HERE TO REMOVE FLOOR) ==========
    // Exponential compression floor to prevent water puddles while preserving variation
    // Starts compressing at 1.9, asymptotically approaches 1.3 minimum
    if (height < 1.9) {
        const belowAmount = 1.9 - height;
        const maxCompression = 0.6; // (1.9 - 1.3) maximum drop
        const compressed = maxCompression * (1 - Math.exp(-belowAmount * 0.5));
        height = 1.9 - compressed; // Approaches 1.3 but never quite reaches it
    }
    // ========== TERRAIN FLOOR END (DELETE TO HERE TO REMOVE FLOOR) ==========

    // ========== OCEAN GENERATION START (DELETE FROM HERE TO REMOVE OCEAN) ==========
    // Create ocean by lowering terrain smoothly and randomly
    // Coastline position varies between x=0 and x=20 based on z position
    const coastlineThreshold = 10 + this.perlin.noise(rz * 0.01, 777, 0) * 10;
    const transitionWidth = 8; // Units over which to blend from land to ocean

    // Calculate distance from threshold (positive = ocean side, negative = land side)
    const distanceFromThreshold = rx - coastlineThreshold;

    // Create smooth transition using smoothstep function
    // t goes from 0 (before transition) to 1 (after transition)
    const t = Math.max(0, Math.min(1, (distanceFromThreshold + transitionWidth) / (transitionWidth * 2)));
    const smoothTransition = t * t * (3 - 2 * t); // Smoothstep S-curve

    if (smoothTransition > 0) {
        const oceanDistance = Math.max(0, distanceFromThreshold);

        // Reduce noise intensity as distance from coast increases (smoother deep ocean)
        const noiseIntensity = 1 / (1 + oceanDistance * 0.05);

        // Add noise for varied coastline - intensity reduces with distance
        const coastlineNoise = this.perlin.noise(rx * 0.02, rz * 0.02, 999) * 5 * noiseIntensity;
        const adjustedDistance = Math.max(0, oceanDistance + coastlineNoise);

        // Gradually deepen as distance increases - depth noise also reduces with distance
        const depthNoise = this.perlin.noise(rx * 0.05, rz * 0.05, 888) * 2 * noiseIntensity;
        const depthFactor = (adjustedDistance * 0.5) + depthNoise;

        // Apply ocean effect gradually based on transition
        height -= depthFactor * smoothTransition;

        // Cap at ocean floor
        height = Math.max(height, -3);
    }
    // ========== OCEAN GENERATION END (DELETE TO HERE TO REMOVE OCEAN) ==========

    // ========== RIVER GENERATION START (DELETE FROM HERE TO REMOVE RIVER) ==========
    // Create rivers at random intervals along the Z-axis (every 100-300 units)
    // Rivers run parallel to the coast, perpendicular to ocean

    const riverSegmentSize = 200; // Average spacing between rivers
    const riverTransitionWidth = 8; // Units over which to blend
    const riverWidth = 10; // Distance from first bank to center (and center to far bank)

    // Determine which river segment we're in
    const riverSegment = Math.floor(rz / riverSegmentSize);

    // Use segment number to generate deterministic random values for this segment
    const segmentSeed = riverSegment * 73856093; // Large prime for good distribution
    const segmentRandom = Math.abs(Math.sin(segmentSeed) * 43758.5453123);
    const hasRiver = (segmentRandom % 1) > 0.3; // 70% chance of river in this segment

    if (hasRiver) {
        // Random offset within segment (0-100 range gives 100-300 spacing variability)
        const riverOffsetInSegment = ((segmentRandom * 7919) % 1) * 100; // Use different multiplier for offset
        const riverCenterZ = riverSegment * riverSegmentSize + riverOffsetInSegment + 10;

        // River meanders based on x position
        const riverMeanderOffset = this.perlin.noise(rx * 0.01, 666 + riverSegment, 0) * 10;
        const riverThreshold = riverCenterZ + riverMeanderOffset;

        // Calculate distance from river threshold
        const riverDistanceFromThreshold = rz - riverThreshold;

        // River occupies z = threshold to threshold + 20 (two 10-unit banks)
        if (riverDistanceFromThreshold >= -riverTransitionWidth && riverDistanceFromThreshold <= riverWidth * 2 + riverTransitionWidth) {
            let riverDepthFactor = 0;

            if (riverDistanceFromThreshold <= riverWidth) {
                // First bank (z = threshold to threshold + 10)
                const t = Math.max(0, Math.min(1, (riverDistanceFromThreshold + riverTransitionWidth) / (riverTransitionWidth * 2)));
                const smoothTransition = t * t * (3 - 2 * t);

                if (smoothTransition > 0) {
                    const riverDistance = Math.max(0, riverDistanceFromThreshold);
                    const noiseIntensity = 1 / (1 + riverDistance * 0.05);
                    const riverBankNoise = this.perlin.noise(rx * 0.02, rz * 0.02, 555) * 5 * noiseIntensity;
                    const adjustedRiverDistance = Math.max(0, riverDistance + riverBankNoise);
                    const riverDepthNoise = this.perlin.noise(rx * 0.05, rz * 0.05, 444) * 2 * noiseIntensity;
                    riverDepthFactor = ((adjustedRiverDistance * 0.5) + riverDepthNoise) * smoothTransition;
                }
            } else {
                // Second bank (z = threshold + 10 to threshold + 20)
                const reversedDistance = riverWidth * 2 - riverDistanceFromThreshold;
                const t = Math.max(0, Math.min(1, (reversedDistance + riverTransitionWidth) / (riverTransitionWidth * 2)));
                const smoothTransition = t * t * (3 - 2 * t);

                if (smoothTransition > 0) {
                    const riverDistance = Math.max(0, reversedDistance);
                    const noiseIntensity = 1 / (1 + riverDistance * 0.05);
                    const riverBankNoise = this.perlin.noise(rx * 0.02, rz * 0.02, 555) * 5 * noiseIntensity;
                    const adjustedRiverDistance = Math.max(0, riverDistance + riverBankNoise);
                    const riverDepthNoise = this.perlin.noise(rx * 0.05, rz * 0.05, 444) * 2 * noiseIntensity;
                    riverDepthFactor = ((adjustedRiverDistance * 0.5) + riverDepthNoise) * smoothTransition;
                }
            }

            // Apply river effect
            height -= riverDepthFactor;
            height = Math.max(height, -3);
        }
    }
    // ========== RIVER GENERATION END (DELETE TO HERE TO REMOVE RIVER) ==========

    this.heightCache.set(key, height);

    Utilities.limitCacheSize(this.heightCache, this.MAX_CACHE_SIZE);
    return height;
}

    calculateNormal(x, z, eps = 0.1) {
        const hL = this.calculateHeight(x - eps, z);
        const hR = this.calculateHeight(x + eps, z);
        const hD = this.calculateHeight(x, z - eps);
        const hU = this.calculateHeight(x, z + eps);

        const nx = hL - hR;
        const ny = 2 * eps;
        const nz = hD - hU;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len === 0) {
            return { x: 0, y: 1, z: 0 }; // Default upward normal
        }
        return { x: nx / len, y: ny / len, z: nz / len };
    }

    clearCache() {
        // Only clear cache when explicitly needed
        console.warn('Clearing height cache');
        this.heightCache.clear();
    }
}

// --- TERRAIN MATERIAL FACTORY ---
export class TerrainMaterialFactory {
   static createTerrainMaterial(textures) {
    const vertexShader = `
        varying float vHeight;
        varying float vSlope;
        varying vec3 vNormal;
        varying vec2 vUv;
        varying vec3 vWorldPosition;

        void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            vUv = uv;
            vHeight = position.y;
            vNormal = normal;
            vSlope = 1.0 - dot(normal, vec3(0, 1, 0));
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;

    const fragmentShader = `
        uniform vec3 uLightDir;
        uniform sampler2D uDirt;
        uniform sampler2D uGrass;
        uniform sampler2D uGrass2;
        uniform sampler2D uRock;
        uniform sampler2D uRock1;
        uniform sampler2D uRock2;
        uniform sampler2D uSnow;
        uniform sampler2D uSand;
        uniform sampler2D uSand2;
        uniform float uTextureRepeat;

        varying float vHeight;
        varying float vSlope;
        varying vec3 vNormal;
        varying vec2 vUv;
        varying vec3 vWorldPosition;

        // Rotate UV coordinates by angle (in radians)
        vec2 rotateUV(vec2 uv, float angle) {
            float c = cos(angle);
            float s = sin(angle);
            mat2 rotationMatrix = mat2(c, -s, s, c);
            // Center rotation around 0.5
            vec2 centered = uv - 0.5;
            vec2 rotated = rotationMatrix * centered;
            return rotated + 0.5;
        }

        // Sample texture with multiple rotations and scales to break tiling
        vec3 sampleTextureMulti(sampler2D tex, vec2 worldPos, float baseRepeat) {
            // Sample 1: Normal
            vec2 uv1 = fract(worldPos * baseRepeat);
            vec3 sample1 = texture2D(tex, uv1).rgb;

            // Sample 2: Rotated 45 degrees, slightly smaller scale
            vec2 uv2 = fract(worldPos * baseRepeat * 0.87);
            uv2 = rotateUV(uv2, 0.785398); // 45 degrees
            vec3 sample2 = texture2D(tex, uv2).rgb;

            // Sample 3: Rotated 120 degrees, different scale
            vec2 uv3 = fract(worldPos * baseRepeat * 1.13);
            uv3 = rotateUV(uv3, 2.094395); // 120 degrees
            vec3 sample3 = texture2D(tex, uv3).rgb;

            // Blend samples with varying weights for natural variation
            // Use world position to create variation in blending
            float blendNoise = fract(sin(dot(worldPos, vec2(12.9898, 78.233))) * 43758.5453);

            // Weighted blend
            vec3 blended = sample1 * 0.5 + sample2 * 0.3 + sample3 * 0.2;

            // Add subtle variation based on position
            blended = mix(blended, sample2, blendNoise * 0.1);

            return blended;
        }

        void main() {
            // Use world position for texture coordinates to eliminate seams
            float repeat = uTextureRepeat;
            vec2 worldUv = fract(vWorldPosition.xz * repeat);

            // Simple textures (no tiling fix needed for varied surfaces)
            vec3 dirt = texture2D(uDirt, worldUv).rgb;
            vec3 rock = texture2D(uRock, worldUv).rgb;
            vec3 rock1 = texture2D(uRock1, worldUv).rgb;
            vec3 rock2 = texture2D(uRock2, worldUv).rgb;
            vec3 snow = texture2D(uSnow, worldUv).rgb;
            vec3 sand = texture2D(uSand, worldUv).rgb;
            vec3 sand2 = texture2D(uSand2, worldUv).rgb;

            // Multi-sample grass textures to break tiling pattern
            vec3 grass = sampleTextureMulti(uGrass, vWorldPosition.xz, repeat);
            vec3 grass2 = sampleTextureMulti(uGrass2, vWorldPosition.xz, repeat);

            // ========== NATURAL DIRT DISTRIBUTION SYSTEM ==========
            // Calculate environmental factors for realistic terrain

            // Sand/Dirt separation based on X position (x > 0 = sand, x < 0 = dirt)
            // Transition smoothly over 10 units centered at x = 0
            float sandDirtTransition = smoothstep(-5.0, 5.0, vWorldPosition.x);

            // Moisture simulation: Higher elevations with low slope retain moisture (darker grass)
            float moisture = smoothstep(1.5, 3.5, vHeight) * (1.0 - vSlope);

            // Wear patterns: Flat areas at lower elevations show more dirt (traffic/erosion)
            float wear = smoothstep(0.0, 0.1, vSlope) * smoothstep(2.0, 1.0, vHeight);

            // Multi-frequency noise for organic dirt patches
            float patchNoise1 = sin(vWorldPosition.x * 0.15) * cos(vWorldPosition.z * 0.15);
            float patchNoise2 = sin(vWorldPosition.x * 0.4) * cos(vWorldPosition.z * 0.4) * 0.5;
            float patchNoise3 = sin(vWorldPosition.x * 0.31) * cos(vWorldPosition.z * 0.29) * 0.3;
            float dirtNoise = patchNoise1 + patchNoise2 + patchNoise3;

            // Create irregular dirt patches (not regular grid)
            float irregularPatches = smoothstep(0.3, 0.7, dirtNoise);

            // Combine wear and patches for natural dirt exposure
            float dirtPatches = irregularPatches * wear * 0.7;

            // Slope-based dirt exposure (erosion on steep areas)
            float slopeExposure = smoothstep(0.15, 0.35, vSlope) * 0.5;

            // ========== HEIGHT-BASED TEXTURE WEIGHTS ==========
            // Sand weights - only where x > 0 (modified by sandDirtTransition)
            float wSand2Base = smoothstep(0.5, 1.29, vHeight) * (1.0 - smoothstep(0.5, 1.29, vHeight));
            float wSandBase = smoothstep(1.05, 1.3, vHeight) * (1.0 - smoothstep(1.05, 1.3, vHeight));

            // Apply X-position based sand/dirt separation
            float wSand2 = wSand2Base * sandDirtTransition;
            float wSand = wSandBase * sandDirtTransition;

            // Rock weights with smoother transition at 4.5
            float wRock1 = smoothstep(4.0, 5.5, vHeight) * (1.0 - smoothstep(5.0, 7.0, vHeight));
            float wRock2 = smoothstep(5.5, 9.0, vHeight) * (1.0 - smoothstep(5.0, 9.0, vHeight));
            float wSnow = smoothstep(7.5, 12.0, vHeight);

            // ========== GRASS/DIRT NATURAL BLENDING ==========
            // Blend grass variants based on moisture (darker grass in damp areas)
            vec3 grassMix = mix(grass, grass2, moisture * 0.6);

            // Calculate base grass weight (main grass coverage) with smoother rock transition
            float baseGrassWeight = smoothstep(0.9, 3.0, vHeight) * (1.0 - smoothstep(3.5, 5.5, vHeight));

            // Add subtle dirt patches (not too aggressive)
            float subtleDirtPatches = dirtPatches * 0.3;
            float subtleSlopeExposure = slopeExposure * 0.4;

            // Grass weight slightly reduced by dirt exposure (but not eliminated)
            float finalGrassWeight = baseGrassWeight * (1.0 - subtleDirtPatches * 0.5 - subtleSlopeExposure * 0.5);

            // Base dirt weight (only at lower elevations) - reduced where sand appears (x > 0)
            float baseDirtWeight = smoothstep(-25.0, 0.6, vHeight) * (1.0 - smoothstep(0.0, 1.8, vHeight));
            baseDirtWeight *= (1.0 - sandDirtTransition); // Reduce dirt where sand should be

            // Add patches on top of base dirt, but not too much
            float finalDirtWeight = baseDirtWeight + subtleDirtPatches + subtleSlopeExposure;

            // ========== FINAL WEIGHT NORMALIZATION ==========
            float totalWeight = wSand + wSand2 + finalDirtWeight + finalGrassWeight + wRock1 + wRock2 + wSnow;
            if (totalWeight > 0.0) {
                wSand /= totalWeight;
                wSand2 /= totalWeight;
                finalDirtWeight /= totalWeight;
                finalGrassWeight /= totalWeight;
                wRock1 /= totalWeight;
                wRock2 /= totalWeight;
                wSnow /= totalWeight;
            } else {
                finalDirtWeight = 1.0; // Fallback to dirt
            }

            // ========== FINAL COLOR COMPOSITION ==========
            float slopeFactor = smoothstep(0.05, 0.3, vSlope);

            vec3 baseColor = sand * wSand + sand2 * wSand2 + dirt * finalDirtWeight +
                           grassMix * finalGrassWeight + rock1 * wRock1 + rock2 * wRock2 + snow * wSnow;

            // Smooth grass-to-rock transition blend at mid elevations (around 4.5)
            // This creates a natural gradient instead of hard edge
            float grassRockTransition = smoothstep(4.0, 5.5, vHeight);
            vec3 grassRockMix = mix(grassMix, rock1, grassRockTransition * 0.3);

            // Apply the transition blend in the 4.0-5.5 elevation range
            float transitionZone = smoothstep(3.8, 4.2, vHeight) * (1.0 - smoothstep(5.3, 5.7, vHeight));
            baseColor = mix(baseColor, grassRockMix, transitionZone);

            // Additional rock on very steep slopes
            baseColor = mix(baseColor, rock, slopeFactor * 0.8);
            
            float dp = max(0.0, dot(normalize(vNormal), normalize(uLightDir)));
            float lightFactor = vHeight < -2.0 ? 0.3 + dp * 0.3 : 0.5 + dp * 0.5;
            baseColor *= lightFactor;

            gl_FragColor = vec4(baseColor, 1.0);
        }
    `;

    const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
            uDirt: { value: textures.dirt },
            uGrass: { value: textures.grass },
            uGrass2: { value: textures.grass2 },
            uRock: { value: textures.rock },
            uRock1: { value: textures.rock1 },
            uRock2: { value: textures.rock2 },
            uSnow: { value: textures.snow },
            uSand: { value: textures.sand },
            uSand2: { value: textures.sand2 },
            uLightDir: { value: new THREE.Vector3(1, 1, 1).normalize() },
            uTextureRepeat: { value: CONFIG.GRAPHICS.textureRepeat }
        },
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1
    });

    return material;
}

    static createProceduralTextures() {
        const size = CONFIG.GRAPHICS.textureSize;
        const rng = Utilities.mulberry32(CONFIG.TERRAIN.seed);

        const createTexture = (color1, color2) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            const ctx = canvas.getContext('2d');
            const imgData = ctx.createImageData(size, size);
            const data = imgData.data;

            for (let i = 0; i < data.length; i += 4) {
                const noise = rng();
                const color = noise > 0.5 ? color1 : color2;
                data[i] = color.r;
                data[i + 1] = color.g;
                data[i + 2] = color.b;
                data[i + 3] = 255;
            }

            ctx.putImageData(imgData, 0, 0);
            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.generateMipmaps = true;
            texture.anisotropy = 16;
            return texture;
        };

        // Advanced dirt texture with multiple colors and multi-frequency noise
        const createDirtTexture = () => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            const ctx = canvas.getContext('2d');
            const imgData = ctx.createImageData(size, size);
            const data = imgData.data;

            // Define dirt color palette (5 shades for natural variation)
            const dirtColors = [
                { r: 82, g: 55, b: 28 },   // Dark brown
                { r: 101, g: 67, b: 33 },  // Medium dark
                { r: 120, g: 80, b: 40 },  // Medium
                { r: 139, g: 90, b: 43 },  // Medium light
                { r: 155, g: 105, b: 55 }  // Light brown
            ];

            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const i = (y * size + x) * 4;

                    // Multi-frequency noise for organic look
                    const noise1 = rng();
                    const noise2 = rng();
                    const noise3 = rng();

                    // Combine noise at different frequencies
                    const combinedNoise = noise1 * 0.5 + noise2 * 0.3 + noise3 * 0.2;

                    // Select color based on noise
                    const colorIndex = Math.floor(combinedNoise * dirtColors.length);
                    const clampedIndex = Math.min(colorIndex, dirtColors.length - 1);
                    const baseColor = dirtColors[clampedIndex];

                    // Add slight per-pixel variation
                    const variation = (rng() - 0.5) * 20;

                    data[i] = Math.max(0, Math.min(255, baseColor.r + variation));
                    data[i + 1] = Math.max(0, Math.min(255, baseColor.g + variation));
                    data[i + 2] = Math.max(0, Math.min(255, baseColor.b + variation));
                    data[i + 3] = 255;
                }
            }

            ctx.putImageData(imgData, 0, 0);
            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.generateMipmaps = true;
            texture.anisotropy = 16;
            return texture;
        };

        const grassTexture = new THREE.TextureLoader().load('./terrain/grass.png', (texture) => {
            console.log('Grass texture loaded successfully');
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.generateMipmaps = true;
            texture.anisotropy = 16;
        }, undefined, (err) => {
            console.error('Failed to load grass texture:', err);
        });

        const rockTexture = new THREE.TextureLoader().load('./terrain/rock.png', (texture) => {
            console.log('Rock texture loaded successfully');
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.generateMipmaps = true;
            texture.anisotropy = 16;
        }, undefined, (err) => {
            console.error('Failed to load rock texture:', err);
        });

                const rock1Texture = new THREE.TextureLoader().load('./terrain/rock1.png', (texture) => {
            console.log('Rock1 texture loaded successfully');
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.generateMipmaps = true;
            texture.anisotropy = 16;
        }, undefined, (err) => {
            console.error('Failed to load rock1 texture:', err);
        });

        const grass2Texture = new THREE.TextureLoader().load('./terrain/grass2.png', (texture) => {
            console.log('Grass2 texture loaded successfully');
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.generateMipmaps = true;
            texture.anisotropy = 16;
        }, undefined, (err) => {
            console.error('Failed to load grass2 texture:', err);
        });

        return {
            dirt: createDirtTexture(), // Advanced multi-color dirt texture
            grass: grassTexture,
            grass2: grass2Texture,
            rock: rockTexture,
            rock1: rock1Texture,
            rock2: createTexture({ r: 120, g: 120, b: 120 }, { r: 150, g: 150, b: 150 }),
            snow: createTexture({ r: 255, g: 250, b: 250 }, { r: 240, g: 248, b: 255 }),
            sand: createTexture({ r: 249, g: 218, b: 161 }, { r: 242, g: 210, b: 150 }),
            sand2: createTexture({ r: 224, g: 180, b: 131 }, { r: 247, g: 196, b: 138 })

        };
    }
}

// --- TERRAIN WORKER MANAGER ---
export class TerrainWorkerManager {
    constructor() {
        this.worker = null;
        this.workerUrl = null;
        this.pendingBatches = new Map();
        this.messageHandlers = new Map();
        this.fallbackCalculator = new HeightCalculator(CONFIG.TERRAIN.seed);
        this.initialize();
    }

    initialize() {
        if (this.worker) {
            return; // Prevent reinitialization
        }
        try {
            const workerCode = this.generateWorkerCode();
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            this.workerUrl = URL.createObjectURL(blob);
            this.worker = new Worker(this.workerUrl);
            this.worker.onmessage = this.handleMessage.bind(this);
            this.worker.onerror = (error) => console.error('Worker error:', error);
        } catch (err) {
            console.error('Failed to initialize worker:', err);
            this.worker = null;
        }
    }

    generateWorkerCode() {
        const MAX_CACHE_SIZE = CONFIG.PERFORMANCE.maxCacheSize;
        const FLOAT_PRECISION = 1000000.0; // Increased precision
        
        return `
            const FLOAT_PRECISION = ${FLOAT_PRECISION};
            const terrainConfig = ${JSON.stringify(CONFIG.TERRAIN.noise)};
            const MAX_CACHE_SIZE = ${MAX_CACHE_SIZE};
            const roundCoord = (coord) => Math.round(coord * FLOAT_PRECISION) / FLOAT_PRECISION;
            
            const limitCacheSize = (cache, maxSize) => {
                if (cache.size > maxSize) {
                    const entriesToRemove = Math.floor(cache.size * 0.25);
                    const keysToDelete = Array.from(cache.keys()).slice(0, entriesToRemove);
                    keysToDelete.forEach(key => cache.delete(key));
                }
            };

            const mulberry32 = (seed) => {
                return function() {
                    let t = seed += 0x6D2B79F5;
                    t = Math.imul(t ^ (t >>> 15), t | 1);
                    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
                    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
                };
            };

            class OptimizedPerlin {
                constructor(seed = ${CONFIG.TERRAIN.seed}) {
                    this.p = new Array(512);
                    const perm = [];
                    const rng = mulberry32(seed);
                    for (let i = 0; i < 256; i++) perm[i] = i;
                    for (let i = 255; i > 0; i--) {
                        const j = Math.floor(rng() * (i + 1));
                        [perm[i], perm[j]] = [perm[j], perm[i]];
                    }
                    for (let i = 0; i < 256; i++) {
                        this.p[i] = this.p[i + 256] = perm[i];
                    }
                }

                fade(t) { 
                    return t * t * t * (t * (t * 6 - 15) + 10);
                }

                lerp(t, a, b) { 
                    return a + t * (b - a);
                }

                grad(hash, x, y, z) {
                    const h = hash & 15;
                    const u = h < 8 ? x : y;
                    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
                    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
                }

                noise(x, y, z) {
                    let X = Math.floor(x) & 255;
                    let Y = Math.floor(y) & 255;
                    let Z = Math.floor(z) & 255;
                    
                    x -= Math.floor(x);
                    y -= Math.floor(y);
                    z -= Math.floor(z);
                    
                    let u = this.fade(x);
                    let v = this.fade(y);
                    let w = this.fade(z);
                    
                    let A = this.p[X] + Y;
                    let AA = this.p[A] + Z;
                    let AB = this.p[A + 1] + Z;
                    let B = this.p[X + 1] + Y;
                    let BA = this.p[B] + Z;
                    let BB = this.p[B + 1] + Z;

                    return this.lerp(w,
                        this.lerp(v,
                            this.lerp(u, this.grad(this.p[AA], x, y, z), this.grad(this.p[BA], x - 1, y, z)),
                            this.lerp(u, this.grad(this.p[AB], x, y - 1, z), this.grad(this.p[BB], x - 1, y - 1, z))
                        ),
                        this.lerp(v,
                            this.lerp(u, this.grad(this.p[AA + 1], x, y, z - 1), this.grad(this.p[BA + 1], x - 1, y, z - 1)),
                            this.lerp(u, this.grad(this.p[AB + 1], x, y - 1, z - 1), this.grad(this.p[BB + 1], x - 1, y - 1, z - 1))
                        )
                    );
                }
            }
            
            const workerHeightCache = new Map();
            const perlin = new OptimizedPerlin(${CONFIG.TERRAIN.seed});
            
            function clamp(v, a, b) {
                return Math.max(a, Math.min(b, v));
            }
            
            const calculateHeight = (x, z) => {
    // ⚠️ ============================================================================
    // ⚠️ CRITICAL SYNCHRONIZATION WARNING - TERRAIN GENERATION CODE
    // ⚠️ ============================================================================
    // ⚠️ This terrain generation algorithm is DUPLICATED in THREE locations:
    // ⚠️
    // ⚠️   1. terrain.js HeightCalculator.calculateHeight() (MAIN THREAD)
    // ⚠️   2. HERE: terrain.js worker calculateHeight() (WEB WORKER)
    // ⚠️   3. WaterRenderer.js calculateTerrainHeight() (GPU SHADER - lines ~107 & ~348)
    // ⚠️
    // ⚠️ ANY CHANGES TO THIS ALGORITHM MUST BE MANUALLY REPLICATED TO ALL 3 LOCATIONS!
    // ⚠️
    // ⚠️ Failure to synchronize will cause:
    // ⚠️   - Water/terrain height mismatches
    // ⚠️   - Visual seams between chunks
    // ⚠️   - Incorrect collision detection
    // ⚠️   - Physics glitches
    // ⚠️
    // ⚠️ Parameters must match exactly:
    // ⚠️   - Perlin noise octaves, frequencies, amplitudes
    // ⚠️   - Terrain floor compression (lines ~673-679)
    // ⚠️   - Ocean generation (lines ~681-715)
    // ⚠️   - All magic numbers and constants
    // ⚠️ ============================================================================

    // Validate input
    if (!isFinite(x) || !isFinite(z)) {
        return 0;
    }

    const rx = roundCoord(x);
    const rz = roundCoord(z);
    const key = \`\${rx},\${rz}\`;
    if (workerHeightCache.has(key)) {
        return workerHeightCache.get(key);
    }

    let base = 0;
    let amplitude = terrainConfig.baseAmplitude;
    let frequency = terrainConfig.baseFrequency;
    
    for (let octave = 0; octave < terrainConfig.baseOctaves; octave++) {
        const noiseValue = perlin.noise(rx * frequency, rz * frequency, 10 + octave * 7);
        if (!isFinite(noiseValue)) {
            console.error('Invalid noise value at', rx, rz);
            return 0;
        }
        base += noiseValue * amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }

    let maskRaw = perlin.noise(rx * terrainConfig.maskFrequency, rz * terrainConfig.maskFrequency, 400);
    if (!isFinite(maskRaw)) maskRaw = 0;
    let mask = Math.pow((maskRaw + 1) * 0.5, 3);

    let mountain = 0;
    amplitude = terrainConfig.mountainAmplitude;
    frequency = terrainConfig.mountainFrequency;
    
    for (let octave = 0; octave < terrainConfig.mountainOctaves; octave++) {
        const noiseValue = perlin.noise(rx * frequency, rz * frequency, 500 + octave * 11);
        if (!isFinite(noiseValue)) continue;
        mountain += Math.abs(noiseValue) * amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }
    mountain *= terrainConfig.mountainScale * mask;
    
    let heightBeforeJagged = base + mountain;
    
    const elevNorm = clamp((heightBeforeJagged + 2) / 25, 0, 1);
    let jaggedScale = heightBeforeJagged < 1.5 ? Math.max(0.1, (heightBeforeJagged + 0.5) / 10.0) : 1.0;
    
    const jagged1 = perlin.noise(rx * terrainConfig.jaggedFrequency1, rz * terrainConfig.jaggedFrequency1, terrainConfig.jaggedNoiseOffset1);
    const jagged2 = perlin.noise(rx * terrainConfig.jaggedFrequency2, rz * terrainConfig.jaggedFrequency2, terrainConfig.jaggedNoiseOffset2);
    
    let jagged = 0;
    if (isFinite(jagged1)) jagged += jagged1 * terrainConfig.jaggedAmplitude1 * elevNorm * jaggedScale;
    if (isFinite(jagged2)) jagged += jagged2 * terrainConfig.jaggedAmplitude2 * elevNorm * jaggedScale;

    let height = heightBeforeJagged + jagged;

    // ========== TERRAIN FLOOR START (DELETE FROM HERE TO REMOVE FLOOR) ==========
    // Exponential compression floor to prevent water puddles while preserving variation
    // Starts compressing at 1.9, asymptotically approaches 1.3 minimum
    if (height < 1.9) {
        const belowAmount = 1.9 - height;
        const maxCompression = 0.6; // (1.9 - 1.3) maximum drop
        const compressed = maxCompression * (1 - Math.exp(-belowAmount * 0.5));
        height = 1.9 - compressed; // Approaches 1.3 but never quite reaches it
    }
    // ========== TERRAIN FLOOR END (DELETE TO HERE TO REMOVE FLOOR) ==========

    // ========== OCEAN GENERATION START (DELETE FROM HERE TO REMOVE OCEAN) ==========
    // Create ocean by lowering terrain smoothly and randomly
    // Coastline position varies between x=0 and x=20 based on z position
    const coastlineThreshold = 10 + perlin.noise(rz * 0.01, 777, 0) * 10;
    const transitionWidth = 8; // Units over which to blend from land to ocean

    // Calculate distance from threshold (positive = ocean side, negative = land side)
    const distanceFromThreshold = rx - coastlineThreshold;

    // Create smooth transition using smoothstep function
    // t goes from 0 (before transition) to 1 (after transition)
    const t = Math.max(0, Math.min(1, (distanceFromThreshold + transitionWidth) / (transitionWidth * 2)));
    const smoothTransition = t * t * (3 - 2 * t); // Smoothstep S-curve

    if (smoothTransition > 0) {
        const oceanDistance = Math.max(0, distanceFromThreshold);

        // Reduce noise intensity as distance from coast increases (smoother deep ocean)
        const noiseIntensity = 1 / (1 + oceanDistance * 0.05);

        // Add noise for varied coastline - intensity reduces with distance
        const coastlineNoise = perlin.noise(rx * 0.02, rz * 0.02, 999) * 5 * noiseIntensity;
        const adjustedDistance = Math.max(0, oceanDistance + coastlineNoise);

        // Gradually deepen as distance increases - depth noise also reduces with distance
        const depthNoise = perlin.noise(rx * 0.05, rz * 0.05, 888) * 2 * noiseIntensity;
        const depthFactor = (adjustedDistance * 0.5) + depthNoise;

        // Apply ocean effect gradually based on transition
        height -= depthFactor * smoothTransition;

        // Cap at ocean floor
        height = Math.max(height, -3);
    }
    // ========== OCEAN GENERATION END (DELETE TO HERE TO REMOVE OCEAN) ==========

    // ========== RIVER GENERATION START (DELETE FROM HERE TO REMOVE RIVER) ==========
    // Create rivers at random intervals along the Z-axis (every 100-300 units)
    // Rivers run parallel to the coast, perpendicular to ocean

    const riverSegmentSize = 200; // Average spacing between rivers
    const riverTransitionWidth = 8; // Units over which to blend
    const riverWidth = 10; // Distance from first bank to center (and center to far bank)

    // Determine which river segment we're in
    const riverSegment = Math.floor(rz / riverSegmentSize);

    // Use segment number to generate deterministic random values for this segment
    const segmentSeed = riverSegment * 73856093; // Large prime for good distribution
    const segmentRandom = Math.abs(Math.sin(segmentSeed) * 43758.5453123);
    const hasRiver = (segmentRandom % 1) > 0.3; // 70% chance of river in this segment

    if (hasRiver) {
        // Random offset within segment (0-100 range gives 100-300 spacing variability)
        const riverOffsetInSegment = ((segmentRandom * 7919) % 1) * 100; // Use different multiplier for offset
        const riverCenterZ = riverSegment * riverSegmentSize + riverOffsetInSegment + 10;

        // River meanders based on x position
        const riverMeanderOffset = perlin.noise(rx * 0.01, 666 + riverSegment, 0) * 10;
        const riverThreshold = riverCenterZ + riverMeanderOffset;

        // Calculate distance from river threshold
        const riverDistanceFromThreshold = rz - riverThreshold;

        // River occupies z = threshold to threshold + 20 (two 10-unit banks)
        if (riverDistanceFromThreshold >= -riverTransitionWidth && riverDistanceFromThreshold <= riverWidth * 2 + riverTransitionWidth) {
            let riverDepthFactor = 0;

            if (riverDistanceFromThreshold <= riverWidth) {
                // First bank (z = threshold to threshold + 10)
                const t = Math.max(0, Math.min(1, (riverDistanceFromThreshold + riverTransitionWidth) / (riverTransitionWidth * 2)));
                const smoothTransition = t * t * (3 - 2 * t);

                if (smoothTransition > 0) {
                    const riverDistance = Math.max(0, riverDistanceFromThreshold);
                    const noiseIntensity = 1 / (1 + riverDistance * 0.05);
                    const riverBankNoise = perlin.noise(rx * 0.02, rz * 0.02, 555) * 5 * noiseIntensity;
                    const adjustedRiverDistance = Math.max(0, riverDistance + riverBankNoise);
                    const riverDepthNoise = perlin.noise(rx * 0.05, rz * 0.05, 444) * 2 * noiseIntensity;
                    riverDepthFactor = ((adjustedRiverDistance * 0.5) + riverDepthNoise) * smoothTransition;
                }
            } else {
                // Second bank (z = threshold + 10 to threshold + 20)
                const reversedDistance = riverWidth * 2 - riverDistanceFromThreshold;
                const t = Math.max(0, Math.min(1, (reversedDistance + riverTransitionWidth) / (riverTransitionWidth * 2)));
                const smoothTransition = t * t * (3 - 2 * t);

                if (smoothTransition > 0) {
                    const riverDistance = Math.max(0, reversedDistance);
                    const noiseIntensity = 1 / (1 + riverDistance * 0.05);
                    const riverBankNoise = perlin.noise(rx * 0.02, rz * 0.02, 555) * 5 * noiseIntensity;
                    const adjustedRiverDistance = Math.max(0, riverDistance + riverBankNoise);
                    const riverDepthNoise = perlin.noise(rx * 0.05, rz * 0.05, 444) * 2 * noiseIntensity;
                    riverDepthFactor = ((adjustedRiverDistance * 0.5) + riverDepthNoise) * smoothTransition;
                }
            }

            // Apply river effect
            height -= riverDepthFactor;
            height = Math.max(height, -3);
        }
    }
    // ========== RIVER GENERATION END (DELETE TO HERE TO REMOVE RIVER) ==========

    // Final validation
    if (!isFinite(height)) {
        console.error('NaN height at', rx, rz);
        return 0;
    }

    workerHeightCache.set(key, height);
    limitCacheSize(workerHeightCache, MAX_CACHE_SIZE);
    return height;
};

            self.onmessage = (e) => {
                const { type, data } = e.data;

                if (type === 'calculateHeightBatch') {
                    const { points, batchId, chunkX, chunkZ, chunkSize } = data;
                    const results = [];
                    const eps = 0.1;

                    for (let i = 0; i < points.length; i++) {
                        const { x, z, index } = points[i];
                        const h = calculateHeight(x, z);

                        const hL = calculateHeight(x - eps, z);
                        const hR = calculateHeight(x + eps, z);
                        const hD = calculateHeight(x, z - eps);
                        const hU = calculateHeight(x, z + eps);

                        const nx = hL - hR;
                        const ny = 2 * eps;
                        const nz = hD - hU;
                        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                        const normal = len === 0 ? { x: 0, y: 1, z: 0 } : { x: nx / len, y: ny / len, z: nz / len };

                        results.push({
                            x, z, height: h,
                            normal,
                            index
                        });
                    }

                    // Generate height texture for water (128x128)
                    const textureSize = 128;
                    const heightTextureData = new Float32Array(textureSize * textureSize);
                    const minHeight = -10;
                    const maxHeight = 80;
                    const heightRange = maxHeight - minHeight;

                    for (let ty = 0; ty < textureSize; ty++) {
                        for (let tx = 0; tx < textureSize; tx++) {
                            // Calculate world coordinates for this texture pixel
                            const worldX = chunkX + (tx / (textureSize - 1) - 0.5) * chunkSize;
                            const worldZ = chunkZ + (ty / (textureSize - 1) - 0.5) * chunkSize;

                            const height = calculateHeight(worldX, worldZ);
                            const normalizedHeight = Math.max(0, Math.min(1, (height - minHeight) / heightRange));

                            heightTextureData[ty * textureSize + tx] = normalizedHeight;
                        }
                    }

                    self.postMessage({
                        type: 'heightBatchResult',
                        data: {
                            results,
                            batchId,
                            heightTextureData,
                            textureSize
                        }
                    });
                }

            };
        `;
    }

    calculateHeightBatch(points, batchId, chunkX, chunkZ, chunkSize, callback) {
        if (!this.worker) {
            console.warn('Worker not available, calculating on main thread');
            setTimeout(() => {
                const results = [];
                const eps = 0.1;

                for (let i = 0; i < points.length; i++) {
                    const { x, z, index } = points[i];
                    const height = this.fallbackCalculator.calculateHeight(x, z);
                    const normal = this.fallbackCalculator.calculateNormal(x, z, eps);

                    results.push({
                        x, z, height,
                        normal,
                        index
                    });
                }

                // Generate fallback height texture
                const textureSize = 128;
                const heightTextureData = new Float32Array(textureSize * textureSize);
                const minHeight = -10;
                const maxHeight = 80;
                const heightRange = maxHeight - minHeight;

                for (let ty = 0; ty < textureSize; ty++) {
                    for (let tx = 0; tx < textureSize; tx++) {
                        const worldX = chunkX + (tx / (textureSize - 1) - 0.5) * chunkSize;
                        const worldZ = chunkZ + (ty / (textureSize - 1) - 0.5) * chunkSize;
                        const height = this.fallbackCalculator.calculateHeight(worldX, worldZ);
                        const normalizedHeight = Math.max(0, Math.min(1, (height - minHeight) / heightRange));
                        heightTextureData[ty * textureSize + tx] = normalizedHeight;
                    }
                }

                callback({ results, batchId, heightTextureData, textureSize });
            }, 0);
            return;
        }

        this.messageHandlers.set(batchId, { callback, timestamp: Date.now() });
        this.worker.postMessage({
            type: 'calculateHeightBatch',
            data: { points, batchId, chunkX, chunkZ, chunkSize }
        });

        // Cleanup handlers older than 30 seconds
        const now = Date.now();
        this.messageHandlers.forEach((value, key) => {
            if (now - value.timestamp > 30000) {
                this.messageHandlers.delete(key);
            }
        });
    }

    handleMessage(e) {
        const { type, data } = e.data;
        if (type === 'heightBatchResult') {
            const { batchId } = data;
            const handler = this.messageHandlers.get(batchId);
            if (handler) {
                handler.callback(data);
                this.messageHandlers.delete(batchId);
            }
        }
    }

    terminate() {
        if (this.worker) {
            this.worker.terminate();
            if (this.workerUrl) {
                URL.revokeObjectURL(this.workerUrl);
            }
            this.worker = null;
            this.workerUrl = null;
        }
    }
}

// --- SIMPLE TERRAIN RENDERER ---
export class SimpleTerrainRenderer {
    constructor(scene) {
        this.scene = scene;
        this.chunkMap = new Map();
        this.chunkTrees = new Map(); // To track trees per chunk for cleanup
        this.heightCalculator = new HeightCalculator(CONFIG.TERRAIN.seed);
        this.workerManager = new TerrainWorkerManager();
        this.material = null;
        this.textures = null;
        this.waterRenderer = null;
        this.geometryPool = []; // Pool for reusing chunk geometries
        this.maxPoolSize = 20; // Limit pool size to prevent memory issues
        this.pendingObjectGeneration = []; // Queue for spreading object generation
        this.edgeCache = new Map(); // Cache edge vertices to avoid recalculation at boundaries
        this.pendingVertexUpdates = []; // Queue for batched vertex application
        this.verticesPerBatch = 500; // Apply 500 vertices per frame
        this.processingChunks = new Map(); // Track chunks that are being built
        this.init();
    }

    init() {
        this.textures = TerrainMaterialFactory.createProceduralTextures();
        this.material = TerrainMaterialFactory.createTerrainMaterial(this.textures);
    }

    setWaterRenderer(waterRenderer) {
        this.waterRenderer = waterRenderer;
    }

    processVertexUpdateQueue(playerPos = null) {
        if (this.pendingVertexUpdates.length === 0) {
            return false; // Nothing to process
        }

        const startTime = performance.now();
        const task = this.pendingVertexUpdates[0]; // Peek at first task
        const { key, geometry, results, currentIndex, alignedChunkX, alignedChunkZ, removedObjectIds, timings, totalStartTime, heightTextureData, textureSize } = task;

        // Check if chunk still needed
        if (this.chunkMap.has(key)) {
            // Chunk already finalized, skip
            this.pendingVertexUpdates.shift();
            return true;
        }

        // Check if player has moved too far from this chunk
        if (playerPos) {
            const chunkSize = CONFIG.TERRAIN.chunkSize;
            const [chunkGridX, chunkGridZ] = key.split(',').map(Number);
            const chunkWorldX = chunkGridX * chunkSize;
            const chunkWorldZ = chunkGridZ * chunkSize;

            const playerChunkX = Math.floor(playerPos.x / chunkSize);
            const playerChunkZ = Math.floor(playerPos.z / chunkSize);

            const distanceX = Math.abs(chunkGridX - playerChunkX);
            const distanceZ = Math.abs(chunkGridZ - playerChunkZ);
            const distance = Math.max(distanceX, distanceZ);

            // If chunk is beyond render distance + 1, abandon it
            if (distance > CONFIG.TERRAIN.renderDistance + 1) {
                console.log(`🚫 Abandoning far chunk ${key} (distance: ${distance})`);
                // Dispose the geometry if it's not in the pool
                if (geometry && !this.geometryPool.includes(geometry)) {
                    geometry.dispose();
                }
                // Remove from processing chunks
                this.processingChunks.delete(key);
                // Remove from queue
                this.pendingVertexUpdates.shift();
                return true;
            }
        }

        const position = geometry.attributes.position;
        const normal = geometry.attributes.normal;

        // Process a batch of vertices
        const endIndex = Math.min(currentIndex + this.verticesPerBatch, results.length);
        for (let i = currentIndex; i < endIndex; i++) {
            const { height, normal: n, index } = results[i];
            position.array[index * 3 + 1] = height;
            normal.array[index * 3] = n.x;
            normal.array[index * 3 + 1] = n.y;
            normal.array[index * 3 + 2] = n.z;
        }

        const batchTime = performance.now() - startTime;
        const verticesProcessed = endIndex - currentIndex;

        // Check if we're done with all vertices
        if (endIndex >= results.length) {
            // Finalize the chunk
            this.pendingVertexUpdates.shift(); // Remove task

            const vertexUpdateStartTime = performance.now();
            position.needsUpdate = true;
            normal.needsUpdate = true;
            geometry.computeBoundingSphere();
            timings.vertexUpdate = performance.now() - vertexUpdateStartTime;

            const meshStartTime = performance.now();
            const mesh = new THREE.Mesh(geometry, this.material);
            mesh.position.set(alignedChunkX, 0, alignedChunkZ);
            mesh.material.side = THREE.FrontSide;
            mesh.frustumCulled = false;
            timings.meshCreate = performance.now() - meshStartTime;

            const sceneAddStartTime = performance.now();
            this.scene.add(mesh);
            timings.sceneAdd = performance.now() - sceneAddStartTime;

            // Remove from processing chunks since it's now finalized
            this.processingChunks.delete(key);

            // Queue tree generation (preserve existing objects like server-added logs)
            if (!this.chunkTrees.has(key)) {
                this.chunkTrees.set(key, []);
            }
            this.pendingObjectGeneration.push({
                key,
                alignedChunkX,
                alignedChunkZ,
                removedObjectIds
            });

            // Store chunk with height texture data for fast lookups
            this.chunkMap.set(key, {
                mesh,
                geometry,
                chunkX: alignedChunkX,
                chunkZ: alignedChunkZ,
                heightTextureData,  // Store for CPU-side height lookups
                textureSize         // Store texture dimensions
            });

            // Add water chunk with height texture from worker
            const waterStartTime = performance.now();
            if (this.waterRenderer && typeof this.waterRenderer.addWaterChunk === 'function') {
                // Create THREE.js texture from worker-generated height data
                let heightTexture = null;
                if (heightTextureData && textureSize) {
                    const textureData = new Uint8Array(textureSize * textureSize);
                    for (let i = 0; i < heightTextureData.length; i++) {
                        textureData[i] = Math.floor(heightTextureData[i] * 255);
                    }

                    heightTexture = new THREE.DataTexture(
                        textureData,
                        textureSize,
                        textureSize,
                        THREE.RedFormat,
                        THREE.UnsignedByteType
                    );
                    heightTexture.wrapS = heightTexture.wrapT = THREE.ClampToEdgeWrapping;
                    heightTexture.minFilter = THREE.LinearFilter;
                    heightTexture.magFilter = THREE.LinearFilter;
                    heightTexture.needsUpdate = true;
                }

                this.waterRenderer.addWaterChunk(alignedChunkX, alignedChunkZ, heightTexture);
            }
            timings.waterAdd = performance.now() - waterStartTime;

            // Log timing summary
            const totalTime = performance.now() - totalStartTime;
            console.log(`✅ Chunk ${key} finalized in ${totalTime.toFixed(2)}ms (vertex batching: ${batchTime.toFixed(2)}ms for last ${verticesProcessed} vertices)`);
            if (Object.keys(timings).length > 0) {
                console.log(`📊 Chunk ${key} creation timings:`);
                Object.entries(timings).forEach(([name, time]) => {
                    if (time > 2) {
                        console.log(`  ${time > 5 ? '⚠️' : '▪️'} ${name}: ${time.toFixed(2)}ms`);
                    }
                });
            }
        } else {
            // More vertices to process - update index and continue next frame
            task.currentIndex = endIndex;
        }

        return true;
    }

    processObjectGenerationQueue() {
        if (this.pendingObjectGeneration.length === 0) {
            return false; // Nothing to process
        }

        const startTime = performance.now();
        const task = this.pendingObjectGeneration.shift(); // Take first task
        const { key, alignedChunkX, alignedChunkZ, removedObjectIds } = task;

        // Check if chunk still exists (might have been unloaded)
        if (!this.chunkMap.has(key)) {
            return true; // Skip this chunk, continue
        }

        // Generate all objects for this chunk at once
        const trees = addTreesToChunk(
            this.scene,
            this.heightCalculator,
            alignedChunkX,
            alignedChunkZ,
            CONFIG.TERRAIN.seed,
            CONFIG.TERRAIN.chunkSize,
            500, // Generate all objects
            removedObjectIds
        );

        // Merge with existing objects (e.g., server-added logs)
        const existingObjects = this.chunkTrees.get(key) || [];
        const allObjects = [...existingObjects, ...trees];
        this.chunkTrees.set(key, allObjects);

        const elapsed = performance.now() - startTime;
        if (elapsed > 5) {
            console.log(`⚠️ Object generation for chunk ${key}: ${elapsed.toFixed(2)}ms (${trees.length} new, ${allObjects.length} total)`);
        } else {
            console.log(`Generated ${trees.length} new objects for chunk ${key} (${allObjects.length} total) in ${elapsed.toFixed(2)}ms`);
        }

        return true; // Processed a chunk
    }


    createChunk(chunkX, chunkZ, removedObjectIds = null) {  // Add parameter
    const totalStartTime = performance.now();
    const timings = {};

    const chunkSize = CONFIG.TERRAIN.chunkSize;
    const segments = CONFIG.TERRAIN.segments;

    // Ensure chunk coordinates align to grid
    const alignedChunkX = Math.floor(chunkX / chunkSize) * chunkSize;
    const alignedChunkZ = Math.floor(chunkZ / chunkSize) * chunkSize;
    const key = `${alignedChunkX / chunkSize},${alignedChunkZ / chunkSize}`;
    if (this.chunkMap.has(key)) {
        return;
    }

    // Try to reuse geometry from pool
    let geometryStartTime = performance.now();
    let geometry;
    if (this.geometryPool.length > 0) {
        geometry = this.geometryPool.pop();
        timings.geometryReuse = performance.now() - geometryStartTime;
        // Geometry is already rotated and configured, just needs new heights
    } else {
        // Create new geometry if pool is empty
        geometry = new THREE.PlaneGeometry(chunkSize, chunkSize, segments, segments);
        geometry.rotateX(-Math.PI / 2);
        timings.geometryCreate = performance.now() - geometryStartTime;
    }

    const points = [];
    const cachedResults = []; // Store cached edge values
    const verticesPerRow = segments + 1;

    // Check adjacent chunks for cached edges
    const gridX = alignedChunkX / chunkSize;
    const gridZ = alignedChunkZ / chunkSize;
    const leftEdgeKey = `edge_${gridX - 1},${gridZ}_right`;
    const rightEdgeKey = `edge_${gridX + 1},${gridZ}_left`;
    const frontEdgeKey = `edge_${gridX},${gridZ - 1}_back`;
    const backEdgeKey = `edge_${gridX},${gridZ + 1}_front`;

    // Generate vertices with precise world coordinates
    for (let z = 0; z <= segments; z++) {
        for (let x = 0; x <= segments; x++) {
            const worldX = alignedChunkX + (x / segments - 0.5) * chunkSize;
            const worldZ = alignedChunkZ + (z / segments - 0.5) * chunkSize;
            const index = z * verticesPerRow + x;

            // Check if this vertex is on an edge that's cached
            let cached = null;
            if (x === 0 && this.edgeCache.has(leftEdgeKey)) {
                cached = this.edgeCache.get(leftEdgeKey)[z];
            } else if (x === segments && this.edgeCache.has(rightEdgeKey)) {
                cached = this.edgeCache.get(rightEdgeKey)[z];
            } else if (z === 0 && this.edgeCache.has(frontEdgeKey)) {
                cached = this.edgeCache.get(frontEdgeKey)[x];
            } else if (z === segments && this.edgeCache.has(backEdgeKey)) {
                cached = this.edgeCache.get(backEdgeKey)[x];
            }

            if (cached) {
                // Use cached value
                cachedResults.push({ height: cached.height, normal: cached.normal, index });
            } else {
                // Need to calculate this point
                points.push({
                    x: roundCoord(worldX),
                    z: roundCoord(worldZ),
                    index
                });
            }
        }
    }

    const workerStartTime = performance.now();
    timings.vertexPrep = workerStartTime - geometryStartTime - (timings.geometryReuse || timings.geometryCreate || 0);

    const batchId = `${alignedChunkX},${alignedChunkZ}_${Date.now()}`;
    this.workerManager.calculateHeightBatch(points, batchId, alignedChunkX, alignedChunkZ, chunkSize, ({ results, heightTextureData, textureSize }) => {
        const callbackStartTime = performance.now();
        timings.workerWait = callbackStartTime - workerStartTime;

        // Combine cached and calculated results
        const allResults = [...cachedResults, ...results];

        // Cache this chunk's edges for adjacent chunks (do this immediately, it's fast)
        const leftEdge = [];
        const rightEdge = [];
        const frontEdge = [];
        const backEdge = [];

        allResults.forEach(({ height, normal, index }) => {
            const x = index % verticesPerRow;
            const z = Math.floor(index / verticesPerRow);
            if (x === 0) leftEdge[z] = { height, normal };
            if (x === segments) rightEdge[z] = { height, normal };
            if (z === 0) frontEdge[x] = { height, normal };
            if (z === segments) backEdge[x] = { height, normal };
        });

        this.edgeCache.set(`edge_${gridX},${gridZ}_left`, leftEdge);
        this.edgeCache.set(`edge_${gridX},${gridZ}_right`, rightEdge);
        this.edgeCache.set(`edge_${gridX},${gridZ}_front`, frontEdge);
        this.edgeCache.set(`edge_${gridX},${gridZ}_back`, backEdge);

        // Track this chunk as being processed
        this.processingChunks.set(key, {
            geometry,
            startTime: Date.now(),
            chunkX: alignedChunkX,
            chunkZ: alignedChunkZ
        });

        // INSTEAD of applying all vertices now, queue them for batched processing
        this.pendingVertexUpdates.push({
            key,
            geometry,
            results: allResults,
            verticesPerRow,
            segments,
            gridX,
            gridZ,
            alignedChunkX,
            alignedChunkZ,
            removedObjectIds,
            timings,
            totalStartTime,
            currentIndex: 0, // Track progress through vertices
            heightTextureData, // Store height texture data from worker
            textureSize // Store texture size
        });

        console.log(`Worker returned for chunk ${key}, queued ${allResults.length} vertices for batched application`);
    });
}
    

    // Method to ensure vertex sharing at chunk boundaries
    ensureVertexContinuity(chunkX, chunkZ) {
        const chunkSize = CONFIG.TERRAIN.chunkSize;
        const segments = CONFIG.TERRAIN.segments;
        const key = `${chunkX / chunkSize},${chunkZ / chunkSize}`;
        
        const chunk = this.chunkMap.get(key);
        if (!chunk) return;

        // Check adjacent chunks and ensure edge vertices match
        const adjacentKeys = [
            `${(chunkX - chunkSize) / chunkSize},${chunkZ / chunkSize}`, // Left
            `${(chunkX + chunkSize) / chunkSize},${chunkZ / chunkSize}`, // Right
            `${chunkX / chunkSize},${(chunkZ - chunkSize) / chunkSize}`, // Front
            `${chunkX / chunkSize},${(chunkZ + chunkSize) / chunkSize}`  // Back
        ];

        adjacentKeys.forEach(adjKey => {
            const adjChunk = this.chunkMap.get(adjKey);
            if (adjChunk) {
                this.matchEdgeVertices(chunk, adjChunk);
            }
        });
    }

    matchEdgeVertices(chunk1, chunk2) {
        // Ensure vertices at chunk boundaries have identical heights
        const pos1 = chunk1.geometry.attributes.position;
        const pos2 = chunk2.geometry.attributes.position;
        const segments = CONFIG.TERRAIN.segments;
        const chunkSize = CONFIG.TERRAIN.chunkSize;
        
        // Determine which edge to match based on chunk positions
        const dx = chunk2.chunkX - chunk1.chunkX;
        const dz = chunk2.chunkZ - chunk1.chunkZ;
        
        if (Math.abs(dx) === chunkSize && dz === 0) {
            // Horizontal neighbors - match vertical edges
            this.matchVerticalEdge(pos1, pos2, dx > 0, segments);
        } else if (dx === 0 && Math.abs(dz) === chunkSize) {
            // Vertical neighbors - match horizontal edges
            this.matchHorizontalEdge(pos1, pos2, dz > 0, segments);
        }
    }

    matchVerticalEdge(pos1, pos2, isRightEdge, segments) {
        const verticesPerRow = segments + 1;
        
        for (let z = 0; z <= segments; z++) {
            const edge1Index = isRightEdge ? z * verticesPerRow + segments : z * verticesPerRow;
            const edge2Index = isRightEdge ? z * verticesPerRow : z * verticesPerRow + segments;
            
            // Average the heights to ensure continuity
            const height1 = pos1.array[edge1Index * 3 + 1];
            const height2 = pos2.array[edge2Index * 3 + 1];
            const avgHeight = (height1 + height2) / 2;
            
            pos1.array[edge1Index * 3 + 1] = avgHeight;
            pos2.array[edge2Index * 3 + 1] = avgHeight;
        }
        
        pos1.needsUpdate = true;
        pos2.needsUpdate = true;
    }

    matchHorizontalEdge(pos1, pos2, isBackEdge, segments) {
        const verticesPerRow = segments + 1;
        
        for (let x = 0; x <= segments; x++) {
            const edge1Index = isBackEdge ? segments * verticesPerRow + x : x;
            const edge2Index = isBackEdge ? x : segments * verticesPerRow + x;
            
            // Average the heights to ensure continuity
            const height1 = pos1.array[edge1Index * 3 + 1];
            const height2 = pos2.array[edge2Index * 3 + 1];
            const avgHeight = (height1 + height2) / 2;
            
            pos1.array[edge1Index * 3 + 1] = avgHeight;
            pos2.array[edge2Index * 3 + 1] = avgHeight;
        }
        
        pos1.needsUpdate = true;
        pos2.needsUpdate = true;
    }

    disposeChunk(key) {
        console.log(`🔧 disposeChunk called for ${key}`);
        const chunk = this.chunkMap.get(key);

        // First, clean up any in-progress chunk that hasn't been finalized yet
        const processingChunk = this.processingChunks.get(key);
        if (processingChunk) {
            console.log(`🧹 Cleaning up in-progress chunk ${key}`);
            if (processingChunk.geometry && !this.geometryPool.includes(processingChunk.geometry)) {
                processingChunk.geometry.dispose();
            }
            this.processingChunks.delete(key);
            console.log(`  ✅ Removed ${key} from processingChunks. Remaining: ${this.processingChunks.size}`);
        } else {
            console.log(`  ❌ Chunk ${key} not in processingChunks`);
        }

        // ALWAYS remove from pending queues, regardless of chunk state
        // This prevents orphaned chunks from processing forever
        const vertexBefore = this.pendingVertexUpdates.length;
        this.pendingVertexUpdates = this.pendingVertexUpdates.filter(task => task.key !== key);
        const vertexAfter = this.pendingVertexUpdates.length;
        if (vertexBefore > vertexAfter) {
            console.log(`  ✅ Removed ${vertexBefore - vertexAfter} vertex tasks for ${key}`);
        }

        this.pendingObjectGeneration = this.pendingObjectGeneration.filter(task => task.key !== key);

        if (chunk) {
            // Count trees before disposal
            const trees = this.chunkTrees.get(key);
            const treeCount = trees ? trees.length : 0;
            console.log(`🗑️ Disposing chunk ${key} (${treeCount} objects)`);

            this.scene.remove(chunk.mesh);

            // Remove procedural trees
            if (trees) {
                removeTrees(this.scene, trees);
                this.chunkTrees.delete(key);
            }

            // Remove edge cache entries for this chunk
            const chunkGridX = chunk.chunkX / CONFIG.TERRAIN.chunkSize;
            const chunkGridZ = chunk.chunkZ / CONFIG.TERRAIN.chunkSize;
            this.edgeCache.delete(`edge_${chunkGridX},${chunkGridZ}_left`);
            this.edgeCache.delete(`edge_${chunkGridX},${chunkGridZ}_right`);
            this.edgeCache.delete(`edge_${chunkGridX},${chunkGridZ}_front`);
            this.edgeCache.delete(`edge_${chunkGridX},${chunkGridZ}_back`);

            // Return geometry to pool instead of disposing (if pool not full)
            if (this.geometryPool.length < this.maxPoolSize) {
                this.geometryPool.push(chunk.geometry);
            } else {
                // Pool is full, dispose this geometry
                chunk.geometry.dispose();
            }

            this.chunkMap.delete(key);
            if (this.waterRenderer && typeof this.waterRenderer.removeWaterChunk === 'function') {
                this.waterRenderer.removeWaterChunk(chunk.chunkX, chunk.chunkZ);
            }
        }
    }

    getTerrainHeightAt(x, z) {
        return this.heightCalculator.calculateHeight(x, z);
    }

    getTerrainNormalAt(x, z) {
        const normal = this.heightCalculator.calculateNormal(x, z);
        return new THREE.Vector3(normal.x, normal.y, normal.z);
    }

    /**
     * Get terrain height using cached texture data (fast) with bilinear interpolation
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {number} Height at position
     */
    getHeightFast(x, z) {
        const chunkSize = CONFIG.TERRAIN.chunkSize;

        // Find which chunk contains this position (chunks are centered at their coordinates)
        const chunkX = Math.round(x / chunkSize) * chunkSize;
        const chunkZ = Math.round(z / chunkSize) * chunkSize;
        const chunkKey = `${chunkX / chunkSize},${chunkZ / chunkSize}`;

        // Try to get cached height texture data
        const chunk = this.chunkMap.get(chunkKey);
        if (chunk && chunk.heightTextureData && chunk.textureSize) {
            // Convert world coords to local chunk coords (-chunkSize/2 to +chunkSize/2)
            const localX = x - chunkX;
            const localZ = z - chunkZ;

            // Convert to texture coordinates (accounting for -0.5 to +0.5 range in texture generation)
            const textureSize = chunk.textureSize;
            const texX = ((localX / chunkSize) + 0.5) * (textureSize - 1);
            const texZ = ((localZ / chunkSize) + 0.5) * (textureSize - 1);

            // Get integer and fractional parts for bilinear interpolation
            const x0 = Math.floor(texX);
            const z0 = Math.floor(texZ);
            const x1 = Math.min(x0 + 1, textureSize - 1);
            const z1 = Math.min(z0 + 1, textureSize - 1);

            const fx = texX - x0; // Fractional X (0 to 1)
            const fz = texZ - z0; // Fractional Z (0 to 1)

            // Sample 4 neighboring texels
            const h00 = chunk.heightTextureData[z0 * textureSize + x0];
            const h10 = chunk.heightTextureData[z0 * textureSize + x1];
            const h01 = chunk.heightTextureData[z1 * textureSize + x0];
            const h11 = chunk.heightTextureData[z1 * textureSize + x1];

            // Bilinear interpolation
            const h0 = h00 * (1 - fx) + h10 * fx; // Interpolate along X at z0
            const h1 = h01 * (1 - fx) + h11 * fx; // Interpolate along X at z1
            const normalizedHeight = h0 * (1 - fz) + h1 * fz; // Interpolate along Z

            // Denormalize back to actual height (matching worker normalization)
            const minHeight = -10;
            const maxHeight = 80;
            const heightRange = maxHeight - minHeight;

            // Denormalize the 4 sample heights for logging
            const actualHeight = normalizedHeight * heightRange + minHeight;

            return actualHeight;
        }

        // Fallback to noise calculation if chunk not loaded
        return this.heightCalculator.calculateHeight(x, z);
    }

    // Removed unused updateTerrain() method - functionality handled by ChunkManager in game.js

    dispose() {
        this.chunkMap.forEach((chunk, key) => {
            this.scene.remove(chunk.mesh);
            chunk.geometry.dispose();
        });
        this.chunkMap.clear();

        // Dispose all geometries in pool
        this.geometryPool.forEach(geometry => geometry.dispose());
        this.geometryPool = [];

        // Clear edge cache
        this.edgeCache.clear();

        this.material.dispose();
        Object.values(this.textures).forEach(texture => texture.dispose());
        this.workerManager.terminate();
        if (this.waterRenderer && typeof this.waterRenderer.dispose === 'function') {
            this.waterRenderer.dispose();
        }
    }
    // Add this function to SimpleTerrainRenderer class
}
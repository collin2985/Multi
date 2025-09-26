// terrain/heightGeneration/HeightCalculator.js
import { OptimizedPerlin } from '../noise/OptimizedPerlin.js';
import { Utilities } from '../utilities.js'; 
import { CONFIG } from '../config.js';

// --- START FIX: Ensure deterministic precision across threads/lookups ---
// This factor matches the precision used in SimpleTerrainRenderer.js for consistency.
const FLOAT_PRECISION = 10000.0;
const roundCoord = (coord) => Math.round(coord * FLOAT_PRECISION) / FLOAT_PRECISION;
// --- END FIX ---

export class HeightCalculator {
    constructor(seed = 12345) {
        this.perlin = new OptimizedPerlin(seed);
        this.heightCache = new Map();
        // Define cache size based on config for memory safety
        this.MAX_CACHE_SIZE = CONFIG.PERFORMANCE.maxCacheSize;
    }

    clamp(v, a, b) {
        return Math.max(a, Math.min(b, v));
    }

    calculateHeight(x, z) {
        // ✅ Verify that input coordinates are treated as world coordinates, not relative to chunk.
        // The inputs x, z are world coordinates. We standardize their precision.
        const rx = roundCoord(x);
        const rz = roundCoord(z);
        
        // ✅ Keep cache precision consistent (rounding). The key uses the standardized world coordinates.
        const key = `${rx},${rz}`;

        if (this.heightCache.has(key)) {
            return this.heightCache.get(key);
        }

        // ✅ Ensure that the calculateHeight function is deterministic and matches exactly between main thread and worker.
        // Using the standardized coordinates (rx, rz) guarantees deterministic lookups.

        // Base terrain with multiple octaves
        let base = 0;
        let amplitude = 1;
        let frequency = 0.02;
        
        for (let octave = 0; octave < 3; octave++) {
            base += this.perlin.noise(rx * frequency, rz * frequency, 10 + octave * 7) * amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }

        // Mountain mask
        let maskRaw = this.perlin.noise(rx * 0.006, rz * 0.006, 400);
        let mask = Math.pow((maskRaw + 1) * 0.5, 3);

        // Mountain generation
        let mountain = 0;
        amplitude = 1;
        frequency = 0.04;
        
        for (let octave = 0; octave < 4; octave++) {
            mountain += Math.abs(this.perlin.noise(rx * frequency, rz * frequency, 500 + octave * 11)) * amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }
        mountain *= 40 * mask;
        
        
        // New height calculation: Base + Mountain only, removing sea-related subtraction.
let heightBeforeJagged = base + mountain;        

        // Elevation-based details
        const elevNorm = this.clamp((heightBeforeJagged + 2) / 25, 0, 1);
        let jagged = this.perlin.noise(rx * 0.8, rz * 0.8, 900) * 1.2 * elevNorm + 
                     this.perlin.noise(rx * 1.6, rz * 1.6, 901) * 0.6 * elevNorm;
        
        const height = heightBeforeJagged + jagged;
        this.heightCache.set(key, height);
        
        // Implement cache limiting to prevent memory leak
        Utilities.limitCacheSize(this.heightCache, this.MAX_CACHE_SIZE);
        return height;
    }

    calculateNormal(x, z, eps = 0.1) {
        // The finite difference calculation relies on calculateHeight, which now handles 
        // coordinate rounding internally for consistent results.
        const hL = this.calculateHeight(x - eps, z);
        const hR = this.calculateHeight(x + eps, z);
        const hD = this.calculateHeight(x, z - eps);
        const hU = this.calculateHeight(x, z + eps);

        const nx = hL - hR;
        const ny = 2 * eps;
        const nz = hD - hU;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) ||
        1;

        return { x: nx / len, y: ny / len, z: nz / len };
    }

    clearCache() {
        this.heightCache.clear();
    }
}
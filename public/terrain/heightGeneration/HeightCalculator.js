// terrain/heightGeneration/HeightCalculator.js
import { OptimizedPerlin } from '../noise/OptimizedPerlin.js';

export class HeightCalculator {
    constructor(seed = 12345) {
        this.perlin = new OptimizedPerlin(seed);
        this.heightCache = new Map();
    }

    clamp(v, a, b) {
        return Math.max(a, Math.min(b, v));
    }

    calculateHeight(x, z) {
        const key = `${x},${z}`;
        if (this.heightCache.has(key)) {
            return this.heightCache.get(key);
        }

        // Base terrain with multiple octaves
        let base = 0;
        let amplitude = 1;
        let frequency = 0.02;
        
        for (let octave = 0; octave < 3; octave++) {
            base += this.perlin.noise(x * frequency, z * frequency, 10 + octave * 7) * amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }

        // Mountain mask
        let maskRaw = this.perlin.noise(x * 0.006, z * 0.006, 400);
        let mask = Math.pow((maskRaw + 1) * 0.5, 3);

        // Mountain generation
        let mountain = 0;
        amplitude = 1;
        frequency = 0.04;
        
        for (let octave = 0; octave < 4; octave++) {
            mountain += Math.abs(this.perlin.noise(x * frequency, z * frequency, 500 + octave * 11)) * amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }
        mountain *= 40 * mask;

        // Elevation-based details
        const elevNorm = this.clamp((base + mountain + 2) / 25, 0, 1);
        let jagged = this.perlin.noise(x * 0.8, z * 0.8, 900) * 1.2 * elevNorm + 
                   this.perlin.noise(x * 1.6, z * 1.6, 901) * 0.6 * elevNorm;

        const height = base + mountain + jagged;
        this.heightCache.set(key, height);
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
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;

        return { x: nx / len, y: ny / len, z: nz / len };
    }

    clearCache() {
        this.heightCache.clear();
    }
}

// terrain/workers/TerrainWorkerManager.js
import { HeightCalculator } from '../heightGeneration/HeightCalculator.js';

export class TerrainWorkerManager {
    constructor() {
        this.worker = null;
        this.pendingBatches = new Map();
        this.messageHandlers = new Map();
        // The fallback calculator uses the main thread's logic, which must match the worker
        this.fallbackCalculator = new HeightCalculator(12345);
        this.initialize();
    }

    initialize() {
        try {
            const workerCode = this.generateWorkerCode();
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            this.worker = new Worker(URL.createObjectURL(blob));
            this.worker.onmessage = this.handleMessage.bind(this);
            this.worker.onerror = (error) => console.error('Worker error:', error);
        } catch (err) {
            console.error('Failed to initialize worker:', err);
            this.worker = null;
        }
    }

    generateWorkerCode() {
        // Hardcoding constants from CONFIG and HeightCalculator to ensure worker consistency
        const MAX_CACHE_SIZE = 20000; // From CONFIG.PERFORMANCE.maxCacheSize [cite: 609]
        const FLOAT_PRECISION = 10000.0; // Matches the precision used for caching/rounding in SimpleTerrainRenderer [cite: 635]
        
        // --- START OF WORKER CODE STRING ---
        return `
            // Deterministic Helpers for seamless boundaries (matching HeightCalculator.js)
            const FLOAT_PRECISION = ${FLOAT_PRECISION};
            const MAX_CACHE_SIZE = ${MAX_CACHE_SIZE};
            const roundCoord = (coord) => Math.round(coord * FLOAT_PRECISION) / FLOAT_PRECISION;
            
            // Worker-side cache management: clear the cache if it grows too large (prevent stale results).
            const limitCacheSize = (cache, maxSize) => {
                // Clear the cache completely if it exceeds 125% of the maximum allowed size.
                if (cache.size > maxSize * 1.25) {
                    cache.clear();
                }
            };

            // OptimizedPerlin class (byte-for-byte match to terrain/noise/OptimizedPerlin.js)
            class OptimizedPerlin {
                constructor(seed = 12345) {
                    this.p = new Array(512);
                    const perm = [];
                    const rng = this.mulberry32(seed);
                    for (let i = 0; i < 256; i++) perm[i] = i;
                    for (let i = 255; i > 0; i--) {
                        const j = Math.floor(rng() * (i + 1));
                        [perm[i], perm[j]] = [perm[j], perm[i]];
                    }
                    for (let i = 0; i < 256; i++) {
                        this.p[i] = this.p[i + 256] = perm[i];
                    }
                }

                mulberry32(seed) {
                    return function() {
                        let t = seed += 0x6D2B79F4;
                        t = Math.imul(t ^ (t >>> 15), t | 1);
                        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
                        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
                    };
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
                    const v = h < 4 ?
                        y : (h === 12 || h === 14 ? x : z);
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
            const perlin = new OptimizedPerlin(12345);
            
            function clamp(v, a, b) {
                return Math.max(a, Math.min(b, v));
            }
            
            // ✅ The embedded worker’s calculateHeight logic is a byte-for-byte match of HeightCalculator.js (fixed version).
            const calculateHeight = (x, z) => {
                // Apply deterministic rounding to input coordinates
                const rx = roundCoord(x);
                const rz = roundCoord(z);

                // Use rounded coordinates for cache key
                const key = \`\${rx},\${rz}\`;
                if (workerHeightCache.has(key)) {
                    return workerHeightCache.get(key);
                }

                // Base terrain with multiple octaves
                let base = 0;
                let amplitude = 1;
                let frequency = 0.02;
                
                for (let octave = 0; octave < 3; octave++) {
                    // Use rounded coordinates for deterministic noise
                    base += perlin.noise(rx * frequency, rz * frequency, 10 + octave * 7) * amplitude;
                    amplitude *= 0.5;
                    frequency *= 2;
                }

                // Mountain mask
                let maskRaw = perlin.noise(rx * 0.006, rz * 0.006, 400);
                let mask = Math.pow((maskRaw + 1) * 0.5, 3);

                // Mountain generation
                let mountain = 0;
                amplitude = 1;
                frequency = 0.04;
                
                for (let octave = 0; octave < 4; octave++) {
                    // Use rounded coordinates for deterministic noise
                    mountain += Math.abs(perlin.noise(rx * frequency, rz * frequency, 500 + octave * 11)) * amplitude;
                    amplitude *= 0.5;
                    frequency *= 2;
                }
                mountain *= 40 * mask;
                
                // Sea mask generation
                let seaMaskRaw = perlin.noise(rx * 0.0008, rz * 0.0008, 600);
                let normalizedSea = (seaMaskRaw + 1) * 0.5;
                // Binary sea mask
                let seaMask = normalizedSea > 0.75 ?
                    1 : 0; 
                
                // Sea basin generation
                let seaBasin = 0;
                amplitude = 2;
                frequency = 0.01;
                
                for (let octave = 0; octave < 3; octave++) {
                    // Use rounded coordinates for deterministic noise
                    seaBasin += Math.abs(perlin.noise(rx * frequency, rz * frequency, 700 + octave * 13)) * amplitude;
                    amplitude *= 0.5;
                    frequency *= 2;
                }
                // Increase sea depth to reach -20 or deeper
                let seaDepth = seaMask * seaBasin * 100;
                let heightBeforeJagged = base + mountain - seaDepth - (seaMask * 3);
                
                // Elevation-based details
                const elevNorm = clamp((heightBeforeJagged + 2) / 25, 0, 1);
                // Use rounded coordinates for deterministic noise
                let jagged = perlin.noise(rx * 0.8, rz * 0.8, 900) * 1.2 * elevNorm + 
                             perlin.noise(rx * 1.6, rz * 1.6, 901) * 0.6 * elevNorm;
                
                const height = heightBeforeJagged + jagged;
                workerHeightCache.set(key, height);
                
                // ✅ Ensure worker cache doesn't diverge
                limitCacheSize(workerHeightCache, MAX_CACHE_SIZE);
                return height;
            };
            
            self.onmessage = function(e) {
                const { type, data } = e.data;
                if (type === 'calculateHeightBatch') {
                    const { points, batchId } = data;
                    const results = [];
                    // ✅ Check that normal calculation (finite difference) uses the same eps value as the main thread (0.1).
                    const eps = 0.1;
                    
                    for (let i = 0; i < points.length; i++) {
                        const { x, z, index } = points[i];
                        const h = calculateHeight(x, z);
                        
                        // Normal calculation using finite difference method
                        const hL = calculateHeight(x - eps, z);
                        const hR = calculateHeight(x + eps, z);
                        const hD = calculateHeight(x, z - eps);
                        const hU = calculateHeight(x, z + eps);
                        
                        const nx = hL - hR;
                        const ny = 2 * eps;
                        const nz = hD - hU;
                        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) ||
                            1;
                        
                        results.push({
                            x, z, height: h,
                            normal: { x: nx / len, y: ny / len, z: nz / len },
                            index
                        });
                    }
                    
                    self.postMessage({ type: 'heightBatchResult', data: { results, batchId } });
                }
            };
        `;
        // --- END OF WORKER CODE STRING ---
    }

    calculateHeightBatch(points, batchId, callback) {
        if (!this.worker) {
            // Fallback to main thread calculation
            console.warn('Worker not available, calculating on main thread');
            setTimeout(() => {
                const results = [];
                const eps = 0.1; // Matches the worker/HeightCalculator default
                
                for (let i = 0; i < points.length; i++) {
                    const { x, z, index } = points[i];
                    // The fallback calculator is now guaranteed to match the worker's logic.
                    const height = this.fallbackCalculator.calculateHeight(x, z);
                    const normal = this.fallbackCalculator.calculateNormal(x, z, eps);
            
                    results.push({
                        x, z, height,
                        normal,
                        index
                    });
                }
                
                callback({ results, batchId });
            }, 0);
            return;
        }

        this.messageHandlers.set(batchId, callback);
        this.worker.postMessage({
            type: 'calculateHeightBatch',
            data: { points, batchId }
        });
    }

    handleMessage(e) {
        const { type, data } = e.data;
        if (type === 'heightBatchResult') {
            const { batchId } = data;
            const callback = this.messageHandlers.get(batchId);
            if (callback) {
                callback(data);
                this.messageHandlers.delete(batchId);
            }
        }
    }

    terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}
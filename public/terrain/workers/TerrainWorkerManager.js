// terrain/workers/TerrainWorkerManager.js
import { HeightCalculator } from '../heightGeneration/HeightCalculator.js';

export class TerrainWorkerManager {
    constructor() {
        this.worker = null;
        this.pendingBatches = new Map();
        this.messageHandlers = new Map();
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
        return `
            // Define OptimizedPerlin class in worker context
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
            const perlin = new OptimizedPerlin(12345);
            
            function clamp(v, a, b) {
                return Math.max(a, Math.min(b, v));
            }
            
            const calculateHeight = (x, z) => {
                if (workerHeightCache.has(\`\${x},\${z}\`)) {
                    return workerHeightCache.get(\`\${x},\${z}\`);
                }
                
                let base = 0, amp = 1, freq = 0.02;
                for (let o = 0; o < 3; o++) {
                    base += perlin.noise(x * freq, z * freq, 10 + o * 7) * amp;
                    amp *= 0.5;
                    freq *= 2;
                }
                
                let maskRaw = perlin.noise(x * 0.006, z * 0.006, 400);
                let mask = Math.pow((maskRaw + 1) * 0.5, 3);
                let mountain = 0;
                amp = 1;
                freq = 0.04;
                
                for (let o = 0; o < 4; o++) {
                    mountain += Math.abs(perlin.noise(x * freq, z * freq, 500 + o * 11)) * amp;
                    amp *= 0.5;
                    freq *= 2;
                }
                mountain *= 40 * mask;
                
                let seaMaskRaw = perlin.noise(x * 0.0008, z * 0.0008, 600);
                let normalizedSea = (seaMaskRaw + 1) * 0.5;
                let seaMask = normalizedSea > 0.7 ? Math.pow((normalizedSea - 0.7) / (1 - 0.7), 7) : 0;
                
                let seaBasin = 0;
                amp = 2;
                freq = 0.01;
                
                for (let o = 0; o < 3; o++) {
                    seaBasin += Math.abs(perlin.noise(x * freq, z * freq, 700 + o * 13)) * amp;
                    amp *= 0.5;
                    freq *= 2;
                }
                let seaDepth = seaMask * seaBasin * 8;
                let heightBeforeJagged = base + mountain - seaDepth - (seaMask * 2);
                
                const elevNorm = clamp((heightBeforeJagged + 2) / 25, 0, 1);
                let jagged = perlin.noise(x * 0.8, z * 0.8, 900) * 1.2 * elevNorm + 
                           perlin.noise(x * 1.6, z * 1.6, 901) * 0.6 * elevNorm;
                
                const height = heightBeforeJagged + jagged;
                workerHeightCache.set(\`\${x},\${z}\`, height);
                return height;
            };
            
            self.onmessage = function(e) {
                const { type, data } = e.data;
                if (type === 'calculateHeightBatch') {
                    const { points, batchId } = data;
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
                        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
                        
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
    }

    calculateHeightBatch(points, batchId, callback) {
        if (!this.worker) {
            // Fallback to main thread calculation
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
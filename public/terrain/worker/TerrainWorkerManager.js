// terrain/workers/TerrainWorkerManager.js
export class TerrainWorkerManager {
    constructor() {
        this.worker = null;
        this.pendingBatches = new Map();
        this.messageHandlers = new Map();
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
            // Import the height calculation logic into the worker
            ${OptimizedPerlin.toString()}
            
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
                
                const elevNorm = clamp((base + mountain + 2) / 25, 0, 1);
                let jagged = perlin.noise(x * 0.8, z * 0.8, 900) * 1.2 * elevNorm + 
                           perlin.noise(x * 1.6, z * 1.6, 901) * 0.6 * elevNorm;
                
                const height = base + mountain + jagged;
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
            console.warn('Worker not available');
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
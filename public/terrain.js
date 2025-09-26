import * as THREE from 'three';

// --- CONFIG ---
export const CONFIG = Object.freeze({
    TERRAIN: {
        chunkSize: 50,
        segments: 100,
        renderDistance: 2,
        seed: 12345 // Centralized seed
    },
    PERFORMANCE: {
        updateThrottle: 100,
        maxCacheSize: 20000
    },
    GRAPHICS: {
        textureSize: 128,
        textureRepeat: 1
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
            console.log(`Cache cleanup: removed ${entriesToRemove} entries, ${cache.size} remaining`);
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
const FLOAT_PRECISION = 100000.0;
const roundCoord = (coord) => Math.round(coord * FLOAT_PRECISION) / FLOAT_PRECISION;

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
        const rx = roundCoord(x);
        const rz = roundCoord(z);
        
        const key = `${rx},${rz}`;
        if (this.heightCache.has(key)) {
            return this.heightCache.get(key);
        }

        let base = 0;
        let amplitude = 1;
        let frequency = 0.02;
        
        for (let octave = 0; octave < 3; octave++) {
            base += this.perlin.noise(rx * frequency, rz * frequency, 10 + octave * 7) * amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }

        let maskRaw = this.perlin.noise(rx * 0.006, rz * 0.006, 400);
        let mask = Math.pow((maskRaw + 1) * 0.5, 3);

        let mountain = 0;
        amplitude = 1;
        frequency = 0.04;
        
        for (let octave = 0; octave < 4; octave++) {
            mountain += Math.abs(this.perlin.noise(rx * frequency, rz * frequency, 500 + octave * 11)) * amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }
        mountain *= 40 * mask;
        
        let heightBeforeJagged = base + mountain;

        const elevNorm = this.clamp((heightBeforeJagged + 2) / 25, 0, 1);
        let jagged = this.perlin.noise(rx * 0.8, rz * 0.8, 900) * 1.2 * elevNorm + 
                     this.perlin.noise(rx * 1.6, rz * 1.6, 901) * 0.6 * elevNorm;
        
        const height = heightBeforeJagged + jagged;
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
            uniform sampler2D uRock;
            uniform sampler2D uRock1;
            uniform sampler2D uRock2;
            uniform sampler2D uSnow;
            uniform sampler2D uSand;
            uniform float uTextureRepeat;
            
            varying float vHeight;
            varying float vSlope;
            varying vec3 vNormal;
            varying vec2 vUv;
            varying vec3 vWorldPosition;
            
            void main() {
                // Use world position for texture coordinates to eliminate seams
                float repeat = uTextureRepeat;
                vec2 worldUv = vWorldPosition.xz * repeat;
                
                vec3 dirt = texture2D(uDirt, worldUv).rgb;
                vec3 grass = texture2D(uGrass, worldUv).rgb;
                vec3 rock = texture2D(uRock, worldUv).rgb;
                vec3 rock1 = texture2D(uRock1, worldUv).rgb;
                vec3 rock2 = texture2D(uRock2, worldUv).rgb;
                vec3 snow = texture2D(uSnow, worldUv).rgb;
                vec3 sand = texture2D(uSand, worldUv).rgb;
                
                // Smooth blending between textures using smoothstep
                float wSand = smoothstep(-1.0, 0.5, vHeight) * smoothstep(1.5, -0.5, vHeight);
                float wDirt = smoothstep(-25.0, -1.0, vHeight) * smoothstep(2.0, 0.0, vHeight);
                float wGrass = smoothstep(-0.5, 2.0, vHeight) * smoothstep(8.0, 3.0, vHeight);
                float wRock1 = smoothstep(2.0, 3.0, vHeight) * smoothstep(15.0, 8.0, vHeight); 
                float wRock2 = smoothstep(2.0, 5.0, vHeight) * smoothstep(15.0, 8.0, vHeight); 
                float wSnow = smoothstep(8.0, 12.0, vHeight);
                
                float totalWeight = wSand + wDirt + wGrass + wRock1 + wRock2 + wSnow;
                if (totalWeight > 0.0) {
                    wSand /= totalWeight;
                    wDirt /= totalWeight;
                    wGrass /= totalWeight;
                    wRock1 /= totalWeight;
                    wRock2 /= totalWeight;
                    wSnow /= totalWeight;
                } else {
                    wDirt = 1.0; // Fallback to dirt
                }
                
                float slopeFactor = smoothstep(0.05, 0.3, vSlope);
                
                vec3 baseColor = sand * wSand + dirt * wDirt + grass * wGrass + rock1 * wRock1 + rock2 * wRock2 + snow * wSnow;
                baseColor = mix(baseColor, rock, slopeFactor * 0.8); // Reduced rock blending for smoother transitions
                
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
                uRock: { value: textures.rock },
                uRock: { value: textures.rock1 },
                uRock2: { value: textures.rock2 },
                uSnow: { value: textures.snow },
                uSand: { value: textures.sand },
                uLightDir: { value: new THREE.Vector3(1, 1, 1).normalize() },
                uTextureRepeat: { value: CONFIG.GRAPHICS.textureRepeat }
            },
            side: THREE.FrontSide
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
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            return texture;
        };

        const grassTexture = new THREE.TextureLoader().load('./terrain/grass.png', (texture) => {
            console.log('Grass texture loaded successfully');
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
        }, undefined, (err) => {
            console.error('Failed to load grass texture:', err);
        });

        const rockTexture = new THREE.TextureLoader().load('./terrain/rock.png', (texture) => {
            console.log('Rock texture loaded successfully');
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
        }, undefined, (err) => {
            console.error('Failed to load rock texture:', err);
        });

                const rock1Texture = new THREE.TextureLoader().load('./terrain/rock1.png', (texture) => {
            console.log('Rock1 texture loaded successfully');
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
        }, undefined, (err) => {
            console.error('Failed to load rock1 texture:', err);
        });

        return {
            dirt: createTexture({ r: 101, g: 67, b: 33 }, { r: 139, g: 90, b: 43 }),
            grass: grassTexture,
            rock: rockTexture,
            rock1: rock1Texture,
            rock2: createTexture({ r: 120, g: 120, b: 120 }, { r: 150, g: 150, b: 150 }),
            snow: createTexture({ r: 255, g: 250, b: 250 }, { r: 240, g: 248, b: 255 }),
            sand: createTexture({ r: 194, g: 178, b: 128 }, { r: 160, g: 140, b: 100 })
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
        const FLOAT_PRECISION = 100000.0; // Increased precision
        
        return `
            const FLOAT_PRECISION = ${FLOAT_PRECISION};
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
                const rx = roundCoord(x);
                const rz = roundCoord(z);
                const key = \`\${rx},\${rz}\`;
                if (workerHeightCache.has(key)) {
                    return workerHeightCache.get(key);
                }

                let base = 0;
                let amplitude = 1;
                let frequency = 0.02;
                
                for (let octave = 0; octave < 3; octave++) {
                    base += perlin.noise(rx * frequency, rz * frequency, 10 + octave * 7) * amplitude;
                    amplitude *= 0.5;
                    frequency *= 2;
                }

                let maskRaw = perlin.noise(rx * 0.006, rz * 0.006, 400);
                let mask = Math.pow((maskRaw + 1) * 0.5, 3);

                let mountain = 0;
                amplitude = 1;
                frequency = 0.04;
                
                for (let octave = 0; octave < 4; octave++) {
                    mountain += Math.abs(perlin.noise(rx * frequency, rz * frequency, 500 + octave * 11)) * amplitude;
                    amplitude *= 0.5;
                    frequency *= 2;
                }
                mountain *= 40 * mask;
                
                let heightBeforeJagged = base + mountain;

                const elevNorm = clamp((heightBeforeJagged + 2) / 25, 0, 1);
                let jagged = perlin.noise(rx * 0.8, rz * 0.8, 900) * 1.2 * elevNorm + 
                             perlin.noise(rx * 1.6, rz * 1.6, 901) * 0.6 * elevNorm;
                
                const height = heightBeforeJagged + jagged;
                workerHeightCache.set(key, height);
                
                limitCacheSize(workerHeightCache, MAX_CACHE_SIZE);
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
                        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                        const normal = len === 0 ? { x: 0, y: 1, z: 0 } : { x: nx / len, y: ny / len, z: nz / len };
                        
                        results.push({
                            x, z, height: h,
                            normal,
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

        this.messageHandlers.set(batchId, { callback, timestamp: Date.now() });
        this.worker.postMessage({
            type: 'calculateHeightBatch',
            data: { points, batchId }
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
        this.heightCalculator = new HeightCalculator(CONFIG.TERRAIN.seed);
        this.workerManager = new TerrainWorkerManager();
        this.material = null;
        this.textures = null;
        this.waterRenderer = null;
        this.init();
    }

    init() {
        this.textures = TerrainMaterialFactory.createProceduralTextures();
        this.material = TerrainMaterialFactory.createTerrainMaterial(this.textures);
    }

    setWaterRenderer(waterRenderer) {
        this.waterRenderer = waterRenderer;
    }

    createChunk(chunkX, chunkZ) {
        const chunkSize = CONFIG.TERRAIN.chunkSize;
        const segments = CONFIG.TERRAIN.segments;
        
        // Ensure chunk coordinates align to grid
        const alignedChunkX = Math.floor(chunkX / chunkSize) * chunkSize;
        const alignedChunkZ = Math.floor(chunkZ / chunkSize) * chunkSize;
        const key = `${alignedChunkX / chunkSize},${alignedChunkZ / chunkSize}`;

        if (this.chunkMap.has(key)) {
            return;
        }

        const geometry = new THREE.PlaneGeometry(chunkSize, chunkSize, segments, segments);
        geometry.rotateX(-Math.PI / 2);

        const points = [];
        const verticesPerRow = segments + 1;

        // Generate vertices with precise world coordinates
        for (let z = 0; z <= segments; z++) {
            for (let x = 0; x <= segments; x++) {
                const worldX = alignedChunkX + (x / segments - 0.5) * chunkSize;
                const worldZ = alignedChunkZ + (z / segments - 0.5) * chunkSize;
                points.push({ 
                    x: roundCoord(worldX), 
                    z: roundCoord(worldZ), 
                    index: z * verticesPerRow + x 
                });
            }
        }

        const batchId = `${alignedChunkX},${alignedChunkZ}_${Date.now()}`;
        this.workerManager.calculateHeightBatch(points, batchId, ({ results }) => {
            const position = geometry.attributes.position;
            const normal = geometry.attributes.normal;

            results.forEach(({ height, normal: n, index }) => {
                position.array[index * 3 + 1] = height;
                normal.array[index * 3] = n.x;
                normal.array[index * 3 + 1] = n.y;
                normal.array[index * 3 + 2] = n.z;
            });

            position.needsUpdate = true;
            normal.needsUpdate = true;
            geometry.computeBoundingSphere();

            const mesh = new THREE.Mesh(geometry, this.material);
            mesh.position.set(alignedChunkX, 0, alignedChunkZ);
            
            // Ensure chunks are rendered without gaps by adjusting material properties
            mesh.material.side = THREE.FrontSide;
            mesh.frustumCulled = false; // Prevent culling issues at chunk borders
            
            this.scene.add(mesh);

            this.chunkMap.set(key, { 
                mesh, 
                geometry, 
                chunkX: alignedChunkX, 
                chunkZ: alignedChunkZ 
            });
            
            if (this.waterRenderer && typeof this.waterRenderer.addWaterChunk === 'function') {
                this.waterRenderer.addWaterChunk(alignedChunkX, alignedChunkZ);
            }
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
        const chunk = this.chunkMap.get(key);
        if (chunk) {
            this.scene.remove(chunk.mesh);
            chunk.geometry.dispose();
            this.chunkMap.delete(key);
            if (this.waterRenderer && typeof this.waterRenderer.removeWaterChunk === 'function') {
                this.waterRenderer.removeWaterChunk(chunk.chunkX, chunk.chunkZ);
            }
        }
    }

    getTerrainHeightAt(x, z) {
        return this.heightCalculator.calculateHeight(x, z);
    }

    // Method to update terrain LOD and reduce seams
    updateTerrain(playerX, playerZ) {
        const chunkSize = CONFIG.TERRAIN.chunkSize;
        const renderDistance = CONFIG.TERRAIN.renderDistance;
        
        const playerChunkX = Math.floor(playerX / chunkSize) * chunkSize;
        const playerChunkZ = Math.floor(playerZ / chunkSize) * chunkSize;
        
        const chunksToKeep = new Set();
        
        // Generate chunks around player
        for (let dx = -renderDistance; dx <= renderDistance; dx++) {
            for (let dz = -renderDistance; dz <= renderDistance; dz++) {
                const chunkX = playerChunkX + dx * chunkSize;
                const chunkZ = playerChunkZ + dz * chunkSize;
                const key = `${chunkX / chunkSize},${chunkZ / chunkSize}`;
                
                chunksToKeep.add(key);
                
                if (!this.chunkMap.has(key)) {
                    this.createChunk(chunkX, chunkZ);
                }
            }
        }
        
        // Remove distant chunks
        this.chunkMap.forEach((chunk, key) => {
            if (!chunksToKeep.has(key)) {
                this.disposeChunk(key);
            }
        });
        
        // Ensure vertex continuity for visible chunks
        chunksToKeep.forEach(key => {
            const chunk = this.chunkMap.get(key);
            if (chunk) {
                this.ensureVertexContinuity(chunk.chunkX, chunk.chunkZ);
            }
        });
    }

    dispose() {
        this.chunkMap.forEach((chunk, key) => {
            this.scene.remove(chunk.mesh);
            chunk.geometry.dispose();
        });
        this.chunkMap.clear();
        this.material.dispose();
        Object.values(this.textures).forEach(texture => texture.dispose());
        this.workerManager.terminate();
        if (this.waterRenderer && typeof this.waterRenderer.dispose === 'function') {
            this.waterRenderer.dispose();
        }
    }
}
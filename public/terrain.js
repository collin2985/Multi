// terrain.js
import * as THREE from 'three';

const CONFIG = Object.freeze({
    TERRAIN: {
        chunkSize: 50,
        segments: 25
    },
    GRAPHICS: {
        textureRepeat: 0.1, // Adjusted for fine-grained detail.
        textureScale: 50.0
    },
    BIOMES: {
        MOUNTAINS: 0,
        HILLS: 1,
        PLAINS: 2,
        CANYONS: 3
    }
});

class SimpleTerrainRenderer {
    constructor(scene) {
        this.scene = scene;
        this.terrainChunks = new Map();
        this.terrainMaterial = null;
        this.terrainWorker = null;
        this.pendingChunks = new Map();
        this.textures = {};
        this.textureLoader = new THREE.TextureLoader();
        this.loadTextures().then(() => {
            this.initialize();
        });
    }

    async loadTextures() {
        // Paths to your low-res, pixelated textures. Replace with your own.
        const texturePaths = {
            grass1: 'https://cdn.glitch.global/027063d8-500e-43a9-a78b-d7d8e82d46e3/grass1.png?v=1672323891000',
            grass2: 'https://cdn.glitch.global/027063d8-500e-43a9-a78b-d7d8e82d46e3/grass2.png?v=1672323891001',
            grass3: 'https://cdn.glitch.global/027063d8-500e-43a9-a78b-d7d8e82d46e3/grass3.png?v=1672323891002',
            dirt: 'https://cdn.glitch.global/027063d8-500e-43a9-a78b-d7d8e82d46e3/dirt.png?v=1672323891003',
            rock1: 'https://cdn.glitch.global/027063d8-500e-43a9-a78b-d7d8e82d46e3/rock1.png?v=1672323891004',
            rock2: 'https://cdn.glitch.global/027063d8-500e-43a9-a78b-d7d8e82d46e3/rock2.png?v=1672323891005',
            snow: 'https://cdn.glitch.global/027063d8-500e-43a9-a78b-d7d8e82d46e3/snow.png?v=1672323891006'
        };

        const texturePromises = Object.keys(texturePaths).map(key =>
            new Promise(resolve => {
                this.textureLoader.load(texturePaths[key], (texture) => {
                    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
                    texture.magFilter = THREE.NearestFilter;
                    texture.minFilter = THREE.NearestFilter; // 
                    this.textures[key] = texture;
                    resolve();
                });
            })
        );
        await Promise.all(texturePromises);
        console.log('All textures loaded successfully.');
    }

    initialize() {
        this.terrainWorker = this.createTerrainWorker();
        this.terrainMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;
                varying vec3 vWorldPosition;
                attribute vec4 blendWeights; // New attribute for texture blending
                varying vec4 vBlendWeights;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = position;
                    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
                    vBlendWeights = blendWeights;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D uGrass1;
                uniform sampler2D uGrass2;
                uniform sampler2D uGrass3;
                uniform sampler2D uDirt;
                uniform sampler2D uRock1;
                uniform sampler2D uRock2;
                uniform sampler2D uSnow;
                uniform vec3 uLightDir;
                uniform float uTextureScale;

                varying vec3 vNormal;
                varying vec3 vPosition;
                varying vec3 vWorldPosition;
                varying vec4 vBlendWeights;

                // simple hash-based random
                float rand(vec2 co) {
                    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453123);
                }

                // Value-noise like 2D (cheap)
                float noise2d(vec2 st) {
                    vec2 i = floor(st);
                    vec2 f = fract(st);
                    float a = rand(i);
                    float b = rand(i + vec2(1.0, 0.0));
                    float c = rand(i + vec2(0.0, 1.0));
                    float d = rand(i + vec2(1.0, 1.0));
                    vec2 u = f * f * (3.0 - 2.0 * f);
                    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
                }

                void main() {
                    // World-space coordinates for seamless texturing
                    vec2 texCoord = vWorldPosition.xz / uTextureScale;
                    vec2 detailTexCoord = vWorldPosition.xz * 0.1;

                    // Sample the various textures
                    vec3 grass1Color = texture2D(uGrass1, texCoord).rgb;
                    vec3 grass2Color = texture2D(uGrass2, texCoord + vec2(23.0, 15.0)).rgb;
                    vec3 grass3Color = texture2D(uGrass3, texCoord + vec2(7.0, 31.0)).rgb;
                    vec3 dirtColor = texture2D(uDirt, texCoord + vec2(5.0, 10.0)).rgb;
                    vec3 rock1Color = texture2D(uRock1, texCoord).rgb;
                    vec3 rock2Color = texture2D(uRock2, texCoord + vec2(42.0, 51.0)).rgb;
                    vec3 snowColor = texture2D(uSnow, texCoord).rgb;

                    // Per-fragment noise to blend grass textures and add subtle detail
                    float noise = noise2d(vWorldPosition.xz * 0.1);
                    float grassMix = smoothstep(0.4, 0.6, noise);
                    vec3 grassBaseColor = mix(grass1Color, grass2Color, grassMix);
                    float grass3Mix = smoothstep(0.5, 0.8, noise2d(vWorldPosition.xz * 0.2));
                    grassBaseColor = mix(grassBaseColor, grass3Color, grass3Mix);

                    // Blend the main materials based on blendWeights from the worker
                    vec3 finalColor = vec3(0.0);
                    finalColor += grassBaseColor * vBlendWeights.x;
                    finalColor += dirtColor * vBlendWeights.y;
                    finalColor += mix(rock1Color, rock2Color, smoothstep(0.5, 0.8, noise2d(vWorldPosition.xz * 0.05))) * vBlendWeights.z;
                    finalColor += snowColor * vBlendWeights.w;
                    
                    // Lighting
                    float light = max(dot(normalize(vNormal), normalize(uLightDir)), 0.0) * 0.7 + 0.3;
                    float ao = 1.0 - clamp(vNormal.y * 0.5 + (1.0 - smoothstep(-1.0, 1.0, vWorldPosition.y)) * 0.15, 0.0, 0.6);
                    float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(-vWorldPosition)), 0.0), 3.0) * 0.08;

                    gl_FragColor = vec4(finalColor * light * ao + fresnel, 1.0);
                }
            `,
            uniforms: {
                uGrass1: { value: this.textures.grass1 },
                uGrass2: { value: this.textures.grass2 },
                uGrass3: { value: this.textures.grass3 },
                uDirt: { value: this.textures.dirt },
                uRock1: { value: this.textures.rock1 },
                uRock2: { value: this.textures.rock2 },
                uSnow: { value: this.textures.snow },
                uLightDir: { value: new THREE.Vector3(1, 1, 1).normalize() },
                uTextureScale: { value: CONFIG.GRAPHICS.textureScale }
            },
            side: THREE.FrontSide
        });
    }

    createTerrainWorker() {
        // Worker code remains the same, but the onmessage handler will be updated
        // to calculate biome blend weights instead of a single biomeType.
        const workerCode = `
            const BIOMES = {
                MOUNTAINS: 0,
                HILLS: 1,
                PLAINS: 2,
                CANYONS: 3
            };

            const BIOME_PARAMS = {
                [BIOMES.MOUNTAINS]: {
                    amplitude: 18,
                    frequency: 0.02,
                    octaves: 4,
                    persistence: 0.6,
                    lacunarity: 2.1,
                    baseHeight: 2
                },
                [BIOMES.HILLS]: {
                    amplitude: 7,
                    frequency: 0.025,
                    octaves: 3,
                    persistence: 0.5,
                    lacunarity: 2.0,
                    baseHeight: 0
                },
                [BIOMES.PLAINS]: {
                    amplitude: 2,
                    frequency: 0.03,
                    octaves: 2,
                    persistence: 0.4,
                    lacunarity: 2.0,
                    baseHeight: -1
                },
                [BIOMES.CANYONS]: {
                    amplitude: 12,
                    frequency: 0.015,
                    octaves: 4,
                    persistence: 0.7,
                    lacunarity: 2.5,
                    baseHeight: -8
                }
            };
            
            const permutation = [151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180];
            const perm = new Uint8Array(512);
            for (let i = 0; i < 256; i++) {
                perm[i] = perm[i + 256] = permutation[i];
            }

            function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
            function lerp(t, a, b) { return a + t * (b - a); }
            function grad(hash, x, y, z) {
                const h = hash & 15;
                const u = h < 8 ? x : y;
                const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
                return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
            }
            function perlin(x, y, z) {
                const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
                x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
                const u = fade(x), v = fade(y), w = fade(z);
                const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z,
                        B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
                return lerp(w, lerp(v, lerp(u, grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z)),
                                         lerp(u, grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z))),
                                 lerp(v, lerp(u, grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1)),
                                         lerp(u, grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1))));
            }

            function fbm2(x, z, octaves, persistence, lacunarity, baseFreq, offset) {
                let amp = 1.0;
                let freq = baseFreq;
                let sum = 0.0;
                let norm = 0.0;
                for (let i = 0; i < octaves; i++) {
                    sum += perlin(x * freq + offset, 0, z * freq + offset) * amp;
                    norm += amp;
                    amp *= persistence;
                    freq *= lacunarity;
                }
                return sum / Math.max(0.0001, norm);
            }
            
            function noiseToBiomeIndex(n) {
                if (n < -0.4) return BIOMES.CANYONS;
                if (n < 0.0) return BIOMES.PLAINS;
                if (n < 0.45) return BIOMES.HILLS;
                return BIOMES.MOUNTAINS;
            }

            function sampleBiomePoint(x, z, seed) {
                const offset = seed * 0.001;
                const n = fbm2(x, z, 3, 0.55, 2.0, 0.008, offset);
                return n;
            }

            function sampleAndBlendBiomeParams(worldX, worldZ, seed, chunkSize) {
                const chunkGridX = Math.floor(worldX / chunkSize) * chunkSize;
                const chunkGridZ = Math.floor(worldZ / chunkSize) * chunkSize;
                const half = chunkSize / 2;

                const corners = [
                    [chunkGridX - half, chunkGridZ - half],
                    [chunkGridX + half, chunkGridZ - half],
                    [chunkGridX - half, chunkGridZ + half],
                    [chunkGridX + half, chunkGridZ + half]
                ];
                const center = [chunkGridX, chunkGridZ];

                const localU = (worldX - (chunkGridX - half)) / chunkSize;
                const localV = (worldZ - (chunkGridZ - half)) / chunkSize;
                const u = Math.max(0, Math.min(1, localU));
                const v = Math.max(0, Math.min(1, localV));

                const w00 = (1 - u) * (1 - v);
                const w10 = u * (1 - v);
                const w01 = (1 - u) * v;
                const w11 = u * v;

                const dx = u - 0.5;
                const dy = v - 0.5;
                const dist = Math.sqrt(dx * dx + dy * dy) / Math.sqrt(0.5 * 0.5 + 0.5 * 0.5);
                let centerWeight = 1.0 - Math.min(1.0, dist);
                centerWeight = centerWeight * centerWeight * (3 - 2 * centerWeight);

                const rawWeights = [w00, w10, w01, w11, centerWeight * 0.75];

                const samplePoints = [
                    corners[0], corners[1], corners[2], corners[3], center
                ];

                let accum = {
                    amplitude: 0, frequency: 0, octaves: 0,
                    persistence: 0, lacunarity: 0, baseHeight: 0
                };
                const biomeWeightTotals = { 0: 0, 1: 0, 2: 0, 3: 0 };
                let totalWeight = 0;

                for (let i = 0; i < samplePoints.length; i++) {
                    const sp = samplePoints[i];
                    const w = rawWeights[i];
                    if (w <= 0) continue;
                    const n = sampleBiomePoint(sp[0], sp[1], seed);
                    const biomeIndex = noiseToBiomeIndex(n);
                    const params = BIOME_PARAMS[biomeIndex];

                    accum.amplitude += params.amplitude * w;
                    accum.frequency += params.frequency * w;
                    accum.octaves += params.octaves * w;
                    accum.persistence += params.persistence * w;
                    accum.lacunarity += params.lacunarity * w;
                    accum.baseHeight += params.baseHeight * w;

                    biomeWeightTotals[biomeIndex] += w;
                    totalWeight += w;
                }

                if (totalWeight <= 0) totalWeight = 1.0;

                for (let k in accum) accum[k] /= totalWeight;

                let dominantBiome = 0;
                let maxW = -1;
                for (let b in biomeWeightTotals) {
                    if (biomeWeightTotals[b] > maxW) {
                        maxW = biomeWeightTotals[b];
                        dominantBiome = parseInt(b);
                    }
                }

                return { params: accum, dominantBiome };
            }

            function calculateHeightWithParams(x, z, seed, params) {
                const offset = seed * 0.001;
                let height = params.baseHeight;
                const fullOctaves = Math.floor(params.octaves);
                const frac = params.octaves - fullOctaves;
                let amplitude = params.amplitude;
                let frequency = params.frequency;

                for (let i = 0; i < fullOctaves; i++) {
                    height += perlin(x * frequency + offset, 0, z * frequency + offset) * amplitude;
                    amplitude *= params.persistence;
                    frequency *= params.lacunarity;
                }

                if (frac > 0) {
                    height += perlin(x * frequency + offset, 0, z * frequency + offset) * amplitude * frac;
                }

                return height;
            }

            function calculateNormal(x, z, seed, params) {
                const eps = 0.02;
                const heightL = calculateHeightWithParams(x - eps, z, seed, params);
                const heightR = calculateHeightWithParams(x + eps, z, seed, params);
                const heightD = calculateHeightWithParams(x, z - eps, seed, params);
                const heightU = calculateHeightWithParams(x, z + eps, seed, params);

                const nx = heightL - heightR;
                const nz = heightD - heightU;
                const ny = 2.0;
                const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
                return [nx/len, ny/len, nz/len];
            }

            // New function to calculate blend weights for the textures
            function calculateBlendWeights(height, slope, biome) {
                let grassWeight = 0.0;
                let rockWeight = 0.0;
                let snowWeight = 0.0;
                let dirtWeight = 0.0;

                // Base height- and slope-based blending
                const slopeFactor = Math.min(1.0, slope * 2.0); // Rocks on steep slopes
                const heightFactor = Math.max(0.0, height / 15.0); // For elevation

                // Grass and dirt
                grassWeight = (1.0 - slopeFactor) * (1.0 - heightFactor);
                dirtWeight = slopeFactor * 0.2 + (1.0 - heightFactor) * 0.3;

                // Rock on steep slopes
                rockWeight = slopeFactor * 0.8 + heightFactor * 0.5;

                // Snow at high elevations
                snowWeight = Math.max(0.0, heightFactor - 0.7);

                // Refine based on biome for variety
                if (biome === BIOMES.MOUNTAINS) {
                    rockWeight += 0.5;
                    snowWeight = Math.max(snowWeight, heightFactor * 1.5 - 1.0);
                    grassWeight *= 0.5;
                } else if (biome === BIOMES.HILLS) {
                    grassWeight += 0.3;
                    rockWeight *= 0.5;
                } else if (biome === BIOMES.PLAINS) {
                    grassWeight += 1.0;
                    rockWeight *= 0.1;
                } else if (biome === BIOMES.CANYONS) {
                    dirtWeight += 0.5;
                    rockWeight += 0.5;
                    grassWeight *= 0.2;
                }
                
                // Normalize weights
                const total = grassWeight + dirtWeight + rockWeight + snowWeight;
                if (total > 0.0) {
                    return [
                        grassWeight / total,
                        dirtWeight / total,
                        rockWeight / total,
                        snowWeight / total
                    ];
                }
                return [1.0, 0.0, 0.0, 0.0]; // Default to grass if no valid weights
            }

            self.onmessage = function(e) {
                if (e.data.type === 'calculateHeightBatch') {
                    const { points, batchId, seed, chunkSize } = e.data.data;
                    const results = [];
                    for(const point of points) {
                        const worldX = point.x;
                        const worldZ = point.z;

                        const blend = sampleAndBlendBiomeParams(worldX, worldZ, seed, chunkSize);
                        const params = blend.params;
                        const dominant = blend.dominantBiome;

                        const height = calculateHeightWithParams(worldX, worldZ, seed, params);
                        const normal = calculateNormal(worldX, worldZ, seed, params);
                        
                        const slope = 1.0 - normal[1];
                        const blendWeights = calculateBlendWeights(height, slope, dominant);

                        results.push({
                            x: worldX,
                            z: worldZ,
                            height,
                            normalX: normal[0],
                            normalY: normal[1],
                            normalZ: normal[2],
                            biomeType: dominant,
                            blendWeights: blendWeights, // New output for texture blending
                            index: point.index
                        });
                    }
                    self.postMessage({ type: 'heightBatchResult', data: { results, batchId } });
                }
            };
        `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));
        worker.onmessage = this.handleWorkerMessage.bind(this);
        return worker;
    }

    handleWorkerMessage(e) {
        const { type, data } = e.data;
        if (type === 'heightBatchResult') {
            const { results, batchId } = data;
            const pending = this.pendingChunks.get(batchId);
            if (!pending) return;

            const { geometry, chunkX, chunkZ } = pending;
            const positions = geometry.attributes.position.array;
            const normals = geometry.attributes.normal.array;
            const biomeTypes = geometry.attributes.biomeType.array;
            const blendWeights = geometry.attributes.blendWeights.array;

            for (let i = 0; i < results.length; i++) {
                const { height, normalX, normalY, normalZ, biomeType, blendWeights: weights, index } = results[i];
                const vertexIndex = index / 3;

                positions[index + 1] = height;
                normals[index]      = normalX;
                normals[index + 1] = normalY;
                normals[index + 2] = normalZ;
                biomeTypes[vertexIndex] = biomeType;

                // Set the new blend weights attribute
                blendWeights[vertexIndex * 4] = weights[0];
                blendWeights[vertexIndex * 4 + 1] = weights[1];
                blendWeights[vertexIndex * 4 + 2] = weights[2];
                blendWeights[vertexIndex * 4 + 3] = weights[3];
            }

            geometry.attributes.position.needsUpdate = true;
            geometry.attributes.normal.needsUpdate = true;
            geometry.attributes.biomeType.needsUpdate = true;
            geometry.attributes.blendWeights.needsUpdate = true;
            this.finishTerrainChunk(geometry, chunkX, chunkZ);
            this.pendingChunks.delete(batchId);
        }
    }

    addTerrainChunk({ chunkX = 0, chunkZ = 0, seed = 0 }) {
        const chunkIndexX = Math.floor(chunkX / CONFIG.TERRAIN.chunkSize);
        const chunkIndexZ = Math.floor(chunkZ / CONFIG.TERRAIN.chunkSize);
        const key = `${chunkIndexX},${chunkIndexZ}`;

        if (this.terrainChunks.has(key)) {
            return;
        }

        console.log(`Creating terrain chunk at (${chunkX}, ${chunkZ}) with seed ${seed}`);

        const geometry = new THREE.PlaneGeometry(
            CONFIG.TERRAIN.chunkSize,
            CONFIG.TERRAIN.chunkSize,
            CONFIG.TERRAIN.segments,
            CONFIG.TERRAIN.segments
        );

        geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3));
        geometry.setAttribute('biomeType', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count), 1));
        geometry.setAttribute('blendWeights', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 4), 4));

        const positions = geometry.attributes.position.array;
        const pointsToCalculate = [];

        const segmentSize = CONFIG.TERRAIN.chunkSize / CONFIG.TERRAIN.segments;
        const halfSize = CONFIG.TERRAIN.chunkSize / 2;

        for (let row = 0; row <= CONFIG.TERRAIN.segments; row++) {
            for (let col = 0; col <= CONFIG.TERRAIN.segments; col++) {
                const vertexIndex = (row * (CONFIG.TERRAIN.segments + 1) + col) * 3;

                const localX = -halfSize + col * segmentSize;
                const localZ = -halfSize + row * segmentSize;

                const worldX = chunkX + localX;
                const worldZ = chunkZ + localZ;

                positions[vertexIndex] = localX;
                positions[vertexIndex + 1] = 0;
                positions[vertexIndex + 2] = localZ;

                pointsToCalculate.push({
                    x: worldX,
                    z: worldZ,
                    index: vertexIndex
                });
            }
        }

        if (pointsToCalculate.length > 0) {
            const batchId = key;
            this.pendingChunks.set(batchId, { geometry, chunkX, chunkZ });
            this.terrainWorker.postMessage({
                type: 'calculateHeightBatch',
                data: { points: pointsToCalculate, batchId, seed, chunkSize: CONFIG.TERRAIN.chunkSize }
            });
        }
    }

    finishTerrainChunk(geometry, chunkX, chunkZ) {
        const chunkIndexX = Math.floor(chunkX / CONFIG.TERRAIN.chunkSize);
        const chunkIndexZ = Math.floor(chunkZ / CONFIG.TERRAIN.chunkSize);
        const key = `${chunkIndexX},${chunkIndexZ}`;

        const mesh = new THREE.Mesh(geometry, this.terrainMaterial);
        mesh.position.set(chunkX, 0, chunkZ);
        this.scene.add(mesh);
        this.terrainChunks.set(key, mesh);
        console.log(`Added terrain chunk at (${chunkX}, ${chunkZ})`);
    }

    removeTerrainChunk({ chunkX, chunkZ }) {
        const chunkIndexX = Math.floor(chunkX / CONFIG.TERRAIN.chunkSize);
        const chunkIndexZ = Math.floor(chunkZ / CONFIG.TERRAIN.chunkSize);
        const key = `${chunkIndexX},${chunkIndexZ}`;
        const mesh = this.terrainChunks.get(key);
        if (mesh) {
            this.scene.remove(mesh);
            this.terrainChunks.delete(key);
            mesh.geometry.dispose();
            console.log(`Removed chunk at (${chunkIndexX}, ${chunkIndexZ})`);
        }
    }

    clearChunks() {
        this.terrainChunks.forEach((mesh) => {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
        });
        this.terrainChunks.clear();
        if (this.terrainMaterial) {
            this.terrainMaterial.dispose();
        }
        if (this.terrainWorker) {
            this.terrainWorker.terminate();
        }
    }
}

export { SimpleTerrainRenderer };
// terrain.js
// Procedural terrain renderer using Three.js with biome-based height generation
// and height/slope-based texture blending. Textures (dirt, three grass types, rock, snow)
// are procedurally generated and blended using vertex height and slope in the shader.
// Height generation uses a web worker with Perlin noise and biome blending, unchanged
// from the original implementation. The texture system is adapted from a source game,
// with three grass types for variety, adjusted dirt prevalence, and enhanced rock
// visibility on steep slopes and mountain tops.

import * as THREE from 'three';

const CONFIG = Object.freeze({
    TERRAIN: {
        chunkSize: 50,
        segments: 25
    },
    GRAPHICS: {
        textureSize: 48 // Doubled from 24 to reduce pixel size
    }
});

class SimpleTerrainRenderer {
    constructor(scene, renderer = null) {
        this.scene = scene;
        this.renderer = renderer;
        this.terrainChunks = new Map();
        this.terrainMaterial = null;
        this.terrainWorker = null;
        this.pendingChunks = new Map();
        this.textures = this.initializeTextures();
        this.initialize();
    }

    // Initialize procedural textures for dirt, three grass types, rock, and snow
    initializeTextures() {
        const size = CONFIG.GRAPHICS.textureSize;
        const maxAniso = this.renderer ? this.renderer.capabilities.getMaxAnisotropy() : 1;
        const textures = {};

        textures.dirt = this.createProceduralTexture(
            { r: 101, g: 67, b: 33 }, 
            { r: 139, g: 90, b: 43 }, 
            size, 
            maxAniso
        );
        textures.grass1 = this.createProceduralTexture(
            { r: 34, g: 139, b: 34 }, // Vibrant green
            { r: 0, g: 100, b: 0 }, 
            size, 
            maxAniso
        );
        textures.grass2 = this.createProceduralTexture(
            { r: 50, g: 120, b: 20 }, // Darker green
            { r: 20, g: 80, b: 10 }, 
            size, 
            maxAniso
        );
        textures.grass3 = this.createProceduralTexture(
            { r: 60, g: 150, b: 40 }, // Lighter, yellowish green
            { r: 30, g: 110, b: 20 }, 
            size, 
            maxAniso
        );
        textures.rock = this.createProceduralTexture(
            { r: 105, g: 105, b: 105 }, 
            { r: 128, g: 128, b: 128 }, 
            size, 
            maxAniso
        );
        textures.snow = this.createProceduralTexture(
            { r: 255, g: 250, b: 250 }, 
            { r: 240, g: 248, b: 255 }, 
            size, 
            maxAniso
        );

        return textures;
    }

    // Create a procedural texture with two colors and noise
    createProceduralTexture(color1, color2, size, maxAniso) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(size, size);
        const data = imgData.data;

        for (let i = 0; i < data.length; i += 4) {
            const noise = Math.random();
            const c = noise > 0.5 ? color1 : color2;
            data[i] = c.r; 
            data[i + 1] = c.g; 
            data[i + 2] = c.b; 
            data[i + 3] = 255;
        }
        ctx.putImageData(imgData, 0, 0);
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.minFilter = THREE.NearestFilter;
        tex.magFilter = THREE.NearestFilter;
        tex.anisotropy = maxAniso;
        return tex;
    }

    // Initialize the terrain material and worker
    initialize() {
        this.terrainWorker = this.createTerrainWorker();
        this.terrainMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying float vHeight;
                varying float vSlope;
                varying vec3 vNormal;
                varying vec2 vUv;
                varying vec3 vWorldPosition;
                void main(){
                    vUv = uv;
                    vHeight = position.y;
                    vNormal = normalize(normalMatrix * normal);
                    vSlope = 1.0 - dot(normal, vec3(0,1,0));
                    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uLightDir;
                uniform sampler2D uDirt;
                uniform sampler2D uGrass1;
                uniform sampler2D uGrass2;
                uniform sampler2D uGrass3;
                uniform sampler2D uRock;
                uniform sampler2D uSnow;
                varying float vHeight;
                varying float vSlope;
                varying vec3 vNormal;
                varying vec2 vUv;
                varying vec3 vWorldPosition;

                // Simple 2D noise for grass blending
                float rand(vec2 co) {
                    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
                }

                void main(){
                    float repeat = 5.3;
                    vec3 dirt = texture2D(uDirt, vUv * repeat).rgb;
                    vec3 grass1 = texture2D(uGrass1, vUv * repeat).rgb;
                    vec3 grass2 = texture2D(uGrass2, vUv * repeat).rgb;
                    vec3 grass3 = texture2D(uGrass3, vUv * repeat).rgb;
                    vec3 rock = texture2D(uRock, vUv * repeat).rgb;
                    vec3 snow = texture2D(uSnow, vUv * repeat).rgb;

                    // Blend grass types based on noise
                    float noise = rand(vUv * 10.0);
                    float wGrass1 = clamp(noise, 0.0, 0.5);
                    float wGrass2 = clamp(noise - 0.3, 0.0, 0.5);
                    float wGrass3 = clamp(1.0 - noise, 0.0, 0.5);
                    float grassTotal = wGrass1 + wGrass2 + wGrass3;
                    if (grassTotal > 0.0) {
                        wGrass1 /= grassTotal;
                        wGrass2 /= grassTotal;
                        wGrass3 /= grassTotal;
                    }
                    vec3 grass = grass1 * wGrass1 + grass2 * wGrass2 + grass3 * wGrass3;

                    // Adjusted texture weights
                    float wDirt = 1.0 - smoothstep(-4.0, 0.0, vHeight); // Tighter range to reduce dirt
                    float wGrass = smoothstep(-4.0, 0.0, vHeight) * (1.0 - smoothstep(1.0, 7.5, vHeight));
                    float wSnow = smoothstep(1.0, 7.5, vHeight);
                    float slopeFactor = smoothstep(0.03, 0.15, vSlope); // Loosened range for more rock
                    float heightBoost = smoothstep(5.0, 10.0, vHeight); // Boost rock on mountain tops
                    slopeFactor = mix(slopeFactor, 1.0, heightBoost * 0.5);

                    vec3 baseColor = dirt * wDirt + grass * wGrass + snow * wSnow;
                    baseColor = mix(baseColor, rock, slopeFactor);

                    // Original lighting model with AO and fresnel
                    float light = max(dot(normalize(vNormal), normalize(uLightDir)), 0.0) * 0.7 + 0.3;
                    float ao = 1.0 - clamp(vNormal.y * 0.5 + (1.0 - smoothstep(-1.0, 1.0, vWorldPosition.y)) * 0.15, 0.0, 0.6);
                    float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(-vWorldPosition)), 0.0), 3.0) * 0.08;
                    gl_FragColor = vec4(baseColor * light * ao + fresnel, 1.0);
                }
            `,
            uniforms: {
                uDirt: { value: this.textures.dirt },
                uGrass1: { value: this.textures.grass1 },
                uGrass2: { value: this.textures.grass2 },
                uGrass3: { value: this.textures.grass3 },
                uRock: { value: this.textures.rock },
                uSnow: { value: this.textures.snow },
                uLightDir: { value: new THREE.Vector3(1, 1, 1).normalize() }
            },
            side: THREE.FrontSide
        });
    }

    // Create a web worker for biome-based height and normal calculations
    createTerrainWorker() {
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

                    totalWeight += w;
                }

                if (totalWeight <= 0) totalWeight = 1.0;

                for (let k in accum) accum[k] /= totalWeight;

                return accum;
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

            self.onmessage = function(e) {
                if (e.data.type === 'calculateHeightBatch') {
                    const { points, batchId, seed, chunkSize } = e.data.data;
                    const results = [];
                    for(const point of points) {
                        const worldX = point.x;
                        const worldZ = point.z;

                        const params = sampleAndBlendBiomeParams(worldX, worldZ, seed, chunkSize);
                        const height = calculateHeightWithParams(worldX, worldZ, seed, params);
                        const normal = calculateNormal(worldX, worldZ, seed, params);

                        results.push({
                            x: worldX,
                            z: worldZ,
                            height,
                            normalX: normal[0],
                            normalY: normal[1],
                            normalZ: normal[2],
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

    // Process worker results to update geometry
    handleWorkerMessage(e) {
        const { type, data } = e.data;
        if (type === 'heightBatchResult') {
            const { results, batchId } = data;
            const pending = this.pendingChunks.get(batchId);
            if (!pending) return;

            const { geometry, chunkX, chunkZ } = pending;
            const positions = geometry.attributes.position.array;
            const normals = geometry.attributes.normal.array;

            for (let i = 0; i < results.length; i++) {
                const { height, normalX, normalY, normalZ, index } = results[i];
                positions[index + 1] = height;
                normals[index] = normalX;
                normals[index + 1] = normalY;
                normals[index + 2] = normalZ;
            }

            geometry.attributes.position.needsUpdate = true;
            geometry.attributes.normal.needsUpdate = true;
            this.finishTerrainChunk(geometry, chunkX, chunkZ);
            this.pendingChunks.delete(batchId);
        }
    }

    // Create a new terrain chunk and request height data
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

    // Finalize and add a terrain chunk to the scene
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

    // Remove a terrain chunk from the scene
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

    // Clear all terrain chunks and resources
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
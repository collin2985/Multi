import * as THREE from 'three';

const CONFIG = Object.freeze({
    TERRAIN: {
        chunkSize: 50,
        segments: 25,
        overlap: 3
    },
    GRAPHICS: {
        textureSize: 48
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
            { r: 34, g: 139, b: 34 },
            { r: 0, g: 100, b: 0 }, 
            size, 
            maxAniso
        );
        textures.grass2 = this.createProceduralTexture(
            { r: 50, g: 120, b: 20 },
            { r: 20, g: 80, b: 10 }, 
            size, 
            maxAniso
        );
        textures.grass3 = this.createProceduralTexture(
            { r: 60, g: 150, b: 40 },
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

    initialize() {
        this.terrainWorker = this.createTerrainWorker();
        this.terrainMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                attribute float biomeIndex;
                varying float vHeight;
                varying float vSlope;
                varying vec3 vNormal;
                varying vec2 vUv;
                varying vec3 vWorldPosition;
                varying float vBiomeIndex;
                void main() {
                    vUv = uv;
                    vHeight = position.y;
                    vNormal = normalize(normalMatrix * normal);
                    vSlope = 1.0 - dot(normal, vec3(0,1,0));
                    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
                    vBiomeIndex = biomeIndex;
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
                uniform bool uDebugBiomes;
                varying float vHeight;
                varying float vSlope;
                varying vec3 vNormal;
                varying vec2 vUv;
                varying vec3 vWorldPosition;
                varying float vBiomeIndex;

                float rand(vec2 co) {
                    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
                }

                void main() {
                    if (uDebugBiomes) {
                        vec3 debugColor = vec3(0.0);
                        if (vBiomeIndex < 0.5) debugColor = vec3(1.0, 0.0, 0.0); // Canyons
                        else if (vBiomeIndex < 1.5) debugColor = vec3(0.0, 1.0, 0.0); // Plains
                        else if (vBiomeIndex < 2.5) debugColor = vec3(0.0, 0.0, 1.0); // Hills
                        else debugColor = vec3(1.0, 1.0, 1.0); // Mountains
                        gl_FragColor = vec4(debugColor, 1.0);
                        return;
                    }

                    float repeat = 5.3;
                    vec3 dirt = texture2D(uDirt, vUv * repeat).rgb;
                    vec3 grass1 = texture2D(uGrass1, vUv * repeat).rgb;
                    vec3 grass2 = texture2D(uGrass2, vUv * repeat).rgb;
                    vec3 grass3 = texture2D(uGrass3, vUv * repeat).rgb;
                    vec3 rock = texture2D(uRock, vUv * repeat).rgb;
                    vec3 snow = texture2D(uSnow, vUv * repeat).rgb;

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

                    float wDirt = 1.0 - smoothstep(-4.0, 0.0, vHeight);
                    float wGrass = smoothstep(-4.0, 0.0, vHeight) * (1.0 - smoothstep(1.0, 7.5, vHeight));
                    float wSnow = smoothstep(1.0, 7.5, vHeight);
                    float wRock = 0.0;
                    float slopeNoise = rand(vUv * 5.0) * 0.2 + 0.8;
                    float slopeFactor = smoothstep(0.05, 0.25, vSlope) * slopeNoise;
                    float heightBoost = smoothstep(5.0, 10.0, vHeight);
                    slopeFactor = mix(slopeFactor, 1.0, heightBoost * 0.5);

                    if (vBiomeIndex < 0.5) { // Canyons
                        wDirt *= 1.2;
                        wGrass *= 0.5;
                        wSnow *= 0.1;
                    } else if (vBiomeIndex < 1.5) { // Plains
                        wGrass *= 1.2;
                        wDirt *= 0.8;
                    } else if (vBiomeIndex < 2.5) { // Hills
                        wGrass *= 1.1;
                        wRock *= 1.1;
                    } else { // Mountains
                        wSnow *= 1.2;
                        wRock *= 1.3;
                    }

                    float total = wDirt + wGrass + wSnow + wRock;
                    if (total > 0.0) {
                        wDirt /= total;
                        wGrass /= total;
                        wSnow /= total;
                        wRock /= total;
                    }

                    vec3 baseColor = dirt * wDirt + grass * wGrass + snow * wSnow;
                    baseColor = mix(baseColor, rock, slopeFactor);

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
                uLightDir: { value: new THREE.Vector3(1, 1, 1).normalize() },
                uDebugBiomes: { value: false }
            },
            side: THREE.FrontSide
        });
    }

    setDebugBiomes(enabled) {
        this.terrainMaterial.uniforms.uDebugBiomes.value = enabled;
    }

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
                const perturb = fbm2(x, z, 2, 0.5, 2.0, 0.002, offset + 1000) * 0.2;
                return n + perturb;
            }

            function sampleAndBlendBiomeParams(worldX, worldZ, seed) {
                const n = sampleBiomePoint(worldX, worldZ, seed);
                const biomeIndex = noiseToBiomeIndex(n);
                let params = { ...BIOME_PARAMS[biomeIndex] };

                const thresholds = [-0.4, 0.0, 0.45, 1.0];
                const blendRange = 0.1;
                for (let i = 0; i < thresholds.length - 1; i++) {
                    if (n >= thresholds[i] - blendRange && n <= thresholds[i] + blendRange) {
                        const nextBiome = noiseToBiomeIndex(thresholds[i] + blendRange);
                        const t = smoothstep(thresholds[i] - blendRange, thresholds[i] + blendRange, n);
                        const paramsA = BIOME_PARAMS[biomeIndex];
                        const paramsB = BIOME_PARAMS[nextBiome];
                        params = {
                            amplitude: lerp(t, paramsA.amplitude, paramsB.amplitude),
                            frequency: lerp(t, paramsA.frequency, paramsB.frequency),
                            octaves: lerp(t, paramsA.octaves, paramsB.octaves),
                            persistence: lerp(t, paramsA.persistence, paramsB.persistence),
                            lacunarity: lerp(t, paramsA.lacunarity, paramsB.lacunarity),
                            baseHeight: lerp(t, paramsA.baseHeight, paramsB.baseHeight)
                        };
                        break;
                    }
                }
                return { params, biomeIndex };
            }

            function smoothstep(edge0, edge1, x) {
                const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
                return t * t * (3 - 2 * t);
            }

            function lerp(t, a, b) { return a + t * (b - a); }

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
                const eps = 0.05;
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

            function interpolateHeight(neighborHeight, worldX, worldZ, seed, t) {
                if (neighborHeight === null || t >= 1.0) {
                    const { params } = sampleAndBlendBiomeParams(worldX, worldZ, seed);
                    return calculateHeightWithParams(worldX, worldZ, seed, params);
                }
                const { params } = sampleAndBlendBiomeParams(worldX, worldZ, seed);
                const computedHeight = calculateHeightWithParams(worldX, worldZ, seed, params);
                return lerp(t, neighborHeight, computedHeight);
            }

            self.onmessage = function(e) {
                if (e.data.type === 'calculateHeightBatch') {
                    const { points, batchId, seed, chunkSize, neighborData } = e.data.data;
                    const results = [];
                    for (const point of points) {
                        const worldX = point.x;
                        const worldZ = point.z;
                        const { params, biomeIndex } = sampleAndBlendBiomeParams(worldX, worldZ, seed);
                        let height = null;
                        let t = point.t || 1.0;
                        if (point.neighbor && point.neighbor.height !== null) {
                            height = interpolateHeight(point.neighbor.height, worldX, worldZ, seed, t);
                        } else {
                            height = calculateHeightWithParams(worldX, worldZ, seed, params);
                        }
                        const normal = calculateNormal(worldX, worldZ, seed, params);

                        results.push({
                            x: worldX,
                            z: worldZ,
                            height,
                            normalX: normal[0],
                            normalY: normal[1],
                            normalZ: normal[2],
                            biomeIndex,
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
            const biomeIndices = geometry.attributes.biomeIndex.array;

            for (let i = 0; i < results.length; i++) {
                const { height, normalX, normalY, normalZ, biomeIndex, index } = results[i];
                positions[index + 1] = height;
                normals[index] = normalX;
                normals[index + 1] = normalY;
                normals[index + 2] = normalZ;
                biomeIndices[index / 3] = biomeIndex;
            }

            geometry.attributes.position.needsUpdate = true;
            geometry.attributes.normal.needsUpdate = true;
            geometry.attributes.biomeIndex.needsUpdate = true;
            this.finishTerrainChunk(geometry, chunkX, chunkZ);
            this.pendingChunks.delete(batchId);
        }
    }

    addTerrainChunk({ chunkX = 0, chunkZ = 0, seed = 0 }) {
        const chunkIndexX = Math.floor(chunkX / CONFIG.TERRAIN.chunkSize);
        const chunkIndexZ = Math.floor(chunkZ / CONFIG.TERRAIN.chunkSize);
        const key = `${chunkIndexX},${chunkIndexZ}`;
        if (this.terrainChunks.has(key)) return;

        console.log(`Creating terrain chunk at (${chunkX}, ${chunkZ}) with seed ${seed}`);

        const overlap = CONFIG.TERRAIN.overlap;
        const geometry = new THREE.PlaneGeometry(
            CONFIG.TERRAIN.chunkSize + overlap * 2,
            CONFIG.TERRAIN.chunkSize + overlap * 2,
            CONFIG.TERRAIN.segments + overlap * 2,
            CONFIG.TERRAIN.segments + overlap * 2
        );

        geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3));
        geometry.setAttribute('biomeIndex', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count), 1));

        const positions = geometry.attributes.position.array;
        const biomeIndices = geometry.attributes.biomeIndex.array;
        const pointsToCalculate = [];
        const segmentSize = CONFIG.TERRAIN.chunkSize / CONFIG.TERRAIN.segments;
        const halfSize = CONFIG.TERRAIN.chunkSize / 2;

        const neighbors = [
            this.terrainChunks.get(`${chunkIndexX-1},${chunkIndexZ}`), // Left
            this.terrainChunks.get(`${chunkIndexX+1},${chunkIndexZ}`), // Right
            this.terrainChunks.get(`${chunkIndexX},${chunkIndexZ-1}`), // Down
            this.terrainChunks.get(`${chunkIndexX},${chunkIndexZ+1}`)  // Up
        ];

        for (let row = -overlap; row <= CONFIG.TERRAIN.segments + overlap; row++) {
            for (let col = -overlap; col <= CONFIG.TERRAIN.segments + overlap; col++) {
                const vertexIndex = ((row + overlap) * (CONFIG.TERRAIN.segments + 1 + overlap * 2) + (col + overlap)) * 3;
                const localX = -halfSize + col * segmentSize;
                const localZ = -halfSize + row * segmentSize;
                const worldX = chunkX + localX;
                const worldZ = chunkZ + localZ;

                let neighbor = null;
                let t = 1.0;
                if (row <= -1 && neighbors[2]) {
                    // Bottom edge (upper neighbor)
                    t = (row + overlap) / overlap;
                    neighbor = {
                        height: getHeightFromChunk(neighbors[2], localX, localZ + CONFIG.TERRAIN.chunkSize),
                        biomeIndex: getBiomeFromChunk(neighbors[2], localX, localZ + CONFIG.TERRAIN.chunkSize)
                    };
                } else if (row >= CONFIG.TERRAIN.segments && neighbors[3]) {
                    // Top edge (lower neighbor)
                    t = (CONFIG.TERRAIN.segments + overlap - row) / overlap;
                    neighbor = {
                        height: getHeightFromChunk(neighbors[3], localX, localZ - CONFIG.TERRAIN.chunkSize),
                        biomeIndex: getBiomeFromChunk(neighbors[3], localX, localZ - CONFIG.TERRAIN.chunkSize)
                    };
                } else if (col <= -1 && neighbors[0]) {
                    // Left edge (right neighbor)
                    t = (col + overlap) / overlap;
                    neighbor = {
                        height: getHeightFromChunk(neighbors[0], localX + CONFIG.TERRAIN.chunkSize, localZ),
                        biomeIndex: getBiomeFromChunk(neighbors[0], localX + CONFIG.TERRAIN.chunkSize, localZ)
                    };
                } else if (col >= CONFIG.TERRAIN.segments && neighbors[1]) {
                    // Right edge (left neighbor)
                    t = (CONFIG.TERRAIN.segments + overlap - col) / overlap;
                    neighbor = {
                        height: getHeightFromChunk(neighbors[1], localX - CONFIG.TERRAIN.chunkSize, localZ),
                        biomeIndex: getBiomeFromChunk(neighbors[1], localX - CONFIG.TERRAIN.chunkSize, localZ)
                    };
                }

                positions[vertexIndex] = localX;
                positions[vertexIndex + 1] = 0;
                positions[vertexIndex + 2] = localZ;
                biomeIndices[vertexIndex / 3] = neighbor && neighbor.biomeIndex !== null ? neighbor.biomeIndex : -1;

                pointsToCalculate.push({
                    x: worldX,
                    z: worldZ,
                    index: vertexIndex,
                    neighbor: neighbor || null,
                    t: t
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
        } else {
            this.finishTerrainChunk(geometry, chunkX, chunkZ);
        }

        function getHeightFromChunk(chunk, localX, localZ) {
            const positions = chunk.geometry.attributes.position.array;
            const segments = CONFIG.TERRAIN.segments;
            const segmentSize = CONFIG.TERRAIN.chunkSize / segments;
            const col = (localX + CONFIG.TERRAIN.chunkSize / 2) / segmentSize;
            const row = (localZ + CONFIG.TERRAIN.chunkSize / 2) / segmentSize;
            const col0 = Math.floor(col);
            const row0 = Math.floor(row);
            const col1 = Math.ceil(col);
            const row1 = Math.ceil(row);
            if (col0 < 0 || col1 > segments || row0 < 0 || row1 > segments) return null;

            const v00 = positions[(row0 * (segments + 1) + col0) * 3 + 1];
            const v10 = positions[(row0 * (segments + 1) + col1) * 3 + 1];
            const v01 = positions[(row1 * (segments + 1) + col0) * 3 + 1];
            const v11 = positions[(row1 * (segments + 1) + col1) * 3 + 1];

            const tx = col - col0;
            const ty = row - row0;
            const h0 = lerp(tx, v00, v10);
            const h1 = lerp(tx, v01, v11);
            return lerp(ty, h0, h1);
        }

        function getBiomeFromChunk(chunk, localX, localZ) {
            const biomeIndices = chunk.geometry.attributes.biomeIndex.array;
            const segments = CONFIG.TERRAIN.segments;
            const segmentSize = CONFIG.TERRAIN.chunkSize / segments;
            const col = Math.round((localX + CONFIG.TERRAIN.chunkSize / 2) / segmentSize);
            const row = Math.round((localZ + CONFIG.TERRAIN.chunkSize / 2) / segmentSize);
            if (col >= 0 && col <= segments && row >= 0 && row <= segments) {
                const vertexIndex = row * (segments + 1) + col;
                return biomeIndices[vertexIndex];
            }
            return null;
        }

        function lerp(t, a, b) { return a + t * (b - a); }
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

```javascript
// terrain.js
import * as THREE from 'three';

const CONFIG = Object.freeze({
    TERRAIN: {
        chunkSize: 50,
        segments: 25
    },
    GRAPHICS: {
        textureSize: 256, // Increased for sharper textures
        textureRepeat: 4 // Increased for smaller texture tiles
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
        this.textures = this.initializeTextures();
        this.initialize();
    }

    initializeTextures() {
        const size = CONFIG.GRAPHICS.textureSize;
        const textures = {};
        textures.dirt = this.createProceduralTexture({ r: 120, g: 80, b: 40 }, { r: 160, g: 110, b: 60 }, size);
        textures.grass = this.createProceduralTexture({ r: 40, g: 160, b: 40 }, { r: 20, g: 120, b: 20 }, size);
        textures.rock = this.createProceduralTexture({ r: 80, g: 80, b: 80 }, { r: 140, g: 140, b: 160 }, size);
        textures.snow = this.createProceduralTexture({ r: 240, g: 245, b: 255 }, { r: 200, g: 220, b: 240 }, size);
        return textures;
    }

    createProceduralTexture(color1, color2, size) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(size, size);
        const data = imgData.data;

        // Simple 2D noise function (similar to fragment shader)
        function rand(vec2) {
            return (Math.sin(vec2[0] * 12.9898 + vec2[1] * 78.233) * 43758.5453123) % 1;
        }
        function noise2d(x, y) {
            const i = [Math.floor(x), Math.floor(y)];
            const f = [x % 1, y % 1];
            const u = [f[0] * f[0] * (3 - 2 * f[0]), f[1] * f[1] * (3 - 2 * f[1])];
            const a = rand(i);
            const b = rand([i[0] + 1, i[1]]);
            const c = rand([i[0], i[1] + 1]);
            const d = rand([i[0] + 1, i[1] + 1]);
            return a + (b - a) * u[0] + (c - a) * u[1] * (1 - u[0]) + (d - b) * u[0] * u[1];
        }

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;
                // Multi-octave noise for natural texture
                const n = (
                    noise2d(x / size * 4, y / size * 4) * 0.5 +
                    noise2d(x / size * 8, y / size * 8) * 0.25 +
                    noise2d(x / size * 16, y / size * 16) * 0.125
                ) / 0.875; // Normalize
                const c = {
                    r: color1.r + (color2.r - color1.r) * n,
                    g: color1.g + (color2.g - color1.g) * n,
                    b: color1.b + (color2.b - color1.b) * n
                };
                data[i] = c.r; data[i + 1] = c.g; data[i + 2] = c.b; data[i + 3] = 255;
            }
        }
        ctx.putImageData(imgData, 0, 0);
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(CONFIG.GRAPHICS.textureRepeat, CONFIG.GRAPHICS.textureRepeat);
        tex.minFilter = THREE.LinearMipMapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        return tex;
    }

    initialize() {
        this.terrainWorker = this.createTerrainWorker();
        this.terrainMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;
                varying vec3 vWorldPosition;
                attribute float biomeType;
                varying float vBiomeType;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = position;
                    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
                    vBiomeType = biomeType;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D uDirt;
                uniform sampler2D uGrass;
                uniform sampler2D uRock;
                uniform sampler2D uSnow;
                uniform vec3 uLightDir;
                varying vec3 vNormal;
                varying vec3 vPosition;
                varying vec3 vWorldPosition;
                varying float vBiomeType;

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
                    // smooth interpolation
                    vec2 u = f * f * (3.0 - 2.0 * f);
                    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
                }

                void main() {
                    float height = vWorldPosition.y;
                    float slope = 1.0 - vNormal.y;
                    int biome = int(vBiomeType + 0.5); // round to nearest int

                    // world-space tex coords (tiled)
                    vec2 texCoord = vWorldPosition.xz * 0.2; // Increased for finer texture scaling

                    // sample per-layer procedural canvas textures (cheap, mipmapped)
                    vec3 dirtColor = texture2D(uDirt, texCoord).rgb;
                    vec3 grassColor = texture2D(uGrass, texCoord).rgb;
                    vec3 rockColor = texture2D(uRock, texCoord).rgb;
                    vec3 snowColor = texture2D(uSnow, texCoord).rgb;

                    // Add low-frequency noise to break banding
                    float lowNoise = noise2d(vWorldPosition.xz * 0.05) * 0.3; // Increased noise impact

                    // Base texture blending: dirt -> grass -> rock -> snow by elevation
                    // Steep slopes override with rock
                    
                    // Primary elevation-based blending (adjusted for height range -10 to 20)
                    float dirtWeight = smoothstep(-10.0, 0.0, -height + lowNoise);  // Low elevations
                    float grassWeight = smoothstep(-2.0, 10.0, height + lowNoise) * smoothstep(15.0, 8.0, height + lowNoise); // Mid elevations  
                    float snowWeight = smoothstep(12.0, 18.0, height + lowNoise * 0.5); // High elevations
                    
                    // Rock on steep slopes (overrides elevation-based texturing)
                    float slopeRock = smoothstep(0.3, 0.7, slope + lowNoise * 0.2);
                    
                    // Biome modifications to base blending
                    if (biome == 0) { // MOUNTAINS - more rock, snow starts lower
                        snowWeight = smoothstep(10.0, 15.0, height + lowNoise * 0.5);
                        slopeRock = smoothstep(0.2, 0.55, slope + lowNoise * 0.2); // More sensitive to slope
                    } else if (biome == 1) { // HILLS - standard blending
                        grassWeight *= 1.2; // Slightly boost grass
                    } else if (biome == 2) { // PLAINS - less rock, more grass
                        grassWeight *= 1.5; // Stronger grass boost
                        slopeRock = smoothstep(0.5, 0.9, slope + lowNoise * 0.2); // Less slope rock
                        snowWeight = smoothstep(15.0, 20.0, height + lowNoise * 0.5); // Snow higher up
                    } else { // CANYONS - more exposed rock
                        dirtWeight *= 1.5; // Stronger dirt
                        slopeRock = smoothstep(0.15, 0.45, slope + lowNoise * 0.2); // Very slope-sensitive
                        snowWeight = smoothstep(8.0, 12.0, height + lowNoise * 0.5); // Snow lower
                    }
                    
                    // Mix rock based on slope (rock overrides other textures on steep slopes)
                    float dirtMix = dirtWeight * (1.0 - slopeRock);
                    float grassMix = grassWeight * (1.0 - slopeRock);
                    float rockMix = slopeRock + (1.0 - slopeRock) * smoothstep(8.0, 12.0, height + lowNoise); // Some rock at high elevation
                    float snowMix = snowWeight;
                    
                    // Normalize weights
                    float sum = dirtMix + grassMix + rockMix + snowMix;
                    if (sum > 0.0) {
                        dirtMix /= sum; 
                        grassMix /= sum; 
                        rockMix /= sum; 
                        snowMix /= sum;
                    } else {
                        dirtMix = 1.0; // Fallback to dirt
                    }

                    vec3 color = dirtColor * dirtMix + grassColor * grassMix + rockColor * rockMix + snowColor * snowMix;

                    // cheap detail noise (procedural, per-fragment) to modulate texture detail
                    float detail = noise2d(vWorldPosition.xz * 0.1);
                    color *= mix(0.92, 1.12, detail);

                    // lighting
                    float light = max(dot(normalize(vNormal), normalize(uLightDir)), 0.0) * 0.7 + 0.3;

                    // fake ambient occlusion using slope and height (darken crevices)
                    float ao = 1.0 - clamp(slope * 0.5 + (1.0 - smoothstep(-1.0, 1.0, height)) * 0.15, 0.0, 0.6);

                    // subtle fresnel (rim) to give silhouettes depth
                    float viewDot = max(dot(normalize(vNormal), normalize(-vWorldPosition)), 0.0);
                    float fresnel = pow(1.0 - viewDot, 3.0) * 0.08;

                    vec3 finalColor = color * light * ao + fresnel;

                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            uniforms: {
                uDirt: { value: this.textures.dirt },
                uGrass: { value: this.textures.grass },
                uRock: { value: this.textures.rock },
                uSnow: { value: this.textures.snow },
                uLightDir: { value: new THREE.Vector3(1, 1, 1).normalize() }
            },
            side: THREE.FrontSide
        });
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

            // Multi-octave helper
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

            // map continuous noise value to biome index (soft boundary will be handled by blending multiple samples)
            function noiseToBiomeIndex(n) {
                if (n < -0.4) return BIOMES.CANYONS;
                if (n < 0.0) return BIOMES.PLAINS;
                if (n < 0.45) return BIOMES.HILLS;
                return BIOMES.MOUNTAINS;
            }

            // sample biome noise at a point using multi-octave biome noise (gives variable biome sizes)
            function sampleBiomePoint(x, z, seed) {
                const offset = seed * 0.001;
                // Multi-octave biome noise for larger-scale features
                const n = fbm2(x, z, 3, 0.55, 2.0, 0.008, offset);
                return n;
            }

            // For a vertex, sample biome at chunk grid points and blend parameters accordingly
            function sampleAndBlendBiomeParams(worldX, worldZ, seed, chunkSize) {
                const chunkGridX = Math.floor(worldX / chunkSize) * chunkSize;
                const chunkGridZ = Math.floor(worldZ / chunkSize) * chunkSize;
                const half = chunkSize / 2;

                // Sample at grid-aligned points (chunk corners) to ensure consistency across chunks
                const corners = [
                    [chunkGridX - half, chunkGridZ - half], // bottom-left
                    [chunkGridX + half, chunkGridZ - half], // bottom-right
                    [chunkGridX - half, chunkGridZ + half], // top-left
                    [chunkGridX + half, chunkGridZ + half]  // top-right
                ];
                const center = [chunkGridX, chunkGridZ];

                // Compute u,v (normalized local coords within the chunk grid, 0..1)
                const localU = (worldX - (chunkGridX - half)) / chunkSize;
                const localV = (worldZ - (chunkGridZ - half)) / chunkSize;
                const u = Math.max(0, Math.min(1, localU));
                const v = Math.max(0, Math.min(1, localV));

                // Bilinear corner weights
                const w00 = (1 - u) * (1 - v);
                const w10 = u * (1 - v);
                const w01 = (1 - u) * v;
                const w11 = u * v;

                // Center weight: stronger near center, weaker near edges
                const dx = u - 0.5;
                const dy = v - 0.5;
                const dist = Math.sqrt(dx * dx + dy * dy) / Math.sqrt(0.5 * 0.5 + 0.5 * 0.5);
                let centerWeight = 1.0 - Math.min(1.0, dist);
                centerWeight = centerWeight * centerWeight * (3 - 2 * centerWeight); // smoothstep-like

                // Raw weights array
                const rawWeights = [w00, w10, w01, w11, centerWeight * 0.75]; // center scaled a bit so corners still matter

                // Sample biome noise at each sample point
                const samplePoints = [
                    corners[0], corners[1], corners[2], corners[3], center
                ];

                // Accumulate param blends and biome dominances
                let accum = {
                    amplitude: 0,
                    frequency: 0,
                    octaves: 0,
                    persistence: 0,
                    lacunarity: 0,
                    baseHeight: 0
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

                if (totalWeight <= 0) totalWeight = 1.0; // avoid div0

                // Normalize accum
                for (let k in accum) accum[k] /= totalWeight;

                // Determine dominant biome (highest total weight)
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

            // Calculate height using blended params (supports fractional octaves)
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
                    // Partial octave contribution
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
                const ny = 2.0; // Control steepness influence
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

                        const blend = sampleAndBlendBiomeParams(worldX, worldZ, seed, chunkSize);
                        const params = blend.params;
                        const dominant = blend.dominantBiome;

                        const height = calculateHeightWithParams(worldX, worldZ, seed, params);
                        const normal = calculateNormal(worldX, worldZ, seed, params);
                        results.push({
                            x: worldX,
                            z: worldZ,
                            height,
                            normalX: normal[0],
                            normalY: normal[1],
                            normalZ: normal[2],
                            biomeType: dominant,
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

            for (let i = 0; i < results.length; i++) {
                const { height, normalX, normalY, normalZ, biomeType, index } = results[i];
                const vertexIndex = index / 3; // Convert back to vertex index

                // index is the byte/array index already (vertexIndex * 3 in addTerrainChunk)
                positions[index + 1] = height; // y is height
                normals[index]      = normalX;
                normals[index + 1] = normalY;
                normals[index + 2] = normalZ;
                biomeTypes[vertexIndex] = biomeType;
            }

            geometry.attributes.position.needsUpdate = true;
            geometry.attributes.normal.needsUpdate = true;
            geometry.attributes.biomeType.needsUpdate = true;
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

        // Add normal and biome type attributes
        geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3));
        geometry.setAttribute('biomeType', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count), 1));

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
            // structured clone supported; send array of small objects plus chunk metadata
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
```
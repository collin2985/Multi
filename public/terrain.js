// terrain.js
import * as THREE from 'three';

const CONFIG = Object.freeze({
    TERRAIN: {
        chunkSize: 50,
        segments: 25
    },
    GRAPHICS: {
        textureSize: 48,
        textureRepeat: 2
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
        textures.dirt = this.createProceduralTexture({ r: 101, g: 67, b: 33 }, { r: 139, g: 90, b: 43 }, size);
        textures.grass = this.createProceduralTexture({ r: 34, g: 139, b: 34 }, { r: 0, g: 100, b: 0 }, size);
        textures.rock = this.createProceduralTexture({ r: 105, g: 105, b: 105 }, { r: 128, g: 128, b: 128 }, size);
        textures.snow = this.createProceduralTexture({ r: 255, g: 250, b: 250 }, { r: 240, g: 248, b: 255 }, size);
        return textures;
    }

    createProceduralTexture(color1, color2, size) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(size, size);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            // low-cost stipple / noise pattern
            const noise = Math.random();
            const c = noise > 0.5 ? color1 : color2;
            data[i] = c.r; data[i + 1] = c.g; data[i + 2] = c.b; data[i + 3] = 255;
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
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = position;
                    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
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

                    // world-space tex coords (tiled)
                    vec2 texCoord = vWorldPosition.xz * 0.1;

                    // sample per-layer procedural canvas textures (cheap, mipmapped)
                    vec3 dirtColor = texture2D(uDirt, texCoord).rgb;
                    vec3 grassColor = texture2D(uGrass, texCoord).rgb;
                    vec3 rockColor = texture2D(uRock, texCoord).rgb;
                    vec3 snowColor = texture2D(uSnow, texCoord).rgb;

                    // Add low-frequency noise to break banding
                    float lowNoise = noise2d(vWorldPosition.xz * 0.05) * 0.3;

                    // Smooth transitions with smoothstep + noise offset
                    float dirtMix  = smoothstep(0.8, 0.1, height * 0.1 + lowNoise * 0.5);
                    float grassMix = smoothstep(0.0, 1.0, height * 0.1 - slope + lowNoise * 0.4);
                    float rockMix  = smoothstep(0.0, 1.0, slope * 0.5 + lowNoise * 0.2);
                    float snowMix  = smoothstep(0.5, 1.5, height * 0.05 + lowNoise * 0.6);

                    float sum = dirtMix + grassMix + rockMix + snowMix;
                    if (sum > 0.0) {
                        dirtMix /= sum; grassMix /= sum; rockMix /= sum; snowMix /= sum;
                    } else {
                        grassMix = 1.0;
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

            function calculateNormal(x, z, seed, perlinFn) {
                const offset = seed * 0.001;
                const eps = 0.02;
                const heightL = perlinFn((x - eps) * 0.02 + offset, 0, z * 0.02 + offset) * 10;
                const heightR = perlinFn((x + eps) * 0.02 + offset, 0, z * 0.02 + offset) * 10;
                const heightD = perlinFn(x * 0.02 + offset, 0, (z - eps) * 0.02 + offset) * 10;
                const heightU = perlinFn(x * 0.02 + offset, 0, (z + eps) * 0.02 + offset) * 10;

                const nx = heightL - heightR;
                const nz = heightD - heightU;
                const ny = 2.0; // control steepness influence
                const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
                return [nx/len, ny/len, nz/len];
            }

            self.onmessage = function(e) {
                if (e.data.type === 'calculateHeightBatch') {
                    const { points, batchId, seed } = e.data.data;
                    const results = [];
                    for(const point of points) {
                        const offset = seed * 0.001;
                        const height = perlin(point.x * 0.02 + offset, 0, point.z * 0.02 + offset) * 10;
                        const normal = calculateNormal(point.x, point.z, seed, perlin);
                        results.push({
                            x: point.x,
                            z: point.z,
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
                // index is the byte/array index already (vertexIndex * 3 in addTerrainChunk)
                positions[index + 1] = height; // y is height
                normals[index]     = normalX;
                normals[index + 1] = normalY;
                normals[index + 2] = normalZ;
            }

            geometry.attributes.position.needsUpdate = true;
            geometry.attributes.normal.needsUpdate = true;
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

        // PlaneGeometry default is XY plane; your original code used plane with positions x/z already set.
        // Keep the positions as-is (do not rotate) so worldPosition calculation in shader matches your earlier code.
        // Add a normal attribute for worker to fill in:
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
            // structured clone supported; send array of small objects
            this.terrainWorker.postMessage({
                type: 'calculateHeightBatch',
                data: { points: pointsToCalculate, batchId, seed }
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

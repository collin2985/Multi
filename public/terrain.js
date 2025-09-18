// terrain.js
import * as THREE from 'three';

const CONFIG = Object.freeze({
    TERRAIN: {
        chunkSize: 50,
        segments: 25
    },
    GRAPHICS: {
        textureSize: 24,
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
        this.initialize();
    }

    initialize() {
        this.terrainWorker = this.createTerrainWorker();
        this.terrainMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;
                varying vec3 vWorldPosition;
                void main() {
                    vNormal = normal;
                    vPosition = position;
                    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uLightDir;
                varying vec3 vNormal;
                varying vec3 vPosition;
                varying vec3 vWorldPosition;
                void main() {
                    float height = vWorldPosition.y;
                    float slope = 1.0 - vNormal.y;
                    
                    vec3 dirtColor = vec3(0.4, 0.26, 0.13);
                    vec3 grassColor = vec3(0.13, 0.55, 0.13);
                    vec3 rockColor = vec3(0.41, 0.41, 0.41);
                    vec3 snowColor = vec3(0.98, 0.98, 0.98);
                    
                    float dirtMix = clamp(1.0 - height * 0.1, 0.0, 1.0);
                    float grassMix = clamp(height * 0.1 - slope, 0.0, 1.0);
                    float rockMix = clamp(slope * 0.5, 0.0, 1.0);
                    float snowMix = clamp(height * 0.05 - 0.5, 0.0, 1.0);
                    
                    float sum = dirtMix + grassMix + rockMix + snowMix;
                    if (sum > 0.0) {
                        dirtMix /= sum; grassMix /= sum; rockMix /= sum; snowMix /= sum;
                    } else {
                        grassMix = 1.0;
                    }
                    
                    vec3 color = dirtColor * dirtMix + grassColor * grassMix + rockColor * rockMix + snowColor * snowMix;
                    float light = max(dot(vNormal, uLightDir), 0.0) * 0.7 + 0.3;
                    gl_FragColor = vec4(color * light, 1.0);
                }
            `,
            uniforms: {
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
            
            const cache = new Map();
            
            self.onmessage = function(e) {
                if (e.data.type === 'calculateHeightBatch') {
                    const { points, batchId, seed } = e.data.data;
                    const results = new Float32Array(points.length / 3 * 2);
                    for (let i = 0; i < points.length / 3; i++) {
                        const x = points[i * 3];
                        const z = points[i * 3 + 1];
                        const index = points[i * 3 + 2];
                        const key = \`\${seed}_\${x}_\${z}\`;
                        let height;
                        if (cache.has(key)) {
                            height = cache.get(key);
                        } else {
                            const offset = seed * 0.001;
                            height = perlin(x * 0.02 + offset, 0, z * 0.02 + offset) * 10;
                            cache.set(key, height);
                        }
                        results[i * 2] = height;
                        results[i * 2 + 1] = index;
                    }
                    self.postMessage({ type: 'heightBatchResult', data: { results, batchId } }, [results.buffer]);
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
            
            for (let i = 0; i < results.length / 2; i++) {
                const height = results[i * 2];
                const index = results[i * 2 + 1];
                positions[index + 1] = height; // y is height
            }
            
            geometry.attributes.position.needsUpdate = true;
            geometry.computeVertexNormals();
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
        
        console.time("chunkGen");
        console.log(`Creating terrain chunk at (${chunkX}, ${chunkZ}) with seed ${seed}`);
        
        const geometry = new THREE.PlaneGeometry(
            CONFIG.TERRAIN.chunkSize,
            CONFIG.TERRAIN.chunkSize,
            CONFIG.TERRAIN.segments,
            CONFIG.TERRAIN.segments
        );
        
        const positions = geometry.attributes.position.array;
        const numVertices = positions.length / 3;
        const pointsArray = new Float32Array(numVertices * 3);
        
        const segmentSize = CONFIG.TERRAIN.chunkSize / CONFIG.TERRAIN.segments;
        const halfSize = CONFIG.TERRAIN.chunkSize / 2;
        
        for (let row = 0; row <= CONFIG.TERRAIN.segments; row++) {
            for (let col = 0; col <= CONFIG.TERRAIN.segments; col++) {
                const vertexIndex = row * (CONFIG.TERRAIN.segments + 1) + col;
                const localX = -halfSize + col * segmentSize;
                const localZ = -halfSize + row * segmentSize;
                
                const worldX = chunkX + localX;
                const worldZ = chunkZ + localZ;
                
                positions[vertexIndex * 3] = localX;
                positions[vertexIndex * 3 + 1] = 0;
                positions[vertexIndex * 3 + 2] = localZ;
                
                pointsArray[vertexIndex * 3] = worldX;
                pointsArray[vertexIndex * 3 + 1] = worldZ;
                pointsArray[vertexIndex * 3 + 2] = vertexIndex * 3; // index for positions array
            }
        }
        
        if (numVertices > 0) {
            const batchId = key;
            this.pendingChunks.set(batchId, { geometry, chunkX, chunkZ });
            this.terrainWorker.postMessage({
                type: 'calculateHeightBatch',
                data: { points: pointsArray, batchId, seed }
            }, [pointsArray.buffer]);
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
        console.timeEnd("chunkGen");
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
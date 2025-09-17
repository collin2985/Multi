// terrain.js
import * as THREE from 'three';

const CONFIG = Object.freeze({
    TERRAIN: {
        chunkSize: 50,
        segments: 100
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
            const noise = Math.random();
            const c = noise > 0.5 ? color1 : color2;
            data[i] = c.r; data[i + 1] = c.g; data[i + 2] = c.b; data[i + 3] = 255;
        }
        ctx.putImageData(imgData, 0, 0);
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(CONFIG.GRAPHICS.textureRepeat, CONFIG.GRAPHICS.textureRepeat);
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
                    vNormal = normal;
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
                void main() {
                    float height = vWorldPosition.y;
                    float slope = 1.0 - vNormal.y;
                    
                    // Use world position for texture sampling
                    vec2 texCoord = vWorldPosition.xz * 0.1;
                    vec3 dirtColor = texture2D(uDirt, texCoord).rgb;
                    vec3 grassColor = texture2D(uGrass, texCoord).rgb;
                    vec3 rockColor = texture2D(uRock, texCoord).rgb;
                    vec3 snowColor = texture2D(uSnow, texCoord).rgb;
                    
                    // Terrain mixing
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
            const perm = new Uint8Array([${[151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180].join(',')}]); 
            
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
            self.onmessage = function(e) {
                if (e.data.type === 'calculateHeightBatch') {
                    const { points, batchId } = e.data.data;
                    const results = points.map(point => {
                        const height = perlin(point.x * 0.02, 0, point.z * 0.02) * 10;
                        return { x: point.x, z: point.z, height, index: point.index };
                    });
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
            
            for (let i = 0; i < results.length; i++) {
                const { height, index } = results[i];
                positions[index + 1] = height;
            }
            
            geometry.attributes.position.needsUpdate = true;
            geometry.computeVertexNormals();
            this.finishTerrainChunk(geometry, chunkX, chunkZ);
            this.pendingChunks.delete(batchId);
        }
    }

    addTerrainChunk(chunkId) {
        const coords = this.chunkIdToCoords(chunkId);
        const [chunkX, chunkZ] = coords;
        
        // Check if chunk already exists
        if (this.terrainChunks.has(`${chunkX},${chunkZ}`)) {
            return; 
        }
        
        console.log(`Creating terrain chunk at (${chunkX}, ${chunkZ})`);
        
        const geometry = new THREE.PlaneGeometry(
            CONFIG.TERRAIN.chunkSize,
            CONFIG.TERRAIN.chunkSize,
            CONFIG.TERRAIN.segments,
            CONFIG.TERRAIN.segments
        );
        geometry.rotateX(-Math.PI / 2);
        
        const positions = geometry.attributes.position.array;
        const pointsToCalculate = [];
        
        // FIXED: Process vertices in proper grid order
        const segmentSize = CONFIG.TERRAIN.chunkSize / CONFIG.TERRAIN.segments;
        const halfSize = CONFIG.TERRAIN.chunkSize / 2;
        
        for (let row = 0; row <= CONFIG.TERRAIN.segments; row++) {
            for (let col = 0; col <= CONFIG.TERRAIN.segments; col++) {
                const vertexIndex = (row * (CONFIG.TERRAIN.segments + 1) + col) * 3;
                
                // Calculate world position properly
                const localX = -halfSize + col * segmentSize;
                const localZ = -halfSize + row * segmentSize;
                const worldX = chunkX + localX;
                const worldZ = chunkZ + localZ;
                
                pointsToCalculate.push({ 
                    x: worldX, 
                    z: worldZ, 
                    index: vertexIndex 
                });
            }
        }
        
        if (pointsToCalculate.length > 0) {
            const batchId = chunkId;
            this.pendingChunks.set(batchId, { geometry, chunkX, chunkZ });
            this.terrainWorker.postMessage({
                type: 'calculateHeightBatch',
                data: { points: pointsToCalculate, batchId }
            });
        }
    }

    finishTerrainChunk(geometry, chunkX, chunkZ) {
        const mesh = new THREE.Mesh(geometry, this.terrainMaterial);
        mesh.position.set(chunkX, 0, chunkZ);
        this.scene.add(mesh);
        this.terrainChunks.set(`${chunkX},${chunkZ}`, mesh);
        console.log(`Added terrain chunk at (${chunkX}, ${chunkZ})`);
    }

    removeTerrainChunk(chunkId) {
        const coords = this.chunkIdToCoords(chunkId);
        const [chunkX, chunkZ] = coords;
        const mesh = this.terrainChunks.get(`${chunkX},${chunkZ}`);
        if (mesh) {
            this.scene.remove(mesh);
            this.terrainChunks.delete(`${chunkX},${chunkZ}`);
            mesh.geometry.dispose();
            console.log(`Removed chunk: ${chunkId}`);
        }
    }
    
    chunkIdToCoords(chunkId) {
        const parts = chunkId.split('_');
        if (parts.length === 3 && parts[0] === 'chunk') {
            const x = parseInt(parts[1]) * CONFIG.TERRAIN.chunkSize;
            const z = parseInt(parts[2]) * CONFIG.TERRAIN.chunkSize;
            return [x, z];
        }
        console.error(`Invalid chunkId: ${chunkId}`);
        return [0, 0];
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
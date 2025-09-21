// ===== THREE.JS TERRAIN SYSTEM - ADAPTED FOR game.js =====
// This is a single-file implementation of a procedural terrain system
// adapted from terrain.js to fit the SimpleTerrainRenderer class
// expected by game.js.

// 1. IMPORTS
import * as THREE from 'three';

// 2. CONSTANTS AND CONFIGURATION
const CONFIG = Object.freeze({
    TERRAIN: {
        chunkSize: 50,
        segments: 100,
        renderDistance: 2
    },
    PERFORMANCE: {
        updateThrottle: 100,
        maxCacheSize: 10000
    },
    GRAPHICS: {
        textureSize: 128,
        textureRepeat: 2
    },
    CAMERA: {
        offset: { x: 0, y: 35, z: -20 }
    },
    TERRAIN_EDIT: {
        INTENSITY: 0.75, // Synced with server.js (reduced from 1.5)
        RADIUS: 2.0
    }
});

// 3. UTILITIES
const Utilities = {
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
            const keysToDelete = Array.from(cache.keys()).slice(0, cache.size - maxSize);
            keysToDelete.forEach(key => cache.delete(key));
        }
    },
    getChunkRNG(seed, chunkX, chunkZ) {
        const chunkSeed = seed + chunkX * 73856093 + chunkZ * 19349663;
        return Utilities.mulberry32(chunkSeed);
    },
    logError(message, error) {
        console.error(`${message}:`, error);
    },
    // NEW: Clear cache entries within a radius to force recomputation after edits
    clearCacheInRadius(cache, x, z, radius) {
        const radiusSq = radius * radius;
        const keysToDelete = [];
        for (const key of cache.keys()) {
            const [px, pz] = key.split(',').map(Number);
            const distSq = (px - x) ** 2 + (pz - z) ** 2;
            if (distSq <= radiusSq) {
                keysToDelete.push(key);
            }
        }
        keysToDelete.forEach(key => cache.delete(key));
    }
};

// 4. PERLIN NOISE IMPLEMENTATION
class OptimizedPerlin {
    constructor(seed = 12345) {
        this.p = new Array(512);
        const perm = [];
        const rng = Utilities.mulberry32(seed);
        for (let i = 0; i < 256; i++) perm[i] = i;
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [perm[i], perm[j]] = [perm[j], perm[i]];
        }
        for (let i = 0; i < 256; i++) this.p[i] = this.p[i + 256] = perm[i];
    }
    fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    lerp(t, a, b) { return a + t * (b - a); }
    grad(hash, x, y, z) {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }
    noise(x, y, z) {
        let X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
        x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
        let u = this.fade(x), v = this.fade(y), w = this.fade(z);
        let A = this.p[X] + Y, AA = this.p[A] + Z, AB = this.p[A + 1] + Z;
        let B = this.p[X + 1] + Y, BA = this.p[B] + Z, BB = this.p[B + 1] + Z;
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

function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
}

// 5. TERRAIN WORKER - Helper code for the main class
function getWorkerCode() {
    return `
        const workerHeightCache = new Map();
        function mulberry32(seed) {
            return function() {
                let t = seed += 0x6D2B79F4;
                t = Math.imul(t ^ t >>> 15, t | 1);
                t ^= t + Math.imul(t ^ t >>> 7, t | 61);
                return ((t ^ t >>> 14) >>> 0) / 4294967296;
            }
        }
        class OptimizedPerlin {
            constructor(seed = 12345) {
                this.p = new Array(512);
                const perm = [];
                const rng = mulberry32(seed);
                for (let i = 0; i < 256; i++) perm[i] = i;
                for (let i = 255; i > 0; i--) {
                    const j = Math.floor(rng() * (i + 1));
                    [perm[i], perm[j]] = [perm[j], perm[i]];
                }
                for (let i = 0; i < 256; i++) this.p[i] = this.p[i + 256] = perm[i];
            }
            fade(t) { return t*t*t*(t*(t*6-15)+10); }
            lerp(t,a,b) { return a + t*(b-a); }
            grad(hash,x,y,z) {
                const h = hash & 15;
                const u = h < 8 ? x : y;
                const v = h < 4 ? y : (h===12||h===14 ? x : z);
                return ((h&1)===0 ? u : -u) + ((h&2)===0 ? v : -v);
            }
            noise(x,y,z) {
                let X=Math.floor(x)&255, Y=Math.floor(y)&255, Z=Math.floor(z)&255;
                x-=Math.floor(x); y-=Math.floor(y); z-=Math.floor(z);
                let u=this.fade(x), v=this.fade(y), w=this.fade(z);
                let A=this.p[X]+Y, AA=this.p[A]+Z, AB=this.p[A+1]+Z;
                let B=this.p[X+1]+Y, BA=this.p[B]+Z, BB=this.p[B+1]+Z;
                return this.lerp(w,
                    this.lerp(v,
                        this.lerp(u,this.grad(this.p[AA],x,y,z),this.grad(this.p[BA],x-1,y,z)),
                        this.lerp(u,this.grad(this.p[AB],x,y-1,z),this.grad(this.p[BB],x-1,y-1,z))
                    ),
                    this.lerp(v,
                        this.lerp(u,this.grad(this.p[AA+1],x,y,z-1),this.grad(this.p[BA+1],x-1,y,z-1)),
                        this.lerp(u,this.grad(this.p[AB+1],x,y-1,z-1),this.grad(this.p[BB+1],x-1,y-1,z-1))
                    )
                );
            }
        }
        function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
        const perlin = new OptimizedPerlin(12345);
        function calculateBaseHeight(x,z) {
            let base=0, amp=1, freq=0.02;
            for(let o=0;o<3;o++){ base+=perlin.noise(x*freq,z*freq,10+o*7)*amp; amp*=0.5; freq*=2; }
            let maskRaw = perlin.noise(x*0.006,z*0.006,400);
            let mask = Math.pow((maskRaw+1)*0.5,3);
            let mountain=0; amp=1; freq=0.04;
            for(let o=0;o<4;o++){ mountain+=Math.abs(perlin.noise(x*freq,z*freq,500+o*11))*amp; amp*=0.5; freq*=2; }
            mountain *= 40 * mask;
            const elevNorm = clamp((base+mountain+2)/25,0,1);
            let jagged = perlin.noise(x*0.8,z*0.8,900)*1.2*elevNorm + perlin.noise(x*1.6,z*1.6,901)*0.6*elevNorm;
            return base + mountain + jagged;
        }
        function getDelta(mod, px, pz) {
            const distSq = (px - mod.x) ** 2 + (pz - mod.z) ** 2;
            const dist = Math.sqrt(distSq);
            if (dist > mod.radius) return 0;
            const falloff = Math.exp(-distSq / (2 * mod.radius ** 2));
            return mod.heightDelta * falloff;
        }
        self.onmessage = function(e) {
            const { type, data } = e.data;
            if(type === 'calculateHeightBatch' || type === 'applyModifications') {
                const { points, batchId, mods = [] } = data;
                const results = [];
                const eps = 0.1;
                for(let i=0;i<points.length;i++){
                    const { x, z, index } = points[i];
                    let h = workerHeightCache.has(\`\${x},\${z}\`) ? workerHeightCache.get(\`\${x},\${z}\`) : calculateBaseHeight(x,z);
                    mods.forEach(mod => {
                        h += getDelta(mod, x, z);
                    });
                    const hL = calculateBaseHeight(x-eps,z) + mods.reduce((sum, mod) => sum + getDelta(mod, x-eps, z), 0);
                    const hR = calculateBaseHeight(x+eps,z) + mods.reduce((sum, mod) => sum + getDelta(mod, x+eps, z), 0);
                    const hD = calculateBaseHeight(x,z-eps) + mods.reduce((sum, mod) => sum + getDelta(mod, x, z-eps), 0);
                    const hU = calculateBaseHeight(x,z+eps) + mods.reduce((sum, mod) => sum + getDelta(mod, x, z+eps), 0);
                    const nx = hL - hR;
                    const ny = 2 * eps;
                    const nz = hD - hU;
                    const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
                    results.push({
                        x, z, height: h,
                        normal: { x: nx/len, y: ny/len, z: nz/len },
                        index
                    });
                    workerHeightCache.set(\`\${x},\${z}\`, h);
                }
                self.postMessage({ type:'heightBatchResult', data:{ results, batchId } });
            }
        };
    `;
}

// ---
// 6. SIMPLETERRAINRENDERER - ADAPTED from the original TerrainSystem
export class SimpleTerrainRenderer {
    constructor(scene) {
        this.scene = scene;
        this.terrainChunks = new Map();
        this.terrainMaterial = null;
        this.terrainWorker = null;
        this.pendingChunks = new Map();
        this.heightCache = new Map();
        this.normalCache = new Map();
        this.modificationCache = new Map(); // Cache for modification effects
        this.chunkModifications = new Map(); // Store mods per chunk
        this.collisionManager = {
            addColliderToChunk: () => {},
            removeChunkColliders: () => {}
        };
        this.initialize();
    }

    initialize() {
        this.createTerrainWorker();
        this.createTerrainMaterial();
        this.createProceduralTextures();
    }

    createTerrainWorker() {
        try {
            const blob = new Blob([getWorkerCode()], { type: 'application/javascript' });
            this.terrainWorker = new Worker(URL.createObjectURL(blob));
            this.terrainWorker.onmessage = this.handleWorkerMessage.bind(this);
            this.terrainWorker.onerror = (error) => Utilities.logError('Worker error', error);
        } catch (err) {
            Utilities.logError('Failed to initialize worker', err);
            this.terrainWorker = null;
        }
    }

    createTerrainMaterial() {
        const vertexShader = `
            varying float vHeight;
            varying float vSlope;
            varying vec3 vNormal;
            varying vec2 vUv;
            void main(){
                vUv = uv;
                vHeight = position.y;
                vNormal = normal;
                vSlope = 1.0 - dot(normal, vec3(0,1,0));
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;
        const fragmentShader = `
            uniform vec3 uLightDir;
            uniform sampler2D uDirt;
            uniform sampler2D uGrass;
            uniform sampler2D uRock;
            uniform sampler2D uSnow;
            varying float vHeight;
            varying float vSlope;
            varying vec3 vNormal;
            varying vec2 vUv;
            void main(){
                float repeat=6.0;
                vec3 dirt=texture2D(uDirt,vUv*repeat).rgb;
                vec3 grass=texture2D(uGrass,vUv*repeat).rgb;
                vec3 rock=texture2D(uRock,vUv*repeat).rgb;
                vec3 snow=texture2D(uSnow,vUv*repeat).rgb;
                float wDirt=1.0-smoothstep(-2.0,1.0,vHeight);
                float wGrass=smoothstep(-2.0,1.0,vHeight)*(1.0-smoothstep(1.0,7.5,vHeight));
                float wSnow=smoothstep(1.0,7.5,vHeight);
                float slopeFactor=smoothstep(0.05,0.2,vSlope);
                vec3 baseColor=dirt*wDirt + grass*wGrass + snow*wSnow;
                baseColor=mix(baseColor,rock,slopeFactor);
                float dp=max(0.0,dot(normalize(vNormal),normalize(uLightDir)));
                baseColor*=(0.5+dp*0.5);
                gl_FragColor=vec4(baseColor,1.0);
            }
        `;

        // Dummy textures since game.js doesn't provide a renderer to create them
        const dummyTexture = new THREE.Texture();
        this.terrainMaterial = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                uDirt: { value: dummyTexture },
                uGrass: { value: dummyTexture },
                uRock: { value: dummyTexture },
                uSnow: { value: dummyTexture },
                uLightDir: { value: new THREE.Vector3(1, 1, 1).normalize() }
            },
            side: THREE.FrontSide
        });
    }

    createProceduralTextures() {
        const size = CONFIG.GRAPHICS.textureSize;
        const createTex = (c1, c2) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            const ctx = canvas.getContext('2d');
            const imgData = ctx.createImageData(size, size);
            const data = imgData.data;
            for (let i = 0; i < data.length; i += 4) {
                const noise = Math.random();
                const c = noise > 0.5 ? c1 : c2;
                data[i] = c.r; data[i + 1] = c.g; data[i + 2] = c.b; data[i + 3] = 255;
            }
            ctx.putImageData(imgData, 0, 0);
            const tex = new THREE.CanvasTexture(canvas);
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            tex.minFilter = THREE.NearestFilter;
            tex.magFilter = THREE.NearestFilter;
            return tex;
        };

        const textures = {
            dirt: createTex({ r: 101, g: 67, b: 33 }, { r: 139, g: 90, b: 43 }),
            grass: createTex({ r: 34, g: 139, b: 34 }, { r: 0, g: 100, b: 0 }),
            rock: createTex({ r: 105, g: 105, b: 105 }, { r: 128, g: 128, b: 128 }),
            snow: createTex({ r: 255, g: 250, b: 250 }, { r: 240, g: 248, b: 255 }),
        };

        // Update uniforms
        this.terrainMaterial.uniforms.uDirt.value = textures.dirt;
        this.terrainMaterial.uniforms.uGrass.value = textures.grass;
        this.terrainMaterial.uniforms.uRock.value = textures.rock;
        this.terrainMaterial.uniforms.uSnow.value = textures.snow;
    }

    handleWorkerMessage(e) {
        const { type, data } = e.data;
        if (type === 'heightBatchResult') {
            const { results, batchId } = data;
            const pending = this.pendingChunks.get(batchId);
            if (!pending) {
                console.warn(`No pending chunk for batchId ${batchId}`);
                return;
            }

            const { geometry, x, z } = pending;
            const positions = geometry.attributes.position.array;
            const normals = geometry.attributes.normal.array;

            for (let i = 0; i < results.length; i++) {
                const { x: px, z: pz, height, normal, index } = results[i];
                positions[index + 1] = height;
                normals[index] = normal.x;
                normals[index + 1] = normal.y;
                normals[index + 2] = normal.z;
                this.heightCache.set(`${px},${pz}`, height);
                this.normalCache.set(`${px},${pz}`, normal);
            }

            geometry.attributes.position.needsUpdate = true;
            geometry.attributes.normal.needsUpdate = true;

            this.finishTerrainChunk(geometry, x, z);
            this.pendingChunks.delete(batchId);

            Utilities.limitCacheSize(this.heightCache, CONFIG.PERFORMANCE.maxCacheSize);
            Utilities.limitCacheSize(this.normalCache, CONFIG.PERFORMANCE.maxCacheSize);
        }
    }

    addTerrainChunk({ chunkX, chunkZ, seed, modifications = [] }) {
        const key = `${chunkX/CONFIG.TERRAIN.chunkSize},${chunkZ/CONFIG.TERRAIN.chunkSize}`;
        // CHANGED: Check if chunk exists; update instead of adding new
        if (this.terrainChunks.has(key)) {
            console.log(`Chunk ${key} already exists, updating geometry instead`);
            this.updateChunkGeometry(chunkX, chunkZ, modifications);
            return;
        }

        const geometry = new THREE.PlaneGeometry(
            CONFIG.TERRAIN.chunkSize,
            CONFIG.TERRAIN.chunkSize,
            CONFIG.TERRAIN.segments,
            CONFIG.TERRAIN.segments
        );
        geometry.rotateX(-Math.PI / 2);
        const positions = geometry.attributes.position.array;
        const pointsToCalculate = [];
        for (let i = 0; i < positions.length; i += 3) {
            const px = chunkX + positions[i];
            const pz = chunkZ + positions[i + 2];
            pointsToCalculate.push({ x: px, z: pz, index: i });
        }
        if (pointsToCalculate.length > 0) {
            const batchId = `${chunkX},${chunkZ}`;
            this.pendingChunks.set(batchId, { geometry, x: chunkX, z: chunkZ });
            this.chunkModifications.set(key, modifications);
            if (this.terrainWorker) {
                this.terrainWorker.postMessage({
                    type: 'applyModifications',
                    data: { points: pointsToCalculate, batchId, mods: modifications }
                });
            } else {
                console.warn('Terrain worker not available, generating chunk in main thread');
                // Fallback to main-thread calculation
                const perlin = new OptimizedPerlin(seed);
                const positions = geometry.attributes.position.array;
                const normals = geometry.attributes.normal.array;
                const eps = 0.1;
                for (let i = 0; i < pointsToCalculate.length; i++) {
                    const { x, z, index } = pointsToCalculate[i];
                    let h = this.calculateBaseHeight(x, z, perlin);
                    modifications.forEach(mod => {
                        h += this.getDelta(mod, x, z);
                    });
                    const hL = this.calculateBaseHeight(x - eps, z, perlin) + modifications.reduce((sum, mod) => sum + this.getDelta(mod, x - eps, z), 0);
                    const hR = this.calculateBaseHeight(x + eps, z, perlin) + modifications.reduce((sum, mod) => sum + this.getDelta(mod, x + eps, z), 0);
                    const hD = this.calculateBaseHeight(x, z - eps, perlin) + modifications.reduce((sum, mod) => sum + this.getDelta(mod, x, z - eps), 0);
                    const hU = this.calculateBaseHeight(x, z + eps, perlin) + modifications.reduce((sum, mod) => sum + this.getDelta(mod, x, z + eps), 0);
                    const nx = hL - hR;
                    const ny = 2 * eps;
                    const nz = hD - hU;
                    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
                    positions[index + 1] = h;
                    normals[index] = nx / len;
                    normals[index + 1] = ny / len;
                    normals[index + 2] = nz / len;
                    this.heightCache.set(`${x},${z}`, h);
                    this.normalCache.set(`${x},${z}`, { x: nx / len, y: ny / len, z: nz / len });
                }
                geometry.attributes.position.needsUpdate = true;
                geometry.attributes.normal.needsUpdate = true;
                this.finishTerrainChunk(geometry, chunkX, chunkZ);
            }
        }
    }

    updateChunkGeometry(chunkX, chunkZ, modifications) {
        const key = `${chunkX/CONFIG.TERRAIN.chunkSize},${chunkZ/CONFIG.TERRAIN.chunkSize}`;
        const mesh = this.terrainChunks.get(key);
        if (!mesh) {
            console.warn(`Chunk ${key} not found for update, queuing load`);
            this.addTerrainChunk({ chunkX, chunkZ, seed: 12345, modifications });
            return;
        }

        const geometry = mesh.geometry;
        const positions = geometry.attributes.position.array;
        const pointsToCalculate = [];
        for (let i = 0; i < positions.length; i += 3) {
            const px = chunkX + positions[i];
            const pz = chunkZ + positions[i + 2];
            pointsToCalculate.push({ x: px, z: pz, index: i });
        }
        this.chunkModifications.set(key, modifications);
        if (this.terrainWorker) {
            const batchId = `${chunkX},${chunkZ}_update_${Date.now()}`; // CHANGED: Unique batchId with timestamp
            this.pendingChunks.set(batchId, { geometry, x: chunkX, z: chunkZ });
            this.terrainWorker.postMessage({
                type: 'applyModifications',
                data: { points: pointsToCalculate, batchId, mods: modifications }
            });
        } else {
            console.warn('Terrain worker not available, updating geometry in main thread');
            const perlin = new OptimizedPerlin(12345);
            const normals = geometry.attributes.normal.array;
            const eps = 0.1;
            for (let i = 0; i < pointsToCalculate.length; i++) {
                const { x, z, index } = pointsToCalculate[i];
                let h = this.calculateBaseHeight(x, z, perlin);
                modifications.forEach(mod => {
                    h += this.getDelta(mod, x, z);
                });
                const hL = this.calculateBaseHeight(x - eps, z, perlin) + modifications.reduce((sum, mod) => sum + this.getDelta(mod, x - eps, z), 0);
                const hR = this.calculateBaseHeight(x + eps, z, perlin) + modifications.reduce((sum, mod) => sum + this.getDelta(mod, x + eps, z), 0);
                const hD = this.calculateBaseHeight(x, z - eps, perlin) + modifications.reduce((sum, mod) => sum + this.getDelta(mod, x, z - eps), 0);
                const hU = this.calculateBaseHeight(x, z + eps, perlin) + modifications.reduce((sum, mod) => sum + this.getDelta(mod, x, z + eps), 0);
                const nx = hL - hR;
                const ny = 2 * eps;
                const nz = hD - hU;
                const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
                positions[index + 1] = h;
                normals[index] = nx / len;
                normals[index + 1] = ny / len;
                normals[index + 2] = nz / len;
                this.heightCache.set(`${x},${z}`, h);
                this.normalCache.set(`${x},${z}`, { x: nx / len, y: ny / len, z: nz / len });
            }
            geometry.attributes.position.needsUpdate = true;
            geometry.attributes.normal.needsUpdate = true;
        }
        // CHANGED: Clear cache in edit radius for this chunk
        if (modifications.length > 0) {
            const lastMod = modifications[modifications.length - 1];
            if (lastMod) {
                Utilities.clearCacheInRadius(this.heightCache, lastMod.x, lastMod.z, CONFIG.TERRAIN_EDIT.RADIUS);
                Utilities.clearCacheInRadius(this.normalCache, lastMod.x, lastMod.z, CONFIG.TERRAIN_EDIT.RADIUS);
            }
        }
    }

    calculateBaseHeight(x, z, perlin) {
        let base = 0, amp = 1, freq = 0.02;
        for (let o = 0; o < 3; o++) { base += perlin.noise(x * freq, z * freq, 10 + o * 7) * amp; amp *= 0.5; freq *= 2; }
        let maskRaw = perlin.noise(x * 0.006, z * 0.006, 400);
        let mask = Math.pow((maskRaw + 1) * 0.5, 3);
        let mountain = 0; amp = 1; freq = 0.04;
        for (let o = 0; o < 4; o++) { mountain += Math.abs(perlin.noise(x * freq, z * freq, 500 + o * 11)) * amp; amp *= 0.5; freq *= 2; }
        mountain *= 40 * mask;
        const elevNorm = clamp((base + mountain + 2) / 25, 0, 1);
        let jagged = perlin.noise(x * 0.8, z * 0.8, 900) * 1.2 * elevNorm + perlin.noise(x * 1.6, z * 1.6, 901) * 0.6 * elevNorm;
        return base + mountain + jagged;
    }

    getDelta(mod, px, pz) {
        const distSq = (px - mod.x) ** 2 + (pz - mod.z) ** 2;
        const dist = Math.sqrt(distSq);
        if (dist > mod.radius) return 0;
        const falloff = Math.exp(-distSq / (2 * mod.radius ** 2));
        return mod.heightDelta * falloff;
    }

    finishTerrainChunk(geometry, x, z) {
        const key = `${x/CONFIG.TERRAIN.chunkSize},${z/CONFIG.TERRAIN.chunkSize}`;
        // CHANGED: Ensure no duplicate meshes by checking if chunk exists
        let mesh = this.terrainChunks.get(key);
        if (mesh) {
            // Update existing mesh's geometry
            mesh.geometry.dispose();
            mesh.geometry = geometry;
            console.log(`Updated mesh for chunk ${key}`);
        } else {
            // Create new mesh
            mesh = new THREE.Mesh(geometry, this.terrainMaterial);
            mesh.position.set(x, 0, z);
            this.scene.add(mesh);
            this.terrainChunks.set(key, mesh);
            console.log(`Added new mesh for chunk ${key}`);
        }
    }

    removeTerrainChunk({ chunkX, chunkZ }) {
        const chunkKey = `${chunkX/CONFIG.TERRAIN.chunkSize},${chunkZ/CONFIG.TERRAIN.chunkSize}`;
        const mesh = this.terrainChunks.get(chunkKey);
        if (mesh) {
            this.scene.remove(mesh);
            if (mesh.geometry) {
                mesh.geometry.dispose();
            }
            this.terrainChunks.delete(chunkKey);
            this.chunkModifications.delete(chunkKey);
            // CHANGED: Clear caches for removed chunk
            const chunkSize = CONFIG.TERRAIN.chunkSize;
            const keysToDelete = [];
            for (const key of this.heightCache.keys()) {
                const [x, z] = key.split(',').map(Number);
                if (Math.floor(x / chunkSize) === chunkX / chunkSize && Math.floor(z / chunkSize) === chunkZ / chunkSize) {
                    keysToDelete.push(key);
                }
            }
            keysToDelete.forEach(key => {
                this.heightCache.delete(key);
                this.normalCache.delete(key);
            });
        }
    }

    getHeightAtPosition(x, z) {
        const key = `${x},${z}`;
        if (this.heightCache.has(key)) return this.heightCache.get(key);

        const chunkX = Math.floor(x / CONFIG.TERRAIN.chunkSize) * CONFIG.TERRAIN.chunkSize;
        const chunkZ = Math.floor(z / CONFIG.TERRAIN.chunkSize) * CONFIG.TERRAIN.chunkSize;
        const chunkKey = `${chunkX/CONFIG.TERRAIN.chunkSize},${chunkZ/CONFIG.TERRAIN.chunkSize}`;
        const modifications = this.chunkModifications.get(chunkKey) || [];

        let height = this.heightCache.get(key);
        if (!height) {
            // Fallback to main-thread calculation
            const perlin = new OptimizedPerlin(12345);
            height = this.calculateBaseHeight(x, z, perlin);
        }

        // Apply modifications
        modifications.forEach(mod => {
            const distSq = (x - mod.x) ** 2 + (z - mod.z) ** 2;
            const dist = Math.sqrt(distSq);
            if (dist <= mod.radius) {
                const falloff = Math.exp(-distSq / (2 * mod.radius ** 2));
                height += mod.heightDelta * falloff;
            }
        });

        this.heightCache.set(key, height);
        Utilities.limitCacheSize(this.heightCache, CONFIG.PERFORMANCE.maxCacheSize);
        return height;
    }
}
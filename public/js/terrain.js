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

export function initializeTerrain(scene) {
    const terrainChunks = new Map();
    let terrainMaterial = null;
    let terrainWorker = null;
    const pendingChunks = new Map();
    const textures = initializeTextures();

    function initializeTextures() {
        const size = CONFIG.GRAPHICS.textureSize;
        const textures = {};
        textures.dirt = createProceduralTexture({ r: 101, g: 67, b: 33 }, { r: 139, g: 90, b: 43 }, size);
        textures.grass = createProceduralTexture({ r: 34, g: 139, b: 34 }, { r: 0, g: 100, b: 0 }, size);
        textures.rock = createProceduralTexture({ r: 105, g: 105, b: 105 }, { r: 128, g: 128, b: 128 }, size);
        textures.snow = createProceduralTexture({ r: 255, g: 250, b: 250 }, { r: 240, g: 248, b: 255 }, size);
        return textures;
    }

    function createProceduralTexture(color1, color2, size) {
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

    function initialize() {
        try {
            terrainWorker = new Worker('/js/workers/terrainWorker.js', { type: 'module' });
            terrainWorker.onmessage = handleWorkerMessage;
            terrainWorker.onerror = (error) => {
                console.error('Terrain worker error:', error);
                // Fallback: Generate flat terrain for pending chunks
                pendingChunks.forEach(({ geometry, chunkX, chunkZ }, batchId) => {
                    console.warn(`Falling back to flat terrain for chunk (${chunkX}, ${chunkZ})`);
                    geometry.attributes.position.needsUpdate = true;
                    geometry.computeVertexNormals();
                    finishTerrainChunk(geometry, chunkX, chunkZ);
                    pendingChunks.delete(batchId);
                });
            };
        } catch (error) {
            console.error('Failed to initialize terrain worker:', error);
        }

        terrainMaterial = new THREE.ShaderMaterial({
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
                    vec2 texCoord = vWorldPosition.xz * 0.1;
                    vec3 dirtColor = texture2D(uDirt, texCoord).rgb;
                    vec3 grassColor = texture2D(uGrass, texCoord).rgb;
                    vec3 rockColor = texture2D(uRock, texCoord).rgb;
                    vec3 snowColor = texture2D(uSnow, texCoord).rgb;
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
                uDirt: { value: textures.dirt },
                uGrass: { value: textures.grass },
                uRock: { value: textures.rock },
                uSnow: { value: textures.snow },
                uLightDir: { value: new THREE.Vector3(1, 1, 1).normalize() }
            },
            side: THREE.FrontSide
        });
    }

    function handleWorkerMessage(e) {
        const { type, data } = e.data;
        if (type === 'heightBatchResult') {
            const { results, batchId } = data;
            const pending = pendingChunks.get(batchId);
            if (!pending) {
                console.warn(`No pending chunk for batchId ${batchId}`);
                return;
            }
            const { geometry, chunkX, chunkZ } = pending;
            const positions = geometry.attributes.position.array;
            for (let i = 0; i < results.length; i++) {
                const { height, index } = results[i];
                positions[index + 1] = height;
            }
            geometry.attributes.position.needsUpdate = true;
            geometry.computeVertexNormals();
            finishTerrainChunk(geometry, chunkX, chunkZ);
            pendingChunks.delete(batchId);
        }
    }

    async function addTerrainChunk({ chunkX = 0, chunkZ = 0, seed = 0 }) {
        const chunkIndexX = Math.floor(chunkX / CONFIG.TERRAIN.chunkSize);
        const chunkIndexZ = Math.floor(chunkZ / CONFIG.TERRAIN.chunkSize);
        const key = `${chunkIndexX},${chunkIndexZ}`;
        if (terrainChunks.has(key)) {
            return;
        }
        console.log(`Creating terrain chunk at (${chunkX}, ${chunkZ}) with seed ${seed}`);
        let chunkData = { seed };
        try {
            const response = await fetch('/chunkA.JSON');
            if (response.ok) {
                chunkData = await response.json();
                console.log(`Loaded chunk data for chunkA.JSON:`, chunkData);
            } else {
                console.warn(`No chunkA.JSON found, using default seed ${seed}`);
            }
        } catch (error) {
            console.error(`Failed to fetch chunkA.JSON: ${error}`);
        }

        const geometry = new THREE.PlaneGeometry(
            CONFIG.TERRAIN.chunkSize,
            CONFIG.TERRAIN.chunkSize,
            CONFIG.TERRAIN.segments,
            CONFIG.TERRAIN.segments
        );
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
        if (pointsToCalculate.length > 0 && terrainWorker) {
            const batchId = key;
            pendingChunks.set(batchId, { geometry, chunkX, chunkZ });
            terrainWorker.postMessage({
                type: 'calculateHeightBatch',
                data: { points: pointsToCalculate, batchId, seed: chunkData.seed || seed }
            });
        } else {
            console.warn(`No terrain worker or points, using flat terrain for (${chunkX}, ${chunkZ})`);
            geometry.attributes.position.needsUpdate = true;
            geometry.computeVertexNormals();
            finishTerrainChunk(geometry, chunkX, chunkZ);
        }
    }

    function finishTerrainChunk(geometry, chunkX, chunkZ) {
        const chunkIndexX = Math.floor(chunkX / CONFIG.TERRAIN.chunkSize);
        const chunkIndexZ = Math.floor(chunkZ / CONFIG.TERRAIN.chunkSize);
        const key = `${chunkIndexX},${chunkIndexZ}`;
        const mesh = new THREE.Mesh(geometry, terrainMaterial);
        mesh.position.set(chunkX, 0, chunkZ);
        scene.add(mesh);
        terrainChunks.set(key, mesh);
        console.log(`Added terrain chunk at (${chunkX}, ${chunkZ})`);
    }

    function removeTerrainChunk({ chunkX, chunkZ }) {
        const chunkIndexX = Math.floor(chunkX / CONFIG.TERRAIN.chunkSize);
        const chunkIndexZ = Math.floor(chunkZ / CONFIG.TERRAIN.chunkSize);
        const key = `${chunkIndexX},${chunkIndexZ}`;
        const mesh = terrainChunks.get(key);
        if (mesh) {
            scene.remove(mesh);
            mesh.geometry.dispose();
            terrainChunks.delete(key);
            console.log(`Removed chunk at (${chunkIndexX}, ${chunkIndexZ})`);
        }
    }

    function clearChunks() {
        terrainChunks.forEach((mesh) => {
            scene.remove(mesh);
            mesh.geometry.dispose();
        });
        terrainChunks.clear();
        if (terrainMaterial) {
            terrainMaterial.dispose();
            Object.values(textures).forEach(tex => tex.dispose());
        }
        if (terrainWorker) {
            terrainWorker.terminate();
        }
    }

    initialize();
    return { addTerrainChunk, removeTerrainChunk, terrainChunks, clearChunks };
}
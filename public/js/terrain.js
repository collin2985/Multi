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

export function SimpleTerrainRenderer(scene) {

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

    function createProceduralTexture(c1, c2, size) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        const imageData = context.createImageData(size, size);
        const data = imageData.data;
        const color1 = new THREE.Color(`rgb(${c1.r}, ${c1.g}, ${c1.b})`);
        const color2 = new THREE.Color(`rgb(${c2.r}, ${c2.g}, ${c2.b})`);

        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                const i = (x + y * size) * 4;
                const blend = Math.random() * 0.4 + 0.6;
                const r = Math.floor(color1.r * 255 * blend + color2.r * 255 * (1 - blend));
                const g = Math.floor(color1.g * 255 * blend + color2.g * 255 * (1 - blend));
                const b = Math.floor(color1.b * 255 * blend + color2.b * 255 * (1 - blend));
                data[i] = r;
                data[i + 1] = g;
                data[i + 2] = b;
                data[i + 3] = 255;
            }
        }
        context.putImageData(imageData, 0, 0);
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(CONFIG.GRAPHICS.textureRepeat, CONFIG.GRAPHICS.textureRepeat);
        texture.anisotropy = 16;
        return texture;
    }

    function createMaterial(height) {
        if (height < 0.2) return textures.dirt;
        if (height < 0.5) return textures.grass;
        if (height < 0.8) return textures.rock;
        return textures.snow;
    }

    function initializeTerrainWorker(seed) {
        terrainWorker = new Worker('js/terrainWorker.js');
        terrainWorker.onmessage = function(e) {
            const { type, data } = e.data;
            if (type === 'heightBatchResult') {
                processHeightBatch(data);
            }
        };
        terrainWorker.onerror = function(e) {
            console.error('Terrain worker error:', e);
            // This is a placeholder, you should handle the error more gracefully.
        };
    }

    function processHeightBatch(data) {
        const { results, batchId } = data;
        const chunkData = pendingChunks.get(batchId);
        if (!chunkData) return;

        const { geometry, chunkX, chunkZ, positionMap, resolve } = chunkData;

        for (const { height, index } of results) {
            if (geometry.attributes.position.array[index * 3 + 1] !== undefined) {
                geometry.attributes.position.array[index * 3 + 1] = height;
                const pos = geometry.attributes.position.array;
                const uv = geometry.attributes.uv.array;
                const materialIndex = Math.floor(height * 4); // Simple index based on height
                uv[index * 2] = pos[index * 3] / CONFIG.GRAPHICS.textureSize;
                uv[index * 2 + 1] = pos[index * 3 + 2] / CONFIG.GRAPHICS.textureSize;
            }
        }
        geometry.attributes.position.needsUpdate = true;
        geometry.computeVertexNormals();

        const terrainMaterial = new THREE.MeshStandardMaterial({
            map: textures.dirt,
            side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geometry, terrainMaterial);
        mesh.position.set(chunkX, 0, chunkZ);
        scene.add(mesh);
        terrainChunks.set(`${chunkX},${chunkZ}`, mesh);
        pendingChunks.delete(batchId);
        resolve();
    }

    function loadTerrainChunk({ chunkX, chunkZ, seed }) {
        const key = `${chunkX},${chunkZ}`;
        if (terrainChunks.has(key) || pendingChunks.has(key)) return;

        return new Promise((resolve) => {
            const geometry = new THREE.PlaneGeometry(
                CONFIG.TERRAIN.chunkSize,
                CONFIG.TERRAIN.chunkSize,
                CONFIG.TERRAIN.segments,
                CONFIG.TERRAIN.segments
            );
            const positions = geometry.attributes.position.array;
            const points = [];
            const positionMap = new Map();

            for (let i = 0; i < positions.length / 3; i++) {
                const x = positions[i * 3];
                const z = positions[i * 3 + 2];
                points.push({ x, z, index: i });
                positionMap.set(JSON.stringify({ x, z }), i);
            }

            const batchId = key;
            pendingChunks.set(batchId, { geometry, chunkX, chunkZ, positionMap, resolve });
            
            terrainWorker.postMessage({
                type: 'calculateHeightBatch',
                data: {
                    points,
                    batchId,
                    seed
                }
            });
        });
    }

    function removeTerrainChunk({ chunkX, chunkZ }) {
        const key = `${chunkX},${chunkZ}`;
        const mesh = terrainChunks.get(key);
        if (mesh) {
            scene.remove(mesh);
            mesh.geometry.dispose();
            terrainChunks.delete(key);
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
    }

    initializeTerrainWorker();

    return { loadTerrainChunk, removeTerrainChunk, clearChunks };
}
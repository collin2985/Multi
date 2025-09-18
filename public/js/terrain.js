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

    function createProceduralTexture(color1, color2, size) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        context.fillStyle = `rgb(${color1.r}, ${color1.g}, ${color1.b})`;
        context.fillRect(0, 0, size, size);
        context.fillStyle = `rgb(${color2.r}, ${color2.g}, ${color2.b})`;
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                if (Math.random() < 0.1) {
                    context.fillRect(i, j, 1, 1);
                }
            }
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(CONFIG.GRAPHICS.textureRepeat, CONFIG.GRAPHICS.textureRepeat);
        return texture;
    }

    function getTerrainMaterial() {
        if (!terrainMaterial) {
            terrainMaterial = new THREE.MeshLambertMaterial({
                vertexColors: true,
                transparent: false
            });
        }
        return terrainMaterial;
    }

    function initializeWorker() {
        if (!terrainWorker) {
            terrainWorker = new Worker('terrainWorker.js');
            terrainWorker.onmessage = handleWorkerMessage;
            terrainWorker.onerror = handleWorkerError;
        }
    }
    
    function handleWorkerMessage(e) {
        const { type, data } = e.data;
        if (type === 'heightBatchResult') {
            const { results, batchId } = data;
            const pending = pendingChunks.get(batchId);
            if (!pending) return;

            const { geometry, positionMap, resolve } = pending;
            const positions = geometry.attributes.position.array;
            const colors = geometry.attributes.color.array;
            const { grass, dirt, rock, snow } = textures;

            results.forEach(({ height, index }) => {
                positions[index * 3 + 1] = height;

                let color = dirt;
                if (height > 5) {
                    color = snow;
                } else if (height > 2) {
                    color = rock;
                } else if (height > 0.5) {
                    color = grass;
                }

                colors[index * 3] = color.image.data[0] / 255;
                colors[index * 3 + 1] = color.image.data[1] / 255;
                colors[index * 3 + 2] = color.image.data[2] / 255;
            });

            geometry.attributes.position.needsUpdate = true;
            geometry.computeVertexNormals();

            const mesh = new THREE.Mesh(geometry, getTerrainMaterial());
            mesh.position.set(pending.chunkX * CONFIG.TERRAIN.chunkSize, 0, pending.chunkZ * CONFIG.TERRAIN.chunkSize);
            mesh.receiveShadow = true;
            scene.add(mesh);
            terrainChunks.set(batchId, mesh);
            pendingChunks.delete(batchId);
            resolve(mesh);
        }
    }
    
    function handleWorkerError(e) {
        console.error('Terrain worker error:', e);
    }

    function addTerrainChunk({ chunkX, chunkZ, seed = 0 }) {
        initializeWorker();

        const key = `${chunkX},${chunkZ}`;
        if (terrainChunks.has(key) || pendingChunks.has(key)) {
            console.log(`Chunk ${key} already exists or is pending.`);
            return;
        }

        return new Promise(resolve => {
            const geometry = new THREE.PlaneGeometry(
                CONFIG.TERRAIN.chunkSize,
                CONFIG.TERRAIN.chunkSize,
                CONFIG.TERRAIN.segments,
                CONFIG.TERRAIN.segments
            );
            geometry.rotateX(-Math.PI / 2);
            geometry.attributes.position.needsUpdate = true;
            geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3));

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
        if (terrainWorker) {
            terrainWorker.terminate();
            terrainWorker = null;
        }
    }

    return {
        addTerrainChunk,
        removeTerrainChunk,
        clearChunks,
        getLoadedChunks: () => Array.from(terrainChunks.keys()) // This function was missing but is useful for debugging/state management.
    };
}
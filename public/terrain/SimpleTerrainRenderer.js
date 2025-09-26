import * as THREE from 'three';
import { HeightCalculator } from './heightGeneration/HeightCalculator.js';
import { TerrainMaterialFactory } from './materials/TerrainMaterialFactory.js';
import { TerrainWorkerManager } from './workers/TerrainWorkerManager.js';
import { CONFIG } from './config.js';
import { Utilities } from './utilities.js';

export class SimpleTerrainRenderer {
    constructor(scene) {
        this.scene = scene;
        this.chunkMap = new Map(); // Store chunks with key: `${gridX},${gridZ}`
        this.heightCalculator = new HeightCalculator(12345); // Matches terrainSeed from game.js
        this.workerManager = new TerrainWorkerManager();
        this.material = null;
        this.textures = null;
        this.waterRenderer = null; // Reference to WaterRenderer for integration
        this.init();
    }

    init() {
        // Initialize terrain material and textures
        this.material = TerrainMaterialFactory.createTerrainMaterial();
        this.textures = TerrainMaterialFactory.createProceduralTextures();
        this.material.uniforms.uDirt.value = this.textures.dirt;
        this.material.uniforms.uGrass.value = this.textures.grass;
        this.material.uniforms.uRock.value = this.textures.rock;
        this.material.uniforms.uRock2.value = this.textures.rock2;
        this.material.uniforms.uSnow.value = this.textures.snow;
        this.material.uniforms.uSand.value = this.textures.sand;
    }

    // Set reference to WaterRenderer for synchronized chunk management
    setWaterRenderer(waterRenderer) {
        this.waterRenderer = waterRenderer;
    }

    // Create a terrain chunk at world coordinates (chunkX, chunkZ)
    createChunk(chunkX, chunkZ) {
        const chunkSize = CONFIG.TERRAIN.chunkSize; // 50
        const segments = CONFIG.TERRAIN.segments; // 100
        const key = `${Math.floor(chunkX / chunkSize)},${Math.floor(chunkZ / chunkSize)}`;

        if (this.chunkMap.has(key)) {
            return; // Chunk already exists
        }

        const geometry = new THREE.PlaneGeometry(chunkSize, chunkSize, segments, segments);
        geometry.rotateX(-Math.PI / 2); // Align with XZ plane

        // Calculate heights and normals using worker
        const points = [];
        const verticesPerRow = segments + 1;
        for (let z = 0; z <= segments; z++) {
            for (let x = 0; x <= segments; x++) {
                const worldX = chunkX + (x / segments - 0.5) * chunkSize;
                const worldZ = chunkZ + (z / segments - 0.5) * chunkSize;
                points.push({ x: worldX, z: worldZ, index: z * verticesPerRow + x });
            }
        }

        const batchId = `${chunkX},${chunkZ}_${Date.now()}`;
        this.workerManager.calculateHeightBatch(points, batchId, ({ results }) => {
            const position = geometry.attributes.position;
            const normal = geometry.attributes.normal;

            results.forEach(({ height, normal: n, index }) => {
                position.array[index * 3 + 1] = height; // Set Y to terrain height
                normal.array[index * 3] = n.x;
                normal.array[index * 3 + 1] = n.y;
                normal.array[index * 3 + 2] = n.z;
            });

            geometry.computeVertexNormals(); // Ensure smooth normals
            position.needsUpdate = true;
            normal.needsUpdate = true;

            const mesh = new THREE.Mesh(geometry, this.material);
            mesh.position.set(chunkX, 0, chunkZ);
            this.scene.add(mesh);

            this.chunkMap.set(key, { mesh, geometry });
            // Add corresponding water chunk
            if (this.waterRenderer) {
                this.waterRenderer.addWaterChunk(chunkX, chunkZ);
            }
        });
    }

    // Dispose of a chunk by its key (grid coordinates)
    disposeChunk(key) {
        const chunk = this.chunkMap.get(key);
        if (chunk) {
            this.scene.remove(chunk.mesh);
            chunk.geometry.dispose();
            this.chunkMap.delete(key);
            // Remove corresponding water chunk
            if (this.waterRenderer) {
                const [chunkX, chunkZ] = key.split(',').map(Number);
                const worldX = chunkX * CONFIG.TERRAIN.chunkSize;
                const worldZ = chunkZ * CONFIG.TERRAIN.chunkSize;
                this.waterRenderer.removeWaterChunk(worldX, worldZ);
            }
        }
    }

    // Get terrain height at a specific world coordinate
    getTerrainHeightAt(x, z) {
        return this.heightCalculator.calculateHeight(x, z);
    }

    // Clean up all chunks and resources
    dispose() {
        this.chunkMap.forEach((chunk, key) => {
            this.scene.remove(chunk.mesh);
            chunk.geometry.dispose();
        });
        this.chunkMap.clear();
        this.material.dispose();
        Object.values(this.textures).forEach(texture => texture.dispose());
        this.workerManager.terminate();
        if (this.waterRenderer) {
            this.waterRenderer.dispose();
        }
    }
}
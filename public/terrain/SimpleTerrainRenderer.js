// terrain/SimpleTerrainRenderer.js
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { TerrainWorkerManager } from './workers/TerrainWorkerManager.js';
import { TerrainMaterialFactory } from './materials/TerrainMaterialFactory.js';
import { Utilities } from './utilities.js';

export class SimpleTerrainRenderer {
    constructor(scene, workerManager = null, terrainMaterial = null) {
        this.scene = scene;
        this.terrainChunks = new Map();
        this.heightCache = new Map();
        this.normalCache = new Map();
        this.workerManager = workerManager || new TerrainWorkerManager();
        this.terrainMaterial = terrainMaterial || TerrainMaterialFactory.createTerrainMaterial();
        this.waterRenderer = null; // NEW: Reference to waterRenderer
    }

    // NEW: Set waterRenderer reference
    setWaterRenderer(waterRenderer) {
        this.waterRenderer = waterRenderer;
    }

    addTerrainChunk({ chunkX, chunkZ, seed }) {
    // FIX: Make sure we're consistent about what chunkX/chunkZ represent
    // They should be GRID positions (0, 1, 2, etc.), not world coordinates
    const chunkSize = CONFIG.TERRAIN.chunkSize;
    const worldX = chunkX * chunkSize; // Convert grid to world position
    const worldZ = chunkZ * chunkSize;
    
    const key = `${chunkX},${chunkZ}`; // Use grid coordinates for key
    if (this.terrainChunks.has(key)) return;

    const geometry = new THREE.PlaneGeometry(
        chunkSize,
        chunkSize,
        CONFIG.TERRAIN.segments,
        CONFIG.TERRAIN.segments
    );
    geometry.rotateX(-Math.PI / 2);
    const chunk = new THREE.Mesh(geometry, this.terrainMaterial);
    chunk.position.set(worldX, 0, worldZ); // Use world coordinates for positioning
    chunk.name = `terrain_${key}`;
    this.scene.add(chunk);
    this.terrainChunks.set(key, chunk);

    // Generate points for height calculation using world coordinates
    const points = [];
    const vertices = chunk.geometry.attributes.position.array;
    for (let i = 0; i < vertices.length; i += 3) {
        const x = vertices[i] + worldX; // Add world offset
        const z = vertices[i + 2] + worldZ;
        points.push({ x, z, index: i / 3 });
    }

    const batchId = `${key}_${Date.now()}`;
    this.workerManager.calculateHeightBatch(points, batchId, (result) => {
        this.handleHeightBatchResult(result, chunk, key, seed);
    });

    // Update water renderer to use world coordinates too
    if (this.waterRenderer) {
        this.waterRenderer.addWaterChunk(worldX, worldZ);
    }
}

   handleHeightBatchResult(result, chunk, key, seed) {
    if (!this.terrainChunks.has(key)) return;

    const vertices = chunk.geometry.attributes.position.array;
    
    // FIX: The worker returns result.results, not result.heights
    for (let i = 0; i < result.results.length; i++) {
        const resultData = result.results[i];
        const vertexIndex = resultData.index || i; // Use index if provided, otherwise use i
        const arrayIndex = vertexIndex * 3; // Each vertex has x,y,z components
        
        // Update the vertex height
        vertices[arrayIndex + 1] = resultData.height;
        
        // Cache the height and normal
        const cacheKey = `${resultData.x.toFixed(2)},${resultData.z.toFixed(2)}`;
        this.heightCache.set(cacheKey, resultData.height);
        
        if (resultData.normal) {
            this.normalCache.set(cacheKey, new THREE.Vector3(
                resultData.normal.x, 
                resultData.normal.y, 
                resultData.normal.z
            ));
        }
    }
    
    chunk.geometry.attributes.position.needsUpdate = true;
    chunk.geometry.computeVertexNormals();

    Utilities.limitCacheSize(this.heightCache, CONFIG.PERFORMANCE.maxCacheSize);
    Utilities.limitCacheSize(this.normalCache, CONFIG.PERFORMANCE.maxCacheSize);
}

    removeTerrainChunk({ chunkX, chunkZ }) {
        const key = `${chunkX},${chunkZ}`;
        const chunk = this.terrainChunks.get(key);
        if (chunk) {
            this.scene.remove(chunk);
            chunk.geometry.dispose();
            this.terrainChunks.delete(key);

            // NEW: Remove corresponding water chunk
            if (this.waterRenderer) {
                this.waterRenderer.removeWaterChunk(chunkX * CONFIG.TERRAIN.chunkSize, chunkZ * CONFIG.TERRAIN.chunkSize);
            }

            // Clean up cache
            const chunkSize = CONFIG.TERRAIN.chunkSize;
            const vertices = chunk.geometry.attributes.position.array;
            for (let i = 0; i < vertices.length; i += 3) {
                const x = vertices[i] + chunk.position.x;
                const z = vertices[i + 2] + chunk.position.z;
                const cacheKey = `${x.toFixed(2)},${z.toFixed(2)}`;
                this.heightCache.delete(cacheKey);
                this.normalCache.delete(cacheKey);
            }
        }
    }

    getTerrainHeightAt(x, z) {
        const cacheKey = `${x.toFixed(2)},${z.toFixed(2)}`;
        if (this.heightCache.has(cacheKey)) {
            return this.heightCache.get(cacheKey);
        }

        const chunkX = Math.floor(x / CONFIG.TERRAIN.chunkSize);
        const chunkZ = Math.floor(z / CONFIG.TERRAIN.chunkSize);
        const key = `${chunkX},${chunkZ}`;
        const chunk = this.terrainChunks.get(key);
        if (chunk) {
            const raycaster = new THREE.Raycaster();
            const rayOrigin = new THREE.Vector3(x, 1000, z);
            const rayDirection = new THREE.Vector3(0, -1, 0);
            raycaster.set(rayOrigin, rayDirection);
            const intersects = raycaster.intersectObject(chunk, false);
            if (intersects.length > 0) {
                const height = intersects[0].point.y;
                this.heightCache.set(cacheKey, height);
                Utilities.limitCacheSize(this.heightCache, CONFIG.PERFORMANCE.maxCacheSize);
                return height;
            }
        }

        const height = this.workerManager.fallbackCalculator.calculateHeight(x, z);
        this.heightCache.set(cacheKey, height);
        Utilities.limitCacheSize(this.heightCache, CONFIG.PERFORMANCE.maxCacheSize);
        return height;
    }

    getTerrainNormalAt(x, z) {
        const cacheKey = `${x.toFixed(2)},${z.toFixed(2)}`;
        if (this.normalCache.has(cacheKey)) {
            return this.normalCache.get(cacheKey);
        }

        const chunkX = Math.floor(x / CONFIG.TERRAIN.chunkSize);
        const chunkZ = Math.floor(z / CONFIG.TERRAIN.chunkSize);
        const key = `${chunkX},${chunkZ}`;
        const chunk = this.terrainChunks.get(key);
        if (chunk) {
            const raycaster = new THREE.Raycaster();
            const rayOrigin = new THREE.Vector3(x, 1000, z);
            const rayDirection = new THREE.Vector3(0, -1, 0);
            raycaster.set(rayOrigin, rayDirection);
            const intersects = raycaster.intersectObject(chunk, false);
            if (intersects.length > 0) {
                const normal = intersects[0].face.normal.clone();
                chunk.localToWorld(normal);
                this.normalCache.set(cacheKey, normal);
                Utilities.limitCacheSize(this.normalCache, CONFIG.PERFORMANCE.maxCacheSize);
                return normal;
            }
        }

        const normal = this.workerManager.fallbackCalculator.calculateNormal(x, z);
        this.normalCache.set(cacheKey, normal);
        Utilities.limitCacheSize(this.normalCache, CONFIG.PERFORMANCE.maxCacheSize);
        return normal;
    }

    dispose() {
    // Clean up terrain chunks
    this.terrainChunks.forEach((chunk, key) => {
        this.scene.remove(chunk);
        chunk.geometry.dispose();
        if (chunk.material && chunk.material !== this.terrainMaterial) {
            chunk.material.dispose(); // Only dispose if it's not the shared material
        }
    });
    this.terrainChunks.clear();
    
    // Clear caches more aggressively
    this.heightCache.clear();
    this.normalCache.clear();
    
    // Dispose shared material and its textures
    if (this.terrainMaterial) {
        // Dispose textures first
        Object.values(this.terrainMaterial.uniforms).forEach(uniform => {
            if (uniform.value && uniform.value.dispose) {
                uniform.value.dispose();
            }
        });
        this.terrainMaterial.dispose();
    }
    
    // Terminate worker
    if (this.workerManager) {
        this.workerManager.terminate();
    }

    // Clean up water chunks
    if (this.waterRenderer) {
        this.waterRenderer.dispose(); // Make sure WaterRenderer has this method
    }
}
}
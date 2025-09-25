// SimpleTerrainRenderer.js
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
        this.terrainMaterial = terrainMaterial || new TerrainMaterialFactory().createMaterial();
        this.waterRenderer = null; // NEW: Reference to waterRenderer
    }

    // NEW: Set waterRenderer reference
    setWaterRenderer(waterRenderer) {
        this.waterRenderer = waterRenderer;
    }

    addTerrainChunk({ chunkX, chunkZ, seed }) {
        const key = `${chunkX},${chunkZ}`;
        if (this.terrainChunks.has(key)) return;

        const geometry = new THREE.PlaneGeometry(
            CONFIG.TERRAIN.chunkSize,
            CONFIG.TERRAIN.chunkSize,
            CONFIG.TERRAIN.segments,
            CONFIG.TERRAIN.segments
        );
        geometry.rotateX(-Math.PI / 2);
        const chunk = new THREE.Mesh(geometry, this.terrainMaterial);
        chunk.position.set(
            chunkX * CONFIG.TERRAIN.chunkSize,
            0,
            chunkZ * CONFIG.TERRAIN.chunkSize
        );
        chunk.name = `terrain_${key}`;
        this.scene.add(chunk);
        this.terrainChunks.set(key, chunk);

        const points = [];
        const vertices = chunk.geometry.attributes.position.array;
        for (let i = 0; i < vertices.length; i += 3) {
            const x = vertices[i] + chunk.position.x;
            const z = vertices[i + 2] + chunk.position.z;
            points.push({ x, z });
        }

        const batchId = `${key}_${Date.now()}`;
        this.workerManager.calculateHeightBatch(points, batchId, (result) => {
            this.handleHeightBatchResult(result, chunk, key, seed);
        });

        // NEW: Add corresponding water chunk
        if (this.waterRenderer) {
            this.waterRenderer.addWaterChunk(chunkX * CONFIG.TERRAIN.chunkSize, chunkZ * CONFIG.TERRAIN.chunkSize);
        }
    }

    handleHeightBatchResult(result, chunk, key, seed) {
        if (!this.terrainChunks.has(key)) return;

        const vertices = chunk.geometry.attributes.position.array;
        for (let i = 0, j = 0; i < vertices.length; i += 3, j++) {
            const x = vertices[i] + chunk.position.x;
            const z = vertices[i + 2] + chunk.position.z;
            const height = result.heights[j];
            vertices[i + 1] = height;

            const cacheKey = `${x.toFixed(2)},${z.toFixed(2)}`;
            this.heightCache.set(cacheKey, height);
            if (result.normals && result.normals[j]) {
                this.normalCache.set(cacheKey, new THREE.Vector3().fromArray(result.normals[j]));
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
        this.terrainChunks.forEach((chunk, key) => {
            this.scene.remove(chunk);
            chunk.geometry.dispose();
        });
        this.terrainChunks.clear();
        this.heightCache.clear();
        this.normalCache.clear();
        this.terrainMaterial.dispose();
        this.workerManager.terminate();

        // NEW: Clean up water chunks
        if (this.waterRenderer) {
            this.waterRenderer.clearWaterChunks();
        }
    }
}
// terrain/SimpleTerrainRenderer.js - FIXED VERSION
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
        this.waterRenderer = null;
        const textures = TerrainMaterialFactory.createProceduralTextures();
        this.terrainMaterial.uniforms.uDirt.value = textures.dirt;
        this.terrainMaterial.uniforms.uGrass.value = textures.grass;
        this.terrainMaterial.uniforms.uRock.value = textures.rock;
        this.terrainMaterial.uniforms.uRock2.value = textures.rock2;
        this.terrainMaterial.uniforms.uSnow.value = textures.snow;
        this.terrainMaterial.uniforms.uSand.value = textures.sand;
    }

    setWaterRenderer(waterRenderer) {
        this.waterRenderer = waterRenderer;
    }

    /**
     * addTerrainChunk accepts either:
     *  - { gridX, gridZ, seed }  // preferred: integer chunk indices
     *  - { chunkX, chunkZ, seed } // legacy: world coords — will be converted
     */
    addTerrainChunk({ chunkX = undefined, chunkZ = undefined, gridX = undefined, gridZ = undefined, seed }) {
        const chunkSize = CONFIG.TERRAIN.chunkSize;
        const segments = CONFIG.TERRAIN.segments;

        // Normalize to grid coordinates.
        if (typeof gridX !== 'number' || typeof gridZ !== 'number') {
            if (typeof chunkX === 'number' && typeof chunkZ === 'number') {
                // chunkX/chunkZ are world coordinates -> compute grid index
                gridX = Math.floor(chunkX / chunkSize);
                gridZ = Math.floor(chunkZ / chunkSize);
            } else {
                console.warn('addTerrainChunk: expected gridX/gridZ or chunkX/chunkZ', { gridX, gridZ, chunkX, chunkZ });
                return;
            }
        }

        const key = `${gridX},${gridZ}`;
        if (this.terrainChunks.has(key)) return;

        // World position for the chunk (center)
        const worldX = gridX * chunkSize;
        const worldZ = gridZ * chunkSize;

        const geometry = new THREE.PlaneGeometry(
            chunkSize,
            chunkSize,
            segments,
            segments
        );
        geometry.rotateX(-Math.PI / 2);

        const chunk = new THREE.Mesh(geometry, this.terrainMaterial);
        chunk.position.set(worldX, 0, worldZ);
        chunk.name = `terrain_${key}`;
        this.scene.add(chunk);
        this.terrainChunks.set(key, chunk);

        // Generate points using world coordinates for seamless boundaries
        const points = this.generateChunkPoints(worldX, worldZ, segments);

        const batchId = `${key}_${Date.now()}`;
        this.workerManager.calculateHeightBatch(points, batchId, (result) => {
            this.handleHeightBatchResult(result, chunk, key, seed);
        });

        if (this.waterRenderer) {
            this.waterRenderer.addWaterChunk(worldX, worldZ);
        }
    }

    // Proper point generation for seamless boundaries
    generateChunkPoints(worldX, worldZ, segments) {
        const points = [];
        const chunkSize = CONFIG.TERRAIN.chunkSize;

        // Generate points using integer grid coordinates for exact boundary matching
        for (let i = 0; i <= segments; i++) {
            for (let j = 0; j <= segments; j++) {
                // Calculate exact world coordinates using integer grid positions
                const gridStepX = chunkSize / segments;
                const gridStepZ = chunkSize / segments;
                const worldPointX = worldX - chunkSize / 2 + (i * gridStepX);
                const worldPointZ = worldZ - chunkSize / 2 + (j * gridStepZ);

                points.push({
                    x: worldPointX,
                    z: worldPointZ,
                    index: i * (segments + 1) + j
                });
            }
        }
        return points;
    }

    handleHeightBatchResult(result, chunk, key, seed) {
        if (!this.terrainChunks.has(key)) return;

        const vertices = chunk.geometry.attributes.position.array;

        // Proper vertex indexing for correct height assignment
        for (let i = 0; i < result.results.length; i++) {
            const resultData = result.results[i];
            const vertexIndex = resultData.index;
            const arrayIndex = vertexIndex * 3;

            // Ensure we don't go out of bounds
            if (arrayIndex + 1 < vertices.length) {
                vertices[arrayIndex + 1] = resultData.height;

                // Cache with higher precision for boundary consistency
                const cacheKey = `${Math.round(resultData.x * 10000)},${Math.round(resultData.z * 10000)}`;

                this.heightCache.set(cacheKey, resultData.height);

                if (resultData.normal) {
                    this.normalCache.set(cacheKey, new THREE.Vector3(
                        resultData.normal.x,
                        resultData.normal.y,
                        resultData.normal.z
                    ));
                }
            }
        }

        chunk.geometry.attributes.position.needsUpdate = true;
        chunk.geometry.computeVertexNormals();

        Utilities.limitCacheSize(this.heightCache, CONFIG.PERFORMANCE.maxCacheSize);
        Utilities.limitCacheSize(this.normalCache, CONFIG.PERFORMANCE.maxCacheSize);
    }

    /**
     * removeTerrainChunk accepts either:
     *  - { gridX, gridZ } or
     *  - { chunkX, chunkZ } world coords
     */
    removeTerrainChunk({ chunkX = undefined, chunkZ = undefined, gridX = undefined, gridZ = undefined }) {
        const chunkSize = CONFIG.TERRAIN.chunkSize;

        if (typeof gridX !== 'number' || typeof gridZ !== 'number') {
            if (typeof chunkX === 'number' && typeof chunkZ === 'number') {
                gridX = Math.floor(chunkX / chunkSize);
                gridZ = Math.floor(chunkZ / chunkSize);
            } else {
                console.warn('removeTerrainChunk: expected gridX/gridZ or chunkX/chunkZ', { gridX, gridZ, chunkX, chunkZ });
                return;
            }
        }

        const key = `${gridX},${gridZ}`;

        const chunk = this.terrainChunks.get(key);
        if (chunk) {
            this.scene.remove(chunk);
            chunk.geometry.dispose();
            this.terrainChunks.delete(key);

            if (this.waterRenderer) {
                this.waterRenderer.removeWaterChunk(gridX * chunkSize, gridZ * chunkSize);
            }

            // Clean up cache with proper precision
            const vertices = chunk.geometry.attributes.position.array;
            for (let i = 0; i < vertices.length; i += 3) {
                const x = vertices[i] + chunk.position.x;
                const z = vertices[i + 2] + chunk.position.z;
                const cacheKey = `${Math.round(x * 10000)},${Math.round(z * 10000)}`;
                this.heightCache.delete(cacheKey);
                this.normalCache.delete(cacheKey);
            }
        }
    }

    getTerrainHeightAt(x, z) {
        const cacheKey = `${Math.round(x * 10000)},${Math.round(z * 10000)}`;
        if (this.heightCache.has(cacheKey)) {
            return this.heightCache.get(cacheKey);
        }

        const chunkSize = CONFIG.TERRAIN.chunkSize;
        const gridX = Math.floor(x / chunkSize);
        const gridZ = Math.floor(z / chunkSize);
        const key = `${gridX},${gridZ}`;
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

        // Fallback to height calculator
        const height = this.workerManager.fallbackCalculator.calculateHeight(x, z);
        this.heightCache.set(cacheKey, height);
        Utilities.limitCacheSize(this.heightCache, CONFIG.PERFORMANCE.maxCacheSize);
        return height;
    }

    getTerrainNormalAt(x, z) {
        const cacheKey = `${Math.round(x * 10000)},${Math.round(z * 10000)}`;
        if (this.normalCache.has(cacheKey)) {
            return this.normalCache.get(cacheKey);
        }

        const chunkSize = CONFIG.TERRAIN.chunkSize;
        const gridX = Math.floor(x / chunkSize);
        const gridZ = Math.floor(z / chunkSize);
        const key = `${gridX},${gridZ}`;
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
            if (chunk.material && chunk.material !== this.terrainMaterial) {
                chunk.material.dispose();
            }
        });
        this.terrainChunks.clear();

        this.heightCache.clear();
        this.normalCache.clear();

        if (this.terrainMaterial) {
            Object.values(this.terrainMaterial.uniforms).forEach(uniform => {
                if (uniform.value && uniform.value.dispose) {
                    uniform.value.dispose();
                }
            });
            this.terrainMaterial.dispose();
        }

        if (this.workerManager) {
            this.workerManager.terminate();
        }

        if (this.waterRenderer) {
            this.waterRenderer.dispose();
        }
    }
}

// terrain/SimpleTerrainRenderer.js

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Utilities } from './utilities.js';
import { TerrainWorkerManager } from './workers/TerrainWorkerManager.js';
import { TerrainMaterialFactory } from './materials/TerrainMaterialFactory.js';
import { HeightCalculator } from './heightGeneration/HeightCalculator.js'; // Added missing import

export class SimpleTerrainRenderer {
    constructor(scene) {
        this.scene = scene;
        this.terrainChunks = new Map();
        this.terrainMaterial = null;
        this.workerManager = null;
        this.pendingChunks = new Map();
        this.heightCache = new Map();
        this.normalCache = new Map();
        
        this.initialize();
    }

    initialize() {
        this.workerManager = new TerrainWorkerManager();
        this.setupMaterial();
    }

    setupMaterial() {
        this.terrainMaterial = TerrainMaterialFactory.createTerrainMaterial();
        const textures = TerrainMaterialFactory.createProceduralTextures();
        
        this.terrainMaterial.uniforms.uDirt.value = textures.dirt;
        this.terrainMaterial.uniforms.uGrass.value = textures.grass;
        this.terrainMaterial.uniforms.uRock.value = textures.rock;
        this.terrainMaterial.uniforms.uSnow.value = textures.snow;
        this.terrainMaterial.uniforms.uSand.value = textures.sand;
    }

    addTerrainChunk({ chunkX, chunkZ, seed }) {
        const key = `${chunkX / CONFIG.TERRAIN.chunkSize},${chunkZ / CONFIG.TERRAIN.chunkSize}`;
        if (this.terrainChunks.has(key)) return;

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
            
            this.workerManager.calculateHeightBatch(pointsToCalculate, batchId, (data) => {
                this.handleHeightBatchResult(data);
            });
        }
    }

    handleHeightBatchResult(data) {
        const { results, batchId } = data;
        const pending = this.pendingChunks.get(batchId);
        if (!pending) return;

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

    finishTerrainChunk(geometry, x, z) {
        const mesh = new THREE.Mesh(geometry, this.terrainMaterial);
        mesh.position.set(x, 0, z);
        this.scene.add(mesh);
        
        const chunkKey = `${x / CONFIG.TERRAIN.chunkSize},${z / CONFIG.TERRAIN.chunkSize}`;
        this.terrainChunks.set(chunkKey, mesh);
    }

    removeTerrainChunk({ chunkX, chunkZ }) {
        const chunkKey = `${chunkX / CONFIG.TERRAIN.chunkSize},${chunkZ / CONFIG.TERRAIN.chunkSize}`;
        const mesh = this.terrainChunks.get(chunkKey);
        
        if (mesh) {
            this.scene.remove(mesh);
            if (mesh.geometry) {
                mesh.geometry.dispose();
            }
            this.terrainChunks.delete(chunkKey);
        }
    }

    getHeightAtPosition(x, z) {
        const key = `${x},${z}`;
        if (this.heightCache.has(key)) {
            return this.heightCache.get(key);
        }

        // Try nearby cached values
        const ix = Math.round(x);
        const iz = Math.round(z);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const nearbyKey = `${ix + dx},${iz + dz}`;
                if (this.heightCache.has(nearbyKey)) {
                    return this.heightCache.get(nearbyKey);
                }
            }
        }

        // Fallback to raycasting
        const raycaster = new THREE.Raycaster();
        raycaster.set(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0));
        const meshes = Array.from(this.terrainChunks.values());
        const intersects = raycaster.intersectObjects(meshes, false);
        
        return intersects.length > 0 ? intersects[0].point.y : 0;
    }

    // Query terrain height for water renderer
    getTerrainHeightAt(x, z) {
        const key = `${x},${z}`;
        if (this.heightCache.has(key)) {
            return this.heightCache.get(key);
        }

        // Try nearby cached values
        const ix = Math.round(x);
        const iz = Math.round(z);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const nearbyKey = `${ix + dx},${iz + dz}`;
                if (this.heightCache.has(nearbyKey)) {
                    return this.heightCache.get(nearbyKey);
                }
            }
        }

        // Fallback to HeightCalculator
        if (!this.fallbackCalculator) {
            this.fallbackCalculator = new HeightCalculator(12345); // Match terrainSeed
        }
        const height = this.fallbackCalculator.getTerrainHeight(x, z);
        this.heightCache.set(key, height);
        Utilities.limitCacheSize(this.heightCache, CONFIG.PERFORMANCE.maxCacheSize);
        return height;
    }

    dispose() {
        // Clean up resources
        this.terrainChunks.forEach(mesh => {
            this.scene.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
        });
        
        this.terrainChunks.clear();
        this.heightCache.clear();
        this.normalCache.clear();
        this.pendingChunks.clear();
        
        if (this.terrainMaterial) {
            this.terrainMaterial.dispose();
        }
        
        if (this.workerManager) {
            this.workerManager.terminate();
        }
    }
}
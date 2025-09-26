// terrain/rendering/SimpleTerrainRenderer.js
import * as THREE from 'three';
import { TerrainWorkerManager } from './workers/TerrainWorkerManager.js';
import { CONFIG } from './config.js';

const { CHUNK_SIZE, TERRAIN_RESOLUTION } = CONFIG.TERRAIN;
const VERTICES_PER_SIDE = TERRAIN_RESOLUTION + 1;
const TOTAL_VERTICES = VERTICES_PER_SIDE * VERTICES_PER_SIDE;

// --- START FIX: Deterministic Precision Helper (Matches HeightCalculator.js) ---
const FLOAT_PRECISION = 10000.0;
const roundCoord = (coord) => Math.round(coord * FLOAT_PRECISION) / FLOAT_PRECISION;
// --- END FIX ---

export class SimpleTerrainRenderer {
    constructor(scene, seed = 12345) {
        this.scene = scene;
        this.seed = seed;
        this.workerManager = new TerrainWorkerManager();
        this.chunkMap = new Map();
        this.material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            wireframe: false,
        });
        this.batchIdCounter = 0;
    }

    // ✅ Fix chunk grid math: when creating chunks, always use integer grid indices (gridX, gridZ).
    createChunk(worldX, worldZ) {
        // Use Math.floor to ensure deterministic integer grid coordinates for the chunk
        const gridX = Math.floor(worldX / CHUNK_SIZE);
        const gridZ = Math.floor(worldZ / CHUNK_SIZE);
        const chunkId = `${gridX},${gridZ}`;

        if (this.chunkMap.has(chunkId)) {
            return this.chunkMap.get(chunkId);
        }

        // Calculate the exact world origin (bottom-left corner) based on the integer grid index
        const chunkWorldX = gridX * CHUNK_SIZE;
        const chunkWorldZ = gridZ * CHUNK_SIZE;

        const geometry = new THREE.BufferGeometry();
        // Position buffer: X, Y, Z for each vertex (initialized with Y=0)
        const positions = new Float32Array(TOTAL_VERTICES * 3);
        // Normal buffer: Nx, Ny, Nz for each vertex (initialized with straight up)
        const normals = new Float32Array(TOTAL_VERTICES * 3).fill(0).map((val, i) => i % 3 === 1 ? 1.0 : 0.0);
        // Color buffer: R, G, B for each vertex
        const colors = new Float32Array(TOTAL_VERTICES * 3);
        // Index buffer: Indices for triangles
        const indices = this.generateChunkIndices();

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));

        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.userData = { gridX, gridZ, isHeightProcessed: false };
        mesh.position.set(chunkWorldX, 0, chunkWorldZ); // Mesh position is the chunk's world origin

        const chunkData = {
            id: chunkId,
            mesh: mesh,
            worldX: chunkWorldX,
            worldZ: chunkWorldZ,
            gridX: gridX,
            gridZ: gridZ,
        };

        this.chunkMap.set(chunkId, chunkData);
        this.scene.add(mesh);
        
        this.requestChunkHeights(chunkData);

        return chunkData;
    }

    generateChunkIndices() {
        const indices = [];
        for (let j = 0; j < TERRAIN_RESOLUTION; j++) {
            for (let i = 0; i < TERRAIN_RESOLUTION; i++) {
                const a = i + j * VERTICES_PER_SIDE;
                const b = i + (j + 1) * VERTICES_PER_SIDE;
                const c = (i + 1) + (j + 1) * VERTICES_PER_SIDE;
                const d = (i + 1) + j * VERTICES_PER_SIDE;

                // First triangle: a, b, d
                indices.push(a, b, d);
                // Second triangle: b, c, d
                indices.push(b, c, d);
            }
        }
        return new Uint32Array(indices);
    }

    generateChunkPoints(chunkData) {
        const points = [];
        const step = CHUNK_SIZE / TERRAIN_RESOLUTION;
        const { worldX, worldZ } = chunkData;

        for (let j = 0; j < VERTICES_PER_SIDE; j++) {
            for (let i = 0; i < VERTICES_PER_SIDE; i++) {
                const vertexIndex = i + j * VERTICES_PER_SIDE;
                
                // ✅ In generateChunkPoints, ensure vertex world coordinates line up exactly at chunk edges (shared borders).
                // Coordinates are calculated from the fixed world origin (worldX, worldZ) of the chunk.
                // The floating point step is used, but the overall structure starts from the fixed origin.
                let x = worldX + i * step;
                let z = worldZ + j * step;
                
                // ✅ Maintain consistent rounding precision when caching heights (Math.round(x*10000)).
                // Round the coordinates *before* sending them to the worker to ensure the worker's cache lookup is deterministic and matches the main thread.
                x = roundCoord(x);
                z = roundCoord(z);

                points.push({ x, z, index: vertexIndex });
            }
        }
        return points;
    }

    requestChunkHeights(chunkData) {
        const batchId = this.batchIdCounter++;
        const points = this.generateChunkPoints(chunkData);

        // Store chunkData keyed by batchId until results return
        this.workerManager.calculateHeightBatch(points, batchId, (result) => {
            this.handleHeightBatchResult(chunkData.id, result);
        });
    }

    handleHeightBatchResult(chunkId, result) {
        const chunkData = this.chunkMap.get(chunkId);
        if (!chunkData || chunkData.mesh.userData.isHeightProcessed) {
            return;
        }

        const geometry = chunkData.mesh.geometry;
        const positions = geometry.attributes.position.array;
        const normals = geometry.attributes.normal.array;
        const colors = geometry.attributes.color.array;

        result.results.forEach(pointResult => {
            const i = pointResult.index;
            const { height, normal } = pointResult;

            // ✅ In handleHeightBatchResult, confirm vertex indexing matches geometry layout.
            // i is the vertex index (0 to TOTAL_VERTICES-1). Position/Normal/Color buffers are 3x the vertex count.
            const baseIndex = i * 3; 

            // Update Y position
            positions[baseIndex + 1] = height;

            // Update Normal
            normals[baseIndex + 0] = normal.x;
            normals[baseIndex + 1] = normal.y;
            normals[baseIndex + 2] = normal.z;

            // Simple coloring based on height
            if (height < 0) { // Sea/Water
                colors[baseIndex + 0] = 0.1;
                colors[baseIndex + 1] = 0.1;
                colors[baseIndex + 2] = 0.8;
            } else if (height < 2) { // Beach/Shallow
                colors[baseIndex + 0] = 0.8;
                colors[baseIndex + 1] = 0.7;
                colors[baseIndex + 2] = 0.5;
            } else if (height < 15) { // Grass
                colors[baseIndex + 0] = 0.2;
                colors[baseIndex + 1] = 0.6;
                colors[baseIndex + 2] = 0.1;
            } else if (height < 30) { // Rock/Mountain
                colors[baseIndex + 0] = 0.5;
                colors[baseIndex + 1] = 0.5;
                colors[baseIndex + 2] = 0.5;
            } else { // Snow
                colors[baseIndex + 0] = 1.0;
                colors[baseIndex + 1] = 1.0;
                colors[baseIndex + 2] = 1.0;
            }
        });

        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.normal.needsUpdate = true;
        geometry.attributes.color.needsUpdate = true;
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        // The chunk is now visually complete
        chunkData.mesh.userData.isHeightProcessed = true;
    }

    disposeChunk(chunkId) {
        const chunkData = this.chunkMap.get(chunkId);
        if (chunkData) {
            this.scene.remove(chunkData.mesh);
            chunkData.mesh.geometry.dispose();
            this.chunkMap.delete(chunkId);
        }
    }

    dispose() {
        this.workerManager.terminate();
        this.chunkMap.forEach(chunk => this.disposeChunk(chunk.id));
    }
}
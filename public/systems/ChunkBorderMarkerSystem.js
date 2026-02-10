/**
 * ChunkBorderMarkerSystem.js
 * Renders small dark brown posts along chunk boundaries so players
 * can see region borders.  Uses a single InstancedMesh (one draw call)
 * that is rebuilt only when the player crosses a chunk boundary.
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';

const POST_WIDTH  = 0.1;
const POST_HEIGHT = 0.2;
const POST_DEPTH  = 0.1;
const POST_COLOR  = 0x1d110b;       // very dark brown
const POST_SPACING = 10;            // units between posts along a border line
const CHUNK_SIZE  = 50;
const HALF_CHUNK  = CHUNK_SIZE / 2;  // 25
const MAX_INSTANCES = 6000;          // generous ceiling for LOAD_RADIUS 10

export class ChunkBorderMarkerSystem {
    constructor(scene, terrainGenerator) {
        this.scene = scene;
        this.terrainGenerator = terrainGenerator;

        this.currentCenterX = null;
        this.currentCenterZ = null;

        // Shared geometry + material (no lighting calc needed)
        this._geometry = new THREE.BoxGeometry(POST_WIDTH, POST_HEIGHT, POST_DEPTH);
        this._geometry.translate(0, POST_HEIGHT / 2, 0); // pivot at base
        this._material = new THREE.MeshBasicMaterial({ color: POST_COLOR });

        this._mesh = new THREE.InstancedMesh(this._geometry, this._material, MAX_INSTANCES);
        this._mesh.frustumCulled = false;
        this._mesh.count = 0;
        this.scene.add(this._mesh);

        this._tempMatrix = new THREE.Matrix4();
    }

    /**
     * Rebuild all border post instances around the given player chunk.
     * Called on chunk crossing and on initial load.
     */
    rebuild(playerChunkX, playerChunkZ) {
        if (playerChunkX === this.currentCenterX && playerChunkZ === this.currentCenterZ) {
            return; // no change
        }
        this.currentCenterX = playerChunkX;
        this.currentCenterZ = playerChunkZ;

        const loadRadius = CONFIG.CHUNKS?.LOAD_RADIUS || 10;
        let idx = 0;

        // Vertical border lines (constant-X)
        // Borders sit between chunk columns:  chunkX * 50 - 25
        for (let cx = playerChunkX - loadRadius; cx <= playerChunkX + loadRadius + 1; cx++) {
            const borderX = cx * CHUNK_SIZE - HALF_CHUNK;

            // Posts run along Z within the visible range
            const minZ = (playerChunkZ - loadRadius) * CHUNK_SIZE - HALF_CHUNK;
            const maxZ = (playerChunkZ + loadRadius) * CHUNK_SIZE + HALF_CHUNK;

            for (let z = minZ; z <= maxZ; z += POST_SPACING) {
                if (idx >= MAX_INSTANCES) break;
                const y = this.terrainGenerator
                    ? this.terrainGenerator.getWorldHeight(borderX, z)
                    : 0;
                if (y < 0) continue; // skip underwater

                this._tempMatrix.makeTranslation(borderX, y, z);
                this._mesh.setMatrixAt(idx, this._tempMatrix);
                idx++;
            }
        }

        // Horizontal border lines (constant-Z)
        for (let cz = playerChunkZ - loadRadius; cz <= playerChunkZ + loadRadius + 1; cz++) {
            const borderZ = cz * CHUNK_SIZE - HALF_CHUNK;

            const minX = (playerChunkX - loadRadius) * CHUNK_SIZE - HALF_CHUNK;
            const maxX = (playerChunkX + loadRadius) * CHUNK_SIZE + HALF_CHUNK;

            for (let x = minX; x <= maxX; x += POST_SPACING) {
                if (idx >= MAX_INSTANCES) break;
                const y = this.terrainGenerator
                    ? this.terrainGenerator.getWorldHeight(x, borderZ)
                    : 0;
                if (y < 0) continue; // skip underwater

                this._tempMatrix.makeTranslation(x, y, borderZ);
                this._mesh.setMatrixAt(idx, this._tempMatrix);
                idx++;
            }
        }

        this._mesh.count = idx;
        this._mesh.instanceMatrix.needsUpdate = true;
    }

    dispose() {
        this.scene.remove(this._mesh);
        this._geometry.dispose();
        this._material.dispose();
    }
}

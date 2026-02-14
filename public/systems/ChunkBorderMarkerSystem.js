/**
 * ChunkBorderMarkerSystem.js
 * Renders small dark brown posts along chunk boundaries so players
 * can see region borders.  Uses a single InstancedMesh (one draw call).
 *
 * rebuild()          — incremental: spreads terrain lookups across frames
 * rebuildImmediate() — synchronous: used behind loading/death screens
 * continueRebuild()  — called from game loop each frame to make progress
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';

const POST_WIDTH  = 0.1;
const POST_HEIGHT = 0.2;
const POST_DEPTH  = 0.1;
const POST_COLOR  = 0x1d110b;       // very dark brown
const POST_SPACING = 5;             // units between posts along a border line
const CHUNK_SIZE  = 50;
const HALF_CHUNK  = CHUNK_SIZE / 2;  // 25
const MAX_INSTANCES = 10000;         // ceiling for LOAD_RADIUS 10 at 5-unit spacing
const POSTS_PER_FRAME = 1000;        // terrain lookups per frame during incremental rebuild

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

        // Incremental rebuild state
        this._rebuildInProgress = false;
        this._rebuildIdx = 0;           // matrix write index
        this._rebuildLines = null;      // precomputed border lines
        this._rebuildLineIndex = 0;     // which line we're processing
        this._rebuildLinePos = 0;       // position along current line
    }

    /**
     * Start an incremental rebuild. Posts appear progressively over several
     * frames as continueRebuild() is called from the game loop.
     */
    rebuild(playerChunkX, playerChunkZ) {
        if (playerChunkX === this.currentCenterX && playerChunkZ === this.currentCenterZ) {
            return;
        }
        this.currentCenterX = playerChunkX;
        this.currentCenterZ = playerChunkZ;

        const loadRadius = CONFIG.CHUNKS?.LOAD_RADIUS || 10;

        // Precompute all border lines
        const lines = [];

        // Vertical border lines (constant-X)
        const minZ = (playerChunkZ - loadRadius) * CHUNK_SIZE - HALF_CHUNK;
        const maxZ = (playerChunkZ + loadRadius) * CHUNK_SIZE + HALF_CHUNK;
        for (let cx = playerChunkX - loadRadius; cx <= playerChunkX + loadRadius + 1; cx++) {
            lines.push({
                fixedAxis: 'x',
                fixedCoord: cx * CHUNK_SIZE - HALF_CHUNK,
                min: minZ,
                max: maxZ
            });
        }

        // Horizontal border lines (constant-Z)
        const minX = (playerChunkX - loadRadius) * CHUNK_SIZE - HALF_CHUNK;
        const maxX = (playerChunkX + loadRadius) * CHUNK_SIZE + HALF_CHUNK;
        for (let cz = playerChunkZ - loadRadius; cz <= playerChunkZ + loadRadius + 1; cz++) {
            lines.push({
                fixedAxis: 'z',
                fixedCoord: cz * CHUNK_SIZE - HALF_CHUNK,
                min: minX,
                max: maxX
            });
        }

        this._rebuildLines = lines;
        this._rebuildLineIndex = 0;
        this._rebuildLinePos = lines.length > 0 ? lines[0].min : 0;
        this._rebuildIdx = 0;
        this._rebuildInProgress = true;

        // Clear old posts immediately
        this._mesh.count = 0;
        this._mesh.instanceMatrix.needsUpdate = true;
    }

    /**
     * Synchronous full rebuild. Used by LoadingScreen and DeathManager
     * where the work happens behind a screen transition.
     */
    rebuildImmediate(playerChunkX, playerChunkZ) {
        this.currentCenterX = playerChunkX;
        this.currentCenterZ = playerChunkZ;
        this._rebuildInProgress = false;

        const loadRadius = CONFIG.CHUNKS?.LOAD_RADIUS || 10;
        let idx = 0;

        // Vertical border lines (constant-X)
        for (let cx = playerChunkX - loadRadius; cx <= playerChunkX + loadRadius + 1; cx++) {
            const borderX = cx * CHUNK_SIZE - HALF_CHUNK;
            const minZ = (playerChunkZ - loadRadius) * CHUNK_SIZE - HALF_CHUNK;
            const maxZ = (playerChunkZ + loadRadius) * CHUNK_SIZE + HALF_CHUNK;

            for (let z = minZ; z <= maxZ; z += POST_SPACING) {
                if (idx >= MAX_INSTANCES) break;
                const y = this.terrainGenerator
                    ? this.terrainGenerator.getWorldHeight(borderX, z)
                    : 0;
                if (y < 0) continue;

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
                if (y < 0) continue;

                this._tempMatrix.makeTranslation(x, y, borderZ);
                this._mesh.setMatrixAt(idx, this._tempMatrix);
                idx++;
            }
        }

        this._mesh.count = idx;
        this._mesh.instanceMatrix.needsUpdate = true;
    }

    /**
     * Called from the game loop each frame. Processes up to POSTS_PER_FRAME
     * terrain height lookups and writes matrix entries progressively.
     */
    continueRebuild() {
        if (!this._rebuildInProgress) return;

        const lines = this._rebuildLines;
        let budget = POSTS_PER_FRAME;
        let idx = this._rebuildIdx;
        let li = this._rebuildLineIndex;
        let pos = this._rebuildLinePos;

        while (li < lines.length && budget > 0) {
            const line = lines[li];
            const fixed = line.fixedCoord;

            while (pos <= line.max && budget > 0) {
                budget--;

                if (idx < MAX_INSTANCES) {
                    let wx, wz;
                    if (line.fixedAxis === 'x') {
                        wx = fixed;
                        wz = pos;
                    } else {
                        wx = pos;
                        wz = fixed;
                    }

                    const y = this.terrainGenerator
                        ? this.terrainGenerator.getWorldHeight(wx, wz)
                        : 0;

                    if (y >= 0) {
                        this._tempMatrix.makeTranslation(wx, y, wz);
                        this._mesh.setMatrixAt(idx, this._tempMatrix);
                        idx++;
                    }
                }

                pos += POST_SPACING;
            }

            if (pos > line.max) {
                li++;
                if (li < lines.length) {
                    pos = lines[li].min;
                }
            }
        }

        // Update visible count so new posts appear this frame
        this._rebuildIdx = idx;
        this._rebuildLineIndex = li;
        this._rebuildLinePos = pos;
        this._mesh.count = idx;
        this._mesh.instanceMatrix.needsUpdate = true;

        if (li >= lines.length) {
            this._rebuildInProgress = false;
            this._rebuildLines = null;
        }
    }

    dispose() {
        this.scene.remove(this._mesh);
        this._geometry.dispose();
        this._material.dispose();
    }
}

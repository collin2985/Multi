/**
 * ChunkCoordinates.js
 * 
 * Unified chunk coordinate system handler.
 * This module ensures all chunk coordinate calculations are consistent throughout the codebase.
 * 
 * SYSTEM: CENTER-BASED CHUNKS
 * - Chunk (0,0) spans from -25 to +25 on both axes
 * - Chunk (1,0) spans from +25 to +75 on X axis
 * - Chunk coordinate references the CENTER of the chunk
 * 
 * All chunk coordinate calculations must go through this module to maintain consistency.
 */

import { CONFIG } from '../config.js';

export class ChunkCoordinates {
    /**
     * Get chunk size from config
     * @returns {number} Chunk size in world units (50)
     */
    static getChunkSize() {
        return CONFIG.CHUNKS.CHUNK_SIZE;
    }

    /**
     * Get half chunk size (useful for offset calculations)
     * @returns {number} Half chunk size (25)
     */
    static getHalfChunkSize() {
        return CONFIG.CHUNKS.CHUNK_SIZE / 2;
    }

    /**
     * Convert world coordinates to chunk grid coordinates (CENTER-BASED)
     * Chunk (0,0) spans from -25 to +25 on both axes.
     * 
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {{chunkX: number, chunkZ: number}} Chunk grid coordinates
     */
    static worldToChunk(worldX, worldZ) {
        const halfSize = this.getHalfChunkSize();
        const chunkSize = this.getChunkSize();
        
        const chunkX = Math.floor((worldX + halfSize) / chunkSize);
        const chunkZ = Math.floor((worldZ + halfSize) / chunkSize);
        
        return { chunkX, chunkZ };
    }

    /**
     * Convert chunk grid coordinates to chunk ID string
     * Format: "chunk_X,Z" where X and Z are chunk coordinates
     */
    static toChunkId(chunkX, chunkZ) {
        return `chunk_${chunkX},${chunkZ}`;
    }

    /**
     * Convert world coordinates directly to chunk ID
     */
    static worldToChunkId(worldX, worldZ) {
        const { chunkX, chunkZ } = this.worldToChunk(worldX, worldZ);
        return this.toChunkId(chunkX, chunkZ);
    }

    /**
     * Parse chunk ID string to get chunk coordinates
     * @throws {Error} If chunk ID format is invalid
     */
    static fromChunkId(chunkId) {
        const match = chunkId.match(/chunk_(-?\d+),(-?\d+)/);
        if (!match) {
            throw new Error(`Invalid chunk ID format: ${chunkId}`);
        }
        return {
            chunkX: parseInt(match[1], 10),
            chunkZ: parseInt(match[2], 10)
        };
    }

    /**
     * Safely parse chunk ID string to get chunk coordinates
     * Returns null instead of throwing on invalid input (ISSUE-049 fix)
     * @param {string} chunkId - Chunk ID string like "chunk_0,0"
     * @returns {{chunkX: number, chunkZ: number}|null} Parsed coordinates or null if invalid
     */
    static parseChunkIdSafe(chunkId) {
        if (!chunkId || typeof chunkId !== 'string') {
            console.error(`[ChunkCoordinates] Invalid chunk ID (not a string): ${chunkId}`);
            return null;
        }
        const match = chunkId.match(/chunk_(-?\d+),(-?\d+)/);
        if (!match) {
            console.error(`[ChunkCoordinates] Invalid chunk ID format: ${chunkId}`);
            return null;
        }
        const chunkX = parseInt(match[1], 10);
        const chunkZ = parseInt(match[2], 10);
        if (!Number.isFinite(chunkX) || !Number.isFinite(chunkZ)) {
            console.error(`[ChunkCoordinates] Chunk coordinates not finite: ${chunkId}`);
            return null;
        }
        return { chunkX, chunkZ };
    }

    /**
     * Get the world bounds of a chunk
     * For chunk (0,0), returns bounds from (-25,-25) to (25,25)
     */
    static getChunkBounds(chunkX, chunkZ) {
        const halfSize = this.getHalfChunkSize();
        const chunkSize = this.getChunkSize();
        
        const centerX = chunkX * chunkSize;
        const centerZ = chunkZ * chunkSize;
        
        return {
            minX: centerX - halfSize,
            maxX: centerX + halfSize,
            minZ: centerZ - halfSize,
            maxZ: centerZ + halfSize
        };
    }

    /**
     * Get the center point of a chunk in world coordinates
     * For chunk (0,0), returns (0, 0)
     */
    static getChunkCenter(chunkX, chunkZ) {
        const chunkSize = this.getChunkSize();
        return {
            centerX: chunkX * chunkSize,
            centerZ: chunkZ * chunkSize
        };
    }

    /**
     * Check if a world position is within a specific chunk
     */
    static isInChunk(worldX, worldZ, chunkX, chunkZ) {
        const { chunkX: posChunkX, chunkZ: posChunkZ } = this.worldToChunk(worldX, worldZ);
        return posChunkX === chunkX && posChunkZ === chunkZ;
    }

    /**
     * Get the 3x3 grid of chunks centered on given coordinates
     */
    static get3x3ChunkIds(chunkX, chunkZ) {
        const chunks = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                chunks.push(this.toChunkId(chunkX + dx, chunkZ + dz));
            }
        }
        return chunks;
    }

    /**
     * Get NxN grid of chunks around a center chunk
     */
    static getNxNChunkIds(chunkX, chunkZ, radius = 1) {
        const chunks = [];
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                chunks.push(this.toChunkId(chunkX + dx, chunkZ + dz));
            }
        }
        return chunks;
    }

    /**
     * Chebyshev distance between two chunks
     */
    static chunkDistance(chunkX1, chunkZ1, chunkX2, chunkZ2) {
        return Math.max(Math.abs(chunkX2 - chunkX1), Math.abs(chunkZ2 - chunkZ1));
    }

    /**
     * Check if chunk is within world boundaries from config
     */
    static isWithinWorldBounds(chunkX, chunkZ) {
        const minX = CONFIG.CHUNKS.MIN_CHUNK_X;
        const maxX = CONFIG.CHUNKS.MAX_CHUNK_X;
        const minZ = CONFIG.CHUNKS.MIN_CHUNK_Z;
        const maxZ = CONFIG.CHUNKS.MAX_CHUNK_Z;

        return chunkX >= minX && chunkX <= maxX &&
               chunkZ >= minZ && chunkZ <= maxZ;
    }

    // Static cache for 3x3 chunk keys - reused every frame
    static _cached3x3Keys = [];
    static _cached3x3CenterX = null;
    static _cached3x3CenterZ = null;

    /**
     * Get 3x3 grid of chunk keys centered on given chunk coordinates.
     * Returns simple "X,Z" format keys (not "chunk_X,Z").
     * Cached - only regenerates when center changes.
     * @param {number} chunkX - Center chunk X
     * @param {number} chunkZ - Center chunk Z
     * @returns {string[]} Array of 9 chunk keys
     */
    static get3x3ChunkKeys(chunkX, chunkZ) {
        // Return cached if center hasn't changed
        if (chunkX === this._cached3x3CenterX && chunkZ === this._cached3x3CenterZ) {
            return this._cached3x3Keys;
        }

        // Regenerate cache
        this._cached3x3Keys.length = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                this._cached3x3Keys.push(`${chunkX + dx},${chunkZ + dz}`);
            }
        }
        this._cached3x3CenterX = chunkX;
        this._cached3x3CenterZ = chunkZ;

        return this._cached3x3Keys;
    }
}

export default ChunkCoordinates;

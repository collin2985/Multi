/**
 * SpawnSystem.js
 * Client-side spawn point calculation and validation
 *
 * Algorithm:
 * 1. Pick random X and Z within -50,000 to +50,000
 * 2. If ocean (y = -30), march west (X -= 25) until y >= 7.5
 * 3. If max iterations exceeded, retry with fresh random coordinates
 */

import { CONFIG } from '../config.js';

// Re-export for backwards compatibility
export const FACTION_ZONES = CONFIG.FACTION_ZONES;

// Spawn constants
const SPAWN_CONFIG = {
    // World bounds (100,000 square area centered on 0)
    MIN_X: -50000,
    MAX_X: 50000,
    MIN_Z: -50000,
    MAX_Z: 50000,

    // Ocean detection
    OCEAN_Y: -30,           // Deep ocean height
    LAND_THRESHOLD: 7.5,    // Minimum Y to be considered valid land

    // Westward search
    WEST_STEP: 25,          // Units to move west per iteration
    MAX_ITERATIONS: 2000,   // Max westward steps before retry (50,000 units)
    MAX_RETRIES: 10,        // Max times to retry with fresh coordinates
};

// Spawn near friend radius
const FRIEND_SPAWN_RADIUS = 10;

/**
 * Create a seeded random number generator
 * @param {number} seed - Optional seed
 * @returns {function} RNG function returning 0-1
 */
function createSpawnRNG(seed = 0) {
    let s = (Date.now() ^ seed) >>> 0;
    return function() {
        s = Math.imul(s ^ (s >>> 15), 1 | s) >>> 0;
        s = (s + Math.imul(s ^ (s >>> 7), 61 | s)) >>> 0;
        return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
    };
}

export class SpawnSystem {
    constructor(terrainGenerator) {
        this.terrainGenerator = terrainGenerator;
    }

    /**
     * Find a random spawn point
     * Picks random coords, if ocean marches west until land found
     * @param {number} seed - Optional seed for RNG
     * @returns {{ valid: boolean, x: number, y: number, z: number, reason?: string }}
     */
    findRandomSpawn(seed = 0) {
        const rng = createSpawnRNG(seed);

        for (let retry = 0; retry < SPAWN_CONFIG.MAX_RETRIES; retry++) {
            // Pick random coordinates within world bounds
            const startX = SPAWN_CONFIG.MIN_X + rng() * (SPAWN_CONFIG.MAX_X - SPAWN_CONFIG.MIN_X);
            const z = SPAWN_CONFIG.MIN_Z + rng() * (SPAWN_CONFIG.MAX_Z - SPAWN_CONFIG.MIN_Z);

            let x = startX;
            const height = this.terrainGenerator.getWorldHeight(x, z);

            // If already on valid land, use it
            if (height >= SPAWN_CONFIG.LAND_THRESHOLD) {
                console.log(`[SpawnSystem] Found land spawn at (${x.toFixed(1)}, ${z.toFixed(1)}) height=${height.toFixed(1)}`);
                return { valid: true, x, y: height, z };
            }

            // If ocean (y = -30), march west
            if (height <= SPAWN_CONFIG.OCEAN_Y) {
                for (let i = 0; i < SPAWN_CONFIG.MAX_ITERATIONS; i++) {
                    x -= SPAWN_CONFIG.WEST_STEP;
                    const newHeight = this.terrainGenerator.getWorldHeight(x, z);

                    if (newHeight >= SPAWN_CONFIG.LAND_THRESHOLD) {
                        console.log(`[SpawnSystem] Found land after ${i + 1} westward steps at (${x.toFixed(1)}, ${z.toFixed(1)}) height=${newHeight.toFixed(1)}`);
                        return { valid: true, x, y: newHeight, z };
                    }
                }

                // Max iterations reached, retry with new coords
                console.log(`[SpawnSystem] Westward search exhausted from (${startX.toFixed(1)}, ${z.toFixed(1)}), retrying...`);
                continue;
            }

            // Height is between -30 and 7.5 (shallow water or low land)
            // March west to find proper land
            for (let i = 0; i < SPAWN_CONFIG.MAX_ITERATIONS; i++) {
                x -= SPAWN_CONFIG.WEST_STEP;
                const newHeight = this.terrainGenerator.getWorldHeight(x, z);

                if (newHeight >= SPAWN_CONFIG.LAND_THRESHOLD) {
                    console.log(`[SpawnSystem] Found land from shallow area after ${i + 1} steps at (${x.toFixed(1)}, ${z.toFixed(1)}) height=${newHeight.toFixed(1)}`);
                    return { valid: true, x, y: newHeight, z };
                }
            }

            console.log(`[SpawnSystem] Search exhausted from shallow area, retrying...`);
        }

        // All retries exhausted - fallback to world center
        console.warn('[SpawnSystem] All spawn attempts failed, using fallback at origin');
        const fallbackHeight = this.terrainGenerator.getWorldHeight(0, 0);
        return {
            valid: false,
            x: 0,
            y: Math.max(fallbackHeight, SPAWN_CONFIG.LAND_THRESHOLD),
            z: 0,
            reason: 'all_attempts_exhausted'
        };
    }

    /**
     * Main spawn method - finds valid spawn in zone
     * @param {number|null} factionId - Unused, kept for API compatibility
     * @param {object} physicsManager - Unused, kept for API compatibility
     * @param {number} maxAttempts - Unused, kept for API compatibility
     * @returns {{ valid: boolean, x?: number, y?: number, z?: number, reason?: string }}
     */
    findValidSpawnInZone(factionId = null, physicsManager = null, maxAttempts = 50) {
        return this.findRandomSpawn();
    }

    /**
     * Coastal spawn - now just calls findRandomSpawn
     * @param {number|null} factionId - Unused
     * @param {number} seed - Optional seed
     * @returns {{ valid: boolean, x?: number, y?: number, z?: number, reason?: string }}
     */
    findCoastalSpawn(factionId, seed = 0) {
        return this.findRandomSpawn(seed);
    }

    /**
     * Get spawn point near a friend
     * @param {number} friendX - Friend's X position
     * @param {number} friendZ - Friend's Z position
     * @returns {{ x: number, z: number }}
     */
    getSpawnNearFriend(friendX, friendZ) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * FRIEND_SPAWN_RADIUS;
        return {
            x: friendX + Math.cos(angle) * distance,
            z: friendZ + Math.sin(angle) * distance
        };
    }

    /**
     * Find valid spawn near friend
     * @param {number} friendX
     * @param {number} friendZ
     * @param {object} physicsManager - Unused
     * @param {number} maxAttempts
     * @returns {{ valid: boolean, x?: number, y?: number, z?: number, reason?: string }}
     */
    findValidSpawnNearFriend(friendX, friendZ, physicsManager = null, maxAttempts = 50) {
        for (let i = 0; i < maxAttempts; i++) {
            const { x, z } = this.getSpawnNearFriend(friendX, friendZ);
            const height = this.terrainGenerator.getWorldHeight(x, z);

            if (height >= SPAWN_CONFIG.LAND_THRESHOLD) {
                return { valid: true, x, y: height, z };
            }
        }

        // Fallback to friend's position
        const friendHeight = this.terrainGenerator.getWorldHeight(friendX, friendZ);
        return {
            valid: false,
            x: friendX,
            y: Math.max(friendHeight, SPAWN_CONFIG.LAND_THRESHOLD),
            z: friendZ,
            reason: 'fallback_to_friend_position'
        };
    }

    /**
     * Validate a spawn point
     * @param {number} x
     * @param {number} z
     * @param {object} physicsManager - Unused
     * @returns {{ valid: boolean, reason?: string, height?: number }}
     */
    validateSpawnPoint(x, z, physicsManager = null) {
        const height = this.terrainGenerator.getWorldHeight(x, z);

        if (height < SPAWN_CONFIG.LAND_THRESHOLD) {
            return { valid: false, reason: 'below_land_threshold' };
        }

        return { valid: true, height };
    }

    /**
     * Get chunk coordinates for a world position
     * @param {number} x
     * @param {number} z
     * @returns {{ chunkX: number, chunkZ: number, chunkId: string }}
     */
    getChunkForPosition(x, z) {
        const chunkX = Math.floor((x + 25) / 50);
        const chunkZ = Math.floor((z + 25) / 50);
        return {
            chunkX,
            chunkZ,
            chunkId: `chunk_${chunkX},${chunkZ}`
        };
    }

    // ==========================================
    // Legacy methods kept for API compatibility
    // ==========================================

    /**
     * @deprecated Use findRandomSpawn instead
     */
    getRandomSpawnInZone(factionId, seed = 0) {
        const rng = createSpawnRNG(seed);
        return {
            x: SPAWN_CONFIG.MIN_X + rng() * (SPAWN_CONFIG.MAX_X - SPAWN_CONFIG.MIN_X),
            z: SPAWN_CONFIG.MIN_Z + rng() * (SPAWN_CONFIG.MAX_Z - SPAWN_CONFIG.MIN_Z)
        };
    }

    /**
     * @deprecated Factions not fully implemented
     */
    isInFactionZone(z, factionId) {
        return true; // Everyone can spawn anywhere for now
    }

    /**
     * @deprecated Factions not fully implemented
     */
    getFactionAtZ(z) {
        return null;
    }

    /**
     * @deprecated Factions not fully implemented
     */
    canSpawnOnFriend(myFaction, friendFaction, friendZ) {
        return { allowed: true };
    }
}

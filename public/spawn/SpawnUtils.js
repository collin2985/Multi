/**
 * SpawnUtils.js
 * Utility functions for finding valid spawn points using TerrainGenerator
 *
 * Random spawn algorithm:
 * 1. Pick random X and Z within -50,000 to +50,000
 * 2. If ocean (y = -30), march west (X -= 25) until y >= 7.5
 * 3. If max iterations exceeded, retry with fresh random coordinates
 */

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

const STRUCTURE_SPAWN_OFFSET = 3.0;

/**
 * Find a valid spawn point near a structure (offset to avoid being inside it)
 * @param {object} terrainGenerator - Terrain generator with getWorldHeight(x, z) method
 * @param {number} structureX - Structure X position
 * @param {number} structureZ - Structure Z position
 * @param {number} minZ - Unused, kept for API compatibility
 * @param {number} maxZ - Unused, kept for API compatibility
 * @param {object|null} banditController - Optional bandit controller for proximity check (null on initial spawn)
 * @returns {{ x: number, z: number, height: number }}
 */
export function findValidSpawnNearStructure(terrainGenerator, structureX, structureZ, minZ, maxZ, banditController = null) {
    const BANDIT_RADIUS = 30;

    // Try cardinal directions first (N, E, S, W), then diagonals
    const offsets = [
        { x: 0, z: STRUCTURE_SPAWN_OFFSET },     // North
        { x: STRUCTURE_SPAWN_OFFSET, z: 0 },     // East
        { x: 0, z: -STRUCTURE_SPAWN_OFFSET },    // South
        { x: -STRUCTURE_SPAWN_OFFSET, z: 0 },    // West
        { x: STRUCTURE_SPAWN_OFFSET, z: STRUCTURE_SPAWN_OFFSET },    // NE
        { x: STRUCTURE_SPAWN_OFFSET, z: -STRUCTURE_SPAWN_OFFSET },   // SE
        { x: -STRUCTURE_SPAWN_OFFSET, z: -STRUCTURE_SPAWN_OFFSET },  // SW
        { x: -STRUCTURE_SPAWN_OFFSET, z: STRUCTURE_SPAWN_OFFSET },   // NW
    ];

    for (const offset of offsets) {
        const testX = structureX + offset.x;
        const testZ = structureZ + offset.z;
        const height = terrainGenerator.getWorldHeight(testX, testZ);

        if (height >= SPAWN_CONFIG.LAND_THRESHOLD) {
            // Skip if near bandit (respawn only - banditController null on initial spawn)
            if (banditController?.hasNearbyBandits(testX, testZ, BANDIT_RADIUS)) {
                console.log(`[Spawn] Position (${testX.toFixed(1)}, ${testZ.toFixed(1)}) too close to bandit, trying next...`);
                continue;
            }
            console.log(`[Spawn] Found valid position near structure: (${testX.toFixed(2)}, ${testZ.toFixed(2)}) height=${height.toFixed(2)}`);
            return { x: testX, z: testZ, height };
        }
    }

    // If all cardinal/diagonal positions fail, try random positions nearby
    for (let i = 0; i < 20; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = STRUCTURE_SPAWN_OFFSET + Math.random() * 2;
        const testX = structureX + Math.cos(angle) * distance;
        const testZ = structureZ + Math.sin(angle) * distance;
        const height = terrainGenerator.getWorldHeight(testX, testZ);

        if (height >= SPAWN_CONFIG.LAND_THRESHOLD) {
            // Skip if near bandit
            if (banditController?.hasNearbyBandits(testX, testZ, BANDIT_RADIUS)) {
                continue;
            }
            console.log(`[Spawn] Found valid position near structure (random): (${testX.toFixed(2)}, ${testZ.toFixed(2)}) height=${height.toFixed(2)}`);
            return { x: testX, z: testZ, height };
        }
    }

    // Fallback to structure position (even if near bandit - better than not spawning)
    console.warn('[Spawn] Could not find valid position near structure, using structure position');
    const structureHeight = terrainGenerator.getWorldHeight(structureX, structureZ);
    return {
        x: structureX,
        z: structureZ,
        height: Math.max(structureHeight, SPAWN_CONFIG.LAND_THRESHOLD)
    };
}

/**
 * Find a valid random spawn point
 * Picks random coords in 100,000 square area, if ocean marches west until land found
 * @param {object} terrainGenerator - Terrain generator with getWorldHeight(x, z) method
 * @param {number} initialX - Unused, kept for API compatibility
 * @param {number} initialZ - Unused, kept for API compatibility
 * @param {number} minZ - Unused, kept for API compatibility
 * @param {number} maxZ - Unused, kept for API compatibility
 * @param {object|null} banditController - Optional bandit controller for proximity check (null on initial spawn)
 * @returns {{ x: number, z: number, height: number }}
 */
export function findValidSpawnPoint(terrainGenerator, initialX, initialZ, minZ, maxZ, banditController = null) {
    const BANDIT_RADIUS = 30;

    for (let retry = 0; retry < SPAWN_CONFIG.MAX_RETRIES; retry++) {
        // Pick random coordinates within world bounds
        const startX = SPAWN_CONFIG.MIN_X + Math.random() * (SPAWN_CONFIG.MAX_X - SPAWN_CONFIG.MIN_X);
        const z = SPAWN_CONFIG.MIN_Z + Math.random() * (SPAWN_CONFIG.MAX_Z - SPAWN_CONFIG.MIN_Z);

        let x = startX;
        const height = terrainGenerator.getWorldHeight(x, z);

        // If already on valid land, use it
        if (height >= SPAWN_CONFIG.LAND_THRESHOLD) {
            // Check for nearby bandits (respawn only - banditController null on initial spawn)
            if (banditController?.hasNearbyBandits(x, z, BANDIT_RADIUS)) {
                continue;
            }
            return { x, z, height };
        }

        // If ocean (y = -30), march west
        if (height <= SPAWN_CONFIG.OCEAN_Y) {
            for (let i = 0; i < SPAWN_CONFIG.MAX_ITERATIONS; i++) {
                x -= SPAWN_CONFIG.WEST_STEP;
                const newHeight = terrainGenerator.getWorldHeight(x, z);

                if (newHeight >= SPAWN_CONFIG.LAND_THRESHOLD) {
                    // Check for nearby bandits
                    if (banditController?.hasNearbyBandits(x, z, BANDIT_RADIUS)) {
                        break; // Break inner loop to retry with new coords
                    }
                    return { x, z, height: newHeight };
                }
            }

            // Max iterations reached or bandit nearby, retry with new coords
            continue;
        }

        // Height is between -30 and 7.5 (shallow water or low land)
        // March west to find proper land
        for (let i = 0; i < SPAWN_CONFIG.MAX_ITERATIONS; i++) {
            x -= SPAWN_CONFIG.WEST_STEP;
            const newHeight = terrainGenerator.getWorldHeight(x, z);

            if (newHeight >= SPAWN_CONFIG.LAND_THRESHOLD) {
                // Check for nearby bandits
                if (banditController?.hasNearbyBandits(x, z, BANDIT_RADIUS)) {
                    break; // Break inner loop to retry with new coords
                }
                return { x, z, height: newHeight };
            }
        }
    }

    // All retries exhausted - fallback to world center
    console.warn('[Spawn] All spawn attempts failed, using fallback at origin');
    const fallbackHeight = terrainGenerator.getWorldHeight(0, 0);
    return {
        x: 0,
        z: 0,
        height: Math.max(fallbackHeight, SPAWN_CONFIG.LAND_THRESHOLD)
    };
}

/**
 * SpawnUtils.js
 * Utility functions for finding valid spawn points using TerrainGenerator
 *
 * Optimized spawn algorithm using continent grid:
 * 1. Pick a random continent based on faction:
 *    - Northmen: continent center Z >= 500 (north of equator)
 *    - Southguard: continent center Z <= -500 (south of equator)
 *    - Neutral: any continent
 * 2. Pick random direction (N, E, S, W)
 * 3. Start 650 units from center in that direction (in ocean, past transition zone)
 * 4. Walk toward center in 10 unit steps until height >= 7.5 (first land = beach)
 * 5. Validate spawn point (slope, height, bandit proximity)
 */

// Spawn constants
const SPAWN_CONFIG = {
    // World bounds (100,000 square area centered on 0)
    MIN_X: -50000,
    MAX_X: 50000,
    MIN_Z: -50000,
    MAX_Z: 50000,

    // Terrain thresholds
    LAND_THRESHOLD: 7.5,    // Minimum Y to be considered valid land
    MAX_SPAWN_HEIGHT: 20,   // Maximum height for spawn (beach level, not cliffs)
    MAX_SLOPE: 2.5,         // Maximum height difference over SLOPE_CHECK_DIST
    SLOPE_CHECK_DIST: 3,    // Distance to check for slope

    // Continent-based search
    CONTINENT_SPACING: 2000,    // Must match TERRAIN_CONFIG.CONTINENT_SPACING
    MAX_CONTINENT_TRIES: 50,    // Max continent cells to try before fallback

    // Bandit avoidance
    BANDIT_RADIUS: 30,
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
 * Calculate continent center for a given cell using terrain generator hash functions
 * @param {object} terrainGenerator - Terrain generator with hashCell methods
 * @param {number} cellX - Continent cell X index
 * @param {number} cellZ - Continent cell Z index
 * @returns {{ x: number, z: number }}
 */
function getContinentCenter(terrainGenerator, cellX, cellZ) {
    const spacing = SPAWN_CONFIG.CONTINENT_SPACING;
    const offsetX = terrainGenerator.hashCell(cellX, cellZ);
    const offsetZ = terrainGenerator.hashCell2(cellX, cellZ);
    return {
        x: (cellX + 0.2 + offsetX * 0.6) * spacing,
        z: (cellZ + 0.2 + offsetZ * 0.6) * spacing
    };
}

/**
 * Check if a spawn point is valid (slope and height checks)
 * @param {object} terrainGenerator - Terrain generator
 * @param {number} x - X coordinate
 * @param {number} z - Z coordinate
 * @param {number} height - Height at (x, z)
 * @returns {boolean}
 */
function isValidSpawnPoint(terrainGenerator, x, z, height) {
    // Must be above water
    if (height < SPAWN_CONFIG.LAND_THRESHOLD) {
        return false;
    }

    // Must not be too high (we want beach level, not mountain tops)
    if (height > SPAWN_CONFIG.MAX_SPAWN_HEIGHT) {
        return false;
    }

    // Check slope by sampling a nearby point
    const nearbyHeight = terrainGenerator.getWorldHeight(
        x + SPAWN_CONFIG.SLOPE_CHECK_DIST,
        z
    );
    const slope = Math.abs(height - nearbyHeight);
    if (slope > SPAWN_CONFIG.MAX_SLOPE) {
        return false;
    }

    return true;
}

/**
 * Find a valid beach spawn point by starting in ocean and walking toward continent center
 *
 * Algorithm:
 * - Start at 650 units from center in chosen direction (guaranteed ocean)
 * - Walk toward center in 10 unit steps
 * - First position with height >= 7.5 is the beach
 * - If no land found in 15 steps (150 units), something is broken
 *
 * @param {object} terrainGenerator - Terrain generator
 * @param {number} centerX - Continent center X
 * @param {number} centerZ - Continent center Z
 * @param {string} direction - Direction the beach faces: 'N', 'E', 'S', 'W'
 * @param {object|null} banditController - Optional bandit controller
 * @returns {{ x: number, z: number, height: number } | null}
 */
function findBeachInDirection(terrainGenerator, centerX, centerZ, direction, banditController) {
    // Direction vectors (direction beach faces = direction we start from)
    const dirVectors = {
        'N': { dx: 0, dz: 1 },   // Beach faces North: start north of center
        'E': { dx: 1, dz: 0 },   // Beach faces East: start east of center
        'S': { dx: 0, dz: -1 },  // Beach faces South: start south of center
        'W': { dx: -1, dz: 0 }   // Beach faces West: start west of center
    };
    const dir = dirVectors[direction];

    // Start 650 units from center (past transition zone, in ocean)
    const startDistance = 650;
    let x = centerX + dir.dx * startDistance;
    let z = centerZ + dir.dz * startDistance;

    // Walk toward center (opposite of direction) in 10 unit steps
    const stepSize = 10;
    const maxSteps = 15;  // 150 units max - should find beach within transition zone

    for (let step = 0; step < maxSteps; step++) {
        const height = terrainGenerator.getWorldHeight(x, z);

        if (height >= SPAWN_CONFIG.LAND_THRESHOLD) {
            // Found land! This is the beach
            // Validate spawn point (slope, height checks)
            if (isValidSpawnPoint(terrainGenerator, x, z, height)) {
                // Check bandit proximity
                if (!banditController?.hasNearbyBandits(x, z, SPAWN_CONFIG.BANDIT_RADIUS)) {
                    return { x, z, height };
                }
                // Bandit nearby - keep walking to find another spot
            }
        }

        // Move toward center
        x -= dir.dx * stepSize;
        z -= dir.dz * stepSize;
    }

    // No valid beach found in this direction
    return null;
}

/**
 * Find a valid spawn point using continent-based algorithm
 * Much faster than random sampling - typically 20-50 height checks instead of thousands
 *
 * Algorithm:
 * 1. Pick a random continent based on faction rules:
 *    - Northmen (minZ >= 0): continent center Z >= 500
 *    - Southguard (maxZ <= 0): continent center Z <= -500
 *    - Neutral: any continent
 * 2. Pick a random direction (N, E, S, W)
 * 3. Walk in that direction from continent center to find beach
 *
 * @param {object} terrainGenerator - Terrain generator with getWorldHeight(x, z) method
 * @param {number} initialX - Unused, kept for API compatibility
 * @param {number} initialZ - Unused, kept for API compatibility
 * @param {number} minZ - Minimum Z bound (faction restriction)
 * @param {number} maxZ - Maximum Z bound (faction restriction)
 * @param {object|null} banditController - Optional bandit controller for proximity check (null on initial spawn)
 * @returns {{ x: number, z: number, height: number }}
 */
export function findValidSpawnPoint(terrainGenerator, initialX, initialZ, minZ, maxZ, banditController = null) {
    // Determine faction type from bounds
    // Northmen: minZ >= 0 (northern half only)
    // Southguard: maxZ <= 0 (southern half only)
    // Neutral: full world bounds or mixed
    const effectiveMinZ = (minZ !== undefined && minZ !== null) ? minZ : SPAWN_CONFIG.MIN_Z;
    const effectiveMaxZ = (maxZ !== undefined && maxZ !== null) ? maxZ : SPAWN_CONFIG.MAX_Z;

    const isNorthmen = effectiveMinZ >= 0;
    const isSouthguard = effectiveMaxZ <= 0;
    const isNeutral = !isNorthmen && !isSouthguard;

    // Faction distance from equator requirement
    const FACTION_EQUATOR_DISTANCE = 500;

    // Calculate continent cell ranges (full world for X, full world for Z initially)
    const spacing = SPAWN_CONFIG.CONTINENT_SPACING;
    const minCellX = Math.floor(SPAWN_CONFIG.MIN_X / spacing);
    const maxCellX = Math.floor(SPAWN_CONFIG.MAX_X / spacing);
    const minCellZ = Math.floor(SPAWN_CONFIG.MIN_Z / spacing);
    const maxCellZ = Math.floor(SPAWN_CONFIG.MAX_Z / spacing);

    const cellRangeX = maxCellX - minCellX + 1;
    const cellRangeZ = maxCellZ - minCellZ + 1;

    // Directions to try
    const directions = ['N', 'E', 'S', 'W'];

    // Track tried cells to avoid duplicates
    const triedCells = new Set();

    // Try random continent cells until we find a valid spawn
    for (let attempt = 0; attempt < SPAWN_CONFIG.MAX_CONTINENT_TRIES; attempt++) {
        // Pick a random cell from full world
        const cx = minCellX + Math.floor(Math.random() * cellRangeX);
        const cz = minCellZ + Math.floor(Math.random() * cellRangeZ);

        // Skip if already tried this cell
        const cellKey = `${cx},${cz}`;
        if (triedCells.has(cellKey)) {
            continue;
        }
        triedCells.add(cellKey);

        // Get continent center
        const center = getContinentCenter(terrainGenerator, cx, cz);

        // FACTION FILTER based on continent center position
        if (isNorthmen && center.z < FACTION_EQUATOR_DISTANCE) {
            // Northmen: continent center must be >= 500 Z
            continue;
        }
        if (isSouthguard && center.z > -FACTION_EQUATOR_DISTANCE) {
            // Southguard: continent center must be <= -500 Z
            continue;
        }
        // Neutral: no filter, any continent is valid

        // Pick a random direction
        const direction = directions[Math.floor(Math.random() * directions.length)];

        // Walk in chosen direction from continent center to find beach
        const result = findBeachInDirection(terrainGenerator, center.x, center.z, direction, banditController);

        if (result) {
            console.log(`[Spawn] Found beach spawn at (${result.x.toFixed(1)}, ${result.z.toFixed(1)}) heading ${direction}, height=${result.height.toFixed(1)} after ${attempt + 1} attempts`);
            return result;
        }
    }

    // Fallback: try a few completely random positions (in case continent detection failed)
    console.warn('[Spawn] Continent-based search failed, trying random fallback...');
    for (let i = 0; i < 10; i++) {
        const x = SPAWN_CONFIG.MIN_X + Math.random() * (SPAWN_CONFIG.MAX_X - SPAWN_CONFIG.MIN_X);
        const z = effectiveMinZ + Math.random() * (effectiveMaxZ - effectiveMinZ);
        const height = terrainGenerator.getWorldHeight(x, z);

        if (height >= SPAWN_CONFIG.LAND_THRESHOLD && height <= SPAWN_CONFIG.MAX_SPAWN_HEIGHT) {
            if (!banditController?.hasNearbyBandits(x, z, SPAWN_CONFIG.BANDIT_RADIUS)) {
                console.log(`[Spawn] Random fallback found spawn at (${x.toFixed(1)}, ${z.toFixed(1)})`);
                return { x, z, height };
            }
        }
    }

    // Ultimate fallback: world origin
    console.warn('[Spawn] All spawn attempts failed, using fallback at origin');
    const fallbackHeight = terrainGenerator.getWorldHeight(0, 0);
    return {
        x: 0,
        z: 0,
        height: Math.max(fallbackHeight, SPAWN_CONFIG.LAND_THRESHOLD)
    };
}

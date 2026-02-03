/**
 * TerrainAccess.js
 * Global accessor for the terrain generator instance.
 * Allows any module to query terrain heights without needing a game reference.
 */

let terrainGeneratorInstance = null;

/**
 * Set the global terrain generator instance.
 * Called once during game initialization.
 * @param {TerrainGenerator} generator - The terrain generator instance
 */
export function setTerrainGenerator(generator) {
    terrainGeneratorInstance = generator;
}

/**
 * Get the terrain height at world coordinates.
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @returns {number} - Height at the given coordinates, or 0 if not initialized
 */
export function getTerrainHeight(x, z) {
    if (!terrainGeneratorInstance) {
        console.warn('[TerrainAccess] Terrain generator not initialized');
        return 0;
    }
    return terrainGeneratorInstance.getWorldHeight(x, z);
}

/**
 * Get the terrain generator instance directly.
 * Use sparingly - prefer getTerrainHeight() for simple height queries.
 * @returns {TerrainGenerator|null} - The terrain generator instance or null
 */
export function getTerrainGenerator() {
    return terrainGeneratorInstance;
}

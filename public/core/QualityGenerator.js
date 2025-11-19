/**
 * QualityGenerator.js
 * Procedural quality generation system for resources based on world seed and chunk coordinates
 *
 * Uses deterministic hashing to assign quality ranges to chunks:
 * - Same seed + chunk coords = same quality range (multiplayer-safe)
 * - No server needed - pure client-side math
 * - No storage needed - calculated on-demand
 *
 * Quality Ranges (for grass):
 * - Range 0: 1-25   (poor quality)
 * - Range 1: 26-50  (fair quality)
 * - Range 2: 51-75  (good quality)
 * - Range 3: 76-100 (excellent quality)
 */

/**
 * Deterministic RNG using Mulberry32 algorithm
 * Same as terrain.js for consistency
 * @param {number} seed - Seed value
 * @returns {function} - Random number generator (0-1)
 */
function mulberry32(seed) {
    return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Generate chunk-specific seed from world seed and coordinates
 * Same as terrain.js getChunkRNG for consistency
 * @param {number} worldSeed - World generation seed
 * @param {number} chunkX - Chunk X coordinate
 * @param {number} chunkZ - Chunk Z coordinate
 * @returns {number} - Chunk-specific seed
 */
function getChunkSeed(worldSeed, chunkX, chunkZ) {
    return worldSeed + chunkX * 73856093 + chunkZ * 19349663;
}

/**
 * Get quality range index for a chunk (0-3)
 * @param {number} worldSeed - World generation seed
 * @param {number} chunkX - Chunk X coordinate
 * @param {number} chunkZ - Chunk Z coordinate
 * @returns {number} - Quality range index (0=poor, 1=fair, 2=good, 3=excellent)
 */
function getQualityRangeIndex(worldSeed, chunkX, chunkZ) {
    const chunkSeed = getChunkSeed(worldSeed, chunkX, chunkZ);
    const rng = mulberry32(chunkSeed);
    const random = rng(); // 0-1

    // Map to 0-3 (4 equal ranges)
    return Math.floor(random * 4);
}

/**
 * Quality range definitions for grass
 * Each chunk gets assigned one of these ranges
 */
const GRASS_QUALITY_RANGES = [
    { min: 1,  max: 25,  name: 'poor' },
    { min: 26, max: 50,  name: 'fair' },
    { min: 51, max: 75,  name: 'good' },
    { min: 76, max: 100, name: 'excellent' }
];

export const QualityGenerator = {
    /**
     * Get the quality range for grass in a specific chunk
     * @param {number} worldSeed - World generation seed (from CONFIG.TERRAIN.seed)
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @returns {object} - { min: number, max: number, name: string }
     */
    getGrassQualityRange(worldSeed, chunkX, chunkZ) {
        const rangeIndex = getQualityRangeIndex(worldSeed, chunkX, chunkZ);
        return GRASS_QUALITY_RANGES[rangeIndex];
    },

    /**
     * Get a random grass quality value within the chunk's quality range
     * Call this each time grass is gathered to get variation within the range
     * @param {number} worldSeed - World generation seed (from CONFIG.TERRAIN.seed)
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @returns {number} - Grass quality (1-100)
     */
    getGrassQuality(worldSeed, chunkX, chunkZ) {
        const range = this.getGrassQualityRange(worldSeed, chunkX, chunkZ);

        // Use current timestamp for randomness within the range
        // This gives variation each time you gather, but chunk still determines the range
        const min = range.min;
        const max = range.max;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    },

    /**
     * Debug: Get quality range name for display
     * @param {number} worldSeed - World generation seed
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @returns {string} - Quality range name (poor/fair/good/excellent)
     */
    getGrassQualityRangeName(worldSeed, chunkX, chunkZ) {
        const range = this.getGrassQualityRange(worldSeed, chunkX, chunkZ);
        return range.name;
    },

    /**
     * Get the quality range for mushrooms in a specific chunk
     * Uses the same quality ranges as grass
     * @param {number} worldSeed - World generation seed (from CONFIG.TERRAIN.seed)
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @returns {object} - { min: number, max: number, name: string }
     */
    getMushroomQualityRange(worldSeed, chunkX, chunkZ) {
        const rangeIndex = getQualityRangeIndex(worldSeed, chunkX, chunkZ);
        return GRASS_QUALITY_RANGES[rangeIndex];
    },

    /**
     * Get a random mushroom quality value within the chunk's quality range
     * @param {number} worldSeed - World generation seed (from CONFIG.TERRAIN.seed)
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @returns {number} - Mushroom quality (1-100)
     */
    getMushroomQuality(worldSeed, chunkX, chunkZ) {
        const range = this.getMushroomQualityRange(worldSeed, chunkX, chunkZ);
        const min = range.min;
        const max = range.max;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
};

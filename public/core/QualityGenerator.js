/**
 * QualityGenerator.js
 * Procedural quality generation system for resources based on world seed and chunk coordinates
 *
 * Uses deterministic hashing to assign quality ranges to chunks:
 * - Same seed + chunk coords = same quality range (multiplayer-safe)
 * - No server needed - pure client-side math
 * - No storage needed - calculated on-demand
 *
 * Quality Ranges (for all resources):
 * - Range 0: 1-10    (very poor)
 * - Range 1: 11-20   (poor)
 * - Range 2: 21-30   (below average)
 * - Range 3: 31-40   (fair)
 * - Range 4: 41-50   (average)
 * - Range 5: 51-60   (good)
 * - Range 6: 61-70   (very good)
 * - Range 7: 71-80   (excellent)
 * - Range 8: 81-90   (superior)
 * - Range 9: 91-100  (exceptional)
 *
 * Continent Bonus: Resources closer to continent centers get a quality bonus (up to +30)
 * - Only applies when continent mask > 0.5 (past transition zone, solidly on land)
 * - Remaps 0.5-1.0 to 0-30 bonus
 *
 * Supported resource types: vines, mushroom, pine, clay, limestone, sandstone,
 *                          apple, fish, vegetables, vegetableseeds, iron, deer, brownbear
 */

import { getTerrainGenerator } from './TerrainAccess.js';

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
 * Get quality range index for a chunk (0-9)
 * @param {number} worldSeed - World generation seed
 * @param {number} chunkX - Chunk X coordinate
 * @param {number} chunkZ - Chunk Z coordinate
 * @returns {number} - Quality range index (0=very poor, 9=exceptional)
 */
function getQualityRangeIndex(worldSeed, chunkX, chunkZ) {
    const chunkSeed = getChunkSeed(worldSeed, chunkX, chunkZ);
    const rng = mulberry32(chunkSeed);
    const random = rng(); // 0-1

    // Map to 0-9 (10 equal ranges)
    return Math.floor(random * 10);
}

/**
 * Resource type seed offsets for independent quality distributions
 * Each resource type gets a unique offset to ensure different quality ranges per chunk
 */
const RESOURCE_OFFSETS = {
    'vines': 0,
    'mushroom': 1000,
    'fir': 2000,
    'pine': 3000,
    'clay': 4000,
    'limestone': 5000,
    'sandstone': 6000,
    'apple': 7000,
    'fish': 8000,
    'vegetableseeds': 9000,
    'vegetables': 10000,
    'iron': 11000,
    'deer': 12000,
    'brownbear': 13000,
    'oak': 14000,
    'cypress': 15000,
    'rope': 16000,
    'hemp': 17000,
    'hempseeds': 18000
};

/**
 * Quality range definitions for all resources
 * Each chunk gets assigned one of these ranges per resource type
 */
const QUALITY_RANGES = [
    { min: 1,   max: 10,  name: 'very poor' },
    { min: 11,  max: 20,  name: 'poor' },
    { min: 21,  max: 30,  name: 'below average' },
    { min: 31,  max: 40,  name: 'fair' },
    { min: 41,  max: 50,  name: 'average' },
    { min: 51,  max: 60,  name: 'good' },
    { min: 61,  max: 70,  name: 'very good' },
    { min: 71,  max: 80,  name: 'excellent' },
    { min: 81,  max: 90,  name: 'superior' },
    { min: 91,  max: 100, name: 'exceptional' }
];

/**
 * Continent bonus configuration
 * Resources deeper inland (higher continent mask) get quality bonuses
 */
const CONTINENT_BONUS = {
    THRESHOLD: 0.5,   // Start applying bonus when mask > this (past beach/transition)
    MAX_BONUS: 30,    // Maximum quality bonus at continent center (mask = 1.0)
    CHUNK_SIZE: 50    // World units per chunk (for coordinate conversion)
};

/**
 * Regional density modifier configuration
 * Each chunk gets a random density modifier per resource type
 * This creates regional variation where some areas are richer/poorer in certain resources
 */
const DENSITY_MODIFIER = {
    MIN: 0.75,        // -25% density minimum
    MAX: 1.25,        // +25% density maximum
    SEED_OFFSET: 50000 // Offset from quality seeds to get independent distributions
};

/**
 * Resource types that support regional density variation
 */
const DENSITY_RESOURCE_TYPES = [
    'pine', 'apple', 'vegetables', 'hemp', 'iron', 'clay', 'limestone', 'sandstone'
];

export const QualityGenerator = {
    /**
     * Get the quality range for a resource in a specific chunk (GENERIC)
     * @param {number} worldSeed - World generation seed (from CONFIG.TERRAIN.seed)
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @param {string} resourceType - Resource type ('vines', 'mushroom', 'pine', etc.)
     * @returns {object} - { min: number, max: number, name: string }
     */
    getQualityRange(worldSeed, chunkX, chunkZ, resourceType) {
        const offset = RESOURCE_OFFSETS[resourceType] || 0;
        const rangeIndex = getQualityRangeIndex(worldSeed + offset, chunkX, chunkZ);
        return QUALITY_RANGES[rangeIndex];
    },

    /**
     * Get the quality range name for a given quality value
     * @param {number} value - Quality value (1-100)
     * @returns {string} - Quality name ('very poor', 'poor', ..., 'exceptional')
     */
    getQualityNameForValue(value) {
        for (const range of QUALITY_RANGES) {
            if (value >= range.min && value <= range.max) return range.name;
        }
        return QUALITY_RANGES[QUALITY_RANGES.length - 1].name;
    },

    /**
     * Get continent-adjusted quality range for a resource in a specific chunk
     * Applies the same continent bonus as getQuality() so tooltips match actual harvests
     * @param {number} worldSeed - World generation seed (from CONFIG.TERRAIN.seed)
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @param {string} resourceType - Resource type ('vines', 'mushroom', 'pine', etc.)
     * @returns {object} - { min: number, max: number, name: string }
     */
    getAdjustedQualityRange(worldSeed, chunkX, chunkZ, resourceType) {
        const range = this.getQualityRange(worldSeed, chunkX, chunkZ, resourceType);
        const terrainGen = getTerrainGenerator();
        if (terrainGen) {
            const worldX = chunkX * CONTINENT_BONUS.CHUNK_SIZE;
            const worldZ = chunkZ * CONTINENT_BONUS.CHUNK_SIZE;
            const continentMask = terrainGen.getContinentMask(worldX, worldZ);
            if (continentMask > CONTINENT_BONUS.THRESHOLD) {
                const bonusFactor = (continentMask - CONTINENT_BONUS.THRESHOLD) / (1 - CONTINENT_BONUS.THRESHOLD);
                const bonus = Math.floor(bonusFactor * CONTINENT_BONUS.MAX_BONUS);
                const adjustedMin = Math.min(100, range.min + bonus);
                const adjustedMax = Math.min(100, range.max + bonus);
                return { min: adjustedMin, max: adjustedMax, name: this.getQualityNameForValue(adjustedMin) };
            }
        }
        return range;
    },

    /**
     * Get a random quality value within the chunk's quality range (GENERIC)
     * Includes continent bonus: deeper inland = higher quality
     * @param {number} worldSeed - World generation seed (from CONFIG.TERRAIN.seed)
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @param {string} resourceType - Resource type ('vines', 'mushroom', 'pine', etc.)
     * @returns {number} - Quality (1-100)
     */
    getQuality(worldSeed, chunkX, chunkZ, resourceType) {
        const range = this.getQualityRange(worldSeed, chunkX, chunkZ, resourceType);
        const min = range.min;
        const max = range.max;
        let quality = Math.floor(Math.random() * (max - min + 1)) + min;

        // Apply continent bonus (deeper inland = higher quality)
        const terrainGen = getTerrainGenerator();
        if (terrainGen) {
            const worldX = chunkX * CONTINENT_BONUS.CHUNK_SIZE;
            const worldZ = chunkZ * CONTINENT_BONUS.CHUNK_SIZE;
            const continentMask = terrainGen.getContinentMask(worldX, worldZ);

            // Only apply bonus past threshold (solidly on land, not beach)
            if (continentMask > CONTINENT_BONUS.THRESHOLD) {
                // Remap threshold-1.0 to 0-1, then scale to max bonus
                const bonusFactor = (continentMask - CONTINENT_BONUS.THRESHOLD) / (1 - CONTINENT_BONUS.THRESHOLD);
                const bonus = Math.floor(bonusFactor * CONTINENT_BONUS.MAX_BONUS);
                quality = Math.min(100, quality + bonus);
            }
        }

        return quality;
    },

    /**
     * Get the quality range for vines in a specific chunk
     * @deprecated Use getQualityRange(worldSeed, chunkX, chunkZ, 'vines') instead
     * @param {number} worldSeed - World generation seed (from CONFIG.TERRAIN.seed)
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @returns {object} - { min: number, max: number, name: string }
     */
    getVinesQualityRange(worldSeed, chunkX, chunkZ) {
        return this.getQualityRange(worldSeed, chunkX, chunkZ, 'vines');
    },

    /**
     * Get a random vines quality value within the chunk's quality range
     * @deprecated Use getQuality(worldSeed, chunkX, chunkZ, 'vines') instead
     * @param {number} worldSeed - World generation seed (from CONFIG.TERRAIN.seed)
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @returns {number} - Vines quality (1-100)
     */
    getVinesQuality(worldSeed, chunkX, chunkZ) {
        return this.getQuality(worldSeed, chunkX, chunkZ, 'vines');
    },

    /**
     * Debug: Get quality range name for display
     * @param {number} worldSeed - World generation seed
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @returns {string} - Quality range name (poor/fair/good/excellent)
     */
    getVinesQualityRangeName(worldSeed, chunkX, chunkZ) {
        const range = this.getVinesQualityRange(worldSeed, chunkX, chunkZ);
        return range.name;
    },

    /**
     * Get the quality range for mushrooms in a specific chunk
     * @deprecated Use getQualityRange(worldSeed, chunkX, chunkZ, 'mushroom') instead
     * @param {number} worldSeed - World generation seed (from CONFIG.TERRAIN.seed)
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @returns {object} - { min: number, max: number, name: string }
     */
    getMushroomQualityRange(worldSeed, chunkX, chunkZ) {
        return this.getQualityRange(worldSeed, chunkX, chunkZ, 'mushroom');
    },

    /**
     * Get a random mushroom quality value within the chunk's quality range
     * @deprecated Use getQuality(worldSeed, chunkX, chunkZ, 'mushroom') instead
     * @param {number} worldSeed - World generation seed (from CONFIG.TERRAIN.seed)
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @returns {number} - Mushroom quality (1-100)
     */
    getMushroomQuality(worldSeed, chunkX, chunkZ) {
        return this.getQuality(worldSeed, chunkX, chunkZ, 'mushroom');
    },

    /**
     * Get regional density modifier for a resource type in a specific chunk
     * Creates variation where some areas are richer/poorer in certain resources
     * @param {number} worldSeed - World generation seed (from CONFIG.TERRAIN.seed)
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @param {string} resourceType - Resource type ('pine', 'apple', 'iron', etc.)
     * @returns {number} - Density multiplier (0.75 to 1.25, or 1.0 if type not supported)
     */
    getDensityModifier(worldSeed, chunkX, chunkZ, resourceType) {
        // Only apply to supported resource types
        if (!DENSITY_RESOURCE_TYPES.includes(resourceType)) {
            return 1.0;
        }

        // Get resource-specific offset for independent distributions
        const resourceOffset = RESOURCE_OFFSETS[resourceType] || 0;

        // Create seed combining world seed, density offset, resource offset, and chunk coords
        const densitySeed = worldSeed + DENSITY_MODIFIER.SEED_OFFSET + resourceOffset;
        const chunkSeed = getChunkSeed(densitySeed, chunkX, chunkZ);
        const rng = mulberry32(chunkSeed);

        // Generate modifier in range [MIN, MAX] (0.75 to 1.25)
        const random = rng(); // 0-1
        return DENSITY_MODIFIER.MIN + random * (DENSITY_MODIFIER.MAX - DENSITY_MODIFIER.MIN);
    }
};

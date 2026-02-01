/**
 * StructureDecayUtils.js
 * Utility functions for structure durability and decay calculations
 */

// Decay formula constants
const DECAY_EXPONENT = 1.434;
const DECAY_INVERSE = 0.697;
const CONSTRUCTION_SITE_LIFESPAN_HOURS = 1;

/**
 * Calculate current durability of a structure based on elapsed time
 * @param {object} structure - Structure object with quality and lastRepairTime
 * @returns {number} Current durability (0-100)
 */
function getCurrentDurability(structure) {
    // Ruins have no durability
    if (structure.isRuin) return 0;

    // Roads never decay
    if (structure.name === 'road') return structure.quality || 100;

    // Construction sites have fixed 1-hour lifespan
    if (isConstructionSite(structure)) {
        const ageHours = (Date.now() - structure.lastRepairTime) / (1000 * 60 * 60);
        return ageHours >= CONSTRUCTION_SITE_LIFESPAN_HOURS ? 0 : structure.quality || 100;
    }

    // Regular structures - calculate from time elapsed
    const now = Date.now();
    const elapsedMs = now - (structure.lastRepairTime || now);
    const elapsedHours = elapsedMs / (1000 * 60 * 60);

    const quality = structure.quality || 50;
    const maxLifespanHours = Math.pow(quality, DECAY_EXPONENT);
    const remainingHours = maxLifespanHours - elapsedHours;

    if (remainingHours <= 0) return 0;

    return Math.pow(remainingHours, DECAY_INVERSE);
}

/**
 * Calculate hours until structure becomes a ruin
 * @param {object} structure - Structure object with quality and lastRepairTime
 * @returns {number} Hours until ruin (0 if already ruined)
 */
function getHoursUntilRuin(structure) {
    // Ruins have no time remaining
    if (structure.isRuin) return 0;

    // Roads never decay
    if (structure.name === 'road') return Infinity;

    // Construction sites have fixed 1-hour lifespan
    if (isConstructionSite(structure)) {
        const ageHours = (Date.now() - (structure.lastRepairTime || Date.now())) / (1000 * 60 * 60);
        return Math.max(0, CONSTRUCTION_SITE_LIFESPAN_HOURS - ageHours);
    }

    // Regular structures
    const now = Date.now();
    const elapsedMs = now - (structure.lastRepairTime || now);
    const elapsedHours = elapsedMs / (1000 * 60 * 60);

    const quality = structure.quality || 50;
    const maxLifespanHours = Math.pow(quality, DECAY_EXPONENT);
    const remainingHours = maxLifespanHours - elapsedHours;

    return Math.max(0, remainingHours);
}

/**
 * Check if a structure is a construction site
 * @param {object} structure - Structure object
 * @returns {boolean}
 */
function isConstructionSite(structure) {
    // Check both isConstructionSite flag and name containing "construction"
    return structure.isConstructionSite === true ||
           (structure.name && structure.name.includes('construction'));
}

/**
 * Get construction site type for a given structure
 * @param {string} structureName - Name of the structure
 * @returns {string|null} Construction site model name or null
 */
function getConstructionSiteForStructure(structureName) {
    // Map structure types to their construction site variants
    const mapping = {
        'house': 'construction',
        'crate': 'construction',
        'tent': 'construction',
        'campfire': 'construction',
        'market': '2x8construction',
        'dock': '10x4construction',
        'outpost': '10x1construction'
    };
    return mapping[structureName] || null;
}

/**
 * Clamp quality to valid range (1-100)
 * @param {number} quality - Quality value
 * @returns {number} Clamped quality
 */
function clampQuality(quality) {
    return Math.max(1, Math.min(100, Math.round(quality)));
}

/**
 * Enrich structure object with calculated durability values
 * @param {object} structure - Structure object
 * @returns {object} Structure with currentDurability and hoursUntilRuin
 */
function enrichStructureWithDurability(structure) {
    return {
        ...structure,
        currentDurability: getCurrentDurability(structure),
        hoursUntilRuin: getHoursUntilRuin(structure)
    };
}

module.exports = {
    getCurrentDurability,
    getHoursUntilRuin,
    isConstructionSite,
    getConstructionSiteForStructure,
    clampQuality,
    enrichStructureWithDurability,
    DECAY_EXPONENT,
    DECAY_INVERSE,
    CONSTRUCTION_SITE_LIFESPAN_HOURS
};

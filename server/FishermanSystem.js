/**
 * FishermanSystem.js
 * Handles fisherman structure mechanics - transforming fish to cookedfish
 * Extends BaseProcessingSystem for shared processing logic
 *
 * Key features:
 * - Recipe: fish -> cookedfish
 * - Food durability formula: quality-based (higher quality = longer lasting)
 */

const BaseProcessingSystem = require('./BaseProcessingSystem.js');

class FishermanSystem extends BaseProcessingSystem {
    constructor(chunkManager, messageRouter) {
        super(chunkManager, messageRouter, {
            structureType: 'fisherman',
            logTag: '[FISHERMAN]',
            duration: 60, // 1 minute
            recipes: {
                'fish': 'cookedfish'
            },
            allowedItems: [
                'fish',
                'cookedfish'
                // Firewood types are auto-allowed by base class
            ]
        });
    }

    /**
     * Override: Food items use quality-based durability
     * Higher quality = longer lasting food
     */
    calculateDurability(rawItem, structure, quality) {
        const baseDurability = 30;
        const qualityMultiplier = quality / 50; // 50 is baseline quality
        return Math.round(baseDurability * qualityMultiplier);
    }
}

module.exports = FishermanSystem;

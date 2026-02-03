/**
 * BakerySystem.js
 * Handles bakery mechanics - transforming apple to appletart
 * Extends BaseProcessingSystem for shared processing logic
 *
 * Key features:
 * - Recipe: apple -> appletart (exclusive - cannot be done elsewhere)
 * - Food durability formula: quality-based (higher quality = longer lasting)
 */

const BaseProcessingSystem = require('./BaseProcessingSystem.js');

class BakerySystem extends BaseProcessingSystem {
    constructor(chunkManager, messageRouter) {
        super(chunkManager, messageRouter, {
            structureType: 'bakery',
            logTag: '[BAKERY]',
            duration: 60, // 1 minute
            recipes: {
                'apple': 'appletart'
            },
            allowedItems: [
                'apple',
                'appletart'
                // Firewood types are auto-allowed by base class
            ]
        });
    }

    /**
     * Override: Food items use quality-based durability
     * Higher quality = longer lasting food
     * Formula matches PlayerHunger: baseDurability * (quality / 100)
     */
    calculateDurability(rawItem, structure, quality) {
        const baseDurability = 30;
        return Math.round(baseDurability * (quality / 100));
    }
}

module.exports = BakerySystem;

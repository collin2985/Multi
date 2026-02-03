/**
 * TileworksSystem.js
 * Handles tileworks mechanics - transforming clay to tile
 * Extends BaseProcessingSystem for shared processing logic
 *
 * Key features:
 * - Recipe: clay -> tile
 * - Tiles use default durability (100) - no decay
 */

const BaseProcessingSystem = require('./BaseProcessingSystem.js');

class TileworksSystem extends BaseProcessingSystem {
    constructor(chunkManager, messageRouter) {
        super(chunkManager, messageRouter, {
            structureType: 'tileworks',
            logTag: '[TILEWORKS]',
            duration: 60, // 1 minute
            recipes: {
                'clay': 'tile'
            },
            allowedItems: [
                'clay',
                'tile'
                // Firewood types are auto-allowed by base class
            ]
        });
    }

    // Uses default durability (100) from base class - tiles don't decay
}

module.exports = TileworksSystem;

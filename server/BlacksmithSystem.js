/**
 * BlacksmithSystem.js
 * Handles blacksmith mechanics - transforming ironingot to parts
 * Extends BaseProcessingSystem for shared processing logic
 *
 * Key features:
 * - Recipe: ironingot -> parts
 * - Metal items use default durability (100)
 */

const BaseProcessingSystem = require('./BaseProcessingSystem.js');

class BlacksmithSystem extends BaseProcessingSystem {
    constructor(chunkManager, messageRouter) {
        super(chunkManager, messageRouter, {
            structureType: 'blacksmith',
            logTag: '[BLACKSMITH]',
            duration: 60, // 1 minute
            recipes: {
                'ironingot': 'parts'
            },
            allowedItems: [
                'ironingot',
                'parts'
                // Firewood types are auto-allowed by base class
            ]
        });
    }

    // Uses default durability (100) from base class - metal doesn't decay
}

module.exports = BlacksmithSystem;

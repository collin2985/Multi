/**
 * IronworksSystem.js
 * Handles ironworks mechanics - transforming iron to ironingot
 * Extends BaseProcessingSystem for shared processing logic
 *
 * Key features:
 * - Recipe: iron -> ironingot
 * - Metal items use default durability (100)
 */

const BaseProcessingSystem = require('./BaseProcessingSystem.js');

class IronworksSystem extends BaseProcessingSystem {
    constructor(chunkManager, messageRouter) {
        super(chunkManager, messageRouter, {
            structureType: 'ironworks',
            logTag: '[IRONWORKS]',
            duration: 60, // 1 minute
            recipes: {
                'iron': 'ironingot'
            },
            allowedItems: [
                'iron',
                'ironingot'
                // Firewood types are auto-allowed by base class
            ]
        });
    }

    // Uses default durability (100) from base class - metal doesn't decay
}

module.exports = IronworksSystem;

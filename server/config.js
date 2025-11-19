/**
 * server/config.js
 * Server-side configuration (CommonJS format)
 *
 * IMPORTANT: LOAD_RADIUS must match public/config.js CHUNKS.LOAD_RADIUS
 * to keep client and server chunk loading synchronized!
 */

const CONFIG = {
    CHUNKS: {
        // Chunk size in world units - MUST match client config.js value!
        CHUNK_SIZE: 50,

        // Load chunks in NxN grid (1=3x3, 2=5x5, etc)
        // MUST match client config.js value!
        LOAD_RADIUS: 2,
    },

    CONSTRUCTION: {
        // Construction model mapping - maps structure types to their construction site models
        // Structures not listed here will use the default 'construction' model
        // MUST match client config.js CONSTRUCTION.CONSTRUCTION_MODELS
        CONSTRUCTION_MODELS: {
            market: '2x8construction',
            dock: '10x1construction'
            // Add more mappings here as needed (e.g., house: 'houseconstruction')
        }
    }
};

module.exports = { CONFIG };

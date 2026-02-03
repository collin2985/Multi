/**
 * server/config.js
 * Server-side configuration (CommonJS format)
 *
 * IMPORTANT: LOAD_RADIUS must match public/config.js CHUNKS.LOAD_RADIUS
 * to keep client and server chunk loading synchronized!
 */

const CONFIG = {
    // World boundaries (MUST match client config.js)
    WORLD_BOUNDS: {
        minX: -50000,
        maxX: 50000,
        minZ: -50000,
        maxZ: 50000
    },

    // Market item type definitions
    MARKET: {
        // Items that track durability (tools, weapons, and food)
        DURABILITY_ITEMS: [
            'axe', 'saw', 'pickaxe', 'hammer', 'chisel', 'fishingnet',  // Tools
            'rifle',  // Weapons
            'apple', 'vegetables', 'fish', 'cookedfish', 'cookedmeat', 'roastedvegetables', 'appletart', 'mushroom', 'rawmeat'  // Food
        ],
        // All tradeable item types
        ALL_ITEMS: [
            // Stone Materials
            'limestone', 'sandstone', 'granite', 'clay',
            'chiseledlimestone', 'chiseledsandstone', 'chiseledgranite', 'tile',
            // Metal/Ore
            'iron', 'ironingot', 'parts',
            // Wood Materials
            'pineplank', 'appleplank',
            'pinefirewood', 'applefirewood',
            'rope', 'hempfiber', 'fabric',
            // Seeds
            'vegetableseeds', 'hempseeds', 'appleseed', 'pineseed',
            // Food
            'apple', 'vegetables', 'roastedvegetables', 'appletart', 'mushroom',
            'fish', 'cookedfish', 'rawmeat', 'cookedmeat',
            // Tools
            'axe', 'saw', 'pickaxe', 'hammer', 'chisel', 'fishingnet',
            // Weapons
            'rifle', 'ammo', 'shell'
        ],
        // Default quantity when market is created
        DEFAULT_QUANTITY: 10,
        DEFAULT_QUALITY: 50,
        DEFAULT_DURABILITY: 50
    },

    CHUNKS: {
        // Chunk size in world units - MUST match client config.js value!
        CHUNK_SIZE: 50,

        // Load chunks in NxN grid (1=3x3, 2=5x5, etc)
        // MUST match client config.js value!
        LOAD_RADIUS: 2,
    },

    // Cooking/Processing durations (in milliseconds)
    // MUST match client config.js COOKING values!
    COOKING: {
        FOOD_DURATION: 60000,           // 1 minute for fish, vegetables
        CLAY_CAMPFIRE_DURATION: 300000, // 5 minutes for clay in campfire/house
        CLAY_TILEWORKS_DURATION: 60000, // 1 minute for clay in tileworks
        SERVER_TICK_INTERVAL: 60000,    // Server checks completions every 60s
    },

    CONSTRUCTION: {
        // Material requirements for different structures
        // SYNC REQUIRED: Also update public/config.js CONSTRUCTION.MATERIALS
        MATERIALS: {
            crate: { oakplank: 1 },
            tent: { oakplank: 1, rope: 1, fabric: 1 },
            outpost: { oakplank: 1 },
            house: { oakplank: 1, chiseledlimestone: 1, tile: 1 },
            campfire: { limestone: 1 },
            boat: { oakplank: 1 },
            sailboat: { oakplank: 1, rope: 1, fabric: 1 },
            ship2: { oakplank: 1, rope: 1, parts: 1, fabric: 1 },
            market: { oakplank: 1, chiseledlimestone: 1, tile: 1 },
            road: { chiseledlimestone: 1 },
            dock: { chiseledlimestone: 1 },
            fisherman: { oakplank: 1, chiseledlimestone: 1, tile: 1 },
            tileworks: { oakplank: 1, chiseledlimestone: 1, tile: 1 },
            ironworks: { oakplank: 1, chiseledlimestone: 1, tile: 1 },
            blacksmith: { oakplank: 1, chiseledlimestone: 1, tile: 1 },
            bakery: { oakplank: 1, chiseledlimestone: 1, tile: 1 },
            gardener: { oakplank: 1, chiseledlimestone: 1, tile: 1 },
            miner: { oakplank: 1, chiseledlimestone: 1, tile: 1 },
            woodcutter: { oakplank: 1, chiseledlimestone: 1, tile: 1 },
            stonemason: { oakplank: 1, chiseledlimestone: 1, tile: 1 },
            horse: { vegetables: 1 },
            cart: { oakplank: 1 },
            artillery: { oakplank: 1, parts: 1 },
            wall: { chiseledlimestone: 1 }
        },

        // Default materials if structure not found in MATERIALS
        DEFAULT_MATERIALS: { chiseledlimestone: 1 },

        // Construction model mapping - maps structure types to their construction site models
        // Structures not listed here will use the default 'construction' model
        // MUST match client config.js CONSTRUCTION.CONSTRUCTION_MODELS
        CONSTRUCTION_MODELS: {
            market: '2x8construction',
            dock: '10x4construction',
            fisherman: '2x2construction',
            tileworks: '2x2construction',
            ironworks: '2x2construction',
            blacksmith: '2x2construction',
            bakery: 'construction',
            stonemason: '2x2construction'
        },

        // Quality caps for structures (limits max quality regardless of materials)
        // MUST match client config.js CONSTRUCTION.STRUCTURE_QUALITY_CAPS
        STRUCTURE_QUALITY_CAPS: {
            tent: 100,      // Max quality 100 = ~738 hours lifespan (~30 days)
            campfire: 2,    // Max quality 2 = ~1.6 hours lifespan
            boat: 100,      // Max quality 100 = ~738 hours lifespan (~30 days)
            sailboat: 100,  // Max quality 100 = ~738 hours lifespan (~30 days)
            ship2: 100,     // Max quality 100 = ~738 hours lifespan (~30 days)
            horse: 100,     // Max quality 100 = ~738 hours lifespan (~30 days)
            cart: 100,      // Max quality 100 = ~738 hours lifespan (~30 days)
            crate: 100      // Max quality 100 = ~738 hours lifespan (~30 days)
        }
    },

    // Ship trading system - automated trading when ships arrive at docks
    SHIP_TRADING: {
        // Maximum distance from dock to market for trading (in world units)
        MAX_DISTANCE: 20,

        // Materials that ships will buy (raw + processed stone/wood)
        BUY_MATERIALS: [
            'limestone', 'sandstone', 'granite', 'clay', 'iron', 'ironingot',
            'chiseledlimestone', 'chiseledsandstone', 'chiseledgranite', 'tile',
            'pineplank', 'appleplank',
            'pinefirewood', 'applefirewood',
            'rope'
        ],

        // Tools and weapons that ships will sell
        SELL_ITEMS: [
            'axe', 'saw', 'pickaxe', 'hammer', 'chisel', 'fishingnet',
            'rifle', 'ammo', 'shell',
            'horse'
        ],

        // Base prices for ship trading (coins per item)
        PRICES: {
            // Materials (buy prices - what ships pay)
            limestone: 2, sandstone: 2, granite: 2, clay: 2, iron: 2, ironingot: 5,
            chiseledlimestone: 4, chiseledsandstone: 4, chiseledgranite: 4, tile: 8,
            pineplank: 3, appleplank: 3,
            pinefirewood: 3, applefirewood: 3,
            rope: 5,
            // Tools/weapons (sell prices - what ships charge)
            axe: 60, saw: 60, pickaxe: 60, hammer: 60, chisel: 60, fishingnet: 20,
            rifle: 200, ammo: 10,
            // Mounts
            horse: 200
        },

        // Minimum quality threshold - only buy materials above this quality
        MIN_QUALITY: 10,

        // How many items to leave behind at each quality tier
        LEAVE_BEHIND: 10
    }
};

module.exports = { CONFIG };

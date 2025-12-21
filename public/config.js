// File: public/config.js
// Location: C:\Users\colli\Desktop\test Horses\Horses\public\config.js

/**
 * ==========================================
 * GAME CONFIGURATION AND CONSTANTS
 * ==========================================
 *
 * This file contains all game configuration values and constants.
 * Modify these values to adjust game balance, UI layout, and behavior.
 *
 * @file config.js
 * @description Centralized configuration for the multiplayer survival game
 *
 * USAGE:
 * - Import at the top of any file: import { CONFIG } from './config.js';
 * - Access values: CONFIG.INVENTORY.BACKPACK_COLS
 *
 * ORGANIZATION:
 * - Grouped by feature/system
 * - All times in milliseconds
 * - All sizes in pixels unless noted
 * - Comments explain impact of changing values
 */

export const CONFIG = {

    // ==========================================
    // INVENTORY SYSTEM
    // ==========================================
    INVENTORY: {
        // Backpack grid dimensions
        BACKPACK_COLS: 5,      // Width of backpack grid in slots
        BACKPACK_ROWS: 10,     // Height of backpack grid in slots
        BACKPACK_TOTAL_SLOTS: 50, // Total backpack capacity

        // Crate storage dimensions
        CRATE_COLS: 10,        // Width of crate grid in slots
        CRATE_ROWS: 10,        // Height of crate grid in slots
        CRATE_TOTAL_SLOTS: 100, // Total crate capacity

        // Visual settings (adjusted dynamically based on window size)
        DEFAULT_SLOT_SIZE: 60,  // Default slot size in pixels
        DEFAULT_GAP: 2,         // Default gap between slots in pixels

        // Item positioning offsets (accounts for border + padding)
        BACKPACK_ITEMS_OFFSET_TOP: 4,  // Pixels from top of grid
        BACKPACK_ITEMS_OFFSET_LEFT: 4, // Pixels from left of grid
        CRATE_ITEMS_OFFSET_TOP: 2,     // Pixels from top of grid
        CRATE_ITEMS_OFFSET_LEFT: 2,    // Pixels from left of grid
    },

    // ==========================================
    // BUILD MENU
    // ==========================================
    BUILD_MENU: {
        COLS: 5,               // Width of build menu grid
        ROWS: 10,              // Height of build menu grid
        TOTAL_SLOTS: 50,       // Total build menu slots

        // Visual settings
        TARGET_HEIGHT_PERCENT: 0.65, // Use 65% of screen height for 10 rows
    },

    // ==========================================
    // COIN SYSTEM
    // ==========================================
    COIN: {
        // Item properties
        SIZE: { width: 1, height: 1 },  // Coins are 1x1 slot items

        // Behavior flags
        STACKABLE: true,        // Coins stack with quantity property
        TRANSFERABLE: true,     // Can be moved to crate/house storage
        SELLABLE: false,        // Cannot be sold at market

        // Starting amount (set in GameState.js)
        DEFAULT_STARTING_AMOUNT: 100,
    },

    // ==========================================
    // AMMO SYSTEM
    // ==========================================
    AMMO: {
        // Item properties
        SIZE: { width: 1, height: 1 },  // Ammo is 1x1 slot items

        // Behavior flags
        STACKABLE: true,        // Ammo stacks with quantity property
        MAX_STACK: 20,          // Maximum ammo per stack
        TRANSFERABLE: true,     // Can be moved to crate/house storage
        SELLABLE: true,         // Can be sold at market
    },

    // ==========================================
    // GAME LOOP INTERVALS (all in milliseconds)
    // ==========================================
    GAME_LOOP: {
        // Update intervals for periodic checks
        CHUNK_UPDATE_INTERVAL: 1000,          // How often to check for new chunks (1 second)
        PEER_CHECK_INTERVAL: 5000,            // How often to check peer connections (5 seconds)
        ACTION_PROGRESS_UPDATE_INTERVAL: 50,  // How often to update action progress UI (~3 frames at 60fps)
    },

    // ==========================================
    // FACTION SYSTEM
    // ==========================================
    // CRITICAL SYNC POINT: Must match server/AuthManager.js
    FACTIONS: {
        SOUTHGUARD: 1,
        NORTHMEN: 3
        // Note: Settlers (2) removed - only two factions now
    },

    FACTION_ZONES: {
        1: { name: 'Southguard', minZ: -50000, maxZ: 0 },
        3: { name: 'Northmen', minZ: 0, maxZ: 50000 }
    },

    FACTION_NAMES: {
        1: 'Southguard',
        3: 'Northmen'
    },

    // World bounds for neutral players
    WORLD_BOUNDS: {
        minX: -50000,
        maxX: 50000,
        minZ: -50000,
        maxZ: 50000
    },

    // ==========================================
    // COOKING/PROCESSING DURATIONS (all in milliseconds)
    // MUST match server ServerConfig.js COOKING values!
    // ==========================================
    COOKING: {
        FOOD_DURATION: 60000,           // 1 minute for fish, vegetables
        CLAY_CAMPFIRE_DURATION: 300000, // 5 minutes for clay in campfire/house
        CLAY_TILEWORKS_DURATION: 60000, // 1 minute for clay in tileworks
        SERVER_TICK_INTERVAL: 60000,    // Server checks completions every 60s
    },

    // ==========================================
    // ACTION DURATIONS (all in milliseconds)
    // ==========================================
    ACTIONS: {
        // Tree chopping
        CHOP_TREE_DURATION: 10000,      // 10 seconds to chop a tree
        CHOP_STRUCTURE_DURATION: 5000,   // 5 seconds to demolish structure

        // Resource harvesting
        HARVEST_LOG_DURATION: 10000,     // 10 seconds to harvest from log
        HARVEST_STONE_DURATION: 10000,   // 10 seconds to mine stone

        // Building
        BUILD_DURATION: 6000,            // 6 seconds to build structure

        // Crafting
        CHISELING_DURATION: 6000,        // 6 seconds to chisel stone
        COMBINE_DURATION: 6000,          // 6 seconds to combine items (vines -> rope, rope -> net)

        // Animation timings
        CHOPPING_ANIMATION_SPEED: 1.0,   // Playback speed for chopping animation
    },

    // ==========================================
    // TOOL DURABILITY
    // ==========================================
    TOOLS: {
        // Maximum durability for all tools
        MAX_DURABILITY: 100,

        // UNIVERSAL TOOL DURABILITY SYSTEM
        // All tools now use a dynamic durability system based on tool and resource quality
        // Formula: Durability Loss = resourceQuality / toolQuality
        //
        // For resource-based actions (axe, saw, pickaxe, chisel):
        //   - Better tools last longer (high tool quality = low durability loss)
        //   - Harder resources wear tools faster (high resource quality = high durability loss)
        //   Example: Tool Q100 + Resource Q100 = 1 loss
        //   Example: Tool Q100 + Resource Q50 = 1 loss
        //   Example: Tool Q50 + Resource Q100 = 2 loss
        //
        // For non-resource actions (hammer building):
        //   Formula: Durability Loss = 10 / toolQuality
        //   Example: Hammer Q100 = 1 loss per build
        //   Example: Hammer Q50 = 1 loss per build
        //
        // See implementation in:
        //   - ResourceManager.js (axe, saw, pickaxe)
        //   - CraftingSystem.js (chisel)
        //   - BuildingSystem.js (hammer)

        // DEPRECATED: Old flat durability loss values (no longer used)
        // AXE_DURABILITY_LOSS: 10,
        // SAW_DURABILITY_LOSS: 10,
        // PICKAXE_DURABILITY_LOSS: 10,
        // HAMMER_DURABILITY_LOSS: 5,
    },

    // ==========================================
    // HARVEST COOLDOWNS
    // ==========================================
    COOLDOWNS: {
        HARVEST_COOLDOWN: 2000,          // 2 second cooldown between harvests
    },

    // ==========================================
    // UI TIMINGS
    // ==========================================
    UI: {
        STATUS_LINE_DURATION: 3000,      // Status messages show for 3 seconds
        STATUS_LINE_LONG: 4000,          // Important messages show for 4 seconds
        STATUS_LINE_PERMANENT: 0,        // 0 = message stays until cleared

        TOOLTIP_DELAY: 0,                // Instant tooltip on hover
        DOUBLE_CLICK_TIME: 300,          // Max ms between clicks for double-click
    },

    // ==========================================
    // PERFORMANCE
    // ==========================================
    PERFORMANCE: {
        // Terrain height cache management
        // Using LRU (Least Recently Used) cache to prevent thrashing
        // 100,000 entries ≈ 8 MB, covers ~10 chunks of navigation data
        // Aggressive setting for maximum performance, handles fast movement & multiple AI
        maxCacheSize: 100000,             // Maximum entries in height cache before cleanup
    },

    // ==========================================
    // NETWORKING
    // ==========================================
    NETWORK: {
        // WebSocket reconnection
        RECONNECT_DELAY: 5000,           // Try reconnecting after 5 seconds
        MAX_RECONNECT_ATTEMPTS: 5,       // Maximum reconnection attempts

        // P2P Connection
        P2P_CONNECTION_TIMEOUT: 5000,    // 5 seconds to establish P2P connection
        P2P_STAGGER_DELAY: 100,          // 100ms between P2P connection attempts
        P2P_MAX_STAGGER_DELAY: 1000,     // Max 1 second stagger for multiple peers

        // Heartbeat/Keep-alive
        HEARTBEAT_INTERVAL: 30000,       // Send heartbeat every 30 seconds

        // Server message buffer
        MAX_MESSAGE_QUEUE: 100,          // Max queued messages during disconnect
    },

    // ==========================================
    // CAMERA AND CONTROLS
    // ==========================================
    CAMERA: {
        // Third person camera
        DEFAULT_DISTANCE: 6,            // Default camera distance from player
        MIN_DISTANCE: 4,                 // Minimum zoom distance
        MAX_DISTANCE: 30,                // Maximum zoom distance

        // Camera positioning
        HEIGHT_OFFSET: 5,                // Camera height above player
        LOOK_AT_OFFSET: 2,              // Height to look at on player model

        // Zoom controls
        ZOOM_SPEED: 2,                   // Zoom in/out increment
        ZOOM_SMOOTHING: 0.1,            // Camera movement smoothing (0-1)
    },

    // ==========================================
    // PLAYER MOVEMENT
    // ==========================================
    PLAYER: {
        MOVE_SPEED: 1.0,                 // Units per second
        ROTATION_SPEED: 0.2,             // Rotation lerp factor (0-1)

        // Pickup ranges
        OBJECT_PICKUP_RANGE: 5,          // Distance to interact with objects
        CONSTRUCTION_RANGE: 8,           // Distance to interact with construction
        CRATE_RANGE: 5,                  // Distance to access crate inventory
    },

    // ==========================================
    // CRATE CART LOADING
    // ==========================================
    CRATE_CART: {
        CART_HEIGHT_OFFSET: 0.2,         // Y position of crate on cart
        CART_Z_OFFSET: -0.1,             // Z position offset (negative = back)
        DROP_OFFSET: 0.4,                // Distance behind cart when unloading
        MIN_DROP_HEIGHT: -10,            // Minimum valid terrain height for drop
        MAX_DROP_HEIGHT: 100,            // Maximum valid terrain height for drop
        CLAIM_TIMEOUT: 10000,            // ms to wait for server response
    },

    // ==========================================
    // CART PHYSICS (Hitch-Point Towing)
    // ==========================================
    CART_PHYSICS: {
        // Hitch geometry
        HITCH_OFFSET: 0.4,           // Distance from cart center to hitch point (front of cart)
        TETHER_LENGTH: 0.3,          // Distance from player to hitch before cart starts moving

        // Movement
        CART_SPEED: 2.5,             // Max cart speed in units/second (slightly slower than player)
        PIVOT_SPEED: 0.08,           // Base rotation speed toward pull direction (0-1 lerp factor)
        MIN_MOVE_THRESHOLD: 0.01,    // Minimum pull distance to trigger movement
        MIN_DISTANCE_EPSILON: 0.001, // Minimum distance to avoid division by zero

        // Jackknife prevention (angle limits for emergency recovery only)
        MAX_SAFE_ANGLE: Math.PI * 0.35,      // ~63 degrees - normal pivot speed below this
        DANGER_ANGLE: Math.PI * 0.5,          // 90 degrees - emergency fast pivot above this
        EMERGENCY_PIVOT_SPEED: 0.3,           // Fast pivot speed for jackknife recovery

        // Vehicle-style movement when towing (prevents jackknifing)
        TOWING_TURN_RATE_MULTIPLIER: 0.6,    // Turn rate when moving forward with cart (player on foot)
        REQUIRE_FORWARD_TO_TURN: true,        // Must be moving forward to turn (vehicle-style)

        // Reverse mode (S key) - straight backup aligned with cart
        REVERSE_SPEED_MULTIPLIER: 0.3,        // 30% of normal speed when reversing
        REVERSE_ALIGN_SPEED: 0.15,            // How fast player/horse aligns to cart direction
        REVERSE_TURNING_ALLOWED: false,       // No A/D turning while reversing

        // Speed penalties when towing (applies to both player and horse)
        EMPTY_CART_SPEED_MULTIPLIER: 0.9,     // 10% slower with empty cart
        LOADED_CART_SPEED_MULTIPLIER: 0.5,    // 50% slower with cart + crate

        // Road speed bonus (applies to horse - player already has this)
        ROAD_SPEED_MULTIPLIER: 1.6,           // 60% faster on roads (matches player)

        // Network sync
        BROADCAST_INTERVAL: 150,              // ms between P2P broadcasts

        // Mounted (horse) towing adjustments
        MOUNTED_TURN_RATE_MULTIPLIER: 0.6,   // Horse turns 40% slower when cart attached
    },

    // ==========================================
    // WASD MOVEMENT
    // ==========================================
    WASD: {
        ENABLED: true,
        TARGET_DISTANCE: 2.0,            // How far ahead to project movement target
        BROADCAST_INTERVAL: 100,         // ms between P2P broadcasts during WASD movement
    },

    // ==========================================
    // PEER AVATAR MOVEMENT
    // ==========================================
    PEER_AVATAR: {
        UPDATE_INTERVAL: 100,            // Expected ms between position updates
        MAX_SPEED: 0.008,                // Max units/ms (increased for smoother catch-up at faster update rate)
        SNAP_THRESHOLD: 15,              // Distance above which to teleport instead of walk
        STOP_THRESHOLD: 0.1,             // Distance below which to stop and idle
    },

    // ==========================================
    // SPAWN SETTINGS
    // ==========================================
    SPAWN: {
        FRIEND_SPAWN_GIVES_DEFAULT_INVENTORY: true,  // Set to false to revert to normal behavior
    },

    // ==========================================
    // OBJECT SPAWNING
    // ==========================================
    OBJECTS: {
        // Tree types and spawn weights
        TREE_TYPES: ['oak', 'pine', 'fir', 'cypress', 'apple'],

        // Rock types
        ROCK_TYPES: ['limestone', 'sandstone', 'clay', 'iron'],

        // Quality ranges (affects durability/resources)
        MIN_QUALITY: 10,                 // Minimum quality for spawned objects
        MAX_QUALITY: 100,                // Maximum quality for spawned objects

        // Resource amounts for logs
        LOG_MIN_RESOURCES: 5,            // Minimum resources in a log
        LOG_MAX_RESOURCES: 20,           // Maximum resources in a log
    },

    // ==========================================
    // CHUNK SYSTEM
    // ==========================================
    CHUNKS: {
        CHUNK_SIZE: 50,                  // World units per chunk (matches terrain.js)
        LOAD_RADIUS: 10,                 // Load chunks in 21x21 grid = 500 units (matches terrain/fog distance)
                                         // Used by client AND server for proximity
        PHYSICS_RADIUS: 1,               // Physics colliders in 3x3 grid (interaction only)
                                         // Reduced from 2 for performance
        UNLOAD_DISTANCE: 11,             // Unload chunks beyond 11 chunks (just past load radius)

        // Chunk boundaries
        MIN_CHUNK_X: -15,                // Western boundary
        MAX_CHUNK_X: 15,                 // Eastern boundary
        MIN_CHUNK_Z: -15,                // Northern boundary
        MAX_CHUNK_Z: 15,                 // Southern boundary
    },

    // ==========================================
    // WATER SYSTEM
    // ==========================================
    WATER: {
        // Water surface height (terrain below this is underwater)
        LEVEL: 0,

        // Minimum terrain height for walkable areas (same as water level = no wading)
        MIN_WALKABLE_HEIGHT: 0,

        // Movement restrictions
        BLOCK_ALL_WATER: true,           // Blocks all movement into water
        ALLOW_WADING: false,             // Future: Allow shallow water wading
        WADING_DEPTH: 0.5,               // Future: Maximum wading depth
        ALLOW_SWIMMING: false,           // Future: Swimming mechanics

        // Water rendering
        PLANE_SIZE: 3000,                // Size of water plane
        SEGMENTS: 512,                   // Water mesh resolution

        // Wave parameters
        WAVE_STRENGTH: 0.3,              // Wave height multiplier
        WAVE_SPEED: 0.5,                 // Wave animation speed
        WAVE_DAMPING_MIN: 0.2,           // Minimum wave damping
        WAVE_DAMPING_MAX: 1.0,           // Maximum wave damping

        // Foam parameters
        FOAM_DEPTH_START: 1.5,           // Depth where foam starts
        FOAM_DEPTH_MAX: 0.5,            // Depth of maximum foam
        FOAM_OPACITY: 0.6,               // Foam transparency

        // Deep water threshold
        DEEP_WATER_DEPTH: 2.0,           // Depth considered "deep water"
    },

    // ==========================================
    // SKYBOX SYSTEM
    // ==========================================
    SKYBOX: {
        // Skybox type: 'gradient', 'solid', 'sphere', 'cylinder', 'cubemap', 'none'
        TYPE: 'cylinder',

        // Enabled by default
        ENABLED: true,

        // Gradient skybox colors (hex values)
        GRADIENT: {
            TOP: 0x0077BE,               // Sky blue at top
            BOTTOM: 0xE0F6FF,            // Light blue at bottom (horizon)
        },

        // Solid color skybox (hex value)
        SOLID_COLOR: 0x87CEEB,           // Sky blue

        // Sphere skybox settings (for 2:1 equirectangular images)
        SPHERE: {
            TEXTURE_PATH: './textures/skybox/sky.png',  // Path to equirectangular image
            RADIUS: 5000,                // Sphere radius
        },

        // Cylindrical skybox settings (for wide panoramic images)
        CYLINDER: {
            TEXTURE_PATH: './textures/skybox/sky.png',  // Path to panoramic image
            RADIUS_X: 139,               // Cylinder X-axis radius (east-west)
            RADIUS_Z: 86,                // Cylinder Z-axis radius (north-south)
            HEIGHT: 146,                 // Cylinder height in world units (actual geometry size)
            Y_OFFSET: 30,                // Vertical offset from camera position
            SCROLL_SPEED: 0.0012,        // Cloud scrolling speed (higher = faster)
        },

        // Cube map skybox settings
        CUBEMAP: {
            TEXTURE_PATHS: {
                px: './textures/skybox/px.jpg',  // Positive X (right)
                nx: './textures/skybox/nx.jpg',  // Negative X (left)
                py: './textures/skybox/py.jpg',  // Positive Y (top)
                ny: './textures/skybox/ny.jpg',  // Negative Y (bottom)
                pz: './textures/skybox/pz.jpg',  // Positive Z (front)
                nz: './textures/skybox/nz.jpg',  // Negative Z (back)
            }
        },
    },

    // ==========================================
    // CONSTRUCTION SYSTEM
    // ==========================================
    CONSTRUCTION: {
        // Grid dimensions for collision detection (in world units)
        // These define the footprint each structure occupies for placement collision
        GRID_DIMENSIONS: {
            dock: { width: 1.0, depth: 10.0, height: 3.0 },

            // Structures
            crate: { width: 0.25, depth: 0.25, height: 1.5 },
            house: { width: 1.0, depth: 1.0, height: 4.0 },
            campfire: { radius: 0.25, height: 1.5 },
            garden: { width: 1.0, depth: 1.0, height: 1.5 },
            tileworks: { width: 2.0, depth: 2.0, height: 3.0 },  // 2x2 production building
            road: { width: 0.2, depth: 0.2, height: 0.01 },  // Small footprint for tight spaces, minimal height
            market: { width: 2.0, depth: 8.0, height: 4.0 },

            // Standalone structures
            outpost: { width: 1.0, depth: 1.0, height: 4.0 },
            tent: { width: 1.0, depth: 1.0, height: 2.0 },
            ship: { width: 2.0, depth: 4.0, height: 3.0 },
            boat: { width: 0.3, depth: 1.0, height: 1.5 },
            horse: { radius: 0.15, height: 2.0 },
            cart: { radius: 0.3, height: 3.0 },  // Scaled 2x

            // Natural objects (trees use radius-based collision)
            // Trees - cylindrical bounds (reduced by 20%)
            // Height added for proper collision detection
            // dirtRadius: size of dirt patch rendered under object
            oak: { radius: 1.4, height: 3.0, dirtRadius: 3.5 },
            oak2: { radius: 1.4, height: 3.0, dirtRadius: 3.5 },
            pine: { radius: 0.3, height: 3.0, dirtRadius: 1.0 },
            pine2: { radius: 0.3, height: 3.0, dirtRadius: 1.0 },
            fir: { radius: 0.3, height: 3.0, dirtRadius: 1.0 },
            cypress: { radius: 0.12, height: 3.0, dirtRadius: 1.0 },
            apple: { radius: 0.4, height: 2.0, dirtRadius: 1.0 },
            vegetables: { radius: 0.2, height: 0.5, dirtRadius: 0.5 },

            // Planted trees (same dimensions as natural - reserve space for growth)
            planted_pine: { radius: 0.3, height: 3.0, dirtRadius: 1.0 },
            planted_fir: { radius: 0.3, height: 3.0, dirtRadius: 1.0 },
            planted_apple: { radius: 0.4, height: 2.0, dirtRadius: 1.0 },
            planted_vegetables: { radius: 0.2, height: 0.5, dirtRadius: 0.5 },

            // Logs - rectangular bounds (all logs use same dimensions)
            // height: 0.01 allows players to walk over logs while keeping interaction
            oak_log: { width: 0.1, depth: 1.5, height: 0.01 },
            pine_log: { width: 0.1, depth: 1.5, height: 0.01 },
            fir_log: { width: 0.1, depth: 1.5, height: 0.01 },
            cypress_log: { width: 0.1, depth: 1.5, height: 0.01 },
            apple_log: { width: 0.1, depth: 1.5, height: 0.01 },
            log: { width: 0.1, depth: 1.5, height: 0.01 },

            // Rocks
            limestone: { radius: 0.25, height: 1.0, dirtRadius: 0.75 },
            sandstone: { radius: 0.25, height: 1.0, dirtRadius: 0.75 },
            clay: { radius: 0.25, height: 1.0, dirtRadius: 0.75 },
            iron: { radius: 0.25, height: 1.0, dirtRadius: 0.75 },

            // Construction site models
            construction: { width: 1.0, depth: 1.0, height: 2.0 },
            '2x8construction': { width: 2.0, depth: 8.0, height: 2.0 },
            '10x1construction': { width: 1.0, depth: 10.0, height: 2.0 }
        },

        // Construction model mapping - maps structure types to their construction site models
        // Structures not listed here will use the default 'construction' model
        CONSTRUCTION_MODELS: {
            market: '2x8construction',
            dock: '10x1construction',
            tileworks: '2x2construction'
            // Add more mappings here as needed (e.g., house: 'houseconstruction')
        },

        // Material requirements for different structures
        MATERIALS: {
            crate: {
                oakplank: 1
            },
            tent: {
                oakplank: 1,
                rope: 1
            },
            outpost: {
                oakplank: 1
            },
            house: {
                oakplank: 1,
                chiseledlimestone: 1,
                tile: 1
            },
            campfire: {
                limestone: 1
            },
            ship: {
                oakplank: 1
            },
            boat: {
                oakplank: 1
            },
            market: {
                oakplank: 1,
                chiseledlimestone: 1,
                tile: 1
            },
            garden: {
                chiseledlimestone: 1,
                vegetableseeds: 1,
                appleseed: 1
            },
            road: {
                chiseledlimestone: 1
            },
            dock: {
                oakplank: 1
            },
            tileworks: {
                oakplank: 1,
                chiseledlimestone: 1,
                tile: 1
            },
            horse: {
                vegetables: 1    // Feed requires 1 vegetables
            },
            cart: {
                oakplank: 1   // Any plank type works (validated by isPlankType helper)
            }
        },

        // Structure-specific properties
        STRUCTURE_PROPERTIES: {
            house: {
                height: 3.0,  // Height of house model at scale 0.5
                inventorySize: { rows: 10, cols: 10 }
            },
            campfire: {
                height: 1.5,  // Height of campfire model
                inventorySize: { rows: 4, cols: 4 }
            },
            tent: {
                height: 2.0,  // Height of tent model at scale 0.5
                inventorySize: { rows: 10, cols: 10 }
            },
            ship: {
                animationSpeed: 0.5,  // Wave rocking speed
                animationAmplitude: 0.05,  // Rocking angle in radians
                waveBobAmplitude: 0.25,  // Vertical bob amplitude (max wave height ~0.44)
                waveBobSpeed: 0.4  // Vertical bob speed
            },
            boat: {
                animationSpeed: 0.5,  // Wave rocking speed (same as ship)
                animationAmplitude: 0.05,  // Rocking angle in radians
                waveBobAmplitude: 0.25,  // Vertical bob amplitude
                waveBobSpeed: 0.4  // Vertical bob speed
            },
            market: {
                inventorySize: { rows: 10, cols: 10 }  // Standard 10x10 inventory
            },
            garden: {
                height: 1.5,  // Height of garden model
                inventorySize: { rows: 2, cols: 2 }
            },
            tileworks: {
                height: 3.0,  // Height of tileworks model
                inventorySize: { rows: 10, cols: 10 }
            },
            apple: {
                height: 2.0,  // Height of apple tree model
                inventorySize: { rows: 3, cols: 3 }  // 3x3 grid for apples
            },
            dock: {
                deckHeight: 1.0,          // Fixed Y height for player walking on dock
                physicsOffset: -1.5,      // Y offset for physics collider (top at deck level)
                raycastBoxOffset: -1.5    // Y offset for raycast collision box (aligned with physics)
            }
        },

        // Quality caps for structures (limits max quality regardless of materials)
        STRUCTURE_QUALITY_CAPS: {
            tent: 15,       // Max quality 15 = ~48.6 hours lifespan (2 days)
            campfire: 2,    // Max quality 2 = ~1.6 hours lifespan
            boat: 15,       // Max quality 15 = ~48.6 hours lifespan (2 days)
            horse: 15,      // Max quality 15 = ~48.6 hours lifespan (2 days)
            cart: 15,       // Max quality 15 = ~48.6 hours lifespan (2 days)
            crate: 15       // Max quality 15 = ~48.6 hours lifespan (2 days)
        },

        // Placement rules
        REQUIRE_HAMMER: true,            // Hammer required to build
    },

    // ==========================================
    // RENDERING SETTINGS
    // ==========================================
    RENDERING: {
        // Tone mapping for more cinematic appearance
        TONE_MAPPING: true,                  // Enable ACES Filmic tone mapping
        TONE_MAPPING_EXPOSURE: 0.5,          // Exposure level (0.5-2.0)
        MAX_PIXEL_RATIO: 2,                  // Cap pixel ratio for performance

        // Fog settings for atmospheric haze (linear fog)
        FOG_ENABLED: true,                   // Enable distance fog
        FOG_TYPE: 'linear',                  // 'linear' or 'exponential'
        FOG_COLOR: 0x99bbdd,                 // Fog color (matches terrain5 sky)
        FOG_NEAR: 300,                       // Distance where fog starts
        FOG_FAR: 500,                        // Distance where fog is fully opaque
        FOG_DENSITY: 0.02,                   // Fog density (only used if FOG_TYPE is 'exponential')
    },

    // ==========================================
    // SKY SETTINGS
    // ==========================================
    SKY: {
        // Sun position
        SUN_ELEVATION: 90,                   // Degrees above horizon (0-90)
        SUN_AZIMUTH: 180,                    // Degrees around horizon

        // Atmosphere parameters
        TURBIDITY: 2,                        // Atmospheric turbidity (haziness)
        RAYLEIGH: 1,                         // Rayleigh scattering coefficient
        MIE_COEFFICIENT: 0.003,              // Mie scattering coefficient
        MIE_DIRECTIONAL_G: 0.7,              // Mie scattering direction
    },

    // ==========================================
    // LIGHTING SETTINGS
    // ==========================================
    LIGHTING: {
        // Sun light (warm directional light)
        SUN_COLOR: 0xfff5e1,                 // Warm cream color
        SUN_INTENSITY: 0.7,                  // Sun brightness

        // Sky light (hemisphere light for ambient)
        SKY_COLOR: 0xb3d9f2,                 // Cool blue sky
        GROUND_COLOR: 0x8b7355,              // Warm brown ground
        SKY_INTENSITY: 0.7,                  // Sky light brightness
    },

    // ==========================================
    // AUDIO SETTINGS
    // ==========================================
    AUDIO: {
        // Volume levels (0.0 to 1.0)
        MASTER_VOLUME: 0.3,              // Overall volume

        // Sound effect volumes (relative to master)
        AXE_VOLUME: 1.0,
        SAW_VOLUME: 1.0,
        PICKAXE_VOLUME: 1.0,
        HAMMER_VOLUME: 1.0,
        CHISEL_VOLUME: 1.0,
        FOOTSTEP_VOLUME: 0.5,

        // Audio distances
        MIN_DISTANCE: 1,                 // Full volume within this distance
        MAX_DISTANCE: 20,                // No sound beyond this distance
        ROLLOFF_FACTOR: 1,              // How quickly sound fades with distance

        // Ambient sound settings (altitude-based with continent proximity)
        // Ocean: Y -30 to 10 (full at 4, fades out by 10), requires ocean proximity
        // Plains: Y 0-22 (fade in 0→4, full 4-18, fade out 18→22), land only
        // Mountain: Y 18+ (fade in 18→22, full 22+), land only
        OCEAN_SOUND_MAX_VOLUME: 0.15,
        PLAINS_SOUND_MAX_VOLUME: 0.15,
        MOUNTAIN_SOUND_MAX_VOLUME: 0.3,
        AMBIENT_CROSSFADE_DURATION: 6,  // Seconds for crossfade between loops

        // Campfire ambient sound settings
        CAMPFIRE_SOUND_MIN_DISTANCE: 1,  // Full volume within 1 unit
        CAMPFIRE_SOUND_MAX_DISTANCE: 7,  // Silent at 7 units
        CAMPFIRE_SOUND_MAX_VOLUME: 0.2,  // Maximum volume for campfire sound
        CAMPFIRE_CROSSFADE_DURATION: 6,  // Seconds for crossfade between loops
    },

    // ==========================================
    // MARKET SYSTEM
    // ==========================================
    MARKET: {
        // Starting quantity for each item (when market is first created)
        DEFAULT_QUANTITY: 10,

        // Items that track durability (tools, weapons, and food)
        DURABILITY_ITEMS: [
            'axe', 'saw', 'pickaxe', 'hammer', 'chisel', 'fishingnet',  // Tools
            'rifle',  // Weapons
            'apple', 'vegetables', 'fish', 'cookedfish', 'cookedmeat', 'roastedvegetables', 'mushroom', 'rawmeat'  // Food
        ],

        // Item prices and quantity limits
        // buyPrice: what player pays to buy from market
        // sellPrice: what player receives when selling to market
        PRICES: {
            // Stone Materials (1 coin = 1 minute of work)
            limestone: { buyPrice: 3, sellPrice: 2, minQuantity: 0, maxQuantity: 300 },
            sandstone: { buyPrice: 3, sellPrice: 2, minQuantity: 0, maxQuantity: 300 },
            granite: { buyPrice: 3, sellPrice: 2, minQuantity: 0, maxQuantity: 300 },
            clay: { buyPrice: 3, sellPrice: 2, minQuantity: 0, maxQuantity: 300 },
            chiseledlimestone: { buyPrice: 6, sellPrice: 4, minQuantity: 0, maxQuantity: 300 },
            chiseledsandstone: { buyPrice: 6, sellPrice: 4, minQuantity: 0, maxQuantity: 300 },
            chiseledgranite: { buyPrice: 6, sellPrice: 4, minQuantity: 0, maxQuantity: 300 },
            tile: { buyPrice: 12, sellPrice: 8, minQuantity: 0, maxQuantity: 300 },

            // Metal/Ore
            iron: { buyPrice: 3, sellPrice: 2, minQuantity: 0, maxQuantity: 300 },

            // Wood Materials
            oakplank: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },
            pineplank: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },
            firplank: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },
            cypressplank: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },
            oakfirewood: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },
            pinefirewood: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },
            firfirewood: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },
            cypressfirewood: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },
            appleplank: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },
            applefirewood: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },
            rope: { buyPrice: 8, sellPrice: 5, minQuantity: 0, maxQuantity: 300 },

            // Seeds
            vegetableseeds: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },
            appleseed: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },
            pineseed: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },
            firseed: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },

            // Food
            apple: { buyPrice: 1, sellPrice: 1, minQuantity: 0, maxQuantity: 300 },
            vegetables: { buyPrice: 20, sellPrice: 14, minQuantity: 0, maxQuantity: 300 },
            roastedvegetables: { buyPrice: 30, sellPrice: 21, minQuantity: 0, maxQuantity: 300 },
            mushroom: { buyPrice: 1, sellPrice: 1, minQuantity: 0, maxQuantity: 300 },
            fish: { buyPrice: 20, sellPrice: 14, minQuantity: 0, maxQuantity: 300 },
            cookedfish: { buyPrice: 30, sellPrice: 21, minQuantity: 0, maxQuantity: 300 },
            rawmeat: { buyPrice: 50, sellPrice: 35, minQuantity: 0, maxQuantity: 300 },
            cookedmeat: { buyPrice: 60, sellPrice: 42, minQuantity: 0, maxQuantity: 300 },

            // Tools
            axe: { buyPrice: 60, sellPrice: 42, minQuantity: 0, maxQuantity: 300 },
            saw: { buyPrice: 60, sellPrice: 42, minQuantity: 0, maxQuantity: 300 },
            pickaxe: { buyPrice: 60, sellPrice: 42, minQuantity: 0, maxQuantity: 300 },
            hammer: { buyPrice: 60, sellPrice: 42, minQuantity: 0, maxQuantity: 300 },
            chisel: { buyPrice: 60, sellPrice: 42, minQuantity: 0, maxQuantity: 300 },
            fishingnet: { buyPrice: 20, sellPrice: 14, minQuantity: 0, maxQuantity: 300 },

            // Weapons
            rifle: { buyPrice: 200, sellPrice: 140, minQuantity: 0, maxQuantity: 300 },
            ammo: { buyPrice: 10, sellPrice: 7, minQuantity: 0, maxQuantity: 300 },

            // Mounts
            horse: { buyPrice: 200, sellPrice: 140, minQuantity: 0, maxQuantity: 10 }
        }
    },

    // ==========================================
    // DEBUG SETTINGS
    // ==========================================
    // ==========================================
    // NETWORKING
    // ==========================================
    NETWORKING: {
        // TOGGLE THIS TO SWITCH BETWEEN LOCAL AND ONLINE SERVER
        USE_ONLINE_SERVER: true,        // Set to true to connect to Render servers

        // Server URLs (no need to edit these unless servers change)
        LOCAL_SERVER_URL: 'ws://localhost:8080',
        ONLINE_SERVER_URL: 'wss://multiplayer-game-dcwy.onrender.com',

        // Client URL for reference
        ONLINE_CLIENT_URL: 'https://multiplayer-game-client.onrender.com/client.html'
    },

    DEBUG: {
        SHOW_CHUNK_BORDERS: false,       // Display chunk boundaries
        SHOW_COLLISION_BOXES: false,     // Display collision boxes
        SHOW_NETWORK_STATS: false,       // Display network statistics
        LOG_NETWORK_MESSAGES: false,     // Log all network traffic to console
        LOG_STATE_CHANGES: false,        // Log game state changes
        DISABLE_FOG: false,              // Disable fog for better visibility
    },

    // ==========================================
    // BANDIT CAMP SYSTEM
    // ==========================================
    BANDIT_CAMPS: {
        ENABLED: true,                   // Enable bandit camp generation
        CHUNK_PROBABILITY: 3,            // 1 in 3 eligible chunks have camps

        // Camp composition
        MIN_TENTS: 1,                    // Minimum tents per camp
        MAX_TENTS: 3,                    // Maximum tents per camp
        MIN_OUTPOSTS: 0,                 // Minimum outposts per camp
        MAX_OUTPOSTS: 2,                 // Maximum outposts per camp

        // Structure placement
        PLACEMENT_RADIUS_TIERS: [4, 6, 8],    // Try these radii in order (tighter cluster)
        PLACEMENT_ATTEMPTS_PER_TIER: 12,      // Attempts per radius tier
        MIN_STRUCTURE_SEPARATION: 1.5,        // Minimum units between structures (1x1 structures)

        // Bandit AI behavior
        DETECTION_RANGE: 15,             // Units - matches max rifle range
        WAIT_DURATION_MS: 30000,         // 30 seconds at target before returning
        RESPAWN_TIME_MS: 120000,         // 2 minutes after death before respawn

        // Spawning
        SPAWN_TRIGGER_DISTANCE: 50,      // Player distance to trigger spawning
    },

    // ==========================================
    // TRAPPER NPC SYSTEM
    // ==========================================
    TRAPPER_CAMPS: {
        ENABLED: true,                   // Enable trapper NPC generation
        INTERACTION_RADIUS: 2.0,         // Units for player interaction
        NPC_COLOR: 0x8B4513,             // Brown/leather shirt color
        INFO_COST: 5,                    // Cost in coins for resource info
        SEED_OFFSET: 500000,             // Seed offset for deterministic placement
        NPC_OFFSET_X: 2.5,               // NPC offset from tent (X axis)
        NPC_OFFSET_Z: 0.5,               // NPC offset from tent (Z axis)
    }
};

// ==========================================
// COMPUTED VALUES
// ==========================================
// These are derived from the base config values
// They're computed once at startup for efficiency

export const COMPUTED = {
    // Total inventory slots
    BACKPACK_TOTAL: CONFIG.INVENTORY.BACKPACK_COLS * CONFIG.INVENTORY.BACKPACK_ROWS,
    CRATE_TOTAL: CONFIG.INVENTORY.CRATE_COLS * CONFIG.INVENTORY.CRATE_ROWS,

    // Action durations in seconds (for display)
    CHOP_TREE_SECONDS: CONFIG.ACTIONS.CHOP_TREE_DURATION / 1000,
    BUILD_SECONDS: CONFIG.ACTIONS.BUILD_DURATION / 1000,

    // Chunk boundaries as coordinate range
    CHUNK_X_RANGE: CONFIG.CHUNKS.MAX_CHUNK_X - CONFIG.CHUNKS.MIN_CHUNK_X,
    CHUNK_Z_RANGE: CONFIG.CHUNKS.MAX_CHUNK_Z - CONFIG.CHUNKS.MIN_CHUNK_Z,
};

// ==========================================
// EXPORT AS DEFAULT TOO
// ==========================================
// This allows both named and default imports
export default CONFIG;
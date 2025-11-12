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
    // GAME LOOP INTERVALS (all in milliseconds)
    // ==========================================
    GAME_LOOP: {
        // Update intervals for periodic checks
        CHUNK_UPDATE_INTERVAL: 1000,          // How often to check for new chunks (1 second)
        PEER_CHECK_INTERVAL: 5000,            // How often to check peer connections (5 seconds)
        ACTION_PROGRESS_UPDATE_INTERVAL: 50,  // How often to update action progress UI (~3 frames at 60fps)
    },

    // ==========================================
    // WATER AND TERRAIN BOUNDARIES
    // ==========================================

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
        // Formula: Durability Loss = (10 * resourceQuality) / toolQuality
        //
        // For resource-based actions (axe, saw, pickaxe, chisel):
        //   - Better tools last longer (high tool quality = low durability loss)
        //   - Harder resources wear tools faster (high resource quality = high durability loss)
        //   Example: Tool Q100 + Resource Q100 = 10 loss
        //   Example: Tool Q100 + Resource Q50 = 5 loss
        //   Example: Tool Q50 + Resource Q100 = 20 loss
        //
        // For non-resource actions (hammer building):
        //   Formula: Durability Loss = 100 / toolQuality
        //   Example: Hammer Q100 = 1 loss per build
        //   Example: Hammer Q50 = 2 loss per build
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
        DEFAULT_DISTANCE: 10,            // Default camera distance from player
        MIN_DISTANCE: 5,                 // Minimum zoom distance
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
        MOVE_SPEED: 5,                   // Units per second
        ROTATION_SPEED: 0.2,             // Rotation lerp factor (0-1)

        // Pickup ranges
        OBJECT_PICKUP_RANGE: 5,          // Distance to interact with objects
        CONSTRUCTION_RANGE: 8,           // Distance to interact with construction
        CRATE_RANGE: 5,                  // Distance to access crate inventory
    },

    // ==========================================
    // OBJECT SPAWNING
    // ==========================================
    OBJECTS: {
        // Tree types and spawn weights
        TREE_TYPES: ['oak', 'pine', 'fir', 'cypress'],

        // Rock types
        ROCK_TYPES: ['limestone', 'sandstone', 'clay'],

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
        LOAD_RADIUS: 2,                  // Load chunks in NxN grid (1=3x3, 2=5x5, etc)
                                         // Used by client AND server for proximity
        PHYSICS_RADIUS: 1,               // Physics colliders only in 3x3 grid (1=3x3, 2=5x5, etc)
                                         // Smaller than LOAD_RADIUS for performance
        UNLOAD_DISTANCE: 3,              // Unload chunks beyond 3 chunks

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
        LEVEL: 1.02,

        // Minimum terrain height for walkable areas (same as water level = no wading)
        MIN_WALKABLE_HEIGHT: 1.02,

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
            HEIGHT: 73,                  // Cylinder height in world units (actual geometry size)
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
            dock: { width: 1.0, depth: 10.0, height: 2.0 },

            // Structures
            crate: { width: 1.0, depth: 1.0, height: 1.5 },
            house: { width: 1.0, depth: 1.0, height: 4.0 },
            garden: { width: 1.0, depth: 1.0, height: 1.5 },
            market: { width: 2.0, depth: 8.0, height: 4.0 },

            // Standalone structures
            outpost: { width: 1.0, depth: 1.0, height: 4.0 },
            tent: { width: 1.0, depth: 1.0, height: 2.0 },
            ship: { width: 2.0, depth: 4.0, height: 3.0 },

            // Natural objects (trees use radius-based collision)
            // Trees - cylindrical bounds (reduced by 20%)
            oak: { radius: 1.4 },      // diameter 2.8 (was 3.5)
            oak2: { radius: 1.4 },     // oak variant
            pine: { radius: 0.48 },    // diameter 0.96 (was 1.2)
            pine2: { radius: 0.48 },   // pine variant
            fir: { radius: 0.4 },      // diameter 0.8 (was 1.0)
            cypress: { radius: 0.12 }, // diameter 0.24 (was 0.3)

            // Logs - rectangular bounds (all logs use same dimensions)
            oak_log: { width: 0.2, depth: 2.0 },
            pine_log: { width: 0.2, depth: 2.0 },
            fir_log: { width: 0.2, depth: 2.0 },
            cypress_log: { width: 0.2, depth: 2.0 },
            log: { width: 0.2, depth: 2.0 },  // generic log item

            // Rocks
            limestone: { radius: 0.25 },  // diameter 0.5
            sandstone: { radius: 0.25 },  // diameter 0.5
            clay: { radius: 0.5 },  // diameter 1.0

            // Construction site models
            construction: { width: 1.0, depth: 1.0, height: 2.0 },
            '2x8construction': { width: 2.0, depth: 8.0, height: 2.0 },
            '10x1construction': { width: 1.0, depth: 10.0, height: 2.0 }
        },

        // Construction model mapping - maps structure types to their construction site models
        // Structures not listed here will use the default 'construction' model
        CONSTRUCTION_MODELS: {
            market: '2x8construction',
            dock: '10x1construction'
            // Add more mappings here as needed (e.g., house: 'houseconstruction')
        },

        // Material requirements for different structures
        MATERIALS: {
            outpost: {
                oakplank: 1
            },
            house: {
                oakplank: 1
            },
            ship: {
                oakplank: 1
            },
            market: {
                oakplank: 1
            },
            garden: {
                chiseledlimestone: 1
            },
            dock: {
                oakplank: 1
            }
        },

        // Structure-specific properties
        STRUCTURE_PROPERTIES: {
            house: {
                height: 3.0,  // Height of house model at scale 0.5
                inventorySize: { rows: 10, cols: 10 }
            },
            ship: {
                animationSpeed: 0.5,  // Wave rocking speed
                animationAmplitude: 0.05  // Rocking angle in radians
            },
            market: {
                inventorySize: { rows: 10, cols: 10 }  // Standard 10x10 inventory
            },
            garden: {
                height: 1.5,  // Height of garden model
                inventorySize: { rows: 2, cols: 2 }
            }
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
        TONE_MAPPING_EXPOSURE: 1.2,          // Exposure level (0.5-2.0)

        // Fog settings for atmospheric haze (terrain/water/objects)
        FOG_ENABLED: true,                   // Enable distance fog
        FOG_COLOR: 0x376290,                 // Fog color (matches skybox horizon)
        FOG_DENSITY: 0.02,                   // Fog density (optimized for oval skybox)

        // Skybox height-based fog (Y-level fog)
        SKYBOX_FOG_HEIGHT_MIN: 6,            // Y level where fog is maximum (slightly above ground)
        SKYBOX_FOG_HEIGHT_MAX: 38,           // Y level where fog is zero (clear sky)
    },

    // ==========================================
    // LIGHTING SETTINGS
    // ==========================================
    LIGHTING: {
        // Sun light (warm directional light)
        SUN_COLOR: 0xfff5e1,                 // Warm cream color
        SUN_INTENSITY: 1.5,                  // Sun brightness

        // Sky light (hemisphere light for ambient)
        SKY_COLOR: 0xb3d9f2,                 // Cool blue sky
        GROUND_COLOR: 0x8b7355,              // Warm brown ground
        SKY_INTENSITY: 0.6,                  // Sky light brightness
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
    },

    // ==========================================
    // MARKET SYSTEM
    // ==========================================
    MARKET: {
        // Starting quantity for each item (when market is first created)
        DEFAULT_QUANTITY: 10,

        // Item prices and quantity limits
        // buyPrice: what player pays to buy from market
        // sellPrice: what player receives when selling to market
        PRICES: {
            // Materials
            limestone: { buyPrice: 15, sellPrice: 10, minQuantity: 0, maxQuantity: 100 },
            sandstone: { buyPrice: 20, sellPrice: 15, minQuantity: 0, maxQuantity: 100 },
            clay: { buyPrice: 12, sellPrice: 8, minQuantity: 0, maxQuantity: 100 },
            oakplank: { buyPrice: 30, sellPrice: 20, minQuantity: 0, maxQuantity: 100 },
            pineplank: { buyPrice: 30, sellPrice: 20, minQuantity: 0, maxQuantity: 100 },
            firplank: { buyPrice: 30, sellPrice: 20, minQuantity: 0, maxQuantity: 100 },
            cypressplank: { buyPrice: 30, sellPrice: 20, minQuantity: 0, maxQuantity: 100 },
            oakfirewood: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 200 },
            pinefirewood: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 200 },
            firfirewood: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 200 },
            cypressfirewood: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 200 },
            chiseledlimestone: { buyPrice: 25, sellPrice: 18, minQuantity: 0, maxQuantity: 100 },
            chiseledsandstone: { buyPrice: 30, sellPrice: 22, minQuantity: 0, maxQuantity: 100 },

            // Food
            apple: { buyPrice: 8, sellPrice: 5, minQuantity: 0, maxQuantity: 150 },
            vegetables: { buyPrice: 12, sellPrice: 8, minQuantity: 0, maxQuantity: 150 },
            fish: { buyPrice: 15, sellPrice: 10, minQuantity: 0, maxQuantity: 150 },
            cookedfish: { buyPrice: 20, sellPrice: 14, minQuantity: 0, maxQuantity: 150 },
            cookedmeat: { buyPrice: 30, sellPrice: 20, minQuantity: 0, maxQuantity: 150 },

            // Tools
            axe: { buyPrice: 100, sellPrice: 70, minQuantity: 0, maxQuantity: 20 },
            saw: { buyPrice: 100, sellPrice: 70, minQuantity: 0, maxQuantity: 20 },
            pickaxe: { buyPrice: 100, sellPrice: 70, minQuantity: 0, maxQuantity: 20 },
            hammer: { buyPrice: 80, sellPrice: 55, minQuantity: 0, maxQuantity: 20 },
            chisel: { buyPrice: 80, sellPrice: 55, minQuantity: 0, maxQuantity: 20 },
            fishingnet: { buyPrice: 100, sellPrice: 70, minQuantity: 0, maxQuantity: 20 }
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
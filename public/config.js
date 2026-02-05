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
    // AI AUTHORITY SYSTEM
    // ==========================================
    AI_AUTHORITY: {
        SOFT_CAP: 50,  // Skip new spawns above this - let other peers handle them
        HARD_CAP: 25   // For monitoring only
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
        1: { name: 'Southguard', minX: -10000, maxX: 10000, minZ: -2000, maxZ: 0 },
        3: { name: 'Northmen', minX: -10000, maxX: 10000, minZ: 0, maxZ: 2000 }
    },

    FACTION_NAMES: {
        1: 'Southguard',
        3: 'Northmen'
    },

    // Faction colors for shirts and name tags
    FACTION_COLORS: {
        // Southguard: Maroon
        1: {
            shirt: 0x6b1c2e,      // Dark maroon for 3D shirt
            nameTag: '#cc4466'    // Lighter maroon for name tag readability
        },
        // Northmen: Dark blue
        3: {
            shirt: 0x1a3a5c,      // Dark blue for 3D shirt
            nameTag: '#5599cc'    // Lighter blue for name tag readability
        },
        // Bandits: Beige-brown
        'bandit': {
            shirt: 0x8B6B4B,      // Beige-brown for 3D shirt
            nameTag: '#a88960'    // Matching beige-brown for name tag
        },
        // Neutral/Guest: Gray (fallback)
        default: {
            shirt: 0x5a5a5a,      // Dark gray
            nameTag: '#ffffff'    // White
        }
    },

    // Militia system (player-spawned faction defenders)
    MILITIA: {
        COST: 1,  // Influence cost to spawn militia
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
        // TOOL DURABILITY SYSTEM
        // - Quality determines max durability: durability = max(10, quality)
        // - Each use removes 1 durability (flat rate for all tools)
        // - When durability hits 0, tool is destroyed
        //
        // Examples:
        //   Q100 tool = 100 uses before breaking
        //   Q50 tool = 50 uses before breaking
        //   Q10 tool = 10 uses before breaking (minimum)
        //
        // Applies to: axe, saw, pickaxe, chisel, hammer, fishingnet, rifle
        //
        // See implementation in:
        //   - ResourceManager.js (axe, saw, pickaxe, fishingnet)
        //   - CraftingSystem.js (chisel)
        //   - BuildingSystem.js (hammer)
        //   - PlayerCombat.js (rifle)
        MIN_DURABILITY: 10,
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
        MOVE_SPEED: 1.25,                // Units per second
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
        CART_Z_OFFSET: -0.2,             // Z position offset (negative = back)
        DROP_OFFSET: 0.6,                // Distance behind cart when unloading
        MIN_DROP_HEIGHT: -10,            // Minimum valid terrain height for drop
        MAX_DROP_HEIGHT: 100,            // Maximum valid terrain height for drop
        CLAIM_TIMEOUT: 10000,            // ms to wait for server response
    },

    // ==========================================
    // CRATE VEHICLE LOADING (boats with crate capacity)
    // ==========================================
    CRATE_VEHICLES: {
        // Vehicle-specific crate capacity
        CAPACITY: {
            boat: 0,        // No crate support
            sailboat: 1,    // Single crate
            ship2: 4        // Four crates in 2x2 arrangement
        },

        // Vehicle-specific artillery capacity (ship2 only)
        ARTILLERY_CAPACITY: {
            ship2: 2        // Two artillery (port/starboard broadside)
        },

        // Sailboat positions (single slot)
        sailboat: {
            slots: [{ x: 0, y: 0.15, z: -0.5 }]
        },

        // Ship2 deck positions for crates
        ship2: {
            slots: [
                { x: -0.6, y: 0.4, z: -0.5 },  // Port-outer
                { x: -0.3, y: 0.4, z: -0.5 },  // Port-inner
                { x: 0.3,  y: 0.4, z: -0.5 },  // Starboard-inner
                { x: 0.6,  y: 0.4, z: -0.5 }   // Starboard-outer
            ]
        },

        // Ship2 artillery positions (broadside, facing outward)
        // Note: -X = starboard (right), +X = port (left)
        ship2_artillery: {
            slots: [
                { x: -0.5, y: 0.8, z: -1.5, rotation: Math.PI / 2 },   // Starboard (fires right/outward)
                { x: 0.5,  y: 0.8, z: -1.5, rotation: -Math.PI / 2 }   // Port (fires left/outward)
            ]
        },

        // Common settings
        LANDING_SEARCH_RADIUS: 3,        // Radius to search for land when unloading
        CLAIM_TIMEOUT: 10000,            // ms to wait for server response
    },

    // Legacy alias for backward compatibility
    CRATE_SAILBOAT: {
        BOAT_HEIGHT_OFFSET: 0.15,
        BOAT_Z_OFFSET: -0.5,
        LANDING_SEARCH_RADIUS: 3,
        CLAIM_TIMEOUT: 10000,
    },

    // ==========================================
    // HORSE VEHICLE LOADING (ship2 horse transport)
    // ==========================================
    HORSE_VEHICLES: {
        // Vehicle-specific horse capacity
        CAPACITY: {
            ship2: 3        // Three horses on ship2 deck
        },

        // Ship2 deck positions for horses
        ship2: {
            slots: [
                { x: -0.6, y: 0.4, z: 0.5 },   // Port
                { x: 0,    y: 0.4, z: 0.5 },   // Center
                { x: 0.6,  y: 0.4, z: 0.5 }    // Starboard
            ]
        },

        // Common settings
        PROXIMITY_RANGE: 4,              // Range to detect loadable horses
    },

    // ==========================================
    // TOWED ENTITIES (Cart & Artillery - Unified Hitch-Point Towing)
    // ==========================================
    TOWED_ENTITIES: {
        // Shared physics constants
        SHARED: {
            HITCH_OFFSET: 0.4,               // Distance from entity center to hitch point
            TETHER_LENGTH: 0.3,              // Slack before tether becomes taut
            PIVOT_SPEED: 0.08,               // Base rotation lerp factor
            MIN_MOVE_THRESHOLD: 0.01,        // Minimum pull distance to move
            MIN_DISTANCE_EPSILON: 0.001,     // Avoid division by zero
            MAX_SAFE_ANGLE: Math.PI * 0.35,  // ~63 degrees - normal pivot
            DANGER_ANGLE: Math.PI * 0.5,     // 90 degrees - emergency pivot
            EMERGENCY_PIVOT_SPEED: 0.3,      // Fast recovery from jackknife
            BROADCAST_INTERVAL: 150,         // ms between P2P broadcasts
            TERRAIN_UPDATE_FRAMES: 5,        // Update terrain Y every N frames
            ROAD_SPEED_MULTIPLIER: 1.5,      // 50% faster on roads
        },

        // Cart-specific config
        cart: {
            SPEED: 2.5,                      // Max speed units/sec
            canTowOnFoot: true,              // Player can tow without horse
            EMPTY_SPEED_MULTIPLIER: 0.9,     // 10% slower with empty cart
            LOADED_SPEED_MULTIPLIER: 0.5,    // 50% slower on foot with loaded cart
            MOUNTED_LOADED_SPEED_MULTIPLIER: 0.667,  // 33% slower on horse with loaded cart
            TURN_RATE_MULTIPLIER: 0.6,       // Turn rate reduction when towing
            // Reverse mode
            REVERSE_SPEED_MULTIPLIER: 0.3,
            REVERSE_ALIGN_SPEED: 0.15,
        },

        // Artillery-specific config
        artillery: {
            SPEED: 2.0,                      // Max speed units/sec (heavier than cart)
            canTowOnFoot: false,             // Requires horse
            SPEED_MULTIPLIER: 0.667,         // Horse speed when towing artillery
            TURN_RATE_MULTIPLIER: 0.5,       // Horse turns 50% slower
        },
    },

    // ==========================================
    // PILOTABLE VEHICLES (Boat, Sailboat, Ship2, Horse)
    // ==========================================
    VEHICLES: {
        // Shared settings
        BOARDING_DURATION: 1000,         // ms for boarding animation
        BROADCAST_INTERVAL: 150,         // ms between P2P position broadcasts
        DISEMBARK_SAMPLES: 8,            // Points to sample in disembark circle

        // Boat (small rowboat)
        boat: {
            maxSpeed: 0.001,                        // 1.0 units/sec
            reverseSpeedMultiplier: 0.5,            // Reverse at 50% of max speed
            acceleration: 0.001 / 3000,             // 3 seconds to reach max speed
            deceleration: 0.001 / 4000,             // 4 seconds to drift to stop
            reverseDecel: 0.001 / 2000,             // 2 seconds to slow before reversing
            baseTurnRate: (Math.PI * 2) / 12000,    // 360 deg in 12s at rest
            halfWidth: 0.35,                        // Hull half-width for boundary check
            halfDepth: 0.7,                         // Hull half-depth for boundary check
            minWaterDepth: 0,                       // Can go to shore edge
            playerYOffset: -0.1,                    // Y offset for seated player
            dismountDistance: 3,                    // Distance to check for land
            proximityRange: 3,                      // Range to show board button
            buttonLabel: 'Enter Boat',
            exitButtonLabel: 'Exit Boat',
        },

        // Sailboat (medium sailing vessel)
        sailboat: {
            maxSpeed: 0.0015,                       // 1.5 units/sec
            reverseSpeedMultiplier: 0.5,            // Reverse at 50% of max speed
            acceleration: 0.0015 / 3000,
            deceleration: 0.0015 / 4000,
            reverseDecel: 0.0015 / 2000,
            baseTurnRate: (Math.PI * 2) / 16000,    // 360 deg in 16s
            halfWidth: 0.35,
            halfDepth: 1.0,
            minWaterDepth: -0.3,                    // Needs 0.3 depth
            playerYOffset: -0.1,
            dismountDistance: 3,
            proximityRange: 3,
            buttonLabel: 'Enter Sailboat',
            exitButtonLabel: 'Exit Sailboat',
        },

        // Ship2 (large cargo/war ship)
        ship2: {
            maxSpeed: 0.00125,                      // 1.25 units/sec
            reverseSpeedMultiplier: 0.5,            // Reverse at 50% of max speed
            acceleration: 0.00125 / 3000,
            deceleration: 0.00125 / 4000,
            reverseDecel: 0.00125 / 2000,
            baseTurnRate: (Math.PI * 2) / 20000,    // 360 deg in 20s
            halfWidth: 1.0,
            halfDepth: 4.0,
            minWaterDepth: -1.0,                    // Needs 1.0 depth
            playerYOffset: 1.2,
            playerZOffset: -2.5,                    // Helm position toward stern
            dismountDistance: 4,
            proximityRange: 4,
            buttonLabel: 'Board Ship',
            exitButtonLabel: 'Disembark',
        },

        // Horse (rideable mount)
        horse: {
            maxSpeed: 0.00175,                      // 1.75 units/sec (1.4x player walk)
            acceleration: 0.0015 / 2000,            // 2 seconds to full speed
            deceleration: 0.0015 / 1000,            // 1 second to stop
            baseTurnRate: (Math.PI * 2) / 4000,     // 360 deg in 4 seconds
            collisionRadius: 0.15,                  // Collision capsule radius
            collisionHeight: 2.0,                   // Collision capsule height
            maxWalkableSlope: 50,                   // Degrees - 5% speed above this
            slopeSpeedMin: 0.05,                    // 5% speed when slope > max
            playerYOffset: 0.25,                    // Y offset for mounted player
            playerForwardOffset: 0.05,              // Forward offset for alignment
            dismountDistance: 0.5,                  // Short dismount distance
            proximityRange: 2,                      // Range to show mount button
            buttonLabel: 'Mount Horse',
            exitButtonLabel: 'Dismount',
            // Animation
            hasAnimation: true,
            animationName: 'walk',
            animationFallbackPatterns: ['walk', 'run', 'gallop', 'trot'],
            baseAnimationSpeed: 2.0,
            minAnimationSpeed: 0.6,
            turningAnimationSpeed: 1.0,
            // Sound
            soundFile: 'horse',
            soundLoopDuration: 4000,
            soundMinPlaybackRate: 0.5,
            soundMaxPlaybackRate: 1.0,
        },
    },

    // ==========================================
    // ARTILLERY COMBAT (Manning & Firing)
    // ==========================================
    ARTILLERY_COMBAT: {
        // Positioning
        // Note: Artillery barrel faces OPPOSITE to towing direction (barrel trails behind horse)
        BARREL_DIRECTION: -1,          // -1 = barrel opposite to model's forward/towing direction
        MANNING_OFFSET: 0.4,           // Distance from center toward breech when manning
        BARREL_OFFSET: { x: 0, y: 0.6, z: 1.2 },  // Offset from artillery center to barrel tip

        // Rotation (matches PlayerController turn rate)
        TURN_RATE: (Math.PI * 2) / 6000,  // Radians per millisecond (360 deg in 6s)

        // Firing
        FIRE_COOLDOWN: 12000,          // 12 seconds between shots
        RANGE: 28,                     // Maximum range in units

        // Accuracy (matches rifle pattern from PlayerCombat.js)
        BASE_HIT_CHANCE: 0.35,         // 35% at max range (same as rifle)
        MAX_HIT_CHANCE: 0.8,           // 80% cap (same as rifle)
        POINT_BLANK_RANGE: 8,          // Distance bonus range (rifle uses 4)
        HEIGHT_BONUS: 0.15,            // +15% per unit height advantage (same as rifle)

        // Effects
        MUZZLE_FLASH_SCALE: 2.1,       // 3x rifle flash (0.7 * 3)
        MUZZLE_FLASH_DURATION: 150,    // ms
        MAX_SIMULTANEOUS_IMPACTS: 5,   // Cap for performance

        // Network
        AIM_BROADCAST_INTERVAL: 150,   // ms between rotation broadcasts
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
    // OBJECT SPAWNING
    // ==========================================
    OBJECTS: {
        // Object type Sets for O(1) lookups
        TREE_TYPES: new Set(['oak', 'fir', 'pine', 'cypress', 'apple', 'vegetables', 'hemp', 'deertree']),
        ROCK_TYPES: new Set(['limestone', 'sandstone', 'clay', 'iron']),
        LOG_TYPES: new Set(['log', 'oak_log', 'pine_log', 'fir_log', 'cypress_log', 'apple_log']),
        NATURAL_TYPES: new Set([
            'oak', 'fir', 'pine', 'cypress', 'apple', 'vegetables', 'hemp', 'deertree',
            'limestone', 'sandstone', 'clay', 'iron',
            'log', 'oak_log', 'pine_log', 'fir_log', 'cypress_log', 'apple_log'
        ]),
        STRUCTURE_TYPES: new Set([
            'tent', 'campfire', 'outpost', 'house', 'crate', 'market', 'dock',
            'tileworks', 'ironworks', 'blacksmith', 'bakery', 'gardener',
            'miner', 'woodcutter', 'stonemason', 'horse', 'cart', 'boat', 'sailboat', 'ship2', 'ship', 'wall',
            'bearden', 'artillery', 'deertree', 'warehouse'
        ]),

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
        // Rotation increment for scroll/Q/E during placement (degrees)
        ROTATION_INCREMENT: 15,

        // Grid dimensions for collision detection (in world units)
        // These define the footprint each structure occupies for placement collision
        GRID_DIMENSIONS: {
            dock: { width: 4.0, depth: 12.0, height: 3.0 },  // depth aligned to 4-unit LOD grid
            fisherman: { width: 2.0, depth: 2.0, height: 3.0 },

            // Structures
            crate: { width: 0.25, depth: 0.25, height: 1.5 },
            house: { width: 1.0, depth: 1.0, height: 4.0 },
            campfire: { radius: 0.25, height: 1.5 },
            tileworks: { width: 2.0, depth: 2.0, height: 3.0 },  // 2x2 production building
            ironworks: { width: 2.0, depth: 2.0, height: 3.0 },  // 2x2 production building
            blacksmith: { width: 2.0, depth: 2.0, height: 3.0 },  // 2x2 production building
            bakery: { width: 1.0, depth: 1.0, height: 3.0 },  // 1x1 production building
            gardener: {
                width: 1.0, depth: 1.0, height: 3.0,
                field: { width: 3.0, depth: 3.0, offsetZ: -3.5 }  // Planting area behind building
            },
            miner: { width: 1.0, depth: 1.0, height: 3.0 },  // 1x1 decorative building
            woodcutter: { width: 1.0, depth: 1.0, height: 3.0 },  // 1x1 decorative building
            stonemason: { width: 2.0, depth: 2.0, height: 3.0 },  // 2x2 decorative building
            warehouse: { width: 2.0, depth: 2.0, height: 4.0 },  // 2x2 storage building
            road: { width: 1.0, depth: 2.0, height: 0.1 },  // Pill shape: 1 unit wide, 2 units long
            market: { width: 2.0, depth: 8.0, height: 12.0 },

            // Standalone structures
            outpost: { width: 1.0, depth: 1.0, height: 4.0 },
            tent: { width: 1.0, depth: 1.0, height: 2.0 },
            bearden: { radius: 1.5, height: 1.5 },  // Brown bear den
            wall: { width: 1.0, depth: 0.1, height: 3.0 },  // Simple wall segment
            ship: { width: 2.0, depth: 4.0, height: 3.0 },
            boat: { width: 0.7, depth: 1.4, height: 1.0 },
            sailboat: { width: 0.7, depth: 2.0, height: 2.0 },
            ship2: { width: 2.0, depth: 8.0, height: 3.0 },
            horse: { radius: 0.15, height: 2.0 },
            cart: { radius: 0.25, height: 3.0 },  // Scaled 2x
            artillery: { radius: 0.25, height: 2.0 },  // Cylindrical like cart
            corpse: { width: 0.5, depth: 1.5, height: 0.3 },  // Lying body dimensions

            // Natural objects (trees use radius-based collision)
            // Trees - cylindrical bounds (reduced by 20%)
            // Height added for proper collision detection
            // dirtRadius: size of dirt patch rendered under object
            oak: { radius: 1.4, height: 3.0, dirtRadius: 3.5 },
            oak2: { radius: 1.4, height: 3.0, dirtRadius: 3.5 },
            pine: { radius: 0.3, height: 3.0, dirtRadius: 1.0 },
            pine2: { radius: 0.3, height: 3.0, dirtRadius: 1.0 },
            deertree: { radius: 0.3, height: 3.0, dirtRadius: 1.0 },
            fir: { radius: 0.3, height: 3.0, dirtRadius: 1.0 },
            cypress: { radius: 0.12, height: 3.0, dirtRadius: 1.0 },
            apple: { radius: 0.4, height: 2.0, dirtRadius: 1.0 },
            vegetables: { radius: 0.2, height: 0.5, dirtRadius: 0.5 },
            hemp: { radius: 0.2, height: 0.5, dirtRadius: 0.5 },

            // Planted trees (same dimensions as natural - reserve space for growth)
            planted_pine: { radius: 0.3, height: 3.0, dirtRadius: 1.0 },
            planted_fir: { radius: 0.3, height: 3.0, dirtRadius: 1.0 },
            planted_apple: { radius: 0.4, height: 2.0, dirtRadius: 1.0 },
            planted_vegetables: { radius: 0.2, height: 0.5, dirtRadius: 0.5 },
            planted_hemp: { radius: 0.2, height: 0.5, dirtRadius: 0.5 },

            // Logs - rectangular bounds (all logs use same dimensions)
            oak_log: { width: 0.15, depth: 1.5, height: 1 },
            pine_log: { width: 0.15, depth: 1.5, height: 1 },
            fir_log: { width: 0.15, depth: 1.5, height: 1 },
            cypress_log: { width: 0.15, depth: 1.5, height: 1 },
            apple_log: { width: 0.15, depth: 1.5, height: 1 },
            log: { width: 0.15, depth: 1.5, height: 1 },

            // Rocks
            limestone: { radius: 0.25, height: 1.0, dirtRadius: 0.75 },
            sandstone: { radius: 0.25, height: 1.0, dirtRadius: 0.75 },
            clay: { radius: 0.25, height: 1.0, dirtRadius: 0.75 },
            iron: { radius: 0.25, height: 1.0, dirtRadius: 0.75 },

            // Construction site models
            construction: { width: 1.0, depth: 1.0, height: 2.0 },
            '2x2construction': { width: 2.0, depth: 2.0, height: 2.0 },
            '2x8construction': { width: 2.0, depth: 8.0, height: 6.0 },
            '10x4construction': { width: 4.0, depth: 10.0, height: 2.0 }
        },

        // Construction model mapping - maps structure types to their construction site models
        // Structures not listed here will use the default 'construction' model
        CONSTRUCTION_MODELS: {
            market: '2x8construction',
            dock: '10x4construction',
            fisherman: '2x2construction',
            tileworks: '2x2construction',
            ironworks: '2x2construction',
            blacksmith: '2x2construction',
            bakery: 'construction',
            gardener: 'construction',
            miner: 'construction',
            woodcutter: 'construction',
            stonemason: '2x2construction',
            warehouse: '2x2construction'
            // Add more mappings here as needed (e.g., house: 'houseconstruction')
        },

        // Material requirements for different structures
        // SYNC REQUIRED: Also update server/ServerConfig.js CONSTRUCTION.MATERIALS
        MATERIALS: {
            crate: {
                oakplank: 1
            },
            tent: {
                oakplank: 1,
                rope: 1,
                fabric: 1
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
            boat: {
                oakplank: 1
            },
            sailboat: {
                oakplank: 1,
                rope: 1,
                fabric: 1
            },
            ship2: {
                oakplank: 1,
                rope: 1,
                parts: 1,
                fabric: 1
            },
            market: {
                oakplank: 1,
                chiseledlimestone: 1,
                tile: 1
            },
            road: {
                chiseledlimestone: 1
            },
            dock: {
                chiseledlimestone: 1
            },
            fisherman: {
                oakplank: 1,
                chiseledlimestone: 1,
                tile: 1
            },
            tileworks: {
                oakplank: 1,
                chiseledlimestone: 1,
                tile: 1
            },
            ironworks: {
                oakplank: 1,
                chiseledlimestone: 1,
                tile: 1
            },
            blacksmith: {
                oakplank: 1,
                chiseledlimestone: 1,
                tile: 1
            },
            bakery: {
                oakplank: 1,
                chiseledlimestone: 1,
                tile: 1
            },
            gardener: {
                oakplank: 1,
                chiseledlimestone: 1,
                tile: 1
            },
            miner: {
                oakplank: 1,
                chiseledlimestone: 1,
                tile: 1
            },
            woodcutter: {
                oakplank: 1,
                chiseledlimestone: 1,
                tile: 1
            },
            stonemason: {
                oakplank: 1,
                chiseledlimestone: 1,
                tile: 1
            },
            horse: {
                vegetables: 1    // Feed requires 1 vegetables
            },
            cart: {
                oakplank: 1   // Any plank type works (validated by isPlankType helper)
            },
            artillery: {
                oakplank: 1,
                parts: 1
            },
            wall: {
                chiseledlimestone: 1   // Stone wall (limestone or sandstone applies tint)
            },
            warehouse: {
                oakplank: 1,
                chiseledlimestone: 1,
                tile: 1
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
            ironworks: {
                height: 3.0,  // Height of ironworks model
                inventorySize: { rows: 4, cols: 4 }  // Smaller inventory for specialized processing
            },
            blacksmith: {
                height: 3.0,  // Height of blacksmith model
                inventorySize: { rows: 4, cols: 4 }  // Smaller inventory for specialized processing
            },
            bakery: {
                height: 3.0,  // Height of bakery model
                inventorySize: { rows: 4, cols: 4 }  // Smaller inventory for specialized processing
            },
            gardener: {
                height: 3.0  // Height of gardener model (no inventory - decorative)
            },
            miner: {
                height: 3.0  // Height of miner model (no inventory - decorative)
            },
            woodcutter: {
                height: 3.0  // Height of woodcutter model (no inventory - decorative)
            },
            stonemason: {
                height: 3.0  // Height of stonemason model (no inventory - decorative)
            },
            artillery: {
                height: 2.0,  // Height of artillery model
                inventorySize: { rows: 4, cols: 4 }  // 16 slots for shells only
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
            sailboat: {
                animationSpeed: 0.5,  // Wave rocking speed
                animationAmplitude: 0.05,  // Rocking angle in radians
                waveBobAmplitude: 0.25,  // Vertical bob amplitude
                waveBobSpeed: 0.4  // Vertical bob speed
            },
            ship2: {
                animationSpeed: 0.5,  // Wave rocking speed
                animationAmplitude: 0.05,  // Rocking angle in radians
                waveBobAmplitude: 0.25,  // Vertical bob amplitude
                waveBobSpeed: 0.4  // Vertical bob speed
            },
            market: {
                inventorySize: { rows: 10, cols: 10 }  // Standard 10x10 inventory
            },
            tileworks: {
                height: 3.0,  // Height of tileworks model
                inventorySize: { rows: 4, cols: 4 }
            },
            apple: {
                height: 2.0,  // Height of apple tree model
                inventorySize: { rows: 3, cols: 3 }  // 3x3 grid for apples
            },
            dock: {
                deckHeight: 1.0           // Fixed Y height for dock terrain leveling
            },
            fisherman: {
                height: 3.0,  // Height of fisherman model
                inventorySize: { rows: 4, cols: 4 }  // Smaller inventory for specialized processing
            },
            corpse: {
                height: 0.5,
                inventorySize: { rows: 10, cols: 5 },  // Same as player backpack
                hasSlingSlot: true  // Can have rifle in sling
            }
        },

        // Quality caps for structures (limits max quality regardless of materials)
        STRUCTURE_QUALITY_CAPS: {
            tent: 100,      // Max quality 100 = ~738 hours lifespan (~30 days)
            campfire: 2,    // Max quality 2 = ~1.6 hours lifespan
            boat: 100,      // Max quality 100 = ~738 hours lifespan (~30 days)
            sailboat: 100,  // Max quality 100 = ~738 hours lifespan (~30 days)
            ship2: 100,     // Max quality 100 = ~738 hours lifespan (~30 days)
            ship: 100,      // Max quality 100 = ~738 hours lifespan (~30 days)
            horse: 100,     // Max quality 100 = ~738 hours lifespan (~30 days)
            cart: 100,      // Max quality 100 = ~738 hours lifespan (~30 days)
            crate: 100,     // Max quality 100 = ~738 hours lifespan (~30 days)
            artillery: 100  // Max quality 100 = ~738 hours lifespan (~30 days)
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
        FOG_COLOR: 0x8EAECE,                 // Fog color (darkened to match terrain fog appearance)
        FOG_NEAR: 300,                       // Distance where fog starts
        FOG_FAR: 500,                        // Distance where fog is fully opaque
        FOG_DENSITY: 0.02,                   // Fog density (only used if FOG_TYPE is 'exponential')
    },

    // ==========================================
    // LOD (Level of Detail) SETTINGS
    // ==========================================
    LOD: {
        // Structure LOD distances (when 3D model transitions to billboard)
        STRUCTURE_LOD_START: 40,             // Distance where billboard starts fading in
        STRUCTURE_LOD_END: 60,               // Distance where 3D model fully hidden

        // Structure creation queue settings
        STRUCTURE_QUEUE_BUDGET_MS: 4,        // Frame budget for structure creation (ms)
        STRUCTURE_QUEUE_MAX_PER_FRAME: 2,    // Max structures to create per frame
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
        OCEAN_SOUND_MAX_VOLUME: 0.5,
        PLAINS_SOUND_MAX_VOLUME: 0.4,
        MOUNTAIN_SOUND_MAX_VOLUME: 0.5,
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
            'axe', 'saw', 'pickaxe', 'hammer', 'chisel', 'fishingnet', 'improvisedtool',  // Tools
            'rifle',  // Weapons
            'apple', 'vegetables', 'fish', 'cookedfish', 'cookedmeat', 'roastedvegetables', 'appletart', 'mushroom', 'rawmeat'  // Food
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
            ironingot: { buyPrice: 60, sellPrice: 42, minQuantity: 0, maxQuantity: 300 },
            parts: { buyPrice: 200, sellPrice: 140, minQuantity: 0, maxQuantity: 300 },

            // Wood Materials
            pineplank: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },
            pinefirewood: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },
            appleplank: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },
            applefirewood: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },
            rope: { buyPrice: 8, sellPrice: 5, minQuantity: 0, maxQuantity: 300 },
            fabric: { buyPrice: 30, sellPrice: 21, minQuantity: 0, maxQuantity: 300 },

            // Seeds
            vegetableseeds: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },
            hempseeds: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },
            appleseed: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },
            pineseed: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 300 },

            // Food
            apple: { buyPrice: 1, sellPrice: 1, minQuantity: 0, maxQuantity: 300 },
            vegetables: { buyPrice: 20, sellPrice: 14, minQuantity: 0, maxQuantity: 300 },
            roastedvegetables: { buyPrice: 30, sellPrice: 21, minQuantity: 0, maxQuantity: 300 },
            appletart: { buyPrice: 10, sellPrice: 10, minQuantity: 0, maxQuantity: 300 },
            mushroom: { buyPrice: 1, sellPrice: 1, minQuantity: 0, maxQuantity: 300 },
            fish: { buyPrice: 20, sellPrice: 14, minQuantity: 0, maxQuantity: 300 },
            cookedfish: { buyPrice: 30, sellPrice: 21, minQuantity: 0, maxQuantity: 300 },
            rawmeat: { buyPrice: 50, sellPrice: 35, minQuantity: 0, maxQuantity: 300 },
            cookedmeat: { buyPrice: 60, sellPrice: 42, minQuantity: 0, maxQuantity: 300 },
            animalskin: { buyPrice: 22, sellPrice: 15, minQuantity: 0, maxQuantity: 300 },

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
            shell: { buyPrice: 50, sellPrice: 35, minQuantity: 0, maxQuantity: 300 },

            // Mounts
            horse: { buyPrice: 200, sellPrice: 140, minQuantity: 0, maxQuantity: 300 }
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
        ONLINE_CLIENT_URL: 'https://playghs.onrender.com/client.html'
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

        // Movement
        MOVE_SPEED: 1.25,                // Units per second
    },

    // ==========================================
    // BEAR AI SYSTEM (ambient 1-per-chunk bears)
    // ==========================================
    BEAR: {
        ENABLED: false,                  // Disabled - using BROWN_BEAR instead
    },

    // ==========================================
    // BROWN BEAR AI SYSTEM (den-based bears)
    // ==========================================
    BROWN_BEAR: {
        ENABLED: true,
        CHUNK_PROBABILITY: 1,            // Every eligible chunk has a den
        SPAWN_TRIGGER_DISTANCE: 50,      // Player distance to trigger spawning
        DETECTION_RANGE: 30,             // Units - bear detects players

        // Movement speeds
        MOVE_SPEED: 2.75,                // Units per second (chasing)
        WANDER_SPEED: 0.75,              // Units per second (idle wandering)
        FLEE_SPEED: 2.75,                // Units per second (fleeing from structures)
    },

    // ==========================================
    // DEER AI SYSTEM (tree-based deer)
    // ==========================================
    DEER_TREE: {
        ENABLED: true,
        CHUNK_PROBABILITY: 1,            // Every eligible chunk has a deer tree
        SPAWN_TRIGGER_DISTANCE: 50,      // Player distance to trigger spawning
        DETECTION_RANGE: 10,             // Units - deer detects threats (for fleeing)

        // Movement speeds
        WANDER_SPEED: 0.75,              // Units per second
        FLEE_SPEED: 2.25,                // Units per second
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
    },

    // ==========================================
    // BAKER NPC SYSTEM
    // ==========================================
    BAKER: {
        ENABLED: true,

        // Spawning
        SPAWN_DISTANCE: 2.5,              // Units from bakery to spawn
        MARKET_MAX_DISTANCE: 20,          // Bakery must be within 20 units of market

        // Movement
        MOVE_SPEED: 1.25,                  // Same speed as player
        PATHFIND_INTERVAL: 6000,          // Recalculate path every 6 seconds

        // Work
        APPLES_PER_TRIP: 2,               // Collect 2 apples per cycle
        COLLECTION_INTERVAL: 600,         // 600 ticks = 10 minutes between apple runs
        APPLE_SEARCH_RADIUS_SQ: 2500,     // 50^2 - search radius for trees
        MARKET_SEARCH_RADIUS_SQ: 400,     // 20^2 - search radius for markets

        // State Management
        STUCK_TIMEOUT: 6000,              // 6 seconds before auto-retry
        IDLE_CHECK_INTERVAL: 360,         // Frames between task checks (6 seconds at 60fps)

        // Performance
        FAR_UPDATE_INTERVAL: 8,           // Frames between updates for distant bakers
        FAR_DISTANCE_SQ: 22500,           // 150^2 - distance threshold for culling
        BROADCAST_INTERVAL: 1000,         // ms between state broadcasts

        // Interaction
        INTERACTION_RADIUS_SQ: 4.0,       // 2.0^2 - distance for player to talk
        NPC_COLOR: 0xCC7722,              // Orange/brown apron color
    },

    // ==========================================
    // GARDENER NPC SYSTEM
    // ==========================================
    GARDENER: {
        ENABLED: true,

        // Spawning
        SPAWN_DISTANCE: 2.5,              // Units from gardener building to spawn
        MARKET_MAX_DISTANCE: 20,          // Gardener building must be within 20 units of market

        // Movement
        MOVE_SPEED: 1.25,                  // Same speed as player
        PATHFIND_INTERVAL: 6000,          // Recalculate path every 6 seconds

        // Planting (US flag pattern: 5+4+5+4+5 = 23)
        MAX_PLANTED: 23,                  // Max vegetables to plant

        // Harvesting
        HARVEST_TIME_MS: 30 * 60 * 1000,  // 30 minutes after planting
        HARVEST_CHECK_INTERVAL: 30000,    // Check for harvestable vegetables every 30s

        // Delivery
        MARKET_SEARCH_RADIUS_SQ: 400,     // 20^2 - search radius for markets

        // State Management
        STUCK_TIMEOUT: 6000,              // 6 seconds before auto-retry
        IDLE_CHECK_INTERVAL: 360,         // Frames between task checks (6 seconds at 60fps)

        // Performance
        FAR_UPDATE_INTERVAL: 8,           // Frames between updates for distant gardeners
        FAR_DISTANCE_SQ: 22500,           // 150^2 - distance threshold for culling
        BROADCAST_INTERVAL: 1000,         // ms between state broadcasts

        // Interaction
        INTERACTION_RADIUS_SQ: 4.0,       // 2.0^2 - distance for player to talk
        NPC_COLOR: 0x228B22,              // Forest green color

        // Tree planting during downtime
        TREE_PLANTING_ENABLED: true,
        TREE_PINE_CHANCE: 0.80,           // 80% pine
        TREE_APPLE_CHANCE: 0.20,          // 20% apple
        TREE_SEARCH_RADIUS: 15,           // How far from building to search for spots
        TREE_MIN_DISTANCE: 3,             // Minimum distance from building
        TREE_SPACING: 2.5,                // Minimum distance between planted trees
        TREE_MAX_SLOPE: 37,               // Max slope in degrees
        TREE_MAX_SLOPE_NORMAL_Y: 0.7986,  // Pre-computed: Math.cos(37 * Math.PI / 180)
        TREE_COLLISION_RADIUS: 0.5,       // Collision check radius for tree placement
        TREE_COLLISION_HEIGHT: 3.0,       // Collision check height
        TREE_MIN_HEIGHT: 4,               // Minimum terrain height (above water/beaches)
        TREE_MAX_HEIGHT: 20,              // Maximum terrain height (below mountains)
        TREE_GRID_CELL_SIZE: 5,           // Spatial grid cell size (~2x TREE_SPACING)
        TREE_CLEANUP_INTERVAL: 300000,    // Clean old tree records every 5 minutes
    },

    // ==========================================
    // WOODCUTTER NPC SYSTEM
    // ==========================================
    WOODCUTTER: {
        ENABLED: true,

        // Spawning
        SPAWN_DISTANCE: 2.5,              // Units from woodcutter building to spawn
        MARKET_MAX_DISTANCE: 20,          // Woodcutter building must be within 20 units of market

        // Movement
        MOVE_SPEED: 1.25,                  // Same speed as player
        PATHFIND_INTERVAL: 6000,          // Recalculate path every 6 seconds

        // Tree Cutting
        TREE_SEARCH_RADIUS_SQ: 2500,      // 50^2 - search radius for pine trees
        TREE_CHECK_COOLDOWN_MS: 60000,    // 60s before re-targeting failed tree
        INTERACTION_RANGE: 5,             // Distance to interact with tree/log

        // Log Processing (firewood, plank, firewood, plank, firewood = 5 harvests)
        HARVEST_ORDER: ['firewood', 'planks', 'firewood', 'planks', 'firewood'],

        // Delivery
        MARKET_SEARCH_RADIUS_SQ: 400,     // 20^2 - search radius for markets

        // State Management
        STUCK_TIMEOUT: 6000,              // 6 seconds before auto-retry
        IDLE_CHECK_INTERVAL: 1000,        // ms between task checks

        // Performance
        FAR_UPDATE_INTERVAL: 4,           // Frames between updates for distant woodcutters
        FAR_DISTANCE_SQ: 22500,           // 150^2 - distance threshold for culling
        BROADCAST_INTERVAL: 1000,         // ms between state broadcasts

        // Interaction
        INTERACTION_RADIUS_SQ: 4.0,       // 2.0^2 - distance for player to talk
        NPC_COLOR: 0x8B4513,              // Saddle brown color
    },

    // ==========================================
    // MINER NPC SYSTEM
    // ==========================================
    MINER: {
        ENABLED: true,

        // Spawning
        SPAWN_DISTANCE: 2.5,              // Units from miner building to spawn
        MARKET_MAX_DISTANCE: 20,          // Miner building must be within 20 units of market

        // Movement
        MOVE_SPEED: 1.25,                  // Same speed as player
        PATHFIND_INTERVAL: 6000,          // Recalculate path every 6 seconds

        // Rock Mining
        ROCK_SEARCH_RADIUS_SQ: 2500,      // 50^2 - search radius for rocks
        ROCK_CHECK_COOLDOWN_MS: 60000,    // 60s before re-targeting failed rock
        INTERACTION_RANGE: 5,             // Distance to interact with rock

        // Harvesting (5 stone per rock)
        HARVEST_COUNT: 5,

        // Delivery
        MARKET_SEARCH_RADIUS_SQ: 400,     // 20^2 - search radius for markets

        // State Management
        STUCK_TIMEOUT: 6000,              // 6 seconds before auto-retry
        IDLE_CHECK_INTERVAL: 1000,        // ms between task checks

        // Performance
        FAR_UPDATE_INTERVAL: 4,           // Frames between updates for distant miners
        FAR_DISTANCE_SQ: 22500,           // 150^2 - distance threshold for culling
        BROADCAST_INTERVAL: 1000,         // ms between state broadcasts

        // Interaction
        INTERACTION_RADIUS_SQ: 4.0,       // 2.0^2 - distance for player to talk
        NPC_COLOR: 0x696969,              // Dim gray (stone color)
    },

    // ==========================================
    // STONEMASON NPC SYSTEM
    // ==========================================
    STONEMASON: {
        ENABLED: true,

        // Spawning
        SPAWN_DISTANCE: 2.5,              // Units from stonemason building to spawn
        MARKET_MAX_DISTANCE: 20,          // Stonemason building must be within 20 units of market

        // Movement
        MOVE_SPEED: 1.25,                  // Same speed as player
        PATHFIND_INTERVAL: 6000,          // Recalculate path every 6 seconds

        // Stone Collection
        STONE_TYPES: ['limestone', 'sandstone'],  // Types to collect from market
        COLLECT_COUNT: 5,                 // Collect 5 stones per trip
        INTERACTION_RANGE: 3,             // Distance to interact with market/building

        // Chiseling is handled via CONFIG.ACTIONS.CHISELING_DURATION

        // State Management
        STUCK_TIMEOUT: 6000,              // 6 seconds before auto-retry
        IDLE_CHECK_INTERVAL: 1000,        // ms between task checks

        // Performance
        FAR_UPDATE_INTERVAL: 4,           // Frames between updates for distant stonemasons
        FAR_DISTANCE_SQ: 22500,           // 150^2 - distance threshold for culling
        BROADCAST_INTERVAL: 1000,         // ms between state broadcasts

        // Interaction
        INTERACTION_RADIUS_SQ: 4.0,       // 2.0^2 - distance for player to talk
        NPC_COLOR: 0x8B8682,              // Warm gray (stone masonry color)
    },

    // ==========================================
    // IRONWORKER NPC SYSTEM
    // ==========================================
    IRONWORKER: {
        ENABLED: true,

        // Spawning
        SPAWN_DISTANCE: 2.5,
        MARKET_MAX_DISTANCE: 20,

        // Movement
        MOVE_SPEED: 1.25,
        PATHFIND_INTERVAL: 6000,

        // Work
        ITEMS_PER_TRIP: 5,                // Collect 5 iron per cycle
        COLLECTION_INTERVAL: 600,

        // State Management
        STUCK_TIMEOUT: 6000,
        IDLE_CHECK_INTERVAL: 360,

        // Performance
        FAR_UPDATE_INTERVAL: 8,
        FAR_DISTANCE_SQ: 22500,           // 150^2 - distance threshold for culling
        BROADCAST_INTERVAL: 1000,

        // Interaction
        INTERACTION_RADIUS_SQ: 4.0,
        NPC_COLOR: 0x4A4A4A,              // Dark gray (iron color)
    },

    // ==========================================
    // TILEWORKER NPC SYSTEM
    // ==========================================
    TILEWORKER: {
        ENABLED: true,

        // Spawning
        SPAWN_DISTANCE: 2.5,
        MARKET_MAX_DISTANCE: 20,

        // Movement
        MOVE_SPEED: 1.25,
        PATHFIND_INTERVAL: 6000,

        // Work
        ITEMS_PER_TRIP: 5,                // Collect 5 clay per cycle
        COLLECTION_INTERVAL: 600,

        // State Management
        STUCK_TIMEOUT: 6000,
        IDLE_CHECK_INTERVAL: 360,

        // Performance
        FAR_UPDATE_INTERVAL: 8,
        FAR_DISTANCE_SQ: 22500,           // 150^2 - distance threshold for culling
        BROADCAST_INTERVAL: 1000,

        // Interaction
        INTERACTION_RADIUS_SQ: 4.0,
        NPC_COLOR: 0xCD853F,              // Terracotta color
    },

    // ==========================================
    // BLACKSMITH NPC SYSTEM
    // ==========================================
    BLACKSMITH: {
        ENABLED: true,

        // Spawning
        SPAWN_DISTANCE: 2.5,
        MARKET_MAX_DISTANCE: 20,

        // Movement
        MOVE_SPEED: 1.25,
        PATHFIND_INTERVAL: 6000,

        // Work
        ITEMS_PER_TRIP: 5,                // Collect 5 ironingot per cycle
        COLLECTION_INTERVAL: 600,

        // State Management
        STUCK_TIMEOUT: 6000,
        IDLE_CHECK_INTERVAL: 360,

        // Performance
        FAR_UPDATE_INTERVAL: 8,
        FAR_DISTANCE_SQ: 22500,           // 150^2 - distance threshold for culling
        BROADCAST_INTERVAL: 1000,

        // Interaction
        INTERACTION_RADIUS_SQ: 4.0,
        NPC_COLOR: 0x2F4F4F,              // Dark slate gray
    },

    // ==========================================
    // FISHERMAN NPC SYSTEM
    // ==========================================
    FISHERMAN: {
        ENABLED: true,

        // Spawning
        SPAWN_DISTANCE: 2.5,
        MARKET_MAX_DISTANCE: 20,

        // Movement
        MOVE_SPEED: 1.25,
        PATHFIND_INTERVAL: 6000,

        // Work
        FISH_PER_TRIP: 8,                 // Collect 8 fish per cycle
        FISHING_DURATION: 10000,          // 10 seconds per fish (ms)
        WATER_SEARCH_RADIUS_SQ: 2500,     // 50^2 - search radius for water
        WATER_APPROACH_DISTANCE: 0.5,     // Stop 0.5 units from water

        // State Management
        STUCK_TIMEOUT: 6000,
        IDLE_CHECK_INTERVAL: 360,

        // Performance
        FAR_UPDATE_INTERVAL: 8,
        FAR_DISTANCE_SQ: 22500,           // 150^2 - distance threshold for culling
        BROADCAST_INTERVAL: 1000,

        // Interaction
        INTERACTION_RADIUS_SQ: 4.0,
        NPC_COLOR: 0x4682B4,              // Steel blue (fisherman color)
    },

    // ==========================================
    // GRAPHICS QUALITY PRESETS
    // ==========================================
    // HIGH preset MUST match current default values exactly
    // to ensure no change for players who don't use this feature
    TREE_MODEL_TYPES: ['pine', 'apple'],

    QUALITY: {
        HIGH: {
            CHUNK_LOAD_RADIUS: 10,        // Must match CONFIG.CHUNKS.LOAD_RADIUS
            CLIPMAP_LEVELS: 6,            // Must match TERRAIN_CONFIG.CLIPMAP_LEVELS
            FOG_NEAR: 300,                // Must match CONFIG.RENDERING.FOG_NEAR
            FOG_FAR: 500,                 // Must match CONFIG.RENDERING.FOG_FAR
            FOG_COLOR: 0x8EAECE,          // Must match CONFIG.RENDERING.FOG_COLOR
            TERRAIN_FADE_START: 450,      // Must match TERRAIN_CONFIG.TERRAIN_FADE_START
            TERRAIN_FADE_END: 500,        // Must match TERRAIN_CONFIG.TERRAIN_FADE_END
            WATER_CHUNKS_RADIUS: 4,       // Must match TERRAIN_CONFIG.WATER_CHUNKS_RADIUS
            // Water effects (all on for high quality)
            WATER_ENABLE_SSS: 1.0,
            WATER_ENABLE_DETAIL_NORMALS: 1.0,
            WATER_ENABLE_CREST_COLOR: 1.0,
            WATER_ENABLE_GLITTER: 1.0,
            WATER_ENABLE_DEEP_COLOR: 1.0,
            WATER_ENABLE_FOAM: 1.0,       // Full foam effects
            WATER_ENABLE_ENV_MAP: 1.0,    // Cubemap reflections
            WATER_WAVE_COUNT: 4,          // Full 4 Gerstner waves
            WATER_TRANSPARENT: 1.0,       // Transparent water with blending
            // Terrain effects
            TERRAIN_ENABLE_NORMAL_PERTURB: 1.0,  // Surface detail
            TERRAIN_ENABLE_PROCEDURAL_BLEND: 1.0, // Full procedural textures
            TERRAIN_PROCEDURAL_OCTAVES: 3,       // Full noise detail
            TERRAIN_ENABLE_TRIPLANAR: 1.0,       // Full triplanar mapping
            // Depth texture (re-render every ~4 units)
            DEPTH_SNAP_MULTIPLIER: 4,
            DEPTH_TEXTURE_SIZE: 1024,     // Full resolution depth texture
            // Billboard system
            BILLBOARD_MAX_INSTANCES: 100000,
            // Renderer settings
            PIXEL_RATIO: 2,               // Max pixel ratio for retina displays
            CAMERA_NEAR: 1.0,             // Near clipping plane
            CAMERA_FAR: 1500,             // Far clipping plane
            TONE_MAPPING: true,           // ACES Filmic tone mapping
            // LOD distances
            STRUCTURE_LOD_START: 40,      // Billboard fade in distance
            STRUCTURE_LOD_END: 60,        // 3D model hidden distance
            // Instance limits
            ROCK_MODEL_MAX_INSTANCES: 50000,  // Per rock type
            TREE_MODEL_MAX_INSTANCES: 2500,   // Per tree type - covers ~9 chunks within 60-unit recycle radius
            SMOKE_ENABLED: true,          // Smoke particle effects
            TREE_MODELS_ENABLED: true     // 3D tree models (pine, apple) on HIGH
        },
        MEDIUM: {
            CHUNK_LOAD_RADIUS: 5,
            CLIPMAP_LEVELS: 4,
            FOG_NEAR: 100,
            FOG_FAR: 130,
            FOG_COLOR: 0xD0D5D6,          // Lighter fog for closer view distance
            TERRAIN_FADE_START: 100,
            TERRAIN_FADE_END: 128,
            WATER_CHUNKS_RADIUS: 2,
            // Water effects (disable expensive effects)
            WATER_ENABLE_SSS: 1.0,
            WATER_ENABLE_DETAIL_NORMALS: 1.0,
            WATER_ENABLE_CREST_COLOR: 1.0,
            WATER_ENABLE_GLITTER: 0.0,    // Disable shimmer (expensive)
            WATER_ENABLE_DEEP_COLOR: 1.0,
            WATER_ENABLE_FOAM: 1.0,       // Keep foam
            WATER_ENABLE_ENV_MAP: 1.0,    // Keep reflections
            WATER_WAVE_COUNT: 4,          // Keep 4 waves
            WATER_TRANSPARENT: 1.0,       // Keep transparent water
            // Terrain effects
            TERRAIN_ENABLE_NORMAL_PERTURB: 1.0,
            TERRAIN_ENABLE_PROCEDURAL_BLEND: 1.0, // Keep procedural textures
            TERRAIN_PROCEDURAL_OCTAVES: 2,       // Reduced noise detail
            TERRAIN_ENABLE_TRIPLANAR: 1.0,       // Keep triplanar mapping
            // Depth texture (re-render every ~8 units)
            DEPTH_SNAP_MULTIPLIER: 8,
            DEPTH_TEXTURE_SIZE: 1024,     // Keep full resolution
            // Billboard system
            BILLBOARD_MAX_INSTANCES: 50000,
            // Renderer settings
            PIXEL_RATIO: 2,               // Keep full pixel ratio
            CAMERA_NEAR: 1.0,             // Near clipping plane
            CAMERA_FAR: 500,              // Reduced far plane (matches fog)
            TONE_MAPPING: true,           // Keep tone mapping
            // LOD distances
            STRUCTURE_LOD_START: 35,      // Slightly closer billboards
            STRUCTURE_LOD_END: 50,        // Slightly closer model hide
            // Instance limits
            ROCK_MODEL_MAX_INSTANCES: 30000,  // Reduced capacity
            SMOKE_ENABLED: true,          // Keep smoke effects
            TREE_MODELS_ENABLED: false    // Billboard-only trees on MEDIUM
        },
        LOW: {
            CHUNK_LOAD_RADIUS: 3,
            CLIPMAP_LEVELS: 3,
            FOG_NEAR: 40,
            FOG_FAR: 50,
            FOG_COLOR: 0xE0E5E6,          // Even lighter fog for very close view
            TERRAIN_FADE_START: 50,
            TERRAIN_FADE_END: 64,
            WATER_CHUNKS_RADIUS: 1,
            // Water effects (minimal for performance)
            WATER_ENABLE_SSS: 0.0,        // Disable wave glow
            WATER_ENABLE_DETAIL_NORMALS: 0.0, // Disable ripples
            WATER_ENABLE_CREST_COLOR: 0.0, // Disable crest color
            WATER_ENABLE_GLITTER: 0.0,    // Disable shimmer
            WATER_ENABLE_DEEP_COLOR: 0.0, // Disable deep color variation
            WATER_ENABLE_FOAM: 0.0,       // Disable foam (saves 3-4 texture samples)
            WATER_ENABLE_ENV_MAP: 0.0,    // Disable cubemap (use flat color)
            WATER_WAVE_COUNT: 2,          // Only 2 waves (saves 2 sin/cos/normalize per vertex)
            WATER_TRANSPARENT: 0.0,       // Opaque water (reduces overdraw and blending cost)
            // Terrain effects
            TERRAIN_ENABLE_NORMAL_PERTURB: 0.0, // Disable (saves 4 noise calls/pixel)
            TERRAIN_ENABLE_PROCEDURAL_BLEND: 0.0, // PNG only - skip procedural (saves ~50% GPU)
            TERRAIN_PROCEDURAL_OCTAVES: 1,       // Minimal noise if procedural is needed
            TERRAIN_ENABLE_TRIPLANAR: 0.0,       // Y projection only (saves 2 samples/call)
            // Depth texture (re-render every ~32 units - much less often)
            DEPTH_SNAP_MULTIPLIER: 32,
            DEPTH_TEXTURE_SIZE: 512,      // Half resolution (saves GPU memory and fill rate)
            // Billboard system
            BILLBOARD_MAX_INSTANCES: 25000,
            // Renderer settings
            PIXEL_RATIO: 1,               // Native resolution (saves 75% fill rate on retina)
            CAMERA_NEAR: 2.0,             // Larger near plane improves depth precision
            CAMERA_FAR: 150,              // Much closer far plane (fog at 50 anyway)
            TONE_MAPPING: true,           // Keep tone mapping for visual consistency
            // Note: Removed WATER_POLYGON_OFFSET - was 20 which pushed water behind terrain
            // LOD distances (aggressive - billboards appear sooner)
            STRUCTURE_LOD_START: 20,      // Billboard fade in very close
            STRUCTURE_LOD_END: 30,        // 3D model hidden at 30 units
            // Instance limits
            ROCK_MODEL_MAX_INSTANCES: 10000,  // Minimal rock capacity
            SMOKE_ENABLED: 'minimal',     // Minimal smoke (10 particles max, 50 unit range)
            TREE_MODELS_ENABLED: false    // Billboard-only trees on LOW
        }
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
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

        // Durability loss per use
        AXE_DURABILITY_LOSS: 10,         // Loses 10 durability per tree
        SAW_DURABILITY_LOSS: 10,         // Loses 10 durability per plank batch
        PICKAXE_DURABILITY_LOSS: 10,     // Loses 10 durability per stone harvest
        HAMMER_DURABILITY_LOSS: 5,       // Loses 5 durability per build

        // Chisel durability loss is dynamic: Math.ceil(100 / stoneQuality)
        // So a quality 50 stone costs 2 durability, quality 25 costs 4
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
        ROCK_TYPES: ['limestone', 'sandstone'],

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
        CHUNK_SIZE: 100,                 // World units per chunk
        VIEW_DISTANCE: 2,                // Load chunks within 2 chunks of player
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
    // CONSTRUCTION SYSTEM
    // ==========================================
    CONSTRUCTION: {
        // Material requirements for different structures
        MATERIALS: {
            foundation: {
                chiseledlimestone: 4,
                chiseledsandstone: 4
            },
            foundationcorner: {
                chiseledlimestone: 2,
                chiseledsandstone: 2
            },
            foundationroundcorner: {
                chiseledlimestone: 3,
                chiseledsandstone: 3
            },
            outpost: {
                oakplank: 1
            }
        },

        // Placement rules
        FOUNDATION_SNAP_DISTANCE: 2,     // Distance to snap foundations together
        REQUIRE_HAMMER: true,            // Hammer required to build
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
    // DEBUG SETTINGS
    // ==========================================
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
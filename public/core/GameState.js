import * as THREE from 'three';
import { CONFIG } from '../config.js';

/**
 * GameState
 *
 * Central state management for the game including:
 * - Client identification
 * - Player position and movement
 * - Chunk tracking
 * - Inventory state
 * - Action state (chopping, building, etc.)
 * - UI state (menus, proximity, etc.)
 */
export class GameState {
    constructor() {
        this.clientId = 'client_' + Math.random().toString(36).substr(2, 12);
        this.isInChunk = false;
        this.currentPlayerChunkX = null; // Will be set when player position is first updated
        this.currentPlayerChunkZ = null; // Will be set when player position is first updated
        this.lastChunkX = null;
        this.lastChunkZ = null;

        // Movement state
        this.isMoving = false;
        this.playerTargetPosition = new THREE.Vector3();

        // Camera now managed by CameraController

        // Object tracking
        this.nearestObject = null;
        this.nearestObjectDistance = Infinity;
        this.removedObjectsCache = new Map(); // Key: chunkKey, Value: Set of removed objectIds

        // Shore detection for fishing
        this.nearWater = false;        // True when on shore (land adjacent to water)
        this.waterDirection = null;    // Direction to water from player (for facing)

        // Ocean ambient sound
        this.oceanSoundManager = null; // OceanSoundManager instance

        // Plains ambient sound
        this.plainsSoundManager = null; // PlainsSoundManager instance

        // Mountain ambient sound
        this.mountainSoundManager = null; // MountainSoundManager instance

        // Server state synchronization
        this.receivedInitialServerState = false; // Prevents chunk generation before server state arrives

        // Active action state (chopping, harvesting, building, chiseling, etc.)
        this.activeAction = null; // { object, startTime, duration, sound, actionType, harvestType }
        this.harvestCooldown = null; // { endTime: timestamp }

        // Inventory system (configuration from config.js)
        this.inventoryOpen = false;
        this.inventory = {
            rows: CONFIG.INVENTORY.BACKPACK_ROWS,  // 10 rows from config
            cols: CONFIG.INVENTORY.BACKPACK_COLS,  // 5 columns from config
            slotSize: CONFIG.INVENTORY.DEFAULT_SLOT_SIZE,  // 60px, recalculated on resize
            gap: CONFIG.INVENTORY.DEFAULT_GAP,     // 2px gap, recalculated on resize
            items: [
                // Test item: pickaxe at position (0, 0)
                {
                    id: 'test_pickaxe',
                    type: 'pickaxe',
                    x: 0,
                    y: 0,
                    width: 2,
                    height: 5,
                    rotation: 0,
                    quality: 85,
                    durability: 60
                },
                // Test item: axe at position (0, 5)
                {
                    id: 'test_axe',
                    type: 'axe',
                    x: 0,
                    y: 5,
                    width: 2,
                    height: 5,
                    rotation: 0,
                    quality: 72,
                    durability: 88
                },
                // Test item: saw at position (2, 0)
                {
                    id: 'test_saw',
                    type: 'saw',
                    x: 2,
                    y: 0,
                    width: 2,
                    height: 5,
                    rotation: 0,
                    quality: 91,
                    durability: 45
                },
                // Test item: hammer at position (2, 5)
                {
                    id: 'test_hammer',
                    type: 'hammer',
                    x: 2,
                    y: 5,
                    width: 1,
                    height: 2,
                    rotation: 0,
                    quality: 68,
                    durability: 82
                },
                // Test item: chisel at position (2, 7)
                {
                    id: 'test_chisel',
                    type: 'chisel',
                    x: 2,
                    y: 7,
                    width: 1,
                    height: 2,
                    rotation: 0,
                    quality: 55,
                    durability: 71
                },
                // Test item: chiseled limestone below chisel at position (2, 9)
                {
                    id: 'test_chiseledlimestone',
                    type: 'chiseledlimestone',
                    x: 2,
                    y: 9,
                    width: 1,
                    height: 1,
                    rotation: 0,
                    quality: 80,
                    durability: 100
                },
                // Starting coins - stackable currency item (lower right corner)
                {
                    id: 'starting_coins',
                    type: 'coin',
                    x: 4,
                    y: 9,
                    width: 1,
                    height: 1,
                    rotation: 0,
                    quality: 100,
                    durability: 100,
                    quantity: 100  // Starting amount
                },
                // Test food items for hunger system
                {
                    id: 'test_apple',
                    type: 'apple',
                    x: 3,
                    y: 5,
                    width: 1,
                    height: 1,
                    rotation: 0,
                    quality: 50,
                    durability: 5  // baseDurability (10) × quality (50%) = 5
                },
                {
                    id: 'test_vegetables',
                    type: 'vegetables',
                    x: 3,
                    y: 6,
                    width: 1,
                    height: 1,
                    rotation: 0,
                    quality: 50,
                    durability: 10  // baseDurability (20) × quality (50%) = 10
                }
            ]
        };

        // Build menu system now managed by BuildMenu module
        // Kept for backward compatibility - BuildMenu will update these
        this.buildMenuOpen = false;
        this.buildMenu = null; // Will be set by BuildMenu instance

        // Construction inventory system
        this.constructionInventoryOpen = false;
        this.nearestConstructionSite = null;
        this.nearestConstructionSiteDistance = Infinity;

        // Structure inventory system
        this.crateInventoryOpen = false;
        this.nearestStructure = null;
        this.nearestStructureDistance = Infinity;

        // Structure placement state now managed by BuildMenu module
        // Kept for backward compatibility - not used directly
        this.structurePlacement = {
            active: false,
            phase: null,
            structure: null,
            position: { x: 0, y: 0, z: 0 },
            rotation: 0,
            height: 0,
            previewBox: null,
            isValid: false,
            invalidReason: '',
            initialMouseY: 0  // Track mouse Y when entering height phase
        };

        // Timing
        this.lastChunkUpdateTime = 0;
        this.lastProximityCheckTime = 0;
        this.lastPeerCheckTime = 0;
        this.lastChoppingProgressUpdate = 0;
        this.lastFrameTime = performance.now();
    }

    updateChunkPosition(newX, newZ) {
        this.lastChunkX = this.currentPlayerChunkX;
        this.lastChunkZ = this.currentPlayerChunkZ;
        this.currentPlayerChunkX = newX;
        this.currentPlayerChunkZ = newZ;
    }
}

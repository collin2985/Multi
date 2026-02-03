import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { VehicleState } from '../vehicles/index.js';

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
        // Dual ID System: Session ID (never changes) + Account ID (set after login)
        this.clientId = 'session_' + Math.random().toString(36).substr(2, 12); // For P2P connections
        this.accountId = null;  // Will be set after login/registration
        this.username = null;   // Display name
        this.isGuest = true;    // Whether playing as guest or logged in
        this.hasCompletedInitialAuth = false;  // Prevents modal bypass before auth choice
        this.playerData = null; // Server player data (contains stats.tasksPanelClosed, etc.)
        this.influence = 0;     // Market influence points (from 100-quality ship collections)

        // Spawn system state
        this.factionId = null;  // 1=Southguard, 3=Northmen, null=neutral
        this.home = null;  // { structureId, x, z } or null if no home
        this.friendsList = [];  // Array of { id, username, faction, online }
        this.lastSpawnTime = null;  // Timestamp when player last spawned (for P2P kick logic)

        // Resume Last Session state (inventory sync system)
        this.hasSavedSession = false;  // True if server has saved inventory/position
        this.canResume = false;  // True if can resume (not on water vehicle)
        this.wasOnWaterVehicle = false;  // True if last save was on boat/sailboat/ship2
        this.savedPosition = null;  // { x, y, z } from last sync
        this.savedInventory = null;  // Array of items from last sync
        this.savedSlingItem = null;  // Sling item from last sync

        // Graphics quality setting (HIGH/MEDIUM/LOW)
        this.qualitySetting = 'HIGH';  // Default, loaded from localStorage

        // Faction constants - imported from config.js (must match server)
        this.FACTIONS = Object.freeze(CONFIG.FACTIONS);
        this.FACTION_ZONES = Object.freeze(CONFIG.FACTION_ZONES);
        this.FACTION_NAMES = Object.freeze(CONFIG.FACTION_NAMES);

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
        this.clickedTargetObjectId = null; // Track object clicked for movement (null if clicking terrain)
        this.nearestDeerCorpse = null; // {chunkKey, position, distance, chunkX, chunkZ} for deer harvesting
        this.nearestBrownbearCorpse = null; // {denId, position, distance, chunkX, chunkZ} for brownbear harvesting
        this.nearMerchant = null; // Merchant NPC data when player is near a merchant
        this.nearTrapper = null; // Trapper NPC data when player is near a trapper
        this.nearBaker = null; // Baker NPC data when player is near a baker
        this.nearGardener = null; // Gardener NPC data when player is near a gardener
        this.nearWoodcutter = null; // Woodcutter NPC data when player is near a woodcutter
        this.nearMiner = null; // Miner NPC data when player is near a miner
        this.nearFisherman = null; // Fisherman NPC data when player is near a fisherman
        this.nearBlacksmith = null; // Blacksmith NPC data when player is near a blacksmith
        this.nearIronWorker = null; // Iron Worker NPC data when player is near an iron worker
        this.nearTileWorker = null; // Tile Worker NPC data when player is near a tile worker
        this.nearStoneMason = null; // Stone Mason NPC data when player is near a stone mason
        this.removedObjectsCache = new Map(); // Key: chunkKey, Value: Set of removed objectIds
        this.roads = new Map(); // Key: chunkKey, Value: Array of { id, x, z, rotation, materialType } for road persistence
        this.docks = new Map(); // Key: chunkKey, Value: Array of { id, x, z, rotation, quality, ... } for terrain-based dock persistence

        // Player spatial partitioning for O(local density) lookups
        // Key: chunkKey (e.g. "0,0"), Value: Set of playerIds in that chunk
        this.playersByChunk = new Map();

        // Bandit structure spatial registry for AI detection
        // Key: chunkKey (e.g. "-1,0"), Value: Array of { id, position, type, object }
        this.banditStructuresByChunk = new Map();

        // Brown bear den spatial registry for AI detection
        // Key: chunkKey (e.g. "-1,0"), Value: Array of { id, position, type, object }
        this.brownBearStructuresByChunk = new Map();

        // Deer tree spatial registry for AI detection
        // Key: chunkKey (e.g. "-1,0"), Value: Array of { id, position, type, object }
        this.deerTreeStructuresByChunk = new Map();

        // Militia structure spatial registry for AI spawning
        // Key: chunkKey (e.g. "-1,0"), Value: Array of { id, position, type, militiaOwner, militiaFaction, militiaType }
        // NOTE: Only tent/outpost militia tracked here. Artillery militia uses dynamic lookup (mobile).
        this.militiaStructuresByChunk = new Map();

        // Market spatial registry for Baker AI detection
        // Key: chunkKey (e.g. "-1,0"), Value: Array of { id, position, object }
        this.marketsByChunk = new Map();

        // Bakery spatial registry for Baker AI detection
        // Key: chunkKey (e.g. "-1,0"), Value: Array of { id, position, object }
        this.bakeriesByChunk = new Map();

        // Gardener building spatial registry for Gardener AI detection
        // Key: chunkKey (e.g. "-1,0"), Value: Array of { id, position, object }
        this.gardenersByChunk = new Map();

        // Woodcutter building spatial registry for Woodcutter AI detection
        // Key: chunkKey (e.g. "-1,0"), Value: Array of { id, position, object }
        this.woodcuttersByChunk = new Map();

        // Miner building spatial registry for Miner AI detection
        // Key: chunkKey (e.g. "-1,0"), Value: Array of { id, position, object }
        this.minersByChunk = new Map();

        // Ironworks spatial registry for IronWorker AI detection
        // Key: chunkKey (e.g. "-1,0"), Value: Array of { id, position, object }
        this.ironworksByChunk = new Map();

        // Tileworks spatial registry for TileWorker AI detection
        // Key: chunkKey (e.g. "-1,0"), Value: Array of { id, position, object }
        this.tileworksByChunk = new Map();

        // Blacksmith spatial registry for Blacksmith AI detection
        // Key: chunkKey (e.g. "-1,0"), Value: Array of { id, position, object }
        this.blacksmithsByChunk = new Map();

        // Stonemason spatial registry for StoneMason AI detection
        // Key: chunkKey (e.g. "-1,0"), Value: Array of { id, position, object }
        this.stonemasonsByChunk = new Map();

        // Fisherman spatial registry for Fisherman AI detection
        // Key: chunkKey (e.g. "-1,0"), Value: Array of { id, position, object }
        this.fishermanByChunk = new Map();

        // Structure lookup by ID for O(1) access (used by Baker for inventory access)
        // Key: structureId, Value: { chunkKey, position, object, type }
        this.structuresById = new Map();

        // Growing trees tracking for efficient updates (avoids scene.traverse)
        // Set of objectIds currently growing
        this.growingTrees = new Set();

        // Decayable structures tracking for efficient decay checks (avoids scene.traverse)
        // Set of objectIds that need decay checking (structures, ruins, construction sites)
        this.decayableStructures = new Set();

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

        // Climbing state for outpost climbing
        this.climbingState = {
            isClimbing: false,           // Whether player is currently in an outpost
            climbingOutpost: null,        // Reference to the outpost object being climbed
            outpostId: null,              // ID of the outpost for network sync
            climbingStartTime: null,      // When climbing animation started
            climbingPhase: null,          // 'ascending', 'occupied', 'descending'
            originalPosition: null,       // Position before climbing (for descent)
            targetPosition: null,         // Target position (center of outpost + height)
            climbHeight: 1.5              // Height above outpost when occupied
        };

        // ==========================================
        // UNIFIED VEHICLE STATE (Phase 7)
        // ==========================================
        // Single source of truth for all vehicle/towing/cargo state
        this.vehicleState = new VehicleState();

        // Proximity tracking (for UI prompts)
        this.nearestMobileEntity = null;  // DEPRECATED: use nearestLandVehicle/nearestWaterVehicle
        this.nearestLandVehicle = null;   // { type: 'horse', object: THREE.Object3D }
        this.nearestWaterVehicle = null;  // { type: 'boat'|'sailboat'|'ship2', object: THREE.Object3D }
        this.nearestSwitchableMobileEntity = null;  // Nearby boat when already piloting
        this.nearestTowableEntity = null;  // { type: 'cart'|'artillery', object, distance }
        this.nearestLoadableCrate = null;  // { object, distance }
        this.nearestMannableArtillery = null;  // { object, distance, occupied }
        this.nearestLoadableArtillery = null;  // { object, distance }
        this.nearestLoadableHorse = null;  // { object, distance }

        // Inventory system (configuration from config.js)
        this.inventoryOpen = false;
        this.inventory = {
            rows: CONFIG.INVENTORY.BACKPACK_ROWS,  // 10 rows from config
            cols: CONFIG.INVENTORY.BACKPACK_COLS,  // 5 columns from config
            slotSize: CONFIG.INVENTORY.DEFAULT_SLOT_SIZE,  // 60px, recalculated on resize
            gap: CONFIG.INVENTORY.DEFAULT_GAP,     // 2px gap, recalculated on resize
            items: [],  // Empty by default - items given on random spawn via getDefaultInventoryItems()
            dirty: false  // Tracks if inventory changed since last sync (for Resume feature)
        };

        // Rifle sling slot (single item, separate from grid inventory)
        // Can only hold rifle items - provides quick access without using backpack space
        this.slingItem = null;

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

    // ==========================================
    // PLAYER SPATIAL PARTITIONING
    // ==========================================

    /**
     * Update a player's chunk in the spatial registry
     * @param {string} playerId - The player's ID
     * @param {string|null} oldChunkKey - Previous chunk key (e.g. "0,0") or null
     * @param {string} newChunkKey - New chunk key
     */
    updatePlayerChunk(playerId, oldChunkKey, newChunkKey) {
        // Remove from old chunk
        if (oldChunkKey) {
            const oldSet = this.playersByChunk.get(oldChunkKey);
            if (oldSet) {
                oldSet.delete(playerId);
                if (oldSet.size === 0) {
                    this.playersByChunk.delete(oldChunkKey);
                }
            }
        }

        // Add to new chunk
        if (!this.playersByChunk.has(newChunkKey)) {
            this.playersByChunk.set(newChunkKey, new Set());
        }
        this.playersByChunk.get(newChunkKey).add(playerId);
    }

    /**
     * Remove a player from the spatial registry entirely
     * @param {string} playerId - The player's ID
     * @param {string} chunkKey - The chunk they were in
     */
    removePlayerFromRegistry(playerId, chunkKey) {
        const chunkSet = this.playersByChunk.get(chunkKey);
        if (chunkSet) {
            chunkSet.delete(playerId);
            if (chunkSet.size === 0) {
                this.playersByChunk.delete(chunkKey);
            }
        }
    }

    /**
     * Get all players in specified chunks
     * @param {Array<string>} chunkKeys - Array of chunk keys to check
     * @returns {Set<string>} Set of player IDs in those chunks
     */
    getPlayersInChunks(chunkKeys) {
        const players = new Set();
        for (const key of chunkKeys) {
            const chunkPlayers = this.playersByChunk.get(key);
            if (chunkPlayers) {
                for (const playerId of chunkPlayers) {
                    players.add(playerId);
                }
            }
        }
        return players;
    }

    /**
     * Register a bandit structure for AI detection
     * @param {string} chunkKey - Chunk key (e.g. "-1,0")
     * @param {object} structureData - { id, position, type, object }
     */
    registerBanditStructure(chunkKey, structureData) {
        if (!this.banditStructuresByChunk.has(chunkKey)) {
            this.banditStructuresByChunk.set(chunkKey, []);
        }
        const structures = this.banditStructuresByChunk.get(chunkKey);
        // Avoid duplicates
        if (!structures.some(s => s.id === structureData.id)) {
            structures.push(structureData);
        }
    }

    /**
     * Unregister a bandit structure (when destroyed/removed)
     * @param {string} chunkKey - Chunk key
     * @param {string} structureId - Structure ID to remove
     */
    unregisterBanditStructure(chunkKey, structureId) {
        const structures = this.banditStructuresByChunk.get(chunkKey);
        if (structures) {
            const index = structures.findIndex(s => s.id === structureId);
            if (index !== -1) {
                structures.splice(index, 1);
                if (structures.length === 0) {
                    this.banditStructuresByChunk.delete(chunkKey);
                }
            }
        }
    }

    /**
     * Get bandit structures in a chunk (for AI detection)
     * @param {string} chunkKey - Chunk key
     * @returns {Array} Array of bandit structure data
     */
    getBanditStructuresInChunk(chunkKey) {
        return this.banditStructuresByChunk.get(chunkKey) || [];
    }

    /**
     * Register a brown bear den structure for AI detection
     * @param {string} chunkKey - Chunk key (e.g. "-1,0")
     * @param {object} structureData - { id, position, type, object }
     */
    registerBrownBearStructure(chunkKey, structureData) {
        if (!this.brownBearStructuresByChunk.has(chunkKey)) {
            this.brownBearStructuresByChunk.set(chunkKey, []);
        }
        const structures = this.brownBearStructuresByChunk.get(chunkKey);
        // Avoid duplicates
        if (!structures.some(s => s.id === structureData.id)) {
            structures.push(structureData);
        }
    }

    /**
     * Unregister a brown bear den structure (when destroyed/removed)
     * @param {string} chunkKey - Chunk key
     * @param {string} structureId - Structure ID to remove
     */
    unregisterBrownBearStructure(chunkKey, structureId) {
        const structures = this.brownBearStructuresByChunk.get(chunkKey);
        if (structures) {
            const index = structures.findIndex(s => s.id === structureId);
            if (index !== -1) {
                structures.splice(index, 1);
                if (structures.length === 0) {
                    this.brownBearStructuresByChunk.delete(chunkKey);
                }
            }
        }
    }

    /**
     * Get brown bear den structures in a chunk (for AI detection)
     * @param {string} chunkKey - Chunk key
     * @returns {Array} Array of brown bear structure data
     */
    getBrownBearStructuresInChunk(chunkKey) {
        return this.brownBearStructuresByChunk.get(chunkKey) || [];
    }

    /**
     * Register a deer tree structure for AI detection
     * @param {string} chunkKey - Chunk key (e.g. "-1,0")
     * @param {object} structureData - { id, position, type, object }
     */
    registerDeerTreeStructure(chunkKey, structureData) {
        if (!this.deerTreeStructuresByChunk.has(chunkKey)) {
            this.deerTreeStructuresByChunk.set(chunkKey, []);
        }
        const structures = this.deerTreeStructuresByChunk.get(chunkKey);
        // Avoid duplicates
        if (!structures.some(s => s.id === structureData.id)) {
            structures.push(structureData);
        }
    }

    /**
     * Unregister a deer tree structure (when destroyed/removed)
     * @param {string} chunkKey - Chunk key
     * @param {string} structureId - Structure ID to remove
     */
    unregisterDeerTreeStructure(chunkKey, structureId) {
        const structures = this.deerTreeStructuresByChunk.get(chunkKey);
        if (structures) {
            const index = structures.findIndex(s => s.id === structureId);
            if (index !== -1) {
                structures.splice(index, 1);
                if (structures.length === 0) {
                    this.deerTreeStructuresByChunk.delete(chunkKey);
                }
            }
        }
    }

    /**
     * Get deer tree structures in a chunk (for AI detection)
     * @param {string} chunkKey - Chunk key
     * @returns {Array} Array of deer tree structure data
     */
    getDeerTreeStructuresInChunk(chunkKey) {
        return this.deerTreeStructuresByChunk.get(chunkKey) || [];
    }

    // ==========================================
    // MILITIA STRUCTURE REGISTRY (for tent/outpost militia)
    // ==========================================

    /**
     * Register a militia structure for AI spawning (tent/outpost only)
     * @param {string} chunkKey - Chunk key (e.g. "-1,0")
     * @param {object} structureData - { id, position, type, militiaOwner, militiaFaction, militiaType }
     */
    registerMilitiaStructure(chunkKey, structureData) {
        if (!this.militiaStructuresByChunk.has(chunkKey)) {
            this.militiaStructuresByChunk.set(chunkKey, []);
        }
        const structures = this.militiaStructuresByChunk.get(chunkKey);
        // Avoid duplicates
        if (!structures.some(s => s.id === structureData.id)) {
            structures.push(structureData);
        }
    }

    /**
     * Unregister a militia structure (when destroyed/removed or militia dismissed)
     * @param {string} chunkKey - Chunk key
     * @param {string} structureId - Structure ID to remove
     */
    unregisterMilitiaStructure(chunkKey, structureId) {
        const structures = this.militiaStructuresByChunk.get(chunkKey);
        if (structures) {
            const index = structures.findIndex(s => s.id === structureId);
            if (index !== -1) {
                structures.splice(index, 1);
                if (structures.length === 0) {
                    this.militiaStructuresByChunk.delete(chunkKey);
                }
            }
        }
    }

    /**
     * Get militia structures in a chunk (for AI spawning)
     * @param {string} chunkKey - Chunk key
     * @returns {Array} Array of militia structure data
     */
    getMilitiaStructuresInChunk(chunkKey) {
        return this.militiaStructuresByChunk.get(chunkKey) || [];
    }

    // ==========================================
    // MARKET/BAKERY REGISTRY (for Baker AI)
    // ==========================================

    /**
     * Register a market structure for Baker AI detection
     * @param {string} chunkKey - Chunk key (e.g. "-1,0")
     * @param {object} marketData - { id, position, object }
     */
    registerMarket(chunkKey, marketData) {
        if (!this.marketsByChunk.has(chunkKey)) {
            this.marketsByChunk.set(chunkKey, []);
        }
        const markets = this.marketsByChunk.get(chunkKey);
        // Avoid duplicates
        if (!markets.some(m => m.id === marketData.id)) {
            markets.push(marketData);
        }
        // Also register by ID for O(1) lookup
        this.structuresById.set(marketData.id, {
            chunkKey,
            position: marketData.position,
            object: marketData.object,
            type: 'market'
        });
    }

    /**
     * Unregister a market structure (when destroyed/removed)
     * @param {string} chunkKey - Chunk key
     * @param {string} marketId - Market ID to remove
     */
    unregisterMarket(chunkKey, marketId) {
        const markets = this.marketsByChunk.get(chunkKey);
        if (markets) {
            const index = markets.findIndex(m => m.id === marketId);
            if (index !== -1) {
                markets.splice(index, 1);
                if (markets.length === 0) {
                    this.marketsByChunk.delete(chunkKey);
                }
            }
        }
        this.structuresById.delete(marketId);
    }

    /**
     * Get markets in a chunk
     * @param {string} chunkKey - Chunk key
     * @returns {Array} Array of market data
     */
    getMarketsInChunk(chunkKey) {
        return this.marketsByChunk.get(chunkKey) || [];
    }

    /**
     * Register a bakery structure for Baker AI detection
     * @param {string} chunkKey - Chunk key (e.g. "-1,0")
     * @param {object} bakeryData - { id, position, object }
     */
    registerBakery(chunkKey, bakeryData) {
        if (!this.bakeriesByChunk.has(chunkKey)) {
            this.bakeriesByChunk.set(chunkKey, []);
        }
        const bakeries = this.bakeriesByChunk.get(chunkKey);
        // Avoid duplicates
        if (!bakeries.some(b => b.id === bakeryData.id)) {
            bakeries.push(bakeryData);
        }
        // Also register by ID for O(1) lookup
        this.structuresById.set(bakeryData.id, {
            chunkKey,
            position: bakeryData.position,
            object: bakeryData.object,
            type: 'bakery'
        });
    }

    /**
     * Unregister a bakery structure (when destroyed/removed)
     * @param {string} chunkKey - Chunk key
     * @param {string} bakeryId - Bakery ID to remove
     */
    unregisterBakery(chunkKey, bakeryId) {
        const bakeries = this.bakeriesByChunk.get(chunkKey);
        if (bakeries) {
            const index = bakeries.findIndex(b => b.id === bakeryId);
            if (index !== -1) {
                bakeries.splice(index, 1);
                if (bakeries.length === 0) {
                    this.bakeriesByChunk.delete(chunkKey);
                }
            }
        }
        this.structuresById.delete(bakeryId);
    }

    /**
     * Get bakeries in a chunk
     * @param {string} chunkKey - Chunk key
     * @returns {Array} Array of bakery data
     */
    getBakeriesInChunk(chunkKey) {
        return this.bakeriesByChunk.get(chunkKey) || [];
    }

    /**
     * Register a gardener building for Gardener AI detection
     * @param {string} chunkKey - Chunk key (e.g. "-1,0")
     * @param {object} gardenerData - { id, position, object }
     */
    registerGardener(chunkKey, gardenerData) {
        if (!this.gardenersByChunk.has(chunkKey)) {
            this.gardenersByChunk.set(chunkKey, []);
        }
        const gardeners = this.gardenersByChunk.get(chunkKey);
        // Avoid duplicates
        if (!gardeners.some(g => g.id === gardenerData.id)) {
            gardeners.push(gardenerData);
        }
        // Also register by ID for O(1) lookup
        this.structuresById.set(gardenerData.id, {
            chunkKey,
            position: gardenerData.position,
            object: gardenerData.object,
            type: 'gardener'
        });
    }

    /**
     * Unregister a gardener building (when destroyed/removed)
     * @param {string} chunkKey - Chunk key
     * @param {string} gardenerId - Gardener building ID to remove
     */
    unregisterGardener(chunkKey, gardenerId) {
        const gardeners = this.gardenersByChunk.get(chunkKey);
        if (gardeners) {
            const index = gardeners.findIndex(g => g.id === gardenerId);
            if (index !== -1) {
                gardeners.splice(index, 1);
                if (gardeners.length === 0) {
                    this.gardenersByChunk.delete(chunkKey);
                }
            }
        }
        this.structuresById.delete(gardenerId);
    }

    /**
     * Get gardener buildings in a chunk
     * @param {string} chunkKey - Chunk key
     * @returns {Array} Array of gardener building data
     */
    getGardenersInChunk(chunkKey) {
        return this.gardenersByChunk.get(chunkKey) || [];
    }

    /**
     * Register a woodcutter building for Woodcutter AI detection
     * @param {string} chunkKey - Chunk key (e.g. "-1,0")
     * @param {object} woodcutterData - { id, position, object }
     */
    registerWoodcutter(chunkKey, woodcutterData) {
        if (!this.woodcuttersByChunk.has(chunkKey)) {
            this.woodcuttersByChunk.set(chunkKey, []);
        }
        const woodcutters = this.woodcuttersByChunk.get(chunkKey);
        // Avoid duplicates
        if (!woodcutters.some(w => w.id === woodcutterData.id)) {
            woodcutters.push(woodcutterData);
        }
        // Also register by ID for O(1) lookup
        this.structuresById.set(woodcutterData.id, {
            chunkKey,
            position: woodcutterData.position,
            object: woodcutterData.object,
            type: 'woodcutter'
        });
    }

    /**
     * Unregister a woodcutter building (when destroyed/removed)
     * @param {string} chunkKey - Chunk key
     * @param {string} woodcutterId - Woodcutter building ID to remove
     */
    unregisterWoodcutter(chunkKey, woodcutterId) {
        const woodcutters = this.woodcuttersByChunk.get(chunkKey);
        if (woodcutters) {
            const index = woodcutters.findIndex(w => w.id === woodcutterId);
            if (index !== -1) {
                woodcutters.splice(index, 1);
                if (woodcutters.length === 0) {
                    this.woodcuttersByChunk.delete(chunkKey);
                }
            }
        }
        this.structuresById.delete(woodcutterId);
    }

    /**
     * Get woodcutter buildings in a chunk
     * @param {string} chunkKey - Chunk key
     * @returns {Array} Array of woodcutter building data
     */
    getWoodcuttersInChunk(chunkKey) {
        return this.woodcuttersByChunk.get(chunkKey) || [];
    }

    /**
     * Register a miner building in a chunk
     * @param {string} chunkKey - Chunk key
     * @param {object} minerData - Miner building data { id, position, object }
     */
    registerMiner(chunkKey, minerData) {
        if (!this.minersByChunk.has(chunkKey)) {
            this.minersByChunk.set(chunkKey, []);
        }
        const miners = this.minersByChunk.get(chunkKey);
        const existingIndex = miners.findIndex(m => m.id === minerData.id);
        if (existingIndex >= 0) {
            miners[existingIndex] = minerData;
        } else {
            miners.push(minerData);
        }
        this.structuresById.set(minerData.id, { ...minerData, chunkKey, type: 'miner' });
    }

    /**
     * Unregister a miner building from a chunk
     * @param {string} chunkKey - Chunk key
     * @param {string} minerId - Miner building ID
     */
    unregisterMiner(chunkKey, minerId) {
        if (chunkKey) {
            const miners = this.minersByChunk.get(chunkKey);
            if (miners) {
                const index = miners.findIndex(m => m.id === minerId);
                if (index >= 0) {
                    miners.splice(index, 1);
                    if (miners.length === 0) {
                        this.minersByChunk.delete(chunkKey);
                    }
                }
            }
        } else {
            for (const [ck, miners] of this.minersByChunk) {
                const index = miners.findIndex(m => m.id === minerId);
                if (index >= 0) {
                    miners.splice(index, 1);
                    if (miners.length === 0) {
                        this.minersByChunk.delete(ck);
                    }
                    break;
                }
            }
        }
        this.structuresById.delete(minerId);
    }

    /**
     * Get miner buildings in a chunk
     * @param {string} chunkKey - Chunk key
     * @returns {Array} Array of miner building data
     */
    getMinersInChunk(chunkKey) {
        return this.minersByChunk.get(chunkKey) || [];
    }

    /**
     * Register a stonemason building in a chunk
     * @param {string} chunkKey - Chunk key
     * @param {object} stonemasonData - Stonemason building data { id, position, object }
     */
    registerStonemason(chunkKey, stonemasonData) {
        if (!this.stonemasonsByChunk.has(chunkKey)) {
            this.stonemasonsByChunk.set(chunkKey, []);
        }
        const stonemasons = this.stonemasonsByChunk.get(chunkKey);
        const existingIndex = stonemasons.findIndex(s => s.id === stonemasonData.id);
        if (existingIndex >= 0) {
            stonemasons[existingIndex] = stonemasonData;
        } else {
            stonemasons.push(stonemasonData);
        }
        this.structuresById.set(stonemasonData.id, { ...stonemasonData, chunkKey, type: 'stonemason' });
    }

    /**
     * Unregister a stonemason building from a chunk
     * @param {string} chunkKey - Chunk key
     * @param {string} stonemasonId - Stonemason building ID
     */
    unregisterStonemason(chunkKey, stonemasonId) {
        if (chunkKey) {
            const stonemasons = this.stonemasonsByChunk.get(chunkKey);
            if (stonemasons) {
                const index = stonemasons.findIndex(s => s.id === stonemasonId);
                if (index >= 0) {
                    stonemasons.splice(index, 1);
                    if (stonemasons.length === 0) {
                        this.stonemasonsByChunk.delete(chunkKey);
                    }
                }
            }
        } else {
            for (const [ck, stonemasons] of this.stonemasonsByChunk) {
                const index = stonemasons.findIndex(s => s.id === stonemasonId);
                if (index >= 0) {
                    stonemasons.splice(index, 1);
                    if (stonemasons.length === 0) {
                        this.stonemasonsByChunk.delete(ck);
                    }
                    break;
                }
            }
        }
        this.structuresById.delete(stonemasonId);
    }

    /**
     * Get stonemason buildings in a chunk
     * @param {string} chunkKey - Chunk key
     * @returns {Array} Array of stonemason building data
     */
    getStonemasonInChunk(chunkKey) {
        return this.stonemasonsByChunk.get(chunkKey) || [];
    }

    /**
     * Register an ironworks structure for IronWorker AI detection
     * @param {string} chunkKey - Chunk key (e.g. "-1,0")
     * @param {object} ironworksData - { id, position, object }
     */
    registerIronworks(chunkKey, ironworksData) {
        if (!this.ironworksByChunk.has(chunkKey)) {
            this.ironworksByChunk.set(chunkKey, []);
        }
        const ironworks = this.ironworksByChunk.get(chunkKey);
        // Avoid duplicates
        if (!ironworks.some(i => i.id === ironworksData.id)) {
            ironworks.push(ironworksData);
        }
        // Also register by ID for O(1) lookup
        this.structuresById.set(ironworksData.id, {
            chunkKey,
            position: ironworksData.position,
            object: ironworksData.object,
            type: 'ironworks'
        });
    }

    /**
     * Unregister an ironworks structure (when destroyed/removed)
     * @param {string} chunkKey - Chunk key
     * @param {string} ironworksId - Ironworks ID to remove
     */
    unregisterIronworks(chunkKey, ironworksId) {
        const ironworks = this.ironworksByChunk.get(chunkKey);
        if (ironworks) {
            const index = ironworks.findIndex(i => i.id === ironworksId);
            if (index !== -1) {
                ironworks.splice(index, 1);
                if (ironworks.length === 0) {
                    this.ironworksByChunk.delete(chunkKey);
                }
            }
        }
        this.structuresById.delete(ironworksId);
    }

    /**
     * Get ironworks in a chunk
     * @param {string} chunkKey - Chunk key
     * @returns {Array} Array of ironworks data
     */
    getIronworksInChunk(chunkKey) {
        return this.ironworksByChunk.get(chunkKey) || [];
    }

    /**
     * Register a tileworks structure for TileWorker AI detection
     * @param {string} chunkKey - Chunk key (e.g. "-1,0")
     * @param {object} tileworksData - { id, position, object }
     */
    registerTileworks(chunkKey, tileworksData) {
        if (!this.tileworksByChunk.has(chunkKey)) {
            this.tileworksByChunk.set(chunkKey, []);
        }
        const tileworks = this.tileworksByChunk.get(chunkKey);
        // Avoid duplicates
        if (!tileworks.some(t => t.id === tileworksData.id)) {
            tileworks.push(tileworksData);
        }
        // Also register by ID for O(1) lookup
        this.structuresById.set(tileworksData.id, {
            chunkKey,
            position: tileworksData.position,
            object: tileworksData.object,
            type: 'tileworks'
        });
    }

    /**
     * Unregister a tileworks structure (when destroyed/removed)
     * @param {string} chunkKey - Chunk key
     * @param {string} tileworksId - Tileworks ID to remove
     */
    unregisterTileworks(chunkKey, tileworksId) {
        const tileworks = this.tileworksByChunk.get(chunkKey);
        if (tileworks) {
            const index = tileworks.findIndex(t => t.id === tileworksId);
            if (index !== -1) {
                tileworks.splice(index, 1);
                if (tileworks.length === 0) {
                    this.tileworksByChunk.delete(chunkKey);
                }
            }
        }
        this.structuresById.delete(tileworksId);
    }

    /**
     * Get tileworks in a chunk
     * @param {string} chunkKey - Chunk key
     * @returns {Array} Array of tileworks data
     */
    getTileworksInChunk(chunkKey) {
        return this.tileworksByChunk.get(chunkKey) || [];
    }

    /**
     * Register a blacksmith structure for Blacksmith AI detection
     * @param {string} chunkKey - Chunk key (e.g. "-1,0")
     * @param {object} blacksmithData - { id, position, object }
     */
    registerBlacksmith(chunkKey, blacksmithData) {
        if (!this.blacksmithsByChunk.has(chunkKey)) {
            this.blacksmithsByChunk.set(chunkKey, []);
        }
        const blacksmiths = this.blacksmithsByChunk.get(chunkKey);
        // Avoid duplicates
        if (!blacksmiths.some(b => b.id === blacksmithData.id)) {
            blacksmiths.push(blacksmithData);
        }
        // Also register by ID for O(1) lookup
        this.structuresById.set(blacksmithData.id, {
            chunkKey,
            position: blacksmithData.position,
            object: blacksmithData.object,
            type: 'blacksmith'
        });
    }

    /**
     * Unregister a blacksmith structure (when destroyed/removed)
     * @param {string} chunkKey - Chunk key
     * @param {string} blacksmithId - Blacksmith ID to remove
     */
    unregisterBlacksmith(chunkKey, blacksmithId) {
        const blacksmiths = this.blacksmithsByChunk.get(chunkKey);
        if (blacksmiths) {
            const index = blacksmiths.findIndex(b => b.id === blacksmithId);
            if (index !== -1) {
                blacksmiths.splice(index, 1);
                if (blacksmiths.length === 0) {
                    this.blacksmithsByChunk.delete(chunkKey);
                }
            }
        }
        this.structuresById.delete(blacksmithId);
    }

    /**
     * Get blacksmiths in a chunk
     * @param {string} chunkKey - Chunk key
     * @returns {Array} Array of blacksmith data
     */
    getBlacksmithsInChunk(chunkKey) {
        return this.blacksmithsByChunk.get(chunkKey) || [];
    }

    /**
     * Register a fisherman structure in a chunk for Fisherman AI detection
     * @param {string} chunkKey - Chunk key (e.g. "-1,0")
     * @param {object} fishermanData - { id, position, object }
     */
    registerFisherman(chunkKey, fishermanData) {
        if (!this.fishermanByChunk.has(chunkKey)) {
            this.fishermanByChunk.set(chunkKey, []);
        }
        const fishermen = this.fishermanByChunk.get(chunkKey);
        // Avoid duplicates
        if (!fishermen.some(f => f.id === fishermanData.id)) {
            fishermen.push(fishermanData);
        }

        // Also register in quick-lookup map
        if (!this.structuresById.has(fishermanData.id)) {
            this.structuresById.set(fishermanData.id, {
                chunkKey,
                ...fishermanData,
                type: 'fisherman'
            });
        }
    }

    /**
     * Unregister a fisherman structure from a chunk
     * @param {string} chunkKey - Chunk key
     * @param {string} fishermanId - Fisherman structure ID to remove
     */
    unregisterFisherman(chunkKey, fishermanId) {
        const fishermen = this.fishermanByChunk.get(chunkKey);
        if (fishermen) {
            const index = fishermen.findIndex(f => f.id === fishermanId);
            if (index !== -1) {
                fishermen.splice(index, 1);
                if (fishermen.length === 0) {
                    this.fishermanByChunk.delete(chunkKey);
                }
            }
        }
        this.structuresById.delete(fishermanId);
    }

    /**
     * Get all fisherman structures in a chunk
     * @param {string} chunkKey - Chunk key
     * @returns {Array} Array of fisherman structure data
     */
    getFishermanInChunk(chunkKey) {
        return this.fishermanByChunk.get(chunkKey) || [];
    }

    /**
     * Get structure by ID for O(1) inventory access
     * @param {string} structureId - Structure ID
     * @returns {object|null} { chunkKey, position, object, type } or null
     */
    getStructureById(structureId) {
        return this.structuresById.get(structureId) || null;
    }

    /**
     * Set authenticated player information after successful login/registration
     * @param {string} accountId - The player's account ID from the server
     * @param {string} username - The player's username for display
     */
    setAuthenticated(accountId, username) {
        this.accountId = accountId;
        this.username = username;
        this.isGuest = false;
        this.hasCompletedInitialAuth = true;
        // P2P connections remain intact since clientId doesn't change
    }

    /**
     * Clear authentication and all user-specific state (for logout)
     * This ensures a complete reset when switching accounts
     */
    clearAuthentication() {
        // Auth state
        this.accountId = null;
        this.username = null;
        this.isGuest = true;
        this.hasCompletedInitialAuth = false;
        this.playerData = null;

        // Spawn system state
        this.factionId = null;
        this.home = null;
        this.friendsList = [];
        this.lastSpawnTime = null;

        // Resume session state
        this.hasSavedSession = false;
        this.canResume = false;
        this.wasOnWaterVehicle = false;
        this.savedPosition = null;
        this.savedInventory = null;
        this.savedSlingItem = null;

        // Other user-specific state
        this.influence = 0;
    }

    /**
     * Get the effective player ID for persistence
     * @returns {string} Account ID if logged in, null if guest
     */
    getPlayerId() {
        return this.accountId;
    }

    // ==========================================
    // SPAWN SYSTEM METHODS
    // ==========================================

    /**
     * Set spawn data from server response (after login)
     * @param {object} data - { factionId, home, friendsList }
     */
    setSpawnData(data) {
        if (data.factionId !== undefined) {
            this.factionId = data.factionId === null ? null : Number(data.factionId);
        }
        if (data.home !== undefined) {
            this.home = data.home;  // { structureId, x, z } or null
        }
        if (data.friendsList !== undefined) {
            this.friendsList = data.friendsList;
        }
    }

    /**
     * Set player's faction (client-side, should match server)
     * @param {number|null} factionId
     */
    setFaction(factionId) {
        this.factionId = factionId === null ? null : Number(factionId);
    }

    /**
     * Set player's home
     * @param {string} structureId
     * @param {number} x
     * @param {number} z
     */
    setHome(structureId, x, z) {
        this.home = { structureId, x, z };
    }

    /**
     * Clear player's home
     */
    clearHome() {
        this.home = null;
    }

    /**
     * Set graphics quality setting
     * @param {string} quality - 'HIGH', 'MEDIUM', or 'LOW'
     */
    setQualitySetting(quality) {
        this.qualitySetting = quality;
        localStorage.setItem('graphicsQuality', quality);
    }

    /**
     * Load graphics quality setting from localStorage
     * @returns {string} 'HIGH', 'MEDIUM', or 'LOW'
     */
    loadQualitySetting() {
        this.qualitySetting = localStorage.getItem('graphicsQuality') || 'HIGH';
        return this.qualitySetting;
    }

    /**
     * Get faction name by ID
     * @param {number|null} factionId
     * @returns {string}
     */
    getFactionName(factionId) {
        if (factionId === null) return 'Neutral';
        return this.FACTION_NAMES[factionId] || 'Unknown';
    }

    /**
     * Get faction zone by ID
     * @param {number|null} factionId
     * @returns {object|null} { name, minZ, maxZ } or null for neutral
     */
    getFactionZone(factionId) {
        if (factionId === null) return null;
        return this.FACTION_ZONES[factionId] || null;
    }

    /**
     * Check if a faction is an enemy of this player
     * Southguard (1) and Northmen (3) are enemies of each other
     * Neutral players have no enemies
     * @param {number|null} otherFactionId
     * @returns {boolean}
     */
    isEnemyFaction(otherFactionId) {
        // Neutral players have no enemies
        if (this.factionId === null || otherFactionId === null) {
            return false;
        }
        // Southguard (1) and Northmen (3) are enemies
        return this.factionId !== otherFactionId;
    }

    /**
     * Check if a Z coordinate is within player's faction zone
     * @param {number} z
     * @returns {boolean}
     */
    isInMyFactionZone(z) {
        if (this.factionId === null) {
            // Neutral players have access to all zones
            return true;
        }
        const zone = this.FACTION_ZONES[this.factionId];
        return zone && z >= zone.minZ && z < zone.maxZ;
    }

    /**
     * Update friends list
     * @param {Array} friends
     */
    setFriendsList(friends) {
        this.friendsList = friends || [];
    }

    /**
     * Get online friends in same faction
     * @returns {Array}
     */
    getOnlineFriendsInFaction() {
        return this.friendsList.filter(f => {
            // Coerce faction IDs to same type (server may send string or number)
            const friendFaction = f.faction == null ? null : Number(f.faction);
            const myFaction = this.factionId == null ? null : Number(this.factionId);
            return f.online && friendFaction === myFaction && f.status === 'accepted';
        });
    }

    /**
     * Get default starting inventory items (tools for new/respawning players)
     * Each call returns fresh objects with unique IDs to avoid reference issues
     * @returns {Array} Array of inventory item objects
     */
    getDefaultInventoryItems() {
        const timestamp = Date.now();
        return [
            {
                id: `vegetables_${timestamp}_1`,
                type: 'vegetables',
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                rotation: 0,
                quality: 100,
                durability: 20
            },
            {
                id: `apple_${timestamp}_2`,
                type: 'apple',
                x: 1,
                y: 0,
                width: 1,
                height: 1,
                rotation: 0,
                quality: 100,
                durability: 10
            },
            {
                id: `limestone_${timestamp}_3`,
                type: 'limestone',
                x: 2,
                y: 0,
                width: 1,
                height: 1,
                rotation: 0,
                quality: 50,
                durability: 100
            }
        ];
    }

    /**
     * Get default sling item for new/respawning players
     * @returns {null} No default sling item
     */
    getDefaultSlingItem() {
        return null;
    }

    // ==========================================
    // INVENTORY SYNC SYSTEM (Resume Feature)
    // ==========================================

    /**
     * Mark inventory as dirty (changed since last sync)
     * Called when items are added, removed, moved, or used
     */
    markInventoryDirty() {
        this.inventory.dirty = true;
    }

    /**
     * Set saved session data from server login response
     * @param {object} data - { hasSavedSession, canResume, wasOnWaterVehicle, savedPosition, savedInventory, savedSlingItem }
     */
    setSavedSessionData(data) {
        if (data.hasSavedSession !== undefined) {
            this.hasSavedSession = data.hasSavedSession;
        }
        if (data.canResume !== undefined) {
            this.canResume = data.canResume;
        }
        if (data.wasOnWaterVehicle !== undefined) {
            this.wasOnWaterVehicle = data.wasOnWaterVehicle;
        }
        if (data.savedPosition !== undefined) {
            this.savedPosition = data.savedPosition;
        }
        if (data.savedInventory !== undefined) {
            this.savedInventory = data.savedInventory;
        }
        if (data.savedSlingItem !== undefined) {
            this.savedSlingItem = data.savedSlingItem;
        }
    }

    /**
     * Clear saved session data (after resuming or choosing other spawn)
     */
    clearSavedSessionData() {
        this.hasSavedSession = false;
        this.canResume = false;
        this.wasOnWaterVehicle = false;
        this.savedPosition = null;
        this.savedInventory = null;
        this.savedSlingItem = null;
    }
}

/**
 * SpawnTasks.js
 * Handles scheduled spawning tasks:
 * - Apple tree spawning (every 10 minutes)
 * - Ship spawning at docks (every 30 minutes)
 */

const { CONFIG } = require('./ServerConfig.js');
const ChunkCoordinates = require('./ServerChunkCoords.js');

// ============================================
// Quality Generator (matches client QualityGenerator.js)
// ============================================

// World seed for quality calculations (consistent across server/client)
const WORLD_SEED = 12345;

// Deterministic RNG using Mulberry32 algorithm
function mulberry32(seed) {
    return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Generate chunk-specific seed from world seed and coordinates
function getChunkSeed(worldSeed, chunkX, chunkZ) {
    return worldSeed + chunkX * 73856093 + chunkZ * 19349663;
}

// Resource type seed offsets for independent quality distributions
const RESOURCE_OFFSETS = {
    'axe': 13000,
    'saw': 14000,
    'pickaxe': 15000,
    'hammer': 16000,
    'chisel': 17000,
    'fishingnet': 18000,
    'rifle': 19000,
    'ammo': 20000,
    'horse': 21000
};

// Quality ranges (0-9 maps to these)
const QUALITY_RANGES = [
    { min: 1,   max: 10 },
    { min: 11,  max: 20 },
    { min: 21,  max: 30 },
    { min: 31,  max: 40 },
    { min: 41,  max: 50 },
    { min: 51,  max: 60 },
    { min: 61,  max: 70 },
    { min: 71,  max: 80 },
    { min: 81,  max: 90 },
    { min: 91,  max: 100 }
];

/**
 * Get deterministic quality for an item type based on chunk location
 * @param {number} chunkX - Chunk X coordinate
 * @param {number} chunkZ - Chunk Z coordinate
 * @param {string} itemType - Item type (axe, saw, rifle, ammo, etc.)
 * @returns {number} - Quality value (1-100)
 */
function getChunkQuality(chunkX, chunkZ, itemType) {
    const offset = RESOURCE_OFFSETS[itemType] || 0;
    const chunkSeed = getChunkSeed(WORLD_SEED + offset, chunkX, chunkZ);
    const rng = mulberry32(chunkSeed);
    const rangeIndex = Math.floor(rng() * 10);
    const range = QUALITY_RANGES[rangeIndex];

    // Get a specific value within the range (deterministic based on chunk)
    const valueRng = mulberry32(chunkSeed + 999);
    return Math.floor(valueRng() * (range.max - range.min + 1)) + range.min;
}

// ============================================

class SpawnTasks {
    constructor(chunkManager, messageRouter, authManager) {
        this.chunkManager = chunkManager;
        this.messageRouter = messageRouter;
        this.authManager = authManager;
    }

    /**
     * Check if a position is free in the garden's inventory grid
     */
    isPositionFreeInGarden(newItem, existingItems) {
        for (const item of existingItems) {
            // Check for overlap
            const xOverlap = newItem.x < item.x + item.width && newItem.x + newItem.width > item.x;
            const yOverlap = newItem.y < item.y + item.height && newItem.y + newItem.height > item.y;

            if (xOverlap && yOverlap) {
                return false; // Position is occupied
            }
        }
        return true; // Position is free
    }

    /**
     * On-demand spawning for gardens and apple trees (tick-based)
     * Called when inventory is opened - checks if spawning is due based on lastSpawnTick
     * @param {object} structure - The garden or apple tree structure
     * @param {string} chunkId - Chunk ID containing the structure
     * @param {number} currentTick - Current server tick
     * @returns {number} Number of items spawned
     */
    async checkAndSpawnItems(structure, chunkId, currentTick) {
        try {
            const SPAWN_INTERVAL_TICKS = 600; // 10 minutes in ticks
            const ITEMS_PER_SPAWN = 2; // Items spawned per cycle

            // Initialize lastSpawnTick if not set (first interaction after migration)
            if (structure.lastSpawnTick === undefined) {
                structure.lastSpawnTick = currentTick;
                await this.chunkManager.saveChunk(chunkId);
                return 0; // No spawning on first interaction, just initialize
            }

            // Calculate spawn cycles elapsed
            const ticksElapsed = currentTick - structure.lastSpawnTick;
            const cyclesElapsed = Math.floor(ticksElapsed / SPAWN_INTERVAL_TICKS);

            if (cyclesElapsed <= 0) {
                return 0; // Not enough time has passed
            }

            // Calculate total items to spawn (2 per cycle)
            const itemsToSpawn = cyclesElapsed * ITEMS_PER_SPAWN;

            // Spawn based on structure type
            let itemsSpawned = 0;
            if (structure.name === 'apple') {
                itemsSpawned = await this.spawnItemsInAppleTreeOnDemand(structure, chunkId, itemsToSpawn);
            }

            // Update lastSpawnTick to current tick (not to elapsed cycles, to prevent drift)
            if (itemsSpawned > 0 || cyclesElapsed > 0) {
                structure.lastSpawnTick = currentTick;
                await this.chunkManager.saveChunk(chunkId);
            }

            return itemsSpawned;
        } catch (error) {
            console.error('ERROR in checkAndSpawnItems:', error);
            return 0;
        }
    }

    /**
     * On-demand apple tree spawning (no broadcast, used during inventory request)
     */
    async spawnItemsInAppleTreeOnDemand(appleTree, chunkId, count) {
        try {
            if (!appleTree.inventory) {
                appleTree.inventory = { items: [] };
            }

            const inventory = appleTree.inventory;
            let applesSpawned = 0;

            for (let i = 0; i < count; i++) {
                // Apple tree has 3x3 grid = 9 slots max
                if (inventory.items.length >= 9) {
                    break;
                }

                // Find a free position in the 3x3 grid
                let freePosition = null;
                for (let y = 0; y < 3 && !freePosition; y++) {
                    for (let x = 0; x < 3 && !freePosition; x++) {
                        const testItem = { x, y, width: 1, height: 1 };
                        if (this.isPositionFreeInGarden(testItem, inventory.items)) {
                            freePosition = { x, y };
                        }
                    }
                }

                if (!freePosition) {
                    break;
                }

                // Create new apple
                const baseDurability = 5;
                const itemQuality = appleTree.quality || 50;
                const itemId = `apple_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                const newItem = {
                    id: itemId,
                    type: 'apple',
                    x: freePosition.x,
                    y: freePosition.y,
                    width: 1,
                    height: 1,
                    rotation: 0,
                    quality: itemQuality,
                    durability: Math.round(baseDurability * (itemQuality / 100))
                };

                inventory.items.push(newItem);
                applesSpawned++;
            }

            return applesSpawned;
        } catch (error) {
            console.error('ERROR in spawnItemsInAppleTreeOnDemand:', error);
            return 0;
        }
    }

    /**
     * Find the nearest market to a dock position within MAX_DISTANCE
     * Returns only the market ID and chunk ID - use findObjectChange to get live reference
     * @param {Array} dockPosition - [x, y, z] position of the dock
     * @returns {object|null} { marketId, chunkId, distance } or null if none found
     */
    async findNearestMarketToDock(dockPosition) {
        const maxDistance = CONFIG.SHIP_TRADING.MAX_DISTANCE;
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(dockPosition[0], dockPosition[2]);
        const nearbyChunkIds = ChunkCoordinates.get3x3ChunkIds(chunkX, chunkZ);

        let nearestResult = null;
        let nearestDistance = maxDistance;

        for (const chunkId of nearbyChunkIds) {
            // Use loadChunk to ensure we get latest data (not stale cache)
            const chunkData = await this.chunkManager.loadChunk(chunkId);
            if (!chunkData?.objectChanges) continue;

            for (const obj of chunkData.objectChanges) {
                if (obj.action !== 'add' || obj.name !== 'market') continue;
                if (!obj.inventory) continue; // Must have inventory

                const dx = obj.position[0] - dockPosition[0];
                const dz = obj.position[2] - dockPosition[2];
                const dist = Math.sqrt(dx * dx + dz * dz);

                if (dist < nearestDistance) {
                    nearestDistance = dist;
                    // Only store IDs - caller should use findObjectChange for live reference
                    nearestResult = { marketId: obj.id, chunkId, distance: dist };
                }
            }
        }

        return nearestResult;
    }

    /**
     * Process ship trading at a dock - buy materials, sell tools/weapons
     * For every 10 materials bought, adds 1 of each sell item to market
     * @param {object} dock - The dock structure object
     * @param {string} dockChunkId - The chunk ID containing the dock
     */
    async processShipTrading(dock, dockChunkId) {
        const marketInfo = await this.findNearestMarketToDock(dock.position);
        if (!marketInfo) {
            return;
        }

        // Get live reference to market from chunk cache
        const market = await this.chunkManager.findObjectChange(marketInfo.chunkId, marketInfo.marketId);
        if (!market) {
            console.error(`[Ship Trade] ERROR: Could not find market ${marketInfo.marketId} in chunk ${marketInfo.chunkId}`);
            return;
        }

        const inventory = market.inventory;
        if (!inventory || !inventory.items) {
            console.error(`[Ship Trade] ERROR: Market has no inventory or items!`);
            return;
        }

        const buyMaterials = CONFIG.SHIP_TRADING.BUY_MATERIALS;
        const leaveBehind = CONFIG.SHIP_TRADING.LEAVE_BEHIND;

        let totalItemsBought = 0;
        let influenceGained = 0; // Track 100-quality items for market owner influence
        const itemsBought = {}; // Track what was bought

        // Phase 1: Buy materials from market (quantity-based, ignoring quality tiers)
        // Ship buys if total items of a type > LEAVE_BEHIND, regardless of quality distribution
        for (const itemType of buyMaterials) {
            if (!inventory.items[itemType]) continue;

            const qualityTiers = inventory.items[itemType];

            // Count total items across all quality tiers
            let totalForType = 0;
            const tierCounts = []; // [{quality, count}, ...] sorted high to low

            for (const qualityKey of Object.keys(qualityTiers)) {
                const quality = parseInt(qualityKey) || 50;  // Default to 50 if parsing fails
                const count = qualityTiers[qualityKey];
                if (count > 0) {
                    totalForType += count;
                    tierCounts.push({ quality, qualityKey, count });
                }
            }

            // Only buy if total exceeds leave-behind threshold
            const buyable = totalForType - leaveBehind;
            if (buyable <= 0) continue;

            // Sort by quality descending (remove highest quality first for influence rewards)
            tierCounts.sort((a, b) => b.quality - a.quality);

            // Remove items starting from highest quality
            let remaining = buyable;
            for (const tier of tierCounts) {
                if (remaining <= 0) break;

                const toRemove = Math.min(remaining, tier.count);
                totalItemsBought += toRemove;
                remaining -= toRemove;

                // Track 100-quality items for influence
                if (tier.quality === 100) {
                    influenceGained += toRemove;
                    console.error(`[Ship Trade] Found 100-quality ${itemType}: taking ${toRemove} (key=${tier.qualityKey})`);
                }

                // Update inventory - delete tier if empty to avoid database bloat
                const newCount = tier.count - toRemove;
                if (newCount <= 0) {
                    delete inventory.items[itemType][tier.qualityKey];
                } else {
                    inventory.items[itemType][tier.qualityKey] = newCount;
                }
            }

            // Track for summary
            itemsBought[itemType] = buyable;
        }

        // Award influence to market owner for 100-quality materials collected
        // Only faction players can earn influence
        if (influenceGained > 0) {
            console.error(`[Ship Trade] Influence check: gained=${influenceGained}, owner=${market.owner}, hasAuthManager=${!!this.authManager}`);
            if (market.owner && this.authManager) {
                const ownerFaction = await this.authManager.getFactionById(market.owner);
                console.error(`[Ship Trade] Owner faction lookup: owner=${market.owner}, factionId=${ownerFaction}`);
                if (ownerFaction) {
                    const result = await this.authManager.addInfluence(market.owner, influenceGained);
                    console.error(`[Ship Trade] Influence awarded: ${influenceGained} to ${market.owner}, result=${JSON.stringify(result)}`);
                } else {
                    console.error(`[Ship Trade] No faction found for owner ${market.owner} - influence NOT awarded`);
                }
            } else {
                console.error(`[Ship Trade] Missing owner or authManager - influence NOT awarded`);
            }
        }

        if (totalItemsBought === 0) {
            return;
        }

        // Calculate how many sets of items to add (1 of each per 10 materials bought)
        const setsToAdd = Math.floor(totalItemsBought / 10);
        if (setsToAdd === 0) {
            return;
        }

        // Parse chunk coordinates from marketInfo.chunkId (format: "chunk_X,Z")
        const chunkMatch = marketInfo.chunkId.match(/chunk_(-?\d+),(-?\d+)/);
        const chunkX = chunkMatch ? parseInt(chunkMatch[1]) : 0;
        const chunkZ = chunkMatch ? parseInt(chunkMatch[2]) : 0;

        // Phase 2: Add 1 of each sell item per 10 materials bought
        // Quality is determined by chunk location (like mushrooms)
        const sellItems = CONFIG.SHIP_TRADING.SELL_ITEMS;
        const itemsSold = {}; // Track what was sold
        const itemQualities = {}; // Track quality per item for logging

        for (const itemType of sellItems) {
            if (!inventory.items[itemType]) {
                inventory.items[itemType] = {};
            }

            // Get deterministic quality based on chunk and item type
            let quality = getChunkQuality(chunkX, chunkZ, itemType);

            // Apply quality floor of 25 for tools (matches CraftingSystem.js)
            const TOOL_TYPES = ['fishingnet', 'axe', 'pickaxe', 'saw', 'hammer', 'chisel'];
            if (TOOL_TYPES.includes(itemType)) {
                quality = Math.max(quality, 25);
            }

            // Use correct key format based on whether item has durability
            // Durability items use "quality,durability", others use just "quality"
            // For tools, durability = quality (the cap)
            const hasDurability = CONFIG.MARKET.DURABILITY_ITEMS.includes(itemType);
            const key = hasDurability ? `${quality},${quality}` : `${quality}`;
            const currentCount = inventory.items[itemType][key] || 0;
            inventory.items[itemType][key] = currentCount + setsToAdd;

            // Track for summary
            itemsSold[itemType] = setsToAdd;
            itemQualities[itemType] = quality;
        }

        // Save the market's chunk
        await this.chunkManager.saveChunk(marketInfo.chunkId);

        // Broadcast market inventory update
        this.messageRouter.broadcastTo3x3Grid(marketInfo.chunkId, {
            type: 'market_inventory_updated',
            payload: {
                marketId: market.id,
                items: inventory.items
            }
        });
    }

    /**
     * Initialize an apple tree with full inventory (9 apples) on first interaction
     * @param {string} appleTreeId - The apple tree's object ID (e.g., "0,0_apple_3")
     * @param {string} chunkId - The chunk ID containing the tree
     * @param {Array} position - The apple tree's position [x, y, z]
     * @param {number} scale - The apple tree's scale
     * @param {number} rotation - The apple tree's rotation in degrees
     * @returns {object} The created objectChange entry
     */
    async initializeAppleTree(appleTreeId, chunkId, position, scale, rotation) {
        try {
            const chunkData = await this.chunkManager.loadChunk(chunkId);

            // Parse objectId to get quality info
            // Format: "chunkX,chunkZ_apple_index"
            const parts = appleTreeId.split('_');
            const index = parseInt(parts[2]) || 0;

            // Generate deterministic quality based on chunk and index
            const chunkCoords = parts[0]; // "x,z"
            const [chunkX, chunkZ] = chunkCoords.split(',').map(Number);
            const seed = chunkX * 73856093 + chunkZ * 19349663 + index * 31337;
            const quality = 50 + (seed % 51); // Quality between 50-100

            // Create 9 apples (full 3x3 grid)
            const items = [];
            const baseDurability = 5; // Apple base durability
            let itemIndex = 0;

            for (let y = 0; y < 3; y++) {
                for (let x = 0; x < 3; x++) {
                    const itemId = `apple_${Date.now()}_${itemIndex}_${Math.random().toString(36).substr(2, 9)}`;
                    const itemQuality = quality;
                    const durability = Math.round(baseDurability * (itemQuality / 100));

                    items.push({
                        id: itemId,
                        type: 'apple',
                        x: x,
                        y: y,
                        width: 1,
                        height: 1,
                        rotation: 0,
                        quality: itemQuality,
                        durability: durability
                    });
                    itemIndex++;
                }
            }

            // Create objectChange entry for the apple tree with position data from client
            const appleTreeChange = {
                action: 'add',
                id: appleTreeId,
                name: 'apple',
                position: position,
                scale: scale,
                rotation: rotation,
                inventory: { items: items },
                quality: quality,
                chunkId: chunkId
            };

            // Add to chunk's objectChanges
            if (!Array.isArray(chunkData.objectChanges)) {
                chunkData.objectChanges = [];
            }
            chunkData.objectChanges.push(appleTreeChange);

            // Save chunk
            await this.chunkManager.saveChunk(chunkId);

            return appleTreeChange;
        } catch (error) {
            console.error('ERROR in initializeAppleTree:', error);
            return null;
        }
    }
}

module.exports = SpawnTasks;

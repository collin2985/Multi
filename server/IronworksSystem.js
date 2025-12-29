/**
 * IronworksSystem.js
 * Handles ironworks mechanics - transforming iron to ironingot
 * Uses tick-based timing for client-side calculation
 *
 * Key differences from TileworksSystem:
 * - Recipe: iron -> ironingot (exclusive - cannot be done elsewhere)
 * - Inventory restriction: only accepts iron, ironingot, and firewood types
 * - Single centered smoke source (not 2 at corners like tileworks)
 */

const { CONFIG } = require('./ServerConfig.js');

class IronworksSystem {
    constructor(chunkManager, messageRouter, timeTrackerService) {
        this.chunkManager = chunkManager;
        this.messageRouter = messageRouter;
        this.timeTrackerService = timeTrackerService;

        // Server tick reference (set by server.js tick interval)
        this.serverTick = 0;

        // Processing duration in ticks (1 tick = 1 second)
        this.PROCESSING_DURATION_TICKS = 60; // 1 minute for iron in ironworks

        // Processing recipes: raw item -> processed item
        // IMPORTANT: Iron can ONLY be processed here, not in campfire/house
        this.PROCESSING_RECIPES = {
            'iron': 'ironingot'
        };

        // Allowed items in ironworks inventory
        // Only iron, ironingot, and firewood types are allowed
        this.ALLOWED_ITEMS = [
            'iron',
            'ironingot',
            'oakfirewood',
            'pinefirewood',
            'firfirewood',
            'cypressfirewood',
            'applefirewood'
        ];
    }

    /**
     * Check if an item can be processed
     * @param {string} itemType - Type of item
     * @returns {boolean}
     */
    canBeProcessedItem(itemType) {
        return this.PROCESSING_RECIPES.hasOwnProperty(itemType);
    }

    /**
     * Check if an item type is allowed in ironworks inventory
     * @param {string} itemType - Type of item
     * @returns {boolean}
     */
    isItemAllowed(itemType) {
        if (!itemType) return false;

        // Direct match
        if (this.ALLOWED_ITEMS.includes(itemType)) return true;

        // Handle any firewood type (in case of future wood types)
        if (itemType.endsWith('firewood')) return true;

        return false;
    }

    /**
     * Filter inventory to only allowed items
     * Called when saving ironworks inventory for server-side security
     * @param {object} inventory - Inventory object { items: [...] }
     * @returns {object} Filtered inventory
     */
    filterInventory(inventory) {
        if (!inventory || !Array.isArray(inventory.items)) {
            return { items: [] };
        }

        const filteredItems = inventory.items.filter(item => {
            if (!item || !item.type) return false;
            return this.isItemAllowed(item.type);
        });

        return { items: filteredItems };
    }

    /**
     * Check ironworks inventory for items that can be processed
     * Called when ironworks inventory is saved
     * @param {string} ironworksId - ID of the ironworks
     * @param {string} chunkId - Chunk ID where ironworks is located
     * @param {object} inventory - Ironworks inventory { items: [...] }
     */
    checkForProcessableItems(ironworksId, chunkId, inventory) {
        if (!inventory || !Array.isArray(inventory.items)) {
            return;
        }

        // Check if firewood is present (any type: oak, pine, fir, cypress, apple)
        const hasFirewood = inventory.items.some(item =>
            item.type && item.type.endsWith('firewood') && item.durability > 0
        );

        if (!hasFirewood) {
            return;
        }

        // Find all processable items that aren't already processing
        inventory.items.forEach((item, index) => {
            if (this.canBeProcessedItem(item.type)) {
                // Only start processing if not already processing (check for processingStartTick)
                if (!item.processingStartTick) {
                    this.startProcessing(ironworksId, item.id, index, chunkId);
                }
            }
        });
    }

    /**
     * Start processing an item - stamps tick-based timing on item
     * @param {string} ironworksId - ID of the ironworks
     * @param {string} itemId - ID of the item being processed
     * @param {number} itemIndex - Index of item in inventory array
     * @param {string} chunkId - Chunk ID where ironworks is located
     */
    async startProcessing(ironworksId, itemId, itemIndex, chunkId) {
        try {
            const chunkData = await this.chunkManager.loadChunk(chunkId);
            const ironworksIndex = chunkData.objectChanges.findIndex(
                c => c.id === ironworksId && c.action === 'add'
            );

            if (ironworksIndex === -1) {
                console.error(`[IRONWORKS] Ironworks ${ironworksId} not found in chunk ${chunkId}`);
                return;
            }

            const ironworks = chunkData.objectChanges[ironworksIndex];
            if (!ironworks.inventory || !Array.isArray(ironworks.inventory.items)) {
                console.error(`[IRONWORKS] Ironworks ${ironworksId} has no inventory`);
                return;
            }

            const item = ironworks.inventory.items.find(i => i.id === itemId);
            if (!item) {
                console.error(`[IRONWORKS] Item ${itemId} not found in ironworks ${ironworksId}`);
                return;
            }

            // Don't start if already processing
            if (item.processingStartTick) {
                return;
            }

            // Clear any campfire cooking fields (item may have been moved from campfire)
            delete item.cookingStartTick;
            delete item.cookingDurationTicks;

            // Stamp tick-based processing info
            item.processingStartTick = this.serverTick;
            item.processingDurationTicks = this.PROCESSING_DURATION_TICKS;

            await this.chunkManager.saveChunk(chunkId);

            // Broadcast updated inventory with processing progress
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'crate_inventory_updated',
                payload: {
                    crateId: ironworksId,
                    inventory: ironworks.inventory
                }
            });

            console.log(`[IRONWORKS] Started processing ${item.type} (${itemId}) at tick ${this.serverTick}`);

        } catch (error) {
            console.error(`[IRONWORKS] Error starting processing for item ${itemId}:`, error);
        }
    }

    /**
     * Complete processing operation - validate and transform item
     * Called by client via processing_complete message
     * @param {string} ironworksId - ID of the ironworks
     * @param {string} itemId - ID of the item being processed
     * @param {string} chunkId - Chunk ID
     * @returns {object} Result { success, error, processedType }
     */
    async completeProcessing(ironworksId, itemId, chunkId) {
        try {
            // Load chunk data
            const chunkData = await this.chunkManager.loadChunk(chunkId);

            // Find ironworks object
            const ironworksIndex = chunkData.objectChanges.findIndex(
                c => c.id === ironworksId && c.action === 'add'
            );

            if (ironworksIndex === -1) {
                console.error(`[IRONWORKS] Ironworks ${ironworksId} not found in chunk ${chunkId}`);
                return { success: false, error: 'Ironworks not found' };
            }

            const ironworks = chunkData.objectChanges[ironworksIndex];

            if (!ironworks.inventory || !Array.isArray(ironworks.inventory.items)) {
                console.error(`[IRONWORKS] Ironworks ${ironworksId} has no inventory`);
                return { success: false, error: 'No inventory' };
            }

            // Find the item being processed
            const itemIndex = ironworks.inventory.items.findIndex(item => item.id === itemId);

            if (itemIndex === -1) {
                console.warn(`[IRONWORKS] Item ${itemId} no longer in ironworks (may have been removed)`);
                return { success: false, error: 'Item not found' };
            }

            const rawItem = ironworks.inventory.items[itemIndex];

            // Validate processing was in progress
            if (!rawItem.processingStartTick || !rawItem.processingDurationTicks) {
                console.warn(`[IRONWORKS] Item ${itemId} was not processing`);
                return { success: false, error: 'Item not processing' };
            }

            // Validate enough ticks have elapsed (allow some tolerance for network delay)
            const ticksElapsed = this.serverTick - rawItem.processingStartTick;
            const requiredTicks = rawItem.processingDurationTicks;
            const tolerance = 5; // Allow 5 tick tolerance

            if (ticksElapsed < requiredTicks - tolerance) {
                console.warn(`[IRONWORKS] Item ${itemId} processing not complete yet (${ticksElapsed}/${requiredTicks} ticks)`);
                return { success: false, error: 'Processing not complete' };
            }

            const processedType = this.PROCESSING_RECIPES[rawItem.type];

            if (!processedType) {
                console.error(`[IRONWORKS] No recipe found for ${rawItem.type}`);
                return { success: false, error: 'No recipe' };
            }

            // Calculate new quality: average of iron quality and ironworks structure quality
            const ironQuality = rawItem.quality || 50;
            const ironworksQuality = ironworks.quality || 50;
            const averagedQuality = Math.round((ironQuality + ironworksQuality) / 2);

            // Transform the item (average quality, clear processing fields)
            const processedItem = {
                ...rawItem,
                type: processedType,
                quality: averagedQuality,
                durability: 100, // Iron ingots start at full durability
                id: `${processedType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            };
            delete processedItem.processingStartTick;
            delete processedItem.processingDurationTicks;

            // Replace the raw item with processed item
            ironworks.inventory.items[itemIndex] = processedItem;

            // Save chunk
            await this.chunkManager.saveChunk(chunkId);

            // Broadcast updated inventory to all clients
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'crate_inventory_updated',
                payload: {
                    crateId: ironworksId,
                    inventory: ironworks.inventory
                }
            });

            console.log(`[IRONWORKS] Completed: ${rawItem.type} -> ${processedType} (quality: ${ironQuality} + ${ironworksQuality} / 2 = ${averagedQuality})`);

            return { success: true, processedType, processedItem };

        } catch (error) {
            console.error(`[IRONWORKS] Error completing processing for item ${itemId}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Cancel processing for an item (called when item is removed or firewood depletes)
     * @param {string} ironworksId - ID of the ironworks
     * @param {string} itemId - ID of the item
     * @param {string} chunkId - Chunk ID (optional, for clearing timestamp)
     */
    async cancelProcessing(ironworksId, itemId, chunkId = null) {
        if (!chunkId) return;

        try {
            const chunkData = await this.chunkManager.loadChunk(chunkId);
            const ironworksIndex = chunkData.objectChanges.findIndex(
                c => c.id === ironworksId && c.action === 'add'
            );

            if (ironworksIndex !== -1) {
                const ironworks = chunkData.objectChanges[ironworksIndex];
                if (ironworks.inventory && Array.isArray(ironworks.inventory.items)) {
                    const item = ironworks.inventory.items.find(i => i.id === itemId);
                    if (item && item.processingStartTick) {
                        delete item.processingStartTick;
                        delete item.processingDurationTicks;
                        await this.chunkManager.saveChunk(chunkId);

                        // Broadcast updated inventory
                        this.messageRouter.broadcastTo3x3Grid(chunkId, {
                            type: 'crate_inventory_updated',
                            payload: {
                                crateId: ironworksId,
                                inventory: ironworks.inventory
                            }
                        });

                        console.log(`[IRONWORKS] Cancelled processing for ${item.type}`);
                    }
                }
            }
        } catch (error) {
            console.error(`[IRONWORKS] Error cancelling processing:`, error);
        }
    }

    /**
     * Cancel all processing operations for a specific ironworks (called when firewood depletes)
     * @param {string} ironworksId - ID of the ironworks
     * @param {string} chunkId - Chunk ID for clearing timestamps and broadcasting
     * @param {object} inventory - Current inventory object (to clear processing fields from items)
     * @returns {boolean} - True if any processing was cancelled
     */
    cancelAllProcessingForStructure(ironworksId, chunkId, inventory) {
        let cancelledAny = false;

        // Clear processing tick fields from all items in inventory (in-memory, caller will save)
        if (inventory && Array.isArray(inventory.items)) {
            for (const item of inventory.items) {
                if (item.processingStartTick) {
                    delete item.processingStartTick;
                    delete item.processingDurationTicks;
                    cancelledAny = true;
                }
                // Also clear legacy fields if present
                if (item.processingStartTime) {
                    delete item.processingStartTime;
                    delete item.estimatedCompletionTime;
                    cancelledAny = true;
                }
            }
        }

        return cancelledAny;
    }
}

module.exports = IronworksSystem;

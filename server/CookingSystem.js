/**
 * CookingSystem.js
 * Handles campfire and house cooking mechanics:
 * - Transforms raw food items to cooked versions (1 minute)
 * - Processes clay into tiles (5 minutes)
 */

const { CONFIG } = require('./ServerConfig.js');

class CookingSystem {
    constructor(chunkManager, messageRouter, timeTrackerService) {
        this.chunkManager = chunkManager;
        this.messageRouter = messageRouter;
        this.timeTrackerService = timeTrackerService;

        // Server tick reference (set by MessageHandlers)
        this.serverTick = 0;

        // Cooking duration in ticks (1 tick = 1 second)
        this.COOKING_DURATION_TICKS = 60;      // 1 minute for food
        this.CLAY_CAMPFIRE_DURATION_TICKS = 300; // 5 minutes for clay in campfire
        this.CLAY_TILEWORKS_DURATION_TICKS = 60; // 1 minute for clay in tileworks

        // Cooking recipes: raw item -> cooked item
        this.COOKING_RECIPES = {
            'fish': 'cookedfish',
            'vegetables': 'roastedvegetables',
            'rawmeat': 'cookedmeat',
            'clay': 'tile'  // Clay to tile processing
        };
    }

    /**
     * Get processing duration for an item type in ticks
     * @param {string} itemType - Type of item
     * @param {string} structureType - Type of structure ('campfire', 'house', 'tileworks')
     * @returns {number} Duration in ticks
     */
    getProcessingDurationTicks(itemType, structureType = 'campfire') {
        if (itemType === 'clay') {
            // Clay in tileworks is faster
            if (structureType === 'tileworks') {
                return this.CLAY_TILEWORKS_DURATION_TICKS;
            }
            return this.CLAY_CAMPFIRE_DURATION_TICKS;
        }
        return this.COOKING_DURATION_TICKS;
    }

    /**
     * Check if an item can be cooked
     * @param {string} itemType - Type of item
     * @returns {boolean}
     */
    canBeCookedItem(itemType) {
        return this.COOKING_RECIPES.hasOwnProperty(itemType);
    }

    /**
     * Check structure inventory for items that can be cooked
     * Called when campfire/house inventory is saved
     * @param {string} structureId - ID of the structure
     * @param {string} chunkId - Chunk ID where structure is located
     * @param {object} inventory - Structure inventory { items: [...] }
     * @param {string} structureType - Type of structure ('campfire', 'house')
     */
    checkForCookableItems(structureId, chunkId, inventory, structureType = 'campfire') {
        if (!inventory || !Array.isArray(inventory.items)) {
            return;
        }

        // Check if firewood is present (any type: oak, pine, fir, cypress, apple)
        // NOTE: Firewood presence is now calculated client-side based on ticks
        // We still check here for items that don't have placedAtTick yet (legacy support)
        const hasFirewood = inventory.items.some(item =>
            item.type && item.type.endsWith('firewood') && item.durability > 0
        );

        if (!hasFirewood) {
            return;
        }

        // Collect all cookable items that aren't already cooking, then batch
        const cookableItemIds = [];
        inventory.items.forEach((item) => {
            if (this.canBeCookedItem(item.type) && !item.cookingStartTick) {
                cookableItemIds.push(item.id);
            }
        });

        if (cookableItemIds.length > 0) {
            this.startCookingBatch(structureId, cookableItemIds, chunkId, structureType);
        }
    }

    /**
     * Batch start cooking for multiple items - one load, stamp all, one save
     * @param {string} structureId - ID of the structure (campfire/house)
     * @param {Array<string>} itemIds - IDs of the items to start cooking
     * @param {string} chunkId - Chunk ID where structure is located
     * @param {string} structureType - Type of structure ('campfire', 'house')
     */
    async startCookingBatch(structureId, itemIds, chunkId, structureType = 'campfire') {
        try {
            const chunkData = await this.chunkManager.loadChunk(chunkId);
            const structure = chunkData.objectChanges.find(
                c => c.id === structureId && c.action === 'add'
            );

            if (!structure?.inventory?.items) return;

            let stamped = 0;
            for (const itemId of itemIds) {
                const item = structure.inventory.items.find(i => i.id === itemId);
                if (!item || item.cookingStartTick) continue;

                // Clear any tileworks processing fields (item may have been moved from tileworks)
                delete item.processingStartTick;
                delete item.processingDurationTicks;

                item.cookingStartTick = this.serverTick;
                item.cookingDurationTicks = this.getProcessingDurationTicks(item.type, structureType);
                stamped++;
            }

            if (stamped > 0) {
                await this.chunkManager.saveChunk(chunkId);

                this.messageRouter.broadcastTo3x3Grid(chunkId, {
                    type: 'crate_inventory_updated',
                    payload: {
                        crateId: structureId,
                        inventory: structure.inventory
                    }
                });
            }
        } catch (error) {
            console.error(`[COOKING] Error batch-starting cooking:`, error);
        }
    }

    /**
     * Start cooking a single item (wrapper around startCookingBatch)
     * @param {string} structureId - ID of the structure (campfire/house)
     * @param {string} itemId - ID of the item being cooked
     * @param {number} itemIndex - Index of item in inventory array (unused, kept for API compat)
     * @param {string} chunkId - Chunk ID where structure is located
     * @param {string} structureType - Type of structure ('campfire', 'house')
     */
    async startCooking(structureId, itemId, itemIndex, chunkId, structureType = 'campfire') {
        await this.startCookingBatch(structureId, [itemId], chunkId, structureType);
    }

    /**
     * Complete cooking operation - validate and transform item
     * Called by client via cooking_complete message
     * @param {string} structureId - ID of the structure
     * @param {string} itemId - ID of the item being cooked
     * @param {string} chunkId - Chunk ID
     * @returns {object} Result { success, error, cookedType }
     */
    async completeCooking(structureId, itemId, chunkId) {
        try {
            // Load chunk data
            const chunkData = await this.chunkManager.loadChunk(chunkId);

            // Find structure object
            const structureIndex = chunkData.objectChanges.findIndex(
                c => c.id === structureId && c.action === 'add'
            );

            if (structureIndex === -1) {
                console.error(`[COOKING] Structure ${structureId} not found in chunk ${chunkId}`);
                return { success: false, error: 'Structure not found' };
            }

            const structure = chunkData.objectChanges[structureIndex];

            if (!structure.inventory || !Array.isArray(structure.inventory.items)) {
                console.error(`[COOKING] Structure ${structureId} has no inventory`);
                return { success: false, error: 'No inventory' };
            }

            // Find the item being cooked
            const itemIndex = structure.inventory.items.findIndex(item => item.id === itemId);

            if (itemIndex === -1) {
                console.warn(`[COOKING] Item ${itemId} no longer in structure (may have been removed)`);
                return { success: false, error: 'Item not found' };
            }

            const rawItem = structure.inventory.items[itemIndex];

            // Validate cooking was in progress
            if (!rawItem.cookingStartTick || !rawItem.cookingDurationTicks) {
                console.warn(`[COOKING] Item ${itemId} was not cooking`);
                return { success: false, error: 'Item not cooking' };
            }

            // Validate enough ticks have elapsed (allow some tolerance for network delay)
            const ticksElapsed = this.serverTick - rawItem.cookingStartTick;
            const requiredTicks = rawItem.cookingDurationTicks;
            const tolerance = 5; // Allow 5 tick tolerance

            if (ticksElapsed < requiredTicks - tolerance) {
                console.warn(`[COOKING] Item ${itemId} cooking not complete yet (${ticksElapsed}/${requiredTicks} ticks)`);
                return { success: false, error: 'Cooking not complete' };
            }

            const cookedType = this.COOKING_RECIPES[rawItem.type];

            if (!cookedType) {
                console.error(`[COOKING] No recipe found for ${rawItem.type}`);
                return { success: false, error: 'No recipe' };
            }

            // Transform the item (preserve quality, clear cooking fields and durability)
            // IMPORTANT: Delete durability so client-side PlayerHunger can reinitialize it
            // based on the cooked food type's baseDurability (e.g., cookedmeat = 80)
            // Otherwise rawmeat's low durability (10-20) would be preserved
            const cookedItem = {
                ...rawItem,
                type: cookedType,
                id: `${cookedType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            };
            delete cookedItem.cookingStartTick;
            delete cookedItem.cookingDurationTicks;
            delete cookedItem.durability; // Let client recalculate based on cooked food type

            // Replace the raw item with cooked item
            structure.inventory.items[itemIndex] = cookedItem;

            // Save chunk
            await this.chunkManager.saveChunk(chunkId);

            // Broadcast updated inventory to all clients
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'crate_inventory_updated',
                payload: {
                    crateId: structureId,
                    inventory: structure.inventory
                }
            });

            return { success: true, cookedType, cookedItem };

        } catch (error) {
            console.error(`[COOKING] Error completing cooking for item ${itemId}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Cancel cooking for an item (called when item is removed or firewood depletes)
     * @param {string} structureId - ID of the structure
     * @param {string} itemId - ID of the item
     * @param {string} chunkId - Chunk ID (optional, for clearing timestamp)
     */
    async cancelCooking(structureId, itemId, chunkId = null) {
        if (!chunkId) return;

        try {
            const chunkData = await this.chunkManager.loadChunk(chunkId);
            const structureIndex = chunkData.objectChanges.findIndex(
                c => c.id === structureId && c.action === 'add'
            );

            if (structureIndex !== -1) {
                const structure = chunkData.objectChanges[structureIndex];
                if (structure.inventory && Array.isArray(structure.inventory.items)) {
                    const item = structure.inventory.items.find(i => i.id === itemId);
                    if (item && item.cookingStartTick) {
                        delete item.cookingStartTick;
                        delete item.cookingDurationTicks;
                        await this.chunkManager.saveChunk(chunkId);

                        // Broadcast updated inventory
                        this.messageRouter.broadcastTo3x3Grid(chunkId, {
                            type: 'crate_inventory_updated',
                            payload: {
                                crateId: structureId,
                                inventory: structure.inventory
                            }
                        });

                    }
                }
            }
        } catch (error) {
            console.error(`[COOKING] Error cancelling cooking:`, error);
        }
    }

    /**
     * Cancel all cooking operations for a specific structure (called when firewood depletes)
     * @param {string} structureId - ID of the structure (campfire, house, tileworks)
     * @param {string} chunkId - Chunk ID for clearing timestamps and broadcasting
     * @param {object} inventory - Current inventory object (to clear cooking fields from items)
     * @returns {boolean} - True if any cooking was cancelled
     */
    cancelAllCookingForStructure(structureId, chunkId, inventory) {
        let cancelledAny = false;

        // Clear cooking tick fields from all items in inventory (in-memory, caller will save)
        if (inventory && Array.isArray(inventory.items)) {
            for (const item of inventory.items) {
                if (item.cookingStartTick) {
                    delete item.cookingStartTick;
                    delete item.cookingDurationTicks;
                    cancelledAny = true;
                }
                // Also clear legacy fields if present
                if (item.cookingStartTime) {
                    delete item.cookingStartTime;
                    delete item.estimatedCompletionTime;
                    cancelledAny = true;
                }
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

module.exports = CookingSystem;

/**
 * BaseProcessingSystem.js
 * Shared base class for all structure processing systems (Bakery, Tileworks, Ironworks, Blacksmith, Fisherman)
 * Uses tick-based timing for client-side calculation
 *
 * Subclasses should:
 * 1. Call super() with config object containing: structureType, logTag, duration, recipes, allowedItems
 * 2. Override calculateDurability() if needed (default returns 100)
 */

class BaseProcessingSystem {
    /**
     * @param {object} chunkManager - For loading/saving chunk data
     * @param {object} messageRouter - For broadcasting inventory updates
     * @param {object} config - Configuration object
     * @param {string} config.structureType - Type identifier (e.g. 'bakery', 'tileworks')
     * @param {string} config.logTag - Log prefix (e.g. '[BAKERY]')
     * @param {number} config.duration - Processing duration in ticks (default 60)
     * @param {object} config.recipes - Recipe mapping { rawType: processedType }
     * @param {string[]} config.allowedItems - Optional array of allowed item types (null = allow all)
     */
    constructor(chunkManager, messageRouter, config) {
        this.chunkManager = chunkManager;
        this.messageRouter = messageRouter;

        // Server tick reference (set by server.js tick interval)
        this.serverTick = 0;

        // Configuration
        this.structureType = config.structureType;
        this.logTag = config.logTag || `[${config.structureType.toUpperCase()}]`;
        this.PROCESSING_DURATION_TICKS = config.duration || 60;
        this.PROCESSING_RECIPES = config.recipes || {};
        this.ALLOWED_ITEMS = config.allowedItems || null;
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
     * Check if an item type is allowed in structure inventory
     * @param {string} itemType - Type of item
     * @returns {boolean}
     */
    isItemAllowed(itemType) {
        if (!itemType) return false;

        // If no allowed items list, allow everything
        if (!this.ALLOWED_ITEMS) return true;

        // Direct match
        if (this.ALLOWED_ITEMS.includes(itemType)) return true;

        // Handle any firewood type
        if (itemType.endsWith('firewood')) return true;

        return false;
    }

    /**
     * Filter inventory to only allowed items
     * Called when saving structure inventory for server-side security
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
     * Calculate quality for processed item (can be overridden)
     * Default: average of raw item quality and structure quality
     * @param {object} rawItem - The raw item being processed
     * @param {object} structure - The structure object
     * @returns {number} Quality value
     */
    calculateQuality(rawItem, structure) {
        const itemQuality = rawItem.quality || 50;
        const structureQuality = structure.quality || 50;
        return Math.round((itemQuality + structureQuality) / 2);
    }

    /**
     * Calculate durability for processed item (can be overridden)
     * Default: returns 100 (for non-food items like tiles, ingots)
     * Food items should override this to use quality-based durability
     * @param {object} rawItem - The raw item being processed
     * @param {object} structure - The structure object
     * @param {number} quality - The calculated quality
     * @returns {number} Durability value
     */
    calculateDurability(rawItem, structure, quality) {
        return 100;
    }

    /**
     * Check structure inventory for items that can be processed
     * Called when structure inventory is saved
     * BATCHED: Collects all items needing processing, then does one load/save cycle
     * @param {string} structureId - ID of the structure
     * @param {string} chunkId - Chunk ID where structure is located
     * @param {object} inventory - Structure inventory { items: [...] }
     */
    async checkForProcessableItems(structureId, chunkId, inventory) {
        if (!inventory || !Array.isArray(inventory.items)) {
            return;
        }

        // Check if firewood is present (any type)
        const hasFirewood = inventory.items.some(item =>
            item.type && item.type.endsWith('firewood') && item.durability > 0
        );

        if (!hasFirewood) {
            return;
        }

        // Collect all item IDs that need processing started
        const itemsToProcess = inventory.items.filter(item =>
            this.canBeProcessedItem(item.type) && !item.processingStartTick
        ).map(item => item.id);

        if (itemsToProcess.length === 0) {
            return;
        }

        // Batch process: one load, stamp all, one save, one broadcast
        await this.startProcessingBatch(structureId, itemsToProcess, chunkId);
    }

    /**
     * Start processing multiple items in one batch - one load, one save, one broadcast
     * @param {string} structureId - ID of the structure
     * @param {string[]} itemIds - Array of item IDs to start processing
     * @param {string} chunkId - Chunk ID where structure is located
     */
    async startProcessingBatch(structureId, itemIds, chunkId) {
        if (!itemIds || itemIds.length === 0) return;

        try {
            const chunkData = await this.chunkManager.loadChunk(chunkId);
            const structureIndex = chunkData.objectChanges.findIndex(
                c => c.id === structureId && c.action === 'add'
            );

            if (structureIndex === -1) {
                console.error(`${this.logTag} Structure ${structureId} not found in chunk ${chunkId}`);
                return;
            }

            const structure = chunkData.objectChanges[structureIndex];
            if (!structure.inventory || !Array.isArray(structure.inventory.items)) {
                console.error(`${this.logTag} Structure ${structureId} has no inventory`);
                return;
            }

            // Stamp all items in one pass
            let stampedCount = 0;
            for (const itemId of itemIds) {
                const item = structure.inventory.items.find(i => i.id === itemId);
                if (!item) continue;
                if (item.processingStartTick) continue; // Already processing

                // Clear any other processing fields (item may have been moved from elsewhere)
                delete item.cookingStartTick;
                delete item.cookingDurationTicks;

                // Stamp tick-based processing info
                item.processingStartTick = this.serverTick;
                item.processingDurationTicks = this.PROCESSING_DURATION_TICKS;
                stampedCount++;
            }

            if (stampedCount === 0) return;

            // One save for all items
            await this.chunkManager.saveChunk(chunkId);

            // One broadcast for all items
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'crate_inventory_updated',
                payload: {
                    crateId: structureId,
                    inventory: structure.inventory
                }
            });

        } catch (error) {
            console.error(`${this.logTag} Error starting batch processing:`, error);
        }
    }

    /**
     * Start processing a single item (legacy support, uses batch internally)
     * @param {string} structureId - ID of the structure
     * @param {string} itemId - ID of the item being processed
     * @param {number} itemIndex - Index of item in inventory array (unused, for compatibility)
     * @param {string} chunkId - Chunk ID where structure is located
     */
    async startProcessing(structureId, itemId, itemIndex, chunkId) {
        await this.startProcessingBatch(structureId, [itemId], chunkId);
    }

    /**
     * Complete processing operation - validate and transform item
     * Called by client via processing_complete message
     * @param {string} structureId - ID of the structure
     * @param {string} itemId - ID of the item being processed
     * @param {string} chunkId - Chunk ID
     * @returns {object} Result { success, error, processedType, processedItem }
     */
    async completeProcessing(structureId, itemId, chunkId) {
        try {
            // Load chunk data
            const chunkData = await this.chunkManager.loadChunk(chunkId);

            // Find structure object
            const structureIndex = chunkData.objectChanges.findIndex(
                c => c.id === structureId && c.action === 'add'
            );

            if (structureIndex === -1) {
                console.error(`${this.logTag} Structure ${structureId} not found in chunk ${chunkId}`);
                return { success: false, error: 'Structure not found' };
            }

            const structure = chunkData.objectChanges[structureIndex];

            if (!structure.inventory || !Array.isArray(structure.inventory.items)) {
                console.error(`${this.logTag} Structure ${structureId} has no inventory`);
                return { success: false, error: 'No inventory' };
            }

            // Find the item being processed
            const itemIndex = structure.inventory.items.findIndex(item => item.id === itemId);

            if (itemIndex === -1) {
                console.warn(`${this.logTag} Item ${itemId} no longer in structure (may have been removed)`);
                return { success: false, error: 'Item not found' };
            }

            const rawItem = structure.inventory.items[itemIndex];

            // Validate processing was in progress
            if (!rawItem.processingStartTick || !rawItem.processingDurationTicks) {
                console.warn(`${this.logTag} Item ${itemId} was not processing`);
                return { success: false, error: 'Item not processing' };
            }

            // Validate enough ticks have elapsed (allow some tolerance for network delay)
            const ticksElapsed = this.serverTick - rawItem.processingStartTick;
            const requiredTicks = rawItem.processingDurationTicks;
            const tolerance = 5; // Allow 5 tick tolerance

            if (ticksElapsed < requiredTicks - tolerance) {
                console.warn(`${this.logTag} Item ${itemId} processing not complete yet (${ticksElapsed}/${requiredTicks} ticks)`);
                return { success: false, error: 'Processing not complete' };
            }

            const processedType = this.PROCESSING_RECIPES[rawItem.type];

            if (!processedType) {
                console.error(`${this.logTag} No recipe found for ${rawItem.type}`);
                return { success: false, error: 'No recipe' };
            }

            // Calculate quality and durability (can be overridden by subclasses)
            const quality = this.calculateQuality(rawItem, structure);
            const durability = this.calculateDurability(rawItem, structure, quality);

            // Transform the item
            const processedItem = {
                ...rawItem,
                type: processedType,
                quality: quality,
                durability: durability,
                id: `${processedType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            };
            delete processedItem.processingStartTick;
            delete processedItem.processingDurationTicks;

            // Replace the raw item with processed item
            structure.inventory.items[itemIndex] = processedItem;

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

            return { success: true, processedType, processedItem };

        } catch (error) {
            console.error(`${this.logTag} Error completing processing for item ${itemId}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Cancel processing for an item (called when item is removed or firewood depletes)
     * @param {string} structureId - ID of the structure
     * @param {string} itemId - ID of the item
     * @param {string} chunkId - Chunk ID
     */
    async cancelProcessing(structureId, itemId, chunkId = null) {
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
                    if (item && item.processingStartTick) {
                        delete item.processingStartTick;
                        delete item.processingDurationTicks;
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
            console.error(`${this.logTag} Error cancelling processing:`, error);
        }
    }

    /**
     * Check and complete all finished processing items in a structure
     * Called by NPC workers to trigger processing completion without player interaction
     * @param {string} structureId - ID of the structure
     * @param {string} chunkId - Chunk ID
     * @returns {object} Result { success, completedCount, outputCount }
     */
    async checkAndCompleteProcessing(structureId, chunkId) {
        try {
            const chunkData = await this.chunkManager.loadChunk(chunkId);
            const structureIndex = chunkData.objectChanges.findIndex(
                c => c.id === structureId && c.action === 'add'
            );

            if (structureIndex === -1) {
                return { success: false, error: 'Structure not found', completedCount: 0, outputCount: 0 };
            }

            const structure = chunkData.objectChanges[structureIndex];
            if (!structure.inventory || !Array.isArray(structure.inventory.items)) {
                return { success: false, error: 'No inventory', completedCount: 0, outputCount: 0 };
            }

            let completedCount = 0;
            let needsSave = false;

            // Check each item for completed processing
            for (let i = 0; i < structure.inventory.items.length; i++) {
                const item = structure.inventory.items[i];

                // Skip if not processing
                if (!item.processingStartTick || !item.processingDurationTicks) continue;

                // Check if processing is complete
                const ticksElapsed = this.serverTick - item.processingStartTick;
                if (ticksElapsed >= item.processingDurationTicks) {
                    // Complete this item
                    const processedType = this.PROCESSING_RECIPES[item.type];
                    if (processedType) {
                        // Calculate quality and durability
                        const quality = this.calculateQuality(item, structure);
                        const durability = this.calculateDurability(item, structure, quality);

                        // Transform the item
                        structure.inventory.items[i] = {
                            ...item,
                            type: processedType,
                            quality: quality,
                            durability: durability,
                            id: `${processedType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
                        };
                        delete structure.inventory.items[i].processingStartTick;
                        delete structure.inventory.items[i].processingDurationTicks;

                        completedCount++;
                        needsSave = true;
                    }
                }
            }

            if (needsSave) {
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

            // Count output items in inventory (get all processed types from recipes)
            const outputTypes = Object.values(this.PROCESSING_RECIPES);
            const outputCount = structure.inventory.items.filter(
                item => outputTypes.includes(item.type)
            ).length;

            return { success: true, completedCount, outputCount };

        } catch (error) {
            console.error(`${this.logTag} Error in checkAndCompleteProcessing:`, error);
            return { success: false, error: error.message, completedCount: 0, outputCount: 0 };
        }
    }

    /**
     * Cancel all processing operations for a structure (called when firewood depletes)
     * @param {string} structureId - ID of the structure
     * @param {string} chunkId - Chunk ID for clearing timestamps and broadcasting
     * @param {object} inventory - Current inventory object (to clear processing fields from items)
     * @returns {boolean} - True if any processing was cancelled
     */
    cancelAllProcessingForStructure(structureId, chunkId, inventory) {
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

module.exports = BaseProcessingSystem;

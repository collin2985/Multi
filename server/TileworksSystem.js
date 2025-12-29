/**
 * TileworksSystem.js
 * Handles tileworks mechanics - transforming clay to tile
 * Uses tick-based timing for client-side calculation
 */

const { CONFIG } = require('./ServerConfig.js');

class TileworksSystem {
    constructor(chunkManager, messageRouter, timeTrackerService) {
        this.chunkManager = chunkManager;
        this.messageRouter = messageRouter;
        this.timeTrackerService = timeTrackerService;

        // Server tick reference (set by server.js tick interval)
        this.serverTick = 0;

        // Processing duration in ticks (1 tick = 1 second)
        this.PROCESSING_DURATION_TICKS = 60; // 1 minute for clay in tileworks

        // Processing recipes: raw item -> processed item
        this.PROCESSING_RECIPES = {
            'clay': 'tile'
        };
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
     * Check tileworks inventory for items that can be processed
     * Called when tileworks inventory is saved
     * @param {string} tileworksId - ID of the tileworks
     * @param {string} chunkId - Chunk ID where tileworks is located
     * @param {object} inventory - Tileworks inventory { items: [...] }
     */
    checkForProcessableItems(tileworksId, chunkId, inventory) {
        if (!inventory || !Array.isArray(inventory.items)) {
            return;
        }

        // Check if firewood is present (any type: oak, pine, fir, cypress, apple)
        // NOTE: Firewood presence is now calculated client-side based on ticks
        // We still check here for items that don't have processingStartTick yet (legacy support)
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
                    this.startProcessing(tileworksId, item.id, index, chunkId);
                }
            }
        });
    }

    /**
     * Start processing an item - stamps tick-based timing on item
     * @param {string} tileworksId - ID of the tileworks
     * @param {string} itemId - ID of the item being processed
     * @param {number} itemIndex - Index of item in inventory array
     * @param {string} chunkId - Chunk ID where tileworks is located
     */
    async startProcessing(tileworksId, itemId, itemIndex, chunkId) {
        try {
            const chunkData = await this.chunkManager.loadChunk(chunkId);
            const tileworksIndex = chunkData.objectChanges.findIndex(
                c => c.id === tileworksId && c.action === 'add'
            );

            if (tileworksIndex === -1) {
                console.error(`[TILEWORKS] Tileworks ${tileworksId} not found in chunk ${chunkId}`);
                return;
            }

            const tileworks = chunkData.objectChanges[tileworksIndex];
            if (!tileworks.inventory || !Array.isArray(tileworks.inventory.items)) {
                console.error(`[TILEWORKS] Tileworks ${tileworksId} has no inventory`);
                return;
            }

            const item = tileworks.inventory.items.find(i => i.id === itemId);
            if (!item) {
                console.error(`[TILEWORKS] Item ${itemId} not found in tileworks ${tileworksId}`);
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
                    crateId: tileworksId,
                    inventory: tileworks.inventory
                }
            });

        } catch (error) {
            console.error(`[TILEWORKS] Error starting processing for item ${itemId}:`, error);
        }
    }

    /**
     * Complete processing operation - validate and transform item
     * Called by client via processing_complete message
     * @param {string} tileworksId - ID of the tileworks
     * @param {string} itemId - ID of the item being processed
     * @param {string} chunkId - Chunk ID
     * @returns {object} Result { success, error, processedType }
     */
    async completeProcessing(tileworksId, itemId, chunkId) {
        try {
            // Load chunk data
            const chunkData = await this.chunkManager.loadChunk(chunkId);

            // Find tileworks object
            const tileworksIndex = chunkData.objectChanges.findIndex(
                c => c.id === tileworksId && c.action === 'add'
            );

            if (tileworksIndex === -1) {
                console.error(`[TILEWORKS] Tileworks ${tileworksId} not found in chunk ${chunkId}`);
                return { success: false, error: 'Tileworks not found' };
            }

            const tileworks = chunkData.objectChanges[tileworksIndex];

            if (!tileworks.inventory || !Array.isArray(tileworks.inventory.items)) {
                console.error(`[TILEWORKS] Tileworks ${tileworksId} has no inventory`);
                return { success: false, error: 'No inventory' };
            }

            // Find the item being processed
            const itemIndex = tileworks.inventory.items.findIndex(item => item.id === itemId);

            if (itemIndex === -1) {
                console.warn(`[TILEWORKS] Item ${itemId} no longer in tileworks (may have been removed)`);
                return { success: false, error: 'Item not found' };
            }

            const rawItem = tileworks.inventory.items[itemIndex];

            // Validate processing was in progress
            if (!rawItem.processingStartTick || !rawItem.processingDurationTicks) {
                console.warn(`[TILEWORKS] Item ${itemId} was not processing`);
                return { success: false, error: 'Item not processing' };
            }

            // Validate enough ticks have elapsed (allow some tolerance for network delay)
            const ticksElapsed = this.serverTick - rawItem.processingStartTick;
            const requiredTicks = rawItem.processingDurationTicks;
            const tolerance = 5; // Allow 5 tick tolerance

            if (ticksElapsed < requiredTicks - tolerance) {
                console.warn(`[TILEWORKS] Item ${itemId} processing not complete yet (${ticksElapsed}/${requiredTicks} ticks)`);
                return { success: false, error: 'Processing not complete' };
            }

            const processedType = this.PROCESSING_RECIPES[rawItem.type];

            if (!processedType) {
                console.error(`[TILEWORKS] No recipe found for ${rawItem.type}`);
                return { success: false, error: 'No recipe' };
            }

            // Calculate new quality: average of clay quality and tileworks structure quality
            const clayQuality = rawItem.quality || 50;
            const tileworksQuality = tileworks.quality || 50;
            const averagedQuality = Math.round((clayQuality + tileworksQuality) / 2);

            // Transform the item (average quality, clear processing fields)
            const processedItem = {
                ...rawItem,
                type: processedType,
                quality: averagedQuality,
                id: `${processedType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            };
            delete processedItem.processingStartTick;
            delete processedItem.processingDurationTicks;

            // Replace the raw item with processed item
            tileworks.inventory.items[itemIndex] = processedItem;

            // Save chunk
            await this.chunkManager.saveChunk(chunkId);

            // Broadcast updated inventory to all clients
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'crate_inventory_updated',
                payload: {
                    crateId: tileworksId,
                    inventory: tileworks.inventory
                }
            });

            return { success: true, processedType, processedItem };

        } catch (error) {
            console.error(`[TILEWORKS] Error completing processing for item ${itemId}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Cancel processing for an item (called when item is removed or firewood depletes)
     * @param {string} tileworksId - ID of the tileworks
     * @param {string} itemId - ID of the item
     * @param {string} chunkId - Chunk ID (optional, for clearing timestamp)
     */
    async cancelProcessing(tileworksId, itemId, chunkId = null) {
        if (!chunkId) return;

        try {
            const chunkData = await this.chunkManager.loadChunk(chunkId);
            const tileworksIndex = chunkData.objectChanges.findIndex(
                c => c.id === tileworksId && c.action === 'add'
            );

            if (tileworksIndex !== -1) {
                const tileworks = chunkData.objectChanges[tileworksIndex];
                if (tileworks.inventory && Array.isArray(tileworks.inventory.items)) {
                    const item = tileworks.inventory.items.find(i => i.id === itemId);
                    if (item && item.processingStartTick) {
                        delete item.processingStartTick;
                        delete item.processingDurationTicks;
                        await this.chunkManager.saveChunk(chunkId);

                        // Broadcast updated inventory
                        this.messageRouter.broadcastTo3x3Grid(chunkId, {
                            type: 'crate_inventory_updated',
                            payload: {
                                crateId: tileworksId,
                                inventory: tileworks.inventory
                            }
                        });

                    }
                }
            }
        } catch (error) {
            console.error(`[TILEWORKS] Error cancelling processing:`, error);
        }
    }

    /**
     * Cancel all processing operations for a specific tileworks (called when firewood depletes)
     * @param {string} tileworksId - ID of the tileworks
     * @param {string} chunkId - Chunk ID for clearing timestamps and broadcasting
     * @param {object} inventory - Current inventory object (to clear processing fields from items)
     * @returns {boolean} - True if any processing was cancelled
     */
    cancelAllProcessingForStructure(tileworksId, chunkId, inventory) {
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

module.exports = TileworksSystem;

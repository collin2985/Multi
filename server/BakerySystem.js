/**
 * BakerySystem.js
 * Handles bakery mechanics - transforming apple to appletart
 * Uses tick-based timing for client-side calculation
 *
 * Key differences from BlacksmithSystem:
 * - Recipe: apple -> appletart (exclusive - cannot be done elsewhere)
 * - Inventory restriction: only accepts apple, appletart, and firewood types
 * - Single centered smoke source (same as blacksmith/ironworks)
 */

const { CONFIG } = require('./ServerConfig.js');

class BakerySystem {
    constructor(chunkManager, messageRouter, timeTrackerService) {
        this.chunkManager = chunkManager;
        this.messageRouter = messageRouter;
        this.timeTrackerService = timeTrackerService;

        // Server tick reference (set by server.js tick interval)
        this.serverTick = 0;

        // Processing duration in ticks (1 tick = 1 second)
        this.PROCESSING_DURATION_TICKS = 60; // 1 minute for apple in bakery

        // Processing recipes: raw item -> processed item
        // IMPORTANT: Apple -> appletart can ONLY be processed here
        this.PROCESSING_RECIPES = {
            'apple': 'appletart'
        };

        // Allowed items in bakery inventory
        // Only apple, appletart, and firewood types are allowed
        this.ALLOWED_ITEMS = [
            'apple',
            'appletart',
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
     * Check if an item type is allowed in bakery inventory
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
     * Called when saving bakery inventory for server-side security
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
     * Check bakery inventory for items that can be processed
     * Called when bakery inventory is saved
     * @param {string} bakeryId - ID of the bakery
     * @param {string} chunkId - Chunk ID where bakery is located
     * @param {object} inventory - Bakery inventory { items: [...] }
     */
    checkForProcessableItems(bakeryId, chunkId, inventory) {
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
                    this.startProcessing(bakeryId, item.id, index, chunkId);
                }
            }
        });
    }

    /**
     * Start processing an item - stamps tick-based timing on item
     * @param {string} bakeryId - ID of the bakery
     * @param {string} itemId - ID of the item being processed
     * @param {number} itemIndex - Index of item in inventory array
     * @param {string} chunkId - Chunk ID where bakery is located
     */
    async startProcessing(bakeryId, itemId, itemIndex, chunkId) {
        try {
            const chunkData = await this.chunkManager.loadChunk(chunkId);
            const bakeryIndex = chunkData.objectChanges.findIndex(
                c => c.id === bakeryId && c.action === 'add'
            );

            if (bakeryIndex === -1) {
                console.error(`[BAKERY] Bakery ${bakeryId} not found in chunk ${chunkId}`);
                return;
            }

            const bakery = chunkData.objectChanges[bakeryIndex];
            if (!bakery.inventory || !Array.isArray(bakery.inventory.items)) {
                console.error(`[BAKERY] Bakery ${bakeryId} has no inventory`);
                return;
            }

            const item = bakery.inventory.items.find(i => i.id === itemId);
            if (!item) {
                console.error(`[BAKERY] Item ${itemId} not found in bakery ${bakeryId}`);
                return;
            }

            // Don't start if already processing
            if (item.processingStartTick) {
                return;
            }

            // Clear any other processing fields (item may have been moved from elsewhere)
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
                    crateId: bakeryId,
                    inventory: bakery.inventory
                }
            });

            console.log(`[BAKERY] Started processing ${item.type} (${itemId}) at tick ${this.serverTick}`);

        } catch (error) {
            console.error(`[BAKERY] Error starting processing for item ${itemId}:`, error);
        }
    }

    /**
     * Complete processing operation - validate and transform item
     * Called by client via processing_complete message
     * @param {string} bakeryId - ID of the bakery
     * @param {string} itemId - ID of the item being processed
     * @param {string} chunkId - Chunk ID
     * @returns {object} Result { success, error, processedType }
     */
    async completeProcessing(bakeryId, itemId, chunkId) {
        try {
            // Load chunk data
            const chunkData = await this.chunkManager.loadChunk(chunkId);

            // Find bakery object
            const bakeryIndex = chunkData.objectChanges.findIndex(
                c => c.id === bakeryId && c.action === 'add'
            );

            if (bakeryIndex === -1) {
                console.error(`[BAKERY] Bakery ${bakeryId} not found in chunk ${chunkId}`);
                return { success: false, error: 'Bakery not found' };
            }

            const bakery = chunkData.objectChanges[bakeryIndex];

            if (!bakery.inventory || !Array.isArray(bakery.inventory.items)) {
                console.error(`[BAKERY] Bakery ${bakeryId} has no inventory`);
                return { success: false, error: 'No inventory' };
            }

            // Find the item being processed
            const itemIndex = bakery.inventory.items.findIndex(item => item.id === itemId);

            if (itemIndex === -1) {
                console.warn(`[BAKERY] Item ${itemId} no longer in bakery (may have been removed)`);
                return { success: false, error: 'Item not found' };
            }

            const rawItem = bakery.inventory.items[itemIndex];

            // Validate processing was in progress
            if (!rawItem.processingStartTick || !rawItem.processingDurationTicks) {
                console.warn(`[BAKERY] Item ${itemId} was not processing`);
                return { success: false, error: 'Item not processing' };
            }

            // Validate enough ticks have elapsed (allow some tolerance for network delay)
            const ticksElapsed = this.serverTick - rawItem.processingStartTick;
            const requiredTicks = rawItem.processingDurationTicks;
            const tolerance = 5; // Allow 5 tick tolerance

            if (ticksElapsed < requiredTicks - tolerance) {
                console.warn(`[BAKERY] Item ${itemId} processing not complete yet (${ticksElapsed}/${requiredTicks} ticks)`);
                return { success: false, error: 'Processing not complete' };
            }

            const processedType = this.PROCESSING_RECIPES[rawItem.type];

            if (!processedType) {
                console.error(`[BAKERY] No recipe found for ${rawItem.type}`);
                return { success: false, error: 'No recipe' };
            }

            // Calculate new quality: average of apple quality and bakery structure quality
            const appleQuality = rawItem.quality || 50;
            const bakeryQuality = bakery.quality || 50;
            const averagedQuality = Math.round((appleQuality + bakeryQuality) / 2);

            // Transform the item (average quality, clear processing fields)
            // Food items use durability based on quality (higher quality = more durability)
            const baseDurability = 30; // Base durability for appletart
            const qualityMultiplier = averagedQuality / 50; // 50 is baseline quality
            const finalDurability = Math.round(baseDurability * qualityMultiplier);

            const processedItem = {
                ...rawItem,
                type: processedType,
                quality: averagedQuality,
                durability: finalDurability,
                id: `${processedType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            };
            delete processedItem.processingStartTick;
            delete processedItem.processingDurationTicks;

            // Replace the raw item with processed item
            bakery.inventory.items[itemIndex] = processedItem;

            // Save chunk
            await this.chunkManager.saveChunk(chunkId);

            // Broadcast updated inventory to all clients
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'crate_inventory_updated',
                payload: {
                    crateId: bakeryId,
                    inventory: bakery.inventory
                }
            });

            console.log(`[BAKERY] Completed: ${rawItem.type} -> ${processedType} (quality: ${appleQuality} + ${bakeryQuality} / 2 = ${averagedQuality}, durability: ${finalDurability})`);

            return { success: true, processedType, processedItem };

        } catch (error) {
            console.error(`[BAKERY] Error completing processing for item ${itemId}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Cancel processing for an item (called when item is removed or firewood depletes)
     * @param {string} bakeryId - ID of the bakery
     * @param {string} itemId - ID of the item
     * @param {string} chunkId - Chunk ID (optional, for clearing timestamp)
     */
    async cancelProcessing(bakeryId, itemId, chunkId = null) {
        if (!chunkId) return;

        try {
            const chunkData = await this.chunkManager.loadChunk(chunkId);
            const bakeryIndex = chunkData.objectChanges.findIndex(
                c => c.id === bakeryId && c.action === 'add'
            );

            if (bakeryIndex !== -1) {
                const bakery = chunkData.objectChanges[bakeryIndex];
                if (bakery.inventory && Array.isArray(bakery.inventory.items)) {
                    const item = bakery.inventory.items.find(i => i.id === itemId);
                    if (item && item.processingStartTick) {
                        delete item.processingStartTick;
                        delete item.processingDurationTicks;
                        await this.chunkManager.saveChunk(chunkId);

                        // Broadcast updated inventory
                        this.messageRouter.broadcastTo3x3Grid(chunkId, {
                            type: 'crate_inventory_updated',
                            payload: {
                                crateId: bakeryId,
                                inventory: bakery.inventory
                            }
                        });

                        console.log(`[BAKERY] Cancelled processing for ${item.type}`);
                    }
                }
            }
        } catch (error) {
            console.error(`[BAKERY] Error cancelling processing:`, error);
        }
    }

    /**
     * Check and complete all finished processing items in a bakery
     * Called by NPC baker to trigger tart completion without player interaction
     * @param {string} bakeryId - ID of the bakery
     * @param {string} chunkId - Chunk ID
     * @returns {object} Result { success, completedCount, tartCount }
     */
    async checkAndCompleteProcessing(bakeryId, chunkId) {
        try {
            const chunkData = await this.chunkManager.loadChunk(chunkId);
            const bakeryIndex = chunkData.objectChanges.findIndex(
                c => c.id === bakeryId && c.action === 'add'
            );

            if (bakeryIndex === -1) {
                return { success: false, error: 'Bakery not found', completedCount: 0, tartCount: 0 };
            }

            const bakery = chunkData.objectChanges[bakeryIndex];
            if (!bakery.inventory || !Array.isArray(bakery.inventory.items)) {
                return { success: false, error: 'No inventory', completedCount: 0, tartCount: 0 };
            }

            let completedCount = 0;
            let needsSave = false;

            // Check each item for completed processing
            for (let i = 0; i < bakery.inventory.items.length; i++) {
                const item = bakery.inventory.items[i];

                // Skip if not processing
                if (!item.processingStartTick || !item.processingDurationTicks) continue;

                // Check if processing is complete
                const ticksElapsed = this.serverTick - item.processingStartTick;
                if (ticksElapsed >= item.processingDurationTicks) {
                    // Complete this item
                    const processedType = this.PROCESSING_RECIPES[item.type];
                    if (processedType) {
                        // Calculate quality
                        const appleQuality = item.quality || 50;
                        const bakeryQuality = bakery.quality || 50;
                        const averagedQuality = Math.round((appleQuality + bakeryQuality) / 2);

                        // Calculate durability
                        const baseDurability = 30;
                        const qualityMultiplier = averagedQuality / 50;
                        const finalDurability = Math.round(baseDurability * qualityMultiplier);

                        // Transform the item
                        bakery.inventory.items[i] = {
                            ...item,
                            type: processedType,
                            quality: averagedQuality,
                            durability: finalDurability,
                            id: `${processedType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
                        };
                        delete bakery.inventory.items[i].processingStartTick;
                        delete bakery.inventory.items[i].processingDurationTicks;

                        completedCount++;
                        needsSave = true;
                        console.log(`[BAKERY] NPC completed: ${item.type} -> ${processedType}`);
                    }
                }
            }

            if (needsSave) {
                await this.chunkManager.saveChunk(chunkId);

                // Broadcast updated inventory
                this.messageRouter.broadcastTo3x3Grid(chunkId, {
                    type: 'crate_inventory_updated',
                    payload: {
                        crateId: bakeryId,
                        inventory: bakery.inventory
                    }
                });
            }

            // Count tarts in inventory
            const tartCount = bakery.inventory.items.filter(
                item => item.type === 'appletart'
            ).length;

            return { success: true, completedCount, tartCount };

        } catch (error) {
            console.error(`[BAKERY] Error in checkAndCompleteProcessing:`, error);
            return { success: false, error: error.message, completedCount: 0, tartCount: 0 };
        }
    }

    /**
     * Cancel all processing operations for a specific bakery (called when firewood depletes)
     * @param {string} bakeryId - ID of the bakery
     * @param {string} chunkId - Chunk ID for clearing timestamps and broadcasting
     * @param {object} inventory - Current inventory object (to clear processing fields from items)
     * @returns {boolean} - True if any processing was cancelled
     */
    cancelAllProcessingForStructure(bakeryId, chunkId, inventory) {
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

module.exports = BakerySystem;

/**
 * BlacksmithSystem.js
 * Handles blacksmith mechanics - transforming ironingot to parts
 * Uses tick-based timing for client-side calculation
 *
 * Key differences from IronworksSystem:
 * - Recipe: ironingot -> parts (exclusive - cannot be done elsewhere)
 * - Inventory restriction: only accepts ironingot, parts, and firewood types
 * - Single centered smoke source (same as ironworks)
 */

const { CONFIG } = require('./ServerConfig.js');

class BlacksmithSystem {
    constructor(chunkManager, messageRouter, timeTrackerService) {
        this.chunkManager = chunkManager;
        this.messageRouter = messageRouter;
        this.timeTrackerService = timeTrackerService;

        // Server tick reference (set by server.js tick interval)
        this.serverTick = 0;

        // Processing duration in ticks (1 tick = 1 second)
        this.PROCESSING_DURATION_TICKS = 60; // 1 minute for ironingot in blacksmith

        // Processing recipes: raw item -> processed item
        // IMPORTANT: Ironingot -> parts can ONLY be processed here
        this.PROCESSING_RECIPES = {
            'ironingot': 'parts'
        };

        // Allowed items in blacksmith inventory
        // Only ironingot, parts, and firewood types are allowed
        this.ALLOWED_ITEMS = [
            'ironingot',
            'parts',
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
     * Check if an item type is allowed in blacksmith inventory
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
     * Called when saving blacksmith inventory for server-side security
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
     * Check blacksmith inventory for items that can be processed
     * Called when blacksmith inventory is saved
     * @param {string} blacksmithId - ID of the blacksmith
     * @param {string} chunkId - Chunk ID where blacksmith is located
     * @param {object} inventory - Blacksmith inventory { items: [...] }
     */
    checkForProcessableItems(blacksmithId, chunkId, inventory) {
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
                    this.startProcessing(blacksmithId, item.id, index, chunkId);
                }
            }
        });
    }

    /**
     * Start processing an item - stamps tick-based timing on item
     * @param {string} blacksmithId - ID of the blacksmith
     * @param {string} itemId - ID of the item being processed
     * @param {number} itemIndex - Index of item in inventory array
     * @param {string} chunkId - Chunk ID where blacksmith is located
     */
    async startProcessing(blacksmithId, itemId, itemIndex, chunkId) {
        try {
            const chunkData = await this.chunkManager.loadChunk(chunkId);
            const blacksmithIndex = chunkData.objectChanges.findIndex(
                c => c.id === blacksmithId && c.action === 'add'
            );

            if (blacksmithIndex === -1) {
                console.error(`[BLACKSMITH] Blacksmith ${blacksmithId} not found in chunk ${chunkId}`);
                return;
            }

            const blacksmith = chunkData.objectChanges[blacksmithIndex];
            if (!blacksmith.inventory || !Array.isArray(blacksmith.inventory.items)) {
                console.error(`[BLACKSMITH] Blacksmith ${blacksmithId} has no inventory`);
                return;
            }

            const item = blacksmith.inventory.items.find(i => i.id === itemId);
            if (!item) {
                console.error(`[BLACKSMITH] Item ${itemId} not found in blacksmith ${blacksmithId}`);
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
                    crateId: blacksmithId,
                    inventory: blacksmith.inventory
                }
            });

            console.log(`[BLACKSMITH] Started processing ${item.type} (${itemId}) at tick ${this.serverTick}`);

        } catch (error) {
            console.error(`[BLACKSMITH] Error starting processing for item ${itemId}:`, error);
        }
    }

    /**
     * Complete processing operation - validate and transform item
     * Called by client via processing_complete message
     * @param {string} blacksmithId - ID of the blacksmith
     * @param {string} itemId - ID of the item being processed
     * @param {string} chunkId - Chunk ID
     * @returns {object} Result { success, error, processedType }
     */
    async completeProcessing(blacksmithId, itemId, chunkId) {
        try {
            // Load chunk data
            const chunkData = await this.chunkManager.loadChunk(chunkId);

            // Find blacksmith object
            const blacksmithIndex = chunkData.objectChanges.findIndex(
                c => c.id === blacksmithId && c.action === 'add'
            );

            if (blacksmithIndex === -1) {
                console.error(`[BLACKSMITH] Blacksmith ${blacksmithId} not found in chunk ${chunkId}`);
                return { success: false, error: 'Blacksmith not found' };
            }

            const blacksmith = chunkData.objectChanges[blacksmithIndex];

            if (!blacksmith.inventory || !Array.isArray(blacksmith.inventory.items)) {
                console.error(`[BLACKSMITH] Blacksmith ${blacksmithId} has no inventory`);
                return { success: false, error: 'No inventory' };
            }

            // Find the item being processed
            const itemIndex = blacksmith.inventory.items.findIndex(item => item.id === itemId);

            if (itemIndex === -1) {
                console.warn(`[BLACKSMITH] Item ${itemId} no longer in blacksmith (may have been removed)`);
                return { success: false, error: 'Item not found' };
            }

            const rawItem = blacksmith.inventory.items[itemIndex];

            // Validate processing was in progress
            if (!rawItem.processingStartTick || !rawItem.processingDurationTicks) {
                console.warn(`[BLACKSMITH] Item ${itemId} was not processing`);
                return { success: false, error: 'Item not processing' };
            }

            // Validate enough ticks have elapsed (allow some tolerance for network delay)
            const ticksElapsed = this.serverTick - rawItem.processingStartTick;
            const requiredTicks = rawItem.processingDurationTicks;
            const tolerance = 5; // Allow 5 tick tolerance

            if (ticksElapsed < requiredTicks - tolerance) {
                console.warn(`[BLACKSMITH] Item ${itemId} processing not complete yet (${ticksElapsed}/${requiredTicks} ticks)`);
                return { success: false, error: 'Processing not complete' };
            }

            const processedType = this.PROCESSING_RECIPES[rawItem.type];

            if (!processedType) {
                console.error(`[BLACKSMITH] No recipe found for ${rawItem.type}`);
                return { success: false, error: 'No recipe' };
            }

            // Calculate new quality: average of ironingot quality and blacksmith structure quality
            const ingotQuality = rawItem.quality || 50;
            const blacksmithQuality = blacksmith.quality || 50;
            const averagedQuality = Math.round((ingotQuality + blacksmithQuality) / 2);

            // Transform the item (average quality, clear processing fields)
            const processedItem = {
                ...rawItem,
                type: processedType,
                quality: averagedQuality,
                durability: 100, // Parts start at full durability
                id: `${processedType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            };
            delete processedItem.processingStartTick;
            delete processedItem.processingDurationTicks;

            // Replace the raw item with processed item
            blacksmith.inventory.items[itemIndex] = processedItem;

            // Save chunk
            await this.chunkManager.saveChunk(chunkId);

            // Broadcast updated inventory to all clients
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'crate_inventory_updated',
                payload: {
                    crateId: blacksmithId,
                    inventory: blacksmith.inventory
                }
            });

            console.log(`[BLACKSMITH] Completed: ${rawItem.type} -> ${processedType} (quality: ${ingotQuality} + ${blacksmithQuality} / 2 = ${averagedQuality})`);

            return { success: true, processedType, processedItem };

        } catch (error) {
            console.error(`[BLACKSMITH] Error completing processing for item ${itemId}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Cancel processing for an item (called when item is removed or firewood depletes)
     * @param {string} blacksmithId - ID of the blacksmith
     * @param {string} itemId - ID of the item
     * @param {string} chunkId - Chunk ID (optional, for clearing timestamp)
     */
    async cancelProcessing(blacksmithId, itemId, chunkId = null) {
        if (!chunkId) return;

        try {
            const chunkData = await this.chunkManager.loadChunk(chunkId);
            const blacksmithIndex = chunkData.objectChanges.findIndex(
                c => c.id === blacksmithId && c.action === 'add'
            );

            if (blacksmithIndex !== -1) {
                const blacksmith = chunkData.objectChanges[blacksmithIndex];
                if (blacksmith.inventory && Array.isArray(blacksmith.inventory.items)) {
                    const item = blacksmith.inventory.items.find(i => i.id === itemId);
                    if (item && item.processingStartTick) {
                        delete item.processingStartTick;
                        delete item.processingDurationTicks;
                        await this.chunkManager.saveChunk(chunkId);

                        // Broadcast updated inventory
                        this.messageRouter.broadcastTo3x3Grid(chunkId, {
                            type: 'crate_inventory_updated',
                            payload: {
                                crateId: blacksmithId,
                                inventory: blacksmith.inventory
                            }
                        });

                        console.log(`[BLACKSMITH] Cancelled processing for ${item.type}`);
                    }
                }
            }
        } catch (error) {
            console.error(`[BLACKSMITH] Error cancelling processing:`, error);
        }
    }

    /**
     * Cancel all processing operations for a specific blacksmith (called when firewood depletes)
     * @param {string} blacksmithId - ID of the blacksmith
     * @param {string} chunkId - Chunk ID for clearing timestamps and broadcasting
     * @param {object} inventory - Current inventory object (to clear processing fields from items)
     * @returns {boolean} - True if any processing was cancelled
     */
    cancelAllProcessingForStructure(blacksmithId, chunkId, inventory) {
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

module.exports = BlacksmithSystem;

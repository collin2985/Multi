/**
 * CookingSystem.js
 * Handles campfire cooking mechanics - transforming raw food items to cooked versions
 */

class CookingSystem {
    constructor(chunkManager, messageRouter) {
        this.chunkManager = chunkManager;
        this.messageRouter = messageRouter;

        // Map of active cooking operations: campfireId -> { itemId, itemIndex, startTime, chunkId }
        this.activeCooking = new Map();

        // Cooking duration in milliseconds
        this.COOKING_DURATION = 10000; // 10 seconds

        // Cooking recipes: raw item -> cooked item
        this.COOKING_RECIPES = {
            'fish': 'cookedfish',
            'vegetables': 'roastedvegetables'
            // Add more recipes here (e.g., 'rawmeat': 'cookedmeat')
        };
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
     * Check campfire inventory for items that can be cooked
     * Called when campfire inventory is saved
     * @param {string} campfireId - ID of the campfire
     * @param {string} chunkId - Chunk ID where campfire is located
     * @param {object} inventory - Campfire inventory { items: [...] }
     */
    checkForCookableItems(campfireId, chunkId, inventory) {
        if (!inventory || !Array.isArray(inventory.items)) {
            return;
        }

        // Check if firewood is present (any type: oak, pine, fir, cypress)
        const hasFirewood = inventory.items.some(item =>
            item.type === 'oakfirewood' ||
            item.type === 'pinefirewood' ||
            item.type === 'firfirewood' ||
            item.type === 'cypressfirewood'
        );

        if (!hasFirewood) {
            console.log(`[COOKING] Campfire ${campfireId} has no firewood - cannot cook`);
            return;
        }

        // Find all cookable items that aren't already cooking
        inventory.items.forEach((item, index) => {
            if (this.canBeCookedItem(item.type)) {
                const cookingKey = `${campfireId}_${item.id}`;

                // Only start cooking if not already cooking
                if (!this.activeCooking.has(cookingKey)) {
                    this.startCooking(campfireId, item.id, index, chunkId);
                }
            }
        });
    }

    /**
     * Start cooking an item
     * @param {string} campfireId - ID of the campfire
     * @param {string} itemId - ID of the item being cooked
     * @param {number} itemIndex - Index of item in inventory array
     * @param {string} chunkId - Chunk ID where campfire is located
     */
    startCooking(campfireId, itemId, itemIndex, chunkId) {
        const cookingKey = `${campfireId}_${itemId}`;

        const cookingData = {
            campfireId,
            itemId,
            itemIndex,
            chunkId,
            startTime: Date.now()
        };

        this.activeCooking.set(cookingKey, cookingData);

        console.log(`[COOKING] Started cooking ${itemId} in campfire ${campfireId} (will complete in ${this.COOKING_DURATION}ms)`);

        // Schedule cooking completion
        setTimeout(() => {
            this.completeCooking(cookingKey);
        }, this.COOKING_DURATION);
    }

    /**
     * Complete cooking operation - transform item and consume firewood
     * @param {string} cookingKey - Unique key for this cooking operation
     */
    completeCooking(cookingKey) {
        const cookingData = this.activeCooking.get(cookingKey);

        if (!cookingData) {
            console.warn(`[COOKING] Cooking data not found for ${cookingKey}`);
            return;
        }

        const { campfireId, itemId, chunkId } = cookingData;

        try {
            // Load chunk data
            const chunkData = this.chunkManager.loadChunk(chunkId);

            // Find campfire object
            const campfireIndex = chunkData.objectChanges.findIndex(
                c => c.id === campfireId && c.action === 'add'
            );

            if (campfireIndex === -1) {
                console.error(`[COOKING] Campfire ${campfireId} not found in chunk ${chunkId}`);
                this.activeCooking.delete(cookingKey);
                return;
            }

            const campfire = chunkData.objectChanges[campfireIndex];

            if (!campfire.inventory || !Array.isArray(campfire.inventory.items)) {
                console.error(`[COOKING] Campfire ${campfireId} has no inventory`);
                this.activeCooking.delete(cookingKey);
                return;
            }

            // Find the item being cooked
            const itemIndex = campfire.inventory.items.findIndex(item => item.id === itemId);

            if (itemIndex === -1) {
                console.warn(`[COOKING] Item ${itemId} no longer in campfire (may have been removed)`);
                this.activeCooking.delete(cookingKey);
                return;
            }

            const rawItem = campfire.inventory.items[itemIndex];
            const cookedType = this.COOKING_RECIPES[rawItem.type];

            if (!cookedType) {
                console.error(`[COOKING] No recipe found for ${rawItem.type}`);
                this.activeCooking.delete(cookingKey);
                return;
            }

            // Check if firewood is still present (any type)
            const firewoodIndex = campfire.inventory.items.findIndex(item =>
                item.type === 'oakfirewood' ||
                item.type === 'pinefirewood' ||
                item.type === 'firfirewood' ||
                item.type === 'cypressfirewood'
            );

            if (firewoodIndex === -1) {
                console.warn(`[COOKING] No firewood in campfire ${campfireId} - cooking failed`);
                this.activeCooking.delete(cookingKey);
                return;
            }

            // Transform the item (preserve quality and durability)
            const cookedItem = {
                ...rawItem,
                type: cookedType,
                id: `${cookedType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            };

            // Replace the raw item with cooked item
            campfire.inventory.items[itemIndex] = cookedItem;

            // Note: Firewood is consumed automatically through its durability system
            // No need to manually delete it here

            // Save chunk
            this.chunkManager.saveChunk(chunkId);

            console.log(`[COOKING] ✅ Cooked ${rawItem.type} -> ${cookedType} in campfire ${campfireId} (Q:${cookedItem.quality}, D:${cookedItem.durability})`);

            // Broadcast updated inventory to all clients
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'crate_inventory_updated',
                payload: {
                    crateId: campfireId,
                    inventory: campfire.inventory
                }
            });

            // Remove from active cooking
            this.activeCooking.delete(cookingKey);

        } catch (error) {
            console.error(`[COOKING] Error completing cooking for ${cookingKey}:`, error);
            this.activeCooking.delete(cookingKey);
        }
    }

    /**
     * Cancel cooking for an item (called when item is removed from campfire)
     * @param {string} campfireId - ID of the campfire
     * @param {string} itemId - ID of the item
     */
    cancelCooking(campfireId, itemId) {
        const cookingKey = `${campfireId}_${itemId}`;

        if (this.activeCooking.has(cookingKey)) {
            this.activeCooking.delete(cookingKey);
            console.log(`[COOKING] Cancelled cooking for ${itemId} in campfire ${campfireId}`);
        }
    }
}

module.exports = CookingSystem;

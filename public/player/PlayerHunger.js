// File: public/player/PlayerHunger.js
// Location: C:\Users\colli\Desktop\test horses\horses\public\player\PlayerHunger.js

/**
 * PlayerHunger System
 * Manages player hunger by consuming ALL food items simultaneously from inventory.
 *
 * Features:
 * - Consumes all food items at the same time (split consumption rate)
 * - Food variety bonus (10% discount per unique food type, max 40%)
 * - Quality affects initial durability (not consumption rate)
 * - Base consumption: 1 durability/minute total, split evenly among all items
 * - Hunger/Starvation warnings when out of food
 */

export class PlayerHunger {
    constructor(inventorySystem, ui, inventoryUI = null, game = null) {
        this.inventorySystem = inventorySystem;
        this.ui = ui;
        this.inventoryUI = inventoryUI;
        this.game = game;

        // Food type definitions with base durability values
        this.foodTypes = {
            'apple': { baseDurability: 10 },
            'vegetables': { baseDurability: 20 },
            'cookedfish': { baseDurability: 30 },
            'cookedmeat': { baseDurability: 40 }
        };

        // Starvation tracking
        this.starvationStartTime = null;
        this.hungerState = 'fed'; // 'fed', 'hungry', 'starving', 'dead'

        // Update interval
        this.updateInterval = 1000; // Check every second
        this.lastUpdateTime = Date.now();

        // Start the system
        this.start();
    }

    start() {
        console.log('[PlayerHunger] Starting hunger system');
        this.lastUpdateTime = Date.now();
        this.update();
    }

    update() {
        const now = Date.now();
        const deltaTime = now - this.lastUpdateTime;
        this.lastUpdateTime = now;

        // Don't process hunger if player is dead
        if (this.hungerState === 'dead') return;

        // Get all food items
        const foodItems = this.getFoodItemsFromInventory();

        // If player has food, consume it
        if (foodItems.length > 0) {
            this.consumeAllFood(foodItems, deltaTime / 1000); // Convert to seconds

            // Player has food, reset starvation
            this.starvationStartTime = null;
            this.hungerState = 'fed';
            this.ui.updateStatusLine3(null); // Clear hunger message
        } else {
            // No food available, handle starvation
            this.handleStarvation(now);
        }

        // Schedule next update
        setTimeout(() => this.update(), this.updateInterval);
    }

    /**
     * Consumes all food items simultaneously with variety bonus
     */
    consumeAllFood(foodItems, deltaSeconds) {
        if (foodItems.length === 0) return;

        // Count unique food types
        const uniqueTypes = new Set(foodItems.map(f => f.type));
        const uniqueCount = uniqueTypes.size;

        // Calculate variety bonus (10% discount per additional type, capped at 40%)
        // Formula: Math.max(0.6, 1.0 - (uniqueTypes - 1) * 0.1)
        const varietyBonus = Math.max(0.6, 1.0 - (uniqueCount - 1) * 0.1);

        // Base consumption rate: 1 durability/minute total
        const baseConsumptionPerMinute = 1.0;

        // Apply variety bonus
        const totalConsumptionPerMinute = baseConsumptionPerMinute * varietyBonus;

        // Split evenly among all food items
        const perItemConsumptionPerMinute = totalConsumptionPerMinute / foodItems.length;

        // Convert to per-second rate
        const perItemConsumptionPerSecond = perItemConsumptionPerMinute / 60;

        // Amount to consume this frame
        const consumptionThisFrame = perItemConsumptionPerSecond * deltaSeconds;

        // Track if any items were removed for UI refresh
        let itemsRemoved = false;

        // Consume from each food item
        for (const food of foodItems) {
            // Decrease durability
            food.item.durability -= consumptionThisFrame;

            // Clamp to prevent negatives
            food.item.durability = Math.max(0, food.item.durability);

            // Remove item if depleted
            if (food.item.durability <= 0) {
                this.removeFoodItem(food.item);
                itemsRemoved = true;
                console.log(`[PlayerHunger] Depleted food item: ${food.type}`);
            }
        }

        // Refresh UI if any items were removed
        if (itemsRemoved && this.inventoryUI && this.inventoryUI.renderInventory) {
            this.inventoryUI.renderInventory();
        }
    }

    /**
     * Gets all food items from player's inventory
     */
    getFoodItemsFromInventory() {
        if (!this.inventorySystem) {
            return [];
        }

        // Access items from PlayerInventory (which references gameState.inventory.items)
        const items = this.inventorySystem.itemsRef || this.inventorySystem.items || [];
        const foodItems = [];

        for (const item of items) {
            const foodType = this.foodTypes[item.type];
            if (foodType) {
                // Initialize durability if not set
                if (item.durability === undefined) {
                    const quality = item.quality || 50;
                    item.durability = foodType.baseDurability * (quality / 100);
                }

                foodItems.push({
                    item: item,
                    type: item.type,
                    quality: item.quality || 100,
                    durability: item.durability
                });
            }
        }

        return foodItems;
    }

    /**
     * Removes a food item from inventory
     */
    removeFoodItem(item) {
        if (!this.inventorySystem) {
            return;
        }

        // Access items from PlayerInventory (which references gameState.inventory.items)
        const items = this.inventorySystem.itemsRef || this.inventorySystem.items || [];

        // Find and remove the item from inventory
        const index = items.indexOf(item);
        if (index !== -1) {
            items.splice(index, 1);
        }
    }

    /**
     * Handles hunger/starvation states when no food is available
     */
    handleStarvation(now) {
        // Start starvation timer if not already started
        if (!this.starvationStartTime) {
            this.starvationStartTime = now;
            console.log('[PlayerHunger] Player has no food - starvation timer started');
        }

        const starvationElapsed = now - this.starvationStartTime;
        const hungryDuration = 5 * 60 * 1000; // 5 minutes
        const starvingDuration = 1 * 60 * 1000; // 1 minute

        if (starvationElapsed < hungryDuration) {
            // Hungry state (0-5 minutes)
            if (this.hungerState !== 'hungry') {
                this.hungerState = 'hungry';
                this.ui.updateStatusLine3('Hungry', 0); // Persistent message
                console.log('[PlayerHunger] Player is now HUNGRY');
            }
        } else if (starvationElapsed < hungryDuration + starvingDuration) {
            // Starving state (5-6 minutes)
            if (this.hungerState !== 'starving') {
                this.hungerState = 'starving';
                this.ui.updateStatusLine3('Starving!', 0); // Persistent message
                console.log('[PlayerHunger] Player is now STARVING');
            }
        } else {
            // After 6 minutes of starvation - DEATH
            if (this.hungerState !== 'dead' && this.game) {
                this.hungerState = 'dead';
                console.log('[PlayerHunger] Player died from starvation');
                this.game.killEntity(this.game.playerObject, false, false);
            }
        }
    }

    /**
     * Gets current hunger state for external systems
     */
    getHungerState() {
        const foodItems = this.getFoodItemsFromInventory();
        const totalDurability = foodItems.reduce((sum, f) => sum + f.durability, 0);

        return {
            state: this.hungerState,
            foodCount: foodItems.length,
            totalDurability: totalDurability
        };
    }

    /**
     * Force consume all food (for testing)
     */
    forceConsume() {
        const foodItems = this.getFoodItemsFromInventory();
        for (const food of foodItems) {
            this.removeFoodItem(food.item);
        }

        if (this.inventoryUI && this.inventoryUI.renderInventory) {
            this.inventoryUI.renderInventory();
        }

        console.log('[PlayerHunger] Forced consumption of all food');
    }
}

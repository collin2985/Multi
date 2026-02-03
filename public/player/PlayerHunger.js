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
            'mushroom': { baseDurability: 10 },
            'vegetables': { baseDurability: 20 },
            'roastedvegetables': { baseDurability: 40 },
            'appletart': { baseDurability: 30 },
            'cookedfish': { baseDurability: 60 },
            'cookedmeat': { baseDurability: 80 }
        };

        // Starvation tracking
        this.starvationStartTime = null;
        this.hungerState = 'fed'; // 'fed', 'hungry', 'starving', 'dead'

        // Hunger debt - durability owed from time spent without food
        // Prevents exploit of hiding food and grabbing it briefly to reset timer
        this.hungerDebt = 0;

        // Track if 2-minute warning has been shown (to prevent repeated triggers)
        this.twoMinuteWarningShown = false;

        // Update interval
        this.updateInterval = 1000; // Check every second
        this.lastUpdateTime = Date.now();

        // Start the system
        this.start();
    }

    start() {
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
            // Pay off hunger debt first (prevents exploit of hiding food)
            if (this.hungerDebt > 0) {
                this.payHungerDebt(foodItems);
            }

            // Normal consumption (only if food remains after paying debt)
            const remainingFood = this.getFoodItemsFromInventory();
            if (remainingFood.length > 0) {
                this.consumeAllFood(remainingFood, deltaTime / 1000); // Convert to seconds

                // Player has food and debt is paid, reset starvation
                this.starvationStartTime = null;
                this.hungerState = 'fed';
                this.twoMinuteWarningShown = false;

                // Update food status UI
                this.updateFoodStatusUI(remainingFood);
            } else {
                // Food was depleted paying debt, handle starvation
                this.handleStarvation(now);
                const timeUntilDeath = this.getTimeUntilDeath();
                this.ui.updateFoodStatus(null, 0, 0, this.hungerState, timeUntilDeath);
            }
        } else {
            // No food available - accrue hunger debt and handle starvation
            const debtPerSecond = 1.0 / 60; // 1 durability per minute
            this.hungerDebt += debtPerSecond * (deltaTime / 1000);

            this.handleStarvation(now);

            // Calculate time until death for UI
            const timeUntilDeath = this.getTimeUntilDeath();

            // Update food status UI to show hunger state
            this.ui.updateFoodStatus(null, 0, 0, this.hungerState, timeUntilDeath);
        }

        // Schedule next update
        setTimeout(() => this.update(), this.updateInterval);
    }

    /**
     * Pay off hunger debt by consuming food immediately
     * This prevents the exploit of hiding food and grabbing it briefly
     */
    payHungerDebt(foodItems) {
        if (this.hungerDebt <= 0 || foodItems.length === 0) return;

        let remainingDebt = this.hungerDebt;
        let itemsRemoved = false;

        // Consume debt from food items (spread evenly like normal consumption)
        const debtPerItem = remainingDebt / foodItems.length;

        for (const food of foodItems) {
            const consumption = Math.min(debtPerItem, food.item.durability);
            food.item.durability -= consumption;
            remainingDebt -= consumption;

            if (food.item.durability <= 0) {
                this.removeFoodItem(food.item);
                itemsRemoved = true;
            }
        }

        // Clear the debt (any remaining means food ran out)
        this.hungerDebt = 0;

        // Refresh UI if items were removed
        if (itemsRemoved && this.inventoryUI && this.inventoryUI.renderInventory) {
            this.inventoryUI.renderInventory();
        }
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
        // Access items directly from gameState to avoid stale reference issues
        // (gameState.inventory.items can be reassigned on respawn/death)
        const items = this.game?.gameState?.inventory?.items || [];
        const foodItems = [];

        for (const item of items) {
            const foodType = this.foodTypes[item.type];
            if (foodType) {
                // Initialize durability if not set
                if (item.durability === undefined) {
                    const quality = item.quality || 50;
                    item.durability = Math.round(foodType.baseDurability * (quality / 100));
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
        // Access items directly from gameState to avoid stale reference issues
        const items = this.game?.gameState?.inventory?.items;
        if (!items) return;

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
        }

        const starvationElapsed = now - this.starvationStartTime;
        const hungryDuration = 5 * 60 * 1000; // 5 minutes
        const starvingDuration = 1 * 60 * 1000; // 1 minute

        if (starvationElapsed < hungryDuration) {
            // Hungry state (0-5 minutes)
            if (this.hungerState !== 'hungry') {
                this.hungerState = 'hungry';
                this.ui.showToast('You are getting hungry!', 'warning', 5000);
            }
        } else if (starvationElapsed < hungryDuration + starvingDuration) {
            // Starving state (5-6 minutes)
            if (this.hungerState !== 'starving') {
                this.hungerState = 'starving';
                this.ui.showToast('You are starving! Find food quickly!', 'error', 5000);
            }
        } else {
            // After 6 minutes of starvation - DEATH
            if (this.hungerState !== 'dead' && this.game) {
                this.hungerState = 'dead';
                this.game.killEntity(this.game.playerObject, false, false, 'You starved to death');
            }
        }

        // Check for 2-minute warning (120 seconds remaining)
        const timeUntilDeath = this.getTimeUntilDeath();
        if (timeUntilDeath !== null && timeUntilDeath <= 120 && !this.twoMinuteWarningShown) {
            this.twoMinuteWarningShown = true;
            this.ui.showStarvationWarning();
        }
    }

    /**
     * Calculate seconds until death from starvation
     * @returns {number|null} Seconds until death, or null if not starving
     */
    getTimeUntilDeath() {
        if (!this.starvationStartTime) return null;

        const now = Date.now();
        const starvationElapsed = now - this.starvationStartTime;
        const deathTime = 6 * 60 * 1000; // 6 minutes total
        const timeRemaining = deathTime - starvationElapsed;

        return Math.max(0, Math.floor(timeRemaining / 1000));
    }

    /**
     * Updates the food status UI with time remaining and variety bonus
     */
    updateFoodStatusUI(foodItems) {
        if (foodItems.length === 0) {
            this.ui.updateFoodStatus(null, 0, 0);
            return;
        }

        // Calculate total durability
        const totalDurability = foodItems.reduce((sum, f) => sum + f.durability, 0);

        // Count unique food types for variety bonus
        const uniqueTypes = new Set(foodItems.map(f => f.type));
        const uniqueCount = uniqueTypes.size;

        // Calculate variety bonus percentage (10% per additional type, max 40%)
        const varietyBonusPercent = Math.min(40, (uniqueCount - 1) * 10);

        // Calculate effective consumption rate
        const varietyMultiplier = Math.max(0.6, 1.0 - (uniqueCount - 1) * 0.1);
        const effectiveConsumptionPerMinute = 1.0 * varietyMultiplier;

        // Calculate time remaining in minutes
        const timeRemainingMinutes = totalDurability / effectiveConsumptionPerMinute;

        // Update UI
        this.ui.updateFoodStatus(timeRemainingMinutes, varietyBonusPercent, foodItems.length);
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
    }
}

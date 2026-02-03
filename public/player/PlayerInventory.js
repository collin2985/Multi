/**
 * PlayerInventory.js
 * Manages player inventory data and item placement logic
 */

import { CONFIG } from '../config.js';

export class PlayerInventory {
    constructor(rows = 10, cols = 5) {
        this.rows = rows;
        this.cols = cols;
        this.items = [];
        this.slotSize = 50;
        this.gap = 2;
    }

    /**
     * Try to add an item to inventory
     * @param {object} item - Item to add (must have width, height properties)
     * @returns {boolean} - True if item was added, false if no space
     */
    addItem(item) {
        // Special handling for coins - merge with existing coin item
        if (item.type === 'coin') {
            const existingCoin = this.items.find(i => i.type === 'coin');
            if (existingCoin) {
                // Merge quantities
                existingCoin.quantity = (existingCoin.quantity || 0) + (item.quantity || 1);
                window.game?.gameState?.markInventoryDirty();
                return true;
            }
        }

        // Special handling for ammo - stack up to MAX_STACK (20)
        if (item.type === 'ammo') {
            const maxStack = CONFIG.AMMO.MAX_STACK;
            const existingAmmo = this.items.find(i => i.type === 'ammo' && (i.quantity || 1) < maxStack);
            if (existingAmmo) {
                const currentQty = existingAmmo.quantity || 1;
                const addQty = item.quantity || 1;

                if (currentQty + addQty <= maxStack) {
                    // Fits entirely in existing stack
                    existingAmmo.quantity = currentQty + addQty;
                    window.game?.gameState?.markInventoryDirty();
                    return true;
                } else {
                    // Partially fill existing stack, continue to place remainder
                    existingAmmo.quantity = maxStack;
                    item.quantity = addQty - (maxStack - currentQty);
                    // Fall through to normal placement for remainder
                }
            }
        }

        // Try each position in the grid
        for (let y = 0; y <= this.rows - item.height; y++) {
            for (let x = 0; x <= this.cols - item.width; x++) {
                // Check if this position is free
                if (this.isPositionFree(x, y, item.width, item.height)) {
                    // Found a free position!
                    item.x = x;
                    item.y = y;
                    this.items.push(item);
                    // Notify tasks panel of new item
                    window.tasksPanel?.onItemAdded(item.type, this.items.filter(i => i.type === item.type).length);
                    // Mark inventory dirty for sync system
                    window.game?.gameState?.markInventoryDirty();
                    return true;
                }
            }
        }

        // No space found
        return false;
    }

    /**
     * Check if a position is free for an item
     * @param {number} x - Grid x position
     * @param {number} y - Grid y position
     * @param {number} width - Item width
     * @param {number} height - Item height
     * @returns {boolean}
     */
    isPositionFree(x, y, width, height) {
        for (const item of this.items) {
            // Get item dimensions (account for rotation)
            const itemWidth = item.rotation === 90 ? item.height : item.width;
            const itemHeight = item.rotation === 90 ? item.width : item.height;

            // Check if rectangles overlap
            const xOverlap = x < item.x + itemWidth && x + width > item.x;
            const yOverlap = y < item.y + itemHeight && y + height > item.y;

            if (xOverlap && yOverlap) {
                return false;
            }
        }
        return true;
    }

    /**
     * Check if inventory is completely full (no space for even a 1x1 item)
     * @returns {boolean}
     */
    isFull() {
        // Check if there's any free 1x1 slot
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                if (this.isPositionFree(x, y, 1, 1)) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * Remove an item by ID
     * @param {string} itemId
     * @returns {object|null} - Removed item or null
     */
    removeItem(itemId) {
        const itemIndex = this.items.findIndex(item => item.id === itemId);
        if (itemIndex !== -1) {
            const removed = this.items.splice(itemIndex, 1)[0];
            window.game?.gameState?.markInventoryDirty();
            return removed;
        }
        return null;
    }

    /**
     * Find item at grid position
     * @param {number} x - Grid x position
     * @param {number} y - Grid y position
     * @returns {object|null}
     */
    getItemAt(x, y) {
        for (const item of this.items) {
            const itemWidth = item.rotation === 90 ? item.height : item.width;
            const itemHeight = item.rotation === 90 ? item.width : item.height;

            if (x >= item.x && x < item.x + itemWidth &&
                y >= item.y && y < item.y + itemHeight) {
                return item;
            }
        }
        return null;
    }

    /**
     * Get all items
     * @returns {Array}
     */
    getItems() {
        return this.items;
    }

    /**
     * Check if inventory has specific item type with durability
     * @param {string} itemType - Type to check for
     * @returns {boolean}
     */
    hasItemWithDurability(itemType) {
        return this.items.some(item =>
            item.type === itemType && item.durability > 0
        );
    }

    /**
     * Find item by type
     * @param {string} itemType
     * @returns {object|null}
     */
    findItemByType(itemType) {
        return this.items.find(item => item.type === itemType) || null;
    }

    /**
     * Update item durability
     * @param {string} itemId
     * @param {number} amount - Amount to decrease
     * @returns {boolean} - True if item still has durability, false if depleted
     */
    decreaseDurability(itemId, amount = 1) {
        const item = this.items.find(i => i.id === itemId);
        if (!item) return false;

        item.durability = Math.max(0, item.durability - amount);
        window.game?.gameState?.markInventoryDirty();

        // Remove item if durability depleted
        if (item.durability === 0) {
            this.removeItem(itemId);  // This also marks dirty
            return false;
        }
        return true;
    }

    /**
     * Get total coins in inventory
     * @returns {number} - Total coin quantity
     */
    getTotalCoins() {
        // Access items from gameState if available, otherwise use local items
        const items = this.itemsRef || this.items;
        const coinItem = items.find(item => item.type === 'coin');
        return coinItem ? (coinItem.quantity || 0) : 0;
    }

    /**
     * Check if player has enough coins
     * @param {number} amount - Amount to check
     * @returns {boolean}
     */
    hasEnoughCoins(amount) {
        return this.getTotalCoins() >= amount;
    }

    /**
     * Add coins to inventory
     * @param {number} amount - Amount to add
     * @returns {boolean} - True if coins added successfully
     */
    addCoins(amount) {
        if (amount <= 0) return false;

        // Access items from gameState if available, otherwise use local items
        const items = this.itemsRef || this.items;

        // Find existing coin item
        const coinItem = items.find(item => item.type === 'coin');

        if (coinItem) {
            // Add to existing coin item
            coinItem.quantity = (coinItem.quantity || 0) + amount;
            window.game?.gameState?.markInventoryDirty();
            return true;
        } else {
            // Create new coin item - find a free position first
            const rows = this.rows || 10;
            const cols = this.cols || 5;

            // Find first free 1x1 slot
            let freeX = -1, freeY = -1;
            for (let y = 0; y < rows && freeX === -1; y++) {
                for (let x = 0; x < cols && freeX === -1; x++) {
                    if (PlayerInventory.isPositionFree(x, y, 1, 1, items)) {
                        freeX = x;
                        freeY = y;
                    }
                }
            }

            if (freeX === -1) {
                // No free slot
                return false;
            }

            const newCoin = {
                id: 'coin_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                type: 'coin',
                x: freeX,
                y: freeY,
                width: 1,
                height: 1,
                rotation: 0,
                quality: 100,
                durability: 100,
                quantity: amount
            };
            items.push(newCoin);
            window.game?.gameState?.markInventoryDirty();
            return true;
        }
    }

    /**
     * Remove coins from inventory
     * @param {number} amount - Amount to remove
     * @returns {boolean} - True if coins removed successfully, false if insufficient
     */
    removeCoins(amount) {
        if (amount <= 0) return false;
        if (!this.hasEnoughCoins(amount)) return false;

        // Access items from gameState if available, otherwise use local items
        const items = this.itemsRef || this.items;

        const coinItem = items.find(item => item.type === 'coin');
        if (!coinItem) return false;

        coinItem.quantity -= amount;
        window.game?.gameState?.markInventoryDirty();

        // Remove coin item if quantity reaches 0
        if (coinItem.quantity <= 0) {
            const itemIndex = items.indexOf(coinItem);
            if (itemIndex > -1) {
                items.splice(itemIndex, 1);
            }
        }

        return true;
    }

    /**
     * Clear all items
     */
    clear() {
        this.items = [];
        window.game?.gameState?.markInventoryDirty();
    }

    /**
     * Get inventory state for serialization
     * @returns {object}
     */
    serialize() {
        return {
            rows: this.rows,
            cols: this.cols,
            items: this.items,
            slotSize: this.slotSize,
            gap: this.gap
        };
    }

    /**
     * Load inventory state from serialized data
     * @param {object} data
     */
    deserialize(data) {
        this.rows = data.rows || this.rows;
        this.cols = data.cols || this.cols;
        this.items = data.items || [];
        this.slotSize = data.slotSize || this.slotSize;
        this.gap = data.gap || this.gap;
    }

    /**
     * Static utility: Try to add item to an external inventory object
     * @param {object} inventory - Inventory object with rows, cols, items
     * @param {object} item - Item to add (must have width, height properties)
     * @returns {boolean} - True if item was added, false if no space
     */
    static tryAddItemToInventory(inventory, item) {
        const { rows, cols, items } = inventory;

        // Try both orientations: original and rotated 90°
        const orientations = [
            { w: item.width, h: item.height, rotation: 0 },
        ];
        if (item.width !== item.height) {
            orientations.push({ w: item.height, h: item.width, rotation: 90 });
        }

        for (const orient of orientations) {
            for (let y = 0; y <= rows - orient.h; y++) {
                for (let x = 0; x <= cols - orient.w; x++) {
                    if (PlayerInventory.isPositionFree(x, y, orient.w, orient.h, items)) {
                        item.x = x;
                        item.y = y;
                        item.rotation = orient.rotation;
                        items.push(item);
                        // Notify tasks panel of new item
                        window.tasksPanel?.onItemAdded(item.type, items.filter(i => i.type === item.type).length);
                        return true;
                    }
                }
            }
        }

        // No space found
        return false;
    }

    /**
     * Static utility: Check if position is free in items array
     * @param {number} x - Grid x position
     * @param {number} y - Grid y position
     * @param {number} width - Item width
     * @param {number} height - Item height
     * @param {Array} existingItems - Array of items to check against
     * @returns {boolean}
     */
    static isPositionFree(x, y, width, height, existingItems) {
        // Check if the rectangle from (x,y) to (x+width-1, y+height-1) overlaps with any existing items
        for (const item of existingItems) {
            // Get item dimensions (account for rotation)
            const itemWidth = item.rotation === 90 ? item.height : item.width;
            const itemHeight = item.rotation === 90 ? item.width : item.height;

            // Check if rectangles overlap
            const xOverlap = x < item.x + itemWidth && x + width > item.x;
            const yOverlap = y < item.y + itemHeight && y + height > item.y;

            if (xOverlap && yOverlap) {
                return false; // Position is occupied
            }
        }

        return true; // Position is free
    }
}

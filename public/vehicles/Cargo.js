/**
 * Cargo - Manages items loaded onto vehicles (crates on carts/ships)
 *
 * Handles multi-slot support for ships, position offsets, and state tracking.
 * Works with both carts (1 slot) and ships (1-4 slots).
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class Cargo {
    constructor(parentType) {
        this.parentType = parentType;  // 'cart' | 'sailboat' | 'ship2'
        this.parentMesh = null;
        this.loadedItems = [];  // [{ slotIndex, mesh, id, chunkKey, quality, lastRepairTime, inventory }]
    }

    /**
     * Get slot configuration for this parent type
     */
    getSlotConfig() {
        if (this.parentType === 'cart') {
            const cartConfig = CONFIG.CRATE_CART || {};
            return [{
                x: 0,
                y: cartConfig.CART_HEIGHT_OFFSET ?? 0.2,
                z: cartConfig.CART_Z_OFFSET ?? -0.1
            }];
        }

        // Ship slots
        const vehicleConfig = CONFIG.CRATE_VEHICLES?.[this.parentType];
        return vehicleConfig?.slots || [];
    }

    /**
     * Get capacity for this parent type
     */
    getCapacity() {
        if (this.parentType === 'cart') return 1;
        return CONFIG.CRATE_VEHICLES?.CAPACITY?.[this.parentType] ?? 0;
    }

    /**
     * Set the parent mesh (cart or ship)
     */
    setParent(mesh) {
        this.parentMesh = mesh;
    }

    /**
     * Check if a slot is occupied
     */
    isSlotOccupied(slotIndex) {
        return this.loadedItems.some(item => item.slotIndex === slotIndex);
    }

    /**
     * Get next available slot index, or -1 if full
     */
    getNextAvailableSlot() {
        const capacity = this.getCapacity();
        for (let i = 0; i < capacity; i++) {
            if (!this.isSlotOccupied(i)) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Check if cargo is full
     */
    isFull() {
        return this.loadedItems.length >= this.getCapacity();
    }

    /**
     * Check if any items are loaded
     */
    hasItems() {
        return this.loadedItems.length > 0;
    }

    /**
     * Get count of loaded items
     */
    getItemCount() {
        return this.loadedItems.length;
    }

    /**
     * Load an item into a slot
     * @param {Object} itemData - { mesh, id, chunkKey, quality, lastRepairTime, inventory }
     * @param {number} slotIndex - Slot to load into (optional, uses next available)
     * @returns {boolean} - Success
     */
    load(itemData, slotIndex = null) {
        if (slotIndex === null) {
            slotIndex = this.getNextAvailableSlot();
        }

        if (slotIndex === -1 || this.isSlotOccupied(slotIndex)) {
            return false;
        }

        const slots = this.getSlotConfig();
        const slot = slots[slotIndex];
        if (!slot) return false;

        // Position the mesh at slot position
        if (itemData.mesh && this.parentMesh) {
            // Parent to vehicle
            this.parentMesh.add(itemData.mesh);

            // Set local position within parent
            itemData.mesh.position.set(slot.x, slot.y, slot.z);
            itemData.mesh.rotation.set(0, 0, 0);  // Reset rotation relative to parent
        }

        this.loadedItems.push({
            slotIndex,
            mesh: itemData.mesh,
            id: itemData.id,
            chunkKey: itemData.chunkKey,
            quality: itemData.quality,
            lastRepairTime: itemData.lastRepairTime,
            inventory: itemData.inventory
        });

        return true;
    }

    /**
     * Unload an item from a slot
     * @param {number} slotIndex - Slot to unload from
     * @returns {Object|null} - Unloaded item data or null
     */
    unload(slotIndex) {
        const index = this.loadedItems.findIndex(item => item.slotIndex === slotIndex);
        if (index === -1) return null;

        const item = this.loadedItems.splice(index, 1)[0];

        // Unparent mesh
        if (item.mesh && this.parentMesh) {
            // Get world position before unparenting
            const worldPos = new THREE.Vector3();
            item.mesh.getWorldPosition(worldPos);
            const worldRot = item.mesh.rotation.y + (this.parentMesh.rotation?.y || 0);

            // Remove from parent
            this.parentMesh.remove(item.mesh);

            // Store world position for caller to use
            item.worldPosition = worldPos;
            item.worldRotation = worldRot;
        }

        return item;
    }

    /**
     * Unload item by ID
     * @param {string} itemId - ID of item to unload
     * @returns {Object|null} - Unloaded item data or null
     */
    unloadById(itemId) {
        const item = this.loadedItems.find(item => item.id === itemId);
        if (!item) return null;
        return this.unload(item.slotIndex);
    }

    /**
     * Unload all items
     * @returns {Array} - Array of unloaded item data
     */
    unloadAll() {
        const items = [];
        while (this.loadedItems.length > 0) {
            const item = this.unload(this.loadedItems[0].slotIndex);
            if (item) items.push(item);
        }
        return items;
    }

    /**
     * Get item by slot index
     */
    getItem(slotIndex) {
        return this.loadedItems.find(item => item.slotIndex === slotIndex);
    }

    /**
     * Get item by ID
     */
    getItemById(itemId) {
        return this.loadedItems.find(item => item.id === itemId);
    }

    /**
     * Get all loaded items
     */
    getAllItems() {
        return [...this.loadedItems];
    }

    /**
     * Get state for P2P sync
     */
    getState() {
        return {
            parentType: this.parentType,
            items: this.loadedItems.map(item => ({
                slotIndex: item.slotIndex,
                id: item.id,
                chunkKey: item.chunkKey,
                quality: item.quality,
                lastRepairTime: item.lastRepairTime,
                // Don't include mesh or full inventory in P2P state
                hasInventory: !!item.inventory
            }))
        };
    }

    /**
     * Get drop position configuration for cart
     */
    static getCartDropConfig() {
        const cartConfig = CONFIG.CRATE_CART || {};
        return {
            DROP_OFFSET: cartConfig.DROP_OFFSET ?? 0.6,
            MIN_DROP_HEIGHT: cartConfig.MIN_DROP_HEIGHT ?? -10,
            MAX_DROP_HEIGHT: cartConfig.MAX_DROP_HEIGHT ?? 100
        };
    }

    /**
     * Get landing search config for ships
     */
    static getShipLandingConfig() {
        return {
            SEARCH_RADIUS: CONFIG.CRATE_VEHICLES?.LANDING_SEARCH_RADIUS ?? 3
        };
    }

    /**
     * Calculate drop position behind cart
     * @param {THREE.Vector3} cartPos - Cart position
     * @param {number} cartRotation - Cart rotation Y
     * @returns {{ x, z }} - Drop position (caller should get terrain Y)
     */
    static calculateCartDropPosition(cartPos, cartRotation) {
        const config = Cargo.getCartDropConfig();
        return {
            x: cartPos.x - Math.sin(cartRotation) * config.DROP_OFFSET,
            z: cartPos.z - Math.cos(cartRotation) * config.DROP_OFFSET
        };
    }

    /**
     * Validate drop position
     * @param {number} terrainY - Terrain height at drop position
     * @returns {{ valid: boolean, reason?: string }}
     */
    static validateDropPosition(terrainY) {
        const config = Cargo.getCartDropConfig();

        if (terrainY < 0) {
            return { valid: false, reason: 'Cannot unload into water' };
        }
        if (terrainY < config.MIN_DROP_HEIGHT) {
            return { valid: false, reason: 'Invalid terrain height' };
        }
        if (terrainY > config.MAX_DROP_HEIGHT) {
            return { valid: false, reason: 'Invalid terrain height' };
        }

        return { valid: true };
    }

    /**
     * Clear all state (for cleanup)
     */
    clear() {
        // Unparent all meshes first
        for (const item of this.loadedItems) {
            if (item.mesh && this.parentMesh) {
                this.parentMesh.remove(item.mesh);
            }
        }
        this.loadedItems = [];
        this.parentMesh = null;
    }
}

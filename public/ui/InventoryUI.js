// File: public/ui/InventoryUI.js
// Complete Inventory UI Module - Fully extracted from game.js
// Handles all inventory rendering, drag-and-drop, chisel targeting, and crate management

import { CONFIG } from '../config.js';
import { ui } from '../ui.js';
import { GridUIHelpers, TooltipHelper } from './GridUIHelpers.js';

/**
 * Helper function to check if a material is a plank type
 * @param {string} material - Material type to check
 * @returns {boolean}
 */
function isPlankType(material) {
    return material === 'oakplank' ||
           material === 'pineplank' ||
           material === 'firplank' ||
           material === 'cypressplank';
}

/**
 * Get total quantity of all plank types in materials object
 * @param {object} materials - Materials object with quantities
 * @returns {number}
 */
function getTotalPlankQuantity(materials) {
    let total = 0;
    if (materials.oakplank) total += materials.oakplank.quantity || 0;
    if (materials.pineplank) total += materials.pineplank.quantity || 0;
    if (materials.firplank) total += materials.firplank.quantity || 0;
    if (materials.cypressplank) total += materials.cypressplank.quantity || 0;
    return total;
}

/**
 * Format material name for display
 * Converts plank types to generic "Plank" label
 * @param {string} material - Material type
 * @returns {string}
 */
function formatMaterialName(material) {
    if (isPlankType(material)) {
        return 'Plank';
    }
    return material.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
}

export class InventoryUI {
    constructor(gameState, game) {
        this.gameState = gameState;
        this.game = game; // Reference to game instance for callbacks
        this.networkManager = game.networkManager;
        this.ui = ui;
        this.audioManager = game.audioManager;

        // Inventory interaction state (click-based pickup/place)
        this.inventoryPickedItem = null; // Item currently being held
        this.inventoryPickedOriginalX = 0;
        this.inventoryPickedOriginalY = 0;
        this.inventoryPickedOriginalRotation = 0;
        this.inventoryPickedSource = null; // 'backpack' or 'crate'
        this.inventoryPickedTarget = null; // 'backpack' or 'crate'
        this.inventoryMouseX = 0;
        this.inventoryMouseY = 0;
        this.inventoryIgnoreNextMouseUp = false; // Flag to ignore mouseup from pickup click

        // Chiseling state
        this.chiselTarget = null;

        // Item combining state
        this.combineTarget = null;

        // Crate inventory reference
        this.crateInventory = null;

        // Event handler references (for cleanup)
        this.mouseMoveHandler = null;
        this.mouseUpHandler = null;
        this.keyDownHandler = null;

        // Callbacks that will be set by game
        this.onChiselingStart = null;
        this.onItemCombine = null;
        this.onConstructionMaterialAdded = null;
        this.onInventoryClosed = null;
        this.onProximityCheck = null;
    }

    // ==========================================
    // INITIALIZATION
    // ==========================================

    initialize() {
        // Generate grid slots
        const grid = document.getElementById('inventoryGrid');
        for (let row = 0; row < this.gameState.inventory.rows; row++) {
            for (let col = 0; col < this.gameState.inventory.cols; col++) {
                const slot = document.createElement('div');
                slot.className = 'inventory-slot';
                slot.dataset.row = row;
                slot.dataset.col = col;
                grid.appendChild(slot);
            }
        }

        // Add event listeners
        document.getElementById('inventoryCloseBtn').addEventListener('click', () => {
            this.toggleInventory();
        });

        // Clicking overlay background closes inventory
        const overlay = document.getElementById('inventoryOverlay');
        overlay.addEventListener('click', (event) => {
            // Only close if clicking the overlay itself, not its children
            if (event.target === overlay) {
                this.toggleInventory();
            }
        });

        // Prevent clicks on the panel from closing inventory
        const panel = document.querySelector('.inventory-panel');
        panel.addEventListener('click', (event) => {
            event.stopPropagation();
        });

        // Discard modal event listeners
        document.getElementById('discardCancel').addEventListener('click', () => {
            const modal = document.getElementById('discardModal');
            modal.style.display = 'none';
        });

        document.getElementById('discardConfirm').addEventListener('click', () => {
            const modal = document.getElementById('discardModal');
            const itemId = modal.dataset.itemId;

            // Find and remove the item from inventory
            const itemIndex = this.gameState.inventory.items.findIndex(item => item.id === itemId);
            if (itemIndex !== -1) {
                this.gameState.inventory.items.splice(itemIndex, 1);
            }

            // Hide modal and re-render inventory
            modal.style.display = 'none';
            this.renderInventory();

            // Re-check proximity to update button states (in case they discarded a required tool)
            if (this.onProximityCheck) {
                this.onProximityCheck();
            }
        });

        // Render initial items
        this.renderInventory();
    }

    calculateInventorySize() {
        const { slotSize, gap } = GridUIHelpers.calculateGridSize(this.gameState.inventory.rows);
        this.gameState.inventory.slotSize = slotSize;
        this.gameState.inventory.gap = gap;
    }

    // ==========================================
    // INVENTORY TOGGLE
    // ==========================================

    toggleInventory() {
        this.gameState.inventoryOpen = !this.gameState.inventoryOpen;
        const overlay = document.getElementById('inventoryOverlay');

        if (this.gameState.inventoryOpen) {
            this.calculateInventorySize(); // Recalculate on open
            overlay.style.display = 'flex';
            this.renderInventory();
            this.updateConstructionSection(); // Show/hide construction section based on proximity
            this.updateCrateSection(); // Show/hide crate section based on proximity
        } else {
            overlay.style.display = 'none';

            // Save crate inventory if dirty (modified)
            if (this.gameState.nearestStructure && this.crateInventory) {
                const crate = this.gameState.nearestStructure;
                if (crate.userData.inventoryDirty) {
                    // Save inventory to server
                    this.networkManager.sendMessage('save_crate_inventory', {
                        crateId: crate.userData.objectId,
                        chunkId: `chunk_${crate.userData.chunkKey}`,
                        inventory: this.crateInventory
                    });
                    crate.userData.inventoryDirty = false;
                }
            }

            // Call callback if inventory was closed
            if (this.onInventoryClosed) {
                this.onInventoryClosed();
            }
        }
    }

    // ==========================================
    // BACKPACK INVENTORY RENDERING
    // ==========================================

    renderInventory() {
        const itemsContainer = document.getElementById('inventoryItems');
        const inventoryGrid = document.getElementById('inventoryGrid');
        itemsContainer.innerHTML = ''; // Clear existing

        // Update grid styling dynamically
        const { slotSize, gap, rows, cols } = this.gameState.inventory;
        GridUIHelpers.applyGridStyling(inventoryGrid, rows, cols, slotSize, gap);

        // Update slot styling
        const slots = inventoryGrid.querySelectorAll('.inventory-slot');
        slots.forEach(slot => {
            slot.style.width = `${slotSize}px`;
            slot.style.height = `${slotSize}px`;
        });

        this.gameState.inventory.items.forEach(item => {
            this.renderBackpackItem(item, itemsContainer);
        });

        // Render picked item as ghost following cursor (only if targeting backpack)
        if (this.inventoryPickedItem && this.inventoryPickedTarget === 'backpack') {
            const itemsContainer = document.getElementById('inventoryItems');
            this._renderGhostItem(this.inventoryPickedItem, itemsContainer, 'backpack', this.inventoryMouseX, this.inventoryMouseY);
        }
    }

    // ==========================================
    // TOOLTIP SYSTEM
    // ==========================================

    getStatColor(value) {
        if (value >= 80) return 'stat-good';
        if (value >= 40) return 'stat-worn';
        return 'stat-poor';
    }

    showTooltip(event, item) {
        // Don't show tooltip while holding an item
        if (this.inventoryPickedItem) return;

        const tooltip = document.getElementById('inventoryTooltip');
        const titleEl = tooltip.querySelector('.tooltip-title');
        const qualityEl = tooltip.querySelector('.tooltip-quality');
        const durabilityEl = tooltip.querySelector('.tooltip-durability');
        const durabilityRow = durabilityEl.closest('.tooltip-stat');

        // Set content
        titleEl.textContent = item.type;
        qualityEl.textContent = `${item.quality}/100`;

        // Apply color coding for quality
        qualityEl.className = `tooltip-quality ${this.getStatColor(item.quality)}`;

        // Only show durability for items that have it (tools)
        if (item.durability !== undefined) {
            const displayDurability = Math.floor(item.durability);
            durabilityEl.textContent = `${displayDurability}/100`;
            durabilityEl.className = `tooltip-durability ${this.getStatColor(displayDurability)}`;
            durabilityRow.style.display = '';
        } else {
            // Hide durability row for materials
            durabilityRow.style.display = 'none';
        }

        // Show sell price breakdown if at a market
        const sellSection = tooltip.querySelector('.tooltip-sell-section');
        if (this.gameState.nearestStructure && this.gameState.inventoryOpen) {
            const marketPrices = CONFIG.MARKET.PRICES;
            const priceData = marketPrices[item.type];

            if (priceData) {
                // Get market data for supply/demand calculation
                const market = this.gameState.nearestStructure;
                const marketInventory = market.userData.inventory || { quantities: {} };

                // Only show market pricing if this is actually a market (has quantities)
                // Crates, houses, gardens use items array instead
                if (!marketInventory.quantities) {
                    sellSection.style.display = 'none';
                } else {
                    const currentQuantity = marketInventory.quantities[item.type] || 0;
                    const maxQty = priceData.maxQuantity;
                    const supplyMultiplier = 1 + ((maxQty - currentQuantity) / maxQty) * 0.5;

                    // Check if this is a tool
                    const toolTypes = ['axe', 'saw', 'pickaxe', 'hammer', 'chisel'];
                    const isTool = toolTypes.includes(item.type);

                    // Calculate quality/durability multiplier
                    let qualityMultiplier;
                    if (isTool) {
                        const quality = item.quality || 50;
                        const durability = item.durability || 50;
                        const avgStat = (quality + durability) / 2;
                        qualityMultiplier = avgStat / 100;
                    } else {
                        const quality = item.quality || 50;
                        qualityMultiplier = quality / 100;
                    }

                    // Calculate final sell price
                    const basePrice = priceData.sellPrice;
                    const afterSupply = basePrice * supplyMultiplier;
                    const finalPrice = Math.floor(afterSupply * qualityMultiplier);

                    // Update tooltip elements
                    tooltip.querySelector('.tooltip-sell-base').textContent = `🪙${basePrice}`;
                    tooltip.querySelector('.tooltip-sell-supply').textContent = `×${supplyMultiplier.toFixed(2)} = 🪙${Math.floor(afterSupply)}`;

                    // Calculate percentage change for quality modifier
                    const percentChange = ((qualityMultiplier - 1) * 100).toFixed(0);
                    const percentDisplay = percentChange >= 0 ? `+${percentChange}%` : `${percentChange}%`;
                    tooltip.querySelector('.tooltip-sell-quality').textContent = `${percentDisplay} = 🪙${finalPrice}`;

                    tooltip.querySelector('.tooltip-sell-price').textContent = `🪙${finalPrice}`;

                    sellSection.style.display = '';
                }
            } else {
                sellSection.style.display = 'none';
            }
        } else {
            sellSection.style.display = 'none';
        }

        // Position and show tooltip
        this.updateTooltipPosition(event);
        tooltip.style.display = 'block';
    }

    updateTooltipPosition(event) {
        TooltipHelper.updatePosition('inventoryTooltip', event);
    }

    hideTooltip() {
        TooltipHelper.hide('inventoryTooltip');
    }

    showDiscardTooltip(event) {
        // Don't show tooltip while holding an item
        if (this.inventoryPickedItem) return;

        const tooltip = document.getElementById('inventoryTooltip');
        const titleEl = tooltip.querySelector('.tooltip-title');

        // Hide stat rows and sell section, only show "Discard"
        tooltip.querySelectorAll('.tooltip-stat').forEach(stat => {
            stat.style.display = 'none';
        });
        const sellSection = tooltip.querySelector('.tooltip-sell-section');
        if (sellSection) {
            sellSection.style.display = 'none';
        }

        // Set content
        titleEl.textContent = 'Discard';
        titleEl.style.color = '#8B5A5A'; // Muted terracotta for discard action

        // Position and show tooltip
        this.updateTooltipPosition(event);
        tooltip.style.display = 'block';
    }

    hideDiscardTooltip() {
        const tooltip = document.getElementById('inventoryTooltip');
        tooltip.style.display = 'none';

        // Reset tooltip styles
        tooltip.querySelectorAll('.tooltip-stat').forEach(stat => {
            stat.style.display = '';
        });
        const titleEl = tooltip.querySelector('.tooltip-title');
        titleEl.style.color = '';
    }

    showDiscardConfirmation(item) {
        const modal = document.getElementById('discardModal');
        const message = document.getElementById('discardMessage');

        // Set message with item name
        message.textContent = `Are you sure you want to trash ${item.type}?`;

        // Store item reference for confirmation
        modal.dataset.itemId = item.id;

        // Show modal
        modal.style.display = 'flex';
    }

    // ==========================================
    // GRID POSITIONING
    // ==========================================

    gridToPixel(gridX, gridY) {
        const { slotSize, gap } = this.gameState.inventory;
        return GridUIHelpers.gridToPixel(gridX, gridY, slotSize, gap);
    }

    pixelToGrid(pixelX, pixelY) {
        const { slotSize, gap } = this.gameState.inventory;
        return GridUIHelpers.pixelToGrid(pixelX, pixelY, slotSize, gap);
    }

    // ==========================================
    // PLACEMENT VALIDATION
    // ==========================================

    getOccupiedSlots(item, x, y, rotation) {
        const slots = [];
        const width = rotation === 90 ? item.height : item.width;
        const height = rotation === 90 ? item.width : item.height;

        for (let row = y; row < y + height; row++) {
            for (let col = x; col < x + width; col++) {
                slots.push({ x: col, y: row });
            }
        }
        return slots;
    }

    isValidPlacement(item, x, y, rotation) {
        return this._isValidPlacementInGrid(
            item, x, y, rotation,
            this.gameState.inventory.items,
            this.gameState.inventory.cols,
            this.gameState.inventory.rows
        );
    }

    isValidCratePlacement(item, x, y, rotation) {
        const crateInventory = this.crateInventory;
        if (!crateInventory || !crateInventory.items) {
            return false;
        }

        // Get structure type and inventory size from config
        const crate = this.gameState.nearestStructure;
        if (!crate) return false;

        const structureType = crate.userData.modelType;
        const structureProps = CONFIG.CONSTRUCTION.STRUCTURE_PROPERTIES[structureType];

        // Default to 10x10 if no specific size configured
        const cols = structureProps?.inventorySize?.cols || 10;
        const rows = structureProps?.inventorySize?.rows || 10;

        return this._isValidPlacementInGrid(item, x, y, rotation, crateInventory.items, cols, rows);
    }

    // ==========================================
    // DRAG AND DROP HELPERS (Internal)
    // ==========================================

    /**
     * Render ghost item following cursor
     * @private
     */
    _renderGhostItem(item, container, targetType, mouseX, mouseY) {
        const { slotSize, gap } = this.gameState.inventory;
        // Use the correct container based on target type
        const itemsContainer = targetType === 'crate'
            ? document.getElementById('crateItems')
            : document.getElementById('inventoryItems');
        const containerRect = itemsContainer.getBoundingClientRect();
        const absoluteMouseX = mouseX + containerRect.left;
        const absoluteMouseY = mouseY + containerRect.top;

        // Determine if we should use raw mouse position (over construction/crate sections)
        let useMousePosition = false;
        let posX, posY, gridPos;

        if (targetType === 'backpack') {
            // Check if hovering over construction section
            const constructionSection = document.getElementById('constructionSection');
            if (constructionSection && constructionSection.style.display !== 'none') {
                const rect = constructionSection.getBoundingClientRect();
                if (absoluteMouseX >= rect.left && absoluteMouseX <= rect.right &&
                    absoluteMouseY >= rect.top && absoluteMouseY <= rect.bottom) {
                    useMousePosition = true;
                }
            }

            // Check if hovering over crate section
            const crateSection = document.getElementById('crateSection');
            if (!useMousePosition && crateSection && crateSection.style.display !== 'none') {
                const rect = crateSection.getBoundingClientRect();
                if (absoluteMouseX >= rect.left && absoluteMouseX <= rect.right &&
                    absoluteMouseY >= rect.top && absoluteMouseY <= rect.bottom) {
                    useMousePosition = true;
                }
            }
        }

        if (useMousePosition) {
            // Use raw mouse position (stick to cursor)
            posX = mouseX;
            posY = mouseY;
            gridPos = this.pixelToGrid(mouseX, mouseY);
        } else {
            // Snap to grid
            gridPos = this.pixelToGrid(mouseX, mouseY);
            const snappedPixelPos = this.gridToPixel(gridPos.x, gridPos.y);
            posX = snappedPixelPos.x;
            posY = snappedPixelPos.y;
        }

        // Create ghost wrapper
        const ghostWrapper = document.createElement('div');
        ghostWrapper.className = targetType === 'backpack' ? 'inventory-item-wrapper dragging' : 'crate-item-wrapper dragging';
        ghostWrapper.dataset.itemId = item.id;
        ghostWrapper.style.position = 'absolute';
        ghostWrapper.style.left = posX + 'px';
        ghostWrapper.style.top = posY + 'px';
        ghostWrapper.style.opacity = '0.7';
        ghostWrapper.style.pointerEvents = 'none';
        ghostWrapper.style.zIndex = '2000';

        // Create ghost image
        const ghostImg = document.createElement('img');
        ghostImg.src = item.rotation === 90 ? `./items/R${item.type}.png` : `./items/${item.type}.png`;
        ghostImg.className = targetType === 'backpack' ? 'inventory-item' : 'crate-item';
        ghostImg.style.position = 'relative';

        // Calculate size
        const displayWidth = item.rotation === 90 ? item.height : item.width;
        const displayHeight = item.rotation === 90 ? item.width : item.height;
        const { widthPx, heightPx } = GridUIHelpers.calculateItemSize(displayWidth, displayHeight, slotSize, gap);

        ghostImg.style.width = widthPx + 'px';
        ghostImg.style.height = heightPx + 'px';
        ghostWrapper.style.width = widthPx + 'px';
        ghostWrapper.style.height = heightPx + 'px';

        // Check placement validity and add visual feedback
        const isValid = targetType === 'backpack'
            ? this.isValidPlacement(item, gridPos.x, gridPos.y, item.rotation)
            : this.isValidCratePlacement(item, gridPos.x, gridPos.y, item.rotation);

        if (!isValid) {
            if (targetType === 'backpack') {
                ghostWrapper.classList.add('invalid-placement');
            } else {
                ghostWrapper.style.outline = '3px solid #8B5A5A';
                ghostWrapper.style.outlineOffset = '-3px';
            }
        }

        ghostWrapper.appendChild(ghostImg);
        container.appendChild(ghostWrapper);
    }

    _isValidPlacementInGrid(item, x, y, rotation, itemsList, maxCols, maxRows) {
        const width = rotation === 90 ? item.height : item.width;
        const height = rotation === 90 ? item.width : item.height;

        // Bounds check
        if (x < 0 || y < 0 || x + width > maxCols || y + height > maxRows) {
            return false;
        }

        // Collision check with other items
        const occupiedSlots = this.getOccupiedSlots(item, x, y, rotation);

        for (const otherItem of itemsList) {
            if (otherItem.id === item.id) continue;

            const otherSlots = this.getOccupiedSlots(
                otherItem,
                otherItem.x,
                otherItem.y,
                otherItem.rotation
            );

            // Check for overlap
            for (const slot of occupiedSlots) {
                for (const otherSlot of otherSlots) {
                    if (slot.x === otherSlot.x && slot.y === otherSlot.y) {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    _setupDragHandlers(source) {
        // Setup global event listeners for dragging
        // Always use unified handlers
        this.mouseMoveHandler = (e) => this.onMouseMove(e);
        this.mouseUpHandler = (e) => this.onMouseUp(e);
        this.keyDownHandler = (e) => this.onInventoryKeyDown(e);

        window.addEventListener('mousemove', this.mouseMoveHandler);
        window.addEventListener('mouseup', this.mouseUpHandler);
        window.addEventListener('keydown', this.keyDownHandler);
    }

    _cleanupDragHandlers() {
        window.removeEventListener('mousemove', this.mouseMoveHandler);
        window.removeEventListener('mouseup', this.mouseUpHandler);
        window.removeEventListener('keydown', this.keyDownHandler);
    }

    _startItemDrag(item, source, event, containerElement) {
        this.inventoryPickedItem = item;
        this.inventoryPickedSource = source;
        this.inventoryPickedTarget = source;
        this.inventoryPickedOriginalX = item.x;
        this.inventoryPickedOriginalY = item.y;
        this.inventoryPickedOriginalRotation = item.rotation;
        this.inventoryIgnoreNextMouseUp = true;

        // Store mouse position
        const containerRect = containerElement.getBoundingClientRect();
        this.inventoryMouseX = event.clientX - containerRect.left;
        this.inventoryMouseY = event.clientY - containerRect.top;

        this._setupDragHandlers(source);

        // Re-render to show item following cursor
        this.renderInventory();
        if (this.gameState.nearestStructure) {
            this.renderCrateInventory();
        }
    }

    // ==========================================
    // ITEM TARGETING (Chisel + Combining)
    // ==========================================

    getItemUnderCursor(cursorX, cursorY, draggingItem) {
        // Check if cursor is over a targetable item (chiseable stones or combinable items)
        const chiseableStones = ['limestone', 'sandstone', 'Rlimestone', 'Rsandstone'];
        const combinableItems = ['grass', 'Rgrass', 'rope', 'Rrope'];

        for (const invItem of this.gameState.inventory.items) {
            if (invItem.id === draggingItem.id) continue; // Skip the item being dragged

            // Check if this item type is targetable (stone for chiseling, or combinable items)
            const isChiseableStone = chiseableStones.includes(invItem.type);
            const isCombinable = combinableItems.includes(invItem.type);
            if (!isChiseableStone && !isCombinable) continue; // Skip non-targetable items

            // Calculate item's pixel position and size using dynamic values
            const { slotSize, gap } = this.gameState.inventory;
            const displayWidth = invItem.rotation === 90 ? invItem.height : invItem.width;
            const displayHeight = invItem.rotation === 90 ? invItem.width : invItem.height;
            const { x: itemPixelX, y: itemPixelY } = GridUIHelpers.gridToPixel(invItem.x, invItem.y, slotSize, gap);
            const { widthPx: itemPixelWidth, heightPx: itemPixelHeight } = GridUIHelpers.calculateItemSize(displayWidth, displayHeight, slotSize, gap);

            // Check if cursor is over this item
            if (cursorX >= itemPixelX && cursorX <= itemPixelX + itemPixelWidth &&
                cursorY >= itemPixelY && cursorY <= itemPixelY + itemPixelHeight) {
                return invItem;
            }
        }
        return null;
    }

    // ==========================================
    // DRAG AND DROP - BACKPACK
    // ==========================================

    onItemMouseDown(event, item, itemWrapper) {
        event.preventDefault();
        event.stopPropagation();

        if (this.inventoryPickedItem) return;

        this.hideTooltip();

        const itemsContainer = document.getElementById('inventoryItems');
        this._startItemDrag(item, 'backpack', event, itemsContainer);
    }

    onMouseMove(event) {
        if (!this.inventoryPickedItem) return;

        const item = this.inventoryPickedItem;

        // Check if we need to handle both backpack and crate (crate mode)
        const crateSection = document.getElementById('crateSection');
        const crateVisible = crateSection && crateSection.style.display !== 'none';

        if (crateVisible && this.gameState.nearestStructure) {
            // Use crate-aware logic that handles both targets
            this._handleCrateAwareMouseMove(event, item);
        } else {
            // Simple backpack-only logic
            this._handleBackpackOnlyMouseMove(event, item);
        }
    }

    _handleBackpackOnlyMouseMove(event, item) {
        const itemsContainer = document.getElementById('inventoryItems');
        const containerRect = itemsContainer.getBoundingClientRect();

        // Update mouse position
        this.inventoryMouseX = event.clientX - containerRect.left;
        this.inventoryMouseY = event.clientY - containerRect.top;

        // Check if hovering over construction slots for visual feedback
        this._updateConstructionSlotHighlight(event, item);

        // Check if hovering over market for visual feedback
        this._updateMarketListHighlight(event, item);

        // Check if holding a chisel over a stone item
        this._updateChiselTarget(item);

        // Check if holding a combinable item over same type
        this._updateCombineTarget(item);

        // Re-render to update ghost position and visual feedback
        this.renderInventory();
    }

    _handleCrateAwareMouseMove(event, item) {
        // Get grid containers (not items layers) for proper bounds checking
        const backpackGrid = document.getElementById('inventoryGrid');
        const backpackRect = backpackGrid.getBoundingClientRect();

        const crateGrid = document.getElementById('crateGrid');
        const crateRect = crateGrid.getBoundingClientRect();

        // Determine which container we're targeting based on mouse position
        let overBackpack = (event.clientX >= backpackRect.left && event.clientX <= backpackRect.right &&
                            event.clientY >= backpackRect.top && event.clientY <= backpackRect.bottom);

        let overCrate = (event.clientX >= crateRect.left && event.clientX <= crateRect.right &&
                        event.clientY >= crateRect.top && event.clientY <= crateRect.bottom);

        // Get items layers for position calculation
        const backpackItems = document.getElementById('inventoryItems');
        const backpackItemsRect = backpackItems.getBoundingClientRect();

        const crateItems = document.getElementById('crateItems');
        const crateItemsRect = crateItems.getBoundingClientRect();

        // Get scroll position for crate (needed for large scrollable inventories)
        const crateGridContainer = crateGrid.parentElement;
        const crateScrollTop = crateGridContainer.scrollTop;

        // Update target and position based on which area mouse is over
        if (overBackpack) {
            // Mouse over backpack - calculate position relative to items layer
            this.inventoryMouseX = event.clientX - backpackItemsRect.left;
            this.inventoryMouseY = event.clientY - backpackItemsRect.top;
            this.inventoryPickedTarget = 'backpack';
        } else if (overCrate) {
            // Mouse over crate - calculate position relative to items layer, accounting for scroll
            this.inventoryMouseX = event.clientX - crateItemsRect.left;
            this.inventoryMouseY = event.clientY - crateItemsRect.top + crateScrollTop;
            this.inventoryPickedTarget = 'crate';
        } else {
            // Mouse is outside both areas - keep updating position relative to current target
            if (this.inventoryPickedTarget === 'crate') {
                this.inventoryMouseX = event.clientX - crateItemsRect.left;
                this.inventoryMouseY = event.clientY - crateItemsRect.top + crateScrollTop;
            } else {
                this.inventoryMouseX = event.clientX - backpackItemsRect.left;
                this.inventoryMouseY = event.clientY - backpackItemsRect.top;
            }
        }

        // Check if holding a chisel over a stone item (only in backpack)
        if (item.type === 'chisel' && this.inventoryPickedTarget === 'backpack') {
            this._updateChiselTarget(item);
            this.combineTarget = null; // Clear combine target when using chisel
        } else {
            this.chiselTarget = null;
        }

        // Check if holding a combinable item over same type (only in backpack)
        const itemType = item.type.replace('R', '');
        if ((itemType === 'grass' || itemType === 'rope') && this.inventoryPickedTarget === 'backpack') {
            this._updateCombineTarget(item);
            this.chiselTarget = null; // Clear chisel target when combining items
        } else {
            this.combineTarget = null;
        }

        // Check if hovering over market for visual feedback (only from backpack)
        if (this.inventoryPickedSource === 'backpack') {
            this._updateMarketListHighlight(event, item);
        }

        // Re-render both inventories to update ghost position
        this.renderInventory();
        if (this.gameState.nearestStructure) {
            this.renderCrateInventory();
        }
    }

    _updateConstructionSlotHighlight(event, item) {
        if (this.gameState.nearestConstructionSite && !this.gameState.isMoving) {
            const constructionSection = document.getElementById('constructionSection');
            if (constructionSection && constructionSection.style.display !== 'none') {
                const slots = constructionSection.querySelectorAll('.construction-slot');
                slots.forEach(slot => {
                    const rect = slot.getBoundingClientRect();
                    if (event.clientX >= rect.left && event.clientX <= rect.right &&
                        event.clientY >= rect.top && event.clientY <= rect.bottom) {
                        // Check if this slot accepts the current item
                        const material = slot.dataset.material;
                        const slotIndex = parseInt(slot.dataset.slotIndex);
                        const requiredMaterials = this.gameState.nearestConstructionSite.userData.requiredMaterials || {};
                        const currentMaterials = this.gameState.nearestConstructionSite.userData.materials || {};

                        // Check if item can be added to this slot
                        let canAddHere = false;
                        if (requiredMaterials[item.type] && material === item.type) {
                            // Exact match
                            canAddHere = slotIndex === (currentMaterials[item.type]?.quantity || 0);
                        } else if (isPlankType(item.type) && isPlankType(material) && requiredMaterials[material]) {
                            // Any plank type can be added to a plank slot
                            const totalPlanks = getTotalPlankQuantity(currentMaterials);
                            canAddHere = slotIndex === totalPlanks;
                        }

                        if (canAddHere) {
                            // Valid slot - highlight it
                            slot.style.backgroundColor = 'rgba(107, 127, 92, 0.3)';
                            slot.style.border = '2px solid #6B7F5C';
                        }
                    } else {
                        // Reset slot styling
                        slot.style.backgroundColor = '';
                        slot.style.border = '';
                    }
                });
            }
        }
    }

    _updateMarketListHighlight(event, item) {
        const nearestStructure = this.gameState.nearestStructure;
        const marketListContainer = document.getElementById('marketListContainer');
        const sellPreview = document.getElementById('marketSellPreview');
        const sellPreviewAmount = document.getElementById('sellPreviewAmount');

        if (!nearestStructure || nearestStructure.userData.modelType !== 'market' || this.gameState.isMoving) {
            // Clear any previous highlight and preview
            if (marketListContainer) {
                marketListContainer.style.outline = '';
            }
            if (sellPreview) {
                sellPreview.style.display = 'none';
            }
            return;
        }

        if (!marketListContainer || marketListContainer.style.display === 'none') {
            return;
        }

        const rect = marketListContainer.getBoundingClientRect();
        const isOverMarket = (event.clientX >= rect.left && event.clientX <= rect.right &&
                             event.clientY >= rect.top && event.clientY <= rect.bottom);

        // Check if item is accepted by market
        const marketPrices = CONFIG.MARKET.PRICES;
        const isAccepted = marketPrices[item.type];

        if (isOverMarket && isAccepted) {
            // Highlight market list in green
            marketListContainer.style.outline = '3px solid #6B7F5C';

            // Calculate and show sell price preview
            const priceData = marketPrices[item.type];
            const toolTypes = ['axe', 'saw', 'pickaxe', 'hammer', 'chisel'];
            const isTool = toolTypes.includes(item.type);

            // Get current market quantity for supply/demand calculation
            const marketInventory = nearestStructure.userData.inventory || { quantities: {} };
            const currentQuantity = marketInventory.quantities[item.type] || 0;
            const maxQty = priceData.maxQuantity;
            const supplyMultiplier = 1 + ((maxQty - currentQuantity) / maxQty) * 0.5;

            let sellPrice;
            if (isTool) {
                const quality = item.quality || 50;
                const durability = item.durability || 50;
                const avgStat = (quality + durability) / 2;
                sellPrice = Math.floor(priceData.sellPrice * supplyMultiplier * (avgStat / 100));
            } else {
                const quality = item.quality || 50;
                sellPrice = Math.floor(priceData.sellPrice * supplyMultiplier * (quality / 100));
            }

            if (sellPreview && sellPreviewAmount) {
                sellPreviewAmount.textContent = sellPrice;
                sellPreview.style.display = 'block';
            }
        } else if (isOverMarket && !isAccepted) {
            // Highlight market list in red (not accepted)
            marketListContainer.style.outline = '3px solid #8B5A5A';
            if (sellPreview) {
                sellPreview.style.display = 'none';
            }
        } else {
            // Clear highlight and preview
            marketListContainer.style.outline = '';
            if (sellPreview) {
                sellPreview.style.display = 'none';
            }
        }
    }

    _updateChiselTarget(item) {
        if (item.type === 'chisel') {
            try {
                const targetItem = this.getItemUnderCursor(this.inventoryMouseX, this.inventoryMouseY, item);

                // Validate that the target is actually a chiseable stone
                const chiseableStones = ['limestone', 'sandstone', 'Rlimestone', 'Rsandstone'];
                if (targetItem && chiseableStones.includes(targetItem.type)) {
                    this.chiselTarget = targetItem;
                } else {
                    this.chiselTarget = null;
                }
            } catch (error) {
                console.error('Error checking chisel target:', error);
                this.chiselTarget = null;
            }
        } else {
            this.chiselTarget = null;
        }
    }

    _updateCombineTarget(item) {
        const itemType = item.type.replace('R', '');
        if (itemType === 'grass' || itemType === 'rope') {
            try {
                const targetItem = this.getItemUnderCursor(this.inventoryMouseX, this.inventoryMouseY, item);

                // Check if target is the same type (grass+grass or rope+rope)
                if (targetItem) {
                    const targetType = targetItem.type.replace('R', '');
                    if (targetType === itemType) {
                        this.combineTarget = targetItem;
                    } else {
                        this.combineTarget = null;
                    }
                } else {
                    this.combineTarget = null;
                }
            } catch (error) {
                console.error('Error checking combine target:', error);
                this.combineTarget = null;
            }
        } else {
            this.combineTarget = null;
        }
    }

    onMouseUp(event) {
        if (!this.inventoryPickedItem) return;

        // Ignore the mouseup from the pickup click
        if (this.inventoryIgnoreNextMouseUp) {
            this.inventoryIgnoreNextMouseUp = false;
            return;
        }

        const item = this.inventoryPickedItem;
        const source = this.inventoryPickedSource || 'backpack';

        try {
            // Check if chisel was released over a stone (only from backpack)
            if (source === 'backpack' && item.type === 'chisel' && this.chiselTarget) {
                this._handleChiselDrop();
                return;
            }

            // Check if combinable item was released over same type (only from backpack)
            const itemType = item.type.replace('R', '');
            if (source === 'backpack' && (itemType === 'grass' || itemType === 'rope') && this.combineTarget) {
                this._handleCombineDrop();
                return;
            }

            // Clear any chisel target
            this.chiselTarget = null;
            this.combineTarget = null;

            // Check if dropping onto construction section (only from backpack)
            if (source === 'backpack' && this._tryDropOnConstruction(event, item)) {
                return;
            }

            // Check if dropping onto market (only from backpack)
            if (source === 'backpack' && this._tryDropOnMarket(event, item)) {
                return;
            }

            // Handle placement based on whether we're in crate mode
            const crateSection = document.getElementById('crateSection');
            const crateVisible = crateSection && crateSection.style.display !== 'none';

            if (crateVisible && this.gameState.nearestStructure) {
                this._handleCrateModePlacement(item, source);
            } else {
                this._handleBackpackOnlyPlacement(item);
            }

            // Clear picked item state
            this.inventoryPickedItem = null;
            this.inventoryPickedSource = null;
            this.inventoryPickedTarget = null;
            this.inventoryIgnoreNextMouseUp = false;

            // Remove global event listeners
            this._cleanupDragHandlers();

            // Re-render
            this.renderInventory();
            if (this.gameState.nearestStructure) {
                this.renderCrateInventory();
            }
        } catch (error) {
            console.error('Error placing item:', error);
            this._restoreItemPosition();
        }
    }

    _handleChiselDrop() {
        const targetStone = this.chiselTarget;
        this.chiselTarget = null;

        // Start chiseling action via callback
        if (this.onChiselingStart) {
            this.onChiselingStart(this.inventoryPickedItem, targetStone);
        }

        // Clear picked item state
        this.inventoryPickedItem = null;
        this.inventoryPickedSource = null;
        this.inventoryPickedTarget = null;
        this.inventoryIgnoreNextMouseUp = false;

        // Remove global event listeners
        this._cleanupDragHandlers();

        // Re-render
        this.renderInventory();
        if (this.gameState.nearestStructure) {
            this.renderCrateInventory();
        }
    }

    _handleCombineDrop() {
        const targetItem = this.combineTarget;
        this.combineTarget = null;

        console.log('[COMBINE DEBUG] _handleCombineDrop called! pickedItem:', this.inventoryPickedItem, 'targetItem:', targetItem);

        // Combine items via callback (instant, no action duration)
        if (this.onItemCombine) {
            console.log('[COMBINE DEBUG] Calling onItemCombine callback...');
            this.onItemCombine(this.inventoryPickedItem, targetItem);
        } else {
            console.log('[COMBINE DEBUG] ❌ No onItemCombine callback set!');
        }

        // Clear picked item state
        this.inventoryPickedItem = null;
        this.inventoryPickedSource = null;
        this.inventoryPickedTarget = null;
        this.inventoryIgnoreNextMouseUp = false;

        // Remove global event listeners
        this._cleanupDragHandlers();

        // Re-render
        this.renderInventory();
        if (this.gameState.nearestStructure) {
            this.renderCrateInventory();
        }
    }

    _tryDropOnConstruction(event, item) {
        if (!this.gameState.nearestConstructionSite || this.gameState.isMoving) {
            return false;
        }

        const constructionSection = document.getElementById('constructionSection');
        if (!constructionSection || constructionSection.style.display === 'none') {
            return false;
        }

        const rect = constructionSection.getBoundingClientRect();

        // Check if mouse is over construction section
        if (event.clientX < rect.left || event.clientX > rect.right ||
            event.clientY < rect.top || event.clientY > rect.bottom) {
            return false;
        }

        const requiredMaterials = this.gameState.nearestConstructionSite.userData.requiredMaterials || {};
        const currentMaterials = this.gameState.nearestConstructionSite.userData.materials || {};
        const itemType = item.type;

        // Check if this item type is needed
        // If the item is a plank type, check if any plank type is required
        let isNeeded = false;
        let requiredPlankType = null;
        let required = 0;

        if (requiredMaterials[itemType]) {
            // Exact match
            isNeeded = true;
            required = requiredMaterials[itemType];
        } else if (isPlankType(itemType)) {
            // Check if any plank type is required
            for (const reqMaterial in requiredMaterials) {
                if (isPlankType(reqMaterial)) {
                    isNeeded = true;
                    requiredPlankType = reqMaterial;
                    required = requiredMaterials[reqMaterial];
                    break;
                }
            }
        }

        if (!isNeeded) {
            return false;
        }

        // Calculate current amount
        let current;
        if (isPlankType(itemType) && requiredPlankType) {
            // For planks, check total of all plank types
            current = getTotalPlankQuantity(currentMaterials);
        } else {
            current = currentMaterials[itemType] ? currentMaterials[itemType].quantity : 0;
        }

        if (current >= required) {
            return false;
        }

        // Initialize material items storage
        if (!this.gameState.nearestConstructionSite.userData.materialItems) {
            this.gameState.nearestConstructionSite.userData.materialItems = {};
        }
        if (!this.gameState.nearestConstructionSite.userData.materialItems[itemType]) {
            this.gameState.nearestConstructionSite.userData.materialItems[itemType] = [];
        }

        // Add material to construction with quality tracking
        if (!currentMaterials[itemType]) {
            currentMaterials[itemType] = { quantity: 0, totalQuality: 0 };
        }
        currentMaterials[itemType].quantity = current + 1;
        currentMaterials[itemType].totalQuality += item.quality;
        this.gameState.nearestConstructionSite.userData.materials = currentMaterials;

        // Store the actual item for visual representation
        const nextSlotIndex = this.gameState.nearestConstructionSite.userData.materialItems[itemType].length;
        this.gameState.nearestConstructionSite.userData.materialItems[itemType][nextSlotIndex] = {
            type: item.type,
            quality: item.quality
        };

        // Send update to server
        this.networkManager.sendMessage('update_construction_materials', {
            constructionId: this.gameState.nearestConstructionSite.userData.objectId,
            chunkKey: this.gameState.nearestConstructionSite.userData.chunkKey,
            materials: currentMaterials
        });

        // Remove item from inventory
        const itemIndex = this.gameState.inventory.items.indexOf(item);
        if (itemIndex > -1) {
            this.gameState.inventory.items.splice(itemIndex, 1);
        }

        // Clear picked item state
        this.inventoryPickedItem = null;
        this.inventoryPickedSource = null;
        this.inventoryPickedTarget = null;
        this.inventoryIgnoreNextMouseUp = false;

        // Remove global event listeners
        this._cleanupDragHandlers();

        // Re-render
        this.renderInventory();
        this.updateConstructionSection();
        this.updateCrateSection();

        return true;
    }

    _tryDropOnMarket(event, item) {
        // Check if we're near a market
        const nearestStructure = this.gameState.nearestStructure;
        if (!nearestStructure || nearestStructure.userData.modelType !== 'market') {
            return false;
        }

        if (this.gameState.isMoving) {
            return false;
        }

        const marketListContainer = document.getElementById('marketListContainer');
        if (!marketListContainer || marketListContainer.style.display === 'none') {
            return false;
        }

        const rect = marketListContainer.getBoundingClientRect();

        // Check if mouse is over market list
        if (event.clientX < rect.left || event.clientX > rect.right ||
            event.clientY < rect.top || event.clientY > rect.bottom) {
            return false;
        }

        // Check if item type is accepted by market
        const marketPrices = CONFIG.MARKET.PRICES;
        if (!marketPrices[item.type]) {
            ui.updateStatus(`❌ Market doesn't accept ${item.type}`);
            return false;
        }

        // Execute sell transaction
        this._executeSellTransaction(item);

        // Clear picked item state
        this.inventoryPickedItem = null;
        this.inventoryPickedSource = null;
        this.inventoryPickedTarget = null;
        this.inventoryIgnoreNextMouseUp = false;

        // Clear sell preview
        const sellPreview = document.getElementById('marketSellPreview');
        if (sellPreview) {
            sellPreview.style.display = 'none';
        }
        // Clear outline (marketListContainer already declared above)
        marketListContainer.style.outline = '';

        // Remove global event listeners
        this._cleanupDragHandlers();

        // Re-render
        this.renderInventory();
        this.renderMarketInventory();

        return true;
    }

    _handleBackpackOnlyPlacement(item) {
        // Calculate final grid position
        const gridPos = this.pixelToGrid(this.inventoryMouseX, this.inventoryMouseY);

        // Check if placement is valid
        if (this.isValidPlacement(item, gridPos.x, gridPos.y, item.rotation)) {
            // Valid placement - update item position
            item.x = gridPos.x;
            item.y = gridPos.y;
        } else {
            // Invalid placement - restore original position
            item.x = this.inventoryPickedOriginalX;
            item.y = this.inventoryPickedOriginalY;
            item.rotation = this.inventoryPickedOriginalRotation;
        }
    }

    _handleCrateModePlacement(item, source) {
        const target = this.inventoryPickedTarget || source;

        if (target === 'backpack') {
            // Moving to backpack
            const gridPos = this.pixelToGrid(this.inventoryMouseX, this.inventoryMouseY);

            if (this.isValidPlacement(item, gridPos.x, gridPos.y, item.rotation)) {
                // Valid placement in backpack
                if (source === 'crate') {
                    // Special handling for coins - merge with existing backpack coins
                    if (item.type === 'coin') {
                        const backpackCoin = this.gameState.inventory.items.find(i => i.type === 'coin');
                        if (backpackCoin) {
                            // Merge quantities
                            backpackCoin.quantity = (backpackCoin.quantity || 0) + (item.quantity || 0);
                        } else {
                            // No coin in backpack, move this one
                            item.x = gridPos.x;
                            item.y = gridPos.y;
                            this.gameState.inventory.items.push(item);
                        }
                        // Remove from crate
                        const crateInventory = this.crateInventory;
                        const itemIndex = crateInventory.items.indexOf(item);
                        if (itemIndex > -1) {
                            crateInventory.items.splice(itemIndex, 1);
                        }
                    } else {
                        // Normal item - remove from crate, add to backpack
                        const crateInventory = this.crateInventory;
                        const itemIndex = crateInventory.items.indexOf(item);
                        if (itemIndex > -1) {
                            crateInventory.items.splice(itemIndex, 1);
                        }
                        this.gameState.inventory.items.push(item);
                        // Update position
                        item.x = gridPos.x;
                        item.y = gridPos.y;
                    }
                } else {
                    // Moving within backpack - just update position
                    item.x = gridPos.x;
                    item.y = gridPos.y;
                }
            } else {
                // Invalid placement - restore original position
                item.x = this.inventoryPickedOriginalX;
                item.y = this.inventoryPickedOriginalY;
                item.rotation = this.inventoryPickedOriginalRotation;
            }
        } else if (target === 'crate') {
            // Moving to crate
            const crateGridPos = this.pixelToGrid(this.inventoryMouseX, this.inventoryMouseY);

            // Special handling for coins - show transfer dialog
            if (source === 'backpack' && item.type === 'coin') {
                // Restore item position (it stays in backpack)
                item.x = this.inventoryPickedOriginalX;
                item.y = this.inventoryPickedOriginalY;
                item.rotation = this.inventoryPickedOriginalRotation;

                // Show coin transfer dialog
                this._showCoinTransferDialog(crateGridPos);
                return;
            }

            if (this.isValidCratePlacement(item, crateGridPos.x, crateGridPos.y, item.rotation)) {
                // Valid placement in crate
                if (source === 'backpack') {
                    // ONE-WAY TRANSFER: Block adding items to gardens and apple trees
                    const nearestStructure = this.gameState.nearestStructure;
                    if (nearestStructure && (nearestStructure.userData.modelType === 'garden' || nearestStructure.userData.modelType === 'apple')) {
                        // Reject the transfer - restore original position
                        item.x = this.inventoryPickedOriginalX;
                        item.y = this.inventoryPickedOriginalY;
                        item.rotation = this.inventoryPickedOriginalRotation;

                        const structureName = nearestStructure.userData.modelType === 'garden' ? 'garden' : 'apple tree';
                        ui.updateStatus(`Cannot add items to ${structureName} - items spawn naturally`);
                        return; // Exit early, don't proceed with transfer
                    }

                    // Remove from backpack, add to crate
                    const itemIndex = this.gameState.inventory.items.indexOf(item);
                    if (itemIndex > -1) {
                        this.gameState.inventory.items.splice(itemIndex, 1);
                    }
                    this.crateInventory.items.push(item);
                }
                // Update position
                item.x = crateGridPos.x;
                item.y = crateGridPos.y;
            } else {
                // Invalid placement - restore original position
                item.x = this.inventoryPickedOriginalX;
                item.y = this.inventoryPickedOriginalY;
                item.rotation = this.inventoryPickedOriginalRotation;
            }
        } else {
            // Dropped outside - restore original position
            item.x = this.inventoryPickedOriginalX;
            item.y = this.inventoryPickedOriginalY;
            item.rotation = this.inventoryPickedOriginalRotation;
        }

        // Mark crate inventory as dirty (needs saving)
        if (this.gameState.nearestStructure) {
            this.gameState.nearestStructure.userData.inventoryDirty = true;
        }
    }

    _restoreItemPosition() {
        if (this.inventoryPickedItem) {
            this.inventoryPickedItem.x = this.inventoryPickedOriginalX;
            this.inventoryPickedItem.y = this.inventoryPickedOriginalY;
            this.inventoryPickedItem.rotation = this.inventoryPickedOriginalRotation;
        }
        this.inventoryPickedItem = null;
        this.inventoryPickedSource = null;
        this.inventoryPickedTarget = null;
        this.inventoryIgnoreNextMouseUp = false;
        this.chiselTarget = null;
        this._cleanupDragHandlers();
        this.renderInventory();
        if (this.gameState.nearestStructure) {
            this.renderCrateInventory();
        }
    }

    /**
     * Show coin transfer dialog when dragging coins to storage
     * @param {object} crateGridPos - Target position in crate grid
     */
    _showCoinTransferDialog(crateGridPos) {
        const coinItem = this.gameState.inventory.items.find(item => item.type === 'coin');
        if (!coinItem || !coinItem.quantity) return;

        const dialog = document.getElementById('coinTransferDialog');
        const currentSpan = document.getElementById('coinTransferCurrent');
        const maxSpan = document.getElementById('coinTransferMax');
        const input = document.getElementById('coinTransferInput');
        const errorElement = document.getElementById('coinTransferError');
        const confirmBtn = document.getElementById('coinTransferConfirm');
        const cancelBtn = document.getElementById('coinTransferCancel');

        // Set current values
        currentSpan.textContent = coinItem.quantity;
        maxSpan.textContent = `(Max: ${coinItem.quantity})`;
        input.max = coinItem.quantity;
        input.value = Math.min(1, coinItem.quantity);
        errorElement.style.display = 'none';

        // Show dialog
        dialog.style.display = 'flex';

        // Input validation
        const validateInput = () => {
            const amount = parseInt(input.value);
            if (isNaN(amount) || amount < 1) {
                errorElement.textContent = 'Amount must be at least 1';
                errorElement.style.display = 'block';
                confirmBtn.disabled = true;
                return false;
            }
            if (amount > coinItem.quantity) {
                errorElement.textContent = `You only have ${coinItem.quantity} coins`;
                errorElement.style.display = 'block';
                confirmBtn.disabled = true;
                return false;
            }
            errorElement.style.display = 'none';
            confirmBtn.disabled = false;
            return true;
        };

        input.addEventListener('input', validateInput);
        validateInput();

        // Cancel handler
        const onCancel = () => {
            dialog.style.display = 'none';
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            input.removeEventListener('input', validateInput);
        };

        // Confirm handler
        const onConfirm = () => {
            const amount = parseInt(input.value);
            if (!validateInput()) return;

            // Create coin item in crate
            const newCoinInCrate = {
                id: 'coin_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                type: 'coin',
                x: crateGridPos.x,
                y: crateGridPos.y,
                width: 1,
                height: 1,
                rotation: 0,
                quality: 100,
                durability: 100,
                quantity: amount
            };

            // Check if there's already a coin in crate - merge if so
            const existingCrateCoins = this.crateInventory.items.find(item => item.type === 'coin');
            if (existingCrateCoins) {
                existingCrateCoins.quantity = (existingCrateCoins.quantity || 0) + amount;
            } else {
                this.crateInventory.items.push(newCoinInCrate);
            }

            // Deduct from backpack
            coinItem.quantity -= amount;
            if (coinItem.quantity <= 0) {
                // Remove coin item from backpack
                const itemIndex = this.gameState.inventory.items.indexOf(coinItem);
                if (itemIndex > -1) {
                    this.gameState.inventory.items.splice(itemIndex, 1);
                }
            }

            // Mark crate inventory as dirty
            if (this.gameState.nearestStructure) {
                this.gameState.nearestStructure.userData.inventoryDirty = true;
            }

            // Close dialog
            dialog.style.display = 'none';
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            input.removeEventListener('input', validateInput);

            // Re-render inventories
            this.renderInventory();
            this.renderCrateInventory();

            // Show status
            this.updateStatus(`Transferred ${amount} coins to storage`);
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    }

    onInventoryKeyDown(event) {
        if (!this.inventoryPickedItem) return;

        if (event.key === 'r' || event.key === 'R') {
            event.preventDefault();

            const item = this.inventoryPickedItem;

            // Toggle rotation
            item.rotation = item.rotation === 0 ? 90 : 0;

            // Re-render to update ghost with new rotation
            this.renderInventory();
            // Also re-render crate if nearby (for crate mode)
            if (this.gameState.nearestStructure) {
                this.renderCrateInventory();
            }
        }
    }

    // ==========================================
    // DRAG AND DROP - CRATE
    // ==========================================

    onCrateItemMouseDown(event, item, itemWrapper) {
        event.stopPropagation();
        event.preventDefault();

        const crateItems = document.getElementById('crateItems');
        this._startItemDrag(item, 'crate', event, crateItems);
    }

    // ==========================================
    // CONSTRUCTION SECTION
    // ==========================================

    updateConstructionSection() {
        // Show/hide construction section based on proximity to construction site AND not moving
        const constructionSection = document.getElementById('constructionSection');
        if (!constructionSection) return;

        const shouldShow = this.gameState.nearestConstructionSite && !this.gameState.isMoving && this.gameState.inventoryOpen;

        if (shouldShow) {
            constructionSection.style.display = 'block';
            this.renderConstructionInventory();
        } else {
            constructionSection.style.display = 'none';
        }
    }

    _renderConstructionSlot(material, materialName, index, currentCount, materialItems) {
        const slot = document.createElement('div');
        slot.className = 'construction-slot';
        slot.dataset.material = material;
        slot.dataset.slotIndex = index;
        slot.style.position = 'relative';

        if (index < currentCount && materialItems[material][index]) {
            // Render actual item image for filled slots
            slot.classList.add('filled');

            const item = materialItems[material][index];
            const itemImg = document.createElement('img');
            itemImg.src = `./items/${item.type}.png`;
            itemImg.className = 'construction-item';
            itemImg.style.width = '60px';
            itemImg.style.height = '60px';
            itemImg.style.position = 'absolute';
            itemImg.style.top = '50%';
            itemImg.style.left = '50%';
            itemImg.style.transform = 'translate(-50%, -50%)';
            itemImg.style.objectFit = 'contain';
            itemImg.style.pointerEvents = 'none';
            slot.appendChild(itemImg);
        } else if (index < currentCount) {
            // Fallback to checkmark if no item data (for backwards compatibility)
            slot.classList.add('filled');
            slot.textContent = '✓';
            slot.style.fontSize = '24px';
            slot.style.color = '#6B7F5C';
            slot.style.display = 'flex';
            slot.style.alignItems = 'center';
            slot.style.justifyContent = 'center';
        }

        const label = document.createElement('div');
        label.className = 'construction-slot-label';
        label.textContent = materialName;
        label.style.position = 'absolute';
        label.style.top = '100%';  // Position below the slot
        label.style.left = '0';
        label.style.right = '0';
        label.style.textAlign = 'center';
        label.style.fontSize = '10px';
        label.style.pointerEvents = 'none';
        label.style.marginTop = '2px';  // Small gap between slot and label
        slot.appendChild(label);

        return slot;
    }

    renderConstructionInventory() {
        if (!this.gameState.nearestConstructionSite) return;

        const constructionSite = this.gameState.nearestConstructionSite;
        const requiredMaterials = constructionSite.userData.requiredMaterials || {};
        const currentMaterials = constructionSite.userData.materials || {};

        // Update building type display
        const buildingTypeEl = document.getElementById('constructionBuildingType');
        if (buildingTypeEl) {
            const targetStructure = constructionSite.userData.targetStructure || 'Unknown';
            buildingTypeEl.textContent = targetStructure.charAt(0).toUpperCase() + targetStructure.slice(1);
        }

        // Update requirements display
        const requirementsEl = document.getElementById('constructionRequirements');
        requirementsEl.innerHTML = '';
        for (const [material, quantity] of Object.entries(requiredMaterials)) {
            // For plank types, sum all plank types
            let current;
            if (isPlankType(material)) {
                current = getTotalPlankQuantity(currentMaterials);
            } else {
                current = currentMaterials[material] ? currentMaterials[material].quantity : 0;
            }

            const materialName = formatMaterialName(material);
            const div = document.createElement('div');
            div.textContent = `${materialName}: ${current}/${quantity}`;
            div.style.color = current >= quantity ? '#6B7F5C' : '#B8825C';
            requirementsEl.appendChild(div);
        }

        // Render material slots with visual item stacking
        const slotsContainer = document.getElementById('constructionSlots');
        slotsContainer.innerHTML = '';

        // Initialize materialItems if not present
        if (!constructionSite.userData.materialItems) {
            constructionSite.userData.materialItems = {};
        }
        const materialItems = constructionSite.userData.materialItems;

        for (const [material, quantity] of Object.entries(requiredMaterials)) {
            // For plank types, sum all plank types
            let current;
            if (isPlankType(material)) {
                current = getTotalPlankQuantity(currentMaterials);
            } else {
                current = currentMaterials[material] ? currentMaterials[material].quantity : 0;
            }

            const materialName = formatMaterialName(material);

            // Initialize array for this material if not present
            if (!materialItems[material]) {
                materialItems[material] = [];
            }

            for (let i = 0; i < quantity; i++) {
                const slot = this._renderConstructionSlot(material, materialName, i, current, materialItems);
                slotsContainer.appendChild(slot);
            }
        }

        // Check if all materials are satisfied
        const allMaterialsSatisfied = Object.entries(requiredMaterials).every(
            ([material, quantity]) => {
                // For plank types, check total of all plank types
                if (isPlankType(material)) {
                    return getTotalPlankQuantity(currentMaterials) >= quantity;
                }
                return (currentMaterials[material] ? currentMaterials[material].quantity : 0) >= quantity;
            }
        );

        // Enable/disable build button
        const buildBtn = document.getElementById('constructionBuildBtn');
        buildBtn.disabled = !allMaterialsSatisfied;
    }

    // ==========================================
    // CRATE SECTION
    // ==========================================

    updateCrateSection() {
        // Show/hide crate section based on proximity to crate AND not moving
        const crateSection = document.getElementById('crateSection');
        if (!crateSection) return;

        const shouldShow = this.gameState.nearestStructure &&
                           !this.gameState.isMoving &&
                           this.gameState.inventoryOpen &&
                           this.gameState.nearestStructure.userData?.modelType !== 'dock';

        if (shouldShow) {
            crateSection.style.display = 'block';

            // Update title based on structure type
            const crate = this.gameState.nearestStructure;
            const structureType = crate.userData.modelType;
            const titleElement = document.getElementById('crateTitle');
            if (titleElement) {
                const titleMap = {
                    'tent': 'Tent',
                    'crate': 'Crate',
                    'house': 'House',
                    'garden': 'Garden',
                    'apple': 'Apple Tree',
                    'market': 'Market',
                    'campfire': 'Campfire'
                };
                titleElement.textContent = titleMap[structureType] || 'Storage';
            }

            // Request crate inventory from server if not already loaded
            if (!crate.userData.inventory) {
                // Request inventory from server, including position data for apple trees
                this.networkManager.sendMessage('get_crate_inventory', {
                    crateId: crate.userData.objectId,
                    chunkId: `chunk_${crate.userData.chunkKey}`,
                    position: [crate.position.x, crate.position.y, crate.position.z],
                    scale: crate.scale?.x || 1,
                    rotation: crate.rotation?.y ? (crate.rotation.y * 180 / Math.PI) : 0
                });
            } else {
                // Inventory already loaded, just render it
                this.renderCrateInventory();
            }
        } else {
            crateSection.style.display = 'none';
        }
    }

    renderCrateInventory() {
        if (!this.gameState.nearestStructure) return;

        const crate = this.gameState.nearestStructure;
        const structureType = crate.userData.modelType;

        // Market uses special list view
        if (structureType === 'market') {
            this.renderMarketInventory();
            return;
        }

        // Initialize inventory if it doesn't exist and store it on the crate
        if (!crate.userData.inventory) {
            crate.userData.inventory = { items: [] };
        }
        const crateInventory = crate.userData.inventory;

        // Show grid, hide list (for non-market structures)
        const gridContainer = document.getElementById('crateGridContainer');
        const listContainer = document.getElementById('marketListContainer');
        if (gridContainer) gridContainer.style.display = 'block';
        if (listContainer) listContainer.style.display = 'none';

        // Render grid slots
        const crateGrid = document.getElementById('crateGrid');
        if (!crateGrid) return;

        // Use same slot size and gap as backpack inventory
        const { slotSize, gap } = this.gameState.inventory;

        // Get structure type and inventory size from config
        const structureProps = CONFIG.CONSTRUCTION.STRUCTURE_PROPERTIES[structureType];

        // Default to 10x10 if no specific size configured (crate, tent, etc.)
        const rows = structureProps?.inventorySize?.rows || 10;
        const cols = structureProps?.inventorySize?.cols || 10;

        // Update grid styling dynamically
        GridUIHelpers.applyGridStyling(crateGrid, rows, cols, slotSize, gap);

        // Handle scrollbar for large inventories (> 10 rows)
        const crateGridContainer = crateGrid.parentElement;
        const maxVisibleRows = 10; // Show max 10 rows at a time

        if (rows > maxVisibleRows) {
            // Large inventory - enable scrolling
            const visibleHeight = slotSize * maxVisibleRows + gap * (maxVisibleRows - 1) + 4;
            crateGridContainer.style.maxHeight = `${visibleHeight}px`;
            crateGridContainer.style.overflowY = 'auto';
            crateGrid.style.maxHeight = 'none'; // Remove maxHeight from grid itself
        } else {
            // Small inventory - no scrolling needed
            crateGridContainer.style.maxHeight = 'none';
            crateGridContainer.style.overflowY = 'visible';
            crateGrid.style.maxHeight = `${slotSize * rows + gap * (rows - 1) + 4}px`;
        }

        // Clear existing slots
        crateGrid.innerHTML = '';

        // Create grid slots based on structure's inventory size
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const slot = document.createElement('div');
                slot.className = 'crate-slot';
                slot.dataset.row = row;
                slot.dataset.col = col;
                slot.style.width = `${slotSize}px`;
                slot.style.height = `${slotSize}px`;
                crateGrid.appendChild(slot);
            }
        }

        // Render items
        const crateItems = document.getElementById('crateItems');
        if (!crateItems) return;

        crateItems.innerHTML = '';

        // Store reference to crate inventory for later use
        this.crateInventory = crateInventory;

        // Render each item
        for (const item of crateInventory.items) {
            this.renderCrateItem(item, crateItems);
        }

        // Render picked item as ghost following cursor (if target is crate)
        if (this.inventoryPickedItem && this.inventoryPickedTarget === 'crate') {
            this._renderGhostItem(this.inventoryPickedItem, crateItems, 'crate', this.inventoryMouseX, this.inventoryMouseY);
        }
    }

    renderMarketInventory() {
        const market = this.gameState.nearestStructure;
        if (!market) return;

        // Hide grid, show list
        const gridContainer = document.getElementById('crateGridContainer');
        const listContainer = document.getElementById('marketListContainer');
        if (gridContainer) gridContainer.style.display = 'none';
        if (!listContainer) return;
        listContainer.style.display = 'block';

        // Get market inventory (quantities stored as { itemType: quantity })
        const marketInventory = market.userData.inventory || { quantities: {}, qualityAverages: {}, durabilityAverages: {} };
        const quantities = marketInventory.quantities || {};
        const qualityAverages = marketInventory.qualityAverages || {};
        const durabilityAverages = marketInventory.durabilityAverages || {};

        // Get market prices from config
        const marketPrices = CONFIG.MARKET.PRICES;

        // Define tool types
        const toolTypes = ['axe', 'saw', 'pickaxe', 'hammer', 'chisel'];

        // Render market list
        const marketList = document.getElementById('marketList');
        if (!marketList) return;
        marketList.innerHTML = '';

        // Render each item type from config
        for (const [itemType, priceData] of Object.entries(marketPrices)) {
            const quantity = quantities[itemType] || 0;
            const quality = qualityAverages[itemType] || 50;
            const isTool = toolTypes.includes(itemType);

            // Calculate supply/demand multiplier based on quantity
            // Formula: 1 + ((maxQty - currentQty) / maxQty) * 0.5
            // When qty is high → multiplier near 1.0 (cheap)
            // When qty is low → multiplier up to 1.5 (expensive)
            const maxQty = priceData.maxQuantity;
            const supplyMultiplier = 1 + ((maxQty - quantity) / maxQty) * 0.5;

            // Calculate dynamic prices based on supply/demand and quality/durability
            let buyPrice, sellPrice;
            if (isTool) {
                const durability = Math.max(30, durabilityAverages[itemType] || 50); // Floor at 30
                const avgStat = (quality + durability) / 2;
                buyPrice = Math.floor(priceData.buyPrice * supplyMultiplier * (avgStat / 100));
                sellPrice = Math.floor(priceData.sellPrice * supplyMultiplier * (avgStat / 100));
            } else {
                buyPrice = Math.floor(priceData.buyPrice * supplyMultiplier * (quality / 100));
                sellPrice = Math.floor(priceData.sellPrice * supplyMultiplier * (quality / 100));
            }

            const row = document.createElement('div');
            row.className = 'market-list-item';
            row.dataset.itemType = itemType;
            row.dataset.buyPrice = buyPrice;
            row.dataset.sellPrice = sellPrice;
            row.dataset.quality = quality;
            if (isTool) {
                row.dataset.durability = durabilityAverages[itemType] || 50;
            }

            // Format item name (capitalize and add spaces)
            const itemName = itemType.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());

            // Show quality (and durability for tools) in name
            let nameDisplay = itemName;
            if (isTool) {
                const durability = Math.max(30, durabilityAverages[itemType] || 50);
                nameDisplay += ` (Q:${Math.floor(quality)} D:${Math.floor(durability)})`;
            } else {
                nameDisplay += ` (Q:${Math.floor(quality)})`;
            }

            row.innerHTML = `
                <div class="market-item-name">${nameDisplay}</div>
                <div class="market-item-buy">🪙 ${buyPrice}</div>
                <div class="market-item-sell">🪙 ${sellPrice}</div>
                <div class="market-item-qty">${quantity}</div>
            `;

            // Add click handler for buying
            row.addEventListener('click', () => {
                if (quantity > 0) {
                    this.showBuyDialog(itemType, buyPrice, quality, isTool ? durabilityAverages[itemType] : null, quantity);
                }
            });

            // Gray out if quantity is 0
            if (quantity === 0) {
                row.style.opacity = '0.5';
                row.style.cursor = 'not-allowed';
            } else {
                row.style.cursor = 'pointer';
            }

            marketList.appendChild(row);
        }
    }

    /**
     * Show buy dialog for purchasing items from market
     * @param {string} itemType - Type of item to buy
     * @param {number} unitPrice - Price per item
     * @param {number} quality - Item quality
     * @param {number|null} durability - Item durability (for tools)
     * @param {number} maxQuantity - Maximum available quantity
     */
    showBuyDialog(itemType, unitPrice, quality, durability, maxQuantity) {
        const dialog = document.getElementById('buyDialog');
        const titleElement = document.getElementById('buyDialogTitle');
        const priceElement = document.getElementById('buyDialogPrice');
        const quantityInput = document.getElementById('buyQuantityInput');
        const maxQtyElement = document.getElementById('buyDialogMaxQty');
        const totalPriceElement = document.getElementById('buyDialogTotalPrice');
        const errorElement = document.getElementById('buyDialogError');
        const confirmBtn = document.getElementById('buyDialogConfirm');
        const cancelBtn = document.getElementById('buyDialogCancel');

        if (!dialog) return;

        // Format item name
        const itemName = itemType.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());

        // Set dialog content
        titleElement.textContent = `Buy ${itemName}`;
        priceElement.textContent = unitPrice;
        quantityInput.value = 1;
        quantityInput.max = maxQuantity;
        maxQtyElement.textContent = `(Max: ${maxQuantity})`;

        // Calculate and display price breakdown
        const priceData = CONFIG.MARKET.PRICES[itemType];
        if (priceData) {
            const breakdownDiv = document.getElementById('buyPriceBreakdown');
            const basePrice = priceData.buyPrice;
            const maxQty = priceData.maxQuantity;

            // Calculate supply multiplier (same as in renderMarketInventory)
            const supplyMultiplier = 1 + ((maxQty - maxQuantity) / maxQty) * 0.5;

            // Calculate quality/durability multiplier
            const toolTypes = ['axe', 'saw', 'pickaxe', 'hammer', 'chisel'];
            const isTool = toolTypes.includes(itemType);
            let qualityMultiplier;
            if (isTool && durability !== null) {
                const avgStat = (quality + durability) / 2;
                qualityMultiplier = avgStat / 100;
            } else {
                qualityMultiplier = quality / 100;
            }

            // Calculate intermediate price
            const afterSupply = basePrice * supplyMultiplier;

            // Update breakdown display
            document.getElementById('buyDialogBasePrice').textContent = `🪙${basePrice}`;
            document.getElementById('buyDialogSupply').textContent = `×${supplyMultiplier.toFixed(2)} = 🪙${Math.floor(afterSupply)}`;

            // Calculate percentage change for quality modifier
            const percentChange = ((qualityMultiplier - 1) * 100).toFixed(0);
            const percentDisplay = percentChange >= 0 ? `+${percentChange}%` : `${percentChange}%`;
            document.getElementById('buyDialogQuality').textContent = `${percentDisplay} = 🪙${unitPrice}`;

            breakdownDiv.style.display = '';
        }

        // Store purchase data
        this.currentPurchase = {
            itemType,
            unitPrice,
            quality,
            durability,
            maxQuantity
        };

        // Update total price and validation
        const updateDialog = () => {
            const quantity = parseInt(quantityInput.value) || 0;
            const totalCost = unitPrice * quantity;
            totalPriceElement.textContent = totalCost;

            // Validate purchase
            errorElement.style.display = 'none';
            errorElement.textContent = '';
            confirmBtn.disabled = false;

            // Check quantity bounds
            if (quantity < 1 || quantity > maxQuantity) {
                errorElement.textContent = `Quantity must be between 1 and ${maxQuantity}`;
                errorElement.style.display = 'block';
                confirmBtn.disabled = true;
                return;
            }

            // Check coins
            const playerCoins = this.game.playerInventory.getTotalCoins();
            if (totalCost > playerCoins) {
                errorElement.textContent = `Not enough coins! (Need ${totalCost}, have ${playerCoins})`;
                errorElement.style.display = 'block';
                confirmBtn.disabled = true;
                return;
            }

            // Check inventory space
            const spaceNeeded = this.calculateInventorySpaceNeeded(itemType, quantity);
            if (!this.hasInventorySpace(spaceNeeded)) {
                errorElement.textContent = `Not enough inventory space! (Need ${spaceNeeded} slots)`;
                errorElement.style.display = 'block';
                confirmBtn.disabled = true;
                return;
            }
        };

        // Initial validation
        updateDialog();

        // Update on quantity change
        quantityInput.oninput = updateDialog;

        // Handle confirm
        confirmBtn.onclick = () => {
            const quantity = parseInt(quantityInput.value) || 0;
            this.executeBuyTransaction(itemType, quantity, unitPrice, quality, durability);
            dialog.style.display = 'none';
        };

        // Handle cancel
        cancelBtn.onclick = () => {
            dialog.style.display = 'none';
        };

        // Show dialog
        dialog.style.display = 'flex';
    }

    /**
     * Calculate how many inventory slots are needed for N items
     * @param {string} itemType - Type of item
     * @param {number} quantity - Number of items
     * @returns {number} Number of slots needed
     */
    calculateInventorySpaceNeeded(itemType, quantity) {
        // Get item size
        const { width, height } = this.getItemSize(itemType);
        return quantity * (width * height);
    }

    /**
     * Get item size (width x height)
     * @param {string} itemType - Type of item
     * @returns {object} {width, height}
     */
    getItemSize(itemType) {
        // Define tool types
        const largeTools = ['axe', 'saw', 'pickaxe']; // 2x5
        const smallTools = ['hammer', 'chisel']; // 1x2
        const mediumTools = ['fishingnet']; // 2x2

        // Define material types
        const woodMaterials = [
            'oakplank', 'pineplank', 'firplank', 'cypressplank',
            'oakfirewood', 'pinefirewood', 'firfirewood', 'cypressfirewood'
        ]; // 2x4
        const stoneMaterials = ['limestone', 'sandstone', 'chiseledlimestone', 'chiseledsandstone', 'clay']; // 1x1

        // Define food types
        const foodItems = ['apple', 'vegetables', 'fish', 'cookedfish', 'cookedmeat']; // 1x1

        if (largeTools.includes(itemType)) {
            return { width: 2, height: 5 };
        } else if (smallTools.includes(itemType)) {
            return { width: 1, height: 2 };
        } else if (mediumTools.includes(itemType)) {
            return { width: 2, height: 2 };
        } else if (woodMaterials.includes(itemType)) {
            return { width: 2, height: 4 };
        } else if (stoneMaterials.includes(itemType)) {
            return { width: 1, height: 1 };
        } else if (foodItems.includes(itemType)) {
            return { width: 1, height: 1 };
        } else {
            // Default to 1x1 for unknown items
            console.warn(`Unknown item type ${itemType}, defaulting to 1x1`);
            return { width: 1, height: 1 };
        }
    }

    /**
     * Check if inventory has enough empty space
     * @param {number} slotsNeeded - Number of slots required
     * @returns {boolean} True if enough space
     */
    hasInventorySpace(slotsNeeded) {
        const totalSlots = this.gameState.inventory.rows * this.gameState.inventory.cols;
        const usedSlots = this.calculateUsedSlots();
        const freeSlots = totalSlots - usedSlots;
        return freeSlots >= slotsNeeded;
    }

    /**
     * Calculate how many slots are currently used in inventory
     * @returns {number} Number of occupied slots
     */
    calculateUsedSlots() {
        let usedSlots = 0;
        for (const item of this.gameState.inventory.items) {
            usedSlots += item.width * item.height;
        }
        return usedSlots;
    }

    /**
     * Execute buy transaction
     * @param {string} itemType - Type of item
     * @param {number} quantity - Number to buy
     * @param {number} unitPrice - Price per item
     * @param {number} quality - Item quality
     * @param {number|null} durability - Item durability (for tools)
     */
    executeBuyTransaction(itemType, quantity, unitPrice, quality, durability) {
        const totalCost = unitPrice * quantity;

        // Deduct coins
        this.game.playerInventory.removeCoins(totalCost);

        // Get item size
        const { width, height } = this.getItemSize(itemType);

        // Check if this is a tool (has durability)
        const toolTypes = ['axe', 'saw', 'pickaxe', 'hammer', 'chisel'];
        const isTool = toolTypes.includes(itemType);

        // Check if this is food (has base durability system)
        const foodTypes = {
            'apple': 10,
            'vegetables': 20,
            'cookedfish': 30,
            'cookedmeat': 40
        };
        const isFood = foodTypes[itemType] !== undefined;

        // Add items to inventory
        for (let i = 0; i < quantity; i++) {
            // Find empty position
            const position = this.findEmptyInventoryPosition(width, height);
            if (!position) {
                console.error('No space for item (this should have been validated)');
                continue;
            }

            // Calculate durability based on item type
            let itemDurability;
            if (isTool) {
                // Tools use market's durability average (floored at 30)
                itemDurability = Math.floor(Math.max(30, durability));
            } else if (isFood) {
                // Food uses base durability scaled by market quality
                const baseDurability = foodTypes[itemType];
                itemDurability = Math.round(baseDurability * (quality / 100));
            } else {
                // Materials get 100 durability (or undefined)
                itemDurability = 100;
            }

            // Create new item
            const newItem = {
                id: `bought_${itemType}_${Date.now()}_${i}`,
                type: itemType,
                x: position.x,
                y: position.y,
                width: width,
                height: height,
                rotation: 0,
                quality: Math.floor(quality),
                durability: itemDurability
            };

            this.gameState.inventory.items.push(newItem);
        }

        // Send message to server to update market quantities
        const market = this.gameState.nearestStructure;
        if (market) {
            this.networkManager.sendMessage('buy_item', {
                marketId: market.userData.objectId,
                chunkId: `chunk_${market.userData.chunkKey}`,
                itemType,
                quantity
            });
        }

        // Refresh inventory display
        this.renderInventory();
        this.renderMarketInventory();

        // Show status message
        ui.updateStatus(`Bought ${quantity}x ${itemType} for 🪙${totalCost}`);
    }

    /**
     * Execute sell transaction - sell item from backpack to market
     * @param {object} item - Item to sell
     */
    _executeSellTransaction(item) {
        const itemType = item.type;
        const marketPrices = CONFIG.MARKET.PRICES;
        const priceData = marketPrices[itemType];

        if (!priceData) {
            console.error(`No price data for ${itemType}`);
            return;
        }

        // Get current market quantity for supply/demand calculation
        const market = this.gameState.nearestStructure;
        const marketInventory = market.userData.inventory || { quantities: {} };
        const currentQuantity = marketInventory.quantities[itemType] || 0;
        const maxQty = priceData.maxQuantity;
        const supplyMultiplier = 1 + ((maxQty - currentQuantity) / maxQty) * 0.5;

        // Calculate sell price based on supply/demand and item's actual quality/durability
        const toolTypes = ['axe', 'saw', 'pickaxe', 'hammer', 'chisel'];
        const isTool = toolTypes.includes(itemType);

        let sellPrice;
        if (isTool) {
            const quality = item.quality || 50;
            const durability = item.durability || 50;
            const avgStat = (quality + durability) / 2;
            sellPrice = Math.floor(priceData.sellPrice * supplyMultiplier * (avgStat / 100));
        } else {
            const quality = item.quality || 50;
            sellPrice = Math.floor(priceData.sellPrice * supplyMultiplier * (quality / 100));
        }

        // Add coins to player
        this.game.playerInventory.addCoins(sellPrice);

        // Remove item from backpack
        const itemIndex = this.gameState.inventory.items.indexOf(item);
        if (itemIndex > -1) {
            this.gameState.inventory.items.splice(itemIndex, 1);
        }

        // Send to server to update market quantities and averages
        if (market) {
            this.networkManager.sendMessage('sell_item', {
                marketId: market.userData.objectId,
                chunkId: `chunk_${market.userData.chunkKey}`,
                itemType,
                quality: item.quality || 50,
                durability: isTool ? (item.durability || 50) : null
            });
        }

        // Show status message
        if (isTool) {
            ui.updateStatus(`Sold ${itemType} (Q:${Math.floor(item.quality)} D:${Math.floor(item.durability)}) for 🪙${sellPrice}`);
        } else {
            ui.updateStatus(`Sold ${itemType} (Q:${Math.floor(item.quality)}) for 🪙${sellPrice}`);
        }
    }

    /**
     * Find empty position in inventory for an item
     * @param {number} width - Item width
     * @param {number} height - Item height
     * @returns {object|null} {x, y} position or null if no space
     */
    findEmptyInventoryPosition(width, height) {
        const { rows, cols } = this.gameState.inventory;

        for (let y = 0; y <= rows - height; y++) {
            for (let x = 0; x <= cols - width; x++) {
                if (this.isInventoryPositionEmpty(x, y, width, height)) {
                    return { x, y };
                }
            }
        }
        return null;
    }

    /**
     * Check if a position in inventory is empty
     * @param {number} x - X position
     * @param {number} y - Y position
     * @param {number} width - Item width
     * @param {number} height - Item height
     * @returns {boolean} True if position is empty
     */
    isInventoryPositionEmpty(x, y, width, height) {
        for (const item of this.gameState.inventory.items) {
            // Check if items overlap
            if (!(x >= item.x + item.width ||
                  x + width <= item.x ||
                  y >= item.y + item.height ||
                  y + height <= item.y)) {
                return false; // Overlaps with existing item
            }
        }
        return true; // No overlap, position is empty
    }

    renderBackpackItem(item, container) {
        // Skip rendering picked item in its grid position - will render as ghost
        if (this.inventoryPickedItem && item === this.inventoryPickedItem) {
            return;
        }

        const { slotSize, gap } = this.gameState.inventory;

        // Create container wrapper for image + discard button
        const itemWrapper = document.createElement('div');
        itemWrapper.className = 'inventory-item-wrapper';

        // Add chisel-target class if this is the target stone
        if (this.chiselTarget && item.id === this.chiselTarget.id) {
            itemWrapper.classList.add('chisel-target');
        }

        // Add combine-target class if this is the target for combining
        if (this.combineTarget && item.id === this.combineTarget.id) {
            itemWrapper.classList.add('chisel-target'); // Reuse same glow style
        }

        itemWrapper.dataset.itemId = item.id;
        itemWrapper.style.position = 'absolute';

        // Calculate pixel position (upper-left anchor)
        const pixelPos = this.gridToPixel(item.x, item.y);
        itemWrapper.style.left = pixelPos.x + 'px';
        itemWrapper.style.top = pixelPos.y + 'px';

        // Create image element
        const itemEl = document.createElement('img');

        // Use rotated image file when rotation is 90
        if (item.rotation === 90) {
            itemEl.src = `./items/R${item.type}.png`;
        } else {
            itemEl.src = `./items/${item.type}.png`;
        }

        itemEl.className = 'inventory-item';
        itemEl.style.position = 'relative';

        // Calculate size based on slots (swap dimensions when rotated)
        const displayWidth = item.rotation === 90 ? item.height : item.width;
        const displayHeight = item.rotation === 90 ? item.width : item.height;

        const { widthPx, heightPx } = GridUIHelpers.calculateItemSize(displayWidth, displayHeight, slotSize, gap);

        itemEl.style.width = widthPx + 'px';
        itemEl.style.height = heightPx + 'px';
        itemWrapper.style.width = widthPx + 'px';
        itemWrapper.style.height = heightPx + 'px';

        // Create discard button (X in upper right)
        const discardBtn = document.createElement('div');
        discardBtn.className = 'item-discard-btn';
        discardBtn.textContent = '✕';
        discardBtn.dataset.itemId = item.id;

        // Scale discard button with slot size
        const btnSize = Math.max(16, Math.floor(slotSize / 3)); // Min 16px, scales with slot
        const btnOffset = Math.max(2, Math.floor(slotSize / 30)); // Offset from corner
        discardBtn.style.width = btnSize + 'px';
        discardBtn.style.height = btnSize + 'px';
        discardBtn.style.fontSize = Math.max(12, Math.floor(btnSize * 0.7)) + 'px';
        discardBtn.style.top = btnOffset + 'px';
        discardBtn.style.right = btnOffset + 'px';

        // Add discard button event listeners
        discardBtn.addEventListener('mouseenter', (e) => {
            e.stopPropagation();
            this.showDiscardTooltip(e);
        });
        discardBtn.addEventListener('mousemove', (e) => {
            e.stopPropagation();
            this.updateTooltipPosition(e);
        });
        discardBtn.addEventListener('mouseleave', (e) => {
            e.stopPropagation();
            this.hideDiscardTooltip();
        });
        discardBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.showDiscardConfirmation(item);
        });

        // Prevent dragging when clicking discard button
        discardBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });

        // Add drag event listener to wrapper
        itemWrapper.addEventListener('mousedown', (e) => this.onItemMouseDown(e, item, itemWrapper));

        // Add hover event listeners for tooltip to wrapper
        itemWrapper.addEventListener('mouseenter', (e) => this.showTooltip(e, item));
        itemWrapper.addEventListener('mousemove', (e) => this.updateTooltipPosition(e));
        itemWrapper.addEventListener('mouseleave', () => this.hideTooltip());

        // Assemble: image and discard button into wrapper
        itemWrapper.appendChild(itemEl);
        itemWrapper.appendChild(discardBtn);

        // Add quantity display for coins (must be after image to appear on top)
        if (item.type === 'coin' && item.quantity) {
            const quantityLabel = document.createElement('div');
            quantityLabel.className = 'item-quantity-label';
            quantityLabel.textContent = `×${item.quantity}`;
            quantityLabel.style.position = 'absolute';
            quantityLabel.style.bottom = '4px';
            quantityLabel.style.right = '4px';
            quantityLabel.style.background = 'transparent';
            quantityLabel.style.color = 'white';
            quantityLabel.style.padding = '2px 6px';
            quantityLabel.style.borderRadius = '4px';
            quantityLabel.style.fontSize = '12px';
            quantityLabel.style.fontWeight = 'bold';
            quantityLabel.style.pointerEvents = 'none';
            quantityLabel.style.textShadow = '1px 1px 2px black, -1px -1px 2px black, 1px -1px 2px black, -1px 1px 2px black';
            itemWrapper.appendChild(quantityLabel);
        }

        container.appendChild(itemWrapper);
    }

    renderCrateItem(item, container) {
        // Skip rendering picked item in its grid position - will render as ghost
        // Use object reference comparison to identify the exact picked item
        if (this.inventoryPickedItem && item === this.inventoryPickedItem) {
            return;
        }

        const itemWrapper = document.createElement('div');
        itemWrapper.className = 'crate-item-wrapper';
        itemWrapper.dataset.itemId = item.id || `${item.type}_${Math.random()}`;
        itemWrapper.style.position = 'absolute';

        // Use same slot size and gap as backpack inventory
        const slotSize = this.gameState.inventory.slotSize;
        const gap = this.gameState.inventory.gap;

        // Set position and size based on item grid position (same calculation as backpack)
        itemWrapper.style.left = `${item.x * (slotSize + gap)}px`;
        itemWrapper.style.top = `${item.y * (slotSize + gap)}px`;

        // Create image element
        const itemEl = document.createElement('img');
        if (item.rotation === 90) {
            itemEl.src = `./items/R${item.type}.png`;
        } else {
            itemEl.src = `./items/${item.type}.png`;
        }
        itemEl.className = 'crate-item';
        itemEl.style.position = 'relative';

        // Calculate size based on slots (swap dimensions when rotated)
        const displayWidth = item.rotation === 90 ? item.height : item.width;
        const displayHeight = item.rotation === 90 ? item.width : item.height;
        const widthPx = displayWidth * slotSize + (displayWidth - 1) * gap;
        const heightPx = displayHeight * slotSize + (displayHeight - 1) * gap;

        itemEl.style.width = widthPx + 'px';
        itemEl.style.height = heightPx + 'px';
        itemWrapper.style.width = widthPx + 'px';
        itemWrapper.style.height = heightPx + 'px';

        // Add drag event listener to wrapper
        itemWrapper.addEventListener('mousedown', (e) => this.onCrateItemMouseDown(e, item, itemWrapper));

        // Add hover event listeners for tooltip
        itemWrapper.addEventListener('mouseenter', (e) => this.showTooltip(e, item));
        itemWrapper.addEventListener('mousemove', (e) => this.updateTooltipPosition(e));
        itemWrapper.addEventListener('mouseleave', () => this.hideTooltip());

        itemWrapper.appendChild(itemEl);

        // Add quantity display for coins in crate (must be after image to appear on top)
        if (item.type === 'coin' && item.quantity) {
            const quantityLabel = document.createElement('div');
            quantityLabel.className = 'item-quantity-label';
            quantityLabel.textContent = `×${item.quantity}`;
            quantityLabel.style.position = 'absolute';
            quantityLabel.style.bottom = '4px';
            quantityLabel.style.right = '4px';
            quantityLabel.style.background = 'transparent';
            quantityLabel.style.color = 'white';
            quantityLabel.style.padding = '2px 6px';
            quantityLabel.style.borderRadius = '4px';
            quantityLabel.style.fontSize = '12px';
            quantityLabel.style.fontWeight = 'bold';
            quantityLabel.style.pointerEvents = 'none';
            quantityLabel.style.textShadow = '1px 1px 2px black, -1px -1px 2px black, 1px -1px 2px black, -1px 1px 2px black';
            itemWrapper.appendChild(quantityLabel);
        }

        container.appendChild(itemWrapper);
    }

    // ==========================================
    // PUBLIC API - Called by game.js
    // ==========================================

    // Called when escape is pressed in game
    cancelInventoryDrag() {
        if (this.inventoryPickedItem) {
            this.inventoryPickedItem.x = this.inventoryPickedOriginalX;
            this.inventoryPickedItem.y = this.inventoryPickedOriginalY;
            this.inventoryPickedItem.rotation = this.inventoryPickedOriginalRotation;
        }

        this.inventoryPickedItem = null;
        this.inventoryPickedSource = null;
        this.inventoryPickedTarget = null;
        this.inventoryIgnoreNextMouseUp = false;
        this.chiselTarget = null;

        this._cleanupDragHandlers();

        this.renderInventory();
        if (this.gameState.nearestStructure) {
            this.renderCrateInventory();
        }
    }

    // Called when window is resized
    handleResize() {
        if (this.gameState.inventoryOpen) {
            this.calculateInventorySize();
        }
    }

    // Called when inventory needs to be updated (e.g., after receiving items)
    refresh() {
        if (this.gameState.inventoryOpen) {
            this.renderInventory();
            this.updateConstructionSection();
            this.updateCrateSection();
        }
    }

    // Check if inventory is currently dragging an item
    isDragging() {
        return this.inventoryPickedItem !== null;
    }

    // Get the currently held item
    getPickedItem() {
        return this.inventoryPickedItem;
    }
}

// File: public/ui/InventoryUI.js
// Complete Inventory UI Module - Fully extracted from game.js
// Handles all inventory rendering, drag-and-drop, chisel targeting, and crate management

import { CONFIG } from '../config.js';
import { ui } from '../ui.js';
import { GridUIHelpers } from './GridUIHelpers.js';
import { isPlankType, getTotalPlankQuantity, isChiseledStone, getTotalChiseledStoneQuantity, formatMaterialName, getItemDisplayName, getItemSize } from './InventoryHelpers.js';
import { MarketUI } from './MarketUI.js';
import { ConstructionUI } from './ConstructionUI.js';
import { CrateInventoryUI } from './CrateInventoryUI.js';
import { InventoryTooltipUI } from './InventoryTooltipUI.js';

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

        // Double-click detection for bulk transfer
        this._lastClickTime = 0;
        this._lastClickItemId = null;

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
        this.wheelHandler = null;

        // Callbacks that will be set by game
        this.onChiselingStart = null;
        this.onItemCombine = null;
        this.onConstructionMaterialAdded = null;

        // Debounce timers for performance
        this.saveDebounceTimer = null;
        this.renderDebounceTimer = null;
        this.onInventoryClosed = null;
        this.onProximityCheck = null;

        // External system references
        this.craftingSystem = null;

        // Render debouncing to prevent rapid re-renders
        this.pendingCrateRender = null; // Timeout ID for debounced crate render

        // Delegated UI classes
        this.marketUI = new MarketUI(this);
        this.constructionUI = new ConstructionUI(this);
        this.crateUI = new CrateInventoryUI(this);
        this.tooltipUI = new InventoryTooltipUI(this);

        // Event delegation initialized flag
        this._eventDelegationInit = false;

        // DOM element caching for ISSUE-095 optimization
        // Maps itemId -> { wrapper, img, label } for backpack items
        this._backpackElements = new Map();
        // Cached sling slot elements
        this._slingElements = null;
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
            const itemId = modal.dataset.itemId;
            const itemSource = modal.dataset.itemSource;

            // If this was from a drag-drop operation, restore item position
            if (itemSource) {
                if (itemSource === 'sling') {
                    // Sling item stays in sling - nothing to restore
                } else {
                    const inventory = itemSource === 'crate' ? this.crateInventory : this.gameState.inventory;
                    const item = inventory.items.find(item => item.id === itemId);

                    if (item && modal.dataset.originalX) {
                        item.x = parseInt(modal.dataset.originalX);
                        item.y = parseInt(modal.dataset.originalY);
                        item.rotation = parseInt(modal.dataset.originalRotation);
                    }
                }

                // Clear picked item state
                this.inventoryPickedItem = null;
                this.inventoryPickedSource = null;
                this.inventoryPickedTarget = null;

                // Re-render inventories
                this.renderInventory();
                if (this.gameState.nearestStructure) {
                    this.crateUI.renderCrateInventory();
                }
            }

            modal.style.display = 'none';
        });

        document.getElementById('discardConfirm').addEventListener('click', () => {
            const modal = document.getElementById('discardModal');
            const itemId = modal.dataset.itemId;
            const itemSource = modal.dataset.itemSource;

            // Determine which inventory to remove from
            if (itemSource === 'crate') {
                // Remove from crate inventory
                const itemIndex = this.crateInventory.items.findIndex(item => item.id === itemId);
                if (itemIndex !== -1) {
                    this.crateInventory.items.splice(itemIndex, 1);
                }
                // Immediate save
                this.saveCrateInventory();
            } else if (itemSource === 'sling') {
                // Remove from sling
                this.gameState.slingItem = null;
            } else {
                // Remove from backpack (default)
                const itemIndex = this.gameState.inventory.items.findIndex(item => item.id === itemId);
                if (itemIndex !== -1) {
                    this.gameState.inventory.items.splice(itemIndex, 1);
                    this.gameState.markInventoryDirty();
                }
            }

            // Clear picked item state if in drag operation
            if (itemSource) {
                this.inventoryPickedItem = null;
                this.inventoryPickedSource = null;
                this.inventoryPickedTarget = null;
            }

            // Hide modal and re-render inventory
            modal.style.display = 'none';
            this.renderInventory();
            if (this.gameState.nearestStructure) {
                this.crateUI.renderCrateInventory();
            }

            // Re-check proximity to update button states (in case they discarded a required tool)
            if (this.onProximityCheck) {
                this.onProximityCheck();
            }
        });

        // Market sort toggle event listeners
        const sortBestBtn = document.getElementById('marketSortBest');
        const sortCheapBtn = document.getElementById('marketSortCheap');
        if (sortBestBtn) {
            sortBestBtn.addEventListener('click', () => {
                this.marketUI.marketSortMode = 'best';
                sortBestBtn.classList.add('active');
                sortCheapBtn.classList.remove('active');
                this.marketUI.renderMarketInventory();
            });
        }
        if (sortCheapBtn) {
            sortCheapBtn.addEventListener('click', () => {
                this.marketUI.marketSortMode = 'cheap';
                sortCheapBtn.classList.add('active');
                sortBestBtn.classList.remove('active');
                this.marketUI.renderMarketInventory();
            });
        }

        // Market confirmation dialog event listeners
        const confirmCancel = document.getElementById('marketConfirmCancel');
        const confirmOk = document.getElementById('marketConfirmOk');
        if (confirmCancel) {
            confirmCancel.addEventListener('click', () => {
                document.getElementById('marketConfirmDialog').style.display = 'none';
                this.marketUI.pendingTransaction = null;
            });
        }
        if (confirmOk) {
            confirmOk.addEventListener('click', () => {
                if (this.marketUI.pendingTransaction) {
                    // Store for repeat-action focus
                    this.marketUI.repeatActionType = this.marketUI.pendingTransaction.type;
                    this.marketUI.repeatActionItemType = this.marketUI.pendingTransaction.itemType;

                    this.marketUI.executeMarketTransaction(this.marketUI.pendingTransaction);
                }
                document.getElementById('marketConfirmDialog').style.display = 'none';
                this.marketUI.pendingTransaction = null;
            });
        }

        // Initialize market event delegation (handlers on stable container)
        this.marketUI.initializeEventDelegation();

        // Initialize inventory event delegation (fixes ISSUE-094: event listener accumulation)
        this.initializeEventDelegation();

        // Render initial items
        this.renderInventory();
    }

    calculateInventorySize() {
        const { slotSize, gap } = GridUIHelpers.calculateGridSize(this.gameState.inventory.rows);
        this.gameState.inventory.slotSize = slotSize;
        this.gameState.inventory.gap = gap;
    }

    /**
     * Initialize event delegation on inventory containers.
     * Called ONCE during initialization - fixes ISSUE-094 (event listener accumulation).
     * Handlers attached here survive DOM updates inside containers.
     */
    initializeEventDelegation() {
        if (this._eventDelegationInit) return;
        this._eventDelegationInit = true;

        // === BACKPACK ITEMS EVENT DELEGATION ===
        const itemsContainer = document.getElementById('inventoryItems');
        if (itemsContainer) {
            // Mousedown delegation for dragging
            itemsContainer.addEventListener('mousedown', (e) => {
                const wrapper = e.target.closest('.inventory-item-wrapper');
                if (!wrapper) return;

                const itemId = wrapper.dataset.itemId;
                if (!itemId) return;

                const item = this.gameState.inventory.items.find(i => i.id === itemId);
                if (item) {
                    this.onItemMouseDown(e, item, wrapper);
                }
            });

            // Tooltip delegation - mouseenter (capture phase for reliability)
            itemsContainer.addEventListener('mouseenter', (e) => {
                const wrapper = e.target.closest('.inventory-item-wrapper');
                if (!wrapper || this.inventoryPickedItem) return;

                const itemId = wrapper.dataset.itemId;
                if (!itemId) return;

                const item = this.gameState.inventory.items.find(i => i.id === itemId);
                if (item) {
                    this.tooltipUI.showTooltip(e, item);
                }
            }, true);

            // Tooltip delegation - mousemove (capture phase)
            itemsContainer.addEventListener('mousemove', (e) => {
                const wrapper = e.target.closest('.inventory-item-wrapper');
                if (!wrapper || this.inventoryPickedItem) return;

                this.tooltipUI.updateTooltipPosition(e);
            }, true);

            // Tooltip delegation - mouseleave (capture phase)
            itemsContainer.addEventListener('mouseleave', (e) => {
                if (e.target.closest('.inventory-item-wrapper')) {
                    this.tooltipUI.hideTooltip();
                }
            }, true);
        }

        // === SLING SLOT EVENT DELEGATION ===
        const slingSlot = document.getElementById('slingSlot');
        if (slingSlot) {
            // Mousedown delegation for dragging from sling
            slingSlot.addEventListener('mousedown', (e) => {
                const slingItem = e.target.closest('#slingItem');
                if (!slingItem) return;

                const item = this.gameState.slingItem;
                if (item) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.onSlingItemMouseDown(e, item);
                }
            });

            // Tooltip delegation - mouseenter
            slingSlot.addEventListener('mouseenter', (e) => {
                const slingItem = e.target.closest('#slingItem');
                if (!slingItem || this.inventoryPickedItem) return;

                const item = this.gameState.slingItem;
                if (item) {
                    this.tooltipUI.showTooltip(e, item);
                }
            }, true);

            // Tooltip delegation - mousemove
            slingSlot.addEventListener('mousemove', (e) => {
                const slingItem = e.target.closest('#slingItem');
                if (!slingItem || this.inventoryPickedItem) return;

                this.tooltipUI.updateTooltipPosition(e);
            }, true);

            // Tooltip delegation - mouseleave
            slingSlot.addEventListener('mouseleave', (e) => {
                if (e.target.closest('#slingItem')) {
                    this.tooltipUI.hideTooltip();
                }
            }, true);
        }

        // === CRATE ITEMS EVENT DELEGATION ===
        this.crateUI.initializeEventDelegation();
    }

    /**
     * Check if the current player owns a house structure
     * @param {Object} structure - The structure object to check
     * @returns {boolean} True if the player owns the house, false otherwise
     */
    isHouseOwner(structure) {
        if (!structure || structure.userData.modelType !== 'house') {
            return true; // Not a house, no ownership check needed
        }

        const owner = structure.userData.owner;
        if (!owner) {
            return true; // No owner set, allow access (backward compatibility)
        }

        const currentClientId = this.gameState.clientId;
        const currentAccountId = this.gameState.accountId;

        // Check both session ID and account ID
        return owner === currentClientId || owner === currentAccountId;
    }

    // ==========================================
    // INVENTORY TOGGLE
    // ==========================================

    toggleInventory(targetStructureId = null) {
        // If a target structure ID was passed (from the button's stored reference),
        // look it up from the object registry to prevent race conditions when
        // multiple players are near the same structures
        let targetStructure = null;
        if (targetStructureId && this.game?.objectRegistry) {
            targetStructure = this.game.objectRegistry.get(targetStructureId);
        }

        // Fall back to nearestStructure if no target specified or not found
        const structureToOpen = targetStructure || this.gameState.nearestStructure;

        // Check if trying to open inventory near a non-owned house
        if (!this.gameState.inventoryOpen && structureToOpen) {
            if (!this.isHouseOwner(structureToOpen)) {
                // Trying to open inventory near a non-owned house - block it
                ui.updateStatus('Cannot access - not your house');
                return;
            }
        }

        this.gameState.inventoryOpen = !this.gameState.inventoryOpen;
        const overlay = document.getElementById('inventoryOverlay');

        if (this.gameState.inventoryOpen) {
            // Cancel auto-run when opening inventory
            this.game?.inputManager?.cancelAutoRun();
            this.calculateInventorySize(); // Recalculate on open
            overlay.style.display = 'flex';
            this.renderInventory();
            this.constructionUI.updateConstructionSection(); // Show/hide construction section based on proximity
            this.crateUI.updateCrateSection(structureToOpen); // Pass the target structure to prevent race conditions
            // Notify tasks panel that inventory was opened
            window.tasksPanel?.onInventoryOpened();
        } else {
            overlay.style.display = 'none';

            // Hide any visible tooltip
            this.tooltipUI.hideTooltip();

            // Clear repeat-action focus state when market closes
            this.marketUI.repeatActionType = null;
            this.marketUI.repeatActionItemType = null;

            // Clear any active drag state to prevent ghost items
            if (this.inventoryPickedItem) {
                this._cleanupDragHandlers();
                this.inventoryPickedItem = null;
                this.inventoryPickedSource = null;
                this.inventoryPickedTarget = null;
                document.querySelectorAll('.inventory-item-wrapper.dragging, .crate-item-wrapper.dragging').forEach(el => el.remove());
            }

            // Save immediately before closing (flush any pending debounced saves)
            // Skip construction sites - they use their own material system
            if (this.crateInventory && this.gameState.nearestStructure &&
                !this.gameState.nearestStructure.userData?.isConstructionSite) {
                this.saveCrateInventory(true); // immediate = true
            }

            // Release any inventory lock we're holding
            this.crateUI.releaseLock();

            // Call callback if inventory was closed
            if (this.onInventoryClosed) {
                this.onInventoryClosed();
            }
        }
    }

    /**
     * Close just the crate inventory section (used when lock is lost)
     */
    closeCrateInventory() {
        const crateSection = document.getElementById('crateSection');
        if (crateSection) {
            crateSection.style.display = 'none';
        }

        // Clear any active drag state to prevent ghost items
        if (this.inventoryPickedItem) {
            this._cleanupDragHandlers();
            this.inventoryPickedItem = null;
            this.inventoryPickedSource = null;
            this.inventoryPickedTarget = null;

            // Remove any ghost elements from the DOM
            document.querySelectorAll('.inventory-item-wrapper.dragging, .crate-item-wrapper.dragging').forEach(el => el.remove());

            // Re-render inventory to restore normal state
            this.renderInventory();
        }

        // Clear crate inventory reference
        this.crateInventory = null;

        // Clear inventory from structure userData (except markets - they persist on server)
        if (this.gameState.nearestStructure) {
            const structureType = this.gameState.nearestStructure.userData?.modelType;
            if (structureType !== 'market') {
                this.gameState.nearestStructure.userData.inventory = null;
                this.gameState.nearestStructure.userData.inventoryLoadedFromServer = false;
            }
            this.gameState.nearestStructure.userData.inventoryDirty = false;
        }
    }

    // ==========================================
    // BACKPACK INVENTORY RENDERING
    // ==========================================

    renderInventory() {
        const itemsContainer = document.getElementById('inventoryItems');
        const inventoryGrid = document.getElementById('inventoryGrid');

        // Save hovered item ID and timestamp before updating (to restore tooltip after re-render)
        const previousHoveredItemId = this.tooltipUI.hoveredItemId;
        const previousMouseEvent = this.tooltipUI.lastMouseEvent;
        const preRenderTimestamp = this.tooltipUI.tooltipTimestamp;

        this.tooltipUI.hideTooltip(); // Hide tooltip before updating items

        // Update grid styling dynamically
        const { slotSize, gap, rows, cols } = this.gameState.inventory;
        GridUIHelpers.applyGridStyling(inventoryGrid, rows, cols, slotSize, gap);

        // Update slot styling
        const slots = inventoryGrid.querySelectorAll('.inventory-slot');
        slots.forEach(slot => {
            slot.style.width = `${slotSize}px`;
            slot.style.height = `${slotSize}px`;
        });

        // ISSUE-095 FIX: Use element caching instead of innerHTML clearing
        // Track which items currently exist in inventory
        const currentItemIds = new Set(this.gameState.inventory.items.map(item => item.id));

        // Remove elements for items that no longer exist
        for (const [itemId, elements] of this._backpackElements) {
            if (!currentItemIds.has(itemId)) {
                elements.wrapper.remove();
                this._backpackElements.delete(itemId);
            }
        }

        // Update or create elements for current items
        this.gameState.inventory.items.forEach(item => {
            // Skip rendering picked item in its grid position - will render as ghost
            if (this.inventoryPickedItem && item === this.inventoryPickedItem) {
                // Hide the element if it exists (don't delete - item will return)
                const cached = this._backpackElements.get(item.id);
                if (cached) {
                    cached.wrapper.style.display = 'none';
                }
                return;
            }

            if (this._backpackElements.has(item.id)) {
                this._updateBackpackItemElement(item);
            } else {
                this._createBackpackItemElement(item, itemsContainer);
            }
        });

        // Render sling slot
        this.renderSlingSlot();

        // Remove any existing ghost elements from backpack container only
        // (crate container manages its own ghosts in renderCrateInventory)
        itemsContainer.querySelectorAll('.inventory-item-wrapper.dragging').forEach(ghost => ghost.remove());

        // Render picked item as ghost following cursor (only if targeting backpack)
        if (this.inventoryPickedItem && this.inventoryPickedTarget === 'backpack') {
            this._renderGhostItem(this.inventoryPickedItem, itemsContainer, 'backpack', this.inventoryMouseX, this.inventoryMouseY);
        }

        // Restore tooltip if item still exists after re-render (check both inventories)
        // Skip restoration if a mouseenter event already fired during render (timestamp changed)
        if (previousHoveredItemId && previousMouseEvent && !this.inventoryPickedItem) {
            // Only restore if no new mouseenter has fired (would have updated timestamp)
            if (this.tooltipUI.tooltipTimestamp === 0 || this.tooltipUI.tooltipTimestamp === preRenderTimestamp) {
                const backpackItem = this.gameState.inventory.items.find(i => i.id === previousHoveredItemId);
                const crateItem = this.crateInventory?.items?.find(i => i.id === previousHoveredItemId);
                const item = backpackItem || crateItem;
                if (item) {
                    this.tooltipUI.showTooltip(previousMouseEvent, item);
                }
            }
        }

        // Update inventory full status indicator
        if (this.game.playerInventory) {
            ui.updateInventoryFullStatus(this.game.playerInventory.isFull());
        }
    }

    // ==========================================
    // SLING SLOT RENDERING
    // ==========================================

    renderSlingSlot() {
        const slingSlot = document.getElementById('slingSlot');
        const slingItemContainer = document.getElementById('slingItem');
        if (!slingSlot || !slingItemContainer) return;

        const slingItem = this.gameState.slingItem;

        // ISSUE-095 FIX: Cache sling slot elements instead of clearing innerHTML
        if (slingItem) {
            // Has rifle in sling - render it
            slingSlot.classList.add('has-item');

            // Create image only if not cached
            if (!this._slingElements) {
                const img = document.createElement('img');
                img.src = `./items/Rrifle.png`;
                img.alt = 'Rifle';
                img.draggable = false;
                slingItemContainer.appendChild(img);
                this._slingElements = { img };
            } else {
                // Ensure image is visible
                this._slingElements.img.style.display = '';
            }
            // Event handlers delegated to #slingSlot in initializeEventDelegation()
        } else {
            // No rifle - hide image if exists, show empty slot
            slingSlot.classList.remove('has-item');
            if (this._slingElements) {
                this._slingElements.img.style.display = 'none';
            }
        }

        // Update drag-over state
        if (this.inventoryPickedItem && this.inventoryPickedTarget === 'sling') {
            if (this.inventoryPickedItem.type === 'rifle') {
                slingSlot.classList.add('drag-over');
                slingSlot.classList.remove('drag-invalid');
            } else {
                slingSlot.classList.add('drag-invalid');
                slingSlot.classList.remove('drag-over');
            }
        } else {
            slingSlot.classList.remove('drag-over', 'drag-invalid');
        }
    }

    onSlingItemMouseDown(e, item) {
        // Start dragging from sling
        this.inventoryPickedItem = item;
        this.inventoryPickedSource = 'sling';
        this.inventoryPickedTarget = 'sling';
        this.inventoryPickedOriginalX = 0;
        this.inventoryPickedOriginalY = 0;
        this.inventoryPickedOriginalRotation = item.rotation || 90;

        this.tooltipUI.hideTooltip();

        // Add global event listeners
        this._setupDragHandlers();

        // Re-render to show ghost
        this.renderInventory();
        if (this.gameState.nearestStructure) {
            this.crateUI.renderCrateInventory();
        }
    }

    _createQuantityLabel(quantity) {
        const label = document.createElement('div');
        label.className = 'item-quantity-label';
        label.textContent = `×${quantity}`;
        Object.assign(label.style, {
            position: 'absolute', bottom: '4px', right: '4px',
            background: 'transparent', color: 'white',
            padding: '2px 6px', borderRadius: '4px',
            fontSize: '12px', fontWeight: 'bold', pointerEvents: 'none',
            textShadow: '1px 1px 2px black, -1px -1px 2px black, 1px -1px 2px black, -1px 1px 2px black'
        });
        return label;
    }

    _isMouseOutsideBackpackPanel(event) {
        const panel = document.querySelector('.inventory-grid');
        if (!panel) return false;

        const rect = panel.getBoundingClientRect();
        const mouseX = event.clientX;
        const mouseY = event.clientY;

        const outsideBackpack = (mouseX < rect.left || mouseX > rect.right ||
                mouseY < rect.top || mouseY > rect.bottom);

        if (!outsideBackpack) return false;

        // Don't count as "outside" if mouse is over construction or market
        if (this._isMouseOverUIPanel(mouseX, mouseY, 'constructionSection') ||
            this._isMouseOverUIPanel(mouseX, mouseY, 'marketListContainer')) {
            return false;
        }

        return true;
    }

    _isMouseOverUIPanel(mouseX, mouseY, elementId) {
        const el = document.getElementById(elementId);
        if (el && el.style.display !== 'none') {
            const rect = el.getBoundingClientRect();
            if (mouseX >= rect.left && mouseX <= rect.right &&
                mouseY >= rect.top && mouseY <= rect.bottom) {
                return true;
            }
        }
        return false;
    }

    _isMouseOutsideBothPanels(event) {
        const backpackPanel = document.querySelector('.inventory-grid');
        const crateGrid = document.getElementById('crateGrid');

        const mouseX = event.clientX;
        const mouseY = event.clientY;

        // Check if outside backpack
        let outsideBackpack = true;
        if (backpackPanel) {
            const backpackRect = backpackPanel.getBoundingClientRect();
            outsideBackpack = (mouseX < backpackRect.left || mouseX > backpackRect.right ||
                              mouseY < backpackRect.top || mouseY > backpackRect.bottom);
        }

        // Check if outside crate
        let outsideCrate = true;
        if (crateGrid) {
            const crateRect = crateGrid.getBoundingClientRect();
            outsideCrate = (mouseX < crateRect.left || mouseX > crateRect.right ||
                           mouseY < crateRect.top || mouseY > crateRect.bottom);
        }

        // Don't count as "outside" if mouse is over construction or market
        if (outsideBackpack && outsideCrate) {
            if (this._isMouseOverUIPanel(mouseX, mouseY, 'constructionSection') ||
                this._isMouseOverUIPanel(mouseX, mouseY, 'marketListContainer')) {
                return false;
            }
        }

        return outsideBackpack && outsideCrate;
    }

    _handleOutsideInventoryDrop(item, source) {
        // Show confirmation modal with context about dragging outside
        const modal = document.getElementById('discardModal');
        const message = document.getElementById('discardMessage');

        // Check if item is a tool - show warning
        const toolTypes = ['axe', 'saw', 'pickaxe', 'hammer', 'chisel'];
        const isTool = toolTypes.includes(item.type);

        if (isTool) {
            message.innerHTML = `Discard ${item.type}?<br><span style="color: #E87878; font-size: 12px;">Warning: Tools are rare. Losing this could make survival harder.</span>`;
        } else {
            message.textContent = `Discard ${item.type}?`;
        }

        // Store item and source reference for confirmation
        modal.dataset.itemId = item.id;
        modal.dataset.itemSource = source; // 'backpack' or 'crate'

        // Store original position in case user cancels
        modal.dataset.originalX = this.inventoryPickedOriginalX;
        modal.dataset.originalY = this.inventoryPickedOriginalY;
        modal.dataset.originalRotation = this.inventoryPickedOriginalRotation;

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
        // Get item dimensions - use stored values or look up by type
        const itemSize = (item.width && item.height) ? item : getItemSize(item.type);
        const width = rotation === 90 ? itemSize.height : itemSize.width;
        const height = rotation === 90 ? itemSize.width : itemSize.height;

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

    /**
     * Validate that all items in an inventory have correct positionContext
     * Logs warnings for mismatched items (helps debug position bugs)
     * @param {Array} items - Array of items to validate
     * @param {string} expectedContext - Expected positionContext value
     * @returns {boolean} True if all items have correct context
     */
    validateInventoryContext(items, expectedContext) {
        let allValid = true;
        for (const item of items) {
            if (item.positionContext && item.positionContext !== expectedContext) {
                console.warn(`[Inventory] Item ${item.id} (${item.type}) has wrong context: ${item.positionContext} vs expected ${expectedContext} at position (${item.x}, ${item.y})`);
                allValid = false;
            }
        }
        return allValid;
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

        // Calculate size (with fallback for items missing width/height)
        const itemSize = (item.width && item.height) ? item : getItemSize(item.type);
        const displayWidth = item.rotation === 90 ? itemSize.height : itemSize.width;
        const displayHeight = item.rotation === 90 ? itemSize.width : itemSize.height;
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

    /**
     * Update ghost item position without full re-render
     * Handles both backpack and crate targets with validity feedback
     * @private
     */
    _updateGhostPosition() {
        if (!this.inventoryPickedItem) return;

        const item = this.inventoryPickedItem;
        const target = this.inventoryPickedTarget;

        // Find existing ghost element in current target container
        const container = target === 'crate'
            ? document.getElementById('crateItems')
            : document.getElementById('inventoryItems');
        if (!container) return;

        let ghost = container.querySelector('.inventory-item-wrapper.dragging, .crate-item-wrapper.dragging');

        // If ghost doesn't exist in current container, we need a full re-render (target switched)
        if (!ghost) return;

        // Calculate snapped position
        const gridPos = this.pixelToGrid(this.inventoryMouseX, this.inventoryMouseY);
        const snappedPixelPos = this.gridToPixel(gridPos.x, gridPos.y);

        ghost.style.left = snappedPixelPos.x + 'px';
        ghost.style.top = snappedPixelPos.y + 'px';

        // Update validity visual feedback
        const isValid = target === 'crate'
            ? this.isValidCratePlacement(item, gridPos.x, gridPos.y, item.rotation)
            : this.isValidPlacement(item, gridPos.x, gridPos.y, item.rotation);

        if (target === 'backpack') {
            ghost.classList.toggle('invalid-placement', !isValid);
        } else {
            ghost.style.outline = isValid ? '' : '3px solid #8B5A5A';
            ghost.style.outlineOffset = isValid ? '' : '-3px';
        }
    }

    /**
     * Update chisel/combine target highlight without full re-render
     * @param {object|null} newChiselTarget - New chisel target item or null
     * @param {object|null} newCombineTarget - New combine target item or null
     * @private
     */
    _updateTargetHighlights(newChiselTarget, newCombineTarget) {
        const oldChiselId = this.chiselTarget?.id;
        const oldCombineId = this.combineTarget?.id;
        const newChiselId = newChiselTarget?.id;
        const newCombineId = newCombineTarget?.id;

        // ISSUE-095 FIX: Scope querySelector to specific containers to avoid cross-inventory conflicts
        const itemsContainer = document.getElementById('inventoryItems');
        const crateItems = document.getElementById('crateItems');

        // Helper to find element in either container
        const findItemElement = (itemId) => {
            return itemsContainer?.querySelector(`[data-item-id="${itemId}"]`) ||
                   crateItems?.querySelector(`[data-item-id="${itemId}"]`);
        };

        // Remove old highlights
        if (oldChiselId && oldChiselId !== newChiselId) {
            const oldEl = findItemElement(oldChiselId);
            if (oldEl) oldEl.classList.remove('chisel-target');
        }
        if (oldCombineId && oldCombineId !== newCombineId) {
            const oldEl = findItemElement(oldCombineId);
            if (oldEl) oldEl.classList.remove('chisel-target');
        }

        // Add new highlights
        if (newChiselId && newChiselId !== oldChiselId) {
            const newEl = findItemElement(newChiselId);
            if (newEl) newEl.classList.add('chisel-target');
        }
        if (newCombineId && newCombineId !== oldCombineId) {
            const newEl = findItemElement(newCombineId);
            if (newEl) newEl.classList.add('chisel-target');
        }

        // Update state
        this.chiselTarget = newChiselTarget;
        this.combineTarget = newCombineTarget;
    }

    _isValidPlacementInGrid(item, x, y, rotation, itemsList, maxCols, maxRows) {
        // Get item dimensions - use stored values or look up by type
        const itemSize = (item.width && item.height) ? item : getItemSize(item.type);
        const width = rotation === 90 ? itemSize.height : itemSize.width;
        const height = rotation === 90 ? itemSize.width : itemSize.height;

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
        this.wheelHandler = (e) => this.onWheel(e);

        window.addEventListener('mousemove', this.mouseMoveHandler);
        window.addEventListener('mouseup', this.mouseUpHandler);
        window.addEventListener('keydown', this.keyDownHandler);
        window.addEventListener('wheel', this.wheelHandler, { passive: false });
    }

    _cleanupDragHandlers() {
        window.removeEventListener('mousemove', this.mouseMoveHandler);
        window.removeEventListener('mouseup', this.mouseUpHandler);
        window.removeEventListener('keydown', this.keyDownHandler);
        window.removeEventListener('wheel', this.wheelHandler);
    }

    _startItemDrag(item, source, event, containerElement) {
        this.inventoryPickedItem = item;
        this.inventoryPickedSource = source;
        this.inventoryPickedTarget = source;
        this.inventoryPickedOriginalX = item.x;
        this.inventoryPickedOriginalY = item.y;
        this.inventoryPickedOriginalRotation = item.rotation;

        // Store mouse position
        const containerRect = containerElement.getBoundingClientRect();
        this.inventoryMouseX = event.clientX - containerRect.left;
        this.inventoryMouseY = event.clientY - containerRect.top;

        this._setupDragHandlers(source);

        // Re-render to show item following cursor
        this.renderInventory();
        if (this.gameState.nearestStructure) {
            this.crateUI.renderCrateInventory();
        }
    }

    // ==========================================
    // ITEM TARGETING (Chisel + Combining)
    // ==========================================

    getItemUnderCursor(cursorX, cursorY, draggingItem) {
        // Check if cursor is over a targetable item (chiseable stones or combinable items)
        const chiseableStones = ['limestone', 'sandstone', 'Rlimestone', 'Rsandstone'];
        const combinableItems = ['vines', 'Rvines', 'rope', 'Rrope', 'limestone', 'Rlimestone', 'hempfiber', 'Rhempfiber', 'animalskin', 'Ranimalskin'];

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

    /**
     * Get any inventory item under cursor position (for tooltip display)
     * @param {number} cursorX - Cursor X in inventory-relative pixels
     * @param {number} cursorY - Cursor Y in inventory-relative pixels
     * @param {object} draggingItem - Item being dragged (excluded from results)
     * @returns {object|null} - Item under cursor or null
     */
    getAnyItemUnderCursor(cursorX, cursorY, draggingItem) {
        for (const invItem of this.gameState.inventory.items) {
            if (invItem.id === draggingItem.id) continue; // Skip the item being dragged

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

        // Bulk transfer detection (double-click or shift-click)
        const DOUBLE_CLICK_THRESHOLD = 300;
        const BULK_TRANSFER_EXCLUDED = ['ammo', 'coin', 'rifle'];
        const now = Date.now();
        const isDoubleClick = item.id === this._lastClickItemId && (now - this._lastClickTime) < DOUBLE_CLICK_THRESHOLD;
        const isShiftClick = event.shiftKey;

        if ((isDoubleClick || (isShiftClick && this.crateInventory)) && !BULK_TRANSFER_EXCLUDED.includes(item.type)) {
            this._lastClickTime = 0;
            this._lastClickItemId = null;
            this._handleBulkTransfer(item.type, 'toStructure');
            return;
        }

        this._lastClickTime = now;
        this._lastClickItemId = item.id;

        this.tooltipUI.hideTooltip();

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

        // Update mouse position first (needed for ghost item)
        this.inventoryMouseX = event.clientX - containerRect.left;
        this.inventoryMouseY = event.clientY - containerRect.top;

        // Check if hovering over sling slot
        const slingSlot = document.getElementById('slingSlot');
        if (slingSlot) {
            const slingRect = slingSlot.getBoundingClientRect();
            const overSling = (event.clientX >= slingRect.left && event.clientX <= slingRect.right &&
                              event.clientY >= slingRect.top && event.clientY <= slingRect.bottom);
            if (overSling) {
                const wasAlreadySling = this.inventoryPickedTarget === 'sling';
                this.inventoryPickedTarget = 'sling';
                // Only re-render sling slot if target changed (avoid full re-render spam)
                if (!wasAlreadySling) {
                    this.renderSlingSlot();
                }
                // Update ghost position without full re-render
                this._updateGhostPosition();
                return;
            }
        }

        // If we were over sling but now aren't, update sling visual and do full render for ghost move
        if (this.inventoryPickedTarget === 'sling') {
            this.inventoryPickedTarget = 'backpack';
            this.renderSlingSlot();
            // Need full render to move ghost from sling back to backpack
            this.renderInventory();
            return;
        }

        this.inventoryPickedTarget = 'backpack';

        // Check if hovering over construction slots for visual feedback
        this._updateConstructionSlotHighlight(event, item);

        // Check if hovering over market for visual feedback
        this._updateMarketListHighlight(event, item);

        // Efficiently update chisel/combine target highlights (no full re-render)
        const newChiselTarget = this._getChiselTarget(item);
        const newCombineTarget = this._getCombineTarget(item);
        this._updateTargetHighlights(newChiselTarget, newCombineTarget);

        // Update ghost position efficiently (no full re-render)
        this._updateGhostPosition();
    }

    _handleCrateAwareMouseMove(event, item) {
        // Get grid containers for bounds checking (grids have explicit dimensions)
        const backpackGrid = document.getElementById('inventoryGrid');
        const backpackGridRect = backpackGrid.getBoundingClientRect();
        // Grid has 2px border + 2px padding = 4px offset from outer edge to content
        const gridContentOffset = 4;

        // Track previous target to detect changes
        const previousTarget = this.inventoryPickedTarget;

        // Check if hovering over sling slot first (highest priority)
        const slingSlot = document.getElementById('slingSlot');
        if (slingSlot) {
            const slingRect = slingSlot.getBoundingClientRect();
            const overSling = (event.clientX >= slingRect.left && event.clientX <= slingRect.right &&
                              event.clientY >= slingRect.top && event.clientY <= slingRect.bottom);
            if (overSling) {
                // Subtract offset to get content-relative coords (items layer aligns with grid content)
                this.inventoryMouseX = event.clientX - backpackGridRect.left - gridContentOffset;
                this.inventoryMouseY = event.clientY - backpackGridRect.top - gridContentOffset;
                const wasAlreadySling = previousTarget === 'sling';
                this.inventoryPickedTarget = 'sling';
                // Only re-render if target changed (avoid full re-render spam)
                if (!wasAlreadySling) {
                    this.renderSlingSlot();
                    this.renderInventory();
                    if (this.gameState.nearestStructure) {
                        this.crateUI.renderCrateInventory();
                    }
                } else {
                    // Update ghost position without full re-render
                    this._updateGhostPosition();
                }
                return;
            }
        }

        // Get crate grid for bounds checking
        const crateGrid = document.getElementById('crateGrid');
        const crateRect = crateGrid.getBoundingClientRect();

        // Determine which container we're targeting based on mouse position
        // Use grid bounds (grids have explicit size, items layers collapse to content)
        let overBackpack = (event.clientX >= backpackGridRect.left && event.clientX <= backpackGridRect.right &&
                            event.clientY >= backpackGridRect.top && event.clientY <= backpackGridRect.bottom);

        let overCrate = (event.clientX >= crateRect.left && event.clientX <= crateRect.right &&
                        event.clientY >= crateRect.top && event.clientY <= crateRect.bottom);

        // Get crate items layer for position calculation
        const crateItems = document.getElementById('crateItems');
        const crateItemsRect = crateItems.getBoundingClientRect();

        // Get scroll position for crate (needed for large scrollable inventories)
        const crateGridContainer = crateGrid.parentElement;
        const crateScrollTop = crateGridContainer.scrollTop;

        // Determine new target and update mouse position
        // Use grid coords for backpack (grid has explicit size, items layer doesn't)
        // Subtract gridContentOffset to convert from grid outer edge to content-relative coords
        let newTarget = previousTarget; // Default to previous
        if (overBackpack) {
            this.inventoryMouseX = event.clientX - backpackGridRect.left - gridContentOffset;
            this.inventoryMouseY = event.clientY - backpackGridRect.top - gridContentOffset;
            newTarget = 'backpack';
        } else if (overCrate) {
            this.inventoryMouseX = event.clientX - crateItemsRect.left;
            this.inventoryMouseY = event.clientY - crateItemsRect.top + crateScrollTop;
            newTarget = 'crate';
        } else {
            // Mouse is outside both areas - keep updating position relative to current target
            if (previousTarget === 'crate') {
                this.inventoryMouseX = event.clientX - crateItemsRect.left;
                this.inventoryMouseY = event.clientY - crateItemsRect.top + crateScrollTop;
            } else {
                this.inventoryMouseX = event.clientX - backpackGridRect.left - gridContentOffset;
                this.inventoryMouseY = event.clientY - backpackGridRect.top - gridContentOffset;
            }
        }

        // Check if target changed (requires full re-render to move ghost between containers)
        const targetChanged = newTarget !== previousTarget;
        this.inventoryPickedTarget = newTarget;

        // If we were over sling but now aren't, update sling visual
        if (previousTarget === 'sling' && newTarget !== 'sling') {
            this.renderSlingSlot();
        }

        // Efficiently update chisel/combine target highlights
        let newChiselTarget = null;
        let newCombineTarget = null;
        if (newTarget === 'backpack') {
            if (item.type === 'chisel' || item.type === 'improvisedtool') {
                newChiselTarget = this._getChiselTarget(item);
            } else {
                const itemType = item.type.replace('R', '');
                if (['vines', 'rope', 'limestone'].includes(itemType)) {
                    newCombineTarget = this._getCombineTarget(item);
                }
            }
        }
        this._updateTargetHighlights(newChiselTarget, newCombineTarget);

        // Check if hovering over market for visual feedback (only from backpack)
        if (this.inventoryPickedSource === 'backpack') {
            this._updateMarketListHighlight(event, item);
        }

        // Only do full re-render when target changes (ghost needs to move containers)
        // Otherwise just update ghost position efficiently
        if (targetChanged) {
            this.renderInventory();
            if (this.gameState.nearestStructure) {
                this.crateUI.renderCrateInventory();
            }
        } else {
            this._updateGhostPosition();
        }

        // Show combine tooltip when dragging in backpack
        if (newTarget === 'backpack' && this.craftingSystem) {
            const targetItem = this.getAnyItemUnderCursor(this.inventoryMouseX, this.inventoryMouseY, item);
            if (targetItem) {
                // ISSUE-095 FIX: Scope querySelector to backpack container
                const backpackItems = document.getElementById('inventoryItems');
                const targetElement = backpackItems?.querySelector(`[data-item-id="${targetItem.id}"]`);
                if (targetElement) {
                    this.tooltipUI.showCombineTooltip(item, targetItem, targetElement, this.craftingSystem);
                }
            } else {
                this.tooltipUI.hideTooltip();
            }
        } else {
            this.tooltipUI.hideTooltip();
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
        // Drag-to-sell highlight is disabled - use Sell button instead
    }

    /**
     * Get chisel target under cursor (returns target, doesn't set state)
     * @private
     */
    _getChiselTarget(item) {
        if (item.type !== 'chisel' && item.type !== 'improvisedtool') return null;
        try {
            const targetItem = this.getItemUnderCursor(this.inventoryMouseX, this.inventoryMouseY, item);
            const chiseableStones = ['limestone', 'sandstone', 'Rlimestone', 'Rsandstone'];
            return (targetItem && chiseableStones.includes(targetItem.type)) ? targetItem : null;
        } catch (error) {
            console.error('Error checking chisel target:', error);
            return null;
        }
    }

    /**
     * Get combine target under cursor (returns target, doesn't set state)
     * @private
     */
    _getCombineTarget(item) {
        const itemType = item.type.replace('R', '');
        // Allow vines, rope, and limestone for combining
        if (!['vines', 'rope', 'limestone', 'hempfiber', 'animalskin'].includes(itemType)) return null;
        try {
            const targetItem = this.getItemUnderCursor(this.inventoryMouseX, this.inventoryMouseY, item);
            if (!targetItem) return null;

            const targetType = targetItem.type.replace('R', '');

            // Same-type match (vines+vines, rope+rope)
            if (targetType === itemType) return targetItem;

            // Cross-type match (limestone+rope)
            const crossPairs = [['limestone', 'rope']];
            for (const [a, b] of crossPairs) {
                if ((itemType === a && targetType === b) || (itemType === b && targetType === a)) {
                    return targetItem;
                }
            }
            return null;
        } catch (error) {
            console.error('Error checking combine target:', error);
            return null;
        }
    }

    // Legacy methods for compatibility - these call the new efficient methods
    _updateChiselTarget(item) {
        const newTarget = this._getChiselTarget(item);
        this._updateTargetHighlights(newTarget, this.combineTarget);
    }

    _updateCombineTarget(item) {
        const newTarget = this._getCombineTarget(item);
        this._updateTargetHighlights(this.chiselTarget, newTarget);
    }

    onMouseUp(event) {
        if (!this.inventoryPickedItem) return;

        const item = this.inventoryPickedItem;
        const source = this.inventoryPickedSource || 'backpack';

        // Hide combine tooltip on drop
        this.tooltipUI.hideTooltip();

        try {
            // Check if chisel/improvisedtool was released over a stone (only from backpack)
            if (source === 'backpack' && (item.type === 'chisel' || item.type === 'improvisedtool') && this.chiselTarget) {
                this._handleChiselDrop();
                return;
            }

            // Check if combinable item was released over target (only from backpack)
            const itemType = item.type.replace('R', '');
            if (source === 'backpack' && ['vines', 'rope', 'limestone', 'hempfiber', 'animalskin'].includes(itemType) && this.combineTarget) {
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

            // Check if dropping onto sling slot
            if (this.inventoryPickedTarget === 'sling') {
                this._handleSlingDrop(event, item, source);
                return;
            }

            // Handle placement based on whether we're in crate mode
            const crateSection = document.getElementById('crateSection');
            const crateVisible = crateSection && crateSection.style.display !== 'none';

            if (crateVisible && this.gameState.nearestStructure) {
                this._handleCrateModePlacement(event, item, source);
            } else {
                this._handleBackpackOnlyPlacement(event, item, source);
            }

            // Clear picked item state
            this.inventoryPickedItem = null;
            this.inventoryPickedSource = null;
            this.inventoryPickedTarget = null;

            // Remove global event listeners
            this._cleanupDragHandlers();

            // Re-render
            this.renderInventory();
            if (this.gameState.nearestStructure) {
                this.crateUI.renderCrateInventory();
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

        // Remove global event listeners
        this._cleanupDragHandlers();

        // Re-render
        this.renderInventory();
        if (this.gameState.nearestStructure) {
            this.crateUI.renderCrateInventory();
        }
    }

    _handleCombineDrop() {
        const targetItem = this.combineTarget;
        this.combineTarget = null;

        // Combine items via callback (instant, no action duration)
        if (this.onItemCombine) {
            this.onItemCombine(this.inventoryPickedItem, targetItem);
        }

        // Clear picked item state
        this.inventoryPickedItem = null;
        this.inventoryPickedSource = null;
        this.inventoryPickedTarget = null;

        // Remove global event listeners
        this._cleanupDragHandlers();

        // Re-render
        this.renderInventory();
        if (this.gameState.nearestStructure) {
            this.crateUI.renderCrateInventory();
        }
    }

    _handleSlingDrop(event, item, source) {
        // Only rifles can go in the sling
        if (item.type !== 'rifle') {
            ui.showToast('Only rifles can go in the sling', 'warning');
            // Restore item to original position
            this._restoreItemPosition();
            this._finishDrop();
            return;
        }

        // Check if sling already has a rifle
        if (this.gameState.slingItem && source !== 'sling') {
            ui.showToast('Sling already has a rifle', 'warning');
            // Restore item to original position
            this._restoreItemPosition();
            this._finishDrop();
            return;
        }

        // Remove item from source
        if (source === 'backpack') {
            const itemIndex = this.gameState.inventory.items.findIndex(i => i.id === item.id);
            if (itemIndex > -1) {
                this.gameState.inventory.items.splice(itemIndex, 1);
                this.gameState.markInventoryDirty();
            }
        } else if (source === 'crate' && this.crateInventory) {
            const itemIndex = this.crateInventory.items.findIndex(i => i.id === item.id);
            if (itemIndex > -1) {
                this.crateInventory.items.splice(itemIndex, 1);
            }
            // Immediate save
            this.saveCrateInventory();
        }
        // If source is 'sling', item is already in sling, no removal needed

        // Set rifle in sling (rotated for horizontal display)
        item.rotation = 90;
        this.gameState.slingItem = item;

        this._finishDrop();
    }

    _finishDrop() {
        // Clear picked item state
        this.inventoryPickedItem = null;
        this.inventoryPickedSource = null;
        this.inventoryPickedTarget = null;

        // Remove global event listeners
        this._cleanupDragHandlers();

        // Re-render
        this.renderInventory();
        if (this.gameState.nearestStructure) {
            this.crateUI.renderCrateInventory();
        }
    }

    _tryDropOnConstruction(event, item) {
        if (!this.gameState.nearestConstructionSite || this.gameState.isMoving) {
            return false;
        }

        // Check server connection before depositing materials
        if (!this.networkManager.isServerConnected()) {
            ui.showToast('Cannot deposit: Not connected to server', 'error');
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
        // If the item is a chiseled stone type, check if any chiseled stone type is required
        let isNeeded = false;
        let requiredGenericType = null;  // Tracks the required type for planks or chiseled stone
        let genericTypeCategory = null;   // 'plank' or 'chiseledStone'
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
                    requiredGenericType = reqMaterial;
                    genericTypeCategory = 'plank';
                    required = requiredMaterials[reqMaterial];
                    break;
                }
            }
        } else if (isChiseledStone(itemType)) {
            // Check if any chiseled stone type is required
            for (const reqMaterial in requiredMaterials) {
                if (isChiseledStone(reqMaterial)) {
                    isNeeded = true;
                    requiredGenericType = reqMaterial;
                    genericTypeCategory = 'chiseledStone';
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
        if (genericTypeCategory === 'plank') {
            // For planks, check total of all plank types
            current = getTotalPlankQuantity(currentMaterials);
        } else if (genericTypeCategory === 'chiseledStone') {
            // For chiseled stone, check total of all chiseled stone types
            current = getTotalChiseledStoneQuantity(currentMaterials);
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

        // Send update to server (include materialItems for peer sync and icon rendering)
        this.networkManager.sendMessage('update_construction_materials', {
            constructionId: this.gameState.nearestConstructionSite.userData.objectId,
            chunkKey: this.gameState.nearestConstructionSite.userData.chunkKey,
            materials: currentMaterials,
            materialItems: this.gameState.nearestConstructionSite.userData.materialItems,
            clientId: this.gameState.clientId
        });

        // Remove item from inventory (use findIndex with ID for robust reference matching)
        const itemIndex = this.gameState.inventory.items.findIndex(i => i.id === item.id);
        if (itemIndex > -1) {
            this.gameState.inventory.items.splice(itemIndex, 1);
            this.gameState.markInventoryDirty();
        }

        // Clear picked item state
        this.inventoryPickedItem = null;
        this.inventoryPickedSource = null;
        this.inventoryPickedTarget = null;

        // Remove global event listeners
        this._cleanupDragHandlers();

        // Re-render
        this.renderInventory();
        this.constructionUI.updateConstructionSection();
        this.crateUI.updateCrateSection();

        return true;
    }

    _tryDropOnMarket(event, item) {
        // Drag-to-sell is disabled - use Sell button instead
        return false;
    }

    _handleBackpackOnlyPlacement(event, item, source) {
        // Check if dropped outside backpack panel boundary (and not over sling)
        if (this._isMouseOutsideBackpackPanel(event) && this.inventoryPickedTarget !== 'sling') {
            this._handleOutsideInventoryDrop(item, source || 'backpack');
            return;
        }

        // Calculate final grid position
        const gridPos = this.pixelToGrid(this.inventoryMouseX, this.inventoryMouseY);

        // Check if placement is valid
        if (this.isValidPlacement(item, gridPos.x, gridPos.y, item.rotation)) {
            // Valid placement - update item position
            item.x = gridPos.x;
            item.y = gridPos.y;

            // Handle transfer from sling to backpack
            if (source === 'sling') {
                // Remove from sling
                this.gameState.slingItem = null;
                // Add to backpack items
                this.gameState.inventory.items.push(item);
                this.gameState.markInventoryDirty();
            }
        } else {
            // Invalid placement - restore original position
            if (source === 'sling') {
                // Item stays in sling
                this.gameState.slingItem = item;
            } else {
                item.x = this.inventoryPickedOriginalX;
                item.y = this.inventoryPickedOriginalY;
                item.rotation = this.inventoryPickedOriginalRotation;
            }
        }
    }

    _handleCrateModePlacement(event, item, source) {
        const target = this.inventoryPickedTarget || source;

        // Check if dropped outside both panels (discard intent)
        if (this._isMouseOutsideBothPanels(event) && this.inventoryPickedTarget !== 'sling') {
            this._handleOutsideInventoryDrop(item, source);
            return;
        }

        // Check ownership for house inventories
        const nearestStructure = this.gameState.nearestStructure;
        if (nearestStructure && nearestStructure.userData.modelType === 'house' && nearestStructure.userData.owner) {
            // Check if the current player owns the house
            const currentClientId = this.gameState.clientId;
            const currentAccountId = this.gameState.accountId;
            const owner = nearestStructure.userData.owner;

            // Check against both session ID and account ID
            if (owner !== currentClientId && owner !== currentAccountId) {
                // Not the owner - prevent any inventory operation

                // Restore item to original position
                item.x = this.inventoryPickedOriginalX;
                item.y = this.inventoryPickedOriginalY;
                item.rotation = this.inventoryPickedOriginalRotation;

                // Show error message
                if (ui) {
                    ui.updateStatus('Only the house owner can modify this inventory');
                }

                // Clear picked item state
                this.inventoryPickedItem = null;
                this.inventoryPickedSource = null;
                this.inventoryPickedTarget = null;

                // Remove global event listeners
                this._cleanupDragHandlers();

                // Re-render inventories
                this.renderInventory();
                this.crateUI.renderCrateInventory();

                return; // Exit early, prevent any transfer
            }
        }

        if (target === 'backpack') {
            // Moving to backpack
            const gridPos = this.pixelToGrid(this.inventoryMouseX, this.inventoryMouseY);

            // Special handling for coins from crate - show transfer dialog
            if (source === 'crate' && item.type === 'coin') {
                // Restore item position (it stays in crate until dialog confirms)
                item.x = this.inventoryPickedOriginalX;
                item.y = this.inventoryPickedOriginalY;
                item.rotation = this.inventoryPickedOriginalRotation;

                // Show coin transfer dialog
                this._showCoinTransferFromCrateDialog(item);
                return;
            }

            // Special handling for ammo from crate - stack up to 20, handle remainder
            if (source === 'crate' && item.type === 'ammo') {
                const AMMO_STACK_MAX = 20;
                const sourceQuantity = item.quantity || 1;
                let remainingToTransfer = sourceQuantity;

                // Find ammo stacks in backpack that have room
                const backpackAmmoStacks = this.gameState.inventory.items.filter(
                    i => i.type === 'ammo' && (i.quantity || 1) < AMMO_STACK_MAX
                );

                // Fill existing stacks first
                for (const stack of backpackAmmoStacks) {
                    if (remainingToTransfer <= 0) break;
                    const canFit = AMMO_STACK_MAX - (stack.quantity || 1);
                    const transfer = Math.min(canFit, remainingToTransfer);
                    stack.quantity = (stack.quantity || 1) + transfer;
                    remainingToTransfer -= transfer;
                }

                // If there's remainder, try to find a free slot
                if (remainingToTransfer > 0) {
                    // Search for a valid empty position for the remainder
                    let foundSlot = false;
                    const cols = this.gameState.inventory.cols;
                    const rows = this.gameState.inventory.rows;
                    for (let y = 0; y < rows && !foundSlot; y++) {
                        for (let x = 0; x < cols && !foundSlot; x++) {
                            if (this._isValidPlacementInGrid(item, x, y, 0, this.gameState.inventory.items, cols, rows)) {
                                // Place remainder here as new stack
                                const newAmmo = {
                                    id: 'ammo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                                    type: 'ammo',
                                    x: x,
                                    y: y,
                                    width: item.width || 1,
                                    height: item.height || 1,
                                    rotation: 0,
                                    quantity: remainingToTransfer,
                                    positionContext: 'backpack'
                                };
                                this.gameState.inventory.items.push(newAmmo);
                                this.gameState.markInventoryDirty();
                                remainingToTransfer = 0;
                                foundSlot = true;
                            }
                        }
                    }
                }

                // Determine what happened
                const transferred = sourceQuantity - remainingToTransfer;
                if (transferred > 0) {
                    // At least some ammo was transferred
                    if (remainingToTransfer > 0) {
                        // Partial transfer - update source quantity
                        item.quantity = remainingToTransfer;
                        item.x = this.inventoryPickedOriginalX;
                        item.y = this.inventoryPickedOriginalY;
                    } else {
                        // Full transfer - remove from crate
                        const crateInventory = this.crateInventory;
                        const itemIndex = crateInventory.items.findIndex(i => i.id === item.id);
                        if (itemIndex > -1) {
                            crateInventory.items.splice(itemIndex, 1);
                        }
                    }
                    this._finishDrop();
                    this.saveCrateInventory();
                    return;
                }
                // Nothing transferred (all stacks full, no free slots) - fall through to reject
            }

            if (this.isValidPlacement(item, gridPos.x, gridPos.y, item.rotation)) {
                // Valid placement in backpack
                if (source === 'crate') {
                    // Normal item - remove from crate, add to backpack (use findIndex with ID for robust reference matching)
                    // Note: Coins are handled earlier via _showCoinTransferFromCrateDialog
                    const crateInventory = this.crateInventory;
                    const itemIndex = crateInventory.items.findIndex(i => i.id === item.id);
                    if (itemIndex > -1) {
                        crateInventory.items.splice(itemIndex, 1);
                    }

                    // If firewood being taken out of burning structure, update durability
                    if (item.type && item.type.endsWith('firewood') && item.placedAtTick) {
                        const currentDurability = this.crateUI._calculateFirewoodDurability(item);
                        item.durability = Math.max(0, Math.floor(currentDurability));
                        delete item.placedAtTick; // No longer burning
                    }

                    // Update position and context BEFORE adding to backpack
                    item.x = gridPos.x;
                    item.y = gridPos.y;
                    item.positionContext = 'backpack';
                    this.gameState.inventory.items.push(item);
                    this.gameState.markInventoryDirty();
                    // Notify tasks panel of item added to backpack
                    const items = this.gameState.inventory.items;
                    window.tasksPanel?.onItemAdded(item.type, items.filter(i => i.type === item.type).length);
                } else if (source === 'sling') {
                    // Moving from sling to backpack
                    this.gameState.slingItem = null;
                    item.x = gridPos.x;
                    item.y = gridPos.y;
                    item.positionContext = 'backpack';
                    this.gameState.inventory.items.push(item);
                    this.gameState.markInventoryDirty();
                } else {
                    // Moving within backpack - just update position
                    item.x = gridPos.x;
                    item.y = gridPos.y;
                    item.positionContext = 'backpack';
                }
            } else {
                // Invalid placement - restore original position
                if (source === 'sling') {
                    // Item stays in sling
                    this.gameState.slingItem = item;
                } else {
                    item.x = this.inventoryPickedOriginalX;
                    item.y = this.inventoryPickedOriginalY;
                    item.rotation = this.inventoryPickedOriginalRotation;
                }
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
                    // ONE-WAY TRANSFER: Block adding items to apple trees
                    const nearestStructure = this.gameState.nearestStructure;
                    if (nearestStructure && nearestStructure.userData.modelType === 'apple') {
                        // Reject the transfer - restore original position
                        item.x = this.inventoryPickedOriginalX;
                        item.y = this.inventoryPickedOriginalY;
                        item.rotation = this.inventoryPickedOriginalRotation;

                        ui.updateStatus(`Cannot add items to apple tree - items spawn naturally`);
                        this._finishDrop();
                        return; // Exit early, don't proceed with transfer
                    }

                    // IRONWORKS RESTRICTION: Only accept iron, ironingot, and firewood
                    if (nearestStructure && nearestStructure.userData.modelType === 'ironworks') {
                        const allowedItems = ['iron', 'ironingot', 'oakfirewood', 'pinefirewood', 'firfirewood', 'cypressfirewood', 'applefirewood'];
                        const isFirewood = item.type && item.type.endsWith('firewood');
                        if (!allowedItems.includes(item.type) && !isFirewood) {
                            // Reject the transfer - restore original position
                            item.x = this.inventoryPickedOriginalX;
                            item.y = this.inventoryPickedOriginalY;
                            item.rotation = this.inventoryPickedOriginalRotation;

                            ui.updateStatus(`Ironworks only accepts iron, iron ingots, and firewood`);
                            this._finishDrop();
                            return; // Exit early, don't proceed with transfer
                        }
                    }

                    // BLACKSMITH RESTRICTION: Only accept ironingot, parts, and firewood
                    if (nearestStructure && nearestStructure.userData.modelType === 'blacksmith') {
                        const allowedItems = ['ironingot', 'parts', 'oakfirewood', 'pinefirewood', 'firfirewood', 'cypressfirewood', 'applefirewood'];
                        const isFirewood = item.type && item.type.endsWith('firewood');
                        if (!allowedItems.includes(item.type) && !isFirewood) {
                            // Reject the transfer - restore original position
                            item.x = this.inventoryPickedOriginalX;
                            item.y = this.inventoryPickedOriginalY;
                            item.rotation = this.inventoryPickedOriginalRotation;

                            ui.updateStatus(`Blacksmith only accepts iron ingots, parts, and firewood`);
                            this._finishDrop();
                            return; // Exit early, don't proceed with transfer
                        }
                    }

                    // BAKERY RESTRICTION: Only accept apple, appletart, and firewood
                    if (nearestStructure && nearestStructure.userData.modelType === 'bakery') {
                        const allowedItems = ['apple', 'appletart', 'oakfirewood', 'pinefirewood', 'firfirewood', 'cypressfirewood', 'applefirewood'];
                        const isFirewood = item.type && item.type.endsWith('firewood');
                        if (!allowedItems.includes(item.type) && !isFirewood) {
                            // Reject the transfer - restore original position
                            item.x = this.inventoryPickedOriginalX;
                            item.y = this.inventoryPickedOriginalY;
                            item.rotation = this.inventoryPickedOriginalRotation;

                            ui.updateStatus(`Bakery only accepts apples, apple tarts, and firewood`);
                            this._finishDrop();
                            return; // Exit early, don't proceed with transfer
                        }
                    }

                    // ARTILLERY RESTRICTION: Only accept shell items
                    if (nearestStructure && nearestStructure.userData.modelType === 'artillery') {
                        if (item.type !== 'shell') {
                            // Reject the transfer - restore original position
                            item.x = this.inventoryPickedOriginalX;
                            item.y = this.inventoryPickedOriginalY;
                            item.rotation = this.inventoryPickedOriginalRotation;

                            ui.updateStatus(`Artillery only accepts shells`);
                            this._finishDrop();
                            return; // Exit early, don't proceed with transfer
                        }
                    }

                    // TILEWORKS RESTRICTION: Only accept clay, tile, and firewood
                    if (nearestStructure && nearestStructure.userData.modelType === 'tileworks') {
                        const allowedItems = ['clay', 'tile', 'oakfirewood', 'pinefirewood', 'firfirewood', 'cypressfirewood', 'applefirewood'];
                        const isFirewood = item.type && item.type.endsWith('firewood');
                        if (!allowedItems.includes(item.type) && !isFirewood) {
                            // Reject the transfer - restore original position
                            item.x = this.inventoryPickedOriginalX;
                            item.y = this.inventoryPickedOriginalY;
                            item.rotation = this.inventoryPickedOriginalRotation;

                            ui.updateStatus(`Tileworks only accepts clay, tiles, and firewood`);
                            this._finishDrop();
                            return; // Exit early, don't proceed with transfer
                        }
                    }

                    // FISHERMAN RESTRICTION: Only accept fish, cookedfish, and firewood
                    if (nearestStructure && nearestStructure.userData.modelType === 'fisherman') {
                        const allowedItems = ['fish', 'cookedfish', 'oakfirewood', 'pinefirewood', 'firfirewood', 'cypressfirewood', 'applefirewood'];
                        const isFirewood = item.type && item.type.endsWith('firewood');
                        if (!allowedItems.includes(item.type) && !isFirewood) {
                            // Reject the transfer - restore original position
                            item.x = this.inventoryPickedOriginalX;
                            item.y = this.inventoryPickedOriginalY;
                            item.rotation = this.inventoryPickedOriginalRotation;

                            ui.updateStatus(`Fisherman hut only accepts fish and firewood`);
                            this._finishDrop();
                            return; // Exit early, don't proceed with transfer
                        }
                    }

                    // Remove from backpack, add to crate (use findIndex with ID for robust reference matching)
                    const itemIndex = this.gameState.inventory.items.findIndex(i => i.id === item.id);
                    if (itemIndex > -1) {
                        this.gameState.inventory.items.splice(itemIndex, 1);
                        this.gameState.markInventoryDirty();
                    }
                    // Update position and context BEFORE adding to crate (so save sends correct coords)
                    item.x = crateGridPos.x;
                    item.y = crateGridPos.y;
                    item.positionContext = nearestStructure.userData.modelType;
                    this.crateInventory.items.push(item);
                    // Notify tasks panel of item moved to crate/campfire
                    window.tasksPanel?.onItemMovedToCrate(item.type, nearestStructure?.userData?.modelType);
                    // Note: Per-action save now happens at end of _handleCrateModePlacement() for ALL items
                } else if (source === 'sling') {
                    // Moving from sling to crate
                    this.gameState.slingItem = null;
                    // Update position and context BEFORE adding to crate
                    item.x = crateGridPos.x;
                    item.y = crateGridPos.y;
                    item.positionContext = nearestStructure.userData.modelType;
                    this.crateInventory.items.push(item);
                } else if (source === 'crate') {
                    // Moving within crate - just update position and context
                    item.x = crateGridPos.x;
                    item.y = crateGridPos.y;
                    item.positionContext = nearestStructure.userData.modelType;
                }
            } else {
                // Invalid placement - restore original position
                if (source === 'sling') {
                    // Item stays in sling
                    this.gameState.slingItem = item;
                } else {
                    item.x = this.inventoryPickedOriginalX;
                    item.y = this.inventoryPickedOriginalY;
                    item.rotation = this.inventoryPickedOriginalRotation;
                }
            }
        } else {
            // Dropped outside all grids - offer to discard
            this._handleOutsideInventoryDrop(item, source);
            return;
        }

        // Immediate save (per-action save instead of batch save on close)
        this.saveCrateInventory();
    }

    _restoreItemPosition() {
        if (this.inventoryPickedItem) {
            if (this.inventoryPickedSource === 'sling') {
                // Item stays in sling - just ensure it's still there
                this.gameState.slingItem = this.inventoryPickedItem;
            } else {
                this.inventoryPickedItem.x = this.inventoryPickedOriginalX;
                this.inventoryPickedItem.y = this.inventoryPickedOriginalY;
                this.inventoryPickedItem.rotation = this.inventoryPickedOriginalRotation;
            }
        }
        this.inventoryPickedItem = null;
        this.inventoryPickedSource = null;
        this.inventoryPickedTarget = null;
        this.chiselTarget = null;
        this._cleanupDragHandlers();
        this.renderInventory();
        if (this.gameState.nearestStructure) {
            this.crateUI.renderCrateInventory();
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
            // Clean up drag state and ghost elements
            this._finishDrop();
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
            this.gameState.markInventoryDirty();
            if (coinItem.quantity <= 0) {
                // Remove coin item from backpack
                const itemIndex = this.gameState.inventory.items.indexOf(coinItem);
                if (itemIndex > -1) {
                    this.gameState.inventory.items.splice(itemIndex, 1);
                }
            }

            // Immediate save
            this.saveCrateInventory();

            // Close dialog
            dialog.style.display = 'none';
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            input.removeEventListener('input', validateInput);

            // Clean up drag state and re-render
            this._finishDrop();

            // Show status
            ui.updateStatus(`Transferred ${amount} coins to storage`);
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    }

    /**
     * Show coin transfer dialog when dragging coins from crate to backpack
     * @param {object} crateItem - The coin item in the crate
     */
    _showCoinTransferFromCrateDialog(crateItem) {
        if (!crateItem || !crateItem.quantity) return;

        const dialog = document.getElementById('coinTransferDialog');
        const infoElement = document.getElementById('coinTransferInfo');
        const currentSpan = document.getElementById('coinTransferCurrent');
        const maxSpan = document.getElementById('coinTransferMax');
        const input = document.getElementById('coinTransferInput');
        const errorElement = document.getElementById('coinTransferError');
        const confirmBtn = document.getElementById('coinTransferConfirm');
        const cancelBtn = document.getElementById('coinTransferCancel');

        // Update dialog text for crate->backpack direction
        infoElement.innerHTML = 'Current coins in storage: <span id="coinTransferCurrent">0</span>';
        const updatedCurrentSpan = document.getElementById('coinTransferCurrent');
        updatedCurrentSpan.textContent = crateItem.quantity;
        maxSpan.textContent = `(Max: ${crateItem.quantity})`;
        input.max = crateItem.quantity;
        input.value = Math.min(1, crateItem.quantity);
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
            if (amount > crateItem.quantity) {
                errorElement.textContent = `You only have ${crateItem.quantity} coins in storage`;
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
            // Restore dialog text to default
            infoElement.innerHTML = 'Current coins in backpack: <span id="coinTransferCurrent">0</span>';
            // Clean up drag state and ghost elements
            this._finishDrop();
        };

        // Confirm handler
        const onConfirm = () => {
            const amount = parseInt(input.value);
            if (!validateInput()) return;

            // Add to backpack coins
            const backpackCoin = this.gameState.inventory.items.find(i => i.type === 'coin');
            if (backpackCoin) {
                // Merge with existing coins in backpack
                backpackCoin.quantity = (backpackCoin.quantity || 0) + amount;
                this.gameState.markInventoryDirty();
            } else {
                // Create new coin item in backpack - find first valid position
                const cols = this.gameState.inventory.cols;
                const rows = this.gameState.inventory.rows;
                let placed = false;
                for (let y = 0; y < rows && !placed; y++) {
                    for (let x = 0; x < cols && !placed; x++) {
                        const testItem = { width: 1, height: 1 };
                        if (this._isValidPlacementInGrid(testItem, x, y, 0, this.gameState.inventory.items, cols, rows)) {
                            const newCoin = {
                                id: 'coin_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                                type: 'coin',
                                x: x,
                                y: y,
                                width: 1,
                                height: 1,
                                rotation: 0,
                                quality: 100,
                                durability: 100,
                                quantity: amount,
                                positionContext: 'backpack'
                            };
                            this.gameState.inventory.items.push(newCoin);
                            this.gameState.markInventoryDirty();
                            placed = true;
                        }
                    }
                }
                if (!placed) {
                    errorElement.textContent = 'No space in backpack for coins';
                    errorElement.style.display = 'block';
                    return;
                }
            }

            // Deduct from crate
            crateItem.quantity -= amount;
            if (crateItem.quantity <= 0) {
                // Remove coin item from crate
                const itemIndex = this.crateInventory.items.findIndex(i => i.id === crateItem.id);
                if (itemIndex > -1) {
                    this.crateInventory.items.splice(itemIndex, 1);
                }
            }

            // Immediate save
            this.saveCrateInventory();

            // Close dialog
            dialog.style.display = 'none';
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            input.removeEventListener('input', validateInput);
            // Restore dialog text to default
            infoElement.innerHTML = 'Current coins in backpack: <span id="coinTransferCurrent">0</span>';

            // Clean up drag state and re-render
            this._finishDrop();

            // Show status
            ui.updateStatus(`Transferred ${amount} coins to backpack`);
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    }

    onInventoryKeyDown(event) {
        // Key handlers removed - rotation now via scroll wheel
        if (!this.inventoryPickedItem) return;
    }

    onWheel(event) {
        // Scroll wheel rotates held item
        if (!this.inventoryPickedItem) return;

        event.preventDefault();

        const item = this.inventoryPickedItem;

        // Toggle rotation between 0 and 90
        item.rotation = item.rotation === 0 ? 90 : 0;

        // Re-render to show rotated item
        this.renderInventory();
        if (this.gameState.nearestStructure) {
            this.crateUI.renderCrateInventory();
        }
    }

    // ==========================================
    // DRAG AND DROP - CRATE
    // ==========================================

    onCrateItemMouseDown(event, item, itemWrapper) {
        event.preventDefault();
        event.stopPropagation();

        if (this.inventoryPickedItem) return;

        // Bulk transfer detection (double-click or shift-click)
        const DOUBLE_CLICK_THRESHOLD = 300;
        const BULK_TRANSFER_EXCLUDED = ['ammo', 'coin', 'rifle'];
        const now = Date.now();
        const isDoubleClick = item.id === this._lastClickItemId && (now - this._lastClickTime) < DOUBLE_CLICK_THRESHOLD;
        const isShiftClick = event.shiftKey;

        if ((isDoubleClick || (isShiftClick && this.crateInventory)) && !BULK_TRANSFER_EXCLUDED.includes(item.type)) {
            this._lastClickTime = 0;
            this._lastClickItemId = null;
            this._handleBulkTransfer(item.type, 'toBackpack');
            return;
        }

        this._lastClickTime = now;
        this._lastClickItemId = item.id;

        this.tooltipUI.hideTooltip();

        const crateItems = document.getElementById('crateItems');
        this._startItemDrag(item, 'crate', event, crateItems);
    }

    // ==========================================
    // DELEGATED METHODS (pass-through to sub-UIs)
    // ==========================================

    updateConstructionSection() {
        this.constructionUI.updateConstructionSection();
    }

    updateProgressBars() {
        return this.crateUI.updateProgressBars();
    }

    updateCrateSection() {
        this.crateUI.updateCrateSection();
    }

    renderCrateInventory() {
        this.crateUI.renderCrateInventory();
    }

    showTooltip(event, item) {
        this.tooltipUI.showTooltip(event, item);
    }

    hideTooltip() {
        this.tooltipUI.hideTooltip();
    }

    updateTooltipPosition(event) {
        this.tooltipUI.updateTooltipPosition(event);
    }

    /**
     * Calculate how many inventory slots are needed for N items
     * @param {string} itemType - Type of item
     * @param {number} quantity - Number of items
     * @returns {number} Number of slots needed
     */
    calculateInventorySpaceNeeded(itemType, quantity) {
        // Get item size
        const { width, height } = getItemSize(itemType);
        return quantity * (width * height);
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
            const itemSize = (item.width && item.height) ? item : getItemSize(item.type);
            usedSlots += itemSize.width * itemSize.height;
        }
        return usedSlots;
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
            // Get item dimensions with fallback for items missing width/height
            const itemSize = (item.width && item.height) ? item : getItemSize(item.type);
            // Check if items overlap
            if (!(x >= item.x + itemSize.width ||
                  x + width <= item.x ||
                  y >= item.y + itemSize.height ||
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
        // Use fallback for items missing width/height
        const itemSize = (item.width && item.height) ? item : getItemSize(item.type);
        const displayWidth = item.rotation === 90 ? itemSize.height : itemSize.width;
        const displayHeight = item.rotation === 90 ? itemSize.width : itemSize.height;

        const { widthPx, heightPx } = GridUIHelpers.calculateItemSize(displayWidth, displayHeight, slotSize, gap);

        itemEl.style.width = widthPx + 'px';
        itemEl.style.height = heightPx + 'px';
        itemWrapper.style.width = widthPx + 'px';
        itemWrapper.style.height = heightPx + 'px';
        // Event handlers delegated to #inventoryItems in initializeEventDelegation()

        // Assemble: add image to wrapper
        itemWrapper.appendChild(itemEl);

        // Add quantity display for coins and ammo (must be after image to appear on top)
        if (item.type === 'coin' && item.quantity) {
            itemWrapper.appendChild(this._createQuantityLabel(item.quantity));
        }
        if (item.type === 'ammo' && item.quantity) {
            itemWrapper.appendChild(this._createQuantityLabel(item.quantity));
        }

        container.appendChild(itemWrapper);
    }

    /**
     * ISSUE-095 FIX: Create a new backpack item element and cache it
     * @param {Object} item - The inventory item
     * @param {HTMLElement} container - The container to append to
     */
    _createBackpackItemElement(item, container) {
        const { slotSize, gap } = this.gameState.inventory;

        // Create container wrapper for image + quantity label
        const wrapper = document.createElement('div');
        wrapper.className = 'inventory-item-wrapper';
        wrapper.dataset.itemId = item.id;
        wrapper.style.position = 'absolute';

        // Create image element
        const img = document.createElement('img');
        img.className = 'inventory-item';
        img.style.position = 'relative';
        img.draggable = false;

        // Create quantity label (hidden by default)
        const label = document.createElement('div');
        label.className = 'item-quantity-label';
        label.style.display = 'none';
        Object.assign(label.style, {
            position: 'absolute', bottom: '4px', right: '4px',
            background: 'transparent', color: 'white',
            padding: '2px 6px', borderRadius: '4px',
            fontSize: '12px', fontWeight: 'bold', pointerEvents: 'none',
            textShadow: '1px 1px 2px black, -1px -1px 2px black, 1px -1px 2px black, -1px 1px 2px black'
        });

        wrapper.appendChild(img);
        wrapper.appendChild(label);
        container.appendChild(wrapper);

        // Cache the elements
        this._backpackElements.set(item.id, { wrapper, img, label });

        // Apply current state
        this._updateBackpackItemElement(item);
    }

    /**
     * ISSUE-095 FIX: Update an existing backpack item element in place
     * @param {Object} item - The inventory item with current state
     */
    _updateBackpackItemElement(item) {
        const cached = this._backpackElements.get(item.id);
        if (!cached) return;

        const { wrapper, img, label } = cached;
        const { slotSize, gap } = this.gameState.inventory;

        // Ensure element is visible (may have been hidden when picked)
        wrapper.style.display = '';

        // Update position
        const pixelPos = this.gridToPixel(item.x, item.y);
        wrapper.style.left = pixelPos.x + 'px';
        wrapper.style.top = pixelPos.y + 'px';

        // Update image source (only if changed to avoid reload)
        const newSrc = `./items/${item.rotation === 90 ? 'R' : ''}${item.type}.png`;
        if (!img.src.endsWith(newSrc)) {
            img.src = newSrc;
        }

        // Calculate and update dimensions (with fallback for items missing width/height)
        const itemSize = (item.width && item.height) ? item : getItemSize(item.type);
        const displayWidth = item.rotation === 90 ? itemSize.height : itemSize.width;
        const displayHeight = item.rotation === 90 ? itemSize.width : itemSize.height;
        const { widthPx, heightPx } = GridUIHelpers.calculateItemSize(displayWidth, displayHeight, slotSize, gap);

        img.style.width = widthPx + 'px';
        img.style.height = heightPx + 'px';
        wrapper.style.width = widthPx + 'px';
        wrapper.style.height = heightPx + 'px';

        // Update chisel/combine target classes
        const isChiselTarget = this.chiselTarget && item.id === this.chiselTarget.id;
        const isCombineTarget = this.combineTarget && item.id === this.combineTarget.id;
        wrapper.classList.toggle('chisel-target', isChiselTarget || isCombineTarget);

        // Update quantity label for coins and ammo
        if ((item.type === 'coin' || item.type === 'ammo') && item.quantity) {
            label.textContent = `×${item.quantity}`;
            label.style.display = '';
        } else {
            label.style.display = 'none';
        }
    }

    /**
     * Clear the backpack element cache (call when inventory is fully reset)
     */
    _clearBackpackElementCache() {
        for (const [, elements] of this._backpackElements) {
            elements.wrapper.remove();
        }
        this._backpackElements.clear();
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
        this.chiselTarget = null;

        this._cleanupDragHandlers();

        this.renderInventory();
        if (this.gameState.nearestStructure) {
            this.crateUI.renderCrateInventory();
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
            this.constructionUI.updateConstructionSection();
            this.crateUI.updateCrateSection();
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

    /**
     * Save crate inventory to server with debouncing for performance
     * @param {boolean} immediate - If true, save immediately without debounce
     */
    saveCrateInventory(immediate = false) {
        const crate = this.gameState.nearestStructure;
        if (!crate || !this.crateInventory) return;

        // Mark as dirty
        crate.userData.inventoryDirty = true;

        if (immediate) {
            // Clear any pending debounced save
            if (this.saveDebounceTimer) {
                clearTimeout(this.saveDebounceTimer);
                this.saveDebounceTimer = null;
            }
            this._performCrateSave();
        } else {
            // Debounce: wait 300ms before saving to batch rapid item moves
            if (this.saveDebounceTimer) {
                clearTimeout(this.saveDebounceTimer);
            }
            this.saveDebounceTimer = setTimeout(() => {
                this.saveDebounceTimer = null;
                this._performCrateSave();
            }, 300);
        }
    }

    /**
     * Actually perform the crate save to server
     * @private
     */
    _performCrateSave() {
        const crate = this.gameState.nearestStructure;
        if (!crate || !this.crateInventory) return;

        // BUGFIX: Markets use their own inventory system (buy_item/sell_item),
        // never save via save_crate_inventory to prevent format corruption
        if (crate.userData.modelType === 'market') {
            return;
        }

        // BUGFIX: Construction sites use their own material system
        if (crate.userData.isConstructionSite) {
            return;
        }

        // BUGFIX: Verify we hold the lock for non-tent structures before saving
        // This prevents race conditions where stale inventory could be saved
        const structureType = crate.userData.modelType;
        const structureId = crate.userData.objectId;
        if (structureType !== 'tent') {
            if (!this.crateUI.hasLockOn(structureId)) {
                console.warn(`[_performCrateSave] Prevented save to ${structureId} - no lock held`);
                return;
            }
        }

        // Check server connection before saving
        if (!this.networkManager.isServerConnected()) {
            ui.showToast('Warning: Changes may not be saved - not connected', 'warning');
            return;
        }

        // BUGFIX: Prevent saving if inventory was never loaded from server
        // This prevents overwriting real data with empty inventory on slow connections
        if (!crate.userData.inventoryLoadedFromServer) {
            console.warn(`[_performCrateSave] Prevented save to ${crate.userData.objectId} - inventory not loaded from server`);
            return;
        }

        // Validate position contexts before saving (debug helper)
        this.validateInventoryContext(this.crateInventory.items, crate.userData.modelType);

        // Send save to server
        this.networkManager.sendMessage('save_crate_inventory', {
            crateId: crate.userData.objectId,
            chunkId: `chunk_${crate.userData.chunkKey}`,
            inventory: this.crateInventory
        });

        // Clear dirty flag since we just saved
        crate.userData.inventoryDirty = false;
    }

    // ==========================================
    // BULK TRANSFER METHODS
    // ==========================================

    /**
     * Check if a structure type supports bulk transfer
     * @param {string} structureType - The structure type (e.g., 'crate', 'bakery')
     * @param {string} direction - 'toStructure' or 'toBackpack'
     * @returns {boolean}
     */
    _isBulkTransferSupported(structureType, direction) {
        const supported = new Set([
            'crate', 'house', 'tent', 'campfire',
            'bakery', 'tileworks', 'blacksmith', 'ironworks',
            'artillery', 'fisherman', 'apple'
        ]);

        if (!supported.has(structureType)) return false;

        // Apple tree only supports transfer OUT (to backpack), not IN
        if (structureType === 'apple' && direction === 'toStructure') {
            return false;
        }

        return true;
    }

    /**
     * Get the list of allowed items for a structure type
     * @param {string} structureType
     * @returns {string[]|null} Array of allowed types, or null for "accepts all"
     */
    _getStructureAllowedItems(structureType) {
        switch (structureType) {
            case 'bakery':
                return ['apple', 'appletart', '*firewood'];
            case 'tileworks':
                return ['clay', 'tile', '*firewood'];
            case 'blacksmith':
                return ['ironingot', 'parts', '*firewood'];
            case 'ironworks':
                return ['iron', 'ironingot', '*firewood'];
            case 'artillery':
                return ['shell']; // Shell ONLY - no firewood
            case 'fisherman':
                return ['fish', 'cookedfish', '*firewood'];
            case 'apple':
                return []; // Apple tree: no items accepted IN
            case 'crate':
            case 'house':
            case 'tent':
            case 'campfire':
                return null; // null = accepts all items
            default:
                return []; // Empty = accepts nothing
        }
    }

    /**
     * Check if a structure accepts a specific item type
     * @param {string} structureType
     * @param {string} itemType
     * @returns {boolean}
     */
    _structureAcceptsItem(structureType, itemType) {
        const allowed = this._getStructureAllowedItems(structureType);
        if (allowed === null) return true; // Accepts all
        if (allowed.length === 0) return false; // Accepts none

        // Check for firewood wildcard
        if (allowed.includes('*firewood') && itemType.endsWith('firewood')) {
            return true;
        }

        return allowed.includes(itemType);
    }

    /**
     * Find a valid placement for an item in an inventory grid
     * @param {Object} item - The item to place
     * @param {Object} inventory - The target inventory with items array
     * @param {number} cols - Grid columns
     * @param {number} rows - Grid rows
     * @returns {{x: number, y: number, rotation: number}|null}
     */
    _findValidPlacement(item, inventory, cols, rows) {
        const itemSize = getItemSize(item.type);
        const width = itemSize.width;
        const height = itemSize.height;

        // Try each position (unrotated, rotation: 0)
        for (let y = 0; y <= rows - height; y++) {
            for (let x = 0; x <= cols - width; x++) {
                if (this._isValidPlacementInGrid(item, x, y, 0, inventory.items, cols, rows)) {
                    return { x, y, rotation: 0 };
                }
            }
        }

        // Try rotated (swap width/height) if not square
        if (width !== height) {
            for (let y = 0; y <= rows - width; y++) {
                for (let x = 0; x <= cols - height; x++) {
                    if (this._isValidPlacementInGrid(item, x, y, 90, inventory.items, cols, rows)) {
                        return { x, y, rotation: 90 };
                    }
                }
            }
        }

        return null; // No valid placement found
    }

    /**
     * Handle bulk transfer of items between backpack and structure
     * @param {string} itemType - The type of item to transfer
     * @param {string} direction - 'toStructure' or 'toBackpack'
     */
    _handleBulkTransfer(itemType, direction) {
        const nearestStructure = this.gameState.nearestStructure;
        if (!nearestStructure) return;

        // Check crate inventory is loaded (required for both directions)
        if (!this.crateInventory) return;

        const structureType = nearestStructure.userData.modelType;

        // Check ownership for owner-protected structures
        const ownerProtectedStructures = ['house', 'tileworks', 'ironworks', 'blacksmith', 'bakery', 'fisherman'];
        if (ownerProtectedStructures.includes(structureType) && nearestStructure.userData?.owner) {
            const owner = nearestStructure.userData.owner;
            const isOwner = (owner === this.gameState.clientId || owner === this.gameState.accountId);
            if (!isOwner) {
                ui.showToast(`Not your ${structureType}`, 'warning');
                return;
            }
        }

        // Check if structure is sold to proprietor
        const isSoldToProprietor = nearestStructure.userData?.proprietor === 'npc';
        const workerStructureTypes = ['bakery', 'blacksmith', 'ironworks', 'tileworks', 'fisherman'];
        if (isSoldToProprietor && workerStructureTypes.includes(structureType)) {
            ui.showToast('Owned by proprietor', 'warning');
            return;
        }

        // Check if bulk transfer is supported for this structure and direction
        if (!this._isBulkTransferSupported(structureType, direction)) {
            return;
        }

        // Check structure accepts this item type (for toStructure direction)
        if (direction === 'toStructure' && !this._structureAcceptsItem(structureType, itemType)) {
            const displayName = getItemDisplayName(itemType);
            ui.showToast(`${structureType} doesn't accept ${displayName}`, 'warning');
            return;
        }

        const sourceInventory = direction === 'toStructure'
            ? this.gameState.inventory
            : this.crateInventory;

        // Get target grid dimensions
        let cols, rows;
        if (direction === 'toStructure') {
            const structureProps = CONFIG.CONSTRUCTION.STRUCTURE_PROPERTIES[structureType];
            cols = structureProps?.inventorySize?.cols || 10;
            rows = structureProps?.inventorySize?.rows || 10;
        } else {
            // Backpack dimensions from config
            cols = CONFIG.INVENTORY.BACKPACK_COLS;  // 5
            rows = CONFIG.INVENTORY.BACKPACK_ROWS;  // 10
        }

        // Count items of this type in source (skip items currently processing/cooking)
        const sourceItems = sourceInventory.items.filter(i =>
            i.type === itemType &&
            !i.cookingStartTick &&      // tick-based cooking
            !i.processingStartTick &&   // tick-based processing
            !i.cookingStartTime &&      // legacy time-based cooking
            !i.processingStartTime      // legacy time-based processing
        );
        if (sourceItems.length === 0) return;

        const sourceItemIds = sourceItems.map(i => i.id);

        // Mark inventory dirty to prevent server updates during transfer
        if (nearestStructure) {
            nearestStructure.userData.inventoryDirty = true;
        }

        const targetInventory = direction === 'toStructure'
            ? this.crateInventory
            : this.gameState.inventory;

        if (!targetInventory) return;

        // Execute transfer - try to place as many as possible
        let transferred = 0;
        let attempted = 0;
        for (const itemId of sourceItemIds) {
            const item = sourceInventory.items.find(i => i.id === itemId);
            if (!item) continue;
            attempted++;

            const placement = this._findValidPlacement(item, targetInventory, cols, rows);
            if (placement) {
                // Remove from source
                const idx = sourceInventory.items.findIndex(i => i.id === itemId);
                if (idx > -1) sourceInventory.items.splice(idx, 1);

                // Add to target with new position
                item.x = placement.x;
                item.y = placement.y;
                item.rotation = placement.rotation;
                item.positionContext = direction === 'toStructure' ? structureType : 'backpack';

                // Snapshot firewood durability when leaving a burning structure
                if (direction === 'toBackpack' && item.type && item.type.endsWith('firewood') && item.placedAtTick) {
                    const currentDurability = this.crateUI._calculateFirewoodDurability(item);
                    item.durability = Math.max(0, Math.floor(currentDurability));
                    delete item.placedAtTick;
                }

                targetInventory.items.push(item);
                transferred++;
            }
        }

        // Save and update UI
        if (transferred > 0) {
            this.saveCrateInventory();
            this.gameState.markInventoryDirty();
            this.renderInventory();
            if (this.gameState.nearestStructure) {
                this.crateUI.renderCrateInventory();
            }

            // Notify tasks panel when items moved to backpack
            if (direction === 'toBackpack') {
                const items = this.gameState.inventory.items;
                window.tasksPanel?.onItemAdded(itemType, items.filter(i => i.type === itemType).length);
            }
        }

        // Show result
        const displayName = getItemDisplayName(itemType);
        const didntFit = attempted - transferred;
        if (transferred === 0) {
            ui.updateStatus(`No space for ${displayName}`);
        } else if (didntFit > 0) {
            ui.updateStatus(`Transferred ${transferred} ${displayName} (${didntFit} didn't fit)`);
        } else {
            ui.updateStatus(`Transferred ${transferred} ${displayName}`);
        }
    }

}

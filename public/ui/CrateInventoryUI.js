// File: public/ui/CrateInventoryUI.js
// Crate inventory rendering extracted from InventoryUI.js
// Handles crate section display, inventory rendering, and progress bars

import { CONFIG } from '../config.js';
import { ui } from '../ui.js';
import { GridUIHelpers } from './GridUIHelpers.js';

/**
 * CrateInventoryUI handles crate-related inventory display
 * Receives reference to parent InventoryUI for shared state and methods
 */
export class CrateInventoryUI {
    constructor(inventoryUI) {
        this.inventoryUI = inventoryUI;

        // Convenience references (from parent)
        this.gameState = inventoryUI.gameState;
        this.networkManager = inventoryUI.networkManager;

        // Lock state tracking
        this.lockState = {
            pending: false,           // Waiting for lock response
            held: false,              // Currently holding a lock
            structureId: null,        // ID of locked structure
            chunkId: null,            // Chunk of locked structure
            lockTime: null,           // Server lock timestamp
            confirmTimer: null        // Timer for double-check confirmation
        };

        // Progress bar optimization - only update once per tick
        this._lastProgressTick = -1;
    }

    /**
     * Request a lock on a structure's inventory
     * Shows loading state while waiting for server response
     */
    requestLock(structure) {
        if (this.lockState.pending) {
            console.log('Lock request already pending');
            return;
        }

        const structureId = structure.userData.objectId;
        const chunkId = `chunk_${structure.userData.chunkKey}`;

        this.lockState.pending = true;
        this.lockState.structureId = structureId;
        this.lockState.chunkId = chunkId;

        // Show loading state
        this._showLoadingState();

        // Request lock from server
        this.networkManager.sendMessage('lock_inventory', {
            structureId: structureId,
            chunkId: chunkId,
            position: [structure.position.x, structure.position.y, structure.position.z],
            scale: structure.scale?.x || 1,
            rotation: structure.rotation?.y ? (structure.rotation.y * 180 / Math.PI) : 0
        });

        console.log(`Requesting lock for ${structureId}`);
    }

    /**
     * Handle lock response from server
     */
    handleLockResponse(payload) {
        const { structureId, success, inventory, lockTime, reason } = payload;

        // Ignore if not for our pending request
        if (structureId !== this.lockState.structureId) {
            console.log(`Ignoring lock response for ${structureId}, waiting for ${this.lockState.structureId}`);
            return;
        }

        this.lockState.pending = false;
        this._hideLoadingState();

        if (success) {
            // Lock acquired
            this.lockState.held = true;
            this.lockState.lockTime = lockTime;

            // Store inventory on structure
            const structure = this.gameState.nearestStructure;
            if (structure && structure.userData.objectId === structureId) {
                structure.userData.inventory = inventory;

                // Process inventory on load - remove depleted firewood
                const structureType = structure.userData?.modelType;
                if (structureType === 'campfire' || structureType === 'house' || structureType === 'tileworks') {
                    this._processInventoryOnLoad(structure, inventory);
                }

                this.renderCrateInventory();
            } else {
                // Fallback: nearestStructure changed during async lock request
                // Try to update the structure via object registry to keep data consistent
                const structureFromRegistry = this.inventoryUI.game?.objectRegistry?.get(structureId);
                if (structureFromRegistry) {
                    structureFromRegistry.userData.inventory = inventory;
                    console.log(`Lock response: Updated inventory via registry fallback for ${structureId}`);
                }
                // Don't render since we're not near the structure anymore
            }

            // Start double-check confirmation timer (1.5 seconds)
            this._startLockConfirmTimer();

            console.log(`Lock acquired for ${structureId}`);
        } else {
            // Lock denied
            this.lockState.held = false;
            this.lockState.structureId = null;
            this.lockState.chunkId = null;

            // Show error message
            if (window.game?.chatSystem) {
                window.game.chatSystem.addSystemMessage(reason || 'Cannot access this storage', 'error');
            }

            // Hide crate section
            const crateSection = document.getElementById('crateSection');
            if (crateSection) crateSection.style.display = 'none';

            console.log(`Lock denied for ${structureId}: ${reason}`);
        }
    }

    /**
     * Handle lock confirmation response (double-check)
     */
    handleLockConfirmResponse(payload) {
        const { structureId, confirmed, reason } = payload;

        if (structureId !== this.lockState.structureId) return;

        if (!confirmed) {
            // Lost the lock - close inventory
            console.log(`Lock lost for ${structureId}: ${reason}`);

            if (window.game?.chatSystem) {
                window.game.chatSystem.addSystemMessage('Lost access to storage', 'error');
            }

            this.releaseLock();
            this.inventoryUI.closeCrateInventory();
        } else {
            // Lock still held - schedule another confirmation
            this._startLockConfirmTimer();
        }
    }

    /**
     * Start timer to double-check lock is still held
     */
    _startLockConfirmTimer() {
        this._clearLockConfirmTimer();

        this.lockState.confirmTimer = setTimeout(() => {
            if (this.lockState.held && this.lockState.structureId) {
                this.networkManager.sendMessage('confirm_lock', {
                    structureId: this.lockState.structureId,
                    chunkId: this.lockState.chunkId
                });
            }
        }, 1500); // 1.5 seconds
    }

    /**
     * Clear the lock confirmation timer
     */
    _clearLockConfirmTimer() {
        if (this.lockState.confirmTimer) {
            clearTimeout(this.lockState.confirmTimer);
            this.lockState.confirmTimer = null;
        }
    }

    /**
     * Release the current lock
     */
    releaseLock() {
        this._clearLockConfirmTimer();

        if (this.lockState.held && this.lockState.structureId) {
            this.networkManager.sendMessage('unlock_inventory', {
                structureId: this.lockState.structureId,
                chunkId: this.lockState.chunkId
            });
            console.log(`Released lock for ${this.lockState.structureId}`);
        }

        // Reset state
        this.lockState.pending = false;
        this.lockState.held = false;
        this.lockState.structureId = null;
        this.lockState.chunkId = null;
        this.lockState.lockTime = null;

        // BUGFIX: Clear crateInventory to prevent accidental saves to wrong structure
        this.inventoryUI.crateInventory = null;
    }

    /**
     * Show loading indicator while waiting for lock
     */
    _showLoadingState() {
        const crateSection = document.getElementById('crateSection');
        if (!crateSection) return;

        crateSection.style.display = 'block';

        const crateGrid = document.getElementById('crateGrid');
        const crateItems = document.getElementById('crateItems');

        if (crateGrid) crateGrid.innerHTML = '';
        if (crateItems) {
            crateItems.innerHTML = '<div style="text-align: center; padding: 40px; color: #aaa;">Loading...</div>';
        }
    }

    /**
     * Hide loading indicator
     */
    _hideLoadingState() {
        const crateItems = document.getElementById('crateItems');
        if (crateItems && crateItems.innerHTML.includes('Loading...')) {
            crateItems.innerHTML = '';
        }
    }

    /**
     * Check if we currently hold a lock on the given structure
     */
    hasLockOn(structureId) {
        return this.lockState.held && this.lockState.structureId === structureId;
    }

    // ==========================================
    // CRATE SECTION VISIBILITY
    // ==========================================

    updateCrateSection() {
        // Show/hide crate section based on proximity to crate AND not moving
        const crateSection = document.getElementById('crateSection');
        if (!crateSection) return;

        const shouldShow = this.gameState.nearestStructure &&
                           !this.gameState.isMoving &&
                           this.gameState.inventoryOpen &&
                           this.gameState.nearestStructure.userData?.modelType !== 'dock' &&
                           this.gameState.nearestStructure.userData?.modelType !== 'outpost' &&
                           !this.gameState.nearestStructure.userData?.isConstructionSite;

        if (shouldShow) {
            const crate = this.gameState.nearestStructure;
            const structureId = crate.userData.objectId;

            // If we have a lock on a DIFFERENT structure, release it
            if (this.lockState.held && this.lockState.structureId !== structureId) {
                this.releaseLock();
            }

            // Check ownership for houses (client-side pre-check)
            if (!this.inventoryUI.isHouseOwner(crate)) {
                // Not the owner - hide crate section and show error
                crateSection.style.display = 'none';
                ui.updateStatus('Cannot access - not your house');
                return;
            }

            // Update title based on structure type
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
                    'campfire': 'Campfire',
                    'tileworks': 'Tileworks'
                };
                titleElement.textContent = titleMap[structureType] || 'Storage';
            }

            // Notify tasks panel that structure inventory was opened
            if (window.tasksPanel) {
                window.tasksPanel.onStructureInventoryOpened(structureType);
            }

            // Check if we already have a lock on this structure
            if (this.hasLockOn(structureId)) {
                // Already have lock - just render
                crateSection.style.display = 'block';
                this.renderCrateInventory();
                return;
            }

            // Check if we're waiting for a lock on this structure
            if (this.lockState.pending && this.lockState.structureId === structureId) {
                // Still waiting - loading state is already shown
                return;
            }

            // Request lock (which will also return inventory data)
            this.requestLock(crate);
        } else {
            crateSection.style.display = 'none';

            // Release lock if we're moving away or closing
            if (this.lockState.held) {
                this.releaseLock();
            }
        }
    }

    // ==========================================
    // PROGRESS BARS (Cooking/Processing)
    // ==========================================

    /**
     * Process inventory when first loaded - remove depleted firewood and complete cooking
     * Called when lock is acquired and inventory received
     * @param {object} structure - The structure object
     * @param {object} inventory - The inventory object
     */
    _processInventoryOnLoad(structure, inventory) {
        if (!inventory?.items || !Array.isArray(inventory.items)) return;

        const items = inventory.items;
        const structureId = structure.userData.objectId;
        const chunkId = `chunk_${structure.userData.chunkKey}`;
        const depletedFirewood = [];
        const completedCooking = [];
        let needsSave = false;

        // Find depleted firewood
        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            if (item.type && item.type.endsWith('firewood') && item.placedAtTick) {
                const currentDurability = this._calculateFirewoodDurability(item);
                if (currentDurability <= 0) {
                    depletedFirewood.push({ item, index: i });
                }
            }
        }

        // Remove depleted firewood
        for (const { item, index } of depletedFirewood) {
            items.splice(index, 1);
            console.log(`[Tick] On load: Firewood ${item.id} was depleted, removing`);
            needsSave = true;
        }

        // Check for completed cooking/processing (tick-based)
        const hasFirewoodNow = items.some(i => i.type && i.type.endsWith('firewood') && i.durability > 0);
        const completedProcessing = [];
        for (const item of items) {
            // Check cooking (campfire/house)
            if (item.cookingStartTick && item.cookingDurationTicks) {
                const currentTick = this.gameState.serverTick || 0;
                const ticksElapsed = currentTick - item.cookingStartTick;
                const progress = ticksElapsed / item.cookingDurationTicks;

                if (progress >= 1.0) {
                    // Cooking completed while player was away - send completion message
                    completedCooking.push(item);
                }
            }
            // Check processing (tileworks)
            if (item.processingStartTick && item.processingDurationTicks) {
                const currentTick = this.gameState.serverTick || 0;
                const ticksElapsed = currentTick - item.processingStartTick;
                const progress = ticksElapsed / item.processingDurationTicks;

                if (progress >= 1.0) {
                    // Processing completed while player was away - send completion message
                    completedProcessing.push(item);
                }
            }
        }

        // Send cooking_complete messages for items that finished while away
        for (const item of completedCooking) {
            this.networkManager.sendMessage('cooking_complete', {
                structureId,
                itemId: item.id,
                chunkId
            });
            console.log(`[Tick] On load: Sent cooking_complete for ${item.type} (${item.id}) - finished while away`);
        }

        // Send processing_complete messages for tileworks items that finished while away
        for (const item of completedProcessing) {
            this.networkManager.sendMessage('processing_complete', {
                structureId,
                itemId: item.id,
                chunkId
            });
            console.log(`[Tick] On load: Sent processing_complete for ${item.type} (${item.id}) - finished while away`);
        }

        // If firewood depleted, cancel any cooking/processing that was in progress
        if (depletedFirewood.length > 0) {
            for (const item of items) {
                // Clear tick-based cooking
                if (item.cookingStartTick) {
                    delete item.cookingStartTick;
                    delete item.cookingDurationTicks;
                    needsSave = true;
                }
                // Clear tick-based processing (tileworks)
                if (item.processingStartTick) {
                    delete item.processingStartTick;
                    delete item.processingDurationTicks;
                    needsSave = true;
                }
                // Clear legacy cooking
                if (item.cookingStartTime) {
                    delete item.cookingStartTime;
                    delete item.estimatedCompletionTime;
                    needsSave = true;
                }
                // Clear legacy processing
                if (item.processingStartTime) {
                    delete item.processingStartTime;
                    delete item.estimatedCompletionTime;
                    needsSave = true;
                }
            }
        }

        // Notify server to persist these changes
        if (needsSave) {
            this.networkManager.sendMessage('save_crate_inventory', {
                crateId: structureId,
                chunkId: chunkId,
                inventory: inventory
            });

            console.log(`[Tick] On load: Processed inventory for ${structureId}`);
        }
    }

    /**
     * Calculate current firewood durability based on tick elapsed
     * @param {object} item - Firewood item with durability and placedAtTick
     * @returns {number} Current calculated durability
     */
    _calculateFirewoodDurability(item) {
        if (!item.placedAtTick) {
            // No tick stamp = not burning (in regular inventory)
            return item.durability;
        }

        const currentTick = this.gameState.serverTick || 0;
        const ticksElapsed = currentTick - item.placedAtTick;
        const minutesElapsed = ticksElapsed / 60; // 60 ticks per minute
        // Firewood depletes at 2 durability per minute (matching old server behavior)
        const durabilityLost = minutesElapsed * 2;
        const currentDurability = item.durability - durabilityLost;

        return Math.max(0, currentDurability);
    }

    /**
     * Check if the current crate inventory has firewood with durability
     * @returns {boolean} True if firewood is present
     */
    _hasFirewoodInInventory() {
        if (!this.inventoryUI.crateInventory?.items) return false;
        return this.inventoryUI.crateInventory.items.some(item => {
            if (!item.type || !item.type.endsWith('firewood')) return false;
            const currentDurability = this._calculateFirewoodDurability(item);
            return currentDurability > 0;
        });
    }

    /**
     * Check for depleted firewood and handle removal
     * Called periodically from updateProgressBars
     * @returns {boolean} True if any firewood was depleted
     */
    _checkAndRemoveDepletedFirewood() {
        if (!this.inventoryUI.crateInventory?.items) return false;
        if (!this.gameState.nearestStructure) return false;

        const structure = this.gameState.nearestStructure;
        const structureType = structure.userData?.modelType;

        // Only check burning structures
        if (structureType !== 'campfire' && structureType !== 'house' && structureType !== 'tileworks') {
            return false;
        }

        const items = this.inventoryUI.crateInventory.items;
        const depletedFirewood = [];

        // Find depleted firewood
        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            if (item.type && item.type.endsWith('firewood') && item.placedAtTick) {
                const currentDurability = this._calculateFirewoodDurability(item);
                if (currentDurability <= 0) {
                    depletedFirewood.push({ item, index: i });
                }
            }
        }

        if (depletedFirewood.length === 0) return false;

        // Remove depleted firewood from local inventory
        for (const { item, index } of depletedFirewood) {
            items.splice(index, 1);
            console.log(`[Tick] Firewood ${item.id} depleted and removed locally`);
        }

        // Cancel any active cooking/processing since fire went out
        for (const item of items) {
            // Clear tick-based cooking
            if (item.cookingStartTick) {
                delete item.cookingStartTick;
                delete item.cookingDurationTicks;
            }
            // Clear tick-based processing (tileworks)
            if (item.processingStartTick) {
                delete item.processingStartTick;
                delete item.processingDurationTicks;
            }
            // Clear legacy cooking
            if (item.cookingStartTime) {
                delete item.cookingStartTime;
                delete item.estimatedCompletionTime;
            }
            // Clear legacy processing
            if (item.processingStartTime) {
                delete item.processingStartTime;
                delete item.estimatedCompletionTime;
            }
        }

        // Notify server to persist the changes
        const structureId = structure.userData.objectId;
        const chunkId = `chunk_${structure.userData.chunkKey}`;

        this.networkManager.sendMessage('save_crate_inventory', {
            crateId: structureId,
            chunkId: chunkId,
            inventory: this.inventoryUI.crateInventory
        });

        console.log(`[Tick] Notified server of firewood depletion in ${structureId}`);

        // Trigger re-render
        this.renderCrateInventory();

        return true;
    }

    /**
     * Update progress bars for items being cooked/processed
     * Called periodically from game loop - optimized to only run on tick changes
     */
    updateProgressBars() {
        if (!this.gameState.inventoryOpen || !this.gameState.nearestStructure) return;

        const currentTick = this.gameState.serverTick || 0;

        // Only update when tick changes (once per second instead of 60fps)
        if (this._lastProgressTick === currentTick) return;
        this._lastProgressTick = currentTick;

        const crateItems = document.getElementById('crateItems');
        if (!crateItems) return;

        // Check for and remove depleted firewood (tick-based calculation)
        this._checkAndRemoveDepletedFirewood();

        // Check if firewood is present - cooking/processing requires active fire
        const hasFirewood = this._hasFirewoodInInventory();

        let hasActiveProgress = false;

        // Update all items with progress bars
        const itemWrappers = crateItems.querySelectorAll('[data-has-progress="true"]');
        for (const wrapper of itemWrappers) {
            const itemId = wrapper.dataset.itemId;
            const item = this.inventoryUI.crateInventory?.items.find(i => i.id === itemId);

            // Check for tick-based cooking/processing
            const hasCooking = item && (item.cookingStartTick || item.processingStartTick);
            if (!hasCooking) {
                continue;
            }

            const progressBar = wrapper.querySelector('.item-progress-bar');

            // If no firewood, pause progress bar (show greyed out state)
            if (!hasFirewood) {
                if (progressBar) {
                    progressBar.style.backgroundColor = '#666';
                    progressBar.style.opacity = '0.5';
                }
                continue;
            }

            hasActiveProgress = true;

            let progress;
            let isProcessing = false;

            // Calculate progress from tick-based fields
            if (item.cookingStartTick && item.cookingDurationTicks) {
                const ticksElapsed = currentTick - item.cookingStartTick;
                progress = Math.min(1.0, ticksElapsed / item.cookingDurationTicks);
            } else if (item.processingStartTick && item.processingDurationTicks) {
                const ticksElapsed = currentTick - item.processingStartTick;
                progress = Math.min(1.0, ticksElapsed / item.processingDurationTicks);
                isProcessing = true;
            } else {
                continue; // No valid tick data
            }

            if (progressBar) {
                progressBar.style.width = `${progress * 100}%`;
                progressBar.style.backgroundColor = isProcessing ? '#4caf50' : '#ff9800';
                progressBar.style.opacity = '1';
            }

            // Send completion message when done
            if (progress >= 1.0 && !item._completionSent) {
                item._completionSent = true;

                const structure = this.gameState.nearestStructure;
                if (structure) {
                    const structureId = structure.userData.objectId;
                    const chunkId = `chunk_${structure.userData.chunkKey}`;
                    const messageType = isProcessing ? 'processing_complete' : 'cooking_complete';

                    this.networkManager.sendMessage(messageType, {
                        structureId,
                        itemId: item.id,
                        chunkId
                    });

                    console.log(`[Tick] Sent ${messageType} for ${item.type} (${item.id})`);
                }
            }
        }

        return hasActiveProgress;
    }

    // ==========================================
    // CRATE INVENTORY RENDERING
    // ==========================================

    renderCrateInventory() {
        if (!this.gameState.nearestStructure) return;

        const crate = this.gameState.nearestStructure;
        const structureType = crate.userData.modelType;

        // Market uses special list view
        if (structureType === 'market') {
            // BUGFIX: Clear crateInventory to prevent save_crate_inventory
            // from accidentally overwriting market with old crate data
            this.inventoryUI.crateInventory = null;
            this.inventoryUI.marketUI.renderMarketInventory();
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

        // Performance optimization: Only recreate slots if grid size changed
        const neededSlots = rows * cols;
        const currentSlotCount = crateGrid.children.length;
        const sizeChanged = currentSlotCount !== neededSlots ||
                           crateGrid.dataset.slotSize !== String(slotSize);

        if (sizeChanged) {
            // Use DocumentFragment for batch DOM insert (single reflow)
            const fragment = document.createDocumentFragment();
            crateGrid.innerHTML = '';

            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    const slot = document.createElement('div');
                    slot.className = 'crate-slot';
                    slot.dataset.row = row;
                    slot.dataset.col = col;
                    slot.style.width = `${slotSize}px`;
                    slot.style.height = `${slotSize}px`;
                    fragment.appendChild(slot);
                }
            }
            crateGrid.appendChild(fragment);
            crateGrid.dataset.slotSize = slotSize;
        }

        // Render items
        const crateItems = document.getElementById('crateItems');
        if (!crateItems) return;

        // Save hovered item ID and timestamp before clearing (to restore tooltip after re-render)
        const previousHoveredItemId = this.inventoryUI.tooltipUI.hoveredItemId;
        const previousMouseEvent = this.inventoryUI.tooltipUI.lastMouseEvent;
        const preRenderTimestamp = this.inventoryUI.tooltipUI.tooltipTimestamp;

        this.inventoryUI.hideTooltip(); // Hide tooltip before clearing items
        crateItems.innerHTML = '';

        // Store reference to crate inventory for later use
        this.inventoryUI.crateInventory = crateInventory;

        // Render each item
        for (const item of crateInventory.items) {
            this.renderCrateItem(item, crateItems);
        }

        // Render picked item as ghost following cursor (if target is crate)
        if (this.inventoryUI.inventoryPickedItem && this.inventoryUI.inventoryPickedTarget === 'crate') {
            this.inventoryUI._renderGhostItem(this.inventoryUI.inventoryPickedItem, crateItems, 'crate', this.inventoryUI.inventoryMouseX, this.inventoryUI.inventoryMouseY);
        }

        // Restore tooltip if item still exists after re-render (check both inventories)
        // Skip restoration if a mouseenter event already fired during render (timestamp changed)
        if (previousHoveredItemId && previousMouseEvent && !this.inventoryUI.inventoryPickedItem) {
            // Only restore if no new mouseenter has fired (would have updated timestamp)
            if (this.inventoryUI.tooltipUI.tooltipTimestamp === 0 || this.inventoryUI.tooltipUI.tooltipTimestamp === preRenderTimestamp) {
                const backpackItem = this.gameState.inventory.items.find(i => i.id === previousHoveredItemId);
                const crateItem = crateInventory.items.find(i => i.id === previousHoveredItemId);
                const item = backpackItem || crateItem;
                if (item) {
                    this.inventoryUI.showTooltip(previousMouseEvent, item);
                }
            }
        }
    }

    renderCrateItem(item, container) {
        // Skip rendering picked item in its grid position - will render as ghost
        // Use object reference comparison to identify the exact picked item
        if (this.inventoryUI.inventoryPickedItem && item === this.inventoryUI.inventoryPickedItem) {
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
        itemEl.style.pointerEvents = 'none'; // Let hover events pass through to wrapper

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
        itemWrapper.addEventListener('mousedown', (e) => this.inventoryUI.onCrateItemMouseDown(e, item, itemWrapper));

        // Add hover event listeners for tooltip
        itemWrapper.addEventListener('mouseenter', (e) => this.inventoryUI.showTooltip(e, item));
        itemWrapper.addEventListener('mousemove', (e) => this.inventoryUI.updateTooltipPosition(e));
        itemWrapper.addEventListener('mouseleave', () => this.inventoryUI.hideTooltip());

        itemWrapper.appendChild(itemEl);

        // Add quantity display for coins and ammo in crate (must be after image to appear on top)
        if (item.type === 'coin' && item.quantity) {
            itemWrapper.appendChild(this.inventoryUI._createQuantityLabel(item.quantity));
        }
        if (item.type === 'ammo' && item.quantity) {
            itemWrapper.appendChild(this.inventoryUI._createQuantityLabel(item.quantity));
        }

        // Add processing/cooking progress bar (tick-based)
        const hasCooking = item.cookingStartTick || item.processingStartTick;
        if (hasCooking) {
            const currentTick = this.gameState.serverTick || 0;
            let progress;
            let isProcessing = false;

            if (item.cookingStartTick && item.cookingDurationTicks) {
                const ticksElapsed = currentTick - item.cookingStartTick;
                progress = Math.min(1.0, ticksElapsed / item.cookingDurationTicks);
            } else if (item.processingStartTick && item.processingDurationTicks) {
                const ticksElapsed = currentTick - item.processingStartTick;
                progress = Math.min(1.0, ticksElapsed / item.processingDurationTicks);
                isProcessing = true;
            } else {
                progress = 0;
            }

            const hasFirewood = this._hasFirewoodInInventory();

            // Create progress bar container
            const progressContainer = document.createElement('div');
            progressContainer.className = 'item-progress-container';
            progressContainer.style.position = 'absolute';
            progressContainer.style.bottom = '0px';
            progressContainer.style.left = '0px';
            progressContainer.style.width = '100%';
            progressContainer.style.height = '6px';
            progressContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            progressContainer.style.borderRadius = '0 0 4px 4px';
            progressContainer.style.overflow = 'hidden';
            progressContainer.style.pointerEvents = 'none';

            // Create progress bar fill
            const progressBar = document.createElement('div');
            progressBar.className = 'item-progress-bar';
            progressBar.style.width = `${progress * 100}%`;
            progressBar.style.height = '100%';
            // Show as paused (grey) if no firewood, otherwise normal color
            // Orange for cooking, green for processing
            if (hasFirewood) {
                progressBar.style.backgroundColor = isProcessing ? '#4caf50' : '#ff9800';
                progressBar.style.opacity = '1';
            } else {
                progressBar.style.backgroundColor = '#666'; // Grey = paused
                progressBar.style.opacity = '0.5';
            }
            progressBar.style.transition = 'width 0.1s linear';

            progressContainer.appendChild(progressBar);
            itemWrapper.appendChild(progressContainer);

            // Store reference for updates
            itemWrapper.dataset.hasProgress = 'true';
        }

        container.appendChild(itemWrapper);
    }
}

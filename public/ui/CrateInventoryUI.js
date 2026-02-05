// File: public/ui/CrateInventoryUI.js
// Crate inventory rendering extracted from InventoryUI.js
// Handles crate section display, inventory rendering, and progress bars

import { CONFIG } from '../config.js';
import { ui } from '../ui.js';
import { GridUIHelpers } from './GridUIHelpers.js';
import { getItemSize } from './InventoryHelpers.js';

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

        // Event delegation initialized flag
        this._eventDelegationInit = false;

        // ISSUE-095 FIX: DOM element caching for crate items
        // Maps itemId -> { wrapper, img, label, progressContainer, progressBar }
        this._crateElements = new Map();
    }

    /**
     * Initialize event delegation on crate container.
     * Called ONCE during initialization - fixes ISSUE-094 (event listener accumulation).
     * Handlers attached here survive DOM updates inside #crateItems.
     */
    initializeEventDelegation() {
        if (this._eventDelegationInit) return;
        this._eventDelegationInit = true;

        const crateItems = document.getElementById('crateItems');
        if (!crateItems) return;

        // Mousedown delegation for dragging
        crateItems.addEventListener('mousedown', (e) => {
            const wrapper = e.target.closest('.crate-item-wrapper');
            if (!wrapper) return;

            const itemId = wrapper.dataset.itemId;
            if (!itemId) return;

            const crateInventory = this.inventoryUI.crateInventory;
            if (!crateInventory) return;

            const item = crateInventory.items.find(i => i.id === itemId);
            if (item) {
                this.inventoryUI.onCrateItemMouseDown(e, item, wrapper);
            }
        });

        // Tooltip delegation - mouseenter (capture phase for reliability)
        crateItems.addEventListener('mouseenter', (e) => {
            const wrapper = e.target.closest('.crate-item-wrapper');
            if (!wrapper || this.inventoryUI.inventoryPickedItem) return;

            const itemId = wrapper.dataset.itemId;
            if (!itemId) return;

            const crateInventory = this.inventoryUI.crateInventory;
            if (!crateInventory) return;

            const item = crateInventory.items.find(i => i.id === itemId);
            if (item) {
                this.inventoryUI.showTooltip(e, item);
            }
        }, true);

        // Tooltip delegation - mousemove (capture phase)
        crateItems.addEventListener('mousemove', (e) => {
            const wrapper = e.target.closest('.crate-item-wrapper');
            if (!wrapper || this.inventoryUI.inventoryPickedItem) return;

            this.inventoryUI.updateTooltipPosition(e);
        }, true);

        // Tooltip delegation - mouseleave (capture phase)
        crateItems.addEventListener('mouseleave', (e) => {
            if (e.target.closest('.crate-item-wrapper')) {
                this.inventoryUI.hideTooltip();
            }
        }, true);

        // === CRATE SLING SLOT EVENT DELEGATION ===
        const crateSlingSlot = document.getElementById('crateSlingSlot');
        if (crateSlingSlot) {
            // Mousedown delegation for dragging from crate sling
            crateSlingSlot.addEventListener('mousedown', (e) => {
                const slingItem = e.target.closest('#crateSlingItem');
                if (!slingItem) return;

                const crateInventory = this.inventoryUI.crateInventory;
                const item = crateInventory?.slingItem;
                if (item) {
                    this.onCrateSlingItemMouseDown(e, item);
                }
            });

            // Tooltip delegation - mouseenter
            crateSlingSlot.addEventListener('mouseenter', (e) => {
                const slingItem = e.target.closest('#crateSlingItem');
                if (!slingItem || this.inventoryUI.inventoryPickedItem) return;

                const crateInventory = this.inventoryUI.crateInventory;
                const item = crateInventory?.slingItem;
                if (item) {
                    this.inventoryUI.tooltipUI.showTooltip(e, item);
                }
            }, true);

            // Tooltip delegation - mousemove
            crateSlingSlot.addEventListener('mousemove', (e) => {
                const slingItem = e.target.closest('#crateSlingItem');
                if (!slingItem || this.inventoryUI.inventoryPickedItem) return;

                this.inventoryUI.tooltipUI.updateTooltipPosition(e);
            }, true);

            // Tooltip delegation - mouseleave
            crateSlingSlot.addEventListener('mouseleave', (e) => {
                if (e.target.closest('#crateSlingItem')) {
                    this.inventoryUI.tooltipUI.hideTooltip();
                }
            }, true);
        }
    }

    /**
     * Request a lock on a structure's inventory
     * Shows loading state while waiting for server response
     */
    requestLock(structure) {
        if (this.lockState.pending) {
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
            rotation: structure.rotation?.y || 0 // Radians
        });
    }

    /**
     * Handle lock response from server
     */
    handleLockResponse(payload) {
        const { structureId, success, inventory, lockTime, reason } = payload;

        // Ignore if not for our pending request
        if (structureId !== this.lockState.structureId) {
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
                structure.userData.inventoryLoadedFromServer = true;  // Mark as server-confirmed

                // Process inventory on load - remove depleted firewood
                const structureType = structure.userData?.modelType;
                if (structureType === 'campfire' || structureType === 'house' || structureType === 'tileworks' || structureType === 'bakery') {
                    this._processInventoryOnLoad(structure, inventory);
                }

                this.renderCrateInventory();
            } else {
                // Fallback: nearestStructure changed during async lock request
                // Try to update the structure via object registry to keep data consistent
                const structureFromRegistry = this.inventoryUI.game?.objectRegistry?.get(structureId);
                if (structureFromRegistry) {
                    structureFromRegistry.userData.inventory = inventory;
                    structureFromRegistry.userData.inventoryLoadedFromServer = true;
                }
                // Don't render since we're not near the structure anymore
            }

            // Start double-check confirmation timer (1.5 seconds)
            this._startLockConfirmTimer();
        } else {
            // Lock denied
            this.lockState.held = false;
            this.lockState.structureId = null;
            this.lockState.chunkId = null;

            // BUGFIX: Clear crateInventory to prevent stale data from being saved
            // This prevents race conditions where old inventory data could be saved to a different structure
            this.inventoryUI.crateInventory = null;

            // Clear cached DOM elements since we don't have access
            this._clearCrateElementCache();

            // Show error message directly in the crate section (more visible than toast)
            this._showInUseMessage(reason || 'Cannot access this storage');
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
            if (window.ui) {
                window.ui.showToast('Lost access to storage', 'error');
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

        // Flush any pending debounced save before releasing lock
        if (this.inventoryUI.saveDebounceTimer) {
            clearTimeout(this.inventoryUI.saveDebounceTimer);
            this.inventoryUI.saveDebounceTimer = null;
            // Save now while we still have the lock
            if (this.lockState.held && this.inventoryUI.crateInventory) {
                this.inventoryUI._performCrateSave();
            }
        }

        if (this.lockState.held && this.lockState.structureId) {
            this.networkManager.sendMessage('unlock_inventory', {
                structureId: this.lockState.structureId,
                chunkId: this.lockState.chunkId
            });
        }

        // Reset state
        this.lockState.pending = false;
        this.lockState.held = false;
        this.lockState.structureId = null;
        this.lockState.chunkId = null;
        this.lockState.lockTime = null;

        // BUGFIX: Clear crateInventory to prevent accidental saves to wrong structure
        this.inventoryUI.crateInventory = null;

        // ISSUE-095 FIX: Clear cached DOM elements when switching structures
        this._clearCrateElementCache();
    }

    /**
     * Show loading indicator while waiting for lock
     */
    _showLoadingState() {
        const crateSection = document.getElementById('crateSection');
        if (!crateSection) return;

        crateSection.style.display = 'block';

        const crateGridContainer = document.getElementById('crateGridContainer');
        const crateGrid = document.getElementById('crateGrid');
        const crateItems = document.getElementById('crateItems');

        if (crateGrid) crateGrid.innerHTML = '';
        if (crateItems) crateItems.innerHTML = '';

        // Show loading message in the container (not in absolutely positioned crateItems)
        if (crateGridContainer) {
            // Create or update status message element
            let statusMsg = crateGridContainer.querySelector('.crate-status-message');
            if (!statusMsg) {
                statusMsg = document.createElement('div');
                statusMsg.className = 'crate-status-message';
                crateGridContainer.appendChild(statusMsg);
            }
            statusMsg.innerHTML = '<div style="text-align: center; padding: 40px; color: #aaa;">Loading...</div>';
            statusMsg.style.display = 'block';
        }
    }

    /**
     * Hide loading indicator and status messages
     */
    _hideLoadingState() {
        const crateGridContainer = document.getElementById('crateGridContainer');
        if (crateGridContainer) {
            const statusMsg = crateGridContainer.querySelector('.crate-status-message');
            if (statusMsg) {
                statusMsg.style.display = 'none';
            }
        }
    }

    /**
     * Show "in use" message in the crate section when lock is denied
     * This is more visible than a toast as it appears where the user is looking
     */
    _showInUseMessage(message) {
        const crateSection = document.getElementById('crateSection');
        if (!crateSection) return;

        crateSection.style.display = 'block';

        const crateGridContainer = document.getElementById('crateGridContainer');
        const crateGrid = document.getElementById('crateGrid');
        const crateItems = document.getElementById('crateItems');

        if (crateGrid) crateGrid.innerHTML = '';
        if (crateItems) crateItems.innerHTML = '';

        // Show "in use" message in the container (not in absolutely positioned crateItems)
        if (crateGridContainer) {
            // Create or update status message element
            let statusMsg = crateGridContainer.querySelector('.crate-status-message');
            if (!statusMsg) {
                statusMsg = document.createElement('div');
                statusMsg.className = 'crate-status-message';
                crateGridContainer.appendChild(statusMsg);
            }
            statusMsg.innerHTML = `
                <div style="text-align: center; padding: 30px; color: #FF6B6B;">
                    <div style="font-size: 24px; margin-bottom: 10px;">In Use</div>
                    <div style="font-size: 14px; color: #ccc;">${message}</div>
                </div>
            `;
            statusMsg.style.display = 'block';
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

    updateCrateSection(targetStructure = null) {
        // Show/hide crate section based on proximity to crate AND not moving
        const crateSection = document.getElementById('crateSection');
        if (!crateSection) return;

        // Use passed target structure if available, otherwise fall back to nearestStructure
        // This prevents race conditions when button label and click timing differ
        const structure = targetStructure || this.gameState.nearestStructure;

        const shouldShow = structure &&
                           !this.gameState.isMoving &&
                           this.gameState.inventoryOpen &&
                           structure.userData?.modelType !== 'dock' &&
                           structure.userData?.modelType !== 'outpost' &&
                           structure.userData?.modelType !== 'bearden' &&
                           structure.userData?.modelType !== 'miner' &&
                           structure.userData?.modelType !== 'stonemason' &&
                           structure.userData?.modelType !== 'gardener' &&
                           structure.userData?.modelType !== 'woodcutter' &&
                           structure.userData?.modelType !== 'wall' &&
                           !structure.userData?.isConstructionSite;

        if (shouldShow) {
            const crate = structure;
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
                    'apple': 'Apple Tree',
                    'market': 'Market',
                    'campfire': 'Campfire',
                    'tileworks': 'Tileworks',
                    'ironworks': 'Ironworks',
                    'blacksmith': 'Blacksmith',
                    'bakery': 'Bakery',
                    'artillery': 'Artillery',
                    'corpse': 'Loot Body'
                };
                titleElement.textContent = titleMap[structureType] || 'Storage';

                // Update title with display name for corpses
                if (structureType === 'corpse' && crate.userData.displayName) {
                    titleElement.textContent = `Loot ${crate.userData.displayName}`;
                }
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

            // Check if another player already has this locked (from broadcast)
            // Skip this check for tents (shared access)
            if (structureType !== 'tent' && crate.userData.lockedBy && crate.userData.lockedBy !== this.gameState.clientId) {
                // Another player has this locked - show "In Use" immediately
                crateSection.style.display = 'block';
                this._showInUseMessage('This storage is being used by another player');
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
        }

        // Send processing_complete messages for tileworks items that finished while away
        for (const item of completedProcessing) {
            this.networkManager.sendMessage('processing_complete', {
                structureId,
                itemId: item.id,
                chunkId
            });
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
        if (structureType !== 'campfire' && structureType !== 'house' && structureType !== 'tileworks' && structureType !== 'bakery') {
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
                }
            }
        }

        return hasActiveProgress;
    }

    // ==========================================
    // CRATE INVENTORY RENDERING
    // ==========================================

    renderCrateInventory() {
        // BUGFIX: Use locked structure from registry instead of nearestStructure
        // This prevents race condition where button shows "House" but nearestStructure
        // has changed to a nearby market, causing wrong UI to open
        let crate = null;
        if (this.lockState.held && this.lockState.structureId) {
            crate = this.inventoryUI.game?.objectRegistry?.get(this.lockState.structureId);
        }
        // Fall back to nearestStructure if no lock or structure not in registry
        if (!crate) {
            crate = this.gameState.nearestStructure;
        }
        if (!crate) return;

        // Hide any status message (Loading/In Use) when rendering actual inventory
        this._hideLoadingState();
        const structureType = crate.userData.modelType;

        // Market uses special list view
        if (structureType === 'market') {
            // BUGFIX: Clear crateInventory to prevent save_crate_inventory
            // from accidentally overwriting market with old crate data
            this.inventoryUI.crateInventory = null;
            this.inventoryUI.marketUI.renderMarketInventory(crate);
            return;
        }

        // Hide market-specific UI elements for non-market structures
        this.inventoryUI.marketUI.updateMerchantShipsButtonState();
        this.inventoryUI.marketUI.updateInfluenceDisplay(null);

        // Initialize inventory if it doesn't exist and store it on the crate
        if (!crate.userData.inventory) {
            crate.userData.inventory = { items: [] };
        }
        const crateInventory = crate.userData.inventory;

        // Get structure type and inventory size from config
        const structProps = CONFIG.CONSTRUCTION.STRUCTURE_PROPERTIES[structureType];

        // Show/hide crate sling slot based on structure type
        const hasSlingSlot = structProps?.hasSlingSlot || false;
        this.renderCrateSlingSlot(hasSlingSlot ? crateInventory : null);

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

        // Default to 10x10 if no specific size configured (crate, tent, etc.)
        const rows = structProps?.inventorySize?.rows || 10;
        const cols = structProps?.inventorySize?.cols || 10;

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

        // Save hovered item ID and timestamp before updating (to restore tooltip after re-render)
        const previousHoveredItemId = this.inventoryUI.tooltipUI.hoveredItemId;
        const previousMouseEvent = this.inventoryUI.tooltipUI.lastMouseEvent;
        const preRenderTimestamp = this.inventoryUI.tooltipUI.tooltipTimestamp;

        this.inventoryUI.hideTooltip(); // Hide tooltip before updating items

        // Store reference to crate inventory for later use
        this.inventoryUI.crateInventory = crateInventory;

        // ISSUE-095 FIX: Use element caching instead of innerHTML clearing
        // Track which items currently exist in crate inventory
        const currentItemIds = new Set(crateInventory.items.map(item => item.id));

        // Remove elements for items that no longer exist
        for (const [itemId, elements] of this._crateElements) {
            if (!currentItemIds.has(itemId)) {
                elements.wrapper.remove();
                this._crateElements.delete(itemId);
            }
        }

        // Update or create elements for current items
        for (const item of crateInventory.items) {
            // Skip rendering picked item in its grid position - will render as ghost
            if (this.inventoryUI.inventoryPickedItem && item === this.inventoryUI.inventoryPickedItem) {
                // Hide the element if it exists (don't delete - item will return)
                const cached = this._crateElements.get(item.id);
                if (cached) {
                    cached.wrapper.style.display = 'none';
                }
                continue;
            }

            if (this._crateElements.has(item.id)) {
                this._updateCrateItemElement(item);
            } else {
                this._createCrateItemElement(item, crateItems);
            }
        }

        // Remove any existing ghost elements from crate container only
        // (backpack container manages its own ghosts in renderInventory)
        crateItems.querySelectorAll('.crate-item-wrapper.dragging').forEach(ghost => ghost.remove());

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
        // Use stored dimensions or look up by type for items from server
        const itemSize = (item.width && item.height) ? item : getItemSize(item.type);
        const displayWidth = item.rotation === 90 ? itemSize.height : itemSize.width;
        const displayHeight = item.rotation === 90 ? itemSize.width : itemSize.height;
        const widthPx = displayWidth * slotSize + (displayWidth - 1) * gap;
        const heightPx = displayHeight * slotSize + (displayHeight - 1) * gap;

        itemEl.style.width = widthPx + 'px';
        itemEl.style.height = heightPx + 'px';
        itemWrapper.style.width = widthPx + 'px';
        itemWrapper.style.height = heightPx + 'px';
        // Event handlers delegated to #crateItems in initializeEventDelegation()

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

    /**
     * ISSUE-095 FIX: Create a new crate item element and cache it
     * @param {Object} item - The inventory item
     * @param {HTMLElement} container - The container to append to
     */
    _createCrateItemElement(item, container) {
        const slotSize = this.gameState.inventory.slotSize;
        const gap = this.gameState.inventory.gap;

        // Create container wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'crate-item-wrapper';
        wrapper.dataset.itemId = item.id || `${item.type}_${Math.random()}`;
        wrapper.style.position = 'absolute';

        // Create image element
        const img = document.createElement('img');
        img.className = 'crate-item';
        img.style.position = 'relative';
        img.style.pointerEvents = 'none';
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

        // Create progress bar container (hidden by default)
        const progressContainer = document.createElement('div');
        progressContainer.className = 'item-progress-container';
        progressContainer.style.display = 'none';
        Object.assign(progressContainer.style, {
            position: 'absolute', bottom: '0px', left: '0px',
            width: '100%', height: '6px',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            borderRadius: '0 0 4px 4px', overflow: 'hidden',
            pointerEvents: 'none'
        });

        const progressBar = document.createElement('div');
        progressBar.className = 'item-progress-bar';
        progressBar.style.height = '100%';
        progressBar.style.transition = 'width 0.1s linear';
        progressContainer.appendChild(progressBar);

        wrapper.appendChild(img);
        wrapper.appendChild(label);
        wrapper.appendChild(progressContainer);
        container.appendChild(wrapper);

        // Cache the elements
        this._crateElements.set(item.id, { wrapper, img, label, progressContainer, progressBar });

        // Apply current state
        this._updateCrateItemElement(item);
    }

    /**
     * ISSUE-095 FIX: Update an existing crate item element in place
     * @param {Object} item - The inventory item with current state
     */
    _updateCrateItemElement(item) {
        const cached = this._crateElements.get(item.id);
        if (!cached) return;

        const { wrapper, img, label, progressContainer, progressBar } = cached;
        const slotSize = this.gameState.inventory.slotSize;
        const gap = this.gameState.inventory.gap;

        // Ensure element is visible (may have been hidden when picked)
        wrapper.style.display = '';

        // Update position
        wrapper.style.left = `${item.x * (slotSize + gap)}px`;
        wrapper.style.top = `${item.y * (slotSize + gap)}px`;

        // Update image source (only if changed to avoid reload)
        const newSrc = `./items/${item.rotation === 90 ? 'R' : ''}${item.type}.png`;
        if (!img.src.endsWith(newSrc)) {
            img.src = newSrc;
        }

        // Calculate and update dimensions
        // Use stored dimensions or look up by type for items from server
        const itemSize = (item.width && item.height) ? item : getItemSize(item.type);
        const displayWidth = item.rotation === 90 ? itemSize.height : itemSize.width;
        const displayHeight = item.rotation === 90 ? itemSize.width : itemSize.height;
        const widthPx = displayWidth * slotSize + (displayWidth - 1) * gap;
        const heightPx = displayHeight * slotSize + (displayHeight - 1) * gap;

        img.style.width = widthPx + 'px';
        img.style.height = heightPx + 'px';
        wrapper.style.width = widthPx + 'px';
        wrapper.style.height = heightPx + 'px';

        // Update quantity label for coins and ammo
        if ((item.type === 'coin' || item.type === 'ammo') && item.quantity) {
            label.textContent = `×${item.quantity}`;
            label.style.display = '';
        } else {
            label.style.display = 'none';
        }

        // Update progress bar for cooking/processing
        const hasCooking = item.cookingStartTick || item.processingStartTick;
        if (hasCooking) {
            progressContainer.style.display = '';
            wrapper.dataset.hasProgress = 'true';

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
            progressBar.style.width = `${progress * 100}%`;

            if (hasFirewood) {
                progressBar.style.backgroundColor = isProcessing ? '#4caf50' : '#ff9800';
                progressBar.style.opacity = '1';
            } else {
                progressBar.style.backgroundColor = '#666';
                progressBar.style.opacity = '0.5';
            }
        } else {
            progressContainer.style.display = 'none';
            wrapper.dataset.hasProgress = 'false';
        }
    }

    /**
     * Clear the crate element cache (call when switching structures or closing inventory)
     */
    _clearCrateElementCache() {
        for (const [, elements] of this._crateElements) {
            elements.wrapper.remove();
        }
        this._crateElements.clear();
    }

    // ==========================================
    // CRATE SLING SLOT (for corpse looting)
    // ==========================================

    /**
     * Render the crate sling slot (for structures with hasSlingSlot like corpses)
     * @param {object|null} crateInventory - Inventory with slingItem, or null to hide
     */
    renderCrateSlingSlot(crateInventory) {
        const container = document.getElementById('crateSlingContainer');
        const slingSlot = document.getElementById('crateSlingSlot');
        const slingItemEl = document.getElementById('crateSlingItem');

        if (!container || !slingSlot || !slingItemEl) return;

        if (!crateInventory) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'flex';
        const slingItem = crateInventory.slingItem;

        // Cache elements for efficient updates
        if (!this._crateSlingElements) {
            this._crateSlingElements = {
                container,
                slingSlot,
                slingItemEl,
                img: null
            };
        }

        if (slingItem) {
            slingSlot.classList.add('has-item');

            // Create or update image
            if (!this._crateSlingElements.img) {
                const img = document.createElement('img');
                img.src = './items/Rrifle.png';
                img.alt = 'Rifle';
                img.draggable = false;
                slingItemEl.appendChild(img);
                this._crateSlingElements.img = img;
            } else {
                this._crateSlingElements.img.style.display = '';
            }
        } else {
            slingSlot.classList.remove('has-item');
            if (this._crateSlingElements.img) {
                this._crateSlingElements.img.style.display = 'none';
            }
        }

        // Update drag-over state
        if (this.inventoryUI.inventoryPickedItem && this.inventoryUI.inventoryPickedTarget === 'crateSling') {
            if (this.inventoryUI.inventoryPickedItem.type === 'rifle') {
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

    /**
     * Handle mousedown on crate sling item
     */
    onCrateSlingItemMouseDown(e, item) {
        e.preventDefault();
        e.stopPropagation();

        // Start dragging from crate sling
        this.inventoryUI.inventoryPickedItem = item;
        this.inventoryUI.inventoryPickedSource = 'crateSling';
        this.inventoryUI.inventoryPickedTarget = 'crateSling';
        this.inventoryUI.inventoryPickedOriginalX = 0;
        this.inventoryUI.inventoryPickedOriginalY = 0;
        this.inventoryUI.inventoryPickedOriginalRotation = item.rotation || 90;

        this.inventoryUI.tooltipUI.hideTooltip();

        // Add global event listeners
        this.inventoryUI._setupDragHandlers();

        // Re-render to show ghost
        this.inventoryUI.renderInventory();
        this.renderCrateInventory();
    }
}

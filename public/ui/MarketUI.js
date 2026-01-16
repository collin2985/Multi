// File: public/ui/MarketUI.js
// Market system extracted from InventoryUI.js
// Handles market buy/sell, pricing, and market inventory rendering

import { CONFIG } from '../config.js';
import { ui } from '../ui.js';
import { getItemDisplayName, getItemSize } from './InventoryHelpers.js';

/**
 * MarketUI handles all market-related functionality
 * Receives reference to parent InventoryUI for shared state and methods
 */
export class MarketUI {
    constructor(inventoryUI) {
        this.inventoryUI = inventoryUI;

        // Convenience references (from parent)
        this.gameState = inventoryUI.gameState;
        this.game = inventoryUI.game;
        this.networkManager = inventoryUI.networkManager;
        this.audioManager = inventoryUI.audioManager;

        // Market-specific state
        this.marketSortMode = 'best'; // 'best' or 'cheap'
        this.marketTooltip = null; // Tooltip element reference
        this.pendingTransaction = null; // Pending buy/sell transaction
        this.currentPurchase = null; // Current purchase data for buy dialog

        // Part 1: Event delegation data store
        this.transactionData = new Map(); // itemKey -> {type, itemType, item, price, breakdown}

        // Part 2: Transaction tracking (prevents re-render race conditions)
        this.pendingTransactionId = null;
        this.pendingTransactionTimestamp = 0;
        this.transactionTimeout = null;
        this.externalUpdateDebounceTimer = null;

        // Part 3: Differential DOM updates - row registry
        this.rowRegistry = new Map(); // itemType -> {row, elements, currentData}
        this._lastStructure = null;

        // Merchant ships enable button
        this.merchantShipsButton = null;

        // Cache for enemy faction check
        this._isEnemyMarket = false;
    }

    /**
     * Check if current market belongs to an enemy faction.
     * Returns true only if both player and market owner have factions AND they differ.
     * Neutral players (no faction) cannot loot.
     * @returns {boolean}
     */
    isEnemyFactionMarket() {
        const market = this.gameState.nearestStructure;
        if (!market) return false;
        const ownerFaction = market.userData?.ownerFactionId;
        return this.gameState.isEnemyFaction(ownerFaction);
    }

    // ==========================================
    // EVENT DELEGATION (Fixes click reliability)
    // ==========================================

    /**
     * Initialize event delegation on the market list container.
     * Called ONCE during InventoryUI initialization.
     * Handlers attached here survive DOM updates inside #marketList.
     */
    initializeEventDelegation() {
        const container = document.getElementById('marketListContainer');
        if (!container || container.dataset.delegationInit) return;
        container.dataset.delegationInit = 'true';

        // Click delegation - single handler for all Buy/Sell buttons
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.market-btn');
            if (!btn || btn.disabled) return;
            e.stopPropagation();

            const key = btn.dataset.itemKey;
            if (!key) return;

            const txData = this.transactionData.get(key);
            if (txData) {
                this.showMarketConfirmation(txData.type, txData.itemType, txData.item, txData.price, txData.breakdown);
            }
        });

        // Tooltip delegation (mouseenter on capture phase)
        container.addEventListener('mouseenter', (e) => {
            const btn = e.target.closest('.market-btn');
            if (!btn) return;

            const tooltipKey = btn.dataset.tooltipKey;
            const itemKey = btn.dataset.itemKey;

            if (tooltipKey) {
                const data = this.transactionData.get(tooltipKey);
                if (data?.isError) this.showMarketTooltip(e, data.message, null, true, btn);
            } else if (itemKey) {
                const data = this.transactionData.get(itemKey);
                if (data?.breakdown) {
                    const label = `${data.type === 'buy' ? 'Buy' : 'Sell'} ${getItemDisplayName(data.itemType)}`;
                    this.showMarketTooltip(e, label, data.breakdown, false, btn);
                }
            }
        }, true);

        // Tooltip hide delegation (mouseleave on capture phase)
        container.addEventListener('mouseleave', (e) => {
            if (e.target.closest('.market-btn')) this.hideMarketTooltip();
        }, true);

        // Initialize merchant ships enable button
        this.initializeMerchantShipsButton();
    }

    /**
     * Initialize merchant ships enable button in market header
     */
    initializeMerchantShipsButton() {
        this.merchantShipsButton = document.getElementById('marketMerchantBtn');
        if (!this.merchantShipsButton) return;

        this.merchantShipsButton.addEventListener('click', () => this.toggleMerchantShips());
    }

    /**
     * Toggle merchant ships enabled state for current market
     */
    toggleMerchantShips() {
        const structure = this.gameState.nearestStructure;
        if (!structure || structure.userData?.modelType !== 'market') return;

        const newEnabled = !structure.userData.merchantShipsEnabled;
        structure.userData.merchantShipsEnabled = newEnabled;

        this.updateMerchantShipsButtonState(newEnabled);

        this.networkManager.sendMessage('toggle_merchant_ships', {
            marketId: structure.userData.id,
            chunkId: structure.userData.chunkId,
            enabled: newEnabled
        });

        // Tutorial hook
        if (newEnabled) {
            window.tasksPanel?.onMerchantShipsEnabled();
        }
    }

    /**
     * Check if there's a dock within 20 units of the given position
     * @param {THREE.Vector3} marketPosition - The market's position
     * @returns {boolean} - True if a dock is nearby
     */
    hasDockNearby(marketPosition) {
        let found = false;
        const maxDistSq = 400; // 20^2
        this.game.scene.traverse(obj => {
            if (found) return;
            if (obj.userData?.modelType === 'dock') {
                const dx = marketPosition.x - obj.position.x;
                const dz = marketPosition.z - obj.position.z;
                if (dx * dx + dz * dz < maxDistSq) found = true;
            }
        });
        return found;
    }

    /**
     * Update merchant ships button appearance based on current market state
     * @param {boolean} enabled - Override enabled state (optional)
     */
    updateMerchantShipsButtonState(enabled) {
        if (!this.merchantShipsButton) return;

        const structure = this.gameState.nearestStructure;
        const isMarket = structure?.userData?.modelType === 'market';

        this.merchantShipsButton.style.display = isMarket ? 'inline-block' : 'none';

        if (isMarket) {
            const hasDock = this.hasDockNearby(structure.position);

            if (!hasDock) {
                // No dock nearby - disable button
                this.merchantShipsButton.disabled = true;
                this.merchantShipsButton.textContent = 'Enable Merchant Ships';
                this.merchantShipsButton.classList.remove('enabled');
                this.merchantShipsButton.title = 'No dock within 20 units';
            } else {
                // Dock nearby - enable button
                this.merchantShipsButton.disabled = false;
                this.merchantShipsButton.title = '';
                const isEnabled = enabled ?? structure.userData.merchantShipsEnabled;
                this.merchantShipsButton.textContent = isEnabled ? 'Disable Merchant Ships' : 'Enable Merchant Ships';
                this.merchantShipsButton.classList.toggle('enabled', isEnabled);
            }
        }
    }

    /**
     * Update influence display in market header.
     * Only shows for market owner with influence > 0.
     * @param {object} market - The market structure
     */
    updateInfluenceDisplay(market) {
        const influenceDisplay = document.getElementById('marketInfluenceDisplay');
        if (!influenceDisplay) return;

        const isMarket = market?.userData?.modelType === 'market';
        if (!isMarket) {
            influenceDisplay.style.display = 'none';
            return;
        }

        // Check if player owns this market
        const owner = market.userData?.owner;
        const currentClientId = this.gameState.clientId;
        const currentAccountId = this.gameState.accountId;
        const isOwner = owner && (owner === currentClientId || owner === currentAccountId);

        // Show influence only for market owner with influence > 0
        const influence = this.gameState.influence || 0;
        if (isOwner && influence > 0) {
            influenceDisplay.textContent = `Influence: ${influence}`;
            influenceDisplay.style.display = 'inline-block';
        } else {
            influenceDisplay.style.display = 'none';
        }
    }

    // ==========================================
    // TRANSACTION TRACKING (Fixes stock update race condition)
    // ==========================================

    /**
     * Handle server inventory update with smart re-render logic.
     * Called from MessageRouter.handleMarketInventoryUpdated().
     * Skips re-render if this is a response to our own transaction.
     * @param {object} serverItems - Server's inventory state
     * @param {string|null} transactionId - Transaction ID if this is a response to our action
     */
    handleServerInventoryUpdate(serverItems, transactionId) {
        // Case 1: This is a response to our own pending transaction - skip re-render
        if (transactionId && this.pendingTransactionId === transactionId) {
            this.clearPendingTransaction();
            return;
        }

        // Case 2: We have a pending transaction, but this is a different update (external)
        if (this.pendingTransactionId) {
            const age = Date.now() - this.pendingTransactionTimestamp;
            if (age < 500) {
                // Recent transaction in flight - debounce to avoid flicker
                clearTimeout(this.externalUpdateDebounceTimer);
                this.externalUpdateDebounceTimer = setTimeout(() => {
                    this.renderMarketInventory();
                }, 300);
                return;
            }
        }

        // Case 3: No pending transaction - external update (other player)
        // Apply small debounce to batch rapid updates
        clearTimeout(this.externalUpdateDebounceTimer);
        this.externalUpdateDebounceTimer = setTimeout(() => {
            this.renderMarketInventory();
        }, 100);
    }

    /**
     * Clear pending transaction state
     */
    clearPendingTransaction() {
        this.pendingTransactionId = null;
        this.pendingTransactionTimestamp = 0;
        if (this.transactionTimeout) {
            clearTimeout(this.transactionTimeout);
            this.transactionTimeout = null;
        }
    }

    // ==========================================
    // DIFFERENTIAL DOM UPDATES (Fixes flickering)
    // ==========================================

    /**
     * Create a new market row with stored element references.
     * Event handlers are NOT attached here (delegated to container).
     * @param {string} itemType - Item type for this row
     * @param {string} category - Category this item belongs to
     * @returns {object} Cached row data with element references
     */
    createMarketRow(itemType, category) {
        const row = document.createElement('div');
        row.className = 'market-list-item';
        row.dataset.itemType = itemType;
        row.dataset.category = category;

        // Create cells with specific references for updates
        const nameCell = document.createElement('div');
        nameCell.className = 'market-item-name';

        const buyCell = document.createElement('div');
        buyCell.className = 'market-item-buy';
        const buyPriceSpan = document.createElement('span');
        buyPriceSpan.className = 'market-price';
        const buyBtn = document.createElement('button');
        buyBtn.className = 'market-btn market-btn-buy';
        buyBtn.textContent = 'Buy';
        buyCell.appendChild(buyPriceSpan);
        buyCell.appendChild(buyBtn);

        const sellCell = document.createElement('div');
        sellCell.className = 'market-item-sell';
        const sellPriceSpan = document.createElement('span');
        sellPriceSpan.className = 'market-price';
        const sellBtn = document.createElement('button');
        sellBtn.className = 'market-btn market-btn-sell';
        sellBtn.textContent = 'Sell';
        sellCell.appendChild(sellPriceSpan);
        sellCell.appendChild(sellBtn);

        const qtyCell = document.createElement('div');
        qtyCell.className = 'market-item-qty';

        row.appendChild(nameCell);
        row.appendChild(buyCell);
        row.appendChild(sellCell);
        row.appendChild(qtyCell);

        // Store element references for differential updates
        const cached = {
            row,
            elements: { nameCell, buyPriceSpan, buyBtn, sellPriceSpan, sellBtn, qtyCell }
        };

        this.rowRegistry.set(itemType, cached);
        return cached;
    }

    /**
     * Update a market row's values without recreating DOM elements.
     * Only updates values that have changed.
     * @param {string} itemType - Item type to update
     * @param {object} data - Row data with prices, stock, button states
     * @returns {boolean} True if row was found and updated
     */
    updateMarketRow(itemType, data) {
        const cached = this.rowRegistry.get(itemType);
        if (!cached) return false;

        const { elements } = cached;

        // Update name cell (only if changed)
        if (elements.nameCell.textContent !== data.nameDisplay) {
            elements.nameCell.textContent = data.nameDisplay;
        }

        // Check if this is an enemy market (looting mode)
        const isLooting = data.isLooting || false;

        // Update buy price span - show FREE for looting
        const buyPriceText = isLooting ? 'FREE' : `🪙${data.buyPrice || '-'}`;
        if (elements.buyPriceSpan.textContent !== buyPriceText) {
            elements.buyPriceSpan.textContent = buyPriceText;
        }

        // Update buy button text - show Loot for enemy markets
        const buyBtnText = isLooting ? 'Loot' : 'Buy';
        if (elements.buyBtn.textContent !== buyBtnText) {
            elements.buyBtn.textContent = buyBtnText;
        }

        // Update buy button disabled state and data attributes
        if (elements.buyBtn.disabled !== data.buyDisabled) {
            elements.buyBtn.disabled = data.buyDisabled;
        }
        elements.buyBtn.dataset.itemKey = data.buyKey || '';
        elements.buyBtn.dataset.tooltipKey = data.buyDisabled ? `tooltip_buy_${itemType}` : '';

        // Update sell price span
        const sellPriceText = `🪙${data.sellPrice || '-'}`;
        if (elements.sellPriceSpan.textContent !== sellPriceText) {
            elements.sellPriceSpan.textContent = sellPriceText;
        }

        // Update sell button disabled state and data attributes
        if (elements.sellBtn.disabled !== data.sellDisabled) {
            elements.sellBtn.disabled = data.sellDisabled;
        }
        elements.sellBtn.dataset.itemKey = data.sellKey || '';
        elements.sellBtn.dataset.tooltipKey = data.sellDisabled ? `tooltip_sell_${itemType}` : '';

        // Update stock count
        const stockText = String(data.totalStock);
        if (elements.qtyCell.textContent !== stockText) {
            elements.qtyCell.textContent = stockText;
        }

        return true;
    }

    // ==========================================
    // MARKET PRICE CALCULATIONS
    // ==========================================

    /**
     * Get top item from market inventory based on sort mode
     * @param {object} itemStock - Object of key→count (e.g., {"95": 2, "72": 5} or {"82,90": 1})
     * @param {boolean} hasDurability - Whether this item type has durability
     * @param {string} sortMode - 'best' or 'cheap'
     * @returns {object|null} {quality, durability, count} or null if no stock
     */
    getTopMarketItem(itemStock, hasDurability, sortMode) {
        if (!itemStock || Object.keys(itemStock).length === 0) return null;

        const entries = Object.entries(itemStock).filter(([, count]) => count > 0);
        if (entries.length === 0) return null;

        // Parse keys and sort
        const parsed = entries.map(([key, count]) => {
            if (hasDurability) {
                const [quality, durability] = key.split(',').map(Number);
                return { key, quality, durability, count };
            } else {
                const quality = Number(key);
                // Validate quality to prevent NaN display
                if (isNaN(quality)) {
                    console.warn(`[getTopMarketItem] Invalid market key: "${key}", skipping`);
                    return null;
                }
                return { key, quality, durability: null, count };
            }
        }).filter(item => item !== null);

        // Sort based on mode
        if (sortMode === 'best') {
            // Best = highest quality (and durability for tools/food)
            parsed.sort((a, b) => {
                if (hasDurability) {
                    const avgA = (a.quality + a.durability) / 2;
                    const avgB = (b.quality + b.durability) / 2;
                    return avgB - avgA;
                }
                return b.quality - a.quality;
            });
        } else {
            // Cheap = lowest quality (and durability)
            parsed.sort((a, b) => {
                if (hasDurability) {
                    const avgA = (a.quality + a.durability) / 2;
                    const avgB = (b.quality + b.durability) / 2;
                    return avgA - avgB;
                }
                return a.quality - b.quality;
            });
        }

        return parsed[0];
    }

    /**
     * Get player's top item of a type based on sort mode
     * @param {string} itemType - Item type to look for
     * @param {string} sortMode - 'best' or 'cheap'
     * @returns {object|null} Item from inventory or null
     */
    getPlayerTopItem(itemType, sortMode) {
        const items = this.gameState.inventory.items.filter(item => item.type === itemType);
        if (items.length === 0) return null;

        const hasDurability = CONFIG.MARKET.DURABILITY_ITEMS.includes(itemType);

        // Special case: For ammo, prioritize full stacks (required for selling)
        if (itemType === 'ammo') {
            const AMMO_STACK_SIZE = 20;
            // Find a full stack first (sorted by quality based on mode)
            const fullStacks = items.filter(item => (item.quantity || 0) >= AMMO_STACK_SIZE);
            if (fullStacks.length > 0) {
                // Sort full stacks by quality
                fullStacks.sort((a, b) => sortMode === 'best'
                    ? (b.quality || 50) - (a.quality || 50)
                    : (a.quality || 50) - (b.quality || 50));
                return fullStacks[0];
            }
            // No full stacks - return largest partial stack
            items.sort((a, b) => (b.quantity || 0) - (a.quantity || 0));
            return items[0];
        }

        if (sortMode === 'best') {
            items.sort((a, b) => {
                if (hasDurability) {
                    const avgA = ((a.quality || 50) + (a.durability || 50)) / 2;
                    const avgB = ((b.quality || 50) + (b.durability || 50)) / 2;
                    return avgB - avgA;
                }
                return (b.quality || 50) - (a.quality || 50);
            });
        } else {
            items.sort((a, b) => {
                if (hasDurability) {
                    const avgA = ((a.quality || 50) + (a.durability || 50)) / 2;
                    const avgB = ((b.quality || 50) + (b.durability || 50)) / 2;
                    return avgA - avgB;
                }
                return (a.quality || 50) - (b.quality || 50);
            });
        }

        return items[0];
    }

    /**
     * Calculate market price for an item
     * @param {string} itemType - Item type
     * @param {number} quality - Item quality
     * @param {number|null} durability - Item durability (for tools/food)
     * @param {number} totalStock - Total stock in market for supply calculation
     * @param {string} priceType - 'buy' or 'sell'
     * @returns {object} {price, breakdown}
     */
    calculateMarketPrice(itemType, quality, durability, totalStock, priceType) {
        const priceData = CONFIG.MARKET.PRICES[itemType];
        if (!priceData) return { price: 0, breakdown: {} };

        // Enemy faction markets: buying is free (looting)
        if (priceType === 'buy' && this.isEnemyFactionMarket()) {
            return {
                price: 0,
                breakdown: {
                    basePrice: 0,
                    supplyMultiplier: 0,
                    statMultiplier: 0,
                    quality,
                    durability,
                    totalStock,
                    maxQty: priceData.maxQuantity,
                    isLooting: true
                }
            };
        }

        const basePrice = priceType === 'buy' ? priceData.buyPrice : priceData.sellPrice;
        const maxQty = priceData.maxQuantity;
        const hasDurability = CONFIG.MARKET.DURABILITY_ITEMS.includes(itemType);

        // Supply multiplier: more stock = lower prices
        // Clamp to minimum 0.1 to prevent negative prices when stock exceeds 3x max
        const supplyMultiplier = Math.max(0.1, 1 + ((maxQty - totalStock) / maxQty) * 0.5);

        // Quality/durability multiplier
        let statMultiplier;
        if (hasDurability && durability !== null) {
            statMultiplier = ((quality + durability) / 2) / 100;
        } else {
            statMultiplier = quality / 100;
        }

        const finalPrice = Math.floor(basePrice * supplyMultiplier * statMultiplier);

        return {
            price: finalPrice,
            breakdown: {
                basePrice,
                supplyMultiplier,
                statMultiplier,
                quality,
                durability,
                totalStock,
                maxQty
            }
        };
    }

    /**
     * Get total stock count for an item type in market
     */
    getTotalMarketStock(itemStock) {
        if (!itemStock) return 0;
        return Object.values(itemStock).reduce((sum, count) => sum + count, 0);
    }

    // ==========================================
    // MARKET INVENTORY RENDERING
    // ==========================================

    renderMarketInventory() {
        const market = this.gameState.nearestStructure;
        if (!market) return;

        // Update button state
        this.updateMerchantShipsButtonState();

        // Update influence display (only show for market owner with influence > 0)
        this.updateInfluenceDisplay(market);

        // Check if player is on horse - show sell UI instead
        const mobileState = this.gameState.mobileEntityState;
        const isOnHorse = mobileState?.isActive &&
                          mobileState?.phase === 'piloting' &&
                          mobileState?.entityType === 'horse';

        if (isOnHorse) {
            this.renderHorseSellUI();
            return;
        }

        // Hide grid, show list
        const gridContainer = document.getElementById('crateGridContainer');
        const listContainer = document.getElementById('marketListContainer');
        if (gridContainer) gridContainer.style.display = 'none';
        if (!listContainer) return;
        listContainer.style.display = 'block';

        // Get market inventory (new format: items[itemType][key] = count)
        const marketInventory = market.userData.inventory || { items: {} };
        const marketItems = marketInventory.items || {};

        // Get market prices from config
        const marketPrices = CONFIG.MARKET.PRICES;
        const durabilityItems = CONFIG.MARKET.DURABILITY_ITEMS;

        // Get player coins for buy button validation
        const playerCoins = this.game.playerInventory.getTotalCoins();

        // Clear transaction data for event delegation
        this.transactionData.clear();

        // Render market list
        const marketList = document.getElementById('marketList');
        if (!marketList) return;

        // Define item categories
        const categories = {
            'Food': ['apple', 'appletart', 'vegetables', 'roastedvegetables', 'mushroom', 'fish', 'cookedfish', 'rawmeat', 'cookedmeat'],
            'Materials': [
                'limestone', 'sandstone', 'clay',
                'chiseledlimestone', 'chiseledsandstone', 'tile',
                'iron', 'ironingot', 'parts',
                'oakplank', 'pineplank', 'firplank', 'cypressplank', 'appleplank',
                'oakfirewood', 'pinefirewood', 'firfirewood', 'cypressfirewood', 'applefirewood',
                'rope'
            ],
            'Seeds': ['vegetableseeds', 'appleseed', 'pineseed', 'firseed'],
            'Tools': ['axe', 'saw', 'pickaxe', 'hammer', 'chisel', 'fishingnet'],
            'Weapons': ['rifle', 'ammo', 'shell'],
            'Mounts': ['horse']
        };

        // Category order
        const categoryOrder = ['Food', 'Materials', 'Seeds', 'Tools', 'Weapons', 'Mounts'];

        // Build expected structure to detect if we need full rebuild
        const expectedOrder = [];
        for (const category of categoryOrder) {
            const categoryItems = categories[category] || [];
            const validItems = categoryItems.filter(item => marketPrices[item]);
            if (validItems.length === 0) continue;

            validItems.sort((a, b) => {
                const nameA = getItemDisplayName(a).toLowerCase();
                const nameB = getItemDisplayName(b).toLowerCase();
                return nameA.localeCompare(nameB);
            });

            expectedOrder.push({ type: 'header', category });
            for (const itemType of validItems) {
                expectedOrder.push({ type: 'item', itemType, category });
            }
        }

        // Check if structure changed (need full rebuild)
        const currentStructure = expectedOrder.map(e =>
            e.type === 'header' ? `header:${e.category}` : `item:${e.itemType}`
        ).join(',');

        const structureChanged = this._lastStructure !== currentStructure;

        if (structureChanged) {
            // Structure changed - do full rebuild
            this._lastStructure = currentStructure;
            this.rowRegistry.clear();
            marketList.innerHTML = '';

            for (const entry of expectedOrder) {
                if (entry.type === 'header') {
                    const header = document.createElement('div');
                    header.className = 'market-category-header';
                    header.textContent = entry.category;
                    marketList.appendChild(header);
                } else {
                    const cached = this.createMarketRow(entry.itemType, entry.category);
                    marketList.appendChild(cached.row);
                }
            }
        }

        // Now update all row data (differential updates)
        for (const entry of expectedOrder) {
            if (entry.type !== 'item') continue;

            const itemType = entry.itemType;
            const itemStock = marketItems[itemType] || {};
            const hasDurability = durabilityItems.includes(itemType);
            const totalStock = this.getTotalMarketStock(itemStock);

            // Get top market item based on sort mode
            const topMarketItem = this.getTopMarketItem(itemStock, hasDurability, this.marketSortMode);

            // Get player's top item of this type
            const playerItem = this.getPlayerTopItem(itemType, this.marketSortMode);

            // Calculate buy price (for market's top item)
            let buyPrice = 0;
            let buyBreakdown = null;
            let buyDisabled = true;
            let buyDisabledReason = '';

            // Check if this is an enemy market (looting mode)
            const isLooting = this.isEnemyFactionMarket();

            if (topMarketItem) {
                const priceInfo = this.calculateMarketPrice(
                    itemType,
                    topMarketItem.quality,
                    topMarketItem.durability,
                    totalStock,
                    'buy'
                );
                buyPrice = priceInfo.price;
                buyBreakdown = priceInfo.breakdown;

                // Check if player can buy/loot
                // Entity items (horse, etc.) don't go into inventory - skip space check
                const entityItems = ['horse'];
                const isEntityItem = entityItems.includes(itemType);
                const itemSize = isEntityItem ? null : getItemSize(itemType);
                // Use findEmptyInventoryPosition to check for CONTIGUOUS space, not just total slots
                const canFit = isEntityItem || this.inventoryUI.findEmptyInventoryPosition(itemSize.width, itemSize.height) !== null;

                if (!canFit) {
                    buyDisabled = true;
                    buyDisabledReason = `No space (${itemSize.width}×${itemSize.height})`;
                } else if (!isLooting && playerCoins < buyPrice) {
                    // Only check coins for non-looting purchases
                    buyDisabled = true;
                    buyDisabledReason = `Need 🪙${buyPrice}`;
                } else {
                    buyDisabled = false;
                }
            } else {
                buyDisabledReason = 'Out of stock';
            }

            // Calculate sell price (for player's item)
            let sellPrice = 0;
            let sellBreakdown = null;
            let sellDisabled = true;
            const AMMO_STACK_SIZE = 20;

            let sellDisabledReason = null;
            if (playerItem) {
                const priceInfo = this.calculateMarketPrice(
                    itemType,
                    playerItem.quality || 50,
                    playerItem.durability,
                    totalStock,
                    'sell'
                );
                sellPrice = priceInfo.price;
                sellBreakdown = priceInfo.breakdown;
                sellDisabled = false;

                // Ammo can only be sold as full stacks of 20
                if (itemType === 'ammo') {
                    const stackQuantity = playerItem.quantity || 0;
                    if (stackQuantity < AMMO_STACK_SIZE) {
                        sellDisabled = true;
                        sellDisabledReason = `Partial stack (${stackQuantity}/20)`;
                    } else {
                        // Full stack - use full price
                        sellPrice = priceInfo.price;
                    }
                }
            }

            // Format item name
            const itemName = getItemDisplayName(itemType);

            // Build name display with quality/durability
            let nameDisplay = itemName;
            if (topMarketItem) {
                if (hasDurability) {
                    nameDisplay += ` (Q:${Math.floor(topMarketItem.quality)} D:${Math.floor(topMarketItem.durability)})`;
                } else {
                    nameDisplay += ` (Q:${Math.floor(topMarketItem.quality)})`;
                }
            }

            // Generate keys for event delegation
            const buyKey = topMarketItem
                ? `buy_${itemType}_${topMarketItem.quality}_${topMarketItem.durability || 0}`
                : null;
            const sellKey = playerItem
                ? `sell_${itemType}_${playerItem.id}`
                : null;

            // Store transaction data for event delegation
            if (buyKey && !buyDisabled) {
                this.transactionData.set(buyKey, {
                    type: 'buy',
                    itemType,
                    item: topMarketItem,
                    price: buyPrice,
                    breakdown: buyBreakdown
                });
            }
            if (buyDisabled && buyDisabledReason) {
                this.transactionData.set(`tooltip_buy_${itemType}`, {
                    isError: true,
                    message: buyDisabledReason
                });
            }
            if (sellKey && !sellDisabled) {
                this.transactionData.set(sellKey, {
                    type: 'sell',
                    itemType,
                    item: playerItem,
                    price: sellPrice,
                    breakdown: sellBreakdown
                });
            }
            if (sellDisabled) {
                this.transactionData.set(`tooltip_sell_${itemType}`, {
                    isError: true,
                    message: sellDisabledReason || 'None in inventory'
                });
            }

            // Update row with new data (differential update)
            this.updateMarketRow(itemType, {
                nameDisplay,
                buyPrice,
                buyDisabled,
                buyKey,
                sellPrice,
                sellDisabled,
                sellKey,
                totalStock,
                isLooting
            });
        }
    }

    // ==========================================
    // MARKET TOOLTIPS
    // ==========================================

    /**
     * Show market tooltip with price breakdown or error
     * @param {Event} event - The mouse event
     * @param {string} title - Tooltip title or error message
     * @param {object|null} breakdown - Price breakdown data
     * @param {boolean} isError - Whether this is an error tooltip
     * @param {HTMLElement} [buttonElement] - Optional button element for positioning (for delegation)
     */
    showMarketTooltip(event, title, breakdown, isError, buttonElement = null) {
        this.hideMarketTooltip();

        const tooltip = document.createElement('div');
        tooltip.className = 'market-tooltip';
        tooltip.id = 'marketTooltipActive';

        if (isError) {
            tooltip.innerHTML = `<div class="market-tooltip-error">${title}</div>`;
        } else if (breakdown) {
            // Check if this is looting (enemy faction market)
            if (breakdown.isLooting) {
                tooltip.innerHTML = `
                    <div class="market-tooltip-title">${title.replace('Buy', 'Loot')}</div>
                    <div class="market-tooltip-row market-tooltip-final"><span>Enemy Market</span><span>FREE</span></div>
                `;
            } else {
                const hasDur = breakdown.durability !== null && breakdown.durability !== undefined;
                tooltip.innerHTML = `
                    <div class="market-tooltip-title">${title}</div>
                    <div class="market-tooltip-row"><span>Base Price:</span><span>🪙${breakdown.basePrice}</span></div>
                    <div class="market-tooltip-row"><span>Quality${hasDur ? '/Dur' : ''}:</span><span>×${breakdown.statMultiplier.toFixed(2)}</span></div>
                    <div class="market-tooltip-row"><span>Supply (${breakdown.totalStock}/${breakdown.maxQty}):</span><span>×${breakdown.supplyMultiplier.toFixed(2)}</span></div>
                    <div class="market-tooltip-row market-tooltip-final"><span>Final:</span><span>🪙${Math.floor(breakdown.basePrice * breakdown.supplyMultiplier * breakdown.statMultiplier)}</span></div>
                `;
            }
        }

        document.body.appendChild(tooltip);

        // Position tooltip - use provided button element or find from event
        const target = buttonElement || event.target.closest('.market-btn') || event.target;
        const rect = target.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();

        // Check if tooltip would go off bottom of screen
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;

        tooltip.style.left = `${rect.left}px`;
        if (spaceBelow < tooltipRect.height + 10 && spaceAbove > spaceBelow) {
            // Position above the button
            tooltip.style.top = `${rect.top - tooltipRect.height - 5}px`;
        } else {
            // Position below the button (default)
            tooltip.style.top = `${rect.bottom + 5}px`;
        }

        this.marketTooltip = tooltip;
    }

    /**
     * Hide market tooltip
     */
    hideMarketTooltip() {
        const existing = document.getElementById('marketTooltipActive');
        if (existing) existing.remove();
        this.marketTooltip = null;
    }

    // ==========================================
    // MARKET CONFIRMATION DIALOG
    // ==========================================

    /**
     * Show market confirmation dialog
     */
    showMarketConfirmation(type, itemType, item, price, breakdown) {
        const dialog = document.getElementById('marketConfirmDialog');
        if (!dialog) return;

        const itemName = getItemDisplayName(itemType);
        const hasDurability = CONFIG.MARKET.DURABILITY_ITEMS.includes(itemType);
        const isLooting = breakdown?.isLooting || false;

        // Set title and message - use "Loot" for enemy markets
        const actionVerb = type === 'buy' ? (isLooting ? 'Loot' : 'Buy') : 'Sell';
        const titleText = type === 'buy' ? (isLooting ? 'Confirm Looting' : 'Confirm Purchase') : 'Confirm Sale';
        document.getElementById('marketConfirmTitle').textContent = titleText;

        let itemDesc = itemName;
        if (hasDurability && item.durability !== null && item.durability !== undefined) {
            itemDesc += ` (Q:${Math.floor(item.quality)} D:${Math.floor(item.durability)})`;
        } else {
            itemDesc += ` (Q:${Math.floor(item.quality)})`;
        }
        const priceText = isLooting ? 'FREE' : `🪙${price}`;
        document.getElementById('marketConfirmMessage').textContent =
            `${actionVerb} ${itemDesc} for ${priceText}?`;

        // Set breakdown - simplified for looting
        if (isLooting) {
            document.getElementById('marketConfirmBase').textContent = 'Enemy';
            document.getElementById('marketConfirmQuality').textContent = 'Market';
            document.getElementById('marketConfirmSupply').textContent = '-';
            document.getElementById('marketConfirmFinal').textContent = 'FREE';
            const durRow = document.getElementById('marketConfirmDurRow');
            if (durRow) durRow.style.display = 'none';
        } else {
            document.getElementById('marketConfirmBase').textContent = `🪙${breakdown.basePrice}`;
            document.getElementById('marketConfirmQuality').textContent = `×${(breakdown.quality / 100).toFixed(2)}`;

            const durRow = document.getElementById('marketConfirmDurRow');
            if (hasDurability && breakdown.durability !== null) {
                durRow.style.display = '';
                document.getElementById('marketConfirmDurability').textContent = `×${(breakdown.durability / 100).toFixed(2)}`;
            } else {
                durRow.style.display = 'none';
            }

            document.getElementById('marketConfirmSupply').textContent = `×${breakdown.supplyMultiplier.toFixed(2)}`;
            document.getElementById('marketConfirmFinal').textContent = `🪙${price}`;
        }

        // Store pending transaction
        this.pendingTransaction = {
            type,
            itemType,
            item,
            price,
            quality: item.quality,
            durability: item.durability
        };

        dialog.style.display = 'flex';
    }

    /**
     * Execute confirmed market transaction
     */
    executeMarketTransaction(transaction) {
        const market = this.gameState.nearestStructure;
        if (!market) return;

        if (transaction.type === 'buy') {
            // HORSE SPECIAL CASE - bypass inventory check entirely
            if (transaction.itemType === 'horse') {
                this.executeBuyHorse(transaction.quality, transaction.price);
                if (this.audioManager) {
                    this.audioManager.playSound('coins', 1000);
                }
                return;  // Skip normal buy flow
            }

            // Check inventory space before buying
            const { width, height } = getItemSize(transaction.itemType);
            const position = this.inventoryUI.findEmptyInventoryPosition(width, height);
            if (!position) {
                ui.updateStatus('Not enough inventory space!');
                return;
            }

            // Execute buy
            this.executeBuyTransaction(
                transaction.itemType,
                1,
                transaction.price,
                transaction.quality,
                transaction.durability
            );
        } else {
            // Execute sell
            this._executeSellTransactionNew(transaction.item, transaction.price);
        }

        // Play coins sound (1 second) - skip for free looting
        if (this.audioManager && transaction.price > 0) {
            this.audioManager.playSound('coins', 1000);
        }

        // Re-render market
        this.renderMarketInventory();
        this.inventoryUI.renderInventory();
    }

    /**
     * Handle horse purchase - spawns horse and auto-mounts
     * @param {number} quality - Horse quality (0-100)
     * @param {number} price - Total price to pay
     */
    executeBuyHorse(quality, price) {
        const mobileState = this.gameState.mobileEntityState;
        const cartState = this.gameState.cartAttachmentState;

        // Block if already on mobile entity
        if (mobileState.isActive) {
            ui.showToast('Cannot buy horse while riding', 'warning');
            return;
        }

        // Block if in water (check terrain height at player position)
        const playerPos = this.game.playerObject.position;
        const terrainY = this.game.terrainGenerator?.getWorldHeight(playerPos.x, playerPos.z) || 0;
        if (terrainY < 0) {
            ui.showToast('Cannot buy horse while in water', 'warning');
            return;
        }

        // Check server connection
        if (!this.networkManager.isServerConnected()) {
            ui.showToast('Cannot buy: Not connected to server', 'error');
            return;
        }

        // Auto-release cart if attached
        if (cartState.isAttached) {
            this.game.handleReleaseCart();
        }

        // Deduct coins (optimistic update)
        this.game.playerInventory.removeCoins(price);

        // Send buy_horse message to server with position for persistence
        const market = this.gameState.nearestStructure;
        const playerRotation = this.game.playerObject.rotation.y;
        this.networkManager.sendMessage('buy_horse', {
            marketId: market.userData.objectId,
            chunkId: `chunk_${market.userData.chunkKey}`,
            quality: Math.floor(quality),
            position: [playerPos.x, terrainY, playerPos.z],
            rotation: playerRotation, // Radians
            transactionId: `buy_horse_${Date.now()}`
        });

        // Close confirmation dialog first (prevents double-click issues)
        const confirmDialog = document.getElementById('marketConfirmDialog');
        if (confirmDialog) {
            confirmDialog.style.display = 'none';
        }
        this.pendingTransaction = null;

        // Close inventory UI (horse will spawn via server response)
        this.inventoryUI.toggleInventory();
    }

    /**
     * Render special UI for selling the horse you're riding
     */
    renderHorseSellUI() {
        const market = this.gameState.nearestStructure;
        const mobileState = this.gameState.mobileEntityState;
        const horse = mobileState.currentEntity;
        const quality = mobileState.entityQuality || horse?.userData?.quality || 50;

        // Hide grid, show list
        const gridContainer = document.getElementById('crateGridContainer');
        const listContainer = document.getElementById('marketListContainer');
        if (gridContainer) gridContainer.style.display = 'none';
        if (!listContainer) return;
        listContainer.style.display = 'block';

        // Clear cached structure so next normal render rebuilds the DOM
        this._lastStructure = null;
        this.rowRegistry.clear();

        // Calculate sell price - returns { price, breakdown }
        const marketItems = market.userData.inventory?.items || {};
        const horseStock = marketItems.horse || {};
        const totalStock = this.getTotalMarketStock(horseStock);
        const priceInfo = this.calculateMarketPrice('horse', quality, null, totalStock, 'sell');

        // Check if can dismount here
        this.game.mobileEntitySystem.checkDisembarkable(horse.position, 'horse');
        const canSell = this.game.mobileEntitySystem.canDisembark;

        const marketList = document.getElementById('marketList');
        marketList.innerHTML = `
            <div class="market-category-header">Sell Your Horse</div>
            <div class="market-list-item">
                <div class="market-item-name">Horse (Q:${Math.floor(quality)})</div>
                <div class="market-item-buy"></div>
                <div class="market-item-sell">
                    <span class="market-price">🪙${priceInfo.price}</span>
                    <button class="horse-sell-btn" id="sellHorseBtn" ${canSell ? '' : 'disabled'}>Sell</button>
                </div>
                <div class="market-item-qty"></div>
            </div>
            <div class="market-horse-info">
                ${canSell
                    ? 'Selling will dismount you from the horse.'
                    : 'Cannot sell here - move to flat land first.'}
            </div>
        `;

        // Add click handler (only if can sell)
        const sellBtn = document.getElementById('sellHorseBtn');
        if (sellBtn && canSell) {
            sellBtn.addEventListener('click', () => {
                this.executeSellHorse(quality, priceInfo.price);
            });
        }
    }

    /**
     * Execute horse sale - triggers dismount and removes horse
     * @param {number} quality - Horse quality
     * @param {number} price - Sell price (coins to receive)
     */
    executeSellHorse(quality, price) {
        const mobileState = this.gameState.mobileEntityState;
        const horse = mobileState.currentEntity;
        const entityId = mobileState.entityId;

        if (!horse || !entityId) {
            ui.showToast('Error: No horse to sell', 'error');
            return;
        }

        // Double-check dismount is valid
        this.game.mobileEntitySystem.checkDisembarkable(horse.position, 'horse');
        if (!this.game.mobileEntitySystem.canDisembark) {
            ui.showToast('Cannot sell here - find flat land first', 'warning');
            return;
        }

        // Check server connection
        if (!this.networkManager.isServerConnected()) {
            ui.showToast('Cannot sell: Not connected to server', 'error');
            return;
        }

        // Close UI first
        this.inventoryUI.toggleInventory();

        // Add coins (optimistic update - matches existing sell pattern)
        this.game.playerInventory.addCoins(price);

        // Set pending sale flag BEFORE triggering dismount
        const market = this.gameState.nearestStructure;
        mobileState.pendingHorseSale = true;
        mobileState.pendingHorseSaleData = {
            marketId: market.userData.objectId,
            chunkId: `chunk_${market.userData.chunkKey}`,
            quality: Math.floor(quality),
            price: price
        };

        // Trigger dismount - completeDisembark() will detect the flag and handle sale
        this.game.startDisembark();

        // Play coins sound
        if (this.audioManager) {
            this.audioManager.playSound('coins', 1000);
        }
    }

    // ==========================================
    // BUY DIALOG
    // ==========================================

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

        // Format item name (ammo shows as stacks)
        let itemName = itemType.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
        if (itemType === 'ammo') {
            itemName = 'Ammo (stack of 20)';
        }

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
            const toolTypes = ['axe', 'saw', 'pickaxe', 'hammer', 'chisel', 'rifle'];
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
            const spaceNeeded = this.inventoryUI.calculateInventorySpaceNeeded(itemType, quantity);
            if (!this.inventoryUI.hasInventorySpace(spaceNeeded)) {
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

    // ==========================================
    // BUY/SELL TRANSACTIONS
    // ==========================================

    /**
     * Execute buy transaction
     * @param {string} itemType - Type of item
     * @param {number} quantity - Number to buy (for ammo, this is number of stacks)
     * @param {number} unitPrice - Price per item (for ammo, price per stack of 20)
     * @param {number} quality - Item quality
     * @param {number|null} durability - Item durability (for tools)
     */
    executeBuyTransaction(itemType, quantity, unitPrice, quality, durability) {
        // Check server connection before buying
        if (!this.networkManager.isServerConnected()) {
            ui.showToast('Cannot buy: Not connected to server', 'error');
            return;
        }

        const totalCost = unitPrice * quantity;

        // Get item size
        const { width, height } = getItemSize(itemType);

        // BUGFIX: Check inventory space BEFORE deducting coins
        // Pre-calculate all positions needed to ensure we can fit all items
        const positions = [];
        const tempItems = []; // Track items we'll temporarily add to check subsequent positions

        for (let i = 0; i < quantity; i++) {
            const position = this.inventoryUI.findEmptyInventoryPosition(width, height);
            if (!position) {
                // Clean up temp items
                for (const tempItem of tempItems) {
                    const idx = this.gameState.inventory.items.indexOf(tempItem);
                    if (idx > -1) this.gameState.inventory.items.splice(idx, 1);
                }
                ui.showToast('Not enough inventory space!', 'error');
                return;
            }
            positions.push(position);

            // Temporarily add a placeholder to reserve this position for subsequent checks
            if (quantity > 1) {
                const tempItem = { x: position.x, y: position.y, width, height, _temp: true };
                this.gameState.inventory.items.push(tempItem);
                tempItems.push(tempItem);
            }
        }

        // Clean up temp items before adding real ones
        for (const tempItem of tempItems) {
            const idx = this.gameState.inventory.items.indexOf(tempItem);
            if (idx > -1) this.gameState.inventory.items.splice(idx, 1);
        }

        // Check if this is looting (enemy faction market - no coins required)
        const isLooting = this.isEnemyFactionMarket();

        // Deduct coins - skip for looting, abort if insufficient for normal purchase
        if (!isLooting) {
            if (!this.game.playerInventory.removeCoins(totalCost)) {
                ui.showToast('Not enough coins', 'error');
                return;
            }
        }

        // Check if this is a tool (has durability)
        const toolTypes = ['axe', 'saw', 'pickaxe', 'hammer', 'chisel', 'rifle'];
        const isTool = toolTypes.includes(itemType);

        // Check if this is food (has base durability system)
        // These values must match PlayerHunger.js baseDurability values
        const foodTypes = {
            'apple': 10,
            'vegetables': 20,
            'cookedfish': 60,
            'cookedmeat': 80
        };
        const isFood = foodTypes[itemType] !== undefined;

        // Check if this is ammo (sold in stacks of 20)
        const isAmmo = itemType === 'ammo';
        const AMMO_STACK_SIZE = 20;

        // Add items to inventory using pre-calculated positions
        for (let i = 0; i < quantity; i++) {
            const position = positions[i];

            // Calculate durability based on item type
            let itemDurability;
            if (isTool) {
                // Tools: durability = quality (quality is cap on durability, min 10)
                itemDurability = Math.max(10, Math.floor(quality));
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

            // Ammo is sold in stacks of 20
            if (isAmmo) {
                newItem.quantity = AMMO_STACK_SIZE;
            }

            this.gameState.inventory.items.push(newItem);
        }

        // Send message to server to update market quantities (new format with quality/durability)
        const market = this.gameState.nearestStructure;
        if (market) {
            // Generate transaction ID for tracking (prevents re-render race condition)
            const transactionId = `buy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            this.pendingTransactionId = transactionId;
            this.pendingTransactionTimestamp = Date.now();

            const hasDurability = CONFIG.MARKET.DURABILITY_ITEMS.includes(itemType);
            this.networkManager.sendMessage('buy_item', {
                marketId: market.userData.objectId,
                chunkId: `chunk_${market.userData.chunkKey}`,
                itemType,
                quality: Math.floor(quality),
                durability: hasDurability ? Math.floor(durability || 50) : null,
                transactionId
            });

            // Set reconciliation timeout (accept server state as authoritative after 500ms)
            if (this.transactionTimeout) {
                clearTimeout(this.transactionTimeout);
            }
            this.transactionTimeout = setTimeout(() => {
                this.clearPendingTransaction();
                this.renderMarketInventory(); // Reconcile with server state
            }, 500);

            // Optimistically update local market inventory so UI reflects change immediately
            if (market.userData.inventory?.items?.[itemType]) {
                const hasDurability = CONFIG.MARKET.DURABILITY_ITEMS.includes(itemType);
                const key = hasDurability
                    ? `${Math.floor(quality)},${Math.floor(durability || 50)}`
                    : `${Math.floor(quality)}`;

                for (let i = 0; i < quantity; i++) {
                    const currentCount = market.userData.inventory.items[itemType][key] || 0;
                    if (currentCount > 0) {
                        market.userData.inventory.items[itemType][key] = currentCount - 1;
                        // Clean up if count reaches 0
                        if (market.userData.inventory.items[itemType][key] <= 0) {
                            delete market.userData.inventory.items[itemType][key];
                        }
                    }
                }
            }
        }

        // Refresh inventory display
        this.inventoryUI.renderInventory();
        this.renderMarketInventory();

        // Show status message
        if (isAmmo) {
            ui.updateStatus(`Bought ${quantity} ammo stack${quantity > 1 ? 's' : ''} (${quantity * AMMO_STACK_SIZE} bullets) for 🪙${totalCost}`);
        } else {
            ui.updateStatus(`Bought ${quantity}x ${itemType} for 🪙${totalCost}`);
        }
    }

    /**
     * Execute sell transaction - sell item from backpack to market
     * @param {object} item - Item to sell
     */
    _executeSellTransaction(item) {
        // Check server connection before selling
        if (!this.networkManager.isServerConnected()) {
            ui.showToast('Cannot sell: Not connected to server', 'error');
            return;
        }

        const itemType = item.type;

        // Ammo can only be sold as full stacks of 20
        const AMMO_STACK_SIZE = 20;
        if (itemType === 'ammo') {
            const stackQuantity = item.quantity || 0;
            if (stackQuantity < AMMO_STACK_SIZE) {
                ui.showToast(`Cannot sell partial ammo stack (${stackQuantity}/20). Need full stack.`, 'error');
                return;
            }
        }

        const marketPrices = CONFIG.MARKET.PRICES;
        const priceData = marketPrices[itemType];

        if (!priceData) {
            console.error(`No price data for ${itemType}`);
            return;
        }

        // Get current market quantity for supply/demand calculation (NEW format)
        const market = this.gameState.nearestStructure;
        const marketItems = market.userData.inventory?.items || {};
        const itemStock = marketItems[itemType] || {};
        const currentQuantity = this.getTotalMarketStock(itemStock);
        const maxQty = priceData.maxQuantity;
        // Clamp to minimum 0.1 to prevent negative prices when stock exceeds 3x max
        const supplyMultiplier = Math.max(0.1, 1 + ((maxQty - currentQuantity) / maxQty) * 0.5);

        // Calculate sell price based on supply/demand and item's actual quality/durability
        const toolTypes = ['axe', 'saw', 'pickaxe', 'hammer', 'chisel', 'rifle'];
        const isTool = toolTypes.includes(itemType);

        let sellPrice;
        if (itemType === 'ammo') {
            // Ammo is always full stack (20) at this point - partial stacks blocked above
            sellPrice = Math.floor(priceData.sellPrice * supplyMultiplier);
        } else if (isTool) {
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
        if (itemType === 'ammo') {
            ui.updateStatus(`Sold ammo stack (20 bullets) for 🪙${sellPrice}`);
        } else if (isTool) {
            ui.updateStatus(`Sold ${itemType} (Q:${Math.floor(item.quality)} D:${Math.floor(item.durability)}) for 🪙${sellPrice}`);
        } else {
            ui.updateStatus(`Sold ${itemType} (Q:${Math.floor(item.quality)}) for 🪙${sellPrice}`);
        }
    }

    /**
     * Execute sell transaction - new version for button-based selling
     * @param {object} item - Item from player inventory to sell
     * @param {number} price - Pre-calculated sell price
     */
    _executeSellTransactionNew(item, price) {
        // Check server connection before selling
        if (!this.networkManager.isServerConnected()) {
            ui.showToast('Cannot sell: Not connected to server', 'error');
            return;
        }

        const itemType = item.type;

        // Ammo can only be sold as full stacks of 20
        const AMMO_STACK_SIZE = 20;
        if (itemType === 'ammo') {
            const stackQuantity = item.quantity || 0;
            if (stackQuantity < AMMO_STACK_SIZE) {
                ui.showToast(`Cannot sell partial ammo stack (${stackQuantity}/20). Need full stack.`, 'error');
                return;
            }
        }

        const market = this.gameState.nearestStructure;
        if (!market) return;

        const hasDurability = CONFIG.MARKET.DURABILITY_ITEMS.includes(itemType);
        const quality = Math.floor(item.quality || 50);
        const durability = hasDurability ? Math.floor(item.durability || 50) : null;

        // Add coins to player
        this.game.playerInventory.addCoins(price);

        // Remove item from backpack
        const itemIndex = this.gameState.inventory.items.indexOf(item);
        if (itemIndex > -1) {
            this.gameState.inventory.items.splice(itemIndex, 1);
        }

        // Optimistically update local market inventory so UI reflects change immediately
        if (!market.userData.inventory) {
            market.userData.inventory = { items: {} };
        }
        if (!market.userData.inventory.items) {
            market.userData.inventory.items = {};
        }
        if (!market.userData.inventory.items[itemType]) {
            market.userData.inventory.items[itemType] = {};
        }
        const key = hasDurability ? `${quality},${durability}` : `${quality}`;
        market.userData.inventory.items[itemType][key] = (market.userData.inventory.items[itemType][key] || 0) + 1;

        // Generate transaction ID for tracking (prevents re-render race condition)
        const transactionId = `sell_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.pendingTransactionId = transactionId;
        this.pendingTransactionTimestamp = Date.now();

        // Send to server to update market inventory (new format)
        this.networkManager.sendMessage('sell_item', {
            marketId: market.userData.objectId,
            chunkId: `chunk_${market.userData.chunkKey}`,
            itemType,
            quality,
            durability,
            transactionId
        });

        // Set reconciliation timeout (accept server state as authoritative after 500ms)
        if (this.transactionTimeout) {
            clearTimeout(this.transactionTimeout);
        }
        this.transactionTimeout = setTimeout(() => {
            this.clearPendingTransaction();
            this.renderMarketInventory(); // Reconcile with server state
        }, 500);

        // Show status message
        const itemName = getItemDisplayName(itemType);
        if (hasDurability) {
            ui.updateStatus(`Sold ${itemName} (Q:${Math.floor(item.quality)} D:${Math.floor(item.durability)}) for 🪙${price}`);
        } else {
            ui.updateStatus(`Sold ${itemName} (Q:${Math.floor(item.quality)}) for 🪙${price}`);
        }
    }
}

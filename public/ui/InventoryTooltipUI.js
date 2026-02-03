// File: public/ui/InventoryTooltipUI.js
// Inventory tooltip system extracted from InventoryUI.js
// Handles item tooltips with quality, durability, and market pricing

import { CONFIG } from '../config.js';
import { TooltipHelper } from './GridUIHelpers.js';
import { getItemDisplayName } from './InventoryHelpers.js';

/**
 * InventoryTooltipUI handles item tooltip display
 * Receives reference to parent InventoryUI for shared state
 */
export class InventoryTooltipUI {
    constructor(inventoryUI) {
        this.inventoryUI = inventoryUI;
        this.gameState = inventoryUI.gameState;

        // Tooltip hover state tracking
        this.hoveredItemId = null;
        this.lastMouseEvent = null;
        this.tooltipTimestamp = 0;
    }

    getStatColor(value) {
        if (value >= 80) return 'stat-good';
        if (value >= 40) return 'stat-worn';
        return 'stat-poor';
    }

    /**
     * Get quality tier label based on value
     * @param {number} value - Quality value 0-100
     * @returns {string} - 'HIGH', 'MEDIUM', or 'LOW'
     */
    getQualityLabel(value) {
        if (value >= 67) return 'HIGH';
        if (value >= 34) return 'MEDIUM';
        return 'LOW';
    }

    showTooltip(event, item, anchorElement = null) {
        // Don't show tooltip while holding an item
        if (this.inventoryUI.inventoryPickedItem) return;

        // Track hovered item for restoration after re-render
        this.hoveredItemId = item.id;
        this.lastMouseEvent = event;
        this.tooltipTimestamp = Date.now();
        this.currentAnchorElement = anchorElement;

        const tooltip = document.getElementById('inventoryTooltip');
        const titleEl = tooltip.querySelector('.tooltip-title');
        const qualityEl = tooltip.querySelector('.tooltip-quality');
        const qualityRow = qualityEl.closest('.tooltip-stat');
        const durabilityEl = tooltip.querySelector('.tooltip-durability');
        const durabilityRow = durabilityEl.closest('.tooltip-stat');
        const tipSection = tooltip.querySelector('.tooltip-tip-section');
        const tipEl = tooltip.querySelector('.tooltip-tip');

        // Show quality/durability rows for normal tooltips
        qualityRow.style.display = '';

        // Set content - special format for ammo showing quantity
        if (item.type === 'ammo') {
            titleEl.textContent = `Ammo (${item.quantity || 1}/${CONFIG.AMMO.MAX_STACK})`;
        } else {
            titleEl.textContent = getItemDisplayName(item.type);
        }
        const qualityLabel = this.getQualityLabel(item.quality);
        qualityEl.textContent = `${qualityLabel} (${item.quality})`;

        // Apply color coding for quality
        qualityEl.className = `tooltip-quality ${this.getStatColor(item.quality)}`;

        // Only show durability for items that have it (tools)
        if (item.durability !== undefined) {
            let displayDurability = item.durability;

            // For firewood in burning structures, calculate current durability based on tick elapsed
            if (item.type && item.type.endsWith('firewood') && item.placedAtTick) {
                const currentTick = this.gameState.serverTick || 0;
                const ticksElapsed = currentTick - item.placedAtTick;
                const minutesElapsed = ticksElapsed / 60;
                const durabilityLost = minutesElapsed * 2; // 2 per minute
                displayDurability = Math.max(0, item.durability - durabilityLost);
            }

            displayDurability = Math.floor(displayDurability);
            durabilityEl.textContent = `${displayDurability}/100`;
            durabilityEl.className = `tooltip-durability ${this.getStatColor(displayDurability)}`;
            durabilityRow.style.display = '';
        } else {
            durabilityRow.style.display = 'none';
        }

        // Show processing time remaining for cooking/processing items
        const processingRow = tooltip.querySelector('.tooltip-processing-row');
        const processingTimeEl = tooltip.querySelector('.tooltip-processing-time');

        const currentTick = this.gameState.serverTick || 0;
        let ticksRemaining = 0;
        let isProcessing = false;

        if (item.cookingStartTick && item.cookingDurationTicks) {
            const ticksElapsed = currentTick - item.cookingStartTick;
            ticksRemaining = Math.max(0, item.cookingDurationTicks - ticksElapsed);
            isProcessing = true;
        } else if (item.processingStartTick && item.processingDurationTicks) {
            const ticksElapsed = currentTick - item.processingStartTick;
            ticksRemaining = Math.max(0, item.processingDurationTicks - ticksElapsed);
            isProcessing = true;
        }

        if (isProcessing && ticksRemaining > 0) {
            // Format time: show minutes and seconds
            const minutes = Math.floor(ticksRemaining / 60);
            const seconds = ticksRemaining % 60;
            let timeText;
            if (minutes > 0) {
                timeText = `${minutes}m ${seconds}s remaining`;
            } else {
                timeText = `${seconds}s remaining`;
            }
            processingTimeEl.textContent = timeText;
            processingTimeEl.className = 'tooltip-processing-time stat-good'; // Green color
            processingRow.style.display = '';
        } else {
            processingRow.style.display = 'none';
        }

        // Show tip for tools, food, and chiselable items
        const toolTypes = ['axe', 'saw', 'pickaxe', 'hammer', 'chisel'];
        const foodTypes = ['apple', 'vegetables', 'roastedvegetables', 'appletart', 'fish', 'cookedfish', 'cookedmeat', 'mushroom', 'rawmeat'];
        const rawFoodTypes = ['fish', 'rawmeat']; // Foods that need cooking
        if (toolTypes.includes(item.type)) {
            tipEl.textContent = 'Tip: Keep tools in your backpack. They equip automatically when needed.';
            tipSection.style.display = '';
        } else if (rawFoodTypes.includes(item.type)) {
            tipEl.textContent = 'Must be cooked at a campfire before consuming.';
            tipSection.style.display = '';
        } else if (foodTypes.includes(item.type)) {
            tipEl.textContent = 'Tip: Keep food in your backpack to prevent starvation.';
            tipSection.style.display = '';
        } else if (item.type === 'limestone') {
            tipEl.textContent = 'Tip: Drag Chisel on top to chisel, or combine with Rope to make an Improvised Tool.';
            tipSection.style.display = '';
        } else if (item.type === 'sandstone') {
            tipEl.textContent = 'Tip: Drag Chisel on top to create chiseled sandstone.';
            tipSection.style.display = '';
        } else if (item.type === 'vines') {
            tipEl.textContent = 'Tip: Drag onto another Vines to create rope.';
            tipSection.style.display = '';
        } else if (item.type === 'hempfiber') {
            tipEl.textContent = 'Tip: Drag onto another Hemp Fiber to create fabric.';
            tipSection.style.display = '';
        } else if (item.type === 'rope') {
            tipEl.textContent = 'Tip: Drag onto another Rope to create a fishing net, or combine with Limestone for an Improvised Tool.';
            tipSection.style.display = '';
        } else if (item.type === 'rifle' || item.type === 'ammo') {
            tipEl.textContent = 'Tip: Keep rifle and ammo in your backpack to automatically engage nearby threats.';
            tipSection.style.display = '';
        } else if (item.type === 'shell') {
            tipEl.textContent = 'Tip: Add to artillery inventory to be used.';
            tipSection.style.display = '';
        } else {
            tipSection.style.display = 'none';
        }

        // Show sell price breakdown if at a market
        const sellSection = tooltip.querySelector('.tooltip-sell-section');
        if (this.gameState.nearestStructure && this.gameState.inventoryOpen) {
            const marketPrices = CONFIG.MARKET.PRICES;
            const priceData = marketPrices[item.type];

            if (priceData) {
                const market = this.gameState.nearestStructure;
                const marketInventory = market.userData.inventory || {};

                // Only show market pricing if this is a market (items is an object, not an array)
                const isMarket = marketInventory.items && typeof marketInventory.items === 'object' && !Array.isArray(marketInventory.items);
                if (!isMarket) {
                    sellSection.style.display = 'none';
                } else {
                    // NEW format: items[itemType][key] = count
                    const itemStock = marketInventory.items[item.type] || {};
                    const currentQuantity = Object.values(itemStock).reduce((sum, count) => sum + count, 0);
                    const maxQty = priceData.maxQuantity;
                    // Clamp to minimum 0.1 to prevent negative prices when stock exceeds 3x max
                    const supplyMultiplier = Math.max(0.1, 1 + ((maxQty - currentQuantity) / maxQty) * 0.5);

                    // Check if this is a tool
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
                    tooltip.querySelector('.tooltip-sell-base').textContent = `${basePrice}`;
                    tooltip.querySelector('.tooltip-sell-supply').textContent = `x${supplyMultiplier.toFixed(2)} = ${Math.floor(afterSupply)}`;

                    const percentChange = ((qualityMultiplier - 1) * 100).toFixed(0);
                    const percentDisplay = percentChange >= 0 ? `+${percentChange}%` : `${percentChange}%`;
                    tooltip.querySelector('.tooltip-sell-quality').textContent = `${percentDisplay} = ${finalPrice}`;

                    tooltip.querySelector('.tooltip-sell-price').textContent = `${finalPrice}`;

                    sellSection.style.display = '';
                }
            } else {
                sellSection.style.display = 'none';
            }
        } else {
            sellSection.style.display = 'none';
        }

        // Position and show tooltip (anchored to element if provided, otherwise follow cursor)
        if (anchorElement) {
            TooltipHelper.showAnchored('inventoryTooltip', anchorElement, 'right', 10);
        } else if (event) {
            TooltipHelper.show('inventoryTooltip', event);
        } else {
            tooltip.style.display = 'block';
        }
    }

    /**
     * Show combine tooltip when dragging an item over another
     * @param {object} draggedItem - Item being dragged
     * @param {object} targetItem - Item being hovered over (can be null)
     * @param {HTMLElement} anchorElement - Element to anchor tooltip to
     * @param {CraftingSystem} craftingSystem - Reference to crafting system
     */
    showCombineTooltip(draggedItem, targetItem, anchorElement, craftingSystem) {
        if (!draggedItem || !anchorElement) {
            this.hideTooltip();
            return;
        }

        const tooltip = document.getElementById('inventoryTooltip');
        const titleEl = tooltip.querySelector('.tooltip-title');
        const qualityRow = tooltip.querySelector('.tooltip-quality').closest('.tooltip-stat');
        const durabilityRow = tooltip.querySelector('.tooltip-durability').closest('.tooltip-stat');
        const sellSection = tooltip.querySelector('.tooltip-sell-section');
        const tipSection = tooltip.querySelector('.tooltip-tip-section');
        const tipEl = tooltip.querySelector('.tooltip-tip');

        // Hide standard sections for combine tooltip
        qualityRow.style.display = 'none';
        durabilityRow.style.display = 'none';
        sellSection.style.display = 'none';

        const draggedType = draggedItem.type.replace('R', '');

        // Check if we have a target item to combine with
        if (targetItem) {
            const targetType = targetItem.type.replace('R', '');

            // Check for chisel/improvisedtool + stone combination
            if (draggedType === 'chisel' || draggedType === 'improvisedtool') {
                const chiselResult = craftingSystem.getChiselResult(targetType);
                if (chiselResult) {
                    titleEl.textContent = `Combine to make: ${getItemDisplayName(chiselResult)}`;
                    tipSection.style.display = 'none';
                } else {
                    // Chisel/improvisedtool can't work on this item
                    titleEl.textContent = 'Cannot chisel this item';
                    tipEl.textContent = 'Can chisel: Limestone, Sandstone';
                    tipSection.style.display = '';
                }
            }
            // Check for combination (same-type or cross-type)
            else if (craftingSystem.canBeCombined(draggedItem, targetItem)) {
                const result = craftingSystem.getCombineResult(draggedType, targetType);
                titleEl.textContent = `Combine to make: ${getItemDisplayName(result)}`;
                tipSection.style.display = 'none';
            }
            // Items can't be combined
            else {
                titleEl.textContent = 'Cannot combine these items';
                const combinations = craftingSystem.getCombinableWith(draggedType);
                if (combinations.length > 0) {
                    const combineList = combinations.map(c =>
                        `${getItemDisplayName(c.combineWith)} -> ${getItemDisplayName(c.result)}`
                    ).join(', ');
                    tipEl.textContent = `Can combine: ${combineList}`;
                    tipSection.style.display = '';
                } else if (draggedType === 'chisel') {
                    tipEl.textContent = 'Can chisel: Limestone, Sandstone';
                    tipSection.style.display = '';
                } else {
                    tipEl.textContent = 'This item cannot be combined';
                    tipSection.style.display = '';
                }
            }
        } else {
            // No target item - show what this item can combine with
            titleEl.textContent = getItemDisplayName(draggedItem.type);
            const combinations = craftingSystem.getCombinableWith(draggedType);
            if (combinations.length > 0) {
                const combineList = combinations.map(c =>
                    `${getItemDisplayName(c.combineWith)} -> ${getItemDisplayName(c.result)}`
                ).join(', ');
                tipEl.textContent = `Can combine: ${combineList}`;
                tipSection.style.display = '';
            } else if (draggedType === 'chisel') {
                tipEl.textContent = 'Can chisel: Limestone, Sandstone';
                tipSection.style.display = '';
            } else {
                tipSection.style.display = 'none';
            }
        }

        // Store anchor for updates
        this.currentAnchorElement = anchorElement;

        // Position and show tooltip anchored to element
        TooltipHelper.showAnchored('inventoryTooltip', anchorElement, 'right', 10);
    }

    updateTooltipPosition(anchorOrEvent = null) {
        // Check if it's a MouseEvent (has clientX) or an HTMLElement
        if (anchorOrEvent && anchorOrEvent.clientX !== undefined) {
            // It's a mouse event - follow cursor
            TooltipHelper.updatePosition('inventoryTooltip', anchorOrEvent);
        } else if (anchorOrEvent) {
            // It's an element - anchor to it
            TooltipHelper.updatePositionAnchored('inventoryTooltip', anchorOrEvent, 'right', 10);
        } else if (this.currentAnchorElement) {
            TooltipHelper.updatePositionAnchored('inventoryTooltip', this.currentAnchorElement, 'right', 10);
        }
    }

    hideTooltip() {
        TooltipHelper.hide('inventoryTooltip');
        this.hoveredItemId = null;
        this.tooltipTimestamp = 0;
        this.currentAnchorElement = null;
    }
}

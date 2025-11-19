/**
 * GridUIHelpers.js
 * Shared utility functions for grid-based UI systems (Inventory, Build Menu, etc.)
 * Eliminates code duplication between InventoryUI.js and BuildMenu.js
 */

export const GridUIHelpers = {
    /**
     * Calculate slot size and gap based on screen height and number of rows
     * @param {number} rows - Number of rows in the grid
     * @param {number} targetHeightPercent - Target percentage of screen height (default 0.65)
     * @returns {{slotSize: number, gap: number}}
     */
    calculateGridSize(rows, targetHeightPercent = 0.65) {
        const targetHeight = window.innerHeight * targetHeightPercent;
        const slotSize = Math.floor(targetHeight / rows);
        const gap = Math.max(1, Math.floor(slotSize / 30)); // Gap scales with slot size
        return { slotSize, gap };
    },

    /**
     * Calculate pixel dimensions for an item/structure based on grid slots
     * @param {number} width - Width in grid slots
     * @param {number} height - Height in grid slots
     * @param {number} slotSize - Size of one slot in pixels
     * @param {number} gap - Gap between slots in pixels
     * @returns {{widthPx: number, heightPx: number}}
     */
    calculateItemSize(width, height, slotSize, gap) {
        return {
            widthPx: width * slotSize + (width - 1) * gap,
            heightPx: height * slotSize + (height - 1) * gap
        };
    },

    /**
     * Convert grid coordinates to pixel position
     * @param {number} gridX - Grid X coordinate
     * @param {number} gridY - Grid Y coordinate
     * @param {number} slotSize - Size of one slot in pixels
     * @param {number} gap - Gap between slots in pixels
     * @returns {{x: number, y: number}}
     */
    gridToPixel(gridX, gridY, slotSize, gap) {
        return {
            x: gridX * (slotSize + gap),
            y: gridY * (slotSize + gap)
        };
    },

    /**
     * Convert pixel coordinates to grid position (snaps to slot)
     * @param {number} pixelX - Pixel X coordinate
     * @param {number} pixelY - Pixel Y coordinate
     * @param {number} slotSize - Size of one slot in pixels
     * @param {number} gap - Gap between slots in pixels
     * @returns {{x: number, y: number}}
     */
    pixelToGrid(pixelX, pixelY, slotSize, gap) {
        return {
            x: Math.floor(pixelX / (slotSize + gap)),
            y: Math.floor(pixelY / (slotSize + gap))
        };
    },

    /**
     * Apply grid styling to a container element
     * @param {HTMLElement} gridElement - The grid container element
     * @param {number} rows - Number of rows
     * @param {number} cols - Number of columns
     * @param {number} slotSize - Size of one slot in pixels
     * @param {number} gap - Gap between slots in pixels
     */
    applyGridStyling(gridElement, rows, cols, slotSize, gap) {
        gridElement.style.gridTemplateColumns = `repeat(${cols}, ${slotSize}px)`;
        gridElement.style.gridTemplateRows = `repeat(${rows}, ${slotSize}px)`;
        gridElement.style.gap = `${gap}px`;
    }
};

export const TooltipHelper = {
    /**
     * Show and position a tooltip near the cursor
     * @param {string} tooltipId - ID of the tooltip element
     * @param {MouseEvent} event - Mouse event with cursor position
     * @param {number} offsetX - Horizontal offset from cursor (default 15)
     * @param {number} offsetY - Vertical offset from cursor (default 15)
     */
    show(tooltipId, event, offsetX = 15, offsetY = 15) {
        const tooltip = document.getElementById(tooltipId);
        if (!tooltip) return;

        tooltip.style.left = (event.clientX + offsetX) + 'px';
        tooltip.style.top = (event.clientY + offsetY) + 'px';
        tooltip.style.display = 'block';
    },

    /**
     * Update tooltip position (for mousemove handlers)
     * @param {string} tooltipId - ID of the tooltip element
     * @param {MouseEvent} event - Mouse event with cursor position
     * @param {number} offsetX - Horizontal offset from cursor (default 15)
     * @param {number} offsetY - Vertical offset from cursor (default 15)
     */
    updatePosition(tooltipId, event, offsetX = 15, offsetY = 15) {
        const tooltip = document.getElementById(tooltipId);
        if (!tooltip) return;

        tooltip.style.left = (event.clientX + offsetX) + 'px';
        tooltip.style.top = (event.clientY + offsetY) + 'px';
    },

    /**
     * Hide a tooltip
     * @param {string} tooltipId - ID of the tooltip element
     */
    hide(tooltipId) {
        const tooltip = document.getElementById(tooltipId);
        if (!tooltip) return;

        tooltip.style.display = 'none';
    }
};

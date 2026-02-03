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
     * Show tooltip at mouse cursor position (for hover events)
     * @param {string} tooltipId - ID of the tooltip element
     * @param {MouseEvent} event - Mouse event with clientX/clientY
     */
    show(tooltipId, event) {
        const tooltip = document.getElementById(tooltipId);
        if (!tooltip) return;

        tooltip.style.display = 'block';

        // Position near cursor with offset
        const offset = 15;
        let left = event.clientX + offset;
        let top = event.clientY + offset;

        // Get tooltip dimensions after showing
        const tooltipRect = tooltip.getBoundingClientRect();

        // Keep on screen
        if (left + tooltipRect.width > window.innerWidth) {
            left = event.clientX - tooltipRect.width - offset;
        }
        if (top + tooltipRect.height > window.innerHeight) {
            top = event.clientY - tooltipRect.height - offset;
        }

        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
    },

    /**
     * Update tooltip position to follow cursor
     * @param {string} tooltipId - ID of the tooltip element
     * @param {MouseEvent} event - Mouse event with clientX/clientY
     */
    updatePosition(tooltipId, event) {
        this.show(tooltipId, event);
    },

    /**
     * Show and position a tooltip anchored to an element
     * @param {string} tooltipId - ID of the tooltip element
     * @param {HTMLElement} anchorElement - Element to anchor tooltip to
     * @param {string} position - 'right', 'left', 'top', 'bottom' (default 'right')
     * @param {number} offset - Offset from anchor element (default 10)
     */
    showAnchored(tooltipId, anchorElement, position = 'right', offset = 10) {
        const tooltip = document.getElementById(tooltipId);
        if (!tooltip || !anchorElement) return;

        const rect = anchorElement.getBoundingClientRect();
        tooltip.style.display = 'block';

        // Get tooltip dimensions after showing
        const tooltipRect = tooltip.getBoundingClientRect();

        let left, top;

        switch (position) {
            case 'right':
                left = rect.right + offset;
                top = rect.top + (rect.height - tooltipRect.height) / 2;
                break;
            case 'left':
                left = rect.left - tooltipRect.width - offset;
                top = rect.top + (rect.height - tooltipRect.height) / 2;
                break;
            case 'top':
                left = rect.left + (rect.width - tooltipRect.width) / 2;
                top = rect.top - tooltipRect.height - offset;
                break;
            case 'bottom':
                left = rect.left + (rect.width - tooltipRect.width) / 2;
                top = rect.bottom + offset;
                break;
            default:
                left = rect.right + offset;
                top = rect.top;
        }

        // Keep tooltip on screen
        if (left + tooltipRect.width > window.innerWidth) {
            left = rect.left - tooltipRect.width - offset;
        }
        if (left < 0) {
            left = offset;
        }
        if (top + tooltipRect.height > window.innerHeight) {
            top = window.innerHeight - tooltipRect.height - offset;
        }
        if (top < 0) {
            top = offset;
        }

        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
    },

    /**
     * Update tooltip position anchored to element (no-op if element hasn't moved)
     * @param {string} tooltipId - ID of the tooltip element
     * @param {HTMLElement} anchorElement - Element to anchor tooltip to
     * @param {string} position - 'right', 'left', 'top', 'bottom' (default 'right')
     * @param {number} offset - Offset from anchor element (default 10)
     */
    updatePositionAnchored(tooltipId, anchorElement, position = 'right', offset = 10) {
        this.showAnchored(tooltipId, anchorElement, position, offset);
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

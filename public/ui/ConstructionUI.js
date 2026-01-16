// File: public/ui/ConstructionUI.js
// Construction section UI extracted from InventoryUI.js
// Handles construction site material display and slot rendering

import { isPlankType, getTotalPlankQuantity, isChiseledStone, getTotalChiseledStoneQuantity, formatMaterialName } from './InventoryHelpers.js';

/**
 * ConstructionUI handles construction site material display
 * Receives reference to parent InventoryUI for shared state
 */
export class ConstructionUI {
    constructor(inventoryUI) {
        this.inventoryUI = inventoryUI;
        this.gameState = inventoryUI.gameState;
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

    _renderConstructionSlotDirect(material, materialName, index, currentCount, itemsArray) {
        const slot = document.createElement('div');
        slot.className = 'construction-slot';
        slot.dataset.material = material;
        slot.dataset.slotIndex = index;
        slot.style.position = 'relative';

        if (index < currentCount && itemsArray[index]) {
            // Render actual item image for filled slots
            slot.classList.add('filled');

            const item = itemsArray[index];
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
            slot.textContent = '';
            slot.style.fontSize = '24px';
            slot.style.color = '#6B7F5C';
            slot.style.display = 'flex';
            slot.style.alignItems = 'center';
            slot.style.justifyContent = 'center';
            slot.style.backgroundColor = 'rgba(107, 127, 92, 0.3)';
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

    /**
     * Check if player has a hammer or improvised tool with durability
     * @returns {boolean}
     */
    _hasBuildTool() {
        return this.gameState.inventory.items.some(item =>
            (item.type === 'hammer' || item.type === 'improvisedtool') && item.durability > 0
        );
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
            // For chiseled stone types, sum all chiseled stone types
            let current;
            if (isPlankType(material)) {
                current = getTotalPlankQuantity(currentMaterials);
            } else if (isChiseledStone(material)) {
                current = getTotalChiseledStoneQuantity(currentMaterials);
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
            // For chiseled stone types, sum all chiseled stone types
            let current;
            let itemsForMaterial;

            if (isPlankType(material)) {
                current = getTotalPlankQuantity(currentMaterials);
                // Collect all plank-type items into a single array for rendering
                itemsForMaterial = [];
                for (const [key, items] of Object.entries(materialItems)) {
                    if (isPlankType(key) && Array.isArray(items)) {
                        itemsForMaterial.push(...items);
                    }
                }
            } else if (isChiseledStone(material)) {
                current = getTotalChiseledStoneQuantity(currentMaterials);
                // Collect all chiseled stone items into a single array for rendering
                itemsForMaterial = [];
                for (const [key, items] of Object.entries(materialItems)) {
                    if (isChiseledStone(key) && Array.isArray(items)) {
                        itemsForMaterial.push(...items);
                    }
                }
            } else {
                current = currentMaterials[material] ? currentMaterials[material].quantity : 0;
                itemsForMaterial = materialItems[material] || [];
            }

            const materialName = formatMaterialName(material);

            for (let i = 0; i < quantity; i++) {
                const slot = this._renderConstructionSlotDirect(material, materialName, i, current, itemsForMaterial);
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
                // For chiseled stone types, check total of all chiseled stone types
                if (isChiseledStone(material)) {
                    return getTotalChiseledStoneQuantity(currentMaterials) >= quantity;
                }
                return (currentMaterials[material] ? currentMaterials[material].quantity : 0) >= quantity;
            }
        );

        // Enable/disable build button based on materials AND tool availability
        const buildBtn = document.getElementById('constructionBuildBtn');
        const hasTool = this._hasBuildTool();
        const canBuild = allMaterialsSatisfied && hasTool;

        buildBtn.disabled = !canBuild;

        // Set hover text explaining why disabled
        if (!canBuild) {
            if (!hasTool) {
                buildBtn.title = 'Need hammer or improvised tool to build';
            } else {
                buildBtn.title = 'Missing required materials';
            }
        } else {
            buildBtn.title = '';
        }
    }
}

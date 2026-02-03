/**
 * BuildingSystem.js
 * Manages all building and construction site mechanics
 */

import { CONFIG } from '../config.js';
import { ui } from '../ui.js';

/**
 * Helper function to check if a material is a plank type
 * @param {string} material - Material type to check
 * @returns {boolean}
 */
function isPlankType(material) {
    return material === 'oakplank' ||
           material === 'pineplank' ||
           material === 'firplank' ||
           material === 'cypressplank' ||
           material === 'appleplank';
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
    if (materials.appleplank) total += materials.appleplank.quantity || 0;
    return total;
}

/**
 * Helper function to check if a material is a chiseled stone type
 * @param {string} material - Material type to check
 * @returns {boolean}
 */
function isChiseledStone(material) {
    return material === 'chiseledlimestone' || material === 'chiseledsandstone';
}

/**
 * Get total quantity of all chiseled stone types in materials object
 * @param {object} materials - Materials object with quantities
 * @returns {number}
 */
function getTotalChiseledStoneQuantity(materials) {
    let total = 0;
    if (materials.chiseledlimestone) total += materials.chiseledlimestone.quantity || 0;
    if (materials.chiseledsandstone) total += materials.chiseledsandstone.quantity || 0;
    return total;
}

export class BuildingSystem {
    constructor(gameState, networkManager, audioManager, inventoryUI) {
        this.gameState = gameState;
        this.networkManager = networkManager;
        this.audioManager = audioManager;
        this.inventoryUI = inventoryUI;

        // Animation references (set later)
        this.animationMixer = null;
        this.choppingAction = null;

        // Game reference for callbacks
        this.gameRef = null;
    }

    /**
     * Set game reference for callbacks
     * @param {object} game - Game instance
     */
    setGameReference(game) {
        this.gameRef = game;
    }

    /**
     * Start building action at construction site
     * @returns {boolean} - Whether action started successfully
     */
    startBuildAction() {
        // Check if we have a construction site nearby
        if (!this.gameState.nearestConstructionSite) {
            ui.updateStatus('⚠️ No construction site nearby');
            return false;
        }

        // Check if already performing an action
        if (this.gameState.activeAction) {
            ui.updateStatus('⚠️ Already performing an action');
            return false;
        }

        // Check if player has hammer in inventory
        if (!this.hasHammer()) {
            ui.updateStatus('⚠️ Need hammer to build');
            return false;
        }

        // Check if all materials are satisfied
        const constructionSite = this.gameState.nearestConstructionSite;
        const requiredMaterials = constructionSite.userData.requiredMaterials || {};
        const currentMaterials = constructionSite.userData.materials || {};

        const allMaterialsSatisfied = Object.entries(requiredMaterials).every(
            ([material, quantity]) => {
                // If required material is a plank type, accept any plank type
                if (isPlankType(material)) {
                    return getTotalPlankQuantity(currentMaterials) >= quantity;
                }
                // If required material is chiseled stone, accept any chiseled stone type
                if (isChiseledStone(material)) {
                    return getTotalChiseledStoneQuantity(currentMaterials) >= quantity;
                }
                // Otherwise check for exact material match
                return (currentMaterials[material]?.quantity || 0) >= quantity;
            }
        );

        if (!allMaterialsSatisfied) {
            ui.updateStatus('⚠️ Missing materials');
            return false;
        }

        // Start building action
        this.gameState.activeAction = {
            object: constructionSite,
            startTime: Date.now(),
            duration: CONFIG.ACTIONS.BUILD_DURATION, // 6 seconds from config.js
            actionType: 'build'
        };

        // Play hammer sound
        if (this.audioManager) {
            const sound = this.audioManager.playHammerSound();
            this.gameState.activeAction.sound = sound;
        }

        // Start chopping animation (hammer animation)
        if (this.animationMixer && this.choppingAction) {
            // Stop walk animation if we have reference to it
            if (this.gameRef && this.gameRef.animationAction) {
                this.gameRef.animationAction.stop();
            }
            this.choppingAction.reset();
            this.choppingAction.play();
        }

        // Broadcast sound to peers
        this.networkManager.broadcastP2P({
            type: 'player_sound',
            payload: {
                soundType: 'hammer',
                startTime: Date.now()
            }
        });

        ui.updateStatus('🔨 Building...');
        return true;
    }

    /**
     * Complete building action at construction site
     * @param {object} activeAction - The active building action
     * @returns {object} - Result {success, message, hammerBroke, constructionId}
     */
    completeBuildAction(activeAction) {
        // Check server connection before building
        if (!this.networkManager.isServerConnected()) {
            ui.showToast('Cannot build: Not connected to server', 'error');
            return { success: false, message: 'Not connected to server' };
        }

        const constructionSite = activeAction.object;

        // Find hammer or improvised tool in inventory
        const hammer = this.gameState.inventory.items.find(item =>
            this._canServeAsTool(item.type, 'hammer') && item.durability > 0
        );

        let result = {
            success: false,
            message: '',
            hammerBroke: false,
            constructionId: constructionSite.userData.objectId,
            chunkKey: constructionSite.userData.chunkKey
        };

        if (hammer) {
            // TOOL DURABILITY SYSTEM
            // Each building action removes 1 durability
            // Quality determines max durability (durability = quality, min 10)
            hammer.durability = Math.max(0, hammer.durability - 1);

            // Check if hammer broke
            if (hammer.durability === 0) {
                // Delete hammer from inventory
                const hammerIndex = this.gameState.inventory.items.indexOf(hammer);
                if (hammerIndex > -1) {
                    this.gameState.inventory.items.splice(hammerIndex, 1);
                }
                result.hammerBroke = true;
                const toolName = hammer.type === 'improvisedtool' ? 'Improvised tool' : 'Hammer';
                ui.showToast(`${toolName} broke!`, 'warning');
            }

            // Determine materialType for tinting (sandstone vs limestone)
            const siteMaterials = constructionSite.userData.materials || {};
            let materialType = null;
            if (siteMaterials.chiseledsandstone && siteMaterials.chiseledsandstone.quantity > 0) {
                materialType = 'sandstone';
            } else if (siteMaterials.chiseledlimestone && siteMaterials.chiseledlimestone.quantity > 0) {
                materialType = 'limestone';
            }

            // Send build completion to server
            this.networkManager.sendMessage('build_construction', {
                constructionId: result.constructionId,
                chunkKey: result.chunkKey,
                clientId: this.gameState.clientId,
                accountId: this.gameState.accountId || null,
                materialType: materialType
            });

            result.success = true;
            result.message = 'Construction complete!';
            ui.showToast('Construction complete!', 'success');

            // Notify tasks panel about structure completion
            if (window.tasksPanel && constructionSite.userData.targetStructure) {
                window.tasksPanel.onStructurePlaced(constructionSite.userData.targetStructure);
            }

            // Close inventory after construction completes
            if (this.gameState.inventoryOpen) {
                this.inventoryUI.toggleInventory(); // Close inventory
            }
        } else {
            result.message = 'No hammer found!';
            ui.showToast('No hammer found!', 'warning');
        }

        // Clear active chopping action
        this.gameState.activeAction = null;
        ui.updateChoppingProgress(0);

        // Update proximity to refresh buttons
        if (this.gameRef) {
            this.gameRef.checkProximityToObjects();
        }

        return result;
    }

    /**
     * Toggle construction inventory (deprecated - now opens backpack)
     */
    toggleConstructionInventory() {
        // Deprecated: Now just opens backpack which contains construction section
        if (this.inventoryUI) {
            this.inventoryUI.toggleInventory();
        }
    }

    /**
     * Check if player has a hammer with durability
     * @returns {boolean}
     */
    hasHammer() {
        return this.hasToolWithDurability('hammer');
    }

    /**
     * Check if an item can serve as a specific tool type
     * @param {string} itemType - The item's type
     * @param {string} requiredType - The required tool type
     * @returns {boolean}
     */
    _canServeAsTool(itemType, requiredType) {
        if (itemType === requiredType) return true;
        // Improvised tool can serve as axe, saw, pickaxe, or hammer
        if (itemType === 'improvisedtool') {
            return ['axe', 'saw', 'pickaxe', 'hammer'].includes(requiredType);
        }
        return false;
    }

    /**
     * Check if player has a tool with durability (including improvised tool as substitute)
     * @param {string} toolType - Type of tool to check
     * @returns {boolean}
     */
    hasToolWithDurability(toolType) {
        return this.gameState.inventory.items.some(item =>
            this._canServeAsTool(item.type, toolType) && item.durability > 0
        );
    }

    /**
     * Get construction site requirements
     * @param {object} constructionSite - The construction site object
     * @returns {object} - {required, current, missing}
     */
    getConstructionRequirements(constructionSite) {
        if (!constructionSite) return null;

        const required = constructionSite.userData.requiredMaterials || {};
        const current = constructionSite.userData.materials || {};
        const missing = {};

        Object.entries(required).forEach(([material, quantity]) => {
            let currentAmount;
            // If required material is a plank type, sum all plank types
            if (isPlankType(material)) {
                currentAmount = getTotalPlankQuantity(current);
            // If required material is chiseled stone, sum all chiseled stone types
            } else if (isChiseledStone(material)) {
                currentAmount = getTotalChiseledStoneQuantity(current);
            } else {
                currentAmount = current[material]?.quantity || 0;
            }

            if (currentAmount < quantity) {
                missing[material] = quantity - currentAmount;
            }
        });

        return {
            required,
            current,
            missing,
            isComplete: Object.keys(missing).length === 0
        };
    }

    /**
     * Add material to construction site (from inventory)
     * @param {object} constructionSite - The construction site
     * @param {string} materialType - Type of material to add
     * @param {number} amount - Amount to add
     * @returns {boolean} - Whether material was added
     */
    addMaterialToConstruction(constructionSite, materialType, amount = 1) {
        // Check server connection before adding materials
        if (!this.networkManager.isServerConnected()) {
            ui.showToast('Cannot add materials: Not connected to server', 'error');
            return false;
        }

        if (!constructionSite || !constructionSite.userData.isConstructionSite) {
            return false;
        }

        const required = constructionSite.userData.requiredMaterials || {};
        const current = constructionSite.userData.materials || {};

        // Check if this material is needed
        // If the material being added is a plank type, check if any plank type is required
        // If the material being added is chiseled stone, check if any chiseled stone is required
        let isNeeded = false;
        let requiredMaterialType = null;

        if (required[materialType]) {
            // Exact match
            isNeeded = true;
            requiredMaterialType = materialType;
        } else if (isPlankType(materialType)) {
            // Check if any plank type is required
            for (const reqMaterial in required) {
                if (isPlankType(reqMaterial)) {
                    isNeeded = true;
                    requiredMaterialType = reqMaterial;
                    break;
                }
            }
        } else if (isChiseledStone(materialType)) {
            // Check if any chiseled stone type is required
            for (const reqMaterial in required) {
                if (isChiseledStone(reqMaterial)) {
                    isNeeded = true;
                    requiredMaterialType = reqMaterial;
                    break;
                }
            }
        }

        if (!isNeeded) {
            return false;
        }

        // Calculate how much is needed
        let currentAmount, neededAmount;
        if (isPlankType(materialType) && isPlankType(requiredMaterialType)) {
            // For planks, check total of all plank types
            currentAmount = getTotalPlankQuantity(current);
            neededAmount = required[requiredMaterialType] - currentAmount;
        } else if (isChiseledStone(materialType) && isChiseledStone(requiredMaterialType)) {
            // For chiseled stone, check total of all chiseled stone types
            currentAmount = getTotalChiseledStoneQuantity(current);
            neededAmount = required[requiredMaterialType] - currentAmount;
        } else {
            // For other materials, check exact type
            currentAmount = current[materialType]?.quantity || 0;
            neededAmount = required[materialType] - currentAmount;
        }

        if (neededAmount <= 0) {
            return false; // Already have enough
        }

        // Add material (up to needed amount)
        const addAmount = Math.min(amount, neededAmount);

        // Initialize material if not exists
        if (!current[materialType]) {
            current[materialType] = { quantity: 0, totalQuality: 0 };
        }

        // Update quantity (preserve structure with quantity property)
        const currentMaterialAmount = current[materialType].quantity || 0;
        current[materialType].quantity = currentMaterialAmount + addAmount;
        constructionSite.userData.materials = current;

        // Send update to server
        this.networkManager.sendMessage('update_construction_materials', {
            constructionId: constructionSite.userData.objectId,
            chunkKey: constructionSite.userData.chunkKey,
            materials: current,
            clientId: this.gameState.clientId,
            accountId: this.gameState.accountId || null
        });

        return true;
    }

    /**
     * Check if a structure is a construction site
     * @param {object} object - The object to check
     * @returns {boolean}
     */
    isConstructionSite(object) {
        return object && object.userData && object.userData.isConstructionSite;
    }

    /**
     * Get construction progress as percentage
     * @param {object} constructionSite - The construction site
     * @returns {number} - Progress percentage (0-100)
     */
    getConstructionProgress(constructionSite) {
        if (!constructionSite || !constructionSite.userData.isConstructionSite) {
            return 0;
        }

        const required = constructionSite.userData.requiredMaterials || {};
        const current = constructionSite.userData.materials || {};

        let totalRequired = 0;
        let totalCurrent = 0;

        Object.entries(required).forEach(([material, quantity]) => {
            totalRequired += quantity;

            let currentAmount;
            // If required material is a plank type, sum all plank types
            if (isPlankType(material)) {
                currentAmount = getTotalPlankQuantity(current);
            // If required material is chiseled stone, sum all chiseled stone types
            } else if (isChiseledStone(material)) {
                currentAmount = getTotalChiseledStoneQuantity(current);
            } else {
                currentAmount = current[material]?.quantity || 0;
            }

            totalCurrent += Math.min(currentAmount, quantity);
        });

        if (totalRequired === 0) return 0;
        return Math.floor((totalCurrent / totalRequired) * 100);
    }

    /**
     * Handle construction site metadata when object is added
     * @param {object} objectInstance - The THREE.js object
     * @param {object} metadata - Metadata from server
     */
    applyConstructionMetadata(objectInstance, metadata) {
        if (metadata.isConstructionSite) {
            objectInstance.userData.isConstructionSite = true;
            objectInstance.userData.targetStructure = metadata.targetStructure;
            objectInstance.userData.requiredMaterials = metadata.requiredMaterials || {};
            objectInstance.userData.materials = metadata.materials || {};
            objectInstance.userData.rotation = metadata.rotation;
            objectInstance.userData.finalFoundationY = metadata.finalFoundationY;
        }
    }

    /**
     * Set animation references
     * @param {THREE.AnimationMixer} mixer
     * @param {THREE.AnimationAction} choppingAction
     */
    setAnimationReferences(mixer, choppingAction) {
        this.animationMixer = mixer;
        this.choppingAction = choppingAction;
    }

    /**
     * Get nearest construction site info for UI
     * @returns {object|null}
     */
    getNearestConstructionInfo() {
        if (!this.gameState.nearestConstructionSite) {
            return null;
        }

        const site = this.gameState.nearestConstructionSite;
        const requirements = this.getConstructionRequirements(site);
        const progress = this.getConstructionProgress(site);

        return {
            site,
            requirements,
            progress,
            hasHammer: this.hasHammer(),
            canBuild: requirements.isComplete && this.hasHammer() && !this.gameState.activeAction
        };
    }

    /**
     * Check if player is near a construction site
     * @param {number} maxDistance - Maximum distance to check
     * @returns {boolean}
     */
    isNearConstructionSite(maxDistance = 5) {
        return this.gameState.nearestConstructionSite !== null &&
               this.gameState.nearestConstructionSiteDistance <= maxDistance;
    }
}
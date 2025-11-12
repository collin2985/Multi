/**
 * BuildingSystem.js
 * Manages all building and construction site mechanics
 */

import { CONFIG } from '../config.js';
import { ui } from '../ui.js';

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
            ([material, quantity]) => (currentMaterials[material]?.quantity || 0) >= quantity
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
        const constructionSite = activeAction.object;

        // Find hammer in inventory
        const hammer = this.gameState.inventory.items.find(item =>
            item.type === 'hammer' && item.durability > 0
        );

        let result = {
            success: false,
            message: '',
            hammerBroke: false,
            constructionId: constructionSite.userData.objectId,
            chunkKey: constructionSite.userData.chunkKey
        };

        if (hammer) {
            // UNIVERSAL TOOL DURABILITY SYSTEM (Simplified for Building)
            // Formula: Durability Loss = 100 / toolQuality
            // - Building has no resource quality (no material hardness factor)
            // - Better hammers (higher quality) last longer
            // Examples:
            //   Hammer Q100 = 1 durability loss
            //   Hammer Q50 = 2 durability loss
            //   Hammer Q10 = 10 durability loss
            const hammerQuality = hammer.quality;
            const durabilityLoss = Math.ceil(100 / hammerQuality);
            hammer.durability = Math.max(0, hammer.durability - durabilityLoss);

            // Check if hammer broke
            if (hammer.durability === 0) {
                // Delete hammer from inventory
                const hammerIndex = this.gameState.inventory.items.indexOf(hammer);
                if (hammerIndex > -1) {
                    this.gameState.inventory.items.splice(hammerIndex, 1);
                }
                result.hammerBroke = true;
                ui.updateStatusLine1('⚠️ Hammer broke!', 3000);
            }

            // Send build completion to server
            this.networkManager.sendMessage('build_construction', {
                constructionId: result.constructionId,
                chunkKey: result.chunkKey
            });

            result.success = true;
            result.message = 'Construction complete!';
            ui.updateStatusLine1('✅ Construction complete!', 3000);

            // Close inventory after construction completes
            if (this.gameState.inventoryOpen) {
                this.inventoryUI.toggleInventory(); // Close inventory
            }
        } else {
            result.message = 'No hammer found!';
            ui.updateStatusLine1('⚠️ No hammer found!', 3000);
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
     * Check if player has a tool with durability
     * @param {string} toolType - Type of tool to check
     * @returns {boolean}
     */
    hasToolWithDurability(toolType) {
        return this.gameState.inventory.items.some(item =>
            item.type === toolType && item.durability > 0
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
            const currentAmount = current[material] || 0;
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
        if (!constructionSite || !constructionSite.userData.isConstructionSite) {
            return false;
        }

        const required = constructionSite.userData.requiredMaterials || {};
        const current = constructionSite.userData.materials || {};

        // Check if this material is needed
        if (!required[materialType]) {
            return false;
        }

        const currentAmount = current[materialType] || 0;
        const neededAmount = required[materialType] - currentAmount;

        if (neededAmount <= 0) {
            return false; // Already have enough
        }

        // Add material (up to needed amount)
        const addAmount = Math.min(amount, neededAmount);
        current[materialType] = currentAmount + addAmount;
        constructionSite.userData.materials = current;

        // Send update to server
        this.networkManager.sendMessage('update_construction_materials', {
            constructionId: constructionSite.userData.objectId,
            chunkKey: constructionSite.userData.chunkKey,
            materials: current
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
            totalCurrent += Math.min(current[material] || 0, quantity);
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
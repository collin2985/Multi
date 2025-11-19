/**
 * CraftingSystem.js
 * Manages all crafting mechanics - chiseling, tool durability, material conversion
 */

import { CONFIG } from '../config.js';
import { ui } from '../ui.js';

export class CraftingSystem {
    constructor(gameState, networkManager, audioManager, inventoryUI) {
        this.gameState = gameState;
        this.networkManager = networkManager;
        this.audioManager = audioManager;
        this.inventoryUI = inventoryUI;

        // Game reference (set later)
        this.game = null;
    }

    /**
     * Start chiseling action to convert stone to chiseled stone
     * @param {object} chisel - Chisel tool item
     * @param {object} stone - Stone item to chisel
     * @returns {boolean} - Whether action started successfully
     */
    startChiselingAction(chisel, stone) {
        // Check if already performing an action
        if (this.gameState.activeAction) {
            console.warn('Already performing an action');
            return false;
        }

        // Check chisel durability
        if (chisel.durability <= 0) {
            ui.updateStatusLine2('⚠️ Chisel is broken!', 3000);
            return false;
        }

        // Start chiseling action (locks movement)
        this.gameState.activeAction = {
            object: null, // No world object for chiseling
            startTime: Date.now(),
            duration: CONFIG.ACTIONS.CHISELING_DURATION, // 6 seconds from config.js
            actionType: 'chiseling',
            chisel: chisel,
            stone: stone
        };

        // Play chisel sound
        if (this.audioManager) {
            const sound = this.audioManager.playChiselSound();
            this.gameState.activeAction.sound = sound;
        }

        // Start chopping animation if available
        if (this.animationMixer && this.choppingAction) {
            // Stop walk animation if we have reference to it
            if (this.game && this.game.animationAction) {
                this.game.animationAction.stop();
            }
            this.choppingAction.reset();
            this.choppingAction.play();
        }

        // Broadcast chisel sound to peers
        this.networkManager.broadcastP2P({
            type: 'player_sound',
            payload: {
                soundType: 'chisel',
                startTime: Date.now()
            }
        });

        // Close inventory if it's open
        if (this.gameState.inventoryOpen && this.onInventoryToggle) {
            this.onInventoryToggle();
        }

        ui.updateStatusLine1('🔨 Chiseling...', 0);
        return true;
    }

    /**
     * Handle chiseling completion
     * @param {object} activeAction - The active chiseling action
     * @returns {object} - Result of chiseling {success, message, chiselBroke}
     */
    completeChiselingAction(activeAction) {
        const chisel = activeAction.chisel;
        const stone = activeAction.stone;

        // UNIVERSAL TOOL DURABILITY SYSTEM
        // Formula: Durability Loss = (10 * resourceQuality) / toolQuality
        // - Base loss is 10 durability per action
        // - Better chisels (higher quality) last longer
        // - Harder stones (higher quality) wear chisels faster
        // See ResourceManager.js for detailed examples
        const stoneQuality = stone.quality;
        const chiselQuality = chisel.quality;
        const durabilityLoss = Math.ceil((10 * stoneQuality) / chiselQuality);
        chisel.durability = Math.max(0, chisel.durability - durabilityLoss);

        let result = {
            success: false,
            message: '',
            chiselBroke: false
        };

        // Check if chisel broke
        if (chisel.durability === 0) {
            // Delete chisel from inventory
            const chiselIndex = this.gameState.inventory.items.indexOf(chisel);
            if (chiselIndex > -1) {
                this.gameState.inventory.items.splice(chiselIndex, 1);
            }

            result.chiselBroke = true;
            result.message = 'Chisel broke!';
            ui.updateStatusLine1('⚠️ Chisel broke!', 4000);
            ui.updateStatusLine2('Chiseling failed!', 4000);
        } else {
            // Chiseling succeeded - convert stone to chiseled version
            const chiseledType = this.convertToChiseledType(stone.type);

            // Update stone type in place (keeps position, quality, rotation)
            stone.type = chiseledType;
            // Ensure durability is set (materials should have durability for consistency)
            stone.durability = 100;

            result.success = true;
            result.message = `Created ${chiseledType.replace('R', '')}`;
            ui.updateStatusLine1(`✅ ${result.message}`, 3000);
        }

        // Re-render inventory
        if (this.gameState.inventoryOpen) {
            this.inventoryUI.renderInventory();
        }

        // Clear active action
        this.gameState.activeAction = null;
        ui.updateChoppingProgress(0);

        return result;
    }

    /**
     * Convert stone type to its chiseled version
     * @param {string} stoneType - Original stone type
     * @returns {string} - Chiseled stone type
     */
    convertToChiseledType(stoneType) {
        return stoneType.replace('limestone', 'chiseledlimestone')
                       .replace('sandstone', 'chiseledsandstone')
                       .replace('Rlimestone', 'Rchiseledlimestone')
                       .replace('Rsandstone', 'Rchiseledsandstone');
    }

    /**
     * Check if an item can be chiseled
     * @param {string} itemType - Type of item
     * @returns {boolean}
     */
    canBeChiseled(itemType) {
        return itemType.includes('limestone') || itemType.includes('sandstone');
    }

    /**
     * Check if an item is already chiseled
     * @param {string} itemType - Type of item
     * @returns {boolean}
     */
    isChiseled(itemType) {
        return itemType.includes('chiseled');
    }

    /**
     * Get crafting recipes (for future expansion)
     * @returns {Array} - List of available recipes
     */
    getRecipes() {
        return [
            {
                tool: 'chisel',
                input: 'limestone',
                output: 'chiseledlimestone',
                duration: CONFIG.ACTIONS.CHISELING_DURATION
            },
            {
                tool: 'chisel',
                input: 'sandstone',
                output: 'chiseledsandstone',
                duration: CONFIG.ACTIONS.CHISELING_DURATION
            }
        ];
    }

    /**
     * Check if two items can be combined
     * @param {object} item1 - First item
     * @param {object} item2 - Second item
     * @returns {boolean}
     */
    canBeCombined(item1, item2) {
        if (!item1 || !item2) return false;

        // Normalize types (remove 'R' prefix for rotated items)
        const type1 = item1.type.replace('R', '');
        const type2 = item2.type.replace('R', '');

        // Check if same type and combinable
        if (type1 !== type2) return false;

        // grass + grass = rope
        if (type1 === 'grass' && type2 === 'grass') return true;

        // rope + rope = fishingnet
        if (type1 === 'rope' && type2 === 'rope') return true;

        return false;
    }

    /**
     * Get the result of combining two items
     * @param {string} itemType - Type of items being combined (normalized, no 'R')
     * @returns {string|null} - Result item type, or null if no recipe
     */
    getCombineResult(itemType) {
        const recipes = {
            'grass': 'rope',
            'rope': 'fishingnet'
        };

        return recipes[itemType] || null;
    }

    /**
     * Combine two items with duration and progress bar
     * @param {object} item1 - First item to combine
     * @param {object} item2 - Second item to combine
     * @returns {object} - Result {success, message}
     */
    combineItems(item1, item2) {
        console.log('[COMBINE DEBUG] CraftingSystem.combineItems called with:', item1, item2);

        // Check if already performing an action
        if (this.gameState.activeAction) {
            console.warn('Already performing an action');
            return {
                success: false,
                message: 'Already busy',
                resultItem: null
            };
        }

        // Check if items can be combined
        const canCombine = this.canBeCombined(item1, item2);
        console.log('[COMBINE DEBUG] canBeCombined result:', canCombine);

        if (!canCombine) {
            console.log('[COMBINE DEBUG] ❌ Items cannot be combined');
            return {
                success: false,
                message: 'Items cannot be combined',
                resultItem: null
            };
        }

        console.log('[COMBINE DEBUG] ✅ Items CAN be combined! Proceeding...');

        // Normalize type (remove 'R' prefix)
        const itemType = item1.type.replace('R', '');

        // Get result type
        const resultType = this.getCombineResult(itemType);
        if (!resultType) {
            return {
                success: false,
                message: 'No recipe found',
                resultItem: null
            };
        }

        // Start combining action (locks movement)
        this.gameState.activeAction = {
            object: null, // No world object for combining
            startTime: Date.now(),
            duration: CONFIG.ACTIONS.COMBINE_DURATION, // 6 seconds from config.js
            actionType: 'combining',
            item1: item1,
            item2: item2,
            resultType: resultType
        };

        // Play grass sound for all combining (grass -> rope, rope -> fishingnet)
        if (this.audioManager) {
            const sound = this.audioManager.playGrassSound();
            this.gameState.activeAction.sound = sound;
        }

        // Start chopping animation if available
        if (this.animationMixer && this.choppingAction) {
            // Stop walk animation if we have reference to it
            if (this.game && this.game.animationAction) {
                this.game.animationAction.stop();
            }
            this.choppingAction.reset();
            this.choppingAction.play();
        }

        // Broadcast grass sound to peers
        this.networkManager.broadcastP2P({
            type: 'player_sound',
            payload: {
                soundType: 'grass',
                startTime: Date.now()
            }
        });

        // Close inventory if it's open
        if (this.gameState.inventoryOpen && this.onInventoryToggle) {
            this.onInventoryToggle();
        }

        const displayName = resultType.charAt(0).toUpperCase() + resultType.slice(1);
        ui.updateStatusLine1(`🔧 Combining to ${displayName}...`, 0);

        return {
            success: true,
            message: 'Started combining'
        };
    }

    /**
     * Complete combining action
     * @param {object} activeAction - The active combining action
     * @returns {object} - Result of combining {success, message, resultItem}
     */
    completeCombineAction(activeAction) {
        const item1 = activeAction.item1;
        const item2 = activeAction.item2;
        const resultType = activeAction.resultType;

        // Calculate average quality
        const avgQuality = Math.round((item1.quality + item2.quality) / 2);

        // Delete both source items from inventory
        const inventory = this.gameState.inventory.items;
        const index1 = inventory.indexOf(item1);
        const index2 = inventory.indexOf(item2);

        if (index1 > -1) inventory.splice(index1, 1);
        // Adjust index2 if item1 was removed before it
        const adjustedIndex2 = index1 < index2 ? index2 - 1 : index2;
        if (adjustedIndex2 > -1) inventory.splice(adjustedIndex2, 1);

        // Create result item
        const resultItem = {
            id: `${resultType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: resultType,
            x: -1, // Will be placed by tryAddItemToInventory
            y: -1,
            width: 1,
            height: 1,
            rotation: 0,
            quality: avgQuality,
            durability: 100
        };

        let result = {
            success: false,
            message: '',
            resultItem: null
        };

        // Try to add result to inventory
        if (this.game && this.game.tryAddItemToInventory(resultItem)) {
            const displayName = resultType.charAt(0).toUpperCase() + resultType.slice(1);
            ui.updateStatusLine1(`✅ Created ${displayName} (Q${avgQuality})`, 3000);

            result.success = true;
            result.message = `Created ${displayName}`;
            result.resultItem = resultItem;
        } else {
            // Failed to add - restore the original items
            inventory.push(item1, item2);
            ui.updateStatusLine1('⚠️ Inventory full!', 3000);

            result.success = false;
            result.message = 'Inventory full';
        }

        // Re-render inventory
        if (this.gameState.inventoryOpen) {
            this.inventoryUI.renderInventory();
        }

        // Clear active action
        this.gameState.activeAction = null;
        ui.updateChoppingProgress(0);

        return result;
    }

    // Removed calculateToolWear() - replaced by universal durability formula in completeChiselingAction()
    // See UNIVERSAL TOOL DURABILITY SYSTEM comments in ResourceManager.js for formula details

    /**
     * Set animation mixer for crafting animations
     * @param {THREE.AnimationMixer} mixer
     * @param {THREE.AnimationAction} choppingAction
     */
    setAnimationReferences(mixer, choppingAction) {
        this.animationMixer = mixer;
        this.choppingAction = choppingAction;
    }

    /**
     * Set player controller reference for movement locking
     * @param {PlayerController} controller
     */
    setPlayerController(controller) {
        this.playerController = controller;
    }

    /**
     * Set inventory toggle callback
     * @param {function} callback
     */
    setInventoryToggleCallback(callback) {
        this.onInventoryToggle = callback;
    }

    /**
     * Set game reference for accessing animation state
     * @param {Game} game - Main game instance
     */
    setGameReference(game) {
        this.game = game;
    }
}
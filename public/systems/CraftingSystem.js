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
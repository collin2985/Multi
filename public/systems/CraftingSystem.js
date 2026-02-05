/**
 * CraftingSystem.js
 * Manages all crafting mechanics - chiseling, tool durability, material conversion
 */

import { CONFIG } from '../config.js';
import { ui } from '../ui.js';
import { getItemSize } from '../ui/InventoryHelpers.js';
import { PlayerInventory } from '../player/PlayerInventory.js';

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
            ui.showToast('Chisel is broken!', 'warning');
            return false;
        }

        // Stop player movement and broadcast stop to peers
        if (this.game && this.game.playerController) {
            this.gameState.isMoving = false;
            this.game.playerController.stopMovement();

            // Broadcast stop position to peers
            const pos = this.game.playerObject.position;
            this.networkManager.broadcastP2P({
                type: 'player_pos',
                t: Date.now(),
                p: pos.toArray(),
                r: this.game.playerObject.rotation.y
            });
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

        ui.updateActionStatus('Chiseling...', 0);
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

        // TOOL DURABILITY SYSTEM
        // Each chiseling action removes 1 durability
        // Quality determines max durability (durability = quality, min 10)
        chisel.durability = Math.max(0, chisel.durability - 1);

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
            ui.showToast('Chisel broke!', 'warning');
            ui.updateActionStatus('Chiseling failed!', 3000);
        } else {
            // Chiseling succeeded - convert stone to chiseled version
            const chiseledType = this.convertToChiseledType(stone.type);

            // Update stone type in place (keeps position, quality, rotation)
            stone.type = chiseledType;
            // Ensure durability is set (materials should have durability for consistency)
            stone.durability = 100;

            result.success = true;
            result.message = `Created ${chiseledType.replace('R', '')}`;
            ui.updateActionStatus(result.message, 3000);
        }

        // Re-render inventory and construction section
        if (this.gameState.inventoryOpen) {
            this.inventoryUI.refresh();
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

        // Same-type combining
        if (type1 === type2) {
            // Ammo can be combined with ammo (stacking)
            if (type1 === 'ammo') {
                const qty1 = item1.quantity || 1;
                const qty2 = item2.quantity || 1;
                const maxStack = CONFIG.AMMO.MAX_STACK;
                // Can combine if neither is at max stack
                return qty1 < maxStack || qty2 < maxStack;
            }

            // vines + vines = rope
            if (type1 === 'vines') return true;

            // rope + rope = fishingnet
            if (type1 === 'rope') return true;

            // hempfiber + hempfiber = fabric
            if (type1 === 'hempfiber') return true;

            // animalskin + animalskin = fabric
            if (type1 === 'animalskin') return true;

            return false;
        }

        // Cross-type combining: limestone + rope = improvisedtool
        const sorted = [type1, type2].sort().join('+');
        if (sorted === 'limestone+rope') return true;

        return false;
    }

    /**
     * Get the result of combining two items
     * @param {string} type1 - First item type (normalized, no 'R')
     * @param {string} type2 - Second item type (optional, for cross-type recipes)
     * @returns {string|null} - Result item type, or null if no recipe
     */
    getCombineResult(type1, type2 = null) {
        const t1 = type1.replace('R', '');

        // Same-type recipes (existing behavior when type2 is null or same)
        if (!type2 || t1 === type2.replace('R', '')) {
            const sameTypeRecipes = {
                'vines': 'rope',
                'rope': 'fishingnet',
                'hempfiber': 'fabric',
                'animalskin': 'fabric'
            };
            return sameTypeRecipes[t1] || null;
        }

        // Cross-type recipes
        const t2 = type2.replace('R', '');
        const sorted = [t1, t2].sort().join('+');
        const crossTypeRecipes = {
            'limestone+rope': 'improvisedtool'
        };
        return crossTypeRecipes[sorted] || null;
    }

    /**
     * Get all items that can be combined with the given item type
     * @param {string} itemType - Type of item (can include 'R' prefix)
     * @returns {Array<{combineWith: string, result: string}>} - List of possible combinations
     */
    getCombinableWith(itemType) {
        const normalizedType = itemType.replace('R', '');
        const combinations = [];

        // Same-type combinations (vines+vines, rope+rope)
        const sameTypeCombos = {
            'vines': 'rope',
            'rope': 'fishingnet',
            'hempfiber': 'fabric',
            'animalskin': 'fabric'
        };

        if (sameTypeCombos[normalizedType]) {
            combinations.push({
                combineWith: normalizedType,
                result: sameTypeCombos[normalizedType]
            });
        }

        // Cross-type combinations
        const crossTypeCombos = {
            'rope': [{ combineWith: 'limestone', result: 'improvisedtool' }],
            'limestone': [{ combineWith: 'rope', result: 'improvisedtool' }]
        };

        if (crossTypeCombos[normalizedType]) {
            combinations.push(...crossTypeCombos[normalizedType]);
        }

        return combinations;
    }

    /**
     * Get chisel recipe result for a stone type
     * @param {string} stoneType - Type of stone (can include 'R' prefix)
     * @returns {string|null} - Result type, or null if not chiselable
     */
    getChiselResult(stoneType) {
        const normalizedType = stoneType.replace('R', '');

        if (normalizedType === 'limestone') return 'chiseledlimestone';
        if (normalizedType === 'sandstone') return 'chiseledsandstone';

        return null;
    }

    /**
     * Get all items that a chisel can work on
     * @returns {Array<{input: string, result: string}>} - List of chisel recipes
     */
    getChiselRecipes() {
        return [
            { input: 'limestone', result: 'chiseledlimestone' },
            { input: 'sandstone', result: 'chiseledsandstone' }
        ];
    }

    /**
     * Check if the result of combining two items will fit in inventory
     * @param {object} item1 - First item to combine
     * @param {object} item2 - Second item to combine
     * @param {string} resultType - Type of result item
     * @returns {boolean} - True if result will fit
     */
    _canFitCombineResult(item1, item2, resultType) {
        const { width, height } = getItemSize(resultType);
        const items = this.gameState.inventory.items;
        const rows = this.gameState.inventory.rows || 10;
        const cols = this.gameState.inventory.cols || 5;

        // Create a temp items list without the source items
        const tempItems = items.filter(i => i !== item1 && i !== item2);

        // Try both orientations: original and rotated 90°
        const orientations = [{ w: width, h: height }];
        if (width !== height) {
            orientations.push({ w: height, h: width });
        }

        for (const orient of orientations) {
            for (let y = 0; y <= rows - orient.h; y++) {
                for (let x = 0; x <= cols - orient.w; x++) {
                    if (PlayerInventory.isPositionFree(x, y, orient.w, orient.h, tempItems)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * Combine two items with duration and progress bar
     * @param {object} item1 - First item to combine
     * @param {object} item2 - Second item to combine
     * @returns {object} - Result {success, message}
     */
    combineItems(item1, item2) {
        // Special instant handling for ammo stacking
        if (item1.type === 'ammo' && item2.type === 'ammo') {
            const qty1 = item1.quantity || 1;
            const qty2 = item2.quantity || 1;
            const total = qty1 + qty2;
            const maxStack = CONFIG.AMMO.MAX_STACK;

            if (total <= maxStack) {
                // Merge into item1, remove item2
                item1.quantity = total;
                // Remove item2 from inventory
                const idx = this.gameState.inventory.items.indexOf(item2);
                if (idx > -1) this.gameState.inventory.items.splice(idx, 1);
            } else {
                // Fill item1 to max, remainder stays in item2
                item1.quantity = maxStack;
                item2.quantity = total - maxStack;
            }

            // Re-render inventory and construction section
            if (this.gameState.inventoryOpen) {
                this.inventoryUI.refresh();
            }

            return { success: true, message: 'Ammo stacked', instant: true };
        }

        // Check if already performing an action
        if (this.gameState.activeAction) {
            return {
                success: false,
                message: 'Already busy',
                resultItem: null
            };
        }

        // Check if items can be combined
        const canCombine = this.canBeCombined(item1, item2);

        if (!canCombine) {
            return {
                success: false,
                message: 'Items cannot be combined',
                resultItem: null
            };
        }

        // Normalize types (remove 'R' prefix)
        const type1 = item1.type.replace('R', '');
        const type2 = item2.type.replace('R', '');

        // Get result type (pass both types for cross-type recipes)
        const resultType = this.getCombineResult(type1, type2);
        if (!resultType) {
            return {
                success: false,
                message: 'No recipe found',
                resultItem: null
            };
        }

        // Check if result will fit in inventory BEFORE starting action
        if (!this._canFitCombineResult(item1, item2, resultType)) {
            const { width, height } = getItemSize(resultType);
            ui.showToast(`Need ${width}x${height} space for result!`, 'warning');
            return {
                success: false,
                message: 'Not enough space',
                resultItem: null
            };
        }

        // Stop player movement and broadcast stop to peers
        if (this.game && this.game.playerController) {
            this.gameState.isMoving = false;
            this.game.playerController.stopMovement();

            // Broadcast stop position to peers
            const pos = this.game.playerObject.position;
            this.networkManager.broadcastP2P({
                type: 'player_pos',
                t: Date.now(),
                p: pos.toArray(),
                r: this.game.playerObject.rotation.y
            });
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

        // Play vines sound for all combining (vines -> rope, rope -> fishingnet)
        if (this.audioManager) {
            const sound = this.audioManager.playVinesSound();
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

        // Broadcast vines sound to peers
        this.networkManager.broadcastP2P({
            type: 'player_sound',
            payload: {
                soundType: 'vines',
                startTime: Date.now()
            }
        });

        // Broadcast combining animation to peers
        this.networkManager.broadcastP2P({
            type: 'player_harvest',
            payload: {
                harvestType: 'combining',
                startTime: Date.now(),
                duration: CONFIG.ACTIONS.COMBINE_DURATION
            }
        });

        // Close inventory if it's open
        if (this.gameState.inventoryOpen && this.onInventoryToggle) {
            this.onInventoryToggle();
        }

        const displayName = resultType.charAt(0).toUpperCase() + resultType.slice(1);
        ui.updateActionStatus(`Combining to ${displayName}...`, 0);

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

        // Calculate quality based on recipe type
        let resultQuality;
        if (resultType === 'improvisedtool') {
            // Fixed quality for improvised tool
            resultQuality = 10;
        } else {
            // Calculate average quality
            resultQuality = Math.round((item1.quality + item2.quality) / 2);

            // Minimum quality floor for tools (25)
            const TOOL_TYPES = ['fishingnet', 'axe', 'pickaxe', 'saw', 'hammer', 'chisel'];
            if (TOOL_TYPES.includes(resultType)) {
                resultQuality = Math.max(resultQuality, 25);
            }
        }

        // Delete both source items from inventory
        const inventory = this.gameState.inventory.items;
        const index1 = inventory.indexOf(item1);
        const index2 = inventory.indexOf(item2);

        if (index1 > -1) inventory.splice(index1, 1);
        // Adjust index2 if item1 was removed before it
        const adjustedIndex2 = index1 < index2 ? index2 - 1 : index2;
        if (adjustedIndex2 > -1) inventory.splice(adjustedIndex2, 1);

        // Get correct size from InventoryHelpers
        const { width, height } = getItemSize(resultType);

        // Create result item
        const resultItem = {
            id: `${resultType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: resultType,
            x: -1, // Will be placed by tryAddItemToInventory
            y: -1,
            width: width,
            height: height,
            rotation: 0,
            quality: resultQuality,
            durability: resultQuality  // For tools, durability = quality
        };

        let result = {
            success: false,
            message: '',
            resultItem: null
        };

        // Try to add result to inventory
        if (this.game && this.game.tryAddItemToInventory(resultItem)) {
            const displayName = resultType.charAt(0).toUpperCase() + resultType.slice(1);
            ui.updateActionStatus(`Created ${displayName} (Q${resultQuality})`, 3000);

            result.success = true;
            result.message = `Created ${displayName}`;
            result.resultItem = resultItem;

            // Update inventory full status indicator
            if (this.game?.playerInventory) {
                ui.updateInventoryFullStatus(this.game.playerInventory.isFull());
            }
        } else {
            // Failed to add - restore the original items
            inventory.push(item1, item2);
            ui.showToast(`Inventory full! Need ${resultItem.width}x${resultItem.height} space`, 'warning');
            ui.updateInventoryFullStatus(true);

            result.success = false;
            result.message = 'Inventory full';
        }

        // Re-render inventory and construction section
        if (this.gameState.inventoryOpen) {
            this.inventoryUI.refresh();
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
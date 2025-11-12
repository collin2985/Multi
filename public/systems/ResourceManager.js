/**
 * ResourceManager.js
 * Manages all resource harvesting mechanics:
 * - Resource harvesting actions (firewood, planks, stone)
 * - Harvest completion handling
 * - Harvest cooldown management
 * - Tool requirements and durability
 * - Resource depletion tracking
 * - Inventory item creation from harvested resources
 * - Log spawning when trees are chopped
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { ui } from '../ui.js';

export class ResourceManager {
    constructor(gameState, networkManager, audioManager, inventoryUI) {
        this.gameState = gameState;
        this.networkManager = networkManager;
        this.audioManager = audioManager;
        this.inventoryUI = inventoryUI;

        // Animation references (set via setAnimationReferences)
        this.animationMixer = null;
        this.choppingAction = null;

        // Game references (set after construction)
        this.game = null;
    }

    /**
     * Set reference to main game instance for delegated methods
     * @param {Game} game - Main game instance
     */
    setGameReference(game) {
        this.game = game;
    }

    /**
     * Set animation mixer and chopping action for harvest animations
     * @param {THREE.AnimationMixer} mixer
     * @param {THREE.AnimationAction} choppingAction
     */
    setAnimationReferences(mixer, choppingAction) {
        this.animationMixer = mixer;
        this.choppingAction = choppingAction;
    }

    /**
     * Start resource harvesting action (firewood, planks, or stone)
     * @param {object} object - Resource object to harvest
     * @param {string} harvestType - 'firewood', 'planks', or 'stone'
     */
    startHarvestAction(object, harvestType) {
        // Check if cooldown is active
        if (this.gameState.harvestCooldown) {
            const remaining = this.gameState.harvestCooldown.endTime - Date.now();
            if (remaining > 0) {
                ui.updateStatus(`⏳ Harvest cooldown: ${Math.ceil(remaining / 1000)}s`);
                return;
            } else {
                // Cooldown expired, clear it
                this.gameState.harvestCooldown = null;
            }
        }

        // Validate tool requirements
        let requiredTool;
        if (harvestType === 'firewood') {
            requiredTool = 'axe';
        } else if (harvestType === 'planks') {
            requiredTool = 'saw';
        } else if (harvestType === 'stone') {
            requiredTool = 'pickaxe';
        }

        if (!this.hasToolWithDurability(requiredTool)) {
            console.warn(`Cannot harvest ${harvestType}: missing ${requiredTool} with durability`);
            return;
        }

        // Face the target object
        if (object.position && this.game && this.game.playerObject) {
            const targetAngle = Math.atan2(
                object.position.x - this.game.playerObject.position.x,
                object.position.z - this.game.playerObject.position.z
            );
            this.game.playerObject.rotation.y = targetAngle;
        }

        // Start harvesting action
        this.gameState.activeAction = {
            object: object,
            startTime: Date.now(),
            duration: CONFIG.ACTIONS.HARVEST_LOG_DURATION, // 10 seconds from config.js
            harvestType: harvestType // Store harvest type for server request
        };

        // Play appropriate sound
        if (this.audioManager) {
            let sound;
            if (harvestType === 'firewood') {
                sound = this.audioManager.playAxeSound();
            } else if (harvestType === 'planks') {
                sound = this.audioManager.playSawSound();
            } else if (harvestType === 'stone') {
                sound = this.audioManager.playPickaxeSound();
            }
            this.gameState.activeAction.sound = sound;
        }

        // Start chopping animation
        if (this.animationMixer && this.choppingAction) {
            // Stop walk animation if we have reference to it
            if (this.game && this.game.animationAction) {
                this.game.animationAction.stop();
            }
            this.choppingAction.reset();
            this.choppingAction.play();
        }

        // Broadcast harvest action to peers
        this.networkManager.broadcastP2P({
            type: 'player_harvest',
            payload: {
                harvestType: harvestType,
                startTime: Date.now(),
                duration: 10000
            }
        });

        // Broadcast sound to peers
        let soundType;
        if (harvestType === 'firewood') {
            soundType = 'axe';
        } else if (harvestType === 'planks') {
            soundType = 'saw';
        } else if (harvestType === 'stone') {
            soundType = 'pickaxe';
        }

        this.networkManager.broadcastP2P({
            type: 'player_sound',
            payload: {
                soundType: soundType,
                startTime: Date.now()
            }
        });
    }

    /**
     * Start fishing action to catch fish from shore
     */
    startFishingAction() {
        // Check if cooldown is active
        if (this.gameState.harvestCooldown) {
            const remaining = this.gameState.harvestCooldown.endTime - Date.now();
            if (remaining > 0) {
                ui.updateStatus(`⏳ Rest needed: ${Math.ceil(remaining / 1000)}s`);
                return;
            } else {
                this.gameState.harvestCooldown = null;
            }
        }

        // Check for fishing net with durability
        if (!this.hasToolWithDurability('fishingnet')) {
            console.warn('Cannot fish: missing fishing net with durability');
            ui.updateStatus('⚠️ Need fishing net');
            return;
        }

        // Optional: Face the water direction
        if (this.game && this.game.playerObject && this.gameState.waterDirection !== null) {
            this.game.playerObject.rotation.y = this.gameState.waterDirection;
        }

        // Start fishing action
        this.gameState.activeAction = {
            object: null, // No world object for fishing
            startTime: Date.now(),
            duration: CONFIG.ACTIONS.HARVEST_LOG_DURATION, // 10 seconds
            actionType: 'fishing'
        };

        // Play sound (reuse axe sound for now)
        if (this.audioManager) {
            const sound = this.audioManager.playAxeSound();
            this.gameState.activeAction.sound = sound;
        }

        // Start chopping animation
        if (this.animationMixer && this.choppingAction) {
            if (this.game && this.game.animationAction) {
                this.game.animationAction.stop();
            }
            this.choppingAction.reset();
            this.choppingAction.play();
        }

        // Broadcast fishing action to peers
        this.networkManager.broadcastP2P({
            type: 'player_fishing',
            payload: {
                startTime: Date.now(),
                duration: CONFIG.ACTIONS.HARVEST_LOG_DURATION
            }
        });

        // Broadcast sound to peers
        this.networkManager.broadcastP2P({
            type: 'player_sound',
            payload: {
                soundType: 'axe', // Using axe sound for fishing
                startTime: Date.now()
            }
        });

        ui.updateStatus('🎣 Fishing...');
    }

    /**
     * Handle resource harvested message from server
     * @param {object} payload - Server payload with harvest results
     * @returns {object} - Result data for game.js to handle scene cleanup
     */
    handleResourceHarvested(payload) {
        const { objectId, harvestType, remainingResources, depleted, harvestedBy } = payload;

        // Find the resource object in chunkObjects (this is the authoritative reference used by proximity checks)
        let resourceObject = null;
        let foundInChunk = null;

        if (!this.game || !this.game.terrainRenderer) {
            console.error('ResourceManager: game or terrainRenderer not set');
            return { handled: false };
        }

        this.game.terrainRenderer.chunkObjects.forEach((chunkObjects, chunkKey) => {
            const obj = chunkObjects.find(o => o.userData.objectId === objectId);
            if (obj) {
                resourceObject = obj;
                foundInChunk = chunkKey;
            }
        });

        if (resourceObject) {
            // Update remaining resources in the chunkObjects
            resourceObject.userData.remainingResources = remainingResources;

            // Update nearestObject display if this is the currently selected object
            if (this.gameState.nearestObject && this.gameState.nearestObject.id === objectId) {
                this.gameState.nearestObject.remainingResources = remainingResources;
                // Trigger UI update
                const hasAxe = this.hasToolWithDurability('axe');
                const hasSaw = this.hasToolWithDurability('saw');
                const hasHammer = this.hasToolWithDurability('hammer');
                const isOnCooldown = this.gameState.harvestCooldown && this.gameState.harvestCooldown.endTime > Date.now();
                ui.updateNearestObject(
                    this.gameState.nearestObject.name,
                    this.gameState.nearestObject.toolCheck,
                    this.gameState.nearestObject.quality,
                    this.gameState.nearestObject.remainingResources,
                    this.gameState.nearestObject.totalResources
                );
                ui.updateButtonStates(this.gameState.isInChunk, this.gameState.nearestTree, this.gameState.nearestRock, this.gameState.nearestLog, hasAxe, hasSaw, isOnCooldown, this.gameState.nearestConstructionSite, this.gameState.isMoving, this.gameState.nearestStructure, hasHammer);
            }

            // If this client harvested it, handle durability and inventory
            if (harvestedBy === this.gameState.clientId) {
                this.handleOwnHarvest(resourceObject, harvestType);
            }

            // Return result so game.js can handle scene cleanup if needed
            return {
                handled: true,
                resourceObject: resourceObject,
                depleted: depleted,
                objectId: objectId
            };
        } else {
            console.warn(`Resource ${objectId} not found in scene`);
            return { handled: false };
        }
    }

    /**
     * Handle harvest that this client performed
     * @param {object} resourceObject - The resource object that was harvested
     * @param {string} harvestType - Type of harvest (firewood, planks, stone)
     */
    handleOwnHarvest(resourceObject, harvestType) {
        // Determine which tool was used
        let toolType;
        if (harvestType === 'firewood') {
            toolType = 'axe';
        } else if (harvestType === 'planks') {
            toolType = 'saw';
        } else if (harvestType === 'stone') {
            toolType = 'pickaxe';
        }

        // Find the tool in inventory
        const tool = this.gameState.inventory.items.find(item =>
            item.type === toolType && item.durability > 0
        );

        if (tool) {
            // UNIVERSAL TOOL DURABILITY SYSTEM
            // Formula: Durability Loss = (10 * resourceQuality) / toolQuality
            // - Base loss is 10 durability per action
            // - Better tools (higher quality) last longer
            // - Harder resources (higher quality) wear tools faster
            // Examples:
            //   Tool Q100 + Resource Q100 = 10 loss (premium tool on premium resource)
            //   Tool Q100 + Resource Q50 = 5 loss (premium tool on medium resource)
            //   Tool Q50 + Resource Q100 = 20 loss (medium tool struggles with premium resource)
            //   Tool Q50 + Resource Q50 = 10 loss (balanced)
            //   Tool Q10 + Resource Q100 = 100 loss (poor tool breaks immediately)
            const resourceQuality = resourceObject.userData.quality;
            const toolQuality = tool.quality;
            const durabilityLoss = Math.ceil((10 * resourceQuality) / toolQuality);
            tool.durability = Math.max(0, tool.durability - durabilityLoss);

            // Check if tool broke
            if (tool.durability === 0) {
                // Delete tool from inventory
                const toolIndex = this.gameState.inventory.items.indexOf(tool);
                if (toolIndex > -1) {
                    this.gameState.inventory.items.splice(toolIndex, 1);
                }
                ui.updateStatus(`⚠️ Your ${toolType} broke!`);
                ui.updateStatusLine2(`⚠️ Your ${toolType} broke!`, 5000);
            }

            // Re-render inventory if it's open
            if (this.gameState.inventoryOpen) {
                this.inventoryUI.renderInventory();
            }
        }

        // Create inventory item (firewood, plank, or stone)
        const newItem = this.createHarvestedItem(resourceObject, harvestType);
        console.log(`[HARVEST] Created item:`, newItem);
        console.log(`[HARVEST] this.game exists:`, !!this.game);

        // Try to add item to inventory
        if (this.game && this.game.tryAddItemToInventory(newItem)) {
            console.log(`[HARVEST] Successfully added ${newItem.type} to inventory`);
            ui.updateStatusLine1(`✅ Harvested ${newItem.type}`, 2000);

            // Re-render inventory if it's open
            if (this.gameState.inventoryOpen) {
                this.inventoryUI.renderInventory();
            }
        } else {
            console.log(`[HARVEST] Failed to add ${newItem.type} to inventory`);
            ui.updateStatusLine1(`⚠️ Inventory full!`, 3000);
        }

        // Start 3-second cooldown
        this.startHarvestCooldown();
    }

    /**
     * Create an inventory item from harvested resources
     * @param {object} resourceObject - The resource object that was harvested
     * @param {string} harvestType - Type of harvest (firewood, planks, stone)
     * @returns {object} - New inventory item
     */
    createHarvestedItem(resourceObject, harvestType) {
        let materialType, itemWidth, itemHeight;
        const resourceName = resourceObject.userData.modelType;

        if (harvestType === 'stone') {
            // Rock items are just the rock name (limestone or sandstone)
            materialType = resourceName; // "limestone" or "sandstone"
            itemWidth = 1;
            itemHeight = 1;
        } else {
            // Extract tree type from resource name (e.g., "oak_log" -> "oak")
            const treeType = resourceName.replace('_log', ''); // e.g., "oak_log" -> "oak"
            // Convert "planks" to "plank" (singular) to match image filenames
            const materialSuffix = harvestType === 'planks' ? 'plank' : harvestType;
            materialType = `${treeType}${materialSuffix}`; // e.g., "oakfirewood", "pineplank"
            itemWidth = 2;
            itemHeight = 4;
        }

        return {
            id: `${materialType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: materialType,
            x: -1, // Will be set when we find space
            y: -1,
            width: itemWidth,
            height: itemHeight,
            rotation: 0,
            quality: resourceObject.userData.quality, // Inherit resource quality
            durability: 100 // Harvested items start at full durability
        };
    }

    /**
     * Start 3-second harvest cooldown with countdown display
     */
    startHarvestCooldown() {
        this.gameState.harvestCooldown = {
            endTime: Date.now() + 3000
        };

        // Show countdown message on statusLine2
        let secondsRemaining = 3;
        ui.updateStatusLine2(`⏳ Resting (${secondsRemaining}s)`, 0); // 0 = don't auto-hide

        // Update countdown every second
        const countdownInterval = setInterval(() => {
            secondsRemaining--;
            if (secondsRemaining > 0) {
                ui.updateStatusLine2(`⏳ Resting (${secondsRemaining}s)`, 0);
            } else {
                clearInterval(countdownInterval);
                ui.updateStatusLine2(null); // Clear the message

                // Clear the cooldown and update button states
                this.gameState.harvestCooldown = null;

                // Update button states to show harvest button again
                const hasAxe = this.hasToolWithDurability('axe');
                const hasSaw = this.hasToolWithDurability('saw');
                const hasHammer = this.hasToolWithDurability('hammer');
                ui.updateButtonStates(
                    this.gameState.isInChunk,
                    this.gameState.nearestTree,
                    this.gameState.nearestRock,
                    this.gameState.nearestLog,
                    hasAxe,
                    hasSaw,
                    false, // isOnCooldown = false now
                    this.gameState.nearestConstructionSite,
                    this.gameState.isMoving,
                    this.gameState.nearestStructure,
                    hasHammer
                );
            }
        }, 1000);
    }

    /**
     * Handle harvest lock failure from server
     * @param {object} payload - Server payload with failure reason
     */
    handleHarvestLockFailed(payload) {
        const { objectId, reason } = payload;

        // Check if we're currently harvesting this log
        if (this.gameState.activeAction &&
            this.gameState.activeAction.object.id === objectId) {

            // Stop sound
            if (this.gameState.activeAction.sound) {
                this.gameState.activeAction.sound.stop();
            }

            // Stop animation
            if (this.animationMixer && this.choppingAction) {
                this.choppingAction.stop();
            }

            // Clear active action
            this.gameState.activeAction = null;
            ui.updateChoppingProgress(0);

            // Show message to user
            ui.updateStatus(`⚠️ ${reason}`);
            ui.updateStatusLine2(`⚠️ ${reason}`, 4000);
        }
    }

    /**
     * Complete harvest action and send to server
     * @param {object} activeAction - The active harvesting action
     */
    completeHarvestAction(activeAction) {
        const object = activeAction.object;
        const harvestType = activeAction.harvestType;

        // Send harvest_resource_request to server with complete object data
        // This allows the server to handle natural resources on first interaction
        this.networkManager.sendMessage('harvest_resource_request', {
            chunkId: `chunk_${object.chunkKey}`,
            objectId: object.id,
            harvestType: harvestType, // 'firewood', 'planks', or 'stone'
            clientId: this.gameState.clientId,
            objectData: {
                name: object.name,
                position: object.position.toArray(),
                quality: object.quality,
                scale: object.scale,
                totalResources: object.totalResources,
                remainingResources: object.remainingResources
            }
        });

        // Update proximity to refresh buttons
        if (this.game) {
            this.game.checkProximityToObjects();
        }
    }

    /**
     * Complete fishing action - roll for catch success and create fish
     */
    completeFishingAction() {
        // Find fishing net in inventory
        const net = this.gameState.inventory.items.find(item =>
            item.type === 'fishingnet' && item.durability > 0
        );

        if (!net) {
            ui.updateStatusLine1('⚠️ No fishing net!', 3000);
            this.startHarvestCooldown();
            return;
        }

        // Catch success rate = net quality as percentage
        const catchChance = net.quality; // 1-100
        const roll = Math.random() * 100; // 0-100

        if (roll > catchChance) {
            // Failed to catch fish
            ui.updateStatusLine1('❌ Nothing caught!', 3000);
            this.startHarvestCooldown();
            return;
        }

        // SUCCESS: Caught a fish!
        // Generate random base fish quality (10-100)
        const baseFishQuality = Math.floor(Math.random() * 91) + 10; // 10 to 100

        // Apply net quality multiplier
        const finalFishQuality = Math.floor(baseFishQuality * (net.quality / 100));

        // Calculate fish durability based on quality
        const fishDurability = Math.floor(30 * (finalFishQuality / 100));

        // UNIVERSAL TOOL DURABILITY SYSTEM
        // Formula: Durability Loss = (10 * resourceQuality) / toolQuality
        // For fishing: resource = fish quality
        const durabilityLoss = Math.ceil((10 * finalFishQuality) / net.quality);
        net.durability = Math.max(0, net.durability - durabilityLoss);

        // Check if net broke
        if (net.durability === 0) {
            const netIndex = this.gameState.inventory.items.indexOf(net);
            if (netIndex > -1) {
                this.gameState.inventory.items.splice(netIndex, 1);
            }
            ui.updateStatus('⚠️ Your fishing net broke!');
            ui.updateStatusLine2('⚠️ Your fishing net broke!', 5000);
        }

        // Re-render inventory if open
        if (this.gameState.inventoryOpen) {
            this.inventoryUI.renderInventory();
        }

        // Create fish item
        const newFish = {
            id: `fish_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'fish',
            x: -1,
            y: -1,
            width: 1,
            height: 1,
            rotation: 0,
            quality: finalFishQuality,
            durability: fishDurability
        };

        // Try to add to inventory
        if (this.game && this.game.tryAddItemToInventory(newFish)) {
            ui.updateStatusLine1(`✅ Caught fish (Q${finalFishQuality})`, 2000);

            // Re-render inventory if open
            if (this.gameState.inventoryOpen) {
                this.inventoryUI.renderInventory();
            }
        } else {
            ui.updateStatusLine1('⚠️ Inventory full!', 3000);
        }

        // Start cooldown
        this.startHarvestCooldown();
    }

    /**
     * Request server to spawn a log when tree is chopped
     * @param {object} treeObject - Tree object that was chopped
     */
    requestLogSpawn(treeObject) {
        const treeTypes = ['oak', 'fir', 'pine', 'cypress'];
        if (!treeTypes.includes(treeObject.name)) {
            return; // Not a tree, don't request log spawn
        }

        // Log scale matches tree scale
        const logScale = treeObject.scale;
        const logType = `${treeObject.name}_log`; // e.g., "oak_log", "pine_log"
        const logId = `${logType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Set total resources to 1
        const totalResources = 1;

        // Send add_object_request to server (server will spawn the log)
        this.networkManager.sendMessage('add_object_request', {
            chunkId: `chunk_${treeObject.chunkKey}`,
            objectId: logId,
            objectType: logType, // e.g., "oak_log" instead of just "log"
            objectPosition: treeObject.position.toArray(),
            objectQuality: treeObject.quality,
            objectScale: logScale,
            totalResources: totalResources,
            remainingResources: totalResources
        });
    }

    /**
     * Check if player has tool with durability > 0
     * @param {string} toolType - Type of tool (axe, saw, pickaxe, etc.)
     * @returns {boolean} - True if tool exists with durability
     */
    hasToolWithDurability(toolType) {
        const tool = this.gameState.inventory.items.find(item =>
            item.type === toolType && item.durability > 0
        );
        return !!tool;
    }

    /**
     * Check if player has the required tool for a specific object type
     * @param {string} objectType - Type of object (tree, rock, structure, log)
     * @returns {object} - {hasRequiredTool: boolean, requiredTool: string|null, reason: string|null}
     */
    hasRequiredTool(objectType) {
        // Check if it's a log type (ends with _log or is just "log")
        const isLog = objectType.endsWith('_log') || objectType === 'log';

        // Define tool requirements for each object type
        const toolRequirements = {
            // Trees require axe
            'oak': 'axe',
            'fir': 'axe',
            'pine': 'axe',
            'cypress': 'axe',
            // Rocks require pickaxe
            'limestone': 'pickaxe',
            'sandstone': 'pickaxe',
            'clay': 'pickaxe',
            // Structures require hammer
            'construction': 'hammer',
            'foundation': 'hammer',
            'foundationcorner': 'hammer',
            'foundationroundcorner': 'hammer',
            'crate': 'hammer',
            'tent': 'hammer',
            'house': 'hammer',
            'garden': 'hammer',
            'market': 'hammer',
            'outpost': 'hammer',
            'ship': 'hammer',
            'dock': 'hammer'
        };

        // All logs require saw (for proximity display, but buttons will check separately)
        let requiredTool = toolRequirements[objectType];
        if (!requiredTool && isLog) {
            requiredTool = 'saw';
        }

        if (!requiredTool) {
            // No tool required for this object type
            return { hasRequiredTool: true, requiredTool: null, reason: null };
        }

        // Check inventory for the required tool with durability > 0
        const tool = this.gameState.inventory.items.find(item =>
            item.type === requiredTool && item.durability > 0
        );

        if (tool) {
            return { hasRequiredTool: true, requiredTool, reason: null };
        } else {
            // Check if they have the tool but it's broken
            const brokenTool = this.gameState.inventory.items.find(item => item.type === requiredTool);
            if (brokenTool) {
                return {
                    hasRequiredTool: false,
                    requiredTool,
                    reason: `${requiredTool} is broken (0 durability)`
                };
            } else {
                return {
                    hasRequiredTool: false,
                    requiredTool: null,
                    reason: `Requires ${requiredTool}`
                };
            }
        }
    }

    /**
     * Check if harvest cooldown is active
     * @returns {boolean} - True if cooldown is active
     */
    isOnCooldown() {
        return this.gameState.harvestCooldown &&
               this.gameState.harvestCooldown.endTime > Date.now();
    }

    /**
     * Get remaining cooldown time in milliseconds
     * @returns {number} - Remaining cooldown time, or 0 if not on cooldown
     */
    getRemainingCooldown() {
        if (!this.gameState.harvestCooldown) {
            return 0;
        }
        return Math.max(0, this.gameState.harvestCooldown.endTime - Date.now());
    }

    /**
     * Clear harvest cooldown
     */
    clearCooldown() {
        this.gameState.harvestCooldown = null;
    }
}

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
import { CONFIG as TERRAIN_CONFIG } from '../TerrainConfig.js';
import { ui } from '../ui.js';
import ChunkCoordinates from '../core/ChunkCoordinates.js';
import { QualityGenerator } from '../core/QualityGenerator.js';

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

        // Track pending player harvest to distinguish from NPC harvests
        this.pendingHarvestObjectId = null;
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
        // Guard: Prevent starting new action if one is already in progress
        if (this.gameState.activeAction) {
            return;
        }

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
        // Guard: Prevent starting new action if one is already in progress
        if (this.gameState.activeAction) {
            return;
        }

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

        // Notify tasks panel that fish button was clicked (player is at ocean)
        window.tasksPanel?.onFishButtonClicked();

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

        // Play fishing sound
        if (this.audioManager) {
            const sound = this.audioManager.playFishingSound();
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
                soundType: 'fishing',
                startTime: Date.now()
            }
        });

        ui.updateActionStatus('Fishing...', 0);
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

        if (!this.game || !this.game.chunkManager) {
            console.error('ResourceManager: game or chunkManager not set');
            return { handled: false };
        }

        // First check chunkManager.chunkObjects
        this.game.chunkManager.chunkObjects.forEach((chunkObjects, chunkKey) => {
            const obj = chunkObjects.find(o => o.userData.objectId === objectId);
            if (obj) {
                resourceObject = obj;
                foundInChunk = chunkKey;
            }
        });

        // If not found in chunkObjects, use fast registry lookup
        if (!resourceObject && this.game.objectRegistry) {
            resourceObject = this.game.objectRegistry.get(objectId);
        }

        // Fallback to scene traversal if still not found (shouldn't normally happen)
        if (!resourceObject) {
            this.game.scene.traverse((object) => {
                if (object.userData && object.userData.objectId === objectId && !object.userData.isBoundingBox) {
                    resourceObject = object;
                    // Cache it for next time
                    if (this.game.objectRegistry) {
                        this.game.objectRegistry.set(objectId, object);
                    }
                }
            });
        }

        if (resourceObject) {
            // Update remaining resources in the userData
            resourceObject.userData.remainingResources = remainingResources;

            // ALSO update in chunkObjects if it's there
            if (foundInChunk) {
                const chunkObj = this.game.chunkManager.chunkObjects.get(foundInChunk);
                if (chunkObj) {
                    const obj = chunkObj.find(o => o.userData.objectId === objectId);
                    if (obj) {
                        obj.userData.remainingResources = remainingResources;
                    }
                }
            }

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
                const hasFishingNet = this.hasToolWithDurability('fishingnet');
                ui.updateButtonStates(
                    this.gameState.isInChunk,
                    this.gameState.nearestObject,
                    hasAxe,
                    hasSaw,
                    isOnCooldown,
                    this.gameState.nearestConstructionSite,
                    this.gameState.isMoving,
                    this.gameState.nearestStructure,
                    hasHammer,
                    this.gameState.nearWater,
                    hasFishingNet,
                    this.gameState.onGrass,
                    this.gameState.mushroomAvailable,
                    this.gameState.vegetableSeedsAvailable,
                    this.gameState.limestoneAvailable,
                    this.gameState.seedsAvailable,
                    this.gameState.seedTreeType,
                    this.gameState.climbingState?.isClimbing || false,
                    null,
                    this.gameState.vegetablesGatherAvailable,
                    this.gameState.hempSeedsAvailable,
                    this.gameState.hempGatherAvailable,
                    this.gameState.activeAction
                );
            }

            // If this client harvested it, handle durability and inventory
            // Only process if this matches the player's pending harvest (not NPC harvests)
            if (harvestedBy === this.gameState.clientId && this.pendingHarvestObjectId === objectId) {
                this.pendingHarvestObjectId = null; // Clear pending harvest
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

        // Find the tool in inventory (including improvised tool as substitute)
        const tool = this.gameState.inventory.items.find(item =>
            this._canServeAsTool(item.type, toolType) && item.durability > 0
        );

        if (tool) {
            // TOOL DURABILITY SYSTEM
            // Each harvest action removes 1 durability
            // Quality determines max durability (durability = quality, min 10)
            tool.durability = Math.max(0, tool.durability - 1);

            // Check if tool broke
            if (tool.durability === 0) {
                // Delete tool from inventory
                const toolIndex = this.gameState.inventory.items.indexOf(tool);
                if (toolIndex > -1) {
                    this.gameState.inventory.items.splice(toolIndex, 1);
                }
                ui.showToast(`Your ${toolType} broke!`, 'warning');
            }

            // Re-render inventory if it's open
            if (this.gameState.inventoryOpen) {
                this.inventoryUI.renderInventory();
            }
        }

        // Create inventory item (firewood, plank, or stone)
        const newItem = this.createHarvestedItem(resourceObject, harvestType);

        // Try to add item to inventory
        if (this.game && this.game.tryAddItemToInventory(newItem)) {
            ui.updateActionStatus(`Harvested ${newItem.type}`, 2000);

            // Re-render inventory if it's open
            if (this.gameState.inventoryOpen) {
                this.inventoryUI.renderInventory();
            }
            // Update inventory full status indicator
            if (this.game?.playerInventory) {
                ui.updateInventoryFullStatus(this.game.playerInventory.isFull());
            }
        } else {
            ui.showToast(`Inventory full! Need ${newItem.width}x${newItem.height} space`, 'warning');
            ui.updateInventoryFullStatus(true);
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

        // Firewood durability = quality (min 20), giving 10-50 min burn time at 2/min consumption
        // Other items start at 100 durability
        const quality = resourceObject.userData.quality;
        const durability = (harvestType === 'firewood')
            ? Math.max(20, quality)
            : 100;

        return {
            id: `${materialType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: materialType,
            x: -1, // Will be set when we find space
            y: -1,
            width: itemWidth,
            height: itemHeight,
            rotation: 0,
            quality: quality,
            durability: durability
        };
    }

    /**
     * Start 3-second harvest cooldown with countdown display
     */
    startHarvestCooldown() {
        this.gameState.harvestCooldown = {
            endTime: Date.now() + 3000
        };

        // Show countdown message above progress bar
        let secondsRemaining = 3;
        ui.updateActionStatus(`Resting (${secondsRemaining}s)`, 0); // 0 = don't auto-hide

        // Update countdown every second
        const countdownInterval = setInterval(() => {
            secondsRemaining--;
            if (secondsRemaining > 0) {
                ui.updateActionStatus(`Resting (${secondsRemaining}s)`, 0);
            } else {
                clearInterval(countdownInterval);
                ui.updateActionStatus(null); // Clear the message

                // Clear the cooldown and update button states
                this.gameState.harvestCooldown = null;

                // Update button states to show harvest button again
                const hasAxe = this.hasToolWithDurability('axe');
                const hasSaw = this.hasToolWithDurability('saw');
                const hasHammer = this.hasToolWithDurability('hammer');
                const hasFishingNet = this.hasToolWithDurability('fishingnet');
                ui.updateButtonStates(
                    this.gameState.isInChunk,
                    this.gameState.nearestObject,
                    hasAxe,
                    hasSaw,
                    false, // isOnCooldown = false now
                    this.gameState.nearestConstructionSite,
                    this.gameState.isMoving,
                    this.gameState.nearestStructure,
                    hasHammer,
                    this.gameState.nearWater,
                    hasFishingNet,
                    this.gameState.onGrass,
                    this.gameState.mushroomAvailable,
                    this.gameState.vegetableSeedsAvailable,
                    this.gameState.limestoneAvailable,
                    this.gameState.seedsAvailable,
                    this.gameState.seedTreeType,
                    this.gameState.climbingState?.isClimbing || false,
                    null,
                    this.gameState.vegetablesGatherAvailable,
                    this.gameState.hempSeedsAvailable,
                    this.gameState.hempGatherAvailable,
                    this.gameState.activeAction
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
            ui.showToast(reason, 'warning');
        }
    }

    /**
     * Complete harvest action and send to server
     * @param {object} activeAction - The active harvesting action
     */
    completeHarvestAction(activeAction) {
        // Check server connection before harvesting
        if (!this.networkManager.isServerConnected()) {
            ui.showToast('Cannot harvest: Not connected to server', 'error');
            return;
        }

        const object = activeAction.object;
        const harvestType = activeAction.harvestType;

        // Track this as a pending player harvest (to distinguish from NPC harvests)
        this.pendingHarvestObjectId = object.id;

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
            ui.showToast('No fishing net!', 'warning');
            ui.updateActionStatus('', 0); // Clear fishing status
            this.startHarvestCooldown();
            return;
        }

        // Catch success rate = net quality as percentage, minimum 25%
        const catchChance = Math.max(net.quality, 25); // 25-100
        const roll = Math.random() * 100; // 0-100

        if (roll > catchChance) {
            // Failed to catch fish
            ui.showToast('Nothing caught...', 'info');
            ui.updateActionStatus('', 0); // Clear fishing status
            this.startHarvestCooldown();
            return;
        }

        // SUCCESS: Caught a fish!
        // Get player position to determine chunk-based fish quality
        const playerX = this.game.playerObject.position.x;
        const playerZ = this.game.playerObject.position.z;
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(playerX, playerZ);
        const worldSeed = TERRAIN_CONFIG.TERRAIN.seed;

        // Get chunk-based fish quality (hybrid: chunk range modified by net quality)
        const chunkFishQuality = QualityGenerator.getQuality(worldSeed, chunkX, chunkZ, 'fish');

        // Apply net quality multiplier
        const finalFishQuality = Math.floor(chunkFishQuality * (net.quality / 100));

        // Calculate fish durability based on quality (base 60, minimum 10)
        const fishDurability = Math.max(10, Math.floor(60 * (finalFishQuality / 100)));

        // TOOL DURABILITY SYSTEM
        // Each fishing action removes 1 durability
        // Quality determines max durability (durability = quality, min 10)
        net.durability = Math.max(0, net.durability - 1);

        // Check if net broke
        if (net.durability === 0) {
            const netIndex = this.gameState.inventory.items.indexOf(net);
            if (netIndex > -1) {
                this.gameState.inventory.items.splice(netIndex, 1);
            }
            ui.showToast('Fishing net broke!', 'warning');
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
            ui.showToast(`Caught a fish! (Quality: ${finalFishQuality})`, 'success');

            // Re-render inventory if open
            if (this.gameState.inventoryOpen) {
                this.inventoryUI.renderInventory();
            }
            // Update inventory full status indicator
            if (this.game?.playerInventory) {
                ui.updateInventoryFullStatus(this.game.playerInventory.isFull());
            }
        } else {
            ui.showToast(`Inventory full! Need ${newFish.width}x${newFish.height} space`, 'warning');
            ui.updateInventoryFullStatus(true);
        }

        // Clear fishing status
        ui.updateActionStatus('', 0);

        // Start cooldown
        this.startHarvestCooldown();
    }

    /**
     * Request server to spawn a log when tree is chopped
     * @param {object} treeObject - Tree object that was chopped
     */
    requestLogSpawn(treeObject) {
        const treeTypes = ['oak', 'fir', 'pine', 'cypress', 'apple'];
        if (!treeTypes.includes(treeObject.name)) {
            return; // Not a tree, don't request log spawn
        }

        // Check if tree is fully grown (only spawn logs for mature trees)
        if (treeObject.isGrowing || (treeObject.growthScale && treeObject.growthScale < 1.0)) {
            return; // Don't spawn log for baby trees
        }

        // Log scale matches tree scale (convert Vector3 to scalar)
        const logScale = treeObject.scale.x; // Use x component as scalar (trees have uniform scale)
        const logType = `${treeObject.name}_log`; // e.g., "oak_log", "pine_log"
        const logId = `${logType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Set total resources to 5
        const totalResources = 5;

        // Generate random rotation for log (0-360 degrees)
        // Billboard trees don't have rotation, so we create a random one here
        // Server will record this rotation so dirt patch and log match
        const logRotationDegrees = Math.random() * 360;

        // Send add_object_request to server (server will spawn the log)
        this.networkManager.sendMessage('add_object_request', {
            chunkId: `chunk_${treeObject.chunkKey}`,
            objectId: logId,
            objectType: logType, // e.g., "oak_log" instead of just "log"
            objectPosition: treeObject.position.toArray(),
            objectQuality: treeObject.quality,
            objectScale: logScale,
            objectRotation: logRotationDegrees, // Random rotation, server records it
            totalResources: totalResources,
            remainingResources: totalResources,
            clientId: this.gameState.clientId,
            accountId: this.gameState.accountId || null
        });
    }

    /**
     * Check if an item can serve as a specific tool type
     * @param {string} itemType - Actual item type in inventory
     * @param {string} requiredType - Required tool type
     * @returns {boolean} - True if item can serve as the required tool
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
     * Check if player has tool with durability > 0
     * @param {string} toolType - Type of tool (axe, saw, pickaxe, etc.)
     * @returns {boolean} - True if tool exists with durability
     */
    hasToolWithDurability(toolType) {
        const tool = this.gameState.inventory.items.find(item =>
            this._canServeAsTool(item.type, toolType) && item.durability > 0
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
            'apple': 'axe',
            // Rocks require pickaxe
            'limestone': 'pickaxe',
            'sandstone': 'pickaxe',
            'clay': 'pickaxe',
            'iron': 'pickaxe',
            // Structures require hammer
            'construction': 'hammer',
            'foundation': 'hammer',
            'foundationcorner': 'hammer',
            'foundationroundcorner': 'hammer',
            'crate': 'hammer',
            'tent': 'hammer',
            'house': 'hammer',
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

        // Check inventory for the required tool with durability > 0 (including improvised tool)
        const tool = this.gameState.inventory.items.find(item =>
            this._canServeAsTool(item.type, requiredTool) && item.durability > 0
        );

        if (tool) {
            return { hasRequiredTool: true, requiredTool, reason: null };
        } else {
            // Check if they have the tool but it's broken
            const brokenTool = this.gameState.inventory.items.find(item =>
                this._canServeAsTool(item.type, requiredTool)
            );
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

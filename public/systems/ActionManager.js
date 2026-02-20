
import { CONFIG } from '../config.js';
import { ui } from '../ui.js';
import { isPlankType, isRawStone, isChiseledStone } from '../ui/InventoryHelpers.js';
import * as THREE from 'three';

/**
 * ActionManager
 * Handles player actions like chopping trees, building structures, and harvesting resources.
 */
export class ActionManager {
    constructor(game) {
        this.game = game;
        this.gameState = game.gameState;
        this.networkManager = game.networkManager;
    }

    startRemovalAction(object) {
        // Guard: Prevent starting new action if one is already in progress
        if (this.gameState.activeAction) {
            return;
        }

        // Cancel auto-run when starting action
        this.game?.inputManager?.cancelAutoRun();

        const treeTypes = ['oak', 'fir', 'pine', 'cypress', 'apple'];
        const structureTypes = ['construction', 'foundation', 'foundationcorner', 'foundationroundcorner',
            'crate', 'tent', 'house', 'market', 'outpost', 'ship', 'dock', 'tileworks', 'bearden'];
        const isTree = treeTypes.includes(object.name);
        const isStructure = structureTypes.includes(object.name);

        // Face the target object
        if (object.position) {
            const targetAngle = Math.atan2(
                object.position.x - this.game.playerObject.position.x,
                object.position.z - this.game.playerObject.position.z
            );
            this.game.playerObject.rotation.y = targetAngle;
        }

        // Start removal action
        this.gameState.activeAction = {
            object: object,
            startTime: Date.now(),
            duration: isStructure ? CONFIG.ACTIONS.CHOP_STRUCTURE_DURATION : CONFIG.ACTIONS.CHOP_TREE_DURATION,
            actionType: isStructure ? 'demolish' : 'chop'
        };

        // Play appropriate sound
        if (isTree && this.game.audioManager) {
            const sound = this.game.audioManager.playAxeSound();
            this.gameState.activeAction.sound = sound;
        } else if (isStructure && this.game.audioManager) {
            const sound = this.game.audioManager.playHammerSound();
            this.gameState.activeAction.sound = sound;
        }

        // Start removal animation and stop walking
        if (this.game.animationMixer && this.game.choppingAction) {
            // Stop walking animation if playing
            if (this.game.animationAction) {
                this.game.animationAction.stop();
            }
            // Start chopping animation
            this.game.choppingAction.reset();
            this.game.choppingAction.play();
        }

        // Broadcast sound to peers
        if (isTree) {
            this.networkManager.broadcastP2P({
                type: 'player_sound',
                payload: {
                    soundType: 'axe',
                    startTime: Date.now()
                }
            });
        } else if (isStructure) {
            this.networkManager.broadcastP2P({
                type: 'player_sound',
                payload: {
                    soundType: 'hammer',
                    startTime: Date.now()
                }
            });
        }
    }

    startHarvestAction(object, harvestType) {
        // Cancel auto-run when starting action
        this.game?.inputManager?.cancelAutoRun();

        // Delegate to ResourceManager
        if (this.game.resourceManager) {
            this.game.resourceManager.startHarvestAction(object, harvestType);
        }
    }

    updateChoppingAction() {
        if (!this.gameState.activeAction) return;

        // Cancel action if player died
        if (this.game.isDead) {
            this.cancelChoppingAction();
            return;
        }

        const now = Date.now();
        const elapsed = now - this.gameState.activeAction.startTime;
        const progress = Math.min(elapsed / this.gameState.activeAction.duration, 1);

        // Throttle UI updates (configurable interval), but always update on completion
        const shouldUpdateUI = (now - this.gameState.lastChoppingProgressUpdate >= CONFIG.GAME_LOOP.ACTION_PROGRESS_UPDATE_INTERVAL) || progress >= 1;

        if (shouldUpdateUI) {
            ui.updateChoppingProgress(progress);
            this.gameState.lastChoppingProgressUpdate = now;
        }

        // Play tree falling sound at 7 seconds into tree chop action
        if (this.gameState.activeAction.actionType === 'chop' &&
            elapsed >= 7000 &&
            !this.gameState.activeAction.treeSoundPlayed) {

            // Mark as played so we don't play it again
            this.gameState.activeAction.treeSoundPlayed = true;

            // Play tree falling sound locally
            if (this.game.audioManager) {
                this.game.audioManager.playTreeSound();
            }

            // Broadcast tree sound to other players
            this.networkManager.broadcastP2P({
                type: 'player_sound',
                payload: {
                    soundType: 'tree',
                    startTime: Date.now()
                }
            });
        }

        // Check if action is complete (checked every frame for responsiveness)
        if (progress >= 1) {
            this.completeActiveAction();
        }
    }

    cancelChoppingAction() {
        if (!this.gameState.activeAction) return;

        // Get action type before clearing
        const actionType = this.gameState.activeAction.actionType;

        // Stop sound
        if (this.gameState.activeAction.sound) {
            this.gameState.activeAction.sound.stop();
        }

        // Stop chopping animation
        if (this.game.choppingAction) {
            this.game.choppingAction.stop();
        }

        // Clear active action
        this.gameState.activeAction = null;
        ui.updateChoppingProgress(0);
        ui.updateActionStatus('', 0); // Clear any action status text

        // Show cancellation message based on action type
        if (actionType === 'demolish') {
            ui.showToast('Demolish cancelled', 'info');
        } else if (actionType === 'chop') {
            ui.showToast('Chopping cancelled', 'info');
        } else if (actionType === 'build') {
            ui.showToast('Building cancelled', 'info');
        } else if (actionType === 'build_road') {
            ui.showToast('Road building cancelled', 'info');
        } else if (actionType === 'build_campfire') {
            ui.showToast('Campfire building cancelled', 'info');
        } else if (actionType === 'build_tent') {
            ui.showToast('Tent building cancelled', 'info');
        } else if (actionType === 'build_wall') {
            ui.showToast('Wall building cancelled', 'info');
        } else if (actionType === 'build_boat' || actionType === 'build_sailboat' || actionType === 'build_ship2') {
            ui.showToast('Boat building cancelled', 'info');
        } else if (actionType === 'build_cart') {
            ui.showToast('Cart building cancelled', 'info');
        } else if (actionType === 'build_artillery') {
            ui.showToast('Artillery building cancelled', 'info');
        } else if (actionType === 'build_crate') {
            ui.showToast('Crate building cancelled', 'info');
        } else if (actionType === 'combining') {
            ui.showToast('Combining cancelled', 'info');
        } else {
            ui.showToast('Action cancelled', 'info');
        }
    }

    completeActiveAction() {
        if (!this.gameState.activeAction) return;

        const object = this.gameState.activeAction.object;
        const harvestType = this.gameState.activeAction.harvestType;
        const actionType = this.gameState.activeAction.actionType;

        // Notify tasks panel of action completion
        window.tasksPanel?.onActionComplete(actionType, harvestType);

        // Stop sound
        if (this.gameState.activeAction.sound) {
            this.gameState.activeAction.sound.stop();
        }

        // Stop action animation
        if (this.game.animationMixer && this.game.choppingAction) {
            this.game.choppingAction.stop();
        }

        // Handle build completion
        if (actionType === 'build') {
            // Delegate to BuildingSystem
            if (this.game.buildingSystem) {
                this.game.buildingSystem.completeBuildAction(this.gameState.activeAction);
            }
            return;
        }

        // Handle road building completion
        if (actionType === 'build_road') {
            const roadData = this.gameState.activeAction.roadData;

            // 1. Decrease hammer/improvised tool durability
            const hammer = this.gameState.inventory.items.find(item =>
                (item.type === 'hammer' || item.type === 'improvisedtool') && item.durability > 0
            );

            if (hammer) {
                hammer.durability = Math.max(0, hammer.durability - 1);

                // Remove tool if broken
                if (hammer.durability === 0) {
                    const hammerIndex = this.gameState.inventory.items.indexOf(hammer);
                    this.gameState.inventory.items.splice(hammerIndex, 1);
                    const toolName = hammer.type === 'improvisedtool' ? 'Improvised tool' : 'Hammer';
                    ui.showToast(`${toolName} broke!`, 'warning');
                }
            }

            // 2. Send server message to place road (apply texture)
            this.networkManager.sendMessage('place_road', {
                position: roadData.position,
                rotation: roadData.rotation,
                materialType: roadData.materialType || 'limestone',  // sandstone or limestone
                clientId: this.gameState.clientId,
                accountId: this.gameState.accountId || null
            });

            // 3. Clear active action
            this.gameState.activeAction = null;
            ui.updateChoppingProgress(0);
            ui.showToast('Road complete!', 'success');

            // Resume walk animation if moving
            if (this.gameState.isMoving && this.game.animationAction) {
                this.game.animationAction.play();
            }

            return;
        }

        // Handle water vehicle building completion (boat, sailboat, ship2)
        const waterVehicleActions = ['build_boat', 'build_sailboat', 'build_ship2'];
        if (waterVehicleActions.includes(actionType)) {
            const boatData = this.gameState.activeAction.boatData;
            const vehicleType = boatData.vehicleType || 'boat';

            // Send server message to place vehicle structure
            this.networkManager.sendMessage(`place_${vehicleType}`, {
                position: boatData.position,
                rotation: boatData.rotation,
                materialQuality: boatData.materialQuality,
                clientId: this.gameState.clientId,
                accountId: this.gameState.accountId || null
            });

            // Clear active action
            this.gameState.activeAction = null;
            ui.updateChoppingProgress(0);

            const vehicleNames = { boat: 'Boat', sailboat: 'Sailboat', ship2: 'Ship' };
            ui.showToast(`${vehicleNames[vehicleType] || 'Boat'} complete!`, 'success');
            window.tasksPanel?.onStructurePlaced(vehicleType);

            // Resume walk animation if moving
            if (this.gameState.isMoving && this.game.animationAction) {
                this.game.animationAction.play();
            }

            return;
        }

        // Handle repair completion (Phase 2: Repair System)
        if (actionType === 'repair') {
            // Check server connection before repairing
            if (!this.networkManager.isServerConnected()) {
                ui.showToast('Cannot repair: Not connected to server', 'error');
                this.gameState.activeAction = null;
                ui.updateChoppingProgress(0);
                return;
            }

            const structure = this.gameState.activeAction.object;
            const structureType = structure.userData.modelType || structure.name;
            const isHorse = structureType === 'horse';

            // Horse feeding doesn't require hammer, everything else does
            let hammer = null;
            if (!isHorse) {
                // Find hammer or improvised tool in inventory
                hammer = this.gameState.inventory.items.find(item =>
                    (item.type === 'hammer' || item.type === 'improvisedtool') && item.durability > 0
                );

                if (!hammer) {
                    ui.showToast('No hammer or improvised tool found!', 'warning');
                    this.gameState.activeAction = null;
                    ui.updateChoppingProgress(0);
                    return;
                }
            }

            // Get structure type and required materials
            const requiredMaterials = CONFIG.CONSTRUCTION.MATERIALS[structureType];

            if (!requiredMaterials) {
                ui.showToast('Cannot repair this structure type', 'warning');
                this.gameState.activeAction = null;
                ui.updateChoppingProgress(0);
                return;
            }

            // Find required materials in inventory
            const repairMaterials = [];
            const missingMaterials = [];

            for (const [material, quantity] of Object.entries(requiredMaterials)) {
                let found = 0;

                if (isPlankType(material)) {
                    // For plank requirements, accept any plank type
                    const plankTypes = ['oakplank', 'pineplank', 'firplank', 'cypressplank', 'appleplank'];
                    for (const plankType of plankTypes) {
                        if (found >= quantity) break;
                        const items = this.gameState.inventory.items.filter(item => item.type === plankType);
                        for (const item of items) {
                            if (found >= quantity) break;
                            repairMaterials.push({
                                type: item.type,
                                quality: item.quality || 50,
                                id: item.id
                            });
                            found++;
                        }
                    }
                } else if (isRawStone(material)) {
                    // For raw stone requirements, accept limestone or sandstone
                    const stoneTypes = ['limestone', 'sandstone'];
                    for (const stoneType of stoneTypes) {
                        if (found >= quantity) break;
                        const items = this.gameState.inventory.items.filter(item => item.type === stoneType);
                        for (const item of items) {
                            if (found >= quantity) break;
                            repairMaterials.push({
                                type: item.type,
                                quality: item.quality || 50,
                                id: item.id
                            });
                            found++;
                        }
                    }
                } else if (isChiseledStone(material)) {
                    // For chiseled stone requirements, accept chiseledlimestone or chiseledsandstone
                    const chiseledTypes = ['chiseledlimestone', 'chiseledsandstone'];
                    for (const chiseledType of chiseledTypes) {
                        if (found >= quantity) break;
                        const items = this.gameState.inventory.items.filter(item => item.type === chiseledType);
                        for (const item of items) {
                            if (found >= quantity) break;
                            repairMaterials.push({
                                type: item.type,
                                quality: item.quality || 50,
                                id: item.id
                            });
                            found++;
                        }
                    }
                } else {
                    // For other materials, require exact type
                    const items = this.gameState.inventory.items.filter(item => item.type === material);
                    for (const item of items) {
                        if (found >= quantity) break;
                        repairMaterials.push({
                            type: item.type,
                            quality: item.quality || 50,
                            id: item.id
                        });
                        found++;
                    }
                }

                if (found < quantity) {
                    let displayName = material;
                    if (isPlankType(material)) displayName = 'plank';
                    else if (isRawStone(material)) displayName = 'stone';
                    else if (isChiseledStone(material)) displayName = 'chiseled stone';
                    missingMaterials.push(`${quantity - found} ${displayName}`);
                }
            }

            if (missingMaterials.length > 0) {
                ui.showToast(`Missing: ${missingMaterials.join(', ')}`, 'warning');
                this.gameState.activeAction = null;
                ui.updateChoppingProgress(0);
                return;
            }

            // Consume hammer durability (not for horse feeding)
            if (!isHorse && hammer) {
                hammer.durability = Math.max(0, hammer.durability - 1);

                if (hammer.durability === 0) {
                    const hammerIndex = this.gameState.inventory.items.indexOf(hammer);
                    this.gameState.inventory.items.splice(hammerIndex, 1);
                    const toolName = hammer.type === 'improvisedtool' ? 'Improvised tool' : 'Hammer';
                    ui.showToast(`${toolName} broke!`, 'warning');
                }
            }

            // Send repair request to server with materials
            this.networkManager.sendMessage('repair_structure', {
                structureId: structure.userData.objectId,
                chunkKey: structure.userData.chunkKey,
                materials: repairMaterials,
                clientId: this.gameState.clientId,
                accountId: this.gameState.accountId || null
            });

            // Remove materials from inventory (will be validated by server)
            repairMaterials.forEach(mat => {
                const itemIndex = this.gameState.inventory.items.findIndex(item => item.id === mat.id);
                if (itemIndex > -1) {
                    this.gameState.inventory.items.splice(itemIndex, 1);
                }
            });

            // Clear active action
            this.gameState.activeAction = null;
            ui.updateChoppingProgress(0);
            ui.showToast(isHorse ? 'Horse fed!' : 'Structure repaired!', 'success');

            // Resume walk animation if moving
            if (this.gameState.isMoving && this.game.animationAction) {
                this.game.animationAction.play();
            }

            // Update proximity to refresh buttons
            if (this.game.interactionManager) {
                this.game.interactionManager.checkProximityToObjects();
            } else if (typeof this.game.checkProximityToObjects === 'function') {
                this.game.checkProximityToObjects();
            }

            return;
        }

        // Handle campfire building completion
        if (actionType === 'build_campfire') {
            const campfireData = this.gameState.activeAction.campfireData;

            // No tool durability loss (campfire doesn't require tools)

            // Send server message to place campfire structure
            this.networkManager.sendMessage('place_campfire', {
                position: campfireData.position,
                rotation: campfireData.rotation,
                materialQuality: campfireData.materialQuality,  // Pass stone quality to server
                materialType: campfireData.materialType || 'limestone',  // sandstone or limestone
                clientId: this.gameState.clientId,
                accountId: this.gameState.accountId || null
            });

            // Clear active action
            this.gameState.activeAction = null;
            ui.updateChoppingProgress(0);
            ui.showToast('Campfire complete!', 'success');

            // Resume walk animation if moving
            if (this.gameState.isMoving && this.game.animationAction) {
                this.game.animationAction.play();
            }

            return;
        }

        // Handle tent building completion
        if (actionType === 'build_tent') {
            const tentData = this.gameState.activeAction.tentData;

            // No tool durability loss (tent doesn't require tools)

            // Send server message to place tent structure
            this.networkManager.sendMessage('place_tent', {
                position: tentData.position,
                rotation: tentData.rotation,
                materialQuality: tentData.materialQuality,  // Pass plank quality to server
                clientId: this.gameState.clientId,
                accountId: this.gameState.accountId || null  // For setting as home
            });

            // Clear active action
            this.gameState.activeAction = null;
            ui.updateChoppingProgress(0);
            ui.showToast('Tent complete!', 'success');

            // Notify tasks panel
            if (window.tasksPanel) {
                window.tasksPanel.onStructurePlaced('tent');
            }

            // Resume walk animation if moving
            if (this.gameState.isMoving && this.game.animationAction) {
                this.game.animationAction.play();
            }

            return;
        }

        // Handle wall building completion
        if (actionType === 'build_wall') {
            const wallData = this.gameState.activeAction.wallData;

            // No tool durability loss (wall doesn't require tools)

            // Send server message to place wall structure
            this.networkManager.sendMessage('place_wall', {
                position: wallData.position,
                rotation: wallData.rotation,
                materialQuality: wallData.materialQuality,
                materialType: wallData.materialType || 'limestone',
                clientId: this.gameState.clientId,
                accountId: this.gameState.accountId || null
            });

            // Clear active action
            this.gameState.activeAction = null;
            ui.updateChoppingProgress(0);
            ui.showToast('Wall complete!', 'success');

            // Resume walk animation if moving
            if (this.gameState.isMoving && this.game.animationAction) {
                this.game.animationAction.play();
            }

            return;
        }

        // Handle outpost building completion
        if (actionType === 'build_outpost') {
            const outpostData = this.gameState.activeAction.outpostData;

            // Send server message to place outpost structure
            this.networkManager.sendMessage('place_outpost', {
                position: outpostData.position,
                rotation: outpostData.rotation,
                materialQuality: outpostData.materialQuality,
                clientId: this.gameState.clientId,
                accountId: this.gameState.accountId || null
            });

            // Clear active action
            this.gameState.activeAction = null;
            ui.updateChoppingProgress(0);
            ui.showToast('Outpost complete!', 'success');

            // Notify tasks panel
            if (window.tasksPanel) {
                window.tasksPanel.onStructurePlaced('outpost');
            }

            // Resume walk animation if moving
            if (this.gameState.isMoving && this.game.animationAction) {
                this.game.animationAction.play();
            }

            return;
        }

        // Handle cart building completion
        if (actionType === 'build_cart') {
            const cartData = this.gameState.activeAction.cartData;

            // Send server message to place cart structure
            this.networkManager.sendMessage('place_cart', {
                position: cartData.position,
                rotation: cartData.rotation,
                materialQuality: cartData.materialQuality,
                clientId: this.gameState.clientId,
                accountId: this.gameState.accountId || null
            });

            // Clear active action
            this.gameState.activeAction = null;
            ui.updateChoppingProgress(0);
            ui.showToast('Cart complete!', 'success');

            // Notify tasks panel
            if (window.tasksPanel) {
                window.tasksPanel.onStructurePlaced('cart');
            }

            // Resume walk animation if moving
            if (this.gameState.isMoving && this.game.animationAction) {
                this.game.animationAction.play();
            }

            return;
        }

        // Handle artillery building completion
        if (actionType === 'build_artillery') {
            const artilleryData = this.gameState.activeAction.artilleryData;

            // Send server message to place artillery structure
            this.networkManager.sendMessage('place_artillery', {
                position: artilleryData.position,
                rotation: artilleryData.rotation,
                materialQuality: artilleryData.materialQuality,
                clientId: this.gameState.clientId,
                accountId: this.gameState.accountId || null
            });

            // Clear active action
            this.gameState.activeAction = null;
            ui.updateChoppingProgress(0);
            ui.showToast('Artillery complete!', 'success');

            // Notify tasks panel
            if (window.tasksPanel) {
                window.tasksPanel.onStructurePlaced('artillery');
            }

            // Resume walk animation if moving
            if (this.gameState.isMoving && this.game.animationAction) {
                this.game.animationAction.play();
            }

            return;
        }

        // Handle crate building completion
        if (actionType === 'build_crate') {
            const crateData = this.gameState.activeAction.crateData;

            // No tool durability loss (crate doesn't require tools)

            // Send server message to place crate
            this.networkManager.sendMessage('place_crate', {
                position: crateData.position,
                rotation: crateData.rotation,
                materialQuality: crateData.materialQuality,
                clientId: this.gameState.clientId,
                accountId: this.gameState.accountId || null
            });

            // Clear active action
            this.gameState.activeAction = null;
            ui.updateChoppingProgress(0);
            ui.showToast('Crate complete!', 'success');

            // Notify tasks panel
            if (window.tasksPanel) {
                window.tasksPanel.onStructurePlaced('crate');
            }

            // Resume walk animation if moving
            if (this.gameState.isMoving && this.game.animationAction) {
                this.game.animationAction.play();
            }

            return;
        }

        // Handle chiseling completion
        if (actionType === 'chiseling') {
            // Delegate to CraftingSystem
            if (this.game.craftingSystem) {
                this.game.craftingSystem.completeChiselingAction(this.gameState.activeAction);
            }
            return;
        }

        // Handle combining completion
        if (actionType === 'combining') {
            // Delegate to CraftingSystem
            if (this.game.craftingSystem) {
                this.game.craftingSystem.completeCombineAction(this.gameState.activeAction);
            }

            // Resume walk animation if moving
            if (this.gameState.isMoving && this.game.animationAction) {
                this.game.animationAction.play();
            }

            return;
        }

        // Handle fishing completion
        if (actionType === 'fishing') {
            // CLEAR activeAction FIRST to prevent double-completion race condition
            // (fishing doesn't need activeAction data, creates fish from scratch)
            this.gameState.activeAction = null;
            ui.updateChoppingProgress(0);

            // Then delegate to ResourceManager
            if (this.game.resourceManager) {
                this.game.resourceManager.completeFishingAction();
            }

            // Resume walk animation if moving
            if (this.gameState.isMoving && this.game.animationAction) {
                this.game.animationAction.play();
            }

            // Update proximity to refresh buttons
            if (this.game.interactionManager) {
                this.game.interactionManager.checkProximityToObjects();
            } else if (typeof this.game.checkProximityToObjects === 'function') {
                this.game.checkProximityToObjects();
            }
            return;
        }

        // Handle vines gathering completion
        if (actionType === 'gather_vines') {
            // CLEAR activeAction FIRST to prevent double-completion race condition
            this.gameState.activeAction = null;
            ui.updateChoppingProgress(0);

            // Then delegate to GrassGathering
            if (this.game.grassGathering) {
                this.game.grassGathering.completeGatheringAction();
            }

            // Resume walk animation if moving
            if (this.gameState.isMoving && this.game.animationAction) {
                this.game.animationAction.play();
            }

            // Update proximity to refresh buttons
            if (this.game.interactionManager) {
                this.game.interactionManager.checkProximityToObjects();
            } else if (typeof this.game.checkProximityToObjects === 'function') {
                this.game.checkProximityToObjects();
            }
            return;
        }

        // Handle vegetables gathering completion
        if (actionType === 'gather_vegetables') {
            // Save the vegetable object BEFORE clearing activeAction
            // (completeGatherVegetablesAction needs the object reference)
            const vegetableObject = this.gameState.activeAction?.object;

            // CLEAR activeAction to prevent double-completion race condition
            this.gameState.activeAction = null;
            ui.updateChoppingProgress(0);

            // Then delegate to GrassGathering (handles vegetables too)
            if (this.game.grassGathering && vegetableObject) {
                this.game.grassGathering.completeGatherVegetablesAction(vegetableObject);
            }

            // Resume walk animation if moving
            if (this.gameState.isMoving && this.game.animationAction) {
                this.game.animationAction.play();
            }

            // Update proximity to refresh buttons
            if (this.game.interactionManager) {
                this.game.interactionManager.checkProximityToObjects();
            } else if (typeof this.game.checkProximityToObjects === 'function') {
                this.game.checkProximityToObjects();
            }
            return;
        }

        // Handle hemp gathering completion
        if (actionType === 'gather_hemp') {
            const hempObject = this.gameState.activeAction?.object;

            this.gameState.activeAction = null;
            ui.updateChoppingProgress(0);

            if (this.game.grassGathering && hempObject) {
                this.game.grassGathering.completeGatherHempAction(hempObject);
            }

            if (this.gameState.isMoving && this.game.animationAction) {
                this.game.animationAction.play();
            }

            if (this.game.interactionManager) {
                this.game.interactionManager.checkProximityToObjects();
            } else if (typeof this.game.checkProximityToObjects === 'function') {
                this.game.checkProximityToObjects();
            }
            return;
        }

        // Handle deer harvesting completion
        if (actionType === 'harvest_deer') {
            const deerCorpse = this.gameState.activeAction?.deerCorpse;

            // CLEAR activeAction to prevent double-completion race condition
            this.gameState.activeAction = null;
            ui.updateChoppingProgress(0);

            // Then delegate to game.completeHarvestDeerAction
            if (this.game.completeHarvestDeerAction && deerCorpse) {
                this.game.completeHarvestDeerAction(deerCorpse);
            }

            // Resume walk animation if moving
            if (this.gameState.isMoving && this.game.animationAction) {
                this.game.animationAction.play();
            }
            return;
        }

        // Handle brownbear harvesting completion
        if (actionType === 'harvest_brownbear') {
            const brownbearCorpse = this.gameState.activeAction?.brownbearCorpse;

            // CLEAR activeAction to prevent double-completion race condition
            this.gameState.activeAction = null;
            ui.updateChoppingProgress(0);

            // Then delegate to game.completeHarvestBrownbearAction
            if (this.game.completeHarvestBrownbearAction && brownbearCorpse) {
                this.game.completeHarvestBrownbearAction(brownbearCorpse);
            }

            // Resume walk animation if moving
            if (this.gameState.isMoving && this.game.animationAction) {
                this.game.animationAction.play();
            }
            return;
        }

        // Check if this is a harvest action (log harvesting)
        if (harvestType) {
            // Delegate to ResourceManager
            if (this.game.resourceManager) {
                this.game.resourceManager.completeHarvestAction(this.gameState.activeAction);
            }
        } else {
            // Standard tree/structure removal
            this.networkManager.sendMessage('remove_object_request', {
                chunkId: `chunk_${object.chunkKey}`,
                objectId: object.id,
                name: object.name,
                position: object.position.toArray(),
                quality: object.quality,
                scale: object.scale,
                objectData: {
                    name: object.name,
                    position: object.position.toArray(),
                    quality: object.quality,
                    scale: object.scale,
                    totalResources: object.totalResources,
                    remainingResources: object.remainingResources
                },
                clientId: this.gameState.clientId,
                accountId: this.gameState.accountId || null
            });

            // Request log spawn for trees - delegate to ResourceManager
            if (this.game.resourceManager) {
                this.game.resourceManager.requestLogSpawn(object);
            }
        }

        // Clear active action
        this.gameState.activeAction = null;
        ui.updateChoppingProgress(0);

        // Update proximity to refresh buttons
        if (this.game.interactionManager) {
            this.game.interactionManager.checkProximityToObjects();
        } else if (typeof this.game.checkProximityToObjects === 'function') {
            this.game.checkProximityToObjects();
        }
    }
}

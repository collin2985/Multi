/**
 * MessageHandlers.js
 * Game-specific message handling logic
 */

const fs = require('fs');
const { CONFIG } = require('./config.js');

class MessageHandlers {
    constructor(chunkManager, messageRouter, clients) {
        this.chunkManager = chunkManager;
        this.messageRouter = messageRouter;
        this.clients = clients;

        // Start garden item spawning (every 10 minutes)
        this.startGardenSpawning();
    }

    /**
     * Handle join_chunk message
     */
    handleJoinChunk(ws, payload) {
        const { chunkId, clientId } = payload;

        if (!clientId) {
            console.error('No clientId provided in join_chunk');
            ws.send(JSON.stringify({ type: 'error', message: 'No clientId provided' }));
            return;
        }

        ws.clientId = clientId;
        this.clients.set(clientId, { ws, currentChunk: chunkId, lastChunk: null });

        this.chunkManager.addPlayerToChunk(chunkId, clientId);
        this.messageRouter.queueProximityUpdate(chunkId);

        // Send chunk_objects_state for proximity grid
        const objectChanges = this.chunkManager.getObjectChangesInProximity(chunkId);
        ws.send(JSON.stringify({
            type: 'chunk_objects_state',
            payload: { chunkId, objectChanges }
        }));
        console.log(`Sent chunk_objects_state for proximity grid around ${chunkId} to ${clientId}`);
    }

    /**
     * Handle chunk_update message
     */
    handleChunkUpdate(payload) {
        const { clientId, newChunkId, lastChunkId } = payload;
        const clientData = this.clients.get(clientId);

        if (!clientData) {
            console.error(`Client ${clientId} not found for chunk_update`);
            return;
        }

        // Update client data
        clientData.currentChunk = newChunkId;
        clientData.lastChunk = lastChunkId;

        // Update chunk data
        if (lastChunkId) {
            this.chunkManager.removePlayerFromChunk(lastChunkId, clientId);
        }

        this.chunkManager.addPlayerToChunk(newChunkId, clientId);

        // Send chunk_objects_state for proximity grid
        const objectChanges = this.chunkManager.getObjectChangesInProximity(newChunkId);
        clientData.ws.send(JSON.stringify({
            type: 'chunk_objects_state',
            payload: { chunkId: newChunkId, objectChanges }
        }));
        console.log(`Sent chunk_objects_state for proximity grid around ${newChunkId} to ${clientId}`);

        // Queue notifications for both chunks
        this.messageRouter.queueProximityUpdate(newChunkId);
        if (lastChunkId) {
            this.messageRouter.queueProximityUpdate(lastChunkId);
        }
        console.log(`Processed chunk_update for ${clientId}: ${lastChunkId || 'none'} -> ${newChunkId}`);
    }

    /**
     * Handle add_object_request message
     */
    handleAddObject(payload) {
        try {
            const { chunkId, objectType, objectPosition, objectQuality, objectScale, objectId, totalResources, remainingResources } = payload;

            const change = {
                action: 'add',
                id: objectId,
                name: objectType,
                position: objectPosition,
                quality: objectQuality,
                scale: objectScale,
                chunkId: chunkId,
                totalResources: totalResources || null,
                remainingResources: remainingResources || null,
                harvestedBy: null,
                harvestStartTime: null
            };

            this.chunkManager.addObjectChange(chunkId, change);

            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'object_added',
                payload: {
                    chunkId,
                    objectId,
                    objectType,
                    position: objectPosition,
                    quality: objectQuality,
                    scale: objectScale,
                    totalResources,
                    remainingResources
                }
            });

            console.log(`Processed add_object_request for ${objectType} (quality: ${objectQuality}, resources: ${remainingResources}/${totalResources}) in chunk ${chunkId}`);
        } catch (error) {
            console.error('ERROR in add_object_request:', error);
        }
    }

    /**
     * Handle place_construction_site message
     */
    handlePlaceConstructionSite(payload) {
        try {
            const { position, rotation, scale, targetStructure, finalFoundationY } = payload;

            // Calculate chunk from position
            const chunkX = Math.floor(position[0] / 16);
            const chunkZ = Math.floor(position[2] / 16);
            const chunkId = `chunk_${chunkX},${chunkZ}`;

            // Handle instant-build ship placement
            if (targetStructure === 'ship') {
                // Validate water placement (terrain height check would go here if needed)
                // For now, trust client validation

                const shipId = `ship_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const shipPosition = [position[0], 1.02, position[2]]; // Water level

                const shipChange = {
                    action: 'add',
                    id: shipId,
                    name: 'ship',
                    position: shipPosition,
                    quality: 50,
                    scale: 1.0,
                    chunkId: chunkId,
                    totalResources: null,
                    remainingResources: null,
                    harvestedBy: null,
                    harvestStartTime: null,
                    rotation: rotation
                };

                this.chunkManager.addObjectChange(chunkId, shipChange);

                this.messageRouter.broadcastTo3x3Grid(chunkId, {
                    type: 'object_added',
                    payload: {
                        chunkId,
                        objectId: shipId,
                        objectType: 'ship',
                        position: shipPosition,
                        quality: 50,
                        scale: 1.0,
                        rotation,
                        totalResources: null,
                        remainingResources: null
                    }
                });

                console.log(`Placed instant-build ship ${shipId} in chunk ${chunkId} at position [${shipPosition}]`);
                return;
            }

            // Generate unique ID for construction site
            const constructionId = `construction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Define required materials
            let requiredMaterials;
            if (targetStructure === 'crate') {
                requiredMaterials = { 'oakplank': 1 };
            } else if (targetStructure === 'garden') {
                requiredMaterials = { 'chiseledlimestone': 1 };
            } else if (targetStructure === 'outpost') {
                requiredMaterials = { 'oakplank': 1 };
            } else if (targetStructure === 'dock') {
                requiredMaterials = { 'oakplank': 1 };
            } else if (targetStructure === 'tent') {
                requiredMaterials = { 'oakplank': 1 };
            } else if (targetStructure === 'house') {
                requiredMaterials = { 'oakplank': 1 };
            } else if (targetStructure === 'market') {
                requiredMaterials = { 'oakplank': 1 };
            } else {
                requiredMaterials = { 'chiseledlimestone': 1 };
            }

            // Determine construction model based on target structure
            // Use mapping from config, default to 'construction' if not specified
            const constructionModel = CONFIG.CONSTRUCTION.CONSTRUCTION_MODELS[targetStructure] || 'construction';

            const constructionChange = {
                action: 'add',
                id: constructionId,
                name: constructionModel,
                position: position,
                quality: null,
                scale: scale,
                chunkId: chunkId,
                totalResources: null,
                remainingResources: null,
                harvestedBy: null,
                harvestStartTime: null,
                isConstructionSite: true,
                targetStructure: targetStructure,
                rotation: rotation,
                requiredMaterials: requiredMaterials,
                materials: {},
                finalFoundationY: finalFoundationY
            };

            this.chunkManager.addObjectChange(chunkId, constructionChange);

            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'object_added',
                payload: {
                    chunkId,
                    objectId: constructionId,
                    objectType: constructionModel,
                    position,
                    quality: null,
                    scale,
                    rotation,
                    totalResources: null,
                    remainingResources: null,
                    isConstructionSite: true,
                    targetStructure,
                    requiredMaterials,
                    materials: {},
                    finalFoundationY
                }
            });

            console.log(`Processed place_construction_site in chunk ${chunkId} at position [${position}], target: ${targetStructure}`);
        } catch (error) {
            console.error('ERROR in place_construction_site:', error);
        }
    }

    /**
     * Handle build_construction message
     */
    handleBuildConstruction(payload) {
        try {
            const { constructionId, chunkKey } = payload;
            const fullChunkId = `chunk_${chunkKey}`;
            const chunkData = this.chunkManager.loadChunk(fullChunkId);

            // Find the construction site
            let constructionSite = null;
            if (Array.isArray(chunkData.objects)) {
                constructionSite = chunkData.objects.find(obj => obj.id === constructionId && obj.isConstructionSite);
            }
            if (!constructionSite && Array.isArray(chunkData.objectChanges)) {
                constructionSite = chunkData.objectChanges.find(c => c.action === 'add' && c.id === constructionId && c.isConstructionSite);
            }

            if (!constructionSite) {
                console.error(`Construction site ${constructionId} not found in chunk ${chunkKey}`);
                return;
            }

            // Calculate structure quality from materials
            const materials = constructionSite.materials || {};
            let totalQuality = 0;
            let materialCount = 0;

            for (const [materialType, data] of Object.entries(materials)) {
                // Materials now stored as {quantity: N, totalQuality: Q}
                if (typeof data === 'object' && data.quantity && data.totalQuality) {
                    totalQuality += data.totalQuality;
                    materialCount += data.quantity;
                } else if (typeof data === 'number') {
                    // Backwards compatibility: old format (just a number)
                    totalQuality += 50 * data;
                    materialCount += data;
                }
            }

            const structureQuality = materialCount > 0 ? Math.round(totalQuality / materialCount) : 50;

            // Remove construction site
            this.chunkManager.addObjectChange(fullChunkId, {
                action: 'remove',
                id: constructionId,
                chunkId: fullChunkId
            });

            // Generate ID for structure
            const structureId = `${constructionSite.targetStructure}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Determine final Y position
            let finalY = constructionSite.finalFoundationY;

            // Determine scale
            let structureScale = 0.5;
            if (constructionSite.targetStructure === 'dock') {
                structureScale = 1.0;
            } else if (constructionSite.targetStructure === 'crate') {
                structureScale = 1.0;
            } else if (constructionSite.targetStructure === 'garden') {
                structureScale = 1.0;
            } else if (constructionSite.targetStructure === 'outpost') {
                structureScale = 1.0;
            } else if (constructionSite.targetStructure === 'tent') {
                structureScale = 0.5;
            } else if (constructionSite.targetStructure === 'house') {
                structureScale = 1.0;
            } else if (constructionSite.targetStructure === 'market') {
                structureScale = 1.0;
            }

            const structurePosition = [constructionSite.position[0], finalY, constructionSite.position[2]];
            const structureChange = {
                action: 'add',
                id: structureId,
                name: constructionSite.targetStructure,
                position: structurePosition,
                quality: structureQuality,
                scale: structureScale,
                chunkId: fullChunkId,
                totalResources: null,
                remainingResources: null,
                harvestedBy: null,
                harvestStartTime: null,
                rotation: constructionSite.rotation,
                finalFoundationY: finalY  // Store for terrain leveling when chunk reloads
            };

            // For houses, gardens, and markets, initialize inventory (like crates)
            if (constructionSite.targetStructure === 'house' ||
                constructionSite.targetStructure === 'garden' ||
                constructionSite.targetStructure === 'market') {

                if (constructionSite.targetStructure === 'market') {
                    // Markets use quantities instead of items grid
                    const defaultQuantity = 0;
                    const defaultQuality = 50;
                    const defaultDurability = 50;

                    structureChange.inventory = {
                        items: [], // Keep for compatibility, but markets won't use this
                        quantities: {
                            limestone: defaultQuantity,
                            sandstone: defaultQuantity,
                            clay: defaultQuantity,
                            oakplank: defaultQuantity,
                            pineplank: defaultQuantity,
                            firplank: defaultQuantity,
                            cypressplank: defaultQuantity,
                            oakfirewood: defaultQuantity,
                            pinefirewood: defaultQuantity,
                            firfirewood: defaultQuantity,
                            cypressfirewood: defaultQuantity,
                            chiseledlimestone: defaultQuantity,
                            chiseledsandstone: defaultQuantity,
                            axe: defaultQuantity,
                            saw: defaultQuantity,
                            pickaxe: defaultQuantity,
                            hammer: defaultQuantity,
                            chisel: defaultQuantity,
                            fishingnet: defaultQuantity,
                            apple: defaultQuantity,
                            vegetables: defaultQuantity,
                            fish: defaultQuantity,
                            cookedfish: defaultQuantity,
                            cookedmeat: defaultQuantity
                        },
                        qualityAverages: {
                            limestone: defaultQuality,
                            sandstone: defaultQuality,
                            clay: defaultQuality,
                            oakplank: defaultQuality,
                            pineplank: defaultQuality,
                            firplank: defaultQuality,
                            cypressplank: defaultQuality,
                            oakfirewood: defaultQuality,
                            pinefirewood: defaultQuality,
                            firfirewood: defaultQuality,
                            cypressfirewood: defaultQuality,
                            chiseledlimestone: defaultQuality,
                            chiseledsandstone: defaultQuality,
                            axe: defaultQuality,
                            saw: defaultQuality,
                            pickaxe: defaultQuality,
                            hammer: defaultQuality,
                            chisel: defaultQuality,
                            fishingnet: defaultQuality,
                            apple: defaultQuality,
                            vegetables: defaultQuality,
                            fish: defaultQuality,
                            cookedfish: defaultQuality,
                            cookedmeat: defaultQuality
                        },
                        durabilityAverages: {
                            axe: defaultDurability,
                            saw: defaultDurability,
                            pickaxe: defaultDurability,
                            hammer: defaultDurability,
                            chisel: defaultDurability,
                            fishingnet: defaultDurability
                        }
                    };
                } else {
                    structureChange.inventory = { items: [] };
                }
            }

            this.chunkManager.addObjectChange(fullChunkId, structureChange);

            // Broadcast removal and addition
            this.messageRouter.broadcastTo3x3Grid(fullChunkId, {
                type: 'object_removed',
                payload: { chunkId: fullChunkId, objectId: constructionId }
            });

            const addedPayload = {
                chunkId: fullChunkId,
                objectId: structureId,
                objectType: constructionSite.targetStructure,
                position: structurePosition,
                quality: structureQuality,
                scale: structureScale,
                rotation: constructionSite.rotation,
                totalResources: null,
                remainingResources: null
            };

            // Include inventory for houses, gardens, and markets
            if (constructionSite.targetStructure === 'house' ||
                constructionSite.targetStructure === 'garden' ||
                constructionSite.targetStructure === 'market') {

                if (constructionSite.targetStructure === 'market') {
                    // Markets use quantities instead of items grid
                    const defaultQuantity = 0;
                    const defaultQuality = 50;
                    const defaultDurability = 50;

                    addedPayload.inventory = {
                        items: [],
                        quantities: {
                            limestone: defaultQuantity,
                            sandstone: defaultQuantity,
                            clay: defaultQuantity,
                            oakplank: defaultQuantity,
                            pineplank: defaultQuantity,
                            firplank: defaultQuantity,
                            cypressplank: defaultQuantity,
                            oakfirewood: defaultQuantity,
                            pinefirewood: defaultQuantity,
                            firfirewood: defaultQuantity,
                            cypressfirewood: defaultQuantity,
                            chiseledlimestone: defaultQuantity,
                            chiseledsandstone: defaultQuantity,
                            axe: defaultQuantity,
                            saw: defaultQuantity,
                            pickaxe: defaultQuantity,
                            hammer: defaultQuantity,
                            chisel: defaultQuantity,
                            fishingnet: defaultQuantity,
                            apple: defaultQuantity,
                            vegetables: defaultQuantity,
                            fish: defaultQuantity,
                            cookedfish: defaultQuantity,
                            cookedmeat: defaultQuantity
                        },
                        qualityAverages: {
                            limestone: defaultQuality,
                            sandstone: defaultQuality,
                            clay: defaultQuality,
                            oakplank: defaultQuality,
                            pineplank: defaultQuality,
                            firplank: defaultQuality,
                            cypressplank: defaultQuality,
                            oakfirewood: defaultQuality,
                            pinefirewood: defaultQuality,
                            firfirewood: defaultQuality,
                            cypressfirewood: defaultQuality,
                            chiseledlimestone: defaultQuality,
                            chiseledsandstone: defaultQuality,
                            axe: defaultQuality,
                            saw: defaultQuality,
                            pickaxe: defaultQuality,
                            hammer: defaultQuality,
                            chisel: defaultQuality,
                            fishingnet: defaultQuality,
                            apple: defaultQuality,
                            vegetables: defaultQuality,
                            fish: defaultQuality,
                            cookedfish: defaultQuality,
                            cookedmeat: defaultQuality
                        },
                        durabilityAverages: {
                            axe: defaultDurability,
                            saw: defaultDurability,
                            pickaxe: defaultDurability,
                            hammer: defaultDurability,
                            chisel: defaultDurability,
                            fishingnet: defaultDurability
                        }
                    };
                } else {
                    addedPayload.inventory = { items: [] };
                }
            }

            this.messageRouter.broadcastTo3x3Grid(fullChunkId, {
                type: 'object_added',
                payload: addedPayload
            });

            console.log(`Processed build_construction: removed ${constructionId}, added ${structureId} (${constructionSite.targetStructure}) in chunk ${fullChunkId}`);
        } catch (error) {
            console.error('ERROR in build_construction:', error);
        }
    }

    /**
     * Handle update_construction_materials message
     * Updates the materials and quality tracking for a construction site
     */
    handleUpdateConstructionMaterials(payload) {
        try {
            const { constructionId, chunkKey, materials } = payload;
            const fullChunkId = `chunk_${chunkKey}`;
            const chunkData = this.chunkManager.loadChunk(fullChunkId);

            // Find the construction site
            let constructionSite = null;
            if (Array.isArray(chunkData.objects)) {
                constructionSite = chunkData.objects.find(obj => obj.id === constructionId && obj.isConstructionSite);
            }
            if (!constructionSite && Array.isArray(chunkData.objectChanges)) {
                constructionSite = chunkData.objectChanges.find(c => c.action === 'add' && c.id === constructionId && c.isConstructionSite);
            }

            if (!constructionSite) {
                console.error(`Construction site ${constructionId} not found in chunk ${chunkKey}`);
                return;
            }

            // Update materials with quality tracking
            constructionSite.materials = materials;

            // Save to disk
            this.chunkManager.saveChunk(fullChunkId);

            console.log(`Updated construction materials for ${constructionId}:`, materials);
        } catch (error) {
            console.error('ERROR in update_construction_materials:', error);
        }
    }

    /**
     * Handle get_crate_inventory message (also handles houses)
     */
    handleGetCrateInventory(ws, payload) {
        try {
            const { crateId, chunkId } = payload;
            const crateChange = this.chunkManager.findObjectChange(chunkId, crateId);

            let crateInventory = { items: [] };
            if (crateChange && crateChange.inventory) {
                crateInventory = crateChange.inventory;
            }

            ws.send(JSON.stringify({
                type: 'crate_inventory_response',
                payload: { crateId, inventory: crateInventory }
            }));

            // Log with appropriate structure type
            const structureType = crateChange?.name || 'storage';
            console.log(`Sent ${structureType} inventory for ${crateId}: ${crateInventory.items.length} items`);
        } catch (error) {
            console.error('ERROR in get_crate_inventory:', error);
        }
    }

    /**
     * Handle save_crate_inventory message (also handles houses)
     */
    handleSaveCrateInventory(payload) {
        try {
            const { crateId, chunkId, inventory } = payload;
            const chunkData = this.chunkManager.loadChunk(chunkId);

            const crateIndex = chunkData.objectChanges.findIndex(c => c.id === crateId && c.action === 'add');

            if (crateIndex !== -1) {
                const structure = chunkData.objectChanges[crateIndex];
                structure.inventory = inventory;
                this.chunkManager.saveChunk(chunkId);

                // Log with appropriate structure type
                const structureType = structure.name || 'storage';
                console.log(`Saved ${structureType} inventory for ${crateId}: ${inventory.items.length} items`);

                this.messageRouter.broadcastTo3x3Grid(chunkId, {
                    type: 'crate_inventory_updated',
                    payload: { crateId, inventory }
                });
            } else {
                console.error(`Storage structure ${crateId} not found in chunk ${chunkId}`);
            }
        } catch (error) {
            console.error('ERROR in save_crate_inventory:', error);
        }
    }

    /**
     * Handle buy_item message - player purchases items from market
     */
    handleBuyItem(ws, payload) {
        try {
            const { marketId, chunkId, itemType, quantity } = payload;

            // Find market
            const marketChange = this.chunkManager.findObjectChange(chunkId, marketId);
            if (!marketChange || !marketChange.inventory) {
                console.error(`Market ${marketId} not found or has no inventory`);
                return;
            }

            const inventory = marketChange.inventory;
            const currentQuantity = inventory.quantities[itemType] || 0;

            // Validate quantity
            if (quantity > currentQuantity) {
                console.error(`Not enough ${itemType} in market. Requested: ${quantity}, Available: ${currentQuantity}`);
                return;
            }

            // Decrease quantity
            inventory.quantities[itemType] = currentQuantity - quantity;

            // Save to disk
            this.chunkManager.saveChunk(chunkId);

            console.log(`Player bought ${quantity}x ${itemType} from market ${marketId}. New quantity: ${inventory.quantities[itemType]}`);

            // Broadcast updated inventory to all players near the market
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'market_inventory_updated',
                payload: {
                    marketId,
                    quantities: inventory.quantities,
                    qualityAverages: inventory.qualityAverages,
                    durabilityAverages: inventory.durabilityAverages
                }
            });
        } catch (error) {
            console.error('ERROR in buy_item:', error);
        }
    }

    /**
     * Handle sell_item message - player sells item to market
     */
    handleSellItem(ws, payload) {
        try {
            const { marketId, chunkId, itemType, quality, durability } = payload;

            // Find market
            const marketChange = this.chunkManager.findObjectChange(chunkId, marketId);
            if (!marketChange || !marketChange.inventory) {
                console.error(`Market ${marketId} not found or has no inventory`);
                return;
            }

            const inventory = marketChange.inventory;
            const currentQuantity = inventory.quantities[itemType] || 0;
            const currentQualityAvg = inventory.qualityAverages[itemType] || 50;

            // Calculate new averages
            // Formula: newAvg = (oldAvg * oldQty + newValue) / newQty
            const newQuantity = currentQuantity + 1;
            const newQualityAvg = (currentQualityAvg * currentQuantity + quality) / newQuantity;

            // Update quantities and quality average
            inventory.quantities[itemType] = newQuantity;
            inventory.qualityAverages[itemType] = newQualityAvg;

            // If tool, update durability average (with floor at 30)
            if (durability !== null && durability !== undefined) {
                const currentDurabilityAvg = inventory.durabilityAverages[itemType] || 50;
                const newDurabilityAvg = (currentDurabilityAvg * currentQuantity + durability) / newQuantity;
                // Floor the average at 30
                inventory.durabilityAverages[itemType] = Math.max(30, newDurabilityAvg);
            }

            // Save to disk
            this.chunkManager.saveChunk(chunkId);

            console.log(`Player sold ${itemType} (Q:${quality}${durability ? ` D:${durability}` : ''}) to market ${marketId}. New quantity: ${newQuantity}, New quality avg: ${newQualityAvg.toFixed(1)}`);

            // Broadcast updated inventory to all players near the market
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'market_inventory_updated',
                payload: {
                    marketId,
                    quantities: inventory.quantities,
                    qualityAverages: inventory.qualityAverages,
                    durabilityAverages: inventory.durabilityAverages
                }
            });
        } catch (error) {
            console.error('ERROR in sell_item:', error);
        }
    }

    /**
     * Handle remove_object_request message (includes cascade deletion logic)
     */
    handleRemoveObject(payload) {
        const { chunkId, objectId, name, position, quality, scale, objectData } = payload;
        const chunkData = this.chunkManager.loadChunk(chunkId);

        // Check if this object exists with ANY action (add or remove)
        let objectIndex = chunkData.objectChanges.findIndex(c => c.id === objectId);

        // If not found and objectData provided, this is a natural object on first interaction
        if (objectIndex === -1 && objectData) {
            console.log(`Natural object ${objectId} first interaction - creating change entry before removal`);

            const changeEntry = {
                action: 'add',
                id: objectId,
                name: objectData.name,
                position: objectData.position,
                quality: objectData.quality,
                scale: objectData.scale,
                totalResources: objectData.totalResources,
                remainingResources: objectData.remainingResources,
                chunkId: chunkId,
                harvestedBy: null,
                harvestStartTime: null
            };

            chunkData.objectChanges.push(changeEntry);
            this.chunkManager.saveChunk(chunkId);
            objectIndex = chunkData.objectChanges.length - 1;
        }

        // Now add the remove change
        const change = { action: 'remove', id: objectId, name, position, quality, scale, chunkId };
        this.chunkManager.addObjectChange(chunkId, change);

        this.messageRouter.broadcastTo3x3Grid(chunkId, {
            type: 'object_removed',
            payload: { chunkId, objectId, name, position, quality, scale }
        });

        console.log(`Processed remove_object_request for ${objectId} (quality: ${quality}, scale: ${scale}) in chunk ${chunkId}`);
    }

    /**
     * Handle harvest_resource_request message
     */
    handleHarvestResource(payload) {
        try {
            const { chunkId, objectId, harvestType, clientId, objectData } = payload;
            const chunkData = this.chunkManager.loadChunk(chunkId);

            // First, check if this resource exists with ANY action (add or remove)
            let resourceIndex = chunkData.objectChanges.findIndex(c => c.id === objectId);

            // If found with action='remove', it's already depleted - reject the request
            if (resourceIndex !== -1 && chunkData.objectChanges[resourceIndex].action === 'remove') {
                console.warn(`Resource ${objectId} already depleted, rejecting harvest request`);
                this.messageRouter.sendToClient(clientId, {
                    type: 'harvest_lock_failed',
                    payload: {
                        objectId,
                        reason: 'This resource has already been depleted'
                    }
                });
                return;
            }

            // Create change entry for natural resources on first interaction
            if (resourceIndex === -1) {
                console.log(`Natural resource ${objectId} first interaction - creating change entry`);

                const changeEntry = {
                    action: 'add',
                    id: objectId,
                    name: objectData.name,
                    position: objectData.position,
                    quality: objectData.quality,
                    scale: objectData.scale,
                    totalResources: objectData.totalResources,
                    remainingResources: objectData.remainingResources,
                    chunkId: chunkId,
                    harvestedBy: null,
                    harvestStartTime: null
                };

                chunkData.objectChanges.push(changeEntry);
                resourceIndex = chunkData.objectChanges.length - 1;
            }

            const resource = chunkData.objectChanges[resourceIndex];
            const now = Date.now();

            // Check if resource is locked by another player
            if (resource.harvestedBy && resource.harvestedBy !== clientId) {
                const lockAge = now - (resource.harvestStartTime || 0);
                if (lockAge < 15000) {
                    // Still locked
                    this.messageRouter.sendToClient(clientId, {
                        type: 'harvest_lock_failed',
                        payload: {
                            objectId,
                            reason: 'Another player is harvesting this resource'
                        }
                    });
                    console.log(`Harvest lock failed for ${objectId}: locked by ${resource.harvestedBy}`);
                    return;
                } else {
                    // Lock timed out
                    console.log(`Lock timeout for ${objectId}, clearing stale lock`);
                    resource.harvestedBy = null;
                    resource.harvestStartTime = null;
                }
            }

            // Acquire lock
            resource.harvestedBy = clientId;
            resource.harvestStartTime = now;

            // Decrement resources
            if (resource.remainingResources > 0) {
                resource.remainingResources -= 1;

                if (resource.remainingResources <= 0) {
                    resource.action = 'remove';
                    resource.harvestedBy = null;
                    resource.harvestStartTime = null;
                } else {
                    resource.harvestedBy = null;
                    resource.harvestStartTime = null;
                }

                this.chunkManager.saveChunk(chunkId);

                this.messageRouter.broadcastTo3x3Grid(chunkId, {
                    type: 'resource_harvested',
                    payload: {
                        chunkId,
                        objectId,
                        harvestType,
                        remainingResources: resource.remainingResources,
                        depleted: resource.remainingResources <= 0,
                        harvestedBy: clientId
                    }
                });

                console.log(`Processed harvest_resource_request: ${objectId} (${harvestType}), remaining: ${resource.remainingResources}`);
            } else {
                console.warn(`Resource ${objectId} already depleted`);
            }
        } catch (error) {
            console.error('ERROR in harvest_resource_request:', error);
        }
    }

    /**
     * Handle WebRTC signaling messages (offer, answer, ice_candidate)
     */
    handleWebRTCSignaling(messageType, rawMessage, payload) {
        const recipientId = payload.recipientId;
        const senderId = payload.senderId;

        if (this.messageRouter.forwardMessage(senderId, recipientId, rawMessage)) {
            console.log(`Forwarded ${messageType} from ${senderId} to ${recipientId}`);
        } else {
            console.error(`Recipient ${recipientId} not found`);
        }
    }

    /**
     * Start garden item spawning interval
     */
    startGardenSpawning() {
        const SPAWN_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds

        setInterval(() => {
            this.spawnGardenItems();
        }, SPAWN_INTERVAL);

        console.log('Garden item spawning started (every 5 minutes)');
    }

    /**
     * Spawn items in all gardens across loaded chunks
     */
    spawnGardenItems() {
        try {
            console.log('Running garden spawn cycle...');
            let gardensProcessed = 0;
            let itemsSpawned = 0;

            // Get all loaded chunks
            const loadedChunks = this.chunkManager.getCachedChunkIds();

            for (const chunkId of loadedChunks) {
                const chunkData = this.chunkManager.loadChunk(chunkId);

                // Find all garden structures in this chunk
                if (Array.isArray(chunkData.objectChanges)) {
                    for (const change of chunkData.objectChanges) {
                        if (change.action === 'add' && change.name === 'garden') {
                            gardensProcessed++;
                            const spawned = this.spawnItemsInGarden(change, chunkId);
                            if (spawned) itemsSpawned++;
                        }
                    }
                }
            }

            console.log(`Garden spawn cycle complete: ${gardensProcessed} gardens processed, ${itemsSpawned} items spawned`);
        } catch (error) {
            console.error('ERROR in spawnGardenItems:', error);
        }
    }

    /**
     * Spawn a random food item in a specific garden
     */
    spawnItemsInGarden(gardenStructure, chunkId) {
        try {
            // Initialize inventory if needed
            if (!gardenStructure.inventory) {
                gardenStructure.inventory = { items: [] };
            }

            const inventory = gardenStructure.inventory;

            // Garden has 2x2 grid = 4 slots max
            // Only spawn if there's space
            if (inventory.items.length >= 4) {
                return false; // Garden is full
            }

            // Random food item (apple or vegetables)
            const foodTypes = ['apple', 'vegetables'];
            const randomFood = foodTypes[Math.floor(Math.random() * foodTypes.length)];

            // Generate unique ID
            const itemId = `${randomFood}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Find a free position in the 2x2 grid
            let freePosition = null;
            for (let y = 0; y < 2 && !freePosition; y++) {
                for (let x = 0; x < 2 && !freePosition; x++) {
                    const testItem = { x, y, width: 1, height: 1 };
                    if (this.isPositionFreeInGarden(testItem, inventory.items)) {
                        freePosition = { x, y };
                    }
                }
            }

            // If no free position, garden is full
            if (!freePosition) {
                return false;
            }

            // Create new item with garden's quality and calculated durability
            const baseDurability = randomFood === 'apple' ? 10 : 20;
            const itemQuality = gardenStructure.quality || 50;
            const newItem = {
                id: itemId,
                type: randomFood,
                x: freePosition.x,
                y: freePosition.y,
                width: 1,
                height: 1,
                rotation: 0,
                quality: itemQuality, // Use garden's quality
                durability: Math.round(baseDurability * (itemQuality / 100)) // Scale durability by quality
            };

            // Add item to inventory
            inventory.items.push(newItem);

            // Save chunk
            this.chunkManager.saveChunk(chunkId);

            // Broadcast to nearby players
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'garden_item_spawned',
                payload: {
                    gardenId: gardenStructure.id,
                    item: newItem,
                    chunkId: chunkId
                }
            });

            console.log(`Spawned ${randomFood} (Q:${newItem.quality}) in garden ${gardenStructure.id} at position (${freePosition.x},${freePosition.y})`);
            return true;
        } catch (error) {
            console.error('ERROR in spawnItemsInGarden:', error);
            return false;
        }
    }

    /**
     * Check if a position is free in the garden's inventory grid
     */
    isPositionFreeInGarden(newItem, existingItems) {
        for (const item of existingItems) {
            // Check for overlap
            const xOverlap = newItem.x < item.x + item.width && newItem.x + newItem.width > item.x;
            const yOverlap = newItem.y < item.y + item.height && newItem.y + newItem.height > item.y;

            if (xOverlap && yOverlap) {
                return false; // Position is occupied
            }
        }
        return true; // Position is free
    }
}

module.exports = MessageHandlers;

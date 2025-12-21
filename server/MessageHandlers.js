/**
 * MessageHandlers.js
 * Game-specific message handling logic
 */

const fs = require('fs');
const { CONFIG } = require('./ServerConfig.js');
const ChunkCoordinates = require('./ServerChunkCoords.js');
const TimeTrackerService = require('./TimeTrackerService.js');
const { clampQuality, enrichStructureWithDurability } = require('./StructureDecayUtils.js');
const { generateBanditTentLoot, generateBanditCampfireLoot } = require('./BanditLootGenerator.js');
const SpawnTasks = require('./SpawnTasks.js');

class MessageHandlers {
    constructor(chunkManager, messageRouter, clients, cookingSystem = null, tileworksSystem = null) {
        this.chunkManager = chunkManager;
        this.messageRouter = messageRouter;
        this.clients = clients;
        this.cookingSystem = cookingSystem;
        this.tileworksSystem = tileworksSystem;

        // Initialize spawn tasks system
        this.spawnTasks = new SpawnTasks(chunkManager, messageRouter);

        // Track claimed mobile entities per client for disconnect cleanup
        // Map<clientId, Array<{entityId, entityType, chunkId}>>
        this.clientMobileEntities = new Map();

        // Track crates currently loaded on carts (server-side occupied tracking)
        // Map<entityId, { clientId, claimedAt, chunkId }>
        this.loadedCrates = new Map();

        // Create centralized time tracking service
        this.timeTracker = new TimeTrackerService();

        // Register 1-minute handlers
        // NOTE: Firewood, cooking, tileworks processing, tree growth, structure decay, and ship spawning
        // have all been moved to client-side tick-based calculation
        // (see CrateInventoryUI, EffectManager, MessageRouter, ScheduledShipSystem for client-side implementation)
        this.timeTracker.registerMinuteHandler('playerCleanup', () => this.cleanupStalePlayers());

        // Start the time tracker
        this.timeTracker.start();
    }

    /**
     * Enrich a structure object with owner's display name
     * @param {object} obj - Structure object with potential owner field
     * @returns {Promise<object>} - Object with ownerName added if owner exists
     */
    async enrichWithOwnerName(obj) {
        if (obj.owner && this.authManager) {
            const ownerName = await this.authManager.getUsernameById(obj.owner);
            if (ownerName) {
                return { ...obj, ownerName };
            }
        }
        return obj;
    }

    /**
     * Handle join_chunk message
     */
    async handleJoinChunk(ws, payload) {
        const { chunkId, clientId, accountId } = payload;  // Now accepts accountId

        if (!clientId) {
            console.error('No clientId provided in join_chunk');
            ws.send(JSON.stringify({ type: 'error', message: 'No clientId provided' }));
            return;
        }

        ws.clientId = clientId;
        ws.accountId = accountId || null;  // Track account ID if provided
        this.clients.set(clientId, {
            ws,
            currentChunk: chunkId,
            lastChunk: null,
            accountId: accountId || null  // Store for persistence
        });

        await this.chunkManager.addPlayerToChunk(chunkId, clientId);
        this.messageRouter.queueProximityUpdate(chunkId);

        // If accountId provided, load saved player data
        if (accountId && this.authManager) {
            const playerData = await this.authManager.loadPlayerData(accountId);
            if (playerData) {
                ws.send(JSON.stringify({
                    type: 'player_data_loaded',
                    payload: playerData
                }));
            }
        }

        // Send chunk_objects_state for proximity grid
        // Use parallel loading for initial spawn (player is behind loading screen)
        const objectChanges = await this.chunkManager.getObjectChangesInProximity(chunkId, true);

        // Enrich structures with calculated durability values and owner names
        const enrichedObjectChanges = await Promise.all(objectChanges.map(async obj => {
            // Only enrich actual structures (not natural objects like trees/rocks)
            const isStructure = obj.name && (
                obj.name === 'house' || obj.name === 'crate' || obj.name === 'tent' ||
                obj.name === 'outpost' || obj.name === 'ship' || obj.name === 'campfire' ||
                obj.name === 'garden' || obj.name === 'market' || obj.name === 'dock' ||
                obj.name.includes('construction') || obj.isConstructionSite
            );

            if (isStructure && obj.action === 'add') {
                let enriched = enrichStructureWithDurability(obj);
                enriched = await this.enrichWithOwnerName(enriched);
                return enriched;
            }
            return obj;
        }));

        ws.send(JSON.stringify({
            type: 'chunk_objects_state',
            payload: { chunkId, objectChanges: enrichedObjectChanges, serverTick: this.serverTick || 0 }
        }));
    }

    /**
     * Handle chunk_update message
     */
    async handleChunkUpdate(payload) {
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
        const objectChanges = await this.chunkManager.getObjectChangesInProximity(newChunkId);

        // Enrich structures with calculated durability values and owner names
        const enrichedObjectChanges = await Promise.all(objectChanges.map(async obj => {
            // Only enrich actual structures (not natural objects like trees/rocks)
            const isStructure = obj.name && (
                obj.name === 'house' || obj.name === 'crate' || obj.name === 'tent' ||
                obj.name === 'outpost' || obj.name === 'ship' || obj.name === 'campfire' ||
                obj.name === 'garden' || obj.name === 'market' || obj.name === 'dock' ||
                obj.name.includes('construction') || obj.isConstructionSite
            );

            if (isStructure && obj.action === 'add') {
                let enriched = enrichStructureWithDurability(obj);
                enriched = await this.enrichWithOwnerName(enriched);
                return enriched;
            }
            return obj;
        }));

        clientData.ws.send(JSON.stringify({
            type: 'chunk_objects_state',
            payload: { chunkId: newChunkId, objectChanges: enrichedObjectChanges, serverTick: this.serverTick || 0 }
        }));

        // Queue notifications for both chunks
        this.messageRouter.queueProximityUpdate(newChunkId);
        if (lastChunkId) {
            this.messageRouter.queueProximityUpdate(lastChunkId);
        }
    }

    /**
     * Handle add_object_request message
     */
    async handleAddObject(payload) {
        try {
            const { chunkId, objectType, objectPosition, objectQuality, objectScale, objectId, objectRotation, totalResources, remainingResources } = payload;

            const change = {
                action: 'add',
                id: objectId,
                name: objectType,
                position: objectPosition,
                quality: objectQuality,
                scale: objectScale,
                rotation: objectRotation, // Include rotation (in degrees)
                chunkId: chunkId,
                totalResources: totalResources || null,
                remainingResources: remainingResources || null,
                harvestedBy: null,
                harvestStartTime: null
            };

            await this.chunkManager.addObjectChange(chunkId, change);

            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'object_added',
                payload: {
                    chunkId,
                    objectId,
                    objectType,
                    position: objectPosition,
                    quality: objectQuality,
                    scale: objectScale,
                    rotation: objectRotation, // Include rotation (in degrees)
                    totalResources,
                    remainingResources
                }
            });
        } catch (error) {
            console.error('ERROR in add_object_request:', error);
        }
    }

    /**
     * Handle place_construction_site message
     */
    async handlePlaceConstructionSite(payload) {
        try {
            const { position, rotation, scale, targetStructure, finalFoundationY, clientId, accountId } = payload;
            // Use accountId for persistent ownership if available, otherwise fall back to clientId
            const ownerId = accountId || clientId;

            // Calculate chunk from position using unified CENTER-BASED system
            const chunkId = ChunkCoordinates.worldToChunkId(position[0], position[2]);

            // Handle instant-build ship placement
            if (targetStructure === 'ship') {
                // Validate water placement (terrain height check would go here if needed)
                // For now, trust client validation

                const shipId = `ship_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const shipPosition = [position[0], 0, position[2]]; // Water level

                const shipChange = {
                    action: 'add',
                    id: shipId,
                    name: 'ship',
                    position: shipPosition,
                    quality: 50,
                    lastRepairTime: Date.now(),  // Track when structure was created
                    scale: 1.0,
                    chunkId: chunkId,
                    totalResources: null,
                    remainingResources: null,
                    harvestedBy: null,
                    harvestStartTime: null,
                    rotation: rotation,
                    owner: ownerId  // Track who built the ship (accountId for persistence)
                };

                await this.chunkManager.addObjectChange(chunkId, shipChange);

                // Calculate durability values for broadcast
                const shipDurabilityInfo = enrichStructureWithDurability(shipChange);

                // Look up owner name for display
                const shipOwnerName = ownerId && this.authManager ? await this.authManager.getUsernameById(ownerId) : null;

                this.messageRouter.broadcastTo3x3Grid(chunkId, {
                    type: 'object_added',
                    payload: {
                        chunkId,
                        objectId: shipId,
                        objectType: 'ship',
                        position: shipPosition,
                        quality: 50,
                        currentDurability: shipDurabilityInfo.currentDurability,
                        hoursUntilRuin: shipDurabilityInfo.hoursUntilRuin,
                        scale: 1.0,
                        rotation,
                        totalResources: null,
                        remainingResources: null,
                        owner: ownerId,
                        ownerName: shipOwnerName
                    }
                });
                return;
            }

            // Generate unique ID for construction site
            const constructionId = `construction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Define required materials
            let requiredMaterials;
            if (targetStructure === 'crate') {
                requiredMaterials = { 'oakplank': 1 };
            } else if (targetStructure === 'garden') {
                requiredMaterials = { 'chiseledlimestone': 1, 'vegetableseeds': 1, 'appleseed': 1 };
            } else if (targetStructure === 'outpost') {
                requiredMaterials = { 'oakplank': 1 };
            } else if (targetStructure === 'dock') {
                requiredMaterials = { 'oakplank': 1 };
            // NOTE: Tent removed - now uses instant build via handlePlaceTent()
            // } else if (targetStructure === 'tent') {
            //     requiredMaterials = { 'oakplank': 1 };
            } else if (targetStructure === 'house') {
                requiredMaterials = { 'oakplank': 1, 'chiseledlimestone': 1, 'tile': 1 };
            } else if (targetStructure === 'campfire') {
                requiredMaterials = { 'limestone': 1 };
            } else if (targetStructure === 'market') {
                requiredMaterials = { 'oakplank': 1, 'chiseledlimestone': 1, 'tile': 1 };
            } else if (targetStructure === 'tileworks') {
                requiredMaterials = { 'oakplank': 1, 'chiseledlimestone': 1, 'tile': 1 };
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
                quality: 50,  // Default quality for construction sites
                lastRepairTime: Date.now(),  // Track when construction site was placed (1-hour lifespan)
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
                finalFoundationY: finalFoundationY,
                owner: ownerId  // Track who placed the construction site (accountId for persistence)
            };

            await this.chunkManager.addObjectChange(chunkId, constructionChange);

            // Calculate durability values for broadcast (construction sites have 1-hour lifespan)
            const constructionDurabilityInfo = enrichStructureWithDurability(constructionChange);

            // Look up owner name for display
            const ownerName = ownerId && this.authManager ? await this.authManager.getUsernameById(ownerId) : null;

            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'object_added',
                payload: {
                    chunkId,
                    objectId: constructionId,
                    objectType: constructionModel,
                    position,
                    quality: 50,
                    currentDurability: constructionDurabilityInfo.currentDurability,
                    hoursUntilRuin: constructionDurabilityInfo.hoursUntilRuin,
                    scale,
                    rotation,
                    totalResources: null,
                    remainingResources: null,
                    isConstructionSite: true,
                    targetStructure,
                    requiredMaterials,
                    materials: {},
                    finalFoundationY,
                    owner: ownerId,
                    ownerName: ownerName
                }
            });
        } catch (error) {
            console.error('ERROR in place_construction_site:', error);
        }
    }

    /**
     * Handle place_road message
     */
    async handlePlaceRoad(payload) {
        try {
            const { position, rotation, materialType } = payload;

            // Calculate chunk from position using unified CENTER-BASED system
            const chunkId = ChunkCoordinates.worldToChunkId(position[0], position[2]);

            // Generate unique ID for road
            const roadId = `road_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Create road change object (stores terrain modification data)
            const roadChange = {
                action: 'add',
                id: roadId,
                name: 'road',  // Type identifier
                position: position,
                rotation: rotation || 0,
                chunkId: chunkId,
                isRoad: true,  // Flag to identify roads for terrain blending
                materialType: materialType || 'limestone'  // sandstone or limestone for visual tint
            };

            // Save to chunk file
            await this.chunkManager.addObjectChange(chunkId, roadChange);

            // Broadcast to all clients in 3x3 grid
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'road_placed',
                payload: {
                    chunkId,
                    roadId,
                    position,
                    rotation: rotation || 0,
                    materialType: materialType || 'limestone'
                }
            });
        } catch (error) {
            console.error('ERROR in place_road:', error);
        }
    }

    /**
     * Handle place_boat message
     * Creates instant-build boat structure in water
     */
    async handlePlaceBoat(payload) {
        try {
            const { position, rotation, materialQuality, clientId, accountId } = payload;

            // Calculate chunk from position
            const chunkId = ChunkCoordinates.worldToChunkId(position[0], position[2]);

            // Generate unique ID
            const boatId = `boat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Use accountId for persistent ownership if available
            const ownerId = accountId || clientId;

            // Calculate quality from material
            let quality = materialQuality || 50;
            const qualityCap = CONFIG.CONSTRUCTION.STRUCTURE_QUALITY_CAPS?.['boat'];
            if (qualityCap !== undefined) {
                quality = Math.min(quality, qualityCap);
            }

            // Create boat structure object
            const boatChange = {
                action: 'add',
                id: boatId,
                name: 'boat',
                position: position,
                rotation: rotation || 0,
                scale: 1.0,
                quality: quality,
                lastRepairTime: Date.now(),
                chunkId: chunkId,
                owner: ownerId
            };

            // Save to chunk file
            await this.chunkManager.addObjectChange(chunkId, boatChange);

            // Calculate durability values
            const boatDurabilityInfo = enrichStructureWithDurability(boatChange);

            // Look up owner name
            const ownerName = ownerId && this.authManager ?
                await this.authManager.getUsernameById(ownerId) : null;

            // Broadcast to clients
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'object_added',
                payload: {
                    chunkId: chunkId,
                    objectId: boatId,
                    objectType: 'boat',
                    position: position,
                    rotation: rotation || 0,
                    scale: 1.0,
                    quality: quality,
                    currentDurability: boatDurabilityInfo.currentDurability,
                    hoursUntilRuin: boatDurabilityInfo.hoursUntilRuin,
                    owner: ownerId,
                    ownerName: ownerName
                }
            });

            console.log(`[Boat] Placed boat ${boatId} at chunk ${chunkId}`);
        } catch (error) {
            console.error('ERROR in place_boat:', error);
        }
    }

    /**
     * Handle place_horse message (debug/testing)
     * Places a horse at the specified position
     */
    async handlePlaceHorse(payload) {
        console.log('[Horse Debug] Server received place_horse:', payload);
        try {
            const { position, rotation, materialQuality, clientId, accountId, isBanditStructure, objectId } = payload;

            // Calculate chunk from position
            const chunkId = ChunkCoordinates.worldToChunkId(position[0], position[2]);
            const horseId = objectId || `horse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            // Bandit horses have no owner (can be stolen by anyone)
            const ownerId = isBanditStructure ? null : (accountId || clientId);

            // Calculate quality
            let quality = materialQuality || 50;
            const qualityCap = CONFIG.CONSTRUCTION.STRUCTURE_QUALITY_CAPS?.['horse'];
            if (qualityCap !== undefined) {
                quality = Math.min(quality, qualityCap);
            }

            // Create horse structure object
            const horseChange = {
                action: 'add',
                id: horseId,
                name: 'horse',
                position: position,
                rotation: rotation || 0,
                scale: 1.0,
                quality: quality,
                lastRepairTime: Date.now(),
                chunkId: chunkId,
                owner: ownerId,
                isBanditStructure: isBanditStructure || false
            };

            // Save to chunk file
            await this.chunkManager.addObjectChange(chunkId, horseChange);

            // Calculate durability values
            const horseDurabilityInfo = enrichStructureWithDurability(horseChange);

            // Look up owner name
            const ownerName = ownerId && this.authManager ?
                await this.authManager.getUsernameById(ownerId) : null;

            // Broadcast to clients
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'object_added',
                payload: {
                    chunkId: chunkId,
                    objectId: horseId,
                    objectType: 'horse',
                    position: position,
                    rotation: rotation || 0,
                    scale: 1.0,
                    quality: quality,
                    currentDurability: horseDurabilityInfo.currentDurability,
                    hoursUntilRuin: horseDurabilityInfo.hoursUntilRuin,
                    owner: ownerId,
                    ownerName: ownerName,
                    isBanditStructure: isBanditStructure || false
                }
            });

            console.log(`[Horse] Placed horse ${horseId} at chunk ${chunkId}`);
        } catch (error) {
            console.error('ERROR in place_horse:', error);
        }
    }

    /**
     * Handle place_cart message
     * Creates a cart structure that can be towed by players
     */
    async handlePlaceCart(payload) {
        try {
            const { position, rotation, materialQuality, clientId, accountId } = payload;

            // Calculate chunk from position
            const chunkId = ChunkCoordinates.worldToChunkId(position[0], position[2]);
            const cartId = `cart_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const ownerId = accountId || clientId;

            // Calculate quality with cap
            let quality = materialQuality || 50;
            const qualityCap = CONFIG.CONSTRUCTION.STRUCTURE_QUALITY_CAPS?.['cart'];
            if (qualityCap !== undefined) {
                quality = Math.min(quality, qualityCap);
            }

            // Create cart structure object (no inventory - carts are pure transport)
            const cartChange = {
                action: 'add',
                id: cartId,
                name: 'cart',
                position: position,
                rotation: rotation || 0,
                scale: 1.0,
                quality: quality,
                lastRepairTime: Date.now(),
                chunkId: chunkId,
                owner: ownerId
            };

            // Save to chunk file
            await this.chunkManager.addObjectChange(chunkId, cartChange);

            // Calculate durability values
            const cartDurabilityInfo = enrichStructureWithDurability(cartChange);

            // Look up owner name
            const ownerName = ownerId && this.authManager ?
                await this.authManager.getUsernameById(ownerId) : null;

            // Broadcast to clients
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'object_added',
                payload: {
                    chunkId: chunkId,
                    objectId: cartId,
                    objectType: 'cart',
                    position: position,
                    rotation: rotation || 0,
                    scale: 1.0,
                    quality: quality,
                    currentDurability: cartDurabilityInfo.currentDurability,
                    hoursUntilRuin: cartDurabilityInfo.hoursUntilRuin,
                    owner: ownerId,
                    ownerName: ownerName
                }
            });

            console.log(`[Cart] Placed cart ${cartId} at chunk ${chunkId}`);
        } catch (error) {
            console.error('ERROR in place_cart:', error);
        }
    }

    /**
     * Handle claim_cart message
     * Temporarily removes a cart from chunk when player attaches to it
     * Delegates to generic mobile entity handler
     */
    async handleClaimCart(ws, payload) {
        // Cart uses generic mobile entity system
        const mobilePayload = {
            entityId: payload.entityId,
            entityType: 'cart',
            chunkKey: payload.chunkKey,
            clientId: payload.clientId
        };
        await this.handleClaimMobileEntity(ws, mobilePayload);
    }

    /**
     * Handle release_cart message
     * Adds cart back to chunk at new position when player detaches
     * Delegates to generic mobile entity handler
     */
    async handleReleaseCart(ws, payload) {
        // Cart uses generic mobile entity system
        const mobilePayload = {
            entityId: payload.entityId,
            entityType: 'cart',
            chunkKey: payload.chunkKey,
            clientId: payload.clientId,
            position: payload.position,
            rotation: payload.rotation,
            quality: payload.quality,
            lastRepairTime: payload.lastRepairTime
        };
        await this.handleReleaseMobileEntity(ws, mobilePayload);
    }

    /**
     * Handle place_crate message
     * Creates a mobile crate structure with inventory
     */
    async handlePlaceCrate(payload) {
        try {
            const { position, rotation, materialQuality, clientId, accountId } = payload;

            // Calculate chunk from position
            const chunkId = ChunkCoordinates.worldToChunkId(position[0], position[2]);
            const crateId = `crate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const ownerId = accountId || clientId;

            // Calculate quality with cap (crate uses same cap as cart/tent)
            let quality = materialQuality || 50;
            const qualityCap = CONFIG.CONSTRUCTION.STRUCTURE_QUALITY_CAPS?.['crate'];
            if (qualityCap !== undefined) {
                quality = Math.min(quality, qualityCap);
            }

            // Create crate structure object WITH inventory (10x10 like tent)
            const crateChange = {
                action: 'add',
                id: crateId,
                name: 'crate',
                position: position,
                rotation: rotation || 0,
                scale: 1.0,
                quality: quality,
                lastRepairTime: Date.now(),
                chunkId: chunkId,
                inventory: { items: [] },  // Empty 10x10 inventory
                owner: ownerId
            };

            // Save to chunk file
            await this.chunkManager.addObjectChange(chunkId, crateChange);

            // Calculate durability values
            const crateDurabilityInfo = enrichStructureWithDurability(crateChange);

            // Look up owner name
            const ownerName = ownerId && this.authManager ?
                await this.authManager.getUsernameById(ownerId) : null;

            // Broadcast to clients
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'object_added',
                payload: {
                    chunkId: chunkId,
                    objectId: crateId,
                    objectType: 'crate',
                    position: position,
                    rotation: rotation || 0,
                    scale: 1.0,
                    quality: quality,
                    currentDurability: crateDurabilityInfo.currentDurability,
                    hoursUntilRuin: crateDurabilityInfo.hoursUntilRuin,
                    inventory: { items: [] },
                    owner: ownerId,
                    ownerName: ownerName
                }
            });

            console.log(`[Crate] Placed crate ${crateId} at chunk ${chunkId}`);
        } catch (error) {
            console.error('ERROR in place_crate:', error);
        }
    }

    /**
     * Handle claim_crate message
     * Temporarily removes a crate from chunk when player loads it onto cart
     * Now includes lock acquisition and server-side occupied tracking
     */
    async handleClaimCrate(ws, payload) {
        try {
            const { entityId, chunkKey, clientId } = payload;
            const fullChunkId = `chunk_${chunkKey}`;

            // Check if crate is already loaded by someone else (server-side occupied check)
            if (this.loadedCrates.has(entityId)) {
                const existingClaim = this.loadedCrates.get(entityId);
                ws.send(JSON.stringify({
                    type: 'claim_crate_response',
                    payload: {
                        entityId,
                        success: false,
                        reason: 'Crate is already loaded on another cart'
                    }
                }));
                console.warn(`[Crate] Crate ${entityId} already claimed by ${existingClaim.clientId}`);
                return;
            }

            const chunkData = await this.chunkManager.loadChunk(fullChunkId);
            if (!chunkData || !chunkData.objectChanges) {
                ws.send(JSON.stringify({
                    type: 'claim_crate_response',
                    payload: { entityId, success: false, reason: 'Chunk not found' }
                }));
                console.warn(`[Crate] Chunk ${fullChunkId} not found for claim_crate`);
                return;
            }

            // Find the crate
            const crateIndex = chunkData.objectChanges.findIndex(
                obj => obj.id === entityId && obj.action === 'add' && obj.name === 'crate'
            );

            if (crateIndex === -1) {
                ws.send(JSON.stringify({
                    type: 'claim_crate_response',
                    payload: { entityId, success: false, reason: 'Crate not found' }
                }));
                console.warn(`[Crate] Crate ${entityId} not found in chunk ${fullChunkId}`);
                return;
            }

            const crate = chunkData.objectChanges[crateIndex];

            // Check if crate has an inventory lock held by someone else
            if (crate.lockedBy && crate.lockedBy !== clientId && !this.isLockStale(crate)) {
                ws.send(JSON.stringify({
                    type: 'claim_crate_response',
                    payload: {
                        entityId,
                        success: false,
                        reason: 'Crate inventory is being used by another player'
                    }
                }));
                return;
            }

            // Acquire inventory lock on the crate
            crate.lockedBy = clientId;
            crate.lockTime = Date.now();
            crate.claimedBy = clientId;
            crate.claimedAt = Date.now();

            // Save chunk with lock
            await this.chunkManager.saveChunk(fullChunkId, chunkData);

            // Track in server-side loadedCrates Map
            this.loadedCrates.set(entityId, {
                clientId,
                claimedAt: Date.now(),
                chunkId: fullChunkId,
                inventory: crate.inventory || { items: [] }
            });

            // Send success response to client
            ws.send(JSON.stringify({
                type: 'claim_crate_response',
                payload: {
                    entityId,
                    success: true,
                    inventory: crate.inventory || { items: [] }
                }
            }));

            // Broadcast crate removal (it's now on a cart)
            this.messageRouter.broadcastTo3x3Grid(fullChunkId, {
                type: 'object_removed',
                payload: {
                    chunkId: fullChunkId,
                    objectId: entityId,
                    isMobileClaim: true,
                    claimedBy: clientId
                }
            });

            console.log(`[Crate] Crate ${entityId} claimed by ${clientId} with lock`);
        } catch (error) {
            console.error('ERROR in claim_crate:', error);
            ws.send(JSON.stringify({
                type: 'claim_crate_response',
                payload: { entityId: payload.entityId, success: false, reason: 'Server error' }
            }));
        }
    }

    /**
     * Validate crate inventory format to prevent malicious data
     * @param {object} inventory - The inventory to validate
     * @returns {{ valid: boolean, reason?: string, sanitized?: object }}
     */
    validateCrateInventory(inventory) {
        // Must be an object with items array
        if (!inventory || typeof inventory !== 'object') {
            return { valid: true, sanitized: { items: [] } };
        }

        if (!Array.isArray(inventory.items)) {
            return { valid: true, sanitized: { items: [] } };
        }

        // Validate each item
        const sanitizedItems = [];
        const CRATE_COLS = 10;
        const CRATE_ROWS = 10;

        for (const item of inventory.items) {
            // Skip invalid items
            if (!item || typeof item !== 'object') continue;
            if (typeof item.type !== 'string' || item.type.length === 0 || item.type.length > 50) continue;

            // Validate position bounds (client uses x/y, not col/row)
            const x = parseInt(item.x, 10);
            const y = parseInt(item.y, 10);
            if (isNaN(x) || isNaN(y)) continue;
            if (x < 0 || x >= CRATE_COLS || y < 0 || y >= CRATE_ROWS) continue;

            // Validate dimensions
            const width = parseInt(item.width, 10) || 1;
            const height = parseInt(item.height, 10) || 1;
            if (width < 1 || width > 5 || height < 1 || height > 5) continue;
            if (x + width > CRATE_COLS || y + height > CRATE_ROWS) continue;

            // Validate quantity
            const quantity = parseInt(item.quantity, 10) || 1;
            if (quantity < 1 || quantity > 1000) continue;

            // Validate quality and durability
            const quality = Math.max(1, Math.min(100, parseInt(item.quality, 10) || 50));
            const durability = Math.max(0, Math.min(100, parseInt(item.durability, 10) || 100));

            sanitizedItems.push({
                id: item.id,  // Preserve item ID
                type: item.type,
                x,
                y,
                width,
                height,
                quantity,
                quality,
                durability,
                rotation: parseInt(item.rotation, 10) || 0
            });
        }

        return { valid: true, sanitized: { items: sanitizedItems } };
    }

    /**
     * Handle release_crate message
     * Adds crate back to chunk at new position when unloaded from cart
     * Now includes ownership validation, inventory validation, and lock release
     */
    async handleReleaseCrate(ws, payload) {
        try {
            const { entityId, chunkKey, clientId, position, rotation, quality, lastRepairTime, inventory } = payload;
            const originalFullChunkId = `chunk_${chunkKey}`;

            // Validate ownership - must be the client who claimed it
            const loadedCrate = this.loadedCrates.get(entityId);
            if (!loadedCrate) {
                ws.send(JSON.stringify({
                    type: 'release_crate_response',
                    payload: { entityId, success: false, reason: 'Crate not found in loaded state' }
                }));
                console.warn(`[Crate] Release failed - crate ${entityId} not in loadedCrates`);
                return;
            }

            if (loadedCrate.clientId !== clientId) {
                ws.send(JSON.stringify({
                    type: 'release_crate_response',
                    payload: { entityId, success: false, reason: 'You do not own this loaded crate' }
                }));
                console.warn(`[Crate] Release failed - crate ${entityId} owned by ${loadedCrate.clientId}, not ${clientId}`);
                return;
            }

            // Validate position
            if (!Array.isArray(position) || position.length !== 3 ||
                !position.every(p => typeof p === 'number' && isFinite(p))) {
                ws.send(JSON.stringify({
                    type: 'release_crate_response',
                    payload: { entityId, success: false, reason: 'Invalid position' }
                }));
                return;
            }

            // Validate and sanitize inventory
            const inventoryValidation = this.validateCrateInventory(inventory);
            const sanitizedInventory = inventoryValidation.sanitized;

            // Calculate new chunk based on drop position
            const newChunkId = ChunkCoordinates.worldToChunkId(position[0], position[2]);

            // If same chunk, update in place; if different chunk, move between chunks
            if (newChunkId === originalFullChunkId) {
                // Same chunk - just update position and clear claimed status
                const chunkData = await this.chunkManager.loadChunk(newChunkId);
                if (chunkData && chunkData.objectChanges) {
                    const crateIndex = chunkData.objectChanges.findIndex(
                        obj => obj.id === entityId && obj.name === 'crate'
                    );

                    if (crateIndex !== -1) {
                        const crate = chunkData.objectChanges[crateIndex];
                        crate.position = position;
                        crate.rotation = rotation;
                        crate.inventory = sanitizedInventory;
                        // Release lock
                        delete crate.lockedBy;
                        delete crate.lockTime;
                        delete crate.claimedBy;
                        delete crate.claimedAt;

                        await this.chunkManager.saveChunk(newChunkId, chunkData);
                    }
                }
            } else {
                // Different chunk - remove from old, add to new
                // Remove from original chunk
                const originalChunkData = await this.chunkManager.loadChunk(originalFullChunkId);
                if (originalChunkData && originalChunkData.objectChanges) {
                    const crateIndex = originalChunkData.objectChanges.findIndex(
                        obj => obj.id === entityId && obj.name === 'crate'
                    );
                    if (crateIndex !== -1) {
                        originalChunkData.objectChanges.splice(crateIndex, 1);
                        await this.chunkManager.saveChunk(originalFullChunkId, originalChunkData);
                    }
                }

                // Add to new chunk (without lock)
                const crateChange = {
                    action: 'add',
                    id: entityId,
                    name: 'crate',
                    position: position,
                    rotation: rotation || 0,
                    scale: 1.0,
                    quality: quality || 50,
                    lastRepairTime: lastRepairTime || Date.now(),
                    chunkId: newChunkId,
                    inventory: sanitizedInventory
                };

                await this.chunkManager.addObjectChange(newChunkId, crateChange);
            }

            // Remove from server-side tracking
            this.loadedCrates.delete(entityId);

            // Calculate durability for broadcast
            const crateDurabilityInfo = enrichStructureWithDurability({
                quality: quality || 50,
                lastRepairTime: lastRepairTime || Date.now(),
                name: 'crate'
            });

            // Send success response to client BEFORE broadcast
            ws.send(JSON.stringify({
                type: 'release_crate_response',
                payload: { entityId, success: true, newChunkId }
            }));

            // Broadcast crate appearance
            this.messageRouter.broadcastTo3x3Grid(newChunkId, {
                type: 'object_added',
                payload: {
                    chunkId: newChunkId,
                    objectId: entityId,
                    objectType: 'crate',
                    position: position,
                    rotation: rotation || 0,
                    scale: 1.0,
                    quality: quality || 50,
                    currentDurability: crateDurabilityInfo.currentDurability,
                    hoursUntilRuin: crateDurabilityInfo.hoursUntilRuin,
                    inventory: sanitizedInventory,
                    isMobileRelease: true  // Flag so clients update position/physics for existing object
                }
            });

            console.log(`[Crate] Crate ${entityId} released at chunk ${newChunkId} by ${clientId}`);
        } catch (error) {
            console.error('ERROR in release_crate:', error);
            ws.send(JSON.stringify({
                type: 'release_crate_response',
                payload: { entityId: payload.entityId, success: false, reason: 'Server error' }
            }));
        }
    }

    /**
     * Handle claim_boat message
     * Temporarily removes a boat from the chunk when a player boards it
     * The boat becomes "mobile" and controlled by the player client
     */
    async handleClaimBoat(ws, payload) {
        try {
            const { entityId, chunkKey, clientId } = payload;
            const fullChunkId = `chunk_${chunkKey}`;

            const chunkData = await this.chunkManager.loadChunk(fullChunkId);
            if (!chunkData || !chunkData.objectChanges) {
                console.warn(`[Boat] Chunk ${fullChunkId} not found for claim_boat`);
                return;
            }

            // Find the boat
            const boatIndex = chunkData.objectChanges.findIndex(
                obj => obj.id === entityId && obj.action === 'add' && obj.name === 'boat'
            );

            if (boatIndex === -1) {
                console.warn(`[Boat] Boat ${entityId} not found in chunk ${fullChunkId}`);
                return;
            }

            // Mark boat as claimed (remove from chunk visually but keep data)
            const boat = chunkData.objectChanges[boatIndex];
            boat.claimedBy = clientId;
            boat.claimedAt = Date.now();

            // Save chunk
            await this.chunkManager.saveChunk(fullChunkId, chunkData);

            // Broadcast boat removal (it's now "mobile" controlled by client)
            this.messageRouter.broadcastTo3x3Grid(fullChunkId, {
                type: 'object_removed',
                payload: {
                    chunkId: fullChunkId,
                    objectId: entityId,
                    isMobileClaim: true,  // Flag so peers know this is a claim, not destruction
                    claimedBy: clientId
                }
            });

            console.log(`[Boat] Boat ${entityId} claimed by ${clientId}`);
        } catch (error) {
            console.error('ERROR in claim_boat:', error);
        }
    }

    /**
     * Handle release_boat message
     * Adds a boat back to a chunk when a player disembarks
     * The boat returns to being a static structure at the new position
     */
    async handleReleaseBoat(ws, payload) {
        try {
            const { entityId, chunkKey, clientId, position, rotation, quality, lastRepairTime } = payload;

            // Calculate new chunk from position (boat may have moved to different chunk)
            const newChunkId = ChunkCoordinates.worldToChunkId(position[0], position[2]);
            const oldChunkId = `chunk_${chunkKey}`;

            // Load old chunk to get boat data and remove claimed status
            const oldChunkData = await this.chunkManager.loadChunk(oldChunkId);
            if (oldChunkData && oldChunkData.objectChanges) {
                // Find the boat in old chunk
                const boatIndex = oldChunkData.objectChanges.findIndex(
                    obj => obj.id === entityId && obj.action === 'add' && obj.name === 'boat'
                );

                if (boatIndex !== -1) {
                    // Remove from old chunk (if boat moved to different chunk)
                    if (oldChunkId !== newChunkId) {
                        oldChunkData.objectChanges.splice(boatIndex, 1);
                        await this.chunkManager.saveChunk(oldChunkId, oldChunkData);
                    } else {
                        // Same chunk - just update position and clear claim
                        const boat = oldChunkData.objectChanges[boatIndex];
                        boat.position = position;
                        boat.rotation = rotation;
                        boat.claimedBy = null;
                        boat.claimedAt = null;
                        await this.chunkManager.saveChunk(oldChunkId, oldChunkData);
                    }
                }
            }

            // If boat moved to different chunk, add to new chunk
            if (oldChunkId !== newChunkId) {
                const boatChange = {
                    action: 'add',
                    id: entityId,
                    name: 'boat',
                    position: position,
                    rotation: rotation || 0,
                    scale: 1.0,
                    quality: quality || 50,
                    lastRepairTime: lastRepairTime || Date.now(),
                    chunkId: newChunkId,
                    claimedBy: null,
                    claimedAt: null
                };

                await this.chunkManager.addObjectChange(newChunkId, boatChange);
            }

            // Calculate durability values
            const boatDurabilityInfo = enrichStructureWithDurability({
                quality: quality || 50,
                lastRepairTime: lastRepairTime || Date.now(),
                name: 'boat'
            });

            // Broadcast boat re-addition to nearby players
            this.messageRouter.broadcastTo3x3Grid(newChunkId, {
                type: 'object_added',
                payload: {
                    chunkId: newChunkId,
                    objectId: entityId,
                    objectType: 'boat',
                    position: position,
                    rotation: rotation || 0,
                    scale: 1.0,
                    quality: quality || 50,
                    currentDurability: boatDurabilityInfo.currentDurability,
                    hoursUntilRuin: boatDurabilityInfo.hoursUntilRuin,
                    isMobileRelease: true  // Flag so peers know this is a release
                }
            });

            console.log(`[Boat] Boat ${entityId} released by ${clientId} at ${newChunkId}`);
        } catch (error) {
            console.error('ERROR in release_boat:', error);
        }
    }

    /**
     * Handle claim_mobile_entity message (generalized for boats, horses, etc.)
     * Temporarily removes an entity from the chunk when a player boards/mounts it
     */
    async handleClaimMobileEntity(ws, payload) {
        try {
            const { entityId, entityType, chunkKey, clientId } = payload;
            const fullChunkId = `chunk_${chunkKey}`;

            const chunkData = await this.chunkManager.loadChunk(fullChunkId);
            if (!chunkData || !chunkData.objectChanges) {
                console.warn(`[MobileEntity] Chunk ${fullChunkId} not found for claim`);
                return;
            }

            // Find the entity
            const entityIndex = chunkData.objectChanges.findIndex(
                obj => obj.id === entityId && obj.action === 'add' && obj.name === entityType
            );

            if (entityIndex === -1) {
                console.warn(`[MobileEntity] ${entityType} ${entityId} not found in chunk ${fullChunkId}`);
                return;
            }

            // Mark as claimed
            const entity = chunkData.objectChanges[entityIndex];
            entity.claimedBy = clientId;
            entity.claimedAt = Date.now();

            await this.chunkManager.saveChunk(fullChunkId, chunkData);

            // Broadcast entity removal (it's now "mobile" controlled by client)
            this.messageRouter.broadcastTo3x3Grid(fullChunkId, {
                type: 'object_removed',
                payload: {
                    chunkId: fullChunkId,
                    objectId: entityId,
                    isMobileClaim: true,
                    claimedBy: clientId
                }
            });

            // Track claimed entity for disconnect cleanup
            if (!this.clientMobileEntities.has(clientId)) {
                this.clientMobileEntities.set(clientId, []);
            }
            this.clientMobileEntities.get(clientId).push({
                entityId,
                entityType,
                chunkId: fullChunkId
            });

            console.log(`[MobileEntity] ${entityType} ${entityId} claimed by ${clientId}`);
        } catch (error) {
            console.error('ERROR in claim_mobile_entity:', error);
        }
    }

    /**
     * Handle release_mobile_entity message (generalized for boats, horses, etc.)
     * Adds an entity back to a chunk when a player dismounts/disembarks
     */
    async handleReleaseMobileEntity(ws, payload) {
        try {
            const { entityId, entityType, chunkKey, clientId, position, rotation, quality, lastRepairTime } = payload;

            // Calculate new chunk from position (entity may have moved to different chunk)
            const newChunkId = ChunkCoordinates.worldToChunkId(position[0], position[2]);
            const oldChunkId = `chunk_${chunkKey}`;

            // Load old chunk to get entity data and remove claimed status
            const oldChunkData = await this.chunkManager.loadChunk(oldChunkId);
            if (oldChunkData && oldChunkData.objectChanges) {
                const entity = oldChunkData.objectChanges.find(
                    obj => obj.id === entityId && obj.action === 'add' && obj.name === entityType
                );

                if (entity) {
                    // Validate ownership - only the claiming client can release
                    if (entity.claimedBy && entity.claimedBy !== clientId) {
                        console.warn(`[MobileEntity] Client ${clientId} tried to release ${entityId} claimed by ${entity.claimedBy}`);
                        return;
                    }

                    if (oldChunkId !== newChunkId) {
                        // Remove from old chunk using filter (race-condition safe)
                        oldChunkData.objectChanges = oldChunkData.objectChanges.filter(
                            obj => obj.id !== entityId
                        );
                        await this.chunkManager.saveChunk(oldChunkId, oldChunkData);
                    } else {
                        // Same chunk - update position and clear claim
                        entity.position = position;
                        entity.rotation = rotation;
                        entity.claimedBy = null;
                        entity.claimedAt = null;
                        await this.chunkManager.saveChunk(oldChunkId, oldChunkData);
                    }
                }
            }

            // If entity moved to different chunk, add to new chunk
            if (oldChunkId !== newChunkId) {
                const entityChange = {
                    action: 'add',
                    id: entityId,
                    name: entityType,
                    position: position,
                    rotation: rotation || 0,
                    scale: 1.0,
                    quality: quality || 50,
                    lastRepairTime: lastRepairTime || Date.now(),
                    chunkId: newChunkId,
                    claimedBy: null,
                    claimedAt: null
                };

                await this.chunkManager.addObjectChange(newChunkId, entityChange);
            }

            // Calculate durability values
            const durabilityInfo = enrichStructureWithDurability({
                quality: quality || 50,
                lastRepairTime: lastRepairTime || Date.now(),
                name: entityType
            });

            // Broadcast entity re-addition to nearby players
            this.messageRouter.broadcastTo3x3Grid(newChunkId, {
                type: 'object_added',
                payload: {
                    chunkId: newChunkId,
                    objectId: entityId,
                    objectType: entityType,
                    position: position,
                    rotation: rotation || 0,
                    scale: 1.0,
                    quality: quality || 50,
                    currentDurability: durabilityInfo.currentDurability,
                    hoursUntilRuin: durabilityInfo.hoursUntilRuin,
                    isMobileRelease: true
                }
            });

            // Remove from disconnect tracking
            const clientEntities = this.clientMobileEntities.get(clientId);
            if (clientEntities) {
                const index = clientEntities.findIndex(e => e.entityId === entityId);
                if (index !== -1) {
                    clientEntities.splice(index, 1);
                }
                if (clientEntities.length === 0) {
                    this.clientMobileEntities.delete(clientId);
                }
            }

            console.log(`[MobileEntity] ${entityType} ${entityId} released by ${clientId} at ${newChunkId}`);
        } catch (error) {
            console.error('ERROR in release_mobile_entity:', error);
        }
    }

    /**
     * Cleanup mobile entities claimed by a disconnected client
     * Called from server.js on ws.close
     */
    async cleanupMobileEntitiesForClient(clientId) {
        const entities = this.clientMobileEntities.get(clientId);
        if (!entities || entities.length === 0) {
            this.clientMobileEntities.delete(clientId);
            return;
        }

        // Get player's last known chunk (more accurate than stored claim chunk)
        const clientData = this.clients.get(clientId);
        const playerCurrentChunk = clientData?.currentChunk || null;

        console.log(`[MobileEntity] Cleaning up ${entities.length} entities for disconnected client ${clientId} (last chunk: ${playerCurrentChunk})`);

        for (const { entityId, entityType, chunkId } of entities) {
            try {
                // First try to find entity in the stored chunk
                let chunkData = await this.chunkManager.loadChunk(chunkId);
                let entity = chunkData?.objectChanges?.find(
                    obj => obj.id === entityId && obj.claimedBy === clientId
                );
                let actualChunkId = chunkId;

                // If not found and player moved to different chunk, check player's current chunk
                if (!entity && playerCurrentChunk && playerCurrentChunk !== chunkId) {
                    console.log(`[MobileEntity] Entity ${entityId} not in original chunk ${chunkId}, checking player's current chunk ${playerCurrentChunk}`);
                    chunkData = await this.chunkManager.loadChunk(playerCurrentChunk);
                    entity = chunkData?.objectChanges?.find(
                        obj => obj.id === entityId && obj.claimedBy === clientId
                    );
                    if (entity) {
                        actualChunkId = playerCurrentChunk;
                    }
                }

                if (entity) {
                    // Clear claimed status
                    entity.claimedBy = null;
                    entity.claimedAt = null;

                    // If player moved to different chunk, update entity position to player's last chunk center
                    if (playerCurrentChunk && playerCurrentChunk !== chunkId) {
                        const [chunkX, chunkZ] = playerCurrentChunk.replace('chunk_', '').split(',').map(Number);
                        const newPosition = [chunkX * 50 + 25, entity.position[1], chunkZ * 50 + 25];

                        // Remove from old chunk if different
                        if (actualChunkId !== playerCurrentChunk) {
                            chunkData.objectChanges = chunkData.objectChanges.filter(
                                obj => obj.id !== entityId
                            );
                            await this.chunkManager.saveChunk(actualChunkId, chunkData);

                            // Add to player's current chunk
                            const entityChange = {
                                action: 'add',
                                id: entityId,
                                name: entityType,
                                position: newPosition,
                                rotation: entity.rotation || 0,
                                scale: entity.scale || 1.0,
                                quality: entity.quality || 50,
                                lastRepairTime: entity.lastRepairTime || Date.now(),
                                chunkId: playerCurrentChunk,
                                claimedBy: null,
                                claimedAt: null
                            };
                            await this.chunkManager.addObjectChange(playerCurrentChunk, entityChange);
                            actualChunkId = playerCurrentChunk;
                            entity.position = newPosition;
                        } else {
                            entity.position = newPosition;
                            await this.chunkManager.saveChunk(actualChunkId, chunkData);
                        }
                    } else {
                        await this.chunkManager.saveChunk(actualChunkId, chunkData);
                    }

                    // Broadcast entity re-addition
                    const durabilityInfo = enrichStructureWithDurability({
                        quality: entity.quality || 50,
                        lastRepairTime: entity.lastRepairTime || Date.now(),
                        name: entityType
                    });

                    this.messageRouter.broadcastTo3x3Grid(actualChunkId, {
                        type: 'object_added',
                        payload: {
                            chunkId: actualChunkId,
                            objectId: entityId,
                            objectType: entityType,
                            position: entity.position,
                            rotation: entity.rotation || 0,
                            scale: entity.scale || 1.0,
                            quality: entity.quality || 50,
                            currentDurability: durabilityInfo.currentDurability,
                            hoursUntilRuin: durabilityInfo.hoursUntilRuin,
                            isMobileRelease: true
                        }
                    });

                    console.log(`[MobileEntity] Restored ${entityType} ${entityId} in chunk ${actualChunkId} after client disconnect`);
                } else {
                    console.warn(`[MobileEntity] Could not find entity ${entityId} for cleanup (checked ${chunkId}${playerCurrentChunk && playerCurrentChunk !== chunkId ? ` and ${playerCurrentChunk}` : ''})`);
                }
            } catch (error) {
                console.error(`[MobileEntity] Error cleaning up ${entityId}:`, error);
            }
        }

        this.clientMobileEntities.delete(clientId);
    }

    /**
     * Cleanup loaded crates for a disconnected client
     * Restores crates back to their original chunk
     * Called from server.js on ws.close
     */
    async cleanupLoadedCratesForClient(clientId) {
        // Find all crates loaded by this client
        const cratesToRelease = [];
        for (const [entityId, crateInfo] of this.loadedCrates) {
            if (crateInfo.clientId === clientId) {
                cratesToRelease.push({ entityId, ...crateInfo });
            }
        }

        if (cratesToRelease.length === 0) return;

        console.log(`[Crate] Cleaning up ${cratesToRelease.length} loaded crates for disconnected client ${clientId}`);

        for (const { entityId, chunkId, inventory } of cratesToRelease) {
            try {
                const chunkData = await this.chunkManager.loadChunk(chunkId);
                if (!chunkData || !chunkData.objectChanges) continue;

                const crate = chunkData.objectChanges.find(
                    obj => obj.id === entityId && obj.name === 'crate' && obj.claimedBy === clientId
                );

                if (crate) {
                    // Clear claimed/locked status - restore crate to original state
                    delete crate.claimedBy;
                    delete crate.claimedAt;
                    delete crate.lockedBy;
                    delete crate.lockTime;

                    await this.chunkManager.saveChunk(chunkId, chunkData);

                    // Broadcast crate re-appearance at original position
                    const durabilityInfo = enrichStructureWithDurability({
                        quality: crate.quality || 50,
                        lastRepairTime: crate.lastRepairTime || Date.now(),
                        name: 'crate'
                    });

                    this.messageRouter.broadcastTo3x3Grid(chunkId, {
                        type: 'object_added',
                        payload: {
                            chunkId: chunkId,
                            objectId: entityId,
                            objectType: 'crate',
                            position: crate.position,
                            rotation: crate.rotation || 0,
                            scale: crate.scale || 1.0,
                            quality: crate.quality || 50,
                            currentDurability: durabilityInfo.currentDurability,
                            hoursUntilRuin: durabilityInfo.hoursUntilRuin,
                            inventory: inventory || crate.inventory || { items: [] },
                            isDisconnectRestore: true
                        }
                    });

                    console.log(`[Crate] Restored crate ${entityId} at original position after client disconnect`);
                }

                // Remove from tracking
                this.loadedCrates.delete(entityId);
            } catch (error) {
                console.error(`[Crate] Error cleaning up crate ${entityId}:`, error);
                // Still remove from tracking to prevent memory leak
                this.loadedCrates.delete(entityId);
            }
        }
    }

    async handlePlaceCampfire(payload) {
        try {
            const { position, rotation, materialQuality, materialType, isBanditStructure, objectId } = payload;

            // Calculate chunk from position using unified CENTER-BASED system
            const chunkId = ChunkCoordinates.worldToChunkId(position[0], position[2]);

            // Use provided objectId (for bandit structures) or generate unique ID
            const campfireId = objectId || `campfire_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Calculate quality from material quality and apply cap
            let quality = materialQuality || 50;  // Use stone quality, default to 50 if not provided
            const qualityCap = CONFIG.CONSTRUCTION.STRUCTURE_QUALITY_CAPS?.['campfire'];
            if (qualityCap !== undefined) {
                quality = Math.min(quality, qualityCap);
            }

            // Generate loot for bandit campfires
            const campfireInventory = isBanditStructure ? generateBanditCampfireLoot(campfireId) : [];

            // Create campfire structure object (actual 3D object with inventory)
            const campfireChange = {
                action: 'add',
                id: campfireId,
                name: 'campfire',
                position: position,
                rotation: rotation || 0,
                scale: 1.0,
                quality: quality,  // Use calculated quality with material and cap
                lastRepairTime: Date.now(),  // Track when structure was created
                chunkId: chunkId,
                inventory: { items: campfireInventory },
                isBanditStructure: isBanditStructure || false,
                materialType: materialType || 'limestone'  // sandstone or limestone for visual tint
            };

            // Save to chunk file
            await this.chunkManager.addObjectChange(chunkId, campfireChange);

            // Calculate durability values for broadcast
            const campfireDurabilityInfo = enrichStructureWithDurability(campfireChange);

            // Broadcast to all clients in 3x3 grid (using same format as regular structures)
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'object_added',
                payload: {
                    chunkId: chunkId,
                    objectId: campfireId,
                    objectType: 'campfire',
                    position: position,
                    rotation: rotation || 0,
                    scale: 1.0,
                    quality: quality,  // Use calculated quality
                    currentDurability: campfireDurabilityInfo.currentDurability,
                    hoursUntilRuin: campfireDurabilityInfo.hoursUntilRuin,
                    totalResources: null,
                    remainingResources: null,
                    inventory: { items: campfireInventory },
                    isBanditStructure: isBanditStructure || false,
                    materialType: materialType || 'limestone'
                }
            });
        } catch (error) {
            console.error('ERROR in place_campfire:', error);
        }
    }

    /**
     * Handle place_tent message
     * Creates instant-build tent with 10x10 inventory
     * Also sets as player's home if they have an accountId
     */
    async handlePlaceTent(payload) {
        try {
            const { position, rotation, materialQuality, clientId, accountId, isBanditStructure, objectId } = payload;

            // Calculate chunk from position
            const chunkId = ChunkCoordinates.worldToChunkId(position[0], position[2]);

            // Use accountId for persistent ownership if available, otherwise fall back to clientId
            const ownerId = accountId || clientId;

            // Use provided objectId (for bandit structures) or generate unique ID
            const tentId = objectId || `tent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Calculate quality from material quality and apply cap
            let quality = materialQuality || 50;  // Use plank quality, default to 50
            const qualityCap = CONFIG.CONSTRUCTION.STRUCTURE_QUALITY_CAPS?.['tent'];
            if (qualityCap !== undefined) {
                quality = Math.min(quality, qualityCap);
            }

            // Generate loot for bandit tents
            const tentInventory = isBanditStructure ? generateBanditTentLoot(tentId) : [];

            // Create tent structure object (actual 3D object with 10x10 inventory)
            const tentChange = {
                action: 'add',
                id: tentId,
                name: 'tent',
                position: position,
                rotation: rotation || 0,
                scale: 1.0,
                quality: quality,  // Use calculated quality with material and cap
                lastRepairTime: Date.now(),  // Track when structure was created
                chunkId: chunkId,
                inventory: { items: tentInventory },
                isBanditStructure: isBanditStructure || false,
                owner: ownerId  // Track who built the tent (for ownership transfer on registration)
            };

            // Save to chunk file
            await this.chunkManager.addObjectChange(chunkId, tentChange);

            // Calculate durability values for broadcast
            const tentDurabilityInfo = enrichStructureWithDurability(tentChange);

            // Look up owner name for display
            const ownerName = ownerId && this.authManager ? await this.authManager.getUsernameById(ownerId) : null;

            // Broadcast to all clients in 3x3 grid (using same format as regular structures)
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'object_added',
                payload: {
                    chunkId: chunkId,
                    objectId: tentId,
                    objectType: 'tent',
                    position: position,
                    rotation: rotation || 0,
                    scale: 1.0,
                    quality: quality,  // Use calculated quality
                    currentDurability: tentDurabilityInfo.currentDurability,
                    hoursUntilRuin: tentDurabilityInfo.hoursUntilRuin,
                    totalResources: null,
                    remainingResources: null,
                    inventory: { items: tentInventory },
                    isBanditStructure: isBanditStructure || false,
                    owner: ownerId,
                    ownerName: ownerName
                }
            });

            // Set as player's home if they have an accountId (not for bandit tents)
            if (accountId && this.authManager && !isBanditStructure) {
                await this.authManager.setHome(accountId, tentId, position[0], position[2]);

                // Notify client their home was set
                this.messageRouter.sendToAccount(accountId, {
                    type: 'home_set',
                    payload: {
                        structureId: tentId,
                        x: position[0],
                        z: position[2]
                    }
                });
            }
        } catch (error) {
            console.error('ERROR in place_tent:', error);
        }
    }

    /**
     * Handle place_outpost message
     * Creates instant-build outpost (for bandit camps)
     */
    async handlePlaceOutpost(payload) {
        try {
            const { position, rotation, materialQuality, isBanditStructure, objectId } = payload;

            // Calculate chunk from position
            const chunkId = ChunkCoordinates.worldToChunkId(position[0], position[2]);

            // Use provided objectId (for bandit structures) or generate unique ID
            const outpostId = objectId || `outpost_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Calculate quality from material quality and apply cap
            let quality = materialQuality || 50;
            const qualityCap = CONFIG.CONSTRUCTION.STRUCTURE_QUALITY_CAPS?.['outpost'];
            if (qualityCap !== undefined) {
                quality = Math.min(quality, qualityCap);
            }

            // Create outpost structure object
            const outpostChange = {
                action: 'add',
                id: outpostId,
                name: 'outpost',
                position: position,
                rotation: rotation || 0,
                scale: 1.0,
                quality: quality,
                lastRepairTime: Date.now(),
                chunkId: chunkId,
                isBanditStructure: isBanditStructure || false
            };

            // Save to chunk file
            await this.chunkManager.addObjectChange(chunkId, outpostChange);

            // Calculate durability values for broadcast
            const outpostDurabilityInfo = enrichStructureWithDurability(outpostChange);

            // Broadcast to all clients in 3x3 grid
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'object_added',
                payload: {
                    chunkId: chunkId,
                    objectId: outpostId,
                    objectType: 'outpost',
                    position: position,
                    rotation: rotation || 0,
                    scale: 1.0,
                    quality: quality,
                    currentDurability: outpostDurabilityInfo.currentDurability,
                    hoursUntilRuin: outpostDurabilityInfo.hoursUntilRuin,
                    totalResources: null,
                    remainingResources: null,
                    isBanditStructure: isBanditStructure || false
                }
            });
        } catch (error) {
            console.error('ERROR in place_outpost:', error);
        }
    }

    /**
     * Handle plant_tree message
     * Creates a growing tree that will mature over 30 minutes
     */
    async handlePlantTree(payload) {
        try {
            const { position, treeType, quality } = payload;

            // Always calculate chunk from position using unified CENTER-BASED system
            // (ignore client-provided chunkId to ensure correct "chunk_X,Z" format)
            const finalChunkId = ChunkCoordinates.worldToChunkId(position[0], position[2]);

            // Generate unique ID for planted tree
            const treeId = `planted_${treeType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Vegetables start at 75% scale, trees start at 25%
            const initialScale = treeType === 'vegetables' ? 0.75 : 0.25;

            // Create planted tree object with growth tracking (tick-based)
            const plantedTreeChange = {
                action: 'add',
                id: treeId,
                name: treeType,  // Tree type (pine, fir, apple, vegetables)
                position: position,
                rotation: 0,
                scale: initialScale,  // Vegetables 75%, trees 25%
                quality: quality || 50,
                chunkId: finalChunkId,
                // Growth tracking fields (tick-based)
                isGrowing: true,
                plantedAtTick: this.serverTick || 0,
                growthDurationTicks: 1800, // 30 minutes
                // Tree-specific fields
                totalResources: 100,  // Full resources when grown
                remainingResources: 100
            };

            // Save to chunk file
            await this.chunkManager.addObjectChange(finalChunkId, plantedTreeChange);

            // Broadcast to all clients in 3x3 grid (tick-based)
            this.messageRouter.broadcastTo3x3Grid(finalChunkId, {
                type: 'tree_planted',
                payload: {
                    chunkId: finalChunkId,
                    objectId: treeId,
                    treeType: treeType,
                    position: position,
                    scale: initialScale,
                    quality: quality || 50,
                    isGrowing: true,
                    plantedAtTick: this.serverTick || 0,
                    growthDurationTicks: 1800
                }
            });
        } catch (error) {
            console.error('ERROR in plant_tree:', error);
        }
    }

    /**
     * Handle build_construction message
     */
    async handleBuildConstruction(payload) {
        try {
            const { constructionId, chunkKey, materialType } = payload;
            const fullChunkId = `chunk_${chunkKey}`;
            const chunkData = await this.chunkManager.loadChunk(fullChunkId);

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
                if (typeof data === 'object' && data.quantity !== undefined && data.totalQuality !== undefined) {
                    totalQuality += data.totalQuality;
                    materialCount += data.quantity;
                } else if (typeof data === 'number') {
                    // Backwards compatibility: old format (just a number)
                    totalQuality += 50 * data;
                    materialCount += data;
                }
            }

            let structureQuality = clampQuality(materialCount > 0 ? Math.round(totalQuality / materialCount) : 50);

            // Apply structure-specific quality cap if defined
            const qualityCap = CONFIG.CONSTRUCTION.STRUCTURE_QUALITY_CAPS?.[constructionSite.targetStructure];
            if (qualityCap) {
                structureQuality = Math.min(structureQuality, qualityCap);
            }

            // Remove construction site
            await this.chunkManager.addObjectChange(fullChunkId, {
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
            // NOTE: Tent removed - now uses instant build via handlePlaceTent()
            // } else if (constructionSite.targetStructure === 'tent') {
            //     structureScale = 0.5;
            } else if (constructionSite.targetStructure === 'house') {
                structureScale = 1.0;
            } else if (constructionSite.targetStructure === 'campfire') {
                structureScale = 1.0;
            } else if (constructionSite.targetStructure === 'market') {
                structureScale = 1.0;
            } else if (constructionSite.targetStructure === 'tileworks') {
                structureScale = 1.0;
            }

            const structurePosition = [constructionSite.position[0], finalY, constructionSite.position[2]];
            const structureChange = {
                action: 'add',
                id: structureId,
                name: constructionSite.targetStructure,
                position: structurePosition,
                quality: structureQuality,
                lastRepairTime: Date.now(),  // Track when structure was created/last repaired
                scale: structureScale,
                chunkId: fullChunkId,
                totalResources: null,
                remainingResources: null,
                harvestedBy: null,
                harvestStartTime: null,
                rotation: constructionSite.rotation,
                finalFoundationY: finalY,  // Store for terrain leveling when chunk reloads
                owner: constructionSite.owner,  // Transfer ownership from construction site to structure
                materialType: materialType || null  // Track sandstone vs limestone for tinting
            };

            // Initialize lastShipSpawn for docks (set to past time to allow immediate ship spawn)
            if (constructionSite.targetStructure === 'dock') {
                structureChange.lastShipSpawn = Date.now() - (30 * 60 * 1000);
            }

            // For houses, gardens, campfires, tileworks, and markets, initialize inventory (like crates)
            if (constructionSite.targetStructure === 'house' ||
                constructionSite.targetStructure === 'garden' ||
                constructionSite.targetStructure === 'campfire' ||
                constructionSite.targetStructure === 'tileworks' ||
                constructionSite.targetStructure === 'market') {

                if (constructionSite.targetStructure === 'market') {
                    // Markets use quantities instead of items grid
                    const defaultQuantity = 0;
                    // New market inventory format: items[itemType][key] = count
                    // Key is "quality" for materials, "quality,durability" for tools/food
                    const defaultQuality = CONFIG.MARKET.DEFAULT_QUALITY;
                    const defaultDurability = CONFIG.MARKET.DEFAULT_DURABILITY;
                    const durabilityItems = CONFIG.MARKET.DURABILITY_ITEMS;

                    const marketItems = {};
                    for (const itemType of CONFIG.MARKET.ALL_ITEMS) {
                        if (durabilityItems.includes(itemType)) {
                            // Tools/Food: key is "quality,durability"
                            marketItems[itemType] = {
                                [`${defaultQuality},${defaultDurability}`]: defaultQuantity
                            };
                        } else {
                            // Materials: key is just "quality"
                            marketItems[itemType] = {
                                [defaultQuality]: defaultQuantity
                            };
                        }
                    }

                    structureChange.inventory = {
                        items: marketItems
                    };
                } else {
                    structureChange.inventory = { items: [] };
                }

                // Initialize lastSpawnTick for gardens so they can spawn vegetables
                if (constructionSite.targetStructure === 'garden') {
                    structureChange.lastSpawnTick = this.serverTick || 0;
                }
            }

            await this.chunkManager.addObjectChange(fullChunkId, structureChange);

            // Handle house ownership - players can only own one house at a time
            if (constructionSite.targetStructure === 'house' && constructionSite.owner && this.authManager) {
                // Check if player already owns a house
                const existingHouse = await this.authManager.getOwnedHouse(constructionSite.owner);

                if (existingHouse.houseId && existingHouse.chunkId) {
                    // Clear ownership of old house
                    const oldHouse = await this.chunkManager.clearHouseOwnershipById(
                        existingHouse.chunkId,
                        existingHouse.houseId
                    );

                    if (oldHouse) {
                        // Broadcast ownership cleared to nearby players
                        this.messageRouter.broadcastTo3x3Grid(existingHouse.chunkId, {
                            type: 'object_added',
                            payload: {
                                chunkId: existingHouse.chunkId,
                                objectId: existingHouse.houseId,
                                objectType: 'house',
                                position: oldHouse.position,
                                quality: oldHouse.quality,
                                scale: oldHouse.scale || 1,
                                rotation: oldHouse.rotation || 0,
                                owner: null  // Ownership cleared
                            }
                        });
                    }
                }

                // Set new house as player's owned house
                await this.authManager.setOwnedHouse(constructionSite.owner, structureId, fullChunkId);

                // Also set as player's home spawn point
                const homeX = constructionSite.position[0];
                const homeZ = constructionSite.position[2];
                await this.authManager.setHome(constructionSite.owner, structureId, homeX, homeZ);

                // Notify client their home was set
                this.messageRouter.sendToAccount(constructionSite.owner, {
                    type: 'home_set',
                    payload: {
                        structureId: structureId,
                        x: homeX,
                        z: homeZ
                    }
                });
            }

            // Broadcast removal and addition
            this.messageRouter.broadcastTo3x3Grid(fullChunkId, {
                type: 'object_removed',
                payload: { chunkId: fullChunkId, objectId: constructionId }
            });

            // Calculate durability values for broadcast
            const durabilityInfo = enrichStructureWithDurability(structureChange);

            // Look up owner name for display
            const ownerName = structureChange.owner && this.authManager ?
                await this.authManager.getUsernameById(structureChange.owner) : null;

            const addedPayload = {
                chunkId: fullChunkId,
                objectId: structureId,
                objectType: constructionSite.targetStructure,
                position: structurePosition,
                quality: structureQuality,
                currentDurability: durabilityInfo.currentDurability,
                hoursUntilRuin: durabilityInfo.hoursUntilRuin,
                scale: structureScale,
                rotation: constructionSite.rotation,
                totalResources: null,
                materialType: materialType || null,  // Pass through for sandstone tinting
                remainingResources: null,
                owner: structureChange.owner,  // Include owner in broadcast
                ownerName: ownerName  // Include display name
            };

            // Include inventory for houses, gardens, campfires, tileworks, and markets
            if (constructionSite.targetStructure === 'house' ||
                constructionSite.targetStructure === 'garden' ||
                constructionSite.targetStructure === 'campfire' ||
                constructionSite.targetStructure === 'tileworks' ||
                constructionSite.targetStructure === 'market') {

                if (constructionSite.targetStructure === 'market') {
                    // Markets use NEW format: items[itemType][key] = count
                    // Use the same inventory that was saved to disk
                    addedPayload.inventory = structureChange.inventory;
                } else {
                    addedPayload.inventory = { items: [] };
                }
            }

            this.messageRouter.broadcastTo3x3Grid(fullChunkId, {
                type: 'object_added',
                payload: addedPayload
            });
        } catch (error) {
            console.error('ERROR in build_construction:', error);
        }
    }

    /**
     * Handle update_construction_materials message
     * Updates the materials and quality tracking for a construction site
     */
    async handleUpdateConstructionMaterials(payload) {
        try {
            const { constructionId, chunkKey, materials } = payload;
            const fullChunkId = `chunk_${chunkKey}`;
            const chunkData = await this.chunkManager.loadChunk(fullChunkId);

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
            await this.chunkManager.saveChunk(fullChunkId);
        } catch (error) {
            console.error('ERROR in update_construction_materials:', error);
        }
    }

    // ==========================================
    // INVENTORY LOCKING SYSTEM
    // ==========================================

    /**
     * Lock timeout in milliseconds (60 seconds)
     * If a player holds a lock longer than this without activity, it can be taken
     */
    static LOCK_TIMEOUT = 60000;

    /**
     * Check if a structure's lock is stale (timed out)
     * @param {object} structure - The structure object
     * @returns {boolean} True if lock is stale or doesn't exist
     */
    isLockStale(structure) {
        if (!structure.lockedBy) return true;
        const lockAge = Date.now() - (structure.lockTime || 0);
        return lockAge > MessageHandlers.LOCK_TIMEOUT;
    }

    /**
     * Handle lock_inventory message
     * Attempts to acquire exclusive lock on a structure's inventory
     * Returns inventory data if lock acquired successfully
     */
    async handleLockInventory(ws, payload) {
        try {
            const { structureId, chunkId, position, scale, rotation } = payload;
            const clientId = ws.clientId;

            let structure = await this.chunkManager.findObjectChange(chunkId, structureId);

            // APPLE TREE FIRST-TIME INTERACTION: Initialize with full inventory
            if (!structure && structureId.includes('_apple_')) {
                console.log(`First interaction with apple tree ${structureId} - initializing with 9 apples`);
                structure = await this.spawnTasks.initializeAppleTree(structureId, chunkId, position, scale, rotation);
            }

            if (!structure) {
                ws.send(JSON.stringify({
                    type: 'inventory_lock_response',
                    payload: {
                        structureId,
                        success: false,
                        reason: 'Structure not found'
                    }
                }));
                return;
            }

            // Check ownership for houses
            if (structure.name === 'house' && structure.owner) {
                if (structure.owner !== clientId && structure.owner !== ws.accountId) {
                    ws.send(JSON.stringify({
                        type: 'inventory_lock_response',
                        payload: {
                            structureId,
                            success: false,
                            reason: 'Only the house owner can access this inventory'
                        }
                    }));
                    return;
                }
            }

            // Check if already locked by someone else
            if (structure.lockedBy && structure.lockedBy !== clientId && !this.isLockStale(structure)) {
                ws.send(JSON.stringify({
                    type: 'inventory_lock_response',
                    payload: {
                        structureId,
                        success: false,
                        reason: 'This storage is being used by another player'
                    }
                }));
                return;
            }

            // Acquire lock
            structure.lockedBy = clientId;
            structure.lockTime = Date.now();

            // Save the lock state
            await this.chunkManager.saveChunk(chunkId);

            // Get inventory data - use appropriate default based on structure type
            let inventory;
            if (structure.name === 'market') {
                // Markets use object format: items[itemType][key] = count
                inventory = structure.inventory || { items: {} };
                if (!inventory.items || Array.isArray(inventory.items)) {
                    inventory.items = {};
                }
            } else {
                // Other structures use array format: items[]
                inventory = structure.inventory || { items: [] };
            }

            ws.send(JSON.stringify({
                type: 'inventory_lock_response',
                payload: {
                    structureId,
                    success: true,
                    inventory: inventory,
                    lockTime: structure.lockTime
                }
            }));

        } catch (error) {
            console.error('ERROR in lock_inventory:', error);
            ws.send(JSON.stringify({
                type: 'inventory_lock_response',
                payload: {
                    structureId: payload.structureId,
                    success: false,
                    reason: 'Server error'
                }
            }));
        }
    }

    /**
     * Handle unlock_inventory message
     * Releases the lock on a structure's inventory
     */
    async handleUnlockInventory(ws, payload) {
        try {
            const { structureId, chunkId } = payload;
            const clientId = ws.clientId;

            const structure = await this.chunkManager.findObjectChange(chunkId, structureId);

            if (!structure) {
                return;
            }

            // Only unlock if we hold the lock
            if (structure.lockedBy === clientId) {
                structure.lockedBy = null;
                structure.lockTime = null;
                await this.chunkManager.saveChunk(chunkId);
            }

        } catch (error) {
            console.error('ERROR in unlock_inventory:', error);
        }
    }

    /**
     * Handle confirm_lock message
     * Double-checks that client still holds the lock (race condition prevention)
     */
    async handleConfirmLock(ws, payload) {
        try {
            const { structureId, chunkId } = payload;
            const clientId = ws.clientId;

            const structure = await this.chunkManager.findObjectChange(chunkId, structureId);

            if (!structure) {
                ws.send(JSON.stringify({
                    type: 'lock_confirm_response',
                    payload: { structureId, confirmed: false, reason: 'Structure not found' }
                }));
                return;
            }

            const stillHoldsLock = structure.lockedBy === clientId && !this.isLockStale(structure);

            if (stillHoldsLock) {
                // Refresh lock time
                structure.lockTime = Date.now();
                await this.chunkManager.saveChunk(chunkId);
            }

            ws.send(JSON.stringify({
                type: 'lock_confirm_response',
                payload: {
                    structureId,
                    confirmed: stillHoldsLock,
                    reason: stillHoldsLock ? null : 'Lock no longer held'
                }
            }));

        } catch (error) {
            console.error('ERROR in confirm_lock:', error);
            ws.send(JSON.stringify({
                type: 'lock_confirm_response',
                payload: { structureId: payload.structureId, confirmed: false, reason: 'Server error' }
            }));
        }
    }

    /**
     * Release all locks held by a specific client
     * Called when a client disconnects
     * @param {string} clientId - The client ID whose locks should be released
     */
    async releaseAllLocksForClient(clientId) {
        try {
            const loadedChunks = this.chunkManager.getCachedChunkIds();
            let locksReleased = 0;

            for (const chunkId of loadedChunks) {
                const chunkData = await this.chunkManager.loadChunk(chunkId);
                if (!chunkData?.objectChanges) continue;

                let chunkModified = false;

                for (const obj of chunkData.objectChanges) {
                    if (obj.lockedBy === clientId) {
                        obj.lockedBy = null;
                        obj.lockTime = null;
                        chunkModified = true;
                        locksReleased++;
                    }
                }

                if (chunkModified) {
                    await this.chunkManager.saveChunk(chunkId);
                }
            }

        } catch (error) {
            console.error('ERROR in releaseAllLocksForClient:', error);
        }
    }

    /**
     * Handle get_crate_inventory message (also handles houses, gardens, apple trees)
     */
    async handleGetCrateInventory(ws, payload) {
        try {
            const { crateId, chunkId, position, scale, rotation } = payload;
            let crateChange = await this.chunkManager.findObjectChange(chunkId, crateId);

            // APPLE TREE FIRST-TIME INTERACTION: Initialize with full inventory
            // Match both planted trees (planted_apple_*) and natural trees (*_apple_* like 0,0_apple_3)
            if (!crateChange && crateId.includes('apple')) {
                console.log(`First interaction with apple tree ${crateId} - initializing with 9 apples`);
                crateChange = await this.spawnTasks.initializeAppleTree(crateId, chunkId, position, scale, rotation);
            }

            // Check ownership for houses
            if (crateChange && crateChange.name === 'house' && crateChange.owner) {
                // Get the requesting client's ID
                const requestingClientId = ws.clientId;

                // Check if the requesting client owns the house
                if (crateChange.owner !== requestingClientId) {
                    // Not the owner - send access denied
                    ws.send(JSON.stringify({
                        type: 'crate_inventory_response',
                        payload: {
                            crateId,
                            inventory: { items: [] },
                            accessDenied: true,
                            message: 'Only the house owner can access this inventory'
                        }
                    }));
                    return;
                }
            }

            let crateInventory = { items: [] };
            if (crateChange && crateChange.inventory) {
                crateInventory = crateChange.inventory;
            }

            // Build response payload
            const responsePayload = { crateId, inventory: crateInventory };

            // For gardens and apple trees, include spawning data for client-side calculation
            if (crateChange && (crateChange.name === 'garden' || crateChange.name === 'apple')) {
                responsePayload.structureType = crateChange.name;
                responsePayload.quality = crateChange.quality || 50;
                responsePayload.lastSpawnTick = crateChange.lastSpawnTick || 0;
                responsePayload.serverTick = this.serverTick || 0;
            }

            ws.send(JSON.stringify({
                type: 'crate_inventory_response',
                payload: responsePayload
            }));
        } catch (error) {
            console.error('ERROR in get_crate_inventory:', error);
        }
    }

    /**
     * Handle save_crate_inventory message (also handles houses)
     */
    async handleSaveCrateInventory(ws, payload) {
        try {
            const { crateId, chunkId, inventory } = payload;
            const clientId = ws.clientId;
            const chunkData = await this.chunkManager.loadChunk(chunkId);

            const crateIndex = chunkData.objectChanges.findIndex(c => c.id === crateId && c.action === 'add');

            if (crateIndex !== -1) {
                const structure = chunkData.objectChanges[crateIndex];

                // BUGFIX: Markets should never receive save_crate_inventory
                // They use buy_item/sell_item for inventory changes
                if (structure.name === 'market') {
                    console.error(`[save_crate_inventory] REJECTED: Cannot save array inventory to market ${crateId}`);
                    return;
                }

                // Check if client holds the lock (new locking system)
                if (structure.lockedBy && structure.lockedBy !== clientId) {
                    ws.send(JSON.stringify({
                        type: 'crate_save_denied',
                        payload: {
                            crateId,
                            message: 'You do not have access to this inventory'
                        }
                    }));
                    return;
                }

                // Check ownership for houses
                if (structure.name === 'house' && structure.owner) {
                    const requestingClientId = ws.clientId;

                    // Check if the requesting client owns the house
                    if (structure.owner !== requestingClientId && structure.owner !== ws.accountId) {
                        // Send error response
                        ws.send(JSON.stringify({
                            type: 'crate_save_denied',
                            payload: {
                                crateId,
                                message: 'Only the house owner can modify this inventory'
                            }
                        }));
                        return;
                    }
                }

                // Refresh lock time on save (keeps lock alive during active use)
                if (structure.lockedBy === clientId) {
                    structure.lockTime = Date.now();
                }

                // Stamp firewood with placedAtTick for tick-based depletion tracking
                const isBurningStructure = structure.name === 'campfire' || structure.name === 'house' || structure.name === 'tileworks';
                if (isBurningStructure && inventory && Array.isArray(inventory.items)) {
                    const firewoodTypes = ['oakfirewood', 'pinefirewood', 'firfirewood', 'cypressfirewood', 'applefirewood'];
                    for (const item of inventory.items) {
                        if (firewoodTypes.includes(item.type) && !item.placedAtTick) {
                            item.placedAtTick = this.serverTick || 0;
                        }
                    }
                }

                // Update lastSpawnTick for gardens and apple trees (client-driven spawning)
                const isSpawningStructure = structure.name === 'garden' || structure.name === 'apple';
                if (isSpawningStructure) {
                    structure.lastSpawnTick = this.serverTick || 0;
                }

                structure.inventory = inventory;
                await this.chunkManager.saveChunk(chunkId);

                this.messageRouter.broadcastTo3x3Grid(chunkId, {
                    type: 'crate_inventory_updated',
                    payload: { crateId, inventory }
                });

                // Check for campfire cooking (tick-based)
                if (structure.name === 'campfire' && this.cookingSystem) {
                    this.cookingSystem.checkForCookableItems(crateId, chunkId, inventory, 'campfire');
                }

                // Check for house cooking (same as campfire, tick-based)
                if (structure.name === 'house' && this.cookingSystem) {
                    this.cookingSystem.checkForCookableItems(crateId, chunkId, inventory, 'house');
                }

                // Check for tileworks processing
                if (structure.name === 'tileworks' && this.tileworksSystem) {
                    this.tileworksSystem.checkForProcessableItems(crateId, chunkId, inventory);
                }
            } else {
                console.error(`Storage structure ${crateId} not found in chunk ${chunkId}`);
            }
        } catch (error) {
            console.error('ERROR in save_crate_inventory:', error);
        }
    }

    /**
     * Handle buy_item message - player purchases item from market
     * New format: buys specific quality (and durability for tools/food)
     */
    async handleBuyItem(ws, payload) {
        try {
            const { marketId, chunkId, itemType, quality, durability, transactionId } = payload;

            // Find market
            const marketChange = await this.chunkManager.findObjectChange(chunkId, marketId);
            if (!marketChange || !marketChange.inventory) {
                console.error(`Market ${marketId} not found or has no inventory`);
                return;
            }

            const inventory = marketChange.inventory;
            const durabilityItems = CONFIG.MARKET.DURABILITY_ITEMS;
            const hasDurability = durabilityItems.includes(itemType);

            // Ensure items object exists for this type
            if (!inventory.items[itemType]) {
                console.error(`Item type ${itemType} not found in market`);
                return;
            }

            // Build the key based on whether item has durability
            const key = hasDurability
                ? `${Math.floor(quality)},${Math.floor(durability || 50)}`
                : `${Math.floor(quality)}`;

            // Check if item exists at this key
            const currentCount = inventory.items[itemType][key] || 0;
            if (currentCount < 1) {
                console.error(`No ${itemType} at ${key} in market. Available: ${currentCount}`);
                return;
            }

            // Decrease count
            inventory.items[itemType][key] = currentCount - 1;

            // Clean up if count reaches 0
            if (inventory.items[itemType][key] <= 0) {
                delete inventory.items[itemType][key];
            }

            // Save to disk
            await this.chunkManager.saveChunk(chunkId);

            // Broadcast updated inventory to all players near the market
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'market_inventory_updated',
                payload: {
                    marketId,
                    items: inventory.items,
                    transactionId: transactionId || null
                }
            });
        } catch (error) {
            console.error('ERROR in buy_item:', error);
        }
    }

    /**
     * Handle sell_item message - player sells item to market
     * New format: stores exact quality (and durability for tools/food)
     */
    async handleSellItem(ws, payload) {
        try {
            const { marketId, chunkId, itemType, quality, durability, transactionId } = payload;

            // Find market
            const marketChange = await this.chunkManager.findObjectChange(chunkId, marketId);
            if (!marketChange) {
                console.error(`Market ${marketId} not found`);
                return;
            }

            // Initialize inventory if missing (handles legacy markets)
            if (!marketChange.inventory) {
                console.log(`Initializing missing inventory for market ${marketId}`);
                marketChange.inventory = { items: {} };
            }
            if (!marketChange.inventory.items) {
                marketChange.inventory.items = {};
            }

            const inventory = marketChange.inventory;
            const durabilityItems = CONFIG.MARKET.DURABILITY_ITEMS;
            const hasDurability = durabilityItems.includes(itemType);

            // Ensure items object exists for this type
            if (!inventory.items[itemType]) {
                inventory.items[itemType] = {};
            }

            // Build the key based on whether item has durability
            const key = hasDurability
                ? `${Math.floor(quality)},${Math.floor(durability || 50)}`
                : `${Math.floor(quality)}`;

            // Increment count at this key
            const currentCount = inventory.items[itemType][key] || 0;
            inventory.items[itemType][key] = currentCount + 1;

            // Save to disk
            await this.chunkManager.saveChunk(chunkId);

            // Broadcast updated inventory to all players near the market
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'market_inventory_updated',
                payload: {
                    marketId,
                    items: inventory.items,
                    transactionId: transactionId || null
                }
            });
        } catch (error) {
            console.error('ERROR in sell_item:', error);
        }
    }

    /**
     * Handle remove_object_request message (includes cascade deletion logic)
     */
    async handleRemoveObject(payload) {
        const { chunkId, objectId, name, position, quality, scale, objectData } = payload;
        const chunkData = await this.chunkManager.loadChunk(chunkId);

        // Check if this object exists with ANY action (add or remove)
        let objectIndex = chunkData.objectChanges.findIndex(c => c.id === objectId);

        // If not found and objectData provided, this is a natural object on first interaction
        if (objectIndex === -1 && objectData) {
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
            await this.chunkManager.saveChunk(chunkId);
            objectIndex = chunkData.objectChanges.length - 1;
        }

        // Now add the remove change
        const change = { action: 'remove', id: objectId, name, position, quality, scale, chunkId };
        await this.chunkManager.addObjectChange(chunkId, change);

        this.messageRouter.broadcastTo3x3Grid(chunkId, {
            type: 'object_removed',
            payload: { chunkId, objectId, name, position, quality, scale }
        });
    }

    /**
     * Handle harvest_resource_request message
     */
    async handleHarvestResource(payload) {
        try {
            const { chunkId, objectId, harvestType, clientId, objectData } = payload;
            const chunkData = await this.chunkManager.loadChunk(chunkId);

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
                    return;
                } else {
                    // Lock timed out - clear stale lock
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

                await this.chunkManager.saveChunk(chunkId);

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
        this.messageRouter.forwardMessage(senderId, recipientId, rawMessage);
    }

    // NOTE: Firewood depletion methods removed - now handled client-side via tick-based calculation
    // See CrateInventoryUI._calculateFirewoodDurability() and _checkAndRemoveDepletedFirewood()

    // NOTE: processCooking() removed - cooking now handled client-side via tick calculation
    // Client sends 'cooking_complete' message when item is ready

    /**
     * Handle cooking_complete message from client
     * Validates and transforms cooked item
     */
    async handleCookingComplete(ws, payload) {
        const { structureId, itemId, chunkId } = payload;

        if (!structureId || !itemId || !chunkId) {
            console.error('[COOKING] Invalid cooking_complete payload:', payload);
            return;
        }

        if (!this.cookingSystem) {
            console.error('[COOKING] CookingSystem not initialized');
            return;
        }

        const result = await this.cookingSystem.completeCooking(structureId, itemId, chunkId);

        if (!result.success) {
            console.log(`[COOKING] Cooking completion rejected for ${itemId}: ${result.error}`);
            // Could send error back to client if needed
        }
    }

    /**
     * Handle processing_complete message from client (for tileworks)
     * Validates and transforms processed item
     */
    async handleProcessingComplete(ws, payload) {
        const { structureId, itemId, chunkId } = payload;

        if (!structureId || !itemId || !chunkId) {
            console.error('[TILEWORKS] Invalid processing_complete payload:', payload);
            return;
        }

        if (!this.tileworksSystem) {
            console.error('[TILEWORKS] TileworksSystem not initialized');
            return;
        }

        const result = await this.tileworksSystem.completeProcessing(structureId, itemId, chunkId);

        if (!result.success) {
            console.log(`[TILEWORKS] Processing completion rejected for ${itemId}: ${result.error}`);
            // Could send error back to client if needed
        }
    }

    // NOTE: processTileworks() removed - processing now handled client-side via tick calculation
    // Client sends 'processing_complete' message when item is ready

    /**
     * Clean up stale players from chunk files
     * Called by TimeTrackerService every minute
     */
    async cleanupStalePlayers() {
        try {
            for (const chunkId of this.chunkManager.getCachedChunkIds()) {
                const chunkData = this.chunkManager.getChunk(chunkId);
                if (!chunkData || !chunkData.players) continue;

                const playersToRemove = [];

                chunkData.players.forEach(player => {
                    const clientData = this.clients.get(player.id);
                    // Check if client is disconnected or WebSocket is not open
                    if (!clientData || !clientData.ws || clientData.ws.readyState !== 1) { // 1 = OPEN
                        playersToRemove.push(player.id);
                    }
                });

                if (playersToRemove.length > 0) {
                    chunkData.players = chunkData.players.filter(p => !playersToRemove.includes(p.id));
                    await this.chunkManager.saveChunk(chunkId);
                    this.messageRouter.queueProximityUpdate(chunkId);
                }
            }
        } catch (error) {
            console.error('ERROR in cleanupStalePlayers:', error);
        }
    }

    // NOTE: processTreeGrowth() removed - tree growth now handled client-side via tick calculation
    // Client calculates scale from plantedAtTick and sends 'tree_growth_complete' when done

    /**
     * Handle tree_growth_complete message from client
     * Validates and marks tree as fully grown
     */
    async handleTreeGrowthComplete(ws, payload) {
        const { treeId, chunkId } = payload;

        if (!treeId || !chunkId) {
            console.error('[TREE GROWTH] Invalid tree_growth_complete payload:', payload);
            return;
        }

        try {
            const chunkData = await this.chunkManager.loadChunk(chunkId);
            if (!chunkData?.objectChanges) return;

            const treeIndex = chunkData.objectChanges.findIndex(
                obj => obj.id === treeId && obj.action === 'add'
            );

            if (treeIndex === -1) {
                console.warn(`[TREE GROWTH] Tree ${treeId} not found in chunk ${chunkId}`);
                return;
            }

            const tree = chunkData.objectChanges[treeIndex];

            // Validate tree was growing and enough ticks elapsed
            if (!tree.isGrowing || !tree.plantedAtTick) {
                return;
            }

            const ticksElapsed = (this.serverTick || 0) - tree.plantedAtTick;
            const requiredTicks = tree.growthDurationTicks || 1800;
            const tolerance = 10; // Allow 10 tick tolerance

            if (ticksElapsed < requiredTicks - tolerance) {
                return;
            }

            // Mark tree as fully grown
            tree.isGrowing = false;
            tree.scale = 1.0;
            delete tree.plantedAtTick;
            delete tree.growthDurationTicks;

            await this.chunkManager.saveChunk(chunkId, chunkData);

            // Broadcast to nearby clients
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'tree_growth_complete',
                payload: { treeId, chunkId }
            });

        } catch (error) {
            console.error('[TREE GROWTH] Error completing tree growth:', error);
        }
    }

    /**
     * Get all chunks that have active players (for optimization)
     * @returns {Array<string>} Array of active chunk IDs
     */
    getActiveChunks() {
        const activeChunks = new Set();
        const renderDistance = 2; // Process chunks within 2 chunks of any player

        for (const [clientId, clientData] of this.clients) {
            if (clientData.currentChunk) {
                // Remove 'chunk_' prefix before parsing coordinates
                const [x, z] = clientData.currentChunk.replace('chunk_', '').split(',').map(Number);

                for (let dx = -renderDistance; dx <= renderDistance; dx++) {
                    for (let dz = -renderDistance; dz <= renderDistance; dz++) {
                        activeChunks.add(`${x + dx},${z + dz}`);
                    }
                }
            }
        }

        return Array.from(activeChunks);
    }

    /**
     * Handle repair_structure message (Phase 2: Repair System)
     * Repairs a structure by resetting lastRepairTime and averaging quality with materials
     */
    async handleRepairStructure(payload) {
        try {
            const { structureId, chunkKey, materials } = payload;
            const fullChunkId = `chunk_${chunkKey}`;
            const chunkData = await this.chunkManager.loadChunk(fullChunkId);

            if (!chunkData || !chunkData.objectChanges) {
                console.error(`[repair_structure] Chunk ${fullChunkId} not found`);
                return;
            }

            // Find the structure in chunk data
            const structure = chunkData.objectChanges.find(obj =>
                obj.id === structureId && obj.action === 'add'
            );

            if (!structure) {
                console.error(`[repair_structure] Structure ${structureId} not found in chunk ${fullChunkId}`);
                return;
            }

            // Validate materials array
            if (!materials || materials.length === 0) {
                console.error(`[repair_structure] No materials provided for repair`);
                return;
            }

            // Calculate new quality as weighted average
            const currentQuality = structure.quality || 50;
            const currentWeight = 1; // Structure's current quality counts as 1 unit
            const materialWeight = materials.length; // Each material counts as 1 unit

            let materialQualitySum = 0;
            materials.forEach(mat => {
                materialQualitySum += (mat.quality || 50);
            });

            const materialAvgQuality = materialQualitySum / materials.length;

            // Weighted average: (current * 1 + materials * count) / (1 + count)
            let newQuality = clampQuality(
                Math.round((currentQuality * currentWeight + materialAvgQuality * materialWeight) / (currentWeight + materialWeight))
            );

            // Apply structure-specific quality cap if defined
            const qualityCap = CONFIG.CONSTRUCTION.STRUCTURE_QUALITY_CAPS?.[structure.name];
            if (qualityCap) {
                newQuality = Math.min(newQuality, qualityCap);
            }

            // Update structure quality and reset repair time
            structure.quality = newQuality;
            structure.lastRepairTime = Date.now();

            // Save chunk
            await this.chunkManager.saveChunk(fullChunkId, chunkData);

            // Calculate new durability values for broadcast
            const durabilityInfo = enrichStructureWithDurability(structure);

            // Broadcast repair update to all clients in 3x3 grid
            this.messageRouter.broadcastTo3x3Grid(fullChunkId, {
                type: 'structure_repaired',
                payload: {
                    chunkId: fullChunkId,
                    structureId: structureId,
                    quality: newQuality,
                    currentDurability: durabilityInfo.currentDurability,
                    hoursUntilRuin: durabilityInfo.hoursUntilRuin
                }
            });
        } catch (error) {
            console.error('ERROR in repair_structure:', error);
        }
    }

    /**
     * Find a house or tent owned by a player (for setting home after account upgrade)
     * Returns the most recently built structure
     * @param {string} ownerId - Player's account ID
     * @returns {Promise<{id: string, x: number, z: number}|null>}
     */
    async findOwnedHome(ownerId) {
        try {
            const chunkFiles = this.chunkManager.getAllChunkFiles();
            let mostRecent = null;

            for (const chunkFile of chunkFiles) {
                // Keep chunk_ prefix - loadChunk expects format like "chunk_0,0"
                const chunkId = chunkFile.replace('.JSON', '');
                const chunkData = await this.chunkManager.loadChunk(chunkId);
                if (!chunkData?.objectChanges) continue;

                for (const obj of chunkData.objectChanges) {
                    // Look for house or tent owned by this player
                    if (obj.owner === ownerId && (obj.name === 'house' || obj.name === 'tent')) {
                        const buildTime = obj.lastRepairTime || 0;
                        if (!mostRecent || buildTime > mostRecent.buildTime) {
                            mostRecent = {
                                id: obj.id,
                                name: obj.name,
                                x: obj.position[0],
                                z: obj.position[2],
                                buildTime: buildTime
                            };
                        }
                    }
                }
            }

            if (mostRecent) {
                return {
                    id: mostRecent.id,
                    x: mostRecent.x,
                    z: mostRecent.z
                };
            }

            return null;
        } catch (error) {
            console.error('ERROR in findOwnedHome:', error);
            return null;
        }
    }

    /**
     * Transfer ownership of all structures from one clientId to another
     * Used when a guest player registers and gets an account ID
     */
    async transferStructureOwnership(fromClientId, toAccountId) {
        try {
            // Get all chunk files
            const chunkFiles = this.chunkManager.getAllChunkFiles();
            let structuresTransferred = 0;

            for (const chunkFile of chunkFiles) {
                // Keep chunk_ prefix - loadChunk expects format like "chunk_0,0"
                const chunkId = chunkFile.replace('.JSON', '');

                const chunkData = await this.chunkManager.loadChunk(chunkId);
                if (!chunkData?.objectChanges) continue;

                let chunkModified = false;

                // Check each object for ownership
                for (const obj of chunkData.objectChanges) {
                    // Transfer ownership if this object belongs to the old client ID
                    if (obj.owner === fromClientId) {
                        obj.owner = toAccountId;
                        chunkModified = true;
                        structuresTransferred++;
                    }
                }

                // Save chunk if any structures were updated
                if (chunkModified) {
                    await this.chunkManager.saveChunk(chunkId, chunkData);
                }
            }

            return structuresTransferred;
        } catch (error) {
            console.error('ERROR in transferStructureOwnership:', error);
            return 0;
        }
    }

    /**
     * Handle convert_to_ruin message from client
     * Client has calculated that a structure's durability reached 0
     * Server trusts client, converts structure to ruin, broadcasts
     */
    async handleConvertToRuin(ws, payload) {
        try {
            const { structureId, chunkId } = payload;

            const chunkData = await this.chunkManager.loadChunk(chunkId);
            if (!chunkData || !chunkData.objectChanges) {
                return;
            }

            // Find the structure
            const structureIndex = chunkData.objectChanges.findIndex(
                obj => obj.id === structureId && obj.action === 'add'
            );

            if (structureIndex === -1) {
                // Structure already removed (another client beat us)
                return;
            }

            const structure = chunkData.objectChanges[structureIndex];

            // Skip if already a ruin or construction site
            if (structure.isRuin || structure.isConstructionSite) {
                return;
            }

            // Skip bandit structures - they don't decay
            if (structure.isBanditStructure) {
                return;
            }

            // Skip trapper structures - they don't decay
            if (structure.isTrapperStructure) {
                return;
            }

            // Skip roads - they don't decay
            if (structure.name === 'road') {
                return;
            }

            // Determine construction site model for the ruin
            const constructionSiteMapping = {
                'house': 'construction',
                'crate': 'construction',
                'garden': 'construction',
                'tent': 'construction',
                'campfire': 'construction',
                'market': '2x8construction',
                'dock': '10x1construction',
                'outpost': '10x1construction',
                'tileworks': 'construction'
            };

            const ruinModel = constructionSiteMapping[structure.name];
            if (!ruinModel) {
                // Unknown structure type, just remove it
                chunkData.objectChanges.splice(structureIndex, 1);
                await this.chunkManager.saveChunk(chunkId, chunkData);

                this.messageRouter.broadcastTo3x3Grid(chunkId, {
                    type: 'object_removed',
                    payload: { chunkId, objectId: structureId }
                });
                return;
            }

            // Remove original structure
            chunkData.objectChanges.splice(structureIndex, 1);

            // Create ruin
            const ruinId = `ruin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const ruin = {
                action: 'add',
                id: ruinId,
                name: ruinModel,
                position: structure.position,
                quality: 50,
                lastRepairTime: Date.now(), // Ruin has 1-hour lifespan from now
                scale: structure.scale || 1.0,
                rotation: structure.rotation || 0,
                chunkId: chunkId,
                isConstructionSite: true,
                isRuin: true,
                originalStructure: structure.name,
                targetStructure: null,
                requiredMaterials: {},
                materials: {}
            };

            chunkData.objectChanges.push(ruin);

            // Save chunk
            await this.chunkManager.saveChunk(chunkId, chunkData);

            // Broadcast removal of original structure
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'object_removed',
                payload: { chunkId, objectId: structureId }
            });

            // Broadcast ruin creation
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'object_added',
                payload: {
                    chunkId,
                    objectId: ruinId,
                    objectType: ruinModel,
                    position: ruin.position,
                    quality: 50,
                    currentDurability: 50,
                    hoursUntilRuin: 1.0,
                    scale: ruin.scale,
                    rotation: ruin.rotation,
                    isConstructionSite: true,
                    isRuin: true,
                    targetStructure: null,
                    requiredMaterials: {},
                    materials: {}
                }
            });

            console.log(`[Decay] Client triggered ruin conversion: ${structure.name} (${structureId}) -> ${ruinId}`);

        } catch (error) {
            console.error('ERROR in convert_to_ruin:', error);
        }
    }

    /**
     * Handle remove_ruin message from client
     * Client has calculated that a ruin's 1-hour lifespan expired
     */
    async handleRemoveRuin(ws, payload) {
        try {
            const { structureId, chunkId } = payload;

            const chunkData = await this.chunkManager.loadChunk(chunkId);
            if (!chunkData || !chunkData.objectChanges) {
                return;
            }

            // Find the ruin (can be a ruin OR an expired construction site)
            const ruinIndex = chunkData.objectChanges.findIndex(
                obj => obj.id === structureId && obj.action === 'add' && (obj.isRuin || obj.isConstructionSite)
            );

            if (ruinIndex === -1) {
                // Already removed
                return;
            }

            // Remove the ruin
            chunkData.objectChanges.splice(ruinIndex, 1);
            await this.chunkManager.saveChunk(chunkId, chunkData);

            // Broadcast removal
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'object_removed',
                payload: { chunkId, objectId: structureId }
            });

            console.log(`[Decay] Client triggered ruin removal: ${structureId}`);

        } catch (error) {
            console.error('ERROR in remove_ruin:', error);
        }
    }

    /**
     * Handle trigger_dock_ship message from client
     * Client has calculated that 30 minutes elapsed since lastShipSpawn
     * Server trusts client, updates dock, processes market trade, broadcasts
     */
    async handleTriggerDockShip(ws, payload) {
        try {
            const { dockId, chunkId } = payload;

            const chunkData = await this.chunkManager.loadChunk(chunkId);
            if (!chunkData || !chunkData.objectChanges) {
                console.warn(`[Ship] Chunk ${chunkId} not found or has no objects`);
                return;
            }

            // Find the dock
            const dock = chunkData.objectChanges.find(
                obj => obj.id === dockId && obj.action === 'add' && obj.name === 'dock'
            );

            if (!dock) {
                console.warn(`[Ship] Dock ${dockId} not found in chunk ${chunkId}`);
                return;
            }

            const now = Date.now();

            // Simple duplicate prevention: ignore if lastShipSpawn was updated very recently (within 5 seconds)
            if (dock.lastShipSpawn && (now - dock.lastShipSpawn) < 5000) {
                return;
            }

            // Update lastShipSpawn
            dock.lastShipSpawn = now;

            // Save chunk
            await this.chunkManager.saveChunk(chunkId, chunkData);

            // Broadcast ship spawn event
            this.messageRouter.broadcastTo3x3Grid(chunkId, {
                type: 'dock_ship_spawned',
                payload: {
                    dockId: dock.id,
                    dockPosition: dock.position,
                    dockRotation: dock.rotation,
                    lastShipSpawn: now,
                    chunkId: chunkId
                }
            });

            // Note: Trade processing moved to ship_departing handler (when ship leaves)

            console.log(`[Ship] Client triggered ship spawn at dock ${dockId}`);

        } catch (error) {
            console.error('ERROR in trigger_dock_ship:', error);
        }
    }

    /**
     * Handle ship_departing message from client
     * Client detected ship transitioning from DOCKED to BACKUP phase (starting departure)
     * Closes any open market UIs, then processes trade
     */
    async handleShipDeparting(ws, payload) {
        try {
            const { dockId, chunkId } = payload;

            console.log(`[Ship Trade] Ship departing from dock ${dockId}`);

            const chunkData = await this.chunkManager.loadChunk(chunkId);
            if (!chunkData || !chunkData.objectChanges) {
                console.warn(`[Ship Trade] Chunk ${chunkId} not found`);
                return;
            }

            // Find the dock
            const dock = chunkData.objectChanges.find(
                obj => obj.id === dockId && obj.action === 'add' && obj.name === 'dock'
            );

            if (!dock) {
                console.warn(`[Ship Trade] Dock ${dockId} not found in chunk ${chunkId}`);
                return;
            }

            // Find nearby market to get its ID for closing UIs
            const marketInfo = await this.spawnTasks.findNearestMarketToDock(dock.position);
            if (marketInfo) {
                // Broadcast close_market_for_trade to all clients near this market
                // This will close any player's market UI before the trade modifies inventory
                this.messageRouter.broadcastTo3x3Grid(marketInfo.chunkId, {
                    type: 'close_market_for_trade',
                    payload: {
                        marketId: marketInfo.marketId,
                        reason: 'Ship departing - processing trade'
                    }
                });

                // Small delay to allow clients to process close before trade
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Process ship trading with nearby market
            await this.spawnTasks.processShipTrading(dock, chunkId);

        } catch (error) {
            console.error('ERROR in ship_departing:', error);
        }
    }
}

module.exports = MessageHandlers;

/**
 * MessageRouter.js
 * Centralized routing and handling of all server messages
 * Reduces game.js by ~600 lines by extracting all message handlers
 */

import * as THREE from 'three';
import { CONFIG as TERRAIN_CONFIG } from '../terrain.js';
import { CONFIG } from '../config.js';
import { ui } from '../ui.js';
import { objectPlacer } from '../objects.js';
import { AIEnemy } from '../ai-enemy.js';
import { COLLISION_GROUPS } from '../core/PhysicsManager.js';

export class MessageRouter {
    constructor(game) {
        this.game = game;
        this.gameState = game.gameState;
        this.networkManager = game.networkManager;
        this.scene = game.scene;
        this.terrainRenderer = game.terrainRenderer;
        this.chunkManager = game.chunkManager;
        this.resourceManager = game.resourceManager;
        this.buildingSystem = game.buildingSystem;
        this.craftingSystem = game.craftingSystem;
        this.inventoryUI = game.inventoryUI;
        this.avatarManager = game.avatarManager;

        // Bind all handlers to maintain correct 'this' context
        this.handlers = {
            'server_connected': () => this.handleServerConnected(),
            'webrtc_offer': (payload) => this.handleWebRTCOffer(payload),
            'webrtc_answer': (payload) => this.handleWebRTCAnswer(payload),
            'webrtc_ice_candidate': (payload) => this.handleWebRTCIceCandidate(payload),
            'proximity_update': (payload) => this.handleProximityUpdate(payload),
            'object_removed': (payload) => this.handleObjectRemoved(payload),
            'object_added': (payload) => this.handleObjectAdded(payload),
            'resource_harvested': (payload) => this.handleResourceHarvested(payload),
            'harvest_lock_failed': (payload) => this.handleHarvestLockFailed(payload),
            'chunk_objects_state': (payload) => this.handleChunkObjectsState(payload),
            'crate_inventory_response': (payload) => this.handleCrateInventoryResponse(payload),
            'crate_inventory_updated': (payload) => this.handleCrateInventoryUpdated(payload),
            'market_inventory_updated': (payload) => this.handleMarketInventoryUpdated(payload),
            'garden_item_spawned': (payload) => this.handleGardenItemSpawned(payload)
        };
    }

    /**
     * Main message routing method
     */
    handleMessage(type, payload) {
        const handler = this.handlers[type];
        if (handler) {
            handler(payload);
        }
    }

    /**
     * Handle server connection confirmation
     */
    handleServerConnected() {
        const { chunkSize } = TERRAIN_CONFIG.TERRAIN;
        const initialChunkX = Math.floor(this.game.playerObject.position.x / chunkSize);
        const initialChunkZ = Math.floor(this.game.playerObject.position.z / chunkSize);
        const chunkId = `chunk_${initialChunkX},${initialChunkZ}`;

        const success = this.networkManager.sendMessage('join_chunk', {
            chunkId,
            clientId: this.gameState.clientId
        });

        if (success) {
            this.gameState.isInChunk = true;
            this.gameState.updateChunkPosition(initialChunkX, initialChunkZ);
            ui.updateButtonStates(true, null, null, null, false, false, false, null, this.gameState.isMoving, false);
        }

        // Don't create chunks yet - wait for server state
    }

    /**
     * Handle chunk objects state synchronization
     */
    handleChunkObjectsState(payload) {
        const { objectChanges } = payload;
        if (!objectChanges || !Array.isArray(objectChanges)) return;

        // Group changes by chunk
        const changesByChunk = new Map();

        // IMPORTANT: Process removals FIRST to populate cache before adds are processed
        // This prevents removed natural objects from being recreated
        objectChanges.forEach(change => {
            if (change.action === 'remove') {
                // Handle missing chunkId (old format or corrupted data)
                if (!change.chunkId) {
                    return;
                }

                const chunkKey = change.chunkId.replace('chunk_', '');

                // Add to cache
                if (!this.gameState.removedObjectsCache.has(chunkKey)) {
                    this.gameState.removedObjectsCache.set(chunkKey, new Set());
                }
                this.gameState.removedObjectsCache.get(chunkKey).add(change.id);

                // Track which chunks need removal applied
                changesByChunk.set(chunkKey, true);
            }
        });

        // Now process adds - they will check the cache and skip removed objects
        objectChanges.forEach(change => {
            if (change.action === 'add') {
                this.addObjectFromChange(change);
            }
        });

        // Apply removals to existing chunks
        changesByChunk.forEach((_, chunkKey) => {
            this.chunkManager.applyChunkRemovals(chunkKey);
        });

        // Mark that we've received initial server state
        const wasFirstState = !this.gameState.receivedInitialServerState;
        this.gameState.receivedInitialServerState = true;

        // If this was the first chunk state, process any pending chunk requests
        if (wasFirstState) {
            this.chunkManager.processPendingChunksAfterServerState();

            // If no chunks were queued (player didn't move), create initial chunks
            if (this.terrainRenderer.chunkMap.size === 0) {
                this.chunkManager.updateChunksAroundPlayer(
                    this.gameState.currentPlayerChunkX,
                    this.gameState.currentPlayerChunkZ
                );
            }
        }
    }

    /**
     * Add object from change data
     */
    addObjectFromChange(change) {
        const chunkKey = change.chunkId.replace('chunk_', '');

        // Check if object was recently deleted
        const removedSet = this.gameState.removedObjectsCache.get(chunkKey);
        if (removedSet && removedSet.has(change.id)) {
            return; // Skip this object - it was deleted
        }

        // Check if object already exists in scene
        let existingObject = null;
        this.scene.traverse((object) => {
            // Skip bounding box objects - they're not the actual world objects
            if (object.userData && !object.userData.isBoundingBox && object.userData.objectId === change.id) {
                existingObject = object;
            }
        });

        if (existingObject) {
            // Object already exists - update its properties
            const modelType = change.name || change.objectType;

            // Initialize resources for logs if not present (backwards compatibility)
            if ((modelType === 'log' || modelType.endsWith('_log')) &&
                (change.remainingResources == null || change.totalResources == null)) {
                existingObject.userData.totalResources = 1;
                existingObject.userData.remainingResources = 1;
            } else {
                existingObject.userData.remainingResources = change.remainingResources || null;
                existingObject.userData.totalResources = change.totalResources || null;
            }

            // Update construction site metadata if this is a construction site
            if (change.isConstructionSite) {
                existingObject.userData.isConstructionSite = true;
                existingObject.userData.targetStructure = change.targetStructure;
                existingObject.userData.requiredMaterials = change.requiredMaterials || {};
                existingObject.userData.materials = change.materials || {};
                existingObject.userData.rotation = change.rotation;
                existingObject.userData.finalFoundationY = change.finalFoundationY;
            }

            // Update storage structure inventory if present
            const structureType = change.name || change.objectType;
            if ((structureType === 'crate' || structureType === 'tent' || structureType === 'house' || structureType === 'garden' || structureType === 'market') && change.inventory) {
                existingObject.userData.inventory = change.inventory;
            }
        } else {
            // Create new object
            this.createObjectInScene(change, chunkKey);
        }
    }

    /**
     * Create object in scene from data
     */
    createObjectInScene(data, chunkKey) {
        const objectPosition = new THREE.Vector3(data.position[0], data.position[1], data.position[2]);
        const objectRotation = data.rotation !== undefined ? (data.rotation * Math.PI / 180) : (Math.random() * Math.PI * 2);

        // Store rotation in degrees for reference
        const objectRotationDegrees = data.rotation !== undefined ? data.rotation : (objectRotation * 180 / Math.PI);

        const objectType = data.name || data.objectType;
        const finalModelRotation = objectRotation;

        const objectInstance = objectPlacer.createInstance(
            objectType,
            objectPosition,
            data.scale,
            finalModelRotation,
            this.scene
        );

        if (objectInstance) {
            // Set object metadata
            objectInstance.userData.objectId = data.id || data.objectId;
            objectInstance.userData.chunkKey = chunkKey;
            objectInstance.userData.quality = data.quality;
            objectInstance.userData.modelType = data.name || data.objectType;

            // Initialize resources for logs if not present (backwards compatibility)
            const modelType = data.name || data.objectType;
            if ((modelType === 'log' || modelType.endsWith('_log')) &&
                (data.totalResources == null || data.remainingResources == null)) {
                objectInstance.userData.totalResources = 1;
                objectInstance.userData.remainingResources = 1;
            } else {
                objectInstance.userData.totalResources = data.totalResources || null;
                objectInstance.userData.remainingResources = data.remainingResources || null;
            }

            // Handle construction site metadata
            if (data.isConstructionSite) {
                objectInstance.userData.isConstructionSite = true;
                objectInstance.userData.targetStructure = data.targetStructure;
                objectInstance.userData.requiredMaterials = data.requiredMaterials || {};
                objectInstance.userData.materials = data.materials || {};
                objectInstance.userData.rotation = data.rotation;
                objectInstance.userData.finalFoundationY = data.finalFoundationY;
            }

            // Handle crate/tent/house/garden/market inventory
            const structureType = data.name || data.objectType;
            if ((structureType === 'crate' || structureType === 'tent' || structureType === 'house' || structureType === 'garden' || structureType === 'market') && data.inventory) {
                objectInstance.userData.inventory = data.inventory;
            }

            this.scene.add(objectInstance);

            // Register physics collider ONLY if within physics radius
            if (this.game.physicsManager && this.game.physicsManager.initialized) {
                let withinPhysicsRadius = true; // Default to true if player position not set

                // Only apply physics radius check if we have valid player chunk coordinates
                if (typeof this.gameState.currentPlayerChunkX === 'number' &&
                    typeof this.gameState.currentPlayerChunkZ === 'number' &&
                    !isNaN(this.gameState.currentPlayerChunkX) &&
                    !isNaN(this.gameState.currentPlayerChunkZ)) {

                    const playerChunkX = this.gameState.currentPlayerChunkX;
                    const playerChunkZ = this.gameState.currentPlayerChunkZ;
                    const [objChunkX, objChunkZ] = chunkKey.split(',').map(Number);
                    const chunkDistX = Math.abs(objChunkX - playerChunkX);
                    const chunkDistZ = Math.abs(objChunkZ - playerChunkZ);
                    withinPhysicsRadius = chunkDistX <= CONFIG.CHUNKS.PHYSICS_RADIUS &&
                                           chunkDistZ <= CONFIG.CHUNKS.PHYSICS_RADIUS;
                }

                if (withinPhysicsRadius) {
                    const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[modelType];

                    if (dims) {
                        let shape;
                        let collisionGroup;

                        // Determine shape type
                        if (dims.radius !== undefined) {
                            // Cylinder for trees, rocks (natural objects with radius)
                            shape = {
                                type: 'cylinder',
                                radius: dims.radius,
                                height: dims.height || 1.0
                            };
                            collisionGroup = COLLISION_GROUPS.NATURAL;
                        } else {
                            // Cuboid for structures, logs, crates
                            shape = {
                                type: 'cuboid',
                                width: dims.width,
                                depth: dims.depth,
                                height: dims.height || 1.0
                            };

                            // Determine collision group based on object type
                            if (modelType === 'log' || modelType.endsWith('_log') || modelType === 'crate') {
                                collisionGroup = COLLISION_GROUPS.PLACED;
                            } else {
                                collisionGroup = COLLISION_GROUPS.STRUCTURE;
                            }
                        }

                        // Create static collider
                        const collider = this.game.physicsManager.createStaticCollider(
                            objectInstance.userData.objectId,
                            shape,
                            objectPosition,
                            objectRotation,
                            collisionGroup
                        );

                        // Store handle for cleanup
                        if (collider) {
                            objectInstance.userData.physicsHandle = collider;
                        }
                    }
                }
            }

            // Register ships for animation
            if (data.objectType === 'ship' || data.name === 'ship') {
                this.game.animationSystem.registerShip(objectInstance);
            }

            // Add to chunkObjects for proximity detection
            const chunkObjects = this.terrainRenderer.chunkObjects.get(chunkKey) || [];
            chunkObjects.push(objectInstance);
            this.terrainRenderer.chunkObjects.set(chunkKey, chunkObjects);

            // Update blob shadow
            this.updateBlobShadow(objectInstance, objectPosition);

            // Level terrain for structures that require it (when loading from server)
            // Applies to both final structures AND construction sites
            const structuresToLevel = ['crate', 'house', 'garden', 'outpost', 'tent', 'market'];

            // For construction sites, use targetStructure; for final structures, use structureType
            const typeToCheck = data.isConstructionSite ? data.targetStructure : structureType;

            if (structuresToLevel.includes(typeToCheck) && data.finalFoundationY) {
                const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[typeToCheck];
                if (dims) {
                    this.terrainRenderer.levelTerrainForStructure(
                        objectPosition.x,          // Center X
                        objectPosition.z,          // Center Z
                        dims.width,                // Width from GRID_DIMENSIONS
                        dims.depth,                // Depth from GRID_DIMENSIONS
                        data.finalFoundationY,     // Target height (snapped 4-corner average)
                        typeToCheck,               // Structure type for logging
                        objectRotationDegrees || 0 // Rotation in degrees
                    );
                }
            }

            return objectInstance;
        }

        return null;
    }

    /**
     * Update blob shadow for object
     */
    updateBlobShadow(objectInstance, position) {
        if (objectInstance.userData.blobShadow) {
            const fakeLight = new THREE.Vector3(position.x + 100, 20, position.z);
            objectInstance.userData.blobShadow.update(
                (x, z) => this.terrainRenderer.heightCalculator.calculateHeight(x, z),
                fakeLight,
                (x, z) => {
                    const normal = this.terrainRenderer.heightCalculator.calculateNormal(x, z);
                    return new THREE.Vector3(normal.x, normal.y, normal.z);
                }
            );
        }
    }

    /**
     * Handle object removal
     */
    handleObjectRemoved(payload) {
        // Unregister from animation system if animated
        this.game.animationSystem.unregister(payload.objectId);

        const removed = this.chunkManager.removeObject(payload.objectId);
        if (removed) {
            ui.updateStatus(`Removed object ${payload.objectId} from scene`);
        }

        // Clean up proximity tracking for this object
        if (this.game.activeProximityObjects.has(payload.objectId)) {
            this.game.activeProximityObjects.delete(payload.objectId);
        }

        // Update proximity after server confirms removal
        this.game.checkProximityToObjects();
    }

    /**
     * Handle object addition
     */
    handleObjectAdded(payload) {
        const { objectId, objectType, position, quality, scale, chunkId,
                totalResources, remainingResources, rotation, isConstructionSite,
                targetStructure, requiredMaterials, materials, finalFoundationY, inventory } = payload;

        const chunkKey = chunkId.replace('chunk_', '');

        // Check if object already exists
        let existingObject = null;
        this.scene.traverse((object) => {
            // Skip bounding box objects - they're not the actual world objects
            if (object.userData && !object.userData.isBoundingBox && object.userData.objectId === objectId) {
                existingObject = object;
            }
        });

        if (existingObject) {
            // Update existing object
            existingObject.userData.remainingResources = remainingResources || null;
            existingObject.userData.totalResources = totalResources || null;
            return;
        }

        // Create new object
        const objectInstance = this.createObjectInScene({
            objectId,
            objectType,
            position,
            quality,
            scale,
            rotation,
            isConstructionSite,
            targetStructure,
            requiredMaterials,
            materials,
            finalFoundationY,
            inventory,
            totalResources,
            remainingResources
        }, chunkKey);

        if (objectInstance) {
            ui.updateStatus(`${objectType} spawned in world`);

            // Register ships for animation
            if (objectType === 'ship') {
                this.game.animationSystem.registerShip(objectInstance);
            }

            // Try to spawn AI if this is a tent
            if (objectType === 'tent') {
                this.game.trySpawnAI();
            }
        } else {
            console.error(`Failed to create ${objectType} instance`);
        }

        // Update proximity
        this.game.checkProximityToObjects();
    }

    /**
     * Handle resource harvested
     */
    handleResourceHarvested(payload) {
        // Delegate to ResourceManager
        const result = this.resourceManager.handleResourceHarvested(payload);

        if (!result.handled) {
            return;
        }

        const { resourceObject, depleted, objectId } = result;

        // If depleted, remove from scene
        if (depleted) {
            this.removeDepletedResource(objectId, resourceObject);
        }

        // Trigger proximity check
        this.game.checkProximityToObjects();
    }

    /**
     * Remove depleted resource from scene
     */
    removeDepletedResource(objectId, resourceObject) {
        // Remove physics collider FIRST
        if (this.game.physicsManager) {
            this.game.physicsManager.removeCollider(objectId);
        }

        // Find and remove visual object from scene
        let sceneObject = null;
        this.scene.traverse((object) => {
            // Skip bounding box objects - they're not the actual world objects
            if (object.userData && !object.userData.isBoundingBox && object.userData.objectId === objectId) {
                sceneObject = object;
            }
        });

        if (sceneObject) {
            this.scene.remove(sceneObject);
            // Dispose blob shadow
            if (sceneObject.userData.blobShadow) {
                sceneObject.userData.blobShadow.dispose();
            }
        }

        // Remove from chunkObjects
        const chunkKey = resourceObject.userData.chunkKey;
        const chunkObjects = this.terrainRenderer.chunkObjects.get(chunkKey);
        if (chunkObjects) {
            const index = chunkObjects.indexOf(resourceObject);
            if (index > -1) {
                chunkObjects.splice(index, 1);
            }
        }
    }

    /**
     * Handle harvest lock failure
     */
    handleHarvestLockFailed(payload) {
        // Delegate to ResourceManager
        this.resourceManager.handleHarvestLockFailed(payload);

        // Update proximity to refresh UI
        this.game.checkProximityToObjects();
    }

    /**
     * Handle proximity update from server
     */
    handleProximityUpdate(payload) {
        const { players } = payload;
        ui.updateStatus(`📍 Proximity update: ${players.length} players`);

        const currentPeerIds = new Set(players.map(p => p.id));
        this.networkManager.peerGameData.forEach((_, peerId) => {
            if (!currentPeerIds.has(peerId) && peerId !== this.gameState.clientId) {
                this.networkManager.cleanupPeer(peerId, this.scene);
            }
        });

        const newPlayers = players.filter(
            p => p.id !== this.gameState.clientId && !this.networkManager.peerGameData.has(p.id)
        );

        if (newPlayers.length > 0) {
            this.game.staggerP2PInitiations(newPlayers);
        }
        ui.updatePeerInfo(this.networkManager.p2pTransport.peers, this.networkManager.avatars);
    }

    /**
     * Handle crate inventory response
     */
    handleCrateInventoryResponse(payload) {
        const { crateId, inventory } = payload;

        // Find the crate object
        let crateObject = null;
        this.scene.traverse((object) => {
            // Skip bounding box objects - they're not the actual world objects
            if (object.userData && !object.userData.isBoundingBox && object.userData.objectId === crateId) {
                crateObject = object;
            }
        });

        if (crateObject) {
            // Store inventory in crate userData
            crateObject.userData.inventory = inventory;

            // If this is the nearest structure, update the display
            if (this.gameState.nearestStructure &&
                this.gameState.nearestStructure.userData.objectId === crateId) {
                this.game.crateInventory = inventory;
                this.inventoryUI.renderCrateInventory();
            }
        }
    }

    /**
     * Handle crate inventory update
     */
    handleCrateInventoryUpdated(payload) {
        const { crateId, inventory } = payload;

        // Find the crate object
        let crateObject = null;
        this.scene.traverse((object) => {
            // Skip bounding box objects - they're not the actual world objects
            if (object.userData && !object.userData.isBoundingBox && object.userData.objectId === crateId) {
                crateObject = object;
            }
        });

        if (crateObject) {
            // Update inventory in crate userData
            crateObject.userData.inventory = inventory;

            // If this is the nearest structure and it's open, update display
            if (this.gameState.nearestStructure &&
                this.gameState.nearestStructure.userData.objectId === crateId &&
                this.gameState.inventoryOpen) {
                this.game.crateInventory = inventory;
                this.inventoryUI.renderCrateInventory();
            }
        }
    }

    /**
     * Handle market inventory updated
     */
    handleMarketInventoryUpdated(payload) {
        const { marketId, quantities, qualityAverages, durabilityAverages } = payload;

        // Find the market object
        let marketObject = null;
        this.scene.traverse((object) => {
            // Skip bounding box objects - they're not the actual world objects
            if (object.userData && !object.userData.isBoundingBox && object.userData.objectId === marketId) {
                marketObject = object;
            }
        });

        if (marketObject) {
            // Update inventory in market userData
            if (!marketObject.userData.inventory) {
                marketObject.userData.inventory = {};
            }
            marketObject.userData.inventory.quantities = quantities;
            marketObject.userData.inventory.qualityAverages = qualityAverages;
            marketObject.userData.inventory.durabilityAverages = durabilityAverages;

            // If this is the nearest market and it's open, update display
            if (this.gameState.nearestStructure &&
                this.gameState.nearestStructure.userData.objectId === marketId &&
                this.gameState.inventoryOpen) {
                this.inventoryUI.renderMarketInventory();
            }
        }
    }

    /**
     * Handle garden item spawned
     */
    handleGardenItemSpawned(payload) {
        const { gardenId, item, chunkId } = payload;

        // Find the garden object
        let gardenObject = null;
        this.scene.traverse((object) => {
            // Skip bounding box objects - they're not the actual world objects
            if (object.userData && !object.userData.isBoundingBox && object.userData.objectId === gardenId) {
                gardenObject = object;
            }
        });

        if (gardenObject) {
            // Initialize inventory if needed
            if (!gardenObject.userData.inventory) {
                gardenObject.userData.inventory = { items: [] };
            }

            // Add the new item to the garden's inventory
            gardenObject.userData.inventory.items.push(item);

            // If this is the nearest structure and inventory is open, refresh display
            if (this.gameState.nearestStructure &&
                this.gameState.nearestStructure.userData.objectId === gardenId &&
                this.gameState.inventoryOpen) {
                this.game.crateInventory = gardenObject.userData.inventory;
                this.inventoryUI.renderCrateInventory();
            }

            console.log(`Garden ${gardenId} received spawned item: ${item.type} (Q:${item.quality})`);
        }
    }

    /**
     * Handle WebRTC offer
     */
    async handleWebRTCOffer(payload) {
        if (payload.recipientId !== this.gameState.clientId) return;

        const peerId = payload.senderId;
        this.networkManager.createPeerConnection(peerId, false);

        try {
            const answer = await this.networkManager.p2pTransport.handleOffer(peerId, payload.offer);
            this.networkManager.sendMessage('webrtc_answer', {
                recipientId: peerId,
                senderId: this.gameState.clientId,
                answer
            });
        } catch (error) {
            ui.updateStatus(`❌ Failed to handle offer from ${peerId}: ${error}`);
        }
    }

    /**
     * Handle WebRTC answer
     */
    async handleWebRTCAnswer(payload) {
        if (payload.recipientId !== this.gameState.clientId) return;

        try {
            await this.networkManager.p2pTransport.handleAnswer(payload.senderId, payload.answer);
        } catch (error) {
            ui.updateStatus(`❌ Failed to handle answer from ${payload.senderId}: ${error}`);
        }
    }

    /**
     * Handle WebRTC ICE candidate
     */
    async handleWebRTCIceCandidate(payload) {
        if (payload.recipientId !== this.gameState.clientId) return;

        try {
            await this.networkManager.p2pTransport.addIceCandidate(payload.senderId, payload.candidate);
        } catch (error) {
            ui.updateStatus(`❌ Failed to add ICE candidate from ${payload.senderId}: ${error}`);
        }
    }
}
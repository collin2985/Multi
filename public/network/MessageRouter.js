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
import ChunkCoordinates from '../core/ChunkCoordinates.js';

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
            'garden_item_spawned': (payload) => this.handleGardenItemSpawned(payload),
            'apple_tree_item_spawned': (payload) => this.handleAppleTreeItemSpawned(payload),
            'campfire_firewood_updated': (payload) => this.handleCampfireFirewoodUpdated(payload),
            'road_placed': (payload) => this.handleRoadPlaced(payload),
            'spawn_ai_command': (payload) => this.handleSpawnAICommand(payload)
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
     * Fast object lookup using objectRegistry
     * Falls back to scene.traverse if not found (and caches result)
     * @param {string} objectId - Object ID to find
     * @returns {THREE.Object3D|null} - Found object or null
     */
    findObjectById(objectId) {
        // Try fast registry lookup first
        if (this.game.objectRegistry) {
            const cached = this.game.objectRegistry.get(objectId);
            if (cached) return cached;
        }

        // Fallback to scene traversal
        let found = null;
        this.scene.traverse((object) => {
            if (object.userData && !object.userData.isBoundingBox && object.userData.objectId === objectId) {
                found = object;
                // Cache for future lookups
                if (this.game.objectRegistry) {
                    this.game.objectRegistry.set(objectId, object);
                }
            }
        });
        return found;
    }

    /**
     * Handle server connection confirmation
     */
    handleServerConnected() {
        const { chunkX: initialChunkX, chunkZ: initialChunkZ } = ChunkCoordinates.worldToChunk(
            this.game.playerObject.position.x,
            this.game.playerObject.position.z
        );
        const chunkId = ChunkCoordinates.toChunkId(initialChunkX, initialChunkZ);

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
        const { objectChanges, chunkId } = payload;
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
        // Validate change data
        if (!change || !change.chunkId) {
            console.error('[addObjectFromChange] Invalid change data - missing chunkId:', change);
            return;
        }

        if (!change.position || !Array.isArray(change.position) || change.position.length < 3) {
            console.error('[addObjectFromChange] Invalid change data - missing or invalid position:', {
                change,
                objectType: change.name || change.objectType,
                objectId: change.id
            });
            return;
        }

        const chunkKey = change.chunkId.replace('chunk_', '');


        // Check if object was recently deleted
        const removedSet = this.gameState.removedObjectsCache.get(chunkKey);
        if (removedSet && removedSet.has(change.id)) {
            return; // Skip this object - it was deleted
        }

        // Handle roads specially - they're terrain textures, not 3D objects
        const objectType = change.name || change.objectType;
        if (objectType === 'road' || change.isRoad) {
            // Paint road on terrain
            if (this.terrainRenderer && this.terrainRenderer.paintRoadVertices) {
                this.terrainRenderer.paintRoadVertices(change.position);
            }
            // Update navigation map - add ROAD flag
            if (this.game.navigationManager && change.chunkId) {
                const navMap = this.game.navigationManager.getChunk(change.chunkId);
                if (navMap) {
                    const roadRadius = 1.0;
                    navMap.addRoad(change.position[0], change.position[2], roadRadius);
                }
            }
            return; // Don't process roads as regular objects
        }

        // Check if object already exists in scene
        let existingObject = null;
        let searchCount = 0;
        let rockObjects = [];
        let exactMatchFound = false;

        this.scene.traverse((object) => {
            if (object.userData && object.userData.objectId) {
                searchCount++;

                // Collect all rocks for debugging
                if (object.userData.modelType === 'limestone' ||
                    object.userData.modelType === 'sandstone' ||
                    object.userData.modelType === 'clay') {
                    rockObjects.push({
                        id: `"${object.userData.objectId}"`,
                        idLength: object.userData.objectId.length,
                        type: object.userData.modelType,
                        remaining: object.userData.remainingResources,
                        chunkKey: object.userData.chunkKey
                    });

                    // Detailed comparison for rocks
                    if (change.name === object.userData.modelType) {
                        const exactMatch = object.userData.objectId === change.id;
                        const trimMatch = object.userData.objectId.trim() === change.id.trim();
                        const includesMatch = object.userData.objectId.includes(change.id) ||
                                             change.id.includes(object.userData.objectId);

                    }
                }

                // Check for exact match
                if (!object.userData.isBoundingBox && object.userData.objectId === change.id) {
                    existingObject = object;
                    exactMatchFound = true;
                }
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
            if ((structureType === 'crate' || structureType === 'tent' || structureType === 'house' || structureType === 'garden' || structureType === 'market' || structureType === 'campfire') && change.inventory) {
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
        const objectType = data.name || data.objectType;

        // Validate position data
        if (!data.position || !Array.isArray(data.position) || data.position.length < 3) {
            console.error('[createObjectInScene] Invalid position data:', {
                objectType,
                position: data.position,
                objectId: data.id || data.objectId,
                chunkKey
            });
            return null;
        }

        // Handle roads specially - they're terrain textures, not 3D objects
        if (objectType === 'road' || data.isRoad) {
            // Paint road on terrain instead of creating 3D object
            if (this.terrainRenderer && this.terrainRenderer.paintRoadVertices) {
                this.terrainRenderer.paintRoadVertices(data.position);
            }
            // Update navigation map - add ROAD flag
            if (this.game.navigationManager) {
                const chunkId = `chunk_${chunkKey}`;
                const navMap = this.game.navigationManager.getChunk(chunkId);
                if (navMap) {
                    const roadRadius = 1.0;
                    navMap.addRoad(data.position[0], data.position[2], roadRadius);
                }
            }
            return; // Don't create 3D object for roads
        }

        const objectPosition = new THREE.Vector3(data.position[0], data.position[1], data.position[2]);
        const objectRotation = data.rotation !== undefined ? (data.rotation * Math.PI / 180) : (Math.random() * Math.PI * 2);

        // Store rotation in degrees for reference
        const objectRotationDegrees = data.rotation !== undefined ? data.rotation : (objectRotation * 180 / Math.PI);

        const finalModelRotation = objectRotation;

        // LOG DEBUG: Confirm createInstance is being called for logs
        if (objectType && objectType.endsWith('_log')) {
            console.log('[LOG DEBUG] createObjectInScene calling createInstance:', { objectType, objectPosition, scale: data.scale });
        }

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

            // Handle crate/tent/house/garden/market/campfire/apple inventory
            const structureType = data.name || data.objectType;
            if ((structureType === 'crate' || structureType === 'tent' || structureType === 'house' || structureType === 'garden' || structureType === 'market' || structureType === 'campfire' || structureType === 'apple') && data.inventory) {
                objectInstance.userData.inventory = data.inventory;
            }

            this.scene.add(objectInstance);

            // LOG DEBUG: Confirm log is added to scene
            if (structureType && structureType.endsWith('_log')) {
                console.log('[LOG DEBUG] Added to scene:', {
                    objectId: objectInstance.userData.objectId,
                    type: objectInstance.type,
                    hasChildren: objectInstance.children.length > 0,
                    childCount: objectInstance.children.length,
                    visible: objectInstance.visible,
                    position: objectInstance.position
                });
            }

            // Add smoke effect for campfires
            if (structureType === 'campfire') {
                this.game.addCampfireSmoke(objectInstance.userData.objectId, objectInstance.position);
            }

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

                    // Skip physics colliders for roads (terrain modifications)
                    if (dims && modelType !== 'road') {
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

            // Add to objectRegistry for fast lookups
            if (this.game.objectRegistry && objectInstance.userData.objectId) {
                this.game.objectRegistry.set(objectInstance.userData.objectId, objectInstance);
            }

            // Update navigation map - add obstacle
            if (this.game.navigationManager) {
                const chunkId = `chunk_${chunkKey}`;
                const navMap = this.game.navigationManager.getChunk(chunkId);
                if (navMap) {
                    const scale = objectInstance.userData?.originalScale || objectInstance.scale?.x || 1.0;
                    const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[objectType];
                    if (dims) {
                        if (dims.radius !== undefined) {
                            const radius = dims.radius * scale;
                            navMap.addCylindricalObstacle(objectPosition.x, objectPosition.z, radius);
                        } else if (dims.width !== undefined && dims.depth !== undefined) {
                            const width = dims.width * scale;
                            const depth = dims.depth * scale;
                            navMap.addRectangularObstacle(objectPosition.x, objectPosition.z, width, depth, objectRotation);
                        }
                    }
                }
            }

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
        // Get the object before removing it (for billboard cleanup)
        const objectToRemove = this.findObjectById(payload.objectId);

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

        // Remove from objectRegistry
        if (this.game.objectRegistry && this.game.objectRegistry.has(payload.objectId)) {
            this.game.objectRegistry.delete(payload.objectId);
        }

        // BILLBOARD CLEANUP: Hide billboard for trees
        if (objectToRemove && this.game.billboardSystem) {
            const treeTypes = ['oak', 'fir', 'pine', 'cypress', 'apple'];
            const modelType = objectToRemove.userData?.modelType;
            if (modelType && treeTypes.includes(modelType)) {
                this.game.billboardSystem.removeTreeBillboard(objectToRemove);
            }
        }

        // TREE INSTANCE CLEANUP: Remove from TreeInstanceManager if instanced
        if (objectToRemove && this.game.treeInstanceManager) {
            if (this.game.treeInstanceManager.isInstancedTree(payload.objectId)) {
                this.game.treeInstanceManager.removeInstanceData(payload.objectId);
            }
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

        // LOG DEBUG: Check what data logs receive
        if (objectType && objectType.endsWith('_log')) {
            console.log('[LOG DEBUG] handleObjectAdded received:', { objectId, objectType, position, quality, scale });
        }

        // Debug logging for chunk assignment issue
        if (isConstructionSite) {
            console.log('[handleObjectAdded] Construction site:', {
                objectId,
                position,
                chunkId,
                isConstructionSite
            });
        }

        // Validate chunkId and calculate chunkKey
        let chunkKey;
        if (!chunkId || chunkId === 'chunk_undefined' || chunkId === 'chunk_NaN,NaN') {
            console.error('[handleObjectAdded] Invalid chunkId:', chunkId, 'for object:', objectId, 'at position:', position);
            // Calculate the correct chunk from position using ChunkCoordinates
            const worldX = position[0];
            const worldZ = position[2];
            const correctedChunkId = ChunkCoordinates.worldToChunkId(worldX, worldZ);
            console.log('[handleObjectAdded] Calculated correct chunkId:', correctedChunkId);
            // Use the corrected chunkId
            chunkKey = correctedChunkId.replace('chunk_', '');
        } else {
            chunkKey = chunkId.replace('chunk_', '');
        }

        // Check if object already exists (using fast registry lookup)
        const existingObject = this.findObjectById(objectId);

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

            // Note: AI spawning for tents is now server-authoritative
            // Server will send 'spawn_ai_command' when players enter tent chunk
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
        console.log(`[MessageRouter] Removing depleted resource ${objectId}`);

        // Use the centralized removal method that handles everything:
        // - Physics collider removal
        // - Navigation obstacle removal
        // - Scene removal with proper disposal
        // - chunkObjects cleanup
        // - gameState.nearestObject clearing
        // - UI updates
        // - removedObjectsCache tracking (prevents respawn on chunk reload)
        const removed = this.chunkManager.removeObject(objectId);

        if (!removed) {
            console.warn(`[MessageRouter] Failed to remove depleted resource: ${objectId}`);
        }

        // Remove from objectRegistry
        if (this.game.objectRegistry && this.game.objectRegistry.has(objectId)) {
            this.game.objectRegistry.delete(objectId);
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

        // Find the crate object (using fast registry lookup)
        const crateObject = this.findObjectById(crateId);

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

        // Find the crate object (using fast registry lookup)
        const crateObject = this.findObjectById(crateId);

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

        // Find the market object (using fast registry lookup)
        const marketObject = this.findObjectById(marketId);

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

        // Find the garden object (using fast registry lookup)
        const gardenObject = this.findObjectById(gardenId);

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
     * Handle apple tree item spawned
     */
    handleAppleTreeItemSpawned(payload) {
        const { appleTreeId, item, chunkId } = payload;

        // Find the apple tree object (using fast registry lookup)
        const appleTreeObject = this.findObjectById(appleTreeId);

        if (appleTreeObject) {
            // Initialize inventory if needed
            if (!appleTreeObject.userData.inventory) {
                appleTreeObject.userData.inventory = { items: [] };
            }

            // Add the new item to the apple tree's inventory
            appleTreeObject.userData.inventory.items.push(item);

            // If this is the nearest structure and inventory is open, refresh display
            if (this.gameState.nearestStructure &&
                this.gameState.nearestStructure.userData.objectId === appleTreeId &&
                this.gameState.inventoryOpen) {
                this.game.crateInventory = appleTreeObject.userData.inventory;
                this.inventoryUI.renderCrateInventory();
            }

            console.log(`Apple tree ${appleTreeId} received spawned item: ${item.type} (Q:${item.quality}, D:${item.durability})`);
        }
    }

    /**
     * Handle campfire firewood update from server
     */
    handleCampfireFirewoodUpdated(payload) {
        const { campfireId, inventory, firewoodRemoved } = payload;

        // Find the campfire object (using fast registry lookup)
        const campfireObject = this.findObjectById(campfireId);

        if (campfireObject) {
            // Update inventory in campfire userData
            campfireObject.userData.inventory = inventory;

            // Control smoke effects based on firewood presence
            const smokeEffect = this.game.smokeEffects.get(campfireId);
            if (smokeEffect) {
                // Check if firewood still exists in inventory
                const hasFirewood = inventory.items.some(item =>
                    item.type && item.type.endsWith('firewood') && item.durability > 0
                );

                if (hasFirewood) {
                    // Start smoke if not already active
                    if (!smokeEffect.active) {
                        smokeEffect.start();
                    }
                } else {
                    // No firewood - stop spawning new smoke (existing particles will fade out)
                    if (smokeEffect.active) {
                        smokeEffect.stop();
                    }
                }
            }

            // If this is the nearest structure and inventory is open, update display
            if (this.gameState.nearestStructure &&
                this.gameState.nearestStructure.userData.objectId === campfireId &&
                this.gameState.inventoryOpen) {
                this.game.crateInventory = inventory;
                this.inventoryUI.renderCrateInventory();
            }

            // Log only when firewood is removed for clarity
            if (firewoodRemoved) {
                console.log(`Campfire ${campfireId} firewood depleted`);
            }
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

    /**
     * Handle road placed message from server
     */
    handleRoadPlaced(payload) {
        const { position, roadId, chunkId } = payload;

        console.log(`Road placed: ${roadId} at position [${position}] in ${chunkId}`);

        // Paint road on terrain using vertex colors
        if (this.terrainRenderer && this.terrainRenderer.paintRoadVertices) {
            this.terrainRenderer.paintRoadVertices(position);
        }

        // Update navigation map - add ROAD flag for speed bonus
        if (this.game.navigationManager) {
            const navMap = this.game.navigationManager.getChunk(chunkId);
            if (navMap) {
                const roadRadius = 1.0; // Match terrain road radius
                navMap.addRoad(position[0], position[2], roadRadius);
                console.log(`[Nav] Added road at (${position[0].toFixed(1)}, ${position[2].toFixed(1)}) with radius ${roadRadius}`);
            }
        }

        // Visual feedback
        ui.updateStatusLine1('Road placed!', 2000);
    }

    /**
     * Handle spawn_ai_command from server
     * Server-authoritative AI spawning
     */
    handleSpawnAICommand(payload) {
        const { aiId, aiType, spawnerId, position, aggro } = payload;

        console.log(`[MessageRouter] spawn_ai_command: ${aiType} (${aiId}) at spawner ${spawnerId}`);

        // Delegate to AIEnemyManager
        if (this.game.aiEnemyManager) {
            this.game.aiEnemyManager.spawnFromServer({
                aiId,
                aiType,
                spawnerId,
                position,
                aggro
            });
        }
    }
}
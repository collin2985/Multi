/**
 * MessageRouter.js
 * Centralized routing and handling of all server messages
 * Reduces game.js by ~600 lines by extracting all message handlers
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { ui } from '../ui.js';
import { AIEnemy } from '../ai-enemy.js';
import ChunkCoordinates from '../core/ChunkCoordinates.js';
import { SceneObjectFactory } from './SceneObjectFactory.js';
import { COLLISION_GROUPS } from '../core/PhysicsManager.js';

// Decay formula constants (must match server/StructureDecayUtils.js)
const DECAY_EXPONENT = 1.434;
const DECAY_INVERSE = 0.697;
const CONSTRUCTION_SITE_LIFESPAN_HOURS = 1;

export class MessageRouter {
    constructor(game) {
        this.game = game;
        this.gameState = game.gameState;
        this.networkManager = game.networkManager;

        // Object creation factory (extracted for file size reduction)
        this.sceneObjectFactory = new SceneObjectFactory(game);
        // Note: These phase-1 systems are available at construction
        this.scene = game.scene;

        // Note: Phase-2 systems (chunkManager, terrainGenerator, etc.) are NOT available
        // at construction time. They are set up in initializeWithSpawn().
        // Access them via this.game.* when needed, or use the getters below.

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
            'crate_save_denied': (payload) => this.handleCrateSaveDenied(payload),
            'inventory_lock_response': (payload) => this.handleInventoryLockResponse(payload),
            'lock_confirm_response': (payload) => this.handleLockConfirmResponse(payload),
            'market_inventory_updated': (payload) => this.handleMarketInventoryUpdated(payload),
            'close_market_for_trade': (payload) => this.handleCloseMarketForTrade(payload),
            'garden_item_spawned': (payload) => this.handleGardenItemSpawned(payload),
            'apple_tree_item_spawned': (payload) => this.handleAppleTreeItemSpawned(payload),
            'campfire_firewood_updated': (payload) => this.handleCampfireFirewoodUpdated(payload),
            'house_firewood_updated': (payload) => this.handleHouseFirewoodUpdated(payload),
            'tileworks_firewood_updated': (payload) => this.handleTileworksFirewoodUpdated(payload),
            'tree_growth_update': (payload) => this.handleTreeGrowthUpdate(payload),
            'tree_planted': (payload) => this.handleTreePlanted(payload),
            'tree_growth_complete': (payload) => this.handleTreeGrowthComplete(payload),
            'road_placed': (payload) => this.handleRoadPlaced(payload),
            'spawn_ai_command': (payload) => this.handleSpawnAICommand(payload),
            'structure_repaired': (payload) => this.handleStructureRepaired(payload),
            'dock_ship_spawned': (payload) => this.handleDockShipSpawned(payload),
            'home_set': (payload) => this.handleHomeSet(payload),

            // Authentication responses
            'register_response': (payload) => this.handleAuthResponse('register_response', payload),
            'login_response': (payload) => this.handleAuthResponse('login_response', payload),
            'session_validation': (payload) => this.handleAuthResponse('session_validation', payload),
            'logout_response': (payload) => this.handleAuthResponse('logout_response', payload),
            'auth_upgrade_success': (payload) => this.handleAuthResponse('auth_upgrade_success', payload),
            'player_data_loaded': (payload) => this.handlePlayerDataLoaded(payload),

            // Faction system responses - emit via GameStateManager for FactionPanel
            'change_faction_response': (payload) => this.emitFactionEvent('change_faction_response', payload),
            'set_faction_response': (payload) => this.emitFactionEvent('set_faction_response', payload),

            // Friend system responses - emit via GameStateManager for FriendsPanel
            'friend_request_response': (payload) => this.emitFriendEvent('friend_request_response', payload),
            'friend_request_received': (payload) => this.emitFriendEvent('friend_request_received', payload),
            'friend_request_accepted': (payload) => this.emitFriendEvent('friend_request_accepted', payload),
            'friend_accept_response': (payload) => this.emitFriendEvent('friend_accept_response', payload),
            'friend_decline_response': (payload) => this.emitFriendEvent('friend_decline_response', payload),
            'friend_remove_response': (payload) => this.emitFriendEvent('friend_remove_response', payload),
            'friends_list_response': (payload) => this.emitFriendEvent('friends_list_response', payload),
            'friend_position_response': (payload) => this.emitFriendEvent('friend_position_response', payload),

            // Position request from server (for friend spawn)
            'position_request': (payload) => this.handlePositionRequest(payload),

            // Tick sync for deterministic simulation
            'tick': (payload) => this.handleTick(payload),

            // Crate load/unload responses
            'claim_crate_response': (payload) => this.handleClaimCrateResponse(payload),
            'release_crate_response': (payload) => this.handleReleaseCrateResponse(payload)
        };
    }

    /**
     * Handle claim_crate_response from server
     * Called after attempting to load a crate onto a cart
     */
    handleClaimCrateResponse(payload) {
        const { entityId, success, reason } = payload;

        if (this.game.pendingCrateClaim && this.game.pendingCrateClaim.entityId === entityId) {
            if (success) {
                this.game.pendingCrateClaim.resolve(payload);
            } else {
                this.game.pendingCrateClaim.reject(new Error(reason || 'Claim failed'));
            }
            this.game.pendingCrateClaim = null;
        }
    }

    /**
     * Handle release_crate_response from server
     * Called after attempting to unload a crate from a cart
     */
    handleReleaseCrateResponse(payload) {
        const { entityId, success, reason } = payload;

        if (this.game.pendingCrateRelease && this.game.pendingCrateRelease.entityId === entityId) {
            if (success) {
                this.game.pendingCrateRelease.resolve(payload);
            } else {
                this.game.pendingCrateRelease.reject(new Error(reason || 'Release failed'));
            }
            this.game.pendingCrateRelease = null;
        }
    }

    /**
     * Handle tick message from server for deterministic simulation sync
     */
    handleTick(payload) {
        // Store serverTick in gameState for tick-based calculations
        this.gameState.serverTick = payload.tick;

        if (this.game.tickManager) {
            this.game.tickManager.onServerTick(payload.tick);
        }

        // Update name tag visibility on each server tick (once per second)
        if (this.game.nameTagManager && this.game.playerObject) {
            this.game.nameTagManager.updateVisibility(this.game.playerObject.position);
        }

        // AI spawn check and authority broadcast on tick
        const chunkX = this.gameState.currentPlayerChunkX;
        const chunkZ = this.gameState.currentPlayerChunkZ;

        // Guard against null chunks (before initial chunk join)
        // Skip AI spawn checks until player is in a valid chunk
        if (chunkX !== null && chunkZ !== null) {
            if (this.game.banditController) {
                // Initialize tent presence on first tick
                if (this.game.banditController._lastCheckedChunkX === null) {
                    this.game.banditController.updateTentPresence(chunkX, chunkZ);
                }

                // Check spawns
                if (this.game.banditController._hasTentsInRange) {
                    this.game.banditController.checkSpawnsOnTick(chunkX, chunkZ);
                }

                // Authority broadcasts state
                this.game.banditController.broadcastAuthorityState();
            }

            // Check deer spawns on tick (coordinates spawn authority across peers)
            if (this.game.deerController) {
                this.game.deerController.checkSpawnsOnTick(chunkX, chunkZ);
            }

            // Check bear spawns on tick (coordinates spawn authority across peers)
            if (this.game.bearController) {
                this.game.bearController.checkSpawnsOnTick(chunkX, chunkZ);
            }
        }

        // Check structure decay and ship spawns every 60 ticks (1 minute)
        if (payload.tick % 60 === 0) {
            this.checkStructureDecay();

            // Check dock ship spawns
            if (this.game.scheduledShipSystem) {
                this.game.scheduledShipSystem.checkAndTriggerShipSpawns(
                    (type, msgPayload) => this.networkManager.sendMessage(type, msgPayload)
                );
            }
        }

        // Broadcast position snapshot to peers for eventual consistency
        this.broadcastPlayerTick();
    }

    /**
     * Broadcast current position state to all peers
     * Acts as a safety net for missed move/stop events
     */
    broadcastPlayerTick() {
        const game = this.game;
        if (!game.playerObject || !game.networkManager) return;

        // Only broadcast if we have connected peers
        if (game.networkManager.p2pTransport.getConnectedPeers().length === 0) return;

        game.networkManager.broadcastP2P({
            type: 'player_tick',
            p: game.playerObject.position.toArray(),
            m: game.gameState.isMoving,
            t: game.gameState.isMoving ? game.gameState.playerTargetPosition?.toArray() : null,
            d: game.playerController?.onDock || false,
            hr: game.playerCombat?.hasRifle() || false,
            u: game.gameState.username || null,
            s: game.playerController?.getSpeedMultiplier() || 1.0
        });
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
     * Emit friend system events via GameStateManager
     * This allows FriendsPanel to subscribe via networkManager.on()
     */
    emitFriendEvent(eventType, payload) {
        if (this.networkManager && this.networkManager.gameStateManager) {
            this.networkManager.gameStateManager.emit(eventType, payload);
        }
    }

    /**
     * Emit faction system events via GameStateManager
     * This allows FactionPanel to subscribe via networkManager.on()
     */
    emitFactionEvent(eventType, payload) {
        if (this.networkManager && this.networkManager.gameStateManager) {
            this.networkManager.gameStateManager.emit(eventType, payload);
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
     * Note: We no longer send join_chunk here since spawn system defers player creation.
     * join_chunk is sent from joinChunkAtSpawn() after spawn point is determined.
     */
    handleServerConnected() {
        // Mark that we're connected but not yet in a chunk
        this.gameState.serverConnected = true;
    }

    /**
     * Join chunk at the player's current spawn position
     * Called after spawn point is determined and playerObject exists
     */
    joinChunkAtSpawn() {
        if (!this.game.playerObject) {
            console.error('[MessageRouter] Cannot join chunk - playerObject not initialized');
            return false;
        }

        const { chunkX: initialChunkX, chunkZ: initialChunkZ } = ChunkCoordinates.worldToChunk(
            this.game.playerObject.position.x,
            this.game.playerObject.position.z
        );
        const chunkId = ChunkCoordinates.toChunkId(initialChunkX, initialChunkZ);


        const success = this.networkManager.sendMessage('join_chunk', {
            chunkId,
            clientId: this.gameState.clientId,
            accountId: this.gameState.accountId  // Include account ID if logged in
        });

        if (success) {
            this.gameState.isInChunk = true;
            this.gameState.updateChunkPosition(initialChunkX, initialChunkZ);

            // Register local player in spatial partitioning for AI detection
            const initialChunkKey = `${initialChunkX},${initialChunkZ}`;
            this.gameState.updatePlayerChunk(this.gameState.clientId, null, initialChunkKey);

            // Reset button states on initial chunk join
            ui.updateButtonStates(
                true,   // isInChunk
                null,   // nearestObject
                false,  // hasAxe
                false,  // hasSaw
                false,  // isOnCooldown
                null,   // nearestConstructionSite
                this.gameState.isMoving,
                null,   // nearestStructure
                false,  // hasHammer
                false,  // nearWater
                false,  // hasFishingNet
                false,  // onGrass
                false,  // mushroomAvailable
                false,  // vegetableSeedsAvailable
                false,  // seedsAvailable
                null,   // seedTreeType
                false,  // isClimbing
                null,   // occupiedOutposts
                false,  // vegetablesGatherAvailable
                null    // activeAction
            );
        }

        return success;
    }

    /**
     * Handle chunk objects state synchronization
     */
    handleChunkObjectsState(payload) {
        const { objectChanges, chunkId, serverTick } = payload;
        if (!objectChanges || !Array.isArray(objectChanges)) return;

        // Store serverTick for tick-based calculations (firewood, cooking, etc.)
        if (serverTick !== undefined) {
            this.gameState.serverTick = serverTick;
        }

        // Guard: Make sure game is fully initialized before processing chunk state
        if (!this.game.chunkManager || !this.game.terrainGenerator) {
            console.warn('[MessageRouter] Deferring chunk_objects_state - game not fully initialized yet');
            // Queue this message to be processed later
            if (!this._deferredChunkStates) {
                this._deferredChunkStates = [];
            }
            this._deferredChunkStates.push(payload);
            return;
        }

        // Process any deferred chunk states first
        if (this._deferredChunkStates && this._deferredChunkStates.length > 0) {
            const deferred = this._deferredChunkStates;
            this._deferredChunkStates = [];
            deferred.forEach(deferredPayload => this.handleChunkObjectsState(deferredPayload));
        }

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
                this.sceneObjectFactory.addObjectFromChange(change);
            }
        });

        // Apply removals to existing chunks
        changesByChunk.forEach((_, chunkKey) => {
            this.game.chunkManager.applyChunkRemovals(chunkKey);
        });

        // Mark that we've received initial server state
        const wasFirstState = !this.gameState.receivedInitialServerState;
        this.gameState.receivedInitialServerState = true;

        // If this was the first chunk state, process any pending chunk requests
        if (wasFirstState) {
            this.game.chunkManager.processPendingChunksAfterServerState();

            // If no chunks were queued (player didn't move), create initial chunks
            if (this.game.chunkManager.loadedChunks.size === 0) {
                this.game.chunkManager.updateChunksAroundPlayer(
                    this.gameState.currentPlayerChunkX,
                    this.gameState.currentPlayerChunkZ
                );
            }

            // Force re-check tent presence now that initial objects are loaded
            // This handles the case where player spawns near a tent
            if (this.game.banditController) {
                this.game.banditController.updateTentPresence(
                    this.gameState.currentPlayerChunkX,
                    this.gameState.currentPlayerChunkZ,
                    true // force
                );
            }
        }

        // Check for bandit camp generation in ALL chunks in the 5x5 grid
        // (Server sends combined objectChanges but we need to check each chunk, including empty ones)
        if (chunkId && this.game.chunkObjectGenerator) {
            // Parse center chunk coordinates
            const match = chunkId.match(/chunk_(-?\d+),(-?\d+)/);
            if (match) {
                const centerX = parseInt(match[1], 10);
                const centerZ = parseInt(match[2], 10);
                const radius = 2; // 5x5 grid = radius 2

                // Check each chunk in the grid
                for (let dx = -radius; dx <= radius; dx++) {
                    for (let dz = -radius; dz <= radius; dz++) {
                        const checkChunkId = `chunk_${centerX + dx},${centerZ + dz}`;
                        const chunkChanges = objectChanges.filter(c => c.chunkId === checkChunkId);
                        this.game.chunkObjectGenerator.checkAndGenerateBanditCamp(
                            checkChunkId,
                            chunkChanges,
                            this.game.networkManager,
                            this.game.structureManager
                        );
                    }
                }
            }
        }

    }


    /**
     * Handle object removal
     */
    handleObjectRemoved(payload) {
        // If this is a mobile entity claim by us, don't remove - we're controlling it
        if (payload.isMobileClaim && payload.claimedBy === this.game.gameState?.clientId) {
            console.log(`[MessageRouter] Ignoring removal of claimed entity ${payload.objectId} (self-claimed)`);
            return;
        }

        // If this is a mobile entity claimed by ANY peer, don't remove - they're controlling it
        // The peer will have created their own dynamic mesh via P2P message
        if (payload.isMobileClaim && payload.claimedBy) {
            const claimingPeerId = payload.claimedBy;
            const peerData = this.networkManager?.peerGameData?.get(claimingPeerId);

            // Check if peer is piloting this entity (horse/boat)
            if (peerData?.mobileEntity?.entityId === payload.objectId) {
                console.log(`[MessageRouter] Ignoring removal of ${payload.objectId} - peer ${claimingPeerId} is piloting`);
                return;
            }

            // Check if peer is towing this cart
            if (peerData?.towedCart?.cartId === payload.objectId) {
                console.log(`[MessageRouter] Ignoring removal of ${payload.objectId} - peer ${claimingPeerId} is towing`);
                return;
            }

            // Check if peer has this crate loaded
            if (peerData?.loadedCrate?.crateId === payload.objectId) {
                console.log(`[MessageRouter] Ignoring removal of ${payload.objectId} - peer ${claimingPeerId} has loaded`);
                return;
            }

            // If we couldn't find peer tracking for this claimed object, still proceed with removal
            // This handles edge cases where peer disconnected before P2P message arrived
            console.log(`[MessageRouter] Processing removal of claimed entity ${payload.objectId} - peer tracking not found`);
        }

        // Get the object before removing it (for billboard cleanup and structure height removal)
        const objectToRemove = this.findObjectById(payload.objectId);

        // Remove structure heights BEFORE removing the object (need position/rotation data)
        if (objectToRemove) {
            const modelType = objectToRemove.userData?.modelType;
            // NOTE: Structure heights and terrain leveling disabled - new clipmap terrain doesn't support runtime modification
        }

        // Unregister from animation system if animated
        this.game.animationSystem.unregister(payload.objectId);

        // Unregister dock from scheduled ship system
        if (this.game.scheduledShipSystem) {
            this.game.scheduledShipSystem.unregisterDock(payload.objectId);
        }

        // Remove merchant if dock is removed
        if (this.game.dockMerchantSystem) {
            this.game.dockMerchantSystem.removeMerchant(payload.objectId);
        }

        // Unregister bandit structure from AI detection registry
        if (objectToRemove?.userData?.isBanditStructure && this.game.gameState) {
            const chunkKey = objectToRemove.userData.chunkKey;
            if (chunkKey) {
                this.game.gameState.unregisterBanditStructure(chunkKey, payload.objectId);
            }
        }

        const removed = this.game.chunkManager.removeObject(payload.objectId);
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

        // BILLBOARD CLEANUP: Hide billboards for trees and rocks
        if (objectToRemove) {
            const treeTypes = ['oak', 'fir', 'pine', 'cypress', 'apple'];
            const rockTypes = ['limestone', 'sandstone', 'clay', 'iron'];
            const modelType = objectToRemove.userData?.modelType;
            if (modelType && treeTypes.includes(modelType)) {
                if (this.game.billboardSystem) {
                    this.game.billboardSystem.removeTreeBillboard(objectToRemove);
                }
            }
            // Remove rock billboards and 3D models
            if (modelType && rockTypes.includes(modelType)) {
                if (this.game.billboardSystem) {
                    this.game.billboardSystem.removeTreeBillboard(objectToRemove);
                }
                if (this.game.rockModelSystem) {
                    this.game.rockModelSystem.removeRockInstance(objectToRemove);
                }
            }
        }

        // SMOKE EFFECT CLEANUP: Remove smoke effects for structures
        if (objectToRemove) {
            const modelType = objectToRemove.userData?.modelType;

            // Remove campfire smoke
            if (modelType === 'campfire') {
                this.game.removeCampfireSmoke(payload.objectId);
            }

            // Remove tileworks smoke (2 smoke effects)
            if (modelType === 'tileworks') {
                const smoke1 = this.game.effectManager.smokeEffects.get(payload.objectId + '_1');
                const smoke2 = this.game.effectManager.smokeEffects.get(payload.objectId + '_2');

                if (smoke1) {
                    smoke1.remove();
                    this.game.effectManager.smokeEffects.delete(payload.objectId + '_1');
                }

                if (smoke2) {
                    smoke2.remove();
                    this.game.effectManager.smokeEffects.delete(payload.objectId + '_2');
                }

                console.log(`Removed smoke effects for tileworks ${payload.objectId}`);
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
                targetStructure, requiredMaterials, materials, finalFoundationY, inventory,
                currentDurability, hoursUntilRuin, owner, isBanditStructure, materialType,
                isMobileRelease } = payload;

        // LOG DEBUG: Check what data logs receive
        if (objectType && objectType.endsWith('_log')) {
            console.log('[LOG DEBUG] handleObjectAdded received:', { objectId, objectType, position, quality, scale });
        }

        // Check if we have a hidden static object that should be re-shown
        // This handles the case where we hid the static mesh when a peer attached it (cart/crate)
        const existingHidden = this.game?.objectRegistry?.get(objectId);
        if (existingHidden && existingHidden.visible === false && isMobileRelease) {
            existingHidden.visible = true;
            console.log(`[handleObjectAdded] Re-showing previously hidden ${objectType} ${objectId}`);
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

        // Validate object is still in scene (has parent) - disposed objects may still be in registry
        const objectIsValid = existingObject && existingObject.parent;

        if (objectIsValid) {
            // Update existing object properties
            existingObject.userData.remainingResources = remainingResources || null;
            existingObject.userData.totalResources = totalResources || null;
            // Update owner (used when house ownership is cleared/transferred)
            if (owner !== undefined) {
                existingObject.userData.owner = owner;
            }

            // Handle mobile entity releases (horse/boat dismount) - update position and physics
            if (isMobileRelease && position) {
                // Update mesh position
                existingObject.position.set(position[0], position[1], position[2]);
                if (rotation !== undefined) {
                    existingObject.rotation.y = rotation;
                }

                // Get old chunk key before updating
                const oldChunkKey = existingObject.userData.chunkKey;

                // Update chunkKey - critical for re-mounting after crossing chunk boundaries
                existingObject.userData.chunkKey = chunkKey;

                // Move object in chunkObjects map if chunk changed
                if (oldChunkKey && oldChunkKey !== chunkKey && this.game.chunkManager) {
                    const chunkManager = this.game.chunkManager;

                    // Remove from old chunk's array
                    const oldChunkObjects = chunkManager.chunkObjects.get(oldChunkKey);
                    if (oldChunkObjects) {
                        const index = oldChunkObjects.indexOf(existingObject);
                        if (index !== -1) {
                            oldChunkObjects.splice(index, 1);
                        }
                    }

                    // Add to new chunk's array
                    let newChunkObjects = chunkManager.chunkObjects.get(chunkKey);
                    if (!newChunkObjects) {
                        newChunkObjects = [];
                        chunkManager.chunkObjects.set(chunkKey, newChunkObjects);
                    }
                    if (!newChunkObjects.includes(existingObject)) {
                        newChunkObjects.push(existingObject);
                    }
                }

                // Update physics collider position
                if (this.game.physicsManager && existingObject.userData.objectId) {
                    // Remove old collider (this triggers onObjectRemoved which clears objectRegistry)
                    this.game.physicsManager.removeCollider(existingObject.userData.objectId);

                    // Re-create collider at new position
                    const modelType = existingObject.userData.modelType;
                    const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[modelType];
                    if (dims) {
                        const shape = dims.radius !== undefined
                            ? { type: 'cylinder', radius: dims.radius, height: dims.height || 2 }
                            : { type: 'cuboid', width: dims.width, height: dims.height || 2, depth: dims.depth };

                        this.game.physicsManager.createStaticCollider(
                            existingObject.userData.objectId,
                            shape,
                            existingObject.position,
                            existingObject.rotation.y,
                            COLLISION_GROUPS.STRUCTURE
                        );
                    }

                    // Re-add to objectRegistry (removeCollider triggers callback that deletes it)
                    if (this.game.objectRegistry) {
                        this.game.objectRegistry.set(existingObject.userData.objectId, existingObject);
                    }
                }

                // Trigger proximity check so mount button appears
                this.game.checkProximityToObjects();
            }

            return;
        }

        // Clean up stale registry entry if object exists but was disposed
        if (existingObject && !existingObject.parent) {
            console.log(`[handleObjectAdded] Removing stale registry entry for disposed object ${objectId}`);
            if (this.game.objectRegistry) {
                this.game.objectRegistry.delete(objectId);
            }
        }

        // Create new object
        const objectInstance = this.sceneObjectFactory.createObjectInScene({
            id: objectId,
            name: objectType,
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
            remainingResources,
            currentDurability,
            hoursUntilRuin,
            owner,
            isBanditStructure,
            materialType
        }, chunkKey);

        if (objectInstance) {
            ui.updateStatus(`${objectType} spawned in world`);

            // Register ships and boats for animation
            if (objectType === 'ship' || objectType === 'boat') {
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
        const result = this.game.resourceManager.handleResourceHarvested(payload);

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
        const removed = this.game.chunkManager.removeObject(objectId);

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
        this.game.resourceManager.handleHarvestLockFailed(payload);

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
        const { crateId, inventory, accessDenied, message, structureType, quality, lastSpawnTick, serverTick } = payload;

        // Handle access denied case
        if (accessDenied) {
            console.log(`Access denied for ${crateId}: ${message}`);

            // Show message to player
            if (this.game && this.game.chatSystem) {
                this.game.chatSystem.addSystemMessage(message || 'Access denied', 'error');
            }

            // Close the inventory UI if it's open
            if (this.gameState.nearestStructure &&
                this.gameState.nearestStructure.userData.objectId === crateId) {
                this.game.inventoryUI.closeCrateInventory();
            }
            return;
        }

        // Find the crate object (using fast registry lookup)
        const crateObject = this.findObjectById(crateId);

        if (crateObject) {
            // CLIENT-SIDE SPAWNING: Check if spawning is due for gardens and apple trees
            if (structureType === 'garden' || structureType === 'apple') {
                const itemsSpawned = this.checkAndSpawnItems(
                    inventory,
                    structureType,
                    quality,
                    lastSpawnTick,
                    serverTick
                );

                if (itemsSpawned > 0) {
                    console.log(`Client spawned ${itemsSpawned} items in ${structureType} ${crateId}`);

                    // Save to server (this will update lastSpawnTick on server)
                    const chunkId = `chunk_${crateObject.userData.chunkKey}`;
                    this.networkManager.sendMessage('save_crate_inventory', {
                        crateId: crateId,
                        chunkId: chunkId,
                        inventory: inventory
                    });
                }
            }

            // Store inventory in crate userData
            crateObject.userData.inventory = inventory;

            // If this is the nearest structure, update the display
            if (this.gameState.nearestStructure &&
                this.gameState.nearestStructure.userData.objectId === crateId) {
                this.game.crateInventory = inventory;
                this.game.inventoryUI.renderCrateInventory();
            }
        }
    }

    /**
     * Client-side spawning for gardens and apple trees
     * Generates items locally based on elapsed ticks since lastSpawnTick
     * @param {object} inventory - The structure's inventory to modify
     * @param {string} structureType - 'garden' or 'apple'
     * @param {number} quality - Structure quality for item generation
     * @param {number} lastSpawnTick - Tick when items were last spawned
     * @param {number} serverTick - Current server tick
     * @returns {number} Number of items spawned
     */
    checkAndSpawnItems(inventory, structureType, quality, lastSpawnTick, serverTick) {
        const SPAWN_INTERVAL_TICKS = 600; // 10 minutes
        const ITEMS_PER_SPAWN = 2;

        // First interaction - no spawning, just initialize
        if (!lastSpawnTick || lastSpawnTick === 0) {
            return 0;
        }

        // Calculate spawn cycles elapsed
        const ticksElapsed = serverTick - lastSpawnTick;
        const cyclesElapsed = Math.floor(ticksElapsed / SPAWN_INTERVAL_TICKS);

        if (cyclesElapsed <= 0) {
            return 0;
        }

        // Calculate total items to spawn
        const itemsToSpawn = cyclesElapsed * ITEMS_PER_SPAWN;

        // Get max slots based on structure type
        const maxSlots = structureType === 'garden' ? 4 : 9; // 2x2 for garden, 3x3 for apple tree
        const gridSize = structureType === 'garden' ? 2 : 3;

        if (!inventory.items) {
            inventory.items = [];
        }

        let itemsSpawned = 0;

        for (let i = 0; i < itemsToSpawn; i++) {
            // Check if full
            if (inventory.items.length >= maxSlots) {
                break;
            }

            // Find free position
            let freePosition = null;
            for (let y = 0; y < gridSize && !freePosition; y++) {
                for (let x = 0; x < gridSize && !freePosition; x++) {
                    const occupied = inventory.items.some(item =>
                        item.x === x && item.y === y
                    );
                    if (!occupied) {
                        freePosition = { x, y };
                    }
                }
            }

            if (!freePosition) {
                break;
            }

            // Generate item based on structure type
            let itemType, baseDurability;
            if (structureType === 'garden') {
                // Random: apple or vegetables
                itemType = Math.random() < 0.5 ? 'apple' : 'vegetables';
                baseDurability = itemType === 'apple' ? 10 : 40;
            } else {
                // Apple tree - always apples
                itemType = 'apple';
                baseDurability = 5;
            }

            const newItem = {
                id: `${itemType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: itemType,
                x: freePosition.x,
                y: freePosition.y,
                width: 1,
                height: 1,
                rotation: 0,
                quality: quality,
                durability: Math.round(baseDurability * (quality / 100))
            };

            inventory.items.push(newItem);
            itemsSpawned++;
        }

        return itemsSpawned;
    }

    /**
     * Handle crate inventory update
     */
    handleCrateInventoryUpdated(payload) {
        const { crateId, inventory } = payload;

        // Find the crate object (using fast registry lookup)
        const crateObject = this.findObjectById(crateId);

        if (crateObject) {
            // BUGFIX: Markets should only receive market_inventory_updated, not crate_inventory_updated
            // Ignore this message if it's targeted at a market to prevent format corruption
            if (crateObject.userData.modelType === 'market') {
                console.warn(`[handleCrateInventoryUpdated] Ignoring crate_inventory_updated for market ${crateId}`);
                return;
            }

            // Check if this is the currently open structure with unsaved changes
            const isOpenAndDirty = this.gameState.nearestStructure &&
                this.gameState.nearestStructure.userData.objectId === crateId &&
                this.gameState.inventoryOpen &&
                this.gameState.nearestStructure.userData.inventoryDirty;

            // Only update userData.inventory if NOT dirty (to preserve local positions)
            if (!isOpenAndDirty) {
                crateObject.userData.inventory = inventory;
            }

            // Control smoke for campfire based on firewood presence
            if (crateObject.userData.modelType === 'campfire') {
                const smokeEffect = this.game.effectManager.smokeEffects.get(crateId);
                if (smokeEffect) {
                    const hasFirewood = inventory.items.some(item =>
                        item.type && item.type.endsWith('firewood') && item.durability > 0
                    );

                    if (hasFirewood && !smokeEffect.active) {
                        smokeEffect.start();
                        console.log(`Started campfire smoke for ${crateId} (firewood added)`);
                    } else if (!hasFirewood && smokeEffect.active) {
                        smokeEffect.stop();
                        console.log(`Stopped campfire smoke for ${crateId} (firewood removed)`);
                    }
                }
            }

            // Control smoke for house based on firewood presence
            if (crateObject.userData.modelType === 'house') {
                const smokeEffect = this.game.effectManager.smokeEffects.get(crateId);
                if (smokeEffect) {
                    const hasFirewood = inventory.items.some(item =>
                        item.type && item.type.endsWith('firewood') && item.durability > 0
                    );

                    if (hasFirewood && !smokeEffect.active) {
                        smokeEffect.start();
                        console.log(`Started house smoke for ${crateId} (firewood added)`);
                    } else if (!hasFirewood && smokeEffect.active) {
                        smokeEffect.stop();
                        console.log(`Stopped house smoke for ${crateId} (firewood removed)`);
                    }
                }
            }

            // Control smoke for tileworks based on firewood presence
            if (crateObject.userData.modelType === 'tileworks') {
                const smokeEffect1 = this.game.effectManager.smokeEffects.get(crateId + '_1');
                const smokeEffect2 = this.game.effectManager.smokeEffects.get(crateId + '_2');

                if (smokeEffect1 && smokeEffect2) {
                    const hasFirewood = inventory.items.some(item =>
                        item.type && item.type.endsWith('firewood') && item.durability > 0
                    );

                    if (hasFirewood) {
                        if (!smokeEffect1.active) {
                            smokeEffect1.start();
                        }
                        if (!smokeEffect2.active) {
                            smokeEffect2.start();
                        }
                        console.log(`Started tileworks smoke for ${crateId} (firewood added)`);
                    } else {
                        if (smokeEffect1.active) {
                            smokeEffect1.stop();
                        }
                        if (smokeEffect2.active) {
                            smokeEffect2.stop();
                        }
                        console.log(`Stopped tileworks smoke for ${crateId} (firewood removed)`);
                    }
                }
            }

            // If this is the nearest structure and it's open, update display
            // BUT only if there are no unsaved local changes (to prevent losing items user just placed)
            if (this.gameState.nearestStructure &&
                this.gameState.nearestStructure.userData.objectId === crateId &&
                this.gameState.inventoryOpen) {
                // Check if user has unsaved local changes
                if (!this.gameState.nearestStructure.userData.inventoryDirty) {
                    // Update nearestStructure directly (crateObject might be a different reference)
                    this.gameState.nearestStructure.userData.inventory = inventory;
                    this.game.crateInventory = inventory;
                    this.game.inventoryUI.renderCrateInventory();
                } else {
                    // Dirty - user has local changes, but still merge cookingStartTime
                    // so progress bars show immediately for cookable items
                    const localInventory = this.game.inventoryUI?.crateInventory;
                    if (localInventory?.items && inventory?.items) {
                        let updated = false;
                        for (const serverItem of inventory.items) {
                            if (serverItem.cookingStartTime || serverItem.processingStartTime) {
                                const localItem = localInventory.items.find(i => i.id === serverItem.id);
                                if (localItem) {
                                    if (serverItem.cookingStartTime && !localItem.cookingStartTime) {
                                        localItem.cookingStartTime = serverItem.cookingStartTime;
                                        updated = true;
                                    }
                                    if (serverItem.processingStartTime && !localItem.processingStartTime) {
                                        localItem.processingStartTime = serverItem.processingStartTime;
                                        updated = true;
                                    }
                                }
                            }
                        }
                        // Re-render to show progress bars if any timestamps were added
                        if (updated) {
                            this.game.inventoryUI.renderCrateInventory();
                        }
                    }
                }
            }
        }
    }

    /**
     * Handle crate save denied (ownership check failed)
     */
    handleCrateSaveDenied(payload) {
        const { crateId, message } = payload;

        console.log(`Save denied for ${crateId}: ${message}`);

        // Show error message to player
        if (this.game && this.game.chatSystem) {
            this.game.chatSystem.addSystemMessage(message || 'Cannot modify this inventory', 'error');
        }
    }

    /**
     * Handle inventory lock response
     * Routes to CrateInventoryUI for processing
     */
    handleInventoryLockResponse(payload) {
        if (this.game && this.game.inventoryUI && this.game.inventoryUI.crateUI) {
            this.game.inventoryUI.crateUI.handleLockResponse(payload);
        }
    }

    /**
     * Handle lock confirmation response (double-check)
     * Routes to CrateInventoryUI for processing
     */
    handleLockConfirmResponse(payload) {
        if (this.game && this.game.inventoryUI && this.game.inventoryUI.crateUI) {
            this.game.inventoryUI.crateUI.handleLockConfirmResponse(payload);
        }
    }

    /**
     * Handle market inventory updated
     */
    handleMarketInventoryUpdated(payload) {
        const { marketId, items, transactionId } = payload;

        // Find the market object (using fast registry lookup)
        const marketObject = this.findObjectById(marketId);

        if (marketObject) {
            // Update inventory in market userData (new format: items[itemType][key] = count)
            if (!marketObject.userData.inventory) {
                marketObject.userData.inventory = {};
            }
            marketObject.userData.inventory.items = items;

            // Also update nearestStructure if it's the same market but different object reference
            // This fixes object reference mismatch when chunk reloads cause object recreation
            if (this.gameState.nearestStructure &&
                this.gameState.nearestStructure.userData.objectId === marketId &&
                this.gameState.nearestStructure !== marketObject) {
                if (!this.gameState.nearestStructure.userData.inventory) {
                    this.gameState.nearestStructure.userData.inventory = {};
                }
                this.gameState.nearestStructure.userData.inventory.items = items;
            }

            // If this is the nearest market and it's open, use smart handler
            if (this.gameState.nearestStructure &&
                this.gameState.nearestStructure.userData.objectId === marketId &&
                this.gameState.inventoryOpen &&
                this.game.inventoryUI.marketUI) {
                // Use smart handler to prevent re-render race conditions
                this.game.inventoryUI.marketUI.handleServerInventoryUpdate(items, transactionId);
            }
        }
    }

    /**
     * Handle close_market_for_trade message
     * Server broadcasts this before ship trade to close any open market UIs
     */
    handleCloseMarketForTrade(payload) {
        const { marketId, reason } = payload;

        // Check if player has this market's UI open
        if (this.gameState.nearestStructure &&
            this.gameState.nearestStructure.userData.objectId === marketId &&
            this.gameState.inventoryOpen &&
            this.game.inventoryUI.marketUI) {

            console.log(`[Ship Trade] Closing market UI: ${reason}`);

            // Close the inventory/market UI
            this.game.toggleInventory();

            // Show toast notification
            if (window.ui) {
                ui.showToast('Ship departing - trade in progress', 'info');
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
                this.game.inventoryUI.renderCrateInventory();
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
                this.game.inventoryUI.renderCrateInventory();
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
            const smokeEffect = this.game.effectManager.smokeEffects.get(campfireId);
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
            // BUT only if there are no unsaved local changes (to prevent losing items user just placed)
            if (this.gameState.nearestStructure &&
                this.gameState.nearestStructure.userData.objectId === campfireId &&
                this.gameState.inventoryOpen) {
                // Check if user has unsaved local changes
                if (!this.gameState.nearestStructure.userData.inventoryDirty) {
                    this.game.crateInventory = inventory;
                    this.game.inventoryUI.renderCrateInventory();
                }
                // If dirty, skip update - user's local changes take priority
                // They will be saved when inventory is closed
            }

            // Log only when firewood is removed for clarity
            if (firewoodRemoved) {
                console.log(`Campfire ${campfireId} firewood depleted`);
            }
        }
    }

    /**
     * Handle house firewood updated
     */
    handleHouseFirewoodUpdated(payload) {
        const { houseId, inventory, firewoodRemoved } = payload;

        // Find the house object (using fast registry lookup)
        const houseObject = this.findObjectById(houseId);

        if (houseObject) {
            // Update inventory in house userData
            houseObject.userData.inventory = inventory;

            // Control smoke effects based on firewood presence
            const smokeEffect = this.game.effectManager.smokeEffects.get(houseId);
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
            // BUT only if there are no unsaved local changes (to prevent losing items user just placed)
            if (this.gameState.nearestStructure &&
                this.gameState.nearestStructure.userData.objectId === houseId &&
                this.gameState.inventoryOpen) {
                // Check if user has unsaved local changes
                if (!this.gameState.nearestStructure.userData.inventoryDirty) {
                    this.game.crateInventory = inventory;
                    this.game.inventoryUI.renderCrateInventory();
                }
                // If dirty, skip update - user's local changes take priority
            }

            // Log only when firewood is removed for clarity
            if (firewoodRemoved) {
                console.log(`House ${houseId} firewood depleted`);
            }
        }
    }

    /**
     * Handle tileworks firewood updated
     */
    handleTileworksFirewoodUpdated(payload) {
        const { tileworksId, inventory, firewoodRemoved } = payload;

        // Find the tileworks object (using fast registry lookup)
        const tileworksObject = this.findObjectById(tileworksId);

        if (tileworksObject) {
            // Update inventory in tileworks userData
            tileworksObject.userData.inventory = inventory;

            // Control smoke effects based on firewood presence
            // Tileworks has two smoke effects (chimneys)
            const smokeEffect1 = this.game.effectManager.smokeEffects.get(tileworksId + '_1');
            const smokeEffect2 = this.game.effectManager.smokeEffects.get(tileworksId + '_2');

            if (smokeEffect1 && smokeEffect2) {
                // Check if firewood still exists in inventory
                const hasFirewood = inventory.items.some(item =>
                    item.type && item.type.endsWith('firewood') && item.durability > 0
                );

                if (hasFirewood) {
                    // Start smoke if not already active
                    if (!smokeEffect1.active) {
                        smokeEffect1.start();
                    }
                    if (!smokeEffect2.active) {
                        smokeEffect2.start();
                    }
                } else {
                    // No firewood - stop spawning new smoke (existing particles will fade out)
                    if (smokeEffect1.active) {
                        smokeEffect1.stop();
                    }
                    if (smokeEffect2.active) {
                        smokeEffect2.stop();
                    }
                }
            }

            // If this is the nearest structure and inventory is open, update display
            // BUT only if there are no unsaved local changes (to prevent losing items user just placed)
            if (this.gameState.nearestStructure &&
                this.gameState.nearestStructure.userData.objectId === tileworksId &&
                this.gameState.inventoryOpen) {
                // Check if user has unsaved local changes
                if (!this.gameState.nearestStructure.userData.inventoryDirty) {
                    this.game.crateInventory = inventory;
                    this.game.inventoryUI.renderCrateInventory();
                }
                // If dirty, skip update - user's local changes take priority
            }

            // Log only when firewood is removed for clarity
            if (firewoodRemoved) {
                console.log(`Tileworks ${tileworksId} firewood depleted`);
            }
        }
    }

    /**
     * Handle tree planted message
     * Creates a visual representation of the newly planted tree
     */
    handleTreePlanted(payload) {
        const { chunkId, objectId, treeType, position, scale, quality, isGrowing, plantedAtTick, growthDurationTicks } = payload;

        console.log(`[TREE PLANTED] Received tree ${objectId} (${treeType}) at [${position}]`);

        // Normalize planted types for visual rendering (planted_vegetables -> vegetables, etc.)
        const visualType = treeType.startsWith('planted_') ? treeType.replace('planted_', '') : treeType;

        // Check if object already exists (prevent duplicates from race conditions)
        const existingObject = this.findObjectById(objectId);
        if (existingObject) {
            console.log(`[TREE PLANTED] Object ${objectId} already exists, skipping duplicate creation`);
            return;
        }

        // Billboard config - FULL SIZE values that match BillboardSystem.js exactly
        const treeBillboardConfig = {
            oak: { width: 8, height: 12, yOffset: 0, brightness: 0.65, colorR: 1.0, colorG: 1.0, colorB: 1.0, texture: 'oak.png' },
            fir: { width: 3.5, height: 5, yOffset: -0.5, brightness: 0.65, colorR: 1.0, colorG: 1.0, colorB: 1.0, texture: 'fir.png' },
            pine: { width: 4, height: 6, yOffset: -0.5, brightness: 0.95, colorR: 1.0, colorG: 1.0, colorB: 1.0, texture: 'pinefinal.webp' },
            cypress: { width: 5, height: 2.5, yOffset: 0, brightness: 0.65, colorR: 1.0, colorG: 1.0, colorB: 1.0, texture: 'cypress.png' },
            apple: { width: 8.4, height: 5, yOffset: -1.3, brightness: 0.55, colorR: 1.0, colorG: 1.0, colorB: 1.0, texture: 'applefinal.webp' },
            vegetables: { width: 0.8, height: 0.7, yOffset: -0.25, brightness: 0.85, colorR: 1.65, colorG: 1.0, colorB: 0, texture: 'vegetables.png' }
        };
        const config = treeBillboardConfig[visualType] || treeBillboardConfig.oak;

        // Create billboard at FULL SIZE (geometry stays fixed, object.scale handles growth)
        const billboard = this.sceneObjectFactory.createCylindricalBillboard(
            `./models/${config.texture}`,
            config.width,
            config.height,
            config.yOffset,
            config.brightness,
            { r: config.colorR, g: config.colorG, b: config.colorB }
        );

        billboard.position.set(position[0], position[1], position[2]);

        // Set initial visual scale based on growth progress
        const isVegetables = visualType === 'vegetables';
        const startScale = isVegetables ? 0.75 : 0.25;
        const currentScale = scale || startScale;
        billboard.scale.set(currentScale, currentScale, currentScale);

        // Store tree metadata (tick-based growth tracking)
        billboard.userData = {
            objectId: objectId,
            modelType: treeType, // Keep original type for server communication
            quality: quality,
            isGrowing: isGrowing,
            plantedAtTick: plantedAtTick,
            growthDurationTicks: growthDurationTicks || 1800,
            scale: scale,
            totalResources: 100,
            remainingResources: 100,
            chunkKey: chunkId.replace('chunk_', '')
        };

        // Add to scene
        this.scene.add(billboard);

        // Planted vegetables use same billboard as natural ones - no stake needed

        // Add to chunkObjects for proximity detection
        const chunkKey = chunkId.replace('chunk_', '');
        const chunkObjects = this.game.chunkManager.chunkObjects.get(chunkKey) || [];
        chunkObjects.push(billboard);
        this.game.chunkManager.chunkObjects.set(chunkKey, chunkObjects);

        // Register in object registry for easy lookup (store billboard directly, not wrapped)
        if (this.game && this.game.objectRegistry) {
            this.game.objectRegistry.set(objectId, billboard);
        }

        // Add physics collision for proximity detection
        if (this.game && this.game.physicsManager && this.game.physicsManager.initialized) {
            const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[treeType] || CONFIG.CONSTRUCTION.GRID_DIMENSIONS[visualType];
            if (dims && dims.radius !== undefined) {
                const shape = {
                    type: 'cylinder',
                    radius: dims.radius,
                    height: dims.height || 1.0
                };
                const collider = this.game.physicsManager.createStaticCollider(
                    objectId,
                    shape,
                    billboard.position,
                    0,
                    COLLISION_GROUPS.NATURAL
                );
                if (collider) {
                    billboard.userData.physicsHandle = collider;
                }
            }
        }

        console.log(`[TREE PLANTED] Created cylindrical billboard for ${objectId}`);

        // Add to growingTrees set so updateGrowingTrees will animate the growth
        if (isGrowing && this.gameState.growingTrees) {
            this.gameState.growingTrees.add(objectId);
        }
    }

    /**
     * Handle tree growth updates
     */
    handleTreeGrowthUpdate(payload) {
        const { chunkId, updates } = payload;

        if (!updates || updates.length === 0) return;

        for (const update of updates) {
            const { id, scale } = update;

            // Find the tree object (stored directly in registry, not wrapped)
            const treeObject = this.findObjectById(id);

            if (treeObject) {
                // Check if it's a sprite (old spherical billboard) or regular mesh/cylindrical billboard
                const isSprite = treeObject instanceof THREE.Sprite;

                if (isSprite) {
                    // For sprites (old system), scale the sprite itself
                    const targetSpriteScale = scale * 4; // Base size * scale factor
                    if (window.gsap) {
                        gsap.to(treeObject.scale, {
                            x: targetSpriteScale,
                            y: targetSpriteScale,
                            duration: 2,
                            ease: "power2.inOut"
                        });
                    } else {
                        treeObject.scale.set(targetSpriteScale, targetSpriteScale, 1);
                    }
                } else if (treeObject instanceof THREE.Mesh) {
                    // For cylindrical billboard meshes and regular meshes
                    // Check if it's a growing tree billboard (has custom shader material)
                    const isBillboard = treeObject.material && treeObject.material.type === 'ShaderMaterial' && treeObject.userData.isGrowing;

                    if (isBillboard) {
                        // For billboards, we need to scale the mesh uniformly
                        // The shader will automatically handle the cylindrical orientation
                        if (window.gsap) {
                            gsap.to(treeObject.scale, {
                                x: scale,
                                y: scale,
                                z: scale,
                                duration: 2,
                                ease: "power2.inOut"
                            });
                        } else {
                            treeObject.scale.set(scale, scale, scale);
                        }
                    } else {
                        // For regular meshes, scale normally
                        const targetScale = new THREE.Vector3(scale, scale, scale);
                        if (window.gsap) {
                            gsap.to(treeObject.scale, {
                                x: scale,
                                y: scale,
                                z: scale,
                                duration: 2,
                                ease: "power2.inOut"
                            });
                        } else {
                            treeObject.scale.copy(targetScale);
                        }
                    }
                }

                // Update userData if it exists
                if (treeObject.userData) {
                    treeObject.userData.scale = scale;

                    // If tree has finished growing, mark it as no longer growing
                    if (scale >= 1.0 && treeObject.userData.isGrowing) {
                        treeObject.userData.isGrowing = false;
                        console.log(`[TREE GROWTH] Tree ${id} fully grown!`);
                    }
                }

                console.log(`[TREE GROWTH] Updated tree ${id} scale to ${scale.toFixed(2)}`);
            }
        }
    }

    /**
     * Handle tree_growth_complete broadcast from server
     * Marks tree as fully grown on all clients
     */
    handleTreeGrowthComplete(payload) {
        const { treeId, chunkId } = payload;

        const treeObject = this.findObjectById(treeId);
        if (treeObject) {
            treeObject.userData.isGrowing = false;
            treeObject.userData.scale = 1.0;
            delete treeObject.userData.plantedAtTick;
            delete treeObject.userData.growthDurationTicks;

            // Animate to full scale
            if (window.gsap) {
                gsap.to(treeObject.scale, {
                    x: 1.0,
                    y: 1.0,
                    z: 1.0,
                    duration: 1,
                    ease: "power2.inOut"
                });
            } else {
                treeObject.scale.set(1.0, 1.0, 1.0);
            }

            console.log(`[TREE GROWTH] Tree ${treeId} marked as fully grown`);
        }
    }

    /**
     * Update all growing trees based on tick-based calculation
     * Called periodically from game loop (every 60 ticks / 1 minute)
     */
    updateGrowingTrees() {
        const currentTick = this.gameState.serverTick || 0;

        // Only update every 60 ticks (1 minute) - tree growth takes 30+ minutes
        if (currentTick - (this._lastTreeGrowthTick || 0) < 60) return;
        this._lastTreeGrowthTick = currentTick;

        // Iterate tracked growing trees instead of scene.traverse
        // This is O(growing trees) instead of O(all scene objects)
        const completedTrees = [];

        for (const objectId of this.gameState.growingTrees) {
            // Look up object from registry
            const object = this.game.objectRegistry?.get(objectId);
            if (!object || !object.userData?.isGrowing || !object.userData?.plantedAtTick) {
                // Object no longer exists or not growing - mark for removal
                completedTrees.push(objectId);
                continue;
            }

            const { plantedAtTick, growthDurationTicks, modelType } = object.userData;
            const ticksElapsed = currentTick - plantedAtTick;

            // Calculate current scale
            // Check for both 'vegetables' and 'planted_vegetables' (from chunk loading)
            const isVegetables = modelType === 'vegetables' || modelType === 'planted_vegetables';
            const startScale = isVegetables ? 0.75 : 0.25;
            const growthRange = 1.0 - startScale;
            const duration = growthDurationTicks || 1800;

            const newScale = Math.min(1.0, startScale + (growthRange * (ticksElapsed / duration)));

            // Only update visuals if scale changed significantly (>1%)
            const currentScale = object.userData.scale || startScale;
            if (Math.abs(newScale - currentScale) > 0.01) {
                object.userData.scale = newScale;

                // Update visual scale
                object.scale.set(newScale, newScale, newScale);
            }

            // Check if fully grown - MUST be outside threshold check!
            // The threshold optimization can prevent small final updates,
            // but we still need to send the completion message when growth is done.
            if (newScale >= 1.0 && !object.userData._growthCompleteSent) {
                object.userData._growthCompleteSent = true;
                object.userData.scale = 1.0; // Ensure scale is exactly 1.0
                object.scale.set(1.0, 1.0, 1.0); // Ensure visual is correct

                // Send completion message to server
                const chunkId = `chunk_${object.userData.chunkKey}`;
                this.networkManager.sendMessage('tree_growth_complete', {
                    treeId: object.userData.objectId,
                    chunkId: chunkId
                });

                console.log(`[TREE GROWTH] Sent tree_growth_complete for ${object.userData.objectId}`);

                // Mark for removal from tracking set
                completedTrees.push(objectId);
            }
        }

        // Remove completed/missing trees from tracking set
        for (const objectId of completedTrees) {
            this.gameState.growingTrees.delete(objectId);
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
        const { position, roadId, chunkId, materialType } = payload;
        const roadRadius = 0.75; // Road radius in world units
        const material = materialType || 'limestone';

        console.log(`Road placed: ${roadId} at position [${position}] in ${chunkId} (${material})`);

        // Paint road onto dirt overlay texture (immediate visual feedback)
        if (this.game.dirtOverlay) {
            this.game.dirtOverlay.paintRoadImmediate(position[0], position[2], roadRadius, material);
            console.log(`[Road] Painted road at (${position[0].toFixed(1)}, ${position[2].toFixed(1)}) radius ${roadRadius} material ${material}`);
        }

        // Store road data for persistence during chunk rebuilds
        const chunkKey = chunkId.replace('chunk_', '');
        if (this.gameState.roads) {
            if (!this.gameState.roads.has(chunkKey)) {
                this.gameState.roads.set(chunkKey, []);
            }
            // Check for duplicates before adding
            const existingRoads = this.gameState.roads.get(chunkKey);
            const isDuplicate = existingRoads.some(r => r.id === roadId);
            if (!isDuplicate) {
                existingRoads.push({
                    id: roadId,
                    x: position[0],
                    z: position[2],
                    radius: roadRadius,
                    materialType: material
                });
            }
        }

        // Update navigation map - add ROAD flag for speed bonus
        if (this.game.navigationManager) {
            const navMap = this.game.navigationManager.getChunk(chunkId);
            if (navMap) {
                navMap.addRoad(position[0], position[2], roadRadius);
                console.log(`[Nav] Added road at (${position[0].toFixed(1)}, ${position[2].toFixed(1)}) with radius ${roadRadius}`);
            }
        }

        // Visual feedback
        ui.showToast('Road placed!', 'success');
    }

    /**
     * DEPRECATED - Legacy handler for spawn_ai_command
     * No longer used - distributed system handles spawning client-side
     */
    handleSpawnAICommand(payload) {
        // No-op: Distributed system handles spawning via client-side chunk master election
        console.log('[MessageRouter] Ignoring legacy spawn_ai_command - using distributed system');
        return;
    }

    /**
     * Handle structure_repaired message (Phase 2: Repair System)
     * Updates structure quality and durability values after repair
     */
    handleStructureRepaired(payload) {
        const { structureId, quality, currentDurability, hoursUntilRuin } = payload;

        // Find structure in scene
        const structure = this.findObjectById(structureId);

        if (structure) {
            // Update structure userData with new values
            structure.userData.quality = quality;
            structure.userData.currentDurability = currentDurability;
            structure.userData.hoursUntilRuin = hoursUntilRuin;

            console.log(`[Structure Repaired] ${structureId}: Quality ${quality}, Durability ${currentDurability.toFixed(1)}`);

            // Update UI if this is the nearest structure
            if (this.gameState.nearestStructure && this.gameState.nearestStructure.userData.objectId === structureId) {
                ui.showToast(`Structure repaired! New quality: ${quality}`, 'success');
            }
        } else {
            console.warn(`[Structure Repaired] Could not find structure ${structureId} in scene`);
        }
    }

    /**
     * Handle authentication responses from server
     * Routes to AuthClient for processing
     */
    handleAuthResponse(type, payload) {
        if (this.game.authClient) {
            this.game.authClient.handleAuthResponse(type, payload);
        }
    }

    /**
     * Handle player data loaded from server
     * Applies saved player state after login
     *
     * NOTE: Position is NOT restored here. The spawn system handles positioning:
     * - New players: Random spawn in faction zone
     * - Returning players: Choose spawn location (home/random/friend)
     * - Respawn after death: Choose spawn location
     *
     * Saved position was overriding spawn selection, causing players to teleport
     * to (0,0,0) which is the default position in the database.
     */
    handlePlayerDataLoaded(payload) {
        console.log('Loading saved player data:', payload);

        // Apply inventory if available
        if (payload.inventory && this.game.playerInventory) {
            // TODO: Implement inventory loading
            console.log('Would load inventory:', payload.inventory);
        }

        // Position is intentionally NOT applied here.
        // Spawn system handles positioning via SpawnScreen selection.
        // Applying saved position would override the player's spawn choice.
        if (payload.position) {
            console.log('Saved position (not applied, spawn system handles positioning):', payload.position);
        }

        // Apply health if available
        if (payload.health !== undefined) {
            // TODO: Implement health system integration
            console.log('Would set health:', payload.health);
        }

        // Note: Hunger system is self-managing based on food in inventory
        // No need to restore hunger state - it recalculates on login

        // Apply current chunk if available
        if (payload.currentChunk) {
            console.log('Last known chunk:', payload.currentChunk);
        }

        ui.showToast('Player data loaded!', 'success');
    }

    /**
     * Handle scheduled ship spawn at dock
     * Server broadcasts this every 30 minutes for docks in loaded chunks
     */
    handleDockShipSpawned(payload) {
        const { dockId, dockPosition, dockRotation, lastShipSpawn, chunkId } = payload;

        console.log(`[MessageRouter] Ship spawned for dock ${dockId} at position [${dockPosition}], lastShipSpawn: ${lastShipSpawn}`);

        // Update scheduled ship system
        if (this.game.scheduledShipSystem) {
            this.game.scheduledShipSystem.updateDockShipSpawn(
                dockId,
                dockPosition,
                dockRotation,
                lastShipSpawn,
                chunkId
            );
        }

        // Note: Merchant spawning is handled by DockMerchantSystem.checkForNewDockedShips()
        // which runs in the update loop and only spawns when ship reaches DOCKED phase
    }

    /**
     * Handle home_set message - server notifies client their home was set
     * Called when player places a tent or completes building a house
     */
    handleHomeSet(payload) {
        const { structureId, x, z } = payload;
        console.log(`[MessageRouter] Home set to ${structureId} at (${x}, ${z})`);

        // Update gameState
        this.gameState.setHome(structureId, x, z);
    }

    /**
     * Handle position_request from server - respond with current player position
     * Used for friend spawn feature
     */
    handlePositionRequest(payload) {
        const { requestId } = payload;

        // Check 1: No player object (not spawned yet)
        if (!this.game.playerObject) {
            console.warn('[MessageRouter] Position request received but no playerObject');
            this.networkManager.sendMessage('position_response', {
                requestId,
                unavailable: true,
                reason: 'not_spawned'
            });
            return;
        }

        // Check 2: Player is dead
        if (this.game.isDead || this.game.playerCombat?.isDead) {
            console.log('[MessageRouter] Position request denied - player is dead');
            this.networkManager.sendMessage('position_response', {
                requestId,
                unavailable: true,
                reason: 'dead'
            });
            return;
        }

        // Check 3: Player is on/interacting with a mobile entity (boat/horse/cart)
        const mobileState = this.gameState.mobileEntityState;
        if (mobileState?.isActive) {
            console.log(`[MessageRouter] Position request denied - player on ${mobileState.entityType} (phase: ${mobileState.phase})`);
            this.networkManager.sendMessage('position_response', {
                requestId,
                unavailable: true,
                reason: 'on_mobile_entity',
                entityType: mobileState.entityType
            });
            return;
        }

        // Check 4: Player is climbing an outpost
        const climbState = this.gameState.climbingState;
        if (climbState?.isClimbing) {
            console.log(`[MessageRouter] Position request denied - player climbing (phase: ${climbState.climbingPhase})`);
            this.networkManager.sendMessage('position_response', {
                requestId,
                unavailable: true,
                reason: 'climbing'
            });
            return;
        }

        // Check 5: Player is on a dock
        if (this.game.playerController?.onDock) {
            console.log('[MessageRouter] Position request denied - player on dock');
            this.networkManager.sendMessage('position_response', {
                requestId,
                unavailable: true,
                reason: 'on_dock'
            });
            return;
        }

        // All checks passed - send position
        this.networkManager.sendMessage('position_response', {
            requestId,
            x: this.game.playerObject.position.x,
            z: this.game.playerObject.position.z
        });
    }

    /**
     * Calculate current durability of a structure
     * @param {object} userData - Structure's userData containing quality, lastRepairTime, etc.
     * @returns {number} Current durability
     */
    calculateStructureDurability(userData) {
        // Ruins have no durability (they just have lifespan)
        if (userData.isRuin) return 0;

        // Roads never decay
        if (userData.modelType === 'road') return userData.quality || 100;

        // Construction sites have fixed 1-hour lifespan
        if (userData.isConstructionSite) {
            const ageHours = (Date.now() - userData.lastRepairTime) / (1000 * 60 * 60);
            return ageHours >= CONSTRUCTION_SITE_LIFESPAN_HOURS ? 0 : (userData.quality || 50);
        }

        // Regular structures
        const now = Date.now();
        const elapsedMs = now - (userData.lastRepairTime || now);
        const elapsedHours = elapsedMs / (1000 * 60 * 60);

        const quality = userData.quality || 50;
        const maxLifespanHours = Math.pow(quality, DECAY_EXPONENT);
        const remainingHours = maxLifespanHours - elapsedHours;

        if (remainingHours <= 0) return 0;

        return Math.pow(remainingHours, DECAY_INVERSE);
    }

    /**
     * Check if a ruin should be removed (1-hour lifespan expired)
     * @param {object} userData - Ruin's userData
     * @returns {boolean} True if ruin should be removed
     */
    isRuinExpired(userData) {
        if (!userData.isRuin) return false;

        const ageHours = (Date.now() - userData.lastRepairTime) / (1000 * 60 * 60);
        return ageHours >= CONSTRUCTION_SITE_LIFESPAN_HOURS;
    }

    /**
     * Check all nearby structures for decay
     * Called periodically (every 60 ticks)
     */
    checkStructureDecay() {
        if (!this.game?.objectRegistry) return;

        const structureTypes = new Set(['house', 'crate', 'tent', 'outpost', 'campfire',
                                        'garden', 'market', 'dock', 'tileworks', 'ship', 'boat', 'horse', 'cart']);

        // Iterate tracked structures instead of scene.traverse
        // This is O(structures) instead of O(all scene objects)
        const completedStructures = [];

        for (const objectId of this.gameState.decayableStructures) {
            const object = this.game.objectRegistry.get(objectId);
            if (!object || !object.userData?.objectId) {
                // Object no longer exists - mark for removal
                completedStructures.push(objectId);
                continue;
            }

            const modelType = object.userData.modelType;

            // Check regular structures for decay
            if (modelType && structureTypes.has(modelType)) {
                // Skip bandit structures (shouldn't be in set, but double-check)
                if (object.userData.isBanditStructure) continue;

                // Skip if already sent decay message
                if (object.userData._decayMessageSent) continue;

                const durability = this.calculateStructureDurability(object.userData);

                if (durability <= 0) {
                    object.userData._decayMessageSent = true;

                    const chunkId = `chunk_${object.userData.chunkKey}`;
                    this.networkManager.sendMessage('convert_to_ruin', {
                        structureId: object.userData.objectId,
                        chunkId: chunkId
                    });

                    console.log(`[Decay] Sent convert_to_ruin for ${modelType} ${object.userData.objectId}`);

                    // Mark for removal from tracking set
                    completedStructures.push(objectId);
                }
            }

            // Check ruins for expiration
            if (object.userData.isRuin) {
                // Skip if already sent removal message
                if (object.userData._ruinRemovalSent) continue;

                if (this.isRuinExpired(object.userData)) {
                    object.userData._ruinRemovalSent = true;

                    const chunkId = `chunk_${object.userData.chunkKey}`;
                    this.networkManager.sendMessage('remove_ruin', {
                        structureId: object.userData.objectId,
                        chunkId: chunkId
                    });

                    console.log(`[Decay] Sent remove_ruin for ${object.userData.objectId}`);

                    // Mark for removal from tracking set
                    completedStructures.push(objectId);
                }
            }

            // Check construction sites for timeout
            if (object.userData.isConstructionSite && !object.userData.isRuin) {
                if (object.userData._constructionRemovalSent) continue;

                const durability = this.calculateStructureDurability(object.userData);

                if (durability <= 0) {
                    object.userData._constructionRemovalSent = true;

                    const chunkId = `chunk_${object.userData.chunkKey}`;
                    this.networkManager.sendMessage('remove_ruin', {
                        structureId: object.userData.objectId,
                        chunkId: chunkId
                    });

                    console.log(`[Decay] Sent remove_ruin for expired construction site ${object.userData.objectId}`);

                    // Mark for removal from tracking set
                    completedStructures.push(objectId);
                }
            }
        }

        // Remove completed/missing structures from tracking set
        for (const objectId of completedStructures) {
            this.gameState.decayableStructures.delete(objectId);
        }
    }
}
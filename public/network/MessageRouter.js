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
import { getStructureCreationQueue } from '../systems/StructureCreationQueue.js';

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
            'turn_credentials': (payload) => this.handleTurnCredentials(payload),
            'webrtc_offer': (payload) => this.handleWebRTCOffer(payload),
            'webrtc_answer': (payload) => this.handleWebRTCAnswer(payload),
            'webrtc_ice_candidate': (payload) => this.handleWebRTCIceCandidate(payload),
            'proximity_update': (payload) => this.handleProximityUpdate(payload),
            'object_removed': (payload) => this.handleObjectRemoved(payload),
            'object_added': (payload) => this.handleObjectAdded(payload),
            'boat_sinking': (payload) => this.handleBoatSinking(payload),
            'resource_harvested': (payload) => this.handleResourceHarvested(payload),
            'harvest_lock_failed': (payload) => this.handleHarvestLockFailed(payload),
            'chunk_objects_state': (payload) => this.handleChunkObjectsState(payload),
            'crate_inventory_response': (payload) => this.handleCrateInventoryResponse(payload),
            'crate_inventory_updated': (payload) => this.handleCrateInventoryUpdated(payload),
            'crate_save_denied': (payload) => this.handleCrateSaveDenied(payload),
            'inventory_lock_response': (payload) => this.handleInventoryLockResponse(payload),
            'lock_confirm_response': (payload) => this.handleLockConfirmResponse(payload),
            'structure_lock_changed': (payload) => this.handleStructureLockChanged(payload),
            'lock_stolen': (payload) => this.handleLockStolen(payload),
            'market_inventory_updated': (payload) => this.handleMarketInventoryUpdated(payload),
            'close_market_for_trade': (payload) => this.handleCloseMarketForTrade(payload),
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
            'structure_damaged': (payload) => this.handleStructureDamaged(payload),
            'structure_sold_to_proprietor': (payload) => this.handleStructureSoldToProprietor(payload),
            'structure_militia_updated': (payload) => this.handleStructureMilitiaUpdated(payload),
            'request_militia_response': (payload) => this.handleRequestMilitiaResponse(payload),
            'request_outpost_militia_response': (payload) => this.handleRequestOutpostMilitiaResponse(payload),
            'request_artillery_militia_response': (payload) => this.handleRequestArtilleryMilitiaResponse(payload),
            'dock_ship_spawned': (payload) => this.handleDockShipSpawned(payload),
            'market_shipments_toggled': (payload) => this.handleMarketShipmentsToggled(payload),
            'market_merchant_ships_toggled': (payload) => this.handleMarketMerchantShipsToggled(payload),
            'home_set': (payload) => this.handleHomeSet(payload),
            'horse_purchased': (payload) => this.handleHorsePurchased(payload),

            // NPC Baker responses
            'npc_collect_apples_response': (payload) => this.handleNPCCollectApplesResponse(payload),
            'npc_collect_response': (payload) => this.handleNPCCollectResponse(payload),
            'npc_deposit_response': (payload) => this.handleNPCDepositResponse(payload),
            'npc_remove_firewood_response': (payload) => this.handleNPCRemoveFirewoodResponse(payload),
            'npc_clear_deposit_response': (payload) => this.handleNPCClearDepositResponse(payload),

            // Authentication responses
            'register_response': (payload) => this.handleAuthResponse('register_response', payload),
            'login_response': (payload) => this.handleAuthResponse('login_response', payload),
            'session_validation': (payload) => this.handleAuthResponse('session_validation', payload),
            'logout_response': (payload) => this.handleAuthResponse('logout_response', payload),
            'auth_upgrade_success': (payload) => this.handleAuthResponse('auth_upgrade_success', payload),
            'player_data_loaded': (payload) => this.handlePlayerDataLoaded(payload),
            'kicked': (payload) => this.handleKicked(payload),
            'admin_broadcast': (payload) => this.handleAdminBroadcast(payload),
            'influence_response': (payload) => this.handleInfluenceResponse(payload),

            // Faction system responses - emit via GameStateManager for FactionPanel
            'join_faction_response': (payload) => this.emitFactionEvent('join_faction_response', payload),
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
            'release_crate_response': (payload) => this.handleReleaseCrateResponse(payload),

            // Warehouse crate load/unload responses
            'warehouse_load_response': (payload) => this.handleWarehouseLoadResponse(payload),
            'warehouse_unload_response': (payload) => this.handleWarehouseUnloadResponse(payload),
            'warehouse_state_updated': (payload) => this.handleWarehouseStateUpdated(payload),

            // Ship cargo load responses (artillery/horse)
            'claim_artillery_response': (payload) => this.handleClaimArtilleryResponse(payload),
            'claim_horse_response': (payload) => this.handleClaimHorseResponse(payload),
            'claim_state_response': (payload) => this.handleClaimStateResponse(payload),

            // Construction site sync
            'construction_materials_updated': (payload) => this.handleConstructionMaterialsUpdated(payload),

            // Bandit death sync
            'bandit_death_recorded': (payload) => this.handleBanditDeathRecorded(payload),

            // Bear/Deer death sync (60-minute respawn cooldown)
            'bear_death_recorded': (payload) => this.handleBearDeathRecorded(payload),
            'deer_death_recorded': (payload) => this.handleDeerDeathRecorded(payload)
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
     * Handle warehouse_load_response from server
     * Called after attempting to load a crate into a warehouse
     */
    handleWarehouseLoadResponse(payload) {
        const { success, warehouseId, crateId, loadedCount, reason } = payload;

        if (!success) {
            ui.showToast(reason || 'Failed to load crate', 'warning');
            return;
        }

        // Update the warehouse's local state
        const warehouse = this.game.objectRegistry?.get(warehouseId);
        if (warehouse) {
            if (!warehouse.userData.loadedCrates) {
                warehouse.userData.loadedCrates = [];
            }
            // We don't have full crate data client-side, just track count via loadedCount
            warehouse.userData.loadedCrates.length = loadedCount;
        }

        // Remove the crate mesh from scene (server already removed from DB)
        const crate = this.game.objectRegistry?.get(crateId);
        if (crate) {
            // Remove physics collider
            if (this.game.physicsManager) {
                this.game.physicsManager.removeCollider(crateId);
            }

            // Remove from object registry
            this.game.objectRegistry?.delete(crateId);

            // Remove from chunk objects
            if (crate.userData.chunkKey && this.game.chunkManager?.chunkObjects) {
                const chunkObjects = this.game.chunkManager.chunkObjects.get(crate.userData.chunkKey);
                if (chunkObjects) {
                    const index = chunkObjects.indexOf(crate);
                    if (index !== -1) {
                        chunkObjects.splice(index, 1);
                    }
                }
            }

            // Remove from scene
            if (crate.parent) {
                crate.parent.remove(crate);
            }
        }

        ui.showToast(`Crate stored (${loadedCount}/4)`, 'info');
    }

    /**
     * Handle warehouse_unload_response from server
     * Called after attempting to unload a crate from a warehouse
     */
    handleWarehouseUnloadResponse(payload) {
        const { success, warehouseId, crateId, loadedCount, cratePosition, crateRotation,
                crateOwner, crateQuality, crateLastRepairTime, crateInventory, crateChunkKey, reason } = payload;

        if (!success) {
            ui.showToast(reason || 'Failed to unload crate', 'warning');
            return;
        }

        // Update the warehouse's local state
        const warehouse = this.game.objectRegistry?.get(warehouseId);
        if (warehouse) {
            if (!warehouse.userData.loadedCrates) {
                warehouse.userData.loadedCrates = [];
            }
            warehouse.userData.loadedCrates.length = loadedCount;
        }

        // The object_added broadcast will handle creating the crate mesh
        // Just show toast
        ui.showToast(`Crate retrieved (${loadedCount}/4 remaining)`, 'info');
    }

    /**
     * Handle warehouse_state_updated broadcast
     * Called when warehouse state changes (for nearby players)
     */
    handleWarehouseStateUpdated(payload) {
        const { warehouseId, loadedCount } = payload;

        const warehouse = this.game.objectRegistry?.get(warehouseId);
        if (warehouse) {
            if (!warehouse.userData.loadedCrates) {
                warehouse.userData.loadedCrates = [];
            }
            warehouse.userData.loadedCrates.length = loadedCount;
        }
    }

    /**
     * Handle claim_artillery_response from server
     * Called after attempting to load artillery onto a ship
     */
    handleClaimArtilleryResponse(payload) {
        const { entityId, success, reason } = payload;

        if (this.game.pendingArtilleryClaim && this.game.pendingArtilleryClaim.entityId === entityId) {
            if (success) {
                this.game.pendingArtilleryClaim.resolve(payload);
            } else {
                this.game.pendingArtilleryClaim.reject(new Error(reason || 'Claim failed'));
            }
            this.game.pendingArtilleryClaim = null;
        }
    }

    /**
     * Handle claim_horse_response from server
     * Called after attempting to load a horse onto a ship
     */
    handleClaimHorseResponse(payload) {
        const { entityId, success, reason } = payload;

        if (this.game.pendingHorseClaim && this.game.pendingHorseClaim.entityId === entityId) {
            if (success) {
                this.game.pendingHorseClaim.resolve(payload);
            } else {
                this.game.pendingHorseClaim.reject(new Error(reason || 'Claim failed'));
            }
            this.game.pendingHorseClaim = null;
        }
    }

    /**
     * Handle claim_state_response from server
     * Called when client queries the actual claim state after a timeout
     * Used to reconcile client/server state when claim response was late
     */
    handleClaimStateResponse(payload) {
        const { entityId, claimedByMe } = payload;

        if (this.game.pendingClaimReconciliation?.entityId === entityId) {
            if (claimedByMe) {
                this.game.pendingClaimReconciliation.resolve({ success: true, wasLate: true });
            } else {
                this.game.pendingClaimReconciliation.reject(new Error('Claim failed'));
            }
            this.game.pendingClaimReconciliation = null;
        }
    }

    /**
     * Handle tick message from server for deterministic simulation sync
     */
    handleTick(payload) {
        const tickStart = performance.now();

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

                // Check militia spawns on tick (structures with hasMilitia flag)
                this.game.banditController.checkMilitiaSpawnsOnTick(chunkX, chunkZ);

                // Authority broadcasts state
                this.game.banditController.broadcastAuthorityState();
            }

            // Check deer spawns on tick (coordinates spawn authority across peers)
            if (this.game.deerController) {
                this.game.deerController.checkSpawnsOnTick(chunkX, chunkZ);
            }

            // Check brown bear spawns on tick
            if (this.game.brownBearController) {
                this.game.brownBearController.checkSpawnsOnTick(chunkX, chunkZ);

                // Authority broadcasts state
                this.game.brownBearController.broadcastAuthorityState();
            }

            // Check proprietor worker spawns on tick (sold worker structures)
            // PERF: Cache controller list to avoid array allocation every tick
            if (!this._workerControllers) {
                this._workerControllers = [];
            }
            const wc = this._workerControllers;
            wc[0] = this.game.bakerController;
            wc[1] = this.game.woodcutterController;
            wc[2] = this.game.gardenerController;
            wc[3] = this.game.minerController;
            wc[4] = this.game.stoneMasonController;
            wc[5] = this.game.blacksmithController;
            wc[6] = this.game.ironWorkerController;
            wc[7] = this.game.tileWorkerController;
            wc[8] = this.game.fishermanController;
            for (let i = 0; i < 9; i++) {
                wc[i]?.checkProprietorSpawnsOnTick?.(chunkX, chunkZ);
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

        // DEBUG: Log slow tick processing
        const tickTime = performance.now() - tickStart;
        if (tickTime > 5) { // Log if tick takes more than 5ms
            console.error(`[Tick] Slow tick processing: ${tickTime.toFixed(1)}ms (tick=${payload.tick})`);
        }
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

        // Skip player position broadcast when piloting - ship position is broadcast via mobile_entity_position
        if (game.gameState.vehicleState?.isActive()) return;

        game.networkManager.broadcastP2P({
            type: 'player_tick',
            p: game.playerObject.position.toArray(),
            m: game.gameState.isMoving,
            t: game.gameState.isMoving ? game.gameState.playerTargetPosition?.toArray() : null,
            hr: game.playerCombat?.hasRifle() || false,
            c: game.playerCombat?.getShowCombatAnimation() || false,
            u: game.gameState.username || null,
            s: game.playerController?.getSpeedMultiplier() || 1.0,
            f: game.gameState.factionId
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

        // If playerObject exists, this is a reconnect (not initial load)
        // Re-register with the server to restore message routing
        if (this.game.playerObject) {
            // Re-validate session to restore ws.username etc on server
            if (this.game.authClient && this.game.authClient.hasStoredSession()) {
                this.game.authClient.attemptAutoLogin().catch(() => {});
            }
            // Re-join chunk to restore clientId routing and proximity updates
            this.joinChunkAtSpawn();
        }
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
                false,  // limestoneAvailable
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
        const _t = { start: performance.now() };

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

        _t.afterDeferred = performance.now();

        // Group changes by chunk
        const changesByChunk = new Map();
        let addCount = 0;
        let removeCount = 0;

        // IMPORTANT: Process removals FIRST to populate cache before adds are processed
        // This prevents removed natural objects from being recreated
        const vState = this.gameState.vehicleState;
        objectChanges.forEach(change => {
            if (change.action === 'remove') {
                removeCount++;
                // Handle missing chunkId (old format or corrupted data)
                if (!change.chunkId) {
                    return;
                }

                // DEBUG: Detect if piloted entity is being marked for removal
                if (vState?.pilotingEntityId === change.id) {
                    console.error('[handleChunkObjectsState] PILOTED ENTITY IN REMOVAL LIST!', {
                        changeId: change.id,
                        chunkId: change.chunkId,
                        pilotingEntityType: vState.pilotingEntityType,
                        pilotingChunkKey: vState.pilotingEntity?.userData?.chunkKey
                    });
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

        _t.afterRemovals = performance.now();

        // Queue adds for deferred processing (prevents stutter on chunk transitions)
        // They will check the cache and skip removed objects when processed
        objectChanges.forEach(change => {
            if (change.action === 'add') {
                addCount++;

                // Immediately remove decayed structures instead of waiting 60s for checkStructureDecay
                if (change.currentDurability !== undefined && change.currentDurability <= 0 &&
                    !change.isBanditStructure && !change.isBrownBearStructure && !change.isSoldWorkerStructure &&
                    !change.isDeerTreeStructure) {
                    // Ruins no longer auto-expire - always load them
                    if (change.isRuin) {
                        // Skip removal, fall through to line 594 for creation
                    } else {
                        // Decayed structure or expired construction site — remove from DB
                        this.networkManager.sendMessage('remove_ruin', {
                            structureId: change.id,
                            chunkId: change.chunkId
                        });
                        return;
                    }
                }

                this.sceneObjectFactory.queueObjectCreation(change);
            }
        });

        _t.afterQueueAdds = performance.now();

        // Apply removals to existing chunks
        changesByChunk.forEach((_, chunkKey) => {
            this.game.chunkManager.applyChunkRemovals(chunkKey);
        });

        _t.afterApplyRemovals = performance.now();


        // Mark that we've received initial server state
        const wasFirstState = !this.gameState.receivedInitialServerState;
        this.gameState.receivedInitialServerState = true;

        // If this was the first chunk state, process any pending chunk requests
        if (wasFirstState) {
            this.game.chunkManager.processPendingChunksAfterServerState();

            // Always ensure full 21x21 grid exists around player
            // This handles both initial spawn AND respawn scenarios
            // (updateChunksAroundPlayer skips chunks already in loadedChunks)
            this.game.chunkManager.updateChunksAroundPlayer(
                this.gameState.currentPlayerChunkX,
                this.gameState.currentPlayerChunkZ
            );

            // Force re-check tent presence now that initial objects are loaded
            // This handles the case where player spawns near a tent
            if (this.game.banditController) {
                this.game.banditController.updateTentPresence(
                    this.gameState.currentPlayerChunkX,
                    this.gameState.currentPlayerChunkZ,
                    true // force
                );
            }

            // Bug 2 Fix: Force re-check den presence for brown bears
            if (this.game.brownBearController) {
                this.game.brownBearController.updateDenPresence(
                    this.gameState.currentPlayerChunkX,
                    this.gameState.currentPlayerChunkZ,
                    true // force
                );
            }

            // Bug 2 Fix: Force re-check deer tree presence
            if (this.game.deerController) {
                this.game.deerController._updateDeerTreePresence(
                    this.gameState.currentPlayerChunkX,
                    this.gameState.currentPlayerChunkZ,
                    true // force
                );
            }

            // Force trapper spawn/sync for initial server state
            if (this.game.trapperSystem) {
                this.game.trapperSystem.onPlayerChunkChanged(
                    this.gameState.currentPlayerChunkX,
                    this.gameState.currentPlayerChunkZ,
                    null,  // oldChunkX - null indicates initial spawn
                    null   // oldChunkZ
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

                // Pre-group objectChanges by chunkId for O(1) lookups
                const changesByChunk = new Map();
                for (const change of objectChanges) {
                    const cid = change.chunkId;
                    if (!changesByChunk.has(cid)) {
                        changesByChunk.set(cid, []);
                    }
                    changesByChunk.get(cid).push(change);
                }

                // Check each chunk in the grid
                for (let dx = -radius; dx <= radius; dx++) {
                    for (let dz = -radius; dz <= radius; dz++) {
                        const checkChunkId = `chunk_${centerX + dx},${centerZ + dz}`;
                        const chunkChanges = changesByChunk.get(checkChunkId) || [];
                        this.game.chunkObjectGenerator.checkAndGenerateBanditCamp(
                            checkChunkId,
                            chunkChanges,
                            this.game.networkManager,
                            this.game.structureManager
                        );
                        this.game.chunkObjectGenerator.checkAndGenerateBrownBearDen(
                            checkChunkId,
                            chunkChanges,
                            this.game.networkManager
                        );
                        this.game.chunkObjectGenerator.checkAndGenerateDeerTree(
                            checkChunkId,
                            chunkChanges,
                            this.game.networkManager
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
            return;
        }

        // If this is a mobile entity claimed by a peer, check if we should skip removal.
        //
        // REUSE cases (mesh reparented to vehicle): Skip removal - mesh is still in use
        // CREATE NEW cases (peer created separate mesh): Allow removal - static should be disposed
        //   and server will send object_added on release to recreate it properly
        if (payload.isMobileClaim && payload.claimedBy) {
            const claimingPeerId = payload.claimedBy;
            const peerData = this.networkManager?.peerGameData?.get(claimingPeerId);

            // REUSE: Crate loaded on cart/ship - mesh was reparented, don't dispose
            if (peerData?.loadedCrate?.crateId === payload.objectId) {
                return;
            }

            // REUSE: Artillery loaded on ship - mesh was reparented, don't dispose
            if (peerData?.loadedArtillery?.some(a => a.artilleryId === payload.objectId)) {
                return;
            }

            // REUSE: Horse loaded on ship - mesh was reparented, don't dispose
            if (peerData?.loadedHorses?.some(h => h.horseId === payload.objectId)) {
                return;
            }

            // CREATE NEW cases (mobileEntity, towedCart, mannedArtillery) intentionally
            // fall through to allow disposal. Peer has their own mesh, and server will
            // send object_added on release to create a fresh, properly-registered static.
        }

        // If we're currently chopping/harvesting this object, cancel our action
        // This prevents duplicate log spawns when multiple players chop the same tree
        const activeAction = this.game.gameState?.activeAction;
        if (activeAction?.object?.id === payload.objectId) {
            // Stop sound if playing
            if (activeAction.sound) {
                activeAction.sound.stop();
            }

            // Stop chopping animation (accessed via this.game.choppingAction)
            if (this.game.choppingAction) {
                this.game.choppingAction.stop();
            }

            // Clear active action
            this.game.gameState.activeAction = null;

            // Clear UI progress bar
            ui.updateChoppingProgress(0);
        }

        // Remove from structure creation queue if still queued (prevents ghost registration)
        // This must happen BEFORE any other processing to handle the race condition where
        // object_removed arrives before the queued structure is created
        const queue = getStructureCreationQueue();
        queue.removeQueued(payload.objectId);

        // Get the object before removing it (for billboard cleanup and structure height removal)
        const objectToRemove = this.findObjectById(payload.objectId);

        // Clean up dying structure smoke effect if present
        if (this.game.effectManager?.hasDyingStructureSmoke(payload.objectId)) {
            this.game.effectManager.removeDyingStructureSmoke(payload.objectId);
        }

        // Remove structure heights BEFORE removing the object (need position/rotation data)
        if (objectToRemove) {
            const modelType = objectToRemove.userData?.modelType;
            // NOTE: General structure heights disabled, but docks use terrain-based rendering

            // Remove dock terrain leveling when dock is demolished
            if (modelType === 'dock' && this.game.terrainGenerator) {
                const dockX = objectToRemove.position.x;
                const dockZ = objectToRemove.position.z;
                this.game.terrainGenerator.removeLeveledArea(dockX, dockZ);

                // Force clipmap to refresh the affected terrain region
                if (this.game.clipmap) {
                    this.game.clipmap.forceRefreshRegion(dockX, dockZ, 12);
                }

                // Also remove from gameState.docks persistence
                const chunkKey = objectToRemove.userData?.chunkKey;
                if (chunkKey && this.game.gameState?.docks?.has(chunkKey)) {
                    const docks = this.game.gameState.docks.get(chunkKey);
                    const dockId = payload.objectId;
                    const idx = docks.findIndex(d => d.id === dockId);
                    if (idx !== -1) {
                        docks.splice(idx, 1);
                    }
                }
            }
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

        // Clear home spawn if this was the player's home structure
        if (this.game.gameState?.home?.structureId === payload.objectId) {
            this.game.gameState.clearHome();
        }

        // Unregister AI spawn structures from detection registries
        // Uses fallback to payload data when objectToRemove is null (handles queue race condition)
        if (this.game.gameState) {
            const chunkKey = objectToRemove?.userData?.chunkKey || payload.chunkId?.replace('chunk_', '');

            if (chunkKey) {
                // Bandit structures: tent, outpost, campfire, horse
                const banditTypes = new Set(['tent', 'outpost', 'campfire', 'horse']);
                const isBanditStructure = objectToRemove?.userData?.isBanditStructure ||
                    banditTypes.has(payload.name);
                if (isBanditStructure) {
                    this.game.gameState.unregisterBanditStructure(chunkKey, payload.objectId);
                }

                // Brown bear structures: bearden
                const isBrownBearStructure = objectToRemove?.userData?.isBrownBearStructure ||
                    payload.name === 'bearden';
                if (isBrownBearStructure) {
                    this.game.gameState.unregisterBrownBearStructure(chunkKey, payload.objectId);
                }

                // Deer/Apple tree structures: deertree, apple
                const isDeerTreeStructure = objectToRemove?.userData?.isDeerTreeStructure ||
                    payload.name === 'deertree' || payload.name === 'apple';
                if (isDeerTreeStructure) {
                    this.game.gameState.unregisterDeerTreeStructure(chunkKey, payload.objectId);
                }

                // Militia structures: tent/outpost with hasMilitia flag
                const objectHasMilitia = objectToRemove?.userData?.hasMilitia;
                const isMilitiaStructure = objectHasMilitia &&
                    (payload.name === 'tent' || payload.name === 'outpost');
                if (isMilitiaStructure) {
                    this.game.gameState.unregisterMilitiaStructure(chunkKey, payload.objectId);
                }

                // Market structures: unregister for Baker AI and despawn connected workers
                if (payload.name === 'market') {
                    this.game.gameState.unregisterMarket(chunkKey, payload.objectId);
                    // Invalidate worker cache so bakery/gardener tooltips update
                    if (typeof ui !== 'undefined') ui._workerCache = null;

                    // Despawn workers that depended on this market
                    const marketPos = objectToRemove?.position || payload.position;
                    if (marketPos) {
                        if (this.game.bakerController) {
                            this.game.bakerController.onMarketDestroyed(marketPos);
                        }
                        if (this.game.gardenerController) {
                            this.game.gardenerController.onMarketDestroyed(marketPos);
                        }
                        if (this.game.woodcutterController) {
                            this.game.woodcutterController.onMarketDestroyed(marketPos);
                        }
                    }
                }

                // Dock structures: invalidate market cache so tooltip updates
                if (payload.name === 'dock') {
                    if (typeof ui !== 'undefined') ui._marketDockCache = null;
                }

                // Bakery structures: unregister for Baker AI and notify controller
                if (payload.name === 'bakery') {
                    this.game.gameState.unregisterBakery(chunkKey, payload.objectId);
                    // Despawn baker if one exists for this bakery
                    if (this.game.bakerController) {
                        this.game.bakerController.onBakeryDestroyed(payload.objectId);
                    }
                }

                // Gardener structures: unregister for Gardener AI and notify controller
                if (payload.name === 'gardener') {
                    this.game.gameState.unregisterGardener(chunkKey, payload.objectId);
                    // Despawn gardener if one exists for this building
                    if (this.game.gardenerController) {
                        this.game.gardenerController.onGardenerBuildingDestroyed(payload.objectId);
                    }
                }

                // Woodcutter structures: unregister for Woodcutter AI and notify controller
                if (payload.name === 'woodcutter') {
                    this.game.gameState.unregisterWoodcutter(chunkKey, payload.objectId);
                    // Despawn woodcutter if one exists for this building
                    if (this.game.woodcutterController) {
                        this.game.woodcutterController.onWoodcutterBuildingDestroyed(payload.objectId);
                    }
                }

                // Miner structures: unregister for Miner AI and notify controller
                if (payload.name === 'miner') {
                    this.game.gameState.unregisterMiner(chunkKey, payload.objectId);
                    // Despawn miner if one exists for this building
                    if (this.game.minerController) {
                        this.game.minerController.onMinerBuildingDestroyed(payload.objectId);
                    }
                }

                // Ironworks structures: unregister for IronWorker AI and notify controller
                if (payload.name === 'ironworks') {
                    this.game.gameState.unregisterIronworks(chunkKey, payload.objectId);
                    // Despawn iron worker if one exists for this building
                    if (this.game.ironWorkerController) {
                        this.game.ironWorkerController.onIronworksDestroyed(payload.objectId);
                    }
                }

                // Tileworks structures: unregister for TileWorker AI and notify controller
                if (payload.name === 'tileworks') {
                    this.game.gameState.unregisterTileworks(chunkKey, payload.objectId);
                    // Despawn tile worker if one exists for this building
                    if (this.game.tileWorkerController) {
                        this.game.tileWorkerController.onTileworksDestroyed(payload.objectId);
                    }
                }

                // Blacksmith structures: unregister for Blacksmith AI and notify controller
                if (payload.name === 'blacksmith') {
                    this.game.gameState.unregisterBlacksmith(chunkKey, payload.objectId);
                    // Despawn blacksmith if one exists for this building
                    if (this.game.blacksmithController) {
                        this.game.blacksmithController.onBlacksmithDestroyed(payload.objectId);
                    }
                }

                // Fisherman structures: unregister for Fisherman AI and notify controller
                if (payload.name === 'fisherman') {
                    this.game.gameState.unregisterFisherman(chunkKey, payload.objectId);
                    // Despawn fisherman if one exists for this building
                    if (this.game.fishermanController) {
                        this.game.fishermanController.onFishermanDestroyed(payload.objectId);
                    }
                }

                // Militia cleanup: despawn militia if structure had one
                // This handles cases where structure is destroyed before militia dies naturally
                const hasMilitia = objectToRemove?.userData?.hasMilitia;
                if (hasMilitia && this.game.banditController) {
                    // Militia entity ID matches the structure ID
                    if (this.game.banditController.entities.has(payload.objectId)) {
                        this.game.banditController._destroyEntity(payload.objectId);
                    }
                }
            }
        }

        // Spawn falling tree animation for pine/apple trees before removal
        if (objectToRemove) {
            const modelType = objectToRemove.userData?.modelType;
            if ((modelType === 'pine' || modelType === 'apple') &&
                this.game.fallingTreeSystem &&
                this.game.playerObject) {
                this.game.fallingTreeSystem.spawnFallingTree(
                    objectToRemove,
                    this.game.playerObject.position
                );
            }
        }

        // Skip scene removal if boat is currently sinking - BoatSinkingSystem handles removal
        const isSinkingBoat = this.game.boatSinkingSystem?.isSinking(payload.objectId);
        if (isSinkingBoat) {
            // Still clean up tracking but don't remove from scene (sinking animation needs it)
            if (this.game.activeProximityObjects.has(payload.objectId)) {
                this.game.activeProximityObjects.delete(payload.objectId);
            }
            if (this.game.objectRegistry?.has(payload.objectId)) {
                this.game.objectRegistry.delete(payload.objectId);
            }
            return; // BoatSinkingSystem will remove mesh when animation completes
        }

        // Skip removal if this is a piloted/active mobile entity
        const vState = this.gameState.vehicleState;
        const isActiveEntity = (
            vState?.pilotingEntityId === payload.objectId ||
            vState?.towedEntity?.id === payload.objectId ||
            vState?.mannedArtillery?.artilleryId === payload.objectId
        );
        if (isActiveEntity) {
            // Don't remove - entity is actively controlled by this player
            return;
        }

        const removed = this.game.chunkManager.removeObject(payload.objectId)
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
                // Remove 3D model instance (only tree model types have them; method no-ops if absent)
                if (this.game.rockModelSystem && CONFIG.TREE_MODEL_TYPES.includes(modelType)) {
                    this.game.rockModelSystem.removeRockInstance(objectToRemove);
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
            }
        }

        // Update proximity after server confirms removal
        this.game.checkProximityToObjects();

        // Mark dirt overlay for repaint to remove structure's dirt patch
        if (this.game.dirtOverlay) {
            this.game.dirtOverlay.markDirty();
        }
    }

    /**
     * Handle boat sinking broadcast from server (artillery destroyed a stationary boat)
     * Plays crash sound and sinking animation for all clients
     */
    handleBoatSinking(payload) {
        const { objectId, modelType } = payload;

        // Find boat mesh in scene
        const boatMesh = this.game.objectRegistry?.get(objectId);
        if (!boatMesh) {
            return;
        }

        // Skip if already sinking (attacker already started their local animation)
        if (this.game.boatSinkingSystem?.isSinking(objectId)) {
            return;
        }

        // Play crash sound
        if (this.game.audioManager) {
            this.game.audioManager.playBoatCrashSound(modelType);
        }

        // Start sinking animation - system handles mesh disposal when complete
        if (this.game.boatSinkingSystem) {
            this.game.boatSinkingSystem.startSinking(boatMesh, objectId, null);
        }

        // Remove from objectRegistry so handleObjectRemoved doesn't try to remove it again
        // (the sinking system will dispose the mesh when animation completes)
        if (this.game.objectRegistry?.has(objectId)) {
            this.game.objectRegistry.delete(objectId);
        }
    }

    /**
     * Handle object addition
     */
    handleObjectAdded(payload) {
        const { objectId, objectType, position, quality, scale, chunkId,
                totalResources, remainingResources, rotation, isConstructionSite,
                targetStructure, requiredMaterials, materials, finalFoundationY, inventory,
                currentDurability, hoursUntilRuin, owner, ownerFactionId, isBanditStructure, materialType,
                isMobileRelease, isBrownBearStructure, isDeerTreeStructure,
                hasMilitia, militiaOwner, militiaFaction, militiaType,
                fallDirection, shirtColor, isCorpse, corpseType, displayName } = payload;

        const MOBILE_TYPES = ['boat', 'sailboat', 'ship2', 'horse'];

        // Guard against undefined objectId
        if (!objectId) {
            console.error('[handleObjectAdded] Received object with undefined objectId:', { objectType, position, chunkId });
            return;
        }

        // Invalidate UI caches when dock/market structures are added
        // This ensures tooltips correctly show connection status for newly built structures
        if (objectType === 'dock' && typeof ui !== 'undefined') {
            ui._marketDockCache = null;
        }
        if (objectType === 'market' && typeof ui !== 'undefined') {
            ui._workerCache = null;
        }

        // Check if we have a hidden static object that should be re-shown
        // This handles the case where we hid the static mesh when a peer attached it (cart/crate)
        const existingHidden = this.game?.objectRegistry?.get(objectId);
        if (existingHidden && existingHidden.visible === false && isMobileRelease) {
            existingHidden.visible = true;
        }

        // Validate chunkId and calculate chunkKey
        let chunkKey;
        if (!chunkId || chunkId === 'chunk_undefined' || chunkId === 'chunk_NaN,NaN') {
            console.error('[handleObjectAdded] Invalid chunkId:', chunkId, 'for object:', objectId, 'at position:', position);
            // Calculate the correct chunk from position using ChunkCoordinates
            const worldX = position[0];
            const worldZ = position[2];
            const correctedChunkId = ChunkCoordinates.worldToChunkId(worldX, worldZ);
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
            // Update existing object properties (use ?? to preserve 0 as valid value)
            existingObject.userData.remainingResources = remainingResources ?? null;
            existingObject.userData.totalResources = totalResources ?? null;
            // Update owner (used when house ownership is cleared/transferred)
            if (owner !== undefined) {
                existingObject.userData.owner = owner;
            }
            // Update ownerFactionId (needed for militia button on artillery after ship unload)
            if (ownerFactionId !== undefined) {
                existingObject.userData.ownerFactionId = ownerFactionId;
            }
            // Update militia fields (needed for militia respawn after disconnect cleanup)
            if (hasMilitia !== undefined) {
                existingObject.userData.hasMilitia = hasMilitia;
                existingObject.userData.militiaOwner = militiaOwner || null;
                existingObject.userData.militiaFaction = militiaFaction || null;
                existingObject.userData.militiaType = militiaType || null;

                // Update militia registry when hasMilitia changes on existing object
                const modelType = existingObject.userData.modelType;
                if ((modelType === 'tent' || modelType === 'outpost') && this.game.gameState) {
                    if (hasMilitia) {
                        this.game.gameState.registerMilitiaStructure(chunkKey, {
                            id: objectId,
                            position: {
                                x: existingObject.position.x,
                                y: existingObject.position.y,
                                z: existingObject.position.z
                            },
                            type: modelType,
                            militiaOwner: militiaOwner,
                            militiaFaction: militiaFaction,
                            militiaType: militiaType
                        });
                    } else {
                        this.game.gameState.unregisterMilitiaStructure(chunkKey, objectId);
                    }
                }
            }

            // Handle mobile entity releases (horse/boat dismount) - update position and physics
            if (isMobileRelease && position) {
                // FIX: Unparent from cart/boat BEFORE setting position
                // If crate is still parented to a cart, position.set() would apply as local coords
                const parent = existingObject.parent;
                if (parent && parent !== this.scene) {
                    // Remove from parent (cart/boat)
                    parent.remove(existingObject);
                    // Add directly to scene so position is in world coords
                    this.scene.add(existingObject);

                    // Clear isPeerCrate flag - this is now a "real" crate placed by server
                    // Prevents subsequent P2P sync handleCrateUnloaded from disposing it
                    if (existingObject.userData.isPeerCrate) {
                        delete existingObject.userData.isPeerCrate;
                        delete existingObject.userData.peerId;
                    }
                }

                // Update mesh position (now in world coordinates)
                existingObject.position.set(position[0], position[1], position[2]);
                if (rotation !== undefined) {
                    existingObject.rotation.y = rotation; // Already in radians
                }

                // Get old chunk key before updating
                const oldChunkKey = existingObject.userData.chunkKey;

                // Update chunkKey - critical for re-mounting after crossing chunk boundaries
                existingObject.userData.chunkKey = chunkKey;

                // Update durability fields from server (may have changed during ride due to decay)
                if (quality !== undefined) existingObject.userData.quality = quality;
                if (currentDurability !== undefined) existingObject.userData.currentDurability = currentDurability;
                if (hoursUntilRuin !== undefined) existingObject.userData.hoursUntilRuin = hoursUntilRuin;

                // Ensure object is in correct chunkObjects after mobile release
                // Handles both chunk-change case and same-chunk case where object
                // was removed from chunkObjects during ship loading
                if (this.game.chunkManager) {
                    const chunkManager = this.game.chunkManager;

                    // Remove from old chunk's array if chunk changed
                    if (oldChunkKey && oldChunkKey !== chunkKey) {
                        const oldChunkObjects = chunkManager.chunkObjects.get(oldChunkKey);
                        if (oldChunkObjects) {
                            const index = oldChunkObjects.indexOf(existingObject);
                            if (index !== -1) {
                                oldChunkObjects.splice(index, 1);
                            }
                        }
                    }

                    // Always ensure object is in new chunk's array
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
                    if (modelType === 'dock') return; // Safety: skip dock colliders
                    const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[modelType];
                    if (dims) {
                        const shape = dims.radius !== undefined
                            ? { type: 'cylinder', radius: dims.radius, height: dims.height || 2 }
                            : { type: 'cuboid', width: dims.width, height: dims.height || 2, depth: dims.depth };

                        const newCollider = this.game.physicsManager.createStaticCollider(
                            existingObject.userData.objectId,
                            shape,
                            existingObject.position,
                            existingObject.rotation.y,
                            COLLISION_GROUPS.STRUCTURE
                        );
                        // Store handle so chunk transition code can properly manage this collider
                        existingObject.userData.physicsHandle = newCollider;
                    }

                    // Re-add to objectRegistry (removeCollider triggers callback that deletes it)
                    if (this.game.objectRegistry) {
                        this.game.objectRegistry.set(existingObject.userData.objectId, existingObject);
                    }
                }

                // Trigger proximity check so mount button appears
                this.game.checkProximityToObjects();

                // Re-register with StructureModelSystem for LOD management
                // (was unregistered when peer mounted to prevent ghost model)
                if (this.game.structureModelSystem) {
                    const modelType = existingObject.userData.modelType;
                    const chunkKey = existingObject.userData.chunkKey;
                    this.game.structureModelSystem.registerStructure(existingObject, modelType, chunkKey);
                }
            }

            return;
        }

        // Clean up stale registry entry if object exists but was disposed
        if (existingObject && !existingObject.parent) {
            if (this.game.objectRegistry) {
                this.game.objectRegistry.delete(objectId);
            }
        }

        // Prepare structure data for creation
        const structureData = {
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
            ownerFactionId,
            isBanditStructure,
            materialType,
            isBrownBearStructure,
            isDeerTreeStructure,
            hasMilitia,
            militiaOwner,
            militiaFaction,
            militiaType,
            fallDirection,
            shirtColor,
            isCorpse,
            corpseType,
            displayName
        };

        // Skip creation if a peer is currently riding/using this mobile entity
        // This prevents ghost horses when we receive object_added after player_full_state
        // told us a peer is riding the horse (race condition with chunk loading)
        const MOBILE_ENTITY_TYPES = new Set(['horse', 'boat', 'sailboat', 'ship2']);
        if (MOBILE_ENTITY_TYPES.has(objectType)) {
            const mobileEntitySystem = this.game?.mobileEntitySystem;
            const isOccupied = mobileEntitySystem?.isOccupied(objectId);

            if (isOccupied) {
                // Peer is riding this entity - don't create static mesh
                return;
            }
        }

        // Check if this is a bandit camp structure that should be queued
        // Queue tent, outpost, campfire, horse when they're bandit structures to spread load
        const QUEUEABLE_TYPES = new Set(['tent', 'outpost', 'campfire', 'horse']);
        const shouldQueue = isBanditStructure && QUEUEABLE_TYPES.has(objectType);

        if (shouldQueue) {
            // Queue for frame-spread creation to prevent stutter
            const queue = getStructureCreationQueue();

            // Set up callback if not already done
            if (!queue._createCallback) {
                queue.setCreateCallback((data, key) => {
                    const instance = this.sceneObjectFactory.createObjectInScene(data, key);
                    if (instance) {
                        // Register with StructureModelSystem for LOD if available
                        if (this.game.structureModelSystem) {
                            const type = data.name || data.objectType;
                            this.game.structureModelSystem.registerStructure(instance, type, key);
                        }
                        // Register with BillboardSystem for distant rendering
                        if (this.game.billboardSystem) {
                            const type = data.name || data.objectType;
                            const billboardIndex = this.game.billboardSystem.addTreeBillboard(
                                instance,
                                type,
                                instance.position
                            );
                            if (billboardIndex >= 0) {
                                instance.userData.billboardIndex = billboardIndex;
                            }
                        }
                        ui.updateStatus(`${data.name || data.objectType} spawned in world`);
                    }
                    // Mark dirt overlay
                    if (this.game.dirtOverlay) {
                        this.game.dirtOverlay.markDirty();
                    }
                });
            }

            queue.queueStructure(structureData, chunkKey);
        } else {
            // Create immediately for non-bandit structures
            const objectInstance = this.sceneObjectFactory.createObjectInScene(structureData, chunkKey);

            if (objectInstance) {
                // Register with StructureModelSystem for LOD if available
                if (this.game.structureModelSystem) {
                    this.game.structureModelSystem.registerStructure(objectInstance, objectType, chunkKey);
                }
                // Register with BillboardSystem for distant rendering
                if (this.game.billboardSystem) {
                    const billboardIndex = this.game.billboardSystem.addTreeBillboard(
                        objectInstance,
                        objectType,
                        objectInstance.position
                    );
                    if (billboardIndex >= 0) {
                        objectInstance.userData.billboardIndex = billboardIndex;
                    }
                }
                ui.updateStatus(`${objectType} spawned in world`);

                // Register ships and boats for animation
                const waterVehicleAnimTypes = ['ship', 'boat', 'sailboat', 'ship2'];
                if (waterVehicleAnimTypes.includes(objectType)) {
                    this.game.animationSystem.registerShip(objectInstance);
                }

                // Note: AI spawning for tents is now server-authoritative
                // Server will send 'spawn_ai_command' when players enter tent chunk
            } else {
                console.error(`Failed to create ${objectType} instance`);
            }

            // Mark dirt overlay for repaint to include new structure
            if (this.game.dirtOverlay) {
                this.game.dirtOverlay.markDirty();
            }
        }

        // Clear from removedObjectsCache since object is now re-added
        // Prevents stale cache entries from causing object removal on chunk enter
        const removedSet = this.gameState.removedObjectsCache.get(chunkKey);
        if (removedSet) {
            removedSet.delete(objectId);
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

        // Route to WoodcutterController if it's tracking this resource
        // This allows woodcutter to handle server confirmation of harvests
        if (this.game.woodcutterController) {
            this.game.woodcutterController.handleResourceHarvested(payload);
        }

        // Route to MinerController if it's tracking this resource
        if (this.game.minerController) {
            this.game.minerController.handleResourceHarvested(payload);
        }
    }

    /**
     * Remove depleted resource from scene
     */
    removeDepletedResource(objectId, resourceObject) {

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
                // silent: true - peer left proximity range, boat didn't sink
                this.networkManager.cleanupPeer(peerId, this.scene, { silent: true });
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
            // CLIENT-SIDE SPAWNING: Check if spawning is due for apple trees
            if (structureType === 'apple') {
                const itemsSpawned = this.checkAndSpawnItems(
                    inventory,
                    structureType,
                    quality,
                    lastSpawnTick,
                    serverTick
                );

                if (itemsSpawned > 0) {
                    // Save to server (this will update lastSpawnTick on server)
                    const chunkId = `chunk_${crateObject.userData.chunkKey}`;
                    this.networkManager.sendMessage('save_crate_inventory', {
                        crateId: crateId,
                        chunkId: chunkId,
                        inventory: inventory
                    });
                }
            }

            // Check if this is the currently open structure with unsaved changes
            const isOpenAndDirty = this.gameState.nearestStructure &&
                this.gameState.nearestStructure.userData.objectId === crateId &&
                this.gameState.inventoryOpen &&
                this.gameState.nearestStructure.userData.inventoryDirty;

            // Only update userData.inventory if NOT dirty (to preserve local changes)
            if (!isOpenAndDirty) {
                crateObject.userData.inventory = inventory;
            }

            // If this is the nearest structure, update the display (only if not dirty)
            if (this.gameState.nearestStructure &&
                this.gameState.nearestStructure.userData.objectId === crateId) {
                if (!isOpenAndDirty) {
                    this.game.crateInventory = inventory;
                    this.game.inventoryUI.renderCrateInventory();
                }
            }
        }
    }

    /**
     * Client-side spawning for apple trees
     * Generates items locally based on elapsed ticks since lastSpawnTick
     * @param {object} inventory - The structure's inventory to modify
     * @param {string} structureType - 'apple'
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

        // Apple tree: 3x3 grid = 9 slots
        const maxSlots = 9;
        const gridSize = 3;

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

            // Apple tree - always apples
            const itemType = 'apple';
            const baseDurability = 5;

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

            // Control smoke based on firewood (client-side, O(1) lookup)
            this.game.effectManager.updateSmokeForInventory(crateId, crateObject.userData.modelType, inventory);

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
     * Handle structure lock changed broadcast from server
     * Updates local structure state so players can see when structures are in use
     */
    handleStructureLockChanged(payload) {
        const { structureId, chunkId, lockedBy, locked } = payload;

        // Find the structure in registry
        const structure = this.findObjectById(structureId);
        if (structure) {
            structure.userData.lockedBy = locked ? lockedBy : null;
            structure.userData.lockTime = locked ? Date.now() : null;
        }

        // If this is the nearest structure, update state and close UI if we had it open
        if (this.gameState.nearestStructure?.userData?.objectId === structureId) {
            this.gameState.nearestStructure.userData.lockedBy = locked ? lockedBy : null;
            this.gameState.nearestStructure.userData.lockTime = locked ? Date.now() : null;

            // If another player locked it and we have UI open for it, show toast
            if (locked && this.gameState.inventoryOpen && this.game?.inventoryUI?.crateUI) {
                const crateUI = this.game.inventoryUI.crateUI;
                // Only show if we're NOT the one who locked it (we wouldn't receive this msg anyway)
                // and we're currently viewing this structure
                if (!crateUI.lockState.held || crateUI.lockState.structureId !== structureId) {
                    window.ui?.showToast('This storage is now in use by another player', 'warning');
                }
            }
        }
    }

    /**
     * Handle lock stolen notification
     * Server notifies us when our stale lock was taken by another player
     */
    handleLockStolen(payload) {
        const { structureId, reason } = payload;

        // Check if we think we still have this lock
        if (this.game?.inventoryUI?.crateUI) {
            const crateUI = this.game.inventoryUI.crateUI;
            if (crateUI.lockState.held && crateUI.lockState.structureId === structureId) {
                // We lost our lock - close inventory
                window.ui?.showToast('Lost access: ' + (reason || 'Lock expired'), 'error');
                crateUI.releaseLock();
                this.game.inventoryUI.closeCrateInventory();
            }
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
        }

        // ALWAYS update nearestStructure if it matches this market ID
        // This handles cases where registry lookup fails but player is near the market
        if (this.gameState.nearestStructure &&
            this.gameState.nearestStructure.userData.objectId === marketId) {
            if (!this.gameState.nearestStructure.userData.inventory) {
                this.gameState.nearestStructure.userData.inventory = {};
            }
            this.gameState.nearestStructure.userData.inventory.items = items;

            // If market UI is open, refresh it
            if (this.gameState.inventoryOpen && this.game.inventoryUI.marketUI) {
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

            // Close the inventory/market UI
            this.game.inventoryUI.toggleInventory();

            // Show toast notification
            if (window.ui) {
                ui.showToast('Ship departing - trade in progress', 'info');
            }
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
        }
    }

    /**
     * Handle tree planted message
     * Creates a visual representation of the newly planted tree
     */
    handleTreePlanted(payload) {
        const { chunkId, objectId, treeType, position, scale, quality, isGrowing, plantedAtTick, growthDurationTicks } = payload;

        // Normalize planted types for visual rendering (planted_vegetables -> vegetables, etc.)
        const visualType = treeType.startsWith('planted_') ? treeType.replace('planted_', '') : treeType;

        // Check if object already exists (prevent duplicates from race conditions)
        const existingObject = this.findObjectById(objectId);
        if (existingObject) {
            return;
        }

        // Set initial visual scale based on growth progress
        const isSmallPlant = visualType === 'vegetables' || visualType === 'hemp';
        const startScale = isSmallPlant ? 0.75 : 0.25;
        const currentScale = scale || startScale;

        // Pine/apple: try 3D GLB model first, fall back to billboard
        const use3D = (visualType === 'pine' || visualType === 'apple');
        const tree3D = use3D ? this.sceneObjectFactory.createGrowing3DTree(visualType, currentScale) : null;

        let treeObject;
        if (tree3D) {
            tree3D.position.set(position[0], position[1], position[2]);
            tree3D.name = visualType;
            treeObject = tree3D;
        } else {
            // Billboard fallback (always used for vegetables)
            const treeBillboardConfig = {
                pine: { width: 4, height: 6, yOffset: -0.5, brightness: 0.95, colorR: 1.0, colorG: 1.0, colorB: 1.0, texture: 'pinefinal.webp' },
                apple: { width: 8.4, height: 5, yOffset: -1.3, brightness: 0.55, colorR: 1.0, colorG: 1.0, colorB: 1.0, texture: 'applefinal.webp' },
                vegetables: { width: 0.8, height: 0.7, yOffset: -0.25, brightness: 0.85, colorR: 1.65, colorG: 1.0, colorB: 0, texture: 'vegetables.png' },
                hemp: { width: 0.6, height: 1.4, yOffset: -0.25, brightness: 0.85, colorR: 0.8, colorG: 1.3, colorB: 0.4, texture: 'hemp.png' }
            };
            const config = treeBillboardConfig[visualType] || treeBillboardConfig.pine;

            const billboard = this.sceneObjectFactory.createCylindricalBillboard(
                `./models/${config.texture}`,
                config.width,
                config.height,
                config.yOffset,
                config.brightness,
                { r: config.colorR, g: config.colorG, b: config.colorB }
            );

            billboard.position.set(position[0], position[1], position[2]);
            billboard.scale.set(currentScale, currentScale, currentScale);
            billboard.name = visualType;
            billboard.userData.yOffset = config.yOffset;
            treeObject = billboard;
        }

        // Store tree metadata (tick-based growth tracking)
        treeObject.userData.objectId = objectId;
        treeObject.userData.modelType = treeType; // Keep original type for server communication
        treeObject.userData.quality = quality;
        treeObject.userData.isGrowing = isGrowing;
        treeObject.userData.plantedAtTick = plantedAtTick;
        treeObject.userData.growthDurationTicks = growthDurationTicks || 1800;
        treeObject.userData.scale = scale;
        treeObject.userData.totalResources = null;
        treeObject.userData.remainingResources = null;
        treeObject.userData.chunkKey = chunkId.replace('chunk_', '');

        // Add to scene
        this.scene.add(treeObject);

        // Add to chunkObjects for proximity detection
        const chunkKey = chunkId.replace('chunk_', '');
        const chunkObjects = this.game.chunkManager.chunkObjects.get(chunkKey) || [];
        chunkObjects.push(treeObject);
        this.game.chunkManager.chunkObjects.set(chunkKey, chunkObjects);

        // Register in object registry for easy lookup
        if (this.game && this.game.objectRegistry) {
            this.game.objectRegistry.set(objectId, treeObject);
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
                    treeObject.position,
                    0,
                    COLLISION_GROUPS.NATURAL
                );
                if (collider) {
                    treeObject.userData.physicsHandle = collider;
                }
            }
        }

        // Mark dirt overlay for repaint to include newly planted tree
        if (this.game.dirtOverlay) {
            this.game.dirtOverlay.markDirty();
        }

        // Add to growingTrees set so updateGrowingTrees will animate the growth
        if (isGrowing && this.gameState.growingTrees) {
            this.gameState.growingTrees.add(objectId);
        }

        // Notify gardener controller of planted vegetables (for tracking NPC-planted vegetables)
        // Server sends 'vegetables', not 'planted_vegetables'
        if (this.game.gardenerController && (treeType === 'vegetables' || treeType === 'planted_vegetables')) {
            this.game.gardenerController.handleTreePlanted(payload);
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
                } else if (treeObject.userData?._is3DGrowingTree) {
                    // 3D GLB growing tree (Group/Object3D)
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
                }

                // Update userData if it exists
                if (treeObject.userData) {
                    treeObject.userData.scale = scale;

                    // If tree has finished growing, mark it as no longer growing
                    if (scale >= 1.0 && treeObject.userData.isGrowing) {
                        treeObject.userData.isGrowing = false;
                    }
                }
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
        if (!treeObject) return;

        const chunkKey = chunkId.replace('chunk_', '');
        const modelType = treeObject.userData.modelType;
        // Normalize for visual type (planted_pine -> pine)
        const visualType = modelType?.startsWith('planted_') ? modelType.replace('planted_', '') : modelType;

        if (treeObject.userData._is3DGrowingTree) {
            // Transition 3D growing model -> lightweight Object3D placeholder + billboard/LOD
            const pos = treeObject.position.clone();
            const objectId = treeObject.userData.objectId;
            const quality = treeObject.userData.quality;
            const physicsHandle = treeObject.userData.physicsHandle;

            // Remove 3D model from scene and dispose
            this.scene.remove(treeObject);
            treeObject.traverse(child => {
                if (child.isMesh) {
                    if (child.geometry) child.geometry.dispose();
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else if (child.material) {
                        child.material.dispose();
                    }
                }
            });

            // Create lightweight Object3D placeholder (matches mature tree pattern)
            const placeholder = new THREE.Object3D();
            placeholder.name = visualType;
            placeholder.position.copy(pos);
            placeholder.userData.objectId = objectId;
            placeholder.userData.chunkKey = chunkKey;
            placeholder.userData.quality = quality;
            placeholder.userData.modelType = modelType;
            placeholder.userData.isGrowing = false;
            placeholder.userData.scale = 1.0;
            placeholder.userData.totalResources = null;
            placeholder.userData.remainingResources = null;

            // Transfer physics handle
            if (physicsHandle) {
                placeholder.userData.physicsHandle = physicsHandle;
            }

            this.scene.add(placeholder);

            // Register with billboard system for instanced rendering
            if (this.game.billboardSystem) {
                const billboardIndex = this.game.billboardSystem.addTreeBillboard(
                    placeholder,
                    visualType,
                    pos
                );
                placeholder.userData.billboardIndex = billboardIndex;
            }

            // Register with RockModelSystem for 3D LOD
            if (this.game.rockModelSystem && CONFIG.TREE_MODEL_TYPES.includes(visualType)) {
                this.game.rockModelSystem.addRockInstance(placeholder, visualType, pos);
            }

            // Update objectRegistry and chunkObjects to point to new placeholder
            if (this.game.objectRegistry) {
                this.game.objectRegistry.set(objectId, placeholder);
            }
            const chunkObjects = this.game.chunkManager.chunkObjects.get(chunkKey);
            if (chunkObjects) {
                const idx = chunkObjects.indexOf(treeObject);
                if (idx >= 0) chunkObjects[idx] = placeholder;
            }

            // Register mature apple trees for Baker AI detection
            if (visualType === 'apple' && this.gameState) {
                this.gameState.registerDeerTreeStructure(chunkKey, {
                    id: treeId,
                    position: { x: pos.x, y: pos.y, z: pos.z },
                    type: 'apple',
                    object: placeholder
                });
            }
        } else {
            // Billboard / vegetables path (unchanged)
            treeObject.userData.isGrowing = false;
            treeObject.userData.scale = 1.0;
            delete treeObject.userData.plantedAtTick;
            delete treeObject.userData.growthDurationTicks;

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

            // Register mature apple trees for Baker AI detection
            if (visualType === 'apple' && this.gameState) {
                this.gameState.registerDeerTreeStructure(chunkKey, {
                    id: treeId,
                    position: {
                        x: treeObject.position.x,
                        y: treeObject.position.y,
                        z: treeObject.position.z
                    },
                    type: 'apple',
                    object: treeObject
                });
            }
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
            // Check for both 'vegetables'/'hemp' and 'planted_vegetables'/'planted_hemp' (from chunk loading)
            const isSmallPlant = modelType === 'vegetables' || modelType === 'planted_vegetables' || modelType === 'hemp' || modelType === 'planted_hemp';
            const startScale = isSmallPlant ? 0.75 : 0.25;
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
     * Handle TURN credentials from server (Cloudflare API)
     */
    handleTurnCredentials(payload) {
        if (payload?.iceServers) {
            this.networkManager.p2pTransport.setTurnCredentials(payload);
        }
    }

    /**
     * Handle WebRTC offer
     */
    async handleWebRTCOffer(payload) {
        if (payload.recipientId !== this.gameState.clientId) return;

        const peerId = payload.senderId;

        // Offer collision detection - lower ID wins as initiator
        const existingPeer = this.networkManager.p2pTransport.peers.get(peerId);
        if (existingPeer) {
            if (this.gameState.clientId < peerId) {
                // We win as initiator - ignore their offer
                return;
            }
            // They win - close our connection, accept theirs
            this.networkManager.p2pTransport.closePeerConnection(peerId);
        }

        this.networkManager.createPeerConnection(peerId, false);

        try {
            const answer = await this.networkManager.p2pTransport.handleOffer(peerId, payload.offer);
            this.networkManager.sendMessage('webrtc_answer', {
                recipientId: peerId,
                senderId: this.gameState.clientId,
                answer
            });
        } catch (error) {
            ui.updateStatus(`Failed to handle offer from ${peerId}: ${error}`);
            this.networkManager.p2pTransport.closePeerConnection(peerId);
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
        const { position, roadId, chunkId, materialType, rotation } = payload;
        const roadRotation = rotation || 0;
        const material = materialType || 'limestone';

        // Paint pill-shaped road onto dirt overlay texture
        if (this.game.dirtOverlay) {
            this.game.dirtOverlay.paintRoadImmediate(position[0], position[2], roadRotation, material);
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
                    rotation: roadRotation,
                    materialType: material
                });
            }
        }

        // Update navigation map - use circular approximation (radius 1.25 covers pill area)
        if (this.game.navigationManager) {
            const navMap = this.game.navigationManager.getChunk(chunkId);
            if (navMap) {
                navMap.addRoad(position[0], position[2], 1.25);
                this.game.navigationManager.syncChunkToWorker(chunkId);
            }
        }

        // Mark dirt overlay for repaint to include new road in future rebuilds
        if (this.game.dirtOverlay) {
            this.game.dirtOverlay.markDirty();
        }

    }

    /**
     * DEPRECATED - Legacy handler for spawn_ai_command
     * No longer used - distributed system handles spawning client-side
     */
    handleSpawnAICommand(payload) {
        // No-op: Distributed system handles spawning via client-side chunk master election
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

            // Remove dying effect if structure now has > 1 hour remaining
            if (hoursUntilRuin > 1.0 && this.game.effectManager?.hasDyingStructureSmoke(structureId)) {
                this.game.effectManager.removeDyingStructureSmoke(structureId);
            }

            // Update UI if this is the nearest structure
            if (this.gameState.nearestStructure && this.gameState.nearestStructure.userData.objectId === structureId) {
                ui.showToast(`Structure repaired! New quality: ${quality}`, 'success');
            }
        } else {
            console.warn(`[Structure Repaired] Could not find structure ${structureId} in scene`);
        }
    }

    /**
     * Handle structure damaged by artillery
     * Updates local structure data and shows impact effect
     */
    handleStructureDamaged(payload) {
        const { structureId, lastRepairTime, currentDurability, hoursUntilRuin } = payload;

        // Find structure in scene
        const structure = this.findObjectById(structureId);

        if (structure) {
            // Update structure userData with new values
            structure.userData.lastRepairTime = lastRepairTime;
            structure.userData.currentDurability = currentDurability;
            structure.userData.hoursUntilRuin = hoursUntilRuin;

            // Check if this is the player's manned artillery (self-wear from firing)
            const mannedArtilleryMesh = this.gameState.vehicleState.mannedArtillery?.mesh;
            const isSelfWear = mannedArtilleryMesh && mannedArtilleryMesh.userData?.objectId === structureId;

            if (isSelfWear) {
                // Self-wear from firing - no effects or toast needed
                return;
            }

            // Check if structure is now dying (immediate feedback for enemy raid/artillery)
            if (hoursUntilRuin !== undefined && hoursUntilRuin <= 1.0 && hoursUntilRuin > 0) {
                if (this.game.effectManager && !this.game.effectManager.hasDyingStructureSmoke(structureId)) {
                    this.game.effectManager.addDyingStructureSmoke(structureId, structure.position);
                }
            }

            // Show impact effect at structure position
            if (this.game?.effectManager && structure.position) {
                this.game.effectManager.spawnArtilleryImpact(structure.position, true, 'structure');
            }

            // Update UI if this is the nearest structure being viewed
            if (this.gameState.nearestStructure && this.gameState.nearestStructure.userData.objectId === structureId) {
                ui.showToast('Structure damaged by artillery!', 'error');
            }
        } else {
            console.warn(`[Structure Damaged] Could not find structure ${structureId} in scene`);
        }
    }

    /**
     * Handle structure sold to proprietor
     * Updates local structure data so it won't decay and shows lock icon
     */
    handleStructureSoldToProprietor(payload) {
        const { structureId, chunkId } = payload;

        // Find structure in scene
        const structure = this.findObjectById(structureId);

        if (structure) {
            // Update structure userData
            structure.userData.proprietor = 'npc';
            structure.userData.isSoldWorkerStructure = true;
        } else {
            console.warn(`[Proprietor] Could not find structure ${structureId} in scene`);
        }
    }

    /**
     * Handle structure_militia_updated message from server
     * Updates militia flags on structure when militia is recruited or dies
     */
    handleStructureMilitiaUpdated(payload) {
        const { structureId, chunkId, hasMilitia, militiaOwner, militiaFaction, militiaType } = payload;
        const chunkKey = chunkId.replace('chunk_', '');

        // Find structure in scene
        const structure = this.findObjectById(structureId);

        if (structure) {
            // Update structure userData
            structure.userData.hasMilitia = hasMilitia;
            if (hasMilitia) {
                structure.userData.militiaOwner = militiaOwner;
                structure.userData.militiaFaction = militiaFaction;
                structure.userData.militiaType = militiaType;
            } else {
                // Militia died - clear flags
                delete structure.userData.militiaOwner;
                delete structure.userData.militiaFaction;
                delete structure.userData.militiaType;

                // Also remove spawned militia entity if it exists
                if (this.game.banditController?.entities.has(structureId)) {
                    this.game.banditController._destroyEntity(structureId);
                }
            }

            // Update militia registry (tent/outpost only - artillery uses dynamic lookup)
            const structureType = structure.userData.modelType;
            if (structureType === 'tent' || structureType === 'outpost') {
                if (hasMilitia) {
                    this.game.gameState.registerMilitiaStructure(chunkKey, {
                        id: structureId,
                        position: {
                            x: structure.position.x,
                            y: structure.position.y,
                            z: structure.position.z
                        },
                        type: structureType,
                        militiaOwner: militiaOwner,
                        militiaFaction: militiaFaction,
                        militiaType: militiaType
                    });
                } else {
                    this.game.gameState.unregisterMilitiaStructure(chunkKey, structureId);
                }
            }
        } else if (!hasMilitia) {
            // Structure not in scene but militia died - still unregister from registry
            // This handles the case where peer doesn't have the chunk loaded
            this.game.gameState.unregisterMilitiaStructure(chunkKey, structureId);
        }
    }

    /**
     * Handle request_militia_response from server (tent militia)
     * Only spawns militia locally after server confirms success
     */
    handleRequestMilitiaResponse(payload) {
        const { tentId, chunkId, success, reason } = payload;
        const pending = this.game.gameState?.pendingMilitiaRequest;

        // Clear pending request
        if (this.game.gameState) {
            this.game.gameState.pendingMilitiaRequest = null;
        }

        if (!success) {
            ui.showToast(reason || 'Failed to spawn militia', 'error');
            return;
        }

        // Server confirmed - now deduct influence and spawn locally
        const militiaCost = window.CONFIG?.MILITIA?.COST || 1;
        if (this.game.gameState) {
            this.game.gameState.influence -= militiaCost;
        }

        // Spawn militia locally
        if (pending?.type === 'tent' && pending.structure && this.game.banditController) {
            const pos = pending.structure.position;
            // Use accountId for persistent ownership (matches structure ownership pattern)
            const ownerId = this.game.gameState?.accountId || this.game.gameState?.clientId;
            this.game.banditController.spawnMilitiaForTent(
                { id: pending.structureId, position: { x: pos.x, z: pos.z } },
                this.game.gameState?.factionId,
                ownerId,
                pending.shirtColor || 0x5a5a5a
            );
        }

        ui.showToast('Militia spawned!', 'success');
    }

    /**
     * Handle request_outpost_militia_response from server (tower militia)
     * Only spawns militia locally after server confirms success
     */
    handleRequestOutpostMilitiaResponse(payload) {
        const { outpostId, chunkId, success, reason } = payload;
        const pending = this.game.gameState?.pendingMilitiaRequest;

        // Clear pending request
        if (this.game.gameState) {
            this.game.gameState.pendingMilitiaRequest = null;
        }

        if (!success) {
            ui.showToast(reason || 'Failed to spawn tower militia', 'error');
            return;
        }

        // Server confirmed - now deduct influence and spawn locally
        const militiaCost = window.CONFIG?.MILITIA?.COST || 1;
        if (this.game.gameState) {
            this.game.gameState.influence -= militiaCost;
        }

        // Spawn militia locally
        if (pending?.type === 'outpost' && pending.structure && this.game.banditController) {
            // Use accountId for persistent ownership (matches structure ownership pattern)
            const ownerId = this.game.gameState?.accountId || this.game.gameState?.clientId;
            this.game.banditController.spawnOutpostMilitia(
                pending.structure,
                this.game.gameState?.factionId,
                ownerId,
                pending.shirtColor || 0x5a5a5a
            );
        }

        ui.showToast('Tower militia spawned!', 'success');
    }

    /**
     * Handle request_artillery_militia_response from server (gunner)
     * Only spawns militia locally after server confirms success
     */
    handleRequestArtilleryMilitiaResponse(payload) {
        const { artilleryId, chunkId, success, reason } = payload;
        const pending = this.game.gameState?.pendingMilitiaRequest;

        // Clear pending request
        if (this.game.gameState) {
            this.game.gameState.pendingMilitiaRequest = null;
        }

        if (!success) {
            ui.showToast(reason || 'Failed to assign gunner', 'error');
            return;
        }

        // Server confirmed - now deduct influence and spawn locally
        const militiaCost = window.CONFIG?.MILITIA?.COST || 1;
        if (this.game.gameState) {
            this.game.gameState.influence -= militiaCost;
        }

        // Spawn militia locally
        if (pending?.type === 'artillery' && pending.structure && this.game.banditController) {
            // Use accountId for persistent ownership (matches structure ownership pattern)
            const ownerId = this.game.gameState?.accountId || this.game.gameState?.clientId;
            this.game.banditController.spawnArtilleryMilitia(
                pending.structure,
                this.game.gameState?.factionId,
                ownerId,
                pending.shirtColor || 0x5a5a5a
            );
        }

        ui.showToast('Gunner assigned!', 'success');
    }

    /**
     * Handle construction_materials_updated message from server
     * Updates local construction site with materials added by a peer
     */
    handleConstructionMaterialsUpdated(payload) {
        const { constructionId, chunkKey, materials, materialItems } = payload;

        // Find construction site in scene via chunkManager
        const chunkObjects = this.game.chunkManager?.chunkObjects?.get(chunkKey);
        if (!chunkObjects) return;

        const site = chunkObjects.find(obj =>
            obj.userData?.objectId === constructionId &&
            obj.userData?.isConstructionSite
        );

        if (site) {
            // Update materials and materialItems for icon rendering
            site.userData.materials = materials;
            site.userData.materialItems = materialItems;

            // Also update nearestConstructionSite if this is the one being viewed
            if (this.gameState.nearestConstructionSite?.userData?.objectId === constructionId) {
                this.gameState.nearestConstructionSite.userData.materials = materials;
                this.gameState.nearestConstructionSite.userData.materialItems = materialItems;
            }
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
     * Handle being kicked from server (e.g., banned player)
     * Shows message and reloads page
     */
    handleKicked(payload) {
        // Clear session token so they can't auto-reconnect
        if (this.game.authClient) {
            this.game.authClient.clearStoredSession();
        }
        // Show message and reload
        alert('You have been disconnected from the server.');
        window._allowNavigation = true;
        window.location.reload();
    }

    handleAdminBroadcast(payload) {
        ui.showAdminBroadcast(payload.message);
    }

    /**
     * Handle influence response from server
     * Updates gameState and refreshes market UI if open
     */
    handleInfluenceResponse(payload) {
        this.gameState.influence = payload.influence;
        // Update market UI if open
        if (window.game?.inventoryUI?.marketUI) {
            window.game.inventoryUI.marketUI.refreshInfluenceDisplay();
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
        // Apply inventory if available
        if (payload.inventory && this.game.playerInventory) {
            // TODO: Implement inventory loading
        }

        // Position is intentionally NOT applied here.
        // Spawn system handles positioning via SpawnScreen selection.
        // Applying saved position would override the player's spawn choice.
        if (payload.position) {
        }

        // Apply health if available
        if (payload.health !== undefined) {
            // TODO: Implement health system integration
        }

        // Note: Hunger system is self-managing based on food in inventory
        // No need to restore hunger state - it recalculates on login

        // Apply current chunk if available
        if (payload.currentChunk) {
        }

        ui.showToast('Player data loaded!', 'success');
    }

    /**
     * Handle scheduled ship spawn at dock
     * Server broadcasts this every 30 minutes for docks in loaded chunks
     */
    handleDockShipSpawned(payload) {
        const { dockId, dockPosition, dockRotation, lastShipSpawn, chunkId } = payload;

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

        // Note: Worker spawning (baker, gardener, etc.) is now handled via proximity-based
        // spawning in handleTick() for structures sold to proprietors.
        // The old dock-triggered worker spawning has been removed.
    }

    /**
     * Handle market_shipments_toggled message - market's shipment pause state changed
     */
    handleMarketShipmentsToggled(payload) {
        const { marketId, shipmentsPaused } = payload;

        // Update structure in scene
        this.game.scene.traverse(obj => {
            if (obj.userData?.id === marketId && obj.userData?.structureType === 'market') {
                obj.userData.shipmentsPaused = shipmentsPaused;
            }
        });

        // Update UI if this market is open
        if (this.game.inventoryUI?.marketUI) {
            this.game.inventoryUI.marketUI.updatePauseButtonState();
        }
    }

    /**
     * Handle market_merchant_ships_toggled message - market's merchant ships enabled state changed
     */
    handleMarketMerchantShipsToggled(payload) {
        const { marketId, merchantShipsEnabled } = payload;

        // Update structure in scene
        this.game.scene.traverse(obj => {
            if (obj.userData?.id === marketId && obj.userData?.structureType === 'market') {
                obj.userData.merchantShipsEnabled = merchantShipsEnabled;
            }
        });

        // Update UI if this market is open
        if (this.game.inventoryUI?.marketUI) {
            this.game.inventoryUI.marketUI.updateMerchantShipsButtonState();
        }
    }

    /**
     * Handle home_set message - server notifies client their home was set
     * Called when player places a tent or completes building a house
     */
    handleHomeSet(payload) {
        const { structureId, x, z } = payload;

        // Update gameState
        this.gameState.setHome(structureId, x, z);
    }

    /**
     * Handle horse purchased confirmation from server
     */
    handleHorsePurchased(payload) {
        const { quality, horseId } = payload;
        if (this.game.spawnAndMountHorse) {
            this.game.spawnAndMountHorse(quality, horseId);
        }
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
            this.networkManager.sendMessage('position_response', {
                requestId,
                unavailable: true,
                reason: 'dead'
            });
            return;
        }

        // Check 3: Player is on a water vehicle (block spawn - they move unpredictably)
        // Allow spawn on horses and carts (they're stable enough)
        const vState = this.gameState.vehicleState;
        const waterVehicleSpawnBlock = ['boat', 'sailboat', 'ship2'];
        if (vState?.isActive() && waterVehicleSpawnBlock.includes(vState?.pilotingEntityType)) {
            this.networkManager.sendMessage('position_response', {
                requestId,
                unavailable: true,
                reason: 'on_mobile_entity',
                entityType: vState.pilotingEntityType
            });
            return;
        }

        // Check 4: Player is climbing an outpost
        const climbState = this.gameState.climbingState;
        if (climbState?.isClimbing) {
            this.networkManager.sendMessage('position_response', {
                requestId,
                unavailable: true,
                reason: 'climbing'
            });
            return;
        }


        // Check 6: Player is in water (water level is at y=0)
        const LAND_THRESHOLD = 0;
        const terrainHeight = this.game.terrainGenerator?.getWorldHeight(
            this.game.playerObject.position.x,
            this.game.playerObject.position.z
        );
        if (terrainHeight !== undefined && terrainHeight < LAND_THRESHOLD) {
            this.networkManager.sendMessage('position_response', {
                requestId,
                unavailable: true,
                reason: 'in_water'
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
     * Calculate hours until structure becomes a ruin
     * @param {object} userData - Structure's userData
     * @returns {number} Hours until ruin (0 if already ruined)
     */
    getHoursUntilRuin(userData) {
        if (userData.isRuin) return 0;
        if (userData.modelType === 'road') return Infinity;

        // Construction sites have fixed 1-hour lifespan
        if (userData.isConstructionSite) {
            const ageHours = (Date.now() - (userData.lastRepairTime || Date.now())) / (1000 * 60 * 60);
            return Math.max(0, CONSTRUCTION_SITE_LIFESPAN_HOURS - ageHours);
        }

        // Regular structures
        const quality = userData.quality || 50;
        const maxLifespanHours = Math.pow(quality, DECAY_EXPONENT);
        const elapsedMs = Date.now() - (userData.lastRepairTime || Date.now());
        const elapsedHours = elapsedMs / (1000 * 60 * 60);

        return Math.max(0, maxLifespanHours - elapsedHours);
    }

    /**
     * Check if a ruin should be removed
     * Ruins no longer auto-expire - players can demolish manually with hammer
     * @param {object} userData - Ruin's userData
     * @returns {boolean} Always false (ruins are permanent)
     */
    isRuinExpired(userData) {
        return false;
    }

    /**
     * Check all nearby structures for decay
     * Called periodically (every 60 ticks)
     */
    checkStructureDecay() {
        if (!this.game?.objectRegistry) return;

        const structureTypes = new Set(['house', 'crate', 'tent', 'outpost', 'campfire',
                                        'market', 'tileworks', 'ship', 'boat', 'sailboat', 'ship2', 'horse', 'cart', 'artillery',
                                        'fisherman', 'ironworks', 'blacksmith', 'bakery', 'gardener', 'miner', 'woodcutter', 'stonemason']);

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

                // Skip brown bear den structures (no decay)
                if (object.userData.isBrownBearStructure) continue;

                // Skip sold worker structures (proprietor maintains them)
                if (object.userData.isSoldWorkerStructure) continue;

                // Skip if already sent decay message
                if (object.userData._decayMessageSent) continue;

                const durability = this.calculateStructureDurability(object.userData);

                // Check for dying structure effect (smoke when <= 1 hour remaining)
                // Only buildings get smoke — not crates, tents, ships, horses, etc.
                const SMOKE_BUILDING_TYPES = new Set(['house', 'market', 'tileworks',
                    'fisherman', 'ironworks', 'blacksmith', 'bakery', 'gardener', 'miner', 'woodcutter', 'stonemason']);
                const hoursUntilRuin = this.getHoursUntilRuin(object.userData);
                const ONE_HOUR = 1.0;

                if (SMOKE_BUILDING_TYPES.has(modelType) && hoursUntilRuin <= ONE_HOUR && hoursUntilRuin > 0 && !object.userData.isRuin) {
                    // Structure is dying - add effect if not present
                    if (this.game.effectManager && !this.game.effectManager.hasDyingStructureSmoke(objectId)) {
                        this.game.effectManager.addDyingStructureSmoke(objectId, object.position);
                    }
                } else {
                    // Structure is healthy, already dead, or not a smoke type - remove effect if present
                    if (this.game.effectManager?.hasDyingStructureSmoke(objectId)) {
                        this.game.effectManager.removeDyingStructureSmoke(objectId);
                    }
                }

                if (durability <= 0) {
                    object.userData._decayMessageSent = true;

                    // Clean up dying effect before converting to ruin
                    if (this.game.effectManager?.hasDyingStructureSmoke(objectId)) {
                        this.game.effectManager.removeDyingStructureSmoke(objectId);
                    }

                    const chunkId = `chunk_${object.userData.chunkKey}`;
                    this.networkManager.sendMessage('convert_to_ruin', {
                        structureId: object.userData.objectId,
                        chunkId: chunkId
                    });

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

                    // Mark for removal from tracking set
                    completedStructures.push(objectId);
                }
            }

            // Check corpses for expiration (direct removal, no ruin phase)
            if (object.userData.isCorpse) {
                if (object.userData._corpseRemovalSent) continue;

                const durability = this.calculateStructureDurability(object.userData);

                if (durability <= 0) {
                    object.userData._corpseRemovalSent = true;

                    const chunkId = `chunk_${object.userData.chunkKey}`;
                    this.networkManager.sendMessage('remove_ruin', {
                        structureId: object.userData.objectId,
                        chunkId: chunkId
                    });

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

    // =========================================================================
    // NPC BAKER RESPONSE HANDLERS
    // =========================================================================

    /**
     * Handle NPC apple collection response from server
     */
    handleNPCCollectApplesResponse(payload) {
        if (this.game.bakerController) {
            this.game.bakerController.handleAppleCollectResponse(payload);
        }
    }

    /**
     * Handle NPC collect response (firewood, tarts, stones)
     */
    handleNPCCollectResponse(payload) {
        // Route to the appropriate controller based on npcType
        switch (payload.npcType) {
            case 'baker':
                if (this.game.bakerController) {
                    this.game.bakerController.handleCollectResponse(payload);
                }
                break;
            case 'stonemason':
                if (this.game.stoneMasonController) {
                    this.game.stoneMasonController.handleCollectResponse(payload);
                }
                break;
            case 'ironworker':
                if (this.game.ironWorkerController) {
                    this.game.ironWorkerController.handleCollectResponse(payload);
                }
                break;
            case 'tileworker':
                if (this.game.tileWorkerController) {
                    this.game.tileWorkerController.handleCollectResponse(payload);
                }
                break;
            case 'fisherman':
                if (this.game.fishermanController) {
                    this.game.fishermanController.handleCollectResponse(payload);
                }
                break;
            case 'blacksmith':
                if (this.game.blacksmithController) {
                    this.game.blacksmithController.handleCollectResponse(payload);
                }
                break;
            default:
                // Fallback to baker for backwards compatibility
                if (this.game.bakerController) {
                    this.game.bakerController.handleCollectResponse(payload);
                }
        }
    }

    /**
     * Handle NPC deposit response - route to correct controller based on NPC type
     */
    handleNPCDepositResponse(payload) {
        // Route based on npcType first (preferred)
        switch (payload.npcType) {
            case 'baker':
                if (this.game.bakerController) this.game.bakerController.handleDepositResponse(payload);
                return;
            case 'gardener':
                if (this.game.gardenerController) this.game.gardenerController.handleDepositResponse(payload);
                return;
            case 'woodcutter':
                if (this.game.woodcutterController) this.game.woodcutterController.handleDepositResponse(payload);
                return;
            case 'miner':
                if (this.game.minerController) this.game.minerController.handleDepositResponse(payload);
                return;
            case 'stonemason':
                if (this.game.stoneMasonController) this.game.stoneMasonController.handleDepositResponse(payload);
                return;
            case 'ironworker':
                if (this.game.ironWorkerController) this.game.ironWorkerController.handleDepositResponse(payload);
                return;
            case 'tileworker':
                if (this.game.tileWorkerController) this.game.tileWorkerController.handleDepositResponse(payload);
                return;
            case 'blacksmith':
                if (this.game.blacksmithController) this.game.blacksmithController.handleDepositResponse(payload);
                return;
            case 'fisherman':
                if (this.game.fishermanController) this.game.fishermanController.handleDepositResponse(payload);
                return;
        }

        // Fallback: check legacy ID fields for backwards compatibility
        if (payload.gardenerId && this.game.gardenerController) {
            this.game.gardenerController.handleDepositResponse(payload);
        } else if (payload.bakeryId && this.game.bakerController) {
            this.game.bakerController.handleDepositResponse(payload);
        } else if (payload.woodcutterId && this.game.woodcutterController) {
            this.game.woodcutterController.handleDepositResponse(payload);
        } else if (payload.minerId && this.game.minerController) {
            this.game.minerController.handleDepositResponse(payload);
        } else if (payload.stonemasonId && this.game.stoneMasonController) {
            this.game.stoneMasonController.handleDepositResponse(payload);
        }
    }

    handleNPCRemoveFirewoodResponse(payload) {
        // Route to the appropriate controller based on npcType
        switch (payload.npcType) {
            case 'baker':
                if (this.game.bakerController) {
                    this.game.bakerController.handleRemoveFirewoodResponse(payload);
                }
                break;
            case 'ironworker':
                if (this.game.ironWorkerController) {
                    this.game.ironWorkerController.handleRemoveFirewoodResponse(payload);
                }
                break;
            case 'tileworker':
                if (this.game.tileWorkerController) {
                    this.game.tileWorkerController.handleRemoveFirewoodResponse(payload);
                }
                break;
            case 'fisherman':
                if (this.game.fishermanController) {
                    this.game.fishermanController.handleRemoveFirewoodResponse(payload);
                }
                break;
            case 'blacksmith':
                if (this.game.blacksmithController) {
                    this.game.blacksmithController.handleRemoveFirewoodResponse(payload);
                }
                break;
            default:
                // Fallback to baker for backwards compatibility
                if (this.game.bakerController) {
                    this.game.bakerController.handleRemoveFirewoodResponse(payload);
                }
        }
    }

    handleNPCClearDepositResponse(payload) {
        // Route to the appropriate controller based on npcType
        switch (payload.npcType) {
            case 'baker':
                if (this.game.bakerController) {
                    this.game.bakerController.handleClearDepositResponse(payload);
                }
                break;
            case 'ironworker':
                if (this.game.ironWorkerController) {
                    this.game.ironWorkerController.handleClearDepositResponse(payload);
                }
                break;
            case 'tileworker':
                if (this.game.tileWorkerController) {
                    this.game.tileWorkerController.handleClearDepositResponse(payload);
                }
                break;
            case 'fisherman':
                if (this.game.fishermanController) {
                    this.game.fishermanController.handleClearDepositResponse(payload);
                }
                break;
            case 'blacksmith':
                if (this.game.blacksmithController) {
                    this.game.blacksmithController.handleClearDepositResponse(payload);
                }
                break;
            default:
                // Fallback to baker for backwards compatibility
                if (this.game.bakerController) {
                    this.game.bakerController.handleClearDepositResponse(payload);
                }
        }
    }

    /**
     * Handle bandit_death_recorded message from server
     * Updates local bandit structure registry with death time so bandit never respawns
     */
    handleBanditDeathRecorded(payload) {
        const { tentId, chunkId, banditDeathTime } = payload;
        const chunkKey = chunkId.replace('chunk_', '');

        // Update bandit structure registry with death time
        const banditStructures = this.game.gameState?.banditStructures?.get(chunkKey);
        if (banditStructures) {
            for (const structure of banditStructures) {
                if (structure.id === tentId) {
                    structure.banditDeathTime = banditDeathTime;
                    break;
                }
            }
        }

        // Also destroy any spawned entity if it exists
        if (this.game.banditController?.entities.has(tentId)) {
            this.game.banditController._destroyEntity(tentId);
        }
    }

    /**
     * Handle bear_death_recorded message from server
     * Updates local brown bear structure registry with death time for 60-minute respawn cooldown
     */
    handleBearDeathRecorded(payload) {
        const { denId, chunkId, bearDeathTime } = payload;
        const chunkKey = chunkId.replace('chunk_', '');

        // Update brown bear structure registry with death time
        const bearStructures = this.game.gameState?.brownBearStructures?.get(chunkKey);
        if (bearStructures) {
            for (const structure of bearStructures) {
                if (structure.id === denId) {
                    structure.bearDeathTime = bearDeathTime;
                    break;
                }
            }
        }

        // Also destroy any spawned entity if it exists
        if (this.game.brownBearController?.entities.has(denId)) {
            this.game.brownBearController._destroyEntity(denId);
        }
    }

    /**
     * Handle deer_death_recorded message from server
     * Updates local deer tree structure registry with death time for 60-minute respawn cooldown
     */
    handleDeerDeathRecorded(payload) {
        const { treeId, chunkId, deerDeathTime } = payload;
        const chunkKey = chunkId.replace('chunk_', '');

        // Update deer tree structure registry with death time
        const deerStructures = this.game.gameState?.deerTreeStructures?.get(chunkKey);
        if (deerStructures) {
            for (const structure of deerStructures) {
                if (structure.id === treeId) {
                    structure.deerDeathTime = deerDeathTime;
                    break;
                }
            }
        }

        // Also destroy any spawned entity if it exists
        if (this.game.deerController?.entities.has(treeId)) {
            this.game.deerController._destroyEntity(treeId);
        }
    }
}
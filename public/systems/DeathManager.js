
import { ui } from '../ui.js';
import { CONFIG } from '../config.js';
import ChunkCoordinates from '../core/ChunkCoordinates.js';
import { VehiclePhase } from '../vehicles/VehiclePhase.js';

/**
 * DeathManager
 * Handles player and entity death, respawning, and related state changes.
 */
export class DeathManager {
    constructor(game) {
        this.game = game;
        this.gameState = game.gameState;
        this.deathSystem = game.deathSystem;
        this.networkManager = game.networkManager;
        this.playerCombat = game.playerCombat;
        this.inventoryUI = game.inventoryUI;
        this.playerHunger = game.playerHunger;

        // Debounce flag to prevent multiple respawn clicks
        this._isRespawning = false;
    }

    killEntity(entity, isAI = false, isPeer = false, deathReason = 'Unknown cause') {
        // Guard: validate entity exists and has required properties
        if (!entity) {
            console.warn('[DeathManager] killEntity called with null entity');
            return;
        }
        if (!entity.position) {
            console.warn('[DeathManager] killEntity called with entity missing position');
            return;
        }

        // SPECIAL CASE: If local player is piloting a mobile entity, handle it
        // Horses are released back to world, boats are lost
        if (!isAI && !isPeer && this.gameState.vehicleState.isActive) {
            const mobileState = this.gameState.vehicleState;
            const entityId = mobileState.pilotingEntityId;
            const entityType = mobileState.pilotingEntityType;
            const entity = mobileState.pilotingEntity;

            // SHIP2 CREW ROSTER: Check if other crew remain before treating as ship loss
            let ship2CrewRemains = false;  // Flag to skip ship destruction if others aboard
            if (entityType === 'ship2' && this.game.mobileEntitySystem) {
                // Find my role on this ship
                const myRole = this.game.mobileEntitySystem.getCrewRole(entityId, this.gameState.clientId);

                if (myRole) {
                    // Clear my position from the roster
                    this.game.mobileEntitySystem.clearShipCrewMember(entityId, myRole);

                    // Tell server we're leaving the ship
                    this.networkManager.sendMessage('leave_ship_crew', {
                        shipId: entityId,
                        clientId: this.gameState.clientId
                    });

                    // Check if anyone else is still aboard
                    if (this.game.mobileEntitySystem.isAnyoneAboard(entityId)) {
                        // Others remain - ship survives, I just leave
                        ship2CrewRemains = true;

                        // Clear helm occupancy if I was piloting
                        if (myRole === 'pilot') {
                            this.game.mobileEntitySystem.clearOccupied(entityId);
                        }

                        // Broadcast that crew member left (not ship loss)
                        this.networkManager.broadcastP2P({
                            type: 'ship_crew_left',
                            payload: {
                                shipId: entityId,
                                role: myRole,
                                reason: 'death'
                            }
                        });

                        // Move player to ground level before clearing state
                        if (entity && this.game.terrainGenerator) {
                            const groundY = this.game.terrainGenerator.getWorldHeight(
                                entity.position.x,
                                entity.position.z
                            );
                            this.game.playerObject.position.set(
                                entity.position.x,
                                groundY + 0.03,
                                entity.position.z
                            );
                        }

                        // CRITICAL: Clean up ship-mounted artillery BEFORE forceReset() clears mannedArtillery
                        const mannedArt = this.gameState.vehicleState.mannedArtillery;
                        if (mannedArt?.manningState?.isManning && mannedArt.manningState.isShipMounted) {
                            const artilleryId = mannedArt.id;
                            const artillery = mannedArt.mesh;

                            // Clear artillery occupancy
                            if (this.game.mobileEntitySystem) {
                                this.game.mobileEntitySystem.clearOccupied(artilleryId);
                            }

                            // Broadcast to peers that artillery is unmanned
                            if (artillery) {
                                this.networkManager.broadcastP2P({
                                    type: 'artillery_unmanned',
                                    payload: {
                                        artilleryId: artilleryId,
                                        rotation: artillery.rotation.y
                                    }
                                });
                            }
                            // Note: Don't send release_artillery to server - artillery stays with ship
                        }

                        // Clear vehicle state
                        mobileState.forceReset('player death - crew left');

                        // Clean up activeVehicle (fixes stale boat reference when boarding ship as gunner)
                        if (this.game.activeVehicle) {
                            if (this.game.activeVehicle.removeDebugVisualization) {
                                this.game.activeVehicle.removeDebugVisualization(this.game.scene);
                            }
                            if (this.game.activeVehicle.removeColliderDebugVisualization) {
                                this.game.activeVehicle.removeColliderDebugVisualization(this.game.scene);
                            }
                            this.game.activeVehicle.cleanup();
                            this.game.activeVehicle = null;
                        }

                        // Clear nearest mobile entity states
                        this.gameState.nearestMobileEntity = null;
                        this.gameState.nearestLandVehicle = null;
                        this.gameState.nearestWaterVehicle = null;

                        // Continue to normal death processing below (skip ship destruction)
                    }
                    // If no one remains, fall through to existing ship loss behavior
                } else {
                    // Clear the entire roster if ship is being destroyed
                    this.game.mobileEntitySystem.clearShipCrew(entityId);
                }
            }

            // BOAT CARGO CLEANUP: When boat sinks, all cargo is lost with it
            // Skip for ship2 if other crew members remain aboard
            // Release cargo to server to clean up tracking, but don't drop them
            const waterVehicles = ['boat', 'sailboat', 'ship2'];
            if (waterVehicles.includes(entityType) && !ship2CrewRemains) {
                // Release artillery and horses first (sends server messages and P2P broadcasts)
                if (this.game.releaseShipCargoOnSink) {
                    this.game.releaseShipCargoOnSink(entityId);
                }

                const crateState = this.gameState.vehicleState;
                if (crateState?.loadedCrates?.length > 0) {
                    // Release each crate to server (they're lost with the ship)
                    for (const slot of crateState.loadedCrates) {
                        const crateId = slot.crateId;
                        const crate = slot.crate;

                        // Clear occupancy
                        if (this.game.mobileEntitySystem) {
                            this.game.mobileEntitySystem.clearOccupied(crateId);
                        }

                        // Tell server to remove from loadedCrates tracking
                        // Use a special "lost" release that doesn't place crate in world
                        this.networkManager.sendMessage('release_crate', {
                            entityId: crateId,
                            chunkKey: slot.crateChunkKey,
                            clientId: this.gameState.clientId,
                            position: [entity.position.x, -100, entity.position.z], // Deep underwater = lost
                            rotation: 0,
                            quality: slot.crateQuality,
                            lastRepairTime: slot.crateLastRepairTime,
                            inventory: slot.crateInventory,
                            isLost: true // Flag that crate is lost, not placed
                        });

                        // Broadcast to peers
                        this.networkManager.broadcastP2P({
                            type: 'crate_unloaded',
                            payload: {
                                crateId: crateId,
                                position: [entity.position.x, -100, entity.position.z],
                                rotation: 0,
                                inventory: slot.crateInventory,
                                isLost: true
                            }
                        });

                        // Dispose crate mesh (it's going down with the ship)
                        if (crate?.parent) {
                            crate.parent.remove(crate);
                        }
                    }

                    // Clear all ship cargo state using proper method
                    crateState.clearShipCargo();
                }
            }

            // Stop horse animation and sound FIRST
            if (entityType === 'horse') {
                if (mobileState.horseWalkAction) {
                    mobileState.horseWalkAction.stop();
                }
                if (mobileState.horseMixer) {
                    mobileState.horseMixer.stopAllAction();
                    mobileState.horseMixer = null;
                }
                if (mobileState.horseSound?.isPlaying) {
                    mobileState.horseSound.stop();
                    mobileState.horseSound = null;
                }

                // Remove the character controller (horse collision)
                if (this.game.physicsManager) {
                    this.game.physicsManager.removeCharacterController(entityId);
                }

                // Re-create player's character controller (was disabled during mount)
                if (this.game.physicsManager) {
                    this.game.physicsManager.createCharacterController(
                        'player',
                        0.1,    // radius (matches GameInitializer)
                        0.3,    // height (matches GameInitializer)
                        this.game.playerObject.position
                    );
                }

                // Restore the static collider for the horse so it's interactable right away
                if (this.game.physicsManager && entity) {
                    const colliderConfig = CONFIG.COLLIDERS?.horse || { radius: 0.15, height: 2.0 };
                    this.game.physicsManager.createStaticCollider(
                        entityId,
                        { type: 'cylinder', radius: colliderConfig.radius, height: colliderConfig.height },
                        entity.position,
                        entity.rotation.y
                    );
                }
            } else {
                // Stop horse sound if playing for any entity type (safety)
                if (mobileState.horseSound?.isPlaying) {
                    mobileState.horseSound.stop();
                    mobileState.horseSound = null;
                }
            }

            // Skip the rest of ship destruction if other crew members remain aboard
            // (already handled in the ship2 crew block above)
            if (!ship2CrewRemains) {
                // Clear mobile entity occupancy
                if (this.game.mobileEntitySystem) {
                    this.game.mobileEntitySystem.clearOccupied(entityId);
                }

                // For HORSES: Release properly to server so it stays in world
                // For BOATS: Don't release (they sink/are lost)
                if (entityType === 'horse' && entity) {
                    // Send release to server (horse stays in world)
                    this.networkManager.sendMessage('release_mobile_entity', {
                        entityId: entityId,
                        entityType: entityType,
                        chunkKey: entity.userData.chunkKey,
                        clientId: this.gameState.clientId,
                        position: entity.position.toArray(),
                        rotation: entity.rotation.y,
                        quality: mobileState.pilotingQuality,
                        lastRepairTime: mobileState.pilotingLastRepairTime
                    });
                }

                // Broadcast that we're exiting
                this.networkManager.broadcastP2P({
                    type: 'mobile_entity_exit',
                    payload: {
                        entityId: entityId,
                        entityType: entityType,
                        position: entity?.position?.toArray() || [0, 0, 0],
                        playerPosition: this.game.playerObject.position.toArray(),
                        isDeathLoss: ['boat', 'sailboat', 'ship2'].includes(entityType)  // Water vehicles are lost on death
                    }
                });

                // Move player to ground level BEFORE clearing state (for proper death animation)
                if (entity && this.game.terrainGenerator) {
                    const groundY = this.game.terrainGenerator.getWorldHeight(
                        entity.position.x,
                        entity.position.z
                    );
                    this.game.playerObject.position.set(
                        entity.position.x,
                        groundY + 0.03,
                        entity.position.z
                    );
                }

                // Clear vehicle state
                mobileState.forceReset('player death');

                // Clean up activeVehicle (fixes stale boat reference when boarding ship as gunner)
                if (this.game.activeVehicle) {
                    if (this.game.activeVehicle.removeDebugVisualization) {
                        this.game.activeVehicle.removeDebugVisualization(this.game.scene);
                    }
                    if (this.game.activeVehicle.removeColliderDebugVisualization) {
                        this.game.activeVehicle.removeColliderDebugVisualization(this.game.scene);
                    }
                    this.game.activeVehicle.cleanup();
                    this.game.activeVehicle = null;
                }

                // Clear nearest mobile entity states
                this.gameState.nearestMobileEntity = null;
                this.gameState.nearestLandVehicle = null;
                this.gameState.nearestWaterVehicle = null;
            }
            // Continue with normal death processing below
        }

        // SPECIAL CASE: If local player is manning artillery, release it on death
        const mannedArtillery = this.gameState.vehicleState.mannedArtillery;
        if (!isAI && !isPeer && mannedArtillery?.manningState?.isManning) {
            const artillery = mannedArtillery.mesh;
            const artilleryId = mannedArtillery.id;

            // Clear occupied status
            if (this.game.mobileEntitySystem) {
                this.game.mobileEntitySystem.clearOccupied(artilleryId);
            }

            // Send release message to server (rotation may have changed)
            if (artillery) {
                const rotation = artillery.rotation.y; // Radians
                this.networkManager.sendMessage('release_artillery', {
                    entityId: artilleryId,
                    chunkKey: mannedArtillery.chunkKey,
                    clientId: this.gameState.clientId,
                    position: artillery.position.toArray(),
                    rotation: rotation, // Radians
                    quality: artillery.userData?.quality,
                    lastRepairTime: artillery.userData?.lastRepairTime,
                    wasManning: true
                });

                // Broadcast to peers
                this.networkManager.broadcastP2P({
                    type: 'artillery_unmanned',
                    payload: {
                        artilleryId: artilleryId,
                        rotation: rotation
                    }
                });
            }

            // Clear manning state using Artillery class method
            mannedArtillery.stopManning();
            this.gameState.vehicleState.mannedArtillery = null;

            // Clear nearest mannable artillery
            this.gameState.nearestMannableArtillery = null;

        }

        // SPECIAL CASE: If local player is towing a cart, release cart AND crate on death
        const towedEntity = this.gameState.vehicleState.towedEntity;
        if (!isAI && !isPeer && towedEntity?.isAttached && towedEntity?.type === 'cart') {
            const cart = towedEntity.mesh;
            const cartId = towedEntity.id;
            const cargo = this.gameState.vehicleState.cartCargo;

            // CRITICAL: Handle loaded cargo FIRST (before cart release)
            if (cargo?.hasItems() && cart) {
                const loadedItem = cargo.loadedItems[0]; // Cart has single slot
                const crate = loadedItem?.mesh;
                const crateId = crate?.userData?.objectId;

                // Calculate drop position (beside the cart, not on top)
                const dropOffsetX = Math.sin(cart.rotation.y + Math.PI / 2) * 1.5;
                const dropOffsetZ = Math.cos(cart.rotation.y + Math.PI / 2) * 1.5;
                const dropX = cart.position.x + dropOffsetX;
                const dropZ = cart.position.z + dropOffsetZ;
                const dropY = this.game.terrainGenerator?.getWorldHeight(dropX, dropZ) || cart.position.y;

                // Unparent crate from cart
                if (crate.parent === cart) {
                    cart.remove(crate);
                    this.game.scene.add(crate);
                }

                // Position crate on ground
                crate.position.set(dropX, dropY, dropZ);
                crate.rotation.y = cart.rotation.y;

                // Calculate crate's chunk
                const { chunkX: crateChunkX, chunkZ: crateChunkZ } = ChunkCoordinates.worldToChunk(dropX, dropZ);
                const crateChunkKey = `${crateChunkX},${crateChunkZ}`;

                // Clear crate occupancy
                if (this.game.mobileEntitySystem && crateId) {
                    this.game.mobileEntitySystem.clearOccupied(crateId);
                }

                // Send crate unload to server
                this.networkManager.sendMessage('unload_crate', {
                    crateId: crateId,
                    cartId: cartId,
                    position: [dropX, dropY, dropZ],
                    rotation: cart.rotation.y,
                    chunkKey: crateChunkKey,
                    clientId: this.gameState.clientId,
                    inventory: crate.userData.inventory
                });

                // Broadcast to peers
                this.networkManager.broadcastP2P({
                    type: 'crate_unloaded',
                    payload: {
                        crateId: crateId,
                        cartId: cartId,
                        position: [dropX, dropY, dropZ],
                        rotation: cart.rotation.y
                    }
                });

                // Update crate chunk key
                crate.userData.chunkKey = crateChunkKey;

                // Re-register with LOD systems now that crate has world position again
                if (this.game.structureModelSystem) {
                    this.game.structureModelSystem.registerStructure(crate, 'crate', crateChunkKey);
                }
                if (this.game.billboardSystem) {
                    this.game.billboardSystem.addTreeBillboard(crate, 'crate', crate.position);
                }

                // Clear cargo state
                cargo.unload(0);
            }

            // Cart is released at current position (not lost like boat)
            if (cart) {
                // CRITICAL: Force cart position update before releasing
                // The cart may be behind due to physics lag if we were mounted on horse
                const mobileState = this.gameState.vehicleState;
                const wasMounted = mobileState.pilotingEntity && mobileState.pilotingEntityType === 'horse';

                if (wasMounted) {
                    // We already handled horse dismount above, but cart may still be stale
                    // Use the horse's last known position to position cart correctly
                    const horse = mobileState.pilotingEntity;
                    if (horse) {
                        const hitchOffset = CONFIG.TOWED_ENTITIES?.HITCH_OFFSET || 0.4;
                        const tetherlength = CONFIG.TOWED_ENTITIES?.TETHER_LENGTH || 0.3;
                        const totalOffset = hitchOffset + tetherlength + 1.5; // Approximate hitch distance
                        const horseHeading = horse.rotation.y;

                        cart.position.x = horse.position.x - Math.sin(horseHeading) * totalOffset;
                        cart.position.z = horse.position.z - Math.cos(horseHeading) * totalOffset;
                        cart.rotation.y = horseHeading;

                        // Update Y to terrain
                        if (this.game.terrainGenerator) {
                            cart.position.y = this.game.terrainGenerator.getWorldHeight(
                                cart.position.x,
                                cart.position.z
                            );
                        }
                    }
                }

                const position = cart.position.toArray();
                const rotation = cart.rotation.y;

                // Calculate new chunk for the cart's position (center-based)
                const { chunkX: newChunkX, chunkZ: newChunkZ } = ChunkCoordinates.worldToChunk(position[0], position[2]);
                const newChunkKey = `${newChunkX},${newChunkZ}`;

                // Clear occupied status
                if (this.game.mobileEntitySystem) {
                    this.game.mobileEntitySystem.clearOccupied(cartId);
                }

                // Send release to server (cart stays in world)
                this.networkManager.sendMessage('release_towed', {
                    entityType: 'cart',
                    entityId: cartId,
                    chunkKey: towedEntity.chunkKey,
                    clientId: this.gameState.clientId,
                    position: position,
                    rotation: rotation,
                    quality: towedEntity.quality,
                    lastRepairTime: towedEntity.lastRepairTime
                });

                // Broadcast to peers
                this.networkManager.broadcastP2P({
                    type: 'towed_released',
                    payload: {
                        entityType: 'cart',
                        entityId: cartId,
                        position: position,
                        rotation: rotation
                    }
                });

                // Update cart chunk key
                cart.userData.chunkKey = newChunkKey;
            }

            // Clear towed entity state using class method
            towedEntity.detach();
            this.gameState.vehicleState.towedEntity = null;
            this.gameState.vehicleState.cartCargo = null;

            // Clear nearest towable
            this.gameState.nearestTowableEntity = null;

            // Reset reverse flags
            if (this.game.playerController) {
                this.game.playerController.isReversingWithCart = false;
                this.game.playerController.towingVelocity = 0;
                this.game.playerController.towingHeading = 0;
            }
            if (this.game.mobileEntitySystem) {
                this.game.mobileEntitySystem.isReversingWithCart = false;
            }
        }

        // SPECIAL CASE: If local player is climbing or in outpost, trigger climb down first
        if (!isAI && !isPeer && this.gameState.climbingState.isClimbing) {
            const climbPhase = this.gameState.climbingState.climbingPhase;

            // If ascending or occupied (in outpost), start descent first
            if (climbPhase === 'ascending' || climbPhase === 'occupied') {
                // Store death reason and data for later
                this.game.deathReason = deathReason;
                this.gameState.climbingState.dieAfterDescent = true;

                // Store death data for after descent
                const deathData = this.deathSystem.markEntityDead(entity, isPeer, true); // Pass true to not apply animation yet
                this.gameState.climbingState.pendingDeathData = deathData;

                // Stop movement and shooting
                this.gameState.isMoving = false;
                this.game.playerController.stopMovement();

                // Start descent animation
                this.game.playerController.endClimbing(this.gameState);

                // DON'T broadcast climb end yet - will broadcast it when descent completes
                // This ensures other clients see the full descent animation before death

                return; // Don't apply death yet - will happen after descent
            }
        }

        // Use DeathSystem to mark entity as dead and get death data
        const deathData = this.deathSystem.markEntityDead(entity, isPeer);

        // Store death reason for local player
        if (!isAI && !isPeer) {
            this.game.deathReason = deathReason;
        }

        // Mark entity as dead
        if (isAI) {
            if (isPeer) {
                // Already marked by deathSystem.markEntityDead
            } else {
                this.game.aiEnemyIsDead = true;
                this.game.aiEnemyDeathStartTime = deathData.deathStartTime;
                this.game.aiEnemyDeathRotationProgress = deathData.deathRotationProgress;
                this.game.aiEnemyFallDirection = deathData.fallDirection;

                // Check if this AI belongs to a tent and mark tent as "dead AI" (no respawn)
                for (const [tentId, aiData] of this.game.aiEnemyManager.tentAIEnemies.entries()) {
                    if (aiData.controller.enemy === entity) {
                        aiData.isDead = true;
                        this.game.aiEnemyManager.deadTentAIs.add(tentId);
                        break;
                    }
                }
            }
        } else {
            if (isPeer) {
                // Already marked by deathSystem.markEntityDead
            } else {
                this.game.isDead = true;
                this.game.deathStartTime = deathData.deathStartTime;
                this.game.deathRotationProgress = deathData.deathRotationProgress;
                this.game.fallDirection = deathData.fallDirection;
                this.gameState.isMoving = false;
                this.game.playerController.stopMovement();
                this.game.inputManager?.cancelAutoRun();
                // Stop player from shooting while dead
                this.playerCombat.die();

                // Cancel save-exit countdown if active (player died during countdown)
                if (this.game.saveExitOverlay?.isActive) {
                    this.game.saveExitOverlay.cancel();
                }

                // Clear saved session data to prevent Resume Last Session after death
                this.gameState.clearSavedSessionData();
                // Tell server to clear saved session (prevents resume after page refresh)
                if (!this.gameState.isGuest) {
                    this.networkManager.sendMessage('clear_saved_session', {
                        accountId: this.gameState.accountId
                    });
                }

                // Clear climbing state if descending (ascending/occupied handled above)
                if (this.gameState.climbingState.isClimbing) {
                    const outpostId = this.gameState.climbingState.outpostId;

                    // Clear occupancy
                    if (outpostId) {
                        this.game.occupiedOutposts.delete(outpostId);
                    }

                    // Clear climbing state
                    this.gameState.climbingState.isClimbing = false;
                    this.gameState.climbingState.climbingOutpost = null;
                    this.gameState.climbingState.outpostId = null;
                    this.gameState.climbingState.climbingStartTime = null;
                    this.gameState.climbingState.climbingPhase = null;
                    this.gameState.climbingState.originalPosition = null;
                    this.gameState.climbingState.targetPosition = null;

                    // Broadcast climb end to peers
                    this.networkManager.broadcastP2P({
                        type: 'player_climb_end',
                        payload: {
                            outpostId: outpostId
                        }
                    });
                }
            }
        }

        // Stop any ongoing animations using DeathSystem
        let mixer = null;
        let idleAction = null;
        if (isPeer) {
            mixer = entity.userData.mixer;
            // For peers, use walk action frozen at frame 1 as idle
            idleAction = entity.userData.walkAction;
        } else if (isAI && !isPeer) {
            // Check if this AI belongs to a tent
            let aiController = null;
            for (const [tentId, aiData] of this.game.aiEnemyManager.tentAIEnemies.entries()) {
                if (aiData.controller && aiData.controller.enemy === entity) {
                    aiController = aiData.controller;
                    break;
                }
            }

            if (aiController) {
                mixer = aiController.animationMixer;
                idleAction = aiController.walkAction;
            } else {
                // Fallback to legacy AI enemy
                mixer = this.game.aiEnemyAnimationMixer;
                idleAction = this.game.aiEnemyController?.walkAction;
            }
        } else if (!isAI && !isPeer) {
            mixer = this.game.animationMixer;
            // Local player has dedicated idle action
            idleAction = this.game.idleAction;
        }

        this.deathSystem.stopAnimations(mixer, idleAction);

        // Broadcast death to all peers if this is a local entity (not a peer entity)
        if (!isPeer) {
            if (isAI) {
                // Local AI died - broadcast to all peers
                this.networkManager.broadcastP2P({
                    type: 'ai_enemy_death',
                    payload: {
                        position: this.game.aiEnemy.position.toArray()
                    }
                });
            } else {
                // Mark all peers as expected to disconnect during our respawn
                // This prevents P2P reconnecting UI from showing for death/respawn events
                this.networkManager.markAllPeersExpectedDisconnect(15000);  // 15s grace period

                // Local player died - broadcast to all peers
                this.networkManager.broadcastP2P({
                    type: 'player_death',
                    payload: {
                        position: this.game.playerObject.position.toArray()
                    }
                });

                // Show death screen after death animation completes (500ms)
                setTimeout(() => {
                    if (this.game.deathScreen) {
                        this.game.deathScreen.show(this.game.deathReason || 'Unknown cause');
                    }
                }, 500);
            }
        }
    }

    async respawnPlayer() {
        if (!this.game.isDead) return;

        // Debounce: prevent multiple respawn clicks
        if (this._isRespawning) return;
        this._isRespawning = true;

        // Fully disconnect P2P + WebSocket for clean respawn (like soft page reload)
        // MUST await to ensure disconnect completes before reconnect attempt
        await this.networkManager.disconnectForRespawn();

        // Clear any mobile entity state (in case it wasn't cleared on death)
        const mobileState = this.gameState.vehicleState;
        if (mobileState.isActive()) {
            console.warn('[Respawn] Mobile entity state still active - forcing cleanup');
            // Clear occupancy so entity can be remounted (ISSUE-044 fix)
            if (mobileState.pilotingEntityId && this.game.mobileEntitySystem) {
                this.game.mobileEntitySystem.clearOccupied(mobileState.pilotingEntityId);
            }
            // Stop horse sound if still playing
            if (mobileState.horseSound?.isPlaying) {
                mobileState.horseSound.stop();
                mobileState.horseSound = null;
            }
            mobileState.forceReset('respawn cleanup');

            // Clean up activeVehicle (fixes stale boat reference when boarding ship as gunner)
            if (this.game.activeVehicle) {
                if (this.game.activeVehicle.removeDebugVisualization) {
                    this.game.activeVehicle.removeDebugVisualization(this.game.scene);
                }
                if (this.game.activeVehicle.removeColliderDebugVisualization) {
                    this.game.activeVehicle.removeColliderDebugVisualization(this.game.scene);
                }
                this.game.activeVehicle.cleanup();
                this.game.activeVehicle = null;
            }
        }
        // Extra safety: stop horse sound even if state was already inactive
        if (mobileState.horseSound?.isPlaying) {
            mobileState.horseSound.stop();
            mobileState.horseSound = null;
        }
        this.gameState.nearestMobileEntity = null;
        this.gameState.nearestLandVehicle = null;
        this.gameState.nearestWaterVehicle = null;

        // CRITICAL: Also clear towed entity state (safety net in case death didn't clear it)
        const towedEntityCleanup = this.gameState.vehicleState.towedEntity;
        if (towedEntityCleanup?.isAttached) {
            console.warn('[Respawn] Towed entity still attached - forcing cleanup');
            if (this.game.mobileEntitySystem && towedEntityCleanup.id) {
                this.game.mobileEntitySystem.clearOccupied(towedEntityCleanup.id);
            }
            this.gameState.vehicleState.clearTowedEntity();
        }
        this.gameState.nearestTowableEntity = null;

        // CRITICAL: Also clear crate state (safety net)
        const vehicleState = this.gameState.vehicleState;
        // Clear multi-crate array first
        if (vehicleState.shipCrates?.length > 0) {
            console.warn(`[Respawn] ${vehicleState.shipCrates.length} crates still loaded - forcing cleanup`);
            for (const slot of vehicleState.shipCrates) {
                if (this.game.mobileEntitySystem && slot.crateId) {
                    this.game.mobileEntitySystem.clearOccupied(slot.crateId);
                }
            }
            vehicleState.clearShipCargo();
        }
        this.gameState.nearestLoadableCrate = null;

        // CRITICAL: Clear climbing state (safety net in case death/disconnect interrupted descent)
        this.gameState.climbingState.isClimbing = false;
        this.gameState.climbingState.climbingOutpost = null;
        this.gameState.climbingState.outpostId = null;
        this.gameState.climbingState.climbingStartTime = null;
        this.gameState.climbingState.climbingPhase = null;
        this.gameState.climbingState.originalPosition = null;
        this.gameState.climbingState.targetPosition = null;
        this.gameState.climbingState.dieAfterDescent = false;
        this.gameState.climbingState.pendingDeathData = null;

        // NOTE: Death state (isDead, etc.) is NOT reset here
        // Player stays "dead" and protected until respawnToPosition() teleports them

        // CRITICAL: Cancel any active actions (chiseling, chopping, building, etc.)
        if (this.gameState.activeAction) {
            // Stop any active sounds
            if (this.gameState.activeAction.sound) {
                this.gameState.activeAction.sound.stop();
            }
            // Stop chopping animation
            if (this.game.choppingAction) {
                this.game.choppingAction.stop();
            }
            // Clear active action state
            this.gameState.activeAction = null;
        }

        // CRITICAL: Close inventory and clear all inventory UI state
        if (this.gameState.inventoryOpen && this.inventoryUI) {
            this.inventoryUI.toggleInventory(); // Close inventory
        }
        // Clear inventory UI interaction state
        if (this.inventoryUI) {
            this.inventoryUI.chiselTarget = null;
            this.inventoryUI.combineTarget = null;
            this.inventoryUI.inventoryPickedItem = null;
            this.inventoryUI.crateInventory = null;
        }

        // Clear inventory (starting tools given only for random spawns, handled in spawn callback)
        this.gameState.inventory.items = [];
        this.gameState.slingItem = null;  // Clear rifle on death
        if (this.game.playerInventory) {
            this.game.playerInventory.itemsRef = this.gameState.inventory.items;
        }
        if (this.inventoryUI) {
            this.inventoryUI.renderInventory();
        }

        // CRITICAL: Reset object tracking (clear nearestObject and nearestStructure)
        this.gameState.nearestObject = null;
        this.gameState.nearestObjectDistance = Infinity;
        this.gameState.nearestStructure = null;
        this.gameState.nearestStructureDistance = Infinity;
        this.gameState.nearestDeerCorpse = null;
        this.gameState.nearestBrownbearCorpse = null;
        this.gameState.clickedTargetObjectId = null;

        // CRITICAL: Reset all gathering-related UI states to hide stale buttons
        this.gameState.onGrass = false;
        this.gameState.mushroomAvailable = false;
        this.gameState.vegetableSeedsAvailable = false;
        this.gameState.limestoneAvailable = false;
        this.gameState.seedsAvailable = false;
        this.gameState.seedTreeType = null;
        this.gameState.vegetablesGatherAvailable = false;
        this.gameState.hempSeedsAvailable = false;
        this.gameState.hempGatherAvailable = false;
        this.gameState.nearWater = false;
        this.gameState.wasMoving = false;
        this.gameState.harvestCooldown = null; // Clear harvest cooldown

        // Clear UI elements on respawn
        ui.hideStructurePanel(); // Hide structure panel
        ui.updateChoppingProgress(0); // Clear any progress indicators
        ui.updatePlacementStatus(null); // Clear placement status

        // Close build menu if open
        if (this.game.buildMenu && this.game.buildMenu.isOpen()) {
            this.game.buildMenu.toggleBuildMenu();
        }

        // Reset hunger state based on whether player has food
        if (this.playerHunger) {
            this.playerHunger.hungerDebt = 0; // Clear debt on respawn
            this.playerHunger.twoMinuteWarningShown = false; // Reset starvation warning flag

            // Check if player has food in inventory
            const foodItems = this.playerHunger.getFoodItemsFromInventory();
            if (foodItems.length > 0) {
                // Player has food - reset to fed state
                this.playerHunger.starvationStartTime = null;
                this.playerHunger.hungerState = 'fed';
                this.playerHunger.updateFoodStatusUI(foodItems);
            } else {
                // No food - start hungry
                this.playerHunger.starvationStartTime = Date.now();
                this.playerHunger.hungerState = 'hungry';
                ui.showToast('You are hungry! Find food!', 'warning', 5000);
            }

            // Restart the hunger update loop (it stops when player dies)
            this.playerHunger.start();
        }

        // CRITICAL: Reset WASD keyboard state to prevent residual movement after respawn
        if (this.game.wasdKeys) {
            this.game.wasdKeys.w = false;
            this.game.wasdKeys.a = false;
            this.game.wasdKeys.s = false;
            this.game.wasdKeys.d = false;
        }

        // CRITICAL: Reset player controller movement state
        if (this.game.playerController) {
            this.game.playerController.wasdDirection?.set(0, 0, 0);
            this.game.playerController.waterReversalLockout = false;
        }

        // CRITICAL: Reset ambient sound combat timer to restore ambient sounds immediately
        if (this.game.ambientSoundSystem) {
            this.game.ambientSoundSystem.lastCombatTime = 0;
        }

        // CRITICAL: Clear pending NPC transactions that might fire from previous life
        this.gameState.pendingProprietorSale = null;
        this.gameState.pendingMilitiaRequest = null;

        // CRITICAL: Close chat input if open to prevent blocked movement keys
        if (this.game.chatInputOpen && this.game.closeChatInput) {
            this.game.closeChatInput();
        }

        // Clear NPC proximity states (will be recalculated at new position)
        this.gameState.nearMerchant = null;
        this.gameState.nearTrapper = null;
        this.gameState.nearBaker = null;
        this.gameState.nearGardener = null;
        this.gameState.nearWoodcutter = null;
        this.gameState.nearMiner = null;
        this.gameState.nearFisherman = null;
        this.gameState.nearBlacksmith = null;
        this.gameState.nearIronWorker = null;
        this.gameState.nearTileWorker = null;
        this.gameState.nearStoneMason = null;

        // Reset and show tasks panel on respawn
        if (this.game.tasksPanel) {
            if (this.gameState.isGuest) {
                // Guests: fresh start every spawn
                this.game.tasksPanel.reset();
            } else {
                // Accounts: reload from server data
                this.game.tasksPanel.loadState(); // Clears current state
                if (this.gameState.playerData) {
                    this.game.tasksPanel.checkServerClosed(this.gameState.playerData);
                }
            }
            // Show panel if not closed
            if (!this.game.tasksPanel.isClosed) {
                this.game.tasksPanel.show();
            }
        }

        // Reconnect to server BEFORE showing spawn screen so friends list works
        // Show loading screen during reconnect
        if (this.game.loadingScreen) {
            this.game.loadingScreen.show();
            this.game.loadingScreen.setConnecting();
        }

        try {
            await this.networkManager.reconnectForRespawnAsync();
        } catch (error) {
            console.error('[Respawn] Failed to reconnect:', error);
            // Hide loading screen and show spawn screen with error
            if (this.game.loadingScreen) {
                this.game.loadingScreen.hide();
            }
            if (this.game.spawnScreen) {
                this.game.spawnScreen.show({ isRespawn: true, kickMessage: 'Failed to reconnect to server. Please try again.' });
            }
            this._isRespawning = false;
            return;
        }

        // Hide loading screen now that we're connected
        if (this.game.loadingScreen) {
            this.game.loadingScreen.hide();
        }

        // Show spawn screen for respawn selection
        // The actual teleport happens in respawnToPosition() after selection
        if (this.game.spawnScreen) {
            // Check for P2P kick message (set by NetworkManager on P2P failure)
            const kickMessage = this.game._p2pKickMessage || null;
            if (kickMessage) {
                delete this.game._p2pKickMessage;  // Clear after use
            }
            this.game.spawnScreen.show({ isRespawn: true, kickMessage });
            return; // Exit here - respawnToPosition will be called after selection
        }

        // Fallback if spawn screen not available - use faction random spawn
        const factionId = this.gameState.factionId;
        let spawnX = 0;
        let spawnZ;

        if (factionId === null) {
            spawnZ = -1500 + Math.random() * 3000;
        } else {
            const zone = this.gameState.FACTION_ZONES[factionId];
            spawnZ = zone.minZ + Math.random() * (zone.maxZ - zone.minZ);
        }

        const spawnY = this.game.getGroundHeightAt(spawnX, spawnZ);
        this.game.playerObject.position.set(spawnX, spawnY, spawnZ);

        // Re-enable movement
        this.gameState.isMoving = false;

        // CRITICAL: Stop all animations and reset animation mixer completely
        if (this.game.animationMixer) {
            this.game.animationMixer.stopAllAction();
            this.game.animationMixer.update(0); // Clear any pending updates
        }

        // CRITICAL: Reset player mesh rotation BEFORE starting any animations
        // Death animation rotates the first child (player mesh), not the parent group
        if (this.game.playerObject && this.game.playerObject.children[0]) {
            this.game.playerObject.children[0].rotation.set(0, 0, 0);
        }

        // Start idle animation fresh
        if (this.game.idleAction) {
            this.game.idleAction.reset();
            this.game.idleAction.play();
        }

        // Force immediate mixer update to apply idle pose
        if (this.game.animationMixer) {
            this.game.animationMixer.update(0.001);
        }

        // Broadcast respawn to peers
        this.networkManager.broadcastP2P({
            type: 'player_respawn',
            payload: {
                position: [spawnX, spawnY, spawnZ]
            }
        });
    }

    /**
     * Show spawn screen with an error message
     * Used when P2P connection fails and player needs to respawn
     * @param {string} errorMessage - Error message to display
     */
    showSpawnScreenWithError(errorMessage) {
        // Hide death screen if showing
        if (this.game.deathScreen) {
            this.game.deathScreen.hide();
        }

        // Show spawn screen with error
        if (this.game.spawnScreen) {
            this.game.spawnScreen.show({
                isRespawn: true,
                errorMessage: errorMessage
            });
        } else {
            // Fallback: show alert and reload page
            alert(errorMessage);
            window._allowNavigation = true;
            window.location.reload();
        }
    }

    /**
     * Complete respawn after spawn screen selection
     * Called from SpawnScreen callback
     * @param {number} spawnX
     * @param {number} spawnZ
     */
    async respawnToPosition(spawnX, spawnZ) {
        // NOTE: Server reconnection now happens in respawnPlayer() BEFORE showing spawn screen
        // This ensures friends list requests work since we're already connected

        // === RESPAWN STATE RESET ===

        // 1. Clear completed chunks tracking (ESSENTIAL - fixes loading screen bug)
        if (this.game.chunkObjectGenerator) {
            this.game.chunkObjectGenerator.completedChunks.clear();
            this.game.chunkObjectGenerator.queue = [];
            this.game.chunkObjectGenerator.currentChunk = null;
            this.game.chunkObjectGenerator.isProcessing = false;
        }

        // 2. Reset server state flag so new chunk data is processed correctly
        this.gameState.receivedInitialServerState = false;

        // 3. Clear any deferred chunk states (prevents stale data)
        if (this.game.messageRouter?._deferredChunkStates) {
            this.game.messageRouter._deferredChunkStates = [];
        }

        // 3b. Clear pending deaths (prevents stale deaths from being applied to reconnecting peers)
        if (this.game.gameStateManager?.pendingDeaths) {
            this.game.gameStateManager.pendingDeaths.clear();
        }

        // 4. Dispose ALL chunks for clean respawn state
        // Network was disconnected/reconnected, so all client-side chunk data is stale.
        // disposeDistantChunks only removed far chunks, leaving nearby ones with stale objects/AI.
        this.disposeAllChunksForRespawn();

        // === EXISTING RESPAWN LOGIC ===

        const spawnY = this.game.getGroundHeightAt(spawnX, spawnZ);
        this.game.playerObject.position.set(spawnX, spawnY, spawnZ);

        // Ensure player has a character controller (safety net for edge cases)
        if (this.game.physicsManager) {
            const playerControllerId = this.game.playerObject.userData.objectId || 'player';
            if (!this.game.physicsManager.characterControllers.has(playerControllerId)) {
                this.game.physicsManager.createCharacterController(
                    playerControllerId,
                    0.1,    // radius (matches GameInitializer)
                    0.3,    // height (matches GameInitializer)
                    this.game.playerObject.position
                );
            } else {
                // Sync physics rigid body with new spawn position
                // Without this, physics body stays at death location causing movement block
                this.game.physicsManager.updateKinematicPosition(playerControllerId, this.game.playerObject.position);
            }
        }

        // NOW reset death state (after player has moved!)
        this.game.isDead = false;
        this.game.deathStartTime = 0;
        this.game.deathRotationProgress = 0;
        this.game.fallDirection = 1;
        this.game.deathReason = null;
        this._isRespawning = false;  // Clear debounce flag
        this.playerCombat.respawn();

        // CRITICAL: Reset CombatHUD state on respawn
        // If player had "Hold Fire" enabled before death, it persists and breaks all combat
        if (this.game.combatHUD) {
            this.game.combatHUD.isHoldingFire = false;
            this.game.combatHUD.isHudHidden = false;
            this.game.combatHUD.holdFireBtn.textContent = 'Hold Fire';
            this.game.combatHUD.holdFireBtn.style.background = 'rgba(60, 50, 40, 0.9)';
            this.game.combatHUD.contentWrapper.style.display = 'flex';
            this.game.combatHUD.toggleBtn.textContent = 'Hide';
        }

        // CRITICAL: Reset animation actions to clean state after stopAllAction()
        // This ensures combatAction/shootAction are playable again after respawn
        // Without this, the paused flag and internal state may persist incorrectly
        if (this.game.combatAction) {
            this.game.combatAction.stop();
            this.game.combatAction.reset();
            this.game.combatAction.paused = false;
        }
        if (this.game.shootAction) {
            this.game.shootAction.stop();
            this.game.shootAction.reset();
            this.game.shootAction.paused = false;
        }

        // Ensure rifle starts hidden - animation update will show it when in combat
        if (this.game.playerRifle) {
            this.game.playerRifle.visible = false;
        }

        // Show loading screen while chunks load around new spawn
        if (this.game.loadingScreen) {
            this.game.loadingScreen.show();
            this.game.loadingScreen.setLoadingChunks();
        }

        // Re-enable movement
        this.gameState.isMoving = false;

        // Reset player mesh rotation
        if (this.game.playerObject?.children[0]) {
            this.game.playerObject.children[0].rotation.set(0, 0, 0);
        }

        // Play idle animation
        if (this.game.idleAction) {
            this.game.idleAction.reset().play();
        }

        // 6. Request fresh chunk data from server (ESSENTIAL)
        if (this.game.messageRouter) {
            const success = this.game.messageRouter.joinChunkAtSpawn();
            if (!success) {
                console.error('[Respawn] joinChunkAtSpawn failed - WebSocket may not be connected, retrying...');
                // Retry after a short delay to allow WebSocket to stabilize
                setTimeout(() => {
                    if (this.game.messageRouter) {
                        const retrySuccess = this.game.messageRouter.joinChunkAtSpawn();
                        if (!retrySuccess) {
                            console.error('[Respawn] joinChunkAtSpawn retry failed - forcing page reload');
                            window._allowNavigation = true;
                            window.location.reload();
                        }
                    }
                }, 500);
            }
        }

        // 7. Reinitialize physics colliders for chunks around spawn position
        // This fixes the bug where colliders were removed when player was far away,
        // but chunks are kept (not disposed) when respawning nearby
        if (this.game.chunkManager) {
            const CHUNK_SIZE = this.game.chunkManager.chunkSize || 50;
            const spawnChunkX = Math.floor(spawnX / CHUNK_SIZE);
            const spawnChunkZ = Math.floor(spawnZ / CHUNK_SIZE);

            // Initialize physics colliders for existing chunks in physics radius
            this.game.chunkManager.initializePhysicsCollidersAroundPlayer(spawnChunkX, spawnChunkZ);

            // Initialize navigation maps for worker AI pathfinding
            this.game.chunkManager.initializeNavMapsAroundPlayer(spawnChunkX, spawnChunkZ);

            // Also ensure objects are in objectRegistry for interaction detection
            this._repopulateObjectRegistry(spawnChunkX, spawnChunkZ);
        }

        // Broadcast respawn to peers
        this.networkManager.broadcastP2P({
            type: 'player_respawn',
            payload: {
                position: [spawnX, spawnY, spawnZ]
            }
        });
    }

    /**
     * Dispose ALL loaded chunks and clear all registries for a clean respawn.
     * After network disconnect/reconnect, all client-side chunk data is stale.
     * joinChunkAtSpawn() will reload everything fresh from the server.
     */
    disposeAllChunksForRespawn() {
        if (!this.game.chunkManager) return;

        const chunksToDispose = [...this.game.chunkManager.loadedChunks];

        for (const key of chunksToDispose) {
            // Clean up AI entities (disposeChunk doesn't do this)
            this.game.banditController?.onChunkUnloaded(key);
            this.game.deerController?.onChunkUnloaded(key);
            this.game.brownBearController?.onChunkUnloaded(key);

            const workerControllers = [
                'woodcutterController', 'bakerController', 'gardenerController',
                'minerController', 'stoneMasonController', 'blacksmithController',
                'ironWorkerController', 'tileWorkerController', 'fishermanController'
            ];
            for (const name of workerControllers) {
                this.game[name]?.onChunkUnloaded(key);
            }

            // Dispose the chunk (removes 3D objects, physics, billboards, etc.)
            this.game.chunkManager.disposeChunk(key);
        }

        // Clear all structure registries (will be rebuilt from fresh server data)
        this.gameState.structuresById.clear();
        this.gameState.banditStructuresByChunk.clear();
        this.gameState.brownBearStructuresByChunk.clear();
        this.gameState.deerTreeStructuresByChunk.clear();
        this.gameState.militiaStructuresByChunk.clear();
        this.gameState.marketsByChunk.clear();
        this.gameState.bakeriesByChunk.clear();
        this.gameState.gardenersByChunk.clear();
        this.gameState.woodcuttersByChunk.clear();
        this.gameState.minersByChunk.clear();
        this.gameState.ironworksByChunk.clear();
        this.gameState.tileworksByChunk.clear();
        this.gameState.blacksmithsByChunk.clear();
        this.gameState.stonemasonsByChunk.clear();
        this.gameState.fishermanByChunk.clear();

        // Clear removed objects cache (fresh server data = fresh state)
        this.gameState.removedObjectsCache.clear();

        // Clear AI dead-tracking sets so bandits/militia can respawn with fresh chunk data
        // Without this, _deadTentIds persists across respawn and blocks AI from spawning
        if (this.game.banditController?._deadTentIds) {
            this.game.banditController._deadTentIds.clear();
        }
        if (this.game.aiEnemyManager) {
            this.game.aiEnemyManager.tentAIEnemies.clear();
            this.game.aiEnemyManager.deadTentAIs.clear();
        }
    }

    /**
     * Dispose chunks that are far from a position
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     */
    disposeDistantChunks(x, z) {
        if (!this.game.chunkManager) return;

        // Use actual config values
        const CHUNK_SIZE = this.game.chunkManager.chunkSize || 50;
        const LOAD_RADIUS = CONFIG.CHUNKS?.LOAD_RADIUS || 10;

        const newChunkX = Math.floor(x / CHUNK_SIZE);
        const newChunkZ = Math.floor(z / CHUNK_SIZE);

        const chunksToDispose = [];

        for (const key of this.game.chunkManager.loadedChunks) {
            const [cx, cz] = key.split(',').map(Number);
            const dx = Math.abs(cx - newChunkX);
            const dz = Math.abs(cz - newChunkZ);

            // Keep chunks within load radius of new spawn
            if (dx > LOAD_RADIUS || dz > LOAD_RADIUS) {
                chunksToDispose.push(key);
            }
        }

        for (const key of chunksToDispose) {
            this.game.chunkManager.disposeChunk(key);

            // Clean up AI entities in this chunk (disposeChunk doesn't do this)
            // This ensures AI meshes don't remain in scene after respawn
            if (this.game.banditController) {
                this.game.banditController.onChunkUnloaded(key);
            }
            if (this.game.deerController) {
                this.game.deerController.onChunkUnloaded(key);
            }
            if (this.game.brownBearController) {
                this.game.brownBearController.onChunkUnloaded(key);
            }
            // Worker controllers
            const workerControllers = [
                'woodcutterController', 'bakerController', 'gardenerController',
                'minerController', 'stoneMasonController', 'blacksmithController',
                'ironWorkerController', 'tileWorkerController', 'fishermanController'
            ];
            for (const name of workerControllers) {
                if (this.game[name]) {
                    this.game[name].onChunkUnloaded(key);
                }
            }
        }
    }

    /**
     * Repopulate objectRegistry for chunks in physics radius around spawn
     * This ensures objects are findable by InteractionManager after respawn
     * @param {number} spawnChunkX - Spawn chunk X coordinate
     * @param {number} spawnChunkZ - Spawn chunk Z coordinate
     */
    _repopulateObjectRegistry(spawnChunkX, spawnChunkZ) {
        const physicsRadius = CONFIG.CHUNKS?.PHYSICS_RADIUS || 1;
        const chunkObjects = this.game.chunkManager?.chunkObjects;
        const objectRegistry = this.game.objectRegistry;

        if (!chunkObjects || !objectRegistry) return;

        let count = 0;
        for (let dx = -physicsRadius; dx <= physicsRadius; dx++) {
            for (let dz = -physicsRadius; dz <= physicsRadius; dz++) {
                const chunkKey = `${spawnChunkX + dx},${spawnChunkZ + dz}`;
                const objects = chunkObjects.get(chunkKey);
                if (!objects) continue;

                for (const obj of objects) {
                    if (obj.userData?.objectId && !objectRegistry.has(obj.userData.objectId)) {
                        objectRegistry.set(obj.userData.objectId, obj);
                        count++;
                    }
                }
            }
        }
    }
}

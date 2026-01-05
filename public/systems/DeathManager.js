
import { ui } from '../ui.js';
import { CONFIG } from '../config.js';
import ChunkCoordinates from '../core/ChunkCoordinates.js';

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
        if (!isAI && !isPeer && this.gameState.mobileEntityState.isActive) {
            const mobileState = this.gameState.mobileEntityState;
            const entityId = mobileState.entityId;
            const entityType = mobileState.entityType;
            const entity = mobileState.currentEntity;

            // Stop horse animation and sound FIRST
            if (entityType === 'horse') {
                if (mobileState.entityWalkAction) {
                    mobileState.entityWalkAction.stop();
                }
                if (mobileState.entityMixer) {
                    mobileState.entityMixer.stopAllAction();
                    mobileState.entityMixer = null;
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
                    quality: mobileState.entityQuality,
                    lastRepairTime: mobileState.entityLastRepairTime
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
                    isDeathLoss: entityType === 'boat'  // Only boats are truly lost
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

            // Clear mobile entity state
            mobileState.isActive = false;
            mobileState.currentEntity = null;
            mobileState.entityId = null;
            mobileState.entityType = null;
            mobileState.phase = null;
            mobileState.boardingStartTime = null;
            mobileState.disembarkStartTime = null;
            mobileState.originalPosition = null;
            mobileState.targetPosition = null;
            mobileState.entityQuality = null;
            mobileState.entityLastRepairTime = null;
            mobileState.entityMixer = null;
            mobileState.entityWalkAction = null;

            // Clear nearest mobile entity
            this.gameState.nearestMobileEntity = null;

            console.log(`[Death] Player died while piloting ${entityType} - ${entityType === 'horse' ? 'released' : 'lost'}`);
            // Continue with normal death processing below
        }

        // SPECIAL CASE: If local player is manning artillery, release it on death
        if (!isAI && !isPeer && this.gameState.artilleryManningState?.isManning) {
            const manningState = this.gameState.artilleryManningState;
            const artillery = manningState.mannedArtillery;
            const artilleryId = manningState.artilleryId;

            // Clear occupied status
            if (this.game.mobileEntitySystem) {
                this.game.mobileEntitySystem.clearOccupied(artilleryId);
            }

            // Send release message to server (rotation may have changed)
            if (artillery) {
                this.networkManager.sendMessage('release_artillery', {
                    entityId: artilleryId,
                    chunkKey: manningState.artilleryChunkKey,
                    clientId: this.gameState.clientId,
                    position: artillery.position.toArray(),
                    rotation: artillery.rotation.y,
                    quality: artillery.userData?.quality,
                    lastRepairTime: artillery.userData?.lastRepairTime,
                    wasManning: true
                });

                // Broadcast to peers
                this.networkManager.broadcastP2P({
                    type: 'artillery_unmanned',
                    payload: {
                        artilleryId: artilleryId,
                        rotation: artillery.rotation.y
                    }
                });
            }

            // Clear manning state
            manningState.isManning = false;
            manningState.mannedArtillery = null;
            manningState.artilleryId = null;
            manningState.artilleryChunkKey = null;
            manningState.artilleryOriginalChunkKey = null;
            manningState.artilleryHeading = 0;
            manningState.lastFireTime = 0;
            manningState._terrainFrameCount = 0;
            manningState._lastBroadcastTime = 0;

            // Clear nearest mannable artillery
            this.gameState.nearestMannableArtillery = null;

            console.log('[Death] Player died while manning artillery - released');
        }

        // SPECIAL CASE: If local player is towing a cart, release cart AND crate on death
        if (!isAI && !isPeer && this.gameState.cartAttachmentState.isAttached) {
            const cartState = this.gameState.cartAttachmentState;
            const crateState = this.gameState.crateLoadState;
            const cartId = cartState.cartId;
            const cart = cartState.attachedCart;

            // CRITICAL: Handle loaded crate FIRST (before cart release)
            if (crateState && crateState.isLoaded && crateState.loadedCrate && cart) {
                const crate = crateState.loadedCrate;
                const crateId = crate.userData?.objectId;

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

                // Clear crate state
                crateState.isLoaded = false;
                crateState.loadedCrate = null;

                console.log('[Death] Crate unloaded from cart during death');
            }

            // Cart is released at current position (not lost like boat)
            if (cart) {
                // CRITICAL: Force cart position update before releasing
                // The cart may be behind due to physics lag if we were mounted on horse
                const mobileState = this.gameState.mobileEntityState;
                const wasMounted = mobileState.currentEntity && mobileState.entityType === 'horse';

                if (wasMounted) {
                    // We already handled horse dismount above, but cart may still be stale
                    // Use the horse's last known position to position cart correctly
                    const horse = mobileState.currentEntity;
                    if (horse) {
                        const hitchOffset = CONFIG.CART_PHYSICS?.HITCH_OFFSET || 0.4;
                        const tetherlength = CONFIG.CART_PHYSICS?.TETHER_LENGTH || 0.3;
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
                this.networkManager.sendMessage('release_cart', {
                    entityId: cartId,
                    chunkKey: cartState.cartChunkKey,
                    clientId: this.gameState.clientId,
                    position: position,
                    rotation: rotation,
                    quality: cartState.cartQuality,
                    lastRepairTime: cartState.cartLastRepairTime
                });

                // Broadcast to peers
                this.networkManager.broadcastP2P({
                    type: 'cart_released',
                    payload: {
                        cartId: cartId,
                        position: position,
                        rotation: rotation
                    }
                });

                // Update cart chunk key
                cart.userData.chunkKey = newChunkKey;
            }

            // Clear cart state
            cartState.isAttached = false;
            cartState.attachedCart = null;
            cartState.cartId = null;
            cartState.cartChunkKey = null;
            cartState.cartOriginalChunkKey = null;
            cartState.cartQuality = null;
            cartState.cartLastRepairTime = null;
            cartState._terrainFrameCount = 0;
            cartState._lastBroadcastTime = 0;

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

            console.log('[Death] Player died while towing cart - cart and crate released');
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

                console.log('[Death] Player died in outpost - starting climb down first');
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
                // Stop player from shooting while dead
                this.playerCombat.die();

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

    respawnPlayer() {
        if (!this.game.isDead) return;

        console.log('[Respawn] Starting respawn process...');

        // Clear any mobile entity state (in case it wasn't cleared on death)
        const mobileState = this.gameState.mobileEntityState;
        if (mobileState.isActive) {
            console.warn('[Respawn] Mobile entity state still active - forcing cleanup');
            // Clear occupancy so entity can be remounted (ISSUE-044 fix)
            if (mobileState.entityId && this.game.mobileEntitySystem) {
                this.game.mobileEntitySystem.clearOccupied(mobileState.entityId);
            }
            // Stop horse sound if still playing
            if (mobileState.horseSound?.isPlaying) {
                mobileState.horseSound.stop();
                mobileState.horseSound = null;
            }
            mobileState.isActive = false;
            mobileState.currentEntity = null;
            mobileState.entityId = null;
            mobileState.entityType = null;
            mobileState.phase = null;
            mobileState.boardingStartTime = null;
            mobileState.disembarkStartTime = null;
            mobileState.originalPosition = null;
            mobileState.targetPosition = null;
            mobileState.entityQuality = null;
            mobileState.entityLastRepairTime = null;
            mobileState.entityMixer = null;
            mobileState.entityWalkAction = null;
        }
        // Extra safety: stop horse sound even if state was already inactive
        if (mobileState.horseSound?.isPlaying) {
            mobileState.horseSound.stop();
            mobileState.horseSound = null;
        }
        this.gameState.nearestMobileEntity = null;

        // CRITICAL: Also clear cart state (safety net in case death didn't clear it)
        const cartState = this.gameState.cartAttachmentState;
        if (cartState && cartState.isAttached) {
            console.warn('[Respawn] Cart state still attached - forcing cleanup');
            if (this.game.mobileEntitySystem && cartState.cartId) {
                this.game.mobileEntitySystem.clearOccupied(cartState.cartId);
            }
            cartState.isAttached = false;
            cartState.attachedCart = null;
            cartState.cartId = null;
            cartState.cartChunkKey = null;
            cartState.cartOriginalChunkKey = null;
            cartState.cartQuality = null;
            cartState.cartLastRepairTime = null;
            cartState._terrainFrameCount = 0;
            cartState._lastBroadcastTime = 0;
        }
        this.gameState.nearestTowableEntity = null;

        // CRITICAL: Also clear crate state (safety net)
        const crateState = this.gameState.crateLoadState;
        if (crateState && crateState.isLoaded) {
            console.warn('[Respawn] Crate state still loaded - forcing cleanup');
            const crateId = crateState.loadedCrate?.userData?.objectId;
            if (this.game.mobileEntitySystem && crateId) {
                this.game.mobileEntitySystem.clearOccupied(crateId);
            }
            crateState.isLoaded = false;
            crateState.loadedCrate = null;
        }
        this.gameState.nearestLoadableCrate = null;

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
        if (this.inventoryUI) {
            this.inventoryUI.renderInventory();
        }

        // CRITICAL: Reset object tracking (clear nearestObject and nearestStructure)
        this.gameState.nearestObject = null;
        this.gameState.nearestObjectDistance = Infinity;
        this.gameState.nearestStructure = null;
        this.gameState.nearestStructureDistance = Infinity;

        // CRITICAL: Reset all gathering-related UI states to hide stale buttons
        this.gameState.onGrass = false;
        this.gameState.mushroomAvailable = false;
        this.gameState.vegetableSeedsAvailable = false;
        this.gameState.seedsAvailable = false;
        this.gameState.seedTreeType = null;
        this.gameState.vegetablesGatherAvailable = false;
        this.gameState.nearWater = false;
        this.gameState.wasMoving = false;

        // Clear UI elements on respawn
        ui.hideStructurePanel(); // Hide structure panel
        ui.updateChoppingProgress(0); // Clear any progress indicators
        ui.updatePlacementStatus(null); // Clear placement status

        // Reset hunger state based on whether player has food
        if (this.playerHunger) {
            this.playerHunger.hungerDebt = 0; // Clear debt on respawn

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

        // Show spawn screen for respawn selection
        // The actual teleport happens in respawnToPosition() after selection
        if (this.game.spawnScreen) {
            this.game.spawnScreen.show({ isRespawn: true });
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
            console.log('[Respawn] Resetting rotation from:', this.game.playerObject.children[0].rotation);
            this.game.playerObject.children[0].rotation.set(0, 0, 0);
            console.log('[Respawn] Rotation reset to:', this.game.playerObject.children[0].rotation);
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

        console.log('[Respawn] Respawn complete');

        // Broadcast respawn to peers
        this.networkManager.broadcastP2P({
            type: 'player_respawn',
            payload: {
                position: [spawnX, spawnY, spawnZ]
            }
        });
    }

    /**
     * Complete respawn after spawn screen selection
     * Called from SpawnScreen callback
     * @param {number} spawnX
     * @param {number} spawnZ
     */
    respawnToPosition(spawnX, spawnZ) {
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

        // 4. Dispose chunks far from new spawn to free memory
        this.disposeDistantChunks(spawnX, spawnZ);

        // 5. Re-add remaining loaded chunks to completedChunks
        // This fixes the loading screen getting stuck when respawning near the same location
        // (chunks that weren't disposed still exist but completedChunks was cleared)
        if (this.game.chunkObjectGenerator && this.game.chunkManager) {
            for (const chunkKey of this.game.chunkManager.loadedChunks) {
                // Only add if chunk has objects (meaning generation completed previously)
                if (this.game.chunkManager.chunkObjects.has(chunkKey)) {
                    this.game.chunkObjectGenerator.completedChunks.add(chunkKey);
                }
            }
        }

        // === EXISTING RESPAWN LOGIC ===

        const spawnY = this.game.getGroundHeightAt(spawnX, spawnZ);
        this.game.playerObject.position.set(spawnX, spawnY, spawnZ);

        // Ensure player has a character controller (safety net for edge cases)
        if (this.game.physicsManager) {
            if (!this.game.physicsManager.characterControllers.has('player')) {
                this.game.physicsManager.createCharacterController(
                    'player',
                    0.1,    // radius (matches GameInitializer)
                    0.3,    // height (matches GameInitializer)
                    this.game.playerObject.position
                );
            } else {
                // Sync physics rigid body with new spawn position
                // Without this, physics body stays at death location causing movement block
                this.game.physicsManager.updateKinematicPosition('player', this.game.playerObject.position);
            }
        }

        // NOW reset death state (after player has moved!)
        this.game.isDead = false;
        this.game.deathStartTime = 0;
        this.game.deathRotationProgress = 0;
        this.game.fallDirection = 1;
        this.game.deathReason = null;
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
            this.game.messageRouter.joinChunkAtSpawn();
        }

        console.log(`[Respawn] Player respawned at (${spawnX}, ${spawnY.toFixed(1)}, ${spawnZ})`);

        // Broadcast respawn to peers
        this.networkManager.broadcastP2P({
            type: 'player_respawn',
            payload: {
                position: [spawnX, spawnY, spawnZ]
            }
        });
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
        }

        if (chunksToDispose.length > 0) {
            console.log(`[Respawn] Disposed ${chunksToDispose.length} distant chunks`);
        }
    }
}

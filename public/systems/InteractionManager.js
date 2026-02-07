
import { ui } from '../ui.js';
import { CONFIG } from '../config.js';
import { COLLISION_GROUPS } from '../core/PhysicsManager.js';
import { QualityGenerator } from '../core/QualityGenerator.js';
import { TERRAIN_CONFIG } from '../terrainsystem.js';
import * as THREE from 'three';

/**
 * InteractionManager
 * Handles proximity detection, object registry management, and interaction state updates.
 */
export class InteractionManager {
    constructor(game) {
        this.game = game;
        this.gameState = game.gameState;
        this.physicsManager = game.physicsManager;
        this.chunkManager = game.chunkManager;
        this.terrainGenerator = game.terrainGenerator;
        this.grassGathering = game.grassGathering;
        this.dockMerchantSystem = game.dockMerchantSystem;

        // Sensor-based proximity tracking (objectId -> THREE.Object3D)
        this.activeProximityObjects = new Map();

        // Object registry for fast lookups (objectId -> THREE.Object3D)
        // Populated lazily on first proximity check, then maintained in real-time
        this.objectRegistry = new Map();

        // Store reference in game for backward compatibility/access
        this.game.objectRegistry = this.objectRegistry;
        this.game.activeProximityObjects = this.activeProximityObjects;

        // Type sets for O(1) lookups (defined once, reused forever)
        this.treeTypes = new Set(['oak', 'oak2', 'pine', 'pine2', 'fir', 'cypress', 'apple']);
        this.rockTypes = new Set(['limestone', 'sandstone', 'clay', 'iron', 'vegetables', 'hemp']);
        this.structureTypes = new Set(['crate', 'tent', 'house', 'market', 'outpost', 'ship', 'dock', 'campfire', 'tileworks', 'ironworks', 'blacksmith', 'bakery', 'gardener', 'fisherman', 'miner', 'woodcutter', 'stonemason', 'bearden', 'artillery', 'wall', 'warehouse']);
        this.mobileEntityTypes = new Set(['boat', 'sailboat', 'ship2', 'horse']);
        this.towableEntityTypes = new Set(['cart', 'artillery']);
    }

    setPhysicsManager(physicsManager) {
        this.physicsManager = physicsManager;
        
        // Set up callback to clean objectRegistry when objects are removed
        if (this.physicsManager) {
            this.physicsManager.onObjectRemoved = (objectId) => {
                this.objectRegistry.delete(objectId);
            };
        }
    }

    populateObjectRegistry() {
        // Pre-populate objectRegistry from chunkObjects to avoid scene.traverse()
        // This provides O(1) lookup instead of O(M) scene traversal
        let count = 0;
        let treeRockCount = 0;
        if (!this.chunkManager) return 0;

        for (const objects of this.chunkManager.chunkObjects.values()) {
            for (const obj of objects) {
                if (obj.userData?.objectId) {
                    this.objectRegistry.set(obj.userData.objectId, obj);
                    count++;
                    // DEBUG: Count trees/rocks specifically
                    const modelType = obj.userData.modelType;
                    if (['oak', 'pine', 'fir', 'cypress', 'apple', 'limestone', 'sandstone', 'clay', 'iron'].includes(modelType)) {
                        treeRockCount++;
                    }
                }
            }
        }
        // Removed excessive logging
        return count;
    }

    checkProximityToObjects() {
        // Query nearby objects using spatial query (reliable, level-triggered)
        if (!this.physicsManager || !this.physicsManager.initialized || !this.physicsManager.world) {
            return;
        }

        // Populate objectRegistry from chunkObjects if empty (one-time initialization)
        // Note: Objects are added to registry in real-time by ChunkObjectGenerator, MessageRouter,
        // SceneObjectFactory, game.js, etc. - no periodic refresh needed.
        if (this.objectRegistry.size === 0 && this.chunkManager && this.chunkManager.chunkObjects.size > 0) {
            this.populateObjectRegistry();
        }

        // Use spatial query to find all bounding boxes within interaction radius
        const interactionRadius = 0.75; // Tight interaction range - player must be very close
        const collisionMask = COLLISION_GROUPS.NATURAL | COLLISION_GROUPS.PLACED | COLLISION_GROUPS.STRUCTURE;

        const nearbyColliders = this.physicsManager.querySphere(
            this.game.playerObject.position,
            interactionRadius,
            collisionMask
        );

        // Separate larger query for mobile entities (boats/ships have larger proximity ranges)
        // BOAT group included to detect peer ships (they use BOAT collision group when piloted)
        const mobileEntityRadius = 5.5; // Covers ship2 proximity range of 4
        const mobileEntityColliders = this.physicsManager.querySphere(
            this.game.playerObject.position,
            mobileEntityRadius,
            COLLISION_GROUPS.PLACED | COLLISION_GROUPS.STRUCTURE | COLLISION_GROUPS.BOAT
        );

        // Update active proximity objects based on spatial query results
        // Clear and rebuild the map to ensure stale entries are removed
        const previousSize = this.activeProximityObjects.size;
        this.activeProximityObjects.clear();

        // DEBUG: Track what we find
        let foundTreesRocks = [];

        nearbyColliders.forEach(colliderHandle => {
            // Get object ID from collider handle (now O(1) with reverse lookup map)
            const objectId = this.physicsManager.getObjectIdFromCollider(colliderHandle);
            if (!objectId) return;

            // Get object from registry (O(1) lookup)
            const sceneObject = this.objectRegistry.get(objectId);

            if (sceneObject) {
                this.activeProximityObjects.set(objectId, sceneObject);

                // DEBUG: Track trees/rocks found
                const modelType = sceneObject.userData?.modelType;
                if (['oak', 'pine', 'fir', 'cypress', 'apple', 'limestone', 'sandstone', 'clay', 'iron'].includes(modelType)) {
                    foundTreesRocks.push(modelType);
                }
            } else {
                // Object not in registry - this shouldn't happen if populateObjectRegistry is working
                console.warn(`[ObjectRegistry] Object ${objectId} not found in registry`);
            }
        });

        // DEBUG: Log changes in proximity objects (not every frame)
        // Removed excessive logging

        // Find nearest objects by type from active proximity objects
        // Type sets defined in constructor for O(1) lookups

        let nearestNaturalObject = null;
        let nearestNaturalDistance = Infinity;
        let nearestConstructionSite = null;
        let nearestConstructionDistance = Infinity;
        let nearestStructure = null;
        let nearestStructureDistance = Infinity;
        let nearestMobileEntity = null;
        let nearestMobileEntityDistance = Infinity;
        // Separate tracking for land (horse) and water (boat/sailboat/ship2) vehicles
        let nearestLandVehicle = null;
        let nearestLandVehicleDistance = Infinity;
        let nearestWaterVehicle = null;
        let nearestWaterVehicleDistance = Infinity;
        const waterVehicleTypesSet = new Set(['boat', 'sailboat', 'ship2']);
        const landVehicleTypesSet = new Set(['horse']);
        let nearestTowableEntity = null;
        let nearestTowableEntityDistance = Infinity;
        // Track loadable crates in same loop (avoid second iteration)
        let nearestLoadableCrate = null;
        let nearestLoadableDistance = Infinity;
        // Track crates when cart attached OR when piloting a boat (for boat crate loading)
        const vState = this.gameState.vehicleState;
        const isPilotingBoat = vState?.isPiloting() &&
            ['boat', 'sailboat', 'ship2'].includes(vState?.pilotingEntityType);
        const entityType = vState?.pilotingEntityType;
        const isTowingCart = vState?.isTowing() && vState?.towedEntity?.type === 'cart';
        // Check capacity: boats use CRATE_VEHICLES config, carts use legacy single-crate check
        let hasRoomForCrate = false;
        if (isPilotingBoat) {
            // Boat capacity from config (boat=0, sailboat=1, ship2=4)
            const maxSlots = CONFIG.CRATE_VEHICLES?.CAPACITY?.[entityType] || 0;
            const currentCount = vState?.shipCrates?.length || 0;
            hasRoomForCrate = maxSlots > 0 && currentCount < maxSlots;
        } else if (vState?.isTowing() && vState?.towedEntity?.type === 'cart') {
            // Cart: single crate capacity (use cargo system)
            hasRoomForCrate = !vState?.cartCargo?.hasItems();
        }
        const shouldTrackLoadableCrates = hasRoomForCrate;

        // Track mannable artillery (player can man to fire - separate from towing)
        let nearestMannableArtillery = null;
        let nearestMannableArtilleryDistance = Infinity;
        const shouldTrackMannableArtillery = !vState?.isManningArtillery() &&
                                             !vState?.isActive() &&
                                             !vState?.isTowing();

        // Track loadable artillery for ship2 (can load artillery onto ship2 deck)
        let nearestLoadableArtillery = null;
        let nearestLoadableArtilleryDistance = Infinity;
        const isPilotingShip2 = vState?.isPiloting() && vState?.pilotingEntityType === 'ship2';
        const maxArtillerySlots = CONFIG.CRATE_VEHICLES?.ARTILLERY_CAPACITY?.ship2 || 0;
        const currentArtilleryCount = vState?.loadedArtillery?.length || 0;
        const hasRoomForArtillery = maxArtillerySlots > 0 && currentArtilleryCount < maxArtillerySlots;
        const shouldTrackLoadableArtillery = isPilotingShip2 && hasRoomForArtillery;

        // Track loadable horses for ship2 (can load horses onto ship2 deck)
        let nearestLoadableHorse = null;
        let nearestLoadableHorseDistance = Infinity;
        const maxHorseSlots = CONFIG.HORSE_VEHICLES?.CAPACITY?.ship2 || 0;
        const currentHorseCount = vState?.shipHorses?.length || 0;
        const hasRoomForHorse = maxHorseSlots > 0 && currentHorseCount < maxHorseSlots;
        const shouldTrackLoadableHorses = isPilotingShip2 && hasRoomForHorse;

        // Track nearest warehouse for crate storage
        let nearestWarehouse = null;
        let nearestWarehouseDistance = Infinity;

        // Calculate distances to all active proximity objects
        // PERFORMANCE OPTIMIZATION: Use squared distances for comparisons to avoid expensive Math.sqrt()
        this.activeProximityObjects.forEach((object, objectId) => {
            // Safety check: ensure object still exists in scene
            if (!object.parent) {
                // Object has been removed from scene, clean up tracking
                this.activeProximityObjects.delete(objectId);
                return;
            }

            const modelType = object.userData.modelType;
            const dx = this.game.playerObject.position.x - object.position.x;
            const dz = this.game.playerObject.position.z - object.position.z;
            const distanceSquared = dx * dx + dz * dz;  // No Math.sqrt() needed for comparisons!

            // Categorize and track nearest of each type
            if (object.userData.isConstructionSite) {
                if (distanceSquared < nearestConstructionDistance) {
                    nearestConstructionDistance = distanceSquared;
                    nearestConstructionSite = object;
                }
                // Construction sites should also count as structures for demolish button
                if (distanceSquared < nearestStructureDistance) {
                    nearestStructureDistance = distanceSquared;
                    nearestStructure = object;
                }
            } else if (object.userData.isCorpse) {
                // Corpses are lootable - track as structure for inventory UI
                if (distanceSquared < nearestStructureDistance) {
                    nearestStructureDistance = distanceSquared;
                    nearestStructure = object;
                }
            } else if (this.structureTypes.has(modelType)) {
                if (distanceSquared < nearestStructureDistance) {
                    nearestStructureDistance = distanceSquared;
                    nearestStructure = object;
                }
                // Also track nearest crate for vehicle loading or warehouse storage
                if (modelType === 'crate') {
                    const crateId = object.userData.objectId;
                    const mobileEntitySystem = this.game.mobileEntitySystem;
                    // Only track if not occupied by someone else
                    if (!mobileEntitySystem || !mobileEntitySystem.isOccupied(crateId)) {
                        if (distanceSquared < nearestLoadableDistance) {
                            nearestLoadableDistance = distanceSquared;
                            nearestLoadableCrate = object;
                        }
                    }
                }
                // Also track artillery for horse towing (artillery is in structureTypes but also towable)
                if (modelType === 'artillery') {
                    const entityId = object.userData.objectId;
                    const mobileEntitySystem = this.game.mobileEntitySystem;
                    // Don't show if currently towing it ourselves
                    const isOwnArtillery = this.gameState.vehicleState.towedEntity?.type === 'artillery' && this.gameState.vehicleState.towedEntity?.mesh === object;
                    // Check if occupied by player's own militia (allow tow in that case)
                    const isOccupied = mobileEntitySystem && mobileEntitySystem.isOccupied(entityId);
                    const militiaEntity = this.game.banditController?.entities?.get(entityId);
                    const meshMilitiaOwner = object.userData.militiaOwner;
                    const isOwnMilitiaOccupied = isOccupied && (
                        militiaEntity?.ownerId === this.gameState.accountId ||
                        meshMilitiaOwner === this.gameState.accountId
                    );
                    // Allow tow if: not occupied, OR occupied by player's own militia
                    if (!isOwnArtillery && (!isOccupied || isOwnMilitiaOccupied)) {
                        if (distanceSquared < nearestTowableEntityDistance) {
                            nearestTowableEntityDistance = distanceSquared;
                            nearestTowableEntity = object;
                        }
                    }
                    // Also track for manning (player stands behind to fire)
                    if (shouldTrackMannableArtillery) {
                        const isManning = this.gameState.vehicleState.mannedArtillery?.mesh === object;
                        if (!isManning && (!mobileEntitySystem || !mobileEntitySystem.isOccupied(entityId))) {
                            if (distanceSquared < nearestMannableArtilleryDistance) {
                                nearestMannableArtilleryDistance = distanceSquared;
                                nearestMannableArtillery = object;
                            }
                        }
                    }
                    // Track for ship2 loading (can load artillery onto ship2 deck)
                    if (shouldTrackLoadableArtillery) {
                        const isManning = this.gameState.vehicleState.mannedArtillery?.mesh === object;
                        // Allow loading if: not occupied, OR occupied by player's own militia
                        if (!isOwnArtillery && !isManning && (!isOccupied || isOwnMilitiaOccupied)) {
                            if (distanceSquared < nearestLoadableArtilleryDistance) {
                                nearestLoadableArtilleryDistance = distanceSquared;
                                nearestLoadableArtillery = object;
                            }
                        }
                    }
                }
                // Track nearest warehouse for crate storage
                if (modelType === 'warehouse') {
                    if (distanceSquared < nearestWarehouseDistance) {
                        nearestWarehouseDistance = distanceSquared;
                        nearestWarehouse = object;
                    }
                }
            } else if (this.mobileEntityTypes.has(modelType)) {
                // Check if this mobile entity is not occupied by someone else
                const entityId = object.userData.objectId;
                const mobileEntitySystem = this.game.mobileEntitySystem;
                if (!mobileEntitySystem || !mobileEntitySystem.isOccupied(entityId)) {
                    // Track overall nearest (for backward compatibility)
                    if (distanceSquared < nearestMobileEntityDistance) {
                        nearestMobileEntityDistance = distanceSquared;
                        nearestMobileEntity = object;
                    }
                    // Track land vs water vehicles separately
                    if (landVehicleTypesSet.has(modelType)) {
                        if (distanceSquared < nearestLandVehicleDistance) {
                            nearestLandVehicleDistance = distanceSquared;
                            nearestLandVehicle = object;
                        }
                    } else if (waterVehicleTypesSet.has(modelType)) {
                        if (distanceSquared < nearestWaterVehicleDistance) {
                            nearestWaterVehicleDistance = distanceSquared;
                            nearestWaterVehicle = object;
                        }
                    }
                    // Track horses for ship2 loading (can load horses onto ship2 deck)
                    if (modelType === 'horse' && shouldTrackLoadableHorses) {
                        if (distanceSquared < nearestLoadableHorseDistance) {
                            nearestLoadableHorseDistance = distanceSquared;
                            nearestLoadableHorse = object;
                        }
                    }
                }
            } else if (this.towableEntityTypes.has(modelType)) {
                // Check if this cart is not already being towed by someone else
                const entityId = object.userData.objectId;
                const mobileEntitySystem = this.game.mobileEntitySystem;
                // Don't show cart if currently towing it ourselves
                const isOwnCart = this.gameState.vehicleState.towedEntity?.mesh === object;
                if (!isOwnCart && (!mobileEntitySystem || !mobileEntitySystem.isOccupied(entityId))) {
                    if (distanceSquared < nearestTowableEntityDistance) {
                        nearestTowableEntityDistance = distanceSquared;
                        nearestTowableEntity = object;
                    }
                }
            } else if (this.treeTypes.has(modelType) || this.rockTypes.has(modelType) ||
                       modelType === 'log' || modelType.endsWith('_log')) {
                if (distanceSquared < nearestNaturalDistance) {
                    nearestNaturalDistance = distanceSquared;
                    nearestNaturalObject = object;
                }
            }
        });

        // Process larger query for mobile entities (boats/ships have larger proximity ranges)
        // Also process crates from this larger query for cart/boat loading (cart: 2, sailboat: 3, ship2: 4)
        mobileEntityColliders.forEach(colliderHandle => {
            const objectId = this.physicsManager.getObjectIdFromCollider(colliderHandle);
            if (!objectId) return;

            const sceneObject = this.objectRegistry.get(objectId);
            if (!sceneObject || !sceneObject.parent) return;

            const modelType = sceneObject.userData?.modelType;

            // Handle mobile entities (boats/horses)
            if (this.mobileEntityTypes.has(modelType)) {
                // Check if not occupied by someone else
                // Use originalEntityId for peer vehicles (occupancy tracked by original ID, not synthetic peer ID)
                const entityId = sceneObject.userData.originalEntityId || sceneObject.userData.objectId;
                const mobileEntitySystem = this.game.mobileEntitySystem;
                const isOccupied = mobileEntitySystem && mobileEntitySystem.isOccupied(entityId);

                // Ship2: Check for available positions (cannon slots and helm)
                // This handles all cases: empty ship, pilot only, gunner only, pilot+gunner
                let allowGunnerBoarding = false;
                let helmAvailable = false;
                if (modelType === 'ship2') {
                    const myFaction = this.gameState.factionId;
                    const roster = mobileEntitySystem?.getShipCrew(entityId);

                    // Get crew faction for same-faction check
                    let crewFaction = null;
                    if (roster) {
                        const crewMemberId = roster.pilot || roster.portGunner || roster.starboardGunner;
                        if (crewMemberId && this.game.networkManager) {
                            const peerData = this.game.networkManager.peerGameData.get(crewMemberId);
                            crewFaction = peerData?.factionId ?? null;
                        }
                    }

                    // One player per ship - no external crew boarding
                    const canBoard = false;

                    if (canBoard) {
                        // Check for available cannon positions using crew roster as source of truth
                        const availableSlots = { port: null, starboard: null };
                        const loadedSlots = { port: false, starboard: false }; // Track which positions have artillery loaded
                        const portOccupied = roster?.portGunner != null;
                        const starboardOccupied = roster?.starboardGunner != null;

                        sceneObject.traverse(child => {
                            if (child.userData?.modelType === 'artillery') {
                                // Determine slot from position: x < 0 = starboard (slot 0), x > 0 = port (slot 1)
                                const slotIndex = child.position.x < 0 ? 0 : 1;
                                if (slotIndex === 0) {
                                    loadedSlots.starboard = true;
                                    if (!starboardOccupied) {
                                        availableSlots.starboard = child;
                                    }
                                } else {
                                    loadedSlots.port = true;
                                    if (!portOccupied) {
                                        availableSlots.port = child;
                                    }
                                }
                            }
                        });

                        // Store slot info for UI (both availability and loaded status)
                        if (loadedSlots.port || loadedSlots.starboard) {
                            allowGunnerBoarding = availableSlots.port || availableSlots.starboard;
                            sceneObject.userData._availableGunnerSlots = availableSlots;
                            sceneObject.userData._loadedGunnerSlots = loadedSlots;
                            sceneObject.userData._occupiedGunnerSlots = { port: portOccupied, starboard: starboardOccupied };
                            // Legacy: also store first available for backward compatibility
                            sceneObject.userData._availableGunnerArtillery = availableSlots.starboard || availableSlots.port;
                        } else {
                            // Clear slots if no cannons loaded
                            delete sceneObject.userData._availableGunnerSlots;
                            delete sceneObject.userData._loadedGunnerSlots;
                            delete sceneObject.userData._occupiedGunnerSlots;
                            delete sceneObject.userData._availableGunnerArtillery;
                        }

                        // Check if helm is available (no pilot)
                        helmAvailable = !roster?.pilot;
                        sceneObject.userData._helmAvailable = helmAvailable;
                    } else {
                        // Clear all boarding flags when can't board (different faction)
                        delete sceneObject.userData._availableGunnerSlots;
                        delete sceneObject.userData._loadedGunnerSlots;
                        delete sceneObject.userData._occupiedGunnerSlots;
                        delete sceneObject.userData._availableGunnerArtillery;
                        delete sceneObject.userData._helmAvailable;
                        delete sceneObject.userData._isGunnerBoardingAvailable;
                    }
                }

                // Skip if ship is occupied by pilot AND no gunner boarding available
                // (Allow boarding if helm is available even without cannon slots)
                if (isOccupied && !allowGunnerBoarding && !helmAvailable) return;

                const dx = this.game.playerObject.position.x - sceneObject.position.x;
                const dz = this.game.playerObject.position.z - sceneObject.position.z;
                const distanceSquared = dx * dx + dz * dz;

                if (distanceSquared < nearestMobileEntityDistance) {
                    nearestMobileEntityDistance = distanceSquared;
                    nearestMobileEntity = sceneObject;
                    // Mark if this is for gunner boarding
                    sceneObject.userData._isGunnerBoardingAvailable = allowGunnerBoarding;
                }
                // Track land vs water vehicles separately (for larger query range)
                if (landVehicleTypesSet.has(modelType)) {
                    if (distanceSquared < nearestLandVehicleDistance) {
                        nearestLandVehicleDistance = distanceSquared;
                        nearestLandVehicle = sceneObject;
                    }
                    // Track horses for ship2 loading (uses larger mobileEntityColliders range)
                    if (modelType === 'horse' && shouldTrackLoadableHorses) {
                        if (distanceSquared < nearestLoadableHorseDistance) {
                            nearestLoadableHorseDistance = distanceSquared;
                            nearestLoadableHorse = sceneObject;
                        }
                    }
                } else if (waterVehicleTypesSet.has(modelType)) {
                    if (distanceSquared < nearestWaterVehicleDistance) {
                        nearestWaterVehicleDistance = distanceSquared;
                        nearestWaterVehicle = sceneObject;
                        // Carry over gunner boarding flag
                        if (allowGunnerBoarding) {
                            sceneObject.userData._isGunnerBoardingAvailable = allowGunnerBoarding;
                        }
                    }
                }
            }
            // Track warehouses from larger query (warehouse collider may be beyond 0.75 radius)
            else if (modelType === 'warehouse') {
                const dx = this.game.playerObject.position.x - sceneObject.position.x;
                const dz = this.game.playerObject.position.z - sceneObject.position.z;
                const distanceSquared = dx * dx + dz * dz;
                if (distanceSquared < nearestWarehouseDistance) {
                    nearestWarehouseDistance = distanceSquared;
                    nearestWarehouse = sceneObject;
                }
            }
            // Track nearest crate from larger query (gating by vehicle/warehouse happens after loop at gameState update)
            else if (modelType === 'crate') {
                const crateId = sceneObject.userData.objectId;
                const mobileEntitySystem = this.game.mobileEntitySystem;
                // Only track if not occupied by someone else
                if (!mobileEntitySystem || !mobileEntitySystem.isOccupied(crateId)) {
                    const dx = this.game.playerObject.position.x - sceneObject.position.x;
                    const dz = this.game.playerObject.position.z - sceneObject.position.z;
                    const distanceSquared = dx * dx + dz * dz;

                    if (distanceSquared < nearestLoadableDistance) {
                        nearestLoadableDistance = distanceSquared;
                        nearestLoadableCrate = sceneObject;
                    }
                }
            }
            // Handle artillery when piloting ship2 (artillery loading needs larger radius)
            else if (modelType === 'artillery' && shouldTrackLoadableArtillery) {
                const artilleryId = sceneObject.userData.objectId;
                const mobileEntitySystem = this.game.mobileEntitySystem;
                const isManning = this.gameState.vehicleState.mannedArtillery?.mesh === sceneObject;
                // Check if occupied by player's own militia (allow loading in that case)
                const isOccupied = mobileEntitySystem && mobileEntitySystem.isOccupied(artilleryId);
                const militiaEntity = this.game.banditController?.entities?.get(artilleryId);
                const isOwnMilitiaOccupied = isOccupied && militiaEntity?.ownerId === this.gameState.accountId;
                // Allow loading if: not occupied, OR occupied by player's own militia
                if (!isManning && (!isOccupied || isOwnMilitiaOccupied)) {
                    const dx = this.game.playerObject.position.x - sceneObject.position.x;
                    const dz = this.game.playerObject.position.z - sceneObject.position.z;
                    const distanceSquared = dx * dx + dz * dz;

                    if (distanceSquared < nearestLoadableArtilleryDistance) {
                        nearestLoadableArtilleryDistance = distanceSquared;
                        nearestLoadableArtillery = sceneObject;
                    }
                }
            }
        });

        // Update game state - natural objects (trees/rocks/logs)
        if (nearestNaturalObject) {
            const prevNearest = this.gameState.nearestObject?.name;
            this.gameState.nearestObject = {
                id: nearestNaturalObject.userData.objectId,
                name: nearestNaturalObject.userData.modelType,
                position: nearestNaturalObject.position.clone(),
                chunkKey: nearestNaturalObject.userData.chunkKey,
                quality: nearestNaturalObject.userData.quality,
                scale: nearestNaturalObject.userData.originalScale || nearestNaturalObject.scale,
                remainingResources: nearestNaturalObject.userData.remainingResources,
                totalResources: nearestNaturalObject.userData.totalResources,
                isGrowing: nearestNaturalObject.userData.isGrowing,
                growthScale: nearestNaturalObject.userData.scale, // For planted trees, this is 0.25 to 1.0
                toolCheck: this.game.hasRequiredTool(nearestNaturalObject.userData.modelType)
            };
            // Convert squared distance back to actual distance for storage (in case it's needed elsewhere)
            this.gameState.nearestObjectDistance = Math.sqrt(nearestNaturalDistance);
        } else {
            this.gameState.nearestObject = null;
            this.gameState.nearestObjectDistance = Infinity;
        }

        // Update game state - construction sites
        if (nearestConstructionSite) {
            this.gameState.nearestConstructionSite = nearestConstructionSite;
            this.gameState.nearestConstructionSiteDistance = nearestConstructionDistance;
        } else {
            this.gameState.nearestConstructionSite = null;
            this.gameState.nearestConstructionSiteDistance = Infinity;
        }

        // Update game state - structures
        if (nearestStructure) {
            this.gameState.nearestStructure = nearestStructure;
            this.gameState.nearestStructureDistance = nearestStructureDistance;

            // Display durability info for structures (Phase 1: Core Durability System)
            const structureType = nearestStructure.userData.modelType;
            const quality = nearestStructure.userData.quality;
            const currentDurability = nearestStructure.userData.currentDurability;
            const hoursUntilRuin = nearestStructure.userData.hoursUntilRuin;
            const isConstructionSite = nearestStructure.userData.isConstructionSite;

            // Check if this is a structure that decays (not natural objects)
            const decayingStructure = structureType && (
                structureType === 'house' || structureType === 'crate' || structureType === 'tent' ||
                structureType === 'outpost' || structureType === 'ship' || structureType === 'campfire' ||
                structureType === 'market' || structureType === 'dock' ||
                isConstructionSite
            );

            if (decayingStructure && quality !== undefined && currentDurability !== undefined) {
                const structureName = structureType.charAt(0).toUpperCase() + structureType.slice(1);

                // Calculate durability percentage
                const durabilityPercent = quality > 0 ? ((currentDurability / quality) * 100).toFixed(0) : 0;

                // Check ownership for owner-protected structures
                const ownerProtectedStructures = ['house', 'tileworks', 'ironworks', 'blacksmith', 'bakery', 'fisherman'];
                let isOwner = true; // Default to true for non-protected structures
                let ownerDisplay = '';

                if (ownerProtectedStructures.includes(structureType) && nearestStructure.userData.owner) {
                    const owner = nearestStructure.userData.owner;
                    const currentClientId = this.gameState.clientId;
                    const currentAccountId = this.gameState.accountId;

                    // Check if current player owns the structure
                    isOwner = (owner === currentClientId || owner === currentAccountId);

                    // Determine owner display name
                    if (isOwner) {
                        ownerDisplay = 'You';
                    } else if (nearestStructure.userData.ownerName) {
                        // Use the display name from server if available
                        ownerDisplay = nearestStructure.userData.ownerName;
                    } else if (owner.startsWith('session_') || owner.startsWith('client_')) {
                        ownerDisplay = 'Stranger';
                    } else {
                        // Fallback to account ID prefix if no name available
                        ownerDisplay = owner.substring(0, 8) + '...';
                    }
                }

                // Display structure panel with durability info
                const isRuin = nearestStructure.userData?.isRuin;
                if (isRuin) {
                    // Ruins only show "Demolish Ruin" button, no structure panel
                } else if (isConstructionSite) {
                    // Construction sites have 1-hour lifespan
                    const minutesLeft = hoursUntilRuin !== undefined ? (hoursUntilRuin * 60).toFixed(0) : 0;
                    ui.showStructurePanel(
                        `${nearestStructure.userData.targetStructure} (Construction)`,
                        `Time until removal: ${minutesLeft} minutes`
                    );
                } else if (ownerProtectedStructures.includes(structureType) && nearestStructure.userData.owner) {
                    // Owner-protected structures show ownership info
                    const hoursLeft = hoursUntilRuin !== undefined ? hoursUntilRuin.toFixed(1) : 0;

                    if (isOwner) {
                        ui.showStructurePanel(
                            `${structureName} | Quality: ${quality}`,
                            `Durability: ${currentDurability.toFixed(1)}/${quality} (${durabilityPercent}%) | ${hoursLeft}h`,
                            `Owner: ${ownerDisplay}`
                        );
                    } else {
                        ui.showStructurePanel(
                            `${structureName} (Locked)`,
                            `Owner: ${ownerDisplay}`,
                            `Not your ${structureType}`
                        );
                    }
                } else {
                    // Regular structures show durability and time until ruin in hours
                    const hoursLeft = hoursUntilRuin !== undefined ? hoursUntilRuin.toFixed(1) : 0;
                    ui.showStructurePanel(
                        `${structureName} | Quality: ${quality}`,
                        `Durability: ${currentDurability.toFixed(1)}/${quality} (${durabilityPercent}%) | ${hoursLeft}h`
                    );
                }
            }
        } else {
            this.gameState.nearestStructure = null;
            this.gameState.nearestStructureDistance = Infinity;

            // Hide structure panel when no structure nearby
            ui.hideStructurePanel();
        }

        // Update game state - mobile entities (boats, horses)
        const mobileState = this.gameState.vehicleState;
        const isPilotingWaterVehicle = mobileState?.isActive() &&
                                        mobileState?.isPiloting() &&
                                        ['boat', 'sailboat', 'ship2'].includes(mobileState?.pilotingEntityType);
        const isTowingEntity = mobileState?.towedEntity?.isAttached;

        if (!mobileState?.isActive() && !isTowingEntity) {
            // Not piloting and not towing - track nearest mobile entity for boarding
            // Track overall nearest (backward compatibility)
            if (nearestMobileEntity) {
                const mobileEntitySystem = this.game.mobileEntitySystem;
                const proximityRange = mobileEntitySystem?.getConfig(nearestMobileEntity.userData.modelType)?.proximityRange || 2;
                const actualDistance = Math.sqrt(nearestMobileEntityDistance);

                if (actualDistance <= proximityRange) {
                    this.gameState.nearestMobileEntity = {
                        type: nearestMobileEntity.userData.modelType,
                        object: nearestMobileEntity
                    };
                } else {
                    this.gameState.nearestMobileEntity = null;
                }
            } else {
                this.gameState.nearestMobileEntity = null;
            }

            // Track land vehicle (horse) separately
            if (nearestLandVehicle) {
                const mobileEntitySystem = this.game.mobileEntitySystem;
                const proximityRange = mobileEntitySystem?.getConfig(nearestLandVehicle.userData.modelType)?.proximityRange || 2;
                const actualDistance = Math.sqrt(nearestLandVehicleDistance);

                if (actualDistance <= proximityRange) {
                    this.gameState.nearestLandVehicle = {
                        type: nearestLandVehicle.userData.modelType,
                        object: nearestLandVehicle
                    };
                } else {
                    this.gameState.nearestLandVehicle = null;
                }
            } else {
                this.gameState.nearestLandVehicle = null;
            }

            // Show stats panel for nearby horse (when not mounted and no structure panel showing)
            if (this.gameState.nearestLandVehicle?.type === 'horse' && !this.gameState.nearestStructure) {
                const horseObj = this.gameState.nearestLandVehicle.object;
                const horseData = horseObj.userData;
                const quality = horseData.quality || 50;
                const messageRouter = this.game.messageRouter;

                if (messageRouter && horseData.lastRepairTime) {
                    const currentHealth = messageRouter.calculateStructureDurability(horseData);
                    const hoursLeft = messageRouter.getHoursUntilRuin(horseData);
                    const healthPercent = quality > 0 ? ((currentHealth / quality) * 100).toFixed(0) : 0;
                    const hoursDisplay = hoursLeft.toFixed(1);

                    ui.showStructurePanel(
                        `Horse | Quality: ${quality}`,
                        `Health: ${currentHealth.toFixed(1)}/${quality} (${healthPercent}%) | ${hoursDisplay}h until death`
                    );
                } else {
                    ui.showStructurePanel(`Horse | Quality: ${quality}`, '');
                }
            }

            // Track water vehicle (boat/sailboat/ship2) separately
            if (nearestWaterVehicle) {
                const mobileEntitySystem = this.game.mobileEntitySystem;
                const proximityRange = mobileEntitySystem?.getConfig(nearestWaterVehicle.userData.modelType)?.proximityRange || 3;
                const actualDistance = Math.sqrt(nearestWaterVehicleDistance);

                if (actualDistance <= proximityRange) {
                    this.gameState.nearestWaterVehicle = {
                        type: nearestWaterVehicle.userData.modelType,
                        object: nearestWaterVehicle
                    };
                } else {
                    this.gameState.nearestWaterVehicle = null;
                }
            } else {
                this.gameState.nearestWaterVehicle = null;
            }

            this.gameState.nearestSwitchableMobileEntity = null;
        } else if (isPilotingWaterVehicle) {
            // Piloting a water vehicle - track nearby boats for switching
            // nearestMobileEntity from the loop excludes occupied entities (including our current boat)
            const waterVehicleTypes = ['boat', 'sailboat', 'ship2'];
            if (nearestMobileEntity && waterVehicleTypes.includes(nearestMobileEntity.userData.modelType)) {
                const mobileEntitySystem = this.game.mobileEntitySystem;
                const proximityRange = mobileEntitySystem?.getConfig(nearestMobileEntity.userData.modelType)?.proximityRange || 3;
                const actualDistance = Math.sqrt(nearestMobileEntityDistance);

                if (actualDistance <= proximityRange) {
                    // Skip if this is the player's own ship (detected via peer mesh)
                    const pilotingId = this.gameState.vehicleState?.pilotingEntityId;
                    const detectedId = nearestMobileEntity.userData.objectId;
                    const detectedOriginalId = nearestMobileEntity.userData.originalEntityId;
                    if (detectedId === pilotingId || detectedOriginalId === pilotingId) {
                        // This is our own ship - don't treat it as switchable
                        this.gameState.nearestSwitchableMobileEntity = null;
                    } else {
                        this.gameState.nearestSwitchableMobileEntity = {
                            type: nearestMobileEntity.userData.modelType,
                            object: nearestMobileEntity
                        };
                    }
                } else {
                    this.gameState.nearestSwitchableMobileEntity = null;
                }
            } else {
                this.gameState.nearestSwitchableMobileEntity = null;
            }
            // Clear land/water vehicle states when piloting
            this.gameState.nearestLandVehicle = null;
            this.gameState.nearestWaterVehicle = null;
        } else if (isTowingEntity && !mobileState?.isActive()) {
            // Towing on foot - can't board any vehicle
            this.gameState.nearestMobileEntity = null;
            this.gameState.nearestLandVehicle = null;
            this.gameState.nearestWaterVehicle = null;
            this.gameState.nearestSwitchableMobileEntity = null;
        } else {
            // Piloting something else (horse) - clear switchable state
            this.gameState.nearestSwitchableMobileEntity = null;
            // Clear land/water vehicle states when piloting
            this.gameState.nearestLandVehicle = null;
            this.gameState.nearestWaterVehicle = null;
        }

        // Update game state - towable entities (carts and artillery)
        // Only update if not currently towing anything
        const isTowing = this.gameState.vehicleState.towedEntity?.isAttached;
        if (!isTowing) {
            if (nearestTowableEntity) {
                const entityType = nearestTowableEntity.userData.modelType;
                const actualDistance = Math.sqrt(nearestTowableEntityDistance);
                const proximityRange = 2.0; // Attach range

                // Artillery can only be towed by horse (check if player is mounted)
                const isMounted = this.gameState.vehicleState?.isActive() &&
                                  this.gameState.vehicleState?.isPiloting() &&
                                  this.gameState.vehicleState?.pilotingEntityType === 'horse';

                // Filter: artillery requires horse, cart can be towed on foot or mounted
                const canTow = entityType === 'cart' || (entityType === 'artillery' && isMounted);

                if (actualDistance <= proximityRange && canTow) {
                    this.gameState.nearestTowableEntity = {
                        type: entityType,
                        object: nearestTowableEntity,
                        distance: actualDistance
                    };
                } else {
                    this.gameState.nearestTowableEntity = null;
                }
            } else {
                this.gameState.nearestTowableEntity = null;
            }
        }

        // Update game state - loadable crates (already tracked in main loop above)
        if (nearestLoadableCrate && (shouldTrackLoadableCrates || nearestWarehouse)) {
            const actualDistance = Math.sqrt(nearestLoadableDistance);
            // Match crate load range to vehicle type: cart: 2, sailboat: 3, ship2: 4; on foot near warehouse: 3
            const proximityRange = isTowingCart ? 2 : (entityType === 'ship2' ? 4 : 3);

            if (actualDistance <= proximityRange) {
                this.gameState.nearestLoadableCrate = {
                    object: nearestLoadableCrate,
                    distance: actualDistance
                };
            } else {
                this.gameState.nearestLoadableCrate = null;
            }
        } else {
            this.gameState.nearestLoadableCrate = null;
        }

        // Update game state - loadable artillery for ship2 (already tracked in main loop above)
        if (shouldTrackLoadableArtillery && nearestLoadableArtillery) {
            const actualDistance = Math.sqrt(nearestLoadableArtilleryDistance);
            const proximityRange = 4;  // Match ship2 boarding range

            if (actualDistance <= proximityRange) {
                this.gameState.nearestLoadableArtillery = {
                    object: nearestLoadableArtillery,
                    distance: actualDistance
                };
            } else {
                this.gameState.nearestLoadableArtillery = null;
            }
        } else {
            this.gameState.nearestLoadableArtillery = null;
        }

        // Update game state - loadable horses for ship2
        if (shouldTrackLoadableHorses && nearestLoadableHorse) {
            const actualDistance = Math.sqrt(nearestLoadableHorseDistance);
            const proximityRange = CONFIG.HORSE_VEHICLES?.PROXIMITY_RANGE || 4;

            if (actualDistance <= proximityRange) {
                this.gameState.nearestLoadableHorse = {
                    object: nearestLoadableHorse,
                    distance: actualDistance
                };
            } else {
                this.gameState.nearestLoadableHorse = null;
            }
        } else {
            this.gameState.nearestLoadableHorse = null;
        }

        // Update game state - nearest warehouse for crate storage
        if (nearestWarehouse) {
            const actualDistance = Math.sqrt(nearestWarehouseDistance);
            const proximityRange = 3.0;  // Interaction range for warehouse

            if (actualDistance <= proximityRange) {
                this.gameState.nearestWarehouse = {
                    object: nearestWarehouse,
                    distance: actualDistance
                };
            } else {
                this.gameState.nearestWarehouse = null;
            }
        } else {
            this.gameState.nearestWarehouse = null;
        }

        // Update game state - mannable artillery (player stands behind to fire)
        if (shouldTrackMannableArtillery && nearestMannableArtillery) {
            const actualDistance = Math.sqrt(nearestMannableArtilleryDistance);
            const proximityRange = 2.0;  // Same as towable attach range

            if (actualDistance <= proximityRange) {
                const entityId = nearestMannableArtillery.userData.objectId;
                const mobileEntitySystem = this.game.mobileEntitySystem;
                const isOccupied = mobileEntitySystem && mobileEntitySystem.isOccupied(entityId);

                this.gameState.nearestMannableArtillery = {
                    object: nearestMannableArtillery,
                    distance: actualDistance,
                    occupied: isOccupied
                };
            } else {
                this.gameState.nearestMannableArtillery = null;
            }
        } else {
            this.gameState.nearestMannableArtillery = null;
        }

        // Special case: Apple trees are BOTH trees (for chopping) AND structures (for inventory)
        if (nearestNaturalObject && nearestNaturalObject.userData.modelType === 'apple') {
            // If apple tree is closer than current nearestStructure (or no structure found), set it as nearestStructure too
            if (!nearestStructure || nearestNaturalDistance < nearestStructureDistance) {
                this.gameState.nearestStructure = nearestNaturalObject;
                this.gameState.nearestStructureDistance = nearestNaturalDistance;
            }
        }

        // FISHING: Detect if player is on shore (land adjacent to water)
        const playerHeight = this.terrainGenerator.getWorldHeight(
            this.game.playerObject.position.x,
            this.game.playerObject.position.z
        );

        this.gameState.nearWater = false;

        // Only check for nearby water if player is on land
        if (playerHeight >= CONFIG.WATER.LEVEL) {
            // Sample 8 points in circle around player to find water
            const checkRadius = 0.75; // Same as other interaction radius
            const numSamples = 8;

            for (let i = 0; i < numSamples; i++) {
                const angle = (i / numSamples) * Math.PI * 2;
                const checkX = this.game.playerObject.position.x + Math.cos(angle) * checkRadius;
                const checkZ = this.game.playerObject.position.z + Math.sin(angle) * checkRadius;

                const checkHeight = this.terrainGenerator.getWorldHeight(checkX, checkZ);

                // Found water nearby!
                if (checkHeight < CONFIG.WATER.LEVEL) {
                    this.gameState.nearWater = true;
                    this.gameState.waterDirection = angle; // Store for optional facing
                    break;
                }
            }
        }

        // Track when player stops moving (used by multiple gathering systems)
        // Initialize wasMoving if not set
        if (this.gameState.wasMoving === undefined) {
            this.gameState.wasMoving = this.gameState.isMoving;
        }
        const justStopped = this.gameState.wasMoving && !this.gameState.isMoving;

        // GRASS GATHERING: Detect if player is standing on grass terrain
        if (this.grassGathering) {
            const grassDetection = this.grassGathering.detectGrassUnderPlayer(
                this.game.playerObject.position.x,
                this.game.playerObject.position.z,
                this.game.playerObject.position.y
            );
            this.gameState.onGrass = grassDetection.onGrass;
            this.gameState.grassQualityRange = grassDetection.qualityRange;

            // Calculate quality ranges for all grass-gathered items when on grass
            if (this.gameState.onGrass && grassDetection.chunkId) {
                const [, coords] = grassDetection.chunkId.split('_');
                const [chunkX, chunkZ] = coords.split(',').map(Number);
                const worldSeed = TERRAIN_CONFIG.SEED || 12345;

                this.gameState.mushroomQualityRange = QualityGenerator.getQualityRange(worldSeed, chunkX, chunkZ, 'mushroom');
                this.gameState.vegetableSeedsQualityRange = QualityGenerator.getQualityRange(worldSeed, chunkX, chunkZ, 'vegetableseeds');
                this.gameState.hempSeedsQualityRange = QualityGenerator.getQualityRange(worldSeed, chunkX, chunkZ, 'hempseeds');
            } else {
                this.gameState.mushroomQualityRange = null;
                this.gameState.vegetableSeedsQualityRange = null;
                this.gameState.hempSeedsQualityRange = null;
            }

            // If player just stopped on grass, roll for mushroom (10% chance)
            if (justStopped && this.gameState.onGrass) {
                this.gameState.mushroomAvailable = this.grassGathering.rollForMushroom();
            }

            // If player just stopped on grass, roll for vegetable seeds (2.5% chance, independent from mushroom)
            if (justStopped && this.gameState.onGrass) {
                this.gameState.vegetableSeedsAvailable = this.grassGathering.rollForVegetableSeeds();
            }

            // If player just stopped on grass, roll for hemp seeds (2.5% chance, independent from others)
            if (justStopped && this.gameState.onGrass) {
                this.gameState.hempSeedsAvailable = this.grassGathering.rollForHempSeeds();
            }

            // If player just stopped on grass, roll for limestone (10% chance, independent from mushroom/vegetable seeds)
            if (justStopped && this.gameState.onGrass) {
                this.gameState.limestoneAvailable = this.grassGathering.rollForLimestone();
            }

            // TREE SEED GATHERING: If player just stopped near a tree, roll for tree seeds (40% chance)
            const seedableTreeTypes = ['oak', 'fir', 'pine', 'cypress', 'apple'];
            if (justStopped && this.gameState.nearestObject &&
                seedableTreeTypes.includes(this.gameState.nearestObject.name)) {
                if (Math.random() < 0.40) { // 40% chance
                    this.gameState.seedsAvailable = true;
                    this.gameState.seedTreeType = this.gameState.nearestObject.name;
                }
            }
        }

        // VEGETABLES GATHERING: Show gather button when player stops near FULLY GROWN vegetables
        const isNearVegetables = this.gameState.nearestObject && this.gameState.nearestObject.name === 'vegetables';
        const isVegetableFullyGrown = isNearVegetables && !this.gameState.nearestObject.isGrowing;
        const isStoppedNearVegetables = !this.gameState.isMoving && isVegetableFullyGrown && !this.gameState.activeAction;

        // Enable gathering when player is stopped near fully grown vegetables
        // Check both: just stopped OR already stopped and vegetables just came into range
        if (isStoppedNearVegetables && !this.gameState.vegetablesGatherAvailable) {
            this.gameState.vegetablesGatherAvailable = true;
            // Also roll for seed gathering for vegetables (40% chance) - only once per detection
            if (Math.random() < 0.40) {
                this.gameState.seedsAvailable = true;
                this.gameState.seedTreeType = 'vegetables';
            }
        }

        // HEMP GATHERING: Show gather button when player stops near FULLY GROWN hemp
        const isNearHemp = this.gameState.nearestObject && this.gameState.nearestObject.name === 'hemp';
        const isHempFullyGrown = isNearHemp && !this.gameState.nearestObject.isGrowing;
        const isStoppedNearHemp = !this.gameState.isMoving && isHempFullyGrown && !this.gameState.activeAction;

        if (isStoppedNearHemp && !this.gameState.hempGatherAvailable) {
            this.gameState.hempGatherAvailable = true;
            // Roll for seed gathering for hemp (40% chance)
            if (Math.random() < 0.40) {
                this.gameState.seedsAvailable = true;
                this.gameState.seedTreeType = 'hemp';
            }
        }

        // If player starts moving, disable all gathering options
        if (this.gameState.isMoving) {
            this.gameState.mushroomAvailable = false;
            this.gameState.vegetableSeedsAvailable = false;
            this.gameState.hempSeedsAvailable = false;
            this.gameState.limestoneAvailable = false;
            this.gameState.seedsAvailable = false;
            this.gameState.seedTreeType = null;
            this.gameState.vegetablesGatherAvailable = false;
            this.gameState.hempGatherAvailable = false;
        }

        // If player moves away from vegetables (or plant was gathered), disable vegetable gathering + seeds
        if (!isNearVegetables) {
            this.gameState.vegetablesGatherAvailable = false;
            if (this.gameState.seedTreeType === 'vegetables') {
                this.gameState.seedsAvailable = false;
                this.gameState.seedTreeType = null;
            }
        }

        // If player moves away from hemp (or plant was gathered), disable hemp gathering + seeds
        if (!isNearHemp) {
            this.gameState.hempGatherAvailable = false;
            if (this.gameState.seedTreeType === 'hemp') {
                this.gameState.seedsAvailable = false;
                this.gameState.seedTreeType = null;
            }
        }

        // Update previous movement state for next frame (must be at end)
        this.gameState.wasMoving = this.gameState.isMoving;

        // MERCHANT INTERACTION: Check if player is near a dock merchant
        if (this.dockMerchantSystem) {
            this.gameState.nearMerchant = this.dockMerchantSystem.getMerchantNearPosition(this.game.playerObject.position);
        }

        // Update merchant button visibility
        ui.updateMerchantButton(this.gameState.nearMerchant, this.gameState.isMoving);

        // TRAPPER INTERACTION: Check if player is near a trapper NPC
        if (this.game.trapperSystem) {
            this.gameState.nearTrapper = this.game.trapperSystem.getTrapperNearPosition(this.game.playerObject.position);
        }

        // Update trapper button visibility
        ui.updateTrapperButton(this.gameState.nearTrapper, this.gameState.isMoving);

        // BAKER INTERACTION: Check if player is near a baker NPC
        if (this.game.bakerController) {
            const playerPos = this.game.playerObject.position;
            this.gameState.nearBaker = this._findNearbyBaker(playerPos);
        }

        // Update baker button visibility
        ui.updateBakerButton(this.gameState.nearBaker, this.gameState.isMoving);

        // GARDENER INTERACTION: Check if player is near a gardener NPC
        if (this.game.gardenerController) {
            const playerPos = this.game.playerObject.position;
            this.gameState.nearGardener = this._findNearbyGardener(playerPos);
        }

        // Update gardener button visibility
        ui.updateGardenerButton(this.gameState.nearGardener, this.gameState.isMoving);

        // WOODCUTTER INTERACTION: Check if player is near a woodcutter NPC
        if (this.game.woodcutterController) {
            const playerPos = this.game.playerObject.position;
            this.gameState.nearWoodcutter = this._findNearbyWoodcutter(playerPos);
        }

        // Update woodcutter button visibility
        ui.updateWoodcutterButton(this.gameState.nearWoodcutter, this.gameState.isMoving);

        // MINER INTERACTION: Check if player is near a miner NPC
        if (this.game.minerController) {
            const playerPos = this.game.playerObject.position;
            this.gameState.nearMiner = this._findNearbyMiner(playerPos);
        }

        // Update miner button visibility
        ui.updateMinerButton(this.gameState.nearMiner, this.gameState.isMoving);

        // FISHERMAN INTERACTION: Check if player is near a fisherman NPC
        if (this.game.fishermanController) {
            const playerPos = this.game.playerObject.position;
            this.gameState.nearFisherman = this._findNearbyFisherman(playerPos);
        }

        // Update fisherman button visibility
        ui.updateFishermanButton(this.gameState.nearFisherman, this.gameState.isMoving);

        // BLACKSMITH INTERACTION: Check if player is near a blacksmith NPC
        if (this.game.blacksmithController) {
            const playerPos = this.game.playerObject.position;
            this.gameState.nearBlacksmith = this._findNearbyBlacksmith(playerPos);
        }

        // Update blacksmith button visibility
        ui.updateBlacksmithButton(this.gameState.nearBlacksmith, this.gameState.isMoving);

        // IRON WORKER INTERACTION: Check if player is near an iron worker NPC
        if (this.game.ironWorkerController) {
            const playerPos = this.game.playerObject.position;
            this.gameState.nearIronWorker = this._findNearbyIronWorker(playerPos);
        }

        // Update iron worker button visibility
        ui.updateIronWorkerButton(this.gameState.nearIronWorker, this.gameState.isMoving);

        // TILE WORKER INTERACTION: Check if player is near a tile worker NPC
        if (this.game.tileWorkerController) {
            const playerPos = this.game.playerObject.position;
            this.gameState.nearTileWorker = this._findNearbyTileWorker(playerPos);
        }

        // Update tile worker button visibility
        ui.updateTileWorkerButton(this.gameState.nearTileWorker, this.gameState.isMoving);

        // STONE MASON INTERACTION: Check if player is near a stone mason NPC
        if (this.game.stoneMasonController) {
            const playerPos = this.game.playerObject.position;
            this.gameState.nearStoneMason = this._findNearbyStoneMason(playerPos);
        }

        // Update stone mason button visibility
        ui.updateStoneMasonButton(this.gameState.nearStoneMason, this.gameState.isMoving);

        // Update UI
        const hasAxe = this.game.hasToolWithDurability('axe');
        const hasSaw = this.game.hasToolWithDurability('saw');
        const hasHammer = this.game.hasToolWithDurability('hammer');
        const hasFishingNet = this.game.hasToolWithDurability('fishingnet');
        const isOnCooldown = this.gameState.harvestCooldown && this.gameState.harvestCooldown.endTime > Date.now();

        ui.updateNearestObject(
            this.gameState.nearestObject ? this.gameState.nearestObject.name : null,
            this.gameState.nearestObject ? this.gameState.nearestObject.toolCheck : null,
            this.gameState.nearestObject ? this.gameState.nearestObject.quality : null,
            this.gameState.nearestObject ? this.gameState.nearestObject.remainingResources : null,
            this.gameState.nearestObject ? this.gameState.nearestObject.totalResources : null,
            this.gameState.nearestObject ? this.gameState.nearestObject.isGrowing : false,
            this.gameState.nearestObject ? this.gameState.nearestObject.growthScale : null
        );
        // Get mobile entity state for button display
        const mobileEntitySystem = this.game.mobileEntitySystem;
        const canDisembark = mobileEntitySystem?.canDisembark || false;

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
            this.gameState.onGrass,  // Grass gathering detection
            this.gameState.mushroomAvailable,  // Mushroom gathering availability
            this.gameState.vegetableSeedsAvailable,  // Vegetable seeds gathering availability
            this.gameState.limestoneAvailable,  // Limestone gathering availability
            this.gameState.seedsAvailable,  // Seed gathering availability
            this.gameState.seedTreeType,  // Tree type for seed gathering
            this.gameState.climbingState.isClimbing,  // Climbing state
            this.game.occupiedOutposts,  // Occupied outposts map
            this.gameState.vegetablesGatherAvailable,  // Vegetables gathering availability
            this.gameState.hempSeedsAvailable,  // Hemp seeds gathering availability
            this.gameState.hempGatherAvailable,  // Hemp gathering availability
            this.gameState.activeAction,  // Active action (fishing, harvesting, etc.)
            this.gameState.nearestMobileEntity,  // Nearest mobile entity (boat/horse)
            this.gameState.vehicleState,  // Unified vehicle state (replaces mobileEntityState)
            canDisembark,  // Whether player can disembark from current mobile entity
            this.gameState.nearestDeerCorpse,  // Nearest dead deer corpse for harvesting
            this.gameState.nearestBrownbearCorpse,  // Nearest dead brownbear corpse for harvesting
            this.gameState.nearestTowableEntity,  // Nearest towable entity (cart or artillery)
            this.gameState.vehicleState.towedEntity,  // Towed entity (accessed via vehicleState)
            this.gameState.nearestLoadableCrate,  // Nearest loadable crate (cart must be attached)
            this.gameState.vehicleState,  // Ship crate state (accessed via vehicleState)
            this.gameState.vehicleState.cartCargo,  // Cargo on cart (accessed via vehicleState)
            this.gameState.nearestMannableArtillery,  // Nearest mannable artillery (player can man to fire)
            this.gameState.vehicleState.mannedArtillery,  // Artillery manning state (accessed via vehicleState)
            {  // Grass gathering quality info
                vines: this.gameState.grassQualityRange,
                mushroom: this.gameState.mushroomQualityRange,
                vegetableseeds: this.gameState.vegetableSeedsQualityRange,
                hempseeds: this.gameState.hempSeedsQualityRange
            },
            mobileEntitySystem,  // For boat velocity check in crate loading
            this.gameState.nearestLoadableArtillery,  // Nearest loadable artillery for ship2
            this.gameState.vehicleState,  // Ship artillery state (accessed via vehicleState)
            this.gameState.nearestSwitchableMobileEntity,  // Nearby boat for switching while piloting
            this.gameState.nearestLoadableHorse,  // Nearest loadable horse for ship2
            this.gameState.vehicleState  // Ship horse state (accessed via vehicleState)
        );

        // PROPRIETOR BUTTON: Update visibility for selling worker structures
        ui.updateProprietorButton(this.gameState.nearestStructure, this.gameState.isMoving);

        // MILITIA BUTTON: Update visibility for spawning militia at owned tents
        ui.updateMilitiaButton(this.gameState.nearestStructure, this.gameState.isMoving);

        // WAREHOUSE BUTTONS: Update visibility for crate storage
        ui.updateWarehouseButtons(
            this.gameState.nearestWarehouse,
            this.gameState.nearestLoadableCrate,
            this.gameState.isMoving,
            this.gameState.accountId,
            this.gameState.clientId
        );
    }

    /**
     * Find nearby baker NPC
     * @param {THREE.Vector3} playerPos - Player position
     * @returns {object|null} Baker data or null
     */
    _findNearbyBaker(playerPos) {
        const bakerController = this.game.bakerController;
        if (!bakerController) return null;

        const interactionRadiusSq = 4.0; // 2.0^2

        for (const [bakeryId, entity] of bakerController.bakers) {
            if (!entity.mesh) continue;

            const dx = entity.position.x - playerPos.x;
            const dz = entity.position.z - playerPos.z;
            const distSq = dx * dx + dz * dz;

            if (distSq <= interactionRadiusSq) {
                return bakerController.getBakerDialogueData(bakeryId);
            }
        }

        return null;
    }

    /**
     * Find nearby gardener NPC
     * @param {THREE.Vector3} playerPos - Player position
     * @returns {object|null} Gardener data or null
     */
    _findNearbyGardener(playerPos) {
        const gardenerController = this.game.gardenerController;
        if (!gardenerController) return null;

        const interactionRadiusSq = 4.0; // 2.0^2

        for (const [buildingId, entity] of gardenerController.gardeners) {
            if (!entity.mesh) continue;

            const dx = entity.position.x - playerPos.x;
            const dz = entity.position.z - playerPos.z;
            const distSq = dx * dx + dz * dz;

            if (distSq <= interactionRadiusSq) {
                return gardenerController.getGardenerDialogueData(buildingId);
            }
        }

        return null;
    }

    /**
     * Find nearby woodcutter NPC
     * @param {THREE.Vector3} playerPos - Player position
     * @returns {object|null} Woodcutter data or null
     */
    _findNearbyWoodcutter(playerPos) {
        const woodcutterController = this.game.woodcutterController;
        if (!woodcutterController) return null;

        const interactionRadiusSq = 4.0; // 2.0^2

        for (const [buildingId, entity] of woodcutterController.woodcutters) {
            if (!entity.mesh) continue;

            const dx = entity.position.x - playerPos.x;
            const dz = entity.position.z - playerPos.z;
            const distSq = dx * dx + dz * dz;

            if (distSq <= interactionRadiusSq) {
                return woodcutterController.getWoodcutterDialogueData(buildingId);
            }
        }

        return null;
    }

    /**
     * Find nearby miner NPC
     * @param {THREE.Vector3} playerPos - Player position
     * @returns {object|null} Miner data or null
     */
    _findNearbyMiner(playerPos) {
        const minerController = this.game.minerController;
        if (!minerController) return null;

        const interactionRadiusSq = 4.0; // 2.0^2

        for (const [buildingId, entity] of minerController.miners) {
            if (!entity.mesh) continue;

            const dx = entity.position.x - playerPos.x;
            const dz = entity.position.z - playerPos.z;
            const distSq = dx * dx + dz * dz;

            if (distSq <= interactionRadiusSq) {
                return minerController.getMinerDialogueData(buildingId);
            }
        }

        return null;
    }

    /**
     * Find nearby fisherman NPC
     * @param {THREE.Vector3} playerPos - Player position
     * @returns {object|null} Fisherman data or null
     */
    _findNearbyFisherman(playerPos) {
        const fishermanController = this.game.fishermanController;
        if (!fishermanController) return null;

        const interactionRadiusSq = 4.0; // 2.0^2

        for (const [buildingId, entity] of fishermanController.fishermen) {
            if (!entity.mesh) continue;

            const dx = entity.position.x - playerPos.x;
            const dz = entity.position.z - playerPos.z;
            const distSq = dx * dx + dz * dz;

            if (distSq <= interactionRadiusSq) {
                return fishermanController.getFishermanDialogueData(buildingId);
            }
        }

        return null;
    }

    /**
     * Find nearby blacksmith NPC
     * @param {THREE.Vector3} playerPos - Player position
     * @returns {object|null} Blacksmith data or null
     */
    _findNearbyBlacksmith(playerPos) {
        const blacksmithController = this.game.blacksmithController;
        if (!blacksmithController) return null;

        const interactionRadiusSq = 4.0; // 2.0^2

        for (const [buildingId, entity] of blacksmithController.blacksmiths) {
            if (!entity.mesh) continue;

            const dx = entity.position.x - playerPos.x;
            const dz = entity.position.z - playerPos.z;
            const distSq = dx * dx + dz * dz;

            if (distSq <= interactionRadiusSq) {
                return blacksmithController.getBlacksmithDialogueData(buildingId);
            }
        }

        return null;
    }

    /**
     * Find nearby iron worker NPC
     * @param {THREE.Vector3} playerPos - Player position
     * @returns {object|null} Iron worker data or null
     */
    _findNearbyIronWorker(playerPos) {
        const ironWorkerController = this.game.ironWorkerController;
        if (!ironWorkerController) return null;

        const interactionRadiusSq = 4.0; // 2.0^2

        for (const [buildingId, entity] of ironWorkerController.ironworkers) {
            if (!entity.mesh) continue;

            const dx = entity.position.x - playerPos.x;
            const dz = entity.position.z - playerPos.z;
            const distSq = dx * dx + dz * dz;

            if (distSq <= interactionRadiusSq) {
                return ironWorkerController.getIronWorkerDialogueData(buildingId);
            }
        }

        return null;
    }

    /**
     * Find nearby tile worker NPC
     * @param {THREE.Vector3} playerPos - Player position
     * @returns {object|null} Tile worker data or null
     */
    _findNearbyTileWorker(playerPos) {
        const tileWorkerController = this.game.tileWorkerController;
        if (!tileWorkerController) return null;

        const interactionRadiusSq = 4.0; // 2.0^2

        for (const [buildingId, entity] of tileWorkerController.tileworkers) {
            if (!entity.mesh) continue;

            const dx = entity.position.x - playerPos.x;
            const dz = entity.position.z - playerPos.z;
            const distSq = dx * dx + dz * dz;

            if (distSq <= interactionRadiusSq) {
                return tileWorkerController.getTileWorkerDialogueData(buildingId);
            }
        }

        return null;
    }

    /**
     * Find nearby stone mason NPC
     * @param {THREE.Vector3} playerPos - Player position
     * @returns {object|null} Stone mason data or null
     */
    _findNearbyStoneMason(playerPos) {
        const stoneMasonController = this.game.stoneMasonController;
        if (!stoneMasonController) return null;

        const interactionRadiusSq = 4.0; // 2.0^2

        for (const [buildingId, entity] of stoneMasonController.stonemasons) {
            if (!entity.mesh) continue;

            const dx = entity.position.x - playerPos.x;
            const dz = entity.position.z - playerPos.z;
            const distSq = dx * dx + dz * dz;

            if (distSq <= interactionRadiusSq) {
                return stoneMasonController.getStoneMasonDialogueData(buildingId);
            }
        }

        return null;
    }
}

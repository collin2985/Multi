
import { ui } from '../ui.js';
import { CONFIG } from '../config.js';
import { COLLISION_GROUPS } from '../core/PhysicsManager.js';
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
        // Populated lazily on first proximity check to avoid scene.traverse()
        this.objectRegistry = new Map();
        this.registryRefreshCounter = 0; // Counter for periodic registry refresh

        // Store reference in game for backward compatibility/access
        this.game.objectRegistry = this.objectRegistry;
        this.game.activeProximityObjects = this.activeProximityObjects;
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
        if (this.objectRegistry.size === 0 && this.chunkManager && this.chunkManager.chunkObjects.size > 0) {
            this.populateObjectRegistry();
        }

        // Periodically refresh registry to catch newly added objects (every 300 frames = ~5 seconds)
        // Reduced frequency for performance - new objects detected quickly via chunk events anyway
        this.registryRefreshCounter++;
        if (this.registryRefreshCounter >= 300) {
            this.registryRefreshCounter = 0;
            const previousSize = this.objectRegistry.size;
            this.populateObjectRegistry();
            const newObjects = this.objectRegistry.size - previousSize;
            if (newObjects > 0) {
                console.log(`[ObjectRegistry] Refreshed - added ${newObjects} new objects`);
            }
        }

        // Use spatial query to find all bounding boxes within interaction radius
        const interactionRadius = 0.75; // Tight interaction range - player must be very close
        const collisionMask = COLLISION_GROUPS.NATURAL | COLLISION_GROUPS.PLACED | COLLISION_GROUPS.STRUCTURE;

        const nearbyColliders = this.physicsManager.querySphere(
            this.game.playerObject.position,
            interactionRadius,
            collisionMask
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
        const treeTypes = ['oak', 'oak2', 'pine', 'pine2', 'fir', 'cypress', 'apple'];
        const rockTypes = ['limestone', 'sandstone', 'clay', 'iron', 'vegetables'];
        const structureTypes = ['crate', 'tent', 'house', 'garden', 'market', 'outpost', 'ship', 'dock', 'campfire', 'tileworks'];
        const mobileEntityTypes = ['boat', 'horse'];  // Types that can be piloted/ridden
        const towableEntityTypes = ['cart'];  // Types that can be towed behind player

        let nearestNaturalObject = null;
        let nearestNaturalDistance = Infinity;
        let nearestConstructionSite = null;
        let nearestConstructionDistance = Infinity;
        let nearestStructure = null;
        let nearestStructureDistance = Infinity;
        let nearestMobileEntity = null;
        let nearestMobileEntityDistance = Infinity;
        let nearestTowableEntity = null;
        let nearestTowableEntityDistance = Infinity;
        // Track loadable crates in same loop (avoid second iteration)
        let nearestLoadableCrate = null;
        let nearestLoadableDistance = Infinity;
        const shouldTrackLoadableCrates = this.gameState.cartAttachmentState?.isAttached &&
                                          !this.gameState.crateLoadState?.isLoaded;

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
            } else if (structureTypes.includes(modelType)) {
                if (distanceSquared < nearestStructureDistance) {
                    nearestStructureDistance = distanceSquared;
                    nearestStructure = object;
                }
                // Also track crates for cart loading (combined into single loop for performance)
                if (modelType === 'crate' && shouldTrackLoadableCrates) {
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
            } else if (mobileEntityTypes.includes(modelType)) {
                // Check if this mobile entity is not occupied by someone else
                const entityId = object.userData.objectId;
                const mobileEntitySystem = this.game.mobileEntitySystem;
                if (!mobileEntitySystem || !mobileEntitySystem.isOccupied(entityId)) {
                    if (distanceSquared < nearestMobileEntityDistance) {
                        nearestMobileEntityDistance = distanceSquared;
                        nearestMobileEntity = object;
                    }
                }
            } else if (towableEntityTypes.includes(modelType)) {
                // Check if this cart is not already being towed by someone else
                const entityId = object.userData.objectId;
                const mobileEntitySystem = this.game.mobileEntitySystem;
                // Don't show cart if currently towing it ourselves
                const isOwnCart = this.gameState.cartAttachmentState?.attachedCart === object;
                if (!isOwnCart && (!mobileEntitySystem || !mobileEntitySystem.isOccupied(entityId))) {
                    if (distanceSquared < nearestTowableEntityDistance) {
                        nearestTowableEntityDistance = distanceSquared;
                        nearestTowableEntity = object;
                    }
                }
            } else if (treeTypes.includes(modelType) || rockTypes.includes(modelType) ||
                       modelType === 'log' || modelType.endsWith('_log')) {
                if (distanceSquared < nearestNaturalDistance) {
                    nearestNaturalDistance = distanceSquared;
                    nearestNaturalObject = object;
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
                structureType === 'garden' || structureType === 'market' || structureType === 'dock' ||
                isConstructionSite
            );

            if (decayingStructure && quality !== undefined && currentDurability !== undefined) {
                const structureName = structureType.charAt(0).toUpperCase() + structureType.slice(1);

                // Calculate durability percentage
                const durabilityPercent = quality > 0 ? ((currentDurability / quality) * 100).toFixed(0) : 0;

                // Check ownership for houses
                let isOwner = true; // Default to true for non-house structures
                let ownerDisplay = '';

                if (structureType === 'house' && nearestStructure.userData.owner) {
                    const owner = nearestStructure.userData.owner;
                    const currentClientId = this.gameState.clientId;
                    const currentAccountId = this.gameState.accountId;

                    // Check if current player owns the house
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
                if (isConstructionSite) {
                    // Construction sites have 1-hour lifespan
                    const minutesLeft = hoursUntilRuin !== undefined ? (hoursUntilRuin * 60).toFixed(0) : 0;
                    ui.showStructurePanel(
                        `${nearestStructure.userData.targetStructure} (Construction)`,
                        `Time until removal: ${minutesLeft} minutes`
                    );
                } else if (structureType === 'house') {
                    // Houses show ownership info
                    const hoursLeft = hoursUntilRuin !== undefined ? hoursUntilRuin.toFixed(1) : 0;

                    if (isOwner) {
                        ui.showStructurePanel(
                            `${structureName} | Quality: ${quality}`,
                            `Durability: ${currentDurability.toFixed(1)}/${quality} (${durabilityPercent}%) | ${hoursLeft}h`,
                            `Owner: ${ownerDisplay}`
                        );
                    } else {
                        ui.showStructurePanel(
                            `🔒 ${structureName} (Locked)`,
                            `Owner: ${ownerDisplay}`,
                            `Not your house`
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
        // Only update if not currently piloting (don't change target while piloting)
        if (!this.gameState.mobileEntityState.isActive) {
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
        }

        // Update game state - towable entities (carts)
        // Only update if not currently towing a cart
        if (!this.gameState.cartAttachmentState.isAttached) {
            if (nearestTowableEntity) {
                const actualDistance = Math.sqrt(nearestTowableEntityDistance);
                const proximityRange = 2.0; // Cart attach range

                if (actualDistance <= proximityRange) {
                    this.gameState.nearestTowableEntity = {
                        type: nearestTowableEntity.userData.modelType,
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
        if (shouldTrackLoadableCrates && nearestLoadableCrate) {
            const actualDistance = Math.sqrt(nearestLoadableDistance);
            const proximityRange = 2.5;  // Crate load range (slightly farther than cart attach)

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

            // If player just stopped on grass, roll for mushroom (10% chance)
            if (justStopped && this.gameState.onGrass) {
                this.gameState.mushroomAvailable = this.grassGathering.rollForMushroom();
            }

            // If player just stopped on grass, roll for vegetable seeds (2.5% chance, independent from mushroom)
            if (justStopped && this.gameState.onGrass) {
                this.gameState.vegetableSeedsAvailable = this.grassGathering.rollForVegetableSeeds();
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

        // If player starts moving, disable all gathering options
        if (this.gameState.isMoving) {
            this.gameState.mushroomAvailable = false;
            this.gameState.vegetableSeedsAvailable = false;
            this.gameState.seedsAvailable = false;
            this.gameState.seedTreeType = null;
            this.gameState.vegetablesGatherAvailable = false;
        }

        // If player moves away from vegetables, disable vegetable gathering
        if (!isNearVegetables) {
            this.gameState.vegetablesGatherAvailable = false;
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
            this.gameState.seedsAvailable,  // Seed gathering availability
            this.gameState.seedTreeType,  // Tree type for seed gathering
            this.gameState.climbingState.isClimbing,  // Climbing state
            this.game.occupiedOutposts,  // Occupied outposts map
            this.gameState.vegetablesGatherAvailable,  // Vegetables gathering availability
            this.gameState.activeAction,  // Active action (fishing, harvesting, etc.)
            this.gameState.nearestMobileEntity,  // Nearest mobile entity (boat/horse)
            this.gameState.mobileEntityState,  // Mobile entity state (boarding/piloting/disembarking)
            canDisembark,  // Whether player can disembark from current mobile entity
            this.gameState.nearestDeerCorpse,  // Nearest dead deer corpse for harvesting
            this.gameState.nearestBearCorpse,  // Nearest dead bear corpse for harvesting
            this.gameState.nearestTowableEntity,  // Nearest towable entity (cart)
            this.gameState.cartAttachmentState,  // Cart attachment state (towing)
            this.gameState.nearestLoadableCrate,  // Nearest loadable crate (cart must be attached)
            this.gameState.crateLoadState  // Crate load state (loaded on cart)
        );
    }
}

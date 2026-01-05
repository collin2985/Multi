/**
 * ChunkManager.js
 * Manages world chunks - loading, unloading, and object management
 * With clipmap terrain, this only manages logical chunks for objects/nav, not terrain meshes
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { objectPlacer } from '../objects.js';
import { ui } from '../ui.js';
import ChunkCoordinates from '../core/ChunkCoordinates.js';
import { ChunkNavigationMap } from '../navigation/NavigationMap.js';
import { COLLISION_GROUPS } from '../core/PhysicsManager.js';
import { getChunkTransitionQueue, PRIORITY, TASK_TYPE } from '../systems/ChunkTransitionQueue.js';

// Helper to round coordinates consistently
function roundCoord(v) {
    return Math.round(v * 1000000) / 1000000;
}

export class ChunkManager {
    constructor(gameState, terrainGenerator, scene, game = null) {
        this.gameState = gameState;
        this.terrainGenerator = terrainGenerator;
        this.scene = scene;
        this.game = game;
        this.loadRadius = CONFIG.CHUNKS?.LOAD_RADIUS || 2;
        this.chunkSize = CONFIG.CHUNKS?.CHUNK_SIZE || 50;
        this.pendingChunkCreations = []; // Queue for throttled chunk creation
        this.pendingChunkDisposals = []; // Queue for deferred chunk disposal
        this.pendingChunksAwaitingServerState = []; // Queue for chunks waiting for initial server state
        this.lastPlayerChunkX = 0;
        this.lastPlayerChunkZ = 0;
        this.movementDirectionX = 0;
        this.movementDirectionZ = 0;

        // ChunkManager now owns the chunk tracking (previously in terrainRenderer)
        this.loadedChunks = new Set(); // Set of "chunkX,chunkZ" keys for loaded logical chunks
        this.chunkObjects = new Map(); // Map of "chunkX,chunkZ" -> array of THREE.Object3D

        // Callback when a chunk finishes loading (for LoadingScreen progress)
        this.onChunkLoaded = null;

        this.scheduleIdleCleanup();
    }

    updatePlayerChunk(playerX, playerZ) {
        const { chunkX: newChunkX, chunkZ: newChunkZ } = ChunkCoordinates.worldToChunk(
            roundCoord(playerX),
            roundCoord(playerZ)
        );

        if (newChunkX === this.gameState.currentPlayerChunkX &&
            newChunkZ === this.gameState.currentPlayerChunkZ) {
            return false; // No change
        }

        // Track movement direction for predictive loading
        if (this.lastPlayerChunkX !== 0 || this.lastPlayerChunkZ !== 0) {
            this.movementDirectionX = newChunkX - this.lastPlayerChunkX;
            this.movementDirectionZ = newChunkZ - this.lastPlayerChunkZ;
        } else {
            // First move - initialize last position
            this.lastPlayerChunkX = this.gameState.currentPlayerChunkX;
            this.lastPlayerChunkZ = this.gameState.currentPlayerChunkZ;
        }

        this.lastPlayerChunkX = newChunkX;
        this.lastPlayerChunkZ = newChunkZ;

        // Update local player in chunk registry for spatial partitioning
        const oldChunkKey = this.gameState.currentPlayerChunkX !== null
            ? `${this.gameState.currentPlayerChunkX},${this.gameState.currentPlayerChunkZ}`
            : null;
        const newChunkKey = `${newChunkX},${newChunkZ}`;
        this.gameState.updatePlayerChunk(this.gameState.clientId, oldChunkKey, newChunkKey);

        this.gameState.updateChunkPosition(newChunkX, newChunkZ);
        this.updateChunksAroundPlayer(newChunkX, newChunkZ);

        // Update tent presence for AI spawning when entering new chunk
        if (this.game?.banditController) {
            this.game.banditController.updateTentPresence(newChunkX, newChunkZ);
        }

        return true;
    }

    updateChunksAroundPlayer(chunkX, chunkZ) {
        // If we haven't received initial server state yet, queue this request and return
        if (!this.gameState.receivedInitialServerState) {
            // Store the request to process later
            this.pendingChunksAwaitingServerState.push({ chunkX, chunkZ });
            return;
        }

        const chunksToKeep = new Set();
        const chunksToCreate = [];

        for (let x = -this.loadRadius; x <= this.loadRadius; x++) {
            for (let z = -this.loadRadius; z <= this.loadRadius; z++) {
                const gridX = chunkX + x;
                const gridZ = chunkZ + z;
                const key = `${gridX},${gridZ}`;
                chunksToKeep.add(key);

                if (!this.loadedChunks.has(key)) {
                    // Calculate distance from player chunk and alignment with movement
                    const distance = Math.abs(x) + Math.abs(z);
                    const alignment = (x * this.movementDirectionX) + (z * this.movementDirectionZ);

                    // Instead of creating immediately, add to pending queue with priority
                    chunksToCreate.push({
                        gridX,
                        gridZ,
                        key,
                        distance,
                        alignment
                    });
                }
            }
        }

        // Clear old pending chunks that are no longer needed
        this.pendingChunkCreations = this.pendingChunkCreations.filter(pending =>
            chunksToKeep.has(pending.key)
        );

        // Add new chunks to queue (avoid duplicates)
        chunksToCreate.forEach(chunk => {
            if (!this.pendingChunkCreations.some(pending => pending.key === chunk.key)) {
                this.pendingChunkCreations.push(chunk);
            }
        });

        // Sort queue by priority: prefer chunks in movement direction, then by distance
        this.pendingChunkCreations.sort((a, b) => {
            // Higher alignment (in movement direction) = higher priority (lower sort value)
            // Lower distance = higher priority (lower sort value)
            const priorityA = a.distance - (a.alignment * 2); // Weight alignment heavily
            const priorityB = b.distance - (b.alignment * 2);
            return priorityA - priorityB;
        });

        Array.from(this.loadedChunks).forEach(key => {
            if (!chunksToKeep.has(key)) {
                // Queue chunk for disposal instead of disposing immediately
                if (!this.pendingChunkDisposals.includes(key)) {
                    this.pendingChunkDisposals.push(key);
                }
            }
        });
    }

    scheduleIdleCleanup() {
        // Don't use requestIdleCallback in games - it waits for browser idle which rarely happens
        // Instead, use a regular timer to ensure chunks get disposed promptly
        // Process disposal queue every 4 seconds to prioritize new chunk creation when crossing borders
        setTimeout(() => {
            this.processDisposalQueue();
            // Reschedule for continuous cleanup
            this.scheduleIdleCleanup();
        }, 4000); // Process every 4 seconds to prioritize new chunk creation
    }

    processDisposalQueue() {
        // Process up to 4 chunk disposals per idle callback (increased from 2)
        const batchSize = 4;
        let processed = 0;
        const maxAttempts = this.pendingChunkDisposals.length; // Prevent infinite loop

        while (this.pendingChunkDisposals.length > 0 && processed < batchSize) {
            const key = this.pendingChunkDisposals.shift();

            // Check if chunk exists in our loaded chunks
            if (this.loadedChunks.has(key)) {
                this.disposeChunk(key);
                processed++;
            }
            // If not in loadedChunks, it's already gone - just skip
        }
    }

    processChunkQueue(processAll = false) {
        if (this.pendingChunkCreations.length === 0) {
            return false; // No chunks to create
        }

        if (processAll) {
            // Process ALL chunks at once (use when behind loading screen)
            while (this.pendingChunkCreations.length > 0) {
                const chunk = this.pendingChunkCreations.shift();
                this.createChunk(chunk.gridX, chunk.gridZ);
            }
            return true;
        } else {
            // Process only 1 chunk per frame for smooth performance
            const chunk = this.pendingChunkCreations.shift();
            this.createChunk(chunk.gridX, chunk.gridZ);
            return true;
        }
    }

    processPendingChunksAfterServerState() {
        // Process all pending chunk requests that were queued while waiting for server state
        if (this.pendingChunksAwaitingServerState.length > 0) {
            // Get the most recent chunk request (player's current position)
            const mostRecent = this.pendingChunksAwaitingServerState[this.pendingChunksAwaitingServerState.length - 1];

            // Clear the queue
            this.pendingChunksAwaitingServerState = [];

            // Process the most recent request
            this.updateChunksAroundPlayer(mostRecent.chunkX, mostRecent.chunkZ);
        }
    }

    createChunk(gridX, gridZ) {
        const chunkKey = `${gridX},${gridZ}`;

        // Skip if already loaded
        if (this.loadedChunks.has(chunkKey)) {
            return;
        }

        // ALWAYS ensure cache has an entry for this chunk (even if empty)
        if (!this.gameState.removedObjectsCache.has(chunkKey)) {
            this.gameState.removedObjectsCache.set(chunkKey, new Set());
        }

        // Mark chunk as loaded
        this.loadedChunks.add(chunkKey);

        // Initialize empty objects array for this chunk
        if (!this.chunkObjects.has(chunkKey)) {
            this.chunkObjects.set(chunkKey, []);
        }

        // Queue natural object generation (trees, rocks, etc.)
        if (this.game && this.game.chunkObjectGenerator) {
            const chunkSize = this.chunkSize;
            const alignedChunkX = gridX * chunkSize;
            const alignedChunkZ = gridZ * chunkSize;
            const removedObjectIds = this.gameState.removedObjectsCache.get(chunkKey) || new Set();

            this.game.chunkObjectGenerator.queueChunk({
                key: chunkKey,
                alignedChunkX,
                alignedChunkZ,
                removedObjectIds
            });
        }

        // Notify loading screen of progress
        if (this.onChunkLoaded) {
            this.onChunkLoaded(chunkKey);
        }

        // Create navigation map if this chunk is within physics radius of the player
        // This handles chunks loaded via throttled queue AFTER updateNavMapsAroundPlayer ran
        const physicsRadius = CONFIG.CHUNKS?.PHYSICS_RADIUS || 1;
        const playerChunkX = this.gameState.currentPlayerChunkX;
        const playerChunkZ = this.gameState.currentPlayerChunkZ;
        if (playerChunkX !== null && playerChunkZ !== null) {
            const dx = Math.abs(gridX - playerChunkX);
            const dz = Math.abs(gridZ - playerChunkZ);
            if (dx <= physicsRadius && dz <= physicsRadius) {
                this.createNavMapForChunk(gridX, gridZ);
            }
        }

        // NOTE: Deer/bear spawning is now handled by checkSpawnsOnTick() on server tick
        // This prevents race conditions when multiple players load the same chunk simultaneously
        // See DeerController.checkSpawnsOnTick() and BearController.checkSpawnsOnTick()
    }

    applyChunkRemovals(chunkKey) {
        const objects = this.chunkObjects.get(chunkKey);
        if (!objects) {
            return;
        }

        const removedIds = this.gameState.removedObjectsCache.get(chunkKey);
        if (!removedIds || removedIds.size === 0) {
            return;
        }

        // Remove objects that are in the removal list
        objects.forEach(obj => {
            const objectId = obj.userData.objectId;
            if (removedIds.has(objectId)) {
                // Remove physics collider (always try - PhysicsManager tracks by objectId internally)
                if (this.game.physicsManager) {
                    this.game.physicsManager.removeCollider(objectId);
                }
                this.scene.remove(obj);
                this.disposeObject(obj);
            }
        });

        // Filter out the removed objects from the tracked array
        const keptObjects = objects.filter(obj => !removedIds.has(obj.userData.objectId));
        this.chunkObjects.set(chunkKey, keptObjects);
    }

    disposeChunk(key) {
        // Clear any pending transition tasks for this chunk
        const queue = getChunkTransitionQueue();
        queue.clearChunk(key);

        // Remove chunk from loaded set
        this.loadedChunks.delete(key);

        // NOTE: Deer/bear despawn is NO LONGER triggered here.
        // They now use coordinated area-based despawn via checkAreaOccupancy()
        // which broadcasts despawn messages when ALL players leave the 3x3 area.
        // This prevents desync when one player leaves but another stays.

        // Get currently active mobile entities (should NOT be disposed)
        const currentPilotedEntity = this.gameState.mobileEntityState?.currentEntity;
        const currentAttachedCart = this.gameState.cartAttachmentState?.attachedCart;
        const currentLoadedCrate = this.gameState.crateLoadState?.loadedCrate;

        // Dispose all objects in this chunk
        const objects = this.chunkObjects.get(key);
        if (objects) {
            const preservedObjects = [];

            objects.forEach(obj => {
                // Check if this entity is currently being used by the player
                const isActiveEntity = (obj === currentPilotedEntity ||
                                        obj === currentAttachedCart ||
                                        obj === currentLoadedCrate);

                if (isActiveEntity) {
                    // Move to new chunk based on current position instead of disposing (center-based)
                    const { chunkX: newChunkX, chunkZ: newChunkZ } = ChunkCoordinates.worldToChunk(obj.position.x, obj.position.z);
                    const newChunkKey = `${newChunkX},${newChunkZ}`;

                    // Update userData
                    obj.userData.chunkKey = newChunkKey;

                    // Track for adding to new chunk
                    preservedObjects.push({ obj, newChunkKey });

                    console.log(`[ChunkManager] Preserved active entity ${obj.userData.objectId} - moved from ${key} to ${newChunkKey}`);
                    return; // Don't dispose
                }

                // Remove from objectRegistry (fixes stale registry entries)
                if (this.game.objectRegistry && obj.userData?.objectId) {
                    this.game.objectRegistry.delete(obj.userData.objectId);
                }

                // Remove physics collider
                if (this.game.physicsManager && obj.userData.objectId) {
                    this.game.physicsManager.removeCollider(obj.userData.objectId);
                }
                this.scene.remove(obj);
                this.disposeObject(obj);
            });

            this.chunkObjects.delete(key);

            // Add preserved objects to their new chunks
            for (const { obj, newChunkKey } of preservedObjects) {
                let newChunkObjects = this.chunkObjects.get(newChunkKey);
                if (!newChunkObjects) {
                    newChunkObjects = [];
                    this.chunkObjects.set(newChunkKey, newChunkObjects);
                }
                if (!newChunkObjects.includes(obj)) {
                    newChunkObjects.push(obj);
                }
            }
        }

        // Clear bandit structures registry for this chunk (will be re-registered when chunk loads again)
        if (this.gameState.banditStructuresByChunk.has(key)) {
            this.gameState.banditStructuresByChunk.delete(key);
        }

        // Clear brown bear structures registry and notify controller
        if (this.gameState.brownBearStructuresByChunk.has(key)) {
            this.gameState.brownBearStructuresByChunk.delete(key);
        }
        if (this.game?.brownBearController) {
            this.game.brownBearController.onChunkUnloaded(key);
        }

        // Clear deer tree structures registry and notify controller
        if (this.gameState.deerTreeStructuresByChunk.has(key)) {
            this.gameState.deerTreeStructuresByChunk.delete(key);
        }
        if (this.game?.deerController) {
            this.game.deerController.onChunkUnloaded(key);
        }
    }

    removeObject(objectId) {
        const object = objectPlacer.findObjectById(this.scene, objectId, this.game?.objectRegistry);
        if (object && object.userData.chunkKey) {
            const chunkKey = object.userData.chunkKey;

            // Add to cache
            if (!this.gameState.removedObjectsCache.has(chunkKey)) {
                this.gameState.removedObjectsCache.set(chunkKey, new Set());
            }
            this.gameState.removedObjectsCache.get(chunkKey).add(objectId);

            // Remove physics collider (always try - PhysicsManager tracks by objectId internally)
            if (this.game.physicsManager) {
                this.game.physicsManager.removeCollider(objectId);
            }

            // Update navigation map - remove obstacle
            this.removeObstacleFromNavigation(object, chunkKey);

            // Remove smoke effect for campfires
            if (object.userData.modelType === 'campfire') {
                this.game.removeCampfireSmoke(objectId);
            }

            // Remove from scene
            this.scene.remove(object);
            this.disposeObject(object);

            // Remove from chunkObjects array
            const objects = this.chunkObjects.get(chunkKey);
            if (objects) {
                const filteredObjects = objects.filter(obj => obj.userData.objectId !== objectId);
                this.chunkObjects.set(chunkKey, filteredObjects);
            }

            // Remove from objectRegistry
            if (this.game.objectRegistry && this.game.objectRegistry.has(objectId)) {
                this.game.objectRegistry.delete(objectId);
            }

            // Update nearest object if this was it
            if (this.gameState.nearestObject && this.gameState.nearestObject.id === objectId) {
                this.gameState.nearestObject = null;
                this.gameState.nearestObjectDistance = Infinity;
                ui.updateNearestObject(null, null, null, null, null);
                // Reset object-related buttons but preserve other state
                ui.updateButtonStates(
                    this.gameState.isInChunk,
                    null,   // nearestObject cleared
                    false,  // hasAxe - will be rechecked on next proximity update
                    false,  // hasSaw
                    false,  // isOnCooldown
                    this.gameState.nearestConstructionSite,
                    this.gameState.isMoving,
                    this.gameState.nearestStructure,
                    false,  // hasHammer
                    this.gameState.nearWater,
                    false,  // hasFishingNet
                    this.gameState.onGrass,
                    this.gameState.mushroomAvailable,
                    this.gameState.vegetableSeedsAvailable,
                    this.gameState.seedsAvailable,
                    this.gameState.seedTreeType,
                    this.gameState.climbingState?.isClimbing || false,
                    null,
                    this.gameState.vegetablesGatherAvailable,
                    this.gameState.activeAction
                );
            }
            return true;
        }
        return false;
    }

    removeObstacleFromNavigation(object, chunkKey) {
        if (!this.game.navigationManager) return;

        const chunkId = `chunk_${chunkKey}`;
        const navMap = this.game.navigationManager.getChunk(chunkId);

        if (!navMap || !object.userData.modelType) return;

        const position = object.position;
        const modelType = object.userData.modelType;
        const rotation = object.rotation?.y || 0;
        const scale = object.userData.originalScale || object.scale?.x || 1.0;

        // Import CONFIG to get dimensions
        import('../config.js').then(({ CONFIG }) => {
            const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[modelType];

            if (dims) {
                if (dims.radius !== undefined) {
                    // Cylindrical obstacle (trees, rocks)
                    const radius = dims.radius * scale;
                    navMap.removeCylindricalObstacle(position.x, position.z, radius);
                    console.log(`[Nav] Removed cylindrical obstacle ${modelType} at (${position.x.toFixed(1)}, ${position.z.toFixed(1)})`);
                } else if (dims.width !== undefined && dims.depth !== undefined) {
                    // Rectangular obstacle (structures, logs)
                    const width = dims.width * scale;
                    const depth = dims.depth * scale;
                    navMap.removeRectangularObstacle(position.x, position.z, width, depth, rotation);
                }
            }
        });
    }

    disposeObject(object) {
        // Remove billboards if this object has them (trees, vegetables, rocks)
        if (this.game.billboardSystem) {
            this.game.billboardSystem.removeTreeBillboard(object);
        }
        // Remove 3D rock model if this is a rock
        if (this.game.rockModelSystem) {
            this.game.rockModelSystem.removeRockInstance(object);
        }

        // Remove stake billboard for vegetables
        if (object.userData && object.userData.stakeBillboard) {
            const stake = object.userData.stakeBillboard;
            this.scene.remove(stake);
            if (stake.geometry) stake.geometry.dispose();
            if (stake.material) {
                if (stake.material.map) stake.material.map.dispose();
                stake.material.dispose();
            }
            object.userData.stakeBillboard = null;
        }

        // Dispose blob shadow first
        if (object.userData && object.userData.blobShadow) {
            object.userData.blobShadow.dispose();
            object.userData.blobShadow = null;
        }

        // Dispose mesh resources
        object.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(mat => mat.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            }
        });
    }

    // ============================================================================
    // Navigation Map Management (3x3 grid around player)
    // ============================================================================

    /**
     * Create and build a navigation map for a chunk
     * Only call this for chunks within PHYSICS_RADIUS of the player
     *
     * @param {number} gridX - Chunk X coordinate
     * @param {number} gridZ - Chunk Z coordinate
     * @returns {ChunkNavigationMap|null} - The created navmap or null if failed
     */
    createNavMapForChunk(gridX, gridZ) {
        if (!this.game || !this.game.navigationManager || !this.terrainGenerator) {
            return null;
        }

        const chunkKey = `${gridX},${gridZ}`;
        const chunkId = `chunk_${chunkKey}`;

        // Check if navmap already exists
        if (this.game.navigationManager.getChunk(chunkId)) {
            return this.game.navigationManager.getChunk(chunkId);
        }

        // Create the navigation map
        const navMap = new ChunkNavigationMap(
            chunkId,
            gridX,
            gridZ,
            this.game.physicsManager
        );

        // Build simple grid (obstacles only, uniform cost for JPS pathfinding)
        const objects = this.chunkObjects.get(chunkKey) || [];
        navMap.buildSimpleGrid(objects, CONFIG.CONSTRUCTION?.GRID_DIMENSIONS);

        // Apply roads from gameState.roads to restore road speed bonuses
        // Nav map uses circular approximation (radius 1.0 covers pill area)
        if (this.game.gameState?.roads) {
            const roads = this.game.gameState.roads.get(chunkKey);
            if (roads && roads.length > 0) {
                for (const road of roads) {
                    navMap.addRoad(road.x, road.z, 1.0);
                }
            }
        }

        // Register with NavigationManager
        this.game.navigationManager.addChunk(chunkId, navMap);

        return navMap;
    }

    /**
     * Remove navigation map for a chunk
     *
     * @param {number} gridX - Chunk X coordinate
     * @param {number} gridZ - Chunk Z coordinate
     */
    removeNavMapForChunk(gridX, gridZ) {
        if (!this.game || !this.game.navigationManager) {
            return;
        }

        const chunkId = `chunk_${gridX},${gridZ}`;

        if (this.game.navigationManager.getChunk(chunkId)) {
            this.game.navigationManager.removeChunk(chunkId);
        }
    }

    /**
     * Update navigation maps for the 3x3 grid around the player
     * Called when player crosses chunk boundaries
     *
     * @param {number} newChunkX - New player chunk X
     * @param {number} newChunkZ - New player chunk Z
     * @param {number} oldChunkX - Previous player chunk X
     * @param {number} oldChunkZ - Previous player chunk Z
     */
    updateNavMapsAroundPlayer(newChunkX, newChunkZ, oldChunkX, oldChunkZ) {
        const physicsRadius = CONFIG.CHUNKS?.PHYSICS_RADIUS || 1;

        // Collect old and new physics chunks
        const oldNavChunks = new Set();
        const newNavChunks = new Set();

        for (let dx = -physicsRadius; dx <= physicsRadius; dx++) {
            for (let dz = -physicsRadius; dz <= physicsRadius; dz++) {
                oldNavChunks.add(`${oldChunkX + dx},${oldChunkZ + dz}`);
                newNavChunks.add(`${newChunkX + dx},${newChunkZ + dz}`);
            }
        }

        // Remove navmaps for chunks that left the physics radius
        for (const chunkKey of oldNavChunks) {
            if (!newNavChunks.has(chunkKey)) {
                const [gx, gz] = chunkKey.split(',').map(Number);
                this.removeNavMapForChunk(gx, gz);
            }
        }

        // Create navmaps for chunks that entered the physics radius
        for (const chunkKey of newNavChunks) {
            if (!oldNavChunks.has(chunkKey) && this.loadedChunks.has(chunkKey)) {
                const [gx, gz] = chunkKey.split(',').map(Number);
                this.createNavMapForChunk(gx, gz);
            }
        }
    }

    /**
     * Update navigation maps with deferred processing
     * Spreads nav map operations across multiple frames to prevent stuttering
     */
    updateNavMapsAroundPlayerDeferred(newChunkX, newChunkZ, oldChunkX, oldChunkZ, generation) {
        const queue = getChunkTransitionQueue();
        const physicsRadius = CONFIG.CHUNKS?.PHYSICS_RADIUS || 1;

        const oldNavChunks = new Set();
        const newNavChunks = new Set();

        for (let dx = -physicsRadius; dx <= physicsRadius; dx++) {
            for (let dz = -physicsRadius; dz <= physicsRadius; dz++) {
                oldNavChunks.add(`${oldChunkX + dx},${oldChunkZ + dz}`);
                newNavChunks.add(`${newChunkX + dx},${newChunkZ + dz}`);
            }
        }

        // Helper to check if chunk is currently in nav radius
        const isInNavRadius = (gx, gz) => {
            const playerChunkX = this.gameState.currentPlayerChunkX;
            const playerChunkZ = this.gameState.currentPlayerChunkZ;
            return Math.abs(gx - playerChunkX) <= physicsRadius &&
                   Math.abs(gz - playerChunkZ) <= physicsRadius;
        };

        // Queue removals
        for (const chunkKey of oldNavChunks) {
            if (!newNavChunks.has(chunkKey)) {
                const [gx, gz] = chunkKey.split(',').map(Number);
                queue.queueWithGeneration(TASK_TYPE.NAV_MAP, () => {
                    if (isInNavRadius(gx, gz)) return; // Came back into radius
                    this.removeNavMapForChunk(gx, gz);
                }, PRIORITY.LOW, `nav_rm_${chunkKey}_${generation}`, generation);
            }
        }

        // Queue creations sorted by distance
        const chunksToCreate = [];
        for (const chunkKey of newNavChunks) {
            if (!oldNavChunks.has(chunkKey) && this.loadedChunks.has(chunkKey)) {
                const [gx, gz] = chunkKey.split(',').map(Number);
                const dist = Math.abs(gx - newChunkX) + Math.abs(gz - newChunkZ);
                chunksToCreate.push({ gx, gz, dist, key: chunkKey });
            }
        }

        chunksToCreate.sort((a, b) => a.dist - b.dist);

        for (const { gx, gz, key } of chunksToCreate) {
            queue.queueWithGeneration(TASK_TYPE.NAV_MAP, () => {
                if (!isInNavRadius(gx, gz)) return; // Left radius
                if (!this.loadedChunks.has(key)) return; // Chunk unloaded
                this.createNavMapForChunk(gx, gz);
            }, PRIORITY.NORMAL, `nav_add_${key}_${generation}`, generation);
        }
    }

    /**
     * Initialize navigation maps for all chunks within physics radius
     * Called after initial chunk loading is complete
     *
     * @param {number} playerChunkX - Player's current chunk X
     * @param {number} playerChunkZ - Player's current chunk Z
     */
    initializeNavMapsAroundPlayer(playerChunkX, playerChunkZ) {
        const physicsRadius = CONFIG.CHUNKS?.PHYSICS_RADIUS || 1;
        let created = 0;

        for (let dx = -physicsRadius; dx <= physicsRadius; dx++) {
            for (let dz = -physicsRadius; dz <= physicsRadius; dz++) {
                const gx = playerChunkX + dx;
                const gz = playerChunkZ + dz;
                const chunkKey = `${gx},${gz}`;

                // Only create navmap if chunk is loaded
                if (this.loadedChunks.has(chunkKey)) {
                    if (this.createNavMapForChunk(gx, gz)) {
                        created++;
                    }
                }
            }
        }

    }

    /**
     * Initialize physics colliders for all natural objects within physics radius
     * Called after initial chunk loading is complete to ensure objects can be interacted with
     *
     * @param {number} playerChunkX - Player's current chunk X
     * @param {number} playerChunkZ - Player's current chunk Z
     */
    initializePhysicsCollidersAroundPlayer(playerChunkX, playerChunkZ) {
        const physicsRadius = CONFIG.CHUNKS?.PHYSICS_RADIUS || 1;
        const physicsManager = this.game?.physicsManager;
        const scene = this.scene;

        if (!physicsManager?.initialized) {
            console.warn('[ChunkManager] Physics manager not initialized, skipping collider init');
            return;
        }

        const TREE_TYPES = ['oak', 'fir', 'pine', 'cypress', 'apple', 'vegetables'];
        const ROCK_TYPES = ['limestone', 'sandstone', 'clay', 'iron'];
        const LOG_TYPES = ['log', 'oak_log', 'pine_log', 'fir_log', 'cypress_log', 'apple_log'];
        const NATURAL_TYPES = [...TREE_TYPES, ...ROCK_TYPES, ...LOG_TYPES];
        // Structures need colliders for interaction (bandit camps, player structures, etc.)
        const STRUCTURE_TYPES = ['tent', 'campfire', 'outpost', 'house', 'crate', 'garden', 'market', 'dock', 'tileworks', 'ironworks', 'blacksmith', 'bakery', 'gardener', 'miner', 'woodcutter', 'stonemason', 'horse', 'cart', 'boat', 'ship', 'wall'];

        let collidersCreated = 0;
        let objectsAddedToScene = 0;

        for (let dx = -physicsRadius; dx <= physicsRadius; dx++) {
            for (let dz = -physicsRadius; dz <= physicsRadius; dz++) {
                const gx = playerChunkX + dx;
                const gz = playerChunkZ + dz;
                const chunkKey = `${gx},${gz}`;

                const objects = this.chunkObjects.get(chunkKey);
                if (!objects) continue;

                for (const obj of objects) {
                    if (!obj.userData?.objectId) continue;

                    const modelType = obj.userData.modelType;
                    const isNatural = NATURAL_TYPES.includes(modelType);
                    const isStructure = STRUCTURE_TYPES.includes(modelType);

                    // Skip if not a type we handle
                    if (!isNatural && !isStructure) continue;

                    // Natural objects: ensure in scene
                    if (isNatural && !obj.userData.addedToScene) {
                        scene.add(obj);
                        obj.userData.addedToScene = true;
                        objectsAddedToScene++;
                    }

                    // Skip if already has collider
                    if (obj.userData.physicsHandle) continue;

                    const dims = CONFIG.CONSTRUCTION?.GRID_DIMENSIONS?.[modelType];
                    if (!dims) continue;

                    let shape, collisionGroup;

                    if (dims.radius !== undefined) {
                        // Cylindrical collider (trees, rocks)
                        shape = {
                            type: 'cylinder',
                            radius: dims.radius,
                            height: dims.height || 1.0
                        };
                        collisionGroup = COLLISION_GROUPS.NATURAL;
                    } else if (dims.width !== undefined) {
                        // Rectangular collider (structures, logs)
                        shape = {
                            type: 'cuboid',
                            width: dims.width,
                            depth: dims.depth,
                            height: dims.height || 1.0
                        };
                        // Determine collision group
                        if (modelType === 'log' || modelType.endsWith('_log') || modelType === 'crate') {
                            collisionGroup = COLLISION_GROUPS.PLACED;
                        } else {
                            collisionGroup = COLLISION_GROUPS.STRUCTURE;
                        }
                    }

                    if (shape) {
                        const collider = physicsManager.createStaticCollider(
                            obj.userData.objectId,
                            shape,
                            obj.position,
                            obj.rotation?.y || 0,
                            collisionGroup
                        );
                        if (collider) {
                            obj.userData.physicsHandle = collider;
                            collidersCreated++;
                        }
                    }
                }
            }
        }

        if (collidersCreated > 0 || objectsAddedToScene > 0) {
            console.log(`[ChunkManager] Initialized physics: ${collidersCreated} colliders created, ${objectsAddedToScene} objects added to scene`);
        }
    }
}
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
import { ChunkPerfTimer } from '../core/PerformanceTimer.js';

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

        // Notify server about claimed mobile entities crossing chunk boundaries
        // This ensures disconnect cleanup can find entities that traveled far
        this._updateClaimedEntityChunks(newChunkX, newChunkZ);

        // Update tent presence for AI spawning when entering new chunk
        if (this.game?.banditController) {
            this.game.banditController.updateTentPresence(newChunkX, newChunkZ);
        }

        return true;
    }

    /**
     * Notify server when claimed mobile entities cross chunk boundaries
     * This ensures disconnect cleanup can find entities that traveled far from their original claim location
     */
    _updateClaimedEntityChunks(newChunkX, newChunkZ) {
        const networkManager = this.game?.networkManager;
        const vehicleState = this.gameState?.vehicleState;
        if (!networkManager || !vehicleState) return;

        const newChunkId = `chunk_${newChunkX},${newChunkZ}`;
        const clientId = this.gameState.clientId;
        const entitiesToUpdate = [];

        // Get piloting entity position (used for ship-loaded entities too)
        let pilotingPosition = null;
        if (vehicleState.pilotingEntity?.position) {
            const pos = vehicleState.pilotingEntity.position;
            pilotingPosition = [pos.x, pos.y, pos.z];
        }

        // Check if piloting a vehicle (ship, boat, horse)
        if (vehicleState.isPiloting && vehicleState.pilotingEntity) {
            const entityId = vehicleState.pilotingEntity.userData?.objectId;
            if (entityId) {
                entitiesToUpdate.push({ entityId, position: pilotingPosition });
            }
        }

        // Check if towing an entity (cart, artillery)
        if (vehicleState.towedEntity?.isAttached) {
            const entityId = vehicleState.towedEntity.id;
            if (entityId) {
                // Get towed entity's actual position from its mesh
                let towedPosition = pilotingPosition;  // fallback to pilot position
                if (vehicleState.towedEntity.mesh?.position) {
                    const pos = vehicleState.towedEntity.mesh.position;
                    towedPosition = [pos.x, pos.y, pos.z];
                }
                entitiesToUpdate.push({ entityId, position: towedPosition });
            }
        }

        // Check ship-loaded artillery (when piloting ship2)
        if (vehicleState.loadedArtillery?.length > 0) {
            for (const artData of vehicleState.loadedArtillery) {
                if (artData.artilleryId) {
                    // Ship-loaded entities use ship position
                    entitiesToUpdate.push({ entityId: artData.artilleryId, position: pilotingPosition });
                }
            }
        }

        // Check ship-loaded horses (when piloting ship2)
        if (vehicleState.shipHorses?.length > 0) {
            for (const horseData of vehicleState.shipHorses) {
                if (horseData.horseId) {
                    // Ship-loaded entities use ship position
                    entitiesToUpdate.push({ entityId: horseData.horseId, position: pilotingPosition });
                }
            }
        }

        // Send update for each claimed entity with position
        for (const { entityId, position } of entitiesToUpdate) {
            networkManager.sendMessage('update_mobile_entity_chunk', {
                entityId,
                clientId,
                newChunkId,
                position
            });
        }
    }

    updateChunksAroundPlayer(chunkX, chunkZ) {
        // If we haven't received initial server state yet, queue this request and return
        if (!this.gameState.receivedInitialServerState) {
            // Store the request to process later
            this.pendingChunksAwaitingServerState.push({ chunkX, chunkZ });
            return;
        }

        const _t0 = performance.now();

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

        const _t1 = performance.now();

        // Clear old pending chunks that are no longer needed
        this.pendingChunkCreations = this.pendingChunkCreations.filter(pending =>
            chunksToKeep.has(pending.key)
        );

        // Clear pending disposals for chunks that are back in range
        // This prevents disposing chunks that were briefly out of range but came back
        // (e.g., when player moves back and forth across chunk boundaries)
        this.pendingChunkDisposals = this.pendingChunkDisposals.filter(key =>
            !chunksToKeep.has(key)
        );

        // Add new chunks to queue (avoid duplicates)
        chunksToCreate.forEach(chunk => {
            if (!this.pendingChunkCreations.some(pending => pending.key === chunk.key)) {
                this.pendingChunkCreations.push(chunk);
            }
        });

        const _t2 = performance.now();

        // Sort queue by priority: prefer chunks in movement direction, then by distance
        this.pendingChunkCreations.sort((a, b) => {
            // Higher alignment (in movement direction) = higher priority (lower sort value)
            // Lower distance = higher priority (lower sort value)
            const priorityA = a.distance - (a.alignment * 2); // Weight alignment heavily
            const priorityB = b.distance - (b.alignment * 2);
            return priorityA - priorityB;
        });

        const _t3 = performance.now();

        Array.from(this.loadedChunks).forEach(key => {
            if (!chunksToKeep.has(key)) {
                // Queue chunk for disposal instead of disposing immediately
                if (!this.pendingChunkDisposals.includes(key)) {
                    this.pendingChunkDisposals.push(key);
                }
            }
        });

        const _t4 = performance.now();

    }

    scheduleIdleCleanup() {
        // Don't use requestIdleCallback in games - it waits for browser idle which rarely happens
        // Instead, use a regular timer to ensure chunks get disposed promptly
        // Process disposal queue every 1 second with smaller batches for smoother memory cleanup
        setTimeout(() => {
            this.processDisposalQueue();
            // Reschedule for continuous cleanup
            this.scheduleIdleCleanup();
        }, 1000); // Process every 1 second for faster cleanup
    }

    processDisposalQueue() {
        ChunkPerfTimer.start('ChunkManager.processDisposalQueue');
        // Process 2 chunks per cycle (smaller batches, more frequent)
        const batchSize = 2;
        let processed = 0;

        while (this.pendingChunkDisposals.length > 0 && processed < batchSize) {
            const key = this.pendingChunkDisposals.shift();

            // Check if chunk exists in our loaded chunks
            if (this.loadedChunks.has(key)) {
                this.disposeChunk(key);
                processed++;
            }
            // If not in loadedChunks, it's already gone - just skip
        }
        ChunkPerfTimer.end('ChunkManager.processDisposalQueue');
    }

    processChunkQueue(processAll = false) {
        if (this.pendingChunkCreations.length === 0) {
            return false; // No chunks to create
        }

        ChunkPerfTimer.start('ChunkManager.processChunkQueue');
        if (processAll) {
            // Process ALL chunks at once (use when behind loading screen)
            while (this.pendingChunkCreations.length > 0) {
                const chunk = this.pendingChunkCreations.shift();
                this.createChunk(chunk.gridX, chunk.gridZ);
            }
            ChunkPerfTimer.end('ChunkManager.processChunkQueue');
            return true;
        } else {
            // Process only 1 chunk per frame for smooth performance
            const chunk = this.pendingChunkCreations.shift();
            this.createChunk(chunk.gridX, chunk.gridZ);
            ChunkPerfTimer.end('ChunkManager.processChunkQueue');
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
        ChunkPerfTimer.start('ChunkManager.createChunk');
        const chunkKey = `${gridX},${gridZ}`;

        // Skip if already loaded
        if (this.loadedChunks.has(chunkKey)) {
            ChunkPerfTimer.end('ChunkManager.createChunk');
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

        // NOTE: Nav map creation is deferred to ChunkObjectGenerator.finalizeCurrentChunk()
        // Creating it here would build the grid with 0 objects (race condition),
        // causing JPS pathfinding to degenerate on the obstacle-free grid.

        // NOTE: Deer/bear spawning is now handled by checkSpawnsOnTick() on server tick
        // This prevents race conditions when multiple players load the same chunk simultaneously
        // See DeerController.checkSpawnsOnTick() and BearController.checkSpawnsOnTick()
        ChunkPerfTimer.end('ChunkManager.createChunk');
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

        // Get currently active mobile entities (should NOT be removed)
        // Same protection as disposeChunk to prevent desync during chunk crossing
        const currentPilotedEntity = this.gameState.vehicleState?.pilotingEntity;
        const currentTowedEntity = this.gameState.vehicleState?.towedEntity?.mesh;
        const currentLoadedCargo = this.gameState.vehicleState?.cartCargo?.loadedItems?.[0]?.mesh;
        const currentMannedArtillery = this.gameState.vehicleState?.mannedArtillery?.mesh;

        // Collect peer mobile entities
        const peerMobileEntities = new Set();
        if (this.game?.networkManager?.peerGameData) {
            for (const [peerId, peerData] of this.game.networkManager.peerGameData) {
                if (peerData.loadedCrate?.mesh) peerMobileEntities.add(peerData.loadedCrate.mesh);
                if (peerData.towedCart?.mesh) peerMobileEntities.add(peerData.towedCart.mesh);
                if (peerData.mobileEntity?.mesh) peerMobileEntities.add(peerData.mobileEntity.mesh);
                if (peerData.towedArtillery?.mesh) peerMobileEntities.add(peerData.towedArtillery.mesh);
                if (peerData.mannedArtillery?.mesh) peerMobileEntities.add(peerData.mannedArtillery.mesh);
            }
        }

        // Track preserved entities that need chunk reassignment
        const preservedObjects = [];

        // Remove objects that are in the removal list
        const MOBILE_TYPES = ['boat', 'sailboat', 'ship2', 'horse'];
        objects.forEach(obj => {
            const objectId = obj.userData.objectId;
            if (removedIds.has(objectId)) {
                // Check if this is an active entity that should be preserved
                const isActiveEntity = (obj === currentPilotedEntity ||
                                        obj === currentTowedEntity ||
                                        obj === currentLoadedCargo ||
                                        obj === currentMannedArtillery ||
                                        peerMobileEntities.has(obj));

                if (isActiveEntity) {
                    // Don't remove - update chunk tracking instead (same as disposeChunk)
                    const { chunkX: newChunkX, chunkZ: newChunkZ } = ChunkCoordinates.worldToChunk(obj.position.x, obj.position.z);
                    const newChunkKey = `${newChunkX},${newChunkZ}`;
                    obj.userData.chunkKey = newChunkKey;
                    preservedObjects.push({ obj, newChunkKey });

                    // Remove from removal cache so it won't be skipped by SceneObjectFactory
                    removedIds.delete(objectId);
                    return;
                }

                // Remove physics collider (always try - PhysicsManager tracks by objectId internally)
                if (this.game.physicsManager) {
                    this.game.physicsManager.removeCollider(objectId);
                }
                this.scene.remove(obj);
                this.disposeObject(obj);

                // Unregister militia structures
                if (obj.userData.hasMilitia) {
                    const modelType = obj.userData.modelType;
                    if (modelType === 'tent' || modelType === 'outpost') {
                        this.gameState.unregisterMilitiaStructure(chunkKey, obj.userData.objectId);
                    }
                }

                // Remove from objectRegistry
                if (this.game.objectRegistry && this.game.objectRegistry.has(objectId)) {
                    this.game.objectRegistry.delete(objectId);
                }

                // Clear nearestObject if this was it
                if (this.gameState.nearestObject && this.gameState.nearestObject.id === objectId) {
                    this.gameState.nearestObject = null;
                    this.gameState.nearestObjectDistance = Infinity;
                }
            }
        });

        // Filter out the removed objects from the tracked array (but keep preserved ones)
        const preservedIds = new Set(preservedObjects.map(p => p.obj.userData.objectId));
        const keptObjects = objects.filter(obj =>
            !removedIds.has(obj.userData.objectId) || preservedIds.has(obj.userData.objectId)
        );
        this.chunkObjects.set(chunkKey, keptObjects);

        // Add preserved objects to their new chunks (same as disposeChunk)
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

    disposeChunk(key) {
        ChunkPerfTimer.start('ChunkManager.disposeChunk');
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
        const currentPilotedEntity = this.gameState.vehicleState?.pilotingEntity;
        const currentTowedEntity = this.gameState.vehicleState?.towedEntity?.mesh;
        const currentLoadedCargo = this.gameState.vehicleState?.cartCargo?.loadedItems?.[0]?.mesh;
        const currentMannedArtillery = this.gameState.vehicleState?.mannedArtillery?.mesh;

        // Collect peer mobile entities (crates, carts, horses controlled by peers)
        const peerMobileEntities = new Set();
        if (this.game?.networkManager?.peerGameData) {
            for (const [peerId, peerData] of this.game.networkManager.peerGameData) {
                if (peerData.loadedCrate?.mesh) peerMobileEntities.add(peerData.loadedCrate.mesh);
                if (peerData.towedCart?.mesh) peerMobileEntities.add(peerData.towedCart.mesh);
                if (peerData.mobileEntity?.mesh) peerMobileEntities.add(peerData.mobileEntity.mesh);
                if (peerData.towedArtillery?.mesh) peerMobileEntities.add(peerData.towedArtillery.mesh);
                if (peerData.mannedArtillery?.mesh) peerMobileEntities.add(peerData.mannedArtillery.mesh);
            }
        }

        // Dispose all objects in this chunk
        const objects = this.chunkObjects.get(key);
        if (objects) {
            const preservedObjects = [];
            const objectsToDispose = [];

            objects.forEach(obj => {
                // Check if this entity is currently being used by the player or any peer
                const isActiveEntity = (obj === currentPilotedEntity ||
                                        obj === currentTowedEntity ||
                                        obj === currentLoadedCargo ||
                                        obj === currentMannedArtillery ||
                                        peerMobileEntities.has(obj));

                if (isActiveEntity) {
                    // Move to new chunk based on current position instead of disposing (center-based)
                    const { chunkX: newChunkX, chunkZ: newChunkZ } = ChunkCoordinates.worldToChunk(obj.position.x, obj.position.z);
                    const newChunkKey = `${newChunkX},${newChunkZ}`;

                    // Update userData
                    obj.userData.chunkKey = newChunkKey;

                    // Track for adding to new chunk
                    preservedObjects.push({ obj, newChunkKey });

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

                // Collect for batched cleanup
                objectsToDispose.push(obj);
            });

            // Queue GPU resource cleanup in batches (prevents 200+ individual tasks)
            const CLEANUP_BATCH_SIZE = 50;
            for (let i = 0; i < objectsToDispose.length; i += CLEANUP_BATCH_SIZE) {
                const batch = objectsToDispose.slice(i, i + CLEANUP_BATCH_SIZE);
                const batchIndex = Math.floor(i / CLEANUP_BATCH_SIZE);
                queue.queue(TASK_TYPE.CLEANUP, () => {
                    for (const obj of batch) {
                        this.disposeObject(obj);
                    }
                }, PRIORITY.LOW, `dispose_batch_${key}_${batchIndex}`);
            }

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

        // Clear structure registries (AI already cleaned up at 3x3 physics radius boundary)
        if (this.gameState.banditStructuresByChunk.has(key)) {
            this.gameState.banditStructuresByChunk.delete(key);
        }
        if (this.gameState.brownBearStructuresByChunk.has(key)) {
            this.gameState.brownBearStructuresByChunk.delete(key);
        }
        if (this.gameState.deerTreeStructuresByChunk.has(key)) {
            this.gameState.deerTreeStructuresByChunk.delete(key);
        }
        // NOTE: Militia registry is NOT cleared here (matches worker behavior)
        // Registry will be updated when chunk reloads. Clearing it causes a race condition
        // where checkMilitiaSpawnsOnTick runs before objects are created in deferred queue.
        ChunkPerfTimer.end('ChunkManager.disposeChunk');
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

            // Unregister from AI structure registries
            // This prevents memory leaks and stale entries when structures are removed locally
            const modelType = object.userData.modelType;

            // Bandit structures (tent, outpost, campfire, horse)
            if (object.userData.isBanditStructure ||
                ['tent', 'outpost', 'campfire', 'horse'].includes(modelType)) {
                this.gameState.unregisterBanditStructure(chunkKey, objectId);
            }

            // Brown bear structures (bearden)
            if (object.userData.isBrownBearStructure || modelType === 'bearden') {
                this.gameState.unregisterBrownBearStructure(chunkKey, objectId);
            }

            // Deer/Apple tree structures
            if (object.userData.isDeerTreeStructure ||
                ['deertree', 'apple'].includes(modelType)) {
                this.gameState.unregisterDeerTreeStructure(chunkKey, objectId);
            }

            // Worker building registries
            if (modelType === 'market') {
                this.gameState.unregisterMarket(chunkKey, objectId);
            }
            if (modelType === 'bakery') {
                this.gameState.unregisterBakery(chunkKey, objectId);
            }
            if (modelType === 'gardener') {
                this.gameState.unregisterGardener(chunkKey, objectId);
            }
            if (modelType === 'woodcutter') {
                this.gameState.unregisterWoodcutter(chunkKey, objectId);
            }
            if (modelType === 'miner') {
                this.gameState.unregisterMiner(chunkKey, objectId);
            }
            if (modelType === 'ironworks') {
                this.gameState.unregisterIronworks(chunkKey, objectId);
            }
            if (modelType === 'tileworks') {
                this.gameState.unregisterTileworks(chunkKey, objectId);
            }
            if (modelType === 'blacksmith') {
                this.gameState.unregisterBlacksmith(chunkKey, objectId);
            }
            if (modelType === 'stonemason') {
                this.gameState.unregisterStonemason(chunkKey, objectId);
            }
            if (modelType === 'fisherman') {
                this.gameState.unregisterFisherman(chunkKey, objectId);
            }

            // Militia structures (tent/outpost with hasMilitia)
            if (object.userData.hasMilitia) {
                if (modelType === 'tent' || modelType === 'outpost') {
                    this.gameState.unregisterMilitiaStructure(chunkKey, objectId);
                }
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
                    this.gameState.limestoneAvailable,
                    this.gameState.seedsAvailable,
                    this.gameState.seedTreeType,
                    this.gameState.climbingState?.isClimbing || false,
                    null,
                    this.gameState.vegetablesGatherAvailable,
                    this.gameState.hempSeedsAvailable,
                    this.gameState.hempGatherAvailable,
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
                // Small natural objects use minimal 1-cell footprint (must match SceneObjectFactory add path)
                const SMALL_OBSTACLE_TYPES = ['pine', 'apple', 'vegetables', 'hemp', 'limestone', 'sandstone', 'clay', 'iron',
                    'planted_pine', 'planted_fir', 'planted_apple', 'planted_vegetables', 'planted_hemp'];
                if (SMALL_OBSTACLE_TYPES.includes(modelType)) {
                    navMap.removeSmallObstacle(position.x, position.z, 0.1);
                } else if (dims.radius !== undefined) {
                    // Cylindrical obstacle (larger trees like oak, fir, cypress)
                    const radius = dims.radius * scale;
                    navMap.removeCylindricalObstacle(position.x, position.z, radius);
                } else if (dims.width !== undefined && dims.depth !== undefined) {
                    // Rectangular obstacle (structures, logs)
                    const width = dims.width * scale;
                    const depth = dims.depth * scale;
                    navMap.removeRectangularObstacle(position.x, position.z, width, depth, rotation);
                }
                this.game.navigationManager.syncChunkToWorker(chunkId);
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
        // Remove from structure LOD system
        if (this.game.structureModelSystem && object.userData?.objectId) {
            this.game.structureModelSystem.unregisterStructure(object.userData.objectId);
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
        const disposeMat = (mat) => {
            // Dispose canvas-generated textures (unique per object)
            // Skip GLB textures — shared across clones, Three.js cache handles them
            if (mat.map && mat.map.image instanceof HTMLCanvasElement) {
                mat.map.dispose();
            }
            mat.dispose();
        };
        object.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(disposeMat);
                    } else {
                        disposeMat(child.material);
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
        ChunkPerfTimer.start('ChunkManager.createNavMap');
        if (!this.game || !this.game.navigationManager || !this.terrainGenerator) {
            console.error(`[NavDiag] createNavMap ABORT chunk(${gridX},${gridZ}) | game=${!!this.game} navMgr=${!!this.game?.navigationManager} terrain=${!!this.terrainGenerator}`);
            ChunkPerfTimer.end('ChunkManager.createNavMap');
            return null;
        }

        const chunkKey = `${gridX},${gridZ}`;
        const chunkId = `chunk_${chunkKey}`;

        // Check if navmap already exists
        if (this.game.navigationManager.getChunk(chunkId)) {
            ChunkPerfTimer.end('ChunkManager.createNavMap');
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
        const result = navMap.buildSimpleGrid(objects, CONFIG.CONSTRUCTION?.GRID_DIMENSIONS);
        // Count actual walkable/obstacle cells from grid (not object count)
        let actualWalkable = 0, actualObstacle = 0;
        for (let i = 0; i < navMap.grid.length; i++) {
            if (navMap.grid[i] & 1) actualWalkable++;
            if (navMap.grid[i] & 64) actualObstacle++;
        }

        // Apply roads from gameState.roads to restore road speed bonuses
        // Nav map uses circular approximation (radius 1.25 covers pill area)
        if (this.game.gameState?.roads) {
            const roads = this.game.gameState.roads.get(chunkKey);
            if (roads && roads.length > 0) {
                for (const road of roads) {
                    navMap.addRoad(road.x, road.z, 1.25);
                }
            }
        }

        // Register with NavigationManager
        this.game.navigationManager.addChunk(chunkId, navMap);

        ChunkPerfTimer.end('ChunkManager.createNavMap');
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

                // AI cleanup for chunks leaving physics radius
                queue.queueWithGeneration(TASK_TYPE.AI_UPDATE, () => {
                    if (isInNavRadius(gx, gz)) return;
                    this._cleanupAIInChunk(chunkKey);
                }, PRIORITY.LOW, `ai_rm_${chunkKey}_${generation}`, generation);

                // Smoke effect cleanup for chunks leaving physics radius
                queue.queueWithGeneration(TASK_TYPE.CLEANUP, () => {
                    if (isInNavRadius(gx, gz)) return;
                    this._cleanupSmokeInChunk(chunkKey);
                }, PRIORITY.LOW, `smoke_rm_${chunkKey}_${generation}`, generation);
            }
        }

        // Queue creations sorted by distance
        const chunksToCreate = [];
        for (const chunkKey of newNavChunks) {
            if (!oldNavChunks.has(chunkKey)) {
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

        // Safety-net sweep: catch chunks in radius that are loaded + completed but missing nav maps
        // Re-queues itself if some chunks aren't ready yet, up to a retry cap
        const MAX_SWEEP_RETRIES = 30;
        let sweepRetry = 0;
        const completedChunks = this.game?.chunkObjectGenerator?.completedChunks;

        const runSweep = () => {
            const playerChunkX = this.gameState.currentPlayerChunkX;
            const playerChunkZ = this.gameState.currentPlayerChunkZ;
            const gaps = [];
            let notReady = 0;
            for (let dx = -physicsRadius; dx <= physicsRadius; dx++) {
                for (let dz = -physicsRadius; dz <= physicsRadius; dz++) {
                    const gx = playerChunkX + dx;
                    const gz = playerChunkZ + dz;
                    const chunkKey = `${gx},${gz}`;
                    const chunkId = `chunk_${chunkKey}`;
                    if (this.game.navigationManager.getChunk(chunkId)) continue; // Already has nav map
                    if (!this.loadedChunks.has(chunkKey) || (completedChunks && !completedChunks.has(chunkKey))) {
                        notReady++;
                        continue;
                    }
                    gaps.push(chunkKey);
                    this.createNavMapForChunk(gx, gz);
                }
            }
            if (gaps.length > 0) {
                console.error(`[NavSweep] Fixed ${gaps.length} missing nav map(s): ${gaps.join(', ')}`);
            }
            // Re-queue if some chunks aren't ready yet and we haven't exceeded retries
            if (notReady > 0 && sweepRetry < MAX_SWEEP_RETRIES) {
                sweepRetry++;
                queue.queue(TASK_TYPE.NAV_MAP, runSweep, PRIORITY.LOW, null);
            }
        };

        queue.queueWithGeneration(TASK_TYPE.NAV_MAP, runSweep, PRIORITY.LOW, `nav_sweep_${generation}`, generation);
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
     * Clean up all AI entities whose home is in this chunk
     * Called when chunk leaves 3x3 physics radius
     */
    _cleanupAIInChunk(chunkKey) {
        // Bandits and Militia
        if (this.game?.banditController) {
            this.game.banditController.onChunkUnloaded(chunkKey);
        }
        // Bears
        if (this.game?.brownBearController) {
            this.game.brownBearController.onChunkUnloaded(chunkKey);
        }
        // Deer
        if (this.game?.deerController) {
            this.game.deerController.onChunkUnloaded(chunkKey);
        }
        // Workers (all inherit from BaseWorkerController)
        const workerControllers = [
            'woodcutterController', 'bakerController', 'gardenerController',
            'minerController', 'stoneMasonController', 'blacksmithController',
            'ironWorkerController', 'tileWorkerController', 'fishermanController'
        ];
        for (const name of workerControllers) {
            if (this.game?.[name]) {
                this.game[name].onChunkUnloaded(chunkKey);
            }
        }
    }

    /**
     * Clean up smoke effects for structures in this chunk
     * Called when chunk leaves 3x3 physics radius
     */
    _cleanupSmokeInChunk(chunkKey) {
        if (!this.game?.effectManager) return;

        const objects = this.chunkObjects.get(chunkKey);
        if (!objects) return;

        for (const obj of objects) {
            const modelType = obj.userData?.modelType;
            const objectId = obj.userData?.objectId;
            if (!objectId) continue;

            // Campfires have single smoke effect
            if (modelType === 'campfire') {
                this.game.effectManager.removeCampfireSmoke(objectId);
            }
            // Tileworks have two smoke effects (suffixed _1 and _2)
            else if (modelType === 'tileworks') {
                this.game.effectManager.removeCampfireSmoke(objectId + '_1');
                this.game.effectManager.removeCampfireSmoke(objectId + '_2');
            }
            // Houses and other structures with smoke
            else if (modelType === 'house' || modelType === 'ironworks' ||
                     modelType === 'blacksmith' || modelType === 'bakery' ||
                     modelType === 'fisherman') {
                this.game.effectManager.removeCampfireSmoke(objectId);
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
                    const isNatural = CONFIG.OBJECTS.NATURAL_TYPES.has(modelType);
                    const isStructure = CONFIG.OBJECTS.STRUCTURE_TYPES.has(modelType);

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

                    // Skip dock colliders - players should walk on docks, depth testing handles boat placement
                    if (modelType === 'dock') continue;

                    let shape, collisionGroup;

                    if (dims.radius !== undefined) {
                        // Cylindrical collider (trees, rocks, artillery, bear dens)
                        shape = {
                            type: 'cylinder',
                            radius: dims.radius,
                            height: dims.height || 1.0
                        };
                        // Determine collision group for cylindrical objects
                        if (modelType === 'artillery') {
                            collisionGroup = COLLISION_GROUPS.PLACED;
                        } else if (modelType === 'bearden') {
                            collisionGroup = COLLISION_GROUPS.STRUCTURE;
                        } else {
                            collisionGroup = COLLISION_GROUPS.NATURAL;
                        }
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

    }
}
/**
 * ChunkManager.js
 * Manages world chunks - loading, unloading, and object management
 */

import * as THREE from 'three';
import { CONFIG as TERRAIN_CONFIG, roundCoord } from '../terrain.js';
import { objectPlacer } from '../objects.js';
import { ui } from '../ui.js';

export class ChunkManager {
    constructor(gameState, terrainRenderer, scene, game = null) {
        this.gameState = gameState;
        this.terrainRenderer = terrainRenderer;
        this.scene = scene;
        this.game = game;
        this.loadRadius = TERRAIN_CONFIG.TERRAIN.renderDistance;
        this.chunkSize = TERRAIN_CONFIG.TERRAIN.chunkSize;
        this.pendingChunkCreations = []; // Queue for throttled chunk creation
        this.pendingChunkDisposals = []; // Queue for deferred chunk disposal
        this.pendingChunksAwaitingServerState = []; // Queue for chunks waiting for initial server state
        this.lastPlayerChunkX = 0;
        this.lastPlayerChunkZ = 0;
        this.movementDirectionX = 0;
        this.movementDirectionZ = 0;
        this.scheduleIdleCleanup();
    }

    updatePlayerChunk(playerX, playerZ) {
        const newChunkX = Math.floor(roundCoord(playerX) / this.chunkSize);
        const newChunkZ = Math.floor(roundCoord(playerZ) / this.chunkSize);

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

        this.gameState.updateChunkPosition(newChunkX, newChunkZ);
        this.updateChunksAroundPlayer(newChunkX, newChunkZ);
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

                if (!this.terrainRenderer.chunkMap.has(key)) {
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

        Array.from(this.terrainRenderer.chunkMap.keys()).forEach(key => {
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
        const startTime = performance.now();
        let attempts = 0;
        const maxAttempts = this.pendingChunkDisposals.length; // Prevent infinite loop

        while (this.pendingChunkDisposals.length > 0 && processed < batchSize && attempts < maxAttempts) {
            attempts++;
            const key = this.pendingChunkDisposals[0]; // PEEK at first item, don't remove yet

            // Check if chunk exists OR is still being processed OR in vertex queue
            const inChunkMap = this.terrainRenderer.chunkMap.has(key);
            const inProcessing = this.terrainRenderer.processingChunks.has(key);
            const inVertexQueue = this.terrainRenderer.pendingVertexUpdates.some(task => task.key === key);

            if (inChunkMap || inProcessing || inVertexQueue) {
                // Now we can remove it from queue and dispose
                this.pendingChunkDisposals.shift();
                this.disposeChunk(key);
                processed++;
            } else {
                // Chunk not found anywhere - might be truly stuck or already gone
                this.pendingChunkDisposals.shift(); // Remove it anyway
            }
        }
    }

    processChunkQueue() {
        // Process only 1 chunk per frame for smooth performance
        if (this.pendingChunkCreations.length > 0) {
            const chunk = this.pendingChunkCreations.shift();
            this.createChunk(chunk.gridX, chunk.gridZ);
            return true; // Chunk was created
        }
        return false; // No chunks to create
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
        const worldX = gridX * this.chunkSize;
        const worldZ = gridZ * this.chunkSize;
        const chunkKey = `${gridX},${gridZ}`;

        // ALWAYS ensure cache has an entry for this chunk (even if empty)
        if (!this.gameState.removedObjectsCache.has(chunkKey)) {
            this.gameState.removedObjectsCache.set(chunkKey, new Set());
        }

        // Get cached removals for this chunk (now guaranteed to be a Set)
        const removedIds = this.gameState.removedObjectsCache.get(chunkKey);

        // Pass removals to terrain renderer
        this.terrainRenderer.createChunk(worldX, worldZ, removedIds);
    }

    applyChunkRemovals(chunkKey) {
        const objects = this.terrainRenderer.chunkObjects.get(chunkKey);
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
        this.terrainRenderer.chunkObjects.set(chunkKey, keptObjects);
    }

    disposeChunk(key) {
        this.terrainRenderer.disposeChunk(key, this.game.physicsManager);
    }

    removeObject(objectId) {
        const object = objectPlacer.findObjectById(this.scene, objectId);
        console.log(`[ChunkManager] removeObject called for ${objectId}, found:`, !!object, 'chunkKey:', object?.userData?.chunkKey);
        console.log(`[ChunkManager] object position:`, object?.position, 'objectId breakdown:', objectId);
        if (object && object.userData.chunkKey) {
            const chunkKey = object.userData.chunkKey;
            console.log(`[ChunkManager] Adding ${objectId} to removedObjectsCache for chunkKey: ${chunkKey}`);

            // Add to cache
            if (!this.gameState.removedObjectsCache.has(chunkKey)) {
                this.gameState.removedObjectsCache.set(chunkKey, new Set());
            }
            this.gameState.removedObjectsCache.get(chunkKey).add(objectId);

            // Remove physics collider (always try - PhysicsManager tracks by objectId internally)
            if (this.game.physicsManager) {
                this.game.physicsManager.removeCollider(objectId);
            }

            // Remove from scene
            this.scene.remove(object);
            this.disposeObject(object);

            // Remove from chunkObjects array
            const objects = this.terrainRenderer.chunkObjects.get(chunkKey);
            if (objects) {
                const filteredObjects = objects.filter(obj => obj.userData.objectId !== objectId);
                this.terrainRenderer.chunkObjects.set(chunkKey, filteredObjects);
            }

            // Update nearest object if this was it
            if (this.gameState.nearestObject && this.gameState.nearestObject.id === objectId) {
                this.gameState.nearestObject = null;
                this.gameState.nearestObjectDistance = Infinity;
                ui.updateNearestObject(null, null, null, null, null);
                ui.updateButtonStates(this.gameState.isInChunk, null, null, null, false, false, false, null, this.gameState.isMoving, false);
            }
            return true;
        }
        return false;
    }

    disposeObject(object) {
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
}
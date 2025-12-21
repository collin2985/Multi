/**
 * NavigationManager.js
 * Coordinates navigation across multiple chunks for AI pathfinding and spatial queries
 *
 * Handles:
 * - Cross-chunk object queries (3×3 grid search)
 * - Chunk lifecycle (adding/removing chunks)
 * - Coordinated pathfinding across chunk boundaries (future)
 */

import * as THREE from 'three';
import { NAV_CONFIG } from './NavigationMap.js';
import ChunkCoordinates from '../core/ChunkCoordinates.js';

export class NavigationManager {
    /**
     * @param {PhysicsManager} physicsManager - Physics manager for spatial queries
     */
    constructor(physicsManager) {
        // Reference to physics manager for spatial queries
        this.physicsManager = physicsManager;

        // Map of all loaded navigation chunks
        // chunkId (e.g., "chunk_0,0") → ChunkNavigationMap
        this.chunkMaps = new Map();
    }

    /**
     * Register a chunk's navigation map
     * Call this when a chunk is loaded
     *
     * @param {string} chunkId - Chunk identifier (e.g., "chunk_0,0")
     * @param {ChunkNavigationMap} navMap - Navigation map for this chunk
     */
    addChunk(chunkId, navMap) {
        this.chunkMaps.set(chunkId, navMap);
    }

    /**
     * Unregister a chunk's navigation map
     * Call this when a chunk is unloaded
     *
     * @param {string} chunkId - Chunk identifier
     */
    removeChunk(chunkId) {
        this.chunkMaps.delete(chunkId);
    }

    /**
     * Get navigation map for a specific chunk
     *
     * @param {string} chunkId - Chunk identifier
     * @returns {ChunkNavigationMap|null} - Navigation map or null if not loaded
     */
    getChunk(chunkId) {
        return this.chunkMaps.get(chunkId) || null;
    }

    /**
     * Get 3×3 grid of chunks centered on a world position
     * Returns a fixed-size array of 9 chunks with null for missing chunks
     * Index 4 is always the center chunk
     *
     * @param {number} worldX - World X position
     * @param {number} worldZ - World Z position
     * @returns {Array<ChunkNavigationMap|null>} - Array of 9 navigation maps (null for unloaded chunks)
     */
    get3x3ChunkGrid(worldX, worldZ) {
        // Determine center chunk using unified system
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(worldX, worldZ);

        // Create fixed-size array with 9 slots
        const chunks = new Array(9);

        // Get 3×3 grid (center + 8 neighbors)
        const chunkIds = ChunkCoordinates.get3x3ChunkIds(chunkX, chunkZ);
        for (let i = 0; i < chunkIds.length; i++) {
            const navMap = this.chunkMaps.get(chunkIds[i]);
            chunks[i] = navMap || null; // Store null if chunk not loaded
        }

        return chunks;
    }

    /**
     * Find nearest object of a specific type using 3×3 chunk grid search
     * Searches AI's chunk + 8 neighbors to handle chunk boundaries correctly
     *
     * @param {number} worldX - Search center X
     * @param {number} worldZ - Search center Z
     * @param {string} objectType - Object type to find (e.g., "oak", "limestone")
     * @param {number} maxRadius - Maximum search radius in meters (default: 20)
     * @returns {object|null} - {id, type, x, z, distance, quality} or null if not found
     */
    findNearestObject(worldX, worldZ, objectType, maxRadius = 20) {
        if (!this.physicsManager || !this.physicsManager.querySphere) {
            console.warn('[NavigationManager] PhysicsManager not available for spatial queries');
            return null;
        }

        // Get 3×3 grid of chunks to search
        const chunksToSearch = this.get3x3ChunkGrid(worldX, worldZ).filter(c => c !== null);

        if (chunksToSearch.length === 0) {
            console.warn('[NavigationManager] No chunks loaded near position', worldX, worldZ);
            return null;
        }

        try {
            // Query PhysicsManager for all colliders within radius (fast BVH query)
            const center = { x: worldX, y: 0, z: worldZ };
            const colliders = this.physicsManager.querySphere(center, maxRadius);

            let nearestObject = null;
            let nearestDistance = Infinity;

            // Check each collider
            for (const collider of colliders) {
                const objectId = this.physicsManager.getObjectIdFromCollider(collider);
                if (!objectId) continue;

                // Search for metadata in 3×3 chunk grid
                let metadata = null;
                for (const navMap of chunksToSearch) {
                    metadata = navMap.objectMetadata.get(objectId);
                    if (metadata) break; // Found it!
                }

                // Skip if no metadata found or wrong type
                if (!metadata || metadata.type !== objectType) continue;

                // Calculate distance
                const translation = collider.translation();
                const dx = translation.x - worldX;
                const dz = translation.z - worldZ;
                const distance = Math.sqrt(dx * dx + dz * dz);

                // Check if this is closer than current nearest
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestObject = {
                        id: objectId,
                        type: metadata.type,
                        x: translation.x,
                        z: translation.z,
                        distance: distance,
                        quality: metadata.quality
                    };
                }
            }

            return nearestObject;

        } catch (error) {
            console.warn('[NavigationManager] Error in findNearestObject:', error);
            return null;
        }
    }

    /**
     * Find all objects within radius using 3×3 chunk grid search
     * Optionally filter by object type
     *
     * @param {number} worldX - Search center X
     * @param {number} worldZ - Search center Z
     * @param {number} radius - Search radius in meters
     * @param {string} objectType - Object type filter (null = all types)
     * @returns {Array} - Array of {id, type, x, z, distance, quality}, sorted by distance
     */
    findObjectsInRadius(worldX, worldZ, radius, objectType = null) {
        if (!this.physicsManager || !this.physicsManager.querySphere) {
            console.warn('[NavigationManager] PhysicsManager not available for spatial queries');
            return [];
        }

        // Get 3×3 grid of chunks to search
        const chunksToSearch = this.get3x3ChunkGrid(worldX, worldZ).filter(c => c !== null);

        if (chunksToSearch.length === 0) {
            return [];
        }

        const results = [];
        const center = { x: worldX, y: 0, z: worldZ };

        try {
            // Query PhysicsManager
            const colliders = this.physicsManager.querySphere(center, radius);

            for (const collider of colliders) {
                const objectId = this.physicsManager.getObjectIdFromCollider(collider);
                if (!objectId) continue;

                // Search for metadata in 3×3 chunk grid
                let metadata = null;
                for (const navMap of chunksToSearch) {
                    metadata = navMap.objectMetadata.get(objectId);
                    if (metadata) break;
                }

                if (!metadata) continue;

                // Filter by type if specified
                if (objectType && metadata.type !== objectType) continue;

                // Calculate distance
                const translation = collider.translation();
                const dx = translation.x - worldX;
                const dz = translation.z - worldZ;
                const distance = Math.sqrt(dx * dx + dz * dz);

                results.push({
                    id: objectId,
                    type: metadata.type,
                    x: translation.x,
                    z: translation.z,
                    distance: distance,
                    quality: metadata.quality
                });
            }

            // Sort by distance (closest first)
            results.sort((a, b) => a.distance - b.distance);
            return results;

        } catch (error) {
            console.warn('[NavigationManager] Error in findObjectsInRadius:', error);
            return [];
        }
    }

    /**
     * Check if a world position is walkable
     * Uses the appropriate chunk's navigation grid
     *
     * @param {number} worldX - World X position
     * @param {number} worldZ - World Z position
     * @returns {boolean} - True if walkable, false if blocked or chunk not loaded
     */
    isWalkable(worldX, worldZ) {
        // Determine which chunk this position is in using unified system
        const chunkId = ChunkCoordinates.worldToChunkId(worldX, worldZ);

        const navMap = this.chunkMaps.get(chunkId);
        if (!navMap) {
            return false; // Chunk not loaded = not walkable
        }

        // Convert to cell coordinates and check
        const { cellX, cellZ } = navMap.worldToCell(worldX, worldZ);
        return navMap.isWalkable(cellX, cellZ);
    }

    /**
     * Get movement cost at a world position
     * Uses the appropriate chunk's navigation grid
     *
     * @param {number} worldX - World X position
     * @param {number} worldZ - World Z position
     * @param {object} heightCalculator - Optional terrain height calculator
     * @returns {number} - Movement cost (Infinity if blocked/unloaded)
     */
    getMovementCost(worldX, worldZ, heightCalculator = null) {
        // Determine which chunk this position is in (centered chunks)
        const chunkId = ChunkCoordinates.worldToChunkId(worldX, worldZ);

        const navMap = this.chunkMaps.get(chunkId);
        if (!navMap) {
            return Infinity; // Chunk not loaded = infinite cost
        }

        // Convert to cell coordinates and get cost
        const { cellX, cellZ } = navMap.worldToCell(worldX, worldZ);
        return navMap.getMovementCost(cellX, cellZ, heightCalculator);
    }

    /**
     * Get movement speed multiplier at a world position (for actual movement)
     * Uses cached terrain data for performance (slopes, surface types, roads)
     *
     * Use this to apply terrain effects to player/AI movement speed:
     * - Slopes: 0° = 1.0x, 45° = 0.25x
     * - Surface: grass 1.0x, dirt 0.95x, sand 0.9x, rock 0.85x
     * - Roads: 1.3x bonus
     *
     * Performance: ~1-2 microseconds (cached data, no calculations)
     *
     * @param {number} worldX - World X position
     * @param {number} worldZ - World Z position
     * @returns {number} - Speed multiplier (0.0-1.3x, or 1.0 if chunk not loaded)
     */
    getMovementSpeedMultiplier(worldX, worldZ) {
        // Determine which chunk this position is in (centered chunks)
        // Add half chunk size to handle centered coordinate system correctly
        const chunkId = ChunkCoordinates.worldToChunkId(worldX, worldZ);

        const navMap = this.chunkMaps.get(chunkId);
        if (!navMap) {
            return 1.0; // Chunk not loaded = normal speed (graceful fallback)
        }

        // Get speed multiplier (uses cached slope + surface + road data)
        return navMap.getMovementSpeedMultiplier(worldX, worldZ);
    }

    /**
     * Check if a world position is on a road
     * @param {number} worldX - World X position
     * @param {number} worldZ - World Z position
     * @returns {boolean} - True if position is on a road
     */
    isOnRoad(worldX, worldZ) {
        const chunkId = ChunkCoordinates.worldToChunkId(worldX, worldZ);
        const navMap = this.chunkMaps.get(chunkId);
        if (!navMap) return false;

        const info = navMap.getMovementSpeedInfo(worldX, worldZ);
        return info?.onRoad ?? false;
    }

    /**
     * Get statistics about loaded navigation chunks
     * @returns {object} - {totalChunks, chunkIds: [...]}
     */
    getStats() {
        return {
            totalChunks: this.chunkMaps.size,
            chunkIds: Array.from(this.chunkMaps.keys())
        };
    }

    /**
     * Toggle debug visualization on/off
     * @returns {boolean} New debug state
     */
    toggleDebugVisualization() {
        this.debugEnabled = !this.debugEnabled;
        console.log('[NavigationDebug] Toggled debug visualization:', this.debugEnabled);

        // Clean up if disabling
        if (!this.debugEnabled && this.debugMeshes) {
            console.log('[NavigationDebug] Cleaning up', this.debugMeshes.size, 'debug meshes');
            this.debugMeshes.forEach(mesh => {
                if (this.scene) {
                    this.scene.remove(mesh);
                }
                if (mesh.geometry) mesh.geometry.dispose();
                if (mesh.material) mesh.material.dispose();
            });
            this.debugMeshes.clear();
        }

        return this.debugEnabled;
    }

    /**
     * Set scene reference for debug rendering
     * @param {THREE.Scene} scene
     */
    setScene(scene) {
        this.scene = scene;
        this.debugEnabled = false;
        this.debugMeshes = new Map();
        this.debugFrameCounter = 0;
    }

    /**
     * Render debug visualization of navigation grid
     */
    renderDebug() {
        if (!this.debugEnabled) {
            return;
        }
        if (!this.scene) {
            console.log('[NavigationDebug] No scene reference set!');
            return;
        }

        // Throttle to every 10th frame to reduce performance impact
        this.debugFrameCounter = (this.debugFrameCounter || 0) + 1;
        if (this.debugFrameCounter % 10 !== 0) return;

        // Get player position to determine which chunk to visualize
        // Try to get player from game object first
        let playerObj = null;
        if (window.game && window.game.playerObject) {
            playerObj = window.game.playerObject;
            // Removed spammy log: Got player from window.game.playerObject
        } else {
            // Fallback: try to find by name
            playerObj = this.scene.getObjectByName('player');
            if (!playerObj) {
                console.log('[NavigationDebug] No player object found! Tried window.game.playerObject and scene.getObjectByName("player")');
                return;
            }
        }

        const playerX = playerObj.position.x;
        const playerZ = playerObj.position.z;
        // Removed spammy log: Player position

        // Determine which chunk the player is in
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(playerX, playerZ);
        const chunkId = ChunkCoordinates.toChunkId(chunkX, chunkZ);

        // Only update if player moved to a different chunk
        if (this.lastDebugChunkId === chunkId) return;
        this.lastDebugChunkId = chunkId;
        console.log('[NavigationDebug] Player in chunk:', chunkId);

        // Clear old visualization
        console.log('[NavigationDebug] Clearing', this.debugMeshes.size, 'old debug meshes');
        this.debugMeshes.forEach(mesh => {
            this.scene.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
        });
        this.debugMeshes.clear();

        // Get navigation map for current chunk
        const navMap = this.chunkMaps.get(chunkId);
        if (!navMap) {
            console.log('[NavigationDebug] No navigation map for chunk:', chunkId);
            console.log('[NavigationDebug] Available chunks:', Array.from(this.chunkMaps.keys()));
            return;
        }
        console.log('[NavigationDebug] Found navigation map for chunk:', chunkId);

        // THREE is now imported at the top of the file
        console.log('[NavigationDebug] Creating visualization...');

        // Create debug visualization
        const cellSize = 0.5;
        const gridSize = 100;
        const sampleRate = 1; // Show every cell (no gaps)
        let meshCount = 0;
        let walkableCount = 0;
        let blockedCount = 0;
        let roadCount = 0;
        let uninitializedCount = 0;

        console.log('[NavigationDebug] Starting to create meshes (sample rate:', sampleRate, ')');
        for (let cellZ = 0; cellZ < gridSize; cellZ += sampleRate) {
            for (let cellX = 0; cellX < gridSize; cellX += sampleRate) {
                const index = cellZ * gridSize + cellX;
                const flags = navMap.grid[index];

                // Don't skip uninitialized - show them as blue
                // if (flags === 0) continue;

                const isWalkable = (flags & 1) !== 0;
                const isRoad = (flags & 2) !== 0;
                const isWater = (flags & 4) !== 0;

                // Calculate world position
                const worldX = navMap.worldOriginX + (cellX + 0.5) * cellSize;
                const worldZ = navMap.worldOriginZ + (cellZ + 0.5) * cellSize;

                // Fixed Y level at 3
                const worldY = 3;

                // Determine color
                let color;
                if (flags === 0) {
                    color = 0x0000ff; // Blue for uninitialized (PROBLEM!)
                    uninitializedCount++;
                    // These cells will block movement!
                } else if (!isWalkable || isWater) {
                    color = 0xff0000; // Red for blocked
                    blockedCount++;
                } else if (isRoad) {
                    color = 0xffff00; // Yellow for roads
                    roadCount++;
                } else {
                    color = 0x00ff00; // Green for walkable
                    walkableCount++;
                }

                // Create a simple plane for each cell
                const boxSize = cellSize * sampleRate * 0.8;
                const planeGeom = new THREE.PlaneGeometry(boxSize, boxSize);
                const material = new THREE.MeshBasicMaterial({
                    color: color,
                    transparent: true,
                    opacity: 0.3,
                    side: THREE.DoubleSide,
                    depthWrite: false
                });
                const mesh = new THREE.Mesh(planeGeom, material);
                mesh.position.set(worldX, worldY, worldZ);
                mesh.rotation.x = -Math.PI / 2;
                mesh.name = 'NavDebugCell';

                this.scene.add(mesh);
                this.debugMeshes.set(`${cellX}_${cellZ}`, mesh);
                meshCount++;
            }
        }

        console.log('[NavigationDebug] Created', meshCount, 'debug meshes');
        console.log('[NavigationDebug] - Walkable (green):', walkableCount);
        console.log('[NavigationDebug] - Blocked (red):', blockedCount);
        console.log('[NavigationDebug] - Roads (yellow):', roadCount);
        console.log('[NavigationDebug] - UNINITIALIZED (blue):', uninitializedCount, '⚠️ These block movement!');
        console.log('[NavigationDebug] Debug meshes stored:', this.debugMeshes.size);
    }

    /**
     * Rebuild navigation maps for a rectangular region across all affected chunks
     * Call this after terrain leveling to update navigation data
     *
     * @param {number} worldX - Center X of rectangle
     * @param {number} worldZ - Center Z of rectangle
     * @param {number} width - Rectangle width
     * @param {number} depth - Rectangle depth
     * @param {number} rotationDegrees - Rotation in degrees
     * @param {object} heightProvider - Object with getWorldHeight(x, z) method (usually terrainGenerator)
     * @returns {object} Statistics about updated chunks/cells
     */
    rebuildRegionForLeveledTerrain(worldX, worldZ, width, depth, rotationDegrees, heightProvider) {
        const rotationRad = rotationDegrees * Math.PI / 180;
        const halfWidth = width / 2;
        const halfDepth = depth / 2;
        const transitionSize = 1.0;

        // Calculate bounding box of the rotated rectangle
        const cosRAbs = Math.abs(Math.cos(rotationRad));
        const sinRAbs = Math.abs(Math.sin(rotationRad));
        const boundingHalfWidth = halfWidth * cosRAbs + halfDepth * sinRAbs;
        const boundingHalfDepth = halfWidth * sinRAbs + halfDepth * cosRAbs;

        // Find all chunks that might be affected
        const chunkSize = NAV_CONFIG.CHUNK_SIZE;
        const halfChunk = chunkSize / 2;
        const minChunkX = Math.floor((worldX - boundingHalfWidth - transitionSize + halfChunk) / chunkSize);
        const maxChunkX = Math.floor((worldX + boundingHalfWidth + transitionSize + halfChunk) / chunkSize);
        const minChunkZ = Math.floor((worldZ - boundingHalfDepth - transitionSize + halfChunk) / chunkSize);
        const maxChunkZ = Math.floor((worldZ + boundingHalfDepth + transitionSize + halfChunk) / chunkSize);

        let updatedChunks = 0;
        let totalUpdatedCells = 0;

        // Rebuild each affected chunk
        for (let cX = minChunkX; cX <= maxChunkX; cX++) {
            for (let cZ = minChunkZ; cZ <= maxChunkZ; cZ++) {
                const chunkId = `chunk_${cX},${cZ}`;
                const navMap = this.chunkMaps.get(chunkId);

                if (navMap) {
                    const updatedCells = navMap.rebuildRegion(
                        worldX,
                        worldZ,
                        width,
                        depth,
                        rotationRad,
                        heightProvider
                    );

                    if (updatedCells > 0) {
                        updatedChunks++;
                        totalUpdatedCells += updatedCells;
                    }
                }
            }
        }

        return {
            updatedChunks,
            totalUpdatedCells,
            affectedChunkRange: `(${minChunkX},${minChunkZ}) to (${maxChunkX},${maxChunkZ})`
        };
    }
}

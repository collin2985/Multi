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
import { NAV_CONFIG, NAV_FLAGS } from './NavigationMap.js';
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
        this.workerClient = null;

        // Track recently scanned areas to avoid duplicate scans
        this._recentScans = new Map();
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
        // Count walkable and obstacle cells for diagnostics
        let walkCount = 0, obstCount = 0;
        const g = navMap.grid;
        for (let i = 0; i < g.length; i++) {
            if (g[i] & 1) walkCount++;
            if (g[i] & 64) obstCount++;
        }
        if (this.workerClient) {
            this.workerClient.registerChunk(
                chunkId, navMap.chunkX, navMap.chunkZ,
                navMap.grid, navMap.worldOriginX, navMap.worldOriginZ,
                navMap.version || 0
            );
        }
    }

    /**
     * Unregister a chunk's navigation map
     * Call this when a chunk is unloaded
     *
     * @param {string} chunkId - Chunk identifier
     */
    removeChunk(chunkId) {
        this.chunkMaps.delete(chunkId);
        if (this.workerClient) {
            this.workerClient.unregisterChunk(chunkId);
        }
    }

    /**
     * Sync chunk grid data to worker after dynamic modifications
     * Call this after addRoad(), removeObstacle(), etc.
     *
     * @param {string} chunkId - Chunk identifier
     */
    syncChunkToWorker(chunkId) {
        const navMap = this.chunkMaps.get(chunkId);
        if (navMap && this.workerClient) {
            this.workerClient.updateChunkGrid(chunkId, navMap.grid);
        }
    }

    /**
     * Sync only changed cells to workers (memory-optimized)
     * Used by scanAreaWalkability to avoid sending full 40KB grids
     *
     * @param {string} chunkId - Chunk identifier
     * @param {Array<{index: number, flags: number}>} changes - Array of cell changes
     */
    syncChunkChangesToWorker(chunkId, changes) {
        if (this.workerClient && changes.length > 0) {
            this.workerClient.updateChunkCells(chunkId, changes);
        }
    }

    /**
     * Mark a world position as water in the navigation grid
     * Called by AI/player when they detect terrain height < 0.3
     *
     * @param {number} worldX - World X position
     * @param {number} worldZ - World Z position
     * @returns {boolean} - True if water was marked, false if chunk not loaded
     */
    markWater(worldX, worldZ) {
        const chunkId = ChunkCoordinates.worldToChunkId(worldX, worldZ);
        const navMap = this.chunkMaps.get(chunkId);
        if (!navMap) {
            return false;
        }

        const { cellX, cellZ } = navMap.worldToCell(worldX, worldZ);
        if (!navMap.isValidCell(cellX, cellZ)) {
            return false;
        }

        // Add WATER flag to this cell
        navMap.addCellFlags(cellX, cellZ, NAV_FLAGS.WATER);

        // Sync to pathfinding worker so future paths avoid this cell
        this.syncChunkToWorker(chunkId);

        return true;
    }

    /**
     * Scan a square area around a world position and proactively mark unwalkable cells.
     * Iterates in world space so chunk boundaries are handled naturally.
     *
     * @param {number} worldX - Center world X position
     * @param {number} worldZ - Center world Z position
     * @param {number} cellRadius - Half-width of scan area in cells (5 = 10x10 area)
     * @param {Function} getTerrainHeight - Function(x, z) returning terrain height
     */
    scanAreaWalkability(worldX, worldZ, cellRadius, getTerrainHeight) {
        if (!getTerrainHeight) return;

        // Skip if this area was scanned recently (2s cooldown)
        const scanKey = `${Math.floor(worldX / 2)},${Math.floor(worldZ / 2)}`;
        const now = Date.now();
        if (this._recentScans.get(scanKey) > now - 2000) {
            return;
        }
        this._recentScans.set(scanKey, now);

        const step = NAV_CONFIG.GRID_RESOLUTION; // 0.25m
        const startX = worldX - cellRadius * step;
        const startZ = worldZ - cellRadius * step;
        const slopeProbeOffset = 0.5;
        const slopeThreshold = 0.5;
        const waterThreshold = 0.3;
        const diameter = cellRadius * 2;

        // Track changes per chunk: Map<chunkId, Array<{index, flags}>>
        const chunkChanges = new Map();

        for (let dz = 0; dz < diameter; dz++) {
            const sz = startZ + dz * step;
            for (let dx = 0; dx < diameter; dx++) {
                const sx = startX + dx * step;

                const chunkId = ChunkCoordinates.worldToChunkId(sx, sz);
                const navMap = this.chunkMaps.get(chunkId);
                if (!navMap) continue;

                const { cellX, cellZ } = navMap.worldToCell(sx, sz);
                if (!navMap.isValidCell(cellX, cellZ)) continue;

                // Skip cells already marked as obstacle or water
                const flags = navMap.getCellFlags(cellX, cellZ);
                if (flags & (NAV_FLAGS.OBSTACLE | NAV_FLAGS.WATER)) continue;

                const h = getTerrainHeight(sx, sz);
                const index = navMap.cellToIndex(cellX, cellZ);
                const oldFlags = navMap.grid[index];

                if (h < waterThreshold) {
                    navMap.addCellFlags(cellX, cellZ, NAV_FLAGS.WATER);
                    const newFlags = navMap.grid[index];
                    if (oldFlags !== newFlags) {
                        if (!chunkChanges.has(chunkId)) chunkChanges.set(chunkId, []);
                        chunkChanges.get(chunkId).push({ index, flags: newFlags });
                    }
                    continue;
                }

                // Check slope via 4 cardinal samples
                const hN = getTerrainHeight(sx, sz - slopeProbeOffset);
                const hS = getTerrainHeight(sx, sz + slopeProbeOffset);
                const hE = getTerrainHeight(sx + slopeProbeOffset, sz);
                const hW = getTerrainHeight(sx - slopeProbeOffset, sz);
                const maxDiff = Math.max(
                    Math.abs(h - hN), Math.abs(h - hS),
                    Math.abs(h - hE), Math.abs(h - hW)
                );

                if (maxDiff > slopeThreshold) {
                    navMap.removeCellFlags(cellX, cellZ, NAV_FLAGS.WALKABLE);
                    navMap.addCellFlags(cellX, cellZ, NAV_FLAGS.OBSTACLE);
                    const newFlags = navMap.grid[index];
                    if (oldFlags !== newFlags) {
                        if (!chunkChanges.has(chunkId)) chunkChanges.set(chunkId, []);
                        chunkChanges.get(chunkId).push({ index, flags: newFlags });
                    }
                }
            }
        }

        // Send only changed cells to workers (much smaller than full grid sync)
        for (const [chunkId, changes] of chunkChanges) {
            this.syncChunkChangesToWorker(chunkId, changes);
        }
    }

    markSteepSlope(worldX, worldZ) {
        const chunkId = ChunkCoordinates.worldToChunkId(worldX, worldZ);
        const navMap = this.chunkMaps.get(chunkId);
        if (!navMap) return false;

        const { cellX, cellZ } = navMap.worldToCell(worldX, worldZ);
        if (!navMap.isValidCell(cellX, cellZ)) return false;

        if (navMap.getCellFlags(cellX, cellZ) & NAV_FLAGS.OBSTACLE) return false;

        navMap.removeCellFlags(cellX, cellZ, NAV_FLAGS.WALKABLE);
        navMap.addCellFlags(cellX, cellZ, NAV_FLAGS.OBSTACLE);
        this.syncChunkToWorker(chunkId);
        return true;
    }

    async initializeWorker() {
        try {
            const { PathfindingScheduler } = await import('./PathfindingScheduler.js');
            this.workerClient = new PathfindingScheduler();
            await this.workerClient.initialize();

            for (const [chunkId, navMap] of this.chunkMaps) {
                this.workerClient.registerChunk(
                    chunkId, navMap.chunkX, navMap.chunkZ,
                    navMap.grid, navMap.worldOriginX, navMap.worldOriginZ,
                    navMap.version || 0
                );
            }
        } catch (e) {
            console.error('[NavigationManager] Scheduler init failed, using sync fallback:', e);
        }
    }

    async findPathAsync(startX, startZ, goalX, goalZ, options = {}) {
        if (this.workerClient) {
            return this.workerClient.findPath(startX, startZ, goalX, goalZ, options);
        }
        // Fallback to sync - this shouldn't happen if worker is initialized
        console.warn('[NavigationManager] findPathAsync called but no workerClient, using sync fallback');
        const { findPath } = await import('./AStar.js');
        return findPath(this, startX, startZ, goalX, goalZ, options);
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
     * Check if a world position is passable ignoring slope
     * For AI that can traverse slopes (like baker) - only blocks on obstacles/water
     *
     * @param {number} worldX - World X position
     * @param {number} worldZ - World Z position
     * @returns {boolean} - True if passable, false if obstacle/water or chunk not loaded
     */
    isPassableIgnoreSlope(worldX, worldZ) {
        const chunkId = ChunkCoordinates.worldToChunkId(worldX, worldZ);
        const navMap = this.chunkMaps.get(chunkId);
        if (!navMap) {
            return false; // Chunk not loaded = not passable
        }
        const { cellX, cellZ } = navMap.worldToCell(worldX, worldZ);
        return navMap.isPassableIgnoreSlope(cellX, cellZ);
    }

    /**
     * Check if a world position is passable ignoring all obstacles (for force-return-home)
     * Only blocks on water - allows walking through steep slopes and structures
     *
     * @param {number} worldX - World X position
     * @param {number} worldZ - World Z position
     * @returns {boolean} - True if passable, false if water or chunk not loaded
     */
    isPassableIgnoreObstacles(worldX, worldZ) {
        const chunkId = ChunkCoordinates.worldToChunkId(worldX, worldZ);
        const navMap = this.chunkMaps.get(chunkId);
        if (!navMap) return false;
        const { cellX, cellZ } = navMap.worldToCell(worldX, worldZ);
        return navMap.isPassableIgnoreObstacles(cellX, cellZ);
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

        // Clean up if disabling
        if (!this.debugEnabled && this.debugMeshes) {
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

        // Clear old visualization
        this.debugMeshes.forEach(mesh => {
            this.scene.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
        });
        this.debugMeshes.clear();

        // Get navigation map for current chunk
        const navMap = this.chunkMaps.get(chunkId);
        if (!navMap) {
            return;
        }

        // THREE is now imported at the top of the file

        // Create debug visualization
        const cellSize = 0.5;
        const gridSize = 100;
        const sampleRate = 1; // Show every cell (no gaps)
        let meshCount = 0;
        let walkableCount = 0;
        let blockedCount = 0;
        let roadCount = 0;
        let uninitializedCount = 0;

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
    }
}

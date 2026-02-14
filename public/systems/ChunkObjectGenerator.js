/**
 * Frame-budgeted object generation system for smooth chunk loading
 * Spreads object generation across multiple frames to prevent stutters
 */

import { generateChunkObjectsBatch, MODEL_CONFIG, objectPlacer } from '../objects.js';
import { CONFIG } from '../TerrainConfig.js';
import { CONFIG as GAME_CONFIG } from '../config.js';
import { COLLISION_GROUPS } from '../core/PhysicsManager.js';
import { QualityGenerator } from '../core/QualityGenerator.js';
import { frameBudget } from '../core/FrameBudget.js';
import * as THREE from 'three';

// Bandit camp seed offset for deterministic generation
const BANDIT_SEED_OFFSET = 0xBAD1D;

// Brown bear den seed offset for deterministic generation
const BROWN_BEAR_SEED_OFFSET = 0xBEA12;

// Deer tree seed offset for deterministic generation
const DEER_TREE_SEED_OFFSET = 0xDE3E7;

class ChunkObjectGenerator {
    constructor(scene, terrainGenerator, gameState, chunkManager) {
        this.scene = scene;
        this.terrainGenerator = terrainGenerator;
        this.gameState = gameState;
        this.chunkManager = chunkManager;

        // Queue of chunks waiting for object generation
        this.queue = [];

        // Current chunk being processed
        this.currentChunk = null;

        // Progress tracking for current chunk
        this.currentProgress = {
            modelTypes: [],      // Array of model types to process
            typeIndex: 0,        // Current model type index
            objectIndex: 0,      // Current object index within type
            placedPositions: [], // Track positions for distance checking
            generatedObjects: [] // Objects generated so far
        };

        // Performance settings
        this.FRAME_BUDGET_MS = 3.0; // Max milliseconds per frame
        this.BATCH_SIZE = 30;     // Objects to attempt per batch

        // Track chunks where object generation has actually completed
        // Used by LoadingScreen to show accurate progress
        this.completedChunks = new Set();

        // Model types to generate (from objects.js)
        this.modelTypes = [
            'oak', 'fir', 'pine', 'cypress',
            'limestone', 'sandstone', 'clay',
            'iron', 'apple', 'log', 'vegetables', 'hemp'
        ];

        this.isProcessing = false;
    }

    /**
     * Queue a chunk for object generation
     */
    queueChunk(chunkData) {
        this.queue.push(chunkData);

        if (!this.isProcessing) {
            this.startProcessing();
        }
    }

    /**
     * Start processing the queue
     */
    startProcessing() {
        if (this.queue.length === 0 && !this.currentChunk) {
            this.isProcessing = false;
            return;
        }

        this.isProcessing = true;
        this.processNextFrame();
    }

    /**
     * Process object generation for one frame
     */
    processNextFrame() {
        if (!frameBudget.hasTime(0.5)) return;

        const frameStartTime = performance.now();
        const budget = Math.min(this.FRAME_BUDGET_MS, frameBudget.remaining());

        // Get next chunk if not currently processing one
        if (!this.currentChunk && this.queue.length > 0) {
            this.initializeNextChunk();
        }

        if (!this.currentChunk) {
            this.isProcessing = false;
            return;
        }

        // Process objects until frame budget is exhausted
        while (performance.now() - frameStartTime < budget) {
            if (!this.generateNextBatch()) {
                // Chunk complete
                this.finalizeCurrentChunk();
                break;
            }
        }

        // Don't use requestAnimationFrame - will be called from game loop
        // The game loop will call processNextFrame() every frame while isProcessing is true
    }

    /**
     * Initialize processing for the next chunk in queue
     */
    initializeNextChunk() {
        const chunkData = this.queue.shift();
        const { key, alignedChunkX, alignedChunkZ, removedObjectIds } = chunkData;

        // Check if chunk still exists
        if (!this.chunkManager.loadedChunks.has(key)) {
            this.currentChunk = null;
            return;
        }

        this.currentChunk = chunkData;

        // Gather neighbor positions for boundary checking
        const neighborPositions = this.getNeighborPositions(alignedChunkX, alignedChunkZ);

        // Build set of already added objects
        const addedObjectIds = new Set();
        const existingObjects = this.chunkManager.chunkObjects.get(key) || [];
        existingObjects.forEach(obj => {
            if (obj.userData?.objectId) {
                addedObjectIds.add(obj.userData.objectId);
            }
        });

        // Calculate chunk seed once
        const chunkSeed = this.calculateChunkSeed(alignedChunkX, alignedChunkZ);

        // Note: Bandit camp generation is now handled via server messages
        // See checkAndGenerateBanditCamp() called from MessageRouter

        // Initialize progress tracking
        this.currentProgress = {
            modelTypes: this.getActiveModelTypes(),
            typeIndex: 0,
            objectIndex: 0,
            placedPositions: neighborPositions.slice(), // Use slice() instead of spread (ISSUE-071)
            generatedObjects: [],
            removedObjectIds,
            addedObjectIds,
            chunkSeed: chunkSeed
        };
    }

    /**
     * Get model types that should be generated
     */
    getActiveModelTypes() {
        // Import MODEL_CONFIG from objects.js if available
        if (typeof MODEL_CONFIG !== 'undefined') {
            return Object.entries(MODEL_CONFIG)
                .filter(([type, config]) =>
                    config.category !== 'player' && config.density > 0)
                .map(([type]) => type);
        }
        return this.modelTypes;
    }

    /**
     * Calculate chunk-specific seed
     */
    calculateChunkSeed(worldX, worldZ) {
        const chunkSize = CONFIG.TERRAIN.chunkSize;
        const gridX = Math.floor(worldX / chunkSize);
        const gridZ = Math.floor(worldZ / chunkSize);
        return CONFIG.TERRAIN.seed + gridX * 73856093 + gridZ * 19349663;
    }

    /**
     * Generate next batch of objects
     * Returns false when chunk is complete
     */
    generateNextBatch() {
        const { key, alignedChunkX, alignedChunkZ, removedObjectIds } = this.currentChunk;
        const progress = this.currentProgress;

        // CRITICAL: Check if chunk was disposed mid-generation
        // This prevents orphaned objects/colliders when player moves quickly
        if (!this.chunkManager.loadedChunks.has(key)) {
            return false; // Abort - chunk no longer exists
        }

        // Check if we've processed all model types
        if (progress.typeIndex >= progress.modelTypes.length) {
            return false; // Chunk complete
        }

        const modelType = progress.modelTypes[progress.typeIndex];

        // Use the batch generation function from objects.js
        const result = generateChunkObjectsBatch(
            this.scene,
            this.terrainGenerator,
            alignedChunkX,
            alignedChunkZ,
            CONFIG.TERRAIN.seed,
            CONFIG.TERRAIN.chunkSize,
            modelType,
            progress.objectIndex,
            this.BATCH_SIZE,
            progress.removedObjectIds,
            progress.addedObjectIds,
            [...progress.placedPositions], // Pass copy of placed positions
            this.gameState,
            progress.chunkSeed,
            progress.placedPositions // Will be updated in place
        );

        // Store generated objects
        if (result.objects && result.objects.length > 0) {
            result.objects.forEach(obj => {
                progress.generatedObjects.push(obj);
            });

            // Add to scene
            this.addObjectsToScene(result.objects);
        }

        // Update progress
        progress.objectIndex = result.endIndex;

        // Move to next model type if done with current
        const config = MODEL_CONFIG[modelType] || { density: 0 };
        // Apply regional density modifier (must match objects.js calculation)
        const chunkSize = CONFIG.TERRAIN.chunkSize;
        const gridX = Math.floor(alignedChunkX / chunkSize);
        const gridZ = Math.floor(alignedChunkZ / chunkSize);
        const densityModifier = QualityGenerator.getDensityModifier(CONFIG.TERRAIN.seed, gridX, gridZ, modelType);
        const numObjects = Math.floor(500 * config.density * densityModifier);

        if (progress.objectIndex >= numObjects) {
            progress.typeIndex++;
            progress.objectIndex = 0;
        }

        return true; // More work to do
    }

    /**
     * Add objects to the scene
     */
    addObjectsToScene(objects) {
        objects.forEach(obj => {
            // Objects are already added to scene by the batch generation
            // Just register them with the object registry
            if (window.game?.objectRegistry && obj.userData?.objectId) {
                window.game.objectRegistry.set(obj.userData.objectId, obj);
            }
        });

    }

    /**
     * Finalize the current chunk
     */
    finalizeCurrentChunk() {
        const { key } = this.currentChunk;
        const objects = this.currentProgress.generatedObjects;

        // Check if chunk was disposed during generation - don't add orphaned objects
        if (!this.chunkManager.loadedChunks.has(key)) {
            // Clean up any objects that were already added to scene during generation
            if (objects.length > 0 && window.game?.physicsManager) {
                objects.forEach(obj => {
                    if (obj.userData?.objectId) {
                        window.game.physicsManager.removeCollider(obj.userData.objectId);
                        window.game.objectRegistry?.delete(obj.userData.objectId);
                    }
                    this.scene.remove(obj);
                });
            }
            this.currentChunk = null;
            this.currentProgress = {};
            if (this.queue.length === 0) {
                this.isProcessing = false;
            }
            return;
        }

        // Merge with existing objects (ISSUE-071: use push instead of spread)
        let allObjects = this.chunkManager.chunkObjects.get(key);
        if (!allObjects) {
            allObjects = objects;
        } else {
            // Push new objects to existing array instead of creating new array
            for (let i = 0; i < objects.length; i++) {
                allObjects.push(objects[i]);
            }
        }
        this.chunkManager.chunkObjects.set(key, allObjects);

        // Apply removals AFTER generation completes to handle teleport race condition:
        // When teleporting, server data may arrive while generation is in progress.
        // Objects generated before server data arrived need to be cleaned up here.
        this.chunkManager.applyChunkRemovals(key);

        // Mark dirt overlay for repaint to include newly generated objects
        if (window.game?.dirtOverlay) {
            window.game.dirtOverlay.markDirty();
        }

        // Create or update navigation map now that objects are ready
        if (window.game?.navigationManager && GAME_CONFIG?.CONSTRUCTION?.GRID_DIMENSIONS) {
            const chunkId = `chunk_${key}`;
            const navMap = window.game.navigationManager.getChunk(chunkId);
            if (navMap) {
                // Nav map was created by another path (deferred updates, etc.) — add obstacles and sync
                if (objects.length > 0) {
                    navMap.addObstaclesFromObjectList(objects, GAME_CONFIG.CONSTRUCTION.GRID_DIMENSIONS);
                }
                window.game.navigationManager.syncChunkToWorker(chunkId);
            } else {
                // Nav map doesn't exist yet — create it if chunk is within physics radius
                const [gx, gz] = key.split(',').map(Number);
                const physicsRadius = GAME_CONFIG.CHUNKS?.PHYSICS_RADIUS || 1;
                const playerChunkX = this.gameState.currentPlayerChunkX;
                const playerChunkZ = this.gameState.currentPlayerChunkZ;
                if (playerChunkX !== null && playerChunkZ !== null) {
                    const dx = Math.abs(gx - playerChunkX);
                    const dz = Math.abs(gz - playerChunkZ);
                    if (dx <= physicsRadius && dz <= physicsRadius) {
                        this.chunkManager.createNavMapForChunk(gx, gz);
                    }
                }
            }
        }

        // Mark chunk as completed for loading screen progress tracking
        this.completedChunks.add(key);

        // Create physics colliders for objects if chunk is within physics radius
        this.ensurePhysicsColliders(key, allObjects);

        // Register objects in objectRegistry immediately (don't wait for periodic refresh)
        if (window.game?.objectRegistry) {
            for (const obj of allObjects) {
                if (obj.userData?.objectId) {
                    window.game.objectRegistry.set(obj.userData.objectId, obj);
                }
            }
        }

        // Fix 3: Register apple trees in deerTreeStructuresByChunk for Baker AI
        if (this.gameState) {
            for (const obj of allObjects) {
                if (obj.userData?.modelType === 'apple' && obj.userData?.objectId) {
                    this.gameState.registerDeerTreeStructure(key, {
                        id: obj.userData.objectId,
                        position: {
                            x: obj.position.x,
                            y: obj.position.y,
                            z: obj.position.z
                        },
                        type: 'apple',
                        object: obj
                    });
                }
            }
        }

        // Clear current chunk
        this.currentChunk = null;
        this.currentProgress = {};

        // Check if more work
        if (this.queue.length > 0) {
            // Continue with next chunk
            return;
        }

        this.isProcessing = false;
    }

    /**
     * Ensure physics colliders exist for objects in a chunk if within physics radius
     * Also ensures objects are added to scene (fixes race condition with frame-budgeted generation)
     * Called after chunk generation completes
     */
    ensurePhysicsColliders(chunkKey, objects) {
        const physicsManager = window.game?.physicsManager;
        const scene = window.game?.scene;
        if (!physicsManager?.initialized) return;

        // Check if chunk is within physics radius
        const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
        const playerChunkX = this.gameState.currentPlayerChunkX;
        const playerChunkZ = this.gameState.currentPlayerChunkZ;

        // Must have valid numeric chunk position (null means not yet initialized)
        if (typeof playerChunkX !== 'number' || typeof playerChunkZ !== 'number') return;

        const physicsRadius = GAME_CONFIG.CHUNKS?.PHYSICS_RADIUS || 1;
        const chunkDistX = Math.abs(chunkX - playerChunkX);
        const chunkDistZ = Math.abs(chunkZ - playerChunkZ);

        const withinPhysicsRadius = chunkDistX <= physicsRadius && chunkDistZ <= physicsRadius;

        // Create colliders and ensure scene membership for objects
        for (const obj of objects) {
            if (!obj.userData?.objectId) continue;

            const modelType = obj.userData.modelType;
            if (modelType === 'dock') continue; // Skip dock colliders - players should walk on docks
            const dims = GAME_CONFIG.CONSTRUCTION?.GRID_DIMENSIONS?.[modelType];
            if (!dims) continue;

            // Ensure object is added to scene if within physics radius
            if (withinPhysicsRadius && scene && !obj.userData.addedToScene) {
                scene.add(obj);
                obj.userData.addedToScene = true;
            }

            // Skip collider creation if already has one or outside physics radius
            if (obj.userData.physicsHandle || !withinPhysicsRadius) continue;

            let shape, collisionGroup;

            if (dims.radius !== undefined) {
                shape = { type: 'cylinder', radius: dims.radius, height: dims.height || 1.0 };
                // Determine collision group for cylindrical objects
                if (modelType === 'artillery') {
                    collisionGroup = COLLISION_GROUPS.PLACED;
                } else if (modelType === 'bearden') {
                    collisionGroup = COLLISION_GROUPS.STRUCTURE;
                } else {
                    collisionGroup = COLLISION_GROUPS.NATURAL;
                }
            } else {
                shape = { type: 'cuboid', width: dims.width, depth: dims.depth, height: dims.height || 1.0 };
                collisionGroup = (modelType === 'log' || modelType.endsWith('_log') || modelType === 'crate')
                    ? COLLISION_GROUPS.PLACED
                    : COLLISION_GROUPS.STRUCTURE;
            }

            // Queue collider for batched creation (ISSUE-068)
            physicsManager.queueCollider(
                obj.userData.objectId,
                shape,
                obj.position,
                obj.rotation?.y || 0,
                collisionGroup,
                obj  // Target object to attach physicsHandle
            );
        }
    }

    // =========================================================================
    // NEIGHBOR POSITION HELPERS
    // =========================================================================

    /**
     * Get positions from neighboring chunks for boundary checking
     */
    getNeighborPositions(chunkX, chunkZ) {
        const positions = [];
        const chunkSize = CONFIG.TERRAIN.chunkSize;
        const gridX = chunkX / chunkSize;
        const gridZ = chunkZ / chunkSize;

        // Maximum distance we need to check (largest minDistance in config)
        const maxCheckDistance = 2.5;

        // Check all 8 neighboring chunks
        const neighbors = [
            [gridX - 1, gridZ],     // West
            [gridX + 1, gridZ],     // East
            [gridX, gridZ - 1],     // North
            [gridX, gridZ + 1],     // South
            [gridX - 1, gridZ - 1], // Northwest
            [gridX + 1, gridZ - 1], // Northeast
            [gridX - 1, gridZ + 1], // Southwest
            [gridX + 1, gridZ + 1]  // Southeast
        ];

        for (const [nx, nz] of neighbors) {
            const neighborKey = `${nx},${nz}`;
            const neighborObjects = this.chunkManager.chunkObjects.get(neighborKey);

            if (!neighborObjects) continue;

            for (const obj of neighborObjects) {
                const pos = obj.position;
                const userData = obj.userData;

                const distToChunk = this.getDistanceToChunkBoundary(pos.x, pos.z, chunkX, chunkZ, chunkSize);

                if (distToChunk <= maxCheckDistance) {
                    const modelType = userData.modelType;
                    const minDistance = this.getMinDistanceForModel(modelType);

                    positions.push({
                        x: pos.x,
                        z: pos.z,
                        minDistance: minDistance
                    });
                }
            }
        }

        return positions;
    }

    /**
     * Calculate minimum distance to chunk boundary
     */
    getDistanceToChunkBoundary(x, z, chunkX, chunkZ, chunkSize) {
        const halfSize = chunkSize / 2;
        const chunkMinX = chunkX - halfSize;
        const chunkMaxX = chunkX + halfSize;
        const chunkMinZ = chunkZ - halfSize;
        const chunkMaxZ = chunkZ + halfSize;

        const distToWest = Math.abs(x - chunkMinX);
        const distToEast = Math.abs(x - chunkMaxX);
        const distToNorth = Math.abs(z - chunkMinZ);
        const distToSouth = Math.abs(z - chunkMaxZ);

        return Math.min(distToWest, distToEast, distToNorth, distToSouth);
    }

    /**
     * Get minDistance config for a model type
     */
    getMinDistanceForModel(modelType) {
        const defaultMinDistances = {
            oak: 2.0, fir: 2.0, pine: 2.0, cypress: 2.0, apple: 2.0,
            log: 2.0, oak_log: 2.0, pine_log: 2.0, fir_log: 2.0, cypress_log: 2.0, apple_log: 2.0,
            limestone: 2.0, sandstone: 2.0, clay: 2.0, iron: 2.0, vegetables: 1.0
        };
        return defaultMinDistances[modelType] || 0;
    }

    // =========================================================================
    // BANDIT CAMP GENERATION
    // =========================================================================

    /**
     * Check if a chunk should have a bandit camp
     * Spawns on land chunks anywhere on the map, 1 in N probability
     */
    isBanditChunk(chunkX, chunkZ) {
        // Check if bandit camps are enabled
        if (!GAME_CONFIG.BANDIT_CAMPS?.ENABLED) return false;

        // Need terrainGenerator to check if chunk is on land
        if (!this.terrainGenerator) return false;

        // Check if chunk center is on land using continent mask
        const chunkSize = CONFIG.TERRAIN.chunkSize;
        const centerX = chunkX * chunkSize;
        const centerZ = chunkZ * chunkSize;

        // Require continent mask > 0.8 (solidly on land, not in transition zone)
        const continentMask = this.terrainGenerator.getContinentMask(centerX, centerZ);
        if (continentMask < 0.8) return false;

        // FNV-1a hash for deterministic probability selection
        let hash = 0x811c9dc5;
        hash ^= (chunkX & 0xFFFF);
        hash = Math.imul(hash, 0x01000193) >>> 0;
        hash ^= (chunkZ & 0xFFFF);
        hash = Math.imul(hash, 0x01000193) >>> 0;

        const probability = GAME_CONFIG.BANDIT_CAMPS?.CHUNK_PROBABILITY || 3;
        return (hash % probability) === 0;
    }

    /**
     * Check if a chunk should have a brown bear den
     */
    isBrownBearDenChunk(chunkX, chunkZ) {
        if (!GAME_CONFIG.BROWN_BEAR?.ENABLED) return false;
        if (!this.terrainGenerator) return false;

        const chunkSize = CONFIG.TERRAIN.chunkSize;
        const centerX = chunkX * chunkSize;
        const centerZ = chunkZ * chunkSize;

        // Require continent mask > 0.8 (solidly on land)
        const continentMask = this.terrainGenerator.getContinentMask(centerX, centerZ);
        if (continentMask < 0.8) return false;

        // FNV-1a hash with different offset than bandits
        let hash = 0x811c9dc5;
        hash ^= ((chunkX + 7919) & 0xFFFF);  // Offset to get different distribution
        hash = Math.imul(hash, 0x01000193) >>> 0;
        hash ^= ((chunkZ + 7919) & 0xFFFF);
        hash = Math.imul(hash, 0x01000193) >>> 0;

        const probability = GAME_CONFIG.BROWN_BEAR?.CHUNK_PROBABILITY || 5;
        return (hash % probability) === 0;
    }

    /**
     * Create a seeded random number generator
     */
    createSeededRNG(seed) {
        let s = seed >>> 0;
        return function() {
            s = Math.imul(s ^ (s >>> 15), 1 | s) >>> 0;
            s = (s + Math.imul(s ^ (s >>> 7), 61 | s)) >>> 0;
            return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
        };
    }

    /**
     * Generate bandit camp structures for a chunk
     * Returns array of structure data to be created
     */
    generateBanditCamp(chunkX, chunkZ, chunkSeed, existingPositions = []) {
        const config = GAME_CONFIG.BANDIT_CAMPS;
        if (!config?.ENABLED) return [];

        // Create deterministic RNG for this chunk's bandit camp
        const rng = this.createSeededRNG(chunkSeed + BANDIT_SEED_OFFSET);

        const structures = [];
        const placedPositions = [...existingPositions];

        // Camp center is chunk center
        const chunkSize = CONFIG.TERRAIN.chunkSize;
        const campCenterX = chunkX * chunkSize;
        const campCenterZ = chunkZ * chunkSize;

        // 1. Always place campfire at center
        const campfirePos = this.findValidBanditPosition(
            campCenterX, campCenterZ, 0, placedPositions, rng
        );
        if (campfirePos) {
            structures.push({
                type: 'campfire',
                position: campfirePos,
                rotation: rng() * Math.PI * 2,
                isBanditStructure: true,
                isDecorative: true,  // Campfire doesn't spawn bandits
                id: `bandit_campfire_${chunkX},${chunkZ}_0`
            });
            placedPositions.push({ x: campfirePos.x, z: campfirePos.z, radius: 2 });
        }

        // 2. Place 1-3 tents
        const numTents = config.MIN_TENTS + Math.floor(rng() * (config.MAX_TENTS - config.MIN_TENTS + 1));
        for (let i = 0; i < numTents; i++) {
            const tentPos = this.findValidBanditPosition(
                campCenterX, campCenterZ, config.PLACEMENT_RADIUS_TIERS, placedPositions, rng
            );
            if (tentPos) {
                structures.push({
                    type: 'tent',
                    position: tentPos,
                    rotation: rng() * Math.PI * 2,
                    isBanditStructure: true,
                    id: `bandit_tent_${chunkX},${chunkZ}_${i}`
                });
                placedPositions.push({ x: tentPos.x, z: tentPos.z, radius: 3 });
            }
        }

        // 3. Place 0-2 outposts
        const numOutposts = config.MIN_OUTPOSTS + Math.floor(rng() * (config.MAX_OUTPOSTS - config.MIN_OUTPOSTS + 1));
        for (let i = 0; i < numOutposts; i++) {
            const outpostPos = this.findValidBanditPosition(
                campCenterX, campCenterZ, config.PLACEMENT_RADIUS_TIERS, placedPositions, rng
            );
            if (outpostPos) {
                structures.push({
                    type: 'outpost',
                    position: outpostPos,
                    rotation: rng() * Math.PI * 2,
                    isBanditStructure: true,
                    id: `bandit_outpost_${chunkX},${chunkZ}_${i}`
                });
                placedPositions.push({ x: outpostPos.x, z: outpostPos.z, radius: 2 });
            }
        }

        // 4. Place 1 horse per camp (near campfire)
        const horsePos = this.findValidBanditPosition(
            campCenterX, campCenterZ, [3, 5], placedPositions, rng
        );
        if (horsePos) {
            // Horse faces toward campfire (camp center)
            const angleToCenter = Math.atan2(campCenterZ - horsePos.z, campCenterX - horsePos.x);
            structures.push({
                type: 'horse',
                position: horsePos,
                rotation: angleToCenter,
                isBanditStructure: true,
                id: `bandit_horse_${chunkX},${chunkZ}_0`
            });
            placedPositions.push({ x: horsePos.x, z: horsePos.z, radius: 2 });
        }

        return structures;
    }

    /**
     * Find a valid position for a bandit structure
     * Uses expanding radius tiers with collision avoidance
     */
    findValidBanditPosition(centerX, centerZ, radiusTiers, placedPositions, rng) {
        // Fail safe: can't validate positions without terrain data
        if (!this.terrainGenerator) {
            console.warn('[BanditCamp] terrainGenerator not available, skipping position');
            return null;
        }

        const config = GAME_CONFIG.BANDIT_CAMPS;
        const attemptsPerTier = config?.PLACEMENT_ATTEMPTS_PER_TIER || 8;
        const minSeparation = config?.MIN_STRUCTURE_SEPARATION || 4;

        // Handle single radius (for campfire at center)
        const tiers = Array.isArray(radiusTiers) ? radiusTiers : [radiusTiers];

        for (const radius of tiers) {
            for (let attempt = 0; attempt < attemptsPerTier; attempt++) {
                const angle = rng() * Math.PI * 2;
                const dist = radius > 0 ? radius * (0.8 + rng() * 0.4) : 0;

                const x = centerX + Math.cos(angle) * dist;
                const z = centerZ + Math.sin(angle) * dist;

                // Check collision with placed structures
                let valid = true;
                for (const placed of placedPositions) {
                    const dx = x - placed.x;
                    const dz = z - placed.z;
                    const distSq = dx * dx + dz * dz;
                    const minDistSq = (minSeparation + (placed.radius || 0)) ** 2;

                    if (distSq < minDistSq) {
                        valid = false;
                        break;
                    }
                }

                if (valid) {
                    // Snap to 0.25 grid like player-placed structures
                    const snappedX = Math.round(x / 0.25) * 0.25;
                    const snappedZ = Math.round(z / 0.25) * 0.25;

                    // Get terrain height at this position
                    const y = this.terrainGenerator.getWorldHeight(snappedX, snappedZ);

                    // Skip positions near water (require height >= 1 to avoid shoreline)
                    if (y < 1) {
                        continue; // Try another position
                    }

                    return { x: snappedX, y, z: snappedZ };
                }
            }
        }

        return null; // Could not find valid position
    }

    /**
     * Find a valid position for a bear den
     * Uses expanding radius with water check and collision avoidance
     */
    findValidBearDenPosition(centerX, centerZ, radiusTiers, placedPositions, rng) {
        if (!this.terrainGenerator) {
            return null;
        }

        const attemptsPerTier = 8;
        const minSeparation = 2;  // Bear dens need less separation than bandit camps
        const tiers = Array.isArray(radiusTiers) ? radiusTiers : [radiusTiers];

        for (const radius of tiers) {
            for (let attempt = 0; attempt < attemptsPerTier; attempt++) {
                const angle = rng() * Math.PI * 2;
                const dist = radius > 0 ? radius * (0.8 + rng() * 0.4) : 0;

                const x = centerX + Math.cos(angle) * dist;
                const z = centerZ + Math.sin(angle) * dist;

                // Check collision with existing structures
                let valid = true;
                for (const placed of placedPositions) {
                    const dx = x - placed.x;
                    const dz = z - placed.z;
                    const distSq = dx * dx + dz * dz;
                    const minDistSq = (minSeparation + (placed.radius || 0)) ** 2;

                    if (distSq < minDistSq) {
                        valid = false;
                        break;
                    }
                }

                if (valid) {
                    const snappedX = Math.round(x / 0.25) * 0.25;
                    const snappedZ = Math.round(z / 0.25) * 0.25;
                    const y = this.terrainGenerator.getWorldHeight(snappedX, snappedZ);

                    // Skip positions near water (require height >= 1 to avoid shoreline)
                    if (y < 1) {
                        continue;
                    }

                    return { x: snappedX, y, z: snappedZ };
                }
            }
        }

        return null;
    }

    /**
     * Check and generate bandit camp for a chunk based on server data
     * Called from MessageRouter after receiving chunk_objects_state
     * @param {string} chunkId - e.g., "chunk_-2,0"
     * @param {Array} objectChanges - Objects from server
     * @param {object} networkManager - For sending placement messages
     * @param {object} structureManager - For validation (optional)
     */
    checkAndGenerateBanditCamp(chunkId, objectChanges, networkManager, structureManager = null) {
        // Parse chunk grid coordinates from chunkId (e.g., "chunk_-2,0" -> -2, 0)
        const match = chunkId.match(/chunk_(-?\d+),(-?\d+)/);
        if (!match) {
            return;
        }

        const chunkGridX = parseInt(match[1], 10);
        const chunkGridZ = parseInt(match[2], 10);

        // Check if this is a bandit chunk
        const isBandit = this.isBanditChunk(chunkGridX, chunkGridZ);
        if (!isBandit) return;

        // Check if bandit structures already exist in server data
        const banditStructuresFound = objectChanges.filter(change =>
            change.action === 'add' && change.isBanditStructure
        );
        if (banditStructuresFound.length > 0) {
            return;
        }

        // Check for removed bandit structures (player destroyed them)
        const removedBanditIds = objectChanges
            .filter(c => c.action === 'remove' && c.id?.startsWith('bandit_'))
            .map(c => c.id);
        const destroyedIds = new Set(removedBanditIds);

        // Calculate chunk seed
        const chunkSize = CONFIG.TERRAIN.chunkSize;
        const worldX = chunkGridX * chunkSize;
        const worldZ = chunkGridZ * chunkSize;
        const chunkSeed = this.calculateChunkSeed(worldX, worldZ);

        // Get existing object positions for collision avoidance
        const existingPositions = objectChanges
            .filter(c => c.action === 'add' && c.position)
            .map(c => ({ x: c.position[0], z: c.position[2], radius: 3 }));

        // Generate camp data
        const campData = this.generateBanditCamp(chunkGridX, chunkGridZ, chunkSeed, existingPositions);

        // Send placement messages for each structure
        for (const structureData of campData) {
            // Skip if this structure was destroyed by a player
            if (destroyedIds.has(structureData.id)) {
                continue;
            }

            // Skip player-based validation for bandit structures (they're procedurally placed)
            // The placement positions are already validated by findValidBanditPosition()

            // Send appropriate placement message based on structure type
            const position = [structureData.position.x, structureData.position.y, structureData.position.z];
            const rotation = structureData.rotation; // Already in radians

            if (structureData.type === 'tent') {
                networkManager.sendMessage('place_tent', {
                    position: position,
                    rotation: rotation,
                    materialQuality: 30,  // Low quality bandit construction
                    isBanditStructure: true,
                    objectId: structureData.id
                });
            } else if (structureData.type === 'campfire') {
                networkManager.sendMessage('place_campfire', {
                    position: position,
                    rotation: rotation,
                    materialQuality: 30,
                    isBanditStructure: true,
                    objectId: structureData.id
                });
            } else if (structureData.type === 'outpost') {
                networkManager.sendMessage('place_outpost', {
                    position: position,
                    rotation: rotation,
                    materialQuality: 30,
                    isBanditStructure: true,
                    objectId: structureData.id
                });
            } else if (structureData.type === 'horse') {
                networkManager.sendMessage('place_horse', {
                    position: position,
                    rotation: rotation,
                    materialQuality: 30,
                    isBanditStructure: true,
                    objectId: structureData.id
                });
            }
        }
    }

    /**
     * Generate brown bear den for a chunk
     * Returns array with single den structure
     */
    generateBrownBearDen(chunkX, chunkZ, chunkSeed, existingPositions = []) {
        if (!GAME_CONFIG.BROWN_BEAR?.ENABLED) return [];

        const rng = this.createSeededRNG(chunkSeed + BROWN_BEAR_SEED_OFFSET);
        const chunkSize = CONFIG.TERRAIN.chunkSize;
        const centerX = chunkX * chunkSize;
        const centerZ = chunkZ * chunkSize;

        // Find valid position using tiered radius with water/collision checks
        const pos = this.findValidBearDenPosition(
            centerX, centerZ,
            [5, 10, 15],  // Try close first, then expand
            existingPositions,
            rng
        );

        if (!pos) return [];  // No valid position found

        return [{
            type: 'bearden',
            id: `bearden_${chunkX},${chunkZ}`,
            position: pos,
            rotation: rng() * Math.PI * 2,
            isBrownBearStructure: true
        }];
    }

    /**
     * Check and generate brown bear den for a chunk
     */
    checkAndGenerateBrownBearDen(chunkId, objectChanges, networkManager) {
        const match = chunkId.match(/chunk_(-?\d+),(-?\d+)/);
        if (!match) return;

        const chunkGridX = parseInt(match[1], 10);
        const chunkGridZ = parseInt(match[2], 10);

        if (!this.isBrownBearDenChunk(chunkGridX, chunkGridZ)) return;

        // Check if den already exists
        const densFound = objectChanges.filter(change =>
            change.action === 'add' && change.isBrownBearStructure
        );
        if (densFound.length > 0) return;

        // Check for removed dens
        const removedIds = objectChanges
            .filter(c => c.action === 'remove' && c.id?.startsWith('bearden_'))
            .map(c => c.id);
        const destroyedIds = new Set(removedIds);

        const chunkSize = CONFIG.TERRAIN.chunkSize;
        const worldX = chunkGridX * chunkSize;
        const worldZ = chunkGridZ * chunkSize;
        const chunkSeed = this.calculateChunkSeed(worldX, worldZ);

        const denData = this.generateBrownBearDen(chunkGridX, chunkGridZ, chunkSeed, []);

        for (const structureData of denData) {
            if (destroyedIds.has(structureData.id)) continue;

            const position = [structureData.position.x, structureData.position.y, structureData.position.z];

            networkManager.sendMessage('place_bearden', {
                position: position,
                rotation: structureData.rotation, // Already in radians
                materialQuality: 30,
                isBrownBearStructure: true,
                objectId: structureData.id
            });
        }
    }

    // =========================================================================
    // DEER TREE GENERATION (structure-based deer spawning)
    // =========================================================================

    /**
     * Check if a chunk should have a deer tree
     */
    isDeerTreeChunk(chunkX, chunkZ) {
        if (!GAME_CONFIG.DEER_TREE?.ENABLED) return false;
        if (!this.terrainGenerator) return false;

        const chunkSize = CONFIG.TERRAIN.chunkSize;
        const centerX = chunkX * chunkSize;
        const centerZ = chunkZ * chunkSize;

        // Require continent mask > 0.8 (solidly on land)
        const continentMask = this.terrainGenerator.getContinentMask(centerX, centerZ);
        if (continentMask < 0.8) return false;

        // FNV-1a hash with different offset than bandits/bears
        let hash = 0x811c9dc5;
        hash ^= ((chunkX + 13331) & 0xFFFF);  // Offset to get different distribution
        hash = Math.imul(hash, 0x01000193) >>> 0;
        hash ^= ((chunkZ + 13331) & 0xFFFF);
        hash = Math.imul(hash, 0x01000193) >>> 0;

        const probability = GAME_CONFIG.DEER_TREE?.CHUNK_PROBABILITY || 1;
        return (hash % probability) === 0;
    }

    /**
     * Find a valid position for a deer tree
     * Uses expanding radius with water check and collision avoidance
     */
    findValidDeerTreePosition(centerX, centerZ, radiusTiers, placedPositions, rng) {
        if (!this.terrainGenerator) {
            return null;
        }

        const attemptsPerTier = 8;
        const minSeparation = 2;
        const tiers = Array.isArray(radiusTiers) ? radiusTiers : [radiusTiers];

        for (const radius of tiers) {
            for (let attempt = 0; attempt < attemptsPerTier; attempt++) {
                const angle = rng() * Math.PI * 2;
                const dist = radius > 0 ? radius * (0.8 + rng() * 0.4) : 0;

                const x = centerX + Math.cos(angle) * dist;
                const z = centerZ + Math.sin(angle) * dist;

                // Check collision with existing structures
                let valid = true;
                for (const placed of placedPositions) {
                    const dx = x - placed.x;
                    const dz = z - placed.z;
                    const distSq = dx * dx + dz * dz;
                    const minDistSq = (minSeparation + (placed.radius || 0)) ** 2;

                    if (distSq < minDistSq) {
                        valid = false;
                        break;
                    }
                }

                if (valid) {
                    const snappedX = Math.round(x / 0.25) * 0.25;
                    const snappedZ = Math.round(z / 0.25) * 0.25;
                    const y = this.terrainGenerator.getWorldHeight(snappedX, snappedZ);

                    // Skip positions outside valid height range (4-22)
                    // Below 4 = too close to water, above 22 = mountains
                    if (y < 4 || y > 22) {
                        continue;
                    }

                    return { x: snappedX, y, z: snappedZ };
                }
            }
        }

        return null;
    }

    /**
     * Generate deer tree for a chunk
     * Returns array with single tree structure (uses pine model)
     */
    generateDeerTree(chunkX, chunkZ, chunkSeed, existingPositions = []) {
        if (!GAME_CONFIG.DEER_TREE?.ENABLED) return [];

        const rng = this.createSeededRNG(chunkSeed + DEER_TREE_SEED_OFFSET);
        const chunkSize = CONFIG.TERRAIN.chunkSize;
        const centerX = chunkX * chunkSize;
        const centerZ = chunkZ * chunkSize;

        // Find valid position using tiered radius with water/collision checks
        const pos = this.findValidDeerTreePosition(
            centerX, centerZ,
            [5, 10, 15, 20],  // Try close first, then expand
            existingPositions,
            rng
        );

        if (!pos) return [];  // No valid position found

        return [{
            type: 'deertree',
            id: `deertree_${chunkX},${chunkZ}`,
            position: pos,
            rotation: rng() * Math.PI * 2,
            isDeerTreeStructure: true
        }];
    }

    /**
     * Check and generate deer tree for a chunk
     */
    checkAndGenerateDeerTree(chunkId, objectChanges, networkManager) {
        const match = chunkId.match(/chunk_(-?\d+),(-?\d+)/);
        if (!match) return;

        const chunkGridX = parseInt(match[1], 10);
        const chunkGridZ = parseInt(match[2], 10);

        if (!this.isDeerTreeChunk(chunkGridX, chunkGridZ)) return;

        // Check if deer tree already exists
        const treesFound = objectChanges.filter(change =>
            change.action === 'add' && change.isDeerTreeStructure
        );
        if (treesFound.length > 0) return;

        // Check for removed trees
        const removedIds = objectChanges
            .filter(c => c.action === 'remove' && c.id?.startsWith('deertree_'))
            .map(c => c.id);
        const destroyedIds = new Set(removedIds);

        const chunkSize = CONFIG.TERRAIN.chunkSize;
        const worldX = chunkGridX * chunkSize;
        const worldZ = chunkGridZ * chunkSize;
        const chunkSeed = this.calculateChunkSeed(worldX, worldZ);

        const treeData = this.generateDeerTree(chunkGridX, chunkGridZ, chunkSeed, []);

        for (const structureData of treeData) {
            if (destroyedIds.has(structureData.id)) continue;

            const position = [structureData.position.x, structureData.position.y, structureData.position.z];

            networkManager.sendMessage('place_deertree', {
                position: position,
                rotation: structureData.rotation, // Already in radians
                materialQuality: 100,
                isDeerTreeStructure: true,
                objectId: structureData.id
            });
        }
    }
}

/**
 * Deferred dirt painting queue system
 * Paints dirt around objects over multiple frames
 */
class DirtPaintingQueue {
    constructor(terrain) {
        this.terrain = terrain;
        this.queue = []; // Array of {position, modelType, rotation, chunkKey}
        this.isProcessing = false;

        // Performance settings
        this.OBJECTS_PER_FRAME = 5;  // Paint 5 objects per frame
        this.FRAME_BUDGET_MS = 3;    // Max 3ms per frame
    }

    /**
     * Queue objects from a chunk for dirt painting
     */
    queueChunkObjects(chunkKey, objects) {
        for (const obj of objects) {
            const modelType = obj.userData?.modelType || obj.modelType;
            if (!modelType) continue;

            // Check if this object type gets dirt
            const dims = GAME_CONFIG.CONSTRUCTION?.GRID_DIMENSIONS?.[modelType];
            if (!dims || (dims.radius === undefined && dims.width === undefined)) continue;

            // Skip excluded types
            const excludeFromDirtPainting = ['dock', 'ship', 'campfire', 'tent', 'wall'];
            if (excludeFromDirtPainting.includes(modelType)) continue;

            this.queue.push({
                position: obj.position,
                modelType: modelType,
                rotation: obj.rotation?.y || 0,
                chunkKey: chunkKey
            });
        }

        if (!this.isProcessing && this.queue.length > 0) {
            this.startProcessing();
        }
    }

    /**
     * Start processing the paint queue
     */
    startProcessing() {
        if (this.queue.length === 0) {
            this.isProcessing = false;
            return;
        }

        this.isProcessing = true;
        this.processNextBatch();
    }

    /**
     * Process next batch of dirt painting
     */
    processNextBatch() {
        const startTime = performance.now();
        let objectsPainted = 0;

        // Process objects until budget exhausted
        while (this.queue.length > 0 &&
               objectsPainted < this.OBJECTS_PER_FRAME &&
               performance.now() - startTime < this.FRAME_BUDGET_MS) {

            const paintJob = this.queue.shift();

            // Paint dirt for this object
            this.terrain.paintStructureVertices(
                [paintJob.position.x, paintJob.position.y, paintJob.position.z],
                paintJob.modelType,
                paintJob.rotation
            );

            objectsPainted++;
        }

        // Don't use requestAnimationFrame - will be called from game loop
        // Set processing flag based on queue status
        if (this.queue.length === 0) {
            this.isProcessing = false;
        }
    }

    /**
     * Process using idle time (alternative approach)
     */
    processWithIdleCallback() {
        if (this.queue.length === 0) {
            this.isProcessing = false;
            return;
        }

        requestIdleCallback((deadline) => {
            // Process while we have idle time
            while (this.queue.length > 0 && deadline.timeRemaining() > 1) {
                const paintJob = this.queue.shift();

                this.terrain.paintStructureVertices(
                    [paintJob.position.x, paintJob.position.y, paintJob.position.z],
                    paintJob.modelType,
                    paintJob.rotation
                );
            }

            // Continue if more work
            if (this.queue.length > 0) {
                this.processWithIdleCallback();
            } else {
                this.isProcessing = false;
            }
        }, { timeout: 50 }); // Fallback after 50ms
    }
}

// Export for use
export { ChunkObjectGenerator, DirtPaintingQueue };
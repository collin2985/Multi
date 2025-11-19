// File: public/objects.js
// Location: C:\Users\colli\Desktop\test Horses\Horses\public\objects.js

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BlobShadow } from './blobshadow.js';
import { CONFIG } from './config.js';
import { COLLISION_GROUPS } from './core/PhysicsManager.js';
import ChunkCoordinates from './core/ChunkCoordinates.js';

// ==========================================
// CONFIGURATION
// ==========================================

// PERFORMANCE TEST FLAG: Set to false to disable 3D tree models (keeps billboards only)
// This tests the FPS impact of cloned 3D models vs instanced billboards
const ENABLE_3D_TREE_MODELS = false; // Billboards only - best performance

// ADDING NEW STRUCTURES - STEP 1: MODEL REGISTRATION
// To add a new buildable structure, add its model definition here.
// Structure models need:
// - path: Path to the .glb model file in ./models/
// - heightRange/scaleRange/density: Set to 0 for structures (not randomly placed)
// - category: 'structure' for buildable items
//
// Example for a new structure:
//   mystructure: {
//       path: './models/mystructure.glb',
//       heightRange: { min: 0, max: 0 },
//       scaleRange: { min: 0, max: 0 },
//       density: 0,
//       category: 'structure'
//   }

const MODEL_CONFIG = {
    oak: {
        path: './models/oak.glb',
        heightRange: { min: 1.3, max: 2.0 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0.0,
        minDistance: 2.0,  // Minimum distance between objects
        category: 'vegetation'
    },
    fir: {
        path: './models/fir.glb',
        heightRange: { min: 1.3, max: 3.0 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 1.0,
        minDistance: 1.0,  // Minimum distance between objects
        category: 'vegetation'
    },
    pine: {
        path: './models/pine.glb',
        heightRange: { min: 2.5, max: 4.5 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 1.0,
        minDistance: 1.0,  // Minimum distance between objects
        category: 'vegetation'
    },
    cypress: {
        path: './models/cypress.glb',
        heightRange: { min: 1.3, max: 2.0 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0.0,
        minDistance: 1.0,  // Minimum distance between objects
        category: 'vegetation'
    },
    apple: {
        path: './models/apple.glb',
        heightRange: { min: 1.3, max: 2.0 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0.3,
        minDistance: 1.0,  // Minimum distance between objects
        category: 'vegetation'
    },
    log: {
        path: './models/log.glb',
        heightRange: { min: 1.2, max: 1.28 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0,  // Not naturally spawned - use tree-specific logs instead
        minDistance: 2.0,  // Minimum distance for logs
        category: 'vegetation'
    },
    oak_log: {
        path: './models/log.glb',
        heightRange: { min: 1.2, max: 1.28 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0.075,  // 1/4 of original log density (0.3 / 4)
        minDistance: 2.0,  // Minimum distance for logs
        category: 'vegetation'
    },
    pine_log: {
        path: './models/log.glb',
        heightRange: { min: 1.2, max: 1.28 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0.075,  // 1/4 of original log density (0.3 / 4)
        minDistance: 2.0,  // Minimum distance for logs
        category: 'vegetation'
    },
    fir_log: {
        path: './models/log.glb',
        heightRange: { min: 1.2, max: 1.28 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0.075,  // 1/4 of original log density (0.3 / 4)
        minDistance: 2.0,  // Minimum distance for logs
        category: 'vegetation'
    },
    cypress_log: {
        path: './models/log.glb',
        heightRange: { min: 1.2, max: 1.28 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0.075,  // 1/4 of original log density (0.3 / 4)
        minDistance: 2.0,  // Minimum distance for logs
        category: 'vegetation'
    },
    limestone: {
        path: './models/limestone.glb',
        heightRange: { min: 1.04, max: 5.0 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0.3,
        minDistance: 1.5,  // Minimum distance between rocks
        category: 'prop'
    },
    sandstone: {
        path: './models/sandstone.glb',
        heightRange: { min: 4.04, max: 7.0 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0.3,
        minDistance: 1.5,  // Minimum distance between rocks
        category: 'prop'
    },
    clay: {
        path: './models/clay.glb',
        heightRange: { min: 1.04, max: 5.0 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0.3,
        minDistance: 1.5,
        category: 'prop'
    },
    man: {
        path: './models/man.glb',
        heightRange: { min: 0, max: 0 },  // Not used for world generation
        scaleRange: { min: 0, max: 0 },   // Not used for world generation
        density: 0,                        // Not used for world generation
        category: 'player'
    },
    man2: {
        path: './models/man2.glb',
        heightRange: { min: 0, max: 0 },  // Not used for world generation
        scaleRange: { min: 0, max: 0 },   // Not used for world generation
        density: 0,                        // Not used for world generation
        category: 'player'
    },
    construction: {
        path: './models/construction.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    '2x8construction': {
        path: './models/2x8construction.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    '10x1construction': {
        path: './models/10x1construction.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    crate: {
        path: './models/crate.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    outpost: {
        path: './models/outpost.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    tent: {
        path: './models/tent.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    house: {
        path: './models/house.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    campfire: {
        path: './models/campfire.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    ship: {
        path: './models/ship.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    market: {
        path: './models/market.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    garden: {
        path: './models/garden.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    dock: {
        path: './models/dock.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    }
};

// ==========================================
// MODEL MANAGER CLASS
// ==========================================

class ModelManager {
    constructor() {
        this.models = new Map();
        this.gltfData = new Map(); // Store full GLTF objects (for animations, etc.)
        this.modelSizes = new Map(); // Store bounding box sizes for shadow calculation
        this.loader = new GLTFLoader();
        this.loadingPromises = new Map();
        this.allModelsPromise = null; // Cache the loadAllModels promise
    }

    /**
     * Load all models defined in configuration
     * @returns {Promise} Resolves when all models are loaded
     */
    async loadAllModels() {
        // Return cached promise if already loading/loaded
        if (this.allModelsPromise) {
            return this.allModelsPromise;
        }

        this.allModelsPromise = (async () => {
            const loadPromises = Object.entries(MODEL_CONFIG).map(([name, config]) =>
                this.loadModel(name, config.path)
            );

            try {
                await Promise.all(loadPromises);
            } catch (error) {
                console.error('Error loading models:', error);
                throw error;
            }
        })();

        return this.allModelsPromise;
    }

    /**
     * Load a single model
     * @param {string} name - Model identifier
     * @param {string} path - Path to model file
     * @returns {Promise} Resolves with loaded model
     */
    loadModel(name, path) {
        // Return existing promise if already loading
        if (this.loadingPromises.has(name)) {
            return this.loadingPromises.get(name);
        }

        const promise = new Promise((resolve, reject) => {
            this.loader.load(
                path,
                (gltf) => {
                    this.models.set(name, gltf.scene);
                    this.gltfData.set(name, gltf); // Store full GLTF for animations

                    // Calculate bounding box to determine model size for shadows
                    const box = new THREE.Box3().setFromObject(gltf.scene);
                    const size = new THREE.Vector3();
                    box.getSize(size);
                    // Use the maximum of X and Z dimensions as the shadow diameter
                    const diameter = Math.max(size.x, size.z);
                    this.modelSizes.set(name, diameter);

                    resolve(gltf.scene);
                },
                undefined,
                (error) => {
                    console.error(`Error loading ${name} model:`, error);
                    reject(error);
                }
            );
        });

        this.loadingPromises.set(name, promise);
        return promise;
    }

    /**
     * Get a loaded model
     * @param {string} name - Model identifier
     * @returns {THREE.Object3D|null} Model or null if not loaded
     */
    getModel(name) {
        return this.models.get(name) || null;
    }

    /**
     * Get full GLTF data (includes animations, etc.)
     * @param {string} name - Model identifier
     * @returns {Object|null} GLTF object or null if not loaded
     */
    getGLTF(name) {
        return this.gltfData.get(name) || null;
    }

    /**
     * Check if a model is loaded
     * @param {string} name - Model identifier
     * @returns {boolean} True if model is loaded
     */
    isModelLoaded(name) {
        return this.models.has(name);
    }

    /**
     * Get the bounding box size of a model
     * @param {string} name - Model identifier
     * @returns {number|null} Model diameter or null if not loaded
     */
    getModelSize(name) {
        return this.modelSizes.get(name) || null;
    }
}

// ==========================================
// SEEDED RANDOM GENERATOR
// ==========================================

class SeededRandom {
    constructor(seed) {
        this.seed = seed;
    }

    // Mulberry32 PRNG
    next() {
        let t = this.seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    // Generate float in range
    range(min, max) {
        return min + this.next() * (max - min);
    }

    // Generate integer in range
    intRange(min, max) {
        return Math.floor(this.range(min, max + 1));
    }
}

// ==========================================
// OBJECT PLACEMENT SYSTEM
// ==========================================

class ObjectPlacer {
    constructor(modelManager) {
        this.modelManager = modelManager;
        this.physicsManager = null;
        this.billboardSystem = null;
        this.treeInstanceManager = null;
    }

    /**
     * Set physics manager reference for collision detection
     * @param {PhysicsManager} physicsManager
     */
    setPhysicsManager(physicsManager) {
        this.physicsManager = physicsManager;
    }

    /**
     * Set billboard system reference for LOD billboards
     * @param {BillboardSystem} billboardSystem
     */
    setBillboardSystem(billboardSystem) {
        this.billboardSystem = billboardSystem;
    }

    /**
     * Set tree instance manager reference for instanced tree rendering
     * @param {TreeInstanceManager} treeInstanceManager
     */
    setTreeInstanceManager(treeInstanceManager) {
        this.treeInstanceManager = treeInstanceManager;
    }

    /**
     * Fix transparency issues for Three.js materials
     * @param {THREE.Material} material - Material to fix
     */
    fixTransparency(material) {
        if (material.transparent) {
            material.transparent = false;
            material.alphaTest = 0.5;
            material.depthWrite = true;
            material.side = THREE.DoubleSide;
            material.needsUpdate = true;
        }
    }

    /**
     * Create an instance of a model at specified position
     * @param {string} modelType - Type of model to place
     * @param {Object} position - Position {x, y, z}
     * @param {number} scale - Scale factor
     * @param {number} rotationY - Y-axis rotation in radians
     * @param {THREE.Scene} scene - Scene for blob shadow (optional)
     * @returns {THREE.Object3D|null} Created instance or null
     */
    createInstance(modelType, position, scale, rotationY, scene = null) {
        const model = this.modelManager.getModel(modelType);

        // LOG DEBUG: Check if log model is loaded and being cloned
        if (modelType && modelType.endsWith('_log')) {
            console.log('[LOG DEBUG] createInstance:', { modelType, modelLoaded: !!model, position, scale });
        }

        if (!model) {
            console.warn(`Model ${modelType} not loaded`);
            return null;
        }

        const instance = model.clone();
        instance.name = modelType;
        instance.userData = {
            modelType,
            originalScale: scale
        };


        // Apply position with model-specific Y offsets
        instance.position.copy(position);

        // No Y-offsets - models handle their own positioning relative to foundation
        // (foundation.y is the reference point for all structures)

        instance.scale.setScalar(scale);
        instance.rotation.y = rotationY;

        // Apply material fixes
        instance.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                if (child.material) {
                    this.fixTransparency(child.material);
                }
                // Frustum culling re-enabled (default: true)
                // EXCEPT for logs - disable frustum culling to prevent bounding box issues
                if (modelType === 'log' || modelType.endsWith('_log')) {
                    child.frustumCulled = false;
                }
            }
        });

        // DISABLED FOR FPS TESTING - Add blob shadow based on object type (if scene is provided)
        // Skip shadows for structures, players, logs, and resource rocks
        /* if (scene) {
            const config = MODEL_CONFIG[modelType];
            const isLog = modelType === 'log' || modelType.endsWith('_log');
            const isRock = modelType === 'limestone' || modelType === 'sandstone' || modelType === 'clay';
            const shouldHaveShadow = config && config.category !== 'structure' && config.category !== 'player' && !isLog && !isRock;

            if (shouldHaveShadow) {
                // Get model's actual bounding box size
                const modelSize = this.modelManager.getModelSize(modelType);

                // Calculate shadow size: model size * scale
                // Add a small multiplier (1.2) to make shadows slightly larger than the model
                const shadowSize = modelSize ? (modelSize * scale * 1.2) : (0.75 * scale);

                // Create and attach blob shadow to the instance (darker opacity: 0.5)
                const shadow = new BlobShadow(instance, scene, shadowSize, 0.5);
                instance.userData.blobShadow = shadow;
            }
        } */

        if (modelType && modelType.endsWith('_log')) {
            let meshCount = 0;
            instance.traverse((child) => {
                if (child instanceof THREE.Mesh) meshCount++;
            });
            console.log('[LOG DEBUG] Returning instance:', {
                type: instance.type,
                visible: instance.visible,
                hasChildren: instance.children.length > 0,
                childCount: instance.children.length,
                meshCount: meshCount,
                scale: instance.scale,
                position: instance.position
            });
        }

        return instance;
    }

    /**
     * Check if a position meets minimum distance requirements
     * @param {number} posX - X position to check
     * @param {number} posZ - Z position to check
     * @param {number} minDistance - Minimum required distance
     * @param {Array} placedPositions - Array of already placed positions {x, z, minDistance}
     * @returns {boolean} True if position is valid (far enough from all placed objects)
     */
    checkMinimumDistance(posX, posZ, minDistance, placedPositions) {
        for (const placed of placedPositions) {
            const dx = posX - placed.x;
            const dz = posZ - placed.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            // Check against both the new object's minDistance and the placed object's minDistance
            // Use the larger of the two to ensure both constraints are satisfied
            const requiredDistance = Math.max(minDistance, placed.minDistance);

            if (distance < requiredDistance) {
                return false; // Too close to an existing object
            }
        }
        return true; // Position is valid
    }

    /**
     * Generate objects for a chunk
     * @param {Object} params - Generation parameters
     * @returns {Array} Array of created objects
     */
    generateChunkObjects(params) {
        const {
            scene,
            heightCalculator,
            worldX,
            worldZ,
            seed,
            chunkSize = 50,
            objectsPerType = 500,
            removedObjectIds = null, // Pass in removed objects to skip creation
            addedObjectIds = null, // Pass in objects already added from server to skip creation
            neighborPositions = [], // Pass in positions from neighboring chunks for boundary checking
            gameState = null // Optional: for physics radius check
        } = params;

        const objects = [];
        const halfSize = chunkSize / 2;

        // Track placed object positions for minimum distance checking
        // Start with positions from neighboring chunks
        const placedPositions = [...neighborPositions];

        // Create chunk-specific seed for deterministic generation
        const { chunkX: gridX, chunkZ: gridZ } = ChunkCoordinates.worldToChunk(worldX, worldZ);
        const chunkSeed = seed + gridX * 73856093 + gridZ * 19349663;

        let totalGenerated = 0;
        let totalSkipped = 0;
        let totalDistanceRejected = 0;

        // Process each model type
        Object.entries(MODEL_CONFIG).forEach(([modelType, config], index) => {
            // Skip player models (they're not world objects)
            if (config.category === 'player') {
                return;
            }

            // Create unique seed for this model type within the chunk
            const typeSeed = chunkSeed + index * 31337;
            const rng = new SeededRandom(typeSeed);

            const numObjects = Math.floor(objectsPerType * config.density);

            for (let i = 0; i < numObjects; i++) {
                // Generate objectId first
                const objectId = `${gridX},${gridZ}_${modelType}_${i}`;

                // Generate position within chunk (ALWAYS call RNG to maintain sequence)
                const offsetX = rng.range(-halfSize, halfSize);
                const offsetZ = rng.range(-halfSize, halfSize);
                const posX = worldX + offsetX;
                const posZ = worldZ + offsetZ;

                // Check height constraints
                const terrainHeight = heightCalculator.calculateHeight(posX, posZ);
                if (terrainHeight >= config.heightRange.min &&
                    terrainHeight <= config.heightRange.max) {

                    // Generate scale, rotation, and quality (ALWAYS call RNG to maintain sequence)
                    const scale = rng.range(config.scaleRange.min, config.scaleRange.max);
                    const rotation = rng.next() * Math.PI * 2;
                    let quality = Math.floor(rng.range(1, 101)); // Quality between 1-100

                    // Logs should have low quality (<25) when naturally spawned
                    if (modelType === 'log' || modelType.endsWith('_log')) {
                        quality = Math.floor(rng.range(1, 25));
                    }

                    // Get minimum distance for this object type
                    const minDistance = config.minDistance || 0;

                    // NOW check if this object was removed by a player
                    if (removedObjectIds && removedObjectIds.has(objectId)) {
                        totalSkipped++;
                        // Still track this position to preserve spacing (prevents other objects from filling this spot)
                        if (minDistance > 0) {
                            placedPositions.push({
                                x: posX,
                                z: posZ,
                                minDistance: minDistance
                            });
                        }
                        continue;
                    }

                    // Check if this object was already added from server data
                    if (addedObjectIds && addedObjectIds.has(objectId)) {
                        totalSkipped++;
                        // Still track this position to preserve spacing (prevents overlap)
                        if (minDistance > 0) {
                            placedPositions.push({
                                x: posX,
                                z: posZ,
                                minDistance: minDistance
                            });
                        }
                        continue;  // Skip - already exists from server
                    }

                    // Check minimum distance constraint (if configured)
                    if (minDistance > 0 && !this.checkMinimumDistance(posX, posZ, minDistance, placedPositions)) {
                        totalDistanceRejected++;
                        continue; // Skip this object - too close to existing objects
                    }

                    // Create and place object
                    const position = new THREE.Vector3(posX, terrainHeight, posZ);

                    // DUAL-PATH: Try instancing first (for enabled tree types)
                    const TREE_TYPES = ['oak', 'fir', 'pine', 'cypress', 'apple'];
                    const isTree = TREE_TYPES.includes(modelType);

                    // LOG DEBUG: Check if logs are being treated as trees
                    if (modelType && modelType.endsWith('_log')) {
                        console.log('[LOG DEBUG] Log check:', { modelType, isTree, ENABLE_3D_TREE_MODELS });
                    }

                    let instanceIndex = null;
                    let useInstancing = false;

                    if (isTree && this.treeInstanceManager) {
                        instanceIndex = this.treeInstanceManager.addTreeInstance(
                            objectId,
                            modelType,
                            position,
                            rotation,
                            scale,
                            {
                                quality: quality,
                                remainingResources: 100,
                                totalResources: 100,
                                chunkKey: `${gridX},${gridZ}`
                            }
                        );

                        if (instanceIndex !== null) {
                            useInstancing = true;
                            // Instance created successfully
                        }
                    }

                    // Create mesh object (or lightweight placeholder for billboard trees)
                    let instance;
                    if (isTree && !ENABLE_3D_TREE_MODELS) {
                        // Billboard tree: Create lightweight placeholder (no 3D model)
                        if (modelType && modelType.endsWith('_log')) {
                            console.log('[LOG DEBUG] ❌ Taking BILLBOARD path (wrong!)');
                        }
                        instance = new THREE.Object3D();
                        instance.name = modelType;
                        instance.position.copy(position);
                    } else if (useInstancing) {
                        // Instanced 3D tree: Create lightweight placeholder (mesh is in InstancedMesh)
                        if (modelType && modelType.endsWith('_log')) {
                            console.log('[LOG DEBUG] ❌ Taking INSTANCING path (wrong!)');
                        }
                        instance = new THREE.Object3D();
                        instance.name = modelType;
                        instance.position.copy(position);
                    } else {
                        // Regular object: Clone full mesh
                        if (modelType && modelType.endsWith('_log')) {
                            console.log('[LOG DEBUG] ✓ Taking FULL MESH path (correct!)');
                        }
                        instance = this.createInstance(modelType, position, scale, rotation, scene);
                    }

if (instance) {
    instance.userData.objectId = objectId;
    instance.userData.modelType = modelType; // CRITICAL: Required for proximity detection
    instance.userData.chunkKey = `${gridX},${gridZ}`;
    instance.userData.quality = quality;
    instance.userData.instanceIndex = instanceIndex; // Store instance index (if instanced)


    // Add resources for logs (all log types: log, oak_log, pine_log, etc.)
    if (modelType === 'log' || modelType.endsWith('_log')) {
        const totalResources = 5;
        instance.userData.totalResources = totalResources;
        instance.userData.remainingResources = totalResources;
    }

    // Add resources for rocks (limestone, sandstone, clay)
    if (modelType === 'limestone' || modelType === 'sandstone' || modelType === 'clay') {
        const totalResources = 20;
        instance.userData.totalResources = totalResources;
        instance.userData.remainingResources = totalResources;

    }

    // Add to scene:
    // - Billboard trees: Add lightweight placeholder (no full mesh, just Object3D for game logic)
    // - Instanced trees: Skip (already in InstancedMesh)
    // - Regular objects: Add full mesh
    if (useInstancing) {
        // Don't add to scene - already in InstancedMesh
    } else {
        // Add to scene (either placeholder for billboard trees, or full mesh for other objects)
        scene.add(instance);
    }

    // Create billboard for trees (for LOD system)
    if (this.billboardSystem) {
        const TREE_TYPES = ['oak', 'fir', 'pine', 'cypress', 'apple'];
        if (TREE_TYPES.includes(modelType)) {
            const billboardIndex = this.billboardSystem.addTreeBillboard(
                instance,
                modelType,
                position
            );
            instance.userData.billboardIndex = billboardIndex;
        }
    }

    // Register physics collider ONLY if within physics radius
    if (this.physicsManager && this.physicsManager.initialized) {
        // Check if chunk is within physics radius
        let withinPhysicsRadius = true; // Default to true if no gameState or player position not set

        // Only apply physics radius check if we have valid player chunk coordinates
        if (gameState &&
            typeof gameState.currentPlayerChunkX === 'number' &&
            typeof gameState.currentPlayerChunkZ === 'number' &&
            !isNaN(gameState.currentPlayerChunkX) &&
            !isNaN(gameState.currentPlayerChunkZ)) {

            const chunkDistX = Math.abs(gridX - gameState.currentPlayerChunkX);
            const chunkDistZ = Math.abs(gridZ - gameState.currentPlayerChunkZ);
            withinPhysicsRadius = chunkDistX <= CONFIG.CHUNKS.PHYSICS_RADIUS &&
                                 chunkDistZ <= CONFIG.CHUNKS.PHYSICS_RADIUS;
        }

        if (withinPhysicsRadius) {
            const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[modelType];

            if (dims) {
                let shape;
                let collisionGroup;

                // Determine shape type
                if (dims.radius !== undefined) {
                    // Cylinder for trees, rocks (natural objects with radius)
                    shape = {
                        type: 'cylinder',
                        radius: dims.radius,
                        height: dims.height || 1.0
                    };
                    collisionGroup = COLLISION_GROUPS.NATURAL;
                } else {
                    // Cuboid for logs
                    shape = {
                        type: 'cuboid',
                        width: dims.width,
                        depth: dims.depth,
                        height: dims.height || 1.0
                    };
                    collisionGroup = COLLISION_GROUPS.PLACED;
                }

                // Create static collider
                const collider = this.physicsManager.createStaticCollider(
                    objectId,
                    shape,
                    position,
                    rotation,
                    collisionGroup
                );

                // Store handle for cleanup
                if (collider) {
                    instance.userData.physicsHandle = collider;
                }
            }
        }
    }

    objects.push(instance);
    totalGenerated++;

    // Track this position for minimum distance checking
    placedPositions.push({
        x: posX,
        z: posZ,
        minDistance: minDistance
    });

    // DISABLED FOR FPS TESTING - Update blob shadow position to terrain with normal alignment and left offset
    /* if (instance.userData.blobShadow) {
        // Create a fake light position to the right to cast shadow to the left
        const fakeLight = new THREE.Vector3(posX + 100, 20, posZ);
        instance.userData.blobShadow.update(
            (x, z) => heightCalculator.calculateHeight(x, z),
            fakeLight, // Light to the right = shadow to the left (0.1 units)
            (x, z) => {
                const normal = heightCalculator.calculateNormal(x, z);
                return new THREE.Vector3(normal.x, normal.y, normal.z);
            }
        );
    } */
}
                }
            }
        });

        return objects;
    }

    /**
     * Remove and dispose of objects
     * @param {THREE.Scene} scene - Scene to remove from
     * @param {Array} objects - Objects to remove
     */
    removeObjects(scene, objects, physicsManager = null) {
        objects.forEach(obj => {
            // CRITICAL: Never remove InstancedMeshes from scene!
            // These are shared across all chunks and must persist
            if (obj.type === 'InstancedMesh' || obj.userData.persistentMesh) {
                console.warn('[removeObjects] Prevented removal of InstancedMesh:', obj.name);
                return;
            }

            // Remove physics collider FIRST (critical for performance!)
            if (physicsManager && obj.userData.objectId) {
                physicsManager.removeCollider(obj.userData.objectId);
            }

            // Dispose blob shadow if it exists
            if (obj.userData.blobShadow) {
                obj.userData.blobShadow.dispose();
                obj.userData.blobShadow = null;
            }

            scene.remove(obj);
            obj.traverse((child) => {
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
        });
    }


findObjectById(scene, objectId, objectRegistry = null) {
    // Fast O(1) lookup if registry is provided
    if (objectRegistry) {
        const cachedObject = objectRegistry.get(objectId);
        if (cachedObject) {
            return cachedObject;
        }
    }

    // Fallback to scene traversal if not in registry
    let foundObject = null;
    scene.traverse((object) => {
        if (object.userData) {
            // Skip bounding box objects - they're not the actual world objects
            if (object.userData.isBoundingBox) {
                return;
            }
            if (object.userData.objectId === objectId) {
                foundObject = object;
                // Cache in registry for future lookups
                if (objectRegistry) {
                    objectRegistry.set(objectId, object);
                }
            }
        }
    });
    return foundObject;
}


}

// ==========================================
// SINGLETON INSTANCES & EXPORTS
// ==========================================

const modelManager = new ModelManager();
const objectPlacer = new ObjectPlacer(modelManager);

// Initialize models on module load
modelManager.loadAllModels();






// Legacy function wrappers for compatibility
function generateChunkObjects(scene, heightCalculator, worldX, worldZ, seed, chunkSize = 50, numTrees = 500, removedObjectIds = null, addedObjectIds = null, neighborPositions = [], gameState = null) {
    return objectPlacer.generateChunkObjects({
        scene,
        heightCalculator,
        worldX,
        worldZ,
        seed,
        chunkSize,
        objectsPerType: numTrees,
        removedObjectIds,
        addedObjectIds,
        neighborPositions,
        gameState
    });
}

function removeObjects(scene, objects, physicsManager = null) {
    objectPlacer.removeObjects(scene, objects, physicsManager);
}

// Export both legacy functions and new system
export {
    // Legacy compatibility
    generateChunkObjects,
    removeObjects,


    // New system
    modelManager,
    objectPlacer,
    ModelManager,
    ObjectPlacer,
    SeededRandom,
    MODEL_CONFIG
};
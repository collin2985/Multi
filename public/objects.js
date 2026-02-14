// File: public/objects.js
// Location: C:\Users\colli\Desktop\test Horses\Horses\public\objects.js

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from './config.js';
import { CONFIG as TERRAIN_CONFIG } from './TerrainConfig.js';
import { COLLISION_GROUPS } from './core/PhysicsManager.js';
import ChunkCoordinates from './core/ChunkCoordinates.js';
import { QualityGenerator } from './core/QualityGenerator.js';

// ==========================================
// EUCLIDEAN FOG FIX
// ==========================================
// Three.js default fog uses Z-depth (-mvPosition.z) which causes inconsistent
// fog at screen edges. Terrain/billboards use euclidean distance (length(mvPosition.xyz)).
// This function patches MeshStandardMaterial to use euclidean distance for consistent fog.

/**
 * Apply euclidean fog calculation to a material (matches terrain/billboard fog)
 * @param {THREE.Material} material - Material to patch (typically MeshStandardMaterial)
 */
export function applyEuclideanFog(material) {
    if (!material || material._euclideanFogApplied) return;

    const originalOnBeforeCompile = material.onBeforeCompile;

    material.onBeforeCompile = (shader) => {
        if (originalOnBeforeCompile) originalOnBeforeCompile.call(material, shader);

        // Replace Z-depth fog with euclidean distance
        shader.vertexShader = shader.vertexShader.replace(
            'vFogDepth = - mvPosition.z;',
            'vFogDepth = length( mvPosition.xyz );'
        );
    };

    const originalCacheKey = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : null;
    material.customProgramCacheKey = function() {
        return (originalCacheKey ? originalCacheKey() : '') + '_euclideanFog';
    };

    material._euclideanFogApplied = true;
    material.needsUpdate = true;
}

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
        path: null,  // Billboard only - GLB model removed
        heightRange: { min: 4, max: 22 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0.0,
        minDistance: 2.0,  // Minimum distance between objects
        category: 'vegetation'
    },
    fir: {
        path: null,  // Billboard only - GLB model removed
        heightRange: { min: 4, max: 22 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0,
        minDistance: 1.0,  // Minimum distance between objects
        category: 'vegetation'
    },
    pine: {
        path: null,  // Billboard only - GLB model removed
        heightRange: { min: 4, max: 22 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 1.0,
        minDistance: 1.0,  // Minimum distance between objects
        category: 'vegetation'
    },
    deertree: {
        path: null,  // Billboard only - uses pine texture
        heightRange: { min: 4, max: 22 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0,  // Not procedurally generated - placed by ChunkObjectGenerator
        minDistance: 1.0,
        category: 'vegetation'
    },
    cypress: {
        path: null,  // Billboard only - GLB model removed
        heightRange: { min: 4, max: 22 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0.0,
        minDistance: 1.0,  // Minimum distance between objects
        category: 'vegetation'
    },
    apple: {
        path: null,  // Billboard only - GLB model removed
        heightRange: { min: 4, max: 22 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0.1,
        minDistance: 1.0,  // Minimum distance between objects
        category: 'vegetation'
    },
    vegetables: {
        path: null,  // No 3D model - billboard only
        heightRange: { min: 4, max: 22 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0.11,
        minDistance: 1.0,
        category: 'vegetation',
        billboardOnly: true  // Uses only billboard sprite, no 3D model
    },
    hemp: {
        path: null,  // No 3D model - billboard only
        heightRange: { min: 3, max: 10 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0.01,
        minDistance: 1.0,
        category: 'vegetation',
        billboardOnly: true  // Uses only billboard sprite, no 3D model
    },
    log: {
        path: './models/log.glb',
        heightRange: { min: 0.1, max: 22 },
        scaleRange: { min: 2.0, max: 2.0 },
        density: 0,  // Not naturally spawned - use tree-specific logs instead
        minDistance: 2.0,  // Minimum distance for logs
        category: 'vegetation'
    },
    oak_log: {
        path: './models/log.glb',
        heightRange: { min: 0.1, max: 22 },
        scaleRange: { min: 2.0, max: 2.0 },
        density: 0,  // Disabled - logs only from chopping trees
        minDistance: 2.0,  // Minimum distance for logs
        category: 'vegetation'
    },
    pine_log: {
        path: './models/log.glb',
        heightRange: { min: 0.1, max: 22 },
        scaleRange: { min: 2.0, max: 2.0 },
        density: 0,  // Disabled - logs only from chopping trees
        minDistance: 2.0,  // Minimum distance for logs
        category: 'vegetation'
    },
    fir_log: {
        path: './models/log.glb',
        heightRange: { min: 0.1, max: 22 },
        scaleRange: { min: 2.0, max: 2.0 },
        density: 0,  // Disabled - logs only from chopping trees
        minDistance: 2.0,  // Minimum distance for logs
        category: 'vegetation'
    },
    cypress_log: {
        path: './models/log.glb',
        heightRange: { min: 0.1, max: 22 },
        scaleRange: { min: 2.0, max: 2.0 },
        density: 0,  // Disabled - logs only from chopping trees
        minDistance: 2.0,  // Minimum distance for logs
        category: 'vegetation'
    },
    apple_log: {
        path: './models/log.glb',
        heightRange: { min: 0.1, max: 22 },
        scaleRange: { min: 2.0, max: 2.0 },
        density: 0,  // Disabled - logs only from chopping trees
        minDistance: 2.0,
        category: 'vegetation'
    },
    limestone: {
        path: './models/limestone.glb',
        heightRange: { min: 4, max: 22 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0.3,
        minDistance: 1.5,  // Minimum distance between rocks
        category: 'prop'
    },
    sandstone: {
        path: './models/sandstone.glb',
        heightRange: { min: 4, max: 22 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0.3,
        minDistance: 1.5,  // Minimum distance between rocks
        category: 'prop'
    },
    clay: {
        path: './models/clay.glb',
        heightRange: { min: 4, max: 22 },
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0.3,
        minDistance: 1.5,
        category: 'prop'
    },
    iron: {
        path: './models/iron.glb',
        heightRange: { min: 20, max: 40 },  // Only spawns at high elevations (mountains)
        scaleRange: { min: 1.0, max: 1.0 },
        density: 0.01,                       // ~5 attempts per chunk - iron is rare
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
    construction: {
        path: './models/construction.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    '2x2construction': {
        path: './models/2x2construction.glb',
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
    '10x4construction': {
        path: './models/10x4construction.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    '10x1construction': {
        // Fallback for old saved data - points to 10x1construction3.glb
        path: './models/10x1construction3.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    '3x3construction': {
        path: './models/3x3construction.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    crate: {
        path: './models/mobilecrate.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure',
        baseScale: 1.0
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
    bearden: {
        path: './models/bearden.glb',
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
    boat: {
        path: './models/boat.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure',
        baseScale: 1.5,
        tint: { r: 2.0, g: 2.0, b: 2.0 }
    },
    sailboat: {
        path: './models/sailboat.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure',
        baseScale: 0.5625,
        tint: { r: 1.4, g: 1.4, b: 1.4 }
    },
    ship2: {
        path: './models/ship2.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure',
        baseScale: 1.0,
        tint: { r: 2.0, g: 2.0, b: 2.0 }
    },
    horse: {
        path: './models/horse.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure',
        baseScale: 0.385
    },
    cart: {
        path: './models/cart.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure',
        baseScale: 1.0
    },
    artillery: {
        path: './models/Artillery.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure',
        baseScale: 1.0
    },
    market: {
        path: './models/market.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    tileworks: {
        path: './models/tileworks.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    ironworks: {
        path: './models/ironworks.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    blacksmith: {
        path: './models/blacksmith.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    bakery: {
        path: './models/bakery.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    gardener: {
        path: './models/gardener.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    miner: {
        path: './models/miner.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    woodcutter: {
        path: './models/woodcutter.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    stonemason: {
        path: './models/stonemason.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    wall: {
        path: './models/wall.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    fisherman: {
        path: './models/fisherman.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    rifle: {
        path: './models/rifle.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'weapon'
    },
    warehouse: {
        path: './models/warehouse.glb',
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
        this.pristineClones = new Map(); // Store pristine clones for skinned models (unaffected by animation)
        this.loader = new GLTFLoader();
        this.loadingPromises = new Map();
        this.allModelsPromise = null; // Cache the loadAllModels promise

        // Set up DRACO decoder for compressed models (limestone, sandstone, clay, etc.)
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
        this.loader.setDRACOLoader(dracoLoader);
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
            const loadPromises = Object.entries(MODEL_CONFIG)
                .filter(([name, config]) => config.path && !config.billboardOnly)  // Skip billboard-only models
                .map(([name, config]) => this.loadModel(name, config.path));

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

                    // Check if model has skinned meshes - if so, store a pristine clone
                    // This clone is used for corpses/peers/AI to avoid inheriting animation poses
                    let hasSkeleton = false;
                    gltf.scene.traverse(child => {
                        if (child.isSkinnedMesh) hasSkeleton = true;
                    });
                    if (hasSkeleton) {
                        this.pristineClones.set(name, SkeletonUtils.clone(gltf.scene));
                    }

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
     * Get the clone source for a model (pristine clone for skinned models, original for others)
     * Use this when cloning models to avoid inheriting animation poses from the main player
     * @param {string} name - Model identifier
     * @returns {THREE.Object3D|null}
     */
    getCloneSource(name) {
        return this.pristineClones.get(name) || this.models.get(name) || null;
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
     * Set rock model system reference for 3D rock LOD (limestone, sandstone, clay)
     * @param {RockModelSystem} rockModelSystem
     */
    setRockModelSystem(rockModelSystem) {
        this.rockModelSystem = rockModelSystem;
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
        const model = this.modelManager.getCloneSource(modelType);

        if (!model) {
            console.warn(`Model ${modelType} not loaded`);
            return null;
        }

        // Check if model has skinned meshes (needs SkeletonUtils for proper cloning)
        let hasSkeleton = false;
        model.traverse(child => {
            if (child.isSkinnedMesh) hasSkeleton = true;
        });

        // Use SkeletonUtils.clone() for skinned/animated models, regular clone for static
        const instance = hasSkeleton
            ? SkeletonUtils.clone(model)
            : model.clone();

        instance.name = modelType;
        instance.userData = {
            modelType,
            originalScale: scale
        };


        // Apply position with model-specific Y offsets
        instance.position.copy(position);

        // No Y-offsets - models handle their own positioning relative to foundation
        // (foundation.y is the reference point for all structures)

        // Apply baseScale multiplier from MODEL_CONFIG if defined
        const config = MODEL_CONFIG[modelType];
        const baseScale = config?.baseScale || 1.0;
        instance.scale.setScalar(scale * baseScale);
        instance.rotation.y = rotationY;

        // Apply material fixes and optional tint
        const tint = config?.tint;
        instance.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                if (child.material) {
                    this.fixTransparency(child.material);

                    // Apply tint if configured
                    if (tint) {
                        const materials = Array.isArray(child.material) ? child.material : [child.material];
                        materials.forEach((mat, idx) => {
                            const clonedMat = mat.clone();
                            if (clonedMat.color) {
                                clonedMat.color.setRGB(
                                    clonedMat.color.r * tint.r,
                                    clonedMat.color.g * tint.g,
                                    clonedMat.color.b * tint.b
                                );
                            }
                            applyEuclideanFog(clonedMat);
                            clonedMat.needsUpdate = true;
                            if (Array.isArray(child.material)) {
                                child.material[idx] = clonedMat;
                            } else {
                                child.material = clonedMat;
                            }
                        });
                    } else {
                        // No tint - apply fog fix to existing materials
                        const materials = Array.isArray(child.material) ? child.material : [child.material];
                        materials.forEach(mat => applyEuclideanFog(mat));
                    }
                }
                // Fix bounding geometry for proper frustum culling (keep culling enabled)
                if (child.geometry) {
                    const isLog = modelType === 'log' || modelType.endsWith('_log');
                    const isHorse = modelType === 'horse';
                    const isCart = modelType === 'cart';

                    if (isLog) {
                        // Logs are static - recompute bounds from actual geometry
                        child.geometry.computeBoundingBox();
                        child.geometry.computeBoundingSphere();
                    } else if (isHorse) {
                        // Animated model - use oversized sphere to cover all animation poses
                        // Horse scale is 0.385, so radius of 1.5 covers all poses safely
                        child.geometry.boundingSphere = new THREE.Sphere(
                            new THREE.Vector3(0, 0.5, 0),
                            1.5
                        );
                    } else if (isCart) {
                        // Complex model - recompute and expand bounds for safety margin
                        child.geometry.computeBoundingBox();
                        child.geometry.computeBoundingSphere();
                        if (child.geometry.boundingSphere) {
                            child.geometry.boundingSphere.radius *= 1.3;
                        }
                    }
                }
                // Frustum culling stays enabled (default: true) for all objects
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
     * Generate objects for a chunk in batches to prevent frame drops
     * This is THE ACTIVE VERSION used by the game via ChunkObjectGenerator
     *
     * IMPORTANT FOR AI/DEVELOPERS:
     * - This function is called by ChunkObjectGenerator.js for frame-budgeted generation
     * - It creates objects in small batches to avoid stuttering
     * - Trees can be created as:
     *   1. Billboard placeholders (if !ENABLE_3D_TREE_MODELS)
     *   2. Instanced mesh placeholders (if using TreeInstanceManager)
     *   3. Full mesh clones (for non-trees or when instancing fails)
     * - ALL objects need invisible collision meshes for interaction
     * - ALL objects need physics colliders for proximity detection
     * - ALL objects must be added to the scene (even placeholders)
     */
    generateChunkObjectsBatch(
        scene,
        heightProvider,  // Can be terrainGenerator (getWorldHeight) or heightCalculator (calculateHeight)
        worldX,
        worldZ,
        seed,
        chunkSize,
        modelType,      // Single model type to generate
        startIndex,     // Starting index for generation
        batchSize,      // Number to generate in this batch
        removedObjectIds,
        addedObjectIds,
        neighborPositions,
        gameState,
        chunkSeed,      // Pre-calculated chunk seed
        placedPositions // Accumulated placed positions
    ) {
        const objects = [];
        const halfSize = chunkSize / 2;

        // Get model config
        const config = MODEL_CONFIG[modelType];
        if (!config || config.category === 'player') {
            return { objects, endIndex: startIndex };
        }

        // Support both new (getWorldHeight) and old (calculateHeight) APIs
        const getHeight = heightProvider.getWorldHeight
            ? (x, z) => heightProvider.getWorldHeight(x, z)
            : (x, z) => heightProvider.calculateHeight(x, z);

        // Support slope check via getNormalY (new API) or calculateNormal (old API)
        const getNormalY = heightProvider.getNormalY
            ? (x, z) => heightProvider.getNormalY(x, z)
            : heightProvider.calculateNormal
                ? (x, z) => heightProvider.calculateNormal(x, z).y
                : null;

        // Calculate chunk grid position
        const { chunkX: gridX, chunkZ: gridZ } = ChunkCoordinates.worldToChunk(worldX, worldZ);

        // Create type-specific seed
        const typeIndex = Object.keys(MODEL_CONFIG).indexOf(modelType);
        const typeSeed = chunkSeed + typeIndex * 31337;
        const rng = new SeededRandom(typeSeed);

        // Skip to the correct position in the random sequence
        for (let i = 0; i < startIndex * 4; i++) {
            rng.next(); // Advance RNG to maintain deterministic generation
        }

        // Apply regional density modifier (each chunk has -25% to +25% variation per resource)
        const worldSeed = TERRAIN_CONFIG.TERRAIN.seed;
        const densityModifier = QualityGenerator.getDensityModifier(worldSeed, gridX, gridZ, modelType);
        const numObjects = Math.floor(500 * config.density * densityModifier);
        const endIndex = Math.min(startIndex + batchSize, numObjects);

        for (let i = startIndex; i < endIndex; i++) {
            // Generate objectId
            const objectId = `${gridX},${gridZ}_${modelType}_${i}`;

            // Generate position (ALWAYS call RNG to maintain sequence)
            const offsetX = rng.range(-halfSize, halfSize);
            const offsetZ = rng.range(-halfSize, halfSize);
            const posX = worldX + offsetX;
            const posZ = worldZ + offsetZ;

            // Check height constraints
            const terrainHeight = getHeight(posX, posZ);
            if (terrainHeight >= config.heightRange.min &&
                terrainHeight <= config.heightRange.max) {

                // Check slope - skip steep terrain where rock texture appears
                // In shader: slope = 1.0 - normal.y, rock appears at smoothstep(0.0, 0.2, slope)
                // Rock fully visible when slope >= 0.2, i.e., normalY <= 0.8
                if (getNormalY) {
                    const normalY = getNormalY(posX, posZ);
                    if (normalY < 0.8) {
                        continue; // Too steep (rock texture area), skip this position
                    }
                }

                // Generate scale, rotation, and quality
                const scale = rng.range(config.scaleRange.min, config.scaleRange.max);
                const rotation = rng.next() * Math.PI * 2;
                let quality = Math.floor(rng.range(1, 101));

                // Use chunk-based quality for specific types
                const worldSeed = TERRAIN_CONFIG.TERRAIN.seed;
                if (['fir', 'pine', 'apple', 'clay', 'limestone', 'sandstone', 'iron', 'hemp', 'vegetables'].includes(modelType)) {
                    quality = QualityGenerator.getQuality(worldSeed, gridX, gridZ, modelType);
                } else if (modelType === 'log' || modelType.endsWith('_log')) {
                    quality = Math.floor(rng.range(1, 25));
                }

                // Get minimum distance
                const minDistance = config.minDistance || 0;

                // Check if removed by player
                if (removedObjectIds && removedObjectIds.has(objectId)) {
                    if (minDistance > 0) {
                        placedPositions.push({
                            x: posX,
                            z: posZ,
                            minDistance: minDistance
                        });
                    }
                    continue;
                }

                // Check if already added from server
                if (addedObjectIds && addedObjectIds.has(objectId)) {
                    if (minDistance > 0) {
                        placedPositions.push({
                            x: posX,
                            z: posZ,
                            minDistance: minDistance
                        });
                    }
                    continue;
                }

                // Check minimum distance constraint
                if (minDistance > 0 && !this.checkMinimumDistance(posX, posZ, minDistance, placedPositions)) {
                    continue;
                }

                // Create object (matching the original logic)
                const posY = terrainHeight;
                const position = new THREE.Vector3(posX, posY, posZ);

                const isTree = CONFIG.OBJECTS.TREE_TYPES.has(modelType);
                const isRock = CONFIG.OBJECTS.ROCK_TYPES.has(modelType);
                const isNaturalObject = isTree || isRock; // Trees and rocks use billboard-only outside physics radius

                let instance;
                const ENABLE_3D_TREE_MODELS = window.ENABLE_3D_TREE_MODELS || false;

                if (isTree && !ENABLE_3D_TREE_MODELS) {
                    // Billboard tree - Create lightweight placeholder (no invisible mesh)
                    // Trees are click-through - interaction via proximity + UI buttons
                    // This removes ~50,000 meshes from scene graph for performance
                    instance = new THREE.Object3D();
                    instance.name = modelType;
                    instance.position.copy(position);

                    // Store rotation/scale for dynamic 3D LOD instancing
                    if (CONFIG.TREE_MODEL_TYPES.includes(modelType)) {
                        instance.userData.treeRotation = rotation;
                        instance.userData.treeScale = scale;

                        // Add to 3D model system immediately if chunk is near player (like rocks)
                        // Only add within 1-chunk radius to avoid filling the limited tree pool
                        // with distant trees. The recycle loop handles trees beyond this range.
                        if (this.rockModelSystem && this.rockModelSystem.treeModelsEnabled &&
                            gameState && typeof gameState.currentPlayerChunkX === 'number') {
                            const chunkDist = Math.max(
                                Math.abs(gridX - gameState.currentPlayerChunkX),
                                Math.abs(gridZ - gameState.currentPlayerChunkZ)
                            );
                            if (chunkDist <= 1) {
                                this.rockModelSystem.addRockInstance(instance, modelType, position, rotation, scale);
                            }
                        }
                    }
                } else if (isRock) {
                    // Rock - Create lightweight placeholder, use instanced 3D models
                    // RockModelSystem handles LOD fade, BillboardSystem handles far distance
                    instance = new THREE.Object3D();
                    instance.name = modelType;
                    instance.position.copy(position);

                    // Add to instanced 3D rock system (renders when close)
                    if (this.rockModelSystem) {
                        this.rockModelSystem.addRockInstance(instance, modelType, position, rotation, scale);
                    }
                } else {
                    // Regular object: Clone full mesh
                    instance = this.createInstance(modelType, position, scale, rotation, scene);
                }

                if (instance) {
                    // Set up userData
                    instance.userData.objectId = objectId;
                    instance.userData.modelType = modelType;
                    instance.userData.chunkKey = `${gridX},${gridZ}`;
                    instance.userData.quality = quality;

                    // Add resources for logs
                    if (modelType === 'log' || modelType.endsWith('_log')) {
                        instance.userData.totalResources = 5;
                        instance.userData.remainingResources = 5;
                    }

                    // Add resources for rocks
                    if (modelType === 'limestone' || modelType === 'sandstone' || modelType === 'clay' || modelType === 'iron') {
                        instance.userData.totalResources = 20;
                        instance.userData.remainingResources = 20;
                    }

                    // Check if chunk is within physics radius (for scene addition and colliders)
                    let withinPhysicsRadius = true; // Default to true if no gameState
                    // Use typeof check - currentPlayerChunkX starts as null, not undefined
                    if (gameState && typeof gameState.currentPlayerChunkX === 'number' && typeof gameState.currentPlayerChunkZ === 'number') {
                        const chunkDist = Math.max(
                            Math.abs(gridX - gameState.currentPlayerChunkX),
                            Math.abs(gridZ - gameState.currentPlayerChunkZ)
                        );
                        withinPhysicsRadius = chunkDist <= CONFIG.CHUNKS.PHYSICS_RADIUS;
                    }

                    // Only add natural objects (trees/rocks) to scene if within physics radius
                    // Outside physics radius they're billboard-only (no Object3D in scene)
                    // Structures always added to scene
                    if (!isNaturalObject || withinPhysicsRadius) {
                        scene.add(instance);
                        instance.userData.addedToScene = true;
                    } else {
                        instance.userData.addedToScene = false;
                    }

                    // Create billboards for trees (for LOD system) - always, regardless of distance
                    if (isTree) {
                        // Far billboard (single rotating)
                        if (this.billboardSystem) {
                            const billboardIndex = this.billboardSystem.addTreeBillboard(
                                instance,
                                modelType,
                                position
                            );
                            instance.userData.billboardIndex = billboardIndex;
                        }
                        // Cross billboard and 3D models DISABLED for performance
                        // Using only single rotating billboard (BillboardSystem) for all trees
                    }

                    // Create billboards for rocks - always, regardless of distance
                    if (isRock) {
                        if (this.billboardSystem) {
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

                        if (withinPhysicsRadius) {
                            const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[modelType];
                            if (dims) {
                                let shape;
                                let collisionGroup;

                                // Determine shape type
                                if (dims.radius !== undefined) {
                                    // Cylinder for trees, rocks, bear dens
                                    shape = {
                                        type: 'cylinder',
                                        radius: dims.radius,
                                        height: dims.height || 1.0
                                    };
                                    // Determine collision group for cylindrical objects
                                    if (modelType === 'bearden') {
                                        collisionGroup = COLLISION_GROUPS.STRUCTURE;
                                    } else {
                                        collisionGroup = COLLISION_GROUPS.NATURAL;
                                    }
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

                                if (collider) {
                                    instance.userData.physicsHandle = collider;
                                }
                            }
                        }
                    }

                    objects.push(instance);

                    // Track position
                    if (minDistance > 0) {
                        placedPositions.push({
                            x: posX,
                            z: posZ,
                            minDistance: minDistance
                        });
                    }
                }
            } else {
                // Still advance RNG even if height check fails
                rng.next(); // scale
                rng.next(); // rotation
                rng.range(1, 101); // quality
            }
        }

        return { objects, endIndex, placedPositions };
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

            // Check if this is an occupied outpost and handle death
            if (obj.userData.modelType === 'outpost' && obj.userData.objectId) {
                // Access game instance through scene.userData if available
                const game = scene.userData?.game;
                if (game && game.occupiedOutposts && game.occupiedOutposts.has(obj.userData.objectId)) {
                    const occupantId = game.occupiedOutposts.get(obj.userData.objectId);

                    // Kill local player if they're the occupant (use full death manager for vehicle cleanup)
                    if (occupantId === game.gameState.clientId && !game.isDead) {
                        if (game.deathManager) {
                            game.deathManager.killEntity(
                                game.playerObject, false, false, 'Outpost destroyed'
                            );
                        } else {
                            game.playerCombat.die();
                        }
                    }

                    // Clear occupancy
                    game.occupiedOutposts.delete(obj.userData.objectId);
                }
            }

            // Remove physics collider FIRST (critical for performance!)
            if (physicsManager && obj.userData.objectId) {
                physicsManager.removeCollider(obj.userData.objectId);
            }

            // Remove terrain leveling for structures
            const game = scene.userData?.game;
            if (game && game.terrainGenerator && obj.userData.modelType) {
                const structuresToLevel = ['crate', 'house', 'outpost', 'tent', 'market', 'tileworks', 'bakery', 'gardener', 'miner', 'woodcutter', 'stonemason'];
                if (structuresToLevel.includes(obj.userData.modelType)) {
                    const removed = game.terrainGenerator.removeLeveledArea(
                        obj.position.x,
                        obj.position.z
                    );
                    if (removed && game.clipmap) {
                        // Force terrain refresh
                        const dims = window.CONFIG?.CONSTRUCTION?.GRID_DIMENSIONS?.[obj.userData.modelType];
                        const radius = dims ? Math.max(dims.width || 1, dims.depth || 1) / 2 + 2 : 3;
                        game.clipmap.forceRefreshRegion(obj.position.x, obj.position.z, radius);
                    }
                }
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

// Preload growing tree models (separate keys to avoid conflicts with RockModelSystem)
modelManager.loadModel('pine_growing', './models/pine.glb');
modelManager.loadModel('apple_growing', './models/apple.glb');

function removeObjects(scene, objects, physicsManager = null) {
    objectPlacer.removeObjects(scene, objects, physicsManager);
}

// Batch generation function for frame-budgeted processing
function generateChunkObjectsBatch(
    scene, heightCalculator, worldX, worldZ, seed, chunkSize,
    modelType, startIndex, batchSize, removedObjectIds, addedObjectIds,
    neighborPositions, gameState, chunkSeed, placedPositions
) {
    return objectPlacer.generateChunkObjectsBatch(
        scene, heightCalculator, worldX, worldZ, seed, chunkSize,
        modelType, startIndex, batchSize, removedObjectIds, addedObjectIds,
        neighborPositions, gameState, chunkSeed, placedPositions
    );
}

// Export functions and systems
export {
    removeObjects,
    generateChunkObjectsBatch,
    modelManager,
    objectPlacer,
    ModelManager,
    ObjectPlacer,
    SeededRandom,
    MODEL_CONFIG
};
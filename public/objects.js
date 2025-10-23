// File: public/objects.js
// Location: C:\Users\colli\Desktop\test Horses\Horses\public\objects.js

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BlobShadow } from './blobshadow.js';

// ==========================================
// CONFIGURATION
// ==========================================
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
        scaleRange: { min: 0.05, max: 0.15 },
        density: 1.0,
        category: 'vegetation'
    },
    fir: {
        path: './models/fir.glb',
        heightRange: { min: 1.9, max: 3.0 },
        scaleRange: { min: 0.05, max: 0.15 },
        density: 1.0,
        category: 'vegetation'
    },
    pine: {
        path: './models/pine.glb',
        heightRange: { min: 2.8, max: 4.5 },
        scaleRange: { min: 0.05, max: 0.1 },
        density: 1.0,
        category: 'vegetation'
    },
    cypress: {
        path: './models/cypress.glb',
        heightRange: { min: 1.3, max: 2.0 },
        scaleRange: { min: 0.015, max: 0.055 },
        density: 0.3,
        category: 'vegetation'
    },
    log: {
        path: './models/log.glb',
        heightRange: { min: 1.2, max: 1.28 },
        scaleRange: { min: 0.02, max: 0.05 },
        density: 0,  // Not naturally spawned - use tree-specific logs instead
        category: 'vegetation'
    },
    oak_log: {
        path: './models/log.glb',
        heightRange: { min: 1.2, max: 1.28 },
        scaleRange: { min: 0.02, max: 0.05 },
        density: 0.075,  // 1/4 of original log density (0.3 / 4)
        category: 'vegetation'
    },
    pine_log: {
        path: './models/log.glb',
        heightRange: { min: 1.2, max: 1.28 },
        scaleRange: { min: 0.02, max: 0.05 },
        density: 0.075,  // 1/4 of original log density (0.3 / 4)
        category: 'vegetation'
    },
    fir_log: {
        path: './models/log.glb',
        heightRange: { min: 1.2, max: 1.28 },
        scaleRange: { min: 0.02, max: 0.05 },
        density: 0.075,  // 1/4 of original log density (0.3 / 4)
        category: 'vegetation'
    },
    cypress_log: {
        path: './models/log.glb',
        heightRange: { min: 1.2, max: 1.28 },
        scaleRange: { min: 0.02, max: 0.05 },
        density: 0.075,  // 1/4 of original log density (0.3 / 4)
        category: 'vegetation'
    },
    limestone: {
        path: './models/limestone.glb',
        heightRange: { min: 1.04, max: 5.0 },
        scaleRange: { min: 0.05, max: 0.2 },
        density: 0.3,
        category: 'prop'
    },
    sandstone: {
        path: './models/sandstone.glb',
        heightRange: { min: 4.04, max: 7.0 },
        scaleRange: { min: 0.05, max: 0.2 },
        density: 0.3,
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
    foundation: {
        path: './models/foundation.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    foundationcorner: {
        path: './models/foundationcorner.glb',
        heightRange: { min: 0, max: 0 },
        scaleRange: { min: 0, max: 0 },
        density: 0,
        category: 'structure'
    },
    foundationroundcorner: {
        path: './models/foundationroundcorner.glb',
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
                console.log('All models loaded successfully');
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

                    console.log(`${name} model loaded successfully (size: ${diameter.toFixed(2)})`);
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


            //console.log('Created instance, userData:', instance.userData); // Add this


        instance.position.copy(position);
        instance.scale.setScalar(scale);
        instance.rotation.y = rotationY;

        // Apply material fixes
        instance.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                if (child.material) {
                    this.fixTransparency(child.material);
                }
            }
        });

        // Add blob shadow based on object type (if scene is provided)
        if (scene) {
            // Get model's actual bounding box size
            const modelSize = this.modelManager.getModelSize(modelType);

            // Calculate shadow size: model size * scale
            // Add a small multiplier (1.2) to make shadows slightly larger than the model
            const shadowSize = modelSize ? (modelSize * scale * 1.2) : (0.75 * scale);

            // Create and attach blob shadow to the instance (darker opacity: 0.5)
            const shadow = new BlobShadow(instance, scene, shadowSize, 0.5);
            instance.userData.blobShadow = shadow;
        }

        return instance;
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
            removedObjectIds = null // Pass in removed objects to skip creation
        } = params;

        const objects = [];
        const halfSize = chunkSize / 2;

        // Create chunk-specific seed for deterministic generation
        const gridX = Math.floor(worldX / chunkSize);
        const gridZ = Math.floor(worldZ / chunkSize);
        const chunkSeed = seed + gridX * 73856093 + gridZ * 19349663;

        let totalGenerated = 0;
        let totalSkipped = 0;

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

                    // NOW check if this object was removed by a player
                    if (removedObjectIds && removedObjectIds.has(objectId)) {
                        totalSkipped++;
                        continue;
                    }

                    // Create and place object
                    const position = new THREE.Vector3(posX, terrainHeight + 0.1, posZ);
                    const instance = this.createInstance(modelType, position, scale, rotation, scene);

if (instance) {
    instance.userData.objectId = objectId;
    instance.userData.chunkKey = `${gridX},${gridZ}`;
    instance.userData.quality = quality;

    // Add resources for logs (all log types: log, oak_log, pine_log, etc.)
    if (modelType === 'log' || modelType.endsWith('_log')) {
        const totalResources = Math.floor(scale * 100);
        instance.userData.totalResources = totalResources;
        instance.userData.remainingResources = totalResources;
    }

    // Add resources for rocks (limestone, sandstone)
    if (modelType === 'limestone' || modelType === 'sandstone') {
        const totalResources = Math.floor(scale * 100);
        instance.userData.totalResources = totalResources;
        instance.userData.remainingResources = totalResources;
    }

    scene.add(instance);
    objects.push(instance);
    totalGenerated++;

    // Update blob shadow position to terrain with normal alignment and left offset
    if (instance.userData.blobShadow) {
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
    }
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
    removeObjects(scene, objects) {
        objects.forEach(obj => {
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
        console.log(`Removed ${objects.length} objects`);
    }


findObjectById(scene, objectId) {
    let foundObject = null;
    scene.traverse((object) => {
        if (object.userData && object.userData.objectId === objectId) {
            foundObject = object;
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
function addTree(scene, heightCalculator, position, modelType = 'oak', scale = 0.2, rotationY = 0) {
    const terrainHeight = heightCalculator.calculateHeight(position.x, position.z);
    const pos = new THREE.Vector3(position.x, terrainHeight + 0.1, position.z);
    const instance = objectPlacer.createInstance(modelType, pos, scale, rotationY);
    
    if (instance) {
        scene.add(instance);
    }
    return instance;
}

function addTreesToChunk(scene, heightCalculator, worldX, worldZ, seed, chunkSize = 50, numTrees = 500, removedObjectIds = null) {
    return objectPlacer.generateChunkObjects({
        scene,
        heightCalculator,
        worldX,
        worldZ,
        seed,
        chunkSize,
        objectsPerType: numTrees,
        removedObjectIds
    });
}

function removeTrees(scene, trees) {
    objectPlacer.removeObjects(scene, trees);
}

// Export both legacy functions and new system
export {
    // Legacy compatibility
    addTree,
    addTreesToChunk,
    removeTrees,

    
    // New system
    modelManager,
    objectPlacer,
    ModelManager,
    ObjectPlacer,
    SeededRandom,
    MODEL_CONFIG
};
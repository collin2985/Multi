// objects.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ==========================================
// CONFIGURATION
// ==========================================

const MODEL_CONFIG = {
    tree96: {
        path: './models/tree96.glb',
        heightRange: { min: 1.3, max: 2.0 },
        scaleRange: { min: 0.05, max: 0.15 },
        density: 1.0,
        category: 'vegetation'
    },
    tree92: {
        path: './models/tree92.glb',
        heightRange: { min: 1.9, max: 4.5 },
        scaleRange: { min: 0.05, max: 0.15 },
        density: 1.0,
        category: 'vegetation'
    },
    tree97: {
        path: './models/tree97.glb',
        heightRange: { min: 2.5, max: 3.5 },
        scaleRange: { min: 0.05, max: 0.1 },
        density: 1.0,
        category: 'vegetation'
    },
    tree98: {
        path: './models/tree98.glb',
        heightRange: { min: 1.3, max: 2.0 },
        scaleRange: { min: 0.015, max: 0.055 },
        density: 0.3,
        category: 'vegetation'
    },
    deadtree: {
        path: './models/deadtree.glb',
        heightRange: { min: 1.2, max: 1.28 },
        scaleRange: { min: 0.02, max: 0.05 },
        density: 0.3,
        category: 'vegetation'
    },
    rock1: {
        path: './models/rock1.glb',
        heightRange: { min: 1.04, max: 7.0 },
        scaleRange: { min: 0.05, max: 0.2 },
        density: 1.0,
        category: 'prop'
    }
};

// ==========================================
// MODEL MANAGER CLASS
// ==========================================

class ModelManager {
    constructor() {
        this.models = new Map();
        this.loader = new GLTFLoader();
        this.loadingPromises = new Map();
    }

    /**
     * Load all models defined in configuration
     * @returns {Promise} Resolves when all models are loaded
     */
    async loadAllModels() {
        const loadPromises = Object.entries(MODEL_CONFIG).map(([name, config]) => 
            this.loadModel(name, config.path)
        );
        
        try {
            await Promise.all(loadPromises);
            console.log('All models loaded successfully');
        } catch (error) {
            console.error('Error loading models:', error);
        }
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
                    console.log(`${name} model loaded successfully`);
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
     * Check if a model is loaded
     * @param {string} name - Model identifier
     * @returns {boolean} True if model is loaded
     */
    isModelLoaded(name) {
        return this.models.has(name);
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
     * @returns {THREE.Object3D|null} Created instance or null
     */
    createInstance(modelType, position, scale, rotationY) {
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

        // Apply material fixes and shadow settings
        instance.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                
                if (child.material) {
                    this.fixTransparency(child.material);
                }
            }
        });

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
            objectsPerType = 500
        } = params;

        const objects = [];
        const halfSize = chunkSize / 2;

        // Create chunk-specific seed for deterministic generation
        const gridX = Math.floor(worldX / chunkSize);
        const gridZ = Math.floor(worldZ / chunkSize);
        const chunkSeed = seed + gridX * 73856093 + gridZ * 19349663;

        // Process each model type
        Object.entries(MODEL_CONFIG).forEach(([modelType, config], index) => {
            // Create unique seed for this model type within the chunk
            const typeSeed = chunkSeed + index * 31337;
            const rng = new SeededRandom(typeSeed);
            
            const numObjects = Math.floor(objectsPerType * config.density);
            
            for (let i = 0; i < numObjects; i++) {
                // Generate position within chunk
                const offsetX = rng.range(-halfSize, halfSize);
                const offsetZ = rng.range(-halfSize, halfSize);
                const posX = worldX + offsetX;
                const posZ = worldZ + offsetZ;
                
                // Check height constraints
                const terrainHeight = heightCalculator.calculateHeight(posX, posZ);
                if (terrainHeight >= config.heightRange.min && 
                    terrainHeight <= config.heightRange.max) {
                    
                    // Generate scale and rotation
                    const scale = rng.range(config.scaleRange.min, config.scaleRange.max);
                    const rotation = rng.next() * Math.PI * 2;
                    
                    // Create and place object
                    const position = new THREE.Vector3(posX, terrainHeight + 0.1, posZ);
                    const instance = this.createInstance(modelType, position, scale, rotation);
                    
if (instance) {
    instance.userData.objectId = `${gridX},${gridZ}_${modelType}_${i}`;
    instance.userData.chunkKey = `${gridX},${gridZ}`;
    scene.add(instance);
    objects.push(instance);
}
                }
            }
        });

        //console.log(`Generated ${objects.length} objects for chunk at (${worldX}, ${worldZ})`);
        return objects;
    }

    /**
     * Remove and dispose of objects
     * @param {THREE.Scene} scene - Scene to remove from
     * @param {Array} objects - Objects to remove
     */
    removeObjects(scene, objects) {
        objects.forEach(obj => {
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
function addTree(scene, heightCalculator, position, modelType = 'tree96', scale = 0.2, rotationY = 0) {
    const terrainHeight = heightCalculator.calculateHeight(position.x, position.z);
    const pos = new THREE.Vector3(position.x, terrainHeight + 0.1, position.z);
    const instance = objectPlacer.createInstance(modelType, pos, scale, rotationY);
    
    if (instance) {
        scene.add(instance);
    }
    return instance;
}

function addTreesToChunk(scene, heightCalculator, worldX, worldZ, seed, chunkSize = 50, numTrees = 500) {
    return objectPlacer.generateChunkObjects({
        scene,
        heightCalculator,
        worldX,
        worldZ,
        seed,
        chunkSize,
        objectsPerType: numTrees
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
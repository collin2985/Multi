import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import ChunkCoordinates from './core/ChunkCoordinates.js';
import { CONFIG } from './config.js';

/**
 * RockModelSystem - Manages instanced 3D rock models with distance-based LOD fading
 * Supports limestone, sandstone, clay, and iron rock types
 *
 * LOD distances:
 * - 0-25: Full opacity 3D model
 * - 25-35: Fade out 3D model
 * - 35+: Hidden (billboard takes over)
 */
export class RockModelSystem {
    constructor(scene, treeModelsEnabled = false) {
        this.scene = scene;
        this.treeModelsEnabled = treeModelsEnabled;

        // Base rock types (always loaded)
        this.rockTypes = ['limestone', 'sandstone', 'clay', 'iron'];

        // Add trees on HIGH quality
        if (treeModelsEnabled) {
            this.rockTypes.push(...CONFIG.TREE_MODEL_TYPES);
        }

        // Track types with successfully loaded models (for BillboardSystem LOD decisions)
        this.workingModelTypes = new Set();
        this.instancedMeshes = new Map(); // rockType -> Array of InstancedMeshes
        this.instanceData = new Map(); // rockObject -> {rockType, index, position, rotation, baseScale}
        this.availableIndices = new Map(); // rockType -> Set of available indices
        this.activeCount = new Map(); // rockType -> count
        this.opacityArrays = new Map(); // rockType -> Float32Array
        this.pendingInstances = new Map(); // rockType -> Array of pending instances
        this.modelLoaded = new Map(); // rockType -> boolean

        // Per-type instance limits (trees use far fewer slots - complex models)
        this.maxInstancesPerType = new Map();
        const rockMax = CONFIG.ROCK_MODEL_MAX_INSTANCES || 50000;
        const treeMax = CONFIG.TREE_MODEL_MAX_INSTANCES || 500;
        for (const type of this.rockTypes) {
            this.maxInstancesPerType.set(type, CONFIG.TREE_MODEL_TYPES.includes(type) ? treeMax : rockMax);
        }

        // LOD distances
        this.fadeStart = 25;  // Start fading at this distance
        this.fadeEnd = 35;    // Fully hidden at this distance

        // Configurable display parameters per rock type
        this.rockConfig = {
            limestone: { scale: 1.0, yOffset: 0 },
            sandstone: { scale: 1.0, yOffset: 0 },
            clay: { scale: 1.0, yOffset: 0 },
            iron: { scale: 1.0, yOffset: 0 }
        };

        // Add tree configs from centralized list
        for (const treeType of CONFIG.TREE_MODEL_TYPES) {
            this.rockConfig[treeType] = { scale: 1.0, yOffset: 0 };
        }

        // Batch update flags
        this.needsMatrixUpdate = new Map();
        this.needsOpacityUpdate = new Map();

        // Spatial partitioning: track rocks by chunk for efficient LOD updates
        this.rocksByChunk = new Map(); // chunkKey -> Set of rockObjects

        // Reusable objects to avoid per-object allocations (ISSUE-074)
        this._tempMatrix = new THREE.Matrix4();
        this._tempQuaternion = new THREE.Quaternion();
        this._tempPosition = new THREE.Vector3();
        this._tempScale = new THREE.Vector3();
        this._yAxis = new THREE.Vector3(0, 1, 0);

        // Debug mode - shows all models at full opacity regardless of distance
        this.debugShowAll = false;

        // Dynamic tree instance management
        this.billboardSystem = null; // Set from GameInitializer
        this._treeRecycleCounter = 0;
        this._treeRecycleInterval = 1; // Every call (updateRockModels already throttled to every 60 game frames)

        // Initialize tracking structures
        for (const rockType of this.rockTypes) {
            this.instancedMeshes.set(rockType, []);
            this.availableIndices.set(rockType, new Set());
            this.activeCount.set(rockType, 0);
            this.pendingInstances.set(rockType, []);
            this.modelLoaded.set(rockType, false);
            this.needsMatrixUpdate.set(rockType, false);
            this.needsOpacityUpdate.set(rockType, false);
        }

        this.loadModels();
    }

    async loadModels() {
        const loader = new GLTFLoader();

        // Set up DRACO decoder for compressed models
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
        loader.setDRACOLoader(dracoLoader);

        for (const rockType of this.rockTypes) {
            this.loadModel(loader, rockType);
        }
    }

    async loadModel(loader, rockType) {
        try {
            const cacheBust = localStorage.getItem('serverVersion') || Date.now();
            const gltf = await loader.loadAsync(`./models/${rockType}.glb?v=${cacheBust}`);

            // Collect all meshes from the model
            const meshes = [];
            gltf.scene.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    meshes.push(child);
                }
            });

            if (meshes.length === 0) {
                console.error(`[RockModelSystem] Could not find any meshes in ${rockType}.glb`);
                return;
            }

            // Initialize opacity array
            const maxInst = this.maxInstancesPerType.get(rockType);
            const opacityArray = new Float32Array(maxInst);
            opacityArray.fill(0);
            this.opacityArrays.set(rockType, opacityArray);

            const instancedMeshesForType = [];

            // Create an InstancedMesh for each mesh in the model
            for (const mesh of meshes) {
                const geometry = mesh.geometry.clone();

                // Apply the mesh's world transform to the geometry
                // This bakes in any scale/rotation from the GLB hierarchy
                mesh.updateWorldMatrix(true, false);
                geometry.applyMatrix4(mesh.matrixWorld);

                let baseMaterial = mesh.material;
                if (Array.isArray(baseMaterial)) {
                    baseMaterial = baseMaterial[0];
                }

                // Iron's embedded texture is extremely dark - brighten it
                if (rockType === 'iron' && baseMaterial.color) {
                    baseMaterial.color.setRGB(2.5, 2.5, 2.5);
                }

                // Darken tree models to better match billboard appearance
                if (rockType === 'apple' && baseMaterial.color) {
                    baseMaterial.color.multiplyScalar(0.6);
                }
                if (rockType === 'pine' && baseMaterial.color) {
                    baseMaterial.color.multiplyScalar(0.7);
                }

                // Create custom shader material with per-instance opacity
                const instancedMaterial = this.createInstancedMaterial(baseMaterial);

                // Create InstancedMesh
                const instancedMesh = new THREE.InstancedMesh(
                    geometry,
                    instancedMaterial,
                    maxInst
                );

                instancedMesh.name = `${rockType}_3d_${mesh.name}`;
                instancedMesh.frustumCulled = false;
                instancedMesh.castShadow = false;
                instancedMesh.receiveShadow = false;
                instancedMesh.renderOrder = 100;
                instancedMesh.count = 0;

                // Add opacity buffer attribute
                const opacityBuffer = new THREE.InstancedBufferAttribute(opacityArray, 1);
                geometry.setAttribute('instanceOpacity', opacityBuffer);

                // Initialize all instances as hidden
                const matrix = new THREE.Matrix4();
                for (let i = 0; i < maxInst; i++) {
                    matrix.makeScale(0, 0, 0);
                    instancedMesh.setMatrixAt(i, matrix);
                }
                instancedMesh.instanceMatrix.needsUpdate = true;

                this.scene.add(instancedMesh);
                instancedMeshesForType.push(instancedMesh);
            }

            this.instancedMeshes.set(rockType, instancedMeshesForType);

            // Initialize available indices
            const indices = new Set();
            for (let i = 0; i < maxInst; i++) {
                indices.add(i);
            }
            this.availableIndices.set(rockType, indices);

            this.modelLoaded.set(rockType, true);
            this.workingModelTypes.add(rockType);

            // Process pending instances
            const pending = this.pendingInstances.get(rockType);
            if (pending.length > 0) {
                for (const p of pending) {
                    this.addRockInstanceInternal(p.rockObject, p.rockType, p.position, p.rotation, p.baseScale);
                }
                this.pendingInstances.set(rockType, []);
            }

        } catch (error) {
            console.error(`[RockModelSystem] Failed to load ${rockType}.glb:`, error);
        }
    }

    /**
     * Create material with per-instance opacity support
     */
    createInstancedMaterial(baseMaterial) {
        const material = baseMaterial.clone();
        material.transparent = true;
        material.depthWrite = true;
        material.alphaTest = 0.5;
        material.side = THREE.DoubleSide;
        material.needsUpdate = true;

        material.onBeforeCompile = (shader) => {
            shader.vertexShader = shader.vertexShader.replace(
                '#include <common>',
                `#include <common>
                attribute float instanceOpacity;
                varying float vInstanceOpacity;`
            );

            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>
                vInstanceOpacity = instanceOpacity;`
            );

            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <common>',
                `#include <common>
                varying float vInstanceOpacity;`
            );

            // Inject opacity logic before final closing brace (works with any shader)
            shader.fragmentShader = shader.fragmentShader.replace(
                /}\s*$/,
                `   if (vInstanceOpacity < 0.01) discard;
                    gl_FragColor.a *= vInstanceOpacity;
                    if (gl_FragColor.a < 0.5) discard;
                }`
            );
        };

        material.customProgramCacheKey = () => {
            return 'rock_instanced_opacity';
        };

        return material;
    }

    /**
     * Add a rock instance
     * @param {THREE.Object3D} rockObject - The rock object for tracking
     * @param {string} rockType - 'limestone', 'sandstone', or 'clay'
     * @param {THREE.Vector3} position - World position
     * @param {number} rotation - Y rotation in radians
     * @param {number} baseScale - Scale multiplier
     * @returns {number} Instance index or -1 if failed
     */
    addRockInstance(rockObject, rockType, position, rotation = 0, baseScale = 1) {
        if (!this.rockTypes.includes(rockType)) {
            return -1;
        }

        // If model isn't loaded yet, queue the instance
        if (!this.modelLoaded.get(rockType) || this.instancedMeshes.get(rockType).length === 0) {
            this.pendingInstances.get(rockType).push({
                rockObject,
                rockType,
                position: position.clone(),
                rotation,
                baseScale
            });
            return -1;
        }

        return this.addRockInstanceInternal(rockObject, rockType, position, rotation, baseScale);
    }

    addRockInstanceInternal(rockObject, rockType, position, rotation, baseScale) {
        const availableSet = this.availableIndices.get(rockType);
        if (availableSet.size === 0) {
            return -1; // Silently fall back to billboard-only
        }

        const index = availableSet.values().next().value;
        availableSet.delete(index);

        // Calculate chunk key for spatial partitioning
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(position.x, position.z);
        const chunkKey = `${chunkX},${chunkZ}`;

        // Store mapping
        this.instanceData.set(rockObject, {
            rockType,
            index,
            position: position.clone(),
            rotation,
            baseScale,
            chunkKey
        });

        // Add to chunk tracking
        if (!this.rocksByChunk.has(chunkKey)) {
            this.rocksByChunk.set(chunkKey, new Set());
        }
        this.rocksByChunk.get(chunkKey).add(rockObject);

        // Set transform matrix
        this.updateInstanceMatrix(rockType, index, position, rotation, baseScale);

        // Set initial opacity to 0 - LOD update will set correct opacity
        // This prevents rocks in distant chunks from being visible before LOD runs
        const opacityArray = this.opacityArrays.get(rockType);
        opacityArray[index] = 0;

        // Mark for batch update
        this.needsMatrixUpdate.set(rockType, true);
        this.needsOpacityUpdate.set(rockType, true);

        // Update render count
        const currentCount = this.activeCount.get(rockType);
        if (index + 1 > currentCount) {
            this.activeCount.set(rockType, index + 1);
            for (const mesh of this.instancedMeshes.get(rockType)) {
                mesh.count = index + 1;
            }
        }

        return index;
    }

    updateInstanceMatrix(rockType, index, position, rotation, baseScale) {
        const config = this.rockConfig[rockType];

        // Reuse temp objects (ISSUE-074)
        this._tempQuaternion.setFromAxisAngle(this._yAxis, rotation);

        const finalScale = baseScale * config.scale;
        this._tempPosition.set(
            position.x,
            position.y + config.yOffset,
            position.z
        );
        this._tempScale.set(finalScale, finalScale, finalScale);

        this._tempMatrix.compose(
            this._tempPosition,
            this._tempQuaternion,
            this._tempScale
        );

        for (const mesh of this.instancedMeshes.get(rockType)) {
            mesh.setMatrixAt(index, this._tempMatrix);
        }
    }

    /**
     * Remove a rock instance
     */
    removeRockInstance(rockObject) {
        const data = this.instanceData.get(rockObject);
        if (!data) return;

        const { rockType, index, chunkKey } = data;

        // Hide by setting scale to 0 (ISSUE-074: reuse matrix, use batch flag)
        this._tempMatrix.makeScale(0, 0, 0);
        for (const mesh of this.instancedMeshes.get(rockType)) {
            mesh.setMatrixAt(index, this._tempMatrix);
        }
        this.needsMatrixUpdate.set(rockType, true);

        // Remove from chunk tracking
        const chunkRocks = this.rocksByChunk.get(chunkKey);
        if (chunkRocks) {
            chunkRocks.delete(rockObject);
            if (chunkRocks.size === 0) {
                this.rocksByChunk.delete(chunkKey);
            }
        }

        // Return index to pool
        this.availableIndices.get(rockType).add(index);
        this.instanceData.delete(rockObject);
    }

    /**
     * Enable/disable debug mode that shows all models at full opacity
     */
    setDebugShowAll(enabled) {
        this.debugShowAll = enabled;
        // Force immediate opacity update for all rocks
        if (enabled) {
            for (const rockType of this.rockTypes) {
                const opacityArray = this.opacityArrays.get(rockType);
                if (opacityArray) {
                    for (let i = 0; i < opacityArray.length; i++) {
                        opacityArray[i] = 1;
                    }
                    this.needsOpacityUpdate.set(rockType, true);
                }
            }
        }
    }

    /**
     * Update rock model opacity based on camera distance
     * Called every few frames from game loop
     */
    updateRockModels(cameraPosition) {
        // Apply pending batch updates first
        for (const rockType of this.rockTypes) {
            if (this.needsMatrixUpdate.get(rockType)) {
                for (const mesh of this.instancedMeshes.get(rockType)) {
                    mesh.instanceMatrix.needsUpdate = true;
                }
                this.needsMatrixUpdate.set(rockType, false);
            }
        }

        // Pre-calculate squared distances
        const fadeStartSq = this.fadeStart * this.fadeStart;
        const fadeEndSq = this.fadeEnd * this.fadeEnd;
        const fadeRange = this.fadeEnd - this.fadeStart;

        const skipNearSq = fadeStartSq * 0.7;
        const skipFarSq = fadeEndSq * 1.3;

        const camX = cameraPosition.x;
        const camZ = cameraPosition.z;

        // Get camera chunk and only check nearby chunks
        const { chunkX: camChunkX, chunkZ: camChunkZ } = ChunkCoordinates.worldToChunk(camX, camZ);

        const opacityChanged = new Map();
        for (const rockType of this.rockTypes) {
            opacityChanged.set(rockType, false);
        }

        // Only iterate rocks in nearby chunks (3x3 grid around camera)
        const chunkKeys = ChunkCoordinates.get3x3ChunkKeys(camChunkX, camChunkZ);
        for (const chunkKey of chunkKeys) {
            const rocksInChunk = this.rocksByChunk.get(chunkKey);
            if (!rocksInChunk) continue;

            for (const rockObject of rocksInChunk) {
                const data = this.instanceData.get(rockObject);
                if (!data) continue;

                const { rockType, index, position } = data;
                const opacityArray = this.opacityArrays.get(rockType);
                if (!opacityArray) continue;

                const currentOpacity = opacityArray[index];

                // Calculate squared distance (XZ plane only)
                const distX = position.x - camX;
                const distZ = position.z - camZ;
                const distSq = distX * distX + distZ * distZ;

                // Skip stable rocks
                if (distSq < skipNearSq && currentOpacity === 1) continue;
                if (distSq > skipFarSq && currentOpacity === 0) continue;

                let opacity;

                if (this.debugShowAll) {
                    opacity = 1;
                } else if (distSq < fadeStartSq) {
                    opacity = 1;
                } else if (distSq < fadeEndSq) {
                    const distance = Math.sqrt(distSq);
                    opacity = 1 - (distance - this.fadeStart) / fadeRange;
                } else {
                    opacity = 0;
                }

                if (Math.abs(currentOpacity - opacity) > 0.02) {
                    opacityArray[index] = opacity;
                    opacityChanged.set(rockType, true);
                }
            }
        }

        // Apply opacity updates
        for (const rockType of this.rockTypes) {
            if (opacityChanged.get(rockType) || this.needsOpacityUpdate.get(rockType)) {
                for (const mesh of this.instancedMeshes.get(rockType)) {
                    const opacityAttribute = mesh.geometry.attributes.instanceOpacity;
                    if (opacityAttribute) {
                        opacityAttribute.needsUpdate = true;
                    }
                }
                this.needsOpacityUpdate.set(rockType, false);
            }
        }

        // Dynamic tree instance management - recycle distant, add nearby
        if (this.treeModelsEnabled && this.billboardSystem) {
            this._treeRecycleCounter++;
            if (this._treeRecycleCounter >= this._treeRecycleInterval) {
                this._treeRecycleCounter = 0;
                this._recycleTreeInstances(camX, camZ, chunkKeys);
            }
        }
    }

    /**
     * Recycle distant tree 3D instances and assign them to nearby trees.
     * Only runs for tree model types (pine, apple). Rocks use large pools and don't need this.
     */
    _recycleTreeInstances(camX, camZ, nearChunkKeys) {
        const recycleDistSq = 60 * 60; // Remove tree instances beyond 60 units

        // Step 1: Collect distant tree instances to remove (can't modify map during iteration)
        const toRemove = [];
        for (const [chunkKey, objectsInChunk] of this.rocksByChunk) {
            if (nearChunkKeys.includes(chunkKey)) continue;

            for (const obj of objectsInChunk) {
                const data = this.instanceData.get(obj);
                if (!data) continue;
                if (!CONFIG.TREE_MODEL_TYPES.includes(data.rockType)) continue;

                const dx = data.position.x - camX;
                const dz = data.position.z - camZ;
                if (dx * dx + dz * dz > recycleDistSq) {
                    toRemove.push(obj);
                }
            }
        }
        for (const obj of toRemove) {
            this.removeRockInstance(obj);
        }

        // Step 2: Add nearby trees that lack 3D instances
        for (const chunkKey of nearChunkKeys) {
            const billboardTrees = this.billboardSystem.treesByChunk.get(chunkKey);
            if (!billboardTrees) continue;

            for (const treeObj of billboardTrees) {
                if (this.instanceData.has(treeObj)) continue; // Already instanced

                const bbData = this.billboardSystem.instanceData.get(treeObj);
                if (!bbData || !CONFIG.TREE_MODEL_TYPES.includes(bbData.type)) continue;

                const dx = bbData.position.x - camX;
                const dz = bbData.position.z - camZ;
                if (dx * dx + dz * dz < recycleDistSq) {
                    const rotation = treeObj.userData.treeRotation || 0;
                    const scale = treeObj.userData.treeScale || 1;
                    this.addRockInstance(treeObj, bbData.type, bbData.position, rotation, scale);
                }
            }
        }
    }

    /**
     * Check if all rock models are loaded
     */
    isReady() {
        return this.rockTypes.every(type => this.modelLoaded.get(type));
    }

    /**
     * Check if a specific rock type is ready
     */
    isTypeReady(rockType) {
        return this.modelLoaded.get(rockType) && this.instancedMeshes.get(rockType).length > 0;
    }
}

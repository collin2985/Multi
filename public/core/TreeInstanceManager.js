// File: public/core/TreeInstanceManager.js
// Purpose: Manage instanced 3D tree models for high-performance rendering
// Pattern: Based on BillboardSystem.js (already using InstancedMesh successfully)

import * as THREE from 'three';

/**
 * TreeInstanceManager - Manages instanced 3D tree models with per-instance data
 * Converts individual cloned tree meshes to InstancedMesh for massive performance gains
 *
 * Performance Impact:
 * - Before: 200-500+ draw calls (one per tree) = 20 FPS
 * - After: ~5-10 draw calls (one per tree type) = 60+ FPS
 */
export class TreeInstanceManager {
    constructor(scene, modelManager) {
        this.scene = scene;
        this.modelManager = modelManager; // Access to loaded GLB models

        // FEATURE FLAG: Disable by default until fully tested
        this.enabled = false;

        // Control which tree types use instancing (for incremental rollout)
        // Start with one type, expand as testing confirms it works
        this.enabledTreeTypes = []; // Empty = none enabled yet
        // Example: ['pine'] = only pine trees instanced
        // Example: ['pine', 'fir', 'oak', 'cypress', 'apple'] = all trees instanced

        // Tree types available in the game
        this.treeTypes = ['oak', 'fir', 'pine', 'cypress', 'apple'];

        // InstancedMesh storage
        this.instancedMeshes = new Map(); // treeType -> InstancedMesh

        // Instance data storage (replaces mesh objects in objectRegistry)
        this.instanceData = new Map(); // objectId -> instance metadata

        // Index management for reusing slots
        this.availableIndices = new Map(); // treeType -> Set<availableIndex>
        this.nextIndex = new Map(); // treeType -> next unused index

        // Configuration
        this.maxInstancesPerType = 10000; // Increased for 5x5 chunks. High count is OK with instancing!

        console.log('[TreeInstanceManager] Initialized (disabled by default)');
    }

    /**
     * Pre-initialize all InstancedMeshes upfront (call after models are loaded)
     * This ensures they exist before chunks start loading
     */
    preInitializeAllMeshes() {
        console.log('[TreeInstanceManager] Pre-initializing all InstancedMeshes...');
        for (const treeType of this.treeTypes) {
            if (this.isTreeTypeEnabled(treeType)) {
                this.initializeInstancedMesh(treeType);
            }
        }
        console.log('[TreeInstanceManager] Pre-initialization complete');
    }

    /**
     * Check if a tree type should use instancing
     */
    isTreeTypeEnabled(treeType) {
        return this.enabled && this.enabledTreeTypes.includes(treeType);
    }

    /**
     * Initialize InstancedMesh for a specific tree type
     * Called lazily when first tree of that type is added
     */
    initializeInstancedMesh(treeType) {
        if (this.instancedMeshes.has(treeType)) {
            return; // Already initialized
        }

        console.log(`[TreeInstanceManager] Initializing InstancedMesh for ${treeType}`);

        // Get the loaded GLB model
        const model = this.modelManager.getModel(treeType);
        if (!model) {
            console.error(`[TreeInstanceManager] Model ${treeType} not loaded!`);
            return;
        }

        // Extract geometry and material from the GLB model
        // Store the mesh's scale to apply to instances
        let geometry = null;
        let material = null;
        let meshScale = 1.0;

        model.traverse((child) => {
            if (child instanceof THREE.Mesh && !geometry) {
                // Use geometry as-is (don't clone or transform)
                geometry = child.geometry;
                material = child.material;

                // Extract the scale from the mesh's world matrix
                child.updateWorldMatrix(true, false);
                const scaleVector = new THREE.Vector3();
                child.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), scaleVector);
                meshScale = scaleVector.x; // Assume uniform scale

                // DEBUG: Log mesh info
                console.log(`[TreeInstanceManager] ${treeType} mesh found:`, {
                    meshScale: meshScale,
                    scaleVector: scaleVector,
                    position: child.position,
                    geometryVertices: geometry.attributes.position.count
                });
            }
        });

        if (!geometry || !material) {
            console.error(`[TreeInstanceManager] Could not find geometry/material in ${treeType} model`);
            return;
        }

        // Create InstancedMesh
        const instancedMesh = new THREE.InstancedMesh(
            geometry,
            material,
            this.maxInstancesPerType
        );

        instancedMesh.name = `${treeType}_instances`;
        instancedMesh.frustumCulled = true; // Enable frustum culling for instances
        instancedMesh.castShadow = false; // Disable for performance (can enable later)
        instancedMesh.receiveShadow = false;

        // Store the mesh scale for this tree type
        if (!this.meshScales) {
            this.meshScales = new Map();
        }
        this.meshScales.set(treeType, meshScale);

        // Initialize all instances as hidden (scale = 0)
        const matrix = new THREE.Matrix4();
        for (let i = 0; i < this.maxInstancesPerType; i++) {
            matrix.makeScale(0, 0, 0); // Hidden
            instancedMesh.setMatrixAt(i, matrix);
        }
        instancedMesh.instanceMatrix.needsUpdate = true;

        // Add to scene
        this.scene.add(instancedMesh);

        // Verify it was added
        const inScene = this.scene.children.includes(instancedMesh);
        console.log(`[TreeInstanceManager] InstancedMesh added to scene: ${inScene}, scene has ${this.scene.children.length} children`);

        // Store scene reference on the mesh for debugging
        instancedMesh.userData.persistentMesh = true;
        instancedMesh.userData.treeType = treeType;

        // Store references
        this.instancedMeshes.set(treeType, instancedMesh);

        // Initialize index tracking
        this.availableIndices.set(treeType, new Set());
        this.nextIndex.set(treeType, 0);

        console.log(`[TreeInstanceManager] ✓ Created InstancedMesh for ${treeType} (${this.maxInstancesPerType} max instances)`);
    }

    /**
     * Add a tree instance
     * Returns instance index on success, null on failure
     *
     * @param {string} objectId - Unique identifier (e.g., "oak_0_0_42")
     * @param {string} treeType - Tree type (oak, pine, fir, etc.)
     * @param {THREE.Vector3} position - World position
     * @param {number} rotation - Y-axis rotation in radians
     * @param {number} scale - Uniform scale factor
     * @param {Object} userData - Additional data (quality, resources, chunkKey, etc.)
     * @returns {number|null} Instance index or null
     */
    addTreeInstance(objectId, treeType, position, rotation, scale, userData = {}) {
        // Check if this tree type should use instancing
        if (!this.isTreeTypeEnabled(treeType)) {
            return null; // Fall back to regular mesh
        }

        // Initialize InstancedMesh if not already done
        if (!this.instancedMeshes.has(treeType)) {
            this.initializeInstancedMesh(treeType);
        }

        const instancedMesh = this.instancedMeshes.get(treeType);
        if (!instancedMesh) {
            console.error(`[TreeInstanceManager] Failed to get InstancedMesh for ${treeType}`);
            return null;
        }

        // Get an available instance index
        const index = this.allocateIndex(treeType);
        if (index === null) {
            console.warn(`[TreeInstanceManager] No available slots for ${treeType} (max: ${this.maxInstancesPerType})`);
            return null;
        }

        // Get the mesh's base scale and multiply with instance scale
        const meshBaseScale = this.meshScales.get(treeType) || 1.0;
        const finalScale = scale * meshBaseScale;

        // Create transformation matrix
        const matrix = new THREE.Matrix4();
        matrix.compose(
            position,
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation),
            new THREE.Vector3(finalScale, finalScale, finalScale)
        );

        // Instance configured successfully

        // Set matrix for this instance
        instancedMesh.setMatrixAt(index, matrix);

        // Batch GPU updates - only update every 50 instances instead of every instance
        if (!this.updateCounters) {
            this.updateCounters = new Map();
        }
        const counter = (this.updateCounters.get(treeType) || 0) + 1;
        this.updateCounters.set(treeType, counter);

        if (counter % 50 === 0) {
            instancedMesh.instanceMatrix.needsUpdate = true;
        }

        // Store instance data (replaces mesh object in objectRegistry)
        this.instanceData.set(objectId, {
            type: 'instance', // Flag to identify as instance data
            treeType: treeType,
            instanceIndex: index,

            // Spatial data
            position: position.clone(),
            rotation: rotation,
            scale: scale,

            // Resource/quality data
            quality: userData.quality || 100,
            remainingResources: userData.remainingResources || 100,
            totalResources: userData.totalResources || 100,

            // Tracking data
            objectId: objectId,
            chunkKey: userData.chunkKey || '0,0',

            // References
            billboardIndex: userData.billboardIndex || -1,

            // Flags
            isConstructionSite: userData.isConstructionSite || false,

            // Model metadata
            modelType: treeType,
            originalScale: scale
        });

        return index;
    }

    /**
     * Hide a tree instance (when harvested)
     * Sets scale to 0 but keeps data for tracking
     */
    hideInstance(objectId) {
        const data = this.instanceData.get(objectId);
        if (!data) {
            console.warn(`[TreeInstanceManager] No instance data for ${objectId}`);
            return false;
        }

        const { treeType, instanceIndex } = data;
        const instancedMesh = this.instancedMeshes.get(treeType);

        if (!instancedMesh) {
            console.error(`[TreeInstanceManager] No InstancedMesh for ${treeType}`);
            return false;
        }

        // Hide by setting scale to 0
        const matrix = new THREE.Matrix4();
        matrix.makeScale(0, 0, 0);
        instancedMesh.setMatrixAt(instanceIndex, matrix);
        instancedMesh.instanceMatrix.needsUpdate = true;

        // Return index to available pool for reuse
        this.releaseIndex(treeType, instanceIndex);

        // Keep instance data for now (needed for removedObjectsCache tracking)
        // Will be cleaned up when chunk fully unloads

        console.log(`[TreeInstanceManager] ✓ Hid ${treeType} instance ${instanceIndex} (objectId: ${objectId})`);

        return true;
    }

    /**
     * Remove instance data completely (chunk unload)
     */
    removeInstanceData(objectId) {
        this.instanceData.delete(objectId);
    }

    /**
     * Get instance data for an objectId
     * Used by proximity detection, removal, etc.
     */
    getInstanceData(objectId) {
        return this.instanceData.get(objectId);
    }

    /**
     * Check if an objectId is an instanced tree
     */
    isInstancedTree(objectId) {
        return this.instanceData.has(objectId);
    }

    /**
     * Allocate an instance index from the pool
     */
    allocateIndex(treeType) {
        const availableSet = this.availableIndices.get(treeType);

        // Reuse a previously released index if available
        if (availableSet && availableSet.size > 0) {
            const index = availableSet.values().next().value;
            availableSet.delete(index);
            return index;
        }

        // Otherwise use next sequential index
        const nextIdx = this.nextIndex.get(treeType) || 0;
        if (nextIdx >= this.maxInstancesPerType) {
            return null; // No slots available
        }

        this.nextIndex.set(treeType, nextIdx + 1);
        return nextIdx;
    }

    /**
     * Release an instance index back to the pool
     */
    releaseIndex(treeType, index) {
        const availableSet = this.availableIndices.get(treeType);
        if (availableSet) {
            availableSet.add(index);
        }
    }

    /**
     * Get debug info about instance usage
     */
    getDebugInfo() {
        const info = {};
        let totalUsed = 0;

        for (const treeType of this.treeTypes) {
            const nextIdx = this.nextIndex.get(treeType) || 0;
            const availableSet = this.availableIndices.get(treeType);
            const available = availableSet ? availableSet.size : 0;
            const used = nextIdx - available;

            totalUsed += used;

            info[treeType] = {
                enabled: this.isTreeTypeEnabled(treeType),
                used: used,
                available: available,
                total: this.maxInstancesPerType,
                percentage: Math.round((used / this.maxInstancesPerType) * 100)
            };
        }

        info.total = {
            used: totalUsed,
            capacity: this.maxInstancesPerType * this.treeTypes.length,
            percentage: Math.round((totalUsed / (this.maxInstancesPerType * this.treeTypes.length)) * 100)
        };

        return info;
    }

    /**
     * Log usage to console for debugging
     */
    logUsage() {
        console.log('[TreeInstanceManager] Instance Usage:');
        const info = this.getDebugInfo();

        for (const treeType of this.treeTypes) {
            const data = info[treeType];
            const status = data.enabled ? '✓' : '✗';
            console.log(`  ${status} ${treeType}: ${data.used}/${data.total} (${data.percentage}%)`);
        }

        console.log(`  Total: ${info.total.used}/${info.total.capacity} (${info.total.percentage}%)`);
    }

    /**
     * Enable instancing for specific tree types
     * Example: enableTreeTypes(['pine', 'fir'])
     */
    enableTreeTypes(types) {
        this.enabled = true;
        this.enabledTreeTypes = types;
        console.log(`[TreeInstanceManager] Enabled for tree types:`, types);
    }

    /**
     * Disable all instancing (fallback to regular meshes)
     */
    disable() {
        this.enabled = false;
        console.log('[TreeInstanceManager] Disabled - using regular meshes');
    }

    /**
     * Flush pending GPU updates (call after batch creating instances)
     * Forces update of all instance matrices
     */
    flushUpdates() {
        for (const [treeType, mesh] of this.instancedMeshes) {
            mesh.instanceMatrix.needsUpdate = true;
        }
    }

    /**
     * Update 3D tree instance LOD based on camera distance
     * Called every 10 frames from game loop (matches billboard update rate)
     * Hides distant 3D instances (scale=0) so billboards take over
     */
    updateTreeLOD(cameraPosition) {
        if (!this.enabled) return;

        const LOD_DISTANCE = 5; // Reduced from 15 - tree models are 3M triangles each!

        // Debug: Track visible/hidden counts
        let totalVisible = 0;
        let totalHidden = 0;

        // Process each tree type
        for (const treeType of this.treeTypes) {
            if (!this.isTreeTypeEnabled(treeType)) continue;

            const instancedMesh = this.instancedMeshes.get(treeType);
            if (!instancedMesh) continue;

            const meshBaseScale = this.meshScales.get(treeType) || 1.0;
            let needsUpdate = false;

            // Update each instance based on distance
            for (const [objectId, data] of this.instanceData) {
                if (data.treeType !== treeType) continue;

                const { instanceIndex, position, scale: instanceScale } = data;

                // Calculate distance from camera
                const dx = position.x - cameraPosition.x;
                const dz = position.z - cameraPosition.z;
                const distance = Math.sqrt(dx * dx + dz * dz);

                // Determine if instance should be visible
                let targetScale;
                if (distance < LOD_DISTANCE) {
                    // Close: show 3D instance
                    targetScale = instanceScale * meshBaseScale;
                    totalVisible++;
                } else {
                    // Far: hide 3D instance (billboard takes over)
                    targetScale = 0;
                    totalHidden++;
                }

                // Get current matrix and check if update needed
                const matrix = new THREE.Matrix4();
                instancedMesh.getMatrixAt(instanceIndex, matrix);
                const currentScale = matrix.elements[0]; // X scale component

                // Only update if scale changed significantly
                if (Math.abs(currentScale - targetScale) > 0.001) {
                    // Recreate matrix with new scale
                    const finalScale = targetScale;
                    matrix.compose(
                        position,
                        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), data.rotation),
                        new THREE.Vector3(finalScale, finalScale, finalScale)
                    );
                    instancedMesh.setMatrixAt(instanceIndex, matrix);
                    needsUpdate = true;
                }
            }

            // Update GPU buffer if any instances changed
            if (needsUpdate) {
                instancedMesh.instanceMatrix.needsUpdate = true;
            }
        }

        // Debug: Log counts every 60 frames (once per second at 60fps)
        if (!this._lodFrameCount) this._lodFrameCount = 0;
        this._lodFrameCount++;
        if (this._lodFrameCount >= 60) {
            console.log(`[TreeLOD] Visible: ${totalVisible}, Hidden: ${totalHidden}, Total: ${totalVisible + totalHidden}`);
            this._lodFrameCount = 0;
        }
    }
}

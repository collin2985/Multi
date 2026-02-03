/**
 * StructureModelSystem.js
 * Manages LOD transition between 3D structure models (close) and billboards (far)
 *
 * Pattern: Based on RockModelSystem.js with structure-specific thresholds
 *
 * Structures have TWO visual representations:
 * 1. Full 3D model (close range, 0-95 units) - opacity fades 95-105
 * 2. Billboard sprite (far range, 95+ units) - managed by BillboardSystem
 *
 * LOD crossfade zone: 95-105 units (10 unit transition)
 * - Model: opacity 1 at <95, fades 95-105, hidden at >105
 * - Billboard: hidden at <95, fades 95-105, opacity 1 at >105
 *
 * This system controls model opacity with per-material fade for smooth transitions.
 * Materials are cloned per-instance to avoid affecting shared GLTF materials.
 *
 * Usage:
 *   game.structureModelSystem = new StructureModelSystem(scene);
 *   // When structure created: structureModelSystem.registerStructure(object, type, chunkKey);
 *   // In game loop: structureModelSystem.updateStructureModels(playerPos);
 */

import { ChunkCoordinates } from '../core/ChunkCoordinates.js';
import { CONFIG } from '../config.js';

// Structure types that use LOD system
// dock and market excluded - rectangular shapes don't billboard well
const LOD_STRUCTURE_TYPES = new Set([
    'tent', 'outpost', 'campfire', 'horse',
    'house', 'bakery', 'gardener', 'miner', 'woodcutter',
    'stonemason', 'wall', 'tileworks', 'blacksmith', 'ironworks', 'fisherman',
    'boat', 'sailboat', 'ship2', 'bearden', 'crate', 'construction', '2x2construction',
    '2x8construction', '3x3construction', '10x4construction'
]);

export class StructureModelSystem {
    constructor(scene) {
        this.scene = scene;

        // Map: chunkKey -> Set of structure objects
        this.structuresByChunk = new Map();

        // Map: objectId -> { object, type, chunkKey }
        this.structureRegistry = new Map();

        // LOD thresholds - crossfade between 95-105 units (10 unit range)
        // Model: opacity 1 at <95, fades 95-105, hidden at >105
        // Billboard: hidden at <95, fades 95-105, opacity 1 at >105
        this.fadeStart = 95;
        this.fadeEnd = 105;
        this.fadeStartSq = this.fadeStart * this.fadeStart;  // 9025
        this.fadeEndSq = this.fadeEnd * this.fadeEnd;        // 11025
        this.fadeRange = this.fadeEnd - this.fadeStart;      // 10

        // Skip thresholds for stable objects (avoid unnecessary updates)
        this.skipNearSq = 90 * 90;   // 8100 - Don't update if clearly close
        this.skipFarSq = 110 * 110;  // 12100 - Don't update if clearly far

        // Throttling - update every N frames for performance
        this._lodFrameCount = 0;
        this._lodUpdateInterval = 2;  // Every 2 frames = 30 updates/sec at 60fps

        // Debug mode - show all models regardless of distance
        this.debugShowAll = false;

        // Track last camera chunk to avoid redundant full updates
        this._lastCamChunkX = null;
        this._lastCamChunkZ = null;
    }

    /**
     * Set debug mode to show all 3D models regardless of distance
     * @param {boolean} enabled - Whether to enable debug mode
     */
    setDebugShowAll(enabled) {
        this.debugShowAll = enabled;

        // Immediately update all structures
        for (const entry of this.structureRegistry.values()) {
            entry.object.visible = enabled ? true : entry.object.visible;
        }
    }

    /**
     * Register a structure for LOD management
     * @param {THREE.Object3D} object - The structure's 3D object
     * @param {string} type - Structure type (tent, outpost, campfire, horse)
     * @param {string} chunkKey - Chunk key (e.g., "0,0")
     * @returns {boolean} - True if registered, false if type not supported
     */
    registerStructure(object, type, chunkKey) {
        // Only manage LOD-enabled structure types
        if (!LOD_STRUCTURE_TYPES.has(type)) {
            return false;
        }

        const objectId = object.userData?.objectId;
        if (!objectId) {
            console.warn('[StructureModelSystem] Structure missing objectId:', type);
            return false;
        }

        // Avoid duplicate registration
        if (this.structureRegistry.has(objectId)) {
            return false;
        }

        // Add to chunk bucket
        if (!this.structuresByChunk.has(chunkKey)) {
            this.structuresByChunk.set(chunkKey, new Set());
        }
        this.structuresByChunk.get(chunkKey).add(object);

        // Add to registry
        this.structureRegistry.set(objectId, {
            object,
            type,
            chunkKey
        });

        // Initialize as hidden - LOD update will show when player is close
        // This prevents distant structures from showing 3D models on load
        object.visible = false;

        // Cache materials for fast opacity updates
        this._cacheStructureMaterials(object);

        return true;
    }

    /**
     * Unregister a structure from LOD management
     * Clean up cached materials to prevent memory leaks
     * @param {string} objectId - The structure's objectId
     */
    unregisterStructure(objectId) {
        const entry = this.structureRegistry.get(objectId);
        if (!entry) return;

        // Clean up cached material references
        if (entry.object.userData._lodMaterials) {
            // Reset opacity to avoid lingering visual state
            for (const material of entry.object.userData._lodMaterials) {
                material.opacity = 1;  // Reset to default
            }
            entry.object.userData._lodMaterials = null;
        }
        entry.object.userData._lodOpacity = undefined;

        // Remove from chunk bucket
        const chunkSet = this.structuresByChunk.get(entry.chunkKey);
        if (chunkSet) {
            chunkSet.delete(entry.object);
            if (chunkSet.size === 0) {
                this.structuresByChunk.delete(entry.chunkKey);
            }
        }

        // Remove from registry
        this.structureRegistry.delete(objectId);
    }

    /**
     * Cache materials for fast opacity updates
     * Called once when structure is registered
     *
     * IMPORTANT: Must clone materials because GLTFs share materials between instances.
     * Without cloning, setting opacity on one structure affects ALL structures of that type.
     *
     * Handles both single materials and multi-material arrays (common in GLTFs).
     * @param {THREE.Object3D} object - The structure object
     */
    _cacheStructureMaterials(object) {
        const materials = [];

        object.traverse(child => {
            if (child.material) {
                // Handle both single material and material arrays
                const meshMaterials = Array.isArray(child.material)
                    ? child.material
                    : [child.material];

                for (let i = 0; i < meshMaterials.length; i++) {
                    let mat = meshMaterials[i];

                    // CLONE the material to avoid affecting other objects sharing this material
                    if (!mat.userData._lodCloned) {
                        mat = mat.clone();
                        mat.userData._lodCloned = true;

                        // Update the reference on the mesh
                        if (Array.isArray(child.material)) {
                            child.material[i] = mat;
                        } else {
                            child.material = mat;
                        }
                    }

                    // Make material transparent if not already
                    if (!mat._lodTransparent) {
                        mat.transparent = true;
                        mat._lodTransparent = true;
                        mat._originalDepthWrite = mat.depthWrite;
                        mat.needsUpdate = true;  // Tell Three.js material changed
                    }
                    materials.push(mat);
                }
            }
        });

        // Store on object for fast access
        object.userData._lodMaterials = materials;
        object.userData._lodOpacity = 0;  // Start hidden
    }

    /**
     * Set opacity on all cached materials
     * Uses cached material array to avoid traverse overhead
     * @param {THREE.Object3D} object - The structure object
     * @param {number} opacity - Target opacity (0-1)
     */
    _setStructureOpacity(object, opacity) {
        const materials = object.userData._lodMaterials;
        if (!materials) return;

        // Skip if opacity hasn't changed significantly
        const currentOpacity = object.userData._lodOpacity || 0;
        if (Math.abs(currentOpacity - opacity) < 0.02) return;

        // Update visibility
        if (opacity > 0 && !object.visible) {
            object.visible = true;
        }

        // Update all materials
        for (const material of materials) {
            material.opacity = opacity;
            // Disable depth write when semi-transparent to avoid artifacts
            material.depthWrite = opacity > 0.99 ? material._originalDepthWrite : false;
        }

        // Hide completely when fully transparent
        if (opacity <= 0) {
            object.visible = false;
        }

        // Cache current opacity
        object.userData._lodOpacity = opacity;
    }

    /**
     * Update structure model opacity based on camera distance
     * Called every frame from game loop (after billboardSystem.updateBillboards)
     * @param {THREE.Vector3} cameraPosition - Current camera/player position
     */
    updateStructureModels(cameraPosition) {
        // Throttle updates for performance (every 2 frames = 30 updates/sec)
        this._lodFrameCount++;
        if (this._lodFrameCount % this._lodUpdateInterval !== 0) return;

        // Debug mode - keep all models visible
        if (this.debugShowAll) return;

        const camX = cameraPosition.x;
        const camZ = cameraPosition.z;

        // Get camera chunk
        const { chunkX: camChunkX, chunkZ: camChunkZ } = ChunkCoordinates.worldToChunk(camX, camZ);

        // Expand to 5x5 chunks to cover 105 unit fade range
        // (chunks are 50 units, 5x5 = 125 unit radius from center)
        for (let dx = -2; dx <= 2; dx++) {
            for (let dz = -2; dz <= 2; dz++) {
                const chunkKey = `${camChunkX + dx},${camChunkZ + dz}`;
                const structures = this.structuresByChunk.get(chunkKey);
                if (!structures) continue;

                for (const structure of structures) {
                    if (!structure || !structure.position) continue;

                    // Calculate squared distance
                    const distX = structure.position.x - camX;
                    const distZ = structure.position.z - camZ;
                    const distSq = distX * distX + distZ * distZ;

                    // Skip stable structures (use epsilon for floating point comparison)
                    const currentOpacity = structure.userData._lodOpacity || 0;
                    if (currentOpacity > 0.99 && distSq < this.skipNearSq) continue;
                    if (currentOpacity < 0.01 && distSq > this.skipFarSq) continue;

                    // Calculate target opacity
                    let targetOpacity;
                    if (distSq < this.fadeStartSq) {
                        // Close - full opacity
                        targetOpacity = 1;
                    } else if (distSq < this.fadeEndSq) {
                        // Transition zone - fade based on distance
                        const dist = Math.sqrt(distSq);
                        targetOpacity = 1 - (dist - this.fadeStart) / this.fadeRange;
                    } else {
                        // Far - hidden
                        targetOpacity = 0;
                    }

                    // Apply opacity
                    this._setStructureOpacity(structure, targetOpacity);
                }
            }
        }

        // Update tracking
        this._lastCamChunkX = camChunkX;
        this._lastCamChunkZ = camChunkZ;
    }

    /**
     * Get statistics about managed structures
     * @returns {object}
     */
    getStats() {
        let total = 0;
        let visible = 0;

        for (const entry of this.structureRegistry.values()) {
            total++;
            if (entry.object.visible) visible++;
        }

        return {
            total,
            visible,
            hidden: total - visible,
            chunks: this.structuresByChunk.size
        };
    }

    /**
     * Clear all tracked structures (e.g., on disconnect)
     */
    clear() {
        this.structuresByChunk.clear();
        this.structureRegistry.clear();
        this._lastCamChunkX = null;
        this._lastCamChunkZ = null;
    }

    /**
     * Check if a structure type uses LOD
     * @param {string} type - Structure type
     * @returns {boolean}
     */
    static isLODStructure(type) {
        return LOD_STRUCTURE_TYPES.has(type);
    }
}

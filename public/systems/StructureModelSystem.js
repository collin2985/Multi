/**
 * StructureModelSystem.js
 * Manages LOD transition between 3D structure models (close) and billboards (far)
 *
 * Pattern: Based on RockModelSystem.js with structure-specific thresholds
 *
 * Structures have TWO visual representations:
 * 1. Full 3D model (close range, 0-40 units) - managed by SceneObjectFactory
 * 2. Billboard sprite (far range, 40+ units) - managed by BillboardSystem
 *
 * This system controls visibility of the 3D models based on camera distance.
 * The billboard opacity is controlled by BillboardSystem.updateBillboards().
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

        // LOD thresholds
        // Model: pops in at 70, pops out at 75
        // Billboard: fades in 60-70, solid at 70
        this.lodStartDistance = 70;  // Model shows when approaching
        this.lodEndDistance = 75;    // Model hides when leaving
        this.lodStartSq = this.lodStartDistance * this.lodStartDistance;  // 4900
        this.lodEndSq = this.lodEndDistance * this.lodEndDistance;        // 5625

        // Small hysteresis to avoid flicker (just a few units)
        this.skipShowSq = 68 * 68;   // Show at 68 units
        this.skipHideSq = 77 * 77;   // Hide at 77 units

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

        // Initialize visibility (default visible until first update)
        object.visible = true;

        return true;
    }

    /**
     * Unregister a structure from LOD management
     * @param {string} objectId - The structure's objectId
     */
    unregisterStructure(objectId) {
        const entry = this.structureRegistry.get(objectId);
        if (!entry) return;

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
     * Update structure model visibility based on camera distance
     * Called every frame from game loop (after billboardSystem.updateBillboards)
     * @param {THREE.Vector3} cameraPosition - Current camera/player position
     */
    updateStructureModels(cameraPosition) {
        // Debug mode - keep all models visible
        if (this.debugShowAll) {
            return;
        }

        const camX = cameraPosition.x;
        const camZ = cameraPosition.z;

        // Get camera chunk
        const { chunkX: camChunkX, chunkZ: camChunkZ } = ChunkCoordinates.worldToChunk(camX, camZ);

        // Get 3x3 chunk keys around camera
        const chunkKeys = ChunkCoordinates.get3x3ChunkKeys(camChunkX, camChunkZ);

        // Iterate structures in nearby chunks
        for (const chunkKey of chunkKeys) {
            const structures = this.structuresByChunk.get(chunkKey);
            if (!structures) continue;

            for (const structure of structures) {
                if (!structure || !structure.position) continue;

                // Calculate squared distance
                const distX = structure.position.x - camX;
                const distZ = structure.position.z - camZ;
                const distSq = distX * distX + distZ * distZ;

                // Get current visibility
                const wasVisible = structure.visible;

                // Skip stable structures - avoid redundant LOD updates
                if (wasVisible && distSq < this.skipShowSq) continue;
                if (!wasVisible && distSq > this.skipHideSq) continue;

                // Apply hysteresis to avoid flicker
                // Show model when clearly in range, hide when clearly out of range
                if (wasVisible) {
                    // Currently visible - hide only when well past threshold
                    if (distSq > this.skipHideSq) {
                        structure.visible = false;
                    } else if (distSq > this.lodEndSq) {
                        // In transition zone - apply fade (opacity handled by BillboardSystem)
                        structure.visible = false;
                    }
                    // Otherwise keep visible
                } else {
                    // Currently hidden - show only when well within threshold
                    if (distSq < this.skipShowSq) {
                        structure.visible = true;
                    } else if (distSq < this.lodStartSq) {
                        // In transition zone - show 3D model
                        structure.visible = true;
                    }
                    // Otherwise keep hidden
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

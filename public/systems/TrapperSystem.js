/**
 * TrapperSystem.js
 * Manages Trapper NPCs that provide regional resource quality information
 *
 * Behavior:
 * 1. ONE trapper tent + NPC spawns per chunk in 3x3 area around player (9 max)
 * 2. Trapper tents do NOT decay (isTrapperStructure: true)
 * 3. Player can interact with trapper to buy resource quality info for 5 coins
 * 4. Resource info shows all resource types with their quality ranges for that chunk
 *
 * Performance: Only updates on chunk changes, NPCs are static (no animation updates)
 */

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { modelManager, applyEuclideanFog } from '../objects.js';
import { CONFIG } from '../config.js';
import { QualityGenerator } from '../core/QualityGenerator.js';
import { getAISpawnQueue } from '../ai/AISpawnQueue.js';

// Trapper constants
const TRAPPER_CONSTANTS = {
    INTERACTION_RADIUS: CONFIG.TRAPPER_CAMPS?.INTERACTION_RADIUS || 2.0,
    NPC_OFFSET_X: CONFIG.TRAPPER_CAMPS?.NPC_OFFSET_X || 2.5,
    NPC_OFFSET_Z: CONFIG.TRAPPER_CAMPS?.NPC_OFFSET_Z || 0.5,
    SHIRT_COLOR: CONFIG.TRAPPER_CAMPS?.NPC_COLOR || 0x8B4513,  // Brown/leather
    SEED_OFFSET: CONFIG.TRAPPER_CAMPS?.SEED_OFFSET || 500000,
    // Elevation range matches pine tree spawning (forested areas)
    MIN_ELEVATION: 4,
    MAX_ELEVATION: 22
};

// All resource types that have chunk-based quality
const RESOURCE_TYPES = [
    'pine', 'apple',                                    // Trees
    'limestone', 'sandstone', 'clay', 'iron',           // Rocks
    'vines', 'mushroom', 'vegetables', 'vegetableseeds', 'hemp', // Gatherable
    'fish', 'deer', 'brownbear'                           // Wildlife
];

// Friendly display names for resources
const RESOURCE_DISPLAY_NAMES = {
    'pine': 'Pine Trees',
    'apple': 'Apple Trees',
    'limestone': 'Limestone',
    'sandstone': 'Sandstone',
    'clay': 'Clay',
    'iron': 'Iron Ore',
    'vines': 'Vines',
    'mushroom': 'Mushrooms',
    'vegetables': 'Vegetables',
    'vegetableseeds': 'Vegetable Seeds',
    'hemp': 'Hemp',
    'fish': 'Fish',
    'deer': 'Deer',
    'brownbear': 'Brown Bear'
};

export class TrapperSystem {
    constructor(scene, terrainGenerator) {
        this.scene = scene;
        this.terrainGenerator = terrainGenerator;

        // Track trappers: Map<chunkKey, trapperData>
        this.trappers = new Map();

        // World seed for quality calculations
        this.worldSeed = CONFIG.TERRAIN?.seed || 12345;

        // Register spawn callback with queue system (spreads spawns across frames)
        const spawnQueue = getAISpawnQueue();
        spawnQueue.registerSpawnCallback('trapper', (data) => {
            this.spawnTrapper(data.chunkX, data.chunkZ);
        });
    }

    /**
     * Create a seeded random number generator (Mulberry32)
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
     * Get deterministic position for trapper in a chunk
     */
    getTrapperPosition(chunkX, chunkZ) {
        if (!this.terrainGenerator) return null;

        const chunkSize = CONFIG.TERRAIN?.chunkSize || 50;

        // Create seed unique to this chunk for trapper placement
        const seed = this.worldSeed + chunkX * 73856093 + chunkZ * 19349663 + TRAPPER_CONSTANTS.SEED_OFFSET;
        const rng = this.createSeededRNG(seed);

        // Try to find a valid position within the chunk
        const maxAttempts = 20;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            // Random position within chunk (with some margin from edges)
            const margin = 5;
            const localX = margin + rng() * (chunkSize - margin * 2);
            const localZ = margin + rng() * (chunkSize - margin * 2);

            const worldX = chunkX * chunkSize + localX - chunkSize / 2;
            const worldZ = chunkZ * chunkSize + localZ - chunkSize / 2;

            // Check if on land (continent mask > 0.7)
            const continentMask = this.terrainGenerator.getContinentMask(worldX, worldZ);
            if (continentMask < 0.7) continue;

            // Get terrain height
            const y = this.terrainGenerator.getWorldHeight(worldX, worldZ);

            // Skip if underwater
            const waterLevel = CONFIG.WATER?.LEVEL || 0;
            if (y < waterLevel + 0.5) continue;

            // Skip if outside pine tree elevation range
            // Trappers only spawn in forested areas where pine trees grow
            if (y < TRAPPER_CONSTANTS.MIN_ELEVATION || y > TRAPPER_CONSTANTS.MAX_ELEVATION) continue;

            // Check slope - trappers need gentle terrain like structures do
            // getNormalY returns 1 for flat, 0 for vertical cliff
            const normalY = this.terrainGenerator.getNormalY(worldX, worldZ);
            const slopeDegrees = Math.acos(normalY) * (180 / Math.PI);
            // Use same 37 degree threshold as structures (see StructureManager.js)
            if (slopeDegrees > 37) continue;

            // Snap to 0.25 grid
            const snappedX = Math.round(worldX / 0.25) * 0.25;
            const snappedZ = Math.round(worldZ / 0.25) * 0.25;
            const snappedY = this.terrainGenerator.getWorldHeight(snappedX, snappedZ);

            return { x: snappedX, y: snappedY, z: snappedZ };
        }

        // Fallback: chunk center (only if within elevation range and gentle slope)
        const centerX = chunkX * chunkSize;
        const centerZ = chunkZ * chunkSize;
        const y = this.terrainGenerator.getWorldHeight(centerX, centerZ);

        // Skip this chunk if even the center is outside pine tree range
        if (y < TRAPPER_CONSTANTS.MIN_ELEVATION || y > TRAPPER_CONSTANTS.MAX_ELEVATION) return null;

        // Also check slope at center
        const normalY = this.terrainGenerator.getNormalY(centerX, centerZ);
        const slopeDegrees = Math.acos(normalY) * (180 / Math.PI);
        if (slopeDegrees > 37) return null;

        return { x: centerX, y, z: centerZ };
    }

    /**
     * Spawn trapper tent + NPC at a chunk
     */
    spawnTrapper(chunkX, chunkZ) {
        const chunkKey = `${chunkX},${chunkZ}`;

        // Skip if already spawned
        if (this.trappers.has(chunkKey)) return;

        // Check if enabled
        if (!CONFIG.TRAPPER_CAMPS?.ENABLED) return;

        // Get the man model for NPC
        const manGLTF = modelManager.getGLTF('man');
        if (!manGLTF) {
            console.warn('[TrapperSystem] Man model not loaded yet');
            return;
        }

        // Get the tent model
        const tentGLTF = modelManager.getGLTF('tent');
        if (!tentGLTF) {
            console.warn('[TrapperSystem] Tent model not loaded yet');
            return;
        }

        // Get deterministic position for this chunk
        const position = this.getTrapperPosition(chunkX, chunkZ);
        if (!position) {
            return;
        }

        // Create seed for rotation
        const seed = this.worldSeed + chunkX * 73856093 + chunkZ * 19349663 + TRAPPER_CONSTANTS.SEED_OFFSET;
        const rng = this.createSeededRNG(seed);
        const tentRotation = rng() * Math.PI * 2;

        // Create tent
        const tent = new THREE.Group();
        const tentMesh = tentGLTF.scene.clone();
        tentMesh.scale.set(1, 1, 1);
        tentMesh.traverse((child) => {
            if (child.isMesh && child.material) {
                applyEuclideanFog(child.material);
            }
        });

        tent.add(tentMesh);
        tent.position.set(position.x, position.y, position.z);
        tent.rotation.y = tentRotation;

        // Mark tent as trapper structure (prevents decay)
        tent.userData.isTrapperStructure = true;
        tent.userData.type = 'tent';
        tent.userData.chunkKey = chunkKey;

        this.scene.add(tent);

        // Calculate NPC position (offset from tent)
        const npcOffsetX = TRAPPER_CONSTANTS.NPC_OFFSET_X;
        const npcOffsetZ = TRAPPER_CONSTANTS.NPC_OFFSET_Z;

        // Apply tent rotation to offset
        const cosRot = Math.cos(tentRotation);
        const sinRot = Math.sin(tentRotation);
        const npcX = position.x + (npcOffsetX * cosRot - npcOffsetZ * sinRot);
        const npcZ = position.z + (npcOffsetX * sinRot + npcOffsetZ * cosRot);
        const npcY = this.terrainGenerator.getWorldHeight(npcX, npcZ);

        // Create NPC using SkeletonUtils to properly handle skinned mesh
        const npc = new THREE.Group();
        const npcMesh = SkeletonUtils.clone(manGLTF.scene);
        npcMesh.scale.set(1, 1, 1);

        // Setup mesh and color the shirt brown
        npcMesh.traverse((child) => {
            if (child.isMesh || child.isSkinnedMesh) {
                child.visible = true;
                child.frustumCulled = true;

                // Cube001_3 is the shirt - make it brown
                if (child.name === 'Cube001_3' && child.material) {
                    child.material = child.material.clone();
                    child.material.color.setHex(TRAPPER_CONSTANTS.SHIRT_COLOR);
                }

                if (child.material) {
                    applyEuclideanFog(child.material);
                }
            }
        });

        npc.add(npcMesh);
        npc.position.set(npcX, npcY, npcZ);

        // NPC faces away from tent
        npc.rotation.y = tentRotation + Math.PI;

        this.scene.add(npc);

        // Register nametag for trapper NPC
        const trapperId = `trapper_${chunkX}_${chunkZ}`;
        if (window.game?.nameTagManager) {
            window.game.nameTagManager.registerEntity(trapperId, 'Trapper', npc);
        }

        // Store trapper data (no animation references needed)
        const trapperData = {
            tent: tent,
            npc: npc,
            npcMesh: npcMesh,
            chunkX: chunkX,
            chunkZ: chunkZ,
            position: { x: npcX, y: npcY, z: npcZ }
        };

        this.trappers.set(chunkKey, trapperData);
    }

    /**
     * Remove trapper when chunk unloads
     */
    removeTrapper(chunkKey) {
        const data = this.trappers.get(chunkKey);
        if (!data) return;

        // Remove tent from scene
        if (data.tent) {
            this.scene.remove(data.tent);
            data.tent.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        }

        // Remove NPC from scene
        if (data.npc) {
            this.scene.remove(data.npc);
            data.npc.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        }

        // Unregister nametag
        const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
        const trapperId = `trapper_${chunkX}_${chunkZ}`;
        if (window.game?.nameTagManager) {
            window.game.nameTagManager.unregisterEntity(trapperId);
        }

        this.trappers.delete(chunkKey);
    }

    /**
     * Called when player crosses chunk boundaries
     * Spawns trappers in new 3x3 area, removes those outside
     * @param {number} chunkX - New chunk X
     * @param {number} chunkZ - New chunk Z
     * @param {number|null} oldChunkX - Previous chunk X (null on init)
     * @param {number|null} oldChunkZ - Previous chunk Z (null on init)
     */
    onPlayerChunkChanged(chunkX, chunkZ, oldChunkX, oldChunkZ) {
        if (!CONFIG.TRAPPER_CAMPS?.ENABLED) return;

        // Calculate new 3x3 chunk keys
        const newChunks = new Set();
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                newChunks.add(`${chunkX + dx},${chunkZ + dz}`);
            }
        }

        // Queue trapper spawns (spread across frames to prevent stutter)
        const spawnQueue = getAISpawnQueue();
        for (const key of newChunks) {
            if (!this.trappers.has(key) && !spawnQueue.isQueued('trapper', key)) {
                const commaIdx = key.indexOf(',');
                const cx = parseInt(key.substring(0, commaIdx), 10);
                const cz = parseInt(key.substring(commaIdx + 1), 10);
                spawnQueue.queueSpawn('trapper', { chunkX: cx, chunkZ: cz }, key);
            }
        }

        // Remove trappers outside new 3x3
        for (const key of this.trappers.keys()) {
            if (!newChunks.has(key)) {
                this.removeTrapper(key);
            }
        }
    }

    /**
     * Initialize trappers around player on game start
     * @param {number} chunkX - Player's starting chunk X
     * @param {number} chunkZ - Player's starting chunk Z
     */
    initializeAroundPlayer(chunkX, chunkZ) {
        this.onPlayerChunkChanged(chunkX, chunkZ, null, null);
    }

    /**
     * Get trapper near a position (for player interaction)
     * @param {THREE.Vector3} playerPosition
     * @param {string} currentChunkKey - Optional: player's current chunk key for optimization
     * @returns {object|null} Trapper data if within interaction range
     */
    getTrapperNearPosition(playerPosition, currentChunkKey = null) {
        const radiusSq = TRAPPER_CONSTANTS.INTERACTION_RADIUS * TRAPPER_CONSTANTS.INTERACTION_RADIUS;

        // Check current chunk's trapper first (most likely match)
        if (currentChunkKey) {
            const currentTrapper = this.trappers.get(currentChunkKey);
            if (currentTrapper) {
                const dx = playerPosition.x - currentTrapper.position.x;
                const dz = playerPosition.z - currentTrapper.position.z;
                const distanceSq = dx * dx + dz * dz;
                if (distanceSq <= radiusSq) {
                    return {
                        chunkKey: currentChunkKey,
                        chunkX: currentTrapper.chunkX,
                        chunkZ: currentTrapper.chunkZ,
                        position: new THREE.Vector3(currentTrapper.position.x, currentTrapper.position.y, currentTrapper.position.z)
                    };
                }
            }
        }

        // Fall back to checking all trappers (for edge cases near chunk borders)
        for (const [chunkKey, data] of this.trappers) {
            if (chunkKey === currentChunkKey) continue; // Already checked

            const dx = playerPosition.x - data.position.x;
            const dz = playerPosition.z - data.position.z;
            const distanceSq = dx * dx + dz * dz;

            if (distanceSq <= radiusSq) {
                return {
                    chunkKey: chunkKey,
                    chunkX: data.chunkX,
                    chunkZ: data.chunkZ,
                    position: new THREE.Vector3(data.position.x, data.position.y, data.position.z)
                };
            }
        }
        return null;
    }

    /**
     * Get resource quality information for a chunk
     * @param {number} chunkX
     * @param {number} chunkZ
     * @returns {Array} Array of {type, displayName, range}
     */
    getResourceInfo(chunkX, chunkZ) {
        const info = [];

        for (const resourceType of RESOURCE_TYPES) {
            const range = QualityGenerator.getAdjustedQualityRange(this.worldSeed, chunkX, chunkZ, resourceType);
            info.push({
                type: resourceType,
                displayName: RESOURCE_DISPLAY_NAMES[resourceType] || resourceType,
                range
            });
        }

        // Sort by quality (best first)
        info.sort((a, b) => b.range.min - a.range.min);

        return info;
    }

    /**
     * Clear all trappers
     */
    clearAll() {
        for (const chunkKey of this.trappers.keys()) {
            this.removeTrapper(chunkKey);
        }
    }

    /**
     * Get count of active trappers
     */
    getTrapperCount() {
        return this.trappers.size;
    }
}

export { TRAPPER_CONSTANTS, RESOURCE_TYPES, RESOURCE_DISPLAY_NAMES };

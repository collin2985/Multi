/**
 * DockMerchantSystem.js
 * Manages merchant NPCs that arrive on ships and stand at docks
 *
 * Behavior:
 * 1. When ship enters DOCKED phase, spawn merchant on ship deck
 * 2. Lerp merchant from ship to dock edge at 0.25 u/s
 * 3. Merchant stands idle at dock edge with idle animation
 * 4. Merchant despawns when dock is removed
 * 5. Player can interact with merchant to get trading info
 */

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { modelManager, applyEuclideanFog } from '../objects.js';
import { PHASE, getDockDirections } from './ScheduledShipSystem.js';
import { ChunkCoordinates } from '../core/ChunkCoordinates.js';

// Merchant constants
const MERCHANT_CONSTANTS = {
    DOCK_HEIGHT: 1.0,           // Y position on dock (matches dock deckHeight)
    DOCK_OFFSET_X: 4.5,         // X offset from dock position
    DOCK_OFFSET_Z: 0.1,         // Z offset from dock position (on dock surface)
    INTERACTION_RADIUS: 2.0,    // Distance for player interaction
    SHIRT_COLOR: 0xFFCC00, // Yellow color for merchant shirt
    VISIBILITY_RADIUS: 1,       // Show merchants within 3x3 chunks of player
    SHIP_CHECK_INTERVAL: 60000  // Check for ships every 1 minute
};

// Merchant states
const MERCHANT_STATE = {
    ON_SHIP: 'on_ship',
    WALKING: 'walking',
    IDLE: 'idle',
    HIDDEN: 'hidden'  // When outside visibility range
};

// Shared material for all merchants (reduces draw calls)
let sharedShirtMaterial = null;

export class DockMerchantSystem {
    constructor(scene, scheduledShipSystem) {
        this.scene = scene;
        this.scheduledShipSystem = scheduledShipSystem;

        // Track merchants: Map<dockId, merchantData>
        this.merchants = new Map();

        // Track which docks have had their first ship (merchant only spawns on first ship)
        this.docksWithMerchant = new Set();

        // For one-time init logging
        this._initialized = false;

        // Spatial index: chunkKey -> Set<dockId>
        this.merchantsByChunk = new Map();
        this.lastPlayerChunkX = null;
        this.lastPlayerChunkZ = null;
        this.lastShipCheckTime = 0;

        // Track currently visible merchants for O(1) hide checks (like TrapperSystem pattern)
        this.visibleMerchants = new Set();

        // Initialize shared material
        if (!sharedShirtMaterial) {
            sharedShirtMaterial = new THREE.MeshStandardMaterial({
                color: MERCHANT_CONSTANTS.SHIRT_COLOR,
                roughness: 0.8,
                metalness: 0.1
            });
            applyEuclideanFog(sharedShirtMaterial);
        }
    }

    _getChunkKey(x, z) {
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(x, z);
        return `${chunkX},${chunkZ}`;
    }

    _addToSpatialIndex(dockId, x, z) {
        const chunkKey = this._getChunkKey(x, z);
        if (!this.merchantsByChunk.has(chunkKey)) {
            this.merchantsByChunk.set(chunkKey, new Set());
        }
        this.merchantsByChunk.get(chunkKey).add(dockId);
    }

    _removeFromSpatialIndex(dockId, x, z) {
        const chunkKey = this._getChunkKey(x, z);
        const chunkMerchants = this.merchantsByChunk.get(chunkKey);
        if (chunkMerchants) {
            chunkMerchants.delete(dockId);
            if (chunkMerchants.size === 0) {
                this.merchantsByChunk.delete(chunkKey);
            }
        }
    }

    _isInVisibilityRange(merchantChunkX, merchantChunkZ, playerChunkX, playerChunkZ) {
        const dx = Math.abs(merchantChunkX - playerChunkX);
        const dz = Math.abs(merchantChunkZ - playerChunkZ);
        return dx <= MERCHANT_CONSTANTS.VISIBILITY_RADIUS &&
               dz <= MERCHANT_CONSTANTS.VISIBILITY_RADIUS;
    }

    _updateMerchantVisibility(merchantData) {
        const shouldBeVisible = this._isInVisibilityRange(
            merchantData.chunkX, merchantData.chunkZ,
            this.lastPlayerChunkX, this.lastPlayerChunkZ
        );

        if (shouldBeVisible && !merchantData.isVisible) {
            this.scene.add(merchantData.entity);
            merchantData.isVisible = true;
            merchantData.state = MERCHANT_STATE.IDLE;
        } else if (!shouldBeVisible && merchantData.isVisible) {
            this.scene.remove(merchantData.entity);
            merchantData.isVisible = false;
            merchantData.state = MERCHANT_STATE.HIDDEN;
        }
    }

    updatePlayerChunk(playerChunkX, playerChunkZ) {
        if (playerChunkX === this.lastPlayerChunkX && playerChunkZ === this.lastPlayerChunkZ) return;
        this.lastPlayerChunkX = playerChunkX;
        this.lastPlayerChunkZ = playerChunkZ;

        const radius = MERCHANT_CONSTANTS.VISIBILITY_RADIUS;

        // Build new visible chunks set (same pattern as TrapperSystem)
        const newVisibleChunks = new Set();
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                newVisibleChunks.add(`${playerChunkX + dx},${playerChunkZ + dz}`);
            }
        }

        // Show merchants in visible chunks (using spatial index - O(visible chunks))
        for (const chunkKey of newVisibleChunks) {
            const merchantIds = this.merchantsByChunk.get(chunkKey);
            if (merchantIds) {
                for (const dockId of merchantIds) {
                    if (!this.visibleMerchants.has(dockId)) {
                        const data = this.merchants.get(dockId);
                        if (data) {
                            this.scene.add(data.entity);
                            data.isVisible = true;
                            data.state = MERCHANT_STATE.IDLE;
                            this.visibleMerchants.add(dockId);
                        }
                    }
                }
            }
        }

        // Hide merchants outside range (loop only visible ones - small set)
        for (const dockId of this.visibleMerchants) {
            const data = this.merchants.get(dockId);
            if (data) {
                const merchantChunkKey = `${data.chunkX},${data.chunkZ}`;
                if (!newVisibleChunks.has(merchantChunkKey)) {
                    this.scene.remove(data.entity);
                    data.isVisible = false;
                    data.state = MERCHANT_STATE.HIDDEN;
                    this.visibleMerchants.delete(dockId);
                }
            }
        }
    }

    /**
     * Called when a dock ship update is received (ship docked)
     * Spawns merchant on dock if one doesn't exist
     */
    onDockShipUpdate(dockId, dockPosition, dockRotation, lastShipSpawn) {
        // Skip if already has merchant
        if (this.merchants.has(dockId)) {
            return;
        }

        // Need lastShipSpawn to know ship has visited
        if (!lastShipSpawn) {
            return;
        }

        // Spawn merchant on dock when ship arrives
        this.spawnMerchant(dockId, dockPosition, dockRotation, lastShipSpawn);
    }

    /**
     * Spawn a merchant for a dock (spawns directly on dock)
     */
    spawnMerchant(dockId, dockPosition, dockRotation, lastShipSpawn) {
        if (this.merchants.has(dockId)) {
            return; // Already has merchant
        }

        const manGLTF = modelManager.getGLTF('man');
        if (!manGLTF) {
            console.error('[DockMerchantSystem] spawnMerchant FAILED: Man model not loaded yet!');
            return;
        }

        // Get direction vectors based on dock rotation
        const dirs = getDockDirections(dockRotation ?? (Math.PI / 2));

        // Calculate position - merchant stands on water side of dock (far end, toward ship)
        const merchantX = dockPosition[0]
            + dirs.approach.x * MERCHANT_CONSTANTS.DOCK_OFFSET_X
            + dirs.parallel.x * MERCHANT_CONSTANTS.DOCK_OFFSET_Z;
        const merchantZ = dockPosition[2]
            + dirs.approach.z * MERCHANT_CONSTANTS.DOCK_OFFSET_X
            + dirs.parallel.z * MERCHANT_CONSTANTS.DOCK_OFFSET_Z;

        // Get chunk coordinates for spatial indexing
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(merchantX, merchantZ);

        // Create merchant entity
        const merchant = new THREE.Group();

        // Always position on dock
        merchant.position.set(merchantX, MERCHANT_CONSTANTS.DOCK_HEIGHT, merchantZ);

        // Clone model using SkeletonUtils to properly handle skinned mesh
        const mesh = SkeletonUtils.clone(manGLTF.scene);
        mesh.traverse((child) => {
            if (child.isMesh || child.isSkinnedMesh) {
                child.visible = true;
                child.frustumCulled = true;

                // Cube001_3 is the shirt - use shared yellow material
                if (child.name === 'Cube001_3' && child.material) {
                    child.material = sharedShirtMaterial;
                } else if (child.material) {
                    // Apply euclidean fog fix to other materials
                    applyEuclideanFog(child.material);
                }
            }
        });

        merchant.add(mesh);

        // Face toward the water (based on dock rotation)
        merchant.rotation.y = dirs.merchantRotation;

        // Store merchant data - starts hidden until visibility check
        const merchantData = {
            entity: merchant,
            mesh: mesh,
            dockId: dockId,
            dockPosition: dockPosition,
            dockRotation: dockRotation,
            state: MERCHANT_STATE.HIDDEN,
            lastShipSpawn: lastShipSpawn,
            chunkX: chunkX,
            chunkZ: chunkZ,
            isVisible: false
        };

        this.merchants.set(dockId, merchantData);
        this.docksWithMerchant.add(dockId);

        // Register nametag for merchant NPC
        const merchantEntityId = `merchant_${dockId}`;
        if (window.game?.nameTagManager) {
            window.game.nameTagManager.registerEntity(merchantEntityId, 'Merchant', merchant);
        }

        // Add to spatial index
        this._addToSpatialIndex(dockId, merchantX, merchantZ);

        // Check visibility based on player position
        if (this.lastPlayerChunkX !== null) {
            this._updateMerchantVisibility(merchantData);
        }
    }

    /**
     * Remove merchant when dock is destroyed
     */
    removeMerchant(dockId) {
        const merchantData = this.merchants.get(dockId);
        if (!merchantData) return;

        // Remove from spatial index
        const pos = merchantData.entity.position;
        this._removeFromSpatialIndex(dockId, pos.x, pos.z);

        // Remove from scene only if visible
        if (merchantData.isVisible) {
            this.scene.remove(merchantData.entity);
            this.visibleMerchants.delete(dockId);
        }

        // Dispose geometry and materials (skip shared material)
        merchantData.entity.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material && child.material !== sharedShirtMaterial) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => {
                        if (m !== sharedShirtMaterial) m.dispose();
                    });
                } else {
                    child.material.dispose();
                }
            }
        });

        // Unregister nametag
        const merchantEntityId = `merchant_${dockId}`;
        if (window.game?.nameTagManager) {
            window.game.nameTagManager.unregisterEntity(merchantEntityId);
        }

        this.merchants.delete(dockId);
        // Also remove from docksWithMerchant so a new merchant can spawn if dock is rebuilt
        this.docksWithMerchant.delete(dockId);
    }

    /**
     * Update all merchants
     * Called every frame from game loop
     */
    update(deltaTime, playerPosition = null) {
        // One-time init log
        if (!this._initialized && this.scheduledShipSystem) {
            this._initialized = true;
        }

        // Update player chunk position for visibility culling
        if (playerPosition) {
            const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(playerPosition.x, playerPosition.z);
            this.updatePlayerChunk(chunkX, chunkZ);
        }

        // Throttled check for new ships entering DOCKED phase (every 1 second)
        const now = Date.now();
        if (now - this.lastShipCheckTime >= MERCHANT_CONSTANTS.SHIP_CHECK_INTERVAL) {
            this.lastShipCheckTime = now;
            this.checkForNewDockedShips();
        }
    }

    /**
     * Check all registered docks for ships that have visited
     * Spawns merchant if one doesn't exist yet (merchant persists after ship leaves)
     */
    checkForNewDockedShips() {
        if (!this.scheduledShipSystem) return;

        for (const [dockId, dock] of this.scheduledShipSystem.docks) {
            // Skip if already has merchant
            if (this.merchants.has(dockId)) continue;

            // Skip if no ship has ever visited
            if (!dock.lastShipSpawn) continue;

            const elapsed = (Date.now() - dock.lastShipSpawn) / 1000;
            const phaseInfo = this.scheduledShipSystem.getCurrentPhase(elapsed);

            // Spawn merchant when ship is docked OR has departed
            // Do NOT spawn if APPROACH (ship hasn't arrived yet)
            if (phaseInfo.phase === PHASE.DOCKED) {
                this.spawnMerchant(dockId, dock.position, dock.rotation, dock.lastShipSpawn);
            } else if (phaseInfo.phase !== PHASE.APPROACH) {
                // Ship has departed (BACKUP, ROTATE, DEPART, DESPAWNED) - merchant persists
                this.spawnMerchant(dockId, dock.position, dock.rotation, dock.lastShipSpawn);
            }
        }
    }

    /**
     * Ensure merchant exists for a dock (called when dock is registered)
     * Only spawns merchant if ship has actually arrived (DOCKED phase or later)
     */
    ensureMerchantExists(dockId, dockPosition, dockRotation, lastShipSpawn) {
        // Skip if already has merchant
        if (this.merchants.has(dockId)) {
            return;
        }

        // Need lastShipSpawn to know a ship cycle has started
        if (!lastShipSpawn) {
            return;
        }

        // Check the ship's current phase - only spawn if ship has actually arrived
        if (!this.scheduledShipSystem) {
            return;
        }

        const elapsed = (Date.now() - lastShipSpawn) / 1000;
        const phaseInfo = this.scheduledShipSystem.getCurrentPhase(elapsed);

        // Only spawn merchant if ship has arrived (not during APPROACH)
        // Merchant persists after ship departs (BACKUP, ROTATE, DEPART, DESPAWNED)
        if (phaseInfo.phase === PHASE.DOCKED) {
            this.spawnMerchant(dockId, dockPosition, dockRotation, lastShipSpawn);
        } else if (phaseInfo.phase !== PHASE.APPROACH) {
            // Ship has departed - merchant persists on dock
            this.spawnMerchant(dockId, dockPosition, dockRotation, lastShipSpawn);
        }
    }

    /**
     * Get merchant near a position (for player interaction)
     * @param {THREE.Vector3} playerPosition
     * @returns {object|null} Merchant data if within interaction range
     */
    getMerchantNearPosition(playerPosition) {
        const playerChunkKey = this._getChunkKey(playerPosition.x, playerPosition.z);
        const merchantsInChunk = this.merchantsByChunk.get(playerChunkKey);
        if (!merchantsInChunk) return null;

        for (const dockId of merchantsInChunk) {
            const data = this.merchants.get(dockId);
            if (!data || !data.isVisible) continue;

            const dx = playerPosition.x - data.entity.position.x;
            const dz = playerPosition.z - data.entity.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance <= MERCHANT_CONSTANTS.INTERACTION_RADIUS) {
                return {
                    dockId: dockId,
                    position: data.entity.position.clone(),
                    state: data.state,
                    lastShipSpawn: data.lastShipSpawn
                };
            }
        }
        return null;
    }

    /**
     * Get cardinal direction name for the side the ship docks alongside
     * The ship parks parallel to the dock, offset by the parallel vector
     * @param {number} dockRotation - Dock rotation in radians
     * @returns {string} Cardinal direction (East/West/North/South)
     */
    _getShipDockingSideName(dockRotation) {
        const dirs = getDockDirections(dockRotation ?? (Math.PI / 2));
        if (dirs.parallel.x > 0) return 'East';
        if (dirs.parallel.x < 0) return 'West';
        if (dirs.parallel.z > 0) return 'North';
        if (dirs.parallel.z < 0) return 'South';
        return 'East'; // fallback
    }

    /**
     * Get time until next ship arrives
     * @param {number} lastShipSpawn - Timestamp of last ship spawn
     * @returns {number} Minutes until next ship
     */
    getMinutesUntilNextShip(lastShipSpawn) {
        if (!lastShipSpawn) return 30; // Default cycle

        const SHIP_CYCLE_MS = 30 * 60 * 1000; // 30 minutes in ms
        const elapsed = Date.now() - lastShipSpawn;
        const remaining = SHIP_CYCLE_MS - elapsed;

        if (remaining <= 0) {
            // Ship should be arriving now or has arrived
            return 0;
        }

        return Math.ceil(remaining / 60000); // Convert to minutes, round up
    }

    /**
     * Get dialogue text for merchant interaction
     * @param {string} dockId
     * @returns {string} Dialogue text
     */
    getMerchantDialogue(dockId) {
        const data = this.merchants.get(dockId);
        if (!data) {
            return "The merchant is not available.";
        }

        const minutesUntilNext = this.getMinutesUntilNextShip(data.lastShipSpawn);
        const dockingSide = this._getShipDockingSideName(data.dockRotation);

        let nextShipText;
        if (minutesUntilNext <= 0) {
            nextShipText = "A ship should be arriving any moment now!";
        } else if (minutesUntilNext === 1) {
            nextShipText = "The next ship arrives in about 1 minute.";
        } else {
            nextShipText = `The next ship arrives in about ${minutesUntilNext} minutes.`;
        }

        return `Ahoy there, traveler!\n\n` +
            `The trading ships from the company I work for arrives here every 30 minutes, as long as the dock stands.\n\n` +
            `If you have a Market within 20 units of this dock with materials for sale, we'll take them ` +
            `off your hands and restock your market with hard-to-find items like tools and weapons.\n\n` +
            `Be careful not to park your own ships on the ${dockingSide} side of the dock - that's where the trading ship pulls alongside!\n\n` +
            `${nextShipText}`;
    }

    /**
     * Clear all merchants (used when changing areas)
     */
    clearAll() {
        for (const [dockId] of this.merchants) {
            this.removeMerchant(dockId);
        }
        this.docksWithMerchant.clear();
        this.merchantsByChunk.clear();
        this.visibleMerchants.clear();
    }

    /**
     * Get count of active merchants
     */
    getMerchantCount() {
        return this.merchants.size;
    }
}

export { MERCHANT_CONSTANTS, MERCHANT_STATE };

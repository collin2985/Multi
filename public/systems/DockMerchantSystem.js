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
import { modelManager } from '../objects.js';
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
    SHIP_CHECK_INTERVAL: 1000   // Check for ships every 1 second, not every frame
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

        // Initialize shared material
        if (!sharedShirtMaterial) {
            sharedShirtMaterial = new THREE.MeshStandardMaterial({
                color: MERCHANT_CONSTANTS.SHIRT_COLOR,
                roughness: 0.8,
                metalness: 0.1
            });
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
        for (const [, data] of this.merchants) {
            this._updateMerchantVisibility(data);
        }
    }

    /**
     * Called when a dock ship update is received (ship docked)
     * Spawns merchant on dock if one doesn't exist
     */
    onDockShipUpdate(dockId, dockPosition, dockRotation, lastShipSpawn) {
        console.log(`[DockMerchantSystem] onDockShipUpdate called for dock ${dockId}, lastShipSpawn: ${lastShipSpawn}`);

        // Skip if already has merchant
        if (this.merchants.has(dockId)) {
            console.log(`[DockMerchantSystem] Dock ${dockId} already has a merchant, skipping`);
            return;
        }

        // Need lastShipSpawn to know ship has visited
        if (!lastShipSpawn) {
            console.log(`[DockMerchantSystem] No lastShipSpawn for dock ${dockId}, skipping`);
            return;
        }

        // Spawn merchant on dock when ship arrives
        console.log(`[DockMerchantSystem] Spawning merchant on dock for dock ${dockId}`);
        this.spawnMerchant(dockId, dockPosition, dockRotation, lastShipSpawn);
    }

    /**
     * Spawn a merchant for a dock (spawns directly on dock)
     */
    spawnMerchant(dockId, dockPosition, dockRotation, lastShipSpawn) {
        console.log(`[DockMerchantSystem] spawnMerchant called for dock ${dockId}`);

        if (this.merchants.has(dockId)) {
            console.log(`[DockMerchantSystem] spawnMerchant: Dock ${dockId} already has merchant, aborting`);
            return; // Already has merchant
        }

        const manGLTF = modelManager.getGLTF('man');
        if (!manGLTF) {
            console.error('[DockMerchantSystem] spawnMerchant FAILED: Man model not loaded yet!');
            return;
        }

        console.log(`[DockMerchantSystem] spawnMerchant: Man model loaded, creating merchant for dock ${dockId}`);

        // Get direction vectors based on dock rotation
        const dirs = getDockDirections(dockRotation ?? 90);

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

        // Clone and setup the man model
        const mesh = SkeletonUtils.clone(manGLTF.scene);
        const scale = 1; // Same scale as player (game.playerScale = 1)
        mesh.scale.set(scale, scale, scale);

        // Setup mesh visibility and color the shirt blue (use shared material)
        mesh.traverse((child) => {
            if (child.isMesh || child.isSkinnedMesh) {
                child.visible = true;
                child.frustumCulled = true;

                // Cube001_3 is the shirt (red color 9d1000) - use shared yellow material
                if (child.name === 'Cube001_3' && child.material) {
                    child.material = sharedShirtMaterial;
                }
            }
        });

        merchant.add(mesh);

        // Apply static idle pose ONCE (no per-frame animation updates needed)
        if (manGLTF.animations?.length > 0) {
            const idleAnim = manGLTF.animations.find(a => a.name.toLowerCase().includes('idle'));
            if (idleAnim) {
                const mixer = new THREE.AnimationMixer(mesh);
                const action = mixer.clipAction(idleAnim);
                action.play();
                mixer.update(0);  // Apply pose at frame 0
                mixer.stopAllAction();
                // Do NOT store mixer - just needed it to set pose
            }
        }

        // Face toward the water (based on dock rotation)
        merchant.rotation.y = dirs.merchantRotation;

        // Store merchant data - starts hidden until visibility check
        const merchantData = {
            entity: merchant,
            mesh: mesh,
            dockId: dockId,
            dockPosition: dockPosition,
            state: MERCHANT_STATE.HIDDEN,
            lastShipSpawn: lastShipSpawn,
            chunkX: chunkX,
            chunkZ: chunkZ,
            isVisible: false
        };

        this.merchants.set(dockId, merchantData);
        this.docksWithMerchant.add(dockId);

        // Add to spatial index
        this._addToSpatialIndex(dockId, merchantX, merchantZ);

        // Check visibility based on player position
        if (this.lastPlayerChunkX !== null) {
            this._updateMerchantVisibility(merchantData);
        }

        console.log(`[DockMerchantSystem] Spawned merchant on dock for dock ${dockId} at (${merchantX.toFixed(1)}, ${merchantZ.toFixed(1)})`);
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

        this.merchants.delete(dockId);
        // Also remove from docksWithMerchant so a new merchant can spawn if dock is rebuilt
        this.docksWithMerchant.delete(dockId);

        console.log(`[DockMerchantSystem] Removed merchant for dock ${dockId}`);
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

            // Spawn merchant when ship is docked OR has already departed
            // Merchant persists on dock after ship leaves
            if (phaseInfo.phase === PHASE.DOCKED) {
                console.log(`[DockMerchantSystem] checkForNewDockedShips: Dock ${dockId} has ship in DOCKED phase, spawning merchant`);
                this.spawnMerchant(dockId, dock.position, dock.rotation, dock.lastShipSpawn);
            } else if (phaseInfo.phase !== PHASE.APPROACH) {
                // Ship has departed (BACKUP, ROTATE, DEPART, DESPAWNED) - spawn on dock
                console.log(`[DockMerchantSystem] checkForNewDockedShips: Dock ${dockId} ship phase is ${phaseInfo.phase}, spawning merchant`);
                this.spawnMerchant(dockId, dock.position, dock.rotation, dock.lastShipSpawn);
            }
            // If APPROACH phase, wait for ship to dock before spawning merchant
        }
    }

    /**
     * Ensure merchant exists for a dock (called when dock is registered)
     * Only spawns merchant if ship has actually arrived (DOCKED phase or later)
     */
    ensureMerchantExists(dockId, dockPosition, dockRotation, lastShipSpawn) {
        console.log(`[DockMerchantSystem] ensureMerchantExists called for dock ${dockId}, lastShipSpawn: ${lastShipSpawn}`);

        // Skip if already has merchant
        if (this.merchants.has(dockId)) {
            console.log(`[DockMerchantSystem] ensureMerchantExists: Dock ${dockId} already has merchant`);
            return;
        }

        // Need lastShipSpawn to know a ship cycle has started
        if (!lastShipSpawn) {
            console.log(`[DockMerchantSystem] ensureMerchantExists: Dock ${dockId} has no lastShipSpawn, no merchant`);
            return;
        }

        // Check the ship's current phase - only spawn if ship has actually arrived
        if (!this.scheduledShipSystem) {
            console.log(`[DockMerchantSystem] ensureMerchantExists: No scheduledShipSystem, skipping`);
            return;
        }

        const elapsed = (Date.now() - lastShipSpawn) / 1000;
        const phaseInfo = this.scheduledShipSystem.getCurrentPhase(elapsed);

        // Only spawn merchant if ship is DOCKED or has already departed
        // Do NOT spawn if ship is still APPROACHING
        if (phaseInfo.phase === PHASE.DOCKED) {
            console.log(`[DockMerchantSystem] ensureMerchantExists: Dock ${dockId} ship is DOCKED, spawning merchant`);
            this.spawnMerchant(dockId, dockPosition, dockRotation, lastShipSpawn);
        } else if (phaseInfo.phase !== PHASE.APPROACH) {
            // Ship has departed (BACKUP, ROTATE, DEPART, DESPAWNED) - spawn on dock
            console.log(`[DockMerchantSystem] ensureMerchantExists: Dock ${dockId} ship phase is ${phaseInfo.phase}, spawning merchant`);
            this.spawnMerchant(dockId, dockPosition, dockRotation, lastShipSpawn);
        } else {
            console.log(`[DockMerchantSystem] ensureMerchantExists: Dock ${dockId} ship still APPROACHING, waiting`);
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
    }

    /**
     * Get count of active merchants
     */
    getMerchantCount() {
        return this.merchants.size;
    }
}

export { MERCHANT_CONSTANTS, MERCHANT_STATE };

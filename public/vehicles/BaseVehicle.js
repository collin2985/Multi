/**
 * BaseVehicle.js
 * Abstract base class for all pilotable vehicles (boats, horses)
 *
 * Provides shared functionality:
 * - Entity identity (id, mesh, quality, owner)
 * - Movement state (velocity, heading)
 * - Disembark detection (8-point circle sampling)
 * - P2P sync timing
 * - Collider lifecycle stubs
 *
 * Subclasses must implement:
 * - createCharacterController()
 * - updateMovement()
 * - getTerrainConstraint()
 */

import { CONFIG } from '../config.js';
import { getTerrainHeight } from '../core/TerrainAccess.js';

export class BaseVehicle {
    constructor(type, config) {
        this.type = type;  // 'boat' | 'sailboat' | 'ship2' | 'horse'
        this.config = config;

        // Entity identity
        this.mesh = null;
        this.id = null;
        this.chunkKey = null;
        this.quality = null;
        this.lastRepairTime = null;
        this.owner = null;

        // Movement state
        this.velocity = 0;
        this.heading = 0;
        this.isActive = false;

        // Disembark state
        this.canDisembark = false;
        this.disembarkPosition = null;

        // Physics references
        this.characterController = null;
        this.staticColliderHandle = null;

        // P2P sync timing
        this._lastBroadcastTime = 0;
    }

    // === LIFECYCLE METHODS ===

    /**
     * Board this vehicle
     * @param {THREE.Object3D} mesh - The vehicle mesh
     * @param {string} id - Entity ID
     * @param {string} chunkKey - Current chunk
     * @param {number} quality - Vehicle quality (0-100)
     * @param {number} lastRepairTime - Timestamp of last repair
     * @param {string} owner - Owner account ID
     */
    board(mesh, id, chunkKey, quality, lastRepairTime, owner) {
        this.mesh = mesh;
        this.id = id;
        this.chunkKey = chunkKey;
        this.quality = quality;
        this.lastRepairTime = lastRepairTime;
        this.owner = owner;

        // Reset movement state
        this.velocity = 0;
        this.heading = mesh.rotation.y;
        this.isActive = true;

        // Clear disembark state
        this.canDisembark = false;
        this.disembarkPosition = null;
    }

    /**
     * Disembark from this vehicle
     * Clears all state - caller handles physics cleanup
     */
    disembark() {
        this.isActive = false;
        this.velocity = 0;
        this.canDisembark = false;
        this.disembarkPosition = null;

        // Clear physics references (actual cleanup done by caller)
        this.characterController = null;
        this.staticColliderHandle = null;

        // Keep mesh/id/quality for reference until fully cleaned up
    }

    /**
     * Full cleanup - called after disembark completes
     */
    cleanup() {
        this.mesh = null;
        this.id = null;
        this.chunkKey = null;
        this.quality = null;
        this.lastRepairTime = null;
        this.owner = null;
    }

    // === ABSTRACT METHODS (subclasses must implement) ===

    /**
     * Create the physics character controller for this vehicle
     * @param {PhysicsManager} physicsManager
     * @returns {number} Controller handle/ID
     */
    createCharacterController(physicsManager) {
        throw new Error('BaseVehicle.createCharacterController() is abstract - subclass must implement');
    }

    /**
     * Update vehicle movement based on input
     * @param {object} keys - Input state { forward, backward, left, right }
     * @param {number} deltaTime - Time since last frame (ms)
     * @param {TerrainGenerator} terrainGenerator - For height queries
     * @param {PhysicsManager} physicsManager - For collision detection
     */
    updateMovement(keys, deltaTime, terrainGenerator, physicsManager) {
        throw new Error('BaseVehicle.updateMovement() is abstract - subclass must implement');
    }

    /**
     * Get terrain constraint for this vehicle type
     * @returns {'water' | 'land'}
     */
    getTerrainConstraint() {
        throw new Error('BaseVehicle.getTerrainConstraint() is abstract - subclass must implement');
    }

    // === SHARED IMPLEMENTATION ===

    /**
     * Check if player can disembark at current position
     * Uses 8-point circle sampling to find valid land
     * @param {TerrainGenerator} terrainGenerator - For height queries (optional, uses getTerrainHeight)
     */
    checkDisembarkable(terrainGenerator = null) {
        if (!this.mesh) return;

        this.canDisembark = false;
        this.disembarkPosition = null;

        // Get dismount distance from config (horses dismount close, boats need to reach shore)
        const dismountDistance = this.config.dismountDistance ??
            (this.getTerrainConstraint() === 'land' ? 0.3 : 2);

        const position = this.mesh.position;
        const numSamples = CONFIG.VEHICLES?.DISEMBARK_SAMPLES ?? 8;

        // Sample points in circle around vehicle
        for (let i = 0; i < numSamples; i++) {
            const angle = (i / numSamples) * Math.PI * 2;
            const x = position.x + Math.cos(angle) * dismountDistance;
            const z = position.z + Math.sin(angle) * dismountDistance;

            // Get terrain height (includes docks via leveled areas)
            const y = getTerrainHeight(x, z);

            // Valid terrain: land with y >= 0
            if (y >= 0) {
                this.canDisembark = true;
                this.disembarkPosition = { x, y: y + 0.03, z };
                return;  // First valid point is enough
            }
        }
    }

    /**
     * Update disembark check (only when stopped)
     * @param {TerrainGenerator} terrainGenerator
     */
    updateDisembarkCheck(terrainGenerator = null) {
        if (this.velocity === 0) {
            this.checkDisembarkable(terrainGenerator);
        } else {
            // Clear when moving
            this.canDisembark = false;
            this.disembarkPosition = null;
        }
    }

    /**
     * Apply position/rotation to mesh and physics
     * @param {PhysicsManager} physicsManager
     */
    applyPosition(physicsManager) {
        if (!this.mesh) return;

        // Update mesh rotation
        this.mesh.rotation.y = this.heading;

        // Sync to physics if controller exists
        if (this.characterController && physicsManager) {
            physicsManager.updateKinematicPosition(
                this.characterController,
                this.mesh.position.x,
                this.mesh.position.y,
                this.mesh.position.z
            );
            physicsManager.updateKinematicRotation(
                this.characterController,
                this.heading
            );
        }
    }

    /**
     * Check if we should broadcast position to peers
     * @param {number} now - Current timestamp (Date.now())
     * @returns {boolean}
     */
    shouldBroadcast(now) {
        const interval = CONFIG.VEHICLES?.BROADCAST_INTERVAL ?? 150;
        if (now - this._lastBroadcastTime >= interval) {
            this._lastBroadcastTime = now;
            return true;
        }
        return false;
    }

    /**
     * Get serializable state for P2P sync
     * @returns {object}
     */
    getState() {
        return {
            id: this.id,
            type: this.type,
            position: this.mesh?.position.toArray() ?? [0, 0, 0],
            rotation: this.heading,
            velocity: this.velocity
        };
    }

    /**
     * Apply state from P2P sync (for peer vehicles)
     * @param {object} state
     */
    setState(state) {
        if (state.rotation !== undefined) {
            this.heading = state.rotation;
        }
        if (state.velocity !== undefined) {
            this.velocity = state.velocity;
        }
        // Position is typically lerped externally for smooth interpolation
    }

    // === UTILITY METHODS ===

    /**
     * Get config value with fallback
     * @param {string} key - Config key
     * @param {*} defaultValue - Default if not found
     * @returns {*}
     */
    getConfigValue(key, defaultValue) {
        return this.config[key] ?? defaultValue;
    }

    /**
     * Check if this vehicle is currently active (being piloted)
     * @returns {boolean}
     */
    isPiloting() {
        return this.isActive && this.mesh !== null;
    }

    /**
     * Get speed as fraction of max speed (0-1)
     * @returns {number}
     */
    getSpeedFraction() {
        const maxSpeed = this.config.maxSpeed ?? 0.001;
        return Math.abs(this.velocity) / maxSpeed;
    }
}

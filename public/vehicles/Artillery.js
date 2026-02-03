/**
 * Artillery - Towable artillery entity with manning capability
 *
 * Can only be towed by player mounted on horse.
 * Can be manned (stationary) for firing.
 *
 * ARTILLERY LIFECYCLE STATES (Implicit - No Explicit State Field)
 * ================================================================
 * Artillery state is derived from multiple flags, not a single state field:
 *
 * 1. PLACED (static on ground)
 *    - Default state, artillery sits in chunk
 *    - Check: !isTowed && !isShipMounted && !isManned
 *
 * 2. TOWED (attached to horse)
 *    - Player on horse is dragging artillery
 *    - Check: gameState.vehicleState.towedEntity?.type === 'artillery'
 *    - Handler: game.js attachTowedEntity() / releaseTowedEntity()
 *
 * 3. SHIP_MOUNTED (parented to ship)
 *    - Artillery loaded onto ship deck
 *    - Check: Artillery.isShipMounted(mesh) or mesh.parent?.userData?.modelType === 'ship2'
 *    - Handler: game.js loadArtilleryOnShip() / unloadArtilleryFromShip()
 *    - Data stored in: gameState.vehicleState.shipArtillery[]
 *
 * 4. MANNED (player operating)
 *    - Player standing behind artillery to fire
 *    - Check: gameState.vehicleState.mannedArtillery?.manningState?.isManning
 *    - Can be manned while PLACED or SHIP_MOUNTED (not while TOWED)
 *
 * COORDINATE SPACES
 * =================
 * When ship-mounted, use world coordinates:
 *   - Artillery.getWorldHeading(mesh)  - World Y rotation
 *   - mesh.getWorldPosition(vec)       - World position
 *   - Artillery.isShipMounted(mesh)    - Check mount state
 *
 * MILITIA
 * =======
 * Artillery can have AI militia (gunner) that auto-fires. Militia data must
 * persist through all state transitions. See AIController.js "ARTILLERY
 * MILITIA DATA MODEL" comment for details.
 */

import * as THREE from 'three';
import { TowedEntity } from './TowedEntity.js';
import { CONFIG } from '../config.js';

// Reusable temp objects for static methods (avoids allocation)
const _tempQuat = new THREE.Quaternion();
const _tempEuler = new THREE.Euler();

export class Artillery extends TowedEntity {
    constructor() {
        super('artillery');

        // Manning state (when player stands behind to fire)
        this.manningState = {
            isManning: false,
            heading: 0,
            lastFireTime: 0,
            isShipMounted: false,
            shipId: null,
            slotIndex: null
        };

        // Throttling for manning updates
        this._manningTerrainFrameCount = 0;
        this._manningBroadcastTime = 0;
    }

    /**
     * Get artillery-specific physics config
     */
    getConfig() {
        // Use new consolidated config if available, fall back to legacy
        if (CONFIG.TOWED_ENTITIES?.artillery) {
            return {
                ...CONFIG.TOWED_ENTITIES.SHARED,
                ...CONFIG.TOWED_ENTITIES.artillery
            };
        }

        // Legacy config fallback
        const legacy = CONFIG.ARTILLERY_PHYSICS || {};
        return {
            HITCH_OFFSET: legacy.HITCH_OFFSET ?? 0.4,
            TETHER_LENGTH: legacy.TETHER_LENGTH ?? 0.3,
            SPEED: legacy.ARTILLERY_SPEED ?? 2.0,
            PIVOT_SPEED: legacy.PIVOT_SPEED ?? 0.08,
            MIN_MOVE_THRESHOLD: legacy.MIN_MOVE_THRESHOLD ?? 0.01,
            MIN_DISTANCE_EPSILON: legacy.MIN_DISTANCE_EPSILON ?? 0.001,
            MAX_SAFE_ANGLE: legacy.MAX_SAFE_ANGLE ?? Math.PI * 0.35,
            DANGER_ANGLE: legacy.DANGER_ANGLE ?? Math.PI * 0.5,
            EMERGENCY_PIVOT_SPEED: legacy.EMERGENCY_PIVOT_SPEED ?? 0.3,
            BROADCAST_INTERVAL: legacy.BROADCAST_INTERVAL ?? 150,
            // Speed multiplier
            SPEED_MULTIPLIER: legacy.SPEED_MULTIPLIER ?? 0.667,
            // Turn rate
            TURN_RATE_MULTIPLIER: legacy.MOUNTED_TURN_RATE_MULTIPLIER ?? 0.5
        };
    }

    /**
     * Get combat config for manning/firing
     */
    getCombatConfig() {
        const combat = CONFIG.ARTILLERY_COMBAT || {};
        return {
            BARREL_DIRECTION: combat.BARREL_DIRECTION ?? -1,
            MANNING_OFFSET: combat.MANNING_OFFSET ?? 0.4,
            BARREL_OFFSET: combat.BARREL_OFFSET ?? { x: 0, y: 0.6, z: 1.2 },
            TURN_RATE: combat.TURN_RATE ?? (Math.PI * 2) / 6000,
            FIRE_COOLDOWN: combat.FIRE_COOLDOWN ?? 12000,
            RANGE: combat.RANGE ?? 28,
            BASE_HIT_CHANCE: combat.BASE_HIT_CHANCE ?? 0.35,
            MAX_HIT_CHANCE: combat.MAX_HIT_CHANCE ?? 0.8,
            POINT_BLANK_RANGE: combat.POINT_BLANK_RANGE ?? 8,
            HEIGHT_BONUS: combat.HEIGHT_BONUS ?? 0.15,
            AIM_BROADCAST_INTERVAL: combat.AIM_BROADCAST_INTERVAL ?? 150
        };
    }

    /**
     * Artillery can only be attached when mounted on horse
     */
    canAttach(gameState) {
        const vState = gameState.vehicleState;
        if (!vState?.isActive()) return false;
        if (!vState.isPiloting()) return false;
        if (vState.pilotingEntityType !== 'horse') return false;
        return true;
    }

    /**
     * Get speed multiplier when towing artillery
     */
    getSpeedMultiplier() {
        const config = this.getConfig();
        return config.SPEED_MULTIPLIER ?? 0.667;
    }

    /**
     * Get turn rate multiplier when towing artillery
     */
    getTurnRateMultiplier() {
        const config = this.getConfig();
        return config.TURN_RATE_MULTIPLIER ?? 0.5;
    }

    // ==========================================
    // MANNING METHODS
    // ==========================================

    /**
     * Check if artillery can be manned
     */
    canMan() {
        // Can't man if being towed
        if (this.isAttached) return false;
        // Can't man if already manning
        if (this.manningState.isManning) return false;
        return true;
    }

    /**
     * Start manning this artillery
     * @param {THREE.Object3D} mesh - Artillery mesh
     * @param {string} id - Entity ID
     * @param {string} chunkKey - Chunk key
     * @param {Object} options - Optional: { isShipMounted, shipId, slotIndex }
     */
    startManning(mesh, id, chunkKey, options = {}) {
        this.mesh = mesh;
        this.id = id;
        this.chunkKey = chunkKey;
        this.originalChunkKey = chunkKey;

        this.manningState.isManning = true;
        this.manningState.heading = mesh.rotation.y;
        this.manningState.lastFireTime = 0;
        this.manningState.isShipMounted = options.isShipMounted || false;
        this.manningState.shipId = options.shipId || null;
        this.manningState.slotIndex = options.slotIndex ?? null;

        this._manningTerrainFrameCount = 0;
        this._manningBroadcastTime = 0;
    }

    /**
     * Stop manning this artillery
     */
    stopManning() {
        this.manningState.isManning = false;
        this.manningState.heading = 0;
        this.manningState.lastFireTime = 0;
        this.manningState.isShipMounted = false;
        this.manningState.shipId = null;
        this.manningState.slotIndex = null;

        this._manningTerrainFrameCount = 0;
        this._manningBroadcastTime = 0;

        // Don't clear mesh/id if still attached (towing)
        if (!this.isAttached) {
            this.mesh = null;
            this.id = null;
            this.chunkKey = null;
            this.originalChunkKey = null;
        }
    }

    /**
     * Update heading from A/D input
     * @param {number} deltaTime - Frame delta in ms
     * @param {boolean} turnLeft - A key pressed
     * @param {boolean} turnRight - D key pressed
     * @param {Object} slotConfig - For ship-mounted rotation limits
     * @returns {boolean} - Whether rotation changed
     */
    updateHeading(deltaTime, turnLeft, turnRight, slotConfig = null) {
        if (!this.manningState.isManning) return false;

        const combat = this.getCombatConfig();
        const turnRate = combat.TURN_RATE;
        let rotated = false;

        if (turnLeft) {
            this.manningState.heading += turnRate * deltaTime;
            rotated = true;
        }
        if (turnRight) {
            this.manningState.heading -= turnRate * deltaTime;
            rotated = true;
        }

        // ROTATION MODEL (implicit based on mount state)
        // =============================================
        // Land artillery: 360° free rotation, normalized to [-PI, PI]
        // Ship-mounted: ±90° from slot's base rotation (broadside arcs)
        //
        // This is implicit - determined by isShipMounted flag at runtime,
        // not by explicit rotationLimits property on artillery data.
        // Same logic is applied in:
        //   - Artillery.updateHeading() (player manning)
        //   - AIController._updateArtilleryMilitia() (militia AI)
        //   - game.js updateMannedArtillery() (player aim updates)
        if (this.manningState.isShipMounted && slotConfig) {
            const baseRotation = slotConfig.rotation;
            const maxDeviation = Math.PI / 2;  // +-90 degrees from slot facing
            const minRotation = baseRotation - maxDeviation;
            const maxRotation = baseRotation + maxDeviation;
            this.manningState.heading = Math.max(minRotation, Math.min(maxRotation, this.manningState.heading));
        } else {
            // Land artillery: free 360° rotation, normalized to [-PI, PI]
            while (this.manningState.heading > Math.PI) this.manningState.heading -= Math.PI * 2;
            while (this.manningState.heading < -Math.PI) this.manningState.heading += Math.PI * 2;
        }

        // Apply rotation to mesh
        if (this.mesh) {
            this.mesh.rotation.y = this.manningState.heading;
        }

        return rotated;
    }

    /**
     * Calculate breech position (where player stands)
     * @param {THREE.Vector3} artilleryPos - Artillery position (world coords for ship-mounted)
     * @param {number} heading - Heading to use (world heading for ship-mounted)
     * @returns {{ x, y, z }} - Breech position
     */
    getBreechPosition(artilleryPos, heading) {
        const combat = this.getCombatConfig();
        const offset = combat.MANNING_OFFSET;
        const barrelDir = combat.BARREL_DIRECTION;

        // Breech is opposite to barrel direction
        return {
            x: artilleryPos.x - barrelDir * Math.sin(heading) * offset,
            y: artilleryPos.y,
            z: artilleryPos.z - barrelDir * Math.cos(heading) * offset
        };
    }

    /**
     * Calculate barrel position (for effects/projectile spawn)
     * @param {THREE.Vector3} artilleryPos - Artillery position (world coords)
     * @param {number} heading - Heading (world heading)
     * @returns {{ x, y, z }} - Barrel tip position
     */
    getBarrelPosition(artilleryPos, heading) {
        const combat = this.getCombatConfig();
        const barrelDir = combat.BARREL_DIRECTION;
        const barrelOffset = combat.BARREL_OFFSET;

        return {
            x: artilleryPos.x + barrelDir * Math.sin(heading) * barrelOffset.z,
            y: artilleryPos.y + barrelOffset.y,
            z: artilleryPos.z + barrelDir * Math.cos(heading) * barrelOffset.z
        };
    }

    /**
     * Check if fire is off cooldown
     * @param {number} now - Current timestamp
     * @returns {boolean}
     */
    canFire(now) {
        if (!this.manningState.isManning) return false;
        const combat = this.getCombatConfig();
        return (now - this.manningState.lastFireTime) >= combat.FIRE_COOLDOWN;
    }

    /**
     * Record fire time (call after successful fire)
     * @param {number} now - Current timestamp
     */
    recordFire(now) {
        this.manningState.lastFireTime = now;
    }

    /**
     * Get remaining cooldown in ms
     * @param {number} now - Current timestamp
     * @returns {number}
     */
    getCooldownRemaining(now) {
        const combat = this.getCombatConfig();
        const elapsed = now - this.manningState.lastFireTime;
        return Math.max(0, combat.FIRE_COOLDOWN - elapsed);
    }

    /**
     * Check if should broadcast aim update
     * @param {number} now - Current timestamp
     * @returns {boolean}
     */
    shouldBroadcastAim(now) {
        const combat = this.getCombatConfig();
        if (now - this._manningBroadcastTime >= combat.AIM_BROADCAST_INTERVAL) {
            this._manningBroadcastTime = now;
            return true;
        }
        return false;
    }

    /**
     * Increment terrain frame counter for throttling
     * @returns {boolean} - True if should update terrain Y this frame
     */
    shouldUpdateTerrainY() {
        this._manningTerrainFrameCount++;
        if (this._manningTerrainFrameCount >= 10) {
            this._manningTerrainFrameCount = 0;
            return true;
        }
        return false;
    }

    /**
     * Get state for P2P manning broadcast
     */
    getManningState() {
        const state = {
            artilleryId: this.id,
            heading: this.manningState.heading,
            isShipMounted: this.manningState.isShipMounted,
            shipId: this.manningState.shipId,
            slotIndex: this.manningState.slotIndex
        };
        // Include world position for reliable peer sync
        if (this.mesh) {
            const worldPos = new THREE.Vector3();
            this.mesh.getWorldPosition(worldPos);
            state.position = worldPos.toArray();
        }
        return state;
    }

    /**
     * Get state for P2P aim broadcast
     */
    getAimState() {
        const state = {
            artilleryId: this.id,
            heading: this.manningState.heading
        };
        if (this.manningState.isShipMounted && this.manningState.shipId) {
            state.isShipMounted = true;
            state.shipId = this.manningState.shipId;
        }
        return state;
    }

    /**
     * Calculate hit chance for artillery (matches rifle formula)
     * @param {number} shooterY - Shooter height
     * @param {number} targetY - Target height
     * @param {number} distance - Distance to target
     * @param {number} quality - Artillery quality
     * @returns {number} - Hit chance 0-1
     */
    calculateHitChance(shooterY, targetY, distance, quality) {
        const combat = this.getCombatConfig();

        // Quality bonus: +-10% for quality deviation from 50
        const qualityBonus = ((quality - 50) / 50) * 0.10;

        // Height advantage bonus
        const heightBonus = Math.max(0, shooterY - targetY) * combat.HEIGHT_BONUS;

        // Base chance
        const baseHitChance = combat.BASE_HIT_CHANCE + qualityBonus + heightBonus;

        // Distance bonus (closer = better)
        const distanceBonus = (combat.RANGE - distance) / combat.RANGE;

        // Final chance with cap
        const finalChance = baseHitChance + (1.0 - baseHitChance) * distanceBonus;
        return Math.min(combat.MAX_HIT_CHANCE, Math.max(0, finalChance));
    }

    // ==========================================
    // STATIC UTILITY METHODS
    // ==========================================

    /**
     * Get world heading from artillery mesh (handles ship parenting)
     * Always returns correct world-space Y rotation regardless of parent.
     * @param {THREE.Object3D} mesh - Artillery mesh
     * @returns {number} - World Y rotation in radians
     */
    static getWorldHeading(mesh) {
        mesh.getWorldQuaternion(_tempQuat);
        _tempEuler.setFromQuaternion(_tempQuat, 'YXZ');
        return _tempEuler.y;
    }

    /**
     * Check if artillery is mounted on a ship
     * @param {THREE.Object3D} mesh - Artillery mesh
     * @returns {boolean}
     */
    static isShipMounted(mesh) {
        return mesh.parent?.userData?.modelType === 'ship2';
    }
}

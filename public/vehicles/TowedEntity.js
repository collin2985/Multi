/**
 * TowedEntity - Base class for towable entities (cart, artillery)
 *
 * Handles hitch-point towing physics with jackknife prevention.
 * Subclasses define type-specific behavior (canAttach, speed multipliers).
 */

import { CONFIG } from '../config.js';

export class TowedEntity {
    constructor(type) {
        this.type = type;  // 'cart' | 'artillery'

        // Attachment state
        this.isAttached = false;
        this.mesh = null;
        this.id = null;
        this.chunkKey = null;
        this.originalChunkKey = null;
        this.quality = null;
        this.lastRepairTime = null;

        // Throttling
        this._terrainFrameCount = 0;
        this._lastBroadcastTime = 0;
    }

    /**
     * Get physics config for this entity type
     */
    getConfig() {
        return CONFIG.TOWED_ENTITIES?.[this.type] || CONFIG.TOWED_ENTITIES?.SHARED || {
            HITCH_OFFSET: 0.4,
            TETHER_LENGTH: 0.3,
            SPEED: 2.5,
            PIVOT_SPEED: 0.08,
            MIN_MOVE_THRESHOLD: 0.01,
            MIN_DISTANCE_EPSILON: 0.001,
            MAX_SAFE_ANGLE: Math.PI * 0.35,
            DANGER_ANGLE: Math.PI * 0.5,
            EMERGENCY_PIVOT_SPEED: 0.3,
            BROADCAST_INTERVAL: 150
        };
    }

    /**
     * Get shared physics constants
     */
    getSharedConfig() {
        return CONFIG.TOWED_ENTITIES?.SHARED || {
            HITCH_OFFSET: 0.4,
            TETHER_LENGTH: 0.3,
            PIVOT_SPEED: 0.08,
            MIN_MOVE_THRESHOLD: 0.01,
            MIN_DISTANCE_EPSILON: 0.001,
            MAX_SAFE_ANGLE: Math.PI * 0.35,
            DANGER_ANGLE: Math.PI * 0.5,
            EMERGENCY_PIVOT_SPEED: 0.3,
            BROADCAST_INTERVAL: 150,
            TERRAIN_UPDATE_FRAMES: 5
        };
    }

    /**
     * Check if this entity can be attached given current game state
     * @param {Object} gameState - Current game state
     * @returns {boolean}
     */
    canAttach(gameState) {
        // Override in subclass
        return false;
    }

    /**
     * Get speed multiplier for the puller when towing this entity
     * @param {boolean} hasLoadedCargo - Whether cargo is loaded (for cart)
     * @returns {number}
     */
    getSpeedMultiplier(hasLoadedCargo = false) {
        // Override in subclass
        return 1.0;
    }

    /**
     * Attach to a mesh
     */
    attach(mesh, id, chunkKey, quality, lastRepairTime) {
        this.isAttached = true;
        this.mesh = mesh;
        this.id = id;
        this.chunkKey = chunkKey;
        this.originalChunkKey = chunkKey;
        this.quality = quality;
        this.lastRepairTime = lastRepairTime;
        this._terrainFrameCount = 0;
        this._lastBroadcastTime = 0;
    }

    /**
     * Detach and clear state
     */
    detach() {
        this.isAttached = false;
        this.mesh = null;
        this.id = null;
        this.chunkKey = null;
        this.originalChunkKey = null;
        this.quality = null;
        this.lastRepairTime = null;
        this._terrainFrameCount = 0;
        this._lastBroadcastTime = 0;
    }

    /**
     * Update towed entity position using hitch-point physics
     * @param {THREE.Vector3} pullerPos - Position of puller (player or horse)
     * @param {number} deltaTime - Frame delta in milliseconds
     * @param {Object} terrainGenerator - For terrain height lookup
     * @param {boolean} isReversing - Whether puller is in reverse mode
     * @param {Function} lerpAngleFn - Angle lerp function
     * @returns {boolean} - True if position changed
     */
    updatePosition(pullerPos, deltaTime, terrainGenerator, isReversing, lerpAngleFn) {
        if (!this.isAttached || !this.mesh) return false;

        const config = this.getConfig();
        const shared = this.getSharedConfig();

        const HITCH_OFFSET = config.HITCH_OFFSET ?? shared.HITCH_OFFSET;
        const TETHER_LENGTH = config.TETHER_LENGTH ?? shared.TETHER_LENGTH;
        const SPEED = config.SPEED ?? config.CART_SPEED ?? config.ARTILLERY_SPEED ?? 2.5;
        const PIVOT_SPEED = config.PIVOT_SPEED ?? shared.PIVOT_SPEED;
        const MIN_MOVE_THRESHOLD = config.MIN_MOVE_THRESHOLD ?? shared.MIN_MOVE_THRESHOLD ?? 0.01;
        const MIN_DISTANCE_EPSILON = config.MIN_DISTANCE_EPSILON ?? shared.MIN_DISTANCE_EPSILON ?? 0.001;
        const MAX_SAFE_ANGLE = config.MAX_SAFE_ANGLE ?? shared.MAX_SAFE_ANGLE;
        const DANGER_ANGLE = config.DANGER_ANGLE ?? shared.DANGER_ANGLE;
        const EMERGENCY_PIVOT_SPEED = config.EMERGENCY_PIVOT_SPEED ?? shared.EMERGENCY_PIVOT_SPEED;
        const TERRAIN_UPDATE_FRAMES = shared.TERRAIN_UPDATE_FRAMES ?? 5;

        const entity = this.mesh;
        const entityHeading = entity.rotation.y;

        // Calculate hitch point (front of entity, offset along entity's forward direction)
        const hitchX = entity.position.x + Math.sin(entityHeading) * HITCH_OFFSET;
        const hitchZ = entity.position.z + Math.cos(entityHeading) * HITCH_OFFSET;

        // Calculate pull direction (from hitch to puller)
        const pullDirX = pullerPos.x - hitchX;
        const pullDirZ = pullerPos.z - hitchZ;

        // Use squared distance comparison to avoid sqrt when tether is slack
        const pullDistanceSq = pullDirX * pullDirX + pullDirZ * pullDirZ;
        const tetherThreshold = TETHER_LENGTH + MIN_MOVE_THRESHOLD;
        const tetherThresholdSq = tetherThreshold * tetherThreshold;

        let positionChanged = false;

        // Only apply physics if tether is taut
        if (pullDistanceSq > tetherThresholdSq) {
            const pullDistance = Math.sqrt(pullDistanceSq);
            const safeDistance = Math.max(pullDistance, MIN_DISTANCE_EPSILON);
            const normPullX = pullDirX / safeDistance;
            const normPullZ = pullDirZ / safeDistance;

            // Calculate target heading
            let targetHeading;
            if (isReversing) {
                targetHeading = Math.atan2(-normPullX, -normPullZ);
            } else {
                targetHeading = Math.atan2(normPullX, normPullZ);
            }

            // Calculate angle difference for jackknife detection
            let angleDiff = targetHeading - entityHeading;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            const absAngleDiff = Math.abs(angleDiff);

            // Variable pivot speed based on angle
            let pivotSpeed = PIVOT_SPEED;
            if (absAngleDiff > DANGER_ANGLE) {
                pivotSpeed = EMERGENCY_PIVOT_SPEED;
            } else if (absAngleDiff > MAX_SAFE_ANGLE) {
                const t = (absAngleDiff - MAX_SAFE_ANGLE) / (DANGER_ANGLE - MAX_SAFE_ANGLE);
                pivotSpeed = PIVOT_SPEED + t * (EMERGENCY_PIVOT_SPEED - PIVOT_SPEED);
            }

            // Rotate entity toward target heading
            entity.rotation.y = lerpAngleFn(entityHeading, targetHeading, pivotSpeed);

            // Move entity along pull direction
            const tensionDistance = pullDistance - TETHER_LENGTH;
            const maxMoveThisFrame = SPEED * (deltaTime / 1000);
            const moveAmount = Math.min(tensionDistance, maxMoveThisFrame);

            const moveDirX = isReversing ? -normPullX : normPullX;
            const moveDirZ = isReversing ? -normPullZ : normPullZ;

            entity.position.x += moveDirX * moveAmount;
            entity.position.z += moveDirZ * moveAmount;

            positionChanged = true;
        }

        // Throttle terrain Y lookup
        this._terrainFrameCount++;
        if (this._terrainFrameCount % TERRAIN_UPDATE_FRAMES === 0 && terrainGenerator) {
            entity.position.y = terrainGenerator.getWorldHeight(entity.position.x, entity.position.z);
        }

        return positionChanged;
    }

    /**
     * Check if enough time has passed for a P2P broadcast
     */
    shouldBroadcast() {
        const config = this.getConfig();
        const shared = this.getSharedConfig();
        const interval = config.BROADCAST_INTERVAL ?? shared.BROADCAST_INTERVAL ?? 150;

        const now = Date.now();
        if (now - this._lastBroadcastTime > interval) {
            this._lastBroadcastTime = now;
            return true;
        }
        return false;
    }

    /**
     * Get state for P2P sync
     */
    getState() {
        if (!this.mesh) return null;
        return {
            entityType: this.type,
            entityId: this.id,
            position: this.mesh.position.toArray(),
            rotation: this.mesh.rotation.y,
            chunkKey: this.chunkKey,
            quality: this.quality,
            lastRepairTime: this.lastRepairTime
        };
    }

    /**
     * Get state for server release message
     */
    getReleaseState() {
        if (!this.mesh) return null;
        return {
            entityType: this.type,
            entityId: this.id,
            position: {
                x: this.mesh.position.x,
                y: this.mesh.position.y,
                z: this.mesh.position.z
            },
            rotation: this.mesh.rotation.y,
            chunkKey: this.chunkKey,
            originalChunkKey: this.originalChunkKey,
            quality: this.quality,
            lastRepairTime: this.lastRepairTime
        };
    }

    /**
     * Update chunk key (when crossing chunk boundaries)
     */
    updateChunkKey(newChunkKey) {
        this.chunkKey = newChunkKey;
    }
}

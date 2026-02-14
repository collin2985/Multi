/**
 * PhysicsManager.js
 * Wrapper for Rapier physics engine - handles collision detection and spatial queries
 */

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { ChunkPerfTimer } from './PerformanceTimer.js';
import { frameBudget } from './FrameBudget.js';

// Collision groups (bit masks for filtering)
export const COLLISION_GROUPS = {
    NONE: 0x0000,
    PLAYER: 0x0002,
    PEER: 0x0004,
    AI: 0x0008,
    STRUCTURE: 0x0010,
    NATURAL: 0x0020,      // Trees, rocks
    PLACED: 0x0040,       // Logs, crates
    SENSOR: 0x0080,       // Proximity sensors (no collision response)
    BOAT: 0x0100,         // Boats, sailboats, ships (collide with each other)
};

// How far structure/construction colliders extend below their placement position
// This prevents walking through foundations on hillsides
const FOUNDATION_EXTENSION = 4.0;

export class PhysicsManager {
    constructor(scene) {
        this.scene = scene;
        this.world = null;
        this.initialized = false;

        // Debug visualization
        this.debugEnabled = false;
        this.debugLines = null;

        // Character controllers
        this.characterControllers = new Map(); // objectId -> controller

        // Collider registry (for cleanup)
        this.colliderHandles = new Map(); // objectId -> colliderHandle
        this.rigidbodyHandles = new Map(); // objectId -> rigidBodyHandle
        this.colliderToObjectId = new Map(); // colliderHandle.handle -> objectId (reverse lookup for performance)

        // Collision event system
        this.eventQueue = null;
        this.collisionCallbacks = []; // Array of callbacks to fire on collision events

        // Optional callback for object removal (to clean up external registries)
        this.onObjectRemoved = null;

        // Collider batching queue (ISSUE-068) - Map for O(1) lookup/delete, preserves insertion order
        this.pendingColliders = new Map();
        this.COLLIDER_BATCH_BUDGET_MS = 1.7; // Max ms per frame for collider creation

        // Pre-allocated vectors for hot path methods - reused every frame
        // Using plain JS objects (Rapier accepts any object with x/y/z fields)
        this._tempRapierVec = { x: 0, y: 0, z: 0 };
        this._tempDesiredMovement = { x: 0, y: 0, z: 0 };

        // Pre-allocated for computeCharacterMovement return value
        this._correctedMovement = new THREE.Vector3();

        // Cache for merchant collision shapes (avoid allocation every frame)
        this._merchantCollisionShapes = new Map(); // boatType -> RAPIER.Cuboid

        // Collider Pool (Phase 8) - disable/enable pattern for performance
        // Keyed by shape signature: "cuboid_{w}_{d}_{h}" or "cylinder_{r}_{h}"
        this.staticPool = new Map();      // shapeKey -> [{collider, objectId, collisionGroup}, ...]
        this.kinematicPool = new Map();   // shapeKey -> [{controller, rigidBody, collider, objectId}, ...]

        // Track active colliders for pool management
        this.activeStaticColliders = new Map();    // objectId -> {shapeKey, collisionGroup}
        this.activeKinematicControllers = new Map(); // objectId -> {shapeKey}

        // Pool metrics
        this.poolMetrics = {
            // Static colliders (vehicles)
            staticHits: 0,
            staticMisses: 0,
            staticReleases: 0,
            // Kinematic controllers
            kinematicHits: 0,
            kinematicMisses: 0,
            kinematicReleases: 0,
            // Overall
            highWaterMark: 0
        };

        // Pool constants
        this.POOL_DISABLE_Y = -1000; // Y position for disabled pool items
        this.MAX_KINEMATIC_POOL_SIZE = 20; // Max idle items per shape key
        this.MAX_STATIC_POOL_SIZE = 30;    // Max idle items per shape key
    }

    /**
     * Initialize Rapier physics world
     */
    async initialize() {
        try {
            await RAPIER.init();

            // Create world with zero gravity (terrain following is manual)
            const gravity = new RAPIER.Vector3(0.0, 0.0, 0.0);
            this.world = new RAPIER.World(gravity);

            // Create event queue for collision events
            this.eventQueue = new RAPIER.EventQueue(true);

            // Pre-allocate reusable objects for hot-path queries (avoid GC pressure)
            this._queryTranslation = new RAPIER.Vector3(0, 0, 0);
            this._queryRotation = new RAPIER.Quaternion(0, 0, 0, 1);
            this._queryBallCache = new Map(); // radius -> RAPIER.Ball (cache common radii)

            // Pre-allocate reusable objects for placement overlap testing (testShapeOverlap)
            // Called 60+ times/sec during structure placement - avoid GC pressure
            this._overlapTranslation = new RAPIER.Vector3(0, 0, 0);
            this._overlapQuaternion = new RAPIER.Quaternion(0, 0, 0, 1);
            this._threeQuaternion = new THREE.Quaternion();
            this._upAxis = new THREE.Vector3(0, 1, 0);
            this._shapeCache = new Map(); // dimension key -> RAPIER shape

            this.initialized = true;

            return true;
        } catch (error) {
            console.error('[PHYSICS] Failed to initialize Rapier:', error);
            this.initialized = false;
            return false;
        }
    }

    /**
     * Generate shape key for pool lookup
     * @param {object} shape - {type: 'cuboid'|'cylinder', ...dimensions}
     * @returns {string} - Shape signature like "cuboid_0.4_1.1_1.0" or "cylinder_0.15_2.0"
     */
    _getShapeKey(shape) {
        if (shape.type === 'cuboid') {
            return `cuboid_${shape.width}_${shape.depth}_${shape.height || 1}`;
        } else if (shape.type === 'cylinder') {
            return `cylinder_${shape.radius}_${shape.height || 1}`;
        }
        return `unknown_${Date.now()}`;
    }

    /**
     * Pre-warm pools with common vehicle shapes
     * Call during game initialization for immediate pool hits
     */
    warmPools() {
        if (!this.initialized) return;

        // Common kinematic shapes (piloted vehicles + player)
        const PREWARM_KINEMATIC = [
            { type: 'cuboid', width: 0.4, depth: 1.1, height: 1.0 },   // boat (with COLLIDER_SHRINK)
            { type: 'cuboid', width: 0.4, depth: 1.7, height: 2.0 },   // sailboat (with COLLIDER_SHRINK)
            { type: 'cylinder', radius: 0.15, height: 2.0 },           // horse
            { type: 'cylinder', radius: 0.3, height: 1.8 },            // player
        ];

        // Pre-create 2 instances of each kinematic shape
        let prewarmCount = 0;
        for (const shape of PREWARM_KINEMATIC) {
            const shapeKey = this._getShapeKey(shape);

            // Create 2 pooled instances per shape
            for (let i = 0; i < 2; i++) {
                const tempId = `_prewarm_${shapeKey}_${i}`;
                const tempPos = { x: 0, y: this.POOL_DISABLE_Y, z: 0 };

                // Create kinematic body at disabled position
                const body = this._createKinematicBodyRaw(tempId, shape, tempPos, 0, COLLISION_GROUPS.NONE);
                if (!body) continue;

                // Create character controller
                const controller = this.world.createCharacterController(0.01);
                controller.enableAutostep(0, 0, false);
                controller.enableSnapToGround(0);

                // Add to pool
                if (!this.kinematicPool.has(shapeKey)) {
                    this.kinematicPool.set(shapeKey, []);
                }
                this.kinematicPool.get(shapeKey).push({
                    controller,
                    rigidBody: body.rigidBody,
                    collider: body.collider,
                    objectId: null, // Not assigned to any object yet
                    height: shape.height || 1.0
                });

                prewarmCount++;
            }
        }
    }

    /**
     * Step the physics simulation
     * @param {number} deltaTime - Time step in seconds
     */
    step(deltaTime = 1/60) {
        if (!this.initialized || !this.world) return;

        this.world.step(this.eventQueue);

        // Process collision events
        if (this.eventQueue) {
            this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
                if (started) {
                    // Collision started - fire callbacks
                    const objectId1 = this.colliderToObjectId.get(handle1);
                    const objectId2 = this.colliderToObjectId.get(handle2);

                    if (objectId1 && objectId2) {
                        // Fire all registered callbacks
                        this.collisionCallbacks.forEach(callback => {
                            callback(objectId1, objectId2);
                        });
                    }
                }
            });
        }
    }

    /**
     * Create a static collider (for structures, trees, rocks)
     * Pool-aware: checks pool first for vehicle colliders, creates new only on miss
     * @param {string} objectId - Unique object identifier
     * @param {object} shape - {type: 'cylinder'|'cuboid', ...params}
     * @param {THREE.Vector3} position
     * @param {number} rotation - Y rotation in radians
     * @param {number} collisionGroup - Bit mask for collision filtering
     * @returns {object} - Collider handle
     */
    createStaticCollider(objectId, shape, position, rotation = 0, collisionGroup = COLLISION_GROUPS.STRUCTURE) {
        if (!this.initialized) return null;

        // Guard against undefined objectId
        if (!objectId) {
            console.warn('[PHYSICS] createStaticCollider called with undefined objectId');
            return null;
        }

        // Check for existing collider with same objectId (prevent duplicates)
        if (this.colliderHandles.has(objectId)) {
            return this.colliderHandles.get(objectId);
        }

        ChunkPerfTimer.start('Physics.createStaticCollider');

        // Calculate collider Y position for cuboids
        let colliderY = position.y;
        if (shape.type === 'cuboid') {
            const isStructureCollider = collisionGroup === COLLISION_GROUPS.STRUCTURE;
            const extensionAmount = isStructureCollider ? FOUNDATION_EXTENSION : 0;
            const originalHalfHeight = shape.height / 2 || 0.5;
            colliderY += originalHalfHeight - extensionAmount / 2;
        }

        // Check if this is a vehicle type (pool candidates)
        const isVehicle = objectId.startsWith('boat_') || objectId.startsWith('sailboat_') ||
                          objectId.startsWith('ship2_') || objectId.startsWith('horse_');

        // Generate shape key for pooling
        const shapeKey = this._getShapeKey(shape) + '_' + collisionGroup;

        // Check pool for available static collider (vehicles only)
        if (isVehicle) {
            const pool = this.staticPool.get(shapeKey);
            if (pool && pool.length > 0) {
                const pooled = pool.pop();
                this.poolMetrics.staticHits++;

                // Reposition collider
                pooled.collider.setTranslation({ x: position.x, y: colliderY, z: position.z });

                // Set rotation
                const halfAngle = rotation / 2;
                pooled.collider.setRotation({ x: 0, y: Math.sin(halfAngle), z: 0, w: Math.cos(halfAngle) });

                // Restore collision group
                pooled.collider.setCollisionGroups(this._getCollisionMask(collisionGroup));

                // Register in maps
                this.colliderHandles.set(objectId, pooled.collider);
                this.colliderToObjectId.set(pooled.collider.handle, objectId);

                // Track for pool release
                this.activeStaticColliders.set(objectId, { shapeKey, collisionGroup });

                ChunkPerfTimer.end('Physics.createStaticCollider');
                return pooled.collider;
            }
        }

        // Pool miss or non-vehicle - create new
        if (isVehicle) {
            this.poolMetrics.staticMisses++;
        }

        try {
            // Create collider descriptor
            let colliderDesc;

            if (shape.type === 'cylinder') {
                const halfHeight = shape.height / 2 || 0.5;
                colliderDesc = RAPIER.ColliderDesc.cylinder(halfHeight, shape.radius);
            } else if (shape.type === 'cuboid') {
                const halfWidth = shape.width / 2;
                const halfDepth = shape.depth / 2;
                const isStructureCollider = collisionGroup === COLLISION_GROUPS.STRUCTURE;
                const extensionAmount = isStructureCollider ? FOUNDATION_EXTENSION : 0;
                const halfHeight = (shape.height + extensionAmount) / 2 || 0.5;
                colliderDesc = RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight, halfDepth);
            } else {
                console.error(`[PHYSICS] Unknown shape type: ${shape.type}`);
                ChunkPerfTimer.end('Physics.createStaticCollider');
                return null;
            }

            // Set collision groups
            colliderDesc.setCollisionGroups(this._getCollisionMask(collisionGroup));

            // Set position and rotation
            const quaternion = new THREE.Quaternion();
            quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
            const rapierRotation = new RAPIER.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

            colliderDesc.setTranslation(position.x, colliderY, position.z);
            colliderDesc.setRotation(rapierRotation);

            // Create collider
            const collider = this.world.createCollider(colliderDesc);

            // Store handle for cleanup
            this.colliderHandles.set(objectId, collider);
            this.colliderToObjectId.set(collider.handle, objectId);

            // Track vehicles for pool release
            if (isVehicle) {
                this.activeStaticColliders.set(objectId, { shapeKey, collisionGroup });
            }

            ChunkPerfTimer.end('Physics.createStaticCollider');
            return collider;
        } catch (error) {
            console.error(`[PHYSICS] Failed to create static collider for ${objectId}:`, error);
            ChunkPerfTimer.end('Physics.createStaticCollider');
            return null;
        }
    }

    /**
     * Queue a collider for batched creation (ISSUE-068)
     * Instead of creating immediately, adds to queue for frame-budgeted processing
     * @param {string} objectId - Unique object identifier
     * @param {object} shape - {type: 'cylinder'|'cuboid', ...params}
     * @param {THREE.Vector3} position
     * @param {number} rotation - Y rotation in radians
     * @param {number} collisionGroup - Bit mask for collision filtering
     * @param {object} targetObject - The mesh to attach physicsHandle to
     */
    queueCollider(objectId, shape, position, rotation, collisionGroup, targetObject) {
        // Skip if already has collider or already queued
        if (this.colliderHandles.has(objectId)) return;
        if (this.pendingColliders.has(objectId)) return;

        this.pendingColliders.set(objectId, {
            objectId,
            shape,
            position: { x: position.x, y: position.y, z: position.z }, // Clone position
            rotation,
            collisionGroup,
            targetObject
        });
    }

    /**
     * Process queued colliders with frame budget (ISSUE-068)
     * Call this once per frame from the game loop
     * @returns {number} - Number of colliders created this frame
     */
    processColliderQueue() {
        if (!this.initialized || this.pendingColliders.size === 0) return 0;
        if (!frameBudget.hasTime(0.3)) return 0;

        ChunkPerfTimer.start('Physics.processColliderQueue');
        const startTime = performance.now();
        const budget = Math.min(this.COLLIDER_BATCH_BUDGET_MS, frameBudget.remaining());
        let created = 0;

        for (const [objectId, pending] of this.pendingColliders) {
            // Remove from queue first (Map iteration is safe during deletion)
            this.pendingColliders.delete(objectId);

            // Skip if collider was created by another path while queued
            if (this.colliderHandles.has(pending.objectId)) continue;

            // Create the collider
            const collider = this.createStaticCollider(
                pending.objectId,
                pending.shape,
                pending.position,
                pending.rotation,
                pending.collisionGroup
            );

            // Attach to target object if provided
            if (collider && pending.targetObject) {
                pending.targetObject.userData.physicsHandle = collider;
            }

            created++;

            // Check frame budget
            if (performance.now() - startTime > budget) {
                break;
            }
        }

        ChunkPerfTimer.end('Physics.processColliderQueue');
        return created;
    }

    /**
     * Get pending collider queue length (for debugging/UI)
     */
    getPendingColliderCount() {
        return this.pendingColliders.size;
    }

    /**
     * Create a kinematic rigid body with collider (RAW - no map registration)
     * Used by pool warmup and internal pool management
     * @private
     */
    _createKinematicBodyRaw(objectId, shape, position, rotation = 0, collisionGroup = COLLISION_GROUPS.PLAYER) {
        try {
            const rigidBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
            rigidBodyDesc.setTranslation(position.x, position.y, position.z);

            if (rotation !== 0) {
                const halfAngle = rotation / 2;
                rigidBodyDesc.setRotation({ x: 0, y: Math.sin(halfAngle), z: 0, w: Math.cos(halfAngle) });
            }

            const rigidBody = this.world.createRigidBody(rigidBodyDesc);

            let colliderDesc;
            if (shape.type === 'cylinder') {
                const halfHeight = shape.height / 2 || 0.5;
                colliderDesc = RAPIER.ColliderDesc.cylinder(halfHeight, shape.radius);
                colliderDesc.setTranslation(0, halfHeight, 0);
            } else if (shape.type === 'cuboid') {
                const halfWidth = shape.width / 2;
                const halfDepth = shape.depth / 2;
                const halfHeight = shape.height / 2 || 0.5;
                colliderDesc = RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight, halfDepth);
                colliderDesc.setTranslation(0, halfHeight, 0);
            }

            const collisionMask = this._getCollisionMask(collisionGroup);
            colliderDesc.setCollisionGroups(collisionMask);
            colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
            colliderDesc.setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED);

            const collider = this.world.createCollider(colliderDesc, rigidBody);

            return { rigidBody, collider };
        } catch (error) {
            console.error(`[PHYSICS] Failed to create raw kinematic body:`, error);
            return null;
        }
    }

    /**
     * Create a kinematic rigid body with collider (for moving entities)
     * @param {string} objectId
     * @param {object} shape
     * @param {THREE.Vector3} position
     * @param {number} rotation - Y rotation in radians (default 0)
     * @param {number} collisionGroup
     * @returns {object} - {rigidBody, collider}
     */
    createKinematicBody(objectId, shape, position, rotation = 0, collisionGroup = COLLISION_GROUPS.PLAYER) {
        if (!this.initialized) return null;

        const body = this._createKinematicBodyRaw(objectId, shape, position, rotation, collisionGroup);
        if (!body) return null;

        // Register in main maps
        this.rigidbodyHandles.set(objectId, body.rigidBody);
        this.colliderHandles.set(objectId, body.collider);
        this.colliderToObjectId.set(body.collider.handle, objectId);

        return body;
    }

    /**
     * Remove a kinematic rigid body and its collider
     * @param {string} objectId
     */
    removeKinematicBody(objectId) {
        const rigidBody = this.rigidbodyHandles.get(objectId);
        if (rigidBody) {
            this.world.removeRigidBody(rigidBody);
            this.rigidbodyHandles.delete(objectId);
        }
        const collider = this.colliderHandles.get(objectId);
        if (collider) {
            this.colliderToObjectId.delete(collider.handle);
            this.colliderHandles.delete(objectId);
        }
    }

    /**
     * Create a character controller (for player/AI movement with collision)
     * Pool-aware: checks pool first, creates new only on miss
     * @param {string} objectId
     * @param {number} radius - Capsule radius
     * @param {number} height - Capsule height
     * @param {THREE.Vector3} position
     * @returns {object} - Character controller
     */
    createCharacterController(objectId, radius = 0.3, height = 1.0, position) {
        if (!this.initialized) return null;

        const shape = { type: 'cylinder', radius, height };
        const shapeKey = this._getShapeKey(shape);
        const collisionGroup = objectId.startsWith('player') ? COLLISION_GROUPS.PLAYER :
            objectId.startsWith('peer') ? COLLISION_GROUPS.PEER :
            (objectId.startsWith('boat') || objectId.startsWith('sailboat') || objectId.startsWith('ship2')) ? COLLISION_GROUPS.BOAT :
            COLLISION_GROUPS.AI;

        // Check pool for available controller
        const pool = this.kinematicPool.get(shapeKey);
        if (pool && pool.length > 0) {
            const pooled = pool.pop();
            this.poolMetrics.kinematicHits++;

            // Reposition and enable
            pooled.rigidBody.setNextKinematicTranslation({ x: position.x, y: position.y, z: position.z });

            // Update collision group
            const collisionMask = this._getCollisionMask(collisionGroup);
            pooled.collider.setCollisionGroups(collisionMask);

            // Configure controller for character (not boat)
            pooled.controller.enableAutostep(0.3, 0.1, false);
            pooled.controller.enableSnapToGround(0.1);

            // Register in maps
            this.rigidbodyHandles.set(objectId, pooled.rigidBody);
            this.colliderHandles.set(objectId, pooled.collider);
            this.colliderToObjectId.set(pooled.collider.handle, objectId);
            this.characterControllers.set(objectId, {
                controller: pooled.controller,
                rigidBody: pooled.rigidBody,
                collider: pooled.collider,
                height: height
            });

            // Track for pool release
            this.activeKinematicControllers.set(objectId, { shapeKey });

            return pooled.controller;
        }

        // Pool miss - create new
        this.poolMetrics.kinematicMisses++;

        try {
            const body = this.createKinematicBody(objectId, shape, position, 0, collisionGroup);
            if (!body) return null;

            const controller = this.world.createCharacterController(0.01);
            controller.enableAutostep(0.3, 0.1, false);
            controller.enableSnapToGround(0.1);

            this.characterControllers.set(objectId, {
                controller,
                rigidBody: body.rigidBody,
                collider: body.collider,
                height: height
            });

            // Track for pool release
            this.activeKinematicControllers.set(objectId, { shapeKey });

            // Update high water mark
            const totalActive = this.activeKinematicControllers.size;
            if (totalActive > this.poolMetrics.highWaterMark) {
                this.poolMetrics.highWaterMark = totalActive;
            }

            return controller;
        } catch (error) {
            console.error(`[PHYSICS] Failed to create character controller for ${objectId}:`, error);
            return null;
        }
    }

    /**
     * Create a character controller for boats with cuboid collider (rotation-aware)
     * Pool-aware: checks pool first, creates new only on miss
     * @param {string} objectId
     * @param {object} shape - { type: 'cuboid', width, depth, height }
     * @param {THREE.Vector3} position
     * @param {number} rotation - Y rotation in radians
     * @returns {object} - Character controller
     */
    createBoatCharacterController(objectId, shape, position, rotation = 0) {
        if (!this.initialized) return null;

        const shapeKey = this._getShapeKey(shape);

        // Check pool for available controller
        const pool = this.kinematicPool.get(shapeKey);
        if (pool && pool.length > 0) {
            const pooled = pool.pop();
            this.poolMetrics.kinematicHits++;

            // Reposition and rotate
            pooled.rigidBody.setNextKinematicTranslation({ x: position.x, y: position.y, z: position.z });
            if (rotation !== 0) {
                const halfAngle = rotation / 2;
                pooled.rigidBody.setNextKinematicRotation({ x: 0, y: Math.sin(halfAngle), z: 0, w: Math.cos(halfAngle) });
            }

            // Update collision group to BOAT
            const collisionMask = this._getCollisionMask(COLLISION_GROUPS.BOAT);
            pooled.collider.setCollisionGroups(collisionMask);

            // Configure controller for boat (no autostep, no snap to ground)
            pooled.controller.enableAutostep(0, 0, false);
            pooled.controller.enableSnapToGround(0);

            // Register in maps
            this.rigidbodyHandles.set(objectId, pooled.rigidBody);
            this.colliderHandles.set(objectId, pooled.collider);
            this.colliderToObjectId.set(pooled.collider.handle, objectId);
            this.characterControllers.set(objectId, {
                controller: pooled.controller,
                rigidBody: pooled.rigidBody,
                collider: pooled.collider,
                height: shape.height || 1.0
            });

            // Track for pool release
            this.activeKinematicControllers.set(objectId, { shapeKey });

            return pooled.controller;
        }

        // Pool miss - create new
        this.poolMetrics.kinematicMisses++;

        try {
            const body = this.createKinematicBody(objectId, shape, position, rotation, COLLISION_GROUPS.BOAT);
            if (!body) return null;

            const controller = this.world.createCharacterController(0.01);
            controller.enableAutostep(0, 0, false);
            controller.enableSnapToGround(0);

            this.characterControllers.set(objectId, {
                controller,
                rigidBody: body.rigidBody,
                collider: body.collider,
                height: shape.height || 1.0
            });

            // Track for pool release
            this.activeKinematicControllers.set(objectId, { shapeKey });

            // Update high water mark
            const totalActive = this.activeKinematicControllers.size;
            if (totalActive > this.poolMetrics.highWaterMark) {
                this.poolMetrics.highWaterMark = totalActive;
            }

            return controller;
        } catch (error) {
            console.error(`[PHYSICS] Failed to create boat character controller for ${objectId}:`, error);
            return null;
        }
    }

    /**
     * Remove a character controller and release to pool
     * Pool-aware: moves to disabled position instead of destroying
     * @param {string} objectId
     */
    removeCharacterController(objectId) {
        const data = this.characterControllers.get(objectId);
        if (!data) return;

        // Get tracking info for pool release
        const tracking = this.activeKinematicControllers.get(objectId);

        try {
            // Unregister from main maps
            if (data.collider) {
                this.colliderToObjectId.delete(data.collider.handle);
            }
            this.colliderHandles.delete(objectId);
            this.rigidbodyHandles.delete(objectId);
            this.characterControllers.delete(objectId);
            this.activeKinematicControllers.delete(objectId);

            // Release to pool if we have tracking info
            if (tracking && data.controller && data.rigidBody && data.collider) {
                // Disable: move to far position and set collision group to NONE
                data.rigidBody.setNextKinematicTranslation({ x: 0, y: this.POOL_DISABLE_Y, z: 0 });
                data.collider.setCollisionGroups(this._getCollisionMask(COLLISION_GROUPS.NONE));

                // Add to pool
                if (!this.kinematicPool.has(tracking.shapeKey)) {
                    this.kinematicPool.set(tracking.shapeKey, []);
                }
                this.kinematicPool.get(tracking.shapeKey).push({
                    controller: data.controller,
                    rigidBody: data.rigidBody,
                    collider: data.collider,
                    objectId: null,
                    height: data.height
                });

                this.poolMetrics.kinematicReleases++;

                // Evict excess pool items to prevent unbounded growth
                const poolArray = this.kinematicPool.get(tracking.shapeKey);
                if (poolArray && poolArray.length > this.MAX_KINEMATIC_POOL_SIZE) {
                    const excess = poolArray.length - this.MAX_KINEMATIC_POOL_SIZE;
                    const toRemove = poolArray.splice(0, excess);
                    toRemove.forEach(item => {
                        if (item.collider) this.world.removeCollider(item.collider, true);
                        if (item.rigidBody) this.world.removeRigidBody(item.rigidBody);
                        if (item.controller) this.world.removeCharacterController(item.controller);
                    });
                }
            } else {
                // No tracking - actually destroy (shouldn't happen often)
                if (data.collider) {
                    this.world.removeCollider(data.collider, true);
                }
                if (data.rigidBody) {
                    this.world.removeRigidBody(data.rigidBody);
                }
                if (data.controller) {
                    this.world.removeCharacterController(data.controller);
                }
            }
        } catch (error) {
            console.error(`[PHYSICS] Failed to remove character controller for ${objectId}:`, error);
        }
    }

    /**
     * Update kinematic body position
     * @param {string} objectId
     * @param {THREE.Vector3} position
     */
    updateKinematicPosition(objectId, position) {
        const rigidBody = this.rigidbodyHandles.get(objectId);
        if (rigidBody) {
            this._tempRapierVec.x = position.x;
            this._tempRapierVec.y = position.y;
            this._tempRapierVec.z = position.z;
            rigidBody.setNextKinematicTranslation(this._tempRapierVec);
        }
    }

    /**
     * Update kinematic body rotation (Y-axis only)
     * @param {string} objectId
     * @param {number} rotationY - Y rotation in radians
     */
    updateKinematicRotation(objectId, rotationY) {
        const rigidBody = this.rigidbodyHandles.get(objectId);
        if (rigidBody) {
            // Convert Y rotation to quaternion (rotation around Y axis)
            const halfAngle = rotationY / 2;
            const sinHalf = Math.sin(halfAngle);
            const cosHalf = Math.cos(halfAngle);
            // Quaternion for Y-axis rotation: (0, sin(θ/2), 0, cos(θ/2))
            rigidBody.setNextKinematicRotation({ x: 0, y: sinHalf, z: 0, w: cosHalf });
        }
    }

    /**
     * Compute character movement with collision detection
     * @param {string} objectId
     * @param {THREE.Vector3} movement - Desired movement vector
     * @returns {object} - {correctedMovement, grounded, hasCollision, collidedWith}
     */
    computeCharacterMovement(objectId, movement) {
        const data = this.characterControllers.get(objectId);
        if (!data) {
            return { correctedMovement: movement, grounded: false, hasCollision: false, collidedWith: [] };
        }

        const { controller, collider } = data;

        // Compute collision-aware movement
        this._tempDesiredMovement.x = movement.x;
        this._tempDesiredMovement.y = movement.y;
        this._tempDesiredMovement.z = movement.z;
        controller.computeColliderMovement(
            collider,
            this._tempDesiredMovement,
            RAPIER.QueryFilterFlags.EXCLUDE_SENSORS  // Exclude sensors from movement (they're for detection only)
        );

        // Get corrected movement (reuse pre-allocated vector to avoid GC pressure)
        const corrected = controller.computedMovement();
        this._correctedMovement.set(corrected.x, corrected.y, corrected.z);
        const correctedMovement = this._correctedMovement;

        // Check if grounded
        const grounded = controller.computedGrounded();

        // Get collision objectIds using Rapier's built-in API (O(c) where c = num collisions)
        const collidedWith = [];
        const numCollisions = controller.numComputedCollisions();
        if (numCollisions > 0) {
            for (let i = 0; i < numCollisions; i++) {
                const collision = controller.computedCollision(i);
                if (collision && collision.collider) {
                    // O(1) lookup using reverse map
                    const collidedObjectId = this.colliderToObjectId.get(collision.collider.handle);
                    if (collidedObjectId) {
                        collidedWith.push(collidedObjectId);
                    }
                }
            }
        }

        // Check if there was a collision (based on actual collision count, not vector reduction)
        const hasCollision = numCollisions > 0;

        return { correctedMovement, grounded, hasCollision, collidedWith };
    }

    /**
     * Get objects in contact with character (for collision debugging)
     * @param {string} objectId - Character ID
     * @returns {Array<string>} - Array of {objectId, modelType, isSensor}
     */
    getCharacterContacts(objectId) {
        const data = this.characterControllers.get(objectId);
        if (!data || !this.world) return [];

        const contacts = [];
        const { collider } = data;

        // Iterate through all contact pairs with this character (Rapier 0.14+ API)
        this.world.contactPairsWith(collider.handle, (otherColliderHandle) => {
            // O(1) lookup using reverse map instead of O(n) linear search
            const oid = this.colliderToObjectId.get(otherColliderHandle);
            if (oid) {
                contacts.push({
                    objectId: oid,
                    isSensor: false,
                    type: 'BOUNDING_BOX'
                });
            }
        });

        return contacts;
    }

    /**
     * Get object ID from a collider handle
     * @param {object} colliderHandle - Rapier collider handle
     * @returns {string|null} - Object ID or null if not found
     */
    getObjectIdFromCollider(colliderHandle) {
        if (!colliderHandle) return null;

        // Fast O(1) lookup using reverse map
        return this.colliderToObjectId.get(colliderHandle.handle) || null;
    }


    /**
     * Check if a character is overlapping with any merchant ship or peer boat collider
     * Uses shape-based collision for accurate detection with large boats
     * Single physics query for performance - checks both types in one pass
     * @param {string} characterId - The character ID to check
     * @param {string} boatType - Type of boat ('boat', 'sailboat', 'ship2') for dimensions
     * @param {number} heading - Current heading in radians (for rotated collision query)
     * @returns {object} - { merchant: string|null, peerBoat: { colliderId, entityType, peerId }|null }
     */
    checkBoatCollisions(characterId, boatType = 'boat', heading = 0) {
        const result = { merchant: null, peerBoat: null, unoccupiedBoat: null };

        const data = this.characterControllers.get(characterId);
        if (!data || !this.initialized) return result;

        // Get boat dimensions from config
        const boatDims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[boatType];
        if (!boatDims) return result;

        const TRIGGER_BUFFER = 0.2;
        const rbPos = data.rigidBody.translation();

        // Get or create cached boat shape (avoid allocation every frame)
        let boatShape = this._merchantCollisionShapes.get(boatType);
        if (!boatShape) {
            const halfWidth = (boatDims.width / 2) + TRIGGER_BUFFER;
            const halfHeight = (boatDims.height || 1.0) / 2;
            const halfDepth = (boatDims.depth / 2) + TRIGGER_BUFFER;
            boatShape = new RAPIER.Cuboid(halfWidth, halfHeight, halfDepth);
            this._merchantCollisionShapes.set(boatType, boatShape);
        }

        const halfHeight = (boatDims.height || 1.0) / 2;

        // Reuse pre-allocated position/rotation objects
        this._queryTranslation.x = rbPos.x;
        this._queryTranslation.y = rbPos.y + halfHeight;
        this._queryTranslation.z = rbPos.z;

        // Apply heading rotation to query (Y-axis rotation)
        const halfAngle = heading / 2;
        this._queryRotation.x = 0;
        this._queryRotation.y = Math.sin(halfAngle);
        this._queryRotation.z = 0;
        this._queryRotation.w = Math.cos(halfAngle);

        this.world.intersectionsWithShape(this._queryTranslation, this._queryRotation, boatShape, (collider) => {
            const objectId = this.colliderToObjectId.get(collider.handle);
            if (!objectId) return true;

            // Skip our own collider (the character controller's kinematic body)
            if (objectId === characterId) return true;

            // Merchant ship - highest priority, stop immediately
            if (objectId.startsWith('merchant_ship_')) {
                result.merchant = objectId;
                return false; // Stop iteration - merchant collision is fatal
            }

            // Peer boat - extract type and peerId from format: peer_{type}_{peerId}
            if (objectId.startsWith('peer_boat_') ||
                objectId.startsWith('peer_sailboat_') ||
                objectId.startsWith('peer_ship2_')) {
                // Parse: peer_boat_abc123 -> type=boat, peerId=abc123
                const parts = objectId.split('_');
                if (parts.length >= 3) {
                    result.peerBoat = {
                        colliderId: objectId,
                        entityType: parts[1], // boat, sailboat, or ship2
                        peerId: parts.slice(2).join('_') // Handle peerIds with underscores
                    };
                }
                // Continue - might still find merchant ship
            }

            // Unoccupied boat - static world object (format: {type}_{timestamp}_{random})
            if (objectId.startsWith('boat_') ||
                objectId.startsWith('sailboat_') ||
                objectId.startsWith('ship2_')) {
                const entityType = objectId.split('_')[0];
                result.unoccupiedBoat = {
                    colliderId: objectId,
                    entityType: entityType
                };
                // Continue - might still find merchant ship (higher priority)
            }

            return true;
        });

        return result;
    }

    /**
     * Check if a character is overlapping with any merchant ship collider
     * @deprecated Use checkBoatCollisions() instead for combined check
     */
    checkMerchantShipCollision(characterId, boatType = 'boat') {
        const result = this.checkBoatCollisions(characterId, boatType);
        return result.merchant || false;
    }

    /**
     * Check what player boats overlap with a merchant ship collider
     * Used by ScheduledShipSystem to sink unoccupied boats in merchant's path
     * @param {string} merchantShipId - The merchant ship collider ID (e.g., 'merchant_ship_dock123')
     * @returns {Array} - Array of { objectId, entityType } for overlapping boats
     */
    checkMerchantShipOverlaps(merchantShipId) {
        const results = [];
        if (!this.initialized) return results;

        // Get the merchant ship's rigid body position
        const merchantBody = this.rigidbodyHandles.get(merchantShipId);
        if (!merchantBody) return results;

        const pos = merchantBody.translation();

        // Get merchant ship dimensions from config
        const SHIP_SCALE = 1.15; // Must match ScheduledShipSystem.createShip
        const shipDims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS.ship;
        if (!shipDims) return results;

        // Create shape for merchant ship collision check (with buffer for detection)
        const halfWidth = (shipDims.width * SHIP_SCALE / 2) + 0.3;
        const halfHeight = (shipDims.height * SHIP_SCALE / 2);
        const halfDepth = (shipDims.depth * SHIP_SCALE / 2) + 0.3;

        // Cache or create shape
        let merchantShape = this._merchantCollisionShapes.get('merchant_overlap');
        if (!merchantShape) {
            merchantShape = new RAPIER.Cuboid(halfWidth, halfHeight, halfDepth);
            this._merchantCollisionShapes.set('merchant_overlap', merchantShape);
        }

        const translation = { x: pos.x, y: pos.y + halfHeight, z: pos.z };

        // Set identity rotation for merchant ship collision check
        // (prevents using stale rotation from last checkBoatCollisions call)
        this._queryRotation.x = 0;
        this._queryRotation.y = 0;
        this._queryRotation.z = 0;
        this._queryRotation.w = 1;

        // Query for overlapping colliders
        this.world.intersectionsWithShape(translation, this._queryRotation, merchantShape, (collider) => {
            const objectId = this.colliderToObjectId.get(collider.handle);
            if (!objectId) return true;

            // Check for unoccupied player boats (format: boat_*, sailboat_*, ship2_*)
            // Skip peer boats (peer_*) - those are handled by their owners via hitMerchantShip
            if ((objectId.startsWith('boat_') ||
                 objectId.startsWith('sailboat_') ||
                 objectId.startsWith('ship2_')) &&
                !objectId.startsWith('peer_')) {
                const entityType = objectId.split('_')[0];
                results.push({ objectId, entityType });
            }

            return true; // Continue checking for more boats
        });

        return results;
    }


    /**
     * Test if a shape at position overlaps with specific object type
     * Used for placement validation (e.g., checking if boat placement overlaps dock)
     * @param {object} shape - {type: 'cuboid', width, height, depth}
     * @param {object} position - {x, y, z}
     * @param {number} rotation - Y rotation in radians
     * @param {string} filterObjectType - Object type to filter for (e.g., 'dock')
     * @returns {boolean} - True if overlapping
     */
    testShapeAtPosition(shape, position, rotation, filterObjectType) {
        if (!this.initialized) return false;

        let rapierShape;
        if (shape.type === 'cuboid') {
            rapierShape = new RAPIER.Cuboid(shape.width / 2, shape.height / 2, shape.depth / 2);
        }
        if (!rapierShape) return false;

        const translation = { x: position.x, y: position.y, z: position.z };
        const quaternion = { x: 0, y: Math.sin(rotation / 2), z: 0, w: Math.cos(rotation / 2) };

        let hasOverlap = false;
        this.world.intersectionsWithShape(translation, quaternion, rapierShape, (collider) => {
            const objectId = this.colliderToObjectId.get(collider.handle);
            if (objectId && objectId.includes(filterObjectType)) {
                hasOverlap = true;
                return false; // Stop iteration
            }
            return true;
        });

        return hasOverlap;
    }

    /**
     * Register a callback to be fired when collisions occur
     * @param {function} callback - Function(objectId1, objectId2) called on collision start
     */
    onCollisionEnter(callback) {
        if (typeof callback === 'function') {
            this.collisionCallbacks.push(callback);
        }
    }

    /**
     * Query for colliders in a sphere
     * @param {THREE.Vector3} center
     * @param {number} radius
     * @param {number} collisionMask - Which groups to query
     * @returns {Array} - Array of collider handles
     */
    querySphere(center, radius, collisionMask = 0xFFFF) {
        if (!this.initialized) return [];

        const results = [];

        // Cache Ball shapes by radius to avoid repeated allocations
        let shape = this._queryBallCache.get(radius);
        if (!shape) {
            shape = new RAPIER.Ball(radius);
            this._queryBallCache.set(radius, shape);
        }

        // Reuse pre-allocated translation vector (update in place)
        this._queryTranslation.x = center.x;
        this._queryTranslation.y = center.y;
        this._queryTranslation.z = center.z;

        // Rapier collision groups are 32-bit: (membership << 16) | filter
        // For queries: membership=0xFFFF matches any filter, filter=collisionMask matches specific memberships
        const filterGroups = (0xFFFF << 16) | collisionMask;

        // intersectionsWithShape params: pos, rot, shape, callback, filterFlags, filterGroups
        // Reuse pre-allocated identity quaternion for rotation
        this.world.intersectionsWithShape(this._queryTranslation, this._queryRotation, shape, (collider) => {
            results.push(collider);
            return true; // Continue iteration
        }, null, filterGroups);

        return results;
    }

    /**
     * Shape cast for placement validation
     * @param {object} shape - {type, radius} or {type, width, depth, height}
     * @param {THREE.Vector3} position
     * @param {number} rotation - Y rotation in radians
     * @param {number} collisionMask
     * @returns {boolean} - True if overlapping with existing colliders
     */
    testShapeOverlap(shape, position, rotation = 0, collisionMask = 0xFFFF, skipStructureType = null) {
        if (!this.initialized) return false;

        try {
            // Get or create cached shape by dimensions (avoids allocations after warmup)
            const shapeKey = shape.type === 'cylinder'
                ? `cyl_${shape.radius}_${shape.height || 1}`
                : `box_${shape.width}_${shape.height || 1}_${shape.depth}`;

            let rapierShape = this._shapeCache.get(shapeKey);
            if (!rapierShape) {
                if (shape.type === 'cylinder') {
                    rapierShape = new RAPIER.Cylinder(shape.height / 2 || 0.5, shape.radius);
                } else if (shape.type === 'cuboid') {
                    rapierShape = new RAPIER.Cuboid(
                        shape.width / 2,
                        shape.height / 2 || 0.5,
                        shape.depth / 2
                    );
                } else {
                    return false;
                }
                this._shapeCache.set(shapeKey, rapierShape);
            }

            // Reuse pre-allocated objects (updated in-place)
            this._overlapTranslation.x = position.x;
            this._overlapTranslation.y = position.y;
            this._overlapTranslation.z = position.z;

            this._threeQuaternion.setFromAxisAngle(this._upAxis, rotation);
            this._overlapQuaternion.x = this._threeQuaternion.x;
            this._overlapQuaternion.y = this._threeQuaternion.y;
            this._overlapQuaternion.z = this._threeQuaternion.z;
            this._overlapQuaternion.w = this._threeQuaternion.w;

            // Rapier collision groups are 32-bit: (membership << 16) | filter
            const filterGroups = (0xFFFF << 16) | collisionMask;

            let hasOverlap = false;
            // intersectionsWithShape params: pos, rot, shape, callback, filterFlags, filterGroups
            this.world.intersectionsWithShape(this._overlapTranslation, this._overlapQuaternion, rapierShape, (collider) => {
                // Skip sensors (non-blocking)
                if (collider.isSensor()) return true;

                // Skip colliders matching the skip type (e.g., walls when placing walls)
                if (skipStructureType) {
                    const objectId = this.colliderToObjectId.get(collider.handle);
                    if (objectId && objectId.split('_')[0] === skipStructureType) {
                        return true; // Skip this collider, continue searching
                    }
                }

                hasOverlap = true;
                return false; // Stop iteration - found blocking collision
            }, null, filterGroups);

            return hasOverlap;
        } catch (error) {
            console.error('[PHYSICS] Shape overlap test failed:', error);
            return false;
        }
    }

    /**
     * Remove collider and/or rigid body
     * Pool-aware: releases vehicle static colliders to pool instead of destroying
     * @param {string} objectId
     */
    removeCollider(objectId) {
        if (!this.initialized) return;

        // FIRST: Remove from pending queue to prevent ghost collider creation
        // (fixes race condition where colliders are created for already-disposed objects)
        this.pendingColliders.delete(objectId);

        // Remove character controller and clean up its collider reference
        const controllerData = this.characterControllers.get(objectId);
        if (controllerData) {
            // Clean up reverse lookup for character controller's collider
            if (controllerData.collider) {
                this.colliderToObjectId.delete(controllerData.collider.handle);
            }
            this.characterControllers.delete(objectId);
        }

        // Remove rigid body (which automatically removes attached colliders)
        const rigidBody = this.rigidbodyHandles.get(objectId);
        if (rigidBody) {
            this.world.removeRigidBody(rigidBody);
            this.rigidbodyHandles.delete(objectId);
        }

        // Handle standalone collider
        const collider = this.colliderHandles.get(objectId);
        if (collider && !rigidBody) {
            // Check if this is a tracked vehicle collider for pooling
            const tracking = this.activeStaticColliders.get(objectId);

            if (tracking) {
                // Release to pool instead of destroying
                // Disable: move to far position and set collision group to NONE
                collider.setTranslation({ x: 0, y: this.POOL_DISABLE_Y, z: 0 });
                collider.setCollisionGroups(this._getCollisionMask(COLLISION_GROUPS.NONE));

                // Add to pool
                if (!this.staticPool.has(tracking.shapeKey)) {
                    this.staticPool.set(tracking.shapeKey, []);
                }
                this.staticPool.get(tracking.shapeKey).push({
                    collider,
                    objectId: null,
                    collisionGroup: tracking.collisionGroup
                });

                this.poolMetrics.staticReleases++;
                this.activeStaticColliders.delete(objectId);

                // Evict excess pool items to prevent unbounded growth
                const poolArray = this.staticPool.get(tracking.shapeKey);
                if (poolArray && poolArray.length > this.MAX_STATIC_POOL_SIZE) {
                    const excess = poolArray.length - this.MAX_STATIC_POOL_SIZE;
                    const toRemove = poolArray.splice(0, excess);
                    toRemove.forEach(item => {
                        if (item.collider) this.world.removeCollider(item.collider, false);
                    });
                }
            } else {
                // Not a pooled vehicle - actually destroy
                try {
                    this.world.removeCollider(collider, false);
                } catch (e) {
                    // Collider may have already been removed by rigid body cleanup
                }
            }
        }

        // Clean up both forward and reverse lookup maps
        if (collider) {
            this.colliderToObjectId.delete(collider.handle);
        }
        this.colliderHandles.delete(objectId);

        // Notify external systems (e.g., game.js objectRegistry)
        if (this.onObjectRemoved) {
            this.onObjectRemoved(objectId);
        }
    }

    /**
     * Get collision mask for group interaction
     * @private
     */
    _getCollisionMask(collisionGroup) {
        // Define which groups collide with which
        let membershipMask = collisionGroup;
        let filterMask = 0;

        if (collisionGroup === COLLISION_GROUPS.PLAYER ||
            collisionGroup === COLLISION_GROUPS.PEER ||
            collisionGroup === COLLISION_GROUPS.AI ||
            collisionGroup === COLLISION_GROUPS.BOAT) {
            // Characters/boats collide with structures, natural objects, placed objects, sensors, and boats
            filterMask = COLLISION_GROUPS.STRUCTURE | COLLISION_GROUPS.NATURAL | COLLISION_GROUPS.PLACED | COLLISION_GROUPS.SENSOR | COLLISION_GROUPS.BOAT;
        } else {
            // Static objects collide with characters and boats
            filterMask = COLLISION_GROUPS.PLAYER | COLLISION_GROUPS.PEER | COLLISION_GROUPS.AI | COLLISION_GROUPS.BOAT;
        }

        // Rapier uses 32-bit collision groups: [membership:16][filter:16]
        return (membershipMask << 16) | filterMask;
    }

    /**
     * Toggle debug visualization
     */
    toggleDebug() {
        this.debugEnabled = !this.debugEnabled;

        if (!this.debugEnabled && this.debugLines) {
            this.scene.remove(this.debugLines);
            this.debugLines = null;
        }

        return this.debugEnabled;
    }

    /**
     * Get current physics stats for performance monitoring
     */
    getStats() {
        return {
            characterControllers: this.characterControllers.size,
            rigidBodies: this.rigidbodyHandles.size,
            colliders: this.colliderHandles.size,
            totalPhysicsObjects: this.rigidbodyHandles.size + this.characterControllers.size,
            debugEnabled: this.debugEnabled,
            pool: this.getPoolMetrics()
        };
    }

    /**
     * Get pool metrics for monitoring
     * @returns {object} Pool statistics
     */
    getPoolMetrics() {
        // Count items in pools
        let kinematicPoolSize = 0;
        for (const [, pool] of this.kinematicPool) {
            kinematicPoolSize += pool.length;
        }

        let staticPoolSize = 0;
        for (const [, pool] of this.staticPool) {
            staticPoolSize += pool.length;
        }

        const kinematicTotal = this.poolMetrics.kinematicHits + this.poolMetrics.kinematicMisses;
        const kinematicHitRate = kinematicTotal > 0 ? (this.poolMetrics.kinematicHits / kinematicTotal * 100).toFixed(1) : 0;

        const staticTotal = this.poolMetrics.staticHits + this.poolMetrics.staticMisses;
        const staticHitRate = staticTotal > 0 ? (this.poolMetrics.staticHits / staticTotal * 100).toFixed(1) : 0;

        const totalHits = this.poolMetrics.kinematicHits + this.poolMetrics.staticHits;
        const totalMisses = this.poolMetrics.kinematicMisses + this.poolMetrics.staticMisses;
        const totalRequests = totalHits + totalMisses;
        const overallHitRate = totalRequests > 0 ? (totalHits / totalRequests * 100).toFixed(1) : 0;

        return {
            // Kinematic (character controllers)
            kinematicHits: this.poolMetrics.kinematicHits,
            kinematicMisses: this.poolMetrics.kinematicMisses,
            kinematicReleases: this.poolMetrics.kinematicReleases,
            kinematicPoolSize: kinematicPoolSize,
            activeKinematic: this.activeKinematicControllers.size,
            kinematicHitRate: kinematicHitRate,
            // Static (vehicle colliders)
            staticHits: this.poolMetrics.staticHits,
            staticMisses: this.poolMetrics.staticMisses,
            staticReleases: this.poolMetrics.staticReleases,
            staticPoolSize: staticPoolSize,
            activeStatic: this.activeStaticColliders.size,
            staticHitRate: staticHitRate,
            // Overall
            highWaterMark: this.poolMetrics.highWaterMark,
            overallHitRate: overallHitRate
        };
    }

    /**
     * Get pool metrics (for debugging - call from console)
     */
    logPoolMetrics() {
        return this.getPoolMetrics();
    }

    /**
     * Render debug visualization
     */
    renderDebug() {
        if (!this.debugEnabled || !this.initialized) return;

        // Throttle to every 3rd frame (20 FPS instead of 60 FPS) to reduce GPU load
        this.debugFrameCounter = (this.debugFrameCounter || 0) + 1;
        if (this.debugFrameCounter % 3 !== 0) return;

        // Remove old debug lines and properly dispose resources
        if (this.debugLines) {
            this.scene.remove(this.debugLines);
            this.debugLines.geometry.dispose();  // Fix memory leak
            this.debugLines.material.dispose();  // Fix memory leak
            this.debugLines = null;
        }

        // Get debug render from Rapier
        const buffers = this.world.debugRender();

        // Create line segments from buffer
        const vertices = new Float32Array(buffers.vertices);
        const colors = new Float32Array(buffers.colors);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));

        const material = new THREE.LineBasicMaterial({
            vertexColors: true,
            linewidth: 2
        });

        this.debugLines = new THREE.LineSegments(geometry, material);
        this.scene.add(this.debugLines);
    }

    /**
     * Debug: List all colliders near a position
     * Call from browser console: game.physicsManager.listCollidersNear(-4784, 476, 15)
     */
    listCollidersNear(x, z, radius = 10) {
        if (!this.initialized) {
            return [];
        }

        const results = [];
        for (const [objectId, collider] of this.colliderHandles) {
            const pos = collider.translation();
            const dx = pos.x - x;
            const dz = pos.z - z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist <= radius) {
                // Get collider shape info
                const shape = collider.shape;
                let shapeInfo = 'unknown';
                if (shape.type === RAPIER.ShapeType.Cuboid) {
                    const he = shape.halfExtents;
                    shapeInfo = `cuboid(${(he.x*2).toFixed(1)}x${(he.y*2).toFixed(1)}x${(he.z*2).toFixed(1)})`;
                } else if (shape.type === RAPIER.ShapeType.Cylinder) {
                    shapeInfo = `cylinder(r=${shape.radius.toFixed(2)}, h=${(shape.halfHeight*2).toFixed(1)})`;
                }

                results.push({
                    objectId,
                    position: { x: pos.x.toFixed(1), y: pos.y.toFixed(1), z: pos.z.toFixed(1) },
                    distance: dist.toFixed(1),
                    shape: shapeInfo
                });
            }
        }

        results.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));
        console.table(results);
        return results;
    }

    /**
     * Cleanup physics world
     */
    dispose() {
        if (this.world) {
            // Clear all handles
            this.colliderHandles.clear();
            this.rigidbodyHandles.clear();
            this.characterControllers.clear();

            // Free physics world
            this.world.free();
            this.world = null;
        }

        if (this.debugLines) {
            this.scene.remove(this.debugLines);
            this.debugLines = null;
        }

        this.initialized = false;
    }
}

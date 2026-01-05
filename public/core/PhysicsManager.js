/**
 * PhysicsManager.js
 * Wrapper for Rapier physics engine - handles collision detection and spatial queries
 */

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config.js';

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

        // Collider batching queue (ISSUE-068)
        this.pendingColliders = [];
        this.COLLIDER_BATCH_BUDGET_MS = 5; // Max ms per frame for collider creation

        // Pre-allocated vectors for hot path methods - reused every frame
        // Using plain JS objects (Rapier accepts any object with x/y/z fields)
        this._tempRapierVec = { x: 0, y: 0, z: 0 };
        this._tempDesiredMovement = { x: 0, y: 0, z: 0 };
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
     * @param {string} objectId - Unique object identifier
     * @param {object} shape - {type: 'cylinder'|'cuboid', ...params}
     * @param {THREE.Vector3} position
     * @param {number} rotation - Y rotation in radians
     * @param {number} collisionGroup - Bit mask for collision filtering
     * @returns {object} - Collider handle
     */
    createStaticCollider(objectId, shape, position, rotation = 0, collisionGroup = COLLISION_GROUPS.STRUCTURE) {
        if (!this.initialized) return null;

        // Check for existing collider with same objectId (prevent duplicates)
        if (this.colliderHandles.has(objectId)) {
            console.warn(`[PHYSICS] Collider already exists for ${objectId}, skipping duplicate`);
            return this.colliderHandles.get(objectId);
        }

        try {
            // Create collider descriptor
            let colliderDesc;

            if (shape.type === 'cylinder') {
                // Cylinder for trees/rocks
                const halfHeight = shape.height / 2 || 0.5;
                colliderDesc = RAPIER.ColliderDesc.cylinder(halfHeight, shape.radius);
            } else if (shape.type === 'cuboid') {
                // Cuboid for structures/logs
                const halfWidth = shape.width / 2;
                const halfDepth = shape.depth / 2;
                // For structures (not docks), extend collider downward to handle hillsides
                const isStructureCollider = collisionGroup === COLLISION_GROUPS.STRUCTURE && !objectId.includes('dock');
                const extensionAmount = isStructureCollider ? FOUNDATION_EXTENSION : 0;
                const halfHeight = (shape.height + extensionAmount) / 2 || 0.5;
                colliderDesc = RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight, halfDepth);
            } else {
                console.error(`[PHYSICS] Unknown shape type: ${shape.type}`);
                return null;
            }

            // Set collision groups
            colliderDesc.setCollisionGroups(this._getCollisionMask(collisionGroup));

            // Make docks sensors (detect overlap, don't block movement)
            if (objectId.includes('dock')) {
                colliderDesc.setSensor(true);
            }

            // Set position and rotation
            // For cuboids, offset upward so bottom is at ground level (not centered)
            // For structures, also shift down so collider extends below placement (for hillsides)
            let colliderY = position.y;
            if (shape.type === 'cuboid') {
                const isStructureCollider = collisionGroup === COLLISION_GROUPS.STRUCTURE && !objectId.includes('dock');
                const extensionAmount = isStructureCollider ? FOUNDATION_EXTENSION : 0;
                const originalHalfHeight = shape.height / 2 || 0.5;
                // Center position: original center minus half extension to extend downward only
                // Result: bottom at position.y - extensionAmount, top at position.y + originalHeight
                colliderY += originalHalfHeight - extensionAmount / 2;
            }
            // For docks, use custom offset (overrides the cuboid offset)
            if (objectId.includes('dock')) {
                const offset = CONFIG.CONSTRUCTION.STRUCTURE_PROPERTIES.dock.physicsOffset;
                colliderY = position.y + offset;  // offset is negative, so this lowers it
            }

            const translation = new RAPIER.Vector3(position.x, colliderY, position.z);
            const quaternion = new THREE.Quaternion();
            quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
            const rapierRotation = new RAPIER.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

            colliderDesc.setTranslation(translation.x, translation.y, translation.z);
            colliderDesc.setRotation(rapierRotation);

            // Create collider
            const collider = this.world.createCollider(colliderDesc);

            // Store handle for cleanup
            this.colliderHandles.set(objectId, collider);
            // Store reverse lookup for O(1) performance (handle -> objectId)
            this.colliderToObjectId.set(collider.handle, objectId);

            // Debug: Log bounding box creation (DISABLED FOR PERFORMANCE)
            // if (shape.type === 'cuboid') {
            //     console.log(`[PHYSICS] Created BOUNDING_BOX (cuboid): ${objectId.split('_')[0]} - ${shape.width}×${shape.height}×${shape.depth} at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`);
            // } else if (shape.type === 'cylinder') {
            //     console.log(`[PHYSICS] Created BOUNDING_BOX (cylinder): ${objectId.split('_')[0]} - radius:${shape.radius} height:${shape.height} at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`);
            // }

            return collider;
        } catch (error) {
            console.error(`[PHYSICS] Failed to create static collider for ${objectId}:`, error);
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
        if (this.pendingColliders.some(p => p.objectId === objectId)) return;

        this.pendingColliders.push({
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
        if (!this.initialized || this.pendingColliders.length === 0) return 0;

        const startTime = performance.now();
        let created = 0;

        while (this.pendingColliders.length > 0) {
            const pending = this.pendingColliders.shift();

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
            if (performance.now() - startTime > this.COLLIDER_BATCH_BUDGET_MS) {
                break;
            }
        }

        return created;
    }

    /**
     * Get pending collider queue length (for debugging/UI)
     */
    getPendingColliderCount() {
        return this.pendingColliders.length;
    }

    /**
     * Create a kinematic rigid body with collider (for moving entities)
     * @param {string} objectId
     * @param {object} shape
     * @param {THREE.Vector3} position
     * @param {number} collisionGroup
     * @returns {object} - {rigidBody, collider}
     */
    createKinematicBody(objectId, shape, position, collisionGroup = COLLISION_GROUPS.PLAYER) {
        if (!this.initialized) return null;

        try {
            // Create rigid body (kinematic - controlled by game logic)
            const rigidBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
            rigidBodyDesc.setTranslation(position.x, position.y, position.z);
            const rigidBody = this.world.createRigidBody(rigidBodyDesc);

            // Create collider attached to rigid body
            let colliderDesc;
            if (shape.type === 'cylinder') {
                const halfHeight = shape.height / 2 || 0.5;
                colliderDesc = RAPIER.ColliderDesc.cylinder(halfHeight, shape.radius);
                // Offset cylinder upward so bottom is at rigid body position (feet level)
                colliderDesc.setTranslation(0, halfHeight, 0);
            } else if (shape.type === 'cuboid') {
                const halfWidth = shape.width / 2;
                const halfDepth = shape.depth / 2;
                const halfHeight = shape.height / 2 || 0.5;
                colliderDesc = RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight, halfDepth);
            }

            const collisionMask = this._getCollisionMask(collisionGroup);
            colliderDesc.setCollisionGroups(collisionMask);

            // Enable collision events for kinematic bodies (required for sensor detection)
            colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

            // Enable collision detection with static/fixed colliders (sensors)
            colliderDesc.setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED);

            const collider = this.world.createCollider(colliderDesc, rigidBody);

            // Store handles
            this.rigidbodyHandles.set(objectId, rigidBody);
            this.colliderHandles.set(objectId, collider);

            return { rigidBody, collider };
        } catch (error) {
            console.error(`[PHYSICS] Failed to create kinematic body for ${objectId}:`, error);
            return null;
        }
    }

    /**
     * Create a character controller (for player/AI movement with collision)
     * @param {string} objectId
     * @param {number} radius - Capsule radius
     * @param {number} height - Capsule height
     * @param {THREE.Vector3} position
     * @returns {object} - Character controller
     */
    createCharacterController(objectId, radius = 0.3, height = 1.0, position) {
        if (!this.initialized) return null;

        try {
            // Create kinematic rigid body for character
            const body = this.createKinematicBody(
                objectId,
                { type: 'cylinder', radius, height },
                position,
                objectId.startsWith('player') ? COLLISION_GROUPS.PLAYER :
                objectId.startsWith('peer') ? COLLISION_GROUPS.PEER :
                COLLISION_GROUPS.AI
            );

            if (!body) return null;

            // Create character controller
            const controller = this.world.createCharacterController(0.01); // 0.01 offset
            controller.enableAutostep(0.3, 0.1, false); // maxStepHeight, minWidth, includeDynamicBodies
            controller.enableSnapToGround(0.1); // distance

            // Store controller with shape info for position updates
            this.characterControllers.set(objectId, {
                controller,
                rigidBody: body.rigidBody,
                collider: body.collider,
                height: height  // Store height for Y offset calculations
            });

            return controller;
        } catch (error) {
            console.error(`[PHYSICS] Failed to create character controller for ${objectId}:`, error);
            return null;
        }
    }

    /**
     * Remove a character controller and its associated physics objects
     * @param {string} objectId
     */
    removeCharacterController(objectId) {
        const data = this.characterControllers.get(objectId);
        if (!data) return;

        try {
            // Remove collider first
            if (data.collider) {
                this.colliderToObjectId.delete(data.collider.handle);
                this.world.removeCollider(data.collider, true);
            }
            // Remove rigid body
            if (data.rigidBody) {
                this.rigidbodyHandles.delete(objectId);
                this.world.removeRigidBody(data.rigidBody);
            }
            // Remove character controller
            if (data.controller) {
                this.world.removeCharacterController(data.controller);
            }
            // Clean up map
            this.characterControllers.delete(objectId);
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

        // Get corrected movement
        const corrected = controller.computedMovement();
        const correctedMovement = new THREE.Vector3(corrected.x, corrected.y, corrected.z);

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
     * Check if a position is inside any dock sensor
     * @param {THREE.Vector3} position - Position to check
     * @returns {string|null} - Dock objectId if inside a dock, null otherwise
     */
    isInsideDock(position) {
        if (!this.initialized || !this.world) return null;

        // Reuse pre-allocated vector (safe - this function and querySphere are never concurrent)
        this._queryTranslation.x = position.x;
        this._queryTranslation.y = position.y;
        this._queryTranslation.z = position.z;
        let foundDock = null;

        // Query all colliders that contain this point
        this.world.intersectionsWithPoint(this._queryTranslation, (collider) => {
            const objectId = this.colliderToObjectId.get(collider.handle);
            if (objectId && objectId.includes('dock')) {
                foundDock = objectId;
                return false; // Stop iteration
            }
            return true; // Continue iteration
        });

        return foundDock;
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
    testShapeOverlap(shape, position, rotation = 0, collisionMask = 0xFFFF) {
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
                // Check if this is a sensor
                const isSensor = collider.isSensor();

                // Only count non-sensors as blocking
                if (!isSensor) {
                    hasOverlap = true;
                    return false; // Stop iteration once we find a blocking collision
                }

                return true; // Continue iteration
            }, null, filterGroups);

            return hasOverlap;
        } catch (error) {
            console.error('[PHYSICS] Shape overlap test failed:', error);
            return false;
        }
    }

    /**
     * Remove collider and/or rigid body
     * @param {string} objectId
     */
    removeCollider(objectId) {
        if (!this.initialized) return;

        // Remove character controller
        const controllerData = this.characterControllers.get(objectId);
        if (controllerData) {
            // Rapier character controllers don't need explicit removal
            this.characterControllers.delete(objectId);
        }

        // Remove rigid body (which automatically removes attached colliders)
        const rigidBody = this.rigidbodyHandles.get(objectId);
        if (rigidBody) {
            this.world.removeRigidBody(rigidBody);
            this.rigidbodyHandles.delete(objectId);
        }

        // Remove standalone collider
        const collider = this.colliderHandles.get(objectId);
        if (collider && !rigidBody) {
            this.world.removeCollider(collider, false);
        }
        // Clean up both forward and reverse lookup maps
        if (collider) {
            this.colliderToObjectId.delete(collider.handle);
        }
        this.colliderHandles.delete(objectId);

        // Remove from pending colliders queue (fixes race condition where colliders
        // are created for already-disposed objects during chunk unloading)
        const pendingIndex = this.pendingColliders.findIndex(p => p.objectId === objectId);
        if (pendingIndex !== -1) {
            this.pendingColliders.splice(pendingIndex, 1);
        }

        // Notify external systems (e.g., game.js objectRegistry)
        if (this.onObjectRemoved) {
            this.onObjectRemoved(objectId);
        }

        // console.log(`[PHYSICS] Removed collider for ${objectId}`); // Disabled - too noisy
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
            collisionGroup === COLLISION_GROUPS.AI) {
            // Characters collide with structures, natural objects, and placed objects
            // Include SENSOR in filter so sensors can detect characters (sensors don't block movement)
            filterMask = COLLISION_GROUPS.STRUCTURE | COLLISION_GROUPS.NATURAL | COLLISION_GROUPS.PLACED | COLLISION_GROUPS.SENSOR;
        } else {
            // Static objects collide with characters
            filterMask = COLLISION_GROUPS.PLAYER | COLLISION_GROUPS.PEER | COLLISION_GROUPS.AI;
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
            debugEnabled: this.debugEnabled
        };
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

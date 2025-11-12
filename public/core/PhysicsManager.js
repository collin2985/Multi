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

        this.world.step();
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
                const halfHeight = shape.height / 2 || 0.5;
                colliderDesc = RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight, halfDepth);
            } else {
                console.error(`[PHYSICS] Unknown shape type: ${shape.type}`);
                return null;
            }

            // Set collision groups
            colliderDesc.setCollisionGroups(this._getCollisionMask(collisionGroup));

            // Set position and rotation
            const translation = new RAPIER.Vector3(position.x, position.y, position.z);
            const quaternion = new THREE.Quaternion();
            quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
            const rapierRotation = new RAPIER.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

            colliderDesc.setTranslation(translation.x, translation.y, translation.z);
            colliderDesc.setRotation(rapierRotation);

            // Create collider
            const collider = this.world.createCollider(colliderDesc);

            // Store handle for cleanup
            this.colliderHandles.set(objectId, collider);

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

            // Store controller
            this.characterControllers.set(objectId, {
                controller,
                rigidBody: body.rigidBody,
                collider: body.collider
            });

            return controller;
        } catch (error) {
            console.error(`[PHYSICS] Failed to create character controller for ${objectId}:`, error);
            return null;
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
            rigidBody.setNextKinematicTranslation(
                new RAPIER.Vector3(position.x, position.y, position.z)
            );
        }
    }

    /**
     * Compute character movement with collision detection
     * @param {string} objectId
     * @param {THREE.Vector3} movement - Desired movement vector
     * @returns {object} - {correctedMovement, grounded, hasCollision}
     */
    computeCharacterMovement(objectId, movement) {
        const data = this.characterControllers.get(objectId);
        if (!data) {
            return { correctedMovement: movement, grounded: false, hasCollision: false };
        }

        const { controller, collider } = data;

        // Compute collision-aware movement
        const desiredMovement = new RAPIER.Vector3(movement.x, movement.y, movement.z);
        controller.computeColliderMovement(
            collider,
            desiredMovement,
            RAPIER.QueryFilterFlags.EXCLUDE_SENSORS  // Exclude sensors from movement (they're for detection only)
        );

        // Get corrected movement
        const corrected = controller.computedMovement();
        const correctedMovement = new THREE.Vector3(corrected.x, corrected.y, corrected.z);

        // Check if grounded
        const grounded = controller.computedGrounded();

        // Check if there was a collision
        const hasCollision = Math.abs(correctedMovement.length() - movement.length()) > 0.001;

        // Collision detection logging (disabled - only enable for debugging)
        // const desiredLen = movement.length();
        // const correctedLen = correctedMovement.length();
        // if (desiredLen > 0) {
        //     console.log('[PHYSICS] Desired:', desiredLen.toFixed(4), 'Corrected:', correctedLen.toFixed(4),
        //                'Diff:', (desiredLen - correctedLen).toFixed(4), 'HasCollision:', hasCollision);
        // }

        return { correctedMovement, grounded, hasCollision };
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
            // Find what object this collider belongs to
            for (const [oid, handle] of this.colliderHandles) {
                if (handle.handle === otherColliderHandle) {
                    contacts.push({
                        objectId: oid,
                        isSensor: false,
                        type: 'BOUNDING_BOX'
                    });
                    break;
                }
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

        // Search through all collider handles to find matching objectId
        for (const [objectId, handle] of this.colliderHandles) {
            if (handle.handle === colliderHandle.handle) {
                return objectId;
            }
        }

        return null;
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
        const shape = new RAPIER.Ball(radius);
        const translation = new RAPIER.Vector3(center.x, center.y, center.z);
        const rotation = new RAPIER.Quaternion(0, 0, 0, 1);

        this.world.intersectionsWithShape(translation, rotation, shape, (collider) => {
            results.push(collider);
            return true; // Continue iteration
        }, collisionMask);

        return results;
    }

    /**
     * Ray cast from origin in direction
     * @param {THREE.Vector3} origin
     * @param {THREE.Vector3} direction
     * @param {number} maxDistance
     * @param {number} collisionMask
     * @returns {object|null} - {point, normal, collider, distance}
     */
    raycast(origin, direction, maxDistance = 100.0, collisionMask = 0xFFFF) {
        if (!this.initialized) return null;

        const ray = new RAPIER.Ray(
            new RAPIER.Vector3(origin.x, origin.y, origin.z),
            new RAPIER.Vector3(direction.x, direction.y, direction.z)
        );

        const hit = this.world.castRay(ray, maxDistance, false, collisionMask);

        if (hit) {
            const point = ray.pointAt(hit.toi);
            return {
                point: new THREE.Vector3(point.x, point.y, point.z),
                normal: hit.normal ? new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z) : null,
                collider: this.world.getCollider(hit.collider),
                distance: hit.toi
            };
        }

        return null;
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
            let rapierShape;
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

            const translation = new RAPIER.Vector3(position.x, position.y, position.z);
            const quaternion = new THREE.Quaternion();
            quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
            const rapierRotation = new RAPIER.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

            let hasOverlap = false;
            this.world.intersectionsWithShape(translation, rapierRotation, rapierShape, (collider) => {
                // Check if this is a sensor
                const isSensor = collider.isSensor();

                // Only count non-sensors as blocking
                if (!isSensor) {
                    hasOverlap = true;
                    return false; // Stop iteration once we find a blocking collision
                }

                return true; // Continue iteration
            }, collisionMask);

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
        this.colliderHandles.delete(objectId);

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

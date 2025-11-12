/**
 * StructureManager.js
 * Manages building structures - placement validation, collision detection, and structure bounds
 */

import * as THREE from 'three';
import { CONFIG as TERRAIN_CONFIG } from '../terrain.js';
import { CONFIG } from '../config.js';
import { COLLISION_GROUPS } from '../core/PhysicsManager.js';

export class StructureManager {
    constructor(scene, terrainRenderer, physicsManager = null) {
        this.scene = scene;
        this.terrainRenderer = terrainRenderer;
        this.physicsManager = physicsManager;
    }

    /**
     * Set physics manager reference for collision detection
     * @param {PhysicsManager} physicsManager
     */
    setPhysicsManager(physicsManager) {
        this.physicsManager = physicsManager;
    }

    /**
     * Get grid-aligned dimensions for a structure type
     * @param {string} structureType - Type of structure
     * @param {number} rotationDegrees - Rotation in degrees
     * @returns {object} - {width, depth} or {radius} for circular structures
     */
    getGridDimensions(structureType, rotationDegrees = 0) {
        const gridDims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[structureType];

        if (!gridDims) {
            console.warn(`No grid dimensions defined for ${structureType}, using default 1x1`);
            return { width: 1.0, depth: 1.0 };
        }

        // For circular structures (trees, rocks), return radius
        if (gridDims.radius !== undefined) {
            return { radius: gridDims.radius };
        }

        // For rectangular structures, swap width/depth at 90° and 270° rotations
        const normalizedRotation = ((rotationDegrees % 360) + 360) % 360;
        const isRotated90 = (normalizedRotation > 45 && normalizedRotation < 135) ||
                           (normalizedRotation > 225 && normalizedRotation < 315);

        if (isRotated90) {
            return { width: gridDims.depth, depth: gridDims.width };
        }

        return { width: gridDims.width, depth: gridDims.depth };
    }

    /**
     * Update structure preview during placement
     * @param {number} mouseX - Mouse X in world coordinates
     * @param {number} mouseZ - Mouse Z in world coordinates
     * @param {number} mouseY - Mouse Y in screen coordinates
     * @param {object} placementState - Structure placement state from game state
     * @param {object} ui - UI instance for status updates
     */
    updateStructurePreview(mouseX, mouseZ, mouseY, placementState, ui) {
        if (!placementState.active) return;

        const placement = placementState;
        const previewBox = placement.previewBox;

        // Safety check: if previewBox doesn't exist (model failed to load), abort
        if (!previewBox) {
            console.warn('Preview box not available, cannot update preview');
            return;
        }

        if (placement.phase === 'position') {
            const structure = placement.structure;

            // Different snapping for different structure types
            if (structure && structure.type === 'dock') {
                // Dock snaps to 0.25 grid
                placement.position.x = Math.round(mouseX / 0.25) * 0.25;
                placement.position.z = Math.round(mouseZ / 0.25) * 0.25;
            } else {
                // Regular structures snap to 0.25 grid
                placement.position.x = Math.round(mouseX / 0.25) * 0.25;
                placement.position.z = Math.round(mouseZ / 0.25) * 0.25;
            }

            let previewY;

            // Water structures snap to water surface
            if (structure && structure.requiresWater) {
                // Ships snap to water surface (y = 1.02)
                const terrainHeight = this.terrainRenderer.heightCalculator.calculateHeight(placement.position.x, placement.position.z);
                previewY = this.terrainRenderer.waterRenderer.waterLevel; // Use actual water level (1.02)
                placement.position.y = previewY;
            } else {
                // Calculate average height from 4 corners for terrain placement
                // Use actual structure dimensions for corner sampling
                const dims = this.getGridDimensions(structure.type, placement.rotation || 0);
                const halfWidth = dims.width / 2;
                const halfDepth = dims.depth / 2;

                const corner1 = this.terrainRenderer.heightCalculator.calculateHeight(placement.position.x - halfWidth, placement.position.z - halfDepth);
                const corner2 = this.terrainRenderer.heightCalculator.calculateHeight(placement.position.x + halfWidth, placement.position.z - halfDepth);
                const corner3 = this.terrainRenderer.heightCalculator.calculateHeight(placement.position.x - halfWidth, placement.position.z + halfDepth);
                const corner4 = this.terrainRenderer.heightCalculator.calculateHeight(placement.position.x + halfWidth, placement.position.z + halfDepth);
                const averageHeight = (corner1 + corner2 + corner3 + corner4) / 4;

                // Snap to 0.25 grid - round UP to nearest 0.25 increment
                let snappedHeight = Math.ceil(averageHeight / 0.25) * 0.25;

                // Water-level protection
                if (snappedHeight < 1.02) {
                    // Below water level - default to 1.5
                    snappedHeight = 1.5;
                }
                // Note: validation will block placement if < -0.5

                // Foundation is placed at calculated height (no manual adjustment)
                previewY = snappedHeight;
                placement.position.y = snappedHeight;
            }

            previewBox.position.set(placement.position.x, previewY, placement.position.z);
            previewBox.visible = true;

            // Update preview collision bounds position
            if (placement.previewBounds) {
                placement.previewBounds.updatePosition(placement.position.x, placement.position.z);
            }

            // Validate placement (caller should call validateStructurePlacement separately)

        } else if (placement.phase === 'rotation') {
            // Rotation phase - rotation is controlled by buttons/keyboard
            // The placement.rotation value is set externally by RotationControls
            // We just need to apply it to the preview

            previewBox.rotation.y = placement.rotation * (Math.PI / 180);

            // Update preview collision bounds rotation
            if (placement.previewBounds) {
                const rotationRad = placement.rotation * (Math.PI / 180);
                placement.previewBounds.updateRotation(rotationRad);
            }
        }

        // Update glow outline color based on validation state
        this.updateStructurePreviewColors(placement, ui);
    }

    /**
     * Update preview glow colors based on validation state
     * @param {object} placement - Structure placement state
     * @param {object} ui - UI instance for status updates
     */
    updateStructurePreviewColors(placement, ui) {
        if (!placement.previewBox) return;

        const glowOutline = placement.previewBox.userData.glowOutline;

        // During position phase, always show neutral white glow (no validation feedback yet)
        if (placement.phase === 'position') {
            glowOutline.traverse((child) => {
                if (child instanceof THREE.Mesh && child.material) {
                    child.material.color.setHex(0xffffff);
                }
            });
            ui.updateStatusLine2('', 0); // Clear status during position selection
            return; // Exit early - don't show green/red during position phase
        }

        // Rotation phase - show validation colors (green/red)
        if (placement.validationPending) {
            // White glow for pending validation (during rotation adjustment)
            glowOutline.traverse((child) => {
                if (child instanceof THREE.Mesh && child.material) {
                    child.material.color.setHex(0xffffff);
                }
            });
        } else if (placement.isValid) {
            // Green glow for valid placement
            glowOutline.traverse((child) => {
                if (child instanceof THREE.Mesh && child.material) {
                    child.material.color.setHex(0x00ff00);
                }
            });
            ui.updateStatusLine2('Valid location', 0);
        } else {
            // Red glow for invalid placement
            glowOutline.traverse((child) => {
                if (child instanceof THREE.Mesh && child.material) {
                    child.material.color.setHex(0xff0000);
                }
            });
            // Show tooltip with reason
            ui.updateStatusLine2(placement.invalidReason, 0);
        }
    }

    /**
     * Validate structure placement
     * @param {object} placementState - Structure placement state
     * @param {string} phase - Current placement phase ('position', 'rotation', 'height')
     * @param {object} playerPosition - Player position {x, y, z}
     * @returns {object} - {isValid, invalidReason}
     */
    validateStructurePlacement(placementState, phase = null, playerPosition = null) {
        const placement = placementState;
        const pos = placement.position;
        const structure = placement.structure;


        // Special validation for water-based structures (like ships)
        if (structure && structure.requiresWater) {
            return this.validateWaterPlacement(pos);
        }

        // Regular structure validation
        // Check 1: Height validation (block if too far below zero)
        if (pos.y < -0.5) {
            return {
                isValid: false,
                invalidReason: 'Terrain too low'
            };
        }

        // Check 2: Terrain slope
        const normal = this.terrainRenderer.heightCalculator.calculateNormal(pos.x, pos.z);
        const slope = Math.acos(normal.y) * (180 / Math.PI); // Convert to degrees

        if (slope > 50) {
            return {
                isValid: false,
                invalidReason: 'Slope too steep'
            };
        }

        // Check 3: Physics collision detection (if available)
        if (this.physicsManager && this.physicsManager.initialized && structure) {
            const structureType = structure.type;
            const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[structureType];

            if (dims) {
                let shape;
                // Determine shape based on dimensions
                if (dims.radius !== undefined) {
                    shape = {
                        type: 'cylinder',
                        radius: dims.radius,
                        height: dims.height || 1.0
                    };
                } else {
                    shape = {
                        type: 'cuboid',
                        width: dims.width,
                        depth: dims.depth,
                        height: dims.height || 1.0
                    };
                }

                // Get rotation from placement state
                const rotation = (placement.rotation || 0) * (Math.PI / 180);

                // Test for overlap with existing colliders (exclude player/peer/AI)
                const collisionMask = COLLISION_GROUPS.STRUCTURE | COLLISION_GROUPS.NATURAL | COLLISION_GROUPS.PLACED;
                const hasOverlap = this.physicsManager.testShapeOverlap(
                    shape,
                    pos,
                    rotation,
                    collisionMask
                );

                if (hasOverlap) {
                    return {
                        isValid: false,
                        invalidReason: 'Blocked by objects'
                    };
                }
            }
        }

        // All checks passed
        return {
            isValid: true,
            invalidReason: ''
        };
    }

    /**
     * Validate water placement for ships
     * @param {object} pos - Position {x, y, z}
     * @returns {object} - {isValid, invalidReason}
     */
    validateWaterPlacement(pos) {
        const terrainHeight = this.terrainRenderer.heightCalculator.calculateHeight(pos.x, pos.z);

        if (terrainHeight >= 0) {
            return {
                isValid: false,
                invalidReason: 'Must be placed in water (height < 0)'
            };
        }

        // Check for nearby objects
        const nearbyObjects = this.findObjectsNearPoint(pos.x, pos.z, 2);
        if (nearbyObjects.length > 0) {
            return {
                isValid: false,
                invalidReason: 'Too close to objects'
            };
        }

        return {
            isValid: true,
            invalidReason: ''
        };
    }


    /**
     * Find objects near a point (for water placement validation)
     * @param {number} x - X coordinate
     * @param {number} z - Z coordinate
     * @param {number} radius - Search radius
     * @returns {Array} Array of nearby objects
     */
    findObjectsNearPoint(x, z, radius) {
        const nearbyObjects = [];
        this.scene.traverse((object) => {
            if (object.userData && object.userData.objectId) {
                const dx = object.position.x - x;
                const dz = object.position.z - z;
                const distance = Math.sqrt(dx * dx + dz * dz);
                if (distance <= radius) {
                    nearbyObjects.push(object);
                }
            }
        });
        return nearbyObjects;
    }

}

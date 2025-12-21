/**
 * StructureManager.js
 * Manages building structures - placement validation, collision detection, and structure bounds
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { COLLISION_GROUPS } from '../core/PhysicsManager.js';

export class StructureManager {
    constructor(scene, terrainGenerator, physicsManager = null) {
        this.scene = scene;
        this.terrainGenerator = terrainGenerator;
        this.physicsManager = physicsManager;

        // Dock placement cache for performance
        this.dockCache = {
            lastX: null,
            lastZ: null,
            lastResult: null,
            cacheThreshold: 0.5  // Only recalculate if position changes by more than this
        };
    }

    /**
     * Set physics manager reference for collision detection
     * @param {PhysicsManager} physicsManager
     */
    setPhysicsManager(physicsManager) {
        this.physicsManager = physicsManager;
    }

    /**
     * Find valid dock X position near the cursor
     * Dock orientation: East-West with water on East (+X) side, land on West (-X) side
     * West end (X-5): terrain height 0.5 to 0.6 (at dock deck level)
     * East end (X+5): terrain height <= -1 (in water)
     * @param {number} mouseX - Cursor X position to search near
     * @param {number} z - Z coordinate to find dock position for
     * @returns {object} - {validX: number|null, reason: string}
     */
    findValidDockX(mouseX, z) {
        // Check cache - reuse if position hasn't changed much
        if (this.dockCache.lastX !== null &&
            this.dockCache.lastZ !== null &&
            Math.abs(mouseX - this.dockCache.lastX) < this.dockCache.cacheThreshold &&
            Math.abs(z - this.dockCache.lastZ) < this.dockCache.cacheThreshold) {
            return this.dockCache.lastResult;
        }

        const heightCalc = this.terrainGenerator;
        const DOCK_HALF_LENGTH = 5;  // Dock is 10 units long
        const DOCK_DECK_HEIGHT = 1.0;  // Must match config
        const SHORE_MIN_HEIGHT = DOCK_DECK_HEIGHT - 0.2;  // West end: 0.8 to 1.2
        const SHORE_MAX_HEIGHT = DOCK_DECK_HEIGHT + 0.2;  // Allows player to step onto dock
        const WATER_MAX_HEIGHT = -1;   // East end must be at or below this
        const SEARCH_RANGE = 10;       // Search ±10 units from cursor
        const SHIP_LANE_DISTANCE = 100;  // Check for clear water 100 units east
        const SHIP_LANE_INTERVAL = 5;    // Check every 5 units
        const SHIP_LANE_MIN_DEPTH = -3;  // Must be below -3 for ship passage

        // Sample terrain at cursor position to give contextual feedback
        const cursorHeight = heightCalc.getWorldHeight(mouseX, z);
        const westEndHeight = heightCalc.getWorldHeight(mouseX - DOCK_HALF_LENGTH, z);
        const eastEndHeight = heightCalc.getWorldHeight(mouseX + DOCK_HALF_LENGTH, z);

        // Search for valid dock position within range of cursor
        let validX = null;
        let shipLaneBlocked = false;  // Track if we found a shore position but ship lane was blocked
        for (let offset = 0; offset <= SEARCH_RANGE; offset += 0.5) {
            // Try both directions from cursor
            for (const sign of [1, -1]) {
                if (offset === 0 && sign === -1) continue; // Don't check 0 twice

                const testX = mouseX + (offset * sign);
                const shoreEndX = testX - DOCK_HALF_LENGTH;  // West end
                const waterEndX = testX + DOCK_HALF_LENGTH;  // East end

                const shoreHeight = heightCalc.getWorldHeight(shoreEndX, z);
                const waterHeight = heightCalc.getWorldHeight(waterEndX, z);

                if (shoreHeight >= SHORE_MIN_HEIGHT &&
                    shoreHeight <= SHORE_MAX_HEIGHT &&
                    waterHeight <= WATER_MAX_HEIGHT) {
                    // Check ship lane for clear deep water
                    let shipLaneClear = true;
                    for (let dist = 10; dist <= SHIP_LANE_DISTANCE; dist += SHIP_LANE_INTERVAL) {
                        const laneHeight = heightCalc.getWorldHeight(testX + dist, z);
                        if (laneHeight > SHIP_LANE_MIN_DEPTH) {
                            shipLaneClear = false;
                            break;
                        }
                    }
                    if (shipLaneClear) {
                        validX = testX;
                        break;
                    } else {
                        shipLaneBlocked = true;
                    }
                }
            }
            if (validX !== null) break;
        }

        // Determine reason for failure if no valid position found
        let reason = '';
        if (validX === null) {
            // Ship lane blocked takes priority if we found a valid shore position
            if (shipLaneBlocked) {
                reason = 'Need deep water with no islands 100 units to the east to place dock';
            } else if (cursorHeight <= WATER_MAX_HEIGHT) {
                reason = 'Move west toward shore';
            } else if (cursorHeight > SHORE_MAX_HEIGHT + 1) {
                reason = 'Move east toward water';
            } else if (westEndHeight < SHORE_MIN_HEIGHT) {
                reason = 'West end needs land at shore level';
            } else if (westEndHeight > SHORE_MAX_HEIGHT) {
                reason = 'West end too high - move east';
            } else if (eastEndHeight > WATER_MAX_HEIGHT) {
                reason = 'East end needs deeper water';
            } else {
                reason = 'No valid east-facing shoreline nearby';
            }
        }

        // Cache result
        const result = { validX, reason };
        this.dockCache.lastX = mouseX;
        this.dockCache.lastZ = z;
        this.dockCache.lastResult = result;

        return result;
    }

    /**
     * Clear dock placement cache (call when exiting dock placement mode)
     */
    clearDockCache() {
        this.dockCache.lastX = null;
        this.dockCache.lastZ = null;
        this.dockCache.lastResult = null;
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
                // Dock snaps to valid shoreline position on east-facing shores
                // Player controls both X and Z, system searches nearby for valid position
                const snappedX = Math.round(mouseX / 0.25) * 0.25;
                const snappedZ = Math.round(mouseZ / 0.25) * 0.25;
                const result = this.findValidDockX(snappedX, snappedZ);

                placement.position.z = snappedZ;
                if (result.validX !== null) {
                    placement.position.x = result.validX;
                    placement.dockValid = true;
                    placement.dockReason = '';
                } else {
                    // No valid position nearby - show at mouse position but mark invalid
                    placement.position.x = snappedX;
                    placement.dockValid = false;
                    placement.dockReason = result.reason;
                }
            } else {
                // Regular structures snap to 0.25 grid
                placement.position.x = Math.round(mouseX / 0.25) * 0.25;
                placement.position.z = Math.round(mouseZ / 0.25) * 0.25;
            }

            let previewY;

            // Water structures snap to water surface
            if (structure && structure.requiresWater) {
                // Ships snap to water surface (y = 0)
                previewY = CONFIG.WATER.LEVEL;
                placement.position.y = previewY;
            } else if (structure && structure.type === 'road') {
                // Roads follow exact terrain height + small offset (no snapping, no 4-corner averaging)
                const terrainHeight = this.terrainGenerator.getWorldHeight(
                    placement.position.x,
                    placement.position.z
                );

                // Add 0.02 offset so circle is visible above terrain without perspective issues
                let roadHeight = terrainHeight + 0.02;

                // Water-level protection (no roads below water)
                const waterLevelWithOffset = CONFIG.WATER.LEVEL + 0.02;
                if (roadHeight < waterLevelWithOffset) {
                    roadHeight = waterLevelWithOffset;
                }

                previewY = roadHeight;
                placement.position.y = roadHeight;
            } else if (structure && structure.type === 'dock') {
                // Docks always at fixed height
                const dockHeight = CONFIG.CONSTRUCTION.STRUCTURE_PROPERTIES.dock.deckHeight;
                previewY = dockHeight;
                placement.position.y = dockHeight;
            } else {
                // Calculate average height from 4 corners for terrain placement
                // Use actual structure dimensions for corner sampling
                const dims = this.getGridDimensions(structure.type, placement.rotation || 0);

                // Handle circular structures (with radius) vs rectangular (with width/depth)
                let halfWidth, halfDepth;
                if (dims.radius !== undefined) {
                    // Circular structure - use radius for both dimensions
                    halfWidth = dims.radius;
                    halfDepth = dims.radius;
                } else {
                    halfWidth = dims.width / 2;
                    halfDepth = dims.depth / 2;
                }

                const corner1 = this.terrainGenerator.getWorldHeight(placement.position.x - halfWidth, placement.position.z - halfDepth);
                const corner2 = this.terrainGenerator.getWorldHeight(placement.position.x + halfWidth, placement.position.z - halfDepth);
                const corner3 = this.terrainGenerator.getWorldHeight(placement.position.x - halfWidth, placement.position.z + halfDepth);
                const corner4 = this.terrainGenerator.getWorldHeight(placement.position.x + halfWidth, placement.position.z + halfDepth);
                const averageHeight = (corner1 + corner2 + corner3 + corner4) / 4;

                // Snap to 0.25 grid - round UP to nearest 0.25 increment
                let snappedHeight = Math.ceil(averageHeight / 0.25) * 0.25;

                // Water-level protection
                if (snappedHeight < CONFIG.WATER.LEVEL) {
                    // Below water level - default to safe height
                    snappedHeight = Math.max(CONFIG.WATER.LEVEL + 0.5, 0.5);
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
        // Skip for docks - BuildMenu handles this after immediate validation
        if (!(placement.structure && placement.structure.type === 'dock')) {
            this.updateStructurePreviewColors(placement, ui);
        }
    }

    /**
     * Update preview colors based on validation state
     * @param {object} placement - Structure placement state
     * @param {object} ui - UI instance for status updates
     */
    updateStructurePreviewColors(placement, ui) {
        if (!placement.previewBox) return;

        const previewMesh = placement.previewBox.userData.previewMesh;
        if (!previewMesh) return;

        // Determine color based on validation state
        let color;
        if (placement.validationPending) {
            color = 0xffffff;  // White for pending
        } else if (placement.isValid) {
            color = 0x00ff00;  // Green for valid
            ui.updatePlacementStatus('Valid location', true);
        } else {
            color = 0xff0000;  // Red for invalid
            ui.updatePlacementStatus(placement.invalidReason, false);
        }

        // Apply color to preview mesh
        previewMesh.material.color.setHex(color);
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
            // Check player distance first
            if (playerPosition) {
                const dx = pos.x - playerPosition.x;
                const dz = pos.z - playerPosition.z;
                const distance = Math.sqrt(dx * dx + dz * dz);
                if (distance > 2.0) {
                    return {
                        isValid: false,
                        invalidReason: 'Too far from player'
                    };
                }
            }
            return this.validateWaterPlacement(pos, structure, placement.rotation || 0);
        }

        // Special validation for docks (shoreline placement)
        if (structure && structure.type === 'dock') {
            return this.validateDockPlacement(placement);
        }

        // Special validation for roads, campfires, tents, and plantable items (player distance check)
        const nearbyOnlyTypes = ['road', 'campfire', 'tent', 'planted_pine', 'planted_fir', 'planted_apple', 'planted_vegetables'];
        if (structure && nearbyOnlyTypes.includes(structure.type)) {
            // Check if player position is available
            if (!playerPosition) {
                return {
                    isValid: false,
                    invalidReason: 'Player position unavailable'
                };
            }

            // Calculate 2D distance from player to placement (ignore Y axis)
            const dx = pos.x - playerPosition.x;
            const dz = pos.z - playerPosition.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            // Larger structures get larger range due to larger bounding boxes
            const isPlantable = structure.type.startsWith('planted_');
            const isTent = structure.type === 'tent';
            const maxDistance = (isPlantable || isTent) ? 2.0 : 1.0;

            if (distance > maxDistance) {
                return {
                    isValid: false,
                    invalidReason: 'Too far from player'
                };
            }

            // Continue with regular validation checks below (height, slope, collision)
        }

        // Regular structure validation
        // Check 1: Height validation
        // Restricted structures need terrain height >= water level
        const restrictedStructures = ['crate', 'outpost', 'tent', 'house', 'market', 'garden', 'tileworks', 'planted_pine', 'planted_fir', 'planted_apple', 'planted_vegetables'];
        if (structure && restrictedStructures.includes(structure.type)) {
            // Calculate average height of 4 corners like confirmStructurePlacement does
            const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[structure.type];
            if (dims) {
                const rotation = (placement.rotation || 0) * (Math.PI / 180);
                const halfWidth = dims.width / 2;
                const halfDepth = dims.depth / 2;

                // Apply rotation to get corner offsets
                const cos = Math.cos(rotation);
                const sin = Math.sin(rotation);

                const corners = [
                    { dx: -halfWidth, dz: -halfDepth },
                    { dx: halfWidth, dz: -halfDepth },
                    { dx: -halfWidth, dz: halfDepth },
                    { dx: halfWidth, dz: halfDepth }
                ];

                let totalHeight = 0;
                for (const corner of corners) {
                    const rotatedX = corner.dx * cos - corner.dz * sin;
                    const rotatedZ = corner.dx * sin + corner.dz * cos;
                    totalHeight += this.terrainGenerator.getWorldHeight(
                        pos.x + rotatedX,
                        pos.z + rotatedZ
                    );
                }
                const averageHeight = totalHeight / 4;

                if (averageHeight < CONFIG.WATER.LEVEL) {
                    return {
                        isValid: false,
                        invalidReason: 'Terrain too low'
                    };
                }
            }
        } else if (pos.y < -0.5) {
            // Other structures just need to not be underwater
            return {
                isValid: false,
                invalidReason: 'Terrain too low'
            };
        }

        // Check 2: Terrain slope
        const normalY = this.terrainGenerator.getNormalY(pos.x, pos.z);
        const slope = Math.acos(normalY) * (180 / Math.PI); // Convert to degrees

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
     * Validate dock placement (shoreline position + collision check)
     * @param {object} placement - Placement state
     * @returns {object} - {isValid, invalidReason}
     */
    validateDockPlacement(placement) {
        const pos = placement.position;

        // Check 1: Was a valid shoreline position found?
        if (!placement.dockValid) {
            return {
                isValid: false,
                invalidReason: placement.dockReason || 'No valid east-facing shoreline nearby'
            };
        }

        // Check 2: Physics collision detection (if available)
        if (this.physicsManager && this.physicsManager.initialized) {
            const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS['dock'];

            if (dims) {
                const shape = {
                    type: 'cuboid',
                    width: dims.width,
                    depth: dims.depth,
                    height: dims.height || 1.0
                };

                // Dock is always at 90 degrees
                const rotation = 90 * (Math.PI / 180);

                // Test for overlap with existing colliders
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
     * Validate water placement for ships/boats
     * @param {object} pos - Position {x, y, z}
     * @param {object} structure - Structure definition
     * @param {number} rotation - Rotation in degrees
     * @returns {object} - {isValid, invalidReason}
     */
    validateWaterPlacement(pos, structure, rotation) {
        const terrainHeight = this.terrainGenerator.getWorldHeight(pos.x, pos.z);

        if (terrainHeight >= 0) {
            return {
                isValid: false,
                invalidReason: 'Must be placed in water (height < 0)'
            };
        }

        // Physics collision detection (same as regular structures)
        if (this.physicsManager && this.physicsManager.initialized && structure) {
            const structureType = structure.type;
            const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[structureType];

            if (dims) {
                let shape;
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

                const rotationRad = (rotation || 0) * (Math.PI / 180);
                const collisionMask = COLLISION_GROUPS.STRUCTURE | COLLISION_GROUPS.NATURAL | COLLISION_GROUPS.PLACED;
                const hasOverlap = this.physicsManager.testShapeOverlap(
                    shape,
                    pos,
                    rotationRad,
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

        return {
            isValid: true,
            invalidReason: ''
        };
    }

}

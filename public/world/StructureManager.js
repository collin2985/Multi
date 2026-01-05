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
            cacheThreshold: 2.5  // Only recalculate if position changes by more than this
        };

        // Ship lane cache - keyed by Z coordinate (rounded)
        this.shipLaneCache = new Map();
    }

    /**
     * Set physics manager reference for collision detection
     * @param {PhysicsManager} physicsManager
     */
    setPhysicsManager(physicsManager) {
        this.physicsManager = physicsManager;
    }

    /**
     * Rotation configurations for dock placement
     * Convention (Option A - Mathematical):
     *   0°   = water to South (-Z), land to North (+Z)
     *   90°  = water to East (+X), land to West (-X)  <- current working behavior
     *   180° = water to North (+Z), land to South (-Z)
     *   270° = water to West (-X), land to East (+X)
     */
    static DOCK_ROTATIONS = [
        { rotation: 90,  landOffset: { x: -5, z: 0 }, waterOffset: { x: 5, z: 0 },  laneDir: { x: 1, z: 0 } },   // Water East (current)
        { rotation: 0,   landOffset: { x: 0, z: 5 },  waterOffset: { x: 0, z: -5 }, laneDir: { x: 0, z: -1 } },  // Water South
        { rotation: 180, landOffset: { x: 0, z: -5 }, waterOffset: { x: 0, z: 5 },  laneDir: { x: 0, z: 1 } },   // Water North
        { rotation: 270, landOffset: { x: 5, z: 0 },  waterOffset: { x: -5, z: 0 }, laneDir: { x: -1, z: 0 } }   // Water West
    ];

    /**
     * Rotation configurations for fisherman placement
     * Fisherman requires 2 corners on land (>= 0) and 2 corners in water (< 0)
     * The model's land-facing side is at local -Z (back). All rotations check that
     * land corners are on the local -Z edge (landSide='z-'), ensuring proper orientation.
     * Each rotation handles a different world shoreline direction.
     */
    static FISHERMAN_ROTATIONS = [
        { rotation: 0,   landSide: 'z-' },   // Works for terrain land at world -Z (south)
        { rotation: 90,  landSide: 'z-' },   // Works for terrain land at world +X (east)
        { rotation: 180, landSide: 'z-' },   // Works for terrain land at world +Z (north)
        { rotation: 270, landSide: 'z-' }    // Works for terrain land at world -X (west)
    ];

    /**
     * Find valid dock placement with auto-detected rotation
     * Tries all 4 rotations and returns the first valid one
     * @param {number} mouseX - Cursor X position
     * @param {number} mouseZ - Cursor Z position
     * @param {boolean} checkShipLane - Whether to check ship lane (false for preview, true for confirm)
     * @returns {object} - {validX, validZ, rotation, reason}
     */
    findValidDockPlacement(mouseX, mouseZ, checkShipLane = false) {
        // Check cache - reuse if position hasn't changed much
        if (this.dockCache.lastX !== null &&
            this.dockCache.lastZ !== null &&
            Math.abs(mouseX - this.dockCache.lastX) < this.dockCache.cacheThreshold &&
            Math.abs(mouseZ - this.dockCache.lastZ) < this.dockCache.cacheThreshold &&
            this.dockCache.lastCheckShipLane === checkShipLane) {
            return this.dockCache.lastResult;
        }

        const heightCalc = this.terrainGenerator;
        const SHORE_MIN_HEIGHT = 0.8;
        const SHORE_MAX_HEIGHT = 1.8;
        const WATER_MAX_HEIGHT = -0.5;
        const SEARCH_RANGE = 5;

        let validX = null;
        let validZ = null;
        let validRotation = null;
        let shipLaneBlocked = false;
        let reason = '';

        // Search outward from cursor position
        outerLoop:
        for (let offset = 0; offset <= SEARCH_RANGE; offset += 0.5) {
            // Try positions around cursor at this offset
            const positions = offset === 0
                ? [{ x: mouseX, z: mouseZ }]
                : [
                    { x: mouseX + offset, z: mouseZ },
                    { x: mouseX - offset, z: mouseZ },
                    { x: mouseX, z: mouseZ + offset },
                    { x: mouseX, z: mouseZ - offset }
                ];

            for (const pos of positions) {
                const testX = Math.round(pos.x / 0.25) * 0.25;
                const testZ = Math.round(pos.z / 0.25) * 0.25;

                // Try each rotation at this position
                for (const rotConfig of StructureManager.DOCK_ROTATIONS) {
                    const landX = testX + rotConfig.landOffset.x;
                    const landZ = testZ + rotConfig.landOffset.z;
                    const waterX = testX + rotConfig.waterOffset.x;
                    const waterZ = testZ + rotConfig.waterOffset.z;

                    const landHeight = heightCalc.getWorldHeight(landX, landZ);
                    const waterHeight = heightCalc.getWorldHeight(waterX, waterZ);

                    // Check shore conditions
                    if (landHeight >= SHORE_MIN_HEIGHT &&
                        landHeight <= SHORE_MAX_HEIGHT &&
                        waterHeight <= WATER_MAX_HEIGHT) {

                        // Only check ship lane on confirm, not during preview
                        if (checkShipLane) {
                            const shipLaneClear = this.checkShipLane(testX, testZ, rotConfig.laneDir.x, rotConfig.laneDir.z);
                            if (shipLaneClear) {
                                validX = testX;
                                validZ = testZ;
                                validRotation = rotConfig.rotation;
                                break outerLoop;
                            } else {
                                shipLaneBlocked = true;
                            }
                        } else {
                            // Preview mode - skip ship lane check
                            validX = testX;
                            validZ = testZ;
                            validRotation = rotConfig.rotation;
                            break outerLoop;
                        }
                    }
                }
            }
        }

        // Determine reason for failure
        if (validX === null) {
            if (shipLaneBlocked) {
                reason = 'Ship lane blocked - need 50 units of deep water';
            } else {
                const cursorHeight = heightCalc.getWorldHeight(mouseX, mouseZ);
                if (cursorHeight <= WATER_MAX_HEIGHT) {
                    reason = 'Move toward shore';
                } else if (cursorHeight > SHORE_MAX_HEIGHT + 1) {
                    reason = 'Move toward water';
                } else {
                    reason = 'No valid shoreline nearby';
                }
            }
        }

        // Cache result
        const result = { validX, validZ, rotation: validRotation, reason };
        this.dockCache.lastX = mouseX;
        this.dockCache.lastZ = mouseZ;
        this.dockCache.lastResult = result;
        this.dockCache.lastCheckShipLane = checkShipLane;

        return result;
    }

    /**
     * Find valid fisherman placement with auto-detected rotation
     * Fisherman requires 2 corners on land (y >= 0) and 2 corners in water (y < 0)
     * @param {number} mouseX - Cursor X position
     * @param {number} mouseZ - Cursor Z position
     * @returns {object} - {validX, validZ, rotation, centerHeight, reason}
     */
    findValidFishermanPlacement(mouseX, mouseZ) {
        // Check cache - reuse if position hasn't changed much
        if (this.fishermanCache &&
            this.fishermanCache.lastX !== null &&
            Math.abs(mouseX - this.fishermanCache.lastX) < 2.5 &&
            Math.abs(mouseZ - this.fishermanCache.lastZ) < 2.5) {
            return this.fishermanCache.lastResult;
        }

        // Initialize cache if needed
        if (!this.fishermanCache) {
            this.fishermanCache = { lastX: null, lastZ: null, lastResult: null };
        }

        const heightCalc = this.terrainGenerator;
        const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS['fisherman'];
        const halfWidth = dims.width / 2;
        const halfDepth = dims.depth / 2;
        const SEARCH_RANGE = 5;

        let validX = null;
        let validZ = null;
        let validRotation = null;
        let validCenterHeight = null;
        let reason = '';

        // Search outward from cursor position
        outerLoop:
        for (let offset = 0; offset <= SEARCH_RANGE; offset += 0.5) {
            const positions = offset === 0
                ? [{ x: mouseX, z: mouseZ }]
                : [
                    { x: mouseX + offset, z: mouseZ },
                    { x: mouseX - offset, z: mouseZ },
                    { x: mouseX, z: mouseZ + offset },
                    { x: mouseX, z: mouseZ - offset }
                ];

            for (const pos of positions) {
                const testX = Math.round(pos.x / 0.25) * 0.25;
                const testZ = Math.round(pos.z / 0.25) * 0.25;

                // Try each rotation at this position
                for (const rotConfig of StructureManager.FISHERMAN_ROTATIONS) {
                    const rotationRad = rotConfig.rotation * (Math.PI / 180);
                    const cos = Math.cos(rotationRad);
                    const sin = Math.sin(rotationRad);

                    // Define corners in local space
                    const corners = [
                        { dx: -halfWidth, dz: -halfDepth, name: 'corner1' },
                        { dx: halfWidth, dz: -halfDepth, name: 'corner2' },
                        { dx: -halfWidth, dz: halfDepth, name: 'corner3' },
                        { dx: halfWidth, dz: halfDepth, name: 'corner4' }
                    ];

                    // Get heights at all 4 rotated corners
                    const cornerData = corners.map(corner => {
                        const rotatedX = corner.dx * cos - corner.dz * sin;
                        const rotatedZ = corner.dx * sin + corner.dz * cos;
                        const height = heightCalc.getWorldHeight(testX + rotatedX, testZ + rotatedZ);
                        return { ...corner, rotatedX, rotatedZ, height };
                    });

                    // Count corners on land (>= 0) and in water (< 0)
                    const landCorners = cornerData.filter(c => c.height >= 0);
                    const waterCorners = cornerData.filter(c => c.height < 0);

                    // Valid if exactly 2 land and 2 water corners
                    if (landCorners.length === 2 && waterCorners.length === 2) {
                        // Additional check: land corners should be adjacent (on same edge), not diagonal
                        // Two corners are adjacent if they share an X or Z coordinate in local space
                        const [l1, l2] = landCorners;
                        const areAdjacent = (l1.dx === l2.dx) || (l1.dz === l2.dz);

                        if (areAdjacent) {
                            // Check that the land side matches the expected side for this rotation
                            // This ensures consistent orientation
                            let correctSide = false;
                            if (rotConfig.landSide === 'z+' && l1.dz > 0 && l2.dz > 0) correctSide = true;
                            if (rotConfig.landSide === 'z-' && l1.dz < 0 && l2.dz < 0) correctSide = true;
                            if (rotConfig.landSide === 'x+' && l1.dx > 0 && l2.dx > 0) correctSide = true;
                            if (rotConfig.landSide === 'x-' && l1.dx < 0 && l2.dx < 0) correctSide = true;

                            if (correctSide) {
                                validX = testX;
                                validZ = testZ;
                                validRotation = rotConfig.rotation;
                                // Center height is average of all 4 corners
                                validCenterHeight = (cornerData[0].height + cornerData[1].height + cornerData[2].height + cornerData[3].height) / 4;
                                break outerLoop;
                            }
                        }
                    }
                }
            }
        }

        // Determine reason for failure
        if (validX === null) {
            const cursorHeight = heightCalc.getWorldHeight(mouseX, mouseZ);
            if (cursorHeight < -1) {
                reason = 'Move toward shore';
            } else if (cursorHeight > 1) {
                reason = 'Move toward water';
            } else {
                reason = 'Need 2 corners on land, 2 in water';
            }
        }

        // Cache result
        const result = { validX, validZ, rotation: validRotation, centerHeight: validCenterHeight, reason };
        this.fishermanCache.lastX = mouseX;
        this.fishermanCache.lastZ = mouseZ;
        this.fishermanCache.lastResult = result;

        return result;
    }

    /**
     * Legacy wrapper for backward compatibility
     * @deprecated Use findValidDockPlacement instead
     */
    findValidDockX(mouseX, z, checkShipLane = false) {
        const result = this.findValidDockPlacement(mouseX, z, checkShipLane);
        return { validX: result.validX, reason: result.reason };
    }

    /**
     * Check if ship lane is clear in a given direction
     * @param {number} x - Dock X position
     * @param {number} z - Dock Z position
     * @param {number} dirX - Direction X component (1, -1, or 0)
     * @param {number} dirZ - Direction Z component (1, -1, or 0)
     * @returns {boolean} - True if ship lane is clear
     */
    checkShipLane(x, z, dirX = 1, dirZ = 0) {
        const SHIP_LANE_DISTANCE = 50;
        const SHIP_LANE_INTERVAL = 10;
        const SHIP_LANE_MIN_DEPTH = -3;

        // Cache key includes position and direction
        const cacheKey = `${Math.round(x)},${Math.round(z)},${dirX},${dirZ}`;

        // Check cache
        if (this.shipLaneCache.has(cacheKey)) {
            return this.shipLaneCache.get(cacheKey);
        }

        const heightCalc = this.terrainGenerator;
        let shipLaneClear = true;

        for (let dist = 10; dist <= SHIP_LANE_DISTANCE; dist += SHIP_LANE_INTERVAL) {
            const laneX = x + dist * dirX;
            const laneZ = z + dist * dirZ;
            const laneHeight = heightCalc.getWorldHeight(laneX, laneZ);
            if (laneHeight > SHIP_LANE_MIN_DEPTH) {
                shipLaneClear = false;
                break;
            }
        }

        // Cache result
        this.shipLaneCache.set(cacheKey, shipLaneClear);

        // Limit cache size
        if (this.shipLaneCache.size > 100) {
            const firstKey = this.shipLaneCache.keys().next().value;
            this.shipLaneCache.delete(firstKey);
        }

        return shipLaneClear;
    }

    /**
     * Clear dock placement cache (call when exiting dock placement mode)
     */
    clearDockCache() {
        this.dockCache.lastX = null;
        this.dockCache.lastZ = null;
        this.dockCache.lastResult = null;
        this.dockCache.lastCheckShipLane = null;
        this.shipLaneCache.clear();
    }

    /**
     * Get direction name from dock rotation for error messages
     * @param {number} rotation - Dock rotation in degrees
     * @returns {string} - Direction name (east, south, north, west)
     */
    getDirectionName(rotation) {
        switch (rotation) {
            case 0: return 'south';
            case 90: return 'east';
            case 180: return 'north';
            case 270: return 'west';
            default: return 'east';
        }
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
                // Dock snaps to valid shoreline position with auto-detected rotation
                const snappedX = Math.round(mouseX / 0.25) * 0.25;
                const snappedZ = Math.round(mouseZ / 0.25) * 0.25;
                const result = this.findValidDockPlacement(snappedX, snappedZ);

                if (result.validX !== null) {
                    placement.position.x = result.validX;
                    placement.position.z = result.validZ;
                    placement.rotation = result.rotation;
                    placement.dockValid = true;
                    placement.dockReason = '';
                    // Update preview rotation
                    previewBox.rotation.y = result.rotation * (Math.PI / 180);
                } else {
                    // No valid position nearby - show at mouse position but mark invalid
                    placement.position.x = snappedX;
                    placement.position.z = snappedZ;
                    placement.dockValid = false;
                    placement.dockReason = result.reason;
                }
            } else if (structure && structure.type === 'fisherman') {
                // Fisherman snaps to valid shoreline position (2 corners land, 2 corners water)
                const snappedX = Math.round(mouseX / 0.25) * 0.25;
                const snappedZ = Math.round(mouseZ / 0.25) * 0.25;
                const result = this.findValidFishermanPlacement(snappedX, snappedZ);

                if (result.validX !== null) {
                    placement.position.x = result.validX;
                    placement.position.z = result.validZ;
                    placement.rotation = result.rotation;
                    placement.fishermanValid = true;
                    placement.fishermanReason = '';
                    placement.fishermanCenterHeight = result.centerHeight;
                    // Update preview rotation
                    previewBox.rotation.y = result.rotation * (Math.PI / 180);
                } else {
                    // No valid position nearby - show at mouse position but mark invalid
                    placement.position.x = snappedX;
                    placement.position.z = snappedZ;
                    placement.fishermanValid = false;
                    placement.fishermanReason = result.reason;
                    placement.fishermanCenterHeight = null;
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
            } else if (structure && structure.type === 'fisherman') {
                // Fisherman: Y = center terrain height + 1
                const centerHeight = placement.fishermanCenterHeight !== null
                    ? placement.fishermanCenterHeight
                    : this.terrainGenerator.getWorldHeight(placement.position.x, placement.position.z);
                const fishermanHeight = centerHeight + 1;
                previewY = fishermanHeight;
                placement.position.y = fishermanHeight;
            } else {
                // Get terrain height at sample points, use the highest
                // IMPORTANT: placement.rotation is in DEGREES, must convert to radians for trig
                const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[structure?.type];
                let maxHeight;

                if (structure?.type === 'market') {
                    // Market uses 3 sample points along depth axis: center, +5, -5
                    // placement.rotation is in DEGREES - convert to radians
                    const rotationDegrees = placement.rotation || 0;
                    const rotationRad = rotationDegrees * (Math.PI / 180);
                    const sin = Math.sin(rotationRad);
                    const cos = Math.cos(rotationRad);

                    // Sample points along the depth axis (local Z when unrotated)
                    const samplePoints = [
                        { dx: 0, dz: 0 },                      // Center
                        { dx: 5 * sin, dz: 5 * cos },          // +5 along depth axis
                        { dx: -5 * sin, dz: -5 * cos }         // -5 along depth axis
                    ];

                    maxHeight = -Infinity;
                    for (const point of samplePoints) {
                        const pointHeight = this.terrainGenerator.getWorldHeight(
                            placement.position.x + point.dx,
                            placement.position.z + point.dz
                        );
                        if (pointHeight > maxHeight) {
                            maxHeight = pointHeight;
                        }
                    }
                } else if (dims && dims.width) {
                    // Other rectangular structures: use highest of 4 corners
                    // placement.rotation is in DEGREES - convert to radians
                    const rotationDegrees = placement.rotation || 0;
                    const rotationRad = rotationDegrees * (Math.PI / 180);
                    const halfWidth = dims.width / 2;
                    const halfDepth = dims.depth / 2;
                    const cos = Math.cos(rotationRad);
                    const sin = Math.sin(rotationRad);

                    const corners = [
                        { dx: -halfWidth, dz: -halfDepth },
                        { dx: halfWidth, dz: -halfDepth },
                        { dx: -halfWidth, dz: halfDepth },
                        { dx: halfWidth, dz: halfDepth }
                    ];

                    maxHeight = -Infinity;
                    for (const corner of corners) {
                        const rotatedX = corner.dx * cos - corner.dz * sin;
                        const rotatedZ = corner.dx * sin + corner.dz * cos;
                        const cornerHeight = this.terrainGenerator.getWorldHeight(
                            placement.position.x + rotatedX,
                            placement.position.z + rotatedZ
                        );
                        if (cornerHeight > maxHeight) {
                            maxHeight = cornerHeight;
                        }
                    }
                } else {
                    // Fallback to center point for structures without dimensions
                    maxHeight = this.terrainGenerator.getWorldHeight(
                        placement.position.x,
                        placement.position.z
                    );
                }

                // Snap up to nearest 0.25 grid (ceil ensures structure sits above terrain)
                let snappedHeight = Math.ceil(maxHeight / 0.25) * 0.25;

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
        // Skip for docks and fisherman - BuildMenu handles this after immediate validation
        if (!(placement.structure && (placement.structure.type === 'dock' || placement.structure.type === 'fisherman'))) {
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

        // Special validation for fisherman (shoreline placement - 2 corners land, 2 corners water)
        if (structure && structure.type === 'fisherman') {
            return this.validateFishermanPlacement(placement);
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
            const isRoad = structure.type === 'road';
            const maxDistance = (isPlantable || isTent || isRoad) ? 2.0 : 1.0;

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
        const restrictedStructures = ['crate', 'outpost', 'tent', 'house', 'market', 'garden', 'tileworks', 'ironworks', 'blacksmith', 'bakery', 'gardener', 'miner', 'woodcutter', 'stonemason', 'wall', 'planted_pine', 'planted_fir', 'planted_apple', 'planted_vegetables'];
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

        if (slope > 37) {
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
                // Roads use small collision radius - can overlap natural objects but not structures
                if (structureType === 'road') {
                    shape = {
                        type: 'cylinder',
                        radius: 0.25,
                        height: 0.1
                    };
                } else if (dims.radius !== undefined) {
                    // Determine shape based on dimensions
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
     * Validate dock placement (shoreline position + ship lane + collision check)
     * @param {object} placement - Placement state
     * @returns {object} - {isValid, invalidReason}
     */
    validateDockPlacement(placement) {
        const pos = placement.position;
        const dockRotation = placement.rotation ?? 90;

        // Check 1: Was a valid shoreline position found?
        if (!placement.dockValid) {
            return {
                isValid: false,
                invalidReason: placement.dockReason || 'No valid shoreline nearby'
            };
        }

        // Check 2: Ship lane check - get direction from rotation
        const rotConfig = StructureManager.DOCK_ROTATIONS.find(r => r.rotation === dockRotation);
        const dirX = rotConfig ? rotConfig.laneDir.x : 1;
        const dirZ = rotConfig ? rotConfig.laneDir.z : 0;
        const shipLaneClear = this.checkShipLane(pos.x, pos.z, dirX, dirZ);
        if (!shipLaneClear) {
            const directionName = this.getDirectionName(dockRotation);
            return {
                isValid: false,
                invalidReason: `Need deep water with no islands 50 units to the ${directionName}`
            };
        }

        // Check 3: Physics collision detection (if available)
        if (this.physicsManager && this.physicsManager.initialized) {
            const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS['dock'];

            if (dims) {
                const shape = {
                    type: 'cuboid',
                    width: dims.width,
                    depth: dims.depth,
                    height: dims.height || 1.0
                };

                // Use actual dock rotation for collision check
                const rotation = dockRotation * (Math.PI / 180);

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
     * Validate fisherman placement (shoreline position + collision check)
     * Requires 2 corners on land (>= 0) and 2 corners in water (< 0)
     * @param {object} placement - Placement state
     * @returns {object} - {isValid, invalidReason}
     */
    validateFishermanPlacement(placement) {
        const pos = placement.position;
        const fishermanRotation = placement.rotation || 0;

        // Check 1: Was a valid shoreline position found?
        if (!placement.fishermanValid) {
            return {
                isValid: false,
                invalidReason: placement.fishermanReason || 'Need 2 corners on land, 2 in water'
            };
        }

        // Check 2: Physics collision detection (if available)
        if (this.physicsManager && this.physicsManager.initialized) {
            const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS['fisherman'];

            if (dims) {
                const shape = {
                    type: 'cuboid',
                    width: dims.width,
                    depth: dims.depth,
                    height: dims.height || 1.0
                };

                // Use actual fisherman rotation for collision check
                const rotation = fishermanRotation * (Math.PI / 180);

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

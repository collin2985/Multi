/**
 * DirtOverlaySystem.js
 *
 * Renders dirt patches under structures and natural objects (trees, rocks)
 * onto a texture that the terrain shader samples for blending.
 *
 * This replaces the old vertex-color-based dirt painting that was incompatible
 * with the new clipmap terrain system.
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { TERRAIN_CONFIG } from '../terrainsystem.js';
import ChunkCoordinates from '../core/ChunkCoordinates.js';

// Wrap coordinate to match terrain shader's coordinate space
function wrapCoord(v) {
    const p = TERRAIN_CONFIG.TILE_PERIOD;
    return ((v % p) + p) % p;
}

// Objects excluded from dirt painting (mobile entities, water structures, etc.)
// Note: 'dock' removed - docks now use terrain-based rendering with paintDockImmediate()
const EXCLUDED_TYPES = new Set(['ship', 'campfire', 'tent', 'road', 'horse', 'boat', 'sailboat', 'ship2', 'crate', 'cart', 'mobilecrate', 'wall', 'artillery']);

// Check if type is a log (logs don't get dirt)
const isLogType = (type) => type && type.endsWith('_log');

// Dirt painting constants
const CYLINDRICAL = {
    INNER_RADIUS: 0.0,    // No solid core - blend starts from center
    OUTER_RADIUS: 0.7,    // Falloff zone ends here
    NOISE_EXTENSION: 0.05 // Max noise extension for irregular edges
};

const RECTANGULAR = {
    MAX_MARGIN: 0.3       // Max noise margin for soft edges
};

export class DirtOverlaySystem {
    /**
     * @param {ChunkManager} chunkManager - Reference to chunk manager for object data
     * @param {Object} game - Game instance for accessing rendering systems
     */
    constructor(chunkManager, game = null) {
        this.chunkManager = chunkManager;
        this.game = game;  // For accessing gameState.receivedInitialServerState

        // Snap grid for center alignment (will be set by clipmap, default to 16)
        this.snapGrid = 16;

        // Texture configuration - higher resolution for sharper road shapes
        this.textureSize = 1024;  // Was 512, doubled for ~5.12 px/unit instead of ~2.56
        this.worldRange = 200;  // 200 world units covered by texture (slightly larger than 3x3 chunks = 150 units)
        this.scale = this.textureSize / this.worldRange;  // ~5.12 pixels per world unit
        this.halfSize = this.textureSize / 2;

        // Center tracking (for shader uniforms)
        this.centerX = 0;
        this.centerZ = 0;

        // Chunk-based tracking - only repaint on chunk boundary crossing
        this.currentChunkX = null;  // Current player chunk X
        this.currentChunkZ = null;  // Current player chunk Z
        this.current3x3Keys = new Set();  // Keys of chunks in current 3x3 grid

        // Create canvas for CPU-side rendering
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.textureSize;
        this.canvas.height = this.textureSize;
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: false });

        // Create THREE.js texture
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.wrapS = THREE.ClampToEdgeWrapping;
        this.texture.wrapT = THREE.ClampToEdgeWrapping;
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;
        this.texture.flipY = false;  // Disable Y-flip to match shader UV coordinates

        // State flags
        this.needsUpload = false;
        this.isInitialized = false;
        this.loadingComplete = false;  // Wait for initial server state before painting
        this._needsRepaint = false;
        this._lastSnappedX = null;
        this._lastSnappedZ = null;

        // Cache grid dimensions reference
        this.gridDimensions = CONFIG.CONSTRUCTION?.GRID_DIMENSIONS || {};
    }

    /**
     * Set the snap grid size (should match clipmap's coarsestSpacing)
     * Called by GeometryClipmap after initialization
     * @param {number} spacing - The coarsest grid spacing from clipmap
     */
    setSnapGrid(spacing) {
        this.snapGrid = spacing;
    }

    /**
     * Convert world coordinates to canvas pixel coordinates (wrap-aware)
     * @param {number} worldX - World X position (already wrapped)
     * @param {number} worldZ - World Z position (already wrapped)
     * @returns {{px: number, pz: number}} Pixel coordinates
     */
    worldToPixel(worldX, worldZ) {
        const period = TERRAIN_CONFIG.TILE_PERIOD;

        // Calculate wrap-aware signed distance
        let dx = worldX - this.centerX;
        let dz = worldZ - this.centerZ;

        // Handle wrap-around: if distance > half period, go the other way
        if (dx > period / 2) dx -= period;
        if (dx < -period / 2) dx += period;
        if (dz > period / 2) dz -= period;
        if (dz < -period / 2) dz += period;

        const px = dx * this.scale + this.halfSize;
        const pz = dz * this.scale + this.halfSize;
        return { px, pz };
    }

    /**
     * Update overlay based on player position
     * Called from game loop - uses chunk-based rebuilding for stability
     * @param {number} playerX - Player world X
     * @param {number} playerZ - Player world Z
     * @returns {boolean} True if overlay was rebuilt (center changed)
     */
    update(playerX, playerZ) {
        this.centerChanged = false;

        // Wait for initial server state AND object generation to complete before painting
        // ChunkObjectGenerator spreads object creation over many frames (5ms budget per frame)
        // If we paint too early, most trees/rocks won't exist yet in chunkObjects
        if (!this.loadingComplete) {
            const serverStateReady = this.game?.gameState?.receivedInitialServerState;
            const generator = this.game?.chunkObjectGenerator;
            const objectGenDone = generator && !generator.isProcessing && generator.queue?.length === 0;

            if (serverStateReady && objectGenDone) {
                this.loadingComplete = true;
                // Force initial paint by ensuring grid check triggers
                this._lastSnappedX = null;
                this._lastSnappedZ = null;
            } else {
                return false;  // Don't paint until loading is complete
            }
        }

        // Calculate current snapped position (matches what clipmap uses)
        const snappedX = Math.round(playerX / this.snapGrid) * this.snapGrid;
        const snappedZ = Math.round(playerZ / this.snapGrid) * this.snapGrid;

        // Check if player crossed a GRID boundary (not just chunk boundary)
        // This keeps dirt overlay center in sync with clipmap's meshWorldOffset
        const gridBoundaryCrossed = (snappedX !== this._lastSnappedX || snappedZ !== this._lastSnappedZ);

        // Get player's current chunk for 5x5 grid determination
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(playerX, playerZ);
        const chunkBoundaryCrossed = (chunkX !== this.currentChunkX || chunkZ !== this.currentChunkZ);

        // Update chunk tracking and 5x5 keys if chunk changed
        if (chunkBoundaryCrossed) {
            this.currentChunkX = chunkX;
            this.currentChunkZ = chunkZ;

            // Expand to 5x5 grid to cover full overlay range (200 units = 4 chunks)
            this.current3x3Keys = new Set();
            for (let dx = -2; dx <= 2; dx++) {
                for (let dz = -2; dz <= 2; dz++) {
                    const key = `${chunkX + dx},${chunkZ + dz}`;
                    this.current3x3Keys.add(key);
                }
            }
        }

        // Rebuild if grid boundary crossed (center moved) OR chunk boundary crossed (new objects in range)
        if (gridBoundaryCrossed || chunkBoundaryCrossed) {
            // Set center BEFORE rebuilding (critical for coordinate alignment)
            this.setCenter(playerX, playerZ);

            // Rebuild canvas with current objects and roads
            this.rebuildFrom3x3Chunks();
            this.centerChanged = true;
        }

        // Also rebuild if marked dirty (objects added/removed since last paint)
        if (this._needsRepaint && !this.centerChanged) {
            this.rebuildFrom3x3Chunks();
            this._needsRepaint = false;
            // Don't set centerChanged since center didn't actually move
        }

        // Upload texture if needed
        if (this.needsUpload) {
            this.texture.needsUpdate = true;
            this.needsUpload = false;
        }

        return this.centerChanged;
    }

    /**
     * Set the center of the overlay
     * @param {number} x - World X
     * @param {number} z - World Z
     */
    setCenter(x, z) {
        // Snap to CLIPMAP grid (same as terrain mesh) to prevent drift between
        // dirt overlay center and meshWorldOffset in shader.
        const snappedX = Math.round(x / this.snapGrid) * this.snapGrid;
        const snappedZ = Math.round(z / this.snapGrid) * this.snapGrid;

        // Store both wrapped (for shader) and unwrapped (for tracking) centers
        this.centerX = wrapCoord(snappedX);
        this.centerZ = wrapCoord(snappedZ);

        // Store unwrapped snapped position for grid-boundary detection
        this._lastSnappedX = snappedX;
        this._lastSnappedZ = snappedZ;
    }

    /**
     * Force a rebuild (call when structures are added/removed in current 3x3 grid)
     */
    forceRebuild() {
        if (this.currentChunkX !== null) {
            this.rebuildFrom3x3Chunks();
        }
    }

    /**
     * Mark that objects have changed and a repaint is needed on next update
     * Called when structures/roads are added or removed
     */
    markDirty() {
        this._needsRepaint = true;
    }

    /**
     * Check if a repaint is pending
     * @returns {boolean}
     */
    isDirty() {
        return this._needsRepaint === true;
    }

    /**
     * Rebuild entire overlay from only the current 5x5 chunk grid
     * This is called synchronously on chunk boundary crossing to prevent flicker
     */
    rebuildFrom3x3Chunks() {
        // Clear entire canvas first (clean slate - prevents accumulation)
        this.ctx.clearRect(0, 0, this.textureSize, this.textureSize);

        // Set up composite operation for max blending (prevents accumulation from overlapping patches)
        this.ctx.globalCompositeOperation = 'lighten';

        // Validation
        if (!this.chunkManager?.chunkObjects) {
            if (!this._warnedNoChunkManager) {
                console.warn('[DirtOverlay] No chunkManager.chunkObjects!');
                this._warnedNoChunkManager = true;
            }
            return;
        }

        let objectCount = 0;

        // Iterate chunks in expanded grid (covers full 200-unit overlay range)
        for (const chunkKey of this.current3x3Keys) {
            const objects = this.chunkManager.chunkObjects.get(chunkKey);
            if (!objects || objects.length === 0) continue;

            for (const obj of objects) {
                const pos = obj.position;
                if (!pos) continue;

                // Skip underwater objects
                if (pos.y < 1.1) continue;

                const modelType = obj.userData?.modelType;
                if (!modelType) continue;

                // Skip excluded types
                if (EXCLUDED_TYPES.has(modelType) || isLogType(modelType)) continue;

                const dims = this.gridDimensions[modelType];
                if (!dims) continue;

                const scale = obj.userData?.originalScale || obj.scale?.x || 1.0;

                // Skip objects with invalid positions
                if (!Number.isFinite(pos.x) || !Number.isFinite(pos.z)) continue;

                // Wrap object position to match shader coordinate space
                const wrappedX = wrapCoord(pos.x);
                const wrappedZ = wrapCoord(pos.z);

                // Cylindrical objects (trees, rocks)
                if (dims.radius !== undefined) {
                    // Use explicit dirtRadius from config, or fall back to formula
                    const dirtRadius = dims.dirtRadius !== undefined
                        ? dims.dirtRadius
                        : Math.max(dims.radius * 2.5, 1.0);
                    this.drawCylindricalDirt(wrappedX, wrappedZ, scale, dirtRadius);
                    objectCount++;
                }
                // Rectangular structures
                else if (dims.width !== undefined && dims.depth !== undefined) {
                    const rotation = obj.rotation?.y || 0;
                    this.drawRectangularDirt(wrappedX, wrappedZ, dims.width * scale, dims.depth * scale, rotation);
                    objectCount++;
                }
            }
        }

        // Paint roads from stored road data (persisted across chunk rebuilds)
        // Roads are stored in gameState.roads keyed by chunkKey
        let roadCount = 0;
        if (this.game?.gameState?.roads) {
            for (const chunkKey of this.current3x3Keys) {
                const roads = this.game.gameState.roads.get(chunkKey);
                if (!roads || roads.length === 0) continue;

                for (const road of roads) {
                    // Skip roads with invalid positions
                    if (!Number.isFinite(road.x) || !Number.isFinite(road.z)) continue;

                    const wrappedX = wrapCoord(road.x);
                    const wrappedZ = wrapCoord(road.z);
                    const rotation = road.rotation || 0; // Already in radians
                    this.drawPillRoadPatch(wrappedX, wrappedZ, rotation, road.materialType || 'limestone');
                    roadCount++;
                }
            }
        }

        // Paint docks from stored dock data (terrain-based docks use texture overlay)
        // Docks are stored in gameState.docks keyed by chunkKey
        let dockCount = 0;
        if (this.game?.gameState?.docks) {
            for (const chunkKey of this.current3x3Keys) {
                const docks = this.game.gameState.docks.get(chunkKey);
                if (!docks || docks.length === 0) continue;

                for (const dock of docks) {
                    // Skip docks with invalid positions
                    if (!Number.isFinite(dock.x) || !Number.isFinite(dock.z)) continue;

                    const wrappedX = wrapCoord(dock.x);
                    const wrappedZ = wrapCoord(dock.z);
                    const rotation = dock.rotation || 0; // Already in radians
                    this.drawDockPatch(wrappedX, wrappedZ, rotation, dock.materialType || 'limestone');
                    dockCount++;
                }
            }
        }

        // Reset composite operation
        this.ctx.globalCompositeOperation = 'source-over';

        this.needsUpload = true;
        this.isInitialized = true;
    }

    /**
     * Draw road patch at world position (uses GREEN channel)
     * Roads use a separate channel so they can overlay on top of dirt
     *
     * Visual: Solid road from center to radius, blends out to radius * 1.5
     * Speed effect uses the input radius (handled by NavigationMap)
     *
     * @param {number} worldX - Road center world X
     * @param {number} worldZ - Road center world Z
     * @param {number} radius - Road radius in world units (default 0.75 = 1.5m diameter solid)
     * @param {string} materialType - 'limestone' (gray) or 'sandstone' (yellow tint)
     */
    drawRoadPatch(worldX, worldZ, radius = 0.75, materialType = 'limestone') {
        const { px, pz } = this.worldToPixel(worldX, worldZ);

        // Solid road to radius, blend extends 0.25 units further
        const blendRadius = radius + 0.25;
        const outerPx = blendRadius * this.scale;

        // Safety check: skip if any values are non-finite
        if (!Number.isFinite(px) || !Number.isFinite(pz) || !Number.isFinite(outerPx) || outerPx <= 0) {
            return;
        }

        // Create radial gradient from center to outer edge
        // Limestone roads use GREEN channel, sandstone roads use BLUE channel
        const gradient = this.ctx.createRadialGradient(px, pz, 0, px, pz, outerPx);

        // Solid road from 0 to radius (75% of total), blend from radius to blendRadius
        const solidStop = radius / blendRadius;  // 0.75 / 1.0 = 0.75

        // Sandstone uses BLUE channel, limestone uses GREEN channel
        const isSandstone = materialType === 'sandstone';
        const g = isSandstone ? 0 : 255;  // Green for limestone
        const b = isSandstone ? 255 : 0;  // Blue for sandstone

        gradient.addColorStop(0, `rgb(0, ${g}, ${b})`);           // 1.0 = full road (center)
        gradient.addColorStop(solidStop, `rgb(0, ${g}, ${b})`);   // 1.0 = solid edge
        gradient.addColorStop(solidStop + 0.1, `rgb(0, ${Math.floor(g * 0.7)}, ${Math.floor(b * 0.7)})`);  // start blend
        gradient.addColorStop(solidStop + 0.15, `rgb(0, ${Math.floor(g * 0.3)}, ${Math.floor(b * 0.3)})`);  // mid blend
        gradient.addColorStop(1.0, 'rgb(0, 0, 0)');           // 0.0 = fully blended

        this.ctx.fillStyle = gradient;
        this.ctx.beginPath();
        this.ctx.arc(px, pz, outerPx, 0, Math.PI * 2);
        this.ctx.fill();
    }

    /**
     * Draw pill-shaped road patch at world position
     * Uses roundRect with maximum corner radius to create pill shape
     * Uses shadowBlur for smooth edge falloff (no banding)
     *
     * @param {number} worldX - Road center world X
     * @param {number} worldZ - Road center world Z
     * @param {number} rotation - Rotation in radians (matches THREE.js convention)
     * @param {string} materialType - 'limestone' or 'sandstone'
     */
    drawPillRoadPatch(worldX, worldZ, rotation = 0, materialType = 'limestone') {
        const { px, pz } = this.worldToPixel(worldX, worldZ);

        // Pill dimensions (1 unit wide, 2 units long)
        const width = 1.0;
        const depth = 2.0;
        const halfW = (width / 2) * this.scale;
        const halfD = (depth / 2) * this.scale;
        const cornerRadius = halfW;  // Max radius = pill shape

        // Safety check (same as drawRectangularDirt)
        if (!Number.isFinite(px) || !Number.isFinite(pz) || !Number.isFinite(halfW) || !Number.isFinite(halfD)) {
            return;
        }

        this.ctx.save();
        this.ctx.translate(px, pz);
        // Negate rotation: Canvas rotates clockwise for positive angles,
        // but THREE.js rotation.y rotates counterclockwise (Y-up convention)
        this.ctx.rotate(-rotation);

        // Sandstone uses BLUE channel, limestone uses GREEN channel
        const isSandstone = materialType === 'sandstone';
        const g = isSandstone ? 0 : 255;
        const b = isSandstone ? 255 : 0;

        // Draw solid pill shape (no blur for crisp edges)
        this.ctx.fillStyle = `rgb(0, ${g}, ${b})`;
        this.roundRect(-halfD, -halfW, halfD * 2, halfW * 2, cornerRadius);
        this.ctx.fill();

        this.ctx.restore();
    }

    /**
     * Paint road immediately at world position (for real-time feedback)
     * Does NOT clear canvas - additive painting
     *
     * @param {number} worldX - Road center world X
     * @param {number} worldZ - Road center world Z
     * @param {number} rotation - Rotation in radians (0 = length along X axis)
     * @param {string} materialType - 'limestone' or 'sandstone'
     */
    paintRoadImmediate(worldX, worldZ, rotation = 0, materialType = 'limestone') {
        // Wrap coordinates to match shader space
        const wrappedX = wrapCoord(worldX);
        const wrappedZ = wrapCoord(worldZ);

        // Save composite operation and set to lighten for max blending
        const prevComposite = this.ctx.globalCompositeOperation;
        this.ctx.globalCompositeOperation = 'lighten';

        this.drawPillRoadPatch(wrappedX, wrappedZ, rotation, materialType);

        // Restore composite operation
        this.ctx.globalCompositeOperation = prevComposite;

        // Flag for GPU upload
        this.needsUpload = true;
    }

    /**
     * Draw dock patch at world position (2x10 rectangle with sharp edges)
     * Uses GREEN channel for limestone, BLUE channel for sandstone
     *
     * @param {number} worldX - Dock center world X
     * @param {number} worldZ - Dock center world Z
     * @param {number} rotation - Rotation in radians
     * @param {string} materialType - 'limestone' or 'sandstone'
     */
    drawDockPatch(worldX, worldZ, rotation = 0, materialType = 'limestone') {
        const { px, pz } = this.worldToPixel(worldX, worldZ);

        // Dock dimensions: 4 units wide, 12 units long (matches CONFIG.CONSTRUCTION.GRID_DIMENSIONS.dock)
        const width = 4.0;
        const depth = 12.0;

        // Detect if rotation is ~90° or ~270° (East/West facing)
        // sin(PI/2) = 1, sin(3*PI/2) = -1
        const sinR = Math.sin(rotation);
        const isEastWest = Math.abs(sinR) > 0.99;

        // Swap dimensions for East/West to avoid floating-point rotation artifacts
        const drawWidth = isEastWest ? depth : width;
        const drawDepth = isEastWest ? width : depth;

        const halfW = (drawWidth / 2) * this.scale;
        const halfD = (drawDepth / 2) * this.scale;

        // Safety check
        if (!Number.isFinite(px) || !Number.isFinite(pz) || !Number.isFinite(halfW) || !Number.isFinite(halfD)) {
            return;
        }

        this.ctx.save();
        this.ctx.translate(px, pz);
        // NO ctx.rotate() - dimensions are swapped for 90°/270°, and 0°/180° are already axis-aligned

        // Sandstone uses BLUE channel, limestone uses GREEN channel
        const isSandstone = materialType === 'sandstone';
        const g = isSandstone ? 0 : 255;
        const b = isSandstone ? 255 : 0;
        this.ctx.fillStyle = `rgb(0, ${g}, ${b})`;
        this.ctx.fillRect(-halfW, -halfD, halfW * 2, halfD * 2);

        this.ctx.restore();
    }

    /**
     * Paint dock immediately at world position (for terrain-based dock rendering)
     * Does NOT clear canvas - additive painting
     *
     * @param {number} worldX - Dock center world X
     * @param {number} worldZ - Dock center world Z
     * @param {number} rotation - Rotation in radians
     * @param {string} materialType - 'limestone' or 'sandstone'
     */
    paintDockImmediate(worldX, worldZ, rotation = 0, materialType = 'limestone') {
        // Wrap coordinates to match shader space
        const wrappedX = wrapCoord(worldX);
        const wrappedZ = wrapCoord(worldZ);

        // Save composite operation and set to lighten for max blending
        const prevComposite = this.ctx.globalCompositeOperation;
        this.ctx.globalCompositeOperation = 'lighten';

        this.drawDockPatch(wrappedX, wrappedZ, rotation, materialType);

        // Restore composite operation
        this.ctx.globalCompositeOperation = prevComposite;

        // Flag for GPU upload
        this.needsUpload = true;
    }

    /**
     * Draw cylindrical dirt patch (for trees and rocks)
     * Uses radial gradient with smooth falloff
     *
     * @param {number} worldX - Object world X
     * @param {number} worldZ - Object world Z
     * @param {number} scale - Object scale multiplier
     * @param {number} baseRadius - Base radius in world units (default 1.5)
     */
    drawCylindricalDirt(worldX, worldZ, scale = 1.0, baseRadius = 1.5) {
        const { px, pz } = this.worldToPixel(worldX, worldZ);

        // Convert radius to pixels
        const outerPx = baseRadius * this.scale * scale;

        // Safety check: skip if any values are non-finite
        if (!Number.isFinite(px) || !Number.isFinite(pz) || !Number.isFinite(outerPx) || outerPx <= 0) {
            return;
        }

        // Create radial gradient from center to outer edge
        const gradient = this.ctx.createRadialGradient(px, pz, 0, px, pz, outerPx);

        // Use RED channel only (shader reads .r for dirt, .g for roads)
        // Must NOT write to green channel or it will appear as road
        gradient.addColorStop(0, 'rgb(255, 0, 0)');    // 1.0 = full dirt
        gradient.addColorStop(0.3, 'rgb(180, 0, 0)');  // 0.7
        gradient.addColorStop(0.6, 'rgb(80, 0, 0)');   // 0.3
        gradient.addColorStop(1.0, 'rgb(0, 0, 0)');    // 0.0 = full terrain

        this.ctx.fillStyle = gradient;
        this.ctx.beginPath();
        this.ctx.arc(px, pz, outerPx, 0, Math.PI * 2);
        this.ctx.fill();
    }

    /**
     * Draw rectangular dirt patch (for structures)
     * Supports rotation and has noise-varied soft edges matching old system
     *
     * @param {number} worldX - Structure center world X
     * @param {number} worldZ - Structure center world Z
     * @param {number} width - Structure width in world units
     * @param {number} depth - Structure depth in world units
     * @param {number} rotation - Rotation in radians
     */
    drawRectangularDirt(worldX, worldZ, width, depth, rotation) {
        const { px, pz } = this.worldToPixel(worldX, worldZ);

        // Convert dimensions to pixels
        const halfW = (width / 2) * this.scale;
        const halfD = (depth / 2) * this.scale;
        const marginPx = RECTANGULAR.MAX_MARGIN * this.scale;

        // Safety check: skip if any values are non-finite
        if (!Number.isFinite(px) || !Number.isFinite(pz) || !Number.isFinite(halfW) || !Number.isFinite(halfD)) {
            return;
        }

        this.ctx.save();
        this.ctx.translate(px, pz);
        // Negate rotation: Canvas rotates clockwise for positive angles,
        // but THREE.js rotation.y rotates counterclockwise (Y-up convention)
        this.ctx.rotate(-rotation);

        // Draw soft edge layers from outermost to innermost
        // With 'lighten' (max) composite, inner layers naturally take precedence
        const layers = 4;
        for (let i = layers; i >= 1; i--) {
            const expand = (marginPx * i) / layers;
            const redValue = Math.round(255 * (1.0 - (i / layers)) * 0.5);  // Fade out

            this.ctx.fillStyle = `rgb(${redValue}, 0, 0)`;

            // Draw expanded rectangle with rounded corners for softer edges
            this.roundRect(
                -halfW - expand,
                -halfD - expand,
                (halfW + expand) * 2,
                (halfD + expand) * 2,
                expand * 0.5  // Corner radius
            );
            this.ctx.fill();
        }

        // Draw solid core last
        // Use RED channel only (shader reads .r for dirt, .g for roads)
        this.ctx.fillStyle = 'rgb(255, 0, 0)';  // 1.0 = full dirt
        this.ctx.fillRect(-halfW, -halfD, halfW * 2, halfD * 2);

        this.ctx.restore();
    }

    /**
     * Draw rounded rectangle path
     * @param {number} x - Left edge
     * @param {number} y - Top edge
     * @param {number} width - Width
     * @param {number} height - Height
     * @param {number} radius - Corner radius
     */
    roundRect(x, y, width, height, radius) {
        radius = Math.min(radius, width / 2, height / 2);
        this.ctx.beginPath();
        this.ctx.moveTo(x + radius, y);
        this.ctx.lineTo(x + width - radius, y);
        this.ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        this.ctx.lineTo(x + width, y + height - radius);
        this.ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        this.ctx.lineTo(x + radius, y + height);
        this.ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        this.ctx.lineTo(x, y + radius);
        this.ctx.quadraticCurveTo(x, y, x + radius, y);
        this.ctx.closePath();
    }

    /**
     * Get uniforms for terrain shader
     * @returns {Object} Uniform values
     */
    getUniforms() {
        return {
            texDirtOverlay: { value: this.texture },
            dirtOverlayCenter: { value: new THREE.Vector2(this.centerX, this.centerZ) },
            dirtOverlayRange: { value: this.worldRange }
        };
    }

    /**
     * Update shader uniforms (call after center changes)
     * @param {THREE.ShaderMaterial} material - Material to update
     */
    updateUniforms(material) {
        if (!material?.uniforms) return;

        if (material.uniforms.dirtOverlayCenter) {
            material.uniforms.dirtOverlayCenter.value.set(this.centerX, this.centerZ);
        }
        if (material.uniforms.texDirtOverlay) {
            material.uniforms.texDirtOverlay.value = this.texture;
        }
    }

    /**
     * Dispose of resources
     */
    dispose() {
        if (this.texture) {
            this.texture.dispose();
            this.texture = null;
        }
        this.canvas = null;
        this.ctx = null;
    }
}

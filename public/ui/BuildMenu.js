// File: public/ui/BuildMenu.js
// Location: C:\Users\colli\Desktop\test Horses\Horses\public\ui\BuildMenu.js

/**
 * ==========================================
 * BUILD MENU MODULE
 * ==========================================
 *
 * Complete build menu system extracted from game.js.
 * Handles all build menu UI, structure placement, and construction site creation.
 *
 * RESPONSIBILITIES:
 * - Build menu UI rendering and interaction
 * - Structure definitions and display
 * - Foundation placement system (position phase with scroll/Q/E rotation)
 * - Preview box creation and management
 * - Placement validation
 * - Construction site placement requests
 * - Tooltip management
 *
 * DEPENDENCIES:
 * - THREE.js for 3D preview rendering
 * - ui.js for status updates
 * - CONFIG for build menu configuration
 * - CONFIG for structure dimensions
 * - structureManager for placement validation
 * - terrainGenerator for terrain height queries
 * - networkManager for server communication
 * - scene for adding/removing preview objects
 */

import * as THREE from 'three';
import { ui } from '../ui.js';
import { CONFIG } from '../config.js';
import { CONFIG as TERRAIN_CONFIG } from '../TerrainConfig.js';
import { GridUIHelpers, TooltipHelper } from './GridUIHelpers.js';
import { QualityGenerator } from '../core/QualityGenerator.js';
import ChunkCoordinates from '../core/ChunkCoordinates.js';

export class BuildMenu {
    constructor(dependencies) {
        // Store dependencies
        this.gameState = dependencies.gameState;
        this.scene = dependencies.scene;
        this.terrainGenerator = dependencies.terrainGenerator;
        this.structureManager = dependencies.structureManager;
        this.networkManager = dependencies.networkManager;
        this.inventoryUI = dependencies.inventoryUI;
        this.playerObject = dependencies.playerObject;
        this.audioManager = dependencies.audioManager;

        // Build menu state
        this.buildMenuOpen = false;
        this.buildMenuPickedStructure = null;

        // Build menu configuration
        this.buildMenu = {
            rows: CONFIG.BUILD_MENU.ROWS,          // 10 rows from config
            cols: CONFIG.BUILD_MENU.COLS,          // 5 columns from config
            slotSize: CONFIG.INVENTORY.DEFAULT_SLOT_SIZE,  // 60px, recalculated on resize
            gap: CONFIG.INVENTORY.DEFAULT_GAP,     // 2px gap, recalculated on resize
            // ADDING NEW STRUCTURES - STEP 2: BUILD MENU ENTRY
            // Add your structure definition to this array to make it appear in the build menu.
            // Required fields:
            // - id: Unique identifier for the structure
            // - type: Must match the model name in objects.js MODEL_CONFIG
            // - name: Display name shown to player
            // - width/height: Grid size in build menu (usually 1x1)
            // - imagePath: Path to icon image in ./structures/ folder (64x64 px recommended)
            structures: [
                // Crate structure
                {
                    id: 'crate',
                    type: 'crate',
                    name: 'Crate',
                    width: 1,
                    height: 1,
                    imagePath: './structures/crate.png'
                },
                // Cart structure (towable, no inventory)
                {
                    id: 'cart',
                    type: 'cart',
                    name: 'Cart',
                    width: 1,
                    height: 1,
                    imagePath: './structures/cart.png'
                },
                // Boat structure (water placement, near player)
                {
                    id: 'boat',
                    type: 'boat',
                    name: 'Boat',
                    width: 1,
                    height: 1,
                    imagePath: './structures/boat.png',
                    requiresWater: true
                },
                // Sailboat structure (water placement, larger than boat)
                {
                    id: 'sailboat',
                    type: 'sailboat',
                    name: 'Sailboat',
                    width: 1,
                    height: 1,
                    imagePath: './structures/sailboat.png',
                    requiresWater: true
                },
                // Ship structure (water placement, largest player vessel)
                {
                    id: 'ship2',
                    type: 'ship2',
                    name: 'Ship',
                    width: 1,
                    height: 1,
                    imagePath: './structures/ship.png',
                    requiresWater: true
                },
                // Campfire structure (terrain placement, has inventory)
                {
                    id: 'campfire',
                    type: 'campfire',
                    name: 'Campfire',
                    width: 1,
                    height: 1,
                    imagePath: './structures/campfire.png',
                    hasInventory: true,
                    rotationMode: 'none'  // Cylindrical, rotation meaningless
                },
                // Outpost structure (places on terrain like foundation)
                {
                    id: 'outpost',
                    type: 'outpost',
                    name: 'Outpost',
                    width: 1,
                    height: 1,
                    imagePath: './structures/outpost.png'
                },
                // Tent structure (instant build, has 10x10 inventory)
                {
                    id: 'tent',
                    type: 'tent',
                    name: 'Tent',
                    width: 1,
                    height: 1,
                    imagePath: './structures/tent.png',
                    hasInventory: true
                },
                // Wall structure (simple defensive wall)
                {
                    id: 'wall',
                    type: 'wall',
                    name: 'Wall',
                    width: 1,
                    height: 1,
                    imagePath: './structures/wall.png'
                },
                // Road structure (terrain modification, no rotation, immediate build)
                {
                    id: 'road',
                    type: 'road',
                    name: 'Road',
                    width: 1,
                    height: 1,
                    imagePath: './structures/road.png'
                },
                // House structure (foundation built into model, has inventory)
                {
                    id: 'house',
                    type: 'house',
                    name: 'House',
                    width: 1,
                    height: 1,
                    imagePath: './structures/house.png',
                    hasInventory: true
                },
                // Market structure
                {
                    id: 'market',
                    type: 'market',
                    name: 'Market',
                    width: 1,
                    height: 1,
                    imagePath: './structures/market.png'
                },
                // Dock structure (places on terrain like foundation, 10x1)
                {
                    id: 'dock',
                    type: 'dock',
                    name: 'Dock',
                    width: 1,
                    height: 1,
                    imagePath: './structures/dock.png',
                    rotationMode: 'auto'  // Terrain-determined rotation
                },
                // Woodcutter structure (decorative)
                {
                    id: 'woodcutter',
                    type: 'woodcutter',
                    name: 'Woodcutter',
                    width: 1,
                    height: 1,
                    imagePath: './structures/woodcutter.png'
                },
                // Miner structure (decorative)
                {
                    id: 'miner',
                    type: 'miner',
                    name: 'Miner',
                    width: 1,
                    height: 1,
                    imagePath: './structures/miner.png'
                },
                // Bakery structure (apple to appletart processing)
                {
                    id: 'bakery',
                    type: 'bakery',
                    name: 'Bakery',
                    width: 1,
                    height: 1,
                    imagePath: './structures/bakery.png',
                    hasInventory: true
                },
                // Gardener structure (decorative)
                {
                    id: 'gardener',
                    type: 'gardener',
                    name: 'Gardener',
                    width: 1,
                    height: 1,
                    imagePath: './structures/gardener.png'
                },
                // Fisherman structure (places at water's edge, 2x2)
                {
                    id: 'fisherman',
                    type: 'fisherman',
                    name: 'Fisherman',
                    width: 1,
                    height: 1,
                    imagePath: './structures/fisherman.png',
                    rotationMode: 'auto'  // Terrain-determined rotation
                },
                // Tileworks structure (production building with inventory)
                {
                    id: 'tileworks',
                    type: 'tileworks',
                    name: 'Tileworks',
                    width: 1,
                    height: 1,
                    imagePath: './structures/tileworks.png',
                    hasInventory: true
                },
                // Ironworks structure (iron to ironingot processing)
                {
                    id: 'ironworks',
                    type: 'ironworks',
                    name: 'Ironworks',
                    width: 1,
                    height: 1,
                    imagePath: './structures/ironworks.png',
                    hasInventory: true
                },
                // Blacksmith structure (ironingot to parts processing)
                {
                    id: 'blacksmith',
                    type: 'blacksmith',
                    name: 'Blacksmith',
                    width: 1,
                    height: 1,
                    imagePath: './structures/blacksmith.png',
                    hasInventory: true
                },
                // Stonemason structure (decorative, 2x2)
                {
                    id: 'stonemason',
                    type: 'stonemason',
                    name: 'Stonemason',
                    width: 1,
                    height: 1,
                    imagePath: './structures/stonemason.png'
                },
                // Warehouse structure (stores up to 4 crates)
                {
                    id: 'warehouse',
                    type: 'warehouse',
                    name: 'Warehouse',
                    width: 1,
                    height: 1,
                    imagePath: './structures/warehouse.png'
                },
                // Plantable trees (require seeds)
                {
                    id: 'planted_pine',
                    type: 'planted_pine',
                    name: 'Pine Tree',
                    width: 1,
                    height: 1,
                    imagePath: './structures/pinetree.png',
                    isPlantable: true,
                    seedType: 'pineseed',
                    treeType: 'pine',
                    rotationMode: 'none'  // Billboard, no rotation
                },
                {
                    id: 'planted_apple',
                    type: 'planted_apple',
                    name: 'Apple Tree',
                    width: 1,
                    height: 1,
                    imagePath: './structures/appletree.png',
                    isPlantable: true,
                    seedType: 'appleseed',
                    treeType: 'apple',
                    rotationMode: 'none'  // Billboard, no rotation
                },
                {
                    id: 'planted_vegetables',
                    type: 'planted_vegetables',
                    name: 'Vegetables',
                    width: 1,
                    height: 1,
                    imagePath: './structures/vegetables.png',
                    isPlantable: true,
                    seedType: 'vegetableseeds',
                    treeType: 'vegetables',
                    rotationMode: 'none'  // Billboard, no rotation
                },
                {
                    id: 'planted_hemp',
                    type: 'planted_hemp',
                    name: 'Hemp',
                    width: 1,
                    height: 1,
                    imagePath: './structures/hemp.png',
                    isPlantable: true,
                    seedType: 'hempseeds',
                    treeType: 'hemp',
                    rotationMode: 'none'  // Billboard, no rotation
                },
                // Artillery (towable by horse only, has shell inventory)
                {
                    id: 'artillery',
                    type: 'artillery',
                    name: 'Artillery',
                    width: 1,
                    height: 1,
                    imagePath: './structures/artillery.png',
                    hasInventory: true
                }
            ]
        };

        // Structure placement state
        this.structurePlacement = {
            active: false,
            phase: null,  // 'position' -> 'confirmed' (rotation during position phase)
            structure: null,
            position: { x: 0, y: 0, z: 0 },
            rotation: Math.PI / 4,  // Radians (45 degrees, snaps to 15° increments)
            previewBox: null,
            isValid: false,
            invalidReason: '',
            validationPending: false  // True during mouse movement, false after validation
        };

        // Rotation throttle for scroll wheel
        this.rotationThrottle = { lastTime: 0, minInterval: 50 };

        // Validation timeout (class field for cancellation)
        this.validationTimeout = null;

        // Debounced validation function
        this.validateStructurePlacementDebounced = this.createDebouncedValidation();

        // Setup close button listener
        this.setupCloseButton();

        // Preload structure images so they display instantly when menu opens
        this.preloadImages();
    }

    /**
     * Preload all structure images during initialization
     * This ensures images are browser-cached before the build menu is opened
     */
    preloadImages() {
        this.buildMenu.structures.forEach(structure => {
            const img = new Image();
            img.src = structure.imagePath;
        });
    }

    /**
     * Creates a debounced validation function that runs after mouse movement stops
     * Uses this.validationTimeout for external cancellation (e.g., during rotation)
     */
    createDebouncedValidation() {
        return () => {
            // Clear any pending validation
            if (this.validationTimeout) {
                clearTimeout(this.validationTimeout);
            }

            // Set validation pending state (will show white glow)
            this.structurePlacement.validationPending = true;

            // Schedule new validation after 180ms of inactivity
            this.validationTimeout = setTimeout(() => {
                this.validationTimeout = null;
                this.runValidation();
            }, 180);
        };
    }

    /**
     * Get rotation mode for current structure
     * @returns {'manual'|'auto'|'none'}
     */
    getRotationMode() {
        const structure = this.structurePlacement?.structure;
        if (!structure) return 'none';
        if (structure.rotationMode) return structure.rotationMode;
        if (structure.isPlantable) return 'none';  // Legacy fallback
        return 'manual';
    }

    /**
     * Handle scroll wheel input for rotation
     * @param {number} scrollDelta - Raw scroll delta (positive = down)
     * @returns {boolean} - True if handled (prevents camera zoom)
     */
    handleScrollRotation(scrollDelta) {
        if (!this.structurePlacement?.active) return false;
        if (this.getRotationMode() !== 'manual') return false;

        // Throttle rapid scrolling
        const now = Date.now();
        if (now - this.rotationThrottle.lastTime < this.rotationThrottle.minInterval) {
            return true;  // Handled but throttled
        }
        this.rotationThrottle.lastTime = now;

        // Convert increment from degrees config to radians
        const incrementDeg = CONFIG.CONSTRUCTION.ROTATION_INCREMENT || 15;
        const incrementRad = incrementDeg * Math.PI / 180;
        const delta = scrollDelta > 0 ? incrementRad : -incrementRad;
        this.applyRotation(delta);
        return true;
    }

    /**
     * Handle Q/E key input for rotation
     * @param {string} key - 'q' or 'e'
     * @returns {boolean} - True if handled
     */
    handleKeyRotation(key) {
        if (!this.structurePlacement?.active) return false;
        if (this.getRotationMode() !== 'manual') return false;

        // Convert increment from degrees config to radians
        const incrementDeg = CONFIG.CONSTRUCTION.ROTATION_INCREMENT || 15;
        const incrementRad = incrementDeg * Math.PI / 180;
        const delta = (key === 'q' || key === 'Q') ? incrementRad : -incrementRad;
        this.applyRotation(delta);
        return true;
    }

    /**
     * Apply rotation delta to current placement
     * @param {number} delta - Rotation change in radians
     */
    applyRotation(delta) {
        const placement = this.structurePlacement;

        // Clear any pending debounced validation
        if (this.validationTimeout) {
            clearTimeout(this.validationTimeout);
            this.validationTimeout = null;
        }

        // Normalize rotation to 0 to 2*PI radians
        const TWO_PI = Math.PI * 2;
        let newRotation = (placement.rotation || 0) + delta;
        newRotation = ((newRotation % TWO_PI) + TWO_PI) % TWO_PI;
        placement.rotation = newRotation;

        // Update preview visual (already radians)
        if (placement.previewBox) {
            placement.previewBox.rotation.y = newRotation;
        }

        // Note: Collision validation uses placement.rotation directly via
        // validateStructurePlacement() → testShapeOverlap(). No separate bounds update needed.

        // Recalculate height and validate
        this.recalculateHeightForRotation();
        this.runValidation();
    }

    /**
     * Run validation immediately and update UI
     */
    runValidation() {
        const placement = this.structurePlacement;
        placement.validationPending = false;

        const result = this.structureManager.validateStructurePlacement(
            placement,
            placement.phase,
            this.playerObject ? this.playerObject.position : null
        );

        placement.isValid = result.isValid;
        placement.invalidReason = result.invalidReason;

        this.structureManager.updateStructurePreviewColors(placement, ui);
        this.updatePlacementStatusMessage();
    }

    /**
     * Update placement status message based on current state
     */
    updatePlacementStatusMessage() {
        const placement = this.structurePlacement;
        if (!placement.active) return;

        if (!placement.isValid) {
            const distSuffix = this._getMarketDistanceSuffix(placement);
            ui.updatePlacementStatus(placement.invalidReason + distSuffix, false);
            return;
        }

        const mode = this.getRotationMode();
        const distSuffix = this._getMarketDistanceSuffix(placement);

        if (mode === 'manual') {
            ui.updatePlacementStatus('Scroll/Q/E to rotate - Click to place' + distSuffix, true);
        } else {
            ui.updatePlacementStatus('Click to place' + distSuffix, true);
        }
    }

    /**
     * Get market distance suffix for placement status (only for worker/dock structures)
     */
    _getMarketDistanceSuffix(placement) {
        const type = placement.structure?.type;
        if (!type) return '';

        // Market placement: show dock distance
        if (type === 'market') {
            const dist = this._findNearestDockDistance(placement.position);
            if (dist === null) return ' | <span style="color:#FF6B6B">No dock nearby</span>';
            const rounded = Math.round(dist);
            if (rounded >= 20) return ` | <span style="color:#FF6B6B">Dock: ${rounded}/20</span>`;
            return ` | Dock: ${rounded}/20`;
        }

        const MARKET_STRUCTURES = ['tileworks', 'ironworks', 'blacksmith', 'bakery', 'gardener', 'miner', 'woodcutter', 'stonemason', 'fisherman', 'dock'];
        if (!MARKET_STRUCTURES.includes(type)) return '';

        const dist = this._findNearestMarketDistance(placement.position);
        if (dist === null) return ' | <span style="color:#FF6B6B">No market nearby</span>';
        const rounded = Math.round(dist);
        if (rounded >= 20) return ` | <span style="color:#FF6B6B">Market: ${rounded}/20</span>`;
        return ` | Market: ${rounded}/20`;
    }

    /**
     * Find distance to nearest market from a world position (2D, ignoring Y)
     */
    _findNearestMarketDistance(position) {
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(position.x, position.z);
        let nearestDistSq = Infinity;

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = `${chunkX + dx},${chunkZ + dz}`;
                const markets = this.gameState?.getMarketsInChunk(key) || [];
                for (let i = 0; i < markets.length; i++) {
                    const market = markets[i];
                    const mdx = market.position.x - position.x;
                    const mdz = market.position.z - position.z;
                    const distSq = mdx * mdx + mdz * mdz;
                    if (distSq < nearestDistSq) {
                        nearestDistSq = distSq;
                    }
                }
            }
        }

        return nearestDistSq === Infinity ? null : Math.sqrt(nearestDistSq);
    }

    /**
     * Find distance to nearest dock from a world position (2D, ignoring Y)
     */
    _findNearestDockDistance(position) {
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(position.x, position.z);
        let nearestDistSq = Infinity;

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = `${chunkX + dx},${chunkZ + dz}`;
                const docks = this.gameState?.docks?.get(key) || [];
                for (let i = 0; i < docks.length; i++) {
                    const dock = docks[i];
                    const ddx = dock.x - position.x;
                    const ddz = dock.z - position.z;
                    const distSq = ddx * ddx + ddz * ddz;
                    if (distSq < nearestDistSq) {
                        nearestDistSq = distSq;
                    }
                }
            }
        }

        return nearestDistSq === Infinity ? null : Math.sqrt(nearestDistSq);
    }

    /**
     * Recalculate structure height based on current rotation
     * (Extracted from existing onRotationChange logic)
     */
    recalculateHeightForRotation() {
        const placement = this.structurePlacement;
        const structure = placement.structure;
        if (!structure) return;

        // Roads use exact terrain height
        if (structure.type === 'road') {
            const terrainHeight = this.terrainGenerator.getWorldHeight(
                placement.position.x, placement.position.z
            );
            placement.position.y = terrainHeight + 0.02;
            if (placement.previewBox) {
                placement.previewBox.position.y = placement.position.y;
            }
            return;
        }

        // Skip for structures that don't need height recalc (auto/none modes handled elsewhere)
        const mode = this.getRotationMode();
        if (mode === 'auto' || mode === 'none') return;

        const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[structure.type];
        if (!dims || !dims.width) return;

        // Market has special 3-point sampling
        if (structure.type === 'market') {
            const rotation = placement.rotation || 0; // Radians
            const cos = Math.cos(rotation);
            const sin = Math.sin(rotation);

            // Sample 3 points along depth axis
            const samplePoints = [
                { dx: 0, dz: 0 },
                { dx: 5 * sin, dz: 5 * cos },
                { dx: -5 * sin, dz: -5 * cos }
            ];

            let maxHeight = -Infinity;
            for (const point of samplePoints) {
                const height = this.terrainGenerator.getWorldHeight(
                    placement.position.x + point.dx,
                    placement.position.z + point.dz
                );
                if (height > maxHeight) maxHeight = height;
            }

            let snappedHeight = Math.ceil(maxHeight / 0.25) * 0.25;
            if (snappedHeight < CONFIG.WATER.LEVEL) {
                snappedHeight = Math.max(CONFIG.WATER.LEVEL + 0.5, 0.5);
            }

            placement.position.y = snappedHeight;
            if (placement.previewBox) {
                placement.previewBox.position.y = snappedHeight;
            }
            return;
        }

        // Standard 4-corner sampling for other rectangular structures
        const rotation = placement.rotation || 0; // Radians
        const halfWidth = dims.width / 2;
        const halfDepth = dims.depth / 2;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);

        const corners = [
            { dx: -halfWidth, dz: -halfDepth },
            { dx: halfWidth, dz: -halfDepth },
            { dx: -halfWidth, dz: halfDepth },
            { dx: halfWidth, dz: halfDepth }
        ];

        let maxHeight = -Infinity;
        for (const corner of corners) {
            const rotatedX = corner.dx * cos - corner.dz * sin;
            const rotatedZ = corner.dx * sin + corner.dz * cos;
            const cornerHeight = this.terrainGenerator.getWorldHeight(
                placement.position.x + rotatedX,
                placement.position.z + rotatedZ
            );
            if (cornerHeight > maxHeight) maxHeight = cornerHeight;
        }

        let snappedHeight = Math.ceil(maxHeight / 0.25) * 0.25;
        if (snappedHeight < CONFIG.WATER.LEVEL) {
            snappedHeight = Math.max(CONFIG.WATER.LEVEL + 0.5, 0.5);
        }

        placement.position.y = snappedHeight;
        if (placement.previewBox) {
            placement.previewBox.position.y = snappedHeight;
        }
    }

    /**
     * Check if a material is a plank type
     * @param {string} material - Material type to check
     * @returns {boolean}
     */
    isPlankType(material) {
        return material === 'oakplank' ||
               material === 'pineplank' ||
               material === 'firplank' ||
               material === 'cypressplank' ||
               material === 'appleplank';
    }

    /**
     * Check if a material is a raw stone type (limestone or sandstone)
     * @param {string} material - Material type to check
     * @returns {boolean}
     */
    isRawStone(material) {
        return material === 'limestone' || material === 'sandstone';
    }

    /**
     * Check if a material is a chiseled stone type
     * @param {string} material - Material type to check
     * @returns {boolean}
     */
    isChiseledStone(material) {
        return material === 'chiseledlimestone' || material === 'chiseledsandstone';
    }

    /**
     * Check if player has required materials for a structure
     * @param {object} structure - The structure to check
     * @returns {object} - {hasRequired: boolean, missing: string[]}
     */
    checkRequiredMaterials(structure) {
        // Special handling for plantable trees - they require seeds
        if (structure.isPlantable && structure.seedType) {
            const hasSeed = this.gameState.inventory.items.some(
                item => item.type === structure.seedType
            );

            return {
                hasRequired: hasSeed,
                missing: hasSeed ? [] : [structure.seedType]
            };
        }

        // Get material requirements from CONFIG
        const required = CONFIG.CONSTRUCTION.MATERIALS[structure.type];

        // If no materials required, allow building
        if (!required) {
            return { hasRequired: true, missing: [] };
        }

        const missing = [];

        // Check each required material
        for (const [materialType, quantity] of Object.entries(required)) {
            let playerQuantity = 0;

            // If required material is a plank type, count ALL plank types
            if (this.isPlankType(materialType)) {
                playerQuantity = this.gameState.inventory.items.filter(
                    item => this.isPlankType(item.type)
                ).length;
            // If required material is raw stone, count ALL raw stone types
            } else if (this.isRawStone(materialType)) {
                playerQuantity = this.gameState.inventory.items.filter(
                    item => this.isRawStone(item.type)
                ).length;
            // If required material is chiseled stone, count ALL chiseled stone types
            } else if (this.isChiseledStone(materialType)) {
                playerQuantity = this.gameState.inventory.items.filter(
                    item => this.isChiseledStone(item.type)
                ).length;
            } else {
                // For other materials, check exact type
                playerQuantity = this.gameState.inventory.items.filter(
                    item => item.type === materialType
                ).length;
            }

            if (playerQuantity < quantity) {
                missing.push(materialType);
            }
        }

        return {
            hasRequired: missing.length === 0,
            missing: missing
        };
    }

    /**
     * Setup the close button listener for the build menu
     */
    setupCloseButton() {
        const closeBtn = document.getElementById('buildMenuCloseBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.toggleBuildMenu();
            });
        }
    }

    /**
     * Toggle the build menu open/closed
     */
    toggleBuildMenu() {
        // Cancel any active placement before opening menu
        if (this.isPlacementActive()) {
            this.cancelStructurePlacement();
        }

        // Close inventory if open (only one menu at a time)
        if (this.gameState.inventoryOpen) {
            this.inventoryUI.toggleInventory();
        }

        this.buildMenuOpen = !this.buildMenuOpen;
        this.gameState.buildMenuOpen = this.buildMenuOpen;
        const overlay = document.getElementById('buildMenuOverlay');

        if (this.buildMenuOpen) {
            // Cancel auto-run when opening build menu
            this.game?.inputManager?.cancelAutoRun();
            this.calculateBuildMenuSize(); // Recalculate on open
            overlay.style.display = 'flex';
            this.renderBuildMenu();
        } else {
            overlay.style.display = 'none';
        }
    }

    /**
     * Calculate build menu slot sizes based on screen size
     */
    calculateBuildMenuSize() {
        const { slotSize, gap } = GridUIHelpers.calculateGridSize(this.buildMenu.rows);
        this.buildMenu.slotSize = slotSize;
        this.buildMenu.gap = gap;
        this.gameState.buildMenu = this.buildMenu;
    }

    /**
     * Render the build menu grid and structures
     */
    renderBuildMenu() {
        const structuresContainer = document.getElementById('buildMenuStructures');
        const buildMenuGrid = document.getElementById('buildMenuGrid');
        structuresContainer.innerHTML = ''; // Clear existing

        // Update grid styling dynamically
        const { slotSize, gap, rows, cols } = this.buildMenu;
        GridUIHelpers.applyGridStyling(buildMenuGrid, rows, cols, slotSize, gap);

        // Update slot styling
        const slots = buildMenuGrid.querySelectorAll('.build-menu-slot');
        slots.forEach(slot => {
            slot.style.width = `${slotSize}px`;
            slot.style.height = `${slotSize}px`;
        });

        // Render structures at fixed positions
        this.buildMenu.structures.forEach((structure, index) => {
            // Check if player has required materials
            const materialCheck = this.checkRequiredMaterials(structure);

            // Create wrapper
            const structureWrapper = document.createElement('div');
            structureWrapper.className = 'build-menu-structure-wrapper';
            structureWrapper.dataset.structureId = structure.id;
            structureWrapper.style.position = 'absolute';

            // Add disabled class if missing materials
            if (!materialCheck.hasRequired) {
                structureWrapper.classList.add('build-menu-structure-disabled');
            }

            // Store material check for tooltip
            structureWrapper.dataset.hasRequired = materialCheck.hasRequired;
            structureWrapper.dataset.missing = JSON.stringify(materialCheck.missing);

            // Place structures in a grid pattern (row by row)
            const x = index % cols;
            const y = Math.floor(index / cols);

            // Calculate pixel position
            const { x: pixelX, y: pixelY } = GridUIHelpers.gridToPixel(x, y, slotSize, gap);
            structureWrapper.style.left = pixelX + 'px';
            structureWrapper.style.top = pixelY + 'px';

            // Create image element
            const structureEl = document.createElement('img');
            structureEl.src = structure.imagePath;
            structureEl.className = 'build-menu-structure';
            structureEl.style.position = 'relative';

            // Calculate size based on slots
            const { widthPx, heightPx } = GridUIHelpers.calculateItemSize(structure.width, structure.height, slotSize, gap);

            structureEl.style.width = widthPx + 'px';
            structureEl.style.height = heightPx + 'px';
            structureWrapper.style.width = widthPx + 'px';
            structureWrapper.style.height = heightPx + 'px';

            // Add click event listener
            structureWrapper.addEventListener('click', (e) => this.onStructureClick(e, structure));

            // Add hover event listeners for tooltip
            structureWrapper.addEventListener('mouseenter', (e) => this.showBuildMenuTooltip(e, structure));
            structureWrapper.addEventListener('mousemove', (e) => this.updateBuildMenuTooltipPosition(e));
            structureWrapper.addEventListener('mouseleave', () => this.hideBuildMenuTooltip());

            // Assemble
            structureWrapper.appendChild(structureEl);
            structuresContainer.appendChild(structureWrapper);
        });
    }

    /**
     * Handle structure click in build menu
     */
    async onStructureClick(event, structure) {
        event.preventDefault();
        event.stopPropagation();

        // Check if player has required materials
        const materialCheck = this.checkRequiredMaterials(structure);
        if (!materialCheck.hasRequired) {
            // Format missing materials for display - replace plank types with generic "plank"
            const missingText = materialCheck.missing
                .map(mat => {
                    if (this.isPlankType(mat)) {
                        return 'plank (any type)';
                    }
                    return mat.replace(/([A-Z])/g, ' $1').trim();
                })
                .join(', ');
            ui.showToast(`Missing materials: ${missingText}`, 'warning');
            return; // Block placement
        }

        // Show warning when building a house - players can only own one
        if (structure.type === 'house') {
            const confirmed = await ui.showConfirmDialog(
                'Building a house will make it your home spawn point.\n\n' +
                'You can only own ONE house at a time. If you already own a house, ' +
                'it will become unowned and accessible to anyone when this one is completed.\n\n' +
                'Continue?'
            );
            if (!confirmed) {
                return; // User cancelled
            }
        }


        // Show placement tips once per structure type (stored in localStorage)
        const tipKey = `placementTip_${structure.type}`;
        const hasSeenTip = localStorage.getItem(tipKey);

        if (!hasSeenTip) {
            let tipMessage = null;

            if (structure.type === 'dock') {
                tipMessage =
                    'Dock Placement Tips\n\n' +
                    '- Must be placed on a shoreline (where land meets water)\n' +
                    '- Rotation is automatically detected based on the shore\n' +
                    '- Requires 50 units of deep water with no islands in the ship lane direction\n' +
                    '- Ships will arrive every 30 minutes to trade\n\n' +
                    'Place a Market within 20 units to enable trading.\n\n' +
                    'Continue?';
            } else if (structure.type === 'market') {
                tipMessage =
                    'Market Placement Tips\n\n' +
                    '- Place within 20 units of a Dock to enable ship trading\n' +
                    '- Ships arrive every 30 minutes and buy/sell materials through the market\n' +
                    '- Nearby Bakeries and Gardeners (within 20 units) will spawn workers when ships arrive\n\n' +
                    'Without a dock connection, the market will still function as storage but ships cannot trade.\n\n' +
                    'Continue?';
            } else if (structure.type === 'bakery') {
                tipMessage =
                    'Bakery Placement Tips\n\n' +
                    '- Place within 20 units of a Market to spawn a Baker\n' +
                    '- The Baker collects apples, bakes apple tarts, and delivers them to the market\n' +
                    '- Baker spawns when a trade ship arrives (every 30 minutes)\n\n' +
                    'Placement chain: Dock -> Market -> Bakery (each within 20 units)\n\n' +
                    'Continue?';
            } else if (structure.type === 'gardener') {
                tipMessage =
                    'Gardener Placement Tips\n\n' +
                    '- Place within 20 units of a Market to spawn a Gardener\n' +
                    '- The Gardener tends nearby gardens and delivers vegetables to the market\n' +
                    '- Gardener spawns when a trade ship arrives (every 30 minutes)\n\n' +
                    'Placement chain: Dock -> Market -> Gardener (each within 20 units)\n\n' +
                    'Continue?';
            } else if (structure.type === 'fisherman') {
                tipMessage =
                    'Fisherman Placement Tips\n\n' +
                    '- Place within 20 units of a Market to spawn a Fisherman\n' +
                    '- The Fisherman catches fish and delivers them to the market\n' +
                    '- Fisherman spawns when a trade ship arrives (every 30 minutes)\n\n' +
                    'Placement chain: Dock -> Market -> Fisherman (each within 20 units)\n\n' +
                    'Continue?';
            } else if (structure.type === 'woodcutter') {
                tipMessage =
                    'Woodcutter Placement Tips\n\n' +
                    '- Place within 20 units of a Market to spawn a Woodcutter\n' +
                    '- The Woodcutter chops trees and delivers logs to the market\n' +
                    '- Woodcutter spawns when a trade ship arrives (every 30 minutes)\n\n' +
                    'Placement chain: Dock -> Market -> Woodcutter (each within 20 units)\n\n' +
                    'Continue?';
            } else if (structure.type === 'miner') {
                tipMessage =
                    'Miner Placement Tips\n\n' +
                    '- Place within 20 units of a Market to spawn a Miner\n' +
                    '- The Miner extracts ore and delivers it to the market\n' +
                    '- Miner spawns when a trade ship arrives (every 30 minutes)\n\n' +
                    'Placement chain: Dock -> Market -> Miner (each within 20 units)\n\n' +
                    'Continue?';
            } else if (structure.type === 'stonemason') {
                tipMessage =
                    'Stonemason Placement Tips\n\n' +
                    '- Place within 20 units of a Market to spawn a Stonemason\n' +
                    '- The Stonemason quarries stone and delivers it to the market\n' +
                    '- Stonemason spawns when a trade ship arrives (every 30 minutes)\n\n' +
                    'Placement chain: Dock -> Market -> Stonemason (each within 20 units)\n\n' +
                    'Continue?';
            } else if (structure.type === 'tileworks') {
                tipMessage =
                    'Tileworks Placement Tips\n\n' +
                    '- Add clay and firewood to the inventory\n' +
                    '- Clay is processed into tiles (1 minute each)\n' +
                    '- Tiles are used for building advanced structures\n\n' +
                    'Continue?';
            } else if (structure.type === 'ironworks') {
                tipMessage =
                    'Ironworks Placement Tips\n\n' +
                    '- Add iron ore and firewood to the inventory\n' +
                    '- Iron is smelted into iron ingots (1 minute each)\n' +
                    '- Iron ingots can be processed at a Blacksmith\n\n' +
                    'Continue?';
            } else if (structure.type === 'blacksmith') {
                tipMessage =
                    'Blacksmith Placement Tips\n\n' +
                    '- Add iron ingots and firewood to the inventory\n' +
                    '- Iron ingots are forged into parts (1 minute each)\n' +
                    '- Parts are used for building advanced items\n\n' +
                    'Continue?';
            }

            if (tipMessage) {
                const confirmed = await ui.showConfirmDialog(tipMessage);
                localStorage.setItem(tipKey, 'true');
                if (!confirmed) {
                    return; // User cancelled
                }
            }
        }

        // Pick up the structure for placement
        this.buildMenuPickedStructure = structure;

        // Close build menu
        this.toggleBuildMenu();

        // Start structure placement flow
        this.startStructurePlacement(structure);
    }

    /**
     * Show tooltip for structure
     */
    showBuildMenuTooltip(event, structure) {
        const tooltip = document.getElementById('buildMenuTooltip');
        const titleEl = tooltip.querySelector('.tooltip-title');

        // Check if structure has required materials
        const wrapper = event.currentTarget;
        const hasRequired = wrapper.dataset.hasRequired === 'true';
        const missing = JSON.parse(wrapper.dataset.missing || '[]');

        // Set content
        titleEl.textContent = structure.name;

        // Add or remove missing materials warning
        let warningEl = tooltip.querySelector('.tooltip-warning');
        if (!hasRequired) {
            // Create warning element if it doesn't exist
            if (!warningEl) {
                warningEl = document.createElement('div');
                warningEl.className = 'tooltip-warning';
                warningEl.style.color = '#ff4444';
                warningEl.style.fontSize = '12px';
                warningEl.style.marginTop = '4px';
                tooltip.appendChild(warningEl);
            }
            // Format missing materials list - replace plank types with generic "plank"
            const missingText = missing.map(mat => {
                if (this.isPlankType(mat)) {
                    return 'plank (any type)';
                }
                return mat.replace(/([A-Z])/g, ' $1').trim();
            }).join(', ');
            warningEl.textContent = `Missing: ${missingText}`;
            warningEl.style.display = 'block';
        } else if (warningEl) {
            warningEl.style.display = 'none';
        }

        // Position and show tooltip
        TooltipHelper.show('buildMenuTooltip', event);
    }

    /**
     * Update tooltip position to follow cursor
     */
    updateBuildMenuTooltipPosition(event) {
        TooltipHelper.updatePosition('buildMenuTooltip', event);
    }

    /**
     * Hide tooltip
     */
    hideBuildMenuTooltip() {
        TooltipHelper.hide('buildMenuTooltip');
    }

    // ==========================================
    // STRUCTURE PLACEMENT SYSTEM
    // ==========================================

    /**
     * Start the structure placement flow
     * Creates a simple shape preview (box or cylinder) and enters position phase
     */
    startStructurePlacement(structure) {
        this.structurePlacement.active = true;
        this.structurePlacement.phase = 'position';
        this.structurePlacement.structure = structure;

        // Set initial rotation based on mode (all in radians)
        const mode = structure.rotationMode || (structure.isPlantable ? 'none' : 'manual');
        if (mode === 'none') {
            this.structurePlacement.rotation = 0;
        } else if (mode === 'auto') {
            // Auto-rotation will be set by StructureManager during preview update
            // Default to 0 for dock, 0 for fisherman (will be overwritten)
            this.structurePlacement.rotation = 0;
        } else {
            // Manual rotation - start at 45 degrees (PI/4 radians)
            this.structurePlacement.rotation = Math.PI / 4;
        }

        this.structurePlacement.validationPending = true;  // Show white glow initially
        this.structurePlacement.isValid = false;  // Initialize to false - must validate first
        this.structurePlacement.invalidReason = 'Not validated yet';

        const previewGroup = new THREE.Group();

        // Get dimensions from config
        const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[structure.type];

        // Use structure's configured height, defaulting to 2.0 for structures without explicit height
        const PREVIEW_HEIGHT = (dims && dims.height) ? dims.height : 2.0;

        // Determine if cylindrical (has radius) or rectangular (has width/depth)
        const isCylindrical = dims && dims.radius !== undefined;

        // Create semi-transparent material (more see-through like road preview)
        const previewMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,  // White initially (validation pending)
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: true
        });

        let previewMesh;

        if (structure.type === 'road') {
            // Pill-shaped preview for roads (rectangle with fully rounded ends)
            const width = dims.width || 1.0;
            const depth = dims.depth || 2.0;
            const bodyLength = depth - width;  // Center section length
            const roadPreviewHeight = 2.0;  // Override height: 2 units tall, centered on mouse

            const shape = new THREE.Shape();
            const halfW = width / 2;
            const halfBody = bodyLength / 2;

            // Draw pill shape - start top-left, go clockwise
            shape.moveTo(-halfBody, -halfW);
            shape.lineTo(halfBody, -halfW);
            // Right semicircle
            shape.absarc(halfBody, 0, halfW, -Math.PI / 2, Math.PI / 2, false);
            shape.lineTo(-halfBody, halfW);
            // Left semicircle
            shape.absarc(-halfBody, 0, halfW, Math.PI / 2, Math.PI * 1.5, false);
            shape.closePath();

            const geometry = new THREE.ExtrudeGeometry(shape, {
                depth: roadPreviewHeight,
                bevelEnabled: false
            });
            // Rotate so extrusion goes up (Y) instead of forward (Z)
            geometry.rotateX(-Math.PI / 2);

            // Center geometry fully (1 unit above ground, 1 unit below)
            geometry.computeBoundingBox();
            const center = new THREE.Vector3();
            geometry.boundingBox.getCenter(center);
            geometry.translate(-center.x, -center.y, -center.z);
            // Keep centered at y=0 (don't shift up like other structures)

            // More transparent material for road preview
            const roadPreviewMaterial = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.25,  // More see-through than default 0.4
                side: THREE.DoubleSide,
                depthWrite: false,
                depthTest: true
            });

            previewMesh = new THREE.Mesh(geometry, roadPreviewMaterial);
        } else if (isCylindrical) {
            // Cylindrical preview (campfire, plantable trees)
            const radius = dims.radius;
            const geometry = new THREE.CylinderGeometry(radius, radius, PREVIEW_HEIGHT, 16);

            // Center geometry at y=0 (half above ground, half below - like road preview)
            geometry.computeBoundingBox();
            const center = new THREE.Vector3();
            geometry.boundingBox.getCenter(center);
            geometry.translate(-center.x, -center.y, -center.z);

            previewMesh = new THREE.Mesh(geometry, previewMaterial);
        } else if (structure.type === 'wall') {
            // Wall preview: match model geometry (x=0 to x=1, center at y=-1)
            // Model is 3 units high, spans y=-2.5 to y=+0.5, center at y=-1
            const width = dims.width || 1;
            const depth = dims.depth || 0.1;
            const geometry = new THREE.BoxGeometry(width, PREVIEW_HEIGHT, depth);

            // Position geometry to span x=0 to x=1 (shift +0.5 in X)
            // and center at y=-1 (so it spans y=-2.5 to y=+0.5)
            geometry.translate(0.5, -1, 0);

            previewMesh = new THREE.Mesh(geometry, previewMaterial);
        } else if (dims) {
            // Rectangular preview (most structures)
            const width = dims.width || 1;
            const depth = dims.depth || 1;
            const geometry = new THREE.BoxGeometry(width, PREVIEW_HEIGHT, depth);

            // Center geometry at y=0 (half above ground, half below - like road preview)
            geometry.computeBoundingBox();
            const center = new THREE.Vector3();
            geometry.boundingBox.getCenter(center);
            geometry.translate(-center.x, -center.y, -center.z);

            previewMesh = new THREE.Mesh(geometry, previewMaterial);
        } else {
            // Fallback: 1x1 box
            const geometry = new THREE.BoxGeometry(1, PREVIEW_HEIGHT, 1);

            // Center geometry at y=0 (half above ground, half below - like road preview)
            geometry.computeBoundingBox();
            const center = new THREE.Vector3();
            geometry.boundingBox.getCenter(center);
            geometry.translate(-center.x, -center.y, -center.z);

            previewMesh = new THREE.Mesh(geometry, previewMaterial);
        }

        previewMesh.renderOrder = 500;
        previewGroup.add(previewMesh);

        // Add front indicator arrow (points in +X direction = front in Blender)
        // Skip for cylindrical structures (campfire, trees) and roads which have no directional front
        if (!isCylindrical && structure.type !== 'road') {
            const arrowLength = 0.4;
            const arrowRadius = 0.15;
            const arrowGeometry = new THREE.ConeGeometry(arrowRadius, arrowLength, 8);
            // Cone points up by default, rotate to point +X
            arrowGeometry.rotateZ(-Math.PI / 2);

            const arrowMaterial = new THREE.MeshBasicMaterial({
                color: 0xC9A861,  // Gold color to stand out
                transparent: true,
                opacity: 0.8,
                depthWrite: false,
                depthTest: true
            });

            const arrowMesh = new THREE.Mesh(arrowGeometry, arrowMaterial);

            // Position arrow at front edge (+X side)
            // Wall geometry is offset by 0.5 in X (spans x=0 to x=1), so front is at x=1
            let frontOffset;
            if (structure.type === 'wall') {
                frontOffset = (dims && dims.width) ? dims.width : 1.0;  // Wall front edge at x=width
            } else {
                frontOffset = (dims && dims.width) ? dims.width / 2 : 0.5;  // Centered structures
            }
            arrowMesh.position.set(frontOffset + arrowLength / 2, PREVIEW_HEIGHT / 2, 0);
            arrowMesh.renderOrder = 501;
            previewGroup.add(arrowMesh);
        }

        // Add field preview for gardener (visual hint for planting area)
        if (structure.type === 'gardener' && dims.field) {
            const FIELD_HEIGHT = 2.0;  // Taller box so it's visible above terrain
            const fieldGeometry = new THREE.BoxGeometry(
                dims.field.width,
                FIELD_HEIGHT,
                dims.field.depth
            );
            const fieldMaterial = new THREE.MeshBasicMaterial({
                color: 0x44aa44,  // Green
                transparent: true,
                opacity: 0.3,
                depthWrite: false
            });
            const fieldMesh = new THREE.Mesh(fieldGeometry, fieldMaterial);
            // Position centered vertically (half above, half below terrain level)
            fieldMesh.position.set(0, 0, dims.field.offsetZ);
            fieldMesh.renderOrder = 499;
            previewGroup.add(fieldMesh);
        }

        // Store references
        this.structurePlacement.previewBox = previewGroup;
        this.structurePlacement.previewBox.userData.previewMesh = previewMesh;
        this.structurePlacement.previewBox.userData.modelType = structure.type;
        this.structurePlacement.previewBox.userData.isPreview = true;
        this.structurePlacement.previewBox.userData.isCylindrical = isCylindrical;

        // Add to scene
        previewGroup.visible = true;
        this.scene.add(previewGroup);

        // Apply initial rotation (already in radians)
        previewGroup.rotation.y = this.structurePlacement.rotation;

        // Set status message
        if (structure.type === 'road') {
            ui.updatePlacementStatus('Click to position road, then rotate');
        } else if (structure.isPlantable) {
            ui.updatePlacementStatus(`Click to plant ${structure.name} (within 1 unit of player)`);
        } else {
            ui.updatePlacementStatus('Move mouse to position structure, click to confirm');
        }
    }

    /**
     * Advance to the next placement phase
     * Single phase: position -> confirmed (rotation during position phase via scroll/Q/E)
     */
    advanceStructurePlacementPhase(mouseY) {
        const placement = this.structurePlacement;
        if (!placement.active) return;

        if (placement.phase === 'position') {
            // Trust existing validation state - no re-validation needed
            // Validation already ran from mouse move or rotation
            if (!placement.isValid) {
                // Already invalid - status already shows reason
                return;
            }

            // Valid - confirm immediately
            ui.updatePlacementStatus(null);
            this.confirmStructurePlacement();
        }
        // No rotation phase anymore - rotation happens during position phase
    }

    /**
     * Confirm and place the structure/construction site
     */
    confirmStructurePlacement() {
        // Check server connection before placing
        if (!this.networkManager.isServerConnected()) {
            ui.showToast('Cannot place: Not connected to server', 'error');
            return;
        }

        const placement = this.structurePlacement;
        const structure = placement.structure;

        // Check per-chunk limit for dock and market (1 per chunk)
        if (structure && (structure.type === 'dock' || structure.type === 'market')) {
            const chunkCoords = ChunkCoordinates.worldToChunk(
                placement.position.x,
                placement.position.z
            );
            const chunkKey = `${chunkCoords.chunkX},${chunkCoords.chunkZ}`;
            const chunkObjects = window.game?.chunkManager?.chunkObjects?.get(chunkKey);

            if (chunkObjects) {
                const existingStructure = chunkObjects.find(obj => {
                    const ud = obj.userData;
                    if (!ud) return false;
                    // Skip ruins
                    if (ud.isRuin) return false;
                    // Check for completed structure of same type
                    if (ud.modelType === structure.type) return true;
                    // Check for construction site targeting same type
                    if (ud.isConstructionSite && ud.targetStructure === structure.type) return true;
                    return false;
                });

                if (existingStructure) {
                    const name = structure.type.charAt(0).toUpperCase() + structure.type.slice(1);
                    ui.showToast(`This chunk already has a ${name}`, 'error');
                    return;
                }
            }
        }

        if (!placement.isValid) {
            ui.showToast(`Cannot place: ${placement.invalidReason}`, 'error');
            return;
        }

        // Special handling for water vehicles (boat, sailboat, ship2 - water placement, requires plank, 6-second build)
        const waterVehicleTypes = ['boat', 'sailboat', 'ship2'];
        if (structure && waterVehicleTypes.includes(structure.type)) {
            // 1. Check if in water (terrain height < 0)
            const vehicleHeight = this.terrainGenerator.getWorldHeight(placement.position.x, placement.position.z);
            if (vehicleHeight >= 0) {
                ui.showToast(`Must place ${structure.name.toLowerCase()} in water`, 'error');
                this.cancelStructurePlacement();
                return;
            }

            // 1.5. Check dock collision (prevent placing within dock collision zone)
            if (window.game?.physicsManager) {
                const boatDims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[structure.type];
                if (boatDims) {
                    const TRIGGER_BUFFER = 0.2;
                    const halfWidth = (boatDims.width / 2) + TRIGGER_BUFFER;
                    const halfHeight = (boatDims.height || 1.0) / 2;
                    const halfDepth = (boatDims.depth / 2) + TRIGGER_BUFFER;

                    const hitsDock = window.game.physicsManager.testShapeAtPosition(
                        { type: 'cuboid', width: halfWidth * 2, height: halfHeight * 2, depth: halfDepth * 2 },
                        { x: placement.position.x, y: CONFIG.WATER.LEVEL + halfHeight, z: placement.position.z },
                        placement.rotation || 0,
                        'dock'
                    );

                    if (hitsDock) {
                        ui.showToast('Too close to dock', 'error');
                        this.cancelStructurePlacement();
                        return;
                    }
                }
            }

            // 2. Check if player has plank (any type)
            const plank = this.gameState.inventory.items.find(
                item => this.isPlankType(item.type)
            );
            if (!plank) {
                ui.showToast(`Need 1 plank to build ${structure.name.toLowerCase()}`, 'warning');
                this.cancelStructurePlacement();
                return;
            }

            // 2b. Sailboat and ship2 require rope
            let rope = null;
            if (structure.type === 'sailboat' || structure.type === 'ship2') {
                rope = this.gameState.inventory.items.find(item => item.type === 'rope');
                if (!rope) {
                    ui.showToast(`Need 1 rope to build ${structure.name.toLowerCase()}`, 'warning');
                    this.cancelStructurePlacement();
                    return;
                }
            }

            // 2c. Ship2 requires parts
            let parts = null;
            if (structure.type === 'ship2') {
                parts = this.gameState.inventory.items.find(item => item.type === 'parts');
                if (!parts) {
                    ui.showToast('Need 1 parts to build ship', 'warning');
                    this.cancelStructurePlacement();
                    return;
                }
            }

            // 2d. Sailboat and ship2 require fabric
            let fabric = null;
            if (structure.type === 'sailboat' || structure.type === 'ship2') {
                fabric = this.gameState.inventory.items.find(item => item.type === 'fabric');
                if (!fabric) {
                    ui.showToast(`Need 1 fabric to build ${structure.name.toLowerCase()}`, 'warning');
                    this.cancelStructurePlacement();
                    return;
                }
            }

            // 3. Remove materials and calculate quality
            const qualities = [plank.quality || 50];
            const plankIndex = this.gameState.inventory.items.indexOf(plank);
            this.gameState.inventory.items.splice(plankIndex, 1);

            if (rope) {
                qualities.push(rope.quality || 50);
                const ropeIndex = this.gameState.inventory.items.indexOf(rope);
                this.gameState.inventory.items.splice(ropeIndex, 1);
            }
            if (parts) {
                qualities.push(parts.quality || 50);
                const partsIndex = this.gameState.inventory.items.indexOf(parts);
                this.gameState.inventory.items.splice(partsIndex, 1);
            }
            if (fabric) {
                qualities.push(fabric.quality || 50);
                const fabricIndex = this.gameState.inventory.items.indexOf(fabric);
                this.gameState.inventory.items.splice(fabricIndex, 1);
            }

            const avgQuality = Math.round(qualities.reduce((a, b) => a + b, 0) / qualities.length);

            // 4. Start 6-second build action
            this.gameState.activeAction = {
                object: null,
                startTime: Date.now(),
                duration: 6000,
                actionType: `build_${structure.type}`,
                boatData: {
                    position: [placement.position.x, CONFIG.WATER.LEVEL, placement.position.z],
                    rotation: placement.rotation || 0,
                    materialQuality: avgQuality,
                    vehicleType: structure.type
                }
            };

            ui.updateActionStatus(`Building ${structure.name.toLowerCase()}...`, 6000);
            this.cancelStructurePlacement();
            return;
        }

        // Special handling for roads (immediate build, no construction site)
        if (structure && structure.type === 'road') {
            // 1. Check if player has 1 chiseledlimestone or chiseledsandstone
            const chiseledStone = this.gameState.inventory.items.find(
                item => item.type === 'chiseledlimestone' || item.type === 'chiseledsandstone'
            );
            if (!chiseledStone) {
                ui.showToast('Need 1 chiseled stone (limestone or sandstone) to build road', 'warning');
                this.cancelStructurePlacement();
                return;
            }

            // 2. Check terrain height
            const roadHeight = this.terrainGenerator.getWorldHeight(placement.position.x, placement.position.z);
            if (roadHeight < CONFIG.WATER.LEVEL) {
                ui.showToast('Cannot build here - terrain too low', 'error');
                this.cancelStructurePlacement();
                return;
            }

            // 3. Check if player has hammer or improvised tool
            const hasHammer = this.gameState.inventory.items.some(item =>
                (item.type === 'hammer' || item.type === 'improvisedtool') && item.durability > 0
            );
            if (!hasHammer) {
                ui.showToast('Need hammer or improvised tool to build road', 'warning');
                this.cancelStructurePlacement();
                return;
            }

            // 4. Remove chiseled stone immediately, track material type
            const materialType = chiseledStone.type === 'chiseledsandstone' ? 'sandstone' : 'limestone';
            const stoneIndex = this.gameState.inventory.items.indexOf(chiseledStone);
            this.gameState.inventory.items.splice(stoneIndex, 1);

            // 5. Start 10-second build action
            this.gameState.activeAction = {
                object: null,  // No construction site for roads
                startTime: Date.now(),
                duration: 10000,  // 10 seconds for roads
                actionType: 'build_road',
                roadData: {
                    position: [placement.position.x, placement.position.y, placement.position.z],
                    rotation: placement.rotation || 0,
                    materialType: materialType  // Track material for visual tinting
                }
            };

            // 6. Play hammer sound
            if (this.audioManager) {
                const sound = this.audioManager.playHammerSound();
                this.gameState.activeAction.sound = sound;
            }

            // 7. Broadcast sound to peers
            this.networkManager.broadcastP2P({
                type: 'player_sound',
                payload: {
                    soundType: 'hammer',
                    startTime: Date.now()
                }
            });

            // 8. Start hammer animation if available
            // Note: Animation handled in game.js action system

            ui.updateActionStatus('Building road...', 10000);
            window.tasksPanel?.onRoadPlaced();
            this.cancelStructurePlacement();  // Remove preview
            return;
        }

        // Special handling for plantable trees (requires seed)
        if (structure && structure.isPlantable) {
            // 1. Check if player has the required seed
            const hasSeed = this.gameState.inventory.items.some(
                item => item.type === structure.seedType
            );
            if (!hasSeed) {
                ui.showToast(`Need 1 ${structure.seedType} to plant`, 'warning');
                this.cancelStructurePlacement();
                return;
            }

            // 2. Check terrain height (not in water, not too low)
            const treeHeight = this.terrainGenerator.getWorldHeight(placement.position.x, placement.position.z);
            if (treeHeight < CONFIG.WATER.LEVEL) {
                ui.showToast('Cannot plant here - terrain too low', 'error');
                this.cancelStructurePlacement();
                return;
            }

            // 3. Get seed item to extract quality
            const seed = this.gameState.inventory.items.find(
                item => item.type === structure.seedType
            );
            const seedQuality = seed ? seed.quality : 50;

            // 4. Calculate blended quality (seed quality + region's max quality) / 2
            // This means local "soil quality" affects the planted tree
            const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(placement.position.x, placement.position.z);
            const worldSeed = TERRAIN_CONFIG.TERRAIN.seed;
            const regionQualityRange = QualityGenerator.getQualityRange(worldSeed, chunkX, chunkZ, structure.treeType);
            const regionMaxQuality = regionQualityRange.max;
            const blendedQuality = Math.round((seedQuality + regionMaxQuality) / 2);

            // 5. Remove seed from inventory
            const seedIndex = this.gameState.inventory.items.indexOf(seed);
            this.gameState.inventory.items.splice(seedIndex, 1);

            // 6. Send plant request to server
            this.networkManager.sendMessage('plant_tree', {
                position: [placement.position.x, placement.position.y, placement.position.z],
                treeType: structure.treeType,
                quality: blendedQuality,
                chunkId: `${chunkX},${chunkZ}`,
                clientId: this.gameState.clientId,
                accountId: this.gameState.accountId || null
            });

            ui.showToast(`${structure.name} planted!`, 'success');
            this.cancelStructurePlacement();

            // Re-render inventory if it's open
            if (this.gameState.inventoryOpen) {
                this.inventoryUI.renderInventory();
            }
            return;
        }

        // Special handling for campfire (immediate build, no construction site, no tool required)
        if (structure && structure.type === 'campfire') {
            // 1. Check terrain height
            const campfireHeight = this.terrainGenerator.getWorldHeight(placement.position.x, placement.position.z);
            if (campfireHeight < CONFIG.WATER.LEVEL) {
                ui.showToast('Cannot build here - terrain too low', 'error');
                this.cancelStructurePlacement();
                return;
            }

            // 2. Check if player has 1 limestone or sandstone
            const stone = this.gameState.inventory.items.find(
                item => item.type === 'limestone' || item.type === 'sandstone'
            );
            if (!stone) {
                ui.showToast('Need 1 stone (limestone or sandstone) to build campfire', 'warning');
                this.cancelStructurePlacement();
                return;
            }

            // 3. Remove stone immediately and capture quality, track material type
            const stoneQuality = stone.quality || 50;  // Capture quality before removal
            const materialType = stone.type === 'sandstone' ? 'sandstone' : 'limestone';
            const stoneIndex = this.gameState.inventory.items.indexOf(stone);
            this.gameState.inventory.items.splice(stoneIndex, 1);

            // 4. Start 6-second build action (no tool required)
            this.gameState.activeAction = {
                object: null,  // No construction site for campfire
                startTime: Date.now(),
                duration: 6000,  // 6 seconds
                actionType: 'build_campfire',
                campfireData: {
                    position: [placement.position.x, placement.position.y, placement.position.z],
                    rotation: placement.rotation || 0,
                    materialQuality: stoneQuality,  // Pass stone quality to server
                    materialType: materialType  // Track material for visual tinting
                }
            };

            ui.updateActionStatus('Building campfire...', 6000);
            this.cancelStructurePlacement();  // Remove preview
            return;
        }

        // Special handling for tent (immediate build, no construction site, no tool required)
        if (structure && structure.type === 'tent') {
            // 1. Check terrain height
            const tentHeight = this.terrainGenerator.getWorldHeight(placement.position.x, placement.position.z);
            if (tentHeight < CONFIG.WATER.LEVEL) {
                ui.showToast('Cannot build here - terrain too low', 'error');
                this.cancelStructurePlacement();
                return;
            }

            // 2. Check if player has 1 plank (any type), 1 rope, and 1 fabric
            const plank = this.gameState.inventory.items.find(
                item => this.isPlankType(item.type)
            );
            const rope = this.gameState.inventory.items.find(
                item => item.type === 'rope'
            );
            const fabric = this.gameState.inventory.items.find(
                item => item.type === 'fabric'
            );
            if (!plank || !rope || !fabric) {
                const missing = [];
                if (!plank) missing.push('plank');
                if (!rope) missing.push('rope');
                if (!fabric) missing.push('fabric');
                ui.showToast(`Need ${missing.join(' and ')} to build tent`, 'warning');
                this.cancelStructurePlacement();
                return;
            }

            // 3. Remove plank, rope, and fabric immediately, capture qualities
            const plankQuality = plank.quality || 50;
            const ropeQuality = rope.quality || 50;
            const fabricQuality = fabric.quality || 50;
            const plankIndex = this.gameState.inventory.items.indexOf(plank);
            this.gameState.inventory.items.splice(plankIndex, 1);
            const ropeIndex = this.gameState.inventory.items.indexOf(rope);
            this.gameState.inventory.items.splice(ropeIndex, 1);
            const fabricIndex = this.gameState.inventory.items.indexOf(fabric);
            this.gameState.inventory.items.splice(fabricIndex, 1);

            // Average all material qualities
            const materialQuality = Math.round((plankQuality + ropeQuality + fabricQuality) / 3);

            // 4. Start 6-second build action (no tool required)
            this.gameState.activeAction = {
                object: null,  // No construction site for tent
                startTime: Date.now(),
                duration: 6000,  // 6 seconds
                actionType: 'build_tent',
                tentData: {
                    position: [placement.position.x, tentHeight, placement.position.z],
                    rotation: placement.rotation || 0,
                    materialQuality: materialQuality  // Average of plank and rope quality
                }
            };

            ui.updateActionStatus('Building tent...', 6000);
            this.cancelStructurePlacement();  // Remove preview
            return;
        }

        // Special handling for wall (immediate build, no construction site, no tool required)
        if (structure && structure.type === 'wall') {
            // 1. Check terrain height
            const wallHeight = this.terrainGenerator.getWorldHeight(placement.position.x, placement.position.z);
            if (wallHeight < CONFIG.WATER.LEVEL) {
                ui.showToast('Cannot build here - terrain too low', 'error');
                this.cancelStructurePlacement();
                return;
            }

            // 2. Check if player has 1 chiseled stone (limestone or sandstone)
            const stone = this.gameState.inventory.items.find(
                item => item.type === 'chiseledlimestone' || item.type === 'chiseledsandstone'
            );
            if (!stone) {
                ui.showToast('Need 1 chiseled stone (limestone or sandstone) to build wall', 'warning');
                this.cancelStructurePlacement();
                return;
            }

            // 3. Remove stone immediately and capture quality, track material type
            const stoneQuality = stone.quality || 50;
            const materialType = stone.type === 'chiseledsandstone' ? 'sandstone' : 'limestone';
            const stoneIndex = this.gameState.inventory.items.indexOf(stone);
            this.gameState.inventory.items.splice(stoneIndex, 1);

            // 4. Start 6-second build action (no tool required)
            this.gameState.activeAction = {
                object: null,  // No construction site for wall
                startTime: Date.now(),
                duration: 6000,  // 6 seconds
                actionType: 'build_wall',
                wallData: {
                    position: [placement.position.x, placement.position.y, placement.position.z],
                    rotation: placement.rotation || 0,
                    materialQuality: stoneQuality,
                    materialType: materialType  // Track material for visual tinting
                }
            };

            ui.updateActionStatus('Building wall...', 6000);
            this.cancelStructurePlacement();  // Remove preview
            return;
        }

        // Special handling for outpost (immediate build, no construction site, no tool required)
        if (structure && structure.type === 'outpost') {
            // 1. Check terrain height
            const outpostHeight = this.terrainGenerator.getWorldHeight(placement.position.x, placement.position.z);
            if (outpostHeight < CONFIG.WATER.LEVEL) {
                ui.showToast('Cannot build here - terrain too low', 'error');
                this.cancelStructurePlacement();
                return;
            }

            // 2. Check if player has 1 plank (any type)
            const plank = this.gameState.inventory.items.find(
                item => this.isPlankType(item.type)
            );
            if (!plank) {
                ui.showToast('Need 1 plank to build outpost', 'warning');
                this.cancelStructurePlacement();
                return;
            }

            // 3. Remove plank immediately and capture quality
            const plankQuality = plank.quality || 50;
            const plankIndex = this.gameState.inventory.items.indexOf(plank);
            this.gameState.inventory.items.splice(plankIndex, 1);

            // 4. Start 6-second build action (no tool required)
            this.gameState.activeAction = {
                object: null,  // No construction site for outpost
                startTime: Date.now(),
                duration: 6000,  // 6 seconds
                actionType: 'build_outpost',
                outpostData: {
                    position: [placement.position.x, outpostHeight, placement.position.z],
                    rotation: placement.rotation || 0,
                    materialQuality: plankQuality
                }
            };

            ui.updateActionStatus('Building outpost...', 6000);
            this.cancelStructurePlacement();
            return;
        }

        // Special handling for cart (immediate build, no construction site, no tool required)
        if (structure && structure.type === 'cart') {
            // 1. Check terrain height (same as tent)
            const cartHeight = this.terrainGenerator.getWorldHeight(placement.position.x, placement.position.z);
            if (cartHeight < CONFIG.WATER.LEVEL) {
                ui.showToast('Cannot build here - terrain too low', 'error');
                this.cancelStructurePlacement();
                return;
            }

            // 2. Check if player has 1 plank (any type) - use existing isPlankType helper
            const plank = this.gameState.inventory.items.find(
                item => this.isPlankType(item.type)
            );
            if (!plank) {
                ui.showToast('Need 1 plank to build cart', 'warning');
                this.cancelStructurePlacement();
                return;
            }

            // 3. Remove plank immediately and capture quality
            const plankQuality = plank.quality || 50;
            const plankIndex = this.gameState.inventory.items.indexOf(plank);
            this.gameState.inventory.items.splice(plankIndex, 1);

            // 4. Start 6-second build action (matches tent pattern)
            this.gameState.activeAction = {
                object: null,  // No construction site for cart
                startTime: Date.now(),
                duration: 6000,  // 6 seconds
                actionType: 'build_cart',
                cartData: {
                    position: [placement.position.x, placement.position.y, placement.position.z],
                    rotation: placement.rotation || 0,
                    materialQuality: plankQuality
                }
            };

            ui.updateActionStatus('Building cart...', 6000);
            this.cancelStructurePlacement();
            return;
        }

        // Special handling for artillery (immediate build, requires parts + plank)
        if (structure && structure.type === 'artillery') {
            // 1. Check terrain height (same as cart)
            const artilleryHeight = this.terrainGenerator.getWorldHeight(placement.position.x, placement.position.z);
            if (artilleryHeight < CONFIG.WATER.LEVEL) {
                ui.showToast('Cannot build here - terrain too low', 'error');
                this.cancelStructurePlacement();
                return;
            }

            // 2. Check if player has 1 parts item
            const parts = this.gameState.inventory.items.find(item => item.type === 'parts');
            if (!parts) {
                ui.showToast('Need 1 parts to build artillery', 'warning');
                this.cancelStructurePlacement();
                return;
            }

            // 3. Check if player has 1 plank (any type)
            const plank = this.gameState.inventory.items.find(
                item => this.isPlankType(item.type)
            );
            if (!plank) {
                ui.showToast('Need 1 plank to build artillery', 'warning');
                this.cancelStructurePlacement();
                return;
            }

            // 4. Remove materials and calculate quality
            const plankQuality = plank.quality || 50;
            const partsQuality = parts.quality || 50;
            const avgQuality = Math.round((plankQuality + partsQuality) / 2);

            const partsIndex = this.gameState.inventory.items.indexOf(parts);
            this.gameState.inventory.items.splice(partsIndex, 1);
            const plankIndex = this.gameState.inventory.items.indexOf(plank);
            this.gameState.inventory.items.splice(plankIndex, 1);

            // 5. Start 6-second build action
            this.gameState.activeAction = {
                object: null,
                startTime: Date.now(),
                duration: 6000,
                actionType: 'build_artillery',
                artilleryData: {
                    position: [placement.position.x, placement.position.y, placement.position.z],
                    rotation: placement.rotation || 0,
                    materialQuality: avgQuality
                }
            };

            ui.updateActionStatus('Building artillery...', 6000);
            this.cancelStructurePlacement();
            return;
        }

        // Special handling for crate (immediate build, no construction site)
        if (structure && structure.type === 'crate') {
            // 1. Check terrain height (must be on land)
            const crateHeight = this.terrainGenerator.getWorldHeight(
                placement.position.x,
                placement.position.z
            );
            if (crateHeight < CONFIG.WATER.LEVEL) {
                ui.showToast('Cannot build here - terrain too low', 'error');
                this.cancelStructurePlacement();
                return;
            }

            // 2. Check plank requirement (any plank type)
            const plank = this.gameState.inventory.items.find(
                item => this.isPlankType(item.type)
            );
            if (!plank) {
                ui.showToast('Need 1 plank to build crate', 'warning');
                this.cancelStructurePlacement();
                return;
            }

            // 3. Remove plank immediately and capture quality
            const plankQuality = plank.quality || 50;
            const plankIndex = this.gameState.inventory.items.indexOf(plank);
            this.gameState.inventory.items.splice(plankIndex, 1);

            // 4. Start 6-second build action
            this.gameState.activeAction = {
                object: null,  // No construction site
                startTime: Date.now(),
                duration: 6000,  // 6 seconds (matches tent)
                actionType: 'build_crate',
                crateData: {
                    position: [placement.position.x, crateHeight, placement.position.z],
                    rotation: placement.rotation || 0,
                    materialQuality: plankQuality
                }
            };

            ui.updateActionStatus('Building crate...', 6000);
            this.cancelStructurePlacement();
            return;
        }

        // Regular structure placement
        // Calculate Y position using the confirmed rotation from placement state
        // NOTE: placement.rotation is in RADIANS (standard throughout codebase)
        let finalStructureY;
        let constructionSiteY;

        if (structure.type === 'dock') {
            // Docks use fixed height
            finalStructureY = placement.position.y;
            constructionSiteY = finalStructureY;
        } else if (structure.type === 'fisherman') {
            // Fisherman uses center terrain height + 1 (already calculated in updateStructurePreview)
            finalStructureY = placement.position.y;
            constructionSiteY = finalStructureY;
        } else {
            const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[structure.type];
            let maxHeight;

            if (structure.type === 'market') {
                // Market uses 3 sample points along depth axis: center, +5, -5
                // This handles the 2x8 footprint better than corner sampling
                const rotation = placement.rotation || 0; // Radians
                const sin = Math.sin(rotation);
                const cos = Math.cos(rotation);

                // Sample points along the depth axis (local Z when unrotated)
                // When rotated, local +Z maps to world: (sin(θ), cos(θ))
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
                const rotation = placement.rotation || 0; // Radians
                const halfWidth = dims.width / 2;
                const halfDepth = dims.depth / 2;
                const cos = Math.cos(rotation);
                const sin = Math.sin(rotation);

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
            const snappedHeight = Math.ceil(maxHeight / 0.25) * 0.25;
            finalStructureY = snappedHeight;
            constructionSiteY = snappedHeight;
        }

        // NOTE: Terrain leveling is handled in SceneObjectFactory.js when structures are created.
        // Structures that level terrain: crate, house, outpost, tent, market, tileworks

        // Send to server to spawn construction site (server will broadcast to all clients)
        const messagePayload = {
            position: [placement.position.x, constructionSiteY, placement.position.z],
            rotation: placement.rotation,
            scale: 1.0,
            targetStructure: structure.type,
            finalFoundationY: finalStructureY,  // Store final Y for final structure
            clientId: this.gameState.clientId,
            accountId: this.gameState.accountId  // For persistent ownership/home
        };
        this.networkManager.sendMessage('place_construction_site', messagePayload);

        ui.showToast('Construction site placed!', 'success');

        // Clean up placement state (also removes preview bounding box)
        this.cancelStructurePlacement();
    }

    /**
     * Cancel the current placement and clean up
     */
    cancelStructurePlacement() {
        const placement = this.structurePlacement;

        if (placement.previewBox) {
            this.scene.remove(placement.previewBox);

            // Dispose of group children (solidBox and wireframe)
            placement.previewBox.traverse((child) => {
                if (child.geometry) {
                    child.geometry.dispose();
                }
                if (child.material) {
                    child.material.dispose();
                }
            });

            placement.previewBox = null;
        }

        placement.active = false;
        placement.phase = null;
        placement.structure = null;
        this.buildMenuPickedStructure = null;

        // Clear dock placement cache
        this.structureManager.clearDockCache();

        ui.updatePlacementStatus(null); // Clear placement status
    }

    /**
     * Update the preview position during mouse movement
     * Called from game.js onPointerMove
     */
    updateStructurePreview(terrainX, terrainZ, mouseY) {
        // Only update if foundation placement is active
        if (!this.structurePlacement.active) return;

        // Delegate to structure manager for preview update
        this.structureManager.updateStructurePreview(
            terrainX, terrainZ, mouseY,
            this.structurePlacement,
            ui
        );

        // Trigger validation (debounced - runs after mouse stops moving)
        // All structure types use debounce now for better FPS during placement
        this.validateStructurePlacementDebounced();
    }

    /**
     * Handle resize event
     */
    onResize() {
        // Recalculate build menu sizes if build menu is open
        if (this.buildMenuOpen) {
            this.calculateBuildMenuSize();
            this.renderBuildMenu();
        }
    }

    /**
     * Check if structure placement is active
     */
    isPlacementActive() {
        return this.structurePlacement.active;
    }

    /**
     * Get the structure placement state (for validation and updates)
     */
    getPlacementState() {
        return this.structurePlacement;
    }

    /**
     * Check if build menu is currently open
     */
    isOpen() {
        return this.buildMenuOpen;
    }
}

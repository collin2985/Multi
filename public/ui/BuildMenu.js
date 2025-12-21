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
 * - Foundation placement system (position -> rotation -> height phases)
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
import { RotationControls } from './RotationControls.js';
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
                // Campfire structure (terrain placement, has inventory)
                {
                    id: 'campfire',
                    type: 'campfire',
                    name: 'Campfire',
                    width: 1,
                    height: 1,
                    imagePath: './structures/campfire.png',
                    hasInventory: true
                },
                // Ship structure (requires water, instant build)
                {
                    id: 'ship',
                    type: 'ship',
                    name: 'Ship',
                    width: 1,
                    height: 1,
                    imagePath: './structures/ship.png',
                    requiresWater: true,
                    instantBuild: true
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
                // Market structure
                {
                    id: 'market',
                    type: 'market',
                    name: 'Market',
                    width: 1,  // Display as 1 slot wide in menu
                    height: 1,  // Display as 1 slot tall in menu
                    imagePath: './structures/market.png'
                },
                // Garden structure (foundation built into model, has inventory)
                {
                    id: 'garden',
                    type: 'garden',
                    name: 'Garden',
                    width: 1,
                    height: 1,
                    imagePath: './structures/garden.png',
                    hasInventory: true
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
                // Dock structure (places on terrain like foundation, 10x1)
                {
                    id: 'dock',
                    type: 'dock',
                    name: 'Dock',
                    width: 1,
                    height: 1,
                    imagePath: './structures/dock.png'
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
                // Road structure (terrain modification, no rotation, immediate build)
                {
                    id: 'road',
                    type: 'road',
                    name: 'Road',
                    width: 1,
                    height: 1,
                    imagePath: './structures/road.png'
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
                    treeType: 'pine'
                },
                {
                    id: 'planted_fir',
                    type: 'planted_fir',
                    name: 'Fir Tree',
                    width: 1,
                    height: 1,
                    imagePath: './structures/firtree.png',
                    isPlantable: true,
                    seedType: 'firseed',
                    treeType: 'fir'
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
                    treeType: 'apple'
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
                    treeType: 'vegetables'
                }
            ]
        };

        // Structure placement state
        this.structurePlacement = {
            active: false,
            phase: null,  // 'position' -> 'rotation' -> 'confirmed'
            structure: null,
            position: { x: 0, y: 0, z: 0 },
            rotation: 45,  // In degrees (snaps to 15°)
            previewBox: null,
            isValid: false,
            invalidReason: '',
            validationPending: false  // True during mouse movement, false after validation
        };

        // Debounced validation function
        this.validateStructurePlacementDebounced = this.createDebouncedValidation();

        // Initialize rotation controls
        this.rotationControls = new RotationControls();
        this.rotationControls.setRotateCallback((rotation) => {
            this.onRotationChange(rotation);
        });
        this.rotationControls.setConfirmCallback(() => {
            this.advanceStructurePlacementPhase();
        });

        // Setup close button listener
        this.setupCloseButton();
    }

    /**
     * Creates a debounced validation function that runs after mouse movement stops
     * Debounce waits for inactivity before validating (vs throttle which runs then blocks)
     */
    createDebouncedValidation() {
        let debounceTimeout = null;
        return () => {
            // Clear any pending validation
            if (debounceTimeout) {
                clearTimeout(debounceTimeout);
            }

            // Set validation pending state (will show white glow)
            this.structurePlacement.validationPending = true;

            // Schedule new validation after 180ms of inactivity
            debounceTimeout = setTimeout(() => {
                debounceTimeout = null;
                this.structurePlacement.validationPending = false;

                // Run validation with current phase
                const result = this.structureManager.validateStructurePlacement(
                    this.structurePlacement,
                    this.structurePlacement.phase,
                    this.playerObject ? this.playerObject.position : null
                );

                // Only log if validation state changes

                this.structurePlacement.isValid = result.isValid;
                this.structurePlacement.invalidReason = result.invalidReason;

                // Force preview update to show validation result
                this.structureManager.updateStructurePreviewColors(
                    this.structurePlacement,
                    ui
                );

                // Update placement status UI
                if (result.isValid) {
                    ui.updatePlacementStatus('Valid placement', true);
                } else {
                    ui.updatePlacementStatus(result.invalidReason, false);
                }
            }, 180);  // 180ms feels instant after pause
        };
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
                'it will become abandoned (inaccessible) when this one is completed.\n\n' +
                'Continue?'
            );
            if (!confirmed) {
                return; // User cancelled
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
        this.structurePlacement.rotation = 45;

        // Dock must be perpendicular to shore for ship docking
        if (structure.type === 'dock') {
            this.structurePlacement.rotation = 90;
        }

        // Roads and plantables don't rotate
        if (structure.type === 'road' || structure.isPlantable) {
            this.structurePlacement.rotation = 0;
        }

        this.structurePlacement.validationPending = true;  // Show white glow initially
        this.structurePlacement.isValid = false;  // Initialize to false - must validate first
        this.structurePlacement.invalidReason = 'Not validated yet';

        const previewGroup = new THREE.Group();
        const PREVIEW_HEIGHT = 2.0;  // All previews are 2 units tall

        // Get dimensions from config
        const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[structure.type];

        // Determine if cylindrical (has radius) or rectangular (has width/depth)
        const isCylindrical = dims && dims.radius !== undefined;

        // Create semi-transparent material
        const previewMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,  // White initially (validation pending)
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: true
        });

        let previewMesh;

        if (isCylindrical) {
            // Cylindrical preview (campfire, plantable trees)
            const radius = dims.radius;
            const geometry = new THREE.CylinderGeometry(radius, radius, PREVIEW_HEIGHT, 16);
            previewMesh = new THREE.Mesh(geometry, previewMaterial);
            // Offset so bottom sits at y=0
            previewMesh.position.y = PREVIEW_HEIGHT / 2;
        } else if (dims) {
            // Rectangular preview (most structures)
            const width = dims.width || 1;
            const depth = dims.depth || 1;
            const geometry = new THREE.BoxGeometry(width, PREVIEW_HEIGHT, depth);
            previewMesh = new THREE.Mesh(geometry, previewMaterial);
            // Offset so bottom sits at y=0
            previewMesh.position.y = PREVIEW_HEIGHT / 2;
        } else {
            // Fallback: 1x1 box
            const geometry = new THREE.BoxGeometry(1, PREVIEW_HEIGHT, 1);
            previewMesh = new THREE.Mesh(geometry, previewMaterial);
            previewMesh.position.y = PREVIEW_HEIGHT / 2;
        }

        previewMesh.renderOrder = 500;
        previewGroup.add(previewMesh);

        // Store references
        this.structurePlacement.previewBox = previewGroup;
        this.structurePlacement.previewBox.userData.previewMesh = previewMesh;
        this.structurePlacement.previewBox.userData.modelType = structure.type;
        this.structurePlacement.previewBox.userData.isPreview = true;
        this.structurePlacement.previewBox.userData.isCylindrical = isCylindrical;

        // Add to scene
        previewGroup.visible = true;
        this.scene.add(previewGroup);

        // Apply initial rotation (convert degrees to radians)
        previewGroup.rotation.y = this.structurePlacement.rotation * (Math.PI / 180);

        // Set status message
        if (structure.type === 'road') {
            ui.updatePlacementStatus('Click to place road (within 1 unit of player)');
        } else if (structure.isPlantable) {
            ui.updatePlacementStatus(`Click to plant ${structure.name} (within 1 unit of player)`);
        } else {
            ui.updatePlacementStatus('Move mouse to position structure, click to confirm');
        }
    }

    /**
     * Advance to the next placement phase
     * Phases: position -> rotation -> confirmed
     */
    advanceStructurePlacementPhase(mouseY) {
        const placement = this.structurePlacement;
        const structure = placement.structure;

        if (placement.phase === 'position') {
            // Special handling for roads, plantable trees, and docks - skip rotation, place immediately
            if (structure && (structure.type === 'road' || structure.type === 'dock' || structure.isPlantable)) {
                // For docks, set rotation to 90 degrees (fixed orientation)
                if (structure.type === 'dock') {
                    placement.rotation = 90;
                }

                // Validate placement
                const validation = this.structureManager.validateStructurePlacement(
                    placement,
                    'position',  // Still in position phase
                    this.playerObject ? this.playerObject.position : null
                );

                placement.isValid = validation.isValid;
                placement.invalidReason = validation.invalidReason;

                if (!placement.isValid) {
                    ui.updatePlacementStatus(`Cannot place: ${placement.invalidReason}`, false);
                    return;  // Don't place if invalid
                }

                // Valid placement - skip rotation and confirm immediately
                ui.updatePlacementStatus(null); // Clear placement status
                this.confirmStructurePlacement();
                return;
            }

            // Allow advancement to rotation even with collision
            // User can explore rotation options to find valid placement angle
            placement.phase = 'rotation';

            // Initialize rotation (dock locked to 90° for ship docking)
            const initialRotation = placement.structure.type === 'dock' ? 90 : 45;
            placement.rotation = initialRotation;

            // Show rotation controls
            this.rotationControls.show(initialRotation);

            // CRITICAL: Immediately validate with collision check now that we're in rotation phase
            // Make sure we have valid position and playerObject before validating
            if (placement.position && this.playerObject && this.playerObject.position) {
                const validation = this.structureManager.validateStructurePlacement(
                    placement,
                    'rotation',
                    this.playerObject.position
                );

                placement.isValid = validation.isValid;
                placement.invalidReason = validation.invalidReason;

                // Update preview colors based on validation
                this.structureManager.updateStructurePreviewColors(placement, ui);

                if (!placement.isValid) {
                    ui.updatePlacementStatus(placement.invalidReason, false);
                } else {
                    ui.updatePlacementStatus('Valid placement', true);
                }
            } else {
                ui.updatePlacementStatus(null);
            }
            ui.showToast('Use buttons to rotate and confirm', 'info');

        } else if (placement.phase === 'rotation') {
            // Rotation phase confirmation now handled by confirm button
            // CRITICAL: Always re-validate before confirming placement to prevent bypass
            const freshValidation = this.structureManager.validateStructurePlacement(
                placement,
                'rotation',
                this.playerObject ? this.playerObject.position : null
            );

            placement.isValid = freshValidation.isValid;
            placement.invalidReason = freshValidation.invalidReason;

            if (!placement.isValid) {
                ui.updatePlacementStatus(`Placement cancelled: ${placement.invalidReason}`, false);
                this.cancelStructurePlacement();
                return;
            }
            // All structures skip height phase and snap automatically
            // Structures now auto-calculate height based on terrain
            ui.updatePlacementStatus(null); // Clear placement status
            this.confirmStructurePlacement();
        }
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

        if (!placement.isValid) {
            ui.showToast(`Cannot place: ${placement.invalidReason}`, 'error');
            return;
        }

        // Special handling for boat (water placement, requires plank, 6-second build)
        if (structure && structure.type === 'boat') {
            // 1. Check if in water (terrain height < 0)
            const boatHeight = this.terrainGenerator.getWorldHeight(placement.position.x, placement.position.z);
            if (boatHeight >= 0) {
                ui.showToast('Must place boat in water', 'error');
                this.cancelStructurePlacement();
                return;
            }

            // 2. Check if player has plank (any type)
            const plank = this.gameState.inventory.items.find(
                item => this.isPlankType(item.type)
            );
            if (!plank) {
                ui.showToast('Need 1 plank to build boat', 'warning');
                this.cancelStructurePlacement();
                return;
            }

            // 3. Remove plank immediately and capture quality
            const plankQuality = plank.quality || 50;
            const plankIndex = this.gameState.inventory.items.indexOf(plank);
            this.gameState.inventory.items.splice(plankIndex, 1);

            // 4. Start 6-second build action
            this.gameState.activeAction = {
                object: null,
                startTime: Date.now(),
                duration: 6000,
                actionType: 'build_boat',
                boatData: {
                    position: [placement.position.x, CONFIG.WATER.LEVEL, placement.position.z],
                    rotation: placement.rotation || 0,
                    materialQuality: plankQuality
                }
            };

            ui.updateActionStatus('Building boat...', 6000);
            this.cancelStructurePlacement();
            return;
        }

        // Special handling for water-based structures (ship - instant build)
        if (structure && structure.requiresWater) {
            // Ships are instant-build - send placement request to server
            this.networkManager.sendMessage('place_construction_site', {
                position: [placement.position.x, placement.position.y, placement.position.z],
                rotation: placement.rotation,
                scale: 1.0,
                targetStructure: structure.type,
                clientId: this.gameState.clientId,
                accountId: this.gameState.accountId  // For persistent ownership/home
            });

            ui.showToast(`${structure.name} placed!`, 'success');
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

            // 3. Check if player has hammer
            const hasHammer = this.gameState.inventory.items.some(item =>
                item.type === 'hammer' && item.durability > 0
            );
            if (!hasHammer) {
                ui.showToast('Need hammer to build road', 'warning');
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
                    rotation: 0,
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

            // 2. Check if player has 1 plank (any type) and 1 rope
            const plank = this.gameState.inventory.items.find(
                item => this.isPlankType(item.type)
            );
            const rope = this.gameState.inventory.items.find(
                item => item.type === 'rope'
            );
            if (!plank || !rope) {
                const missing = [];
                if (!plank) missing.push('plank');
                if (!rope) missing.push('rope');
                ui.showToast(`Need ${missing.join(' and ')} to build tent`, 'warning');
                this.cancelStructurePlacement();
                return;
            }

            // 3. Remove plank and rope immediately, capture qualities
            const plankQuality = plank.quality || 50;
            const ropeQuality = rope.quality || 50;
            const plankIndex = this.gameState.inventory.items.indexOf(plank);
            this.gameState.inventory.items.splice(plankIndex, 1);
            const ropeIndex = this.gameState.inventory.items.indexOf(rope);
            this.gameState.inventory.items.splice(ropeIndex, 1);

            // Average both material qualities
            const materialQuality = Math.round((plankQuality + ropeQuality) / 2);

            // 4. Start 6-second build action (no tool required)
            this.gameState.activeAction = {
                object: null,  // No construction site for tent
                startTime: Date.now(),
                duration: 6000,  // 6 seconds
                actionType: 'build_tent',
                tentData: {
                    position: [placement.position.x, placement.position.y, placement.position.z],
                    rotation: placement.rotation || 0,
                    materialQuality: materialQuality  // Average of plank and rope quality
                }
            };

            ui.updateActionStatus('Building tent...', 6000);
            this.cancelStructurePlacement();  // Remove preview
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
        // Calculate average height of 4 corners for structure using actual dimensions
        const dims = this.structureManager.getGridDimensions(structure.type, placement.rotation || 0);
        const halfWidth = dims.width / 2;
        const halfDepth = dims.depth / 2;

        const corner1 = this.terrainGenerator.getWorldHeight(placement.position.x - halfWidth, placement.position.z - halfDepth);
        const corner2 = this.terrainGenerator.getWorldHeight(placement.position.x + halfWidth, placement.position.z - halfDepth);
        const corner3 = this.terrainGenerator.getWorldHeight(placement.position.x - halfWidth, placement.position.z + halfDepth);
        const corner4 = this.terrainGenerator.getWorldHeight(placement.position.x + halfWidth, placement.position.z + halfDepth);
        const averageHeight = (corner1 + corner2 + corner3 + corner4) / 4;

        // Snap to 0.25 grid
        const constructionSiteY = Math.ceil(averageHeight / 0.25) * 0.25;

        // Final Y position is already calculated in placement.position.y (no manual height adjustment)
        const finalStructureY = placement.position.y;

        // NOTE: Terrain leveling disabled - new clipmap terrain system doesn't support runtime deformation
        // const structuresToLevel = ['crate', 'house', 'garden', 'outpost', 'tent', 'market'];
        // if (structuresToLevel.includes(structure.type)) {
        //     this.terrainGenerator.levelTerrainForStructure(...);
        // }

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

        // Hide rotation controls
        this.rotationControls.hide();

        ui.updatePlacementStatus(null); // Clear placement status
    }

    /**
     * Update the preview position during mouse movement
     * Called from game.js onPointerMove
     */
    updateStructurePreview(terrainX, terrainZ, mouseY) {
        // Only update if foundation placement is active
        if (!this.structurePlacement.active) return;

        // Skip mouse updates during rotation phase - rotation is button/keyboard controlled
        if (this.structurePlacement.phase === 'rotation') return;

        // Delegate to structure manager for preview update
        this.structureManager.updateStructurePreview(
            terrainX, terrainZ, mouseY,
            this.structurePlacement,
            ui
        );

        // Docks use immediate validation (position is auto-calculated)
        const structure = this.structurePlacement.structure;
        if (structure && structure.type === 'dock') {
            // Run validation immediately for docks
            const result = this.structureManager.validateStructurePlacement(
                this.structurePlacement,
                'position',
                this.playerObject ? this.playerObject.position : null
            );
            this.structurePlacement.isValid = result.isValid;
            this.structurePlacement.invalidReason = result.invalidReason;
            this.structurePlacement.validationPending = false;
            this.structureManager.updateStructurePreviewColors(this.structurePlacement, ui);
        } else {
            // Trigger validation (debounced - runs after mouse stops moving)
            this.validateStructurePlacementDebounced();
        }
    }

    /**
     * Handle rotation change from rotation controls
     * @param {number} rotation - New rotation in degrees
     */
    onRotationChange(rotation) {
        if (!this.structurePlacement.active || this.structurePlacement.phase !== 'rotation') {
            return;
        }

        // Update placement rotation
        this.structurePlacement.rotation = rotation;

        // Update preview box rotation
        if (this.structurePlacement.previewBox) {
            this.structurePlacement.previewBox.rotation.y = rotation * (Math.PI / 180);
        }

        // Validate placement with new rotation
        const validation = this.structureManager.validateStructurePlacement(
            this.structurePlacement,
            'rotation',
            this.playerObject ? this.playerObject.position : null
        );

        this.structurePlacement.isValid = validation.isValid;
        this.structurePlacement.invalidReason = validation.invalidReason;

        // Update preview colors based on validation
        this.structureManager.updateStructurePreviewColors(this.structurePlacement, ui);

        // Update placement status
        if (!this.structurePlacement.isValid) {
            ui.updatePlacementStatus(this.structurePlacement.invalidReason, false);
        } else {
            ui.updatePlacementStatus('Valid placement', true);
        }
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

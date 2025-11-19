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
 * - modelManager for structure models
 * - structureManager for placement validation
 * - terrainRenderer for terrain height queries
 * - networkManager for server communication
 * - scene for adding/removing preview objects
 */

import * as THREE from 'three';
import { ui } from '../ui.js';
import { CONFIG } from '../config.js';
import { modelManager } from '../objects.js';
import { GridUIHelpers, TooltipHelper } from './GridUIHelpers.js';
import { RotationControls } from './RotationControls.js';

export class BuildMenu {
    constructor(dependencies) {
        // Store dependencies
        this.gameState = dependencies.gameState;
        this.scene = dependencies.scene;
        this.terrainRenderer = dependencies.terrainRenderer;
        this.structureManager = dependencies.structureManager;
        this.networkManager = dependencies.networkManager;
        this.inventoryUI = dependencies.inventoryUI;
        this.playerObject = dependencies.playerObject;

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
                // Tent structure (places on terrain, no foundation required)
                {
                    id: 'tent',
                    type: 'tent',
                    name: 'Tent',
                    width: 1,
                    height: 1,
                    imagePath: './structures/tent.png'
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
                // Dock structure (places on terrain like foundation, 10x1)
                {
                    id: 'dock',
                    type: 'dock',
                    name: 'Dock',
                    width: 1,
                    height: 1,
                    imagePath: './structures/dock.png'
                },
                // Road structure (terrain modification, no rotation, immediate build)
                {
                    id: 'road',
                    type: 'road',
                    name: 'Road',
                    width: 1,
                    height: 1,
                    imagePath: './structures/road.png'
                }
            ]
        };

        // Structure placement state
        this.structurePlacement = {
            active: false,
            phase: null,  // 'position' -> 'rotation' -> 'confirmed'
            structure: null,
            position: { x: 0, y: 0, z: 0 },
            rotation: 0,  // In degrees (snaps to 7.5°)
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
            }, 180);  // 180ms feels instant after pause
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
            // Create wrapper
            const structureWrapper = document.createElement('div');
            structureWrapper.className = 'build-menu-structure-wrapper';
            structureWrapper.dataset.structureId = structure.id;
            structureWrapper.style.position = 'absolute';

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
    onStructureClick(event, structure) {
        event.preventDefault();
        event.stopPropagation();

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

        // Set content
        titleEl.textContent = structure.name;

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
     * Creates a preview box and enters position phase
     */
    startStructurePlacement(structure) {
        this.structurePlacement.active = true;
        this.structurePlacement.phase = 'position';
        this.structurePlacement.structure = structure;
        this.structurePlacement.rotation = 0;
        this.structurePlacement.height = 2;  // Start at maximum height offset
        this.structurePlacement.validationPending = true;  // Show white glow initially
        this.structurePlacement.isValid = false;  // Initialize to false - must validate first
        this.structurePlacement.invalidReason = 'Not validated yet';

        // Special handling for roads - create circle preview instead of loading model
        if (structure.type === 'road') {
            const previewGroup = new THREE.Group();

            // Create circle geometry (radius 0.5, 32 segments for smooth circle)
            const circleGeometry = new THREE.CircleGeometry(0.5, 32);

            // Create green material (will change color based on validation)
            const circleMaterial = new THREE.MeshBasicMaterial({
                color: 0x00ff00,  // Green
                transparent: true,
                opacity: 0.6,
                side: THREE.DoubleSide,
                depthWrite: false
            });

            // Create mesh
            const circleMesh = new THREE.Mesh(circleGeometry, circleMaterial);

            // Rotate to lie flat (circles face Z axis by default, we need Y axis)
            circleMesh.rotation.x = -Math.PI / 2;

            // Add to preview group
            previewGroup.add(circleMesh);

            // Store references for color changes later
            this.structurePlacement.previewBox = previewGroup;
            this.structurePlacement.previewBox.userData.circleMesh = circleMesh;
            this.structurePlacement.previewBox.userData.modelType = 'road';
            this.structurePlacement.rotation = 0;  // Roads don't rotate

            // Add to scene
            previewGroup.visible = true;
            this.scene.add(previewGroup);

            ui.updateStatusLine1('Click to place road (within 1 unit of player)', 0);
            return;  // Skip normal model loading
        }

        // Load actual structure model for preview (foundation, foundationcorner, or foundationroundcorner)
        const structureModel = modelManager.getModel(structure.type);
        if (!structureModel) {
            console.error(`${structure.type} model not loaded for preview`);
            return;
        }

        const previewGroup = new THREE.Group();

        // Determine scale based on structure type
        let previewScale = 0.5;  // Default for other structures
        let glowScale = 0.52;

        if (structure.type === 'foundation' ||
            structure.type === 'foundationcorner' ||
            structure.type === 'foundationroundcorner' ||
            structure.type === '2x8foundation') {
            previewScale = 1.0;
            glowScale = 1.02;
        } else if (structure.type === 'crate') {
            previewScale = 1.0;
            glowScale = 1.02;
        } else if (structure.type === 'garden') {
            previewScale = 1.0;
            glowScale = 1.02;
        } else if (structure.type === 'house') {
            previewScale = 1.0;
            glowScale = 1.02;
        } else if (structure.type === 'campfire') {
            previewScale = 1.0;
            glowScale = 1.02;
        } else if (structure.type === 'market') {
            previewScale = 1.0;
            glowScale = 1.02;
        } else if (structure.type === 'outpost') {
            previewScale = 1.0;
            glowScale = 1.02;
        } else if (structure.type === 'dock') {
            previewScale = 1.0;
            glowScale = 1.02;
        } else if (structure.type === 'tent') {
            previewScale = 0.5;
            glowScale = 0.52;
        } else if (structure.type === 'ship') {
            previewScale = 1.0;
            glowScale = 1.02;
        }

        // Clone the structure model (semi-transparent)
        const foundationPreview = structureModel.clone();
        foundationPreview.scale.setScalar(previewScale); // Match actual structure scale

        // Make model semi-transparent
        foundationPreview.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                // Clone material to avoid affecting the original
                child.material = child.material.clone();
                child.material.transparent = true;
                child.material.opacity = 0.6;
                child.material.depthWrite = false;
            }
        });

        // Create glow outline (slightly larger duplicate with emissive material)
        const glowOutline = structureModel.clone();
        glowOutline.scale.setScalar(glowScale); // Slightly larger for outline effect
        glowOutline.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material = new THREE.MeshBasicMaterial({
                    color: 0x00ff00,
                    transparent: true,
                    opacity: 0.3,
                    side: THREE.BackSide, // Render backfaces for outline effect
                    depthWrite: false
                });
            }
        });

        previewGroup.add(glowOutline);
        previewGroup.add(foundationPreview);

        this.structurePlacement.previewBox = previewGroup;
        this.structurePlacement.previewBox.userData.foundationPreview = foundationPreview;
        this.structurePlacement.previewBox.userData.glowOutline = glowOutline;
        this.structurePlacement.previewBox.userData.modelType = structure.type;

        // Propagate model type to all children
        this.structurePlacement.previewBox.traverse((child) => {
            if (!child.userData) child.userData = {};
            child.userData.modelType = structure.type;
        });

        this.structurePlacement.previewBox.visible = true;
        this.scene.add(this.structurePlacement.previewBox);

        ui.updateStatusLine1('Move mouse to position structure, click to confirm', 0);
    }

    /**
     * Advance to the next placement phase
     * Phases: position -> rotation -> confirmed
     */
    advanceStructurePlacementPhase(mouseY) {
        const placement = this.structurePlacement;
        const structure = placement.structure;

        if (placement.phase === 'position') {
            // Special handling for roads and campfires - skip rotation, place immediately
            if (structure && (structure.type === 'road' || structure.type === 'campfire')) {
                // Validate placement
                const validation = this.structureManager.validateStructurePlacement(
                    placement,
                    'position',  // Still in position phase
                    this.playerObject ? this.playerObject.position : null
                );

                placement.isValid = validation.isValid;
                placement.invalidReason = validation.invalidReason;

                if (!placement.isValid) {
                    ui.updateStatusLine1(`Cannot place: ${placement.invalidReason}`, 3000);
                    return;  // Don't place if invalid
                }

                // Valid placement - skip rotation and confirm immediately
                this.confirmStructurePlacement();
                return;
            }

            // Allow advancement to rotation even with collision
            // User can explore rotation options to find valid placement angle
            placement.phase = 'rotation';

            // Initialize rotation to 0
            placement.rotation = 0;

            // Show rotation controls
            this.rotationControls.show(0);

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
                    ui.updateStatusLine1(placement.invalidReason, 0);
                } else {
                    ui.updateStatusLine1('Press Q/E or use buttons to rotate, Space/button to confirm', 0);
                }
            } else {
                ui.updateStatusLine1('Press Q/E or use buttons to rotate, Space/button to confirm', 0);
            }

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
                ui.updateStatusLine1(`Placement cancelled: ${placement.invalidReason}`, 3000);
                this.cancelStructurePlacement();
                return;
            }
            // All structures skip height phase and snap automatically
            // Structures now auto-calculate height based on terrain
            this.confirmStructurePlacement();
        }
    }

    /**
     * Confirm and place the structure/construction site
     */
    confirmStructurePlacement() {
        const placement = this.structurePlacement;
        const structure = placement.structure;

        if (!placement.isValid) {
            ui.updateStatusLine1(`Cannot place: ${placement.invalidReason}`, 3000);
            return;
        }

        // Special handling for water-based structures (ship)
        if (structure && structure.requiresWater) {
            // Ships are instant-build - send placement request to server
            this.networkManager.sendMessage('place_construction_site', {
                position: [placement.position.x, placement.position.y, placement.position.z],
                rotation: placement.rotation,
                scale: 1.0,
                targetStructure: structure.type
            });

            ui.updateStatusLine1(`${structure.name} placed!`, 3000);
            this.cancelStructurePlacement();
            return;
        }

        // Special handling for roads (immediate build, no construction site)
        if (structure && structure.type === 'road') {
            // 1. Check if player has 1 chiseledlimestone
            const hasChiseledLimestone = this.gameState.inventory.items.some(
                item => item.type === 'chiseledlimestone'
            );
            if (!hasChiseledLimestone) {
                ui.updateStatusLine1('Need 1 chiseledlimestone to build road', 3000);
                this.cancelStructurePlacement();
                return;
            }

            // 2. Check if player has hammer
            const hasHammer = this.gameState.inventory.items.some(item =>
                item.type === 'hammer' && item.durability > 0
            );
            if (!hasHammer) {
                ui.updateStatusLine1('Need hammer to build road', 3000);
                this.cancelStructurePlacement();
                return;
            }

            // 3. Remove chiseledlimestone immediately
            const limestone = this.gameState.inventory.items.find(
                item => item.type === 'chiseledlimestone'
            );
            const limestoneIndex = this.gameState.inventory.items.indexOf(limestone);
            this.gameState.inventory.items.splice(limestoneIndex, 1);

            // 4. Start 10-second build action
            this.gameState.activeAction = {
                object: null,  // No construction site for roads
                startTime: Date.now(),
                duration: 10000,  // 10 seconds for roads
                actionType: 'build_road',
                roadData: {
                    position: [placement.position.x, placement.position.y, placement.position.z],
                    rotation: 0
                }
            };

            // 5. Play hammer sound
            if (this.audioManager) {
                const sound = this.audioManager.playHammerSound();
                this.gameState.activeAction.sound = sound;
            }

            // 6. Start hammer animation if available
            // Note: Animation handled in game.js action system

            ui.updateStatusLine1('Building road...', 10000);
            this.cancelStructurePlacement();  // Remove preview
            return;
        }

        // Special handling for campfire (immediate build, no construction site, no tool required)
        if (structure && structure.type === 'campfire') {
            // 1. Check if player has 1 limestone
            const hasLimestone = this.gameState.inventory.items.some(
                item => item.type === 'limestone'
            );
            if (!hasLimestone) {
                ui.updateStatusLine1('Need 1 limestone to build campfire', 3000);
                this.cancelStructurePlacement();
                return;
            }

            // 2. Remove limestone immediately
            const limestone = this.gameState.inventory.items.find(
                item => item.type === 'limestone'
            );
            const limestoneIndex = this.gameState.inventory.items.indexOf(limestone);
            this.gameState.inventory.items.splice(limestoneIndex, 1);

            // 3. Start 6-second build action (no tool required)
            this.gameState.activeAction = {
                object: null,  // No construction site for campfire
                startTime: Date.now(),
                duration: 6000,  // 6 seconds
                actionType: 'build_campfire',
                campfireData: {
                    position: [placement.position.x, placement.position.y, placement.position.z],
                    rotation: placement.rotation || 0
                }
            };

            ui.updateStatusLine1('Building campfire...', 6000);
            this.cancelStructurePlacement();  // Remove preview
            return;
        }

        // Regular structure placement
        // Calculate average height of 4 corners for structure using actual dimensions
        const dims = this.structureManager.getGridDimensions(structure.type, placement.rotation || 0);
        const halfWidth = dims.width / 2;
        const halfDepth = dims.depth / 2;

        const corner1 = this.terrainRenderer.heightCalculator.calculateHeight(placement.position.x - halfWidth, placement.position.z - halfDepth);
        const corner2 = this.terrainRenderer.heightCalculator.calculateHeight(placement.position.x + halfWidth, placement.position.z - halfDepth);
        const corner3 = this.terrainRenderer.heightCalculator.calculateHeight(placement.position.x - halfWidth, placement.position.z + halfDepth);
        const corner4 = this.terrainRenderer.heightCalculator.calculateHeight(placement.position.x + halfWidth, placement.position.z + halfDepth);
        const averageHeight = (corner1 + corner2 + corner3 + corner4) / 4;

        // Snap to 0.25 grid and ensure structure is at least at height 1.02
        const constructionSiteY = Math.max(Math.ceil(averageHeight / 0.25) * 0.25, 1.02);

        // Final Y position is already calculated in placement.position.y (no manual height adjustment)
        const finalStructureY = placement.position.y;

        // Level terrain for specific structure types
        const structuresToLevel = ['crate', 'house', 'garden', 'outpost', 'tent', 'market'];
        if (structuresToLevel.includes(structure.type)) {
            // Level terrain with rectangular flat area and 1 unit smooth transition on all sides
            this.terrainRenderer.levelTerrainForStructure(
                placement.position.x,      // Center X
                placement.position.z,      // Center Z
                dims.width,                // Width from GRID_DIMENSIONS
                dims.depth,                // Depth from GRID_DIMENSIONS
                finalStructureY,           // Target height (the calculated average)
                structure.type,            // Structure type for logging
                placement.rotation || 0    // Rotation in degrees
            );
        }

        // Send to server to spawn construction site (server will broadcast to all clients)
        const messagePayload = {
            position: [placement.position.x, constructionSiteY, placement.position.z],
            rotation: placement.rotation,
            scale: 1.0,
            targetStructure: structure.type,
            finalFoundationY: finalStructureY  // Store final Y for final structure
        };
        console.log('[BuildMenu] Sending place_construction_site with position:', messagePayload.position);
        this.networkManager.sendMessage('place_construction_site', messagePayload);

        ui.updateStatusLine1('Construction site placed!', 3000);

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

        // Hide rotation controls
        this.rotationControls.hide();

        ui.updateStatusLine1('', 0);
        ui.updateStatusLine2('', 0);
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

        // Trigger validation (debounced - runs after mouse stops moving)
        this.validateStructurePlacementDebounced();
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

        // Update status line
        if (!this.structurePlacement.isValid) {
            ui.updateStatusLine1(this.structurePlacement.invalidReason, 0);
        } else {
            ui.updateStatusLine1('Press Q/E or use buttons to rotate, Space/button to confirm', 0);
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

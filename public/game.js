/**
 * Main Game Engine
 *
 * Handles game initialization, player controls, networking (WebSocket + WebRTC P2P),
 * chunk management, inventory, building, and combat systems.
 *
 * Configuration: All game constants in './config.js'
 */

import * as THREE from 'three';
import { ui } from './ui.js';
import { CONFIG, COMPUTED } from './config.js';
import { TerrainGenerator, TERRAIN_CONFIG } from './terrainsystem.js';
import { objectPlacer, modelManager } from './objects.js';
import { AIEnemy } from './ai-enemy.js';
import { GameState } from './core/GameState.js';
import { GameLoop } from './core/GameLoop.js';
import { GameInitializer } from './core/GameInitializer.js';
import { SceneManager } from './core/SceneManager.js';
import { PlayerModelSetup } from './core/PlayerModelSetup.js';
import { PlayerInventory } from './player/PlayerInventory.js';
import { PlayerHunger } from './player/PlayerHunger.js';
import { DeathManager } from './systems/DeathManager.js';
import { InventoryUI } from './ui/InventoryUI.js';
import { BuildMenu } from './ui/BuildMenu.js';
import { DeathScreen } from './ui/DeathScreen.js';
import { CraftingSystem } from './systems/CraftingSystem.js';
import { ResourceManager } from './systems/ResourceManager.js';
import { BuildingSystem } from './systems/BuildingSystem.js';
import { AnimationSystem } from './systems/AnimationSystem.js';
import { MobileEntitySystem } from './systems/MobileEntitySystem.js';
import { ActionManager } from './systems/ActionManager.js';
import { InteractionManager } from './systems/InteractionManager.js';
import { EffectManager } from './systems/EffectManager.js';
import { AmbientSoundSystem } from './systems/AmbientSoundSystem.js';
import { ScheduledShipSystem } from './systems/ScheduledShipSystem.js';
import { DockMerchantSystem } from './systems/DockMerchantSystem.js';
import { TrapperSystem } from './systems/TrapperSystem.js';
import { BoatSinkingSystem } from './systems/BoatSinkingSystem.js';
import { GrassGathering } from './systems/GrassGathering.js';
import { PhysicsManager, COLLISION_GROUPS } from './core/PhysicsManager.js';
import ChunkCoordinates from './core/ChunkCoordinates.js';
import { QualityGenerator } from './core/QualityGenerator.js';
import { LoginModal } from './ui/LoginModal.js';
import { SpawnScreen } from './ui/SpawnScreen.js';
import { findValidSpawnPoint, findValidSpawnNearStructure } from './spawn/SpawnUtils.js';
import { FriendsPanel } from './ui/FriendsPanel.js';
import { FactionPanel } from './ui/FactionPanel.js';
import { SettingsPanel } from './ui/SettingsPanel.js';
import { TasksPanel } from './ui/TasksPanel.js';
import { ControlsTutorial } from './ui/ControlsTutorial.js';
import { ThreatIndicator } from './ui/ThreatIndicator.js';
import { CombatHUD } from './ui/CombatHUD.js';
import { getAISpawnQueue } from './ai/AISpawnQueue.js';
import { getStructureCreationQueue } from './systems/StructureCreationQueue.js';
import { getChunkTransitionQueue, PRIORITY, TASK_TYPE } from './systems/ChunkTransitionQueue.js';

// ==========================================
// MAIN GAME CLASS
// ==========================================

class MultiplayerGame {
    constructor() {
        this.gameState = new GameState();

        // Input control flag (disabled during login modal, etc.)
        this.inputEnabled = true;

        // Chat input state
        this.chatInputOpen = false;
        this.chatInputElement = null;
        this.chatInputContainer = null;

        // Sensor-based proximity tracking (objectId -> THREE.Object3D)
        this.activeProximityObjects = new Map();

        // Object registry for fast lookups (objectId -> THREE.Object3D)
        // Populated lazily on first proximity check to avoid scene.traverse()
        this.objectRegistry = new Map();
        this.registryRefreshCounter = 0; // Counter for periodic registry refresh


        // Occupied outposts tracking (outpostId -> clientId)
        this.occupiedOutposts = new Map();

        // Outpost militia tracking (outpostId -> entityId)
        this.outpostMilitia = new Map();

        // Artillery militia tracking (artilleryId -> entityId)
        this.artilleryMilitia = new Map();

        // Initialize mobile entity system (boats, carts, horses)
        this.mobileEntitySystem = new MobileEntitySystem();

        // Initialize core systems (SceneManager will be initialized async in init())
        this.sceneManager = new SceneManager();
        this.scene = null;
        this.camera = null;
        this.renderer = null;

        // Initialize game loop
        this.gameLoop = new GameLoop();

        // Camera controller will be initialized after SceneManager
        this.cameraController = null;

        // Cached DOM reference for compass (set once, used every frame)
        this.compassInner = null;

        // Input manager will be initialized after SceneManager
        this.inputManager = null;

        // Initialize physics manager (will be initialized async)
        this.physicsManager = new PhysicsManager(null); // Scene will be set after initialization

        // Set up callback to clean objectRegistry when objects are removed
        this.physicsManager.onObjectRemoved = (objectId) => {
            this.objectRegistry.delete(objectId);
        };

        // Foundation validation now handled by BuildMenu module
        // Kept for backward compatibility if needed
        this.validationThrottleTimeout = null;

        // Initialize AI enemy properties (will be managed by aiEnemyManager)
        this.tentAIEnemies = null;
        this.aiEnemyController = null;
        this.aiEnemy = null;

        // Pathfinding test AI (for testing navigation system)
        this.pathfindingTestAI = null;

        // Navigation map completion flag
        this.allNavMapsComplete = false;

        // Reusable array for raycasting (avoids GC pressure from spread operators)
        this._raycastCandidates = [];

        // WASD movement state
        this.wasdKeys = { w: false, a: false, s: false, d: false };
        this.lastWASDMoveTime = 0;

        // Initialize GameInitializer for setup methods
        this.initializer = new GameInitializer(this);

        // Initialize game (async) and store promise
        this.initPromise = this.init();
    }

    async init() {
        // Delegate all initialization to GameInitializer
        await this.initializer.init();
    }

    /**
     * Connect to server and wait for connection to be established
     * @returns {Promise<void>}
     */
    connectAndWait() {
        return new Promise((resolve) => {
            let timeoutId = null;
            let resolved = false;

            // Listen for connection via transport's onConnect callback
            const originalOnConnect = this.networkManager.transport.onConnectCallback;

            this.networkManager.transport.onConnectCallback = () => {
                if (resolved) return;
                resolved = true;

                // Clear the timeout since we connected successfully
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }

                // Restore original callback and call it
                this.networkManager.transport.onConnectCallback = originalOnConnect;
                if (originalOnConnect) {
                    originalOnConnect();
                }
                resolve();
            };

            // Start connection
            this.networkManager.connect(CONFIG.NETWORKING.USE_ONLINE_SERVER);

            // Timeout after 10 seconds
            timeoutId = setTimeout(() => {
                if (resolved) return;
                resolved = true;
                console.warn('[Game] Server connection timeout - proceeding anyway');
                resolve();
            }, 10000);
        });
    }

    /**
     * Complete game initialization after spawn point is determined
     * @param {number} spawnX - Player spawn X coordinate
     * @param {number} spawnZ - Player spawn Z coordinate
     */
    async initializeWithSpawn(spawnX, spawnZ) {

        // === QUALITY SETTINGS INJECTION POINT ===
        // Must happen BEFORE setupComponents() creates systems
        const quality = this.gameState.loadQualitySetting();
        const qualityConfig = CONFIG.QUALITY[quality];

        // Update CONFIG (for ChunkManager, BillboardSystem)
        CONFIG.CHUNKS.LOAD_RADIUS = qualityConfig.CHUNK_LOAD_RADIUS;
        CONFIG.RENDERING.FOG_NEAR = qualityConfig.FOG_NEAR;
        CONFIG.RENDERING.FOG_FAR = qualityConfig.FOG_FAR;

        // Update TERRAIN_CONFIG (for GeometryClipmap, WaterSystem)
        TERRAIN_CONFIG.CLIPMAP_LEVELS = qualityConfig.CLIPMAP_LEVELS;
        TERRAIN_CONFIG.FOG_NEAR = qualityConfig.FOG_NEAR;
        TERRAIN_CONFIG.FOG_FAR = qualityConfig.FOG_FAR;
        TERRAIN_CONFIG.TERRAIN_FADE_START = qualityConfig.TERRAIN_FADE_START;
        TERRAIN_CONFIG.TERRAIN_FADE_END = qualityConfig.TERRAIN_FADE_END;
        TERRAIN_CONFIG.WATER_CHUNKS_RADIUS = qualityConfig.WATER_CHUNKS_RADIUS;

        // Update water effect toggles (WaterSystem reads from TERRAIN_CONFIG at creation)
        TERRAIN_CONFIG.WATER_ENABLE_SSS = qualityConfig.WATER_ENABLE_SSS;
        TERRAIN_CONFIG.WATER_ENABLE_DETAIL_NORMALS = qualityConfig.WATER_ENABLE_DETAIL_NORMALS;
        TERRAIN_CONFIG.WATER_ENABLE_CREST_COLOR = qualityConfig.WATER_ENABLE_CREST_COLOR;
        TERRAIN_CONFIG.WATER_ENABLE_GLITTER = qualityConfig.WATER_ENABLE_GLITTER;
        TERRAIN_CONFIG.WATER_ENABLE_DEEP_COLOR = qualityConfig.WATER_ENABLE_DEEP_COLOR;
        TERRAIN_CONFIG.WATER_ENABLE_FOAM = qualityConfig.WATER_ENABLE_FOAM;
        TERRAIN_CONFIG.WATER_ENABLE_ENV_MAP = qualityConfig.WATER_ENABLE_ENV_MAP;
        TERRAIN_CONFIG.WATER_WAVE_COUNT = qualityConfig.WATER_WAVE_COUNT;
        TERRAIN_CONFIG.WATER_TRANSPARENT = qualityConfig.WATER_TRANSPARENT;

        // Update terrain effect toggles
        TERRAIN_CONFIG.TERRAIN_ENABLE_NORMAL_PERTURB = qualityConfig.TERRAIN_ENABLE_NORMAL_PERTURB;
        TERRAIN_CONFIG.TERRAIN_ENABLE_PROCEDURAL_BLEND = qualityConfig.TERRAIN_ENABLE_PROCEDURAL_BLEND;
        TERRAIN_CONFIG.TERRAIN_PROCEDURAL_OCTAVES = qualityConfig.TERRAIN_PROCEDURAL_OCTAVES;
        TERRAIN_CONFIG.TERRAIN_ENABLE_TRIPLANAR = qualityConfig.TERRAIN_ENABLE_TRIPLANAR;

        // Update depth texture settings (less frequent re-renders and smaller texture on lower quality)
        TERRAIN_CONFIG.DEPTH_SNAP_MULTIPLIER = qualityConfig.DEPTH_SNAP_MULTIPLIER;
        TERRAIN_CONFIG.DEPTH_TEXTURE_SIZE = qualityConfig.DEPTH_TEXTURE_SIZE;

        // Update billboard system capacity (reduces GPU memory on lower quality)
        TERRAIN_CONFIG.BILLBOARD_MAX_INSTANCES = qualityConfig.BILLBOARD_MAX_INSTANCES;

        // Update structure LOD distances (billboards appear sooner on lower quality)
        CONFIG.LOD.STRUCTURE_LOD_START = qualityConfig.STRUCTURE_LOD_START;
        CONFIG.LOD.STRUCTURE_LOD_END = qualityConfig.STRUCTURE_LOD_END;

        // Update rock model max instances (store for RockModelSystem to read)
        CONFIG.ROCK_MODEL_MAX_INSTANCES = qualityConfig.ROCK_MODEL_MAX_INSTANCES;

        // Update smoke enabled flag (store for smoke systems to read)
        CONFIG.SMOKE_ENABLED = qualityConfig.SMOKE_ENABLED;

        // Apply renderer settings (pixel ratio, tone mapping)
        if (this.sceneManager.renderer) {
            // Pixel ratio - lower = less fill rate on retina displays
            this.sceneManager.renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityConfig.PIXEL_RATIO));

            // Tone mapping - disable for performance on LOW
            if (qualityConfig.TONE_MAPPING) {
                this.sceneManager.renderer.toneMapping = THREE.ACESFilmicToneMapping;
                this.sceneManager.renderer.toneMappingExposure = 0.5;
            } else {
                this.sceneManager.renderer.toneMapping = THREE.NoToneMapping;
            }
        }

        // Apply camera near/far planes (affects depth buffer precision)
        if (this.sceneManager.camera) {
            this.sceneManager.camera.near = qualityConfig.CAMERA_NEAR || 1.0;
            this.sceneManager.camera.far = qualityConfig.CAMERA_FAR;
            this.sceneManager.camera.updateProjectionMatrix();
        }

        // Store water polygon offset for terrainsystem to read
        TERRAIN_CONFIG.WATER_POLYGON_OFFSET = qualityConfig.WATER_POLYGON_OFFSET || 0;

        // Update scene.fog (already created in Phase 1, needs updating)
        if (this.sceneManager.scene.fog) {
            this.sceneManager.scene.fog.near = qualityConfig.FOG_NEAR;
            this.sceneManager.scene.fog.far = qualityConfig.FOG_FAR;
            this.sceneManager.scene.fog.color.setHex(qualityConfig.FOG_COLOR);
        }
        // Also update renderer clear color to match fog
        if (this.sceneManager.renderer) {
            this.sceneManager.renderer.setClearColor(qualityConfig.FOG_COLOR);
        }
        // Update billboard fog uniforms (BillboardSystem was created in Phase 1 with default values)
        if (this.billboardSystem) {
            this.billboardSystem.updateFogUniforms();
        }

        // Clear auth message processing interval (game loop will handle it now)
        if (this.authMessageInterval) {
            clearInterval(this.authMessageInterval);
            this.authMessageInterval = null;
        }

        // Store spawn point
        this.pendingSpawnPoint = { x: spawnX, z: spawnZ };

        // Complete remaining setup via GameInitializer
        await this.initializer.setupComponents(spawnX, spawnZ);
        this.setupGameLoop();

        // Initialize spawn-related panels (only for logged-in users)
        if (!this.gameState.isGuest) {
            this.friendsPanel = new FriendsPanel(this.gameState, this.networkManager);
            this.factionPanel = new FactionPanel(this.gameState, this.networkManager);
        }

        // Initialize settings panel (always available)
        this.settingsPanel = new SettingsPanel(
            this.gameState,
            this.audioManager,
            this.friendsPanel,
            this.factionPanel
        );

        // Initialize tasks panel for all players (beginners tutorial)
        this.tasksPanel = new TasksPanel(this.gameState, this.networkManager);
        // Check server data for accounts (tasksPanelClosed flag)
        if (!this.gameState.isGuest && this.gameState.playerData) {
            this.tasksPanel.checkServerClosed(this.gameState.playerData);
        }
        // Show tasks panel if not closed
        if (!this.tasksPanel.isClosed) {
            this.tasksPanel.show();
        }

        // Show controls tutorial on first spawn
        this.controlsTutorial = new ControlsTutorial(this.gameState);
        this.controlsTutorial.show();

        // Mark as fully initialized (but don't join chunk yet - do that in start() after all systems are ready)
        this.isFullyInitialized = true;
    }

    /**
     * Initialize Friends and Faction panels for logged-in users
     * Called after successful login/registration if user was previously a guest
     */
    initializeFriendsFactionPanels() {
        if (this.gameState.isGuest) {
            console.log('[Game] Cannot initialize panels - user is still guest');
            return;
        }

        // Create FriendsPanel if it doesn't exist
        if (!this.friendsPanel) {
            this.friendsPanel = new FriendsPanel(this.gameState, this.networkManager);
        }

        // Create FactionPanel if it doesn't exist
        if (!this.factionPanel) {
            this.factionPanel = new FactionPanel(this.gameState, this.networkManager);
        }

        // Update SettingsPanel with new panel references
        if (this.settingsPanel) {
            this.settingsPanel.updatePanelRefs(this.friendsPanel, this.factionPanel);
        }
    }

    setupInput() {
        // Use InputManager for mouse/pointer events
        this.inputManager.onPointerDown(this.onPointerDown.bind(this));
        this.inputManager.onPointerMove(this.onPointerMove.bind(this));

        // Use InputManager for keyboard events
        this.inputManager.onKeyDown((event) => {
            // Block all game input if disabled (e.g., during login modal)
            if (!this.inputEnabled) {
                return;
            }

            // Don't process game keys if typing in a text field
            if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
                return;
            }

            // Q/E keys for rotation during placement
            if (event.key === 'q' || event.key === 'Q' || event.key === 'e' || event.key === 'E') {
                if (this.buildMenu && this.buildMenu.handleKeyRotation(event.key)) {
                    return;  // BuildMenu handled it
                }
            }

            // ESC key cancels structure placement
            if (event.key === 'Escape' && this.buildMenu && this.buildMenu.isPlacementActive()) {
                this.buildMenu.cancelStructurePlacement();
                ui.showToast('Placement cancelled', 'info');
            }

            // ESC key cancels demolish action
            if (event.key === 'Escape' && this.gameState.activeAction) {
                this.cancelChoppingAction();
            }

            // WASD key tracking
            const key = event.key.toLowerCase();
            if (key === 'w' || key === 'a' || key === 's' || key === 'd') {
                this.wasdKeys[key] = true;
            }

            // Enter key opens chat input
            if (event.key === 'Enter' && !this.chatInputOpen) {
                this.openChatInput();
            }
        });

        // WASD key release
        this.inputManager.onKeyUp((event) => {
            const key = event.key.toLowerCase();
            if (key === 'w' || key === 'a' || key === 's' || key === 'd') {
                this.wasdKeys[key] = false;

                // Check if all WASD keys are released (player stopped)
                const allReleased = !this.wasdKeys.w && !this.wasdKeys.a && !this.wasdKeys.s && !this.wasdKeys.d;
                if (allReleased && this.networkManager && this.playerObject) {
                    // Broadcast final position when player stops moving
                    this.networkManager.broadcastP2P({
                        type: 'player_pos',
                        t: Date.now(),
                        p: this.playerObject.position.toArray(),
                        r: this.playerObject.rotation.y
                    });
                }
            }
        });

        // Register escape handlers for UI panels (higher priority = checked first)
        this.inputManager.registerEscapeHandler(() => {
            if (this.gameState.inventoryOpen) {
                this.inventoryUI.toggleInventory();
                return true;
            }
            return false;
        }, 100);

        this.inputManager.registerEscapeHandler(() => {
            if (this.friendsPanel?.isVisible) {
                this.friendsPanel.hide();
                return true;
            }
            return false;
        }, 50);

        this.inputManager.registerEscapeHandler(() => {
            if (this.factionPanel?.isVisible) {
                this.factionPanel.hide();
                return true;
            }
            return false;
        }, 50);

        // Chat input escape handler (high priority to close chat first)
        this.inputManager.registerEscapeHandler(() => {
            if (this.chatInputOpen) {
                this.closeChatInput();
                return true;
            }
            return false;
        }, 150);

        // Note: TasksPanel intentionally has no ESC handler - it should stay open

        // === Camera Drag Controls ===

        // Track if camera drag is active (left-click hold)
        this.cameraDragButton = null;

        // Start potential drag on left-click (button 0)
        this.inputManager.onDragStart((event) => {
            if (event.button === 0) {
                this.cameraDragButton = 0;
                // Don't start camera drag yet - wait for threshold
            }
        });

        // Update camera rotation/pitch during drag (only after threshold crossed)
        this.inputManager.onDragMove((deltaX, deltaY, event, wasDrag) => {
            if (this.cameraDragButton === 0 && wasDrag) {
                // Start camera drag once threshold is crossed
                if (!this.cameraController.getIsDragging()) {
                    this.cameraController.startDrag();
                }
                this.cameraController.updateDrag(deltaX, deltaY);
            }
        });

        // End drag
        this.inputManager.onDragEnd((event, wasDrag) => {
            this.cameraDragButton = null;
            this.cameraController.endDrag();
        });

        // Scroll wheel: rotation during placement, otherwise zoom
        this.inputManager.onWheel((delta) => {
            // Try rotation first
            if (this.buildMenu && this.buildMenu.handleScrollRotation(delta)) {
                return;  // BuildMenu handled it
            }
            // Default: camera zoom
            if (!this.gameState.inventoryOpen) {
                this.cameraController.scrollZoom(delta);
            }
        });
    }

    setupUI() {
        ui.initializeUI({
            sendServerMessage: this.networkManager.sendMessage.bind(this.networkManager),
            clientId: this.gameState.clientId,
            getCurrentChunkX: () => this.gameState.currentPlayerChunkX,
            getCurrentChunkZ: () => this.gameState.currentPlayerChunkZ,
            getNearestObject: () => this.gameState.nearestObject,
            getNearestStructure: () => this.gameState.nearestStructure,
            hasToolWithDurability: (toolType) => this.hasToolWithDurability(toolType),
            onRemoveObject: (object) => {
                if (object) {
                    // Normalize structure objects (THREE.js objects with userData) to match natural object format
                    let normalizedObject = object;
                    if (object.userData && object.userData.modelType) {
                        // This is a structure from nearestStructure - normalize it
                        normalizedObject = {
                            id: object.userData.objectId,
                            name: object.userData.modelType,
                            position: object.position.clone(),
                            chunkKey: object.userData.chunkKey,
                            quality: object.userData.quality,
                            scale: object.userData.originalScale || object.scale,
                            isGrowing: object.userData.isGrowing,
                            growthScale: object.userData.scale // Growth scale for planted trees (0.25 to 1.0)
                        };
                    }

                    // Check if it's a log - if so, treat as firewood harvest
                    const isLog = normalizedObject.name.endsWith('_log') || normalizedObject.name === 'log';
                    const isRock = normalizedObject.name === 'limestone' || normalizedObject.name === 'sandstone' || normalizedObject.name === 'clay' || normalizedObject.name === 'iron';

                    const isVegetables = normalizedObject.name === 'vegetables';

                    if (isVegetables) {
                        // Vegetables - use grass gathering system (no tool required)
                        const hasSpace = this.inventoryUI?.findEmptyInventoryPosition(1, 1);
                        if (!hasSpace) {
                            ui.showConfirmDialog('No inventory space for vegetables! Continue anyway?').then(confirmed => {
                                if (confirmed && this.grassGathering) {
                                    this.grassGathering.startGatherVegetablesAction(normalizedObject);
                                }
                            });
                            return;
                        }
                        if (this.grassGathering) {
                            this.grassGathering.startGatherVegetablesAction(normalizedObject);
                        }
                    } else if (isLog) {
                        // Check inventory space for firewood (2x4)
                        const hasSpace = this.inventoryUI?.findEmptyInventoryPosition(2, 4);
                        if (!hasSpace) {
                            ui.showConfirmDialog('No inventory space for firewood! Continue anyway?').then(confirmed => {
                                if (confirmed) this.startHarvestAction(normalizedObject, 'firewood');
                            });
                            return;
                        }
                        this.startHarvestAction(normalizedObject, 'firewood');
                    } else if (isRock) {
                        // Check inventory space for stone (1x1)
                        const hasSpace = this.inventoryUI?.findEmptyInventoryPosition(1, 1);
                        if (!hasSpace) {
                            ui.showConfirmDialog('No inventory space for stone! Continue anyway?').then(confirmed => {
                                if (confirmed) this.startHarvestAction(normalizedObject, 'stone');
                            });
                            return;
                        }
                        this.startHarvestAction(normalizedObject, 'stone');
                    } else {
                        // Start the removal action for trees/structures (includes timer, animation, sound)
                        // For structures (not trees), show confirmation dialog first
                        const isStructure = object.userData && object.userData.modelType;
                        if (isStructure) {
                            const structureName = normalizedObject.name.charAt(0).toUpperCase() + normalizedObject.name.slice(1);
                            ui.showConfirmDialog(`Demolish ${structureName}?`).then(confirmed => {
                                if (confirmed) this.startRemovalAction(normalizedObject);
                            });
                        } else {
                            // Trees - no confirmation needed
                            this.startRemovalAction(normalizedObject);
                        }
                    }
                }
            },
            onHarvestLog: (object, harvestType) => {
                if (object) {
                    // Check inventory space before harvesting
                    // Item sizes: planks/firewood = 2x4, stone = 1x1
                    const isWood = harvestType === 'planks' || harvestType === 'firewood';
                    const width = isWood ? 2 : 1;
                    const height = isWood ? 4 : 1;

                    const hasSpace = this.inventoryUI?.findEmptyInventoryPosition(width, height);
                    if (!hasSpace) {
                        const itemName = harvestType === 'planks' ? 'planks' : harvestType === 'firewood' ? 'firewood' : 'stone';
                        ui.showConfirmDialog(`No inventory space for ${itemName}! Continue anyway?`).then(confirmed => {
                            if (confirmed) this.startHarvestAction(object, harvestType);
                        });
                        return;
                    }

                    this.startHarvestAction(object, harvestType);
                }
            },
            onStartFishing: () => {
                const mobileEntityState = this.gameState.mobileEntityState;
                const waterVehicleTypes = ['boat', 'sailboat', 'ship2'];
                const isOnBoatForFishing = mobileEntityState?.isActive &&
                                           mobileEntityState?.phase === 'piloting' &&
                                           waterVehicleTypes.includes(mobileEntityState?.entityType);
                const effectiveNearWater = isOnBoatForFishing || this.gameState.nearWater;

                if (this.resourceManager && effectiveNearWater && !this.gameState.activeAction && !this.gameState.isMoving) {
                    this.resourceManager.startFishingAction();
                }
            },
            onStartGatherVines: () => {
                if (this.grassGathering && this.gameState.onGrass && !this.gameState.activeAction && !this.gameState.isMoving) {
                    this.grassGathering.startGatheringAction();
                }
            },
            onGatherMushroom: () => {
                if (this.grassGathering && this.gameState.mushroomAvailable && !this.gameState.isMoving) {
                    this.grassGathering.gatherMushroom();
                    // Disable mushroom button after gathering
                    this.gameState.mushroomAvailable = false;
                }
            },
            onGatherVegetableSeeds: () => {
                if (this.grassGathering && this.gameState.vegetableSeedsAvailable && !this.gameState.isMoving) {
                    this.grassGathering.gatherVegetableSeeds();
                    // Disable vegetable seeds button after gathering
                    this.gameState.vegetableSeedsAvailable = false;
                }
            },
            onGatherLimestone: () => {
                if (this.grassGathering && this.gameState.limestoneAvailable && !this.gameState.isMoving) {
                    this.grassGathering.gatherLimestone();
                    // Disable limestone button after gathering
                    this.gameState.limestoneAvailable = false;
                }
            },
            onGatherSeeds: () => {
                if (this.grassGathering && this.gameState.seedsAvailable && !this.gameState.isMoving && this.gameState.seedTreeType && this.gameState.nearestObject) {
                    this.grassGathering.gatherSeeds(this.gameState.seedTreeType, this.gameState.nearestObject);
                    // Disable seeds button after gathering
                    this.gameState.seedsAvailable = false;
                    this.gameState.seedTreeType = null;
                }
            },
            onGatherVegetables: () => {
                if (this.grassGathering && this.gameState.vegetablesGatherAvailable && !this.gameState.isMoving && this.gameState.nearestObject?.name === 'vegetables') {
                    this.grassGathering.startGatherVegetablesAction(this.gameState.nearestObject);
                    // Disable vegetables gather button after starting action
                    this.gameState.vegetablesGatherAvailable = false;
                }
            },
            onHarvestDeer: () => {
                if (this.gameState.nearestDeerCorpse && !this.gameState.isMoving && !this.gameState.activeAction) {
                    this.startHarvestDeerAction(this.gameState.nearestDeerCorpse);
                }
            },
            onHarvestBrownbear: () => {
                if (this.gameState.nearestBrownbearCorpse && !this.gameState.isMoving && !this.gameState.activeAction) {
                    this.startHarvestBrownbearAction(this.gameState.nearestBrownbearCorpse);
                }
            },
            onRepairStructure: () => {
                // Phase 2: Repair System - Start repair action
                // Mobile entities (boat, sailboat, ship2, horse) are tracked separately from structures
                // Towable entities (cart, artillery) are also tracked separately
                const mobileRepairableTypes = ['boat', 'sailboat', 'ship2', 'horse'];
                const towableRepairableTypes = ['cart', 'artillery'];
                const mobileEntity = this.gameState.nearestMobileEntity;
                const towableEntity = this.gameState.nearestTowableEntity;
                const isRepairableMobileEntity = mobileEntity?.type && mobileRepairableTypes.includes(mobileEntity.type);
                const isRepairableTowableEntity = towableEntity?.userData?.modelType && towableRepairableTypes.includes(towableEntity.userData.modelType);

                // Determine repair target: mobile entity > towable entity > structure
                let repairTarget = null;
                if (isRepairableMobileEntity) {
                    repairTarget = mobileEntity.object;
                } else if (isRepairableTowableEntity) {
                    repairTarget = towableEntity;
                } else {
                    repairTarget = this.gameState.nearestStructure;
                }

                if (repairTarget && !this.gameState.activeAction && !this.gameState.isMoving) {
                    const structure = repairTarget;
                    const structureType = structure.userData?.modelType;
                    const isHorse = structureType === 'horse';

                    // Horse feeding requires vegetables, everything else requires hammer
                    if (isHorse) {
                        const hasVegetables = this.gameState.inventory.items.some(item => item.type === 'vegetables');
                        if (!hasVegetables) {
                            ui.updateStatus('Need vegetables to feed horse');
                            return;
                        }
                    } else {
                        // Check if player has hammer or improvised tool
                        const hasHammer = this.gameState.inventory.items.some(item =>
                            (item.type === 'hammer' || item.type === 'improvisedtool') && item.durability > 0
                        );

                        if (!hasHammer) {
                            ui.updateStatus('Need hammer or improvised tool to repair');
                            return;
                        }
                    }

                    // Start repair/feed action (6 seconds for repair, 3 seconds for feeding)
                    this.gameState.activeAction = {
                        object: structure,
                        startTime: Date.now(),
                        duration: isHorse ? 3000 : 6000,
                        actionType: 'repair'
                    };

                    // Play appropriate sound
                    if (this.audioManager) {
                        if (!isHorse) {
                            const sound = this.audioManager.playHammerSound();
                            this.gameState.activeAction.sound = sound;
                        }
                        // No special sound for feeding horse for now
                    }

                    // Start animation (only for repair, not feeding)
                    if (!isHorse && this.animationMixer && this.choppingAction) {
                        if (this.animationAction) {
                            this.animationAction.stop();
                        }
                        this.choppingAction.reset();
                        this.choppingAction.play();
                    }

                    // Broadcast sound to peers (only for repair)
                    if (!isHorse) {
                        this.networkManager.broadcastP2P({
                            type: 'player_sound',
                            payload: {
                                soundType: 'hammer',
                                startTime: Date.now()
                            }
                        });
                    }

                    ui.updateStatus(isHorse ? 'Feeding horse...' : 'Repairing...');
                }
            },
            onClimb: () => {
                // Start climbing an outpost
                if (this.gameState.nearestStructure &&
                    this.gameState.nearestStructure.userData?.modelType === 'outpost' &&
                    !this.gameState.climbingState.isClimbing &&
                    !this.gameState.activeAction) {

                    const outpost = this.gameState.nearestStructure;
                    const outpostId = outpost.userData.objectId;

                    // Check if outpost is already occupied
                    if (this.occupiedOutposts.has(outpostId)) {
                        ui.showToast('Outpost is occupied', 'warning');
                        return;
                    }

                    // Start climbing
                    this.playerController.startClimbing(outpost, this.gameState);

                    // Mark outpost as occupied
                    this.occupiedOutposts.set(outpostId, this.gameState.clientId);

                    // Broadcast climbing state
                    this.networkManager.broadcastP2P({
                        type: 'player_climb_start',
                        payload: {
                            outpostId: outpostId,
                            position: this.playerObject.position.toArray()
                        }
                    });

                    ui.updateStatus('🧗 Climbing...');
                }
            },
            onClimbDown: () => {
                // Start descending from outpost
                if (this.gameState.climbingState.isClimbing &&
                    this.gameState.climbingState.climbingPhase === 'occupied') {

                    const outpostId = this.gameState.climbingState.outpostId;

                    // Start descent animation
                    this.playerController.endClimbing(this.gameState);

                    // Broadcast climb end (will clear occupancy when descent completes)
                    this.networkManager.broadcastP2P({
                        type: 'player_climb_end',
                        payload: {
                            outpostId: outpostId
                        }
                    });

                    ui.updateStatus('🧗 Climbing down...');
                }
            },
            onMobileEntityAction: () => {
                this.handleMobileEntityAction();
            },
            onAttachCart: () => {
                this.handleAttachCart();
            },
            onReleaseCart: () => {
                this.handleReleaseCart();
            },
            onLoadCrate: () => {
                // Route to correct handler based on vehicle type
                if (this.gameState.cartAttachmentState.isAttached) {
                    this.handleLoadCrate();
                } else if (this.gameState.mobileEntityState?.phase === 'piloting') {
                    this.handleLoadCrateToSailboat();
                }
            },
            onUnloadCrate: () => {
                // Route to correct handler based on vehicle type
                if (this.gameState.cartAttachmentState.isAttached) {
                    this.handleUnloadCrate();
                } else if (this.gameState.mobileEntityState?.phase === 'piloting') {
                    this.handleUnloadCrateFromSailboat();
                }
            },
            onLoadShipArtillery: () => {
                this.handleLoadArtilleryToShip();
            },
            onUnloadShipArtillery: () => {
                this.handleUnloadArtilleryFromShip();
            },
            onLoadShipHorse: () => {
                this.handleLoadHorseToShip();
            },
            onUnloadShipHorse: () => {
                this.handleUnloadHorseFromShip();
            },
            onManPortCannon: () => {
                this.handleManShipCannon(0);  // Port = slot 0
            },
            onManStarboardCannon: () => {
                this.handleManShipCannon(1);  // Starboard = slot 1
            },
            onReturnToHelm: () => {
                this.handleReturnToHelm();
            },
            onTakeHelm: () => {
                this.handleGunnerTakeHelm();
            },
            onSwitchCannon: () => {
                this.handleGunnerSwitchCannon();
            },
            onManArtillery: () => {
                this.handleManArtillery();
            },
            onLeaveArtillery: () => {
                this.handleLeaveArtillery();
            },
            onFireArtillery: () => {
                this.fireArtillery(Date.now());
            },
            onTalkToMerchant: () => {
                // Talk to dock merchant - show dialogue
                if (this.gameState.nearMerchant) {
                    const dialogue = this.dockMerchantSystem.getMerchantDialogue(this.gameState.nearMerchant.dockId);
                    ui.showMerchantDialogue(dialogue);
                    // Notify tasks panel
                    if (window.tasksPanel) {
                        window.tasksPanel.onTalkToMerchant();
                    }
                }
            },
            onTalkToTrapper: () => {
                // Talk to trapper - show resource info dialogue
                if (this.gameState.nearTrapper) {
                    const coins = this.playerInventory.getTotalCoins();
                    const canAfford = coins >= (CONFIG.TRAPPER_CAMPS?.INFO_COST || 5);
                    ui.showTrapperDialogue(
                        "I know the quality of resources in this region. Pay me and I'll tell you what's worth harvesting.",
                        canAfford,
                        coins
                    );
                }
            },
            onTrapperPay: () => {
                // Pay trapper for resource info
                const cost = CONFIG.TRAPPER_CAMPS?.INFO_COST || 5;
                if (this.playerInventory.removeCoins(cost)) {
                    const trapper = this.gameState.nearTrapper;
                    if (trapper && this.trapperSystem) {
                        const info = this.trapperSystem.getResourceInfo(trapper.chunkX, trapper.chunkZ);
                        ui.showTrapperResourceInfo(info);
                    }
                }
            },
            onTrapperNo: () => {
                // Close trapper dialogue
                ui.hideTrapperDialogue();
            },
            onSeekProprietor: () => {
                // Show proprietor sale dialogue
                const nearestStructure = this.gameState.nearestStructure;
                if (!nearestStructure) return;

                const structureType = nearestStructure.userData?.modelType || 'structure';
                const capitalizedType = structureType.charAt(0).toUpperCase() + structureType.slice(1);

                const dialogueText = `A craftsman seeks a place to work. Sell this ${capitalizedType} and receive 10 coins?\n\nOnce sold:\n- The structure will no longer decay\n- You will lose access to its inventory\n- A worker will spawn when players are nearby\n- This cannot be undone`;

                ui.showProprietorDialogue(dialogueText);

                // Store pending sale info
                this.gameState.pendingProprietorSale = {
                    structureId: nearestStructure.userData?.objectId,
                    chunkId: `chunk_${nearestStructure.userData?.chunkKey}`,
                    structureType: structureType
                };
            },
            onProprietorSell: () => {
                // Complete the sale - player receives coins for selling their structure
                const pending = this.gameState.pendingProprietorSale;
                if (!pending) return;

                // Add coins to player inventory (selling the structure)
                this.playerInventory.addCoins(10);

                // Send sale message to server
                this.networkManager.sendMessage('sell_to_proprietor', {
                    structureId: pending.structureId,
                    chunkId: pending.chunkId
                });

                ui.hideProprietorDialogue();
                ui.showToast(`${pending.structureType.charAt(0).toUpperCase() + pending.structureType.slice(1)} sold to proprietor! +10 coins`, 'success');
                this.gameState.pendingProprietorSale = null;
            },
            onProprietorNo: () => {
                // Close dialogue
                ui.hideProprietorDialogue();
                this.gameState.pendingProprietorSale = null;
            },
            onRequestMilitia: () => {
                // Request militia spawn at player's tent
                const nearestStructure = this.gameState.nearestStructure;
                if (!nearestStructure) return;

                const tentId = nearestStructure.userData?.objectId;
                const chunkKey = nearestStructure.userData?.chunkKey;
                if (!tentId || !chunkKey) return;

                // Get militia cost from config
                const militiaCost = window.CONFIG?.MILITIA?.COST || 1;

                // Check if player has enough influence
                if ((this.gameState.influence || 0) < militiaCost) {
                    ui.showToast('Not enough influence', 'error');
                    return;
                }

                // Check if player has faction
                if (this.gameState.factionId === null) {
                    ui.showToast('You must join a faction first', 'error');
                    return;
                }

                // Check if tent already has entity (bandit or militia)
                if (this.banditController?.entities?.has(tentId)) {
                    ui.showToast('This tent already has an active defender', 'error');
                    return;
                }

                // Get faction shirt color
                const factionColors = window.CONFIG?.FACTION_COLORS?.[this.gameState.factionId];
                const shirtColor = factionColors?.shirt || 0x5a5a5a;

                // Deduct influence locally
                this.gameState.influence -= militiaCost;

                // Send request to server
                this.networkManager.sendMessage('request_militia', {
                    tentId: tentId,
                    chunkId: `chunk_${chunkKey}`,
                    factionId: this.gameState.factionId
                });

                // Spawn militia locally (we are authority)
                const tentPosition = nearestStructure.position;
                this.banditController.spawnMilitiaForTent(
                    { id: tentId, position: { x: tentPosition.x, z: tentPosition.z } },
                    this.gameState.factionId,
                    this.gameState.clientId,
                    shirtColor
                );

                ui.showToast('Militia spawned!', 'success');
            },
            onRequestOutpostMilitia: () => {
                // Request militia spawn at player's outpost (or same faction outpost)
                const nearestStructure = this.gameState.nearestStructure;
                if (!nearestStructure) return;
                if (nearestStructure.userData?.modelType !== 'outpost') return;

                const outpostId = nearestStructure.userData?.objectId;
                const chunkKey = nearestStructure.userData?.chunkKey;
                if (!outpostId || !chunkKey) return;

                // Get militia cost from config
                const militiaCost = window.CONFIG?.MILITIA?.COST || 1;

                // Check if player has enough influence
                if ((this.gameState.influence || 0) < militiaCost) {
                    ui.showToast('Not enough influence', 'error');
                    return;
                }

                // Check if player has faction
                if (this.gameState.factionId === null) {
                    ui.showToast('You must join a faction first', 'error');
                    return;
                }

                // Check if outpost already has entity (bandit or militia)
                if (this.banditController?.entities?.has(outpostId)) {
                    ui.showToast('This outpost already has a defender', 'error');
                    return;
                }

                // Check if outpost is occupied by player
                if (this.occupiedOutposts?.has(outpostId)) {
                    ui.showToast('Outpost is occupied', 'error');
                    return;
                }

                // Check if outpost already has militia
                if (this.outpostMilitia?.has(outpostId)) {
                    ui.showToast('This outpost already has militia', 'error');
                    return;
                }

                // Get faction shirt color
                const factionColors = window.CONFIG?.FACTION_COLORS?.[this.gameState.factionId];
                const shirtColor = factionColors?.shirt || 0x5a5a5a;

                // Deduct influence locally
                this.gameState.influence -= militiaCost;

                // Send request to server
                this.networkManager.sendMessage('request_outpost_militia', {
                    outpostId: outpostId,
                    chunkId: `chunk_${chunkKey}`,
                    factionId: this.gameState.factionId
                });

                // Spawn militia locally (we are authority)
                this.banditController.spawnOutpostMilitia(
                    nearestStructure,
                    this.gameState.factionId,
                    this.gameState.clientId,
                    shirtColor
                );

                ui.showToast('Tower militia spawned!', 'success');
            },
            onRequestArtilleryMilitia: () => {
                // Request gunner militia spawn at player's artillery (or same faction artillery)
                const nearestStructure = this.gameState.nearestStructure;
                if (!nearestStructure) return;
                if (nearestStructure.userData?.modelType !== 'artillery') return;

                const artilleryId = nearestStructure.userData?.objectId;
                const chunkKey = nearestStructure.userData?.chunkKey;
                if (!artilleryId || !chunkKey) return;

                // Get militia cost from config
                const militiaCost = window.CONFIG?.MILITIA?.COST || 1;

                // Check if player has enough influence
                if ((this.gameState.influence || 0) < militiaCost) {
                    ui.showToast('Not enough influence', 'error');
                    return;
                }

                // Check if player has faction
                if (this.gameState.factionId === null) {
                    ui.showToast('You must join a faction first', 'error');
                    return;
                }

                // Check if artillery is being towed
                const attachState = this.gameState.artilleryAttachmentState;
                if (attachState?.isAttached && attachState?.artilleryId === artilleryId) {
                    ui.showToast('Cannot assign gunner - artillery being towed', 'error');
                    return;
                }

                // Check if artillery is being manned by player
                const manningState = this.gameState.artilleryManningState;
                if (manningState?.isManning && manningState?.artilleryId === artilleryId) {
                    ui.showToast('Artillery is being manned', 'error');
                    return;
                }

                // Check if artillery already has entity
                if (this.banditController?.entities?.has(artilleryId)) {
                    ui.showToast('This artillery already has a gunner', 'error');
                    return;
                }

                // Check if artillery is occupied
                if (this.mobileEntitySystem?.isOccupied(artilleryId)) {
                    ui.showToast('Artillery is occupied', 'error');
                    return;
                }

                // Check if artillery already has militia
                if (this.artilleryMilitia?.has(artilleryId)) {
                    ui.showToast('This artillery already has a gunner', 'error');
                    return;
                }

                // Get faction shirt color
                const factionColors = window.CONFIG?.FACTION_COLORS?.[this.gameState.factionId];
                const shirtColor = factionColors?.shirt || 0x5a5a5a;

                // Deduct influence locally
                this.gameState.influence -= militiaCost;

                // Send request to server
                this.networkManager.sendMessage('request_artillery_militia', {
                    artilleryId: artilleryId,
                    chunkId: `chunk_${chunkKey}`,
                    factionId: this.gameState.factionId
                });

                // Spawn militia locally (we are authority)
                this.banditController.spawnArtilleryMilitia(
                    nearestStructure,
                    this.gameState.factionId,
                    this.gameState.clientId,
                    shirtColor
                );

                ui.showToast('Gunner assigned to artillery!', 'success');
            },
            onTalkToBaker: () => {
                // Talk to baker - show status dialogue
                if (this.gameState.nearBaker) {
                    const bakerData = this.gameState.nearBaker;
                    let dialogue;

                    if (bakerData.stuckReason) {
                        dialogue = bakerData.stuckReason;
                    } else {
                        const stateMessages = {
                            'idle': 'I am waiting for my next task.',
                            'seeking_apples': 'I am going to collect apples.',
                            'collecting_apples': 'I am picking apples from the tree.',
                            'seeking_firewood': 'I am going to get firewood from the market.',
                            'collecting_firewood': 'I am collecting firewood.',
                            'returning': 'I am returning to the bakery.',
                            'depositing': 'I am putting items in the bakery.',
                            'waiting_for_tarts': 'I am waiting for the tarts to bake.',
                            'waiting_for_apples': 'I am waiting for apple trees to have apples.',
                            'waiting_for_firewood': 'I am waiting for firewood at the market.',
                            'collecting_tarts': 'I am collecting the finished tarts.',
                            'delivering': 'I am delivering tarts to the market.',
                            'depositing_tarts': 'I am stocking the market with tarts.',
                            'removing_excess_firewood': 'I am removing excess firewood from the bakery.',
                            'clearing_slot_for_firewood': 'I am making room for firewood in the bakery.',
                            'assessing_bakery': 'I am checking what the bakery needs.',
                            'stuck': 'I have run into a problem.'
                        };
                        dialogue = stateMessages[bakerData.state] || 'I am working at the bakery.';
                    }

                    ui.showBakerDialogue(dialogue);
                }
            },
            onBakerDismiss: () => {
                ui.hideBakerDialogue();
            },
            onTalkToGardener: () => {
                // Talk to gardener - show status dialogue
                if (this.gameState.nearGardener) {
                    const gardenerData = this.gameState.nearGardener;
                    let dialogue;

                    if (gardenerData.stuckReason) {
                        dialogue = gardenerData.stuckReason;
                    } else {
                        const stateMessages = {
                            'idle': 'I am waiting for my next task.',
                            'seeking_plant_spot': 'I am looking for a good spot to plant.',
                            'planting': 'I am planting vegetables.',
                            'returning': 'I am returning to my building.',
                            'waiting_for_harvest': `I am waiting for vegetables to grow. (${gardenerData.plantedCount} planted)`,
                            'seeking_harvest': 'I am going to harvest vegetables.',
                            'harvesting': 'I am harvesting vegetables.',
                            'delivering': 'I am delivering vegetables to the market.',
                            'depositing': 'I am stocking the market.',
                            'seeking_tree_spot': 'I am looking for a good spot to plant a tree.',
                            'planting_tree': 'I am planting a tree.',
                            'stuck': 'I have run into a problem.'
                        };
                        dialogue = stateMessages[gardenerData.state] || 'I am working in the garden.';
                    }

                    ui.showGardenerDialogue(dialogue);
                }
            },
            onGardenerDismiss: () => {
                ui.hideGardenerDialogue();
            },
            onTalkToWoodcutter: () => {
                // Talk to woodcutter - show status dialogue
                if (this.gameState.nearWoodcutter) {
                    const woodcutterData = this.gameState.nearWoodcutter;
                    let dialogue;

                    if (woodcutterData.stuckReason) {
                        dialogue = woodcutterData.stuckReason;
                    } else {
                        const stateMessages = {
                            'idle': 'I am waiting for my next task.',
                            'seeking_tree': 'I am looking for a tree to cut down.',
                            'cutting_tree': 'I am cutting down a tree.',
                            'seeking_log': 'I am looking for a log to process.',
                            'processing_log': 'I am processing this log into planks.',
                            'delivering': 'I am delivering planks to the market.',
                            'depositing': 'I am stocking the market.',
                            'returning': 'I am returning to my building.',
                            'stuck': 'I have run into a problem.'
                        };
                        dialogue = stateMessages[woodcutterData.state] || 'I am working on woodcutting.';
                    }

                    ui.showWoodcutterDialogue(dialogue);
                }
            },
            onWoodcutterDismiss: () => {
                ui.hideWoodcutterDialogue();
            },
            onTalkToMiner: () => {
                // Talk to miner - show status dialogue
                if (this.gameState.nearMiner) {
                    const minerData = this.gameState.nearMiner;
                    let dialogue;

                    if (minerData.stuckReason) {
                        dialogue = minerData.stuckReason;
                    } else {
                        const stateMessages = {
                            'idle': 'I am waiting for my next task.',
                            'seeking_rock': 'I am looking for a rock to mine.',
                            'mining': 'I am mining this rock.',
                            'delivering': 'I am delivering stone to the market.',
                            'depositing': 'I am stocking the market.',
                            'returning': 'I am returning to my building.',
                            'stuck': 'I have run into a problem.'
                        };
                        dialogue = stateMessages[minerData.state] || 'I am working on mining.';
                    }

                    ui.showMinerDialogue(dialogue);
                }
            },
            onMinerDismiss: () => {
                ui.hideMinerDialogue();
            },
            onTalkToFisherman: () => {
                // Talk to fisherman - show status dialogue
                if (this.gameState.nearFisherman) {
                    const fishermanData = this.gameState.nearFisherman;
                    let dialogue;

                    if (fishermanData.stuckReason) {
                        dialogue = fishermanData.stuckReason;
                    } else {
                        const stateMessages = {
                            'idle': 'I am waiting for my next task.',
                            'seeking_water': 'I am heading to the water to fish.',
                            'fishing': 'I am fishing.',
                            'seeking_firewood': 'I am going to get firewood.',
                            'collecting_firewood': 'I am collecting firewood.',
                            'returning': 'I am returning to my building.',
                            'depositing': 'I am putting items in the building.',
                            'waiting_for_output': 'I am waiting for the fish to cook.',
                            'waiting_for_fish': 'I am waiting for fish to appear.',
                            'waiting_for_firewood': 'I am waiting for firewood.',
                            'collecting_output': 'I am collecting the cooked fish.',
                            'delivering': 'I am delivering fish to the market.',
                            'depositing_output': 'I am stocking the market.',
                            'removing_excess_firewood': 'I am removing excess firewood.',
                            'clearing_slot_for_firewood': 'I am making room for firewood.',
                            'assessing_structure': 'I am checking what the building needs.',
                            'stuck': 'I have run into a problem.'
                        };
                        dialogue = stateMessages[fishermanData.state] || 'I am working as a fisherman.';
                    }

                    ui.showFishermanDialogue(dialogue);
                }
            },
            onFishermanDismiss: () => {
                ui.hideFishermanDialogue();
            },
            onTalkToBlacksmith: () => {
                // Talk to blacksmith - show status dialogue
                if (this.gameState.nearBlacksmith) {
                    const blacksmithData = this.gameState.nearBlacksmith;
                    let dialogue;

                    if (blacksmithData.stuckReason) {
                        dialogue = blacksmithData.stuckReason;
                    } else {
                        const stateMessages = {
                            'idle': 'I am waiting for my next task.',
                            'seeking_input': 'I am going to collect materials.',
                            'collecting_input': 'I am collecting materials.',
                            'seeking_firewood': 'I am going to get firewood.',
                            'collecting_firewood': 'I am collecting firewood.',
                            'returning': 'I am returning to the forge.',
                            'depositing': 'I am putting materials in the forge.',
                            'waiting_for_output': 'I am waiting for the items to be forged.',
                            'waiting_for_input': 'I am waiting for materials.',
                            'waiting_for_firewood': 'I am waiting for firewood.',
                            'collecting_output': 'I am collecting the forged items.',
                            'delivering': 'I am delivering goods to the market.',
                            'depositing_output': 'I am stocking the market.',
                            'removing_excess_firewood': 'I am removing excess firewood.',
                            'clearing_slot_for_firewood': 'I am making room for firewood.',
                            'assessing_structure': 'I am checking what the forge needs.',
                            'stuck': 'I have run into a problem.'
                        };
                        dialogue = stateMessages[blacksmithData.state] || 'I am working at the forge.';
                    }

                    ui.showBlacksmithDialogue(dialogue);
                }
            },
            onBlacksmithDismiss: () => {
                ui.hideBlacksmithDialogue();
            },
            onTalkToIronWorker: () => {
                // Talk to iron worker - show status dialogue
                if (this.gameState.nearIronWorker) {
                    const ironWorkerData = this.gameState.nearIronWorker;
                    let dialogue;

                    if (ironWorkerData.stuckReason) {
                        dialogue = ironWorkerData.stuckReason;
                    } else {
                        const stateMessages = {
                            'idle': 'I am waiting for my next task.',
                            'seeking_input': 'I am going to collect ore.',
                            'collecting_input': 'I am collecting ore.',
                            'seeking_firewood': 'I am going to get firewood.',
                            'collecting_firewood': 'I am collecting firewood.',
                            'returning': 'I am returning to the ironworks.',
                            'depositing': 'I am putting materials in the ironworks.',
                            'waiting_for_output': 'I am waiting for the iron to smelt.',
                            'waiting_for_input': 'I am waiting for ore.',
                            'waiting_for_firewood': 'I am waiting for firewood.',
                            'collecting_output': 'I am collecting the smelted iron.',
                            'delivering': 'I am delivering iron to the market.',
                            'depositing_output': 'I am stocking the market.',
                            'removing_excess_firewood': 'I am removing excess firewood.',
                            'clearing_slot_for_firewood': 'I am making room for firewood.',
                            'assessing_structure': 'I am checking what the ironworks needs.',
                            'stuck': 'I have run into a problem.'
                        };
                        dialogue = stateMessages[ironWorkerData.state] || 'I am working at the ironworks.';
                    }

                    ui.showIronWorkerDialogue(dialogue);
                }
            },
            onIronWorkerDismiss: () => {
                ui.hideIronWorkerDialogue();
            },
            onTalkToTileWorker: () => {
                // Talk to tile worker - show status dialogue
                if (this.gameState.nearTileWorker) {
                    const tileWorkerData = this.gameState.nearTileWorker;
                    let dialogue;

                    if (tileWorkerData.stuckReason) {
                        dialogue = tileWorkerData.stuckReason;
                    } else {
                        const stateMessages = {
                            'idle': 'I am waiting for my next task.',
                            'seeking_input': 'I am going to collect clay.',
                            'collecting_input': 'I am collecting clay.',
                            'seeking_firewood': 'I am going to get firewood.',
                            'collecting_firewood': 'I am collecting firewood.',
                            'returning': 'I am returning to the tileworks.',
                            'depositing': 'I am putting materials in the tileworks.',
                            'waiting_for_output': 'I am waiting for the tiles to fire.',
                            'waiting_for_input': 'I am waiting for clay.',
                            'waiting_for_firewood': 'I am waiting for firewood.',
                            'collecting_output': 'I am collecting the fired tiles.',
                            'delivering': 'I am delivering tiles to the market.',
                            'depositing_output': 'I am stocking the market.',
                            'removing_excess_firewood': 'I am removing excess firewood.',
                            'clearing_slot_for_firewood': 'I am making room for firewood.',
                            'assessing_structure': 'I am checking what the tileworks needs.',
                            'stuck': 'I have run into a problem.'
                        };
                        dialogue = stateMessages[tileWorkerData.state] || 'I am working at the tileworks.';
                    }

                    ui.showTileWorkerDialogue(dialogue);
                }
            },
            onTileWorkerDismiss: () => {
                ui.hideTileWorkerDialogue();
            },
            onTalkToStoneMason: () => {
                // Talk to stone mason - show status dialogue
                if (this.gameState.nearStoneMason) {
                    const stoneMasonData = this.gameState.nearStoneMason;
                    let dialogue;

                    if (stoneMasonData.stuckReason) {
                        dialogue = stoneMasonData.stuckReason;
                    } else {
                        const stateMessages = {
                            'idle': 'I am waiting for my next task.',
                            'going_to_market': 'I am heading to the market for stone.',
                            'collecting': 'I am collecting stone.',
                            'returning': 'I am returning to my workshop.',
                            'chiseling': 'I am chiseling the stone.',
                            'delivering': 'I am delivering stonework to the market.',
                            'depositing': 'I am stocking the market.',
                            'stuck': 'I have run into a problem.'
                        };
                        dialogue = stateMessages[stoneMasonData.state] || 'I am working as a stone mason.';
                    }

                    ui.showStoneMasonDialogue(dialogue);
                }
            },
            onStoneMasonDismiss: () => {
                ui.hideStoneMasonDialogue();
            },
            onResize: this.onResize.bind(this),
            resumeAudio: () => {
                if (this.audioManager) {
                    this.audioManager.resumeContext();
                }
            },
            toggleInventory: (targetStructureId) => this.inventoryUI.toggleInventory(targetStructureId),
            toggleBuildMenu: () => {
                // Will be available after initialization
                if (this.buildMenu) {
                    this.buildMenu.toggleBuildMenu();
                }
            },
            toggleSettings: () => {
                if (this.settingsPanel) {
                    this.settingsPanel.toggle();
                }
            },
            toggleFriends: () => {
                if (this.gameState.isGuest) {
                    console.log('[Game] Friends button clicked but user is guest');
                    return;
                }
                if (!this.friendsPanel) {
                    console.error('[Game] Friends button clicked but panel not initialized!');
                    return;
                }
                this.friendsPanel.toggle();
            },
            toggleFaction: () => {
                if (this.gameState.isGuest) {
                    console.log('[Game] Faction button clicked but user is guest');
                    return;
                }
                if (!this.factionPanel) {
                    console.error('[Game] Faction button clicked but panel not initialized!');
                    return;
                }
                this.factionPanel.toggle();
            },
            toggleConstructionInventory: () => {
                // Delegate to BuildingSystem once initialized
                if (this.buildingSystem) {
                    this.buildingSystem.toggleConstructionInventory();
                }
            },
            onBuildConstruction: () => {
                // Delegate to BuildingSystem once initialized
                if (this.buildingSystem) {
                    this.buildingSystem.startBuildAction();
                }
            }
        });
        window.addEventListener('resize', this.onResize.bind(this));
    }

    async start() {
        // Note: Connection is already established in phase 1 (init), no need to show connecting status

        // Wait for models to load before setting up player
        this.loadingScreen.setStatus('Loading models...', 7);
        await new Promise(r => setTimeout(r, 0));

        await modelManager.loadAllModels();

        // Load and setup player model
        this.loadingScreen.setStatus('Setting up player...', 8);
        await new Promise(r => setTimeout(r, 0));

        new PlayerModelSetup(this).setup();

        // Initialize InventoryUI with all dependencies
        this.inventoryUI = new InventoryUI(this.gameState, this);

        // Initialize PlayerHunger system (starts at spawn)
        this.playerHunger = new PlayerHunger(this.playerInventory, ui, this.inventoryUI, this);

        // Initialize game systems
        this.loadingScreen.setStatus('Initializing systems...', 9);
        await new Promise(r => setTimeout(r, 0));

        // Initialize CraftingSystem
        this.craftingSystem = new CraftingSystem(
            this.gameState,
            this.networkManager,
            this.audioManager,
            this.inventoryUI
        );
        this.craftingSystem.setGameReference(this);

        // Initialize ResourceManager
        this.resourceManager = new ResourceManager(
            this.gameState,
            this.networkManager,
            this.audioManager,
            this.inventoryUI
        );
        this.resourceManager.setGameReference(this);

        // Initialize GrassGathering
        this.grassGathering = new GrassGathering(
            this.gameState,
            this.navigationManager,
            this.resourceManager,
            this.inventoryUI,
            this.networkManager
        );
        this.grassGathering.setGameReference(this);
        this.grassGathering.setTerrainGenerator(this.terrainGenerator);

        // Initialize BuildingSystem
        this.buildingSystem = new BuildingSystem(
            this.gameState,
            this.networkManager,
            this.audioManager,
            this.inventoryUI
        );
        this.buildingSystem.setGameReference(this);

        // Initialize ActionManager
        this.actionManager = new ActionManager(this);

        // Initialize EffectManager
        this.effectManager = new EffectManager(this);

        // Wire up effectManager to combat systems for gunsmoke
        if (this.playerCombat) {
            this.playerCombat.setEffectManager(this.effectManager);
        }
        if (this.avatarManager) {
            this.avatarManager.setEffectManager(this.effectManager);
        }

        // Initialize AmbientSoundSystem
        this.ambientSoundSystem = new AmbientSoundSystem(this);

        // Initialize AnimationSystem
        this.animationSystem = new AnimationSystem(this.scene);

        // Initialize ScheduledShipSystem (for dock ship arrivals)
        this.scheduledShipSystem = new ScheduledShipSystem(this.scene, this.animationSystem);
        // Set network manager for trade messages (networkManager created in init phase)
        if (this.networkManager) {
            this.scheduledShipSystem.setNetworkManager(this.networkManager);
        }
        // Set game reference for physics manager access (merchant ship colliders)
        this.scheduledShipSystem.setGame(this);

        // Initialize BoatSinkingSystem (for merchant ship collisions)
        this.boatSinkingSystem = new BoatSinkingSystem(this.scene, this.animationSystem);

        // Set boat sinking system and audio manager for merchant ship collision handling
        this.scheduledShipSystem.setBoatSinkingSystem(this.boatSinkingSystem);
        this.scheduledShipSystem.setAudioManager(this.audioManager);

        // Initialize DockMerchantSystem (for merchants that arrive on ships)
        // Must be before InteractionManager so it can reference it
        this.dockMerchantSystem = new DockMerchantSystem(this.scene, this.scheduledShipSystem);

        // Initialize TrapperSystem (for regional resource info NPCs)
        this.trapperSystem = new TrapperSystem(this.scene, this.terrainGenerator);

        // Initialize InteractionManager
        this.interactionManager = new InteractionManager(this);
        this.interactionManager.setPhysicsManager(this.physicsManager);

        // Prepare UI
        this.loadingScreen.setStatus('Preparing interface...', 10);
        await new Promise(r => setTimeout(r, 0));

        // Set up callbacks for InventoryUI
        this.inventoryUI.onChiselingStart = this.craftingSystem.startChiselingAction.bind(this.craftingSystem);
        this.inventoryUI.onItemCombine = this.craftingSystem.combineItems.bind(this.craftingSystem);
        this.inventoryUI.onProximityCheck = this.checkProximityToObjects.bind(this);
        this.inventoryUI.craftingSystem = this.craftingSystem;
        this.inventoryUI.onInventoryClosed = () => {
            // Callback when inventory closes - can be used for future needs
        };

        // Initialize inventory UI
        this.inventoryUI.initialize();

        // Initialize build menu UI
        this.buildMenu = new BuildMenu({
            gameState: this.gameState,
            scene: this.scene,
            terrainGenerator: this.terrainGenerator,
            structureManager: this.structureManager,
            networkManager: this.networkManager,
            inventoryUI: this.inventoryUI,
            playerObject: this.playerObject,
            audioManager: this.audioManager
        });

        // Initialize DeathScreen
        this.deathScreen = new DeathScreen(this.gameState, this);
        this.deathScreen.initialize();

        // Initialize threat direction indicator
        this.threatIndicator = new ThreatIndicator();

        // Initialize combat HUD (accuracy/range display)
        this.combatHUD = new CombatHUD();

        // Initialize DeathManager
        this.deathManager = new DeathManager(this);

        // LoadingScreen is already initialized in init()
        // Note: With clipmap terrain, there's no per-chunk loading event
        // The loading screen will need to be updated differently (TODO: Phase 4)

        // Note: MessageRouter is now created in phase 1 (init) for early auth handling
        // Initialize grid slots
        const grid = document.getElementById('buildMenuGrid');
        for (let row = 0; row < this.buildMenu.buildMenu.rows; row++) {
            for (let col = 0; col < this.buildMenu.buildMenu.cols; col++) {
                const slot = document.createElement('div');
                slot.className = 'build-menu-slot';
                slot.dataset.row = row;
                slot.dataset.col = col;
                grid.appendChild(slot);
            }
        }

        // Note: networkManager.connect() is now called in phase 1 (init)
        // so it's ready for auth before setupUI runs

        // Note: Physics colliders are now registered automatically when objects are created
        // No need for manual registration like the old collision system

        // Transition from init status messages to chunk loading phase
        this.loadingScreen.setLoadingChunks();

        // Now that all systems are ready, join the chunk at spawn position
        // This registers the client with the server and triggers chunk loading
        this.messageRouter.joinChunkAtSpawn();

        // Start the game loop - this will process the chunk_objects_state response
        this.gameLoop.start();

    }

    // --- Server Message Handlers ---

    handleServerMessage(type, payload) {
        // Delegate all message handling to MessageRouter
        if (this.messageRouter) {
            this.messageRouter.handleMessage(type, payload);
        }
    }

    // ==========================================
    // ACTION METHODS - Called from UI and game loop
    // ==========================================

    startRemovalAction(object) {
        this.actionManager.startRemovalAction(object);
    }

    startHarvestAction(object, harvestType) {
        // Delegate to ActionManager
        this.actionManager.startHarvestAction(object, harvestType);
    }

    /**
     * Start deer harvesting action (6 seconds, like vegetables)
     */
    startHarvestDeerAction(deerCorpse) {
        console.log('[DEBUG] startHarvestDeerAction called with:', deerCorpse);
        // Guard: Prevent starting new action if one is already in progress
        if (this.gameState.activeAction) {
            return;
        }

        if (!this.playerObject || !deerCorpse) {
            console.log('[DEBUG] startHarvestDeerAction early return - playerObject:', !!this.playerObject, 'deerCorpse:', !!deerCorpse);
            return;
        }

        // Check cooldown
        if (this.gameState.harvestCooldown) {
            const remaining = this.gameState.harvestCooldown.endTime - Date.now();
            if (remaining > 0) {
                ui.updateStatus(`Rest needed: ${Math.ceil(remaining / 1000)}s`);
                return;
            }
            this.gameState.harvestCooldown = null;
        }

        // Set active action
        this.gameState.activeAction = {
            deerCorpse: deerCorpse,
            startTime: Date.now(),
            duration: CONFIG.ACTIONS.BUILD_DURATION,  // 6 seconds
            actionType: 'harvest_deer'
        };
        console.log('[DEBUG] activeAction set:', this.gameState.activeAction);
        console.log('[DEBUG] stored deerCorpse:', this.gameState.activeAction.deerCorpse);

        // Play vines/gathering sound
        if (this.audioManager) {
            const sound = this.audioManager.playVinesSound();
            this.gameState.activeAction.sound = sound;
        }

        // Start chopping animation
        if (this.animationMixer && this.choppingAction) {
            if (this.animationAction) this.animationAction.stop();
            this.choppingAction.reset();
            this.choppingAction.play();
        }

        // Broadcast to peers
        this.networkManager.broadcastP2P({
            type: 'player_vines_gathering',
            payload: {
                startTime: Date.now(),
                duration: CONFIG.ACTIONS.BUILD_DURATION
            }
        });

        this.networkManager.broadcastP2P({
            type: 'player_sound',
            payload: { soundType: 'vines', startTime: Date.now() }
        });

        ui.updateStatus('Harvesting deer...');
    }

    /**
     * Complete deer harvesting - add meat to inventory
     */
    completeHarvestDeerAction(deerCorpse) {
        console.log('[DEBUG] completeHarvestDeerAction called', { deerCorpse });
        if (!deerCorpse) {
            console.log('[DEBUG] deerCorpse is null/undefined!');
            return;
        }
        console.log('[DEBUG] chunkKey:', deerCorpse.chunkKey);
        console.log('[DEBUG] deerController exists:', !!this.deerController);

        // Get quality from chunk (like mushrooms/vegetables)
        const worldSeed = TERRAIN_CONFIG.SEED || 12345;
        const quality = QualityGenerator.getQuality(worldSeed, deerCorpse.chunkX, deerCorpse.chunkZ, 'deer');
        console.log('[DEBUG] quality:', quality, 'worldSeed:', worldSeed);

        // Create raw meat item
        const rawMeat = {
            id: `rawmeat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'rawmeat',
            x: -1,
            y: -1,
            width: 1,
            height: 1,
            rotation: 0,
            quality: quality,
            durability: 20 * (quality / 100)
        };

        // Add to inventory
        if (this.tryAddItemToInventory(rawMeat)) {
            console.log('[DEBUG] Item added successfully');
            ui.updateActionStatus(`Harvested raw meat! (Quality: ${quality})`, 3000);

            if (this.gameState.inventoryOpen && this.inventoryUI) {
                this.inventoryUI.renderInventory();
            }
            if (this.playerInventory) {
                ui.updateInventoryFullStatus(this.playerInventory.isFull());
            }

            // Remove deer from world (broadcasts to peers)
            const result = this.deerController.harvestDeer(deerCorpse.chunkKey);
            console.log('[DEBUG] harvestDeer result:', result);
        } else {
            console.log('[DEBUG] Inventory full!');
            ui.showToast('Inventory full!', 'warning');
        }
    }

    /**
     * Start brownbear harvesting action (6 seconds, like deer)
     */
    startHarvestBrownbearAction(brownbearCorpse) {
        // Guard: Prevent starting new action if one is already in progress
        if (this.gameState.activeAction) {
            return;
        }

        if (!this.playerObject || !brownbearCorpse) {
            return;
        }

        // Check cooldown
        if (this.gameState.harvestCooldown) {
            const remaining = this.gameState.harvestCooldown.endTime - Date.now();
            if (remaining > 0) {
                ui.updateStatus(`Rest needed: ${Math.ceil(remaining / 1000)}s`);
                return;
            }
            this.gameState.harvestCooldown = null;
        }

        // Set active action
        this.gameState.activeAction = {
            brownbearCorpse: brownbearCorpse,
            startTime: Date.now(),
            duration: CONFIG.ACTIONS.BUILD_DURATION,  // 6 seconds
            actionType: 'harvest_brownbear'
        };

        // Play vines/gathering sound
        if (this.audioManager) {
            const sound = this.audioManager.playVinesSound();
            this.gameState.activeAction.sound = sound;
        }

        // Start chopping animation
        if (this.animationMixer && this.choppingAction) {
            if (this.animationAction) this.animationAction.stop();
            this.choppingAction.reset();
            this.choppingAction.play();
        }

        // Broadcast to peers
        this.networkManager.broadcastP2P({
            type: 'player_vines_gathering',
            payload: {
                startTime: Date.now(),
                duration: CONFIG.ACTIONS.BUILD_DURATION
            }
        });

        this.networkManager.broadcastP2P({
            type: 'player_sound',
            payload: { soundType: 'vines', startTime: Date.now() }
        });

        ui.updateStatus('Harvesting brown bear...');
    }

    /**
     * Complete brownbear harvesting - add 2 meat to inventory
     */
    completeHarvestBrownbearAction(brownbearCorpse) {
        if (!brownbearCorpse) {
            return;
        }

        // Get quality from chunk (like deer)
        const worldSeed = TERRAIN_CONFIG.SEED || 12345;
        const quality = QualityGenerator.getQuality(worldSeed, brownbearCorpse.chunkX, brownbearCorpse.chunkZ, 'brownbear');

        // Track how many items successfully added
        let itemsAdded = 0;

        // Create and add 2 raw meat items
        for (let i = 0; i < 2; i++) {
            const rawMeat = {
                id: `rawmeat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'rawmeat',
                x: -1,
                y: -1,
                width: 1,
                height: 1,
                rotation: 0,
                quality: quality,
                durability: 20 * (quality / 100)
            };

            if (this.tryAddItemToInventory(rawMeat)) {
                itemsAdded++;
            } else {
                break;  // Inventory full, stop trying
            }
        }

        if (itemsAdded > 0) {
            ui.updateActionStatus(`Harvested ${itemsAdded} raw meat! (Quality: ${quality})`, 3000);

            if (this.gameState.inventoryOpen && this.inventoryUI) {
                this.inventoryUI.renderInventory();
            }
            if (this.playerInventory) {
                ui.updateInventoryFullStatus(this.playerInventory.isFull());
            }

            // Remove brownbear from world (broadcasts to peers)
            this.brownBearController.harvestBrownbear(brownbearCorpse.denId);
        } else {
            ui.showToast('Inventory full!', 'warning');
        }
    }

    updateChoppingAction() {
        if (this.actionManager) {
            this.actionManager.updateChoppingAction();
        }
    }

    cancelChoppingAction() {
        this.actionManager.cancelChoppingAction();
    }

    completeActiveAction() {
        this.actionManager.completeActiveAction();
    }

    // ==========================================
    // CHAT METHODS
    // ==========================================

    /**
     * Initialize chat input elements and event listeners
     */
    setupChatInput() {
        this.chatInputContainer = document.getElementById('chatInputContainer');
        this.chatInputElement = document.getElementById('chatInput');

        if (!this.chatInputElement || !this.chatInputContainer) {
            console.warn('[Chat] Chat input elements not found');
            return;
        }

        // Handle Enter key to send message
        this.chatInputElement.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.sendChatMessage();
            }
            // Escape is handled by the InputManager escape handler
        });

        // Handle blur (clicking outside) to close chat
        this.chatInputElement.addEventListener('blur', () => {
            // Small delay to allow Enter key to process first
            setTimeout(() => {
                if (this.chatInputOpen) {
                    this.closeChatInput();
                }
            }, 100);
        });
    }

    /**
     * Open the chat input
     */
    openChatInput() {
        if (this.chatInputOpen) return;
        if (!this.chatInputContainer || !this.chatInputElement) return;

        this.chatInputOpen = true;
        this.chatInputContainer.classList.add('visible');
        this.chatInputElement.value = '';
        this.chatInputElement.focus();
    }

    /**
     * Close the chat input without sending
     */
    closeChatInput() {
        if (!this.chatInputOpen) return;

        this.chatInputOpen = false;
        if (this.chatInputContainer) {
            this.chatInputContainer.classList.remove('visible');
        }
        if (this.chatInputElement) {
            this.chatInputElement.blur();
            this.chatInputElement.value = '';
        }
    }

    /**
     * Send the chat message and broadcast to peers
     */
    sendChatMessage() {
        if (!this.chatInputElement) return;

        const text = this.chatInputElement.value.trim();
        this.closeChatInput();

        if (!text) return;

        // Broadcast to all connected peers
        if (this.networkManager) {
            this.networkManager.broadcastP2P({
                type: 'player_chat',
                payload: { text }
            });
        }

        // Also show above local player's head
        if (this.nameTagManager) {
            // Main player is registered as 'main_player' in GameInitializer
            this.nameTagManager.setChatMessage('main_player', text);
        }
    }

    /**
     * Update local player's faction colors (shirt and name tag)
     * Call this when faction changes
     * @param {number|null} factionId - 1 (Southguard), 3 (Northmen), or null (neutral)
     */
    updateLocalPlayerFactionColors(factionId) {
        const factionColors = CONFIG.FACTION_COLORS[factionId] || CONFIG.FACTION_COLORS.default;

        // Update shirt color
        if (this.playerShirtMesh) {
            this.playerShirtMesh.material.color.setHex(factionColors.shirt);
        }

        // Update name tag color
        if (this.nameTagManager) {
            this.nameTagManager.setEntityFaction('main_player', factionId);
        }
    }

    // ==========================================
    // P2P CONNECTION METHODS
    // ==========================================

    staggerP2PInitiations(newPlayers) {
        // Delegate to NetworkManager with callback to create avatars
        this.networkManager.staggerP2PInitiations(newPlayers, (peerId, index) => {
            // Create avatar from man model
            const avatar = this.avatarManager.createAvatar();
            if (avatar) {
                this.scene.add(avatar);
                this.networkManager.avatars.set(peerId, avatar);

                // Set peer metadata for identification
                avatar.userData.objectId = 'peer_' + peerId;
                avatar.userData.modelType = 'peer';

                // Add to objectRegistry for fast lookups
                this.objectRegistry.set(avatar.userData.objectId, avatar);

                // Register name tag for peer
                const peerData = this.networkManager.peerGameData.get(peerId);

                // Set initial position from stored targetPosition (fixes visibility race condition)
                // Position may have been received via P2P before avatar was created
                if (peerData?.targetPosition) {
                    avatar.position.copy(peerData.targetPosition);
                    // Set terrain height for Y position
                    if (this.terrainGenerator) {
                        const terrainY = this.terrainGenerator.getWorldHeight(
                            peerData.targetPosition.x,
                            peerData.targetPosition.z
                        );
                        if (terrainY !== undefined && terrainY !== null) {
                            avatar.position.y = terrainY + 0.03;
                        }
                    }
                }
                if (this.nameTagManager) {
                    const displayName = peerData?.username || 'Player';
                    this.nameTagManager.registerEntity(`peer_${peerId}`, displayName, avatar);

                    // Set initial faction color if known
                    if (peerData?.factionId) {
                        this.nameTagManager.setEntityFaction(`peer_${peerId}`, peerData.factionId);
                        if (this.gameState) {
                            const isEnemy = this.gameState.isEnemyFaction(peerData.factionId);
                            this.nameTagManager.setEntityEnemy(`peer_${peerId}`, isEnemy);
                        }
                    }
                }

                // Set initial shirt faction color if known
                if (peerData?.factionId && this.avatarManager) {
                    this.avatarManager.setAvatarFaction(peerId, peerData.factionId);
                }

                // Check for pending deaths (death message arrived before avatar was created)
                if (this.networkManager?.gameStateManager?.pendingDeaths) {
                    const pendingDeath = this.networkManager.gameStateManager.pendingDeaths.get(peerId);
                    if (pendingDeath) {
                        this.networkManager.gameStateManager.pendingDeaths.delete(peerId);
                        console.log(`[Death] Applying queued death for peer ${peerId}`);
                        this.killEntity(avatar, false, true);
                        if (this.nameTagManager) {
                            this.nameTagManager.setEntityDead(`peer_${peerId}`);
                        }
                    }
                }
            }

            // Note: AI enemy creation is handled by network sync messages (ai_enemy_update)
            // This ensures they spawn at the correct position relative to their owner player
            // rather than at the origin (0, 0, 0)
        });
    }

    createPeerAIEnemy() {
        return AIEnemy.createPeerAIEnemy();
    }

    cancelPickup() {
        // Delegate to InventoryUI
        this.inventoryUI.cancelInventoryDrag();
    }


    // --- Input and Resizing ---

    onPointerMove(event, pointer, raycaster) {
        // InputManager already filters for CANVAS target

        // Block all game input if disabled (e.g., during login modal)
        if (!this.inputEnabled) {
            return;
        }

        // Delegate to BuildMenu if placement is active
        if (!this.buildMenu || !this.buildMenu.isPlacementActive()) return;

        // Raycast to find terrain intersection - use raycaster from InputManager
        // Reuse array to avoid GC pressure from spread operators
        const terrainObjects = this.clipmap ? this.clipmap.getTerrainMeshes() : [];
        const waterObjects = this.waterSystem ? this.waterSystem.getWaterChunks() : [];
        this._raycastCandidates.length = 0;
        for (let i = 0; i < terrainObjects.length; i++) this._raycastCandidates.push(terrainObjects[i]);
        for (let i = 0; i < waterObjects.length; i++) this._raycastCandidates.push(waterObjects[i]);
        const intersects = raycaster.intersectObjects(this._raycastCandidates, true);

        if (intersects.length > 0) {
            const { point } = intersects[0];
            // Delegate to BuildMenu for preview update
            this.buildMenu.updateStructurePreview(point.x, point.z, event.clientY);
        }
    }

    /**
     * Check if a position is inside a structure's bounding box
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @param {string} structureType - Type of structure to check (e.g., 'dock')
     * @returns {object|null} - Structure data if inside, null otherwise
     */
    isPositionInStructure(x, z, structureType) {
        // Iterate through all chunk objects to find structures
        const chunkObjects = this.chunkManager?.chunkObjects || new Map();
        for (const objects of chunkObjects.values()) {
            for (const obj of objects) {
                // Only check matching structure types (not construction sites)
                if (obj.userData.modelType === structureType && !obj.userData.isConstructionSite) {
                    const position = obj.position;
                    const rotation = obj.rotation.y; // Rotation in radians
                    const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[structureType];

                    if (!dims) continue;

                    // Transform point to local coordinates (account for rotation)
                    const cosRot = Math.cos(-rotation);
                    const sinRot = Math.sin(-rotation);
                    const localX = (x - position.x) * cosRot - (z - position.z) * sinRot;
                    const localZ = (x - position.x) * sinRot + (z - position.z) * cosRot;

                    // Check if point is inside bounding box
                    const halfWidth = dims.width / 2;
                    const halfDepth = dims.depth / 2;

                    if (Math.abs(localX) <= halfWidth && Math.abs(localZ) <= halfDepth) {
                        // Inside this structure!
                        return {
                            object: obj,
                            position: position,
                            deckHeight: obj.userData.finalFoundationY || position.y + 1.0
                        };
                    }
                }
            }
        }
        return null;
    }

    /**
     * Check if player movement is currently allowed
     * Centralizes all movement-blocking conditions for WASD and click-to-move
     * @returns {boolean} True if player can move
     */
    canPlayerMove() {
        // Input disabled (login modal, loading screen)
        if (!this.inputEnabled) return false;

        // Player is dead
        if (this.isDead) return false;

        // Active harvesting/chopping action
        if (this.gameState.activeAction) return false;

        // Inventory/backpack is open
        if (this.gameState.inventoryOpen) return false;

        // Build menu is open (not just placement mode)
        if (this.buildMenu?.isOpen()) return false;

        // Structure placement mode active
        if (this.buildMenu?.isPlacementActive()) return false;

        // Settings panel open
        if (this.settingsPanel?.isVisible) return false;

        // Friends panel open
        if (this.friendsPanel?.isVisible) return false;

        // Faction panel open
        if (this.factionPanel?.isVisible) return false;

        // Combat shooting pause
        if (this.playerCombat?.isInShootingPause()) return false;

        // Climbing and occupied on outpost (can aim but not move)
        if (this.gameState.climbingState.isClimbing &&
            this.gameState.climbingState.climbingPhase === 'occupied') return false;

        // Piloting a mobile entity (boat/cart/horse) - WASD goes to boat instead
        if (this.gameState.mobileEntityState.isActive) return false;

        return true;
    }

    /**
     * Walkability check for click validation
     * Note: Actual dock detection and water checks are handled at runtime by Rapier collision
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {object} - { walkable: boolean, height?: number }
     */
    canWalkTo(x, z) {
        // Always allow clicks - runtime physics handles dock detection and water reversal
        const terrainHeight = this.terrainGenerator ? this.terrainGenerator.getWorldHeight(x, z) : 0;
        return {
            walkable: true,
            height: terrainHeight + 0.03
        };
    }

    onPointerDown(event, pointer, raycaster) {
        // Resume AudioContext on first user interaction (browser requirement)
        if (this.audioManager) {
            this.audioManager.resumeContext();
        }

        // Block all game input if disabled (e.g., during login modal)
        if (!this.inputEnabled) {
            return;
        }

        // Ignore clicks on UI elements (rotation controls, buttons, etc.)
        // Only process clicks on the canvas
        if (event.target && event.target.tagName !== 'CANVAS') {
            return;
        }

        // Handle structure placement if active - delegate to BuildMenu
        if (this.buildMenu && this.buildMenu.isPlacementActive()) {
            this.buildMenu.advanceStructurePlacementPhase(event.clientY);
            return;
        }
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        // Recalculate inventory sizes if inventory is open
        if (this.gameState.inventoryOpen) {
            this.inventoryUI.calculateInventorySize();
            this.inventoryUI.renderInventory();
            // Also update structure inventory if it's showing
            if (this.gameState.nearestStructure) {
                this.inventoryUI.renderCrateInventory();
            }
        }

        // Recalculate build menu sizes if build menu is open - delegate to BuildMenu
        if (this.buildMenu && this.buildMenu.isOpen()) {
            this.buildMenu.onResize();
        }
    }

    // --- Inventory Management ---
    tryAddItemToInventory(item) {
        // Delegate to PlayerInventory static utility method
        return PlayerInventory.tryAddItemToInventory(this.gameState.inventory, item);
    }

    isPositionFree(x, y, width, height, existingItems) {
        // Delegate to PlayerInventory static utility method
        return PlayerInventory.isPositionFree(x, y, width, height, existingItems);
    }

    /**
     * Check if any AI enemies or peers are currently moving
     * Used to determine if dynamic entity bounding boxes need updating
     * @returns {boolean} True if any AI or peers are potentially moving
     */
    hasMovingAI() {
        // Check if any tent AI enemies are in motion states
        let hasMovingTentAI = false;
        if (this.aiEnemyManager?.tentAIEnemies) {
            for (const [tentId, aiData] of this.aiEnemyManager.tentAIEnemies) {
                if (!aiData.isDead && aiData.controller) {
                    const state = aiData.controller.state;
                    if (state === 'chasing' || state === 'approaching') {
                        hasMovingTentAI = true;
                        break;
                    }
                }
            }
        }

        // Assume peers can move at any time (network controlled)
        const hasPeers = this.gameState.peers?.size > 0;

        return hasMovingTentAI || hasPeers;
    }

    setupGameLoop() {
        // Setup update callback
        this.gameLoop.onUpdate((deltaTime, now) => {
            // Process chunk transition queue (spread expensive chunk operations across frames)
            const transitionQueue = getChunkTransitionQueue();
            if (transitionQueue.hasPendingWork()) {
                transitionQueue.processFrame();
            }

            // Step physics simulation
            if (this.physicsManager && this.physicsManager.initialized) {
                this.physicsManager.step(deltaTime);
                // Process batched collider creation queue (ISSUE-068)
                this.physicsManager.processColliderQueue();
            }

            // Process structure creation queue (prevents stutter on chunk transitions)
            if (this.messageRouter?.sceneObjectFactory) {
                this.messageRouter.sceneObjectFactory.processCreationQueue();
            }

            // Process queued network messages
            this.networkManager.processMessageQueue();

            // Artillery manning - handle A/D rotation when manning
            if (this.gameState.artilleryManningState.isManning) {
                this.updateArtilleryManning(deltaTime, now);
            }

            // WASD movement - update target position before standard movement
            const canMove = this.canPlayerMove();
            if (canMove) {
                const isWASD = this.playerController.updateWASDMovement(
                    this.wasdKeys,
                    this.cameraController.getRotation(),
                    deltaTime
                );

                // Broadcast position during WASD movement (throttled)
                if (isWASD) {
                    const broadcastInterval = CONFIG.WASD?.BROADCAST_INTERVAL || 500;
                    if (now - this.lastWASDMoveTime >= broadcastInterval) {
                        this.lastWASDMoveTime = now;
                        this.networkManager.broadcastP2P({
                            type: 'player_pos',
                            t: Date.now(),
                            p: this.playerObject.position.toArray(),
                            r: this.playerObject.rotation.y
                        });
                    }
                }
            } else if (this.gameState.cartAttachmentState?.isAttached) {
                // DEBUG: Log when canPlayerMove blocks movement while cart is attached (once per block)
                const hasWASD = this.wasdKeys.w || this.wasdKeys.a || this.wasdKeys.s || this.wasdKeys.d;
                if (hasWASD && !this._loggedCanMoveBlock) {
                    console.warn('[Cart Debug] canPlayerMove() returned FALSE while cart attached!', {
                        inputEnabled: this.inputEnabled,
                        isDead: this.isDead,
                        activeAction: !!this.gameState.activeAction,
                        inventoryOpen: this.gameState.inventoryOpen,
                        buildMenuOpen: this.buildMenu?.isOpen(),
                        placementActive: this.buildMenu?.isPlacementActive(),
                        settingsVisible: this.settingsPanel?.isVisible,
                        friendsVisible: this.friendsPanel?.isVisible,
                        factionVisible: this.factionPanel?.isVisible,
                        shootingPause: this.playerCombat?.isInShootingPause(),
                        climbingOccupied: this.gameState.climbingState.isClimbing && this.gameState.climbingState.climbingPhase === 'occupied',
                        mobileEntityActive: this.gameState.mobileEntityState.isActive
                    });
                    this._loggedCanMoveBlock = true;
                }
            } else {
                this._loggedCanMoveBlock = false; // Reset when not cart-attached
            }

            // Update player movement using PlayerController
            this.gameState.isMoving = this.playerController.updateMovement(deltaTime, this.isDead);

            // Override isMoving when piloting a mobile entity (horse/boat)
            // The player controller doesn't know about mobile entity movement
            if (this.gameState.mobileEntityState.isActive &&
                this.gameState.mobileEntityState.phase === 'piloting' &&
                this.mobileEntitySystem) {
                this.gameState.isMoving = this.mobileEntitySystem.velocity > 0.0001;
            }

            // Update climbing animation
            if (this.gameState.climbingState.isClimbing) {
                const climbState = this.gameState.climbingState;
                const elapsed = now - climbState.climbingStartTime;
                const CLIMB_DURATION = 2000; // 2 seconds

                if (climbState.climbingPhase === 'ascending' || climbState.climbingPhase === 'descending') {
                    const progress = Math.min(1.0, elapsed / CLIMB_DURATION);

                    // Lerp player position to target
                    this.playerObject.position.lerp(climbState.targetPosition, 0.2);

                    // Check if animation complete
                    if (progress >= 1.0) {
                        if (climbState.climbingPhase === 'ascending') {
                            // Climbing complete - player is now occupied
                            climbState.climbingPhase = 'occupied';
                            this.playerObject.position.copy(climbState.targetPosition);
                            ui.updateStatus('🧗 In outpost - Climb Down to exit');

                            // Update button states to show Climb Down button
                            const hasAxe = this.hasToolWithDurability('axe');
                            const hasSaw = this.hasToolWithDurability('saw');
                            const hasHammer = this.hasToolWithDurability('hammer');
                            const hasFishingNet = this.hasToolWithDurability('fishingnet');
                            const isOnCooldown = this.gameState.harvestCooldown && this.gameState.harvestCooldown.endTime > Date.now();
                            ui.updateButtonStates(this.gameState.isInChunk, this.gameState.nearestObject, hasAxe, hasSaw, isOnCooldown, this.gameState.nearestConstructionSite, this.gameState.isMoving, this.gameState.nearestStructure, hasHammer, this.gameState.nearWater, hasFishingNet, this.gameState.onGrass, this.gameState.mushroomAvailable, this.gameState.vegetableSeedsAvailable, this.gameState.limestoneAvailable, this.gameState.seedsAvailable, this.gameState.seedTreeType, this.gameState.climbingState.isClimbing, this.occupiedOutposts, this.gameState.vegetablesGatherAvailable, this.gameState.activeAction, this.gameState.nearestMobileEntity, this.gameState.mobileEntityState, this.mobileEntitySystem?.canDisembark || false, this.gameState.nearestDeerCorpse);
                        } else if (climbState.climbingPhase === 'descending') {
                            // Descent complete - clear climbing state
                            const outpostId = climbState.outpostId;
                            this.playerObject.position.copy(climbState.targetPosition);

                            // Check if player should die after descent
                            const shouldDieAfterDescent = climbState.dieAfterDescent;
                            const pendingDeathData = climbState.pendingDeathData;

                            // Clear climbing state
                            climbState.isClimbing = false;
                            climbState.climbingOutpost = null;
                            climbState.outpostId = null;
                            climbState.climbingStartTime = null;
                            climbState.climbingPhase = null;
                            climbState.originalPosition = null;
                            climbState.targetPosition = null;
                            climbState.dieAfterDescent = false;
                            climbState.pendingDeathData = null;

                            // Clear occupancy
                            this.occupiedOutposts.delete(outpostId);

                            // If player was dying, apply death now
                            if (shouldDieAfterDescent) {
                                console.log('[Death] Descent complete - applying death now');

                                // Apply death state
                                this.isDead = true;
                                this.deathStartTime = pendingDeathData.deathStartTime;
                                this.deathRotationProgress = pendingDeathData.deathRotationProgress;
                                this.fallDirection = pendingDeathData.fallDirection;

                                // Stop player from shooting while dead
                                this.playerCombat.die();

                                // Stop any ongoing animations
                                this.deathSystem.stopAnimations(this.animationMixer, this.idleAction);

                                // Broadcast climb end to peers (now that descent is complete)
                                this.networkManager.broadcastP2P({
                                    type: 'player_climb_end',
                                    payload: {
                                        outpostId: outpostId
                                    }
                                });

                                // Broadcast death to all peers
                                this.networkManager.broadcastP2P({
                                    type: 'player_death',
                                    payload: {
                                        position: this.playerObject.position.toArray()
                                    }
                                });

                                // Show death screen after death animation completes (500ms)
                                setTimeout(() => {
                                    if (this.deathScreen) {
                                        this.deathScreen.show(this.deathReason || 'Unknown cause');
                                    }
                                }, 500);

                                ui.updateStatus('💀 Dead');
                            } else {
                                ui.updateStatus('✅ Back on ground');

                                // Update button states to hide Climb Down button and show Climb button
                                const hasAxe = this.hasToolWithDurability('axe');
                                const hasSaw = this.hasToolWithDurability('saw');
                                const hasHammer = this.hasToolWithDurability('hammer');
                                const hasFishingNet = this.hasToolWithDurability('fishingnet');
                                const isOnCooldown = this.gameState.harvestCooldown && this.gameState.harvestCooldown.endTime > Date.now();
                                ui.updateButtonStates(this.gameState.isInChunk, this.gameState.nearestObject, hasAxe, hasSaw, isOnCooldown, this.gameState.nearestConstructionSite, this.gameState.isMoving, this.gameState.nearestStructure, hasHammer, this.gameState.nearWater, hasFishingNet, this.gameState.onGrass, this.gameState.mushroomAvailable, this.gameState.vegetableSeedsAvailable, this.gameState.limestoneAvailable, this.gameState.seedsAvailable, this.gameState.seedTreeType, this.gameState.climbingState.isClimbing, this.occupiedOutposts, this.gameState.vegetablesGatherAvailable, this.gameState.activeAction, this.gameState.nearestMobileEntity, this.gameState.mobileEntityState, this.mobileEntitySystem?.canDisembark || false, this.gameState.nearestDeerCorpse);
                            }
                        }
                    }
                }
            }

            // Update mobile entity state (boarding/piloting/disembarking)
            const mobileState = this.gameState.mobileEntityState;
            if (mobileState.isActive) {
                const entity = mobileState.currentEntity;
                const config = this.mobileEntitySystem.getConfig(mobileState.entityType);

                if (mobileState.phase === 'boarding') {
                    // Update water vehicle Y position with wave height (since AnimationSystem is unregistered)
                    // Only for water vehicles - horses stay on terrain
                    const waterVehicles = ['boat', 'sailboat', 'ship2'];
                    if (this.waterSystem && waterVehicles.includes(mobileState.entityType)) {
                        const waveHeight = this.waterSystem.getWaveHeight(entity.position.x, entity.position.z);
                        const terrainY = this.terrainGenerator?.getWorldHeight(entity.position.x, entity.position.z) || 0;
                        const depth = Math.max(0, -terrainY);
                        const damping = Math.min(1, depth / 5.0);
                        entity.position.y = waveHeight * damping + 0.2;
                    }

                    // Lerp player to entity position
                    const elapsed = now - mobileState.boardingStartTime;
                    const progress = Math.min(1.0, elapsed / config.boardingDuration);

                    // Calculate target position with forward offset
                    let targetX = entity.position.x;
                    let targetZ = entity.position.z;
                    let targetY = entity.position.y + config.playerYOffset;
                    if (config.playerForwardOffset) {
                        const heading = entity.rotation.y;
                        targetX += Math.sin(heading) * config.playerForwardOffset;
                        targetZ += Math.cos(heading) * config.playerForwardOffset;
                    }

                    // Lerp all three axes to prevent camera from going underground
                    this.playerObject.position.x = mobileState.originalPosition.x + (targetX - mobileState.originalPosition.x) * progress;
                    this.playerObject.position.y = mobileState.originalPosition.y + (targetY - mobileState.originalPosition.y) * progress;
                    this.playerObject.position.z = mobileState.originalPosition.z + (targetZ - mobileState.originalPosition.z) * progress;

                    // Face same direction as entity
                    this.playerObject.rotation.y = entity.rotation.y;

                    if (progress >= 1.0) {
                        // Boarding complete - transition to piloting
                        mobileState.phase = 'piloting';
                        const vehicleNames = { horse: 'Riding', boat: 'Piloting boat', sailboat: 'Piloting sailboat', ship2: 'Piloting ship' };
                        const statusMsg = `${vehicleNames[mobileState.entityType] || 'Piloting'} - WASD to move`;
                        ui.updateStatus(statusMsg);
                    }
                } else if (mobileState.phase === 'piloting') {
                    let entityMoved = false;
                    let entityTurning = false;
                    let hitWater = false;
                    let boatSinking = false;  // Flag for merchant ship collision

                    if (mobileState.entityType === 'horse') {
                        // --- HORSE MOVEMENT ---
                        const horseResult = this.mobileEntitySystem.updateHorseMovement(
                            this.wasdKeys,
                            deltaTime,
                            entity,
                            this.isDead,
                            this.physicsManager,
                            mobileState.entityId,
                            this.gameState.cartAttachmentState,
                            this.gameState.crateLoadState,
                            this.gameState.artilleryAttachmentState
                        );
                        entityMoved = horseResult.moved;
                        entityTurning = horseResult.isTurning;
                        hitWater = horseResult.hitWater;

                        // Update horse animation based on movement
                        if (mobileState.entityMixer) {
                            mobileState.entityMixer.update(deltaTime / 1000);
                        }
                        if (mobileState.entityWalkAction) {
                            const horseConfig = this.mobileEntitySystem.getConfig('horse');
                            // Animate if moving OR turning in place
                            if (entityMoved || horseResult.isTurning) {
                                let animSpeed;
                                if (entityMoved) {
                                    // Scale animation speed by velocity
                                    animSpeed = horseConfig.minAnimationSpeed +
                                        horseResult.speedRatio * (horseConfig.baseAnimationSpeed - horseConfig.minAnimationSpeed);
                                } else {
                                    // Turning in place - use turning animation speed
                                    animSpeed = horseConfig.turningAnimationSpeed;
                                }
                                mobileState.entityWalkAction.setEffectiveTimeScale(animSpeed);
                                if (!mobileState.entityWalkAction.isRunning()) {
                                    mobileState.entityWalkAction.play();
                                }
                            } else {
                                if (mobileState.entityWalkAction.isRunning()) {
                                    mobileState.entityWalkAction.stop();
                                }
                            }
                        }

                        // Update horse sound based on movement or turning
                        if (entityMoved || horseResult.isTurning) {
                            // Start sound if not playing
                            if (!mobileState.horseSound && this.audioManager) {
                                mobileState.horseSound = this.audioManager.playHorseSound();
                            }
                            // Update playback rate based on speed (0.5 to 1.0)
                            // When turning in place, use slow speed (0.5)
                            if (mobileState.horseSound) {
                                const rate = entityMoved ? 0.5 + horseResult.speedRatio * 0.5 : 0.5;
                                mobileState.horseSound.setPlaybackRate(rate);
                            }
                        } else {
                            // Stop sound when not moving or turning
                            if (mobileState.horseSound?.isPlaying) {
                                mobileState.horseSound.stop();
                                mobileState.horseSound = null;
                            }
                        }

                        // Show water warning if hit water boundary
                        if (hitWater) {
                            ui.updateStatus('Cannot enter water!');
                        }
                    } else {
                        // --- BOAT MOVEMENT ---
                        // When manning ship artillery, don't process movement keys (A/D reserved for aiming)
                        const isManningShipArtillery = this.gameState.artilleryManningState?.isManning &&
                                                        this.gameState.artilleryManningState?.isShipMounted;
                        const movementKeys = isManningShipArtillery ? { w: false, a: false, s: false, d: false } : this.wasdKeys;

                        const boatResult = this.mobileEntitySystem.updateBoatMovement(
                            movementKeys,
                            deltaTime,
                            entity,
                            mobileState.entityType,
                            this.isDead,
                            this.physicsManager,
                            mobileState.entityId,
                            this.networkManager?.gameStateManager
                        );
                        entityMoved = boatResult.moved;
                        entityTurning = boatResult.isTurning;

                        // Handle merchant ship collision - boat sinks and player dies
                        if (boatResult.hitMerchantShip && this.boatSinkingSystem) {
                            boatSinking = true;
                            console.log(`[MerchantCollision] Hit by merchant ship! Entity: ${entity ? 'exists' : 'null'}, EntityId: ${mobileState.entityId}`);

                            // Play crash sound (volume varies by boat type)
                            if (this.audioManager) {
                                this.audioManager.playBoatCrashSound(mobileState.entityType);
                            }

                            // Verify entity is valid before starting sink
                            if (!entity) {
                                console.error('[MerchantCollision] ERROR: entity is null! Cannot start sinking animation.');
                            } else if (!entity.parent) {
                                console.warn('[MerchantCollision] WARNING: entity has no parent (not in scene)');
                            }

                            // Start sinking animation (no callback - death handled by timeout below)
                            this.boatSinkingSystem.startSinking(entity, mobileState.entityId, null);

                            // Remove physics body for boat
                            if (this.physicsManager && mobileState.entityId) {
                                this.physicsManager.removeCharacterController(mobileState.entityId);
                            }

                            // Kill player and clear state after 2 seconds (player sinks with boat)
                            const sinkingEntityId = mobileState.entityId;
                            const sinkingEntityType = mobileState.entityType;
                            setTimeout(() => {
                                console.log(`[MerchantCollision] Death timeout fired for ${sinkingEntityId}`);
                                this.clearShipGunnerStateOnSink(sinkingEntityId);
                                this.killEntity(this.playerObject, false, false, 'Rammed by merchant ship');
                                // Reset mobile entity state
                                const stateToReset = this.gameState.mobileEntityState;
                                stateToReset.isActive = false;
                                stateToReset.currentEntity = null;
                                stateToReset.entityId = null;
                                stateToReset.entityType = null;
                                stateToReset.phase = null;
                            }, 2000);
                        }

                        // Handle peer boat collision - boat sinks based on hierarchy
                        if (boatResult.hitPeerBoat && this.boatSinkingSystem) {
                            boatSinking = true;
                            // Play crash sound (volume varies by boat type)
                            if (this.audioManager) {
                                this.audioManager.playBoatCrashSound(mobileState.entityType);
                            }
                            // Start sinking animation
                            this.boatSinkingSystem.startSinking(entity, mobileState.entityId, null);
                            // Remove physics body for boat
                            if (this.physicsManager && mobileState.entityId) {
                                this.physicsManager.removeCharacterController(mobileState.entityId);
                            }
                            // Kill player and clear state after 2 seconds (player sinks with boat)
                            const deathReason = `Boat collision with ${boatResult.hitPeerBoat.peerEntityType}`;
                            const sinkingEntityId2 = mobileState.entityId;
                            setTimeout(() => {
                                this.clearShipGunnerStateOnSink(sinkingEntityId2);
                                this.killEntity(this.playerObject, false, false, deathReason);
                                // Reset mobile entity state
                                const stateToReset2 = this.gameState.mobileEntityState;
                                stateToReset2.isActive = false;
                                stateToReset2.currentEntity = null;
                                stateToReset2.entityId = null;
                                stateToReset2.entityType = null;
                                stateToReset2.phase = null;
                            }, 2000);
                        }

                        // Handle unoccupied boat collision - boat sinks based on hierarchy
                        if (boatResult.hitUnoccupiedBoat && this.boatSinkingSystem) {
                            boatSinking = true;
                            if (this.audioManager) {
                                this.audioManager.playBoatCrashSound(mobileState.entityType);
                            }
                            this.boatSinkingSystem.startSinking(entity, mobileState.entityId, null);
                            if (this.physicsManager && mobileState.entityId) {
                                this.physicsManager.removeCharacterController(mobileState.entityId);
                            }
                            const deathReason = `Collision with ${boatResult.hitUnoccupiedBoat.entityType}`;
                            const sinkingEntityId3 = mobileState.entityId;
                            setTimeout(() => {
                                this.clearShipGunnerStateOnSink(sinkingEntityId3);
                                this.killEntity(this.playerObject, false, false, deathReason);
                                // Reset mobile entity state (same pattern as completeDisembark)
                                mobileState.isActive = false;
                                mobileState.currentEntity = null;
                                mobileState.entityId = null;
                                mobileState.entityType = null;
                                mobileState.phase = null;
                                mobileState.boardingStartTime = null;
                                mobileState.disembarkStartTime = null;
                                mobileState.originalPosition = null;
                                mobileState.targetPosition = null;
                                mobileState.entityQuality = null;
                                mobileState.entityLastRepairTime = null;
                                mobileState.entityMixer = null;
                                mobileState.entityWalkAction = null;
                                mobileState.pendingHorseSale = false;
                                mobileState.pendingHorseSaleData = null;
                            }, 2000);
                        }

                        // Update boat Y position with wave height (skip if sinking)
                        const isSinking = boatSinking || this.boatSinkingSystem?.isSinking(mobileState.entityId);
                        if (!isSinking) {
                            if (this.waterSystem) {
                                const waveHeight = this.waterSystem.getWaveHeight(entity.position.x, entity.position.z);
                                const terrainY = this.terrainGenerator?.getWorldHeight(entity.position.x, entity.position.z) || 0;
                                const depth = Math.max(0, -terrainY);
                                const damping = Math.min(1, depth / 5.0);
                                entity.position.y = waveHeight * damping + 0.2;
                            }
                        }
                    }

                    // Keep player attached to entity (continues during sinking until timeout clears state)
                    if (config.playerForwardOffset) {
                        // Apply forward offset (e.g., for horse alignment)
                        const heading = entity.rotation.y;
                        this.playerObject.position.x = entity.position.x + Math.sin(heading) * config.playerForwardOffset;
                        this.playerObject.position.z = entity.position.z + Math.cos(heading) * config.playerForwardOffset;
                    } else {
                        this.playerObject.position.x = entity.position.x;
                        this.playerObject.position.z = entity.position.z;
                    }
                    this.playerObject.position.y = entity.position.y + config.playerYOffset;
                    this.playerObject.rotation.y = entity.rotation.y;

                    // Broadcast position to peers (throttled) - also broadcast rotation-only changes
                    if (entityMoved || entityTurning) {
                        const broadcastInterval = CONFIG.WASD?.BROADCAST_INTERVAL || 500;
                        if (now - this.lastWASDMoveTime >= broadcastInterval) {
                            this.lastWASDMoveTime = now;
                            this.networkManager.broadcastP2P({
                                type: 'mobile_entity_position',
                                payload: {
                                    entityId: mobileState.entityId,
                                    entityType: mobileState.entityType,
                                    position: entity.position.toArray(),
                                    rotation: entity.rotation.y
                                }
                            });
                        }
                    }
                } else if (mobileState.phase === 'crewing') {
                    // External gunner on ship - not controlling, but needs disembark check
                    // Player positioning is handled by artillery manning state, not here
                    // Just need to check if ship has stopped for disembark availability
                    if (this.mobileEntitySystem && Math.abs(this.mobileEntitySystem.velocity) < 0.0001) {
                        this.mobileEntitySystem.checkDisembarkable(entity.position, 'boat');
                    } else {
                        // Ship is moving - can't disembark
                        this.mobileEntitySystem.canDisembark = false;
                        this.mobileEntitySystem.disembarkPosition = null;
                    }
                } else if (mobileState.phase === 'disembarking') {
                    // Lerp player from rider position to dismount position
                    const startTime = mobileState.disembarkStartTime || (mobileState.disembarkStartTime = now);
                    const disembarkElapsed = now - startTime;
                    const progress = Math.min(1.0, disembarkElapsed / config.boardingDuration);

                    // Use stored start position (set in startDisembark) to prevent lerp oscillation
                    // on dock edges where entity Y position can fluctuate
                    this.playerObject.position.lerpVectors(
                        mobileState.originalPosition,
                        mobileState.targetPosition,
                        progress
                    );

                    if (progress >= 1.0) {
                        // Disembark complete
                        mobileState.disembarkStartTime = null;
                        this.completeDisembark();
                    }
                }
            }

            if (this.avatarManager) this.avatarManager.updateAvatarMovement(deltaTime);
            if (this.aiEnemyManager) this.aiEnemyManager.updatePeerAIEnemies(deltaTime);

            // Update attached cart position (hitch-point towing physics)
            const cartState = this.gameState.cartAttachmentState;
            if (cartState.isAttached && cartState.attachedCart) {
                const CART = CONFIG.CART_PHYSICS || {
                    HITCH_OFFSET: 0.8,
                    TETHER_LENGTH: 0.6,
                    CART_SPEED: 2.5,
                    PIVOT_SPEED: 0.08,
                    MIN_MOVE_THRESHOLD: 0.01,
                    MIN_DISTANCE_EPSILON: 0.001,
                    MAX_SAFE_ANGLE: Math.PI * 0.35,
                    DANGER_ANGLE: Math.PI * 0.5,
                    EMERGENCY_PIVOT_SPEED: 0.3,
                    BROADCAST_INTERVAL: 150
                };

                const cart = cartState.attachedCart;

                // Determine puller position (horse if mounted, otherwise player)
                const mobileState = this.gameState.mobileEntityState;
                const isMounted = mobileState.isActive && mobileState.phase === 'piloting' && mobileState.entityType === 'horse';
                const pullerPos = isMounted && mobileState.currentEntity
                    ? mobileState.currentEntity.position
                    : this.playerObject.position;
                const pullerHeading = isMounted && mobileState.currentEntity
                    ? mobileState.currentEntity.rotation.y
                    : this.playerObject.rotation.y;

                // Check reverse mode
                const isReversing = isMounted
                    ? this.mobileEntitySystem.isReversingWithCart
                    : (this.playerController?.isReversingWithCart || false);

                // Calculate hitch point (front of cart, offset along cart's forward direction)
                const cartHeading = cart.rotation.y;
                const hitchX = cart.position.x + Math.sin(cartHeading) * CART.HITCH_OFFSET;
                const hitchZ = cart.position.z + Math.cos(cartHeading) * CART.HITCH_OFFSET;

                // Calculate pull direction (from hitch to puller)
                const pullDirX = pullerPos.x - hitchX;
                const pullDirZ = pullerPos.z - hitchZ;

                // Use squared distance comparison to avoid sqrt when tether is slack (performance optimization)
                const pullDistanceSq = pullDirX * pullDirX + pullDirZ * pullDirZ;
                const tetherThreshold = CART.TETHER_LENGTH + CART.MIN_MOVE_THRESHOLD;
                const tetherThresholdSq = tetherThreshold * tetherThreshold;

                // Only apply physics if tether is taut (distance > threshold)
                if (pullDistanceSq > tetherThresholdSq) {
                    // Only calculate sqrt when actually needed for physics
                    const pullDistance = Math.sqrt(pullDistanceSq);
                    // Normalize pull direction (avoid division by zero)
                    const safeDistance = Math.max(pullDistance, CART.MIN_DISTANCE_EPSILON);
                    const normPullX = pullDirX / safeDistance;
                    const normPullZ = pullDirZ / safeDistance;

                    // Calculate target heading (direction cart should face)
                    let targetHeading;
                    if (isReversing) {
                        // Reverse: Cart should face away from puller
                        targetHeading = Math.atan2(-normPullX, -normPullZ);
                    } else {
                        // Forward: Cart should face toward puller
                        targetHeading = Math.atan2(normPullX, normPullZ);
                    }

                    // Calculate angle difference for jackknife detection
                    let angleDiff = targetHeading - cartHeading;
                    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                    const absAngleDiff = Math.abs(angleDiff);

                    // Variable pivot speed based on angle (emergency recovery at extreme angles)
                    let pivotSpeed = CART.PIVOT_SPEED;
                    if (absAngleDiff > CART.DANGER_ANGLE) {
                        // Emergency fast pivot to recover from jackknife
                        pivotSpeed = CART.EMERGENCY_PIVOT_SPEED;
                    } else if (absAngleDiff > CART.MAX_SAFE_ANGLE) {
                        // Interpolate between normal and emergency speed
                        const t = (absAngleDiff - CART.MAX_SAFE_ANGLE) / (CART.DANGER_ANGLE - CART.MAX_SAFE_ANGLE);
                        pivotSpeed = CART.PIVOT_SPEED + t * (CART.EMERGENCY_PIVOT_SPEED - CART.PIVOT_SPEED);
                    }

                    // Rotate cart toward target heading
                    cart.rotation.y = this.lerpAngle(cartHeading, targetHeading, pivotSpeed);

                    // Move cart along pull direction (tension-based)
                    const tensionDistance = pullDistance - CART.TETHER_LENGTH;
                    const maxMoveThisFrame = CART.CART_SPEED * (deltaTime / 1000);
                    const moveAmount = Math.min(tensionDistance, maxMoveThisFrame);

                    // Direction to move: toward puller for forward, away for reverse
                    const moveDirX = isReversing ? -normPullX : normPullX;
                    const moveDirZ = isReversing ? -normPullZ : normPullZ;

                    cart.position.x += moveDirX * moveAmount;
                    cart.position.z += moveDirZ * moveAmount;

                    // Throttle terrain Y lookup to every 5 frames
                    cartState._terrainFrameCount = (cartState._terrainFrameCount || 0) + 1;
                    if (cartState._terrainFrameCount % 5 === 0) {
                        cart.position.y = this.terrainGenerator.getWorldHeight(cart.position.x, cart.position.z);
                    }
                }

                // Throttled P2P broadcast
                const now = Date.now();
                if (now - (cartState._lastBroadcastTime || 0) > CART.BROADCAST_INTERVAL) {
                    cartState._lastBroadcastTime = now;
                    this.networkManager.broadcastP2P({
                        type: 'cart_position',
                        payload: {
                            cartId: cartState.cartId,
                            position: cart.position.toArray(),
                            rotation: cart.rotation.y
                        }
                    });
                }
            }

            // Update attached artillery position (horse-only hitch-point towing physics)
            const artilleryState = this.gameState.artilleryAttachmentState;
            if (artilleryState.isAttached && artilleryState.attachedArtillery) {
                const ARTILLERY = CONFIG.ARTILLERY_PHYSICS || {
                    HITCH_OFFSET: 0.4,
                    TETHER_LENGTH: 0.3,
                    ARTILLERY_SPEED: 2.0,
                    PIVOT_SPEED: 0.08,
                    MIN_MOVE_THRESHOLD: 0.01,
                    MIN_DISTANCE_EPSILON: 0.001,
                    MAX_SAFE_ANGLE: Math.PI * 0.35,
                    DANGER_ANGLE: Math.PI * 0.5,
                    EMERGENCY_PIVOT_SPEED: 0.3,
                    BROADCAST_INTERVAL: 150
                };

                const artillery = artilleryState.attachedArtillery;

                // Artillery requires horse - get horse position
                const mobileState = this.gameState.mobileEntityState;
                const isMounted = mobileState.isActive && mobileState.phase === 'piloting' && mobileState.entityType === 'horse';

                if (isMounted && mobileState.currentEntity) {
                    const horsePos = mobileState.currentEntity.position;
                    const horseHeading = mobileState.currentEntity.rotation.y;

                    // Calculate hitch point (front of artillery, offset along artillery's forward direction)
                    const artilleryHeading = artillery.rotation.y;
                    const hitchX = artillery.position.x + Math.sin(artilleryHeading) * ARTILLERY.HITCH_OFFSET;
                    const hitchZ = artillery.position.z + Math.cos(artilleryHeading) * ARTILLERY.HITCH_OFFSET;

                    // Calculate pull direction (from hitch to horse)
                    const pullDirX = horsePos.x - hitchX;
                    const pullDirZ = horsePos.z - hitchZ;

                    // Use squared distance comparison to avoid sqrt when tether is slack (performance optimization)
                    const pullDistanceSq = pullDirX * pullDirX + pullDirZ * pullDirZ;
                    const tetherThreshold = ARTILLERY.TETHER_LENGTH + ARTILLERY.MIN_MOVE_THRESHOLD;
                    const tetherThresholdSq = tetherThreshold * tetherThreshold;

                    // Only apply physics if tether is taut (distance > threshold)
                    if (pullDistanceSq > tetherThresholdSq) {
                        // Only calculate sqrt when actually needed for physics
                        const pullDistance = Math.sqrt(pullDistanceSq);
                        // Normalize pull direction
                        const safeDistance = Math.max(pullDistance, ARTILLERY.MIN_DISTANCE_EPSILON);
                        const normPullX = pullDirX / safeDistance;
                        const normPullZ = pullDirZ / safeDistance;

                        // Calculate target heading (direction artillery should face)
                        const targetHeading = Math.atan2(normPullX, normPullZ);

                        // Calculate angle difference for jackknife detection
                        let angleDiff = targetHeading - artilleryHeading;
                        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                        const absAngleDiff = Math.abs(angleDiff);

                        // Variable pivot speed based on angle
                        let pivotSpeed = ARTILLERY.PIVOT_SPEED;
                        if (absAngleDiff > ARTILLERY.DANGER_ANGLE) {
                            pivotSpeed = ARTILLERY.EMERGENCY_PIVOT_SPEED;
                        } else if (absAngleDiff > ARTILLERY.MAX_SAFE_ANGLE) {
                            const t = (absAngleDiff - ARTILLERY.MAX_SAFE_ANGLE) / (ARTILLERY.DANGER_ANGLE - ARTILLERY.MAX_SAFE_ANGLE);
                            pivotSpeed = ARTILLERY.PIVOT_SPEED + t * (ARTILLERY.EMERGENCY_PIVOT_SPEED - ARTILLERY.PIVOT_SPEED);
                        }

                        // Rotate artillery toward target heading
                        artillery.rotation.y = this.lerpAngle(artilleryHeading, targetHeading, pivotSpeed);

                        // Move artillery along pull direction
                        const tensionDistance = pullDistance - ARTILLERY.TETHER_LENGTH;
                        const maxMoveThisFrame = ARTILLERY.ARTILLERY_SPEED * (deltaTime / 1000);
                        const moveAmount = Math.min(tensionDistance, maxMoveThisFrame);

                        artillery.position.x += normPullX * moveAmount;
                        artillery.position.z += normPullZ * moveAmount;

                        // Throttle terrain Y lookup to every 5 frames
                        artilleryState._terrainFrameCount = (artilleryState._terrainFrameCount || 0) + 1;
                        if (artilleryState._terrainFrameCount % 5 === 0) {
                            artillery.position.y = this.terrainGenerator.getWorldHeight(artillery.position.x, artillery.position.z);
                        }
                    }

                    // Throttled P2P broadcast
                    const now = Date.now();
                    if (now - (artilleryState._lastBroadcastTime || 0) > ARTILLERY.BROADCAST_INTERVAL) {
                        artilleryState._lastBroadcastTime = now;
                        this.networkManager.broadcastP2P({
                            type: 'artillery_position',
                            payload: {
                                artilleryId: artilleryState.artilleryId,
                                position: artillery.position.toArray(),
                                rotation: artillery.rotation.y
                            }
                        });
                    }
                }
            }

            // Check proximity every 20 frames (3 FPS at 60 FPS) to reduce physics overhead
            // Processing 500-700 sensors every frame was causing 10-20 FPS loss
            // Event-driven checks (on arrival, action completion, chunk change) handle most cases
            if (this.gameLoop.frameCount % 20 === 0) {
                this.checkProximityToObjects();
            }

            // Check inventory full status every 60 frames (~1/second) to show warning proactively
            if (this.gameLoop.frameCount % 60 === 0 && this.playerInventory) {
                ui.updateInventoryFullStatus(this.playerInventory.isFull());
            }

            // Update spawn immunity indicator every 60 frames (~1/second)
            if (this.gameLoop.frameCount % 60 === 0) {
                ui.updateSpawnImmunity(this.spawnImmunityEndTime);
            }

            // Update ambient sounds every 10 frames (~6 times/second) for performance
            // Only update if audio system is initialized
            if (this.gameLoop.frameCount % 10 === 0 && this.audioManager && this.audioManager.isInitialized) {
                if (this.ambientSoundSystem) {
                    this.ambientSoundSystem.update(deltaTime);
                }
            }

            // Update campfire smoke effects
            const deltaSeconds = deltaTime / 1000;
            if (this.effectManager) {
                this.effectManager.update(deltaSeconds);
            }

            // Update player combat/shooting FIRST for fairness - delegate to PlayerCombat
            // Pass all tent AI enemies so player can target any of them
            this.playerCombat.updateShooting(
                this.aiEnemyManager.aiEnemy,
                this.aiEnemyManager.aiEnemyController,
                this.networkManager.peerGameData,
                (target, isHit, playerPos) => {
                    // Get tentId for bandit authority handling
                    // Prefer target.tentId (from BanditController), fallback to controller.aiId
                    const tentId = target.tentId || target.controller?.aiId || null;

                    // Notify deer of player gunshot (they flee from gunshots)
                    if (this.deerController) {
                        this.deerController.registerGunshot(playerPos.x, playerPos.z);
                    }

                    // Handle deer shots separately
                    if (target.isDeer) {
                        // Broadcast deer shoot event
                        this.networkManager.broadcastP2P({
                            type: 'player_shoot_deer',
                            payload: {
                                position: playerPos.toArray(),
                                treeId: target.treeId,  // FIX: was chunkKey (undefined)
                                isHit: isHit,
                                isLocal: target.isLocal
                            }
                        });

                        // Notify ambient sound system
                        if (this.ambientSoundSystem) {
                            this.ambientSoundSystem.onCombatActivity();
                        }

                        // Spawn hit/miss effect
                        if (this.effectManager && target.entity?.position) {
                            if (isHit) {
                                this.effectManager.spawnBloodEffect(target.entity.position, playerPos);
                            } else {
                                this.effectManager.spawnDirtKickup(target.entity.position, playerPos);
                            }
                        }

                        // Apply hit if local authority
                        if (isHit && target.isLocal) {
                            this.deerController.killDeer(target.treeId, this.gameState.clientId);  // FIX: was chunkKey
                        }
                        // If not local authority, peer will handle kill from broadcast

                        return; // Don't process as bandit
                    }

                    // Handle brown bear shots separately
                    if (target.isBrownBear) {
                        // Broadcast brown bear shoot event
                        this.networkManager.broadcastP2P({
                            type: 'player_shoot_brownbear',
                            payload: {
                                position: playerPos.toArray(),
                                denId: target.denId,
                                isHit: isHit,
                                isLocal: target.isLocal
                            }
                        });

                        // Notify ambient sound system
                        if (this.ambientSoundSystem) {
                            this.ambientSoundSystem.onCombatActivity();
                        }

                        // Spawn hit/miss effect
                        if (this.effectManager && target.entity?.position) {
                            if (isHit) {
                                this.effectManager.spawnBloodEffect(target.entity.position, playerPos);
                            } else {
                                this.effectManager.spawnDirtKickup(target.entity.position, playerPos);
                            }
                        }

                        // Apply hit if local authority
                        if (isHit && target.isLocal) {
                            this.brownBearController.killEntity(target.denId, this.gameState.clientId);
                        }
                        // If not local authority, peer will handle kill from broadcast

                        return; // Don't process as bandit
                    }

                    // Handle enemy player shots separately
                    if (target.isPlayer) {
                        // Broadcast player-vs-player shoot event
                        this.networkManager.broadcastP2P({
                            type: 'player_shoot_player',
                            payload: {
                                position: playerPos.toArray(),
                                targetPeerId: target.peerId,
                                isHit: isHit
                            }
                        });

                        // Notify ambient sound system
                        if (this.ambientSoundSystem) {
                            this.ambientSoundSystem.onCombatActivity();
                        }

                        // Spawn hit/miss effect
                        if (this.effectManager && target.entity?.position) {
                            if (isHit) {
                                this.effectManager.spawnBloodEffect(target.entity.position, playerPos);
                            } else {
                                this.effectManager.spawnDirtKickup(target.entity.position, playerPos);
                            }
                        }

                        if (isHit) {
                            console.log(`[Combat] Hit enemy player ${target.peerId}`);
                        }

                        return; // Don't process as bandit
                    }

                    // Broadcast player shoot event to other players (bandit/AI)
                    this.networkManager.broadcastP2P({
                        type: 'player_shoot',
                        payload: {
                            position: playerPos.toArray(),
                            targetIsLocalAI: target.isLocal,
                            targetPeerId: target.peerId,
                            tentId: tentId,
                            isHit: isHit
                        }
                    });

                    // Notify ambient sound system of combat (silences plains/birds)
                    if (this.ambientSoundSystem) {
                        this.ambientSoundSystem.onCombatActivity();
                    }

                    // Apply hit if successful
                    if (isHit) {
                        // Spawn red hit effect at target position
                        if (this.effectManager && target.entity?.position) {
                            this.effectManager.spawnBloodEffect(target.entity.position, this.playerObject.position);
                        }
                        if (target.isLocal && target.controller) {
                            // Use the controller from the target (supports multiple AI enemies)
                            target.controller.kill();

                            // Also update AIController so it stops attacking
                            const tentId = target.controller.aiId;
                            if (tentId && this.banditController) {
                                this.banditController.killEntity(tentId, this.gameState.clientId);
                            }
                        }
                        // If target is peer's AI, they will handle the death from the broadcast
                    } else {
                        // Miss - spawn dirt kickup near target, scattering away from player
                        if (this.effectManager && target.entity?.position) {
                            this.effectManager.spawnDirtKickup(target.entity.position, this.playerObject.position);
                        }
                    }
                },
                () => {
                    this.gameState.isMoving = false;
                    this.playerController.stopMovement();
                },
                this.aiEnemyManager.tentAIEnemies,  // Pass all tent AI enemies
                this.banditController  // BanditController for peer bandit targeting with proper tentId
            );

            // Update threat direction indicator and combat HUD
            const target = this.playerCombat.getShootTarget();
            const inCombat = this.playerCombat.getInCombatStance();
            const enemyPos = target?.entity?.position || null;

            if (this.threatIndicator) {
                this.threatIndicator.update(this.camera, this.playerObject.position, enemyPos, inCombat);
            }

            if (this.combatHUD) {
                if (inCombat && target) {
                    const playerY = this.playerObject.position.y;
                    const targetY = enemyPos?.y || 0;
                    const distance = target.distance || 0;

                    // Calculate shooting range and hit chance (same formulas as PlayerCombat)
                    const heightAdvantage = playerY - targetY;
                    const shootingRange = Math.min(15, 10 + Math.max(0, heightAdvantage) * 2.5);

                    // Base 35%, height bonus 0.15 per unit, capped at 80%
                    const baseHitChance = Math.min(0.8, 0.35 + Math.max(0, heightAdvantage * 0.15));
                    // Distance bonus at close range (under 4 units)
                    const POINT_BLANK_RANGE = 4;
                    const distanceBonus = Math.max(0, (shootingRange - distance) / shootingRange);
                    const hitChance = baseHitChance + (1.0 - baseHitChance) * distanceBonus;

                    // Get ammo count and rifle status for HUD display
                    const ammoCount = this.playerCombat.getAmmoCount();
                    const hasRifle = this.playerCombat.hasRifle();

                    // Determine target type and ID for HUD display
                    const targetType = target.isPlayer ? 'player' : (target.isDeer ? 'deer' : (target.isBrownBear ? 'brownbear' : 'bandit'));
                    const targetId = target.entity?.uuid || target.denId || target.peerId || null;

                    // Get rifle reload timing for HUD
                    const lastShootTime = this.playerCombat.lastShootTime || 0;
                    const shootInterval = this.playerCombat.shootInterval || 6000;

                    this.combatHUD.update(true, distance, shootingRange, hitChance, ammoCount, hasRifle, targetType, targetId, lastShootTime, shootInterval);
                } else {
                    this.combatHUD.update(false);
                }
            }

            // Update artillery HUD when manning
            if (this.combatHUD && this.gameState.artilleryManningState.isManning) {
                const manningState = this.gameState.artilleryManningState;
                const artillery = manningState.mannedArtillery;
                const artilleryQuality = artillery?.userData?.quality || 50;
                const cooldown = CONFIG.ARTILLERY_COMBAT?.FIRE_COOLDOWN || 12000;
                const maxRange = CONFIG.ARTILLERY_COMBAT?.RANGE || 28;

                // Check for target once per second (matches rifle behavior)
                if (now - (manningState._lastTargetCheckTime || 0) >= 1000) {
                    manningState._lastTargetCheckTime = now;
                    if (artillery) {
                        const target = this.findArtilleryTarget(
                            artillery.position,
                            manningState.artilleryHeading,
                            maxRange * 2  // Search beyond max range to show "TOO FAR"
                        );
                        manningState._cachedTarget = target;
                    }
                }

                const targetDistance = manningState._cachedTarget?.distance || 0;
                const targetType = manningState._cachedTarget?.type || null;

                // Calculate hit chance if we have a valid target in range
                let hitChance = null;
                if (manningState._cachedTarget && targetDistance > 0 && targetDistance <= maxRange && artillery) {
                    hitChance = this.calculateArtilleryHitChance(
                        artillery.position.y,
                        manningState._cachedTarget.position?.y || artillery.position.y,
                        targetDistance,
                        artilleryQuality
                    );
                }

                this.combatHUD.updateArtillery(true, manningState.lastFireTime, cooldown, artilleryQuality, targetDistance, maxRange, targetType, hitChance);
            } else if (this.combatHUD && this.combatHUD.isArtilleryMode) {
                this.combatHUD.updateArtillery(false);
            }

            this.updateChoppingAction();

            // Update animated objects (ships, etc.)
            this.animationSystem.update(deltaTime);

            // Update falling tree animations
            if (this.fallingTreeSystem) {
                this.fallingTreeSystem.update(deltaTime);
            }

            // Update scheduled ships (dock arrivals)
            this.scheduledShipSystem.update(deltaTime);

            // Update sinking boats (merchant ship collisions)
            if (this.boatSinkingSystem) {
                this.boatSinkingSystem.update();
            }

            // Update dock merchants (NPCs that arrive on ships)
            this.dockMerchantSystem.update(deltaTime, this.playerObject?.position);

            // Trappers are now updated on chunk change only (see runPeriodicChecks)

            // Update pathfinding test AI
            // if (this.pathfindingTestAI) {
            //     this.pathfindingTestAI.update(deltaTime, now);
            // }

            // Update player animation
            if (this.isDead) {
                this.deathSystem.updateDeathAnimation(this.playerObject, this.deathStartTime, deltaTime, this.fallDirection, true);
            } else if (this.animationMixer) {
                const isShootPlaying = this.shootAction && this.shootAction.isRunning();

                // PERFORMANCE OPTIMIZATION: Calculate time scale once based on state
                const deltaSeconds = deltaTime / 1000;  // Pre-calculate once
                let animationTimeScale = 0;  // Default: no animation update
                let shouldSetTime = false;  // Flag to use setTime(0) instead of update

                if (this.gameState.activeAction) {
                    // Ensure walk animation is stopped and chopping is playing
                    if (this.animationAction && this.animationAction.isRunning()) {
                        this.animationAction.stop();
                    }
                    if (this.choppingAction && !this.choppingAction.isRunning()) {
                        this.choppingAction.play();
                    }
                    animationTimeScale = 0.375;  // Chopping/pickaxe animation speed
                } else if (isShootPlaying) {
                    animationTimeScale = 3.0;  // Shooting animation speed
                } else if (this.playerCombat.getShowCombatAnimation()) {
                    // Show rifle in combat stance (only when player has rifle)
                    if (this.playerRifle) {
                        this.playerRifle.visible = true;
                    }

                    // Stop walk and idle animations during combat
                    if (this.animationAction && this.animationAction.isRunning()) {
                        this.animationAction.stop();
                    }
                    if (this.idleAction && this.idleAction.isRunning()) {
                        this.idleAction.stop();
                    }

                    if (this.gameState.isMoving) {
                        // Combat movement: loop combat animation, scaled with movement speed
                        if (this.combatAction) {
                            this.combatAction.paused = false;
                            if (!this.combatAction.isRunning()) {
                                this.combatAction.play();
                            }
                        }
                        // Scale animation speed with movement speed (slope affects both)
                        animationTimeScale = this.playerController.getSpeedMultiplier();
                    } else {
                        // Combat idle: freeze combat animation at frame 2
                        if (this.combatAction) {
                            // Reset to ensure clean frame positioning
                            this.combatAction.reset();
                            // Calculate time for frame 2 (assuming 24fps animation)
                            const frameTime = 2 / 24;
                            this.combatAction.time = frameTime;
                            this.combatAction.weight = 1.0;
                            this.combatAction.play();
                            this.combatAction.paused = true;
                            // Update mixer once to apply the pose (prevents T-pose)
                            this.animationMixer.update(0.001);
                        }
                        // animationTimeScale remains 0 for frozen pose
                    }
                } else {
                    // Hide rifle when not in combat
                    if (this.playerRifle) {
                        this.playerRifle.visible = false;
                    }

                    // Ensure chopping animation is stopped in normal state
                    if (this.choppingAction && this.choppingAction.isRunning()) {
                        this.choppingAction.stop();
                    }
                    if (this.shootAction && this.shootAction.paused) {
                        this.shootAction.stop();
                        this.shootAction.reset();
                    }
                    // Stop combat animation when exiting combat
                    if (this.combatAction && (this.combatAction.isRunning() || this.combatAction.paused)) {
                        this.combatAction.stop();
                        this.combatAction.reset();
                    }

                    // Check if piloting a mobile entity (boat/horse) - don't play walk animation
                    const isPilotingEntity = this.gameState.mobileEntityState?.isActive &&
                                             this.gameState.mobileEntityState?.phase === 'piloting';

                    if (this.gameState.isMoving && !isPilotingEntity) {
                        // Stop idle animation when moving
                        if (this.idleAction && this.idleAction.isRunning()) {
                            this.idleAction.stop();
                        }
                        // Make sure walk animation is playing
                        if (this.animationAction && !this.animationAction.isRunning()) {
                            this.animationAction.play();
                        }
                        // Scale animation speed with movement speed (slope affects both)
                        animationTimeScale = this.playerController.getSpeedMultiplier();
                    } else if (isPilotingEntity) {
                        // Piloting boat/horse - stop walk animation, use idle pose
                        if (this.animationAction && this.animationAction.isRunning()) {
                            this.animationAction.stop();
                        }
                        if (this.idleAction && !this.idleAction.isRunning()) {
                            this.idleAction.play();
                        }
                        animationTimeScale = 0.5;  // Slow idle animation while piloting
                    } else {
                        // Idle: use idle animation
                        if (this.animationAction && this.animationAction.isRunning()) {
                            this.animationAction.stop();
                        }
                        if (this.idleAction && !this.idleAction.isRunning()) {
                            this.idleAction.play();
                        }
                        animationTimeScale = 0.5;  // Slow idle animation
                    }
                }

                // SINGLE animation mixer update per frame!
                if (animationTimeScale > 0) {
                    this.animationMixer.update(deltaSeconds * animationTimeScale);
                }
            }

            // Update peer avatar death animations
            if (this.avatarManager) this.avatarManager.updateAvatarDeathAnimations(deltaTime, this.deathSystem.updateDeathAnimation.bind(this.deathSystem));

            // Update peer AI death animations
            this.networkManager.peerGameData.forEach((peer, peerId) => {
                if (peer.aiEnemy && peer.aiEnemy.userData.isDead) {
                    this.deathSystem.updateDeathAnimation(peer.aiEnemy, peer.aiEnemy.userData.deathStartTime, deltaTime, peer.aiEnemy.userData.fallDirection || 1, false);
                }
            });

            // Process AI spawn queue (spreads spawns across frames to prevent stutter)
            // Run before AI updates so newly spawned entities are immediately available
            getAISpawnQueue().processQueue();

            // Process structure creation queue (spreads bandit camp structure creation across frames)
            getStructureCreationQueue().processQueue();

            // Update BanditController (bandit detection, spawning, behavior)
            // NOTE: This MUST run before aiEnemyManager.updateTentAIEnemies so visual state
            // (inCombatStance, moving) is set correctly before animation updates
            if (this.banditController && this.playerObject) {
                // Use current chunk position from gameState (already calculated correctly)
                const chunkX = this.gameState.currentPlayerChunkX;
                const chunkZ = this.gameState.currentPlayerChunkZ;
                this.banditController.update(deltaTime, chunkX, chunkZ);
            }

            // Update AI enemy visual controllers (animations, rifle visibility)
            // Runs AFTER BanditController so visual state reflects current behavior
            this.aiEnemyManager.updateTentAIEnemies(deltaTime);

            // Update deer AI
            if (this.deerController) {
                this.deerController.update(deltaTime);

                // Check for nearby deer corpse (for harvesting)
                const playerPos = this.playerObject.position;
                this.gameState.nearestDeerCorpse = this.deerController.getNearestHarvestableDeer(
                    playerPos.x, playerPos.z
                );
            }

            // Update brown bear AI
            if (this.brownBearController) {
                const chunkX = Math.floor(this.playerObject.position.x / 50);
                const chunkZ = Math.floor(this.playerObject.position.z / 50);
                this.brownBearController.update(deltaTime, chunkX, chunkZ);

                // Check for nearby brownbear corpse (for harvesting)
                const playerPos = this.playerObject.position;
                this.gameState.nearestBrownbearCorpse = this.brownBearController.getNearestHarvestableBrownbear(
                    playerPos.x, playerPos.z
                );
            }

            // Update brown bear animations (visual manager)
            if (this.brownBearManager) {
                this.brownBearManager.update(deltaTime);
            }

            // Update baker AI
            if (this.bakerController) {
                this.bakerController.update(deltaTime);
            }

            // Update gardener AI
            if (this.gardenerController) {
                this.gardenerController.update(deltaTime);
            }

            // Update woodcutter AI
            if (this.woodcutterController) {
                this.woodcutterController.update(deltaTime);
            }

            // Update miner AI
            if (this.minerController) {
                this.minerController.update(deltaTime);
            }

            // Update stonemason AI
            if (this.stoneMasonController) {
                this.stoneMasonController.update(deltaTime);
            }

            // Update iron worker AI
            if (this.ironWorkerController) {
                this.ironWorkerController.update(deltaTime);
            }

            // Update tile worker AI
            if (this.tileWorkerController) {
                this.tileWorkerController.update(deltaTime);
            }

            // Update blacksmith AI
            if (this.blacksmithController) {
                this.blacksmithController.update(deltaTime);
            }

            // Update fisherman AI
            if (this.fishermanController) {
                this.fishermanController.update(deltaTime);
            }

            // Update camera to follow player (check if initialized)
            if (this.cameraController) {
                this.cameraController.setTarget(this.playerObject);
                this.cameraController.update(deltaTime);

                // Update compass rotation (CSS variable - letters counter-rotate via CSS calc)
                if (!this.compassInner) {
                    this.compassInner = document.getElementById('compass-inner');
                }
                if (this.compassInner) {
                    // Add π to flip compass so +Z = North (standard convention)
                    this.compassInner.style.setProperty('--rot', `${-this.cameraController.rotation + Math.PI}rad`);
                }
            }

            // Update nametag positions every frame for smooth movement
            if (this.nameTagManager) {
                this.nameTagManager.updatePositions();
            }

            // Update cooking/processing progress bars in inventory UI
            if (this.inventoryUI) {
                this.inventoryUI.updateProgressBars();
            }

            // Update growing trees (tick-based calculation)
            if (this.messageRouter) {
                this.messageRouter.updateGrowingTrees();
            }

            // Update debug UI every 6 frames (~10 FPS at 60 FPS)
            if (this.gameLoop.frameCount % 6 === 0 && this.playerController && this.playerObject) {
                const pos = this.playerObject.position;
                const onRoad = this.navigationManager?.isOnRoad?.(pos.x, pos.z) || false;

                // Check if piloting a mobile entity (horse/boat)
                const mobileState = this.gameState.mobileEntityState;
                const isPiloting = mobileState.isActive && mobileState.phase === 'piloting';

                let speedInfo;
                let isMoving;

                if (isPiloting && this.mobileEntitySystem) {
                    // Use vehicle velocity for speed display
                    const config = this.mobileEntitySystem.getConfig(mobileState.entityType);
                    const maxSpeed = config?.maxSpeed || 0.0015;
                    const velocityRatio = this.mobileEntitySystem.velocity / maxSpeed;
                    speedInfo = {
                        multiplier: velocityRatio,
                        slopeMultiplier: velocityRatio,
                        onRoad: onRoad
                    };
                    isMoving = this.mobileEntitySystem.velocity > 0;
                } else {
                    // Normal walking speed
                    const speedMultiplier = this.playerController.getSpeedMultiplier();
                    speedInfo = {
                        multiplier: speedMultiplier,
                        slopeMultiplier: speedMultiplier,
                        onRoad: onRoad
                    };
                    isMoving = this.gameState.isMoving;
                }

                ui.updatePlayerSpeed(speedInfo, isMoving);
                ui.updatePlayerPosition(pos.x, pos.y, pos.z);
                const { chunkX: regionChunkX, chunkZ: regionChunkZ } = ChunkCoordinates.worldToChunk(pos.x, pos.z);
                ui.updatePlayerRegion(regionChunkX, regionChunkZ);
            }

            this.runPeriodicChecks(now);

            // Process chunk creation queue (only if work pending)
            // Process all chunks at once when behind loading screen, otherwise 1 per frame
            if (this.chunkManager.pendingChunkCreations.length > 0) {
                const behindLoadingScreen = this.loadingScreen && this.loadingScreen.isActive;
                this.chunkManager.processChunkQueue(behindLoadingScreen);
            }

            // Process object generation queue (trees, rocks, etc.)
            if (this.chunkObjectGenerator && this.chunkObjectGenerator.isProcessing) {
                this.chunkObjectGenerator.processNextFrame();
            }

            // Update dirt overlay system BEFORE clipmap (fixes first-frame initialization race)
            const playerPos = this.playerObject ? this.playerObject.position : null;
            if (playerPos && this.dirtOverlay) {
                this.dirtOverlay.update(playerPos.x, playerPos.z);
            }

            // Update new terrain clipmap system
            if (playerPos && this.clipmap) {
                const deltaTime = this.gameLoop.deltaTime || 0.016;
                this.clipmap.update(playerPos.x, playerPos.z, deltaTime);

                // Sync dirt overlay uniforms AFTER clipmap updates meshWorldOffset
                // This ensures the shader has consistent center/offset values
                if (this.dirtOverlay) {
                    this.clipmap.updateDirtOverlayUniforms();
                }
            }

            // Update new water system
            if (playerPos && this.waterSystem) {
                const deltaTime = this.gameLoop.deltaTime || 0.016;
                this.waterSystem.update(playerPos.x, playerPos.z, deltaTime);
            }

            // Cull distant trees beyond render distance (check every 60 frames = ~1/sec to save CPU)
            if (this.gameLoop.frameCount % 60 === 0 && playerPos) {
                this.cullDistantTrees(playerPos);
            }

            // Emergency disposal if queue gets too large
            if (this.chunkManager && this.chunkManager.pendingChunkDisposals.length > 20) {
                this.chunkManager.processDisposalQueue();
            }
        });

        // Setup render callback
        this.gameLoop.onRender(() => {
            // Render physics debug visualization
            if (this.physicsManager && this.physicsManager.debugEnabled) {
                this.physicsManager.renderDebug();
            }

            // Render navigation debug visualization
            if (this.navigationManager && this.navigationManager.debugEnabled) {
                this.navigationManager.renderDebug();
            }

            // Render depth texture for water system (must happen before main render)
            if (this.depthSystem && this.playerObject) {
                const pos = this.playerObject.position;
                this.depthSystem.render(
                    this.sceneManager.renderer,
                    pos.x,
                    pos.z
                );
            }

            this.sceneManager.render();
        });

        // Setup FPS update callback
        this.gameLoop.onFPSUpdate((fps) => {
            ui.updateFPS(fps);
            // Physics stats display disabled
            // if (this.physicsManager) {
            //     ui.updatePhysicsStats(this.physicsManager.getStats());
            // }
        });
    }


    runPeriodicChecks(now) {
        if (now - this.gameState.lastChunkUpdateTime > CONFIG.GAME_LOOP.CHUNK_UPDATE_INTERVAL) {
            if (this.chunkManager.updatePlayerChunk(this.playerObject.position.x, this.playerObject.position.z)) {
                const queue = getChunkTransitionQueue();
                const generation = queue.nextGeneration(); // Unique ID for this chunk transition's tasks

                const { clientId, currentPlayerChunkX, currentPlayerChunkZ, lastChunkX, lastChunkZ } = this.gameState;

                // Network message - KEEP SYNCHRONOUS (critical)
                this.networkManager.sendMessage('chunk_update', {
                    clientId,
                    newChunkId: ChunkCoordinates.toChunkId(currentPlayerChunkX, currentPlayerChunkZ),
                    lastChunkId: ChunkCoordinates.toChunkId(lastChunkX, lastChunkZ)
                });

                ui.updateStatus(`Player moved to chunk (${currentPlayerChunkX}, ${currentPlayerChunkZ})`);

                // Queue proximity check
                queue.queueWithGeneration(TASK_TYPE.PROXIMITY, () => {
                    this.checkProximityToObjects();
                }, PRIORITY.HIGH, `proximity_${generation}`, generation);

                // Queue scene membership update
                queue.queueWithGeneration(TASK_TYPE.SCENE_ADD, () => {
                    this.updateTreeSceneMembershipDeferred(
                        currentPlayerChunkX, currentPlayerChunkZ,
                        lastChunkX, lastChunkZ,
                        generation
                    );
                }, PRIORITY.HIGH, `scene_membership_${generation}`, generation);

                // Queue nav map updates
                queue.queueWithGeneration(TASK_TYPE.NAV_MAP, () => {
                    this.chunkManager?.updateNavMapsAroundPlayerDeferred(
                        currentPlayerChunkX, currentPlayerChunkZ,
                        lastChunkX, lastChunkZ,
                        generation
                    );
                }, PRIORITY.NORMAL, `nav_maps_${generation}`, generation);

                // Queue AI updates
                if (this.banditController) {
                    queue.queueWithGeneration(TASK_TYPE.AI_UPDATE, () => {
                        this.banditController.updateTentPresence(currentPlayerChunkX, currentPlayerChunkZ);
                    }, PRIORITY.NORMAL, `bandit_presence_${generation}`, generation);

                    queue.queueWithGeneration(TASK_TYPE.AI_UPDATE, () => {
                        const oldKey = `${lastChunkX},${lastChunkZ}`;
                        const newKey = `${currentPlayerChunkX},${currentPlayerChunkZ}`;
                        this.banditController.onPeerChunkChanged(this.gameState.clientId, oldKey, newKey);
                    }, PRIORITY.LOW, `bandit_authority_${generation}`, generation);
                }

                if (this.brownBearController) {
                    queue.queueWithGeneration(TASK_TYPE.AI_UPDATE, () => {
                        this.brownBearController.updateDenPresence(currentPlayerChunkX, currentPlayerChunkZ);
                    }, PRIORITY.NORMAL, `bear_presence_${generation}`, generation);
                }

                if (this.trapperSystem) {
                    queue.queueWithGeneration(TASK_TYPE.AI_UPDATE, () => {
                        this.trapperSystem.onPlayerChunkChanged(
                            currentPlayerChunkX, currentPlayerChunkZ,
                            lastChunkX, lastChunkZ
                        );
                    }, PRIORITY.LOW, `trapper_${generation}`, generation);
                }
            }
            this.gameState.lastChunkUpdateTime = now;
        }



        if (now - this.gameState.lastPeerCheckTime > CONFIG.GAME_LOOP.PEER_CHECK_INTERVAL) {
            this.networkManager.checkAndReconnectPeers();
            this.gameState.lastPeerCheckTime = now;
        }
    }

    cullDistantTrees(playerPos) {
        const maxDistance = 35; // Increased from 20 to reduce show/hide thrashing
        const maxDistanceSquared = maxDistance * maxDistance;

        // Get player's chunk coordinates
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(playerPos.x, playerPos.z);

        // Only check chunks in 3x3 grid around player
        const chunkObjects = this.chunkManager?.chunkObjects || new Map();
        const chunkKeys = ChunkCoordinates.get3x3ChunkKeys(chunkX, chunkZ);
        for (const chunkKey of chunkKeys) {
            const objects = chunkObjects.get(chunkKey);

            if (objects) {
                objects.forEach((obj) => {
                    // Only process trees
                    if (obj.userData && CONFIG.OBJECTS.TREE_TYPES.has(obj.userData.modelType)) {
                        const dx = obj.position.x - playerPos.x;
                        const dz = obj.position.z - playerPos.z;
                        const distanceSquared = dx * dx + dz * dz;

                        // Hide tree if beyond max distance, show if within
                        obj.visible = distanceSquared <= maxDistanceSquared;
                    }
                });
            }
        }

        // Update billboard system based on camera distance
        if (this.billboardSystem) {
            this.billboardSystem.updateBillboards(playerPos);
        }

        // Update 3D rock model LOD (opacity fade based on distance)
        if (this.rockModelSystem) {
            this.rockModelSystem.updateRockModels(playerPos);
        }

        // Update 3D structure model LOD (visibility toggle based on distance)
        if (this.structureModelSystem) {
            this.structureModelSystem.updateStructureModels(playerPos);
        }

    }

    /**
     * Check if a chunk is within physics radius of player
     */
    isChunkInPhysicsRadius(chunkKey) {
        const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
        const playerChunkX = this.gameState.currentPlayerChunkX;
        const playerChunkZ = this.gameState.currentPlayerChunkZ;
        const radius = CONFIG.CHUNKS?.PHYSICS_RADIUS || 1;

        return Math.abs(chunkX - playerChunkX) <= radius &&
               Math.abs(chunkZ - playerChunkZ) <= radius;
    }

    /**
     * Queue physics collider creation for an object
     */
    queuePhysicsColliderForObject(obj) {
        if (!this.physicsManager?.initialized) return;
        if (obj.userData?.physicsHandle) return;

        const modelType = obj.userData?.modelType;
        const dims = CONFIG.CONSTRUCTION?.GRID_DIMENSIONS?.[modelType];
        if (!dims) return;

        let shape, collisionGroup;

        if (dims.radius !== undefined) {
            shape = { type: 'cylinder', radius: dims.radius, height: dims.height || 1.0 };
            collisionGroup = COLLISION_GROUPS.NATURAL;
        } else if (dims.width !== undefined) {
            shape = { type: 'cuboid', width: dims.width, depth: dims.depth, height: dims.height || 1.0 };
            collisionGroup = (modelType === 'log' || modelType.endsWith('_log') || modelType === 'crate')
                ? COLLISION_GROUPS.PLACED
                : COLLISION_GROUPS.STRUCTURE;
        }

        if (shape) {
            this.physicsManager.queueCollider(
                obj.userData.objectId,
                shape,
                obj.position,
                obj.rotation?.y || 0,
                collisionGroup,
                obj
            );

            if (this.objectRegistry && obj.userData.objectId) {
                this.objectRegistry.set(obj.userData.objectId, obj);
            }
        }
    }

    /**
     * Update which trees are in the scene based on physics radius
     * Trees entering physics radius get added to scene + physics collider
     * Trees leaving physics radius get removed from scene + physics collider removed
     */
    updateTreeSceneMembership(currentChunkX, currentChunkZ, lastChunkX, lastChunkZ) {
        const physicsRadius = CONFIG.CHUNKS.PHYSICS_RADIUS;
        const chunkObjects = this.chunkManager?.chunkObjects;
        if (!chunkObjects) return;

        // Build sets of chunks in old and new physics radius
        const oldPhysicsChunks = new Set();
        const newPhysicsChunks = new Set();

        for (let dx = -physicsRadius; dx <= physicsRadius; dx++) {
            for (let dz = -physicsRadius; dz <= physicsRadius; dz++) {
                oldPhysicsChunks.add(`${lastChunkX + dx},${lastChunkZ + dz}`);
                newPhysicsChunks.add(`${currentChunkX + dx},${currentChunkZ + dz}`);
            }
        }

        // Chunks that LEFT physics radius - remove from scene (natural) or just remove colliders (structures)
        for (const chunkKey of oldPhysicsChunks) {
            if (!newPhysicsChunks.has(chunkKey)) {
                const objects = chunkObjects.get(chunkKey);
                if (objects) {
                    for (const obj of objects) {
                        const modelType = obj.userData.modelType;

                        if (obj.userData.addedToScene && CONFIG.OBJECTS.NATURAL_TYPES.has(modelType)) {
                            // Natural objects: remove from scene entirely
                            this.scene.remove(obj);
                            obj.userData.addedToScene = false;
                            if (this.physicsManager && obj.userData.physicsHandle) {
                                this.physicsManager.removeCollider(obj.userData.objectId);
                                obj.userData.physicsHandle = null;
                            }
                        } else if (CONFIG.OBJECTS.STRUCTURE_TYPES.has(modelType)) {
                            // Structures: keep visible but remove collider for performance
                            if (this.physicsManager && obj.userData.physicsHandle) {
                                this.physicsManager.removeCollider(obj.userData.objectId);
                                obj.userData.physicsHandle = null;
                            }
                        }
                    }
                }
            }
        }

        // Chunks that ENTERED physics radius - add to scene (natural) or just add colliders (structures)
        for (const chunkKey of newPhysicsChunks) {
            if (!oldPhysicsChunks.has(chunkKey)) {
                const objects = chunkObjects.get(chunkKey);
                if (objects) {
                    for (const obj of objects) {
                        const modelType = obj.userData.modelType;
                        const isNatural = CONFIG.OBJECTS.NATURAL_TYPES.has(modelType);
                        const isStructure = CONFIG.OBJECTS.STRUCTURE_TYPES.has(modelType);

                        // Natural objects: add to scene if not already
                        if (isNatural && !obj.userData.addedToScene) {
                            this.scene.add(obj);
                            obj.userData.addedToScene = true;
                        }

                        // Create physics collider for both natural objects and structures
                        if ((isNatural || isStructure) && !obj.userData.physicsHandle) {
                            if (this.physicsManager && this.physicsManager.initialized) {
                                const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[modelType];
                                if (dims) {
                                    let shape, collisionGroup;

                                    if (dims.radius !== undefined) {
                                        // Cylindrical collider (trees, rocks)
                                        shape = {
                                            type: 'cylinder',
                                            radius: dims.radius,
                                            height: dims.height || 1.0
                                        };
                                        collisionGroup = COLLISION_GROUPS.NATURAL;
                                    } else if (dims.width !== undefined) {
                                        // Rectangular collider (structures, logs)
                                        shape = {
                                            type: 'cuboid',
                                            width: dims.width,
                                            depth: dims.depth,
                                            height: dims.height || 1.0
                                        };
                                        // Determine collision group
                                        if (modelType === 'log' || modelType.endsWith('_log') || modelType === 'crate') {
                                            collisionGroup = COLLISION_GROUPS.PLACED;
                                        } else {
                                            collisionGroup = COLLISION_GROUPS.STRUCTURE;
                                        }
                                    }

                                    if (shape) {
                                        // Queue collider for batched creation (ISSUE-068)
                                        this.physicsManager.queueCollider(
                                            obj.userData.objectId,
                                            shape,
                                            obj.position,
                                            obj.rotation?.y || 0,
                                            collisionGroup,
                                            obj  // Target object to attach physicsHandle
                                        );

                                        // Register in objectRegistry for interaction lookups
                                        // (fixes bug where physics colliders exist but objects aren't in registry)
                                        if (this.objectRegistry && obj.userData.objectId) {
                                            this.objectRegistry.set(obj.userData.objectId, obj);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Deferred version of updateTreeSceneMembership that queues operations
     * across multiple frames to prevent stuttering during chunk transitions.
     */
    updateTreeSceneMembershipDeferred(currentChunkX, currentChunkZ, lastChunkX, lastChunkZ, generation) {
        const queue = getChunkTransitionQueue();
        const physicsRadius = CONFIG.CHUNKS.PHYSICS_RADIUS;
        const chunkObjects = this.chunkManager?.chunkObjects;
        if (!chunkObjects) return;

        const oldPhysicsChunks = new Set();
        const newPhysicsChunks = new Set();

        for (let dx = -physicsRadius; dx <= physicsRadius; dx++) {
            for (let dz = -physicsRadius; dz <= physicsRadius; dz++) {
                oldPhysicsChunks.add(`${lastChunkX + dx},${lastChunkZ + dz}`);
                newPhysicsChunks.add(`${currentChunkX + dx},${currentChunkZ + dz}`);
            }
        }

        const isInRadius = (key) => this.isChunkInPhysicsRadius(key);

        // Chunks LEAVING physics radius
        for (const chunkKey of oldPhysicsChunks) {
            if (!newPhysicsChunks.has(chunkKey)) {
                const objects = chunkObjects.get(chunkKey);
                if (!objects) continue;

                const naturalsToRemove = objects.filter(obj =>
                    obj.userData?.addedToScene && CONFIG.OBJECTS.NATURAL_TYPES.has(obj.userData?.modelType)
                );

                const forColliderRemoval = objects.filter(obj =>
                    obj.userData?.physicsHandle &&
                    (CONFIG.OBJECTS.NATURAL_TYPES.has(obj.userData?.modelType) || CONFIG.OBJECTS.STRUCTURE_TYPES.has(obj.userData?.modelType))
                );

                if (naturalsToRemove.length > 0) {
                    queue.queueSceneRemoves(this.scene, naturalsToRemove, PRIORITY.LOW, chunkKey, generation, isInRadius);
                }

                if (forColliderRemoval.length > 0) {
                    queue.queueWithGeneration(TASK_TYPE.PHYSICS, () => {
                        if (isInRadius(chunkKey)) return; // Chunk came back into radius
                        for (const obj of forColliderRemoval) {
                            if (this.physicsManager && obj.userData.physicsHandle) {
                                this.physicsManager.removeCollider(obj.userData.objectId);
                                obj.userData.physicsHandle = null;
                            }
                        }
                    }, PRIORITY.LOW, `collider_rm_${chunkKey}_${generation}`, generation);
                }
            }
        }

        // Chunks ENTERING physics radius
        for (const chunkKey of newPhysicsChunks) {
            if (!oldPhysicsChunks.has(chunkKey)) {
                const objects = chunkObjects.get(chunkKey);
                if (!objects) continue;

                const naturalsToAdd = objects.filter(obj =>
                    !obj.userData?.addedToScene && CONFIG.OBJECTS.NATURAL_TYPES.has(obj.userData?.modelType)
                );

                const forColliders = objects.filter(obj =>
                    !obj.userData?.physicsHandle &&
                    (CONFIG.OBJECTS.NATURAL_TYPES.has(obj.userData?.modelType) || CONFIG.OBJECTS.STRUCTURE_TYPES.has(obj.userData?.modelType))
                );

                if (naturalsToAdd.length > 0) {
                    queue.queueSceneAdds(this.scene, naturalsToAdd, PRIORITY.HIGH, chunkKey, generation, isInRadius);
                }

                if (forColliders.length > 0) {
                    queue.queueWithGeneration(TASK_TYPE.PHYSICS, () => {
                        if (!isInRadius(chunkKey)) return; // Chunk left radius
                        for (const obj of forColliders) {
                            this.queuePhysicsColliderForObject(obj);
                        }
                    }, PRIORITY.NORMAL, `collider_add_${chunkKey}_${generation}`, generation);
                }
            }
        }
    }

    // Check if player has required tool in inventory
    hasRequiredTool(objectType) {
        // Delegate to ResourceManager
        return this.resourceManager.hasRequiredTool(objectType);
    }

    hasToolWithDurability(toolType) {
        // Delegate to ResourceManager
        return this.resourceManager.hasToolWithDurability(toolType);
    }

    killEntity(entity, isAI = false, isPeer = false, deathReason = 'Unknown cause') {
        if (this.deathManager) {
            this.deathManager.killEntity(entity, isAI, isPeer, deathReason);
        }
    }

    respawnPlayer() {
        if (this.deathManager) {
            this.deathManager.respawnPlayer();
        }
    }

    /**
     * Complete respawn after spawn screen selection
     * Called from SpawnScreen callback
     * @param {number} spawnX
     * @param {number} spawnZ
     */
    respawnToPosition(spawnX, spawnZ) {
        if (this.deathManager) {
            this.deathManager.respawnToPosition(spawnX, spawnZ);
        }
    }

    getGroundHeightAt(x, z) {
        return this.terrainGenerator ? this.terrainGenerator.getWorldHeight(x, z) : 0;
    }

    /**
     * Lerp between two angles (handles wraparound)
     * @param {number} a - Current angle in radians
     * @param {number} b - Target angle in radians
     * @param {number} t - Lerp factor (0-1)
     * @returns {number} Interpolated angle
     */
    lerpAngle(a, b, t) {
        let diff = b - a;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        return a + diff * t;
    }

    /**
     * Handle mobile entity enter/exit button press
     * Starts boarding, switching, or disembarking sequence
     */
    handleMobileEntityAction() {
        const state = this.gameState.mobileEntityState;

        if (state.phase === 'piloting') {
            // Currently piloting - check for switch first, then disembark
            const waterVehicleTypes = ['boat', 'sailboat', 'ship2'];
            const isOnWaterVehicle = waterVehicleTypes.includes(state.entityType);

            if (isOnWaterVehicle && this.gameState.nearestSwitchableMobileEntity) {
                // Switch to nearby boat
                this.switchToNearbyBoat();
            } else if (this.mobileEntitySystem.canDisembark) {
                // No switchable entity nearby - disembark
                this.startDisembark();
            }
        } else if (state.phase === 'crewing') {
            // External gunner on ship - can only disembark (no switching)
            if (this.mobileEntitySystem.canDisembark) {
                this.startDisembark();
            }
        } else if (!state.isActive && this.gameState.nearestMobileEntity) {
            // Not in a mobile entity, but one is nearby
            const nearestEntity = this.gameState.nearestMobileEntity;
            const entityObject = nearestEntity.object;

            // Check if this is gunner boarding (occupied ship2 with available artillery)
            if (entityObject?.userData?._isGunnerBoardingAvailable) {
                this.startGunnerBoarding(nearestEntity);
            } else {
                // Regular boarding
                this.startBoarding(nearestEntity);
            }
        }
    }

    /**
     * Start boarding a ship2 as a gunner (man artillery position)
     * @param {object} mobileEntity - { type, object }
     */
    startGunnerBoarding(mobileEntity) {
        const ship = mobileEntity.object;
        const availableArtillery = ship.userData._availableGunnerArtillery;

        if (!availableArtillery) {
            ui.showToast('No available gunner position', 'warning');
            return;
        }

        const artilleryId = availableArtillery.userData.objectId;

        // Find the slot index for this artillery (0 = port, 1 = starboard)
        const artilleryShipState = this.gameState.artilleryShipLoadState;
        const loadedArtillery = artilleryShipState?.loadedArtillery || [];
        const artilleryData = loadedArtillery.find(a => a.artilleryId === artilleryId);
        const slotIndex = artilleryData?.slotIndex ?? 0;

        // Stop any pending player movement
        if (this.playerController) {
            this.playerController.isMoving = false;
            this.playerController.isWASDMoving = false;
        }

        // Set up mobileEntityState so gunner is tracked as "on the ship"
        // This enables reuse of existing disembark flow
        const mobileState = this.gameState.mobileEntityState;
        mobileState.isActive = true;
        mobileState.currentEntity = ship;
        mobileState.entityId = ship.userData.objectId;
        mobileState.entityType = 'ship2';
        mobileState.phase = 'crewing';  // NEW PHASE - not piloting, but on ship as crew
        mobileState.myShipPosition = slotIndex === 0 ? 'portGunner' : 'starboardGunner';

        // Set up manning state for ship-mounted artillery
        const manningState = this.gameState.artilleryManningState;
        manningState.isManning = true;
        manningState.mannedArtillery = availableArtillery;
        manningState.artilleryId = artilleryId;
        manningState.artilleryChunkKey = ship.userData.chunkKey;
        manningState.artilleryOriginalChunkKey = ship.userData.chunkKey;
        manningState.artilleryHeading = availableArtillery.rotation.y;
        manningState.lastFireTime = 0;
        manningState._terrainFrameCount = 0;
        manningState._lastBroadcastTime = 0;
        manningState.isShipMounted = true;
        manningState.shipId = ship.userData.objectId;  // Store ship ID for P2P broadcasts

        // Mark artillery as occupied
        if (this.mobileEntitySystem) {
            this.mobileEntitySystem.setOccupied(artilleryId, this.gameState.clientId);
        }

        // Position player at artillery (world position)
        const artilleryWorldPos = new THREE.Vector3();
        availableArtillery.getWorldPosition(artilleryWorldPos);

        const ARTILLERY_COMBAT = CONFIG.ARTILLERY_COMBAT;
        const offset = ARTILLERY_COMBAT?.MANNING_OFFSET || 0.4;
        const barrelDir = ARTILLERY_COMBAT?.BARREL_DIRECTION || -1;

        // Get artillery world rotation
        const artilleryWorldQuat = new THREE.Quaternion();
        availableArtillery.getWorldQuaternion(artilleryWorldQuat);
        const artilleryWorldEuler = new THREE.Euler().setFromQuaternion(artilleryWorldQuat);
        const worldHeading = artilleryWorldEuler.y;

        // Calculate breech position (behind the cannon)
        const breechX = artilleryWorldPos.x - barrelDir * Math.sin(worldHeading) * offset;
        const breechZ = artilleryWorldPos.z - barrelDir * Math.cos(worldHeading) * offset;

        this.playerObject.position.set(breechX, artilleryWorldPos.y + 0.5, breechZ);
        this.playerObject.rotation.y = worldHeading;

        // Stop player movement
        this.playerController.stopMovement();
        this.gameState.isMoving = false;

        // Broadcast to peers
        this.networkManager.broadcastP2P({
            type: 'artillery_manned',
            payload: {
                artilleryId: artilleryId,
                heading: availableArtillery.rotation.y,
                isShipMounted: true,
                shipId: ship.userData.objectId
            }
        });

        // Clear the temporary userData flags
        delete ship.userData._isGunnerBoardingAvailable;
        delete ship.userData._availableGunnerArtillery;

        ui.showToast('Boarded as gunner - A/D to aim, F to fire', 'info');
    }

    /**
     * Handle attach cart button press
     * Attaches a nearby cart or artillery to the player for towing
     */
    handleAttachCart() {
        const nearestTowable = this.gameState.nearestTowableEntity;
        if (!nearestTowable) return;

        // Handle artillery separately (requires horse)
        if (nearestTowable.type === 'artillery') {
            this.handleAttachArtillery();
            return;
        }

        if (nearestTowable.type !== 'cart') return;

        const cart = nearestTowable.object;
        const cartState = this.gameState.cartAttachmentState;

        // Preserve cart data for release
        cartState.isAttached = true;
        cartState.attachedCart = cart;
        cartState.cartId = cart.userData.objectId;
        cartState.cartChunkKey = cart.userData.chunkKey;
        cartState.cartOriginalChunkKey = cart.userData.chunkKey;  // Save original for release
        cartState.cartQuality = cart.userData.quality;
        cartState.cartLastRepairTime = cart.userData.lastRepairTime;

        // Initialize physics state
        cartState._terrainFrameCount = 0;
        cartState._lastBroadcastTime = 0;

        // Set cart Y to terrain height initially
        if (this.terrainGenerator) {
            cart.position.y = this.terrainGenerator.getWorldHeight(cart.position.x, cart.position.z);
        }

        // Mark as occupied (prevents others from attaching)
        if (this.mobileEntitySystem) {
            this.mobileEntitySystem.setOccupied(cartState.cartId, this.gameState.clientId);
        }

        // Remove physics collider (cart follows player, no collision needed)
        if (this.physicsManager) {
            this.physicsManager.removeCollider(cartState.cartId);
            cart.userData.physicsHandle = null;  // Clear stale reference
            // Re-add to registry (removeCollider triggers callback that deletes it)
            if (this.objectRegistry) {
                this.objectRegistry.set(cartState.cartId, cart);
            }
        }

        // Send claim message to server
        this.networkManager.sendMessage('claim_cart', {
            entityId: cartState.cartId,
            chunkKey: cartState.cartChunkKey,
            clientId: this.gameState.clientId
        });

        // Broadcast to peers
        this.networkManager.broadcastP2P({
            type: 'cart_attached',
            payload: {
                cartId: cartState.cartId,
                position: cart.position.toArray(),
                rotation: cart.rotation.y
            }
        });

        // DEBUG: Log cart attachment state
        console.log('[Cart Debug] Cart attached:', {
            isAttached: cartState.isAttached,
            attachedCart: !!cartState.attachedCart,
            cartId: cartState.cartId,
            mobileEntityState: {
                isActive: this.gameState.mobileEntityState.isActive,
                phase: this.gameState.mobileEntityState.phase
            },
            playerControllerHasCartState: !!this.playerController?.cartAttachmentState,
            playerControllerCartAttached: this.playerController?.cartAttachmentState?.isAttached
        });

        ui.showToast('Cart attached', 'info');
    }

    /**
     * Handle attach artillery button press
     * Attaches nearby artillery to horse for towing (horse-only)
     */
    handleAttachArtillery() {
        const nearestTowable = this.gameState.nearestTowableEntity;
        if (!nearestTowable || nearestTowable.type !== 'artillery') return;

        // Artillery requires horse
        const mobileState = this.gameState.mobileEntityState;
        const isMountedOnHorse = mobileState?.isActive &&
            mobileState?.phase === 'piloting' &&
            mobileState?.entityType === 'horse';

        if (!isMountedOnHorse) {
            ui.showToast('Artillery requires a horse to tow', 'warning');
            return;
        }

        const artillery = nearestTowable.object;
        const artilleryId = artillery.userData.objectId;

        // Check if this artillery is being manned (by us or anyone)
        const manningState = this.gameState.artilleryManningState;
        if (manningState?.isManning && manningState?.artilleryId === artilleryId) {
            ui.showToast('Cannot tow - artillery is being manned', 'warning');
            return;
        }

        // Check if occupied by someone else (could be manned by another player)
        if (this.mobileEntitySystem?.isOccupied(artilleryId) &&
            this.mobileEntitySystem.getOccupant(artilleryId) !== this.gameState.clientId) {
            ui.showToast('Artillery is in use', 'warning');
            return;
        }

        const artilleryState = this.gameState.artilleryAttachmentState;

        // Preserve artillery data for release
        artilleryState.isAttached = true;
        artilleryState.attachedArtillery = artillery;
        artilleryState.artilleryId = artillery.userData.objectId;
        artilleryState.artilleryChunkKey = artillery.userData.chunkKey;
        artilleryState.artilleryOriginalChunkKey = artillery.userData.chunkKey;
        artilleryState.artilleryQuality = artillery.userData.quality;
        artilleryState.artilleryLastRepairTime = artillery.userData.lastRepairTime;

        // Initialize physics state
        artilleryState._terrainFrameCount = 0;
        artilleryState._lastBroadcastTime = 0;

        // Set artillery Y to terrain height initially
        if (this.terrainGenerator) {
            artillery.position.y = this.terrainGenerator.getWorldHeight(artillery.position.x, artillery.position.z);
        }

        // Mark as occupied (prevents others from attaching)
        if (this.mobileEntitySystem) {
            this.mobileEntitySystem.setOccupied(artilleryState.artilleryId, this.gameState.clientId);
        }

        // Remove physics collider (artillery follows horse, no collision needed)
        if (this.physicsManager) {
            this.physicsManager.removeCollider(artilleryState.artilleryId);
            artillery.userData.physicsHandle = null;  // Clear stale reference
            // Re-add to registry
            if (this.objectRegistry) {
                this.objectRegistry.set(artilleryState.artilleryId, artillery);
            }
        }

        // Send claim message to server
        this.networkManager.sendMessage('claim_artillery', {
            entityId: artilleryState.artilleryId,
            chunkKey: artilleryState.artilleryChunkKey,
            clientId: this.gameState.clientId
        });

        // Broadcast to peers
        this.networkManager.broadcastP2P({
            type: 'artillery_attached',
            payload: {
                artilleryId: artilleryState.artilleryId,
                position: artillery.position.toArray(),
                rotation: artillery.rotation.y
            }
        });

        ui.showToast('Artillery attached', 'info');
    }

    /**
     * Handle release cart button press
     * Releases the currently towed cart or artillery
     * Now properly awaits crate unload if one is loaded (cart only)
     */
    async handleReleaseCart() {
        const cartState = this.gameState.cartAttachmentState;
        const artilleryState = this.gameState.artilleryAttachmentState;

        // Handle artillery release if attached
        if (artilleryState.isAttached && artilleryState.attachedArtillery) {
            this.handleReleaseArtillery();
            return;
        }

        if (!cartState.isAttached || !cartState.attachedCart) return;

        // If a crate is loaded, unload it first and WAIT for completion
        if (this.gameState.crateLoadState.isLoaded) {
            try {
                await this.handleUnloadCrate();
            } catch (error) {
                console.warn('[Cart] Crate unload failed during cart release:', error.message);
                ui.showToast('Failed to unload crate - cannot release cart', 'warning');
                return;  // Don't release cart if crate unload failed
            }
        }

        const cart = cartState.attachedCart;
        const position = cart.position.toArray();
        const rotation = cart.rotation.y; // Radians

        // Calculate new chunk for the cart's current position (center-based)
        const { chunkX: newChunkX, chunkZ: newChunkZ } = ChunkCoordinates.worldToChunk(position[0], position[2]);
        const newChunkKey = `${newChunkX},${newChunkZ}`;

        // Clear occupied status
        if (this.mobileEntitySystem) {
            this.mobileEntitySystem.clearOccupied(cartState.cartId);
        }

        // Send release message to server (radians)
        // Server will broadcast object_added with isMobileRelease: true
        // which triggers handleObjectAdded to create physics collider and update chunkObjects
        this.networkManager.sendMessage('release_cart', {
            entityId: cartState.cartId,
            chunkKey: cartState.cartChunkKey,  // Original chunk
            clientId: this.gameState.clientId,
            position: position,
            rotation: rotation,
            quality: cartState.cartQuality,
            lastRepairTime: cartState.cartLastRepairTime
        });

        // Note: Physics collider and chunkObjects update handled by server broadcast
        // via handleObjectAdded with isMobileRelease: true

        // Update chunk key for new position (local state until server broadcast arrives)
        cart.userData.chunkKey = newChunkKey;

        // Broadcast to peers (radians for consistency, though not currently used by handler)
        this.networkManager.broadcastP2P({
            type: 'cart_released',
            payload: {
                cartId: cartState.cartId,
                position: position,
                rotation: rotation
            }
        });

        // Clear state
        cartState.isAttached = false;
        cartState.attachedCart = null;
        cartState.cartId = null;
        cartState.cartChunkKey = null;
        cartState.cartOriginalChunkKey = null;
        cartState.cartQuality = null;
        cartState.cartLastRepairTime = null;
        cartState._terrainFrameCount = 0;
        cartState._lastBroadcastTime = 0;

        // Reset reverse flags and velocity state
        if (this.playerController) {
            this.playerController.isReversingWithCart = false;
            this.playerController.towingVelocity = 0;
            this.playerController.towingHeading = 0;
        }
        if (this.mobileEntitySystem) {
            this.mobileEntitySystem.isReversingWithCart = false;
        }

        ui.showToast('Cart released', 'info');
    }

    /**
     * Handle release artillery button press
     * Releases the currently towed artillery
     */
    handleReleaseArtillery() {
        const artilleryState = this.gameState.artilleryAttachmentState;
        if (!artilleryState.isAttached || !artilleryState.attachedArtillery) return;

        const artillery = artilleryState.attachedArtillery;
        const position = artillery.position.toArray();
        const rotation = artillery.rotation.y; // Radians

        // Calculate new chunk for the artillery's current position (center-based)
        const { chunkX: newChunkX, chunkZ: newChunkZ } = ChunkCoordinates.worldToChunk(position[0], position[2]);
        const newChunkKey = `${newChunkX},${newChunkZ}`;

        // Clear occupied status
        if (this.mobileEntitySystem) {
            this.mobileEntitySystem.clearOccupied(artilleryState.artilleryId);
        }

        // Send release message to server (radians)
        this.networkManager.sendMessage('release_artillery', {
            entityId: artilleryState.artilleryId,
            chunkKey: artilleryState.artilleryChunkKey,  // Original chunk
            clientId: this.gameState.clientId,
            position: position,
            rotation: rotation,
            quality: artilleryState.artilleryQuality,
            lastRepairTime: artilleryState.artilleryLastRepairTime
        });

        // Update chunk key for new position (local state until server broadcast arrives)
        artillery.userData.chunkKey = newChunkKey;

        // Broadcast to peers (radians for consistency, though not currently used by handler)
        this.networkManager.broadcastP2P({
            type: 'artillery_released',
            payload: {
                artilleryId: artilleryState.artilleryId,
                position: position,
                rotation: rotation
            }
        });

        // Clear state
        artilleryState.isAttached = false;
        artilleryState.attachedArtillery = null;
        artilleryState.artilleryId = null;
        artilleryState.artilleryChunkKey = null;
        artilleryState.artilleryOriginalChunkKey = null;
        artilleryState.artilleryQuality = null;
        artilleryState.artilleryLastRepairTime = null;
        artilleryState._terrainFrameCount = 0;
        artilleryState._lastBroadcastTime = 0;

        ui.showToast('Artillery released', 'info');
    }

    /**
     * Handle man artillery button press
     * Player positions behind artillery to fire
     */
    handleManArtillery() {
        const nearestArtillery = this.gameState.nearestMannableArtillery;
        if (!nearestArtillery || !nearestArtillery.object) return;

        // Check if occupied
        if (nearestArtillery.occupied) {
            ui.showToast('Artillery is in use', 'warning');
            return;
        }

        const artillery = nearestArtillery.object;
        const artilleryId = artillery.userData.objectId;

        // Check if this artillery is being towed (by us or anyone)
        const attachState = this.gameState.artilleryAttachmentState;
        if (attachState?.isAttached && attachState?.artilleryId === artilleryId) {
            ui.showToast('Cannot man - artillery is being towed', 'warning');
            return;
        }

        const manningState = this.gameState.artilleryManningState;

        // Set up manning state
        manningState.isManning = true;
        manningState.mannedArtillery = artillery;
        manningState.artilleryId = artillery.userData.objectId;
        manningState.artilleryChunkKey = artillery.userData.chunkKey;
        manningState.artilleryOriginalChunkKey = artillery.userData.chunkKey;
        manningState.artilleryHeading = artillery.rotation.y;
        manningState.lastFireTime = 0;
        manningState._terrainFrameCount = 0;
        manningState._lastBroadcastTime = 0;

        // Mark as occupied (prevents others from manning or towing)
        if (this.mobileEntitySystem) {
            this.mobileEntitySystem.setOccupied(manningState.artilleryId, this.gameState.clientId);
        }

        // Position player at breech (towing-forward side, opposite barrel)
        const ARTILLERY_COMBAT = CONFIG.ARTILLERY_COMBAT;
        const offset = ARTILLERY_COMBAT?.MANNING_OFFSET || 0.4;
        const heading = artillery.rotation.y;
        const barrelDir = ARTILLERY_COMBAT?.BARREL_DIRECTION || -1;

        // Calculate position at breech (opposite to barrel direction)
        // Barrel faces opposite to towing direction, so breech is in towing direction
        const breechX = artillery.position.x - barrelDir * Math.sin(heading) * offset;
        const breechZ = artillery.position.z - barrelDir * Math.cos(heading) * offset;
        const groundY = this.terrainGenerator ?
            this.terrainGenerator.getWorldHeight(breechX, breechZ) + 0.03 :
            artillery.position.y;

        this.playerObject.position.set(breechX, groundY, breechZ);
        this.playerObject.rotation.y = heading;

        // Stop any ongoing movement
        this.playerController.stopMovement();
        this.gameState.isMoving = false;

        // Send claim message to server
        this.networkManager.sendMessage('claim_artillery', {
            entityId: manningState.artilleryId,
            chunkKey: manningState.artilleryChunkKey,
            clientId: this.gameState.clientId,
            manning: true  // Flag to indicate manning (vs towing)
        });

        // Broadcast to peers
        this.networkManager.broadcastP2P({
            type: 'artillery_manned',
            payload: {
                artilleryId: manningState.artilleryId,
                heading: heading
            }
        });

        ui.showToast('Manning artillery - A/D to aim, F to fire', 'info');
    }

    /**
     * Handle leave artillery button press
     * Player stops manning the artillery
     */
    handleLeaveArtillery() {
        const manningState = this.gameState.artilleryManningState;
        if (!manningState.isManning || !manningState.mannedArtillery) return;

        const artillery = manningState.mannedArtillery;
        const artilleryId = manningState.artilleryId;

        // Clear occupied status
        if (this.mobileEntitySystem) {
            this.mobileEntitySystem.clearOccupied(artilleryId);
        }

        // Send release message to server (rotation may have changed)
        const rotation = artillery.rotation.y; // Radians
        this.networkManager.sendMessage('release_artillery', {
            entityId: artilleryId,
            chunkKey: manningState.artilleryChunkKey,
            clientId: this.gameState.clientId,
            position: artillery.position.toArray(),
            rotation: rotation, // Radians
            quality: artillery.userData.quality,
            lastRepairTime: artillery.userData.lastRepairTime,
            wasManning: true  // Flag to indicate was manning (vs towing)
        });

        // Broadcast to peers
        this.networkManager.broadcastP2P({
            type: 'artillery_unmanned',
            payload: {
                artilleryId: artilleryId,
                rotation: rotation
            }
        });

        // Clear manning state
        manningState.isManning = false;
        manningState.mannedArtillery = null;
        manningState.artilleryId = null;
        manningState.artilleryChunkKey = null;
        manningState.artilleryOriginalChunkKey = null;
        manningState.artilleryHeading = 0;
        manningState.lastFireTime = 0;
        manningState._terrainFrameCount = 0;
        manningState._lastBroadcastTime = 0;

        ui.showToast('Left artillery', 'info');
    }

    /**
     * Helper to clear all artillery manning state fields
     * Used when leaving artillery, disembarking as gunner, taking helm, etc.
     */
    _clearArtilleryManningState() {
        const manningState = this.gameState.artilleryManningState;
        manningState.isManning = false;
        manningState.mannedArtillery = null;
        manningState.artilleryId = null;
        manningState.artilleryChunkKey = null;
        manningState.artilleryOriginalChunkKey = null;
        manningState.artilleryHeading = 0;
        manningState.lastFireTime = 0;
        manningState.isShipMounted = false;
        manningState.shipId = null;
        manningState._terrainFrameCount = 0;
        manningState._lastBroadcastTime = 0;
    }

    /**
     * Update artillery manning each frame
     * Handles A/D rotation and F key firing
     * @param {number} deltaTime - Frame delta in ms
     * @param {number} now - Current timestamp from performance.now()
     */
    updateArtilleryManning(deltaTime, now) {
        const manningState = this.gameState.artilleryManningState;
        if (!manningState.isManning || !manningState.mannedArtillery) return;

        // Safety check: if artillery is somehow being towed while we're manning, force leave
        const attachState = this.gameState.artilleryAttachmentState;
        if (attachState?.isAttached && attachState?.artilleryId === manningState.artilleryId) {
            console.warn('[Artillery] Force leaving - artillery is being towed');
            this.handleLeaveArtillery();
            return;
        }

        const artillery = manningState.mannedArtillery;
        const ARTILLERY_COMBAT = CONFIG.ARTILLERY_COMBAT;
        const turnRate = ARTILLERY_COMBAT?.TURN_RATE || (Math.PI * 2) / 6000;

        // Handle A/D rotation
        let rotated = false;
        if (this.wasdKeys.a) {
            manningState.artilleryHeading += turnRate * deltaTime;
            rotated = true;
        }
        if (this.wasdKeys.d) {
            manningState.artilleryHeading -= turnRate * deltaTime;
            rotated = true;
        }

        // Apply rotation limits for ship-mounted artillery (+-90 degrees from initial slot rotation)
        if (manningState.isShipMounted && artillery.parent?.userData?.modelType === 'ship2') {
            // Get the initial slot rotation from the artillery's stored data
            const artilleryShipState = this.gameState.artilleryShipLoadState;
            const loadedArtillery = artilleryShipState?.loadedArtillery || [];
            const artilleryData = loadedArtillery.find(a => a.artilleryId === manningState.artilleryId);

            if (artilleryData) {
                const slotConfig = CONFIG.CRATE_VEHICLES?.ship2_artillery?.slots?.[artilleryData.slotIndex];
                if (slotConfig) {
                    const baseRotation = slotConfig.rotation;  // Initial slot facing
                    const maxDeviation = Math.PI / 2;  // 90 degrees each way

                    // Clamp to within +-90 degrees of base rotation
                    const minRotation = baseRotation - maxDeviation;
                    const maxRotation = baseRotation + maxDeviation;
                    manningState.artilleryHeading = Math.max(minRotation, Math.min(maxRotation, manningState.artilleryHeading));
                }
            }
        }

        // Normalize heading to -PI to PI (only for non-ship artillery)
        if (!manningState.isShipMounted) {
            while (manningState.artilleryHeading > Math.PI) manningState.artilleryHeading -= Math.PI * 2;
            while (manningState.artilleryHeading < -Math.PI) manningState.artilleryHeading += Math.PI * 2;
        }

        // Apply rotation to artillery and player
        artillery.rotation.y = manningState.artilleryHeading;

        // Keep player positioned at breech (opposite barrel direction)
        const offset = ARTILLERY_COMBAT?.MANNING_OFFSET || 0.4;
        const barrelDir = ARTILLERY_COMBAT?.BARREL_DIRECTION || -1;

        // Handle ship-mounted vs land artillery positioning differently
        if (manningState.isShipMounted && artillery.parent?.userData?.modelType === 'ship2') {
            // Ship-mounted: use world coordinates (artillery position is relative to ship)
            const artilleryWorldPos = new THREE.Vector3();
            artillery.getWorldPosition(artilleryWorldPos);

            // Get world rotation for heading calculation
            const artilleryWorldQuat = new THREE.Quaternion();
            artillery.getWorldQuaternion(artilleryWorldQuat);
            const artilleryWorldEuler = new THREE.Euler().setFromQuaternion(artilleryWorldQuat);
            const worldHeading = artilleryWorldEuler.y;

            // Calculate breech position in world space
            const breechX = artilleryWorldPos.x - barrelDir * Math.sin(worldHeading) * offset;
            const breechZ = artilleryWorldPos.z - barrelDir * Math.cos(worldHeading) * offset;

            // Position player on ship deck
            this.playerObject.position.x = breechX;
            this.playerObject.position.y = artilleryWorldPos.y + 0.5;  // Slightly above artillery
            this.playerObject.position.z = breechZ;
            this.playerObject.rotation.y = worldHeading;
        } else {
            // Land artillery: use local coordinates with terrain height
            const breechX = artillery.position.x - barrelDir * Math.sin(manningState.artilleryHeading) * offset;
            const breechZ = artillery.position.z - barrelDir * Math.cos(manningState.artilleryHeading) * offset;

            // Update Y position periodically (not every frame for performance)
            manningState._terrainFrameCount++;
            if (manningState._terrainFrameCount >= 10) {  // Every 10 frames
                manningState._terrainFrameCount = 0;
                if (this.terrainGenerator) {
                    const groundY = this.terrainGenerator.getWorldHeight(breechX, breechZ) + 0.03;
                    this.playerObject.position.y = groundY;
                }
            }

            this.playerObject.position.x = breechX;
            this.playerObject.position.z = breechZ;
            this.playerObject.rotation.y = manningState.artilleryHeading;
        }

        // Broadcast rotation changes (throttled)
        if (rotated) {
            const broadcastInterval = ARTILLERY_COMBAT?.AIM_BROADCAST_INTERVAL || 150;
            if (now - manningState._lastBroadcastTime >= broadcastInterval) {
                manningState._lastBroadcastTime = now;
                const aimPayload = {
                    artilleryId: manningState.artilleryId,
                    heading: manningState.artilleryHeading
                };
                // Include ship-mounted info for proper peer handling
                if (manningState.isShipMounted && manningState.shipId) {
                    aimPayload.isShipMounted = true;
                    aimPayload.shipId = manningState.shipId;
                }
                this.networkManager.broadcastP2P({
                    type: 'artillery_aim',
                    payload: aimPayload
                });
            }
        }

        // Handle F key firing (will be expanded in Phase 2)
        if (this.inputManager && this.inputManager.isKeyPressed('f')) {
            this.fireArtillery(now);
        }
    }

    /**
     * Fire the manned artillery
     * @param {number} now - Current timestamp
     */
    fireArtillery(now) {
        const manningState = this.gameState.artilleryManningState;
        if (!manningState.isManning || !manningState.mannedArtillery) return;

        const ARTILLERY_COMBAT = CONFIG.ARTILLERY_COMBAT;
        const cooldown = ARTILLERY_COMBAT?.FIRE_COOLDOWN || 12000;

        // Check cooldown
        if (now - manningState.lastFireTime < cooldown) {
            return;  // Still on cooldown
        }

        // Check for shells in artillery inventory
        const artillery = manningState.mannedArtillery;
        const inventory = artillery.userData?.inventory;
        const shellIndex = inventory?.items?.findIndex(item => item.type === 'shell');

        if (shellIndex === undefined || shellIndex === -1) {
            // No shells - cannot fire
            if (this.ui) {
                this.ui.showToast('No shells loaded', 'warning');
            }
            console.log('[Artillery] Cannot fire - no shells in inventory');
            return;
        }

        // Fire!
        manningState.lastFireTime = now;

        const range = ARTILLERY_COMBAT?.RANGE || 28;
        const barrelDir = ARTILLERY_COMBAT?.BARREL_DIRECTION || -1;
        const barrelOffset = ARTILLERY_COMBAT?.BARREL_OFFSET || { x: 0, y: 0.6, z: 1.2 };

        // For ship-mounted artillery, use world coordinates
        let artilleryWorldPos;
        let worldHeading;

        if (manningState.isShipMounted && artillery.parent?.userData?.modelType === 'ship2') {
            // Ship-mounted: calculate world position and heading
            artilleryWorldPos = new THREE.Vector3();
            artillery.getWorldPosition(artilleryWorldPos);

            const artilleryWorldQuat = new THREE.Quaternion();
            artillery.getWorldQuaternion(artilleryWorldQuat);
            const artilleryWorldEuler = new THREE.Euler().setFromQuaternion(artilleryWorldQuat);
            worldHeading = artilleryWorldEuler.y;
        } else {
            // Land artillery: use local position and heading directly
            artilleryWorldPos = artillery.position;
            worldHeading = manningState.artilleryHeading;
        }

        // Calculate barrel position for effects (barrel faces opposite to towing direction)
        const barrelPos = {
            x: artilleryWorldPos.x + barrelDir * Math.sin(worldHeading) * barrelOffset.z,
            y: artilleryWorldPos.y + barrelOffset.y,
            z: artilleryWorldPos.z + barrelDir * Math.cos(worldHeading) * barrelOffset.z
        };

        // Play artillery sound
        if (this.audioManager) {
            this.audioManager.playPositionalSound('artillery', artillery);
        }

        // Notify ambient sound system of combat (silences plains/forest)
        if (this.ambientSoundSystem) {
            this.ambientSoundSystem.onCombatActivity();
        }

        // Spawn muzzle flash and smoke effects
        if (this.effectManager) {
            this.effectManager.spawnArtilleryMuzzleFlash(barrelPos);
            this.effectManager.spawnArtillerySmoke(barrelPos);
        }

        // Find target in firing direction (use world coordinates)
        const target = this.findArtilleryTarget(artilleryWorldPos, worldHeading, range);

        let hitResult = { isHit: false, target: null, impactPos: null };

        if (target) {
            // Calculate hit chance
            const hitChance = this.calculateArtilleryHitChance(
                artilleryWorldPos.y,
                target.position.y,
                target.distance,
                artillery.userData.quality || 50
            );

            const hitRoll = Math.random();
            const isHit = hitRoll < hitChance;

            hitResult = {
                isHit,
                target,
                impactPos: isHit ? target.position : this.calculateMissPosition(target.position, worldHeading)
            };

            if (isHit) {
                // Apply damage
                this.applyArtilleryDamage(target);
                console.log(`[Artillery] HIT ${target.type} at distance ${target.distance.toFixed(1)} (${(hitChance * 100).toFixed(0)}% chance)`);
            } else {
                console.log(`[Artillery] MISS ${target.type} at distance ${target.distance.toFixed(1)} (${(hitChance * 100).toFixed(0)}% chance)`);
            }

            // Spawn impact effect
            if (this.effectManager && hitResult.impactPos) {
                this.effectManager.spawnArtilleryImpact(hitResult.impactPos, isHit);
            }
        } else {
            // No target - impact at max range in barrel direction
            const impactPos = {
                x: artilleryWorldPos.x + barrelDir * Math.sin(worldHeading) * range,
                y: this.terrainGenerator?.getWorldHeight(
                    artilleryWorldPos.x + barrelDir * Math.sin(worldHeading) * range,
                    artilleryWorldPos.z + barrelDir * Math.cos(worldHeading) * range
                ) || artilleryWorldPos.y,
                z: artilleryWorldPos.z + barrelDir * Math.cos(worldHeading) * range
            };
            hitResult.impactPos = impactPos;

            if (this.effectManager) {
                this.effectManager.spawnArtilleryImpact(impactPos, false);
            }
            console.log('[Artillery] No target in range');
        }

        // Broadcast fire event to peers
        this.networkManager.broadcastP2P({
            type: 'artillery_fire',
            payload: {
                artilleryId: manningState.artilleryId,
                heading: worldHeading,
                impactPos: hitResult.impactPos ? [hitResult.impactPos.x, hitResult.impactPos.y, hitResult.impactPos.z] : null,
                isHit: hitResult.isHit,
                targetType: hitResult.target?.type || null,
                structureId: hitResult.target?.type === 'structure' ? hitResult.target.structureId : null
            }
        });

        // Consume 1 shell from inventory
        inventory.items.splice(shellIndex, 1);

        // Save updated inventory to server
        const chunkId = `chunk_${artillery.userData.chunkKey}`;
        this.networkManager.sendMessage('save_crate_inventory', {
            crateId: artillery.userData.objectId,
            chunkId: chunkId,
            inventory: inventory
        });

        console.log(`[Artillery] Shell consumed. Remaining shells: ${inventory.items.filter(i => i.type === 'shell').length}`);

        // Apply 1 durability damage to the artillery itself
        this.applyArtilleryWearDamage(artillery);
    }

    /**
     * Find target in artillery firing direction
     * @param {THREE.Vector3} artilleryPos - Artillery position
     * @param {number} heading - Firing direction in radians
     * @param {number} range - Maximum range
     * @returns {object|null} - Target info { entity, type, position, distance } or null
     */
    findArtilleryTarget(artilleryPos, heading, range) {
        const ARTILLERY_COMBAT = CONFIG.ARTILLERY_COMBAT;
        const CONE_ANGLE = Math.PI / 12;  // 15 degree cone (7.5 degrees each side)
        const rangeSq = range * range;
        const barrelDir = ARTILLERY_COMBAT?.BARREL_DIRECTION || -1;

        let nearestTarget = null;
        let nearestDistSq = Infinity;

        // Direction vector (barrel faces opposite to towing direction)
        const dirX = barrelDir * Math.sin(heading);
        const dirZ = barrelDir * Math.cos(heading);

        // Check local tent AI enemies (bandits)
        if (this.aiEnemyManager?.tentAIEnemies) {
            this.aiEnemyManager.tentAIEnemies.forEach((aiData, tentId) => {
                if (aiData.controller && !aiData.isDead && aiData.controller.enemy) {
                    const enemyPos = aiData.controller.enemy.position;
                    const target = this.checkArtilleryTarget(artilleryPos, enemyPos, dirX, dirZ, rangeSq, CONE_ANGLE);
                    if (target && target.distSq < nearestDistSq) {
                        nearestDistSq = target.distSq;
                        nearestTarget = {
                            entity: aiData.controller.enemy,
                            type: 'bandit',
                            position: enemyPos.clone(),
                            distance: Math.sqrt(target.distSq),
                            controller: aiData.controller,
                            tentId: tentId
                        };
                    }
                }
            });
        }

        // Check brown bears
        if (this.brownBearController?.entities) {
            this.brownBearController.entities.forEach((entity, denId) => {
                if (entity.state !== 'dead' && entity.mesh) {
                    const bearPos = entity.mesh.position;
                    const target = this.checkArtilleryTarget(artilleryPos, bearPos, dirX, dirZ, rangeSq, CONE_ANGLE);
                    if (target && target.distSq < nearestDistSq) {
                        nearestDistSq = target.distSq;
                        nearestTarget = {
                            entity: entity.mesh,
                            type: 'brownbear',
                            position: bearPos.clone(),
                            distance: Math.sqrt(target.distSq),
                            controller: entity.controller,
                            denId: denId
                        };
                    }
                }
            });
        }

        // Check peer players (enemy faction only)
        if (this.networkManager?.peerGameData && this.networkManager?.avatars) {
            this.networkManager.peerGameData.forEach((peer, peerId) => {
                // Skip non-enemies (same faction or neutral players)
                if (!this.gameState.isEnemyFaction(peer.factionId)) return;

                // Get avatar from networkManager (peerGameData doesn't store avatars)
                const avatar = this.networkManager.avatars.get(peerId);
                if (!avatar || avatar.userData?.isDead) return;

                const peerPos = avatar.position;
                const target = this.checkArtilleryTarget(artilleryPos, peerPos, dirX, dirZ, rangeSq, CONE_ANGLE);
                if (target && target.distSq < nearestDistSq) {
                    nearestDistSq = target.distSq;
                    nearestTarget = {
                        entity: avatar,
                        type: 'player',
                        position: peerPos.clone(),
                        distance: Math.sqrt(target.distSq),
                        peerId: peerId,
                        factionId: peer.factionId
                    };
                }
            });
        }

        // Check peer boats (enemy faction only)
        if (this.networkManager?.peerGameData) {
            // DEBUG: Log all peers when looking for boat targets
            if (this.networkManager.peerGameData.size > 0 && !this._lastArtilleryDebugTime || performance.now() - this._lastArtilleryDebugTime > 5000) {
                this._lastArtilleryDebugTime = performance.now();
                console.log(`[Artillery Debug] Checking ${this.networkManager.peerGameData.size} peers for boat targets (myFaction: ${this.gameState.factionId})`);
                this.networkManager.peerGameData.forEach((pd, pid) => {
                    console.log(`  Peer ${pid}: factionId=${pd.factionId}, isPiloting=${pd.isPiloting}, mobileEntity=${pd.mobileEntity ? pd.mobileEntity.entityType : 'none'}, mesh=${pd.mobileEntity?.mesh ? 'yes' : 'no'}`);
                });
            }

            this.networkManager.peerGameData.forEach((peerData, peerId) => {
                // Skip non-enemy factions
                if (!this.gameState.isEnemyFaction(peerData.factionId)) {
                    // DEBUG: Log why peer is skipped
                    if (peerData.isPiloting && peerData.mobileEntity) {
                        console.log(`[Artillery] Peer ${peerId} skipped - not enemy (myFaction: ${this.gameState.factionId}, peerFaction: ${peerData.factionId})`);
                    }
                    return;
                }

                // Skip if not piloting a water vehicle
                if (!peerData.isPiloting || !peerData.mobileEntity) return;
                const entityType = peerData.mobileEntity.entityType;
                if (!['boat', 'sailboat', 'ship2'].includes(entityType)) return;

                // Get boat mesh
                const boatMesh = peerData.mobileEntity.mesh;
                if (!boatMesh) {
                    console.warn(`[Artillery] Peer ${peerId} piloting ${entityType} but mesh is null - model may not be loaded`);
                    return;
                }

                const boatPos = boatMesh.position;
                const target = this.checkArtilleryTarget(artilleryPos, boatPos, dirX, dirZ, rangeSq, CONE_ANGLE);
                if (target && target.distSq < nearestDistSq) {
                    nearestDistSq = target.distSq;
                    nearestTarget = {
                        entity: boatMesh,
                        type: 'boat',
                        entityType: entityType,
                        position: boatPos.clone(),
                        distance: Math.sqrt(target.distSq),
                        peerId: peerId,
                        factionId: peerData.factionId
                    };
                } else if (peerData.isPiloting) {
                    // DEBUG: Log why target was rejected
                    const dist = Math.sqrt((boatPos.x - artilleryPos.x)**2 + (boatPos.z - artilleryPos.z)**2);
                    console.log(`[Artillery] Peer boat ${entityType} rejected - dist: ${dist.toFixed(1)}, range: ${Math.sqrt(rangeSq).toFixed(1)}, cone check: ${target ? 'passed' : 'failed'}`);
                }
            });
        }

        // Check structures (bandit and enemy faction owned)
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(artilleryPos.x, artilleryPos.z);
        const chunkKeys = ChunkCoordinates.get3x3ChunkKeys(chunkX, chunkZ);

        for (const key of chunkKeys) {
            const chunkObjects = this.chunkManager?.chunkObjects?.get(key) || [];
            for (const obj of chunkObjects) {
                if (!this.isValidArtilleryStructureTarget(obj)) continue;

                const structPos = obj.position;
                const target = this.checkArtilleryTarget(artilleryPos, structPos, dirX, dirZ, rangeSq, CONE_ANGLE);
                if (target && target.distSq < nearestDistSq) {
                    nearestDistSq = target.distSq;
                    nearestTarget = {
                        entity: obj,
                        type: 'structure',
                        position: structPos.clone(),
                        distance: Math.sqrt(target.distSq),
                        structureId: obj.userData.objectId,
                        chunkKey: obj.userData.chunkKey
                    };
                }
            }
        }

        return nearestTarget;
    }

    /**
     * Check if a position is within artillery firing cone
     * @returns {object|null} - { distSq } if valid target, null otherwise
     */
    checkArtilleryTarget(artilleryPos, targetPos, dirX, dirZ, rangeSq, coneAngle) {
        const dx = targetPos.x - artilleryPos.x;
        const dz = targetPos.z - artilleryPos.z;
        const distSq = dx * dx + dz * dz;

        // Check range
        if (distSq > rangeSq || distSq < 4) return null;  // Min 2 units to avoid self-damage

        // Check cone angle
        const dist = Math.sqrt(distSq);
        const normDx = dx / dist;
        const normDz = dz / dist;

        // Dot product gives cos(angle)
        const dot = normDx * dirX + normDz * dirZ;
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

        if (angle > coneAngle) return null;

        return { distSq };
    }

    /**
     * Check if a structure is a valid artillery target
     * @param {THREE.Object3D} obj - The object to check
     * @returns {boolean} - True if valid target
     */
    isValidArtilleryStructureTarget(obj) {
        const userData = obj.userData;
        if (!userData) return false;

        // Only target specific structure types
        const structureTypes = new Set([
            'tent', 'campfire', 'house', 'crate', 'outpost', 'market',
            'dock', 'tileworks', 'ironworks', 'blacksmith', 'bakery', 'gardener',
            'miner', 'woodcutter', 'stonemason', 'bearden',
            'wall', 'fisherman', 'boat', 'sailboat', 'ship2', 'ship', 'cart', 'artillery'
        ]);
        if (!structureTypes.has(userData.modelType)) return false;

        // Skip ruins and construction sites
        if (userData.isRuin || userData.isConstructionSite) return false;

        // Skip already-destroyed structures (prevents duplicate damage during sinking animation)
        if (userData._decayMessageSent) return false;

        // Bandit structures are always valid targets
        if (userData.isBanditStructure) return true;

        // Player structures: check if owner is enemy faction
        if (userData.owner && userData.ownerFactionId !== undefined) {
            return this.gameState.isEnemyFaction(userData.ownerFactionId);
        }

        return false;
    }

    /**
     * Calculate artillery hit chance (matches rifle pattern from PlayerCombat.js)
     */
    calculateArtilleryHitChance(shooterY, targetY, distance, quality = 50) {
        const ARTILLERY_COMBAT = CONFIG.ARTILLERY_COMBAT;

        // Quality bonus: 100 = +10%, 50 = 0%, 1 = -10%
        const qualityBonus = (quality - 50) / 50 * 0.10;
        const BASE_HIT_CHANCE = (ARTILLERY_COMBAT?.BASE_HIT_CHANCE || 0.35) + qualityBonus;
        const MAX_HIT_CHANCE = ARTILLERY_COMBAT?.MAX_HIT_CHANCE || 0.8;
        const MAX_RANGE = ARTILLERY_COMBAT?.RANGE || 28;
        const HEIGHT_BONUS = ARTILLERY_COMBAT?.HEIGHT_BONUS || 0.15;

        // Height advantage
        const heightAdvantage = shooterY - targetY;
        const bonusChance = Math.max(0, heightAdvantage * HEIGHT_BONUS);
        const baseHitChance = Math.min(MAX_HIT_CHANCE, BASE_HIT_CHANCE + bonusChance);

        // Distance bonus: linear scale from 0% at max range (28) to 100% at point blank (0)
        const distanceBonus = Math.max(0, (MAX_RANGE - distance) / MAX_RANGE);
        const hitChance = baseHitChance + (1.0 - baseHitChance) * distanceBonus;

        return Math.min(MAX_HIT_CHANCE, hitChance);
    }

    /**
     * Calculate miss position (offset from target)
     */
    calculateMissPosition(targetPos, heading) {
        const offset = 1 + Math.random() * 2;  // 1-3 units away
        const angle = heading + (Math.random() - 0.5) * Math.PI / 3;  // +/- 30 degrees

        return {
            x: targetPos.x + Math.sin(angle) * offset,
            y: this.terrainGenerator?.getWorldHeight(
                targetPos.x + Math.sin(angle) * offset,
                targetPos.z + Math.cos(angle) * offset
            ) || targetPos.y,
            z: targetPos.z + Math.cos(angle) * offset
        };
    }

    /**
     * Apply artillery damage to target
     */
    applyArtilleryDamage(target) {
        if (!target) return;

        switch (target.type) {
            case 'bandit':
                // Kill bandit instantly (artillery is powerful)
                if (target.controller) {
                    target.controller.kill();  // Trigger death animation
                }
                // Update AIController/BanditController for network sync
                if (target.tentId && this.banditController) {
                    this.banditController.killEntity(target.tentId, this.gameState.clientId);
                }
                break;

            case 'brownbear':
                // Kill bear instantly (artillery is powerful)
                if (target.controller) {
                    target.controller.kill();  // Trigger death animation
                }
                // Update BrownBearController for network sync
                if (target.denId && this.brownBearController) {
                    this.brownBearController.killEntity(target.denId, this.gameState.clientId);
                }
                break;

            case 'player':
                // Send damage message to peer
                console.log(`[Artillery] Sending damage to player peerId=${target.peerId}`);
                this.networkManager.broadcastP2P({
                    type: 'artillery_damage',
                    payload: {
                        targetPeerId: target.peerId,
                        damage: 100,  // Instant kill for players too
                        shooterPosition: this.playerObject.position.toArray()
                    }
                });
                break;

            case 'structure':
                // Damage structure
                this.applyArtilleryStructureDamage(target);
                break;

            case 'boat':
                // Send damage message to boat owner
                this.networkManager.broadcastP2P({
                    type: 'artillery_boat_damage',
                    payload: {
                        targetPeerId: target.peerId,
                        entityType: target.entityType,
                        damage: 50,  // Same as structure damage
                        shooterPosition: this.playerObject.position.toArray()
                    }
                });
                break;
        }
    }

    /**
     * Apply artillery damage to a structure
     * Reduces durability by flat amount and reverse-calculates lastRepairTime
     */
    applyArtilleryStructureDamage(target) {
        const structure = target.entity;
        const userData = structure.userData;
        if (!userData) return;

        const DAMAGE_AMOUNT = 50;  // Flat durability damage per hit
        const DECAY_EXPONENT = 1.434;
        const DECAY_INVERSE = 0.697;

        // Calculate current durability
        const quality = userData.quality || 50;
        const maxLifespanHours = Math.pow(quality, DECAY_EXPONENT);
        const now = Date.now();
        const elapsedMs = now - (userData.lastRepairTime || now);
        const elapsedHours = elapsedMs / (1000 * 60 * 60);
        const remainingHours = Math.max(0, maxLifespanHours - elapsedHours);
        const currentDurability = Math.pow(remainingHours, DECAY_INVERSE);

        // Apply flat damage
        const newDurability = currentDurability - DAMAGE_AMOUNT;

        // Check if target is a boat type
        const boatTypes = ['boat', 'sailboat', 'ship2', 'ship'];
        const isBoat = boatTypes.includes(userData.modelType);

        if (newDurability <= 0) {
            userData._decayMessageSent = true;

            if (isBoat) {
                // Boat destroyed - play local effects and notify server
                console.log(`[Artillery] Boat ${userData.objectId} destroyed (durability ${currentDurability.toFixed(1)} -> 0)`);

                // Play crash sound locally
                if (this.audioManager) {
                    this.audioManager.playBoatCrashSound(userData.modelType);
                }

                // Start sinking animation locally
                if (this.boatSinkingSystem) {
                    this.boatSinkingSystem.startSinking(structure, userData.objectId, null);
                }

                // Tell server to broadcast to other clients and schedule removal
                this.networkManager.sendMessage('artillery_boat_sink', {
                    objectId: userData.objectId,
                    chunkKey: userData.chunkKey,
                    modelType: userData.modelType
                });
            } else {
                // Regular structure destroyed - convert to ruin immediately
                this.networkManager.sendMessage('convert_to_ruin', {
                    structureId: userData.objectId,
                    chunkId: `chunk_${userData.chunkKey}`
                });
                console.log(`[Artillery] Structure ${userData.objectId} destroyed (durability ${currentDurability.toFixed(1)} -> 0)`);
            }
        } else {
            // Reverse-calculate new lastRepairTime from new durability
            // newDurability = newRemainingHours^0.697
            // newRemainingHours = newDurability^(1/0.697)
            const newRemainingHours = Math.pow(newDurability, 1 / DECAY_INVERSE);
            const newElapsedHours = maxLifespanHours - newRemainingHours;
            const newLastRepairTime = now - (newElapsedHours * 60 * 60 * 1000);

            // Update local userData
            userData.lastRepairTime = newLastRepairTime;
            userData.currentDurability = newDurability;

            // Send damage to server for persistence and broadcast
            this.networkManager.sendMessage('artillery_structure_damage', {
                structureId: userData.objectId,
                chunkId: `chunk_${userData.chunkKey}`,
                lastRepairTime: newLastRepairTime
            });

            console.log(`[Artillery] Structure ${userData.objectId} damaged (durability ${currentDurability.toFixed(1)} -> ${newDurability.toFixed(1)})`);
        }
    }

    /**
     * Check if a structure should convert to ruin after damage
     */
    checkStructureForRuin(structure) {
        const userData = structure.userData;
        if (!userData || userData._decayMessageSent) return;

        // Calculate current durability using the same formula as MessageRouter
        const durability = this.messageRouter?.calculateStructureDurability?.(userData);

        if (durability !== undefined && durability <= 0) {
            userData._decayMessageSent = true;
            this.networkManager.sendMessage('convert_to_ruin', {
                structureId: userData.objectId,
                chunkId: `chunk_${userData.chunkKey}`
            });
            console.log(`[Artillery] Structure ${userData.objectId} durability reached 0, converting to ruin`);
        }
    }

    /**
     * Apply wear damage to artillery from firing
     * Reduces durability by 1 per shot
     * @param {THREE.Object3D} artillery - The artillery object
     */
    applyArtilleryWearDamage(artillery) {
        const userData = artillery.userData;
        if (!userData) return;

        const DAMAGE_AMOUNT = 1;  // 1 durability per shot
        const DECAY_EXPONENT = 1.434;
        const DECAY_INVERSE = 0.697;

        // Calculate current durability
        const quality = userData.quality || 50;
        const maxLifespanHours = Math.pow(quality, DECAY_EXPONENT);
        const now = Date.now();
        const elapsedMs = now - (userData.lastRepairTime || now);
        const elapsedHours = elapsedMs / (1000 * 60 * 60);
        const remainingHours = Math.max(0, maxLifespanHours - elapsedHours);
        const currentDurability = Math.pow(remainingHours, DECAY_INVERSE);

        // Apply wear damage
        const newDurability = currentDurability - DAMAGE_AMOUNT;

        if (newDurability <= 0) {
            // Artillery destroyed from wear - remove it entirely
            userData._decayMessageSent = true;
            this.networkManager.sendMessage('convert_to_ruin', {
                structureId: userData.objectId,
                chunkId: `chunk_${userData.chunkKey}`
            });
            console.log(`[Artillery] Artillery ${userData.objectId} destroyed from wear - removed (durability ${currentDurability.toFixed(1)} -> 0)`);

            // Force leave the artillery since it's destroyed
            this.handleLeaveArtillery();
        } else {
            // Reverse-calculate new lastRepairTime from new durability
            const newRemainingHours = Math.pow(newDurability, 1 / DECAY_INVERSE);
            const newElapsedHours = maxLifespanHours - newRemainingHours;
            const newLastRepairTime = now - (newElapsedHours * 60 * 60 * 1000);

            // Update local userData
            userData.lastRepairTime = newLastRepairTime;
            userData.currentDurability = newDurability;

            // Send damage to server for persistence and broadcast
            this.networkManager.sendMessage('artillery_structure_damage', {
                structureId: userData.objectId,
                chunkId: `chunk_${userData.chunkKey}`,
                lastRepairTime: newLastRepairTime
            });

            console.log(`[Artillery] Artillery wear (durability ${currentDurability.toFixed(1)} -> ${newDurability.toFixed(1)})`);
        }
    }

    /**
     * Handle load crate button press
     * Loads a nearby crate onto the attached cart
     * Now waits for server confirmation before completing
     */
    async handleLoadCrate() {
        const cartState = this.gameState.cartAttachmentState;
        const crateState = this.gameState.crateLoadState;
        const nearestCrate = this.gameState.nearestLoadableCrate;

        // Validate prerequisites
        if (!cartState.isAttached || !cartState.attachedCart) {
            ui.showToast('Must have cart attached first', 'warning');
            return;
        }
        if (crateState.isLoaded) {
            ui.showToast('Cart already has a crate loaded', 'warning');
            return;
        }
        if (!nearestCrate || !nearestCrate.object) {
            ui.showToast('No crate nearby', 'warning');
            return;
        }

        const crate = nearestCrate.object;
        const cart = cartState.attachedCart;
        const crateId = crate.userData.objectId;
        const crateChunkKey = crate.userData.chunkKey;

        // Mark crate as occupied locally first (prevents double-loading attempts)
        if (this.mobileEntitySystem) {
            this.mobileEntitySystem.setOccupied(crateId, this.gameState.clientId);
        }

        // Create a promise to wait for server response
        const claimPromise = new Promise((resolve, reject) => {
            this.pendingCrateClaim = { entityId: crateId, resolve, reject };

            // Timeout after configured duration
            setTimeout(() => {
                if (this.pendingCrateClaim && this.pendingCrateClaim.entityId === crateId) {
                    this.pendingCrateClaim = null;
                    reject(new Error('Server response timeout'));
                }
            }, CONFIG.CRATE_CART.CLAIM_TIMEOUT);
        });

        // Send claim message to server
        this.networkManager.sendMessage('claim_crate', {
            entityId: crateId,
            chunkKey: crateChunkKey,
            clientId: this.gameState.clientId
        });

        try {
            // Wait for server confirmation
            const response = await claimPromise;

            // Server confirmed - now complete the local state changes
            crateState.isLoaded = true;
            crateState.loadedCrate = crate;
            crateState.crateId = crateId;
            crateState.crateChunkKey = crateChunkKey;
            crateState.crateQuality = crate.userData.quality;
            crateState.crateLastRepairTime = crate.userData.lastRepairTime;
            crateState.crateInventory = response.inventory || crate.userData.inventory || { items: [] };

            // Remove physics collider (safe now that server confirmed)
            if (this.physicsManager) {
                this.physicsManager.removeCollider(crateId);
                crate.userData.physicsHandle = null;  // Clear stale reference
                // Re-add to registry (removeCollider triggers callback that deletes it)
                if (this.objectRegistry) {
                    this.objectRegistry.set(crateId, crate);
                }
            }

            // Parent crate to cart (visual attachment)
            cart.add(crate);
            crate.position.set(0, CONFIG.CRATE_CART.CART_HEIGHT_OFFSET, CONFIG.CRATE_CART.CART_Z_OFFSET);
            crate.rotation.set(0, 0, 0);

            // Unregister from LOD systems (they use local position which breaks when parented)
            if (this.structureModelSystem) {
                this.structureModelSystem.unregisterStructure(crateId);
            }
            if (this.billboardSystem) {
                this.billboardSystem.removeTreeBillboard(crate);
            }

            // Broadcast to peers
            this.networkManager.broadcastP2P({
                type: 'crate_loaded',
                payload: {
                    crateId: crateId,
                    cartId: cartState.cartId,
                    inventory: crateState.crateInventory
                }
            });

            ui.showToast('Crate loaded', 'info');

        } catch (error) {
            // Server rejected or timeout - restore state
            console.warn('[Crate] Load failed:', error.message);

            // Clear occupied status since we don't own it
            if (this.mobileEntitySystem) {
                this.mobileEntitySystem.clearOccupied(crateId);
            }

            ui.showToast(error.message || 'Failed to load crate', 'warning');
        }
    }

    /**
     * Handle unload crate button press
     * Unloads the crate from the cart to the ground
     * Now validates drop location and waits for server confirmation
     */
    async handleUnloadCrate() {
        const cartState = this.gameState.cartAttachmentState;
        const crateState = this.gameState.crateLoadState;

        if (!crateState.isLoaded || !crateState.loadedCrate) {
            ui.showToast('No crate to unload', 'warning');
            return;
        }

        const crate = crateState.loadedCrate;
        const cart = cartState.attachedCart;
        const crateId = crateState.crateId;

        // Get world position before unparenting
        const worldPosition = new THREE.Vector3();
        crate.getWorldPosition(worldPosition);

        // Get cart's world rotation for crate orientation
        const worldRotation = cart ? cart.rotation.y : 0;

        // Calculate drop position
        const dropOffset = CONFIG.CRATE_CART.DROP_OFFSET;
        const dropX = worldPosition.x - Math.sin(worldRotation) * dropOffset;
        const dropZ = worldPosition.z - Math.cos(worldRotation) * dropOffset;
        const dropY = this.terrainGenerator.getWorldHeight(dropX, dropZ);

        // Validate drop location
        if (dropY < CONFIG.CRATE_CART.MIN_DROP_HEIGHT || dropY > CONFIG.CRATE_CART.MAX_DROP_HEIGHT) {
            ui.showToast('Cannot unload here - invalid terrain', 'warning');
            return;
        }

        // Check if drop location is in water (below sea level)
        if (dropY < 0) {
            ui.showToast('Cannot unload in water', 'warning');
            return;
        }

        // Calculate new chunk (center-based)
        const { chunkX: newChunkX, chunkZ: newChunkZ } = ChunkCoordinates.worldToChunk(dropX, dropZ);
        const newChunkKey = `${newChunkX},${newChunkZ}`;

        // Create a promise to wait for server response
        const releasePromise = new Promise((resolve, reject) => {
            this.pendingCrateRelease = { entityId: crateId, resolve, reject };

            // Timeout after configured duration
            setTimeout(() => {
                if (this.pendingCrateRelease && this.pendingCrateRelease.entityId === crateId) {
                    this.pendingCrateRelease = null;
                    reject(new Error('Server response timeout'));
                }
            }, CONFIG.CRATE_CART.CLAIM_TIMEOUT);
        });

        // Send release message to server FIRST (before local changes)
        this.networkManager.sendMessage('release_crate', {
            entityId: crateId,
            chunkKey: crateState.crateChunkKey,
            clientId: this.gameState.clientId,
            position: [dropX, dropY, dropZ],
            rotation: worldRotation,
            quality: crateState.crateQuality,
            lastRepairTime: crateState.crateLastRepairTime,
            inventory: crateState.crateInventory
        });

        try {
            // Wait for server confirmation
            await releasePromise;

            // Server confirmed - now apply local changes
            // Unparent from cart
            cart.remove(crate);
            this.scene.add(crate);

            // Set world position
            crate.position.set(dropX, dropY, dropZ);
            crate.rotation.y = worldRotation;

            // Update chunk key for new position
            crate.userData.chunkKey = newChunkKey;

            // Re-add physics collider
            if (this.physicsManager) {
                const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS?.crate || { width: 1, depth: 1 };
                this.physicsManager.createStaticCollider(
                    crateId,
                    { type: 'cuboid', width: dims.width || 1, height: 1.5, depth: dims.depth || 1 },
                    crate.position,
                    worldRotation
                );
            }

            // Re-add to objectRegistry for proximity detection
            if (this.objectRegistry) {
                this.objectRegistry.set(crateId, crate);
            }

            // Add to chunkObjects for chunk management
            if (this.chunkManager && this.chunkManager.chunkObjects) {
                let chunkObjects = this.chunkManager.chunkObjects.get(newChunkKey);
                if (!chunkObjects) {
                    chunkObjects = [];
                    this.chunkManager.chunkObjects.set(newChunkKey, chunkObjects);
                }
                if (!chunkObjects.includes(crate)) {
                    chunkObjects.push(crate);
                }
            }

            // Re-register with LOD systems now that crate has world position again
            if (this.structureModelSystem) {
                this.structureModelSystem.registerStructure(crate, 'crate', newChunkKey);
            }
            if (this.billboardSystem) {
                this.billboardSystem.addTreeBillboard(crate, 'crate', crate.position);
            }

            // Clear occupied status only AFTER server confirms
            if (this.mobileEntitySystem) {
                this.mobileEntitySystem.clearOccupied(crateId);
            }

            // Broadcast to peers
            this.networkManager.broadcastP2P({
                type: 'crate_unloaded',
                payload: {
                    crateId: crateId,
                    position: [dropX, dropY, dropZ],
                    rotation: worldRotation,
                    inventory: crateState.crateInventory
                }
            });

            // Clear state
            crateState.isLoaded = false;
            crateState.loadedCrate = null;
            crateState.crateId = null;
            crateState.crateChunkKey = null;
            crateState.crateQuality = null;
            crateState.crateLastRepairTime = null;
            crateState.crateInventory = null;

            ui.showToast('Crate unloaded', 'info');

        } catch (error) {
            // Server rejected or timeout - crate stays on cart
            console.warn('[Crate] Unload failed:', error.message);
            ui.showToast(error.message || 'Failed to unload crate', 'warning');
        }
    }

    /**
     * Handle load crate button press while piloting a boat
     * Supports multi-crate for ship2 (4 slots), single crate for sailboat
     */
    async handleLoadCrateToSailboat() {
        const mobileState = this.gameState.mobileEntityState;
        const crateState = this.gameState.crateLoadState;
        const nearestCrate = this.gameState.nearestLoadableCrate;
        const entityType = mobileState?.entityType;

        // Validate prerequisites
        if (mobileState.phase !== 'piloting') {
            ui.showToast('Must be piloting a boat', 'warning');
            return;
        }

        // Check if vehicle supports crates
        const maxSlots = CONFIG.CRATE_VEHICLES?.CAPACITY?.[entityType] || 0;
        if (maxSlots === 0) {
            ui.showToast('This boat cannot carry crates', 'warning');
            return;
        }

        // Check if vehicle is full
        const currentCount = crateState.loadedCrates?.length || 0;
        if (currentCount >= maxSlots) {
            ui.showToast('No room for more crates', 'warning');
            return;
        }

        if (this.mobileEntitySystem.velocity !== 0) {
            ui.showToast('Boat must be stopped', 'warning');
            return;
        }
        if (!nearestCrate || !nearestCrate.object) {
            ui.showToast('No crate nearby', 'warning');
            return;
        }

        // Find next available slot
        const slotIndex = currentCount;  // Next slot (0, 1, 2, or 3 for ship2)
        const slotConfig = CONFIG.CRATE_VEHICLES?.[entityType]?.slots?.[slotIndex];
        if (!slotConfig) {
            ui.showToast('No slot configuration found', 'warning');
            return;
        }

        const crate = nearestCrate.object;
        const boat = mobileState.currentEntity;
        const crateId = crate.userData.objectId;
        const crateChunkKey = crate.userData.chunkKey;

        // Mark crate as occupied locally first (prevents double-loading attempts)
        if (this.mobileEntitySystem) {
            this.mobileEntitySystem.setOccupied(crateId, this.gameState.clientId);
        }

        // Create a promise to wait for server response
        const claimPromise = new Promise((resolve, reject) => {
            this.pendingCrateClaim = { entityId: crateId, resolve, reject };

            // Timeout after configured duration
            setTimeout(() => {
                if (this.pendingCrateClaim && this.pendingCrateClaim.entityId === crateId) {
                    this.pendingCrateClaim = null;
                    reject(new Error('Server response timeout'));
                }
            }, CONFIG.CRATE_VEHICLES.CLAIM_TIMEOUT);
        });

        // Send claim message to server
        this.networkManager.sendMessage('claim_crate', {
            entityId: crateId,
            chunkKey: crateChunkKey,
            clientId: this.gameState.clientId
        });

        try {
            // Wait for server confirmation
            const response = await claimPromise;

            // Server confirmed - add to loadedCrates array
            const crateData = {
                slotIndex,
                crate,
                crateId,
                crateChunkKey,
                crateQuality: crate.userData.quality,
                crateLastRepairTime: crate.userData.lastRepairTime,
                crateInventory: response.inventory || crate.userData.inventory || { items: [] }
            };
            crateState.loadedCrates.push(crateData);

            // Also update legacy single-crate state for compatibility
            crateState.isLoaded = true;
            crateState.loadedCrate = crate;
            crateState.crateId = crateId;
            crateState.crateChunkKey = crateChunkKey;
            crateState.crateQuality = crateData.crateQuality;
            crateState.crateLastRepairTime = crateData.crateLastRepairTime;
            crateState.crateInventory = crateData.crateInventory;

            // Remove physics collider (safe now that server confirmed)
            if (this.physicsManager) {
                this.physicsManager.removeCollider(crateId);
                crate.userData.physicsHandle = null;  // Clear stale reference
                // Re-add to registry (removeCollider triggers callback that deletes it)
                if (this.objectRegistry) {
                    this.objectRegistry.set(crateId, crate);
                }
            }

            // Parent crate to boat (visual attachment) at slot position
            boat.add(crate);
            crate.position.set(slotConfig.x, slotConfig.y, slotConfig.z);
            crate.rotation.set(0, 0, 0);

            // Unregister from LOD systems (they use local position which breaks when parented)
            if (this.structureModelSystem) {
                this.structureModelSystem.unregisterStructure(crateId);
            }
            if (this.billboardSystem) {
                this.billboardSystem.removeTreeBillboard(crate);
            }

            // Broadcast to peers with slot info
            this.networkManager.broadcastP2P({
                type: 'crate_loaded',
                payload: {
                    crateId: crateId,
                    cartId: mobileState.entityId,  // Use boat ID
                    vehicleType: entityType,
                    slotIndex: slotIndex,
                    inventory: crateData.crateInventory
                }
            });

            const remaining = maxSlots - crateState.loadedCrates.length;
            if (maxSlots > 1) {
                ui.showToast(`Crate loaded (${remaining} slots remaining)`, 'info');
            } else {
                ui.showToast('Crate loaded', 'info');
            }

        } catch (error) {
            // Server rejected or timeout - restore state
            console.warn('[Crate] Boat load failed:', error.message);

            // Clear occupied status since we don't own it
            if (this.mobileEntitySystem) {
                this.mobileEntitySystem.clearOccupied(crateId);
            }

            ui.showToast(error.message || 'Failed to load crate', 'warning');
        }
    }

    /**
     * Handle load artillery button press while piloting ship2
     * Loads artillery onto port/starboard broadside positions
     */
    handleLoadArtilleryToShip() {
        const mobileState = this.gameState.mobileEntityState;
        const artilleryShipState = this.gameState.artilleryShipLoadState;
        const nearestArtillery = this.gameState.nearestLoadableArtillery;
        const entityType = mobileState?.entityType;

        // Must be piloting ship2
        if (mobileState.phase !== 'piloting' || entityType !== 'ship2') {
            ui.showToast('Must be piloting a ship', 'warning');
            return;
        }

        // Check artillery capacity
        const maxSlots = CONFIG.CRATE_VEHICLES?.ARTILLERY_CAPACITY?.[entityType] || 0;
        if (maxSlots === 0) {
            ui.showToast('This ship cannot carry artillery', 'warning');
            return;
        }

        // Check if ship is full
        const currentCount = artilleryShipState.loadedArtillery?.length || 0;
        if (currentCount >= maxSlots) {
            ui.showToast('No room for more artillery', 'warning');
            return;
        }

        // Ship must be stopped
        if (this.mobileEntitySystem && this.mobileEntitySystem.velocity !== 0) {
            ui.showToast('Ship must be stopped', 'warning');
            return;
        }

        // Check for nearby artillery
        if (!nearestArtillery || !nearestArtillery.object) {
            ui.showToast('No artillery nearby', 'warning');
            return;
        }

        const artillery = nearestArtillery.object;
        const artilleryId = artillery.userData.objectId;

        // Check if artillery is being towed by a horse
        const artilleryTowState = this.gameState.artilleryAttachmentState;
        if (artilleryTowState?.isAttached && artilleryTowState?.artilleryId === artilleryId) {
            ui.showToast('Release artillery from horse first', 'warning');
            return;
        }

        // Check if artillery is being manned
        const manningState = this.gameState.artilleryManningState;
        if (manningState?.isManning && manningState?.artilleryId === artilleryId) {
            ui.showToast('Cannot load - artillery is being manned', 'warning');
            return;
        }

        // Check if occupied by someone else
        if (this.mobileEntitySystem?.isOccupied(artilleryId) &&
            this.mobileEntitySystem.getOccupant(artilleryId) !== this.gameState.clientId) {
            ui.showToast('Artillery is in use', 'warning');
            return;
        }

        // Get slot configuration
        const slotIndex = currentCount;
        const slotConfig = CONFIG.CRATE_VEHICLES?.ship2_artillery?.slots?.[slotIndex];
        if (!slotConfig) {
            ui.showToast('No slot configuration found', 'warning');
            return;
        }

        const ship = mobileState.currentEntity;
        const artilleryChunkKey = artillery.userData.chunkKey;

        // Mark as occupied
        if (this.mobileEntitySystem) {
            this.mobileEntitySystem.setOccupied(artilleryId, this.gameState.clientId);
        }

        // Remove physics collider
        if (this.physicsManager) {
            this.physicsManager.removeCollider(artilleryId);
            artillery.userData.physicsHandle = null;  // Clear stale reference
            if (this.objectRegistry) {
                this.objectRegistry.set(artilleryId, artillery);
            }
        }

        // Store in loaded artillery array
        const artilleryData = {
            slotIndex,
            artillery,
            artilleryId,
            artilleryChunkKey,
            artilleryQuality: artillery.userData.quality,
            artilleryLastRepairTime: artillery.userData.lastRepairTime,
            artilleryInventory: artillery.userData.inventory || { items: [] }
        };
        artilleryShipState.loadedArtillery.push(artilleryData);

        // Parent artillery to ship at slot position with initial rotation
        ship.add(artillery);
        artillery.position.set(slotConfig.x, slotConfig.y, slotConfig.z);
        artillery.rotation.set(0, slotConfig.rotation || 0, 0);

        // Unregister from LOD systems
        if (this.structureModelSystem) {
            this.structureModelSystem.unregisterStructure(artilleryId);
        }
        if (this.billboardSystem) {
            this.billboardSystem.removeTreeBillboard(artillery);
        }

        // Send claim message to server
        this.networkManager.sendMessage('claim_ship_artillery', {
            entityId: artilleryId,
            chunkKey: artilleryChunkKey,
            clientId: this.gameState.clientId
        });

        // Broadcast to peers
        this.networkManager.broadcastP2P({
            type: 'artillery_loaded_ship',
            payload: {
                artilleryId: artilleryId,
                artilleryChunkKey: artilleryChunkKey,
                shipId: mobileState.entityId,
                vehicleType: entityType,
                slotIndex: slotIndex,
                inventory: artilleryData.artilleryInventory
            }
        });

        const remaining = maxSlots - artilleryShipState.loadedArtillery.length;
        const slotName = slotIndex === 0 ? 'port' : 'starboard';
        ui.showToast(`Artillery loaded (${slotName}), ${remaining} slot${remaining !== 1 ? 's' : ''} remaining`, 'info');
    }

    /**
     * Handle unload artillery button press while piloting ship2
     * LIFO unloading: removes the last loaded artillery from the array
     */
    handleUnloadArtilleryFromShip() {
        const mobileState = this.gameState.mobileEntityState;
        const artilleryShipState = this.gameState.artilleryShipLoadState;
        const entityType = mobileState?.entityType;

        // Check for loaded artillery
        const hasLoadedArtillery = artilleryShipState.loadedArtillery?.length > 0;
        if (!hasLoadedArtillery) {
            ui.showToast('No artillery to unload', 'warning');
            return;
        }

        // Must be piloting ship2
        if (mobileState.phase !== 'piloting' || entityType !== 'ship2') {
            ui.showToast('Must be piloting a ship', 'warning');
            return;
        }

        // Ship must be stopped
        if (this.mobileEntitySystem && this.mobileEntitySystem.velocity !== 0) {
            ui.showToast('Ship must be stopped', 'warning');
            return;
        }

        // Check if any artillery is being manned
        const manningState = this.gameState.artilleryManningState;
        if (manningState?.isManning) {
            const mannedArtilleryId = manningState.artilleryId;
            const isLoadedOnShip = artilleryShipState.loadedArtillery.some(a => a.artilleryId === mannedArtilleryId);
            if (isLoadedOnShip) {
                ui.showToast('Cannot unload - artillery is being manned', 'warning');
                return;
            }
        }

        const ship = mobileState.currentEntity;

        // Find valid landing position (search for land nearby)
        const landingPos = this.findCrateLandingPosition(ship);
        if (!landingPos) {
            ui.showToast('No valid landing position nearby', 'warning');
            return;
        }

        // LIFO: Get the last loaded artillery
        const lastSlot = artilleryShipState.loadedArtillery.pop();
        const artillery = lastSlot.artillery;
        const artilleryId = lastSlot.artilleryId;

        // Unparent from ship and place in world
        ship.remove(artillery);
        this.scene.add(artillery);
        artillery.position.set(landingPos.x, landingPos.y, landingPos.z);
        artillery.rotation.set(0, ship.rotation.y, 0);  // Face same direction as ship

        // Re-add physics collider
        if (this.physicsManager) {
            const artilleryDimensions = CONFIG.CONSTRUCTION_GRID_DIMENSIONS?.artillery || { radius: 0.4, height: 2.0 };
            this.physicsManager.createStaticCollider(
                artilleryId,
                artilleryDimensions,
                artillery.position
            );
        }

        // Re-register with LOD systems
        const newChunkCoords = this.chunkCoordinates.worldToChunk(landingPos.x, landingPos.z);
        const newChunkKey = `${newChunkCoords.chunkX},${newChunkCoords.chunkZ}`;
        artillery.userData.chunkKey = newChunkKey;

        if (this.structureModelSystem) {
            this.structureModelSystem.registerStructure(artillery, 'artillery', newChunkKey);
        }

        // Clear occupied status
        if (this.mobileEntitySystem) {
            this.mobileEntitySystem.clearOccupied(artilleryId);
        }

        // Send release message to server
        this.networkManager.sendMessage('release_ship_artillery', {
            entityId: artilleryId,
            chunkKey: lastSlot.artilleryChunkKey,
            clientId: this.gameState.clientId,
            position: [landingPos.x, landingPos.y, landingPos.z],
            rotation: ship.rotation.y,
            quality: lastSlot.artilleryQuality,
            lastRepairTime: lastSlot.artilleryLastRepairTime,
            inventory: lastSlot.artilleryInventory
        });

        // Broadcast to peers
        this.networkManager.broadcastP2P({
            type: 'artillery_unloaded_ship',
            payload: {
                artilleryId: artilleryId,
                position: [landingPos.x, landingPos.y, landingPos.z],
                rotation: ship.rotation.y,
                inventory: lastSlot.artilleryInventory
            }
        });

        const remaining = artilleryShipState.loadedArtillery.length;
        ui.showToast(`Artillery unloaded (${remaining} remaining)`, 'info');
    }

    /**
     * Handle load horse button press while piloting ship2
     * Loads horse onto deck positions
     */
    handleLoadHorseToShip() {
        const mobileState = this.gameState.mobileEntityState;
        const horseShipState = this.gameState.horseShipLoadState;
        const nearestHorse = this.gameState.nearestLoadableHorse;
        const entityType = mobileState?.entityType;

        // Must be piloting ship2
        if (mobileState.phase !== 'piloting' || entityType !== 'ship2') {
            ui.showToast('Must be piloting a ship', 'warning');
            return;
        }

        // Check horse capacity
        const maxSlots = CONFIG.HORSE_VEHICLES?.CAPACITY?.[entityType] || 0;
        if (maxSlots === 0) {
            ui.showToast('This ship cannot carry horses', 'warning');
            return;
        }

        // Check if ship is full
        const currentCount = horseShipState.loadedHorses?.length || 0;
        if (currentCount >= maxSlots) {
            ui.showToast('No room for more horses', 'warning');
            return;
        }

        // Ship must be stopped
        if (this.mobileEntitySystem && this.mobileEntitySystem.velocity !== 0) {
            ui.showToast('Ship must be stopped', 'warning');
            return;
        }

        // Check for nearby horse
        if (!nearestHorse || !nearestHorse.object) {
            ui.showToast('No horse nearby', 'warning');
            return;
        }

        const horse = nearestHorse.object;
        const horseId = horse.userData.objectId;

        // Check if horse is occupied (being ridden)
        if (this.mobileEntitySystem?.isOccupied(horseId) &&
            this.mobileEntitySystem.getOccupant(horseId) !== this.gameState.clientId) {
            ui.showToast('Horse is being ridden', 'warning');
            return;
        }

        // Get slot configuration
        const slotIndex = currentCount;
        const slotConfig = CONFIG.HORSE_VEHICLES?.ship2?.slots?.[slotIndex];
        if (!slotConfig) {
            ui.showToast('No slot configuration found', 'warning');
            return;
        }

        const ship = mobileState.currentEntity;
        const horseChunkKey = horse.userData.chunkKey;

        // Mark as occupied
        if (this.mobileEntitySystem) {
            this.mobileEntitySystem.setOccupied(horseId, this.gameState.clientId);
        }

        // Remove physics collider
        if (this.physicsManager) {
            this.physicsManager.removeCollider(horseId);
            horse.userData.physicsHandle = null;
            if (this.objectRegistry) {
                this.objectRegistry.set(horseId, horse);
            }
        }

        // Stop horse animation before parenting
        if (horse.userData.mixer) {
            horse.userData.mixer.stopAllAction();
        }

        // Store in loaded horses array
        const horseData = {
            slotIndex,
            horse,
            horseId,
            horseChunkKey,
            horseQuality: horse.userData.quality,
            horseLastRepairTime: horse.userData.lastRepairTime
        };
        horseShipState.loadedHorses.push(horseData);

        // Parent horse to ship at slot position
        ship.add(horse);
        horse.position.set(slotConfig.x, slotConfig.y, slotConfig.z);
        horse.rotation.set(0, Math.PI, 0);  // Face toward bow

        // Unregister from LOD systems
        if (this.structureModelSystem) {
            this.structureModelSystem.unregisterStructure(horseId);
        }
        if (this.billboardSystem) {
            this.billboardSystem.removeTreeBillboard(horse);
        }

        // Send claim message to server
        this.networkManager.sendMessage('claim_ship_horse', {
            entityId: horseId,
            chunkKey: horseChunkKey,
            clientId: this.gameState.clientId
        });

        // Broadcast to peers
        this.networkManager.broadcastP2P({
            type: 'horse_loaded_ship',
            payload: {
                horseId: horseId,
                shipId: mobileState.entityId,
                vehicleType: entityType,
                slotIndex: slotIndex
            }
        });

        const remaining = maxSlots - horseShipState.loadedHorses.length;
        ui.showToast(`Horse loaded (${remaining} slot${remaining !== 1 ? 's' : ''} remaining)`, 'info');
    }

    /**
     * Handle unload horse button press while piloting ship2
     * LIFO unloading: removes the last loaded horse from the array
     */
    handleUnloadHorseFromShip() {
        const mobileState = this.gameState.mobileEntityState;
        const horseShipState = this.gameState.horseShipLoadState;
        const entityType = mobileState?.entityType;

        // Check for loaded horses
        const hasLoadedHorses = horseShipState.loadedHorses?.length > 0;
        if (!hasLoadedHorses) {
            ui.showToast('No horse to unload', 'warning');
            return;
        }

        // Must be piloting ship2
        if (mobileState.phase !== 'piloting' || entityType !== 'ship2') {
            ui.showToast('Must be piloting a ship', 'warning');
            return;
        }

        // Ship must be stopped
        if (this.mobileEntitySystem && this.mobileEntitySystem.velocity !== 0) {
            ui.showToast('Ship must be stopped', 'warning');
            return;
        }

        const ship = mobileState.currentEntity;

        // Find valid landing position (search for land nearby)
        const landingPos = this.findCrateLandingPosition(ship);
        if (!landingPos) {
            ui.showToast('No land nearby to unload horse', 'warning');
            return;
        }

        // LIFO: Get the last loaded horse
        const lastSlot = horseShipState.loadedHorses.pop();
        const horse = lastSlot.horse;
        const horseId = lastSlot.horseId;

        // Unparent from ship and place in world
        ship.remove(horse);
        this.scene.add(horse);
        horse.position.set(landingPos.x, landingPos.y, landingPos.z);
        horse.rotation.set(0, ship.rotation.y, 0);  // Face same direction as ship

        // Re-add physics collider
        if (this.physicsManager) {
            const horseDimensions = CONFIG.CONSTRUCTION_GRID_DIMENSIONS?.horse || { radius: 0.3, height: 1.5 };
            this.physicsManager.createStaticCollider(
                horseId,
                horseDimensions,
                horse.position
            );
        }

        // Re-register with LOD systems
        const newChunkCoords = this.chunkCoordinates.worldToChunk(landingPos.x, landingPos.z);
        const newChunkKey = `${newChunkCoords.chunkX},${newChunkCoords.chunkZ}`;
        horse.userData.chunkKey = newChunkKey;

        if (this.structureModelSystem) {
            this.structureModelSystem.registerStructure(horse, 'horse', newChunkKey);
        }

        // Clear occupied status
        if (this.mobileEntitySystem) {
            this.mobileEntitySystem.clearOccupied(horseId);
        }

        // Send release message to server
        this.networkManager.sendMessage('release_ship_horse', {
            entityId: horseId,
            chunkKey: lastSlot.horseChunkKey,
            clientId: this.gameState.clientId,
            position: [landingPos.x, landingPos.y, landingPos.z],
            rotation: ship.rotation.y,
            quality: lastSlot.horseQuality,
            lastRepairTime: lastSlot.horseLastRepairTime
        });

        // Broadcast to peers
        this.networkManager.broadcastP2P({
            type: 'horse_unloaded_ship',
            payload: {
                horseId: horseId,
                position: [landingPos.x, landingPos.y, landingPos.z],
                rotation: ship.rotation.y
            }
        });

        const remaining = horseShipState.loadedHorses.length;
        ui.showToast(`Horse unloaded (${remaining} remaining)`, 'info');
    }

    /**
     * Handle switching from ship pilot to ship cannon gunner position
     * Player mans a loaded artillery on the ship (port or starboard)
     * @param {number} slotIndex - 0 for port, 1 for starboard
     */
    handleManShipCannon(slotIndex) {
        const mobileState = this.gameState.mobileEntityState;
        const artilleryShipState = this.gameState.artilleryShipLoadState;

        // Validate state
        if (mobileState.phase !== 'piloting' || mobileState.entityType !== 'ship2') {
            ui.showToast('Must be piloting ship2', 'warning');
            return;
        }

        if (this.mobileEntitySystem.velocity !== 0) {
            ui.showToast('Ship must be stopped', 'warning');
            return;
        }

        // Find the artillery at the specified slot
        const loadedArtillery = artilleryShipState.loadedArtillery || [];
        const artilleryData = loadedArtillery.find(a => a.slotIndex === slotIndex);
        if (!artilleryData) {
            ui.showToast('No artillery in that position', 'warning');
            return;
        }

        const artillery = artilleryData.artillery;
        const ship = mobileState.currentEntity;

        // Save the current ship position (we're switching positions, not leaving)
        mobileState.myShipPosition = slotIndex === 0 ? 'portGunner' : 'starboardGunner';

        // Set up manning state (similar to handleManArtillery but for ship-mounted)
        const manningState = this.gameState.artilleryManningState;
        manningState.isManning = true;
        manningState.mannedArtillery = artillery;
        manningState.artilleryId = artilleryData.artilleryId;
        manningState.artilleryChunkKey = artilleryData.artilleryChunkKey;
        manningState.artilleryOriginalChunkKey = artilleryData.artilleryChunkKey;
        manningState.artilleryHeading = artillery.rotation.y;
        manningState.lastFireTime = 0;
        manningState._terrainFrameCount = 0;
        manningState._lastBroadcastTime = 0;
        manningState.isShipMounted = true;  // Flag to indicate ship-mounted
        manningState.shipId = ship.userData.objectId;  // Store ship ID for P2P broadcasts

        // Mark artillery as occupied
        if (this.mobileEntitySystem) {
            this.mobileEntitySystem.setOccupied(manningState.artilleryId, this.gameState.clientId);
        }

        // Position player at artillery (world position)
        const artilleryWorldPos = new THREE.Vector3();
        artillery.getWorldPosition(artilleryWorldPos);

        // Position behind the cannon (offset based on ship rotation + slot rotation)
        const ARTILLERY_COMBAT = CONFIG.ARTILLERY_COMBAT;
        const offset = ARTILLERY_COMBAT?.MANNING_OFFSET || 0.4;

        // Get artillery world rotation
        const artilleryWorldQuat = new THREE.Quaternion();
        artillery.getWorldQuaternion(artilleryWorldQuat);
        const artilleryWorldEuler = new THREE.Euler().setFromQuaternion(artilleryWorldQuat);
        const worldHeading = artilleryWorldEuler.y;

        // Calculate breech position (behind the cannon)
        const barrelDir = ARTILLERY_COMBAT?.BARREL_DIRECTION || -1;
        const breechX = artilleryWorldPos.x - barrelDir * Math.sin(worldHeading) * offset;
        const breechZ = artilleryWorldPos.z - barrelDir * Math.cos(worldHeading) * offset;

        this.playerObject.position.set(breechX, artilleryWorldPos.y + 0.5, breechZ);
        this.playerObject.rotation.y = worldHeading;

        // Stop player movement
        this.playerController.stopMovement();
        this.gameState.isMoving = false;

        // Don't send claim_artillery to server - artillery is already claimed with the ship
        // But broadcast to peers that we're manning it
        this.networkManager.broadcastP2P({
            type: 'artillery_manned',
            payload: {
                artilleryId: manningState.artilleryId,
                heading: artillery.rotation.y,
                isShipMounted: true,
                shipId: ship.userData.objectId
            }
        });

        const positionName = slotIndex === 0 ? 'port' : 'starboard';
        ui.showToast(`Manning ${positionName} cannon - A/D to aim, F to fire`, 'info');
    }

    /**
     * Handle returning from ship cannon gunner to pilot position
     * Player stops manning artillery and returns to helm
     */
    handleReturnToHelm() {
        const manningState = this.gameState.artilleryManningState;
        const mobileState = this.gameState.mobileEntityState;

        if (!manningState.isManning || !manningState.mannedArtillery) {
            ui.showToast('Not manning a cannon', 'warning');
            return;
        }

        // Verify this is ship-mounted artillery
        const artillery = manningState.mannedArtillery;
        const ship = artillery.parent;
        if (ship?.userData?.modelType !== 'ship2') {
            ui.showToast('Not on a ship', 'warning');
            return;
        }

        const artilleryId = manningState.artilleryId;

        // Clear occupied status for the artillery
        if (this.mobileEntitySystem) {
            this.mobileEntitySystem.clearOccupied(artilleryId);
        }

        // Broadcast to peers that we're unmanning
        this.networkManager.broadcastP2P({
            type: 'artillery_unmanned',
            payload: {
                artilleryId: artilleryId,
                rotation: artillery.rotation.y,
                isShipMounted: true
            }
        });

        // Clear manning state
        manningState.isManning = false;
        manningState.mannedArtillery = null;
        manningState.artilleryId = null;
        manningState.artilleryChunkKey = null;
        manningState.artilleryOriginalChunkKey = null;
        manningState.artilleryHeading = 0;
        manningState.lastFireTime = 0;
        manningState._terrainFrameCount = 0;
        manningState._lastBroadcastTime = 0;
        manningState.isShipMounted = false;
        manningState.shipId = null;

        // Clear ship position tracking
        mobileState.myShipPosition = 'pilot';

        // Return player to pilot position on ship
        const config = this.mobileEntitySystem.getConfig('ship2');
        let targetY = ship.position.y + config.playerYOffset;
        let targetX = ship.position.x;
        let targetZ = ship.position.z;
        if (config.playerForwardOffset) {
            const heading = ship.rotation.y;
            targetX += Math.sin(heading) * config.playerForwardOffset;
            targetZ += Math.cos(heading) * config.playerForwardOffset;
        }

        this.playerObject.position.set(targetX, targetY, targetZ);
        this.playerObject.rotation.y = ship.rotation.y;

        ui.showToast('Returned to helm', 'info');
    }

    /**
     * External gunner takes control of the ship's helm
     * Only available when pilot has left/died and gunner is in 'crewing' phase
     */
    handleGunnerTakeHelm() {
        const manningState = this.gameState.artilleryManningState;
        const mobileState = this.gameState.mobileEntityState;

        // Verify we're an external gunner (crewing phase, not pilot-who-switched)
        if (!manningState.isManning || !manningState.isShipMounted) {
            ui.showToast('Not manning a ship cannon', 'warning');
            return;
        }
        if (mobileState.phase !== 'crewing') {
            ui.showToast('Use Return to Helm instead', 'warning');
            return;
        }

        const ship = mobileState.currentEntity;
        const shipId = ship?.userData?.objectId;
        if (!ship || !shipId) {
            ui.showToast('Ship not found', 'warning');
            return;
        }

        // Verify helm is unoccupied
        if (this.mobileEntitySystem.isOccupied(shipId)) {
            ui.showToast('Helm is occupied', 'warning');
            return;
        }

        // Clear artillery occupancy and broadcast
        const artilleryId = manningState.artilleryId;
        this.mobileEntitySystem.clearOccupied(artilleryId);
        this.networkManager.broadcastP2P({
            type: 'artillery_unmanned',
            payload: { artilleryId: artilleryId, isShipMounted: true }
        });

        // Reset artillery manning state
        this._clearArtilleryManningState();

        // Transition to piloting
        mobileState.phase = 'piloting';
        mobileState.myShipPosition = 'pilot';
        this.mobileEntitySystem.setOccupied(shipId, this.gameState.clientId);
        this.mobileEntitySystem.initMovement(ship);

        // Position at helm
        const config = this.mobileEntitySystem.getConfig('ship2');
        let targetY = ship.position.y + config.playerYOffset;
        let targetX = ship.position.x;
        let targetZ = ship.position.z;
        if (config.playerForwardOffset) {
            const heading = ship.rotation.y;
            targetX += Math.sin(heading) * config.playerForwardOffset;
            targetZ += Math.cos(heading) * config.playerForwardOffset;
        }
        this.playerObject.position.set(targetX, targetY, targetZ);
        this.playerObject.rotation.y = ship.rotation.y;

        // Broadcast that we've taken the helm
        this.networkManager.broadcastP2P({
            type: 'mobile_entity_boarded',
            payload: { entityId: shipId, entityType: 'ship2' }
        });

        ui.showToast('Took the helm', 'info');
    }

    /**
     * Switch to the other cannon position on the ship
     * Works for both external gunners and pilot-who-switched
     */
    handleGunnerSwitchCannon() {
        const manningState = this.gameState.artilleryManningState;
        const mobileState = this.gameState.mobileEntityState;

        if (!manningState.isManning || !manningState.isShipMounted) {
            ui.showToast('Not manning a ship cannon', 'warning');
            return;
        }

        const ship = mobileState.currentEntity;
        if (!ship) {
            ui.showToast('Ship not found', 'warning');
            return;
        }

        // Find the other cannon from artilleryShipLoadState
        const artilleryShipState = this.gameState.artilleryShipLoadState;
        const loadedArtillery = artilleryShipState?.loadedArtillery || [];

        const otherCannon = loadedArtillery.find(a =>
            a.artilleryId !== manningState.artilleryId &&
            !this.mobileEntitySystem.isOccupied(a.artilleryId)
        );

        if (!otherCannon) {
            ui.showToast('Other cannon is occupied', 'warning');
            return;
        }

        // Clear current cannon
        const oldArtilleryId = manningState.artilleryId;
        this.mobileEntitySystem.clearOccupied(oldArtilleryId);
        this.networkManager.broadcastP2P({
            type: 'artillery_unmanned',
            payload: { artilleryId: oldArtilleryId, isShipMounted: true }
        });

        // Set up new cannon
        const newArtillery = otherCannon.artillery;
        manningState.mannedArtillery = newArtillery;
        manningState.artilleryId = otherCannon.artilleryId;
        manningState.artilleryHeading = newArtillery.rotation.y;

        this.mobileEntitySystem.setOccupied(otherCannon.artilleryId, this.gameState.clientId);

        // Update ship position tracking
        mobileState.myShipPosition = otherCannon.slotIndex === 0 ? 'portGunner' : 'starboardGunner';

        // Position at new cannon
        const artilleryWorldPos = new THREE.Vector3();
        newArtillery.getWorldPosition(artilleryWorldPos);
        const ARTILLERY_COMBAT = CONFIG.ARTILLERY_COMBAT;
        const offset = ARTILLERY_COMBAT?.MANNING_OFFSET || 0.4;
        const barrelDir = ARTILLERY_COMBAT?.BARREL_DIRECTION || -1;
        const artilleryWorldQuat = new THREE.Quaternion();
        newArtillery.getWorldQuaternion(artilleryWorldQuat);
        const artilleryWorldEuler = new THREE.Euler().setFromQuaternion(artilleryWorldQuat);
        const worldHeading = artilleryWorldEuler.y;
        const breechX = artilleryWorldPos.x - barrelDir * Math.sin(worldHeading) * offset;
        const breechZ = artilleryWorldPos.z - barrelDir * Math.cos(worldHeading) * offset;
        this.playerObject.position.set(breechX, artilleryWorldPos.y + 0.5, breechZ);
        this.playerObject.rotation.y = worldHeading;

        // Broadcast
        this.networkManager.broadcastP2P({
            type: 'artillery_manned',
            payload: { artilleryId: otherCannon.artilleryId, isShipMounted: true, shipId: ship.userData.objectId }
        });

        const posName = otherCannon.slotIndex === 0 ? 'port' : 'starboard';
        ui.showToast(`Switched to ${posName} cannon`, 'info');
    }

    /**
     * Clear ship gunner state when ship is destroyed
     * Called before player death to clean up artillery manning state
     * @param {string} shipEntityId - The ID of the sinking ship
     */
    clearShipGunnerStateOnSink(shipEntityId) {
        const manningState = this.gameState.artilleryManningState;

        // Check if we're manning ship-mounted artillery
        if (!manningState.isManning || !manningState.isShipMounted) {
            return;
        }

        const artillery = manningState.mannedArtillery;
        if (!artillery?.parent) return;

        // Verify this artillery is on the sinking ship
        const parentShip = artillery.parent;
        if (parentShip.userData?.objectId !== shipEntityId) return;

        const artilleryId = manningState.artilleryId;

        // Clear occupied status for the artillery
        if (this.mobileEntitySystem) {
            this.mobileEntitySystem.clearOccupied(artilleryId);
        }

        // Broadcast to peers that we're unmanning (due to ship destruction)
        this.networkManager.broadcastP2P({
            type: 'artillery_unmanned',
            payload: {
                artilleryId: artilleryId,
                rotation: artillery.rotation.y,
                isShipMounted: true,
                shipDestroyed: true
            }
        });

        // Clear manning state
        manningState.isManning = false;
        manningState.mannedArtillery = null;
        manningState.artilleryId = null;
        manningState.artilleryChunkKey = null;
        manningState.artilleryOriginalChunkKey = null;
        manningState.artilleryHeading = 0;
        manningState.lastFireTime = 0;
        manningState._terrainFrameCount = 0;
        manningState._lastBroadcastTime = 0;
        manningState.isShipMounted = false;
        manningState.shipId = null;

        // Clear ship artillery load state (artillery goes down with ship)
        const artilleryShipState = this.gameState.artilleryShipLoadState;
        artilleryShipState.loadedArtillery = [];

        console.log(`[Ship] Cleared gunner state - ship ${shipEntityId} destroyed`);
    }

    /**
     * Handle unload crate button press while piloting a boat
     * LIFO unloading: removes the last loaded crate from the array
     */
    async handleUnloadCrateFromSailboat() {
        const mobileState = this.gameState.mobileEntityState;
        const crateState = this.gameState.crateLoadState;

        // Check array-based state first, fall back to legacy
        const hasLoadedCrates = crateState.loadedCrates?.length > 0;
        if (!hasLoadedCrates && !crateState.isLoaded) {
            ui.showToast('No crate to unload', 'warning');
            return;
        }

        if (mobileState.phase !== 'piloting') {
            ui.showToast('Must be piloting a boat', 'warning');
            return;
        }

        if (this.mobileEntitySystem.velocity !== 0) {
            ui.showToast('Boat must be stopped', 'warning');
            return;
        }

        // LIFO: Get the last loaded crate
        const lastSlot = hasLoadedCrates
            ? crateState.loadedCrates[crateState.loadedCrates.length - 1]
            : null;
        const crate = lastSlot?.crate || crateState.loadedCrate;
        const crateId = lastSlot?.crateId || crateState.crateId;
        const crateChunkKeyForRelease = lastSlot?.crateChunkKey || crateState.crateChunkKey;
        const crateQualityForRelease = lastSlot?.crateQuality || crateState.crateQuality;
        const crateLastRepairTimeForRelease = lastSlot?.crateLastRepairTime || crateState.crateLastRepairTime;
        const crateInventoryForRelease = lastSlot?.crateInventory || crateState.crateInventory;

        const boat = mobileState.currentEntity;

        // Find valid landing position using land search algorithm
        const landingPos = this.mobileEntitySystem.findCrateLandingPosition(
            boat.position,
            boat.rotation.y
        );

        if (!landingPos) {
            ui.showToast('No land nearby to unload crate', 'warning');
            return;
        }

        const dropX = landingPos.x;
        const dropY = landingPos.y;
        const dropZ = landingPos.z;
        const worldRotation = boat.rotation.y;

        // Calculate new chunk (center-based)
        const { chunkX: newChunkX, chunkZ: newChunkZ } = ChunkCoordinates.worldToChunk(dropX, dropZ);
        const newChunkKey = `${newChunkX},${newChunkZ}`;

        // Create a promise to wait for server response
        const releasePromise = new Promise((resolve, reject) => {
            this.pendingCrateRelease = { entityId: crateId, resolve, reject };

            // Timeout after configured duration
            setTimeout(() => {
                if (this.pendingCrateRelease && this.pendingCrateRelease.entityId === crateId) {
                    this.pendingCrateRelease = null;
                    reject(new Error('Server response timeout'));
                }
            }, CONFIG.CRATE_VEHICLES.CLAIM_TIMEOUT);
        });

        // Send release message to server FIRST (before local changes)
        this.networkManager.sendMessage('release_crate', {
            entityId: crateId,
            chunkKey: crateChunkKeyForRelease,
            clientId: this.gameState.clientId,
            position: [dropX, dropY, dropZ],
            rotation: worldRotation,
            quality: crateQualityForRelease,
            lastRepairTime: crateLastRepairTimeForRelease,
            inventory: crateInventoryForRelease
        });

        try {
            // Wait for server confirmation
            await releasePromise;

            // Server confirmed - now apply local changes
            // Unparent from boat
            boat.remove(crate);
            this.scene.add(crate);

            // Set world position
            crate.position.set(dropX, dropY, dropZ);
            crate.rotation.y = worldRotation;

            // Update chunk key for new position
            crate.userData.chunkKey = newChunkKey;

            // Re-add physics collider
            if (this.physicsManager) {
                const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS?.crate || { width: 1, depth: 1 };
                this.physicsManager.createStaticCollider(
                    crateId,
                    { type: 'cuboid', width: dims.width || 1, height: 1.5, depth: dims.depth || 1 },
                    crate.position,
                    worldRotation
                );
            }

            // Re-add to objectRegistry for proximity detection
            if (this.objectRegistry) {
                this.objectRegistry.set(crateId, crate);
            }

            // Add to chunkObjects for chunk management
            if (this.chunkManager && this.chunkManager.chunkObjects) {
                let chunkObjects = this.chunkManager.chunkObjects.get(newChunkKey);
                if (!chunkObjects) {
                    chunkObjects = [];
                    this.chunkManager.chunkObjects.set(newChunkKey, chunkObjects);
                }
                if (!chunkObjects.includes(crate)) {
                    chunkObjects.push(crate);
                }
            }

            // Re-register with LOD systems now that crate has world position again
            if (this.structureModelSystem) {
                this.structureModelSystem.registerStructure(crate, 'crate', newChunkKey);
            }
            if (this.billboardSystem) {
                this.billboardSystem.addTreeBillboard(crate, 'crate', crate.position);
            }

            // Clear occupied status only AFTER server confirms
            if (this.mobileEntitySystem) {
                this.mobileEntitySystem.clearOccupied(crateId);
            }

            // Broadcast to peers
            this.networkManager.broadcastP2P({
                type: 'crate_unloaded',
                payload: {
                    crateId: crateId,
                    position: [dropX, dropY, dropZ],
                    rotation: worldRotation,
                    inventory: crateInventoryForRelease
                }
            });

            // Remove from loadedCrates array (LIFO pop)
            if (crateState.loadedCrates?.length > 0) {
                crateState.loadedCrates.pop();
            }

            // Update legacy state based on remaining crates
            const remaining = crateState.loadedCrates?.length || 0;
            if (remaining > 0) {
                // Update legacy state to point to the new last crate
                const newLast = crateState.loadedCrates[remaining - 1];
                crateState.isLoaded = true;
                crateState.loadedCrate = newLast.crate;
                crateState.crateId = newLast.crateId;
                crateState.crateChunkKey = newLast.crateChunkKey;
                crateState.crateQuality = newLast.crateQuality;
                crateState.crateLastRepairTime = newLast.crateLastRepairTime;
                crateState.crateInventory = newLast.crateInventory;
            } else {
                // No crates left - clear legacy state
                crateState.isLoaded = false;
                crateState.loadedCrate = null;
                crateState.crateId = null;
                crateState.crateChunkKey = null;
                crateState.crateQuality = null;
                crateState.crateLastRepairTime = null;
                crateState.crateInventory = null;
            }

            if (remaining > 0) {
                ui.showToast(`Crate unloaded (${remaining} remaining)`, 'info');
            } else {
                ui.showToast('Crate unloaded to shore', 'info');
            }

        } catch (error) {
            // Server rejected or timeout - crate stays on boat
            console.warn('[Crate] Boat unload failed:', error.message);
            ui.showToast(error.message || 'Failed to unload crate', 'warning');
        }
    }

    /**
     * Start boarding a mobile entity (boat/cart/horse)
     * @param {object} mobileEntity - { type, object }
     */
    startBoarding(mobileEntity) {
        const state = this.gameState.mobileEntityState;
        const entity = mobileEntity.object;
        const entityId = entity.userData.objectId;
        const config = this.mobileEntitySystem.getConfig(mobileEntity.type);

        // Release cart if towing one before boarding a mobile entity
        if (this.gameState.cartAttachmentState.isAttached) {
            this.handleReleaseCart();
        }

        // Stop any pending player movement to prevent Y position conflicts
        // (PlayerController.updateMovement lerps Y to terrain, which fights with mobile entity Y)
        if (this.playerController) {
            this.playerController.isMoving = false;
            this.playerController.isWASDMoving = false;
        }

        // Mark as occupied locally first
        this.mobileEntitySystem.setOccupied(entityId, this.gameState.clientId);

        // Preserve entity data for release
        state.entityQuality = entity.userData.quality;
        state.entityLastRepairTime = entity.userData.lastRepairTime;
        state.entityOwner = entity.userData.owner;  // Preserve owner for chunk transfer

        // For horses, correct entity Y to terrain height before boarding
        // (server data may have incorrect Y, causing player to lerp underground)
        if (mobileEntity.type === 'horse' && this.terrainGenerator) {
            const terrainY = this.terrainGenerator.getWorldHeight(entity.position.x, entity.position.z);
            entity.position.y = terrainY;
        }

        // Set state
        state.isActive = true;
        state.currentEntity = entity;
        state.entityId = entityId;
        state.entityType = mobileEntity.type;
        state.phase = 'boarding';
        state.boardingStartTime = performance.now();
        state.originalPosition = this.playerObject.position.clone();
        state.targetPosition = entity.position.clone();
        state.targetPosition.y += config.playerYOffset;

        // Initialize movement state
        this.mobileEntitySystem.initMovement(entity);

        // Send claim message to server (removes static entity from chunk)
        this.networkManager.sendMessage('claim_mobile_entity', {
            entityId: entityId,
            entityType: mobileEntity.type,
            chunkKey: entity.userData.chunkKey,
            clientId: this.gameState.clientId
        });

        // Broadcast to peers
        this.networkManager.broadcastP2P({
            type: 'mobile_entity_enter',
            payload: {
                entityId: entityId,
                entityType: mobileEntity.type,
                position: entity.position.toArray(),
                rotation: entity.rotation.y
            }
        });

        // Entity-specific setup
        const waterVehicleTypes = ['boat', 'sailboat', 'ship2'];
        if (waterVehicleTypes.includes(mobileEntity.type)) {
            // Unregister the water vehicle from AnimationSystem (player controls it now)
            if (this.animationSystem) {
                this.animationSystem.unregister(entityId);
            }

            // Remove the vehicle's static collider BEFORE creating character controller
            // (prevents character controller from colliding with vehicle's own collider)
            if (this.physicsManager) {
                // Debug: Check if collider exists before removal
                const hadCollider = this.physicsManager.colliderHandles?.has(entityId);
                console.log(`[Boat Board] Removing static collider for ${entityId}, existed: ${hadCollider}`);

                this.physicsManager.removeCollider(entityId);
                // Clear physicsHandle to prevent chunk update code from thinking collider exists
                // and to avoid any stale reference issues
                entity.userData.physicsHandle = null;
                // Re-add to registry (removeCollider triggers callback that deletes it)
                if (this.objectRegistry) {
                    this.objectRegistry.set(entityId, entity);
                }

                // Debug: Verify collider was removed
                const stillHasCollider = this.physicsManager.colliderHandles?.has(entityId);
                console.log(`[Boat Board] After removal, collider exists: ${stillHasCollider}`);
            }

            // Disable player's character controller while piloting
            // (player is part of vehicle now - no independent collision needed)
            if (this.physicsManager) {
                this.physicsManager.removeCharacterController('player');
            }

            // Create character controller for vehicle collision detection (cuboid shape with rotation)
            if (this.physicsManager) {
                const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[mobileEntity.type];
                const COLLIDER_SHRINK = 0.3; // Smaller than query shape for early collision detection
                const shape = {
                    type: 'cuboid',
                    width: dims.width - COLLIDER_SHRINK,
                    depth: dims.depth - COLLIDER_SHRINK,
                    height: dims.height || 1.5
                };
                const initialRotation = entity.rotation.y;
                console.log(`[Boat Board] Creating boat character controller for ${entityId} with cuboid ${shape.width}x${shape.depth}x${shape.height}, rotation ${(initialRotation * 180 / Math.PI).toFixed(1)}°`);
                this.physicsManager.createBoatCharacterController(
                    entityId,
                    shape,
                    entity.position,
                    initialRotation
                );
                // Debug: Verify character controller was created
                const hasController = this.physicsManager.characterControllers?.has(entityId);
                const hasColliderNow = this.physicsManager.colliderHandles?.has(entityId);
                console.log(`[Boat Board] After creation - controller exists: ${hasController}, collider exists: ${hasColliderNow}`);
            }
        } else if (mobileEntity.type === 'horse') {
            // Setup horse animations
            this.setupHorseAnimations(entity, state);

            // Remove the horse's static collider BEFORE creating character controller
            // (prevents character controller from colliding with horse's own collider)
            if (this.physicsManager) {
                this.physicsManager.removeCollider(entityId);
                // Clear physicsHandle to prevent chunk update code from thinking collider exists
                // and to avoid any stale reference issues
                entity.userData.physicsHandle = null;
                // Re-add to registry (removeCollider triggers callback that deletes it)
                if (this.objectRegistry) {
                    this.objectRegistry.set(entityId, entity);
                }
            }

            // Disable player's character controller while mounted
            // (player is part of horse now - no independent collision needed)
            if (this.physicsManager) {
                this.physicsManager.removeCharacterController('player');
            }

            // Create character controller for horse collision detection
            if (this.physicsManager) {
                this.physicsManager.createCharacterController(
                    entityId,
                    0.15,               // radius
                    2.0,                // height
                    entity.position
                );
            }
        }

        const statusMsg = mobileEntity.type === 'horse' ? 'Mounting...' : 'Boarding...';
        ui.updateStatus(statusMsg);
    }

    /**
     * Setup horse animations (walk animation on horse, riding animation on player)
     * @param {THREE.Object3D} horseEntity - The horse mesh
     * @param {object} state - mobileEntityState
     */
    setupHorseAnimations(horseEntity, state) {
        const config = this.mobileEntitySystem.getConfig('horse');

        // --- Horse walk animation ---
        // Try to get animations from the horse mesh
        let horseAnimations = horseEntity.userData.animations ||
                              horseEntity.animations ||
                              [];

        // If no animations on mesh, try the original GLTF
        if (horseAnimations.length === 0) {
            const originalGLTF = modelManager.getGLTF('horse');
            if (originalGLTF?.animations) {
                horseAnimations = originalGLTF.animations;
                horseEntity.animations = horseAnimations;
            }
        }

        if (horseAnimations.length > 0) {
            // Create mixer
            state.entityMixer = new THREE.AnimationMixer(horseEntity);

            // Find walk animation
            let walkClip = THREE.AnimationClip.findByName(horseAnimations, config.animationName);

            // Try fallbacks if not found
            if (!walkClip && config.animationFallbackPatterns) {
                for (const pattern of config.animationFallbackPatterns) {
                    walkClip = horseAnimations.find(clip =>
                        clip.name.toLowerCase().includes(pattern.toLowerCase())
                    );
                    if (walkClip) break;
                }
            }

            if (walkClip) {
                state.entityWalkAction = state.entityMixer.clipAction(walkClip);
                state.entityWalkAction.setLoop(THREE.LoopRepeat);
                // Don't play yet - will start when moving
            } else {
                console.warn('[Horse] No walk animation found in horse model');
            }
        } else {
            console.warn('[Horse] No animations found in horse model');
        }

        // --- Player riding animation ---
        // Note: ridingAction should be set up during player model load if it exists
        // For now, we just stop the walk animation if any
        if (this.animationAction) {
            this.animationAction.stop();
        }
    }

    /**
     * Start disembarking from current mobile entity
     */
    startDisembark() {
        const state = this.gameState.mobileEntityState;
        // Allow disembark for both 'piloting' (helm) and 'crewing' (gunner) phases
        if (!state.isActive || (state.phase !== 'piloting' && state.phase !== 'crewing')) return;

        const disembarkPos = this.mobileEntitySystem.disembarkPosition;
        if (!disembarkPos) return;

        const entity = state.currentEntity;
        const config = this.mobileEntitySystem.getConfig(state.entityType);
        const wasCrewing = state.phase === 'crewing';  // Track if we were crewing for completeDisembark

        state.phase = 'disembarking';
        state.disembarkStartTime = performance.now();
        state.targetPosition = new THREE.Vector3(disembarkPos.x, disembarkPos.y, disembarkPos.z);
        state.wasCrewingBeforeDisembark = wasCrewing;  // Store for completeDisembark to use

        // Store the rider's start position ONCE to prevent lerp oscillation
        // For crewing (gunner), use player's current position; for piloting, calculate from entity
        if (wasCrewing) {
            // External gunner - use player's current position at the cannon
            state.originalPosition = this.playerObject.position.clone();
        } else {
            // Pilot - calculate position from entity (existing logic)
            const riderStartPos = entity.position.clone();
            riderStartPos.y += config.playerYOffset;
            if (config.playerForwardOffset) {
                const heading = entity.rotation.y;
                riderStartPos.x += Math.sin(heading) * config.playerForwardOffset;
                riderStartPos.z += Math.cos(heading) * config.playerForwardOffset;
            }
            state.originalPosition = riderStartPos;
        }

        // Stop horse animation before dismounting
        if (state.entityType === 'horse') {
            if (state.entityWalkAction) {
                state.entityWalkAction.stop();
            }
        }

        const statusMsg = state.entityType === 'horse' ? 'Dismounting...' : 'Disembarking...';
        ui.updateStatus(statusMsg);
    }

    /**
     * Complete disembark process - called after disembark transition
     */
    completeDisembark() {
        const state = this.gameState.mobileEntityState;
        const entity = state.currentEntity;
        const entityId = state.entityId;
        const entityType = state.entityType;

        // === EXTERNAL GUNNER DISEMBARK PATH ===
        // Gunner disembarking from ship - don't release the ship itself (pilot may still be there)
        if (state.wasCrewingBeforeDisembark) {
            const manningState = this.gameState.artilleryManningState;

            // Clear artillery occupancy
            if (manningState.artilleryId) {
                this.mobileEntitySystem.clearOccupied(manningState.artilleryId);
                this.networkManager.broadcastP2P({
                    type: 'artillery_unmanned',
                    payload: { artilleryId: manningState.artilleryId, isShipMounted: true }
                });
            }

            // Reset artillery manning state
            this._clearArtilleryManningState();

            // Ensure player Y is at correct height
            if (this.terrainGenerator) {
                const GROUND_OFFSET = 0.03;
                const terrainY = this.terrainGenerator.getWorldHeight(
                    this.playerObject.position.x,
                    this.playerObject.position.z
                );
                const safeY = Math.max(terrainY, 0) + GROUND_OFFSET;
                this.playerObject.position.y = safeY;
                if (this.playerController) {
                    this.playerController.targetY = safeY;
                }
            }

            // Reset mobileEntityState
            state.isActive = false;
            state.currentEntity = null;
            state.entityId = null;
            state.entityType = null;
            state.phase = null;
            state.boardingStartTime = null;
            state.disembarkStartTime = null;
            state.originalPosition = null;
            state.targetPosition = null;
            state.myShipPosition = null;
            state.wasCrewingBeforeDisembark = null;

            this.checkProximityToObjects();
            ui.updateStatus('Disembarked');
            return; // Don't continue to normal dismount logic
        }

        // Check if this is a horse sale
        const isHorseSale = state.pendingHorseSale && entityType === 'horse';

        if (isHorseSale) {
            // === HORSE SALE PATH ===
            const saleData = state.pendingHorseSaleData;

            // Send sell_horse to server (adds to market inventory)
            this.networkManager.sendMessage('sell_horse', {
                marketId: saleData.marketId,
                chunkId: saleData.chunkId,
                entityId: entityId,
                quality: saleData.quality,
                transactionId: `sell_horse_${Date.now()}`
            });

            // Broadcast to peers that horse was sold (not released)
            this.networkManager.broadcastP2P({
                type: 'mobile_entity_sold',
                payload: {
                    entityId: entityId,
                    entityType: entityType,
                    playerPosition: this.playerObject.position.toArray()
                }
            });

            ui.showToast(`Horse sold for ${saleData.price} coins!`, 'success');

        } else {
            // === NORMAL DISMOUNT PATH ===
            this.networkManager.sendMessage('release_mobile_entity', {
                entityId: entityId,
                entityType: entityType,
                chunkKey: entity.userData.chunkKey,
                clientId: this.gameState.clientId,
                position: entity.position.toArray(),
                rotation: entity.rotation.y, // Radians
                quality: state.entityQuality,
                lastRepairTime: state.entityLastRepairTime,
                owner: state.entityOwner  // Preserve owner across chunk transfers
            });

            this.networkManager.broadcastP2P({
                type: 'mobile_entity_exit',
                payload: {
                    entityId: entityId,
                    entityType: entityType,
                    position: entity.position.toArray(),
                    rotation: entity.rotation.y, // Radians
                    playerPosition: this.playerObject.position.toArray()
                }
            });
        }

        // === SHARED CLEANUP (both paths) ===

        // Ensure player Y is at correct height (terrain now includes docks)
        if (this.terrainGenerator) {
            const GROUND_OFFSET = 0.03;
            const terrainY = this.terrainGenerator.getWorldHeight(
                this.playerObject.position.x,
                this.playerObject.position.z
            );
            // Safety: don't place player underwater
            const safeY = Math.max(terrainY, 0) + GROUND_OFFSET;
            this.playerObject.position.y = safeY;
            if (this.playerController) {
                this.playerController.targetY = safeY;
            }
        }

        // Entity-specific cleanup
        const waterVehicleTypesCleanup = ['boat', 'sailboat', 'ship2'];
        if (waterVehicleTypesCleanup.includes(entityType)) {
            // Ship2 bulk auto-unload: handles multiple crates, horses, and artillery
            if (entityType === 'ship2') {
                const crateState = this.gameState.crateLoadState;
                const horseState = this.gameState.horseShipLoadState;
                const artilleryState = this.gameState.artilleryShipLoadState;

                // Count total items that need unloading
                const cratesToUnload = crateState.loadedCrates?.length || 0;
                const horsesToUnload = horseState.loadedHorses?.length || 0;
                const artilleryToUnload = artilleryState.loadedArtillery?.length || 0;
                const totalItems = cratesToUnload + horsesToUnload + artilleryToUnload;

                if (totalItems > 0) {
                    console.log(`[Disembark] Ship2 auto-unload: ${cratesToUnload} crates, ${horsesToUnload} horses, ${artilleryToUnload} artillery`);

                    // Find landing positions for all items
                    const landingPositions = this.mobileEntitySystem?.findMultipleLandingPositions(
                        entity.position,
                        entity.rotation.y,
                        totalItems,
                        2.0  // 2 unit minimum spacing
                    ) || [];

                    if (landingPositions.length < totalItems) {
                        console.warn(`[Disembark] Only found ${landingPositions.length}/${totalItems} landing positions`);
                        ui.showToast(`Cannot disembark - need ${totalItems} landing spots, only found ${landingPositions.length}`, 'warning');
                        return; // Abort disembark
                    }

                    let posIndex = 0;

                    // Auto-unload crates (ship2 multi-crate)
                    while (crateState.loadedCrates?.length > 0) {
                        const crateData = crateState.loadedCrates.pop();
                        const crate = crateData.crate;
                        const crateId = crateData.crateId;
                        const landingPos = landingPositions[posIndex++];

                        // Unparent and place in world
                        entity.remove(crate);
                        this.scene.add(crate);
                        crate.position.set(landingPos.x, landingPos.y, landingPos.z);
                        crate.rotation.y = entity.rotation.y;

                        // Update chunk tracking
                        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(landingPos.x, landingPos.z);
                        const newChunkKey = `${chunkX},${chunkZ}`;
                        crate.userData.chunkKey = newChunkKey;

                        // Re-add physics collider
                        if (this.physicsManager) {
                            const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS?.crate || { width: 1, depth: 1 };
                            this.physicsManager.createStaticCollider(
                                crateId,
                                { type: 'cuboid', width: dims.width || 1, height: 1.5, depth: dims.depth || 1 },
                                crate.position,
                                entity.rotation.y
                            );
                        }

                        // Re-register with systems
                        if (this.objectRegistry) this.objectRegistry.set(crateId, crate);
                        if (this.chunkManager?.chunkObjects) {
                            let chunkObjects = this.chunkManager.chunkObjects.get(newChunkKey);
                            if (!chunkObjects) {
                                chunkObjects = [];
                                this.chunkManager.chunkObjects.set(newChunkKey, chunkObjects);
                            }
                            if (!chunkObjects.includes(crate)) chunkObjects.push(crate);
                        }
                        if (this.structureModelSystem) this.structureModelSystem.registerStructure(crate, 'crate', newChunkKey);

                        // Clear occupied and notify server/peers
                        if (this.mobileEntitySystem) this.mobileEntitySystem.clearOccupied(crateId);
                        this.networkManager.sendMessage('release_crate', {
                            entityId: crateId,
                            chunkKey: crateData.crateChunkKey,
                            clientId: this.gameState.clientId,
                            position: [landingPos.x, landingPos.y, landingPos.z],
                            rotation: entity.rotation.y,
                            quality: crateData.crateQuality,
                            lastRepairTime: crateData.crateLastRepairTime,
                            inventory: crateData.crateInventory
                        });
                        this.networkManager.broadcastP2P({
                            type: 'crate_unloaded',
                            payload: { crateId, position: [landingPos.x, landingPos.y, landingPos.z], rotation: entity.rotation.y, inventory: crateData.crateInventory }
                        });
                    }

                    // Auto-unload horses (ship2)
                    while (horseState.loadedHorses?.length > 0) {
                        const horseData = horseState.loadedHorses.pop();
                        const horse = horseData.horse;
                        const horseId = horseData.horseId;
                        const landingPos = landingPositions[posIndex++];

                        // Unparent and place in world
                        entity.remove(horse);
                        this.scene.add(horse);
                        horse.position.set(landingPos.x, landingPos.y, landingPos.z);
                        horse.rotation.y = entity.rotation.y;

                        // Update chunk tracking
                        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(landingPos.x, landingPos.z);
                        const newChunkKey = `${chunkX},${chunkZ}`;
                        horse.userData.chunkKey = newChunkKey;

                        // Re-add physics collider
                        if (this.physicsManager) {
                            const dims = CONFIG.CONSTRUCTION_GRID_DIMENSIONS?.horse || { radius: 0.15, height: 2.0 };
                            this.physicsManager.createStaticCollider(horseId, dims, horse.position);
                        }

                        // Re-register with systems
                        if (this.objectRegistry) this.objectRegistry.set(horseId, horse);
                        if (this.chunkManager?.chunkObjects) {
                            let chunkObjects = this.chunkManager.chunkObjects.get(newChunkKey);
                            if (!chunkObjects) {
                                chunkObjects = [];
                                this.chunkManager.chunkObjects.set(newChunkKey, chunkObjects);
                            }
                            if (!chunkObjects.includes(horse)) chunkObjects.push(horse);
                        }
                        if (this.structureModelSystem) this.structureModelSystem.registerStructure(horse, 'horse', newChunkKey);

                        // Clear occupied and notify server/peers
                        if (this.mobileEntitySystem) this.mobileEntitySystem.clearOccupied(horseId);
                        this.networkManager.sendMessage('release_ship_horse', {
                            entityId: horseId,
                            chunkKey: horseData.horseChunkKey,
                            clientId: this.gameState.clientId,
                            position: [landingPos.x, landingPos.y, landingPos.z],
                            rotation: entity.rotation.y,
                            quality: horseData.horseQuality,
                            lastRepairTime: horseData.horseLastRepairTime
                        });
                        this.networkManager.broadcastP2P({
                            type: 'horse_unloaded_ship',
                            payload: { horseId, position: [landingPos.x, landingPos.y, landingPos.z], rotation: entity.rotation.y }
                        });
                    }

                    // Auto-unload artillery (ship2)
                    while (artilleryState.loadedArtillery?.length > 0) {
                        const artilleryData = artilleryState.loadedArtillery.pop();
                        const artillery = artilleryData.artillery;
                        const artilleryId = artilleryData.artilleryId;
                        const landingPos = landingPositions[posIndex++];

                        // Unparent and place in world
                        entity.remove(artillery);
                        this.scene.add(artillery);
                        artillery.position.set(landingPos.x, landingPos.y, landingPos.z);
                        artillery.rotation.y = entity.rotation.y;

                        // Update chunk tracking
                        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(landingPos.x, landingPos.z);
                        const newChunkKey = `${chunkX},${chunkZ}`;
                        artillery.userData.chunkKey = newChunkKey;

                        // Re-add physics collider
                        if (this.physicsManager) {
                            const dims = CONFIG.CONSTRUCTION_GRID_DIMENSIONS?.artillery || { radius: 0.4, height: 2.0 };
                            this.physicsManager.createStaticCollider(artilleryId, dims, artillery.position);
                        }

                        // Re-register with systems
                        if (this.objectRegistry) this.objectRegistry.set(artilleryId, artillery);
                        if (this.chunkManager?.chunkObjects) {
                            let chunkObjects = this.chunkManager.chunkObjects.get(newChunkKey);
                            if (!chunkObjects) {
                                chunkObjects = [];
                                this.chunkManager.chunkObjects.set(newChunkKey, chunkObjects);
                            }
                            if (!chunkObjects.includes(artillery)) chunkObjects.push(artillery);
                        }
                        if (this.structureModelSystem) this.structureModelSystem.registerStructure(artillery, 'artillery', newChunkKey);

                        // Clear occupied and notify server/peers
                        if (this.mobileEntitySystem) this.mobileEntitySystem.clearOccupied(artilleryId);
                        this.networkManager.sendMessage('release_ship_artillery', {
                            entityId: artilleryId,
                            chunkKey: artilleryData.artilleryChunkKey,
                            clientId: this.gameState.clientId,
                            position: [landingPos.x, landingPos.y, landingPos.z],
                            rotation: entity.rotation.y,
                            quality: artilleryData.artilleryQuality,
                            lastRepairTime: artilleryData.artilleryLastRepairTime,
                            inventory: artilleryData.artilleryInventory
                        });
                        this.networkManager.broadcastP2P({
                            type: 'artillery_unloaded_ship',
                            payload: { artilleryId, position: [landingPos.x, landingPos.y, landingPos.z], rotation: entity.rotation.y, inventory: artilleryData.artilleryInventory }
                        });
                    }

                    ui.showToast(`Auto-unloaded ${totalItems} item${totalItems !== 1 ? 's' : ''} to shore`, 'info');
                }
            }

            // If boat has a loaded crate, auto-unload it to shore before releasing boat (sailboat single-crate)
            const crateState = this.gameState.crateLoadState;
            if (crateState.isLoaded && crateState.loadedCrate) {
                console.log('[Disembark] Auto-unloading crate from boat before disembark');

                // Find landing position using same algorithm as manual unload
                const landingPos = this.mobileEntitySystem?.findCrateLandingPosition(
                    entity.position,
                    entity.rotation.y
                );

                if (landingPos) {
                    // Unparent crate from boat
                    const crate = crateState.loadedCrate;
                    const crateId = crateState.crateId;
                    entity.remove(crate);
                    this.scene.add(crate);

                    // Set world position
                    crate.position.set(landingPos.x, landingPos.y, landingPos.z);
                    crate.rotation.y = entity.rotation.y;

                    // Calculate new chunk
                    const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(landingPos.x, landingPos.z);
                    const newChunkKey = `${chunkX},${chunkZ}`;
                    crate.userData.chunkKey = newChunkKey;

                    // Re-add physics collider
                    if (this.physicsManager) {
                        const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS?.crate || { width: 1, depth: 1 };
                        this.physicsManager.createStaticCollider(
                            crateId,
                            { type: 'cuboid', width: dims.width || 1, height: 1.5, depth: dims.depth || 1 },
                            crate.position,
                            entity.rotation.y
                        );
                    }

                    // Re-add to objectRegistry
                    if (this.objectRegistry) {
                        this.objectRegistry.set(crateId, crate);
                    }

                    // Add to chunkObjects
                    if (this.chunkManager?.chunkObjects) {
                        let chunkObjects = this.chunkManager.chunkObjects.get(newChunkKey);
                        if (!chunkObjects) {
                            chunkObjects = [];
                            this.chunkManager.chunkObjects.set(newChunkKey, chunkObjects);
                        }
                        if (!chunkObjects.includes(crate)) {
                            chunkObjects.push(crate);
                        }
                    }

                    // Re-register with LOD systems
                    if (this.structureModelSystem) {
                        this.structureModelSystem.registerStructure(crate, 'crate', newChunkKey);
                    }
                    if (this.billboardSystem) {
                        this.billboardSystem.addTreeBillboard(crate, 'crate', crate.position);
                    }

                    // Clear occupied status
                    if (this.mobileEntitySystem) {
                        this.mobileEntitySystem.clearOccupied(crateId);
                    }

                    // Send release to server
                    this.networkManager.sendMessage('release_crate', {
                        entityId: crateId,
                        chunkKey: crateState.crateChunkKey,
                        clientId: this.gameState.clientId,
                        position: [landingPos.x, landingPos.y, landingPos.z],
                        rotation: entity.rotation.y,
                        quality: crateState.crateQuality,
                        lastRepairTime: crateState.crateLastRepairTime,
                        inventory: crateState.crateInventory
                    });

                    // Broadcast to peers
                    this.networkManager.broadcastP2P({
                        type: 'crate_unloaded',
                        payload: {
                            crateId: crateId,
                            position: [landingPos.x, landingPos.y, landingPos.z],
                            rotation: entity.rotation.y,
                            inventory: crateState.crateInventory
                        }
                    });

                    ui.showToast('Crate auto-unloaded to shore', 'info');

                    // Clear crate state only after successful unload
                    crateState.isLoaded = false;
                    crateState.loadedCrate = null;
                    crateState.crateId = null;
                    crateState.crateChunkKey = null;
                    crateState.crateQuality = null;
                    crateState.crateLastRepairTime = null;
                    crateState.crateInventory = null;
                } else {
                    // No land nearby - warn user but DON'T clear crate state
                    // Crate stays loaded on boat so player can try again from a different position
                    console.warn('[Disembark] No land found for crate auto-unload - keeping crate on boat');
                    ui.showToast('Cannot disembark here - no land nearby for crate', 'warning');
                    // Don't clear crate state - it's still on the boat
                    return; // Abort disembark
                }
            }

            if (this.animationSystem) {
                this.animationSystem.registerShip(entity);
            }

            // Remove vehicle's character controller
            if (this.physicsManager) {
                this.physicsManager.removeCharacterController(entityId);
            }

            // Re-create player's character controller at dismount position
            // (was disabled during mount to prevent ghost collider)
            if (this.physicsManager) {
                this.physicsManager.createCharacterController(
                    'player',
                    0.1,    // radius (matches GameInitializer)
                    0.3,    // height (matches GameInitializer)
                    this.playerObject.position
                );
            }
        } else if (entityType === 'horse') {
            if (state.entityWalkAction) {
                state.entityWalkAction.stop();
            }
            if (state.entityMixer) {
                state.entityMixer.stopAllAction();
            }
            if (state.horseSound?.isPlaying) {
                state.horseSound.stop();
                state.horseSound = null;
            }
            if (this.physicsManager) {
                this.physicsManager.removeCharacterController(entityId);
            }

            // Re-create player's character controller at dismount position
            // (was disabled during mount to prevent ghost collider)
            if (this.physicsManager) {
                this.physicsManager.createCharacterController(
                    'player',
                    0.1,    // radius (matches GameInitializer)
                    0.3,    // height (matches GameInitializer)
                    this.playerObject.position
                );
            }

            if (this.animationAction) {
                this.animationAction.play();
            }
            // Auto-release cart (both normal dismount and sale)
            if (this.gameState.cartAttachmentState.isAttached) {
                this.handleReleaseCart();
            }
            // Auto-release artillery (both normal dismount and sale)
            if (this.gameState.artilleryAttachmentState.isAttached) {
                this.handleReleaseArtillery();
            }
        }

        // For horse sale, remove from scene AFTER cleanup
        if (isHorseSale) {
            this.removeHorseAfterSale(entityId, entity);
        }

        // Clear occupancy
        this.mobileEntitySystem.clearOccupied(entityId);

        // Reset state
        state.isActive = false;
        state.currentEntity = null;
        state.entityId = null;
        state.entityType = null;
        state.phase = null;
        state.boardingStartTime = null;
        state.disembarkStartTime = null;
        state.originalPosition = null;
        state.targetPosition = null;
        state.entityQuality = null;
        state.entityLastRepairTime = null;
        state.entityMixer = null;
        state.entityWalkAction = null;
        state.pendingHorseSale = false;
        state.pendingHorseSaleData = null;

        this.checkProximityToObjects();

        const statusMsg = isHorseSale ? 'Horse sold' : (entityType === 'horse' ? 'Dismounted' : 'Disembarked');
        ui.updateStatus(statusMsg);
    }

    /**
     * Switch from current water vehicle to a nearby unoccupied one
     * Releases current boat and immediately boards the new one
     */
    switchToNearbyBoat() {
        const targetEntity = this.gameState.nearestSwitchableMobileEntity;
        if (!targetEntity) return;

        const state = this.gameState.mobileEntityState;
        const currentEntity = state.currentEntity;
        const currentEntityId = state.entityId;
        const currentEntityType = state.entityType;

        if (!currentEntity || !currentEntityId) return;

        // Send release message to server for current boat
        this.networkManager.sendMessage('release_mobile_entity', {
            entityId: currentEntityId,
            entityType: currentEntityType,
            chunkKey: currentEntity.userData.chunkKey,
            clientId: this.gameState.clientId,
            position: currentEntity.position.toArray(),
            rotation: currentEntity.rotation.y, // Radians
            quality: state.entityQuality,
            lastRepairTime: state.entityLastRepairTime,
            owner: state.entityOwner
        });

        // Broadcast release to peers
        this.networkManager.broadcastP2P({
            type: 'mobile_entity_exit',
            payload: {
                entityId: currentEntityId,
                entityType: currentEntityType,
                position: currentEntity.position.toArray(),
                rotation: currentEntity.rotation.y, // Radians
                playerPosition: this.playerObject.position.toArray()
            }
        });

        // Re-register the old boat with AnimationSystem (so it bobs on waves again)
        if (this.animationSystem) {
            this.animationSystem.register(currentEntityId, currentEntity);
        }

        // Clear occupancy of current boat
        this.mobileEntitySystem.clearOccupied(currentEntityId);

        // Reset state for transfer (don't reset isActive - we're staying in mobile mode)
        state.currentEntity = null;
        state.entityId = null;
        state.entityType = null;
        state.phase = null;
        state.entityQuality = null;
        state.entityLastRepairTime = null;
        state.entityOwner = null;

        // Clear switchable target (will be re-detected if there's another)
        this.gameState.nearestSwitchableMobileEntity = null;

        // Board the new boat
        this.startBoarding(targetEntity);

        ui.showToast(`Switching to ${targetEntity.type}`, 'info');
    }

    /**
     * Mount a purchased horse after server confirms purchase
     * Horse is created via object_added broadcast, this just finds and mounts it
     * @param {number} quality - Horse quality (0-100)
     * @param {string} horseId - Horse ID from server (for finding the horse)
     */
    spawnAndMountHorse(quality, horseId) {
        // Try to find horse created by object_added broadcast
        let horseObject = this.objectRegistry?.get(horseId);

        // If not found immediately, try a short delay (race condition with broadcast)
        if (!horseObject && horseId) {
            // Schedule retry after a frame to allow object_added processing
            setTimeout(() => {
                horseObject = this.objectRegistry?.get(horseId);
                if (horseObject) {
                    this.mountPurchasedHorse(horseObject, quality);
                } else {
                    // Fallback: create locally if broadcast failed
                    console.warn('[spawnAndMountHorse] Horse not found, creating locally');
                    this.createAndMountHorseLocally(quality, horseId);
                }
            }, 100);
            return;
        }

        if (horseObject) {
            this.mountPurchasedHorse(horseObject, quality);
        } else {
            // No horseId provided (legacy) or immediate lookup failed - create locally
            this.createAndMountHorseLocally(quality, horseId);
        }
    }

    /**
     * Mount a horse object that already exists in the scene
     * @param {THREE.Object3D} horseObject - Horse object to mount
     * @param {number} quality - Horse quality for display
     */
    mountPurchasedHorse(horseObject, quality) {
        const mobileEntity = { type: 'horse', object: horseObject };
        this.startBoarding(mobileEntity);
        ui.showToast('Horse purchased!', 'success');
    }

    /**
     * Fallback: create horse locally if server broadcast wasn't received
     * @param {number} quality - Horse quality
     * @param {string} horseId - Horse ID from server (optional)
     */
    createAndMountHorseLocally(quality, horseId) {
        const playerPos = this.playerObject.position;
        const terrainY = this.terrainGenerator.getWorldHeight(playerPos.x, playerPos.z);

        // Use server-provided ID or generate one
        const finalHorseId = horseId || `horse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Get player's current chunk
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(playerPos.x, playerPos.z);
        const chunkKey = `${chunkX},${chunkZ}`;

        // Create horse data
        const horseData = {
            id: finalHorseId,
            name: 'horse',
            position: [playerPos.x, terrainY, playerPos.z],
            rotation: this.playerObject.rotation.y, // Radians
            scale: 1,  // Required - prevents invisible horse
            quality: quality,
            currentDurability: quality,
            owner: this.gameState.accountId || this.gameState.clientId,
            lastRepairTime: Date.now()
        };

        // Create horse in scene
        const horseObject = this.messageRouter.sceneObjectFactory.createObjectInScene(horseData, chunkKey);

        if (horseObject) {
            this.mountPurchasedHorse(horseObject, quality);
        } else {
            console.error('[createAndMountHorseLocally] Failed to create horse object');
            ui.showToast('Failed to spawn horse', 'error');
        }
    }

    /**
     * Remove horse from scene after sale (does not re-add to chunk)
     * @param {string} entityId - Horse entity ID
     * @param {THREE.Object3D} entity - Horse object (optional, will lookup if not provided)
     */
    removeHorseAfterSale(entityId, entity = null) {
        const horse = entity || this.objectRegistry.get(entityId);
        if (!horse) {
            console.warn('[removeHorseAfterSale] Horse not found:', entityId);
            return;
        }

        // Remove from scene
        this.scene.remove(horse);

        // Remove from object registry
        this.objectRegistry.delete(entityId);

        // Remove from decayable structures
        if (this.gameState.decayableStructures) {
            this.gameState.decayableStructures.delete(entityId);
        }

        // Remove physics collider if exists
        if (this.physicsManager) {
            this.physicsManager.removeCollider(entityId);
        }

        // Remove from chunk objects
        const chunkKey = horse.userData?.chunkKey;
        if (chunkKey && this.chunkManager?.chunkObjects) {
            const chunkObjects = this.chunkManager.chunkObjects.get(chunkKey);
            if (chunkObjects) {
                const index = chunkObjects.indexOf(horse);
                if (index > -1) chunkObjects.splice(index, 1);
            }
        }

        // Dispose geometry/materials to free memory
        horse.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });

        console.log(`[removeHorseAfterSale] Removed horse ${entityId}`);
    }

    checkProximityToObjects() {
        if (this.interactionManager) {
            this.interactionManager.checkProximityToObjects();
        }
    }

    /**
     * Update ocean ambient sound based on player X position
     * @param {number} deltaTime - Time delta in seconds
     */
    updateOceanSound(deltaTime) {
        if (this.ambientSoundSystem) {
            this.ambientSoundSystem.updateOceanSound(deltaTime);
        }
    }

    /**
     * Update plains ambient sound based on player X position
     * @param {number} deltaTime - Time delta in seconds
     */
    updatePlainsSound(deltaTime) {
        if (this.ambientSoundSystem) {
            this.ambientSoundSystem.updatePlainsSound(deltaTime);
        }
    }

    /**
     * Update mountain ambient sound based on player Y position (altitude)
     * @param {number} deltaTime - Time delta in seconds
     */
    updateMountainSound(deltaTime) {
        if (this.ambientSoundSystem) {
            this.ambientSoundSystem.updateMountainSound(deltaTime);
        }
    }

    /**
     * Update campfire ambient sound based on distance to nearest active campfire
     * @param {number} deltaTime - Time delta in seconds
     */
    updateCampfireSound(deltaTime) {
        if (this.ambientSoundSystem) {
            this.ambientSoundSystem.updateCampfireSound(deltaTime);
        }
    }

    /**
     * Add smoke effect to a campfire
     * @param {string} objectId - Unique ID for the campfire
     * @param {THREE.Vector3|Object} position - Campfire position {x, y, z}
     */
    addCampfireSmoke(objectId, position) {
        if (this.effectManager) {
            this.effectManager.addCampfireSmoke(objectId, position);
        }
    }

    /**
     * Add smoke effect to a house (chimney smoke)
     * @param {string} objectId - Unique ID for the house
     * @param {THREE.Vector3|Object} position - House position {x, y, z}
     * @param {number} rotation - Rotation in radians (default 0)
     */
    addHouseSmoke(objectId, position, rotation = 0) {
        if (this.effectManager) {
            this.effectManager.addHouseSmoke(objectId, position, rotation);
        }
    }

    /**
     * Add smoke effects to tileworks chimneys (2 smoke sources at diagonal corners)
     * @param {string} objectId - Unique ID for the tileworks
     * @param {Object} position - Position of the tileworks center
     * @param {number} rotation - Rotation in radians (default 0)
     */
    addTileworksSmoke(objectId, position, rotation = 0) {
        if (this.effectManager) {
            this.effectManager.addTileworksSmoke(objectId, position, rotation);
        }
    }

    /**
     * Add smoke effect to ironworks (single centered chimney)
     * @param {string} objectId - Unique ID for the ironworks
     * @param {Object} position - Position of the ironworks center
     * @param {number} rotation - Rotation in radians (default 0)
     */
    addIronworksSmoke(objectId, position, rotation = 0) {
        if (this.effectManager) {
            this.effectManager.addIronworksSmoke(objectId, position, rotation);
        }
    }

    /**
     * Add smoke effect to blacksmith (single centered chimney, same as ironworks)
     * @param {string} objectId - Unique ID for the blacksmith
     * @param {Object} position - Position of the blacksmith center
     * @param {number} rotation - Rotation in radians (default 0)
     */
    addBlacksmithSmoke(objectId, position, rotation = 0) {
        if (this.effectManager) {
            this.effectManager.addBlacksmithSmoke(objectId, position, rotation);
        }
    }

    /**
     * Add smoke effect to bakery (single centered chimney, same as blacksmith/ironworks)
     * @param {string} objectId - Unique ID for the bakery
     * @param {Object} position - Position of the bakery center
     * @param {number} rotation - Rotation in radians (default 0)
     */
    addBakerySmoke(objectId, position, rotation = 0) {
        if (this.effectManager) {
            this.effectManager.addBakerySmoke(objectId, position, rotation);
        }
    }

    /**
     * Add smoke effect for fisherman (single centered chimney, same as bakery)
     * @param {string} objectId - Unique ID for the fisherman
     * @param {Object} position - Position of the fisherman center
     * @param {number} rotation - Rotation in radians (default 0)
     */
    addFishermanSmoke(objectId, position, rotation = 0) {
        if (this.effectManager) {
            this.effectManager.addFishermanSmoke(objectId, position, rotation);
        }
    }

    /**
     * Remove smoke effect from a campfire (graceful fadeout)
     * @param {string} objectId - Unique ID for the campfire
     */
    removeCampfireSmoke(objectId) {
        if (this.effectManager) {
            this.effectManager.removeCampfireSmoke(objectId);
        }
    }

    /**
     * Remove all smoke effects (useful for cleanup or chunk unloading)
     */
    removeAllSmoke() {
        if (this.effectManager) {
            this.effectManager.removeAllSmoke();
        }
    }

}

// ==========================================
// INITIALIZATION
// ==========================================

// Wait for models to load before starting game
modelManager.loadAllModels().then(async () => {
    const game = new MultiplayerGame();
    window.game = game; // Expose for debugging

    // Debug function to spawn a horse at player position
    // Usage: Open browser console and type: spawnHorse()
    window.spawnHorse = () => {
        if (!game.playerObject) {
            console.error('Player not spawned yet');
            return;
        }
        const pos = game.playerObject.position;
        const rotation = game.playerObject.rotation.y;
        game.networkManager.sendMessage('place_horse', {
            position: [pos.x + 2, pos.y, pos.z],  // Offset 2 units so player isn't inside it
            rotation: rotation,
            materialQuality: 50,
            clientId: game.gameState.clientId,
            accountId: game.gameState.accountId || null
        });
        console.log('Horse spawn requested at', pos.x + 2, pos.z);
    };

    // Debug function to force ship spawn at all docks (triggers baker spawn)
    // Usage: Open browser console and type: forceShipSpawn()
    window.forceShipSpawn = () => {
        if (!game.scheduledShipSystem) {
            console.error('ScheduledShipSystem not initialized');
            return;
        }
        const docks = game.scheduledShipSystem.docks;
        if (docks.size === 0) {
            console.warn('No docks registered. Build a dock first.');
            return;
        }
        console.log(`Forcing ship spawn for ${docks.size} dock(s)...`);
        for (const [dockId, dock] of docks) {
            // Calculate chunkId from dock position
            const chunkX = Math.floor((dock.position[0] + 25) / 50);
            const chunkZ = Math.floor((dock.position[2] + 25) / 50);
            const chunkId = `chunk_${chunkX},${chunkZ}`;

            game.networkManager.sendMessage('trigger_dock_ship', {
                dockId: dockId,
                chunkId: chunkId
            });
            console.log(`  -> Sent trigger_dock_ship for dock ${dockId} at chunk ${chunkId}`);
        }
        console.log('Ship spawn(s) triggered! Baker should spawn if bakery+market are near dock.');
    };

    // Wait for phase 1 initialization (networking, auth setup)
    await game.initPromise;

    // Create terrain generator for spawn validation (before full terrain system loads)
    const spawnTerrainGenerator = new TerrainGenerator(TERRAIN_CONFIG.SEED || 12345);

    // Initialize SpawnScreen
    game.spawnScreen = new SpawnScreen(
        game.gameState,
        game.networkManager,
        async (spawnType, data) => {
            // Handle spawn selection

            // Hide spawn screen and show loading immediately
            game.spawnScreen.hide();
            game.loadingScreen.setStatus('Finding spawn point...', 2);
            await new Promise(resolve => setTimeout(resolve, 0));

            let spawnX, spawnZ;
            const factionId = data.factionId !== undefined ? data.factionId : game.gameState.factionId;
            const zones = game.gameState.FACTION_ZONES;
            let minX, maxX, minZ, maxZ;

            if (factionId === null) {
                // Neutral/guest players: full world bounds
                minX = CONFIG.WORLD_BOUNDS.minX;
                maxX = CONFIG.WORLD_BOUNDS.maxX;
                minZ = CONFIG.WORLD_BOUNDS.minZ;
                maxZ = CONFIG.WORLD_BOUNDS.maxZ;
            } else {
                // Faction players: tighter spawn zone near border
                const zone = zones[factionId];
                minX = zone.minX;
                maxX = zone.maxX;
                minZ = zone.minZ;
                maxZ = zone.maxZ;
            }

            // Pass banditController for respawn to avoid spawning near bandits, null for initial spawn
            const bc = game.isFullyInitialized ? game.banditController : null;

            if (spawnType === 'home') {
                // Spawn near home structure (offset to avoid being inside it)
                const result = findValidSpawnNearStructure(spawnTerrainGenerator, data.x, data.z, minZ, maxZ, bc);
                spawnX = result.x;
                spawnZ = result.z;
            } else if (spawnType === 'friend') {
                // Spawn near friend (offset to avoid being on top of them)
                const result = findValidSpawnNearStructure(spawnTerrainGenerator, data.friendX, data.friendZ, minZ, maxZ, bc);
                spawnX = result.x;
                spawnZ = result.z;
            } else {
                // Random spawn - find valid position in faction zone
                // Uses optimized continent-based algorithm (fast, no loading needed)
                const result = findValidSpawnPoint(spawnTerrainGenerator, 0, 0, minX, maxX, minZ, maxZ, bc);
                spawnX = result.x;
                spawnZ = result.z;
            }

            // Check if this is initial spawn or respawn
            if (game.isFullyInitialized) {
                // This is a respawn - just teleport
                game.loadingScreen.setStatus('Teleporting...', 5);
                await new Promise(resolve => setTimeout(resolve, 0));

                // Give starting inventory only for random spawns
                // Home/friend spawns start with nothing
                if (spawnType === 'random') {
                    game.gameState.inventory.items = game.gameState.getDefaultInventoryItems();
                    game.gameState.slingItem = game.gameState.getDefaultSlingItem();
                    if (game.playerInventory) {
                        game.playerInventory.itemsRef = game.gameState.inventory.items;
                    }
                    if (game.inventoryUI) {
                        game.inventoryUI.renderInventory();
                    }
                    // Reset hunger state since default items include food
                    if (game.playerHunger) {
                        game.playerHunger.starvationStartTime = null;
                        game.playerHunger.hungerState = 'fed';
                        const foodItems = game.playerHunger.getFoodItemsFromInventory();
                        game.playerHunger.updateFoodStatusUI(foodItems);
                    }
                } else {
                    // Home/friend spawn: clear inventory
                    game.gameState.inventory.items = [];
                    game.gameState.slingItem = null;
                    if (game.playerInventory) {
                        game.playerInventory.itemsRef = game.gameState.inventory.items;
                    }
                    if (game.inventoryUI) {
                        game.inventoryUI.renderInventory();
                    }
                }
                game.respawnToPosition(spawnX, spawnZ);

                // Set spawn time for P2P kick logic (most recent spawner gets kicked on P2P failure)
                game.gameState.lastSpawnTime = Date.now();
            } else {
                // Initial spawn - complete game initialization
                // Give starting inventory only for random spawns
                // Home/friend spawns start with nothing
                if (spawnType === 'random') {
                    game.gameState.inventory.items = game.gameState.getDefaultInventoryItems();
                    game.gameState.slingItem = game.gameState.getDefaultSlingItem();
                } else {
                    // Home/friend spawn: clear inventory
                    game.gameState.inventory.items = [];
                    game.gameState.slingItem = null;
                }

                // Progressive loading feedback
                game.loadingScreen.setStatus('Initializing terrain...', 4);
                await new Promise(resolve => setTimeout(resolve, 0));

                await game.initializeWithSpawn(spawnX, spawnZ);
                await game.start();

                // Set spawn time for P2P kick logic (most recent spawner gets kicked on P2P failure)
                game.gameState.lastSpawnTime = Date.now();
            }
        },
        // Logout callback
        () => {
            console.log('[Game] Logout requested');
            // Clear session token
            if (game.authClient) {
                game.authClient.clearStoredSession();
            }
            // Reset game state auth
            game.gameState.clearAuthentication();
            // Hide spawn screen
            game.spawnScreen.hide();
            // Show login modal
            game.loginModal.show();
        },
        // Open friends panel callback
        () => {
            if (game.friendsPanel) {
                game.friendsPanel.show();
            }
        }
    );

    // Set up auth complete callback on LoginModal
    game.loginModal.onAuthComplete = async (authType, data) => {

        if (authType === 'login' && data.playerData) {
            // Request friends list before showing spawn screen
            game.networkManager.sendMessage('get_friends_list', {});
        }

        // Show spawn screen for ALL users (logged in, guest, or new account)
        // This ensures everyone can select graphics quality before spawning
        game.spawnScreen.show({ isRespawn: false });
    };

    // Check for auto-login or show login modal
    const autoLoggedIn = await game.loginModal.attemptAutoLogin();
    if (autoLoggedIn) {
        // Request friends list before showing spawn screen
        game.networkManager.sendMessage('get_friends_list', {});

        // Auto-logged in - show spawn screen
        game.spawnScreen.show({ isRespawn: false });
    } else {
        // Show login modal
        game.loginModal.show();
    }

    // NOTE: game.start() is now called after spawn selection, not here

}).catch(error => {
    console.error('Failed to load models:', error);
    alert('Failed to load game models. Please refresh the page.');
});
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
import { WaterRenderer } from './WaterRenderer.js';
import { CONFIG, COMPUTED } from './config.js';
import { SimpleTerrainRenderer } from './terrain.js';
import { objectPlacer, modelManager } from './objects.js';
import { BlobShadow } from './blobshadow.js';
import { BillboardSystem } from './BillboardSystem.js';
import { AudioManager, OceanSoundManager, PlainsSoundManager, MountainSoundManager, CampfireSoundManager } from './audio.js';
import { SmokeEffect } from './SmokeEffect.js';
import { AIEnemy } from './ai-enemy.js';
import { PathfindingTestAI } from './PathfindingTestAI.js';
import { NetworkManager } from './network/NetworkManager.js';
import { GameState } from './core/GameState.js';
import { GameLoop } from './core/GameLoop.js';
import { SceneManager } from './core/SceneManager.js';
import { CameraController } from './core/CameraController.js';
import { InputManager } from './core/InputManager.js';
import { PlayerController } from './player/PlayerController.js';
import { PlayerInventory } from './player/PlayerInventory.js';
import { PlayerActions } from './player/PlayerActions.js';
import { PlayerCombat } from './player/PlayerCombat.js';
import { PlayerHunger } from './player/PlayerHunger.js';
import { ChunkManager } from './world/ChunkManager.js';
import { StructureManager } from './world/StructureManager.js';
import { AvatarManager } from './entity/AvatarManager.js';
import { AIEnemyManager } from './entity/AIEnemyManager.js';
import { DeathSystem } from './entity/DeathSystem.js';
import { InventoryUI } from './ui/InventoryUI.js';
import { BuildMenu } from './ui/BuildMenu.js';
import { CraftingSystem } from './systems/CraftingSystem.js';
import { ResourceManager } from './systems/ResourceManager.js';
import { BuildingSystem } from './systems/BuildingSystem.js';
import { AnimationSystem } from './systems/AnimationSystem.js';
import { GrassGathering } from './systems/GrassGathering.js';
import { MessageRouter } from './network/MessageRouter.js';
import { PhysicsManager, COLLISION_GROUPS } from './core/PhysicsManager.js';
import { NavigationManager } from './navigation/NavigationManager.js';
import { TreeInstanceManager } from './core/TreeInstanceManager.js';
import ChunkCoordinates from './core/ChunkCoordinates.js';

// ==========================================
// MAIN GAME CLASS
// ==========================================

class MultiplayerGame {
    constructor() {
        this.gameState = new GameState();

        // Sensor-based proximity tracking (objectId -> THREE.Object3D)
        this.activeProximityObjects = new Map();

        // Object registry for fast lookups (objectId -> THREE.Object3D)
        // Populated lazily on first proximity check to avoid scene.traverse()
        this.objectRegistry = new Map();
        this.registryRefreshCounter = 0; // Counter for periodic registry refresh

        // Bounding box collision tracking (for debug logging)
        this.activeBoundingBoxCollisions = new Set();

        // Smoke effects tracking (campfire objectId -> SmokeEffect)
        this.smokeEffects = new Map();

        // Initialize core systems (SceneManager will be initialized async in init())
        this.sceneManager = new SceneManager();
        this.scene = null;
        this.camera = null;
        this.renderer = null;

        // Initialize game loop
        this.gameLoop = new GameLoop();

        // Camera controller will be initialized after SceneManager
        this.cameraController = null;

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

        // Initialize game (async) and store promise
        this.initPromise = this.init();
    }

    async init() {
        // Initialize SceneManager (including skybox loading)
        await this.sceneManager.initialize();

        // Get references after initialization
        this.scene = this.sceneManager.getScene();
        this.camera = this.sceneManager.getCamera();
        this.renderer = this.sceneManager.getRenderer();

        // Initialize controllers now that camera and scene are ready
        this.cameraController = new CameraController(this.camera);
        this.inputManager = new InputManager(this.camera);

        // Set scene on physics manager and initialize
        this.physicsManager.scene = this.scene;
        await this.physicsManager.initialize();

        // Initialize billboard system for tree LOD
        this.billboardSystem = new BillboardSystem(this.scene);

        // Set physics manager on objectPlacer for collider registration
        objectPlacer.setPhysicsManager(this.physicsManager);
        objectPlacer.setBillboardSystem(this.billboardSystem);

        // Continue with rest of setup
        this.setupScene();
        this.setupPlayer();
        this.setupRenderers();
        this.setupNetworking();
        this.setupInput();
        this.setupUI();
        this.setupGameLoop();
    }

    setupScene() {
        // Scene, camera, renderer, and lighting are now handled by SceneManager
        // This method now only handles player-specific initialization

        // Create player object (will be replaced with man model after loading)
        this.playerObject = new THREE.Group();
        // Set player spawn position
        this.playerObject.position.set(5.04, 1.37, 14.29);
        this.scene.add(this.playerObject);

        // Set player metadata early for physics system
        this.playerObject.userData.objectId = 'player_' + this.gameState.clientId;
        this.playerObject.userData.modelType = 'player';

        // Add to objectRegistry for fast lookups
        this.objectRegistry.set(this.playerObject.userData.objectId, this.playerObject);

        // Player scale
        this.playerScale = 1;

        // Animation support
        this.animationMixer = null;
        this.animationAction = null;
        this.shootAction = null;
        this.idleAction = null;
        this.combatAction = null;

        // AI Enemy will be initialized after models load
        this.aiEnemy = null;

        // Death state tracking
        this.isDead = false;
        this.deathStartTime = 0;
        this.deathRotationProgress = 0;
        this.fallDirection = 1;

        // Player shooting state (managed by PlayerCombat)
        this.playerShootTarget = null;
        this.playerLastShootTime = 0;
        this.playerShootInterval = 6000; // 6 seconds between shots
        this.playerLastTargetCheckTime = 0;

        // Raycaster and pointer now handled by InputManager

        // Initialize audio manager
        this.audioManager = new AudioManager(this.camera);
        this.audioManager.loadSounds();

        // Initialize ocean sound manager (for ambient ocean sounds)
        this.gameState.oceanSoundManager = new OceanSoundManager(this.audioManager);

        // Initialize plains sound manager (for ambient plains sounds)
        this.gameState.plainsSoundManager = new PlainsSoundManager(this.audioManager);

        // Initialize mountain sound manager (for ambient mountain sounds)
        this.gameState.mountainSoundManager = new MountainSoundManager(this.audioManager);

        // Initialize campfire sound manager (for ambient campfire sounds)
        this.gameState.campfireSoundManager = new CampfireSoundManager(this.audioManager);
    }

    setupPlayer() {
        // Initialize player inventory
        this.playerInventory = new PlayerInventory(
            this.gameState.inventory.rows,
            this.gameState.inventory.cols
        );

        // Point PlayerInventory to use gameState.inventory.items
        this.playerInventory.itemsRef = this.gameState.inventory.items;

        // Initialize player actions
        this.playerActions = new PlayerActions(
            this.playerInventory,
            this.audioManager,
            this.animationMixer
        );

        // Initialize player combat
        this.playerCombat = new PlayerCombat(
            this.playerObject,
            this.audioManager
        );


        // Initialize death system
        this.deathSystem = new DeathSystem();

        // Note: PlayerController initialized in setupRenderers after terrainRenderer exists
    }

    setupRenderers() {
        this.terrainRenderer = new SimpleTerrainRenderer(this.scene, null, this.gameState);

        // Initialize textures and materials AFTER renderer is fully ready
        // This ensures WebGL context is active and prevents texture initialization errors
        this.terrainRenderer.init();

        this.waterRenderer = new WaterRenderer(this.scene, CONFIG.WATER.LEVEL, this.terrainRenderer, this.sceneManager);
        this.terrainRenderer.setWaterRenderer(this.waterRenderer);

        // Setup GUI for billboard controls now that billboard system is ready
        // this.waterRenderer.setupGUI();

        // Initialize NavigationManager for AI pathfinding
        this.navigationManager = new NavigationManager(this.physicsManager);
        this.navigationManager.setScene(this.scene); // Set scene for debug visualization
        this.terrainRenderer.setNavigationManager(this.navigationManager);

        // Initialize TreeInstanceManager for high-performance tree rendering
        // ENABLED for ALL tree types - massive performance boost!
        this.treeInstanceManager = new TreeInstanceManager(this.scene, modelManager);
        // this.treeInstanceManager.enableTreeTypes(['oak', 'fir', 'pine', 'cypress', 'apple']); // DISABLED - billboards only

        // Connect TreeInstanceManager to objectPlacer
        objectPlacer.setTreeInstanceManager(this.treeInstanceManager);

        this.chunkManager = new ChunkManager(
            this.gameState,
            this.terrainRenderer,
            this.scene,
            this
        );

        // Initialize StructureManager for building placement
        this.structureManager = new StructureManager(this.scene, this.terrainRenderer, this.physicsManager);

        // Initialize PlayerController after terrainRenderer is created
        this.playerController = new PlayerController(this.playerObject, this.terrainRenderer, this.physicsManager, this.navigationManager);

        // Create physics character controller for player
        if (this.physicsManager && this.physicsManager.initialized) {
            const playerObjectId = this.playerObject.userData.objectId || 'player';
            const playerPosition = this.playerObject.position;

            // Create character controller (radius: 0.1, height: 0.3)
            this.physicsManager.createCharacterController(
                playerObjectId,
                0.1,  // Capsule radius (1/3 of original 0.3)
                0.3,  // Capsule height (1/3 of original 1.0)
                playerPosition
            );
        }

        // Set up arrival callback
        this.playerController.setOnArriveCallback(() => {
            // IMPORTANT: Set isMoving to false BEFORE checking proximity
            // Otherwise buttons won't appear because they check !isMoving
            this.gameState.isMoving = false;

            if (this.gameState.inventoryOpen) {
                this.inventoryUI.updateConstructionSection();
                this.inventoryUI.updateCrateSection();
            }
            this.checkProximityToObjects();
        });

        // Set up blocked callback
        this.playerController.setOnBlockedCallback((position) => {
            // Set isMoving to false when blocked
            this.gameState.isMoving = false;

            this.networkManager.broadcastP2P({
                type: 'player_sync',
                payload: { position: position.toArray(), target: null }
            });
            if (this.gameState.inventoryOpen) {
                this.inventoryUI.updateConstructionSection();
                this.inventoryUI.updateCrateSection();
            }
            const hasAxe = this.hasToolWithDurability('axe');
            const hasSaw = this.hasToolWithDurability('saw');
            const hasHammer = this.hasToolWithDurability('hammer');
            const hasFishingNet = this.hasToolWithDurability('fishingnet');
            const isOnCooldown = this.gameState.harvestCooldown && this.gameState.harvestCooldown.endTime > Date.now();
            ui.updateButtonStates(this.gameState.isInChunk, this.gameState.nearestObject, hasAxe, hasSaw, isOnCooldown, this.gameState.nearestConstructionSite, this.gameState.isMoving, this.gameState.nearestStructure, hasHammer, this.gameState.nearWater, hasFishingNet, this.gameState.onGrass, this.gameState.mushroomAvailable);
        });
    }

    setupNetworking() {
        this.networkManager = new NetworkManager(
            this.gameState,
            this.handleServerMessage.bind(this)
        );

        // Set game reference for creating peer AI enemies
        this.networkManager.setGame(this);

        // Set scene reference for adding peer AI enemies
        this.networkManager.setScene(this.scene);

        // Set audio manager reference in NetworkManager for P2P sounds
        this.networkManager.setAudioManager(this.audioManager);

        // Initialize AvatarManager for peer player avatars
        this.avatarManager = new AvatarManager(
            this.scene,
            this.networkManager,
            this.structureManager,
            this.terrainRenderer,
            modelManager,
            this.navigationManager,
            this.playerScale
        );

        // Initialize AIEnemyManager for AI enemies
        this.aiEnemyManager = new AIEnemyManager(
            this.scene,
            this.networkManager,
            this.structureManager,
            this.terrainRenderer
        );
        this.aiEnemyManager.setGameReference(this);

        // Set up property references for backward compatibility
        this.tentAIEnemies = this.aiEnemyManager.tentAIEnemies;
        this.aiEnemyController = this.aiEnemyManager.aiEnemyController;
        this.aiEnemy = this.aiEnemyManager.aiEnemy;

        // Subscribe to game state events (optional - for future extensibility)
        // Example: this.networkManager.on('player_sync', (data) => { ... });
        // Example: this.networkManager.on('ai_death', (data) => { ... });
    }

    setupInput() {
        // Use InputManager for mouse/pointer events
        this.inputManager.onPointerDown(this.onPointerDown.bind(this));
        this.inputManager.onPointerMove(this.onPointerMove.bind(this));

        // Use InputManager for keyboard events
        this.inputManager.onKeyDown((event) => {
            if (event.key === 'i' || event.key === 'I') {
                this.inventoryUI.toggleInventory();
            }
            if (event.key === 'b' || event.key === 'B') {
                // Delegate to BuildMenu
                if (this.buildMenu) {
                    this.buildMenu.toggleBuildMenu();
                }
            }
            // Q key rotates structure left during placement
            if ((event.key === 'q' || event.key === 'Q') && this.buildMenu && this.buildMenu.isPlacementActive()) {
                if (this.buildMenu.rotationControls) {
                    this.buildMenu.rotationControls.rotateLeft();
                }
            }

            // E key rotates structure right during placement
            if ((event.key === 'e' || event.key === 'E') && this.buildMenu && this.buildMenu.isPlacementActive()) {
                if (this.buildMenu.rotationControls) {
                    this.buildMenu.rotationControls.rotateRight();
                }
            }

            // Space key confirms structure placement during rotation phase
            if (event.key === ' ' && this.buildMenu && this.buildMenu.isPlacementActive()) {
                if (this.buildMenu.structurePlacement && this.buildMenu.structurePlacement.phase === 'rotation') {
                    if (this.buildMenu.rotationControls) {
                        this.buildMenu.rotationControls.confirm();
                    }
                }
            }

            // ESC key cancels structure placement
            if (event.key === 'Escape' && this.buildMenu && this.buildMenu.isPlacementActive()) {
                this.buildMenu.cancelStructurePlacement();
                ui.updateStatusLine1('Placement cancelled', 3000);
            }

            // ESC key cancels demolish action
            if (event.key === 'Escape' && this.gameState.activeAction) {
                this.cancelChoppingAction();
            }

            // V key toggles physics debug visualization
            if (event.key === 'v' || event.key === 'V') {
                if (this.physicsManager) {
                    const visible = this.physicsManager.toggleDebug();
                    ui.updateStatusLine1(`Physics debug: ${visible ? 'ON' : 'OFF'}`, 3000);
                }
            }

            // N key toggles navigation grid visualization
            if (event.key === 'n' || event.key === 'N') {
                if (this.navigationManager) {
                    const visible = this.navigationManager.toggleDebugVisualization();
                    ui.updateStatusLine1(`Navigation debug: ${visible ? 'ON' : 'OFF'}`, 3000);
                }
            }
        });

        // Zoom controls - use CameraController
        const zoomInBtn = document.getElementById('zoomInBtn');
        const zoomOutBtn = document.getElementById('zoomOutBtn');

        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', () => {
                this.cameraController.zoomIn();
            });
        }

        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', () => {
                this.cameraController.zoomOut();
            });
        }
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
                            scale: object.userData.originalScale || object.scale
                        };
                    }

                    // Check if it's a log - if so, treat as firewood harvest
                    const isLog = normalizedObject.name.endsWith('_log') || normalizedObject.name === 'log';
                    const isRock = normalizedObject.name === 'limestone' || normalizedObject.name === 'sandstone' || normalizedObject.name === 'clay';

                    if (isLog) {
                        this.startHarvestAction(normalizedObject, 'firewood');
                    } else if (isRock) {
                        this.startHarvestAction(normalizedObject, 'stone');
                    } else {
                        // Start the removal action for trees/structures (includes timer, animation, sound)
                        this.startRemovalAction(normalizedObject);
                    }
                }
            },
            onHarvestLog: (object, harvestType) => {
                if (object) {
                    this.startHarvestAction(object, harvestType);
                }
            },
            onStartFishing: () => {
                if (this.resourceManager && this.gameState.nearWater && !this.gameState.activeAction && !this.gameState.isMoving) {
                    this.resourceManager.startFishingAction();
                }
            },
            onStartGatherGrass: () => {
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
            onResize: this.onResize.bind(this),
            resumeAudio: () => {
                if (this.audioManager) {
                    this.audioManager.resumeContext();
                }
            },
            toggleInventory: () => this.inventoryUI.toggleInventory(),
            toggleBuildMenu: () => {
                // Will be available after initialization
                if (this.buildMenu) {
                    this.buildMenu.toggleBuildMenu();
                }
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
        ui.updateStatus("🎮 Game initialized");
        ui.updateConnectionStatus('connecting', '🔄 Connecting...');

        // Wait for models to load before setting up player
        ui.updateStatus("⏳ Loading player model...");
        await modelManager.loadAllModels();
        ui.updateStatus("✅ Models loaded");

        // Pre-initialize all tree InstancedMeshes (BEFORE chunks start loading!)
        // This ensures they exist in the scene from the start
        if (this.treeInstanceManager) {
            this.treeInstanceManager.preInitializeAllMeshes();
        }

        // Load and setup player model
        this.setupPlayerModel();

        // Spawn pathfinding test AI at specific position
        // const testAIPosition = new THREE.Vector3(4.10, 1.34, 14.66);
        // this.pathfindingTestAI = new PathfindingTestAI(this, this.scene, testAIPosition);

        // Initialize InventoryUI with all dependencies
        this.inventoryUI = new InventoryUI(this.gameState, this);

        // Initialize PlayerHunger system (starts at spawn)
        this.playerHunger = new PlayerHunger(this.playerInventory, ui, this.inventoryUI, this);

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
        this.grassGathering.setTerrainRenderer(this.terrainRenderer);

        // Initialize BuildingSystem
        this.buildingSystem = new BuildingSystem(
            this.gameState,
            this.networkManager,
            this.audioManager,
            this.inventoryUI
        );
        this.buildingSystem.setGameReference(this);

        // Initialize AnimationSystem
        this.animationSystem = new AnimationSystem(this.scene);

        // Set up callbacks for InventoryUI
        this.inventoryUI.onChiselingStart = this.craftingSystem.startChiselingAction.bind(this.craftingSystem);
        this.inventoryUI.onItemCombine = this.craftingSystem.combineItems.bind(this.craftingSystem);
        this.inventoryUI.onProximityCheck = this.checkProximityToObjects.bind(this);
        this.inventoryUI.onInventoryClosed = () => {
            // Callback when inventory closes - can be used for future needs
        };

        // Initialize inventory UI
        this.inventoryUI.initialize();

        // Initialize build menu UI
        this.buildMenu = new BuildMenu({
            gameState: this.gameState,
            scene: this.scene,
            terrainRenderer: this.terrainRenderer,
            structureManager: this.structureManager,
            networkManager: this.networkManager,
            inventoryUI: this.inventoryUI,
            playerObject: this.playerObject
        });

        // Initialize message router for handling all server messages
        this.messageRouter = new MessageRouter(this);
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

        this.networkManager.connect(CONFIG.NETWORKING.USE_ONLINE_SERVER);

        // Note: Physics colliders are now registered automatically when objects are created
        // No need for manual registration like the old collision system

        this.gameLoop.start();

    }

    setupPlayerModel() {
        const manGLTF = modelManager.getGLTF('man');

        if (!manGLTF) {
            console.error('Man model not loaded');
            return;
        }

        // CRITICAL FIX: Use original scene directly - cloning breaks skeleton binding for SkinnedMesh
        const playerMesh = manGLTF.scene;
        playerMesh.scale.set(this.playerScale, this.playerScale, this.playerScale);

        // Setup materials and proper lighting
        playerMesh.traverse((child) => {
            if (child.isMesh || child.isSkinnedMesh) {
                child.visible = true; // Ensure visibility
                child.frustumCulled = false; // Disable frustum culling (CPU overhead)
                child.renderOrder = 1; // Render after terrain

                // Fix dark materials - ensure they respond to lighting
                if (child.material) {
                    // Re-enable depth testing (need this for proper rendering)
                    child.material.depthWrite = true;
                    child.material.depthTest = true;

                    // MeshStandardMaterial should already work with lights
                    // But make sure it's not too dark
                    if (child.material.type === 'MeshStandardMaterial') {
                        // Don't override color, but ensure it receives light properly
                        child.material.needsUpdate = true;
                    }
                }
            }
        });

        // Add to player object
        this.playerObject.add(playerMesh);

        // Calculate bounding box to find model's dimensions
        const box = new THREE.Box3().setFromObject(playerMesh);
        const center = box.getCenter(new THREE.Vector3());
        const size = new THREE.Vector3();
        box.getSize(size);

        // Store the Z offset needed to align feet with click position
        this.playerModelOffset = center.z;

        // Store actual model height for terrain following
        this.playerModelHeight = size.y;


        // Setup animation
        if (manGLTF.animations && manGLTF.animations.length > 0) {
            this.animationMixer = new THREE.AnimationMixer(playerMesh);

            // Update PlayerActions with the animation mixer
            if (this.playerActions) {
                this.playerActions.setAnimationMixer(this.animationMixer);
            }

            // Search for walk animation by name
            const walkAnimation = manGLTF.animations.find(anim =>
                anim.name.toLowerCase().includes('walk')
            );

            if (walkAnimation) {
                this.animationAction = this.animationMixer.clipAction(walkAnimation);
                this.animationAction.play();
            }

            // Search for pickaxe animation (the only action animation in man.glb)
            // Try various possible names
            let choppingAnimation = manGLTF.animations.find(anim => {
                const name = anim.name.toLowerCase();
                // Check for exact matches first
                if (name === 'pickaxe' || name === 'pickaxe.001' || name === 'armature|pickaxe') {
                    return true;
                }
                // Then check for partial matches
                return name.includes('pickaxe') || name.includes('pick') ||
                       name.includes('axe') || name.includes('action');
            });

            if (choppingAnimation) {
                this.choppingAction = this.animationMixer.clipAction(choppingAnimation);
                this.choppingAction.loop = THREE.LoopRepeat;
            } else {
                // Use walk animation as fallback for chopping
                if (walkAnimation) {
                    this.choppingAction = this.animationMixer.clipAction(walkAnimation);
                    this.choppingAction.loop = THREE.LoopRepeat;
                }
            }

            // Search for idle animation
            const idleAnimation = manGLTF.animations.find(anim =>
                anim.name.toLowerCase().includes('idle')
            );

            if (idleAnimation) {
                this.idleAction = this.animationMixer.clipAction(idleAnimation);
                this.idleAction.loop = THREE.LoopRepeat;
            }

            // Update PlayerActions with chopping animation
            if (this.playerActions && this.choppingAction) {
                this.playerActions.setChoppingAnimation(this.choppingAction);
            }

            // Update CraftingSystem with animation references
            if (this.craftingSystem) {
                this.craftingSystem.setAnimationReferences(this.animationMixer, this.choppingAction);
                this.craftingSystem.setInventoryToggleCallback(this.toggleInventory.bind(this));
            }

            // Update ResourceManager with animation references
            if (this.resourceManager) {
                this.resourceManager.setAnimationReferences(this.animationMixer, this.choppingAction);
            }

            // Update BuildingSystem with animation references
            if (this.buildingSystem) {
                this.buildingSystem.setAnimationReferences(this.animationMixer, this.choppingAction);
            }

            // Search for shooting animation
            const shootAnimation = manGLTF.animations.find(anim => {
                const name = anim.name.toLowerCase();
                return name.includes('shoot') || name.includes('fire') ||
                       name.includes('rifle') || name.includes('gun') ||
                       name.includes('aim');
            });

            if (shootAnimation) {
                this.shootAction = this.animationMixer.clipAction(shootAnimation);
                this.shootAction.loop = THREE.LoopOnce; // Play once per trigger
                this.shootAction.clampWhenFinished = true; // Hold last frame

                // Update PlayerCombat with shoot animation
                if (this.playerCombat) {
                    this.playerCombat.setShootAnimation(this.shootAction);
                }
            }

            // Search for combat animation
            const combatAnimation = manGLTF.animations.find(anim =>
                anim.name.toLowerCase().includes('combat')
            );

            if (combatAnimation) {
                this.combatAction = this.animationMixer.clipAction(combatAnimation);
                this.combatAction.loop = THREE.LoopRepeat;
            }
        }

        // Set player object reference in NetworkManager for P2P state sync
        this.networkManager.setPlayerObject(this.playerObject);

        // Note: Player metadata is now set earlier in setupScene() for physics system
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
        const treeTypes = ['oak', 'fir', 'pine', 'cypress', 'apple'];
        const structureTypes = ['construction', 'foundation', 'foundationcorner', 'foundationroundcorner',
            'crate', 'tent', 'house', 'garden', 'market', 'outpost', 'ship', 'dock'];
        const isTree = treeTypes.includes(object.name);
        const isStructure = structureTypes.includes(object.name);

        // Face the target object
        if (object.position) {
            const targetAngle = Math.atan2(
                object.position.x - this.playerObject.position.x,
                object.position.z - this.playerObject.position.z
            );
            this.playerObject.rotation.y = targetAngle;
        }

        // Start removal action
        this.gameState.activeAction = {
            object: object,
            startTime: Date.now(),
            duration: isStructure ? CONFIG.ACTIONS.CHOP_STRUCTURE_DURATION : CONFIG.ACTIONS.CHOP_TREE_DURATION,
            actionType: isStructure ? 'demolish' : 'chop'
        };

        // Play appropriate sound
        if (isTree && this.audioManager) {
            const sound = this.audioManager.playAxeSound();
            this.gameState.activeAction.sound = sound;
        } else if (isStructure && this.audioManager) {
            const sound = this.audioManager.playHammerSound();
            this.gameState.activeAction.sound = sound;
        }

        // Start removal animation and stop walking
        if (this.animationMixer && this.choppingAction) {
            // Stop walking animation if playing
            if (this.animationAction) {
                this.animationAction.stop();
            }
            // Start chopping animation
            this.choppingAction.reset();
            this.choppingAction.play();
        }

        // Broadcast sound to peers
        if (isTree) {
            this.networkManager.broadcastP2P({
                type: 'player_sound',
                payload: {
                    soundType: 'axe',
                    startTime: Date.now()
                }
            });
        } else if (isStructure) {
            this.networkManager.broadcastP2P({
                type: 'player_sound',
                payload: {
                    soundType: 'hammer',
                    startTime: Date.now()
                }
            });
        }
    }

    startHarvestAction(object, harvestType) {
        // Delegate to ResourceManager
        this.resourceManager.startHarvestAction(object, harvestType);
    }

    updateChoppingAction() {
        if (!this.gameState.activeAction) return;

        const now = Date.now();
        const elapsed = now - this.gameState.activeAction.startTime;
        const progress = Math.min(elapsed / this.gameState.activeAction.duration, 1);

        // Throttle UI updates (configurable interval), but always update on completion
        const shouldUpdateUI = (now - this.gameState.lastChoppingProgressUpdate >= CONFIG.GAME_LOOP.ACTION_PROGRESS_UPDATE_INTERVAL) || progress >= 1;

        if (shouldUpdateUI) {
            ui.updateChoppingProgress(progress);
            this.gameState.lastChoppingProgressUpdate = now;
        }

        // Check if action is complete (checked every frame for responsiveness)
        if (progress >= 1) {
            this.completeActiveAction();
        }
    }

    cancelChoppingAction() {
        if (!this.gameState.activeAction) return;

        // Get action type before clearing
        const actionType = this.gameState.activeAction.actionType;

        // Stop sound
        if (this.gameState.activeAction.sound) {
            this.gameState.activeAction.sound.stop();
        }

        // Stop chopping animation
        if (this.choppingAction) {
            this.choppingAction.stop();
        }

        // Clear active action
        this.gameState.activeAction = null;
        ui.updateChoppingProgress(0);

        // Show cancellation message based on action type
        if (actionType === 'demolish') {
            ui.updateStatusLine1('❌ Demolish cancelled', 2000);
        } else if (actionType === 'chop') {
            ui.updateStatusLine1('❌ Chopping cancelled', 2000);
        } else if (actionType === 'build') {
            ui.updateStatusLine1('❌ Building cancelled', 2000);
        } else if (actionType === 'build_road') {
            ui.updateStatusLine1('❌ Road building cancelled', 2000);
        } else if (actionType === 'build_campfire') {
            ui.updateStatusLine1('❌ Campfire building cancelled', 2000);
        } else if (actionType === 'combining') {
            ui.updateStatusLine1('❌ Combining cancelled', 2000);
        } else {
            ui.updateStatusLine1('❌ Action cancelled', 2000);
        }
    }

    completeActiveAction() {
        if (!this.gameState.activeAction) return;

        const object = this.gameState.activeAction.object;
        const harvestType = this.gameState.activeAction.harvestType;
        const actionType = this.gameState.activeAction.actionType;

        // Stop sound
        if (this.gameState.activeAction.sound) {
            this.gameState.activeAction.sound.stop();
        }

        // Stop action animation
        if (this.animationMixer && this.choppingAction) {
            this.choppingAction.stop();
        }

        // Handle build completion
        if (actionType === 'build') {
            // Delegate to BuildingSystem
            this.buildingSystem.completeBuildAction(this.gameState.activeAction);
            return;
        }

        // Handle road building completion
        if (actionType === 'build_road') {
            const roadData = this.gameState.activeAction.roadData;

            // 1. Decrease hammer durability
            const hammer = this.gameState.inventory.items.find(item =>
                item.type === 'hammer' && item.durability > 0
            );

            if (hammer) {
                const hammerQuality = hammer.quality;
                const durabilityLoss = Math.ceil(100 / hammerQuality);
                hammer.durability = Math.max(0, hammer.durability - durabilityLoss);

                // Remove hammer if broken
                if (hammer.durability === 0) {
                    const hammerIndex = this.gameState.inventory.items.indexOf(hammer);
                    this.gameState.inventory.items.splice(hammerIndex, 1);
                    ui.updateStatusLine1('⚠️ Hammer broke!', 3000);
                }
            }

            // 2. Send server message to place road (apply texture)
            this.networkManager.sendMessage('place_road', {
                position: roadData.position,
                rotation: roadData.rotation
            });

            // 3. Clear active action
            this.gameState.activeAction = null;
            ui.updateChoppingProgress(0);
            ui.updateStatusLine1('✅ Road complete!', 3000);

            // Resume walk animation if moving
            if (this.gameState.isMoving && this.animationAction) {
                this.animationAction.play();
            }

            return;
        }

        // Handle campfire building completion
        if (actionType === 'build_campfire') {
            const campfireData = this.gameState.activeAction.campfireData;

            // No tool durability loss (campfire doesn't require tools)

            // Send server message to place campfire structure
            this.networkManager.sendMessage('place_campfire', {
                position: campfireData.position,
                rotation: campfireData.rotation
            });

            // Clear active action
            this.gameState.activeAction = null;
            ui.updateChoppingProgress(0);
            ui.updateStatusLine1('✅ Campfire complete!', 3000);

            // Resume walk animation if moving
            if (this.gameState.isMoving && this.animationAction) {
                this.animationAction.play();
            }

            return;
        }

        // Handle chiseling completion
        if (actionType === 'chiseling') {
            // Delegate to CraftingSystem
            this.craftingSystem.completeChiselingAction(this.gameState.activeAction);
            return;
        }

        // Handle combining completion
        if (actionType === 'combining') {
            // Delegate to CraftingSystem
            this.craftingSystem.completeCombineAction(this.gameState.activeAction);

            // Resume walk animation if moving
            if (this.gameState.isMoving && this.animationAction) {
                this.animationAction.play();
            }

            return;
        }

        // Handle fishing completion
        if (actionType === 'fishing') {
            // Delegate to ResourceManager
            this.resourceManager.completeFishingAction();

            // Clear active action
            this.gameState.activeAction = null;
            ui.updateChoppingProgress(0);

            // Resume walk animation if moving
            if (this.gameState.isMoving && this.animationAction) {
                this.animationAction.play();
            }

            // Update proximity to refresh buttons
            this.checkProximityToObjects();
            return;
        }

        // Handle grass gathering completion
        if (actionType === 'gather_grass') {
            // Delegate to GrassGathering
            this.grassGathering.completeGatheringAction();

            // Clear active action
            this.gameState.activeAction = null;
            ui.updateChoppingProgress(0);

            // Resume walk animation if moving
            if (this.gameState.isMoving && this.animationAction) {
                this.animationAction.play();
            }

            // Update proximity to refresh buttons
            this.checkProximityToObjects();
            return;
        }

        // Check if this is a harvest action (log harvesting)
        if (harvestType) {
            // Delegate to ResourceManager
            this.resourceManager.completeHarvestAction(this.gameState.activeAction);
        } else {
            // Standard tree/structure removal
            console.log('[completeActiveAction] Sending remove_object_request for:', object.id, 'chunkKey:', object.chunkKey);
            this.networkManager.sendMessage('remove_object_request', {
                chunkId: `chunk_${object.chunkKey}`,
                objectId: object.id,
                name: object.name,
                position: object.position.toArray(),
                quality: object.quality,
                scale: object.scale,
                objectData: {
                    name: object.name,
                    position: object.position.toArray(),
                    quality: object.quality,
                    scale: object.scale,
                    totalResources: object.totalResources,
                    remainingResources: object.remainingResources
                }
            });

            // Request log spawn for trees - delegate to ResourceManager
            this.resourceManager.requestLogSpawn(object);
        }

        // Clear active action
        this.gameState.activeAction = null;
        ui.updateChoppingProgress(0);

        // Update proximity to refresh buttons
        this.checkProximityToObjects();
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

                // Create physics character controller for peer
                this.avatarManager.createAvatarPhysics(avatar, peerId);
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

        // Delegate to BuildMenu if placement is active
        if (!this.buildMenu || !this.buildMenu.isPlacementActive()) return;

        // Raycast to find terrain intersection - use raycaster from InputManager
        const terrainObjects = Array.from(this.terrainRenderer.chunkMap.values()).map(c => c.mesh);
        const waterObjects = this.waterRenderer.getWaterChunks();
        const allObjects = [...terrainObjects, ...waterObjects];
        const intersects = raycaster.intersectObjects(allObjects, true);

        if (intersects.length > 0) {
            const { point } = intersects[0];
            // Delegate to BuildMenu for preview update
            this.buildMenu.updateStructurePreview(point.x, point.z, event.clientY);
        }
    }

    onPointerDown(event, pointer, raycaster) {
        // InputManager already filters for CANVAS target, so no need to check

        // Prevent any action if player is dead
        if (this.isDead) {
            return;
        }

        // Prevent movement during shooting pause
        if (this.playerCombat.isInShootingPause()) {
            return;
        }

        // Resume AudioContext on first user interaction (browser requirement)
        if (this.audioManager) {
            this.audioManager.resumeContext();
        }

        // Handle structure placement if active - delegate to BuildMenu
        if (this.buildMenu && this.buildMenu.isPlacementActive()) {
            this.buildMenu.advanceStructurePlacementPhase(event.clientY);
            return;
        }

        // Prevent movement during chopping/harvesting
        if (this.gameState.activeAction) {
            return;
        }

        // Prevent movement when inventory is open (forces player to close menu first)
        if (this.gameState.inventoryOpen) {
            return;
        }

        // Use raycaster from InputManager
        const terrainObjects = Array.from(this.terrainRenderer.chunkMap.values()).map(c => c.mesh);
        const waterObjects = this.waterRenderer.getWaterChunks();

        // Collect walkable foundation objects for raycast (allows clicking on foundations)
        const foundationObjects = [];
        for (const objects of this.terrainRenderer.chunkObjects.values()) {
            for (const obj of objects) {
                // Only include walkable foundations (not construction sites)
                if (obj.userData.modelType === 'foundation' ||
                    obj.userData.modelType === 'foundationcorner' ||
                    obj.userData.modelType === 'foundationroundcorner') {
                    foundationObjects.push(obj);
                }
            }
        }

        const allObjects = [...terrainObjects, ...waterObjects, ...foundationObjects];
        const intersects = raycaster.intersectObjects(allObjects, true);

        if (intersects.length > 0) {
            const { point } = intersects[0];

            // Check if the clicked position is in water (terrain below water level)
            const terrainHeight = this.terrainRenderer.getHeightFast(point.x, point.z);
            if (terrainHeight < CONFIG.WATER.MIN_WALKABLE_HEIGHT) {
                // Clicked on water - show feedback and reject movement
                ui.updateStatus("Cannot enter water");
                ui.updateStatusLine1("Cannot enter water", 3000);
                return; // Don't move
            }

            // Use clicked position (X, Y, Z) - if clicking on foundation, Y will be foundation surface
            this.gameState.playerTargetPosition.set(point.x, point.y, point.z);
            this.playerController.setTargetPosition(this.gameState.playerTargetPosition);
            this.gameState.isMoving = true;
            ui.updateStatus(`🚀 Moving to clicked position...`);

            // Hide construction/crate sections when player starts moving
            if (this.gameState.inventoryOpen) {
                this.inventoryUI.updateConstructionSection();
                this.inventoryUI.updateCrateSection();
            }

            // Update button states immediately when starting movement
            const hasAxe = this.hasToolWithDurability('axe');
            const hasSaw = this.hasToolWithDurability('saw');
            const hasHammer = this.hasToolWithDurability('hammer');
            const hasFishingNet = this.hasToolWithDurability('fishingnet');
            const isOnCooldown = this.gameState.harvestCooldown && this.gameState.harvestCooldown.endTime > Date.now();
            ui.updateButtonStates(this.gameState.isInChunk, this.gameState.nearestObject, hasAxe, hasSaw, isOnCooldown, this.gameState.nearestConstructionSite, this.gameState.isMoving, this.gameState.nearestStructure, hasHammer, this.gameState.nearWater, hasFishingNet, this.gameState.onGrass, this.gameState.mushroomAvailable);

            this.networkManager.broadcastP2P({
                type: 'player_move',
                payload: {
                    start: this.playerObject.position.toArray(),
                    target: this.gameState.playerTargetPosition.toArray()
                }
            });
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

    populateObjectRegistry() {
        // Pre-populate objectRegistry from chunkObjects to avoid scene.traverse()
        // This provides O(1) lookup instead of O(M) scene traversal
        let count = 0;
        for (const objects of this.terrainRenderer.chunkObjects.values()) {
            for (const obj of objects) {
                if (obj.userData?.objectId) {
                    this.objectRegistry.set(obj.userData.objectId, obj);
                    count++;
                }
            }
        }
        if (count > 0) {
            console.log(`[ObjectRegistry] Populated with ${count} objects from chunkObjects`);
        }
        return count;
    }

    setupGameLoop() {
        // Setup update callback
        this.gameLoop.onUpdate((deltaTime, now) => {
            // Step physics simulation
            if (this.physicsManager && this.physicsManager.initialized) {
                this.physicsManager.step(deltaTime);
            }

            // Process queued network messages
            this.networkManager.processMessageQueue();

            // Update player movement using PlayerController
            this.gameState.isMoving = this.playerController.updateMovement(deltaTime, this.isDead);

            this.avatarManager.updateAvatarMovement(deltaTime);
            this.aiEnemyManager.updatePeerAIEnemies(deltaTime);

            // Check proximity every 10 frames (6 FPS at 60 FPS) to reduce physics overhead
            // Processing 500-700 sensors every frame was causing 10-20 FPS loss
            // Event-driven checks (on arrival, action completion, chunk change) handle most cases
            if (this.gameLoop.frameCount % 10 === 0) {
                this.checkProximityToObjects();
            }

            // Update ambient sounds every 10 frames (~6 times/second) for performance
            // Only update if audio system is initialized
            if (this.gameLoop.frameCount % 10 === 0 && this.audioManager && this.audioManager.isInitialized) {
                this.updateOceanSound(deltaTime / 1000); // Convert ms to seconds
                this.updatePlainsSound(deltaTime / 1000); // Convert ms to seconds
                this.updateMountainSound(deltaTime / 1000); // Convert ms to seconds
                this.updateCampfireSound(deltaTime / 1000); // Convert ms to seconds
            }

            // Update campfire smoke effects
            const deltaSeconds = deltaTime / 1000;
            const smokesToRemove = [];

            for (const [objectId, smokeEffect] of this.smokeEffects.entries()) {
                // Find the campfire object in the scene
                const campfireObject = this.scene.children.find(obj => obj.userData.objectId === objectId);

                // Simplified client-side smoke control (server controls firewood depletion)
                if (campfireObject && campfireObject.userData.inventory) {
                    const inventory = campfireObject.userData.inventory;

                    // Check if firewood exists (server controls durability)
                    const hasFirewood = inventory.items.some(item =>
                        item.type && item.type.endsWith('firewood') && item.durability > 0
                    );

                    if (hasFirewood) {
                        // Start smoke if not already active
                        if (!smokeEffect.active) {
                            smokeEffect.start();
                        }
                    } else {
                        // No firewood - stop spawning new smoke (existing particles will fade out)
                        if (smokeEffect.active) {
                            smokeEffect.stop();
                        }
                    }
                } else if (!campfireObject) {
                    // Campfire was removed - stop spawning and mark for cleanup
                    if (smokeEffect.active) {
                        smokeEffect.stop();
                    }

                    // Mark for removal once all particles have faded out
                    if (!smokeEffect.hasActiveParticles()) {
                        smokesToRemove.push(objectId);
                    }
                }

                // Always update smoke to allow particles to fade out gracefully
                smokeEffect.update(deltaSeconds);
            }

            // Clean up smoke effects that have fully faded out
            for (const objectId of smokesToRemove) {
                const smokeEffect = this.smokeEffects.get(objectId);
                if (smokeEffect) {
                    smokeEffect.dispose();
                    this.smokeEffects.delete(objectId);
                    console.log(`Removed faded smoke effect for campfire ${objectId}`);
                }
            }

            // Update player combat/shooting FIRST for fairness - delegate to PlayerCombat
            // Pass all tent AI enemies so player can target any of them
            this.playerCombat.updateShooting(
                this.aiEnemyManager.aiEnemy,
                this.aiEnemyManager.aiEnemyController,
                this.networkManager.peerGameData,
                (target, isHit, playerPos) => {
                    // Broadcast player shoot event to other players
                    this.networkManager.broadcastP2P({
                        type: 'player_shoot',
                        payload: {
                            position: playerPos.toArray(),
                            targetIsLocalAI: target.isLocal,
                            targetPeerId: target.peerId,
                            isHit: isHit
                        }
                    });

                    // Apply hit if successful
                    if (isHit) {
                        if (target.isLocal && target.controller) {
                            // Use the controller from the target (supports multiple AI enemies)
                            target.controller.kill();
                        }
                        // If target is peer's AI, they will handle the death from the broadcast
                    }
                },
                () => {
                    this.gameState.isMoving = false;
                    this.playerController.stopMovement();
                },
                this.aiEnemyManager.tentAIEnemies  // Pass all tent AI enemies
            );

            // Update all tent AI enemies
            this.aiEnemyManager.updateTentAIEnemies(deltaTime, now);

            // AI spawning is now server-authoritative (see AISpawnerSystem.js)
            // Server sends 'spawn_ai_command' when players are in range of spawners
            this.updateChoppingAction();

            // Update animated objects (ships, etc.)
            this.animationSystem.update(deltaTime);

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
                } else if (this.playerCombat.getInCombatStance()) {
                    // Stop walk and idle animations during combat
                    if (this.animationAction && this.animationAction.isRunning()) {
                        this.animationAction.stop();
                    }
                    if (this.idleAction && this.idleAction.isRunning()) {
                        this.idleAction.stop();
                    }

                    if (this.gameState.isMoving) {
                        // Combat movement: loop combat animation at speed 1.0
                        if (this.combatAction) {
                            this.combatAction.paused = false;
                            if (!this.combatAction.isRunning()) {
                                this.combatAction.play();
                            }
                        }
                        animationTimeScale = 1;  // Combat movement speed
                    } else {
                        // Combat idle: freeze combat animation at frame 2
                        if (this.combatAction) {
                            this.combatAction.paused = false;
                            // Calculate time for frame 2 (assuming 24fps animation)
                            const frameTime = 2 / 24;
                            this.combatAction.time = frameTime;
                            this.combatAction.weight = 1.0;
                            if (!this.combatAction.isRunning()) {
                                this.combatAction.play();
                            }
                            this.combatAction.paused = true;
                        }
                        // animationTimeScale remains 0 for frozen pose
                    }
                } else {
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

                    if (this.gameState.isMoving) {
                        // Stop idle animation when moving
                        if (this.idleAction && this.idleAction.isRunning()) {
                            this.idleAction.stop();
                        }
                        // Make sure walk animation is playing
                        if (this.animationAction && !this.animationAction.isRunning()) {
                            this.animationAction.play();
                        }
                        animationTimeScale = 1;  // Normal movement speed
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
            this.avatarManager.updateAvatarDeathAnimations(deltaTime, this.deathSystem.updateDeathAnimation.bind(this.deathSystem));

            // Update peer AI death animations
            this.networkManager.peerGameData.forEach((peer, peerId) => {
                if (peer.aiEnemy && peer.aiEnemy.userData.isDead) {
                    this.deathSystem.updateDeathAnimation(peer.aiEnemy, peer.aiEnemy.userData.deathStartTime, deltaTime, peer.aiEnemy.userData.fallDirection || 1, false);
                }
            });

            // Update camera to follow player (check if initialized)
            if (this.cameraController) {
                this.cameraController.setTarget(this.playerObject);
                this.cameraController.update(deltaTime);
            }

            // Update speed debug UI (temporary for debugging)
            if (this.navigationManager && this.playerObject) {
                // Calculate chunk coordinates using unified system
                const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(
                    this.playerObject.position.x,
                    this.playerObject.position.z
                );
                const chunkId = ChunkCoordinates.toChunkId(chunkX, chunkZ);
                const navMap = this.navigationManager.getChunk(chunkId);

                if (navMap) {
                    const speedInfo = navMap.getMovementSpeedInfo(
                        this.playerObject.position.x,
                        this.playerObject.position.z
                    );
                    ui.updateSpeedDebug({
                        isMoving: this.gameState.isMoving,
                        worldX: this.playerObject.position.x,
                        worldZ: this.playerObject.position.z,
                        chunkId: chunkId,
                        ...speedInfo
                    });
                } else {
                    ui.updateSpeedDebug({ isMoving: false });
                }
            }

            this.runPeriodicChecks(now);

            // Process chunk creation queue (only if work pending)
            if (this.chunkManager.pendingChunkCreations.length > 0) {
                this.chunkManager.processChunkQueue();
            }

            // Process vertex updates (only if work pending)
            const playerPos = this.playerObject ? this.playerObject.position : null;
            if (this.terrainRenderer.pendingVertexUpdates.length > 0) {
                const frameStartTime = performance.now();
                this.terrainRenderer.processVertexUpdateQueue(playerPos, frameStartTime);
            }

            // Process object generation queue (only if work pending)
            if (this.terrainRenderer.pendingObjectGeneration.length > 0) {
                this.terrainRenderer.processObjectGenerationQueue();
            }

            // Process navigation map building (only when chunk loading is idle)
            if (this.terrainRenderer.isChunkLoadingIdle() &&
                this.terrainRenderer.chunksNeedingNavMaps.size > 0) {
                // Build 1-2 nav maps per frame to spread the cost
                const chunksToProcess = Math.min(2, this.terrainRenderer.chunksNeedingNavMaps.size);
                for (let i = 0; i < chunksToProcess; i++) {
                    const chunkKey = this.terrainRenderer.chunksNeedingNavMaps.values().next().value;
                    if (chunkKey) {
                        this.terrainRenderer.buildNavigationMapForChunk(chunkKey);
                        this.terrainRenderer.chunksNeedingNavMaps.delete(chunkKey);
                    }
                }

                // Check if all navigation maps are now complete
                if (this.terrainRenderer.chunksNeedingNavMaps.size === 0 && !this.allNavMapsComplete) {
                    this.allNavMapsComplete = true;
                    console.log('[Game] All navigation maps complete! Notifying PathfindingTestAI...');

                    // Notify the PathfindingTestAI that nav maps are ready
                    // if (this.pathfindingTestAI) {
                    //     this.pathfindingTestAI.onAllNavMapsReady();
                    // }
                }
            }

            // Cull blob shadows and distant trees beyond 20 units (check every 10 frames to save CPU)
            if (this.gameLoop.frameCount % 10 === 0 && playerPos) {
                this.cullDistantShadows(playerPos);
                this.cullDistantTrees(playerPos);
            }

            // Emergency disposal if queue gets too large
            if (this.chunkManager.pendingChunkDisposals.length > 20) {
                this.chunkManager.processDisposalQueue();
            }


            this.waterRenderer.update(now, this.camera);
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

            this.sceneManager.render(this.waterRenderer);
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
                // If chunk changed, notify server
                const { clientId, currentPlayerChunkX, currentPlayerChunkZ, lastChunkX, lastChunkZ } = this.gameState;
                this.networkManager.sendMessage('chunk_update', {
                    clientId,
                    newChunkId: ChunkCoordinates.toChunkId(currentPlayerChunkX, currentPlayerChunkZ),
                    lastChunkId: ChunkCoordinates.toChunkId(lastChunkX, lastChunkZ)
                });
                ui.updateStatus(`Player moved to chunk (${currentPlayerChunkX}, ${currentPlayerChunkZ})`);
                this.checkProximityToObjects(); // Check proximity when entering new chunk
            }
            this.gameState.lastChunkUpdateTime = now;
        }



        if (now - this.gameState.lastPeerCheckTime > CONFIG.GAME_LOOP.PEER_CHECK_INTERVAL) {
            this.networkManager.checkAndReconnectPeers();
            this.gameState.lastPeerCheckTime = now;
        }
    }

    cullDistantShadows(playerPos) {
        const maxDistance = 20;
        const maxDistanceSquared = maxDistance * maxDistance;

        // Iterate through all loaded chunks and their objects
        this.terrainRenderer.chunkObjects.forEach((objects) => {
            objects.forEach((obj) => {
                if (obj.userData && obj.userData.blobShadow) {
                    const dx = obj.position.x - playerPos.x;
                    const dz = obj.position.z - playerPos.z;
                    const distanceSquared = dx * dx + dz * dz;

                    // Hide shadow if beyond max distance, show if within
                    obj.userData.blobShadow.setVisible(distanceSquared <= maxDistanceSquared);
                }
            });
        });
    }

    cullDistantTrees(playerPos) {
        const maxDistance = 20;
        const maxDistanceSquared = maxDistance * maxDistance;
        const TREE_TYPES = ['oak', 'fir', 'pine', 'cypress', 'apple'];

        // Get player's chunk coordinates
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(playerPos.x, playerPos.z);

        // Only check chunks in 3x3 grid around player
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const chunkKey = `${chunkX + dx},${chunkZ + dz}`;
                const objects = this.terrainRenderer.chunkObjects.get(chunkKey);

                if (objects) {
                    objects.forEach((obj) => {
                        // Only process trees
                        if (obj.userData && TREE_TYPES.includes(obj.userData.modelType)) {
                            const dx = obj.position.x - playerPos.x;
                            const dz = obj.position.z - playerPos.z;
                            const distanceSquared = dx * dx + dz * dz;

                            // Hide tree if beyond max distance, show if within
                            obj.visible = distanceSquared <= maxDistanceSquared;
                        }
                    });
                }
            }
        }

        // Update billboard opacity based on camera distance
        if (this.billboardSystem) {
            this.billboardSystem.updateBillboards(playerPos);
        }

        // Update 3D tree instance LOD (hide distant instances, show billboards)
        if (this.treeInstanceManager) {
            this.treeInstanceManager.updateTreeLOD(playerPos);
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

    killEntity(entity, isAI = false, isPeer = false) {
        // Use DeathSystem to mark entity as dead and get death data
        const deathData = this.deathSystem.markEntityDead(entity, isPeer);

        // Mark entity as dead
        if (isAI) {
            if (isPeer) {
                // Already marked by deathSystem.markEntityDead
            } else {
                this.aiEnemyIsDead = true;
                this.aiEnemyDeathStartTime = deathData.deathStartTime;
                this.aiEnemyDeathRotationProgress = deathData.deathRotationProgress;
                this.aiEnemyFallDirection = deathData.fallDirection;

                // Check if this AI belongs to a tent and mark tent as "dead AI" (no respawn)
                for (const [tentId, aiData] of this.tentAIEnemies.entries()) {
                    if (aiData.controller.enemy === entity) {
                        aiData.isDead = true;
                        this.deadTentAIs.add(tentId);
                        break;
                    }
                }
            }
        } else {
            if (isPeer) {
                // Already marked by deathSystem.markEntityDead
            } else {
                this.isDead = true;
                this.deathStartTime = deathData.deathStartTime;
                this.deathRotationProgress = deathData.deathRotationProgress;
                this.fallDirection = deathData.fallDirection;
                this.gameState.isMoving = false;
                this.playerController.stopMovement();
                // Stop player from shooting while dead
                this.playerCombat.die();
            }
        }

        // Stop any ongoing animations using DeathSystem
        let mixer = null;
        if (isPeer) {
            mixer = entity.userData.mixer;
        } else if (isAI && !isPeer) {
            mixer = this.aiEnemyAnimationMixer;
        } else if (!isAI && !isPeer) {
            mixer = this.animationMixer;
        }

        this.deathSystem.stopAnimations(mixer);

        // Broadcast death to all peers if this is a local entity (not a peer entity)
        if (!isPeer) {
            if (isAI) {
                // Local AI died - broadcast to all peers
                this.networkManager.broadcastP2P({
                    type: 'ai_enemy_death',
                    payload: {
                        position: this.aiEnemy.position.toArray()
                    }
                });
            } else {
                // Local player died - broadcast to all peers
                this.networkManager.broadcastP2P({
                    type: 'player_death',
                    payload: {
                        position: this.playerObject.position.toArray()
                    }
                });
            }
        }
    }

    getGroundHeightAt(x, z) {
        return this.terrainRenderer.getHeightFast(x, z);
    }

    checkProximityToObjects() {
        // Query nearby objects using spatial query (reliable, level-triggered)
        if (!this.physicsManager || !this.physicsManager.initialized || !this.physicsManager.world) {
            return;
        }

        // Populate objectRegistry from chunkObjects if empty (one-time initialization)
        if (this.objectRegistry.size === 0 && this.terrainRenderer.chunkObjects.size > 0) {
            this.populateObjectRegistry();
        }

        // Periodically refresh registry to catch newly added objects (every 120 frames = ~2 seconds)
        this.registryRefreshCounter++;
        if (this.registryRefreshCounter >= 120) {
            this.registryRefreshCounter = 0;
            const previousSize = this.objectRegistry.size;
            this.populateObjectRegistry();
            const newObjects = this.objectRegistry.size - previousSize;
            if (newObjects > 0) {
                console.log(`[ObjectRegistry] Refreshed - added ${newObjects} new objects`);
            }
        }

        // Use spatial query to find all bounding boxes within interaction radius
        const interactionRadius = 0.75; // Tight interaction range - player must be very close
        const collisionMask = COLLISION_GROUPS.NATURAL | COLLISION_GROUPS.PLACED | COLLISION_GROUPS.STRUCTURE;

        const nearbyColliders = this.physicsManager.querySphere(
            this.playerObject.position,
            interactionRadius,
            collisionMask
        );

        // Update active proximity objects based on spatial query results
        // Clear and rebuild the map to ensure stale entries are removed
        this.activeProximityObjects.clear();

        nearbyColliders.forEach(colliderHandle => {
            // Get object ID from collider handle (now O(1) with reverse lookup map)
            const objectId = this.physicsManager.getObjectIdFromCollider(colliderHandle);
            if (!objectId) return;

            // Get object from registry (O(1) lookup)
            const sceneObject = this.objectRegistry.get(objectId);

            if (sceneObject) {
                this.activeProximityObjects.set(objectId, sceneObject);
            } else {
                // Object not in registry - this shouldn't happen if populateObjectRegistry is working
                console.warn(`[ObjectRegistry] Object ${objectId} not found in registry`);
            }
        });

        // Find nearest objects by type from active proximity objects
        const treeTypes = ['oak', 'oak2', 'pine', 'pine2', 'fir', 'cypress', 'apple'];
        const rockTypes = ['limestone', 'sandstone', 'clay'];
        const structureTypes = ['crate', 'tent', 'house', 'garden', 'market', 'outpost', 'ship', 'dock', 'campfire'];

        let nearestNaturalObject = null;
        let nearestNaturalDistance = Infinity;
        let nearestConstructionSite = null;
        let nearestConstructionDistance = Infinity;
        let nearestStructure = null;
        let nearestStructureDistance = Infinity;

        // Calculate distances to all active proximity objects
        // PERFORMANCE OPTIMIZATION: Use squared distances for comparisons to avoid expensive Math.sqrt()
        this.activeProximityObjects.forEach((object, objectId) => {
            // Safety check: ensure object still exists in scene
            if (!object.parent) {
                // Object has been removed from scene, clean up tracking
                this.activeProximityObjects.delete(objectId);
                return;
            }

            const modelType = object.userData.modelType;
            const dx = this.playerObject.position.x - object.position.x;
            const dz = this.playerObject.position.z - object.position.z;
            const distanceSquared = dx * dx + dz * dz;  // No Math.sqrt() needed for comparisons!

            // Categorize and track nearest of each type
            if (object.userData.isConstructionSite) {
                if (distanceSquared < nearestConstructionDistance) {
                    nearestConstructionDistance = distanceSquared;
                    nearestConstructionSite = object;
                }
            } else if (structureTypes.includes(modelType)) {
                if (distanceSquared < nearestStructureDistance) {
                    nearestStructureDistance = distanceSquared;
                    nearestStructure = object;
                }
            } else if (treeTypes.includes(modelType) || rockTypes.includes(modelType) ||
                       modelType === 'log' || modelType.endsWith('_log')) {
                if (distanceSquared < nearestNaturalDistance) {
                    nearestNaturalDistance = distanceSquared;
                    nearestNaturalObject = object;
                }
            }
        });

        // Update game state - natural objects (trees/rocks/logs)
        if (nearestNaturalObject) {
            this.gameState.nearestObject = {
                id: nearestNaturalObject.userData.objectId,
                name: nearestNaturalObject.userData.modelType,
                position: nearestNaturalObject.position.clone(),
                chunkKey: nearestNaturalObject.userData.chunkKey,
                quality: nearestNaturalObject.userData.quality,
                scale: nearestNaturalObject.userData.originalScale || nearestNaturalObject.scale,
                remainingResources: nearestNaturalObject.userData.remainingResources,
                totalResources: nearestNaturalObject.userData.totalResources,
                toolCheck: this.hasRequiredTool(nearestNaturalObject.userData.modelType)
            };
            // Convert squared distance back to actual distance for storage (in case it's needed elsewhere)
            this.gameState.nearestObjectDistance = Math.sqrt(nearestNaturalDistance);
        } else {
            this.gameState.nearestObject = null;
            this.gameState.nearestObjectDistance = Infinity;
        }

        // Update game state - construction sites
        if (nearestConstructionSite) {
            this.gameState.nearestConstructionSite = nearestConstructionSite;
            this.gameState.nearestConstructionSiteDistance = nearestConstructionDistance;
        } else {
            this.gameState.nearestConstructionSite = null;
            this.gameState.nearestConstructionSiteDistance = Infinity;
        }

        // Update game state - structures
        if (nearestStructure) {
            this.gameState.nearestStructure = nearestStructure;
            this.gameState.nearestStructureDistance = nearestStructureDistance;
        } else {
            this.gameState.nearestStructure = null;
            this.gameState.nearestStructureDistance = Infinity;
        }

        // Special case: Apple trees are BOTH trees (for chopping) AND structures (for inventory)
        if (nearestNaturalObject && nearestNaturalObject.userData.modelType === 'apple') {
            // If apple tree is closer than current nearestStructure (or no structure found), set it as nearestStructure too
            if (!nearestStructure || nearestNaturalDistance < nearestStructureDistance) {
                this.gameState.nearestStructure = nearestNaturalObject;
                this.gameState.nearestStructureDistance = nearestNaturalDistance;
            }
        }

        // Check for bounding box collisions (physical contact with solid colliders)
        if (this.physicsManager && this.physicsManager.initialized) {
            const playerObjectId = this.playerObject.userData.objectId || 'player';
            const contacts = this.physicsManager.getCharacterContacts(playerObjectId);

            // Track current collisions
            const currentCollisions = new Set();

            contacts.forEach(contact => {
                currentCollisions.add(contact.objectId);
            });

            // Update tracked collisions
            this.activeBoundingBoxCollisions = currentCollisions;
        }

        // FISHING: Detect if player is on shore (land adjacent to water)
        const playerHeight = this.terrainRenderer.getTerrainHeightAt(
            this.playerObject.position.x,
            this.playerObject.position.z
        );

        this.gameState.nearWater = false;

        // Only check for nearby water if player is on land
        if (playerHeight >= CONFIG.WATER.LEVEL) {
            // Sample 8 points in circle around player to find water
            const checkRadius = 0.75; // Same as other interaction radius
            const numSamples = 8;

            for (let i = 0; i < numSamples; i++) {
                const angle = (i / numSamples) * Math.PI * 2;
                const checkX = this.playerObject.position.x + Math.cos(angle) * checkRadius;
                const checkZ = this.playerObject.position.z + Math.sin(angle) * checkRadius;

                const checkHeight = this.terrainRenderer.getTerrainHeightAt(checkX, checkZ);

                // Found water nearby!
                if (checkHeight < CONFIG.WATER.LEVEL) {
                    this.gameState.nearWater = true;
                    this.gameState.waterDirection = angle; // Store for optional facing
                    break;
                }
            }
        }

        // GRASS GATHERING: Detect if player is standing on grass terrain
        const grassDetection = this.grassGathering.detectGrassUnderPlayer(
            this.playerObject.position.x,
            this.playerObject.position.z
        );
        this.gameState.onGrass = grassDetection.onGrass;
        this.gameState.grassQualityRange = grassDetection.qualityRange;

        // MUSHROOM GATHERING: Detect if mushroom should appear (10% chance when stopped on grass)
        // Track previous movement state to detect when player stops
        if (!this.gameState.wasMoving) {
            this.gameState.wasMoving = this.gameState.isMoving;
        }

        const justStopped = this.gameState.wasMoving && !this.gameState.isMoving;

        // If player just stopped on grass, roll for mushroom (10% chance)
        if (justStopped && this.gameState.onGrass) {
            this.gameState.mushroomAvailable = this.grassGathering.rollForMushroom();
        }

        // If player starts moving, disable mushroom
        if (this.gameState.isMoving) {
            this.gameState.mushroomAvailable = false;
        }

        // Update previous movement state for next frame
        this.gameState.wasMoving = this.gameState.isMoving;

        // Update UI
        const hasAxe = this.hasToolWithDurability('axe');
        const hasSaw = this.hasToolWithDurability('saw');
        const hasHammer = this.hasToolWithDurability('hammer');
        const hasFishingNet = this.hasToolWithDurability('fishingnet');
        const isOnCooldown = this.gameState.harvestCooldown && this.gameState.harvestCooldown.endTime > Date.now();

        ui.updateNearestObject(
            this.gameState.nearestObject ? this.gameState.nearestObject.name : null,
            this.gameState.nearestObject ? this.gameState.nearestObject.toolCheck : null,
            this.gameState.nearestObject ? this.gameState.nearestObject.quality : null,
            this.gameState.nearestObject ? this.gameState.nearestObject.remainingResources : null,
            this.gameState.nearestObject ? this.gameState.nearestObject.totalResources : null
        );
        ui.updateButtonStates(
            this.gameState.isInChunk,
            this.gameState.nearestObject,
            hasAxe,
            hasSaw,
            isOnCooldown,
            this.gameState.nearestConstructionSite,
            this.gameState.isMoving,
            this.gameState.nearestStructure,
            hasHammer,
            this.gameState.nearWater,
            hasFishingNet,
            this.gameState.onGrass,  // Grass gathering detection
            this.gameState.mushroomAvailable  // Mushroom gathering availability
        );
    }

    /**
     * Update ocean ambient sound based on player X position
     * @param {number} deltaTime - Time delta in seconds
     */
    updateOceanSound(deltaTime) {
        if (!this.playerObject || !this.gameState.oceanSoundManager) {
            return;
        }

        const oceanManager = this.gameState.oceanSoundManager;
        const playerX = this.playerObject.position.x;
        const playerY = this.playerObject.position.y;

        // Calculate target volume based on player X position
        // Fade in from x = -10 to x = 7
        const fadeStartX = CONFIG.AUDIO.OCEAN_SOUND_FADE_START_X;
        const fullVolumeX = CONFIG.AUDIO.OCEAN_SOUND_FULL_VOLUME_X;
        const maxVolume = CONFIG.AUDIO.OCEAN_SOUND_MAX_VOLUME;

        let targetVolume = 0;

        if (playerX < fadeStartX) {
            // Too far west - no sound
            targetVolume = 0;
        } else if (playerX >= fullVolumeX) {
            // East of full volume threshold - full volume
            targetVolume = maxVolume;
        } else {
            // In fade range - linear interpolation
            const fadeRange = fullVolumeX - fadeStartX;
            const fadeProgress = (playerX - fadeStartX) / fadeRange;
            targetVolume = maxVolume * fadeProgress;
        }

        // Apply altitude fade-out (y > 4.0 fades to 0 by y = 5.5)
        const altitudeFadeStart = CONFIG.AUDIO.MOUNTAIN_SOUND_FADE_START_Y; // 4.0
        const altitudeFadeEnd = CONFIG.AUDIO.MOUNTAIN_SOUND_FULL_VOLUME_Y;  // 5.5

        if (playerY > altitudeFadeStart) {
            if (playerY >= altitudeFadeEnd) {
                // Above 5.5 - complete fade out
                targetVolume = 0;
            } else {
                // Between 4.0 and 5.5 - fade out proportionally
                const altitudeFadeRange = altitudeFadeEnd - altitudeFadeStart;
                const altitudeFadeProgress = (playerY - altitudeFadeStart) / altitudeFadeRange;
                targetVolume *= (1.0 - altitudeFadeProgress); // Reduce volume as altitude increases
            }
        }

        // Start sound when entering fade zone
        if (targetVolume > 0 && !oceanManager.isPlaying) {
            oceanManager.start();
        }

        // Always update if playing (let volume fade to 0 naturally)
        if (oceanManager.isPlaying) {
            oceanManager.update(deltaTime, targetVolume);
        }

        // Only stop when significantly far from fade zone (x < -12 or y > 6.5)
        // This allows natural fade-out to 0 before stopping
        if ((playerX < fadeStartX - 2 || playerY > altitudeFadeEnd + 1.0) && oceanManager.isPlaying) {
            oceanManager.stop();
        }
    }

    /**
     * Update plains ambient sound based on player X position
     * @param {number} deltaTime - Time delta in seconds
     */
    updatePlainsSound(deltaTime) {
        if (!this.playerObject || !this.gameState.plainsSoundManager) {
            return;
        }

        const plainsManager = this.gameState.plainsSoundManager;
        const playerX = this.playerObject.position.x;
        const playerY = this.playerObject.position.y;

        // Calculate target volume based on player X position
        // Fade in from x = 0 to x = -10
        const fadeStartX = CONFIG.AUDIO.PLAINS_SOUND_FADE_START_X;
        const fullVolumeX = CONFIG.AUDIO.PLAINS_SOUND_FULL_VOLUME_X;
        const maxVolume = CONFIG.AUDIO.PLAINS_SOUND_MAX_VOLUME;

        let targetVolume = 0;

        if (playerX > fadeStartX) {
            // Too far east - no sound
            targetVolume = 0;
        } else if (playerX <= fullVolumeX) {
            // West of full volume threshold - full volume
            targetVolume = maxVolume;
        } else {
            // In fade range - linear interpolation
            const fadeRange = fadeStartX - fullVolumeX; // 0 - (-10) = 10
            const fadeProgress = (fadeStartX - playerX) / fadeRange; // (0 - playerX) / 10
            targetVolume = maxVolume * fadeProgress;
        }

        // Apply altitude fade-out (y > 4.0 fades to 0 by y = 5.5)
        const altitudeFadeStart = CONFIG.AUDIO.MOUNTAIN_SOUND_FADE_START_Y; // 4.0
        const altitudeFadeEnd = CONFIG.AUDIO.MOUNTAIN_SOUND_FULL_VOLUME_Y;  // 5.5

        if (playerY > altitudeFadeStart) {
            if (playerY >= altitudeFadeEnd) {
                // Above 5.5 - complete fade out
                targetVolume = 0;
            } else {
                // Between 4.0 and 5.5 - fade out proportionally
                const altitudeFadeRange = altitudeFadeEnd - altitudeFadeStart;
                const altitudeFadeProgress = (playerY - altitudeFadeStart) / altitudeFadeRange;
                targetVolume *= (1.0 - altitudeFadeProgress); // Reduce volume as altitude increases
            }
        }

        // Start sound when entering fade zone
        if (targetVolume > 0 && !plainsManager.isPlaying) {
            plainsManager.start();
        }

        // Always update if playing (let volume fade to 0 naturally)
        if (plainsManager.isPlaying) {
            plainsManager.update(deltaTime, targetVolume);
        }

        // Only stop when significantly far from fade zone (x > 2 or y > 6.5)
        // This allows natural fade-out to 0 before stopping
        if ((playerX > fadeStartX + 2 || playerY > altitudeFadeEnd + 1.0) && plainsManager.isPlaying) {
            plainsManager.stop();
        }
    }

    /**
     * Update mountain ambient sound based on player Y position (altitude)
     * @param {number} deltaTime - Time delta in seconds
     */
    updateMountainSound(deltaTime) {
        if (!this.playerObject || !this.gameState.mountainSoundManager) {
            return;
        }

        const mountainManager = this.gameState.mountainSoundManager;
        const playerY = this.playerObject.position.y;

        // Calculate target volume based on player Y position (altitude)
        // Fade in from y = 4.0 to y = 5.5
        const fadeStartY = CONFIG.AUDIO.MOUNTAIN_SOUND_FADE_START_Y;
        const fullVolumeY = CONFIG.AUDIO.MOUNTAIN_SOUND_FULL_VOLUME_Y;
        const maxVolume = CONFIG.AUDIO.MOUNTAIN_SOUND_MAX_VOLUME;

        let targetVolume = 0;

        if (playerY < fadeStartY) {
            // Too low altitude - no sound
            targetVolume = 0;
        } else if (playerY >= fullVolumeY) {
            // High altitude - full volume
            targetVolume = maxVolume;
        } else {
            // In fade range - linear interpolation
            const fadeRange = fullVolumeY - fadeStartY; // 5.5 - 4.0 = 1.5
            const fadeProgress = (playerY - fadeStartY) / fadeRange;
            targetVolume = maxVolume * fadeProgress;
        }

        // Start sound when entering fade zone
        if (targetVolume > 0 && !mountainManager.isPlaying) {
            mountainManager.start();
        }

        // Always update if playing (let volume fade to 0 naturally)
        if (mountainManager.isPlaying) {
            mountainManager.update(deltaTime, targetVolume);
        }

        // Only stop when significantly below fade zone (y < 3.0)
        // This allows natural fade-out to 0 before stopping
        if (playerY < fadeStartY - 1.0 && mountainManager.isPlaying) {
            mountainManager.stop();
        }
    }

    /**
     * Update campfire ambient sound based on distance to nearest active campfire
     * @param {number} deltaTime - Time delta in seconds
     */
    updateCampfireSound(deltaTime) {
        if (!this.playerObject || !this.gameState.campfireSoundManager) {
            return;
        }

        const campfireManager = this.gameState.campfireSoundManager;
        const playerPos = this.playerObject.position;

        // Find nearest active campfire
        let nearestDistance = Infinity;

        for (const [objectId, smokeEffect] of this.smokeEffects.entries()) {
            // Only consider campfires with active smoke (burning firewood)
            if (!smokeEffect.active) continue;

            // Find the campfire object in the scene
            const campfireObject = this.scene.children.find(obj =>
                obj.userData.objectId === objectId
            );

            if (campfireObject) {
                // Calculate 3D distance from player to campfire
                const dx = playerPos.x - campfireObject.position.x;
                const dy = playerPos.y - campfireObject.position.y;
                const dz = playerPos.z - campfireObject.position.z;
                const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

                if (distance < nearestDistance) {
                    nearestDistance = distance;
                }
            }
        }

        // Calculate volume based on nearest campfire distance
        const minDistance = CONFIG.AUDIO.CAMPFIRE_SOUND_MIN_DISTANCE; // 1 unit
        const maxDistance = CONFIG.AUDIO.CAMPFIRE_SOUND_MAX_DISTANCE; // 7 units
        const maxVolume = CONFIG.AUDIO.CAMPFIRE_SOUND_MAX_VOLUME; // 0.2

        let targetVolume = 0;

        if (nearestDistance <= minDistance) {
            // Within minimum distance - full volume
            targetVolume = maxVolume;
        } else if (nearestDistance >= maxDistance) {
            // Beyond maximum distance - no sound
            targetVolume = 0;
        } else {
            // Linear interpolation between min and max distance
            const fadeRange = maxDistance - minDistance; // 7 - 1 = 6
            const fadeProgress = 1.0 - ((nearestDistance - minDistance) / fadeRange);
            targetVolume = maxVolume * fadeProgress;
        }

        // Start sound when near an active campfire
        if (targetVolume > 0 && !campfireManager.isPlaying) {
            campfireManager.start();
        }

        // Always update if playing (let volume fade to 0 naturally)
        if (campfireManager.isPlaying) {
            campfireManager.update(deltaTime, targetVolume);
        }

        // Stop when no active campfires nearby
        if (nearestDistance > maxDistance + 1.0 && campfireManager.isPlaying) {
            campfireManager.stop();
        }
    }

    /**
     * Add smoke effect to a campfire
     * @param {string} objectId - Unique ID for the campfire
     * @param {THREE.Vector3|Object} position - Campfire position {x, y, z}
     */
    addCampfireSmoke(objectId, position) {
        // Don't create duplicate smoke
        if (this.smokeEffects.has(objectId)) {
            console.warn(`Smoke effect already exists for campfire ${objectId}`);
            return;
        }

        const smokeEffect = new SmokeEffect(this.scene, {
            x: position.x,
            y: position.y,
            z: position.z
        });

        // Start with smoke stopped (requires firewood to activate)
        smokeEffect.stop();

        this.smokeEffects.set(objectId, smokeEffect);
        console.log(`Created smoke effect for campfire ${objectId} at (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}) - waiting for firewood`);
    }

    /**
     * Remove smoke effect from a campfire (graceful fadeout)
     * @param {string} objectId - Unique ID for the campfire
     */
    removeCampfireSmoke(objectId) {
        const smokeEffect = this.smokeEffects.get(objectId);
        if (smokeEffect) {
            // Stop spawning new particles, let existing ones fade out
            smokeEffect.stop();
            console.log(`Stopping smoke effect for campfire ${objectId} (will fade out gracefully)`);
            // Note: The smoke effect will be disposed and removed from the map
            // automatically in the game loop once all particles have faded out
        }
    }

    /**
     * Remove all smoke effects (useful for cleanup or chunk unloading)
     */
    removeAllSmoke() {
        for (const [objectId, smokeEffect] of this.smokeEffects.entries()) {
            smokeEffect.dispose();
        }
        this.smokeEffects.clear();
        console.log('Removed all smoke effects');
    }
}

// ==========================================
// INITIALIZATION
// ==========================================

// Wait for models to load before starting game
modelManager.loadAllModels().then(async () => {
    const game = new MultiplayerGame();
    window.game = game; // Expose for debugging

    // Wait for game initialization to complete before starting
    await game.initPromise;

    game.start();
}).catch(error => {
    console.error('Failed to load models:', error);
    alert('Failed to load game models. Please refresh the page.');
});
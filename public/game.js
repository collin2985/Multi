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
import { AudioManager } from './audio.js';
import { AIEnemy } from './ai-enemy.js';
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
import { MessageRouter } from './network/MessageRouter.js';
import { PhysicsManager, COLLISION_GROUPS } from './core/PhysicsManager.js';

// ==========================================
// MAIN GAME CLASS
// ==========================================

class MultiplayerGame {
    constructor() {
        this.gameState = new GameState();

        // Sensor-based proximity tracking (objectId -> THREE.Object3D)
        this.activeProximityObjects = new Map();

        // Bounding box collision tracking (for debug logging)
        this.activeBoundingBoxCollisions = new Set();

        // Initialize core systems
        this.sceneManager = new SceneManager();
        this.sceneManager.initialize();
        this.scene = this.sceneManager.getScene();
        this.camera = this.sceneManager.getCamera();
        this.renderer = this.sceneManager.getRenderer();

        // Initialize game loop
        this.gameLoop = new GameLoop();

        // Initialize camera controller
        this.cameraController = new CameraController(this.camera);

        // Initialize input manager
        this.inputManager = new InputManager(this.camera);

        // Initialize physics manager (will be initialized async)
        this.physicsManager = new PhysicsManager(this.scene);

        // Foundation validation now handled by BuildMenu module
        // Kept for backward compatibility if needed
        this.validationThrottleTimeout = null;

        // Initialize AI enemy properties (will be managed by aiEnemyManager)
        this.tentAIEnemies = null;
        this.aiEnemyController = null;
        this.aiEnemy = null;

        // Initialize game (async) and store promise
        this.initPromise = this.init();
    }

    async init() {
        // Initialize physics
        await this.physicsManager.initialize();

        // Set physics manager on objectPlacer for collider registration
        objectPlacer.setPhysicsManager(this.physicsManager);

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

        // Player scale
        this.playerScale = 0.0325; // 30% bigger than 0.025

        // Animation support
        this.animationMixer = null;
        this.animationAction = null;
        this.shootAction = null;

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
        this.waterRenderer = new WaterRenderer(this.scene, CONFIG.WATER.LEVEL, this.terrainRenderer, this.sceneManager);
        this.terrainRenderer.setWaterRenderer(this.waterRenderer);

        this.chunkManager = new ChunkManager(
            this.gameState,
            this.terrainRenderer,
            this.scene,
            this
        );

        // Initialize StructureManager for building placement
        this.structureManager = new StructureManager(this.scene, this.terrainRenderer, this.physicsManager);

        // Initialize PlayerController after terrainRenderer is created
        this.playerController = new PlayerController(this.playerObject, this.terrainRenderer, this.physicsManager);

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

            console.log(`[PHYSICS] Created character controller for player at (${playerPosition.x.toFixed(2)}, ${playerPosition.y.toFixed(2)}, ${playerPosition.z.toFixed(2)})`);
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
            ui.updateButtonStates(this.gameState.isInChunk, this.gameState.nearestObject, hasAxe, hasSaw, isOnCooldown, this.gameState.nearestConstructionSite, this.gameState.isMoving, this.gameState.nearestStructure, hasHammer, this.gameState.nearWater, hasFishingNet);
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

        // Load and setup player model
        this.setupPlayerModel();

        // Initialize InventoryUI with all dependencies
        this.inventoryUI = new InventoryUI(this.gameState, this);

        // Initialize PlayerHunger system (starts at spawn)
        this.playerHunger = new PlayerHunger(this.playerInventory, ui, this.inventoryUI, this);
        console.log('[Game] PlayerHunger system initialized');

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
        const treeTypes = ['oak', 'fir', 'pine', 'cypress'];
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

        // Handle chiseling completion
        if (actionType === 'chiseling') {
            // Delegate to CraftingSystem
            this.craftingSystem.completeChiselingAction(this.gameState.activeAction);
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
            ui.updateButtonStates(this.gameState.isInChunk, this.gameState.nearestObject, hasAxe, hasSaw, isOnCooldown, this.gameState.nearestConstructionSite, this.gameState.isMoving, this.gameState.nearestStructure, hasHammer, this.gameState.nearWater, hasFishingNet);

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

            // Check proximity every 3 frames (20 FPS) to reduce physics overhead
            // Processing 500-700 sensors every frame was causing 10-20 FPS loss
            if (this.gameLoop.frameCount % 3 === 0) {
                this.checkProximityToObjects();
            }

            // Update all tent AI enemies
            this.aiEnemyManager.updateTentAIEnemies(deltaTime, now);

            // Periodically check for new tent spawns (every 3 seconds at 60fps)
            if (this.gameLoop.frameCount % 180 === 0) {
                this.aiEnemyManager.trySpawnAI(this.playerObject, this.isDead);
            }

            // Update player combat/shooting - delegate to PlayerCombat
            this.playerCombat.updateShooting(
                this.aiEnemy,
                this.aiEnemyController,
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
                        if (target.isLocal) {
                            if (this.aiEnemyController) {
                                this.aiEnemyController.kill();
                            }
                        }
                        // If target is peer's AI, they will handle the death from the broadcast
                    }
                },
                () => {
                    this.gameState.isMoving = false;
                    this.playerController.stopMovement();
                }
            );
            this.updateChoppingAction();

            // Update animated objects (ships, etc.)
            this.animationSystem.update(deltaTime);

            // Update player animation
            if (this.isDead) {
                this.deathSystem.updateDeathAnimation(this.playerObject, this.deathStartTime, deltaTime, this.fallDirection, true);
            } else if (this.animationMixer) {
                const isShootPlaying = this.shootAction && this.shootAction.isRunning();

                if (this.gameState.activeAction) {
                    // Ensure walk animation is stopped and chopping is playing
                    if (this.animationAction && this.animationAction.isRunning()) {
                        this.animationAction.stop();
                    }
                    if (this.choppingAction && !this.choppingAction.isRunning()) {
                        this.choppingAction.play();
                    }
                    this.animationMixer.update((deltaTime / 1000) * 1.5);
                } else if (isShootPlaying) {
                    this.animationMixer.update((deltaTime / 1000) * 3);
                } else if (this.playerCombat.getInCombatStance()) {
                    if (this.shootAction) {
                        this.shootAction.paused = false;
                        this.shootAction.time = 0;
                        this.shootAction.weight = 1.0;
                        if (!this.shootAction.isRunning()) {
                            this.shootAction.play();
                        }
                        this.shootAction.paused = true;
                    }

                    if (this.gameState.isMoving) {
                        // Make sure walk animation is playing
                        if (this.animationAction && !this.animationAction.isRunning()) {
                            this.animationAction.play();
                        }
                        this.animationMixer.update((deltaTime / 1000) * 2.5);
                    } else {
                        this.animationMixer.update(0);
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

                    if (this.gameState.isMoving) {
                        // Make sure walk animation is playing
                        if (this.animationAction && !this.animationAction.isRunning()) {
                            this.animationAction.play();
                        }
                        this.animationMixer.update((deltaTime / 1000) * 2.5);
                    } else {
                        this.animationMixer.setTime(0);
                    }
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

            // Update camera to follow player
            this.cameraController.setTarget(this.playerObject);
            this.cameraController.update(deltaTime);

            this.runPeriodicChecks(now);

            // Process chunk creation queue (only if work pending)
            if (this.chunkManager.pendingChunkCreations.length > 0) {
                this.chunkManager.processChunkQueue();
            }

            // Process vertex updates (only if work pending)
            const playerPos = this.playerObject ? this.playerObject.position : null;
            if (this.terrainRenderer.pendingVertexUpdates.length > 0) {
                this.terrainRenderer.processVertexUpdateQueue(playerPos);
            }

            // Process object generation queue (only if work pending)
            if (this.terrainRenderer.pendingObjectGeneration.length > 0) {
                this.terrainRenderer.processObjectGenerationQueue();
            }

            // Cull blob shadows beyond 50 units (check every 10 frames to save CPU)
            if (this.gameLoop.frameCount % 10 === 0 && playerPos) {
                this.cullDistantShadows(playerPos);
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
                    newChunkId: `chunk_${currentPlayerChunkX},${currentPlayerChunkZ}`,
                    lastChunkId: `chunk_${lastChunkX},${lastChunkZ}`
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
        const maxDistance = 50;
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
            // Get object ID from collider handle
            const objectId = this.physicsManager.getObjectIdFromCollider(colliderHandle);
            if (!objectId) return;

            // Find the actual THREE.js object in the scene
            let sceneObject = null;
            this.scene.traverse((object) => {
                if (object.userData && !object.userData.isBoundingBox && object.userData.objectId === objectId) {
                    sceneObject = object;
                }
            });

            if (sceneObject) {
                this.activeProximityObjects.set(objectId, sceneObject);
            }
        });

        // Find nearest objects by type from active proximity objects
        const treeTypes = ['oak', 'oak2', 'pine', 'pine2', 'fir', 'cypress'];
        const rockTypes = ['limestone', 'sandstone', 'clay'];
        const structureTypes = ['crate', 'tent', 'house', 'garden', 'market', 'outpost', 'ship', 'dock'];

        let nearestNaturalObject = null;
        let nearestNaturalDistance = Infinity;
        let nearestConstructionSite = null;
        let nearestConstructionDistance = Infinity;
        let nearestStructure = null;
        let nearestStructureDistance = Infinity;

        // Calculate distances to all active proximity objects
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
            const distance = Math.sqrt(dx * dx + dz * dz);

            // Categorize and track nearest of each type
            if (object.userData.isConstructionSite) {
                if (distance < nearestConstructionDistance) {
                    nearestConstructionDistance = distance;
                    nearestConstructionSite = object;
                }
            } else if (structureTypes.includes(modelType)) {
                if (distance < nearestStructureDistance) {
                    nearestStructureDistance = distance;
                    nearestStructure = object;
                }
            } else if (treeTypes.includes(modelType) || rockTypes.includes(modelType) ||
                       modelType === 'log' || modelType.endsWith('_log')) {
                if (distance < nearestNaturalDistance) {
                    nearestNaturalDistance = distance;
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
            this.gameState.nearestObjectDistance = nearestNaturalDistance;
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
            hasFishingNet
        );
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
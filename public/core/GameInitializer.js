
import * as THREE from 'three';
import { CONFIG, COMPUTED } from '../config.js';
import { ui } from '../ui.js';
import { objectPlacer, modelManager } from '../objects.js';
import { BillboardSystem } from '../BillboardSystem.js';
import { FallingTreeSystem } from '../systems/FallingTreeSystem.js';

import { RockModelSystem } from '../RockModelSystem.js';
import { StructureModelSystem } from '../systems/StructureModelSystem.js';
// import { TreeGUI } from '../TreeGUI.js';
import { AudioManager, OceanSoundManager, PlainsSoundManager, MountainSoundManager, CampfireSoundManager, BuildingFireSoundManager } from '../audio.js';
import { NetworkManager } from '../network/NetworkManager.js';
import { SceneManager } from './SceneManager.js';
import { CameraController } from './CameraController.js';
import { InputManager } from './InputManager.js';
import { PlayerController } from '../player/PlayerController.js';
import { PlayerInventory } from '../player/PlayerInventory.js';
import { PlayerActions } from '../player/PlayerActions.js';
import { PlayerCombat } from '../player/PlayerCombat.js';
import { DeathSystem } from '../entity/DeathSystem.js';
import { ChunkManager } from '../world/ChunkManager.js';
import { StructureManager } from '../world/StructureManager.js';
import { ChunkObjectGenerator } from '../systems/ChunkObjectGenerator.js';
import { AvatarManager } from '../entity/AvatarManager.js';
import { AIEnemyManager } from '../entity/AIEnemyManager.js';
import { TerrainGenerator, GeometryClipmap, DepthTextureSystem, WaterSystem, TERRAIN_CONFIG } from '../terrainsystem.js';
import { DirtOverlaySystem } from '../systems/DirtOverlaySystem.js';
import { NavigationManager } from '../navigation/NavigationManager.js';
import { AuthClient } from '../network/AuthClient.js';
import { LoginModal } from '../ui/LoginModal.js';
import { MessageRouter } from '../network/MessageRouter.js';
import { LoadingScreen } from '../ui/LoadingScreen.js';
import { showGPUWarningIfNeeded } from '../ui/GPUWarningModal.js';
import { AIController } from '../ai/AIController.js';
import { DeerController } from '../ai/DeerController.js';
import { DeerManager } from '../entity/DeerManager.js';
import { BrownBearController } from '../ai/BrownBearController.js';
import { BrownBearManager } from '../entity/BrownBearManager.js';
import { bakerController } from '../ai/BakerController.js';
import { gardenerController } from '../ai/GardenerController.js';
import { woodcutterController } from '../ai/WoodcutterController.js';
import { minerController } from '../ai/MinerController.js';
import { stoneMasonController } from '../ai/StoneMasonController.js';
import { ironWorkerController } from '../ai/IronWorkerController.js';
import { tileWorkerController } from '../ai/TileWorkerController.js';
import { blacksmithController } from '../ai/BlacksmithController.js';
import { fishermanController } from '../ai/FishermanController.js';
import { AIRegistry } from '../ai/AIRegistry.js';
import { NameTagManager } from '../entity/NameTagManager.js';
import { findPath } from '../navigation/AStar.js';
import { TickManager } from './TickManager.js';
import { setTerrainGenerator } from './TerrainAccess.js';

/**
 * GameInitializer
 * Handles the initialization phase of the game to keep the main Game class clean.
 */
export class GameInitializer {
    constructor(game) {
        this.game = game;
    }

    async init() {
        // PHASE 1: Minimal setup for auth/spawn selection

        // Initialize LoadingScreen early - it's already visible in HTML
        this.game.loadingScreen = new LoadingScreen(this.game);
        this.game.loadingScreen.initialize();
        this.game.loadingScreen.setConnecting();

        // Initialize SceneManager (including skybox loading)
        await this.game.sceneManager.initialize();

        // Get references after initialization
        this.game.scene = this.game.sceneManager.getScene();
        this.game.camera = this.game.sceneManager.getCamera();
        this.game.renderer = this.game.sceneManager.getRenderer();

        // Check for integrated GPU and warn user if detected
        showGPUWarningIfNeeded(this.game.renderer);

        // Store game reference in scene for object removal handling
        this.game.scene.userData.game = this.game;

        // Initialize controllers now that camera and scene are ready
        this.game.cameraController = new CameraController(this.game.camera);
        this.game.inputManager = new InputManager(this.game.camera);

        // Set scene on physics manager and initialize
        this.game.physicsManager.scene = this.game.scene;
        await this.game.physicsManager.initialize();

        // Pre-warm collider pools for vehicle boarding/disembarking
        this.game.physicsManager.warmPools();

        // Apply quality settings early - BillboardSystem and RockModelSystem need these at construction
        const quality = this.game.gameState.loadQualitySetting();
        const qualityConfig = CONFIG.QUALITY[quality];
        TERRAIN_CONFIG.BILLBOARD_MAX_INSTANCES = qualityConfig.BILLBOARD_MAX_INSTANCES;
        CONFIG.ROCK_MODEL_MAX_INSTANCES = qualityConfig.ROCK_MODEL_MAX_INSTANCES;
        CONFIG.TREE_MODEL_MAX_INSTANCES = qualityConfig.TREE_MODEL_MAX_INSTANCES;
        CONFIG.TREE_MODELS_ENABLED = qualityConfig.TREE_MODELS_ENABLED;

        // Initialize billboard system for tree LOD
        this.game.billboardSystem = new BillboardSystem(this.game.scene);

        // Initialize falling tree animation system
        this.game.fallingTreeSystem = new FallingTreeSystem(this.game.scene);

        // Initialize rock model system for 3D rock LOD (limestone, sandstone, clay, + trees on HIGH)
        this.game.rockModelSystem = new RockModelSystem(this.game.scene, qualityConfig.TREE_MODELS_ENABLED);

        // Initialize structure model system for 3D structure LOD (tent, outpost, campfire, horse)
        this.game.structureModelSystem = new StructureModelSystem(this.game.scene);

        // Initialize tree debug GUI (for adjusting billboard/model parameters)
        // Note: TreeGUI is created in finalizeNetworking after deerManager is available

        // Set physics manager on objectPlacer for collider registration
        objectPlacer.setPhysicsManager(this.game.physicsManager);
        objectPlacer.setBillboardSystem(this.game.billboardSystem);
        objectPlacer.setRockModelSystem(this.game.rockModelSystem);
        this.game.billboardSystem.setWorkingModelTypes(this.game.rockModelSystem.workingModelTypes);
        this.game.rockModelSystem.billboardSystem = this.game.billboardSystem;

        // Setup networking first - needed for auth
        this.setupNetworking();

        // Initialize message router early (needed for auth response routing)
        this.game.messageRouter = new MessageRouter(this.game);

        // Connect to server and wait for connection before proceeding
        await this.game.connectAndWait();

        // Update loading screen to show connected state
        this.game.loadingScreen.setConnected();

        // Start a temporary message processing interval for auth phase
        this.game.authMessageInterval = setInterval(() => {
            if (this.game.networkManager) {
                this.game.networkManager.processMessageQueue();
            }
        }, 100);

        // Mark as ready for auth flow
        this.game.isReadyForAuth = true;
    }

    setupNetworking() {
        this.game.networkManager = new NetworkManager(
            this.game.gameState,
            this.game.handleServerMessage.bind(this.game)
        );

        // Set game reference for creating peer AI enemies
        this.game.networkManager.setGame(this.game);

        // Set scene reference for adding peer AI enemies
        this.game.networkManager.setScene(this.game.scene);

        // Set audio manager reference in NetworkManager for P2P sounds
        // Note: Audio manager might not be initialized yet, it will be set later in setupScene
        // or we can initialize it here if needed, but it depends on camera which is ready.
        // Actually setupScene initializes audioManager.

        // Initialize AuthClient for authentication
        this.game.authClient = new AuthClient(this.game.networkManager);

        // Initialize LoginModal
        this.game.loginModal = new LoginModal(this.game.gameState, this.game.authClient);

        // Initialize AvatarManager for peer player avatars
        // Note: structureManager and terrainGenerator are not ready yet. 
        // They are initialized in setupRenderers. AvatarManager needs them.
        // We should defer AvatarManager initialization or pass nulls and set them later.
        // Looking at original code, setupNetworking was called in init(), but setupRenderers in initializeWithSpawn().
        // So AvatarManager was created with undefined dependencies?
        // Original code: 
        // this.avatarManager = new AvatarManager(..., this.structureManager, this.terrainGenerator, ...);
        // In init(), structureManager is undefined.
        // This implies AvatarManager handles missing dependencies or they are set later.
        // However, AvatarManager constructor assigns them.
        // Let's look at AvatarManager.
    }
    
    // Helper to complete initialization
    async setupComponents(spawnX, spawnZ) {
        // Create terrain generator FIRST so we can get correct spawn height
        this.game.terrainGenerator = new TerrainGenerator(TERRAIN_CONFIG.SEED || 12345);
        setTerrainGenerator(this.game.terrainGenerator); // Register globally for easy access

        // Set terrain generator on billboard system for coarse height sampling
        if (this.game.billboardSystem) {
            this.game.billboardSystem.terrainGenerator = this.game.terrainGenerator;
        }

        this.setupScene(spawnX, spawnZ);
        this.setupPlayer();
        this.setupRenderers();

        // Now we can fully initialize network dependent components that need renderer/structure manager
        await this.finalizeNetworking();

        this.game.setupInput();
        this.game.setupUI();
    }

    setupScene(spawnX, spawnZ) {
        // Create player object with correct terrain height (no more frame-delay settling)
        this.game.playerObject = new THREE.Group();
        const spawnY = this.game.terrainGenerator.getWorldHeight(spawnX, spawnZ) + 0.03;
        this.game.playerObject.position.set(spawnX, spawnY, spawnZ);
        this.game.playerObject.rotation.y = Math.PI; // Face North (+Z direction)
        this.game.scene.add(this.game.playerObject);

        // Set player metadata
        this.game.playerObject.userData.objectId = 'player_' + this.game.gameState.clientId;
        this.game.playerObject.userData.modelType = 'player';

        // Add to objectRegistry
        this.game.objectRegistry.set(this.game.playerObject.userData.objectId, this.game.playerObject);

        // Player scale
        this.game.playerScale = 1;

        // Animation support
        this.game.animationMixer = null;
        this.game.animationAction = null;
        this.game.shootAction = null;
        this.game.idleAction = null;
        this.game.combatAction = null;

        // AI Enemy
        this.game.aiEnemy = null;

        // Death state
        this.game.isDead = false;
        this.game.deathStartTime = 0;
        this.game.deathRotationProgress = 0;
        this.game.fallDirection = 1;

        // Player shooting state
        this.game.playerShootTarget = null;
        this.game.playerLastShootTime = 0;
        this.game.playerShootInterval = 6000;
        this.game.playerLastTargetCheckTime = 0;

        // Initialize audio manager
        this.game.audioManager = new AudioManager(this.game.camera);
        this.game.audioManager.loadSounds();
        
        // Update NetworkManager with audio manager
        if (this.game.networkManager) {
            this.game.networkManager.setAudioManager(this.game.audioManager);
        }

        // Initialize sound managers
        this.game.gameState.oceanSoundManager = new OceanSoundManager(this.game.audioManager);
        this.game.gameState.plainsSoundManager = new PlainsSoundManager(this.game.audioManager);
        this.game.gameState.mountainSoundManager = new MountainSoundManager(this.game.audioManager);
        this.game.gameState.campfireSoundManager = new CampfireSoundManager(this.game.audioManager);
        this.game.gameState.buildingFireSoundManager = new BuildingFireSoundManager(this.game.audioManager);
    }

    setupPlayer() {
        // Initialize player inventory
        this.game.playerInventory = new PlayerInventory(
            this.game.gameState.inventory.rows,
            this.game.gameState.inventory.cols
        );
        this.game.playerInventory.itemsRef = this.game.gameState.inventory.items;

        // Initialize player actions
        this.game.playerActions = new PlayerActions(
            this.game.playerInventory,
            this.game.audioManager,
            this.game.animationMixer
        );

        // Initialize player combat
        this.game.playerCombat = new PlayerCombat(
            this.game.playerObject,
            this.game.audioManager
        );

        // Set game state reference for ammo tracking
        this.game.playerCombat.setGameState(this.game.gameState);

        // Set game reference for faction player targeting
        this.game.playerCombat.setGame(this.game);

        // Set effect manager reference for gunsmoke
        if (this.game.effectManager) {
            this.game.playerCombat.setEffectManager(this.game.effectManager);
        }

        // Set up death callback to sync game state
        // Note: This callback is triggered from PlayerCombat.die() which may be called
        // from DeathManager.killEntity() (which already sets deathReason) or directly
        // from combat damage. Only set 'Killed by bandit' if no reason is already set.
        this.game.playerCombat.onDeath(() => {
            this.game.isDead = true;
            this.game.deathStartTime = Date.now();
            this.game.fallDirection = Math.random() < 0.5 ? -1 : 1;

            // Only set death reason if not already set by DeathManager
            if (!this.game.deathReason) {
                this.game.deathReason = 'Killed by bandit';
            }

            // Broadcast death to peers
            this.game.networkManager.broadcastP2P({
                type: 'player_death',
                payload: {
                    position: this.game.playerObject.position.toArray()
                }
            });

            // Show death screen after death animation completes (500ms)
            setTimeout(() => {
                if (this.game.deathScreen) {
                    this.game.deathScreen.show(this.game.deathReason || 'Killed by bandit');
                }
            }, 500);
        });

        // Initialize death system
        this.game.deathSystem = new DeathSystem();
    }

    setupRenderers() {
        // Terrain generator already created in setupComponents for spawn height calculation
        // Create clipmap renderer using existing terrainGenerator
        this.game.clipmap = new GeometryClipmap(this.game.scene, this.game.terrainGenerator);

        // New water system
        this.game.depthSystem = new DepthTextureSystem(
            this.game.terrainGenerator,
            this.game.sceneManager.renderer
        );

        // Load foam texture for water system
        const textureLoader = new THREE.TextureLoader();
        const foamTexture = textureLoader.load('./terrain/foam.png');
        foamTexture.wrapS = THREE.RepeatWrapping;
        foamTexture.wrapT = THREE.RepeatWrapping;
        foamTexture.minFilter = THREE.LinearMipmapLinearFilter;
        foamTexture.magFilter = THREE.LinearFilter;

        this.game.waterSystem = new WaterSystem(
            this.game.scene,
            this.game.depthSystem,
            foamTexture
        );

        // Connect sky sun direction and environment map to terrain and water
        if (this.game.sceneManager.skyManager) {
            const skyManager = this.game.sceneManager.skyManager;

            // Connect sun direction changes
            skyManager.onSunChange((sunDirection) => {
                this.game.clipmap.setSunDirection(sunDirection);
                this.game.waterSystem.setSunDirection(sunDirection);

                // NOTE: PMREMGenerator creates equirectangular 2D textures, not cube textures.
                // Water shader uses samplerCube which is incompatible, causing WebGL errors.
                // Water has fallback sky color blending so envMap is not essential.
            });
        }

        this.game.navigationManager = new NavigationManager(this.game.physicsManager);
        this.game.navigationManager.setScene(this.game.scene);

        this.game.chunkManager = new ChunkManager(
            this.game.gameState,
            this.game.terrainGenerator,  // Pass terrainGenerator instead of terrainRenderer
            this.game.scene,
            this.game
        );

        // Wire up chunk loading callback for loading screen progress
        this.game.chunkManager.onChunkLoaded = (chunkKey) => {
            if (this.game.loadingScreen) {
                this.game.loadingScreen.onChunkLoaded();
            }
        };

        // Create dirt overlay system for painting dirt under structures/trees
        // Pass game reference so it can access billboardSystem, rockModelSystem, etc.
        this.game.dirtOverlay = new DirtOverlaySystem(this.game.chunkManager, this.game);
        this.game.clipmap.setDirtOverlay(this.game.dirtOverlay);

        // Create object generator for natural objects (trees, rocks, etc.)
        this.game.chunkObjectGenerator = new ChunkObjectGenerator(
            this.game.scene,
            this.game.terrainGenerator,
            this.game.gameState,
            this.game.chunkManager
        );

        this.game.structureManager = new StructureManager(this.game.scene, this.game.terrainGenerator, this.game.physicsManager);

        this.game.playerController = new PlayerController(
            this.game.playerObject,
            this.game.terrainGenerator,  // Pass terrainGenerator instead of terrainRenderer
            this.game.physicsManager,
            this.game.navigationManager,
            this.game
        );

        // Create physics character controller
        if (this.game.physicsManager && this.game.physicsManager.initialized) {
            const playerObjectId = this.game.playerObject.userData.objectId || 'player';
            const playerPosition = this.game.playerObject.position;
            this.game.physicsManager.createCharacterController(
                playerObjectId,
                0.1,
                0.3,
                playerPosition
            );
        }

        // Connect gameState to PlayerController for vehicle state access
        this.game.playerController.gameState = this.game.gameState;
        // Connect inputManager to PlayerController for auto-run state
        this.game.playerController.setInputManager(this.game.inputManager);

        // Set navigationManager on MobileEntitySystem for road speed bonus
        if (this.game.mobileEntitySystem && this.game.navigationManager) {
            this.game.mobileEntitySystem.setNavigationManager(this.game.navigationManager);
        }

        // Setup player callbacks (moved logic to GameInitializer to avoid duplication code)
        this.setupPlayerCallbacks();
    }
    
    async finalizeNetworking() {
        // Initialize navigation worker for async pathfinding
        if (this.game.navigationManager) {
            await this.game.navigationManager.initializeWorker();
        }

        // Initialize AvatarManager
        this.game.avatarManager = new AvatarManager(
            this.game.scene,
            this.game.networkManager,
            this.game.structureManager,
            this.game.terrainGenerator,
            modelManager,
            this.game.navigationManager,
            this.game.playerScale
        );
        this.game.avatarManager.setCamera(this.game.camera);
        if (this.game.effectManager) {
            this.game.avatarManager.setEffectManager(this.game.effectManager);
        }

        // Initialize AIEnemyManager
        this.game.aiEnemyManager = new AIEnemyManager(
            this.game.scene,
            this.game.networkManager,
            this.game.structureManager,
            this.game.terrainGenerator
        );
        this.game.aiEnemyManager.setGameReference(this.game);

        // Backward compatibility references
        this.game.tentAIEnemies = this.game.aiEnemyManager.tentAIEnemies;
        this.game.aiEnemyController = this.game.aiEnemyManager.aiEnemyController;
        this.game.aiEnemy = this.game.aiEnemyManager.aiEnemy;

        // Initialize TickManager for deterministic simulation sync
        this.initializeTickManager();

        // Create AI Registry for cross-controller communication
        this.game.aiRegistry = new AIRegistry();

        // Initialize BanditController (simplified deterministic AI)
        this.initializeBanditController();
        this.game.aiRegistry.register('bandit', this.game.banditController);

        // Initialize DeerController (ambient deer AI)
        this.initializeDeerController();
        this.game.aiRegistry.register('deer', this.game.deerController);

        // Initialize BrownBearController (brown bear AI from dens)
        this.initializeBrownBearController();
        this.game.aiRegistry.register('brownbear', this.game.brownBearController);

        // Initialize BakerController (baker NPCs at bakeries)
        this.initializeBakerController();

        // Initialize GardenerController (gardener NPCs at gardener buildings)
        this.initializeGardenerController();

        // Initialize WoodcutterController (woodcutter NPCs at woodcutter buildings)
        this.initializeWoodcutterController();

        // Initialize MinerController (miner NPCs at miner buildings)
        this.initializeMinerController();

        // Initialize StoneMasonController (stonemason NPCs at stonemason buildings)
        this.initializeStoneMasonController();

        // Initialize IronWorkerController (iron worker NPCs at ironworks)
        this.initializeIronWorkerController();

        // Initialize TileWorkerController (tile worker NPCs at tileworks)
        this.initializeTileWorkerController();

        // Initialize BlacksmithController (blacksmith NPCs at blacksmith buildings)
        this.initializeBlacksmithController();

        // Initialize FishermanController (fisherman NPCs at fisherman structures)
        this.initializeFishermanController();

        // Initialize debug GUI (after deerManager is available)
        // this.game.treeGUI = new TreeGUI(
        //     this.game.billboardSystem,
        //     this.game.deerManager,
        //     this.game.waterSystem,
        //     this.game.messageRouter?.sceneObjectFactory,
        //     this.game.rockModelSystem,
        //     this.game.structureModelSystem
        // );
    }

    /**
     * Initialize TickManager for deterministic P2P simulation
     */
    initializeTickManager() {
        this.game.tickManager = new TickManager();

        this.game.tickManager.initialize({
            localPlayerId: this.game.gameState.clientId,

            getLocalPlayerPosition: () => {
                if (this.game.playerObject && !this.game.playerCombat?.isDead) {
                    return {
                        x: this.game.playerObject.position.x,
                        y: this.game.playerObject.position.y,
                        z: this.game.playerObject.position.z
                    };
                }
                return null;
            },

            getPeerPositions: () => {
                const positions = new Map();
                if (this.game.networkManager?.avatars) {
                    for (const [peerId, avatar] of this.game.networkManager.avatars) {
                        if (avatar && avatar.position && !avatar.userData?.isDead) {
                            positions.set(peerId, {
                                x: avatar.position.x,
                                y: avatar.position.y,
                                z: avatar.position.z
                            });
                        }
                    }
                }
                return positions;
            }
        });

    }

    /**
     * Initialize the BanditController for bandit AI
     */
    initializeBanditController() {
        this.game.banditController = new AIController();

        this.game.banditController.initialize({
            clientId: this.game.gameState.clientId,

            getPlayersInChunks: (chunkKeys) => {
                return this.game.gameState.getPlayersInChunks(chunkKeys);
            },

            getPlayerPosition: (playerId) => {
                // Local player
                if (playerId === this.game.gameState.clientId && this.game.playerObject) {
                    // Skip if local player is dead
                    if (this.game.playerCombat?.isDead) {
                        return null;
                    }
                    return {
                        x: this.game.playerObject.position.x,
                        y: this.game.playerObject.position.y,
                        z: this.game.playerObject.position.z
                    };
                }
                // Peer player
                const avatar = this.game.networkManager.avatars.get(playerId);
                if (avatar && avatar.position) {
                    // Skip if peer is dead
                    if (avatar.userData?.isDead) {
                        return null;
                    }
                    return {
                        x: avatar.position.x,
                        y: avatar.position.y,
                        z: avatar.position.z
                    };
                }
                return null;
            },

            getBanditStructures: (chunkKey) => {
                return this.game.gameState.getBanditStructuresInChunk(chunkKey);
            },

            getMilitiaStructures: (chunkKey) => {
                const militiaStructures = [];
                const addedIds = new Set();
                const worldPos = new THREE.Vector3();

                // 1. Get tent/outpost militia from registry (reliable, like bandits)
                const registeredStructures = this.game.gameState.getMilitiaStructuresInChunk(chunkKey);
                for (const struct of registeredStructures) {
                    if (!addedIds.has(struct.id)) {
                        militiaStructures.push({
                            id: struct.id,
                            position: struct.position,
                            militiaOwner: struct.militiaOwner,
                            militiaFaction: struct.militiaFaction,
                            militiaType: struct.militiaType
                        });
                        addedIds.add(struct.id);
                    }
                }

                // 2. FALLBACK: Scan chunkObjects for ANY structure with hasMilitia
                //    This catches:
                //    - Ground artillery (completely missing before!)
                //    - Tent/outpost that failed to register for some reason
                const chunkObjects = this.game.chunkManager?.chunkObjects?.get(chunkKey);
                if (chunkObjects) {
                    for (const obj of chunkObjects) {
                        // Skip if already found via registry
                        if (addedIds.has(obj.userData?.objectId)) continue;

                        // Check for hasMilitia flag
                        if (!obj.userData?.hasMilitia) continue;

                        // Only process tent, outpost, and artillery
                        const modelType = obj.userData?.modelType;
                        if (modelType !== 'tent' && modelType !== 'outpost' && modelType !== 'artillery') continue;

                        // Determine militia type
                        let militiaType;
                        if (modelType === 'artillery') {
                            militiaType = obj.userData.militiaType || 'artilleryMilitia';
                        } else if (modelType === 'outpost') {
                            militiaType = obj.userData.militiaType || 'outpostMilitia';
                        } else {
                            militiaType = obj.userData.militiaType || 'militia';
                        }

                        // Get world position
                        obj.getWorldPosition(worldPos);

                        militiaStructures.push({
                            id: obj.userData.objectId,
                            position: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
                            militiaOwner: obj.userData.militiaOwner,
                            militiaFaction: obj.userData.militiaFaction,
                            militiaType: militiaType
                        });
                        addedIds.add(obj.userData.objectId);
                    }
                }

                // 3. Artillery militia - keep dynamic lookup (mobile, can be on ships/towed)
                // Search ship-parented artillery (loaded on ships)
                // Check local player's ship artillery
                const shipArtillery = this.game.gameState?.vehicleState?.shipArtillery || [];
                for (const artData of shipArtillery) {
                    if (artData.hasMilitia && artData.mesh && !addedIds.has(artData.artilleryId)) {
                        artData.mesh.getWorldPosition(worldPos);
                        militiaStructures.push({
                            id: artData.artilleryId,
                            position: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
                            militiaOwner: artData.militiaOwner,
                            militiaFaction: artData.militiaFaction,
                            militiaType: artData.militiaType || 'artilleryMilitia'
                        });
                        addedIds.add(artData.artilleryId);
                    }
                }

                // 4. Peer ship artillery (removed from chunkObjects when peer loads it)
                const peerGameData = this.game.networkManager?.peerGameData;
                if (peerGameData) {
                    for (const [peerId, peerData] of peerGameData) {
                        const peerArtillery = peerData.loadedArtillery;
                        if (peerArtillery) {
                            for (const artData of peerArtillery) {
                                if (artData.hasMilitia && artData.mesh && !addedIds.has(artData.artilleryId)) {
                                    artData.mesh.getWorldPosition(worldPos);
                                    militiaStructures.push({
                                        id: artData.artilleryId,
                                        position: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
                                        militiaOwner: artData.militiaOwner,
                                        militiaFaction: artData.militiaFaction,
                                        militiaType: artData.militiaType || 'artilleryMilitia'
                                    });
                                    addedIds.add(artData.artilleryId);
                                }
                            }
                        }
                    }
                }

                // 5. Local player's towed artillery
                const towedEntity = this.game.gameState?.vehicleState?.towedEntity;
                if (towedEntity?.type === 'artillery' && towedEntity?.isAttached && towedEntity?.mesh) {
                    const artilleryData = towedEntity.mesh.userData;
                    if (artilleryData?.hasMilitia && !addedIds.has(towedEntity.id)) {
                        towedEntity.mesh.getWorldPosition(worldPos);
                        militiaStructures.push({
                            id: towedEntity.id,
                            position: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
                            militiaOwner: artilleryData.militiaOwner,
                            militiaFaction: artilleryData.militiaFaction,
                            militiaType: artilleryData.militiaType || 'artilleryMilitia'
                        });
                        addedIds.add(towedEntity.id);
                    }
                }

                // 6. Peer towed artillery
                if (peerGameData) {
                    for (const [peerId, peerData] of peerGameData) {
                        if (peerData.towedArtillery?.mesh && !addedIds.has(peerData.towedArtillery.artilleryId)) {
                            const artData = peerData.towedArtillery;
                            if (artData.hasMilitia) {
                                artData.mesh.getWorldPosition(worldPos);
                                militiaStructures.push({
                                    id: artData.artilleryId,
                                    position: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
                                    militiaOwner: artData.militiaOwner,
                                    militiaFaction: artData.militiaFaction,
                                    militiaType: artData.militiaType || 'artilleryMilitia'
                                });
                                addedIds.add(artData.artilleryId);
                            }
                        }
                    }
                }

                return militiaStructures;
            },

            getTerrainHeight: (x, z) => {
                if (this.game.terrainGenerator) {
                    return this.game.terrainGenerator.getWorldHeight(x, z);
                }
                return 0;
            },

            isOnRoad: (x, z) => {
                if (this.game.navigationManager?.isOnRoad) {
                    return this.game.navigationManager.isOnRoad(x, z);
                }
                return false;
            },

            isWalkable: (x, z) => {
                if (this.game.navigationManager?.isWalkable) {
                    return this.game.navigationManager.isWalkable(x, z);
                }
                return true; // Default to walkable if nav not available
            },

            findPath: (fromX, fromZ, toX, toZ) => {
                if (this.game.navigationManager) {
                    // ignoreSlopes: true - same as workers, prevents path failures on steep terrain
                    return findPath(this.game.navigationManager, fromX, fromZ, toX, toZ, { ignoreSlopes: true });
                }
                return null;
            },

            findPathAsync: async (fromX, fromZ, toX, toZ, options) => {
                if (this.game.navigationManager) {
                    // ignoreSlopes: true - same as workers, prevents path failures on steep terrain
                    return this.game.navigationManager.findPathAsync(fromX, fromZ, toX, toZ, { ignoreSlopes: true, ...options });
                }
                return null;
            },

            createVisual: (tentId, position, options = {}) => {
                if (this.game.aiEnemyManager) {
                    // options may contain: shirtColor, entityType, factionId (for militia)
                    this.game.aiEnemyManager.createAIVisual({
                        aiId: tentId,
                        aiType: options.entityType || 'bandit',
                        spawnerId: tentId,
                        position: [position.x, position.y, position.z],
                        aggro: true,
                        shirtColor: options.shirtColor,
                        factionId: options.factionId
                    });
                    const aiData = this.game.aiEnemyManager.tentAIEnemies.get(tentId);
                    return aiData?.controller || null;
                }
                return null;
            },

            destroyVisual: (tentId) => {
                if (this.game.aiEnemyManager) {
                    const aiData = this.game.aiEnemyManager.tentAIEnemies.get(tentId);
                    if (aiData?.controller) {
                        aiData.controller.dispose();
                        this.game.aiEnemyManager.tentAIEnemies.delete(tentId);
                    }
                }
            },

            broadcastP2P: (message) => {
                this.game.networkManager.broadcastP2P(message);
            },

            onShoot: (tentId, targetId, didHit, banditPos, isArtillery) => {
                const bandit = this.game.banditController.getEntity(tentId);
                if (!bandit || bandit.state === 'dead') return;

                const isLocalPlayer = (targetId === this.game.gameState.clientId);

                // Apply damage if hit and target is local player
                if (didHit && isLocalPlayer) {
                    // Ignore damage during loading screen
                    if (this.game.loadingScreen?.isActive) {
                        return;
                    }
                    // Spawn red hit effect at player position
                    if (this.game.effectManager && this.game.playerObject) {
                        this.game.effectManager.spawnBloodEffect(this.game.playerObject.position, banditPos);
                    }
                    // Kill player using full death manager (handles vehicle release, etc.)
                    const isMilitia = bandit.entityType === 'militia' || bandit.entityType === 'outpostMilitia' || bandit.entityType === 'artilleryMilitia';
                    const attackerType = isMilitia ? 'militia' : 'bandit';
                    this.game.deathManager.killEntity(
                        this.game.playerObject, false, false, `Killed by ${attackerType}`
                    );
                } else if (!didHit) {
                    // Miss - spawn dirt kickup near target
                    let targetPos = null;
                    if (isLocalPlayer && this.game.playerObject) {
                        targetPos = this.game.playerObject.position;
                    } else {
                        const avatar = this.game.networkManager?.avatars?.get(targetId);
                        if (avatar) {
                            targetPos = avatar.position;
                        }
                    }
                    if (targetPos && this.game.effectManager) {
                        this.game.effectManager.spawnDirtKickup(targetPos, banditPos);
                    }
                }

                // Trigger shoot animation and muzzle flash
                if (bandit.controller) {
                    bandit.controller.playShootAnimation();
                }

                // Play rifle gunshot sound (skip for artillery - sound already played via artillery_militia_fire)
                if (this.game.audioManager && bandit.mesh && !isArtillery) {
                    this.game.audioManager.playPositionalSound('rifle', bandit.mesh);
                }

                // Notify ambient sound system of combat
                if (this.game.ambientSoundSystem) {
                    this.game.ambientSoundSystem.onCombatActivity();
                }

                // Notify deer of bandit gunshot (they flee from gunshots)
                if (this.game.deerController && banditPos) {
                    this.game.deerController.registerGunshot(banditPos.x, banditPos.z);
                }
            },

            // Check if a player is currently dead (filters stale tick buffer positions)
            isPlayerDead: (playerId) => {
                // Local player
                if (playerId === this.game.gameState.clientId) {
                    return this.game.playerCombat?.isDead || this.game.isDead || false;
                }
                // Peer player
                const avatar = this.game.networkManager?.avatars?.get(playerId);
                if (avatar) {
                    return avatar.userData?.isDead || false;
                }
                return false;
            },

            // Heartbeat: Check if player has recent updates (not stale/disconnected)
            isPlayerActive: (playerId) => {
                // Local player is always active
                if (playerId === this.game.gameState.clientId) return true;

                // Check peer's lastUpdateTime
                const peerData = this.game.networkManager.peerGameData.get(playerId);
                if (!peerData) return false;

                // New peer hasn't received first tick yet - treat as active (not stale)
                if (!peerData.lastUpdateTime || peerData.lastUpdateTime === 0) {
                    return true;
                }

                // Stale if no update in 3 seconds (player ticks arrive every ~1 second)
                return (Date.now() - peerData.lastUpdateTime) < 3000;
            },

            // TickManager for deterministic simulation
            tickManager: this.game.tickManager,

            // Game reference for name tags
            game: this.game,

            // Get player faction for militia targeting
            getPlayerFaction: (playerId) => {
                // Local player
                if (playerId === this.game.gameState.clientId) {
                    return this.game.gameState.factionId;
                }
                // Peer player
                const peerData = this.game.networkManager?.peerGameData?.get(playerId);
                return peerData?.factionId || null;
            },

            // Spawn protection: don't target players for 60s after random spawn
            isPlayerSpawnProtected: (playerId) => {
                if (playerId === this.game.gameState.clientId) {
                    return this.game.lastSpawnType === 'random'
                        && this.game.gameState.lastSpawnTime
                        && Date.now() - this.game.gameState.lastSpawnTime < 60000;
                }
                const peerData = this.game.networkManager.peerGameData.get(playerId);
                if (!peerData) return false;
                return peerData.spawnType === 'random'
                    && peerData.spawnTime
                    && Date.now() - peerData.spawnTime < 60000;
            }
        });
    }

    /**
     * Initialize the DeerController for ambient deer AI
     */
    initializeDeerController() {
        // Create DeerManager (handles visuals and model loading)
        this.game.deerManager = new DeerManager(
            this.game.scene,
            this.game.terrainGenerator
        );

        // Create DeerController (handles AI behavior)
        this.game.deerController = new DeerController();
        this.game.deerManager.setController(this.game.deerController);

        // Initialize with clientId and game reference
        this.game.deerController.init(this.game.gameState.clientId, this.game);

        // Set deer-specific callbacks
        this.game.deerController.setCallbacks({
            getPlayersInChunks: (chunkKeys) => {
                return this.game.gameState.getPlayersInChunks(chunkKeys);
            },

            getPlayerPosition: (playerId) => {
                // Local player
                if (playerId === this.game.gameState.clientId && this.game.playerObject) {
                    return {
                        x: this.game.playerObject.position.x,
                        y: this.game.playerObject.position.y,
                        z: this.game.playerObject.position.z
                    };
                }
                // Peer player
                const avatar = this.game.networkManager.avatars.get(playerId);
                if (avatar && avatar.position) {
                    return {
                        x: avatar.position.x,
                        y: avatar.position.y,
                        z: avatar.position.z
                    };
                }
                return null;
            },

            getTerrainHeight: (x, z) => {
                return this.game.terrainGenerator.getWorldHeight(x, z);
            },

            getChunkObjects: (chunkKey) => {
                // Return objects in this chunk from ChunkManager
                const objects = this.game.chunkManager?.chunkObjects?.get(chunkKey);
                if (!objects) return [];
                // Map to simple format for deer threat detection
                return objects.map(obj => ({
                    type: obj.userData?.modelType || obj.userData?.type,
                    position: obj.position ? {
                        x: obj.position.x,
                        y: obj.position.y,
                        z: obj.position.z
                    } : null
                })).filter(o => o.position);
            },

            getDeerTreeStructures: (chunkKey) => {
                return this.game.gameState.getDeerTreeStructuresInChunk(chunkKey);
            },

            getServerTick: () => {
                return this.game.gameState?.serverTick || 0;
            },

            createVisual: (chunkKey, position) => {
                return this.game.deerManager.createVisual(chunkKey, position);
            },

            destroyVisual: (chunkKey, mesh) => {
                this.game.deerManager.destroyVisual(chunkKey, mesh);
            },

            broadcastP2P: (message) => {
                if (this.game.networkManager) {
                    this.game.networkManager.broadcastP2P(message);
                }
            },

            // Heartbeat: Check if player has recent updates (not stale/disconnected)
            isPlayerActive: (playerId) => {
                // Local player is always active
                if (playerId === this.game.gameState.clientId) return true;

                // Check peer's lastUpdateTime
                const peerData = this.game.networkManager.peerGameData.get(playerId);
                if (!peerData) return false;

                // New peer hasn't received first tick yet - treat as active (not stale)
                if (!peerData.lastUpdateTime || peerData.lastUpdateTime === 0) {
                    return true;
                }

                // Stale if no update in 3 seconds (player ticks arrive every ~1 second)
                return (Date.now() - peerData.lastUpdateTime) < 3000;
            },
        });

        // Wire deer controller to PlayerCombat for targeting
        if (this.game.playerCombat) {
            this.game.playerCombat.setDeerController(this.game.deerController);
        }

        // Initialize NameTagManager for floating name tags
        this.game.nameTagManager = new NameTagManager(this.game.scene);

        // Register main player's name tag
        if (this.game.playerObject) {
            const displayName = this.game.gameState.username || 'Player';
            this.game.nameTagManager.registerEntity('main_player', displayName, this.game.playerObject);

            // Set main player's faction color
            if (this.game.gameState.factionId) {
                this.game.nameTagManager.setEntityFaction('main_player', this.game.gameState.factionId);
            }
        }

        // Setup chat input (Enter key to type, Enter to send)
        this.game.setupChatInput();
    }

    /**
     * Initialize the BrownBearController for brown bear AI from dens
     */
    initializeBrownBearController() {
        // Create BrownBearManager (handles visuals and model loading)
        this.game.brownBearManager = new BrownBearManager(this.game.scene);

        // Create BrownBearController (handles AI behavior)
        this.game.brownBearController = new BrownBearController();
        this.game.brownBearManager.setController(this.game.brownBearController);

        this.game.brownBearController.initialize({
            clientId: this.game.gameState.clientId,
            game: this.game,

            getPlayersInChunks: (chunkKeys) => {
                return this.game.gameState.getPlayersInChunks(chunkKeys);
            },

            getPlayerPosition: (playerId) => {
                if (playerId === this.game.gameState.clientId && this.game.playerObject) {
                    return {
                        x: this.game.playerObject.position.x,
                        y: this.game.playerObject.position.y,
                        z: this.game.playerObject.position.z
                    };
                }
                const avatar = this.game.networkManager.avatars.get(playerId);
                if (avatar && avatar.position) {
                    return {
                        x: avatar.position.x,
                        y: avatar.position.y,
                        z: avatar.position.z
                    };
                }
                return null;
            },

            getBrownBearStructures: (chunkKey) => {
                return this.game.gameState.getBrownBearStructuresInChunk(chunkKey);
            },

            getTerrainHeight: (x, z) => {
                return this.game.terrainGenerator.getWorldHeight(x, z);
            },

            getChunkObjects: (chunkKey) => {
                // Return objects in this chunk from ChunkManager
                const objects = this.game.chunkManager?.chunkObjects?.get(chunkKey);
                if (!objects) return [];
                // Map to simple format for structure detection
                return objects.map(obj => ({
                    type: obj.userData?.modelType || obj.userData?.type,
                    position: obj.position ? {
                        x: obj.position.x,
                        y: obj.position.y,
                        z: obj.position.z
                    } : null
                })).filter(o => o.position);
            },

            createVisual: (denId, position) => {
                return this.game.brownBearManager.createVisual(denId, position);
            },

            destroyVisual: (denId, mesh) => {
                this.game.brownBearManager.destroyVisual(denId, mesh);
            },

            broadcastP2P: (message) => {
                if (this.game.networkManager) {
                    this.game.networkManager.broadcastP2P(message);
                }
            },

            isPlayerDead: (playerId) => {
                if (playerId === this.game.gameState.clientId) {
                    const isDead = this.game.playerCombat?.isDead || this.game.isDead || false;
                    return isDead;
                }
                const avatar = this.game.networkManager?.avatars?.get(playerId);
                if (avatar) {
                    const isDead = avatar.userData?.isDead || false;
                    return isDead;
                }
                console.log(`[isPlayerDead] ${playerId}: no avatar found, returning false`);
                return false;
            },

            isPlayerClimbing: (playerId) => {
                if (playerId === this.game.gameState.clientId) {
                    return this.game.gameState.climbingState?.isClimbing || false;
                }
                return this.game.occupiedOutposts
                    ? [...this.game.occupiedOutposts.values()].includes(playerId)
                    : false;
            },

            onAttack: (denId, targetId, bearPos) => {
                const isLocalPlayer = (targetId === this.game.gameState.clientId);

                if (isLocalPlayer) {
                    if (this.game.loadingScreen?.isActive) {
                        return;
                    }
                    this.game.deathManager.killEntity(
                        this.game.playerObject, false, false, 'Killed by brown bear'
                    );
                }
            },

            // Heartbeat: Check if player has recent updates (not stale/disconnected)
            isPlayerActive: (playerId) => {
                // Local player is always active
                if (playerId === this.game.gameState.clientId) return true;

                // Check peer's lastUpdateTime
                const peerData = this.game.networkManager.peerGameData.get(playerId);
                if (!peerData) return false;

                // New peer hasn't received first tick yet - treat as active (not stale)
                if (!peerData.lastUpdateTime || peerData.lastUpdateTime === 0) {
                    return true;
                }

                // Stale if no update in 3 seconds (player ticks arrive every ~1 second)
                return (Date.now() - peerData.lastUpdateTime) < 3000;
            },

            // Spawn protection: don't target players for 60s after random spawn
            isPlayerSpawnProtected: (playerId) => {
                if (playerId === this.game.gameState.clientId) {
                    return this.game.lastSpawnType === 'random'
                        && this.game.gameState.lastSpawnTime
                        && Date.now() - this.game.gameState.lastSpawnTime < 60000;
                }
                const peerData = this.game.networkManager.peerGameData.get(playerId);
                if (!peerData) return false;
                return peerData.spawnType === 'random'
                    && peerData.spawnTime
                    && Date.now() - peerData.spawnTime < 60000;
            },
        });

        // Wire brown bear controller to PlayerCombat for targeting
        if (this.game.playerCombat) {
            this.game.playerCombat.setBrownBearController(this.game.brownBearController);
        }
    }

    /**
     * Initialize the BakerController for baker NPCs at bakeries
     */
    initializeBakerController() {
        // Use singleton instance
        this.game.bakerController = bakerController;

        this.game.bakerController.initialize({
            clientId: this.game.gameState.clientId,
            game: this.game,
            gameState: this.game.gameState,
            networkManager: this.game.networkManager,

            getPlayersInChunks: (chunkKeys) => {
                return this.game.gameState.getPlayersInChunks(chunkKeys);
            },

            getPlayerPosition: (playerId) => {
                // Local player
                if (playerId === this.game.gameState.clientId && this.game.playerObject) {
                    return {
                        x: this.game.playerObject.position.x,
                        y: this.game.playerObject.position.y,
                        z: this.game.playerObject.position.z
                    };
                }
                // Peer player
                const avatar = this.game.networkManager.avatars.get(playerId);
                if (avatar && avatar.position) {
                    return {
                        x: avatar.position.x,
                        y: avatar.position.y,
                        z: avatar.position.z
                    };
                }
                return null;
            },

            getTerrainHeight: (x, z) => {
                return this.game.terrainGenerator?.getWorldHeight(x, z) || 0;
            },

            isWalkable: (x, z) => {
                if (this.game.navigationManager) {
                    // Baker can traverse slopes - use slope-ignoring check
                    return this.game.navigationManager.isPassableIgnoreSlope(x, z);
                }
                return true; // Default to walkable if nav not available
            },

            findPath: (from, to) => {
                if (!this.game.navigationManager) return null;

                // Baker can traverse slopes (just slower) - ignore slope blocking
                return findPath(
                    this.game.navigationManager,
                    from.x, from.z,
                    to.x, to.z,
                    { ignoreSlopes: true }
                );
            },

            findPathAsync: async (from, to, options) => {
                if (!this.game.navigationManager) return null;
                return this.game.navigationManager.findPathAsync(from.x, from.z, to.x, to.z, { ignoreSlopes: true, ...options });
            },

            getSpeedMultiplier: (x, z) => {
                // Returns terrain speed multiplier (roads = 1.6x, slopes reduce speed)
                if (this.game.navigationManager) {
                    return this.game.navigationManager.getMovementSpeedMultiplier(x, z);
                }
                return 1.0;
            },

            broadcastP2P: (message) => {
                this.game.networkManager?.broadcastP2P(message);
            },

            // Heartbeat: Check if player has recent updates (not stale/disconnected)
            isPlayerActive: (playerId) => {
                // Local player is always active
                if (playerId === this.game.gameState.clientId) return true;

                // Check peer's lastUpdateTime
                const peerData = this.game.networkManager.peerGameData.get(playerId);
                if (!peerData) return false;

                // New peer hasn't received first tick yet - treat as active (not stale)
                if (!peerData.lastUpdateTime || peerData.lastUpdateTime === 0) {
                    return true;
                }

                // Stale if no update in 3 seconds (player ticks arrive every ~1 second)
                return (Date.now() - peerData.lastUpdateTime) < 3000;
            },
        });

    }

    /**
     * Initialize the GardenerController for gardener NPCs at gardener buildings
     */
    initializeGardenerController() {
        // Use singleton instance
        this.game.gardenerController = gardenerController;

        this.game.gardenerController.initialize({
            clientId: this.game.gameState.clientId,
            game: this.game,
            gameState: this.game.gameState,
            networkManager: this.game.networkManager,

            getPlayersInChunks: (chunkKeys) => {
                return this.game.gameState.getPlayersInChunks(chunkKeys);
            },

            getPlayerPosition: (playerId) => {
                // Local player
                if (playerId === this.game.gameState.clientId && this.game.playerObject) {
                    return {
                        x: this.game.playerObject.position.x,
                        y: this.game.playerObject.position.y,
                        z: this.game.playerObject.position.z
                    };
                }
                // Peer player
                const avatar = this.game.networkManager.avatars.get(playerId);
                if (avatar && avatar.position) {
                    return {
                        x: avatar.position.x,
                        y: avatar.position.y,
                        z: avatar.position.z
                    };
                }
                return null;
            },

            getTerrainHeight: (x, z) => {
                return this.game.terrainGenerator?.getWorldHeight(x, z) || 0;
            },

            isWalkable: (x, z) => {
                if (this.game.navigationManager) {
                    // Gardener can traverse slopes - use slope-ignoring check
                    return this.game.navigationManager.isPassableIgnoreSlope(x, z);
                }
                return true; // Default to walkable if nav not available
            },

            findPath: (from, to) => {
                if (!this.game.navigationManager) return null;

                // Gardener can traverse slopes (just slower) - ignore slope blocking
                return findPath(
                    this.game.navigationManager,
                    from.x, from.z,
                    to.x, to.z,
                    { ignoreSlopes: true }
                );
            },

            findPathAsync: async (from, to, options) => {
                if (!this.game.navigationManager) return null;
                return this.game.navigationManager.findPathAsync(from.x, from.z, to.x, to.z, { ignoreSlopes: true, ...options });
            },

            getSpeedMultiplier: (x, z) => {
                // Returns terrain speed multiplier (roads = 1.6x, slopes reduce speed)
                if (this.game.navigationManager) {
                    return this.game.navigationManager.getMovementSpeedMultiplier(x, z);
                }
                return 1.0;
            },

            // Heartbeat: Check if a player has recent updates (not stale)
            isPlayerActive: (playerId) => {
                // Local player is always active
                if (playerId === this.game.gameState.clientId) return true;

                // Check peer's lastUpdateTime
                const peerData = this.game.networkManager.peerGameData.get(playerId);
                if (!peerData) return false;

                // New peer hasn't received first tick yet - treat as active (not stale)
                if (!peerData.lastUpdateTime || peerData.lastUpdateTime === 0) {
                    return true;
                }

                return (Date.now() - peerData.lastUpdateTime) < 3000;  // 3 second threshold
            },

            broadcastP2P: (message) => {
                this.game.networkManager?.broadcastP2P(message);
            }
        });

    }

    /**
     * Initialize the WoodcutterController for woodcutter NPCs at woodcutter buildings
     */
    initializeWoodcutterController() {
        // Use singleton instance
        this.game.woodcutterController = woodcutterController;

        this.game.woodcutterController.initialize({
            clientId: this.game.gameState.clientId,
            game: this.game,
            gameState: this.game.gameState,
            networkManager: this.game.networkManager,
            chunkManager: this.game.chunkManager,

            getPlayersInChunks: (chunkKeys) => {
                return this.game.gameState.getPlayersInChunks(chunkKeys);
            },

            getPlayerPosition: (playerId) => {
                // Local player
                if (playerId === this.game.gameState.clientId && this.game.playerObject) {
                    return {
                        x: this.game.playerObject.position.x,
                        y: this.game.playerObject.position.y,
                        z: this.game.playerObject.position.z
                    };
                }
                // Peer player
                const avatar = this.game.networkManager.avatars.get(playerId);
                if (avatar && avatar.position) {
                    return {
                        x: avatar.position.x,
                        y: avatar.position.y,
                        z: avatar.position.z
                    };
                }
                return null;
            },

            getTerrainHeight: (x, z) => {
                return this.game.terrainGenerator?.getWorldHeight(x, z) || 0;
            },

            isWalkable: (x, z) => {
                if (this.game.navigationManager) {
                    return this.game.navigationManager.isPassableIgnoreSlope(x, z);
                }
                return true;
            },

            isOnRoad: (x, z) => {
                if (this.game.navigationManager?.isOnRoad) {
                    return this.game.navigationManager.isOnRoad(x, z);
                }
                return false;
            },

            findPath: (from, to) => {
                if (!this.game.navigationManager) return null;

                return findPath(
                    this.game.navigationManager,
                    from.x, from.z,
                    to.x, to.z,
                    { ignoreSlopes: true }
                );
            },

            findPathAsync: async (from, to, options) => {
                if (!this.game.navigationManager) return null;
                return this.game.navigationManager.findPathAsync(from.x, from.z, to.x, to.z, { ignoreSlopes: true, ...options });
            },

            getSpeedMultiplier: (x, z) => {
                if (this.game.navigationManager) {
                    return this.game.navigationManager.getMovementSpeedMultiplier(x, z);
                }
                return 1.0;
            },

            // Heartbeat: Check if a player has recent updates (not stale)
            isPlayerActive: (playerId) => {
                // Local player is always active
                if (playerId === this.game.gameState.clientId) return true;

                // Check peer's lastUpdateTime
                const peerData = this.game.networkManager.peerGameData.get(playerId);
                if (!peerData) return false;

                // New peer hasn't received first tick yet - treat as active (not stale)
                if (!peerData.lastUpdateTime || peerData.lastUpdateTime === 0) {
                    return true;
                }

                return (Date.now() - peerData.lastUpdateTime) < 3000;  // 3 second threshold
            },

            broadcastP2P: (message) => {
                this.game.networkManager?.broadcastP2P(message);
            }
        });

    }

    /**
     * Initialize the MinerController for miner NPCs at miner buildings
     */
    initializeMinerController() {
        // Use singleton instance
        this.game.minerController = minerController;

        this.game.minerController.initialize({
            clientId: this.game.gameState.clientId,
            game: this.game,
            gameState: this.game.gameState,
            networkManager: this.game.networkManager,
            chunkManager: this.game.chunkManager,

            getPlayersInChunks: (chunkKeys) => {
                return this.game.gameState.getPlayersInChunks(chunkKeys);
            },

            getPlayerPosition: (playerId) => {
                // Local player
                if (playerId === this.game.gameState.clientId && this.game.playerObject) {
                    return {
                        x: this.game.playerObject.position.x,
                        y: this.game.playerObject.position.y,
                        z: this.game.playerObject.position.z
                    };
                }
                // Peer player
                const avatar = this.game.networkManager.avatars.get(playerId);
                if (avatar && avatar.position) {
                    return {
                        x: avatar.position.x,
                        y: avatar.position.y,
                        z: avatar.position.z
                    };
                }
                return null;
            },

            getTerrainHeight: (x, z) => {
                return this.game.terrainGenerator?.getWorldHeight(x, z) || 0;
            },

            isWalkable: (x, z) => {
                if (this.game.navigationManager) {
                    return this.game.navigationManager.isPassableIgnoreSlope(x, z);
                }
                return true;
            },

            isOnRoad: (x, z) => {
                if (this.game.navigationManager?.isOnRoad) {
                    return this.game.navigationManager.isOnRoad(x, z);
                }
                return false;
            },

            findPath: (from, to) => {
                if (!this.game.navigationManager) return null;

                return findPath(
                    this.game.navigationManager,
                    from.x, from.z,
                    to.x, to.z,
                    { ignoreSlopes: true }
                );
            },

            findPathAsync: async (from, to, options) => {
                if (!this.game.navigationManager) return null;
                return this.game.navigationManager.findPathAsync(from.x, from.z, to.x, to.z, { ignoreSlopes: true, ...options });
            },

            getSpeedMultiplier: (x, z) => {
                if (this.game.navigationManager) {
                    return this.game.navigationManager.getMovementSpeedMultiplier(x, z);
                }
                return 1.0;
            },

            // Heartbeat: Check if a player has recent updates (not stale)
            isPlayerActive: (playerId) => {
                // Local player is always active
                if (playerId === this.game.gameState.clientId) return true;

                // Check peer's lastUpdateTime
                const peerData = this.game.networkManager.peerGameData.get(playerId);
                if (!peerData) return false;

                // New peer hasn't received first tick yet - treat as active (not stale)
                if (!peerData.lastUpdateTime || peerData.lastUpdateTime === 0) {
                    return true;
                }

                return (Date.now() - peerData.lastUpdateTime) < 3000;  // 3 second threshold
            },

            broadcastP2P: (message) => {
                this.game.networkManager?.broadcastP2P(message);
            }
        });

    }

    /**
     * Initialize the StoneMasonController for stonemason NPCs at stonemason buildings
     */
    initializeStoneMasonController() {
        // Use singleton instance
        this.game.stoneMasonController = stoneMasonController;

        this.game.stoneMasonController.initialize({
            clientId: this.game.gameState.clientId,
            game: this.game,
            gameState: this.game.gameState,
            networkManager: this.game.networkManager,
            chunkManager: this.game.chunkManager,

            getPlayersInChunks: (chunkKeys) => {
                return this.game.gameState.getPlayersInChunks(chunkKeys);
            },

            getPlayerPosition: (playerId) => {
                // Local player
                if (playerId === this.game.gameState.clientId && this.game.playerObject) {
                    return {
                        x: this.game.playerObject.position.x,
                        y: this.game.playerObject.position.y,
                        z: this.game.playerObject.position.z
                    };
                }
                // Peer player
                const avatar = this.game.networkManager.avatars.get(playerId);
                if (avatar && avatar.position) {
                    return {
                        x: avatar.position.x,
                        y: avatar.position.y,
                        z: avatar.position.z
                    };
                }
                return null;
            },

            getTerrainHeight: (x, z) => {
                return this.game.terrainGenerator?.getWorldHeight(x, z) || 0;
            },

            isWalkable: (x, z) => {
                if (this.game.navigationManager) {
                    return this.game.navigationManager.isPassableIgnoreSlope(x, z);
                }
                return true;
            },

            isOnRoad: (x, z) => {
                if (this.game.navigationManager?.isOnRoad) {
                    return this.game.navigationManager.isOnRoad(x, z);
                }
                return false;
            },

            findPath: (from, to) => {
                if (!this.game.navigationManager) return null;

                return findPath(
                    this.game.navigationManager,
                    from.x, from.z,
                    to.x, to.z,
                    { ignoreSlopes: true }
                );
            },

            findPathAsync: async (from, to, options) => {
                if (!this.game.navigationManager) return null;
                return this.game.navigationManager.findPathAsync(from.x, from.z, to.x, to.z, { ignoreSlopes: true, ...options });
            },

            getSpeedMultiplier: (x, z) => {
                if (this.game.navigationManager) {
                    return this.game.navigationManager.getMovementSpeedMultiplier(x, z);
                }
                return 1.0;
            },

            // Heartbeat: Check if a player has recent updates (not stale)
            isPlayerActive: (playerId) => {
                // Local player is always active
                if (playerId === this.game.gameState.clientId) return true;

                // Check peer's lastUpdateTime
                const peerData = this.game.networkManager.peerGameData.get(playerId);
                if (!peerData) return false;

                // New peer hasn't received first tick yet - treat as active (not stale)
                if (!peerData.lastUpdateTime || peerData.lastUpdateTime === 0) {
                    return true;
                }

                return (Date.now() - peerData.lastUpdateTime) < 3000;  // 3 second threshold
            },

            broadcastP2P: (message) => {
                this.game.networkManager?.broadcastP2P(message);
            }
        });

    }

    /**
     * Initialize the IronWorkerController for iron worker NPCs at ironworks
     */
    initializeIronWorkerController() {
        // Use singleton instance
        this.game.ironWorkerController = ironWorkerController;

        this.game.ironWorkerController.initialize({
            clientId: this.game.gameState.clientId,
            game: this.game,
            gameState: this.game.gameState,
            networkManager: this.game.networkManager,

            getPlayersInChunks: (chunkKeys) => {
                return this.game.gameState.getPlayersInChunks(chunkKeys);
            },

            getPlayerPosition: (playerId) => {
                if (playerId === this.game.gameState.clientId && this.game.playerObject) {
                    return {
                        x: this.game.playerObject.position.x,
                        y: this.game.playerObject.position.y,
                        z: this.game.playerObject.position.z
                    };
                }
                const avatar = this.game.networkManager.avatars.get(playerId);
                if (avatar && avatar.position) {
                    return {
                        x: avatar.position.x,
                        y: avatar.position.y,
                        z: avatar.position.z
                    };
                }
                return null;
            },

            getTerrainHeight: (x, z) => {
                return this.game.terrainGenerator?.getWorldHeight(x, z) || 0;
            },

            isWalkable: (x, z) => {
                if (this.game.navigationManager) {
                    return this.game.navigationManager.isPassableIgnoreSlope(x, z);
                }
                return true;
            },

            findPath: (from, to) => {
                if (!this.game.navigationManager) return null;
                return findPath(this.game.navigationManager, from.x, from.z, to.x, to.z, { ignoreSlopes: true });
            },

            findPathAsync: async (from, to, options) => {
                if (!this.game.navigationManager) return null;
                return this.game.navigationManager.findPathAsync(from.x, from.z, to.x, to.z, { ignoreSlopes: true, ...options });
            },

            getSpeedMultiplier: (x, z) => {
                if (this.game.navigationManager) {
                    return this.game.navigationManager.getMovementSpeedMultiplier(x, z);
                }
                return 1.0;
            },

            isPlayerActive: (playerId) => {
                if (playerId === this.game.gameState.clientId) return true;
                const peerData = this.game.networkManager.peerGameData.get(playerId);
                if (!peerData) return false;
                if (!peerData.lastUpdateTime || peerData.lastUpdateTime === 0) return true;
                return (Date.now() - peerData.lastUpdateTime) < 3000;
            },

            broadcastP2P: (message) => {
                this.game.networkManager?.broadcastP2P(message);
            }
        });

    }

    /**
     * Initialize the TileWorkerController for tile worker NPCs at tileworks
     */
    initializeTileWorkerController() {
        // Use singleton instance
        this.game.tileWorkerController = tileWorkerController;

        this.game.tileWorkerController.initialize({
            clientId: this.game.gameState.clientId,
            game: this.game,
            gameState: this.game.gameState,
            networkManager: this.game.networkManager,

            getPlayersInChunks: (chunkKeys) => {
                return this.game.gameState.getPlayersInChunks(chunkKeys);
            },

            getPlayerPosition: (playerId) => {
                if (playerId === this.game.gameState.clientId && this.game.playerObject) {
                    return {
                        x: this.game.playerObject.position.x,
                        y: this.game.playerObject.position.y,
                        z: this.game.playerObject.position.z
                    };
                }
                const avatar = this.game.networkManager.avatars.get(playerId);
                if (avatar && avatar.position) {
                    return {
                        x: avatar.position.x,
                        y: avatar.position.y,
                        z: avatar.position.z
                    };
                }
                return null;
            },

            getTerrainHeight: (x, z) => {
                return this.game.terrainGenerator?.getWorldHeight(x, z) || 0;
            },

            isWalkable: (x, z) => {
                if (this.game.navigationManager) {
                    return this.game.navigationManager.isPassableIgnoreSlope(x, z);
                }
                return true;
            },

            findPath: (from, to) => {
                if (!this.game.navigationManager) return null;
                return findPath(this.game.navigationManager, from.x, from.z, to.x, to.z, { ignoreSlopes: true });
            },

            findPathAsync: async (from, to, options) => {
                if (!this.game.navigationManager) return null;
                return this.game.navigationManager.findPathAsync(from.x, from.z, to.x, to.z, { ignoreSlopes: true, ...options });
            },

            getSpeedMultiplier: (x, z) => {
                if (this.game.navigationManager) {
                    return this.game.navigationManager.getMovementSpeedMultiplier(x, z);
                }
                return 1.0;
            },

            isPlayerActive: (playerId) => {
                if (playerId === this.game.gameState.clientId) return true;
                const peerData = this.game.networkManager.peerGameData.get(playerId);
                if (!peerData) return false;
                if (!peerData.lastUpdateTime || peerData.lastUpdateTime === 0) return true;
                return (Date.now() - peerData.lastUpdateTime) < 3000;
            },

            broadcastP2P: (message) => {
                this.game.networkManager?.broadcastP2P(message);
            }
        });

    }

    /**
     * Initialize the BlacksmithController for blacksmith NPCs at blacksmith buildings
     */
    initializeBlacksmithController() {
        // Use singleton instance
        this.game.blacksmithController = blacksmithController;

        this.game.blacksmithController.initialize({
            clientId: this.game.gameState.clientId,
            game: this.game,
            gameState: this.game.gameState,
            networkManager: this.game.networkManager,

            getPlayersInChunks: (chunkKeys) => {
                return this.game.gameState.getPlayersInChunks(chunkKeys);
            },

            getPlayerPosition: (playerId) => {
                if (playerId === this.game.gameState.clientId && this.game.playerObject) {
                    return {
                        x: this.game.playerObject.position.x,
                        y: this.game.playerObject.position.y,
                        z: this.game.playerObject.position.z
                    };
                }
                const avatar = this.game.networkManager.avatars.get(playerId);
                if (avatar && avatar.position) {
                    return {
                        x: avatar.position.x,
                        y: avatar.position.y,
                        z: avatar.position.z
                    };
                }
                return null;
            },

            getTerrainHeight: (x, z) => {
                return this.game.terrainGenerator?.getWorldHeight(x, z) || 0;
            },

            isWalkable: (x, z) => {
                if (this.game.navigationManager) {
                    return this.game.navigationManager.isPassableIgnoreSlope(x, z);
                }
                return true;
            },

            findPath: (from, to) => {
                if (!this.game.navigationManager) return null;
                return findPath(this.game.navigationManager, from.x, from.z, to.x, to.z, { ignoreSlopes: true });
            },

            findPathAsync: async (from, to, options) => {
                if (!this.game.navigationManager) return null;
                return this.game.navigationManager.findPathAsync(from.x, from.z, to.x, to.z, { ignoreSlopes: true, ...options });
            },

            getSpeedMultiplier: (x, z) => {
                if (this.game.navigationManager) {
                    return this.game.navigationManager.getMovementSpeedMultiplier(x, z);
                }
                return 1.0;
            },

            isPlayerActive: (playerId) => {
                if (playerId === this.game.gameState.clientId) return true;
                const peerData = this.game.networkManager.peerGameData.get(playerId);
                if (!peerData) return false;
                if (!peerData.lastUpdateTime || peerData.lastUpdateTime === 0) return true;
                return (Date.now() - peerData.lastUpdateTime) < 3000;
            },

            broadcastP2P: (message) => {
                this.game.networkManager?.broadcastP2P(message);
            }
        });

    }

    /**
     * Initialize the FishermanController for fisherman NPCs at fisherman structures
     */
    initializeFishermanController() {
        // Use singleton instance
        this.game.fishermanController = fishermanController;

        this.game.fishermanController.initialize({
            clientId: this.game.gameState.clientId,
            game: this.game,
            gameState: this.game.gameState,
            networkManager: this.game.networkManager,

            getPlayersInChunks: (chunkKeys) => {
                return this.game.gameState.getPlayersInChunks(chunkKeys);
            },

            getPlayerPosition: (playerId) => {
                if (playerId === this.game.gameState.clientId && this.game.playerObject) {
                    return {
                        x: this.game.playerObject.position.x,
                        y: this.game.playerObject.position.y,
                        z: this.game.playerObject.position.z
                    };
                }
                const avatar = this.game.networkManager.avatars.get(playerId);
                if (avatar && avatar.position) {
                    return {
                        x: avatar.position.x,
                        y: avatar.position.y,
                        z: avatar.position.z
                    };
                }
                return null;
            },

            getTerrainHeight: (x, z) => {
                return this.game.terrainGenerator?.getWorldHeight(x, z) || 0;
            },

            isWalkable: (x, z) => {
                if (this.game.navigationManager) {
                    return this.game.navigationManager.isPassableIgnoreSlope(x, z);
                }
                return true;
            },

            findPath: (from, to) => {
                if (!this.game.navigationManager) return null;
                return findPath(this.game.navigationManager, from.x, from.z, to.x, to.z, { ignoreSlopes: true });
            },

            findPathAsync: async (from, to, options) => {
                if (!this.game.navigationManager) return null;
                return this.game.navigationManager.findPathAsync(from.x, from.z, to.x, to.z, { ignoreSlopes: true, ...options });
            },

            getSpeedMultiplier: (x, z) => {
                if (this.game.navigationManager) {
                    return this.game.navigationManager.getMovementSpeedMultiplier(x, z);
                }
                return 1.0;
            },

            isPlayerActive: (playerId) => {
                if (playerId === this.game.gameState.clientId) return true;
                const peerData = this.game.networkManager.peerGameData.get(playerId);
                if (!peerData) return false;
                if (!peerData.lastUpdateTime || peerData.lastUpdateTime === 0) return true;
                return (Date.now() - peerData.lastUpdateTime) < 3000;
            },

            broadcastP2P: (message) => {
                this.game.networkManager?.broadcastP2P(message);
            }
        });

    }

    setupPlayerCallbacks() {
        // Set up arrival callback
        this.game.playerController.setOnArriveCallback(() => {
            this.game.gameState.isMoving = false;
            // Notify peers of final position
            this.game.networkManager.broadcastP2P({
                type: 'player_pos',
                t: Date.now(),
                p: this.game.playerObject.position.toArray(),
                r: this.game.playerObject.rotation.y
            });
            if (this.game.gameState.inventoryOpen) {
                this.game.inventoryUI.updateConstructionSection();
                this.game.inventoryUI.updateCrateSection();
            }
            this.game.checkProximityToObjects();
        });

        // Set up blocked callback
        this.game.playerController.setOnBlockedCallback((position) => {
            this.game.gameState.isMoving = false;
            this.game.networkManager.broadcastP2P({
                type: 'player_pos',
                t: Date.now(),
                p: position.toArray(),
                r: this.game.playerObject.rotation.y
            });
            if (this.game.gameState.inventoryOpen) {
                this.game.inventoryUI.updateConstructionSection();
                this.game.inventoryUI.updateCrateSection();
            }
            const hasAxe = this.game.hasToolWithDurability('axe');
            const hasSaw = this.game.hasToolWithDurability('saw');
            const hasHammer = this.game.hasToolWithDurability('hammer');
            const hasFishingNet = this.game.hasToolWithDurability('fishingnet');
            const isOnCooldown = this.game.gameState.harvestCooldown && this.game.gameState.harvestCooldown.endTime > Date.now();
            ui.updateButtonStates(this.game.gameState.isInChunk, this.game.gameState.nearestObject, hasAxe, hasSaw, isOnCooldown, this.game.gameState.nearestConstructionSite, this.game.gameState.isMoving, this.game.gameState.nearestStructure, hasHammer, this.game.gameState.nearWater, hasFishingNet, this.game.gameState.onGrass, this.game.gameState.mushroomAvailable, this.game.gameState.vegetableSeedsAvailable, this.game.gameState.limestoneAvailable, this.game.gameState.seedsAvailable, this.game.gameState.seedTreeType, this.game.gameState.climbingState.isClimbing, this.game.occupiedOutposts, this.game.gameState.vegetablesGatherAvailable, this.game.gameState.hempSeedsAvailable, this.game.gameState.hempGatherAvailable, this.game.gameState.activeAction);
        });

        // Set up water reversal callback
        this.game.playerController.setOnWaterReversalCallback((position) => {
            // Broadcast position when water reversal occurs
            this.game.networkManager.broadcastP2P({
                type: 'player_pos',
                t: Date.now(),
                p: position.toArray(),
                r: this.game.playerObject.rotation.y
            });
        });

        // Speed changes no longer need broadcast - position updates handle it
        this.game.playerController.setOnSpeedChangedCallback((speedMultiplier) => {
            // No-op: interpolation buffer system handles speed changes naturally
        });
    }
}

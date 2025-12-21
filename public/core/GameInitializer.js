
import * as THREE from 'three';
import { CONFIG, COMPUTED } from '../config.js';
import { ui } from '../ui.js';
import { objectPlacer, modelManager } from '../objects.js';
import { BillboardSystem } from '../BillboardSystem.js';


import { RockModelSystem } from '../RockModelSystem.js';
import { TreeGUI } from '../TreeGUI.js';
import { AudioManager, OceanSoundManager, PlainsSoundManager, MountainSoundManager, CampfireSoundManager } from '../audio.js';
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
import { AIController } from '../ai/AIController.js';
import { DeerController } from '../ai/DeerController.js';
import { DeerManager } from '../entity/DeerManager.js';
import { BearController } from '../ai/BearController.js';
import { BearManager } from '../entity/BearManager.js';
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

        // Store game reference in scene for object removal handling
        this.game.scene.userData.game = this.game;

        // Initialize controllers now that camera and scene are ready
        this.game.cameraController = new CameraController(this.game.camera);
        this.game.inputManager = new InputManager(this.game.camera);

        // Set scene on physics manager and initialize
        this.game.physicsManager.scene = this.game.scene;
        await this.game.physicsManager.initialize();

        // Initialize billboard system for tree LOD
        this.game.billboardSystem = new BillboardSystem(this.game.scene);

        // Initialize rock model system for 3D rock LOD (limestone, sandstone, clay)
        this.game.rockModelSystem = new RockModelSystem(this.game.scene);

        // Initialize tree debug GUI (for adjusting billboard/model parameters)
        // Note: TreeGUI is created in finalizeNetworking after deerManager is available

        // Set physics manager on objectPlacer for collider registration
        objectPlacer.setPhysicsManager(this.game.physicsManager);
        objectPlacer.setBillboardSystem(this.game.billboardSystem);
        objectPlacer.setRockModelSystem(this.game.rockModelSystem);

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
    setupComponents(spawnX, spawnZ) {
        this.setupScene(spawnX, spawnZ);
        this.setupPlayer();
        this.setupRenderers();
        
        // Now we can fully initialize network dependent components that need renderer/structure manager
        this.finalizeNetworking();
        
        this.game.setupInput();
        this.game.setupUI();
    }

    setupScene(spawnX, spawnZ) {
        // Create player object
        this.game.playerObject = new THREE.Group();
        this.game.playerObject.position.set(spawnX, 1.37, spawnZ);
        this.game.playerObject.rotation.y = Math.PI; // Face North (+Z direction)
        this.game.needsInitialHeightAdjustment = true;
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
                console.log('[Death] Player killed by bandit');
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
        // New terrain system
        this.game.terrainGenerator = new TerrainGenerator(TERRAIN_CONFIG.SEED || 12345);
        setTerrainGenerator(this.game.terrainGenerator); // Register globally for easy access
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

        // Connect cart/crate state to PlayerController for vehicle-style movement
        this.game.playerController.cartAttachmentState = this.game.gameState.cartAttachmentState;
        this.game.playerController.crateLoadState = this.game.gameState.crateLoadState;

        // Set navigationManager on MobileEntitySystem for road speed bonus
        if (this.game.mobileEntitySystem && this.game.navigationManager) {
            this.game.mobileEntitySystem.setNavigationManager(this.game.navigationManager);
        }

        // Setup player callbacks (moved logic to GameInitializer to avoid duplication code)
        this.setupPlayerCallbacks();
    }
    
    finalizeNetworking() {
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

        // Initialize BearController (ambient bear AI)
        this.initializeBearController();
        this.game.aiRegistry.register('bear', this.game.bearController);

        // Initialize debug GUI (after deerManager is available)
        this.game.treeGUI = new TreeGUI(
            this.game.billboardSystem,
            this.game.deerManager,
            this.game.waterSystem,
            this.game.messageRouter?.sceneObjectFactory
        );
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
                    return findPath(this.game.navigationManager, fromX, fromZ, toX, toZ);
                }
                return null;
            },

            createVisual: (tentId, position) => {
                if (this.game.aiEnemyManager) {
                    this.game.aiEnemyManager.createAIVisual({
                        aiId: tentId,
                        aiType: 'bandit',
                        spawnerId: tentId,
                        position: [position.x, position.y, position.z],
                        aggro: true
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

            onShoot: (tentId, targetId, didHit, banditPos) => {
                const bandit = this.game.banditController.getEntity(tentId);
                if (!bandit) return;

                const isLocalPlayer = (targetId === this.game.gameState.clientId);

                console.log(`[onShoot] tentId=${tentId}, targetId=${targetId}, didHit=${didHit}, isLocalPlayer=${isLocalPlayer}, myId=${this.game.gameState.clientId}`);

                // Apply damage if hit and target is local player
                if (didHit && isLocalPlayer) {
                    console.log('[onShoot] PLAYER HIT - calling die()');
                    this.game.playerCombat.die();
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

                // Play rifle gunshot sound
                if (this.game.audioManager && bandit.mesh) {
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
                // Notify bears of bandit gunshot (they flee from gunshots)
                if (this.game.bearController && banditPos) {
                    this.game.bearController.registerGunshot(banditPos.x, banditPos.z);
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

            // TickManager for deterministic simulation
            tickManager: this.game.tickManager,

            // Game reference for name tags
            game: this.game
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

        this.game.deerController.initialize({
            clientId: this.game.gameState.clientId,
            game: this.game,

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
        }
    }

    /**
     * Initialize the BearController for ambient bear AI
     */
    initializeBearController() {
        // Create BearManager (handles visuals and model loading)
        this.game.bearManager = new BearManager(
            this.game.scene,
            this.game.terrainGenerator
        );

        // Create BearController (handles AI behavior)
        this.game.bearController = new BearController();
        this.game.bearManager.setController(this.game.bearController);

        this.game.bearController.initialize({
            clientId: this.game.gameState.clientId,
            game: this.game,

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
                // Map to simple format for bear threat detection
                return objects.map(obj => ({
                    type: obj.userData?.modelType || obj.userData?.type,
                    position: obj.position ? {
                        x: obj.position.x,
                        y: obj.position.y,
                        z: obj.position.z
                    } : null
                })).filter(o => o.position);
            },

            getServerTick: () => {
                return this.game.gameState?.serverTick || 0;
            },

            createVisual: (chunkKey, position) => {
                return this.game.bearManager.createVisual(chunkKey, position);
            },

            destroyVisual: (chunkKey, mesh) => {
                this.game.bearManager.destroyVisual(chunkKey, mesh);
            },

            broadcastP2P: (message) => {
                if (this.game.networkManager) {
                    this.game.networkManager.broadcastP2P(message);
                }
            },

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

            onAttack: (bearChunkKey, targetId, targetType, bearPos) => {
                const isLocalPlayer = (targetId === this.game.gameState.clientId);

                console.log(`[Bear Attack] bear=${bearChunkKey}, target=${targetId}, type=${targetType}, isLocal=${isLocalPlayer}`);

                // Kill local player if targeted
                if (targetType === 'player' && isLocalPlayer) {
                    console.log('[Bear Attack] LOCAL PLAYER HIT - calling die()');
                    this.game.deathReason = 'Killed by bear';
                    this.game.playerCombat.die();
                }

                // Play bear roar sound at attack location
                if (this.game.audioManager && bearPos) {
                    this.game.audioManager.playSound('bear', bearPos);
                }
            },
        });

        // Wire bear controller to PlayerCombat for targeting
        if (this.game.playerCombat) {
            this.game.playerCombat.setBearController(this.game.bearController);
        }
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
            ui.updateButtonStates(this.game.gameState.isInChunk, this.game.gameState.nearestObject, hasAxe, hasSaw, isOnCooldown, this.game.gameState.nearestConstructionSite, this.game.gameState.isMoving, this.game.gameState.nearestStructure, hasHammer, this.game.gameState.nearWater, hasFishingNet, this.game.gameState.onGrass, this.game.gameState.mushroomAvailable, this.game.gameState.vegetableSeedsAvailable, this.game.gameState.seedsAvailable, this.game.gameState.seedTreeType, this.game.gameState.climbingState.isClimbing, this.game.occupiedOutposts, this.game.gameState.vegetablesGatherAvailable, this.game.gameState.activeAction);
        });

        // Set up dock state change callback
        this.game.playerController.setOnDockStateChangedCallback((position, targetPosition, onDock) => {
            // Broadcast current position when dock state changes
            this.game.networkManager.broadcastP2P({
                type: 'player_pos',
                t: Date.now(),
                p: position.toArray(),
                r: this.game.playerObject.rotation.y
            });
        });

        // Set up water reversal callback
        this.game.playerController.setOnWaterReversalCallback((position, onDock) => {
            // Broadcast position when water reversal occurs
            this.game.networkManager.broadcastP2P({
                type: 'player_pos',
                t: Date.now(),
                p: position.toArray(),
                r: this.game.playerObject.rotation.y
            });
            if (onDock) {
                this.game.gameState.isMoving = false;
            }
        });

        // Speed changes no longer need broadcast - position updates handle it
        this.game.playerController.setOnSpeedChangedCallback((speedMultiplier) => {
            // No-op: interpolation buffer system handles speed changes naturally
        });
    }
}

// File: public/game.js
// Location: C:\Users\colli\Desktop\test Horses\Horses\public\game.js

/**
 * ==========================================
 * MAIN GAME ENGINE
 * ==========================================
 *
 * This is the core game logic file that handles:
 * - Game initialization and main loop
 * - Player movement and controls
 * - Inventory management (backpack, crate, construction)
 * - Object interaction (trees, rocks, structures)
 * - Networking (WebSocket to server, WebRTC peer-to-peer)
 * - Chunk loading/unloading
 * - Action system (chopping, building, harvesting)
 *
 * KEY CONFIGURATION:
 * - All game constants are in './config.js' - modify there for balance changes
 * - Use CONFIG.CATEGORY.VALUE to access configuration values
 * - Example: CONFIG.ACTIONS.CHOP_TREE_DURATION for tree chopping time
 *
 * MAJOR SYSTEMS:
 * 1. Inventory System (lines ~2400-3700)
 *    - renderInventory() - Renders backpack UI
 *    - renderCrateInventory() - Renders crate storage UI
 *    - onItemMouseDown/Move/Up() - Drag and drop logic
 *
 * 2. Network System (lines ~260-700)
 *    - NetworkManager class - Handles all networking
 *    - Server messages via WebSocket
 *    - P2P connections via WebRTC
 *
 * 3. Action System (lines ~1700-2200)
 *    - startChoppingAction() - Trees and structures
 *    - startHarvestAction() - Logs and stones
 *    - startBuildAction() - Construction
 *    - startChiselingAction() - Stone crafting
 *
 * 4. Chunk System (lines ~750-1000)
 *    - loadChunk() - Loads terrain and objects
 *    - unloadChunk() - Removes distant chunks
 *    - updateChunks() - Manages chunk loading based on player position
 *
 * ADDING NEW FEATURES:
 * - New items: Add to inventory system, update item images in public/items/
 * - New structures: See comments at lines ~180-225 for build menu
 * - New actions: Follow pattern of existing action methods
 * - New tools: Add to CONFIG.TOOLS in config.js
 *
 * DEBUGGING TIPS:
 * - Set CONFIG.DEBUG options in config.js for diagnostics
 * - Check browser console for [CATEGORY] tagged messages
 * - Network issues: Look for "📥" and "📤" prefixed messages
 */

// ==========================================
// GUIDE: ADDING NEW BUILDABLE STRUCTURES
// ==========================================
// To add a new buildable structure to the game, follow these steps:
//
// 1. MODEL REGISTRATION (objects.js):
//    Add model to MODEL_CONFIG with path, category='structure', zero density
//
// 2. BUILD MENU (game.js ~line 146):
//    Add structure definition with id, type, name, imagePath
//    Set requiresFoundation=true if it needs a foundation
//
// 3. ICON IMAGE:
//    Create 64x64 px icon in public/structures/[structurename].png
//
// 4. PLACEMENT VALIDATION (game.js validateFoundationPlacement ~line 3336):
//    Default validation checks terrain slope and object proximity
//    Structures with requiresFoundation skip terrain checks
//    Add custom validation logic if needed
//
// 5. Y POSITION (game.js updateFoundationPreview ~line 3244):
//    For foundation-based structures, calculate:
//    Y = foundation.y + (foundationHeight/2) + (structureHeight/2) + gap
//
// 6. MATERIAL REQUIREMENTS (server.js place_construction_site ~line 371):
//    Define required materials in format { 'material_id': quantity }
//
// 7. CASCADE DELETION (server.js remove_object_request ~line 591):
//    If structure depends on foundation, add to cascade deletion logic
//    Store foundationId when placing, check it when foundation removed
//
// See crate implementation as reference example.

import * as THREE from 'three';
import { ui } from './ui.js';
import { WaterRenderer } from './WaterRenderer.js';
import { CONFIG, COMPUTED } from './config.js';
import { SimpleTerrainRenderer, CONFIG as TERRAIN_CONFIG, roundCoord } from './terrain.js';
import { objectPlacer, modelManager } from './objects.js';
import { BlobShadow } from './blobshadow.js';
import { AudioManager } from './audio.js';
import { AIEnemy } from './ai-enemy.js';
// AVATAR CLONING FIX: Import SkeletonUtils for proper skinned mesh cloning
// If this doesn't work, revert to alternative approach (load model multiple times)
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// ==========================================
// GAME STATE MANAGEMENT
// ==========================================

class GameState {
    constructor() {
        this.clientId = 'client_' + Math.random().toString(36).substr(2, 12);
        this.isInChunk = false;
        this.currentPlayerChunkX = 0;
        this.currentPlayerChunkZ = 0;
        this.lastChunkX = null;
        this.lastChunkZ = null;

        // Movement state
        this.isMoving = false;
        this.playerTargetPosition = new THREE.Vector3();
        this.cameraTargetPosition = new THREE.Vector3();

        // Camera zoom (1.0 = default, 0.75 = 25% closer/zoomed in)
        this.cameraZoom = 1.0;
        this.cameraZoomMin = 0.75; // 25% closer than default
        this.cameraZoomMax = 1.0;  // Default distance

        // Object tracking
        this.nearestObject = null;
        this.nearestObjectDistance = Infinity;
        this.removedObjectsCache = new Map(); // Key: chunkKey, Value: Set of removed objectIds

        // Chopping/harvesting action state
        this.activeChoppingAction = null; // { object, startTime, duration, sound }
        this.harvestCooldown = null; // { endTime: timestamp }

        // Inventory system (configuration from config.js)
        this.inventoryOpen = false;
        this.inventory = {
            rows: CONFIG.INVENTORY.BACKPACK_ROWS,  // 10 rows from config
            cols: CONFIG.INVENTORY.BACKPACK_COLS,  // 5 columns from config
            slotSize: CONFIG.INVENTORY.DEFAULT_SLOT_SIZE,  // 60px, recalculated on resize
            gap: CONFIG.INVENTORY.DEFAULT_GAP,     // 2px gap, recalculated on resize
            items: [
                // Test item: pickaxe at position (0, 0)
                {
                    id: 'test_pickaxe',
                    type: 'pickaxe',
                    x: 0,
                    y: 0,
                    width: 2,
                    height: 5,
                    rotation: 0,
                    quality: 85,
                    durability: 60
                },
                // Test item: axe at position (0, 5)
                {
                    id: 'test_axe',
                    type: 'axe',
                    x: 0,
                    y: 5,
                    width: 2,
                    height: 5,
                    rotation: 0,
                    quality: 72,
                    durability: 88
                },
                // Test item: saw at position (2, 0)
                {
                    id: 'test_saw',
                    type: 'saw',
                    x: 2,
                    y: 0,
                    width: 2,
                    height: 5,
                    rotation: 0,
                    quality: 91,
                    durability: 45
                },
                // Test item: hammer at position (2, 5)
                {
                    id: 'test_hammer',
                    type: 'hammer',
                    x: 2,
                    y: 5,
                    width: 1,
                    height: 2,
                    rotation: 0,
                    quality: 68,
                    durability: 82
                },
                // Test item: chisel at position (2, 7)
                {
                    id: 'test_chisel',
                    type: 'chisel',
                    x: 2,
                    y: 7,
                    width: 1,
                    height: 2,
                    rotation: 0,
                    quality: 55,
                    durability: 71
                },
                // Test item: chiseled limestone at position (3, 7)
                {
                    id: 'test_chiseledlimestone',
                    type: 'chiseledlimestone',
                    x: 3,
                    y: 7,
                    width: 1,
                    height: 1,
                    rotation: 0,
                    quality: 80,
                    durability: null
                }
            ]
        };

        // Inventory interaction state (click-based pickup/place)
        this.inventoryPickedItem = null; // Item currently being held
        this.inventoryPickedOriginalX = 0;
        this.inventoryPickedOriginalY = 0;
        this.inventoryPickedOriginalRotation = 0;
        this.inventoryMouseX = 0;
        this.inventoryMouseY = 0;
        this.inventoryIgnoreNextMouseUp = false; // Flag to ignore mouseup from pickup click

        // Build menu system (configuration from config.js)
        this.buildMenuOpen = false;
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
            // Optional fields:
            // - requiresFoundation: true if structure must be placed on foundation (like crates)
            structures: [
                // Foundation structure
                {
                    id: 'foundation',
                    type: 'foundation',
                    name: 'Foundation',
                    width: 1,
                    height: 1,
                    imagePath: './structures/foundation.png'
                },
                {
                    id: 'foundationcorner',
                    type: 'foundationcorner',
                    name: 'Corner Foundation',
                    width: 1,
                    height: 1,
                    imagePath: './structures/foundationcorner.png'
                },
                {
                    id: 'foundationroundcorner',
                    type: 'foundationroundcorner',
                    name: 'Round Corner Foundation',
                    width: 1,
                    height: 1,
                    imagePath: './structures/foundationroundcorner.png'
                },
                // Crate structure (requires foundation)
                {
                    id: 'crate',
                    type: 'crate',
                    name: 'Crate',
                    width: 1,
                    height: 1,
                    imagePath: './structures/crate.png',
                    requiresFoundation: true  // Special flag for structures that need foundation
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
                }
            ]
        };

        // Build menu interaction state
        this.buildMenuPickedStructure = null; // Structure currently being held for placement

        // Construction inventory system
        this.constructionInventoryOpen = false;
        this.nearestConstructionSite = null;
        this.nearestConstructionSiteDistance = Infinity;

        // Crate inventory system
        this.crateInventoryOpen = false;
        this.nearestCrate = null;
        this.nearestCrateDistance = Infinity;

        // Foundation placement state
        this.foundationPlacement = {
            active: false,
            phase: null,  // 'position' -> 'rotation' -> 'height' -> 'confirmed'
            structure: null,
            position: { x: 0, y: 0, z: 0 },
            rotation: 0,  // In degrees (snaps to 15°)
            height: 0,    // Relative to terrain (snaps to 0.5)
            previewBox: null,
            isValid: false,
            invalidReason: '',
            initialMouseY: 0  // Track mouse Y when entering height phase
        };

        // Chiseling state
        this.chiselTarget = null;

        // Timing
        this.lastChunkUpdateTime = 0;
        this.lastProximityCheckTime = 0;
        this.lastPeerCheckTime = 0;
        this.lastFrameTime = performance.now();
    }

    updateChunkPosition(newX, newZ) {
        this.lastChunkX = this.currentPlayerChunkX;
        this.lastChunkZ = this.currentPlayerChunkZ;
        this.currentPlayerChunkX = newX;
        this.currentPlayerChunkZ = newZ;
    }
}

// ==========================================
// NETWORK MANAGER
// ==========================================

class NetworkManager {
    constructor(gameState, onMessageCallback) {
        this.gameState = gameState;
        this.onMessageCallback = onMessageCallback;
        this.ws = null;
        this.wsRetryAttempts = 0;
        this.wsMaxRetries = 10;
        this.wsRetryInterval = 5000;

        // P2P state
        this.peers = new Map();
        this.avatars = new Map();
        this.playerObject = null; // Set later by setPlayerObject()
        this.audioManager = null; // Set later by setAudioManager()
        this.aiEnemy = null; // Set later by setAIEnemy()
        this.game = null; // Set later by setGame()
        this.scene = null; // Set later by setScene()
    }

    setPlayerObject(playerObject) {
        this.playerObject = playerObject;
    }

    setAudioManager(audioManager) {
        this.audioManager = audioManager;
    }

    setAIEnemy(aiEnemy) {
        this.aiEnemy = aiEnemy;
    }

    setGame(game) {
        this.game = game;
    }

    setScene(scene) {
        this.scene = scene;
    }

connect(online = true) {
    const url = online ? 'wss://multiplayer-game-dcwy.onrender.com' : 'ws://localhost:8080';
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
    }

    this.ws = new WebSocket(url);
    this.setupWebSocketHandlers();
}

    setupWebSocketHandlers() {
        this.ws.onopen = () => {
            ui.updateStatus("✅ Connected to server");
            ui.updateConnectionStatus('connected', '✅ Server Connected');
            this.wsRetryAttempts = 0;
            this.onMessageCallback('server_connected', {});
        };

        this.ws.onclose = (event) => {
            ui.updateStatus(`❌ Server disconnected (${event.code})`);
            ui.updateConnectionStatus('disconnected', '❌ Server Disconnected');
            this.gameState.isInChunk = false;
            ui.updateButtonStates(false, null, false, false, false, null, false);
            this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
            ui.updateStatus(`❌ Server error: ${error.message || 'Unknown error'}`);
            ui.updateConnectionStatus('disconnected', '❌ Server Error');
        };

        this.ws.onmessage = async (event) => {
            const messageData = event.data instanceof Blob ?
                await event.data.text() : event.data;

            try {
                const data = JSON.parse(messageData);
                console.log('RAW MESSAGE RECEIVED:', data);
                ui.updateStatus(`📥 Server: ${data.type}`);
                this.onMessageCallback(data.type, data.payload);
            } catch (error) {
                ui.updateStatus(`❌ Invalid server message: ${error.message}`);
            }
        };
    }

    attemptReconnect() {
        if (this.wsRetryAttempts < this.wsMaxRetries) {
            this.wsRetryAttempts++;
            ui.updateStatus(`Attempting reconnection ${this.wsRetryAttempts} of ${this.wsMaxRetries}...`);
            setTimeout(() => this.connect(), this.wsRetryInterval);
        } else {
            ui.updateStatus(`❌ Max reconnection attempts reached. Please refresh.`);
            ui.updateConnectionStatus('disconnected', '❌ Disconnected');
        }
    }

    sendMessage(type, payload) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type, payload }));
            ui.updateStatus(`📤 Sent ${type} to server`);
            return true;
        }
        ui.updateStatus(`❌ Failed to send ${type}: No server connection`);
        return false;
    }

    // --- P2P Methods ---
    createPeerConnection(peerId, isInitiator = false) {
        const config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        const connection = new RTCPeerConnection(config);

        // Check if peer already exists (might have been created in staggerP2PInitiations)
        const existingPeer = this.peers.get(peerId);

        const peerState = {
            connection,
            dataChannel: null,
            state: 'connecting',
            isInitiator,
            targetPosition: null,
            moveStartTime: null,
            // Preserve AI enemy if it was already created
            aiEnemy: existingPeer?.aiEnemy || null,
            aiEnemyMoving: existingPeer?.aiEnemyMoving || false
        };

        this.peers.set(peerId, peerState);

        connection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendMessage('webrtc_ice_candidate', {
                    recipientId: peerId,
                    senderId: this.gameState.clientId,
                    candidate: event.candidate
                });
            }
        };

        connection.onconnectionstatechange = () => {
            peerState.state = connection.connectionState;
            ui.updateStatus(`P2P ${peerId}: ${connection.connectionState}`);
            ui.updatePeerInfo(this.peers, this.avatars);
        };

        if (isInitiator) {
            const dataChannel = connection.createDataChannel('game', { ordered: true });
            this.setupDataChannel(dataChannel, peerId);
            peerState.dataChannel = dataChannel;
        } else {
            connection.ondatachannel = (event) => {
                this.setupDataChannel(event.channel, peerId);
                peerState.dataChannel = event.channel;
            };
        }

        return connection;
    }

    setupDataChannel(dataChannel, peerId) {
        dataChannel.onopen = () => {
            ui.updateStatus(`P2P data channel opened with ${peerId}`);
            ui.updatePeerInfo(this.peers, this.avatars);

            // Send initial state to newly connected peer (mutual sync)
            if (this.playerObject) {
                const message = {
                    type: 'player_sync',
                    payload: {
                        position: this.playerObject.position.toArray(),
                        target: this.gameState.isMoving ?
                                this.gameState.playerTargetPosition.toArray() : null
                    }
                };
                dataChannel.send(JSON.stringify(message));
                console.log(`Sent initial state to peer ${peerId}`);

                // Send AI enemy initial position (if alive)
                if (this.aiEnemy && !this.gameState.aiEnemyIsDead) {
                    const aiMessage = {
                        type: 'ai_enemy_update',
                        payload: {
                            position: this.aiEnemy.position.toArray(),
                            moving: this.gameState.aiEnemyMoving || false
                        }
                    };
                    dataChannel.send(JSON.stringify(aiMessage));
                    console.log(`Sent AI enemy initial state to peer ${peerId}`);
                }
            }
        };

        dataChannel.onclose = () => {
            ui.updateStatus(`P2P data channel closed with ${peerId}`);
            ui.updatePeerInfo(this.peers, this.avatars);
        };

        dataChannel.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleP2PMessage(message, peerId);
            } catch (error) {
                ui.updateStatus(`❌ Invalid P2P message from ${peerId}: ${error.message}`);
            }
        };
    }

    handleP2PMessage(message, fromPeer) {
        const peer = this.peers.get(fromPeer);
        const avatar = this.avatars.get(fromPeer);

        if (!peer || !avatar) return;

        switch (message.type) {
            case 'player_move':
                avatar.position.fromArray(message.payload.start);
                peer.targetPosition = new THREE.Vector3().fromArray(message.payload.target);
                peer.moveStartTime = performance.now();
                break;

            case 'player_sync':
                avatar.position.fromArray(message.payload.position);
                if (message.payload.target) {
                    peer.targetPosition = new THREE.Vector3().fromArray(message.payload.target);
                    peer.moveStartTime = performance.now();
                } else {
                    // No target means player has stopped (e.g., blocked by structure)
                    peer.targetPosition = null;
                    avatar.userData.isMoving = false;
                }
                break;

            case 'player_harvest':
                // Store harvest state for this peer
                peer.harvestState = {
                    harvestType: message.payload.harvestType,
                    startTime: message.payload.startTime,
                    duration: message.payload.duration,
                    endTime: message.payload.startTime + message.payload.duration
                };

                // Play chopping animation for peer avatar if available
                if (peer.animationMixer && peer.choppingAction) {
                    peer.choppingAction.reset();
                    peer.choppingAction.play();
                }

                console.log(`Peer ${fromPeer} started harvesting ${message.payload.harvestType}`);
                break;

            case 'player_sound':
                // Play positional sound attached to peer's avatar
                if (this.audioManager && avatar) {
                    this.audioManager.playPositionalSound(message.payload.soundType, avatar);
                    console.log(`Playing ${message.payload.soundType} sound for peer ${fromPeer}`);
                }
                break;

            case 'ai_enemy_update':
                // Create AI enemy if it doesn't exist yet
                if (!peer.aiEnemy) {
                    const aiEnemy = this.game.createPeerAIEnemy();
                    if (aiEnemy) {
                        // Initialize position directly for first time
                        aiEnemy.position.fromArray(message.payload.position);
                        this.scene.add(aiEnemy);
                        peer.aiEnemy = aiEnemy;
                        peer.aiEnemyMoving = false;
                        peer.aiEnemyTargetPosition = aiEnemy.position.clone();
                        console.log(`Created AI enemy for peer ${fromPeer} from sync message`);
                    }
                }

                // Update peer's AI enemy position (smooth interpolation)
                if (peer.aiEnemy) {
                    // Store target position for smooth interpolation
                    peer.aiEnemyTargetPosition = new THREE.Vector3().fromArray(message.payload.position);
                    peer.aiEnemyMoving = message.payload.moving;
                }
                break;

            case 'ai_enemy_shoot':
                // Play rifle sound on peer's AI enemy
                if (peer.aiEnemy && this.audioManager) {
                    this.audioManager.playPositionalSound('rifle', peer.aiEnemy);
                    console.log(`Peer ${fromPeer}'s AI enemy shooting!`);
                }

                // If the shot hit and this client is the target, apply death
                if (message.payload.isHit) {
                    if (message.payload.targetIsLocalPlayer && !this.game.isDead) {
                        this.game.killEntity(this.playerObject, false, false);
                        console.log('Local player was killed by peer AI!');
                    }
                }
                break;

            case 'player_shoot':
                // Play rifle sound for peer's player
                if (avatar && this.audioManager) {
                    this.audioManager.playPositionalSound('rifle', avatar);
                    console.log(`Peer ${fromPeer} shooting!`);
                }

                // If the shot hit and this client's AI is the target, apply death
                if (message.payload.isHit) {
                    if (message.payload.targetIsLocalAI && !this.game.aiEnemyIsDead) {
                        this.game.killEntity(this.game.aiEnemy, true, false);
                        console.log('Local AI was killed by peer player!');
                    }
                }
                break;

            case 'ai_control_handoff':
                // Update AI ownership based on handoff message
                const handoffData = message.payload;

                // Ignore stale messages (older than 3 seconds)
                if (Date.now() - handoffData.timestamp > 3000) {
                    console.log('Ignoring stale AI control handoff message');
                    return;
                }

                // Update ownership
                const previousOwner = this.game.aiEnemyOwner;
                this.game.aiEnemyOwner = handoffData.newOwner;

                console.log(`Received AI control handoff from ${fromPeer}: ${previousOwner} -> ${handoffData.newOwner}`);

                // If I'm the new owner, sync position to avoid jumps
                if (this.game.aiEnemyOwner === this.gameState.clientId && this.aiEnemy) {
                    this.aiEnemy.position.fromArray(handoffData.position);
                    console.log('I am now controlling the AI');
                }
                break;

            case 'ai_enemy_spawn':
                // Create peer's AI enemy if it doesn't exist yet
                if (!peer.aiEnemy) {
                    const aiEnemy = this.game.createPeerAIEnemy();
                    if (aiEnemy) {
                        aiEnemy.position.fromArray(message.payload.position);
                        this.scene.add(aiEnemy);
                        peer.aiEnemy = aiEnemy;
                        peer.aiEnemyMoving = false;
                        peer.aiEnemyTargetPosition = aiEnemy.position.clone();
                        console.log(`Created AI enemy for peer ${fromPeer} from spawn message`);
                    }
                }
                break;

            case 'ai_enemy_death':
                // Mark peer's AI as dead
                if (peer.aiEnemy && !peer.aiEnemy.userData.isDead) {
                    this.game.killEntity(peer.aiEnemy, true, true);
                    console.log(`Peer ${fromPeer}'s AI was killed`);
                }
                break;

            case 'player_death':
                // Mark peer player as dead
                if (avatar && !avatar.userData.isDead) {
                    this.game.killEntity(avatar, false, true);
                    console.log(`Peer ${fromPeer} player was killed`);
                }
                break;
        }
    }

    broadcastP2P(message) {
        let sentCount = 0;
        this.peers.forEach((peer) => {
            if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
                try {
                    peer.dataChannel.send(JSON.stringify(message));
                    sentCount++;
                } catch (error) {
                    console.error('Failed to send P2P message:', error);
                }
            }
        });
        return sentCount;
    }

    cleanupPeer(peerId, scene) {
        const peer = this.peers.get(peerId);
        if (peer) {
            if (peer.dataChannel) peer.dataChannel.close();
            if (peer.connection) peer.connection.close();
            this.peers.delete(peerId);
        }

        const avatar = this.avatars.get(peerId);
        if (avatar) {
            scene.remove(avatar);
            if (avatar.geometry) avatar.geometry.dispose();
            if (avatar.material) avatar.material.dispose();
            this.avatars.delete(peerId);
        }

        ui.updatePeerInfo(this.peers, this.avatars);
    }
}

// ==========================================
// CHUNK MANAGER
// ==========================================

class ChunkManager {
    constructor(gameState, terrainRenderer, scene) {
        this.gameState = gameState;
        this.terrainRenderer = terrainRenderer;
        this.scene = scene;
        this.loadRadius = TERRAIN_CONFIG.TERRAIN.renderDistance;
        this.chunkSize = TERRAIN_CONFIG.TERRAIN.chunkSize;
        this.pendingChunkCreations = []; // Queue for throttled chunk creation
        this.pendingChunkDisposals = []; // Queue for deferred chunk disposal
        this.lastPlayerChunkX = 0;
        this.lastPlayerChunkZ = 0;
        this.movementDirectionX = 0;
        this.movementDirectionZ = 0;
        this.scheduleIdleCleanup();
    }

    updatePlayerChunk(playerX, playerZ) {
        const newChunkX = Math.floor(roundCoord(playerX) / this.chunkSize);
        const newChunkZ = Math.floor(roundCoord(playerZ) / this.chunkSize);

        if (newChunkX === this.gameState.currentPlayerChunkX &&
            newChunkZ === this.gameState.currentPlayerChunkZ) {
            return false; // No change
        }

        // Track movement direction for predictive loading
        if (this.lastPlayerChunkX !== 0 || this.lastPlayerChunkZ !== 0) {
            this.movementDirectionX = newChunkX - this.lastPlayerChunkX;
            this.movementDirectionZ = newChunkZ - this.lastPlayerChunkZ;
        } else {
            // First move - initialize last position
            this.lastPlayerChunkX = this.gameState.currentPlayerChunkX;
            this.lastPlayerChunkZ = this.gameState.currentPlayerChunkZ;
        }

        this.lastPlayerChunkX = newChunkX;
        this.lastPlayerChunkZ = newChunkZ;

        this.gameState.updateChunkPosition(newChunkX, newChunkZ);
        this.updateChunksAroundPlayer(newChunkX, newChunkZ);
        return true;
    }

    updateChunksAroundPlayer(chunkX, chunkZ) {
        const chunksToKeep = new Set();
        const chunksToCreate = [];

        for (let x = -this.loadRadius; x <= this.loadRadius; x++) {
            for (let z = -this.loadRadius; z <= this.loadRadius; z++) {
                const gridX = chunkX + x;
                const gridZ = chunkZ + z;
                const key = `${gridX},${gridZ}`;
                chunksToKeep.add(key);

                if (!this.terrainRenderer.chunkMap.has(key)) {
                    // Calculate distance from player chunk and alignment with movement
                    const distance = Math.abs(x) + Math.abs(z);
                    const alignment = (x * this.movementDirectionX) + (z * this.movementDirectionZ);

                    // Instead of creating immediately, add to pending queue with priority
                    chunksToCreate.push({
                        gridX,
                        gridZ,
                        key,
                        distance,
                        alignment
                    });
                }
            }
        }

        // Clear old pending chunks that are no longer needed
        this.pendingChunkCreations = this.pendingChunkCreations.filter(pending =>
            chunksToKeep.has(pending.key)
        );

        // Add new chunks to queue (avoid duplicates)
        chunksToCreate.forEach(chunk => {
            if (!this.pendingChunkCreations.some(pending => pending.key === chunk.key)) {
                this.pendingChunkCreations.push(chunk);
            }
        });

        // Sort queue by priority: prefer chunks in movement direction, then by distance
        this.pendingChunkCreations.sort((a, b) => {
            // Higher alignment (in movement direction) = higher priority (lower sort value)
            // Lower distance = higher priority (lower sort value)
            const priorityA = a.distance - (a.alignment * 2); // Weight alignment heavily
            const priorityB = b.distance - (b.alignment * 2);
            return priorityA - priorityB;
        });

        Array.from(this.terrainRenderer.chunkMap.keys()).forEach(key => {
            if (!chunksToKeep.has(key)) {
                // Queue chunk for disposal instead of disposing immediately
                if (!this.pendingChunkDisposals.includes(key)) {
                    this.pendingChunkDisposals.push(key);
                }
            }
        });
    }

    scheduleIdleCleanup() {
        // Don't use requestIdleCallback in games - it waits for browser idle which rarely happens
        // Instead, use a regular timer to ensure chunks get disposed promptly
        // Process disposal queue every 4 seconds to prioritize new chunk creation when crossing borders
        setTimeout(() => {
            this.processDisposalQueue();
            // Reschedule for continuous cleanup
            this.scheduleIdleCleanup();
        }, 4000); // Process every 4 seconds to prioritize new chunk creation
    }

    processDisposalQueue() {
        // Process up to 4 chunk disposals per idle callback (increased from 2)
        const batchSize = 4;
        let processed = 0;
        const startTime = performance.now();
        let attempts = 0;
        const maxAttempts = this.pendingChunkDisposals.length; // Prevent infinite loop

        // Log when disposal runs
        if (this.pendingChunkDisposals.length > 0) {
            console.log(`🔄 Processing disposal queue (${this.pendingChunkDisposals.length} chunks pending)`);
        }

        while (this.pendingChunkDisposals.length > 0 && processed < batchSize && attempts < maxAttempts) {
            attempts++;
            const key = this.pendingChunkDisposals[0]; // PEEK at first item, don't remove yet

            // Check if chunk exists OR is still being processed OR in vertex queue
            const inChunkMap = this.terrainRenderer.chunkMap.has(key);
            const inProcessing = this.terrainRenderer.processingChunks.has(key);
            const inVertexQueue = this.terrainRenderer.pendingVertexUpdates.some(task => task.key === key);

            console.log(`  Checking chunk ${key}: map=${inChunkMap}, processing=${inProcessing}, vertex=${inVertexQueue}`);

            if (inChunkMap || inProcessing || inVertexQueue) {
                // Now we can remove it from queue and dispose
                this.pendingChunkDisposals.shift();
                const disposeStartTime = performance.now();
                this.disposeChunk(key);
                const disposeTime = performance.now() - disposeStartTime;
                if (disposeTime > 5) {
                    console.log(`⚠️ Chunk disposal took ${disposeTime.toFixed(2)}ms for ${key}`);
                }
                processed++;

                // Log what state the chunk was in when disposed
                if (!inChunkMap && (inProcessing || inVertexQueue)) {
                    console.log(`🧹 Disposed in-progress chunk ${key} (processing: ${inProcessing}, queued: ${inVertexQueue})`);
                }
            } else {
                // Chunk not found anywhere - might be truly stuck or already gone
                this.pendingChunkDisposals.shift(); // Remove it anyway
                console.log(`❓ Chunk ${key} not found anywhere, removing from disposal queue`);
            }
        }

        const totalTime = performance.now() - startTime;
        if (processed > 0 && totalTime > 10) {
            console.log(`⚠️ Disposal batch took ${totalTime.toFixed(2)}ms for ${processed} chunks`);
        }
    }

    processChunkQueue() {
        // Process only 1 chunk per frame for smooth performance
        if (this.pendingChunkCreations.length > 0) {
            const startTime = performance.now();
            const chunk = this.pendingChunkCreations.shift();
            this.createChunk(chunk.gridX, chunk.gridZ);
            const elapsed = performance.now() - startTime;
            if (elapsed > 5) {
                console.log(`⚠️ Chunk creation took ${elapsed.toFixed(2)}ms for ${chunk.key}`);
            }
            return true; // Chunk was created
        }
        return false; // No chunks to create
    }

createChunk(gridX, gridZ) {
    const worldX = gridX * this.chunkSize;
    const worldZ = gridZ * this.chunkSize;
    const chunkKey = `${gridX},${gridZ}`;

    // ALWAYS ensure cache has an entry for this chunk (even if empty)
    if (!this.gameState.removedObjectsCache.has(chunkKey)) {
        this.gameState.removedObjectsCache.set(chunkKey, new Set());
    }

    // Get cached removals for this chunk (now guaranteed to be a Set)
    const removedIds = this.gameState.removedObjectsCache.get(chunkKey);

    // Pass removals to terrain renderer
    this.terrainRenderer.createChunk(worldX, worldZ, removedIds);
}

    applyChunkRemovals(chunkKey) {
    const objects = this.terrainRenderer.chunkTrees.get(chunkKey);
    if (!objects) {
        return;
    }

    const removedIds = this.gameState.removedObjectsCache.get(chunkKey);
    if (!removedIds || removedIds.size === 0) {
        return;
    }

    // Remove objects that are in the removal list
    objects.forEach(obj => {
        const objectId = obj.userData.objectId;
        if (removedIds.has(objectId)) {
            this.scene.remove(obj);
            this.disposeObject(obj);
        }
    });

    // Filter out the removed objects from the tracked array
    const keptObjects = objects.filter(obj => !removedIds.has(obj.userData.objectId));
    this.terrainRenderer.chunkTrees.set(chunkKey, keptObjects);
}

    disposeChunk(key) {
    this.terrainRenderer.disposeChunk(key);
}

    removeObject(objectId) {
        const object = objectPlacer.findObjectById(this.scene, objectId);
        if (object && object.userData.chunkKey) {
            const chunkKey = object.userData.chunkKey;

            // Add to cache
            if (!this.gameState.removedObjectsCache.has(chunkKey)) {
                this.gameState.removedObjectsCache.set(chunkKey, new Set());
            }
            this.gameState.removedObjectsCache.get(chunkKey).add(objectId);

            // Remove from scene
            this.scene.remove(object);
            this.disposeObject(object);
            // Remove from chunkTrees array
        const trees = this.terrainRenderer.chunkTrees.get(chunkKey);
        if (trees) {
            const filteredTrees = trees.filter(obj => obj.userData.objectId !== objectId);
            this.terrainRenderer.chunkTrees.set(chunkKey, filteredTrees);
        }

            // Update nearest object if this was it
            if (this.gameState.nearestObject && this.gameState.nearestObject.id === objectId) {
                this.gameState.nearestObject = null;
                this.gameState.nearestObjectDistance = Infinity;
                ui.updateNearestObject(null, null, null, null, null);
                ui.updateButtonStates(this.gameState.isInChunk, null, false, false, false, null, this.gameState.isMoving);
            }
            return true;
        }
        return false;
    }

    disposeObject(object) {
        // Dispose blob shadow first
        if (object.userData && object.userData.blobShadow) {
            object.userData.blobShadow.dispose();
            object.userData.blobShadow = null;
        }

        // Dispose mesh resources
        object.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(mat => mat.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            }
        });
    }
}


// ==========================================
// MAIN GAME CLASS
// ==========================================

class MultiplayerGame {
    constructor() {
        this.gameState = new GameState();
        this.setupScene();
        this.setupRenderers();
        this.setupNetworking();
        this.setupInput();
        this.setupUI();

        // Animation constants
        this.playerSpeed = 0.0005;  // change to 0.0005 when done testing
        this.stopThreshold = 0.01;
        this.chunkUpdateInterval = 1000;
        this.proximityCheckInterval = 2000;
        this.peerCheckInterval = 5000;

        // Create throttled validation function to reduce lag spikes
        this.validationThrottleTimeout = null;
        this.validateFoundationPlacementThrottled = () => {
            // Clear existing timeout
            if (this.validationThrottleTimeout) {
                clearTimeout(this.validationThrottleTimeout);
            }
            // Set new timeout for validation (50ms delay)
            this.validationThrottleTimeout = setTimeout(() => {
                this.validateFoundationPlacement();
            }, 50);
        };

        // FPS tracking
        this.fpsFrames = 0;
        this.fpsLastTime = performance.now();
        this.fpsUpdateInterval = 500; // Update FPS display every 500ms

        // Frame counter for diagnostic logging
        this.frameCount = 0;
    }

    setupScene() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1.0, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x000011);
        // Shadow mapping disabled - using blob shadows instead
        document.body.appendChild(this.renderer.domElement);

        // Increase ambient light for better visibility
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.0); // Increased from 0.6
        this.scene.add(ambientLight);

        // Add a second directional light from the opposite side for fill lighting
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
        fillLight.position.set(-10, 10, -10);
        this.scene.add(fillLight);

        this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
        this.directionalLight.position.set(15, 20, 0);
        this.scene.add(this.directionalLight);

        // Create player object (will be replaced with man model after loading)
        this.playerObject = new THREE.Group();
        // Generate spawn offset based on clientId to prevent players spawning in same spot
        const spawnOffsetX = (Math.random() - 0.5) * 4; // Random offset -2 to +2
        const spawnOffsetZ = (Math.random() - 0.5) * 4; // Random offset -2 to +2
        this.playerObject.position.set(1.5 + spawnOffsetX, 1.21, -2 + spawnOffsetZ);
        this.scene.add(this.playerObject);

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

        // Player shooting state
        this.playerShootTarget = null;
        this.playerLastShootTime = 0;
        this.playerShootInterval = 6000; // 6 seconds between shots
        this.playerLastTargetCheckTime = 0;
        this.playerInCombatStance = false; // Within 15 units of enemy
        this.playerShootingPauseEndTime = 0; // 1 second pause after shooting

        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();

        // Initialize audio manager
        this.audioManager = new AudioManager(this.camera);
        this.audioManager.loadSounds();
    }

    setupRenderers() {
        this.terrainRenderer = new SimpleTerrainRenderer(this.scene);
        this.waterRenderer = new WaterRenderer(this.scene, 1.02, this.terrainRenderer);
        this.terrainRenderer.setWaterRenderer(this.waterRenderer);

        this.chunkManager = new ChunkManager(
            this.gameState,
            this.terrainRenderer,
            this.scene
        );
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
    }

    setupInput() {
        window.addEventListener('pointerdown', this.onPointerDown.bind(this));
        window.addEventListener('pointermove', this.onPointerMove.bind(this));

        // Keyboard input for inventory and build menu toggle
        window.addEventListener('keydown', (event) => {
            if (event.key === 'i' || event.key === 'I') {
                this.toggleInventory();
            }
            if (event.key === 'b' || event.key === 'B') {
                this.toggleBuildMenu();
            }
            // ESC key cancels foundation placement
            if (event.key === 'Escape' && this.gameState.foundationPlacement.active) {
                this.cancelFoundationPlacement();
                ui.updateStatusLine1('Placement cancelled', 3000);
            }
        });

        // Zoom controls
        const zoomInBtn = document.getElementById('zoomInBtn');
        const zoomOutBtn = document.getElementById('zoomOutBtn');

        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', () => {
                this.zoomIn();
            });
        }

        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', () => {
                this.zoomOut();
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
            onRemoveObject: (object) => {
                if (object) {
                    // Check if it's a log - if so, treat as firewood harvest
                    const isLog = object.name.endsWith('_log') || object.name === 'log';
                    const isRock = object.name === 'limestone' || object.name === 'sandstone';

                    if (isLog) {
                        this.startHarvestAction(object, 'firewood');
                    } else if (isRock) {
                        this.startHarvestAction(object, 'stone');
                    } else {
                        // Start the chopping action for trees (includes timer, animation, sound)
                        this.startChoppingAction(object);
                    }
                }
            },
            onHarvestLog: (object, harvestType) => {
                if (object) {
                    this.startHarvestAction(object, harvestType);
                }
            },
            onResize: this.onResize.bind(this),
            resumeAudio: () => {
                if (this.audioManager) {
                    this.audioManager.resumeContext();
                }
            },
            toggleInventory: this.toggleInventory.bind(this),
            toggleBuildMenu: this.toggleBuildMenu.bind(this),
            toggleConstructionInventory: this.toggleConstructionInventory.bind(this),
            onBuildConstruction: this.startBuildAction.bind(this)
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

        // AI enemies - one per tent (spawned when tent loads)
        // Map structure: tentObjectId -> { controller: AIEnemy, tentObjectId: string, isDead: boolean }
        this.tentAIEnemies = new Map();

        // Track tents that have had their AI die (to prevent respawn)
        this.deadTentAIs = new Set(); // Set of tent object IDs

        // Legacy AI support (for backward compatibility with existing code)
        this.aiEnemyController = null;
        this.aiEnemy = null;

        // Initialize inventory UI
        this.initializeInventory();

        // Initialize build menu UI
        this.initializeBuildMenu();

        this.networkManager.connect();
        this.animate();
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

        // Debug: Log all meshes in the model
        console.log('Man model structure:');
        playerMesh.traverse((child) => {
            if (child.isMesh || child.isSkinnedMesh) {
                const matInfo = child.material ?
                    `mat: ${child.material.type}, opacity: ${child.material.opacity}, transparent: ${child.material.transparent}` :
                    'no material';
                console.log(`  - ${child.name} (${child.type}), visible: ${child.visible}, ${matInfo}, hasGeometry: ${!!child.geometry}`);
            }
        });

        // Setup materials and proper lighting
        playerMesh.traverse((child) => {
            if (child.isMesh || child.isSkinnedMesh) {
                child.visible = true; // Ensure visibility
                child.frustumCulled = false; // Disable frustum culling
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

        console.log(`Player model center offset: ${this.playerModelOffset}`);
        console.log(`Player model height: ${this.playerModelHeight.toFixed(3)}`);

        // Setup animation
        if (manGLTF.animations && manGLTF.animations.length > 0) {
            this.animationMixer = new THREE.AnimationMixer(playerMesh);

            // Search for walk animation by name
            const walkAnimation = manGLTF.animations.find(anim =>
                anim.name.toLowerCase().includes('walk')
            );

            if (walkAnimation) {
                console.log(`Found walk animation: ${walkAnimation.name}`);
                this.animationAction = this.animationMixer.clipAction(walkAnimation);
                this.animationAction.play();
            } else {
                console.warn('Walk animation not found, available animations:',
                    manGLTF.animations.map(a => a.name));
            }

            // Search for chopping/pickaxe animation
            const choppingAnimation = manGLTF.animations.find(anim => {
                const name = anim.name.toLowerCase();
                return name.includes('chop') || name.includes('pickaxe') ||
                       name.includes('axe') || name.includes('swing') ||
                       name.includes('mine') || name.includes('dig');
            });

            if (choppingAnimation) {
                console.log(`Found chopping animation: ${choppingAnimation.name}`);
                this.choppingAction = this.animationMixer.clipAction(choppingAnimation);
                this.choppingAction.loop = THREE.LoopRepeat;
            } else {
                console.warn('Chopping animation not found, will use walk animation as fallback');
                console.log('Available animations:', manGLTF.animations.map(a => a.name));
                // Use walk animation as fallback for chopping
                if (walkAnimation) {
                    this.choppingAction = this.animationMixer.clipAction(walkAnimation);
                    this.choppingAction.loop = THREE.LoopRepeat;
                }
            }

            // Search for shooting animation
            const shootAnimation = manGLTF.animations.find(anim => {
                const name = anim.name.toLowerCase();
                return name.includes('shoot') || name.includes('fire') ||
                       name.includes('rifle') || name.includes('gun') ||
                       name.includes('aim');
            });

            if (shootAnimation) {
                console.log(`Found shoot animation: ${shootAnimation.name}`);
                this.shootAction = this.animationMixer.clipAction(shootAnimation);
                this.shootAction.loop = THREE.LoopOnce; // Play once per trigger
                this.shootAction.clampWhenFinished = true; // Hold last frame
            } else {
                console.warn('Shoot animation not found, available animations:',
                    manGLTF.animations.map(a => a.name));
            }
        }

        // Set player object reference in NetworkManager for P2P state sync
        this.networkManager.setPlayerObject(this.playerObject);
    }


    // --- Server Message Handlers ---

    handleServerMessage(type, payload) {
        switch (type) {
            case 'server_connected':
                this.handleServerConnected();
                break;
            case 'webrtc_offer':
                this.handleWebRTCOffer(payload);
                break;
            case 'webrtc_answer':
                this.handleWebRTCAnswer(payload);
                break;
            case 'webrtc_ice_candidate':
                this.handleWebRTCIceCandidate(payload);
                break;
            case 'proximity_update':
                this.handleProximityUpdate(payload);
                break;
            case 'object_removed':
                this.handleObjectRemoved(payload);
                break;
            case 'object_added':
                this.handleObjectAdded(payload);
                break;
            case 'resource_harvested':
                this.handleResourceHarvested(payload);
                break;
            case 'harvest_lock_failed':
                this.handleHarvestLockFailed(payload);
                break;
            case 'chunk_objects_state':
                this.handleChunkObjectsState(payload);
                break;
            case 'crate_inventory_response':
                this.handleCrateInventoryResponse(payload);
                break;
            case 'crate_inventory_updated':
                this.handleCrateInventoryUpdated(payload);
                break;
        }
    }

    handleServerConnected() {
    const { chunkSize } = TERRAIN_CONFIG.TERRAIN;
    const initialChunkX = Math.floor(this.playerObject.position.x / chunkSize);
    const initialChunkZ = Math.floor(this.playerObject.position.z / chunkSize);
    const chunkId = `chunk_${initialChunkX},${initialChunkZ}`;

    const success = this.networkManager.sendMessage('join_chunk', {
        chunkId,
        clientId: this.gameState.clientId
    });

    if (success) {
        this.gameState.isInChunk = true;
        this.gameState.updateChunkPosition(initialChunkX, initialChunkZ);
        ui.updateButtonStates(true, null, false, false, false, null, this.gameState.isMoving);
    }

    // Don't create chunks yet - wait for server state
}

    handleChunkObjectsState(payload) {
    const { objectChanges } = payload;
    if (!objectChanges || !Array.isArray(objectChanges)) return;

    // Group changes by chunk
    const changesByChunk = new Map();

    objectChanges.forEach(change => {
        if (change.action === 'remove') {
            // Handle missing chunkId (old format or corrupted data)
            if (!change.chunkId) {
                console.warn(`Remove action missing chunkId for object ${change.id}, skipping`);
                return;
            }

            const chunkKey = change.chunkId.replace('chunk_', '');

            // Add to cache
            if (!this.gameState.removedObjectsCache.has(chunkKey)) {
                this.gameState.removedObjectsCache.set(chunkKey, new Set());
            }
            this.gameState.removedObjectsCache.get(chunkKey).add(change.id);

            // Track which chunks need removal applied
            changesByChunk.set(chunkKey, true);
        } else if (change.action === 'add') {
            // Handle added objects (logs, etc.)
            const chunkKey = change.chunkId.replace('chunk_', '');

            // Check if object was recently deleted - prevent re-adding depleted resources from stale chunk state
            const removedSet = this.gameState.removedObjectsCache.get(chunkKey);
            if (removedSet && removedSet.has(change.id)) {
                console.log(`[DEPLETION FIX] Blocking re-add of deleted object ${change.id} (${change.name}) - was removed and still in cache`);
                return; // Skip this object - it was deleted
            }

            // Check if object already exists in scene (prevent duplicates on chunk crossing)
            let existingObject = null;
            this.scene.traverse((object) => {
                if (object.userData && object.userData.objectId === change.id) {
                    existingObject = object;
                }
            });

            if (existingObject) {
                // Object already exists - update its properties instead of creating duplicate
                existingObject.userData.remainingResources = change.remainingResources || null;
                existingObject.userData.totalResources = change.totalResources || null;
                console.log(`Object ${change.id} already exists, updated resources to ${change.remainingResources}/${change.totalResources}`);
            } else {
                console.log(`[RE-ADD CHECK] Attempting to add object ${change.id} (${change.name}) with ${change.remainingResources}/${change.totalResources} resources`);

                // Object doesn't exist - create it
                const objectPosition = new THREE.Vector3(change.position[0], change.position[1], change.position[2]);
                // Use stored rotation if available (for structures), otherwise random
                const objectRotation = change.rotation !== undefined ? (change.rotation * Math.PI / 180) : (Math.random() * Math.PI * 2);
                const objectInstance = objectPlacer.createInstance(
                    change.name,
                    objectPosition,
                    change.scale,
                    objectRotation,
                    this.scene
                );

                if (objectInstance) {
                    objectInstance.userData.objectId = change.id;
                    objectInstance.userData.chunkKey = chunkKey;
                    objectInstance.userData.quality = change.quality;
                    objectInstance.userData.modelType = change.name;
                    objectInstance.userData.totalResources = change.totalResources || null;
                    objectInstance.userData.remainingResources = change.remainingResources || null;

                    // Preserve construction site metadata if applicable
                    if (change.isConstructionSite) {
                        objectInstance.userData.isConstructionSite = true;
                        objectInstance.userData.targetStructure = change.targetStructure;
                        objectInstance.userData.requiredMaterials = change.requiredMaterials || {};
                        objectInstance.userData.materials = change.materials || {};
                        objectInstance.userData.rotation = change.rotation;
                        objectInstance.userData.finalFoundationY = change.finalFoundationY;
                    }

                    this.scene.add(objectInstance);

                    // Add to chunkTrees
                    const chunkObjects = this.terrainRenderer.chunkTrees.get(chunkKey) || [];
                    chunkObjects.push(objectInstance);
                    this.terrainRenderer.chunkTrees.set(chunkKey, chunkObjects);

                    console.log(`Added ${change.name} from server state to chunk ${chunkKey} (resources: ${change.remainingResources}/${change.totalResources})`);

                    // Update blob shadow
                    if (objectInstance.userData.blobShadow) {
                        const fakeLight = new THREE.Vector3(change.position[0] + 100, 20, change.position[2]);
                        objectInstance.userData.blobShadow.update(
                            (x, z) => this.terrainRenderer.heightCalculator.calculateHeight(x, z),
                            fakeLight,
                            (x, z) => {
                                const normal = this.terrainRenderer.heightCalculator.calculateNormal(x, z);
                                return new THREE.Vector3(normal.x, normal.y, normal.z);
                            }
                        );
                    }
                }
            }
        }
    });

    // Apply removals to existing chunks
    changesByChunk.forEach((_, chunkKey) => {
        this.chunkManager.applyChunkRemovals(chunkKey);
    });

    // If this is the first chunk state after connecting, create the initial chunks
if (this.terrainRenderer.chunkMap.size === 0) {
    this.chunkManager.updateChunksAroundPlayer(
        this.gameState.currentPlayerChunkX,
        this.gameState.currentPlayerChunkZ
    );
}
}

    handleObjectRemoved(payload) {
        if (this.chunkManager.removeObject(payload.objectId)) {
            ui.updateStatus(`Removed object ${payload.objectId} from scene`);
        } else {
            console.warn(`Object ${payload.objectId} not found in current chunks.`);
        }

        // Update proximity after server confirms removal
        this.checkProximityToObjects();
    }

    handleObjectAdded(payload) {
        const { objectId, objectType, position, quality, scale, chunkId, totalResources, remainingResources, rotation, isConstructionSite, targetStructure, requiredMaterials, materials, finalFoundationY, inventory } = payload;

        // Extract chunk coordinates from chunkId (format: "chunk_x,z")
        const chunkKey = chunkId.replace('chunk_', '');

        // Check if object already exists in scene (prevent duplicates)
        let existingObject = null;
        this.scene.traverse((object) => {
            if (object.userData && object.userData.objectId === objectId) {
                existingObject = object;
            }
        });

        if (existingObject) {
            // Object already exists - update its properties instead of creating duplicate
            existingObject.userData.remainingResources = remainingResources || null;
            existingObject.userData.totalResources = totalResources || null;
            console.log(`Object ${objectId} already exists, updated from broadcast`);
            return; // Don't create duplicate
        }

        // Create the object instance
        const objectPosition = new THREE.Vector3(position[0], position[1], position[2]);

        // Use provided rotation if available (for construction sites), otherwise random
        const objectRotation = rotation !== undefined ? (rotation * Math.PI / 180) : (Math.random() * Math.PI * 2);

        const objectInstance = objectPlacer.createInstance(
            objectType,
            objectPosition,
            scale,
            objectRotation,
            this.scene
        );

        if (objectInstance) {
            objectInstance.userData.objectId = objectId;
            objectInstance.userData.chunkKey = chunkKey;
            objectInstance.userData.quality = quality;
            objectInstance.userData.modelType = objectType;
            objectInstance.userData.totalResources = totalResources || null;
            objectInstance.userData.remainingResources = remainingResources || null;

            // Store construction site metadata if applicable
            if (isConstructionSite) {
                objectInstance.userData.isConstructionSite = true;
                objectInstance.userData.targetStructure = targetStructure;
                objectInstance.userData.requiredMaterials = requiredMaterials || {};
                objectInstance.userData.materials = materials || {};
                objectInstance.userData.rotation = rotation;
                objectInstance.userData.finalFoundationY = finalFoundationY;
            }

            // Store crate/tent inventory if applicable
            if ((objectType === 'crate' || objectType === 'tent') && inventory) {
                objectInstance.userData.inventory = inventory;
            }

            this.scene.add(objectInstance);

            // Add to chunkTrees for proximity detection
            const chunkObjects = this.terrainRenderer.chunkTrees.get(chunkKey) || [];
            chunkObjects.push(objectInstance);
            this.terrainRenderer.chunkTrees.set(chunkKey, chunkObjects);

            // Update blob shadow
            if (objectInstance.userData.blobShadow) {
                const fakeLight = new THREE.Vector3(position[0] + 100, 20, position[2]);
                objectInstance.userData.blobShadow.update(
                    (x, z) => this.terrainRenderer.heightCalculator.calculateHeight(x, z),
                    fakeLight,
                    (x, z) => {
                        const normal = this.terrainRenderer.heightCalculator.calculateNormal(x, z);
                        return new THREE.Vector3(normal.x, normal.y, normal.z);
                    }
                );
            }

            ui.updateStatus(`${objectType} spawned in world`);

            // Try to spawn AI if this is a tent and AI hasn't spawned yet
            if (objectType === 'tent') {
                console.log('Tent added - calling trySpawnAI()');
                this.trySpawnAI();
            }
        } else {
            console.error(`Failed to create ${objectType} instance`);
        }

        // Update proximity after server confirms addition (e.g., log from chopped tree)
        this.checkProximityToObjects();
    }

    handleResourceHarvested(payload) {
        const { objectId, harvestType, remainingResources, depleted, harvestedBy } = payload;

        // Find the resource object in chunkTrees (this is the authoritative reference used by proximity checks)
        let resourceObject = null;
        let foundInChunk = null;

        this.terrainRenderer.chunkTrees.forEach((chunkObjects, chunkKey) => {
            const obj = chunkObjects.find(o => o.userData.objectId === objectId);
            if (obj) {
                resourceObject = obj;
                foundInChunk = chunkKey;
            }
        });

        if (resourceObject) {
            // Update remaining resources in the chunkTrees object
            resourceObject.userData.remainingResources = remainingResources;

            // Update nearestObject display if this is the currently selected object
            if (this.gameState.nearestObject && this.gameState.nearestObject.id === objectId) {
                this.gameState.nearestObject.remainingResources = remainingResources;
                // Trigger UI update
                const hasAxe = this.hasToolWithDurability('axe');
                const hasSaw = this.hasToolWithDurability('saw');
                const isOnCooldown = this.gameState.harvestCooldown && this.gameState.harvestCooldown.endTime > Date.now();
                ui.updateNearestObject(
                    this.gameState.nearestObject.name,
                    this.gameState.nearestObject.toolCheck,
                    this.gameState.nearestObject.quality,
                    this.gameState.nearestObject.remainingResources,
                    this.gameState.nearestObject.totalResources
                );
                ui.updateButtonStates(this.gameState.isInChunk, this.gameState.nearestObject, hasAxe, hasSaw, isOnCooldown, this.gameState.nearestConstructionSite, this.gameState.isMoving, this.gameState.nearestCrate);
            }

            // If this client harvested it, handle durability and inventory
            if (harvestedBy === this.gameState.clientId) {
                // Determine which tool was used
                let toolType;
                if (harvestType === 'firewood') {
                    toolType = 'axe';
                } else if (harvestType === 'planks') {
                    toolType = 'saw';
                } else if (harvestType === 'stone') {
                    toolType = 'pickaxe';
                }

                // Find the tool in inventory
                const tool = this.gameState.inventory.items.find(item =>
                    item.type === toolType && item.durability > 0
                );

                if (tool) {
                    // Calculate durability loss based on material quality: ceil(100 / materialQuality)
                    // Higher quality materials cause more durability loss
                    const materialQuality = resourceObject.userData.quality;
                    const durabilityLoss = Math.ceil(100 / materialQuality);
                    tool.durability = Math.max(0, tool.durability - durabilityLoss);

                    console.log(`Tool ${toolType} (quality ${tool.quality}) lost ${durabilityLoss} durability from quality ${materialQuality} material, now at ${tool.durability}`);

                    // Check if tool broke
                    if (tool.durability === 0) {
                        // Delete tool from inventory
                        const toolIndex = this.gameState.inventory.items.indexOf(tool);
                        if (toolIndex > -1) {
                            this.gameState.inventory.items.splice(toolIndex, 1);
                            console.log(`Tool ${toolType} broke and was removed from inventory`);
                        }
                        ui.updateStatus(`⚠️ Your ${toolType} broke!`);
                        ui.updateStatusLine2(`⚠️ Your ${toolType} broke!`, 5000);
                    }

                    // Re-render inventory if it's open
                    if (this.gameState.inventoryOpen) {
                        this.renderInventory();
                    }
                }

                // Create inventory item (firewood, plank, or stone)
                let materialType, itemWidth, itemHeight;
                const resourceName = resourceObject.userData.modelType;

                if (harvestType === 'stone') {
                    // Rock items are just the rock name (limestone or sandstone)
                    materialType = resourceName; // "limestone" or "sandstone"
                    itemWidth = 1;
                    itemHeight = 1;
                } else {
                    // Extract tree type from resource name (e.g., "oak_log" -> "oak")
                    const treeType = resourceName.replace('_log', ''); // e.g., "oak_log" -> "oak"
                    // Convert "planks" to "plank" (singular) to match image filenames
                    const materialSuffix = harvestType === 'planks' ? 'plank' : harvestType;
                    materialType = `${treeType}${materialSuffix}`; // e.g., "oakfirewood", "pineplank"
                    itemWidth = 2;
                    itemHeight = 4;
                }

                const newItem = {
                    id: `${materialType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    type: materialType,
                    x: -1, // Will be set when we find space
                    y: -1,
                    width: itemWidth,
                    height: itemHeight,
                    rotation: 0,
                    quality: resourceObject.userData.quality, // Inherit resource quality
                    durability: 100 // Harvested items start at full durability
                };

                // Try to add item to inventory
                if (this.tryAddItemToInventory(newItem)) {
                    ui.updateStatusLine1(`✅ Harvested ${materialType}`, 2000);
                    console.log(`Added ${materialType} to inventory`);

                    // Re-render inventory if it's open
                    if (this.gameState.inventoryOpen) {
                        this.renderInventory();
                    }
                } else {
                    ui.updateStatusLine2(`⚠️ Inventory full! ${materialType} dropped`, 4000);
                    console.warn(`Inventory full, could not add ${materialType}`);
                }

                // Start 3-second cooldown
                this.gameState.harvestCooldown = {
                    endTime: Date.now() + 3000
                };
                console.log('Started 3-second harvest cooldown');

                // Show countdown message on statusLine2
                let secondsRemaining = 3;
                ui.updateStatusLine2(`⏳ Resting (${secondsRemaining}s)`, 0); // 0 = don't auto-hide

                // Update countdown every second
                const countdownInterval = setInterval(() => {
                    secondsRemaining--;
                    if (secondsRemaining > 0) {
                        ui.updateStatusLine2(`⏳ Resting (${secondsRemaining}s)`, 0);
                    } else {
                        clearInterval(countdownInterval);
                        ui.updateStatusLine2(null); // Clear the message
                    }
                }, 1000);

                // Schedule proximity check after cooldown expires to re-show buttons
                setTimeout(() => {
                    this.checkProximityToObjects();
                    console.log('Cooldown expired, buttons refreshed');
                }, 3000);
            }

            // If depleted, remove from scene
            if (depleted) {
                console.log(`[DEPLETION] Resource ${objectId} marked as depleted by server`);

                // Find and remove the visual object from scene (might be different reference than chunkTrees)
                let sceneObject = null;
                this.scene.traverse((object) => {
                    if (object.userData && object.userData.objectId === objectId) {
                        sceneObject = object;
                    }
                });

                if (sceneObject) {
                    this.scene.remove(sceneObject);
                    // Dispose blob shadow from scene object
                    if (sceneObject.userData.blobShadow) {
                        sceneObject.userData.blobShadow.dispose();
                    }
                    console.log(`[DEPLETION] Removed visual object from scene`);
                } else {
                    console.error(`[DEPLETION] Visual object not found in scene!`);
                }

                // Remove from chunkTrees (data reference)
                const chunkKey = resourceObject.userData.chunkKey;
                const chunkObjects = this.terrainRenderer.chunkTrees.get(chunkKey);
                if (chunkObjects) {
                    const index = chunkObjects.indexOf(resourceObject);
                    if (index > -1) {
                        chunkObjects.splice(index, 1);
                        console.log(`[DEPLETION] Removed from chunkTrees (${chunkObjects.length} objects remaining)`);
                    }
                }

                console.log(`[DEPLETION] Resource ${objectId} fully removed from client`);
            } else {
                console.log(`Resource ${objectId} harvested for ${harvestType}, ${remainingResources} resources remaining`);
            }

            // Trigger proximity check to update UI
            this.checkProximityToObjects();
        } else {
            console.warn(`Resource ${objectId} not found in scene`);
        }
    }

    handleHarvestLockFailed(payload) {
        const { objectId, reason } = payload;

        // Check if we're currently harvesting this log
        if (this.gameState.activeChoppingAction &&
            this.gameState.activeChoppingAction.object.id === objectId) {

            // Stop sound
            if (this.gameState.activeChoppingAction.sound) {
                this.gameState.activeChoppingAction.sound.stop();
            }

            // Stop animation
            if (this.animationMixer && this.choppingAction) {
                this.choppingAction.stop();
            }

            // Clear active action
            this.gameState.activeChoppingAction = null;
            ui.updateChoppingProgress(0);

            // Show message to user
            ui.updateStatus(`⚠️ ${reason}`);
            ui.updateStatusLine2(`⚠️ ${reason}`, 4000);
            console.warn(`Harvest lock failed: ${reason}`);

            // Update proximity to refresh UI button states after lock failure
            this.checkProximityToObjects();
        }
    }

    handleProximityUpdate(payload) {
        const { players } = payload;
        ui.updateStatus(`📍 Proximity update: ${players.length} players`);

        const currentPeerIds = new Set(players.map(p => p.id));
        this.networkManager.peers.forEach((_, peerId) => {
            if (!currentPeerIds.has(peerId) && peerId !== this.gameState.clientId) {
                this.networkManager.cleanupPeer(peerId, this.scene);
            }
        });

        const newPlayers = players.filter(
            p => p.id !== this.gameState.clientId && !this.networkManager.peers.has(p.id)
        );

        if (newPlayers.length > 0) {
            this.staggerP2PInitiations(newPlayers);
        }
        ui.updatePeerInfo(this.networkManager.peers, this.networkManager.avatars);
    }

    handleCrateInventoryResponse(payload) {
        const { crateId, inventory } = payload;
        console.log(`Received crate inventory for ${crateId}: ${inventory.items.length} items`);

        // Find the crate object
        let crateObject = null;
        this.scene.traverse((object) => {
            if (object.userData && object.userData.objectId === crateId) {
                crateObject = object;
            }
        });

        if (crateObject) {
            // Store inventory in crate userData
            crateObject.userData.inventory = inventory;

            // If this is the nearest crate, update the display
            if (this.gameState.nearestCrate && this.gameState.nearestCrate.userData.objectId === crateId) {
                this.crateInventory = inventory;
                this.renderCrateInventory();
            }
        }
    }

    handleCrateInventoryUpdated(payload) {
        const { crateId, inventory } = payload;
        console.log(`Crate inventory updated for ${crateId}: ${inventory.items.length} items`);

        // Find the crate object
        let crateObject = null;
        this.scene.traverse((object) => {
            if (object.userData && object.userData.objectId === crateId) {
                crateObject = object;
            }
        });

        if (crateObject) {
            // Update inventory in crate userData
            crateObject.userData.inventory = inventory;

            // If this is the nearest crate and it's open, update the display
            if (this.gameState.nearestCrate &&
                this.gameState.nearestCrate.userData.objectId === crateId &&
                this.gameState.inventoryOpen) {
                this.crateInventory = inventory;
                this.renderCrateInventory();
            }
        }
    }

    startChoppingAction(object) {
        const treeTypes = ['oak', 'fir', 'pine', 'cypress'];
        const structureTypes = ['construction', 'foundation', 'foundationcorner', 'foundationroundcorner'];
        const isTree = treeTypes.includes(object.name);
        const isStructure = structureTypes.includes(object.name);

        // Start chopping action
        this.gameState.activeChoppingAction = {
            object: object,
            startTime: Date.now(),
            duration: isStructure ? CONFIG.ACTIONS.CHOP_STRUCTURE_DURATION : CONFIG.ACTIONS.CHOP_TREE_DURATION // From config.js
        };

        // Play appropriate sound
        if (isTree && this.audioManager) {
            const sound = this.audioManager.playAxeSound();
            this.gameState.activeChoppingAction.sound = sound;
        } else if (isStructure && this.audioManager) {
            const sound = this.audioManager.playHammerSound();
            this.gameState.activeChoppingAction.sound = sound;
        }

        // Start chopping animation
        if (this.animationMixer && this.choppingAction) {
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
        // harvestType is 'firewood', 'planks', or 'stone'

        // Check if cooldown is active
        if (this.gameState.harvestCooldown) {
            const remaining = this.gameState.harvestCooldown.endTime - Date.now();
            if (remaining > 0) {
                ui.updateStatus(`⏳ Harvest cooldown: ${Math.ceil(remaining / 1000)}s`);
                return;
            } else {
                // Cooldown expired, clear it
                this.gameState.harvestCooldown = null;
            }
        }

        // Validate tool requirements
        let requiredTool;
        if (harvestType === 'firewood') {
            requiredTool = 'axe';
        } else if (harvestType === 'planks') {
            requiredTool = 'saw';
        } else if (harvestType === 'stone') {
            requiredTool = 'pickaxe';
        }

        if (!this.hasToolWithDurability(requiredTool)) {
            console.warn(`Cannot harvest ${harvestType}: missing ${requiredTool} with durability`);
            return;
        }

        // Start harvesting action
        this.gameState.activeChoppingAction = {
            object: object,
            startTime: Date.now(),
            duration: CONFIG.ACTIONS.HARVEST_LOG_DURATION, // 10 seconds from config.js
            harvestType: harvestType // Store harvest type for server request
        };

        // Play appropriate sound
        if (this.audioManager) {
            let sound;
            if (harvestType === 'firewood') {
                sound = this.audioManager.playAxeSound();
            } else if (harvestType === 'planks') {
                sound = this.audioManager.playSawSound();
            } else if (harvestType === 'stone') {
                sound = this.audioManager.playPickaxeSound();
            }
            this.gameState.activeChoppingAction.sound = sound;
        }

        // Start chopping animation
        if (this.animationMixer && this.choppingAction) {
            this.choppingAction.reset();
            this.choppingAction.play();
        }

        // Broadcast harvest action to peers
        this.networkManager.broadcastP2P({
            type: 'player_harvest',
            payload: {
                harvestType: harvestType,
                startTime: Date.now(),
                duration: 10000
            }
        });

        // Broadcast sound to peers
        let soundType;
        if (harvestType === 'firewood') {
            soundType = 'axe';
        } else if (harvestType === 'planks') {
            soundType = 'saw';
        } else if (harvestType === 'stone') {
            soundType = 'pickaxe';
        }

        this.networkManager.broadcastP2P({
            type: 'player_sound',
            payload: {
                soundType: soundType,
                startTime: Date.now()
            }
        });
    }

    startBuildAction() {
        // Check if we have a construction site nearby
        if (!this.gameState.nearestConstructionSite) {
            ui.updateStatus('⚠️ No construction site nearby');
            return;
        }

        // Check if already performing an action
        if (this.gameState.activeChoppingAction) {
            ui.updateStatus('⚠️ Already performing an action');
            return;
        }

        // Check if player has hammer in inventory
        if (!this.hasToolWithDurability('hammer')) {
            ui.updateStatus('⚠️ Need hammer to build');
            return;
        }

        // Check if all materials are satisfied
        const constructionSite = this.gameState.nearestConstructionSite;
        const requiredMaterials = constructionSite.userData.requiredMaterials || {};
        const currentMaterials = constructionSite.userData.materials || {};

        const allMaterialsSatisfied = Object.entries(requiredMaterials).every(
            ([material, quantity]) => (currentMaterials[material] || 0) >= quantity
        );

        if (!allMaterialsSatisfied) {
            ui.updateStatus('⚠️ Missing materials');
            return;
        }

        // Start building action
        this.gameState.activeChoppingAction = {
            object: constructionSite,
            startTime: Date.now(),
            duration: CONFIG.ACTIONS.BUILD_DURATION, // 6 seconds from config.js
            actionType: 'build'
        };

        // Play hammer sound
        if (this.audioManager) {
            const sound = this.audioManager.playHammerSound();
            this.gameState.activeChoppingAction.sound = sound;
        }

        // Start chopping animation (hammer animation)
        if (this.animationMixer && this.choppingAction) {
            this.choppingAction.reset();
            this.choppingAction.play();
        }

        // Broadcast sound to peers
        this.networkManager.broadcastP2P({
            type: 'player_sound',
            payload: {
                soundType: 'hammer',
                startTime: Date.now()
            }
        });

        ui.updateStatus('🔨 Building...');
    }

    startChiselingAction(chisel, stone) {
        // Check if already performing an action
        if (this.gameState.activeChoppingAction) {
            console.warn('Already performing an action');
            return;
        }

        // Check chisel durability
        if (chisel.durability <= 0) {
            ui.updateStatusLine2('⚠️ Chisel is broken!', 3000);
            return;
        }

        console.log(`Starting chiseling action on ${stone.type} (quality: ${stone.quality})`);

        // Start chiseling action (locks movement)
        this.gameState.activeChoppingAction = {
            object: null, // No world object for chiseling
            startTime: Date.now(),
            duration: CONFIG.ACTIONS.CHISELING_DURATION, // 6 seconds from config.js
            actionType: 'chiseling',
            chisel: chisel,
            stone: stone
        };

        // Play chisel sound
        if (this.audioManager) {
            const sound = this.audioManager.playChiselSound();
            this.gameState.activeChoppingAction.sound = sound;
        }

        // Start chopping animation
        if (this.animationMixer && this.choppingAction) {
            this.choppingAction.reset();
            this.choppingAction.play();
        }

        // Broadcast chisel sound to peers
        this.networkManager.broadcastP2P({
            type: 'player_sound',
            payload: {
                soundType: 'chisel',
                startTime: Date.now()
            }
        });

        // Close inventory
        if (this.gameState.inventoryOpen) {
            this.toggleInventory();
        }

        ui.updateStatusLine1('🔨 Chiseling...', 0);
    }

    updateChoppingAction() {
        if (!this.gameState.activeChoppingAction) return;

        const elapsed = Date.now() - this.gameState.activeChoppingAction.startTime;
        const progress = Math.min(elapsed / this.gameState.activeChoppingAction.duration, 1);

        // Update progress UI
        ui.updateChoppingProgress(progress);

        // Check if chopping is complete
        if (progress >= 1) {
            this.completeChoppingAction();
        }
    }

    completeChoppingAction() {
        if (!this.gameState.activeChoppingAction) return;

        const object = this.gameState.activeChoppingAction.object;
        const harvestType = this.gameState.activeChoppingAction.harvestType;
        const actionType = this.gameState.activeChoppingAction.actionType;

        // Stop sound
        if (this.gameState.activeChoppingAction.sound) {
            this.gameState.activeChoppingAction.sound.stop();
        }

        // Stop chopping animation
        if (this.animationMixer && this.choppingAction) {
            this.choppingAction.stop();
        }

        // Handle build completion
        if (actionType === 'build') {
            const constructionSite = object;

            // Find hammer in inventory
            const hammer = this.gameState.inventory.items.find(item => item.type === 'hammer' && item.durability > 0);

            if (hammer) {
                // Consume hammer durability (from config.js)
                hammer.durability = Math.max(0, hammer.durability - CONFIG.TOOLS.HAMMER_DURABILITY_LOSS);
                console.log(`Hammer durability reduced to ${hammer.durability}`);

                // Check if hammer broke
                if (hammer.durability === 0) {
                    // Delete hammer from inventory
                    const hammerIndex = this.gameState.inventory.items.indexOf(hammer);
                    if (hammerIndex > -1) {
                        this.gameState.inventory.items.splice(hammerIndex, 1);
                    }
                    ui.updateStatusLine1('⚠️ Hammer broke!', 3000);
                    console.log('Hammer broke during building');
                }

                // Send build completion to server
                this.networkManager.sendMessage('build_construction', {
                    constructionId: constructionSite.userData.objectId,
                    chunkKey: constructionSite.userData.chunkKey
                });

                ui.updateStatusLine1('✅ Construction complete!', 3000);
                console.log('Building complete');

                // Re-render inventory (includes construction section and crate section)
                if (this.gameState.inventoryOpen) {
                    this.renderInventory();
                    this.updateConstructionSection(); // Construction section will hide since site is gone
                    this.updateCrateSection(); // Crate section will show/hide based on proximity
                }
            }

            // Clear active chopping action
            this.gameState.activeChoppingAction = null;
            ui.updateChoppingProgress(0);
            return;
        }

        // Handle chiseling completion
        if (actionType === 'chiseling') {
            const chisel = this.gameState.activeChoppingAction.chisel;
            const stone = this.gameState.activeChoppingAction.stone;

            // Calculate durability loss based on stone quality
            const durabilityLoss = Math.ceil(100 / stone.quality);
            chisel.durability = Math.max(0, chisel.durability - durabilityLoss);

            console.log(`Chisel lost ${durabilityLoss} durability from quality ${stone.quality} stone, now at ${chisel.durability}`);

            // Check if chisel broke
            if (chisel.durability === 0) {
                // Delete chisel from inventory
                const chiselIndex = this.gameState.inventory.items.indexOf(chisel);
                if (chiselIndex > -1) {
                    this.gameState.inventory.items.splice(chiselIndex, 1);
                }
                ui.updateStatusLine1('⚠️ Chisel broke!', 4000);
                ui.updateStatusLine2(`Chiseling failed!`, 4000);
                console.log('Chisel broke during chiseling');
            } else {
                // Chiseling succeeded - convert stone to chiseled version
                const chiseledType = stone.type.replace('limestone', 'chiseledlimestone')
                                                .replace('sandstone', 'chiseledsandstone')
                                                .replace('Rlimestone', 'Rchiseledlimestone')
                                                .replace('Rsandstone', 'Rchiseledsandstone');

                // Update stone type in place (keeps position, quality, rotation)
                stone.type = chiseledType;

                ui.updateStatusLine1(`✅ Created ${chiseledType.replace('R', '')}`, 3000);
                console.log(`Chiseling complete: ${stone.type} created`);
            }

            // Re-render inventory
            if (this.gameState.inventoryOpen) {
                this.renderInventory();
            }

            // Clear active chopping action
            this.gameState.activeChoppingAction = null;
            ui.updateChoppingProgress(0);
            return;
        }

        // Check if this is a harvest action (log harvesting)
        if (harvestType) {
            // Send harvest_resource_request to server with complete object data
            // This allows the server to handle natural resources on first interaction
            this.networkManager.sendMessage('harvest_resource_request', {
                chunkId: `chunk_${object.chunkKey}`,
                objectId: object.id,
                harvestType: harvestType, // 'firewood' or 'planks'
                clientId: this.gameState.clientId,
                objectData: {
                    name: object.name,
                    position: object.position.toArray(),
                    quality: object.quality,
                    scale: object.scale,
                    totalResources: object.totalResources,
                    remainingResources: object.remainingResources
                }
            });
        } else {
            // Standard tree/rock removal
            this.networkManager.sendMessage('remove_object_request', {
                chunkId: `chunk_${object.chunkKey}`,
                objectId: object.id,
                name: object.name,
                position: object.position.toArray(),
                quality: object.quality,
                scale: object.scale
            });

            // Spawn log for trees - send request to server
            const treeTypes = ['oak', 'fir', 'pine', 'cypress'];
            if (treeTypes.includes(object.name)) {
                // Calculate log scale (1/3 of tree scale)
                const logScale = object.scale / 3;
                const logType = `${object.name}_log`; // e.g., "oak_log", "pine_log"
                const logId = `${logType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                // Calculate total resources based on original tree scale
                const totalResources = Math.floor(object.scale * 100);

                // Send add_object_request to server
                this.networkManager.sendMessage('add_object_request', {
                    chunkId: `chunk_${object.chunkKey}`,
                    objectId: logId,
                    objectType: logType, // e.g., "oak_log" instead of just "log"
                    objectPosition: object.position.toArray(),
                    objectQuality: object.quality,
                    objectScale: logScale,
                    totalResources: totalResources,
                    remainingResources: totalResources
                });
            }
        }

        // Clear active chopping action
        this.gameState.activeChoppingAction = null;
        ui.updateChoppingProgress(0);
    }

    async handleWebRTCOffer(payload) {
        if (payload.recipientId !== this.gameState.clientId) return;
        const peerId = payload.senderId;
        const connection = this.networkManager.createPeerConnection(peerId, false);
        try {
            await connection.setRemoteDescription(new RTCSessionDescription(payload.offer));
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            this.networkManager.sendMessage('webrtc_answer', {
                recipientId: peerId,
                senderId: this.gameState.clientId,
                answer
            });
        } catch (error) {
            ui.updateStatus(`❌ Failed to handle offer from ${peerId}: ${error}`);
        }
    }

    async handleWebRTCAnswer(payload) {
        if (payload.recipientId !== this.gameState.clientId) return;
        const peer = this.networkManager.peers.get(payload.senderId);
        if (peer?.connection) {
            try {
                await peer.connection.setRemoteDescription(new RTCSessionDescription(payload.answer));
            } catch (error) {
                ui.updateStatus(`❌ Failed to handle answer from ${payload.senderId}: ${error}`);
            }
        }
    }

    async handleWebRTCIceCandidate(payload) {
        if (payload.recipientId !== this.gameState.clientId) return;
        const peer = this.networkManager.peers.get(payload.senderId);
        if (peer?.connection) {
            try {
                await peer.connection.addIceCandidate(new RTCIceCandidate(payload.candidate));
            } catch (error) {
                ui.updateStatus(`❌ Failed to add ICE candidate from ${payload.senderId}: ${error}`);
            }
        }
    }

    staggerP2PInitiations(newPlayers) {
        newPlayers.forEach((player, index) => {
            setTimeout(() => {
                if (this.gameState.clientId < player.id) {
                    this.initiateP2PConnection(player.id);
                }

                // Create avatar from man model
                const avatar = this.createAvatar();
                if (avatar) {
                    this.scene.add(avatar);
                    this.networkManager.avatars.set(player.id, avatar);
                }

                // Create AI enemy for this peer
                // Note: Peer might not exist yet if we're not the initiator
                // It will be created when we receive the WebRTC offer
                // So we check again and create the AI enemy when the peer is ready
                let peerData = this.networkManager.peers.get(player.id);

                // If peer doesn't exist yet, create a minimal peer entry
                if (!peerData) {
                    peerData = {
                        connection: null,
                        dataChannel: null,
                        state: 'pending',
                        targetPosition: null,
                        moveStartTime: null
                    };
                    this.networkManager.peers.set(player.id, peerData);
                }

                // Note: AI enemy creation is handled by network sync messages (ai_enemy_update)
                // This ensures they spawn at the correct position relative to their owner player
                // rather than at the origin (0, 0, 0)
            }, index * 750);
        });
    }

    createAvatar() {
        const manGLTF = modelManager.getGLTF('man');
        if (!manGLTF) {
            console.error('Man model not loaded for avatar');
            return null;
        }

        // AVATAR CLONING FIX: Use SkeletonUtils.clone() instead of .clone(true)
        // Regular .clone() breaks skeleton binding for SkinnedMesh (animated characters)
        // SkeletonUtils preserves the bone-mesh binding needed for animations
        // If avatars are still invisible, revert to loading separate model instances
        const avatarMesh = SkeletonUtils.clone(manGLTF.scene);
        avatarMesh.scale.set(this.playerScale, this.playerScale, this.playerScale);

        // Setup materials (same as main player)
        avatarMesh.traverse((child) => {
            if (child.isMesh || child.isSkinnedMesh) {
                child.visible = true;
                child.frustumCulled = false;
                child.renderOrder = 1;

                if (child.material) {
                    child.material.depthWrite = true;
                    child.material.depthTest = true;
                    if (child.material.type === 'MeshStandardMaterial') {
                        child.material.needsUpdate = true;
                    }
                }
            }
        });

        // Create animation mixer for this avatar
        if (manGLTF.animations && manGLTF.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(avatarMesh);
            const walkAnimation = manGLTF.animations.find(anim =>
                anim.name.toLowerCase().includes('walk')
            );

            if (walkAnimation) {
                const action = mixer.clipAction(walkAnimation);
                action.play();
                // Store mixer and action in userData
                avatarMesh.userData.mixer = mixer;
                avatarMesh.userData.action = action;
            }
        }

        // Store last position for rotation calculation
        avatarMesh.userData.lastPosition = new THREE.Vector3();
        avatarMesh.userData.isMoving = false;

        return avatarMesh;
    }

    createPeerAIEnemy() {
        return AIEnemy.createPeerAIEnemy();
    }

    // ==========================================
    // INVENTORY SYSTEM
    // ==========================================

    initializeInventory() {
        // Generate grid slots
        const grid = document.getElementById('inventoryGrid');
        for (let row = 0; row < this.gameState.inventory.rows; row++) {
            for (let col = 0; col < this.gameState.inventory.cols; col++) {
                const slot = document.createElement('div');
                slot.className = 'inventory-slot';
                slot.dataset.row = row;
                slot.dataset.col = col;
                grid.appendChild(slot);
            }
        }

        // Add event listeners
        document.getElementById('inventoryCloseBtn').addEventListener('click', () => {
            this.toggleInventory();
        });

        // Clicking overlay background closes inventory
        const overlay = document.getElementById('inventoryOverlay');
        overlay.addEventListener('click', (event) => {
            // Only close if clicking the overlay itself, not its children
            if (event.target === overlay) {
                this.toggleInventory();
            }
        });

        // Prevent clicks on the panel from closing inventory
        const panel = document.querySelector('.inventory-panel');
        panel.addEventListener('click', (event) => {
            event.stopPropagation();
        });

        // Discard modal event listeners
        document.getElementById('discardCancel').addEventListener('click', () => {
            const modal = document.getElementById('discardModal');
            modal.style.display = 'none';
        });

        document.getElementById('discardConfirm').addEventListener('click', () => {
            const modal = document.getElementById('discardModal');
            const itemId = modal.dataset.itemId;

            // Find and remove the item from inventory
            const itemIndex = this.gameState.inventory.items.findIndex(item => item.id === itemId);
            if (itemIndex !== -1) {
                this.gameState.inventory.items.splice(itemIndex, 1);
            }

            // Hide modal and re-render inventory
            modal.style.display = 'none';
            this.renderInventory();

            // Re-check proximity to update button states (in case they discarded a required tool)
            this.checkProximityToObjects();
        });

        // Render initial items
        this.renderInventory();
    }

    calculateInventorySize() {
        // Calculate slot size to fit 60-70% of screen height for 10 rows
        const targetHeight = window.innerHeight * 0.65;
        const slotSize = Math.floor(targetHeight / this.gameState.inventory.rows);
        const gap = Math.max(1, Math.floor(slotSize / 30)); // Gap scales with slot size

        this.gameState.inventory.slotSize = slotSize;
        this.gameState.inventory.gap = gap;
    }

    toggleInventory() {
        // Prevent opening inventory if dead
        if (this.isDead && !this.gameState.inventoryOpen) {
            console.log('Cannot open inventory while dead');
            return;
        }

        // Close build menu if open
        if (this.gameState.buildMenuOpen) {
            this.toggleBuildMenu();
        }

        this.gameState.inventoryOpen = !this.gameState.inventoryOpen;
        const overlay = document.getElementById('inventoryOverlay');

        if (this.gameState.inventoryOpen) {
            this.calculateInventorySize(); // Recalculate on open
            overlay.style.display = 'flex';
            this.renderInventory();
            this.updateConstructionSection(); // Show/hide construction section based on proximity
            this.updateCrateSection(); // Show/hide crate section based on proximity
        } else {
            overlay.style.display = 'none';

            // Save crate inventory if dirty (modified)
            if (this.gameState.nearestCrate && this.crateInventory) {
                const crate = this.gameState.nearestCrate;
                if (crate.userData.inventoryDirty) {
                    // Save inventory to server
                    this.networkManager.sendMessage('save_crate_inventory', {
                        crateId: crate.userData.objectId,
                        chunkId: `chunk_${crate.userData.chunkKey}`,
                        inventory: this.crateInventory
                    });
                    console.log(`Saving crate inventory for ${crate.userData.objectId}`);
                    crate.userData.inventoryDirty = false;
                }
            }

            // Cancel any picked up item
            if (this.inventoryPickedItem) {
                this.cancelPickup();
            }
            // Re-check proximity when closing inventory (in case items changed)
            this.checkProximityToObjects();
        }
    }

    tryAddItemToInventory(item) {
        // Try to find empty space in the inventory grid (10 rows x 5 cols)
        const { rows, cols, items } = this.gameState.inventory;

        // Try each position in the grid
        for (let y = 0; y <= rows - item.height; y++) {
            for (let x = 0; x <= cols - item.width; x++) {
                // Check if this position is free
                if (this.isPositionFree(x, y, item.width, item.height, items)) {
                    // Found a free position!
                    item.x = x;
                    item.y = y;
                    items.push(item);
                    return true;
                }
            }
        }

        // No space found
        return false;
    }

    isPositionFree(x, y, width, height, existingItems) {
        // Check if the rectangle from (x,y) to (x+width-1, y+height-1) overlaps with any existing items
        for (const item of existingItems) {
            // Get item dimensions (account for rotation)
            const itemWidth = item.rotation === 90 ? item.height : item.width;
            const itemHeight = item.rotation === 90 ? item.width : item.height;

            // Check if rectangles overlap
            const xOverlap = x < item.x + itemWidth && x + width > item.x;
            const yOverlap = y < item.y + itemHeight && y + height > item.y;

            if (xOverlap && yOverlap) {
                return false; // Overlaps with this item
            }
        }

        return true; // No overlaps
    }

    renderInventory() {
        const itemsContainer = document.getElementById('inventoryItems');
        const inventoryGrid = document.getElementById('inventoryGrid');
        itemsContainer.innerHTML = ''; // Clear existing

        // Update grid styling dynamically
        const { slotSize, gap, rows, cols } = this.gameState.inventory;
        inventoryGrid.style.gridTemplateColumns = `repeat(${cols}, ${slotSize}px)`;
        inventoryGrid.style.gridTemplateRows = `repeat(${rows}, ${slotSize}px)`;
        inventoryGrid.style.gap = `${gap}px`;

        // Update slot styling
        const slots = inventoryGrid.querySelectorAll('.inventory-slot');
        slots.forEach(slot => {
            slot.style.width = `${slotSize}px`;
            slot.style.height = `${slotSize}px`;
        });

        this.gameState.inventory.items.forEach(item => {
            // Skip rendering picked item in its grid position - will render as ghost
            // Use object reference comparison to identify the exact picked item
            if (this.inventoryPickedItem && item === this.inventoryPickedItem) {
                return;
            }

            // Create container wrapper for image + discard button
            const itemWrapper = document.createElement('div');
            itemWrapper.className = 'inventory-item-wrapper';

            // Add chisel-target class if this is the target stone
            if (this.chiselTarget && item.id === this.chiselTarget.id) {
                itemWrapper.classList.add('chisel-target');
            }

            itemWrapper.dataset.itemId = item.id;
            itemWrapper.style.position = 'absolute';

            // Calculate pixel position (upper-left anchor)
            const pixelPos = this.gridToPixel(item.x, item.y);
            itemWrapper.style.left = pixelPos.x + 'px';
            itemWrapper.style.top = pixelPos.y + 'px';

            // Create image element
            const itemEl = document.createElement('img');

            // Use rotated image file when rotation is 90
            if (item.rotation === 90) {
                itemEl.src = `./items/R${item.type}.png`;
            } else {
                itemEl.src = `./items/${item.type}.png`;
            }

            itemEl.className = 'inventory-item';
            itemEl.style.position = 'relative';

            // Calculate size based on slots (swap dimensions when rotated)
            const slotSize = this.gameState.inventory.slotSize;
            const gap = this.gameState.inventory.gap;

            const displayWidth = item.rotation === 90 ? item.height : item.width;
            const displayHeight = item.rotation === 90 ? item.width : item.height;

            const widthPx = displayWidth * slotSize + (displayWidth - 1) * gap;
            const heightPx = displayHeight * slotSize + (displayHeight - 1) * gap;

            itemEl.style.width = widthPx + 'px';
            itemEl.style.height = heightPx + 'px';
            itemWrapper.style.width = widthPx + 'px';
            itemWrapper.style.height = heightPx + 'px';

            // No transform needed - using pre-rotated image

            // Create discard button (X in upper right)
            const discardBtn = document.createElement('div');
            discardBtn.className = 'item-discard-btn';
            discardBtn.textContent = '✕';
            discardBtn.dataset.itemId = item.id;

            // Scale discard button with slot size
            const btnSize = Math.max(16, Math.floor(slotSize / 3)); // Min 16px, scales with slot
            const btnOffset = Math.max(2, Math.floor(slotSize / 30)); // Offset from corner
            discardBtn.style.width = btnSize + 'px';
            discardBtn.style.height = btnSize + 'px';
            discardBtn.style.fontSize = Math.max(12, Math.floor(btnSize * 0.7)) + 'px';
            discardBtn.style.top = btnOffset + 'px';
            discardBtn.style.right = btnOffset + 'px';

            // Add discard button event listeners
            discardBtn.addEventListener('mouseenter', (e) => {
                e.stopPropagation();
                this.showDiscardTooltip(e);
            });
            discardBtn.addEventListener('mousemove', (e) => {
                e.stopPropagation();
                this.updateTooltipPosition(e);
            });
            discardBtn.addEventListener('mouseleave', (e) => {
                e.stopPropagation();
                this.hideDiscardTooltip();
            });
            discardBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.showDiscardConfirmation(item);
            });

            // Prevent dragging when clicking discard button
            discardBtn.addEventListener('mousedown', (e) => {
                e.stopPropagation();
            });

            // Add drag event listener to wrapper
            itemWrapper.addEventListener('mousedown', (e) => this.onItemMouseDown(e, item, itemWrapper));

            // Add hover event listeners for tooltip to wrapper
            itemWrapper.addEventListener('mouseenter', (e) => this.showTooltip(e, item));
            itemWrapper.addEventListener('mousemove', (e) => this.updateTooltipPosition(e));
            itemWrapper.addEventListener('mouseleave', () => this.hideTooltip());

            // Assemble: image and discard button into wrapper
            itemWrapper.appendChild(itemEl);
            itemWrapper.appendChild(discardBtn);

            itemsContainer.appendChild(itemWrapper);
        });

        // Render picked item as ghost following cursor (only if targeting backpack)
        if (this.inventoryPickedItem && this.inventoryPickedTarget === 'backpack') {
            const item = this.inventoryPickedItem;

            // Calculate grid position that item would snap to
            const gridPos = this.pixelToGrid(this.inventoryMouseX, this.inventoryMouseY);
            const snappedPixelPos = this.gridToPixel(gridPos.x, gridPos.y);

            // Create ghost wrapper
            const ghostWrapper = document.createElement('div');
            ghostWrapper.className = 'inventory-item-wrapper dragging';
            ghostWrapper.dataset.itemId = item.id;
            ghostWrapper.style.position = 'absolute';
            // Use snapped position instead of raw mouse position
            ghostWrapper.style.left = snappedPixelPos.x + 'px';
            ghostWrapper.style.top = snappedPixelPos.y + 'px';
            ghostWrapper.style.opacity = '0.7';
            ghostWrapper.style.pointerEvents = 'none'; // Don't intercept mouse events
            ghostWrapper.style.zIndex = '2000'; // Above all panels

            // Create ghost image
            const ghostImg = document.createElement('img');
            ghostImg.src = item.rotation === 90 ? `./items/R${item.type}.png` : `./items/${item.type}.png`;
            ghostImg.className = 'inventory-item';
            ghostImg.style.position = 'relative';

            // Calculate size
            const displayWidth = item.rotation === 90 ? item.height : item.width;
            const displayHeight = item.rotation === 90 ? item.width : item.height;
            const widthPx = displayWidth * slotSize + (displayWidth - 1) * gap;
            const heightPx = displayHeight * slotSize + (displayHeight - 1) * gap;

            ghostImg.style.width = widthPx + 'px';
            ghostImg.style.height = heightPx + 'px';
            ghostWrapper.style.width = widthPx + 'px';
            ghostWrapper.style.height = heightPx + 'px';

            // Check placement validity and add visual feedback
            const isValid = this.isValidPlacement(item, gridPos.x, gridPos.y, item.rotation);
            if (!isValid) {
                ghostWrapper.classList.add('invalid-placement');
            }

            ghostWrapper.appendChild(ghostImg);
            itemsContainer.appendChild(ghostWrapper);
        }
    }

    getStatColor(value) {
        if (value >= 80) return 'stat-good';
        if (value >= 40) return 'stat-worn';
        return 'stat-poor';
    }

    showTooltip(event, item) {
        // Don't show tooltip while holding an item
        if (this.inventoryPickedItem) return;

        const tooltip = document.getElementById('inventoryTooltip');
        const titleEl = tooltip.querySelector('.tooltip-title');
        const qualityEl = tooltip.querySelector('.tooltip-quality');
        const durabilityEl = tooltip.querySelector('.tooltip-durability');
        const durabilityRow = durabilityEl.closest('.tooltip-stat');

        // Set content
        titleEl.textContent = item.type;
        qualityEl.textContent = `${item.quality}/100`;

        // Apply color coding for quality
        qualityEl.className = `tooltip-quality ${this.getStatColor(item.quality)}`;

        // Only show durability for items that have it (tools)
        if (item.durability !== undefined) {
            durabilityEl.textContent = `${item.durability}/100`;
            durabilityEl.className = `tooltip-durability ${this.getStatColor(item.durability)}`;
            durabilityRow.style.display = '';
        } else {
            // Hide durability row for materials
            durabilityRow.style.display = 'none';
        }

        // Position and show tooltip
        this.updateTooltipPosition(event);
        tooltip.style.display = 'block';
    }

    updateTooltipPosition(event) {
        const tooltip = document.getElementById('inventoryTooltip');
        // Position tooltip slightly offset from cursor
        tooltip.style.left = (event.clientX + 15) + 'px';
        tooltip.style.top = (event.clientY + 15) + 'px';
    }

    hideTooltip() {
        const tooltip = document.getElementById('inventoryTooltip');
        tooltip.style.display = 'none';
    }

    showDiscardTooltip(event) {
        // Don't show tooltip while holding an item
        if (this.inventoryPickedItem) return;

        const tooltip = document.getElementById('inventoryTooltip');
        const titleEl = tooltip.querySelector('.tooltip-title');

        // Hide stat rows, only show "Discard"
        tooltip.querySelectorAll('.tooltip-stat').forEach(stat => {
            stat.style.display = 'none';
        });

        // Set content
        titleEl.textContent = 'Discard';
        titleEl.style.color = '#ff6b6b'; // Red color for discard action

        // Position and show tooltip
        this.updateTooltipPosition(event);
        tooltip.style.display = 'block';
    }

    hideDiscardTooltip() {
        const tooltip = document.getElementById('inventoryTooltip');
        tooltip.style.display = 'none';

        // Reset tooltip styles
        tooltip.querySelectorAll('.tooltip-stat').forEach(stat => {
            stat.style.display = '';
        });
        const titleEl = tooltip.querySelector('.tooltip-title');
        titleEl.style.color = '';
    }

    showDiscardConfirmation(item) {
        const modal = document.getElementById('discardModal');
        const message = document.getElementById('discardMessage');

        // Set message with item name
        message.textContent = `Are you sure you want to trash ${item.type}?`;

        // Store item reference for confirmation
        modal.dataset.itemId = item.id;

        // Show modal
        modal.style.display = 'flex';
    }

    gridToPixel(gridX, gridY) {
        const slotSize = this.gameState.inventory.slotSize;
        const gap = this.gameState.inventory.gap;
        return {
            x: gridX * (slotSize + gap),
            y: gridY * (slotSize + gap)
        };
    }

    pixelToGrid(pixelX, pixelY) {
        const slotSize = this.gameState.inventory.slotSize;
        const gap = this.gameState.inventory.gap;

        // Calculate grid position - floor to snap to the slot the cursor is in
        const x = Math.floor(pixelX / (slotSize + gap));
        const y = Math.floor(pixelY / (slotSize + gap));

        return { x, y };
    }

    getOccupiedSlots(item, x, y, rotation) {
        const slots = [];
        const width = rotation === 90 ? item.height : item.width;
        const height = rotation === 90 ? item.width : item.height;

        for (let row = y; row < y + height; row++) {
            for (let col = x; col < x + width; col++) {
                slots.push({ x: col, y: row });
            }
        }
        return slots;
    }

    isValidPlacement(item, x, y, rotation) {
        const width = rotation === 90 ? item.height : item.width;
        const height = rotation === 90 ? item.width : item.height;

        // Bounds check
        if (x < 0 || y < 0) return false;
        if (x + width > this.gameState.inventory.cols) return false;
        if (y + height > this.gameState.inventory.rows) return false;

        // Collision check with other items
        const occupiedSlots = this.getOccupiedSlots(item, x, y, rotation);

        for (const otherItem of this.gameState.inventory.items) {
            // Skip checking against itself
            if (otherItem.id === item.id) continue;

            const otherSlots = this.getOccupiedSlots(
                otherItem,
                otherItem.x,
                otherItem.y,
                otherItem.rotation
            );

            // Check for overlap
            for (const slot of occupiedSlots) {
                for (const otherSlot of otherSlots) {
                    if (slot.x === otherSlot.x && slot.y === otherSlot.y) {
                        return false; // Overlap detected
                    }
                }
            }
        }

        return true;
    }

    getItemUnderCursor(cursorX, cursorY, draggingItem) {
        // Check if cursor is over a chiseable stone item
        const chiseableStones = ['limestone', 'sandstone', 'Rlimestone', 'Rsandstone'];

        for (const invItem of this.gameState.inventory.items) {
            if (invItem.id === draggingItem.id) continue; // Skip the item being dragged
            if (!chiseableStones.includes(invItem.type)) continue; // Only check stone items

            // Calculate item's pixel position and size using dynamic values
            const slotSize = this.gameState.inventory.slotSize;
            const gap = this.gameState.inventory.gap;
            const displayWidth = invItem.rotation === 90 ? invItem.height : invItem.width;
            const displayHeight = invItem.rotation === 90 ? invItem.width : invItem.height;
            const itemPixelX = invItem.x * (slotSize + gap);
            const itemPixelY = invItem.y * (slotSize + gap);
            const itemPixelWidth = displayWidth * slotSize + (displayWidth - 1) * gap;
            const itemPixelHeight = displayHeight * slotSize + (displayHeight - 1) * gap;

            // Check if cursor is over this item
            if (cursorX >= itemPixelX && cursorX <= itemPixelX + itemPixelWidth &&
                cursorY >= itemPixelY && cursorY <= itemPixelY + itemPixelHeight) {
                return invItem;
            }
        }
        return null;
    }

    onItemMouseDown(event, item, itemWrapper) {
        event.preventDefault();
        event.stopPropagation();

        // Ignore clicks on items when already holding an item
        // (this prevents picking up a new item when trying to place on an invalid location)
        if (this.inventoryPickedItem) {
            return;
        }

        // Hide tooltip when clicking item
        this.hideTooltip();

        // Pick up the item (click-to-pickup)
        this.inventoryPickedItem = item;
        this.inventoryPickedSource = 'backpack'; // Track source
        this.inventoryPickedTarget = 'backpack'; // Default target is backpack
        this.inventoryPickedOriginalX = item.x;
        this.inventoryPickedOriginalY = item.y;
        this.inventoryPickedOriginalRotation = item.rotation;

        // Store mouse position
        const itemsContainer = document.getElementById('inventoryItems');
        const containerRect = itemsContainer.getBoundingClientRect();
        this.inventoryMouseX = event.clientX - containerRect.left;
        this.inventoryMouseY = event.clientY - containerRect.top;

        // Set flag to ignore the mouseup from this click
        this.inventoryIgnoreNextMouseUp = true;

        // Add global event listeners
        // Use unified handlers if crate is nearby, otherwise use backpack-only handlers
        if (this.gameState.nearestCrate) {
            this.mouseMoveHandler = (e) => this.onCrateMouseMove(e);
            this.mouseUpHandler = (e) => this.onCrateMouseUp(e);
        } else {
            this.mouseMoveHandler = (e) => this.onMouseMove(e);
            this.mouseUpHandler = (e) => this.onMouseUp(e);
        }
        this.keyDownHandler = (e) => this.onInventoryKeyDown(e);

        window.addEventListener('mousemove', this.mouseMoveHandler);
        window.addEventListener('mouseup', this.mouseUpHandler);
        window.addEventListener('keydown', this.keyDownHandler);

        // Re-render to show item following cursor
        this.renderInventory();
        if (this.gameState.nearestCrate) {
            this.renderCrateInventory();
        }
    }

    onMouseMove(event) {
        if (!this.inventoryPickedItem) return;

        const item = this.inventoryPickedItem;
        const itemsContainer = document.getElementById('inventoryItems');
        const containerRect = itemsContainer.getBoundingClientRect();

        // Update mouse position
        this.inventoryMouseX = event.clientX - containerRect.left;
        this.inventoryMouseY = event.clientY - containerRect.top;

        // Check if holding a chisel over a stone item
        if (item.type === 'chisel') {
            try {
                const targetStone = this.getItemUnderCursor(this.inventoryMouseX, this.inventoryMouseY, item);

                // Update chisel target if changed
                if (this.chiselTarget !== targetStone) {
                    this.chiselTarget = targetStone;
                }
            } catch (error) {
                console.error('Error checking chisel target:', error);
                this.chiselTarget = null;
            }
        } else {
            // Clear chisel target for non-chisel items
            this.chiselTarget = null;
        }

        // Re-render to update ghost position and visual feedback
        this.renderInventory();
    }

    onMouseUp(event) {
        if (!this.inventoryPickedItem) return;

        // Ignore the mouseup from the pickup click
        if (this.inventoryIgnoreNextMouseUp) {
            this.inventoryIgnoreNextMouseUp = false;
            return;
        }

        const item = this.inventoryPickedItem;

        try {
            // Check if chisel was released over a stone
            if (item.type === 'chisel' && this.chiselTarget) {
                const targetStone = this.chiselTarget;

                // Clear chisel target
                this.chiselTarget = null;

                // Start chiseling action
                this.startChiselingAction(item, targetStone);

                // Clear picked item state and reset flag
                this.inventoryPickedItem = null;
                this.inventoryIgnoreNextMouseUp = false;

                // Remove global event listeners
                window.removeEventListener('mousemove', this.mouseMoveHandler);
                window.removeEventListener('mouseup', this.mouseUpHandler);
                window.removeEventListener('keydown', this.keyDownHandler);

                // Re-render to snap chisel back to original position
                this.renderInventory();
                return;
            }

            // Clear any chisel target
            this.chiselTarget = null;

            // Check if dropping onto construction section (now integrated into backpack)
            if (this.gameState.nearestConstructionSite && !this.gameState.isMoving) {
                const constructionSection = document.getElementById('constructionSection');
                if (constructionSection && constructionSection.style.display !== 'none') {
                    const rect = constructionSection.getBoundingClientRect();

                    // Check if mouse is over construction section
                    if (event.clientX >= rect.left && event.clientX <= rect.right &&
                        event.clientY >= rect.top && event.clientY <= rect.bottom) {

                        const requiredMaterials = this.gameState.nearestConstructionSite.userData.requiredMaterials || {};
                        const currentMaterials = this.gameState.nearestConstructionSite.userData.materials || {};

                        // Check if this item type is needed (item.type should match directly, e.g., 'chiseledlimestone')
                        const itemType = item.type;

                        if (requiredMaterials[itemType]) {
                            const required = requiredMaterials[itemType];
                            const current = currentMaterials[itemType] || 0;

                            if (current < required) {
                                // Add material to construction
                                currentMaterials[itemType] = current + 1;
                                this.gameState.nearestConstructionSite.userData.materials = currentMaterials;

                                // Remove item from inventory
                                const itemIndex = this.gameState.inventory.items.indexOf(item);
                                if (itemIndex > -1) {
                                    this.gameState.inventory.items.splice(itemIndex, 1);
                                }

                                console.log(`Added ${itemType} to construction (${current + 1}/${required})`);

                                // Clear picked item state
                                this.inventoryPickedItem = null;
                                this.inventoryIgnoreNextMouseUp = false;

                                // Remove global event listeners
                                window.removeEventListener('mousemove', this.mouseMoveHandler);
                                window.removeEventListener('mouseup', this.mouseUpHandler);
                                window.removeEventListener('keydown', this.keyDownHandler);

                                // Re-render inventory (includes construction section and crate section)
                                this.renderInventory();
                                this.updateConstructionSection();
                                this.updateCrateSection();
                                return;
                            }
                        }
                    }
                }
            }

            // Normal item placement
            // Calculate final grid position
            const gridPos = this.pixelToGrid(this.inventoryMouseX, this.inventoryMouseY);

            // Check if placement is valid
            if (this.isValidPlacement(item, gridPos.x, gridPos.y, item.rotation)) {
                // Valid placement - update item position
                item.x = gridPos.x;
                item.y = gridPos.y;
            } else {
                // Invalid placement - restore original position
                item.x = this.inventoryPickedOriginalX;
                item.y = this.inventoryPickedOriginalY;
                item.rotation = this.inventoryPickedOriginalRotation;
            }

            // Clear picked item state and reset flag
            this.inventoryPickedItem = null;
            this.inventoryIgnoreNextMouseUp = false;

            // Remove global event listeners
            window.removeEventListener('mousemove', this.mouseMoveHandler);
            window.removeEventListener('mouseup', this.mouseUpHandler);
            window.removeEventListener('keydown', this.keyDownHandler);

            // Re-render to place item
            this.renderInventory();
        } catch (error) {
            console.error('Error placing item:', error);
            // On error, restore original position and clean up state
            if (this.inventoryPickedItem) {
                this.inventoryPickedItem.x = this.inventoryPickedOriginalX;
                this.inventoryPickedItem.y = this.inventoryPickedOriginalY;
                this.inventoryPickedItem.rotation = this.inventoryPickedOriginalRotation;
            }
            this.inventoryPickedItem = null;
            this.inventoryIgnoreNextMouseUp = false;
            this.chiselTarget = null;
            window.removeEventListener('mousemove', this.mouseMoveHandler);
            window.removeEventListener('mouseup', this.mouseUpHandler);
            window.removeEventListener('keydown', this.keyDownHandler);
            this.renderInventory();
        }
    }

    onInventoryKeyDown(event) {
        if (!this.inventoryPickedItem) return;

        if (event.key === 'r' || event.key === 'R') {
            event.preventDefault();

            const item = this.inventoryPickedItem;

            // Toggle rotation
            item.rotation = item.rotation === 0 ? 90 : 0;

            // Re-render to update ghost with new rotation
            this.renderInventory();
            // Also re-render crate if nearby (for crate mode)
            if (this.gameState.nearestCrate) {
                this.renderCrateInventory();
            }
        }
    }

    // ==========================================
    // BUILD MENU SYSTEM
    // ==========================================

    initializeBuildMenu() {
        // Generate grid slots
        const grid = document.getElementById('buildMenuGrid');
        for (let row = 0; row < this.gameState.buildMenu.rows; row++) {
            for (let col = 0; col < this.gameState.buildMenu.cols; col++) {
                const slot = document.createElement('div');
                slot.className = 'build-menu-slot';
                slot.dataset.row = row;
                slot.dataset.col = col;
                grid.appendChild(slot);
            }
        }

        // Add close button event listener
        document.getElementById('buildMenuCloseBtn').addEventListener('click', () => {
            this.toggleBuildMenu();
        });

        // Render initial structures
        this.renderBuildMenu();
    }

    calculateBuildMenuSize() {
        // Calculate slot size to fit 60-70% of screen height for 10 rows
        const targetHeight = window.innerHeight * 0.65;
        const slotSize = Math.floor(targetHeight / this.gameState.buildMenu.rows);
        const gap = Math.max(1, Math.floor(slotSize / 30)); // Gap scales with slot size

        this.gameState.buildMenu.slotSize = slotSize;
        this.gameState.buildMenu.gap = gap;
    }

    toggleBuildMenu() {
        // Close inventory if open (only one menu at a time)
        if (this.gameState.inventoryOpen) {
            this.toggleInventory();
        }

        this.gameState.buildMenuOpen = !this.gameState.buildMenuOpen;
        const overlay = document.getElementById('buildMenuOverlay');

        if (this.gameState.buildMenuOpen) {
            this.calculateBuildMenuSize(); // Recalculate on open
            overlay.style.display = 'flex';
            this.renderBuildMenu();
        } else {
            overlay.style.display = 'none';
        }
    }

    toggleConstructionInventory() {
        // Deprecated: Now just opens backpack which contains construction section
        this.toggleInventory();
    }

    updateConstructionSection() {
        // Show/hide construction section based on proximity to construction site AND not moving
        const constructionSection = document.getElementById('constructionSection');
        if (!constructionSection) return;

        const shouldShow = this.gameState.nearestConstructionSite && !this.gameState.isMoving && this.gameState.inventoryOpen;

        if (shouldShow) {
            constructionSection.style.display = 'block';
            this.renderConstructionInventory();
        } else {
            constructionSection.style.display = 'none';
        }
    }

    renderConstructionInventory() {
        if (!this.gameState.nearestConstructionSite) return;

        const constructionSite = this.gameState.nearestConstructionSite;
        const requiredMaterials = constructionSite.userData.requiredMaterials || {};
        const currentMaterials = constructionSite.userData.materials || {};

        // Update building type display
        const buildingTypeEl = document.getElementById('constructionBuildingType');
        if (buildingTypeEl) {
            const targetStructure = constructionSite.userData.targetStructure || 'Unknown';
            buildingTypeEl.textContent = targetStructure.charAt(0).toUpperCase() + targetStructure.slice(1);
        }

        // Update requirements display
        const requirementsEl = document.getElementById('constructionRequirements');
        requirementsEl.innerHTML = '';
        for (const [material, quantity] of Object.entries(requiredMaterials)) {
            const current = currentMaterials[material] || 0;
            const materialName = material.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
            const div = document.createElement('div');
            div.textContent = `${materialName}: ${current}/${quantity}`;
            div.style.color = current >= quantity ? '#4CAF50' : '#ff9800';
            requirementsEl.appendChild(div);
        }

        // Render material slots
        const slotsContainer = document.getElementById('constructionSlots');
        slotsContainer.innerHTML = '';
        for (const [material, quantity] of Object.entries(requiredMaterials)) {
            const current = currentMaterials[material] || 0;
            const materialName = material.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());

            for (let i = 0; i < quantity; i++) {
                const slot = document.createElement('div');
                slot.className = 'construction-slot';
                slot.dataset.material = material;
                slot.dataset.slotIndex = i;

                if (i < current) {
                    slot.classList.add('filled');
                    slot.textContent = '✓';
                    slot.style.fontSize = '24px';
                    slot.style.color = '#4CAF50';
                }

                const label = document.createElement('div');
                label.className = 'construction-slot-label';
                label.textContent = materialName;
                slot.appendChild(label);

                slotsContainer.appendChild(slot);
            }
        }

        // Check if all materials are satisfied
        const allMaterialsSatisfied = Object.entries(requiredMaterials).every(
            ([material, quantity]) => (currentMaterials[material] || 0) >= quantity
        );

        // Enable/disable build button
        const buildBtn = document.getElementById('constructionBuildBtn');
        buildBtn.disabled = !allMaterialsSatisfied;
    }

    updateCrateSection() {
        // Show/hide crate section based on proximity to crate AND not moving
        const crateSection = document.getElementById('crateSection');
        if (!crateSection) return;

        const shouldShow = this.gameState.nearestCrate && !this.gameState.isMoving && this.gameState.inventoryOpen;

        if (shouldShow) {
            crateSection.style.display = 'block';

            // Update title based on structure type
            const crate = this.gameState.nearestCrate;
            const structureType = crate.userData.modelType;
            const titleElement = document.getElementById('crateTitle');
            if (titleElement) {
                titleElement.textContent = structureType === 'tent' ? 'Tent' : 'Crate';
            }

            // Request crate inventory from server if not already loaded
            if (!crate.userData.inventory) {
                // Request inventory from server
                this.networkManager.sendMessage('get_crate_inventory', {
                    crateId: crate.userData.objectId,
                    chunkId: `chunk_${crate.userData.chunkKey}`
                });
                console.log(`Requesting inventory for crate ${crate.userData.objectId}`);
            } else {
                // Inventory already loaded, just render it
                this.renderCrateInventory();
            }
        } else {
            crateSection.style.display = 'none';
        }
    }

    renderCrateInventory() {
        if (!this.gameState.nearestCrate) return;

        const crate = this.gameState.nearestCrate;
        const crateInventory = crate.userData.inventory || { items: [] };

        // Render grid slots
        const crateGrid = document.getElementById('crateGrid');
        if (!crateGrid) return;

        // Use same slot size and gap as backpack inventory
        const { slotSize, gap } = this.gameState.inventory;

        // Update grid styling dynamically (same as backpack)
        crateGrid.style.gridTemplateColumns = `repeat(10, ${slotSize}px)`;
        crateGrid.style.gridTemplateRows = `repeat(10, ${slotSize}px)`;
        crateGrid.style.gap = `${gap}px`;
        crateGrid.style.maxHeight = `${slotSize * 10 + gap * 9 + 4}px`; // 10 rows + gaps + padding

        // Clear existing slots
        crateGrid.innerHTML = '';

        // Create 10x10 grid slots (100 total)
        for (let row = 0; row < 10; row++) {
            for (let col = 0; col < 10; col++) {
                const slot = document.createElement('div');
                slot.className = 'crate-slot';
                slot.dataset.row = row;
                slot.dataset.col = col;
                slot.style.width = `${slotSize}px`;
                slot.style.height = `${slotSize}px`;
                crateGrid.appendChild(slot);
            }
        }

        // Render items
        const crateItems = document.getElementById('crateItems');
        if (!crateItems) return;

        crateItems.innerHTML = '';

        // Store reference to crate inventory for later use
        this.crateInventory = crateInventory;

        // Render each item
        for (const item of crateInventory.items) {
            this.renderCrateItem(item, crateItems);
        }

        // Render picked item as ghost following cursor (if target is crate)
        if (this.inventoryPickedItem && this.inventoryPickedTarget === 'crate') {
            const item = this.inventoryPickedItem;

            // Calculate grid position that item would snap to
            const gridPos = this.pixelToCrateGrid(this.inventoryMouseX, this.inventoryMouseY);
            const snappedX = gridPos.x * (slotSize + gap);
            const snappedY = gridPos.y * (slotSize + gap);

            // Create ghost wrapper
            const ghostWrapper = document.createElement('div');
            ghostWrapper.className = 'crate-item-wrapper dragging';
            ghostWrapper.dataset.itemId = item.id;
            ghostWrapper.style.position = 'absolute';
            ghostWrapper.style.left = snappedX + 'px';
            ghostWrapper.style.top = snappedY + 'px';
            ghostWrapper.style.opacity = '0.7';
            ghostWrapper.style.pointerEvents = 'none';
            ghostWrapper.style.zIndex = '2000';

            // Create ghost image
            const ghostImg = document.createElement('img');
            ghostImg.src = item.rotation === 90 ? `./items/R${item.type}.png` : `./items/${item.type}.png`;
            ghostImg.className = 'crate-item';
            ghostImg.style.position = 'relative';

            // Calculate size
            const displayWidth = item.rotation === 90 ? item.height : item.width;
            const displayHeight = item.rotation === 90 ? item.width : item.height;
            const widthPx = displayWidth * slotSize + (displayWidth - 1) * gap;
            const heightPx = displayHeight * slotSize + (displayHeight - 1) * gap;

            ghostImg.style.width = widthPx + 'px';
            ghostImg.style.height = heightPx + 'px';
            ghostWrapper.style.width = widthPx + 'px';
            ghostWrapper.style.height = heightPx + 'px';

            // Check placement validity and add visual feedback
            const isValid = this.isValidCratePlacement(item, gridPos.x, gridPos.y, item.rotation);
            if (!isValid) {
                ghostWrapper.style.outline = '3px solid #ff0000';
                ghostWrapper.style.outlineOffset = '-3px';
            }

            ghostWrapper.appendChild(ghostImg);
            crateItems.appendChild(ghostWrapper);
        }
    }

    renderCrateItem(item, container) {
        // Skip rendering picked item in its grid position - will render as ghost
        // Use object reference comparison to identify the exact picked item
        if (this.inventoryPickedItem && item === this.inventoryPickedItem) {
            return;
        }

        const itemWrapper = document.createElement('div');
        itemWrapper.className = 'crate-item-wrapper';
        itemWrapper.dataset.itemId = item.id || `${item.type}_${Math.random()}`;
        itemWrapper.style.position = 'absolute';

        // Use same slot size and gap as backpack inventory
        const slotSize = this.gameState.inventory.slotSize;
        const gap = this.gameState.inventory.gap;

        // Set position and size based on item grid position (same calculation as backpack)
        itemWrapper.style.left = `${item.x * (slotSize + gap)}px`;
        itemWrapper.style.top = `${item.y * (slotSize + gap)}px`;

        // Create image element
        const itemEl = document.createElement('img');
        if (item.rotation === 90) {
            itemEl.src = `./items/R${item.type}.png`;
        } else {
            itemEl.src = `./items/${item.type}.png`;
        }
        itemEl.className = 'crate-item';
        itemEl.style.position = 'relative';

        // Calculate size based on slots (swap dimensions when rotated)
        const displayWidth = item.rotation === 90 ? item.height : item.width;
        const displayHeight = item.rotation === 90 ? item.width : item.height;
        const widthPx = displayWidth * slotSize + (displayWidth - 1) * gap;
        const heightPx = displayHeight * slotSize + (displayHeight - 1) * gap;

        itemEl.style.width = widthPx + 'px';
        itemEl.style.height = heightPx + 'px';
        itemWrapper.style.width = widthPx + 'px';
        itemWrapper.style.height = heightPx + 'px';

        // Add drag event listener to wrapper
        itemWrapper.addEventListener('mousedown', (e) => this.onCrateItemMouseDown(e, item, itemWrapper));

        // Add hover event listeners for tooltip
        itemWrapper.addEventListener('mouseenter', (e) => this.showTooltip(e, item));
        itemWrapper.addEventListener('mousemove', (e) => this.updateTooltipPosition(e));
        itemWrapper.addEventListener('mouseleave', () => this.hideTooltip());

        itemWrapper.appendChild(itemEl);
        container.appendChild(itemWrapper);
    }

    onCrateItemMouseDown(event, item, itemWrapper) {
        // Same logic as onItemMouseDown but mark as coming from crate
        event.stopPropagation();
        event.preventDefault();

        // Store picked item info
        this.inventoryPickedItem = item;
        this.inventoryPickedSource = 'crate'; // Track source
        this.inventoryPickedTarget = 'crate'; // Default target is crate
        this.inventoryPickedOriginalX = item.x;
        this.inventoryPickedOriginalY = item.y;
        this.inventoryPickedOriginalRotation = item.rotation;
        this.inventoryIgnoreNextMouseUp = true; // Ignore mouseup from this click

        // Calculate relative mouse offset within the item (for visual purposes)
        const rect = itemWrapper.getBoundingClientRect();
        const crateItems = document.getElementById('crateItems');
        const crateRect = crateItems.getBoundingClientRect();

        // Store mouse position relative to crate grid
        this.inventoryMouseX = event.clientX - crateRect.left;
        this.inventoryMouseY = event.clientY - crateRect.top;

        // Add event listeners
        this.mouseMoveHandler = (e) => this.onCrateMouseMove(e);
        this.mouseUpHandler = (e) => this.onCrateMouseUp(e);
        this.keyDownHandler = (e) => this.onInventoryKeyDown(e);

        window.addEventListener('mousemove', this.mouseMoveHandler);
        window.addEventListener('mouseup', this.mouseUpHandler);
        window.addEventListener('keydown', this.keyDownHandler);

        // Re-render both inventories to show item following cursor
        this.renderInventory();
        this.renderCrateInventory();
    }

    onCrateMouseMove(event) {
        if (!this.inventoryPickedItem) return;

        const item = this.inventoryPickedItem;

        // Get grid containers (not items layers) for proper bounds checking
        const backpackGrid = document.getElementById('inventoryGrid');
        const backpackRect = backpackGrid.getBoundingClientRect();

        const crateSection = document.getElementById('crateSection');
        const crateVisible = crateSection && crateSection.style.display !== 'none';
        let crateRect = null;
        let crateGrid = null;
        if (crateVisible) {
            crateGrid = document.getElementById('crateGrid');
            crateRect = crateGrid.getBoundingClientRect();
        }

        // Determine which container we're targeting based on mouse position
        let overBackpack = (event.clientX >= backpackRect.left && event.clientX <= backpackRect.right &&
                            event.clientY >= backpackRect.top && event.clientY <= backpackRect.bottom);

        let overCrate = false;
        if (crateVisible && crateRect) {
            overCrate = (event.clientX >= crateRect.left && event.clientX <= crateRect.right &&
                        event.clientY >= crateRect.top && event.clientY <= crateRect.bottom);
        }

        // Get items layers for position calculation
        const backpackItems = document.getElementById('inventoryItems');
        const backpackItemsRect = backpackItems.getBoundingClientRect();

        let crateItems = null;
        let crateItemsRect = null;
        if (crateVisible) {
            crateItems = document.getElementById('crateItems');
            crateItemsRect = crateItems.getBoundingClientRect();
        }

        // Update target and position based on which area mouse is over
        if (overBackpack) {
            // Mouse over backpack - calculate position relative to items layer
            this.inventoryMouseX = event.clientX - backpackItemsRect.left;
            this.inventoryMouseY = event.clientY - backpackItemsRect.top;
            this.inventoryPickedTarget = 'backpack';
        } else if (overCrate) {
            // Mouse over crate - calculate position relative to items layer
            this.inventoryMouseX = event.clientX - crateItemsRect.left;
            this.inventoryMouseY = event.clientY - crateItemsRect.top;
            this.inventoryPickedTarget = 'crate';
        } else {
            // Mouse is outside both areas - keep updating position relative to current target
            // This ensures the ghost follows the mouse everywhere, not just over the grids
            if (this.inventoryPickedTarget === 'crate' && crateVisible && crateItemsRect) {
                // Currently targeting crate, keep updating relative to crate items layer
                this.inventoryMouseX = event.clientX - crateItemsRect.left;
                this.inventoryMouseY = event.clientY - crateItemsRect.top;
                // Don't change target - stay as 'crate'
            } else {
                // Currently targeting backpack (or no crate visible), update relative to backpack items layer
                this.inventoryMouseX = event.clientX - backpackItemsRect.left;
                this.inventoryMouseY = event.clientY - backpackItemsRect.top;
                // Don't force target change - let it stay as is unless explicitly over a grid
            }
        }

        // Check if holding a chisel over a stone item (only in backpack)
        if (item.type === 'chisel' && this.inventoryPickedTarget === 'backpack') {
            try {
                const targetStone = this.getItemUnderCursor(this.inventoryMouseX, this.inventoryMouseY, item);
                if (this.chiselTarget !== targetStone) {
                    this.chiselTarget = targetStone;
                }
            } catch (error) {
                console.error('Error checking chisel target:', error);
                this.chiselTarget = null;
            }
        } else {
            this.chiselTarget = null;
        }

        // Re-render both inventories to update ghost position
        this.renderInventory();
        if (this.gameState.nearestCrate) {
            this.renderCrateInventory();
        }
    }

    onCrateMouseUp(event) {
        if (!this.inventoryPickedItem) return;

        // Ignore the mouseup from the pickup click
        if (this.inventoryIgnoreNextMouseUp) {
            this.inventoryIgnoreNextMouseUp = false;
            return;
        }

        const item = this.inventoryPickedItem;
        const source = this.inventoryPickedSource || 'backpack';
        const target = this.inventoryPickedTarget || source;

        // Check if chisel was released over a stone (only if coming from backpack)
        if (source === 'backpack' && item.type === 'chisel' && this.chiselTarget) {
            const targetStone = this.chiselTarget;

            // Clear chisel target
            this.chiselTarget = null;

            // Start chiseling action
            this.startChiselingAction(item, targetStone);

            // Clear picked item state
            this.inventoryPickedItem = null;
            this.inventoryPickedSource = null;
            this.inventoryPickedTarget = null;
            this.inventoryIgnoreNextMouseUp = false;

            // Remove global event listeners
            window.removeEventListener('mousemove', this.mouseMoveHandler);
            window.removeEventListener('mouseup', this.mouseUpHandler);
            window.removeEventListener('keydown', this.keyDownHandler);

            // Re-render inventory
            this.renderInventory();
            if (this.gameState.nearestCrate) {
                this.renderCrateInventory();
            }
            return;
        }

        // Clear any chisel target
        this.chiselTarget = null;

        // Check if dropping onto construction section (only if coming from backpack)
        if (source === 'backpack' && this.gameState.nearestConstructionSite && !this.gameState.isMoving) {
            const constructionSection = document.getElementById('constructionSection');
            if (constructionSection && constructionSection.style.display !== 'none') {
                const rect = constructionSection.getBoundingClientRect();

                // Check if mouse is over construction section
                if (event.clientX >= rect.left && event.clientX <= rect.right &&
                    event.clientY >= rect.top && event.clientY <= rect.bottom) {

                    const requiredMaterials = this.gameState.nearestConstructionSite.userData.requiredMaterials || {};
                    const currentMaterials = this.gameState.nearestConstructionSite.userData.materials || {};

                    // Check if this item type is needed
                    const itemType = item.type;

                    if (requiredMaterials[itemType]) {
                        const required = requiredMaterials[itemType];
                        const current = currentMaterials[itemType] || 0;

                        if (current < required) {
                            // Add material to construction
                            currentMaterials[itemType] = current + 1;
                            this.gameState.nearestConstructionSite.userData.materials = currentMaterials;

                            // Remove item from inventory
                            const itemIndex = this.gameState.inventory.items.indexOf(item);
                            if (itemIndex > -1) {
                                this.gameState.inventory.items.splice(itemIndex, 1);
                            }

                            console.log(`Added ${itemType} to construction (${current + 1}/${required})`);

                            // Clear picked item state
                            this.inventoryPickedItem = null;
                            this.inventoryPickedSource = null;
                            this.inventoryPickedTarget = null;
                            this.inventoryIgnoreNextMouseUp = false;

                            // Remove global event listeners
                            window.removeEventListener('mousemove', this.mouseMoveHandler);
                            window.removeEventListener('mouseup', this.mouseUpHandler);
                            window.removeEventListener('keydown', this.keyDownHandler);

                            // Re-render inventory (includes construction section and crate section)
                            this.renderInventory();
                            this.updateConstructionSection();
                            this.updateCrateSection();
                            return;
                        }
                    }
                }
            }
        }

        // Remove event listeners
        window.removeEventListener('mousemove', this.mouseMoveHandler);
        window.removeEventListener('mouseup', this.mouseUpHandler);
        window.removeEventListener('keydown', this.keyDownHandler);

        // Determine target inventory and validate placement
        if (target === 'backpack') {
            // Moving to backpack
            const gridPos = this.pixelToGrid(this.inventoryMouseX, this.inventoryMouseY);

            if (this.isValidPlacement(item, gridPos.x, gridPos.y, item.rotation)) {
                // Valid placement in backpack
                if (source === 'crate') {
                    // Remove from crate, add to backpack
                    const crateInventory = this.crateInventory;
                    const itemIndex = crateInventory.items.indexOf(item);
                    if (itemIndex > -1) {
                        crateInventory.items.splice(itemIndex, 1);
                    }
                    this.gameState.inventory.items.push(item);
                }
                // Update position
                item.x = gridPos.x;
                item.y = gridPos.y;
            } else {
                // Invalid placement - restore original position
                item.x = this.inventoryPickedOriginalX;
                item.y = this.inventoryPickedOriginalY;
                item.rotation = this.inventoryPickedOriginalRotation;
            }
        } else if (target === 'crate') {
            // Moving to crate
            const crateGridPos = this.pixelToCrateGrid(this.inventoryMouseX, this.inventoryMouseY);

            if (this.isValidCratePlacement(item, crateGridPos.x, crateGridPos.y, item.rotation)) {
                // Valid placement in crate
                if (source === 'backpack') {
                    // Remove from backpack, add to crate
                    const itemIndex = this.gameState.inventory.items.indexOf(item);
                    if (itemIndex > -1) {
                        this.gameState.inventory.items.splice(itemIndex, 1);
                    }
                    this.crateInventory.items.push(item);
                }
                // Update position
                item.x = crateGridPos.x;
                item.y = crateGridPos.y;
            } else {
                // Invalid placement - restore original position
                item.x = this.inventoryPickedOriginalX;
                item.y = this.inventoryPickedOriginalY;
                item.rotation = this.inventoryPickedOriginalRotation;
            }
        } else {
            // Dropped outside - restore original position
            item.x = this.inventoryPickedOriginalX;
            item.y = this.inventoryPickedOriginalY;
            item.rotation = this.inventoryPickedOriginalRotation;
        }

        // Clear picked item state
        this.inventoryPickedItem = null;
        this.inventoryPickedSource = null;
        this.inventoryPickedTarget = null;
        this.inventoryIgnoreNextMouseUp = false;

        // Re-render both inventories
        this.renderInventory();
        this.renderCrateInventory();

        // Mark crate inventory as dirty (needs saving)
        if (this.gameState.nearestCrate) {
            this.gameState.nearestCrate.userData.inventoryDirty = true;
        }
    }

    pixelToCrateGrid(pixelX, pixelY) {
        // Use same slot size and gap as backpack inventory
        const slotSize = this.gameState.inventory.slotSize;
        const gap = this.gameState.inventory.gap;
        const gridX = Math.floor(pixelX / (slotSize + gap));
        const gridY = Math.floor(pixelY / (slotSize + gap));
        return { x: gridX, y: gridY };
    }

    isValidCratePlacement(item, x, y, rotation) {
        // Check bounds (10x10 grid)
        const displayWidth = rotation === 90 ? item.height : item.width;
        const displayHeight = rotation === 90 ? item.width : item.height;

        if (x < 0 || y < 0 || x + displayWidth > 10 || y + displayHeight > 10) {
            return false;
        }

        // Check for overlaps with other items in crate
        const crateInventory = this.crateInventory;
        if (!crateInventory || !crateInventory.items) {
            return false;
        }

        for (const other of crateInventory.items) {
            if (other.id === item.id) continue; // Skip self

            const otherWidth = other.rotation === 90 ? other.height : other.width;
            const otherHeight = other.rotation === 90 ? other.width : other.height;

            // Check if rectangles overlap
            if (!(x >= other.x + otherWidth ||
                  x + displayWidth <= other.x ||
                  y >= other.y + otherHeight ||
                  y + displayHeight <= other.y)) {
                return false; // Overlap detected
            }
        }

        return true; // Valid placement
    }

    renderBuildMenu() {
        const structuresContainer = document.getElementById('buildMenuStructures');
        const buildMenuGrid = document.getElementById('buildMenuGrid');
        structuresContainer.innerHTML = ''; // Clear existing

        // Update grid styling dynamically
        const { slotSize, gap, rows, cols } = this.gameState.buildMenu;
        buildMenuGrid.style.gridTemplateColumns = `repeat(${cols}, ${slotSize}px)`;
        buildMenuGrid.style.gridTemplateRows = `repeat(${rows}, ${slotSize}px)`;
        buildMenuGrid.style.gap = `${gap}px`;

        // Update slot styling
        const slots = buildMenuGrid.querySelectorAll('.build-menu-slot');
        slots.forEach(slot => {
            slot.style.width = `${slotSize}px`;
            slot.style.height = `${slotSize}px`;
        });

        // Render structures at fixed positions
        this.gameState.buildMenu.structures.forEach((structure, index) => {
            // Create wrapper
            const structureWrapper = document.createElement('div');
            structureWrapper.className = 'build-menu-structure-wrapper';
            structureWrapper.dataset.structureId = structure.id;
            structureWrapper.style.position = 'absolute';

            // Place structures in a grid pattern (row by row)
            const x = index % cols;
            const y = Math.floor(index / cols);

            // Calculate pixel position
            const pixelPos = { x: x * (slotSize + gap), y: y * (slotSize + gap) };
            structureWrapper.style.left = pixelPos.x + 'px';
            structureWrapper.style.top = pixelPos.y + 'px';

            // Create image element
            const structureEl = document.createElement('img');
            structureEl.src = structure.imagePath;
            structureEl.className = 'build-menu-structure';
            structureEl.style.position = 'relative';

            // Calculate size based on slots
            const displayWidth = structure.width;
            const displayHeight = structure.height;
            const widthPx = displayWidth * slotSize + (displayWidth - 1) * gap;
            const heightPx = displayHeight * slotSize + (displayHeight - 1) * gap;

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

    onStructureClick(event, structure) {
        event.preventDefault();
        event.stopPropagation();

        // Pick up the structure for placement
        this.buildMenuPickedStructure = structure;

        // Close build menu
        this.toggleBuildMenu();

        // Start foundation placement flow
        this.startFoundationPlacement(structure);
    }

    showBuildMenuTooltip(event, structure) {
        const tooltip = document.getElementById('buildMenuTooltip');
        const titleEl = tooltip.querySelector('.tooltip-title');

        // Set content
        titleEl.textContent = structure.name;

        // Position and show tooltip
        this.updateBuildMenuTooltipPosition(event);
        tooltip.style.display = 'block';
    }

    updateBuildMenuTooltipPosition(event) {
        const tooltip = document.getElementById('buildMenuTooltip');
        // Position tooltip slightly offset from cursor
        tooltip.style.left = (event.clientX + 15) + 'px';
        tooltip.style.top = (event.clientY + 15) + 'px';
    }

    hideBuildMenuTooltip() {
        const tooltip = document.getElementById('buildMenuTooltip');
        tooltip.style.display = 'none';
    }

    // ==========================================
    // FOUNDATION PLACEMENT SYSTEM
    // ==========================================

    startFoundationPlacement(structure) {
        this.gameState.foundationPlacement.active = true;
        this.gameState.foundationPlacement.phase = 'position';
        this.gameState.foundationPlacement.structure = structure;
        this.gameState.foundationPlacement.rotation = 0;
        this.gameState.foundationPlacement.height = 0;

        // Load actual structure model for preview (foundation, foundationcorner, or foundationroundcorner)
        const structureModel = modelManager.getModel(structure.type);
        if (!structureModel) {
            console.error(`${structure.type} model not loaded for preview`);
            return;
        }

        const previewGroup = new THREE.Group();

        // Determine scale based on structure type
        let previewScale = 0.5;  // Default for foundations and crates
        let glowScale = 0.52;

        if (structure.type === 'outpost') {
            previewScale = 0.03;
            glowScale = 0.032;
        } else if (structure.type === 'tent') {
            previewScale = 0.5;
            glowScale = 0.52;
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

        this.gameState.foundationPlacement.previewBox = previewGroup;
        this.gameState.foundationPlacement.previewBox.userData.foundationPreview = foundationPreview;
        this.gameState.foundationPlacement.previewBox.userData.glowOutline = glowOutline;
        this.gameState.foundationPlacement.previewBox.visible = true;
        this.scene.add(this.gameState.foundationPlacement.previewBox);

        console.log('Foundation placement started - model preview created');
        ui.updateStatusLine1('Move mouse to position foundation, click to confirm', 0);
    }

    updateFoundationPreview(mouseX, mouseZ, mouseY) {
        if (!this.gameState.foundationPlacement.active) return;

        const placement = this.gameState.foundationPlacement;
        const previewBox = placement.previewBox;

        // Safety check: if previewBox doesn't exist (model failed to load), abort
        if (!previewBox) {
            console.warn('Preview box not available, cannot update preview');
            return;
        }

        if (placement.phase === 'position') {
            // Position phase - follow mouse on terrain with 0.5 grid snapping
            placement.position.x = Math.round(mouseX / 0.5) * 0.5;
            placement.position.z = Math.round(mouseZ / 0.5) * 0.5;

            const structure = placement.structure;
            let previewY;

            // Crates snap to foundation height, foundations use terrain height
            if (structure && structure.requiresFoundation) {
                // For crates: find foundation and snap to its position
                const foundationBelow = this.findFoundationAtPosition(placement.position.x, placement.position.z);

                if (foundationBelow) {
                    // Snap to foundation position
                    placement.position.x = foundationBelow.position.x;
                    placement.position.z = foundationBelow.position.z;

                    // ADDING NEW STRUCTURES - STEP 4: Y POSITION CALCULATION
                    // For structures on foundations, calculate proper Y position.
                    // Formula: foundation.y + (foundationHeight/2) + (structureHeight/2) + gap
                    // This positions the structure's center above the foundation's top surface.
                    // Adjust heights based on your actual model dimensions at scale 0.5
                    const foundationHeight = 2.5; // Foundation height at scale 0.5
                    const crateHeight = 0.5; // Approximate crate height at scale 0.5
                    // Position crate center above foundation: foundation_center + foundation_half_height + crate_half_height
                    // Add small extra offset to ensure visibility
                    const extraOffset = 0.1; // Small gap between foundation and crate
                    previewY = foundationBelow.position.y + (foundationHeight / 2) + (crateHeight / 2) + extraOffset;
                } else {
                    // No foundation - show at mouse position but will be marked invalid
                    const terrainHeight = this.terrainRenderer.heightCalculator.calculateHeight(placement.position.x, placement.position.z);
                    previewY = terrainHeight;
                }

                placement.position.y = previewY;
            } else {
                // Regular foundations: calculate average height from 4 corners
                const halfSize = 0.25;
                const corner1 = this.terrainRenderer.heightCalculator.calculateHeight(placement.position.x - halfSize, placement.position.z - halfSize);
                const corner2 = this.terrainRenderer.heightCalculator.calculateHeight(placement.position.x + halfSize, placement.position.z - halfSize);
                const corner3 = this.terrainRenderer.heightCalculator.calculateHeight(placement.position.x - halfSize, placement.position.z + halfSize);
                const corner4 = this.terrainRenderer.heightCalculator.calculateHeight(placement.position.x + halfSize, placement.position.z + halfSize);
                const averageHeight = (corner1 + corner2 + corner3 + corner4) / 4;

                // Snap to 0.5 grid - round UP to nearest 0.5 increment
                const snappedHeight = Math.ceil(averageHeight / 0.5) * 0.5;
                previewY = snappedHeight;
                placement.position.y = snappedHeight;
            }

            previewBox.position.set(placement.position.x, previewY, placement.position.z);
            previewBox.visible = true;

            // Validate placement (throttled to reduce lag)
            this.validateFoundationPlacementThrottled();

        } else if (placement.phase === 'rotation') {
            // Rotation phase - one face follows the cursor position
            const angle = Math.atan2(mouseZ - placement.position.z, mouseX - placement.position.x);
            const degrees = -(angle * (180 / Math.PI)); // Negate for opposite rotation

            // Snap to 15° increments
            placement.rotation = Math.round(degrees / 15) * 15;

            previewBox.rotation.y = placement.rotation * (Math.PI / 180);

        } else if (placement.phase === 'height') {
            // Height phase - adjust Y based on mouse vertical movement
            // Mouse up (smaller Y) = increase height, mouse down (larger Y) = decrease height
            const mouseDelta = placement.initialMouseY - mouseY;
            // Scale factor: 100 pixels of mouse movement = 1 unit of height
            const heightAdjustment = mouseDelta / 100;

            // Snap to 0.5 increments and clamp to range (down: -2, up: +0.75 relative to base)
            const snappedHeight = Math.round(heightAdjustment / 0.5) * 0.5;
            placement.height = Math.max(-2, Math.min(0.75, snappedHeight));

            // Apply height offset to snapped base (base is already on 0.5 grid from position phase)
            const baseHeight = placement.position.y; // Already snapped to 0.5 grid
            previewBox.position.y = baseHeight + placement.height; // Final Y always on 0.5 grid

            // Update status line to show current offset and final absolute Y
            const finalY = baseHeight + placement.height;
            ui.updateStatusLine2(`Height: ${placement.height.toFixed(2)} (Final Y: ${finalY.toFixed(2)})`, 0);
        }

        // Update glow outline color based on validity
        const glowOutline = previewBox.userData.glowOutline;

        if (placement.isValid) {
            // Green glow for valid placement
            glowOutline.traverse((child) => {
                if (child instanceof THREE.Mesh && child.material) {
                    child.material.color.setHex(0x00ff00);
                }
            });
            if (placement.phase === 'position') {
                ui.updateStatusLine2('Valid location', 0);
            }
        } else {
            // Red glow for invalid placement
            glowOutline.traverse((child) => {
                if (child instanceof THREE.Mesh && child.material) {
                    child.material.color.setHex(0xff0000);
                }
            });
            // Show tooltip with reason
            ui.updateStatusLine2(placement.invalidReason, 0);
        }
    }

    // ADDING NEW STRUCTURES - STEP 3: PLACEMENT VALIDATION
    // This function validates if a structure can be placed at the current position.
    // For structures with requiresFoundation=true:
    //   - Checks for foundation at position
    //   - Skips terrain validation (slope, water, etc.)
    // For regular structures:
    //   - Validates terrain slope
    //   - Checks distance from other objects
    //   - Can add custom validation rules
    validateFoundationPlacement() {
        const placement = this.gameState.foundationPlacement;
        const pos = placement.position;
        const structure = placement.structure;

        // Special validation for structures requiring foundation (like crates)
        if (structure && structure.requiresFoundation) {
            // Check if there's a foundation at this exact position
            const foundationBelow = this.findFoundationAtPosition(pos.x, pos.z);

            if (!foundationBelow) {
                placement.isValid = false;
                placement.invalidReason = 'Requires foundation';
                return;
            }

            // Crates can only be placed on full foundations (not corners)
            if (foundationBelow.userData.modelType !== 'foundation') {
                placement.isValid = false;
                placement.invalidReason = 'Requires full foundation';
                return;
            }

            // Check if foundation already has a crate/tent
            const existingCrate = this.findCrateOnFoundation(foundationBelow);
            if (existingCrate) {
                placement.isValid = false;
                placement.invalidReason = 'Foundation already occupied';
                return;
            }

            // Store foundation reference for later use
            placement.foundationBelow = foundationBelow;

            // All checks passed for crate
            placement.isValid = true;
            placement.invalidReason = '';
            return;
        }

        // Regular foundation validation
        // Check 1: Terrain slope
        const normal = this.terrainRenderer.heightCalculator.calculateNormal(pos.x, pos.z);
        const slope = Math.acos(normal.y) * (180 / Math.PI); // Convert to degrees

        if (slope > 50) {
            placement.isValid = false;
            placement.invalidReason = 'Slope too steep';
            return;
        }

        // Check 2: Distance from objects (1 unit minimum)
        const nearbyObjects = this.findObjectsNearPoint(pos.x, pos.z, 1);
        if (nearbyObjects.length > 0) {
            placement.isValid = false;
            placement.invalidReason = 'Too close to objects';
            return;
        }

        // All checks passed
        placement.isValid = true;
        placement.invalidReason = '';
    }

    findObjectsNearPoint(x, z, radius) {
        const nearbyObjects = [];
        this.scene.traverse((object) => {
            if (object.userData && object.userData.objectId) {
                const dx = object.position.x - x;
                const dz = object.position.z - z;
                const distance = Math.sqrt(dx * dx + dz * dz);
                if (distance < radius) {
                    nearbyObjects.push(object);
                }
            }
        });
        return nearbyObjects;
    }

    findFoundationAtPosition(x, z) {
        // Find foundation at exact grid position (within 0.1 unit tolerance)
        let foundFoundation = null;
        this.scene.traverse((object) => {
            if (object.userData && object.userData.objectId) {
                const modelType = object.userData.modelType;
                if (modelType === 'foundation' ||
                    modelType === 'foundationcorner' ||
                    modelType === 'foundationroundcorner') {
                    const dx = Math.abs(object.position.x - x);
                    const dz = Math.abs(object.position.z - z);
                    if (dx < 0.1 && dz < 0.1) {
                        foundFoundation = object;
                    }
                }
            }
        });
        return foundFoundation;
    }

    findCrateOnFoundation(foundation) {
        // Check if there's already a crate or tent at this foundation's position
        const fx = foundation.position.x;
        const fz = foundation.position.z;
        let existingCrate = null;

        this.scene.traverse((object) => {
            if (object.userData && object.userData.objectId) {
                if (object.userData.modelType === 'crate' || object.userData.modelType === 'tent') {
                    const dx = Math.abs(object.position.x - fx);
                    const dz = Math.abs(object.position.z - fz);
                    if (dx < 0.1 && dz < 0.1) {
                        existingCrate = object;
                    }
                }
            }
        });
        return existingCrate;
    }

    trySpawnAI() {
        console.log('trySpawnAI() called - checking all tents for AI spawning');

        // Find all tents in the scene
        const tents = [];
        this.scene.traverse((object) => {
            if (object.userData && object.userData.objectId && object.userData.modelType === 'tent') {
                tents.push(object);
            }
        });

        console.log(`Found ${tents.length} tents in scene`);

        if (tents.length === 0) {
            console.log('No tents found - no AI will spawn');
            return;
        }

        // Check each tent for AI spawning
        for (const tent of tents) {
            const tentId = tent.userData.objectId;

            // Skip if this tent already has an AI
            if (this.tentAIEnemies.has(tentId)) {
                console.log(`Tent ${tentId} already has AI - skipping`);
                continue;
            }

            // Skip if this tent's AI has died (no respawn)
            if (this.deadTentAIs.has(tentId)) {
                console.log(`Tent ${tentId} had AI die - will not respawn`);
                continue;
            }

            // Check if any player is within 15 units of this tent
            let playerNearby = false;

            // Check local player
            if (!this.isDead) {
                const distToLocal = Math.sqrt(
                    Math.pow(this.playerObject.position.x - tent.position.x, 2) +
                    Math.pow(this.playerObject.position.z - tent.position.z, 2)
                );
                if (distToLocal < 15) {
                    playerNearby = true;
                    console.log(`Local player within 15 units of tent ${tentId} - skipping AI spawn`);
                }
            }

            // Check peer players
            if (!playerNearby) {
                this.networkManager.avatars.forEach((avatar, peerId) => {
                    if (!avatar.userData.isDead) {
                        const distToPeer = Math.sqrt(
                            Math.pow(avatar.position.x - tent.position.x, 2) +
                            Math.pow(avatar.position.z - tent.position.z, 2)
                        );
                        if (distToPeer < 15) {
                            playerNearby = true;
                            console.log(`Peer ${peerId} within 15 units of tent ${tentId} - skipping AI spawn`);
                        }
                    }
                });
            }

            // Skip this tent if players are too close
            if (playerNearby) {
                continue;
            }

            // All conditions met - spawn AI for this tent!
            const distance = 2 + Math.random(); // Random distance between 2 and 3
            const angle = Math.random() * Math.PI * 2; // Random angle
            const aiSpawnPosition = new THREE.Vector3(
                tent.position.x + Math.cos(angle) * distance,
                tent.position.y,
                tent.position.z + Math.sin(angle) * distance
            );

            // Create AI enemy controller
            const aiController = new AIEnemy(this, this.scene, this.networkManager, aiSpawnPosition);

            // Store AI data for this tent
            this.tentAIEnemies.set(tentId, {
                controller: aiController,
                tentObjectId: tentId,
                isDead: false
            });

            // Update legacy references (use first spawned AI for backward compatibility)
            if (!this.aiEnemyController) {
                this.aiEnemyController = aiController;
                this.aiEnemy = aiController.enemy;
                this.networkManager.setAIEnemy(this.aiEnemy);
            }

            console.log(`✅ Spawned AI for tent ${tentId} at (${aiSpawnPosition.x.toFixed(2)}, ${aiSpawnPosition.z.toFixed(2)})`);
        }

        console.log(`AI spawn check complete. Total AI enemies: ${this.tentAIEnemies.size}`);
    }

    // ADDING NEW STRUCTURES - PLACEMENT FLOW
    // Placement phases for structures:
    // 1. Position phase - Player moves mouse to position structure
    // 2. Rotation phase - Player rotates structure
    // 3. Height phase - Player adjusts height (SKIPPED for requiresFoundation structures)
    // Structures with requiresFoundation=true go directly from rotation to confirm
    advanceFoundationPlacementPhase(mouseY) {
        const placement = this.gameState.foundationPlacement;
        const structure = placement.structure;

        if (placement.phase === 'position') {
            if (!placement.isValid) {
                // Cancel placement on invalid location click
                ui.updateStatusLine1(`Placement cancelled: ${placement.invalidReason}`, 3000);
                this.cancelFoundationPlacement();
                return;
            }
            placement.phase = 'rotation';
            ui.updateStatusLine1('Move mouse to rotate, click to confirm', 0);

        } else if (placement.phase === 'rotation') {
            // Crates, outposts, and tents skip height phase - they snap to terrain automatically
            if (structure && (structure.requiresFoundation || structure.type === 'outpost' || structure.type === 'tent')) {
                this.confirmFoundationPlacement();
            } else {
                // Foundations go to height adjustment phase
                placement.phase = 'height';
                // Capture initial mouse Y for height adjustment
                placement.initialMouseY = mouseY || 0;
                placement.height = 0;  // Reset height to 0 when entering this phase
                ui.updateStatusLine1('Move mouse up/down to adjust height, click to confirm', 0);
            }

        } else if (placement.phase === 'height') {
            // Final placement (only for foundations)
            this.confirmFoundationPlacement();
        }
    }

    confirmFoundationPlacement() {
        const placement = this.gameState.foundationPlacement;
        const structure = placement.structure;

        if (!placement.isValid) {
            ui.updateStatusLine1(`Cannot place: ${placement.invalidReason}`, 3000);
            return;
        }

        // Special handling for crate placement
        if (structure && structure.requiresFoundation) {
            const foundation = placement.foundationBelow;

            // Calculate crate Y position (on top of foundation)
            // Use same calculation as preview for consistency
            const foundationHeight = 2.5; // Foundation height at scale 0.5
            const crateHeight = 0.5; // Approximate crate height at scale 0.5
            // Position crate center above foundation: foundation_center + foundation_half_height + crate_half_height
            // Add small extra offset to ensure visibility
            const extraOffset = 0.1; // Small gap between foundation and crate
            const crateY = foundation.position.y + (foundationHeight / 2) + (crateHeight / 2) + extraOffset;

            // Send to server to spawn crate construction site
            console.log(`Placing crate construction at Y=${crateY} (foundation Y=${foundation.position.y})`);
            this.networkManager.sendMessage('place_construction_site', {
                position: [foundation.position.x, crateY, foundation.position.z],
                rotation: placement.rotation,
                scale: 0.017,
                targetStructure: structure.type,  // 'crate'
                finalCrateY: crateY,  // Store final crate Y
                foundationId: foundation.userData.objectId  // Link to foundation
            });

            console.log('Crate construction site placement request sent to server:', {
                position: [foundation.position.x, crateY, foundation.position.z],
                rotation: placement.rotation,
                targetStructure: structure.type,
                foundationId: foundation.userData.objectId
            });

            ui.updateStatusLine1('Crate construction site placed!', 3000);
            this.cancelFoundationPlacement();
            return;
        }

        // Regular foundation placement
        // Calculate average height of 4 corners for construction site
        const halfSize = 0.25;
        const corner1 = this.terrainRenderer.heightCalculator.calculateHeight(placement.position.x - halfSize, placement.position.z - halfSize);
        const corner2 = this.terrainRenderer.heightCalculator.calculateHeight(placement.position.x + halfSize, placement.position.z - halfSize);
        const corner3 = this.terrainRenderer.heightCalculator.calculateHeight(placement.position.x - halfSize, placement.position.z + halfSize);
        const corner4 = this.terrainRenderer.heightCalculator.calculateHeight(placement.position.x + halfSize, placement.position.z + halfSize);
        const averageHeight = (corner1 + corner2 + corner3 + corner4) / 4;

        // Preview model's final Y position (what player saw and adjusted)
        const previewFinalY = placement.position.y + placement.height;

        // Send to server to spawn construction site (server will broadcast to all clients)
        this.networkManager.sendMessage('place_construction_site', {
            position: [placement.position.x, averageHeight, placement.position.z],
            rotation: placement.rotation,
            scale: 0.017,
            targetStructure: structure.type,  // Use actual structure type (foundation, foundationcorner, foundationroundcorner)
            finalFoundationY: previewFinalY  // Store preview Y for final structure
        });

        console.log('Construction site placement request sent to server:', {
            position: [placement.position.x, averageHeight, placement.position.z],
            rotation: placement.rotation,
            scale: 0.017,
            targetStructure: structure.type,
            finalFoundationY: previewFinalY
        });

        ui.updateStatusLine1('Construction site placed!', 3000);

        // Clean up placement state
        this.cancelFoundationPlacement();
    }

    cancelFoundationPlacement() {
        const placement = this.gameState.foundationPlacement;

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

        ui.updateStatusLine1('', 0);
        ui.updateStatusLine2('', 0);
    }

    cancelPickup() {
        // Restore item to original position
        if (this.inventoryPickedItem) {
            this.inventoryPickedItem.x = this.inventoryPickedOriginalX;
            this.inventoryPickedItem.y = this.inventoryPickedOriginalY;
            this.inventoryPickedItem.rotation = this.inventoryPickedOriginalRotation;
        }

        // Clear picked item state
        this.inventoryPickedItem = null;
        this.inventoryIgnoreNextMouseUp = false;

        // Clear chisel target
        this.chiselTarget = null;

        // Remove event listeners
        if (this.mouseMoveHandler) {
            window.removeEventListener('mousemove', this.mouseMoveHandler);
            window.removeEventListener('mouseup', this.mouseUpHandler);
            window.removeEventListener('keydown', this.keyDownHandler);
        }

        // Re-render to snap back
        this.renderInventory();
    }

    async initiateP2PConnection(peerId) {
        const connection = this.networkManager.createPeerConnection(peerId, true);
        try {
            const offer = await connection.createOffer();
            await connection.setLocalDescription(offer);
            this.networkManager.sendMessage('webrtc_offer', {
                recipientId: peerId,
                senderId: this.gameState.clientId,
                offer
            });
        } catch (error) {
            ui.updateStatus(`❌ Failed to create offer for ${peerId}: ${error}`);
        }
    }

    // --- Input and Resizing ---

    onPointerMove(event) {
        if (event.target.tagName !== 'CANVAS') return;

        // Only update if foundation placement is active
        if (!this.gameState.foundationPlacement.active) return;

        // Calculate normalized device coordinates
        this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

        // Raycast to find terrain intersection
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const terrainObjects = Array.from(this.terrainRenderer.chunkMap.values()).map(c => c.mesh);
        const waterObjects = this.waterRenderer.getWaterChunks();
        const allObjects = [...terrainObjects, ...waterObjects];
        const intersects = this.raycaster.intersectObjects(allObjects, true);

        if (intersects.length > 0) {
            const { point } = intersects[0];
            // Pass both terrain coordinates and screen Y for height adjustment
            this.updateFoundationPreview(point.x, point.z, event.clientY);
        }
    }

    onPointerDown(event) {
        if (event.target.tagName !== 'CANVAS') return;

        // Prevent any action if player is dead
        if (this.isDead) {
            console.log('Cannot act while dead');
            return;
        }

        // Prevent movement during shooting pause
        if (Date.now() < this.playerShootingPauseEndTime) {
            console.log('Cannot move while shooting');
            return;
        }

        // Resume AudioContext on first user interaction (browser requirement)
        if (this.audioManager) {
            this.audioManager.resumeContext();
        }

        // Handle foundation placement if active
        if (this.gameState.foundationPlacement.active) {
            this.advanceFoundationPlacementPhase(event.clientY);
            return;
        }

        // Prevent movement during chopping/harvesting
        if (this.gameState.activeChoppingAction) {
            console.log('Cannot move while chopping/harvesting');
            return;
        }

        // Prevent movement when inventory is open (forces player to close menu first)
        if (this.gameState.inventoryOpen) {
            console.log('Cannot move while inventory is open');
            return;
        }

        this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.pointer, this.camera);
        const terrainObjects = Array.from(this.terrainRenderer.chunkMap.values()).map(c => c.mesh);
        const waterObjects = this.waterRenderer.getWaterChunks();

        // Collect walkable foundation objects for raycast (allows clicking on foundations)
        const foundationObjects = [];
        for (const objects of this.terrainRenderer.chunkTrees.values()) {
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
        const intersects = this.raycaster.intersectObjects(allObjects, true);

        if (intersects.length > 0) {
            const { point } = intersects[0];
            // Use clicked position (X, Y, Z) - if clicking on foundation, Y will be foundation surface
            this.gameState.playerTargetPosition.set(point.x, point.y, point.z);
            this.gameState.isMoving = true;
            ui.updateStatus(`🚀 Moving to clicked position...`);

            // Hide construction/crate sections when player starts moving
            if (this.gameState.inventoryOpen) {
                this.updateConstructionSection();
                this.updateCrateSection();
            }

            // Update button states immediately when starting movement
            const hasAxe = this.hasToolWithDurability('axe');
            const hasSaw = this.hasToolWithDurability('saw');
            const isOnCooldown = this.gameState.harvestCooldown && this.gameState.harvestCooldown.endTime > Date.now();
            ui.updateButtonStates(this.gameState.isInChunk, this.gameState.nearestObject, hasAxe, hasSaw, isOnCooldown, this.gameState.nearestConstructionSite, this.gameState.isMoving, this.gameState.nearestCrate);

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
            this.calculateInventorySize();
            this.renderInventory();
            // Also update crate inventory if it's showing
            if (this.gameState.nearestCrate) {
                this.renderCrateInventory();
            }
        }

        // Recalculate build menu sizes if build menu is open
        if (this.gameState.buildMenuOpen) {
            this.calculateBuildMenuSize();
            this.renderBuildMenu();
        }
    }

    zoomIn() {
        this.gameState.cameraZoom = Math.max(
            this.gameState.cameraZoomMin,
            this.gameState.cameraZoom - 0.05
        );
    }

    zoomOut() {
        this.gameState.cameraZoom = Math.min(
            this.gameState.cameraZoomMax,
            this.gameState.cameraZoom + 0.05
        );
    }


    // --- Animation Loop and Updates ---

    animate() {
        requestAnimationFrame(this.animate.bind(this));
        const frameStartTime = performance.now();
        const now = frameStartTime;
        const deltaTime = now - this.gameState.lastFrameTime;

        // Increment frame counter
        this.frameCount++;

        this.updatePlayerMovement(deltaTime);
        this.updateAvatarMovement(deltaTime);
        this.updatePeerAIEnemies(deltaTime);

        // Update all tent AI enemies
        for (const [tentId, aiData] of this.tentAIEnemies.entries()) {
            if (!aiData.isDead && aiData.controller) {
                aiData.controller.update(deltaTime, now);
            }
        }

        // Legacy: Also update single AI reference for backward compatibility
        if (this.aiEnemyController && !this.aiEnemyIsDead) {
            // Already updated in the loop above, skip to avoid double updates
        }

        // Periodically check for new tent spawns (every 3 seconds)
        if (this.frameCount % 180 === 0) {
            this.trySpawnAI();
        }

        this.updatePlayerShooting();
        this.updateChoppingAction();

        // Update player animation
        if (this.isDead) {
            // Update death animation
            this.updateDeathAnimation(this.playerObject, this.deathStartTime, deltaTime, this.fallDirection, true);
        } else if (this.animationMixer) {
            // Check if shoot animation is playing
            const isShootPlaying = this.shootAction && this.shootAction.isRunning();

            if (this.gameState.activeChoppingAction) {
                // Play chopping animation at 1.5x speed
                this.animationMixer.update((deltaTime / 1000) * 1.5);
            } else if (isShootPlaying) {
                // Play shoot animation at 3x speed (during 1 second pause)
                this.animationMixer.update((deltaTime / 1000) * 3);
            } else if (this.playerInCombatStance) {
                // In combat stance: hold frame 1 of shoot animation while walking
                if (this.shootAction) {
                    this.shootAction.paused = false;
                    this.shootAction.time = 0; // Frame 1
                    this.shootAction.weight = 1.0;
                    if (!this.shootAction.isRunning()) {
                        this.shootAction.play();
                    }
                    this.shootAction.paused = true; // Freeze on frame 1
                }

                if (this.gameState.isMoving) {
                    // Walk animation continues (blend with frame 1 hold)
                    this.animationMixer.update((deltaTime / 1000) * 2.5);
                } else {
                    // Idle but hold frame 1 of shoot
                    this.animationMixer.update(0); // No time advance
                }
            } else {
                // Not in combat: normal animations
                // Stop shoot animation if it's paused from combat stance
                if (this.shootAction && this.shootAction.paused) {
                    this.shootAction.stop();
                    this.shootAction.reset();
                }

                if (this.gameState.isMoving) {
                    // Play walk animation when moving (2.5x faster)
                    this.animationMixer.update((deltaTime / 1000) * 2.5);
                } else {
                    // Idle: freeze on first frame of walk animation
                    this.animationMixer.setTime(0);
                }
            }
        }

        // Update peer avatar death animations
        this.networkManager.avatars.forEach((avatar, peerId) => {
            if (avatar.userData.isDead) {
                this.updateDeathAnimation(avatar, avatar.userData.deathStartTime, deltaTime, avatar.userData.fallDirection || 1, false);
            }
        });

        // Update peer AI death animations
        this.networkManager.peers.forEach((peer, peerId) => {
            if (peer.aiEnemy && peer.aiEnemy.userData.isDead) {
                this.updateDeathAnimation(peer.aiEnemy, peer.aiEnemy.userData.deathStartTime, deltaTime, peer.aiEnemy.userData.fallDirection || 1, false);
            }
        });

        this.updateCameraAndLighting();
        this.runPeriodicChecks(now);

        // Process chunk creation queue (1 chunk per frame)
        const chunkStartTime = performance.now();
        this.chunkManager.processChunkQueue();
        const chunkTime = performance.now() - chunkStartTime;

        // Process vertex updates (batched for smoothness - highest priority after chunk creation)
        const vertexStartTime = performance.now();
        // Pass player position for distance checks
        const playerPos = this.player ? this.player.position : null;
        this.terrainRenderer.processVertexUpdateQueue(playerPos);
        const vertexTime = performance.now() - vertexStartTime;

        // Process object generation queue (1 chunk's objects per frame)
        const objectStartTime = performance.now();
        this.terrainRenderer.processObjectGenerationQueue();
        const objectTime = performance.now() - objectStartTime;

        // Emergency disposal if queue gets too large (prevents accumulation)
        // Increased threshold since we now have regular 500ms cleanup
        if (this.chunkManager.pendingChunkDisposals.length > 20) {
            console.log('🚨 Emergency disposal triggered - queue size:', this.chunkManager.pendingChunkDisposals.length);
            this.chunkManager.processDisposalQueue();
        }

        this.waterRenderer.update(now);

        const renderStartTime = performance.now();
        this.renderer.render(this.scene, this.camera);
        const renderTime = performance.now() - renderStartTime;

        this.gameState.lastFrameTime = now;

        // Update FPS counter
        this.fpsFrames++;
        if (now - this.fpsLastTime >= this.fpsUpdateInterval) {
            const fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsLastTime));
            ui.updateFPS(fps);
            this.fpsFrames = 0;
            this.fpsLastTime = now;
        }
    }

    updatePlayerMovement(deltaTime) {
        const { position } = this.playerObject;

        // Don't move if player is dead
        if (this.isDead) {
            this.gameState.isMoving = false;
            return;
        }

        // Always update Y position based on terrain/foundation, even when not moving
        if (!this.gameState.isMoving) {
            const collision = this.checkStructureCollision(position);
            if (collision.hasCollision && collision.objectHeight) {
                const targetY = collision.objectHeight + 0.03;
                position.y = THREE.MathUtils.lerp(position.y, targetY, 0.2);
            } else if (this.terrainRenderer) {
                const terrainHeight = this.terrainRenderer.getHeightFast(position.x, position.z);
                const targetY = terrainHeight + 0.03;
                position.y = THREE.MathUtils.lerp(position.y, targetY, 0.2);
            }
            return;
        }

        const { playerTargetPosition } = this.gameState;

        // Calculate 2D distance (X, Z only) since Y follows terrain
        const dx = position.x - playerTargetPosition.x;
        const dz = position.z - playerTargetPosition.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        if (distance <= this.stopThreshold) {
    // Arrived at target - only update X and Z, keep Y from movement
    position.x = playerTargetPosition.x;
    position.z = playerTargetPosition.z;
    this.gameState.isMoving = false;
    ui.updateStatus("🛑 Arrived at destination.");

    // Show construction/crate sections if near site/crate and inventory is open
    if (this.gameState.inventoryOpen) {
        this.updateConstructionSection();
        this.updateCrateSection();
    }

    // Compare JavaScript vs Shader terrain height calculation
    if (this.terrainRenderer?.heightCalculator) {
        const playerX = position.x;
        const playerZ = position.z;
        const jsHeight = this.terrainRenderer.heightCalculator.calculateHeight(playerX, playerZ);

        console.log(`📍 Player at (${playerX.toFixed(2)}, ${playerZ.toFixed(2)})`);
        console.log(`   JavaScript terrain height: ${jsHeight.toFixed(3)}`);
        console.log(`   Water level: 1.02`);
        console.log(`   Expected water depth: ${(1.02 - jsHeight).toFixed(3)}`);
        console.log(`   (Shader calculates height in real-time - visual mismatch = shader error)`);
    }

    this.checkProximityToObjects(); // Check proximity when arriving

    // Update button states immediately when stopping (checkProximityToObjects already calls this, but for immediate feedback)
} else {
            const moveStep = this.playerSpeed * deltaTime;
            const alpha = Math.min(1, moveStep / distance);

            // Calculate next position
            const nextPosition = position.clone();
            nextPosition.lerp(playerTargetPosition, alpha);

            // Check for soft collision with other players/AI
            const characterCollision = this.checkCharacterCollision(nextPosition, position, 'localPlayer');
            const finalNextPosition = characterCollision.hasCollision ? characterCollision.adjustedPosition : nextPosition;

            // Check for collision with structures
            const collision = this.checkStructureCollision(finalNextPosition);
            if (collision.hasCollision) {
                if (collision.objectHeight) {
                    // Foundation - allow step-up
                    const stepHeight = collision.objectHeight - position.y;
                    const MAX_STEP_HEIGHT = 0.3;

                    if (stepHeight > 0 && stepHeight <= MAX_STEP_HEIGHT) {
                        // Step up onto foundation
                        position.copy(finalNextPosition);
                        // Smooth lerp to foundation height
                        const targetY = collision.objectHeight + 0.03;
                        position.y = THREE.MathUtils.lerp(position.y, targetY, 0.2);
                    } else if (stepHeight <= 0) {
                        // Already on or above foundation
                        position.copy(finalNextPosition);
                        const targetY = collision.objectHeight + 0.03;
                        position.y = THREE.MathUtils.lerp(position.y, targetY, 0.2);
                    } else {
                        // Too high to step up
                        this.gameState.isMoving = false;
                        ui.updateStatusLine2('⚠️ Blocked by structure', 2000);

                        // Notify peers that movement was blocked
                        this.networkManager.broadcastP2P({
                            type: 'player_sync',
                            payload: {
                                position: position.toArray(),
                                target: null
                            }
                        });

                        // Show construction/crate sections if near site/crate and inventory is open
                        if (this.gameState.inventoryOpen) {
                            this.updateConstructionSection();
                            this.updateCrateSection();
                        }

                        // Update button states immediately when blocked
                        const hasAxe = this.hasToolWithDurability('axe');
                        const hasSaw = this.hasToolWithDurability('saw');
                        const isOnCooldown = this.gameState.harvestCooldown && this.gameState.harvestCooldown.endTime > Date.now();
                        ui.updateButtonStates(this.gameState.isInChunk, this.gameState.nearestObject, hasAxe, hasSaw, isOnCooldown, this.gameState.nearestConstructionSite, this.gameState.isMoving, this.gameState.nearestCrate);
                    }
                } else {
                    // Construction site - block movement
                    this.gameState.isMoving = false;
                    ui.updateStatusLine2('⚠️ Blocked by structure', 2000);

                    // Notify peers that movement was blocked
                    this.networkManager.broadcastP2P({
                        type: 'player_sync',
                        payload: {
                            position: position.toArray(),
                            target: null
                        }
                    });

                    // Show construction/crate sections if near site/crate and inventory is open
                    if (this.gameState.inventoryOpen) {
                        this.updateConstructionSection();
                        this.updateCrateSection();
                    }

                    // Update button states immediately when blocked
                    const hasAxe = this.hasToolWithDurability('axe');
                    const hasSaw = this.hasToolWithDurability('saw');
                    const isOnCooldown = this.gameState.harvestCooldown && this.gameState.harvestCooldown.endTime > Date.now();
                    ui.updateButtonStates(this.gameState.isInChunk, this.gameState.nearestObject, hasAxe, hasSaw, isOnCooldown, this.gameState.nearestConstructionSite, this.gameState.isMoving, this.gameState.nearestCrate);
                }
            } else {
                // No collision, apply movement
                position.copy(finalNextPosition);

                // Update Y position to follow terrain (prevents clipping through ground)
                if (this.terrainRenderer) {
                    const terrainHeight = this.terrainRenderer.getHeightFast(position.x, position.z);
                    // Smooth lerp to terrain height
                    const targetY = terrainHeight + 0.03;
                    position.y = THREE.MathUtils.lerp(position.y, targetY, 0.2);
                }
            }

            // Rotate player to face movement direction (smooth turn)
            const direction = new THREE.Vector3();
            direction.subVectors(playerTargetPosition, position).normalize();
            if (direction.length() > 0) {
                const targetRotation = Math.atan2(direction.x, direction.z);
                const currentRotation = this.playerObject.rotation.y;

                // Smoothly interpolate rotation (fast but not instant)
                let rotationDiff = targetRotation - currentRotation;
                // Normalize to -PI to PI range
                while (rotationDiff > Math.PI) rotationDiff -= Math.PI * 2;
                while (rotationDiff < -Math.PI) rotationDiff += Math.PI * 2;

                const rotationSpeed = 0.15; // Adjust for faster/slower turning
                this.playerObject.rotation.y += rotationDiff * rotationSpeed;
            }
        }
    }

    updateAIEnemyPosition(deltaTime) {
        if (!this.aiEnemy || !this.terrainRenderer) return;

        // Don't execute AI behavior if dead
        if (this.aiEnemyIsDead) return;

        const position = this.aiEnemy.position;
        const now = Date.now();

        // Check for nearest player once per second
        if (now - this.aiEnemyLastTargetCheckTime >= this.aiEnemyTargetCheckInterval) {
            this.aiEnemyLastTargetCheckTime = now;

            // Find nearest non-AI player (excluding dead players)
            let nearestPlayer = null;
            let nearestDistance = Infinity;

            // Calculate local player distance (needed for AI control handoff)
            const localDist = Math.sqrt(
                Math.pow(this.playerObject.position.x - position.x, 2) +
                Math.pow(this.playerObject.position.z - position.z, 2)
            );

            // Check local player (skip if dead)
            if (!this.isDead) {
                if (localDist < nearestDistance) {
                    nearestDistance = localDist;
                    nearestPlayer = this.playerObject;
                }
            }

            // Check peer avatars (skip if dead)
            this.networkManager.avatars.forEach((avatar, peerId) => {
                if (!avatar.userData.isDead) {
                    const peerDist = Math.sqrt(
                        Math.pow(avatar.position.x - position.x, 2) +
                        Math.pow(avatar.position.z - position.z, 2)
                    );
                    if (peerDist < nearestDistance) {
                        nearestDistance = peerDist;
                        nearestPlayer = avatar;
                    }
                }
            });

            this.aiEnemyTarget = nearestPlayer;

            // Determine who should control the AI based on proximity
            // Build list of all ALIVE players with their distances
            const playerDistances = [];

            // Add local player (only if alive)
            if (!this.isDead) {
                playerDistances.push({
                    clientId: this.gameState.clientId,
                    distance: localDist,
                    isLocal: true
                });
            }

            // Add all peer players (only if alive)
            this.networkManager.avatars.forEach((avatar, peerId) => {
                if (!avatar.userData.isDead) {
                    const peerDist = Math.sqrt(
                        Math.pow(avatar.position.x - position.x, 2) +
                        Math.pow(avatar.position.z - position.z, 2)
                    );
                    playerDistances.push({
                        clientId: peerId,
                        distance: peerDist,
                        isLocal: false
                    });
                }
            });

            // Check if there are any alive players
            if (playerDistances.length === 0) {
                console.warn('No alive players for AI ownership - AI will be inactive');
                this.aiEnemyOwner = null;
                return;
            }

            // Sort by distance, then by clientId for deterministic conflict resolution
            playerDistances.sort((a, b) => {
                if (Math.abs(a.distance - b.distance) < 0.01) {
                    // Distances effectively equal, use clientId for tie-breaking
                    return a.clientId.localeCompare(b.clientId);
                }
                return a.distance - b.distance;
            });

            // Closest player should control the AI
            const newOwner = playerDistances[0].clientId;

            // Check if ownership needs to change
            if (newOwner !== this.aiEnemyOwner) {
                console.log(`AI control handoff: ${this.aiEnemyOwner} -> ${newOwner}`);
                this.aiEnemyOwner = newOwner;

                // Broadcast control handoff to all peers
                this.networkManager.broadcastP2P({
                    type: 'ai_control_handoff',
                    payload: {
                        newOwner: newOwner,
                        position: position.toArray(),
                        timestamp: now
                    }
                });
            }

            this.aiEnemyLastControlCheckTime = now;
        }

        // If no target found, exit combat stance
        if (!this.aiEnemyTarget) {
            this.aiInCombatStance = false;
            return;
        }

        // Only execute AI behavior if this client is the owner
        if (this.aiEnemyOwner !== this.gameState.clientId) {
            return;
        }

        const targetPos = this.aiEnemyTarget.position;

        // Calculate distance to target player (2D distance)
        const dx = targetPos.x - position.x;
        const dz = targetPos.z - position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        // Set combat stance if target within 15 units
        this.aiInCombatStance = distance <= 15;

        // Check if AI is in shooting pause (1 second after firing)
        const isInShootingPause = now < this.aiShootingPauseEndTime;

        // Check if AI should move towards player (within 15 units but stop at 10 for shooting)
        // Don't move during shooting pause
        if (distance <= 15 && distance > 10 && !isInShootingPause) {
            const wasMoving = this.aiEnemyMoving;
            this.aiEnemyMoving = true;

            // Broadcast AI position on movement start or periodically
            if (!wasMoving || this.frameCount % 30 === 0) {
                this.networkManager.broadcastP2P({
                    type: 'ai_enemy_update',
                    payload: {
                        position: position.toArray(),
                        moving: true
                    }
                });
            }

            // Move towards player using same speed calculation as player
            const moveStep = this.playerSpeed * deltaTime;
            const alpha = Math.min(1, moveStep / distance);

            // Calculate next position using lerp (same as player)
            const nextPosition = position.clone();
            nextPosition.x = position.x + dx * alpha;
            nextPosition.z = position.z + dz * alpha;

            // Check for soft collision with other players/AI
            const characterCollision = this.checkCharacterCollision(nextPosition, position, 'localAI');
            const finalNextPosition = characterCollision.hasCollision ? characterCollision.adjustedPosition : nextPosition;

            // Check for structure collision (same as player)
            const collision = this.checkStructureCollision(finalNextPosition);
            if (collision.hasCollision) {
                if (collision.objectHeight) {
                    // Foundation - allow step-up
                    const stepHeight = collision.objectHeight - position.y;
                    const MAX_STEP_HEIGHT = 0.3;

                    if (stepHeight > 0 && stepHeight <= MAX_STEP_HEIGHT) {
                        // Step up onto foundation
                        position.x = finalNextPosition.x;
                        position.z = finalNextPosition.z;
                        const targetY = collision.objectHeight + 0.03;
                        position.y = THREE.MathUtils.lerp(position.y, targetY, 0.2);
                    } else if (stepHeight <= 0) {
                        // Already on foundation or stepping down
                        position.x = finalNextPosition.x;
                        position.z = finalNextPosition.z;
                        const targetY = collision.objectHeight + 0.03;
                        position.y = THREE.MathUtils.lerp(position.y, targetY, 0.2);
                    }
                    // else: step too high, don't move
                }
                // else: construction site blocks movement, don't move
            } else {
                // No collision, move normally
                position.x = finalNextPosition.x;
                position.z = finalNextPosition.z;

                // Update Y based on terrain
                const terrainHeight = this.terrainRenderer.getHeightFast(position.x, position.z);
                const targetY = terrainHeight + 0.03;
                position.y = THREE.MathUtils.lerp(position.y, targetY, 0.2);
            }

            // Rotate to face movement direction
            const direction = new THREE.Vector3(dx, 0, dz).normalize();
            if (direction.length() > 0) {
                const targetRotation = Math.atan2(direction.x, direction.z);
                const currentRotation = this.aiEnemy.rotation.y;

                // Smooth rotation
                let rotationDiff = targetRotation - currentRotation;
                while (rotationDiff > Math.PI) rotationDiff -= Math.PI * 2;
                while (rotationDiff < -Math.PI) rotationDiff += Math.PI * 2;

                const rotationSpeed = 0.15;
                this.aiEnemy.rotation.y += rotationDiff * rotationSpeed;
            }
        } else {
            // Beyond 15 units or within 10 units (shooting range), stop moving
            const wasMoving = this.aiEnemyMoving;
            this.aiEnemyMoving = false;

            // Broadcast stopped state
            if (wasMoving) {
                this.networkManager.broadcastP2P({
                    type: 'ai_enemy_update',
                    payload: {
                        position: position.toArray(),
                        moving: false
                    }
                });
            }

            // Still update Y position based on terrain/foundation when idle
            const collision = this.checkStructureCollision(position);
            if (collision.hasCollision && collision.objectHeight) {
                const targetY = collision.objectHeight + 0.03;
                position.y = THREE.MathUtils.lerp(position.y, targetY, 0.2);
            } else {
                const terrainHeight = this.terrainRenderer.getHeightFast(position.x, position.z);
                const targetY = terrainHeight + 0.03;
                position.y = THREE.MathUtils.lerp(position.y, targetY, 0.2);
            }

            // Rotate to face player when within shooting range
            if (distance <= 10) {
                // Update target rotation once per second
                if (now - this.aiEnemyLastRotationUpdateTime >= this.aiEnemyRotationUpdateInterval) {
                    this.aiEnemyLastRotationUpdateTime = now;

                    const direction = new THREE.Vector3(dx, 0, dz).normalize();
                    if (direction.length() > 0) {
                        this.aiEnemyTargetRotation = Math.atan2(direction.x, direction.z);
                    }
                }

                // Smoothly interpolate to target rotation every frame
                const currentRotation = this.aiEnemy.rotation.y;
                let rotationDiff = this.aiEnemyTargetRotation - currentRotation;
                while (rotationDiff > Math.PI) rotationDiff -= Math.PI * 2;
                while (rotationDiff < -Math.PI) rotationDiff += Math.PI * 2;

                const rotationSpeed = 0.1; // Slower for smoother 1-second interpolation
                this.aiEnemy.rotation.y += rotationDiff * rotationSpeed;
            }

            // Calculate shooting range based on height advantage
            const shootingRange = this.calculateShootingRange(position.y, targetPos.y);

            // Shoot at player every 6 seconds when within shooting range
            if (distance <= shootingRange && now - this.aiEnemyLastShootTime >= this.aiEnemyShootInterval) {
                this.aiEnemyLastShootTime = now;

                // Set shooting pause (1 second freeze)
                this.aiShootingPauseEndTime = now + 1000;

                // Stop AI movement during shooting
                this.aiEnemyMoving = false;

                // Play shoot animation
                if (this.aiEnemyShootAction) {
                    this.aiEnemyShootAction.reset();
                    this.aiEnemyShootAction.play();
                }

                // Play rifle sound
                if (this.audioManager) {
                    this.audioManager.playPositionalSound('rifle', this.aiEnemy);
                }

                // Calculate hit chance based on height advantage
                const hitChance = this.calculateHitChance(position.y, targetPos.y);
                const hitRoll = Math.random();
                const isHit = hitRoll < hitChance;

                console.log(`AI shooting! Range: ${shootingRange.toFixed(1)}, Hit chance: ${(hitChance * 100).toFixed(0)}%, Roll: ${(hitRoll * 100).toFixed(0)}%, Hit: ${isHit}`);

                // Determine if target is local player or peer
                let targetIsLocalPlayer = false;
                let targetPeerId = null;

                if (this.aiEnemyTarget === this.playerObject) {
                    targetIsLocalPlayer = true;
                } else {
                    // Find which peer this avatar belongs to
                    this.networkManager.avatars.forEach((avatar, peerId) => {
                        if (avatar === this.aiEnemyTarget) {
                            targetPeerId = peerId;
                        }
                    });
                }

                // Broadcast AI shoot event to other players
                this.networkManager.broadcastP2P({
                    type: 'ai_enemy_shoot',
                    payload: {
                        position: position.toArray(),
                        targetIsLocalPlayer: targetIsLocalPlayer,
                        targetPeerId: targetPeerId,
                        isHit: isHit
                    }
                });

                // Apply hit if successful
                if (isHit) {
                    if (targetIsLocalPlayer) {
                        this.killEntity(this.playerObject, false, false);
                        console.log('Local player was killed by AI!');
                    }
                    // If target is peer, they will handle their own death from the broadcast
                }
            }
        }
    }

    updatePlayerShooting() {
        // Don't shoot if player is dead
        if (this.isDead) return;

        const now = Date.now();
        const playerPos = this.playerObject.position;

        // Check for nearest enemy (AI) once per second
        if (now - this.playerLastTargetCheckTime >= 1000) {
            this.playerLastTargetCheckTime = now;

            let nearestEnemy = null;
            let nearestDistance = Infinity;

            // Check local AI enemy (skip if dead)
            if (this.aiEnemy && this.aiEnemyController && !this.aiEnemyController.isDead) {
                const localDist = Math.sqrt(
                    Math.pow(this.aiEnemy.position.x - playerPos.x, 2) +
                    Math.pow(this.aiEnemy.position.z - playerPos.z, 2)
                );
                if (localDist < nearestDistance) {
                    nearestDistance = localDist;
                    nearestEnemy = { entity: this.aiEnemy, isLocal: true, distance: localDist };
                }
            }

            // Check peer AI enemies (skip if dead)
            this.networkManager.peers.forEach((peer, peerId) => {
                if (peer.aiEnemy && !peer.aiEnemy.userData.isDead) {
                    const peerDist = Math.sqrt(
                        Math.pow(peer.aiEnemy.position.x - playerPos.x, 2) +
                        Math.pow(peer.aiEnemy.position.z - playerPos.z, 2)
                    );
                    if (peerDist < nearestDistance) {
                        nearestDistance = peerDist;
                        nearestEnemy = { entity: peer.aiEnemy, isLocal: false, peerId: peerId, distance: peerDist };
                    }
                }
            });

            this.playerShootTarget = nearestEnemy;
        }

        // If no target found, exit combat stance
        if (!this.playerShootTarget) {
            this.playerInCombatStance = false;
            return;
        }

        const targetPos = this.playerShootTarget.entity.position;
        const dx = targetPos.x - playerPos.x;
        const dz = targetPos.z - playerPos.z;
        const distance = this.playerShootTarget.distance;

        // Set combat stance if enemy within 15 units
        this.playerInCombatStance = distance <= 15;

        // Calculate shooting range based on height advantage
        const shootingRange = this.calculateShootingRange(playerPos.y, targetPos.y);

        // Shoot at enemy every 6 seconds when within shooting range
        if (distance <= shootingRange && now - this.playerLastShootTime >= this.playerShootInterval) {
            this.playerLastShootTime = now;

            // Set shooting pause (1 second freeze)
            this.playerShootingPauseEndTime = now + 1000;

            // Stop player movement during shooting
            this.gameState.isMoving = false;

            // Play shoot animation
            if (this.shootAction) {
                this.shootAction.reset();
                this.shootAction.play();
            }

            // Play rifle sound
            if (this.audioManager) {
                this.audioManager.playPositionalSound('rifle', this.playerObject);
            }

            // Calculate hit chance based on height advantage
            const hitChance = this.calculateHitChance(playerPos.y, targetPos.y);
            const hitRoll = Math.random();
            const isHit = hitRoll < hitChance;

            console.log(`Player shooting! Range: ${shootingRange.toFixed(1)}, Hit chance: ${(hitChance * 100).toFixed(0)}%, Roll: ${(hitRoll * 100).toFixed(0)}%, Hit: ${isHit}`);

            // Broadcast player shoot event to other players
            this.networkManager.broadcastP2P({
                type: 'player_shoot',
                payload: {
                    position: playerPos.toArray(),
                    targetIsLocalAI: this.playerShootTarget.isLocal,
                    targetPeerId: this.playerShootTarget.peerId,
                    isHit: isHit
                }
            });

            // Apply hit if successful
            if (isHit) {
                if (this.playerShootTarget.isLocal) {
                    if (this.aiEnemyController) {
                        this.aiEnemyController.kill();
                    }
                    console.log('Local AI was killed by player!');
                }
                // If target is peer's AI, they will handle the death from the broadcast
            }
        }
    }

    updateAvatarMovement(deltaTime) {
        this.networkManager.avatars.forEach((avatar, peerId) => {
            const peer = this.networkManager.peers.get(peerId);
            if (peer?.targetPosition) {
                // Store last position before moving
                avatar.userData.lastPosition.copy(avatar.position);

                const distance = avatar.position.distanceTo(peer.targetPosition);
                if (distance <= this.stopThreshold) {
                    avatar.position.copy(peer.targetPosition);
                    peer.targetPosition = null;
                    avatar.userData.isMoving = false;
                } else {
                    const moveStep = this.playerSpeed * deltaTime;
                    const alpha = Math.min(1, moveStep / distance);
                    avatar.position.lerp(peer.targetPosition, alpha);
                    avatar.userData.isMoving = true;

                    // Calculate rotation from movement direction
                    const direction = new THREE.Vector3();
                    direction.subVectors(peer.targetPosition, avatar.position).normalize();
                    if (direction.length() > 0) {
                        const targetRotation = Math.atan2(direction.x, direction.z);
                        const currentRotation = avatar.rotation.y;

                        // Smoothly interpolate rotation
                        let rotationDiff = targetRotation - currentRotation;
                        // Normalize to -PI to PI range
                        while (rotationDiff > Math.PI) rotationDiff -= Math.PI * 2;
                        while (rotationDiff < -Math.PI) rotationDiff += Math.PI * 2;

                        const rotationSpeed = 0.15;
                        avatar.rotation.y += rotationDiff * rotationSpeed;
                    }
                }

                // Update Y position to follow terrain or foundations
                if (this.terrainRenderer) {
                    // Check if avatar is on/near a foundation
                    const collision = this.checkStructureCollision(avatar.position);

                    if (collision.hasCollision && collision.objectHeight) {
                        // Avatar should be on foundation - smooth lerp
                        const targetY = collision.objectHeight + 0.03;
                        avatar.position.y = THREE.MathUtils.lerp(avatar.position.y, targetY, 0.2);
                    } else {
                        // Avatar on terrain - smooth lerp
                        const terrainHeight = this.terrainRenderer.getHeightFast(avatar.position.x, avatar.position.z);
                        const targetY = terrainHeight + 0.03;
                        avatar.position.y = THREE.MathUtils.lerp(avatar.position.y, targetY, 0.2);
                    }
                }
            }

            // Check if peer is harvesting and update harvest animation
            if (peer?.harvestState) {
                const now = Date.now();
                if (now >= peer.harvestState.endTime) {
                    // Harvest complete, stop chopping animation
                    if (peer.choppingAction) {
                        peer.choppingAction.stop();
                    }
                    peer.harvestState = null;
                    console.log(`Peer ${peerId} finished harvesting`);
                }
            }

            // Update animation mixer
            if (avatar.userData.mixer) {
                if (avatar.userData.isMoving) {
                    // Play walk animation when moving (2.5x speed like main player)
                    avatar.userData.mixer.update((deltaTime / 1000) * 2.5);
                } else {
                    // Idle: freeze on first frame
                    avatar.userData.mixer.setTime(0);
                }
            }
        });
    }

    updatePeerAIEnemies(deltaTime) {
        this.networkManager.peers.forEach((peer, peerId) => {
            if (peer.aiEnemy && peer.aiEnemyTargetPosition) {
                const aiEnemy = peer.aiEnemy;
                const distance = aiEnemy.position.distanceTo(peer.aiEnemyTargetPosition);

                // Use same movement threshold as player
                if (distance <= this.stopThreshold) {
                    aiEnemy.position.copy(peer.aiEnemyTargetPosition);
                } else {
                    // Smooth interpolation using same speed as player
                    const moveStep = this.playerSpeed * deltaTime;
                    const alpha = Math.min(1, moveStep / distance);
                    aiEnemy.position.lerp(peer.aiEnemyTargetPosition, alpha);

                    // Calculate rotation from movement direction if moving
                    if (peer.aiEnemyMoving) {
                        const direction = new THREE.Vector3();
                        direction.subVectors(peer.aiEnemyTargetPosition, aiEnemy.position).normalize();
                        if (direction.length() > 0) {
                            const targetRotation = Math.atan2(direction.x, direction.z);
                            const currentRotation = aiEnemy.rotation.y;

                            // Smoothly interpolate rotation
                            let rotationDiff = targetRotation - currentRotation;
                            while (rotationDiff > Math.PI) rotationDiff -= Math.PI * 2;
                            while (rotationDiff < -Math.PI) rotationDiff += Math.PI * 2;

                            const rotationSpeed = 0.15;
                            aiEnemy.rotation.y += rotationDiff * rotationSpeed;
                        }
                    }
                }

                // Update Y position to follow terrain or foundations
                if (this.terrainRenderer) {
                    const collision = this.checkStructureCollision(aiEnemy.position);

                    if (collision.hasCollision && collision.objectHeight) {
                        const targetY = collision.objectHeight + 0.03;
                        aiEnemy.position.y = THREE.MathUtils.lerp(aiEnemy.position.y, targetY, 0.2);
                    } else {
                        const terrainHeight = this.terrainRenderer.getHeightFast(aiEnemy.position.x, aiEnemy.position.z);
                        const targetY = terrainHeight + 0.03;
                        aiEnemy.position.y = THREE.MathUtils.lerp(aiEnemy.position.y, targetY, 0.2);
                    }
                }
            }
        });
    }

    updateCameraAndLighting() {
        // Update camera to follow player with zoom
        const baseCameraOffset = new THREE.Vector3(0, 12, 8);
        const zoomedOffset = baseCameraOffset.multiplyScalar(this.gameState.cameraZoom);
        this.gameState.cameraTargetPosition.copy(this.playerObject.position).add(zoomedOffset);
        this.camera.position.lerp(this.gameState.cameraTargetPosition, 0.8);
        this.camera.lookAt(this.playerObject.position);
    }

    runPeriodicChecks(now) {
        if (now - this.gameState.lastChunkUpdateTime > this.chunkUpdateInterval) {
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

        

        if (now - this.gameState.lastPeerCheckTime > this.peerCheckInterval) {
            this.checkAndReconnectPeers();
            this.gameState.lastPeerCheckTime = now;
        }
    }

    // Check if player has required tool in inventory
    hasRequiredTool(objectType) {
        // Check if it's a log type (ends with _log or is just "log")
        const isLog = objectType.endsWith('_log') || objectType === 'log';

        // Define tool requirements for each object type
        const toolRequirements = {
            // Trees require axe
            'oak': 'axe',
            'fir': 'axe',
            'pine': 'axe',
            'cypress': 'axe',
            // Rocks require pickaxe
            'limestone': 'pickaxe',
            'sandstone': 'pickaxe',
            // Structures require hammer
            'construction': 'hammer',
            'foundation': 'hammer',
            'foundationcorner': 'hammer',
            'foundationroundcorner': 'hammer'
        };

        // All logs require saw (for proximity display, but buttons will check separately)
        let requiredTool = toolRequirements[objectType];
        if (!requiredTool && isLog) {
            requiredTool = 'saw';
        }

        if (!requiredTool) {
            // No tool required for this object type
            return { hasRequiredTool: true, requiredTool: null, reason: null };
        }

        // Check inventory for the required tool with durability > 0
        const tool = this.gameState.inventory.items.find(item =>
            item.type === requiredTool && item.durability > 0
        );

        if (tool) {
            return { hasRequiredTool: true, requiredTool, reason: null };
        } else {
            // Check if they have the tool but it's broken
            const brokenTool = this.gameState.inventory.items.find(item => item.type === requiredTool);
            if (brokenTool) {
                return {
                    hasRequiredTool: false,
                    requiredTool,
                    reason: `${requiredTool} is broken (0 durability)`
                };
            } else {
                return {
                    hasRequiredTool: false,
                    requiredTool: null,
                    reason: `Requires ${requiredTool}`
                };
            }
        }
    }

    hasToolWithDurability(toolType) {
        // Check if player has the specified tool with durability > 0
        const tool = this.gameState.inventory.items.find(item =>
            item.type === toolType && item.durability > 0
        );
        return !!tool; // Return true if tool exists, false otherwise
    }

    getFoundationBounds(foundationObject) {
        const box = new THREE.Box3().setFromObject(foundationObject);
        const size = new THREE.Vector3();
        box.getSize(size);

        return {
            width: size.x,
            height: size.y,
            depth: size.z,
            topY: foundationObject.position.y + (size.y / 2),
            bottomY: foundationObject.position.y - (size.y / 2)
        };
    }

    calculateHitChance(shooterY, targetY) {
        // Base hit chance is 20%
        const BASE_HIT_CHANCE = 0.2;
        const MAX_HIT_CHANCE = 0.8;

        // Height advantage (positive if shooter is above target)
        const heightAdvantage = shooterY - targetY;

        // Each unit of height advantage adds 20% to hit chance
        const bonusChance = heightAdvantage * 0.2;

        // Calculate final hit chance (capped at 80%)
        const hitChance = Math.min(MAX_HIT_CHANCE, Math.max(0, BASE_HIT_CHANCE + bonusChance));

        return hitChance;
    }

    calculateShootingRange(shooterY, targetY) {
        // Base shooting range is 10 units
        const BASE_RANGE = 10;
        const MAX_RANGE = 15;

        // Height advantage (positive if shooter is above target)
        const heightAdvantage = shooterY - targetY;

        // Range increases by half of height advantage
        const bonusRange = heightAdvantage * 0.5;

        // Calculate final range (capped at 15)
        const shootingRange = Math.min(MAX_RANGE, Math.max(BASE_RANGE, BASE_RANGE + bonusRange));

        return shootingRange;
    }

    killEntity(entity, isAI = false, isPeer = false) {
        // Random fall direction: -1 for left, 1 for right
        const fallDirection = Math.random() < 0.5 ? -1 : 1;

        // Mark entity as dead
        if (isAI) {
            if (isPeer) {
                entity.userData.isDead = true;
                entity.userData.deathStartTime = Date.now();
                entity.userData.deathRotationProgress = 0;
                entity.userData.fallDirection = fallDirection;
            } else {
                this.aiEnemyIsDead = true;
                this.aiEnemyDeathStartTime = Date.now();
                this.aiEnemyDeathRotationProgress = 0;
                this.aiEnemyFallDirection = fallDirection;

                // Check if this AI belongs to a tent and mark tent as "dead AI" (no respawn)
                for (const [tentId, aiData] of this.tentAIEnemies.entries()) {
                    if (aiData.controller.enemy === entity) {
                        aiData.isDead = true;
                        this.deadTentAIs.add(tentId);
                        console.log(`AI for tent ${tentId} died - will not respawn`);
                        break;
                    }
                }
            }
        } else {
            if (isPeer) {
                entity.userData.isDead = true;
                entity.userData.deathStartTime = Date.now();
                entity.userData.deathRotationProgress = 0;
                entity.userData.fallDirection = fallDirection;
            } else {
                this.isDead = true;
                this.deathStartTime = Date.now();
                this.deathRotationProgress = 0;
                this.fallDirection = fallDirection;
                this.gameState.isMoving = false;
            }
        }

        // Stop any ongoing animations and set to idle
        let mixer = null;
        if (isPeer) {
            mixer = entity.userData.mixer;
        } else if (isAI && !isPeer) {
            mixer = this.aiEnemyAnimationMixer;
        } else if (!isAI && !isPeer) {
            mixer = this.animationMixer;
        }

        if (mixer) {
            mixer.stopAllAction();
        }

        console.log(`Entity killed! isAI: ${isAI}, isPeer: ${isPeer}`);

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
                console.log('Broadcasted local AI death to peers');
            } else {
                // Local player died - broadcast to all peers
                this.networkManager.broadcastP2P({
                    type: 'player_death',
                    payload: {
                        position: this.playerObject.position.toArray()
                    }
                });
                console.log('Broadcasted local player death to peers');
            }
        }
    }

    updateDeathAnimation(entity, deathStartTime, deltaTime, fallDirection = 1, isLocal = false) {
        const DEATH_DURATION = 500; // 0.5 seconds
        const elapsed = Date.now() - deathStartTime;

        if (elapsed < DEATH_DURATION) {
            // Calculate rotation progress (0 to 1)
            const progress = elapsed / DEATH_DURATION;

            // Rotate 90 degrees (PI/2 radians) around Z axis (fall to side)
            // fallDirection: -1 for left, 1 for right
            // Only rotate the child mesh, not the parent group
            if (entity.children[0]) {
                entity.children[0].rotation.z = (Math.PI / 2) * progress * fallDirection;
            }

            return false; // Still animating
        } else {
            // Death animation complete
            if (entity.children[0]) {
                entity.children[0].rotation.z = (Math.PI / 2) * fallDirection;
            }
            return true; // Animation complete
        }
    }

    checkStructureCollision(position) {
        // Check collision with construction sites and foundations
        const { chunkSize } = TERRAIN_CONFIG.TERRAIN;
        const playerChunkX = Math.floor(position.x / chunkSize);
        const playerChunkZ = Math.floor(position.z / chunkSize);

        // Check 3x3 grid around player
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const chunkKey = `${playerChunkX + dx},${playerChunkZ + dz}`;
                const objects = this.terrainRenderer.chunkTrees.get(chunkKey);

                if (objects) {
                    for (const obj of objects) {
                        // Check if it's a construction site or foundation
                        const isConstructionSite = obj.userData.isConstructionSite || obj.userData.modelType === 'construction';
                        const isFoundation = obj.userData.modelType === 'foundation' ||
                                           obj.userData.modelType === 'foundationcorner' ||
                                           obj.userData.modelType === 'foundationroundcorner';

                        if (isConstructionSite) {
                            // Construction sites block movement
                            const dx = position.x - obj.position.x;
                            const dz = position.z - obj.position.z;
                            const distance = Math.sqrt(dx * dx + dz * dz);

                            if (distance < 0.6) {
                                return { hasCollision: true };
                            }
                        } else if (isFoundation) {
                            // Foundations allow step-up
                            const bounds = this.getFoundationBounds(obj);
                            const dx = position.x - obj.position.x;
                            const dz = position.z - obj.position.z;
                            const distance = Math.sqrt(dx * dx + dz * dz);
                            const collisionRadius = Math.max(bounds.width, bounds.depth) / 2;

                            if (distance < collisionRadius) {
                                return {
                                    hasCollision: true,
                                    objectHeight: bounds.topY,
                                    object: obj,
                                    bounds: bounds
                                };
                            }
                        }
                    }
                }
            }
        }

        return { hasCollision: false };
    }

    checkCharacterCollision(nextPosition, currentPosition, excludeSelf = null) {
        // Check collision with other players and AI (soft bubble collision)
        const BUBBLE_RADIUS = 0.5; // Personal space radius
        const collisions = [];

        // Check collision with local AI enemy (unless it's the AI itself moving)
        if (this.aiEnemy && excludeSelf !== 'localAI') {
            const dx = nextPosition.x - this.aiEnemy.position.x;
            const dz = nextPosition.z - this.aiEnemy.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance < BUBBLE_RADIUS) {
                collisions.push({
                    position: this.aiEnemy.position,
                    distance: distance,
                    type: 'ai'
                });
            }
        }

        // Check collision with local player (unless it's the player itself moving)
        if (this.playerObject && excludeSelf !== 'localPlayer') {
            const dx = nextPosition.x - this.playerObject.position.x;
            const dz = nextPosition.z - this.playerObject.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance < BUBBLE_RADIUS) {
                collisions.push({
                    position: this.playerObject.position,
                    distance: distance,
                    type: 'localPlayer'
                });
            }
        }

        // Check collision with peer avatars
        this.networkManager.avatars.forEach((avatar, peerId) => {
            const dx = nextPosition.x - avatar.position.x;
            const dz = nextPosition.z - avatar.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance < BUBBLE_RADIUS) {
                collisions.push({
                    position: avatar.position,
                    distance: distance,
                    type: 'player'
                });
            }
        });

        // Check collision with peer AI enemies
        this.networkManager.peers.forEach((peer, peerId) => {
            if (peer.aiEnemy) {
                const dx = nextPosition.x - peer.aiEnemy.position.x;
                const dz = nextPosition.z - peer.aiEnemy.position.z;
                const distance = Math.sqrt(dx * dx + dz * dz);

                if (distance < BUBBLE_RADIUS) {
                    collisions.push({
                        position: peer.aiEnemy.position,
                        distance: distance,
                        type: 'peer_ai'
                    });
                }
            }
        });

        if (collisions.length === 0) {
            return { hasCollision: false };
        }

        // Apply soft collision response - push away from all colliding entities
        const pushDirection = new THREE.Vector3(0, 0, 0);

        for (const collision of collisions) {
            const dx = nextPosition.x - collision.position.x;
            const dz = nextPosition.z - collision.position.z;
            const distance = collision.distance;

            if (distance < 0.01) {
                // Entities are at nearly identical position - push in a deterministic direction
                pushDirection.x += 1.0;
                pushDirection.z += 0.5;
            } else {
                // Normalize and add to push direction
                const pushStrength = (BUBBLE_RADIUS - distance) / BUBBLE_RADIUS;
                pushDirection.x += (dx / distance) * pushStrength;
                pushDirection.z += (dz / distance) * pushStrength;
            }
        }

        // Average the push direction
        if (collisions.length > 0) {
            pushDirection.x /= collisions.length;
            pushDirection.z /= collisions.length;
        }

        // Apply the push to create adjusted position
        const adjustedPosition = nextPosition.clone();
        const pushStrength = 0.8; // Moderate push to keep entities separated
        adjustedPosition.x += pushDirection.x * pushStrength;
        adjustedPosition.z += pushDirection.z * pushStrength;

        return {
            hasCollision: true,
            adjustedPosition: adjustedPosition
        };
    }

    getGroundHeightAt(x, z) {
        const testPosition = new THREE.Vector3(x, 0, z);
        const collision = this.checkStructureCollision(testPosition);

        if (collision.hasCollision && collision.objectHeight) {
            return collision.objectHeight;
        }

        return this.terrainRenderer.getHeightFast(x, z);
    }

    checkProximityToObjects() {
        const { chunkSize } = TERRAIN_CONFIG.TERRAIN;
        const playerChunkX = Math.floor(this.playerObject.position.x / chunkSize);
        const playerChunkZ = Math.floor(this.playerObject.position.z / chunkSize);
        let closestObject = null;
        let closestDistance = Infinity;

        // Check a 3x3 grid of chunks around the player
        for (let x = playerChunkX - 1; x <= playerChunkX + 1; x++) {
            for (let z = playerChunkZ - 1; z <= playerChunkZ + 1; z++) {
                const chunkKey = `${x},${z}`;
                const objectsInChunk = this.terrainRenderer.chunkTrees.get(chunkKey) || [];

                for (const object of objectsInChunk) {
                    if (object.visible) {
                        // Calculate horizontal distance only (ignore Y-axis)
                        const dx = this.playerObject.position.x - object.position.x;
                        const dz = this.playerObject.position.z - object.position.z;
                        const distance = Math.sqrt(dx * dx + dz * dz);

                        // Structures (construction sites and foundations) need larger radius
                        const isStructure = object.userData.isConstructionSite ||
                                          object.userData.modelType === 'construction' ||
                                          object.userData.modelType === 'foundation' ||
                                          object.userData.modelType === 'foundationcorner' ||
                                          object.userData.modelType === 'foundationroundcorner';
                        const maxDistance = isStructure ? 1.2 : 0.6;

                        if (distance < closestDistance && distance <= maxDistance) {
                            closestDistance = distance;
                            closestObject = object;
                        }
                    }
                }
            }
        }

        if (closestObject) { // Already filtered by radius above
            this.gameState.nearestObject = {
                id: closestObject.userData.objectId,
                name: closestObject.userData.modelType,
                position: closestObject.position.clone(),
                chunkKey: closestObject.userData.chunkKey,
                quality: closestObject.userData.quality,
                scale: closestObject.userData.originalScale,
                remainingResources: closestObject.userData.remainingResources,
                totalResources: closestObject.userData.totalResources
            };
            this.gameState.nearestObjectDistance = closestDistance;

            // Check if player has required tool
            const toolCheck = this.hasRequiredTool(this.gameState.nearestObject.name);
            this.gameState.nearestObject.toolCheck = toolCheck;
        } else {
            this.gameState.nearestObject = null;
            this.gameState.nearestObjectDistance = Infinity;
        }

        // Check for nearest construction site and crate
        let closestConstructionSite = null;
        let closestConstructionDistance = Infinity;
        let closestCrate = null;
        let closestCrateDistance = Infinity;

        for (let x = playerChunkX - 1; x <= playerChunkX + 1; x++) {
            for (let z = playerChunkZ - 1; z <= playerChunkZ + 1; z++) {
                const chunkKey = `${x},${z}`;
                const objectsInChunk = this.terrainRenderer.chunkTrees.get(chunkKey) || [];

                for (const object of objectsInChunk) {
                    if (!object.visible) continue;

                    // Calculate horizontal distance only (ignore Y-axis)
                    const dx = this.playerObject.position.x - object.position.x;
                    const dz = this.playerObject.position.z - object.position.z;
                    const distance = Math.sqrt(dx * dx + dz * dz);

                    if (object.userData.isConstructionSite) {
                        if (distance < closestConstructionDistance) {
                            closestConstructionDistance = distance;
                            closestConstructionSite = object;
                        }
                    } else if (object.userData.modelType === 'crate' || object.userData.modelType === 'tent') {
                        if (distance < closestCrateDistance) {
                            closestCrateDistance = distance;
                            closestCrate = object;
                        }
                    }
                }
            }
        }

        // Determine which is closest (construction site or crate) - closest wins
        const proximityThreshold = 1.2;
        if (closestConstructionSite && closestConstructionDistance <= proximityThreshold &&
            closestConstructionDistance <= closestCrateDistance) {
            // Construction site is closer (or equal)
            this.gameState.nearestConstructionSite = closestConstructionSite;
            this.gameState.nearestConstructionSiteDistance = closestConstructionDistance;
            this.gameState.nearestCrate = null;
            this.gameState.nearestCrateDistance = Infinity;
        } else if (closestCrate && closestCrateDistance <= proximityThreshold &&
                   closestCrateDistance < closestConstructionDistance) {
            // Crate is closer
            this.gameState.nearestCrate = closestCrate;
            this.gameState.nearestCrateDistance = closestCrateDistance;
            this.gameState.nearestConstructionSite = null;
            this.gameState.nearestConstructionSiteDistance = Infinity;
        } else {
            // Neither is close enough
            this.gameState.nearestConstructionSite = null;
            this.gameState.nearestConstructionSiteDistance = Infinity;
            this.gameState.nearestCrate = null;
            this.gameState.nearestCrateDistance = Infinity;
        }

        // Check if player has axe and saw
        const hasAxe = this.hasToolWithDurability('axe');
        const hasSaw = this.hasToolWithDurability('saw');

        // Check if cooldown is active
        const isOnCooldown = this.gameState.harvestCooldown && this.gameState.harvestCooldown.endTime > Date.now();

        ui.updateNearestObject(
            this.gameState.nearestObject ? this.gameState.nearestObject.name : null,
            this.gameState.nearestObject ? this.gameState.nearestObject.toolCheck : null,
            this.gameState.nearestObject ? this.gameState.nearestObject.quality : null,
            this.gameState.nearestObject ? this.gameState.nearestObject.remainingResources : null,
            this.gameState.nearestObject ? this.gameState.nearestObject.totalResources : null
        );
        ui.updateButtonStates(this.gameState.isInChunk, this.gameState.nearestObject, hasAxe, hasSaw, isOnCooldown, this.gameState.nearestConstructionSite, this.gameState.isMoving, this.gameState.nearestCrate);
    }

    checkAndReconnectPeers() {
        this.networkManager.peers.forEach((peer, peerId) => {
            if (peer.state === 'disconnected' || peer.state === 'failed') {
                if (this.gameState.clientId < peerId) { // Initiation rule
                    ui.updateStatus(`Attempting P2P reconnect to ${peerId}...`);
                    this.initiateP2PConnection(peerId);
                }
            }
        });
    }
}

// ==========================================
// INITIALIZATION
// ==========================================

// Wait for models to load before starting game
modelManager.loadAllModels().then(() => {
    console.log('Models loaded, starting game...');
    const game = new MultiplayerGame();
    game.start();
}).catch(error => {
    console.error('Failed to load models:', error);
    alert('Failed to load game models. Please refresh the page.');
});
import { ui } from '../ui.js';
import { CONFIG } from '../config.js';
import { WebSocketTransport } from './WebSocketTransport.js';
import { MessageQueue } from './MessageQueue.js';
import { P2PTransport } from './P2PTransport.js';
import { GameStateManager } from './GameStateManager.js';
import { ChunkCoordinates } from '../core/ChunkCoordinates.js';

/**
 * NetworkManager
 *
 * Manages all networking for the game including:
 * - WebSocket connection to server
 * - WebRTC peer-to-peer connections
 * - Message queuing and routing
 * - Game state synchronization
 */
export class NetworkManager {
    constructor(gameState, onMessageCallback) {
        this.gameState = gameState;
        this.onMessageCallback = onMessageCallback;

        // Use WebSocketTransport instead of direct WebSocket
        this.transport = new WebSocketTransport();

        // Use MessageQueue to buffer incoming messages
        this.messageQueue = new MessageQueue();

        // Use P2PTransport for WebRTC connections
        this.p2pTransport = new P2PTransport();

        // Use GameStateManager for game state synchronization
        this.gameStateManager = new GameStateManager();

        this.setupTransportHandlers();
        this.setupP2PHandlers();

        // P2P game-specific state (avatars, AI, movement, etc.)
        this.peerGameData = new Map(); // Game-specific data per peer (targetPosition, animations, etc.)
        this.avatars = new Map();
        this.playerObject = null; // Set later by setPlayerObject()
        this.audioManager = null; // Set later by setAudioManager()
        this.aiEnemy = null; // Set later by setAIEnemy()
        this.game = null; // Set later by setGame()
        this.scene = null; // Set later by setScene()

        // Connect GameStateManager to data
        this.gameStateManager.setAvatars(this.avatars);
        this.gameStateManager.setPeerGameData(this.peerGameData);
    }

    setPlayerObject(playerObject) {
        this.playerObject = playerObject;
    }

    setAudioManager(audioManager) {
        this.audioManager = audioManager;
        this.gameStateManager.setAudioManager(audioManager);
    }

    setAIEnemy(aiEnemy) {
        this.aiEnemy = aiEnemy;
    }

    setGame(game) {
        this.game = game;
        this.gameStateManager.setGame(game);
    }

    setScene(scene) {
        this.scene = scene;
    }

    /**
     * Subscribe to game state events
     * @param {string} event - Event name
     * @param {function} callback - Event handler
     */
    on(event, callback) {
        this.gameStateManager.on(event, callback);
    }

    /**
     * Unsubscribe from game state events
     * @param {string} event - Event name
     * @param {function} callback - Event handler
     */
    off(event, callback) {
        this.gameStateManager.off(event, callback);
    }

    setupTransportHandlers() {
        // Register callback for when transport connects
        this.transport.onConnect(() => {
            ui.updateStatus("✅ Connected to server");
            // Clear the connecting status (don't show persistent connected message)
            ui.updateConnectionStatus('connected', '');
            this.onMessageCallback('server_connected', {});
        });

        // Register callback for when transport disconnects
        this.transport.onDisconnect((event) => {
            ui.updateStatus(`❌ Server disconnected (${event.code})`);
            ui.updateConnectionStatus('disconnected', '❌ Server Disconnected');
            this.gameState.isInChunk = false;
            // Hide all action buttons on disconnect
            ui.updateButtonStates(
                false,  // isInChunk
                null,   // nearestObject
                false,  // hasAxe
                false,  // hasSaw
                false,  // isOnCooldown
                null,   // nearestConstructionSite
                false,  // isMoving
                null,   // nearestStructure
                false,  // hasHammer
                false,  // nearWater
                false,  // hasFishingNet
                false,  // onGrass
                false,  // mushroomAvailable
                false,  // vegetableSeedsAvailable
                false,  // seedsAvailable
                null,   // seedTreeType
                false,  // isClimbing
                null,   // occupiedOutposts
                false,  // vegetablesGatherAvailable
                null    // activeAction
            );
        });

        // Register callback for when transport has errors
        this.transport.onError((error) => {
            ui.updateStatus(`❌ Server error: ${error.message || 'Unknown error'}`);
            ui.updateConnectionStatus('disconnected', '❌ Server Error');
        });

        // Register callback for reconnection attempts
        this.transport.onReconnectAttempt((attempt, max) => {
            ui.updateStatus(`🔄 Reconnecting to server (${attempt}/${max})...`);
            ui.updateConnectionStatus('reconnecting', `Reconnecting ${attempt}/${max}...`);
        });

        // Register callback for when all reconnection attempts have failed
        this.transport.onReconnectFailed((attempt, max) => {
            ui.updateStatus(`❌ Failed to reconnect after ${max} attempts`);
            ui.updateConnectionStatus('failed', 'Connection Failed - Click to Retry');
        });

        // Register callback for incoming messages - QUEUE them instead of processing immediately
        this.transport.onMessage((data) => {
            ui.updateStatus(`📥 Server: ${data.type}`);
            this.messageQueue.enqueue(data, 'server');
        });
    }

    /**
     * Manually trigger server reconnection
     * Used by UI when user clicks reconnect button
     */
    manualReconnect() {
        if (this.transport && this.transport.manualReconnect) {
            ui.updateStatus('🔄 Manual reconnection requested...');
            ui.updateConnectionStatus('reconnecting', 'Reconnecting...');
            this.transport.manualReconnect();
        }
    }

    /**
     * Check if connected to server
     * @returns {boolean}
     */
    isServerConnected() {
        return this.transport && this.transport.isConnected();
    }

    setupP2PHandlers() {
        // Handle ICE candidates - forward to server for signaling
        this.p2pTransport.onIceCandidate((peerId, candidate) => {
            this.sendMessage('webrtc_ice_candidate', {
                recipientId: peerId,
                senderId: this.gameState.clientId,
                candidate
            });
        });

        // Handle connection state changes - update UI
        this.p2pTransport.onConnectionStateChange((peerId, state) => {
            ui.updateStatus(`P2P ${peerId}: ${state}`);
            ui.updatePeerInfo(this.p2pTransport.peers, this.avatars);
        });

        // Handle data channel open - send initial sync
        this.p2pTransport.onDataChannelOpen((peerId) => {
            ui.updateStatus(`P2P data channel opened with ${peerId}`);
            ui.updatePeerInfo(this.p2pTransport.peers, this.avatars);

            // Initialize game-specific data for this peer
            if (!this.peerGameData.has(peerId)) {
                this.peerGameData.set(peerId, {
                    accountId: null,         // Persistent account ID for reconnection detection
                    targetPosition: null,    // THREE.Vector3 - where peer is heading
                    targetRotation: 0,       // Target Y rotation
                    lastUpdateTime: 0,       // When last position update received
                    username: null,          // Peer's display name
                    factionId: null,         // Peer's faction (1=Southguard, 3=Northmen, null=Neutral)
                    harvestState: null,
                    animationMixer: null,
                    choppingAction: null,
                    aiEnemy: null,
                    aiEnemyMoving: false,
                    aiEnemyTargetPosition: null,
                    onDock: false,
                    targetY: undefined,
                    isClimbing: false,
                    climbingTargetPosition: null,
                });
            }

            // Send initial state to newly connected peer (mutual sync)
            if (this.playerObject) {
                const message = {
                    type: 'player_pos',
                    t: Date.now(),
                    p: this.playerObject.position.toArray(),
                    r: this.playerObject.rotation.y
                };
                this.p2pTransport.sendToPeer(peerId, message);

                // Send auth info for reconnection detection
                this.p2pTransport.sendToPeer(peerId, {
                    type: 'auth_info',
                    accountId: this.gameState.accountId,
                    username: this.gameState.username,
                    clientId: this.gameState.clientId
                });

                // Send AI enemy initial position (if alive) - legacy
                // Skip if BanditController is in use (sends via bandit_sync instead)
                if (this.aiEnemy && !this.gameState.aiEnemyIsDead && !this.game?.banditController) {
                    const aiMessage = {
                        type: 'ai_enemy_update',
                        payload: {
                            position: this.aiEnemy.position.toArray(),
                            moving: this.gameState.aiEnemyMoving || false
                        }
                    };
                    this.p2pTransport.sendToPeer(peerId, aiMessage);
                }

                // Send active bandits to newly connected peer
                if (this.game?.banditController) {
                    const bandits = this.game.banditController.getActiveBanditsForSync();
                    if (bandits.length > 0) {
                        const banditSyncMessage = {
                            type: 'bandit_sync',
                            bandits: bandits
                        };
                        this.p2pTransport.sendToPeer(peerId, banditSyncMessage);
                    }
                }

                // Send active deer to newly connected peer
                if (this.game?.deerController) {
                    const deer = this.game.deerController.getActiveDeerForSync();
                    if (deer.length > 0) {
                        const deerSyncMessage = {
                            type: 'deer_sync',
                            deer: deer
                        };
                        this.p2pTransport.sendToPeer(peerId, deerSyncMessage);
                    }
                }

                // Send active bakers to newly connected peer
                if (this.game?.bakerController) {
                    const bakers = this.game.bakerController.getActiveBakersForSync();
                    if (bakers.length > 0) {
                        const bakerSyncMessage = {
                            type: 'baker_sync',
                            bakers: bakers
                        };
                        this.p2pTransport.sendToPeer(peerId, bakerSyncMessage);
                    }
                }

                // Send active gardeners to newly connected peer
                if (this.game?.gardenerController) {
                    const gardeners = this.game.gardenerController.getActiveGardenersForSync();
                    if (gardeners.length > 0) {
                        const gardenerSyncMessage = {
                            type: 'gardener_sync',
                            gardeners: gardeners
                        };
                        this.p2pTransport.sendToPeer(peerId, gardenerSyncMessage);
                    }
                }

                // Send active brown bears to newly connected peer
                if (this.game?.brownBearController) {
                    const bears = this.game.brownBearController.getActiveBrownBearsForSync();
                    if (bears.length > 0) {
                        const bearSyncMessage = {
                            type: 'brownbear_sync',
                            bears: bears
                        };
                        this.p2pTransport.sendToPeer(peerId, bearSyncMessage);
                    }
                }

            }
        });

        // Handle data channel close
        this.p2pTransport.onDataChannelClose((peerId) => {
            ui.updateStatus(`P2P data channel closed with ${peerId}`);
            ui.updatePeerInfo(this.p2pTransport.peers, this.avatars);
        });

        // Handle incoming P2P messages
        this.p2pTransport.onMessage((peerId, message) => {
            this.handleP2PMessage(message, peerId);
        });

        // Handle ICE failure - triggers cleanup
        this.p2pTransport.onIceFailed((peerId, iceState) => {
            ui.updateStatus(`P2P ICE failed: ${peerId}`);
        });

        // Handle data channel errors
        this.p2pTransport.onDataChannelError((peerId, error) => {
            ui.updateStatus(`P2P error: ${peerId}`);
        });

        // Handle handshake timeouts
        this.p2pTransport.onHandshakeTimeout((peerId) => {
            ui.updateStatus(`P2P timeout: ${peerId}`);
            if (this.scene) {
                this.cleanupPeer(peerId, this.scene);
            }
        });
    }

    connect(online = false) {
        const url = online ? CONFIG.NETWORKING.ONLINE_SERVER_URL : CONFIG.NETWORKING.LOCAL_SERVER_URL;
        this.transport.connect(url);
    }

    sendMessage(type, payload) {
        const success = this.transport.send({ type, payload });
        if (success) {
            ui.updateStatus(`📤 Sent ${type} to server`);
        } else {
            ui.updateStatus(`❌ Failed to send ${type}: No server connection`);
        }
        return success;
    }

    /**
     * Process queued messages with budget limit
     * Should be called from the game loop
     */
    processMessageQueue() {
        const MAX_MESSAGES_PER_FRAME = 10;
        let processed = 0;
        while (this.messageQueue.hasMessages() && processed < MAX_MESSAGES_PER_FRAME) {
            const queuedItem = this.messageQueue.dequeue();
            if (queuedItem) {
                const { message, source } = queuedItem;
                // Process the message by calling the original callback
                this.onMessageCallback(message.type, message.payload);
                processed++;
            }
        }
    }

    // --- P2P Methods ---
    createPeerConnection(peerId, isInitiator = false) {
        // Delegate WebRTC connection creation to P2PTransport
        return this.p2pTransport.createPeerConnection(peerId, isInitiator);
    }

    handleP2PMessage(message, fromPeer) {
        // Delegate all P2P message processing to GameStateManager
        this.gameStateManager.processP2PMessage(message, fromPeer);
    }

    broadcastP2P(message) {
        // Delegate to P2PTransport
        return this.p2pTransport.broadcastToAllPeers(message);
    }

    /**
     * Get all peer IDs that are currently in a specific chunk
     * Used for deterministic spawn authority
     * @param {string} chunkId - The chunk ID to check
     * @returns {Array<string>} Array of peer IDs in that chunk
     */
    getPeersInChunk(chunkId) {
        const peersInChunk = [];

        this.avatars.forEach((avatar, peerId) => {
            if (avatar && avatar.position) {
                const peerChunkId = ChunkCoordinates.worldToChunkId(
                    avatar.position.x,
                    avatar.position.z
                );
                if (peerChunkId === chunkId) {
                    peersInChunk.push(peerId);
                }
            }
        });

        return peersInChunk;
    }

    cleanupPeer(peerId, scene) {
        // Close P2P connection
        this.p2pTransport.closePeerConnection(peerId);

        // Remove from chunk registry before deleting peerGameData
        const peerData = this.peerGameData.get(peerId);
        if (peerData && peerData.currentChunkKey && this.game && this.game.gameState) {
            this.game.gameState.removePlayerFromRegistry(peerId, peerData.currentChunkKey);
        }

        // Recalculate AI authority if this peer was authority
        if (this.game?.banditController) {
            this.game.banditController.onPeerDisconnected(peerId);
        }
        if (this.game?.deerController) {
            this.game.deerController.onPeerDisconnected(peerId);
        }

        // Clean up mobile entity mesh (boat) if peer was piloting
        if (peerData?.mobileEntity?.mesh) {
            // Unregister from animation system
            if (this.game?.animationSystem) {
                this.game.animationSystem.unregister(peerData.mobileEntity.mesh.userData.objectId);
            }
            scene.remove(peerData.mobileEntity.mesh);
            peerData.mobileEntity.mesh.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        }

        // Clear occupancy so entity can be remounted (ISSUE-038 fix)
        if (peerData?.mobileEntity?.entityId && this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.clearOccupied(peerData.mobileEntity.entityId);
        }

        // Clear cart occupancy and dispose peer cart mesh (ISSUE-043 fix)
        if (peerData?.towedCart) {
            if (peerData.towedCart.cartId && this.game?.mobileEntitySystem) {
                this.game.mobileEntitySystem.clearOccupied(peerData.towedCart.cartId);
            }
            if (peerData.towedCart.mesh?.userData?.isPeerCart) {
                scene.remove(peerData.towedCart.mesh);
                peerData.towedCart.mesh.traverse((child) => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                });
            }
        }

        // Clear crate occupancy and dispose peer crate mesh (ISSUE-043 fix)
        if (peerData?.loadedCrate) {
            if (peerData.loadedCrate.crateId && this.game?.mobileEntitySystem) {
                this.game.mobileEntitySystem.clearOccupied(peerData.loadedCrate.crateId);
            }
            if (peerData.loadedCrate.mesh?.userData?.isPeerCrate) {
                peerData.loadedCrate.mesh.traverse((child) => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                });
            }
        }

        // Clear artillery occupancy and dispose peer artillery mesh
        if (peerData?.towedArtillery) {
            if (peerData.towedArtillery.artilleryId && this.game?.mobileEntitySystem) {
                this.game.mobileEntitySystem.clearOccupied(peerData.towedArtillery.artilleryId);
            }
            if (peerData.towedArtillery.mesh?.userData?.isPeerArtillery) {
                scene.remove(peerData.towedArtillery.mesh);
                peerData.towedArtillery.mesh.traverse((child) => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                });
            }
        }

        // Cleanup name tag for peer
        if (this.game?.nameTagManager) {
            this.game.nameTagManager.unregisterEntity(`peer_${peerId}`);
        }

        // Clean up game-specific data
        this.peerGameData.delete(peerId);

        const avatar = this.avatars.get(peerId);
        if (avatar) {
            scene.remove(avatar);
            if (avatar.geometry) avatar.geometry.dispose();
            if (avatar.material) avatar.material.dispose();
            this.avatars.delete(peerId);
        }

        ui.updatePeerInfo(this.p2pTransport.peers, this.avatars);
    }

    /**
     * Initiate P2P connection with a peer
     * @param {string} peerId - Peer ID to connect to
     */
    async initiateP2PConnection(peerId) {
        this.createPeerConnection(peerId, true);
        try {
            const offer = await this.p2pTransport.createOffer(peerId);
            this.sendMessage('webrtc_offer', {
                recipientId: peerId,
                senderId: this.gameState.clientId,
                offer
            });
        } catch (error) {
            ui.updateStatus(`❌ Failed to create offer for ${peerId}: ${error}`);
        }
    }

    /**
     * Check all peers and reconnect if needed
     */
    checkAndReconnectPeers() {
        this.p2pTransport.peers.forEach((peer, peerId) => {
            if (peer.state === 'disconnected' || peer.state === 'failed') {
                if (this.gameState.clientId < peerId) { // Initiation rule
                    ui.updateStatus(`Attempting P2P reconnect to ${peerId}...`);
                    this.initiateP2PConnection(peerId);
                }
            }
        });
    }

    /**
     * Stagger P2P connection initiations with delays
     * @param {Array} newPlayers - Array of player objects with id property
     * @param {function} onPlayerAdded - Callback for when player is added (peerId, index)
     */
    staggerP2PInitiations(newPlayers, onPlayerAdded) {
        newPlayers.forEach((player, index) => {
            setTimeout(() => {
                // Only initiate if this client has lower ID (deterministic handshake)
                if (this.gameState.clientId < player.id) {
                    this.initiateP2PConnection(player.id);
                }

                // Create game data entry for this peer if it doesn't exist
                if (!this.peerGameData.has(player.id)) {
                    this.peerGameData.set(player.id, {
                        accountId: null,
                        targetPosition: null,
                        targetRotation: 0,
                        lastUpdateTime: 0,
                        username: null,
                        factionId: null,
                        aiEnemy: null,
                        aiEnemyTargetPosition: null,
                        aiEnemyMoving: false,
                        onDock: false,
                        targetY: undefined,
                        isClimbing: false,
                        climbingTargetPosition: null,
                    });
                }

                // Call callback to let game create avatar
                if (onPlayerAdded) {
                    onPlayerAdded(player.id, index);
                }
            }, index * 750);
        });
    }
}

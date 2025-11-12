import { ui } from '../ui.js';
import { CONFIG } from '../config.js';
import { WebSocketTransport } from './WebSocketTransport.js';
import { MessageQueue } from './MessageQueue.js';
import { P2PTransport } from './P2PTransport.js';
import { GameStateManager } from './GameStateManager.js';

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
            ui.updateButtonStates(false, null, null, null, false, false, false, null, false, false);
        });

        // Register callback for when transport has errors
        this.transport.onError((error) => {
            ui.updateStatus(`❌ Server error: ${error.message || 'Unknown error'}`);
            ui.updateConnectionStatus('disconnected', '❌ Server Error');
        });

        // Register callback for incoming messages - QUEUE them instead of processing immediately
        this.transport.onMessage((data) => {
            ui.updateStatus(`📥 Server: ${data.type}`);
            this.messageQueue.enqueue(data, 'server');
        });
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
                    targetPosition: null,
                    moveStartTime: null,
                    harvestState: null,
                    animationMixer: null,
                    choppingAction: null,
                    aiEnemy: null,
                    aiEnemyMoving: false
                });
            }

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
                this.p2pTransport.sendToPeer(peerId, message);

                // Send AI enemy initial position (if alive)
                if (this.aiEnemy && !this.gameState.aiEnemyIsDead) {
                    const aiMessage = {
                        type: 'ai_enemy_update',
                        payload: {
                            position: this.aiEnemy.position.toArray(),
                            moving: this.gameState.aiEnemyMoving || false
                        }
                    };
                    this.p2pTransport.sendToPeer(peerId, aiMessage);
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
     * Process all queued messages
     * Should be called from the game loop
     */
    processMessageQueue() {
        while (this.messageQueue.hasMessages()) {
            const queuedItem = this.messageQueue.dequeue();
            if (queuedItem) {
                const { message, source } = queuedItem;
                // Process the message by calling the original callback
                this.onMessageCallback(message.type, message.payload);
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

    cleanupPeer(peerId, scene) {
        // Close P2P connection
        this.p2pTransport.closePeerConnection(peerId);

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
                        targetPosition: null,
                        moveStartTime: null,
                        aiEnemy: null,
                        aiEnemyTargetPosition: null,
                        aiEnemyMoving: false
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

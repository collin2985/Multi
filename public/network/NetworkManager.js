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

        // P2P retry state
        this.p2pRetryCount = new Map();  // peerId -> number of retries attempted
        this.p2pRetryTimers = new Map(); // peerId -> setTimeout ID
        this.P2P_MAX_RETRIES = 2;        // Max retry attempts (3 total connections)
        this.P2P_RETRY_DELAY = 3000;     // 3 seconds between retries

        // Expected disconnects - peers that may disconnect due to game events (death/respawn)
        // These should NOT trigger the P2P reconnecting UI or retry logic
        this.expectedDisconnects = new Set();  // peerId Set
        this.expectedDisconnectTimers = new Map();  // peerId -> setTimeout ID for auto-cleanup

        // Full state broadcast (periodic sync for recovery)
        this.fullStateBroadcastInterval = null;
        this.fullStateBroadcastTimeout = null;

        // Connect GameStateManager to data
        this.gameStateManager.setAvatars(this.avatars);
        this.gameStateManager.setPeerGameData(this.peerGameData);
        this.gameStateManager.setNetworkManager(this);
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
            // Stop periodic full state broadcast
            this.stopFullStateBroadcast();
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
                false,  // limestoneAvailable
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

            // Clear retry state on successful connection
            this.clearP2PRetryState(peerId);

            // Clear expected disconnect state (peer successfully reconnected after death/respawn)
            this.clearExpectedDisconnect(peerId);

            // Hide P2P connection status banner (connection succeeded)
            ui.updateP2PConnectionStatus('hidden');

            // Initialize game-specific data for this peer
            if (!this.peerGameData.has(peerId)) {
                this.peerGameData.set(peerId, {
                    accountId: null,         // Persistent account ID for reconnection detection
                    targetPosition: null,    // THREE.Vector3 - where peer is heading
                    targetRotation: 0,       // Target Y rotation
                    lastUpdateTime: 0,       // When last position update received
                    username: null,          // Peer's display name
                    factionId: null,         // Peer's faction (1=Southguard, 3=Northmen, null=Neutral)
                    spawnTime: null,         // When peer last spawned (for P2P kick logic)
                    harvestState: null,
                    animationMixer: null,
                    choppingAction: null,
                    aiEnemy: null,
                    aiEnemyMoving: false,
                    aiEnemyTargetPosition: null,
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
                    clientId: this.gameState.clientId,
                    spawnTime: this.gameState.lastSpawnTime  // For P2P kick logic (most recent spawner gets kicked)
                });

                // Send comprehensive full state (includes all player state for sync/recovery)
                this.p2pTransport.sendToPeer(peerId, this.buildFullStateMessage());

                // Start periodic full state broadcast if not already running
                this.startFullStateBroadcast();

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

                // Send active woodcutters to newly connected peer
                if (this.game?.woodcutterController) {
                    const woodcutters = this.game.woodcutterController.getActiveWoodcuttersForSync();
                    if (woodcutters.length > 0) {
                        this.p2pTransport.sendToPeer(peerId, {
                            type: 'woodcutter_sync',
                            woodcutters: woodcutters
                        });
                    }
                }

                // Send active miners to newly connected peer
                if (this.game?.minerController) {
                    const miners = this.game.minerController.getActiveMinersForSync();
                    if (miners.length > 0) {
                        this.p2pTransport.sendToPeer(peerId, {
                            type: 'miner_sync',
                            miners: miners
                        });
                    }
                }

                // Send active stonemasons to newly connected peer
                if (this.game?.stoneMasonController) {
                    const stonemasons = this.game.stoneMasonController.getActiveStoneMasonsForSync();
                    if (stonemasons.length > 0) {
                        this.p2pTransport.sendToPeer(peerId, {
                            type: 'stonemason_sync',
                            stonemasons: stonemasons
                        });
                    }
                }

                // Send active blacksmiths to newly connected peer
                if (this.game?.blacksmithController) {
                    const blacksmiths = this.game.blacksmithController.getActiveBlacksmithsForSync();
                    if (blacksmiths.length > 0) {
                        this.p2pTransport.sendToPeer(peerId, {
                            type: 'blacksmith_sync',
                            blacksmiths: blacksmiths
                        });
                    }
                }

                // Send active ironworkers to newly connected peer
                if (this.game?.ironWorkerController) {
                    const ironworkers = this.game.ironWorkerController.getActiveIronWorkersForSync();
                    if (ironworkers.length > 0) {
                        this.p2pTransport.sendToPeer(peerId, {
                            type: 'ironworker_sync',
                            ironworkers: ironworkers
                        });
                    }
                }

                // Send active tileworkers to newly connected peer
                if (this.game?.tileWorkerController) {
                    const tileworkers = this.game.tileWorkerController.getActiveTileWorkersForSync();
                    if (tileworkers.length > 0) {
                        this.p2pTransport.sendToPeer(peerId, {
                            type: 'tileworker_sync',
                            tileworkers: tileworkers
                        });
                    }
                }

                // Send active fishermen to newly connected peer
                if (this.game?.fishermanController) {
                    const fishermen = this.game.fishermanController.getActiveFishermenForSync();
                    if (fishermen.length > 0) {
                        this.p2pTransport.sendToPeer(peerId, {
                            type: 'fisherman_sync',
                            fishermen: fishermen
                        });
                    }
                }

                // NOTE: Mobile entity, cart, artillery, crate, climbing states are now sent
                // via player_full_state above for comprehensive sync/recovery

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

        // Handle ICE failure - attempt retry
        this.p2pTransport.onIceFailed((peerId, iceState) => {
            ui.updateStatus(`P2P ICE failed: ${peerId}`);
            this.handleP2PConnectionFailure(peerId, 'ICE failed');
        });

        // Handle data channel errors - attempt retry (unless intentional close)
        this.p2pTransport.onDataChannelError((peerId, error) => {
            // Check if this is an intentional close by the remote peer
            const errorString = error?.error?.message || error?.message || String(error);
            if (errorString.includes('Close called') || errorString.includes('User-Initiated Abort')) {
                console.log(`[P2P] Peer ${peerId} intentionally closed connection, skipping retries`);
                this.clearP2PRetryState(peerId);
                ui.updateP2PConnectionStatus('hidden');
                return;
            }
            ui.updateStatus(`P2P error: ${peerId}`);
            this.handleP2PConnectionFailure(peerId, 'data channel error');
        });

        // Handle handshake timeouts - attempt retry
        this.p2pTransport.onHandshakeTimeout((peerId) => {
            ui.updateStatus(`P2P timeout: ${peerId}`);
            this.handleP2PConnectionFailure(peerId, 'handshake timeout');
        });
    }

    /**
     * Handle P2P connection failure with retry logic
     * @param {string} peerId - The peer that failed to connect
     * @param {string} reason - Reason for failure (for logging)
     */
    handleP2PConnectionFailure(peerId, reason) {
        // Check if peer was intentionally disconnected (moved out of proximity)
        // If peerGameData no longer has this peer, don't attempt retry
        if (!this.peerGameData.has(peerId)) {
            console.log(`[P2P] Ignoring failure for ${peerId} - peer no longer in proximity`);
            return;
        }

        // Check if this is an expected disconnect (peer died/respawning)
        // Don't show reconnecting UI or attempt retries for game-event disconnects
        if (this.expectedDisconnects.has(peerId)) {
            console.log(`[P2P] Ignoring failure for ${peerId} - expected disconnect (death/respawn)`);
            return;
        }

        // Clear any existing retry timer for this peer
        const existingTimer = this.p2pRetryTimers.get(peerId);
        if (existingTimer) {
            clearTimeout(existingTimer);
            this.p2pRetryTimers.delete(peerId);
        }

        // Get current retry count
        const retryCount = this.p2pRetryCount.get(peerId) || 0;

        if (retryCount < this.P2P_MAX_RETRIES) {
            // Schedule retry
            const newRetryCount = retryCount + 1;
            this.p2pRetryCount.set(peerId, newRetryCount);

            console.log(`[P2P] Connection to ${peerId} failed (${reason}), retry ${newRetryCount}/${this.P2P_MAX_RETRIES} in ${this.P2P_RETRY_DELAY}ms`);
            ui.updateStatus(`P2P retry ${newRetryCount}/${this.P2P_MAX_RETRIES} for ${peerId.slice(0,8)}...`);

            // Show P2P connection status banner
            ui.updateP2PConnectionStatus('retrying', `P2P Reconnecting (${newRetryCount}/${this.P2P_MAX_RETRIES})...`);

            const timerId = setTimeout(() => {
                this.p2pRetryTimers.delete(peerId);
                this.retryP2PConnection(peerId);
            }, this.P2P_RETRY_DELAY);

            this.p2pRetryTimers.set(peerId, timerId);
        } else {
            // Max retries exceeded - kick most recent spawner
            console.error(`[P2P] Connection to ${peerId} failed after ${this.P2P_MAX_RETRIES} retries`);
            this.handleP2PFinalFailure(peerId);
        }
    }

    /**
     * Retry P2P connection to a peer
     * @param {string} peerId - The peer to retry connecting to
     */
    retryP2PConnection(peerId) {
        // Check if peer was intentionally disconnected (moved out of proximity)
        // If peerGameData no longer has this peer, don't retry
        if (!this.peerGameData.has(peerId)) {
            console.log(`[P2P] Skipping retry for ${peerId} - peer no longer in proximity`);
            ui.updateP2PConnectionStatus('hidden');
            return;
        }

        // Clean up any existing connection state
        this.p2pTransport.closePeerConnection(peerId);

        // Only initiate if this client has lower ID (deterministic handshake)
        if (this.gameState.clientId < peerId) {
            console.log(`[P2P] Retrying connection to ${peerId}`);
            this.initiateP2PConnection(peerId);
        } else {
            // We're not the initiator - the other peer should retry
            // But if they don't, we'll still fail. Give them a chance.
            console.log(`[P2P] Waiting for ${peerId} to retry connection (they are initiator)`);
        }
    }

    /**
     * Handle final P2P failure after all retries exhausted
     * Kicks the most recently spawned player (based on spawn time comparison)
     * @param {string} peerId - The peer that failed
     */
    handleP2PFinalFailure(peerId) {
        // Clean up retry state
        this.clearP2PRetryState(peerId);

        // Clean up the peer visuals
        if (this.scene) {
            this.cleanupPeer(peerId, this.scene);
        }

        // Determine who should be kicked based on spawn time
        // Most recently spawned player gets kicked
        const mySpawnTime = this.gameState.lastSpawnTime || 0;
        const peerData = this.peerGameData.get(peerId);
        const peerSpawnTime = peerData?.spawnTime || 0;

        console.log(`[P2P] Spawn time comparison - Me: ${mySpawnTime}, Peer: ${peerSpawnTime}`);

        // Decide if we should die
        let shouldIDie = false;

        if (mySpawnTime > peerSpawnTime) {
            // I spawned more recently - I should die
            shouldIDie = true;
            console.log(`[P2P] I spawned more recently (${mySpawnTime} > ${peerSpawnTime}) - I will die`);
        } else if (peerSpawnTime > mySpawnTime) {
            // Peer spawned more recently - they should handle their own death
            shouldIDie = false;
            console.log(`[P2P] Peer spawned more recently (${peerSpawnTime} > ${mySpawnTime}) - they should die`);
        } else {
            // Equal or both missing - fall back to clientId comparison (higher ID dies)
            shouldIDie = this.gameState.clientId > peerId;
            console.log(`[P2P] Spawn times equal/missing, using clientId fallback - shouldIDie: ${shouldIDie}`);
        }

        if (shouldIDie && this.game) {
            // Show failed status briefly
            ui.updateP2PConnectionStatus('failed', 'P2P Connection Failed');

            console.error(`[P2P] Killing player due to P2P failure with ${peerId}`);

            // Kill the player (death flow will show spawn screen with kick message)
            if (this.game.killEntity && this.game.playerObject) {
                // Store kick message for spawn screen
                this.game._p2pKickMessage = 'You were disconnected due to P2P connection failure with another player.';
                this.game.killEntity(this.game.playerObject, false, false, 'P2P Connection Failed');
            }

            // Clear status after a delay (death screen will be showing)
            setTimeout(() => {
                ui.updateP2PConnectionStatus('hidden');
            }, 2000);
        } else {
            // We don't need to die - just clear the status
            ui.updateP2PConnectionStatus('hidden');
            console.log(`[P2P] Not killing self - peer should handle their own death`);
        }
    }

    /**
     * Clear P2P retry state for a peer
     * Called on successful connection or when peer leaves proximity
     * @param {string} peerId - The peer to clear state for
     */
    clearP2PRetryState(peerId) {
        // Clear retry count
        this.p2pRetryCount.delete(peerId);

        // Clear and cancel any pending retry timer
        const timerId = this.p2pRetryTimers.get(peerId);
        if (timerId) {
            clearTimeout(timerId);
            this.p2pRetryTimers.delete(peerId);
        }

        // Hide P2P connection status banner if no more retries are pending
        if (this.p2pRetryTimers.size === 0) {
            ui.updateP2PConnectionStatus('hidden');
        }
    }

    /**
     * Mark a peer as expected to disconnect (due to death/respawn game events)
     * P2P failures from this peer will be ignored during the grace period
     * @param {string} peerId - The peer expected to disconnect
     * @param {number} durationMs - How long to suppress failures (default 10s for respawn)
     */
    markExpectedDisconnect(peerId, durationMs = 10000) {
        this.expectedDisconnects.add(peerId);

        // Clear any existing timer for this peer
        const existingTimer = this.expectedDisconnectTimers.get(peerId);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Auto-remove after duration
        const timerId = setTimeout(() => {
            this.expectedDisconnects.delete(peerId);
            this.expectedDisconnectTimers.delete(peerId);
        }, durationMs);

        this.expectedDisconnectTimers.set(peerId, timerId);
    }

    /**
     * Mark all connected peers as expected to disconnect
     * Called when local player dies (peers may see us disconnect during respawn)
     * @param {number} durationMs - How long to suppress failures
     */
    markAllPeersExpectedDisconnect(durationMs = 10000) {
        const connectedPeers = this.p2pTransport.getConnectedPeers();
        for (const peerId of connectedPeers) {
            this.markExpectedDisconnect(peerId, durationMs);
        }
    }

    /**
     * Clear expected disconnect state for a peer
     * @param {string} peerId - The peer to clear
     */
    clearExpectedDisconnect(peerId) {
        this.expectedDisconnects.delete(peerId);
        const timerId = this.expectedDisconnectTimers.get(peerId);
        if (timerId) {
            clearTimeout(timerId);
            this.expectedDisconnectTimers.delete(peerId);
        }
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
        const MAX_MESSAGES_PER_FRAME = 30;
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
        // Clear any pending P2P retry state
        this.clearP2PRetryState(peerId);

        // Close P2P connection intentionally (won't trigger failure callbacks)
        this.p2pTransport.closeIntentionally(peerId);

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
        if (this.game?.brownBearController) {
            this.game.brownBearController.onPeerDisconnected(peerId);
        }

        // Clean up mobile entity mesh (boat) if peer was piloting
        if (peerData?.mobileEntity?.mesh) {
            const shipEntityId = peerData.mobileEntity.entityId;
            const mobileState = this.game?.gameState?.mobileEntityState;
            const manningState = this.game?.gameState?.artilleryManningState;

            // Check if local player is a gunner on this ship
            const isLocalGunnerOnShip = mobileState?.isActive &&
                (mobileState.phase === 'crewing' ||
                 (mobileState.phase === 'disembarking' && mobileState.wasCrewingBeforeDisembark)) &&
                mobileState.entityId === shipEntityId &&
                manningState?.isShipMounted;

            if (isLocalGunnerOnShip) {
                // DON'T remove ship - local player is crewing it
                // Just clear peer's reference, keep mesh in scene
                console.log(`[Ship] Pilot disconnected but local player is gunner - keeping ship ${shipEntityId}`);

                // Notify gunner (Take Helm button should appear automatically once helm occupancy is cleared)
                ui.showToast('Pilot disconnected', 'info');

                // Clear peer's mesh reference without disposing
                peerData.mobileEntity.mesh = null;
            } else {
                // Normal cleanup - no local gunner on this ship
                if (this.game?.animationSystem) {
                    this.game.animationSystem.unregister(peerData.mobileEntity.mesh.userData.objectId);
                }
                // Remove kinematic physics collider for peer's boat
                if (this.game?.physicsManager && peerData.mobileEntity.mesh.userData?.physicsBodyId) {
                    this.game.physicsManager.removeKinematicBody(peerData.mobileEntity.mesh.userData.physicsBodyId);
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
        }

        // Clear occupancy so entity can be remounted (ISSUE-038 fix)
        if (peerData?.mobileEntity?.entityId && this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.clearOccupied(peerData.mobileEntity.entityId);
        }

        // Clear active peer boat tracking for collision detection
        if (this.gameStateManager?.activePeerBoats) {
            this.gameStateManager.activePeerBoats.delete(peerId);
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

        // Clear towed artillery occupancy and dispose peer artillery mesh
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

        // Clear manned artillery occupancy and dispose peer artillery mesh
        if (peerData?.mannedArtillery) {
            if (peerData.mannedArtillery.artilleryId && this.game?.mobileEntitySystem) {
                this.game.mobileEntitySystem.clearOccupied(peerData.mannedArtillery.artilleryId);
            }
            if (peerData.mannedArtillery.mesh?.userData?.isPeerArtillery) {
                scene.remove(peerData.mannedArtillery.mesh);
                peerData.mannedArtillery.mesh.traverse((child) => {
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

    // ==========================================
    // FULL STATE SYNC (P2P Recovery)
    // ==========================================

    /**
     * Build a comprehensive state message containing all player state
     * Used for initial sync on connection and periodic recovery broadcasts
     * @returns {Object} Full state message
     */
    buildFullStateMessage() {
        const gs = this.gameState;
        const state = {
            type: 'player_full_state',
            t: Date.now(),
            // Identity
            accountId: gs.accountId,
            username: gs.username,
            factionId: gs.factionId,
            // Position
            position: this.playerObject?.position.toArray() || [0, 0, 0],
            rotation: this.playerObject?.rotation.y || 0,
            isMoving: gs.isMoving,
            targetPosition: gs.isMoving ? gs.playerTargetPosition?.toArray() : null,
            // Equipment
            hasRifle: this.game?.playerCombat?.hasRifle() || false,
            speedMultiplier: this.game?.playerController?.getSpeedMultiplier() || 1.0,
            // States (all null by default)
            climbing: null,
            piloting: null,
            towedCart: null,
            loadedCrate: null,
            towedArtillery: null,
            manningArtillery: null,
            harvesting: null
        };

        // Climbing state
        if (gs.climbingState?.isClimbing) {
            state.climbing = {
                isClimbing: true,
                outpostId: gs.climbingState.outpostId,
                phase: gs.climbingState.climbingPhase
            };
        }

        // Mobile entity (piloting boat/horse)
        const me = gs.mobileEntityState;
        if (me?.isActive && me.phase === 'piloting' && me.currentEntity) {
            state.piloting = {
                entityId: me.entityId,
                entityType: me.entityType,
                position: me.currentEntity.position.toArray(),
                rotation: me.currentEntity.rotation.y
            };
        }

        // Cart attachment
        const cart = gs.cartAttachmentState;
        if (cart?.isAttached && cart.attachedCart) {
            state.towedCart = {
                cartId: cart.cartId,
                position: cart.attachedCart.position.toArray(),
                rotation: cart.attachedCart.rotation.y
            };
        }

        // Crate on cart
        const crate = gs.crateLoadState;
        if (crate?.isLoaded && crate.loadedCrate) {
            state.loadedCrate = {
                crateId: crate.crateId
            };
        }

        // Artillery attachment (horse only)
        const art = gs.artilleryAttachmentState;
        if (art?.isAttached && art.attachedArtillery) {
            state.towedArtillery = {
                artilleryId: art.artilleryId,
                position: art.attachedArtillery.position.toArray(),
                rotation: art.attachedArtillery.rotation.y
            };
        }

        // Artillery manning
        const mann = gs.artilleryManningState;
        if (mann?.isManning && mann.mannedArtillery) {
            state.manningArtillery = {
                artilleryId: mann.artilleryId,
                heading: mann.artilleryHeading,
                position: mann.mannedArtillery.position.toArray()
            };
        }

        // Active harvest action
        if (gs.activeAction?.actionType) {
            state.harvesting = {
                actionType: gs.activeAction.actionType,
                harvestType: gs.activeAction.harvestType,
                endTime: gs.activeAction.startTime + gs.activeAction.duration
            };
        }

        return state;
    }

    /**
     * Start the periodic full state broadcast
     * Uses staggered timing (30s base + random 0-5s offset) to avoid all clients syncing at once
     */
    startFullStateBroadcast() {
        // Don't start if already running
        if (this.fullStateBroadcastInterval || this.fullStateBroadcastTimeout) {
            return;
        }

        // Random offset 0-5000ms to stagger across clients
        const offset = Math.random() * 5000;
        const interval = 30000; // 30 seconds

        // Initial delay includes offset
        this.fullStateBroadcastTimeout = setTimeout(() => {
            this.broadcastFullState();
            // Then repeat every 30s
            this.fullStateBroadcastInterval = setInterval(() => {
                this.broadcastFullState();
            }, interval);
        }, offset);
    }

    /**
     * Broadcast full state to all connected peers
     * Called periodically for recovery and on significant state changes
     */
    broadcastFullState() {
        if (!this.playerObject) return;
        const peers = this.p2pTransport.getConnectedPeers();
        if (peers.length === 0) return;

        const fullState = this.buildFullStateMessage();
        this.broadcastP2P(fullState);
    }

    /**
     * Stop the periodic full state broadcast
     * Called on disconnect or cleanup
     */
    stopFullStateBroadcast() {
        if (this.fullStateBroadcastTimeout) {
            clearTimeout(this.fullStateBroadcastTimeout);
            this.fullStateBroadcastTimeout = null;
        }
        if (this.fullStateBroadcastInterval) {
            clearInterval(this.fullStateBroadcastInterval);
            this.fullStateBroadcastInterval = null;
        }
    }
}

/**
 * P2PTransport.js
 * Pure WebRTC connection management - NO game logic
 * Handles peer-to-peer connections and data channels
 */

export class P2PTransport {
    constructor() {
        this.peers = new Map(); // Map of peerId -> peer connection info

        // ICE server configuration
        // Two-phase approach: try direct first, fall back to TURN relay
        // TURN credentials are fetched dynamically from server (Cloudflare API)

        // DEBUG: Set to true to force TURN usage even in local mode (for testing)
        this.DEBUG_FORCE_TURN = false;

        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

        if (isLocal && !this.DEBUG_FORCE_TURN) {
            // Local mode: no external servers (direct connections only)
            this.iceConfigDirect = { iceServers: [] };
            this.iceConfigWithTurn = { iceServers: [] };
        } else {
            // Direct-only config (Cloudflare STUN is free)
            // Used by initiator on first attempt
            this.iceConfigDirect = {
                iceServers: [
                    { urls: 'stun:stun.cloudflare.com:3478' }
                ]
            };

            // TURN config starts with STUN only
            // TURN servers will be added dynamically via setTurnCredentials()
            this.iceConfigWithTurn = {
                iceServers: [
                    { urls: 'stun:stun.cloudflare.com:3478' }
                ]
            };
        }

        // Track which peers needed TURN fallback
        this.usingTurnFallback = new Set();

        // Callbacks
        this.onMessageCallback = null;
        this.onConnectionStateChangeCallback = null;
        this.onDataChannelOpenCallback = null;
        this.onDataChannelCloseCallback = null;
        this.onIceCandidateCallback = null;
        this.onIceFailedCallback = null;
        this.onDataChannelErrorCallback = null;
        this.onHandshakeTimeoutCallback = null;

        // Handshake timeout tracking
        this.handshakeTimeouts = new Map();
        this.HANDSHAKE_TIMEOUT_MS = 15000; // 15 seconds

        // Track peers being intentionally closed (to skip failure callbacks)
        this.intentionalClosures = new Set();
    }

    /**
     * Create a new peer connection
     * @param {string} peerId - Unique identifier for the peer
     * @param {boolean} isInitiator - Whether this peer initiates the connection
     * @param {boolean} useTurn - Whether to include TURN servers (for retry after direct fails)
     * @returns {RTCPeerConnection}
     */
    createPeerConnection(peerId, isInitiator = false, useTurn = false) {
        // DEBUG: Force TURN for testing
        if (this.DEBUG_FORCE_TURN) {
            useTurn = true;
        }

        // Responders always use full config (they don't control retry)
        // Initiators use direct-first, then TURN on retry
        let config = (!isInitiator || useTurn)
            ? this.iceConfigWithTurn
            : this.iceConfigDirect;

        // DEBUG: Force relay-only to test TURN server
        if (this.DEBUG_FORCE_TURN) {
            config = { ...config, iceTransportPolicy: 'relay' };
            console.warn('[P2P] DEBUG: Forcing relay-only mode, config:', config);
        }

        if (useTurn) {
            this.usingTurnFallback.add(peerId);
        }

        const connection = new RTCPeerConnection(config);

        const peerState = {
            connection,
            dataChannel: null,
            state: 'connecting',
            isInitiator
        };

        this.peers.set(peerId, peerState);

        // Start handshake timeout
        this.startHandshakeTimeout(peerId);

        // Setup ICE candidate handler
        connection.onicecandidate = (event) => {
            if (event.candidate && this.onIceCandidateCallback) {
                this.onIceCandidateCallback(peerId, event.candidate);
            }
        };

        // Setup connection state change handler
        connection.onconnectionstatechange = () => {
            peerState.state = connection.connectionState;
            if (this.onConnectionStateChangeCallback) {
                this.onConnectionStateChangeCallback(peerId, connection.connectionState);
            }
        };

        // Setup ICE connection state handler for detecting failures
        connection.oniceconnectionstatechange = () => {
            const iceState = connection.iceConnectionState;
            if (iceState === 'failed' || iceState === 'disconnected' || iceState === 'closed') {
                // Skip failure callback if intentionally closed (peer moved out of proximity)
                if (this.intentionalClosures.has(peerId)) {
                    this.intentionalClosures.delete(peerId);
                    this.closePeerConnection(peerId);
                    return;
                }
                if (this.onIceFailedCallback) {
                    this.onIceFailedCallback(peerId, iceState);
                }
                this.closePeerConnection(peerId);
            }
        };

        // Setup data channel
        if (isInitiator) {
            // Initiator creates the data channel
            const dataChannel = connection.createDataChannel('game', { ordered: true });
            this.setupDataChannel(dataChannel, peerId);
            peerState.dataChannel = dataChannel;
        } else {
            // Responder waits for data channel
            connection.ondatachannel = (event) => {
                this.setupDataChannel(event.channel, peerId);
                peerState.dataChannel = event.channel;
            };
        }

        return connection;
    }

    /**
     * Setup data channel event handlers
     * @param {RTCDataChannel} dataChannel
     * @param {string} peerId
     * @private
     */
    setupDataChannel(dataChannel, peerId) {
        dataChannel.onopen = () => {
            // Clear handshake timeout - connection succeeded
            this.clearHandshakeTimeout(peerId);
            if (this.onDataChannelOpenCallback) {
                this.onDataChannelOpenCallback(peerId);
            }
        };

        dataChannel.onclose = () => {
            // Skip callback if intentionally closed
            if (this.intentionalClosures.has(peerId)) {
                return;
            }
            if (this.onDataChannelCloseCallback) {
                this.onDataChannelCloseCallback(peerId);
            }
        };

        dataChannel.onerror = (error) => {
            // Skip callback if intentionally closed
            if (this.intentionalClosures.has(peerId)) {
                return;
            }
            console.error(`[P2P] Data channel error for ${peerId}:`, error);
            if (this.onDataChannelErrorCallback) {
                this.onDataChannelErrorCallback(peerId, error);
            }
            this.closePeerConnection(peerId);
        };

        dataChannel.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (this.onMessageCallback) {
                    this.onMessageCallback(peerId, message);
                }
            } catch (error) {
                console.error(`Failed to parse P2P message from ${peerId}:`, error);
            }
        };
    }

    /**
     * Create an offer for a peer connection
     * @param {string} peerId
     * @returns {Promise<RTCSessionDescriptionInit>}
     */
    async createOffer(peerId) {
        const peer = this.peers.get(peerId);
        if (!peer || !peer.connection) {
            throw new Error(`Peer ${peerId} not found`);
        }

        const offer = await peer.connection.createOffer();
        await peer.connection.setLocalDescription(offer);
        return offer;
    }

    /**
     * Handle an incoming offer
     * @param {string} peerId
     * @param {RTCSessionDescriptionInit} offer
     * @returns {Promise<RTCSessionDescriptionInit>}
     */
    async handleOffer(peerId, offer) {
        const peer = this.peers.get(peerId);
        if (!peer || !peer.connection) {
            throw new Error(`Peer ${peerId} not found`);
        }

        await peer.connection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.connection.createAnswer();
        await peer.connection.setLocalDescription(answer);
        return answer;
    }

    /**
     * Handle an incoming answer
     * @param {string} peerId
     * @param {RTCSessionDescriptionInit} answer
     */
    async handleAnswer(peerId, answer) {
        const peer = this.peers.get(peerId);
        if (!peer || !peer.connection) {
            throw new Error(`Peer ${peerId} not found`);
        }

        await peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
    }

    /**
     * Add an ICE candidate
     * @param {string} peerId
     * @param {RTCIceCandidateInit} candidate
     */
    async addIceCandidate(peerId, candidate) {
        const peer = this.peers.get(peerId);
        if (!peer || !peer.connection) {
            throw new Error(`Peer ${peerId} not found`);
        }

        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
    }

    /**
     * Send a message to a specific peer
     * @param {string} peerId
     * @param {object} message
     * @returns {boolean}
     */
    sendToPeer(peerId, message) {
        const peer = this.peers.get(peerId);
        if (peer && peer.dataChannel && peer.dataChannel.readyState === 'open') {
            try {
                peer.dataChannel.send(JSON.stringify(message));
                return true;
            } catch (error) {
                console.error(`Failed to send to peer ${peerId}:`, error);
                return false;
            }
        }
        return false;
    }

    /**
     * Broadcast a message to all connected peers
     * @param {object} message
     * @returns {number} - Number of peers the message was sent to
     */
    broadcastToAllPeers(message) {
        // PERFORMANCE: Serialize once, reuse for all peers
        const serialized = JSON.stringify(message);
        let sentCount = 0;
        this.peers.forEach((peer, peerId) => {
            if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
                try {
                    peer.dataChannel.send(serialized);
                    sentCount++;
                } catch (error) {
                    console.error(`Failed to broadcast to peer ${peerId}:`, error);
                }
            }
        });
        return sentCount;
    }

    /**
     * Close and cleanup a peer connection
     * @param {string} peerId
     */
    closePeerConnection(peerId) {
        // Clear any pending handshake timeout
        this.clearHandshakeTimeout(peerId);

        const peer = this.peers.get(peerId);
        if (peer) {
            if (peer.dataChannel) {
                peer.dataChannel.close();
            }
            if (peer.connection) {
                peer.connection.close();
            }
            this.peers.delete(peerId);
        }

        // Clean up TURN fallback tracking
        this.usingTurnFallback.delete(peerId);

        // Clean up intentional closure flag after a brief delay (allows callbacks to check first)
        setTimeout(() => {
            this.intentionalClosures.delete(peerId);
        }, 100);
    }

    /**
     * Intentionally close a peer connection (peer moved out of proximity)
     * This will NOT trigger failure callbacks
     * @param {string} peerId
     */
    closeIntentionally(peerId) {
        this.intentionalClosures.add(peerId);
        this.closePeerConnection(peerId);
    }

    /**
     * Get the state of a peer connection
     * @param {string} peerId
     * @returns {string|null}
     */
    getPeerState(peerId) {
        const peer = this.peers.get(peerId);
        return peer ? peer.state : null;
    }

    /**
     * Check if a peer's data channel is open
     * @param {string} peerId
     * @returns {boolean}
     */
    isPeerConnected(peerId) {
        const peer = this.peers.get(peerId);
        return peer && peer.dataChannel && peer.dataChannel.readyState === 'open';
    }

    /**
     * Get all connected peer IDs
     * @returns {string[]}
     */
    getConnectedPeers() {
        const connected = [];
        this.peers.forEach((peer, peerId) => {
            if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
                connected.push(peerId);
            }
        });
        return connected;
    }

    // --- Callback Registration ---

    onMessage(callback) {
        this.onMessageCallback = callback;
    }

    onConnectionStateChange(callback) {
        this.onConnectionStateChangeCallback = callback;
    }

    onDataChannelOpen(callback) {
        this.onDataChannelOpenCallback = callback;
    }

    onDataChannelClose(callback) {
        this.onDataChannelCloseCallback = callback;
    }

    onIceCandidate(callback) {
        this.onIceCandidateCallback = callback;
    }

    onIceFailed(callback) {
        this.onIceFailedCallback = callback;
    }

    onDataChannelError(callback) {
        this.onDataChannelErrorCallback = callback;
    }

    onHandshakeTimeout(callback) {
        this.onHandshakeTimeoutCallback = callback;
    }

    /**
     * Start handshake timeout for a peer
     * @param {string} peerId
     */
    startHandshakeTimeout(peerId) {
        this.clearHandshakeTimeout(peerId);

        const timeoutId = setTimeout(() => {
            const peer = this.peers.get(peerId);
            if (peer && peer.dataChannel?.readyState !== 'open') {
                // Skip timeout callback if intentionally closed
                if (this.intentionalClosures.has(peerId)) {
                    return;
                }
                console.warn(`[P2P] Handshake timeout for ${peerId} after ${this.HANDSHAKE_TIMEOUT_MS}ms`);
                if (this.onHandshakeTimeoutCallback) {
                    this.onHandshakeTimeoutCallback(peerId);
                }
                this.closePeerConnection(peerId);
            }
        }, this.HANDSHAKE_TIMEOUT_MS);

        this.handshakeTimeouts.set(peerId, timeoutId);
    }

    /**
     * Clear handshake timeout for a peer
     * @param {string} peerId
     */
    clearHandshakeTimeout(peerId) {
        const timeoutId = this.handshakeTimeouts.get(peerId);
        if (timeoutId) {
            clearTimeout(timeoutId);
            this.handshakeTimeouts.delete(peerId);
        }
    }

    /**
     * Set TURN credentials received from server (Cloudflare API)
     * @param {Object} iceServersConfig - { iceServers: [...] } from Cloudflare
     */
    setTurnCredentials(iceServersConfig) {
        if (iceServersConfig?.iceServers?.length > 0) {
            this.iceConfigWithTurn = iceServersConfig;
            console.warn('[P2P] TURN credentials received:', iceServersConfig.iceServers.length, 'servers');
        } else {
            console.warn('[P2P] No TURN credentials received (empty or invalid)');
        }
    }

    /**
     * Get the connection type for a peer using WebRTC stats
     * @param {string} peerId
     * @returns {Promise<string|null>} 'host', 'srflx', 'prflx', 'relay', or null
     */
    async getConnectionType(peerId) {
        const peer = this.peers.get(peerId);
        if (!peer?.connection) return null;

        try {
            const stats = await peer.connection.getStats();

            // Find selected candidate pair via transport stats
            for (const report of stats.values()) {
                if (report.type === 'transport' && report.selectedCandidatePairId) {
                    const pair = stats.get(report.selectedCandidatePairId);
                    if (pair) {
                        const localCandidate = stats.get(pair.localCandidateId);
                        return localCandidate?.candidateType || null;
                    }
                }
            }
        } catch (e) {
            // Stats not available
        }
        return null;
    }

    /**
     * Check if peer is using TURN fallback
     * @param {string} peerId
     * @returns {boolean}
     */
    isUsingTurnFallback(peerId) {
        return this.usingTurnFallback.has(peerId);
    }
}

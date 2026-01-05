/**
 * P2PTransport.js
 * Pure WebRTC connection management - NO game logic
 * Handles peer-to-peer connections and data channels
 */

export class P2PTransport {
    constructor() {
        this.peers = new Map(); // Map of peerId -> peer connection info

        // ICE server configuration
        this.iceConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

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
    }

    /**
     * Create a new peer connection
     * @param {string} peerId - Unique identifier for the peer
     * @param {boolean} isInitiator - Whether this peer initiates the connection
     * @returns {RTCPeerConnection}
     */
    createPeerConnection(peerId, isInitiator = false) {
        const connection = new RTCPeerConnection(this.iceConfig);

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
            if (this.onDataChannelCloseCallback) {
                this.onDataChannelCloseCallback(peerId);
            }
        };

        dataChannel.onerror = (error) => {
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
}

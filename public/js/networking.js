import * as THREE from 'three';

export function initializeNetworking(clientId, uiElements) {
    let ws = null;
    let wsRetryAttempts = 0;
    const wsMaxRetries = 10;
    const wsRetryInterval = 5000;
    const peers = new Map();
    const avatars = new Map();

    function updateStatus(msg) {
        const timestamp = new Date().toLocaleTimeString();
        uiElements.statusEl.innerHTML += `[${timestamp}] ${msg}<br>`;
        uiElements.statusEl.scrollTop = uiElements.statusEl.scrollHeight;
        console.log(`[${timestamp}] ${msg}`);
    }

    function updateConnectionStatus(status, message) {
        uiElements.connectionStatusEl.className = `status-${status}`;
        uiElements.connectionStatusEl.innerHTML = message;
    }

    function updatePeerInfo() {
        const connectedPeers = Array.from(peers.values()).filter(p => p.state === 'connected');
        uiElements.peerInfoEl.innerHTML = `P2P Connections: ${connectedPeers.length}/${peers.size}<br>Avatars: ${avatars.size}`;
        uiElements.joinBtn.disabled = peers.size > 0;
        uiElements.addBtn.disabled = !peers.size || avatars.get('serverBox');
        uiElements.removeBtn.disabled = !peers.size || !avatars.get('serverBox');
    }

    function connectToServer() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
        ws = new WebSocket('wss://multiplayer-game-dcwy.onrender.com');
        ws.onopen = () => {
            updateStatus("✅ Connected to server");
            updateConnectionStatus('connected', '✅ Server Connected');
            uiElements.joinBtn.disabled = false;
            wsRetryAttempts = 0;
        };
        ws.onclose = (event) => {
            updateStatus(`❌ Server disconnected (${event.code})`);
            updateConnectionStatus('disconnected', '❌ Server Disconnected');
            attemptWsReconnect();
        };
        ws.onerror = (error) => {
            updateStatus(`❌ Server error: ${error}`);
            updateConnectionStatus('disconnected', '❌ Server Error');
        };
        ws.onmessage = async (event) => {
            let messageData = event.data instanceof Blob ? await event.data.text() : event.data;
            let data;
            try {
                data = JSON.parse(messageData);
            } catch (error) {
                updateStatus(`❌ Invalid server message: ${error.message}`);
                return;
            }
            updateStatus(`📥 Server: ${data.type}`);
            switch (data.type) {
                case 'welcome':
                    updateStatus(`🎉 ${data.message}`);
                    break;
                case 'webrtc_offer':
                    await handleWebRTCOffer(data.payload);
                    break;
                case 'webrtc_answer':
                    await handleWebRTCAnswer(data.payload);
                    break;
                case 'webrtc_ice_candidate':
                    await handleWebRTCIceCandidate(data.payload);
                    break;
                case 'chunk_state_change':
                    handleChunkStateChange(data.payload);
                    break;
                default:
                    updateStatus(`❓ Unknown server message: ${data.type}`);
            }
        };
    }

    function attemptWsReconnect() {
        if (wsRetryAttempts < wsMaxRetries) {
            wsRetryAttempts++;
            updateStatus(`Attempting server reconnect... (${wsRetryAttempts}/${wsMaxRetries})`);
            setTimeout(connectToServer, wsRetryInterval);
        } else {
            updateStatus("❌ Max server reconnection attempts reached. Please refresh.");
        }
    }

    function createPeerConnection(peerId, isInitiator = false) {
        updateStatus(`Creating ${isInitiator ? 'outgoing' : 'incoming'} P2P connection to ${peerId}`);
        const config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
        const connection = new RTCPeerConnection(config);
        const peerState = {
            connection,
            dataChannel: null,
            state: 'connecting',
            isInitiator,
            targetPosition: null,
            moveStartTime: null
        };
        peers.set(peerId, peerState);

        connection.onicecandidate = (event) => {
            if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
                sendServerMessage('webrtc_ice_candidate', {
                    recipientId: peerId,
                    senderId: clientId,
                    candidate: event.candidate
                });
            }
        };

        connection.onconnectionstatechange = () => {
            const state = connection.connectionState;
            updateStatus(`P2P ${peerId}: ${state}`);
            peerState.state = state;
            if (state === 'connected') {
                updateStatus(`✅ P2P connected to ${peerId}`);
            } else if (state === 'failed' || state === 'closed' || state === 'disconnected') {
                updateStatus(`❌ P2P ${state} with ${peerId}`);
            }
            updatePeerInfo();
        };

        if (isInitiator) {
            const dataChannel = connection.createDataChannel('game', { ordered: true });
            setupDataChannel(dataChannel, peerId);
            peerState.dataChannel = dataChannel;
        } else {
            connection.ondatachannel = (event) => {
                const dataChannel = event.channel;
                setupDataChannel(dataChannel, peerId);
                peerState.dataChannel = dataChannel;
            };
        }
        return connection;
    }

    function setupDataChannel(channel, peerId) {
        channel.onopen = () => {
            updateStatus(`📡 Data channel open with ${peerId}`);
            const peer = peers.get(peerId);
            if (peer) peer.state = 'connected';
            updatePeerInfo();
        };
        channel.onclose = () => {
            updateStatus(`📡 Data channel closed with ${peerId}`);
            const peer = peers.get(peerId);
            if (peer) peer.state = 'disconnected';
            updatePeerInfo();
        };
        channel.onerror = (error) => {
            updateStatus(`❌ Data channel error with ${peerId}: ${error}`);
        };
        channel.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                handleP2PMessage(message, peerId);
            } catch (error) {
                updateStatus(`❌ Invalid P2P message from ${peerId}`);
            }
        };
    }

    function handleP2PMessage(message, fromPeer) {
        switch (message.type) {
            case 'player_move':
                const peer = peers.get(fromPeer);
                const avatar = avatars.get(fromPeer);
                if (peer && avatar) {
                    avatar.position.fromArray(message.payload.start);
                    peer.targetPosition = new THREE.Vector3().fromArray(message.payload.target);
                    peer.moveStartTime = performance.now();
                    updateStatus(`🕺 Avatar for ${fromPeer} is now moving`);
                }
                break;
            default:
                updateStatus(`❓ Unknown P2P message type: ${message.type}`);
        }
    }

    async function handleWebRTCOffer(payload) {
        const { senderId, offer } = payload;
        if (!senderId || !offer) return;
        const connection = createPeerConnection(senderId, false);
        try {
            await connection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            sendServerMessage('webrtc_answer', {
                recipientId: senderId,
                senderId: clientId,
                answer: connection.localDescription
            });
        } catch (error) {
            updateStatus(`❌ WebRTC offer handling failed: ${error}`);
            cleanupPeer(senderId);
        }
    }

    async function handleWebRTCAnswer(payload) {
        const { senderId, answer } = payload;
        if (!senderId || !answer) return;
        const peer = peers.get(senderId);
        if (!peer) {
            updateStatus(`❌ No peer connection for answer from ${senderId}`);
            return;
        }
        try {
            await peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (error) {
            updateStatus(`❌ WebRTC answer handling failed: ${error}`);
            cleanupPeer(senderId);
        }
    }

    async function handleWebRTCIceCandidate(payload) {
        const { senderId, candidate } = payload;
        if (!senderId || !candidate) return;
        const peer = peers.get(senderId);
        if (!peer) {
            updateStatus(`❌ No peer connection for ICE from ${senderId}`);
            return;
        }
        try {
            await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
            updateStatus(`❌ ICE candidate failed: ${error}`);
        }
    }

    function cleanupPeer(peerId) {
        const peer = peers.get(peerId);
        if (peer) {
            if (peer.connection) peer.connection.close();
            peers.delete(peerId);
            updateStatus(`🧹 Cleaned up peer ${peerId}`);
        }
        const avatar = avatars.get(peerId);
        if (avatar) {
            avatars.delete(peerId);
            updateStatus(`👋 Avatar for ${peerId} removed.`);
        }
        updatePeerInfo();
    }

    function broadcastP2P(message) {
        let sentCount = 0;
        peers.forEach((peer, peerId) => {
            if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
                try {
                    peer.dataChannel.send(JSON.stringify(message));
                    sentCount++;
                } catch (error) {
                    updateStatus(`❌ Failed to send P2P to ${peerId}: ${error}`);
                }
            }
        });
        return sentCount;
    }

    function sendServerMessage(type, payload) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            updateStatus("❌ Cannot send - server disconnected");
            updateConnectionStatus('disconnected', '❌ Server Disconnected');
            return false;
        }
        try {
            ws.send(JSON.stringify({ type, payload }));
            updateStatus(`📤 Sent to server: ${type}`);
            return true;
        } catch (error) {
            updateStatus(`❌ Failed to send message: ${error}`);
            return false;
        }
    }

    async function handleChunkStateChange(payload) {
        const chunkState = payload.state;
        if (!chunkState) return;
        updateStatus(`🏠 Chunk update: ${chunkState.players.length} players, box: ${chunkState.boxPresent}`);
        const otherPlayers = chunkState.players.filter(p => p.id !== clientId);
        peers.forEach((peer, peerId) => {
            if (!otherPlayers.some(p => p.id === peerId)) {
                updateStatus(`👋 Player ${peerId} left chunk`);
                cleanupPeer(peerId);
            }
        });
        for (const player of otherPlayers) {
            if (!peers.has(player.id)) {
                const shouldInitiate = clientId < player.id;
                if (shouldInitiate) {
                    await initiateConnection(player.id);
                }
            }
            if (!avatars.has(player.id)) {
                const geometry = new THREE.SphereGeometry(1, 32, 32);
                const material = new THREE.MeshBasicMaterial({ color: Math.random() * 0xffffff });
                const avatar = new THREE.Mesh(geometry, material);
                avatars.set(player.id, avatar);
                updateStatus(`🟢 Avatar for ${player.id} added.`);
            }
        }
        updatePeerInfo();
    }

    async function initiateConnection(peerId) {
        updateStatus(`🤝 Initiating connection to ${peerId}`);
        const connection = createPeerConnection(peerId, true);
        try {
            const offer = await connection.createOffer();
            await connection.setLocalDescription(offer);
            sendServerMessage('webrtc_offer', {
                recipientId: peerId,
                senderId: clientId,
                offer: connection.localDescription
            });
        } catch (error) {
            updateStatus(`❌ Failed to create offer for ${peerId}: ${error}`);
            cleanupPeer(peerId);
        }
    }

    return { connectToServer, sendServerMessage, peers, avatars, handleChunkStateChange };
}
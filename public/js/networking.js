import * as THREE from 'three';

export function initializeNetworking(clientId, uiElements) {
    let ws = null;
    let wsRetryAttempts = 0;
    const wsMaxRetries = 10;
    const wsRetryInterval = 5000;
    const peers = new Map();
    const avatars = new Map();
    let handleChunkStateChangeCallback = null;

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
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        updateConnectionStatus('retrying', `Connecting... Attempt ${wsRetryAttempts + 1}`);
        ws = new WebSocket('ws://localhost:8080');

        ws.onopen = () => {
            updateStatus('✅ Connected to server.');
            updateConnectionStatus('connected', 'Connected');
            wsRetryAttempts = 0;
        };

        ws.onmessage = async (event) => {
            const message = JSON.parse(event.data);
            switch (message.type) {
                case 'welcome':
                    updateStatus(message.message);
                    break;
                case 'chunk_state_change':
                    if (handleChunkStateChangeCallback) {
                        handleChunkStateChangeCallback(message.payload);
                    }
                    if (message.payload.state.players) {
                        await updatePeerConnections(message.payload.state.players);
                    }
                    break;
                case 'webrtc_offer':
                    await handleOffer(message.payload);
                    break;
                case 'webrtc_answer':
                    await handleAnswer(message.payload);
                    break;
                case 'webrtc_ice_candidate':
                    await handleIceCandidate(message.payload);
                    break;
                case 'error':
                    updateStatus(`⚠️ Server error: ${message.message}`);
                    break;
                default:
                    updateStatus(`⚠️ Unknown server message type: ${message.type}`);
            }
        };

        ws.onclose = (event) => {
            updateStatus(`❌ Disconnected from server: ${event.code}`);
            updateConnectionStatus('disconnected', 'Disconnected');
            if (wsRetryAttempts < wsMaxRetries) {
                wsRetryAttempts++;
                setTimeout(connectToServer, wsRetryInterval);
            }
        };

        ws.onerror = (error) => {
            updateStatus(`❌ WebSocket error: ${error.message}`);
            ws.close();
        };
    }

    function sendServerMessage(type, payload) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            const message = { type, payload };
            ws.send(JSON.stringify(message));
            return true;
        } else {
            updateStatus('❌ Cannot send message: Not connected to server.');
            return false;
        }
    }

    function createPeerConnection(peerId, isInitiator = false) {
        updateStatus(`Creating peer connection for ${peerId}, initiator: ${isInitiator}`);
        const connection = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        
        connection.onicecandidate = (event) => {
            if (event.candidate) {
                sendServerMessage('webrtc_ice_candidate', {
                    recipientId: peerId,
                    senderId: clientId,
                    candidate: event.candidate
                });
            }
        };

        connection.onconnectionstatechange = () => {
            updateStatus(`Peer ${peerId} state: ${connection.connectionState}`);
            if (connection.connectionState === 'disconnected' || connection.connectionState === 'closed') {
                cleanupPeer(peerId);
            }
            updatePeerInfo();
        };

        const dataChannel = connection.createDataChannel("chat");
        dataChannel.onopen = () => {
            updateStatus(`✅ Data channel opened with ${peerId}`);
            updatePeerInfo();
        };
        dataChannel.onmessage = (event) => {
            const message = JSON.parse(event.data);
            updateStatus(`📦 P2P from ${peerId}: ${JSON.stringify(message)}`);
        };
        dataChannel.onclose = () => {
            updateStatus(`❌ Data channel with ${peerId} closed`);
            cleanupPeer(peerId);
        };

        const peerInfo = { connection, dataChannel, state: 'connecting' };
        peers.set(peerId, peerInfo);
        updatePeerInfo();
        return connection;
    }

    async function handleOffer(payload) {
        const { senderId, offer } = payload;
        updateStatus(`Received offer from ${senderId}`);
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
            updateStatus(`❌ Failed to handle offer from ${senderId}: ${error}`);
            cleanupPeer(senderId);
        }
    }

    async function handleAnswer(payload) {
        const { senderId, answer } = payload;
        const peer = peers.get(senderId);
        if (peer && peer.connection.signalingState !== 'stable') {
            try {
                await peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
                updateStatus(`✅ Answer received from ${senderId}`);
            } catch (error) {
                updateStatus(`❌ Failed to handle answer from ${senderId}: ${error}`);
                cleanupPeer(senderId);
            }
        }
    }

    async function handleIceCandidate(payload) {
        const { senderId, candidate } = payload;
        const peer = peers.get(senderId);
        if (peer) {
            try {
                await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                updateStatus(`❌ Failed to add ICE candidate from ${senderId}: ${error}`);
            }
        }
    }
    
    function cleanupPeer(peerId) {
        const peer = peers.get(peerId);
        if (peer) {
            peer.connection.close();
            peers.delete(peerId);
            avatars.delete(peerId);
        }
        updateStatus(`Peer ${peerId} cleaned up.`);
        updatePeerInfo();
    }

    async function updatePeerConnections(players) {
        const otherPlayers = players.filter(p => p.id !== clientId);
        const playerIds = new Set(otherPlayers.map(p => p.id));
        peers.forEach((peer, peerId) => {
            if (!playerIds.has(peerId)) {
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
    
    function setChunkHandler(callback) {
        handleChunkStateChangeCallback = callback;
    }

    return { 
        connectToServer, 
        sendServerMessage, 
        peers, 
        avatars,
        setChunkHandler // Export the new function
    };
}
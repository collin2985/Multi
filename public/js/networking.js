import * as THREE from 'three';

export function initializeNetworking(clientId, uiElements, handleChunkStateChange) {
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
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        updateConnectionStatus('connecting', 'Connecting...');
        ws = new WebSocket('ws://localhost:8080');

        ws.onopen = () => {
            updateStatus('✅ WebSocket connection established.');
            updateConnectionStatus('connected', 'Connected');
            wsRetryAttempts = 0;
        };

        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            handleServerMessage(message);
        };

        ws.onclose = (event) => {
            updateStatus(`❌ WebSocket connection closed: ${event.code} ${event.reason}`);
            updateConnectionStatus('disconnected', 'Disconnected');
            cleanupPeers();
            if (wsRetryAttempts < wsMaxRetries) {
                wsRetryAttempts++;
                updateStatus(`Retrying connection in ${wsRetryInterval / 1000}s... (Attempt ${wsRetryAttempts})`);
                setTimeout(connectToServer, wsRetryInterval);
            } else {
                updateStatus('Max retries reached. Please refresh.');
            }
        };

        ws.onerror = (error) => {
            updateStatus(`❌ WebSocket error: ${error.message}`);
        };
    }

    function sendServerMessage(type, payload) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            const message = { type, payload };
            ws.send(JSON.stringify(message));
            return true;
        } else {
            updateStatus(`❌ Cannot send message: ${type}. WebSocket is not open.`);
            return false;
        }
    }
    
    function handleServerMessage(message) {
        const { type, payload } = message;
        updateStatus(`🌐 Received: ${type}`);

        switch (type) {
            case 'welcome':
                // Initial message, maybe set up client ID
                break;
            case 'chunk_state_change':
                handleChunkStateChange(payload);
                break;
            case 'webrtc_offer':
                handleWebRTCOffer(payload);
                break;
            case 'webrtc_answer':
                handleWebRTCAnswer(payload);
                break;
            case 'webrtc_ice_candidate':
                handleIceCandidate(payload);
                break;
            default:
                updateStatus(`⚠️ Unknown message type from server: ${type}`);
        }
    }

    function handleWebRTCOffer(payload) {
        const { senderId, offer } = payload;
        updateStatus(`💌 Received offer from ${senderId}`);
        const connection = createPeerConnection(senderId, false);
        connection.setRemoteDescription(new RTCSessionDescription(offer))
            .then(() => connection.createAnswer())
            .then(answer => connection.setLocalDescription(answer))
            .then(() => {
                sendServerMessage('webrtc_answer', {
                    recipientId: senderId,
                    senderId: clientId,
                    answer: connection.localDescription
                });
            })
            .catch(e => updateStatus(`❌ Failed to handle offer from ${senderId}: ${e}`));
    }
    
    function handleWebRTCAnswer(payload) {
        const { senderId, answer } = payload;
        updateStatus(`🤝 Received answer from ${senderId}`);
        const connection = peers.get(senderId);
        if (connection) {
            connection.setRemoteDescription(new RTCSessionDescription(answer))
                .catch(e => updateStatus(`❌ Failed to set remote description for ${senderId}: ${e}`));
        }
    }

    function handleIceCandidate(payload) {
        const { senderId, candidate } = payload;
        const connection = peers.get(senderId);
        if (connection) {
            connection.addIceCandidate(new RTCIceCandidate(candidate))
                .catch(e => updateStatus(`❌ Failed to add ICE candidate for ${senderId}: ${e}`));
        }
    }

    function createPeerConnection(peerId, isInitiator) {
        const config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        };
        const connection = new RTCPeerConnection(config);
        peers.set(peerId, connection);

        if (isInitiator) {
            connection.dataChannel = connection.createDataChannel('data');
            setupDataChannelEvents(connection.dataChannel, peerId);
        } else {
            connection.ondatachannel = (event) => {
                connection.dataChannel = event.channel;
                setupDataChannelEvents(connection.dataChannel, peerId);
            };
        }

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
            updatePeerInfo();
        };

        return connection;
    }

    function setupDataChannelEvents(dataChannel, peerId) {
        dataChannel.onopen = () => updateStatus(`✅ Data channel opened with ${peerId}.`);
        dataChannel.onclose = () => updateStatus(`❌ Data channel closed with ${peerId}.`);
        dataChannel.onerror = (e) => updateStatus(`❌ Data channel error with ${peerId}: ${e}.`);
        dataChannel.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'player_update' && avatars.has(peerId)) {
                    const avatar = avatars.get(peerId);
                    avatar.position.copy(message.payload.position);
                    avatar.rotation.copy(message.payload.rotation);
                }
            } catch (error) {
                updateStatus(`❌ Failed to parse P2P message from ${peerId}: ${error}`);
            }
        };
    }

    function cleanupPeers() {
        peers.forEach(peer => {
            peer.close();
        });
        peers.clear();
        avatars.clear();
        updatePeerInfo();
    }
    
    function findOtherPlayers(players, myId) {
        return players.filter(p => p.id !== myId);
    }

    function updatePeerConnections(chunkState) {
        const otherPlayers = findOtherPlayers(chunkState.players, clientId);
        peers.forEach((peer, peerId) => {
            if (!otherPlayers.some(p => p.id === peerId)) {
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

return { connectToServer, sendServerMessage, peers, avatars };
}
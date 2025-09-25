// game.js


import * as THREE from 'three';
import { SimpleTerrainRenderer } from './terrain/SimpleTerrainRenderer.js';
import { ui } from './ui.js';
import { WaterRenderer } from './WaterRenderer.js';

// --- GLOBAL STATE ---
const clientId = 'client_' + Math.random().toString(36).substr(2, 12);
let isInChunk = false;
let boxInScene = false;
const peers = new Map();
let terrainRenderer = null;
const avatars = new Map();
let currentPlayerChunkX = 0;
let currentPlayerChunkZ = 0;
let lastChunkX = null;
let lastChunkZ = null;

const loadRadius = 1; // How many chunks to load around player
let lastChunkUpdateTime = 0;
const chunkUpdateInterval = 1000; // Check every second
let chunkLoadQueue = [];
let isProcessingChunks = false;
const terrainSeed = 12345; // Fixed, client-side terrain seed
let initialChunksLoaded = false;
let waterRenderer = null;

// Click-to-move state
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const playerTargetPosition = new THREE.Vector3();
let isMoving = false;

// --- WEBSOCKET RECONNECTION STATE ---
let ws = null;
let wsRetryAttempts = 0;
const wsMaxRetries = 10;
const wsRetryInterval = 5000;

// --- THREE.JS SCENE SETUP ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000011);
document.body.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(10, 10, 5);
scene.add(directionalLight);

const playerObject = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0x0000ff })
);
playerObject.position.set(0, 5, 0);
scene.add(playerObject);

const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0x00ff00 })
);
box.position.set(0, 0, -3);
box.name = 'serverBox';

terrainRenderer = new SimpleTerrainRenderer(scene);
waterRenderer = new WaterRenderer(scene, 1, terrainRenderer); // Pass terrainRenderer

// --- CLICK-TO-MOVE HANDLER ---
window.addEventListener('pointerdown', onPointerDown);

function onPointerDown(event) {
    if (event.target.tagName !== 'CANVAS') return;

    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = - (event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);

    const terrainObjects = Array.from(terrainRenderer.terrainChunks.values());
    const intersects = raycaster.intersectObjects(terrainObjects, true);

    if (intersects.length > 0) {
        const intersect = intersects[0];
        playerTargetPosition.copy(intersect.point);
        isMoving = true;
        ui.updateStatus(`🚀 Moving to clicked position: (${playerTargetPosition.x.toFixed(2)}, ${playerTargetPosition.z.toFixed(2)})`);

        broadcastP2P({
            type: 'player_move',
            payload: {
                start: playerObject.position.toArray(),
                target: playerTargetPosition.toArray()
            }
        });
    }
}

function attemptWsReconnect() {
    if (wsRetryAttempts < wsMaxRetries) {
        wsRetryAttempts++;
        ui.updateStatus(`Attempting reconnection ${wsRetryAttempts} of ${wsMaxRetries}...`);
        setTimeout(() => {
            connectToServer();
        }, wsRetryInterval);
    } else {
        ui.updateStatus(`❌ Max reconnection attempts reached. Please refresh.`);
        ui.updateConnectionStatus('disconnected', '❌ Disconnected');
    }
}

// --- WEBSOCKET CONNECTION ---
function connectToServer() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }

    ws = new WebSocket('wss://multiplayer-game-dcwy.onrender.com');

    ws.onopen = () => {
        ui.updateStatus("✅ Connected to server");
        ui.updateConnectionStatus('connected', '✅ Server Connected');
        ui.updateButtonStates(isInChunk, boxInScene);
        wsRetryAttempts = 0;
        // Send join_chunk with initial chunk
        const chunkSize = 50;
        const initialChunkX = Math.floor((playerObject.position.x + chunkSize/2) / chunkSize);
        const initialChunkZ = Math.floor((playerObject.position.z + chunkSize/2) / chunkSize);
        const chunkId = `chunk_${initialChunkX}_${initialChunkZ}`;
        const success = sendServerMessage('join_chunk', { chunkId, clientId });
        if (success) {
            isInChunk = true;
            currentPlayerChunkX = initialChunkX;
            currentPlayerChunkZ = initialChunkZ;
            lastChunkX = initialChunkX;
            lastChunkZ = initialChunkZ;
            ui.updateButtonStates(isInChunk, boxInScene);
        }
        updateChunksAroundPlayer(initialChunkX, initialChunkZ);
    };

    ws.onclose = (event) => {
        ui.updateStatus(`❌ Server disconnected (${event.code})`);
        ui.updateConnectionStatus('disconnected', '❌ Server Disconnected');
        isInChunk = false;
        ui.updateButtonStates(isInChunk, boxInScene);
        attemptWsReconnect();
    };

    ws.onerror = (error) => {
        ui.updateStatus(`❌ Server error: ${error}`);
        ui.updateConnectionStatus('disconnected', '❌ Server Error');
    };

    ws.onmessage = async function(event) {
        let messageData;

        if (event.data instanceof Blob) {
            messageData = await event.data.text();
        } else {
            messageData = event.data;
        }

        let data;
        try {
            data = JSON.parse(messageData);
        } catch (error) {
            ui.updateStatus(`❌ Invalid server message: ${error.message}`);
            return;
        }

        ui.updateStatus(`📥 Server: ${data.type}`);

        switch (data.type) {
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
            case 'proximity_update':
                handleProximityUpdate(data.payload);
                break;
            default:
                ui.updateStatus(`❓ Unknown server message type: ${data.type}`);
        }
    };
}

function sendServerMessage(type, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const message = { type, payload };
        ws.send(JSON.stringify(message));
        ui.updateStatus(`📤 Sent ${type} to server`);
        return true;
    }
    ui.updateStatus(`❌ Failed to send ${type}: No server connection`);
    return false;
}

// --- WEBRTC P2P ---
function createPeerConnection(peerId, isInitiator = false) {
    ui.updateStatus(`Creating ${isInitiator ? 'outgoing' : 'incoming'} P2P connection to ${peerId}`);
    const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
    const connection = new RTCPeerConnection(config);
    let dataChannel = null;
    const peerState = { connection, dataChannel: null, state: 'connecting', isInitiator, targetPosition: null, moveStartTime: null };
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
        ui.updateStatus(`P2P ${peerId}: ${state}`);
        peerState.state = state;
        if (state === 'connected') {
            ui.updateStatus(`✅ P2P connected to ${peerId}`);
        } else if (state === 'failed' || state === 'closed' || state === 'disconnected') {
            ui.updateStatus(`❌ P2P ${state} with ${peerId}`);
        }
        ui.updatePeerInfo(peers, avatars);
    };

    if (isInitiator) {
        dataChannel = connection.createDataChannel('game', { ordered: true });
        setupDataChannel(dataChannel, peerId);
        peerState.dataChannel = dataChannel;
    } else {
        connection.ondatachannel = (event) => {
            dataChannel = event.channel;
            setupDataChannel(dataChannel, peerId);
            peerState.dataChannel = dataChannel;
        };
    }

    return connection;
}

function setupDataChannel(dataChannel, peerId) {
    dataChannel.onopen = () => {
        ui.updateStatus(`P2P data channel opened with ${peerId}`);
        // Send current position and target on open
        const syncMessage = {
            type: 'player_sync',
            payload: {
                position: playerObject.position.toArray(),
                target: isMoving ? playerTargetPosition.toArray() : null
            }
        };
        try {
            dataChannel.send(JSON.stringify(syncMessage));
            ui.updateStatus(`📤 Sent player_sync to ${peerId}`);
        } catch (error) {
            ui.updateStatus(`❌ Failed to send player_sync to ${peerId}: ${error}`);
        }
        ui.updatePeerInfo(peers, avatars);
    };

    dataChannel.onclose = () => {
        ui.updateStatus(`P2P data channel closed with ${peerId}`);
        ui.updatePeerInfo(peers, avatars);
    };

    dataChannel.onmessage = (event) => {
        let message;
        try {
            message = JSON.parse(event.data);
        } catch (error) {
            ui.updateStatus(`❌ Invalid P2P message from ${peerId}: ${error.message}`);
            return;
        }
        handleP2PMessage(message, peerId);
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
                ui.updateStatus(`🕺 Avatar for ${fromPeer} is now moving`);
            }
            break;
        case 'player_sync':
            const syncPeer = peers.get(fromPeer);
            const syncAvatar = avatars.get(fromPeer);
            if (syncPeer && syncAvatar) {
                syncAvatar.position.fromArray(message.payload.position);
                if (message.payload.target) {
                    syncPeer.targetPosition = new THREE.Vector3().fromArray(message.payload.target);
                    syncPeer.moveStartTime = performance.now();
                    ui.updateStatus(`📍 Synced ${fromPeer} to ${message.payload.position}, moving to ${message.payload.target}`);
                } else {
                    ui.updateStatus(`📍 Synced ${fromPeer} to ${message.payload.position}`);
                }
            }
            break;
        default:
            ui.updateStatus(`❓ Unknown P2P message type: ${message.type}`);
    }
}

async function initiateConnection(peerId) {
    const connection = createPeerConnection(peerId, true);
    try {
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        sendServerMessage('webrtc_offer', {
            recipientId: peerId,
            senderId: clientId,
            offer
        });
    } catch (error) {
        ui.updateStatus(`❌ Failed to create offer for ${peerId}: ${error}`);
    }
}

async function handleWebRTCOffer(payload) {
    if (payload.recipientId !== clientId) return;
    const peerId = payload.senderId;
    const connection = createPeerConnection(peerId, false);
    try {
        await connection.setRemoteDescription(new RTCSessionDescription(payload.offer));
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        sendServerMessage('webrtc_answer', {
            recipientId: peerId,
            senderId: clientId,
            answer
        });
    } catch (error) {
        ui.updateStatus(`❌ Failed to handle offer from ${peerId}: ${error}`);
    }
}

async function handleWebRTCAnswer(payload) {
    if (payload.recipientId !== clientId) return;
    const peerId = payload.senderId;
    const peer = peers.get(peerId);
    if (peer && peer.connection) {
        try {
            await peer.connection.setRemoteDescription(new RTCSessionDescription(payload.answer));
        } catch (error) {
            ui.updateStatus(`❌ Failed to handle answer from ${peerId}: ${error}`);
        }
    }
}

async function handleWebRTCIceCandidate(payload) {
    if (payload.recipientId !== clientId) return;
    const peerId = payload.senderId;
    const peer = peers.get(peerId);
    if (peer && peer.connection) {
        try {
            await peer.connection.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch (error) {
            ui.updateStatus(`❌ Failed to add ICE candidate from ${peerId}: ${error}`);
        }
    }
}

function cleanupPeer(peerId) {
    const peer = peers.get(peerId);
    if (peer) {
        if (peer.dataChannel) {
            peer.dataChannel.close();
        }
        if (peer.connection) {
            peer.connection.close();
        }
        peers.delete(peerId);
    }
    const avatar = avatars.get(peerId);
    if (avatar) {
        scene.remove(avatar);
        avatar.geometry.dispose();
        avatar.material.dispose();
        avatars.delete(peerId);
    }
    ui.updatePeerInfo(peers, avatars);
}

function broadcastP2P(message) {
    let sentCount = 0;
    peers.forEach((peer, peerId) => {
        if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
            try {
                peer.dataChannel.send(JSON.stringify(message));
                sentCount++;
            } catch (error) {
                ui.updateStatus(`❌ Failed to send P2P to ${peerId}: ${error}`);
            }
        }
    });
    return sentCount;
}

function handleChunkStateChange(payload) {
    const chunkState = payload.state;
    ui.updateStatus(`🏠 Chunk update: ${chunkState.players.length} players, box: ${chunkState.boxPresent}`);
    const parts = payload.chunkId.split('_');
    const chunkX = parseInt(parts[1]) * 50;
    const chunkZ = parseInt(parts[2]) * 50;
    terrainRenderer.addTerrainChunk({ chunkX, chunkZ, seed: terrainSeed });
    boxInScene = chunkState.boxPresent; // Update boxInScene
    ui.updateButtonStates(isInChunk, boxInScene);
    ui.updatePeerInfo(peers, avatars);
}

function handleProximityUpdate(payload) {
    const players = payload.players; // Array of { id, chunkId }
    ui.updateStatus(`📍 Proximity update: ${players.length} players`);

    // Remove peers and avatars not in the new list
    const currentPeerIds = new Set(players.map(p => p.id));
    peers.forEach((_, peerId) => {
        if (!currentPeerIds.has(peerId) && peerId !== clientId) {
            ui.updateStatus(`👋 Player ${peerId} left proximity`);
            cleanupPeer(peerId);
        }
    });

    // Queue new peers for staggered initiation
    const newPlayers = players.filter(player => player.id !== clientId && !peers.has(player.id));
    if (newPlayers.length > 0) {
        ui.updateStatus(`Queuing ${newPlayers.length} new P2P connections for staggering`);
        staggerP2PInitiations(newPlayers);
    }

    ui.updatePeerInfo(peers, avatars);
}

// NEW: Stagger P2P initiations to reduce lag
function staggerP2PInitiations(newPlayers) {
    newPlayers.forEach((player, index) => {
        setTimeout(() => {
            const shouldInitiate = clientId < player.id;
            if (shouldInitiate) {
                initiateConnection(player.id);
                ui.updateStatus(`Initiating staggered P2P to ${player.id}`);
            }
            const geometry = new THREE.SphereGeometry(1, 32, 32);
            const material = new THREE.MeshBasicMaterial({ color: Math.random() * 0xffffff });
            const avatar = new THREE.Mesh(geometry, material);
            scene.add(avatar);
            avatars.set(player.id, avatar);
            ui.updateStatus(`🟢 Avatar for ${player.id} added at (0,0,0)`);
        }, index * 750); // 150ms delay per connection
    });
}

function updateChunksAroundPlayer(chunkX, chunkZ) {
    const chunkSize = 50;
    const shouldLoad = new Set();
    for (let x = chunkX - loadRadius; x <= chunkX + loadRadius; x++) {
        for (let z = chunkZ - loadRadius; z <= chunkZ + loadRadius; z++) {
            shouldLoad.add(`${x},${z}`);
        }
    }

    const currentChunks = new Set(terrainRenderer.terrainChunks.keys());
    for (const chunkKey of currentChunks) {
        if (!shouldLoad.has(chunkKey)) {
            const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
            terrainRenderer.removeTerrainChunk({ chunkX: chunkX * chunkSize, chunkZ: chunkZ * chunkSize });
            ui.updateStatus(`Unloaded chunk (${chunkX}, ${chunkZ})`);
        }
    }

    for (const chunkKey of shouldLoad) {
        if (!currentChunks.has(chunkKey)) {
            const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
            chunkLoadQueue.push({
                chunkX: chunkX * chunkSize,
                chunkZ: chunkZ * chunkSize,
                seed: terrainSeed
            });
        }
    }

    if (isInChunk && (chunkX !== lastChunkX || chunkZ !== lastChunkZ)) {
        const newChunkId = `chunk_${chunkX}_${chunkZ}`;
        const lastChunkId = lastChunkX !== null ? `chunk_${lastChunkX}_${lastChunkZ}` : null;
        sendServerMessage('chunk_update', {
            clientId,
            newChunkId,
            lastChunkId
        });
        lastChunkX = chunkX;
        lastChunkZ = chunkZ;
    }
}

function processChunkQueue() {
    if (chunkLoadQueue.length > 0 && !isProcessingChunks) {
        isProcessingChunks = true;
        const chunk = chunkLoadQueue.shift();

        terrainRenderer.addTerrainChunk(chunk);
        ui.updateStatus(`Loaded chunk at (${chunk.chunkX/50}, ${chunk.chunkZ/50})`);

        setTimeout(() => {
            isProcessingChunks = false;
        }, 100);
    }
}

// --- ANIMATION LOOP ---
const playerSpeed = 0.1;  //player speed should be 0.005 max to prevent unloaded chunks
const stopThreshold = 0.01;
let lastFrameTime = performance.now();

function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const deltaTime = now - lastFrameTime;
    waterRenderer.update(now);

    if (isMoving) {
        const distance = playerObject.position.distanceTo(playerTargetPosition);

        if (distance <= stopThreshold) {
            playerObject.position.copy(playerTargetPosition);
            isMoving = false;
            ui.updateStatus("🏁 Arrived at destination.");
        } else {
            const moveStep = playerSpeed * deltaTime;
            const alpha = Math.min(1, moveStep / distance);
            playerObject.position.lerp(playerTargetPosition, alpha);
        }
    }

    avatars.forEach((avatar, peerId) => {
        const peer = peers.get(peerId);
        if (peer && peer.targetPosition) {
            const distance = avatar.position.distanceTo(peer.targetPosition);

            if (distance <= stopThreshold) {
                avatar.position.copy(peer.targetPosition);
                peer.targetPosition = null;
                ui.updateStatus(`✅ Avatar for ${peerId} arrived at destination.`);
            } else {
                const moveStep = playerSpeed * deltaTime;
                const alpha = Math.min(1, moveStep / distance);
                avatar.position.lerp(peer.targetPosition, alpha);
            }
        }
    });

    if (now - lastChunkUpdateTime > chunkUpdateInterval) {
        const chunkSize = 50;
        const newChunkX = Math.floor((playerObject.position.x + chunkSize/2) / chunkSize);
        const newChunkZ = Math.floor((playerObject.position.z + chunkSize/2) / chunkSize);

        if (newChunkX !== currentPlayerChunkX || newChunkZ !== currentPlayerChunkZ) {
            currentPlayerChunkX = newChunkX;
            currentPlayerChunkZ = newChunkZ;
            updateChunksAroundPlayer(newChunkX, newChunkZ);
            ui.updateStatus(`Player moved to chunk (${newChunkX}, ${newChunkZ})`);
        }
        lastChunkUpdateTime = now;
    }

    checkAndReconnectPeers();
    processChunkQueue();

    const cameraOffset = new THREE.Vector3(0, 15, 5);  //0, 15, 5 sets a good height
    const cameraTargetPosition = playerObject.position.clone().add(cameraOffset);
    const smoothedCameraPosition = camera.position.lerp(cameraTargetPosition, 0.5);
    camera.position.copy(smoothedCameraPosition);
    camera.lookAt(playerObject.position);

    const serverBox = scene.getObjectByName('serverBox');
    if (serverBox) {
        box.rotation.x += 0.005;
        box.rotation.y += 0.01;
    }

    renderer.render(scene, camera);
    lastFrameTime = now;
}

// --- P2P RECONNECTION LOGIC ---
let lastPeerCheckTime = 0;
const peerCheckInterval = 5000;

function checkAndReconnectPeers() {
    const now = performance.now();
    if (now - lastPeerCheckTime < peerCheckInterval) {
        return;
    }
    lastPeerCheckTime = now;

    const otherPlayers = Array.from(peers.keys());
    for (const peerId of otherPlayers) {
        const peer = peers.get(peerId);
        if (peer && (peer.state === 'disconnected' || peer.state === 'failed')) {
            const shouldInitiate = clientId < peerId;
            if (shouldInitiate) {
                ui.updateStatus(`Attempting P2P reconnect to ${peerId}...`);
                initiateConnection(peerId);
            }
        }
    }
}

// --- INITIALIZATION ---
ui.updateStatus("🎮 Game initialized");
ui.updateConnectionStatus('connecting', '🔄 Connecting...');
ui.initializeUI({
    sendServerMessage: sendServerMessage,
    clientId: clientId,
    onResize: () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
});
connectToServer();
animate();
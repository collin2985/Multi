// game.js
import * as THREE from 'three';
import { SimpleTerrainRenderer } from './terrain.js';
import { ui } from './ui.js'; // NEW: Import the UI module

// --- GLOBAL STATE ---
const clientId = 'client_' + Math.random().toString(36).substr(2, 12);
let isInChunk = false;
let boxInScene = false;
const peers = new Map();
let terrainRenderer = null;
const avatars = new Map();
let currentPlayerChunkX = 0;
let currentPlayerChunkZ = 0;

const loadRadius = 1; // How many chunks to load around player
let lastChunkUpdateTime = 0;
const chunkUpdateInterval = 1000; // Check every second
let chunkLoadQueue = [];
let isProcessingChunks = false;
let terrainSeed = 0;
let initialChunksLoaded = false;

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
            default:
                ui.updateStatus(`❓ Unknown server message: ${data.type}`);
        }
    };
}

function attemptWsReconnect() {
    if (wsRetryAttempts < wsMaxRetries) {
        wsRetryAttempts++;
        ui.updateStatus(`Attempting server reconnect... (${wsRetryAttempts}/${wsMaxRetries})`);
        setTimeout(connectToServer, wsRetryInterval);
    } else {
        ui.updateStatus("❌ Max server reconnection attempts reached. Please refresh.");
    }
}

// --- P2P CONNECTION MANAGEMENT ---
function createPeerConnection(peerId, isInitiator = false) {
    ui.updateStatus(`Creating ${isInitiator ? 'outgoing' : 'incoming'} P2P connection to ${peerId}`);

    const config = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };

    const connection = new RTCPeerConnection(config);
    let dataChannel = null;

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

function setupDataChannel(channel, peerId) {
    channel.onopen = () => {
        ui.updateStatus(`📡 Data channel open with ${peerId}`);
        const peer = peers.get(peerId);
        if (peer) peer.state = 'connected';
        ui.updatePeerInfo(peers, avatars);
    };

    channel.onclose = () => {
        ui.updateStatus(`📡 Data channel closed with ${peerId}`);
        const peer = peers.get(peerId);
        if(peer) peer.state = 'disconnected';
    };

    channel.onerror = (error) => {
        ui.updateStatus(`❌ Data channel error with ${peerId}: ${error}`);
    };

    channel.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            handleP2PMessage(message, peerId);
        } catch (error) {
            ui.updateStatus(`❌ Invalid P2P message from ${peerId}`);
        }
    };
}

function cleanupPeer(peerId) {
    const peer = peers.get(peerId);
    if (peer) {
        if (peer.connection) {
            peer.connection.close();
        }
        peers.delete(peerId);
        ui.updateStatus(`🧹 Cleaned up peer ${peerId}`);
    }
    const avatar = avatars.get(peerId);
    if (avatar) {
        scene.remove(avatar);
        avatars.delete(peerId);
        ui.updateStatus(`👋 Avatar for ${peerId} removed.`);
    }
    ui.updatePeerInfo(peers, avatars);
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
        default:
            ui.updateStatus(`❓ Unknown P2P message type: ${message.type}`);
    }
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

// --- SERVER MESSAGE HANDLING ---
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
        ui.updateStatus(`❌ WebRTC offer handling failed: ${error}`);
        cleanupPeer(senderId);
    }
}

async function handleWebRTCAnswer(payload) {
    const { senderId, answer } = payload;
    if (!senderId || !answer) return;

    const peer = peers.get(senderId);
    if (!peer) {
        ui.updateStatus(`❌ No peer connection for answer from ${senderId}`);
        return;
    }

    try {
        await peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
        ui.updateStatus(`❌ WebRTC answer handling failed: ${error}`);
        cleanupPeer(senderId);
    }
}

async function handleWebRTCIceCandidate(payload) {
    const { senderId, candidate } = payload;
    if (!senderId || !candidate) return;

    const peer = peers.get(senderId);
    if (!peer) {
        ui.updateStatus(`❌ No peer connection for ICE from ${senderId}`);
        return;
    }

    try {
        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
        ui.updateStatus(`❌ ICE candidate failed: ${error}`);
    }
}

async function handleChunkStateChange(payload) {
    const chunkState = payload.state;
    if (!chunkState) return;

    terrainSeed = chunkState.seed || 0;

    if (!initialChunksLoaded) {
        updateChunksAroundPlayer(
            Math.floor(playerObject.position.x / 50),
            Math.floor(playerObject.position.z / 50)
        );
        initialChunksLoaded = true;
    }

    ui.updateStatus(`🏠 Chunk update: ${chunkState.players.length} players, box: ${chunkState.boxPresent}`);

    const parts = payload.chunkId.split('_');
    const chunkX = parseInt(parts[1]) * 50;
    const chunkZ = parseInt(parts[2]) * 50;
    terrainRenderer.addTerrainChunk({ chunkX, chunkZ, seed: terrainSeed });

    if (chunkState.boxPresent) {
        const existingBox = scene.getObjectByName('serverBox');
        if (!existingBox) {
            scene.add(box);
            boxInScene = true;
            ui.updateStatus("📦 Box added to scene (server authority)");
        }
    } else {
        const existingBox = scene.getObjectByName('serverBox');
        if (existingBox) {
            scene.remove(existingBox);
            boxInScene = false;
            ui.updateStatus("📦 Box removed from scene (server authority)");
        }
    }

    const otherPlayers = chunkState.players.filter(p => p.id !== clientId);

    peers.forEach((peer, peerId) => {
        if (!otherPlayers.some(p => p.id === peerId)) {
            ui.updateStatus(`👋 Player ${peerId} left chunk`);
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
            scene.add(avatar);
            avatars.set(player.id, avatar);
            ui.updateStatus(`🟢 Avatar for ${player.id} added.`);
        }
    }

    ui.updateButtonStates(isInChunk, boxInScene);
    ui.updatePeerInfo(peers, avatars);
}

async function initiateConnection(peerId) {
    ui.updateStatus(`🤝 Initiating connection to ${peerId}`);

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
        ui.updateStatus(`❌ Failed to create offer for ${peerId}: ${error}`);
        cleanupPeer(peerId);
    }
}

// --- SERVER COMMUNICATION ---
function sendServerMessage(type, payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        ui.updateStatus("❌ Cannot send - server disconnected");
        ui.updateConnectionStatus('disconnected', '❌ Server Disconnected');
        return false;
    }

    try {
        ws.send(JSON.stringify({ type, payload }));
        ui.updateStatus(`📤 Sent to server: ${type}`);
        return true;
    } catch (error) {
        ui.updateStatus(`❌ Failed to send message: ${error}`);
        return false;
    }
}

function updateChunksAroundPlayer(playerChunkX, playerChunkZ) {
    const chunkSize = 50;

    const shouldLoad = new Set();
    for (let x = playerChunkX - loadRadius; x <= playerChunkX + loadRadius; x++) {
        for (let z = playerChunkZ - loadRadius; z <= playerChunkZ + loadRadius; z++) {
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
const playerSpeed = 0.05;
const stopThreshold = 0.01;
let lastFrameTime = performance.now();

function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const deltaTime = now - lastFrameTime;

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

    const cameraOffset = new THREE.Vector3(-5, 20, 10);
    const cameraTargetPosition = playerObject.position.clone().add(cameraOffset);
    const smoothedCameraPosition = camera.position.lerp(cameraTargetPosition, 0.1);
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
ui.updateStatus("📋 Click 'Join Chunk' to start");
ui.updateConnectionStatus('connecting', '🔄 Connecting...');
ui.initializeUI({
    sendServerMessage: sendServerMessage,
    clientId: clientId,
    onJoinSuccess: () => {
        isInChunk = true;
        ui.updateButtonStates(isInChunk, boxInScene);
    },
    onResize: () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
});
connectToServer();
animate();
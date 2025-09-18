import * as THREE from 'three';
import { SimpleTerrainRenderer } from './terrain.js';

// --- GLOBAL STATE ---
const clientId = 'client_' + Math.random().toString(36).substr(2, 12);
let isInChunk = false;
let boxInScene = false;
const peers = new Map();
let terrainRenderer = null;
const avatars = new Map();
let currentPlayerChunkX = 0;
let currentPlayerChunkZ = 0;
const loadRadius = 2; // How many chunks to load around player
let lastChunkUpdateTime = 0;
const chunkUpdateInterval = 2000; // Check every second
let chunkLoadQueue = [];
let isProcessingChunks = false;
let terrainSeed = 0;
let initialChunksLoaded = false; // NEW: Flag to control initial chunk loading

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

// --- UI ELEMENTS ---
const statusEl = document.getElementById('status');
const connectionStatusEl = document.getElementById('connectionStatus');
const peerInfoEl = document.getElementById('peerInfo');
const joinBtn = document.getElementById('joinChunkBtn');
const addBtn = document.getElementById('addBoxBtn');
const removeBtn = document.getElementById('removeBoxBtn');

function updateStatus(msg) {
    const timestamp = new Date().toLocaleTimeString();
    statusEl.innerHTML += `[${timestamp}] ${msg}<br>`;
    statusEl.scrollTop = statusEl.scrollHeight;
    console.log(`[${timestamp}] ${msg}`);
}

function updateConnectionStatus(status, message) {
    connectionStatusEl.className = `status-${status}`;
    connectionStatusEl.innerHTML = message;
}

function updatePeerInfo() {
    const connectedPeers = Array.from(peers.values()).filter(p => p.state === 'connected');
    peerInfoEl.innerHTML = `P2P Connections: ${connectedPeers.length}/${peers.size}<br>Avatars: ${avatars.size}`;
    updateButtonStates();
}

function updateButtonStates() {
    addBtn.disabled = !isInChunk || boxInScene;
    removeBtn.disabled = !isInChunk || !boxInScene;
}

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
        updateStatus(`🚀 Moving to clicked position: (${playerTargetPosition.x.toFixed(2)}, ${playerTargetPosition.z.toFixed(2)})`);

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
        updateStatus("✅ Connected to server");
        updateConnectionStatus('connected', '✅ Server Connected');
        joinBtn.disabled = false;
        wsRetryAttempts = 0;
    };

    ws.onclose = (event) => {
        updateStatus(`❌ Server disconnected (${event.code})`);
        updateConnectionStatus('disconnected', '❌ Server Disconnected');
        isInChunk = false;
        updateButtonStates();
        attemptWsReconnect();
    };

    ws.onerror = (error) => {
        updateStatus(`❌ Server error: ${error}`);
        updateConnectionStatus('disconnected', '❌ Server Error');
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
            updateStatus(`❌ Invalid server message: ${error.message}`);
            return;
        }

        updateStatus(`📥 Server: ${data.type}`);

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

// --- P2P CONNECTION MANAGEMENT ---
function createPeerConnection(peerId, isInitiator = false) {
    updateStatus(`Creating ${isInitiator ? 'outgoing' : 'incoming'} P2P connection to ${peerId}`);

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
        updateStatus(`📡 Data channel open with ${peerId}`);
        const peer = peers.get(peerId);
        if (peer) peer.state = 'connected';
        updatePeerInfo();
    };

    channel.onclose = () => {
        updateStatus(`📡 Data channel closed with ${peerId}`);
        const peer = peers.get(peerId);
        if(peer) peer.state = 'disconnected';
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

function cleanupPeer(peerId) {
    const peer = peers.get(peerId);
    if (peer) {
        if (peer.connection) {
            peer.connection.close();
        }
        peers.delete(peerId);
        updateStatus(`🧹 Cleaned up peer ${peerId}`);
    }
    const avatar = avatars.get(peerId);
    if (avatar) {
        scene.remove(avatar);
        avatars.delete(peerId);
        updateStatus(`👋 Avatar for ${peerId} removed.`);
    }
    updatePeerInfo();
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

async function handleChunkStateChange(payload) {
    const chunkState = payload.state;
    if (!chunkState) return;

    // Corrected to save the terrain seed
    terrainSeed = chunkState.seed || 0;

    // NEW: Trigger initial chunk loading only once, after receiving the seed
    if (!initialChunksLoaded) {
        updateChunksAroundPlayer(
            Math.floor(playerObject.position.x / 50),
            Math.floor(playerObject.position.z / 50)
        );
        initialChunksLoaded = true;
    }

    updateStatus(`🏠 Chunk update: ${chunkState.players.length} players, box: ${chunkState.boxPresent}`);

    // For simplicity, assuming chunkId is 'chunk_x_z', parse to get chunkX, chunkZ
    const parts = payload.chunkId.split('_');
    const chunkX = parseInt(parts[1]) * 50; // Assuming chunkSize=50
    const chunkZ = parseInt(parts[2]) * 50;
    terrainRenderer.addTerrainChunk({ chunkX, chunkZ, seed: terrainSeed }); // Use the saved seed

    if (chunkState.boxPresent) {
        const existingBox = scene.getObjectByName('serverBox');
        if (!existingBox) {
            scene.add(box);
            boxInScene = true;
            updateStatus("📦 Box added to scene (server authority)");
        }
    } else {
        const existingBox = scene.getObjectByName('serverBox');
        if (existingBox) {
            scene.remove(existingBox);
            boxInScene = false;
            updateStatus("📦 Box removed from scene (server authority)");
        }
    }

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
            scene.add(avatar);
            avatars.set(player.id, avatar);
            updateStatus(`🟢 Avatar for ${player.id} added.`);
        }
    }

    updateButtonStates();
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

// --- SERVER COMMUNICATION ---
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

// --- BUTTON HANDLERS ---
joinBtn.onclick = () => {
    if (sendServerMessage('join_chunk', { chunkId: 'chunk_0_0', clientId })) {
        isInChunk = true;
        joinBtn.disabled = true;
        updateButtonStates();
    }
};

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
            updateStatus(`Unloaded chunk (${chunkX}, ${chunkZ})`);
        }
    }

    for (const chunkKey of shouldLoad) {
        if (!currentChunks.has(chunkKey)) {
            const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
            chunkLoadQueue.push({
                chunkX: chunkX * chunkSize,
                chunkZ: chunkZ * chunkSize,
                seed: terrainSeed // Use the global terrain seed
            });
        }
    }
}

function processChunkQueue() {
    if (chunkLoadQueue.length > 0 && !isProcessingChunks) {
        isProcessingChunks = true;
        const chunk = chunkLoadQueue.shift();

        terrainRenderer.addTerrainChunk(chunk);
        updateStatus(`Loaded chunk at (${chunk.chunkX/50}, ${chunk.chunkZ/50})`);

        setTimeout(() => {
            isProcessingChunks = false;
        }, 16);
    }
}

addBtn.onclick = () => {
    sendServerMessage('add_box_request', {
        chunkId: 'chunk_0_0',
        position: { x: 0, y: 0, z: -3 }
    });
};

removeBtn.onclick = () => {
    sendServerMessage('remove_box_request', { chunkId: 'chunk_0_0' });
};

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
            updateStatus("🏁 Arrived at destination.");
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
                updateStatus(`✅ Avatar for ${peerId} arrived at destination.`);
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
            updateStatus(`Player moved to chunk (${newChunkX}, ${newChunkZ})`);
        }
        lastChunkUpdateTime = now;
    }

    checkAndReconnectPeers();
    processChunkQueue();

    const cameraOffset = new THREE.Vector3(-15, 40, 20);
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
                updateStatus(`Attempting P2P reconnect to ${peerId}...`);
                initiateConnection(peerId);
            }
        }
    }
}

// --- RESIZE HANDLING ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- INITIALIZATION ---
updateStatus("🎮 Game initialized");
updateStatus("📋 Click 'Join Chunk' to start");
updateConnectionStatus('connecting', '🔄 Connecting...');
connectToServer();
animate();
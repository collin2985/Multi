import * as THREE from 'three';
import { ui } from './ui.js';
import { WaterRenderer } from './WaterRenderer.js';
import { SimpleTerrainRenderer, CONFIG, roundCoord } from './terrain.js';
import { objectPlacer } from './objects.js';

// ==========================================
// GAME STATE MANAGEMENT
// ==========================================

class GameState {
    constructor() {
        this.clientId = 'client_' + Math.random().toString(36).substr(2, 12);
        this.isInChunk = false;
        this.currentPlayerChunkX = 0;
        this.currentPlayerChunkZ = 0;
        this.lastChunkX = null;
        this.lastChunkZ = null;

        // Movement state
        this.isMoving = false;
        this.playerTargetPosition = new THREE.Vector3();
        this.cameraTargetPosition = new THREE.Vector3();

        // Object tracking
        this.nearestObject = null;
        this.nearestObjectDistance = Infinity;
        this.removedObjectsCache = new Map(); // Key: chunkKey, Value: Set of removed objectIds

        // Timing
        this.lastChunkUpdateTime = 0;
        this.lastProximityCheckTime = 0;
        this.lastPeerCheckTime = 0;
        this.lastFrameTime = performance.now();
    }

    updateChunkPosition(newX, newZ) {
        this.lastChunkX = this.currentPlayerChunkX;
        this.lastChunkZ = this.currentPlayerChunkZ;
        this.currentPlayerChunkX = newX;
        this.currentPlayerChunkZ = newZ;
    }
}

// ==========================================
// NETWORK MANAGER
// ==========================================

class NetworkManager {
    constructor(gameState, onMessageCallback) {
        this.gameState = gameState;
        this.onMessageCallback = onMessageCallback;
        this.ws = null;
        this.wsRetryAttempts = 0;
        this.wsMaxRetries = 10;
        this.wsRetryInterval = 5000;

        // P2P state
        this.peers = new Map();
        this.avatars = new Map();
    }

connect(online = true) {
    const url = online ? 'wss://multiplayer-game-dcwy.onrender.com' : 'ws://localhost:8080';
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
    }

    this.ws = new WebSocket(url);
    this.setupWebSocketHandlers();
}

    setupWebSocketHandlers() {
        this.ws.onopen = () => {
            ui.updateStatus("✅ Connected to server");
            ui.updateConnectionStatus('connected', '✅ Server Connected');
            this.wsRetryAttempts = 0;
            this.onMessageCallback('server_connected', {});
        };

        this.ws.onclose = (event) => {
            ui.updateStatus(`❌ Server disconnected (${event.code})`);
            ui.updateConnectionStatus('disconnected', '❌ Server Disconnected');
            this.gameState.isInChunk = false;
            ui.updateButtonStates(false, null);
            this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
            ui.updateStatus(`❌ Server error: ${error.message || 'Unknown error'}`);
            ui.updateConnectionStatus('disconnected', '❌ Server Error');
        };

        this.ws.onmessage = async (event) => {
            const messageData = event.data instanceof Blob ?
                await event.data.text() : event.data;

            try {
                const data = JSON.parse(messageData);
                console.log('RAW MESSAGE RECEIVED:', data);
                ui.updateStatus(`📥 Server: ${data.type}`);
                this.onMessageCallback(data.type, data.payload);
            } catch (error) {
                ui.updateStatus(`❌ Invalid server message: ${error.message}`);
            }
        };
    }

    attemptReconnect() {
        if (this.wsRetryAttempts < this.wsMaxRetries) {
            this.wsRetryAttempts++;
            ui.updateStatus(`Attempting reconnection ${this.wsRetryAttempts} of ${this.wsMaxRetries}...`);
            setTimeout(() => this.connect(), this.wsRetryInterval);
        } else {
            ui.updateStatus(`❌ Max reconnection attempts reached. Please refresh.`);
            ui.updateConnectionStatus('disconnected', '❌ Disconnected');
        }
    }

    sendMessage(type, payload) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type, payload }));
            ui.updateStatus(`📤 Sent ${type} to server`);
            return true;
        }
        ui.updateStatus(`❌ Failed to send ${type}: No server connection`);
        return false;
    }

    // --- P2P Methods ---
    createPeerConnection(peerId, isInitiator = false) {
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

        this.peers.set(peerId, peerState);

        connection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendMessage('webrtc_ice_candidate', {
                    recipientId: peerId,
                    senderId: this.gameState.clientId,
                    candidate: event.candidate
                });
            }
        };

        connection.onconnectionstatechange = () => {
            peerState.state = connection.connectionState;
            ui.updateStatus(`P2P ${peerId}: ${connection.connectionState}`);
            ui.updatePeerInfo(this.peers, this.avatars);
        };

        if (isInitiator) {
            const dataChannel = connection.createDataChannel('game', { ordered: true });
            this.setupDataChannel(dataChannel, peerId);
            peerState.dataChannel = dataChannel;
        } else {
            connection.ondatachannel = (event) => {
                this.setupDataChannel(event.channel, peerId);
                peerState.dataChannel = event.channel;
            };
        }

        return connection;
    }

    setupDataChannel(dataChannel, peerId) {
        dataChannel.onopen = () => {
            ui.updateStatus(`P2P data channel opened with ${peerId}`);
            ui.updatePeerInfo(this.peers, this.avatars);
        };

        dataChannel.onclose = () => {
            ui.updateStatus(`P2P data channel closed with ${peerId}`);
            ui.updatePeerInfo(this.peers, this.avatars);
        };

        dataChannel.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleP2PMessage(message, peerId);
            } catch (error) {
                ui.updateStatus(`❌ Invalid P2P message from ${peerId}: ${error.message}`);
            }
        };
    }

    handleP2PMessage(message, fromPeer) {
        const peer = this.peers.get(fromPeer);
        const avatar = this.avatars.get(fromPeer);

        if (!peer || !avatar) return;

        switch (message.type) {
            case 'player_move':
                avatar.position.fromArray(message.payload.start);
                peer.targetPosition = new THREE.Vector3().fromArray(message.payload.target);
                peer.moveStartTime = performance.now();
                break;

            case 'player_sync':
                avatar.position.fromArray(message.payload.position);
                if (message.payload.target) {
                    peer.targetPosition = new THREE.Vector3().fromArray(message.payload.target);
                    peer.moveStartTime = performance.now();
                }
                break;
        }
    }

    broadcastP2P(message) {
        let sentCount = 0;
        this.peers.forEach((peer) => {
            if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
                try {
                    peer.dataChannel.send(JSON.stringify(message));
                    sentCount++;
                } catch (error) {
                    console.error('Failed to send P2P message:', error);
                }
            }
        });
        return sentCount;
    }

    cleanupPeer(peerId, scene) {
        const peer = this.peers.get(peerId);
        if (peer) {
            if (peer.dataChannel) peer.dataChannel.close();
            if (peer.connection) peer.connection.close();
            this.peers.delete(peerId);
        }

        const avatar = this.avatars.get(peerId);
        if (avatar) {
            scene.remove(avatar);
            if (avatar.geometry) avatar.geometry.dispose();
            if (avatar.material) avatar.material.dispose();
            this.avatars.delete(peerId);
        }

        ui.updatePeerInfo(this.peers, this.avatars);
    }
}

// ==========================================
// CHUNK MANAGER
// ==========================================

class ChunkManager {
    constructor(gameState, terrainRenderer, scene) {
        this.gameState = gameState;
        this.terrainRenderer = terrainRenderer;
        this.scene = scene;
        this.loadRadius = CONFIG.TERRAIN.renderDistance;
        this.chunkSize = CONFIG.TERRAIN.chunkSize;
    }

    updatePlayerChunk(playerX, playerZ) {
        const newChunkX = Math.floor(roundCoord(playerX) / this.chunkSize);
        const newChunkZ = Math.floor(roundCoord(playerZ) / this.chunkSize);

        if (newChunkX === this.gameState.currentPlayerChunkX &&
            newChunkZ === this.gameState.currentPlayerChunkZ) {
            return false; // No change
        }

        this.gameState.updateChunkPosition(newChunkX, newChunkZ);
        this.updateChunksAroundPlayer(newChunkX, newChunkZ);
        return true;
    }

    updateChunksAroundPlayer(chunkX, chunkZ) {
        const chunksToKeep = new Set();

        for (let x = -this.loadRadius; x <= this.loadRadius; x++) {
            for (let z = -this.loadRadius; z <= this.loadRadius; z++) {
                const gridX = chunkX + x;
                const gridZ = chunkZ + z;
                const key = `${gridX},${gridZ}`;
                chunksToKeep.add(key);

                if (!this.terrainRenderer.chunkMap.has(key)) {
                    this.createChunk(gridX, gridZ);
                }
            }
        }

        Array.from(this.terrainRenderer.chunkMap.keys()).forEach(key => {
            if (!chunksToKeep.has(key)) {
                this.disposeChunk(key);
            }
        });
    }

createChunk(gridX, gridZ) {
    const worldX = gridX * this.chunkSize;
    const worldZ = gridZ * this.chunkSize;
    const chunkKey = `${gridX},${gridZ}`;

    // Get cached removals for this chunk
    const removedIds = this.gameState.removedObjectsCache.get(chunkKey);
    
    // Pass removals to terrain renderer
    this.terrainRenderer.createChunk(worldX, worldZ, removedIds);

    console.log(`Created chunk ${chunkKey} with removals applied.`);
}

    applyChunkRemovals(chunkKey) {
    const objects = this.terrainRenderer.chunkTrees.get(chunkKey);
    if (!objects) {
        console.log(`No objects to process for chunk ${chunkKey}.`);
        return;
    }

    const removedIds = this.gameState.removedObjectsCache.get(chunkKey);
    if (!removedIds || removedIds.size === 0) {
        console.log(`No removals to apply for chunk ${chunkKey}.`);
        return;
    }

    // Remove objects that are in the removal list
    objects.forEach(obj => {
        const objectId = obj.userData.objectId;
        if (removedIds.has(objectId)) {
            this.scene.remove(obj);
            this.disposeObject(obj);
        }
    });

    // Filter out the removed objects from the tracked array
    const keptObjects = objects.filter(obj => !removedIds.has(obj.userData.objectId));
    this.terrainRenderer.chunkTrees.set(chunkKey, keptObjects);

    console.log(`Applied ${removedIds.size} removals to chunk ${chunkKey}.`);
}

    disposeChunk(key) {
    this.terrainRenderer.disposeChunk(key);
}

    removeObject(objectId) {
        const object = objectPlacer.findObjectById(this.scene, objectId);
        if (object && object.userData.chunkKey) {
            const chunkKey = object.userData.chunkKey;

            // Add to cache
            if (!this.gameState.removedObjectsCache.has(chunkKey)) {
                this.gameState.removedObjectsCache.set(chunkKey, new Set());
            }
            this.gameState.removedObjectsCache.get(chunkKey).add(objectId);

            // Remove from scene
            this.scene.remove(object);
            this.disposeObject(object);
            // Remove from chunkTrees array
        const trees = this.terrainRenderer.chunkTrees.get(chunkKey);
        if (trees) {
            const filteredTrees = trees.filter(obj => obj.userData.objectId !== objectId);
            this.terrainRenderer.chunkTrees.set(chunkKey, filteredTrees);
        }

            // Update nearest object if this was it
            if (this.gameState.nearestObject && this.gameState.nearestObject.id === objectId) {
                this.gameState.nearestObject = null;
                this.gameState.nearestObjectDistance = Infinity;
                ui.updateNearestObject(null);
                ui.updateButtonStates(this.gameState.isInChunk, null);
            }
            return true;
        }
        return false;
    }

    disposeObject(object) {
        object.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(mat => mat.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            }
        });
    }
}


// ==========================================
// MAIN GAME CLASS
// ==========================================

class MultiplayerGame {
    constructor() {
        this.gameState = new GameState();
        this.setupScene();
        this.setupRenderers();
        this.setupNetworking();
        this.setupInput();
        this.setupUI();

        // Animation constants
        this.playerSpeed = 0.02;  // Reduced by 80% from 0.1
        this.stopThreshold = 0.01;
        this.chunkUpdateInterval = 1000;
        this.proximityCheckInterval = 2000;
        this.peerCheckInterval = 5000;
    }

    setupScene() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x000011);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
        this.directionalLight.position.set(15, 20, 0);
        this.directionalLight.castShadow = true;
        this.directionalLight.shadow.mapSize.set(2048, 2048);
        this.directionalLight.shadow.camera.near = 0.5;
        this.directionalLight.shadow.camera.far = 100;
        this.directionalLight.shadow.camera.left = -50;
        this.directionalLight.shadow.camera.right = 50;
        this.directionalLight.shadow.camera.top = 50;
        this.directionalLight.shadow.camera.bottom = -50;
        this.directionalLight.shadow.bias = -0.001;
        this.scene.add(this.directionalLight);

        this.directionalLight.target = new THREE.Object3D();
        this.scene.add(this.directionalLight.target);

        this.playerObject = new THREE.Mesh(
            new THREE.SphereGeometry(1, 32, 32),
            new THREE.MeshBasicMaterial({ color: 0x0000ff })
        );
        this.playerObject.position.set(0, 5, 0);
        this.scene.add(this.playerObject);

        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
    }

    setupRenderers() {
        this.terrainRenderer = new SimpleTerrainRenderer(this.scene);
        this.waterRenderer = new WaterRenderer(this.scene, 1.02, this.terrainRenderer);
        this.terrainRenderer.setWaterRenderer(this.waterRenderer);

        this.chunkManager = new ChunkManager(
            this.gameState,
            this.terrainRenderer,
            this.scene
        );

        requestAnimationFrame(() => {
            this.terrainRenderer.updateShadowUniforms(this.directionalLight);
        });
    }

    setupNetworking() {
        this.networkManager = new NetworkManager(
            this.gameState,
            this.handleServerMessage.bind(this)
        );
    }

    setupInput() {
        window.addEventListener('pointerdown', this.onPointerDown.bind(this));
    }

    setupUI() {
        ui.initializeUI({
            sendServerMessage: this.networkManager.sendMessage.bind(this.networkManager),
            clientId: this.gameState.clientId,
            getCurrentChunkX: () => this.gameState.currentPlayerChunkX,
            getCurrentChunkZ: () => this.gameState.currentPlayerChunkZ,
            getNearestObject: () => this.gameState.nearestObject,
            onRemoveObject: (object) => {
                if (object) {
                    this.networkManager.sendMessage('remove_object_request', {
                        chunkId: `chunk_${object.chunkKey}`,
                        objectId: object.id,
                        name: object.name,
                        position: object.position.toArray()
                    });
                }
            },
            onResize: this.onResize.bind(this)
        });
        window.addEventListener('resize', this.onResize.bind(this));
    }

    start() {
        ui.updateStatus("🎮 Game initialized");
        ui.updateConnectionStatus('connecting', '🔄 Connecting...');
        this.networkManager.connect();
        this.animate();
    }

    // --- Server Message Handlers ---

    handleServerMessage(type, payload) {
        switch (type) {
            case 'server_connected':
                this.handleServerConnected();
                break;
            case 'webrtc_offer':
                this.handleWebRTCOffer(payload);
                break;
            case 'webrtc_answer':
                this.handleWebRTCAnswer(payload);
                break;
            case 'webrtc_ice_candidate':
                this.handleWebRTCIceCandidate(payload);
                break;
            case 'proximity_update':
                this.handleProximityUpdate(payload);
                break;
            case 'object_removed':
                this.handleObjectRemoved(payload);
                break;
            case 'chunk_objects_state':
                this.handleChunkObjectsState(payload);
                break;
        }
    }

    handleServerConnected() {
    const { chunkSize } = CONFIG.TERRAIN;
    const initialChunkX = Math.floor(this.playerObject.position.x / chunkSize);
    const initialChunkZ = Math.floor(this.playerObject.position.z / chunkSize);
    const chunkId = `chunk_${initialChunkX},${initialChunkZ}`;

    const success = this.networkManager.sendMessage('join_chunk', {
        chunkId,
        clientId: this.gameState.clientId
    });

    if (success) {
        this.gameState.isInChunk = true;
        this.gameState.updateChunkPosition(initialChunkX, initialChunkZ);
        ui.updateButtonStates(true, null);
    }

    // Don't create chunks yet - wait for server state
}

    handleChunkObjectsState(payload) {
    const { objectChanges } = payload;
    if (!objectChanges || !Array.isArray(objectChanges)) return;

    // Group changes by chunk
    const changesByChunk = new Map();
    
    objectChanges.forEach(change => {
        if (change.action === 'remove') {
            const chunkKey = change.chunkId.replace('chunk_', '');
            
            // Add to cache
            if (!this.gameState.removedObjectsCache.has(chunkKey)) {
                this.gameState.removedObjectsCache.set(chunkKey, new Set());
            }
            this.gameState.removedObjectsCache.get(chunkKey).add(change.id);
            
            // Track which chunks need removal applied
            changesByChunk.set(chunkKey, true);
        }
    });

    // Apply removals to existing chunks
    changesByChunk.forEach((_, chunkKey) => {
        this.chunkManager.applyChunkRemovals(chunkKey);
    });

    // If this is the first chunk state after connecting, create the initial chunks
if (this.terrainRenderer.chunkMap.size === 0) {
    this.chunkManager.updateChunksAroundPlayer(
        this.gameState.currentPlayerChunkX, 
        this.gameState.currentPlayerChunkZ
    );
}
}

    handleObjectRemoved(payload) {
        if (this.chunkManager.removeObject(payload.objectId)) {
    ui.updateStatus(`Removed object ${payload.objectId} from scene`);
} else {
    console.warn(`Object ${payload.objectId} not found in current chunks.`);
}
    }

    handleProximityUpdate(payload) {
        const { players } = payload;
        ui.updateStatus(`📍 Proximity update: ${players.length} players`);

        const currentPeerIds = new Set(players.map(p => p.id));
        this.networkManager.peers.forEach((_, peerId) => {
            if (!currentPeerIds.has(peerId) && peerId !== this.gameState.clientId) {
                this.networkManager.cleanupPeer(peerId, this.scene);
            }
        });

        const newPlayers = players.filter(
            p => p.id !== this.gameState.clientId && !this.networkManager.peers.has(p.id)
        );

        if (newPlayers.length > 0) {
            this.staggerP2PInitiations(newPlayers);
        }
        ui.updatePeerInfo(this.networkManager.peers, this.networkManager.avatars);
    }

    async handleWebRTCOffer(payload) {
        if (payload.recipientId !== this.gameState.clientId) return;
        const peerId = payload.senderId;
        const connection = this.networkManager.createPeerConnection(peerId, false);
        try {
            await connection.setRemoteDescription(new RTCSessionDescription(payload.offer));
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            this.networkManager.sendMessage('webrtc_answer', {
                recipientId: peerId,
                senderId: this.gameState.clientId,
                answer
            });
        } catch (error) {
            ui.updateStatus(`❌ Failed to handle offer from ${peerId}: ${error}`);
        }
    }

    async handleWebRTCAnswer(payload) {
        if (payload.recipientId !== this.gameState.clientId) return;
        const peer = this.networkManager.peers.get(payload.senderId);
        if (peer?.connection) {
            try {
                await peer.connection.setRemoteDescription(new RTCSessionDescription(payload.answer));
            } catch (error) {
                ui.updateStatus(`❌ Failed to handle answer from ${payload.senderId}: ${error}`);
            }
        }
    }

    async handleWebRTCIceCandidate(payload) {
        if (payload.recipientId !== this.gameState.clientId) return;
        const peer = this.networkManager.peers.get(payload.senderId);
        if (peer?.connection) {
            try {
                await peer.connection.addIceCandidate(new RTCIceCandidate(payload.candidate));
            } catch (error) {
                ui.updateStatus(`❌ Failed to add ICE candidate from ${payload.senderId}: ${error}`);
            }
        }
    }

    staggerP2PInitiations(newPlayers) {
        newPlayers.forEach((player, index) => {
            setTimeout(() => {
                if (this.gameState.clientId < player.id) {
                    this.initiateP2PConnection(player.id);
                }
                const avatar = new THREE.Mesh(
                    new THREE.SphereGeometry(1, 32, 32),
                    new THREE.MeshBasicMaterial({ color: Math.random() * 0xffffff })
                );
                this.scene.add(avatar);
                this.networkManager.avatars.set(player.id, avatar);
            }, index * 750);
        });
    }

    async initiateP2PConnection(peerId) {
        const connection = this.networkManager.createPeerConnection(peerId, true);
        try {
            const offer = await connection.createOffer();
            await connection.setLocalDescription(offer);
            this.networkManager.sendMessage('webrtc_offer', {
                recipientId: peerId,
                senderId: this.gameState.clientId,
                offer
            });
        } catch (error) {
            ui.updateStatus(`❌ Failed to create offer for ${peerId}: ${error}`);
        }
    }

    // --- Input and Resizing ---

    onPointerDown(event) {
        if (event.target.tagName !== 'CANVAS') return;

        this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.pointer, this.camera);
        const terrainObjects = Array.from(this.terrainRenderer.chunkMap.values()).map(c => c.mesh);
        const waterObjects = this.waterRenderer.getWaterChunks();
        const allObjects = [...terrainObjects, ...waterObjects];
        const intersects = this.raycaster.intersectObjects(allObjects, true);

        if (intersects.length > 0) {
            const { point } = intersects[0];
            this.gameState.playerTargetPosition.set(point.x, point.y + 1, point.z);
            this.gameState.isMoving = true;
            ui.updateStatus(`🚀 Moving to clicked position...`);

            this.networkManager.broadcastP2P({
                type: 'player_move',
                payload: {
                    start: this.playerObject.position.toArray(),
                    target: this.gameState.playerTargetPosition.toArray()
                }
            });
        }
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }


    // --- Animation Loop and Updates ---

    animate() {
        requestAnimationFrame(this.animate.bind(this));
        const now = performance.now();
        const deltaTime = now - this.gameState.lastFrameTime;

        this.updatePlayerMovement(deltaTime);
        this.updateAvatarMovement(deltaTime);
        this.updateCameraAndLighting();
        this.runPeriodicChecks(now);

        this.waterRenderer.update(now);
        this.renderer.render(this.scene, this.camera);
        this.gameState.lastFrameTime = now;
    }

    updatePlayerMovement(deltaTime) {
        if (!this.gameState.isMoving) return;
        const { position } = this.playerObject;
        const { playerTargetPosition } = this.gameState;
        const distance = position.distanceTo(playerTargetPosition);

        if (distance <= this.stopThreshold) {
    position.copy(playerTargetPosition);
    this.gameState.isMoving = false;
    ui.updateStatus("🛑 Arrived at destination.");
    this.checkProximityToObjects(); // Check proximity when arriving
} else {
            const moveStep = this.playerSpeed * deltaTime;
            const alpha = Math.min(1, moveStep / distance);
            position.lerp(playerTargetPosition, alpha);
        }
    }

    updateAvatarMovement(deltaTime) {
        this.networkManager.avatars.forEach((avatar, peerId) => {
            const peer = this.networkManager.peers.get(peerId);
            if (peer?.targetPosition) {
                const distance = avatar.position.distanceTo(peer.targetPosition);
                if (distance <= this.stopThreshold) {
                    avatar.position.copy(peer.targetPosition);
                    peer.targetPosition = null;
                } else {
                    const moveStep = this.playerSpeed * deltaTime;
                    const alpha = Math.min(1, moveStep / distance);
                    avatar.position.lerp(peer.targetPosition, alpha);
                }
            }
        });
    }

    updateCameraAndLighting() {
        // Update lighting to follow player
        const shadowCameraOffset = new THREE.Vector3(15, 20, 0);
        this.directionalLight.position.copy(this.playerObject.position).add(shadowCameraOffset);
        this.directionalLight.target.position.copy(this.playerObject.position);
        this.directionalLight.target.updateMatrixWorld();

        // Update terrain shader with new light position
        if (this.terrainRenderer) {
            this.terrainRenderer.updateShadowUniforms(this.directionalLight);
        }

        // Update camera to follow player
        const cameraOffset = new THREE.Vector3(0, 12, 8);  // Lowered by 20% from 15 to zoom in
        this.gameState.cameraTargetPosition.copy(this.playerObject.position).add(cameraOffset);
        this.camera.position.lerp(this.gameState.cameraTargetPosition, 0.8);  // Much more rigid camera (was 0.1)
        this.camera.lookAt(this.playerObject.position);
    }

    runPeriodicChecks(now) {
        if (now - this.gameState.lastChunkUpdateTime > this.chunkUpdateInterval) {
            if (this.chunkManager.updatePlayerChunk(this.playerObject.position.x, this.playerObject.position.z)) {
                // If chunk changed, notify server
                const { clientId, currentPlayerChunkX, currentPlayerChunkZ, lastChunkX, lastChunkZ } = this.gameState;
                this.networkManager.sendMessage('chunk_update', {
                    clientId,
                    newChunkId: `chunk_${currentPlayerChunkX},${currentPlayerChunkZ}`,
                    lastChunkId: `chunk_${lastChunkX},${lastChunkZ}`
                });
                ui.updateStatus(`Player moved to chunk (${currentPlayerChunkX}, ${currentPlayerChunkZ})`);
                this.checkProximityToObjects(); // Check proximity when entering new chunk
            }
            this.gameState.lastChunkUpdateTime = now;
        }

        

        if (now - this.gameState.lastPeerCheckTime > this.peerCheckInterval) {
            this.checkAndReconnectPeers();
            this.gameState.lastPeerCheckTime = now;
        }
    }

    checkProximityToObjects() {
        const { chunkSize } = CONFIG.TERRAIN;
        const playerChunkX = Math.floor(this.playerObject.position.x / chunkSize);
        const playerChunkZ = Math.floor(this.playerObject.position.z / chunkSize);
        let closestObject = null;
        let closestDistance = Infinity;

        // Check a 3x3 grid of chunks around the player
        for (let x = playerChunkX - 1; x <= playerChunkX + 1; x++) {
            for (let z = playerChunkZ - 1; z <= playerChunkZ + 1; z++) {
                const chunkKey = `${x},${z}`;
                const objectsInChunk = this.terrainRenderer.chunkTrees.get(chunkKey) || [];

                for (const object of objectsInChunk) {
                    if (object.visible) { // Only check visible objects
                        const distance = this.playerObject.position.distanceTo(object.position);
                        if (distance < closestDistance) {
                            closestDistance = distance;
                            closestObject = object;
                        }
                    }
                }
            }
        }

        if (closestObject && closestDistance <= 2.5) { // Interaction radius
            this.gameState.nearestObject = {
                id: closestObject.userData.objectId,
                name: closestObject.userData.modelType,
                position: closestObject.position.clone(),
                chunkKey: closestObject.userData.chunkKey
            };
            this.gameState.nearestObjectDistance = closestDistance;
        } else {
            this.gameState.nearestObject = null;
            this.gameState.nearestObjectDistance = Infinity;
        }

        ui.updateNearestObject(this.gameState.nearestObject ? this.gameState.nearestObject.name : null);
        ui.updateButtonStates(this.gameState.isInChunk, this.gameState.nearestObject);
    }

    checkAndReconnectPeers() {
        this.networkManager.peers.forEach((peer, peerId) => {
            if (peer.state === 'disconnected' || peer.state === 'failed') {
                if (this.gameState.clientId < peerId) { // Initiation rule
                    ui.updateStatus(`Attempting P2P reconnect to ${peerId}...`);
                    this.initiateP2PConnection(peerId);
                }
            }
        });
    }
}

// ==========================================
// INITIALIZATION
// ==========================================
import { modelManager } from './objects.js';

// Wait for models to load before starting game
modelManager.loadAllModels().then(() => {
    console.log('Models loaded, starting game...');
    const game = new MultiplayerGame();
    game.start();
}).catch(error => {
    console.error('Failed to load models:', error);
    alert('Failed to load game models. Please refresh the page.');
});
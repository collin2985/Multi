import * as THREE from 'three';

export function initializeGame(clientId, scene, camera, renderer, playerObject, box, uiElements, sendServerMessage, terrainRenderer, peers, avatars) {
    let isInChunk = false;
    let boxInScene = false;
    let currentPlayerChunkX = 0;
    let currentPlayerChunkZ = 0;
    const loadRadius = 1;
    let lastChunkUpdateTime = 0;
    const chunkUpdateInterval = 2000;
    let chunkLoadQueue = [];
    let isProcessingChunks = false;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const playerTargetPosition = new THREE.Vector3();
    let isMoving = false;

    function updateStatus(msg) {
        const timestamp = new Date().toLocaleTimeString();
        uiElements.statusEl.innerHTML += `[${timestamp}] ${msg}<br>`;
        uiElements.statusEl.scrollTop = uiElements.statusEl.scrollHeight;
        console.log(`[${timestamp}] ${msg}`);
    }

    function updateChunksAroundPlayer(playerChunkX, playerChunkZ, seed = 0) {
        const chunkSize = 50;
        const shouldLoad = new Set();
        for (let x = playerChunkX - loadRadius; x <= playerChunkX + loadRadius; x++) {
            for (let z = playerChunkZ - loadRadius; z <= playerChunkZ + loadRadius; z++) {
                shouldLoad.add(`${x},${z}`);
            }
        }
        const currentChunks = new Set(terrainRenderer.getLoadedChunks());
        const chunksToLoad = [...shouldLoad].filter(key => !currentChunks.has(key));
        const chunksToRemove = [...currentChunks].filter(key => !shouldLoad.has(key));
        
        chunksToRemove.forEach(key => {
            const [chunkX, chunkZ] = key.split(',').map(Number);
            terrainRenderer.removeTerrainChunk({ chunkX, chunkZ });
        });

        chunksToLoad.forEach(key => {
            const [chunkX, chunkZ] = key.split(',').map(Number);
            terrainRenderer.addTerrainChunk({ chunkX, chunkZ, seed });
        });
    }

    function animate() {
        requestAnimationFrame(animate);
        // P2P position update
        const message = {
            type: 'player_update',
            payload: {
                position: playerObject.position,
                rotation: playerObject.rotation
            }
        };
        const sentCount = sendP2PMessage(message);

        // Movement logic
        if (isMoving) {
            playerObject.position.lerp(playerTargetPosition, 0.05);
            camera.position.copy(playerObject.position);
            if (playerObject.position.distanceTo(playerTargetPosition) < 0.1) {
                isMoving = false;
            }
        }
        
        // Chunk management update
        const playerChunkX = Math.floor(playerObject.position.x / 50);
        const playerChunkZ = Math.floor(playerObject.position.z / 50);
        if (playerChunkX !== currentPlayerChunkX || playerChunkZ !== currentPlayerChunkZ) {
            currentPlayerChunkX = playerChunkX;
            currentPlayerChunkZ = playerChunkZ;
            updateChunksAroundPlayer(currentPlayerChunkX, currentPlayerChunkZ);
        }

        renderer.render(scene, camera);
    }

    function sendP2PMessage(message) {
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

  function handleChunkStateChange(payload) {
        const chunkState = payload.state;
        if (chunkState) {
            isInChunk = true;
            if (chunkState.boxPresent && !boxInScene) {
                scene.add(box);
                avatars.set('serverBox', box);
                boxInScene = true;
                updateStatus('📍 Added box to scene');
            } else if (!chunkState.boxPresent && boxInScene) {
                scene.remove(box);
                avatars.delete('serverBox');
                boxInScene = false;
                updateStatus('📍 Removed box from scene');
            }
            // Add avatars to scene
            avatars.forEach((avatar, id) => {
                if (id !== 'serverBox' && !scene.getObjectByProperty('uuid', avatar.uuid)) {
                    scene.add(avatar);
                }
            });
            updateChunksAroundPlayer(currentPlayerChunkX, currentPlayerChunkZ, chunkState.seed || 0);
        }
    };
    return { animate, updateChunksAroundPlayer, handleChunkStateChange };
}
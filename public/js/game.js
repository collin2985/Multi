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
                terrainRenderer.addTerrainChunk({ chunkX: x, chunkZ: z, seed });
            }
        }
    }
    
    function animate() {
        requestAnimationFrame(animate);
        renderer.render(scene, camera);
        
        // Update player movement logic
        if (isMoving) {
            const currentPosition = playerObject.position.clone();
            const direction = playerTargetPosition.clone().sub(currentPosition).normalize();
            const distance = currentPosition.distanceTo(playerTargetPosition);
            const moveSpeed = 0.1;
            
            if (distance > moveSpeed) {
                playerObject.position.add(direction.multiplyScalar(moveSpeed));
            } else {
                playerObject.position.copy(playerTargetPosition);
                isMoving = false;
            }
        }

        // Check if player has moved to a new chunk
        const newPlayerChunkX = Math.floor(playerObject.position.x / 50);
        const newPlayerChunkZ = Math.floor(playerObject.position.z / 50);

        if (newPlayerChunkX !== currentPlayerChunkX || newPlayerChunkZ !== currentPlayerChunkZ) {
            currentPlayerChunkX = newPlayerChunkX;
            currentPlayerChunkZ = newPlayerChunkZ;
            updateStatus(`Player moved to chunk: ${currentPlayerChunkX}, ${currentPlayerChunkZ}`);
        }

        // Update camera position to follow player
        camera.position.set(playerObject.position.x, playerObject.position.y + 10, playerObject.position.z + 20);
        camera.lookAt(playerObject.position);

        // Update avatars
        avatars.forEach((avatar, id) => {
            // Placeholder: Update avatar position based on P2P data if available
        });
    }

    window.addEventListener('click', (event) => {
        pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        pointer.y = - (event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const intersects = raycaster.intersectObjects(scene.children);
        if (intersects.length > 0) {
            const intersect = intersects[0];
            const point = intersect.point;
            playerTargetPosition.set(point.x, playerObject.position.y, point.z);
            isMoving = true;
        }
    });

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
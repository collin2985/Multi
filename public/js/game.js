import * as THREE from 'three';

export function initializeGame(clientId, scene, camera, renderer, playerObject, box, uiElements, sendServerMessage) {
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

    function updateChunksAroundPlayer(playerChunkX, playerChunkZ, terrainRenderer) {
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
                    seed: 0 
                });
            }
        }
    }

    function processChunkQueue(terrainRenderer) {
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

    function animate() {
        requestAnimationFrame(animate);
        const now = performance.now();
        const deltaTime = now - lastChunkUpdateTime;

        if (isMoving) {
            const distance = playerObject.position.distanceTo(playerTargetPosition);
            const playerSpeed = 0.05;
            const stopThreshold = 0.01;
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

        processChunkQueue();

        const cameraOffset = new THREE.Vector3(-15, 40, 20);
        const cameraTargetPosition = playerObject.position.clone().add(cameraOffset);
        camera.position.lerp(cameraTargetPosition, 0.1);
        camera.lookAt(playerObject.position);

        if (boxInScene) {
            box.rotation.x += 0.005;
            box.rotation.y += 0.01;
        }

        renderer.render(scene, camera);
    }

    window.addEventListener('pointerdown', (event) => {
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
    });

    return { animate, updateChunksAroundPlayer };
}
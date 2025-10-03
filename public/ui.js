// ui.js

// --- UI ELEMENTS ---
const statusEl = document.getElementById('status');
const connectionStatusEl = document.getElementById('connectionStatus');
const peerInfoEl = document.getElementById('peerInfo');
const addBtn = document.getElementById('addBoxBtn');
const removeBtn = document.getElementById('removeBoxBtn');

// This object will be exported and used by game.js
export const ui = {
    updateStatus(msg) {
        const timestamp = new Date().toLocaleTimeString();
        statusEl.innerHTML += `[${timestamp}] ${msg}<br>`;
        statusEl.scrollTop = statusEl.scrollHeight;
        console.log(`[${timestamp}] ${msg}`);
    },

    updateConnectionStatus(status, message) {
        connectionStatusEl.className = `status-${status}`;
        connectionStatusEl.innerHTML = message;
    },

    updatePeerInfo(peers, avatars) {
        const connectedPeers = Array.from(peers.values()).filter(p => p.state === 'connected');
        peerInfoEl.innerHTML = `P2P Connections: ${connectedPeers.length}/${peers.size}<br>Avatars: ${avatars.size}`;
    },

    updateNearestObject(objectName) {
        const nearestObjectEl = document.getElementById('nearestObject');
        nearestObjectEl.textContent = objectName ? objectName : 'No object nearby';
    },

    updateButtonStates(isInChunk, nearestObject) {
        addBtn.disabled = true; // Temporarily disabled
        removeBtn.disabled = !isInChunk || !nearestObject;
        removeBtn.textContent = nearestObject ? `Remove ${nearestObject.name}` : 'Remove Object';
    },

    // Sets up event listeners, accepting callbacks for actions
    initializeUI(callbacks) {
        addBtn.onclick = () => {
            const chunkX = callbacks.getCurrentChunkX();
            const chunkZ = callbacks.getCurrentChunkZ();
            callbacks.sendServerMessage('add_box_request', {  // Keep the message type the same for server compatibility
                chunkId: `chunk_${chunkX},${chunkZ}`,
                position: { x: 0, y: 0, z: -3 }
            });
        };

        removeBtn.onclick = () => {
            callbacks.onRemoveObject(callbacks.getNearestObject());
        };
    
        window.addEventListener('resize', () => {
            callbacks.onResize();
        });
    }
};
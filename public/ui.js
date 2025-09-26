
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

    updateButtonStates(isInChunk, boxInScene) {
        addBtn.disabled = !isInChunk || boxInScene;
        removeBtn.disabled = !isInChunk || !boxInScene;
    },

    // Sets up event listeners, accepting callbacks for actions
    initializeUI(callbacks) {
    addBtn.onclick = () => {
        const chunkX = callbacks.getCurrentChunkX();
        const chunkZ = callbacks.getCurrentChunkZ();
        callbacks.sendServerMessage('add_box_request', {
            chunkId: `chunk_${chunkX}_${chunkZ}`,
            position: { x: 0, y: 0, z: -3 }
        });
    };

    removeBtn.onclick = () => {
        const chunkX = callbacks.getCurrentChunkX();
        const chunkZ = callbacks.getCurrentChunkZ();
        callbacks.sendServerMessage('remove_box_request', {
            chunkId: `chunk_${chunkX}_${chunkZ}`
        });
    };
    
    window.addEventListener('resize', () => {
        callbacks.onResize();
    });
}
};









// ui.js

// --- UI ELEMENTS ---
const statusEl = document.getElementById('status');
const connectionStatusEl = document.getElementById('connectionStatus');
const peerInfoEl = document.getElementById('peerInfo');
const joinBtn = document.getElementById('joinChunkBtn');
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
        joinBtn.disabled = isInChunk;
    },

    // This function sets up all the event listeners,
    // accepting callbacks for actions that affect game state.
    initializeUI(callbacks) {
        joinBtn.onclick = () => {
            const success = callbacks.sendServerMessage('join_chunk', { clientId: callbacks.clientId });
            if (success) {
                callbacks.onJoinSuccess();
            }
        };

        addBtn.onclick = () => {
            callbacks.sendServerMessage('add_box_request', {
                chunkId: 'chunk_0_0',
                position: { x: 0, y: 0, z: -3 }
            });
        };

        removeBtn.onclick = () => {
            callbacks.sendServerMessage('remove_box_request', { chunkId: 'chunk_0_0' });
        };
        
        // --- RESIZE HANDLING ---
        window.addEventListener('resize', () => {
            callbacks.onResize();
        });
    },
};
export function initializeUI(uiElements, sendServerMessage, updateChunksAroundPlayer, clientId) {
    uiElements.joinBtn.onclick = () => {
        if (sendServerMessage('join_chunk', { chunkId: 'chunk_0_0', clientId })) {
            uiElements.joinBtn.disabled = true;
            updateChunksAroundPlayer(0, 0);
        }
    };

    uiElements.addBtn.onclick = () => {
        sendServerMessage('add_box_request', { 
            chunkId: 'chunk_0_0',
            position: { x: 0, y: 0, z: -3 }
        });
    };

    uiElements.removeBtn.onclick = () => {
        sendServerMessage('remove_box_request', { chunkId: 'chunk_0_0' });
    };
}
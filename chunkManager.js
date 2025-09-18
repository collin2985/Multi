const fs = require('fs');

const chunkCache = new Map();
const terrainSeed = Math.floor(Math.random() * 1000000);

function saveChunk(chunkId) {
    if (chunkCache.has(chunkId)) {
        const filePath = `./public/${chunkId}.JSON`;
        const chunkData = chunkCache.get(chunkId);
        fs.writeFileSync(filePath, JSON.stringify(chunkData, null, 2), 'utf8');
        console.log(`Saved chunk: ${chunkId}`);
    }
}

function loadChunk(chunkId) {
    if (chunkCache.has(chunkId)) {
        return chunkCache.get(chunkId);
    }
    const filePath = `./public/${chunkId}.JSON`;
    try {
        const fileData = fs.readFileSync(filePath, 'utf8');
        const chunkData = JSON.parse(fileData);
        chunkCache.set(chunkId, chunkData);
        console.log(`Loaded chunk: ${chunkId}`);
        return chunkData;
    } catch (error) {
        console.error(`Failed to load chunk ${chunkId}:`, error);
        return null;
    }
}

function initializeChunk(chunkId) {
    const chunkData = { players: [], boxPresent: false, seed: terrainSeed };
    chunkCache.set(chunkId, chunkData);
    saveChunk(chunkId);
    return chunkData;
}

function broadcastToChunk(wss, chunkId, message) {
    wss.clients.forEach(client => {
        if (client.currentChunk === chunkId && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
    console.log(`Broadcasted ${message.type} to chunk ${chunkId}`);
}

module.exports = { saveChunk, loadChunk, initializeChunk, broadcastToChunk, chunkCache };
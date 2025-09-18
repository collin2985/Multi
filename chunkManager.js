const fs = require('fs').promises;
const path = require('path');

const chunkCache = new Map();
const terrainSeed = Math.floor(Math.random() * 1000000);

async function saveChunk(chunkId) {
    const chunkData = chunkCache.get(chunkId);
    if (chunkData) {
        const filePath = path.join(__dirname, 'public', `chunk_${chunkId}.JSON`);
        try {
            await fs.writeFile(filePath, JSON.stringify(chunkData, null, 2));
            console.log(`Saved chunk: ${chunkId}`);
        } catch (error) {
            console.error(`Failed to save chunk ${chunkId}: ${error}`);
        }
    }
}
async function loadChunk(chunkId) {
    const filePath = path.join(__dirname, 'public', `chunk_${chunkId}.JSON`);
    try {
        const data = await fs.readFile(filePath, 'utf8');
        const chunkData = JSON.parse(data);
        chunkCache.set(chunkId, chunkData);
        console.log(`Loaded chunk: ${chunkId}`);
        return chunkData;
    } catch (error) {
        console.error(`Failed to load chunk ${chunkId}: ${error}`);
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
    const chunkData = chunkCache.get(chunkId);
    if (chunkData) {
        wss.clients.forEach(client => {
            if (client.currentChunk === chunkId && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(message));
            }
        });
        console.log(`Broadcasted ${message.type} to chunk ${chunkId}`);
    }
}

module.exports = { saveChunk, loadChunk, initializeChunk, broadcastToChunk, chunkCache };
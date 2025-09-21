const WebSocket = require('ws');
const fs = require('fs');

// Create a new WebSocket server on port 8080
const wss = new WebSocket.Server({ port: 8080 });
console.log('Server started on port 8080');

// A simple in-memory cache to hold our chunk data
const chunkCache = new Map();
// A map to store client data with WebSocket, currentChunk, and lastChunk
const clients = new Map();

// Define a global terrain seed (can be fixed or dynamically generated)
const terrainSeed = 12345; // Example: Random seed per server start

// Queue for rate-limiting notifications
const notificationQueue = [];
const notificationInterval = 100; // Process every 100ms

// Save the chunk state to its file
function saveChunk(chunkId) {
    if (chunkCache.has(chunkId)) {
        const filePath = `./public/${chunkId}.JSON`;
        const chunkData = chunkCache.get(chunkId);
        fs.writeFileSync(filePath, JSON.stringify(chunkData, null, 2), 'utf8');
        console.log(`Saved chunk: ${chunkId}`);
    }
}

// Load a chunk from file
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

// Broadcast a message to all clients in a specific chunk
function broadcastToChunk(chunkId, message) {
    wss.clients.forEach(client => {
        if (client.currentChunk === chunkId && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
    console.log(`Broadcasted ${message.type} to chunk ${chunkId}`);
}

// Get players in a 3x3 grid around a chunk
function getPlayersInProximity(chunkId) {
    const parts = chunkId.split('_');
    const chunkX = parseInt(parts[1]);
    const chunkZ = parseInt(parts[2]);
    const players = [];

    // Check 3x3 grid (1-chunk radius)
    for (let x = chunkX - 1; x <= chunkX + 1; x++) {
        for (let z = chunkZ - 1; z <= chunkZ + 1; z++) {
            const targetChunkId = `chunk_${x}_${z}`;
            const chunkData = chunkCache.get(targetChunkId);
            if (chunkData) {
                chunkData.players.forEach(player => {
                    players.push({ id: player.id, chunkId: targetChunkId });
                });
            }
        }
    }
    return players;
}

// Process notification queue for rate limiting
function processNotificationQueue() {
    if (notificationQueue.length === 0) return;

    // Group events by affected chunk to avoid duplicate notifications
    const chunksToNotify = new Set(notificationQueue.map(event => event.chunkId));
    notificationQueue.length = 0; // Clear queue

    chunksToNotify.forEach(chunkId => {
        // Get players in the 3x3 grid around this chunk
        const proximatePlayers = getPlayersInProximity(chunkId);
        const affectedClients = new Set(proximatePlayers.map(p => p.id));

        // For each affected client, compute their own 3x3 grid player list
        affectedClients.forEach(clientId => {
            const clientData = clients.get(clientId);
            if (!clientData || !clientData.ws || clientData.ws.readyState !== WebSocket.OPEN) return;

            const clientPlayers = getPlayersInProximity(clientData.currentChunk);
            clientData.ws.send(JSON.stringify({
                type: 'proximity_update',
                payload: { players: clientPlayers }
            }));
            console.log(`Sent proximity_update to ${clientId} with ${clientPlayers.length} players`);
        });
    });
}

// Start notification queue processing
setInterval(processNotificationQueue, notificationInterval);

// Handle new connections
wss.on('connection', ws => {
    console.log('A new client connected');

    // Send a welcome message
    ws.send(JSON.stringify({ type: 'welcome', message: 'Welcome to the server!' }));

    ws.on('message', message => {
        let parsedMessage;
        try {
            parsedMessage = JSON.parse(message);
        } catch (error) {
            console.error('Invalid message received:', error);
            return;
        }
        console.log('Received message:', parsedMessage);

        switch (parsedMessage.type) {
            case 'join_chunk':
                const chunkId = parsedMessage.payload.chunkId;
                const clientId = parsedMessage.payload.clientId; // Get clientId from message
                if (!clientId) {
                    console.error('No clientId provided in join_chunk');
                    ws.send(JSON.stringify({ type: 'error', message: 'No clientId provided' }));
                    return;
                }
                ws.clientId = clientId;
                clients.set(clientId, { ws, currentChunk: chunkId, lastChunk: null });
                ws.currentChunk = chunkId; // Keep for backward compatibility

                let chunkData = loadChunk(chunkId);
                if (!chunkData) {
                    // Initialize chunk if it doesn't exist
                    chunkData = { players: [], boxPresent: false, seed: terrainSeed };
                    chunkCache.set(chunkId, chunkData);
                    saveChunk(chunkId);
                }

                const isPlayerInChunk = chunkData.players.some(p => p.id === clientId);
                if (!isPlayerInChunk) {
                    chunkData.players.push({ id: clientId });
                    console.log(`Client ${clientId} joined chunk: ${chunkId}`);
                    saveChunk(chunkId);
                }

                notificationQueue.push({ chunkId });

                break;

            case 'chunk_update':
                const { clientId: updateClientId, newChunkId, lastChunkId } = parsedMessage.payload;
                const clientData = clients.get(updateClientId);
                if (!clientData) {
                    console.error(`Client ${updateClientId} not found for chunk_update`);
                    return;
                }

                // Update client data
                clientData.currentChunk = newChunkId;
                clientData.lastChunk = lastChunkId;
                clientData.ws.currentChunk = newChunkId; // Update for compatibility

                // Update chunk data
                if (lastChunkId) {
                    const oldChunkData = chunkCache.get(lastChunkId);
                    if (oldChunkData) {
                        oldChunkData.players = oldChunkData.players.filter(p => p.id !== updateClientId);
                        saveChunk(lastChunkId);
                    }
                }

                let newChunkData = chunkCache.get(newChunkId);
                if (!newChunkData) {
                    newChunkData = { players: [], boxPresent: false, seed: terrainSeed };
                    chunkCache.set(newChunkId, newChunkData);
                }
                if (!newChunkData.players.some(p => p.id === updateClientId)) {
                    newChunkData.players.push({ id: updateClientId });
                    saveChunk(newChunkId);
                }

                // Queue notifications for both chunks
                notificationQueue.push({ chunkId: newChunkId });
                if (lastChunkId) {
                    notificationQueue.push({ chunkId: lastChunkId });
                }
                console.log(`Processed chunk_update for ${updateClientId}: ${lastChunkId || 'none'} -> ${newChunkId}`);

                break;

            case 'add_box_request':
                const addChunkId = parsedMessage.payload.chunkId;
                const addChunkData = chunkCache.get(addChunkId);
                if (addChunkData) {
                    addChunkData.boxPresent = true;
                    saveChunk(addChunkId);
                    broadcastToChunk(addChunkId, {
                        type: 'chunk_state_change',
                        payload: { chunkId: addChunkId, state: addChunkData }
                    });
                }
                break;

            case 'remove_box_request':
                const removeChunkId = parsedMessage.payload.chunkId;
                const removeChunkData = chunkCache.get(removeChunkId);
                if (removeChunkData) {
                    removeChunkData.boxPresent = false;
                    saveChunk(removeChunkId);
                    broadcastToChunk(removeChunkId, {
                        type: 'chunk_state_change',
                        payload: { chunkId: removeChunkId, state: removeChunkData }
                    });
                }
                break;

            case 'webrtc_offer':
            case 'webrtc_answer':
            case 'webrtc_ice_candidate':
                const recipientId = parsedMessage.payload.recipientId;
                const recipientData = clients.get(recipientId);
                if (recipientData && recipientData.ws) {
                    recipientData.ws.send(message);
                    console.log(`Forwarded ${parsedMessage.type} from ${ws.clientId} to ${recipientId}`);
                } else {
                    console.error(`Recipient ${recipientId} not found`);
                }
                break;

            default:
                console.error('Unknown message type:', parsedMessage.type);
        }
    });

    ws.on('close', () => {
        if (ws.clientId) {
            console.log(`Client ${ws.clientId} disconnected`);
            const clientData = clients.get(ws.clientId);
            if (clientData && clientData.currentChunk) {
                const chunkData = chunkCache.get(clientData.currentChunk);
                if (chunkData) {
                    chunkData.players = chunkData.players.filter(p => p.id !== ws.clientId);
                    console.log(`Client ${ws.clientId} left chunk: ${clientData.currentChunk}`);
                    saveChunk(clientData.currentChunk);
                    notificationQueue.push({ chunkId: clientData.currentChunk });
                    console.log(`Queued proximity_update for chunk ${clientData.currentChunk} due to disconnection`);
                }
            }
            clients.delete(ws.clientId);
        }
    });
});

// A periodic check to verify players from the file are still connected
const interval = setInterval(() => {
    console.log('Starting periodic player check...');
    chunkCache.forEach((chunkData, chunkId) => {
        const playersToRemove = [];
        chunkData.players.forEach(player => {
            const clientData = clients.get(player.id);
            if (!clientData || !clientData.ws || clientData.ws.readyState !== WebSocket.OPEN) {
                console.log(`Removing disconnected player ${player.id} from chunk ${chunkId}`);
                playersToRemove.push(player.id);
            }
        });

        if (playersToRemove.length > 0) {
            chunkData.players = chunkData.players.filter(p => !playersToRemove.includes(p.id));
            saveChunk(chunkId);
            notificationQueue.push({ chunkId });
            console.log(`Queued proximity_update for chunk ${chunkId} due to cleanup`);
        }
    });
    console.log('Periodic player check finished');
}, 60000);

// Clean up the interval when the server closes
wss.on('close', () => {
    clearInterval(interval);
});

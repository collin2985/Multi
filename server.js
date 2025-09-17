const WebSocket = require('ws');
const fs = require('fs');

// Create a new WebSocket server on port 8080
const wss = new WebSocket.Server({ port: 8080 });
console.log('Server started on port 8080');

// A simple in-memory cache to hold our chunk data
const chunkCache = new Map();
// A map to quickly find a client's WebSocket connection by their player ID
const clients = new Map();

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
                ws.clientId = clientId; // Assign the client's ID
                clients.set(clientId, ws); // Store in clients map
                ws.currentChunk = chunkId;

                let chunkData = loadChunk(chunkId);
                if (!chunkData) {
                    // Initialize chunk if it doesn't exist
                    chunkData = { players: [], boxPresent: false };
                    chunkCache.set(chunkId, chunkData);
                    saveChunk(chunkId);
                }

                const isPlayerInChunk = chunkData.players.some(p => p.id === clientId);
                if (!isPlayerInChunk) {
                    chunkData.players.push({ id: clientId });
                    console.log(`Client ${clientId} joined chunk: ${chunkId}`);
                    saveChunk(chunkId);
                }

                // Broadcast to ALL clients in the chunk
                broadcastToChunk(chunkId, {
                    type: 'chunk_state_change',
                    payload: { chunkId, state: chunkData }
                });
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
                const recipientWs = clients.get(recipientId);
                if (recipientWs) {
                    recipientWs.send(message);
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
            clients.delete(ws.clientId);
            if (ws.currentChunk) {
                const chunkData = chunkCache.get(ws.currentChunk);
                if (chunkData) {
                    chunkData.players = chunkData.players.filter(p => p.id !== ws.clientId);
                    console.log(`Client ${ws.clientId} left chunk: ${ws.currentChunk}`);
                    saveChunk(ws.currentChunk);
                    broadcastToChunk(ws.currentChunk, {
                        type: 'chunk_state_change',
                        payload: { chunkId: ws.currentChunk, state: chunkData }
                    });
                }
            }
        }
    });
});

// A periodic check to verify players from the file are still connected
const interval = setInterval(() => {
    console.log('Starting periodic player check...');
    const chunkId = 'chunkA';
    const chunkData = loadChunk(chunkId);

    if (chunkData) {
        const playersToRemove = [];
        chunkData.players.forEach(player => {
            const clientWs = clients.get(player.id);
            if (!clientWs) {
                console.log(`Removing disconnected player ${player.id} from chunk data`);
                playersToRemove.push(player.id);
            }
        });

        if (playersToRemove.length > 0) {
            chunkData.players = chunkData.players.filter(p => !playersToRemove.includes(p.id));
            saveChunk(chunkId);
            broadcastToChunk(chunkId, {
                type: 'chunk_state_change',
                payload: { chunkId, state: chunkData }
            });
        }
        
        console.log('Periodic player check finished');
    }
}, 60000);

// Clean up the interval when the server closes
wss.on('close', () => {
    clearInterval(interval);
});
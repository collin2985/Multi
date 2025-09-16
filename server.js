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
        const filePath = `./public/${chunkId}.json`;
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
    
    const filePath = `./public/${chunkId}.json`;
    
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

// Handle new connections
wss.on('connection', ws => {
    ws.clientId = Date.now();
    console.log(`A new client connected with ID: ${ws.clientId}`);

    // Add the new client to our client map
    clients.set(ws.clientId, ws);

    // We can send a welcome message to the client
    ws.send(JSON.stringify({ type: 'welcome', message: 'Welcome to the server!' }));



// Broadcast a message to all clients in a specific chunk
function broadcastToChunk(chunkId, message) {
    wss.clients.forEach(client => {
        if (client.currentChunk === chunkId) {
            client.send(JSON.stringify(message));
        }
    });
}

    // Handle messages from clients
    ws.on('message', message => {
        
        const parsedMessage = JSON.parse(message);
        console.log('Received message:', parsedMessage);

        switch (parsedMessage.type) {
            
            case 'add_box_request':
        const addChunkId = parsedMessage.payload.chunkId;
        const addChunkData = chunkCache.get(addChunkId);

        if (addChunkData) {
            addChunkData.boxPresent = true;
            saveChunk(addChunkId);
            // Broadcast the change to all clients in the chunk
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
            // Broadcast the change to all clients in the chunk
            broadcastToChunk(removeChunkId, {
                type: 'chunk_state_change',
                payload: { chunkId: removeChunkId, state: removeChunkData }
            });
        }
        break;
            case 'join_chunk':
                const chunkId = parsedMessage.payload.chunkId;
                const chunkData = loadChunk(chunkId);

                if (chunkData) {
                    // Update the client's current chunk
                    ws.currentChunk = chunkId;

                    // Add the client's ID to the chunk's players list if they're not already there
                    const isPlayerInChunk = chunkData.players.some(p => p.id === ws.clientId);
                    if (!isPlayerInChunk) {
                        chunkData.players.push({ id: ws.clientId });
                        console.log(`Client ${ws.clientId} joined chunk: ${chunkId}`);
                    }
                    
                    // Send the full chunk state to the client
                    ws.send(JSON.stringify({
                        type: 'chunk_state_change',
                        payload: { chunkId, state: chunkData }
                    }));
                    
                    saveChunk(chunkId);
                }
                break;
        }

        
    });

    // Handle client disconnections
    ws.on('close', () => {
        console.log(`Client ${ws.clientId} disconnected.`);
        // Remove the client from our map
        clients.delete(ws.clientId);

        if (ws.currentChunk) {
            const chunkData = chunkCache.get(ws.currentChunk);
            if (chunkData) {
                // Remove the player from the chunk's player list
                chunkData.players = chunkData.players.filter(p => p.id !== ws.clientId);
                console.log(`Client ${ws.clientId} left chunk: ${ws.currentChunk}`);
                saveChunk(ws.currentChunk);
            }
        }
    });
});

// A periodic check to verify players from the file are still connected
const interval = setInterval(() => {
    console.log("Starting periodic player check...");
    const chunkId = "chunkA"; // For now, we only have one chunk to check
    const chunkData = loadChunk(chunkId);

    if (chunkData) {
        const playersToRemove = [];
        chunkData.players.forEach(player => {
            const clientWs = clients.get(player.id);
            if (!clientWs) {
                // This player is in the file but not currently connected
                console.log(`Removing disconnected player ${player.id} from chunk data.`);
                playersToRemove.push(player.id);
            }
        });

        if (playersToRemove.length > 0) {
            // Filter out the players we need to remove
            chunkData.players = chunkData.players.filter(p => !playersToRemove.includes(p.id));
            saveChunk(chunkId);
        }
        
        console.log("Periodic player check finished.");
    }
}, 30000); // Check every 30 seconds

// Clean up the interval when the server closes
wss.on('close', () => {
    clearInterval(interval);
});
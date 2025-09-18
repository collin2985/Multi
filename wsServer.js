const { saveChunk, loadChunk, initializeChunk, broadcastToChunk, chunkCache } = require('./chunkManager');

const clients = new Map();

function startWebSocketServer(wss) {
    wss.on('connection', ws => {
        console.log('A new client connected');
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
                    handleJoinChunk(wss, ws, parsedMessage.payload);
                    break;
                case 'add_box_request':
                    handleBoxRequest(wss, parsedMessage.payload, true);
                    break;
                case 'remove_box_request':
                    handleBoxRequest(wss, parsedMessage.payload, false);
                    break;
                case 'webrtc_offer':
                case 'webrtc_answer':
                case 'webrtc_ice_candidate':
                    forwardWebRTCMessage(parsedMessage);
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
                        broadcastToChunk(wss, ws.currentChunk, {
                            type: 'chunk_state_change',
                            payload: { chunkId: ws.currentChunk, state: chunkData }
                        });
                    }
                }
            }
        });
    });

    const interval = setInterval(() => {
        console.log('Starting periodic player check...');
        chunkCache.forEach((chunkData, chunkId) => {
            const playersToRemove = [];
            chunkData.players.forEach(player => {
                if (!clients.get(player.id)) {
                    console.log(`Removing disconnected player ${player.id} from chunk ${chunkId}`);
                    playersToRemove.push(player.id);
                }
            });
            if (playersToRemove.length > 0) {
                chunkData.players = chunkData.players.filter(p => !playersToRemove.includes(p.id));
                saveChunk(chunkId);
                broadcastToChunk(wss, chunkId, {
                    type: 'chunk_state_change',
                    payload: { chunkId, state: chunkData }
                });
            }
        });
        console.log('Periodic player check finished');
    }, 60000);

    wss.on('close', () => {
        clearInterval(interval);
    });
}

function handleJoinChunk(wss, ws, payload) {
    const { chunkId, clientId } = payload;
    if (!clientId) {
        console.error('No clientId provided in join_chunk');
        ws.send(JSON.stringify({ type: 'error', message: 'No clientId provided' }));
        return;
    }
    ws.clientId = clientId;
    clients.set(clientId, ws);
    ws.currentChunk = chunkId;

    let chunkData = loadChunk(chunkId) || initializeChunk(chunkId);
    if (!chunkData.players.some(p => p.id === clientId)) {
        chunkData.players.push({ id: clientId });
        console.log(`Client ${clientId} joined chunk: ${chunkId}`);
        saveChunk(chunkId);
    }

    broadcastToChunk(wss, chunkId, {
        type: 'chunk_state_change',
        payload: { chunkId, state: chunkData }
    });
}

function handleBoxRequest(wss, payload, add) {
    const { chunkId } = payload;
    const chunkData = chunkCache.get(chunkId);
    if (chunkData) {
        chunkData.boxPresent = add;
        saveChunk(chunkId);
        broadcastToChunk(wss, chunkId, {
            type: 'chunk_state_change',
            payload: { chunkId, state: chunkData }
        });
    }
}

function forwardWebRTCMessage(parsedMessage) {
    const recipientId = parsedMessage.payload.recipientId;
    const recipientWs = clients.get(recipientId);
    if (recipientWs) {
        recipientWs.send(JSON.stringify(parsedMessage));
        console.log(`Forwarded ${parsedMessage.type} from ${parsedMessage.payload.senderId} to ${recipientId}`);
    } else {
        console.error(`Recipient ${recipientId} not found`);
    }
}

module.exports = { startWebSocketServer };
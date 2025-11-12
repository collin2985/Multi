// File: server.js
// Location: C:\Users\colli\Desktop\test Horses\Horses\server.js
// Modularized server with clean separation of concerns

const WebSocket = require('ws');
const ChunkManager = require('./server/ChunkManager');
const MessageRouter = require('./server/MessageRouter');
const MessageHandlers = require('./server/MessageHandlers');

// Create a new WebSocket server on port 8080
const wss = new WebSocket.Server({ port: 8080 });
console.log('Server started on port 8080');

// Initialize modular components
const clients = new Map();
const chunkManager = new ChunkManager(12345); // terrain seed
const messageRouter = new MessageRouter(clients);
const messageHandlers = new MessageHandlers(chunkManager, messageRouter, clients);

// Start notification queue processing
const notificationInterval = messageRouter.startNotificationProcessing(
    (chunkId) => chunkManager.getPlayersInProximity(chunkId)
);

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

        const { type, payload } = parsedMessage;

        // Route message to appropriate handler
        switch (type) {
            case 'join_chunk':
                messageHandlers.handleJoinChunk(ws, payload);
                break;

            case 'chunk_update':
                messageHandlers.handleChunkUpdate(payload);
                break;

            case 'add_box_request':
                // Legacy - keep for backward compatibility but could be removed
                const chunkData = chunkManager.getChunk(payload.chunkId);
                if (chunkData) {
                    chunkData.boxPresent = true;
                    chunkManager.saveChunk(payload.chunkId);
                    messageRouter.broadcastToChunk(payload.chunkId, {
                        type: 'chunk_state_change',
                        payload: { chunkId: payload.chunkId, state: chunkData }
                    });
                }
                break;

            case 'remove_box_request':
                // Legacy - keep for backward compatibility but could be removed
                const removeChunkData = chunkManager.getChunk(payload.chunkId);
                if (removeChunkData) {
                    removeChunkData.boxPresent = false;
                    chunkManager.saveChunk(payload.chunkId);
                    messageRouter.broadcastToChunk(payload.chunkId, {
                        type: 'chunk_state_change',
                        payload: { chunkId: payload.chunkId, state: removeChunkData }
                    });
                }
                break;

            case 'add_object_request':
                messageHandlers.handleAddObject(payload);
                break;

            case 'place_construction_site':
                messageHandlers.handlePlaceConstructionSite(payload);
                break;

            case 'build_construction':
                messageHandlers.handleBuildConstruction(payload);
                break;

            case 'update_construction_materials':
                messageHandlers.handleUpdateConstructionMaterials(payload);
                break;

            case 'get_crate_inventory':
                messageHandlers.handleGetCrateInventory(ws, payload);
                break;

            case 'save_crate_inventory':
                messageHandlers.handleSaveCrateInventory(payload);
                break;

            case 'buy_item':
                messageHandlers.handleBuyItem(ws, payload);
                break;

            case 'sell_item':
                messageHandlers.handleSellItem(ws, payload);
                break;

            case 'remove_object_request':
                messageHandlers.handleRemoveObject(payload);
                break;

            case 'harvest_resource_request':
                messageHandlers.handleHarvestResource(payload);
                break;

            case 'webrtc_offer':
            case 'webrtc_answer':
            case 'webrtc_ice_candidate':
                messageHandlers.handleWebRTCSignaling(type, message, payload);
                break;

            default:
                console.error('Unknown message type:', type);
        }
    });

    ws.on('close', () => {
        if (ws.clientId) {
            console.log(`Client ${ws.clientId} disconnected`);
            const clientData = clients.get(ws.clientId);
            if (clientData && clientData.currentChunk) {
                chunkManager.removePlayerFromChunk(clientData.currentChunk, ws.clientId);
                messageRouter.queueProximityUpdate(clientData.currentChunk);
                console.log(`Queued proximity_update for chunk ${clientData.currentChunk} due to disconnection`);
            }
            clients.delete(ws.clientId);
        }
    });
});

// A periodic check to verify players from the file are still connected
const cleanupInterval = setInterval(() => {
    console.log('Starting periodic player check...');

    for (const chunkId of chunkManager.getCachedChunkIds()) {
        const chunkData = chunkManager.getChunk(chunkId);
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
            chunkManager.saveChunk(chunkId);
            messageRouter.queueProximityUpdate(chunkId);
            console.log(`Queued proximity_update for chunk ${chunkId} due to cleanup`);
        }
    }

    console.log('Periodic player check finished');
}, 60000);

// Clean up the intervals when the server closes
wss.on('close', () => {
    clearInterval(notificationInterval);
    clearInterval(cleanupInterval);
});

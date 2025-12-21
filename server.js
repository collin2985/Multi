// File: server.js
// Location: C:\Users\colli\Desktop\test Horses\Horses\server.js
// Modularized server with clean separation of concerns

const WebSocket = require('ws');
const ChunkManager = require('./server/ChunkStore');
const MessageRouter = require('./server/Broadcaster');
const MessageHandlers = require('./server/MessageHandlers');
const CookingSystem = require('./server/CookingSystem');
const TileworksSystem = require('./server/TileworksSystem');
const AuthManager = require('./server/AuthManager');
const FriendsManager = require('./server/FriendsManager');

// Async initialization function
async function initializeServer() {
    console.log('Initializing server...');

    // Initialize modular components
    const clients = new Map();
    const pendingPositionRequests = new Map();  // For friend spawn position requests
    const chunkManager = new ChunkManager(12345); // terrain seed

    // Initialize database connection
    await chunkManager.initialize();

    // Initialize authentication manager
    await AuthManager.initialize();

    // Initialize friends manager
    await FriendsManager.initialize();
    FriendsManager.setConnectedClients(clients);
    FriendsManager.setAuthManager(AuthManager);

    const messageRouter = new MessageRouter(clients);
    const cookingSystem = new CookingSystem(chunkManager, messageRouter, null);
    const tileworksSystem = new TileworksSystem(chunkManager, messageRouter, null);
    const messageHandlers = new MessageHandlers(chunkManager, messageRouter, clients, cookingSystem, tileworksSystem);

    // Connect timeTracker to cooking systems for accurate ETA calculations
    cookingSystem.timeTrackerService = messageHandlers.timeTracker;
    tileworksSystem.timeTrackerService = messageHandlers.timeTracker;

    // Connect AuthManager to message handlers
    messageHandlers.authManager = AuthManager;

    // Start notification queue processing
    const notificationInterval = messageRouter.startNotificationProcessing(
        (chunkId) => chunkManager.getPlayersInProximity(chunkId)
    );

    // Create WebSocket server on port 8080
    const wss = new WebSocket.Server({ port: 8080 });
    console.log('Server started on port 8080');

    return { wss, clients, chunkManager, messageRouter, messageHandlers, notificationInterval, pendingPositionRequests };
}

// Start the server
initializeServer().then(({ wss, clients, chunkManager, messageRouter, messageHandlers, notificationInterval, pendingPositionRequests }) => {

// Global tick counter for deterministic simulation sync
let serverTick = 0;
const TICK_INTERVAL = 1000; // 1 second per tick

setInterval(() => {
    serverTick++;
    messageHandlers.serverTick = serverTick;  // Expose to MessageHandlers
    // Also update cookingSystem for tick-based cooking
    if (messageHandlers.cookingSystem) {
        messageHandlers.cookingSystem.serverTick = serverTick;
    }
    if (messageHandlers.tileworksSystem) {
        messageHandlers.tileworksSystem.serverTick = serverTick;
    }
    messageRouter.broadcastToAll({
        type: 'tick',
        payload: { tick: serverTick }
    });

    // Evict distant chunks from cache every 60 ticks (1 minute)
    if (serverTick % 60 === 0) {
        const activePlayerChunks = [];
        for (const [clientId, clientData] of clients) {
            if (clientData.currentChunk) {
                activePlayerChunks.push(clientData.currentChunk);
            }
        }
        chunkManager.evictDistantChunks(activePlayerChunks);
    }
}, TICK_INTERVAL);

console.log('Tick broadcaster started (1 tick/second)');

// Handle new connections
wss.on('connection', ws => {
    console.log('A new client connected');

    // Send a welcome message
    ws.send(JSON.stringify({ type: 'welcome', message: 'Welcome to the server!' }));

    ws.on('message', async (message) => {
        let parsedMessage;
        try {
            parsedMessage = JSON.parse(message);
        } catch (error) {
            console.error('Invalid message received:', error);
            return;
        }
        const { type, payload } = parsedMessage;

        // Route message to appropriate handler
        switch (type) {
            case 'join_chunk':
                await messageHandlers.handleJoinChunk(ws, payload);
                break;

            case 'chunk_update':
                messageHandlers.handleChunkUpdate(payload);
                break;

            case 'add_object_request':
                await messageHandlers.handleAddObject(payload);
                break;

            case 'place_construction_site':
                await messageHandlers.handlePlaceConstructionSite(payload);
                break;

            case 'place_road':
                await messageHandlers.handlePlaceRoad(payload);
                break;

            case 'place_boat':
                await messageHandlers.handlePlaceBoat(payload);
                break;

            case 'place_horse':
                await messageHandlers.handlePlaceHorse(payload);
                break;

            case 'claim_boat':
                await messageHandlers.handleClaimBoat(ws, payload);
                break;

            case 'release_boat':
                await messageHandlers.handleReleaseBoat(ws, payload);
                break;

            case 'claim_mobile_entity':
                await messageHandlers.handleClaimMobileEntity(ws, payload);
                break;

            case 'release_mobile_entity':
                await messageHandlers.handleReleaseMobileEntity(ws, payload);
                break;

            case 'place_cart':
                await messageHandlers.handlePlaceCart(payload);
                break;

            case 'place_crate':
                await messageHandlers.handlePlaceCrate(payload);
                break;

            case 'claim_crate':
                await messageHandlers.handleClaimCrate(ws, payload);
                break;

            case 'release_crate':
                await messageHandlers.handleReleaseCrate(ws, payload);
                break;

            case 'claim_cart':
                await messageHandlers.handleClaimCart(ws, payload);
                break;

            case 'release_cart':
                await messageHandlers.handleReleaseCart(ws, payload);
                break;

            case 'place_campfire':
                await messageHandlers.handlePlaceCampfire(payload);
                break;

            case 'place_tent':
                await messageHandlers.handlePlaceTent(payload);
                break;

            case 'place_outpost':
                await messageHandlers.handlePlaceOutpost(payload);
                break;

            case 'plant_tree':
                await messageHandlers.handlePlantTree(payload);
                break;

            case 'build_construction':
                await messageHandlers.handleBuildConstruction(payload);
                break;

            case 'repair_structure':
                await messageHandlers.handleRepairStructure(payload);
                break;

            case 'update_construction_materials':
                await messageHandlers.handleUpdateConstructionMaterials(payload);
                break;

            case 'get_crate_inventory':
                await messageHandlers.handleGetCrateInventory(ws, payload);
                break;

            case 'save_crate_inventory':
                await messageHandlers.handleSaveCrateInventory(ws, payload);
                break;

            case 'cooking_complete':
                await messageHandlers.handleCookingComplete(ws, payload);
                break;

            case 'processing_complete':
                await messageHandlers.handleProcessingComplete(ws, payload);
                break;

            case 'tree_growth_complete':
                await messageHandlers.handleTreeGrowthComplete(ws, payload);
                break;

            // Client-triggered decay system
            case 'convert_to_ruin':
                await messageHandlers.handleConvertToRuin(ws, payload);
                break;

            case 'remove_ruin':
                await messageHandlers.handleRemoveRuin(ws, payload);
                break;

            // Client-triggered dock ship system
            case 'trigger_dock_ship':
                await messageHandlers.handleTriggerDockShip(ws, payload);
                break;

            case 'ship_departing':
                await messageHandlers.handleShipDeparting(ws, payload);
                break;

            // Inventory locking system
            case 'lock_inventory':
                await messageHandlers.handleLockInventory(ws, payload);
                break;

            case 'unlock_inventory':
                await messageHandlers.handleUnlockInventory(ws, payload);
                break;

            case 'confirm_lock':
                await messageHandlers.handleConfirmLock(ws, payload);
                break;

            case 'save_tasks_closed':
                // Save tasksPanelClosed flag for accounts
                if (ws.accountId && AuthManager) {
                    try {
                        await AuthManager.updatePlayerField(ws.accountId, 'tasksPanelClosed', true);
                        console.log(`[Tasks] Saved tasksPanelClosed for account ${ws.accountId}`);
                    } catch (err) {
                        console.error('[Tasks] Failed to save tasksPanelClosed:', err);
                    }
                }
                break;

            case 'save_task_progress':
                // Save task completions array for accounts
                if (ws.accountId && AuthManager && payload.completions) {
                    try {
                        await AuthManager.updatePlayerField(ws.accountId, 'taskCompletions', payload.completions);
                        console.log(`[Tasks] Saved ${payload.completions.length} task completions for account ${ws.accountId}`);
                    } catch (err) {
                        console.error('[Tasks] Failed to save task completions:', err);
                    }
                }
                break;

            case 'buy_item':
                await messageHandlers.handleBuyItem(ws, payload);
                break;

            case 'sell_item':
                await messageHandlers.handleSellItem(ws, payload);
                break;

            case 'remove_object_request':
                await messageHandlers.handleRemoveObject(payload);
                break;

            case 'harvest_resource_request':
                await messageHandlers.handleHarvestResource(payload);
                break;

            case 'webrtc_offer':
            case 'webrtc_answer':
            case 'webrtc_ice_candidate':
                messageHandlers.handleWebRTCSignaling(type, message, payload);
                break;

            // Authentication messages
            case 'register_request':
                if (AuthManager) {
                    const registerResult = await AuthManager.register(payload.username, payload.password);
                    // Set accountId on websocket so subsequent messages (like set_faction) work
                    if (registerResult.success) {
                        ws.accountId = registerResult.playerId;

                        // Transfer structure ownership from guest clientId to new accountId
                        if (ws.clientId) {
                            const transferred = await messageHandlers.transferStructureOwnership(
                                ws.clientId,
                                registerResult.playerId
                            );

                            // If structures were transferred, find house/tent and set as home
                            if (transferred > 0) {
                                const homeStructure = await messageHandlers.findOwnedHome(registerResult.playerId);
                                if (homeStructure) {
                                    await AuthManager.setHome(
                                        registerResult.playerId,
                                        homeStructure.id,
                                        homeStructure.x,
                                        homeStructure.z
                                    );
                                    // Notify client their home was set
                                    ws.send(JSON.stringify({
                                        type: 'home_set',
                                        payload: {
                                            structureId: homeStructure.id,
                                            x: homeStructure.x,
                                            z: homeStructure.z
                                        }
                                    }));
                                }
                            }
                        }
                    }
                    ws.send(JSON.stringify({
                        type: 'register_response',
                        payload: {
                            ...registerResult,
                            requestId: payload.requestId  // Include requestId in response
                        }
                    }));
                }
                break;

            case 'login_request':
                if (AuthManager) {
                    const loginResult = await AuthManager.login(payload.username, payload.password);

                    // If login successful, load player data for spawn system
                    if (loginResult.success) {
                        // Set accountId on websocket so subsequent messages work
                        ws.accountId = loginResult.playerId;
                        const playerData = await AuthManager.loadPlayerData(loginResult.playerId);
                        ws.send(JSON.stringify({
                            type: 'login_response',
                            payload: {
                                ...loginResult,
                                playerData: playerData,  // Include faction/home info
                                requestId: payload.requestId
                            }
                        }));
                    } else {
                        ws.send(JSON.stringify({
                            type: 'login_response',
                            payload: {
                                ...loginResult,
                                requestId: payload.requestId
                            }
                        }));
                    }
                }
                break;

            case 'validate_session':
                if (AuthManager) {
                    const sessionResult = await AuthManager.validateSession(payload.token);

                    // If session is valid, load player data for spawn system (like login does)
                    let playerData = null;
                    if (sessionResult.valid && sessionResult.playerId) {
                        // Set accountId on websocket so subsequent messages work
                        ws.accountId = sessionResult.playerId;
                        playerData = await AuthManager.loadPlayerData(sessionResult.playerId);
                    }

                    ws.send(JSON.stringify({
                        type: 'session_validation',
                        payload: {
                            ...sessionResult,
                            playerData: playerData,  // Include player data with home/faction info
                            requestId: payload.requestId  // Include requestId in response
                        }
                    }));
                }
                break;

            case 'logout_request':
                if (AuthManager) {
                    const logoutResult = await AuthManager.logout(payload.token);
                    ws.send(JSON.stringify({
                        type: 'logout_response',
                        payload: {
                            ...logoutResult,
                            requestId: payload.requestId  // Include requestId in response
                        }
                    }));
                }
                break;

            case 'auth_upgrade':
                // Handle guest -> registered player upgrade
                if (ws.clientId && AuthManager) {
                    const client = clients.get(ws.clientId);
                    if (client) {
                        const oldClientId = ws.clientId;  // Store the session ID before updating
                        client.accountId = payload.accountId;
                        ws.accountId = payload.accountId;

                        // Save current game state
                        if (payload.accountId) {
                            await AuthManager.savePlayerData(payload.accountId, {
                                inventory: payload.inventory,
                                position: payload.position,
                                currentChunk: client.currentChunk,
                                health: payload.health || 100,
                                hunger: payload.hunger || 100,
                                stats: payload.stats || {}
                            });

                            // Transfer ownership of all structures from session ID to account ID
                            const structuresTransferred = await messageHandlers.transferStructureOwnership(
                                oldClientId,
                                payload.accountId
                            );

                            // If structures were transferred, find house/tent and set as home
                            if (structuresTransferred > 0) {
                                const homeStructure = await messageHandlers.findOwnedHome(payload.accountId);
                                if (homeStructure) {
                                    await AuthManager.setHome(
                                        payload.accountId,
                                        homeStructure.id,
                                        homeStructure.x,
                                        homeStructure.z
                                    );
                                    // Notify client their home was set
                                    ws.send(JSON.stringify({
                                        type: 'home_set',
                                        payload: {
                                            structureId: homeStructure.id,
                                            x: homeStructure.x,
                                            z: homeStructure.z
                                        }
                                    }));
                                }
                            }

                            console.log(`Player ${ws.clientId} upgraded to account ${payload.accountId}, transferred ${structuresTransferred} structures`);
                            ws.send(JSON.stringify({
                                type: 'auth_upgrade_success',
                                payload: {
                                    message: 'Account linked successfully',
                                    structuresTransferred,  // Include count in response
                                    requestId: payload.requestId  // Include requestId in response
                                }
                            }));
                        }
                    }
                }
                break;

            // ==========================================
            // FRIEND SYSTEM MESSAGES
            // ==========================================

            case 'friend_request':
                if (ws.accountId && FriendsManager) {
                    const result = await FriendsManager.sendFriendRequest(ws.accountId, payload.username);
                    ws.send(JSON.stringify({
                        type: 'friend_request_response',
                        payload: result
                    }));

                    // Notify target player if online
                    if (result.success && result.targetPlayerId) {
                        // Get the SENDER's username (not the target)
                        const senderUsername = await AuthManager.getUsernameById(ws.accountId);
                        for (const [clientId, client] of clients) {
                            if (client.accountId === result.targetPlayerId && client.ws) {
                                client.ws.send(JSON.stringify({
                                    type: 'friend_request_received',
                                    payload: {
                                        requestId: result.requestId,
                                        fromUsername: senderUsername || 'Unknown'
                                    }
                                }));
                                break;
                            }
                        }
                    }
                } else {
                    ws.send(JSON.stringify({
                        type: 'friend_request_response',
                        payload: { success: false, message: 'Must be logged in to add friends' }
                    }));
                }
                break;

            case 'friend_accept':
                if (ws.accountId && FriendsManager) {
                    const result = await FriendsManager.acceptFriendRequest(ws.accountId, payload.requestId);
                    ws.send(JSON.stringify({
                        type: 'friend_accept_response',
                        payload: result
                    }));

                    // Notify the original sender that their request was accepted
                    if (result.success && result.senderPlayerId) {
                        const accepterUsername = await AuthManager.getUsernameById(ws.accountId);
                        for (const [clientId, client] of clients) {
                            if (client.accountId === result.senderPlayerId && client.ws) {
                                client.ws.send(JSON.stringify({
                                    type: 'friend_request_accepted',
                                    payload: {
                                        friendUsername: accepterUsername || 'Unknown'
                                    }
                                }));
                                break;
                            }
                        }
                    }
                }
                break;

            case 'friend_decline':
                if (ws.accountId && FriendsManager) {
                    const result = await FriendsManager.declineFriendRequest(ws.accountId, payload.requestId);
                    ws.send(JSON.stringify({
                        type: 'friend_decline_response',
                        payload: result
                    }));
                }
                break;

            case 'friend_remove':
                if (ws.accountId && FriendsManager) {
                    const result = await FriendsManager.removeFriend(ws.accountId, payload.friendId);
                    ws.send(JSON.stringify({
                        type: 'friend_remove_response',
                        payload: result
                    }));
                }
                break;

            case 'get_friends_list':
                if (ws.accountId && FriendsManager) {
                    const friends = await FriendsManager.getFriendsList(ws.accountId);
                    ws.send(JSON.stringify({
                        type: 'friends_list_response',
                        payload: { friends }
                    }));
                } else {
                    ws.send(JSON.stringify({
                        type: 'friends_list_response',
                        payload: { friends: [] }
                    }));
                }
                break;

            case 'get_friend_position':
                // Find the friend's WebSocket and request their position
                if (ws.accountId && payload.friendId) {
                    let friendWs = null;
                    // Find client with matching accountId
                    for (const [clientId, client] of clients) {
                        if (client.accountId === payload.friendId) {
                            friendWs = client.ws;
                            break;
                        }
                    }

                    if (friendWs && friendWs.readyState === 1) {
                        // Store pending request to relay response
                        const requestId = `${ws.accountId}_${payload.friendId}_${Date.now()}`;
                        pendingPositionRequests.set(requestId, {
                            requesterWs: ws,
                            friendId: payload.friendId
                        });

                        // Set timeout to clean up if friend doesn't respond
                        setTimeout(() => {
                            const request = pendingPositionRequests.get(requestId);
                            if (request) {
                                // Send failure response to requester
                                if (request.requesterWs.readyState === 1) {
                                    request.requesterWs.send(JSON.stringify({
                                        type: 'friend_position_response',
                                        payload: { friendId: request.friendId, success: false, reason: 'timeout' }
                                    }));
                                }
                                pendingPositionRequests.delete(requestId);
                            }
                        }, 4000); // 4 second timeout (before client's 5 second timeout)

                        // Ask friend for their position
                        friendWs.send(JSON.stringify({
                            type: 'position_request',
                            payload: { requestId }
                        }));
                    } else {
                        // Friend not online
                        ws.send(JSON.stringify({
                            type: 'friend_position_response',
                            payload: { friendId: payload.friendId, success: false }
                        }));
                    }
                }
                break;

            case 'position_response':
                // Relay position back to requester
                if (payload.requestId && pendingPositionRequests) {
                    const request = pendingPositionRequests.get(payload.requestId);
                    if (request && request.requesterWs.readyState === 1) {
                        if (payload.unavailable) {
                            // Forward the specific reason from client (or default to 'not_spawned')
                            request.requesterWs.send(JSON.stringify({
                                type: 'friend_position_response',
                                payload: {
                                    friendId: request.friendId,
                                    success: false,
                                    reason: payload.reason || 'not_spawned',
                                    entityType: payload.entityType
                                }
                            }));
                        } else {
                            request.requesterWs.send(JSON.stringify({
                                type: 'friend_position_response',
                                payload: {
                                    friendId: request.friendId,
                                    success: true,
                                    position: { x: payload.x, z: payload.z }
                                }
                            }));
                        }
                    }
                    pendingPositionRequests.delete(payload.requestId);
                }
                break;

            // ==========================================
            // FACTION SYSTEM MESSAGES
            // ==========================================

            case 'set_faction':
                if (ws.accountId && AuthManager) {
                    const result = await AuthManager.setFaction(ws.accountId, payload.factionId);
                    ws.send(JSON.stringify({
                        type: 'set_faction_response',
                        payload: result
                    }));
                }
                break;

            case 'change_faction':
                if (ws.accountId && AuthManager) {
                    const result = await AuthManager.changeFaction(ws.accountId, payload.factionId, chunkManager);
                    ws.send(JSON.stringify({
                        type: 'change_faction_response',
                        payload: {
                            ...result,
                            factionId: payload.factionId
                        }
                    }));
                } else {
                    ws.send(JSON.stringify({
                        type: 'change_faction_response',
                        payload: { success: false, message: 'Must be logged in to change faction' }
                    }));
                }
                break;

            case 'get_home_info':
                if (ws.accountId && AuthManager) {
                    const homeInfo = await AuthManager.getHomeInfo(ws.accountId, chunkManager);
                    ws.send(JSON.stringify({
                        type: 'home_info_response',
                        payload: homeInfo
                    }));
                } else {
                    ws.send(JSON.stringify({
                        type: 'home_info_response',
                        payload: { exists: false }
                    }));
                }
                break;

            default:
                console.error('Unknown message type:', type);
        }
    });

    ws.on('close', async () => {
        if (ws.clientId) {
            console.log(`Client ${ws.clientId} disconnected`);
            const clientData = clients.get(ws.clientId);

            // Release any inventory locks held by this client
            await messageHandlers.releaseAllLocksForClient(ws.clientId);

            // Cleanup any mobile entities (horses, boats) claimed by this client
            await messageHandlers.cleanupMobileEntitiesForClient(ws.clientId);

            // Cleanup any crates loaded on carts by this client
            await messageHandlers.cleanupLoadedCratesForClient(ws.clientId);

            // Save player data if authenticated
            if (clientData && clientData.accountId && AuthManager) {
                // In a real implementation, we'd need to get the current player state from the client
                // For now, we'll just log that we would save
                console.log(`Would save data for authenticated player ${clientData.accountId}`);
                // TODO: Implement periodic state sync from client or request state before disconnect
            }

            if (clientData && clientData.currentChunk) {
                await chunkManager.removePlayerFromChunk(clientData.currentChunk, ws.clientId);

                messageRouter.queueProximityUpdate(clientData.currentChunk);
                console.log(`Queued proximity_update for chunk ${clientData.currentChunk} due to disconnection`);
            }
            clients.delete(ws.clientId);
        }
    });
});

    // Clean up the intervals when the server closes
    wss.on('close', () => {
        clearInterval(notificationInterval);
        if (messageHandlers.timeTracker) {
            messageHandlers.timeTracker.stop();
        }
    });
}).catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});

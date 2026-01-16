// File: server.js
// Location: C:\Users\colli\Desktop\test Horses\Horses\server.js
// Modularized server with clean separation of concerns

const WebSocket = require('ws');
const ChunkManager = require('./server/ChunkStore');
const MessageRouter = require('./server/Broadcaster');
const MessageHandlers = require('./server/MessageHandlers');
const CookingSystem = require('./server/CookingSystem');
const TileworksSystem = require('./server/TileworksSystem');
const IronworksSystem = require('./server/IronworksSystem');
const BlacksmithSystem = require('./server/BlacksmithSystem');
const BakerySystem = require('./server/BakerySystem');
const FishermanSystem = require('./server/FishermanSystem');
const AuthManager = require('./server/AuthManager');
const FriendsManager = require('./server/FriendsManager');
const AuditLogger = require('./server/AuditLogger');
const ChunkCoordinates = require('./server/ServerChunkCoords');

// ============================================
// SERVER VERSION - INCREMENT WHEN YOU DEPLOY
// ============================================
// This forces clients to hard-refresh and get new code
// Bump this number whenever you push code changes
const SERVER_VERSION = 6;

// Async initialization function
async function initializeServer() {
    const db = require('./server/DatabaseManager');
    console.log('===========================================');
    console.log(`Server starting in ${db.isOnlineMode ? 'ONLINE' : 'LOCAL'} mode`);
    console.log(`Version: ${SERVER_VERSION}`);
    console.log('===========================================');

    // Initialize modular components
    const clients = new Map();
    const pendingPositionRequests = new Map();  // For friend spawn position requests
    const chunkManager = new ChunkManager(12345); // terrain seed

    // Initialize database connection
    await chunkManager.initialize();

    // Load persisted server state (tick only - version is now hardcoded)
    const serverState = await chunkManager.loadServerState();
    const initialTick = serverState.tick;
    console.log(`Server state: tick=${initialTick}, version=${SERVER_VERSION} (hardcoded)`);

    // Initialize authentication manager
    await AuthManager.initialize();

    // Initialize friends manager
    await FriendsManager.initialize();
    FriendsManager.setConnectedClients(clients);
    FriendsManager.setAuthManager(AuthManager);

    // Initialize audit logger (uses DB if available, otherwise files)
    const auditLogger = new AuditLogger(db, chunkManager.dbReady);

    const messageRouter = new MessageRouter(clients);
    const cookingSystem = new CookingSystem(chunkManager, messageRouter, null);
    const tileworksSystem = new TileworksSystem(chunkManager, messageRouter);
    const ironworksSystem = new IronworksSystem(chunkManager, messageRouter);
    const blacksmithSystem = new BlacksmithSystem(chunkManager, messageRouter);
    const bakerySystem = new BakerySystem(chunkManager, messageRouter);
    const fishermanSystem = new FishermanSystem(chunkManager, messageRouter);
    const messageHandlers = new MessageHandlers(chunkManager, messageRouter, clients, cookingSystem, tileworksSystem, ironworksSystem, blacksmithSystem, bakerySystem, fishermanSystem, auditLogger);

    // Connect timeTracker to cooking system for accurate ETA calculations
    cookingSystem.timeTrackerService = messageHandlers.timeTracker;

    // Connect AuthManager to message handlers
    messageHandlers.authManager = AuthManager;

    // Connect AuthManager to spawn tasks (for influence system)
    messageHandlers.spawnTasks.authManager = AuthManager;

    // Start notification queue processing
    const notificationInterval = messageRouter.startNotificationProcessing(
        (chunkId) => chunkManager.getPlayersInProximity(chunkId)
    );

    // Create WebSocket server on port 8080
    const wss = new WebSocket.Server({ port: 8080 });
    console.log('Server started on port 8080');

    return { wss, clients, chunkManager, messageRouter, messageHandlers, notificationInterval, pendingPositionRequests, initialTick, auditLogger };
}

// Start the server
initializeServer().then(({ wss, clients, chunkManager, messageRouter, messageHandlers, notificationInterval, pendingPositionRequests, initialTick, auditLogger }) => {

// Global tick counter for deterministic simulation sync (persisted across restarts)
let serverTick = initialTick;
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
    if (messageHandlers.ironworksSystem) {
        messageHandlers.ironworksSystem.serverTick = serverTick;
    }
    if (messageHandlers.blacksmithSystem) {
        messageHandlers.blacksmithSystem.serverTick = serverTick;
    }
    if (messageHandlers.bakerySystem) {
        messageHandlers.bakerySystem.serverTick = serverTick;
    }
    if (messageHandlers.fishermanSystem) {
        messageHandlers.fishermanSystem.serverTick = serverTick;
    }
    messageRouter.broadcastToAll({
        type: 'tick',
        payload: { tick: serverTick }
    });

    // Every 60 ticks (1 minute): save server state and evict distant chunks
    if (serverTick % 60 === 0) {
        // Save server tick to persist across restarts
        chunkManager.saveServerState(serverTick);

        // Evict distant chunks from cache
        const activePlayerChunks = [];
        for (const [clientId, clientData] of clients) {
            if (clientData.currentChunk) {
                activePlayerChunks.push(clientData.currentChunk);
            }
        }
        chunkManager.evictDistantChunks(activePlayerChunks);
    }

    // Every 30 ticks (30 seconds): check for banned players and kick them
    if (serverTick % 30 === 0 && AuthManager) {
        (async () => {
            for (const [clientId, clientData] of clients) {
                if (clientData.ws && clientData.ws.accountId) {
                    // Get player's fingerprint from database
                    const db = require('./server/DatabaseManager');
                    if (db.isConnected) {
                        try {
                            const result = await db.query(
                                'SELECT fingerprint_hash FROM players WHERE id = $1',
                                [clientData.ws.accountId]
                            );
                            if (result.rows.length > 0 && result.rows[0].fingerprint_hash) {
                                const fpCheck = await AuthManager.checkFingerprint(
                                    result.rows[0].fingerprint_hash,
                                    null
                                );
                                if (fpCheck.banned) {
                                    console.log(`Kicking banned player: ${clientData.ws.username}`);
                                    clientData.ws.send(JSON.stringify({
                                        type: 'kicked',
                                        payload: { reason: 'Connection terminated' }
                                    }));
                                    clientData.ws.close();
                                }
                            }
                        } catch (e) {
                            // Silently continue on error
                        }
                    }
                }
            }
        })();
    }
}, TICK_INTERVAL);

console.log('Tick broadcaster started (1 tick/second)');

// Handle new connections
wss.on('connection', ws => {
    console.log('A new client connected');

    // Capture IP address for audit logging
    ws.ipAddress = ws._socket.remoteAddress;

    // Send a welcome message with server version for cache invalidation
    ws.send(JSON.stringify({ type: 'welcome', message: 'Welcome to the server!', serverVersion: SERVER_VERSION }));

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
                await messageHandlers.handleChunkUpdate(payload);
                break;

            case 'add_object_request':
                await messageHandlers.handleAddObject(ws, payload);
                break;

            case 'place_construction_site':
                await messageHandlers.handlePlaceConstructionSite(ws, payload);
                break;

            case 'place_road':
                await messageHandlers.handlePlaceRoad(ws, payload);
                break;

            case 'place_boat':
                await messageHandlers.handlePlaceBoat(payload);
                break;

            case 'place_sailboat':
                await messageHandlers.handlePlaceSailboat(payload);
                break;

            case 'place_ship2':
                await messageHandlers.handlePlaceShip2(payload);
                break;

            case 'place_horse':
                await messageHandlers.handlePlaceHorse(payload);
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

            case 'place_artillery':
                await messageHandlers.handlePlaceArtillery(payload);
                break;

            case 'claim_artillery':
                await messageHandlers.handleClaimArtillery(ws, payload);
                break;

            case 'release_artillery':
                await messageHandlers.handleReleaseArtillery(ws, payload);
                break;

            // Ship artillery loading (reuses same handlers as horse towing)
            case 'claim_ship_artillery':
                await messageHandlers.handleClaimArtillery(ws, payload);
                break;

            case 'release_ship_artillery':
                await messageHandlers.handleReleaseArtillery(ws, payload);
                break;

            // Ship horse loading (reuses same handlers as artillery)
            case 'claim_ship_horse':
                await messageHandlers.handleClaimArtillery(ws, payload);
                break;

            case 'release_ship_horse':
                await messageHandlers.handleReleaseArtillery(ws, payload);
                break;

            case 'place_campfire':
                await messageHandlers.handlePlaceCampfire(payload);
                break;

            case 'place_tent':
                await messageHandlers.handlePlaceTent(payload);
                break;

            case 'place_wall':
                await messageHandlers.handlePlaceWall(ws, payload);
                break;

            case 'place_outpost':
                await messageHandlers.handlePlaceOutpost(payload);
                break;

            case 'place_bearden':
                await messageHandlers.handlePlaceBearden(payload);
                break;

            case 'place_deertree':
                await messageHandlers.handlePlaceDeertree(payload);
                break;

            case 'plant_tree':
                await messageHandlers.handlePlantTree(payload);
                break;

            case 'build_construction':
                await messageHandlers.handleBuildConstruction(ws, payload);
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

            // Artillery structure damage
            case 'artillery_structure_damage':
                await messageHandlers.handleArtilleryStructureDamage(ws, payload);
                break;

            // Artillery boat sinking (boats sink with animation instead of becoming ruins)
            case 'artillery_boat_sink':
                await messageHandlers.handleArtilleryBoatSink(ws, payload);
                break;

            // Client-triggered dock ship system
            case 'trigger_dock_ship':
                await messageHandlers.handleTriggerDockShip(ws, payload);
                break;

            case 'ship_departing':
                await messageHandlers.handleShipDeparting(ws, payload);
                break;

            case 'toggle_market_shipments':
                await messageHandlers.handleToggleMarketShipments(ws, payload);
                break;

            case 'toggle_merchant_ships':
                await messageHandlers.handleToggleMerchantShips(ws, payload);
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

            case 'sell_to_proprietor':
                await messageHandlers.handleSellToProprietor(ws, payload);
                break;

            case 'request_militia':
                await messageHandlers.handleRequestMilitia(ws, payload);
                break;

            case 'request_outpost_militia':
                await messageHandlers.handleRequestOutpostMilitia(ws, payload);
                break;

            case 'request_artillery_militia':
                await messageHandlers.handleRequestArtilleryMilitia(ws, payload);
                break;

            case 'buy_horse':
                await messageHandlers.handleBuyHorse(ws, payload);
                break;

            case 'sell_horse':
                await messageHandlers.handleSellHorse(ws, payload);
                break;

            // NPC Baker inventory handlers
            case 'npc_collect_apples':
                await messageHandlers.handleNPCCollectApples(ws, payload);
                break;

            case 'npc_deposit_inventory':
                await messageHandlers.handleNPCDeposit(ws, payload);
                break;

            case 'npc_collect_from_structure':
                await messageHandlers.handleNPCCollectFromStructure(ws, payload);
                break;

            case 'npc_collect_from_market':
                await messageHandlers.handleNPCCollectFromMarket(ws, payload);
                break;

            case 'npc_deposit_to_market':
                await messageHandlers.handleNPCDepositToMarket(ws, payload);
                break;

            case 'npc_check_bakery_processing':
                await messageHandlers.handleNPCCheckBakeryProcessing(ws, payload);
                break;

            case 'npc_check_structure_processing':
                await messageHandlers.handleNPCCheckStructureProcessing(ws, payload);
                break;

            case 'npc_remove_excess_firewood':
                await messageHandlers.handleNPCRemoveExcessFirewood(ws, payload);
                break;

            case 'npc_clear_left_slot_and_deposit':
                await messageHandlers.handleNPCClearLeftSlotAndDeposit(ws, payload);
                break;

            case 'remove_object_request':
                await messageHandlers.handleRemoveObject(ws, payload);
                break;

            case 'harvest_resource_request':
                await messageHandlers.handleHarvestResource(ws, payload);
                break;

            case 'webrtc_offer':
            case 'webrtc_answer':
            case 'webrtc_ice_candidate':
                messageHandlers.handleWebRTCSignaling(type, message, payload);
                break;

            // Authentication messages
            case 'register_request':
                if (AuthManager) {
                    // Check fingerprint before registration
                    if (payload.fingerprint) {
                        const fpCheck = await AuthManager.checkFingerprint(
                            payload.fingerprint,
                            payload.partialHashes
                        );

                        // Log fingerprint check
                        if (auditLogger) {
                            auditLogger.log({
                                action_type: 11, // FINGERPRINT_CHECK
                                actor_name: payload.username,
                                data: {
                                    result: fpCheck.type,
                                    banned: fpCheck.banned,
                                    hash: payload.fingerprint?.substring(0, 16) + '...'
                                }
                            });
                        }

                        if (fpCheck.banned) {
                            ws.send(JSON.stringify({
                                type: 'register_response',
                                payload: {
                                    success: false,
                                    message: 'Registration unavailable',
                                    requestId: payload.requestId
                                }
                            }));
                            break;
                        }
                    }

                    const registerResult = await AuthManager.register(payload.username, payload.password);
                    // Set accountId and username on websocket so subsequent messages work
                    if (registerResult.success) {
                        // Store fingerprint with new account
                        if (payload.fingerprint) {
                            await AuthManager.storeFingerprint(
                                registerResult.playerId,
                                payload.fingerprint,
                                payload.partialHashes
                            );
                        }
                        ws.accountId = registerResult.playerId;
                        ws.username = payload.username;
                        messageRouter.addClientToAccount(registerResult.playerId, ws.clientId);

                        // Update clients Map so isPlayerOnline() works for friend spawning
                        const client = clients.get(ws.clientId);
                        if (client) {
                            client.accountId = registerResult.playerId;
                        }

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
                    // Check fingerprint before login
                    if (payload.fingerprint) {
                        const fpCheck = await AuthManager.checkFingerprint(
                            payload.fingerprint,
                            payload.partialHashes
                        );

                        // Log fingerprint check
                        if (auditLogger) {
                            auditLogger.log({
                                action_type: 11, // FINGERPRINT_CHECK
                                actor_name: payload.username,
                                data: {
                                    result: fpCheck.type,
                                    banned: fpCheck.banned,
                                    flagged: fpCheck.flagged,
                                    hash: payload.fingerprint?.substring(0, 16) + '...'
                                }
                            });
                        }

                        if (fpCheck.banned) {
                            ws.send(JSON.stringify({
                                type: 'login_response',
                                payload: {
                                    success: false,
                                    message: 'Access denied',
                                    requestId: payload.requestId
                                }
                            }));
                            break;
                        }

                        // Log partial matches for admin review
                        if (fpCheck.flagged && auditLogger) {
                            auditLogger.log({
                                action_type: 11, // FINGERPRINT_CHECK
                                actor_name: payload.username,
                                data: {
                                    flagged: true,
                                    matchCount: fpCheck.matchCount,
                                    similarTo: fpCheck.originalUser
                                }
                            });
                        }
                    }

                    const loginResult = await AuthManager.login(payload.username, payload.password);

                    // If login successful, load player data for spawn system
                    if (loginResult.success) {
                        // Store/update fingerprint with account
                        if (payload.fingerprint) {
                            await AuthManager.storeFingerprint(
                                loginResult.playerId,
                                payload.fingerprint,
                                payload.partialHashes
                            );
                        }
                        // Check if account already has an active connection
                        const existingConnections = messageRouter.accountClients.get(loginResult.playerId);
                        if (existingConnections && existingConnections.size > 0) {
                            ws.send(JSON.stringify({
                                type: 'login_response',
                                payload: {
                                    success: false,
                                    message: 'Account is already logged in',
                                    requestId: payload.requestId
                                }
                            }));
                            break;
                        }

                        // Set accountId and username on websocket so subsequent messages work
                        ws.accountId = loginResult.playerId;
                        ws.username = payload.username;
                        messageRouter.addClientToAccount(loginResult.playerId, ws.clientId);
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
                    // Check fingerprint before validating session
                    if (payload.fingerprint) {
                        const fpCheck = await AuthManager.checkFingerprint(
                            payload.fingerprint,
                            payload.partialHashes
                        );

                        if (fpCheck.banned) {
                            ws.send(JSON.stringify({
                                type: 'session_validation',
                                payload: {
                                    valid: false,
                                    reason: 'Session expired',
                                    requestId: payload.requestId
                                }
                            }));
                            break;
                        }
                    }

                    const sessionResult = await AuthManager.validateSession(payload.token);

                    // If session is valid, load player data for spawn system (like login does)
                    let playerData = null;
                    if (sessionResult.valid && sessionResult.playerId) {
                        // Update fingerprint on session validation
                        if (payload.fingerprint) {
                            await AuthManager.storeFingerprint(
                                sessionResult.playerId,
                                payload.fingerprint,
                                payload.partialHashes
                            );
                        }
                        // Check if account already has an active connection
                        const existingConnections = messageRouter.accountClients.get(sessionResult.playerId);
                        if (existingConnections && existingConnections.size > 0) {
                            ws.send(JSON.stringify({
                                type: 'session_validation',
                                payload: {
                                    valid: false,
                                    reason: 'Account is already logged in',
                                    requestId: payload.requestId
                                }
                            }));
                            break;
                        }

                        // Set accountId and username on websocket so subsequent messages work
                        ws.accountId = sessionResult.playerId;
                        ws.username = await AuthManager.getUsernameById(sessionResult.playerId);
                        messageRouter.addClientToAccount(sessionResult.playerId, ws.clientId);
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
                        // Check if account already has an active connection
                        const existingConnections = messageRouter.accountClients.get(payload.accountId);
                        if (existingConnections && existingConnections.size > 0) {
                            ws.send(JSON.stringify({
                                type: 'auth_upgrade_error',
                                payload: {
                                    success: false,
                                    message: 'Account is already logged in',
                                    requestId: payload.requestId
                                }
                            }));
                            break;
                        }

                        const oldClientId = ws.clientId;  // Store the session ID before updating
                        client.accountId = payload.accountId;
                        ws.accountId = payload.accountId;
                        ws.username = payload.username || await AuthManager.getUsernameById(payload.accountId);
                        messageRouter.addClientToAccount(payload.accountId, ws.clientId);

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
                    const result = await AuthManager.changeFaction(ws.accountId, payload.factionId, chunkManager, payload.preserveOwnership);
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

            case 'admin_broadcast':
                // Validate admin secret
                const adminSecret = process.env.ADMIN_SECRET;
                if (!adminSecret || payload.secret !== adminSecret) {
                    ws.send(JSON.stringify({
                        type: 'admin_broadcast_response',
                        payload: { success: false, error: 'Invalid admin secret' }
                    }));
                    break;
                }

                // Broadcast to all connected players
                let playerCount = 0;
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'admin_broadcast',
                            payload: { message: payload.message }
                        }));
                        playerCount++;
                    }
                });

                console.log(`Admin broadcast sent to ${playerCount} players: "${payload.message}"`);

                // Send success response back to admin
                ws.send(JSON.stringify({
                    type: 'admin_broadcast_response',
                    payload: { success: true, playerCount: playerCount }
                }));
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

            // Audit log disconnect
            if (auditLogger) {
                const parsed = clientData?.currentChunk
                    ? ChunkCoordinates.parseChunkIdSafe(clientData.currentChunk)
                    : null;
                auditLogger.logDisconnect(
                    ws.clientId, ws.accountId,
                    parsed?.chunkX, parsed?.chunkZ, ws.username
                );
            }

            // Remove from accountId index before deleting client
            if (ws.accountId) {
                messageRouter.removeClientFromAccount(ws.accountId, ws.clientId);
            }
            clients.delete(ws.clientId);
        }
    });
});

    // Clean up the intervals when the server closes
    wss.on('close', async () => {
        clearInterval(notificationInterval);
        if (messageHandlers.timeTracker) {
            messageHandlers.timeTracker.stop();
        }
        if (auditLogger) {
            await auditLogger.close();
        }
    });

    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
        console.log('Received SIGTERM, shutting down gracefully...');
        if (auditLogger) {
            await auditLogger.close();
        }
        process.exit(0);
    });

    process.on('SIGINT', async () => {
        console.log('Received SIGINT, shutting down gracefully...');
        if (auditLogger) {
            await auditLogger.close();
        }
        process.exit(0);
    });
}).catch(error => {
    console.error('===========================================');
    console.error('FATAL: Server initialization failed');
    console.error('===========================================');
    console.error(error.message || error);
    console.error('');
    console.error('If in online mode, database connection may have failed.');
    console.error('Server will exit. Render will restart automatically.');
    process.exit(1);
});

// File: server.js
// Location: C:\Users\colli\Desktop\test Horses\Horses\server.js
// Modularized server with clean separation of concerns

require('dotenv').config();

const http = require('http');
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
const db = require('./server/DatabaseManager');

// ============================================
// SERVER VERSION - AUTO-GENERATED ON STARTUP
// ============================================
// Uses startup timestamp so clients auto-refresh when server restarts
// Works for both local dev and production deployments
const SERVER_VERSION = Date.now();

// ============================================
// CLOUDFLARE TURN CREDENTIAL GENERATION
// ============================================
// Generates short-lived credentials for WebRTC TURN relay
async function handleGetTurnCredentials(ws) {
    try {
        const tokenId = process.env.CLOUDFLARE_TURN_TOKEN_ID;
        const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;

        console.error('[TURN] Generating credentials, tokenId:', tokenId ? 'set' : 'MISSING', 'apiToken:', apiToken ? 'set' : 'MISSING');

        if (!tokenId || !apiToken) {
            // Fallback: no TURN available (direct connections only)
            ws.send(JSON.stringify({
                type: 'turn_credentials',
                payload: { iceServers: [] }
            }));
            return;
        }

        const response = await fetch(
            `https://rtc.live.cloudflare.com/v1/turn/keys/${tokenId}/credentials/generate-ice-servers`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ttl: 86400 }) // 24 hours
            }
        );

        if (!response.ok) {
            throw new Error(`Cloudflare API error: ${response.status}`);
        }

        const data = await response.json();
        ws.send(JSON.stringify({
            type: 'turn_credentials',
            payload: data // { iceServers: [...] }
        }));
    } catch (error) {
        console.error('[TURN] Failed to get credentials:', error.message);
        // Fallback: direct connections only
        ws.send(JSON.stringify({
            type: 'turn_credentials',
            payload: { iceServers: [] }
        }));
    }
}

// Async initialization function
async function initializeServer() {
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

    // ONE-TIME MIGRATION: Change mag5 structures from Northmen(3) to Southguard(1)
    // Safe here because chunk cache is empty at startup. Remove after confirming.
    if (chunkManager.dbReady) {
        try {
            const migrationResult = await db.query(`
                UPDATE chunks SET data = jsonb_set(data, '{objectChanges}',
                    (SELECT jsonb_agg(
                        CASE
                            WHEN elem->>'owner' = 'fa48717a-f00d-46e4-9fa5-b025177d7a14'
                                 AND elem->>'action' = 'add'
                                 AND elem ? 'factionId'
                            THEN jsonb_set(elem, '{factionId}', '1')
                            ELSE elem
                        END
                    ) FROM jsonb_array_elements(data->'objectChanges') elem)
                )
                WHERE chunk_id = 'chunk_-24,4'
            `);
            console.log(`[Migration] mag5 faction change: ${migrationResult.rowCount} chunk(s) updated`);
        } catch (e) {
            console.error('[Migration] mag5 faction change failed:', e.message);
        }
    }

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

    const messageRouter = new MessageRouter(clients, chunkManager);
    FriendsManager.setMessageRouter(messageRouter);
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

    // Create HTTP server with /version endpoint for cache invalidation
    const httpServer = http.createServer((req, res) => {
        // CORS headers for cross-origin requests from static site
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET');

        if (req.url === '/version') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ version: SERVER_VERSION }));
        } else {
            res.writeHead(404);
            res.end();
        }
    });

    // Attach WebSocket server to HTTP server
    const wss = new WebSocket.Server({ server: httpServer });
    httpServer.listen(8080);
    console.log('Server started on port 8080');

    return { wss, clients, chunkManager, messageRouter, messageHandlers, notificationInterval, pendingPositionRequests, initialTick, auditLogger };
}

// Start the server
initializeServer().then(({ wss, clients, chunkManager, messageRouter, messageHandlers, notificationInterval, pendingPositionRequests, initialTick, auditLogger }) => {

// Global tick counter for deterministic simulation sync (persisted across restarts)
let serverTick = initialTick;
const TICK_INTERVAL = 1000; // 1 second per tick

// Data retention cleanup - tracks last cleanup date to ensure once-per-day execution
let lastCleanupDate = null;

// Register data retention cleanup handler (runs on 10-minute interval, executes once per day)
// NOTE: TimeTrackerService doesn't await handlers, so we use IIFE with .catch() for async error handling
messageHandlers.timeTracker.registerTenMinuteHandler('dataRetention', () => {
    const today = new Date().toDateString();
    if (lastCleanupDate === today) return; // Already ran today

    lastCleanupDate = today;
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const db = require('./server/DatabaseManager');

    // Async IIFE with .catch() to properly handle async errors
    (async () => {
        if (!db.isConnected) return;

        // Delete old audit logs (ts is milliseconds)
        const auditResult = await db.query(
            `DELETE FROM audit_log WHERE ts < $1`,
            [thirtyDaysAgo]
        );

        // Delete old fingerprint sightings
        const sightingResult = await db.query(
            `DELETE FROM fingerprint_sightings WHERE last_seen < NOW() - INTERVAL '30 days'`
        );

        // Silently perform retention cleanup (no logging per project rules)
    })().catch(err => {
        console.error('Data retention cleanup failed:', err.message);
    });
});

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

    // Every 5 ticks (5 seconds): flush dirty chunks to storage
    if (serverTick % 5 === 0) {
        chunkManager.flushDirtyChunks();
    }

    // Every 10 ticks (10 seconds): clean up stale entity claims
    if (serverTick % 10 === 0) {
        messageHandlers.cleanupStaleClaims();
    }

    // Every 60 ticks (1 minute): save server state and evict distant chunks
    if (serverTick % 60 === 0) {
        // Save server tick to persist across restarts
        chunkManager.saveServerState(serverTick);

        // Evict distant chunks from cache (flushes dirty chunks before evicting)
        (async () => {
            const activePlayerChunks = [];
            for (const [clientId, clientData] of clients) {
                if (clientData.currentChunk) {
                    activePlayerChunks.push(clientData.currentChunk);
                }
            }
            await chunkManager.evictDistantChunks(activePlayerChunks);
        })();
    }

    // Every 30 ticks (30 seconds): check for banned players using cache (no DB queries per player)
    if (serverTick % 30 === 0 && AuthManager) {
        (async () => {
            try {
                // Refresh ban cache if stale (every 60 seconds)
                const now = Date.now();
                if (now - AuthManager.banCacheLastRefresh > AuthManager.BAN_CACHE_REFRESH_INTERVAL) {
                    await AuthManager.refreshBanCache();
                }

                // Check all players against in-memory cache (O(1) per player)
                for (const [clientId, clientData] of clients) {
                    if (clientData.ws?.fingerprintHash) {
                        if (AuthManager.isFingerprintBannedCached(clientData.ws.fingerprintHash)) {
                            clientData.ws.send(JSON.stringify({
                                type: 'kicked',
                                payload: { reason: 'Connection terminated' }
                            }));
                            clientData.ws.close();
                        }
                    }
                }
            } catch (e) {
                console.error('Ban check error:', e);
            }
        })();
    }
}, TICK_INTERVAL);

console.log('Tick broadcaster started (1 tick/second)');


// Handle new connections
wss.on('connection', ws => {

    // Capture IP address for audit logging
    ws.ipAddress = ws._socket.remoteAddress;

    // Add client to map immediately so they receive tick broadcasts
    // Use a temp ID until they join a chunk with their real client ID
    const tempClientId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    ws.tempClientId = tempClientId;
    clients.set(tempClientId, { ws, currentChunk: null });

    // Fingerprint gating - client must send fingerprint before any other messages
    ws.fingerprintReceived = false;

    // Timeout: kick if no fingerprint in 10 seconds
    ws.fingerprintTimeout = setTimeout(() => {
        if (!ws.fingerprintReceived) {
            ws.send(JSON.stringify({ type: 'fingerprint_rejected', reason: 'timeout' }));
            ws.close();
        }
    }, 10000);

    // Clean up on disconnect
    ws.on('close', () => {
        clearTimeout(ws.fingerprintTimeout);
        // Only delete if still using temp ID (not replaced by join_chunk)
        if (clients.get(tempClientId)?.ws === ws) {
            clients.delete(tempClientId);
        }
    });

    ws.on('message', async (message) => {
        let parsedMessage;
        try {
            parsedMessage = JSON.parse(message);
        } catch (error) {
            console.error('Invalid message received:', error);
            return;
        }
        const { type, payload } = parsedMessage;

        // Handle fingerprint message first (required before any other messages)
        if (!ws.fingerprintReceived && type === 'fingerprint') {
            clearTimeout(ws.fingerprintTimeout);

            const hash = payload?.hash;
            const partialHashes = payload?.partialHashes || {};

            // Validate fingerprint format (must be 64-char hex)
            if (!hash || typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) {
                ws.send(JSON.stringify({ type: 'fingerprint_rejected', reason: 'invalid' }));
                ws.close();
                return;
            }

            ws.fingerprintReceived = true;
            ws.fingerprintHash = hash;
            ws.partialHashes = partialHashes;

            // Use O(1) cache lookup for ban check (not full DB query)
            const isBanned = AuthManager.isFingerprintBannedCached(hash);

            // Log the fingerprint check
            if (auditLogger) {
                auditLogger.log({
                    action_type: 11, // FP_CHECK
                    actor_fingerprint: hash,
                    data: {
                        result: isBanned ? 'blocked' : 'allowed',
                        degraded: payload?.degraded || false
                    }
                });
            }

            if (isBanned) {
                ws.send(JSON.stringify({ type: 'fingerprint_rejected', reason: 'banned' }));
                ws.close();
                return;
            }

            // Store fingerprint sighting (best-effort, don't block on failure)
            if (db) {
                try {
                    await db.query(`
                        INSERT INTO fingerprint_sightings (fingerprint_hash, partial_hashes)
                        VALUES ($1, $2)
                        ON CONFLICT (fingerprint_hash) DO UPDATE SET
                            partial_hashes = $2,
                            last_seen = NOW(),
                            connection_count = fingerprint_sightings.connection_count + 1
                    `, [hash, JSON.stringify(partialHashes)]);
                } catch (err) {
                    console.error('Fingerprint sighting failed:', err.message);
                }
            }

            // Fingerprint OK - send welcome
            ws.send(JSON.stringify({ type: 'welcome', message: 'Welcome to the server!', serverVersion: SERVER_VERSION }));
            return;
        }

        // Allow admin broadcast without fingerprint (authenticates via ADMIN_SECRET)
        if (type === 'admin_broadcast') {
            const adminSecret = process.env.ADMIN_SECRET;
            if (!adminSecret || payload.secret !== adminSecret) {
                ws.send(JSON.stringify({
                    type: 'admin_broadcast_response',
                    payload: { success: false, error: 'Invalid admin secret' }
                }));
                return;
            }
            let playerCount = 0;
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN && client !== ws) {
                    client.send(JSON.stringify({
                        type: 'admin_broadcast',
                        payload: { message: payload.message }
                    }));
                    playerCount++;
                }
            });
            ws.send(JSON.stringify({
                type: 'admin_broadcast_response',
                payload: { success: true, playerCount }
            }));
            return;
        }

        // Allow admin database queries without fingerprint (authenticates via ADMIN_SECRET)
        if (type === 'admin_query') {
            const adminSecret = process.env.ADMIN_SECRET;
            if (!adminSecret || payload.secret !== adminSecret) {
                ws.send(JSON.stringify({
                    type: 'admin_query_response',
                    payload: { success: false, error: 'Invalid admin secret' }
                }));
                return;
            }
            const sql = (payload.sql || '').trim();
            if (!sql.toUpperCase().startsWith('SELECT')) {
                ws.send(JSON.stringify({
                    type: 'admin_query_response',
                    payload: { success: false, error: 'Only SELECT queries are allowed' }
                }));
                return;
            }
            try {
                const result = await db.query(sql + (sql.toLowerCase().includes('limit') ? '' : ' LIMIT 500'));
                ws.send(JSON.stringify({
                    type: 'admin_query_response',
                    payload: { success: true, rows: result.rows, rowCount: result.rowCount }
                }));
            } catch (e) {
                ws.send(JSON.stringify({
                    type: 'admin_query_response',
                    payload: { success: false, error: e.message }
                }));
            }
            return;
        }

        // Reject all other messages until fingerprint received
        if (!ws.fingerprintReceived) {
            ws.send(JSON.stringify({ type: 'error', message: 'Fingerprint required' }));
            return;
        }

        // Ignore duplicate fingerprint messages (already validated)
        if (type === 'fingerprint') {
            return;
        }

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

            case 'create_corpse':
                await messageHandlers.handleCreateCorpse(ws, payload);
                break;

            case 'place_sailboat':
                await messageHandlers.handlePlaceSailboat(payload);
                break;

            case 'place_ship2':
                await messageHandlers.handlePlaceShip2(payload);
                break;

            case 'place_horse':
                await messageHandlers.handlePlaceHorse(ws, payload);
                break;

            case 'claim_mobile_entity':
                await messageHandlers.handleClaimMobileEntity(ws, payload);
                break;

            case 'release_mobile_entity':
                await messageHandlers.handleReleaseMobileEntity(ws, payload);
                break;

            case 'switch_mobile_entity':
                await messageHandlers.handleSwitchMobileEntity(ws, payload);
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

            case 'warehouse_load_crate':
                await messageHandlers.handleWarehouseLoadCrate(ws, payload);
                break;

            case 'warehouse_unload_crate':
                await messageHandlers.handleWarehouseUnloadCrate(ws, payload);
                break;

            // Unified towed entity handlers (cart or artillery)
            case 'claim_towed':
                await messageHandlers.handleClaimTowed(ws, payload);
                break;

            case 'release_towed':
                await messageHandlers.handleReleaseTowed(ws, payload);
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

            // Ship horse loading
            case 'claim_ship_horse':
                await messageHandlers.handleClaimShipHorse(ws, payload);
                break;

            case 'release_ship_horse':
                await messageHandlers.handleReleaseShipHorse(ws, payload);
                break;

            // Ship2 crew tracking (for multi-crew ships)
            case 'join_ship_crew':
                await messageHandlers.handleJoinShipCrew(ws, payload);
                break;

            case 'leave_ship_crew':
                await messageHandlers.handleLeaveShipCrew(ws, payload);
                break;

            case 'update_mobile_entity_chunk':
                messageHandlers.handleUpdateMobileEntityChunk(ws, payload);
                break;

            case 'query_claim_state':
                await messageHandlers.handleQueryClaimState(ws, payload);
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

            case 'sync_player_state':
                await messageHandlers.handleSyncPlayerState(ws, payload);
                break;

            case 'clear_saved_session':
                await messageHandlers.handleClearSavedSession(ws, payload);
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

            case 'militia_death':
                await messageHandlers.handleMilitiaDeath(ws, payload);
                break;

            case 'bandit_death':
                await messageHandlers.handleBanditDeath(ws, payload);
                break;

            case 'bear_death':
                await messageHandlers.handleBearDeath(ws, payload);
                break;

            case 'deer_death':
                await messageHandlers.handleDeerDeath(ws, payload);
                break;

            case 'get_influence':
                await messageHandlers.handleGetInfluence(ws, payload);
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
                // Require fingerprint for registration - prevents ban evasion
                if (!payload.fingerprint || typeof payload.fingerprint !== 'string') {
                    ws.send(JSON.stringify({
                        type: 'register_response',
                        payload: {
                            success: false,
                            message: 'Unable to verify device. Please disable privacy extensions and try again.',
                            requestId: payload.requestId
                        }
                    }));
                    break;
                }

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

                    const registerResult = await AuthManager.register(payload.username, payload.password, payload.email);
                    // Set accountId and username on websocket so subsequent messages work
                    if (registerResult.success) {
                        // Store fingerprint with new account
                        if (payload.fingerprint) {
                            await AuthManager.storeFingerprint(
                                registerResult.playerId,
                                payload.fingerprint,
                                payload.partialHashes
                            );
                            // Link fingerprint to account in sightings table
                            await AuthManager.linkFingerprintToAccount(
                                ws.fingerprintHash,
                                registerResult.playerId,
                                payload.username
                            );
                        }
                        ws.accountId = registerResult.playerId;
                        ws.username = payload.username;
                        ws.factionId = null; // New accounts start neutral
                        ws.fingerprintHash = payload.fingerprint; // Store for ban cache checks
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
                // Require fingerprint for login - prevents ban evasion
                if (!payload.fingerprint || typeof payload.fingerprint !== 'string') {
                    ws.send(JSON.stringify({
                        type: 'login_response',
                        payload: {
                            success: false,
                            message: 'Unable to verify device. Please disable privacy extensions and try again.',
                            requestId: payload.requestId
                        }
                    }));
                    break;
                }

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
                            // Link fingerprint to account in sightings table
                            await AuthManager.linkFingerprintToAccount(
                                ws.fingerprintHash,
                                loginResult.playerId,
                                payload.username
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
                        ws.fingerprintHash = payload.fingerprint; // Store for ban cache checks
                        messageRouter.addClientToAccount(loginResult.playerId, ws.clientId);
                        const playerData = await AuthManager.loadPlayerData(loginResult.playerId);
                        ws.factionId = playerData?.factionId ?? null;
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
                // Require fingerprint for session validation - prevents ban evasion
                if (!payload.fingerprint || typeof payload.fingerprint !== 'string') {
                    ws.send(JSON.stringify({
                        type: 'session_validation',
                        payload: {
                            valid: false,
                            reason: 'Unable to verify device. Please disable privacy extensions and try again.',
                            requestId: payload.requestId
                        }
                    }));
                    break;
                }

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
                            // Link fingerprint to account in sightings table
                            await AuthManager.linkFingerprintToAccount(
                                ws.fingerprintHash,
                                sessionResult.playerId,
                                sessionResult.username
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
                        ws.fingerprintHash = payload.fingerprint; // Store for ban cache checks
                        messageRouter.addClientToAccount(sessionResult.playerId, ws.clientId);
                        playerData = await AuthManager.loadPlayerData(sessionResult.playerId);
                        ws.factionId = playerData?.factionId ?? null;
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

                    // Clear server-side account association to prevent state leaking into guest session
                    if (ws.accountId) {
                        messageRouter.removeClientFromAccount(ws.accountId, ws.clientId);
                    }
                    ws.accountId = null;
                    ws.username = null;
                    ws.factionId = null;

                    // Also update the clients map entry
                    const clientEntry = clients.get(ws.clientId);
                    if (clientEntry) {
                        clientEntry.accountId = null;
                    }

                    ws.send(JSON.stringify({
                        type: 'logout_response',
                        payload: {
                            ...logoutResult,
                            requestId: payload.requestId
                        }
                    }));
                }
                break;

            case 'update_email':
                if (!ws.accountId) {
                    ws.send(JSON.stringify({
                        type: 'update_email_response',
                        payload: {
                            success: false,
                            message: 'Not authenticated',
                            requestId: payload.requestId
                        }
                    }));
                    break;
                }
                if (AuthManager) {
                    const emailResult = await AuthManager.updateEmail(ws.accountId, payload.email);
                    ws.send(JSON.stringify({
                        type: 'update_email_response',
                        payload: {
                            ...emailResult,
                            requestId: payload.requestId
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
                    // O(1) lookup by accountId
                    const friendClient = messageRouter.getClientByAccountId(payload.friendId);
                    const friendWs = friendClient?.client?.ws || null;

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
                    if (result.success) {
                        ws.factionId = payload.factionId;
                    }
                    ws.send(JSON.stringify({
                        type: 'set_faction_response',
                        payload: result
                    }));
                }
                break;

            case 'join_faction':
                if (ws.accountId && AuthManager) {
                    const result = await AuthManager.joinFaction(ws.accountId, payload.factionId);
                    if (result.success) {
                        ws.factionId = payload.factionId;
                    }
                    ws.send(JSON.stringify({
                        type: 'join_faction_response',
                        payload: {
                            ...result,
                            factionId: payload.factionId
                        }
                    }));
                } else {
                    ws.send(JSON.stringify({
                        type: 'join_faction_response',
                        payload: { success: false, message: 'Must be logged in to join faction' }
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

            case 'get_turn_credentials':
                // Generate short-lived TURN credentials from Cloudflare
                handleGetTurnCredentials(ws);
                break;

            default:
                console.error('Unknown message type:', type);
        }
    });

    ws.on('close', async () => {
        if (ws.clientId) {
            const clientData = clients.get(ws.clientId);

            // If this ws has been replaced by a new connection (reconnect),
            // skip cleanup - the new ws owns this clientId now
            if (clientData && clientData.ws !== ws) {
                return;
            }

            // Release any inventory locks held by this client
            await messageHandlers.releaseAllLocksForClient(ws.clientId);

            // Cleanup any mobile entities (horses, boats) claimed by this client
            await messageHandlers.cleanupMobileEntitiesForClient(ws.clientId);

            // Cleanup any crates loaded on carts by this client
            await messageHandlers.cleanupLoadedCratesForClient(ws.clientId);

            // Save player data if authenticated
            if (clientData && clientData.accountId && AuthManager) {
                // TODO: Implement periodic state sync from client or request state before disconnect
            }

            if (clientData && clientData.currentChunk) {
                await chunkManager.removePlayerFromChunk(clientData.currentChunk, ws.clientId);

                messageRouter.queueProximityUpdate(clientData.currentChunk);
            }

            // Audit log disconnect
            if (auditLogger) {
                const parsed = clientData?.currentChunk
                    ? ChunkCoordinates.parseChunkIdSafe(clientData.currentChunk)
                    : null;
                auditLogger.logDisconnect(
                    ws.clientId, ws.accountId,
                    parsed?.chunkX, parsed?.chunkZ, ws.username, ws.fingerprintHash
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
        await chunkManager.flushDirtyChunks();
        if (auditLogger) {
            await auditLogger.close();
        }
        process.exit(0);
    });

    process.on('SIGINT', async () => {
        console.log('Received SIGINT, shutting down gracefully...');
        await chunkManager.flushDirtyChunks();
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

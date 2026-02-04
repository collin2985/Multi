/**
 * MessageRouter.js
 * Handles message broadcasting and routing - NO game logic
 */

const WebSocket = require('ws');
const ChunkCoordinates = require('./ServerChunkCoords.js');

class MessageRouter {
    constructor(clients, chunkManager = null) {
        this.clients = clients; // Reference to clients Map
        this.chunkManager = chunkManager; // Reference for efficient chunk-based lookups
        this.notificationQueue = [];
        this.notificationInterval = 100; // Process every 100ms

        // Secondary index: accountId -> Set of clientIds (one-to-many for multi-tab support)
        this.accountClients = new Map();
    }

    /**
     * Add a client to the accountId index
     * @param {string} accountId - Player's account ID
     * @param {string} clientId - Client's connection ID
     */
    addClientToAccount(accountId, clientId) {
        if (!accountId || !clientId) return;
        if (!this.accountClients.has(accountId)) {
            this.accountClients.set(accountId, new Set());
        }
        this.accountClients.get(accountId).add(clientId);
    }

    /**
     * Remove a client from the accountId index
     * @param {string} accountId - Player's account ID
     * @param {string} clientId - Client's connection ID
     */
    removeClientFromAccount(accountId, clientId) {
        if (!accountId || !clientId) return;
        const clientIds = this.accountClients.get(accountId);
        if (clientIds) {
            clientIds.delete(clientId);
            if (clientIds.size === 0) {
                this.accountClients.delete(accountId);
            }
        }
    }

    /**
     * Check if an account has any online clients (O(1) lookup by accountId)
     * @param {string} accountId
     * @returns {boolean}
     */
    isAccountOnline(accountId) {
        const clientIds = this.accountClients.get(accountId);
        if (!clientIds || clientIds.size === 0) return false;

        for (const clientId of clientIds) {
            const client = this.clients.get(clientId);
            if (client?.currentChunk != null) return true;
        }
        return false;
    }

    /**
     * Get a connected client by accountId (O(1) lookup by accountId)
     * @param {string} accountId
     * @returns {{clientId: string, client: object}|null}
     */
    getClientByAccountId(accountId) {
        const clientIds = this.accountClients.get(accountId);
        if (!clientIds || clientIds.size === 0) return null;

        for (const clientId of clientIds) {
            const client = this.clients.get(clientId);
            if (client?.ws?.readyState === WebSocket.OPEN) {
                return { clientId, client };
            }
        }
        return null;
    }

    /**
     * Broadcast a message to all clients in a specific chunk
     * @param {string} chunkId
     * @param {object} message
     */
    broadcastToChunk(chunkId, message) {
        const jsonMessage = JSON.stringify(message);

        // Use efficient chunk-based lookup if available
        if (this.chunkManager) {
            const players = this.chunkManager.getPlayersInRadius(chunkId, 0);
            for (const player of players) {
                const clientData = this.clients.get(player.id);
                if (clientData?.ws?.readyState === WebSocket.OPEN) {
                    try {
                        clientData.ws.send(jsonMessage);
                    } catch (err) {
                        console.error(`Failed to send ${message.type} to ${player.id}:`, err);
                    }
                }
            }
            return;
        }

        // Fallback: O(n) iteration (for backwards compatibility)
        this.clients.forEach((clientData, clientId) => {
            if (clientData && clientData.currentChunk === chunkId &&
                clientData.ws && clientData.ws.readyState === WebSocket.OPEN) {
                try {
                    clientData.ws.send(jsonMessage);
                } catch (err) {
                    console.error(`Failed to send ${message.type} to ${clientId}:`, err);
                }
            }
        });
    }

    /**
     * Broadcast a message to all clients in a 3x3 grid around a chunk
     * @param {string} chunkId - Center chunk
     * @param {object} message
     */
    broadcastTo3x3Grid(chunkId, message) {
        const jsonMessage = JSON.stringify(message);

        // Use efficient chunk-based lookup if available (O(k) where k = nearby players)
        if (this.chunkManager) {
            const players = this.chunkManager.getPlayersInRadius(chunkId, 1); // radius=1 for 3x3
            for (const player of players) {
                const clientData = this.clients.get(player.id);
                if (clientData?.ws?.readyState === WebSocket.OPEN) {
                    try {
                        clientData.ws.send(jsonMessage);
                    } catch (err) {
                        console.error(`Failed to send ${message.type} to ${player.id}:`, err);
                    }
                }
            }
            return;
        }

        // Fallback: O(n) iteration (for backwards compatibility)
        const parsed = ChunkCoordinates.parseChunkIdSafe(chunkId);
        if (!parsed) {
            console.error(`[Broadcaster] Cannot broadcast to invalid chunk: ${chunkId}`);
            return;
        }
        const { chunkX, chunkZ } = parsed;
        const radius = 1;

        const targetChunks = new Set();
        for (let x = chunkX - radius; x <= chunkX + radius; x++) {
            for (let z = chunkZ - radius; z <= chunkZ + radius; z++) {
                targetChunks.add(`chunk_${x},${z}`);
            }
        }

        this.clients.forEach((clientData, clientId) => {
            if (clientData && clientData.currentChunk && targetChunks.has(clientData.currentChunk) &&
                clientData.ws && clientData.ws.readyState === WebSocket.OPEN) {
                try {
                    clientData.ws.send(jsonMessage);
                } catch (err) {
                    console.error(`Failed to send ${message.type} to ${clientId}:`, err);
                }
            }
        });
    }

    /**
     * Broadcast a message to all clients in a 3x3 grid around a chunk, excluding one client
     * @param {string} chunkId - Center chunk
     * @param {object} message
     * @param {string} excludeClientId - Client ID to exclude from broadcast
     */
    broadcastTo3x3GridExcluding(chunkId, message, excludeClientId) {
        const jsonMessage = JSON.stringify(message);

        // Use efficient chunk-based lookup if available (O(k) where k = nearby players)
        if (this.chunkManager) {
            const players = this.chunkManager.getPlayersInRadius(chunkId, 1); // radius=1 for 3x3
            for (const player of players) {
                if (player.id === excludeClientId) continue; // Skip excluded client
                const clientData = this.clients.get(player.id);
                if (clientData?.ws?.readyState === WebSocket.OPEN) {
                    try {
                        clientData.ws.send(jsonMessage);
                    } catch (err) {
                        console.error(`Failed to send ${message.type} to ${player.id}:`, err);
                    }
                }
            }
            return;
        }

        // Fallback: O(n) iteration (for backwards compatibility)
        const parsed = ChunkCoordinates.parseChunkIdSafe(chunkId);
        if (!parsed) {
            console.error(`[Broadcaster] Cannot broadcast to invalid chunk: ${chunkId}`);
            return;
        }
        const { chunkX, chunkZ } = parsed;
        const radius = 1;

        const targetChunks = new Set();
        for (let x = chunkX - radius; x <= chunkX + radius; x++) {
            for (let z = chunkZ - radius; z <= chunkZ + radius; z++) {
                targetChunks.add(`chunk_${x},${z}`);
            }
        }

        this.clients.forEach((clientData, clientId) => {
            if (clientId === excludeClientId) return; // Skip excluded client
            if (clientData && clientData.currentChunk && targetChunks.has(clientData.currentChunk) &&
                clientData.ws && clientData.ws.readyState === WebSocket.OPEN) {
                try {
                    clientData.ws.send(jsonMessage);
                } catch (err) {
                    console.error(`Failed to send ${message.type} to ${clientId}:`, err);
                }
            }
        });
    }

    /**
     * Send a message to a specific client
     * @param {string} clientId
     * @param {object} message
     */
    sendToClient(clientId, message) {
        const clientData = this.clients.get(clientId);
        if (clientData && clientData.ws && clientData.ws.readyState === WebSocket.OPEN) {
            try {
                clientData.ws.send(JSON.stringify(message));
                return true;
            } catch (err) {
                console.error(`Failed to send ${message.type} to ${clientId}:`, err);
                return false;
            }
        }
        return false;
    }

    /**
     * Send a message to ALL clients for an accountId (supports multi-tab)
     * @param {string} accountId - Player's account ID
     * @param {object} message
     * @returns {boolean} - True if sent to at least one client
     */
    sendToAccount(accountId, message) {
        const clientIds = this.accountClients.get(accountId);
        if (!clientIds || clientIds.size === 0) return false;

        const jsonMessage = JSON.stringify(message);
        let sent = false;
        for (const clientId of clientIds) {
            const clientData = this.clients.get(clientId);
            if (clientData && clientData.ws && clientData.ws.readyState === WebSocket.OPEN) {
                try {
                    clientData.ws.send(jsonMessage);
                    sent = true;
                } catch (err) {
                    console.error(`Failed to send ${message.type} to client ${clientId}:`, err);
                }
            }
        }
        return sent;
    }

    /**
     * Broadcast a message to ALL connected clients
     * Used for global events like tick sync
     * @param {object} message
     */
    broadcastToAll(message) {
        const jsonMessage = JSON.stringify(message);
        this.clients.forEach((clientData, clientId) => {
            if (clientData && clientData.ws && clientData.ws.readyState === WebSocket.OPEN) {
                try {
                    clientData.ws.send(jsonMessage);
                } catch (err) {
                    // Silent fail for tick broadcasts - not critical
                }
            }
        });
    }

    /**
     * Forward a message from one client to another
     * @param {string} fromClientId
     * @param {string} toClientId
     * @param {string} rawMessage - Raw message string
     */
    forwardMessage(fromClientId, toClientId, rawMessage) {
        const recipientData = this.clients.get(toClientId);
        if (recipientData && recipientData.ws) {
            recipientData.ws.send(rawMessage);
            return true;
        }
        return false;
    }

    /**
     * Queue a proximity update notification
     * @param {string} chunkId
     */
    queueProximityUpdate(chunkId) {
        this.notificationQueue.push({ chunkId });
    }

    /**
     * Process notification queue for rate limiting
     * @param {function} getPlayersInProximity - Function to get players in proximity
     */
    processNotificationQueue(getPlayersInProximity) {
        if (this.notificationQueue.length === 0) return;

        // Group events by affected chunk to avoid duplicate notifications
        const chunksToNotify = new Set(this.notificationQueue.map(event => event.chunkId));
        this.notificationQueue.length = 0; // Clear queue

        // Cache proximity results to avoid redundant calls
        const proximityCache = new Map();
        const getProximityCached = (chunkId) => {
            if (!proximityCache.has(chunkId)) {
                proximityCache.set(chunkId, getPlayersInProximity(chunkId));
            }
            return proximityCache.get(chunkId);
        };

        chunksToNotify.forEach(chunkId => {
            // Get players in proximity grid around this chunk (cached)
            const proximatePlayers = getProximityCached(chunkId);
            const affectedClients = new Set(proximatePlayers.map(p => p.id));

            // For each affected client, compute their own proximity grid player list
            affectedClients.forEach(clientId => {
                const clientData = this.clients.get(clientId);
                if (!clientData || !clientData.ws || clientData.ws.readyState !== WebSocket.OPEN) return;

                const clientPlayers = getProximityCached(clientData.currentChunk);
                try {
                    clientData.ws.send(JSON.stringify({
                        type: 'proximity_update',
                        payload: { players: clientPlayers }
                    }));
                } catch (err) {
                    console.error(`Failed to send proximity_update to ${clientId}:`, err);
                }
            });
        });
    }

    /**
     * Start processing notification queue periodically
     * @param {function} getPlayersInProximity - Function to get players in proximity
     * @returns {NodeJS.Timeout} - Interval ID
     */
    startNotificationProcessing(getPlayersInProximity) {
        return setInterval(() => {
            this.processNotificationQueue(getPlayersInProximity);
        }, this.notificationInterval);
    }

    /**
     * Broadcast a message to all clients within LOAD_RADIUS of a chunk
     * Used for updates that need to reach all clients with the chunk loaded
     * @param {string} chunkId - Center chunk
     * @param {object} message
     */
    broadcastToProximity(chunkId, message) {
        const jsonMessage = JSON.stringify(message);
        const CONFIG = require('./ServerConfig.js');

        // Use efficient chunk-based lookup if available
        if (this.chunkManager) {
            const players = this.chunkManager.getPlayersInRadius(chunkId, CONFIG.CHUNKS.LOAD_RADIUS);
            for (const player of players) {
                const clientData = this.clients.get(player.id);
                if (clientData?.ws?.readyState === WebSocket.OPEN) {
                    try {
                        clientData.ws.send(jsonMessage);
                    } catch (err) {
                        console.error(`Failed to send ${message.type} to ${player.id}:`, err);
                    }
                }
            }
            return;
        }

        // Fallback: O(n) iteration (for backwards compatibility)
        const parsed = ChunkCoordinates.parseChunkIdSafe(chunkId);
        if (!parsed) {
            console.error(`[Broadcaster] Cannot broadcast to invalid chunk: ${chunkId}`);
            return;
        }
        const { chunkX, chunkZ } = parsed;
        const radius = CONFIG.CHUNKS.LOAD_RADIUS;

        const targetChunks = new Set();
        for (let x = chunkX - radius; x <= chunkX + radius; x++) {
            for (let z = chunkZ - radius; z <= chunkZ + radius; z++) {
                targetChunks.add(`chunk_${x},${z}`);
            }
        }

        this.clients.forEach((clientData, clientId) => {
            if (clientData && clientData.currentChunk && targetChunks.has(clientData.currentChunk) &&
                clientData.ws && clientData.ws.readyState === WebSocket.OPEN) {
                try {
                    clientData.ws.send(jsonMessage);
                } catch (err) {
                    console.error(`Failed to send ${message.type} to ${clientId}:`, err);
                }
            }
        });
    }
}

module.exports = MessageRouter;

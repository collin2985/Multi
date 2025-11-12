/**
 * MessageRouter.js
 * Handles message broadcasting and routing - NO game logic
 */

const WebSocket = require('ws');

class MessageRouter {
    constructor(clients) {
        this.clients = clients; // Reference to clients Map
        this.notificationQueue = [];
        this.notificationInterval = 100; // Process every 100ms
    }

    /**
     * Broadcast a message to all clients in a specific chunk
     * @param {string} chunkId
     * @param {object} message
     */
    broadcastToChunk(chunkId, message) {
        const recipients = [];
        this.clients.forEach((clientData, clientId) => {
            if (clientData && clientData.currentChunk === chunkId &&
                clientData.ws && clientData.ws.readyState === WebSocket.OPEN) {
                try {
                    clientData.ws.send(JSON.stringify(message));
                    recipients.push(clientId);
                } catch (err) {
                    console.error(`Failed to send ${message.type} to ${clientId}:`, err);
                }
            }
        });
        console.log(`Broadcasted ${message.type} to chunk ${chunkId}. Recipients: ${recipients.join(',')}`);
    }

    /**
     * Broadcast a message to all clients in a 3x3 grid around a chunk
     * @param {string} chunkId - Center chunk
     * @param {object} message
     */
    broadcastTo3x3Grid(chunkId, message) {
        const [chunkX, chunkZ] = chunkId.replace('chunk_', '').split(',').map(Number);
        const radius = 1;

        // Build set of target chunk ids
        const targetChunks = new Set();
        for (let x = chunkX - radius; x <= chunkX + radius; x++) {
            for (let z = chunkZ - radius; z <= chunkZ + radius; z++) {
                targetChunks.add(`chunk_${x},${z}`);
            }
        }

        const recipients = [];
        this.clients.forEach((clientData, clientId) => {
            if (clientData && clientData.currentChunk && targetChunks.has(clientData.currentChunk) &&
                clientData.ws && clientData.ws.readyState === WebSocket.OPEN) {
                try {
                    clientData.ws.send(JSON.stringify(message));
                    recipients.push(clientId);
                } catch (err) {
                    console.error(`Failed to send ${message.type} to ${clientId}:`, err);
                }
            }
        });

        console.log(`Broadcasted ${message.type} to 3x3 grid around chunk ${chunkId}. Recipients: ${recipients.join(',')}`);
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

        chunksToNotify.forEach(chunkId => {
            // Get players in proximity grid around this chunk
            const proximatePlayers = getPlayersInProximity(chunkId);
            const affectedClients = new Set(proximatePlayers.map(p => p.id));

            // For each affected client, compute their own proximity grid player list
            affectedClients.forEach(clientId => {
                const clientData = this.clients.get(clientId);
                if (!clientData || !clientData.ws || clientData.ws.readyState !== WebSocket.OPEN) return;

                const clientPlayers = getPlayersInProximity(clientData.currentChunk);
                try {
                    clientData.ws.send(JSON.stringify({
                        type: 'proximity_update',
                        payload: { players: clientPlayers }
                    }));
                    console.log(`Sent proximity_update to ${clientId} with ${clientPlayers.length} players`);
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
}

module.exports = MessageRouter;

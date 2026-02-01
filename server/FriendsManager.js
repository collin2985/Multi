/**
 * FriendsManager.js
 * Server-side friend management with dual-mode support (local/PostgreSQL)
 * Handles friend requests, accepting/declining, and friends list retrieval
 */

const db = require('./DatabaseManager');

// Max friends limit
const MAX_FRIENDS = 20;

class FriendsManager {
    constructor() {
        // Database availability flag
        this.useDatabase = false;

        // Local mode storage
        this.localFriends = new Map();  // playerId -> [{friendId, friendUsername, status, createdAt}]

        // Reference to connected clients (set by MessageHandlers)
        this.connectedClients = null;  // Map<accountId, {ws, position, username}>

        // Reference to AuthManager (for local mode player lookups)
        this.authManager = null;
    }

    /**
     * Initialize the FriendsManager
     */
    async initialize() {
        if (db.isConnected) {
            this.useDatabase = true;
        }
    }

    /**
     * Set reference to connected clients map
     * @param {Map} clientsMap
     */
    setConnectedClients(clientsMap) {
        this.connectedClients = clientsMap;
    }

    /**
     * Set reference to AuthManager (for local mode player lookups)
     * @param {object} authManager
     */
    setAuthManager(authManager) {
        this.authManager = authManager;
    }

    /**
     * Set reference to MessageRouter (for O(1) account lookups)
     * @param {object} messageRouter
     */
    setMessageRouter(messageRouter) {
        this.messageRouter = messageRouter;
    }

    /**
     * Send a friend request
     * @param {string} playerId - Requesting player's ID
     * @param {string} targetUsername - Username of player to friend
     * @returns {Promise<{success: boolean, requestId?: string, message?: string}>}
     */
    async sendFriendRequest(playerId, targetUsername) {
        if (!playerId) {
            return { success: false, message: 'Must be logged in to add friends' };
        }

        // Check friend limit
        const currentFriends = await this.getFriendsList(playerId);
        if (currentFriends.length >= MAX_FRIENDS) {
            return { success: false, message: `Friend limit reached (${MAX_FRIENDS})` };
        }

        if (!this.useDatabase) {
            // LOCAL MODE
            // Find target player by username
            const targetPlayer = this.findPlayerByUsername(targetUsername);
            if (!targetPlayer) {
                return { success: false, message: 'Player not found' };
            }

            if (targetPlayer.playerId === playerId) {
                return { success: false, message: 'Cannot friend yourself' };
            }

            // Check if already friends or pending (check BOTH directions like DB mode)
            const existingFriends = this.localFriends.get(playerId) || [];
            const existingOutgoing = existingFriends.find(f => f.friendId === targetPlayer.playerId);
            if (existingOutgoing) {
                if (existingOutgoing.status === 'accepted') {
                    return { success: false, message: 'Already friends' };
                } else {
                    return { success: false, message: 'Friend request already pending' };
                }
            }

            // Also check if TARGET already sent US a request (reverse direction)
            const targetFriends = this.localFriends.get(targetPlayer.playerId) || [];
            const existingIncoming = targetFriends.find(f => f.friendId === playerId);
            if (existingIncoming) {
                if (existingIncoming.status === 'accepted') {
                    return { success: false, message: 'Already friends' };
                } else {
                    return { success: false, message: 'They already sent you a request' };
                }
            }

            // Create request
            const requestId = `fr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const request = {
                requestId,
                friendId: targetPlayer.playerId,
                friendUsername: targetUsername,
                status: 'pending',
                createdAt: new Date()
            };

            existingFriends.push(request);
            this.localFriends.set(playerId, existingFriends);

            return { success: true, requestId, targetPlayerId: targetPlayer.playerId };
        }

        // DATABASE MODE
        try {
            // Find target player (case-insensitive)
            const targetResult = await db.query(
                'SELECT id FROM players WHERE LOWER(username) = LOWER($1)',
                [targetUsername]
            );

            if (targetResult.rows.length === 0) {
                return { success: false, message: 'Player not found' };
            }

            const targetPlayerId = targetResult.rows[0].id;

            if (targetPlayerId === playerId) {
                return { success: false, message: 'Cannot friend yourself' };
            }

            // Check if already friends or pending
            const existingResult = await db.query(
                `SELECT status FROM friends
                 WHERE (player_id = $1 AND friend_player_id = $2)
                    OR (player_id = $2 AND friend_player_id = $1)`,
                [playerId, targetPlayerId]
            );

            if (existingResult.rows.length > 0) {
                const status = existingResult.rows[0].status;
                if (status === 'accepted') {
                    return { success: false, message: 'Already friends' };
                } else {
                    return { success: false, message: 'Friend request already pending' };
                }
            }

            // Create request
            const insertResult = await db.query(
                `INSERT INTO friends (player_id, friend_player_id, status)
                 VALUES ($1, $2, 'pending')
                 RETURNING id`,
                [playerId, targetPlayerId]
            );

            const requestId = insertResult.rows[0].id;
            return { success: true, requestId: requestId.toString(), targetPlayerId };

        } catch (error) {
            console.error('Send friend request error:', error);
            return { success: false, message: 'Failed to send friend request' };
        }
    }

    /**
     * Accept a friend request
     * @param {string} playerId - Player accepting the request
     * @param {string} requestId - Request ID to accept
     * @returns {Promise<{success: boolean, senderPlayerId?: string, message?: string}>}
     */
    async acceptFriendRequest(playerId, requestId) {
        if (!this.useDatabase) {
            // LOCAL MODE - find the request in all friends lists
            for (const [senderId, friends] of this.localFriends) {
                const request = friends.find(f => f.requestId === requestId && f.friendId === playerId);
                if (request) {
                    // Check friend limit for accepting player
                    const currentFriends = await this.getFriendsList(playerId);
                    const acceptedCount = currentFriends.filter(f => f.status === 'accepted').length;
                    if (acceptedCount >= MAX_FRIENDS) {
                        return { success: false, message: `Friend limit reached (${MAX_FRIENDS})` };
                    }

                    request.status = 'accepted';

                    // Add reciprocal entry
                    const reciprocal = this.localFriends.get(playerId) || [];
                    reciprocal.push({
                        requestId: `fr_${Date.now()}`,
                        friendId: senderId,
                        friendUsername: this.getUsernameById(senderId),
                        status: 'accepted',
                        createdAt: new Date()
                    });
                    this.localFriends.set(playerId, reciprocal);

                    return { success: true, senderPlayerId: senderId };
                }
            }
            return { success: false, message: 'Request not found' };
        }

        // DATABASE MODE
        try {
            // Check friend limit for accepting player first
            const currentFriends = await this.getFriendsList(playerId);
            const acceptedCount = currentFriends.filter(f => f.status === 'accepted').length;
            if (acceptedCount >= MAX_FRIENDS) {
                return { success: false, message: `Friend limit reached (${MAX_FRIENDS})` };
            }

            const result = await db.query(
                `UPDATE friends SET status = 'accepted'
                 WHERE id = $1 AND friend_player_id = $2 AND status = 'pending'
                 RETURNING player_id`,
                [requestId, playerId]
            );

            if (result.rowCount === 0) {
                return { success: false, message: 'Request not found or already processed' };
            }

            const senderPlayerId = result.rows[0].player_id;
            return { success: true, senderPlayerId };

        } catch (error) {
            console.error('Accept friend request error:', error);
            return { success: false, message: 'Failed to accept request' };
        }
    }

    /**
     * Decline a friend request
     * @param {string} playerId
     * @param {string} requestId
     */
    async declineFriendRequest(playerId, requestId) {
        if (!this.useDatabase) {
            // LOCAL MODE
            for (const [senderId, friends] of this.localFriends) {
                const index = friends.findIndex(f => f.requestId === requestId && f.friendId === playerId);
                if (index !== -1) {
                    friends.splice(index, 1);
                    return { success: true };
                }
            }
            return { success: false, message: 'Request not found' };
        }

        // DATABASE MODE
        try {
            const result = await db.query(
                `DELETE FROM friends
                 WHERE id = $1 AND friend_player_id = $2 AND status = 'pending'`,
                [requestId, playerId]
            );

            if (result.rowCount === 0) {
                return { success: false, message: 'Request not found' };
            }

            return { success: true };

        } catch (error) {
            console.error('Decline friend request error:', error);
            return { success: false, message: 'Failed to decline request' };
        }
    }

    /**
     * Remove a friend
     * @param {string} playerId
     * @param {string} friendId
     */
    async removeFriend(playerId, friendId) {
        if (!this.useDatabase) {
            // LOCAL MODE - remove from both sides
            const myFriends = this.localFriends.get(playerId) || [];
            const theirFriends = this.localFriends.get(friendId) || [];

            this.localFriends.set(playerId, myFriends.filter(f => f.friendId !== friendId));
            this.localFriends.set(friendId, theirFriends.filter(f => f.friendId !== playerId));

            return { success: true };
        }

        // DATABASE MODE
        try {
            await db.query(
                `DELETE FROM friends
                 WHERE (player_id = $1 AND friend_player_id = $2)
                    OR (player_id = $2 AND friend_player_id = $1)`,
                [playerId, friendId]
            );

            return { success: true };

        } catch (error) {
            console.error('Remove friend error:', error);
            return { success: false, message: 'Failed to remove friend' };
        }
    }

    /**
     * Get friends list with online status
     * @param {string} playerId
     * @returns {Promise<Array<{id, username, faction, status, online}>>}
     */
    async getFriendsList(playerId) {
        if (!playerId) return [];

        if (!this.useDatabase) {
            // LOCAL MODE
            const result = [];

            // Get accepted friends where this player is the sender
            const myFriends = this.localFriends.get(playerId) || [];
            for (const f of myFriends) {
                if (f.status === 'accepted') {
                    result.push({
                        id: f.friendId,
                        requestId: f.requestId,
                        username: f.friendUsername,
                        faction: this.getFactionById(f.friendId),
                        status: f.status,
                        online: this.isPlayerOnline(f.friendId)
                    });
                }
            }

            // Get pending requests where this player is the TARGET (incoming requests)
            // These are stored in OTHER players' lists with friendId === playerId
            for (const [senderId, friends] of this.localFriends) {
                if (senderId === playerId) continue; // Skip own list
                for (const f of friends) {
                    if (f.friendId === playerId && f.status === 'pending') {
                        // This is an incoming request from senderId to playerId
                        result.push({
                            id: senderId,
                            requestId: f.requestId,
                            username: this.getUsernameById(senderId),
                            faction: this.getFactionById(senderId),
                            status: 'pending',
                            online: this.isPlayerOnline(senderId)
                        });
                    }
                }
            }

            return result;
        }

        // DATABASE MODE
        try {
            const result = await db.query(
                `SELECT
                    f.id as request_id,
                    f.status,
                    CASE
                        WHEN f.player_id = $1 THEN f.friend_player_id
                        ELSE f.player_id
                    END as friend_id,
                    p.username,
                    pd.faction_id
                 FROM friends f
                 JOIN players p ON p.id = CASE
                    WHEN f.player_id = $1 THEN f.friend_player_id
                    ELSE f.player_id
                 END
                 LEFT JOIN player_data pd ON pd.player_id = p.id
                 WHERE (f.player_id = $1 OR f.friend_player_id = $1)
                   AND (f.status = 'accepted' OR (f.status = 'pending' AND f.friend_player_id = $1))`,
                [playerId]
            );

            return result.rows.map(row => ({
                id: row.friend_id,
                requestId: row.request_id.toString(),  // Include request ID for accept/decline actions
                username: row.username,
                faction: row.faction_id,
                status: row.status,
                online: this.isPlayerOnline(row.friend_id)
            }));

        } catch (error) {
            console.error('Get friends list error:', error);
            return [];
        }
    }

    /**
     * Get pending friend requests for a player
     * @param {string} playerId
     */
    async getPendingRequests(playerId) {
        if (!playerId) return [];

        if (!this.useDatabase) {
            // LOCAL MODE
            const pending = [];
            for (const [senderId, friends] of this.localFriends) {
                for (const f of friends) {
                    if (f.friendId === playerId && f.status === 'pending') {
                        pending.push({
                            requestId: f.requestId,
                            fromPlayerId: senderId,
                            fromUsername: this.getUsernameById(senderId),
                            createdAt: f.createdAt
                        });
                    }
                }
            }
            return pending;
        }

        // DATABASE MODE
        try {
            const result = await db.query(
                `SELECT f.id as request_id, f.player_id, p.username, f.created_at
                 FROM friends f
                 JOIN players p ON p.id = f.player_id
                 WHERE f.friend_player_id = $1 AND f.status = 'pending'`,
                [playerId]
            );

            return result.rows.map(row => ({
                requestId: row.request_id.toString(),
                fromPlayerId: row.player_id,
                fromUsername: row.username,
                createdAt: row.created_at
            }));

        } catch (error) {
            console.error('Get pending requests error:', error);
            return [];
        }
    }

    // Helper methods for local mode - use AuthManager for player data
    findPlayerByUsername(username) {
        if (!this.authManager || !this.authManager.localUsers) {
            return null;
        }
        // AuthManager.localUsers is Map<lowercaseUsername, {playerId, displayUsername, password, createdAt}>
        // Use lowercase for case-insensitive lookup
        const usernameLower = username.toLowerCase();
        const userData = this.authManager.localUsers.get(usernameLower);
        if (!userData) {
            return null;
        }
        return { playerId: userData.playerId };
    }

    getUsernameById(playerId) {
        if (!this.authManager || !this.authManager.localUsers) {
            return 'Unknown';
        }
        // Search through localUsers to find matching playerId, return display username
        for (const [lowercaseKey, userData] of this.authManager.localUsers) {
            if (userData.playerId === playerId) {
                return userData.displayUsername || lowercaseKey; // Return original case
            }
        }
        return 'Unknown';
    }

    getFactionById(playerId) {
        if (!this.authManager || !this.authManager.localPlayerData) {
            return null;
        }
        // AuthManager.localPlayerData is Map<playerId, {factionId, ...}>
        const playerData = this.authManager.localPlayerData.get(playerId);
        return playerData ? playerData.factionId : null;
    }

    isPlayerOnline(playerId) {
        // Use O(1) lookup via messageRouter if available
        if (this.messageRouter) {
            return this.messageRouter.isAccountOnline(playerId);
        }

        // Fallback to O(n) iteration
        if (!this.connectedClients) {
            return false;
        }
        for (const [clientId, client] of this.connectedClients) {
            if (client.accountId === playerId) {
                return client.currentChunk !== null && client.currentChunk !== undefined;
            }
        }
        return false;
    }
}

// Singleton instance
const friendsManager = new FriendsManager();

module.exports = friendsManager;

/**
 * FriendsPanel.js
 * In-game friend management UI
 * Allows adding friends, viewing friend list, and managing requests
 */

export class FriendsPanel {
    constructor(gameState, networkManager) {
        this.gameState = gameState;
        this.networkManager = networkManager;

        this.panel = null;
        this.isVisible = false;
        this.pollInterval = null;

        // Pending requests received
        this.pendingRequests = [];

        // Track requests being processed to prevent race conditions with polling
        this.processingRequests = new Set();

        // Debounce flag to prevent double-submissions
        this.isSendingRequest = false;

        this.createElements();
        this.setupMessageHandlers();
    }

    createElements() {
        // Create panel container
        this.panel = document.createElement('div');
        this.panel.id = 'friendsPanel';
        this.panel.style.cssText = `
            display: none;
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%);
            border: 2px solid #444;
            border-radius: 12px;
            padding: 20px;
            width: 350px;
            max-height: 500px;
            overflow-y: auto;
            z-index: 10001;
            font-family: 'Segoe UI', Arial, sans-serif;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        `;

        document.body.appendChild(this.panel);

        // Event delegation - attach ONCE to panel container
        this.panel.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;

            e.stopPropagation();
            const action = btn.dataset.action;

            switch (action) {
                case 'close':
                    this.hide();
                    break;
                case 'addFriend':
                    this.handleAddFriend();
                    break;
                case 'accept':
                    this.handleAcceptRequest(btn.dataset.requestId);
                    break;
                case 'decline':
                    this.handleDeclineRequest(btn.dataset.requestId);
                    break;
                case 'remove':
                    this.handleRemoveFriend(btn.dataset.friendId);
                    break;
            }
        });

        // Keypress delegation for input
        this.panel.addEventListener('keypress', (e) => {
            if (e.target.id === 'addFriendInput' && e.key === 'Enter') {
                this.handleAddFriend();
            }
        });
    }

    setupMessageHandlers() {
        // Listen for friend-related server messages
        if (this.networkManager) {
            this.networkManager.on('friends_list_response', (data) => {
                this.gameState.setFriendsList(data.friends);
                // Extract pending requests from friends list (status === 'pending')
                const pendingFromServer = (data.friends || []).filter(f => f.status === 'pending');
                // Merge with any real-time notifications we received
                for (const pending of pendingFromServer) {
                    const reqId = pending.requestId || pending.id;
                    // Skip if already in our list OR if it's currently being processed (prevents race condition)
                    if (!this.pendingRequests.find(p => p.requestId === reqId) && !this.processingRequests.has(reqId)) {
                        this.pendingRequests.push({
                            requestId: reqId,
                            fromUsername: pending.username
                        });
                    }
                }
                if (this.isVisible) this.render();
            });

            this.networkManager.on('friend_request_received', (data) => {
                // Check if we already have this request
                if (!this.pendingRequests.find(p => p.requestId === data.requestId)) {
                    this.pendingRequests.push(data);
                }
                if (this.isVisible) this.render();
                this.showNotification(`Friend request from ${data.fromUsername}`);
            });

            this.networkManager.on('friend_request_response', (data) => {
                if (data.success) {
                    this.showNotification('Friend request sent!');
                    // Refresh friends list to update UI
                    this.networkManager.sendMessage('get_friends_list', {});
                } else {
                    this.showNotification(data.message || 'Failed to send request');
                }
            });

            this.networkManager.on('friend_request_accepted', (data) => {
                this.showNotification(`${data.friendUsername} accepted your friend request!`);
                // Refresh friends list
                this.networkManager.sendMessage('get_friends_list', {});
            });

            this.networkManager.on('friend_accept_response', (data) => {
                if (data.success) {
                    this.showNotification('Friend request accepted!');
                    // Refresh friends list
                    this.networkManager.sendMessage('get_friends_list', {});
                } else {
                    this.showNotification(data.message || 'Failed to accept request');
                }
            });
        }
    }

    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    show() {
        // Cancel auto-run when opening friends panel
        window.game?.inputManager?.cancelAutoRun();

        // Request fresh friends list from server
        this.networkManager.sendMessage('get_friends_list', {});

        // Start polling every 5 seconds for fresh data (reduced from 1s to prevent click interruption)
        // Real-time updates (friend_request_received, friend_request_accepted) still arrive immediately
        if (this.pollInterval) clearInterval(this.pollInterval);
        this.pollInterval = setInterval(() => {
            this.networkManager.sendMessage('get_friends_list', {});
        }, 5000);

        this.render();
        this.panel.style.display = 'block';
        this.isVisible = true;
    }

    hide() {
        // Stop polling
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }

        this.panel.style.display = 'none';
        this.isVisible = false;
        // Refresh friends list so SpawnScreen updates with any changes
        this.networkManager.sendMessage('get_friends_list', {});
    }

    render() {
        const friends = this.gameState.friendsList || [];
        const acceptedFriends = friends.filter(f => f.status === 'accepted');
        // Note: pending requests from server are already merged into this.pendingRequests

        // Preserve input value across re-renders
        const existingInput = document.getElementById('addFriendInput');
        const savedInputValue = existingInput ? existingInput.value : '';
        const inputHadFocus = existingInput && document.activeElement === existingInput;

        this.panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h2 style="margin: 0; color: #fff; font-size: 20px;">Friends</h2>
                <button data-action="close" style="
                    background: transparent;
                    border: none;
                    color: #C8B898;
                    font-size: 24px;
                    cursor: pointer;
                    padding: 0;
                    line-height: 1;
                ">×</button>
            </div>

            <!-- Add Friend -->
            <div style="margin-bottom: 20px;">
                <div style="display: flex; gap: 8px;">
                    <input
                        type="text"
                        id="addFriendInput"
                        placeholder="Enter username"
                        style="
                            flex: 1;
                            padding: 8px 12px;
                            border: 1px solid #444;
                            border-radius: 6px;
                            background: #333;
                            color: #fff;
                            font-size: 14px;
                        "
                    />
                    <button data-action="addFriend" style="
                        padding: 8px 16px;
                        background: #4a7c4e;
                        border: none;
                        border-radius: 6px;
                        color: #fff;
                        cursor: pointer;
                        font-size: 14px;
                    ">Add</button>
                </div>
            </div>

            <!-- Pending Incoming Requests -->
            ${this.pendingRequests.length > 0 ? `
                <div style="margin-bottom: 20px;">
                    <h3 style="margin: 0 0 10px 0; color: #f90; font-size: 14px;">
                        Friend Requests (${this.pendingRequests.length})
                    </h3>
                    ${this.pendingRequests.map(req => `
                        <div style="
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            padding: 10px;
                            background: #3a3a2a;
                            border-radius: 6px;
                            margin-bottom: 6px;
                        ">
                            <span style="color: #fff;">${req.fromUsername}</span>
                            <div>
                                <button data-action="accept" data-request-id="${req.requestId}" style="
                                    padding: 4px 10px;
                                    background: #4a7c4e;
                                    border: none;
                                    border-radius: 4px;
                                    color: #fff;
                                    cursor: pointer;
                                    margin-right: 4px;
                                ">Accept</button>
                                <button data-action="decline" data-request-id="${req.requestId}" style="
                                    padding: 4px 10px;
                                    background: #7c4a4a;
                                    border: none;
                                    border-radius: 4px;
                                    color: #fff;
                                    cursor: pointer;
                                ">Decline</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            <!-- Friends List -->
            <div>
                <h3 style="margin: 0 0 10px 0; color: #D4C4A8; font-size: 14px;">
                    Friends (${acceptedFriends.length}/20)
                </h3>
                ${acceptedFriends.length > 0 ? acceptedFriends.map(friend => `
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 10px;
                        background: #333;
                        border-radius: 6px;
                        margin-bottom: 6px;
                    ">
                        <div>
                            <span style="color: #fff;">${friend.username}</span>
                            <span style="
                                display: inline-block;
                                width: 8px;
                                height: 8px;
                                border-radius: 50%;
                                background: ${friend.online ? '#4a4' : '#666'};
                                margin-left: 8px;
                            "></span>
                            ${friend.faction ? `
                                <span style="color: #C8B898; font-size: 12px; margin-left: 8px;">
                                    ${this.gameState.getFactionName(friend.faction)}
                                </span>
                            ` : ''}
                        </div>
                        <button data-action="remove" data-friend-id="${friend.id}" style="
                            padding: 4px 8px;
                            background: transparent;
                            border: 1px solid #555;
                            border-radius: 4px;
                            color: #C8B898;
                            cursor: pointer;
                            font-size: 12px;
                        ">Remove</button>
                    </div>
                `).join('') : `
                    <p style="color: #C8B898; text-align: center; margin: 20px 0;">
                        No friends yet. Add someone!
                    </p>
                `}
            </div>
        `;

        // Restore input value and focus after re-render
        const newInput = document.getElementById('addFriendInput');
        if (newInput && savedInputValue) {
            newInput.value = savedInputValue;
        }
        if (newInput && inputHadFocus) {
            newInput.focus();
        }
    }

    handleAddFriend() {
        // Prevent double-submissions
        if (this.isSendingRequest) return;

        const input = document.getElementById('addFriendInput');
        const username = input?.value.trim();

        if (!username) {
            this.showNotification('Please enter a username');
            return;
        }

        if (this.gameState.isGuest) {
            this.showNotification('Guests cannot add friends. Create an account!');
            return;
        }

        this.isSendingRequest = true;

        this.networkManager.sendMessage('friend_request', {
            username: username
        });
        window.tasksPanel?.onFriendRequestSent();

        input.value = '';

        // Clear debounce flag after short delay
        setTimeout(() => { this.isSendingRequest = false; }, 1000);
    }

    handleAcceptRequest(requestId) {
        // Mark as processing to prevent race condition with polling
        this.processingRequests.add(requestId);

        this.networkManager.sendMessage('friend_accept', {
            requestId: requestId
        });

        // Remove from local pending list
        this.pendingRequests = this.pendingRequests.filter(r => r.requestId !== requestId);
        this.render();

        // Clear from processing set after delay (server should have processed by then)
        setTimeout(() => this.processingRequests.delete(requestId), 3000);
    }

    handleDeclineRequest(requestId) {
        // Mark as processing to prevent race condition with polling
        this.processingRequests.add(requestId);

        this.networkManager.sendMessage('friend_decline', {
            requestId: requestId
        });

        // Remove from local pending list
        this.pendingRequests = this.pendingRequests.filter(r => r.requestId !== requestId);
        this.render();

        // Clear from processing set after delay (server should have processed by then)
        setTimeout(() => this.processingRequests.delete(requestId), 3000);
    }

    handleRemoveFriend(friendId) {
        if (confirm('Remove this friend?')) {
            this.networkManager.sendMessage('friend_remove', {
                friendId: friendId
            });

            // Refresh list
            this.networkManager.sendMessage('get_friends_list', {});
        }
    }

    showNotification(message) {
        // Create toast notification
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: rgba(42, 42, 42, 0.95);
            border: 2px solid #5C8A6B;
            border-radius: 8px;
            padding: 12px 20px;
            color: #fff;
            font-family: 'Segoe UI', Arial, sans-serif;
            font-size: 14px;
            z-index: 10001;
            animation: slideIn 0.3s ease;
            max-width: 300px;
        `;
        toast.textContent = message;

        // Add animation keyframes if not already added
        if (!document.getElementById('friendsToastStyles')) {
            const style = document.createElement('style');
            style.id = 'friendsToastStyles';
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes slideOut {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(toast);

        // Remove after 4 seconds
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }
}

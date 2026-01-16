/**
 * WebSocketTransport.js
 * Pure WebSocket connection management - NO game logic
 * Handles connection, disconnection, and message sending/receiving
 */

export class WebSocketTransport {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectInterval = 5000; // 5 seconds
        this.reconnectTimer = null;

        // Callback handlers
        this.onMessageCallback = null;
        this.onConnectCallback = null;
        this.onDisconnectCallback = null;
        this.onErrorCallback = null;
        this.onReconnectAttemptCallback = null;
        this.onReconnectFailedCallback = null;
    }

    /**
     * Connect to WebSocket server
     * @param {string} url - WebSocket URL (ws:// or wss://)
     */
    connect(url) {
        // Close existing connection if any
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
        }

        try {
            this.ws = new WebSocket(url);
            this.setupEventHandlers();
        } catch (error) {
            console.error('Failed to create WebSocket:', error);
            if (this.onErrorCallback) {
                this.onErrorCallback(error);
            }
        }
    }

    /**
     * Setup WebSocket event handlers
     * @private
     */
    setupEventHandlers() {
        this.ws.onopen = () => {
            this.reconnectAttempts = 0;

            // Clear any pending reconnect timer
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }

            if (this.onConnectCallback) {
                this.onConnectCallback();
            }
        };

        this.ws.onclose = (event) => {

            if (this.onDisconnectCallback) {
                this.onDisconnectCallback(event);
            }

            // Attempt reconnection
            this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);

            if (this.onErrorCallback) {
                this.onErrorCallback(error);
            }
        };

        this.ws.onmessage = async (event) => {
            try {
                // Handle Blob messages (convert to text first)
                const messageData = event.data instanceof Blob ?
                    await event.data.text() : event.data;

                const data = JSON.parse(messageData);

                // Version check on welcome message - force refresh if server restarted
                if (data.type === 'welcome' && data.serverVersion !== undefined) {
                    const cachedVersion = localStorage.getItem('serverVersion');

                    if (cachedVersion === null) {
                        // No version stored - check if they have other stale data
                        if (localStorage.length > 0) {
                            // Has other data but no version - corrupted/stale state
                            console.log('No version but has cached data, clearing and refreshing...');
                            localStorage.clear();
                            location.reload(true);
                            return;
                        }
                        // Truly new user - no data at all, let them through
                    } else if (cachedVersion !== String(data.serverVersion)) {
                        // Version mismatch - clear cache and hard refresh
                        console.log(`Server version changed (${cachedVersion} -> ${data.serverVersion}), refreshing...`);
                        localStorage.clear();
                        location.reload(true);
                        return;
                    }

                    // Save current version and continue
                    localStorage.setItem('serverVersion', data.serverVersion);
                }

                if (this.onMessageCallback) {
                    this.onMessageCallback(data);
                }
            } catch (error) {
                console.error('Failed to parse WebSocket message:', error);
            }
        };
    }

    /**
     * Attempt to reconnect to the server
     * @private
     */
    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            if (this.onReconnectFailedCallback) {
                this.onReconnectFailedCallback(this.reconnectAttempts, this.maxReconnectAttempts);
            }
            return;
        }

        this.reconnectAttempts++;

        // Notify about reconnection attempt
        if (this.onReconnectAttemptCallback) {
            this.onReconnectAttemptCallback(this.reconnectAttempts, this.maxReconnectAttempts);
        }

        this.reconnectTimer = setTimeout(() => {
            // Get the URL from the previous connection
            if (this.ws && this.ws.url) {
                this.connect(this.ws.url);
            }
        }, this.reconnectInterval);
    }

    /**
     * Manually trigger a reconnection attempt
     * Resets the attempt counter and tries to connect
     */
    manualReconnect() {
        // Clear any pending reconnect timer
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        // Reset attempt counter
        this.reconnectAttempts = 0;

        // Get the URL from the previous connection
        if (this.ws && this.ws.url) {
            this.connect(this.ws.url);
        }
    }

    /**
     * Disconnect from WebSocket server
     */
    disconnect() {
        // Clear reconnect timer
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        // Prevent auto-reconnect
        this.reconnectAttempts = this.maxReconnectAttempts;

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    /**
     * Send a message through WebSocket
     * @param {object} message - Message object to send (will be JSON.stringify'd)
     * @returns {boolean} - True if sent successfully, false otherwise
     */
    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify(message));
                return true;
            } catch (error) {
                console.error('Failed to send message:', error);
                return false;
            }
        }

        return false;
    }

    /**
     * Check if WebSocket is connected
     * @returns {boolean}
     */
    isConnected() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    /**
     * Register callback for incoming messages
     * @param {function} callback - Function to call when message received
     */
    onMessage(callback) {
        this.onMessageCallback = callback;
    }

    /**
     * Register callback for connection established
     * @param {function} callback - Function to call when connected
     */
    onConnect(callback) {
        this.onConnectCallback = callback;
    }

    /**
     * Register callback for disconnection
     * @param {function} callback - Function to call when disconnected
     */
    onDisconnect(callback) {
        this.onDisconnectCallback = callback;
    }

    /**
     * Register callback for errors
     * @param {function} callback - Function to call when error occurs
     */
    onError(callback) {
        this.onErrorCallback = callback;
    }

    /**
     * Register callback for reconnection attempts
     * @param {function} callback - Function(attemptNumber, maxAttempts) called on each attempt
     */
    onReconnectAttempt(callback) {
        this.onReconnectAttemptCallback = callback;
    }

    /**
     * Register callback for when all reconnection attempts have failed
     * @param {function} callback - Function(attemptNumber, maxAttempts) called when max reached
     */
    onReconnectFailed(callback) {
        this.onReconnectFailedCallback = callback;
    }

    /**
     * Get current connection state
     * @returns {string} - 'connecting', 'open', 'closing', 'closed', or 'none'
     */
    getConnectionState() {
        if (!this.ws) return 'none';

        switch (this.ws.readyState) {
            case WebSocket.CONNECTING: return 'connecting';
            case WebSocket.OPEN: return 'open';
            case WebSocket.CLOSING: return 'closing';
            case WebSocket.CLOSED: return 'closed';
            default: return 'unknown';
        }
    }
}

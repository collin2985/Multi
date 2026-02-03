/**
 * WebSocketTransport.js
 * Pure WebSocket connection management - NO game logic
 * Handles connection, disconnection, and message sending/receiving
 */

import { FingerprintCollector } from './FingerprintCollector.js';

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
        this.onConnectionFailedCallback = null; // For permanent connection failures (banned, etc.)

        // Connection watchdog - detects dead connections when server stops sending messages
        this.lastMessageTime = 0;
        this.connectionWatchdogInterval = null;
        this.CONNECTION_TIMEOUT_MS = 30000;  // 30 seconds without any message = dead connection

        // Visibility/lifecycle handlers - prevents false positives when tab is inactive or page is frozen
        this.visibilityHandler = null;
        this.focusHandler = null;
        this.resumeHandler = null;
        this.pageshowHandler = null;

        // Track last URL for reconnection after intentional disconnect
        this.lastUrl = null;
        // Flag to suppress reconnect UI during intentional disconnects (e.g., respawn)
        this.intentionalDisconnect = false;

        // Cached fingerprint - collected once per session, reused on reconnect
        this.cachedFingerprint = null;
    }

    /**
     * Connect to WebSocket server
     * Collects fingerprint before connecting, sends it immediately on open
     * @param {string} url - WebSocket URL (ws:// or wss://)
     */
    async connect(url) {
        // Close existing connection if any
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
        }

        // Save URL for reconnection and clear intentional disconnect flag
        this.lastUrl = url;
        this.intentionalDisconnect = false;

        // Collect fingerprint once per session (cache for reconnects)
        if (!this.cachedFingerprint) {
            await this._collectFingerprint();
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
     * Collect fingerprint for server validation
     * Uses degraded fallback if full collection fails
     * @private
     */
    async _collectFingerprint() {
        try {
            const collector = new FingerprintCollector();
            await collector.collect();
            this.cachedFingerprint = {
                hash: await collector.getHash(),
                partialHashes: await collector.getPartialHashes()
            };
        } catch (e) {
            console.warn('Fingerprint collection failed, using degraded fallback');
            // Fallback: generate deterministic degraded fingerprint from available signals
            const degradedSignals = {
                screen: `${screen.width}x${screen.height}x${screen.colorDepth}`,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                platform: navigator.platform,
                cores: navigator.hardwareConcurrency || 0,
                memory: navigator.deviceMemory || 0,
                languages: (navigator.languages || []).slice(0, 3).join(',')
            };
            // Hash to 64-char hex to pass validation
            const signalString = JSON.stringify(degradedSignals);
            const encoder = new TextEncoder();
            const data = encoder.encode(signalString);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const degradedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

            this.cachedFingerprint = {
                hash: degradedHash,
                partialHashes: { degraded: true },
                degraded: true
            };
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

            // Send fingerprint immediately (required before any other messages)
            if (this.cachedFingerprint) {
                this.ws.send(JSON.stringify({
                    type: 'fingerprint',
                    payload: this.cachedFingerprint
                }));
            }

            if (this.onConnectCallback) {
                this.onConnectCallback();
            }
        };

        this.ws.onclose = (event) => {
            // Stop tick watchdog on disconnect to prevent stale intervals
            this.stopTickWatchdog();

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
            // Update watchdog on ANY message received - connection is alive
            this.lastMessageTime = Date.now();

            try {
                // Handle Blob messages (convert to text first)
                const messageData = event.data instanceof Blob ?
                    await event.data.text() : event.data;

                const data = JSON.parse(messageData);

                // Handle fingerprint rejection (banned or invalid)
                if (data.type === 'fingerprint_rejected') {
                    this._handleFingerprintRejection(data.reason);
                    return;
                }

                // Handle being kicked while online (banned mid-session)
                if (data.type === 'kicked') {
                    this._handleKicked(data.reason);
                    return;
                }

                // Version check on welcome message - force refresh if server restarted
                if (data.type === 'welcome' && data.serverVersion !== undefined) {
                    const cachedVersion = localStorage.getItem('serverVersion');

                    if (cachedVersion === null) {
                        // No version stored - check if they have other stale data
                        if (localStorage.length > 0) {
                            // Has other data but no version - corrupted/stale state
                            localStorage.clear();
                            window._allowNavigation = true;
                            location.reload(true);
                            return;
                        }
                        // Truly new user - no data at all, let them through
                    } else if (cachedVersion !== String(data.serverVersion)) {
                        // Version mismatch - clear cache and hard refresh
                        localStorage.clear();
                        window._allowNavigation = true;
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
     * Handle fingerprint rejection (banned or invalid)
     * Shows generic error to avoid confirming ban status
     * @private
     */
    _handleFingerprintRejection(reason) {
        // Stop reconnection attempts - don't spam the server
        this.reconnectAttempts = this.maxReconnectAttempts;

        // Close the websocket
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        // Emit generic failure event - UI shows "server unavailable"
        if (this.onConnectionFailedCallback) {
            this.onConnectionFailedCallback('server_unavailable');
        }
    }

    /**
     * Handle being kicked while online (banned mid-session)
     * @private
     */
    _handleKicked(reason) {
        this.reconnectAttempts = this.maxReconnectAttempts;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        if (this.onConnectionFailedCallback) {
            this.onConnectionFailedCallback('server_unavailable');
        }
    }

    /**
     * Attempt to reconnect to the server
     * @private
     */
    attemptReconnect() {
        // Skip reconnect attempts and UI for intentional disconnects (e.g., respawn)
        if (this.intentionalDisconnect) {
            return;
        }

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
            // Get the URL from the previous connection or saved lastUrl
            const url = (this.ws && this.ws.url) || this.lastUrl;
            if (url) {
                this.connect(url);
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

        // Reset attempt counter and intentional disconnect flag
        this.reconnectAttempts = 0;
        this.intentionalDisconnect = false;

        // Get the URL from the previous connection or saved lastUrl
        const url = (this.ws && this.ws.url) || this.lastUrl;
        if (url) {
            this.connect(url);
        }
    }

    /**
     * Disconnect from WebSocket server
     * @param {boolean} intentional - If true, suppress reconnect UI (used for respawn)
     */
    disconnect(intentional = false) {
        // Stop tick watchdog
        this.stopTickWatchdog();

        // Clear reconnect timer
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        // Mark as intentional to suppress reconnect failure UI
        this.intentionalDisconnect = intentional;

        // Prevent auto-reconnect
        this.reconnectAttempts = this.maxReconnectAttempts;

        if (this.ws) {
            // Save URL before nulling (lastUrl should already be set from connect())
            if (this.ws.url) {
                this.lastUrl = this.ws.url;
            }
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
     * Register callback for permanent connection failures (banned, etc.)
     * @param {function} callback - Function(reason) called when connection permanently fails
     */
    onConnectionFailed(callback) {
        this.onConnectionFailedCallback = callback;
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

    /**
     * Start connection watchdog to detect dead connections
     * If no message received for CONNECTION_TIMEOUT_MS, forces reconnection
     */
    startTickWatchdog() {
        // Clear any existing watchdog first (prevents stale intervals after reconnect)
        if (this.connectionWatchdogInterval) {
            clearInterval(this.connectionWatchdogInterval);
            this.connectionWatchdogInterval = null;
        }

        this.lastMessageTime = Date.now();  // Initialize on start
        this.connectionWatchdogInterval = setInterval(() => {
            // Only check if we think we're connected
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                const elapsed = Date.now() - this.lastMessageTime;
                if (elapsed > this.CONNECTION_TIMEOUT_MS) {
                    console.error(`[WebSocket] No message for ${elapsed}ms - forcing reconnect`);
                    this.ws.close();  // Triggers onclose -> reconnection flow
                }
            }
        }, 5000);  // Check every 5 seconds (no need to check frequently with 30s timeout)

        // Handle tab visibility changes to prevent false positives
        // Browsers throttle setInterval when tab is hidden, causing large elapsed times
        if (!this.visibilityHandler) {
            this.visibilityHandler = () => {
                if (!document.hidden) {
                    // Tab became visible - reset time to prevent false positive
                    this.lastMessageTime = Date.now();
                }
            };
            document.addEventListener('visibilitychange', this.visibilityHandler);
        }

        // Handle window focus - browsers may pause timers when window loses focus
        if (!this.focusHandler) {
            this.focusHandler = () => {
                this.lastMessageTime = Date.now();
            };
            window.addEventListener('focus', this.focusHandler);
        }

        // Handle page resume from freeze (Page Lifecycle API)
        // Browsers can freeze pages entirely when backgrounded for a while
        if (!this.resumeHandler) {
            this.resumeHandler = () => {
                this.lastMessageTime = Date.now();
            };
            document.addEventListener('resume', this.resumeHandler);
        }

        // Handle pageshow - fires when page is restored from bfcache or after being frozen
        if (!this.pageshowHandler) {
            this.pageshowHandler = (event) => {
                // event.persisted is true if page was restored from bfcache
                this.lastMessageTime = Date.now();
            };
            window.addEventListener('pageshow', this.pageshowHandler);
        }
    }

    /**
     * Stop connection watchdog
     * Called on intentional disconnect to prevent false positives
     */
    stopTickWatchdog() {
        if (this.connectionWatchdogInterval) {
            clearInterval(this.connectionWatchdogInterval);
            this.connectionWatchdogInterval = null;
        }
        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = null;
        }
        if (this.focusHandler) {
            window.removeEventListener('focus', this.focusHandler);
            this.focusHandler = null;
        }
        if (this.resumeHandler) {
            document.removeEventListener('resume', this.resumeHandler);
            this.resumeHandler = null;
        }
        if (this.pageshowHandler) {
            window.removeEventListener('pageshow', this.pageshowHandler);
            this.pageshowHandler = null;
        }
    }
}

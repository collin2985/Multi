/**
 * AuthClient.js
 * Handles authentication communication with the server
 */

import { FingerprintCollector } from './FingerprintCollector.js';

export class AuthClient {
    constructor(networkManager) {
        this.networkManager = networkManager;
        this.pendingRequests = new Map(); // Track pending auth requests
        this.fingerprintCollector = new FingerprintCollector();
        this.cachedFingerprint = null; // Cache to avoid re-collecting
        this.cachedPartialHashes = null;
    }

    /**
     * Collect fingerprint (cached after first collection)
     * @private
     * @throws {Error} If fingerprint collection fails
     */
    async _getFingerprint() {
        if (!this.cachedFingerprint) {
            await this.fingerprintCollector.collect();
            this.cachedFingerprint = await this.fingerprintCollector.getHash();
            this.cachedPartialHashes = await this.fingerprintCollector.getPartialHashes();
        }

        // Validate fingerprint was collected - required for ban system
        if (!this.cachedFingerprint || typeof this.cachedFingerprint !== 'string' || this.cachedFingerprint.length < 32) {
            throw new Error('FINGERPRINT_FAILED');
        }

        return {
            fingerprint: this.cachedFingerprint,
            partialHashes: this.cachedPartialHashes
        };
    }

    /**
     * Register a new account
     * @param {string} username
     * @param {string} password
     * @returns {Promise} Resolves with registration result
     */
    async register(username, password) {
        // Collect fingerprint before registering
        let fingerprint, partialHashes;
        try {
            const fpData = await this._getFingerprint();
            fingerprint = fpData.fingerprint;
            partialHashes = fpData.partialHashes;
        } catch (e) {
            if (e.message === 'FINGERPRINT_FAILED') {
                return Promise.reject(new Error('Unable to verify device. Please disable privacy extensions and try again.'));
            }
            throw e;
        }

        return new Promise((resolve, reject) => {
            const requestId = 'register_' + Date.now();

            // Store the promise callbacks
            this.pendingRequests.set(requestId, { resolve, reject });

            // Send registration request with fingerprint
            const success = this.networkManager.sendMessage('register_request', {
                username,
                password,
                fingerprint,
                partialHashes,
                requestId
            });

            if (!success) {
                this.pendingRequests.delete(requestId);
                reject(new Error('Failed to send registration request'));
            }

            // Timeout after 10 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    reject(new Error('Registration request timed out'));
                }
            }, 10000);
        });
    }

    /**
     * Login with existing account
     * @param {string} username
     * @param {string} password
     * @returns {Promise} Resolves with login result
     */
    async login(username, password) {
        // Collect fingerprint before login
        let fingerprint, partialHashes;
        try {
            const fpData = await this._getFingerprint();
            fingerprint = fpData.fingerprint;
            partialHashes = fpData.partialHashes;
        } catch (e) {
            if (e.message === 'FINGERPRINT_FAILED') {
                return Promise.reject(new Error('Unable to verify device. Please disable privacy extensions and try again.'));
            }
            throw e;
        }

        return new Promise((resolve, reject) => {
            const requestId = 'login_' + Date.now();

            this.pendingRequests.set(requestId, { resolve, reject });

            const success = this.networkManager.sendMessage('login_request', {
                username,
                password,
                fingerprint,
                partialHashes,
                requestId
            });

            if (!success) {
                this.pendingRequests.delete(requestId);
                reject(new Error('Failed to send login request'));
            }

            // Timeout after 10 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    reject(new Error('Login request timed out'));
                }
            }, 10000);
        });
    }

    /**
     * Validate a session token
     * @param {string} token
     * @returns {Promise} Resolves with validation result
     */
    async validateSession(token) {
        // Collect fingerprint for ban check on session validation
        let fingerprint, partialHashes;
        try {
            const fpData = await this._getFingerprint();
            fingerprint = fpData.fingerprint;
            partialHashes = fpData.partialHashes;
        } catch (e) {
            if (e.message === 'FINGERPRINT_FAILED') {
                return Promise.reject(new Error('Unable to verify device. Please disable privacy extensions and try again.'));
            }
            throw e;
        }

        return new Promise((resolve, reject) => {
            const requestId = 'validate_' + Date.now();

            this.pendingRequests.set(requestId, { resolve, reject });

            const success = this.networkManager.sendMessage('validate_session', {
                token,
                fingerprint,
                partialHashes,
                requestId
            });

            if (!success) {
                this.pendingRequests.delete(requestId);
                reject(new Error('Failed to send validation request'));
            }

            // Timeout after 5 seconds (validation should be quick)
            setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    reject(new Error('Session validation timed out'));
                }
            }, 5000);
        });
    }

    /**
     * Logout (invalidate session)
     * @param {string} token
     * @returns {Promise} Resolves when logout complete
     */
    logout(token) {
        return new Promise((resolve, reject) => {
            const requestId = 'logout_' + Date.now();

            this.pendingRequests.set(requestId, { resolve, reject });

            const success = this.networkManager.sendMessage('logout_request', {
                token,
                requestId
            });

            if (!success) {
                this.pendingRequests.delete(requestId);
                reject(new Error('Failed to send logout request'));
            }

            // Timeout after 5 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    // Still resolve on timeout for logout (not critical)
                    resolve({ success: true });
                }
            }, 5000);
        });
    }

    /**
     * Send auth upgrade message (guest -> registered)
     * @param {string} accountId
     * @param {string} username
     * @param {object} gameState Current game state to save
     * @returns {Promise}
     */
    sendAuthUpgrade(accountId, username, gameState) {
        return new Promise((resolve, reject) => {
            const requestId = 'upgrade_' + Date.now();

            this.pendingRequests.set(requestId, { resolve, reject });

            const success = this.networkManager.sendMessage('auth_upgrade', {
                accountId,
                username,
                inventory: gameState.inventory || [],
                position: gameState.position || { x: 0, y: 0, z: 0 },
                health: gameState.health || 100,
                hunger: gameState.hunger || 100,
                stats: gameState.stats || {},
                requestId
            });

            if (!success) {
                this.pendingRequests.delete(requestId);
                reject(new Error('Failed to send auth upgrade'));
            }

            // Timeout after 5 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    reject(new Error('Auth upgrade timed out'));
                }
            }, 5000);
        });
    }

    /**
     * Handle auth response messages from server
     * Called by MessageRouter when auth responses arrive
     * @param {string} type Message type
     * @param {object} payload Response payload
     */
    handleAuthResponse(type, payload) {
        let requestId = payload.requestId;

        // If no requestId in payload, try to extract from known patterns
        if (!requestId) {
            // Handle responses without requestId (for backward compatibility)
            // This would need to be enhanced based on your actual message structure
            console.warn('Auth response without requestId:', type, payload);
            return;
        }

        const pending = this.pendingRequests.get(requestId);
        if (!pending) {
            console.warn('No pending request for:', requestId);
            return;
        }

        this.pendingRequests.delete(requestId);

        switch (type) {
            case 'register_response':
                if (payload.success) {
                    pending.resolve(payload);
                } else {
                    pending.reject(new Error(payload.message || 'Registration failed'));
                }
                break;

            case 'login_response':
                if (payload.success) {
                    pending.resolve(payload);
                } else {
                    pending.reject(new Error(payload.message || 'Login failed'));
                }
                break;

            case 'session_validation':
                if (payload.valid) {
                    pending.resolve(payload);
                } else {
                    pending.reject(new Error('Invalid session'));
                }
                break;

            case 'logout_response':
                pending.resolve(payload);
                break;

            case 'auth_upgrade_success':
                pending.resolve(payload);
                break;

            default:
                pending.reject(new Error('Unknown auth response type: ' + type));
        }
    }

    /**
     * Store session token in localStorage
     * @param {string} token
     */
    storeSessionToken(token) {
        if (token) {
            localStorage.setItem('sessionToken', token);
        }
    }

    /**
     * Get stored session token
     * @returns {string|null}
     */
    getStoredToken() {
        return localStorage.getItem('sessionToken');
    }

    /**
     * Clear stored session
     */
    clearStoredSession() {
        localStorage.removeItem('sessionToken');
    }

    /**
     * Check if user is logged in (has valid token)
     * @returns {boolean}
     */
    hasStoredSession() {
        return this.getStoredToken() !== null;
    }

    /**
     * Attempt auto-login with stored token
     * @returns {Promise} Resolves with validation result
     */
    async attemptAutoLogin() {
        const token = this.getStoredToken();
        if (!token) {
            return { valid: false };
        }

        try {
            const result = await this.validateSession(token);
            return result;
        } catch (error) {
            console.error('Auto-login failed:', error);
            this.clearStoredSession();
            return { valid: false };
        }
    }
}
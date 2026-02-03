/**
 * SaveExitOverlay.js
 * Fullscreen countdown overlay for "Save and Exit".
 * 10-second timer pauses when tab is hidden (Page Visibility API).
 * The only way to get "Resume Last Session" on the spawn screen is to
 * complete this countdown without dying.
 */

import { CONFIG } from '../config.js';

export class SaveExitOverlay {
    constructor(gameState, networkManager, syncSystem) {
        this.gameState = gameState;
        this.networkManager = networkManager;
        this.syncSystem = syncSystem;

        this.isActive = false;
        this.countdownSeconds = 10;
        this.intervalId = null;

        // Bound handlers for cleanup
        this._onVisibilityChange = this._onVisibilityChange.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);

        this._createDOM();
    }

    _createDOM() {
        this.overlay = document.createElement('div');
        this.overlay.id = 'saveExitOverlay';
        this.overlay.style.cssText = `
            display: none;
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.75);
            z-index: 10001;
            justify-content: center;
            align-items: center;
            font-family: 'Segoe UI', Arial, sans-serif;
        `;

        const box = document.createElement('div');
        box.style.cssText = `
            background: linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%);
            border: 2px solid #555;
            border-radius: 12px;
            padding: 40px 60px;
            text-align: center;
            user-select: none;
        `;

        this.titleEl = document.createElement('div');
        this.titleEl.style.cssText = 'color: #D4C4A8; font-size: 22px; font-weight: bold; margin-bottom: 8px;';
        this.titleEl.textContent = 'SAVING GAME';

        this.subtitleEl = document.createElement('div');
        this.subtitleEl.style.cssText = 'color: #999; font-size: 14px; margin-bottom: 24px;';
        this.subtitleEl.textContent = 'Stay alive to save your progress';

        this.countdownEl = document.createElement('div');
        this.countdownEl.style.cssText = 'color: #fff; font-size: 72px; font-weight: bold; margin-bottom: 24px;';
        this.countdownEl.textContent = '10';

        this.cancelBtn = document.createElement('button');
        this.cancelBtn.textContent = 'CANCEL (Esc)';
        this.cancelBtn.style.cssText = `
            padding: 10px 30px;
            background: #555;
            border: none;
            border-radius: 6px;
            color: #fff;
            font-size: 14px;
            cursor: pointer;
        `;
        this.cancelBtn.onclick = () => this.cancel();

        box.appendChild(this.titleEl);
        box.appendChild(this.subtitleEl);
        box.appendChild(this.countdownEl);
        box.appendChild(this.cancelBtn);
        this.overlay.appendChild(box);
        document.body.appendChild(this.overlay);
    }

    /**
     * Start the 10-second countdown.
     * @returns {boolean} true if countdown started, false if blocked
     */
    start() {
        if (this.isActive) return false;

        // Check if sync system can save
        if (!this.syncSystem || !this.syncSystem.canSaveState()) return false;

        this.isActive = true;
        this.countdownSeconds = 10;
        this.countdownEl.textContent = '10';
        this.overlay.style.display = 'flex';

        // Register listeners
        document.addEventListener('visibilitychange', this._onVisibilityChange);
        document.addEventListener('keydown', this._onKeyDown);

        // Only start interval if tab is currently visible
        if (!document.hidden) {
            this._startInterval();
        }

        return true;
    }

    _startInterval() {
        if (this.intervalId) return;
        this.intervalId = setInterval(() => {
            this.countdownSeconds--;
            this.countdownEl.textContent = String(this.countdownSeconds);
            if (this.countdownSeconds <= 0) {
                this._complete();
            }
        }, 1000);
    }

    _stopInterval() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    _onVisibilityChange() {
        if (document.hidden) {
            // Tab hidden: pause timer
            this._stopInterval();
        } else {
            // Tab visible: resume from current seconds
            if (this.isActive) {
                this._startInterval();
            }
        }
    }

    _onKeyDown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.cancel();
        }
    }

    /**
     * Cancel the countdown. No save is sent.
     * Called by user (Escape/button) or DeathManager.
     */
    cancel() {
        if (!this.isActive) return;
        this._cleanup();
    }

    /**
     * Countdown finished successfully. Send save and redirect.
     */
    _complete() {
        this._cleanup();

        // Send the sync
        if (this.syncSystem) {
            this.syncSystem.sendSync();
        }

        // Redirect after brief delay to let the message send
        setTimeout(() => {
            const isOnline = CONFIG.NETWORKING.USE_ONLINE_SERVER;
            if (isOnline) {
                window._allowNavigation = true;
                window.location.href = '/index.html';
            } else {
                const game = window.game;
                if (game?.inventorySyncSystem) {
                    game.inventorySyncSystem.stop();
                    game.inventorySyncSystem = null;
                }
                // Always send logout to clear server-side accountClients mapping.
                // Token may be null if "Remember Me" wasn't checked, but the server
                // clears the account association based on ws.accountId, not the token.
                const token = game?.authClient ? game.authClient.getStoredToken() : null;
                if (game?.authClient) {
                    game.authClient.logout(token);
                }
                if (game?.networkManager) {
                    game.networkManager.broadcastLogoutAndCleanup();
                }
                if (game?.authClient) {
                    game.authClient.clearStoredSession();
                }
                if (game?.gameState) {
                    game.gameState.clearAuthentication();
                }
                if (game?.loginModal) {
                    game.loginModal.show();
                }
            }
        }, 500);
    }

    _cleanup() {
        this.isActive = false;
        this._stopInterval();
        document.removeEventListener('visibilitychange', this._onVisibilityChange);
        document.removeEventListener('keydown', this._onKeyDown);
        this.overlay.style.display = 'none';
    }
}

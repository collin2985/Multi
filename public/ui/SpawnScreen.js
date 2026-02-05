/**
 * SpawnScreen.js
 * Post-auth spawn selection UI
 * Shows home spawn, friend spawn, and random spawn options
 */

import { CONFIG } from '../config.js';
import { ui } from '../ui.js';

export class SpawnScreen {
    constructor(gameState, networkManager, onSpawnSelected, onLogout = null, onOpenFriends = null) {
        this.gameState = gameState;
        this.networkManager = networkManager;
        this.onSpawnSelected = onSpawnSelected;  // Callback: (spawnType, data) => void
        this.onLogout = onLogout;  // Callback: () => void
        this.onOpenFriends = onOpenFriends;  // Callback: () => void - opens friends panel

        this.overlay = null;
        this.container = null;
        this.isVisible = false;

        // Friend spawn state
        this.selectedFriend = null;
        this.friendPositionPending = false;
        this.pollInterval = null;

        this.createElements();
        this.setupMessageHandlers();
    }

    setupMessageHandlers() {
        // Listen for friends list updates to re-render spawn screen
        if (this.networkManager) {
            this.networkManager.on('friends_list_response', (data) => {
                // Update gameState with friends list
                this.gameState.setFriendsList(data.friends);
                // Re-render if spawn screen is visible, but NOT if we're waiting for friend position or showing faction selector
                if (this.isVisible && !this.friendPositionPending) {
                    this.render();
                }
            });
        }
    }

    createElements() {
        // Create overlay
        this.overlay = document.createElement('div');
        this.overlay.id = 'spawnScreenOverlay';
        this.overlay.style.cssText = `
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.85);
            z-index: 10000;
            justify-content: center;
            align-items: center;
            font-family: 'Segoe UI', Arial, sans-serif;
        `;

        // Create container
        this.container = document.createElement('div');
        this.container.style.cssText = `
            background: linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%);
            border: 2px solid #444;
            border-radius: 12px;
            padding: 30px;
            min-width: 400px;
            max-width: 500px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        `;

        this.overlay.appendChild(this.container);
        document.body.appendChild(this.overlay);

        // Use event delegation for all button clicks (fixes missed clicks during re-render)
        this.container.addEventListener('click', (e) => this.handleContainerClick(e));
    }

    /**
     * Handle all button clicks via event delegation
     * This ensures clicks work even during re-renders
     */
    handleContainerClick(e) {
        const target = e.target.closest('button');
        if (!target) return;

        const id = target.id;
        const classList = target.classList;

        // Quality buttons
        if (classList.contains('qualityBtn')) {
            const quality = target.dataset.quality;
            if (quality) this.handleQualityChange(quality);
            return;
        }

        // Spawn buttons
        if (id === 'spawnResumeBtn') {
            this.handleResumeSpawn();
        } else if (id === 'spawnHomeBtn') {
            this.handleHomeSpawn();
        } else if (id === 'spawnRandomBtn') {
            this.handleRandomSpawn();
        } else if (id === 'openFriendsBtn') {
            if (this.onOpenFriends) this.onOpenFriends();
        } else if (id === 'logoutBtn') {
            this.handleLogout();
        }
        // Friend spawn buttons
        else if (classList.contains('spawnOnFriendBtn')) {
            const friendId = target.dataset.friendId;
            const friendUsername = target.dataset.friendUsername;
            if (friendId && friendUsername) {
                this.handleFriendSpawn(friendId, friendUsername);
            }
        }
    }

    /**
     * Show the spawn screen
     * @param {object} options - { isRespawn: boolean, errorMessage: string, kickMessage: string }
     */
    show(options = {}) {
        const isRespawn = options.isRespawn || false;
        this.pendingErrorMessage = options.errorMessage || null;
        this.kickMessage = options.kickMessage || null;  // P2P kick message banner

        // Show pre-spawn links (Discord/Wiki) during spawn selection
        const preSpawnLinks = document.getElementById('preSpawnLinks');
        if (preSpawnLinks) {
            preSpawnLinks.style.display = 'flex';
        }

        // Request fresh friends list from server (only if connected)
        // During respawn, we reconnect before spawn selection completes
        if (this.networkManager.isServerConnected()) {
            this.networkManager.sendMessage('get_friends_list', {});
        }

        // Start polling every 1 second for fresh data
        // Only sends if connected - poll will work once reconnected
        if (this.pollInterval) clearInterval(this.pollInterval);
        this.pollInterval = setInterval(() => {
            if (this.networkManager.isServerConnected()) {
                this.networkManager.sendMessage('get_friends_list', {});
            }
        }, 1000);

        this.render(isRespawn);
        this.overlay.style.display = 'flex';
        this.isVisible = true;

        // Show error message if provided
        if (this.pendingErrorMessage) {
            this.showError(this.pendingErrorMessage);
            this.pendingErrorMessage = null;
        }
    }

    hide() {
        // Stop polling
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }

        this.overlay.style.display = 'none';
        this.isVisible = false;
        this.selectedFriend = null;
        this.friendPositionPending = false;
    }

    render(isRespawn = false) {
        const hasHome = this.gameState.home !== null;
        const factionName = this.gameState.getFactionName(this.gameState.factionId);
        const onlineFriends = this.gameState.getOnlineFriendsInFaction();
        const isGuest = this.gameState.isGuest;

        // Load current quality setting
        const currentQuality = this.gameState.loadQualitySetting();

        // Guests just see "Respawn", logged-in users see welcome message
        const title = isRespawn ? 'Respawn' : (isGuest ? 'Respawn' : `Welcome back, ${this.gameState.username || 'Player'}!`);

        this.container.innerHTML = `
            <h2 style="margin: 0 0 20px 0; color: #fff; text-align: center; font-size: 24px;">
                ${title}
            </h2>

            ${this.kickMessage ? `
                <div class="spawn-kick-banner">
                    ${this.kickMessage}
                </div>
            ` : ''}

            <!-- Graphics Quality Selector -->
            <div style="margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #444;">
                <div style="color: #D4C4A8; font-size: 13px; text-transform: uppercase; margin-bottom: 10px; text-align: center;">
                    Graphics Quality
                </div>
                <div style="display: flex; gap: 8px; justify-content: center;">
                    <button id="qualityHigh" class="qualityBtn" data-quality="HIGH" style="${this.getQualityButtonStyle('HIGH', currentQuality)}">
                        High
                    </button>
                    <button id="qualityMedium" class="qualityBtn" data-quality="MEDIUM" style="${this.getQualityButtonStyle('MEDIUM', currentQuality)}">
                        Medium
                    </button>
                    <button id="qualityLow" class="qualityBtn" data-quality="LOW" style="${this.getQualityButtonStyle('LOW', currentQuality)}">
                        Low
                    </button>
                </div>
                <div style="color: #888; font-size: 11px; text-align: center; margin-top: 8px;">
                    Use Medium or Low for older hardware
                </div>
            </div>

            <!-- Spawn Options -->
            <div style="display: flex; flex-direction: column; gap: 12px;">
                ${!isGuest && this.gameState.hasSavedSession ? `
                    ${this.gameState.canResume ? `
                        <button id="spawnResumeBtn" style="${this.getButtonStyle('#9a7a4a')}">
                            Resume Last Session
                            <div style="font-size: 12px; opacity: 0.8; margin-top: 4px;">
                                Continue where you left off
                            </div>
                        </button>
                    ` : `
                        <button disabled style="${this.getButtonStyle('#555')}; cursor: not-allowed; opacity: 0.6;">
                            Resume Unavailable
                            <div style="font-size: 12px; opacity: 0.8; margin-top: 4px;">
                                Last save was on a boat
                            </div>
                        </button>
                    `}
                ` : ''}

                ${hasHome ? `
                    <button id="spawnHomeBtn" style="${this.getButtonStyle('#4a7c4e')}">
                        Spawn at Home
                    </button>
                ` : ''}

                <!-- Random Spawn and Friends buttons side by side -->
                <div style="display: flex; gap: 12px;">
                    <button id="spawnRandomBtn" style="${this.getButtonStyle('#4a6a8c')}">
                        Random Spawn
                    </button>
                    ${!isGuest ? `
                        <button id="openFriendsBtn" style="${this.getButtonStyle('#4a7c4e')}">
                            Friends
                        </button>
                    ` : ''}
                </div>
            </div>

            <!-- Friends Section (only for logged-in users) -->
            ${!isGuest ? (onlineFriends.length > 0 ? `
                <div style="margin-top: 24px; border-top: 1px solid #444; padding-top: 20px;">
                    <h3 style="margin: 0 0 12px 0; color: #D4C4A8; font-size: 14px; text-transform: uppercase;">
                        Friends in ${factionName} Territory
                    </h3>
                    <div id="friendsList" style="max-height: 200px; overflow-y: auto;">
                        ${this.renderFriendsList(onlineFriends)}
                    </div>
                </div>
            ` : `
                <div style="margin-top: 24px; border-top: 1px solid #444; padding-top: 20px;">
                    <p style="color: #C8B898; text-align: center; margin: 0;">
                        No friends online in your territory
                    </p>
                </div>
            `) : ''}

            <!-- Unavailable Friends (only for logged-in users) -->
            ${!isGuest ? this.renderUnavailableFriends() : ''}

            <!-- Faction Info (only for logged-in users) -->
            ${!isGuest ? `
                <div style="margin-top: 24px; border-top: 1px solid #444; padding-top: 16px; text-align: center;">
                    <span style="color: #D4C4A8; font-size: 13px;">
                        Faction: <span style="color: #fff;">${factionName}</span>
                    </span>
                </div>

                <!-- Logout -->
                <div style="margin-top: 16px; text-align: center;">
                    <button id="logoutBtn" style="
                        background: transparent;
                        border: none;
                        color: #C8B898;
                        padding: 8px 16px;
                        cursor: pointer;
                        font-size: 12px;
                        text-decoration: underline;
                    ">Log Out</button>
                </div>
            ` : ''}

            <!-- Loading overlay -->
            <div id="spawnLoading" style="
                display: none;
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.8);
                justify-content: center;
                align-items: center;
                border-radius: 12px;
            ">
                <div style="color: #fff; text-align: center;">
                    <div id="spawnLoadingText" style="font-size: 18px; margin-bottom: 8px;">Loading...</div>
                    <div id="spawnLoadingSubtext" style="color: #C8B898; font-size: 14px;"></div>
                </div>
            </div>
        `;

        // Make container relative for loading overlay
        this.container.style.position = 'relative';
        // Event listeners handled via delegation in handleContainerClick()
    }

    renderFriendsList(friends) {
        return friends.map(friend => `
            <div style="
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px;
                background: #333;
                border-radius: 6px;
                margin-bottom: 8px;
            ">
                <span style="color: #fff;">${friend.username}</span>
                <button
                    class="spawnOnFriendBtn"
                    data-friend-id="${friend.id}"
                    data-friend-username="${friend.username}"
                    style="${this.getSmallButtonStyle('#5a8a5e')}"
                >
                    Spawn Near
                </button>
            </div>
        `).join('');
    }

    renderUnavailableFriends() {
        // Get friends who are online but in wrong faction or wrong zone
        const allFriends = this.gameState.friendsList || [];
        // Coerce faction IDs to same type (server may send string or number)
        const myFaction = this.gameState.factionId == null ? null : Number(this.gameState.factionId);
        const getFaction = (f) => f.faction == null ? null : Number(f.faction);

        const unavailable = allFriends.filter(f => {
            if (!f.online || f.status !== 'accepted') return false;
            // Different faction
            if (getFaction(f) !== myFaction) return true;
            return false;
        });

        if (unavailable.length === 0) return '';

        return `
            <div style="margin-top: 16px;">
                <h4 style="margin: 0 0 8px 0; color: #C8B898; font-size: 12px;">
                    Friends Unavailable for Spawn:
                </h4>
                ${unavailable.map(f => {
                    const reason = getFaction(f) !== myFaction
                        ? `Different faction (${this.gameState.getFactionName(f.faction)})`
                        : 'Outside your territory';
                    return `
                        <div style="color: #A89878; font-size: 12px; padding: 4px 0;">
                            ${f.username} - ${reason}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    handleLogout() {
        if (this.onLogout) {
            this.onLogout();
        }
    }

    handleQualityChange(quality) {
        const currentQuality = this.gameState.qualitySetting;
        if (quality === currentQuality) return;

        this.gameState.setQualitySetting(quality);
        // Quality settings require page reload to fully apply
        window._allowNavigation = true;
        window.location.reload();
    }

    handleHomeSpawn() {
        if (!this.gameState.home) {
            console.error('No home set');
            return;
        }

        this.onSpawnSelected('home', {
            x: this.gameState.home.x,
            z: this.gameState.home.z
        });
    }

    handleResumeSpawn() {
        if (!this.gameState.canResume) {
            console.error('Cannot resume - was on water vehicle');
            return;
        }

        this.onSpawnSelected('resume', {
            position: this.gameState.savedPosition,
            inventory: this.gameState.savedInventory,
            slingItem: this.gameState.savedSlingItem
        });
    }

    handleRandomSpawn() {
        this.onSpawnSelected('random', {
            factionId: this.gameState.factionId
        });
    }

    async handleFriendSpawn(friendId, friendUsername) {
        // Show loading state
        this.showLoading(true, 'Connecting to friend...', 'Requesting position');
        this.friendPositionPending = true;

        try {
            // Request friend's position via server
            const result = await this.requestFriendPosition(friendId);

            if (result.error) {
                // Show specific error message based on reason
                const errorMessages = {
                    'not_spawned': `${friendUsername} hasn't spawned yet`,
                    'timeout': `Could not reach ${friendUsername}`,
                    'unavailable': `${friendUsername} is not available`,
                    'dead': `${friendUsername} is dead`,
                    'on_mobile_entity': `${friendUsername} is on a boat`,
                    'on_dock': `${friendUsername} is on a dock`,
                    'climbing': `${friendUsername} is in an outpost`,
                    'in_water': `${friendUsername} is in water`
                };

                // More specific mobile entity message if type provided
                let errorMsg = errorMessages[result.error];
                if (result.error === 'on_mobile_entity' && result.entityType) {
                    const entityNames = { 'boat': 'boat', 'sailboat': 'sailboat', 'ship2': 'ship', 'horse': 'horse', 'cart': 'cart' };
                    errorMsg = `${friendUsername} is on a ${entityNames[result.entityType] || 'vehicle'}`;
                }

                this.showError(errorMsg || `Could not connect to ${friendUsername}`);
                // Delay resetting pending flag to prevent flicker from friends_list_response
                setTimeout(() => {
                    this.friendPositionPending = false;
                }, 1000);
                return;
            }

            // Check if friend is in our faction zone
            const canSpawn = this.checkFriendZone(result.z);
            if (!canSpawn.allowed) {
                this.showError(canSpawn.reason);
                // Delay resetting pending flag to prevent flicker
                setTimeout(() => {
                    this.friendPositionPending = false;
                }, 1000);
                return;
            }

            // Proceed with spawn - screen will hide, so pending flag doesn't matter
            this.onSpawnSelected('friend', {
                friendId,
                friendX: result.x,
                friendZ: result.z
            });

        } catch (error) {
            console.error('Friend spawn error:', error);
            this.showError('Failed to spawn near friend');
            // Delay resetting pending flag to prevent flicker
            setTimeout(() => {
                this.friendPositionPending = false;
            }, 1000);
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * Request friend's position via server
     * @param {string} friendId - Friend's account ID
     * @returns {Promise<{x: number, z: number, error?: string}|null>}
     */
    async requestFriendPosition(friendId) {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.networkManager.off('friend_position_response', handler);
                resolve({ error: 'timeout' });
            }, 5000);  // 5 second timeout

            // Listen for response from server
            const handler = (data) => {
                if (data.friendId === friendId) {
                    clearTimeout(timeout);
                    this.networkManager.off('friend_position_response', handler);
                    if (data.success && data.position) {
                        resolve({ x: data.position.x, z: data.position.z });
                    } else {
                        // Pass through reason AND entityType for specific messages
                        resolve({
                            error: data.reason || 'unavailable',
                            entityType: data.entityType
                        });
                    }
                }
            };

            this.networkManager.on('friend_position_response', handler);

            // Request position via server
            this.networkManager.sendMessage('get_friend_position', {
                friendId: friendId
            });
        });
    }

    checkFriendZone(friendZ) {
        return { allowed: true };
    }

    showLoading(show, message = 'Loading...', subtext = '') {
        const loadingEl = document.getElementById('spawnLoading');
        if (loadingEl) {
            loadingEl.style.display = show ? 'flex' : 'none';
            const textEl = document.getElementById('spawnLoadingText');
            const subtextEl = document.getElementById('spawnLoadingSubtext');
            if (textEl) textEl.textContent = message;
            if (subtextEl) subtextEl.textContent = subtext;
        }
    }

    showError(message) {
        this.showLoading(false);
        ui.showToast(message, 'error');
    }

    getButtonStyle(bgColor) {
        return `
            width: 100%;
            padding: 14px 20px;
            background: ${bgColor};
            border: none;
            border-radius: 8px;
            color: #fff;
            font-size: 16px;
            cursor: pointer;
            transition: all 0.2s;
            text-align: center;
        `.replace(/\s+/g, ' ').trim();
    }

    getSmallButtonStyle(bgColor) {
        return `
            padding: 6px 14px;
            background: ${bgColor};
            border: none;
            border-radius: 4px;
            color: #fff;
            font-size: 13px;
            cursor: pointer;
        `.replace(/\s+/g, ' ').trim();
    }

    getQualityButtonStyle(quality, currentQuality) {
        const isSelected = quality === currentQuality;
        return `
            padding: 8px 16px;
            background: ${isSelected ? '#5a7a9c' : '#3a3a3a'};
            border: 1px solid ${isSelected ? '#7a9abc' : '#555'};
            border-radius: 4px;
            color: ${isSelected ? '#fff' : '#aaa'};
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s;
            min-width: 70px;
        `.replace(/\s+/g, ' ').trim();
    }
}

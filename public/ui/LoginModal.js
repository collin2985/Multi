/**
 * LoginModal.js
 * Login/Registration UI modal
 */

export class LoginModal {
    constructor(gameState, authClient) {
        this.gameState = gameState;
        this.authClient = authClient;
        this.modal = null;
        this.isVisible = false;
        this.currentView = 'main'; // 'main', 'login', 'register', 'faction'

        // Callback for when auth is complete and spawn screen should show
        this.onAuthComplete = null;  // (authType, playerData) => void

        // Selected faction for guests/new accounts
        this.selectedFaction = null;
        this.pendingFactionId = null;

        this.createModal();
        this.attachEventListeners();
    }

    /**
     * Create the modal HTML structure
     */
    createModal() {
        // Create modal container
        this.modal = document.createElement('div');
        this.modal.id = 'login-modal';
        this.modal.className = 'login-modal';
        this.modal.style.display = 'none';

        // Create modal content
        this.modal.innerHTML = `
            <div class="login-modal-overlay"></div>
            <div class="login-modal-content">
                <button class="login-modal-close" id="login-close-btn">×</button>

                <!-- Main View -->
                <div id="login-main-view" class="login-view">
                    <h1>Guns Horses & Ships</h1>

                    <button class="login-btn login-btn-primary" id="play-guest-btn">
                        Play as Guest
                    </button>

                    <div class="login-divider">
                        <span>or</span>
                    </div>

                    <div class="login-auth-buttons">
                        <button class="login-btn login-btn-secondary" id="show-login-btn">
                            Login
                        </button>
                        <button class="login-btn login-btn-secondary" id="show-register-btn">
                            Register
                        </button>
                    </div>
                </div>

                <!-- Login View -->
                <div id="login-login-view" class="login-view" style="display: none;">
                    <h2>Login to Your Account</h2>

                    <form id="login-form" class="login-form">
                        <div class="login-form-group">
                            <label for="login-username">Username</label>
                            <input type="text" id="login-username" name="username"
                                   required minlength="3" maxlength="20"
                                   pattern="[a-zA-Z0-9_]+"
                                   placeholder="Enter your username">
                        </div>

                        <div class="login-form-group">
                            <label for="login-password">Password</label>
                            <input type="password" id="login-password" name="password"
                                   required minlength="8"
                                   placeholder="Enter your password">
                        </div>

                        <div class="login-form-group">
                            <label class="login-checkbox">
                                <input type="checkbox" id="login-remember">
                                <span>Remember me</span>
                            </label>
                        </div>

                        <button type="submit" class="login-btn login-btn-primary" id="login-submit-btn">
                            Login
                        </button>
                    </form>

                    <div class="login-form-footer">
                        <button class="login-link-btn" id="login-back-btn">← Back</button>
                        <span class="login-separator">|</span>
                        <button class="login-link-btn" id="switch-to-register-btn">
                            Need an account? Register
                        </button>
                    </div>

                    <div id="login-error" class="login-error" style="display: none;"></div>
                </div>

                <!-- Register View -->
                <div id="login-register-view" class="login-view" style="display: none;">
                    <h2>Create New Account</h2>

                    <form id="register-form" class="login-form">
                        <div class="login-form-group">
                            <label for="register-username">Username</label>
                            <input type="text" id="register-username" name="username"
                                   required minlength="3" maxlength="20"
                                   pattern="[a-zA-Z0-9_]+"
                                   placeholder="Choose a username (3-20 chars)">
                            <small class="login-input-hint">Letters, numbers, and underscores only</small>
                        </div>

                        <div class="login-form-group">
                            <label for="register-email">Email</label>
                            <input type="email" id="register-email" name="email"
                                   required
                                   placeholder="For announcements and account recovery">
                        </div>

                        <div class="login-form-group">
                            <label for="register-password">Password</label>
                            <input type="password" id="register-password" name="password"
                                   required minlength="8"
                                   placeholder="Choose a password (min 8 chars)">
                        </div>

                        <div class="login-form-group">
                            <label for="register-password-confirm">Confirm Password</label>
                            <input type="password" id="register-password-confirm" name="passwordConfirm"
                                   required minlength="8"
                                   placeholder="Re-enter your password">
                        </div>

                        <button type="submit" class="login-btn login-btn-primary" id="register-submit-btn">
                            Create Account
                        </button>
                    </form>

                    <div class="login-form-footer">
                        <button class="login-link-btn" id="register-back-btn">← Back</button>
                        <span class="login-separator">|</span>
                        <button class="login-link-btn" id="switch-to-login-btn">
                            Have an account? Login
                        </button>
                    </div>

                    <div id="register-error" class="login-error" style="display: none;"></div>
                </div>

                <!-- Success View -->
                <div id="login-success-view" class="login-view" style="display: none;">
                    <div class="login-success-icon">✓</div>
                    <h2>Success!</h2>
                    <p id="login-success-message">Welcome to the game!</p>
                    <button class="login-btn login-btn-primary" id="success-continue-btn">
                        Continue to Game
                    </button>
                </div>

                <!-- Faction Selection View -->
                <div id="login-faction-view" class="login-view" style="display: none;">
                    <h2>Choose Your Faction</h2>
                    <p class="login-subtitle" style="margin-bottom: 20px; color: #C8B898;">
                        This choice is permanent.
                    </p>

                    <div class="faction-options">
                        <button class="login-btn faction-btn" id="faction-neutral-btn" data-faction="null">
                            <span class="faction-name">Neutral</span>
                        </button>
                        <button class="login-btn faction-btn" id="faction-northmen-btn" data-faction="3">
                            <span class="faction-name">Northmen</span>
                        </button>
                        <button class="login-btn faction-btn" id="faction-southguard-btn" data-faction="1">
                            <span class="faction-name">Southguard</span>
                        </button>
                    </div>

                    <div class="login-form-footer" style="margin-top: 20px;">
                        <button class="login-link-btn" id="faction-back-btn">← Back</button>
                    </div>
                </div>

                <!-- Faction Confirmation View -->
                <div id="login-faction-confirm-view" class="login-view" style="display: none;">
                    <h2>Confirm Faction</h2>
                    <p id="faction-confirm-message" class="login-subtitle" style="margin-bottom: 20px; color: #ccc; font-size: 16px;">
                    </p>

                    <div style="display: flex; gap: 12px; justify-content: center;">
                        <button class="login-btn" id="faction-confirm-yes" style="flex: 1; max-width: 150px; background: #4a7c4e;">
                            Confirm
                        </button>
                        <button class="login-btn" id="faction-confirm-no" style="flex: 1; max-width: 150px; background: #666;">
                            Cancel
                        </button>
                    </div>
                </div>

                <!-- Email Prompt View (for existing users without email) -->
                <div id="login-email-view" class="login-view" style="display: none;">
                    <h2>Add Your Email</h2>
                    <p class="login-subtitle" style="margin-bottom: 20px; color: #C8B898;">
                        Used for announcements and account recovery only.
                    </p>

                    <form id="email-form" class="login-form">
                        <div class="login-form-group">
                            <label for="update-email">Email</label>
                            <input type="email" id="update-email" name="email"
                                   required placeholder="Enter your email">
                        </div>

                        <button type="submit" class="login-btn login-btn-primary" id="email-submit-btn">
                            Save Email
                        </button>
                    </form>

                    <div id="email-error" class="login-error" style="display: none;"></div>
                </div>

                <!-- Loading Overlay -->
                <div id="login-loading" class="login-loading" style="display: none;">
                    <div class="login-spinner"></div>
                    <div id="login-loading-text">Please wait...</div>
                </div>
            </div>
        `;

        // Add to document
        document.body.appendChild(this.modal);
    }

    /**
     * Attach event listeners to modal elements
     */
    attachEventListeners() {
        // Prevent keyboard events in modal from reaching the game
        this.modal.addEventListener('keydown', (e) => {
            e.stopPropagation();
        });
        this.modal.addEventListener('keyup', (e) => {
            e.stopPropagation();
        });

        // Prevent mouse events in modal from reaching the game
        this.modal.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
        this.modal.addEventListener('mouseup', (e) => {
            e.stopPropagation();
        });
        this.modal.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Close button
        document.getElementById('login-close-btn').addEventListener('click', () => {
            // Email view cannot be closed — must submit email
            if (this.currentView === 'email') return;
            // If user is already in-game, just close the modal
            if (this.gameState.hasCompletedInitialAuth) {
                this.hide();
                return;
            }
            // Pre-game: on sub-views, X goes back to main view
            if (this.currentView !== 'main') {
                this.showView('main');
                return;
            }
            // Pre-game main view: don't allow closing (must make auth choice)
        });

        // Stop clicks on modal content from propagating to overlay
        document.querySelector('.login-modal-content').addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Overlay click to close (optional)
        document.querySelector('.login-modal-overlay').addEventListener('click', () => {
            // Email view cannot be closed — must submit email
            if (this.currentView === 'email') return;
            // Only allow closing via overlay if user has completed initial auth choice
            if (this.gameState.hasCompletedInitialAuth) {
                this.hide();
            }
        });

        // Main view buttons
        document.getElementById('play-guest-btn').addEventListener('click', () => {
            this.playAsGuest();
        });

        document.getElementById('show-login-btn').addEventListener('click', () => {
            this.showView('login');
        });

        document.getElementById('show-register-btn').addEventListener('click', () => {
            this.showView('register');
        });

        // Login view
        document.getElementById('login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        document.getElementById('login-back-btn').addEventListener('click', () => {
            this.showView('main');
        });

        document.getElementById('switch-to-register-btn').addEventListener('click', () => {
            this.showView('register');
        });

        // Register view
        document.getElementById('register-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleRegister();
        });

        document.getElementById('register-back-btn').addEventListener('click', () => {
            this.showView('main');
        });

        document.getElementById('switch-to-login-btn').addEventListener('click', () => {
            this.showView('login');
        });

        // Success view
        document.getElementById('success-continue-btn').addEventListener('click', () => {
            this.hide();
        });

        // Faction selection buttons
        document.querySelectorAll('.faction-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const factionStr = e.currentTarget.dataset.faction;
                const factionId = factionStr === 'null' ? null : parseInt(factionStr);
                this.handleFactionSelected(factionId);
            });
        });

        document.getElementById('faction-back-btn').addEventListener('click', () => {
            this.showView('main');
        });

        // Faction confirmation buttons
        document.getElementById('faction-confirm-yes').addEventListener('click', () => {
            this.confirmFactionSelection();
        });

        document.getElementById('faction-confirm-no').addEventListener('click', () => {
            this.cancelFactionSelection();
        });

        // Email prompt form
        document.getElementById('email-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleEmailSubmit();
        });

        // Password confirmation validation
        const passwordConfirm = document.getElementById('register-password-confirm');
        const password = document.getElementById('register-password');

        passwordConfirm.addEventListener('input', () => {
            if (passwordConfirm.value !== password.value) {
                passwordConfirm.setCustomValidity('Passwords do not match');
            } else {
                passwordConfirm.setCustomValidity('');
            }
        });
    }

    /**
     * Show the modal
     */
    show() {
        this.modal.style.display = 'block';
        this.isVisible = true;
        this.showView('main');

        // Prevent game input while modal is open
        if (window.game) {
            window.game.inputEnabled = false;
        }
    }

    /**
     * Hide the modal
     */
    hide() {
        this.modal.style.display = 'none';
        this.isVisible = false;

        // Re-enable game input
        if (window.game) {
            window.game.inputEnabled = true;
        }
    }

    /**
     * Show a specific view
     */
    showView(view) {
        // Hide all views
        document.querySelectorAll('.login-view').forEach(v => {
            v.style.display = 'none';
        });

        // Show requested view
        const viewElement = document.getElementById(`login-${view}-view`);
        if (viewElement) {
            viewElement.style.display = 'block';
        }

        // Clear errors
        this.hideError();

        this.currentView = view;

        // Notify tasks panel when register form is shown
        if (view === 'register' && window.tasksPanel) {
            window.tasksPanel.onRegisterFormShown();
        }
    }

    /**
     * Play as guest (no authentication)
     * Guests are always neutral - no faction selection
     */
    playAsGuest() {

        // Guests are always neutral
        this.selectedFaction = null;
        this.gameState.factionId = null;
        this.gameState.hasCompletedInitialAuth = true;

        // Trigger auth complete callback
        if (this.onAuthComplete) {
            this.onAuthComplete('guest', {
                factionId: null,
                isGuest: true
            });
        }

        this.hide();
    }

    /**
     * Handle faction selection (for guests and new accounts)
     * Shows confirmation view before finalizing
     * @param {number|null} factionId
     */
    handleFactionSelected(factionId) {
        const factionNames = { null: 'Neutral', 1: 'Southguard', 3: 'Northmen' };
        const factionName = factionNames[factionId];

        // Store pending faction for confirmation
        this.pendingFactionId = factionId;

        // Set confirmation message
        let message;
        const isGuestUpgrade = this.pendingRegistration?.wasGuestUpgrade;
        const pickingFaction = factionId !== null;

        if (isGuestUpgrade && pickingFaction) {
            message = `Join ${factionName}? This choice is permanent.`;
        } else if (pickingFaction) {
            message = `Join ${factionName}?`;
        } else {
            message = 'Play as Neutral?';
        }

        document.getElementById('faction-confirm-message').textContent = message;

        // Show confirmation view
        this.showView('faction-confirm');
    }

    /**
     * Handle faction confirmation (user clicked Confirm)
     */
    confirmFactionSelection() {
        const factionId = this.pendingFactionId;
        const factionNames = { null: 'Neutral', 1: 'Southguard', 3: 'Northmen' };
        const factionName = factionNames[factionId];

        const isGuestUpgrade = this.pendingRegistration?.wasGuestUpgrade;
        const pickingFaction = factionId !== null;

        this.selectedFaction = factionId;
        this.gameState.factionId = factionId;
        this.gameState.hasCompletedInitialAuth = true;

        // Update local player's faction colors (shirt and name tag)
        if (window.game?.updateLocalPlayerFactionColors) {
            window.game.updateLocalPlayerFactionColors(factionId);
        }

        // Check if this is after registration
        if (this.pendingRegistration) {
            // Send faction to server via set_faction (registration flow)
            if (this.authClient && this.authClient.networkManager) {
                this.authClient.networkManager.sendMessage('set_faction', {
                    factionId: factionId
                });
            }

            // Trigger auth complete callback
            if (this.onAuthComplete) {
                this.onAuthComplete('register', {
                    playerId: this.pendingRegistration.playerId,
                    username: this.pendingRegistration.username,
                    factionId: factionId,
                    isGuest: false
                });
            }

            this.pendingRegistration = null;
        } else {
            // Guest - trigger auth complete callback
            if (this.onAuthComplete) {
                this.onAuthComplete('guest', {
                    factionId: factionId,
                    isGuest: true
                });
            }
        }

        this.pendingFactionId = null;
        this.hide();
    }

    /**
     * Handle faction confirmation cancelled (user clicked Cancel)
     */
    cancelFactionSelection() {
        this.pendingFactionId = null;
        this.showView('faction');
    }

    /**
     * Handle email form submission (for existing users without email)
     */
    async handleEmailSubmit() {
        const email = document.getElementById('update-email').value;
        if (!email) return;

        this.showLoading('Saving email...');

        try {
            await this.authClient.sendUpdateEmail(email);

            this.hideLoading();
            this.completeEmailLogin();
        } catch (error) {
            this.hideLoading();
            this.showError('email', error.message || 'Failed to save email');
        }
    }

    /**
     * Complete the login flow after email is provided
     */
    completeEmailLogin() {
        if (!this.pendingEmailLogin) return;

        const { authType, data } = this.pendingEmailLogin;
        this.pendingEmailLogin = null;

        // Request friends list for auto-login (normal login already does this)
        if (authType === 'auto-login' && window.game?.networkManager) {
            window.game.networkManager.sendMessage('get_friends_list', {});
        }

        // onAuthComplete handles spawn screen, inventory sync, and save exit overlay
        if (this.onAuthComplete) {
            this.onAuthComplete(authType === 'auto-login' ? 'login' : authType, data);
        }

        this.hide();
    }

    /**
     * Handle login form submission
     */
    async handleLogin() {
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        const remember = document.getElementById('login-remember').checked;

        this.showLoading('Logging in...');

        try {
            const result = await this.authClient.login(username, password);

            if (result.success) {
                // Store token if remember me is checked
                if (remember) {
                    this.authClient.storeSessionToken(result.token);
                }

                // Update game state
                this.gameState.setAuthenticated(result.playerId, username);

                // Update player's nametag with new username
                if (window.game?.nameTagManager) {
                    window.game.nameTagManager.updateEntityName('main_player', username);
                }

                // Broadcast auth info to peers immediately (fixes ship piloting sync issue)
                if (window.game?.networkManager) {
                    window.game.networkManager.broadcastAuthInfo();
                }

                // Initialize Friends/Faction panels if they weren't created during game init
                if (window.game && window.game.initializeFriendsFactionPanels) {
                    window.game.initializeFriendsFactionPanels();
                }

                // Set spawn data from server response
                if (result.playerData) {
                    this.gameState.setSpawnData({
                        factionId: result.playerData.factionId,
                        home: result.playerData.homeStructureId ? {
                            structureId: result.playerData.homeStructureId,
                            x: result.playerData.homePositionX,
                            z: result.playerData.homePositionZ
                        } : null
                    });
                    // Store full playerData for TasksPanel to check tasksPanelClosed
                    this.gameState.playerData = result.playerData;

                    // Set saved session data for Resume Last Session feature
                    if (result.playerData.hasSavedSession !== undefined) {
                        this.gameState.setSavedSessionData({
                            hasSavedSession: result.playerData.hasSavedSession,
                            canResume: result.playerData.canResume,
                            wasOnWaterVehicle: result.playerData.wasOnWaterVehicle,
                            savedPosition: result.playerData.savedPosition,
                            savedInventory: result.playerData.savedInventory,
                            savedSlingItem: result.playerData.savedSlingItem
                        });
                    }

                    // Update local player's faction colors (shirt and name tag)
                    if (window.game?.updateLocalPlayerFactionColors) {
                        window.game.updateLocalPlayerFactionColors(result.playerData.factionId);
                    }
                }

                // Set influence from login response
                if (result.influence !== undefined) {
                    this.gameState.influence = result.influence;
                }

                this.hideLoading();

                // Check if user needs to provide email
                if (result.hasEmail === false) {
                    this.pendingEmailLogin = {
                        authType: 'login',
                        data: {
                            playerId: result.playerId,
                            username: username,
                            playerData: result.playerData
                        }
                    };
                    this.showView('email');
                    return;
                }

                // Trigger auth complete callback (shows spawn screen)
                if (this.onAuthComplete) {
                    this.onAuthComplete('login', {
                        playerId: result.playerId,
                        username: username,
                        playerData: result.playerData
                    });
                }

                this.hide();
            } else {
                this.hideLoading();
                this.showError('login', result.message || 'Login failed');
            }
        } catch (error) {
            this.hideLoading();
            this.showError('login', error.message || 'Login failed');
        }
    }

    /**
     * Handle register form submission
     */
    async handleRegister() {
        const username = document.getElementById('register-username').value;
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        const passwordConfirm = document.getElementById('register-password-confirm').value;

        // Validate passwords match
        if (password !== passwordConfirm) {
            this.showError('register', 'Passwords do not match');
            return;
        }

        this.showLoading('Creating account...');

        try {
            const result = await this.authClient.register(username, password, email);

            if (result.success) {
                // Auto-login after registration
                this.authClient.storeSessionToken(result.token);

                // Check if player was already playing as guest BEFORE setAuthenticated changes the flag
                const wasAlreadyPlaying = this.gameState.hasCompletedInitialAuth;

                // Update game state
                this.gameState.setAuthenticated(result.playerId, username);

                // Set influence from registration response
                if (result.influence !== undefined) {
                    this.gameState.influence = result.influence;
                }

                // Update player's nametag with new username
                if (window.game?.nameTagManager) {
                    window.game.nameTagManager.updateEntityName('main_player', username);
                }

                // Broadcast auth info to peers immediately (fixes ship piloting sync issue)
                if (window.game?.networkManager) {
                    window.game.networkManager.broadcastAuthInfo();
                }

                // Initialize Friends/Faction panels if they weren't created during game init
                if (window.game && window.game.initializeFriendsFactionPanels) {
                    window.game.initializeFriendsFactionPanels();
                }

                this.hideLoading();

                // Guest upgrades: skip faction selection, keep neutral, continue playing
                if (wasAlreadyPlaying) {
                    // Send current faction (neutral) to server to associate with new account
                    if (this.authClient && this.authClient.networkManager) {
                        this.authClient.networkManager.sendMessage('set_faction', {
                            factionId: this.gameState.factionId  // Keep current (neutral)
                        });
                    }

                    // Notify tasks panel of account creation
                    if (window.tasksPanel) {
                        window.tasksPanel.onAccountCreated();
                    }

                    // Create inventory sync system for upgraded guest
                    // This enables "Resume Last Session" for guests who create accounts mid-game
                    if (window.game && !window.game.inventorySyncSystem) {
                        const { InventorySyncSystem } = await import('../systems/InventorySyncSystem.js');
                        window.game.inventorySyncSystem = new InventorySyncSystem(
                            this.gameState,
                            window.game.networkManager
                        );
                        window.game.inventorySyncSystem.start();
                    }
                    if (window.game && !window.game.saveExitOverlay) {
                        const { SaveExitOverlay } = await import('./SaveExitOverlay.js');
                        window.game.saveExitOverlay = new SaveExitOverlay(
                            this.gameState, window.game.networkManager, window.game.inventorySyncSystem
                        );
                    }

                    // Just hide the modal and continue playing
                    this.hide();
                    return;
                }

                // New registrations (not from guest) show faction selection
                this.pendingRegistration = {
                    playerId: result.playerId,
                    username: username,
                    wasGuestUpgrade: false
                };
                this.showView('faction');
            } else {
                this.hideLoading();
                this.showError('register', result.message || 'Registration failed');
            }
        } catch (error) {
            this.hideLoading();
            this.showError('register', error.message || 'Registration failed');
        }
    }

    /**
     * Get current game state for saving
     */
    getCurrentGameState() {
        // This would need to be implemented based on your game structure
        // For now, return basic state
        return {
            inventory: [], // TODO: Get from inventory manager
            position: window.game?.playerObject?.position || { x: 0, y: 0, z: 0 },
            health: 100, // TODO: Get from player health system
            hunger: 100, // TODO: Get from player hunger system
            stats: {}
        };
    }

    /**
     * Show loading overlay
     */
    showLoading(text = 'Loading...') {
        document.getElementById('login-loading').style.display = 'flex';
        document.getElementById('login-loading-text').textContent = text;
    }

    /**
     * Hide loading overlay
     */
    hideLoading() {
        document.getElementById('login-loading').style.display = 'none';
    }

    /**
     * Show error message
     */
    showError(view, message) {
        const errorElement = document.getElementById(`${view}-error`);
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
        }
    }

    /**
     * Hide error messages
     */
    hideError() {
        document.querySelectorAll('.login-error').forEach(e => {
            e.style.display = 'none';
        });
    }

    /**
     * Show success view
     */
    showSuccess(message) {
        document.getElementById('login-success-message').textContent = message;
        this.showView('success');

        // Auto-hide after 2 seconds
        setTimeout(() => {
            this.hide();
        }, 2000);
    }

    /**
     * Check for auto-login on load
     */
    async attemptAutoLogin() {
        if (this.authClient.hasStoredSession()) {
            this.showLoading('Checking session...');

            try {
                const result = await this.authClient.attemptAutoLogin();

                if (result.valid) {
                    // Update game state
                    this.gameState.setAuthenticated(result.playerId, result.username);

                    // Broadcast auth info to peers immediately (fixes ship piloting sync issue)
                    if (window.game?.networkManager) {
                        window.game.networkManager.broadcastAuthInfo();
                    }

                    // Initialize Friends/Faction panels if they weren't created during game init
                    if (window.game && window.game.initializeFriendsFactionPanels) {
                        window.game.initializeFriendsFactionPanels();
                    }

                    // Set spawn data from server response (same as login flow)
                    if (result.playerData) {
                        this.gameState.setSpawnData({
                            factionId: result.playerData.factionId,
                            home: result.playerData.homeStructureId ? {
                                structureId: result.playerData.homeStructureId,
                                x: result.playerData.homePositionX,
                                z: result.playerData.homePositionZ
                            } : null
                        });
                        // Store full playerData for TasksPanel to check tasksPanelClosed
                        this.gameState.playerData = result.playerData;

                        // Set saved session data for Resume Last Session feature
                        if (result.playerData.hasSavedSession !== undefined) {
                            this.gameState.setSavedSessionData({
                                hasSavedSession: result.playerData.hasSavedSession,
                                canResume: result.playerData.canResume,
                                wasOnWaterVehicle: result.playerData.wasOnWaterVehicle,
                                savedPosition: result.playerData.savedPosition,
                                savedInventory: result.playerData.savedInventory,
                                savedSlingItem: result.playerData.savedSlingItem
                            });
                        }

                        // Update local player's faction colors (shirt and name tag)
                        if (window.game?.updateLocalPlayerFactionColors) {
                            window.game.updateLocalPlayerFactionColors(result.playerData.factionId);
                        }
                    }

                    // Set influence from session validation
                    if (result.influence !== undefined) {
                        this.gameState.influence = result.influence;
                    }

                    this.hideLoading();

                    // Check if user needs to provide email
                    if (result.hasEmail === false) {
                        this.pendingEmailLogin = {
                            authType: 'auto-login',
                            data: {
                                playerId: result.playerId,
                                username: result.username,
                                playerData: result.playerData
                            }
                        };
                        this.modal.style.display = 'block';
                        this.isVisible = true;
                        this.showView('email');
                        return 'needs_email';
                    }

                    return true;
                }
            } catch (error) {
                console.error('Auto-login failed:', error);
            }

            this.hideLoading();
        }

        return false;
    }
}
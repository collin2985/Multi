/**
 * SettingsPanel.js
 * In-game settings UI with volume control and access to Friends/Faction panels
 */

export class SettingsPanel {
    constructor(gameState, audioManager, friendsPanel, factionPanel) {
        this.gameState = gameState;
        this.audioManager = audioManager;
        this.friendsPanel = friendsPanel;
        this.factionPanel = factionPanel;

        this.panel = null;
        this.isVisible = false;

        // Load saved volume or default to 100%
        this.volume = this.loadVolume();

        // Load saved debug info setting or default to false
        this.debugInfoVisible = this.loadDebugInfo();

        // Load saved proximate status setting or default to false
        this.proximateStatusVisible = this.loadProximateStatus();

        this.createElements();
        this.applyVolume();
        this.applyDebugInfo();
        this.applyProximateStatus();
    }

    loadVolume() {
        const saved = localStorage.getItem('gameVolume');
        return saved !== null ? parseFloat(saved) : 1.0;
    }

    saveVolume() {
        localStorage.setItem('gameVolume', this.volume.toString());
    }

    applyVolume() {
        if (this.audioManager) {
            this.audioManager.setMasterVolume(this.volume);
        }
    }

    loadDebugInfo() {
        const saved = localStorage.getItem('debugInfoVisible');
        return saved === 'true';
    }

    saveDebugInfo() {
        localStorage.setItem('debugInfoVisible', this.debugInfoVisible.toString());
    }

    applyDebugInfo() {
        const container = document.getElementById('debugInfoContainer');
        if (container) {
            container.classList.toggle('visible', this.debugInfoVisible);
        }
    }

    loadProximateStatus() {
        const saved = localStorage.getItem('proximateStatusVisible');
        return saved === 'true'; // Default to false
    }

    saveProximateStatus() {
        localStorage.setItem('proximateStatusVisible', this.proximateStatusVisible.toString());
    }

    applyProximateStatus() {
        const nearestObject = document.getElementById('nearestObject');
        const structurePanel = document.getElementById('structurePanel');

        // Store setting in a way ui.js can access it
        window.proximateStatusVisible = this.proximateStatusVisible;

        // Note: Actual visibility is controlled in ui.js based on this setting
        // If setting is off, those elements should stay hidden
        if (!this.proximateStatusVisible) {
            if (nearestObject) nearestObject.style.display = 'none';
            if (structurePanel) structurePanel.style.display = 'none';
        }
    }

    /**
     * Update panel references (called when guest upgrades to account)
     */
    updatePanelRefs(friendsPanel, factionPanel) {
        this.friendsPanel = friendsPanel;
        this.factionPanel = factionPanel;
    }

    createElements() {
        this.panel = document.createElement('div');
        this.panel.id = 'settingsPanel';
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
            width: 280px;
            z-index: 9000;
            font-family: 'Segoe UI', Arial, sans-serif;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        `;

        document.body.appendChild(this.panel);
    }

    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    show() {
        // Cancel auto-run when opening settings
        window.game?.inputManager?.cancelAutoRun();
        this.render();
        this.panel.style.display = 'block';
        this.isVisible = true;
    }

    hide() {
        this.panel.style.display = 'none';
        this.isVisible = false;
    }

    render() {
        const isLoggedIn = this.gameState && !this.gameState.isGuest;
        const volumePercent = Math.round(this.volume * 100);
        const vs = window.game?.gameState?.vehicleState;
        const onMobileEntity = vs && (typeof vs.isActive === 'function' && vs.isActive() && !vs.isDisembarking() || vs.towedEntity?.isAttached);

        this.panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h2 style="margin: 0; color: #ddd; font-size: 18px;">Settings</h2>
                <button id="settingsCloseBtn" style="
                    background: #555;
                    border: none;
                    color: #fff;
                    width: 28px;
                    height: 28px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 16px;
                ">X</button>
            </div>

            <div style="margin-bottom: 20px;">
                <label style="color: #D4C4A8; font-size: 14px; display: block; margin-bottom: 8px;">
                    Volume: ${volumePercent}%
                </label>
                <input type="range" id="volumeSlider" min="0" max="100" value="${volumePercent}" style="
                    width: 100%;
                    height: 8px;
                    border-radius: 4px;
                    background: #444;
                    outline: none;
                    cursor: pointer;
                ">
            </div>

            <div style="margin-bottom: 20px;">
                <label style="color: #D4C4A8; font-size: 14px; display: flex; align-items: center; cursor: pointer;">
                    <input type="checkbox" id="debugInfoToggle" ${this.debugInfoVisible ? 'checked' : ''} style="
                        width: 18px;
                        height: 18px;
                        margin-right: 10px;
                        cursor: pointer;
                    ">
                    Show Debug Info (FPS, Position)
                </label>
            </div>

            <div style="margin-bottom: 20px;">
                <label style="color: #D4C4A8; font-size: 14px; display: flex; align-items: center; cursor: pointer;">
                    <input type="checkbox" id="proximateStatusToggle" ${this.proximateStatusVisible ? 'checked' : ''} style="
                        width: 18px;
                        height: 18px;
                        margin-right: 10px;
                        cursor: pointer;
                    ">
                    Show Proximate Object Status
                </label>
            </div>

            <div style="margin-bottom: 20px;">
                <button id="settingsReportBugBtn" style="
                    width: 100%;
                    padding: 10px;
                    background: #5865F2;
                    border: none;
                    border-radius: 6px;
                    color: white;
                    font-size: 14px;
                    cursor: pointer;
                ">Report Bug/Issue on Discord</button>
            </div>

            ${isLoggedIn ? `
                <div style="border-top: 1px solid #444; padding-top: 15px;">
                    <button id="settingsFriendsBtn" style="
                        width: 100%;
                        padding: 10px;
                        margin-bottom: 8px;
                        background: #5C8A6B;
                        border: none;
                        border-radius: 6px;
                        color: white;
                        font-size: 14px;
                        cursor: pointer;
                    ">Friends</button>
                    <button id="settingsFactionBtn" style="
                        width: 100%;
                        padding: 10px;
                        margin-bottom: 8px;
                        background: #7A5C8A;
                        border: none;
                        border-radius: 6px;
                        color: white;
                        font-size: 14px;
                        cursor: pointer;
                    ">Faction</button>
                    <button id="settingsSaveQuitBtn"
                        ${onMobileEntity ? 'disabled title="Dismount first to save and exit"' : ''}
                        style="
                        width: 100%;
                        padding: 10px;
                        background: #8a6a4a;
                        border: none;
                        border-radius: 6px;
                        color: white;
                        font-size: 14px;
                        cursor: pointer;
                        ${onMobileEntity ? 'opacity: 0.5; cursor: not-allowed;' : ''}
                    ">Save and Exit</button>
                </div>
            ` : ''}
        `;

        // Setup event listeners
        const closeBtn = document.getElementById('settingsCloseBtn');
        if (closeBtn) {
            closeBtn.onclick = () => this.hide();
        }

        const volumeSlider = document.getElementById('volumeSlider');
        if (volumeSlider) {
            volumeSlider.oninput = (e) => {
                this.volume = parseInt(e.target.value) / 100;
                this.applyVolume();
                this.saveVolume();
                // Update label
                const label = this.panel.querySelector('label');
                if (label) {
                    label.textContent = `Volume: ${e.target.value}%`;
                }
            };
        }

        const debugToggle = document.getElementById('debugInfoToggle');
        if (debugToggle) {
            debugToggle.onchange = (e) => {
                this.debugInfoVisible = e.target.checked;
                this.applyDebugInfo();
                this.saveDebugInfo();
            };
        }

        const proximateToggle = document.getElementById('proximateStatusToggle');
        if (proximateToggle) {
            proximateToggle.onchange = (e) => {
                this.proximateStatusVisible = e.target.checked;
                this.applyProximateStatus();
                this.saveProximateStatus();
            };
        }

        const reportBugBtn = document.getElementById('settingsReportBugBtn');
        if (reportBugBtn) {
            reportBugBtn.onclick = () => {
                window.open('https://discord.gg/duRJ3GzvwF', '_blank');
            };
        }

        const friendsBtn = document.getElementById('settingsFriendsBtn');
        if (friendsBtn && this.friendsPanel) {
            friendsBtn.onclick = () => {
                this.hide();
                this.friendsPanel.toggle();
            };
        }

        const factionBtn = document.getElementById('settingsFactionBtn');
        if (factionBtn && this.factionPanel) {
            factionBtn.onclick = () => {
                this.hide();
                this.factionPanel.toggle();
            };
        }

        const saveQuitBtn = document.getElementById('settingsSaveQuitBtn');
        if (saveQuitBtn) {
            saveQuitBtn.onclick = () => {
                this.handleSaveAndQuit();
            };
        }
    }

    handleSaveAndQuit() {
        const overlay = window.game?.saveExitOverlay;
        if (!overlay) {
            if (window.ui) window.ui.showToast('Save system not available', 'error');
            return;
        }
        this.hide();
        const started = overlay.start();
        if (!started) {
            if (window.ui) window.ui.showToast('Cannot save right now', 'error');
        }
    }
}

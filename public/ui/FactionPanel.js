/**
 * FactionPanel.js
 * In-game faction display and change UI
 * Shows current faction and allows changing with daily cooldown
 */

import { CONFIG } from '../config.js';
import { ui } from '../ui.js';

export class FactionPanel {
    constructor(gameState, networkManager) {
        this.gameState = gameState;
        this.networkManager = networkManager;

        this.panel = null;
        this.isVisible = false;

        this.createElements();
        this.setupMessageHandlers();
    }

    createElements() {
        this.panel = document.createElement('div');
        this.panel.id = 'factionPanel';
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
            width: 320px;
            z-index: 9000;
            font-family: 'Segoe UI', Arial, sans-serif;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        `;

        document.body.appendChild(this.panel);
    }

    setupMessageHandlers() {
        if (this.networkManager) {
            this.networkManager.on('change_faction_response', (data) => {
                if (data.success) {
                    this.gameState.setFaction(data.factionId);

                    // Update local player's faction colors (shirt and name tag)
                    if (window.game?.updateLocalPlayerFactionColors) {
                        window.game.updateLocalPlayerFactionColors(data.factionId);
                    }

                    if (data.preservedOwnership) {
                        // In territory - just update faction, no respawn
                        this.hide();
                        if (window.game?.ui?.showNotification) {
                            const factionName = data.factionId === null ? 'Neutral' :
                                (data.factionId === 1 ? 'Southguard' : 'Northmen');
                            window.game.ui.showNotification(`You joined ${factionName}!`);
                        }
                    } else {
                        // Not in territory - clear home and respawn
                        this.gameState.home = null;
                        this.hide();
                        if (window.game?.deathManager && window.game?.playerObject) {
                            window.game.deathManager.killEntity(
                                window.game.playerObject,
                                false,
                                false,
                                'Changed faction'
                            );
                        }
                    }
                } else {
                    this.showNotification(data.message || 'Failed to change faction');
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
        this.render();
        this.panel.style.display = 'block';
        this.isVisible = true;
    }

    hide() {
        this.panel.style.display = 'none';
        this.isVisible = false;
    }

    render() {
        const currentFaction = this.gameState.factionId;
        const factionName = this.gameState.getFactionName(currentFaction);
        const canChange = this.gameState.canChangeFaction;
        const hasHome = this.gameState.home !== null;

        const factionColors = {
            null: '#888',
            1: '#8b4513',  // Southguard - brown
            3: '#4a6a8c'   // Northmen - blue
        };

        const factionColor = factionColors[currentFaction] || '#888';

        this.panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h2 style="margin: 0; color: #fff; font-size: 20px;">Faction</h2>
                <button id="factionPanelClose" style="
                    background: transparent;
                    border: none;
                    color: #C8B898;
                    font-size: 24px;
                    cursor: pointer;
                    padding: 0;
                    line-height: 1;
                ">×</button>
            </div>

            <!-- Current Faction -->
            <div style="
                text-align: center;
                padding: 20px;
                background: ${factionColor}33;
                border: 2px solid ${factionColor};
                border-radius: 8px;
                margin-bottom: 20px;
            ">
                <div style="font-size: 24px; color: #fff; font-weight: bold;">
                    ${factionName}
                </div>
                ${currentFaction !== null ? `
                    <div style="color: #D4C4A8; font-size: 13px; margin-top: 8px;">
                        Territory: Z ${CONFIG.FACTION_ZONES[currentFaction].minZ} to ${CONFIG.FACTION_ZONES[currentFaction].maxZ}
                    </div>
                ` : `
                    <div style="color: #D4C4A8; font-size: 13px; margin-top: 8px;">
                        No territory - spawn anywhere
                    </div>
                `}
            </div>

            <!-- Change Faction Section -->
            ${this.gameState.isGuest ? `
                <div style="text-align: center; color: #C8B898; font-size: 13px; margin-bottom: 16px;">
                    Create an account to change factions
                </div>
            ` : `
                <div style="margin-bottom: 16px;">
                    ${canChange ? `
                        ${hasHome ? `
                            <div style="
                                background: #4a3a2a;
                                border: 1px solid #f90;
                                border-radius: 6px;
                                padding: 10px;
                                margin-bottom: 12px;
                            ">
                                <span style="color: #f90;">Warning:</span>
                                <span style="color: #ddd;">
                                    Changing faction will clear your home spawn point!
                                </span>
                            </div>
                        ` : ''}
                        <button id="showFactionOptionsBtn" style="
                            width: 100%;
                            padding: 12px;
                            background: #4a6a8c;
                            border: none;
                            border-radius: 6px;
                            color: #fff;
                            cursor: pointer;
                            font-size: 14px;
                        ">Change Faction</button>
                    ` : `
                        <div style="text-align: center; color: #C8B898; font-size: 13px;">
                            You can change factions tomorrow
                        </div>
                    `}
                </div>
            `}

            <!-- Faction Options (hidden initially) -->
            <div id="factionOptions" style="display: none;">
                ${this.renderFactionOptions(currentFaction)}
            </div>

            <!-- Faction Info -->
            <div style="border-top: 1px solid #444; padding-top: 16px; margin-top: 8px;">
                <h3 style="margin: 0 0 12px 0; color: #C8B898; font-size: 12px; text-transform: uppercase;">
                    About Factions
                </h3>
                <div style="font-size: 12px; color: #C8B898; line-height: 1.5;">
                    <p style="margin: 0 0 8px 0;">
                        Factions determine your spawn zone and where you can spawn near friends.
                    </p>
                    <p style="margin: 0;">
                        You can only spawn near friends who are in your faction's territory.
                    </p>
                </div>
            </div>
        `;

        this.attachEventListeners();
    }

    renderFactionOptions(currentFaction) {
        const factions = [
            { id: null, name: 'Neutral', desc: 'No territory - spawn anywhere' },
            { id: 1, name: 'Southguard', desc: 'Southern territory (Z: -50,000 to 0)' },
            { id: 3, name: 'Northmen', desc: 'Northern territory (Z: 0 to 50,000)' }
        ];

        return factions.map(f => `
            <button
                class="factionOptionBtn"
                data-faction-id="${f.id}"
                ${f.id === currentFaction ? 'disabled' : ''}
                style="
                    width: 100%;
                    padding: 12px;
                    margin-bottom: 8px;
                    background: ${f.id === currentFaction ? '#444' : '#333'};
                    border: 1px solid ${f.id === currentFaction ? '#666' : '#444'};
                    border-radius: 6px;
                    color: ${f.id === currentFaction ? '#666' : '#fff'};
                    cursor: ${f.id === currentFaction ? 'default' : 'pointer'};
                    text-align: left;
                "
            >
                <div style="font-size: 14px; font-weight: bold;">${f.name}</div>
                <div style="font-size: 12px; opacity: 0.7;">${f.desc}</div>
            </button>
        `).join('');
    }

    attachEventListeners() {
        // Close button
        document.getElementById('factionPanelClose')?.addEventListener('click', () => {
            this.hide();
        });

        // Show faction options
        document.getElementById('showFactionOptionsBtn')?.addEventListener('click', () => {
            const optionsEl = document.getElementById('factionOptions');
            if (optionsEl) {
                optionsEl.style.display = optionsEl.style.display === 'none' ? 'block' : 'none';
            }
        });

        // Faction option buttons
        document.querySelectorAll('.factionOptionBtn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (btn.disabled) return;

                const factionIdStr = e.currentTarget.dataset.factionId;
                const factionId = factionIdStr === 'null' ? null : parseInt(factionIdStr);
                this.handleChangeFaction(factionId);
            });
        });
    }

    async handleChangeFaction(newFactionId) {
        const factionName = newFactionId === null ? 'Neutral' : CONFIG.FACTION_ZONES[newFactionId]?.name;

        // Check if player is in target faction's territory
        const playerZ = window.game?.playerObject?.position?.z ?? 0;
        const inTerritory = (newFactionId === null) ||
                            (newFactionId === 1 && playerZ < 0) ||
                            (newFactionId === 3 && playerZ >= 0);

        // Show appropriate message
        const message = inTerritory
            ? `Join ${factionName}?\n\nYou're in their territory, so you won't need to respawn.\n\nYou can only change factions once per day.`
            : `Change to ${factionName}?\n\nWARNING: This will:\n- Kill you and respawn in ${factionName} territory\n- Remove ownership of ALL your tents and houses\n\nYou can only change factions once per day.`;

        const confirmed = await ui.showConfirmDialog(message);

        if (confirmed) {
            this.networkManager.sendMessage('change_faction', {
                factionId: newFactionId,
                preserveOwnership: inTerritory
            });
        }
    }

    showNotification(message) {
        console.log(`[Faction] ${message}`);
        // TODO: Add proper toast notification system
    }
}

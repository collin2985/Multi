/**
 * FactionPanel.js
 * In-game faction display and one-way join UI
 * Shows current faction; allows neutral players to permanently join a faction
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
            this.networkManager.on('join_faction_response', (data) => {
                if (data.success) {
                    this.gameState.setFaction(data.factionId);

                    // Update local player's faction colors (shirt and name tag)
                    if (window.game?.updateLocalPlayerFactionColors) {
                        window.game.updateLocalPlayerFactionColors(data.factionId);
                    }

                    // Broadcast auth info to peers immediately
                    if (window.game?.networkManager) {
                        window.game.networkManager.broadcastAuthInfo();
                    }

                    this.hide();

                    if (window.game?.ui?.showNotification) {
                        const factionName = data.factionId === 1 ? 'Southguard' : 'Northmen';
                        window.game.ui.showNotification(`You joined ${factionName}!`);
                    }
                } else {
                    if (window.game?.ui?.showNotification) {
                        window.game.ui.showNotification(data.message || 'Failed to join faction');
                    }
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
        // Cancel auto-run when opening faction panel
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
        const currentFaction = this.gameState.factionId;
        const factionName = this.gameState.getFactionName(currentFaction);

        const factionColors = {
            null: '#888',
            1: '#8b4513',  // Southguard - brown
            3: '#4a6a8c'   // Northmen - blue
        };

        const factionColor = factionColors[currentFaction] || '#888';

        // Determine territory faction based on player Z position
        const playerZ = window.game?.playerObject?.position?.z ?? 0;
        const territoryFactionId = playerZ < 0 ? 1 : 3;
        const territoryFactionName = territoryFactionId === 1 ? 'Southguard' : 'Northmen';

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
                ">x</button>
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
            </div>

            <!-- Join / Status Section -->
            ${this.gameState.isGuest ? `
                <div style="text-align: center; color: #C8B898; font-size: 13px; margin-bottom: 16px;">
                    Create an account to join a faction
                </div>
            ` : currentFaction !== null ? `
                <div style="text-align: center; color: #C8B898; font-size: 13px; margin-bottom: 16px;">
                    Faction membership is permanent
                </div>
            ` : `
                <div style="margin-bottom: 16px;">
                    <button id="joinFactionBtn" style="
                        width: 100%;
                        padding: 12px;
                        background: ${territoryFactionId === 1 ? '#8b4513' : '#4a6a8c'};
                        border: none;
                        border-radius: 6px;
                        color: #fff;
                        cursor: pointer;
                        font-size: 14px;
                    ">Join ${territoryFactionName}</button>
                </div>
            `}

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

    attachEventListeners() {
        // Close button
        document.getElementById('factionPanelClose')?.addEventListener('click', () => {
            this.hide();
        });

        // Join faction button
        document.getElementById('joinFactionBtn')?.addEventListener('click', () => {
            this.handleJoinFaction();
        });
    }

    async handleJoinFaction() {
        const playerZ = window.game?.playerObject?.position?.z ?? 0;
        const factionId = playerZ < 0 ? 1 : 3;
        const factionName = factionId === 1 ? 'Southguard' : 'Northmen';

        const confirmed = await ui.showConfirmDialog(
            `Join ${factionName}? This choice is permanent.`
        );

        if (confirmed) {
            this.networkManager.sendMessage('join_faction', {
                factionId: factionId
            });
        }
    }
}

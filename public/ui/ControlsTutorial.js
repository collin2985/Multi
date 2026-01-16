/**
 * ControlsTutorial.js
 * Shows controls tutorial on first spawn
 * Explains WASD movement and camera controls
 */

export class ControlsTutorial {
    constructor(gameState) {
        this.gameState = gameState;
        this.panel = null;
        this.hasBeenClosed = this.loadClosedState();
    }

    loadClosedState() {
        // Check localStorage for persistence
        return localStorage.getItem('controlsTutorialClosed') === 'true';
    }

    saveClosedState() {
        localStorage.setItem('controlsTutorialClosed', 'true');
    }

    /**
     * Show the tutorial if not already closed
     * Called on first spawn
     */
    show() {
        if (this.hasBeenClosed) return;
        if (this.panel) return; // Already showing

        this.createPanel();
    }

    createPanel() {
        this.panel = document.createElement('div');
        this.panel.id = 'controlsTutorial';
        this.panel.style.cssText = `
            display: block;
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(58, 52, 45, 0.97);
            border: 1px solid #4A443D;
            border-radius: 8px;
            padding: 20px 24px;
            width: 320px;
            z-index: 1000;
            font-family: 'Segoe UI', Arial, sans-serif;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        `;

        this.panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <span style="color: #C4B998; font-size: 15px; font-weight: 600;">Getting Started</span>
                <button id="controlsTutorialClose" style="
                    background: none;
                    border: none;
                    color: #8B8070;
                    font-size: 18px;
                    cursor: pointer;
                    padding: 0 4px;
                    line-height: 1;
                " title="Close">x</button>
            </div>
            <div style="color: #A89880; font-size: 13px; line-height: 1.6;">
                <div style="margin-bottom: 12px;">
                    <div style="color: #C4B998; font-weight: 600; margin-bottom: 4px;">Controls</div>
                    <div>Use <span style="color: #D4C4A8; font-weight: 600;">WASD</span> to move, <span style="color: #D4C4A8; font-weight: 600;">click and drag</span> to rotate the camera, and <span style="color: #D4C4A8; font-weight: 600;">scroll</span> to zoom.</div>
                </div>
                <div style="margin-bottom: 12px;">
                    <div style="color: #C4B998; font-weight: 600; margin-bottom: 4px;">Food</div>
                    <div>Keep food in your backpack - you'll eat automatically. Variety gives a hunger bonus.</div>
                </div>
                <div style="margin-bottom: 12px;">
                    <div style="color: #C4B998; font-weight: 600; margin-bottom: 4px;">Tools</div>
                    <div>Keep tools in your backpack - they equip automatically when needed. Higher quality lasts longer.</div>
                </div>
                <div style="margin-bottom: 12px;">
                    <div style="color: #C4B998; font-weight: 600; margin-bottom: 4px;">Combat</div>
                    <div>You'll aim and fire automatically when enemies are in range, as long as you have a rifle and ammo. High ground improves accuracy and range.</div>
                </div>
                <div>
                    <div style="color: #C4B998; font-weight: 600; margin-bottom: 4px;">Building</div>
                    <div>Open the Build menu to place structures. Some create construction sites that need a hammer and materials to complete.</div>
                </div>
            </div>
            <div style="margin-top: 18px; text-align: center;">
                <button id="controlsTutorialGotIt" style="
                    background: #5C6B4A;
                    border: none;
                    border-radius: 4px;
                    color: #E0D8C8;
                    padding: 8px 24px;
                    font-size: 13px;
                    cursor: pointer;
                    font-family: inherit;
                ">Got it</button>
            </div>
        `;

        document.body.appendChild(this.panel);

        // Add event listeners
        document.getElementById('controlsTutorialClose').addEventListener('click', () => this.close());
        document.getElementById('controlsTutorialGotIt').addEventListener('click', () => this.close());
    }

    close() {
        if (this.panel) {
            this.panel.remove();
            this.panel = null;
        }
        this.hasBeenClosed = true;
        this.saveClosedState();
    }

    /**
     * Reset state - for testing or if user wants to see it again
     */
    reset() {
        localStorage.removeItem('controlsTutorialClosed');
        this.hasBeenClosed = false;
    }
}

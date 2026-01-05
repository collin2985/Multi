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
                <span style="color: #C4B998; font-size: 15px; font-weight: 600;">Controls</span>
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
                <div style="margin-bottom: 14px;">
                    <div style="color: #C4B998; font-weight: 600; margin-bottom: 4px;">Movement</div>
                    <div>Use <span style="color: #D4C4A8; font-weight: 600;">W A S D</span> keys to walk around the world.</div>
                </div>
                <div style="margin-bottom: 14px;">
                    <div style="color: #C4B998; font-weight: 600; margin-bottom: 4px;">Camera</div>
                    <div><span style="color: #D4C4A8; font-weight: 600;">Click and drag</span> with the left mouse button to rotate and tilt your view.</div>
                </div>
                <div>
                    <div style="color: #C4B998; font-weight: 600; margin-bottom: 4px;">Zoom</div>
                    <div>Use the <span style="color: #D4C4A8; font-weight: 600;">scroll wheel</span> to zoom in and out.</div>
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

export class DeathScreen {
    constructor(gameState, game) {
        this.gameState = gameState;
        this.game = game;
        this.overlay = null;
        this.respawnButton = null;
        this.countdownElement = null;
        this.deathMessageElement = null;
        this.countdownInterval = null;
        this.countdownSeconds = 10;
    }

    initialize() {
        this.overlay = document.getElementById('deathScreenOverlay');
        this.respawnButton = document.getElementById('respawnButton');
        this.countdownElement = document.getElementById('respawnCountdown');
        this.deathMessageElement = document.getElementById('deathMessage');

        if (!this.overlay || !this.respawnButton || !this.countdownElement) {
            console.error('Death screen elements not found in DOM');
            return;
        }

        this.respawnButton.addEventListener('click', () => this.handleRespawn());
    }

    show(deathReason = 'Unknown cause') {
        if (!this.overlay) return;

        // Display death reason
        if (this.deathMessageElement) {
            this.deathMessageElement.textContent = deathReason;
        }

        this.overlay.style.display = 'flex';
        this.startCountdown();
    }

    hide() {
        if (!this.overlay) return;

        this.overlay.style.display = 'none';
        this.stopCountdown();
    }

    startCountdown() {
        // Clear any existing countdown to prevent multiple intervals
        this.stopCountdown();

        this.countdownSeconds = 10;
        this.respawnButton.disabled = true;
        this.respawnButton.classList.add('disabled');
        this.updateCountdownDisplay();

        this.countdownInterval = setInterval(() => {
            this.countdownSeconds--;
            this.updateCountdownDisplay();

            if (this.countdownSeconds <= 0) {
                this.stopCountdown();
                this.respawnButton.disabled = false;
                this.respawnButton.classList.remove('disabled');
                this.respawnButton.textContent = 'RESPAWN';
            }
        }, 1000);
    }

    stopCountdown() {
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }
    }

    updateCountdownDisplay() {
        if (this.countdownSeconds > 0) {
            this.respawnButton.textContent = `RESPAWN (${this.countdownSeconds}s)`;
        }
    }

    handleRespawn() {
        if (this.respawnButton.disabled) return;

        this.hide();

        if (this.game && typeof this.game.respawnPlayer === 'function') {
            this.game.respawnPlayer();
        }
    }

    isOpen() {
        return this.overlay && this.overlay.style.display !== 'none';
    }
}

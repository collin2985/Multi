/**
 * RotationControls - UI component for structure rotation during placement
 * Displays rotation buttons and current angle at bottom center of screen
 */

export class RotationControls {
    constructor() {
        this.container = null;
        this.angleDisplay = null;
        this.leftButton = null;
        this.rightButton = null;
        this.confirmButton = null;
        this.currentRotation = 0;
        this.rotationIncrement = 15; // degrees per click
        this.cooldownTime = 25; // ms
        this.isOnCooldown = false;
        this.onRotateCallback = null;
        this.onConfirmCallback = null;

        this.createUI();
    }

    /**
     * Create the rotation controls UI
     */
    createUI() {
        // Main container - centered at top under build/backpack buttons
        this.container = document.createElement('div');
        this.container.id = 'rotation-controls';
        this.container.style.cssText = `
            position: fixed;
            top: 70px;
            left: 50%;
            transform: translateX(-50%);
            display: none;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            padding: 15px 25px;
            background: rgba(42, 37, 32, 0.9);
            border: 2px solid rgba(184, 130, 92, 0.5);
            border-radius: 10px;
            font-family: Arial, sans-serif;
            z-index: 1000;
            user-select: none;
        `;

        // Title/Description
        const titleLabel = document.createElement('div');
        titleLabel.textContent = 'Rotate Structure';
        titleLabel.style.cssText = `
            color: white;
            font-size: 14px;
            font-weight: bold;
            margin-bottom: 5px;
            text-align: center;
        `;
        this.container.appendChild(titleLabel);

        // Button container (horizontal row for buttons and angle display)
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 15px;
        `;

        // Left rotation button
        this.leftButton = document.createElement('button');
        this.leftButton.innerHTML = '↑<br>Q';
        this.leftButton.title = 'Rotate Left (Q)';
        this.leftButton.style.cssText = `
            padding: 10px 20px;
            background: rgba(91, 111, 122, 0.8);
            border: 2px solid rgba(122, 144, 156, 0.9);
            border-radius: 5px;
            color: white;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.2s;
        `;
        this.leftButton.addEventListener('mouseenter', () => {
            if (!this.isOnCooldown) {
                this.leftButton.style.background = 'rgba(74, 94, 105, 1)';
                this.leftButton.style.transform = 'scale(1.05)';
            }
        });
        this.leftButton.addEventListener('mouseleave', () => {
            this.leftButton.style.background = 'rgba(91, 111, 122, 0.8)';
            this.leftButton.style.transform = 'scale(1)';
        });
        this.leftButton.addEventListener('click', () => this.rotateLeft());

        // Angle display
        this.angleDisplay = document.createElement('div');
        this.angleDisplay.style.cssText = `
            padding: 8px 20px;
            background: rgba(58, 52, 45, 0.9);
            border: 2px solid rgba(184, 130, 92, 0.5);
            border-radius: 5px;
            color: white;
            font-size: 18px;
            font-weight: bold;
            min-width: 70px;
            text-align: center;
        `;
        this.angleDisplay.textContent = '0°';

        // Right rotation button
        this.rightButton = document.createElement('button');
        this.rightButton.innerHTML = '↑<br>E';
        this.rightButton.title = 'Rotate Right (E)';
        this.rightButton.style.cssText = `
            padding: 10px 20px;
            background: rgba(91, 111, 122, 0.8);
            border: 2px solid rgba(122, 144, 156, 0.9);
            border-radius: 5px;
            color: white;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.2s;
        `;
        this.rightButton.addEventListener('mouseenter', () => {
            if (!this.isOnCooldown) {
                this.rightButton.style.background = 'rgba(74, 94, 105, 1)';
                this.rightButton.style.transform = 'scale(1.05)';
            }
        });
        this.rightButton.addEventListener('mouseleave', () => {
            this.rightButton.style.background = 'rgba(91, 111, 122, 0.8)';
            this.rightButton.style.transform = 'scale(1)';
        });
        this.rightButton.addEventListener('click', () => this.rotateRight());

        // Confirm button
        this.confirmButton = document.createElement('button');
        this.confirmButton.innerHTML = 'Confirm (Space)';
        this.confirmButton.title = 'Confirm Placement (Space)';
        this.confirmButton.style.cssText = `
            padding: 10px 25px;
            background: rgba(107, 127, 92, 0.8);
            border: 2px solid rgba(122, 144, 96, 0.9);
            border-radius: 5px;
            color: white;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.2s;
            margin-left: 10px;
        `;
        this.confirmButton.addEventListener('mouseenter', () => {
            this.confirmButton.style.background = 'rgba(90, 110, 75, 1)';
            this.confirmButton.style.transform = 'scale(1.05)';
        });
        this.confirmButton.addEventListener('mouseleave', () => {
            this.confirmButton.style.background = 'rgba(107, 127, 92, 0.8)';
            this.confirmButton.style.transform = 'scale(1)';
        });
        this.confirmButton.addEventListener('click', () => this.confirm());

        // Add elements to button container
        buttonContainer.appendChild(this.leftButton);
        buttonContainer.appendChild(this.angleDisplay);
        buttonContainer.appendChild(this.rightButton);
        buttonContainer.appendChild(this.confirmButton);

        // Add button container to main container
        this.container.appendChild(buttonContainer);

        // Add to document
        document.body.appendChild(this.container);
    }

    /**
     * Rotate structure left (counter-clockwise)
     */
    rotateLeft() {
        if (this.isOnCooldown) return;

        this.currentRotation -= this.rotationIncrement;
        // Normalize to 0-360 range
        this.currentRotation = ((this.currentRotation % 360) + 360) % 360;

        this.updateDisplay();
        this.triggerCooldown();

        if (this.onRotateCallback) {
            this.onRotateCallback(this.currentRotation);
        }
    }

    /**
     * Rotate structure right (clockwise)
     */
    rotateRight() {
        if (this.isOnCooldown) return;

        this.currentRotation += this.rotationIncrement;
        // Normalize to 0-360 range
        this.currentRotation = ((this.currentRotation % 360) + 360) % 360;

        this.updateDisplay();
        this.triggerCooldown();

        if (this.onRotateCallback) {
            this.onRotateCallback(this.currentRotation);
        }
    }

    /**
     * Update angle display
     */
    updateDisplay() {
        this.angleDisplay.textContent = `${this.currentRotation}°`;
    }

    /**
     * Trigger cooldown on buttons
     */
    triggerCooldown() {
        this.isOnCooldown = true;

        // Visual feedback - dim buttons during cooldown
        this.leftButton.style.opacity = '0.5';
        this.rightButton.style.opacity = '0.5';
        this.leftButton.style.cursor = 'not-allowed';
        this.rightButton.style.cursor = 'not-allowed';

        setTimeout(() => {
            this.isOnCooldown = false;
            this.leftButton.style.opacity = '1';
            this.rightButton.style.opacity = '1';
            this.leftButton.style.cursor = 'pointer';
            this.rightButton.style.cursor = 'pointer';
        }, this.cooldownTime);
    }

    /**
     * Show rotation controls
     * @param {number} initialRotation - Starting rotation in degrees
     */
    show(initialRotation = 0) {
        this.currentRotation = initialRotation;
        this.updateDisplay();
        this.container.style.display = 'flex';
        this.isOnCooldown = false; // Reset cooldown when showing
    }

    /**
     * Hide rotation controls
     */
    hide() {
        this.container.style.display = 'none';
    }

    /**
     * Confirm placement
     */
    confirm() {
        if (this.onConfirmCallback) {
            this.onConfirmCallback();
        }
    }

    /**
     * Set callback for when rotation changes
     * @param {Function} callback - Function to call with new rotation value
     */
    setRotateCallback(callback) {
        this.onRotateCallback = callback;
    }

    /**
     * Set callback for when confirm is clicked
     * @param {Function} callback - Function to call when confirming
     */
    setConfirmCallback(callback) {
        this.onConfirmCallback = callback;
    }

    /**
     * Get current rotation value
     * @returns {number} Current rotation in degrees
     */
    getRotation() {
        return this.currentRotation;
    }

    /**
     * Set rotation value programmatically
     * @param {number} rotation - Rotation in degrees
     */
    setRotation(rotation) {
        this.currentRotation = ((rotation % 360) + 360) % 360;
        this.updateDisplay();
    }

    /**
     * Clean up UI elements
     */
    dispose() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    }
}

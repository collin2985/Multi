/**
 * CombatHUD.js
 * Displays combat stats (accuracy, range) at top center of screen
 * Only visible during combat stance
 */

export class CombatHUD {
    constructor() {
        this.container = null;
        this.contentWrapper = null;
        this.toggleBtn = null;
        this.warningEl = null;
        this.accuracyEl = null;
        this.rangeEl = null;
        this.ammoEl = null;
        this.noAmmoWarning = null;
        this.noRifleWarning = null;
        this.visible = false;
        this.flashCount = 0;
        this.flashTimer = null;
        this.currentTargetType = null;
        this.isHudHidden = false;

        this.createElements();
    }

    createElements() {
        // Main container - positioned below action buttons, centered
        this.container = document.createElement('div');
        this.container.id = 'combat-hud';
        this.container.style.cssText = `
            position: fixed;
            top: 110px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            padding: 8px 16px;
            background: rgba(42, 37, 32, 0.85);
            border: 2px solid #8B4513;
            border-radius: 4px;
            font-family: monospace;
            font-size: 13px;
            color: #E8DCC4;
            z-index: 150;
            opacity: 0;
            transition: opacity 0.15s ease-out;
            pointer-events: auto;
        `;

        // Toggle button - always visible when HUD is shown
        this.toggleBtn = document.createElement('button');
        this.toggleBtn.textContent = 'Hide';
        this.toggleBtn.style.cssText = `
            background: rgba(60, 50, 40, 0.9);
            border: 1px solid #8B4513;
            color: #E8DCC4;
            padding: 2px 8px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
            font-family: monospace;
            margin-bottom: 4px;
        `;
        this.toggleBtn.onclick = () => this.toggleHud();

        // Content wrapper - can be hidden while toggle stays visible
        this.contentWrapper = document.createElement('div');
        this.contentWrapper.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
        `;

        // Warning text - ENEMIES NEARBY
        this.warningEl = document.createElement('div');
        this.warningEl.textContent = 'ENEMIES NEARBY';
        this.warningEl.style.cssText = `
            color: #EF5350;
            font-weight: bold;
            font-size: 14px;
            text-shadow: 0 0 4px rgba(239, 83, 80, 0.5);
            opacity: 1;
        `;

        // Stats row
        const statsRow = document.createElement('div');
        statsRow.style.cssText = 'display: flex; gap: 16px;';

        // Accuracy stat
        const accuracyGroup = document.createElement('div');
        accuracyGroup.style.cssText = 'display: flex; align-items: center; gap: 6px;';

        const accuracyLabel = document.createElement('span');
        accuracyLabel.textContent = 'ACCURACY';
        accuracyLabel.style.cssText = 'color: #C8B898; font-size: 10px;';

        this.accuracyEl = document.createElement('span');
        this.accuracyEl.textContent = '20%';
        this.accuracyEl.style.cssText = 'color: #E8DCC4; font-weight: bold;';

        accuracyGroup.appendChild(accuracyLabel);
        accuracyGroup.appendChild(this.accuracyEl);

        // Range stat
        const rangeGroup = document.createElement('div');
        rangeGroup.style.cssText = 'display: flex; align-items: center; gap: 6px;';

        const rangeLabel = document.createElement('span');
        rangeLabel.textContent = 'RANGE';
        rangeLabel.style.cssText = 'color: #C8B898; font-size: 10px;';

        this.rangeEl = document.createElement('span');
        this.rangeEl.textContent = 'IN RANGE';
        this.rangeEl.style.cssText = 'color: #7CB342; font-weight: bold;';

        rangeGroup.appendChild(rangeLabel);
        rangeGroup.appendChild(this.rangeEl);

        // Ammo stat
        const ammoGroup = document.createElement('div');
        ammoGroup.style.cssText = 'display: flex; align-items: center; gap: 6px;';

        const ammoLabel = document.createElement('span');
        ammoLabel.textContent = 'AMMO';
        ammoLabel.style.cssText = 'color: #C8B898; font-size: 10px;';

        this.ammoEl = document.createElement('span');
        this.ammoEl.textContent = '20';
        this.ammoEl.style.cssText = 'color: #E8DCC4; font-weight: bold;';

        ammoGroup.appendChild(ammoLabel);
        ammoGroup.appendChild(this.ammoEl);

        statsRow.appendChild(accuracyGroup);
        statsRow.appendChild(rangeGroup);
        statsRow.appendChild(ammoGroup);

        // No ammo warning (shown below stats when out of ammo)
        this.noAmmoWarning = document.createElement('div');
        this.noAmmoWarning.textContent = 'NO AMMO';
        this.noAmmoWarning.style.cssText = `
            color: #FF5722;
            font-weight: bold;
            font-size: 12px;
            text-shadow: 0 0 4px rgba(255, 87, 34, 0.5);
            display: none;
            margin-top: 2px;
        `;

        // No rifle warning (shown below stats when no rifle equipped)
        this.noRifleWarning = document.createElement('div');
        this.noRifleWarning.textContent = 'NO RIFLE';
        this.noRifleWarning.style.cssText = `
            color: #FF5722;
            font-weight: bold;
            font-size: 12px;
            text-shadow: 0 0 4px rgba(255, 87, 34, 0.5);
            display: none;
            margin-top: 2px;
        `;

        // Append content elements to contentWrapper
        this.contentWrapper.appendChild(this.warningEl);
        this.contentWrapper.appendChild(statsRow);
        this.contentWrapper.appendChild(this.noRifleWarning);
        this.contentWrapper.appendChild(this.noAmmoWarning);

        // Append toggle and contentWrapper to container
        this.container.appendChild(this.toggleBtn);
        this.container.appendChild(this.contentWrapper);
        document.body.appendChild(this.container);
    }

    /**
     * Toggle HUD content visibility (toggle button stays visible)
     */
    toggleHud() {
        this.isHudHidden = !this.isHudHidden;
        if (this.isHudHidden) {
            this.contentWrapper.style.display = 'none';
            this.toggleBtn.textContent = 'Show Combat';
        } else {
            this.contentWrapper.style.display = 'flex';
            this.toggleBtn.textContent = 'Hide';
        }
    }

    /**
     * Update combat stats display
     * @param {boolean} inCombat - Whether player is in combat stance
     * @param {number} distance - Current distance to target
     * @param {number} shootingRange - Max shooting range
     * @param {number} hitChance - Hit chance (0-1)
     * @param {number} ammoCount - Current ammo count
     * @param {boolean} hasRifle - Whether player has a rifle
     * @param {string} targetType - Type of target: 'deer', 'bandit', or 'bear'
     */
    update(inCombat, distance = 0, shootingRange = 10, hitChance = 0.2, ammoCount = 0, hasRifle = true, targetType = 'bandit') {
        if (!inCombat) {
            this.hide();
            return;
        }

        // Update warning text based on target type
        if (targetType !== this.currentTargetType) {
            this.currentTargetType = targetType;
            if (targetType === 'deer') {
                this.warningEl.textContent = 'DEER NEARBY';
            } else if (targetType === 'bear') {
                this.warningEl.textContent = 'BEAR NEARBY';
            } else {
                this.warningEl.textContent = 'BANDITS NEARBY';
            }
        }

        // Update accuracy display
        const accuracyPercent = Math.round(hitChance * 100);
        this.accuracyEl.textContent = `${accuracyPercent}%`;

        // Color code accuracy
        if (accuracyPercent >= 60) {
            this.accuracyEl.style.color = '#7CB342'; // Green - high
        } else if (accuracyPercent >= 40) {
            this.accuracyEl.style.color = '#FFB74D'; // Orange - medium
        } else {
            this.accuracyEl.style.color = '#E8DCC4'; // Default - low
        }

        // Update range display - show distance and status
        const inRange = distance <= shootingRange;
        const distText = Math.round(distance) + 'm';
        if (inRange) {
            this.rangeEl.textContent = `${distText} IN RANGE`;
            this.rangeEl.style.color = '#7CB342'; // Green
        } else {
            this.rangeEl.textContent = `${distText} TOO FAR`;
            this.rangeEl.style.color = '#EF5350'; // Red
        }

        // Update ammo display
        this.ammoEl.textContent = ammoCount.toString();

        // Color code ammo
        if (ammoCount <= 0) {
            this.ammoEl.style.color = '#EF5350'; // Red - no ammo
            this.noAmmoWarning.style.display = 'block';
        } else if (ammoCount <= 5) {
            this.ammoEl.style.color = '#FFB74D'; // Orange - low ammo
            this.noAmmoWarning.style.display = 'none';
        } else {
            this.ammoEl.style.color = '#E8DCC4'; // Default
            this.noAmmoWarning.style.display = 'none';
        }

        // Show/hide rifle warning
        if (!hasRifle) {
            this.noRifleWarning.style.display = 'block';
        } else {
            this.noRifleWarning.style.display = 'none';
        }

        this.show();
    }

    show() {
        if (!this.visible) {
            this.visible = true;
            this.container.style.opacity = '1';
            this.startFlash();
        }
    }

    hide() {
        if (this.visible) {
            this.visible = false;
            this.container.style.opacity = '0';
            this.stopFlash();
            this.currentTargetType = null;
        }
    }

    /**
     * Flash the warning text twice then stay solid
     */
    startFlash() {
        this.stopFlash();
        this.flashCount = 0;
        this.warningEl.style.opacity = '1';

        const doFlash = () => {
            this.flashCount++;
            if (this.flashCount <= 4) {
                // Toggle opacity for flash effect (4 toggles = 2 complete flashes)
                this.warningEl.style.opacity = this.warningEl.style.opacity === '0' ? '1' : '0';
                this.flashTimer = setTimeout(doFlash, 150);
            } else {
                // After 2 flashes, stay solid
                this.warningEl.style.opacity = '1';
            }
        };

        this.flashTimer = setTimeout(doFlash, 150);
    }

    stopFlash() {
        if (this.flashTimer) {
            clearTimeout(this.flashTimer);
            this.flashTimer = null;
        }
        this.flashCount = 0;
    }

    dispose() {
        this.stopFlash();
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    }
}

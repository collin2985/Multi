/**
 * CombatHUD.js
 * Displays combat stats (accuracy, range, ammo) at bottom-right of screen
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
        this.currentTargetId = null;
        this.isHudHidden = false;
        this.isHoldingFire = false;

        // Artillery mode state
        this.isArtilleryMode = false;
        this.artilleryModeEl = null;
        this.artilleryCooldownBar = null;
        this.artilleryCooldownFill = null;
        this.artilleryControlsEl = null;

        // Rifle reload state
        this.rifleCooldownContainer = null;
        this.rifleCooldownBar = null;
        this.rifleCooldownFill = null;

        // Cache for DOM values to avoid redundant writes
        this._cache = {
            accuracyText: null,
            accuracyColor: null,
            rangeText: null,
            rangeColor: null,
            ammoText: null,
            ammoColor: null,
            noAmmoDisplay: null,
            noRifleDisplay: null,
            rifleCooldownWidth: null,
            rifleCooldownBg: null,
            artilleryCooldownWidth: null,
            artilleryCooldownBg: null,
            warningText: null,
            warningDisplay: null,
            ammoParentDisplay: null
        };

        this.createElements();
    }

    createElements() {
        // Main container - positioned at bottom-right corner
        this.container = document.createElement('div');
        this.container.id = 'combat-hud';
        this.container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 4px;
            padding: 10px 12px;
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

        // Hold Fire toggle button
        this.holdFireBtn = document.createElement('button');
        this.holdFireBtn.textContent = 'Hold Fire';
        this.holdFireBtn.style.cssText = `
            background: rgba(60, 50, 40, 0.9);
            border: 1px solid #8B4513;
            color: #E8DCC4;
            padding: 2px 8px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
            font-family: monospace;
        `;
        this.holdFireBtn.onclick = () => this.toggleHoldFire();

        // Content wrapper - can be hidden while toggle stays visible
        this.contentWrapper = document.createElement('div');
        this.contentWrapper.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 6px;
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

        // Stats column (stacked vertically for box shape)
        const statsRow = document.createElement('div');
        statsRow.style.cssText = 'display: flex; flex-direction: column; gap: 4px; align-items: flex-end;';

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

        // Rifle cooldown bar container (for rifle reload animation)
        this.rifleCooldownContainer = document.createElement('div');
        this.rifleCooldownContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 2px;
            margin-top: 4px;
        `;

        const rifleReloadLabel = document.createElement('span');
        rifleReloadLabel.textContent = 'RELOAD';
        rifleReloadLabel.style.cssText = 'color: #C8B898; font-size: 10px;';

        this.rifleCooldownBar = document.createElement('div');
        this.rifleCooldownBar.style.cssText = `
            width: 100px;
            height: 8px;
            background: rgba(60, 50, 40, 0.8);
            border: 1px solid #8B4513;
            border-radius: 2px;
            overflow: hidden;
        `;

        this.rifleCooldownFill = document.createElement('div');
        this.rifleCooldownFill.style.cssText = `
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, #7CB342, #8BC34A);
            transition: width 0.1s linear;
        `;

        this.rifleCooldownBar.appendChild(this.rifleCooldownFill);
        this.rifleCooldownContainer.appendChild(rifleReloadLabel);
        this.rifleCooldownContainer.appendChild(this.rifleCooldownBar);

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

        // Artillery mode elements (hidden by default)
        this.artilleryModeEl = document.createElement('div');
        this.artilleryModeEl.textContent = 'ARTILLERY MODE';
        this.artilleryModeEl.style.cssText = `
            color: #FFB74D;
            font-weight: bold;
            font-size: 14px;
            text-shadow: 0 0 4px rgba(255, 183, 77, 0.5);
            display: none;
        `;

        // Artillery cooldown bar container
        const cooldownContainer = document.createElement('div');
        cooldownContainer.style.cssText = `
            display: none;
            flex-direction: column;
            align-items: flex-end;
            gap: 2px;
            margin-top: 4px;
        `;

        const cooldownLabel = document.createElement('span');
        cooldownLabel.textContent = 'RELOAD';
        cooldownLabel.style.cssText = 'color: #C8B898; font-size: 10px;';

        this.artilleryCooldownBar = document.createElement('div');
        this.artilleryCooldownBar.style.cssText = `
            width: 100px;
            height: 8px;
            background: rgba(60, 50, 40, 0.8);
            border: 1px solid #8B4513;
            border-radius: 2px;
            overflow: hidden;
        `;

        this.artilleryCooldownFill = document.createElement('div');
        this.artilleryCooldownFill.style.cssText = `
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, #7CB342, #8BC34A);
            transition: width 0.1s linear;
        `;

        this.artilleryCooldownBar.appendChild(this.artilleryCooldownFill);
        cooldownContainer.appendChild(cooldownLabel);
        cooldownContainer.appendChild(this.artilleryCooldownBar);
        this.artilleryCooldownContainer = cooldownContainer;

        // Artillery controls hint
        this.artilleryControlsEl = document.createElement('div');
        this.artilleryControlsEl.textContent = 'A/D: Aim | F: Fire';
        this.artilleryControlsEl.style.cssText = `
            color: #C8B898;
            font-size: 10px;
            display: none;
            margin-top: 4px;
        `;

        // Append content elements to contentWrapper
        this.contentWrapper.appendChild(this.warningEl);
        this.contentWrapper.appendChild(this.artilleryModeEl);
        this.contentWrapper.appendChild(statsRow);
        this.contentWrapper.appendChild(this.rifleCooldownContainer);
        this.contentWrapper.appendChild(this.noRifleWarning);
        this.contentWrapper.appendChild(this.noAmmoWarning);
        this.contentWrapper.appendChild(cooldownContainer);
        this.contentWrapper.appendChild(this.artilleryControlsEl);

        // Create button row for toggle and hold fire buttons
        const buttonRow = document.createElement('div');
        buttonRow.style.cssText = 'display: flex; gap: 4px; margin-bottom: 4px;';
        buttonRow.appendChild(this.toggleBtn);
        buttonRow.appendChild(this.holdFireBtn);

        // Append button row and contentWrapper to container
        this.container.appendChild(buttonRow);
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
     * Toggle hold fire mode
     */
    toggleHoldFire() {
        this.isHoldingFire = !this.isHoldingFire;
        if (this.isHoldingFire) {
            this.holdFireBtn.textContent = 'Resume Fire';
            this.holdFireBtn.style.background = 'rgba(139, 69, 19, 0.9)';
        } else {
            this.holdFireBtn.textContent = 'Hold Fire';
            this.holdFireBtn.style.background = 'rgba(60, 50, 40, 0.9)';
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
     * @param {string} targetType - Type of target: 'deer', 'bandit', or 'brownbear'
     * @param {string} targetId - Unique identifier for the current target
     * @param {number} lastShootTime - Timestamp of last shot (Date.now())
     * @param {number} shootInterval - Cooldown between shots in ms
     */
    update(inCombat, distance = 0, shootingRange = 10, hitChance = 0.2, ammoCount = 0, hasRifle = true, targetType = 'bandit', targetId = null, lastShootTime = 0, shootInterval = 6000) {
        if (!inCombat) {
            this.hide();
            return;
        }

        // Check if target changed (new target acquired)
        const targetChanged = targetId && targetId !== this.currentTargetId;
        this.currentTargetId = targetId;

        // Update warning text based on target type
        if (targetType !== this.currentTargetType) {
            this.currentTargetType = targetType;
            if (targetType === 'deer') {
                this.warningEl.textContent = 'DEER NEARBY';
            } else if (targetType === 'brownbear') {
                this.warningEl.textContent = 'BROWN BEAR NEARBY';
            } else if (targetType === 'player') {
                this.warningEl.textContent = 'ENEMY PLAYER NEARBY';
            } else if (targetType === 'militia') {
                this.warningEl.textContent = 'MILITIA NEARBY';
            } else {
                this.warningEl.textContent = 'BANDITS NEARBY';
            }
        }

        // Flash when new target acquired (and HUD is not hidden)
        if (targetChanged && !this.isHudHidden) {
            this.startFlash();
        }

        // Update accuracy display (with caching to avoid redundant DOM writes)
        const accuracyPercent = Math.round(hitChance * 100);
        const accuracyText = `${accuracyPercent}%`;
        if (this._cache.accuracyText !== accuracyText) {
            this._cache.accuracyText = accuracyText;
            this.accuracyEl.textContent = accuracyText;
        }

        // Color code accuracy
        const accuracyColor = accuracyPercent >= 60 ? '#7CB342' : (accuracyPercent >= 40 ? '#FFB74D' : '#E8DCC4');
        if (this._cache.accuracyColor !== accuracyColor) {
            this._cache.accuracyColor = accuracyColor;
            this.accuracyEl.style.color = accuracyColor;
        }

        // Update range display - show distance and status
        const inRange = distance <= shootingRange;
        const distText = Math.round(distance) + 'm';
        const rangeText = inRange ? `${distText} IN RANGE` : `${distText} TOO FAR`;
        const rangeColor = inRange ? '#7CB342' : '#EF5350';

        if (this._cache.rangeText !== rangeText) {
            this._cache.rangeText = rangeText;
            this.rangeEl.textContent = rangeText;
        }
        if (this._cache.rangeColor !== rangeColor) {
            this._cache.rangeColor = rangeColor;
            this.rangeEl.style.color = rangeColor;
        }

        // Update ammo display
        const ammoText = ammoCount.toString();
        if (this._cache.ammoText !== ammoText) {
            this._cache.ammoText = ammoText;
            this.ammoEl.textContent = ammoText;
        }

        // Color code ammo
        const ammoColor = ammoCount <= 0 ? '#EF5350' : (ammoCount <= 5 ? '#FFB74D' : '#E8DCC4');
        const noAmmoDisplay = ammoCount <= 0 ? 'block' : 'none';

        if (this._cache.ammoColor !== ammoColor) {
            this._cache.ammoColor = ammoColor;
            this.ammoEl.style.color = ammoColor;
        }
        if (this._cache.noAmmoDisplay !== noAmmoDisplay) {
            this._cache.noAmmoDisplay = noAmmoDisplay;
            this.noAmmoWarning.style.display = noAmmoDisplay;
        }

        // Show/hide rifle warning
        const noRifleDisplay = hasRifle ? 'none' : 'block';
        if (this._cache.noRifleDisplay !== noRifleDisplay) {
            this._cache.noRifleDisplay = noRifleDisplay;
            this.noRifleWarning.style.display = noRifleDisplay;
        }

        // Update rifle reload bar
        const now = Date.now();
        const elapsed = now - lastShootTime;
        const progress = Math.min(1, elapsed / shootInterval);

        // Round to 1% increments to reduce DOM updates
        const cooldownWidth = `${Math.round(progress * 100)}%`;
        if (this._cache.rifleCooldownWidth !== cooldownWidth) {
            this._cache.rifleCooldownWidth = cooldownWidth;
            this.rifleCooldownFill.style.width = cooldownWidth;
        }

        // Color code reload bar based on progress
        const cooldownBg = progress >= 1
            ? 'linear-gradient(90deg, #7CB342, #8BC34A)'
            : (progress >= 0.5
                ? 'linear-gradient(90deg, #FFB74D, #FFA726)'
                : 'linear-gradient(90deg, #EF5350, #E53935)');

        if (this._cache.rifleCooldownBg !== cooldownBg) {
            this._cache.rifleCooldownBg = cooldownBg;
            this.rifleCooldownFill.style.background = cooldownBg;
        }

        this.show();
    }

    /**
     * Update artillery mode display
     * @param {boolean} isManning - Whether player is manning artillery
     * @param {number} lastFireTime - Last fire timestamp (performance.now())
     * @param {number} cooldown - Cooldown duration in ms
     * @param {number} artilleryQuality - Quality of manned artillery
     * @param {number} targetDistance - Distance to current target (0 if no target)
     * @param {number} maxRange - Artillery max range
     * @param {string} targetType - Type of target: 'bandit', 'player', 'brownbear', 'boat', or null
     * @param {number|null} hitChance - Pre-calculated hit chance (0-1), null if no valid target
     */
    updateArtillery(isManning, lastFireTime = 0, cooldown = 12000, artilleryQuality = 50, targetDistance = 0, maxRange = 28, targetType = null, hitChance = null) {
        if (!isManning) {
            // Exit artillery mode
            if (this.isArtilleryMode) {
                this.isArtilleryMode = false;
                this.artilleryModeEl.style.display = 'none';
                this.artilleryCooldownContainer.style.display = 'none';
                this.artilleryControlsEl.style.display = 'none';
                this.warningEl.style.display = 'block';
                this.rifleCooldownContainer.style.display = 'flex';  // Show rifle reload bar
                // Reset ammo parent display cache so it shows again in rifle mode
                this._cache.ammoParentDisplay = null;
                this.ammoEl.parentElement.style.display = '';
            }
            return;
        }

        // Enter artillery mode
        if (!this.isArtilleryMode) {
            this.isArtilleryMode = true;
            this.artilleryModeEl.style.display = 'block';
            this.artilleryCooldownContainer.style.display = 'flex';
            this.artilleryControlsEl.style.display = 'block';
            this.rifleCooldownContainer.style.display = 'none';  // Hide rifle reload bar
            this.show();
        }

        // Always hide rifle/ammo warnings in artillery mode (with caching)
        if (this._cache.noRifleDisplay !== 'none') {
            this._cache.noRifleDisplay = 'none';
            this.noRifleWarning.style.display = 'none';
        }
        if (this._cache.noAmmoDisplay !== 'none') {
            this._cache.noAmmoDisplay = 'none';
            this.noAmmoWarning.style.display = 'none';
        }

        // Update target warning based on target type (with caching)
        const hasTarget = targetType && targetDistance > 0;
        const warningDisplay = hasTarget ? 'block' : 'none';
        if (this._cache.warningDisplay !== warningDisplay) {
            this._cache.warningDisplay = warningDisplay;
            this.warningEl.style.display = warningDisplay;
        }

        if (hasTarget) {
            const warningText = targetType === 'player' ? 'ENEMY PLAYER'
                : targetType === 'bandit' ? 'BANDIT'
                : targetType === 'brownbear' ? 'BROWN BEAR'
                : targetType === 'boat' ? 'ENEMY BOAT'
                : targetType === 'militia' ? 'MILITIA'
                : 'TARGET';

            if (this._cache.warningText !== warningText) {
                this._cache.warningText = warningText;
                this.warningEl.textContent = warningText;
            }
        }

        // Update cooldown bar (with caching)
        const now = performance.now();
        const elapsed = now - lastFireTime;
        const progress = Math.min(1, elapsed / cooldown);

        // Round to 1% increments to reduce DOM updates
        const artilleryCooldownWidth = `${Math.round(progress * 100)}%`;
        if (this._cache.artilleryCooldownWidth !== artilleryCooldownWidth) {
            this._cache.artilleryCooldownWidth = artilleryCooldownWidth;
            this.artilleryCooldownFill.style.width = artilleryCooldownWidth;
        }

        // Color code cooldown bar
        const artilleryCooldownBg = progress >= 1
            ? 'linear-gradient(90deg, #7CB342, #8BC34A)'
            : (progress >= 0.5
                ? 'linear-gradient(90deg, #FFB74D, #FFA726)'
                : 'linear-gradient(90deg, #EF5350, #E53935)');

        if (this._cache.artilleryCooldownBg !== artilleryCooldownBg) {
            this._cache.artilleryCooldownBg = artilleryCooldownBg;
            this.artilleryCooldownFill.style.background = artilleryCooldownBg;
        }

        // Update accuracy display - use calculated hitChance if available, otherwise base accuracy
        let accuracyPercent;
        if (hitChance !== null && targetDistance > 0 && targetDistance <= maxRange) {
            accuracyPercent = Math.round(hitChance * 100);
        } else {
            // Fallback to base accuracy with quality when no target
            const qualityBonus = (artilleryQuality - 50) / 50 * 0.10;
            accuracyPercent = Math.round((0.35 + qualityBonus) * 100);
        }
        const accuracyText = `${accuracyPercent}%`;
        if (this._cache.accuracyText !== accuracyText) {
            this._cache.accuracyText = accuracyText;
            this.accuracyEl.textContent = accuracyText;
        }

        // Update range display - show target distance or no target (with caching)
        let rangeText, rangeColor;
        if (targetDistance > 0) {
            const distText = Math.round(targetDistance) + 'm';
            if (targetDistance <= maxRange) {
                rangeText = `${distText} IN RANGE`;
                rangeColor = '#7CB342';
            } else {
                rangeText = `${distText} TOO FAR`;
                rangeColor = '#EF5350';
            }
        } else {
            rangeText = 'NO TARGET';
            rangeColor = '#C8B898';
        }

        if (this._cache.rangeText !== rangeText) {
            this._cache.rangeText = rangeText;
            this.rangeEl.textContent = rangeText;
        }
        if (this._cache.rangeColor !== rangeColor) {
            this._cache.rangeColor = rangeColor;
            this.rangeEl.style.color = rangeColor;
        }

        // Hide ammo (artillery doesn't use ammo like rifles) - with caching
        if (this._cache.ammoParentDisplay !== 'none') {
            this._cache.ammoParentDisplay = 'none';
            this.ammoEl.parentElement.style.display = 'none';
        }
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
            this.currentTargetId = null;
            // Reset cache so values refresh on next show
            this._clearCache();
        }
    }

    _clearCache() {
        for (const key in this._cache) {
            this._cache[key] = null;
        }
    }

    /**
     * Flash the warning text once then stay solid
     */
    startFlash() {
        this.stopFlash();
        this.flashCount = 0;
        this.warningEl.style.opacity = '1';

        const doFlash = () => {
            this.flashCount++;
            if (this.flashCount <= 2) {
                // Toggle opacity for flash effect (2 toggles = 1 complete flash)
                this.warningEl.style.opacity = this.warningEl.style.opacity === '0' ? '1' : '0';
                this.flashTimer = setTimeout(doFlash, 100);
            } else {
                // After 1 flash, stay solid
                this.warningEl.style.opacity = '1';
            }
        };

        this.flashTimer = setTimeout(doFlash, 100);
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

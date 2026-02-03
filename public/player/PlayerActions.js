/**
 * PlayerActions.js
 * Manages player actions: harvesting, building, chiseling
 */

export class PlayerActions {
    constructor(inventory, audioManager, animationMixer) {
        this.inventory = inventory;
        this.audioManager = audioManager;
        this.animationMixer = animationMixer;

        // Active action state
        this.activeAction = null;
        this.choppingAction = null; // Animation action

        // Cooldown state
        this.harvestCooldown = null;

        // Callbacks
        this.onActionCompleteCallback = null;
        this.onToolBreakCallback = null;
    }

    /**
     * Set chopping animation action
     * @param {THREE.AnimationAction} action
     */
    setChoppingAnimation(action) {
        this.choppingAction = action;
    }

    /**
     * Set animation mixer (can be set after construction)
     * @param {THREE.AnimationMixer} mixer
     */
    setAnimationMixer(mixer) {
        this.animationMixer = mixer;
    }

    /**
     * Set action complete callback
     * @param {function} callback
     */
    onActionComplete(callback) {
        this.onActionCompleteCallback = callback;
    }

    /**
     * Set tool break callback
     * @param {function} callback - Called with (toolType)
     */
    onToolBreak(callback) {
        this.onToolBreakCallback = callback;
    }

    /**
     * Check if currently performing an action
     * @returns {boolean}
     */
    isActionActive() {
        return this.activeAction !== null;
    }

    /**
     * Get active action
     * @returns {object|null}
     */
    getActiveAction() {
        return this.activeAction;
    }

    /**
     * Start harvest action
     * @param {object} object - Object to harvest
     * @param {string} harvestType - 'firewood', 'planks', or 'stone'
     * @param {number} duration - Action duration in ms
     * @returns {boolean} - True if action started
     */
    startHarvest(object, harvestType, duration = 10000) {
        // Check cooldown
        if (this.harvestCooldown) {
            const remaining = this.harvestCooldown.endTime - Date.now();
            if (remaining > 0) {
                return false;
            }
            this.harvestCooldown = null;
        }

        // Validate tool
        const requiredTool = this.getRequiredTool(harvestType);
        if (!this.inventory.hasItemWithDurability(requiredTool)) {
            return false;
        }

        // Start action
        this.activeAction = {
            type: 'harvest',
            object: object,
            startTime: Date.now(),
            duration: duration,
            harvestType: harvestType,
            sound: null
        };

        // Play sound and animation
        this.playActionSound(harvestType);
        this.startAnimation();

        return true;
    }

    /**
     * Start build action
     * @param {object} constructionSite
     * @param {number} duration - Action duration in ms
     * @returns {boolean}
     */
    startBuild(constructionSite, duration = 6000) {
        if (this.activeAction) return false;
        if (!this.inventory.hasItemWithDurability('hammer')) return false;

        this.activeAction = {
            type: 'build',
            object: constructionSite,
            startTime: Date.now(),
            duration: duration,
            actionType: 'build',
            sound: null
        };

        this.playActionSound('hammer');
        this.startAnimation();

        return true;
    }

    /**
     * Start chiseling action
     * @param {object} chisel - Chisel item
     * @param {object} stone - Stone item
     * @param {number} duration - Action duration in ms
     * @returns {boolean}
     */
    startChiseling(chisel, stone, duration = 6000) {
        if (this.activeAction) return false;
        if (chisel.durability <= 0) return false;

        this.activeAction = {
            type: 'chiseling',
            object: null,
            startTime: Date.now(),
            duration: duration,
            actionType: 'chiseling',
            chisel: chisel,
            stone: stone,
            sound: null
        };

        this.playActionSound('chisel');
        this.startAnimation();

        return true;
    }

    /**
     * Update active action
     * @returns {number} - Progress (0-1), or -1 if no active action
     */
    update() {
        if (!this.activeAction) return -1;

        const elapsed = Date.now() - this.activeAction.startTime;
        const progress = Math.min(elapsed / this.activeAction.duration, 1);

        // Check if action is complete
        if (progress >= 1) {
            this.complete();
        }

        return progress;
    }

    /**
     * Complete current action
     * @private
     */
    complete() {
        if (!this.activeAction) return;

        const action = this.activeAction;

        // Stop sound and animation
        if (action.sound) {
            action.sound.stop();
        }
        this.stopAnimation();

        // Handle different action types
        let result = null;

        if (action.type === 'build') {
            result = this.completeBuild(action);
        } else if (action.type === 'chiseling') {
            result = this.completeChiseling(action);
        } else if (action.type === 'harvest') {
            result = this.completeHarvest(action);
        }

        // Clear action
        this.activeAction = null;

        // Trigger callback
        if (this.onActionCompleteCallback) {
            this.onActionCompleteCallback(action, result);
        }
    }

    /**
     * Complete build action
     * @private
     */
    completeBuild(action) {
        const hammer = this.inventory.findItemByType('hammer');
        if (!hammer) return { success: false };

        // Consume durability
        const hammerStillExists = this.inventory.decreaseDurability(hammer.id, 10);

        if (!hammerStillExists && this.onToolBreakCallback) {
            this.onToolBreakCallback('hammer');
        }

        return {
            success: true,
            constructionSite: action.object,
            toolBroke: !hammerStillExists
        };
    }

    /**
     * Complete chiseling action
     * @private
     */
    completeChiseling(action) {
        const { chisel, stone } = action;

        // Calculate durability loss based on stone quality
        const durabilityLoss = Math.ceil(100 / stone.quality);
        const chiselStillExists = this.inventory.decreaseDurability(chisel.id, durabilityLoss);

        if (!chiselStillExists) {
            if (this.onToolBreakCallback) {
                this.onToolBreakCallback('chisel');
            }
            return { success: false, toolBroke: true };
        }

        // Convert stone to chiseled version
        const chiseledType = stone.type
            .replace('limestone', 'chiseledlimestone')
            .replace('sandstone', 'chiseledsandstone')
            .replace('Rlimestone', 'Rchiseledlimestone')
            .replace('Rsandstone', 'Rchiseledsandstone');

        stone.type = chiseledType;

        return {
            success: true,
            chiseledType: chiseledType,
            toolBroke: false
        };
    }

    /**
     * Complete harvest action
     * @private
     */
    completeHarvest(action) {
        return {
            success: true,
            object: action.object,
            harvestType: action.harvestType
        };
    }

    /**
     * Cancel current action
     */
    cancel() {
        if (!this.activeAction) return;

        if (this.activeAction.sound) {
            this.activeAction.sound.stop();
        }
        this.stopAnimation();
        this.activeAction = null;
    }

    /**
     * Get required tool for harvest type
     * @private
     */
    getRequiredTool(harvestType) {
        const toolMap = {
            'firewood': 'axe',
            'planks': 'saw',
            'stone': 'pickaxe'
        };
        return toolMap[harvestType];
    }

    /**
     * Play action sound
     * @private
     */
    playActionSound(actionType) {
        if (!this.audioManager || !this.activeAction) return;

        let sound = null;
        switch (actionType) {
            case 'firewood':
                sound = this.audioManager.playAxeSound();
                break;
            case 'planks':
                sound = this.audioManager.playSawSound();
                break;
            case 'stone':
                sound = this.audioManager.playPickaxeSound();
                break;
            case 'hammer':
                sound = this.audioManager.playHammerSound();
                break;
            case 'chisel':
                sound = this.audioManager.playChiselSound();
                break;
        }

        if (sound) {
            this.activeAction.sound = sound;
        }
    }

    /**
     * Start chopping animation
     * @private
     */
    startAnimation() {
        if (this.animationMixer && this.choppingAction) {
            this.choppingAction.reset();
            this.choppingAction.play();
        }
    }

    /**
     * Stop chopping animation
     * @private
     */
    stopAnimation() {
        if (this.animationMixer && this.choppingAction) {
            this.choppingAction.stop();
        }
    }

    /**
     * Set harvest cooldown
     * @param {number} duration - Cooldown duration in ms
     */
    setHarvestCooldown(duration) {
        this.harvestCooldown = {
            endTime: Date.now() + duration
        };
    }

    /**
     * Get remaining cooldown time
     * @returns {number} - Remaining time in ms, or 0 if no cooldown
     */
    getRemainingCooldown() {
        if (!this.harvestCooldown) return 0;
        const remaining = this.harvestCooldown.endTime - Date.now();
        if (remaining <= 0) {
            this.harvestCooldown = null;
            return 0;
        }
        return remaining;
    }
}

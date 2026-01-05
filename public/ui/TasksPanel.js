/**
 * TasksPanel.js
 * Beginner tutorial tasks UI
 * Shows on spawn, tracks completion, can be permanently closed
 */

import { ui } from '../ui.js';

export class TasksPanel {
    constructor(gameState, networkManager) {
        this.gameState = gameState;
        this.networkManager = networkManager;

        this.panel = null;
        this.isVisible = false;
        this.isClosed = false;
        this.completedTasks = new Set();

        // Task definitions from tasklist.txt
        this.tasks = [
            { id: 1, title: 'Gather vines', description: 'Walk through a forest and stop on green patches of terrain. Look for a Gather Vines button at the top of the screen when you\'re stopped and press the button.' },
            { id: 2, title: 'Check your backpack', description: 'Click the Backpack button at the top of the screen. You have limited inventory - keep space for tools and a little food. Discard items by dragging them out of your backpack.' },
            { id: 3, title: 'Gather 4 pieces of vines', description: 'Keep gathering until you have 4. If your backpack is full, drag unwanted items (stone, extra planks) outside it to discard.' },
            { id: 4, title: 'Combine vines into rope', description: 'In your backpack, drag one vines onto another to combine. Vines in different regions have different quality.' },
            { id: 5, title: 'Make 2 pieces of rope', description: 'Combine more vines for a second rope. The materials you use to craft or build determine its quality.' },
            { id: 6, title: 'Make a fishing net', description: 'Drag one rope onto another to combine. Food in your backpack is eaten automatically. Without food for 6 minutes, you die. Having different foods will make you less hungry.' },
            { id: 7, title: 'Go to ocean and fish', description: 'Walk to the shore. Click the Fish button when it appears. Higher quality nets increase your chance of catching fish and the quality of fish caught.' },
            { id: 8, title: 'Catch a fish', description: 'Keep trying until you catch one! High quality fish will make you less hungry once cooked. You can\'t eat raw fish.' },
            { id: 9, title: 'Mine limestone', description: 'Keep tools in your backpack and you will get options at the top of the screen to gather resources when in range. Find grey rocks in the world, stand next to them, and click "Mine Limestone".' },
            { id: 10, title: 'Build a campfire', description: 'Click Build, select Campfire, place on flat ground near you. Tip: Keep your campfire close to where you want to live. Steep slopes and rugged terrain slow you down. Roads can be built with chiseled limestone (chisel + limestone) to travel faster.' },
            { id: 11, title: 'Cut down a tree', description: 'Find a tree and go near it. As long as you have an axe in your backpack, you can chop trees down. Be aware of the durability of your axe, it drops with use.' },
            { id: 12, title: 'Cut firewood from the log', description: 'The fallen tree is now a log. Click Chop Firewood. Firewood can be used to cook fish, vegetables and turn clay into tiles for construction in houses, campfires, and tileworks.' },
            { id: 13, title: 'Add firewood and fish to campfire', description: 'Click Campfire button nearby. Drag the firewood you cut and the fish you caught into it.' },
            { id: 14, title: 'Take the cooked fish', description: 'The fire starts when firewood is added. When the fish is done cooking, drag it to your backpack. Food keeps you alive! But you have to have food in your backpack in order to not starve.' },
            { id: 15, title: 'Saw a plank', description: 'Stand near a fallen log and click "Saw Planks". The plank\'s quality matches the tree\'s quality. If you don\'t have inventory space you can drop items by placing them outside your backpack. Be careful, tools are rare, don\'t drop them!' },
            { id: 16, title: 'Gather 2 vines', description: 'Find green patches of terrain and gather vines. You need 2 to make rope.' },
            { id: 17, title: 'Combine into rope', description: 'In your backpack, drag one vines onto another to combine them into rope.' },
            { id: 18, title: 'Build a tent', description: 'You need 1 rope and 1 plank. Click "Build" (top-left), select Tent. Place on flat ground, not on objects.' },
            { id: 19, title: 'Your tent is ready', description: 'Click the "Tent" button nearby. Store extra materials here to free backpack space - but keep tools (auto-equip) and food (prevents starvation) in your backpack. This is your respawn point!' },
            { id: 20, title: 'Create an account', description: 'Click "Create Account" (top-left). Your tent only works as a respawn point with an account!' },
            { id: 21, title: 'Enter your details', description: 'Choose a username (3-20 characters, letters/numbers/underscore). Password must be at least 8 characters.' },
            { id: 22, title: 'Account created!', description: 'Your inventory, position, and home now save when you log out. Add friends and change factions anytime!' },
            { id: 23, title: 'Take apples from a tree', description: 'Find an apple tree, they look wider than pine trees. Stand near one and click the Backpack button. Drag apples into your backpack. Eat different food types to reduce hunger rate by up to 40%.' },
            { id: 24, title: 'Gather vegetables', description: 'Find vegetable patches growing in the world. Stand near them and click "Gather Vegetables". You can plant your own - "Gather Seed" sometimes appears near plants, then use the Build menu to plant it.' },
            { id: 25, title: 'Cook vegetables', description: 'Put vegetables and firewood in a campfire. After 1 minute they become roasted vegetables with double the nutrition value.' },
            { id: 26, title: 'Build a dock', description: 'You need 1 plank. Click Build, select Dock. Find a shoreline where water is to the east. The dock auto-snaps to valid spots - move along the coast until it turns green. Once placed, go up to the dock and hit the construction button to add materials and build.' },
            { id: 27, title: 'Talk to the merchant', description: 'Ships arrive every 30 minutes. In the meantime, gather resources and store them in your tent. When a ship docks, a merchant walks onto the pier. Stand near them and click "Talk to Merchant".' },
            { id: 28, title: 'Build a market', description: 'Build a market close to your dock. Markets supply tools and weapons when stocked with materials.' },
            { id: 29, title: 'Check the market', description: 'Go next to the market and hit the Market button. Merchant ships will supply tools/weapons if you stock the market with 20 items of the same material (e.g., limestone).' }
        ];

        this.createElements();
        this.loadState();
    }

    /**
     * Reset all task state - called on spawn for guests
     * Clears completions and closed state for fresh start
     */
    reset() {
        this.completedTasks = new Set();
        this.isClosed = false;
        this.isVisible = false;
        // Clear sessionStorage for guests
        sessionStorage.removeItem('taskCompletions');
        sessionStorage.removeItem('tasksPanelClosed');
    }

    createElements() {
        // Add CSS animation for checkmark
        if (!document.getElementById('tasksPanelStyles')) {
            const style = document.createElement('style');
            style.id = 'tasksPanelStyles';
            style.textContent = `
                @keyframes checkPop {
                    0% { transform: scale(0); opacity: 0; }
                    50% { transform: scale(1.2); }
                    100% { transform: scale(1); opacity: 1; }
                }
                @keyframes coinGlow {
                    0%, 100% { filter: drop-shadow(0 0 2px #FFD700) drop-shadow(0 0 4px #FFA500); }
                    50% { filter: drop-shadow(0 0 6px #FFD700) drop-shadow(0 0 10px #FFA500); }
                }
            `;
            document.head.appendChild(style);
        }

        this.panel = document.createElement('div');
        this.panel.id = 'tasksPanel';
        this.panel.title = 'Earn a coin for each task completed';
        this.panel.style.cssText = `
            display: none;
            position: fixed;
            bottom: 20px;
            left: 20px;
            background: rgba(58, 52, 45, 0.95);
            border: 1px solid #4A443D;
            border-radius: 8px;
            padding: 12px;
            width: 240px;
            z-index: 999;
            font-family: 'Segoe UI', Arial, sans-serif;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        `;

        document.body.appendChild(this.panel);

        // Expose globally for event hooks
        window.tasksPanel = this;
    }

    loadState() {
        // Guests: start fresh every spawn - don't load anything
        // Accounts: wait for server data via checkServerClosed()
        // SessionStorage is NOT used for persistence anymore

        // Clear any stale sessionStorage data
        sessionStorage.removeItem('taskCompletions');
        sessionStorage.removeItem('tasksPanelClosed');

        // Start with empty state - server data loaded via checkServerClosed() for accounts
        this.completedTasks = new Set();
        this.isClosed = false;
    }

    // Called on spawn - loads server data for accounts
    checkServerClosed(playerData) {
        // Load tasksPanelClosed from server (top-level for local mode, stats for production)
        if (playerData?.tasksPanelClosed || playerData?.stats?.tasksPanelClosed) {
            this.isClosed = true;
        }

        // Load taskCompletions from server (top-level for local mode, stats for production)
        const completions = playerData?.taskCompletions || playerData?.stats?.taskCompletions;
        if (completions && Array.isArray(completions)) {
            this.completedTasks = new Set(completions);
        }

        // Auto-complete registration tasks if player is logged in (they've already done this)
        if (!this.gameState.isGuest) {
            const hadAccountTasks = this.completedTasks.has(20);
            this.completedTasks.add(20); // Create an account
            this.completedTasks.add(21); // Enter your details
            this.completedTasks.add(22); // Account created!
            // Only save if we added new completions
            if (!hadAccountTasks) {
                this.saveCompletions();
            }
        }
    }

    saveCompletions() {
        // For accounts, persist to server
        if (!this.gameState.isGuest && this.networkManager) {
            this.networkManager.sendMessage('save_task_progress', {
                completions: [...this.completedTasks]
            });
        }
        // Note: sessionStorage no longer used - guests reset every spawn,
        // accounts persist to server
    }

    completeTask(taskId) {
        if (this.isClosed || !this.isVisible) return;
        if (this.completedTasks.has(taskId)) return;

        // Only animate if this is the current task
        const currentTask = this.tasks.find(t => !this.completedTasks.has(t.id));
        if (!currentTask || currentTask.id !== taskId) {
            // Not current task, just mark complete silently
            this.completedTasks.add(taskId);
            this.saveCompletions();
            return;
        }

        // Show checkmark animation
        const content = document.getElementById('taskContent');
        if (content) {
            content.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <span style="font-size: 32px; color: #7A9060; animation: checkPop 0.5s ease;">✓</span>
                </div>
            `;
        }

        // After animation, mark complete, reward coin, and show next task
        setTimeout(() => {
            this.completedTasks.add(taskId);
            this.saveCompletions();
            try {
                this.rewardCoin();
            } catch (e) {
                console.error('Failed to reward coin:', e);
            }
            this.render();
        }, 800);
    }

    /**
     * Reward player with 1 coin for completing a task
     */
    rewardCoin() {
        const inventory = this.gameState?.inventory;
        if (!inventory || !inventory.items) {
            console.warn('No inventory available for coin reward');
            return;
        }

        const items = inventory.items;

        // Check for existing coin item
        const existingCoin = items.find(item => item.type === 'coin');

        if (existingCoin) {
            // Stack with existing coins
            existingCoin.quantity = (existingCoin.quantity || 0) + 1;
            this.playCoinSound();
            return;
        }

        // No existing coin - need to find space for new coin item
        // Try each position in the grid
        const { rows, cols } = inventory;
        const newCoin = {
            id: 'coin_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            type: 'coin',
            width: 1,
            height: 1,
            rotation: 0,
            quality: 100,
            durability: 100,
            quantity: 1
        };

        // Find a free slot
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (this.isSlotFree(x, y, items)) {
                    newCoin.x = x;
                    newCoin.y = y;
                    items.push(newCoin);
                    this.playCoinSound();
                    return;
                }
            }
        }

        // No space found
        ui.showToast(`Inventory full! Need ${newCoin.width}x${newCoin.height} - coin reward lost!`, 'warning', 4000);
        ui.updateInventoryFullStatus(true);
    }

    /**
     * Check if a single 1x1 slot is free
     */
    isSlotFree(x, y, items) {
        for (const item of items) {
            const itemWidth = item.rotation === 90 ? item.height : item.width;
            const itemHeight = item.rotation === 90 ? item.width : item.height;

            // Check if (x,y) falls within this item's bounds
            if (x >= item.x && x < item.x + itemWidth &&
                y >= item.y && y < item.y + itemHeight) {
                return false;
            }
        }
        return true;
    }

    /**
     * Play coin sound for 1 second
     */
    playCoinSound() {
        try {
            window.game?.audioManager?.playSound('coins', 1000);
        } catch (e) {
            // Ignore audio errors
        }
    }

    // ========== Event Handlers (called from game code) ==========

    onItemAdded(itemType, count) {
        if (this.isClosed) return;

        // Normalize item type
        const type = itemType?.toLowerCase();

        // Task 1: Gather vines (any vines)
        if (type === 'vines') {
            this.completeTask(1);
            // Task 3: Gather 4 pieces of vines
            if (count >= 4) {
                this.completeTask(3);
            }
            // Task 16: Gather 2 vines (for tent rope)
            if (count >= 2) {
                this.completeTask(16);
            }
        }

        // Task 4, 5, 17: Make rope
        if (type === 'rope') {
            this.completeTask(4);
            this.completeTask(17);
            if (count >= 2) {
                this.completeTask(5);
            }
        }

        // Task 15: Saw a plank
        if (type?.endsWith('plank')) {
            this.completeTask(15);
        }

        // Task 6: Make fishing net
        if (type === 'fishingnet') {
            this.completeTask(6);
        }

        // Task 8: Catch a fish
        if (type === 'fish') {
            this.completeTask(8);
        }

        // Task 9: Mine limestone
        if (type === 'limestone') {
            this.completeTask(9);
        }

        // Task 12: Cut firewood
        if (type?.includes('firewood')) {
            this.completeTask(12);
        }

        // Task 14: Cook fish
        if (type === 'cookedfish') {
            this.completeTask(14);
        }

        // Task 23: Take apples from a tree
        if (type === 'apple') {
            this.completeTask(23);
        }

        // Task 24: Gather vegetables
        if (type === 'vegetables') {
            this.completeTask(24);
        }

        // Task 25: Cook vegetables
        if (type === 'roastedvegetables') {
            this.completeTask(25);
        }
    }

    onActionComplete(actionType, harvestType) {
        if (this.isClosed) return;

        // Task 11: Cut down a tree
        if (actionType === 'chop') {
            this.completeTask(11);
        }

        // Task 10: Build campfire
        if (actionType === 'build_campfire' ||
            (actionType === 'build' && harvestType === 'campfire')) {
            this.completeTask(10);
        }
    }

    onInventoryOpened() {
        if (this.isClosed) return;
        // Task 2: Check backpack
        this.completeTask(2);
    }

    onFishButtonClicked() {
        if (this.isClosed) return;
        // Task 7: Go to ocean and fish
        this.completeTask(7);
    }

    onItemMovedToCrate(itemType, structureType) {
        if (this.isClosed) return;
        // Task 13: Add to campfire
        if (structureType === 'campfire') {
            this.completeTask(13);
        }
    }

    onStructurePlaced(structureType) {
        if (this.isClosed) return;
        // Task 18: Build a tent
        if (structureType === 'tent') {
            this.completeTask(18);
        }
        // Task 26: Build a dock
        if (structureType === 'dock') {
            this.completeTask(26);
        }
        // Task 28: Build a market
        if (structureType === 'market') {
            this.completeTask(28);
        }
    }

    onStructureInventoryOpened(structureType) {
        if (this.isClosed) return;
        // Task 19: Your tent is ready
        if (structureType === 'tent') {
            this.completeTask(19);
        }
        // Task 29: Check the market
        if (structureType === 'market') {
            this.completeTask(29);
        }
    }

    onCreateAccountClicked() {
        if (this.isClosed) return;
        // Task 20: Create an account
        this.completeTask(20);
    }

    onRegisterFormShown() {
        if (this.isClosed) return;
        // Task 21: Enter your details
        this.completeTask(21);
    }

    onAccountCreated() {
        if (this.isClosed) return;
        // Task 22: Account created!
        this.completeTask(22);
    }

    onTalkToMerchant() {
        if (this.isClosed) return;
        // Task 27: Talk to the merchant
        this.completeTask(27);
    }

    // ========== UI Methods ==========

    show() {
        if (this.isClosed) return;
        this.render();
        this.panel.style.display = 'block';
        this.isVisible = true;
    }

    hide() {
        this.panel.style.display = 'none';
        this.isVisible = false;
    }

    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    close() {
        const isGuest = this.gameState.isGuest;
        const message = isGuest
            ? "Close tasks for this session?"
            : "Close the beginner tasks permanently?\n\nThis tutorial will never show again on this account.\nOnly close if you're an experienced player.";

        ui.showConfirmDialog(message).then(confirmed => {
            if (confirmed) {
                this.isClosed = true;
                this.hide();
                if (isGuest) {
                    sessionStorage.setItem('tasksPanelClosed', 'true');
                } else {
                    // Save to server for accounts
                    if (this.networkManager) {
                        this.networkManager.sendMessage('save_tasks_closed', {});
                    }
                }
            }
        });
    }

    render() {
        const currentTask = this.tasks.find(t => !this.completedTasks.has(t.id));
        const completedCount = this.completedTasks.size;
        const totalCount = this.tasks.length;

        // All tasks complete
        if (!currentTask) {
            this.panel.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #4A443D;">
                    <div>
                        <span style="color: #ddd; font-size: 14px; font-weight: bold;">Beginner Tasks</span>
                        <span style="color: #7A9060; font-size: 12px; margin-left: 8px;">Complete!</span>
                    </div>
                    <button id="tasksPanelClose" style="
                        background: transparent;
                        border: none;
                        color: #C8B898;
                        font-size: 20px;
                        cursor: pointer;
                        padding: 0 4px;
                        line-height: 1;
                    " title="Close tasks panel">×</button>
                </div>
                <div style="
                    padding: 15px;
                    text-align: center;
                    color: #7A9060;
                    font-size: 14px;
                ">
                    <span style="font-size: 24px;">✓</span>
                    <div style="margin-top: 8px;">All tasks complete!</div>
                    <div style="color: #C8B898; font-size: 12px; margin-top: 4px;">You're ready to explore.</div>
                </div>
            `;
            this.attachEventListeners();
            return;
        }

        // Show single current task
        this.panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #4A443D;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: #ddd; font-size: 14px; font-weight: bold;">Next Task</span>
                    <img src="./items/coin.png"
                         alt="coin"
                         style="width: 28px; height: 28px; image-rendering: pixelated; animation: coinGlow 3s ease-in-out infinite;">
                </div>
                <button id="tasksPanelClose" style="
                    background: transparent;
                    border: none;
                    color: #C8B898;
                    font-size: 20px;
                    cursor: pointer;
                    padding: 0 4px;
                    line-height: 1;
                " title="Close tasks panel">×</button>
            </div>
            <div id="taskContent">
                <div style="color: #ddd; font-size: 14px; font-weight: bold; margin-bottom: 8px;">
                    ${currentTask.title}
                </div>
                ${currentTask.description ? `
                    <div style="color: #B89F5C; font-size: 12px; line-height: 1.5;">
                        ${currentTask.description}
                    </div>
                ` : ''}
            </div>
        `;

        this.attachEventListeners();
    }

    attachEventListeners() {
        document.getElementById('tasksPanelClose')?.addEventListener('click', () => {
            this.close();
        });
    }
}

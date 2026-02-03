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
        // Track cumulative gathering for tasks that require totals
        this.totalVinesGathered = 0;

        this.tasks = [
            { id: 1, title: 'Gather vines', description: 'Walk through a forest and stop on green patches of terrain. Look for a Gather Vines button at the top of the screen when you\'re stopped and press the button.' },
            { id: 2, title: 'Gather another vine', description: 'Gather a 2nd vine. Combining 2 vines will allow you to create rope, an essential crafting material.' },
            { id: 3, title: 'Check your backpack', description: 'Click the Backpack button at the top of the screen. You have limited inventory - keep space for tools and a little food. Discard items by dragging them out of your backpack.' },
            { id: 4, title: 'Combine vines into rope', description: 'In your backpack, drag one vine onto another to combine them into rope. One of rope\'s purposes is to combine with a limestone to craft an improvised tool.' },
            { id: 5, title: 'Craft an improvised tool', description: 'Drag the rope onto the limestone in your backpack to craft an improvised tool. You need tools to chop trees and mine rocks. Improvised tools are weak and break very often. Tip: if you move and stop repeatedly on grass, you can occasionally find limestone.' },
            { id: 6, title: 'Gather 4 more vines', description: 'You need 4 more vines to make 2 ropes for a fishing net. If your backpack is full, drag unwanted items outside it to discard.' },
            { id: 7, title: 'Combine vines into rope', description: 'In your backpack, drag one vine onto another to combine. Vines in different regions have different quality.' },
            { id: 8, title: 'Make 2 pieces of rope', description: 'Combine more vines for a second rope. The materials you use to craft or build determine its quality.' },
            { id: 9, title: 'Make a fishing net', description: 'Drag one rope onto another to combine. Food in your backpack is eaten automatically. Without food for 6 minutes, you die. Having different foods will make you less hungry.' },
            { id: 10, title: 'Go to ocean and fish', description: 'Walk to the shore. Click the Fish button when it appears. Higher quality nets increase your chance of catching fish and the quality of fish caught.' },
            { id: 11, title: 'Catch a fish', description: 'Keep trying until you catch one! High quality fish will make you less hungry once cooked. You can\'t eat raw fish.' },
            { id: 12, title: 'Mine limestone', description: 'Keep tools in your backpack and you will get options at the top of the screen to gather resources when in range. Find grey rocks in the world, stand next to them, and click "Mine Limestone". Always keep a limestone on you in case your improvised tool breaks - you can craft a new one with rope and limestone.' },
            { id: 13, title: 'Build a campfire', description: 'Click Build, select Campfire, place on flat ground near you. Tip: Keep your campfire close to where you want to live. Steep slopes and rugged terrain slow you down. Roads can be built with chiseled limestone (chisel + limestone) to travel faster.' },
            { id: 14, title: 'Cut down a tree', description: 'Find a tree and go near it. As long as you have a tool in your backpack, you can chop trees down. Be aware of the durability of your tool, it drops with use.' },
            { id: 15, title: 'Cut firewood from the log', description: 'The fallen tree is now a log. Click Chop Firewood. Firewood can be used to cook fish, vegetables and turn clay into tiles for construction in houses, campfires, and tileworks.' },
            { id: 16, title: 'Add firewood and fish to campfire', description: 'Click Campfire button nearby. Drag the firewood you cut and the fish you caught into it.' },
            { id: 17, title: 'Take the cooked fish', description: 'The fire starts when firewood is added. When the fish is done cooking, drag it to your backpack. Food keeps you alive! But you have to have food in your backpack in order to not starve.' },
            { id: 18, title: 'Saw a plank', description: 'Stand near a fallen log and click "Saw Planks". The plank\'s quality matches the tree\'s quality. If you don\'t have inventory space you can drop items by placing them outside your backpack. Be careful, tools are rare, don\'t drop them!' },
            { id: 19, title: 'Build a crate', description: 'You need 1 plank. Click "Build" (top-left), select Crate. Place on flat ground near you. Crates let you store extra materials to free up backpack space.' },
            { id: 20, title: 'Open your crate', description: 'Click the "Crate" button nearby. Store extra materials here to free backpack space - but keep tools (auto-equip) and food (prevents starvation) in your backpack.' },
            { id: 21, title: 'Create an account', description: 'Click "Create Account" (top-left). Your inventory and position save when you log out. Build a tent later for a respawn point!' },
            { id: 22, title: 'Enter your details', description: 'Choose a username (3-20 characters, letters/numbers/underscore). Password must be at least 8 characters.' },
            { id: 23, title: 'Account created!', description: 'Your inventory, position, and home now save when you log out. Add friends and change factions anytime!' },
            { id: 24, title: 'Take apples from a tree', description: 'Find an apple tree, they look wider than pine trees. Stand near one and click the Backpack button. Drag apples into your backpack. Eat different food types to reduce hunger rate by up to 40%.' },
            { id: 25, title: 'Gather vegetables', description: 'Find vegetable patches growing in the world. Stand near them and click "Gather Vegetables". You can plant your own - "Gather Seed" sometimes appears near plants, then use the Build menu to plant it.' },
            { id: 26, title: 'Cook vegetables', description: 'Put vegetables and firewood in a campfire. After 1 minute they become roasted vegetables with double the nutrition value.' },
            { id: 27, title: 'Build a dock', description: 'You need 1 chiseled limestone (drag your improvised tool onto limestone in your backpack to chisel it). Click Build, select Dock. Find a shoreline where water is to the east. The dock auto-snaps to valid spots - move along the coast until it turns green. Once placed, stand near the construction site and add the chiseled limestone to finish building. Tip: always place a dock before a market - docks are harder to position, then build your market within 20 units of it.' },
            { id: 28, title: 'Gather clay', description: 'Find clay deposits in the world (reddish-brown patches). Stand near them and click "Mine Clay". You need clay to make tiles for building.' },
            { id: 29, title: 'Cook clay into tile', description: 'Put clay and firewood in a campfire. After 5 minutes the clay becomes a tile. Tiles are needed to build markets and other advanced structures.' },
            { id: 30, title: 'Build a market', description: 'You need 1 plank, 1 chiseled limestone, and 1 tile. Build a market within 20 units of your dock. Place the construction site, then add materials to finish building. Markets supply tools and weapons when stocked with materials.' },
            { id: 31, title: 'Build a woodcutter', description: 'You need 1 plank, 1 chiseled limestone, and 1 tile. Build within 20 units of your market. Once built, stand near it and click "Seek Proprietor" to sell it for 10 coins. A worker will spawn and automatically chop trees, delivering planks and firewood to your market. Sold structures never decay.' },
            { id: 32, title: 'Open harbour to trade', description: 'Go next to the market and hit the Market button. Click "Harbour Closed" to open it to trade ships.' },
            { id: 33, title: 'Talk to the merchant', description: 'Ships arrive every 30 minutes. In the meantime, gather resources and store them in your crate. When a ship docks, a merchant walks onto the pier. Stand near them and click "Talk to Merchant". Stock the market with 20 items of the same material to trade for tools/weapons.' }
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
        this.totalVinesGathered = 0;
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
            const hadAccountTasks = this.completedTasks.has(21);
            this.completedTasks.add(21); // Create an account
            this.completedTasks.add(22); // Enter your details
            this.completedTasks.add(23); // Account created!
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

        // Tasks 1, 2, 6: Vine gathering (cumulative tracking)
        if (type === 'vines') {
            this.completeTask(1); // Task 1: Gather vines
            this.totalVinesGathered++;
            if (this.totalVinesGathered >= 2) {
                this.completeTask(2); // Task 2: Gather another vine
            }
            if (this.totalVinesGathered >= 6) {
                this.completeTask(6); // Task 6: Gather 4 more vines (6 total)
            }
        }

        // Tasks 4, 7, 8: Make rope
        if (type === 'rope') {
            this.completeTask(4);  // Task 4: Combine vines into rope (for improvised tool)
            this.completeTask(7);  // Task 7: Combine vines into rope (for fishing net)
            if (count >= 2) {
                this.completeTask(8); // Task 8: Make 2 pieces of rope
            }
        }

        // Task 5: Craft improvised tool
        if (type === 'improvisedtool') {
            this.completeTask(5);
        }

        // Task 18: Saw a plank
        if (type?.endsWith('plank')) {
            this.completeTask(18);
        }

        // Task 9: Make fishing net
        if (type === 'fishingnet') {
            this.completeTask(9);
        }

        // Task 11: Catch a fish
        if (type === 'fish') {
            this.completeTask(11);
        }

        // Task 12: Mine limestone
        if (type === 'limestone') {
            this.completeTask(12);
        }

        // Task 15: Cut firewood
        if (type?.includes('firewood')) {
            this.completeTask(15);
        }

        // Task 17: Cook fish
        if (type === 'cookedfish') {
            this.completeTask(17);
        }

        // Task 24: Take apples from a tree
        if (type === 'apple') {
            this.completeTask(24);
        }

        // Task 25: Gather vegetables
        if (type === 'vegetables') {
            this.completeTask(25);
        }

        // Task 26: Cook vegetables
        if (type === 'roastedvegetables') {
            this.completeTask(26);
        }

        // Task 28: Gather clay
        if (type === 'clay') {
            this.completeTask(28);
        }

        // Task 29: Cook clay into tile
        if (type === 'tile') {
            this.completeTask(29);
        }
    }

    onActionComplete(actionType, harvestType) {
        if (this.isClosed) return;

        // Task 14: Cut down a tree
        if (actionType === 'chop') {
            this.completeTask(14);
        }

        // Task 13: Build campfire
        if (actionType === 'build_campfire' ||
            (actionType === 'build' && harvestType === 'campfire')) {
            this.completeTask(13);
        }
    }

    onInventoryOpened() {
        if (this.isClosed) return;
        // Task 3: Check backpack
        this.completeTask(3);
    }

    onFishButtonClicked() {
        if (this.isClosed) return;
        // Task 10: Go to ocean and fish
        this.completeTask(10);
    }

    onItemMovedToCrate(itemType, structureType) {
        if (this.isClosed) return;
        // Task 16: Add to campfire
        if (structureType === 'campfire') {
            this.completeTask(16);
        }
    }

    onStructurePlaced(structureType) {
        if (this.isClosed) return;
        // Task 19: Build a crate
        if (structureType === 'crate') {
            this.completeTask(19);
        }
        // Task 27: Build a dock
        if (structureType === 'dock') {
            this.completeTask(27);
        }
        // Task 30: Build a market
        if (structureType === 'market') {
            this.completeTask(30);
        }
        // Task 31: Build a woodcutter
        if (structureType === 'woodcutter') {
            this.completeTask(31);
        }
    }

    onStructureInventoryOpened(structureType) {
        if (this.isClosed) return;
        // Task 20: Open your crate
        if (structureType === 'crate') {
            this.completeTask(20);
        }
    }

    onMerchantShipsEnabled() {
        if (this.isClosed) return;
        // Task 32: Open harbour to trade
        this.completeTask(32);
    }

    onCreateAccountClicked() {
        if (this.isClosed) return;
        // Task 21: Create an account
        this.completeTask(21);
    }

    onRegisterFormShown() {
        if (this.isClosed) return;
        // Task 22: Enter your details
        this.completeTask(22);
    }

    onAccountCreated() {
        if (this.isClosed) return;
        // Task 23: Account created!
        this.completeTask(23);
    }

    onTalkToMerchant() {
        if (this.isClosed) return;
        // Task 33: Talk to the merchant
        this.completeTask(33);
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

/**
 * TasksPanel.js
 * Beginner tutorial tasks UI (82 tasks)
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

        // Track cumulative gathering for tasks that require totals
        this.totalVinesGathered = 0;

        this.tasks = [
            // === Survival Basics (1-9) ===
            { id: 1, title: 'Gather vines', description: 'Walk through a forest and stop on green patches of terrain. Look for a Gather Vines button at the top of the screen when you\'re stopped and press the button.' },
            { id: 2, title: 'Gather another vine', description: 'Gather a 2nd vine. Combining 2 vines will allow you to create rope, an essential crafting material.' },
            { id: 3, title: 'Check your backpack', description: 'Click the Backpack button at the top of the screen. You have limited inventory - keep space for tools and a little food. Discard items by dragging them out of your backpack.' },
            { id: 4, title: 'Combine vines into rope', description: 'In your backpack, drag one vine onto another to combine them into rope. One of rope\'s purposes is to combine with a limestone to craft an improvised tool.' },
            { id: 5, title: 'Craft an improvised tool', description: 'Drag the rope onto the limestone in your backpack to craft an improvised tool. You need tools to chop trees and mine rocks. Improvised tools are weak and break very often. Tip: if you move and stop repeatedly on grass, you can occasionally find limestone.' },
            { id: 6, title: 'Gather 4 more vines', description: 'You need 4 more vines to make 2 ropes for a fishing net. If your backpack is full, drag unwanted items outside it to discard.' },
            { id: 7, title: 'Combine vines into rope', description: 'In your backpack, drag one vine onto another to combine. Vines in different regions have different quality. The world is divided into regions - look for dark wooden posts that line the edges of each region. Resources change quality when you cross into a new region.' },
            { id: 8, title: 'Make 2 pieces of rope', description: 'Combine more vines for a second rope. The materials you use to craft or build determine its quality.' },
            { id: 9, title: 'Make a fishing net', description: 'Drag one rope onto another to combine. Food in your backpack is eaten automatically. Without food for 6 minutes, you die. Having different foods will make you less hungry.' },
            // === Fishing (10-11) ===
            { id: 10, title: 'Go to ocean and fish', description: 'Walk to the shore. Click the Fish button when it appears. Higher quality nets increase your chance of catching fish and the quality of fish caught.' },
            { id: 11, title: 'Catch a fish', description: 'Keep trying until you catch one! High quality fish will make you less hungry once cooked. You can\'t eat raw fish.' },
            // === Mining & Building (12-20) ===
            { id: 12, title: 'Mine limestone', description: 'Keep tools in your backpack and you will get options at the top of the screen to gather resources when in range. Find grey rocks in the world, stand next to them, and click "Mine Limestone". Always keep a limestone on you in case your improvised tool breaks - you can craft a new one with rope and limestone. Reminder: dark wooden posts mark region borders where resource quality changes.' },
            { id: 13, title: 'Build a campfire', description: 'Click Build, select Campfire, place on flat ground near you. Tip: Keep your campfire close to where you want to live. Steep slopes and rugged terrain slow you down. Roads can be built with chiseled limestone (chisel + limestone) to travel faster.' },
            { id: 14, title: 'Cut down a tree', description: 'Find a tree and go near it. As long as you have a tool in your backpack, you can chop trees down. Be aware of the durability of your tool, it drops with use.' },
            { id: 15, title: 'Cut firewood from the log', description: 'The fallen tree is now a log. Click Chop Firewood. Firewood can be used to cook fish, vegetables and turn clay into tiles for construction in houses, campfires, and tileworks.' },
            { id: 16, title: 'Add firewood and fish to campfire', description: 'Click Campfire button nearby. Drag the firewood you cut and the fish you caught into it.' },
            { id: 17, title: 'Take the cooked fish', description: 'The fire starts when firewood is added. When the fish is done cooking, drag it to your backpack. Food keeps you alive! But you have to have food in your backpack in order to not starve.' },
            { id: 18, title: 'Saw a plank', description: 'Stand near a fallen log and click "Saw Planks". The plank\'s quality matches the tree\'s quality. If you don\'t have inventory space you can drop items by placing them outside your backpack. Be careful, tools are rare, don\'t drop them!' },
            { id: 19, title: 'Build a crate', description: 'You need 1 plank. Click "Build" (top-left), select Crate. Place on flat ground near you. Crates let you store extra materials to free up backpack space.' },
            { id: 20, title: 'Open your crate', description: 'Click the "Crate" button nearby. Store extra materials here to free backpack space - but keep tools (auto-equip) and food (prevents starvation) in your backpack.' },
            // === Transport (21-25) — NEW ===
            { id: 21, title: 'Build a cart', description: 'You need 1 plank. Click "Build" and select Cart. Carts let you haul a crate full of materials across the map.' },
            { id: 22, title: 'Tow the cart', description: 'Walk near the cart and click "Attach Cart". You can tow it on foot. Later, you can tow faster with a horse.' },
            { id: 23, title: 'Load crate onto the cart', description: 'While towing, walk near your crate and click "Load Crate". The crate rides on the cart with all its items inside. Click "Release Cart" when you want to stop.' },
            { id: 24, title: 'Build a boat', description: 'You need 1 plank. Place it in the water using the Build menu. Boats let you scout the coastline for a good place to settle.' },
            { id: 25, title: 'Sail the boat', description: 'Walk near the boat and click "Enter Boat". W forward, S reverse, A/D to turn. Click "Exit Boat" near shore to disembark.' },
            // === Account & Saving (26-29) — shifted from 21-24 ===
            { id: 26, title: 'Create an account', description: 'Click "Create Account" (top-left). With an account, you can use Save and Exit to keep your inventory. Build a house later for a respawn point!' },
            { id: 27, title: 'Enter your details', description: 'Choose a username (3-20 characters, letters/numbers/underscore). Password must be at least 8 characters.' },
            { id: 28, title: 'Account created!', description: 'You can now use Save and Exit to preserve your inventory and position. Add friends and change factions anytime!' },
            { id: 29, title: 'Find the Save and Exit button', description: 'Open Settings (top-left). Find the "Save and Exit" button - this is the only way to keep your inventory between sessions. It saves your items and position. On your next login, choose "Resume Last Session" to restore them. Dying, or choosing any other spawn option, permanently removes the resume option. Without Save and Exit, closing the game loses your inventory.' },
            // === Food Variety (30-32) — shifted from 25-27 ===
            { id: 30, title: 'Take apples from a tree', description: 'Find an apple tree, they look wider than pine trees. Stand near one and click the Backpack button. Drag apples into your backpack. Eat different food types to reduce hunger rate by up to 40%.' },
            { id: 31, title: 'Gather vegetables', description: 'Find vegetable patches growing in the world. Stand near them and click "Gather Vegetables". You can plant your own - "Gather Seed" sometimes appears near plants, then use the Build menu to plant it.' },
            { id: 32, title: 'Cook vegetables', description: 'Put vegetables and firewood in a campfire. After 1 minute they become roasted vegetables with double the nutrition value.' },
            // === Building a Town (33-40) — shifted from 28-35 ===
            { id: 33, title: 'Build a dock', description: 'You need 1 chiseled limestone (drag your improvised tool onto limestone in your backpack to chisel it). Click Build, select Dock. Walk along the coast and move your cursor near the waterline - the dock auto-snaps to valid shoreline positions and picks its own rotation. Green means valid, red means invalid. If it stays red, try a different stretch of coast - the dock needs a gradual shoreline with deep open water ahead of it. Once green, click to place, then stand near the construction site, click the "Construction" button, add materials, and click Build. Make sure you have an improvised tool or hammer. Only 1 dock is allowed per region (the area between the dark wooden border posts). Tip: always place a dock before a market - docks are harder to position, then build your market within 20 units of it.' },
            { id: 34, title: 'Gather clay', description: 'Find clay deposits in the world (reddish-brown patches). Stand near them and click "Mine Clay". You need clay to make tiles for building.' },
            { id: 35, title: 'Cook clay into tile', description: 'Put clay and firewood in a campfire. After 5 minutes the clay becomes a tile. Tiles are needed to build markets and other advanced structures.' },
            { id: 36, title: 'Build a market', description: 'You need 1 plank, 1 chiseled limestone, and 1 tile. Build a market within 20 units of your dock. Only 1 market is allowed per region. Place the construction site, then add materials and build it. Markets are your trading hub - sell resources to stock the market, then open the harbour to attract merchant ships. Ships take your materials and leave tools, weapons, and horses. Worker buildings placed nearby can automate resource delivery to your market.' },
            { id: 37, title: 'Build a house', description: 'You need 1 plank, 1 chiseled limestone, and 1 tile. Place it with the Build menu, add materials, and click Build. Your house becomes your home - when you die, you can respawn here (with an empty inventory). It has a large 10x10 storage that only you can access, and you can cook inside it with firewood. You can only own one house at a time.' },
            { id: 38, title: 'Build a woodcutter', description: 'You need 1 plank, 1 chiseled limestone, and 1 tile. Build within 20 units of your market. Once built, stand near it and click "Seek Proprietor" to sell it for 10 coins. A worker will spawn and automatically chop trees, delivering planks and firewood to your market. Sold structures never decay.' },
            { id: 39, title: 'Open harbour to trade', description: 'Go next to the market and hit the Market button. Click "Harbour Closed" to open it to trade ships.' },
            { id: 40, title: 'Talk to the merchant', description: 'Ships arrive every 30 minutes. In the meantime, gather resources and store them in your crate. When a ship docks, a merchant walks onto the pier. Stand near them and click "Talk to Merchant". Stock the market with 20 items of the same material to trade for tools/weapons.' },
            // === Expand Your Economy (41-47) — NEW ===
            { id: 41, title: 'Build a tileworks', description: 'Same materials as the woodcutter (1 plank, 1 chiseled limestone, 1 tile). Build within 20 units of your market. The tileworks turns clay into tiles much faster than a campfire.' },
            { id: 42, title: 'Open the tileworks', description: 'Stand near your tileworks and click the "Tileworks" button to open it. The tileworks needs clay and firewood to produce tiles.' },
            { id: 43, title: 'Add clay and firewood to the tileworks', description: 'Drag clay and firewood into the tileworks inventory. It processes tiles automatically - much faster than a campfire.' },
            { id: 44, title: 'Take tiles from the tileworks', description: 'When processing finishes, drag the tiles to your backpack. Tiles are needed for houses, markets, and all worker buildings.' },
            { id: 45, title: 'Build a miner', description: 'Same materials as other worker buildings (1 plank, 1 chiseled limestone, 1 tile). Build within 20 units of your market and sell to a proprietor. The miner harvests nearby rocks and delivers stone to your market. Once you have a miner supplying clay, you can also sell your tileworks to a proprietor to automate tile production.' },
            { id: 46, title: 'Build a stonemason', description: 'The stonemason collects raw stone from your market, chisels it into chiseled stone, and delivers it back. Once a miner is supplying stone, the stonemason automates what you\'ve been doing by hand.' },
            { id: 47, title: 'Build a gardener', description: 'Plants and harvests vegetables behind the building. Also plants trees during downtime, keeping your area supplied with wood. You can also build a baker (bakes apple tarts) or a fisherman (catches and cooks fish) if you want more food production.' },
            // === Roads (48-49) — NEW ===
            { id: 48, title: 'Build a road', description: 'Open the Build menu and select Road. Costs 1 chiseled limestone. Use the scroll wheel to rotate before placing.' },
            { id: 49, title: 'Walk on a road', description: 'Step onto your road. You move twice as fast on roads. Worker NPCs and horses also move faster on roads. Build roads between your buildings.' },
            // === Hemp & Fabric (50-51) — NEW ===
            { id: 50, title: 'Gather hemp fiber', description: 'Find hemp plants at low elevations. Stop near one and click "Gather Hemp". Hemp fiber is used to make fabric.' },
            { id: 51, title: 'Craft fabric', description: 'Drag one hemp fiber onto another in your backpack. Takes 6 seconds. Fabric is needed for tents, sailboats, and ships. You can also combine 2 animal skins into fabric.' },
            // === Factions & Quality (52-55) — NEW ===
            { id: 52, title: 'Join a faction', description: 'Open Settings (top-left) and click Faction. Choose Southguard (south territory) or Northmen (north territory). This is permanent. You must be in a faction to earn influence and recruit militia.' },
            { id: 53, title: 'Talk to a trapper', description: 'Find a trapper NPC in the wild - a man standing near a tent. Walk close and click "Talk to Trapper". Pay 5 coins to see resource quality in that region. Dark wooden posts mark region borders where quality changes.' },
            { id: 54, title: 'Sell quality 100 items to your market', description: 'Find a region with quality 100 resources using trappers. Harvest or have workers deliver Q100 materials to your market. The merchant ship takes the highest quality items first.' },
            { id: 55, title: 'Earn influence', description: 'When a merchant ship takes a quality 100 item from your market, you earn 1 influence. Ships only take items when there are more than 10 of a type in your market - the ship takes the surplus, highest quality first.' },
            // === Secure the Inland Route (56-61) — NEW ===
            { id: 56, title: 'Build an outpost', description: 'You need 1 plank. Build an outpost between your base and the inland wilderness. Outposts give a height advantage for shooting - better accuracy and longer range.' },
            { id: 57, title: 'Recruit outpost militia', description: 'Stand near your outpost and click "Spawn Militia" (costs 1 influence). The militia soldier shoots from the elevated position with better accuracy and range, defending against bandits and bears.' },
            { id: 58, title: 'Build a tent', description: 'You need 1 plank, 1 rope, and 1 fabric. Build a tent deeper inland, past your outpost. Tents let you request militia to defend the area and have shared 10x10 storage for supplies.' },
            { id: 59, title: 'Recruit tent militia', description: 'Station militia at your inland tent (1 influence). The soldier patrols nearby, defending against bandits, bears, and enemy faction players. Militia don\'t respawn if killed - you\'ll need to spend another influence to replace them.' },
            { id: 60, title: 'Get a horse', description: 'Buy a horse from the market. Horses are restocked by merchant ships. They make the journey between your coastal base and inland outposts much faster.' },
            { id: 61, title: 'Mount the horse', description: 'Walk near the horse and click "Mount Horse". Use WASD to ride. Horses are much faster than walking, especially on roads.' },
            // === Combat (62-68) — NEW ===
            { id: 62, title: 'Buy a rifle', description: 'Go to your market and buy a rifle. Drag it to the sling slot next to the "Backpack" label - this saves 10 inventory slots. Rifles and ammo are restocked by merchant ships.' },
            { id: 63, title: 'Buy ammunition', description: 'Buy ammo from the market. Keep ammo in your backpack. You need both a rifle and ammo to fight - each shot uses 1 ammo.' },
            { id: 64, title: 'Kill a bandit', description: 'Get within range of a bandit and you\'ll aim and fire automatically. Higher ground improves your accuracy and range.' },
            { id: 65, title: 'Climb an outpost', description: 'Stand near an outpost and click "Climb". You can shoot from up here with better accuracy and range. Click "Climb Down" to come down.' },
            { id: 66, title: 'Hunt a deer', description: 'Find a deer in the wild. Your rifle auto-targets it when in range. Deer flee when shot, so get close.' },
            { id: 67, title: 'Harvest the deer', description: 'Stand near the dead deer and click "Harvest Deer". You\'ll get raw meat and animal skin. Animal skins can be combined into fabric.' },
            { id: 68, title: 'Cook raw meat', description: 'Put raw meat and firewood in a campfire or house. Cooked meat is the most nutritious food in the game.' },
            // === The Iron Expedition (69-72) — NEW ===
            { id: 69, title: 'Mine iron', description: 'Iron only spawns at high elevations in the mountains. Look for dark, heavy-looking rocks above the tree line. Iron is rare - use trappers to find the best regions.' },
            { id: 70, title: 'Sell iron at the market', description: 'Open the market and sell your iron. Stocking the market with materials is how you attract trade ships and supply worker buildings like the ironworks.' },
            { id: 71, title: 'Build an ironworks', description: 'Same materials as other worker buildings (1 plank, 1 chiseled limestone, 1 tile). Build within 20 units of your market and sell to a proprietor. The ironworks smelts iron ore into iron ingots using firewood.' },
            { id: 72, title: 'Build a blacksmith', description: 'Same materials. Build within 20 units of your market and sell to a proprietor. The blacksmith turns iron ingots into parts using firewood. Parts are needed for ships and artillery.' },
            // === Water Upgrades (73) — NEW ===
            { id: 73, title: 'Build a sailboat', description: 'You need 1 plank, 1 rope, and 1 fabric. Sailboats are faster than rowboats and can carry 1 crate on deck for transporting materials along the coast.' },
            // === Social (74-75) — NEW ===
            { id: 74, title: 'Add a friend', description: 'Open the Friends panel (top-left). Type a player\'s username and send a request. Friends show online status and you can spawn near same-faction friends.' },
            { id: 75, title: 'Repair a structure', description: 'Stand near a damaged structure you own with a hammer in your backpack. Click "Repair" to restore its durability. Unrepaired structures eventually become ruins.' },
            // === Artillery & Ships (76-82) — NEW ===
            { id: 76, title: 'Build artillery', description: 'You need 1 plank and 1 parts (from the blacksmith). Artillery fires at much longer range than rifles (28 units).' },
            { id: 77, title: 'Tow artillery with a horse', description: 'Mount your horse, then approach the artillery and click "Attach Artillery". Artillery can only be towed by horse.' },
            { id: 78, title: 'Man the artillery', description: 'Dismount, then stand behind the artillery and click "Man Artillery". Use A/D to aim.' },
            { id: 79, title: 'Load shells into artillery', description: 'Buy shells from the market (restocked by merchant ships). Open the artillery inventory and drag shells in. Shells are consumed when firing.' },
            { id: 80, title: 'Fire the artillery', description: 'Press the fire button. 12-second cooldown between shots. Each shot uses 1 shell. The cannon fires at the nearest enemy in your aim direction. You can also station militia at artillery (1 influence) to have them operate it automatically.' },
            { id: 81, title: 'Build a ship', description: 'You need 1 plank, 1 rope, 1 parts, and 1 fabric. Ships are the largest vessels - they can carry 4 crates, 2 artillery, and 3 horses.' },
            { id: 82, title: 'Board and pilot a ship', description: 'Walk near the ship and click "Board Ship". Use WASD to steer. You can load crates, artillery, and horses onto the deck for transport across the sea.' }
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
            // Migrate old task IDs (21-35 shifted to 26-40 in tutorial expansion)
            const ID_MIGRATION = { 21: 26, 22: 27, 23: 28, 24: 29, 25: 30, 26: 31, 27: 32, 28: 33, 29: 34, 30: 35, 31: 36, 32: 37, 33: 38, 34: 39, 35: 40 };
            const migrated = completions.map(id => ID_MIGRATION[id] || id);
            this.completedTasks = new Set(migrated);
        }

        // Auto-complete registration tasks if player is logged in (they've already done this)
        if (!this.gameState.isGuest) {
            const hadAccountTasks = this.completedTasks.has(26);
            this.completedTasks.add(26); // Create an account
            this.completedTasks.add(27); // Enter your details
            this.completedTasks.add(28); // Account created!
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
        if (!inventory || !inventory.items) return;

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

        const type = itemType?.toLowerCase();

        // Tasks 1, 2, 6: Vine gathering (cumulative tracking)
        if (type === 'vines') {
            this.completeTask(1);
            this.totalVinesGathered++;
            if (this.totalVinesGathered >= 2) this.completeTask(2);
            if (this.totalVinesGathered >= 6) this.completeTask(6);
        }

        // Tasks 4, 7, 8: Make rope
        if (type === 'rope') {
            this.completeTask(4);
            this.completeTask(7);
            if (count >= 2) this.completeTask(8);
        }

        if (type === 'improvisedtool') this.completeTask(5);
        if (type?.endsWith('plank')) this.completeTask(18);
        if (type === 'fishingnet') this.completeTask(9);
        if (type === 'fish') this.completeTask(11);
        if (type === 'limestone') this.completeTask(12);
        if (type?.includes('firewood')) this.completeTask(15);
        if (type === 'cookedfish') this.completeTask(17);
        if (type === 'apple') this.completeTask(30);
        if (type === 'vegetables') this.completeTask(31);
        if (type === 'roastedvegetables') this.completeTask(32);
        if (type === 'clay') this.completeTask(34);

        // Task 35: Cook clay into tile + Task 44: Take tiles from tileworks
        if (type === 'tile') {
            this.completeTask(35);
            if (this.completedTasks.has(43)) this.completeTask(44);
        }

        // New item types
        if (type === 'hempfiber') this.completeTask(50);
        if (type === 'fabric') this.completeTask(51);
        if (type === 'iron') this.completeTask(69);
        if (type === 'rawmeat') this.completeTask(67);
        if (type === 'cookedmeat') this.completeTask(68);
    }

    onActionComplete(actionType, harvestType) {
        if (this.isClosed) return;
        if (actionType === 'chop') this.completeTask(14);
        if (actionType === 'build_campfire' ||
            (actionType === 'build' && harvestType === 'campfire')) {
            this.completeTask(13);
        }
    }

    onInventoryOpened() {
        if (this.isClosed) return;
        this.completeTask(3);
    }

    onSettingsOpened() {
        if (this.isClosed) return;
        this.completeTask(29);
    }

    onFishButtonClicked() {
        if (this.isClosed) return;
        this.completeTask(10);
    }

    onItemMovedToCrate(itemType, structureType) {
        if (this.isClosed) return;
        if (structureType === 'campfire') this.completeTask(16);
        if (structureType === 'tileworks') this.completeTask(43);
        if (structureType === 'artillery' && itemType === 'shell') this.completeTask(79);
    }

    onStructurePlaced(structureType) {
        if (this.isClosed) return;
        const taskMap = {
            crate: 19, cart: 21, boat: 24,
            dock: 33, market: 36, house: 37, woodcutter: 38,
            tileworks: 41, miner: 45, stonemason: 46, gardener: 47,
            outpost: 56, tent: 58,
            ironworks: 71, blacksmith: 72, sailboat: 73,
            artillery: 76, ship2: 81
        };
        const taskId = taskMap[structureType];
        if (taskId) this.completeTask(taskId);
    }

    onStructureInventoryOpened(structureType) {
        if (this.isClosed) return;
        if (structureType === 'crate') this.completeTask(20);
        if (structureType === 'tileworks') this.completeTask(42);
    }

    onMerchantShipsEnabled() {
        if (this.isClosed) return;
        this.completeTask(39);
    }

    onCreateAccountClicked() {
        if (this.isClosed) return;
        this.completeTask(26);
    }

    onRegisterFormShown() {
        if (this.isClosed) return;
        this.completeTask(27);
    }

    onAccountCreated() {
        if (this.isClosed) return;
        this.completeTask(28);
    }

    onTalkToMerchant() {
        if (this.isClosed) return;
        this.completeTask(40);
    }

    // ========== New Event Handlers (tutorial expansion) ==========

    onCartAttached() {
        if (this.isClosed) return;
        this.completeTask(22);
    }

    onCrateLoaded() {
        if (this.isClosed) return;
        this.completeTask(23);
    }

    onVehicleBoarded(vehicleType) {
        if (this.isClosed) return;
        if (vehicleType === 'boat') this.completeTask(25);
        if (vehicleType === 'horse') this.completeTask(61);
        if (vehicleType === 'ship2') this.completeTask(82);
    }

    onRoadPlaced() {
        if (this.isClosed) return;
        this.completeTask(48);
    }

    onRoadWalked() {
        if (this.isClosed) return;
        this.completeTask(49);
    }

    onFactionJoined() {
        if (this.isClosed) return;
        this.completeTask(52);
    }

    onTrapperTalkedTo() {
        if (this.isClosed) return;
        this.completeTask(53);
    }

    onMarketBuy(itemType) {
        if (this.isClosed) return;
        if (itemType === 'horse') this.completeTask(60);
        if (itemType === 'rifle') this.completeTask(62);
        if (itemType === 'ammo') this.completeTask(63);
    }

    onMarketSell(itemType, quality) {
        if (this.isClosed) return;
        if (quality >= 100) this.completeTask(54);
        if (itemType === 'iron') this.completeTask(70);
    }

    onInfluenceEarned() {
        if (this.isClosed) return;
        this.completeTask(55);
    }

    onMilitiaRecruited(structureType) {
        if (this.isClosed) return;
        if (structureType === 'outpost') this.completeTask(57);
        if (structureType === 'tent') this.completeTask(59);
    }

    onEnemyKilled(enemyType) {
        if (this.isClosed) return;
        if (enemyType === 'bandit') this.completeTask(64);
        if (enemyType === 'deer') this.completeTask(66);
    }

    onOutpostClimbed() {
        if (this.isClosed) return;
        this.completeTask(65);
    }

    onFriendRequestSent() {
        if (this.isClosed) return;
        this.completeTask(74);
    }

    onStructureRepaired() {
        if (this.isClosed) return;
        this.completeTask(75);
    }

    onArtilleryTowed() {
        if (this.isClosed) return;
        this.completeTask(77);
    }

    onArtilleryManned() {
        if (this.isClosed) return;
        this.completeTask(78);
    }

    onArtilleryFired() {
        if (this.isClosed) return;
        this.completeTask(80);
    }

    // ========== UI Methods ==========

    show() {
        if (this.isClosed) return;
        // Auto-complete account tasks for logged-in players before rendering
        if (!this.gameState.isGuest) {
            this.completedTasks.add(26);
            this.completedTasks.add(27);
            this.completedTasks.add(28);
        }
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

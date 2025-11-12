# Fishing System - Complete Implementation Guide

## System Requirements (Confirmed)

### Fishing Net
- **Type**: `fishingnet`
- **Size**: 2x2 in inventory
- **Quality**: Random (10-100) when purchased/found
- **Max Durability**: 100
- **Durability Formula**: `Math.ceil((10 * fishQuality) / netQuality)`
  - Uses universal tool durability system
  - Better nets last longer
  - Higher quality fish wear nets more

### Fish Item
- **Type**: `fish`
- **Size**: 1x1 in inventory
- **Quality Formula**: `baseFishQuality * (netQuality / 100)`
  - Base fish quality: Random 10-100
  - Net quality acts as percentage multiplier
  - Example: Base Q80 fish × Q50 net = Q40 fish
- **Durability Formula**: `Math.floor(30 * (fishQuality / 100))`
  - Used for food/spoilage system
  - Example: Q50 fish = 15 durability

### Catch Success Rate
- **Formula**: Net Quality = Catch Percentage
  - Q100 net = 100% catch rate
  - Q50 net = 50% catch rate
  - Q10 net = 10% catch rate
- **On Failure**: No fish, no net durability loss, but cooldown still applies
- **On Success**: Fish added to inventory, net loses durability

### Fishing Location
- **Must be on shore**: Player on land (height >= 1.02), water nearby
- **Detection Range**: 0.75 units (same as other actions)
- **Why shore only**: Player can currently walk into water, so must fish from land

### Assets
- ✅ Textures exist in `public/items/`:
  - net.png, Rnet.png
  - fish.png, Rfish.png

---

## Implementation Steps

### PHASE 1: Configuration (config.js)

**File**: `public/config.js`

Add fishing net to market (line ~527):
```javascript
// Tools section
fishingnet: { buyPrice: 100, sellPrice: 70, minQuantity: 0, maxQuantity: 20 },
```

Add raw fish to market (line ~521):
```javascript
// Food section
fish: { buyPrice: 15, sellPrice: 10, minQuantity: 0, maxQuantity: 150 },
```

---

### PHASE 2: Game State (GameState.js)

**File**: `public/core/GameState.js`

Add after line ~32 (after `nearestObject`):
```javascript
// Shore detection for fishing
this.nearWater = false;        // True when on shore (land near water)
this.waterDirection = null;    // Optional: angle to water from player
```

---

### PHASE 3: Shore Detection (game.js)

**File**: `public/game.js`

Add in `checkProximityToObjects()` method, after existing proximity checks (around line 1531):

```javascript
// FISHING: Detect if player is on shore (land adjacent to water)
const playerHeight = this.terrainRenderer.getTerrainHeightAt(
    this.playerObject.position.x,
    this.playerObject.position.z
);

this.gameState.nearWater = false;

// Only check for nearby water if player is on land
if (playerHeight >= CONFIG.WATER.LEVEL) {
    // Sample 8 points in circle around player to find water
    const checkRadius = 0.75; // Same as other interaction radius
    const numSamples = 8;

    for (let i = 0; i < numSamples; i++) {
        const angle = (i / numSamples) * Math.PI * 2;
        const checkX = this.playerObject.position.x + Math.cos(angle) * checkRadius;
        const checkZ = this.playerObject.position.z + Math.sin(angle) * checkRadius;

        const checkHeight = this.terrainRenderer.getTerrainHeightAt(checkX, checkZ);

        // Found water nearby!
        if (checkHeight < CONFIG.WATER.LEVEL) {
            this.gameState.nearWater = true;
            this.gameState.waterDirection = angle; // Store for optional facing
            break;
        }
    }
}
```

Update UI button states (around line 1550):
```javascript
// Update existing UI call to include fishing net check
const hasAxe = this.hasToolWithDurability('axe');
const hasSaw = this.hasToolWithDurability('saw');
const hasHammer = this.hasToolWithDurability('hammer');
const hasFishingNet = this.hasToolWithDurability('fishingnet'); // ADD THIS
const isOnCooldown = this.gameState.harvestCooldown && this.gameState.harvestCooldown.endTime > Date.now();

ui.updateButtonStates(
    this.gameState.isInChunk,
    this.gameState.nearestObject,
    hasAxe,
    hasSaw,
    isOnCooldown,
    this.gameState.nearestConstructionSite,
    this.gameState.isMoving,
    this.gameState.nearestStructure,
    hasHammer,
    this.gameState.nearWater,      // ADD THIS
    hasFishingNet                   // ADD THIS
);
```

---

### PHASE 4: Fishing Actions (ResourceManager.js)

**File**: `public/systems/ResourceManager.js`

**4a. Add `startFishingAction()` method** (after `startHarvestAction()`, around line 150):

```javascript
/**
 * Start fishing action to catch fish from shore
 */
startFishingAction() {
    // Check if cooldown is active
    if (this.gameState.harvestCooldown) {
        const remaining = this.gameState.harvestCooldown.endTime - Date.now();
        if (remaining > 0) {
            ui.updateStatus(`⏳ Rest needed: ${Math.ceil(remaining / 1000)}s`);
            return;
        } else {
            this.gameState.harvestCooldown = null;
        }
    }

    // Check for fishing net with durability
    if (!this.hasToolWithDurability('fishingnet')) {
        console.warn('Cannot fish: missing fishing net with durability');
        ui.updateStatus('⚠️ Need fishing net');
        return;
    }

    // Optional: Face the water direction
    if (this.game && this.game.playerObject && this.gameState.waterDirection !== null) {
        this.game.playerObject.rotation.y = this.gameState.waterDirection;
    }

    // Start fishing action
    this.gameState.activeAction = {
        object: null, // No world object for fishing
        startTime: Date.now(),
        duration: CONFIG.ACTIONS.HARVEST_LOG_DURATION, // 10 seconds
        actionType: 'fishing'
    };

    // Play sound (reuse axe sound for now)
    if (this.audioManager) {
        const sound = this.audioManager.playAxeSound();
        this.gameState.activeAction.sound = sound;
    }

    // Start chopping animation
    if (this.animationMixer && this.choppingAction) {
        if (this.game && this.game.animationAction) {
            this.game.animationAction.stop();
        }
        this.choppingAction.reset();
        this.choppingAction.play();
    }

    // Broadcast fishing action to peers
    this.networkManager.broadcastP2P({
        type: 'player_fishing',
        payload: {
            startTime: Date.now(),
            duration: CONFIG.ACTIONS.HARVEST_LOG_DURATION
        }
    });

    // Broadcast sound to peers
    this.networkManager.broadcastP2P({
        type: 'player_sound',
        payload: {
            soundType: 'axe', // Using axe sound for fishing
            startTime: Date.now()
        }
    });

    ui.updateStatus('🎣 Fishing...');
}
```

**4b. Add `completeFishingAction()` method** (after `completeHarvestAction()`, around line 428):

```javascript
/**
 * Complete fishing action - roll for catch success and create fish
 */
completeFishingAction() {
    // Find fishing net in inventory
    const net = this.gameState.inventory.items.find(item =>
        item.type === 'fishingnet' && item.durability > 0
    );

    if (!net) {
        ui.updateStatusLine1('⚠️ No fishing net!', 3000);
        this.startHarvestCooldown();
        return;
    }

    // Catch success rate = net quality as percentage
    const catchChance = net.quality; // 1-100
    const roll = Math.random() * 100; // 0-100

    if (roll > catchChance) {
        // Failed to catch fish
        ui.updateStatusLine1('❌ Nothing caught!', 3000);
        this.startHarvestCooldown();
        return;
    }

    // SUCCESS: Caught a fish!
    // Generate random base fish quality (10-100)
    const baseFishQuality = Math.floor(Math.random() * 91) + 10; // 10 to 100

    // Apply net quality multiplier
    const finalFishQuality = Math.floor(baseFishQuality * (net.quality / 100));

    // Calculate fish durability based on quality
    const fishDurability = Math.floor(30 * (finalFishQuality / 100));

    // UNIVERSAL TOOL DURABILITY SYSTEM
    // Formula: Durability Loss = (10 * resourceQuality) / toolQuality
    // For fishing: resource = fish quality
    const durabilityLoss = Math.ceil((10 * finalFishQuality) / net.quality);
    net.durability = Math.max(0, net.durability - durabilityLoss);

    // Check if net broke
    if (net.durability === 0) {
        const netIndex = this.gameState.inventory.items.indexOf(net);
        if (netIndex > -1) {
            this.gameState.inventory.items.splice(netIndex, 1);
        }
        ui.updateStatus('⚠️ Your fishing net broke!');
        ui.updateStatusLine2('⚠️ Your fishing net broke!', 5000);
    }

    // Re-render inventory if open
    if (this.gameState.inventoryOpen) {
        this.inventoryUI.renderInventory();
    }

    // Create fish item
    const newFish = {
        id: `fish_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'fish',
        x: -1,
        y: -1,
        width: 1,
        height: 1,
        rotation: 0,
        quality: finalFishQuality,
        durability: fishDurability
    };

    // Try to add to inventory
    if (this.game && this.game.tryAddItemToInventory(newFish)) {
        ui.updateStatusLine1(`✅ Caught fish (Q${finalFishQuality})`, 2000);

        // Re-render inventory if open
        if (this.gameState.inventoryOpen) {
            this.inventoryUI.renderInventory();
        }
    } else {
        ui.updateStatusLine1('⚠️ Inventory full!', 3000);
    }

    // Start cooldown
    this.startHarvestCooldown();
}
```

---

### PHASE 5: Game Action Handling (game.js)

**File**: `public/game.js`

Find the action completion handler (around line 700-900 where actions are checked).

Add fishing action handling in the game loop where other actions are completed:

```javascript
// Add this in the activeAction completion section
if (this.gameState.activeAction) {
    const elapsed = Date.now() - this.gameState.activeAction.startTime;

    // ... existing chopping/building/chiseling checks ...

    // FISHING: Check if fishing action is complete
    if (this.gameState.activeAction.actionType === 'fishing' &&
        elapsed >= this.gameState.activeAction.duration) {

        // Stop sound
        if (this.gameState.activeAction.sound) {
            this.gameState.activeAction.sound.stop();
        }

        // Stop animation
        if (this.animationMixer && this.choppingAction) {
            this.choppingAction.stop();
        }

        // Complete fishing action
        this.resourceManager.completeFishingAction();

        // Clear active action
        this.gameState.activeAction = null;
        ui.updateChoppingProgress(0);

        // Resume walk animation if moving
        if (this.gameState.isMoving && this.animationAction) {
            this.animationAction.play();
        }

        // Update proximity to refresh buttons
        this.checkProximityToObjects();
    }
}
```

Add fishing button handler (find where other action buttons are handled):

```javascript
// Add this where other button handlers are (chopping, harvesting, etc.)
document.getElementById('fishingBtn').addEventListener('click', () => {
    if (this.gameState.nearWater &&
        !this.gameState.activeAction &&
        !this.gameState.isMoving) {
        this.resourceManager.startFishingAction();
    }
});
```

---

### PHASE 6: UI Updates (ui.js & client.html)

**File**: `public/client.html`

Add fishing button to the button container (around where other action buttons are):

```html
<!-- Add after harvest/build buttons -->
<button id="fishingBtn" class="action-btn" style="display: none;">
    🎣 Fish
</button>
```

**File**: `public/ui.js`

Update `updateButtonStates()` function signature and logic:

```javascript
updateButtonStates(
    isInChunk,
    nearestObject,
    hasAxe,
    hasSaw,
    isOnCooldown,
    nearestConstructionSite,
    isMoving,
    nearestStructure,
    hasHammer,
    nearWater,          // ADD THIS PARAMETER
    hasFishingNet       // ADD THIS PARAMETER
) {
    // ... existing button logic ...

    // Fishing button - show when on shore with fishing net
    const fishingBtn = document.getElementById('fishingBtn');
    if (fishingBtn) {
        if (nearWater && hasFishingNet && !isOnCooldown && !isMoving) {
            fishingBtn.style.display = 'inline-block';
        } else {
            fishingBtn.style.display = 'none';
        }
    }
}
```

---

## Testing Checklist

### Basic Functionality
- [ ] Buy fishing net from market (should be 2x2 item)
- [ ] Walk to water's edge (shore)
- [ ] Verify fishing button appears when near water
- [ ] Click fishing button
- [ ] Verify 10 second action with progress bar
- [ ] Verify fish appears in inventory (1x1 item)
- [ ] Check fish quality is affected by net quality
- [ ] Check fish durability matches formula

### Net Durability
- [ ] Test with Q100 net - should lose ~10 durability per Q100 fish
- [ ] Test with Q50 net - should lose ~20 durability per Q100 fish
- [ ] Test net breaking (durability reaches 0)
- [ ] Verify broken net is removed from inventory

### Catch Success Rate
- [ ] Test with Q100 net - should always catch (100%)
- [ ] Test with Q50 net - should catch ~50% of time
- [ ] Test with Q10 net - should rarely catch (~10%)
- [ ] Verify "Nothing caught" message on failure
- [ ] Verify no net durability loss on failure

### Edge Cases
- [ ] Try fishing with inventory full
- [ ] Try fishing without a net
- [ ] Try fishing with broken net (0 durability)
- [ ] Try fishing while not near water
- [ ] Try fishing while in water (should not show button)
- [ ] Test cooldown between fishing attempts

### Multiplayer
- [ ] Test fishing with multiple players
- [ ] Verify fishing animation shows for other players
- [ ] Verify fishing sound plays for other players

---

## Summary of Changes

### Files Modified
1. ✅ `public/config.js` - Market prices for net and fish
2. ✅ `public/core/GameState.js` - Add nearWater state
3. ✅ `public/game.js` - Shore detection + action completion
4. ✅ `public/systems/ResourceManager.js` - Fishing actions
5. ✅ `public/ui.js` - Button state management
6. ✅ `public/client.html` - Fishing button HTML

### New Mechanics
- Shore detection (land adjacent to water)
- Catch success rate based on tool quality
- Net quality affects fish quality (multiplier)
- Universal durability system for nets
- Fish durability for food system (30 base)

### Reused Systems
- Existing animation (pickaxe/chopping)
- Existing sound (axe sound)
- Existing cooldown system (3 seconds)
- Existing progress bar
- Existing item texture system (./items/)
- Existing inventory system

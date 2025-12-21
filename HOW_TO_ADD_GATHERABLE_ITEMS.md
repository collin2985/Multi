# How to Add Gatherable Items

This guide explains how to add new gatherable item types (like mushrooms, vegetable seeds, tree seeds) to the game.

## Overview

Gatherable items are resources that players can collect through:
- **Random encounters** (10% chance when stopping on grass)
- **Instant gathering** (button click, no progress bar)
- **Chunk-based quality** (quality varies by location)
- **Market trading** (buy/sell at markets)
- **Building materials** (used in construction)

## Example: Vegetable Seeds

This guide uses "vegetable seeds" as a complete example of implementing a gatherable item.

---

## Step-by-Step Implementation

### **STEP 1: Add Quality Generator Offset**

**File:** `public/core/QualityGenerator.js`
**Location:** Lines 72-82 (RESOURCE_OFFSETS object)

Add a unique offset for your item's quality system:

```javascript
const RESOURCE_OFFSETS = {
    'grass': 0,
    'mushroom': 1000,
    'fir': 2000,
    'pine': 3000,
    'clay': 4000,
    'limestone': 5000,
    'sandstone': 6000,
    'apple': 7000,
    'fish': 8000,
    'vegetableseeds': 9000  // ADD YOUR ITEM HERE
};
```

**Why:** Each item type needs a unique offset (increments of 1000) so quality ranges vary independently per chunk.

---

### **STEP 2: Add Gathering Functions**

**File:** `public/systems/GrassGathering.js`
**Location:** After existing gathering functions (around line 267)

Add two functions:

**2a. Roll Function (10% chance check):**

```javascript
/**
 * Check if vegetable seeds button should appear (10% chance)
 * Called when player stops on grass (independent from mushroom roll)
 * @returns {boolean} - True if vegetable seeds button should appear
 */
rollForVegetableSeeds() {
    return Math.random() < 0.10; // 10% chance
}
```

**2b. Gathering Function (instant collection):**

```javascript
/**
 * Gather vegetable seeds instantly (no progress bar)
 * Called when player clicks "Gather Vegetable Seeds" button
 */
gatherVegetableSeeds() {
    if (!this.game || !this.game.playerObject) {
        console.error('GrassGathering: Cannot gather vegetable seeds - game or player not available');
        return;
    }

    // Get player position
    const playerX = this.game.playerObject.position.x;
    const playerZ = this.game.playerObject.position.z;

    // Get chunk coordinates and vegetable seeds quality
    const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(playerX, playerZ);
    const worldSeed = TERRAIN_CONFIG.TERRAIN.seed;
    const vegetableSeedsQuality = QualityGenerator.getQuality(worldSeed, chunkX, chunkZ, 'vegetableseeds');

    // Create vegetable seeds item (1x1 size)
    const newVegetableSeeds = {
        id: `vegetableseeds_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'vegetableseeds',
        x: -1, // Will be set when finding space in inventory
        y: -1,
        width: 1,
        height: 1,
        rotation: 0,
        quality: vegetableSeedsQuality,
        durability: 100 // Seeds don't decay
    };

    // Try to add to inventory
    if (this.game.tryAddItemToInventory(newVegetableSeeds)) {
        ui.updateStatusLine1(`✅ Gathered vegetable seeds (Q${vegetableSeedsQuality})`, 2000);

        // Re-render inventory if open
        if (this.gameState.inventoryOpen) {
            this.inventoryUI.renderInventory();
        }
    } else {
        ui.updateStatusLine1('⚠️ Inventory full!', 3000);
    }
}
```

**Key Properties:**
- `width: 1, height: 1` - 1x1 inventory slot
- `durability: 100` - No decay (use this for seeds/materials that don't degrade)
- `durability: X * (quality / 100)` - Use this for food items that decay based on quality

---

### **STEP 3: Add Market Prices**

**File:** `public/config.js`
**Location:** Lines 592-624 (CONFIG.MARKET.PRICES object)

Add your item to the market pricing:

```javascript
PRICES: {
    // ... existing items ...

    // Food
    apple: { buyPrice: 8, sellPrice: 5, minQuantity: 0, maxQuantity: 150 },
    vegetables: { buyPrice: 12, sellPrice: 8, minQuantity: 0, maxQuantity: 150 },
    roastedvegetables: { buyPrice: 18, sellPrice: 12, minQuantity: 0, maxQuantity: 150 },
    vegetableseeds: { buyPrice: 5, sellPrice: 3, minQuantity: 0, maxQuantity: 150 },  // ADD HERE

    // ... more items ...
}
```

**Parameters:**
- `buyPrice` - What players pay to buy from market
- `sellPrice` - What players receive when selling to market
- `minQuantity` - Minimum market stock (usually 0)
- `maxQuantity` - Maximum market stock (affects supply/demand pricing)

---

### **STEP 4: Add as Building Material (Optional)**

**File:** `public/config.js`
**Location:** Lines 428-464 (CONFIG.CONSTRUCTION.MATERIALS)

If your item is used in construction, add it as a material requirement:

```javascript
MATERIALS: {
    crate: {
        oakplank: 1
    },
    garden: {
        chiseledlimestone: 1,
        vegetableseeds: 1  // ADD HERE
    },
    // ... more structures ...
}
```

**Note:** The quality of building materials affects the final structure's quality through averaging.

---

### **STEP 5: Add Game State & Roll Logic**

**File:** `public/game.js`
**Location:** Around line 2820 (player stop detection)

Add the roll logic when player stops on grass:

```javascript
const justStopped = this.gameState.wasMoving && !this.gameState.isMoving;

// If player just stopped on grass, roll for mushroom (10% chance)
if (justStopped && this.gameState.onGrass) {
    this.gameState.mushroomAvailable = this.grassGathering.rollForMushroom();
}

// If player just stopped on grass, roll for vegetable seeds (10% chance, independent)
if (justStopped && this.gameState.onGrass) {
    this.gameState.vegetableSeedsAvailable = this.grassGathering.rollForVegetableSeeds();  // ADD THIS
}

// If player starts moving, disable mushroom and vegetable seeds
if (this.gameState.isMoving) {
    this.gameState.mushroomAvailable = false;
    this.gameState.vegetableSeedsAvailable = false;  // ADD THIS
}
```

---

### **STEP 6: Add Button Event Handler**

**File:** `public/game.js`
**Location:** Around line 540 (callback functions)

Add the callback function for the button:

```javascript
onGatherMushroom: () => {
    if (this.grassGathering && this.gameState.mushroomAvailable && !this.gameState.isMoving) {
        this.grassGathering.gatherMushroom();
        this.gameState.mushroomAvailable = false;
    }
},
onGatherVegetableSeeds: () => {  // ADD THIS
    if (this.grassGathering && this.gameState.vegetableSeedsAvailable && !this.gameState.isMoving) {
        this.grassGathering.gatherVegetableSeeds();
        this.gameState.vegetableSeedsAvailable = false;
    }
},
```

---

### **STEP 7: Add HTML Button**

**File:** `public/client.html`
**Location:** Around line 194 (action buttons)

Add the button element:

```html
<button id="gatherGrassBtn" style="display: none;">Gather Grass</button>
<button id="gatherMushroomBtn" style="display: none;">Gather Mushroom</button>
<button id="gatherVegetableSeedsBtn" style="display: none;">Gather Vegetable Seeds</button>  <!-- ADD THIS -->
<button id="gatherSeedsBtn" style="display: none;">Gather Seeds</button>
```

---

### **STEP 8: Wire Up Button Event Listener**

**File:** `public/ui.js`
**Location:** Around line 594 (setupButton calls)

Add the button setup:

```javascript
setupButton(document.getElementById('gatherMushroomBtn'), () => {
    callbacks.onGatherMushroom();
});

setupButton(document.getElementById('gatherVegetableSeedsBtn'), () => {  // ADD THIS
    callbacks.onGatherVegetableSeeds();
});

setupButton(document.getElementById('gatherSeedsBtn'), () => {
    callbacks.onGatherSeeds();
});
```

**CRITICAL:** Without this step, clicking the button will do nothing!

---

### **STEP 9: Add Button Display Logic**

**File:** `public/ui.js`
**Location:** Around line 390 (button visibility)

Add button display logic:

```javascript
// Mushroom gathering button
const gatherMushroomBtn = document.getElementById('gatherMushroomBtn');
if (gatherMushroomBtn) {
    const canGatherMushroom = mushroomAvailable && !isMoving;
    gatherMushroomBtn.style.display = canGatherMushroom ? 'inline-block' : 'none';
}

// Vegetable seeds gathering button  // ADD THIS BLOCK
const gatherVegetableSeedsBtn = document.getElementById('gatherVegetableSeedsBtn');
if (gatherVegetableSeedsBtn) {
    const canGatherVegetableSeeds = vegetableSeedsAvailable && !isMoving;
    gatherVegetableSeedsBtn.style.display = canGatherVegetableSeeds ? 'inline-block' : 'none';
}
```

---

### **STEP 10: Update Button State Function Signature**

**File:** `public/ui.js`
**Location:** Line 168 (updateButtonStates function)

Add parameter to function signature:

```javascript
updateButtonStates(
    isInChunk,
    nearestObject,
    hasAxe,
    hasSaw,
    isOnCooldown = false,
    nearestConstructionSite = null,
    isMoving = false,
    nearestStructure = null,
    hasHammer = false,
    nearWater = false,
    hasFishingNet = false,
    onGrass = false,
    mushroomAvailable = false,
    vegetableSeedsAvailable = false,  // ADD THIS
    seedsAvailable = false,
    seedTreeType = null,
    isClimbing = false,
    occupiedOutposts = null
) {
```

---

### **STEP 11: Update All Button State Calls**

**File:** `public/game.js`
**Location:** Search for all `ui.updateButtonStates(` calls (typically 5-6 locations)

Add your parameter to EVERY call:

```javascript
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
    this.gameState.nearWater,
    hasFishingNet,
    this.gameState.onGrass,
    this.gameState.mushroomAvailable,
    this.gameState.vegetableSeedsAvailable,  // ADD THIS
    this.gameState.seedsAvailable,
    this.gameState.seedTreeType,
    this.gameState.climbingState.isClimbing,
    this.occupiedOutposts
);
```

**Use Find & Replace:** Search for `mushroomAvailable,` and add your parameter after it in ALL occurrences.

---

### **STEP 12: Add Item Display Name (For Hover Text)**

**File:** `public/ui/InventoryUI.js`
**Location:** Around line 48 (getItemDisplayName function)

Add your item to the display names mapping:

```javascript
function getItemDisplayName(itemType) {
    const displayNames = {
        // Seeds
        'vegetableseeds': 'Vegetable Seeds',  // ADD THIS
        'oakseed': 'Oak Seed',
        'pineseed': 'Pine Seed',
        // ... more items ...
    };

    return displayNames[itemType] || itemType;
}
```

**Why:** Without this, "vegetableseeds" displays as "Vegetableseeds" in tooltips.

**If getItemDisplayName doesn't exist:** Create it following the pattern in Step 12a below.

---

### **STEP 12a: Create Display Name Function (If Missing)**

If `getItemDisplayName` doesn't exist in `public/ui/InventoryUI.js`, add it after the existing helper functions (around line 46):

```javascript
/**
 * Get display name for item types
 * Maps item type IDs to proper display names for tooltips
 * @param {string} itemType - Item type (e.g., 'vegetableseeds', 'mushroom')
 * @returns {string} Display name (e.g., 'Vegetable Seeds', 'Mushroom')
 */
function getItemDisplayName(itemType) {
    const displayNames = {
        // Seeds
        'vegetableseeds': 'Vegetable Seeds',
        'oakseed': 'Oak Seed',
        'pineseed': 'Pine Seed',
        'firseed': 'Fir Seed',
        'cypressseed': 'Cypress Seed',
        'appleseed': 'Apple Seed',

        // Food items
        'mushroom': 'Mushroom',
        'apple': 'Apple',
        'vegetables': 'Vegetables',
        'roastedvegetables': 'Roasted Vegetables',
        'fish': 'Fish',
        'cookedfish': 'Cooked Fish',
        'cookedmeat': 'Cooked Meat',

        // Materials
        'grass': 'Grass',
        'rope': 'Rope',
        'limestone': 'Limestone',
        'sandstone': 'Sandstone',
        'clay': 'Clay',
        'chiseledlimestone': 'Chiseled Limestone',
        'chiseledsandstone': 'Chiseled Sandstone',

        // Planks
        'oakplank': 'Oak Plank',
        'pineplank': 'Pine Plank',
        'firplank': 'Fir Plank',
        'cypressplank': 'Cypress Plank',

        // Firewood
        'oakfirewood': 'Oak Firewood',
        'pinefirewood': 'Pine Firewood',
        'firfirewood': 'Fir Firewood',
        'cypressfirewood': 'Cypress Firewood',

        // Tools
        'axe': 'Axe',
        'saw': 'Saw',
        'pickaxe': 'Pickaxe',
        'hammer': 'Hammer',
        'chisel': 'Chisel',
        'fishingnet': 'Fishing Net'
    };

    return displayNames[itemType] || itemType;
}
```

Then update the `showTooltip` function (around line 252):

**Change from:**
```javascript
titleEl.textContent = item.type;
```

**Change to:**
```javascript
titleEl.textContent = getItemDisplayName(item.type);
```

---

### **STEP 13: Add Item Icons**

**Directory:** `public/items/`

Create two PNG files:
1. `vegetableseeds.png` - Normal orientation (64x64 pixels recommended)
2. `Rvegetableseeds.png` - Rotated 90° version (for rotated inventory slots)

**Note:** The 'R' prefix indicates the rotated version.

---

## Summary Checklist

Use this checklist when adding a new gatherable item:

- [ ] **Step 1:** Add quality offset to `QualityGenerator.js`
- [ ] **Step 2:** Add roll and gather functions to `GrassGathering.js`
- [ ] **Step 3:** Add market prices to `config.js` (PRICES)
- [ ] **Step 4:** (Optional) Add as building material to `config.js` (MATERIALS)
- [ ] **Step 5:** Add game state & roll logic to `game.js` (stop detection)
- [ ] **Step 6:** Add button callback to `game.js` (event handler)
- [ ] **Step 7:** Add HTML button to `client.html`
- [ ] **Step 8:** Wire up button listener in `ui.js` (setupButton)
- [ ] **Step 9:** Add button display logic to `ui.js` (visibility)
- [ ] **Step 10:** Update `updateButtonStates()` signature in `ui.js`
- [ ] **Step 11:** Update ALL `updateButtonStates()` calls in `game.js`
- [ ] **Step 12:** Add display name to `InventoryUI.js` (getItemDisplayName)
- [ ] **Step 13:** Create item icons (normal + rotated versions)

---

## Common Patterns

### Durability Values

- **Seeds/Materials (no decay):** `durability: 100`
- **Food items (quality-based):** `durability: baseDurability * (quality / 100)`
  - Example: `durability: 5 * (quality / 100)` for mushrooms

### Quality Offsets

Always increment by 1000 to avoid overlap:
- grass: 0
- mushroom: 1000
- vegetableseeds: 9000
- **Your new item:** Find the highest offset and add 1000

### Independent vs. Shared Rolls

- **Independent:** Each item has its own roll (can get multiple items from one stop)
  ```javascript
  this.gameState.mushroomAvailable = this.grassGathering.rollForMushroom();
  this.gameState.vegetableSeedsAvailable = this.grassGathering.rollForVegetableSeeds();
  ```

- **Shared:** One roll determines which item appears (mutually exclusive)
  ```javascript
  const roll = Math.random();
  if (roll < 0.10) {
      this.gameState.mushroomAvailable = true;
  } else if (roll < 0.20) {
      this.gameState.vegetableSeedsAvailable = true;
  }
  ```

---

## Testing Your Implementation

1. **Start the game** and walk onto grass terrain
2. **Stop moving** - your item button should appear ~10% of the time
3. **Click the button** - item should be added to inventory
4. **Hover over item** - tooltip should show correct display name
5. **Check market** - item should be buyable/sellable at configured prices
6. **Build structure** (if applicable) - should require your item as material

---

## Troubleshooting

### Button doesn't appear
- Check `gameState.onGrass` is true when on grass
- Verify roll function returns boolean
- Check button display logic in `ui.js`

### Button appears but does nothing when clicked
- **Most common issue:** Missing `setupButton()` call in `ui.js` (Step 8)
- Verify callback function exists in `game.js`
- Check console for JavaScript errors

### Tooltip shows wrong name
- Add item to `getItemDisplayName()` in `InventoryUI.js`
- Verify function is called in `showTooltip()`

### Item doesn't appear in market
- Add to `CONFIG.MARKET.PRICES` in `config.js`
- Ensure spelling matches exactly (case-sensitive)

### Quality doesn't vary by chunk
- Add unique offset to `RESOURCE_OFFSETS`
- Verify offset is used in `QualityGenerator.getQuality()` call

---

## Related Documentation

- `HOW_TO_ADD_STRUCTURES.md` - Guide for adding buildable structures
- `TREE_OBJECT_SYSTEMS.md` - Documentation on tree and resource objects
- `TIME_TRACKING_SYSTEM.md` - Time-based spawning systems

---

**Last Updated:** 2025-01-24
**Example Implementation:** Vegetable Seeds (all 13 steps)

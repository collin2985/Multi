# Ironworks Implementation Plan

This document outlines the complete implementation steps for adding an Ironworks structure that processes iron into iron ingots.

## Overview

**Ironworks** is a production structure similar to Tileworks, with these key differences:
- **Single centered smoke source** (not 2 at corners like tileworks)
- **Processes iron into ironingots** (exclusive recipe - cannot be done at campfire/house)
- **Restricted inventory** - only accepts: `iron`, `firewood` (all types), `ironingot`
- **Decay** - Works like all structures: quality inherited from averaged build materials, durability decreases over time based on quality

---

## Prerequisites

**Existing Assets (ALL VERIFIED PRESENT):**
- `public/items/ironingot.png` - Already exists (3KB)
- `public/models/ironworks.glb` - 3D model (143KB)
- `public/models/ironworks.png` - Model texture (43KB)
- `public/structures/ironworks.png` - Build menu icon (10KB)

---

## Gap Analysis Findings (Added 2024-12)

The following gaps were identified during code analysis and have been addressed in this plan:

### Critical Fixes Added
| Issue | Fix | Location |
|-------|-----|----------|
| `handleProcessingComplete` only routed to tileworks | Added structureType check for ironworks | Step 4.6 |
| No server-side inventory filtering call | Added filter + security logging | Step 4.5 |
| EffectManager.update() missing ironworks smoke detection | Added detection without `_1/_2` suffix | Step 5.4 |
| Missing from `restrictedStructures` array | Added to navigation blocking | Step 8.3 |

### Clarifications Added
| Issue | Clarification |
|-------|---------------|
| IronworksSystem registration unclear | Uses property assignment, not constructor param (Step 4.1) |
| Decay behavior unspecified | Same as all structures: quality from materials, standard decay formula |
| Firewood consumption implicit | Uses same tick-based calculation as tileworks (automatic) |

### Verified Already Correct
- Iron is NOT in CookingSystem recipes (iron can only be processed in ironworks)
- Progress bar code is generic and will work for ironworks automatically
- Structure quality averaging happens in build completion (existing code)

---

## CRITICAL: Often-Missed Steps

These steps are frequently forgotten when adding new structures:

### 1. Model Loading (objects.js MODEL_CONFIGS)

**File:** `public/objects.js`
**Location:** In the MODEL_CONFIGS object (around line 300-360)

Every structure needs a model configuration entry or the model won't load:

```javascript
yourstructure: {
    path: './models/yourstructure.glb',
    heightRange: { min: 0, max: 0 },
    scaleRange: { min: 0, max: 0 },
    density: 0,
    category: 'structure'
},
```

**Without this entry, you'll see:** `Model yourstructure not loaded` error in console.

### 2. Server Construction Models (ServerConfig.js)

**File:** `server/ServerConfig.js`
**Location:** `CONSTRUCTION.CONSTRUCTION_MODELS` object (around line 67-74)

The server has its OWN copy of CONSTRUCTION_MODELS that must match the client config:

```javascript
CONSTRUCTION_MODELS: {
    market: '2x8construction',
    dock: '10x1construction',
    tileworks: '2x2construction',
    ironworks: '2x2construction',
    yourstructure: '2x2construction',  // ADD THIS for 2x2 structures
    // 1x1 structures use 'construction' (default, no entry needed)
}
```

**Construction site sizes:**
- `'construction'` - 1x1 structures (default if not listed)
- `'2x2construction'` - 2x2 structures
- `'2x8construction'` - Market
- `'10x1construction'` - Dock

**Without this entry for 2x2 structures:** The construction site will be wrong size (1x1 instead of 2x2).

---

## Implementation Steps

### PHASE 1: Implement the Ironingot Item

Before the Ironworks structure can work, the ironingot item must be registered in the game.

#### Step 1.1: Add to Public Config
**File:** `public/config.js`
**Location:** `CONFIG.MARKET.PRICES` object (around line 763-833)

```javascript
// Add in the PRICES object:
ironingot: { buyPrice: 8, sellPrice: 5, minQuantity: 0, maxQuantity: 300 },
```

#### Step 1.2: Add Display Name
**File:** `public/ui/InventoryHelpers.js`
**Location:** `getItemDisplayName()` function (around line 111-176)

```javascript
// Add to displayNames object:
'ironingot': 'Iron Ingot',
```

#### Step 1.3: Define Item Size
**File:** `public/ui/InventoryHelpers.js`
**Location:** `getItemSize()` function (around line 183-230)

```javascript
// Add to appropriate category (1x1 stackable materials):
// Either add to existing array or create new one
const metalMaterials = ['iron', 'ironingot'];
// Ensure it returns { width: 1, height: 1 }
```

#### Step 1.4: Add to Server Config
**File:** `server/ServerConfig.js`

**Location 1:** `MARKET.ALL_ITEMS` array (line 19-37)
```javascript
// Add to the list:
'ironingot',
```

**Location 2:** `SHIP_TRADING.BUY_MATERIALS` array (line 91-97)
```javascript
// Add to the list:
'ironingot',
```

**Location 3:** `SHIP_TRADING.PRICES` object (line 107-119)
```javascript
// Add:
ironingot: 5,
```

---

### PHASE 2: Create the IronworksSystem Server Module

This is the core processing system, modeled after TileworksSystem but with ironworks-specific logic.

#### Step 2.1: Create IronworksSystem.js
**File:** `server/IronworksSystem.js` (NEW FILE)

```javascript
/**
 * IronworksSystem - Handles iron to ironingot processing
 * Similar to TileworksSystem but with:
 * - Iron -> Ironingot recipe
 * - Inventory restriction (iron, firewood, ironingot only)
 */
class IronworksSystem {
    constructor(chunkManager, messageRouter, timeTrackerService) {
        this.chunkManager = chunkManager;
        this.messageRouter = messageRouter;
        this.timeTrackerService = timeTrackerService;
        this.serverTick = 0;

        // Processing duration in server ticks (1 tick = 1 second)
        this.PROCESSING_DURATION_TICKS = 60; // 1 minute

        // Recipes: input -> output
        // ONLY ironworks can do this - not campfire or house
        this.PROCESSING_RECIPES = {
            'iron': 'ironingot'
        };

        // Allowed items in ironworks inventory
        this.ALLOWED_ITEMS = [
            'iron',
            'ironingot',
            'oakfirewood',
            'pinefirewood',
            'firfirewood',
            'cypressfirewood',
            'applefirewood'
        ];
    }

    /**
     * Update server tick
     */
    setServerTick(tick) {
        this.serverTick = tick;
    }

    /**
     * Check if item type can be processed in ironworks
     */
    canBeProcessedItem(itemType) {
        return this.PROCESSING_RECIPES.hasOwnProperty(itemType);
    }

    /**
     * Check if item type is allowed in ironworks inventory
     */
    isItemAllowed(itemType) {
        return this.ALLOWED_ITEMS.some(allowed => {
            if (allowed === itemType) return true;
            // Handle firewood suffix matching
            if (itemType && itemType.endsWith('firewood')) return true;
            return false;
        });
    }

    /**
     * Filter inventory to only allowed items
     * Called when saving ironworks inventory
     */
    filterInventory(inventory) {
        if (!inventory || !Array.isArray(inventory.items)) {
            return { items: [] };
        }

        const filteredItems = inventory.items.filter(item => {
            if (!item || !item.type) return false;
            return this.isItemAllowed(item.type);
        });

        return { items: filteredItems };
    }

    /**
     * Check for processable items when inventory is saved
     */
    async checkForProcessableItems(ironworksId, chunkId, inventory) {
        if (!inventory || !Array.isArray(inventory.items)) {
            return;
        }

        // Check if firewood is present with durability
        const hasFirewood = inventory.items.some(item =>
            item.type && item.type.endsWith('firewood') && item.durability > 0
        );

        if (!hasFirewood) {
            return; // Can't process without fuel
        }

        // Find all iron items that aren't already processing
        for (let index = 0; index < inventory.items.length; index++) {
            const item = inventory.items[index];
            if (this.canBeProcessedItem(item.type) && !item.processingStartTick) {
                await this.startProcessing(ironworksId, item.id, index, chunkId);
            }
        }
    }

    /**
     * Start processing an item
     */
    async startProcessing(ironworksId, itemId, itemIndex, chunkId) {
        try {
            const chunkData = await this.chunkManager.loadChunk(chunkId);
            if (!chunkData) return;

            const ironworksIndex = chunkData.objectChanges.findIndex(
                obj => obj.id === ironworksId && obj.action === 'add'
            );
            if (ironworksIndex === -1) return;

            const ironworks = chunkData.objectChanges[ironworksIndex];
            if (!ironworks.inventory || !ironworks.inventory.items) return;

            const item = ironworks.inventory.items.find(i => i.id === itemId);
            if (!item || item.processingStartTick) return;

            // Stamp processing start
            item.processingStartTick = this.serverTick;
            item.processingDurationTicks = this.PROCESSING_DURATION_TICKS;

            // Clear any legacy cooking fields
            delete item.cookingStartTick;
            delete item.cookingDurationTicks;
            delete item.cookingStartTime;
            delete item.estimatedCompletionTime;

            await this.chunkManager.saveChunk(chunkId);

            // Broadcast to nearby players
            this.broadcastInventoryUpdate(ironworksId, chunkId, ironworks.inventory);

            console.log(`[IRONWORKS] Started processing ${item.type} (${itemId})`);
        } catch (error) {
            console.error('[IRONWORKS] Error starting processing:', error);
        }
    }

    /**
     * Complete processing - transform iron to ironingot
     */
    async completeProcessing(ironworksId, itemId, chunkId) {
        try {
            const chunkData = await this.chunkManager.loadChunk(chunkId);
            if (!chunkData) {
                return { success: false, error: 'Chunk not found' };
            }

            const ironworksIndex = chunkData.objectChanges.findIndex(
                obj => obj.id === ironworksId && obj.action === 'add'
            );
            if (ironworksIndex === -1) {
                return { success: false, error: 'Ironworks not found' };
            }

            const ironworks = chunkData.objectChanges[ironworksIndex];
            if (!ironworks.inventory || !ironworks.inventory.items) {
                return { success: false, error: 'Ironworks has no inventory' };
            }

            const itemIndex = ironworks.inventory.items.findIndex(i => i.id === itemId);
            if (itemIndex === -1) {
                return { success: false, error: 'Item not found' };
            }

            const item = ironworks.inventory.items[itemIndex];

            // Validate processing was actually started
            if (!item.processingStartTick) {
                return { success: false, error: 'Item was not processing' };
            }

            // Validate enough time has passed (with 5 tick tolerance)
            const ticksElapsed = this.serverTick - item.processingStartTick;
            if (ticksElapsed < this.PROCESSING_DURATION_TICKS - 5) {
                return { success: false, error: 'Processing not complete' };
            }

            // Get output type
            const outputType = this.PROCESSING_RECIPES[item.type];
            if (!outputType) {
                return { success: false, error: 'Unknown input type' };
            }

            // Calculate quality (average of iron quality + ironworks quality)
            const inputQuality = item.quality || 50;
            const structureQuality = ironworks.quality || 50;
            const outputQuality = Math.round((inputQuality + structureQuality) / 2);

            // Create new item
            const processedItem = {
                id: `${outputType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: outputType,
                x: item.x,
                y: item.y,
                width: item.width || 1,
                height: item.height || 1,
                rotation: item.rotation || 0,
                quality: outputQuality,
                durability: 100
            };

            // Replace in inventory
            ironworks.inventory.items[itemIndex] = processedItem;

            await this.chunkManager.saveChunk(chunkId);

            // Broadcast update
            this.broadcastInventoryUpdate(ironworksId, chunkId, ironworks.inventory);

            console.log(`[IRONWORKS] Completed: ${item.type} -> ${outputType} (quality: ${outputQuality})`);

            return {
                success: true,
                processedType: outputType,
                processedItem: processedItem
            };
        } catch (error) {
            console.error('[IRONWORKS] Error completing processing:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Cancel processing for an item
     */
    async cancelProcessing(ironworksId, itemId, chunkId) {
        try {
            const chunkData = await this.chunkManager.loadChunk(chunkId);
            if (!chunkData) return;

            const ironworksIndex = chunkData.objectChanges.findIndex(
                obj => obj.id === ironworksId && obj.action === 'add'
            );
            if (ironworksIndex === -1) return;

            const ironworks = chunkData.objectChanges[ironworksIndex];
            if (!ironworks.inventory) return;

            const item = ironworks.inventory.items.find(i => i.id === itemId);
            if (!item) return;

            // Clear processing fields
            delete item.processingStartTick;
            delete item.processingDurationTicks;

            await this.chunkManager.saveChunk(chunkId);
            this.broadcastInventoryUpdate(ironworksId, chunkId, ironworks.inventory);

            console.log(`[IRONWORKS] Cancelled processing for ${item.type}`);
        } catch (error) {
            console.error('[IRONWORKS] Error cancelling processing:', error);
        }
    }

    /**
     * Cancel all processing when firewood runs out
     */
    async cancelAllProcessingForStructure(ironworksId, chunkId, inventory) {
        if (!inventory || !Array.isArray(inventory.items)) {
            return false;
        }

        let anyCancelled = false;

        for (const item of inventory.items) {
            if (item.processingStartTick) {
                delete item.processingStartTick;
                delete item.processingDurationTicks;
                anyCancelled = true;
            }
        }

        return anyCancelled;
    }

    /**
     * Broadcast inventory update to nearby players
     */
    broadcastInventoryUpdate(ironworksId, chunkId, inventory) {
        if (!this.messageRouter) return;

        const message = {
            type: 'crate_inventory_updated',
            payload: {
                crateId: ironworksId,
                chunkId: chunkId,
                inventory: inventory
            }
        };

        // Parse chunk coords and broadcast to 3x3 grid
        const parts = chunkId.replace('chunk_', '').split(',');
        const cx = parseInt(parts[0]);
        const cz = parseInt(parts[1]);

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const neighborChunkId = `chunk_${cx + dx},${cz + dz}`;
                this.messageRouter.broadcastToChunk(neighborChunkId, message);
            }
        }
    }
}

module.exports = IronworksSystem;
```

---

### PHASE 3: Register Ironworks Structure

#### Step 3.1: Add Model Configuration
**File:** `public/objects.js`
**Location:** In the MODEL_CONFIG object

```javascript
ironworks: {
    path: './models/ironworks.glb',
    heightRange: { min: 0, max: 0 },
    scaleRange: { min: 0, max: 0 },
    density: 0,
    category: 'structure'
},
```

#### Step 3.2: Add to Build Menu
**File:** `public/ui/BuildMenu.js`
**Location:** In the structures array (around line 71-230)

```javascript
{
    id: 'ironworks',
    type: 'ironworks',
    name: 'Ironworks',
    width: 1,
    height: 1,
    imagePath: './structures/ironworks.png',
    hasInventory: true
},
```

**Location 2:** Add preview scale (around line 660-690)
```javascript
} else if (structure.type === 'ironworks') {
    previewScale = 1.0;
    glowScale = 1.02;
}
```

#### Step 3.3: Add Grid Dimensions
**File:** `public/config.js`

**Location 1:** `GRID_DIMENSIONS` (around line 497)
```javascript
ironworks: { width: 2.0, depth: 2.0, height: 3.0 },
```

**Location 2:** `CONSTRUCTION_MODELS` (around line 556)
```javascript
ironworks: '2x2construction',
```

**Location 3:** `MATERIALS` (around line 602)
```javascript
ironworks: {
    oakplank: 1,
    chiseledlimestone: 1,
    iron: 1  // Requires iron to build
},
```

**Location 4:** `STRUCTURE_PROPERTIES` (around line 648)
```javascript
ironworks: {
    height: 3.0,
    inventorySize: { rows: 10, cols: 10 }
},
```

#### Step 3.4: Add Server Construction Config
**File:** `server/ServerConfig.js`
**Location:** `CONSTRUCTION_MODELS` object (if it exists)

```javascript
ironworks: '2x2construction',
```

---

### PHASE 4: Server-Side Message Handlers

#### Step 4.1: Register IronworksSystem in server.js
**File:** `server.js`
**Location:** After TileworksSystem initialization

**IMPORTANT:** IronworksSystem uses property assignment pattern (like tileworksSystem), NOT constructor parameter.

```javascript
// At top of file with other requires:
const IronworksSystem = require('./server/IronworksSystem');

// After tileworksSystem creation (around line 36-37):
const ironworksSystem = new IronworksSystem(
    chunkManager,
    messageRouter,
    timeTrackerService
);

// Assign to messageHandlers as property (NOT constructor param):
messageHandlers.ironworksSystem = ironworksSystem;

// In the tick update section (around line 72-73), add:
ironworksSystem.setServerTick(currentTick);
```

#### Step 4.2: Add Material Requirements
**File:** `server/MessageHandlers.js`
**Location:** `handlePlaceConstructionSite()` (around line 338)

```javascript
} else if (targetStructure === 'ironworks') {
    requiredMaterials = { 'oakplank': 1, 'chiseledlimestone': 1, 'iron': 1 };
}
```

#### Step 4.3: Add Build Completion Logic
**File:** `server/MessageHandlers.js`
**Location:** `handleBuildConstruction()` (around line 2129)

```javascript
} else if (constructionSite.targetStructure === 'ironworks') {
    structureScale = 1.0;
}
```

#### Step 4.4: Add Inventory Initialization
**File:** `server/MessageHandlers.js`
**Location 1:** Around line 2162
**Location 2:** Around line 2288

```javascript
// Add 'ironworks' to both conditionals:
if (constructionSite.targetStructure === 'house' ||
    constructionSite.targetStructure === 'garden' ||
    constructionSite.targetStructure === 'campfire' ||
    constructionSite.targetStructure === 'tileworks' ||
    constructionSite.targetStructure === 'ironworks') {
```

#### Step 4.5: Add Inventory Save Handler (CRITICAL - Server-Side Security)
**File:** `server/MessageHandlers.js`
**Location:** In `handleSaveCrateInventory()` (around line 2725, AFTER tileworks check, BEFORE saving)

**IMPORTANT:** This is server-side validation to prevent invalid items. The client shows a toast warning, but the server MUST filter/reject to prevent exploits.

```javascript
// Add AFTER tileworks check, BEFORE structure.inventory = inventory:
if (structure.name === 'ironworks' && this.ironworksSystem) {
    // Log any invalid items for security monitoring
    const invalidItems = inventory.items.filter(item =>
        item && item.type && !this.ironworksSystem.isItemAllowed(item.type)
    );
    if (invalidItems.length > 0) {
        console.warn(`[SECURITY] Ironworks inventory rejected invalid items: ${invalidItems.map(i => i.type).join(', ')}`);
    }

    // Filter inventory to only allowed items (iron, ironingot, firewood)
    const filteredInventory = this.ironworksSystem.filterInventory(inventory);
    inventory = filteredInventory;

    // Check for processable items and start processing
    this.ironworksSystem.checkForProcessableItems(crateId, chunkId, filteredInventory);
}

// Then save: structure.inventory = inventory;
```

#### Step 4.6: Update handleProcessingComplete in MessageHandlers.js (CRITICAL)
**File:** `server/MessageHandlers.js`
**Location:** `handleProcessingComplete()` method (around line 3183)

**CRITICAL:** The existing handler ONLY routes to tileworksSystem. You MUST add ironworks routing based on structureType.

```javascript
async handleProcessingComplete(ws, payload) {
    const { structureId, itemId, chunkId, structureType } = payload;

    console.log(`[handleProcessingComplete] ${structureType} processing complete for ${itemId}`);

    // Route to appropriate system based on structure type
    if (structureType === 'ironworks' && this.ironworksSystem) {
        const result = await this.ironworksSystem.completeProcessing(structureId, itemId, chunkId);
        if (!result.success) {
            console.warn(`[handleProcessingComplete] Ironworks processing failed: ${result.error}`);
        }
    } else if (structureType === 'tileworks' && this.tileworksSystem) {
        const result = await this.tileworksSystem.completeProcessing(structureId, itemId, chunkId);
        if (!result.success) {
            console.warn(`[handleProcessingComplete] Tileworks processing failed: ${result.error}`);
        }
    }
}
```

#### Step 4.7: Verify Message Handler Registration
**File:** `server.js`
**Location:** With other message handler registrations

Verify `processing_complete` is registered (should already exist for tileworks):
```javascript
// This should already exist - just verify it routes through handleProcessingComplete
messageHandlers.registerMessageHandler('processing_complete', async (ws, payload) => {
    await messageHandlers.handleProcessingComplete(ws, payload);
});
```

---

### PHASE 5: Add Smoke Effect (Single Centered)

#### Step 5.1: Add to EffectManager
**File:** `public/systems/EffectManager.js`
**Location:** After `addTileworksSmoke()` method

```javascript
/**
 * Add smoke effect to Ironworks - SINGLE CENTERED source
 * Unlike tileworks which has 2 corner sources
 */
addIronworksSmoke(objectId, position, rotation = 0) {
    if (this.smokeEffects.has(objectId)) {
        console.warn(`Smoke effect already exists for ironworks ${objectId}`);
        return;
    }

    // Single centered smoke source, 3 units above base
    const smokeEffect = new SmokeEffect(this.scene, {
        x: position.x,
        y: position.y + 3,  // Same height as tileworks
        z: position.z
    });

    smokeEffect.stop();  // Requires firewood to activate
    this.smokeEffects.set(objectId, smokeEffect);
}
```

#### Step 5.2: Add Wrapper in game.js
**File:** `public/game.js`
**Location:** After `addTileworksSmoke()` method

```javascript
/**
 * Add smoke effect to Ironworks
 */
addIronworksSmoke(objectId, position, rotation = 0) {
    if (this.effectManager) {
        this.effectManager.addIronworksSmoke(objectId, position, rotation);
    }
}
```

#### Step 5.3: Initialize in SceneObjectFactory
**File:** `public/network/SceneObjectFactory.js`
**Location:** After tileworks smoke initialization (around line 640)

```javascript
// Add ironworks smoke effect
if (structureType === 'ironworks') {
    this.game.addIronworksSmoke(
        objectInstance.userData.objectId,
        objectInstance.position,
        finalModelRotation
    );

    // Check initial firewood and start if present
    if (objectInstance.userData.inventory) {
        const hasFirewood = objectInstance.userData.inventory.items.some(item =>
            item.type && item.type.endsWith('firewood') && item.durability > 0
        );

        if (hasFirewood) {
            const smokeEffect = this.game.effectManager.smokeEffects.get(
                objectInstance.userData.objectId
            );
            if (smokeEffect && !smokeEffect.active) {
                smokeEffect.start();
            }
        }
    }
}
```

#### Step 5.4: Add Ironworks Smoke Detection in EffectManager.update() (CRITICAL)
**File:** `public/systems/EffectManager.js`
**Location:** In `update()` method, AFTER the tileworks smoke handling block (around line 329)

**IMPORTANT:** Tileworks smoke uses `_1` and `_2` suffixes, but ironworks uses NO suffix. The detection logic is DIFFERENT.

```javascript
// AFTER the tileworks smoke block, ADD this for ironworks:

// Check if this is ironworks smoke (contains 'ironworks' but NO _1/_2 suffix)
const isIronworksSmoke = objectId.includes('ironworks') && !objectId.endsWith('_1') && !objectId.endsWith('_2');

if (isIronworksSmoke) {
    // Ironworks ID is the objectId directly (no suffix to remove)
    const ironworksId = objectId;

    // Only check firewood state on tick change
    if (shouldCheckFirewood) {
        const ironworksObject = this.findObjectById(ironworksId);

        if (ironworksObject) {
            if (ironworksObject.userData.inventory) {
                const hasFirewood = this._hasFirewood(ironworksObject.userData.inventory);
                this._firewoodCache.set(ironworksId, hasFirewood);
            }
        } else {
            // Ironworks was removed
            this._firewoodCache.set(ironworksId, null); // null = removed
        }
    }

    // Use cached firewood state
    const cachedState = this._firewoodCache.get(ironworksId);

    if (cachedState === null) {
        // Structure was removed - stop spawning and mark for cleanup
        if (smokeEffect.active) {
            smokeEffect.stop();
        }
        if (!smokeEffect.hasActiveParticles()) {
            smokesToRemove.push(objectId);
        }
    } else if (cachedState === true) {
        if (!smokeEffect.active) {
            smokeEffect.start();
        }
    } else if (cachedState === false) {
        if (smokeEffect.active) {
            smokeEffect.stop();
        }
    }

    smokeEffect.update(deltaSeconds);
    continue;
}
```

---

### PHASE 6: Client-Side UI Updates

#### Step 6.1: Add Button Text
**File:** `public/ui.js`
**Location:** `buttonTextMap` (around line 194)

```javascript
'ironworks': 'Ironworks',
```

#### Step 6.2: Add Inventory Title
**File:** `public/ui/InventoryUI.js`
**Location:** `titleMap` (around line 1728)

```javascript
'ironworks': 'Ironworks',
```

#### Step 6.3: Add to Structure Types
**File:** `public/game.js`
**Location:** `structureTypes` array (around line 2617)

```javascript
const structureTypes = ['crate', 'tent', 'house', 'garden', 'market',
                        'outpost', 'ship', 'dock', 'campfire', 'tileworks',
                        'ironworks'];
```

#### Step 6.4: Add to Demolish Structure Types
**File:** `public/ui.js`
**Location:** Demolish button structureTypes (around line 287)

```javascript
// Add 'ironworks' to the array
```

#### Step 6.5: Add Inventory Restriction UI Feedback
**File:** `public/ui/InventoryUI.js`
**Location:** In `_handleCrateModePlacement()` or similar

```javascript
// Add check before placing item in ironworks
if (this.gameState.nearestStructure?.userData?.name === 'ironworks') {
    const allowedItems = ['iron', 'ironingot'];
    const isFirewood = item.type && item.type.endsWith('firewood');

    if (!allowedItems.includes(item.type) && !isFirewood) {
        ui.showToast('Ironworks only accepts iron, iron ingots, and firewood', 'warning');
        this._restoreItemPosition();
        this._finishDrop();
        return;
    }
}
```

#### Step 6.6: Add Progress Bar Support
**File:** `public/ui/CrateInventoryUI.js`
**Location:** In `updateProgressBars()` method

The existing code should already handle `processingStartTick` and `processingDurationTicks` fields.
Verify that ironworks items show the green progress bar (same as tileworks).

If a different color is desired (e.g., orange for metalworking), modify:
```javascript
// In the progress bar color section:
if (structureType === 'ironworks') {
    progressBar.style.backgroundColor = '#ff6b00';  // Orange for metal
} else if (isProcessing) {
    progressBar.style.backgroundColor = '#4caf50';  // Green for tileworks
}
```

---

### PHASE 7: Prevent Iron Processing in Campfire/House

This is critical - iron should ONLY be processable in ironworks.

#### Step 7.1: Exclude Iron from CookingSystem
**File:** `server/CookingSystem.js`
**Location:** `COOKING_RECIPES` definition

Ensure iron is NOT in the cooking recipes:
```javascript
this.COOKING_RECIPES = {
    'fish': 'cookedfish',
    'vegetables': 'roastedvegetables',
    'rawmeat': 'cookedmeat'
    // NO 'iron': 'ironingot' here!
};
```

#### Step 7.2: Verify canBeCookedItem()
**File:** `server/CookingSystem.js`

The `canBeCookedItem()` method checks `this.COOKING_RECIPES`, so if iron isn't there, it won't cook.

---

### PHASE 8: Collision and Terrain

#### Step 8.1: Add to Solid Structures (if applicable)
**File:** `public/world/StructureManager.js`
**Location:** Around line 650

```javascript
const isSolidStructure = obj.userData.modelType === 'house' ||
                        obj.userData.modelType === 'market' ||
                        obj.userData.modelType === 'ironworks';
```

#### Step 8.2: Terrain Leveling
Grid dimensions in `public/config.js` enable automatic dirt painting.
No additional changes needed - the system uses GRID_DIMENSIONS.

#### Step 8.3: Add to Restricted Structures Array (CRITICAL - Navigation Blocking)
**File:** `public/world/StructureManager.js`
**Location:** `restrictedStructures` array (around line 467)

**IMPORTANT:** This array controls which structures block AI/player navigation. Ironworks is MISSING and must be added.

```javascript
// Find the restrictedStructures array and add 'ironworks':
const restrictedStructures = ['crate', 'outpost', 'tent', 'house', 'market', 'garden', 'tileworks', 'ironworks'];
```

---

## Asset Requirements

### Required Files
| File | Location | Format | Notes |
|------|----------|--------|-------|
| Structure Icon | `public/structures/ironworks.png` | PNG 64x64 | Build menu icon |
| 3D Model | `public/models/ironworks.glb` | GLB | Structure model |
| Model Texture | `public/models/ironworks.png` | PNG | Model texture |
| Item Icon | `public/items/ironingot.png` | PNG 64x64 | Already exists! |

---

## Testing Checklist

### Item Testing
- [ ] Ironingot appears in market with correct price (buy: 8, sell: 5)
- [ ] Ironingot displays "Iron Ingot" as name
- [ ] Ironingot is 1x1 size in inventory
- [ ] Ships can trade ironingot

### Structure Testing
- [ ] Ironworks appears in build menu
- [ ] Can place ironworks construction site
- [ ] Requires correct materials (1 oakplank, 1 chiseledlimestone, 1 iron)
- [ ] Construction completes successfully
- [ ] Smoke effect starts when firewood added (single centered)
- [ ] Smoke stops when firewood depletes

### Processing Testing
- [ ] Can add iron to ironworks
- [ ] Iron starts processing when firewood present
- [ ] Progress bar shows (green or custom color)
- [ ] Iron transforms to ironingot after 1 minute
- [ ] Quality is averaged (iron quality + structure quality)

### Restriction Testing
- [ ] Cannot add other items to ironworks (shows warning)
- [ ] CAN add: iron, ironingot, all firewood types
- [ ] CANNOT add: clay, fish, planks, etc.
- [ ] Iron does NOT cook in campfire (verify no recipe)
- [ ] Iron does NOT cook in house (verify no recipe)

### Multiplayer Testing
- [ ] Ironworks visible to other players
- [ ] Processing updates sync across clients
- [ ] Smoke visible to all nearby players

### Decay Testing
- [ ] Ironworks quality = average of build material qualities
- [ ] Durability decreases over time based on quality
- [ ] Ironworks converts to ruin when durability reaches 0
- [ ] Ruin can be cleaned up after 1 hour

### Navigation Testing
- [ ] AI bandits path around ironworks (not through it)
- [ ] Players cannot walk through ironworks
- [ ] Ironworks blocks construction nearby appropriately

### Security Testing
- [ ] Server rejects/filters invalid items in ironworks inventory
- [ ] Client shows toast warning for invalid items
- [ ] Cannot exploit by sending raw inventory with invalid items

---

## File Summary

### Files to Create (1)
1. `server/IronworksSystem.js` - Core processing logic

### Files to Modify (16)
1. `public/config.js` - Market prices, grid dimensions, materials
2. `public/ui/InventoryHelpers.js` - Display name, item size
3. `server/ServerConfig.js` - ALL_ITEMS, SHIP_TRADING, PRICES
4. `public/objects.js` - Model configuration
5. `public/ui/BuildMenu.js` - Build menu entry + preview scale
6. `server/MessageHandlers.js` - Materials, build logic, inventory init, save handler, **processing_complete routing**
7. `server.js` - IronworksSystem registration, tick updates
8. `public/systems/EffectManager.js` - Smoke effect method + **update() detection logic**
9. `public/game.js` - Smoke wrapper, structure types
10. `public/network/SceneObjectFactory.js` - Smoke initialization
11. `public/ui.js` - Button text, demolish types
12. `public/ui/InventoryUI.js` - Title, inventory restriction
13. `public/ui/CrateInventoryUI.js` - Progress bar (verify - should work automatically)
14. `public/world/StructureManager.js` - Collision + **restrictedStructures array**
15. `server/CookingSystem.js` - Verify iron NOT in recipes (already correct)

### Assets (ALL VERIFIED PRESENT)
1. `public/structures/ironworks.png` - Build menu icon (exists)
2. `public/models/ironworks.glb` - 3D model (exists)
3. `public/models/ironworks.png` - Model texture (exists)
4. `public/items/ironingot.png` - Item icon (exists)

---

## Key Differences from Tileworks

| Aspect | Tileworks | Ironworks |
|--------|-----------|-----------|
| Smoke Sources | 2 (corners at 0.75, 0.75) | 1 (centered at 0, 0) |
| Recipe | clay -> tile | iron -> ironingot |
| Inventory Restriction | None (accepts all) | iron, firewood, ironingot only |
| Recipe Exclusivity | Clay can cook elsewhere (slower) | Iron ONLY processes here |
| Processing Time | 60 ticks (1 minute) | 60 ticks (1 minute) |
| Quality Calculation | (clay + structure) / 2 | (iron + structure) / 2 |

---

## Documentation Updates

After implementation, update:
1. **GAME_CONTEXT.md** - Add ironworks to structure list, mention iron processing
2. **CODEFILE_GUIDE.md** - Add `server/IronworksSystem.js` entry

---

# APPENDIX: Complete Tileworks Code Reference

This appendix contains the complete tileworks code from every file, organized by lifecycle phase. Use these as exact templates for implementing ironworks.

---

## A1: Build Menu & Structure Selection

### BuildMenu.js - Structure Definition (lines 160-169)

```javascript
{
    id: 'tileworks',
    type: 'tileworks',
    name: 'Tileworks',
    width: 1,
    height: 1,
    imagePath: './structures/tileworks.png',
    hasInventory: true
},
```

### BuildMenu.js - Preview Scale Setup (lines 679-682)

```javascript
} else if (structure.type === 'tileworks') {
    previewScale = 1.0;
    glowScale = 1.02;
}
```

### BuildMenu.js - Selection and Preview Update Flow

When player clicks structure in build menu:
1. `selectStructure(structure)` - Stores selected structure, creates ghost preview
2. `_showStructurePreview(structure)` - Loads 3D model for preview placement
3. Preview follows mouse cursor, snaps to grid
4. Player clicks to place → triggers `_handleSingleStructurePlacement()`

---

## A2: Construction Site Placement

### config.js - Grid Dimensions (line 497)

```javascript
tileworks: { width: 2.0, depth: 2.0, height: 3.0 },
```

### config.js - Construction Model (line 556)

```javascript
tileworks: '2x2construction',
```

### config.js - Required Materials (lines 602-606)

```javascript
tileworks: {
    oakplank: 1,
    chiseledlimestone: 1,
    tile: 1
},
```

### config.js - Structure Properties (lines 648-651)

```javascript
tileworks: {
    height: 3.0,
    inventorySize: { rows: 10, cols: 10 }
},
```

### MessageHandlers.js - handlePlaceConstructionSite (lines 338-339)

Server validates and creates the construction site:

```javascript
} else if (targetStructure === 'tileworks') {
    requiredMaterials = { 'oakplank': 1, 'chiseledlimestone': 1, 'tile': 1 };
}
```

Full method excerpt showing material setup flow:

```javascript
async handlePlaceConstructionSite(ws, payload) {
    const { x, z, targetStructure, clientId, quality, rotation } = payload;

    // ... validation code ...

    let requiredMaterials = {};
    if (targetStructure === 'house') {
        requiredMaterials = { 'oakplank': 3, 'chiseledlimestone': 1, 'tile': 1 };
    } else if (targetStructure === 'tileworks') {
        requiredMaterials = { 'oakplank': 1, 'chiseledlimestone': 1, 'tile': 1 };
    }
    // ... more structures ...

    const construction = {
        id: `construction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        action: 'add',
        x: x,
        y: terrainY + offsetY,
        z: z,
        rotation: rotation || 0,
        targetStructure: targetStructure,
        requiredMaterials: requiredMaterials,
        currentMaterials: {},
        name: 'construction_site',
        owner: clientId,
        quality: quality || 50
    };

    chunkData.objectChanges.push(construction);
    await this.chunkManager.saveChunk(chunkId);

    // Broadcast to nearby players
    this.messageRouter.broadcastToChunk(chunkId, {
        type: 'construction_site_placed',
        payload: construction
    });
}
```

---

## A3: Building the Structure (Adding Materials)

### BuildingSystem.js - addMaterialToConstruction (lines 336-427)

```javascript
async addMaterialToConstruction(constructionObjectId, materialType, materialQuality) {
    if (!constructionObjectId) {
        console.error('[BuildingSystem] No construction object ID provided');
        return { success: false, error: 'No construction selected' };
    }

    // Find construction site in scene
    let constructionObject = null;
    this.game.scene.traverse((object) => {
        if (object.userData && object.userData.objectId === constructionObjectId) {
            constructionObject = object;
        }
    });

    if (!constructionObject) {
        console.error(`[BuildingSystem] Construction object ${constructionObjectId} not found in scene`);
        return { success: false, error: 'Construction site not found' };
    }

    const userData = constructionObject.userData;
    const targetStructure = userData.targetStructure;
    const requiredMaterials = userData.requiredMaterials;
    const currentMaterials = userData.currentMaterials || {};

    // Check if this material type is needed
    // For planks: any plank type fulfills 'oakplank' requirement
    // For chiseled stone: any chiseled type fulfills requirement
    let matchingRequired = null;

    for (const [reqType, reqAmount] of Object.entries(requiredMaterials)) {
        const currentAmount = currentMaterials[reqType] || 0;
        if (currentAmount < reqAmount) {
            // Check if material matches
            if (materialType === reqType) {
                matchingRequired = reqType;
                break;
            }
            // Plank substitution
            if (reqType === 'oakplank' && materialType.endsWith('plank')) {
                matchingRequired = reqType;
                break;
            }
            // Chiseled stone substitution
            if (reqType === 'chiseledlimestone' &&
                (materialType === 'chiseledlimestone' || materialType === 'chiseledsandstone')) {
                matchingRequired = reqType;
                break;
            }
        }
    }

    if (!matchingRequired) {
        return { success: false, error: 'Material not needed' };
    }

    // Update current materials
    currentMaterials[matchingRequired] = (currentMaterials[matchingRequired] || 0) + 1;
    userData.currentMaterials = currentMaterials;

    // Track material qualities for averaging
    if (!userData.materialQualities) {
        userData.materialQualities = [];
    }
    userData.materialQualities.push(materialQuality);

    // Determine which model part to show
    // ... model update logic ...

    return { success: true, materialType: matchingRequired };
}
```

### BuildingSystem.js - completeBuildAction (lines 169-261)

When all materials are placed, this sends the final build message:

```javascript
completeBuildAction(constructionObjectId) {
    const constructionObject = this.findConstructionById(constructionObjectId);
    if (!constructionObject) {
        console.error('[BuildingSystem] Cannot complete - construction not found');
        return;
    }

    const userData = constructionObject.userData;

    // Check if all materials are placed
    const requiredMaterials = userData.requiredMaterials;
    const currentMaterials = userData.currentMaterials || {};

    for (const [type, required] of Object.entries(requiredMaterials)) {
        const current = currentMaterials[type] || 0;
        if (current < required) {
            console.log(`[BuildingSystem] Not complete - need ${required - current} more ${type}`);
            return;
        }
    }

    // Calculate final quality (average of all materials)
    let finalQuality = userData.quality || 50;
    if (userData.materialQualities && userData.materialQualities.length > 0) {
        const sum = userData.materialQualities.reduce((a, b) => a + b, 0);
        finalQuality = Math.round(sum / userData.materialQualities.length);
    }

    // Determine material type for tint (limestone vs sandstone)
    let materialType = 'limestone';
    if (userData.usedChiseledType === 'chiseledsandstone') {
        materialType = 'sandstone';
    }

    // Send to server
    this.game.sendMessage({
        type: 'build_construction',
        payload: {
            constructionId: userData.objectId,
            chunkId: userData.chunkId,
            quality: finalQuality,
            materialType: materialType
        }
    });
}
```

### MessageHandlers.js - handleBuildConstruction (lines 2129-2163)

Server processes the build completion:

```javascript
async handleBuildConstruction(ws, payload) {
    const { constructionId, chunkId, quality, materialType } = payload;

    // Load chunk and find construction
    const chunkData = await this.chunkManager.loadChunk(chunkId);
    const constructionIndex = chunkData.objectChanges.findIndex(
        obj => obj.id === constructionId && obj.name === 'construction_site'
    );

    if (constructionIndex === -1) {
        return;
    }

    const constructionSite = chunkData.objectChanges[constructionIndex];
    const targetStructure = constructionSite.targetStructure;

    // Remove construction site
    chunkData.objectChanges.splice(constructionIndex, 1);

    // Determine scale based on structure type
    let structureScale = 1.0;
    if (targetStructure === 'house') {
        structureScale = 0.85;
    } else if (targetStructure === 'tileworks') {
        structureScale = 1.0;
    }

    // Create final structure
    const finalStructure = {
        id: `${targetStructure}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        action: 'add',
        name: targetStructure,
        x: constructionSite.x,
        y: constructionSite.y,
        z: constructionSite.z,
        rotation: constructionSite.rotation,
        scale: structureScale,
        owner: constructionSite.owner,
        quality: quality || constructionSite.quality,
        materialType: materialType || 'limestone'
    };

    // Initialize inventory for structures that need it
    if (constructionSite.targetStructure === 'house' ||
        constructionSite.targetStructure === 'garden' ||
        constructionSite.targetStructure === 'campfire' ||
        constructionSite.targetStructure === 'tileworks') {

        finalStructure.inventory = { items: [] };
    }

    chunkData.objectChanges.push(finalStructure);
    await this.chunkManager.saveChunk(chunkId);

    // Broadcast structure creation
    this.broadcastStructureCreated(chunkId, finalStructure, constructionId);
}
```

---

## A4: Structure Creation & Smoke Setup

### SceneObjectFactory.js - Structure Creation with Smoke (lines 627-655)

```javascript
// Apply sandstone tint if materialType is sandstone
if (newObject.materialType === 'sandstone') {
    objectInstance.traverse((child) => {
        if (child.isMesh && child.material) {
            const mat = child.material.clone();
            mat.color.setHex(0xd4a574); // Sandstone tint
            child.material = mat;
        }
    });
}

// Add tileworks smoke effects
if (structureType === 'tileworks') {
    this.game.addTileworksSmoke(
        objectInstance.userData.objectId,
        objectInstance.position,
        finalModelRotation
    );

    // Check for initial firewood
    if (objectInstance.userData.inventory) {
        const hasFirewood = objectInstance.userData.inventory.items.some(item => {
            if (!item.type || !item.type.endsWith('firewood')) return false;
            // Check durability with tick calculation
            if (item.placedAtTick) {
                const currentTick = this.game.gameState?.serverTick || 0;
                const ticksElapsed = currentTick - item.placedAtTick;
                const minutesElapsed = ticksElapsed / 60;
                const durabilityLost = minutesElapsed * 2;
                return (item.durability - durabilityLost) > 0;
            }
            return item.durability > 0;
        });

        if (hasFirewood) {
            // Start smoke immediately
            const smokeId1 = objectInstance.userData.objectId + '_1';
            const smokeId2 = objectInstance.userData.objectId + '_2';
            const smoke1 = this.game.effectManager?.smokeEffects.get(smokeId1);
            const smoke2 = this.game.effectManager?.smokeEffects.get(smokeId2);
            if (smoke1 && !smoke1.active) smoke1.start();
            if (smoke2 && !smoke2.active) smoke2.start();
        }
    }
}
```

### EffectManager.js - addTileworksSmoke (lines 154-205)

**NOTE FOR IRONWORKS:** Tileworks uses TWO smoke sources at opposite corners.
Ironworks should use ONE centered smoke source instead.

```javascript
/**
 * Add smoke effects to tileworks chimneys (2 smoke sources at diagonal corners)
 * @param {string} objectId - Unique ID for the tileworks
 * @param {Object} position - Position of the tileworks center
 * @param {number} rotation - Rotation in radians (default 0)
 */
addTileworksSmoke(objectId, position, rotation = 0) {
    console.log(`[TILEWORKS SMOKE] Attempting to add smoke for ${objectId} at position:`, position);

    // Don't create duplicate smoke
    if (this.smokeEffects.has(objectId + '_1') || this.smokeEffects.has(objectId + '_2')) {
        console.warn(`Smoke effects already exist for tileworks ${objectId}`);
        return;
    }

    // Rotate the offset based on structure rotation
    // Negate rotation to match Three.js rotation.y coordinate system
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);

    // Chimney 1 local offset: +0.75, +0.75 (northeast corner in local space)
    const local1X = 0.75;
    const local1Z = 0.75;
    const rotated1X = local1X * cos - local1Z * sin;
    const rotated1Z = local1X * sin + local1Z * cos;

    const pos1 = {
        x: position.x + rotated1X,
        y: position.y + 3,
        z: position.z + rotated1Z
    };
    console.log(`[TILEWORKS SMOKE] Creating smoke 1 at:`, pos1);
    const smoke1 = new SmokeEffect(this.scene, pos1);

    // Chimney 2 local offset: -0.75, -0.75 (southwest corner in local space)
    const local2X = -0.75;
    const local2Z = -0.75;
    const rotated2X = local2X * cos - local2Z * sin;
    const rotated2Z = local2X * sin + local2Z * cos;

    const pos2 = {
        x: position.x + rotated2X,
        y: position.y + 3,
        z: position.z + rotated2Z
    };
    console.log(`[TILEWORKS SMOKE] Creating smoke 2 at:`, pos2);
    const smoke2 = new SmokeEffect(this.scene, pos2);

    // Start with smoke stopped (requires firewood to activate, same as campfire)
    smoke1.stop();
    smoke2.stop();

    // Store both smoke effects with unique IDs
    this.smokeEffects.set(objectId + '_1', smoke1);
    this.smokeEffects.set(objectId + '_2', smoke2);

    console.log(`[TILEWORKS SMOKE] Successfully created smoke effects for tileworks ${objectId} - waiting for firewood`);
}
```

### EffectManager.js - update() Tileworks Smoke Handling (lines 283-329)

```javascript
// Check if this is tileworks smoke (has _1 or _2 suffix)
const isTileworksSmoke = objectId.includes('tileworks') && (objectId.endsWith('_1') || objectId.endsWith('_2'));

if (isTileworksSmoke) {
    // Extract tileworks ID (remove _1 or _2 suffix)
    const tileworksId = objectId.replace(/_[12]$/, '');

    // Only check firewood state on tick change
    if (shouldCheckFirewood) {
        const tileworksObject = this.findObjectById(tileworksId);

        if (tileworksObject) {
            if (tileworksObject.userData.inventory) {
                const hasFirewood = this._hasFirewood(tileworksObject.userData.inventory);
                this._firewoodCache.set(tileworksId, hasFirewood);
            }
        } else {
            // Tileworks was removed
            this._firewoodCache.set(tileworksId, null); // null = removed
        }
    }

    // Use cached firewood state
    const cachedState = this._firewoodCache.get(tileworksId);

    if (cachedState === null) {
        // Structure was removed - stop spawning and mark for cleanup
        if (smokeEffect.active) {
            smokeEffect.stop();
        }
        if (!smokeEffect.hasActiveParticles()) {
            smokesToRemove.push(objectId);
        }
    } else if (cachedState === true) {
        if (!smokeEffect.active) {
            smokeEffect.start();
        }
    } else if (cachedState === false) {
        if (smokeEffect.active) {
            smokeEffect.stop();
        }
    }

    smokeEffect.update(deltaSeconds);
    continue;
}
```

### game.js - Smoke Wrapper Method (lines 3704-3708)

```javascript
/**
 * Add smoke effects to tileworks chimneys
 */
addTileworksSmoke(objectId, position, rotation = 0) {
    if (this.effectManager) {
        this.effectManager.addTileworksSmoke(objectId, position, rotation);
    }
}
```

---

## A5: Inventory & Processing Start

### MessageHandlers.js - handleSaveCrateInventory Tileworks Section (lines 2689-2727)

```javascript
// Stamp firewood with current tick when placed
for (const item of inventory.items) {
    if (item.type && item.type.endsWith('firewood')) {
        if (!item.placedAtTick) {
            item.placedAtTick = this.serverTick;
            console.log(`[handleSaveCrateInventory] Stamped firewood ${item.id} with tick ${this.serverTick}`);
        }
    }
}

// Check if this is a tileworks - trigger processing check
if (structure.name === 'tileworks' && this.tileworksSystem) {
    this.tileworksSystem.checkForProcessableItems(crateId, chunkId, inventory);
}

// Save inventory to structure
structure.inventory = inventory;
await this.chunkManager.saveChunk(chunkId);

// Broadcast to nearby players
const parts = chunkId.replace('chunk_', '').split(',');
const cx = parseInt(parts[0]);
const cz = parseInt(parts[1]);

for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
        const neighborChunkId = `chunk_${cx + dx},${cz + dz}`;
        this.messageRouter.broadcastToChunk(neighborChunkId, {
            type: 'crate_inventory_updated',
            payload: {
                crateId: crateId,
                chunkId: chunkId,
                inventory: inventory
            }
        });
    }
}
```

### TileworksSystem.js - Complete File

```javascript
/**
 * TileworksSystem - Handles clay to tile processing in tileworks structures
 */
class TileworksSystem {
    constructor(chunkManager, messageRouter, timeTrackerService) {
        this.chunkManager = chunkManager;
        this.messageRouter = messageRouter;
        this.timeTrackerService = timeTrackerService;
        this.serverTick = 0;

        // Processing duration in server ticks (1 tick = 1 second)
        this.PROCESSING_DURATION_TICKS = 60; // 1 minute to process clay into tile

        // Recipes: input -> output
        this.PROCESSING_RECIPES = {
            'clay': 'tile'
        };
    }

    /**
     * Update server tick
     */
    setServerTick(tick) {
        this.serverTick = tick;
    }

    /**
     * Check if item type can be processed in tileworks
     */
    canBeProcessedItem(itemType) {
        return this.PROCESSING_RECIPES.hasOwnProperty(itemType);
    }

    /**
     * Check for processable items when inventory is saved
     */
    async checkForProcessableItems(tileworksId, chunkId, inventory) {
        if (!inventory || !Array.isArray(inventory.items)) {
            return;
        }

        // Check if firewood is present with durability
        const hasFirewood = inventory.items.some(item =>
            item.type && item.type.endsWith('firewood') && item.durability > 0
        );

        if (!hasFirewood) {
            console.log(`[TILEWORKS] No firewood in ${tileworksId} - cannot process`);
            return;
        }

        // Find all clay items that aren't already processing
        for (let index = 0; index < inventory.items.length; index++) {
            const item = inventory.items[index];
            if (this.canBeProcessedItem(item.type) && !item.processingStartTick) {
                console.log(`[TILEWORKS] Found processable ${item.type} in ${tileworksId} - starting processing`);
                await this.startProcessing(tileworksId, item.id, index, chunkId);
            }
        }
    }

    /**
     * Start processing an item
     */
    async startProcessing(tileworksId, itemId, itemIndex, chunkId) {
        try {
            const chunkData = await this.chunkManager.loadChunk(chunkId);
            if (!chunkData) {
                console.error(`[TILEWORKS] Chunk ${chunkId} not found`);
                return;
            }

            const tileworksIndex = chunkData.objectChanges.findIndex(
                obj => obj.id === tileworksId && obj.action === 'add'
            );
            if (tileworksIndex === -1) {
                console.error(`[TILEWORKS] Tileworks ${tileworksId} not found in chunk`);
                return;
            }

            const tileworks = chunkData.objectChanges[tileworksIndex];
            if (!tileworks.inventory || !tileworks.inventory.items) {
                console.error(`[TILEWORKS] Tileworks ${tileworksId} has no inventory`);
                return;
            }

            const item = tileworks.inventory.items.find(i => i.id === itemId);
            if (!item) {
                console.error(`[TILEWORKS] Item ${itemId} not found in tileworks inventory`);
                return;
            }

            if (item.processingStartTick) {
                console.log(`[TILEWORKS] Item ${itemId} already processing`);
                return;
            }

            // Stamp processing start tick
            item.processingStartTick = this.serverTick;
            item.processingDurationTicks = this.PROCESSING_DURATION_TICKS;

            // Clear any legacy cooking fields
            delete item.cookingStartTick;
            delete item.cookingDurationTicks;
            delete item.cookingStartTime;
            delete item.estimatedCompletionTime;

            await this.chunkManager.saveChunk(chunkId);

            // Broadcast inventory update
            this.broadcastInventoryUpdate(tileworksId, chunkId, tileworks.inventory);

            console.log(`[TILEWORKS] Started processing ${item.type} (${itemId}) at tick ${this.serverTick}`);
        } catch (error) {
            console.error('[TILEWORKS] Error starting processing:', error);
        }
    }

    /**
     * Complete processing - called when client reports item done
     */
    async completeProcessing(tileworksId, itemId, chunkId) {
        try {
            const chunkData = await this.chunkManager.loadChunk(chunkId);
            if (!chunkData) {
                console.error(`[TILEWORKS] Chunk ${chunkId} not found`);
                return { success: false, error: 'Chunk not found' };
            }

            const tileworksIndex = chunkData.objectChanges.findIndex(
                obj => obj.id === tileworksId && obj.action === 'add'
            );
            if (tileworksIndex === -1) {
                console.error(`[TILEWORKS] Tileworks ${tileworksId} not found`);
                return { success: false, error: 'Tileworks not found' };
            }

            const tileworks = chunkData.objectChanges[tileworksIndex];
            if (!tileworks.inventory || !tileworks.inventory.items) {
                return { success: false, error: 'Tileworks has no inventory' };
            }

            const itemIndex = tileworks.inventory.items.findIndex(i => i.id === itemId);
            if (itemIndex === -1) {
                return { success: false, error: 'Item not found in inventory' };
            }

            const rawItem = tileworks.inventory.items[itemIndex];

            // Validate processing was started
            if (!rawItem.processingStartTick) {
                return { success: false, error: 'Item was not processing' };
            }

            // Validate enough time has passed (with 5 tick tolerance for network lag)
            const ticksElapsed = this.serverTick - rawItem.processingStartTick;
            if (ticksElapsed < this.PROCESSING_DURATION_TICKS - 5) {
                console.warn(`[TILEWORKS] Premature completion attempt: ${ticksElapsed}/${this.PROCESSING_DURATION_TICKS} ticks`);
                return { success: false, error: 'Processing not complete' };
            }

            // Get output type from recipe
            const processedType = this.PROCESSING_RECIPES[rawItem.type];
            if (!processedType) {
                return { success: false, error: 'Unknown input type' };
            }

            // Calculate quality (average of clay quality + tileworks quality)
            const clayQuality = rawItem.quality || 50;
            const tileworksQuality = tileworks.quality || 50;
            const averagedQuality = Math.round((clayQuality + tileworksQuality) / 2);

            // Create processed item
            const processedItem = {
                ...rawItem,
                type: processedType,
                quality: averagedQuality,
                id: `${processedType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            };

            // Remove processing fields
            delete processedItem.processingStartTick;
            delete processedItem.processingDurationTicks;

            // Replace in inventory
            tileworks.inventory.items[itemIndex] = processedItem;

            await this.chunkManager.saveChunk(chunkId);

            // Broadcast update
            this.broadcastInventoryUpdate(tileworksId, chunkId, tileworks.inventory);

            console.log(`[TILEWORKS] Completed: ${rawItem.type} -> ${processedType} (quality: ${clayQuality} + ${tileworksQuality} / 2 = ${averagedQuality})`);

            return {
                success: true,
                processedType: processedType,
                processedItem: processedItem
            };
        } catch (error) {
            console.error('[TILEWORKS] Error completing processing:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Cancel processing for an item
     */
    async cancelProcessing(tileworksId, itemId, chunkId) {
        try {
            const chunkData = await this.chunkManager.loadChunk(chunkId);
            if (!chunkData) return;

            const tileworksIndex = chunkData.objectChanges.findIndex(
                obj => obj.id === tileworksId && obj.action === 'add'
            );
            if (tileworksIndex === -1) return;

            const tileworks = chunkData.objectChanges[tileworksIndex];
            if (!tileworks.inventory) return;

            const item = tileworks.inventory.items.find(i => i.id === itemId);
            if (!item) return;

            delete item.processingStartTick;
            delete item.processingDurationTicks;

            await this.chunkManager.saveChunk(chunkId);
            this.broadcastInventoryUpdate(tileworksId, chunkId, tileworks.inventory);

            console.log(`[TILEWORKS] Cancelled processing for ${item.type}`);
        } catch (error) {
            console.error('[TILEWORKS] Error cancelling processing:', error);
        }
    }

    /**
     * Cancel all processing when firewood runs out
     */
    async cancelAllProcessingForStructure(tileworksId, chunkId, inventory) {
        if (!inventory || !Array.isArray(inventory.items)) {
            return false;
        }

        let anyCancelled = false;

        for (const item of inventory.items) {
            if (item.processingStartTick) {
                delete item.processingStartTick;
                delete item.processingDurationTicks;
                anyCancelled = true;
            }
        }

        return anyCancelled;
    }

    /**
     * Broadcast inventory update to nearby players
     */
    broadcastInventoryUpdate(tileworksId, chunkId, inventory) {
        if (!this.messageRouter) return;

        const message = {
            type: 'crate_inventory_updated',
            payload: {
                crateId: tileworksId,
                chunkId: chunkId,
                inventory: inventory
            }
        };

        // Parse chunk coords
        const parts = chunkId.replace('chunk_', '').split(',');
        const cx = parseInt(parts[0]);
        const cz = parseInt(parts[1]);

        // Broadcast to 3x3 grid of chunks
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const neighborChunkId = `chunk_${cx + dx},${cz + dz}`;
                this.messageRouter.broadcastToChunk(neighborChunkId, message);
            }
        }
    }
}

module.exports = TileworksSystem;
```

### server.js - TileworksSystem Registration (lines 10, 36-37, 41)

```javascript
// Import
const TileworksSystem = require('./server/TileworksSystem');

// Create instance
const tileworksSystem = new TileworksSystem(chunkManager, messageRouter, null);

// Pass to MessageHandlers
const messageHandlers = new MessageHandlers(
    chunkManager,
    messageRouter,
    clients,
    cookingSystem,
    tileworksSystem  // <-- passed as 5th parameter
);

// In tick update loop
tileworksSystem.setServerTick(currentTick);
```

---

## A6: Progress Bar & Completion

### CrateInventoryUI.js - updateProgressBars (lines 643-731)

```javascript
updateProgressBars(forceUpdate = false) {
    if (!this.currentInventory || !Array.isArray(this.currentInventory.items)) return;

    const currentTick = this.gameState?.serverTick || 0;
    const grid = this.element.querySelector('.inventory-grid');
    if (!grid) return;

    for (const item of this.currentInventory.items) {
        if (!item || !item.id) continue;

        const slot = grid.querySelector(`[data-item-id="${item.id}"]`);
        if (!slot) continue;

        let progressBar = slot.querySelector('.item-progress-bar');
        let progress = 0;
        let isProcessing = false;

        // Check for tileworks/ironworks tick-based processing
        if (item.processingStartTick && item.processingDurationTicks) {
            const ticksElapsed = currentTick - item.processingStartTick;
            progress = Math.min(1.0, ticksElapsed / item.processingDurationTicks);
            isProcessing = true;
        }

        if (progress > 0 && progress < 1) {
            // Show progress bar
            if (!progressBar) {
                progressBar = document.createElement('div');
                progressBar.className = 'item-progress-bar';
                progressBar.style.cssText = `
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    height: 4px;
                    background-color: ${isProcessing ? '#4caf50' : '#ff9800'};
                    transition: width 0.5s linear;
                    z-index: 5;
                `;
                slot.appendChild(progressBar);
            }

            progressBar.style.width = `${progress * 100}%`;
            progressBar.style.backgroundColor = isProcessing ? '#4caf50' : '#ff9800';
        } else if (progress >= 1) {
            // Processing complete - send completion message
            if (progressBar) {
                progressBar.remove();
            }

            // Send processing_complete to server
            if (item.processingStartTick) {
                const structureObject = this.gameState.nearestStructure;
                if (structureObject) {
                    const structureType = structureObject.userData.name || structureObject.userData.modelType;

                    this.game.sendMessage({
                        type: 'processing_complete',
                        payload: {
                            structureId: structureObject.userData.objectId,
                            structureType: structureType,
                            itemId: item.id,
                            chunkId: structureObject.userData.chunkId
                        }
                    });

                    console.log(`[CrateInventoryUI] Sent processing_complete for ${item.type} (${item.id})`);
                }
            }
        } else {
            // No progress - remove bar
            if (progressBar) {
                progressBar.remove();
            }
        }
    }
}
```

### MessageHandlers.js - handleProcessingComplete (lines 3183-3202)

```javascript
async handleProcessingComplete(ws, payload) {
    const { structureId, itemId, chunkId, structureType } = payload;

    console.log(`[handleProcessingComplete] ${structureType} processing complete for ${itemId}`);

    // Route to appropriate system based on structure type
    if (structureType === 'tileworks' && this.tileworksSystem) {
        const result = await this.tileworksSystem.completeProcessing(structureId, itemId, chunkId);
        if (!result.success) {
            console.warn(`[handleProcessingComplete] Tileworks processing failed: ${result.error}`);
        }
    }
    // Add ironworks case here when implementing
}
```

---

## A7: Supporting Files

### objects.js - Model Definition (lines 307-313)

```javascript
tileworks: {
    path: './models/tileworks.glb',
    heightRange: { min: 0, max: 0 },
    scaleRange: { min: 0, max: 0 },
    density: 0,
    category: 'structure'
},
```

### ui.js - Button Text (line 598)

```javascript
'tileworks': 'Tileworks',
```

### config.js - Cooking Duration Constant (line 140)

```javascript
CLAY_TILEWORKS_DURATION: 60000,  // 60 seconds in milliseconds (legacy, tick-based now)
```

---

## Summary: Ironworks Modifications from Tileworks

Based on all the code above, here are the specific changes for ironworks:

| Component | Tileworks Code | Ironworks Change |
|-----------|---------------|------------------|
| **Smoke - EffectManager** | 2 smoke sources at (±0.75, ±0.75) | 1 smoke source at (0, 0) |
| **Smoke - ID Pattern** | `objectId + '_1'`, `objectId + '_2'` | Just `objectId` |
| **Recipe** | `'clay': 'tile'` | `'iron': 'ironingot'` |
| **Inventory Filter** | None (accepts all items) | Filter to iron, ironingot, firewood only |
| **CookingSystem** | Clay can cook in campfire/house | Iron NOT in CookingSystem recipes |
| **Build Materials** | oakplank, chiseledlimestone, tile | oakplank, chiseledlimestone, iron |

The rest of the implementation (construction flow, inventory save, processing logic, progress bars, tick updates) follows the exact same patterns as tileworks.

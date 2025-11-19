# How to Add New Structures to the Game

This manual provides step-by-step instructions for adding new structures to the game.

## Required Assets

### 1. 3D Model File
- **Format**: `.glb` (GLTF binary)
- **Location**: `public/models/[structure_name].glb`

### 2. Icon Image
- **Format**: `.png` (64x64 pixels)
- **Location**: `public/structures/[structure_name].png`

---

## Step-by-Step Instructions

### STEP 1: Add Model Configuration
**File**: `public/objects.js`
**Location**: Inside the `MODEL_CONFIG` object

Add your structure definition:

```javascript
const MODEL_CONFIG = {
    // ... existing models ...

    // Add your new structure here:
    your_structure_name: {
        path: './models/your_structure_name.glb',
        heightRange: { min: 0, max: 0 },  // Usually 0 for structures
        scaleRange: { min: 0, max: 0 },   // Usually 0 for structures
        density: 0,                        // Always 0 for player-built structures
        category: 'structure'              // Always 'structure' for buildings
    },

    // ... rest of models ...
};
```

### STEP 2: Add to Build Menu
**File**: `public/ui/BuildMenu.js`
**Location**: Inside the `buildMenu.structures` array (around line 68)

Add your structure entry:

```javascript
structures: [
    // ... existing structures ...

    // Add your new structure here:
    {
        id: 'your_structure_name',           // Unique identifier
        type: 'your_structure_name',         // Must match MODEL_CONFIG key
        name: 'Your Structure Display Name',  // Shown to player
        width: 1,                             // Grid width in build menu (usually 1)
        height: 1,                            // Grid height in build menu (usually 1)
        imagePath: './structures/your_structure_name.png',

        // Optional flags (choose applicable ones):
        requiresFoundation: true,    // Must be placed on foundation
        hasInventory: true,          // Has storage (like crate/house)
        requiresWater: true,         // Must be placed in water
        instantBuild: true,          // Builds immediately (no construction phase)
        requires2x8Foundation: true, // Needs 2x8 foundation grid
        rotationConstraint: 180      // Limits rotation (e.g., 180 = only 0° and 180°)
    },

    // ... rest of structures ...
]
```

### STEP 3: Define Material Requirements
**File**: `public/config.js`
**Location**: Inside `CONFIG.CONSTRUCTION.MATERIALS` object (around line 236)

Add material requirements:

```javascript
CONSTRUCTION: {
    MATERIALS: {
        // ... existing materials ...

        // Add your structure's requirements:
        your_structure_name: {
            oakplank: 5,           // Example: requires 5 oak planks
            chiseledlimestone: 2,  // Example: requires 2 chiseled limestone
            // Add any materials from: oakplank, pineplank, firplank, cypressplank,
            // chiseledlimestone, chiseledsandstone
        },

        // ... rest of materials ...
    },
```

### STEP 4: Set Preview Scale
**File**: `public/ui/BuildMenu.js`
**Location**: Inside the scale assignment logic (around line 404-431)

**REQUIRED FOR ALL STRUCTURES** - Add your structure to the scale checks:

```javascript
// Find the previewScale assignment section (around line 404-431)
// Add your structure to the appropriate scale group:

// For 1.0 scale structures (most common):
} else if (structure.type === 'crate') {
    previewScale = 1.0;
    glowScale = 1.02;
} else if (structure.type === 'your_structure_name') {  // ADD YOUR STRUCTURE HERE
    previewScale = 1.0;
    glowScale = 1.02;

// For 0.5 scale structures (like tent):
} else if (structure.type === 'tent') {
    previewScale = 0.5;
    glowScale = 0.52;
}
```

### STEP 5: Add Special Properties (Optional)
**File**: `public/config.js`
**Location**: Inside `CONFIG.CONSTRUCTION.STRUCTURE_PROPERTIES` (around line 264)

Add if your structure has special properties:

```javascript
STRUCTURE_PROPERTIES: {
    // ... existing properties ...

    your_structure_name: {
        height: 4.0,                           // Height for collision detection
        inventorySize: { rows: 10, cols: 10 }, // ⚠️ REQUIRED if hasInventory: true
        animationSpeed: 0.5,                   // If animated
        foundationGrid: { width: 2, depth: 4 }, // If requires specific foundation layout
        allowedRotations: [0, 90, 180, 270]    // Specific allowed rotations
    },

    // ... rest of properties ...
}
```

**⚠️ IMPORTANT for Inventory Structures:**

If your structure has `hasInventory: true`, you MUST configure the inventory size here:

```javascript
your_structure_name: {
    inventorySize: { rows: X, cols: Y }  // e.g., { rows: 5, cols: 5 } for 25 slots
}
```

**Inventory Size Examples:**
- Small storage: `{ rows: 2, cols: 2 }` (4 slots) - Like garden
- Medium storage: `{ rows: 5, cols: 5 }` (25 slots)
- Large storage: `{ rows: 10, cols: 10 }` (100 slots) - Like crate/house
- Extra large scrollable: `{ rows: 100, cols: 10 }` (1000 slots) - Like market
- Custom: Any size that fits your needs

**Default Behavior:** If not configured, defaults to 10x10 (100 slots)

**Scrollable Inventories:** For inventories with more than 10 rows, the system automatically:
- Shows only 10 rows at a time with a scrollbar
- Enables full drag/drop functionality while scrolling
- Handles all scroll positioning automatically
- No additional code required - just set the inventory size!

**Example**: Market uses `{ rows: 100, cols: 10 }` for a massive 1000-slot inventory with automatic scrolling.

**⚠️ CRITICAL:** After configuring inventory size here, you MUST also complete Step 13 (client-side proximity detection) or players won't be able to open the inventory!

### STEP 6: Set Y-Position for Foundation Structures
**File**: `public/world/StructureManager.js`
**Location**: Inside Y position calculation (around line 66-80)

**REQUIRED FOR FOUNDATION-BASED STRUCTURES** - Add your structure to the Y position checks:

```javascript
// Find the Y POSITION CALCULATION section
if (structure.type === 'house') {
    previewY = foundationBelow.position.y;
} else if (structure.type === 'crate') {
    previewY = foundationBelow.position.y;
} else if (structure.type === 'your_structure_name') {  // ADD YOUR STRUCTURE HERE
    previewY = foundationBelow.position.y;
} else if (structure.type === 'market') {
    previewY = foundationBelow.position.y;
}
```

### STEP 7: Set Construction Site Y-Position
**File**: `public/ui/BuildMenu.js`
**Location**: Inside the construction site placement logic (around line 559-577)

**REQUIRED FOR FOUNDATION-BASED STRUCTURES** - Add your structure to the Y position calculation:

```javascript
// Find the structure Y position calculation
if (structure.type === 'house') {
    structureY = foundation.position.y;
    finalStructureY = foundation.position.y;
} else if (structure.type === 'crate') {
    structureY = foundation.position.y;
    finalStructureY = foundation.position.y;
} else if (structure.type === 'your_structure_name') {  // ADD YOUR STRUCTURE HERE
    structureY = foundation.position.y;
    finalStructureY = foundation.position.y;
} else if (structure.type === 'market') {
    structureY = foundation.position.y;
    finalStructureY = foundation.position.y;
}
```

### STEP 8: Add Server-Side Material Requirements
**File**: `server/MessageHandlers.js`
**Location**: Inside `handlePlaceConstructionSite()` method (around line 185-199)

**REQUIRED FOR ALL STRUCTURES** - Add your structure to the material requirements:

```javascript
// Find the required materials section
if (targetStructure === 'crate') {
    requiredMaterials = { 'oakplank': 1 };
} else if (targetStructure === 'your_structure_name') {  // ADD YOUR STRUCTURE HERE
    requiredMaterials = { 'chiseledlimestone': 5 };  // Your materials
} else if (targetStructure === 'outpost') {
    requiredMaterials = { 'oakplank': 1 };
}
```

### STEP 9: Add Server-Side Final Y Position
**File**: `server/MessageHandlers.js`
**Location**: Inside `handleBuildConstruction()` method (around line 301-304)

**REQUIRED FOR FOUNDATION-BASED STRUCTURES** - Add your structure to the final Y position calculation:

```javascript
// Find the "Determine final Y position" section
let finalY = constructionSite.targetStructure === 'crate' ? constructionSite.finalCrateY : constructionSite.finalFoundationY;
if (constructionSite.targetStructure === 'house' ||
    constructionSite.targetStructure === 'your_structure_name' ||  // ADD HERE
    constructionSite.targetStructure === 'market') {
    finalY = constructionSite.finalCrateY || constructionSite.finalFoundationY;
}
```

### STEP 10: Add Server-Side Final Scale
**File**: `server/MessageHandlers.js`
**Location**: Inside `handleBuildConstruction()` method (around line 307-323)

**REQUIRED FOR ALL STRUCTURES** - Add your structure to the scale determination:

```javascript
// Find the "Determine scale" section
let structureScale = 0.5;
if (constructionSite.targetStructure === 'foundation' || ...) {
    structureScale = 1.0;
} else if (constructionSite.targetStructure === 'crate') {
    structureScale = 1.0;
} else if (constructionSite.targetStructure === 'your_structure_name') {  // ADD HERE
    structureScale = 1.0;  // Your scale (1.0 for most structures, 0.5 for tent)
}
```

### STEP 11: Add Collision Skip for Foundation-Based Structures
**File**: `public/world/StructureManager.js`
**Location**: Inside `checkBoundingBoxCollision()` method (around line 781-785)

**REQUIRED IF**: Your structure requires a foundation (sits ON a foundation)

Foundation-based structures should not block adjacent foundation placement. Add your structure to the collision skip list:

```javascript
// Find the collision skip section for foundation-based structures
// Skip collision with foundation-based structures (market, house, crate, garden)
// These structures sit on foundations and shouldn't block adjacent placement
if (objType === 'market' ||
    objType === 'house' ||
    objType === 'crate' ||
    objType === 'garden' ||
    objType === 'your_structure_name') {  // ADD YOUR STRUCTURE HERE
    continue;
}
```

**Why This Is Important:**

Without this step, your structure's bounding box will block foundations from being placed adjacent to it, even though:
- Your structure only occupies its specific foundation grid space (e.g., 1x1, 2x8)
- Foundations should be placeable right next to it
- Other foundation-based structures work this way

**Real-world example:** The garden initially blocked adjacent foundation placement because it wasn't in this skip list. Players couldn't place foundations next to gardens even though the garden only occupied a 1x1 space.

**Note:** This skip list is specifically for foundation placement checks. It allows foundations to be placed next to structures that sit on foundations, while still preventing overlap with terrain-based structures.

### STEP 12: Add Foundation Reference and Inventory (If Applicable)
**File**: `server/MessageHandlers.js`
**Location**: Inside `handleBuildConstruction()` method (around line 343-353 and 376-378)

**REQUIRED IF**: Your structure requires a foundation OR has inventory

```javascript
// Store foundation reference (around line 343-348)
if ((constructionSite.targetStructure === 'crate' ||
     constructionSite.targetStructure === 'house' ||
     constructionSite.targetStructure === 'your_structure_name' ||  // ADD IF REQUIRES FOUNDATION
     constructionSite.targetStructure === 'market') && constructionSite.foundationId) {
    structureChange.foundationId = constructionSite.foundationId;
}

// Initialize inventory (around line 351-353)
if (constructionSite.targetStructure === 'house' ||
    constructionSite.targetStructure === 'your_structure_name') {  // ADD IF HAS INVENTORY
    structureChange.inventory = { items: [] };
}

// Also add to broadcast payload (around line 376-378)
if (constructionSite.targetStructure === 'house' ||
    constructionSite.targetStructure === 'your_structure_name') {  // ADD IF HAS INVENTORY
    addedPayload.inventory = { items: [] };
}
```

### STEP 13: Add Client-Side Inventory Proximity Detection
**Files**: `public/world/ObjectManager.js`, `public/ui/InventoryUI.js`, `public/ui.js`

**REQUIRED IF**: Your structure has inventory (`hasInventory: true`)

⚠️ **CRITICAL**: Without this step, players won't be able to open the inventory when standing near your structure!

#### 12a. Add to Proximity Detection
**File**: `public/world/ObjectManager.js`
**Location**: Around line 119

```javascript
// Find the crate proximity detection logic
} else if (object.userData.modelType === 'crate' ||
           object.userData.modelType === 'tent' ||
           object.userData.modelType === 'house' ||
           object.userData.modelType === 'garden' ||
           object.userData.modelType === 'your_structure_name') {  // ADD HERE
    if (distance < closestCrateDistance) {
        closestCrateDistance = distance;
        closestCrate = object;
    }
}
```

#### 12b. Add to Inventory Title Map
**File**: `public/ui/InventoryUI.js`
**Location**: Around line 1138-1144

```javascript
// Find the titleMap for inventory UI
const titleMap = {
    'tent': 'Tent',
    'crate': 'Crate',
    'house': 'House',
    'garden': 'Garden',
    'your_structure_name': 'Your Structure Name'  // ADD HERE
};
```

#### 12c. Add to Button Text Map
**File**: `public/ui.js`
**Location**: Around line 121-126

```javascript
// Find the buttonTextMap for the inventory button
const buttonTextMap = {
    'tent': 'Tent',
    'crate': 'Crate',
    'house': 'House',
    'garden': 'Garden',
    'your_structure_name': 'Your Structure Name'  // ADD HERE
};
```

#### Why is Step 13 Critical?

These three client-side files work together to detect when a player is near your structure and display the inventory UI:

1. **ObjectManager.js** - Detects proximity (within 1.2 units) and sets `gameState.nearestCrate`
2. **ui.js** - Shows/hides the inventory button based on proximity
3. **InventoryUI.js** - Renders the correct title when inventory is opened

**Real-world bug example:** The garden structure initially had:
- ✅ Server-side inventory initialized correctly
- ✅ Inventory size configured in config.js (2x2)
- ❌ NOT added to ObjectManager.js proximity detection
- ❌ NOT added to ui.js button text map
- ❌ NOT added to InventoryUI.js title map

**Result:** Players could walk up to the garden but no button appeared. The inventory existed on the server but was completely inaccessible from the client!

**Testing Step 13:** After implementation, stand within 1.2 units of your structure and verify:
- A button with your structure's name appears in the UI
- Clicking the button opens the inventory
- The inventory displays the correct title
- The inventory has the correct number of rows/columns from your config

### STEP 14: Add Cascade Deletion for Foundation Removal
**File**: `server/MessageHandlers.js`
**Location**: Inside `handleRemoveObject()` method (around line 490)

**REQUIRED IF**: Your structure requires a foundation

When a foundation is removed, all structures on it must be cascade deleted:

```javascript
// Find the cascade deletion logic (around line 490)
if (hasSingleFoundation || hasMultipleFoundations) {
    if (change.name === 'crate' ||
        change.name === 'house' ||
        change.name === 'your_structure_name' ||  // ADD YOUR STRUCTURE HERE
        change.name === 'market') {
        cratesToRemove.push({
            // ... structure removal data
        });
    }
}
```

**Note**: This ensures that when a player removes a foundation, your structure (and its inventory if applicable) is automatically deleted along with it.

**IMPORTANT**: Cascade deletion only works if Step 12 (Foundation Reference) is properly implemented. The structure MUST have its `foundationId` stored when built. Structures built before adding these steps will NOT cascade delete and must be manually removed or the chunk files must be reset.

### STEP 15: Add Player Collision (If Solid Structure)
**File**: `public/world/StructureManager.js`
**Location**: Inside `checkStructureCollision()` method (around line 650)

**REQUIRED IF**: Your structure should block player movement (solid structures like house, market)

Add your structure to the solid structure check:

```javascript
// Around line 650-651
const isSolidStructure = obj.userData.modelType === 'house' ||
                        obj.userData.modelType === 'market' ||
                        obj.userData.modelType === 'your_structure_name';  // ADD HERE
```

**Collision Types**:

1. **Circular Collision** (default):
   - Default structures: 0.6 unit radius
   - Large structures (house): 1.0 unit radius

2. **Rectangular Collision** (for 2x8 structures like market):
   - Uses rotated bounding box
   - Matches 2x8 foundation footprint (2 units wide × 8 units deep)

To add circular collision:
```javascript
const collisionRadius = (obj.userData.modelType === 'house' ||
                        obj.userData.modelType === 'your_structure_name') ? 1.0 : 0.6;
```

To add rectangular collision (for 2x8 structures):
```javascript
if (obj.userData.modelType === 'market' || obj.userData.modelType === 'your_structure_name') {
    // Use rotated rectangular bounds (see market example in code)
    const rotation = obj.rotation.y;
    const localX = position.x - obj.position.x;
    const localZ = position.z - obj.position.z;
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    const rotatedX = localX * cos - localZ * sin;
    const rotatedZ = localX * sin + localZ * cos;

    if (Math.abs(rotatedX) < 1.0 && Math.abs(rotatedZ) < 4.0) {
        return { hasCollision: true };
    }
}
```

**Note**: This prevents players from walking through your structure, similar to construction sites. Structures NOT in this list will be walkable (useful for decorative objects).

### STEP 16: Add Icon Image
Place your 64x64 pixel PNG icon at:
```
public/structures/your_structure_name.png
```

### STEP 17: Add 3D Model
Place your GLB model file at:
```
public/models/your_structure_name.glb
```

---

## Structure Types and Options

### Basic Structure (Places on Terrain)
```javascript
{
    id: 'watchtower',
    type: 'watchtower',
    name: 'Watchtower',
    width: 1,
    height: 1,
    imagePath: './structures/watchtower.png'
}
```

### Foundation-Required Structure
```javascript
{
    id: 'storage_chest',
    type: 'storage_chest',
    name: 'Storage Chest',
    width: 1,
    height: 1,
    imagePath: './structures/storage_chest.png',
    requiresFoundation: true,
    hasInventory: true
}
```

### Water Structure
```javascript
{
    id: 'dock',
    type: 'dock',
    name: 'Dock',
    width: 1,
    height: 1,
    imagePath: './structures/dock.png',
    requiresWater: true,
    instantBuild: true
}
```

### Large Foundation Structure
```javascript
{
    id: 'warehouse',
    type: 'warehouse',
    name: 'Warehouse',
    width: 1,
    height: 1,
    imagePath: './structures/warehouse.png',
    requiresFoundation: true,
    requires2x8Foundation: true,
    rotationConstraint: 180,
    hasInventory: true
}
```

---

## Examples

### Example 1: Adding a Simple Watchtower

**1. objects.js:**
```javascript
watchtower: {
    path: './models/watchtower.glb',
    heightRange: { min: 0, max: 0 },
    scaleRange: { min: 0, max: 0 },
    density: 0,
    category: 'structure'
}
```

**2. BuildMenu.js:**
```javascript
{
    id: 'watchtower',
    type: 'watchtower',
    name: 'Watchtower',
    width: 1,
    height: 1,
    imagePath: './structures/watchtower.png'
}
```

**3. config.js:**
```javascript
watchtower: {
    oakplank: 10,
    chiseledlimestone: 5
}
```

### Example 2: Adding a Storage Warehouse

**1. objects.js:**
```javascript
warehouse: {
    path: './models/warehouse.glb',
    heightRange: { min: 0, max: 0 },
    scaleRange: { min: 0, max: 0 },
    density: 0,
    category: 'structure'
}
```

**2. BuildMenu.js:**
```javascript
{
    id: 'warehouse',
    type: 'warehouse',
    name: 'Warehouse',
    width: 1,
    height: 1,
    imagePath: './structures/warehouse.png',
    requiresFoundation: true,
    hasInventory: true
}
```

**3. config.js (MATERIALS):**
```javascript
warehouse: {
    oakplank: 20,
    chiseledlimestone: 10,
    chiseledsandstone: 10
}
```

**4. config.js (STRUCTURE_PROPERTIES):**
```javascript
warehouse: {
    height: 5.0,
    inventorySize: { rows: 15, cols: 15 }
}
```

**5. Client-side proximity (3 files):**

**ObjectManager.js:**
```javascript
} else if (object.userData.modelType === 'crate' ||
           object.userData.modelType === 'tent' ||
           object.userData.modelType === 'house' ||
           object.userData.modelType === 'warehouse') {
```

**InventoryUI.js:**
```javascript
const titleMap = {
    'tent': 'Tent',
    'crate': 'Crate',
    'house': 'House',
    'warehouse': 'Warehouse'
};
```

**ui.js:**
```javascript
const buttonTextMap = {
    'tent': 'Tent',
    'crate': 'Crate',
    'house': 'House',
    'warehouse': 'Warehouse'
};
```

---

## Quick Reference

| Step | File | What to Add | Required? |
|------|------|-------------|-----------|
| 1 | `public/objects.js` | MODEL_CONFIG entry | ✅ Always |
| 2 | `public/ui/BuildMenu.js` | Structure definition in array | ✅ Always |
| 3 | `public/config.js` | MATERIALS entry | ✅ Always |
| 4 | `public/ui/BuildMenu.js` | Preview scale (line ~404) | ✅ Always |
| 5 | `public/config.js` | STRUCTURE_PROPERTIES (optional) | If inventory/special |
| 6 | `public/world/StructureManager.js` | Preview Y-position (line ~66) | If requiresFoundation |
| 7 | `public/ui/BuildMenu.js` | Construction site Y-position (line ~559) | If requiresFoundation |
| 8 | `server/MessageHandlers.js` | Material requirements (line ~185) | ✅ Always |
| 9 | `server/MessageHandlers.js` | Final Y position (line ~301) | If requiresFoundation |
| 10 | `server/MessageHandlers.js` | Final scale (line ~307) | ✅ Always |
| 11 | `server/MessageHandlers.js` | Foundation ref & inventory (line ~343) | If foundation/inventory |
| 12 | `ObjectManager.js, InventoryUI.js, ui.js` | Client-side inventory proximity | ⚠️ If hasInventory |
| 13 | `server/MessageHandlers.js` | Cascade deletion (line ~490) | If requiresFoundation |
| 14 | `public/world/StructureManager.js` | Collision skip list (line ~783) | ⚠️ If requiresFoundation |
| 15 | `public/world/StructureManager.js` | Player collision (line ~650) | If solid structure |
| 16 | `public/structures/*.png` | 64x64 icon | ✅ Always |
| 17 | `public/models/*.glb` | 3D model file | ✅ Always |

---

## Troubleshooting

### Inventory Not Opening When Near Structure

**Symptom**: You walk up to a structure with `hasInventory: true`, but no button appears and you can't access the inventory.

**Cause**: The structure was not added to the client-side proximity detection and UI systems (Step 13).

**Solution**:
1. Verify Step 13a: Check `public/world/ObjectManager.js` around line 119
   - Your structure type must be in the `else if` chain for crate detection

2. Verify Step 13b: Check `public/ui/InventoryUI.js` around line 1138
   - Your structure must be in the `titleMap` object

3. Verify Step 13c: Check `public/ui.js` around line 121
   - Your structure must be in the `buttonTextMap` object

4. After adding all three locations, refresh the browser (F5) to load the updated code

**Testing**: Stand within 1.2 units of your structure. You should see:
- A button with your structure's name appear on the UI
- Clicking the button should open the inventory grid
- The inventory title should show your structure's name

### Inventory Has Wrong Number of Slots

**Symptom**: The inventory opens, but it has the wrong number of slots (e.g., shows 10x10 when you want 2x2).

**Cause**: The inventory size was not configured in `config.js` STRUCTURE_PROPERTIES, or the configuration is being ignored by the client code.

**Solution**:
1. Verify Step 5: Check `public/config.js` around line 280
   - Your structure must have an entry in `STRUCTURE_PROPERTIES`
   - Must include `inventorySize: { rows: X, cols: Y }`

2. Verify the client code is reading the config:
   - `public/ui/InventoryUI.js` around line 1177-1182 should dynamically read from CONFIG
   - The code should look like:
   ```javascript
   const structureProps = CONFIG.CONSTRUCTION.STRUCTURE_PROPERTIES[structureType];
   const rows = structureProps?.inventorySize?.rows || 10;
   const cols = structureProps?.inventorySize?.cols || 10;
   ```

3. Check your structure has been built AFTER adding the config
   - Structures built before config was added will use the old default size
   - You may need to remove and rebuild the structure

4. Refresh the browser (F5) after changing config.js

**Default Behavior**: If no `inventorySize` is configured, structures default to 10x10 (100 slots)

**Example Configurations**:
- Garden: `inventorySize: { rows: 2, cols: 2 }` → 4 slots
- Small chest: `inventorySize: { rows: 5, cols: 5 }` → 25 slots
- Large warehouse: `inventorySize: { rows: 15, cols: 15 }` → 225 slots
- Market: `inventorySize: { rows: 100, cols: 10 }` → 1000 slots with scrollbar

### Scrollbar Not Appearing for Large Inventory

**Symptom**: You configured a large inventory (e.g., 100 rows) but it shows all rows stacked vertically without a scrollbar, making it unusable.

**Cause**: The scrollbar implementation is in `InventoryUI.js` but may have been removed or modified incorrectly.

**Solution**:
1. Verify `InventoryUI.js` around line 1200-1215 has the scrollbar logic:
   ```javascript
   const maxVisibleRows = 10; // Show max 10 rows at a time

   if (rows > maxVisibleRows) {
       // Large inventory - enable scrolling
       const visibleHeight = slotSize * maxVisibleRows + gap * (maxVisibleRows - 1) + 4;
       crateGridContainer.style.maxHeight = `${visibleHeight}px`;
       crateGridContainer.style.overflowY = 'auto';
   }
   ```

2. Verify scroll position is accounted for in drag/drop (around line 622-624):
   ```javascript
   const crateGridContainer = crateGrid.parentElement;
   const crateScrollTop = crateGridContainer.scrollTop;
   ```

3. Refresh the browser (F5) after verifying the code

**Expected Behavior**: Inventories with > 10 rows automatically show a scrollbar and display only 10 rows at a time. Drag/drop works seamlessly while scrolling.

### Foundation Blocked by Adjacent Structure

**Symptom**: You try to place a foundation next to your structure, but it says "Blocked by [structure_name]" even though there's plenty of space.

**Cause**: The structure was not added to the collision skip list in `StructureManager.js` (Step 11). Foundation-based structures need to be excluded from collision detection when placing foundations.

**Solution**:
1. Verify Step 11: Check `public/world/StructureManager.js` around line 781-785
   - Your structure must be in the collision skip list with market, house, crate, garden

2. Add your structure to the skip list:
   ```javascript
   if (objType === 'market' ||
       objType === 'house' ||
       objType === 'crate' ||
       objType === 'garden' ||
       objType === 'your_structure_name') {  // ADD HERE
       continue;
   }
   ```

3. Refresh the browser (F5) after updating the code

4. Try placing foundations adjacent to your structure again

**Why This Happens**:
- Foundation-based structures have bounding boxes for their 3D models
- Without the skip list, the system checks if the foundation collides with the structure's bounding box
- This causes false positives because the structure sits ON a foundation, not IN the ground
- The skip list tells the system "ignore structures that sit on foundations when checking foundation placement"

**Real-world Example**: The garden initially blocked adjacent foundation placement. Players couldn't expand their foundation grid next to gardens even though the garden only occupied its 1x1 foundation space. Adding garden to the skip list fixed this issue.

**Testing**: After adding to the skip list, you should be able to place foundations right next to your structure without blocking issues.

### Structure Not Deleted When Foundation Removed

**Symptom**: When you remove a foundation, structures on it remain floating in the air.

**Cause**: The structure's `foundationId` was not stored when it was built. This happens when:
- The structure was built BEFORE implementing Steps 11, 12, and 14
- Step 12 (Foundation Reference) was not properly implemented
- The server was not restarted after adding the code

**Solution**:
1. Check server logs when removing foundation - you should see:
   ```
   Found X structures and Y construction sites to cascade delete
   WARNING: garden garden_xxx in chunk_0,1 is missing foundationId - cannot cascade delete!
   ```

2. If you see the WARNING, the structure is missing `foundationId`. You have two options:
   - **Option A**: Manually remove the structure in-game
   - **Option B**: Delete/reset the chunk files in `public/chunk_*.JSON` (WARNING: This removes all progress)

3. Rebuild the structure after implementing all steps - new structures will properly cascade delete

**Prevention**: Always implement ALL steps (especially Step 12) before building structures in-game for testing.
---

## Understanding Structure Collision Detection

### How Collision Works

The game uses **3D bounding box collision detection** to prevent structures from overlapping.

**Collision Detection Method** (`public/world/StructureManager.js:746-803`):
1. Creates a bounding box around the preview model
2. Checks all objects in nearby chunks (3x3 grid around placement)
3. Compares preview box with existing object boxes
4. Returns list of colliding objects (or empty array if clear)

### Collision Rules by Structure Type

**1. Foundations Can Touch Each Other** (lines 772-778):
- Foundations **ignore other foundations** during collision checks
- This allows building continuous foundation platforms
- Foundations still collide with trees, rocks, tents, outposts, ships

**2. Foundation-Based Structures Are Ignored** (lines 781-785):
```javascript
// Skip collision with foundation-based structures
if (objType === 'market' || objType === 'house' || objType === 'crate' || objType === 'garden') {
    continue; // These don't block placement
}
```
- Structures that sit ON foundations don't block other placements
- This allows placing foundations next to occupied foundations
- **IMPORTANT**: If you add a new structure with `requiresFoundation: true`, you MUST add it to this list!

**3. Construction Sites Are Ignored** (line 767):
- Allows placing structures near active construction sites

### STEP 16: Add to Collision Skip List (If Foundation-Based)

**File**: `public/world/StructureManager.js`
**Location**: Around line 783

**REQUIRED IF**: Your structure has `requiresFoundation: true`

Without this, players won't be able to place foundations adjacent to your structure!

```javascript
// Find the collision skip list for foundation-based structures
if (objType === 'market' || objType === 'house' || objType === 'crate' ||
    objType === 'garden' || objType === 'your_structure_name') {  // ADD YOUR STRUCTURE HERE
    continue;
}
```

### Collision Behavior Examples

**Placing a Foundation**:
- ✅ Can touch other foundations (edge to edge)
- ❌ Blocked by trees, rocks, tents, outposts, ships
- ✅ Can be placed next to houses/crates/markets (ignores them)

**Placing a Tent** (no foundation):
- ❌ Blocked by ALL objects (trees, rocks, foundations, structures)
- Uses full 3D bounding box collision

**Placing a House** (requires foundation):
- ✅ Must be on a foundation
- Foundation handles collision - house itself doesn't block adjacent placement

### Special Cases

**2x8 Foundation During Position Phase**:
- Large foundations skip collision during initial positioning
- Collision is checked during rotation/confirmation phases
- Allows players to place and rotate to fit tight spaces

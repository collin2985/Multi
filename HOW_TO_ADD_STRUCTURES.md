# How to Add New Structures to the Game

This guide provides step-by-step instructions for adding new structures based on the current codebase implementation.

## Required Assets

### 1. 3D Model File
- **Format**: `.glb` (GLTF binary)
- **Location**: `public/models/[structure_name].glb`

### 2. Icon Image
- **Format**: `.png` (64x64 pixels recommended)
- **Location**: `public/structures/[structure_name].png`

---

## Implementation Steps

### STEP 1: Add Model Configuration
**File**: `public/objects.js`
**Location**: Inside the `MODEL_CONFIG` object

Add your structure definition:

```javascript
const MODEL_CONFIG = {
    // ... existing models ...

    your_structure_name: {
        path: './models/your_structure_name.glb',
        heightRange: { min: 0, max: 0 },  // Always 0 for structures
        scaleRange: { min: 0, max: 0 },   // Always 0 for structures
        density: 0,                        // Always 0 for player-built structures
        category: 'structure'              // Always 'structure' for buildings
    },
};
```

### STEP 2: Add to Build Menu
**File**: `public/ui/BuildMenu.js`
**Location**: Inside the `buildMenu.structures` array (around line 68)

Add your structure entry:

```javascript
structures: [
    // ... existing structures ...

    {
        id: 'your_structure_name',
        type: 'your_structure_name',         // Must match MODEL_CONFIG key
        name: 'Your Structure Display Name',  // Shown to player
        width: 1,                             // Grid width in build menu (usually 1)
        height: 1,                            // Grid height in build menu (usually 1)
        imagePath: './structures/your_structure_name.png',

        // Optional flags:
        hasInventory: true,          // Has storage capability
        requiresWater: true,         // Must be placed in water (like ship)
        instantBuild: true,          // Builds immediately without construction phase
        isPlantable: true,           // For plantable trees (requires seedType and treeType)
    },
]
```

### STEP 3: Set Preview Scale
**File**: `public/ui/BuildMenu.js`
**Location**: Inside scale assignment logic (around line 660-690)

Add your structure to the scale checks:

```javascript
// For scale 1.0 structures (most structures):
} else if (structure.type === 'your_structure_name') {
    previewScale = 1.0;
    glowScale = 1.02;
}

// For scale 0.5 structures (only tent uses this):
// } else if (structure.type === 'your_structure_name') {
//     previewScale = 0.5;
//     glowScale = 0.52;
// }
```

### STEP 4: Add Collision Dimensions
**File**: `public/config.js`
**Location**: Inside `CONFIG.CONSTRUCTION.GRID_DIMENSIONS` (around line 374)

Define collision box for your structure:

```javascript
GRID_DIMENSIONS: {
    // ... existing dimensions ...

    your_structure_name: {
        width: 1.0,    // Width in world units
        depth: 1.0,    // Depth in world units
        height: 2.0    // Height for collision
    },
}
```

### STEP 4.5: Add Material Requirements (Critical)
**File**: `public/config.js`
**Location**: Inside `CONFIG.CONSTRUCTION.MATERIALS` (around line 428-459)

**IMPORTANT**: Without this step, the structure can be placed without any materials!

Add your structure's material requirements:

```javascript
CONSTRUCTION: {
    MATERIALS: {
        // ... existing materials ...

        your_structure_name: {
            oakplank: 5,           // Any plank type works (oak/pine/fir/cypress)
            chiseledlimestone: 2   // Any chiseled stone works (limestone/sandstone)
        }
    }
}
```

**How Material Checking Works:**
1. BuildMenu.js checks materials when rendering (grays out icon if missing)
2. Checks again when clicked (shows "Missing materials" message)
3. If no CONFIG entry exists, structure can be placed WITHOUT materials

**Available Materials:**
- **Planks**: `oakplank`, `pineplank`, `firplank`, `cypressplank` (interchangeable)
- **Chiseled Stone**: `chiseledlimestone`, `chiseledsandstone` (interchangeable)
- **Raw Stone**: `limestone`, `sandstone`, `clay`
- **Firewood**: `oakfirewood`, `pinefirewood`, `firfirewood`, `cypressfirewood`

### STEP 4.6: Custom Construction Model (Optional)
**File**: `public/config.js`
**Location**: Inside `CONFIG.CONSTRUCTION.CONSTRUCTION_MODELS` (around line 421)

**Use this if you want a custom construction site model instead of the default**

```javascript
CONSTRUCTION_MODELS: {
    // ... existing models ...

    your_structure_name: '3x3construction'  // Or your custom construction model
}
```

**Available Construction Models:**
- `construction` - Default 1x1 construction site
- `2x8construction` - For large structures like market
- `10x1construction` - For long structures like dock
- `3x3construction` - For 3x3 structures like tileworks

**To add a new construction model:**
1. Add the model file (e.g., `5x5construction.glb`) to `public/models/`
2. Add to MODEL_CONFIG in `objects.js`:
   ```javascript
   '5x5construction': {
       path: './models/5x5construction.glb',
       heightRange: { min: 0, max: 0 },
       scaleRange: { min: 0, max: 0 },
       density: 0,
       category: 'structure'
   }
   ```
3. Map your structure to use it in CONSTRUCTION_MODELS

**Note**: If not specified, structures use the default `construction` model.

### STEP 5: Configure Inventory (If Applicable)
**File**: `public/config.js`
**Location**: Inside `CONFIG.CONSTRUCTION.STRUCTURE_PROPERTIES` (around line 462)

**REQUIRED IF**: Your structure has `hasInventory: true`

```javascript
STRUCTURE_PROPERTIES: {
    // ... existing properties ...

    your_structure_name: {
        height: 3.0,  // Structure height at its scale
        inventorySize: { rows: 10, cols: 10 }  // Inventory grid size
    },
}
```

**Common inventory sizes:**
- Small: `{ rows: 2, cols: 2 }` (4 slots) - garden
- Medium: `{ rows: 4, cols: 4 }` (16 slots) - campfire
- Large: `{ rows: 10, cols: 10 }` (100 slots) - house, crate, market

### STEP 6: Add Material Requirements (Server-Side)
**File**: `server/MessageHandlers.js`
**Location**: Inside `handlePlaceConstructionSite()` method (around line 260-280)

Add your structure's material requirements:

```javascript
if (targetStructure === 'crate') {
    requiredMaterials = { 'oakplank': 1 };
} else if (targetStructure === 'your_structure_name') {  // ADD HERE
    requiredMaterials = {
        'oakplank': 5,           // Any plank type works
        'chiseledlimestone': 2   // Or chiseledsandstone
    };
} else if (targetStructure === 'house') {
    requiredMaterials = { 'oakplank': 1 };
}
```

**Available materials:**
- Planks: `oakplank`, `pineplank`, `firplank`, `cypressplank` (interchangeable)
- Chiseled stone: `chiseledlimestone`, `chiseledsandstone` (interchangeable)
- Raw stone: `limestone`, `sandstone`, `clay`

### STEP 7: Set Structure Scale (Server-Side)
**File**: `server/MessageHandlers.js`
**Location**: Inside `handleBuildConstruction()` method (around line 552-570)

Add scale determination for your structure:

```javascript
// Determine scale
let structureScale = 0.5;  // Default (only tent uses this)
if (constructionSite.targetStructure === 'dock') {
    structureScale = 1.0;
} else if (constructionSite.targetStructure === 'your_structure_name') {  // ADD HERE
    structureScale = 1.0;  // Use 1.0 for most structures
}
```

### STEP 8: Enable Terrain Leveling (Critical for Most Structures)
**File**: `public/network/MessageRouter.js`
**Location**: Around line 567

**IMPORTANT**: Add your structure to the terrain leveling list if it should flatten the ground beneath it:

```javascript
const structuresToLevel = ['crate', 'house', 'garden', 'outpost', 'tent', 'market',
                          'your_structure_name'];  // ADD HERE
```

**What This Does:**
- Flattens terrain under the structure to prevent floating/buried placement
- Creates smooth transitions around structure edges
- Uses structure's GRID_DIMENSIONS for leveling area
- Automatically triggered when structure is placed or loaded
- The `finalFoundationY` is calculated as average of 4 corner heights

**Note**: Without this, structures may appear floating or partially buried on uneven terrain.

### STEP 9: Add to Structure Proximity Detection
**File**: `public/game.js`
**Location**: Around line 2617

Add your structure to the `structureTypes` array:

```javascript
const structureTypes = ['crate', 'tent', 'house', 'garden', 'market',
                        'outpost', 'ship', 'dock', 'campfire',
                        'your_structure_name'];  // ADD HERE
```

### STEP 10: Configure Inventory UI (If Has Inventory)
**File**: `public/ui.js`
**Location**: Inside `buttonTextMap` (around line 194)

**REQUIRED IF**: Your structure has `hasInventory: true`

```javascript
const buttonTextMap = {
    'tent': 'Tent',
    'crate': 'Crate',
    'house': 'House',
    'garden': 'Garden',
    'apple': 'Apple Tree',
    'market': 'Market',
    'campfire': 'Campfire',
    'your_structure_name': 'Your Structure Name'  // ADD HERE
};
```

### STEP 11: Add Inventory Title
**File**: `public/ui/InventoryUI.js`
**Location**: Inside `titleMap` (around line 1728)

**REQUIRED IF**: Your structure has `hasInventory: true`

```javascript
const titleMap = {
    'tent': 'Tent',
    'crate': 'Crate',
    'house': 'House',
    'garden': 'Garden',
    'apple': 'Apple Tree',
    'market': 'Market',
    'campfire': 'Campfire',
    'your_structure_name': 'Your Structure Name'  // ADD HERE
};
```

### STEP 12: Initialize Inventory (Server-Side)
**File**: `server/MessageHandlers.js`
**Location**: Inside `handleBuildConstruction()` method (around line 595-610)

**REQUIRED IF**: Your structure has `hasInventory: true`

```javascript
// Initialize inventory for structures that have storage
if (constructionSite.targetStructure === 'house' ||
    constructionSite.targetStructure === 'your_structure_name') {  // ADD HERE
    structureChange.inventory = { items: [] };
}

// Also add to broadcast payload (around line 633)
if (constructionSite.targetStructure === 'house' ||
    constructionSite.targetStructure === 'your_structure_name') {  // ADD HERE
    addedPayload.inventory = { items: [] };
}
```

### STEP 13: Add Player Collision (Optional)
**File**: `public/world/StructureManager.js`
**Location**: Inside `checkStructureCollision()` method (around line 650)

**OPTIONAL**: Only if your structure should block player movement

```javascript
const isSolidStructure = obj.userData.modelType === 'house' ||
                        obj.userData.modelType === 'market' ||
                        obj.userData.modelType === 'your_structure_name';  // ADD HERE
```

### STEP 14: Add Structure Removal Tracking
**File**: `public/game.js`
**Location**: Around line 1055

Add your structure to removal tracking if needed:

```javascript
const structureTypes = ['construction', 'foundation', 'foundationcorner',
                        'foundationroundcorner', 'crate', 'tent', 'house',
                        'garden', 'market', 'outpost', 'ship', 'dock',
                        'your_structure_name'];  // ADD HERE
```

### STEP 15: Enable Demolish Button
**File**: `public/ui.js`
**Location**: Around line 287

**CRITICAL**: Add your structure to the demolish-enabled list:

```javascript
const structureTypes = ['crate', 'tent', 'house', 'garden', 'market',
                        'outpost', 'ship', 'dock', 'campfire',
                        'your_structure_name'];  // ADD HERE
```

**Note**: Without this, players can't demolish the structure!

**Important**: Construction sites are handled separately with `isConstructionSite` flag and don't need to be in this list.

### STEP 16: Add Smoke Effects (Optional)
**For structures with chimneys or smoke sources**

#### Single Smoke Source (like campfire)

**1. Add smoke creation method in `game.js` (after addCampfireSmoke, around line 3160):**

```javascript
addStructureSmoke(objectId, position) {
    if (this.smokeEffects.has(objectId)) {
        return; // Prevent duplicates
    }

    const smokeEffect = new SmokeEffect(this.scene, {
        x: position.x,
        y: position.y + 3,  // Adjust height as needed
        z: position.z
    });

    smokeEffect.start();  // Or .stop() to start inactive
    this.smokeEffects.set(objectId, smokeEffect);
}
```

**2. Trigger smoke in `MessageRouter.js` (around line 455):**

```javascript
// Add smoke effect for your structure
if (structureType === 'your_structure') {
    this.game.addStructureSmoke(objectInstance.userData.objectId, objectInstance.position);
}
```

#### Multiple Smoke Sources (like tileworks with 2 chimneys)

**1. Add method for multiple smoke sources in `game.js`:**

```javascript
addTileworksSmoke(objectId, position, rotation = 0) {
    // Rotate chimney offsets based on structure rotation
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    // Local space offset for chimney 1
    const local1X = 1.5, local1Z = 1.5;
    const rotated1X = local1X * cos - local1Z * sin;
    const rotated1Z = local1X * sin + local1Z * cos;

    const smoke1 = new SmokeEffect(this.scene, {
        x: position.x + rotated1X,
        y: position.y + 3,    // Height of chimney
        z: position.z + rotated1Z
    });

    // Local space offset for chimney 2
    const local2X = -1.5, local2Z = -1.5;
    const rotated2X = local2X * cos - local2Z * sin;
    const rotated2Z = local2X * sin + local2Z * cos;

    const smoke2 = new SmokeEffect(this.scene, {
        x: position.x + rotated2X,
        y: position.y + 3,
        z: position.z + rotated2Z
    });

    smoke1.start();
    smoke2.start();

    // Store with unique keys
    this.smokeEffects.set(objectId + '_1', smoke1);
    this.smokeEffects.set(objectId + '_2', smoke2);
}
```

**3. Handle removal in `MessageRouter.js` handleObjectRemoved (around line 730):**

```javascript
// Remove smoke effects for structures with multiple sources
if (modelType === 'your_structure') {
    const smoke1 = this.game.smokeEffects.get(payload.objectId + '_1');
    const smoke2 = this.game.smokeEffects.get(payload.objectId + '_2');

    if (smoke1) {
        smoke1.remove();
        this.game.smokeEffects.delete(payload.objectId + '_1');
    }
    if (smoke2) {
        smoke2.remove();
        this.game.smokeEffects.delete(payload.objectId + '_2');
    }
}
```

**Smoke Effect Parameters:**
- **Position**: `{ x, y, z }` in world coordinates
- **Y-axis**: Vertical (increase for higher smoke origin)
- **Particles**: Rise ~8 units, drift leftward with arc
- **Always-on**: Call `.start()` immediately
- **Conditional**: Use `.stop()` initially, control with game logic

#### ⚠️ Critical Smoke Effect Issues to Avoid

**1. Smoke Update Loop Conflict**
The game's smoke update loop (around line 1871 in game.js) checks ALL smoke effects for campfire logic. For non-campfire smoke:

```javascript
// Add special handling for your structure's smoke
const isYourStructureSmoke = objectId.includes('your_structure') &&
                             (objectId.endsWith('_1') || objectId.endsWith('_2'));

if (isYourStructureSmoke) {
    smokeEffect.update(deltaSeconds);
    continue; // Skip campfire logic
}
```

**2. Texture Loading**
Ensure smoke texture loads from local file, not external URL:
```javascript
// Good
const smokeTexture = new THREE.TextureLoader().load('./terrain/smoke.png');

// Bad (external dependency)
const smokeTexture = new THREE.TextureLoader().load('https://external-url...');
```

**3. Unique Smoke IDs for Multiple Sources**
Use unique suffixes to prevent ID conflicts:
```javascript
this.smokeEffects.set(objectId + '_1', smoke1);  // First smoke
this.smokeEffects.set(objectId + '_2', smoke2);  // Second smoke
```

---

## Quick Reference Checklist

| Step | File | Description | Required |
|------|------|-------------|----------|
| 1 | `public/objects.js` | MODEL_CONFIG entry | ✅ Always |
| 2 | `public/ui/BuildMenu.js` | Structure definition | ✅ Always |
| 3 | `public/ui/BuildMenu.js` | Preview scale | ✅ Always |
| 4 | `public/config.js` | GRID_DIMENSIONS (enables dirt painting) | ✅ Always |
| 4.5 | `public/config.js` | MATERIALS (critical for requirements) | ✅ Always |
| 4.6 | `public/config.js` | CONSTRUCTION_MODELS | If custom construction |
| 5 | `public/config.js` | STRUCTURE_PROPERTIES | If hasInventory |
| 6 | `server/MessageHandlers.js` | Material requirements | ✅ Always |
| 7 | `server/MessageHandlers.js` | Structure scale | ✅ Always |
| 8 | `public/network/MessageRouter.js` | Terrain leveling | ✅ Recommended |
| 9 | `public/game.js` | Proximity detection | ✅ Always |
| 10 | `public/ui.js` | Inventory button text | If hasInventory |
| 11 | `public/ui/InventoryUI.js` | Inventory title | If hasInventory |
| 12 | `server/MessageHandlers.js` | Initialize inventory | If hasInventory |
| 13 | `public/world/StructureManager.js` | Player collision | Optional |
| 14 | `public/game.js` | Removal tracking | ✅ Always |
| 15 | `public/ui.js` | Demolish button | ✅ Always |
| 16 | `public/game.js` + `MessageRouter.js` | Smoke effects | If has chimneys |
| 17 | `public/structures/*.png` | Icon file | ✅ Always |
| 18 | `public/models/*.glb` | 3D model | ✅ Always |

---

## Examples

### Example 1: Simple Structure (No Inventory)
For a decorative structure like a statue:

1. Add to MODEL_CONFIG in objects.js
2. Add to BuildMenu.js structures array
3. Set preview scale to 1.0
4. Add GRID_DIMENSIONS
5. Add material requirements in server
6. Set structure scale to 1.0 in server
7. Add to proximity detection
8. Add to removal tracking

### Example 2: Storage Structure
For a structure with inventory like a chest:

1. Complete all steps from Example 1
2. Add `hasInventory: true` to BuildMenu.js
3. Add STRUCTURE_PROPERTIES with inventorySize
4. Add to buttonTextMap in ui.js
5. Add to titleMap in InventoryUI.js
6. Initialize inventory in server

### Example 3: Special Structure (Water/Instant Build)
For structures like docks or decorative items:

1. Complete basic steps
2. Add `requiresWater: true` for water placement
3. Add `instantBuild: true` to skip construction phase

---

## Troubleshooting

### Structure Not Appearing in Build Menu
- Check that the structure is added to `buildMenu.structures` array
- Verify the icon exists at the specified path
- Check browser console for errors

### Structure Can Be Placed Without Materials
- **Critical**: Check that structure is in `CONFIG.CONSTRUCTION.MATERIALS`
- Without CONFIG entry, `checkRequiredMaterials()` returns true by default
- Verify material types match inventory item names exactly
- Check browser console for material checking errors

### Construction Site Won't Place
- Verify material requirements are set in server
- Check that player has required materials
- Verify GRID_DIMENSIONS are set

### Construction Site Has No Demolish Button
- Construction sites require special handling in ui.js
- They use the `isConstructionSite` userData flag
- The demolish logic must check for both regular structures AND `isConstructionSite`
- Model types for construction sites ('construction', '2x8construction', etc.) are not in the structure list

### Inventory Not Opening
- Ensure `hasInventory: true` is set
- Check buttonTextMap and titleMap entries
- Verify inventory initialization in server
- Check STRUCTURE_PROPERTIES has inventorySize

### Scale Issues
- Verify preview scale in BuildMenu.js
- Check structure scale in server
- Ensure both match (usually 1.0)

### Collision Problems
- Check GRID_DIMENSIONS values
- Verify collision detection if solid structure
- Test with different placement angles

---

## Notes

- **Foundations are no longer used** - structures place directly on terrain
- **All plank types** (oak, pine, fir, cypress) are interchangeable in recipes
- **Chiseled stone types** (limestone, sandstone) are interchangeable
- **Default scale** is 1.0 for most structures (only tent uses 0.5)
- **Inventory sizes** should match the structure's visual size
- **Materials are hardcoded** in server, not in config files

### Terrain Systems

#### Terrain Leveling
- Activated by adding structure to `structuresToLevel` array in MessageRouter.js
- Flattens terrain under structure based on GRID_DIMENSIONS
- Creates smooth 1-unit transitions around edges
- Uses average of 4 corner heights as target level
- Critical for preventing floating/buried structures

#### Dirt Painting (Automatic)
- **Automatically enabled** when GRID_DIMENSIONS is defined for a structure
- Paints dirt texture in a circular gradient around structures
- Excludes water structures (dock, ship) from dirt painting
- Processed asynchronously over multiple frames for performance
- Creates realistic "worn ground" effect around buildings
- No additional configuration needed - just define GRID_DIMENSIONS!
# Structure Implementation Guide
## Step-by-Step: How to Add a New Buildable Structure

**Author:** Claude Code
**Date:** 2025-01-22
**Purpose:** Complete guide for adding new structures to the game, based on foundation implementation

---

## Table of Contents
1. [Overview of the System](#overview)
2. [Code Flow: Foundation Placement](#code-flow)
3. [Step-by-Step Implementation](#implementation-steps)
4. [Example: Adding a Wall Structure](#example)
5. [Common Pitfalls](#pitfalls)

---

## Overview of the System

### Key Concepts

**Structure Types:**
- **Foundation structures** (foundation, foundationcorner, foundationroundcorner): Place directly on terrain, go through 3 phases
- **Foundation-dependent structures** (crate): Require a foundation below, skip height phase

**Placement Flow:**
1. Player opens build menu (B key)
2. Player clicks structure in build menu
3. **Position Phase**: Player moves mouse to position structure, click to confirm
4. **Rotation Phase**: Player rotates with mouse movement, click to confirm
5. **Height Phase** (foundations only): Player adjusts vertical position, click to confirm
6. Construction site spawns (requires materials)
7. Player adds materials to construction site
8. Player completes construction with hammer

### Files Involved
- `public/game.js` - Main game logic, placement system
- `public/objects.js` - 3D model configuration and loading
- `public/config.js` - Game constants and configuration
- `server.js` - Server-side placement validation and persistence
- `public/models/` - 3D model files (.glb format)
- `public/structures/` - UI icon images (64x64 recommended)

---

## Code Flow: Foundation Placement

### Phase 1: Player Opens Build Menu
**File:** `game.js`
**Line:** ~3700 (toggleBuildMenu)

```javascript
// Player presses 'B' key
toggleBuildMenu() {
    this.buildMenuOpen = !this.buildMenuOpen;
    if (this.buildMenuOpen) {
        this.renderBuildMenu(); // Shows UI with structures
    }
}
```

### Phase 2: Player Clicks Structure
**File:** `game.js`
**Line:** ~3831 (onBuildMenuClick)

```javascript
// Player clicks foundation icon in build menu
onBuildMenuClick(event) {
    // ... find which structure was clicked ...
    this.startFoundationPlacement(structure); // Begin placement flow
}
```

### Phase 3: Start Placement
**File:** `game.js`
**Line:** ~3863 (startFoundationPlacement)

```javascript
startFoundationPlacement(structure) {
    // 1. Set placement state
    this.gameState.foundationPlacement.active = true;
    this.gameState.foundationPlacement.phase = 'position';
    this.gameState.foundationPlacement.structure = structure;

    // 2. Create semi-transparent preview model
    const structureModel = modelManager.getModel(structure.type);
    const foundationPreview = structureModel.clone();
    foundationPreview.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            child.material = child.material.clone();
            child.material.transparent = true;
            child.material.opacity = 0.6; // Ghost effect
        }
    });

    // 3. Add to scene
    this.scene.add(previewGroup);

    // 4. Show instruction
    ui.updateStatusLine1('Move mouse to position foundation, click to confirm', 0);
}
```

### Phase 4: Update Preview (Every Frame)
**File:** `game.js`
**Line:** ~3922 (updateFoundationPreview)

```javascript
updateFoundationPreview(mouseX, mouseZ, mouseY) {
    if (placement.phase === 'position') {
        // Snap to 0.5 grid
        placement.position.x = Math.round(mouseX / 0.5) * 0.5;
        placement.position.z = Math.round(mouseZ / 0.5) * 0.5;

        // Sample terrain height at 4 corners
        const corner1 = terrainRenderer.heightCalculator.calculateHeight(x - halfSize, z - halfSize);
        const corner2 = terrainRenderer.heightCalculator.calculateHeight(x + halfSize, z - halfSize);
        const corner3 = terrainRenderer.heightCalculator.calculateHeight(x - halfSize, z + halfSize);
        const corner4 = terrainRenderer.heightCalculator.calculateHeight(x + halfSize, z + halfSize);
        const avgHeight = (corner1 + corner2 + corner3 + corner4) / 4;

        // Position preview at average height
        previewBox.position.set(x, avgHeight, z);

        // Validate placement
        this.validateFoundationPlacement();
    }
    else if (placement.phase === 'rotation') {
        // Rotate based on mouse angle from center
        const angle = Math.atan2(mouseZ - z, mouseX - x);
        placement.rotation = angle;
        previewBox.rotation.y = angle;
    }
    else if (placement.phase === 'height') {
        // Adjust height based on mouse Y movement
        const mouseDelta = mouseY - placement.initialMouseY;
        placement.height = Math.max(-5, Math.min(5, mouseDelta * 0.01));
        previewBox.position.y = avgHeight + placement.height;
    }
}
```

### Phase 5: Advance Through Phases
**File:** `game.js`
**Line:** ~4173 (advanceFoundationPlacementPhase)

```javascript
advanceFoundationPlacementPhase(mouseY) {
    if (placement.phase === 'position') {
        if (!placement.isValid) {
            // Cancel on invalid position
            this.cancelFoundationPlacement();
            return;
        }
        // Move to rotation
        placement.phase = 'rotation';
        ui.updateStatusLine1('Move mouse to rotate, click to confirm', 0);
    }
    else if (placement.phase === 'rotation') {
        if (structure.requiresFoundation) {
            // Foundation-dependent structures skip height phase
            this.confirmFoundationPlacement();
        } else {
            // Foundations go to height adjustment
            placement.phase = 'height';
            placement.initialMouseY = mouseY;
            ui.updateStatusLine1('Move mouse up/down to adjust height, click to confirm', 0);
        }
    }
    else if (placement.phase === 'height') {
        // Final confirmation for foundations
        this.confirmFoundationPlacement();
    }
}
```

### Phase 6: Confirm Placement
**File:** `game.js`
**Line:** ~4206 (confirmFoundationPlacement)

```javascript
confirmFoundationPlacement() {
    // For regular foundations:
    // 1. Calculate final Y position
    const previewFinalY = placement.position.y + placement.height;

    // 2. Send to server
    this.networkManager.sendMessage('place_construction_site', {
        position: [x, averageHeight, z],
        rotation: placement.rotation,
        scale: 0.017,
        targetStructure: structure.type, // 'foundation', 'foundationcorner', etc.
        finalFoundationY: previewFinalY  // Final Y after construction
    });

    // 3. Clean up preview
    this.cancelFoundationPlacement();
}
```

### Phase 7: Server Creates Construction Site
**File:** `server.js`
**Line:** ~357 (message handler: 'place_construction_site')

```javascript
case 'place_construction_site':
    const { position, rotation, scale, targetStructure, finalFoundationY } = payload;

    // 1. Calculate which chunk this belongs to
    const chunkX = Math.floor(position[0] / 16);
    const chunkZ = Math.floor(position[2] / 16);
    const chunkId = `chunk_${chunkX},${chunkZ}`;

    // 2. Generate unique ID
    const constructionId = `construction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 3. Define material requirements
    let requiredMaterials;
    if (targetStructure === 'foundation') {
        requiredMaterials = {
            chiseledlimestone: 4,
            chiseledsandstone: 4
        };
    }
    // ... (other structure types)

    // 4. Add to chunk data
    const constructionSite = {
        id: constructionId,
        name: 'construction',
        position: position,
        rotation: rotation,
        scale: scale,
        isConstructionSite: true,
        targetStructure: targetStructure,
        requiredMaterials: requiredMaterials,
        materials: {}, // Empty until player adds materials
        finalFoundationY: finalFoundationY
    };

    chunkData.objects.push(constructionSite);
    saveChunk(chunkId, chunkData);

    // 5. Broadcast to all nearby clients
    broadcastTo3x3Grid(chunkId, {
        type: 'object_added',
        payload: { /* construction site data */ }
    });
```

### Phase 8: Client Receives Construction Site
**File:** `game.js`
**Line:** ~1392 (handleChunkObjectsState)

```javascript
// Client receives 'object_added' message
const objectInstance = modelManager.getModel('construction').clone();
objectInstance.position.set(position[0], position[1], position[2]);
objectInstance.rotation.y = rotation;
objectInstance.scale.setScalar(scale);

// Store metadata
objectInstance.userData.objectId = objectId;
objectInstance.userData.isConstructionSite = true;
objectInstance.userData.targetStructure = targetStructure;
objectInstance.userData.requiredMaterials = requiredMaterials;
objectInstance.userData.materials = materials;
objectInstance.userData.finalFoundationY = finalFoundationY;

this.scene.add(objectInstance);
```

### Phase 9: Player Adds Materials
**File:** `game.js`
**Line:** ~3543 (onCrateMouseUp - construction section)

```javascript
// When player drops item from inventory onto construction site
const requiredMaterials = constructionSite.userData.requiredMaterials;
const currentMaterials = constructionSite.userData.materials;

if (requiredMaterials[itemType]) {
    const current = currentMaterials[itemType] || 0;
    if (current < requiredMaterials[itemType]) {
        // Add material
        currentMaterials[itemType] = current + 1;

        // Remove from inventory
        this.gameState.inventory.items.splice(itemIndex, 1);

        // Update UI
        this.updateConstructionSection();
    }
}
```

### Phase 10: Player Completes Construction
**File:** `game.js`
**Line:** ~1860 (startBuildAction)

```javascript
startBuildAction() {
    // 1. Check if all materials satisfied
    const allMaterialsSatisfied = Object.entries(requiredMaterials).every(
        ([material, quantity]) => (currentMaterials[material] || 0) >= quantity
    );

    // 2. Start 6-second building action
    this.gameState.activeChoppingAction = {
        object: constructionSite,
        startTime: Date.now(),
        duration: CONFIG.ACTIONS.BUILD_DURATION, // 6000ms
        actionType: 'build'
    };

    // 3. Play hammer sound and animation
    this.audioManager.playHammerSound();
    this.choppingAction.play();
}
```

### Phase 11: Complete Building Action
**File:** `game.js`
**Line:** ~2011 (completeChoppingAction)

```javascript
// After 6 seconds, building completes
if (actionType === 'build') {
    // 1. Consume hammer durability
    hammer.durability -= CONFIG.TOOLS.HAMMER_DURABILITY_LOSS; // -5

    // 2. Send completion to server
    this.networkManager.sendMessage('build_construction', {
        constructionId: constructionSite.userData.objectId,
        chunkKey: constructionSite.userData.chunkKey
    });

    // 3. Update UI
    ui.updateStatusLine1('✅ Construction complete!', 3000);
}
```

### Phase 12: Server Completes Construction
**File:** `server.js`
**Line:** ~439 (message handler: 'build_construction')

```javascript
case 'build_construction':
    // 1. Find construction site in chunk data
    const constructionSite = findObjectInChunk(constructionId, chunkData);

    // 2. Replace construction site with final structure
    const finalStructure = {
        id: `${constructionSite.targetStructure}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: constructionSite.targetStructure, // 'foundation', 'foundationcorner', etc.
        position: [x, constructionSite.finalFoundationY, z], // Use stored Y
        rotation: constructionSite.rotation,
        scale: 0.5, // Full structure scale
        quality: null
    };

    // 3. Remove construction site, add final structure
    chunkData.objects = chunkData.objects.filter(obj => obj.id !== constructionId);
    chunkData.objects.push(finalStructure);
    saveChunk(chunkId, chunkData);

    // 4. Broadcast changes
    broadcastTo3x3Grid(chunkId, {
        type: 'object_removed',
        payload: { objectId: constructionId }
    });
    broadcastTo3x3Grid(chunkId, {
        type: 'object_added',
        payload: finalStructure
    });
```

### Phase 13: Client Shows Final Structure
**File:** `game.js`
**Line:** ~1392 (handleChunkObjectsState)

```javascript
// Client receives 'object_added' for final structure
const structureModel = modelManager.getModel('foundation').clone();
structureModel.position.set(position[0], position[1], position[2]);
structureModel.rotation.y = rotation;
structureModel.scale.setScalar(0.5); // Full scale

// Add blob shadow
const shadowSize = 3.0; // Foundation shadow size
const shadow = new BlobShadow(shadowSize);
shadow.position.y = 0.01;
structureModel.add(shadow);

this.scene.add(structureModel);
```

---

## Step-by-Step Implementation

### Adding a New Structure: "Wall"

Let's add a wall structure that can be placed on foundations, step by step.

### **STEP 1: Create 3D Model**
**File:** `public/models/wall.glb`

1. Create 3D model in Blender (or other 3D software)
2. Recommended dimensions: 2m wide × 3m tall × 0.3m thick (at scale 1.0)
3. Export as `.glb` file
4. Place in `public/models/` folder

**Key Points:**
- Model should be centered on origin
- Y-axis points up
- Face forward along positive Z-axis
- Keep polygon count reasonable (<5000 triangles)

---

### **STEP 2: Add to Model Configuration**
**File:** `public/objects.js` (MODEL_CONFIG object)

```javascript
// Add to MODEL_CONFIG object around line 119
wall: {
    path: './models/wall.glb',
    heightRange: { min: 0, max: 0 },  // Not randomly spawned
    scaleRange: { min: 0, max: 0 },   // Not randomly spawned
    density: 0,                       // Not randomly spawned
    category: 'structure'             // Mark as placeable structure
},
```

**Also add shadow size** (around line 349):
```javascript
const shadowSizes = {
    // ... existing entries ...
    'wall': 2.0,  // Shadow width in meters
};
```

---

### **STEP 3: Create UI Icon**
**File:** `public/structures/wall.png`

1. Create 64×64 pixel PNG image
2. Transparent background
3. Clear icon representing a wall
4. Save as `public/structures/wall.png`

---

### **STEP 4: Add to Build Menu**
**File:** `public/game.js` (build menu structures array, line ~243)

```javascript
structures: [
    // ... existing structures (foundation, crate, etc.) ...

    // NEW: Wall structure
    {
        id: 'wall',                    // Unique ID
        type: 'wall',                  // Must match MODEL_CONFIG key
        name: 'Wall',                  // Display name in UI
        width: 1,                      // Grid width in build menu
        height: 1,                     // Grid height in build menu
        imagePath: './structures/wall.png',
        requiresFoundation: true       // Must be placed on foundation
    }
]
```

**Key Field Explanations:**
- `id`: Unique identifier (convention: same as type)
- `type`: Must exactly match the key in `objects.js` MODEL_CONFIG
- `name`: What players see in the UI
- `width/height`: Size in build menu grid (usually 1×1)
- `imagePath`: Relative path to icon image
- `requiresFoundation`: true = must be placed on foundation (skips height phase)

---

### **STEP 5: Define Material Requirements**
**File:** `server.js` (place_construction_site handler, line ~371)

```javascript
// Inside the place_construction_site case
let requiredMaterials;
if (targetStructure === 'crate') {
    requiredMaterials = { planks: 8, firewood: 4 };
} else if (targetStructure === 'foundation') {
    requiredMaterials = { chiseledlimestone: 4, chiseledsandstone: 4 };
} else if (targetStructure === 'foundationcorner') {
    requiredMaterials = { chiseledlimestone: 2, chiseledsandstone: 2 };
} else if (targetStructure === 'foundationroundcorner') {
    requiredMaterials = { chiseledlimestone: 3, chiseledsandstone: 3 };
}
// NEW: Wall requirements
else if (targetStructure === 'wall') {
    requiredMaterials = {
        planks: 6,          // 6 planks
        limestone: 4        // 4 limestone blocks
    };
}
else {
    requiredMaterials = {}; // Unknown structure, no requirements
}
```

**Material IDs must match inventory item types:**
- `planks`, `firewood`, `limestone`, `sandstone`, `chiseledlimestone`, `chiseledsandstone`

---

### **STEP 6: (Optional) Add to Config Constants**
**File:** `public/config.js` (line ~172)

```javascript
CONSTRUCTION: {
    // Material requirements for different structures
    MATERIALS: {
        foundation: {
            chiseledlimestone: 4,
            chiseledsandstone: 4
        },
        foundationcorner: {
            chiseledlimestone: 2,
            chiseledsandstone: 2
        },
        foundationroundcorner: {
            chiseledlimestone: 3,
            chiseledsandstone: 3
        },
        // NEW: Wall materials
        wall: {
            planks: 6,
            limestone: 4
        }
    },
    // ...
}
```

*Note: This step is optional if you define materials in server.js only. Config is for centralized management.*

---

### **STEP 7: Adjust Y Position Calculation (For Foundation-Based Structures)**
**File:** `public/game.js` (updateFoundationPreview, line ~3943)

If your structure requires a foundation, you need to calculate its Y position:

```javascript
// Around line 3957
if (structure && structure.requiresFoundation) {
    const foundationBelow = this.findFoundationAtPosition(x, z);

    if (foundationBelow) {
        // Snap to foundation position
        placement.position.x = foundationBelow.position.x;
        placement.position.z = foundationBelow.position.z;

        // Calculate Y position
        const foundationHeight = 2.5;  // Foundation height at scale 0.5

        // NEW: Add wall height calculation
        let structureHeight;
        if (structure.type === 'crate') {
            structureHeight = 0.5;
        } else if (structure.type === 'wall') {
            structureHeight = 1.5;  // Wall height at scale 0.5 (3m at scale 1.0)
        }

        const extraOffset = 0.1; // Small gap
        const structureY = foundationBelow.position.y +
                          (foundationHeight / 2) +
                          (structureHeight / 2) +
                          extraOffset;

        placement.position.y = structureY;
        previewBox.position.y = structureY;
    }
}
```

**Also update confirmFoundationPlacement** (line ~4221):
```javascript
if (structure && structure.requiresFoundation) {
    const foundation = placement.foundationBelow;

    const foundationHeight = 2.5;

    // NEW: Support different structure types
    let structureHeight;
    if (structure.type === 'crate') {
        structureHeight = 0.5;
    } else if (structure.type === 'wall') {
        structureHeight = 1.5;
    }

    const extraOffset = 0.1;
    const structureY = foundation.position.y +
                      (foundationHeight / 2) +
                      (structureHeight / 2) +
                      extraOffset;

    // Send to server with structureY
    this.networkManager.sendMessage('place_construction_site', {
        position: [foundation.position.x, structureY, foundation.position.z],
        // ... rest of payload
    });
}
```

---

### **STEP 8: Test the Implementation**

**Testing Checklist:**

1. **Model Loads**
   - Open browser console
   - Look for "wall model loaded successfully"
   - No error messages about missing model

2. **Build Menu Shows Structure**
   - Press 'B' to open build menu
   - Wall icon appears in grid
   - Tooltip shows "Wall" name

3. **Placement Works**
   - Click wall in build menu
   - Preview appears semi-transparent
   - Preview follows mouse cursor
   - Status line shows instructions

4. **Validation Works**
   - For `requiresFoundation: true`:
     - Preview turns red when not over foundation
     - Preview turns green when over foundation
   - For regular foundations:
     - Preview validates terrain slope

5. **Phases Work Correctly**
   - Position phase: Click places, advances to rotation
   - Rotation phase: Mouse rotates, click confirms
   - Height phase (foundations only): Mouse adjusts height, click confirms
   - Structures with `requiresFoundation` skip height phase

6. **Construction Site Spawns**
   - Yellow wireframe construction appears
   - Can open inventory near it
   - Construction section shows in inventory

7. **Materials Can Be Added**
   - Drag items from backpack to construction section
   - Required materials list updates
   - Correct materials are accepted

8. **Building Completes**
   - Press 'F' with hammer when all materials added
   - 6-second building animation
   - Construction site disappears
   - Final structure appears at correct position and rotation

9. **Final Structure Correct**
   - Structure at proper height (especially for foundation-based)
   - Correct rotation
   - Correct scale (0.5 for full structures)
   - Blob shadow underneath

---

## Example: Complete Wall Implementation

Here's the complete code changes for adding a wall:

### 1. objects.js
```javascript
// MODEL_CONFIG (around line 119)
wall: {
    path: './models/wall.glb',
    heightRange: { min: 0, max: 0 },
    scaleRange: { min: 0, max: 0 },
    density: 0,
    category: 'structure'
},

// Shadow sizes (around line 349)
'wall': 2.0,
```

### 2. game.js - Build Menu
```javascript
// structures array (around line 269)
{
    id: 'wall',
    type: 'wall',
    name: 'Wall',
    width: 1,
    height: 1,
    imagePath: './structures/wall.png',
    requiresFoundation: true
}
```

### 3. game.js - Y Position (updateFoundationPreview ~3957)
```javascript
let structureHeight;
if (structure.type === 'crate') {
    structureHeight = 0.5;
} else if (structure.type === 'wall') {
    structureHeight = 1.5;
}
```

### 4. game.js - Y Position (confirmFoundationPlacement ~4221)
```javascript
let structureHeight;
if (structure.type === 'crate') {
    structureHeight = 0.5;
} else if (structure.type === 'wall') {
    structureHeight = 1.5;
}
```

### 5. server.js - Materials
```javascript
// place_construction_site (around line 390)
else if (targetStructure === 'wall') {
    requiredMaterials = {
        planks: 6,
        limestone: 4
    };
}
```

### 6. config.js (Optional)
```javascript
// CONSTRUCTION.MATERIALS
wall: {
    planks: 6,
    limestone: 4
}
```

---

## Common Pitfalls

### ❌ Pitfall 1: Type Mismatch
**Problem:** Structure not appearing in build menu

**Causes:**
- `type` in build menu doesn't match MODEL_CONFIG key in objects.js
- Typo in either location

**Solution:**
```javascript
// game.js
{ type: 'wall' }  // Must exactly match ↓

// objects.js
wall: { path: './models/wall.glb' }  // ← This key
```

---

### ❌ Pitfall 2: Model Not Loading
**Problem:** Preview not showing, console errors

**Causes:**
- Model file path incorrect
- Model file doesn't exist
- Model file corrupted/invalid

**Solution:**
1. Check browser console for "Failed to load model: wall"
2. Verify file exists at `public/models/wall.glb`
3. Test model in online GLB viewer first
4. Check file permissions

---

### ❌ Pitfall 3: Wrong Height Calculation
**Problem:** Structure floating or sinking into ground

**Causes:**
- Incorrect `structureHeight` value
- Model center offset wrong
- Foundation height assumption wrong

**Solution:**
1. Load model in Blender/viewer, measure height at scale 0.5
2. Formula: `structureY = foundationY + (foundationHeight/2) + (structureHeight/2) + gap`
3. Test in-game and adjust `structureHeight` value
4. Add console.log to see actual positions:
   ```javascript
   console.log(`Structure Y: ${structureY}, Foundation Y: ${foundation.position.y}`);
   ```

---

### ❌ Pitfall 4: Materials Not Accepted
**Problem:** Can't add materials to construction site

**Causes:**
- Material IDs don't match inventory item types
- Typo in material ID
- RequiredMaterials not set on server

**Solution:**
```javascript
// Material IDs must EXACTLY match inventory item types
requiredMaterials = {
    'planks': 6,      // Must match item.type === 'planks'
    'limestone': 4    // Must match item.type === 'limestone'
}
```

---

### ❌ Pitfall 5: Structure Not Saving
**Problem:** Structure disappears on reload

**Causes:**
- Server not saving chunk data
- Chunk file write failed
- ObjectId not being stored correctly

**Solution:**
1. Check server console for "Chunk saved" messages
2. Verify chunk files in `public/` (e.g., `chunk_0,0.JSON`)
3. Check file permissions on server
4. Look for error messages in server console

---

### ❌ Pitfall 6: Validation Failing
**Problem:** Can't place structure, always shows red

**Causes:**
- Foundation-based structure but no foundation present
- Foundation finder not working
- Validation logic too strict

**Solution:**
```javascript
// Debug validation
validateFoundationPlacement() {
    console.log('Validating placement:', {
        structure: this.gameState.foundationPlacement.structure.type,
        requiresFoundation: this.gameState.foundationPlacement.structure.requiresFoundation,
        foundationBelow: this.gameState.foundationPlacement.foundationBelow
    });
    // ...
}
```

---

### ❌ Pitfall 7: Wrong Scale
**Problem:** Structure too big or too small

**Causes:**
- Model exported at wrong scale
- Scale value in code incorrect
- Confusion between construction (0.017) and final structure (0.5) scales

**Solution:**
- **Construction site:** Always 0.017 scale (tiny yellow wireframe)
- **Final structure:** 0.5 scale for most structures
- Check model dimensions in Blender: Should be real-world size (meters)
- Export with "Apply Transform" enabled

---

## Quick Reference: Key Line Numbers

| File | Function | Line | Purpose |
|------|----------|------|---------|
| game.js | Build menu structures | ~243 | Add structure to menu |
| game.js | startFoundationPlacement | ~3863 | Begin placement flow |
| game.js | updateFoundationPreview | ~3922 | Update preview position |
| game.js | advanceFoundationPlacementPhase | ~4173 | Progress through phases |
| game.js | confirmFoundationPlacement | ~4206 | Send to server |
| objects.js | MODEL_CONFIG | ~119 | Register 3D model |
| objects.js | Shadow sizes | ~349 | Define shadow size |
| server.js | place_construction_site | ~357 | Server placement handler |
| server.js | Material requirements | ~371 | Define materials |
| server.js | build_construction | ~439 | Complete construction |
| config.js | CONSTRUCTION.MATERIALS | ~172 | Material config (optional) |

---

## Summary: Essential Steps

1. ✅ Create 3D model (.glb) → `public/models/`
2. ✅ Create icon (64×64 PNG) → `public/structures/`
3. ✅ Add to MODEL_CONFIG in `objects.js`
4. ✅ Add shadow size in `objects.js`
5. ✅ Add to build menu structures in `game.js`
6. ✅ Define material requirements in `server.js`
7. ✅ (If requiresFoundation) Add Y position calculation in `game.js`
8. ✅ Test all phases and final construction

---

## For Future Claude Code Instances

When implementing a new structure:

1. **Read this guide first** to understand the full flow
2. **Follow the steps in order** - each step builds on the previous
3. **Test after each step** - Don't wait until the end
4. **Check console for errors** - Both client and server
5. **Use the example** - The wall implementation shows all required code
6. **Mind the pitfalls** - These are the most common mistakes

**Key Files to Modify:**
- `objects.js` (model config)
- `game.js` (build menu, placement logic)
- `server.js` (material requirements)
- `config.js` (optional, for organization)

**Don't Forget:**
- Model file in `public/models/`
- Icon file in `public/structures/`
- Exact type matching between files
- Material IDs matching inventory items
- Y position calculation for foundation-based structures

Good luck! 🚀

---

**End of Guide**
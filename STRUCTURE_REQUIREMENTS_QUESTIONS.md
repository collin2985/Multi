# Structure Requirements Questions

When adding a new structure, ask the user these questions to gather complete requirements:

## Basic Information
1. **What is the structure's name?** (e.g., "watchtower", "storage_chest", "dock")
2. **What should it be called in the build menu?** (e.g., "Watchtower", "Storage Chest", "Dock")
3. **Do you have the 3D model (.glb) and icon (.png) files ready?**

## Placement Requirements
4. **Where can this structure be placed?**
   - On terrain (like outpost/tent)
   - Only on foundations (like crate/house)
   - Only in water (like ship)
   - Requires specific foundation layout (like market needs 2x8)

   **IMPORTANT for Foundation-Based Structures:**
   - If your structure requires a foundation, you MUST add it to the collision skip list in `StructureManager.js`
   - Without this, your structure will block adjacent foundation placement
   - Add to line ~783: `if (objType === 'market' || objType === 'house' || objType === 'crate' || objType === 'garden' || objType === 'your_structure')`
   - See Step 11 in HOW_TO_ADD_STRUCTURES.md for details

5. **Should it snap to foundations or grid?**
   - Snap to foundation centers
   - Snap to 0.5 unit grid
   - Snap to 1.0 unit grid
   - Custom snapping

## Construction Requirements
6. **What materials are needed to build it?**
   - Oak planks (quantity?)
   - Pine planks (quantity?)
   - Fir planks (quantity?)
   - Cypress planks (quantity?)
   - Chiseled limestone (quantity?)
   - Chiseled sandstone (quantity?)

7. **How should construction work?**
   - Standard construction site (6-second build with hammer)
   - Instant build (no construction phase)
   - Custom build time

## Special Features
8. **Does it have storage/inventory?**
   - No inventory
   - Yes (how many slots? rows x columns?)
     - **IMPORTANT**: If the structure has inventory, you MUST configure 5 locations:
       1. `config.js` - STRUCTURE_PROPERTIES: Define `inventorySize: { rows: X, cols: Y }`
       2. `ObjectManager.js` - Add to proximity detection (line ~119)
       3. `InventoryUI.js` - Add to titleMap (line ~1138)
       4. `ui.js` - Add to buttonTextMap (line ~121)
       5. Server: Initialize inventory in MessageHandlers.js (covered in construction steps)
     - **Examples**:
       - Garden: 2x2 (4 slots total)
       - Crate/Tent: 10x10 (100 slots) - default if not configured
       - House: 10x10 (100 slots)
       - Custom: Any size that fits your needs

9. **What scale should the model use?**
   - 1.0 (standard)
   - 0.5 (half size like tent)
   - Custom scale value

10. **Are there rotation restrictions?**
    - Free rotation (15° increments)
    - 90° increments only
    - 180° only (0° and 180°)
    - Fixed orientation (no rotation)

## Advanced Features
11. **Does it need special placement validation?**
    - Maximum terrain slope allowed?
    - Minimum distance from other structures?
    - Must be near water?
    - Custom validation rules?

12. **Does it have animations or special behaviors?**
    - Static structure
    - Animated (describe animation)
    - Interactive features (describe)

13. **Any special height requirements?**
    - Auto-snap to terrain/foundation height
    - Player-adjustable height during placement
    - Fixed height offset

## Example User Response Format

> "I want to add a **watchtower** structure called 'Watchtower' in the menu. It places on terrain like an outpost, requires 10 oak planks and 5 chiseled limestone, uses standard 1.0 scale, has no inventory, and allows free rotation."

> "I need a **storage_warehouse** called 'Storage Warehouse'. It must be placed on foundations, requires 20 oak planks and 10 limestone, has a 15x15 inventory grid, uses 1.0 scale, and can only rotate 90° increments."
> **Note**: Inventory structures require configuration in STRUCTURE_PROPERTIES (config.js) AND client-side proximity detection (3 files).

> "Add a **fishing_dock** called 'Fishing Dock'. It must be placed in water, builds instantly, requires 8 oak planks, uses 1.0 scale, no inventory, and can only face 0° or 180°."

> "Create a **small_chest** called 'Small Chest'. It requires foundations, needs 5 oak planks, has a 5x5 inventory (25 slots), uses 1.0 scale, and allows 90° rotation."
> **Note**: Remember to add to ObjectManager.js, InventoryUI.js, and ui.js for inventory to work!

## Quick Decision Tree

```
Is it a building?
├─ YES → Does it need a foundation?
│   ├─ YES → Does it store items?
│   │   ├─ YES → Like house/crate
│   │   └─ NO → Like market
│   └─ NO → Like outpost/tent
└─ NO → Is it for water?
    ├─ YES → Like ship
    └─ NO → Special case
```

## Material Options Reference
Available materials for construction:
- `oakplank` - Oak wood planks
- `pineplank` - Pine wood planks
- `firplank` - Fir wood planks
- `cypressplank` - Cypress wood planks
- `chiseledlimestone` - Processed limestone blocks
- `chiseledsandstone` - Processed sandstone blocks

## Scale Reference
Current structures use these scales:
- `1.0` - Most structures (foundation, crate, house, outpost, ship, market)
- `0.5` - Tent (smaller structure)

## Rotation Reference
Current rotation patterns:
- **Free rotation**: Foundations (15° increments)
- **90° snapping**: Foundation-based structures when on foundations
- **180° only**: Market (0° and 180°)
- **No rotation limit**: Outpost, tent (15° increments)

## Inventory Size Reference
Current structures with inventory:
- **Garden**: 2x2 (4 slots) - Small planter storage
- **Crate**: 10x10 (100 slots) - Default if not configured in STRUCTURE_PROPERTIES
- **Tent**: 10x10 (100 slots) - Uses default size
- **House**: 10x10 (100 slots) - Standard storage
- **Market**: 100x10 (1000 slots) - Large scrollable inventory

### Scrollable Inventories

For inventories with more than 10 rows, the system automatically enables scrolling:
- **Visible area**: Always shows 10 rows at a time
- **Scrollbar**: Automatically appears when rows > 10
- **Drag/drop**: Fully functional with scrolling - items can be dragged while scrolling
- **No size limit**: Can configure any number of rows (e.g., 100, 200, etc.)

**Example Large Inventories**:
- Market: `{ rows: 100, cols: 10 }` → 1000 slots with scrollbar
- Warehouse: `{ rows: 50, cols: 15 }` → 750 slots with scrollbar
- Small: `{ rows: 5, cols: 5 }` → 25 slots, no scrollbar needed

**Note**: The scrolling is implemented automatically in `InventoryUI.js` and requires no additional configuration beyond setting the inventory size in config.js.

### Inventory Configuration Checklist
When adding a structure with inventory, you MUST update these 5 locations:

1. ✅ **config.js** (STRUCTURE_PROPERTIES):
   ```javascript
   your_structure: {
       inventorySize: { rows: 5, cols: 5 }
   }
   ```

2. ✅ **ObjectManager.js** (line ~119) - Proximity detection:
   ```javascript
   } else if (object.userData.modelType === 'crate' ||
              object.userData.modelType === 'your_structure') {
   ```

3. ✅ **InventoryUI.js** (line ~1138) - Title display:
   ```javascript
   const titleMap = {
       'crate': 'Crate',
       'your_structure': 'Your Structure Name'
   };
   ```

4. ✅ **ui.js** (line ~121) - Button text:
   ```javascript
   const buttonTextMap = {
       'crate': 'Crate',
       'your_structure': 'Your Structure Name'
   };
   ```

5. ✅ **MessageHandlers.js** (server) - Initialize inventory:
   ```javascript
   if (constructionSite.targetStructure === 'house' ||
       constructionSite.targetStructure === 'your_structure') {
       structureChange.inventory = { items: [] };
   }
   ```

**⚠️ COMMON BUG**: Forgetting locations 2-4 will prevent players from opening the inventory even though it exists on the server!
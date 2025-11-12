# Inventory and Market System Analysis

## 1. CURRENT INVENTORY SYSTEMS

### Backpack Inventory
- File: public/player/PlayerInventory.js (232 lines)
- Grid-based: 10 rows x 5 cols (50 slots)
- Tetris-like item placement with collision detection
- Storage: In-memory in gameState.inventory

Item structure:
- id: unique identifier
- type: item classification (limestone, axe, etc)
- x, y: grid position
- width, height: grid size
- rotation: 0 or 90 degrees
- quality: 0-100 value
- durability: 0-100 for tools only, undefined for materials


### Crate/Storage Inventory
- Files: public/ui/InventoryUI.js, server/MessageHandlers.js
- Same grid system as backpack, but size varies by structure
- Stored in: server/chunk_X,Y.JSON files
- Network synced via get_crate_inventory and save_crate_inventory

Data Flow - Reading:
1. Player opens inventory near crate
2. InventoryUI.updateCrateSection() sends get_crate_inventory
3. Server finds inventory in chunk objectChanges array
4. Client receives crate_inventory_response
5. Inventory cached in crate.userData.inventory
6. InventoryUI.renderCrateInventory() displays items

Data Flow - Writing:
1. Player drags items between backpack and crate
2. Local arrays updated immediately
3. crate.userData.inventoryDirty = true flag set
4. On close: send save_crate_inventory message
5. Server updates and persists to disk
6. Server broadcasts crate_inventory_updated to chunk

### House, Garden, Market Inventories
All use same system as crates. Sizes from config.js:
- House: 10x10 (100 slots)
- Garden: 2x2 (4 slots)
- Market: 10x10 (100 slots)

### Backpack vs Structures
- Backpack: 10x5, gameState.inventory, in-memory, no network
- Structures: Config-size, chunk JSON, network synced, proximity required

### Storage Locations
Client: gameState.inventory (backpack), crate.userData.inventory (cached)
Server: ./public/chunk_X,Y.JSON files, ChunkManager.chunkCache (memory)

---

## 2. MARKET CURRENT IMPLEMENTATION

### Market Definition
From config.js lines 363-366:
```
market: {
    foundationGrid: {width: 2, depth: 8},
    allowedRotations: [0, 180],
    inventorySize: {rows: 10, cols: 10}
}
```

### Market Already Has Inventory Support!
- 10x10 inventory grid (100 slots)
- Uses identical system as houses and crates
- Network messages: get_crate_inventory, save_crate_inventory
- UI title shows "Market" instead of "Crate"

### Current Limitation
No buy/sell mechanics - it's just a storage container

### What's NOT Implemented
- buy_item, sell_item messages
- Price system
- Currency tracking
- Transaction validation
- NPC or owner concept

---

## 3. ITEM SYSTEM

### Item Structure
```
{
    id: "limestone_1704067200000_abc",
    type: "limestone",
    x: 0, y: 2,
    width: 1, height: 1,
    rotation: 0,
    quality: 75,
    durability: 100 (tools only)
}
```

### Item Types
Materials: limestone, sandstone, chiseledlimestone, oakfirewood, oakplank
Tools: axe, saw, pickaxe, hammer, chisel
Other: seeds, apple, vegetables

### Item Properties
Quality: 0-100 (inherited from source, affects durability loss)
Durability: 0-100 (tools only)
- Axe: -10, Saw: -10, Pickaxe: -10
- Hammer: -5, Chisel: -ceil(100/stoneQuality)

### Item Movement
Drag & drop between inventories (via InventoryUI.js)
Harvesting creates new items (via ResourceManager.js)
Crafting transforms items (via CraftingSystem.js)

---

## 4. NETWORK AND SERVER ARCHITECTURE

### Messages
Client -> Server:
- get_crate_inventory {crateId, chunkId}
- save_crate_inventory {crateId, chunkId, inventory}

Server -> Client:
- crate_inventory_response {crateId, inventory}
- crate_inventory_updated {crateId, inventory} (broadcast)

### Server Implementation
Handlers: server/MessageHandlers.js
- handleGetCrateInventory() - retrieve from objectChanges
- handleSaveCrateInventory() - update and persist to disk

Persistence: ChunkManager.loadChunk() / saveChunk()
- Reads/writes ./public/chunk_X,Y.JSON files
- Memory cache: ChunkManager.chunkCache

---

## 5. UI ARCHITECTURE

### InventoryUI.js Structure (1468 lines)
- Initialization (50-111)
- Open/Close (123-155)
- Backpack Render (161-186)
- Tooltips (192-270)
- Grid Math (289-297)
- Validation (301-344)
- Drag Helpers (349-445)
- Chisel (527-712)
- Mouse Events (713-986)
- Crate Section (1000-1414)

### Item Rendering
Backpack: renderBackpackItem() - includes discard button
Crate: renderCrateItem() - no discard button

### Grid System
Helper: public/ui/GridUIHelpers.js
- calculateGridSize() - slot size based on window
- gridToPixel() / pixelToGrid() - coordinate conversion
- calculateItemSize() - item display dimensions

### Drag & Drop
1. Start: onItemMouseDown() -> _startItemDrag()
2. During: onMouseMove() -> update ghost position
3. Rotation: Press 'R' to toggle 0/90
4. End: onMouseUp() -> validate and place

---

## KEY FILES

Core: public/player/PlayerInventory.js, public/ui/InventoryUI.js
Config: public/config.js
Server: server/MessageHandlers.js, server/ChunkManager.js
Networking: public/network/MessageRouter.js

---

## MARKET SYSTEM RECOMMENDATIONS

What's Already Done:
- Market model and placement
- 10x10 inventory grid
- Proximity detection
- Network infrastructure

What Needs to Be Added:
1. Currency system (gameState property)
2. Price config (config.js)
3. New messages (buy_item, sell_item)
4. Server transaction handlers
5. UI buy/sell panel (InventoryUI.js)
6. Transaction validation

Files to Modify:
- public/config.js - add prices
- public/ui/InventoryUI.js - add trading panel
- public/network/MessageRouter.js - handle transactions
- server/MessageHandlers.js - implement buy/sell
- public/core/GameState.js - add currency
- public/game.js - init market NPCs


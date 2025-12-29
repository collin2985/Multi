# Artillery Implementation [COMPLETE]

## Overview
Artillery is a towable structure similar to cart, but with key differences:
- Can ONLY be towed by a horse (not by player on foot)
- Has a 4x4 inventory that ONLY accepts shell items
- Cannot load crates like cart can
- Firing functionality deferred to later

## Assets (Already Exist)
- `public/models/Artillery.glb` - 3D model (66 KB, optimized)
- `public/structures/artillery.png` - Build menu icon
- `public/items/shell.png` - Shell ammo item sprite
- `public/items/parts.png` - Parts item (already in game)

## Missing Assets
- `public/items/Rshell.png` - Rotated shell sprite for inventory (needs creation)

## Build Requirements
- 1x parts
- 1x plank (any type: oakplank, pineplank, etc.)

## Implementation Files

### 1. Object Definition (`public/objects.js`)
Add artillery to object definitions:
```javascript
artillery: {
    path: './models/Artillery.glb',
    heightRange: { min: 0, max: 0 },
    scaleRange: { min: 0, max: 0 },
    density: 0,
    category: 'structure',
    baseScale: 1.0
}
```

### 2. Configuration (`public/config.js`)
Add to multiple sections:

**ARTILLERY_PHYSICS** (new section, similar to CART_PHYSICS):
```javascript
ARTILLERY_PHYSICS: {
    HITCH_OFFSET: 0.4,
    TETHER_LENGTH: 0.3,
    ARTILLERY_SPEED: 2.0,  // Slightly slower than cart
    PIVOT_SPEED: 0.08,
    MAX_SAFE_ANGLE: Math.PI * 0.35,
    DANGER_ANGLE: Math.PI * 0.5,
    EMERGENCY_PIVOT_SPEED: 0.3,
    SPEED_MULTIPLIER: 0.7,  // Heavier than cart
    ROAD_SPEED_MULTIPLIER: 1.4,
    BROADCAST_INTERVAL: 150
}
```

**CONSTRUCTION.GRID_DIMENSIONS**:
```javascript
artillery: { width: 1.0, depth: 2.0, height: 2.0 }
```

**CONSTRUCTION.MATERIALS**:
```javascript
artillery: {
    parts: 1,
    oakplank: 1  // Any plank type accepted
}
```

**CONSTRUCTION.STRUCTURE_PROPERTIES**:
```javascript
artillery: {
    height: 2.0,
    inventorySize: { rows: 4, cols: 4 }  // 16 slots for shells only
}
```

**COLLISION.STRUCTURE_COLLIDERS**:
```javascript
artillery: { radius: 0.3, height: 2.0 }
```

### 3. Build Menu (`public/ui/BuildMenu.js`)
Add to structures array:
```javascript
{
    id: 'artillery',
    type: 'artillery',
    name: 'Artillery',
    width: 1,
    height: 2,
    imagePath: './structures/artillery.png',
    hasInventory: true
}
```

### 4. Game State (`public/core/GameState.js`)
Add `artilleryAttachmentState` (similar to `cartAttachmentState`):
```javascript
this.artilleryAttachmentState = {
    isAttached: false,
    attachedArtillery: null,
    artilleryId: null,
    artilleryChunkKey: null,
    artilleryOriginalChunkKey: null,
    artilleryQuality: null,
    artilleryLastRepairTime: null,
    _terrainFrameCount: 0,
    _lastBroadcastTime: 0
}
```

### 5. Main Game Logic (`public/game.js`)
Add functions (similar to cart but horse-only):
- `handleAttachArtillery()` - Check player is mounted on horse before allowing
- `handleReleaseArtillery()`
- Update `updatePhysics()` to handle artillery towing (reuse cart physics with ARTILLERY_PHYSICS config)
- Add artillery P2P broadcasts

### 6. Interaction Manager (`public/systems/InteractionManager.js`)
Add 'artillery' to `towableEntityTypes` array:
```javascript
const towableEntityTypes = ['cart', 'artillery'];
```
Add special check: only show attach button when mounted on horse.

### 7. Mobile Entity System (`public/systems/MobileEntitySystem.js`)
Add artillery handling:
- Update `isOccupied()` checks
- Add button labels for artillery
- Handle artillery-specific speed modifiers

### 8. Server Handlers (`server/MessageHandlers.js`)
Add handlers:
- `handlePlaceArtillery()` - Similar to `handlePlaceCart()`
- `handleClaimArtillery()` - Uses `handleClaimMobileEntity()`
- `handleReleaseArtillery()` - Uses `handleReleaseMobileEntity()`
- Add artillery to construction materials validation
- Initialize artillery with 4x4 inventory on build

### 9. P2P Network (`public/network/GameStateManager.js`)
Add handlers:
- `handleArtilleryAttached()`
- `handleArtilleryReleased()`
- `handleArtilleryPosition()`

### 10. Inventory UI (`public/ui/CrateInventoryUI.js`)
Add item filtering for artillery:
- Only accept items where `item.type === 'shell'`
- Show error toast if player tries to add non-shell items
- Update title map to include 'artillery': 'Artillery'

### 11. UI Updates (`public/ui.js`)
- Add artillery to structure types list
- Add attach/release button handling
- Add tooltip with durability info

### 12. Shell Item
Shell needs to be added as a tradeable/craftable item:
- Already has sprite: `public/items/shell.png`
- Add to market prices in config.js
- Define crafting recipe (optional - can be purchased only)

## Key Differences from Cart

| Feature | Cart | Artillery |
|---------|------|-----------|
| Towed by player on foot | Yes | No |
| Towed by horse | Yes | Yes |
| Can load crate | Yes | No |
| Inventory | No (uses crate) | 4x4 (shells only) |
| Item filter | N/A | Shell only |
| Speed multiplier | 0.9 empty, 0.5 loaded | 0.7 (heavier) |
| Build materials | 1 plank | 1 parts + 1 plank |

## Implementation Order

1. Add shell item to config (market prices)
2. Add artillery object definition (objects.js)
3. Add artillery config (config.js - all sections)
4. Add to build menu (BuildMenu.js)
5. Add game state (GameState.js)
6. Add server handlers (MessageHandlers.js)
7. Add game logic - attach/release/physics (game.js)
8. Add interaction detection (InteractionManager.js)
9. Add mobile entity handling (MobileEntitySystem.js)
10. Add P2P networking (GameStateManager.js)
11. Add inventory UI with filtering (CrateInventoryUI.js)
12. Add UI buttons/tooltips (ui.js)

## Design Decisions
- **Build type**: Instant build (like cart) - 6 second build timer
- **Shell source**: Market only (not craftable)
- **Durability**: Yes, artillery has decay like other structures

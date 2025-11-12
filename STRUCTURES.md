# Structure System Implementation Overview

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Structure Types](#structure-types)
3. [Placement System](#placement-system)
4. [Rendering](#rendering)
5. [Network Communication](#network-communication)
6. [Construction Workflow](#construction-workflow)

## Architecture Overview

Client-side components: BuildMenu.js, StructureManager.js, BuildingSystem.js
Server-side: MessageHandlers.js processes structure placement and construction
Rendering: Objects.js ModelManager loads and instantiates .glb models

## Structure Types

### Foundations (grid-based placement)
- foundation (1x1, scale 1.0)
- foundationcorner (1x1 corner, scale 1.0)
- foundationroundcorner (1x1 rounded corner, scale 1.0)
- 2x8foundation (2x8 large platform, scale 1.0)

### Foundation-Dependent Structures
- crate (requires foundation, scale 1.0, 10x10 inventory)
- house (requires foundation, scale 1.0, 10x10 inventory)
- market (requires 2x8 foundation grid, scale 1.0)

### Terrain Placement
- outpost (no foundation, scale 1.0)
- tent (no foundation, scale 0.5)

### Water Structures
- ship (water only, scale 1.0, instant build, animated)

## Placement System (3-Phase)

POSITION → ROTATION → HEIGHT → CONFIRM

### Phase 1: Position
- Mouse position snaps to 0.5 unit grid (1.0 for 2x8)
- Foundation-based structures snap to foundation centers
- Validates slope (<50°), collision, terrain constraints
- Glow color: green=valid, red=invalid

### Phase 2: Rotation
- Regular: snap to 15° increments
- Foundation-based: snap to 90° relative to foundation
- Market: snap to 180° relative to foundation

### Phase 3: Height (foundations only)
- Mouse vertical movement adjusts height
- Range: -1 to +2 units relative to terrain
- Snap to 0.5 increments

### Confirmation
- Sends to server via 'place_construction_site' message
- Ships are instant-build
- Others create construction site with material requirements

## Key Classes

### StructureManager.js (878 lines)
- updateFoundationPreview() - Updates preview during placement
- validateFoundationPlacement() - Checks placement validity
- detectFoundationGrid() - Smart grid detection for markets
- checkStructureCollision() - Prevents placement overlap
- checkBoundingBoxCollision() - Collision detection

### BuildMenu.js (700+ lines)
- 13 structure types with icons
- 3-phase placement state machine
- Preview creation with glow outline
- Tooltip system

### BuildingSystem.js (362 lines)
- startBuildAction() - Player begins construction
- completeBuildAction() - Construction finished, check materials
- getConstructionRequirements() - Show progress to player
- addMaterialToConstruction() - Transfer materials from inventory

### ObjectManager.js
- checkProximity() - Find nearest structure/construction site
- Different detection radius for structures (1.2) vs objects (0.6)

## Models & Assets

Location: /public/models/ (all .glb files)
Scales vary: 0.5 for tent, 1.0 for most structures
Shadows added automatically based on model size

## Network Messages

### Client → Server
- place_construction_site: Structure placement request
- build_construction: Complete construction request
- get_crate_inventory: Request crate contents
- save_crate_inventory: Update crate contents

### Server → Client
- object_added: New structure created
- object_removed: Structure demolished
- crate_inventory_response: Crate inventory data
- crate_inventory_updated: Another player modified storage

## Material Requirements (config.js)

foundation: chiseledlimestone 4 + chiseledsandstone 4
foundationcorner: chiseledlimestone 2 + chiseledsandstone 2
foundationroundcorner: chiseledlimestone 3 + chiseledsandstone 3
outpost, house, ship, market: oakplank 1

## Construction Workflow

1. Player opens build menu (B key)
2. Selects structure from grid
3. 3-phase placement system
4. Server creates construction site with material requirements
5. Player gathers materials and delivers to construction site
6. Player builds (6 seconds, requires hammer)
7. Construction site removed, final structure appears
8. For crates/houses: inventory accessible

## File Locations Summary

Public-side:
- public/ui/BuildMenu.js - Structure selection & placement
- public/ui/InventoryUI.js - Crate inventory interface
- public/world/StructureManager.js - Placement validation
- public/systems/BuildingSystem.js - Construction mechanics
- public/objects.js - Model loading & instantiation
- public/config.js - Material requirements
- public/structures/ - Icon images (64x64 PNG)
- public/models/ - 3D model files (.glb)

Server-side:
- server/MessageHandlers.js - handlePlaceConstructionSite, handleBuildConstruction
- server/ChunkManager.js - Persistent storage
- Chunk JSON files store structure objects

## Key Implementation Details

- Preview models: semi-transparent (opacity 0.6) with glow outline
- Glow outline: backface-culled MeshBasicMaterial, color changes with validity
- Grid detection: finds 2x8 or 8x2 patterns in foundation groups
- Collision: uses THREE.Box3 with special rules for foundations
- Inventory: stored on crate/house userData, saved to server on close
- Ship animation: registered with animationSystem for wave rocking
- Construction quality: calculated from material count (quality = 50 * material_count)

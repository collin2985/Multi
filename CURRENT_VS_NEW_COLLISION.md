# Current vs New Collision System

## YOUR CURRENT SYSTEM (Still Active)

Your game is **NOT using the new bounding box system yet**. Here's what you're currently doing:

### 1. Structure Collision (StructureManager.js)
```javascript
// CURRENT - Hardcoded collision for market (lines 760-778)
if (structureType === 'market') {
    // Manual rotation math
    const rotation = obj.rotation.y;
    const localX = position.x - obj.position.x;
    const localZ = position.z - obj.position.z;

    // Manually rotate point back
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    const rotatedX = localX * cos - localZ * sin;
    const rotatedZ = localX * sin + localZ * cos;

    // Hardcoded 2x8 bounds
    if (Math.abs(rotatedX) < 1.0 && Math.abs(rotatedZ) < 4.0) {
        return { hasCollision: true };
    }
}

// CURRENT - Simple 1x1 square for other structures (lines 780-788)
else {
    const dx = Math.abs(position.x - obj.position.x);
    const dz = Math.abs(position.z - obj.position.z);

    // Hardcoded 1x1 bounds (no rotation support!)
    if (dx < 0.5 && dz < 0.5) {
        return { hasCollision: true };
    }
}
```

**Problems:**
- Market has manual rotation math (error-prone)
- Other structures use 1x1 boxes regardless of actual size
- No rotation support for most structures
- Each structure type needs custom code

### 2. Character Collision (CollisionSystem.js)
```javascript
// CURRENT - Simple radius-based collision
const distance = Math.sqrt(dx * dx + dz * dz);
if (distance < this.BUBBLE_RADIUS) {
    // collision detected
}
```

**Problems:**
- Only circular collision (no rectangular characters)
- No height consideration
- No complex shapes

## THE NEW SYSTEM (Ready but Not Connected)

The new system is in `/public/systems/` but **not integrated yet**:

### Files Created But Not Used:
- `BoundingBoxSystem.js` - Core system with AABB + OBB support
- `OrientedBoundingBox.js` - Solves rotation problem
- `ModelBoundsConfig.js` - Auto-configures per model type
- `CollisionDetection.js` - Advanced collision algorithms
- `BoundingBoxDebugger.js` - Visual debugging

### How New System Would Work:
```javascript
// NEW - Automatic bounds selection and rotation handling
const bounds = boundingBoxSystem.getBoundingBox(marketObject);
// Automatically uses OBB for market, handles rotation perfectly

const collision = collisionSystem.checkCollision(playerBounds, marketBounds);
// No manual math needed!
```

## WHY YOUR PLACEMENT IS BROKEN

When you rotate a log/structure 45°:

**Current System:**
- Either ignores rotation (1x1 box)
- OR requires manual trigonometry (market only)
- Result: Can't place where it looks like it fits

**New System Would:**
- Use OBB that rotates WITH the object
- Tight, accurate bounds at any angle
- Result: Can place exactly where it visually fits

## TO INTEGRATE THE NEW SYSTEM

### Step 1: Import the new system
```javascript
// In game.js
import { boundingBoxSystem } from './systems/BoundingBoxSystem.js';
import { BoundingBoxDebugger } from './systems/BoundingBoxDebugger.js';
import { collisionSystem } from './systems/CollisionDetection.js';
```

### Step 2: Tag objects with model info when loading
```javascript
// When loading models
loadedModel.userData.modelPath = 'market.glb';
```

### Step 3: Replace collision checks
```javascript
// OLD WAY (StructureManager.js line 760-788)
// 28 lines of manual rotation math

// NEW WAY
const bounds1 = boundingBoxSystem.getBoundingBox(obj1);
const bounds2 = boundingBoxSystem.getBoundingBox(obj2);
if (collisionSystem.checkCollision(bounds1, bounds2)) {
    return { hasCollision: true };
}
// 4 lines, handles all rotations automatically!
```

### Step 4: Enable debug mode (optional)
```javascript
// See bounding boxes with 'V' key
const debugger = new BoundingBoxDebugger(scene, camera, renderer);
```

## SUMMARY

- **Current Status:** Your game uses hardcoded collision with manual rotation math
- **New System:** Created but sitting unused in `/public/systems/`
- **Problem It Solves:** Rotation makes bounding boxes expand incorrectly
- **Next Step:** Need to connect the new system to your game

The new system is modular and ready - it just needs to be wired into your existing code to replace the hardcoded collision checks.
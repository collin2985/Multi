# Bounding Box Rendering Issue Analysis: Dock vs Market

## Executive Summary

The dock's bounding box is rendering incorrectly (showing as 1x10 in the wrong direction, creating a cross) while the market's bounding box renders correctly. The root cause is a **dimension inconsistency** across multiple configuration files combined with **special rotation handling** in MessageRouter.js.

---

## The Problem

### What's Happening
- **Market**: 2x8 bounding box renders correctly (2 units wide, 8 units deep)
- **Dock**: 1x10 bounding box renders as a rotated cross instead of showing as 10x1

---

## Root Cause: Configuration Dimension Mismatch

### Inconsistency Across Files

#### CONFIG.JS (The Source of Truth)
```javascript
// config.js line 291 - CORRECT dimensions
dock: { width: 10.0, depth: 1.0 }  // 10 units wide, 1 unit deep
```

#### GAME.JS (WRONG - Swapped)
```javascript
// game.js line 508 - SWAPPED dimensions!
{ model: 'dock', width: 1, depth: 10 }
```

#### MESSAGEROUTER.JS (WRONG - Swapped)
```javascript
// MessageRouter.js line 228 - SWAPPED dimensions!
'dock': { type: 'rectangle', width: 1, depth: 10 }
```

#### STRUCTUREMANAGER.JS (WRONG - Swapped)
```javascript
// StructureManager.js line 346 - SWAPPED dimensions!
'dock': { type: 'rectangle', width: 1, depth: 10 }
```

### The Three Problems

**1. Dimension Inconsistency**
- config.js correctly defines: `width: 10, depth: 1`
- Three other files incorrectly swap it to: `width: 1, depth: 10`
- This is the PRIMARY cause of the visual error

**2. Special Rotation Compensation (MessageRouter.js)**
```javascript
// MessageRouter.js lines 169-174
const objectType = data.name || data.objectType;
let finalModelRotation = objectRotation;
if (objectType === 'dock') {
    finalModelRotation = objectRotation + (Math.PI / 2); // Add 90 degrees!
}
```
- Dock model gets an additional +90 degree rotation
- This doesn't affect the bounding box dimensions, but compounds the visual error
- Market doesn't have this special case

**3. Bounding Box Not Account for Rotation**
```javascript
// BoundingBox.js lines 46-47
boundingBox.rotation.y = model.rotation.y;  // Just copies model rotation
```
- The bounding box uses the model's rotation directly
- But if dimensions are swapped, and model is rotated +90°, the box is in wrong orientation

---

## Blender to Three.js Coordinate Mapping

From your information:
- **Blender model**: 10 units in X, 1 unit in Y (which is height)
- **Three.js mapping**: Y becomes Z (vertical becomes depth)
- **Correct mapping**: X stays as width, Z (formerly Y) becomes depth

Therefore:
- Blender X (10 units) = Three.js X = width ✓ config.js has this right
- Blender Y (1 unit) = Three.js Z = depth ✓ config.js has this right

**config.js is correct**: `{ width: 10.0, depth: 1.0 }`
**Everything else is wrong**: `{ width: 1, depth: 10 }` (swapped)

---

## Why Market Works Correctly

Market has NO inconsistencies:

```javascript
// config.js line 290 - CORRECT
'2x8foundation': { width: 2.0, depth: 8.0 }

// game.js line 507 - MATCHES config.js
{ model: 'market', width: 2, depth: 8 }

// MessageRouter.js line 227 - MATCHES config.js
'market': { type: 'rectangle', width: 2, depth: 8 }

// StructureManager.js line 345 - MATCHES config.js
'market': { type: 'rectangle', width: 2, depth: 8 }

// No special rotation handling for market
// Result: Visual box correctly shows 2×8 rectangle
```

---

## Impact on Bounding Box Rendering

### Visual Representation Process
1. Game detects new dock placed
2. Looks up dimensions in game.js/MessageRouter: `width: 1, depth: 10` (WRONG)
3. Creates BoxGeometry(1, 10, 0.1) visual box
4. Sets box rotation = model.rotation.y (which is model.rotation + 90°)
5. Renders 1×10 box that's rotated 90° from expected orientation
6. User sees a CROSS pattern instead of a 10×1 line

### Why It Looks Like a Cross
- Config says: 10 units long in X direction (width)
- Code creates: 10 units long in Z direction (depth)
- Model has +90° rotation applied
- Result: The visual box is perpendicular to where it should be
- Combined with any other structures nearby, appears as a cross pattern

---

## Comparison Table

| Aspect | Market | Dock |
|--------|--------|------|
| config.js | `width: 2, depth: 8` | `width: 10, depth: 1` |
| game.js | `width: 2, depth: 8` ✓ | `width: 1, depth: 10` ✗ |
| MessageRouter.js | `width: 2, depth: 8` ✓ | `width: 1, depth: 10` ✗ |
| StructureManager.js | `width: 2, depth: 8` ✓ | `width: 1, depth: 10` ✗ |
| Special rotation? | No | +90° (line 173) |
| Visual box | Correct | Rotated incorrectly |

---

## The Fix

### Primary Fix: Update Dimension Configuration (3 Files)

Change swapped dimensions to match config.js:

**game.js line 508**
```javascript
// BEFORE:
{ model: 'dock', width: 1, depth: 10 }

// AFTER:
{ model: 'dock', width: 10, depth: 1 }
```

**MessageRouter.js line 228**
```javascript
// BEFORE:
'dock': { type: 'rectangle', width: 1, depth: 10 }

// AFTER:
'dock': { type: 'rectangle', width: 10, depth: 1 }
```

**StructureManager.js line 346**
```javascript
// BEFORE:
'dock': { type: 'rectangle', width: 1, depth: 10 }

// AFTER:
'dock': { type: 'rectangle', width: 10, depth: 1 }
```

### Optional: Investigate the +90° Rotation

Consider whether the special rotation in MessageRouter.js line 172-174 is necessary:
- Is it compensating for model orientation?
- Should the bounding box account for it?
- Does it match how the market is handled?

If it's necessary for correct model orientation, no change needed. If it's a bug, remove it.

---

## Additional Notes

### How Bounding Box Rendering Works
1. `BoundingBox.js` class creates THREE.BoxGeometry with specified width/depth
2. Dimensions are passed from game.js, MessageRouter.js, or config.js
3. Visual box is positioned at model.position and rotated by model.rotation.y
4. Box updates each frame to match model position/rotation (see BoundingBox.js lines 168-187)

### Where Bounding Boxes Are Created
- **Initial setup**: game.js lines 480-520 creates boxes for all existing models
- **New objects**: MessageRouter.js lines 235-250 creates boxes when server adds objects
- **Preview boxes**: BuildMenu.js likely creates preview boxes during placement

### Configuration Sources
All bounding box dimensions should ultimately come from **config.js** GRID_DIMENSIONS (lines 285-318).

---

## Recommendations

1. **Immediate**: Fix the three swapped dimension definitions to match config.js
2. **Verify**: After fix, enable bounding box visualization (V key) and check dock vs market
3. **Test**: Place dock and market side by side to confirm correct relative sizes
4. **Review**: Investigate if +90° rotation in MessageRouter is intentional
5. **Standardize**: Consider adding comments linking all dimension sources to config.js


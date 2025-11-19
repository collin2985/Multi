# Tree Object Dependencies - Complete Map
Date: 2025-11-18
Purpose: Document all code locations that interact with tree mesh objects
Status: Investigation complete - NO CODE CHANGES YET

---

## Summary
This document maps all locations that currently depend on individual mesh objects for trees. When converting to InstancedMesh, these locations will need to access instance data instead.

---

## 1. OBJECT REGISTRY SYSTEM

### 1.1 Where Objects Are STORED (objectRegistry.set)

| File | Line | Context |
|------|------|---------|
| `game.js` | 163 | Store player object |
| `game.js` | 1134 | Store avatar objects |
| `game.js` | 1338 | **Populate object registry for chunk objects** ⚠️ |
| `objects.js` | 825 | Store server-spawned objects |
| `network/MessageRouter.js` | 82 | Store objects from server |
| `network/MessageRouter.js` | 474 | Store placed structure instances |
| `terrain.js` | 1962 | Store chunk objects (legacy?) |
| `systems/ResourceManager.js` | 265 | Store created objects |

**Key Location:** `game.js:1338` - This populates registry from `chunkObjects` arrays

### 1.2 Where Objects Are RETRIEVED (objectRegistry.get)

| File | Line | Context | What's Accessed |
|------|------|---------|----------------|
| `game.js` | 1891 | **Proximity detection** ⚠️ | All properties below |
| `objects.js` | 807 | Check if server object exists | Basic check |
| `systems/ResourceManager.js` | 251 | Get resource object for harvesting | userData |
| `network/MessageRouter.js` | 71 | Check for cached objects | Basic check |

**Critical Location:** `game.js:1891` - Main proximity detection system

---

## 2. PROXIMITY DETECTION SYSTEM (game.js:1885-1993)

### Flow:
1. Physics query finds nearby colliders → objectIds
2. Get object from registry: `objectRegistry.get(objectId)`
3. **Access object properties extensively** ⚠️

### Object Properties Accessed:

| Property | Line | Purpose |
|----------|------|---------|
| `object.parent` | 1917 | Check if object still in scene |
| `object.userData.modelType` | 1923 | Identify tree/rock/structure type |
| `object.position.x` | 1924 | Calculate distance X |
| `object.position.z` | 1925 | Calculate distance Z |
| `object.userData.isConstructionSite` | 1929 | Check if construction |
| `object.userData.objectId` | 1951 | Store in nearestObject |
| `object.userData.chunkKey` | 1954 | Store chunk location |
| `object.userData.quality` | 1955 | Store quality (1-100) |
| `object.userData.originalScale` or `object.scale` | 1956 | Store scale |
| `object.userData.remainingResources` | 1957 | Resources left |
| `object.userData.totalResources` | 1958 | Total resources |
| `object.position.clone()` | 1953 | Clone position |

### What Needs to Change:
All `object.property` → `instanceData.property`

---

## 3. OBJECT REMOVAL SYSTEM

### 3.1 Main Removal Function

**File:** `world/ChunkManager.js:239-268`

**Current Flow:**
```javascript
removeObject(objectId) {
    // 1. Find object from registry
    const object = objectPlacer.findObjectById(scene, objectId, objectRegistry);

    // 2. Get chunkKey from object
    const chunkKey = object.userData.chunkKey;

    // 3. Add to removed cache
    removedObjectsCache.get(chunkKey).add(objectId);

    // 4. Remove physics collider
    physicsManager.removeCollider(objectId);

    // 5. Remove from scene ⚠️
    scene.remove(object);

    // 6. Dispose geometry/materials ⚠️
    disposeObject(object);

    // 7. Remove from chunkObjects array
    chunkObjects.splice(index, 1);

    // 8. Remove from object registry
    objectRegistry.delete(objectId);
}
```

**What Needs to Change:**
- Steps 5-6: Replace with `hideInstance(treeType, instanceIndex)`
- Add: Remove billboard using objectId

### 3.2 Chunk Unload Removal

**File:** `world/ChunkManager.js:223-226`

Removes all objects when chunk unloads:
```javascript
scene.remove(obj);
disposeObject(obj);
```

**What Needs to Change:**
- For trees: Hide instances instead of removing
- Or: Keep instances but mark as inactive

---

## 4. BILLBOARD SYSTEM DEPENDENCIES

### 4.1 Billboard Creation

**File:** `objects.js:653-663`

```javascript
const billboardIndex = this.billboardSystem.addTreeBillboard(
    instance,      // ⚠️ Passes mesh object as key
    modelType,
    position
);
instance.userData.billboardIndex = billboardIndex;
```

### 4.2 Billboard Storage

**File:** `BillboardSystem.js:270`

```javascript
this.instanceData.set(treeObject, {  // ⚠️ Uses object as Map key
    type: treeType,
    index: index,
    position: position.clone()
});
```

**Problem:** Map uses mesh object reference as key. Won't work with InstancedMesh.

### 4.3 Billboard Removal

**File:** `BillboardSystem.js:289-304`

```javascript
removeTreeBillboard(treeObject) {  // ⚠️ Requires object reference
    const data = this.instanceData.get(treeObject);
    // ... hide billboard
}
```

**What Needs to Change:**
- Change Map key from `treeObject` → `objectId` (string)
- Add method: `removeBillboardById(objectId)`
- Update calls to pass objectId instead of object

---

## 5. CHUNK TRACKING SYSTEM

### 5.1 Chunk Objects Storage

**File:** `terrain.js` (chunkObjects)

```javascript
Map<chunkKey, Array<MeshObject>>
```

**Used by:**
- `game.js:1338` - populateObjectRegistry
- `world/ChunkManager.js:271` - Remove from array on object removal
- Chunk unloading - Remove all objects from scene

**What Needs to Change:**
- Option 1: Store `Array<objectId>` instead of mesh objects
- Option 2: Store `Array<InstanceData>` with all needed properties
- Option 3: Remove entirely, use objectRegistry as source of truth

---

## 6. PHYSICS SYSTEM ✅ (No Changes Needed!)

**File:** `core/PhysicsManager.js`

**Good news:** Physics uses `objectId` strings, not mesh references!

```javascript
createStaticCollider(objectId, shape, position, rotation, group)
getObjectIdFromCollider(colliderHandle)
removeCollider(objectId)
```

**Why it works:**
- Physics creates colliders with objectId identifier
- Proximity query returns objectId
- Can look up instance data by objectId

**No changes needed!** ✅

---

## 7. NAVIGATION SYSTEM ✅ (No Changes Needed!)

**File:** `navigation/NavigationMap.js`

**Good news:** Navigation uses positions/dimensions, not mesh objects!

```javascript
addCylindricalObstacle(x, z, radius)
removeObstacle(obstacleId)
```

**No changes needed!** ✅

---

## 8. SCENE OPERATIONS

### 8.1 Where Trees Are Added

**File:** `objects.js:650` (now 659 with test flag)

```javascript
if (!isTree || ENABLE_3D_TREE_MODELS) {
    scene.add(instance);  // ⚠️
}
```

**What Needs to Change:**
- For trees: Add to InstancedMesh instead of scene
- Return instance index instead of mesh object

### 8.2 Where Objects Are Removed

| File | Line | Context |
|------|------|---------|
| `world/ChunkManager.js` | 225 | Chunk unload |
| `world/ChunkManager.js` | 267 | Object removal |
| `objects.js` | 787 | Cleanup |

**What Needs to Change:**
- For trees: Hide instance (set scale to 0)
- For other objects: Keep current scene.remove()

---

## 9. PROPOSED INSTANCE DATA STRUCTURE

To replace mesh object in objectRegistry:

```javascript
{
    type: 'instance',
    treeType: 'oak',
    instanceIndex: 42,

    // Spatial data
    position: Vector3(x, y, z),
    rotation: 0,
    scale: 1.0,

    // Resource data
    quality: 75,
    remainingResources: 100,
    totalResources: 100,

    // Tracking data
    chunkKey: "0,0",
    objectId: "oak_0_0_42",

    // References
    billboardIndex: 15,
    physicsHandle: colliderHandle,

    // Flags
    isConstructionSite: false,

    // Copy of all current userData fields
}
```

---

## 10. FILES THAT NEED UPDATES

### High Priority (Core Changes):
1. ✅ `public/objects.js` - Already has test flag, needs instance creation
2. ❌ `public/game.js` - Proximity detection (lines 1891-1993)
3. ❌ `public/world/ChunkManager.js` - Object removal (lines 239-268)
4. ❌ `public/BillboardSystem.js` - Change from object → objectId mapping
5. ❌ `public/terrain.js` - Chunk object tracking

### Medium Priority (Supporting):
6. ❌ `public/network/MessageRouter.js` - Object creation from server
7. ❌ `public/systems/ResourceManager.js` - Harvesting completion

### New Files:
8. ❌ `public/core/TreeInstanceManager.js` - NEW (like BillboardSystem)

---

## 11. IMPLEMENTATION PRIORITY ORDER

### Phase 1: Infrastructure (Can add without breaking anything)
1. Create `TreeInstanceManager.js` (disabled by default)
2. Import into `game.js` (but don't use yet)
3. Add instance data structure definition

### Phase 2: Parallel Test (Both systems running)
1. Enable for ONE tree type (pine)
2. Dual-path in objectRegistry (support both formats)
3. Test creation (verify instances appear)

### Phase 3: Update Systems (One at a time)
1. Update proximity detection (support both formats)
2. Update removal system (support both formats)
3. Update billboard mapping (objectId instead of object)
4. Test each change thoroughly

### Phase 4: Expand & Cleanup
1. Enable all tree types
2. Remove dual-format support (instance-only)
3. Performance testing

---

## 12. RISK ASSESSMENT

### Low Risk (Easy to test, easy to rollback):
- ✅ Creating TreeInstanceManager.js
- ✅ Adding feature flags
- ✅ Dual-path in objectRegistry

### Medium Risk (Complex but isolated):
- ⚠️ Proximity detection updates
- ⚠️ Billboard mapping changes

### High Risk (Many dependencies):
- ❌ Object removal system
- ❌ Chunk tracking refactor

---

## 13. TESTING CHECKLIST

After each change, verify:

- [ ] Game loads without errors
- [ ] Trees render correctly
- [ ] Proximity detection ("Press E to harvest")
- [ ] Can harvest tree
- [ ] Tree disappears when harvested
- [ ] Billboard disappears with tree
- [ ] Doesn't respawn on chunk reload
- [ ] Physics collisions still work
- [ ] Navigation obstacles still work
- [ ] Multiplayer sync works
- [ ] FPS maintains 60+
- [ ] No memory leaks

---

## NEXT STEPS

1. ✅ Investigation complete
2. ❌ Create TreeInstanceManager.js skeleton
3. ❌ Add to game.js (disabled)
4. ❌ Test that game still works
5. ❌ Implement instance creation (one tree type)
6. ❌ Test rendering
7. ❌ ...continue incrementally

---

**Status:** Ready to proceed with Phase 2.1 (Create TreeInstanceManager skeleton)
**Estimated Time:** 3-4 days for full implementation
**Expected Performance:** 20 FPS → 60+ FPS


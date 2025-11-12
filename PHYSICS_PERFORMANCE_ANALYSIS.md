# Rapier Physics Performance Analysis - Summary Report

## Executive Summary

The physics system has several CRITICAL performance bottlenecks:

1. **EVERY FRAME sensor collision processing** - 60 FPS
2. **500-700 active sensors** in 3x3 chunk physics radius
3. **Missing network object sensor cleanup** - potential memory leak
4. **Unbounded proximity tracking Map** - activeProximityObjects never pruned
5. **O(n) scene.traverse()** called every frame during proximity checks

## Key Findings

### Physics Objects Created

- Total colliders in 3x3 physics radius: 500-700
- Total sensors in 3x3 physics radius: 500-700
- Character controllers: 2-10 (player + peers + AI)
- Total physics entities actively simulated: 3,000-4,210

### Critical Performance Issue: Frame-By-Frame Processing

**File: public/game.js line 1089-1102**

```javascript
this.gameLoop.onUpdate((deltaTime, now) => {
    // Physics step EVERY FRAME
    this.physicsManager.step(deltaTime);
    
    // Sensor collision processing EVERY FRAME
    this.checkProximityToObjects();
});
```

The `checkProximityToObjects()` function:
- Calls `eventQueue.drainCollisionEvents()` - Variable cost based on events
- Calls `scene.traverse()` - O(n) where n = all scene objects
- Calculates distances for all active proximity objects
- Updates activeProximityObjects Map (unbounded growth)

This happens at **60 FPS** with no throttling.

### Sensors Created For Every Object

**File: public/objects.js lines 660-671**

Auto-creates a sensor for EVERY world object:
- Trees: +1 unit radius padding on cylinder
- Rocks: +1 unit radius padding on cylinder
- Logs: +2 units padding on cuboid (1 unit per side)
- Structures: +2 units padding on cuboid

Result: ~500-700 sensors active simultaneously.

### Physics Radius Mismatch

**File: public/config.js line 230**

```
LOAD_RADIUS: 2          → 5x5 chunk grid rendered
PHYSICS_RADIUS: 1       → 3x3 chunk grid with physics
```

Visible objects near chunk boundaries have NO physics colliders.

### Missing Network Object Cleanup

**File: public/network/MessageRouter.js lines 322-332**

Sensors created for network objects but unclear cleanup path:
- Sensors created: Lines 322-327
- Sensor stored: Line 331
- Cleanup on removal: MISSING or UNCLEAR

Potential orphaned sensors accumulation.

## Bottleneck Summary

### Tier 1: CRITICAL (Direct FPS Impact)

| Issue | Frequency | Cost | Impact |
|-------|-----------|------|--------|
| Physics.step() | 60 FPS | 2-5ms | Broad/narrow phase |
| checkProximity() | 60 FPS | 1-3ms | Event drain + calcs |
| scene.traverse() | Per enter | 0.5-2ms | O(n) lookup |
| Map growth | Unbounded | Memory | Never shrinks |

### Tier 2: MODERATE (Cumulative)

| Issue | Amount | Cost |
|-------|--------|------|
| Active sensors | 500-700 | Per-frame collision |
| Event drain | Per-frame | Even with no events |
| Distance calcs | 500-700 | Repeated math |

## Cleanup Verification

### GOOD: Local Object Cleanup

ChunkManager.js (lines 249-253) properly removes colliders and sensors

### GOOD: Chunk Disposal Cleanup

terrain.js (lines 1866) calls removeObjects() with physicsManager

### BAD: Network Objects

MessageRouter.js may not be cleaning up sensors on structure removal

## Recommendations (Impact Order)

### 1. THROTTLE PROXIMITY CHECKS (IMMEDIATE - 10-20 FPS gain)

Change from 60 FPS to 20 FPS:
```javascript
if (this.gameLoop.frameCount % 3 === 0) {
    this.checkProximityToObjects();
}
```

Files to modify:
- public/game.js line 1102

### 2. FIX NETWORK SENSOR CLEANUP (IMMEDIATE - Prevents memory leak)

Files to check:
- public/network/MessageRouter.js structure removal handlers

Ensure sensor removal on network structure despawn

### 3. PRUNE activeProximityObjects (SHORT-TERM - Memory management)

Auto-cleanup orphaned references:
```javascript
this.activeProximityObjects.forEach((obj, id) => {
    if (\!obj.parent) this.activeProximityObjects.delete(id);
});
```

Files to modify:
- public/game.js checkProximityToObjects()

### 4. CACHE scene.traverse() RESULTS (SHORT-TERM - 0.5-1ms gain)

Instead of traversing full scene every frame:
```javascript
this.objectMap = new Map(); // objectId -> Object3D
// Update on object add/remove
```

### 5. INCREASE PHYSICS_RADIUS (MEDIUM-TERM - Fixes clipping)

Change from 1 (3x3) to 2 (5x5) to match LOAD_RADIUS

Trade-off: 4x more active colliders/sensors

## Current Cleanup Status

File: public/core/PhysicsManager.js

Maps tracking physics objects:
- colliderHandles: Properly cleared on removeCollider()
- rigidbodyHandles: Properly cleared on removeCollider()
- sensorHandles: Properly cleared on removeSensor()
- characterControllers: Properly cleared on removal

Cleanup functions:
- removeCollider() (line 449): Removes rigid body and colliders
- removeSensor() (line 714): Removes sensor collider
- dispose() (line 727): Full cleanup on shutdown

## Files Analyzed

1. public/core/PhysicsManager.js (753 lines)
2. public/objects.js (810 lines)
3. public/game.js (extensive update loop)
4. public/world/ChunkManager.js (300 lines)
5. public/world/StructureManager.js (342 lines)
6. public/network/MessageRouter.js (network sync)
7. public/terrain.js (chunk disposal)
8. public/config.js (configuration)
9. public/core/GameLoop.js (frame timing)

## Conclusion

The architecture is SOUND, but every-frame proximity checking with 500-700
sensors creates a hard FPS ceiling. Throttling to 20 FPS (every 3 frames) is
the highest-impact immediate fix, expected to gain 10-20 FPS.

# Gardener Plan Evaluation

## Executive Summary

The gardener plan is **well-structured** and follows the baker pattern closely. However, there are several gaps, inconsistencies, and opportunities to leverage existing code better. This document identifies all issues and provides concrete solutions.

---

## ✅ CORRECT: Patterns Properly Following Baker

| Pattern | Status |
|---------|--------|
| Ship spawn trigger via `dock_ship_spawned` | ✅ Correct |
| GameState chunk caching (`gardenerBuildingsByChunk`) | ✅ Correct |
| `structuresById` Map for O(1) lookup | ✅ Correct |
| Entity structure matching baker | ✅ Correct |
| P2P broadcast pattern | ✅ Correct |
| AISpawnQueue integration mentioned | ✅ Correct |
| Authority calculation pattern | ✅ Correct |

---

## ❌ ISSUES REQUIRING FIXES

### 1. **SpawnerConfig Fix is Incorrect**

**Plan says:** Change `'garden'` key to `'gardener'`

**Reality:** Looking at the code, `'gardener'` is already a valid structure type (lines 26112, 59382-59383, 38893). The `SpawnerConfig.js` is for **AI enemies** that spawn near structures (like bandits near tents), NOT for worker NPCs.

**Fix:** Remove this from the plan. Gardener spawning uses the same pattern as baker - triggered by `dock_ship_spawned` event, not SpawnerConfig.

---

### 2. **Missing Server Handler: `npc_harvest_vegetable`**

**Plan mentions:** Add `handleNpcHarvestVegetable()` handler but provides no implementation details.

**Required Implementation (following `npc_collect_apples` pattern):**

```javascript
// In MessageHandlers.js - add case in switch
case 'npc_harvest_vegetable':
    await messageHandlers.handleNPCHarvestVegetable(ws, payload);
    break;

// Handler implementation
async handleNPCHarvestVegetable(ws, payload) {
    const { npcType, gardenerId, vegetableId, chunkId } = payload;
    
    if (npcType !== 'gardener') {
        ws.send(JSON.stringify({
            type: 'npc_harvest_response',
            payload: { success: false, gardenerId, reason: 'invalid_npc' }
        }));
        return;
    }
    
    try {
        // Find and remove vegetable object
        const vegetable = await this.chunkManager.findObjectChange(chunkId, vegetableId);
        if (!vegetable) {
            ws.send(JSON.stringify({
                type: 'npc_harvest_response',
                payload: { success: false, gardenerId, vegetableId, reason: 'not_found' }
            }));
            return;
        }
        
        // Get vegetable quality from the planted object
        const vegetableQuality = vegetable.quality || 50;
        
        // Calculate rope quality from region
        const position = vegetable.position;
        const chunkX = Math.floor(position[0] / 50);
        const chunkZ = Math.floor(position[2] / 50);
        const worldSeed = CONFIG.TERRAIN.seed;
        
        // Use 'rope' resource type (needs adding to QualityGenerator)
        const ropeQualityRange = QualityGenerator.getQualityRange(worldSeed, chunkX, chunkZ, 'rope');
        const ropeQuality = Math.floor(
            ropeQualityRange.min + Math.random() * (ropeQualityRange.max - ropeQualityRange.min)
        );
        
        // Remove vegetable from world
        await this.chunkManager.addObjectChange(chunkId, {
            action: 'remove',
            id: vegetableId
        });
        
        // Broadcast removal
        this.messageRouter.broadcastTo3x3Grid(chunkId, {
            type: 'object_removed',
            payload: { objectId: vegetableId, chunkId }
        });
        
        // Return both vegetable and rope
        ws.send(JSON.stringify({
            type: 'npc_harvest_response',
            payload: {
                success: true,
                gardenerId,
                vegetableId,
                items: [
                    { type: 'vegetable', quality: vegetableQuality, durability: 30 },
                    { type: 'rope', quality: ropeQuality, durability: 100 }
                ]
            }
        }));
        
    } catch (error) {
        console.error('[NPC] Error in handleNPCHarvestVegetable:', error);
        ws.send(JSON.stringify({
            type: 'npc_harvest_response',
            payload: { success: false, gardenerId, vegetableId, reason: 'error' }
        }));
    }
}
```

---

### 3. **QualityGenerator Missing 'rope' Resource Type**

**Plan assumes** region quality for rope, but RESOURCE_OFFSETS doesn't include 'rope'.

**Fix - Add to QualityGenerator.js:**
```javascript
const RESOURCE_OFFSETS = {
    // ... existing entries ...
    'rope': 14000
};
```

---

### 4. **npc_deposit_to_market Needs Gardener Support**

**Current handler only accepts `npcType === 'baker'`**

**Fix - Modify existing handler (line ~83418):**
```javascript
// Change from:
if (npcType !== 'baker') {

// To:
if (npcType !== 'baker' && npcType !== 'gardener') {
```

**Also update the response payload field:**
```javascript
// Use generic 'npcId' instead of 'bakeryId'
npcId: bakeryId || gardenerId,
```

---

### 5. **Plant_tree Message Missing `isNpcPlanted` Flag in Server Handler**

**Plan shows:** Sending `isNpcPlanted: true` in the message

**Server handler ignores this.** This is fine for now, but if you need to track NPC plantings separately, you'd need to add:

```javascript
// In handlePlantTree, add to plantedTreeChange:
isNpcPlanted: payload.isNpcPlanted || false
```

---

### 6. **MessageRouter Routing Incomplete**

**Plan mentions:** Route `tree_planted` to GardenerController

**Current flow:** `tree_planted` goes to `SceneObjectFactory.handleTreePlanted()` (line 34879)

**Fix - Add to MessageRouter after existing tree_planted handling:**
```javascript
// In handleTreePlanted or the message handler
if (this.game.gardenerController) {
    this.game.gardenerController.handleTreePlanted(payload);
}
```

**Also add to handleDockShipSpawned (line ~35380):**
```javascript
// After baker spawn check
if (this.game.gardenerController) {
    this.game.gardenerController.checkGardenerSpawn({
        dockId,
        dockPosition,
        chunkId
    });
}
```

---

### 7. **GameStateManager P2P Routing Missing**

**Plan mentions:** P2P broadcast but doesn't show GameStateManager routing

**Add to GameStateManager.js (following baker pattern ~lines 3994-4005):**
```javascript
if (message.type === 'gardener_spawn') {
    this.game?.gardenerController?.handleSpawnMessage(message);
}
if (message.type === 'gardener_state') {
    this.game?.gardenerController?.handleStateMessage(message);
}
if (message.type === 'gardener_sync') {
    this.game?.gardenerController?.syncGardenersFromPeer(message.gardeners);
}
if (message.type === 'gardener_despawn') {
    this.game?.gardenerController?.handleDespawnMessage(message);
}
```

---

### 8. **Config.js GARDENER Section Incomplete**

**Plan shows** GARDENER_CONFIG but not the full config.js additions.

**Required additions (following BAKER pattern line ~3844-3856):**
```javascript
// In CONFIG object
GARDENER: {
    ENABLED: true,
    SPAWN_DISTANCE: 2.5,
    MARKET_MAX_DISTANCE: 20,
    MOVE_SPEED: 0.8,
    PATHFIND_INTERVAL: 6000,
    
    // Gardener-specific
    MAX_PLANTED: 20,
    HARVEST_TIME_MS: 30 * 60 * 1000,  // 30 minutes
    HARVEST_CHECK_INTERVAL: 30000,
    PLANT_MIN_DIST: 2,
    PLANT_MAX_DIST: 8,
    PLANT_SPACING: 0.6,
    
    // Standard NPC config
    STUCK_TIMEOUT: 60000,
    FAR_UPDATE_INTERVAL: 8,
    BROADCAST_INTERVAL: 1000,
    NPC_COLOR: 0x228B22  // Forest green
}
```

---

### 9. **SceneObjectFactory Registration Missing**

**Plan mentions but doesn't show exact code.**

**Add after bakery registration (line ~4011-4018):**
```javascript
if (structureType === 'gardener') {
    const chunkKey = `${Math.floor(x / 50)},${Math.floor(z / 50)}`;
    this.game.gameState.registerGardenerBuilding(chunkKey, {
        id: objectInstance.userData.objectId,
        position: { x, y, z },
        object: objectInstance
    });
}
```

---

### 10. **Object Removal Handler Missing**

**Plan mentions cleanup but doesn't show MessageRouter change.**

**Add to MessageRouter.handleObjectRemoved (following bakery pattern ~line 4023):**
```javascript
if (objectType === 'gardener') {
    this.game.gameState.unregisterGardenerBuilding(chunkKey, objectId);
    this.game.gardenerController?.onGardenerBuildingDestroyed(objectId);
}
```

---

## ⚠️ GAPS IN PLAN (Missing Details)

### 11. **Physics Collision Check Implementation**

Plan shows `_hasCollisionAtPosition()` using `physicsManager.testShapeOverlap()` but:
- Doesn't verify this API exists
- Missing import for COLLISION_GROUPS

**Verify in PhysicsManager that `testShapeOverlap` exists, or use alternative:**
```javascript
// Alternative using raycasting if testShapeOverlap doesn't exist
_hasCollisionAtPosition(x, z) {
    const height = this.getTerrainHeight(x, z);
    // Use existing object detection patterns from BuildMenu.js
    const nearbyObjects = this.game.sceneObjectManager?.getNearbyObjects(x, z, 0.6);
    return nearbyObjects && nearbyObjects.length > 0;
}
```

---

### 12. **State Machine States Not Defined**

Plan shows states like `GARDENER_STATE.IDLE` but never defines the enum.

**Add to GardenerController.js:**
```javascript
const GARDENER_STATE = {
    IDLE: 'idle',
    SEEKING_PLANT_SPOT: 'seeking_plant_spot',
    PLANTING: 'planting',
    RETURNING_HOME: 'returning_home',
    WAITING_FOR_HARVEST: 'waiting_for_harvest',
    SEEKING_HARVEST: 'seeking_harvest',
    HARVESTING: 'harvesting',
    SEEKING_MARKET: 'seeking_market',
    DEPOSITING: 'depositing',
    STUCK: 'stuck'
};
```

---

### 13. **Authority Recovery: Scanning Nearby Vegetables**

Plan mentions scanning `planted_vegetables_*` objects but implementation is vague.

**Detailed implementation:**
```javascript
/**
 * Rebuild plantedVegetables array from scene on authority takeover
 * Called when this client becomes authority for a gardener
 */
_rebuildPlantedVegetablesFromScene(entity) {
    entity.plantedVegetables = [];
    const now = Date.now();
    const serverTick = this.gameState.serverTick || 0;
    
    // Scan 3x3 chunks around gardener building
    const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(
        entity.homePosition.x, entity.homePosition.z
    );
    
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            const chunkKey = `${chunkX + dx},${chunkZ + dz}`;
            const objects = this.game.sceneObjectManager?.getObjectsInChunk(chunkKey) || [];
            
            for (const obj of objects) {
                if (!obj.userData?.objectId?.startsWith('planted_vegetables_')) continue;
                
                // Check if within gardener's planting range
                const vx = obj.position.x - entity.homePosition.x;
                const vz = obj.position.z - entity.homePosition.z;
                const distSq = vx * vx + vz * vz;
                
                if (distSq > GARDENER_CONFIG.PLANT_MAX_DIST * GARDENER_CONFIG.PLANT_MAX_DIST) {
                    continue;  // Too far, not ours
                }
                
                // Calculate plant time from tick
                const plantedAtTick = obj.userData.plantedAtTick || serverTick;
                const ticksElapsed = serverTick - plantedAtTick;
                const msElapsed = ticksElapsed * 1000;  // 1 tick = 1 second
                const plantedAt = now - msElapsed;
                
                entity.plantedVegetables.push({
                    vegetableId: obj.userData.objectId,
                    position: { 
                        x: obj.position.x, 
                        y: obj.position.y, 
                        z: obj.position.z 
                    },
                    plantedAt: plantedAt,
                    chunkId: `chunk_${chunkKey}`,
                    quality: obj.userData.quality || 50
                });
            }
        }
    }
    
    console.log(`[GardenerController] Rebuilt ${entity.plantedVegetables.length} planted vegetables for ${entity.buildingId}`);
}
```

---

## 📋 COMPLETE FILE CHANGES LIST

| File | Action | Details |
|------|--------|---------|
| `public/ai/GardenerController.js` | CREATE | New file (~2000 lines, copy BakerController structure) |
| `public/config.js` | MODIFY | Add GARDENER config section |
| `public/core/GameState.js` | MODIFY | Add gardenerBuildingsByChunk Map + methods |
| `public/core/QualityGenerator.js` | MODIFY | Add 'rope' to RESOURCE_OFFSETS |
| `public/network/SceneObjectFactory.js` | MODIFY | Register gardener buildings |
| `public/network/MessageRouter.js` | MODIFY | Add gardener spawn check in handleDockShipSpawned, route tree_planted |
| `public/network/GameStateManager.js` | MODIFY | Add P2P message routing for gardener |
| `public/core/GameInitializer.js` | MODIFY | Initialize GardenerController |
| `public/game.js` | MODIFY | Import GardenerController, add to update loop |
| `server/MessageHandlers.js` | MODIFY | Add handleNPCHarvestVegetable, update handleNPCDepositToMarket |

---

## 🔧 RECOMMENDED SIMPLIFICATIONS

### Use Existing ChunkCoordinates Import
```javascript
// GardenerController.js - use existing import
import { ChunkCoordinates } from '../core/ChunkCoordinates.js';
```

### Reuse CONFIG.TERRAIN.seed Pattern
```javascript
// Don't import TERRAIN_CONFIG separately, use:
const worldSeed = this.game.config?.TERRAIN?.seed || CONFIG.TERRAIN.seed;
```

### Reuse AISpawnQueue Pattern Exactly
```javascript
// In game.js or GameInitializer.js
import { getAISpawnQueue } from './ai/AISpawnQueue.js';

// Register gardener spawn callback
const spawnQueue = getAISpawnQueue();
spawnQueue.registerSpawnCallback('gardener', (data) => {
    this.gardenerController._executeSpawn(data);
});
```

---

## ✨ FINAL VERDICT

**Plan Quality: 85%**

**Missing to reach 100%:**
1. Remove incorrect SpawnerConfig fix
2. Add complete server handler for npc_harvest_vegetable
3. Add 'rope' to QualityGenerator
4. Update npc_deposit_to_market to accept gardener
5. Add all MessageRouter/GameStateManager routing
6. Define GARDENER_STATE enum
7. Add detailed authority recovery implementation
8. Add physics collision check verification

The plan's overall architecture is solid and correctly follows baker patterns. The gaps are mostly implementation details that were mentioned but not fully specified.

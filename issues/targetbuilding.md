# Artillery Structure Targeting - Implementation Plan

## Overview

Add the ability for artillery to target and damage structures:
1. **Bandit structures** (tents, campfires) - always targetable
2. **Enemy faction player structures** - targetable if owner is opposite faction
3. On hit: reduce structure durability by ~24 hours worth of decay
4. After damage: perform immediate ruin check

---

## Validation Status

**Plan reviewed against existing codebase patterns. Issues found and corrected below.**

| Area | Status | Notes |
|------|--------|-------|
| Targeting pattern | CORRECTED | Fixed chunk key method, expanded structure list |
| Durability approach | CORRECTED | Use `lastRepairTime` not `quality` reduction |
| Server handler | CORRECTED | Minimal server (trust client), correct load method |
| Owner faction enrichment | CORRECTED | Batch-fetch approach, new AuthManager method |
| P2P sync | CORRECTED | Effects via P2P, persistence via server |

---

## Research Findings

### 1. Structure Ownership System

**Bandit Structure Identification:**
- Property: `isBanditStructure: true`
- Set in: `server/MessageHandlers.js:568-601`
- Stored in: `userData.isBanditStructure` on client (`SceneObjectFactory.js:466`)

**Player Structure Ownership:**
- Property: `owner: accountId` (persistent player ID)
- Property: `ownerName: string` (display name)
- Stored in chunk data: `objectChanges[].owner`

**Faction Detection:**
- `GameState.isEnemyFaction(otherFactionId)` - handles neutral correctly
- **LIMITATION:** Client doesn't know structure owner's faction ID
- **SOLUTION NEEDED:** Add `ownerFactionId` to structure data when server enriches it

### 2. Structure Durability System

**Storage Properties:**
- `quality` (1-100) - determines max lifespan
- `lastRepairTime` (ms) - when last built/repaired
- `currentDurability` (computed) - current health %

**Decay Formula:**
```javascript
maxLifespanHours = quality^1.434
remainingHours = maxLifespanHours - elapsedHours
currentDurability = remainingHours^0.697
```

**Key Constants:** (`MessageRouter.js:17-19`)
```javascript
const DECAY_EXPONENT = 1.434;
const DECAY_INVERSE = 0.697;
```

**How to Reduce Durability:**
Currently, durability is time-based only. To reduce by damage:
- Option A: Reduce `quality` (affects max lifespan)
- Option B: Advance `lastRepairTime` backward (simulates time passage)
- **Option B is cleaner** - reducing quality by X effectively reduces durability

### 3. Ruin Check System

**Trigger:** Client checks every 60 ticks in `MessageRouter.checkStructureDecay()`

**Flow when durability <= 0:**
1. Client sends `convert_to_ruin` message
2. Server removes structure, creates ruin model
3. Server broadcasts `object_removed` + `object_added` (ruin)
4. Ruin expires after 1 hour via `remove_ruin`

**Key Method:** `MessageRouter.js:2356-2453` - `checkStructureDecay()`

**Immediate Ruin Check:**
Can call durability calculation directly:
```javascript
// MessageRouter.js:2313-2337
calculateStructureDurability(userData)
```

### 4. Artillery Hit System

**Current Target Finding:** `game.js:3819-3898` - `findArtilleryTarget()`
- Checks: bandits, brown bears, enemy players
- Uses 15-degree cone and range check
- Returns nearest valid target

**Current Damage Application:** `game.js:3971-4009` - `applyArtilleryDamage()`
- Handles: bandits (kill), bears (kill), players (P2P damage message)

**Hit Chance:** `game.js:3929-3949` - `calculateArtilleryHitChance()`
- Base 35%, up to 80% based on distance/height/quality

---

## Implementation Plan

### Step 1: Add Owner Faction to Structure Data

**File: `server/AuthManager.js` - Add efficient faction lookup:**

```javascript
// NEW METHOD - Single column query (not full loadPlayerData which loads 11 columns)
async getFactionById(playerId) {
    if (!playerId) return null;
    if (!this.useDatabase) {
        const data = this.localPlayerData.get(playerId);
        return data?.factionId || null;
    }

    try {
        const result = await db.query(
            'SELECT faction_id FROM player_data WHERE player_id = $1',
            [playerId]
        );
        return result.rows.length > 0 ? result.rows[0].faction_id : null;
    } catch (error) {
        console.error('Get faction error:', error);
        return null;
    }
}
```

**File: `server/MessageHandlers.js` - Batch-fetch factions in handleJoinChunk():**

```javascript
// In handleJoinChunk(), before enrichment loop (~line 139):

// Batch fetch all unique owners' factions first (avoids N+1 queries)
const uniqueOwners = new Set();
objectChanges.forEach(obj => {
    if (obj.owner && obj.action === 'add') {
        uniqueOwners.add(obj.owner);
    }
});

const ownerFactions = new Map();
await Promise.all(Array.from(uniqueOwners).map(async ownerId => {
    const factionId = await this.authManager.getFactionById(ownerId);
    ownerFactions.set(ownerId, factionId);
}));

// Then in the enrichment loop, add:
if (obj.owner) {
    enriched.ownerFactionId = ownerFactions.get(obj.owner) ?? null;
}
```

### Step 2: Add Structures to Artillery Target Finding

**File:** `game.js` - `findArtilleryTarget()`

After checking players (~line 3895), add structure check:

```javascript
// Check structures (bandit and enemy faction owned)
// CORRECTED: Use worldToChunk() + get3x3ChunkKeys() (worldToChunkKey doesn't exist)
const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(artilleryPos.x, artilleryPos.z);
const chunkKeys = ChunkCoordinates.get3x3ChunkKeys(chunkX, chunkZ);

for (const key of chunkKeys) {
    const chunkObjects = this.chunkManager?.chunkObjects?.get(key) || [];
    for (const obj of chunkObjects) {
        if (!this.isValidArtilleryStructureTarget(obj)) continue;

        const structPos = obj.position;
        const target = this.checkArtilleryTarget(artilleryPos, structPos, dirX, dirZ, rangeSq, CONE_ANGLE);
        if (target && target.distSq < nearestDistSq) {
            nearestDistSq = target.distSq;
            nearestTarget = {
                entity: obj,
                type: 'structure',
                position: structPos.clone(),
                distance: Math.sqrt(target.distSq),
                structureId: obj.userData.objectId,
                chunkKey: obj.userData.chunkKey
            };
        }
    }
}
```

**New Helper Method:**
```javascript
isValidArtilleryStructureTarget(obj) {
    const userData = obj.userData;
    if (!userData) return false;

    // CORRECTED: Expanded structure type list (matches InteractionManager)
    const structureTypes = new Set([
        'tent', 'campfire', 'house', 'crate', 'outpost', 'garden', 'market',
        'dock', 'tileworks', 'ironworks', 'blacksmith', 'bakery', 'gardener',
        'miner', 'woodcutter', 'stonemason', 'bearden'
    ]);
    if (!structureTypes.has(userData.modelType)) return false;

    // Skip ruins and construction sites
    if (userData.isRuin || userData.isConstructionSite) return false;

    // Bandit structures are always valid targets
    if (userData.isBanditStructure) return true;

    // Player structures: check if owner is enemy faction
    if (userData.owner && userData.ownerFactionId !== undefined) {
        return this.gameState.isEnemyFaction(userData.ownerFactionId);
    }

    return false;
}
```

**Alternative (Better Performance):** Use spatial query instead of chunk iteration:
```javascript
// Uses Rapier physics spatial partitioning - O(1) lookup
const nearbyColliders = this.physicsManager.querySphere(
    artilleryPos,
    range,
    COLLISION_GROUPS.STRUCTURE
);

for (const collider of nearbyColliders) {
    const objectId = this.physicsManager.getObjectIdFromCollider(collider);
    const obj = this.objectRegistry.get(objectId);
    if (obj && this.isValidArtilleryStructureTarget(obj)) {
        // ... check artillery target
    }
}
```

### Step 3: Apply Structure Damage

**File:** `game.js` - `applyArtilleryDamage()`

Add case for `type: 'structure'`:

```javascript
case 'structure':
    this.applyArtilleryStructureDamage(target, isHit);
    break;
```

**New Method (FLAT DAMAGE: 50 durability per hit):**
```javascript
applyArtilleryStructureDamage(target) {
    const structure = target.entity;
    const userData = structure.userData;
    if (!userData) return;

    const DAMAGE_AMOUNT = 50;  // Flat durability damage per hit
    const DECAY_EXPONENT = 1.434;
    const DECAY_INVERSE = 0.697;

    // Calculate current durability
    const quality = userData.quality || 50;
    const maxLifespanHours = Math.pow(quality, DECAY_EXPONENT);
    const now = Date.now();
    const elapsedMs = now - (userData.lastRepairTime || now);
    const elapsedHours = elapsedMs / (1000 * 60 * 60);
    const remainingHours = Math.max(0, maxLifespanHours - elapsedHours);
    const currentDurability = Math.pow(remainingHours, DECAY_INVERSE);

    // Apply flat damage
    const newDurability = currentDurability - DAMAGE_AMOUNT;

    if (newDurability <= 0) {
        // Structure destroyed - convert to ruin immediately
        userData._decayMessageSent = true;
        this.networkManager.sendMessage('convert_to_ruin', {
            structureId: userData.objectId,
            chunkId: `chunk_${userData.chunkKey}`
        });
    } else {
        // Reverse-calculate new lastRepairTime from new durability
        const newRemainingHours = Math.pow(newDurability, 1 / DECAY_INVERSE);
        const newElapsedHours = maxLifespanHours - newRemainingHours;
        const newLastRepairTime = now - (newElapsedHours * 60 * 60 * 1000);

        // Update local userData
        userData.lastRepairTime = newLastRepairTime;
        userData.currentDurability = newDurability;

        // Send damage to server for persistence and broadcast
        this.networkManager.sendMessage('artillery_structure_damage', {
            structureId: userData.objectId,
            chunkId: `chunk_${userData.chunkKey}`,
            lastRepairTime: newLastRepairTime
        });
    }
}
```

### Step 4: Server-Side Structure Damage Handler

**File:** `server/MessageHandlers.js`

**Design:** Minimal server - trust client validation (matches existing combat/ruin patterns).

```javascript
async handleArtilleryStructureDamage(ws, payload) {
    const { structureId, chunkId, lastRepairTime } = payload;

    const chunkData = await this.chunkManager.loadChunk(chunkId);
    if (!chunkData?.objectChanges) return;

    const structure = chunkData.objectChanges.find(obj => obj.id === structureId);
    if (!structure) return;

    // Basic sanity check only (prevents errors, not anti-cheat)
    if (structure.isRuin) return;

    // Apply damage (prevent future times)
    structure.lastRepairTime = Math.min(lastRepairTime, Date.now());

    // Save and broadcast
    await this.chunkManager.saveChunk(chunkId, chunkData);

    const durabilityInfo = enrichStructureWithDurability(structure);
    this.messageRouter.broadcastTo3x3Grid(chunkId, {
        type: 'structure_damaged',
        payload: {
            structureId: structureId,
            lastRepairTime: structure.lastRepairTime,
            currentDurability: durabilityInfo.currentDurability
        }
    });
}
```

**File:** `server.js` - Add message routing (~line 273):
```javascript
case 'artillery_structure_damage':
    await messageHandlers.handleArtilleryStructureDamage(ws, payload);
    break;
```

### Step 5: Client-Side Damage Reception

**File:** `public/network/MessageRouter.js`

```javascript
handleStructureDamaged(payload) {
    const { structureId, lastRepairTime, currentDurability, hoursUntilRuin } = payload;

    const structure = this.game.objectRegistry?.findByObjectId(structureId);
    if (structure) {
        // CORRECTED: Update lastRepairTime (not quality)
        structure.userData.lastRepairTime = lastRepairTime;
        structure.userData.currentDurability = currentDurability;
        structure.userData.hoursUntilRuin = hoursUntilRuin;

        // Show damage effect
        if (this.game.effectManager) {
            this.game.effectManager.spawnArtilleryImpact(structure.position, true);
        }

        console.log(`[Structure Damaged] ${structureId}: Durability ${currentDurability.toFixed(1)}`);
    }
}
```

**Register handler in MessageRouter constructor or init:**
```javascript
// In the message type switch:
case 'structure_damaged':
    this.handleStructureDamaged(payload);
    break;
```

### Step 6: P2P Broadcast for Structure Hits

**File:** `game.js` - In `fireArtillery()` broadcast section (~line 3800)

Include structure target info in `artillery_fire` payload:
```javascript
this.networkManager.broadcastP2P({
    type: 'artillery_fire',
    payload: {
        artilleryId: manningState.artilleryId,
        heading: heading,
        impactPos: hitResult.impactPos ? [...] : null,
        isHit: hitResult.isHit,
        targetType: hitResult.target?.type || null,  // Now includes 'structure'
        structureId: hitResult.target?.type === 'structure' ? hitResult.target.structureId : null
    }
});
```

**File:** `public/network/GameStateManager.js` - In `handleArtilleryFire()`

Add structure impact effects for peers:
```javascript
handleArtilleryFire(payload, fromPeer, peerData) {
    const { artilleryId, heading, impactPos, isHit, targetType, structureId } = payload;

    // ... existing muzzle flash and smoke code ...

    // Spawn impact effect (works for all target types including structures)
    if (impactPos && this.game?.effectManager) {
        this.game.effectManager.spawnArtilleryImpact(
            { x: impactPos[0], y: impactPos[1], z: impactPos[2] },
            isHit
        );
    }
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `server/AuthManager.js` | Add `getFactionById()` method |
| `server/MessageHandlers.js` | Add faction batch-fetch in `handleJoinChunk()`, add `handleArtilleryStructureDamage()` |
| `server.js` | Add message routing for `artillery_structure_damage` |
| `public/game.js` | Add structure targeting in `findArtilleryTarget()`, `isValidArtilleryStructureTarget()`, `applyArtilleryStructureDamage()`, `checkStructureForRuin()` |
| `public/network/MessageRouter.js` | Add `handleStructureDamaged()` handler |
| `public/network/GameStateManager.js` | Handle structure hits in `handleArtilleryFire()` for visual effects |

---

## Design Decisions

### Why flat durability damage?

| Approach | Pros | Cons |
|----------|------|------|
| Time-based (24 hours) | Simple ms subtraction | Unequal damage: high quality structures take many more hits |
| Flat durability (50) | Equal damage for all structures | Requires reverse-calculation of lastRepairTime |

**Decision:** Use flat 50 durability damage per hit. This makes combat predictable - 2 hits destroys any structure regardless of quality. The implementation reverse-calculates `lastRepairTime` to achieve the target durability.

### Why minimal server validation?

The game trusts clients for combat, bandit kills, and ruin conversion. Artillery structure damage follows the same pattern:
- Client does all targeting/faction validation
- Server just persists and broadcasts
- Keeps server load low (priority for this game)

### Damage amount: 50 durability

One artillery hit reduces structure durability by 50 points (out of ~100 max). For all structures:
- Fresh structure (100 durability): 2 hits to destroy
- Half-decayed structure (50 durability): 1 hit to destroy

---

## Implementation Status

**IMPLEMENTED** - All steps completed

| Step | File | Status |
|------|------|--------|
| 1a | `server/AuthManager.js` | Added `getFactionById()` method (lines 878-898) |
| 1b | `server/MessageHandlers.js` | Added faction batch-fetch in `handleJoinChunk()` and `handleChunkUpdate()` |
| 1c | `public/network/SceneObjectFactory.js` | Added `ownerFactionId` storage in userData |
| 2 | `public/game.js` | Added structure targeting in `findArtilleryTarget()` + `isValidArtilleryStructureTarget()` |
| 3 | `public/game.js` | Added `applyArtilleryStructureDamage()`, `checkStructureForRuin()`, structure case in `applyArtilleryDamage()` |
| 4a | `server/MessageHandlers.js` | Added `handleArtilleryStructureDamage()` handler |
| 4b | `server.js` | Added message routing for `artillery_structure_damage` |
| 5 | `public/network/MessageRouter.js` | Added `structure_damaged` handler registration and `handleStructureDamaged()` method |
| 6 | `public/game.js`, `public/network/GameStateManager.js` | Updated P2P broadcast payload with `structureId`, updated handler extraction |

---

## Testing Checklist

- [ ] Artillery targets bandit tents/campfires
- [ ] Artillery targets enemy faction player structures
- [ ] Artillery does NOT target same faction structures
- [ ] Artillery does NOT target neutral player structures (if you're in faction)
- [ ] Neutral players cannot target any player structures
- [ ] Structure durability reduces on hit (lastRepairTime advances)
- [ ] Structure converts to ruin when durability reaches 0
- [ ] P2P sync shows damage effects to other players
- [ ] Server persists damage correctly
- [ ] Multiple simultaneous hits don't cause overflow issues
- [ ] Structure on chunk boundary is properly targeted (3x3 chunk check)
- [ ] Repair system can restore damaged structures

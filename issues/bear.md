# Bear Chase FPS Drop Analysis

Investigation into why FPS drops significantly when a bear is chasing the player.

---

## HIGH IMPACT - Likely Culprits

### 1. Combat Target Finding
**File:** `public/player/PlayerCombat.js:275+`
**Status:** FIXED (2025-12-26)

~~Originally thought to run every frame - actually throttled to 1000ms.~~

Target finding was already throttled to once per second and used squared distances. Added early exit optimization: when a target is found within 10 units, remaining entity type checks are skipped (bandits, deer, bears, players).

**Already had:**
- 1 second throttle on target checks
- Squared distance comparisons
- 35 unit range filters on deer/bears/players

**Added:**
- `EARLY_EXIT_DIST_SQ = 100` (10 units) - skips remaining entity types when close target found

### 2. Animation Mixer Updates Per Bear Per Frame
**File:** `public/entity/BrownBearManager.js:60-139`

Each bear calls `mixer.update(deltaTime/1000)` every frame for skeletal bone animation. During chase, the run animation is active. If multiple bears are in view, this compounds quickly. The code also has up to 8 mixer update call sites that can trigger during state transitions.

### 3. Cross-Controller Registry Lookups
**File:** `public/ai/BrownBearController.js:320-353`

Every frame, authority bears iterate through ALL bandits + ALL deer looking for targets:
- O(n) iteration through all bandits
- O(n) iteration through all deer
- No early-exit optimization - continues even after finding a target

---

## MEDIUM IMPACT - Contributing Factors

### 4. Math.sqrt() in Bear Movement
**File:** `public/ai/BrownBearController.js:420`

```javascript
const dist = Math.sqrt(dx * dx + dz * dz);
```

Called per frame for each chasing bear in `_moveToward()`. Other places use squared distances, but this one doesn't.

### 5. Structure Detection Every 500ms
**File:** `public/ai/BrownBearController.js:619-647`

`_findNearestStructure()` iterates all objects in a 3x3 chunk grid (9 chunks of objects) to check for nearby structures. Happens during chase to determine fleeing priority.

### 6. Target Validation Frequency Increases During Chase
- Idle: Full scan every 30 frames
- Chasing: Validation every 5 frames, full re-scan every 60 frames

This means more frequent expensive operations during chase state.

### 7. Roar Sound Every 3 Seconds
**File:** `public/ai/BrownBearController.js:803-806`

Positional audio processing with `playPositionalSound('brownbear')` during chase.

---

## LOWER IMPACT - Less Likely But Worth Noting

### 8. Avatar Manager Updates
**File:** `public/entity/AvatarManager.js:298`

Each peer avatar has a `Math.sqrt()` call per frame for distance calculation:
```javascript
const distance = Math.sqrt(dx * dx + dz * dz);
```

### 9. Blood Effect Spawning on Attack
**File:** `public/systems/EffectManager.js:301`

When bear attacks, spawns particle effects. Less frequent but adds overhead.

---

## Summary Table

| Cause | File:Line | Frequency | Severity |
|-------|-----------|-----------|----------|
| ~~Combat target finding~~ | PlayerCombat.js:275+ | ~~Every frame~~ 1/sec | FIXED |
| Skeletal animation mixer | BrownBearManager.js:60-139 | Every frame per bear | HIGH |
| Cross-controller iteration (no early exit) | BrownBearController.js:320-353 | Every frame | HIGH |
| sqrt in bear movement | BrownBearController.js:420 | Every frame per bear | MEDIUM |
| 3x3 chunk structure scan | BrownBearController.js:619-647 | Every 500ms | MEDIUM |
| Increased target validation | BrownBearController.js:696-705 | Every 5 frames (chase) | MEDIUM |
| Positional roar sounds | BrownBearController.js:803-806 | Every 3s | LOW |

---

## Key Files for Optimization

- `public/player/PlayerCombat.js` - Combat target iteration
- `public/ai/BrownBearController.js` - Bear AI and chase logic
- `public/entity/BrownBearManager.js` - Bear animation/rendering
- `public/entity/AvatarManager.js` - Peer avatar updates

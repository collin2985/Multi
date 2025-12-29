# Artillery Firing System - Implementation Plan

## Overview
This document details the implementation plan for manning and firing artillery pieces. The system allows players to attach to artillery, rotate to aim, and fire shells at targets with visual effects matching the existing combat system.

## Core Mechanics Summary

| Feature | Value | Reference |
|---------|-------|-----------|
| Manning Button | "Man Artillery" | Similar to "Attach Cart" |
| Rotation Speed | 360 degrees in 6 seconds | 1.047 rad/sec |
| Fire Cooldown | 12 seconds | 2x rifle cooldown |
| Range | 28 units | ~2x rifle range |
| Base Accuracy | 35% at max range | Matches rifle |
| Point Blank Accuracy | 100% at 0 units | Matches rifle |
| Height Accuracy Bonus | +15% per unit height | Matches rifle |
| Ammo Source | Artillery inventory (shells) | 4x4 grid, shell-only |

---

## Player Attachment System

### Existing Pattern: Cart Towing (Reference)
**File:** `public/game.js` (lines 2906-2983)
**File:** `public/core/GameState.js` (lines 139-151)

Cart attachment uses:
```javascript
cartAttachmentState = {
    isAttached: false,
    attachedCart: null,
    cartId: null,
    // ... position tracking
}
```

### New: Artillery Manning State
**File:** `public/core/GameState.js`

Add new state object (after artilleryAttachmentState, ~line 179):
```javascript
// Artillery manning state (player standing behind artillery to fire - different from towing)
// Pattern matches cartAttachmentState (lines 139-151)
this.artilleryManningState = {
    isManning: false,              // Whether player is currently manning artillery
    mannedArtillery: null,         // Reference to the artillery THREE.Object3D
    artilleryId: null,             // ID for network sync
    artilleryChunkKey: null,       // Chunk where artillery is located
    artilleryOriginalChunkKey: null,  // Original chunk for claim tracking

    // Rotation state
    artilleryHeading: 0,           // Current rotation in radians

    // Combat state
    lastFireTime: 0,               // Cooldown tracking (Date.now() timestamp)

    // Throttling (matches cart pattern lines 149-150)
    _terrainFrameCount: 0,         // Throttle terrain Y lookups for player position
    _lastBroadcastTime: 0          // Throttle network broadcasts (100ms interval)
};
```

**Note:** `shellCount` is NOT stored in state - read directly from `artillery.userData.inventory` each time to avoid stale data.

### Player Position When Manning
**Reference:** Cart hitch offset is 0.4 units from cart center (config.js line 289: `HITCH_OFFSET: 0.4`)

For artillery:
- Player position: **0.4 units** behind artillery center (closer than cart)
- Player faces same direction as artillery barrel
- Player Y: terrain height at artillery position
- Both rotate around artillery center point

```javascript
// Position calculation (similar to cart puller position)
const MANNING_OFFSET = 0.4;  // Distance behind artillery center
playerX = artillery.position.x - Math.sin(artilleryHeading) * MANNING_OFFSET;
playerZ = artillery.position.z - Math.cos(artilleryHeading) * MANNING_OFFSET;
playerRotation.y = artilleryHeading;
```

---

## Rotation System

### Existing Pattern: Cart Heading (Reference)
**File:** `public/player/PlayerController.js` (lines 602-605, 736-740)

Cart uses `towingHeading` with turn rate:
```javascript
const TURN_RATE = (Math.PI * 2) / 6000;  // Full rotation in 6 seconds
```

### Artillery Rotation Implementation
Same turn rate formula as cart towing - 360 degrees in 6 seconds:
```javascript
// From PlayerController.js line 87 - uses milliseconds since deltaTime is in ms
const ARTILLERY_TURN_RATE = (Math.PI * 2) / 6000;  // radians per millisecond
// Note: Math.PI * 2 / 6000 = 0.001047 rad/ms = ~60 degrees/second
// At 60 FPS (16.67ms per frame): 0.001047 * 16.67 = 0.0175 rad/frame = ~1 degree/frame
```

**Input Handling:**
- A/D keys rotate artillery (A = counterclockwise/left, D = clockwise/right)
- No WASD movement while manning (player locked to artillery)
- No mouse drag - rotation is keyboard-only like cart towing

**Rotation Update (per frame):**
```javascript
// In game loop when manning artillery (similar to PlayerController.js lines 661-668)
if (manningState.isManning) {
    const deltaTime = /* frame time in milliseconds from requestAnimationFrame */;

    if (keys.a) {
        manningState.artilleryHeading += ARTILLERY_TURN_RATE * deltaTime;
    }
    if (keys.d) {
        manningState.artilleryHeading -= ARTILLERY_TURN_RATE * deltaTime;
    }

    // Normalize heading to [-PI, PI] to prevent floating-point drift
    // (Pattern from PlayerController.js lines 639-641)
    while (manningState.artilleryHeading > Math.PI) {
        manningState.artilleryHeading -= Math.PI * 2;
    }
    while (manningState.artilleryHeading < -Math.PI) {
        manningState.artilleryHeading += Math.PI * 2;
    }

    // Update artillery model rotation
    artillery.rotation.y = manningState.artilleryHeading;

    // Update player position to stay behind artillery
    updatePlayerManningPosition();
}
```

---

## Firing System

### Existing Pattern: PlayerCombat Shooting (Reference)
**File:** `public/player/PlayerCombat.js`

Key methods to mirror:
- `updateShooting()` (lines 264-559) - targeting and fire logic
- `calculateHitChance()` (lines 729-751) - accuracy calculation
- `calculateShootingRange()` (lines 692-708) - range with height bonus
- `consumeAmmo()` (lines 134-157) - ammo consumption
- `hasAmmo()` / `getAmmoCount()` (lines 108-128) - ammo checks

### Artillery Firing Implementation

**Fire Conditions:**
1. Player is manning artillery (`isManning === true`)
2. Cooldown elapsed (12 seconds since last fire)
3. Has shells in artillery inventory
4. Target in range (28 units base, no range bonus from height)
5. Not dead

**Accuracy Calculation (adapted from rifle pattern - PlayerCombat.js lines 729-751):**

**Key differences from rifle:**
| Factor | Rifle | Artillery | Reasoning |
|--------|-------|-----------|-----------|
| MAX_HIT_CHANCE | 0.8 (80%) | 0.8 (80%) | Same cap for balance |
| POINT_BLANK_RANGE | 4 units | 8 units | Artillery effective close range |
| Quality bonus | Yes (rifle quality) | No | Shells don't have quality |
| BASE_HIT_CHANCE | 0.35 ± quality | 0.35 fixed | No quality variation |

```javascript
// Adapted from PlayerCombat.calculateHitChance() (lines 729-751)
calculateArtilleryHitChance(shooterY, targetY, distance) {
    // No quality bonus for artillery (shells don't have quality like rifles)
    const BASE_HIT_CHANCE = 0.35;
    const MAX_HIT_CHANCE = 0.8;  // Same 80% cap as rifle (line 733)

    // Height advantage calculation (same as rifle, lines 736-740)
    const heightAdvantage = shooterY - targetY;
    const bonusChance = Math.max(0, heightAdvantage * 0.15);  // +15% per unit height

    // Calculate base hit chance from height (capped at 80%)
    const baseHitChance = Math.min(MAX_HIT_CHANCE, BASE_HIT_CHANCE + bonusChance);

    // Artillery point blank range is larger than rifle (8 vs 4)
    // because cannons are more accurate at medium range
    const POINT_BLANK_RANGE = 8;
    const distanceBonus = Math.max(0, (POINT_BLANK_RANGE - distance) / POINT_BLANK_RANGE);

    // Same formula as rifle (line 748)
    const hitChance = baseHitChance + (1.0 - baseHitChance) * distanceBonus;

    return hitChance;
}
```

**Accuracy Examples:**
- At 28 units (max range), 0 height: 35%
- At 14 units, 0 height: 35% (beyond point-blank range)
- At 8 units, 0 height: 35% (at point-blank edge)
- At 4 units, 0 height: ~58% (halfway to 80%)
- At 0 units, 0 height: 80% (max, same as rifle)
- At 14 units, +3 height advantage: 35% + 45% = 80% (capped)

**Shell Consumption:**
```javascript
consumeShell() {
    const artillery = this.gameState.artilleryManningState.mannedArtillery;
    const inventory = artillery.userData.inventory;

    if (!inventory || !inventory.items || inventory.items.length === 0) {
        return false;
    }

    // Find first shell
    const shellIndex = inventory.items.findIndex(item => item.type === 'shell');
    if (shellIndex === -1) return false;

    const shell = inventory.items[shellIndex];
    shell.quantity = (shell.quantity || 1) - 1;

    if (shell.quantity <= 0) {
        inventory.items.splice(shellIndex, 1);
    }

    // Save inventory change to server
    saveArtilleryInventory();

    return true;
}
```

---

## Visual Effects

### Existing Effects (Reference)
**File:** `public/effects/MuzzleFlash.js` - 110ms flash, sprite-based
**File:** `public/effects/GunSmoke.js` - 2-3 rising particles
**File:** `public/effects/DirtKickup.js` - hit/miss ground effects

### Artillery Effects (New/Modified)

#### 1. Large Muzzle Flash
Reuse `MuzzleFlash.js` with larger scale:
```javascript
// Artillery muzzle flash - 3x larger than rifle
const artilleryFlash = new MuzzleFlash();
artilleryFlash.attachTo(artilleryBarrelTip, { x: 0, y: 0, z: 0.5 });
artilleryFlash.sprite.scale.set(2.1, 2.1, 1);  // 3x rifle (0.7 * 3)
artilleryFlash.flash(150);  // Longer duration (150ms vs 110ms)
```

#### 2. Large Gun Smoke
**Note:** GunSmoke.js constructor only accepts `(scene, position, camera)` - no options object.
All particle parameters are hardcoded (lines 48, 63, 74, 78).

**Solution:** Create factory function similar to DirtKickup pattern (lines 184-208):

**File:** `public/effects/GunSmoke.js` - Add factory function:
```javascript
// Add to end of GunSmoke.js (following DirtKickup pattern)

/**
 * Factory for artillery-sized smoke effect
 * Creates multiple GunSmoke instances for larger visual
 * @param {THREE.Scene} scene
 * @param {{x,y,z}} position - Barrel position
 * @param {THREE.Camera} camera
 * @returns {GunSmoke[]} - Array of smoke instances to update
 */
export function spawnArtillerySmoke(scene, position, camera = null) {
    const smokes = [];

    // Spawn 2 overlapping GunSmoke instances for larger effect
    // (each has 2-3 particles = 4-6 total)
    for (let i = 0; i < 2; i++) {
        const offset = {
            x: position.x + (Math.random() - 0.5) * 0.3,
            y: position.y + (Math.random() - 0.5) * 0.2,
            z: position.z + (Math.random() - 0.5) * 0.3
        };
        smokes.push(new GunSmoke(scene, offset, camera));
    }

    return smokes;
}
```

**Usage in game.js:**
```javascript
import { spawnArtillerySmoke } from './effects/GunSmoke.js';

// On artillery fire
const artillerySmokes = spawnArtillerySmoke(scene, barrelPosition, camera);

// In game loop - update all smoke instances
for (let i = artillerySmokes.length - 1; i >= 0; i--) {
    if (!artillerySmokes[i].update(delta)) {
        artillerySmokes.splice(i, 1);  // Remove when done
    }
}
```

#### 3. Impact Plume (NEW)
Create new effect for artillery impact - large black smoke cloud.

**File:** `public/effects/ArtilleryImpact.js` (NEW)

Following DirtKickup.js pattern (lines 1-174) with material pooling for performance:
```javascript
/**
 * ArtilleryImpact.js
 * Large smoke plume for artillery shell impacts
 * Follows DirtKickup pattern with longer duration and more particles
 * Uses material pooling and impact capping for performance
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';

// Cached textures (following DirtKickup lines 9-10 pattern)
const textureCache = new Map();

// Material pool for reuse (performance optimization)
const materialPool = {
    smoke: [],
    hit: []
};

// Active impacts tracking for cap enforcement
const activeImpacts = [];

// Color presets (DirtKickup lines 12-24 pattern)
const COLOR_PRESETS = {
    smoke: {
        center: 'rgba(40, 40, 40, 0.9)',      // Dark grey center
        mid: 'rgba(60, 60, 60, 0.6)',
        edge: 'rgba(80, 80, 80, 0)'
    },
    hit: {
        center: 'rgba(255, 120, 40, 1)',      // Orange/red center for hit flash
        mid: 'rgba(200, 60, 30, 0.7)',
        edge: 'rgba(150, 30, 20, 0)'
    }
};

function createImpactTexture(colorKey = 'smoke') {
    if (textureCache.has(colorKey)) return textureCache.get(colorKey);

    const colors = COLOR_PRESETS[colorKey] || COLOR_PRESETS.smoke;

    const size = 64;  // Larger texture for bigger particles
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    gradient.addColorStop(0, colors.center);
    gradient.addColorStop(0.5, colors.mid);
    gradient.addColorStop(1, colors.edge);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    textureCache.set(colorKey, texture);
    return texture;
}

/**
 * Get or create a material from the pool
 * @param {string} type - 'smoke' or 'hit'
 * @param {number} opacity - Initial opacity
 * @returns {THREE.SpriteMaterial}
 */
function getMaterial(type, opacity) {
    const pool = materialPool[type];
    if (pool.length > 0) {
        const material = pool.pop();
        material.opacity = opacity;
        material.visible = true;
        return material;
    }

    // Create new material if pool is empty
    const texture = createImpactTexture(type);
    return new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: opacity,
        blending: type === 'hit' ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: false
    });
}

/**
 * Return a material to the pool for reuse
 * @param {string} type - 'smoke' or 'hit'
 * @param {THREE.SpriteMaterial} material
 */
function returnMaterial(type, material) {
    material.visible = false;
    materialPool[type].push(material);
}

export class ArtilleryImpact {
    /**
     * Create artillery impact effect
     * @param {THREE.Scene} scene - Scene to add particles to
     * @param {THREE.Vector3|{x,y,z}} position - World position for the effect
     * @param {boolean} isHit - True for hit (adds red flash), false for miss
     */
    constructor(scene, position, isHit = false) {
        this.scene = scene;
        this.particles = [];
        this.materials = [];  // Track materials for pooling
        this.materialTypes = [];  // Track type for each material
        this.disposed = false;

        const particleCount = 8 + Math.floor(Math.random() * 5);  // 8-12 particles

        // Create smoke plume particles
        for (let i = 0; i < particleCount; i++) {
            const opacity = 0.7 + Math.random() * 0.2;
            const material = getMaterial('smoke', opacity);
            this.materials.push(material);
            this.materialTypes.push('smoke');

            const sprite = new THREE.Sprite(material);

            // Larger particles: 0.8-1.5 units (vs 0.25-0.4 for dirt)
            const size = 0.8 + Math.random() * 0.7;
            sprite.scale.set(size, size, 1);

            // Start at impact position with spread
            sprite.position.set(
                position.x + (Math.random() - 0.5) * 1.0,
                position.y + Math.random() * 0.5,
                position.z + (Math.random() - 0.5) * 1.0
            );

            // Upward motion with slight outward drift
            const angle = Math.random() * Math.PI * 2;
            sprite.userData = {
                velocityX: Math.cos(angle) * (0.3 + Math.random() * 0.5),
                velocityY: 1.5 + Math.random() * 1.5,
                velocityZ: Math.sin(angle) * (0.3 + Math.random() * 0.5),
                age: Math.random() * 0.3,
                lifespan: 3.5 + Math.random() * 1.5,
                startOpacity: opacity,
                growthRate: 0.3 + Math.random() * 0.2
            };

            scene.add(sprite);
            this.particles.push(sprite);
        }

        // If hit, add brief orange flash at center
        if (isHit) {
            const flashMaterial = getMaterial('hit', 1.0);
            this.materials.push(flashMaterial);
            this.materialTypes.push('hit');

            const flash = new THREE.Sprite(flashMaterial);
            flash.scale.set(2.0, 2.0, 1);
            flash.position.set(position.x, position.y + 0.3, position.z);
            flash.userData = {
                velocityX: 0, velocityY: 0.5, velocityZ: 0,
                age: 0,
                lifespan: 0.3,
                startOpacity: 1.0,
                growthRate: 3.0
            };

            scene.add(flash);
            this.particles.push(flash);
        }
    }

    /**
     * Update particles - call each frame
     * @param {number} delta - Time since last frame in seconds
     * @returns {boolean} - True if effect is still active, false if done
     */
    update(delta) {
        if (this.disposed) return false;

        let allDone = true;

        for (const particle of this.particles) {
            const data = particle.userData;
            data.age += delta;

            if (data.age < data.lifespan) {
                allDone = false;

                particle.position.x += data.velocityX * delta;
                particle.position.y += data.velocityY * delta;
                particle.position.z += data.velocityZ * delta;

                data.velocityY *= 0.99;
                data.velocityX *= 0.98;
                data.velocityZ *= 0.98;

                const progress = data.age / data.lifespan;
                if (progress > 0.4) {
                    const fadeProgress = (progress - 0.4) / 0.6;
                    particle.material.opacity = data.startOpacity * (1 - fadeProgress);
                }

                const newSize = particle.scale.x + data.growthRate * delta;
                particle.scale.set(newSize, newSize, 1);
            } else {
                particle.visible = false;
            }
        }

        if (allDone) {
            this.dispose();
            return false;
        }

        return true;
    }

    /**
     * Clean up resources - return materials to pool instead of disposing
     */
    dispose() {
        if (this.disposed) return;
        this.disposed = true;

        for (let i = 0; i < this.particles.length; i++) {
            const particle = this.particles[i];
            this.scene.remove(particle);
            // Return material to pool for reuse instead of disposing
            returnMaterial(this.materialTypes[i], this.materials[i]);
        }
        this.particles = [];
        this.materials = [];
        this.materialTypes = [];

        // Remove from active impacts
        const idx = activeImpacts.indexOf(this);
        if (idx !== -1) activeImpacts.splice(idx, 1);
    }
}

/**
 * Factory helper with impact cap enforcement
 * Caps simultaneous impacts to prevent performance issues
 */
export function spawnArtilleryImpact(scene, position, isHit) {
    const maxImpacts = CONFIG.ARTILLERY_COMBAT?.MAX_SIMULTANEOUS_IMPACTS || 5;

    // If at cap, dispose oldest impact
    while (activeImpacts.length >= maxImpacts) {
        activeImpacts[0].dispose();
    }

    const impact = new ArtilleryImpact(scene, position, isHit);
    activeImpacts.push(impact);
    return impact;
}

/**
 * Update all active impacts - call from game loop
 * @param {number} delta - Time since last frame in seconds
 */
export function updateAllImpacts(delta) {
    for (let i = activeImpacts.length - 1; i >= 0; i--) {
        if (!activeImpacts[i].update(delta)) {
            // Already removed in dispose()
        }
    }
}
```

**Effect spawning:**
```javascript
// On artillery fire
if (didHit) {
    // Hit effect - red dirt kickup + black plume
    DirtKickup.spawnHitEffect(scene, targetPosition, artilleryPosition);
    new ArtilleryImpact(scene, targetPosition, true);
} else {
    // Miss effect - grey dirt kickup + black plume
    DirtKickup.spawnMissEffect(scene, targetPosition, artilleryPosition);
    new ArtilleryImpact(scene, targetPosition, false);
}
```

---

## Combat HUD Integration

### Existing HUD (Reference)
**File:** `public/ui/CombatHUD.js`

Displays:
- Target type label
- Accuracy percentage
- Range + "IN RANGE" / "TOO FAR"
- Ammo count
- Warnings (NO RIFLE, NO AMMO)

### Artillery HUD Modifications

**Actual CombatHUD properties (lines 12-17):**
- `this.warningEl` - Top warning text (normally "ENEMIES NEARBY")
- `this.accuracyEl` - Accuracy percentage display
- `this.rangeEl` - Combined range + status (e.g., "15m IN RANGE")
- `this.ammoEl` - Ammo/shell count
- `this.noAmmoWarning` - "NO AMMO" warning element
- `this.noRifleWarning` - "NO RIFLE" warning element

When manning artillery, HUD shows:
- **Warning:** "MANNING ARTILLERY" instead of "ENEMIES NEARBY"
- **Accuracy:** Calculated hit chance percentage
- **Range:** Distance to target + status (combined in rangeEl, lines 282-290)
- **Ammo:** Shell count from artillery inventory
- **Cooldown:** Time until can fire again (optional - could add new element)

```javascript
// In CombatHUD.update() - add artillery mode check
// Follow existing pattern from lines 268-312
if (isManningArtillery) {
    // Update warning label for artillery mode
    this.warningEl.textContent = 'MANNING ARTILLERY';
    this.warningEl.style.color = '#FFB74D';  // Orange for artillery

    // Accuracy display (same pattern as lines 268-279)
    const accuracyPercent = Math.round(hitChance * 100);
    this.accuracyEl.textContent = `${accuracyPercent}%`;
    // Color coding matches existing pattern
    if (accuracyPercent >= 60) {
        this.accuracyEl.style.color = '#7CB342';
    } else if (accuracyPercent >= 40) {
        this.accuracyEl.style.color = '#FFB74D';
    } else {
        this.accuracyEl.style.color = '#E8DCC4';
    }

    // Range display - combined value + status (lines 281-290 pattern)
    const inRange = distance <= 28;  // Artillery range
    const distText = Math.round(distance) + 'm';
    if (inRange) {
        this.rangeEl.textContent = `${distText} IN RANGE`;
        this.rangeEl.style.color = '#7CB342';
    } else {
        this.rangeEl.textContent = `${distText} TOO FAR`;
        this.rangeEl.style.color = '#EF5350';
    }

    // Ammo display (lines 292-305 pattern)
    this.ammoEl.textContent = shellCount.toString();
    if (shellCount <= 0) {
        this.ammoEl.style.color = '#EF5350';
        this.noAmmoWarning.textContent = 'NO SHELLS';  // Reuse noAmmoWarning
        this.noAmmoWarning.style.display = 'block';
    } else if (shellCount <= 3) {
        this.ammoEl.style.color = '#FFB74D';
        this.noAmmoWarning.style.display = 'none';
    } else {
        this.ammoEl.style.color = '#E8DCC4';
        this.noAmmoWarning.style.display = 'none';
    }

    // Hide rifle warning when manning artillery
    this.noRifleWarning.style.display = 'none';
}
```

---

## Rifle Restriction While Manning

### Existing Pattern: Mounted Combat Restriction
**File:** `public/player/PlayerCombat.js` (lines 568-574)

When mounted on horse:
```javascript
if (this.gameState.mobileEntityState.isActive) {
    this.inCombatStance = false;
    this.showCombatAnimation = false;
    this.shootTarget = null;
    return;
}
```

### Artillery Manning Restriction
Add similar check:
```javascript
// In PlayerCombat.updateShooting()
if (this.gameState.artilleryManningState?.isManning) {
    // Disable rifle combat while manning artillery
    this.inCombatStance = false;
    this.showCombatAnimation = false;
    this.shootTarget = null;
    return;
}
```

**Rifle visibility:**
```javascript
// In game.js rifle visibility section
if (this.gameState.artilleryManningState?.isManning) {
    // Hide rifle while manning artillery
    this.rifleAttachment.visible = false;
}
```

---

## UI Button Implementation

### Existing Pattern: Attach Cart Button
**File:** `public/ui.js` (lines 1162-1203)

```javascript
// Cart attach button visibility
const isValidCart = nearestTowableEntity?.type === 'cart';
if (isValidCart && !isMoving && !isAttached) {
    attachCartBtn.style.display = 'inline-block';
}
```

### Man Artillery Button

**Step 1: Add HTML button (public/client.html, after line 399):**
```html
<!-- After attachCartBtn/releaseCartBtn buttons -->
<button id="manArtilleryBtn" style="display: none;">Man Artillery</button>
<button id="leaveArtilleryBtn" style="display: none;">Leave Artillery</button>
```

**Step 2: Add to domCache (public/ui.js, after line 104):**
```javascript
// Artillery manning buttons (add after cart buttons)
domCache.manArtilleryBtn = document.getElementById('manArtilleryBtn');
domCache.leaveArtilleryBtn = document.getElementById('leaveArtilleryBtn');
```

**Step 3: Add button event handlers (public/ui.js, after line 1874):**
```javascript
// Artillery manning buttons (following cart button pattern lines 1864-1874)
setupButton(document.getElementById('manArtilleryBtn'), () => {
    if (callbacks.onManArtillery) {
        callbacks.onManArtillery();
    }
});

setupButton(document.getElementById('leaveArtilleryBtn'), () => {
    if (callbacks.onLeaveArtillery) {
        callbacks.onLeaveArtillery();
    }
});
```

**Step 4: Add to updateButtonStates() (public/ui.js):**
```javascript
// In updateButtonStates() - artillery manning buttons
const manArtilleryBtn = domCache.manArtilleryBtn;
const leaveArtilleryBtn = domCache.leaveArtilleryBtn;
const isManningArtillery = artilleryManningState?.isManning;

if (manArtilleryBtn && leaveArtilleryBtn) {
    // Check if near an artillery structure (not attached/towed artillery)
    const nearArtillery = nearestStructure?.userData?.modelType === 'artillery';
    // Can only man if: near artillery, not moving, not already manning, not mounted
    const canMan = nearArtillery && !isMoving && !isManningArtillery && !isMounted && !isCartAttached;

    if (canMan) {
        manArtilleryBtn.style.display = 'inline-block';
        leaveArtilleryBtn.style.display = 'none';
    } else if (isManningArtillery) {
        manArtilleryBtn.style.display = 'none';
        leaveArtilleryBtn.style.display = 'inline-block';
    } else {
        manArtilleryBtn.style.display = 'none';
        leaveArtilleryBtn.style.display = 'none';
    }
}
```

**Step 5: Register callbacks in game.js (with other button callbacks):**
```javascript
// In setupUI() or similar, add callbacks object entries
callbacks.onManArtillery = () => this.handleManArtillery();
callbacks.onLeaveArtillery = () => this.handleLeaveArtillery();
```

---

## Edge Cases & Input Handling

### Occupancy Check (Prevent Multiple Players Manning Same Artillery)

**File:** `public/game.js` - In `handleManArtillery()`:
```javascript
handleManArtillery() {
    const artillery = this.nearestStructure;
    if (!artillery || artillery.userData?.modelType !== 'artillery') return;

    // Check if artillery is already manned by another player (via P2P data)
    const artilleryId = artillery.userData?.id;
    for (const [peerId, peerData] of this.networkManager.peerGameData.entries()) {
        if (peerData.mannedArtillery?.artilleryId === artilleryId) {
            // Artillery already manned by peer - show warning
            this.toastManager?.showToast('Artillery already in use', 'warning');
            return;
        }
    }

    // Proceed with manning...
    const manningState = this.gameState.artilleryManningState;
    manningState.isManning = true;
    manningState.mannedArtillery = artillery;
    manningState.artilleryId = artilleryId;
    // ... rest of setup
}
```

### Window Blur Handler (Prevent Stuck Input)

**File:** `public/game.js` - Add in initialization:
```javascript
// Handle window blur to prevent stuck rotation when tabbing out
window.addEventListener('blur', () => {
    // Clear any held rotation keys when window loses focus
    if (this.inputManager) {
        this.inputManager.keys.a = false;
        this.inputManager.keys.d = false;
    }
});
```

### Movement Key Handling While Manning

**File:** `public/player/PlayerController.js` - In movement update:
```javascript
// At start of movement update, check if manning artillery
if (this.gameState.artilleryManningState?.isManning) {
    // Player is locked to artillery position - skip normal movement
    // Only A/D keys work for rotation (handled separately in artillery update)
    return;
}
```

### Fire Key Input

**File:** `public/core/InputManager.js` - Add fire key tracking:
```javascript
// In key tracking object, add:
this.keys.f = false;  // Artillery fire key

// In keydown handler:
case 'KeyF':
    this.keys.f = true;
    break;

// In keyup handler:
case 'KeyF':
    this.keys.f = false;
    break;
```

**File:** `public/game.js` - Fire input handling:
```javascript
// In game loop, check fire key when manning
if (manningState.isManning && this.inputManager.keys.f) {
    this.inputManager.keys.f = false;  // Consume input
    this.tryFireArtillery();
}
```

---

## Cooldown HUD Element

### Add Cooldown Display to CombatHUD

**File:** `public/ui/CombatHUD.js` - Add cooldown element:

**In constructor (after line 17):**
```javascript
// Cooldown display for artillery
this.cooldownEl = null;
this.cooldownBarEl = null;
```

**In createHUD() method:**
```javascript
// Add cooldown bar container (after ammo display)
const cooldownContainer = document.createElement('div');
cooldownContainer.style.cssText = `
    display: none;
    margin-top: 8px;
    text-align: center;
`;

this.cooldownEl = document.createElement('div');
this.cooldownEl.style.cssText = `
    font-size: 12px;
    color: #E8DCC4;
    margin-bottom: 4px;
`;
this.cooldownEl.textContent = 'READY';

this.cooldownBarEl = document.createElement('div');
this.cooldownBarEl.style.cssText = `
    width: 100px;
    height: 6px;
    background: rgba(0,0,0,0.5);
    border-radius: 3px;
    overflow: hidden;
    margin: 0 auto;
`;

const cooldownFill = document.createElement('div');
cooldownFill.style.cssText = `
    width: 100%;
    height: 100%;
    background: #7CB342;
    transition: width 0.1s linear;
`;
this.cooldownBarEl.appendChild(cooldownFill);
this.cooldownFillEl = cooldownFill;

cooldownContainer.appendChild(this.cooldownEl);
cooldownContainer.appendChild(this.cooldownBarEl);
this.cooldownContainer = cooldownContainer;
this.container.appendChild(cooldownContainer);
```

**In update() method (in artillery mode section):**
```javascript
// Update cooldown display
const now = Date.now();
const lastFireTime = manningState.lastFireTime || 0;
const cooldownMs = CONFIG.ARTILLERY_COMBAT.FIRE_COOLDOWN;
const elapsed = now - lastFireTime;
const remaining = Math.max(0, cooldownMs - elapsed);

this.cooldownContainer.style.display = 'block';

if (remaining > 0) {
    const seconds = Math.ceil(remaining / 1000);
    this.cooldownEl.textContent = `RELOAD ${seconds}s`;
    this.cooldownEl.style.color = '#FFB74D';
    this.cooldownFillEl.style.width = `${(elapsed / cooldownMs) * 100}%`;
    this.cooldownFillEl.style.background = '#FFB74D';
} else {
    this.cooldownEl.textContent = 'READY';
    this.cooldownEl.style.color = '#7CB342';
    this.cooldownFillEl.style.width = '100%';
    this.cooldownFillEl.style.background = '#7CB342';
}
```

---

## Sound Effects

### Artillery Fire Sound

**File:** `public/audio.js` - Add to sound loading:
```javascript
// In loadSounds() method, add:
this.sounds.artillery = await this.loadSound('sounds/artillery.mp3');

// In loadSound() mapping or similar
```

**File:** `public/game.js` - Play sound on fire:
```javascript
// In tryFireArtillery() after successful fire
if (this.audioManager?.sounds?.artillery) {
    const barrelPos = this.getArtilleryBarrelPosition();
    this.audioManager.playPositionalSound('artillery', barrelPos, 1.0);
}
```

---

## P2P Network Synchronization

### Existing Pattern: Cart Position Broadcast
**File:** `public/game.js` (lines 1918-1930)

```javascript
this.networkManager.broadcastP2P({
    type: 'cart_position',
    payload: {
        cartId: cartState.cartId,
        position: cart.position.toArray(),
        rotation: cart.rotation.y
    }
});
```

### Artillery Manning Broadcasts

**New message types:**
1. `artillery_manned` - Player starts manning
2. `artillery_unmanned` - Player stops manning
3. `artillery_aim` - Artillery rotation update
4. `artillery_fire` - Artillery fires (with hit/miss result)

```javascript
// When player mans artillery
this.networkManager.broadcastP2P({
    type: 'artillery_manned',
    payload: {
        artilleryId: artilleryState.artilleryId,
        position: artillery.position.toArray()
    }
});

// When artillery rotates (throttled)
this.networkManager.broadcastP2P({
    type: 'artillery_aim',
    payload: {
        artilleryId: artilleryState.artilleryId,
        rotation: artillery.rotation.y
    }
});

// When artillery fires
this.networkManager.broadcastP2P({
    type: 'artillery_fire',
    payload: {
        artilleryId: artilleryState.artilleryId,
        targetPosition: target.position.toArray(),
        didHit: hitRoll < hitChance,
        targetType: target.type,
        targetId: target.id
    }
});
```

### GameStateManager Handlers
**File:** `public/network/GameStateManager.js`

Add handlers:
```javascript
case 'artillery_manned':
    this.handleArtilleryManned(message.payload, fromPeer, peerData);
    break;
case 'artillery_unmanned':
    this.handleArtilleryUnmanned(message.payload, fromPeer, peerData);
    break;
case 'artillery_aim':
    this.handleArtilleryAim(message.payload, fromPeer, peerData);
    break;
case 'artillery_fire':
    this.handleArtilleryFire(message.payload, fromPeer, peerData);
    break;
```

### Network Edge Cases

Following patterns from NetworkManager.js (lines 193-266, 353-430):

#### 1. Late Joiner Sync (onDataChannelOpen pattern, lines 241-263)

When a new peer connects, send current artillery manning state:

**File:** `public/network/NetworkManager.js` - Add after deer_sync block (~line 263):
```javascript
// Send artillery manning state to newly connected peer
// (Following bandit_sync pattern, lines 241-251)
if (this.game?.gameState?.artilleryManningState?.isManning) {
    const manningState = this.game.gameState.artilleryManningState;
    const artilleryManningSyncMessage = {
        type: 'artillery_manning_sync',
        payload: {
            artilleryId: manningState.artilleryId,
            artilleryChunkKey: manningState.artilleryChunkKey,
            artilleryHeading: manningState.artilleryHeading,
            position: manningState.mannedArtillery?.position?.toArray()
        }
    };
    this.p2pTransport.sendToPeer(peerId, artilleryManningSyncMessage);
}
```

**Handler in GameStateManager.js:**
```javascript
case 'artillery_manning_sync':
    this.handleArtilleryManningSync(message.payload, fromPeer, peerData);
    break;

// Handler implementation
handleArtilleryManningSync(payload, fromPeer, peerData) {
    // Store peer's manning state for visual representation
    peerData.mannedArtillery = {
        artilleryId: payload.artilleryId,
        chunkKey: payload.artilleryChunkKey,
        heading: payload.artilleryHeading,
        position: payload.position
    };
    // Update artillery visual to show it's manned by peer
    // (hide static artillery, show peer-controlled version if needed)
}
```

#### 2. Peer Disconnect Cleanup (cleanupPeer pattern, lines 353-430)

**File:** `public/network/NetworkManager.js` - Add to cleanupPeer() after crate cleanup (~line 430):
```javascript
// Clear artillery manning state when peer disconnects
// (Following cart cleanup pattern, lines 395-413)
if (peerData?.mannedArtillery) {
    const artilleryId = peerData.mannedArtillery.artilleryId;
    // Clear manning visual state
    if (this.game?.structureManager) {
        // Re-show static artillery that was hidden when peer manned it
        this.game.structureManager.clearArtilleryManning(artilleryId);
    }
    peerData.mannedArtillery = null;
}
```

#### 3. Broadcast Throttling (lines 149-150 in cartAttachmentState)

Rotation broadcasts should be throttled to avoid network spam:
```javascript
// In game loop during artillery manning
const now = Date.now();
const AIM_BROADCAST_INTERVAL = 100;  // 100ms = 10 updates/second

if (now - manningState._lastBroadcastTime > AIM_BROADCAST_INTERVAL) {
    this.networkManager.broadcastP2P({
        type: 'artillery_aim',
        payload: {
            artilleryId: manningState.artilleryId,
            rotation: manningState.artilleryHeading
        }
    });
    manningState._lastBroadcastTime = now;
}
```

#### 4. Stale Aim State Timeout

If no aim update received for 500ms, stop applying rotation updates:
```javascript
// In GameStateManager.handleArtilleryAim()
handleArtilleryAim(payload, fromPeer, peerData) {
    peerData.mannedArtillery = peerData.mannedArtillery || {};
    peerData.mannedArtillery.heading = payload.rotation;
    peerData.mannedArtillery.lastAimUpdate = Date.now();
}

// In game loop when updating peer artillery visuals
const peerArtillery = peerData.mannedArtillery;
if (peerArtillery && peerArtillery.lastAimUpdate) {
    const staleThreshold = 500;  // 500ms
    if (Date.now() - peerArtillery.lastAimUpdate < staleThreshold) {
        // Apply rotation update
        artilleryMesh.rotation.y = peerArtillery.heading;
    }
    // If stale, keep last known rotation (don't reset)
}
```

#### 5. peerGameData Initialization (lines 198-215)

**File:** `public/network/NetworkManager.js` - Add to peerGameData init:
```javascript
// Add to peerGameData initialization (after line 214)
mannedArtillery: null,  // { artilleryId, chunkKey, heading, lastAimUpdate }
```

---

## Rotation Persistence

**Problem:** Artillery rotation is only stored in client-side `artilleryManningState.artilleryHeading`.
When player leaves, rotation changes would be lost. New players would see artillery at original rotation.

**Solution:** Save rotation to server when unmanning (death or intentional).

### Server Handler

**File:** `server/MessageHandlers.js` - Add new handler:
```javascript
async handleUpdateArtilleryRotation(ws, payload) {
    try {
        const { artilleryId, chunkKey, rotation } = payload;
        const fullChunkId = `chunk_${chunkKey}`;

        // Find and update artillery in chunk data
        const chunkData = await this.chunkManager.getChunk(fullChunkId);
        if (!chunkData || !chunkData.objectChanges) {
            console.warn(`[UpdateArtilleryRotation] Chunk ${fullChunkId} not found`);
            return;
        }

        const artilleryIndex = chunkData.objectChanges.findIndex(
            obj => obj.id === artilleryId && obj.name === 'artillery'
        );

        if (artilleryIndex === -1) {
            console.warn(`[UpdateArtilleryRotation] Artillery ${artilleryId} not found in chunk`);
            return;
        }

        // Update rotation (convert radians to degrees for storage consistency)
        const rotationDegrees = (rotation * 180 / Math.PI) % 360;
        chunkData.objectChanges[artilleryIndex].rotation = rotationDegrees;

        // Save chunk
        await this.chunkManager.saveChunk(fullChunkId, chunkData);

        console.log(`[UpdateArtilleryRotation] Saved rotation ${rotationDegrees}° for artillery ${artilleryId}`);
    } catch (error) {
        console.error('[UpdateArtilleryRotation] Error:', error);
    }
}
```

**File:** `server.js` - Add to message switch statement (around line 200):
```javascript
case 'update_artillery_rotation':
    await messageHandlers.handleUpdateArtilleryRotation(ws, payload);
    break;
```

### Client-Side: Save on Unman

**File:** `public/game.js` - In `handleLeaveArtillery()`:
```javascript
handleLeaveArtillery() {
    const manningState = this.gameState.artilleryManningState;
    if (!manningState.isManning) return;

    const artillery = manningState.mannedArtillery;

    // Save rotation to server BEFORE clearing state
    if (artillery) {
        this.networkManager.sendMessage('update_artillery_rotation', {
            artilleryId: manningState.artilleryId,
            chunkKey: manningState.artilleryChunkKey,
            rotation: artillery.rotation.y
        });
    }

    // Broadcast unman to peers (include rotation)
    this.networkManager.broadcastP2P({
        type: 'artillery_unmanned',
        payload: {
            artilleryId: manningState.artilleryId,
            position: artillery?.position?.toArray() || [0, 0, 0],
            rotation: artillery?.rotation?.y || 0
        }
    });

    // Clear state...
}
```

### Peer Handler: Apply Rotation on Unman

**File:** `public/network/GameStateManager.js`:
```javascript
handleArtilleryUnmanned(payload, fromPeer, peerData) {
    // Clear peer's manning state
    peerData.mannedArtillery = null;

    // Update static artillery rotation to match final rotation
    const artilleryId = payload.artilleryId;
    const finalRotation = payload.rotation || 0;

    // Find the static artillery mesh and update its rotation
    if (this.game?.structureManager) {
        const artillery = this.game.structureManager.findStructure(artilleryId);
        if (artillery) {
            artillery.rotation.y = finalRotation;
        }
    }
}
```

---

## Combat Scenarios

### Scenario 1: Player Dies While Manning
**Reference:** `public/systems/DeathManager.js` (lines 32-143)

Following mobile entity death pattern (lines 34-108):

**File:** `public/systems/DeathManager.js` - Add after mobile entity handling (~line 109):
```javascript
// SPECIAL CASE: If local player is manning artillery, force unman
// (Following mobileEntityState pattern, lines 34-108)
if (!isAI && !isPeer && this.gameState.artilleryManningState?.isManning) {
    const manningState = this.gameState.artilleryManningState;
    const artilleryId = manningState.artilleryId;
    const artillery = manningState.mannedArtillery;

    // IMPORTANT: Save rotation to server BEFORE broadcasting unman
    // Otherwise rotation changes are lost when player leaves
    if (artillery) {
        this.networkManager.sendMessage('update_artillery_rotation', {
            artilleryId: artilleryId,
            chunkKey: manningState.artilleryChunkKey,
            rotation: artillery.rotation.y  // Current rotation in radians
        });
    }

    // Broadcast that we're leaving artillery
    this.networkManager.broadcastP2P({
        type: 'artillery_unmanned',
        payload: {
            artilleryId: artilleryId,
            position: artillery?.position?.toArray() || [0, 0, 0],
            rotation: artillery?.rotation?.y || 0  // Include final rotation for peers
        }
    });

    // Move player to ground level at artillery position BEFORE clearing state
    // (Following pattern from lines 110-121)
    if (artillery && this.game.terrainGenerator) {
        const groundY = this.game.terrainGenerator.getWorldHeight(
            artillery.position.x,
            artillery.position.z
        );
        this.game.playerObject.position.set(
            artillery.position.x,
            groundY + 0.03,  // Slight offset to avoid clipping
            artillery.position.z
        );
    }

    // Clear manning state (similar to mobileEntityState clearing, line 123-136)
    manningState.isManning = false;
    manningState.mannedArtillery = null;
    manningState.artilleryId = null;
    manningState.artilleryChunkKey = null;
    manningState.artilleryOriginalChunkKey = null;
    manningState.artilleryHeading = 0;
    manningState.lastFireTime = 0;
    manningState._terrainFrameCount = 0;
    manningState._lastBroadcastTime = 0;

    // Note: Artillery stays in place (unlike boats which sink)
    // Artillery becomes available for other players to man
    console.log(`[Death] Player died while manning artillery ${artilleryId}`);
}
```

### Scenario 2: Target Dies During Aim
Same as rifle - target check happens each frame, dead targets excluded.

### Scenario 3: Artillery Destroyed While Manning

**Detection:** Check in game loop if manned artillery was removed from scene:
```javascript
// In game loop, check if manned artillery still exists
if (manningState.isManning && manningState.mannedArtillery) {
    // Check if artillery was removed from scene (destroyed/decayed)
    if (!manningState.mannedArtillery.parent) {
        // Artillery was removed from scene - force unman
        handleUnmanArtillery();

        // Show toast notification (using existing toast system)
        if (this.game?.toastManager) {
            this.game.toastManager.showToast('Artillery destroyed', 'warning');
        }
    }
}
```

**Alternative: Server notification**
If artillery is destroyed via server decay system:
```javascript
// In handleServerMessage for structure_removed or artillery_destroyed
case 'structure_removed':
    if (payload.type === 'artillery' &&
        this.gameState.artilleryManningState?.artilleryId === payload.id) {
        // Force unman - our artillery was destroyed
        this.handleUnmanArtillery();
        this.toastManager?.showToast('Artillery destroyed', 'warning');
    }
    break;
```

### Scenario 4: Player Moves Away (Invalid State)
Should not be possible - movement locked while manning. Safety check:
```javascript
if (distanceFromArtillery > 2.0) {
    // Force unman - invalid state
    handleUnmanArtillery();
}
```

### Scenario 5: No Shells Left
- Fire button disabled
- HUD shows "NO SHELLS" warning
- Sound effect: click/empty (optional)

---

## Configuration Constants

**File:** `public/config.js`

Add new section:
```javascript
ARTILLERY_COMBAT: {
    // Positioning
    MANNING_OFFSET: 0.4,           // Distance behind artillery center
    BARREL_OFFSET: { x: 0, y: 0.6, z: 1.2 },  // Offset from artillery center to barrel tip

    // Rotation (matches PlayerController.js line 87)
    TURN_RATE: (Math.PI * 2) / 6000,  // Radians per millisecond (360° in 6s)

    // Firing
    FIRE_COOLDOWN: 12000,          // 12 seconds between shots
    RANGE: 28,                     // Maximum range in units
    FIRE_KEY: 'f',                 // Key to fire (F key)

    // Accuracy (matches rifle pattern from PlayerCombat.js lines 729-751)
    BASE_HIT_CHANCE: 0.35,         // 35% at max range (same as rifle)
    MAX_HIT_CHANCE: 0.8,           // 80% cap (same as rifle line 733)
    POINT_BLANK_RANGE: 8,          // Distance bonus range (rifle uses 4)
    HEIGHT_BONUS: 0.15,            // +15% per unit height advantage (same as rifle)

    // Effects
    MUZZLE_FLASH_SCALE: 2.1,       // 3x rifle flash
    MUZZLE_FLASH_DURATION: 150,    // ms
    SMOKE_PARTICLE_COUNT: 6,
    IMPACT_PLUME_DURATION: 4000,   // ms
    MAX_SIMULTANEOUS_IMPACTS: 5,   // Cap for performance

    // Network
    AIM_BROADCAST_INTERVAL: 150,   // ms between rotation broadcasts (matches cart)

    // Sound
    SOUND_FILE: 'artillery.mp3',   // Sound file in public/sounds/
}
```

**File:** `server/ServerConfig.js`

Add `shell` to market items and `artillery` to quality caps:
```javascript
// In MARKET.ALL_ITEMS array, add after 'ammo':
'rifle', 'ammo', 'shell'

// In CONSTRUCTION.STRUCTURE_QUALITY_CAPS, add:
artillery: 15,      // Max quality 15 = ~48.6 hours lifespan (2 days)
```

---

## Implementation Order

### Phase 1: Core Mechanics
1. Add `artilleryManningState` to GameState.js
2. Add "Man Artillery" / "Leave Artillery" button to ui.js
3. Implement `handleManArtillery()` with occupancy check in game.js
4. Implement `handleUnmanArtillery()` in game.js
5. Implement rotation system (A/D keys rotate artillery + player)
6. Lock player movement while manning (PlayerController.js)
7. Add F key tracking to InputManager.js

### Phase 2: Firing System
8. Implement artillery targeting (reuse PlayerCombat patterns)
9. Implement `calculateArtilleryHitChance()`
10. Implement shell consumption from artillery inventory
11. Add fire cooldown tracking
12. Implement fire action (F key)

### Phase 3: Visual Effects
13. Create `ArtilleryImpact.js` effect class with material pooling
14. Modify MuzzleFlash usage for larger artillery flash
15. Add `spawnArtillerySmoke()` factory to GunSmoke.js
16. Add artillery firing sound to audio.js

### Phase 4: HUD Integration
17. Modify CombatHUD for artillery mode
18. Add cooldown bar with timer display
19. Show shell count, accuracy, range
20. Add "NO SHELLS" warning

### Phase 5: Combat Restrictions
21. Disable rifle combat while manning
22. Hide rifle model while manning
23. Handle death while manning (DeathManager.js)
24. Handle artillery destruction while manning

### Phase 6: Edge Cases
25. Add window blur handler to prevent stuck input
26. Add artillery destroyed while manning detection
27. Add server rotation persistence (handleUpdateArtilleryRotation)

### Phase 7: Multiplayer
28. Add P2P message types for artillery combat
29. Implement GameStateManager handlers
30. Sync artillery rotation to peers (150ms throttle)
31. Sync fire events with effects to peers
32. Add late joiner artillery state sync
33. Add peer disconnect cleanup

### Phase 8: Server Config
34. Add `shell` to ServerConfig.js ALL_ITEMS
35. Add `artillery` to STRUCTURE_QUALITY_CAPS
36. Add route in server.js for rotation persistence

### Phase 9: Documentation & Polish
37. Update GAME_CONTEXT.md with artillery system docs
38. Update CODEFILE_GUIDE.md with new file entries
39. Balance testing and tuning

---

## Files to Modify

| File | Changes |
|------|---------|
| `public/core/GameState.js` | Add `artilleryManningState` |
| `public/core/InputManager.js` | Add F key tracking for fire input |
| `public/game.js` | Manning handlers, rotation update, fire logic, blur handler |
| `public/ui.js` | "Man Artillery" button, domCache, event handlers |
| `public/client.html` | Add manArtilleryBtn and leaveArtilleryBtn buttons |
| `public/ui/CombatHUD.js` | Artillery mode display, cooldown bar |
| `public/player/PlayerController.js` | Skip movement when manning artillery |
| `public/player/PlayerCombat.js` | Disable rifle while manning |
| `public/config.js` | Add `ARTILLERY_COMBAT` constants |
| `public/network/GameStateManager.js` | P2P handlers for manning/aim/fire |
| `public/network/NetworkManager.js` | Late joiner sync, peer disconnect cleanup, peerGameData init |
| `public/systems/DeathManager.js` | Handle death while manning |
| `public/effects/ArtilleryImpact.js` | NEW - impact plume effect with material pooling |
| `public/effects/GunSmoke.js` | Add `spawnArtillerySmoke()` factory function |
| `public/audio.js` | Add artillery sound loading and playback |
| `server/MessageHandlers.js` | Add `handleUpdateArtilleryRotation()` |
| `server/ServerConfig.js` | Add `shell` to ALL_ITEMS, add `artillery` to STRUCTURE_QUALITY_CAPS |
| `server.js` | Add route for `update_artillery_rotation` |
| `GAME_CONTEXT.md` | Document artillery system architecture |
| `CODEFILE_GUIDE.md` | Add ArtilleryImpact.js entry, update Quick Reference |

---

## Code Reuse Summary

| Existing Code | Reuse For |
|---------------|-----------|
| `PlayerCombat.calculateHitChance()` | Artillery accuracy formula |
| `PlayerCombat.consumeAmmo()` | Shell consumption pattern |
| `PlayerCombat.hasAmmo()` / `getAmmoCount()` | Shell count checking |
| `MuzzleFlash.js` | Larger muzzle flash |
| `GunSmoke.js` | Larger gun smoke |
| `DirtKickup.js` | Hit/miss ground effects |
| `CombatHUD.js` | Artillery HUD display |
| Cart attachment state pattern | Manning state structure |
| Cart rotation system | Artillery rotation input |
| Horse mounted restriction | Rifle disabled while manning |

---

## Open Questions for Review

1. ~~**Fire input:** Click to fire, or dedicated key (F)?~~ **RESOLVED: F key to fire**
2. **Auto-aim assist:** Snap to nearest target, or pure manual aim?
3. **Friendly fire:** Can artillery hit friendly faction?
4. **Structure damage:** Can artillery damage structures?
5. **Screen shake:** Add camera shake on fire?
6. ~~**Reload animation:** Visual feedback while on cooldown?~~ **RESOLVED: Cooldown bar with timer in HUD**

---

## Documentation Updates (Required by CLAUDE.md)

### GAME_CONTEXT.md Updates

Add to "Game Systems" section (after Combat):
```markdown
### Artillery System
- Artillery pieces can be manned by players for firing at targets
- Distinct from towing: `artilleryManningState` (firing) vs `artilleryAttachmentState` (towing)
- Player stands behind artillery, uses A/D to rotate, F to fire
- 12-second fire cooldown, 28-unit range, accuracy similar to rifle
- Shells consumed from artillery's 4x4 inventory
- P2P sync for multiplayer: manning, rotation, firing events
```

Add to "Networking" section under P2P Messages:
```markdown
**Artillery:**
- `artillery_manned` - Player starts manning
- `artillery_unmanned` - Player stops manning
- `artillery_aim` - Rotation updates (150ms throttle)
- `artillery_fire` - Fire event with hit/miss
- `artillery_manning_sync` - Late joiner state sync
```

### CODEFILE_GUIDE.md Updates

Add to Quick Reference table:
```markdown
| **Artillery System** | `public/effects/ArtilleryImpact.js`, `public/game.js` (handleManArtillery), `public/ui/CombatHUD.js` |
```

Add to "Client: Effects" section:
```markdown
### ArtilleryImpact.js (~200 lines)
Large smoke plume for artillery shell impacts with material pooling.
- **Exports:** `ArtilleryImpact`, `spawnArtilleryImpact`, `updateAllImpacts`
- **Interacts with:** `config.js` (MAX_SIMULTANEOUS_IMPACTS), Three.js
```

Update GunSmoke.js entry to note:
```markdown
- **Exports:** `GunSmoke`, `spawnArtillerySmoke` (factory for larger smoke)
```

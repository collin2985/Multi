
import { SmokeEffect } from '../SmokeEffect.js';
import { SmokeParticleSystem } from './SmokeParticleSystem.js';
import { DirtKickup, spawnMissEffect, spawnHitEffect } from '../effects/DirtKickup.js';
import { GunSmokeParticleSystem } from '../effects/GunSmokeParticleSystem.js';
import * as THREE from 'three';
import { CONFIG } from '../config.js';

/**
 * EffectManager
 * Handles visual effects like smoke, particles, and environmental atmosphere.
 */
export class EffectManager {
    // O(1) lookup for smoke-enabled structure types
    static SMOKE_TYPES = new Set(['campfire', 'house', 'tileworks', 'ironworks', 'blacksmith', 'bakery', 'fisherman']);

    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        this.gameState = game.gameState; // For tick-based calculations
        this.smokeEffects = new Map();
        this.dirtEffects = []; // One-shot dirt/dust effects
        this._lastCheckedTick = -1; // For throttling firewood checks
        this._firewoodCache = new Map(); // objectId -> hasFirewood (cached per tick)
        this.dyingStructures = new Set(); // objectIds with dying structure smoke effect

        // Centralized particle systems (single InstancedMesh each for performance)
        this.smokeParticleSystem = new SmokeParticleSystem(this.scene);
        this.gunSmokeParticleSystem = new GunSmokeParticleSystem(this.scene);
    }

    /**
     * Calculate current firewood durability based on tick elapsed
     * Matches CrateInventoryUI._calculateFirewoodDurability
     * @param {object} item - Firewood item with durability and placedAtTick
     * @returns {number} Current calculated durability
     */
    _calculateFirewoodDurability(item) {
        if (!item.placedAtTick) {
            // No tick stamp = not burning (in regular inventory or legacy data)
            return item.durability;
        }

        const currentTick = this.gameState?.serverTick || 0;
        const ticksElapsed = currentTick - item.placedAtTick;
        const minutesElapsed = ticksElapsed / 60; // 60 ticks per minute
        // Firewood depletes at 2 durability per minute
        const durabilityLost = minutesElapsed * 2;
        const currentDurability = item.durability - durabilityLost;

        return Math.max(0, currentDurability);
    }

    /**
     * Check if inventory has firewood with remaining durability
     * Uses tick-based calculation for burning firewood
     * @param {object} inventory - Structure inventory { items: [...] }
     * @returns {boolean} True if has usable firewood
     */
    _hasFirewood(inventory) {
        if (!inventory || !Array.isArray(inventory.items)) return false;

        return inventory.items.some(item => {
            if (!item.type || !item.type.endsWith('firewood')) return false;
            const currentDurability = this._calculateFirewoodDurability(item);
            return currentDurability > 0;
        });
    }

    /**
     * Update smoke for structure based on firewood. O(1) lookups, early exits.
     * @param {string} structureId - Structure object ID
     * @param {string} modelType - Structure model type
     * @param {object} inventory - Structure inventory { items: [...] }
     */
    updateSmokeForInventory(structureId, modelType, inventory) {
        // O(1) type check - skip non-smoke structures immediately
        if (!EffectManager.SMOKE_TYPES.has(modelType)) return;

        // Tileworks: two smoke effects
        if (modelType === 'tileworks') {
            let smoke1 = this.smokeEffects.get(structureId + '_1');
            let smoke2 = this.smokeEffects.get(structureId + '_2');
            // Recreate if cleaned up
            if (!smoke1 && !smoke2) {
                if (this._hasFirewood(inventory) && this._recreateSmokeIfNeeded(structureId, modelType)) {
                    smoke1 = this.smokeEffects.get(structureId + '_1');
                    smoke2 = this.smokeEffects.get(structureId + '_2');
                }
                if (!smoke1 && !smoke2) return;
            }

            const hasFirewood = this._hasFirewood(inventory);
            // Update cache to prevent update loop from reverting the state
            this._firewoodCache.set(structureId, hasFirewood);
            if (smoke1) {
                if (hasFirewood && !smoke1.active) smoke1.start();
                else if (!hasFirewood && smoke1.active) smoke1.stop();
            }
            if (smoke2) {
                if (hasFirewood && !smoke2.active) smoke2.start();
                else if (!hasFirewood && smoke2.active) smoke2.stop();
            }
            return;
        }

        // Single smoke effect
        let smoke = this.smokeEffects.get(structureId);

        // Recreate smoke effect if it was cleaned up (e.g., objectRegistry glitch)
        if (!smoke) {
            if (this._hasFirewood(inventory) && this._recreateSmokeIfNeeded(structureId, modelType)) {
                smoke = this.smokeEffects.get(structureId);
            }
            if (!smoke) return;
        }

        const hasFirewood = this._hasFirewood(inventory);
        // Update cache to prevent update loop from reverting the state
        this._firewoodCache.set(structureId, hasFirewood);
        if (hasFirewood && !smoke.active) smoke.start();
        else if (!hasFirewood && smoke.active) smoke.stop();
    }

    /**
     * Recreate a smoke effect for a structure if it was cleaned up.
     * Uses objectRegistry to get current position/rotation.
     * @param {string} structureId - Structure object ID
     * @param {string} modelType - Structure model type
     * @returns {boolean} True if smoke was recreated
     */
    _recreateSmokeIfNeeded(structureId, modelType) {
        const structureObject = this.findObjectById(structureId);
        if (!structureObject) return false;

        const pos = structureObject.position;
        const rot = structureObject.rotation?.y || 0;

        switch (modelType) {
            case 'campfire': this.addCampfireSmoke(structureId, pos); break;
            case 'house': this.addHouseSmoke(structureId, pos, rot); break;
            case 'tileworks': this.addTileworksSmoke(structureId, pos, rot); break;
            case 'ironworks': this.addIronworksSmoke(structureId, pos, rot); break;
            case 'blacksmith': this.addBlacksmithSmoke(structureId, pos, rot); break;
            case 'bakery': this.addBakerySmoke(structureId, pos, rot); break;
            case 'fisherman': this.addFishermanSmoke(structureId, pos, rot); break;
            default: return false;
        }
        return true;
    }

    /**
     * Find an object by ID using objectRegistry (O(1) lookup)
     * @param {string} objectId - Object ID to find
     * @returns {THREE.Object3D|null} - Found object or null
     */
    findObjectById(objectId) {
        if (this.game.objectRegistry) {
            return this.game.objectRegistry.get(objectId) || null;
        }
        return null;
    }

    /**
     * Add smoke effect to a campfire
     * @param {string} objectId - Unique ID for the campfire
     * @param {THREE.Vector3|Object} position - Campfire position {x, y, z}
     */
    addCampfireSmoke(objectId, position) {
        // Don't create duplicate smoke
        if (this.smokeEffects.has(objectId)) {
            return;
        }

        const smokeEffect = new SmokeEffect(objectId, this.smokeParticleSystem, {
            x: position.x,
            y: position.y,
            z: position.z
        });

        // Start with smoke stopped (requires firewood to activate)
        smokeEffect.stop();

        // Set camera reference for LOD calculations
        if (this.game.camera) {
            smokeEffect.camera = this.game.camera;
        }
        this.smokeEffects.set(objectId, smokeEffect);
    }

    /**
     * Add smoke effect to a house (chimney smoke)
     * @param {string} objectId - Unique ID for the house
     * @param {THREE.Vector3|Object} position - House position {x, y, z}
     * @param {number} rotation - Rotation in radians (default 0)
     */
    addHouseSmoke(objectId, position, rotation = 0) {
        // Don't create duplicate smoke
        if (this.smokeEffects.has(objectId)) {
            return;
        }

        // House chimney offset (local space, before rotation)
        const localOffsetX = 0.25;
        const localOffsetZ = 0;

        // Rotate the offset based on structure rotation
        // Negate rotation to match Three.js rotation.y coordinate system
        const cos = Math.cos(-rotation);
        const sin = Math.sin(-rotation);
        const rotatedOffsetX = localOffsetX * cos - localOffsetZ * sin;
        const rotatedOffsetZ = localOffsetX * sin + localOffsetZ * cos;

        const smokeEffect = new SmokeEffect(objectId, this.smokeParticleSystem, {
            x: position.x + rotatedOffsetX,
            y: position.y + 1,
            z: position.z + rotatedOffsetZ
        });

        // Start with smoke stopped (requires firewood to activate)
        smokeEffect.stop();

        // Set camera reference for LOD calculations
        if (this.game.camera) {
            smokeEffect.camera = this.game.camera;
        }
        this.smokeEffects.set(objectId, smokeEffect);
    }

    /**
     * Add smoke effects to tileworks chimneys (2 smoke sources at diagonal corners)
     * @param {string} objectId - Unique ID for the tileworks
     * @param {Object} position - Position of the tileworks center
     * @param {number} rotation - Rotation in radians (default 0)
     */
    addTileworksSmoke(objectId, position, rotation = 0) {
        // Don't create duplicate smoke
        if (this.smokeEffects.has(objectId + '_1') || this.smokeEffects.has(objectId + '_2')) {
            return;
        }

        // Rotate the offset based on structure rotation
        // Negate rotation to match Three.js rotation.y coordinate system
        const cos = Math.cos(-rotation);
        const sin = Math.sin(-rotation);

        // Chimney 1 local offset: +0.75, +0.75 (northeast corner in local space)
        const local1X = 0.75;
        const local1Z = 0.75;
        const rotated1X = local1X * cos - local1Z * sin;
        const rotated1Z = local1X * sin + local1Z * cos;

        const pos1 = {
            x: position.x + rotated1X,
            y: position.y + 3,
            z: position.z + rotated1Z
        };
        const smoke1 = new SmokeEffect(objectId + '_1', this.smokeParticleSystem, pos1);

        // Chimney 2 local offset: -0.75, -0.75 (southwest corner in local space)
        const local2X = -0.75;
        const local2Z = -0.75;
        const rotated2X = local2X * cos - local2Z * sin;
        const rotated2Z = local2X * sin + local2Z * cos;

        const pos2 = {
            x: position.x + rotated2X,
            y: position.y + 3,
            z: position.z + rotated2Z
        };
        const smoke2 = new SmokeEffect(objectId + '_2', this.smokeParticleSystem, pos2);

        // Start with smoke stopped (requires firewood to activate, same as campfire)
        smoke1.stop();
        smoke2.stop();

        // Set camera reference for LOD calculations
        if (this.game.camera) {
            smoke1.camera = this.game.camera;
            smoke2.camera = this.game.camera;
        }

        // Store both smoke effects with unique IDs
        this.smokeEffects.set(objectId + '_1', smoke1);
        this.smokeEffects.set(objectId + '_2', smoke2);
    }

    /**
     * Add smoke effect to ironworks (single centered chimney)
     * @param {string} objectId - Unique ID for the ironworks
     * @param {Object} position - Position of the ironworks center
     * @param {number} rotation - Rotation in radians (default 0)
     */
    addIronworksSmoke(objectId, position, rotation = 0) {
        // Don't create duplicate smoke
        if (this.smokeEffects.has(objectId)) {
            return;
        }

        // Single centered smoke source at the top
        const smokePos = {
            x: position.x,
            y: position.y + 3,  // Top of ironworks
            z: position.z
        };
        const smokeEffect = new SmokeEffect(objectId, this.smokeParticleSystem, smokePos);

        // Start with smoke stopped (requires firewood to activate)
        smokeEffect.stop();

        // Set camera reference for LOD calculations
        if (this.game.camera) {
            smokeEffect.camera = this.game.camera;
        }
        this.smokeEffects.set(objectId, smokeEffect);
    }

    /**
     * Add smoke effect to blacksmith (single centered chimney, same as ironworks)
     * @param {string} objectId - Unique ID for the blacksmith
     * @param {Object} position - Position of the blacksmith center
     * @param {number} rotation - Rotation in radians (default 0)
     */
    addBlacksmithSmoke(objectId, position, rotation = 0) {
        // Don't create duplicate smoke
        if (this.smokeEffects.has(objectId)) {
            return;
        }

        // Single centered smoke source at the top
        const smokePos = {
            x: position.x,
            y: position.y + 3,  // Top of blacksmith
            z: position.z
        };
        const smokeEffect = new SmokeEffect(objectId, this.smokeParticleSystem, smokePos);

        // Start with smoke stopped (requires firewood to activate)
        smokeEffect.stop();

        // Set camera reference for LOD calculations
        if (this.game.camera) {
            smokeEffect.camera = this.game.camera;
        }
        this.smokeEffects.set(objectId, smokeEffect);
    }

    /**
     * Add smoke effect to bakery (single centered chimney, same as blacksmith/ironworks)
     * @param {string} objectId - Unique ID for the bakery
     * @param {Object} position - Position of the bakery center
     * @param {number} rotation - Rotation in radians (default 0)
     */
    addBakerySmoke(objectId, position, rotation = 0) {
        // Don't create duplicate smoke
        if (this.smokeEffects.has(objectId)) {
            return;
        }

        // Single centered smoke source at the top
        const smokePos = {
            x: position.x,
            y: position.y + 3,  // Top of bakery
            z: position.z
        };
        const smokeEffect = new SmokeEffect(objectId, this.smokeParticleSystem, smokePos);

        // Start with smoke stopped (requires firewood to activate)
        smokeEffect.stop();

        // Set camera reference for LOD calculations
        if (this.game.camera) {
            smokeEffect.camera = this.game.camera;
        }
        this.smokeEffects.set(objectId, smokeEffect);
    }

    /**
     * Add smoke effect for fisherman (single centered chimney, same as bakery)
     * @param {string} objectId - Unique ID for the fisherman
     * @param {Object} position - Position of the fisherman center
     * @param {number} rotation - Rotation in radians (default 0)
     */
    addFishermanSmoke(objectId, position, rotation = 0) {
        // Don't create duplicate smoke
        if (this.smokeEffects.has(objectId)) {
            return;
        }

        // Single centered smoke source at the top
        const smokePos = {
            x: position.x,
            y: position.y + 3,  // Top of fisherman
            z: position.z
        };
        const smokeEffect = new SmokeEffect(objectId, this.smokeParticleSystem, smokePos);

        // Start with smoke stopped (requires firewood to activate)
        smokeEffect.stop();

        // Set camera reference for LOD calculations
        if (this.game.camera) {
            smokeEffect.camera = this.game.camera;
        }
        this.smokeEffects.set(objectId, smokeEffect);
    }

    /**
     * Remove smoke effect from a campfire (graceful fadeout)
     * @param {string} objectId - Unique ID for the campfire
     */
    removeCampfireSmoke(objectId) {
        const smokeEffect = this.smokeEffects.get(objectId);
        if (smokeEffect) {
            // Stop spawning new particles, let existing ones fade out
            smokeEffect.stop();
        }
    }

    /**
     * Remove all smoke effects (useful for cleanup or chunk unloading)
     */
    removeAllSmoke() {
        for (const [objectId, smokeEffect] of this.smokeEffects.entries()) {
            smokeEffect.dispose();
        }
        this.smokeEffects.clear();
        this.dyingStructures.clear();
    }

    // =========================================================================
    // DYING STRUCTURE SMOKE (for structures with <= 1 hour until ruin)
    // =========================================================================

    /**
     * Add smoke effect to a dying structure (low durability)
     * @param {string} objectId - Unique ID for the structure
     * @param {THREE.Vector3|Object} position - Structure position {x, y, z}
     */
    addDyingStructureSmoke(objectId, position) {
        const smokeId = `dying_${objectId}`;
        if (this.smokeEffects.has(smokeId)) return;

        const smokeEffect = new SmokeEffect(smokeId, this.smokeParticleSystem, {
            x: position.x,
            y: position.y + 2,  // 2 units above structure base
            z: position.z
        }, 1.8);

        // Dying structure smoke is always active (no firewood check)
        smokeEffect.start();

        if (this.game.camera) {
            smokeEffect.camera = this.game.camera;
        }
        this.smokeEffects.set(smokeId, smokeEffect);
        this.dyingStructures.add(objectId);
    }

    /**
     * Remove dying structure smoke effect
     * @param {string} objectId - Unique ID for the structure
     */
    removeDyingStructureSmoke(objectId) {
        const smokeId = `dying_${objectId}`;
        const effect = this.smokeEffects.get(smokeId);
        if (effect) {
            effect.dispose();
            this.smokeEffects.delete(smokeId);
        }
        this.dyingStructures.delete(objectId);
    }

    /**
     * Check if a structure has dying smoke effect
     * @param {string} objectId - Unique ID for the structure
     * @returns {boolean}
     */
    hasDyingStructureSmoke(objectId) {
        return this.dyingStructures.has(objectId);
    }

    /**
     * Spawn dirt kickup effect at a position (for bullet miss impacts)
     * @param {{x,y,z}} targetPosition - Position being shot at (effect spawns nearby)
     * @param {{x,y,z}} shooterPosition - Position of shooter (particles scatter away)
     */
    spawnDirtKickup(targetPosition, shooterPosition = null) {
        const effect = spawnMissEffect(this.scene, targetPosition, shooterPosition, this.game.camera);
        this.dirtEffects.push(effect);
    }

    /**
     * Spawn red hit effect at target position (for bullet hit impacts)
     * @param {{x,y,z}} targetPosition - Position of the hit target
     * @param {{x,y,z}} shooterPosition - Position of shooter (particles scatter away)
     */
    spawnBloodEffect(targetPosition, shooterPosition = null) {
        const effect = spawnHitEffect(this.scene, targetPosition, shooterPosition, this.game.camera);
        this.dirtEffects.push(effect);
    }

    /**
     * Spawn gunsmoke effect at barrel position (after firing)
     * @param {{x,y,z}} position - World position of gun barrel
     */
    spawnGunSmoke(position) {
        // Spawn 2-3 particles using instanced particle system
        const count = 2 + Math.floor(Math.random() * 2);
        this.gunSmokeParticleSystem.spawnBurst(position, count);
    }

    /**
     * Spawn artillery muzzle flash at barrel position
     * @param {{x,y,z}} position - World position of cannon barrel
     */
    spawnArtilleryMuzzleFlash(position) {
        // Create a large bright flash sprite with radial gradient texture
        if (!this._artilleryFlashTexture) {
            const size = 64;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
            gradient.addColorStop(0, 'rgba(255, 255, 220, 1)');
            gradient.addColorStop(0.2, 'rgba(255, 200, 80, 0.9)');
            gradient.addColorStop(0.5, 'rgba(255, 150, 30, 0.5)');
            gradient.addColorStop(1, 'rgba(255, 80, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, size, size);
            this._artilleryFlashTexture = new THREE.CanvasTexture(canvas);
        }
        if (!this._artilleryFlashMaterial) {
            this._artilleryFlashMaterial = new THREE.SpriteMaterial({
                map: this._artilleryFlashTexture,
                transparent: true,
                opacity: 1.0,
                blending: THREE.AdditiveBlending
            });
        }

        const flash = new THREE.Sprite(this._artilleryFlashMaterial.clone());
        const scale = CONFIG.ARTILLERY_COMBAT?.MUZZLE_FLASH_SCALE || 2.1;
        flash.scale.set(scale, scale, 1);
        flash.position.set(position.x, position.y, position.z);
        this.scene.add(flash);

        // Animate and remove
        const duration = CONFIG.ARTILLERY_COMBAT?.MUZZLE_FLASH_DURATION || 150;
        const startTime = performance.now();

        const animate = () => {
            const elapsed = performance.now() - startTime;
            const progress = elapsed / duration;

            if (progress >= 1) {
                this.scene.remove(flash);
                flash.material.dispose();
                return;
            }

            // Fade out and shrink
            flash.material.opacity = 1 - progress;
            const currentScale = scale * (1 - progress * 0.5);
            flash.scale.set(currentScale, currentScale, 1);

            requestAnimationFrame(animate);
        };

        requestAnimationFrame(animate);
    }

    /**
     * Spawn artillery smoke cloud at barrel position
     * @param {{x,y,z}} position - World position of cannon barrel
     */
    spawnArtillerySmoke(position) {
        // Spawn larger smoke cloud than rifle (8-12 particles)
        // More particles = bigger cloud (no scale param needed)
        const count = 8 + Math.floor(Math.random() * 5);
        this.gunSmokeParticleSystem.spawnBurst(position, count);
    }

    /**
     * Spawn artillery impact effect at target position
     * @param {{x,y,z}} position - Impact position
     * @param {boolean} isHit - Whether target was hit (red vs brown particles)
     */
    spawnArtilleryImpact(position, isHit = false, targetType = null) {
        // Use enhanced dirt/blood effect for artillery
        if (isHit && targetType !== 'structure') {
            // Multiple hit effects for explosive impact
            for (let i = 0; i < 3; i++) {
                const offsetPos = {
                    x: position.x + (Math.random() - 0.5) * 0.5,
                    y: position.y,
                    z: position.z + (Math.random() - 0.5) * 0.5
                };
                const effect = spawnHitEffect(this.scene, offsetPos, null, this.game.camera);
                this.dirtEffects.push(effect);
            }
        } else {
            // Large dirt explosion
            for (let i = 0; i < 5; i++) {
                const offsetPos = {
                    x: position.x + (Math.random() - 0.5) * 1.0,
                    y: position.y,
                    z: position.z + (Math.random() - 0.5) * 1.0
                };
                const effect = spawnMissEffect(this.scene, offsetPos, null, this.game.camera);
                this.dirtEffects.push(effect);
            }
        }

        // Add smoke at impact point
        this.gunSmokeParticleSystem.spawnBurst(position, 4, 1.0);
    }

    /**
     * Update all smoke effects
     * @param {number} deltaSeconds - Time delta in seconds
     */
    update(deltaSeconds) {
        const smokesToRemove = [];

        // Only recalculate firewood state when serverTick changes (once per second)
        const currentTick = this.gameState?.serverTick || 0;
        const shouldCheckFirewood = currentTick !== this._lastCheckedTick;
        if (shouldCheckFirewood) {
            this._lastCheckedTick = currentTick;
            this._firewoodCache.clear(); // Clear cache for fresh calculations
        }

        for (const [objectId, smokeEffect] of this.smokeEffects.entries()) {
            // Pass camera to smoke effect for billboarding
            if (this.game.camera && !smokeEffect.camera) {
                smokeEffect.camera = this.game.camera;
            }

            // Distance culling - pause updates for very distant effects
            if (this.game.camera && smokeEffect.position) {
                const dx = smokeEffect.position.x - this.game.camera.position.x;
                const dz = smokeEffect.position.z - this.game.camera.position.z;
                const distSq = dx * dx + dz * dz;

                // 122500 = 350² - effects beyond this are paused entirely
                if (distSq > 122500) {
                    if (smokeEffect.active) {
                        smokeEffect.stop();
                    }
                    continue;
                }
            }

            // Check if this is tileworks smoke (has _1 or _2 suffix)
            const isTileworksSmoke = objectId.includes('tileworks') && (objectId.endsWith('_1') || objectId.endsWith('_2'));

            if (isTileworksSmoke) {
                // Extract tileworks ID (remove _1 or _2 suffix)
                const tileworksId = objectId.replace(/_[12]$/, '');

                // Only check firewood state on tick change
                if (shouldCheckFirewood) {
                    const tileworksObject = this.findObjectById(tileworksId);

                    if (tileworksObject) {
                        if (tileworksObject.userData.inventory) {
                            const hasFirewood = this._hasFirewood(tileworksObject.userData.inventory);
                            this._firewoodCache.set(tileworksId, hasFirewood);
                        }
                    } else {
                        // Tileworks was removed
                        this._firewoodCache.set(tileworksId, null); // null = removed
                    }
                }

                // Use cached firewood state
                const cachedState = this._firewoodCache.get(tileworksId);

                if (cachedState === null) {
                    // Structure was removed - stop spawning and mark for cleanup
                    if (smokeEffect.active) {
                        smokeEffect.stop();
                    }
                    if (!smokeEffect.hasActiveParticles()) {
                        smokesToRemove.push(objectId);
                    }
                } else if (cachedState === true) {
                    if (!smokeEffect.active) {
                        smokeEffect.start();
                    }
                } else if (cachedState === false) {
                    if (smokeEffect.active) {
                        smokeEffect.stop();
                    }
                }
                // undefined = no inventory yet, keep current state

                smokeEffect.update(deltaSeconds);
                continue;
            }

            // Only check firewood state on tick change for campfires/houses
            if (shouldCheckFirewood) {
                const structureObject = this.findObjectById(objectId);

                if (structureObject) {
                    if (structureObject.userData.inventory) {
                        const hasFirewood = this._hasFirewood(structureObject.userData.inventory);
                        this._firewoodCache.set(objectId, hasFirewood);
                    }
                } else {
                    // Structure was removed
                    this._firewoodCache.set(objectId, null);
                }
            }

            // Use cached firewood state
            const cachedState = this._firewoodCache.get(objectId);

            if (cachedState === null) {
                // Structure was removed - stop spawning and mark for cleanup
                if (smokeEffect.active) {
                    smokeEffect.stop();
                }
                if (!smokeEffect.hasActiveParticles()) {
                    smokesToRemove.push(objectId);
                }
            } else if (cachedState === true) {
                if (!smokeEffect.active) {
                    smokeEffect.start();
                }
            } else if (cachedState === false) {
                if (smokeEffect.active) {
                    smokeEffect.stop();
                }
            }
            // undefined = no inventory yet, keep current state

            smokeEffect.update(deltaSeconds);
        }

        // Update the centralized particle system (animates all smoke particles in one pass)
        this.smokeParticleSystem.update(deltaSeconds);

        // Clean up smoke effects that have fully faded out
        for (const objectId of smokesToRemove) {
            const smokeEffect = this.smokeEffects.get(objectId);
            if (smokeEffect) {
                smokeEffect.dispose();
                this.smokeEffects.delete(objectId);
            }
        }

        // Update dirt/dust effects (one-shot, auto-dispose)
        for (let i = this.dirtEffects.length - 1; i >= 0; i--) {
            const effect = this.dirtEffects[i];
            const stillActive = effect.update(deltaSeconds);
            if (!stillActive) {
                this.dirtEffects.splice(i, 1);
            }
        }

        // Update gun smoke particle system (single instanced mesh)
        this.gunSmokeParticleSystem.update(deltaSeconds);
    }
}


import { SmokeEffect } from '../SmokeEffect.js';
import { DirtKickup, spawnMissEffect } from '../effects/DirtKickup.js';
import * as THREE from 'three';

/**
 * EffectManager
 * Handles visual effects like smoke, particles, and environmental atmosphere.
 */
export class EffectManager {
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        this.gameState = game.gameState; // For tick-based calculations
        this.smokeEffects = new Map();
        this.dirtEffects = []; // One-shot dirt/dust effects
        this._lastCheckedTick = -1; // For throttling firewood checks
        this._firewoodCache = new Map(); // objectId -> hasFirewood (cached per tick)
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
     * Find an object by ID using objectRegistry (fast) with scene.traverse fallback
     * @param {string} objectId - Object ID to find
     * @returns {THREE.Object3D|null} - Found object or null
     */
    findObjectById(objectId) {
        // Try fast registry lookup first
        if (this.game.objectRegistry) {
            const cached = this.game.objectRegistry.get(objectId);
            if (cached) return cached;
        }

        // Fallback to scene traversal
        let found = null;
        this.scene.traverse((object) => {
            if (object.userData && object.userData.objectId === objectId) {
                found = object;
                // Cache for future lookups
                if (this.game.objectRegistry) {
                    this.game.objectRegistry.set(objectId, object);
                }
            }
        });
        return found;
    }

    /**
     * Add smoke effect to a campfire
     * @param {string} objectId - Unique ID for the campfire
     * @param {THREE.Vector3|Object} position - Campfire position {x, y, z}
     */
    addCampfireSmoke(objectId, position) {
        // Don't create duplicate smoke
        if (this.smokeEffects.has(objectId)) {
            console.warn(`Smoke effect already exists for campfire ${objectId}`);
            return;
        }

        const smokeEffect = new SmokeEffect(this.scene, {
            x: position.x,
            y: position.y,
            z: position.z
        });

        // Start with smoke stopped (requires firewood to activate)
        smokeEffect.stop();

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
            console.warn(`Smoke effect already exists for house ${objectId}`);
            return;
        }

        // House chimney offset (local space, before rotation)
        const localOffsetX = 0.25;
        const localOffsetZ = 0;

        // Rotate the offset based on structure rotation
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const rotatedOffsetX = localOffsetX * cos - localOffsetZ * sin;
        const rotatedOffsetZ = localOffsetX * sin + localOffsetZ * cos;

        const smokeEffect = new SmokeEffect(this.scene, {
            x: position.x + rotatedOffsetX,
            y: position.y + 1,
            z: position.z + rotatedOffsetZ
        });

        // Start with smoke stopped (requires firewood to activate)
        smokeEffect.stop();

        this.smokeEffects.set(objectId, smokeEffect);
        console.log(`Created smoke effect for house ${objectId} at (${(position.x + rotatedOffsetX).toFixed(2)}, ${(position.y + 1).toFixed(2)}, ${(position.z + rotatedOffsetZ).toFixed(2)}) - waiting for firewood`);
    }

    /**
     * Add smoke effects to tileworks chimneys (2 smoke sources at diagonal corners)
     * @param {string} objectId - Unique ID for the tileworks
     * @param {Object} position - Position of the tileworks center
     * @param {number} rotation - Rotation in radians (default 0)
     */
    addTileworksSmoke(objectId, position, rotation = 0) {
        console.log(`[TILEWORKS SMOKE] Attempting to add smoke for ${objectId} at position:`, position);

        // Don't create duplicate smoke
        if (this.smokeEffects.has(objectId + '_1') || this.smokeEffects.has(objectId + '_2')) {
            console.warn(`Smoke effects already exist for tileworks ${objectId}`);
            return;
        }

        // Rotate the offset based on structure rotation
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);

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
        console.log(`[TILEWORKS SMOKE] Creating smoke 1 at:`, pos1);
        const smoke1 = new SmokeEffect(this.scene, pos1);

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
        console.log(`[TILEWORKS SMOKE] Creating smoke 2 at:`, pos2);
        const smoke2 = new SmokeEffect(this.scene, pos2);

        // Start with smoke stopped (requires firewood to activate, same as campfire)
        smoke1.stop();
        smoke2.stop();

        // Store both smoke effects with unique IDs
        this.smokeEffects.set(objectId + '_1', smoke1);
        this.smokeEffects.set(objectId + '_2', smoke2);

        console.log(`[TILEWORKS SMOKE] Successfully created smoke effects for tileworks ${objectId} - waiting for firewood`);
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
            console.log(`Stopping smoke effect for campfire ${objectId} (will fade out gracefully)`);
            // Note: The smoke effect will be disposed and removed from the map
            // automatically in the game loop once all particles have faded out
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
        console.log('Removed all smoke effects');
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

        // Clean up smoke effects that have fully faded out
        for (const objectId of smokesToRemove) {
            const smokeEffect = this.smokeEffects.get(objectId);
            if (smokeEffect) {
                smokeEffect.dispose();
                this.smokeEffects.delete(objectId);
                console.log(`Removed faded smoke effect ${objectId}`);
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
    }
}

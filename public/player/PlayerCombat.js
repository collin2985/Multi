/**
 * PlayerCombat.js
 * Manages player combat: targeting, shooting, death animations
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class PlayerCombat {
    constructor(playerObject, audioManager) {
        this.playerObject = playerObject;
        this.audioManager = audioManager;

        // Game state reference (set via setGameState)
        this.gameState = null;

        // Combat state
        this.shootTarget = null;
        // Randomize initial shoot time so AI and player don't always shoot at exactly the same moment
        this.lastShootTime = Date.now() - (3000 + Math.random() * 3000); // First shot between 3-6 seconds from now
        this.shootInterval = 6000; // 6 seconds between shots
        this.lastTargetCheckTime = 0;
        this.inCombatStance = false;      // True when enemy nearby (for HUD)
        this.showCombatAnimation = false; // True when enemy nearby AND has rifle (for animation)
        this.shootingPauseEndTime = 0; // 1 second pause after shooting

        // Death state
        this.isDead = false;
        this.deathStartTime = 0;
        this.deathRotationProgress = 0;
        this.fallDirection = 1;

        // Animation actions
        this.shootAction = null;

        // Callbacks
        this.onShootCallback = null;
        this.onDeathCallback = null;

        // Muzzle flash effect (set via setMuzzleFlash)
        this.muzzleFlash = null;

        // Deer controller reference (set via setDeerController)
        this.deerController = null;

        // Bear controller reference (set via setBearController)
        this.bearController = null;
    }

    /**
     * Set muzzle flash effect reference
     * @param {MuzzleFlash} muzzleFlash
     */
    setMuzzleFlash(muzzleFlash) {
        this.muzzleFlash = muzzleFlash;
    }

    /**
     * Set game state reference for ammo tracking
     * @param {GameState} gameState
     */
    setGameState(gameState) {
        this.gameState = gameState;
    }

    /**
     * Set deer controller reference for targeting
     * @param {DeerController} deerController
     */
    setDeerController(deerController) {
        this.deerController = deerController;
    }

    /**
     * Set bear controller reference for targeting
     * @param {BearController} bearController
     */
    setBearController(bearController) {
        this.bearController = bearController;
    }

    /**
     * Get current ammo count from inventory
     * @returns {number} - Total ammo count across all ammo stacks
     */
    getAmmoCount() {
        if (!this.gameState || !this.gameState.inventory || !this.gameState.inventory.items) {
            return 0;
        }

        let totalAmmo = 0;
        for (const item of this.gameState.inventory.items) {
            if (item.type === 'ammo') {
                totalAmmo += (item.quantity || 1);
            }
        }
        return totalAmmo;
    }

    /**
     * Check if player has ammo
     * @returns {boolean}
     */
    hasAmmo() {
        return this.getAmmoCount() > 0;
    }

    /**
     * Consume 1 ammo from inventory
     * @returns {boolean} - True if ammo was consumed, false if no ammo
     */
    consumeAmmo() {
        if (!this.gameState || !this.gameState.inventory || !this.gameState.inventory.items) {
            return false;
        }

        // Find first ammo stack
        const ammoItem = this.gameState.inventory.items.find(item => item.type === 'ammo' && (item.quantity || 1) > 0);
        if (!ammoItem) {
            return false;
        }

        // Consume 1 ammo
        ammoItem.quantity = (ammoItem.quantity || 1) - 1;

        // Remove empty ammo stack from inventory
        if (ammoItem.quantity <= 0) {
            const idx = this.gameState.inventory.items.indexOf(ammoItem);
            if (idx > -1) {
                this.gameState.inventory.items.splice(idx, 1);
            }
        }

        return true;
    }

    /**
     * Check if player has a rifle (in sling or backpack)
     * @returns {boolean}
     */
    hasRifle() {
        if (!this.gameState) {
            return false;
        }

        // Check sling slot first
        if (this.gameState.slingItem && this.gameState.slingItem.type === 'rifle') {
            return true;
        }

        // Check backpack inventory
        if (this.gameState.inventory && this.gameState.inventory.items) {
            return this.gameState.inventory.items.some(item => item.type === 'rifle');
        }

        return false;
    }

    /**
     * Set shoot animation action
     * @param {THREE.AnimationAction} action
     */
    setShootAnimation(action) {
        this.shootAction = action;
    }

    /**
     * Set shoot callback
     * @param {function} callback - Called with (target, isHit)
     */
    onShoot(callback) {
        this.onShootCallback = callback;
    }

    /**
     * Set death callback
     * @param {function} callback
     */
    onDeath(callback) {
        this.onDeathCallback = callback;
    }

    /**
     * Update combat targeting and shooting with enemy gathering
     * @param {object} aiEnemy - Local AI enemy entity (legacy, can be null)
     * @param {object} aiEnemyController - Local AI enemy controller (legacy, can be null)
     * @param {Map} peerGameData - Peer game data map
     * @param {function} onShoot - Callback when shooting (target, isHit)
     * @param {function} onStopMoving - Callback to stop player movement
     * @param {Map} tentAIEnemies - Map of all local tent AI enemies (optional)
     * @param {object} banditController - BanditController instance for peer bandit targeting
     */
    updateShooting(aiEnemy, aiEnemyController, peerGameData, onShoot, onStopMoving, tentAIEnemies = null, banditController = null) {
        // Don't shoot if player is dead
        if (this.isDead) return;

        const now = Date.now();
        const playerPos = this.playerObject.position;

        // Check for nearest enemy (AI) once per second
        if (now - this.lastTargetCheckTime >= 1000) {
            this.lastTargetCheckTime = now;

            let nearestEnemy = null;
            let nearestDistanceSquared = Infinity;  // PERFORMANCE: Use squared distances for comparisons
            let totalAIChecked = 0;

            // Check all local tent AI enemies first (if provided)
            if (tentAIEnemies) {
                tentAIEnemies.forEach((aiData, tentId) => {
                    totalAIChecked++;
                    if (aiData.controller && !aiData.isDead && !aiData.controller.isDead) {
                        // Use mesh position if available, otherwise fallback to BanditController entity position
                        let enemyPos = null;
                        let entity = null;

                        if (aiData.controller.enemy) {
                            // Normal case: mesh exists
                            entity = aiData.controller.enemy;
                            enemyPos = entity.position;
                        } else if (banditController) {
                            // Mesh missing: use BanditController entity position as fallback
                            const bcEntity = banditController.entities.get(tentId);
                            if (bcEntity && bcEntity.state !== 'dead') {
                                enemyPos = bcEntity.mesh?.position || bcEntity.position;
                                entity = bcEntity.mesh || { position: enemyPos };
                            }
                        }

                        if (enemyPos) {
                            const dx = enemyPos.x - playerPos.x;
                            const dz = enemyPos.z - playerPos.z;
                            const distSquared = dx * dx + dz * dz;
                            if (distSquared < nearestDistanceSquared) {
                                nearestDistanceSquared = distSquared;
                                nearestEnemy = {
                                    entity: entity,
                                    isLocal: true,
                                    controller: aiData.controller,
                                    tentId: tentId,
                                    distance: Math.sqrt(distSquared)
                                };
                            }
                        }
                    }
                });
            } else if (aiEnemy && aiEnemyController && !aiEnemyController.isDead) {
                totalAIChecked++;
                // Fallback to legacy single AI enemy check
                const dx = aiEnemy.position.x - playerPos.x;
                const dz = aiEnemy.position.z - playerPos.z;
                const localDistSquared = dx * dx + dz * dz;
                if (localDistSquared < nearestDistanceSquared) {
                    nearestDistanceSquared = localDistSquared;
                    nearestEnemy = {
                        entity: aiEnemy,
                        isLocal: true,
                        controller: aiEnemyController,
                        distance: Math.sqrt(localDistSquared)
                    };
                }
            }

            // Check peer-controlled bandits via BanditController (preferred - has proper tentId)
            if (banditController) {
                const clientId = banditController.clientId;
                for (const [tentId, entity] of banditController.entities) {
                    // Skip local authority entities (already handled above) and dead entities
                    if (entity.authorityId === clientId || entity.state === 'dead') continue;

                    // Use entity position (or mesh if available)
                    const entityPos = entity.mesh?.position || entity.position;
                    if (!entityPos) continue;

                    totalAIChecked++;
                    const dx = entityPos.x - playerPos.x;
                    const dz = entityPos.z - playerPos.z;
                    const distSquared = dx * dx + dz * dz;

                    if (distSquared < nearestDistanceSquared) {
                        nearestDistanceSquared = distSquared;
                        nearestEnemy = {
                            entity: entity.mesh || { position: entityPos },
                            isLocal: false,
                            tentId: tentId,  // Proper tentId from BanditController
                            controller: entity.controller,
                            distance: Math.sqrt(distSquared)
                        };
                    }
                }
            }

            // Legacy fallback: Check peer AI enemies from peerGameData (only if no banditController)
            // This path lacks tentId, so kills won't propagate properly
            if (!banditController) {
                peerGameData.forEach((peer, peerId) => {
                    if (peer.aiEnemy && !peer.aiEnemy.userData.isDead) {
                        totalAIChecked++;
                        const dx = peer.aiEnemy.position.x - playerPos.x;
                        const dz = peer.aiEnemy.position.z - playerPos.z;
                        const peerDistSquared = dx * dx + dz * dz;
                        if (peerDistSquared < nearestDistanceSquared) {
                            nearestDistanceSquared = peerDistSquared;
                            nearestEnemy = { entity: peer.aiEnemy, isLocal: false, peerId: peerId, distance: Math.sqrt(peerDistSquared) };
                        }
                    }
                });
            }

            // Check deer via DeerController (nearest entity wins regardless of type)
            if (this.deerController) {
                const nearbyDeer = this.deerController.getLivingDeerNear(playerPos.x, playerPos.z, 35);

                for (const deer of nearbyDeer) {
                    const distSquared = deer.distance * deer.distance;
                    if (distSquared < nearestDistanceSquared) {
                        nearestDistanceSquared = distSquared;
                        nearestEnemy = {
                            entity: deer.mesh || { position: deer.position },
                            isLocal: this.deerController.isAuthority(deer.chunkKey),
                            isDeer: true,
                            chunkKey: deer.chunkKey,
                            distance: deer.distance
                        };
                    }
                }
            }

            // Check bears via BearController (nearest entity wins regardless of type)
            if (this.bearController) {
                const nearbyBear = this.bearController.getLivingBearNear(playerPos.x, playerPos.z, 35);

                for (const bear of nearbyBear) {
                    const distSquared = bear.distance * bear.distance;
                    if (distSquared < nearestDistanceSquared) {
                        nearestDistanceSquared = distSquared;
                        nearestEnemy = {
                            entity: bear.mesh || { position: bear.position },
                            isLocal: this.bearController.isAuthority(bear.chunkKey),
                            isBear: true,
                            chunkKey: bear.chunkKey,
                            distance: bear.distance
                        };
                    }
                }
            }

            this.shootTarget = nearestEnemy;
        }

        // If no target found, exit combat stance
        if (!this.shootTarget) {
            this.inCombatStance = false;
            this.showCombatAnimation = false;
            return;
        }

        const targetPos = this.shootTarget.entity.position;
        const dx = targetPos.x - playerPos.x;
        const dz = targetPos.z - playerPos.z;
        const distance = this.shootTarget.distance;

        // inCombatStance = enemy nearby (for HUD threat indicator)
        // showCombatAnimation = enemy nearby AND has rifle (for animation/rifle visibility)
        this.inCombatStance = distance <= 35;
        this.showCombatAnimation = distance <= 35 && this.hasRifle();

        // Calculate shooting range based on height advantage
        const shootingRange = this.calculateShootingRange(playerPos.y, targetPos.y);
        const timeSinceLastShot = now - this.lastShootTime;
        const canShootTiming = timeSinceLastShot >= this.shootInterval;

        // Shoot at enemy every 6 seconds when within shooting range
        if (distance <= shootingRange && canShootTiming) {
            // Check if player has a rifle
            if (!this.hasRifle()) {
                // No rifle - can't shoot but still in combat stance
                return;
            }

            // Check if player has ammo
            if (!this.hasAmmo()) {
                // No ammo - can't shoot but still in combat stance
                return;
            }

            this.lastShootTime = now;

            // Consume 1 ammo
            this.consumeAmmo();

            // Set shooting pause (1 second freeze)
            this.shootingPauseEndTime = now + 1000;

            // Stop player movement during shooting
            if (onStopMoving) {
                onStopMoving();
            }

            // Rotate directly towards enemy for accurate aiming
            const targetRotation = Math.atan2(dx, dz);
            this.playerObject.rotation.y = targetRotation;

            // Play shoot animation
            if (this.shootAction) {
                this.shootAction.reset();
                this.shootAction.play();
            }

            // Play rifle sound
            if (this.audioManager) {
                this.audioManager.playPositionalSound('rifle', this.playerObject);
            }

            // Trigger muzzle flash
            if (this.muzzleFlash) {
                this.muzzleFlash.flash();
            }

            // Calculate hit chance based on height advantage and distance
            const hitChance = this.calculateHitChance(playerPos.y, targetPos.y, distance);
            const hitRoll = Math.random();
            const isHit = hitRoll < hitChance;

            console.log(`Player shooting at ${this.shootTarget.isLocal ? 'local AI' : 'peer AI'}! Distance: ${distance.toFixed(1)}, Hit chance: ${(hitChance * 100).toFixed(1)}%, Result: ${isHit ? 'HIT' : 'MISS'}, Ammo remaining: ${this.getAmmoCount()}`);

            // Trigger callback with shooting info
            if (onShoot) {
                onShoot(this.shootTarget, isHit, playerPos);
            }
        }
    }

    /**
     * Update combat targeting and shooting (legacy method)
     * @param {Array} enemies - Array of enemy objects {entity, isLocal, peerId, distance}
     */
    update(enemies) {
        if (this.isDead) return;

        // No combat while piloting a mobile entity (boat/cart/horse)
        if (this.gameState && this.gameState.mobileEntityState && this.gameState.mobileEntityState.isActive) {
            this.inCombatStance = false;
            this.showCombatAnimation = false;
            this.shootTarget = null;
            return;
        }

        const now = Date.now();
        const playerPos = this.playerObject.position;

        // Check for nearest enemy once per second
        if (now - this.lastTargetCheckTime >= 1000) {
            this.lastTargetCheckTime = now;
            this.shootTarget = this.findNearestEnemy(enemies, playerPos);
        }

        // If no target found, exit combat stance
        if (!this.shootTarget) {
            this.inCombatStance = false;
            this.showCombatAnimation = false;
            return;
        }

        const targetPos = this.shootTarget.entity.position;
        const dx = targetPos.x - playerPos.x;
        const dz = targetPos.z - playerPos.z;
        const distance = this.shootTarget.distance;

        // inCombatStance = enemy nearby (for HUD), showCombatAnimation = has rifle too (for animation)
        this.inCombatStance = distance <= 35;
        this.showCombatAnimation = distance <= 35 && this.hasRifle();

        // Calculate shooting range based on height advantage
        const shootingRange = this.calculateShootingRange(playerPos.y, targetPos.y);

        // Shoot at enemy every 6 seconds when within shooting range
        if (distance <= shootingRange && now - this.lastShootTime >= this.shootInterval) {
            this.shoot(playerPos, targetPos, distance);
        }
    }

    /**
     * Find nearest enemy from list
     * @private
     */
    findNearestEnemy(enemies, playerPos) {
        let nearestEnemy = null;
        let nearestDistance = Infinity;

        for (const enemy of enemies) {
            if (enemy.distance < nearestDistance) {
                nearestDistance = enemy.distance;
                nearestEnemy = enemy;
            }
        }

        return nearestEnemy;
    }

    /**
     * Perform shoot action
     * @private
     */
    shoot(playerPos, targetPos, distance = 10) {
        // Check if player has a rifle
        if (!this.hasRifle()) {
            return false;
        }

        // Check if player has ammo
        if (!this.hasAmmo()) {
            return false;
        }

        const now = Date.now();
        this.lastShootTime = now;

        // Consume 1 ammo
        this.consumeAmmo();

        // Set shooting pause (1 second freeze)
        this.shootingPauseEndTime = now + 1000;

        // Play shoot animation
        if (this.shootAction) {
            this.shootAction.reset();
            this.shootAction.play();
        }

        // Play rifle sound
        if (this.audioManager) {
            this.audioManager.playPositionalSound('rifle', this.playerObject);
        }

        // Trigger muzzle flash
        if (this.muzzleFlash) {
            this.muzzleFlash.flash();
        }

        // Calculate hit chance based on height advantage and distance
        const hitChance = this.calculateHitChance(playerPos.y, targetPos.y, distance);
        const hitRoll = Math.random();
        const isHit = hitRoll < hitChance;

        // Trigger callback
        if (this.onShootCallback) {
            this.onShootCallback(this.shootTarget, isHit);
        }

        return isHit;
    }

    /**
     * Calculate shooting range based on height advantage
     * @private
     */
    calculateShootingRange(shooterY, targetY) {
        // Base shooting range is 10 units, max is 15
        const BASE_RANGE = 10;
        const MAX_RANGE = 15;

        // Height advantage (positive if shooter is above target)
        const heightAdvantage = shooterY - targetY;

        // Range increases by 2.5 per unit of height (max bonus at 2 units height)
        // No penalty for being lower - just no bonus
        const bonusRange = Math.max(0, heightAdvantage) * 2.5;

        // Calculate final range (capped at 15)
        const shootingRange = Math.min(MAX_RANGE, BASE_RANGE + bonusRange);

        return shootingRange;
    }

    /**
     * Calculate hit chance based on height advantage and distance
     * @private
     */
    calculateHitChance(shooterY, targetY, distance = 10) {
        // Base hit chance is 35%
        const BASE_HIT_CHANCE = 0.35;
        const MAX_HIT_CHANCE = 0.8;

        // Height advantage (positive if shooter is above target)
        const heightAdvantage = shooterY - targetY;

        // Only apply bonus for height advantage (being higher improves accuracy)
        // Being lower doesn't penalize base accuracy
        const bonusChance = Math.max(0, heightAdvantage * 0.15);

        // Calculate base hit chance from height (capped at 80%)
        const baseHitChance = Math.min(MAX_HIT_CHANCE, BASE_HIT_CHANCE + bonusChance);

        // Apply distance bonus: 0% at 4+ units, scales to 100% at 0 units
        const POINT_BLANK_RANGE = 4;
        const distanceBonus = Math.max(0, (POINT_BLANK_RANGE - distance) / POINT_BLANK_RANGE);
        const hitChance = baseHitChance + (1.0 - baseHitChance) * distanceBonus;

        return hitChance;
    }

    /**
     * Trigger player death
     */
    die() {
        if (this.isDead) return;

        this.isDead = true;
        this.deathStartTime = Date.now();
        this.fallDirection = Math.random() < 0.5 ? -1 : 1;

        if (this.onDeathCallback) {
            this.onDeathCallback();
        }
    }

    /**
     * Respawn player
     */
    respawn() {
        this.isDead = false;
        this.deathStartTime = 0;
        this.deathRotationProgress = 0;
        this.shootTarget = null;
        this.inCombatStance = false;
        this.showCombatAnimation = false;

        // Reset player rotation (all axes, not just Z)
        if (this.playerObject.children[0]) {
            this.playerObject.children[0].rotation.set(0, 0, 0);
        }
    }

    /**
     * Update death animation
     * @param {number} deltaTime
     * @returns {boolean} - True if animation complete
     */
    updateDeathAnimation(deltaTime) {
        if (!this.isDead) return true;

        const DEATH_DURATION = 500; // 0.5 seconds
        const elapsed = Date.now() - this.deathStartTime;

        if (elapsed < DEATH_DURATION) {
            const progress = elapsed / DEATH_DURATION;

            // Rotate 90 degrees around Z axis (fall to side)
            if (this.playerObject.children[0]) {
                this.playerObject.children[0].rotation.z = (Math.PI / 2) * progress * this.fallDirection;
            }

            return false; // Still animating
        } else {
            // Animation complete
            if (this.playerObject.children[0]) {
                this.playerObject.children[0].rotation.z = (Math.PI / 2) * this.fallDirection;
            }
            return true;
        }
    }

    /**
     * Check if in shooting pause
     * @returns {boolean}
     */
    isInShootingPause() {
        return Date.now() < this.shootingPauseEndTime;
    }

    /**
     * Get combat stance state (enemy nearby - for HUD)
     * @returns {boolean}
     */
    getInCombatStance() {
        return this.inCombatStance;
    }

    /**
     * Get combat animation state (enemy nearby AND has rifle - for animation/rifle visibility)
     * @returns {boolean}
     */
    getShowCombatAnimation() {
        return this.showCombatAnimation;
    }

    /**
     * Get death state
     * @returns {boolean}
     */
    getIsDead() {
        return this.isDead;
    }

    /**
     * Get shoot target
     * @returns {object|null}
     */
    getShootTarget() {
        return this.shootTarget;
    }

    /**
     * Get fall direction
     * @returns {number}
     */
    getFallDirection() {
        return this.fallDirection;
    }

    /**
     * Get death start time
     * @returns {number}
     */
    getDeathStartTime() {
        return this.deathStartTime;
    }
}

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

        // Effect manager reference (set via setEffectManager)
        this.effectManager = null;

        // Deer controller reference (set via setDeerController)
        this.deerController = null;

        // Brown bear controller reference (set via setBrownBearController)
        this.brownBearController = null;

        // Game reference (set via setGame) - for faction player targeting
        this.game = null;
    }

    /**
     * Set muzzle flash effect reference
     * @param {MuzzleFlash} muzzleFlash
     */
    setMuzzleFlash(muzzleFlash) {
        this.muzzleFlash = muzzleFlash;
    }

    /**
     * Set effect manager reference for gunsmoke
     * @param {EffectManager} effectManager
     */
    setEffectManager(effectManager) {
        this.effectManager = effectManager;
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
     * Set brown bear controller reference for targeting
     * @param {BrownBearController} brownBearController
     */
    setBrownBearController(brownBearController) {
        this.brownBearController = brownBearController;
    }

    /**
     * Set game reference for avatar access (faction player targeting)
     * @param {Game} game
     */
    setGame(game) {
        this.game = game;
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
     * Consume 1 durability from rifle (1 shot = 1 durability)
     * @returns {boolean} - True if durability was consumed, false if rifle broke
     */
    consumeRifleDurability() {
        if (!this.gameState) {
            return true; // No gameState, don't break anything
        }

        // Check sling slot first
        let rifle = null;
        let isInSling = false;

        if (this.gameState.slingItem && this.gameState.slingItem.type === 'rifle') {
            rifle = this.gameState.slingItem;
            isInSling = true;
        } else if (this.gameState.inventory && this.gameState.inventory.items) {
            rifle = this.gameState.inventory.items.find(item => item.type === 'rifle' && item.durability > 0);
        }

        if (!rifle) {
            return false;
        }

        // Consume 1 durability per shot
        rifle.durability = Math.max(0, (rifle.durability || 100) - 1);

        // Check if rifle broke
        if (rifle.durability <= 0) {
            if (isInSling) {
                // Remove from sling
                this.gameState.slingItem = null;
            } else {
                // Remove from inventory
                const idx = this.gameState.inventory.items.indexOf(rifle);
                if (idx > -1) {
                    this.gameState.inventory.items.splice(idx, 1);
                }
            }
            // Import ui dynamically to show toast
            import('../ui.js').then(({ ui }) => {
                ui.showToast('Your rifle broke!', 'warning');
            });
            return false;
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

        // Don't auto-shoot rifle while manning artillery
        if (this.gameState?.mannedArtillery?.manningState?.isManning) return;

        // On boats: still detect threats for HUD, but don't shoot
        const isOnBoat = this.gameState?.vehicleState?.isPilotingBoat() || false;

        // Check if hold fire is enabled (still do targeting, just don't shoot)
        const isHoldingFire = window.game?.combatHUD?.isHoldingFire;

        const now = Date.now();
        const playerPos = this.playerObject.position;

        // Check for nearest enemy (AI) once per second
        if (now - this.lastTargetCheckTime >= 1000) {
            this.lastTargetCheckTime = now;

            let nearestEnemy = null;
            let nearestDistanceSquared = Infinity;  // PERFORMANCE: Use squared distances for comparisons
            let totalAIChecked = 0;
            const EARLY_EXIT_DIST_SQ = 100;  // 10 units squared - skip remaining checks if target this close

            // Check all local tent AI enemies first (if provided)
            if (tentAIEnemies) {
                tentAIEnemies.forEach((aiData, tentId) => {
                    totalAIChecked++;
                    if (aiData.controller && !aiData.isDead && !aiData.controller.isDead) {
                        // Skip friendly militia (bandits have no factionId)
                        const entityFactionId = aiData.controller.factionId || aiData.controller.enemy?.userData?.factionId;
                        if (entityFactionId && !this.gameState.isEnemyFaction(entityFactionId)) {
                            return; // Skip friendly militia
                        }
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
                                // Get entityType from AIEnemy controller or BanditController
                                const bcEntity = banditController?.entities.get(tentId);
                                const entityType = aiData.controller?.aiType || bcEntity?.entityType || 'bandit';
                                nearestEnemy = {
                                    entity: entity,
                                    isLocal: true,
                                    controller: aiData.controller,
                                    tentId: tentId,
                                    entityType: entityType,
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
            // EARLY EXIT: Skip if we already found a very close target
            if (banditController && nearestDistanceSquared >= EARLY_EXIT_DIST_SQ) {
                const clientId = banditController.clientId;
                for (const [tentId, entity] of banditController.entities) {
                    // Skip local authority entities (already handled above) and dead entities
                    if (entity.authorityId === clientId || entity.state === 'dead') continue;

                    // Skip friendly militia (bandits have no factionId)
                    if (entity.factionId && !this.gameState.isEnemyFaction(entity.factionId)) continue;

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
                            entityType: entity.entityType || 'bandit',
                            distance: Math.sqrt(distSquared)
                        };
                    }
                }
            }

            // Legacy fallback: Check peer AI enemies from peerGameData (only if no banditController)
            // This path lacks tentId, so kills won't propagate properly
            // EARLY EXIT: Skip if we already found a very close target
            if (!banditController && nearestDistanceSquared >= EARLY_EXIT_DIST_SQ) {
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
            // EARLY EXIT: Skip if we already found a very close target
            if (this.deerController && nearestDistanceSquared >= EARLY_EXIT_DIST_SQ) {
                const nearbyDeer = this.deerController.getLivingDeerNear(playerPos.x, playerPos.z, 35);

                for (const deer of nearbyDeer) {
                    const distSquared = deer.distance * deer.distance;
                    if (distSquared < nearestDistanceSquared) {
                        nearestDistanceSquared = distSquared;
                        nearestEnemy = {
                            entity: deer.mesh || { position: deer.position },
                            isLocal: this.deerController.isAuthority(deer.treeId),  // FIX: was chunkKey (undefined)
                            isDeer: true,
                            treeId: deer.treeId,  // FIX: was chunkKey (undefined)
                            distance: deer.distance
                        };
                    }
                }
            }

            // Check brown bears via BrownBearController
            // EARLY EXIT: Skip if we already found a very close target
            if (this.brownBearController && nearestDistanceSquared >= EARLY_EXIT_DIST_SQ) {
                for (const [denId, entity] of this.brownBearController.entities) {
                    if (entity.state === 'dead') continue;

                    const entityPos = entity.mesh?.position || entity.position;
                    if (!entityPos) continue;

                    const dx = entityPos.x - playerPos.x;
                    const dz = entityPos.z - playerPos.z;
                    const distSquared = dx * dx + dz * dz;

                    // Only consider if within 35 unit range
                    if (distSquared > 35 * 35) continue;

                    if (distSquared < nearestDistanceSquared) {
                        nearestDistanceSquared = distSquared;
                        nearestEnemy = {
                            entity: entity.mesh || { position: entity.position },
                            isLocal: entity.authorityId === this.brownBearController.clientId,
                            isBrownBear: true,
                            denId: denId,
                            distance: Math.sqrt(distSquared)
                        };
                    }
                }
            }

            // Check enemy faction players
            // EARLY EXIT: Skip if we already found a very close target
            if (peerGameData && this.game?.networkManager?.avatars && nearestDistanceSquared >= EARLY_EXIT_DIST_SQ) {
                peerGameData.forEach((peer, peerId) => {
                    // Skip if no faction data or not an enemy
                    if (!this.gameState.isEnemyFaction(peer.factionId)) {
                        return;
                    }

                    // Get peer avatar position
                    const avatar = this.game.networkManager.avatars.get(peerId);
                    if (!avatar || !avatar.position) return;

                    // Skip dead players
                    if (avatar.userData?.isDead) return;

                    const dx = avatar.position.x - playerPos.x;
                    const dz = avatar.position.z - playerPos.z;
                    const distSquared = dx * dx + dz * dz;

                    // Only consider if within 35 unit range (combat stance range)
                    if (distSquared > 35 * 35) return;

                    if (distSquared < nearestDistanceSquared) {
                        nearestDistanceSquared = distSquared;
                        nearestEnemy = {
                            entity: avatar,
                            isLocal: false,
                            isPlayer: true,
                            peerId: peerId,
                            factionId: peer.factionId,
                            distance: Math.sqrt(distSquared)
                        };
                    }
                });
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
        // On boats: show HUD but no rifle animation (can't shoot from boats)
        this.inCombatStance = distance <= 35;
        this.showCombatAnimation = distance <= 35 && this.hasRifle() && !isOnBoat;

        // Calculate shooting range based on height advantage
        const shootingRange = this.calculateShootingRange(playerPos.y, targetPos.y);
        const timeSinceLastShot = now - this.lastShootTime;
        const canShootTiming = timeSinceLastShot >= this.shootInterval;

        // Shoot at enemy every 6 seconds when within shooting range
        // Don't shoot if hold fire is enabled or on a boat (targeting still happens for HUD)
        if (distance <= shootingRange && canShootTiming && !isHoldingFire && !isOnBoat) {
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

            // Consume 1 ammo and 1 rifle durability
            this.consumeAmmo();
            this.consumeRifleDurability();

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

            // Trigger muzzle flash and gunsmoke
            if (this.muzzleFlash) {
                this.muzzleFlash.flash();
                // Spawn gunsmoke at barrel position
                if (this.effectManager) {
                    const barrelPos = new THREE.Vector3();
                    this.muzzleFlash.sprite.getWorldPosition(barrelPos);
                    this.effectManager.spawnGunSmoke(barrelPos);
                }
            }

            // Calculate hit chance based on height advantage, distance, and rifle quality
            const hitChance = this.calculateHitChance(playerPos.y, targetPos.y, distance, this.getRifleQuality());
            const hitRoll = Math.random();
            const isHit = hitRoll < hitChance;

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

        // On boats: still detect threats for HUD, but don't shoot (handled below)
        const isOnBoatLegacy = this.gameState?.vehicleState?.isPilotingBoat() || false;

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
        // On boats: show HUD but no rifle animation
        this.inCombatStance = distance <= 35;
        this.showCombatAnimation = distance <= 35 && this.hasRifle() && !isOnBoatLegacy;

        // Calculate shooting range based on height advantage
        const shootingRange = this.calculateShootingRange(playerPos.y, targetPos.y);

        // Shoot at enemy every 6 seconds when within shooting range (not on boats)
        if (distance <= shootingRange && now - this.lastShootTime >= this.shootInterval && !isOnBoatLegacy) {
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

        // Consume 1 ammo and 1 rifle durability
        this.consumeAmmo();
        this.consumeRifleDurability();

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

        // Trigger muzzle flash and gunsmoke
        if (this.muzzleFlash) {
            this.muzzleFlash.flash();
            // Spawn gunsmoke at barrel position
            if (this.effectManager) {
                const barrelPos = new THREE.Vector3();
                this.muzzleFlash.sprite.getWorldPosition(barrelPos);
                this.effectManager.spawnGunSmoke(barrelPos);
            }
        }

        // Calculate hit chance based on height advantage, distance, and rifle quality
        const hitChance = this.calculateHitChance(playerPos.y, targetPos.y, distance, this.getRifleQuality());
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
     * Get the quality of the player's rifle
     * @returns {number} Rifle quality (1-100), defaults to 50
     */
    getRifleQuality() {
        if (this.gameState.slingItem && this.gameState.slingItem.type === 'rifle') {
            return this.gameState.slingItem.quality || 50;
        }
        if (this.gameState.inventory && this.gameState.inventory.items) {
            const rifle = this.gameState.inventory.items.find(item => item.type === 'rifle');
            if (rifle) return rifle.quality || 50;
        }
        return 50;
    }

    /**
     * Calculate hit chance based on height advantage, distance, and rifle quality
     * @private
     */
    calculateHitChance(shooterY, targetY, distance = 10, rifleQuality = 50) {
        // Quality bonus: 100 = +10%, 50 = 0%, 1 = -10%
        const qualityBonus = (rifleQuality - 50) / 50 * 0.10;
        const BASE_HIT_CHANCE = 0.35 + qualityBonus;
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

        // Reset shoot timing so player can shoot immediately when they get a rifle
        // Randomize like constructor to avoid sync with AI
        this.lastShootTime = Date.now() - (3000 + Math.random() * 3000);
        this.lastTargetCheckTime = 0;

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

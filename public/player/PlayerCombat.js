/**
 * PlayerCombat.js
 * Manages player combat: targeting, shooting, death animations
 */

export class PlayerCombat {
    constructor(playerObject, audioManager) {
        this.playerObject = playerObject;
        this.audioManager = audioManager;

        // Combat state
        this.shootTarget = null;
        this.lastShootTime = 0;
        this.shootInterval = 6000; // 6 seconds between shots
        this.lastTargetCheckTime = 0;
        this.inCombatStance = false;
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
     * @param {object} aiEnemy - Local AI enemy entity
     * @param {object} aiEnemyController - Local AI enemy controller
     * @param {Map} peerGameData - Peer game data map
     * @param {function} onShoot - Callback when shooting (target, isHit)
     * @param {function} onStopMoving - Callback to stop player movement
     */
    updateShooting(aiEnemy, aiEnemyController, peerGameData, onShoot, onStopMoving) {
        // Don't shoot if player is dead
        if (this.isDead) return;

        const now = Date.now();
        const playerPos = this.playerObject.position;

        // Check for nearest enemy (AI) once per second
        if (now - this.lastTargetCheckTime >= 1000) {
            this.lastTargetCheckTime = now;

            let nearestEnemy = null;
            let nearestDistance = Infinity;

            // Check local AI enemy (skip if dead)
            if (aiEnemy && aiEnemyController && !aiEnemyController.isDead) {
                const localDist = Math.sqrt(
                    Math.pow(aiEnemy.position.x - playerPos.x, 2) +
                    Math.pow(aiEnemy.position.z - playerPos.z, 2)
                );
                if (localDist < nearestDistance) {
                    nearestDistance = localDist;
                    nearestEnemy = { entity: aiEnemy, isLocal: true, distance: localDist };
                }
            }

            // Check peer AI enemies (skip if dead)
            peerGameData.forEach((peer, peerId) => {
                if (peer.aiEnemy && !peer.aiEnemy.userData.isDead) {
                    const peerDist = Math.sqrt(
                        Math.pow(peer.aiEnemy.position.x - playerPos.x, 2) +
                        Math.pow(peer.aiEnemy.position.z - playerPos.z, 2)
                    );
                    if (peerDist < nearestDistance) {
                        nearestDistance = peerDist;
                        nearestEnemy = { entity: peer.aiEnemy, isLocal: false, peerId: peerId, distance: peerDist };
                    }
                }
            });

            this.shootTarget = nearestEnemy;
        }

        // If no target found, exit combat stance
        if (!this.shootTarget) {
            this.inCombatStance = false;
            return;
        }

        const targetPos = this.shootTarget.entity.position;
        const dx = targetPos.x - playerPos.x;
        const dz = targetPos.z - playerPos.z;
        const distance = this.shootTarget.distance;

        // Set combat stance if enemy within 15 units
        this.inCombatStance = distance <= 15;

        // Calculate shooting range based on height advantage
        const shootingRange = this.calculateShootingRange(playerPos.y, targetPos.y);

        // Shoot at enemy every 6 seconds when within shooting range
        if (distance <= shootingRange && now - this.lastShootTime >= this.shootInterval) {
            this.lastShootTime = now;

            // Set shooting pause (1 second freeze)
            this.shootingPauseEndTime = now + 1000;

            // Stop player movement during shooting
            if (onStopMoving) {
                onStopMoving();
            }

            // Play shoot animation
            if (this.shootAction) {
                this.shootAction.reset();
                this.shootAction.play();
            }

            // Play rifle sound
            if (this.audioManager) {
                this.audioManager.playPositionalSound('rifle', this.playerObject);
            }

            // Calculate hit chance based on height advantage
            const hitChance = this.calculateHitChance(playerPos.y, targetPos.y);
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
            return;
        }

        const targetPos = this.shootTarget.entity.position;
        const dx = targetPos.x - playerPos.x;
        const dz = targetPos.z - playerPos.z;
        const distance = this.shootTarget.distance;

        // Set combat stance if enemy within 15 units
        this.inCombatStance = distance <= 15;

        // Calculate shooting range based on height advantage
        const shootingRange = this.calculateShootingRange(playerPos.y, targetPos.y);

        // Shoot at enemy every 6 seconds when within shooting range
        if (distance <= shootingRange && now - this.lastShootTime >= this.shootInterval) {
            this.shoot(playerPos, targetPos);
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
    shoot(playerPos, targetPos) {
        const now = Date.now();
        this.lastShootTime = now;

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

        // Calculate hit chance based on height advantage
        const hitChance = this.calculateHitChance(playerPos.y, targetPos.y);
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
        // Base shooting range is 10 units
        const BASE_RANGE = 10;
        const MAX_RANGE = 15;

        // Height advantage (positive if shooter is above target)
        const heightAdvantage = shooterY - targetY;

        // Range increases by half of height advantage
        const bonusRange = heightAdvantage * 0.5;

        // Calculate final range (capped at 15)
        const shootingRange = Math.min(MAX_RANGE, Math.max(BASE_RANGE, BASE_RANGE + bonusRange));

        return shootingRange;
    }

    /**
     * Calculate hit chance based on height advantage
     * @private
     */
    calculateHitChance(shooterY, targetY) {
        // Base hit chance is 20%
        const BASE_HIT_CHANCE = 0.2;
        const MAX_HIT_CHANCE = 0.8;

        // Height advantage (positive if shooter is above target)
        const heightAdvantage = shooterY - targetY;

        // Each unit of height advantage adds 20% to hit chance
        const bonusChance = heightAdvantage * 0.2;

        // Calculate final hit chance (capped at 80%)
        const hitChance = Math.min(MAX_HIT_CHANCE, Math.max(0, BASE_HIT_CHANCE + bonusChance));

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

        // Reset player rotation
        if (this.playerObject.children[0]) {
            this.playerObject.children[0].rotation.z = 0;
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
     * Get combat stance state
     * @returns {boolean}
     */
    getInCombatStance() {
        return this.inCombatStance;
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

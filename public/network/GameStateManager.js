/**
 * GameStateManager.js
 * Manages game state synchronization - NO network transport logic
 * Translates network messages into game state changes
 */

import * as THREE from 'three';
import { EventEmitter } from './EventEmitter.js';
import { modelManager, MODEL_CONFIG, objectPlacer } from '../objects.js';

export class GameStateManager extends EventEmitter {
    constructor() {
        super();

        // Reference to game objects (set externally)
        this.avatars = null;
        this.peerGameData = null;
        this.audioManager = null;
        this.game = null;

        // Queue for deaths that arrive before avatar is created
        this.pendingDeaths = new Map(); // peerId -> { timestamp }
    }

    /**
     * Set reference to avatars map
     * @param {Map} avatars - Map of peerId -> avatar object
     */
    setAvatars(avatars) {
        this.avatars = avatars;
    }

    /**
     * Set reference to peer game data
     * @param {Map} peerGameData - Map of peerId -> game state
     */
    setPeerGameData(peerGameData) {
        this.peerGameData = peerGameData;
    }

    /**
     * Set reference to audio manager
     * @param {AudioManager} audioManager
     */
    setAudioManager(audioManager) {
        this.audioManager = audioManager;
    }

    /**
     * Set reference to game instance
     * @param {Game} game
     */
    setGame(game) {
        this.game = game;
    }

    /**
     * Process a P2P message and update game state
     * @param {object} message - The message object
     * @param {string} fromPeer - ID of the peer who sent the message
     */
    processP2PMessage(message, fromPeer) {
        const peerData = this.peerGameData?.get(fromPeer);
        const avatar = this.avatars?.get(fromPeer);

        // Bandit messages should be processed even without full peer setup
        if (message.type === 'bandit_spawn') {
            if (this.game?.banditController) {
                this.game.banditController.handleSpawnMessage(message);
            }
            return;
        }
        if (message.type === 'bandit_death') {
            if (this.game?.banditController) {
                this.game.banditController.handleDeathMessage(message);
            }
            return;
        }
        if (message.type === 'bandit_sync') {
            if (this.game?.banditController && message.bandits) {
                this.game.banditController.syncBanditsFromPeer(message.bandits);
            }
            return;
        }
        if (message.type === 'bandit_state') {
            if (this.game?.banditController) {
                this.game.banditController.handleStateMessage(message);
            }
            return;
        }
        if (message.type === 'bandit_shoot') {
            if (this.game?.banditController) {
                this.game.banditController.handleShootMessage(message);
            }
            return;
        }
        if (message.type === 'bandit_kill_ack') {
            if (this.game?.banditController) {
                this.game.banditController.handleKillAck(message);
            }
            return;
        }

        // Deer P2P messages
        if (message.type === 'deer_spawn') {
            if (this.game?.deerController) {
                this.game.deerController.handleSpawnMessage(message);
            }
            return;
        }
        if (message.type === 'deer_state') {
            if (this.game?.deerController) {
                this.game.deerController.handleStateMessage(message);
            }
            return;
        }
        if (message.type === 'deer_sync') {
            if (this.game?.deerController && message.deer) {
                this.game.deerController.syncDeerFromPeer(message.deer);
            }
            return;
        }
        if (message.type === 'deer_death') {
            if (this.game?.deerController) {
                this.game.deerController.handleDeathMessage(message);
            }
            return;
        }
        if (message.type === 'deer_harvested') {
            if (this.game?.deerController) {
                this.game.deerController.handleHarvestMessage(message);
            }
            return;
        }
        if (message.type === 'deer_despawn') {
            if (this.game?.deerController) {
                this.game.deerController.handleDespawnMessage(message);
            }
            return;
        }

        // Brown Bear P2P messages
        if (message.type === 'brownbear_spawn') {
            if (this.game?.brownBearController) {
                this.game.brownBearController.handleSpawnMessage(message);
            }
            return;
        }
        if (message.type === 'brownbear_state') {
            if (this.game?.brownBearController) {
                this.game.brownBearController.handleStateMessage(message);
            }
            return;
        }
        if (message.type === 'brownbear_attack') {
            if (this.game?.brownBearController) {
                this.game.brownBearController.handleAttackMessage(message);
            }
            return;
        }
        if (message.type === 'brownbear_death') {
            if (this.game?.brownBearController) {
                this.game.brownBearController.handleDeathMessage(message);
            }
            return;
        }
        if (message.type === 'brownbear_harvested') {
            if (this.game?.brownBearController) {
                this.game.brownBearController.handleHarvestMessage(message);
            }
            return;
        }

        // Baker NPC P2P messages
        if (message.type === 'baker_spawn') {
            if (this.game?.bakerController) {
                this.game.bakerController.handleSpawnMessage(message);
            }
            return;
        }
        if (message.type === 'baker_state') {
            if (this.game?.bakerController) {
                this.game.bakerController.handleStateMessage(message);
            }
            return;
        }
        if (message.type === 'baker_despawn') {
            if (this.game?.bakerController) {
                this.game.bakerController.handleDespawnMessage(message);
            }
            return;
        }

        // Queue player deaths if avatar doesn't exist yet (due to P2P stagger delay)
        if (message.type === 'player_death' && !avatar) {
            this.pendingDeaths.set(fromPeer, { timestamp: Date.now() });
            console.log(`[Death] Queued death for peer ${fromPeer} (avatar not ready)`);
            return;
        }

        if (!peerData || !avatar) return;

        switch (message.type) {
            case 'player_pos':
                this.handlePlayerPos(message, fromPeer, peerData, avatar);
                break;

            case 'player_tick':
                this.handlePlayerTick(message, fromPeer, peerData, avatar);
                break;

            case 'player_harvest':
            case 'player_vines_gathering':
            case 'player_fishing':
                // All use the same harvest animation handler
                this.handlePlayerHarvest(message.payload, fromPeer, peerData, avatar);
                break;

            case 'player_sound':
                this.handlePlayerSound(message.payload, fromPeer, avatar);
                break;

            case 'ai_enemy_update':
                this.handleAIEnemyUpdate(message.payload, fromPeer, peerData);
                break;

            case 'ai_enemy_shoot':
                this.handleAIEnemyShoot(message.payload, fromPeer, peerData);
                break;

            case 'player_shoot':
                this.handlePlayerShoot(message.payload, fromPeer, avatar);
                break;

            case 'player_shoot_deer':
                this.handlePlayerShootDeer(message.payload, fromPeer, avatar);
                break;

            case 'player_shoot_player':
                this.handlePlayerShootPlayer(message.payload, fromPeer, avatar);
                break;

            case 'ai_control_handoff':
                this.handleAIControlHandoff(message.payload, fromPeer);
                break;

            case 'ai_enemy_spawn':
                this.handleAIEnemySpawn(message.payload, fromPeer, peerData);
                break;

            // ai_spawn and ai_vote are handled early (before peerData/avatar check)

            case 'ai_enemy_death':
                this.handleAIDeath(message.payload, fromPeer, peerData);
                break;

            case 'player_death':
                this.handlePlayerDeath(fromPeer, avatar);
                break;

            case 'player_respawn':
                this.handlePlayerRespawn(message.payload, fromPeer, avatar);
                break;

            case 'harvest_action':
                this.handleHarvestAction(message.payload, fromPeer, avatar);
                break;

            case 'combat_action':
                this.handleCombatAction(message.payload, fromPeer, avatar);
                break;

            case 'player_climb_start':
                this.handlePlayerClimbStart(message.payload, fromPeer, peerData, avatar);
                break;

            case 'player_climb_end':
                this.handlePlayerClimbEnd(message.payload, fromPeer, peerData, avatar);
                break;

            case 'mobile_entity_enter':
                this.handleMobileEntityEnter(message.payload, fromPeer, peerData, avatar);
                break;

            case 'mobile_entity_exit':
                this.handleMobileEntityExit(message.payload, fromPeer, peerData, avatar);
                break;

            case 'mobile_entity_sold': {
                const { entityId, entityType } = message.payload;
                this.handlePeerMobileEntitySold(fromPeer, entityId, entityType);
                break;
            }

            case 'mobile_entity_position':
                this.handleMobileEntityPosition(message.payload, fromPeer, peerData, avatar);
                break;

            case 'cart_attached':
                this.handleCartAttached(message.payload, fromPeer, peerData);
                break;

            case 'cart_released':
                this.handleCartReleased(message.payload, fromPeer, peerData);
                break;

            case 'cart_position':
                this.handleCartPosition(message.payload, fromPeer, peerData);
                break;

            case 'crate_loaded':
                this.handleCrateLoaded(message.payload, fromPeer, peerData);
                break;

            case 'crate_unloaded':
                this.handleCrateUnloaded(message.payload, fromPeer, peerData);
                break;

            case 'artillery_attached':
                this.handleArtilleryAttached(message.payload, fromPeer, peerData);
                break;

            case 'artillery_released':
                this.handleArtilleryReleased(message.payload, fromPeer, peerData);
                break;

            case 'artillery_position':
                this.handleArtilleryPosition(message.payload, fromPeer, peerData);
                break;

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

            case 'artillery_damage':
                this.handleArtilleryDamage(message.payload, fromPeer, peerData);
                break;
        }
    }

    /**
     * Handle player position update - store target for smooth movement
     * @private
     */
    handlePlayerPos(message, fromPeer, peerData, avatar) {
        const newPos = new THREE.Vector3().fromArray(message.p);

        // Store target position and timing
        peerData.targetPosition = newPos;
        peerData.targetRotation = message.r;
        peerData.lastUpdateTime = message.t;

        // Store dock state if provided
        if (message.d !== undefined) {
            peerData.onDock = message.d;
        }

        // Update chunk registry for spatial partitioning
        this.updatePeerChunkRegistry(fromPeer, peerData, newPos);
    }

    /**
     * Handle player tick (periodic sync) - same as position update
     * @private
     */
    handlePlayerTick(message, fromPeer, peerData, avatar) {
        const newPos = new THREE.Vector3().fromArray(message.p);

        peerData.targetPosition = newPos;
        peerData.lastUpdateTime = Date.now(); // Tick doesn't have timestamp, use receive time

        // Update dock state
        peerData.onDock = message.d || false;

        // Update hasRifle state (for combat stance animations)
        peerData.hasRifle = message.hr || false;

        // Store actual movement state from peer (for accurate animation sync)
        peerData.peerIsMoving = message.m || false;
        peerData.speedMultiplier = message.s || 1.0;

        // Update username and name tag if provided
        if (message.u && peerData.username !== message.u) {
            peerData.username = message.u;
            // Update name tag with new username
            if (this.game?.nameTagManager && avatar) {
                this.game.nameTagManager.registerEntity(`peer_${fromPeer}`, message.u, avatar);
            }
        }

        // Update faction and name tag color if provided
        if (message.f !== undefined && peerData.factionId !== message.f) {
            peerData.factionId = message.f;
            // Update name tag color based on enemy status
            if (this.game?.nameTagManager && this.game?.gameState) {
                const isEnemy = this.game.gameState.isEnemyFaction(message.f);
                this.game.nameTagManager.setEntityEnemy(`peer_${fromPeer}`, isEnemy);
            }
        }

        // Update chunk registry
        this.updatePeerChunkRegistry(fromPeer, peerData, newPos);
    }

    /**
     * Handle player harvest
     * @private
     */
    handlePlayerHarvest(payload, fromPeer, peerData, avatar) {
        // Store harvest state for this peer
        peerData.harvestState = {
            harvestType: payload.harvestType,
            startTime: payload.startTime,
            duration: payload.duration,
            endTime: payload.startTime + payload.duration
        };

        // Play chopping animation for peer avatar if available
        // Animation is stored in avatar.userData, not peerData
        if (avatar.userData.mixer && avatar.userData.choppingAction) {
            avatar.userData.choppingAction.reset();
            avatar.userData.choppingAction.play();
        }

        // Store reference to choppingAction in peerData for cleanup later
        peerData.choppingAction = avatar.userData.choppingAction;
    }

    /**
     * Handle player sound
     * @private
     */
    handlePlayerSound(payload, fromPeer, avatar) {
        // Play positional sound attached to peer's avatar
        if (this.audioManager && avatar) {
            this.audioManager.playPositionalSound(payload.soundType, avatar);
        }
    }

    /**
     * Handle AI enemy position update
     * @private
     */
    handleAIEnemyUpdate(payload, fromPeer, peerData) {
        // Create AI enemy if it doesn't exist yet
        if (!peerData.aiEnemy) {
            const aiEnemy = this.game.createPeerAIEnemy();
            if (aiEnemy) {
                // Initialize position directly for first time
                aiEnemy.position.fromArray(payload.position);
                this.game.scene.add(aiEnemy);
                peerData.aiEnemy = aiEnemy;
                peerData.aiEnemyMoving = false;
                peerData.aiEnemyTargetPosition = aiEnemy.position.clone();
                peerData.aiEnemyCatchingUp = false;
            }
        }

        // Update peer's AI enemy position (smooth interpolation)
        if (peerData.aiEnemy) {
            const receivedPosition = new THREE.Vector3().fromArray(payload.position);
            const distance = peerData.aiEnemy.position.distanceTo(receivedPosition);
            const CORRECTION_THRESHOLD = 0.3; // Units of desync before catch-up triggers

            if (distance > CORRECTION_THRESHOLD) {
                // Significant desync - use catch-up mode (2x speed)
                peerData.aiEnemyCatchingUp = true;
            } else {
                peerData.aiEnemyCatchingUp = false;
            }

            // Store target position for smooth interpolation
            peerData.aiEnemyTargetPosition = receivedPosition;
            peerData.aiEnemyMoving = payload.moving;
        }

        // Emit event
        this.emit('ai_enemy_sync', {
            peerId: fromPeer,
            position: payload.position,
            moving: payload.moving
        });
    }

    /**
     * Handle AI enemy shoot
     * @private
     */
    handleAIEnemyShoot(payload, fromPeer, peerData) {
        // Play rifle sound on peer's AI enemy
        if (peerData.aiEnemy && this.audioManager) {
            this.audioManager.playPositionalSound('rifle', peerData.aiEnemy);
        }

        // If the shot hit and this client is the target, apply death
        if (payload.isHit) {
            if (payload.targetIsLocalPlayer && this.game && !this.game.isDead) {
                this.game.killEntity(this.game.playerObject, false, false, 'Killed by bandit');
            }
        }
    }

    /**
     * Handle player shoot
     * @private
     */
    handlePlayerShoot(payload, fromPeer, avatar) {
        // Play rifle sound for peer's player
        if (avatar && this.audioManager) {
            this.audioManager.playPositionalSound('rifle', avatar);
        }

        // Play shoot animation and muzzle flash for peer's avatar
        if (this.game && this.game.avatarManager) {
            this.game.avatarManager.playShootAnimation(fromPeer);
        }

        // If the shot hit a bandit that THIS client controls, apply death
        if (payload.isHit && payload.tentId) {
            // Check if we're authority for this bandit
            if (this.game?.banditController?.isAuthority(payload.tentId)) {
                this.game.banditController.killEntity(payload.tentId, fromPeer);
            }
        }
    }

    /**
     * Handle player shooting at a deer
     * @private
     */
    handlePlayerShootDeer(payload, fromPeer, avatar) {
        // Play rifle sound for peer's player
        if (avatar && this.audioManager) {
            this.audioManager.playPositionalSound('rifle', avatar);
        }

        // Play shoot animation and muzzle flash for peer's avatar
        if (this.game && this.game.avatarManager) {
            this.game.avatarManager.playShootAnimation(fromPeer);
        }

        // If the shot hit and we're authority, apply death
        // FIX: Changed chunkKey to treeId (deer are keyed by treeId, not chunkKey)
        if (payload.isHit && payload.treeId) {
            if (this.game?.deerController?.isAuthority(payload.treeId)) {
                this.game.deerController.killDeer(payload.treeId, fromPeer);
            }
        }
    }

    /**
     * Handle player shooting at another player
     * @private
     */
    handlePlayerShootPlayer(payload, fromPeer, avatar) {
        // Play rifle sound for shooter
        if (avatar && this.audioManager) {
            this.audioManager.playPositionalSound('rifle', avatar);
        }

        // Play shoot animation and muzzle flash for shooter's avatar
        if (this.game?.avatarManager) {
            this.game.avatarManager.playShootAnimation(fromPeer);
        }

        // Check if WE are the target and got hit
        if (payload.targetPeerId === this.gameState.clientId && payload.isHit) {
            // We got shot - use existing death system
            if (this.game?.deathManager && this.game?.playerObject) {
                const shooterName = this.peerGameData?.get(fromPeer)?.username || 'Enemy player';
                this.game.deathManager.killEntity(
                    this.game.playerObject,
                    false,  // isAI
                    false,  // isPeer (we ARE the local player)
                    `Killed by ${shooterName}`
                );
            }
        }
    }

    /**
     * Handle AI control handoff
     * @private
     */
    handleAIControlHandoff(payload, fromPeer) {
        // Ignore stale messages (older than 3 seconds)
        if (Date.now() - payload.timestamp > 3000) {
            return;
        }

        // Update ownership
        const previousOwner = this.game.aiEnemyOwner;
        this.game.aiEnemyOwner = payload.newOwner;

        // If I'm the new owner, sync position to avoid jumps
        if (this.game.aiEnemyOwner === this.game.gameState.clientId && this.game.aiEnemy) {
            this.game.aiEnemy.position.fromArray(payload.position);
        }
    }

    /**
     * Handle AI enemy spawn
     * @private
     */
    handleAIEnemySpawn(payload, fromPeer, peerData) {
        // Mark tent as spawned by peer to prevent duplicate local spawns
        if (payload.tentId && this.game.aiEnemyManager) {
            this.game.aiEnemyManager.markTentSpawnedByPeer(payload.tentId);
        }

        // Create peer's AI enemy if it doesn't exist yet
        if (!peerData.aiEnemy) {
            const aiEnemy = this.game.createPeerAIEnemy();
            if (aiEnemy) {
                aiEnemy.position.fromArray(payload.position);
                this.game.scene.add(aiEnemy);
                peerData.aiEnemy = aiEnemy;
                peerData.aiEnemyMoving = false;
                peerData.aiEnemyTargetPosition = aiEnemy.position.clone();
            }
        }
    }

    /**
     * Handle harvest action (chopping, mining, etc.)
     * @private
     */
    handleHarvestAction(payload, fromPeer, avatar) {
        const peerData = this.peerGameData.get(fromPeer);
        if (!peerData) return;

        // Update harvest state
        peerData.harvestState = payload.action;

        // Play corresponding sound
        if (this.audioManager && payload.action) {
            let sound = null;
            if (payload.action === 'chopping') {
                sound = this.audioManager.playPositionalSound('axe', avatar);
            } else if (payload.action === 'sawing') {
                sound = this.audioManager.playPositionalSound('saw', avatar);
            } else if (payload.action === 'mining') {
                sound = this.audioManager.playPositionalSound('pickaxe', avatar);
            } else if (payload.action === 'chiseling') {
                sound = this.audioManager.playPositionalSound('chisel', avatar);
            } else if (payload.action === 'hammering') {
                sound = this.audioManager.playPositionalSound('hammer', avatar);
            }

            // Stop sound when action ends
            if (sound && payload.action === 'none') {
                sound.stop();
            }
        }

        // Handle animations if mixer exists
        if (peerData.animationMixer && avatar.userData.animations) {
            if (peerData.choppingAction) {
                peerData.choppingAction.stop();
                peerData.choppingAction = null;
            }

            if (payload.action === 'chopping' || payload.action === 'sawing' ||
                payload.action === 'mining' || payload.action === 'chiseling' ||
                payload.action === 'hammering') {
                const clip = avatar.userData.animations.chop;
                if (clip) {
                    peerData.choppingAction = peerData.animationMixer.clipAction(clip);
                    peerData.choppingAction.setLoop(THREE.LoopRepeat);
                    peerData.choppingAction.play();
                }
            }
        }

        // Emit event
        this.emit('harvest_action', { peerId: fromPeer, action: payload.action });
    }

    /**
     * Handle AI enemy death
     * @private
     */
    handleAIDeath(payload, fromPeer, peerData) {
        // Mark tent AI as dead to prevent respawn attempts
        if (payload.tentId && this.game.aiEnemyManager) {
            this.game.aiEnemyManager.markTentAIDead(payload.tentId);
        }

        // Notify bandit controller (handles cleanup for both authority and non-authority)
        if (payload.tentId && this.game?.banditController) {
            this.game.banditController.handleDeathMessage({
                tentId: payload.tentId,
                killedBy: fromPeer
            });
        }

        // Mark peer's AI visual as dead (if it exists and has valid state)
        if (peerData?.aiEnemy &&
            peerData.aiEnemy.position &&
            !peerData.aiEnemy.userData?.isDead &&
            this.game) {
            this.game.killEntity(peerData.aiEnemy, true, true);
        }

        // Emit event
        this.emit('ai_death', { peerId: fromPeer, tentId: payload.tentId });
    }

    /**
     * Handle player death
     * @private
     */
    handlePlayerDeath(fromPeer, avatar) {
        // Get peer data to check states
        const peerData = this.peerGameData.get(fromPeer);

        // If peer was piloting a mobile entity, handle cleanup FIRST
        if (peerData && peerData.mobileEntity) {
            const entityType = peerData.mobileEntity.entityType;

            // Stop animations
            if (entityType === 'horse') {
                if (peerData.mobileEntity.walkAction) {
                    peerData.mobileEntity.walkAction.stop();
                }
                if (peerData.mobileEntity.mixer) {
                    peerData.mobileEntity.mixer.stopAllAction();
                }
            }

            // Move avatar to ground position (from horse)
            // This will be overridden by the mobile_entity_exit handler's playerPosition
            // but serves as a fallback
            if (avatar && peerData.mobileEntity.mesh) {
                const entityPos = peerData.mobileEntity.mesh.position;
                avatar.position.set(entityPos.x, entityPos.y, entityPos.z);
            }

            // Clear occupancy so entity can be remounted (ISSUE-037 fix)
            if (peerData.mobileEntity.entityId && this.game?.mobileEntitySystem) {
                this.game.mobileEntitySystem.clearOccupied(peerData.mobileEntity.entityId);
            }

            console.log(`[Death] Peer ${fromPeer} died while piloting ${entityType}`);
        }

        // If peer is climbing, mark them to die after descent completes
        if (peerData && peerData.isClimbing) {
            console.log(`[Death] Peer ${fromPeer} died while climbing - will apply death after descent`);
            peerData.dieAfterDescent = true;
            peerData.pendingDeathAvatar = avatar;

            // Timeout: if climb_end doesn't arrive in 5s, apply death anyway
            setTimeout(() => {
                if (peerData.dieAfterDescent && peerData.pendingDeathAvatar) {
                    console.warn(`[Death] Timeout - applying deferred death for peer ${fromPeer}`);
                    peerData.dieAfterDescent = false;
                    const pendingAvatar = peerData.pendingDeathAvatar;
                    peerData.pendingDeathAvatar = null;
                    if (this.game && pendingAvatar && !pendingAvatar.userData.isDead) {
                        this.game.killEntity(pendingAvatar, false, true);
                        if (this.game.nameTagManager) {
                            this.game.nameTagManager.setEntityDead(`peer_${fromPeer}`);
                        }
                        this.emit('player_death', { peerId: fromPeer });
                    }
                }
            }, 5000);

            return; // Don't apply death yet - will happen after climb end
        }

        // Mark peer player as dead
        if (avatar && !avatar.userData.isDead && this.game) {
            this.game.killEntity(avatar, false, true);

            // Update name tag to show (DEAD)
            if (this.game.nameTagManager) {
                this.game.nameTagManager.setEntityDead(`peer_${fromPeer}`);
            }
        }

        // Emit event
        this.emit('player_death', { peerId: fromPeer });
    }

    /**
     * Handle player respawn
     * @private
     */
    handlePlayerRespawn(payload, fromPeer, avatar) {
        if (!avatar) return;

        // Reset death state
        avatar.userData.isDead = false;
        avatar.userData.deathStartTime = 0;

        // Hide rifle on respawn (will be shown again if peer enters combat with rifle)
        if (avatar.userData.rifle) {
            avatar.userData.rifle.visible = false;
        }

        // Stop combat animation if playing
        if (avatar.userData.combatAction) {
            avatar.userData.combatAction.stop();
            avatar.userData.combatAction.reset();
        }

        // Clear combat stance cache so it's recalculated fresh
        if (this.game?.avatarManager?.combatStanceCache) {
            this.game.avatarManager.combatStanceCache.delete(fromPeer);
        }

        // Reset peer state (will be updated by next sync messages)
        const peerData = this.peerGameData.get(fromPeer);
        if (peerData) {
            peerData.hasRifle = false;
            peerData.harvestState = null;      // Clear stale chopping state
            peerData.onDock = false;           // Clear dock state
            peerData.isClimbing = false;       // Clear climbing state
            peerData.climbingTargetPosition = null;
            peerData.mobileEntity = null;      // Clear any stale mobile entity reference
            peerData.isPiloting = false;
            peerData.lastUpdateTime = Date.now();

            // Set target position to respawn location
            if (payload.position) {
                if (!peerData.targetPosition) {
                    peerData.targetPosition = new THREE.Vector3();
                }
                peerData.targetPosition.fromArray(payload.position);
            }
        }

        // Stop chopping animation if playing
        if (avatar.userData.choppingAction) {
            avatar.userData.choppingAction.stop();
            avatar.userData.choppingAction.reset();
        }

        // Update name tag to remove (DEAD)
        if (this.game?.nameTagManager) {
            this.game.nameTagManager.setEntityAlive(`peer_${fromPeer}`);
        }

        // Reset mesh rotation to upright (death animation rotates the first child)
        if (avatar.children[0]) {
            avatar.children[0].rotation.set(0, 0, 0);
        }

        // Move to respawn position
        if (payload.position) {
            avatar.position.fromArray(payload.position);
        }

        // Restart idle/walk animation if available
        if (avatar.userData.walkAction) {
            avatar.userData.walkAction.reset();
            avatar.userData.walkAction.play();
        }

        // Emit event
        this.emit('player_respawn', { peerId: fromPeer });
    }

    /**
     * Handle combat action (shooting)
     * @private
     */
    handleCombatAction(payload, fromPeer, avatar) {
        if (payload.action === 'shoot' && this.audioManager) {
            // Play rifle sound at avatar position
            this.audioManager.playPositionalSound('rifle', avatar);
        }

        // Emit event
        this.emit('combat_action', { peerId: fromPeer, action: payload.action });
    }

    /**
     * Handle player climb start
     * @private
     */
    handlePlayerClimbStart(payload, fromPeer, peerData, avatar) {
        // Update peer climbing state
        peerData.isClimbing = true;
        peerData.climbingOutpostId = payload.outpostId;
        peerData.climbingStartTime = Date.now();

        // Mark outpost as occupied in game
        if (this.game && this.game.occupiedOutposts) {
            this.game.occupiedOutposts.set(payload.outpostId, fromPeer);
        }

        // Calculate target position (1.5 units above outpost center)
        if (payload.position) {
            const outpostPosition = new THREE.Vector3().fromArray(payload.position);
            peerData.climbingTargetPosition = outpostPosition.clone();
            peerData.climbingTargetPosition.y += 1.5;
        }

        // Emit event
        this.emit('player_climb_start', { peerId: fromPeer, outpostId: payload.outpostId });
    }

    /**
     * Handle player climb end
     * @private
     */
    handlePlayerClimbEnd(payload, fromPeer, peerData, avatar) {
        // Check if peer should die after descent
        const shouldDieAfterDescent = peerData.dieAfterDescent;
        const pendingDeathAvatar = peerData.pendingDeathAvatar;

        // Set peer to descending state (keep isClimbing true for now)
        peerData.isDescending = true;

        // Calculate descent target position (ground level)
        if (avatar && this.game && this.game.terrainGenerator) {
            const outpostPos = avatar.position.clone();
            const terrainHeight = this.game.terrainGenerator.getWorldHeight(outpostPos.x, outpostPos.z);
            peerData.climbingTargetPosition = new THREE.Vector3(
                outpostPos.x,
                terrainHeight + 0.03,
                outpostPos.z
            );
        }

        // Clear climbing state after a delay to ensure death message is processed if it arrives soon
        setTimeout(() => {
            if (!peerData) return; // Peer disconnected

            // Now clear climbing state
            peerData.isClimbing = false;
            peerData.isDescending = false;
            peerData.climbingOutpostId = null;
            peerData.climbingStartTime = null;
            peerData.climbingTargetPosition = null;

            // If peer was dying, apply death now that descent is complete
            if (shouldDieAfterDescent && pendingDeathAvatar && this.game) {
                console.log(`[Death] Peer ${fromPeer} descent complete - applying death now`);

                peerData.dieAfterDescent = false;
                peerData.pendingDeathAvatar = null;

                this.game.killEntity(pendingDeathAvatar, false, true);

                // Emit death event
                this.emit('player_death', { peerId: fromPeer });
            }
        }, 100); // Small delay to allow death message to be processed

        // Clear outpost occupancy in game
        if (this.game && this.game.occupiedOutposts) {
            this.game.occupiedOutposts.delete(payload.outpostId);
        }

        // Emit event
        this.emit('player_climb_end', { peerId: fromPeer, outpostId: payload.outpostId });
    }

    /**
     * Handle mobile entity enter (peer boards a boat/cart/horse)
     * @private
     */
    handleMobileEntityEnter(payload, fromPeer, peerData, avatar) {
        const entityType = payload.entityType || 'boat';

        // Store mobile entity state for peer
        peerData.mobileEntity = {
            entityId: payload.entityId,
            entityType: entityType,
            position: new THREE.Vector3().fromArray(payload.position),
            rotation: payload.rotation,
            targetPosition: new THREE.Vector3().fromArray(payload.position),
            targetRotation: payload.rotation,
            // Horse animation state
            mixer: null,
            walkAction: null,
            lastPosition: new THREE.Vector3().fromArray(payload.position),
            isMoving: false
        };
        peerData.isPiloting = true;

        // Mark entity as occupied in local tracking
        if (this.game && this.game.mobileEntitySystem) {
            this.game.mobileEntitySystem.setOccupied(payload.entityId, fromPeer);
        }

        // Create entity mesh for peer (since static object was removed from chunk)
        // FIX: Use objectPlacer.createInstance() to ensure correct SkeletonUtils cloning for horses
        // (standard .clone() doesn't work for SkinnedMesh with bones/skeleton)
        if (this.game && this.game.scene) {
            const entityMesh = objectPlacer.createInstance(
                entityType,
                peerData.mobileEntity.position,
                1.0, // Scale passed as 1.0, objectPlacer applies MODEL_CONFIG.baseScale
                peerData.mobileEntity.rotation,
                null // Scene param not used - we add to scene manually below
            );

            if (entityMesh) {
                // Set peer-specific userData
                entityMesh.userData.isPeerMobileEntity = true;
                entityMesh.userData.peerId = fromPeer;
                entityMesh.userData.objectId = `peer_${entityType}_${fromPeer}`;
                entityMesh.userData.entityType = entityType;

                // Store reference for updates and cleanup
                peerData.mobileEntity.mesh = entityMesh;

                // Add mesh to scene (objectPlacer.createInstance only returns mesh, doesn't add it)
                this.game.scene.add(entityMesh);

                // Hide the static entity from scene if it still exists
                // (we have our own peer-controlled mesh now)
                const existingStaticEntity = this.game?.objectRegistry?.get(payload.entityId);
                if (existingStaticEntity && existingStaticEntity.userData?.objectId === payload.entityId) {
                    existingStaticEntity.visible = false;
                    console.log(`[P2P] Hid static ${entityType} ${payload.entityId} - peer ${fromPeer} is now controlling it`);
                }

                // Entity-specific setup
                if (entityType === 'boat') {
                    // Flag for AnimationSystem to not override rotation (peer boats are rotated by AvatarManager)
                    entityMesh.userData.isPeerBoat = true;

                    // Register with animation system for wave bobbing
                    if (this.game.animationSystem) {
                        this.game.animationSystem.registerShip(entityMesh);
                    }
                } else if (entityType === 'horse') {
                    // Setup horse animation
                    this.setupPeerHorseAnimation(peerData, entityMesh);
                }

                console.log(`[P2P] Created peer ${entityType} mesh for ${fromPeer}`);
            } else {
                // Model not loaded or createInstance failed
                console.error(`[P2P] Failed to create ${entityType} mesh for peer ${fromPeer}`);
                peerData.mobileEntity.mesh = null;
            }
        } else {
            console.warn(`[P2P] Cannot create ${entityType} mesh - no scene available`);
            peerData.mobileEntity.mesh = null;
        }

        // Emit event for UI updates
        this.emit('mobile_entity_enter', { peerId: fromPeer, entityId: payload.entityId, entityType: entityType });

        // Clear regular walking target to prevent avatar from chasing
        // stale player_pos updates instead of following the horse
        peerData.targetPosition = null;
    }

    /**
     * Setup animation mixer and walk action for peer's horse
     * @private
     */
    setupPeerHorseAnimation(peerData, horseMesh) {
        // Try to get animations from mesh
        let animations = horseMesh.userData.animations ||
                         horseMesh.animations ||
                         [];

        // If no animations, try getting from original model
        if (animations.length === 0) {
            const originalGLTF = modelManager.getGLTF('horse');
            if (originalGLTF?.animations) {
                animations = originalGLTF.animations;
                horseMesh.animations = animations;
            }
        }

        if (animations.length === 0) {
            console.warn('[GameStateManager] No animations found for peer horse');
            return;
        }

        // Create mixer
        peerData.mobileEntity.mixer = new THREE.AnimationMixer(horseMesh);

        // Find walk animation
        const config = this.game?.mobileEntitySystem?.getConfig('horse') || {
            animationName: 'horse-walk',
            animationFallbackPatterns: ['walk', 'run', 'gallop', 'trot']
        };

        let walkClip = THREE.AnimationClip.findByName(animations, config.animationName);

        // Try fallbacks
        if (!walkClip && config.animationFallbackPatterns) {
            for (const pattern of config.animationFallbackPatterns) {
                walkClip = animations.find(clip =>
                    clip.name.toLowerCase().includes(pattern.toLowerCase())
                );
                if (walkClip) break;
            }
        }

        if (walkClip) {
            peerData.mobileEntity.walkAction = peerData.mobileEntity.mixer.clipAction(walkClip);
            peerData.mobileEntity.walkAction.setLoop(THREE.LoopRepeat);
        }
    }

    /**
     * Handle mobile entity exit (peer disembarks from boat/cart/horse)
     * @private
     */
    handleMobileEntityExit(payload, fromPeer, peerData, avatar) {
        if (!peerData.mobileEntity) return;

        const entityType = peerData.mobileEntity.entityType;
        const entityId = peerData.mobileEntity.entityId;
        const isDeathLoss = payload.isDeathLoss === true;

        // Entity-specific cleanup
        if (entityType === 'horse') {
            // Stop horse animation
            if (peerData.mobileEntity.walkAction) {
                peerData.mobileEntity.walkAction.stop();
            }
            if (peerData.mobileEntity.mixer) {
                peerData.mobileEntity.mixer.stopAllAction();
                peerData.mobileEntity.mixer = null;
            }
            peerData.mobileEntity.walkAction = null;
        } else if (entityType === 'boat') {
            // Unregister from animation system
            if (this.game?.animationSystem && peerData.mobileEntity.mesh) {
                this.game.animationSystem.unregister(peerData.mobileEntity.mesh.userData.objectId);
            }
        }

        // CRITICAL: Only remove mesh if this is a TRUE death loss (boats sink)
        // For horses on death: keep the mesh visible - server will broadcast object_added
        // For normal dismount: remove mesh - server will broadcast object_added with correct position
        if (isDeathLoss && entityType === 'boat') {
            // Remove mesh from scene (boat is lost/sinking)
            if (peerData.mobileEntity.mesh) {
                if (this.game?.scene) {
                    this.game.scene.remove(peerData.mobileEntity.mesh);
                }

                // Dispose geometry/materials
                peerData.mobileEntity.mesh.traverse((child) => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                });

                peerData.mobileEntity.mesh = null;
            }
        } else if (isDeathLoss && entityType === 'horse') {
            // Horse death: Keep mesh visible, server will sync it
            // Just update position and rotation to final location if provided
            if (peerData.mobileEntity.mesh && payload.position) {
                peerData.mobileEntity.mesh.position.fromArray(payload.position);
                if (payload.rotation !== undefined) {
                    peerData.mobileEntity.mesh.rotation.y = payload.rotation;
                }
            }
            // Don't dispose - the mesh stays in scene for other players to see/use
            // Server will broadcast object_added which may create a duplicate temporarily
            // but that's better than the horse disappearing
            console.log(`[P2P] Peer ${fromPeer} died on horse - keeping horse mesh visible`);
            peerData.mobileEntity.mesh = null; // Clear reference but don't dispose
        } else {
            // Normal dismount - remove peer's local copy
            // Server will broadcast object_added with correct position
            if (peerData.mobileEntity.mesh) {
                if (this.game?.scene) {
                    this.game.scene.remove(peerData.mobileEntity.mesh);
                }

                peerData.mobileEntity.mesh.traverse((child) => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                });

                peerData.mobileEntity.mesh = null;
            }
        }

        // Clear mobile entity state
        peerData.mobileEntity = null;
        peerData.isPiloting = false;

        // Clear entity occupancy in local tracking
        if (entityId && this.game && this.game.mobileEntitySystem) {
            this.game.mobileEntitySystem.clearOccupied(entityId);
        }

        // Move avatar to disembark position
        if (avatar && payload.playerPosition) {
            avatar.position.fromArray(payload.playerPosition);
        }

        // Emit event
        this.emit('mobile_entity_exit', { peerId: fromPeer, entityId: entityId, entityType: entityType });
    }

    /**
     * Handle peer selling their horse - remove mesh without re-adding static
     */
    handlePeerMobileEntitySold(peerId, entityId, entityType) {
        // Get peer data using existing pattern (peerGameData, NOT peerPlayers)
        const peerData = this.peerGameData.get(peerId);
        if (peerData?.mobileEntity) {
            // Stop any animations first
            if (peerData.mobileEntity.mixer) {
                peerData.mobileEntity.mixer.stopAllAction();
                peerData.mobileEntity.mixer = null;
            }
            if (peerData.mobileEntity.walkAction) {
                peerData.mobileEntity.walkAction.stop();
                peerData.mobileEntity.walkAction = null;
            }

            // Remove peer's mobile entity mesh
            if (peerData.mobileEntity.mesh) {
                this.game?.scene?.remove(peerData.mobileEntity.mesh);

                // Dispose geometry/materials
                peerData.mobileEntity.mesh.traverse((child) => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                });
            }

            // Clear occupancy tracking
            if (this.game?.mobileEntitySystem) {
                this.game.mobileEntitySystem.clearOccupied(entityId);
            }

            // Clear the mobile entity reference
            peerData.mobileEntity = null;
            peerData.isPiloting = false;
        }
        // Note: Don't re-add static horse - it was sold
        console.log(`[handlePeerMobileEntitySold] Peer ${peerId} sold ${entityType}`);
    }

    /**
     * Handle mobile entity position update (peer is piloting and moving)
     * @private
     */
    handleMobileEntityPosition(payload, fromPeer, peerData, avatar) {
        // Update mobile entity TARGET position/rotation for smooth lerping
        // Actual mesh updates happen in AvatarManager.update() each frame
        if (peerData.mobileEntity) {
            // Store previous position for movement detection
            if (!peerData.mobileEntity.lastPosition) {
                peerData.mobileEntity.lastPosition = new THREE.Vector3();
            }
            peerData.mobileEntity.lastPosition.copy(peerData.mobileEntity.targetPosition || peerData.mobileEntity.position);

            // Store targets instead of snapping - lerping happens in AvatarManager
            if (!peerData.mobileEntity.targetPosition) {
                peerData.mobileEntity.targetPosition = new THREE.Vector3();
            }
            peerData.mobileEntity.targetPosition.fromArray(payload.position);
            peerData.mobileEntity.targetRotation = payload.rotation;

            // Also update the logical position for spatial tracking
            peerData.mobileEntity.position.fromArray(payload.position);
            peerData.mobileEntity.rotation = payload.rotation;

            // Detect if moving (for horse animation)
            const distance = peerData.mobileEntity.targetPosition.distanceTo(peerData.mobileEntity.lastPosition);
            peerData.mobileEntity.isMoving = distance > 0.01;
        }

        // Update peer's tracked position (for spatial partitioning)
        if (peerData) {
            const newPos = new THREE.Vector3().fromArray(payload.position);
            peerData.targetPosition = newPos;
            this.updatePeerChunkRegistry(fromPeer, peerData, newPos);
        }
    }

    /**
     * Handle cart attached by peer (peer starts towing a cart)
     * @private
     */
    handleCartAttached(payload, fromPeer, peerData) {
        const { cartId, position, rotation } = payload;

        // Store cart state for peer
        peerData.towedCart = {
            cartId: cartId,
            position: new THREE.Vector3().fromArray(position),
            rotation: rotation,
            targetPosition: new THREE.Vector3().fromArray(position),
            targetRotation: rotation,
            mesh: null,
            originalCartId: cartId  // Track original ID for reference
        };

        // Mark cart as occupied
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.setOccupied(cartId, fromPeer);
        }

        // ALWAYS create a new peer-controlled cart mesh
        // This avoids race conditions where the existing cart mesh could be removed/disposed
        // by a later object_removed message
        if (this.game?.scene) {
            const cartModel = modelManager.getModel('cart');
            if (cartModel) {
                const cartMesh = cartModel.clone();
                cartMesh.position.copy(peerData.towedCart.position);
                cartMesh.rotation.y = rotation;

                const modelConfig = MODEL_CONFIG['cart'];
                const baseScale = modelConfig?.baseScale || 1.0;
                cartMesh.scale.setScalar(baseScale);

                cartMesh.userData.isPeerCart = true;
                cartMesh.userData.peerId = fromPeer;
                cartMesh.userData.objectId = `peer_cart_${fromPeer}`;

                peerData.towedCart.mesh = cartMesh;
                this.game.scene.add(cartMesh);

                console.log(`[P2P] Created peer cart mesh for ${fromPeer}, cart ${cartId}`);
            } else {
                console.warn(`[P2P] Failed to create cart mesh - model not loaded`);
            }
        } else {
            console.warn(`[P2P] Cannot create cart mesh - no scene available`);
        }

        // Hide the static cart from scene if it still exists (we have our own peer mesh now)
        const existingStaticCart = this.game?.objectRegistry?.get(cartId);
        if (existingStaticCart && existingStaticCart.userData?.objectId === cartId) {
            // Don't dispose - just hide. Server's object_removed will handle full cleanup
            // But we need to ensure it doesn't show up alongside the peer mesh
            existingStaticCart.visible = false;
        }

        console.log(`[P2P] Peer ${fromPeer} attached cart ${cartId}`);
    }

    /**
     * Handle cart released by peer (peer stops towing)
     * @private
     */
    handleCartReleased(payload, fromPeer, peerData) {
        const { cartId, position, rotation } = payload;

        // Clear occupied status
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.clearOccupied(cartId);
        }

        // Clean up peer cart mesh
        if (peerData.towedCart?.mesh) {
            const cartMesh = peerData.towedCart.mesh;

            // Always remove peer-created cart meshes (server will send object_added)
            if (cartMesh.userData?.isPeerCart) {
                this.game?.scene?.remove(cartMesh);

                // Dispose the mesh
                cartMesh.traverse((child) => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                });
                console.log(`[P2P] Removed peer cart mesh for ${fromPeer}`);
            }
        }

        // Also clear any loaded crate on this cart
        if (peerData.loadedCrate) {
            if (this.game?.mobileEntitySystem) {
                this.game.mobileEntitySystem.clearOccupied(peerData.loadedCrate.crateId);
            }
            // If it was a peer crate, dispose it
            if (peerData.loadedCrate.mesh?.userData?.isPeerCrate) {
                peerData.loadedCrate.mesh.traverse((child) => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                });
            }
            peerData.loadedCrate = null;
        }

        // Clear peer's cart state
        peerData.towedCart = null;

        console.log(`[P2P] Peer ${fromPeer} released cart ${cartId}`);
    }

    /**
     * Handle cart position update (peer is towing cart and moving)
     * @private
     */
    handleCartPosition(payload, fromPeer, peerData) {
        const { cartId, position, rotation } = payload;

        if (peerData.towedCart && peerData.towedCart.cartId === cartId) {
            // Update target for smooth lerping
            peerData.towedCart.targetPosition.fromArray(position);
            peerData.towedCart.targetRotation = rotation;

            // Also update logical position
            peerData.towedCart.position.fromArray(position);
            peerData.towedCart.rotation = rotation;

            // Update mesh position with lerp (smooth interpolation)
            if (peerData.towedCart.mesh) {
                peerData.towedCart.mesh.position.lerp(peerData.towedCart.targetPosition, 0.2);
                peerData.towedCart.mesh.rotation.y = rotation;
            }
        }
    }

    /**
     * Handle artillery attached by peer (peer starts towing artillery)
     * @private
     */
    handleArtilleryAttached(payload, fromPeer, peerData) {
        const { artilleryId, position, rotation } = payload;

        // Store artillery state for peer
        peerData.towedArtillery = {
            artilleryId: artilleryId,
            position: new THREE.Vector3().fromArray(position),
            rotation: rotation,
            targetPosition: new THREE.Vector3().fromArray(position),
            targetRotation: rotation,
            mesh: null,
            originalArtilleryId: artilleryId
        };

        // Mark artillery as occupied
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.setOccupied(artilleryId, fromPeer);
        }

        // Create a new peer-controlled artillery mesh
        if (this.game?.scene) {
            const artilleryModel = modelManager.getModel('artillery');
            if (artilleryModel) {
                const artilleryMesh = artilleryModel.clone();
                artilleryMesh.position.copy(peerData.towedArtillery.position);
                artilleryMesh.rotation.y = rotation;

                const modelConfig = MODEL_CONFIG['artillery'];
                const baseScale = modelConfig?.baseScale || 1.0;
                artilleryMesh.scale.setScalar(baseScale);

                artilleryMesh.userData.isPeerArtillery = true;
                artilleryMesh.userData.peerId = fromPeer;
                artilleryMesh.userData.objectId = `peer_artillery_${fromPeer}`;

                peerData.towedArtillery.mesh = artilleryMesh;
                this.game.scene.add(artilleryMesh);

                console.log(`[P2P] Created peer artillery mesh for ${fromPeer}, artillery ${artilleryId}`);
            } else {
                console.warn(`[P2P] Failed to create artillery mesh - model not loaded`);
            }
        } else {
            console.warn(`[P2P] Cannot create artillery mesh - no scene available`);
        }

        // Hide the static artillery from scene if it still exists
        const existingStaticArtillery = this.game?.objectRegistry?.get(artilleryId);
        if (existingStaticArtillery && existingStaticArtillery.userData?.objectId === artilleryId) {
            existingStaticArtillery.visible = false;
        }

        console.log(`[P2P] Peer ${fromPeer} attached artillery ${artilleryId}`);
    }

    /**
     * Handle artillery released by peer (peer stops towing)
     * @private
     */
    handleArtilleryReleased(payload, fromPeer, peerData) {
        const { artilleryId, position, rotation } = payload;

        // Clear occupied status
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.clearOccupied(artilleryId);
        }

        // Clean up peer artillery mesh
        if (peerData.towedArtillery?.mesh) {
            const artilleryMesh = peerData.towedArtillery.mesh;

            if (artilleryMesh.userData?.isPeerArtillery) {
                this.game?.scene?.remove(artilleryMesh);

                // Dispose the mesh
                artilleryMesh.traverse((child) => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                });
                console.log(`[P2P] Removed peer artillery mesh for ${fromPeer}`);
            }
        }

        // Clear peer's artillery state
        peerData.towedArtillery = null;

        console.log(`[P2P] Peer ${fromPeer} released artillery ${artilleryId}`);
    }

    /**
     * Handle artillery position update (peer is towing artillery and moving)
     * @private
     */
    handleArtilleryPosition(payload, fromPeer, peerData) {
        const { artilleryId, position, rotation } = payload;

        if (peerData.towedArtillery && peerData.towedArtillery.artilleryId === artilleryId) {
            // Update target for smooth lerping
            peerData.towedArtillery.targetPosition.fromArray(position);
            peerData.towedArtillery.targetRotation = rotation;

            // Also update logical position
            peerData.towedArtillery.position.fromArray(position);
            peerData.towedArtillery.rotation = rotation;

            // Update mesh position with lerp (smooth interpolation)
            if (peerData.towedArtillery.mesh) {
                peerData.towedArtillery.mesh.position.lerp(peerData.towedArtillery.targetPosition, 0.2);
                peerData.towedArtillery.mesh.rotation.y = rotation;
            }
        }
    }

    /**
     * Handle artillery manned by peer (peer starts manning artillery to fire)
     * @private
     */
    handleArtilleryManned(payload, fromPeer, peerData) {
        const { artilleryId, heading } = payload;

        // Mark artillery as occupied
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.setOccupied(artilleryId, fromPeer);
        }

        // Store manning state for peer
        peerData.mannedArtillery = {
            artilleryId,
            heading,
            mesh: this.game?.objectRegistry?.get(artilleryId) || null
        };

        console.log(`[P2P] Peer ${fromPeer} manned artillery ${artilleryId}`);
    }

    /**
     * Handle artillery unmanned by peer (peer stops manning artillery)
     * @private
     */
    handleArtilleryUnmanned(payload, fromPeer, peerData) {
        const { artilleryId, rotation } = payload;

        // Clear occupied status
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.clearOccupied(artilleryId);
        }

        // Update artillery rotation
        if (peerData.mannedArtillery?.mesh) {
            peerData.mannedArtillery.mesh.rotation.y = rotation;
        }

        // Clear manning state
        peerData.mannedArtillery = null;

        console.log(`[P2P] Peer ${fromPeer} unmanned artillery ${artilleryId}`);
    }

    /**
     * Handle artillery aim (peer rotating artillery while manning)
     * @private
     */
    handleArtilleryAim(payload, fromPeer, peerData) {
        const { artilleryId, heading } = payload;

        if (peerData.mannedArtillery && peerData.mannedArtillery.artilleryId === artilleryId) {
            peerData.mannedArtillery.heading = heading;

            // Update mesh rotation
            if (peerData.mannedArtillery.mesh) {
                peerData.mannedArtillery.mesh.rotation.y = heading;
            }
        }
    }

    /**
     * Handle artillery fire (peer fired artillery)
     * @private
     */
    handleArtilleryFire(payload, fromPeer, peerData) {
        const { artilleryId, heading, impactPos, isHit, targetType, structureId } = payload;

        // Find artillery mesh
        const artilleryMesh = peerData.mannedArtillery?.mesh || this.game?.objectRegistry?.get(artilleryId);

        if (artilleryMesh && this.game?.effectManager) {
            // Calculate barrel position
            const barrelOffset = CONFIG?.ARTILLERY_COMBAT?.BARREL_OFFSET || { x: 0, y: 0.6, z: 1.2 };
            const barrelPos = {
                x: artilleryMesh.position.x + Math.sin(heading) * barrelOffset.z,
                y: artilleryMesh.position.y + barrelOffset.y,
                z: artilleryMesh.position.z + Math.cos(heading) * barrelOffset.z
            };

            // Spawn effects
            this.game.effectManager.spawnArtilleryMuzzleFlash(barrelPos);
            this.game.effectManager.spawnArtillerySmoke(barrelPos);

            // Spawn impact effect
            if (impactPos) {
                const impact = {
                    x: impactPos[0],
                    y: impactPos[1],
                    z: impactPos[2]
                };
                this.game.effectManager.spawnArtilleryImpact(impact, isHit);
            }

            // Play artillery sound
            if (this.game?.audioManager) {
                this.game.audioManager.playPositionalSound('artillery', artilleryMesh);
            }
        }

        const targetInfo = targetType === 'structure' ? ` (structure: ${structureId})` : (targetType ? ` (${targetType})` : '');
        console.log(`[P2P] Peer ${fromPeer} fired artillery at heading ${heading?.toFixed(2)}${targetInfo}`);
    }

    /**
     * Handle artillery damage (peer's artillery hit local player)
     * @private
     */
    handleArtilleryDamage(payload, fromPeer, peerData) {
        const { targetPeerId, damage, shooterPosition } = payload;

        // Check if this message is targeting local player
        if (targetPeerId !== this.gameState?.clientId) return;

        // Apply damage to local player (instant kill from artillery)
        if (this.game?.deathManager) {
            this.game.deathManager.handleEntityDeath(
                this.game.playerObject,
                false,  // isAI
                false,  // isPeer
                'artillery'  // death reason
            );
        }

        console.log(`[P2P] Local player killed by artillery from peer ${fromPeer}`);
    }

    /**
     * Handle crate loaded by peer (peer loads a crate onto their cart)
     * @private
     */
    handleCrateLoaded(payload, fromPeer, peerData) {
        const { crateId, cartId, inventory } = payload;

        // Mark crate as occupied (being carried)
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.setOccupied(crateId, fromPeer);
        }

        // Store crate state for peer
        if (!peerData.loadedCrate) {
            peerData.loadedCrate = {};
        }
        peerData.loadedCrate.crateId = crateId;
        peerData.loadedCrate.cartId = cartId;
        peerData.loadedCrate.inventory = inventory;

        // Try to find existing crate mesh
        let crateMesh = this.game?.objectRegistry?.get(crateId);

        // If existing crate found, reparent it to the cart
        if (crateMesh && peerData.towedCart?.mesh) {
            if (crateMesh.parent) {
                crateMesh.parent.remove(crateMesh);
            }
            peerData.towedCart.mesh.add(crateMesh);
            crateMesh.position.set(0, 0.2, -0.1);
            crateMesh.rotation.set(0, 0, 0);
            peerData.loadedCrate.mesh = crateMesh;
            console.log(`[P2P] Peer ${fromPeer} loaded existing crate ${crateId} onto cart ${cartId}`);
        }
        // Fallback: Create a new peer crate mesh if not found (race condition case)
        else if (peerData.towedCart?.mesh && this.game?.scene) {
            const crateModel = modelManager.getModel('crate');
            if (crateModel) {
                crateMesh = crateModel.clone();

                // Set up as peer-controlled crate
                crateMesh.userData.isPeerCrate = true;
                crateMesh.userData.peerId = fromPeer;
                crateMesh.userData.objectId = `peer_crate_${fromPeer}`;

                // Apply MODEL_CONFIG scale if available
                const modelConfig = MODEL_CONFIG['crate'];
                const baseScale = modelConfig?.baseScale || 1.0;
                crateMesh.scale.setScalar(baseScale);

                // Parent to cart
                peerData.towedCart.mesh.add(crateMesh);
                crateMesh.position.set(0, 0.2, -0.1);
                crateMesh.rotation.set(0, 0, 0);
                peerData.loadedCrate.mesh = crateMesh;

                console.log(`[P2P] Created peer crate mesh for ${fromPeer}, crate ${crateId}`);
            } else {
                console.warn(`[P2P] Failed to create crate mesh - model not loaded`);
            }
        } else {
            console.warn(`[P2P] Cannot visualize crate ${crateId} - no cart mesh or scene available`);
        }
    }

    /**
     * Handle crate unloaded by peer (peer unloads crate from cart)
     * @private
     */
    handleCrateUnloaded(payload, fromPeer, peerData) {
        const { crateId, position, rotation, inventory } = payload;

        // Clear occupied status
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.clearOccupied(crateId);
        }

        // Unparent crate from cart
        if (peerData.loadedCrate?.mesh) {
            const crate = peerData.loadedCrate.mesh;
            if (crate.parent) {
                crate.parent.remove(crate);
            }

            // If this was a peer-created crate mesh, remove it from scene
            // Server will broadcast object_added to create the real crate
            if (crate.userData?.isPeerCrate) {
                // Dispose the temporary peer mesh
                crate.traverse((child) => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                });
                console.log(`[P2P] Removed peer crate mesh for ${fromPeer}`);
            } else {
                // This was an existing crate - place it back in scene
                this.game?.scene?.add(crate);
                crate.position.fromArray(position);
                crate.rotation.y = rotation;
            }
        }

        // Clear peer's crate state
        peerData.loadedCrate = null;

        console.log(`[P2P] Peer ${fromPeer} unloaded crate ${crateId}`);
    }

    // ==========================================
    // PLAYER SPATIAL PARTITIONING
    // ==========================================

    /**
     * Update peer's chunk in the spatial registry for O(local density) lookups
     * @param {string} peerId - The peer's ID
     * @param {object} peerData - The peer's game data
     * @param {THREE.Vector3} position - The peer's new position
     * @private
     */
    updatePeerChunkRegistry(peerId, peerData, position) {
        if (!this.game || !this.game.gameState) return;

        const CHUNK_SIZE = 50; // Match terrain chunk size
        const newChunkX = Math.floor(position.x / CHUNK_SIZE);
        const newChunkZ = Math.floor(position.z / CHUNK_SIZE);
        const newChunkKey = `${newChunkX},${newChunkZ}`;

        // Check if chunk changed
        const oldChunkKey = peerData.currentChunkKey || null;
        if (oldChunkKey === newChunkKey) return;

        // Update peer's tracked chunk
        peerData.currentChunkKey = newChunkKey;

        // Update the spatial registry
        this.game.gameState.updatePlayerChunk(peerId, oldChunkKey, newChunkKey);

        // Handle peer chunk changes for AI authority
        if (oldChunkKey) {
            // Peer moved between chunks - check if they left any AI's authority region
            if (this.game?.banditController) {
                this.game.banditController.onPeerChunkChanged(peerId, oldChunkKey, newChunkKey);
            }
            if (this.game?.deerController) {
                this.game.deerController.onPeerChunkChanged(peerId, oldChunkKey, newChunkKey);
            }
        } else {
            // New peer (first position received) - recalculate authority for nearby entities
            if (this.game?.banditController) {
                this.game.banditController.onPeerJoinedChunk(peerId, newChunkKey);
            }
            if (this.game?.deerController) {
                this.game.deerController.onPeerJoinedChunk(peerId, newChunkKey);
            }
        }
    }

    /**
     * Remove peer from chunk registry when they disconnect
     * @param {string} peerId - The peer's ID
     * @param {object} peerData - The peer's game data
     */
    removePeerFromChunkRegistry(peerId, peerData) {
        if (!this.game || !this.game.gameState) return;

        if (peerData.currentChunkKey) {
            this.game.gameState.removePlayerFromRegistry(peerId, peerData.currentChunkKey);
            peerData.currentChunkKey = null;
        }
    }
}

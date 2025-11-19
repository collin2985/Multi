/**
 * GameStateManager.js
 * Manages game state synchronization - NO network transport logic
 * Translates network messages into game state changes
 */

import * as THREE from 'three';
import { EventEmitter } from './EventEmitter.js';

export class GameStateManager extends EventEmitter {
    constructor() {
        super();

        // Reference to game objects (set externally)
        this.avatars = null;
        this.peerGameData = null;
        this.audioManager = null;
        this.game = null;
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

        if (!peerData || !avatar) return;

        switch (message.type) {
            case 'player_move':
                this.handlePlayerMove(message.payload, fromPeer, peerData, avatar);
                break;

            case 'player_sync':
                this.handlePlayerSync(message.payload, fromPeer, peerData, avatar);
                break;

            case 'player_harvest':
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

            case 'ai_control_handoff':
                this.handleAIControlHandoff(message.payload, fromPeer);
                break;

            case 'ai_enemy_spawn':
                this.handleAIEnemySpawn(message.payload, fromPeer, peerData);
                break;

            case 'ai_enemy_death':
                this.handleAIDeath(message.payload, fromPeer, peerData);
                break;

            case 'player_death':
                this.handlePlayerDeath(fromPeer, avatar);
                break;

            case 'harvest_action':
                this.handleHarvestAction(message.payload, fromPeer, avatar);
                break;

            case 'combat_action':
                this.handleCombatAction(message.payload, fromPeer, avatar);
                break;
        }
    }

    /**
     * Handle player move
     * @private
     */
    handlePlayerMove(payload, fromPeer, peerData, avatar) {
        avatar.position.fromArray(payload.start);
        peerData.targetPosition = new THREE.Vector3().fromArray(payload.target);
        peerData.moveStartTime = performance.now();
    }

    /**
     * Handle player position sync
     * @private
     */
    handlePlayerSync(payload, fromPeer, peerData, avatar) {
        avatar.position.fromArray(payload.position);
        if (payload.target) {
            peerData.targetPosition = new THREE.Vector3().fromArray(payload.target);
            peerData.moveStartTime = performance.now();
        } else {
            // No target means player has stopped (e.g., blocked by structure)
            peerData.targetPosition = null;
            avatar.userData.isMoving = false;
        }

        // Emit event
        this.emit('player_sync', {
            peerId: fromPeer,
            position: payload.position,
            target: payload.target
        });
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
        if (peerData.animationMixer && peerData.choppingAction) {
            peerData.choppingAction.reset();
            peerData.choppingAction.play();
        }
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
            }
        }

        // Update peer's AI enemy position (smooth interpolation)
        if (peerData.aiEnemy) {
            // Store target position for smooth interpolation
            peerData.aiEnemyTargetPosition = new THREE.Vector3().fromArray(payload.position);
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
                this.game.killEntity(this.game.playerObject, false, false);
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

        // If the shot hit and this client's AI is the target, apply death
        if (payload.isHit) {
            if (payload.targetIsLocalAI && this.game && !this.game.aiEnemyIsDead) {
                this.game.killEntity(this.game.aiEnemy, true, false);
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

        // Mark peer's AI as dead
        if (peerData.aiEnemy && !peerData.aiEnemy.userData.isDead && this.game) {
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
        // Mark peer player as dead
        if (avatar && !avatar.userData.isDead && this.game) {
            this.game.killEntity(avatar, false, true);
        }

        // Emit event
        this.emit('player_death', { peerId: fromPeer });
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
}

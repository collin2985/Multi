/**
 * GameStateManager.js
 * Manages game state synchronization - NO network transport logic
 * Translates network messages into game state changes
 */

import * as THREE from 'three';
import { EventEmitter } from './EventEmitter.js';
import { modelManager, MODEL_CONFIG, objectPlacer } from '../objects.js';
import { CONFIG } from '../config.js';
import ChunkCoordinates from '../core/ChunkCoordinates.js';

export class GameStateManager extends EventEmitter {
    constructor() {
        super();

        // Reference to game objects (set externally)
        this.avatars = null;
        this.peerGameData = null;
        this.audioManager = null;
        this.game = null;
        this.networkManager = null;

        // Queue for deaths that arrive before avatar is created
        this.pendingDeaths = new Map(); // peerId -> { timestamp }

        // Track active peer boats for collision detection (peerId -> { entityType, speed })
        this.activePeerBoats = new Map();
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
     * Set reference to network manager
     * Used for marking expected disconnects on death/respawn
     * @param {NetworkManager} networkManager
     */
    setNetworkManager(networkManager) {
        this.networkManager = networkManager;
    }

    /**
     * Get peer boat info by peerId (for collision hierarchy check)
     * @param {string} peerId
     * @returns {object|null} - { entityType, speed } or null
     */
    getPeerBoatInfo(peerId) {
        return this.activePeerBoats.get(peerId) || null;
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
        if (message.type === 'brownbear_sync') {
            if (this.game?.brownBearController && message.bears) {
                this.game.brownBearController.syncBrownBearsFromPeer(message.bears);
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
        if (message.type === 'baker_sync') {
            if (this.game?.bakerController && message.bakers) {
                this.game.bakerController.syncBakersFromPeer(message.bakers);
            }
            return;
        }

        // Gardener NPC P2P messages
        if (message.type === 'gardener_spawn') {
            if (this.game?.gardenerController) {
                this.game.gardenerController.handleSpawnMessage(message);
            }
            return;
        }
        if (message.type === 'gardener_state') {
            if (this.game?.gardenerController) {
                this.game.gardenerController.handleStateMessage(message);
            }
            return;
        }
        if (message.type === 'gardener_despawn') {
            if (this.game?.gardenerController) {
                this.game.gardenerController.handleDespawnMessage(message);
            }
            return;
        }
        if (message.type === 'gardener_sync') {
            if (this.game?.gardenerController && message.gardeners) {
                this.game.gardenerController.syncGardenersFromPeer(message.gardeners);
            }
            return;
        }

        // Woodcutter NPC P2P messages
        if (message.type === 'woodcutter_spawn') {
            if (this.game?.woodcutterController) {
                this.game.woodcutterController.handleSpawnMessage(message);
            }
            return;
        }
        if (message.type === 'woodcutter_state') {
            if (this.game?.woodcutterController) {
                this.game.woodcutterController.handleStateMessage(message);
            }
            return;
        }
        if (message.type === 'woodcutter_despawn') {
            if (this.game?.woodcutterController) {
                this.game.woodcutterController.handleDespawnMessage(message);
            }
            return;
        }
        if (message.type === 'woodcutter_sync') {
            if (this.game?.woodcutterController && message.woodcutters) {
                this.game.woodcutterController.syncWoodcuttersFromPeer(message.woodcutters, fromPeer);
            }
            return;
        }
        if (message.type === 'woodcutter_action') {
            // Woodcutter action sounds/animations (cutting tree, processing log)
            // Can be handled by audio system if needed
            return;
        }

        // Miner NPC P2P messages
        if (message.type === 'miner_spawn') {
            if (this.game?.minerController) {
                this.game.minerController.handleSpawnMessage(message);
            }
            return;
        }
        if (message.type === 'miner_state') {
            if (this.game?.minerController) {
                this.game.minerController.handleStateMessage(message);
            }
            return;
        }
        if (message.type === 'miner_despawn') {
            if (this.game?.minerController) {
                this.game.minerController.handleDespawnMessage(message);
            }
            return;
        }
        if (message.type === 'miner_sync') {
            if (this.game?.minerController && message.miners) {
                this.game.minerController.syncMinersFromPeer(message.miners, fromPeer);
            }
            return;
        }
        if (message.type === 'miner_action') {
            // Miner action sounds/animations (mining rock)
            // Can be handled by audio system if needed
            return;
        }

        // StoneMason NPC P2P messages
        if (message.type === 'stonemason_spawn') {
            if (this.game?.stoneMasonController) {
                this.game.stoneMasonController.handleSpawnMessage(message);
            }
            return;
        }
        if (message.type === 'stonemason_state') {
            if (this.game?.stoneMasonController) {
                this.game.stoneMasonController.handleStateMessage(message);
            }
            return;
        }
        if (message.type === 'stonemason_despawn') {
            if (this.game?.stoneMasonController) {
                this.game.stoneMasonController.handleDespawnMessage(message);
            }
            return;
        }
        if (message.type === 'stonemason_sync') {
            if (this.game?.stoneMasonController && message.stonemasons) {
                this.game.stoneMasonController.syncStoneMasonsFromPeer(message.stonemasons, fromPeer);
            }
            return;
        }

        // Blacksmith NPC P2P messages
        if (message.type === 'blacksmith_spawn') {
            if (this.game?.blacksmithController) {
                this.game.blacksmithController.handleSpawnMessage(message);
            }
            return;
        }
        if (message.type === 'blacksmith_state') {
            if (this.game?.blacksmithController) {
                this.game.blacksmithController.handleStateMessage(message);
            }
            return;
        }
        if (message.type === 'blacksmith_despawn') {
            if (this.game?.blacksmithController) {
                this.game.blacksmithController.handleDespawnMessage(message);
            }
            return;
        }
        if (message.type === 'blacksmith_sync') {
            if (this.game?.blacksmithController && message.blacksmiths) {
                this.game.blacksmithController.syncBlacksmithsFromPeer(message.blacksmiths, fromPeer);
            }
            return;
        }

        // IronWorker NPC P2P messages
        if (message.type === 'ironworker_spawn') {
            if (this.game?.ironWorkerController) {
                this.game.ironWorkerController.handleSpawnMessage(message);
            }
            return;
        }
        if (message.type === 'ironworker_state') {
            if (this.game?.ironWorkerController) {
                this.game.ironWorkerController.handleStateMessage(message);
            }
            return;
        }
        if (message.type === 'ironworker_despawn') {
            if (this.game?.ironWorkerController) {
                this.game.ironWorkerController.handleDespawnMessage(message);
            }
            return;
        }
        if (message.type === 'ironworker_sync') {
            if (this.game?.ironWorkerController && message.ironworkers) {
                this.game.ironWorkerController.syncIronWorkersFromPeer(message.ironworkers, fromPeer);
            }
            return;
        }

        // TileWorker NPC P2P messages
        if (message.type === 'tileworker_spawn') {
            if (this.game?.tileWorkerController) {
                this.game.tileWorkerController.handleSpawnMessage(message);
            }
            return;
        }
        if (message.type === 'tileworker_state') {
            if (this.game?.tileWorkerController) {
                this.game.tileWorkerController.handleStateMessage(message);
            }
            return;
        }
        if (message.type === 'tileworker_despawn') {
            if (this.game?.tileWorkerController) {
                this.game.tileWorkerController.handleDespawnMessage(message);
            }
            return;
        }
        if (message.type === 'tileworker_sync') {
            if (this.game?.tileWorkerController && message.tileworkers) {
                this.game.tileWorkerController.syncTileWorkersFromPeer(message.tileworkers, fromPeer);
            }
            return;
        }

        // Fisherman NPC P2P messages
        if (message.type === 'fisherman_spawn') {
            if (this.game?.fishermanController) {
                this.game.fishermanController.handleSpawnMessage(message);
            }
            return;
        }
        if (message.type === 'fisherman_state') {
            if (this.game?.fishermanController) {
                this.game.fishermanController.handleStateMessage(message);
            }
            return;
        }
        if (message.type === 'fisherman_despawn') {
            if (this.game?.fishermanController) {
                this.game.fishermanController.handleDespawnMessage(message);
            }
            return;
        }
        if (message.type === 'fisherman_sync') {
            if (this.game?.fishermanController && message.fishermen) {
                this.game.fishermanController.syncFishermenFromPeer(message.fishermen, fromPeer);
            }
            return;
        }

        // Queue player deaths if avatar doesn't exist yet (due to P2P stagger delay)
        if (message.type === 'player_death' && !avatar) {
            this.pendingDeaths.set(fromPeer, { timestamp: Date.now() });
            console.log(`[Death] Queued death for peer ${fromPeer} (avatar not ready)`);
            return;
        }

        // Store position from player_pos even before avatar exists (fixes race condition)
        // This ensures avatar appears at correct location when created
        if (message.type === 'player_pos' && peerData && message.p) {
            if (!peerData.targetPosition) {
                peerData.targetPosition = new THREE.Vector3();
            }
            peerData.targetPosition.fromArray(message.p);
            peerData.targetRotation = message.r;
            peerData.lastUpdateTime = Date.now();
            this.updatePeerChunkRegistry(fromPeer, peerData, peerData.targetPosition);
        }

        // Store username, faction, and position from player_tick even before avatar exists (fixes race condition)
        // This ensures peerData is populated before avatar creation
        if (message.type === 'player_tick' && peerData) {
            // Store position early - ensures avatar appears at correct location when created
            if (message.p) {
                if (!peerData.targetPosition) {
                    peerData.targetPosition = new THREE.Vector3();
                }
                peerData.targetPosition.fromArray(message.p);
                peerData.lastUpdateTime = Date.now();
                // Update chunk registry for AI authority calculations
                this.updatePeerChunkRegistry(fromPeer, peerData, peerData.targetPosition);
            }
            // Store username if provided
            if (message.u && peerData.username !== message.u) {
                peerData.username = message.u;
            }
            // Store faction for enemy detection (don't require username)
            if (message.f !== undefined) {
                const factionChanged = peerData.factionId !== message.f;
                peerData.factionId = message.f;

                // Apply faction colors if avatar exists and faction changed
                // (Fixes race condition where faction is stored early but colors never applied
                // because the later check in handlePlayerTick sees values as already equal)
                if (factionChanged && avatar) {
                    const entityId = `peer_${fromPeer}`;
                    if (this.game?.nameTagManager) {
                        this.game.nameTagManager.setEntityFaction(entityId, message.f);
                        if (this.game.gameState) {
                            const isEnemy = this.game.gameState.isEnemyFaction(message.f);
                            this.game.nameTagManager.setEntityEnemy(entityId, isEnemy);
                        }
                    }
                    if (this.game?.avatarManager) {
                        this.game.avatarManager.setAvatarFaction(fromPeer, message.f);
                    }
                }
            }
        }

        // Store faction/position from player_full_state even before avatar exists (fixes race condition)
        // This ensures peerData.factionId and targetPosition are set immediately
        // The full state is sent on P2P connection, which may happen before avatar creation
        if (message.type === 'player_full_state' && peerData) {
            // Store position early - critical for visibility when avatar is created
            // Without this, avatar starts at origin and peer is invisible
            if (message.position) {
                if (!peerData.targetPosition) {
                    peerData.targetPosition = new THREE.Vector3();
                }
                peerData.targetPosition.fromArray(message.position);
                peerData.lastUpdateTime = Date.now();
                // Update chunk registry for AI authority calculations
                this.updatePeerChunkRegistry(fromPeer, peerData, peerData.targetPosition);
            }

            // Store faction for enemy detection
            if (message.factionId !== undefined && peerData.factionId !== message.factionId) {
                peerData.factionId = message.factionId;
                // Apply faction colors if avatar exists
                if (avatar) {
                    const entityId = `peer_${fromPeer}`;
                    if (this.game?.nameTagManager) {
                        this.game.nameTagManager.setEntityFaction(entityId, message.factionId);
                        if (this.game.gameState) {
                            const isEnemy = this.game.gameState.isEnemyFaction(message.factionId);
                            this.game.nameTagManager.setEntityEnemy(entityId, isEnemy);
                        }
                    }
                    if (this.game?.avatarManager) {
                        this.game.avatarManager.setAvatarFaction(fromPeer, message.factionId);
                    }
                }
            }
            // Also store username early
            if (message.username && peerData.username !== message.username) {
                peerData.username = message.username;
            }
        }

        // Handle auth_info before avatar check - store username early so nametag is correct
        // Also update nametag if avatar already exists (fixes "Player sessio" bug)
        if (message.type === 'auth_info' && peerData) {
            peerData.accountId = message.accountId;
            if (message.username && peerData.username !== message.username) {
                peerData.username = message.username;
                // Update nametag if avatar exists
                const existingAvatar = this.avatars?.get(fromPeer);
                if (this.game?.nameTagManager && existingAvatar) {
                    this.game.nameTagManager.registerEntity(`peer_${fromPeer}`, message.username, existingAvatar);
                }
            }
            // Store spawn time for P2P kick logic (most recent spawner gets kicked on P2P failure)
            if (message.spawnTime) {
                peerData.spawnTime = message.spawnTime;
            }
            return;
        }

        if (!peerData || !avatar) {
            if (message.type === 'artillery_damage' || message.type === 'artillery_boat_damage') {
                console.log(`[Artillery] Message BLOCKED by avatar check: type=${message.type}, peerData=${!!peerData}, avatar=${!!avatar}`);
            }
            return;
        }

        switch (message.type) {
            case 'player_pos':
                this.handlePlayerPos(message, fromPeer, peerData, avatar);
                break;

            case 'player_tick':
                this.handlePlayerTick(message, fromPeer, peerData, avatar);
                break;

            case 'player_full_state':
                this.handlePlayerFullState(message, fromPeer, peerData, avatar);
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

            case 'player_shoot_brownbear':
                this.handlePlayerShootBrownbear(message.payload, fromPeer, avatar);
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

            case 'artillery_loaded_ship':
                this.handleArtilleryLoadedShip(message.payload, fromPeer, peerData);
                break;

            case 'artillery_unloaded_ship':
                this.handleArtilleryUnloadedShip(message.payload, fromPeer, peerData);
                break;

            case 'horse_loaded_ship':
                this.handleHorseLoadedShip(message.payload, fromPeer, peerData);
                break;

            case 'horse_unloaded_ship':
                this.handleHorseUnloadedShip(message.payload, fromPeer, peerData);
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
                console.log(`[Artillery] Received damage msg from ${fromPeer}, peerData=${!!peerData}, avatar=${!!avatar}`);
                this.handleArtilleryDamage(message.payload, fromPeer, peerData);
                break;

            case 'artillery_boat_damage':
                this.handleArtilleryBoatDamage(message.payload, fromPeer, peerData);
                break;

            // auth_info is handled early (before avatar check) to fix nametag race condition

            case 'player_chat':
                this.handlePlayerChat(message.payload, fromPeer, peerData, avatar);
                break;
        }
    }

    /**
     * Handle player position update - store target for smooth movement
     * @private
     */
    handlePlayerPos(message, fromPeer, peerData, avatar) {
        // Reuse existing Vector3 to avoid GC pressure
        if (!peerData.targetPosition) {
            peerData.targetPosition = new THREE.Vector3();
        }
        peerData.targetPosition.fromArray(message.p);

        // Store target rotation and timing
        peerData.targetRotation = message.r;
        peerData.lastUpdateTime = Date.now(); // Use receive time for consistent staleness detection

        // Update chunk registry for spatial partitioning
        this.updatePeerChunkRegistry(fromPeer, peerData, peerData.targetPosition);
    }


    /**
     * Handle player tick (periodic sync) - same as position update
     * @private
     */
    handlePlayerTick(message, fromPeer, peerData, avatar) {
        // Reuse existing Vector3 to avoid GC pressure
        if (!peerData.targetPosition) {
            peerData.targetPosition = new THREE.Vector3();
        }
        peerData.targetPosition.fromArray(message.p);
        peerData.lastUpdateTime = Date.now(); // Tick doesn't have timestamp, use receive time

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

        // Update faction and colors if provided
        if (message.f !== undefined && peerData.factionId !== message.f) {
            peerData.factionId = message.f;
            const entityId = `peer_${fromPeer}`;

            // Update name tag faction color
            if (this.game?.nameTagManager) {
                this.game.nameTagManager.setEntityFaction(entityId, message.f);
                // Also update enemy status (red overrides faction color)
                if (this.game.gameState) {
                    const isEnemy = this.game.gameState.isEnemyFaction(message.f);
                    this.game.nameTagManager.setEntityEnemy(entityId, isEnemy);
                }
            }

            // Update shirt color
            if (this.game?.avatarManager) {
                this.game.avatarManager.setAvatarFaction(fromPeer, message.f);
            }
        }

        // Update chunk registry
        this.updatePeerChunkRegistry(fromPeer, peerData, peerData.targetPosition);
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
            // Reuse existing Vector3 to avoid GC pressure
            if (!peerData.aiEnemyTargetPosition) {
                peerData.aiEnemyTargetPosition = new THREE.Vector3();
            }
            peerData.aiEnemyTargetPosition.fromArray(payload.position);
            const distance = peerData.aiEnemy.position.distanceTo(peerData.aiEnemyTargetPosition);
            const CORRECTION_THRESHOLD = 0.3; // Units of desync before catch-up triggers

            if (distance > CORRECTION_THRESHOLD) {
                // Significant desync - use catch-up mode (2x speed)
                peerData.aiEnemyCatchingUp = true;
            } else {
                peerData.aiEnemyCatchingUp = false;
            }

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

        // Notify ambient sound system of combat (silences plains/forest)
        if (this.game?.ambientSoundSystem) {
            this.game.ambientSoundSystem.onCombatActivity();
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

        // Notify ambient sound system of combat (silences plains/forest)
        if (this.game?.ambientSoundSystem) {
            this.game.ambientSoundSystem.onCombatActivity();
        }

        // Spawn hit/miss effect at bandit position
        if (this.game?.effectManager && payload.tentId) {
            const banditEntity = this.game.banditController?.entities?.get(payload.tentId);
            const targetPos = banditEntity?.mesh?.position || banditEntity?.position;
            const shooterPos = avatar?.position;

            if (targetPos && shooterPos) {
                if (payload.isHit) {
                    this.game.effectManager.spawnBloodEffect(targetPos, shooterPos);
                } else {
                    this.game.effectManager.spawnDirtKickup(targetPos, shooterPos);
                }
            }
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

        // Notify ambient sound system of combat (silences plains/forest)
        if (this.game?.ambientSoundSystem) {
            this.game.ambientSoundSystem.onCombatActivity();
        }

        // Spawn hit/miss effect at deer position
        if (this.game?.effectManager && payload.treeId) {
            const deerEntity = this.game.deerController?.entities?.get(payload.treeId);
            const targetPos = deerEntity?.mesh?.position || deerEntity?.position;
            const shooterPos = avatar?.position;

            if (targetPos && shooterPos) {
                if (payload.isHit) {
                    this.game.effectManager.spawnBloodEffect(targetPos, shooterPos);
                } else {
                    this.game.effectManager.spawnDirtKickup(targetPos, shooterPos);
                }
            }
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
     * Handle player shooting at a brown bear
     * @private
     */
    handlePlayerShootBrownbear(payload, fromPeer, avatar) {
        // Play rifle sound for peer's player
        if (avatar && this.audioManager) {
            this.audioManager.playPositionalSound('rifle', avatar);
        }

        // Play shoot animation and muzzle flash for peer's avatar
        if (this.game?.avatarManager) {
            this.game.avatarManager.playShootAnimation(fromPeer);
        }

        // Notify ambient sound system of combat (silences plains/forest)
        if (this.game?.ambientSoundSystem) {
            this.game.ambientSoundSystem.onCombatActivity();
        }

        // Spawn hit/miss effect at brown bear position
        if (this.game?.effectManager && payload.denId) {
            const bearEntity = this.game.brownBearController?.entities?.get(payload.denId);
            const targetPos = bearEntity?.mesh?.position || bearEntity?.position;
            const shooterPos = avatar?.position;

            if (targetPos && shooterPos) {
                if (payload.isHit) {
                    this.game.effectManager.spawnBloodEffect(targetPos, shooterPos);
                } else {
                    this.game.effectManager.spawnDirtKickup(targetPos, shooterPos);
                }
            }
        }

        // If the shot hit and we're authority, apply death
        if (payload.isHit && payload.denId) {
            if (this.game?.brownBearController?.isAuthority(payload.denId)) {
                this.game.brownBearController.killEntity(payload.denId, fromPeer);
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

        // Notify ambient sound system of combat (silences plains/forest)
        if (this.game?.ambientSoundSystem) {
            this.game.ambientSoundSystem.onCombatActivity();
        }

        // Spawn hit/miss effect at target position
        if (this.game?.effectManager) {
            // Get target position (could be local player or another peer)
            let targetPos = null;
            if (payload.targetPeerId === this.game?.gameState?.clientId) {
                // Target is local player
                targetPos = this.game.playerObject?.position;
            } else {
                // Target is another peer
                const targetAvatar = this.game.networkManager?.avatars?.get(payload.targetPeerId);
                targetPos = targetAvatar?.position;
            }

            // Get shooter position
            const shooterPos = avatar?.position;

            if (targetPos && shooterPos) {
                if (payload.isHit) {
                    this.game.effectManager.spawnBloodEffect(targetPos, shooterPos);
                } else {
                    this.game.effectManager.spawnDirtKickup(targetPos, shooterPos);
                }
            }
        }

        // Check if WE are the target and got hit
        if (payload.targetPeerId === this.game?.gameState?.clientId && payload.isHit) {
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
        // Mark peer as expected to disconnect (they may have unstable connection during respawn)
        // This prevents the P2P reconnecting UI from showing for death/respawn events
        if (this.networkManager) {
            this.networkManager.markExpectedDisconnect(fromPeer, 15000);  // 15s grace period for respawn
        }

        // Get peer data to check states
        const peerData = this.peerGameData.get(fromPeer);

        // If peer was piloting a mobile entity, handle cleanup FIRST
        if (peerData && peerData.mobileEntity) {
            const entityType = peerData.mobileEntity.entityType;
            const entityId = peerData.mobileEntity.entityId;
            const waterVehicles = ['boat', 'sailboat', 'ship2'];

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

            // For water vehicles: start sinking animation immediately on death
            // This ensures the boat sinks even if mobile_entity_exit is delayed
            if (waterVehicles.includes(entityType) && peerData.mobileEntity.mesh) {
                const peerBoatMesh = peerData.mobileEntity.mesh;

                // Play crash sound
                if (this.game?.audioManager) {
                    this.game.audioManager.playBoatCrashSound(entityType);
                }

                // Start sinking animation
                if (this.game?.boatSinkingSystem) {
                    this.game.boatSinkingSystem.startSinking(peerBoatMesh, entityId, null);
                    console.log(`[Death] Started sinking animation for peer ${fromPeer}'s ${entityType}`);
                }

                // Remove from active peer boats tracking
                this.activePeerBoats.delete(fromPeer);

                // Remove kinematic collider
                if (this.game?.physicsManager && peerBoatMesh.userData?.physicsBodyId) {
                    this.game.physicsManager.removeKinematicBody(peerBoatMesh.userData.physicsBodyId);
                }

                // Unregister from animation system
                if (this.game?.animationSystem && peerBoatMesh.userData?.objectId) {
                    this.game.animationSystem.unregister(peerBoatMesh.userData.objectId);
                }

                // Clear the mesh reference (sinking system now owns it)
                peerData.mobileEntity.mesh = null;
            }

            // Clear occupancy so entity can be remounted (ISSUE-037 fix)
            if (entityId && this.game?.mobileEntitySystem) {
                this.game.mobileEntitySystem.clearOccupied(entityId);
            }

            // Clear mobile entity state so object_removed isn't blocked
            peerData.mobileEntity = null;
            peerData.isPiloting = false;

            console.log(`[Death] Peer ${fromPeer} died while piloting ${entityType} - cleaned up`);
        }

        // If peer was manning artillery, clear occupancy
        if (peerData && peerData.mannedArtillery) {
            if (peerData.mannedArtillery.artilleryId && this.game?.mobileEntitySystem) {
                this.game.mobileEntitySystem.clearOccupied(peerData.mannedArtillery.artilleryId);
            }
            // Clean up the peer artillery mesh if it exists
            if (peerData.mannedArtillery.mesh?.userData?.isPeerArtillery && this.game?.scene) {
                this.game.scene.remove(peerData.mannedArtillery.mesh);
                peerData.mannedArtillery.mesh.traverse((child) => {
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
            peerData.mannedArtillery = null;
            console.log(`[Death] Peer ${fromPeer} died while manning artillery - cleared occupancy`);
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

        // Remove dead peer from chunk registry so AI authority recalculates correctly
        if (peerData) {
            this.removePeerFromChunkRegistry(fromPeer, peerData);
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

        // Reset mesh rotation to upright
        // Death animation rotates avatar.rotation.x/z directly for peers (see DeathSystem.js)
        // Also reset children[0] rotation in case of nested mesh issues
        avatar.rotation.x = 0;
        avatar.rotation.z = 0;
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
     * Handle player chat message
     * @private
     */
    handlePlayerChat(payload, fromPeer, peerData, avatar) {
        if (!payload || !payload.text) return;

        // Display chat message above player's name tag
        if (this.game?.nameTagManager) {
            this.game.nameTagManager.setChatMessage(`peer_${fromPeer}`, payload.text);
        }

        // Emit event for potential UI updates
        this.emit('player_chat', { peerId: fromPeer, text: payload.text });
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
        console.log(`[P2P] Peer ${fromPeer} boarded ${entityType} (entityId: ${payload.entityId}, factionId: ${peerData.factionId})`);

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

                    // Unregister from StructureModelSystem to prevent LOD updates from re-showing it
                    // (StructureModelSystem.updateStructureModels would override visible=false)
                    if (this.game?.structureModelSystem) {
                        this.game.structureModelSystem.unregisterStructure(payload.entityId);
                    }

                    console.log(`[P2P] Hid static ${entityType} ${payload.entityId} - peer ${fromPeer} is now controlling it`);
                }

                // Entity-specific setup
                const waterVehicleTypes = ['boat', 'sailboat', 'ship2'];
                if (waterVehicleTypes.includes(entityType)) {
                    // Flag for AnimationSystem to not override rotation (peer boats are rotated by AvatarManager)
                    entityMesh.userData.isPeerBoat = true;

                    // Register with animation system for wave bobbing
                    if (this.game.animationSystem) {
                        this.game.animationSystem.registerShip(entityMesh);
                    }

                    // Create kinematic collider for peer boat (so local player's boat can collide with it)
                    if (this.game?.physicsManager) {
                        const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[entityType];
                        if (dims) {
                            const shape = { type: 'cuboid', width: dims.width, depth: dims.depth, height: dims.height };
                            const peerBoatId = `peer_${entityType}_${fromPeer}`;
                            this.game.physicsManager.createKinematicBody(peerBoatId, shape, entityMesh.position);
                            entityMesh.userData.physicsBodyId = peerBoatId;
                        }
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
                // Clear occupancy so the horse isn't stuck in locked state
                if (this.game?.mobileEntitySystem) {
                    this.game.mobileEntitySystem.clearOccupied(payload.entityId);
                }
            }
        } else {
            console.warn(`[P2P] Cannot create ${entityType} mesh - no scene available`);
            peerData.mobileEntity.mesh = null;
            // Clear occupancy so the horse isn't stuck in locked state
            if (this.game?.mobileEntitySystem) {
                this.game.mobileEntitySystem.clearOccupied(payload.entityId);
            }
        }

        // Emit event for UI updates
        this.emit('mobile_entity_enter', { peerId: fromPeer, entityId: payload.entityId, entityType: entityType });

        // Clear regular walking target to prevent avatar from chasing
        // stale player_pos updates instead of following the horse
        peerData.targetPosition = null;

        // Reset avatar rotation to upright (in case of leftover rotation from death animation, etc.)
        // This fixes the "sideways character" bug when peers mount horses
        if (avatar) {
            avatar.rotation.set(0, payload.rotation || 0, 0);
            if (avatar.children[0]) {
                avatar.children[0].rotation.set(0, 0, 0);
            }
        }
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
        } else {
            // Water vehicles (boat, sailboat, ship2) - unregister from animation system
            const waterVehicleTypesExit = ['boat', 'sailboat', 'ship2'];
            if (waterVehicleTypesExit.includes(entityType)) {
                if (this.game?.animationSystem && peerData.mobileEntity.mesh) {
                    this.game.animationSystem.unregister(peerData.mobileEntity.mesh.userData.objectId);
                }
                // Remove kinematic collider for peer boat
                if (this.game?.physicsManager && peerData.mobileEntity.mesh?.userData?.physicsBodyId) {
                    this.game.physicsManager.removeKinematicBody(peerData.mobileEntity.mesh.userData.physicsBodyId);
                }
                // Remove from active peer boats tracking
                this.activePeerBoats.delete(fromPeer);
            }
        }

        // CRITICAL: Only remove mesh if this is a TRUE death loss (water vehicles sink)
        // For horses on death: keep the mesh visible - server will broadcast object_added
        // For normal dismount: remove mesh - server will broadcast object_added with correct position
        const waterVehiclesForDeath = ['boat', 'sailboat', 'ship2'];
        if (isDeathLoss && waterVehiclesForDeath.includes(entityType)) {
            // Peer boat destroyed - play sinking animation and crash sound
            const peerBoatMesh = peerData.mobileEntity.mesh;

            // Check if already sinking (handlePlayerDeath may have already started it)
            const alreadySinking = entityId && this.game?.boatSinkingSystem?.isSinking(entityId);

            if (peerBoatMesh && this.game?.boatSinkingSystem && !alreadySinking) {
                // Play crash sound at boat's position
                if (this.game.audioManager) {
                    this.game.audioManager.playBoatCrashSound(entityType);
                }

                // Start sinking animation - system handles mesh disposal when complete
                this.game.boatSinkingSystem.startSinking(peerBoatMesh, entityId, () => {
                    // Animation complete - mesh already disposed by sinking system
                });
                console.log(`[MobileExit] Started sinking animation for peer ${fromPeer}'s ${entityType}`);
            } else if (peerBoatMesh && !this.game?.boatSinkingSystem) {
                // Fallback: just remove mesh if sinking system unavailable
                if (this.game?.scene) {
                    this.game.scene.remove(peerBoatMesh);
                }
                peerBoatMesh.traverse((child) => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                });
            } else if (alreadySinking) {
                console.log(`[MobileExit] Skipping sinking for ${entityId} - already sinking from player_death`);
            }

            peerData.mobileEntity.mesh = null;
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

            // Calculate speed for collision detection (distance / time in ms -> units per ms)
            const now = Date.now();
            const dt = now - (peerData.mobileEntity.lastUpdateTime || now);
            const distance = peerData.mobileEntity.targetPosition.distanceTo(peerData.mobileEntity.lastPosition);
            peerData.mobileEntity.isMoving = distance > 0.01;

            if (dt > 0) {
                peerData.mobileEntity.speed = distance / dt; // units per ms (same as local boat velocity)
            }
            peerData.mobileEntity.lastUpdateTime = now;

            // Update active peer boats tracking for water vehicles
            const waterVehicles = ['boat', 'sailboat', 'ship2'];
            if (waterVehicles.includes(peerData.mobileEntity.entityType)) {
                this.activePeerBoats.set(fromPeer, {
                    entityType: peerData.mobileEntity.entityType,
                    speed: peerData.mobileEntity.speed || 0
                });
            }
        }

        // Update peer's tracked position (for spatial partitioning)
        if (peerData) {
            // Reuse existing Vector3 to avoid GC pressure
            if (!peerData.targetPosition) {
                peerData.targetPosition = new THREE.Vector3();
            }
            peerData.targetPosition.fromArray(payload.position);
            this.updatePeerChunkRegistry(fromPeer, peerData, peerData.targetPosition);
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

        // Unparent any loaded crate before disposing cart mesh
        // The crate_unloaded message will handle proper placement
        if (peerData.loadedCrate?.mesh && peerData.loadedCrate.mesh.parent) {
            peerData.loadedCrate.mesh.parent.remove(peerData.loadedCrate.mesh);
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

        // Clear peer's cart state
        // Note: peerData.loadedCrate is NOT cleared here - crate_unloaded will handle it
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
        const { artilleryId, heading, isShipMounted, shipId } = payload;

        // Mark artillery as occupied
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.setOccupied(artilleryId, fromPeer);
        }

        // Handle ship-mounted artillery differently - mesh is already a child of the ship
        if (isShipMounted && shipId) {
            // Store manning state for peer (no mesh creation needed)
            peerData.mannedArtillery = {
                artilleryId,
                heading: heading || 0,
                mesh: null,
                isShipMounted: true,
                shipId
            };

            console.log(`[P2P] Peer ${fromPeer} manned ship-mounted artillery ${artilleryId} on ship ${shipId}`);
            return;
        }

        // Get existing static artillery to copy position from
        const existingArtillery = this.game?.objectRegistry?.get(artilleryId);
        const position = existingArtillery?.position?.clone() || new THREE.Vector3();
        const rotation = heading !== undefined ? heading : (existingArtillery?.rotation?.y || 0);

        // Store manning state for peer
        peerData.mannedArtillery = {
            artilleryId,
            heading: rotation,
            mesh: null
        };

        // Create a peer-controlled artillery mesh (like handleArtilleryAttached does)
        // This prevents the artillery from disappearing when server sends object_removed
        if (this.game?.scene) {
            const artilleryModel = modelManager.getModel('artillery');
            if (artilleryModel) {
                const artilleryMesh = artilleryModel.clone();
                artilleryMesh.position.copy(position);
                artilleryMesh.rotation.y = rotation;

                const modelConfig = MODEL_CONFIG['artillery'];
                const baseScale = modelConfig?.baseScale || 1.0;
                artilleryMesh.scale.setScalar(baseScale);

                artilleryMesh.userData.isPeerArtillery = true;
                artilleryMesh.userData.peerId = fromPeer;
                artilleryMesh.userData.objectId = `peer_manned_artillery_${fromPeer}`;

                peerData.mannedArtillery.mesh = artilleryMesh;
                this.game.scene.add(artilleryMesh);

                console.log(`[P2P] Created peer manned artillery mesh for ${fromPeer}, artillery ${artilleryId}`);
            } else {
                console.warn(`[P2P] Failed to create manned artillery mesh - model not loaded`);
            }
        }

        // Hide the static artillery from scene if it still exists
        if (existingArtillery && existingArtillery.userData?.objectId === artilleryId) {
            existingArtillery.visible = false;
        }

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

        // For ship-mounted artillery, no mesh cleanup needed - just clear state
        if (peerData.mannedArtillery?.isShipMounted) {
            peerData.mannedArtillery = null;
            console.log(`[P2P] Peer ${fromPeer} unmanned ship-mounted artillery ${artilleryId}`);
            return;
        }

        // Clean up peer artillery mesh (following pattern from handleArtilleryReleased)
        if (peerData.mannedArtillery?.mesh) {
            const artilleryMesh = peerData.mannedArtillery.mesh;

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
                console.log(`[P2P] Removed peer manned artillery mesh for ${fromPeer}`);
            }
        }

        // Restore static artillery visibility (was hidden in handleArtilleryManned)
        const existingArtillery = this.game?.objectRegistry?.get(artilleryId);
        if (existingArtillery && existingArtillery.visible === false) {
            existingArtillery.visible = true;
            // Update rotation if it changed while manned
            if (rotation !== undefined) {
                existingArtillery.rotation.y = rotation;
            }
            console.log(`[P2P] Restored static artillery visibility for ${artilleryId}`);
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
        const { artilleryId, heading, isShipMounted, shipId } = payload;

        if (peerData.mannedArtillery && peerData.mannedArtillery.artilleryId === artilleryId) {
            peerData.mannedArtillery.heading = heading;

            // Handle ship-mounted artillery - find mesh in loadedArtillery array
            if (isShipMounted && peerData.loadedArtillery) {
                const artilleryData = peerData.loadedArtillery.find(a => a.artilleryId === artilleryId);
                if (artilleryData?.mesh) {
                    artilleryData.mesh.rotation.y = heading;
                }
            } else if (peerData.mannedArtillery.mesh) {
                // Land artillery - update peer-controlled mesh
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
            // Calculate barrel position (barrel faces opposite to towing direction)
            const barrelOffset = CONFIG?.ARTILLERY_COMBAT?.BARREL_OFFSET || { x: 0, y: 0.6, z: 1.2 };
            const barrelDir = CONFIG?.ARTILLERY_COMBAT?.BARREL_DIRECTION || -1;
            const barrelPos = {
                x: artilleryMesh.position.x + barrelDir * Math.sin(heading) * barrelOffset.z,
                y: artilleryMesh.position.y + barrelOffset.y,
                z: artilleryMesh.position.z + barrelDir * Math.cos(heading) * barrelOffset.z
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

        // Notify ambient sound system of combat (silences plains/forest)
        if (this.game?.ambientSoundSystem) {
            this.game.ambientSoundSystem.onCombatActivity();
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
        const myClientId = this.game?.gameState?.clientId;

        console.log(`[Artillery] handleArtilleryDamage: targetPeerId=${targetPeerId}, myClientId=${myClientId}, match=${targetPeerId === myClientId}`);

        // Check if this message is targeting local player
        if (targetPeerId !== myClientId) {
            console.log(`[Artillery] Not for me, ignoring`);
            return;
        }

        // Apply damage to local player (instant kill from artillery)
        const hasDeathManager = !!this.game?.deathManager;
        const hasPlayerObject = !!this.game?.playerObject;
        console.log(`[Artillery] Attempting kill: deathManager=${hasDeathManager}, playerObject=${hasPlayerObject}`);

        if (hasDeathManager && hasPlayerObject) {
            const shooterName = this.peerGameData?.get(fromPeer)?.username || 'Enemy artillery';
            console.log(`[Artillery] Calling killEntity for local player`);
            this.game.deathManager.killEntity(
                this.game.playerObject,
                false,  // isAI
                false,  // isPeer
                `Killed by ${shooterName}'s artillery`
            );
        } else {
            console.log(`[Artillery] Cannot kill - missing deathManager or playerObject`);
        }
    }

    /**
     * Handle artillery damage to local player's boat
     * @private
     */
    handleArtilleryBoatDamage(payload, fromPeer, peerData) {
        const { targetPeerId, entityType, damage } = payload;

        // Only process if we're the target
        if (targetPeerId !== this.game?.gameState?.clientId) return;

        // Must be piloting a boat
        const mobileState = this.game?.gameState?.mobileEntityState;
        if (!mobileState?.isActive || !['boat', 'sailboat', 'ship2'].includes(mobileState.entityType)) return;

        const entity = mobileState.currentEntity;
        if (!entity) return;

        // Calculate current durability (same formula as structures)
        const DECAY_EXPONENT = 1.434;
        const DECAY_INVERSE = 0.697;
        const quality = mobileState.entityQuality || 50;
        const maxLifespanHours = Math.pow(quality, DECAY_EXPONENT);
        const now = Date.now();
        const elapsedMs = now - (mobileState.entityLastRepairTime || now);
        const elapsedHours = elapsedMs / (1000 * 60 * 60);
        const remainingHours = Math.max(0, maxLifespanHours - elapsedHours);
        const currentDurability = Math.pow(remainingHours, DECAY_INVERSE);

        const newDurability = currentDurability - damage;

        if (newDurability <= 0) {
            // Boat destroyed - trigger sinking and death
            console.log(`[Artillery] Boat destroyed by artillery from peer ${fromPeer}`);

            // Play crash sound
            if (this.game?.audioManager) {
                this.game.audioManager.playBoatCrashSound(mobileState.entityType);
            }

            // Clear ship gunner state if manning ship artillery
            const sinkingEntityId = mobileState.entityId;
            if (this.game?.clearShipGunnerStateOnSink) {
                this.game.clearShipGunnerStateOnSink(sinkingEntityId);
            }

            // Start sinking animation
            if (this.game?.boatSinkingSystem) {
                this.game.boatSinkingSystem.startSinking(entity, mobileState.entityId, () => {
                    this.game.killEntity(this.game.playerObject, false, false, 'Boat destroyed by artillery');
                });
            } else {
                // Fallback: kill player immediately if sinking system unavailable
                this.game.killEntity(this.game.playerObject, false, false, 'Boat destroyed by artillery');
            }

            // Remove physics body
            if (this.game?.physicsManager && mobileState.entityId) {
                this.game.physicsManager.removeCharacterController(mobileState.entityId);
            }

            // Clear mobile state
            const stateToReset = this.game?.gameState?.mobileEntityState;
            if (stateToReset) {
                stateToReset.isActive = false;
                stateToReset.currentEntity = null;
                stateToReset.entityId = null;
                stateToReset.entityType = null;
                stateToReset.phase = null;
            }
        } else {
            // Boat damaged but not destroyed - update repair time
            const newRemainingHours = Math.pow(newDurability, 1 / DECAY_INVERSE);
            const newElapsedHours = maxLifespanHours - newRemainingHours;
            const newLastRepairTime = now - newElapsedHours * 60 * 60 * 1000;

            mobileState.entityLastRepairTime = newLastRepairTime;
            entity.userData.lastRepairTime = newLastRepairTime;

            console.log(`[Artillery] Boat damaged: ${currentDurability.toFixed(1)} -> ${newDurability.toFixed(1)} by peer ${fromPeer}`);
        }
    }

    /**
     * Handle crate loaded by peer (peer loads a crate onto their cart or boat)
     * Supports multi-crate for ship2 with slot-based positioning
     * @private
     */
    handleCrateLoaded(payload, fromPeer, peerData) {
        const { crateId, cartId, inventory, vehicleType, slotIndex } = payload;

        // Mark crate as occupied (being carried)
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.setOccupied(crateId, fromPeer);
        }

        // Determine target mesh (cart or boat) and position offsets
        const boatTypes = ['boat', 'sailboat', 'ship2'];
        const isPeerOnBoat = peerData.mobileEntity?.mesh &&
            boatTypes.includes(peerData.mobileEntity?.entityType);
        const targetMesh = peerData.towedCart?.mesh || (isPeerOnBoat ? peerData.mobileEntity.mesh : null);

        // Get position based on vehicle type and slot
        let heightOffset, xOffset, zOffset;
        if (isPeerOnBoat && vehicleType && slotIndex !== undefined) {
            // Use slot-based positioning from config
            const slotConfig = CONFIG.CRATE_VEHICLES?.[vehicleType]?.slots?.[slotIndex];
            if (slotConfig) {
                xOffset = slotConfig.x;
                heightOffset = slotConfig.y;
                zOffset = slotConfig.z;
            } else {
                // Fallback to legacy positioning
                xOffset = 0;
                heightOffset = 0.15;
                zOffset = -0.5;
            }
        } else if (isPeerOnBoat) {
            // Legacy boat positioning (no slot info)
            xOffset = 0;
            heightOffset = 0.15;
            zOffset = -0.5;
        } else {
            // Cart positioning
            xOffset = 0;
            heightOffset = 0.2;
            zOffset = -0.1;
        }

        // Initialize loadedCrates array if needed (for multi-crate support)
        if (!peerData.loadedCrates) {
            peerData.loadedCrates = [];
        }

        // Also maintain legacy loadedCrate for backward compatibility
        if (!peerData.loadedCrate) {
            peerData.loadedCrate = {};
        }

        // Try to find existing crate mesh
        let crateMesh = this.game?.objectRegistry?.get(crateId);

        // If existing crate found, reparent it to the cart/boat
        if (crateMesh && targetMesh) {
            if (crateMesh.parent) {
                crateMesh.parent.remove(crateMesh);
            }
            targetMesh.add(crateMesh);
            crateMesh.position.set(xOffset, heightOffset, zOffset);
            crateMesh.rotation.set(0, 0, 0);

            // Add to loadedCrates array
            peerData.loadedCrates.push({
                crateId,
                slotIndex: slotIndex || 0,
                mesh: crateMesh,
                inventory
            });

            // Update legacy state
            peerData.loadedCrate.crateId = crateId;
            peerData.loadedCrate.cartId = cartId;
            peerData.loadedCrate.inventory = inventory;
            peerData.loadedCrate.mesh = crateMesh;

            // Remove crate from chunk tracking to prevent disposal when chunk unloads
            if (crateMesh.userData?.chunkKey && this.game?.chunkManager) {
                const chunkKey = crateMesh.userData.chunkKey;
                const chunkObjects = this.game.chunkManager.chunkObjects.get(chunkKey);
                if (chunkObjects) {
                    const index = chunkObjects.indexOf(crateMesh);
                    if (index !== -1) {
                        chunkObjects.splice(index, 1);
                        console.log(`[P2P] Removed crate ${crateId} from chunk ${chunkKey} tracking (now on peer ${isPeerOnBoat ? 'boat' : 'cart'})`);
                    }
                }
            }

            console.log(`[P2P] Peer ${fromPeer} loaded crate ${crateId} onto ${isPeerOnBoat ? vehicleType || 'boat' : 'cart'} slot ${slotIndex || 0}`);
        }
        // Fallback: Create a new peer crate mesh if not found (race condition case)
        else if (targetMesh && this.game?.scene) {
            const crateModel = modelManager.getModel('crate');
            if (crateModel) {
                crateMesh = crateModel.clone();

                // Set up as peer-controlled crate
                crateMesh.userData.isPeerCrate = true;
                crateMesh.userData.peerId = fromPeer;
                crateMesh.userData.objectId = `peer_crate_${fromPeer}_${slotIndex || 0}`;

                // Apply MODEL_CONFIG scale if available
                const modelConfig = MODEL_CONFIG['crate'];
                const baseScale = modelConfig?.baseScale || 1.0;
                crateMesh.scale.setScalar(baseScale);

                // Parent to cart/boat at slot position
                targetMesh.add(crateMesh);
                crateMesh.position.set(xOffset, heightOffset, zOffset);
                crateMesh.rotation.set(0, 0, 0);

                // Add to loadedCrates array
                peerData.loadedCrates.push({
                    crateId,
                    slotIndex: slotIndex || 0,
                    mesh: crateMesh,
                    inventory
                });

                // Update legacy state
                peerData.loadedCrate.crateId = crateId;
                peerData.loadedCrate.cartId = cartId;
                peerData.loadedCrate.inventory = inventory;
                peerData.loadedCrate.mesh = crateMesh;

                console.log(`[P2P] Created peer crate mesh for ${fromPeer}, crate ${crateId} on ${isPeerOnBoat ? vehicleType || 'boat' : 'cart'} slot ${slotIndex || 0}`);
            } else {
                console.warn(`[P2P] Failed to create crate mesh - model not loaded`);
            }
        } else {
            console.warn(`[P2P] Cannot visualize crate ${crateId} - no cart/boat mesh or scene available`);
        }
    }

    /**
     * Handle crate unloaded by peer (peer unloads crate from cart or boat)
     * Supports multi-crate by finding and removing specific crate from array
     * @private
     */
    handleCrateUnloaded(payload, fromPeer, peerData) {
        const { crateId, position, rotation, inventory } = payload;

        // Clear occupied status
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.clearOccupied(crateId);
        }

        // Find crate in loadedCrates array (multi-crate support)
        let crateData = null;
        let crateIndex = -1;
        if (peerData.loadedCrates?.length > 0) {
            crateIndex = peerData.loadedCrates.findIndex(c => c.crateId === crateId);
            if (crateIndex !== -1) {
                crateData = peerData.loadedCrates[crateIndex];
            }
        }

        // Fall back to legacy loadedCrate if not found in array
        if (!crateData && peerData.loadedCrate?.crateId === crateId) {
            crateData = peerData.loadedCrate;
        }

        // Unparent crate from cart/boat
        if (crateData?.mesh) {
            const crate = crateData.mesh;
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

                // Re-add to chunk tracking so it's properly managed
                const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(position[0], position[2]);
                const newChunkKey = `${chunkX},${chunkZ}`;
                crate.userData.chunkKey = newChunkKey;

                if (this.game?.chunkManager?.chunkObjects) {
                    let chunkObjects = this.game.chunkManager.chunkObjects.get(newChunkKey);
                    if (!chunkObjects) {
                        chunkObjects = [];
                        this.game.chunkManager.chunkObjects.set(newChunkKey, chunkObjects);
                    }
                    if (!chunkObjects.includes(crate)) {
                        chunkObjects.push(crate);
                        console.log(`[P2P] Re-added crate ${crateId} to chunk ${newChunkKey} tracking`);
                    }
                }
            }
        }

        // Remove from loadedCrates array
        if (crateIndex !== -1 && peerData.loadedCrates) {
            peerData.loadedCrates.splice(crateIndex, 1);
        }

        // Update legacy state
        if (peerData.loadedCrates?.length > 0) {
            // Update legacy state to point to the last remaining crate
            const lastCrate = peerData.loadedCrates[peerData.loadedCrates.length - 1];
            peerData.loadedCrate = {
                crateId: lastCrate.crateId,
                mesh: lastCrate.mesh,
                inventory: lastCrate.inventory
            };
        } else {
            // Clear legacy state
            peerData.loadedCrate = null;
        }

        console.log(`[P2P] Peer ${fromPeer} unloaded crate ${crateId}, ${peerData.loadedCrates?.length || 0} remaining`);
    }

    /**
     * Handle artillery loaded onto ship by peer (peer loads artillery onto their ship2)
     * @private
     */
    handleArtilleryLoadedShip(payload, fromPeer, peerData) {
        const { artilleryId, slotIndex, artilleryChunkKey } = payload;

        // Mark artillery as occupied
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.setOccupied(artilleryId, fromPeer);
        }

        // Get peer's ship mesh
        const shipMesh = peerData.mobileEntity?.mesh;
        const isOnShip2 = peerData.mobileEntity?.entityType === 'ship2';

        if (!shipMesh || !isOnShip2) {
            console.warn(`[P2P] Cannot visualize artillery ${artilleryId} - peer not on ship2`);
            return;
        }

        // Get slot positioning from config
        const slotConfig = CONFIG.CRATE_VEHICLES?.ship2_artillery?.slots?.[slotIndex];
        if (!slotConfig) {
            console.warn(`[P2P] Invalid artillery slot ${slotIndex} for ship2`);
            return;
        }

        // Initialize loadedArtillery array if needed
        if (!peerData.loadedArtillery) {
            peerData.loadedArtillery = [];
        }

        // Try to find existing artillery mesh
        let artilleryMesh = this.game?.objectRegistry?.get(artilleryId);

        if (artilleryMesh && shipMesh) {
            // Unparent from current parent
            if (artilleryMesh.parent) {
                artilleryMesh.parent.remove(artilleryMesh);
            }

            // Parent to ship at slot position
            shipMesh.add(artilleryMesh);
            artilleryMesh.position.set(slotConfig.x, slotConfig.y, slotConfig.z);
            artilleryMesh.rotation.set(0, slotConfig.rotation, 0);

            // Add to loadedArtillery array
            peerData.loadedArtillery.push({
                artilleryId,
                slotIndex,
                mesh: artilleryMesh,
                artilleryChunkKey
            });

            // Remove from chunk tracking to prevent disposal when chunk unloads
            if (artilleryMesh.userData?.chunkKey && this.game?.chunkManager) {
                const chunkKey = artilleryMesh.userData.chunkKey;
                const chunkObjects = this.game.chunkManager.chunkObjects.get(chunkKey);
                if (chunkObjects) {
                    const index = chunkObjects.indexOf(artilleryMesh);
                    if (index !== -1) {
                        chunkObjects.splice(index, 1);
                        console.log(`[P2P] Removed artillery ${artilleryId} from chunk ${chunkKey} tracking (now on ship)`);
                    }
                }
            }

            console.log(`[P2P] Peer ${fromPeer} loaded artillery ${artilleryId} onto ship2 slot ${slotIndex}`);
        }
        // Fallback: Create peer artillery mesh if not found
        else if (shipMesh && this.game?.scene) {
            const artilleryModel = modelManager.getModel('artillery');
            if (artilleryModel) {
                artilleryMesh = artilleryModel.clone();

                // Set up as peer-controlled artillery
                artilleryMesh.userData.isPeerArtillery = true;
                artilleryMesh.userData.peerId = fromPeer;
                artilleryMesh.userData.objectId = `peer_artillery_ship_${fromPeer}_${slotIndex}`;

                // Apply MODEL_CONFIG scale if available
                const modelConfig = MODEL_CONFIG['artillery'];
                const baseScale = modelConfig?.baseScale || 1.0;
                artilleryMesh.scale.setScalar(baseScale);

                // Parent to ship at slot position
                shipMesh.add(artilleryMesh);
                artilleryMesh.position.set(slotConfig.x, slotConfig.y, slotConfig.z);
                artilleryMesh.rotation.set(0, slotConfig.rotation, 0);

                // Add to loadedArtillery array
                peerData.loadedArtillery.push({
                    artilleryId,
                    slotIndex,
                    mesh: artilleryMesh,
                    artilleryChunkKey
                });

                console.log(`[P2P] Created peer artillery mesh for ${fromPeer}, artillery ${artilleryId} on ship2 slot ${slotIndex}`);
            } else {
                console.warn(`[P2P] Failed to create artillery mesh - model not loaded`);
            }
        } else {
            console.warn(`[P2P] Cannot visualize artillery ${artilleryId} - no ship mesh or scene available`);
        }
    }

    /**
     * Handle artillery unloaded from ship by peer
     * @private
     */
    handleArtilleryUnloadedShip(payload, fromPeer, peerData) {
        const { artilleryId, position, rotation } = payload;

        // Clear occupied status
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.clearOccupied(artilleryId);
        }

        // Find artillery in loadedArtillery array
        let artilleryData = null;
        let artilleryIndex = -1;
        if (peerData.loadedArtillery?.length > 0) {
            artilleryIndex = peerData.loadedArtillery.findIndex(a => a.artilleryId === artilleryId);
            if (artilleryIndex !== -1) {
                artilleryData = peerData.loadedArtillery[artilleryIndex];
            }
        }

        // Unparent artillery from ship
        if (artilleryData?.mesh) {
            const artillery = artilleryData.mesh;
            if (artillery.parent) {
                artillery.parent.remove(artillery);
            }

            // If this was a peer-created artillery mesh, remove it
            if (artillery.userData?.isPeerArtillery) {
                artillery.traverse((child) => {
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
            } else {
                // This was an existing artillery - place it back in scene
                this.game?.scene?.add(artillery);
                artillery.position.fromArray(position);
                artillery.rotation.y = rotation;

                // Re-add to chunk tracking
                const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(position[0], position[2]);
                const newChunkKey = `${chunkX},${chunkZ}`;
                artillery.userData.chunkKey = newChunkKey;

                if (this.game?.chunkManager?.chunkObjects) {
                    let chunkObjects = this.game.chunkManager.chunkObjects.get(newChunkKey);
                    if (!chunkObjects) {
                        chunkObjects = [];
                        this.game.chunkManager.chunkObjects.set(newChunkKey, chunkObjects);
                    }
                    if (!chunkObjects.includes(artillery)) {
                        chunkObjects.push(artillery);
                        console.log(`[P2P] Re-added artillery ${artilleryId} to chunk ${newChunkKey} tracking`);
                    }
                }
            }
        }

        // Remove from loadedArtillery array
        if (artilleryIndex !== -1 && peerData.loadedArtillery) {
            peerData.loadedArtillery.splice(artilleryIndex, 1);
        }

        console.log(`[P2P] Peer ${fromPeer} unloaded artillery ${artilleryId}, ${peerData.loadedArtillery?.length || 0} remaining`);
    }

    /**
     * Handle horse loaded onto ship by peer
     * @private
     */
    handleHorseLoadedShip(payload, fromPeer, peerData) {
        const { horseId, slotIndex } = payload;

        // Mark horse as occupied
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.setOccupied(horseId, fromPeer);
        }

        // Get peer's ship mesh
        const shipMesh = peerData.mobileEntity?.mesh;
        const isOnShip2 = peerData.mobileEntity?.entityType === 'ship2';

        if (!shipMesh || !isOnShip2) {
            console.warn(`[P2P] Cannot visualize horse ${horseId} - peer not on ship2`);
            return;
        }

        // Get slot positioning from config
        const slotConfig = CONFIG.HORSE_VEHICLES?.ship2?.slots?.[slotIndex];
        if (!slotConfig) {
            console.warn(`[P2P] Invalid horse slot ${slotIndex} for ship2`);
            return;
        }

        // Initialize loadedHorses array if needed
        if (!peerData.loadedHorses) {
            peerData.loadedHorses = [];
        }

        // Try to find existing horse mesh
        let horseMesh = this.game?.objectRegistry?.get(horseId);

        if (horseMesh && shipMesh) {
            // Unparent from current parent
            if (horseMesh.parent) {
                horseMesh.parent.remove(horseMesh);
            }

            // Stop animation if running
            if (horseMesh.userData?.mixer) {
                horseMesh.userData.mixer.stopAllAction();
            }

            // Parent to ship at slot position
            shipMesh.add(horseMesh);
            horseMesh.position.set(slotConfig.x, slotConfig.y, slotConfig.z);
            horseMesh.rotation.set(0, Math.PI, 0);  // Face toward bow

            // Add to loadedHorses array
            peerData.loadedHorses.push({
                horseId,
                slotIndex,
                mesh: horseMesh
            });

            // Remove from chunk tracking to prevent disposal when chunk unloads
            if (horseMesh.userData?.chunkKey && this.game?.chunkManager) {
                const chunkKey = horseMesh.userData.chunkKey;
                const chunkObjects = this.game.chunkManager.chunkObjects.get(chunkKey);
                if (chunkObjects) {
                    const index = chunkObjects.indexOf(horseMesh);
                    if (index !== -1) {
                        chunkObjects.splice(index, 1);
                        console.log(`[P2P] Removed horse ${horseId} from chunk ${chunkKey} tracking (now on ship)`);
                    }
                }
            }

            console.log(`[P2P] Peer ${fromPeer} loaded horse ${horseId} onto ship slot ${slotIndex}`);
        } else {
            console.warn(`[P2P] Could not find horse mesh ${horseId} to load onto ship`);
        }
    }

    /**
     * Handle horse unloaded from ship by peer
     * @private
     */
    handleHorseUnloadedShip(payload, fromPeer, peerData) {
        const { horseId, position, rotation } = payload;

        // Clear occupied status
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.clearOccupied(horseId);
        }

        // Find horse in loadedHorses array
        let horseData = null;
        let horseIndex = -1;
        if (peerData.loadedHorses?.length > 0) {
            horseIndex = peerData.loadedHorses.findIndex(h => h.horseId === horseId);
            if (horseIndex !== -1) {
                horseData = peerData.loadedHorses[horseIndex];
            }
        }

        // Unparent horse from ship
        if (horseData?.mesh) {
            const horse = horseData.mesh;
            if (horse.parent) {
                horse.parent.remove(horse);
            }

            // Place it back in scene
            this.game?.scene?.add(horse);
            horse.position.fromArray(position);
            horse.rotation.y = rotation;

            // Re-add to chunk tracking
            const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(position[0], position[2]);
            const newChunkKey = `${chunkX},${chunkZ}`;
            horse.userData.chunkKey = newChunkKey;

            if (this.game?.chunkManager?.chunkObjects) {
                let chunkObjects = this.game.chunkManager.chunkObjects.get(newChunkKey);
                if (!chunkObjects) {
                    chunkObjects = [];
                    this.game.chunkManager.chunkObjects.set(newChunkKey, chunkObjects);
                }
                if (!chunkObjects.includes(horse)) {
                    chunkObjects.push(horse);
                    console.log(`[P2P] Re-added horse ${horseId} to chunk ${newChunkKey} tracking`);
                }
            }
        }

        // Remove from loadedHorses array
        if (horseIndex !== -1 && peerData.loadedHorses) {
            peerData.loadedHorses.splice(horseIndex, 1);
        }

        console.log(`[P2P] Peer ${fromPeer} unloaded horse ${horseId}, ${peerData.loadedHorses?.length || 0} remaining`);
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
            if (this.game?.brownBearController) {
                this.game.brownBearController.onPeerJoinedChunk(peerId, newChunkKey);
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

    // ==========================================
    // FULL STATE SYNC (P2P Recovery)
    // ==========================================

    /**
     * Handle comprehensive player state sync message
     * Used for initial sync on connection and periodic recovery
     * @param {object} message - The full state message
     * @param {string} fromPeer - The sender's peer ID
     * @param {object} peerData - The peer's game data
     * @param {THREE.Object3D} avatar - The peer's avatar mesh
     * @private
     */
    handlePlayerFullState(message, fromPeer, peerData, avatar) {
        // Update basic info
        if (message.username && peerData.username !== message.username) {
            peerData.username = message.username;
            if (this.game?.nameTagManager && avatar) {
                this.game.nameTagManager.registerEntity(`peer_${fromPeer}`, message.username, avatar);
            }
        }

        // Update faction
        if (message.factionId !== undefined && peerData.factionId !== message.factionId) {
            peerData.factionId = message.factionId;
            const entityId = `peer_${fromPeer}`;

            // Update name tag faction color
            if (this.game?.nameTagManager) {
                this.game.nameTagManager.setEntityFaction(entityId, message.factionId);
                if (this.game.gameState) {
                    const isEnemy = this.game.gameState.isEnemyFaction(message.factionId);
                    this.game.nameTagManager.setEntityEnemy(entityId, isEnemy);
                }
            }

            // Update shirt color
            if (this.game?.avatarManager) {
                this.game.avatarManager.setAvatarFaction(fromPeer, message.factionId);
            }
        }

        // Update equipment state
        peerData.hasRifle = message.hasRifle || false;
        peerData.speedMultiplier = message.speedMultiplier || 1.0;

        // Update position
        if (message.position) {
            if (!peerData.targetPosition) {
                peerData.targetPosition = new THREE.Vector3();
            }
            peerData.targetPosition.fromArray(message.position);
            peerData.lastUpdateTime = Date.now();
            this.updatePeerChunkRegistry(fromPeer, peerData, peerData.targetPosition);
        }

        // Sync all states (validate local state matches, create/cleanup as needed)
        this.syncClimbingState(message.climbing, fromPeer, peerData, avatar);
        this.syncMobileEntityState(message.piloting, fromPeer, peerData, avatar);
        this.syncCartState(message.towedCart, fromPeer, peerData);
        this.syncCrateState(message.loadedCrate, fromPeer, peerData);
        this.syncArtilleryTowingState(message.towedArtillery, fromPeer, peerData);
        this.syncArtilleryManningState(message.manningArtillery, fromPeer, peerData, avatar);
        this.syncHarvestState(message.harvesting, fromPeer, peerData, avatar);
    }

    /**
     * Sync climbing state - create or cleanup based on full state
     * @private
     */
    syncClimbingState(climbingState, fromPeer, peerData, avatar) {
        const hasClimbing = climbingState && climbingState.isClimbing;
        const localHasClimbing = peerData.isClimbing;

        if (hasClimbing && !localHasClimbing) {
            // Peer is climbing but we don't know - sync it
            console.log(`[FullState] Syncing missing climbing state for ${fromPeer}`);
            peerData.isClimbing = true;
            peerData.climbingOutpostId = climbingState.outpostId;
            peerData.climbingPhase = climbingState.phase;

            // Mark outpost as occupied
            if (this.game?.occupiedOutposts) {
                this.game.occupiedOutposts.set(climbingState.outpostId, fromPeer);
            }
        } else if (!hasClimbing && localHasClimbing) {
            // Peer stopped climbing but we still think they are - cleanup
            console.log(`[FullState] Cleaning up stale climbing state for ${fromPeer}`);
            if (this.game?.occupiedOutposts && peerData.climbingOutpostId) {
                this.game.occupiedOutposts.delete(peerData.climbingOutpostId);
            }
            peerData.isClimbing = false;
            peerData.isDescending = false;
            peerData.climbingOutpostId = null;
            peerData.climbingPhase = null;
            peerData.climbingTargetPosition = null;
        }
    }

    /**
     * Sync mobile entity state - create or cleanup based on full state
     * @private
     */
    syncMobileEntityState(pilotingState, fromPeer, peerData, avatar) {
        const hasPiloting = pilotingState && pilotingState.entityId;
        const localHasPiloting = peerData.mobileEntity && peerData.isPiloting;

        if (hasPiloting && !localHasPiloting) {
            // Peer is piloting but we don't have mesh - create it
            console.log(`[FullState] Creating missing mobile entity for ${fromPeer}`);
            this.handleMobileEntityEnter({
                entityId: pilotingState.entityId,
                entityType: pilotingState.entityType,
                position: pilotingState.position,
                rotation: pilotingState.rotation
            }, fromPeer, peerData, avatar);
        } else if (!hasPiloting && localHasPiloting) {
            // Peer stopped piloting but we still have mesh - clean up
            console.log(`[FullState] Cleaning up stale mobile entity for ${fromPeer}`);
            this.handleMobileEntityExit({
                playerPosition: peerData.targetPosition?.toArray()
            }, fromPeer, peerData, avatar);
        } else if (hasPiloting && localHasPiloting) {
            // Both have it - update position
            if (peerData.mobileEntity) {
                if (!peerData.mobileEntity.targetPosition) {
                    peerData.mobileEntity.targetPosition = new THREE.Vector3();
                }
                peerData.mobileEntity.targetPosition.fromArray(pilotingState.position);
                peerData.mobileEntity.targetRotation = pilotingState.rotation;
            }
        }
    }

    /**
     * Sync cart state - create or cleanup based on full state
     * @private
     */
    syncCartState(cartState, fromPeer, peerData) {
        const hasCart = cartState && cartState.cartId;
        const localHasCart = peerData.towedCart && peerData.towedCart.cartId;

        if (hasCart && !localHasCart) {
            // Peer has cart but we don't - create it
            console.log(`[FullState] Creating missing cart for ${fromPeer}`);
            this.handleCartAttached({
                cartId: cartState.cartId,
                position: cartState.position,
                rotation: cartState.rotation
            }, fromPeer, peerData);
        } else if (!hasCart && localHasCart) {
            // Peer dropped cart but we still have it - cleanup
            console.log(`[FullState] Cleaning up stale cart for ${fromPeer}`);
            this.handleCartReleased({
                cartId: peerData.towedCart.cartId,
                position: peerData.towedCart.position?.toArray(),
                rotation: peerData.towedCart.rotation
            }, fromPeer, peerData);
        } else if (hasCart && localHasCart) {
            // Both have it - update position
            if (peerData.towedCart) {
                if (!peerData.towedCart.targetPosition) {
                    peerData.towedCart.targetPosition = new THREE.Vector3();
                }
                peerData.towedCart.targetPosition.fromArray(cartState.position);
                peerData.towedCart.targetRotation = cartState.rotation;
            }
        }
    }

    /**
     * Sync crate state - create or cleanup based on full state
     * @private
     */
    syncCrateState(crateState, fromPeer, peerData) {
        const hasCrate = crateState && crateState.crateId;
        const localHasCrate = peerData.loadedCrate && peerData.loadedCrate.crateId;

        if (hasCrate && !localHasCrate && peerData.towedCart) {
            // Peer has crate on cart but we don't - create it
            console.log(`[FullState] Creating missing crate for ${fromPeer}`);
            this.handleCrateLoaded({
                crateId: crateState.crateId,
                cartId: peerData.towedCart.cartId
            }, fromPeer, peerData);
        } else if (!hasCrate && localHasCrate) {
            // Peer unloaded crate but we still have it - cleanup
            console.log(`[FullState] Cleaning up stale crate for ${fromPeer}`);
            this.handleCrateUnloaded({
                crateId: peerData.loadedCrate.crateId,
                position: peerData.towedCart?.position?.toArray() || [0, 0, 0],
                rotation: 0
            }, fromPeer, peerData);
        }
    }

    /**
     * Sync artillery towing state - create or cleanup based on full state
     * @private
     */
    syncArtilleryTowingState(artilleryState, fromPeer, peerData) {
        const hasArtillery = artilleryState && artilleryState.artilleryId;
        const localHasArtillery = peerData.towedArtillery && peerData.towedArtillery.artilleryId;

        if (hasArtillery && !localHasArtillery) {
            // Peer is towing artillery but we don't have it - create
            console.log(`[FullState] Creating missing towed artillery for ${fromPeer}`);
            this.handleArtilleryAttached({
                artilleryId: artilleryState.artilleryId,
                position: artilleryState.position,
                rotation: artilleryState.rotation
            }, fromPeer, peerData);
        } else if (!hasArtillery && localHasArtillery) {
            // Peer released artillery but we still have it - cleanup
            console.log(`[FullState] Cleaning up stale towed artillery for ${fromPeer}`);
            this.handleArtilleryReleased({
                artilleryId: peerData.towedArtillery.artilleryId,
                position: peerData.towedArtillery.position?.toArray(),
                rotation: peerData.towedArtillery.rotation
            }, fromPeer, peerData);
        } else if (hasArtillery && localHasArtillery) {
            // Both have it - update position
            if (peerData.towedArtillery) {
                if (!peerData.towedArtillery.targetPosition) {
                    peerData.towedArtillery.targetPosition = new THREE.Vector3();
                }
                peerData.towedArtillery.targetPosition.fromArray(artilleryState.position);
                peerData.towedArtillery.targetRotation = artilleryState.rotation;
            }
        }
    }

    /**
     * Sync artillery manning state - create or cleanup based on full state
     * @private
     */
    syncArtilleryManningState(manningState, fromPeer, peerData, avatar) {
        const hasManning = manningState && manningState.artilleryId;
        const localHasManning = peerData.mannedArtillery && peerData.mannedArtillery.artilleryId;

        if (hasManning && !localHasManning) {
            // Peer is manning artillery but we don't know - create
            console.log(`[FullState] Creating missing manned artillery for ${fromPeer}`);
            this.handleArtilleryManned({
                artilleryId: manningState.artilleryId,
                heading: manningState.heading
            }, fromPeer, peerData);
        } else if (!hasManning && localHasManning) {
            // Peer stopped manning but we still have it - cleanup
            console.log(`[FullState] Cleaning up stale manned artillery for ${fromPeer}`);
            this.handleArtilleryUnmanned({
                artilleryId: peerData.mannedArtillery.artilleryId
            }, fromPeer, peerData);
        } else if (hasManning && localHasManning) {
            // Both have it - update heading
            if (peerData.mannedArtillery) {
                peerData.mannedArtillery.heading = manningState.heading;
            }
        }
    }

    /**
     * Sync harvest state
     * @private
     */
    syncHarvestState(harvestState, fromPeer, peerData, avatar) {
        const hasHarvest = harvestState && harvestState.actionType;
        const localHasHarvest = peerData.harvestState && Date.now() < peerData.harvestState.endTime;

        if (hasHarvest && !localHasHarvest) {
            // Peer is harvesting but we don't know - set state
            const remainingDuration = harvestState.endTime - Date.now();
            if (remainingDuration > 0) {
                peerData.harvestState = {
                    harvestType: harvestState.harvestType,
                    actionType: harvestState.actionType,
                    endTime: harvestState.endTime,
                    startTime: Date.now(),
                    duration: remainingDuration
                };

                // Start animation if we have mixer
                if (avatar?.userData?.mixer && avatar?.userData?.choppingAction) {
                    avatar.userData.choppingAction.reset();
                    avatar.userData.choppingAction.play();
                }
            }
        } else if (!hasHarvest && localHasHarvest) {
            // Peer stopped harvesting - clear state
            peerData.harvestState = null;
            if (avatar?.userData?.choppingAction) {
                avatar.userData.choppingAction.stop();
            }
        }
    }
}

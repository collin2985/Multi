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
import { getChunkTransitionQueue, TASK_TYPE, PRIORITY } from '../systems/ChunkTransitionQueue.js';

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
     * Find the peer who is piloting a specific ship
     * @param {string} shipId - The ship's objectId or entityId
     * @returns {object|null} - { peerId, peerData, shipMesh } or null if not found
     */
    findShipPilotPeer(shipId) {
        if (!shipId) return null;

        // Check if LOCAL player is piloting this ship (not in peerGameData)
        const localVehicleState = this.game?.gameState?.vehicleState;
        if (localVehicleState?.isPiloting() && localVehicleState?.pilotingEntityId === shipId) {
            return {
                peerId: this.game?.gameState?.clientId,
                peerData: {
                    mobileEntity: {
                        speed: this.game?.mobileEntitySystem?.velocity || 0,
                        entityId: shipId
                    },
                    loadedArtillery: localVehicleState.loadedArtillery || []
                },
                shipMesh: localVehicleState.pilotingEntity
            };
        }

        if (!this.peerGameData) return null;

        // O(1) lookup: Check shipCrewRoster for pilot clientId
        const roster = this.game?.mobileEntitySystem?.getShipCrew(shipId);
        if (roster?.pilot) {
            const peerData = this.peerGameData.get(roster.pilot);
            if (peerData?.isPiloting && peerData?.mobileEntity) {
                return {
                    peerId: roster.pilot,
                    peerData,
                    shipMesh: peerData.mobileEntity.mesh
                };
            }
        }

        // Fallback: O(n) iteration if roster not available (e.g., late join before roster sync)
        for (const [peerId, peerData] of this.peerGameData) {
            if (peerData.isPiloting && peerData.mobileEntity) {
                const entityId = peerData.mobileEntity.entityId;
                const mesh = peerData.mobileEntity.mesh;
                const meshObjectId = mesh?.userData?.objectId;

                if (entityId === shipId || meshObjectId === shipId) {
                    return {
                        peerId,
                        peerData,
                        shipMesh: mesh
                    };
                }
            }
        }

        return null;
    }

    /**
     * Get ship mesh for a given shipId, checking pilot peers first then objectRegistry
     * Fixes Bug #1: External gunners don't have mobileEntity, need to find pilot peer
     * @param {string} shipId - The ship's objectId
     * @param {object} gunnerPeerData - The gunner's peer data (may not have ship reference)
     * @returns {THREE.Object3D|null} - The ship mesh or null
     */
    getShipMeshForGunner(shipId, gunnerPeerData) {
        // Check if LOCAL player is piloting this ship (not in peerGameData)
        const localVehicleState = this.game?.gameState?.vehicleState;
        if (localVehicleState?.isPiloting() &&
            localVehicleState?.pilotingEntityId === shipId &&
            localVehicleState?.pilotingEntity) {
            return localVehicleState.pilotingEntity;
        }

        // Try gunner's own mobileEntity (if they were the pilot who switched to gunner)
        if (gunnerPeerData?.mobileEntity?.mesh) {
            const meshId = gunnerPeerData.mobileEntity.mesh.userData?.objectId;
            const entityId = gunnerPeerData.mobileEntity.entityId;
            if (meshId === shipId || entityId === shipId) {
                return gunnerPeerData.mobileEntity.mesh;
            }
        }

        // Try gunner's saved ship mesh reference (for external gunners who never piloted)
        // This reference is saved when they first board and stays valid as ship moves
        if (gunnerPeerData?.mannedArtillery?.shipMesh?.parent) {
            const savedShipId = gunnerPeerData.mannedArtillery.shipId;
            if (savedShipId === shipId) {
                return gunnerPeerData.mannedArtillery.shipMesh;
            }
        }

        // Search for pilot peer who has this ship
        const pilotInfo = this.findShipPilotPeer(shipId);
        if (pilotInfo?.shipMesh) {
            return pilotInfo.shipMesh;
        }

        // Fallback to objectRegistry (for static/non-peer-piloted ships)
        return this.game?.objectRegistry?.get(shipId) || null;
    }

    /**
     * Get loadedArtillery data for a ship-mounted artillery
     * Fixes Bug #2: loadedArtillery is on pilot's peerData, not gunner's
     * @param {string} shipId - The ship's objectId
     * @param {string} artilleryId - The artillery ID to find
     * @param {object} gunnerPeerData - The gunner's peer data
     * @returns {object|null} - Artillery data { artilleryId, slotIndex, mesh } or null
     */
    getShipArtilleryData(shipId, artilleryId, gunnerPeerData) {
        // Check if LOCAL player is piloting this ship and has the artillery
        // Fixes Bug #3: When local player is pilot, artillery is in vehicleState, not peerGameData
        const localVehicleState = this.game?.gameState?.vehicleState;
        if (localVehicleState?.isPiloting() &&
            localVehicleState?.pilotingEntityId === shipId) {
            const localArtillery = localVehicleState.shipArtillery?.find(a =>
                a.artilleryId === artilleryId || a.id === artilleryId
            );
            if (localArtillery) {
                return localArtillery;
            }
        }

        // Check gunner's own loadedArtillery (if they were the pilot)
        if (gunnerPeerData?.loadedArtillery) {
            const artilleryData = gunnerPeerData.loadedArtillery.find(a => a.artilleryId === artilleryId);
            if (artilleryData) {
                return artilleryData;
            }
        }

        // Search pilot peer for loadedArtillery
        const pilotInfo = this.findShipPilotPeer(shipId);
        if (pilotInfo?.peerData?.loadedArtillery) {
            const artilleryData = pilotInfo.peerData.loadedArtillery.find(a => a.artilleryId === artilleryId);
            if (artilleryData) {
                return artilleryData;
            }
        }

        // Fallback: check gunner's mannedArtillery (mesh saved when they boarded)
        // This allows gunner to continue functioning even if pilot disconnects
        if (gunnerPeerData?.mannedArtillery?.artilleryId === artilleryId &&
            gunnerPeerData.mannedArtillery.mesh) {
            return {
                artilleryId,
                slotIndex: gunnerPeerData.mannedArtillery.slotIndex,
                mesh: gunnerPeerData.mannedArtillery.mesh
            };
        }

        return null;
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
            // Sync tentAIEnemies so dead body isn't targeted by artillery
            if (message.tentId && this.game?.aiEnemyManager) {
                this.game.aiEnemyManager.markTentAIDead(message.tentId);
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
                if (factionChanged && avatar && !avatar.userData?.isDead) {
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
                // Apply faction colors if avatar exists and is not dead
                if (avatar && !avatar.userData?.isDead) {
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

            // Store piloting state early (fixes peers on boats being invisible/underwater until avatar created)
            // This ensures the avatar is positioned on the boat immediately, not at terrain height
            if (message.piloting && message.piloting.entityId) {
                const pilotingState = message.piloting;
                // Only create if we don't already have it
                if (!peerData.mobileEntity || !peerData.isPiloting) {
                    peerData.mobileEntity = {
                        entityId: pilotingState.entityId,
                        entityType: pilotingState.entityType || 'boat',
                        position: new THREE.Vector3().fromArray(pilotingState.position),
                        rotation: pilotingState.rotation,
                        targetPosition: new THREE.Vector3().fromArray(pilotingState.position),
                        targetRotation: pilotingState.rotation,
                        mesh: null, // Will be created when avatar exists via syncMobileEntityState
                        lastPosition: new THREE.Vector3().fromArray(pilotingState.position),
                        isMoving: false
                    };
                    peerData.isPiloting = true;
                    // Clear walking target - avatar should follow mobileEntity.position
                    peerData.targetPosition = null;

                    // Mark entity as occupied early to prevent static mesh creation on object_added
                    if (this.game?.mobileEntitySystem) {
                        this.game.mobileEntitySystem.setOccupied(pilotingState.entityId, fromPeer);
                    }
                }
            } else if (!message.piloting && peerData.isPiloting) {
                // Peer stopped piloting - clean up (but keep position for walking)
                peerData.isPiloting = false;
                peerData.mobileEntity = null;
            }
        }

        // Handle auth_info before avatar check - store username early so nametag is correct
        // Also update nametag if avatar already exists (fixes "Player sessio" bug)
        if (message.type === 'auth_info' && peerData) {
            // Detect account change - if same clientId but different accountId, this is a new player
            const accountChanged = peerData.accountId && peerData.accountId !== message.accountId;
            peerData.accountId = message.accountId;

            // If account changed, reset avatar state (they're no longer dead, new identity)
            if (accountChanged) {
                const existingAvatar = this.avatars?.get(fromPeer);
                if (existingAvatar) {
                    // Reset death state - new account means fresh start
                    existingAvatar.userData.isDead = false;
                    existingAvatar.userData.deathStartTime = 0;
                    // Reset rotation (undo death fall animation)
                    if (existingAvatar.children[0]) {
                        existingAvatar.children[0].rotation.set(0, 0, 0);
                    }
                }
                // Reset nametag dead state
                const tagData = this.game?.nameTagManager?.tags.get(`peer_${fromPeer}`);
                if (tagData) {
                    tagData.isDead = false;
                }
            }

            if (message.username && (accountChanged || peerData.username !== message.username)) {
                peerData.username = message.username;
                // Update nametag if avatar exists
                const existingAvatar = this.avatars?.get(fromPeer);
                if (this.game?.nameTagManager && existingAvatar) {
                    this.game.nameTagManager.registerEntity(`peer_${fromPeer}`, message.username, existingAvatar);
                }
            }

            // Handle faction from auth_info (added for account change scenarios)
            if (message.factionId !== undefined) {
                const factionChanged = peerData.factionId !== message.factionId;
                peerData.factionId = message.factionId;

                // Apply faction colors if avatar exists and not dead
                const existingAvatar = this.avatars?.get(fromPeer);
                if (factionChanged && existingAvatar && !existingAvatar.userData?.isDead) {
                    if (this.game?.nameTagManager) {
                        this.game.nameTagManager.setEntityFaction(`peer_${fromPeer}`, message.factionId);
                    }
                    if (this.game?.avatarManager) {
                        this.game.avatarManager.setAvatarFaction(fromPeer, message.factionId);
                    }
                }
            }

            // Store spawn time for P2P kick logic (most recent spawner gets kicked on P2P failure)
            if (message.spawnTime) {
                peerData.spawnTime = message.spawnTime;
            }
            // Store spawn type for AI spawn protection (only 'random' spawns get protection)
            peerData.spawnType = message.spawnType || null;
            return;
        }

        // Handle mobile_entity_enter/exit before avatar check (fixes peers boarding boats before avatar created)
        // Similar to player_full_state early storage - stores state so avatar is positioned correctly on creation
        if (message.type === 'mobile_entity_enter' && peerData && message.payload) {
            const payload = message.payload;
            if (payload.entityId) {
                // Store piloting state early - mesh created when avatar exists via syncMobileEntityState
                if (!peerData.mobileEntity || !peerData.isPiloting) {
                    peerData.mobileEntity = {
                        entityId: payload.entityId,
                        entityType: payload.entityType || 'boat',
                        position: new THREE.Vector3().fromArray(payload.position),
                        rotation: payload.rotation,
                        targetPosition: new THREE.Vector3().fromArray(payload.position),
                        targetRotation: payload.rotation,
                        mesh: null,
                        lastPosition: new THREE.Vector3().fromArray(payload.position),
                        isMoving: false
                    };
                    peerData.isPiloting = true;
                    peerData.targetPosition = null;

                    // Mark entity as occupied early to prevent static mesh creation on object_added
                    if (this.game?.mobileEntitySystem) {
                        this.game.mobileEntitySystem.setOccupied(payload.entityId, fromPeer);
                    }
                }
            }
            // Don't return - if avatar exists, continue to switch statement for mesh creation
        }

        if (message.type === 'mobile_entity_exit' && peerData && !avatar) {
            // Peer exited vehicle before avatar exists - clean up piloting state
            peerData.isPiloting = false;
            peerData.mobileEntity = null;
            // Restore walking position if provided
            if (message.payload?.playerPosition) {
                if (!peerData.targetPosition) {
                    peerData.targetPosition = new THREE.Vector3();
                }
                peerData.targetPosition.fromArray(message.payload.playerPosition);
            }
            return;
        }

        // Handle mobile_entity_position before avatar check (keeps position updated for fallback rendering)
        if (message.type === 'mobile_entity_position' && peerData?.mobileEntity && message.payload) {
            const payload = message.payload;
            // Update position/rotation even without avatar - fallback path uses these
            peerData.mobileEntity.position.fromArray(payload.position);
            peerData.mobileEntity.rotation = payload.rotation;
            if (!peerData.mobileEntity.targetPosition) {
                peerData.mobileEntity.targetPosition = new THREE.Vector3();
            }
            peerData.mobileEntity.targetPosition.fromArray(payload.position);
            peerData.mobileEntity.targetRotation = payload.rotation;
            // If avatar doesn't exist yet, we're done - just storing position for later
            if (!avatar) {
                return;
            }
            // If avatar exists, continue to switch statement for full handling (mesh lerping, etc.)
        }

        // Handle artillery_manned before avatar check (store state for later mesh positioning)
        if (message.type === 'artillery_manned' && peerData && message.payload) {
            const payload = message.payload;
            if (payload.artilleryId && !peerData.mannedArtillery) {
                // Store manning state early - avatar positioning handled when avatar exists
                peerData.mannedArtillery = {
                    artilleryId: payload.artilleryId,
                    heading: payload.heading || 0,
                    mesh: null,
                    isShipMounted: payload.isShipMounted || false,
                    shipId: payload.shipId || null,
                    slotIndex: payload.slotIndex
                };
                // Mark artillery as occupied
                if (this.game?.mobileEntitySystem) {
                    this.game.mobileEntitySystem.setOccupied(payload.artilleryId, fromPeer);
                }
            }
            // Don't return - if avatar exists, continue to switch statement for full handling
        }

        if (!peerData || !avatar) {
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

            case 'player_logout':
                this.handlePlayerLogout(fromPeer, avatar);
                break;

            case 'player_death_disconnect':
                // Player died and is respawning - clean up their connection
                // This is similar to logout but specifically for death/respawn flow
                this.networkManager.cleanupPeer(fromPeer, this.game.scene);
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

            case 'ship_crew_left':
                this.handleShipCrewLeft(message.payload, fromPeer, peerData);
                break;

            case 'mobile_entity_sold': {
                const { entityId, entityType } = message.payload;
                this.handlePeerMobileEntitySold(fromPeer, entityId, entityType);
                break;
            }

            case 'mobile_entity_position':
                this.handleMobileEntityPosition(message.payload, fromPeer, peerData, avatar);
                break;

            case 'mobile_entity_boarded':
                this.handleMobileEntityBoarded(message.payload, fromPeer, peerData, avatar);
                break;

            case 'mobile_entity_phase':
                this.handleMobileEntityPhase(message.payload, fromPeer, peerData);
                break;

            // Unified towed entity handlers
            case 'towed_attached':
                if (message.payload.entityType === 'cart') {
                    this.handleCartAttached({ cartId: message.payload.entityId, ...message.payload }, fromPeer, peerData);
                } else if (message.payload.entityType === 'artillery') {
                    this.handleArtilleryAttached({ artilleryId: message.payload.entityId, ...message.payload }, fromPeer, peerData);
                }
                break;

            case 'towed_released':
                if (message.payload.entityType === 'cart') {
                    this.handleCartReleased({ cartId: message.payload.entityId, ...message.payload }, fromPeer, peerData);
                } else if (message.payload.entityType === 'artillery') {
                    this.handleArtilleryReleased({ artilleryId: message.payload.entityId, ...message.payload }, fromPeer, peerData);
                }
                break;

            case 'towed_position':
                if (message.payload.entityType === 'cart') {
                    this.handleCartPosition({ cartId: message.payload.entityId, ...message.payload }, fromPeer, peerData);
                } else if (message.payload.entityType === 'artillery') {
                    this.handleArtilleryPosition({ artilleryId: message.payload.entityId, ...message.payload }, fromPeer, peerData);
                }
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

            case 'ship_cargo_update':
                this.handleShipCargoUpdate(message.payload, fromPeer, peerData);
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

            case 'artillery_militia_fire':
                this.handleArtilleryMilitiaFire(message.payload, fromPeer, peerData);
                break;

            case 'artillery_damage':
                this.handleArtilleryDamage(message.payload, fromPeer, peerData);
                break;

            case 'artillery_boat_damage':
                this.handleArtilleryBoatDamage(message.payload, fromPeer, peerData);
                break;

            case 'peer_boat_sinking':
                this.handlePeerBoatSinking(message.payload, fromPeer, peerData);
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
        // Skip avatar position update if peer is piloting or manning ship artillery
        // This prevents player_pos messages from overwriting ship-following position data
        if ((peerData.isPiloting && peerData.mobileEntity) || peerData.mannedArtillery?.isShipMounted) {
            return;
        }

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
        // Skip avatar position update if peer is piloting, manning ship artillery, or climbing
        // This prevents player_tick messages from overwriting vehicle/climbing position data
        if ((peerData.isPiloting && peerData.mobileEntity) || peerData.mannedArtillery?.isShipMounted || peerData.isClimbing) {
            // Still update non-position state (rifle, combat, faction, etc.)
            peerData.lastUpdateTime = Date.now();
            peerData.hasRifle = message.hr || false;
            peerData.showCombatAnimation = message.c || false;
            peerData.peerIsMoving = message.m || false;
            peerData.speedMultiplier = message.s || 1.0;
            return;
        }

        // Reuse existing Vector3 to avoid GC pressure
        if (!peerData.targetPosition) {
            peerData.targetPosition = new THREE.Vector3();
        }
        peerData.targetPosition.fromArray(message.p);
        peerData.lastUpdateTime = Date.now(); // Tick doesn't have timestamp, use receive time

        // Update hasRifle state (for combat stance animations)
        peerData.hasRifle = message.hr || false;

        // Update combat animation state (synced from peer - authoritative)
        peerData.showCombatAnimation = message.c || false;

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

            // Skip visual updates for dead avatars (corpses shouldn't change colors)
            if (avatar && !avatar.userData?.isDead) {
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

            // Get shooter position - prefer payload.position (always sent) over avatar
            // (avatar may have stale position if shooter is on a moving ship)
            let shooterPos = null;
            if (payload.position && Array.isArray(payload.position)) {
                shooterPos = { x: payload.position[0], y: payload.position[1], z: payload.position[2] };
            } else if (avatar?.position) {
                shooterPos = avatar.position;
            }

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

            // For water vehicles: parent avatar to boat so it sinks with the boat
            // For land vehicles: just set avatar position as fallback
            if (waterVehicles.includes(entityType) && peerData.mobileEntity.mesh) {
                const peerBoatMesh = peerData.mobileEntity.mesh;

                // Parent avatar to boat mesh so it sinks together
                if (avatar) {
                    // Store original parent for later restoration
                    const originalParent = avatar.parent;

                    // Convert avatar world position to boat local position
                    const entityPos = peerBoatMesh.position;
                    avatar.position.set(entityPos.x, entityPos.y, entityPos.z);
                    peerBoatMesh.attach(avatar); // attach preserves world transform
                }

                // Play crash sound only if not already sinking
                const alreadySinking = entityId && this.game?.boatSinkingSystem?.isSinking(entityId);
                if (!alreadySinking && this.game?.audioManager) {
                    this.game.audioManager.playBoatCrashSound(entityType);
                }

                // Start sinking animation with callback to unparent avatar when done
                if (!alreadySinking && this.game?.boatSinkingSystem) {
                    this.game.boatSinkingSystem.startSinking(peerBoatMesh, entityId, () => {
                        // Unparent avatar from boat after sinking completes
                        if (avatar && avatar.parent === peerBoatMesh) {
                            this.game.scene.attach(avatar); // attach back to scene preserving world position
                        }
                    });
                }

                // Remove from active peer boats tracking
                this.activePeerBoats.delete(fromPeer);

                // Remove character controller (matches createBoatCharacterController)
                if (this.game?.physicsManager && peerBoatMesh.userData?.physicsBodyId) {
                    this.game.physicsManager.removeCharacterController(peerBoatMesh.userData.physicsBodyId);
                }

                // Unregister from animation system
                if (this.game?.animationSystem && peerBoatMesh.userData?.objectId) {
                    this.game.animationSystem.unregister(peerBoatMesh.userData.objectId);
                }

                // Clear the mesh reference (sinking system now owns it)
                peerData.mobileEntity.mesh = null;
            } else if (avatar && peerData.mobileEntity.mesh) {
                // Land vehicles: just set avatar position as fallback
                const entityPos = peerData.mobileEntity.mesh.position;
                avatar.position.set(entityPos.x, entityPos.y, entityPos.z);
            }

            // Clear occupancy so entity can be remounted (ISSUE-037 fix)
            if (entityId && this.game?.mobileEntitySystem) {
                this.game.mobileEntitySystem.clearOccupied(entityId);
            }

            // Clear mobile entity state so object_removed isn't blocked
            peerData.mobileEntity = null;
            peerData.isPiloting = false;
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
        }

        // If peer is climbing, mark them to die after descent completes
        if (peerData && peerData.isClimbing) {
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
     * Handle player logout - cleanup their avatar and data
     * If peer was dead, keep corpse visible (frozen). If alive, remove avatar.
     * @private
     */
    handlePlayerLogout(fromPeer, avatar) {
        const peerData = this.peerGameData.get(fromPeer);

        // Clean up mobile entity (sink water vehicles) even for dead peers
        if (peerData?.mobileEntity?.mesh) {
            const entityType = peerData.mobileEntity.entityType;
            const waterVehicles = ['boat', 'sailboat', 'ship2'];
            const mesh = peerData.mobileEntity.mesh;
            const entityId = peerData.mobileEntity.entityId;

            // Unregister from animation system
            if (this.game?.animationSystem && mesh.userData?.objectId) {
                this.game.animationSystem.unregister(mesh.userData.objectId);
            }
            // Remove character controller (matches createBoatCharacterController)
            if (this.game?.physicsManager && mesh.userData?.physicsBodyId) {
                this.game.physicsManager.removeCharacterController(mesh.userData.physicsBodyId);
            }

            if (waterVehicles.includes(entityType) && this.game?.boatSinkingSystem) {
                // Play crash sound only if not already sinking
                const alreadySinking = entityId && this.game.boatSinkingSystem.isSinking(entityId);
                if (!alreadySinking && this.game?.audioManager) {
                    this.game.audioManager.playBoatCrashSound(entityType);
                }
                // Start sinking - system handles mesh disposal when complete
                if (!alreadySinking) {
                    this.game.boatSinkingSystem.startSinking(mesh, entityId, null);
                }
            } else {
                // Non-water vehicles: instant removal
                if (this.game?.scene) {
                    this.game.scene.remove(mesh);
                }
                mesh.traverse((child) => {
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
            peerData.mobileEntity.mesh = null;

            // Clear occupancy
            if (entityId && this.game?.mobileEntitySystem) {
                this.game.mobileEntitySystem.clearOccupied(entityId);
            }

            // Clear active peer boats tracking
            if (this.activePeerBoats) {
                this.activePeerBoats.delete(fromPeer);
            }
        }

        // If peer was manning artillery, clear occupancy (mirrors handlePlayerDeath cleanup)
        if (peerData?.mannedArtillery) {
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
        }

        // If peer was dead, keep their corpse visible (frozen) but cleanup P2P state
        if (avatar?.userData?.isDead) {
            // Close P2P connection but DON'T remove avatar - corpse stays in scene
            this.networkManager.p2pTransport.closeIntentionally(fromPeer);
            this.peerGameData.delete(fromPeer);
            // Don't delete from avatars map - avatar mesh stays visible as frozen corpse
            return;
        }

        // If peer was alive, full cleanup (removes avatar from scene)
        if (this.networkManager.scene) {
            this.networkManager.cleanupPeer(fromPeer, this.networkManager.scene);
        }

        // Emit event
        this.emit('player_logout', { peerId: fromPeer });
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
        const entityId = payload.entityId;

        // TIEBREAKER: If I'm piloting this same entity, lowest clientId wins
        const myVehicleState = this.game?.gameState?.vehicleState;
        const myClientId = this.game?.gameState?.clientId;
        if (myVehicleState?.pilotingEntityId === entityId && myClientId && fromPeer < myClientId) {
            // I lose the tiebreaker - peer claimed first (lower clientId)
            // Clean up my local claim
            if (this.game?.activeVehicle?.mesh) {
                if (this.game.scene) {
                    this.game.scene.remove(this.game.activeVehicle.mesh);
                }
                this.game.activeVehicle.mesh.traverse?.((child) => {
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
            // Re-enable player character controller
            if (this.game?.physicsManager) {
                this.game.physicsManager.createCharacterController(
                    'player',
                    0.3,  // radius
                    1.0,  // height
                    this.game.playerObject?.position || { x: 0, y: 0, z: 0 }
                );
            }
            // Clear vehicle state
            myVehicleState.forceReset('claim conflict - lost tiebreaker');
            this.game.activeVehicle = null;
            // Clear occupied tracking
            if (this.game?.mobileEntitySystem) {
                this.game.mobileEntitySystem.clearOccupied(entityId);
            }
            // Notify user
            if (typeof ui !== 'undefined' && ui.showToast) {
                ui.showToast('Another player claimed this first', 'info');
            }
            // Continue to let peer's claim proceed below
        }

        // Guard: If already piloting SAME entity with mesh, just update position (avoid duplicate mesh creation)
        if (peerData.mobileEntity && peerData.mobileEntity.entityId === entityId) {
            if (peerData.mobileEntity.mesh) {
                peerData.mobileEntity.mesh.position.fromArray(payload.position);
                peerData.mobileEntity.mesh.rotation.y = payload.rotation;
                peerData.mobileEntity.targetPosition.fromArray(payload.position);
                peerData.mobileEntity.targetRotation = payload.rotation;
                return; // Only return early when mesh exists - otherwise continue to create it
            }
            // mesh is null (early storage case) - continue below to create it
        }

        // Guard: If already piloting a DIFFERENT entity, clean up old one first
        if (peerData.mobileEntity && peerData.mobileEntity.entityId !== entityId) {
            const oldMesh = peerData.mobileEntity.mesh;
            if (oldMesh) {
                // Remove from scene
                if (this.game?.scene) {
                    this.game.scene.remove(oldMesh);
                }
                // Clear character controller (matches createBoatCharacterController)
                if (this.game?.physicsManager && oldMesh.userData?.physicsBodyId) {
                    this.game.physicsManager.removeCharacterController(oldMesh.userData.physicsBodyId);
                }
                // Dispose mesh
                oldMesh.traverse((child) => {
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
            // Clear old occupancy
            if (peerData.mobileEntity.entityId && this.game?.mobileEntitySystem) {
                this.game.mobileEntitySystem.clearOccupied(peerData.mobileEntity.entityId);
            }
            // Clear active peer boats tracking if applicable
            if (this.activePeerBoats) {
                this.activePeerBoats.delete(fromPeer);
            }
        }

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

        // Store boarding animation state for peer (Issues #5, #13)
        if (payload.phase === 'boarding') {
            peerData.vehiclePhase = 'boarding';
            peerData.boardingStartTime = Date.now();
            peerData.boardingDuration = payload.boardingDuration || 500;
            peerData.boardingStartPosition = payload.playerStartPosition
                ? new THREE.Vector3().fromArray(payload.playerStartPosition)
                : null;
        } else {
            peerData.vehiclePhase = 'piloting';
            peerData.boardingStartTime = null;
            peerData.boardingStartPosition = null;
        }

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
                // Store ORIGINAL entityId for occupancy checks (mobileEntitySystem uses original ID)
                entityMesh.userData.originalEntityId = payload.entityId;
                // Store modelType for InteractionManager compatibility (gunner boarding, proximity checks)
                entityMesh.userData.modelType = entityType;

                // Store reference for updates and cleanup
                peerData.mobileEntity.mesh = entityMesh;

                // Add mesh to scene (objectPlacer.createInstance only returns mesh, doesn't add it)
                this.game.scene.add(entityMesh);

                // Register peer mesh in objectRegistry so InteractionManager can find it
                // (Uses peer-specific objectId as key, enables proximity-based interactions like gunner boarding)
                if (this.game?.objectRegistry) {
                    this.game.objectRegistry.set(entityMesh.userData.objectId, entityMesh);
                }

                // Hide the static entity from scene if it still exists
                // (we have our own peer-controlled mesh now)
                const existingStaticEntity = this.game?.objectRegistry?.get(payload.entityId);
                if (existingStaticEntity) {
                    existingStaticEntity.visible = false;

                    // Unregister from StructureModelSystem to prevent LOD updates from re-showing it
                    // (StructureModelSystem.updateStructureModels would override visible=false)
                    if (this.game?.structureModelSystem) {
                        this.game.structureModelSystem.unregisterStructure(payload.entityId);
                    }

                    // Unregister from AnimationSystem to stop wave updates on the hidden static mesh
                    if (this.game?.animationSystem) {
                        this.game.animationSystem.unregister(payload.entityId);
                    }

                    // Remove the static collider so it doesn't block placement at the original position
                    // (peer boat creates its own kinematic collider that follows its movement)
                    if (this.game?.physicsManager) {
                        this.game.physicsManager.removeCollider(payload.entityId);
                    }
                    // Re-add to registry (removeCollider triggers callback that deletes it)
                    // This ensures the static mesh can be found later when peer disembarks
                    if (this.game?.objectRegistry) {
                        this.game.objectRegistry.set(payload.entityId, existingStaticEntity);
                    }
                } else {
                    // Static mesh not found but collider might exist (race condition with chunk loading)
                    // Remove static collider by entityId as a fallback
                    if (this.game?.physicsManager) {
                        this.game.physicsManager.removeCollider(payload.entityId);
                    }
                }

                // Entity-specific setup
                const waterVehicleTypes = ['boat', 'sailboat', 'ship2'];
                if (waterVehicleTypes.includes(entityType)) {
                    // Flag for AnimationSystem to not override rotation (peer boats are rotated by AvatarManager)
                    entityMesh.userData.isPeerBoat = true;

                    // Add faction flag to ship2 peer meshes
                    if (entityType === 'ship2' && this.game.sceneObjectFactory) {
                        this.game.sceneObjectFactory.addFactionFlag(entityMesh, payload.ownerFactionId);
                    }

                    // Register with animation system for wave bobbing
                    if (this.game.animationSystem) {
                        this.game.animationSystem.registerShip(entityMesh);
                    }

                    // Bug #9 fix: Process any pending artillery loads now that ship mesh exists
                    if (entityType === 'ship2' && peerData.pendingArtilleryLoads?.length > 0) {
                        for (const pendingPayload of peerData.pendingArtilleryLoads) {
                            this.handleArtilleryLoadedShip(pendingPayload, fromPeer, peerData);
                        }
                        peerData.pendingArtilleryLoads = [];
                    }

                    // Process any pending horse loads now that ship mesh exists
                    if (entityType === 'ship2' && peerData.pendingHorseLoads?.length > 0) {
                        for (const pendingPayload of peerData.pendingHorseLoads) {
                            this.handleHorseLoadedShip(pendingPayload, fromPeer, peerData);
                        }
                        peerData.pendingHorseLoads = [];
                    }

                    // Process any pending crate loads now that boat mesh exists
                    const boatTypesForCrates = ['boat', 'sailboat', 'ship2'];
                    if (boatTypesForCrates.includes(entityType) && peerData.pendingCrateLoads?.length > 0) {
                        for (const pendingPayload of peerData.pendingCrateLoads) {
                            this.handleCrateLoaded(pendingPayload, fromPeer, peerData);
                        }
                        peerData.pendingCrateLoads = [];
                    }

                    // Create kinematic collider for peer boat (so local player's boat can collide with it)
                    // Use createBoatCharacterController for parity with local player's boat physics
                    if (this.game?.physicsManager) {
                        const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[entityType];
                        if (dims) {
                            const COLLIDER_SHRINK = 0.3; // Match local player's collider shrink
                            const shape = {
                                type: 'cuboid',
                                width: dims.width - COLLIDER_SHRINK,
                                depth: dims.depth - COLLIDER_SHRINK,
                                height: dims.height || 1.5
                            };
                            const peerBoatId = `peer_${entityType}_${fromPeer}`;
                            const initialRotation = peerData.mobileEntity.rotation || 0;
                            this.game.physicsManager.createBoatCharacterController(
                                peerBoatId,
                                shape,
                                entityMesh.position,
                                initialRotation
                            );
                            entityMesh.userData.physicsBodyId = peerBoatId;
                        }
                    }
                } else if (entityType === 'horse') {
                    // Setup horse animation
                    this.setupPeerHorseAnimation(peerData, entityMesh);
                }
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
            peerData.mobileEntity.walkAction.play();
        }
    }

    /**
     * Handle mobile entity phase change (Issues #5, #43, #44, #45)
     * Syncs vehicle phase (boarding/piloting/disembarking) for peer animation
     * @private
     */
    handleMobileEntityPhase(payload, fromPeer, peerData) {
        if (!peerData) return;

        const { phase } = payload;
        peerData.vehiclePhase = phase;

        if (phase === 'piloting') {
            // Boarding complete - clear animation state
            peerData.boardingStartTime = null;
            peerData.boardingStartPosition = null;
            peerData.boardingDuration = null;
        } else if (phase === 'disembarking') {
            // Start disembark animation
            peerData.disembarkStartTime = Date.now();
            peerData.disembarkDuration = payload.duration || 500;
            peerData.disembarkStartPosition = payload.playerStartPosition
                ? new THREE.Vector3().fromArray(payload.playerStartPosition)
                : null;
            peerData.disembarkTargetPosition = payload.playerTargetPosition
                ? new THREE.Vector3().fromArray(payload.playerTargetPosition)
                : null;
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
        const originalEntityId = peerData.mobileEntity.mesh?.userData?.originalEntityId || entityId;

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
                // Remove character controller for peer boat (matches createBoatCharacterController)
                if (this.game?.physicsManager && peerData.mobileEntity.mesh?.userData?.physicsBodyId) {
                    this.game.physicsManager.removeCharacterController(peerData.mobileEntity.mesh.userData.physicsBodyId);
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

            // Remove from objectRegistry (was registered on enter for proximity interactions)
            if (this.game?.objectRegistry && peerBoatMesh?.userData?.objectId) {
                this.game.objectRegistry.delete(peerBoatMesh.userData.objectId);
            }

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
            peerData.mobileEntity.mesh = null; // Clear reference but don't dispose
        } else {
            // Normal dismount - remove peer's local copy
            // Server will broadcast object_added with correct position
            if (peerData.mobileEntity.mesh) {
                // Check if local player is a gunner on this ship (Issue #4)
                // If so, DON'T dispose the mesh - keep it for the gunner to use
                const vState = this.game?.gameState?.vehicleState;
                const shipEntityId = peerData.mobileEntity.mesh.userData?.originalEntityId ||
                                     peerData.mobileEntity.mesh.userData?.objectId;
                const isLocalGunnerOnShip = entityType === 'ship2' &&
                    vState?.isActive() &&
                    vState?.isCrewing() &&
                    vState?.pilotingEntityId === shipEntityId;

                if (isLocalGunnerOnShip) {
                    // Local player is gunner - keep mesh in scene, just clear peer reference
                    peerData.mobileEntity.mesh = null;
                } else {
                    // No local gunner - safe to dispose
                    // Remove from objectRegistry (was registered on enter for proximity interactions)
                    if (this.game?.objectRegistry && peerData.mobileEntity.mesh.userData?.objectId) {
                        this.game.objectRegistry.delete(peerData.mobileEntity.mesh.userData.objectId);
                    }

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
        }

        // Clear mobile entity state
        peerData.mobileEntity = null;
        peerData.isPiloting = false;

        // Clear vehicle phase animation state (Issues #5, #43, #44, #45)
        peerData.vehiclePhase = null;
        peerData.boardingStartTime = null;
        peerData.boardingStartPosition = null;
        peerData.boardingDuration = null;
        peerData.disembarkStartTime = null;
        peerData.disembarkStartPosition = null;
        peerData.disembarkTargetPosition = null;
        peerData.disembarkDuration = null;

        // Clear entity occupancy in local tracking
        if (entityId && this.game && this.game.mobileEntitySystem) {
            this.game.mobileEntitySystem.clearOccupied(entityId);
            // Clear peer from crew roster (for ship2)
            if (entityType === 'ship2') {
                const role = this.game.mobileEntitySystem.getCrewRole(entityId, fromPeer);
                if (role) {
                    this.game.mobileEntitySystem.clearShipCrewMember(entityId, role);
                }
                // If no one aboard anymore, clear entire roster
                if (!this.game.mobileEntitySystem.isAnyoneAboard(entityId)) {
                    this.game.mobileEntitySystem.clearShipCrew(entityId);
                }
            }
        }

        // Move avatar to disembark position
        if (avatar && payload.playerPosition) {
            avatar.position.fromArray(payload.playerPosition);
        }

        // Emit event
        this.emit('mobile_entity_exit', { peerId: fromPeer, entityId: entityId, entityType: entityType });
    }

    /**
     * Handle peer leaving ship crew without ship destruction
     * Ship survives because other crew members remain aboard
     * @private
     */
    handleShipCrewLeft(payload, fromPeer, peerData) {
        const { shipId, role, reason } = payload;

        // Clear peer from crew roster
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.clearShipCrewMember(shipId, role);

            // If peer was pilot, clear helm occupancy
            if (role === 'pilot') {
                this.game.mobileEntitySystem.clearOccupied(shipId);
            }
        }

        // Clear peer's mobile entity state (they're off the ship)
        if (peerData.mannedArtillery) {
            // Clear artillery occupancy if they were manning
            if (this.game?.mobileEntitySystem) {
                this.game.mobileEntitySystem.clearOccupied(peerData.mannedArtillery.artilleryId);
            }
            peerData.mannedArtillery = null;
        }
        peerData.mobileEntity = null;
        peerData.isPiloting = false;

        // Notify local player if they're a gunner on this ship and pilot left
        if (role === 'pilot' && this.game?.gameState?.vehicleState?.isCrewing()) {
            const localShipId = this.game.gameState.vehicleState.pilotingEntityId;
            if (localShipId === shipId) {
                const reasonText = reason === 'death' ? 'died' : 'left the ship';
                if (typeof ui !== 'undefined' && ui.showToast) {
                    ui.showToast(`Pilot ${reasonText} - Take Helm to continue`, 'warning');
                }
            }
        }

        // Emit event for any listeners
        this.emit('ship_crew_left', { peerId: fromPeer, shipId, role, reason });
    }

    /**
     * Handle peer taking control of a vehicle they were crewing (e.g., gunner takes helm)
     * This transitions them from mannedArtillery state to isPiloting state
     * @private
     */
    handleMobileEntityBoarded(payload, fromPeer, peerData, avatar) {
        const { entityId, entityType, position, rotation } = payload;

        // Clear artillery manning state if they were a gunner
        if (peerData.mannedArtillery) {
            if (this.game?.mobileEntitySystem) {
                this.game.mobileEntitySystem.clearOccupied(peerData.mannedArtillery.artilleryId);
                // Clear their gunner position from crew roster
                const shipId = peerData.mannedArtillery.shipId;
                if (shipId) {
                    const oldRole = this.game.mobileEntitySystem.getCrewRole(shipId, fromPeer);
                    if (oldRole) {
                        this.game.mobileEntitySystem.clearShipCrewMember(shipId, oldRole);
                    }
                }
            }
            peerData.mannedArtillery = null;
        }

        // Find the ship mesh (might already exist as peer's mobileEntity or in objectRegistry)
        let shipMesh = peerData.mobileEntity?.mesh;
        if (!shipMesh) {
            shipMesh = this.game?.objectRegistry?.get(entityId);
        }

        // Set up mobileEntity state for piloting
        if (!peerData.mobileEntity) {
            peerData.mobileEntity = {
                entityId: entityId,
                entityType: entityType,
                position: new THREE.Vector3(),
                rotation: rotation || 0,
                targetPosition: new THREE.Vector3(),
                targetRotation: rotation || 0,
                mesh: shipMesh
            };
        }

        // Update ship position (mobileEntity.targetPosition is for the ship mesh)
        if (shipMesh) {
            peerData.mobileEntity.targetPosition.copy(shipMesh.position);
        }
        if (rotation !== undefined) {
            peerData.mobileEntity.targetRotation = rotation;
        }

        // Set piloting state
        peerData.isPiloting = true;

        // Mark entity as occupied by this peer
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.setOccupied(entityId, fromPeer);
            // Add peer to crew roster as pilot (for ship2)
            if (entityType === 'ship2') {
                this.game.mobileEntitySystem.setShipCrewMember(entityId, 'pilot', fromPeer);
            }
        }

        // Update target position for avatar rendering
        if (!peerData.targetPosition) {
            peerData.targetPosition = new THREE.Vector3();
        }
        if (position && Array.isArray(position) && position.length >= 3) {
            peerData.targetPosition.set(position[0], position[1], position[2]);
        }
        peerData.lastUpdateTime = Date.now();
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

            // Also check rotation change (turning) - needed for horse animation during turns
            const lastRotation = peerData.mobileEntity.lastRotation ?? peerData.mobileEntity.rotation;
            const rotationDelta = Math.abs(payload.rotation - lastRotation);
            const isTurning = rotationDelta > 0.01;  // ~0.5 degrees
            peerData.mobileEntity.lastRotation = payload.rotation;

            peerData.mobileEntity.isMoving = distance > 0.01 || isTurning;

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

            // Update chunk registry for all gunners on this ship
            // When ship moves, gunners' chunks must stay in sync with ship position
            const shipId = peerData.mobileEntity?.entityId;
            if (shipId && this.game?.mobileEntitySystem) {
                const crew = this.game.mobileEntitySystem.getShipCrew(shipId);
                if (crew) {
                    const gunnerRoles = ['portGunner', 'starboardGunner'];
                    for (const role of gunnerRoles) {
                        const gunnerId = crew[role];
                        if (gunnerId && gunnerId !== fromPeer) {
                            const gunnerData = this.peerGameData?.get(gunnerId);
                            if (gunnerData?.mannedArtillery?.isShipMounted) {
                                if (!gunnerData.targetPosition) {
                                    gunnerData.targetPosition = new THREE.Vector3();
                                }
                                gunnerData.targetPosition.copy(peerData.targetPosition);
                                this.updatePeerChunkRegistry(gunnerId, gunnerData, gunnerData.targetPosition);
                            }
                        }
                    }
                }
            }
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

        // Remove physics collider so cart doesn't block at old position
        if (this.game?.physicsManager) {
            this.game.physicsManager.removeCollider(cartId);
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
            } else {
                console.warn(`[P2P] Failed to create cart mesh - model not loaded`);
            }
        } else {
            console.warn(`[P2P] Cannot create cart mesh - no scene available`);
        }

        // Hide the static cart from scene if it still exists (we have our own peer mesh now)
        const existingStaticCart = this.game?.objectRegistry?.get(cartId);
        if (existingStaticCart) {
            existingStaticCart.visible = false;

            // Unregister from StructureModelSystem to prevent LOD updates from re-showing it
            // (StructureModelSystem.updateStructureModels would override visible=false)
            if (this.game?.structureModelSystem) {
                this.game.structureModelSystem.unregisterStructure(cartId);
            }

            // Remove billboard if exists
            if (this.game?.billboardSystem) {
                this.game.billboardSystem.removeTreeBillboard(existingStaticCart);
            }
        }
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
            }
        }

        // Clear peer's cart state
        // Note: peerData.loadedCrate is NOT cleared here - crate_unloaded will handle it
        peerData.towedCart = null;
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
            originalArtilleryId: artilleryId,
            hasMilitia: payload.hasMilitia || false,
            militiaOwner: payload.militiaOwner || null,
            militiaFaction: payload.militiaFaction || null,
            militiaType: payload.militiaType || null
        };

        // Create a new peer-controlled artillery mesh
        // NOTE: Must happen BEFORE removeCollider, which triggers onObjectRemoved
        // and deletes the artillery from objectRegistry as a side effect.
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
                artilleryMesh.userData.modelType = 'artillery';

                peerData.towedArtillery.mesh = artilleryMesh;
                this.game.scene.add(artilleryMesh);
            } else {
                console.warn(`[P2P] Failed to create artillery mesh - model not loaded`);
            }
        } else {
            console.warn(`[P2P] Cannot create artillery mesh - no scene available`);
        }

        // Hide the static artillery from scene while it still exists in objectRegistry
        // NOTE: Must happen BEFORE removeCollider, which deletes from objectRegistry.
        const existingStaticArtillery = this.game?.objectRegistry?.get(artilleryId);
        if (existingStaticArtillery) {
            existingStaticArtillery.visible = false;

            // Unregister from StructureModelSystem to prevent LOD updates from re-showing it
            if (this.game?.structureModelSystem) {
                this.game.structureModelSystem.unregisterStructure(artilleryId);
            }

            // Remove billboard if exists
            if (this.game?.billboardSystem) {
                this.game.billboardSystem.removeTreeBillboard(existingStaticArtillery);
            }
        }

        // Mark artillery as occupied
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.setOccupied(artilleryId, fromPeer);
        }

        // Remove physics collider so artillery doesn't block at old position
        // NOTE: This triggers onObjectRemoved which deletes from objectRegistry — must be last.
        if (this.game?.physicsManager) {
            this.game.physicsManager.removeCollider(artilleryId);
        }
    }

    /**
     * Handle artillery released by peer (peer stops towing)
     * @private
     */
    handleArtilleryReleased(payload, fromPeer, peerData) {
        const { artilleryId, position, rotation, hasMilitia, militiaOwner, militiaFaction, militiaType } = payload;

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
            }
        }

        // Restore the original static artillery that was hidden during attach
        const staticArtillery = this.game?.objectRegistry?.get(artilleryId);
        if (staticArtillery && position) {
            // Update position/rotation to the release location
            staticArtillery.position.fromArray(position);
            staticArtillery.rotation.y = rotation || 0;

            // Update militia userData
            staticArtillery.userData.hasMilitia = hasMilitia || false;
            staticArtillery.userData.militiaOwner = militiaOwner || null;
            staticArtillery.userData.militiaFaction = militiaFaction || null;
            staticArtillery.userData.militiaType = militiaType || null;

            // Re-show the static artillery
            staticArtillery.visible = true;

            // Compute new chunk key and re-register with StructureModelSystem
            const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(position[0], position[2]);
            const newChunkKey = `${chunkX},${chunkZ}`;
            staticArtillery.userData.chunkKey = newChunkKey;

            if (this.game?.structureModelSystem) {
                this.game.structureModelSystem.registerStructure(staticArtillery, 'artillery', newChunkKey);
            }
        }

        // Clear peer's artillery state
        peerData.towedArtillery = null;
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
        const { artilleryId, heading, isShipMounted, shipId, slotIndex, position } = payload;

        // Mark artillery as occupied
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.setOccupied(artilleryId, fromPeer);
        }

        // Handle ship-mounted artillery differently - mesh is already a child of the ship
        if (isShipMounted && shipId) {
            if (this.game?.mobileEntitySystem) {
                // Update crew roster: clear old position, set new gunner position
                const oldRole = this.game.mobileEntitySystem.getCrewRole(shipId, fromPeer);
                // Only clear ship occupancy if peer was the pilot (switching to gunner)
                // Don't clear if external gunner boarding - pilot is still at helm
                if (oldRole === 'pilot') {
                    this.game.mobileEntitySystem.clearOccupied(shipId);
                }
                if (oldRole) {
                    this.game.mobileEntitySystem.clearShipCrewMember(shipId, oldRole);
                }
                const newRole = slotIndex === 0 ? 'starboardGunner' : 'portGunner';
                this.game.mobileEntitySystem.setShipCrewMember(shipId, newRole, fromPeer);
            }
            // Find actual artillery mesh on ship for inventory access
            // Use helper to find ship mesh (fixes bug where external gunners lack mobileEntity)
            const shipMesh = this.getShipMeshForGunner(shipId, peerData);
            let artilleryMesh = null;
            if (shipMesh) {
                // Use helper to find artillery data from pilot peer
                const artilleryData = this.getShipArtilleryData(shipId, artilleryId, peerData);
                artilleryMesh = artilleryData?.mesh || null;
            } else {
                console.error('[handleArtilleryManned] Could not find ship mesh for external gunner', {
                    shipId, artilleryId, peerId: fromPeer
                });
            }

            // Store manning state for peer (with actual mesh reference for inventory access)
            peerData.mannedArtillery = {
                artilleryId,
                heading: heading || 0,
                mesh: artilleryMesh,  // Store actual mesh so UI can read inventory
                isShipMounted: true,
                shipId,
                slotIndex,
                shipMesh  // Save ship mesh reference so gunner doesn't depend on pilot staying connected
            };

            // Update peer's target position to ship deck level so avatar renders correctly
            if (!peerData.targetPosition) {
                peerData.targetPosition = new THREE.Vector3();
            }

            // Use position from payload if provided (most reliable)
            if (position && Array.isArray(position) && position.length >= 3) {
                peerData.targetPosition.set(position[0], position[1], position[2]);
                peerData.lastUpdateTime = Date.now();
                // Update chunk registry so AI systems know gunner's location
                this.updatePeerChunkRegistry(fromPeer, peerData, peerData.targetPosition);
                return;
            }

            // Fallback: use artillery mesh position if we found it
            if (artilleryMesh) {
                const artilleryWorldPos = new THREE.Vector3();
                artilleryMesh.getWorldPosition(artilleryWorldPos);
                peerData.targetPosition.copy(artilleryWorldPos);
                peerData.lastUpdateTime = Date.now();
            } else if (shipMesh?.position) {
                // Last resort fallback: position at ship center
                peerData.targetPosition.copy(shipMesh.position);
                peerData.lastUpdateTime = Date.now();
            }

            // Update chunk registry so AI systems know gunner's location
            this.updatePeerChunkRegistry(fromPeer, peerData, peerData.targetPosition);
            return;
        }

        // Get existing static artillery to copy position from
        const existingArtillery = this.game?.objectRegistry?.get(artilleryId);
        const artilleryPos = existingArtillery?.position?.clone() || new THREE.Vector3();
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
                artilleryMesh.position.copy(artilleryPos);
                artilleryMesh.rotation.y = rotation;

                const modelConfig = MODEL_CONFIG['artillery'];
                const baseScale = modelConfig?.baseScale || 1.0;
                artilleryMesh.scale.setScalar(baseScale);

                artilleryMesh.userData.isPeerArtillery = true;
                artilleryMesh.userData.peerId = fromPeer;
                artilleryMesh.userData.objectId = `peer_manned_artillery_${fromPeer}`;
                artilleryMesh.userData.modelType = 'artillery';

                peerData.mannedArtillery.mesh = artilleryMesh;
                this.game.scene.add(artilleryMesh);
            } else {
                console.warn(`[P2P] Failed to create manned artillery mesh - model not loaded`);
            }
        }

        // Hide the static artillery from scene if it still exists
        if (existingArtillery && existingArtillery.userData?.objectId === artilleryId) {
            existingArtillery.visible = false;
        }
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
            // Clear peer's gunner position from crew roster
            const shipId = peerData.mannedArtillery.shipId;
            if (shipId && this.game?.mobileEntitySystem) {
                const role = this.game.mobileEntitySystem.getCrewRole(shipId, fromPeer);
                if (role) {
                    this.game.mobileEntitySystem.clearShipCrewMember(shipId, role);
                }
            }
            peerData.mannedArtillery = null;
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
        }

        // Clear manning state
        peerData.mannedArtillery = null;
    }

    /**
     * Handle artillery aim (peer rotating artillery while manning)
     * @private
     */
    handleArtilleryAim(payload, fromPeer, peerData) {
        const { artilleryId, heading, isShipMounted, shipId } = payload;

        if (peerData.mannedArtillery && peerData.mannedArtillery.artilleryId === artilleryId) {
            peerData.mannedArtillery.heading = heading;

            // Handle ship-mounted artillery - find mesh via helper (fixes external gunner lookup)
            if (isShipMounted && shipId) {
                const artilleryData = this.getShipArtilleryData(shipId, artilleryId, peerData);
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
        const { artilleryId, heading, impactPos, isHit, targetType, structureId, isShipMounted } = payload;

        // Find artillery mesh - check different locations based on whether ship-mounted
        let artilleryMesh = null;
        if (isShipMounted) {
            // Ship-mounted artillery: use helper to find from pilot peer (fixes external gunner lookup)
            const shipId = peerData?.mannedArtillery?.shipId;
            if (shipId) {
                const artilleryData = this.getShipArtilleryData(shipId, artilleryId, peerData);
                artilleryMesh = artilleryData?.mesh;
            }
        }
        if (!artilleryMesh) {
            // Land artillery or fallback: check mannedArtillery.mesh or objectRegistry
            artilleryMesh = peerData?.mannedArtillery?.mesh || this.game?.objectRegistry?.get(artilleryId);
        }

        // Spawn muzzle flash and smoke at artillery position (requires mesh)
        if (artilleryMesh && this.game?.effectManager) {
            // Get artillery world position (important for ship-mounted artillery where .position is local)
            const artilleryWorldPos = new THREE.Vector3();
            artilleryMesh.getWorldPosition(artilleryWorldPos);

            // Calculate barrel position (barrel faces opposite to towing direction)
            const barrelOffset = CONFIG?.ARTILLERY_COMBAT?.BARREL_OFFSET || { x: 0, y: 0.6, z: 1.2 };
            const barrelDir = CONFIG?.ARTILLERY_COMBAT?.BARREL_DIRECTION || -1;
            const barrelPos = {
                x: artilleryWorldPos.x + barrelDir * Math.sin(heading) * barrelOffset.z,
                y: artilleryWorldPos.y + barrelOffset.y,
                z: artilleryWorldPos.z + barrelDir * Math.cos(heading) * barrelOffset.z
            };

            // Spawn muzzle effects
            this.game.effectManager.spawnArtilleryMuzzleFlash(barrelPos);
            this.game.effectManager.spawnArtillerySmoke(barrelPos);

            // Play artillery sound
            if (this.game?.audioManager) {
                this.game.audioManager.playPositionalSound('artillery', artilleryMesh);
            }
        }

        // Spawn impact effect at target location (doesn't require artillery mesh)
        // This is critical for the target to see the near-miss/hit effect
        if (impactPos && this.game?.effectManager) {
            const impact = {
                x: impactPos[0],
                y: impactPos[1],
                z: impactPos[2]
            };
            this.game.effectManager.spawnArtilleryImpact(impact, isHit);
        }

        // Notify ambient sound system of combat (silences plains/forest)
        if (this.game?.ambientSoundSystem) {
            this.game.ambientSoundSystem.onCombatActivity();
        }

    }

    /**
     * Handle artillery militia fire (AI-controlled artillery)
     * Shows effects for peer-controlled militia artillery fire
     * @private
     */
    handleArtilleryMilitiaFire(payload, fromPeer, peerData) {
        const { artilleryId, heading, impactPos, isHit, targetType } = payload;

        // Find artillery mesh - check objectRegistry first, then scene traverse
        let artilleryMesh = this.game?.objectRegistry?.get(artilleryId);
        if (!artilleryMesh && this.game?.scene) {
            this.game.scene.traverse((child) => {
                if (child.userData?.objectId === artilleryId && child.userData?.modelType === 'artillery') {
                    artilleryMesh = child;
                }
            });
        }

        // Spawn muzzle flash and smoke at artillery position (requires mesh)
        if (artilleryMesh && this.game?.effectManager) {
            // Get artillery world position (important for ship-mounted artillery)
            const artilleryWorldPos = new THREE.Vector3();
            artilleryMesh.getWorldPosition(artilleryWorldPos);

            // Calculate barrel position
            const barrelOffset = CONFIG?.ARTILLERY_COMBAT?.BARREL_OFFSET || { x: 0, y: 0.6, z: 1.2 };
            const barrelDir = CONFIG?.ARTILLERY_COMBAT?.BARREL_DIRECTION || -1;
            const barrelPos = {
                x: artilleryWorldPos.x + barrelDir * Math.sin(heading) * barrelOffset.z,
                y: artilleryWorldPos.y + barrelOffset.y,
                z: artilleryWorldPos.z + barrelDir * Math.cos(heading) * barrelOffset.z
            };

            // Spawn muzzle effects
            this.game.effectManager.spawnArtilleryMuzzleFlash(barrelPos);
            this.game.effectManager.spawnArtillerySmoke(barrelPos);

            // Play artillery sound
            if (this.game?.audioManager) {
                this.game.audioManager.playPositionalSound('artillery', artilleryMesh);
            }
        }

        // Spawn impact effect at target location (doesn't require artillery mesh)
        if (impactPos && this.game?.effectManager) {
            const impact = {
                x: impactPos[0],
                y: impactPos[1],
                z: impactPos[2]
            };
            this.game.effectManager.spawnArtilleryImpact(impact, isHit);
        }

        // Notify ambient sound system of combat
        if (this.game?.ambientSoundSystem) {
            this.game.ambientSoundSystem.onCombatActivity();
        }
    }

    /**
     * Handle artillery damage (peer's artillery hit local player)
     * @private
     */
    handleArtilleryDamage(payload, fromPeer, peerData) {
        const { targetPeerId, damage, shooterPosition } = payload;
        const myClientId = this.game?.gameState?.clientId;

        // Check if this message is targeting local player
        if (targetPeerId !== myClientId) {
            return;
        }

        // Apply damage to local player (instant kill from artillery)
        const hasDeathManager = !!this.game?.deathManager;
        const hasPlayerObject = !!this.game?.playerObject;

        if (hasDeathManager && hasPlayerObject) {
            const shooterName = this.peerGameData?.get(fromPeer)?.username || 'Enemy artillery';
            this.game.deathManager.killEntity(
                this.game.playerObject,
                false,  // isAI
                false,  // isPeer
                `Killed by ${shooterName}'s artillery`
            );
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
        const vState = this.game?.gameState?.vehicleState;
        if (!vState?.isActive() || !['boat', 'sailboat', 'ship2'].includes(vState.pilotingEntityType)) return;

        const entity = vState.pilotingEntity;
        if (!entity) return;

        // Calculate current durability (same formula as structures)
        const DECAY_EXPONENT = 1.434;
        const DECAY_INVERSE = 0.697;
        const quality = vState.pilotingQuality || 50;
        const maxLifespanHours = Math.pow(quality, DECAY_EXPONENT);
        const now = Date.now();
        const elapsedMs = now - (vState.pilotingLastRepairTime || now);
        const elapsedHours = elapsedMs / (1000 * 60 * 60);
        const remainingHours = Math.max(0, maxLifespanHours - elapsedHours);
        const currentDurability = Math.pow(remainingHours, DECAY_INVERSE);

        const newDurability = currentDurability - damage;

        if (newDurability <= 0) {
            // Boat destroyed - trigger sinking and death

            // Play crash sound
            if (this.game?.audioManager) {
                this.game.audioManager.playBoatCrashSound(vState.pilotingEntityType);
            }

            // Store entity info before any state changes
            const sinkingEntityId = vState.pilotingEntityId;
            const sinkingEntityType = vState.pilotingEntityType;

            // Clear ship gunner state if manning ship artillery
            if (this.game?.clearShipGunnerStateOnSink) {
                this.game.clearShipGunnerStateOnSink(sinkingEntityId);
            }

            // Start sinking animation (no callback - death handled by timeout below)
            if (this.game?.boatSinkingSystem) {
                this.game.boatSinkingSystem.startSinking(entity, sinkingEntityId, null);
            }

            // Remove physics body for boat
            if (this.game?.physicsManager && sinkingEntityId) {
                this.game.physicsManager.removeCharacterController(sinkingEntityId);
            }

            // Broadcast boat sinking to all peers so they see it immediately
            if (this.networkManager) {
                this.networkManager.broadcastP2P({
                    type: 'peer_boat_sinking',
                    payload: {
                        entityId: sinkingEntityId,
                        entityType: sinkingEntityType,
                        position: entity.position.toArray()
                    }
                });
            }

            // Kill player and clear state after 2 seconds (player sinks with boat)
            // This matches collision-based sinking behavior in game.js
            setTimeout(() => {
                if (this.game?.releaseShipCargoOnSink) {
                    this.game.releaseShipCargoOnSink(sinkingEntityId);
                }
                this.game?.killEntity(this.game.playerObject, false, false, 'Boat destroyed by artillery');
                // Reset vehicle state AFTER death (keeps player attached during sinking)
                vState.forceReset('boat destroyed by artillery');
                // Clean up activeVehicle
                if (this.game?.activeVehicle) {
                    if (this.game.activeVehicle.removeDebugVisualization) {
                        this.game.activeVehicle.removeDebugVisualization(this.game.scene);
                    }
                    if (this.game.activeVehicle.removeColliderDebugVisualization) {
                        this.game.activeVehicle.removeColliderDebugVisualization(this.game.scene);
                    }
                    this.game.activeVehicle.cleanup();
                    this.game.activeVehicle = null;
                }
            }, 2000);
        } else {
            // Boat damaged but not destroyed - update repair time
            const newRemainingHours = Math.pow(newDurability, 1 / DECAY_INVERSE);
            const newElapsedHours = maxLifespanHours - newRemainingHours;
            const newLastRepairTime = now - newElapsedHours * 60 * 60 * 1000;

            vState.pilotingLastRepairTime = newLastRepairTime;
            entity.userData.lastRepairTime = newLastRepairTime;
        }
    }

    /**
     * Handle peer's boat sinking broadcast
     * Called when a peer's boat is destroyed by artillery - starts sinking animation locally
     * @private
     */
    handlePeerBoatSinking(payload, fromPeer, peerData) {
        const { entityId, entityType } = payload;

        // Get the peer's boat mesh from their mobile entity state
        if (!peerData?.mobileEntity?.mesh) return;

        const boatMesh = peerData.mobileEntity.mesh;

        // Check if already sinking (avoid duplicate animations)
        if (this.game?.boatSinkingSystem?.isSinking(entityId)) return;

        // Play crash sound
        if (this.game?.audioManager) {
            this.game.audioManager.playBoatCrashSound(entityType);
        }

        // Start sinking animation
        if (this.game?.boatSinkingSystem) {
            this.game.boatSinkingSystem.startSinking(boatMesh, entityId, null);
        }

        // Remove from active peer boats tracking
        this.activePeerBoats.delete(fromPeer);

        // Remove character controller
        if (this.game?.physicsManager && boatMesh.userData?.physicsBodyId) {
            this.game.physicsManager.removeCharacterController(boatMesh.userData.physicsBodyId);
        }
    }

    /**
     * Handle crate loaded by peer (peer loads a crate onto their cart or boat)
     * Supports multi-crate for ship2 with slot-based positioning
     * @private
     */
    handleCrateLoaded(payload, fromPeer, peerData) {
        const { crateId, cartId, inventory, vehicleType, slotIndex } = payload;

        // Check if this is a boat crate but boat mesh isn't ready yet (must check BEFORE side effects)
        const boatTypes = ['boat', 'sailboat', 'ship2'];
        const isBoatCrate = vehicleType && boatTypes.includes(vehicleType);
        if (isBoatCrate && !peerData.mobileEntity?.mesh) {
            // Queue this operation until boat mesh is available (same pattern as artillery)
            if (!peerData.pendingCrateLoads) {
                peerData.pendingCrateLoads = [];
            }
            peerData.pendingCrateLoads.push(payload);
            return;
        }

        // Mark crate as occupied (being carried)
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.setOccupied(crateId, fromPeer);
        }

        // Remove physics collider so loaded crate doesn't block movement
        if (this.game?.physicsManager) {
            this.game.physicsManager.removeCollider(crateId);
        }

        // Determine target mesh (cart or boat) and position offsets
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
                    }
                }
            }

            // Unregister from StructureModelSystem to prevent LOD updates
            // (crate position changes when parented to cart, would confuse LOD system)
            if (this.game?.structureModelSystem) {
                this.game.structureModelSystem.unregisterStructure(crateId);
            }

            // Remove billboard if exists
            if (this.game?.billboardSystem) {
                this.game.billboardSystem.removeTreeBillboard(crateMesh);
            }
        }
        // Fallback: Create a new peer crate mesh if not found (race condition case)
        else if (targetMesh && this.game?.scene) {
            const crateModel = modelManager.getModel('crate');
            if (crateModel) {
                crateMesh = crateModel.clone();

                // Set up as peer-controlled crate
                crateMesh.userData.isPeerCrate = true;
                crateMesh.userData.peerId = fromPeer;
                crateMesh.userData.objectId = crateId;  // Use original ID for consistency
                crateMesh.userData.modelType = 'crate';  // For entity type detection

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
                    }
                }

                // Re-add physics collider for unloaded crate
                if (this.game?.physicsManager) {
                    const dims = CONFIG.CONSTRUCTION?.GRID_DIMENSIONS?.crate || { width: 1, depth: 1 };
                    this.game.physicsManager.createStaticCollider(
                        crateId,
                        { type: 'cuboid', width: dims.width || 1, height: 1.5, depth: dims.depth || 1 },
                        crate.position,
                        rotation
                    );
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
    }

    /**
     * Handle artillery loaded onto ship by peer (peer loads artillery onto their ship2)
     * @private
     */
    handleArtilleryLoadedShip(payload, fromPeer, peerData) {
        const { artilleryId, slotIndex, artilleryChunkKey, hasMilitia, militiaOwner, militiaFaction, militiaType } = payload;

        // NOTE: Do NOT mark artillery as occupied here - it's just cargo on the ship.
        // Artillery is only "occupied" when someone is manning it (handleArtilleryManned).
        // Marking it occupied here prevents other players from boarding as gunners.

        // Get peer's ship mesh
        const shipMesh = peerData.mobileEntity?.mesh;
        const isOnShip2 = peerData.mobileEntity?.entityType === 'ship2';

        if (!shipMesh || !isOnShip2) {
            // Bug #9 fix: Queue this operation until ship mesh is available
            if (!peerData.pendingArtilleryLoads) {
                peerData.pendingArtilleryLoads = [];
            }
            peerData.pendingArtilleryLoads.push(payload);
            return;
        }

        // Get slot positioning from config
        const slotConfig = CONFIG.CRATE_VEHICLES?.ship2_artillery?.slots?.[slotIndex];
        if (!slotConfig) {
            console.warn(`[P2P] Invalid artillery slot ${slotIndex} for ship2`);
            return;
        }

        // Remove physics collider so artillery doesn't block at old position
        if (this.game?.physicsManager) {
            this.game.physicsManager.removeCollider(artilleryId);
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

            // Add to loadedArtillery array (include militia data for AI tracking)
            peerData.loadedArtillery.push({
                artilleryId,
                slotIndex,
                mesh: artilleryMesh,
                artilleryChunkKey,
                hasMilitia: hasMilitia || false,
                militiaOwner: militiaOwner || null,
                militiaFaction: militiaFaction || null,
                militiaType: militiaType || null
            });

            // Remove from chunk tracking to prevent disposal when chunk unloads
            if (artilleryMesh.userData?.chunkKey && this.game?.chunkManager) {
                const chunkKey = artilleryMesh.userData.chunkKey;
                const chunkObjects = this.game.chunkManager.chunkObjects.get(chunkKey);
                if (chunkObjects) {
                    const index = chunkObjects.indexOf(artilleryMesh);
                    if (index !== -1) {
                        chunkObjects.splice(index, 1);
                    }
                }
            }

            // Unregister from LOD system to prevent updates on loaded artillery
            if (this.game?.structureModelSystem) {
                this.game.structureModelSystem.unregisterStructure(artilleryId);
            }

            // Remove billboard if exists
            if (this.game?.billboardSystem) {
                this.game.billboardSystem.removeTreeBillboard(artilleryMesh);
            }
        }
        // Fallback: Create peer artillery mesh if not found
        else if (shipMesh && this.game?.scene) {
            // Try to find and remove existing mesh from scene via traversal
            // This handles the case where mesh exists but wasn't in objectRegistry
            const meshesToRemove = [];
            this.game.scene.traverse((child) => {
                if (child.userData?.objectId === artilleryId) {
                    meshesToRemove.push(child);
                }
            });
            for (const oldMesh of meshesToRemove) {
                if (oldMesh.parent) {
                    oldMesh.parent.remove(oldMesh);
                }
                // Dispose geometry/materials
                oldMesh.traverse((c) => {
                    if (c.geometry) c.geometry.dispose();
                    if (c.material) {
                        if (Array.isArray(c.material)) {
                            c.material.forEach(m => m.dispose());
                        } else {
                            c.material.dispose();
                        }
                    }
                });
                // Clean up from objectRegistry if present
                if (this.game.objectRegistry?.has(artilleryId)) {
                    this.game.objectRegistry.delete(artilleryId);
                }
            }

            const artilleryModel = modelManager.getModel('artillery');
            if (artilleryModel) {
                artilleryMesh = artilleryModel.clone();

                // Set up as peer-controlled artillery
                artilleryMesh.userData.isPeerArtillery = true;
                artilleryMesh.userData.peerId = fromPeer;
                artilleryMesh.userData.objectId = artilleryId;  // Use original ID for occupancy checks
                artilleryMesh.userData.modelType = 'artillery';  // Required for gunner boarding detection

                // Apply MODEL_CONFIG scale if available
                const modelConfig = MODEL_CONFIG['artillery'];
                const baseScale = modelConfig?.baseScale || 1.0;
                artilleryMesh.scale.setScalar(baseScale);

                // Parent to ship at slot position
                shipMesh.add(artilleryMesh);
                artilleryMesh.position.set(slotConfig.x, slotConfig.y, slotConfig.z);
                artilleryMesh.rotation.set(0, slotConfig.rotation, 0);

                // Add to loadedArtillery array (include militia data for AI tracking)
                peerData.loadedArtillery.push({
                    artilleryId,
                    slotIndex,
                    mesh: artilleryMesh,
                    artilleryChunkKey,
                    hasMilitia: hasMilitia || false,
                    militiaOwner: militiaOwner || null,
                    militiaFaction: militiaFaction || null,
                    militiaType: militiaType || null
                });
            } else {
                console.warn(`[P2P] Failed to create artillery mesh - model not loaded`);
            }
        } else {
            console.warn(`[P2P] Cannot visualize artillery ${artilleryId} - no ship mesh or scene available`);
        }

        // Update militia slotIndex if this artillery has one
        this.game?.banditController?.updateMilitiaSlotIndex(artilleryId, slotIndex);
    }

    /**
     * Handle artillery unloaded from ship by peer
     * @private
     */
    handleArtilleryUnloadedShip(payload, fromPeer, peerData) {
        const { artilleryId, position, rotation, destroyed, hasMilitia } = payload;

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

            if (destroyed) {
                // Artillery destroyed (went down with ship) - dispose mesh
                const queue = getChunkTransitionQueue();
                queue.queue(TASK_TYPE.CLEANUP, () => {
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
                }, PRIORITY.LOW);
            } else {
                // Artillery survived - place it back in world at landing position
                // (applies to both existing meshes AND peer-created meshes)
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
                    }
                }

                // Register in objectRegistry so militia _findArtilleryById can locate it
                if (this.game?.objectRegistry) {
                    this.game.objectRegistry.set(artilleryId, artillery);
                }

                // Re-add physics collider
                if (this.game?.physicsManager) {
                    const dims = CONFIG.CONSTRUCTION?.GRID_DIMENSIONS?.artillery || { radius: 0.4, height: 2.0 };
                    this.game.physicsManager.createStaticCollider(artilleryId, { type: 'cylinder', ...dims }, artillery.position);
                }

                // Re-register with LOD system
                if (this.game?.structureModelSystem) {
                    this.game.structureModelSystem.registerStructure(artillery, 'artillery', newChunkKey);
                }
            }
        }

        // If artillery destroyed and had militia, clean up local militia entity
        // (Ship owner broadcasts bandit_death separately for visual sync)
        const hadMilitia = hasMilitia || artilleryData?.hasMilitia;
        if (destroyed && hadMilitia && this.game?.banditController) {
            if (this.game.banditController.entities.has(artilleryId)) {
                this.game.banditController._destroyEntity(artilleryId);
            }
        }

        // If artillery survived with militia, update militia ship-mounting state
        if (!destroyed && hadMilitia && this.game?.banditController) {
            this.game.banditController.clearMilitiaShipState(artilleryId);
        }

        // Remove from loadedArtillery array
        if (artilleryIndex !== -1 && peerData.loadedArtillery) {
            peerData.loadedArtillery.splice(artilleryIndex, 1);
        }
    }

    /**
     * Handle horse loaded onto ship by peer
     * @private
     */
    handleHorseLoadedShip(payload, fromPeer, peerData) {
        const { horseId, slotIndex } = payload;

        // Get peer's ship mesh (check BEFORE side effects)
        const shipMesh = peerData.mobileEntity?.mesh;
        const isOnShip2 = peerData.mobileEntity?.entityType === 'ship2';

        if (!shipMesh || !isOnShip2) {
            // Queue this operation until ship mesh is available (same pattern as artillery)
            if (!peerData.pendingHorseLoads) {
                peerData.pendingHorseLoads = [];
            }
            peerData.pendingHorseLoads.push(payload);
            return;
        }

        // Mark horse as occupied (after queue check to avoid duplicate marking)
        if (this.game?.mobileEntitySystem) {
            this.game.mobileEntitySystem.setOccupied(horseId, fromPeer);
        }

        // Get slot positioning from config
        const slotConfig = CONFIG.HORSE_VEHICLES?.ship2?.slots?.[slotIndex];
        if (!slotConfig) {
            console.warn(`[P2P] Invalid horse slot ${slotIndex} for ship2`);
            return;
        }

        // Remove physics collider so horse doesn't block at old position
        if (this.game?.physicsManager) {
            this.game.physicsManager.removeCollider(horseId);
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
                    }
                }
            }

            // Unregister from LOD system to prevent updates on loaded horse
            if (this.game?.structureModelSystem) {
                this.game.structureModelSystem.unregisterStructure(horseId);
            }

            // Remove billboard if exists
            if (this.game?.billboardSystem) {
                this.game.billboardSystem.removeTreeBillboard(horseMesh);
            }
        }
        // Fallback: Create peer horse mesh if not found
        else if (shipMesh && this.game?.scene) {
            const horseModel = modelManager.getModel('horse');
            if (horseModel) {
                horseMesh = horseModel.clone();

                // Set up as peer-controlled horse
                horseMesh.userData.isPeerHorse = true;
                horseMesh.userData.peerId = fromPeer;
                horseMesh.userData.objectId = horseId;  // Use original ID for consistency
                horseMesh.userData.modelType = 'horse';  // For entity type detection

                // Apply MODEL_CONFIG scale
                const modelConfig = MODEL_CONFIG['horse'];
                const baseScale = modelConfig?.baseScale || 0.385;
                horseMesh.scale.setScalar(baseScale);

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
            } else {
                console.warn(`[P2P] Failed to create horse mesh - model not loaded`);
            }
        } else {
            console.warn(`[P2P] Cannot visualize horse ${horseId} - no ship mesh or scene available`);
        }
    }

    /**
     * Handle horse unloaded from ship by peer
     * @private
     */
    handleHorseUnloadedShip(payload, fromPeer, peerData) {
        const { horseId, position, rotation, destroyed } = payload;

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

            // If destroyed (went down with ship) or peer-created mesh, dispose it
            if (destroyed || horse.userData?.isPeerHorse) {
                // Defer disposal to prevent lag spike when multiple items destroyed at once
                const queue = getChunkTransitionQueue();
                queue.queue(TASK_TYPE.CLEANUP, () => {
                    horse.traverse((child) => {
                        if (child.geometry) child.geometry.dispose();
                        if (child.material) {
                            if (Array.isArray(child.material)) {
                                child.material.forEach(m => m.dispose());
                            } else {
                                child.material.dispose();
                            }
                        }
                    });
                }, PRIORITY.LOW);
            } else {
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
                    }
                }

                // Re-add physics collider
                if (this.game?.physicsManager) {
                    const dims = CONFIG.CONSTRUCTION?.GRID_DIMENSIONS?.horse || { radius: 0.5, height: 1.5 };
                    this.game.physicsManager.createStaticCollider(horseId, { type: 'cylinder', ...dims }, horse.position);
                }

                // Re-register with LOD system
                if (this.game?.structureModelSystem) {
                    this.game.structureModelSystem.registerStructure(horse, 'horse', newChunkKey);
                }
            }
        }

        // Remove from loadedHorses array
        if (horseIndex !== -1 && peerData.loadedHorses) {
            peerData.loadedHorses.splice(horseIndex, 1);
        }
    }

    /**
     * Handle ship cargo manifest update from peer.
     * Used to sync cargo state (crates, artillery, horses) between all crew members.
     * This enables proper cargo unloading when pilot leaves and gunner takes over.
     * @private
     */
    handleShipCargoUpdate(payload, fromPeer, peerData) {
        const { shipId, cargoManifest } = payload;
        if (!shipId || !cargoManifest) return;

        // Find the ship mesh - could be in objectRegistry or peer's mobile entity
        let shipMesh = this.game?.objectRegistry?.get(shipId);

        // Also check if this is the peer's piloted ship (check both objectId and originalEntityId)
        if (!shipMesh && (
            peerData.mobileEntity?.mesh?.userData?.objectId === shipId ||
            peerData.mobileEntity?.mesh?.userData?.originalEntityId === shipId)) {
            shipMesh = peerData.mobileEntity.mesh;
        }

        // Also check if this is OUR piloted ship (pilot broadcasting to gunners)
        if (!shipMesh && this.game?.gameState?.vehicleState?.pilotingEntityId === shipId) {
            shipMesh = this.game.gameState.vehicleState.pilotingEntity;
        }

        // Also check if we're a gunner on this ship
        if (!shipMesh) {
            const mannedArt = this.game?.gameState?.vehicleState?.mannedArtillery;
            if (mannedArt?.manningState?.isShipMounted && mannedArt?.manningState?.shipId === shipId) {
                shipMesh = this.game.objectRegistry?.get(shipId);
            }
        }

        if (shipMesh) {
            // Store cargo manifest on the ship mesh for local access
            shipMesh.userData.cargoManifest = cargoManifest;

            // Also update individual artillery inventory on mesh children
            // This ensures artillery.userData.inventory is accurate for firing
            if (cargoManifest.artillery?.length > 0) {
                shipMesh.traverse(child => {
                    if (child.userData?.modelType === 'artillery') {
                        const artEntry = cargoManifest.artillery.find(
                            a => a.artilleryId === child.userData.objectId
                        );
                        if (artEntry) {
                            child.userData.inventory = artEntry.inventory;
                        }
                    }
                });
            }
        }

        // Update militia data in peerData.loadedArtillery
        if (cargoManifest.artillery?.length > 0 && peerData.loadedArtillery) {
            for (const artEntry of cargoManifest.artillery) {
                const peerArt = peerData.loadedArtillery.find(a => a.artilleryId === artEntry.artilleryId);
                if (peerArt) {
                    peerArt.hasMilitia = artEntry.hasMilitia || false;
                    peerArt.militiaOwner = artEntry.militiaOwner || null;
                    peerArt.militiaFaction = artEntry.militiaFaction || null;
                    peerArt.militiaType = artEntry.militiaType || null;
                }
            }
        }
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

            // Skip visual updates for dead avatars (corpses shouldn't change colors)
            if (avatar && !avatar.userData?.isDead) {
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
        this.syncShipRoster(message.shipRoster, fromPeer);
        this.syncShipCargoState(message.shipCargo, fromPeer, peerData);
        this.syncLoadedArtilleryMilitia(message.loadedArtillery, fromPeer, peerData);
    }

    /**
     * Sync ship-mounted artillery militia data from full state
     * @private
     */
    syncLoadedArtilleryMilitia(artilleryState, fromPeer, peerData) {
        if (!artilleryState || !peerData.loadedArtillery) return;

        for (const artEntry of artilleryState) {
            const peerArt = peerData.loadedArtillery.find(a => a.artilleryId === artEntry.artilleryId);
            if (peerArt) {
                peerArt.hasMilitia = artEntry.hasMilitia || false;
                peerArt.militiaOwner = artEntry.militiaOwner || null;
                peerArt.militiaFaction = artEntry.militiaFaction || null;
                peerArt.militiaType = artEntry.militiaType || null;
            }
        }
    }

    /**
     * Sync ship crew roster - late-joining peers receive roster state
     * @private
     */
    syncShipRoster(rosterState, fromPeer) {
        if (!rosterState || !rosterState.shipId) return;

        const mobileEntitySystem = this.game?.mobileEntitySystem;
        if (!mobileEntitySystem) return;

        const { shipId, pilot, portGunner, starboardGunner } = rosterState;

        // Initialize roster if needed
        mobileEntitySystem.initShipCrew(shipId);

        // Update each position if provided
        if (pilot) {
            mobileEntitySystem.setShipCrewMember(shipId, 'pilot', pilot);
        }
        if (portGunner) {
            mobileEntitySystem.setShipCrewMember(shipId, 'portGunner', portGunner);
        }
        if (starboardGunner) {
            mobileEntitySystem.setShipCrewMember(shipId, 'starboardGunner', starboardGunner);
        }
    }

    /**
     * Sync ship cargo state - create cargo meshes for late-joining peers
     * @private
     */
    syncShipCargoState(cargoState, fromPeer, peerData) {
        if (!cargoState) return;
        if (!peerData.mobileEntity?.mesh) return; // Ship mesh must exist first

        const { crates, artillery, horses } = cargoState;

        // Sync crates (handlers auto-queue if ship mesh not ready yet)
        if (crates?.length > 0) {
            for (const crate of crates) {
                const alreadyLoaded = peerData.loadedCrates?.some(
                    c => c.crateId === crate.id
                );
                if (!alreadyLoaded) {
                    this.handleCrateLoaded({
                        crateId: crate.id,
                        vehicleType: 'ship2',
                        slotIndex: crate.slotIndex
                    }, fromPeer, peerData);
                }
            }
        }

        // Sync artillery
        if (artillery?.length > 0) {
            for (const art of artillery) {
                const alreadyLoaded = peerData.loadedArtillery?.some(
                    a => a.artilleryId === art.id
                );
                if (!alreadyLoaded) {
                    this.handleArtilleryLoadedShip({
                        artilleryId: art.id,
                        slotIndex: art.slotIndex,
                        hasMilitia: art.hasMilitia,
                        militiaOwner: art.militiaOwner,
                        militiaFaction: art.militiaFaction,
                        militiaType: art.militiaType
                    }, fromPeer, peerData);
                }
            }
        }

        // Sync horses
        if (horses?.length > 0) {
            for (const horse of horses) {
                const alreadyLoaded = peerData.loadedHorses?.some(
                    h => h.id === horse.id
                );
                if (!alreadyLoaded) {
                    this.handleHorseLoadedShip({
                        horseId: horse.id,
                        slotIndex: horse.slotIndex
                    }, fromPeer, peerData);
                }
            }
        }
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
            peerData.isClimbing = true;
            peerData.climbingOutpostId = climbingState.outpostId;
            peerData.climbingPhase = climbingState.phase;

            // Mark outpost as occupied
            if (this.game?.occupiedOutposts) {
                this.game.occupiedOutposts.set(climbingState.outpostId, fromPeer);
            }
        } else if (!hasClimbing && localHasClimbing) {
            // Peer stopped climbing but we still think they are - cleanup
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
        // Check if we have piloting data but no mesh (early storage case - mesh created when avatar exists)
        const hasPilotingButNoMesh = localHasPiloting && !peerData.mobileEntity.mesh;

        // Bug 2 fix: Check if peer is crew on our locally piloted ship
        // If so, skip creating a duplicate mesh - their avatar is positioned via ship roster
        const localPilotingId = this.game?.gameState?.vehicleState?.pilotingEntityId;
        if (hasPiloting && localPilotingId && localPilotingId === pilotingState.entityId) {
            return;
        }

        if (hasPiloting && (!localHasPiloting || hasPilotingButNoMesh)) {
            // Peer is piloting but we don't have mesh - create it
            // Include phase data for animation sync (Issue #6)
            this.handleMobileEntityEnter({
                entityId: pilotingState.entityId,
                entityType: pilotingState.entityType,
                position: pilotingState.position,
                rotation: pilotingState.rotation,
                phase: pilotingState.phase || 'piloting',
                playerStartPosition: pilotingState.playerStartPosition,
                boardingDuration: pilotingState.boardingDuration
            }, fromPeer, peerData, avatar);

            // Handle disembarking phase from full state
            if (pilotingState.phase === 'disembarking' && pilotingState.playerTargetPosition) {
                peerData.vehiclePhase = 'disembarking';
                peerData.disembarkStartTime = pilotingState.disembarkStartTime || Date.now();
                peerData.disembarkDuration = pilotingState.disembarkDuration || 500;
                peerData.disembarkStartPosition = pilotingState.playerStartPosition
                    ? new THREE.Vector3().fromArray(pilotingState.playerStartPosition)
                    : null;
                peerData.disembarkTargetPosition = new THREE.Vector3().fromArray(pilotingState.playerTargetPosition);
            }
        } else if (!hasPiloting && localHasPiloting) {
            // Peer stopped piloting but we still have mesh - clean up
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

                // Sync phase if provided (Issue #6)
                if (pilotingState.phase) {
                    peerData.vehiclePhase = pilotingState.phase;
                }
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
            this.handleCartAttached({
                cartId: cartState.cartId,
                position: cartState.position,
                rotation: cartState.rotation
            }, fromPeer, peerData);
        } else if (!hasCart && localHasCart) {
            // Peer dropped cart but we still have it - cleanup
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
            this.handleCrateLoaded({
                crateId: crateState.crateId,
                cartId: peerData.towedCart.cartId
            }, fromPeer, peerData);
        } else if (!hasCrate && localHasCrate) {
            // Peer unloaded crate but we still have it - cleanup
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
            this.handleArtilleryAttached({
                artilleryId: artilleryState.artilleryId,
                position: artilleryState.position,
                rotation: artilleryState.rotation,
                hasMilitia: artilleryState.hasMilitia,
                militiaOwner: artilleryState.militiaOwner,
                militiaFaction: artilleryState.militiaFaction,
                militiaType: artilleryState.militiaType
            }, fromPeer, peerData);
        } else if (!hasArtillery && localHasArtillery) {
            // Peer released artillery but we still have it - cleanup
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
            this.handleArtilleryManned({
                artilleryId: manningState.artilleryId,
                heading: manningState.heading,
                isShipMounted: manningState.isShipMounted,
                shipId: manningState.shipId,
                slotIndex: manningState.slotIndex
            }, fromPeer, peerData);
        } else if (!hasManning && localHasManning) {
            // Peer stopped manning but we still have it - cleanup
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

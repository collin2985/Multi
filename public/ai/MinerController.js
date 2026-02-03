/**
 * MinerController.js
 * Manages Miner NPCs that work at miner buildings
 *
 * Miner behavior loop:
 * 1. Find nearest rock (limestone, sandstone, clay, iron) within search radius
 * 2. Mine rock 5 times (10 seconds each harvest)
 * 3. Deliver 5 stone items to market
 * 4. Return to building and repeat
 *
 * Extends BaseWorkerController for shared P2P authority and movement logic.
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { ChunkCoordinates } from '../core/ChunkCoordinates.js';
import { BaseWorkerController } from './BaseWorkerController.js';

// Miner-specific configuration (base configs inherited from BaseWorkerController)
const MINER_CONFIG_DEFAULTS = {
    NPC_COLOR: 0x696969,              // Dim gray (stone color)
    ROCK_SEARCH_RADIUS_SQ: 2500,      // 50^2
    ROCK_CHECK_COOLDOWN_MS: 60000,    // 60s before re-targeting failed rock
    INTERACTION_RANGE: 0.5,            // Distance to interact with rock
    HARVEST_COUNT: 5                  // Mine 5 stone per rock
};

// Miner states (simplified - no log phase)
const MINER_STATE = {
    IDLE: 'idle',
    SEEKING_ROCK: 'seeking_rock',
    MINING: 'mining',
    DELIVERING: 'delivering',
    DEPOSITING: 'depositing',
    RETURNING: 'returning',
    STUCK: 'stuck'
};

class MinerController extends BaseWorkerController {
    constructor() {
        super({
            workerType: 'miner',
            configKey: 'MINER',
            npcColor: MINER_CONFIG_DEFAULTS.NPC_COLOR,
            displayName: 'Miner',
            movementStates: [
                MINER_STATE.SEEKING_ROCK,
                MINER_STATE.DELIVERING,
                MINER_STATE.RETURNING
            ]
        });

        // Rock cooldown cache - prevents repeatedly targeting failed rocks
        this._checkedRocks = new Map(); // rockId -> timestamp
        this._lastCacheClear = 0;
    }

    // =========================================================================
    // OVERRIDE: Config helper
    // =========================================================================

    _getConfig(key) {
        return CONFIG.MINER?.[key] ?? MINER_CONFIG_DEFAULTS[key] ?? super._getConfig(key);
    }

    // =========================================================================
    // ABSTRACT METHOD IMPLEMENTATIONS
    // =========================================================================

    _getStateEnum() {
        return MINER_STATE;
    }

    _getStructuresInChunk(chunkKey) {
        return this.gameState?.getMinersInChunk(chunkKey) || [];
    }

    _createWorkerSpecificState(buildingData) {
        return {
            // Rock mining
            currentRock: null,
            currentRockId: null,
            miningStartTime: null,
            harvestIndex: 0,
            waitingForHarvestResponse: false
        };
    }

    _createBroadcastMessage() {
        const msg = super._createBroadcastMessage();
        msg.mining = false;
        msg.currentRockId = null;
        msg.harvestIndex = 0;
        return msg;
    }

    _addBroadcastExtraFields(entity, msg) {
        msg.mining = entity.visual?.isMining || false;
        msg.currentRockId = entity.currentRockId || null;
        msg.harvestIndex = entity.harvestIndex || 0;
    }

    _applyExtraStateFields(entity, message) {
        entity.harvestIndex = message.harvestIndex || 0;
        entity.currentRockId = message.currentRockId || null;
        if (message.mining !== undefined) {
            this._setMining(entity, message.mining);
        }
    }

    _getSyncExtraFields(entity) {
        return {
            harvestIndex: entity.harvestIndex,
            currentRockId: entity.currentRockId
        };
    }

    // =========================================================================
    // ANIMATION SETUP (mining)
    // =========================================================================

    _setupExtraAnimations(entity, mixer, animations) {
        // Search for pickaxe/mining animation
        const miningAnim = animations.find(anim => {
            const name = anim.name.toLowerCase();
            if (name === 'pickaxe' || name === 'pickaxe.001' || name === 'armature|pickaxe') {
                return true;
            }
            return name.includes('pickaxe') || name.includes('pick') ||
                   name.includes('axe') || name.includes('action');
        });

        if (miningAnim) {
            entity.visual.miningAction = mixer.clipAction(miningAnim);
            entity.visual.miningAction.loop = THREE.LoopRepeat;
        } else if (entity.visual.walkAction) {
            // Fallback to walk animation
            entity.visual.miningAction = mixer.clipAction(entity.visual.walkAction.getClip());
            entity.visual.miningAction.loop = THREE.LoopRepeat;
        }

        entity.visual.isMining = false;
    }

    _onMovingChanged(entity, isMoving) {
        // Stop mining when starting to move
        if (isMoving && entity.visual?.isMining) {
            this._setMining(entity, false);
        }
    }

    /**
     * Control mining animation state
     */
    _setMining(entity, isMining) {
        if (!entity.visual) return;

        const wasMining = entity.visual.isMining;

        if (wasMining === isMining) {
            return;
        }

        entity.visual.isMining = isMining;

        if (isMining) {
            entity.visual.idleAction?.stop();
            entity.visual.walkAction?.stop();

            // Slow down animation to last 10 seconds per harvest
            if (entity.visual.miningAction) {
                const clip = entity.visual.miningAction.getClip();
                const targetDuration = 10; // 10 seconds per harvest
                entity.visual.miningAction.timeScale = clip.duration / targetDuration;
                entity.visual.miningAction.reset().play();
            }

            // Play pickaxe sound
            const audioManager = this.game?.audioManager;
            if (audioManager) {
                if (entity.activeSound?.isPlaying) {
                    entity.activeSound.stop();
                }
                entity.activeSound = audioManager.playPickaxeSound();
            }
        } else {
            entity.visual.miningAction?.stop();
            if (entity.visual.isMoving) {
                entity.visual.walkAction?.reset().play();
            } else {
                entity.visual.idleAction?.reset().play();
            }

            if (entity.activeSound?.isPlaying) {
                entity.activeSound.stop();
                entity.activeSound = null;
            }
        }
    }

    // =========================================================================
    // STATE HANDLERS
    // =========================================================================

    _handleIdleState(entity) {
        const now = Date.now();
        if (now - entity._lastDecisionTime < this._getConfig('IDLE_CHECK_INTERVAL')) {
            return;
        }
        entity._lastDecisionTime = now;

        const task = this._decideNextTask(entity);

        switch (task.task) {
            case 'deliver':
                entity.state = MINER_STATE.DELIVERING;
                entity.targetId = task.target;
                entity.path = [];
                // Note: Don't call _setMoving(true) here - let _handleMovementState
                // start the animation only when a path is available to avoid walking in place
                break;
            case 'continue_rock':
                // Check if already at the rock - skip movement if so
                const rock = task.target;
                if (rock) {
                    const dx = rock.position.x - entity.position.x;
                    const dz = rock.position.z - entity.position.z;
                    const distSq = dx * dx + dz * dz;
                    const rangeSq = this._getConfig('INTERACTION_RANGE') * this._getConfig('INTERACTION_RANGE');

                    if (distSq <= rangeSq) {
                        // Already at the rock - start mining immediately
                        entity.currentRockId = rock.userData?.objectId || rock.id;
                        entity.currentRock = rock;
                        this._startMining(entity, rock);
                        break;
                    }
                }
                entity.state = MINER_STATE.SEEKING_ROCK;
                entity.path = [];
                // Note: Don't call _setMoving(true) here - let _handleMovementState
                // start the animation only when a path is available to avoid walking in place
                break;
            case 'mine_rock':
                entity.state = MINER_STATE.SEEKING_ROCK;
                entity.targetId = task.target.id;
                entity.currentRockId = task.target.id;
                entity.targetPosition = { ...task.target.position };
                entity.path = [];
                // Note: Don't call _setMoving(true) here - let _handleMovementState
                // start the animation only when a path is available to avoid walking in place
                break;
            case 'stuck':
                this._enterStuckState(entity, task.reason);
                break;
            case 'wait':
                // Stay idle
                break;
        }
    }

    _decideNextTask(entity) {
        const market = this._findMarketNearPosition(entity.homePosition, this._getConfig('MARKET_MAX_DISTANCE'));

        // Priority 1: DELIVER - Carrying items? Take to market
        if (entity.carrying.length > 0) {
            if (!market) return { task: 'wait' };
            return { task: 'deliver', target: market.id };
        }

        // Priority 2: CONTINUE ROCK - Have a rock being mined?
        if (entity.currentRockId && entity.harvestIndex < this._getConfig('HARVEST_COUNT')) {
            const rock = this._findRockById(entity.currentRockId);
            if (rock) {
                const remaining = rock.remainingResources ?? rock.userData?.remainingResources ?? 0;
                if (remaining > 0) {
                    return { task: 'continue_rock', target: rock };
                }
            }
            // Rock depleted or gone
            entity.currentRockId = null;
            entity.currentRock = null;
            entity.harvestIndex = 0;
        }

        // Priority 3: FIND ROCK - Look for rocks to mine
        const rock = this._findNearestRock(entity);
        if (rock) {
            return { task: 'mine_rock', target: rock };
        }

        // Priority 4: WAIT - No rocks nearby
        return { task: 'wait' };
    }

    _handleWorkerSpecificState(entity, deltaTime) {
        switch (entity.state) {
            case MINER_STATE.MINING:
                this._handleMining(entity, deltaTime);
                break;
            case MINER_STATE.DEPOSITING:
                this._handleMarketDeposit(entity);
                break;
        }
    }

    _getMovementTarget(entity) {
        if (entity.state === MINER_STATE.SEEKING_ROCK) {
            const rock = this._findRockById(entity.currentRockId);
            if (!rock) {
                this._markRockChecked(entity.currentRockId);
                entity.state = MINER_STATE.IDLE;
                entity.currentRockId = null;
                this._setMoving(entity, false);
                return null;
            }
            return this._calculateApproachPosition(rock, entity.position, 0.3);
        }

        if (entity.state === MINER_STATE.RETURNING) {
            const building = this.gameState?.getStructureById(entity.buildingId);
            if (building) {
                return this._calculateApproachPosition(building, entity.position, 1.5);
            }
            return { x: entity.homePosition.x, z: entity.homePosition.z };
        }

        if (entity.state === MINER_STATE.DELIVERING) {
            const market = this._findMarketById(entity.targetId);
            if (!market) {
                entity.state = MINER_STATE.IDLE;
                this._setMoving(entity, false);
                return null;
            }
            return this._calculateApproachPosition(market, entity.position, 4.0);
        }

        return null;
    }

    _onArrival(entity) {
        this._setMoving(entity, false);

        switch (entity.state) {
            case MINER_STATE.SEEKING_ROCK:
                const rock = this._findRockById(entity.currentRockId);
                if (rock) {
                    const dx = rock.position.x - entity.position.x;
                    const dz = rock.position.z - entity.position.z;
                    const distSq = dx * dx + dz * dz;
                    const rangeSq = this._getConfig('INTERACTION_RANGE') * this._getConfig('INTERACTION_RANGE');

                    if (distSq <= rangeSq) {
                        entity.currentRock = rock;
                        this._startMining(entity, rock);
                    } else {
                        entity.path = [];
                    }
                } else {
                    this._markRockChecked(entity.currentRockId);
                    entity.state = MINER_STATE.IDLE;
                    entity.currentRockId = null;
                }
                break;

            case MINER_STATE.DELIVERING:
                entity.state = MINER_STATE.DEPOSITING;
                break;

            case MINER_STATE.RETURNING:
                entity.state = MINER_STATE.IDLE;
                break;
        }
    }

    // =========================================================================
    // MINING
    // =========================================================================

    _startMining(entity, rock) {
        entity.miningStartTime = Date.now();
        entity.state = MINER_STATE.MINING;
        entity.waitingForHarvestResponse = false;
        this._setMoving(entity, false);
        this._setMining(entity, true);

        // Face the rock
        if (rock) {
            const dx = rock.position.x - entity.position.x;
            const dz = rock.position.z - entity.position.z;
            entity.rotation = Math.atan2(dx, dz);
            if (entity.mesh) {
                entity.mesh.rotation.y = entity.rotation;
            }
        }

        if (this.broadcastP2P) {
            this.broadcastP2P({
                type: 'miner_action',
                buildingId: entity.buildingId,
                action: 'mining',
                position: entity.position
            });
        }
    }

    _handleMining(entity, deltaTime) {
        if (entity.waitingForHarvestResponse) {
            if (!entity._harvestResponseTime) entity._harvestResponseTime = Date.now();
            if (Date.now() - entity._harvestResponseTime > 2000) {
                entity.waitingForHarvestResponse = false;
                entity._harvestResponseTime = null;
            }
            return;
        }
        entity._harvestResponseTime = null;

        const elapsed = Date.now() - entity.miningStartTime;
        const duration = CONFIG.ACTIONS?.HARVEST_STONE_DURATION || 10000;

        if (!entity.currentRock) {
            this._setMining(entity, false);
            entity.state = MINER_STATE.IDLE;
            return;
        }

        const rock = this._findRockById(entity.currentRockId);
        if (!rock) {
            this._markRockChecked(entity.currentRockId);
            this._setMining(entity, false);
            entity.currentRock = null;
            entity.currentRockId = null;
            entity.state = MINER_STATE.IDLE;
            return;
        }

        if (elapsed >= duration) {
            this._completeHarvest(entity);
        }
    }

    _completeHarvest(entity) {
        const rock = entity.currentRock || this._findRockById(entity.currentRockId);
        if (!rock) {
            this._setMining(entity, false);
            entity.state = MINER_STATE.IDLE;
            entity.currentRockId = null;
            entity.currentRock = null;
            return;
        }

        const rockName = rock.name || rock.userData?.modelType || 'limestone';
        const rockPosition = rock.position.toArray ? rock.position.toArray() :
            [rock.position.x, rock.position.y, rock.position.z];
        const rockQuality = rock.quality ?? rock.userData?.quality ?? 50;
        const rockScale = rock.scale?.x ?? rock.userData?.scale ?? 1;
        const rockChunkKey = rock.chunkKey || rock.userData?.chunkKey ||
            ChunkCoordinates.worldToChunkKey(rock.position.x, rock.position.z);
        const rockId = rock.userData?.objectId || rock.id || entity.currentRockId;

        // Send harvest request to server
        if (this.networkManager) {
            this.networkManager.sendMessage('harvest_resource_request', {
                chunkId: `chunk_${rockChunkKey}`,
                objectId: rockId,
                harvestType: 'stone',
                clientId: this.clientId,
                objectData: {
                    name: rockName,
                    position: rockPosition,
                    quality: rockQuality,
                    scale: rockScale,
                    totalResources: rock.totalResources ?? rock.userData?.totalResources ?? 5,
                    remainingResources: rock.remainingResources ?? rock.userData?.remainingResources ?? 5
                }
            });
        }

        // Create stone item for carrying (type matches rock type)
        const itemType = rockName; // limestone, sandstone, clay, or iron
        entity.carrying.push({
            id: `${itemType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: itemType,
            x: -1, y: -1,
            width: 2, height: 2,
            rotation: 0,
            quality: rockQuality,
            durability: 100
        });

        entity.harvestIndex++;
        entity.waitingForHarvestResponse = true;

        const harvestCount = this._getConfig('HARVEST_COUNT');
        if (entity.harvestIndex < harvestCount) {
            // Continue mining after short delay
            setTimeout(() => {
                if (!entity.waitingForHarvestResponse) return;
                entity.waitingForHarvestResponse = false;

                const updatedRock = this._findRockById(entity.currentRockId);
                if (updatedRock) {
                    const remaining = updatedRock.remainingResources ?? updatedRock.userData?.remainingResources;
                    if (remaining === undefined || remaining === null || remaining > 0) {
                        entity.currentRock = updatedRock;
                        entity.miningStartTime = Date.now();
                        // Restart pickaxe sound for next harvest
                        const audioManager = this.game?.audioManager;
                        if (audioManager) {
                            if (entity.activeSound?.isPlaying) {
                                entity.activeSound.stop();
                            }
                            entity.activeSound = audioManager.playPickaxeSound();
                        }
                    } else {
                        // Rock depleted
                        this._setMining(entity, false);
                        entity.currentRockId = null;
                        entity.currentRock = null;
                        entity.harvestIndex = 0;
                        this._startDelivering(entity);
                    }
                } else {
                    // Rock gone
                    this._setMining(entity, false);
                    entity.currentRockId = null;
                    entity.currentRock = null;
                    entity.harvestIndex = 0;
                    this._startDelivering(entity);
                }
            }, 500);
        } else {
            // Done mining this rock - deliver
            setTimeout(() => {
                if (!entity.waitingForHarvestResponse) return;
                entity.waitingForHarvestResponse = false;
                this._setMining(entity, false);
                entity.currentRockId = null;
                entity.currentRock = null;
                entity.harvestIndex = 0;
                this._startDelivering(entity);
            }, 500);
        }
    }

    _startDelivering(entity) {
        const market = this._findMarketNearPosition(entity.homePosition, this._getConfig('MARKET_MAX_DISTANCE'));
        if (!market) {
            // Return to IDLE to retry later (handles P2P authority race conditions)
            entity.state = MINER_STATE.IDLE;
            return false;
        }
        entity.targetId = market.id;
        entity.state = MINER_STATE.DELIVERING;
        entity.path = [];
        // Note: Don't call _setMoving(true) here - let _handleMovementState
        // start the animation only when a path is available to avoid walking in place
        return true;
    }

    // =========================================================================
    // SERVER RESPONSE HANDLERS
    // =========================================================================

    handleDepositResponse(payload) {
        // Fire-and-forget: state already transitioned, no action needed
    }

    handleResourceHarvested(payload) {
        const { objectId, depleted, remainingResources } = payload;

        for (const [buildingId, entity] of this.entities) {
            if (entity.currentRockId === objectId && entity.waitingForHarvestResponse) {
                entity.waitingForHarvestResponse = false;

                if (entity.currentRock) {
                    entity.currentRock.remainingResources = remainingResources;
                    if (entity.currentRock.userData) {
                        entity.currentRock.userData.remainingResources = remainingResources;
                    }
                }

                if (depleted) {
                    this._setMining(entity, false);
                    entity.currentRockId = null;
                    entity.currentRock = null;
                    entity.harvestIndex = 0;
                    if (entity.state === MINER_STATE.MINING) {
                        this._startDelivering(entity);
                    }
                } else {
                    const harvestCount = this._getConfig('HARVEST_COUNT');
                    if (entity.harvestIndex < harvestCount) {
                        entity.miningStartTime = Date.now();
                        // Restart pickaxe sound for next harvest
                        const audioManager = this.game?.audioManager;
                        if (audioManager) {
                            if (entity.activeSound?.isPlaying) {
                                entity.activeSound.stop();
                            }
                            entity.activeSound = audioManager.playPickaxeSound();
                        }
                    } else {
                        this._setMining(entity, false);
                        entity.currentRockId = null;
                        entity.currentRock = null;
                        entity.harvestIndex = 0;
                        this._startDelivering(entity);
                    }
                }
                break;
            }
        }
    }

    // =========================================================================
    // ROCK FINDING
    // =========================================================================

    // Rock types the miner can harvest
    static ROCK_TYPES = ['limestone', 'sandstone', 'clay', 'iron'];

    _findNearestRock(entity) {
        const maxSearchDistSq = this._getConfig('ROCK_SEARCH_RADIUS_SQ');
        const homePos = entity.homePosition;
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(homePos.x, homePos.z);
        const now = Date.now();

        // Clear stale cache entries periodically
        if (now - this._lastCacheClear > 300000) {
            this._clearStaleCacheEntries(now);
            this._lastCacheClear = now;
        }

        let nearest = null;
        let nearestDistSq = Infinity;

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const chunkKey = `${chunkX + dx},${chunkZ + dz}`;
                const chunkData = this.chunkManager?.chunkObjects?.get(chunkKey);
                if (!chunkData) continue;

                for (const obj of chunkData) {
                    // Check if this is a rock type we can mine
                    if (!MinerController.ROCK_TYPES.includes(obj.name)) continue;

                    // Check if rock has resources remaining
                    const remaining = obj.remainingResources ?? obj.userData?.remainingResources;
                    if (remaining !== undefined && remaining <= 0) continue;

                    const rockId = obj.userData?.objectId || obj.id;
                    const checkedAt = this._checkedRocks.get(rockId);
                    if (checkedAt && (now - checkedAt) < this._getConfig('ROCK_CHECK_COOLDOWN_MS')) continue;

                    const rdx = obj.position.x - homePos.x;
                    const rdz = obj.position.z - homePos.z;
                    const distSq = rdx * rdx + rdz * rdz;

                    if (distSq < maxSearchDistSq && distSq < nearestDistSq) {
                        nearestDistSq = distSq;
                        nearest = obj;
                    }
                }
            }
        }

        return nearest ? { id: nearest.userData?.objectId || nearest.id, position: nearest.position, object: nearest } : null;
    }

    _findRockById(rockId) {
        if (!rockId) return null;

        if (this.game?.objectRegistry) {
            const obj = this.game.objectRegistry.get(rockId);
            if (obj) return obj;
        }

        return null;
    }

    _markRockChecked(rockId) {
        if (rockId) {
            this._checkedRocks.set(rockId, Date.now());
        }
    }

    _clearStaleCacheEntries(now) {
        const cooldown = this._getConfig('ROCK_CHECK_COOLDOWN_MS');
        for (const [rockId, timestamp] of this._checkedRocks) {
            if (now - timestamp > cooldown) {
                this._checkedRocks.delete(rockId);
            }
        }
    }

    // =========================================================================
    // CLEANUP
    // =========================================================================

    _onWorkerRemoved(entity) {
        // Stop any active sounds
        if (entity.activeSound?.isPlaying) {
            entity.activeSound.stop();
        }
    }

    dispose() {
        super.dispose();
        this._checkedRocks.clear();
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    get miners() {
        return this.entities;
    }

    checkMinerSpawn(dockData) {
        return this.checkWorkerSpawn(dockData);
    }

    getMinerDialogueData(buildingId) {
        return this.getWorkerDialogueData(buildingId);
    }

    onMinerBuildingDestroyed(buildingId) {
        return this.onBuildingDestroyed(buildingId);
    }

    getActiveWorkersForSync() {
        return this.getAllWorkersForSync();
    }

    getActiveMinersForSync() {
        return this.getActiveWorkersForSync();
    }

    syncMinersFromPeer(minerList, peerId) {
        return this.syncWorkersFromPeer(minerList, peerId);
    }
}

// Singleton instance
export const minerController = new MinerController();
export { MINER_STATE };

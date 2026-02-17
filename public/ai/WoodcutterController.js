/**
 * WoodcutterController.js
 * Manages Woodcutter NPCs that work at woodcutter buildings
 *
 * Woodcutter behavior loop:
 * 1. Find nearest pine tree within search radius
 * 2. Cut down tree (10 seconds, same as player)
 * 3. Process log: firewood, plank, firewood, plank, firewood (10 seconds each)
 * 4. Deliver 3 firewood + 2 planks to market
 * 5. Return to building and repeat
 *
 * Extends BaseWorkerController for shared P2P authority and movement logic.
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { ChunkCoordinates } from '../core/ChunkCoordinates.js';
import { BaseWorkerController } from './BaseWorkerController.js';

// Woodcutter-specific configuration (base configs inherited from BaseWorkerController)
const WOODCUTTER_CONFIG_DEFAULTS = {
    NPC_COLOR: 0x8B4513,              // Saddle brown
    TREE_SEARCH_RADIUS_SQ: 2500,      // 50^2
    TREE_CHECK_COOLDOWN_MS: 60000,    // 60s before re-targeting failed tree
    INTERACTION_RANGE: 0.5,            // Distance to interact with tree/log
    HARVEST_ORDER: ['firewood', 'planks', 'firewood', 'planks', 'firewood']
};

// Woodcutter states
const WOODCUTTER_STATE = {
    IDLE: 'idle',
    SEEKING_TREE: 'seeking_tree',
    CUTTING_TREE: 'cutting_tree',
    SEEKING_LOG: 'seeking_log',
    PROCESSING_LOG: 'processing_log',
    DELIVERING: 'delivering',
    DEPOSITING: 'depositing',
    RETURNING: 'returning',
    STUCK: 'stuck'
};

class WoodcutterController extends BaseWorkerController {
    constructor() {
        super({
            workerType: 'woodcutter',
            configKey: 'WOODCUTTER',
            npcColor: WOODCUTTER_CONFIG_DEFAULTS.NPC_COLOR,
            displayName: 'Woodcutter',
            movementStates: [
                WOODCUTTER_STATE.SEEKING_TREE,
                WOODCUTTER_STATE.SEEKING_LOG,
                WOODCUTTER_STATE.DELIVERING,
                WOODCUTTER_STATE.RETURNING
            ]
        });

        // Tree cooldown cache - prevents repeatedly targeting failed trees
        this._checkedTrees = new Map(); // treeId -> timestamp
        this._lastCacheClear = 0;
    }

    // =========================================================================
    // OVERRIDE: Config helper
    // =========================================================================

    _getConfig(key) {
        return CONFIG.WOODCUTTER?.[key] ?? WOODCUTTER_CONFIG_DEFAULTS[key] ?? super._getConfig(key);
    }

    // =========================================================================
    // ABSTRACT METHOD IMPLEMENTATIONS
    // =========================================================================

    _getStateEnum() {
        return WOODCUTTER_STATE;
    }

    _getStructuresInChunk(chunkKey) {
        return this.gameState?.getWoodcuttersInChunk(chunkKey) || [];
    }

    _createWorkerSpecificState(buildingData) {
        return {
            // Tree cutting
            currentTree: null,
            currentTreeId: null,
            cuttingStartTime: null,
            treeSoundPlayed: false,

            // Log processing
            currentLogId: null,
            currentLog: null,
            expectedLogId: null,
            expectedLogPosition: null,
            logSearchStartTime: null,
            harvestIndex: 0,
            currentHarvestType: null,
            processingStartTime: null,
            waitingForHarvestResponse: false
        };
    }

    _createBroadcastMessage() {
        const msg = super._createBroadcastMessage();
        msg.chopping = false;
        msg.currentLogId = null;
        msg.harvestIndex = 0;
        return msg;
    }

    _addBroadcastExtraFields(entity, msg) {
        msg.chopping = entity.visual?.isChopping || false;
        msg.currentLogId = entity.currentLogId || null;
        msg.harvestIndex = entity.harvestIndex || 0;
    }

    _applyExtraStateFields(entity, message) {
        entity.harvestIndex = message.harvestIndex || 0;
        entity.currentLogId = message.currentLogId || null;
        if (message.chopping !== undefined) {
            this._setChopping(entity, message.chopping);
        }
    }

    _getSyncExtraFields(entity) {
        return {
            harvestIndex: entity.harvestIndex,
            currentLogId: entity.currentLogId
        };
    }

    // =========================================================================
    // ANIMATION SETUP (chopping)
    // =========================================================================

    _setupExtraAnimations(entity, mixer, animations) {
        // Search for chopping/pickaxe animation
        const choppingAnim = animations.find(anim => {
            const name = anim.name.toLowerCase();
            if (name === 'pickaxe' || name === 'pickaxe.001' || name === 'armature|pickaxe') {
                return true;
            }
            return name.includes('pickaxe') || name.includes('pick') ||
                   name.includes('axe') || name.includes('action');
        });

        if (choppingAnim) {
            entity.visual.choppingAction = mixer.clipAction(choppingAnim);
            entity.visual.choppingAction.loop = THREE.LoopRepeat;
            entity.visual.choppingAction.timeScale = 0.3; // Slow down animation to ~10 seconds per cycle
        } else if (entity.visual.walkAction) {
            // Fallback to walk animation
            entity.visual.choppingAction = mixer.clipAction(entity.visual.walkAction.getClip());
            entity.visual.choppingAction.loop = THREE.LoopRepeat;
            entity.visual.choppingAction.timeScale = 0.3; // Slow down animation to ~10 seconds per cycle
        }

        entity.visual.isChopping = false;
    }

    _onMovingChanged(entity, isMoving) {
        // Stop chopping when starting to move
        if (isMoving && entity.visual?.isChopping) {
            this._setChopping(entity, false);
        }
    }

    /**
     * Control chopping animation state
     */
    _setChopping(entity, isChopping) {
        if (!entity.visual) return;

        // Determine what sound type should be playing
        let targetSoundType = null;
        if (isChopping) {
            if (entity.state === WOODCUTTER_STATE.CUTTING_TREE) {
                targetSoundType = 'axe';
            } else if (entity.state === WOODCUTTER_STATE.PROCESSING_LOG) {
                targetSoundType = entity.currentHarvestType === 'planks' ? 'saw' : 'axe';
            }
        }

        const wasChopping = entity.visual.isChopping;
        const soundTypeChanged = entity.activeSoundType !== targetSoundType;

        if (wasChopping && isChopping && !soundTypeChanged) {
            return;
        }

        entity.visual.isChopping = isChopping;
        entity.activeSoundType = targetSoundType;

        if (isChopping) {
            if (!wasChopping) {
                entity.visual.idleAction?.stop();
                entity.visual.walkAction?.stop();
                entity.visual.choppingAction?.reset().play();
            }

            const audioManager = this.game?.audioManager;
            if (audioManager) {
                if (entity.activeSound?.isPlaying) {
                    entity.activeSound.stop();
                }
                if (entity.mesh && (targetSoundType === 'saw' || targetSoundType === 'axe')) {
                    entity.activeSound = audioManager.playPositionalSound(targetSoundType, entity.mesh);
                }
            }
        } else {
            entity.visual.choppingAction?.stop();
            if (entity.visual.isMoving) {
                entity.visual.walkAction?.reset().play();
            } else {
                entity.visual.idleAction?.reset().play();
            }

            if (entity.activeSound?.isPlaying) {
                entity.activeSound.stop();
            }
            if (entity.activeSound) {
                entity.mesh?.remove(entity.activeSound);
                try { entity.activeSound.disconnect(); } catch (e) { /* already disconnected */ }
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
                entity.state = WOODCUTTER_STATE.DELIVERING;
                entity.targetId = task.target;
                entity.path = [];
                // Note: Don't call _setMoving(true) here - let _handleMovementState
                // start the animation only when a path is available to avoid walking in place
                break;
            case 'continue_log':
                // Check if already at the log - skip movement if so
                const log = task.target;
                if (log) {
                    const dx = log.position.x - entity.position.x;
                    const dz = log.position.z - entity.position.z;
                    const distSq = dx * dx + dz * dz;
                    const rangeSq = this._getConfig('INTERACTION_RANGE') * this._getConfig('INTERACTION_RANGE');

                    if (distSq <= rangeSq) {
                        // Already at the log - start processing immediately
                        entity.currentLogId = log.userData?.objectId || log.id;
                        entity.currentLog = log;
                        this._startProcessingLog(entity, log);
                        break;
                    }
                }
                entity.state = WOODCUTTER_STATE.SEEKING_LOG;
                entity.path = [];
                break;
            case 'cut_tree':
                entity.state = WOODCUTTER_STATE.SEEKING_TREE;
                entity.targetId = task.target.id;
                entity.currentTreeId = task.target.id;
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

        // Priority 2: CONTINUE LOG - Have a log being processed?
        if (entity.currentLogId) {
            const log = this._findLogById(entity.currentLogId);
            if (log) {
                const remaining = log.remainingResources ?? log.userData?.remainingResources ?? 0;
                if (remaining > 0) {
                    return { task: 'continue_log', target: log };
                }
            }
            entity.currentLogId = null;
            entity.currentLog = null;
            entity.harvestIndex = 0;
        }

        // Priority 2.5: CLAIM ORPHANED LOG - Find any nearby log with remaining resources
        const orphanedLog = this._findLogNearPosition(entity.homePosition, 50, true);
        if (orphanedLog) {
            const logId = orphanedLog.userData?.objectId || orphanedLog.id;
            const totalResources = this._getConfig('HARVEST_ORDER').length;
            const remaining = orphanedLog.remainingResources ?? orphanedLog.userData?.remainingResources ?? 0;
            entity.currentLogId = logId;
            entity.expectedLogId = logId;
            entity.expectedLogPosition = { x: orphanedLog.position.x, y: orphanedLog.position.y, z: orphanedLog.position.z };
            entity.harvestIndex = totalResources - remaining;
            return { task: 'continue_log', target: orphanedLog };
        }

        // Priority 3: FIND TREE - Look for pine trees to cut
        const tree = this._findNearestPineTree(entity);
        if (tree) {
            return { task: 'cut_tree', target: tree };
        }

        // Priority 4: WAIT - No trees nearby
        return { task: 'wait' };
    }

    _handleWorkerSpecificState(entity, deltaTime) {
        switch (entity.state) {
            case WOODCUTTER_STATE.CUTTING_TREE:
                this._handleCuttingTree(entity, deltaTime);
                break;
            case WOODCUTTER_STATE.PROCESSING_LOG:
                this._handleProcessingLog(entity, deltaTime);
                break;
            case WOODCUTTER_STATE.DEPOSITING:
                this._handleMarketDeposit(entity);
                break;
        }
    }

    _getMovementTarget(entity) {
        if (entity.state === WOODCUTTER_STATE.SEEKING_TREE) {
            const tree = this._findTreeById(entity.currentTreeId);
            if (!tree) {
                this._markTreeChecked(entity.currentTreeId);
                entity.state = WOODCUTTER_STATE.IDLE;
                entity.currentTreeId = null;
                this._setMoving(entity, false);
                return null;
            }
            return this._calculateApproachPosition(tree, entity.position, 0.3);
        }

        if (entity.state === WOODCUTTER_STATE.SEEKING_LOG) {
            // First, try to find the expected log by ID
            let log = this._findLogById(entity.expectedLogId);

            // Validate log has resources remaining
            if (log) {
                const remaining = log.remainingResources ?? log.userData?.remainingResources;
                if (remaining !== undefined && remaining <= 0) {
                    log = null; // Treat depleted log as not found
                }
            }

            if (log) {
                return { x: log.position.x, z: log.position.z };
            }

            // Log not found yet - return expected position to keep moving there
            // Do NOT use _findLogNearPosition here - it could find a different log
            // The _onArrival handler will wait for the expected log to spawn
            if (entity.expectedLogPosition) {
                return { x: entity.expectedLogPosition.x, z: entity.expectedLogPosition.z };
            }

            return null;
        }

        if (entity.state === WOODCUTTER_STATE.RETURNING) {
            const building = this.gameState?.getStructureById(entity.buildingId);
            if (building) {
                return this._calculateApproachPosition(building, entity.position, 1.5);
            }
            return { x: entity.homePosition.x, z: entity.homePosition.z };
        }

        if (entity.state === WOODCUTTER_STATE.DELIVERING) {
            const market = this._findMarketById(entity.targetId);
            if (!market) {
                entity.state = WOODCUTTER_STATE.IDLE;
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
            case WOODCUTTER_STATE.SEEKING_TREE:
                const tree = this._findTreeById(entity.currentTreeId);
                if (tree) {
                    const dx = tree.position.x - entity.position.x;
                    const dz = tree.position.z - entity.position.z;
                    const distSq = dx * dx + dz * dz;
                    const rangeSq = this._getConfig('INTERACTION_RANGE') * this._getConfig('INTERACTION_RANGE');

                    if (distSq <= rangeSq) {
                        entity.currentTree = tree;
                        this._startCuttingTree(entity);
                    } else {
                        entity.path = [];
                    }
                } else {
                    this._markTreeChecked(entity.currentTreeId);
                    entity.state = WOODCUTTER_STATE.IDLE;
                    entity.currentTreeId = null;
                }
                break;

            case WOODCUTTER_STATE.SEEKING_LOG:
                // First, try to find the expected log by ID
                let log = this._findLogById(entity.expectedLogId);

                // Validate log has resources remaining
                if (log) {
                    const remaining = log.remainingResources ?? log.userData?.remainingResources;
                    if (remaining !== undefined && remaining <= 0) {
                        log = null; // Treat depleted log as not found
                    }
                }

                if (log) {
                    entity.currentLogId = log.userData?.objectId || log.id;
                    entity.currentLog = log;
                    entity.logSearchStartTime = null; // Clear timeout on success
                    this._startProcessingLog(entity, log);
                } else {
                    // Log not found by ID - start waiting timer
                    if (!entity.logSearchStartTime) {
                        entity.logSearchStartTime = Date.now();
                    }

                    const waitTime = Date.now() - entity.logSearchStartTime;

                    // After 2 seconds, try position-based fallback (log might have different ID)
                    if (waitTime > 2000 && entity.expectedLogPosition) {
                        log = this._findLogNearPosition(entity.expectedLogPosition, 3.0);
                        if (log) {
                            const remaining = log.remainingResources ?? log.userData?.remainingResources;
                            if (remaining === undefined || remaining > 0) {
                                entity.currentLogId = log.userData?.objectId || log.id;
                                entity.currentLog = log;
                                entity.logSearchStartTime = null;
                                this._startProcessingLog(entity, log);
                                break;
                            }
                        }
                    }

                    // After 5 seconds total, give up
                    if (waitTime > 5000) {
                        entity.logSearchStartTime = null;
                        entity.expectedLogId = null;
                        entity.expectedLogPosition = null;
                        entity.state = WOODCUTTER_STATE.IDLE;
                    }
                }
                break;

            case WOODCUTTER_STATE.DELIVERING:
                entity.state = WOODCUTTER_STATE.DEPOSITING;
                break;

            case WOODCUTTER_STATE.RETURNING:
                entity.state = WOODCUTTER_STATE.IDLE;
                break;
        }
    }

    // =========================================================================
    // TREE CUTTING
    // =========================================================================

    _startCuttingTree(entity) {
        entity.cuttingStartTime = Date.now();
        entity.state = WOODCUTTER_STATE.CUTTING_TREE;
        entity.treeSoundPlayed = false;
        this._setMoving(entity, false);
        this._setChopping(entity, true);

        // Face the tree
        const tree = entity.currentTree;
        if (tree) {
            const dx = tree.position.x - entity.position.x;
            const dz = tree.position.z - entity.position.z;
            entity.rotation = Math.atan2(dx, dz);
            if (entity.mesh) {
                entity.mesh.rotation.y = entity.rotation;
            }
        }

        if (this.broadcastP2P) {
            this.broadcastP2P({
                type: 'woodcutter_action',
                buildingId: entity.buildingId,
                action: 'cutting_tree',
                position: entity.position
            });
        }
    }

    _handleCuttingTree(entity, deltaTime) {
        const elapsed = Date.now() - entity.cuttingStartTime;
        const duration = CONFIG.ACTIONS?.CHOP_TREE_DURATION || 10000;

        if (!entity.currentTree) {
            this._setChopping(entity, false);
            entity.state = WOODCUTTER_STATE.IDLE;
            return;
        }

        const tree = this._findTreeById(entity.currentTreeId);
        if (!tree) {
            this._markTreeChecked(entity.currentTreeId);
            this._setChopping(entity, false);
            entity.currentTree = null;
            entity.currentTreeId = null;
            entity.state = WOODCUTTER_STATE.IDLE;
            return;
        }

        // Tree falling sound at ~7 seconds
        if (elapsed >= 7000 && !entity.treeSoundPlayed) {
            entity.treeSoundPlayed = true;
            const audioManager = this.game?.audioManager;
            if (audioManager && entity.mesh) {
                audioManager.playPositionalSound('tree', entity.mesh);
            }
            if (this.broadcastP2P) {
                this.broadcastP2P({
                    type: 'woodcutter_action',
                    buildingId: entity.buildingId,
                    action: 'tree_falling',
                    position: entity.currentTree.position
                });
            }
        }

        if (elapsed >= duration) {
            this._completeCuttingTree(entity);
        }
    }

    _completeCuttingTree(entity) {
        const tree = entity.currentTree;
        if (!tree) {
            this._setChopping(entity, false);
            entity.state = WOODCUTTER_STATE.IDLE;
            return;
        }

        this._setChopping(entity, false);

        const treeId = tree.userData?.objectId || tree.id || entity.currentTreeId;
        this._markTreeChecked(treeId);

        const treeName = tree.name || tree.userData?.modelType || 'pine';
        const treePosition = tree.position.toArray ? tree.position.toArray() :
            [tree.position.x, tree.position.y, tree.position.z];
        const treeQuality = tree.quality ?? tree.userData?.quality ?? 50;
        const treeScale = tree.scale?.x ?? tree.userData?.scale?.[0] ?? 1;
        const treeChunkKey = tree.chunkKey || tree.userData?.chunkKey ||
            ChunkCoordinates.worldToChunkKey(tree.position.x, tree.position.z);

        // Send remove_object_request to server
        if (this.networkManager) {
            this.networkManager.sendMessage('remove_object_request', {
                chunkId: `chunk_${treeChunkKey}`,
                objectId: treeId,
                name: treeName,
                position: treePosition,
                quality: treeQuality,
                scale: treeScale,
                objectData: {
                    name: treeName,
                    position: treePosition,
                    quality: treeQuality,
                    scale: treeScale,
                    totalResources: tree.totalResources ?? tree.userData?.totalResources ?? null,
                    remainingResources: tree.remainingResources ?? tree.userData?.remainingResources ?? null
                },
                clientId: this.clientId,
                accountId: null
            });
        }

        // Request log spawn
        this._requestLogSpawn(entity, tree, treeChunkKey, treePosition, treeQuality, treeScale);

        entity.expectedLogPosition = {
            x: treePosition[0],
            y: treePosition[1],
            z: treePosition[2]
        };

        entity.currentTree = null;
        entity.currentTreeId = null;
        entity.logSearchStartTime = null;
        entity.harvestIndex = 0;
        entity.state = WOODCUTTER_STATE.SEEKING_LOG;
    }

    _requestLogSpawn(entity, tree, chunkKey, position, quality, scale) {
        const treeName = tree.name || tree.userData?.modelType || 'pine';
        const treeType = treeName.replace(/\d+$/, '');
        const logType = `${treeType}_log`;
        // Use deterministic ID based on tree ID to prevent duplicate logs on authority transfer
        const treeId = tree.userData?.objectId || tree.id || entity.currentTreeId || 'unknown';
        const logId = `${logType}_from_${treeId}`;
        const totalResources = 5;
        const logRotationDegrees = Math.random() * 360;

        entity.expectedLogId = logId;

        if (this.networkManager) {
            this.networkManager.sendMessage('add_object_request', {
                chunkId: `chunk_${chunkKey}`,
                objectId: logId,
                objectType: logType,
                objectPosition: position,
                objectQuality: quality,
                objectScale: scale,
                objectRotation: logRotationDegrees,
                totalResources: totalResources,
                remainingResources: totalResources,
                clientId: this.clientId,
                accountId: null
            });
        }
    }

    // =========================================================================
    // LOG PROCESSING
    // =========================================================================

    _startProcessingLog(entity, log) {
        const harvestOrder = this._getConfig('HARVEST_ORDER');
        const harvestType = harvestOrder[entity.harvestIndex];

        if (!harvestType) {
            entity.currentLogId = null;
            entity.currentLog = null;
            entity.harvestIndex = 0;
            this._startDelivering(entity);
            return;
        }

        entity.processingStartTime = Date.now();
        entity.currentHarvestType = harvestType;
        entity.state = WOODCUTTER_STATE.PROCESSING_LOG;
        entity.waitingForHarvestResponse = false;
        this._setMoving(entity, false);
        this._setChopping(entity, true);

        // Face the log
        const dx = log.position.x - entity.position.x;
        const dz = log.position.z - entity.position.z;
        entity.rotation = Math.atan2(dx, dz);
        if (entity.mesh) {
            entity.mesh.rotation.y = entity.rotation;
        }

        if (this.broadcastP2P) {
            this.broadcastP2P({
                type: 'woodcutter_action',
                buildingId: entity.buildingId,
                action: 'processing_log',
                harvestType: harvestType,
                position: entity.position
            });
        }
    }

    _handleProcessingLog(entity, deltaTime) {
        // Verify log still exists in the world (not just a stale JS reference)
        if (!this._findLogById(entity.currentLogId)) {
            this._setChopping(entity, false);
            entity.state = WOODCUTTER_STATE.IDLE;
            entity.currentLogId = null;
            entity.currentLog = null;
            entity.waitingForHarvestResponse = false;
            return;
        }

        if (entity.waitingForHarvestResponse) {
            if (!entity._harvestResponseTime) entity._harvestResponseTime = Date.now();
            if (Date.now() - entity._harvestResponseTime > 2000) {
                entity.waitingForHarvestResponse = false;
                entity._harvestResponseTime = null;
            }
            return;
        }
        entity._harvestResponseTime = null;

        const elapsed = Date.now() - entity.processingStartTime;
        const duration = CONFIG.ACTIONS?.HARVEST_LOG_DURATION || 10000;

        if (elapsed >= duration) {
            this._completeProcessingLog(entity);
        }
    }

    _completeProcessingLog(entity) {
        const log = entity.currentLog || this._findLogById(entity.currentLogId);
        if (!log) {
            this._setChopping(entity, false);
            entity.state = WOODCUTTER_STATE.IDLE;
            entity.currentLogId = null;
            entity.currentLog = null;
            return;
        }

        const harvestType = entity.currentHarvestType;
        const logName = log.name || log.userData?.modelType || 'pine_log';
        const logPosition = log.position.toArray ? log.position.toArray() :
            [log.position.x, log.position.y, log.position.z];
        const logQuality = log.quality ?? log.userData?.quality ?? 50;
        const logScale = log.scale?.x ?? log.userData?.scale ?? 1;
        const logChunkKey = log.chunkKey || log.userData?.chunkKey ||
            ChunkCoordinates.worldToChunkKey(log.position.x, log.position.z);
        const logId = log.userData?.objectId || log.id || entity.currentLogId;

        if (this.networkManager) {
            this.networkManager.sendMessage('harvest_resource_request', {
                chunkId: `chunk_${logChunkKey}`,
                objectId: logId,
                harvestType: harvestType,
                clientId: this.clientId,
                objectData: {
                    name: logName,
                    position: logPosition,
                    quality: logQuality,
                    scale: logScale,
                    totalResources: log.totalResources ?? log.userData?.totalResources ?? 5,
                    remainingResources: log.remainingResources ?? log.userData?.remainingResources ?? 5
                }
            });
        }

        // Create item for carrying
        const treeType = logName.replace('_log', '');
        const itemSuffix = harvestType === 'planks' ? 'plank' : 'firewood';
        const itemType = `${treeType}${itemSuffix}`;
        const durability = harvestType === 'firewood' ? Math.max(20, logQuality) : 100;

        entity.carrying.push({
            id: `${itemType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: itemType,
            x: -1, y: -1,
            width: 2, height: 4,
            rotation: 0,
            quality: logQuality,
            durability: durability
        });

        entity.harvestIndex++;
        entity.waitingForHarvestResponse = true;

        const harvestOrder = this._getConfig('HARVEST_ORDER');
        if (entity.harvestIndex < harvestOrder.length) {
            setTimeout(() => {
                if (!entity.waitingForHarvestResponse) return;
                entity.waitingForHarvestResponse = false;

                const updatedLog = this._findLogById(entity.currentLogId);
                if (updatedLog) {
                    const remaining = updatedLog.remainingResources ?? updatedLog.userData?.remainingResources;
                    if (remaining === undefined || remaining === null || remaining > 0) {
                        entity.currentLog = updatedLog;
                        this._startProcessingLog(entity, updatedLog);
                    } else {
                        this._setChopping(entity, false);
                        entity.currentLogId = null;
                        entity.currentLog = null;
                        this._startDelivering(entity);
                    }
                } else {
                    this._setChopping(entity, false);
                    entity.currentLogId = null;
                    entity.currentLog = null;
                    this._startDelivering(entity);
                }
            }, 500);
        } else {
            setTimeout(() => {
                if (!entity.waitingForHarvestResponse) return;
                entity.waitingForHarvestResponse = false;
                this._setChopping(entity, false);
                entity.currentLogId = null;
                entity.currentLog = null;
                entity.harvestIndex = 0;
                this._startDelivering(entity);
            }, 500);
        }
    }

    _startDelivering(entity) {
        const market = this._findMarketNearPosition(entity.homePosition, this._getConfig('MARKET_MAX_DISTANCE'));
        if (!market) {
            // Return to IDLE to retry later (handles P2P authority race conditions)
            entity.state = WOODCUTTER_STATE.IDLE;
            return false;
        }
        entity.targetId = market.id;
        entity.state = WOODCUTTER_STATE.DELIVERING;
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
            if (entity.currentLogId === objectId && entity.waitingForHarvestResponse) {
                entity.waitingForHarvestResponse = false;

                if (entity.currentLog) {
                    entity.currentLog.remainingResources = remainingResources;
                    if (entity.currentLog.userData) {
                        entity.currentLog.userData.remainingResources = remainingResources;
                    }
                }

                if (depleted) {
                    this._setChopping(entity, false);
                    entity.currentLogId = null;
                    entity.currentLog = null;
                    entity.harvestIndex = 0;
                    if (entity.state === WOODCUTTER_STATE.PROCESSING_LOG) {
                        this._startDelivering(entity);
                    }
                } else {
                    const harvestOrder = this._getConfig('HARVEST_ORDER');
                    if (entity.harvestIndex < harvestOrder.length) {
                        entity.currentHarvestType = harvestOrder[entity.harvestIndex];
                        entity.processingStartTime = Date.now();
                        this._setChopping(entity, true);
                    } else {
                        this._setChopping(entity, false);
                        entity.currentLogId = null;
                        entity.currentLog = null;
                        entity.harvestIndex = 0;
                        this._startDelivering(entity);
                    }
                }
                break;
            }
        }
    }

    // =========================================================================
    // TREE/LOG FINDING
    // =========================================================================

    _findNearestPineTree(entity) {
        const maxSearchDistSq = this._getConfig('TREE_SEARCH_RADIUS_SQ');
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
                    if (obj.name !== 'pine') continue;
                    if (obj.userData?.isGrowing) continue;
                    if (obj.userData?.growthScale && obj.userData.growthScale < 1.0) continue;

                    const treeId = obj.userData?.objectId || obj.id;
                    const checkedAt = this._checkedTrees.get(treeId);
                    if (checkedAt && (now - checkedAt) < this._getConfig('TREE_CHECK_COOLDOWN_MS')) continue;

                    const tdx = obj.position.x - homePos.x;
                    const tdz = obj.position.z - homePos.z;
                    const distSq = tdx * tdx + tdz * tdz;

                    if (distSq < maxSearchDistSq && distSq < nearestDistSq) {
                        nearestDistSq = distSq;
                        nearest = obj;
                    }
                }
            }
        }

        return nearest ? { id: nearest.userData?.objectId || nearest.id, position: nearest.position, object: nearest } : null;
    }

    _findTreeById(treeId) {
        if (!treeId) return null;

        if (this.game?.objectRegistry) {
            const obj = this.game.objectRegistry.get(treeId);
            if (obj) return obj;
        }

        return null;
    }

    _findLogById(logId) {
        if (!logId) return null;

        if (this.game?.objectRegistry) {
            const obj = this.game.objectRegistry.get(logId);
            if (obj) return obj;
        }

        return null;
    }

    _findLogNearPosition(position, radius, requireResources = false) {
        if (!position || !this.chunkManager?.chunkObjects) return null;

        const radiusSq = radius * radius;
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(position.x, position.z);

        let nearestLog = null;
        let nearestDistSq = radiusSq;

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const chunkKey = `${chunkX + dx},${chunkZ + dz}`;
                const chunkData = this.chunkManager?.chunkObjects?.get(chunkKey);
                if (!chunkData) continue;

                for (const obj of chunkData) {
                    if (!obj.name?.includes('_log')) continue;
                    if (requireResources) {
                        const remaining = obj.remainingResources ?? obj.userData?.remainingResources ?? 0;
                        if (remaining <= 0) continue;
                    }

                    const ldx = obj.position.x - position.x;
                    const ldz = obj.position.z - position.z;
                    const distSq = ldx * ldx + ldz * ldz;

                    if (distSq < nearestDistSq) {
                        nearestDistSq = distSq;
                        nearestLog = obj;
                    }
                }
            }
        }
        return nearestLog;
    }

    _markTreeChecked(treeId) {
        if (treeId) {
            this._checkedTrees.set(treeId, Date.now());
        }
    }

    _clearStaleCacheEntries(now) {
        const cooldown = this._getConfig('TREE_CHECK_COOLDOWN_MS');
        for (const [treeId, timestamp] of this._checkedTrees) {
            if (now - timestamp > cooldown) {
                this._checkedTrees.delete(treeId);
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
        if (entity.activeSound) {
            entity.mesh?.remove(entity.activeSound);
            try { entity.activeSound.disconnect(); } catch (e) { /* already disconnected */ }
            entity.activeSound = null;
        }
    }

    dispose() {
        super.dispose();
        this._checkedTrees.clear();
    }

    // =========================================================================
    // PUBLIC API (backwards compatibility)
    // =========================================================================

    // Alias for backwards compatibility
    get woodcutters() {
        return this.entities;
    }

    checkWoodcutterSpawn(dockData) {
        return this.checkWorkerSpawn(dockData);
    }

    getWoodcutterDialogueData(buildingId) {
        return this.getWorkerDialogueData(buildingId);
    }

    onWoodcutterBuildingDestroyed(buildingId) {
        return this.onBuildingDestroyed(buildingId);
    }

    getActiveWorkersForSync() {
        return this.getAllWorkersForSync();
    }

    getActiveWoodcuttersForSync() {
        return this.getActiveWorkersForSync();
    }

    syncWoodcuttersFromPeer(woodcutterList, peerId) {
        return this.syncWorkersFromPeer(woodcutterList, peerId);
    }
}

// Singleton instance
export const woodcutterController = new WoodcutterController();
export { WOODCUTTER_STATE };

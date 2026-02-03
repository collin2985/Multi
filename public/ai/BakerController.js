/**
 * BakerController.js
 * Manages Baker NPCs that work at bakeries
 *
 * Baker behavior loop:
 * 1. Collect apples from nearby apple trees
 * 2. Deposit apples at bakery
 * 3. Collect firewood from market
 * 4. Deposit firewood at bakery
 * 5. Wait for bakery to process apples into tarts
 * 6. Collect tarts from bakery
 * 7. Deliver tarts to market
 * 8. Repeat
 *
 * Extends BaseWorkerController for shared P2P authority and movement logic.
 */

import { CONFIG } from '../config.js';
import { ChunkCoordinates } from '../core/ChunkCoordinates.js';
import { BaseWorkerController } from './BaseWorkerController.js';

// Baker-specific configuration (base configs inherited from BaseWorkerController)
const BAKER_CONFIG_DEFAULTS = {
    NPC_COLOR: 0xCC7722,              // Baker apron color (orange-brown)
    APPLE_SEARCH_RADIUS_SQ: 2500,     // 50^2
    APPLES_PER_TRIP: 4
};

// Baker states
const BAKER_STATE = {
    IDLE: 'idle',
    SEEKING_APPLES: 'seeking_apples',
    COLLECTING_APPLES: 'collecting_apples',
    SEEKING_FIREWOOD: 'seeking_firewood',
    COLLECTING_FIREWOOD: 'collecting_firewood',
    RETURNING: 'returning',
    DEPOSITING: 'depositing',
    WAITING_FOR_TARTS: 'waiting_for_tarts',
    WAITING_FOR_APPLES: 'waiting_for_apples',
    WAITING_FOR_FIREWOOD: 'waiting_for_firewood',
    COLLECTING_TARTS: 'collecting_tarts',
    DELIVERING: 'delivering',
    DEPOSITING_TARTS: 'depositing_tarts',
    STUCK: 'stuck',
    REMOVING_EXCESS_FIREWOOD: 'removing_excess_firewood',
    CLEARING_SLOT_FOR_FIREWOOD: 'clearing_slot_for_firewood',
    ASSESSING_BAKERY: 'assessing_bakery'
};

class BakerController extends BaseWorkerController {
    constructor() {
        super({
            workerType: 'baker',
            configKey: 'BAKER',
            npcColor: BAKER_CONFIG_DEFAULTS.NPC_COLOR,
            displayName: 'Baker',
            assessmentStateName: 'ASSESSING_BAKERY',
            movementStates: [
                BAKER_STATE.SEEKING_APPLES,
                BAKER_STATE.SEEKING_FIREWOOD,
                BAKER_STATE.RETURNING,
                BAKER_STATE.DELIVERING
            ]
        });

        // Tree cooldown cache - prevents repeatedly targeting empty trees
        this._checkedTrees = new Map();
        this.TREE_CHECK_COOLDOWN_MS = 60000;
        this.FAILED_TARGET_COOLDOWN_MS = 300000;
        this._lastCacheCleanup = 0;
    }

    // =========================================================================
    // OVERRIDE: Config helper
    // =========================================================================

    _getConfig(key) {
        return CONFIG.BAKER?.[key] ?? BAKER_CONFIG_DEFAULTS[key] ?? super._getConfig(key);
    }

    // =========================================================================
    // ABSTRACT METHOD IMPLEMENTATIONS
    // =========================================================================

    _getStateEnum() {
        return BAKER_STATE;
    }

    _getStructuresInChunk(chunkKey) {
        return this.gameState?.getBakeriesInChunk(chunkKey) || [];
    }

    _createWorkerSpecificState(buildingData) {
        return {
            bakeryId: buildingData.id,  // Alias for backwards compatibility
            previousTask: null,
            _cachedWalkable: true,
            _cachedWalkablePos: { x: 0, z: 0 }
        };
    }

    // =========================================================================
    // UPDATE LOOP OVERRIDE (cache cleanup)
    // =========================================================================

    update(deltaTime) {
        // Periodic cache cleanup
        const now = Date.now();
        if (!this._lastCacheCleanup || now - this._lastCacheCleanup > 60000) {
            this._lastCacheCleanup = now;
            this._cleanupExpiredCache(now);
        }

        super.update(deltaTime);
    }

    _cleanupExpiredCache(now) {
        for (const [treeId, timestamp] of this._checkedTrees) {
            if (now - timestamp >= this.TREE_CHECK_COOLDOWN_MS) {
                this._checkedTrees.delete(treeId);
            }
        }
    }

    // =========================================================================
    // STATE HANDLERS
    // =========================================================================

    _handleIdleState(entity) {
        // IDLE is now just a fallback - immediately go to assessment
        const homeDx = entity.position.x - entity.homePosition.x;
        const homeDz = entity.position.z - entity.homePosition.z;
        const homeDistSq = homeDx * homeDx + homeDz * homeDz;

        if (homeDistSq <= 9) {  // Within 3 units of bakery
            entity.state = BAKER_STATE.ASSESSING_BAKERY;
        } else {
            // Not at bakery, go home first
            entity.state = BAKER_STATE.RETURNING;
            entity.path = [];
        }
    }

    _assessBakeryAndDecide(entity) {
        const bakeryData = this.gameState?.getStructureById(entity.buildingId);
        if (!bakeryData) {
            return { action: 'stuck', reason: 'Lost connection to bakery.' };
        }

        const bakeryInv = bakeryData.object?.userData?.inventory;
        const market = this._findMarketNearPosition(entity.homePosition, this._getConfig('MARKET_MAX_DISTANCE'));

        // PRIORITY 0: Already carrying output (tarts)? -> Deliver them first
        // This handles recovery from stuck/interrupted delivery attempts
        const carryingOutput = entity.carrying.some(item => item?.type === 'appletart');
        if (carryingOutput) {
            if (!market) return { action: 'wait' };
            return { action: 'deliver_tarts', target: market.id };
        }

        // PRIORITY 1: Tarts present? -> Take and deliver
        const tartCount = this._countItemsOfType(bakeryInv, 'appletart');
        if (tartCount > 0) {
            if (!market) return { action: 'wait' };
            return { action: 'collect_tarts', target: market.id };
        }

        // PRIORITY 2: Excess firewood (> 1)? -> Remove excess
        // Use cleanup+count to handle depleted firewood (tick-based durability)
        const firewoodCount = this._cleanupAndCountFirewood(entity.buildingId, bakeryInv, `chunk_${bakeryData.chunkKey}`);
        if (firewoodCount > 1) {
            return { action: 'remove_excess_firewood', excessCount: firewoodCount - 1 };
        }

        // PRIORITY 3: No firewood? -> Handle firewood situation
        if (firewoodCount === 0) {
            // Check if we're carrying firewood
            const carryingFirewood = entity.carrying.some(item => item?.type?.endsWith('firewood'));
            if (carryingFirewood) {
                // Need to clear left slot for firewood, then deposit
                return { action: 'clear_slot_and_deposit_firewood' };
            } else {
                // Need to fetch firewood from market
                if (!market) return { action: 'wait' };
                const marketData = this.gameState?.getStructureById(market.id);
                const marketInv = marketData?.object?.userData?.inventory;
                if (!this._marketHasFirewood(marketInv)) {
                    return { action: 'wait_for_firewood' };
                }
                return { action: 'get_firewood', target: market.id };
            }
        }

        // PRIORITY 4: Apples present? -> Wait for processing (62 ticks)
        const appleCount = this._countItemsOfType(bakeryInv, 'apple');
        if (appleCount > 0) {
            return { action: 'wait_for_tarts' };
        }

        // PRIORITY 5: No apples -> Handle apple situation
        const carryingApples = entity.carrying.some(item => item?.type === 'apple');
        if (carryingApples) {
            return { action: 'deposit_apples' };
        } else {
            const tree = this._findNearestAppleTree(entity.homePosition);
            if (tree) {
                return { action: 'get_apples', target: tree };
            }
            return { action: 'wait_for_apples' };
        }
    }

    _handleAssessingBakery(entity) {
        const now = Date.now();
        if (now - (entity._lastAssessmentTime || 0) < 2000) return;
        entity._lastAssessmentTime = now;
        const decision = this._assessBakeryAndDecide(entity);

        switch (decision.action) {
            case 'deliver_tarts':
                // Resume interrupted delivery - already carrying tarts
                entity.state = BAKER_STATE.DELIVERING;
                entity.targetId = decision.target;
                entity.path = [];
                break;

            case 'collect_tarts':
                entity.state = BAKER_STATE.COLLECTING_TARTS;
                entity.targetId = decision.target;
                break;

            case 'remove_excess_firewood':
                entity.state = BAKER_STATE.REMOVING_EXCESS_FIREWOOD;
                entity._excessFirewoodCount = decision.excessCount;
                entity.requestSentAt = null;
                break;

            case 'clear_slot_and_deposit_firewood':
                entity.state = BAKER_STATE.CLEARING_SLOT_FOR_FIREWOOD;
                entity.requestSentAt = null;
                break;

            case 'get_firewood':
                entity.state = BAKER_STATE.SEEKING_FIREWOOD;
                entity.targetId = decision.target;
                entity.path = [];
                break;

            case 'wait_for_firewood':
                entity.state = BAKER_STATE.WAITING_FOR_FIREWOOD;
                entity._lastDecisionTime = 0;
                break;

            case 'wait_for_tarts':
                entity.state = BAKER_STATE.WAITING_FOR_TARTS;
                break;

            case 'deposit_apples':
                entity.state = BAKER_STATE.DEPOSITING;
                entity.requestSentAt = null;
                break;

            case 'get_apples':
                entity.state = BAKER_STATE.SEEKING_APPLES;
                entity.targetId = decision.target?.id || null;
                entity.path = [];
                break;

            case 'wait_for_apples':
                entity.state = BAKER_STATE.WAITING_FOR_APPLES;
                entity._lastDecisionTime = 0;
                break;

            case 'stuck':
                this._enterStuckState(entity, decision.reason);
                break;

            case 'wait':
                break;
        }
    }

    _handleWorkerSpecificState(entity, deltaTime) {
        switch (entity.state) {
            case BAKER_STATE.COLLECTING_APPLES:
                this._handleCollectingApples(entity);
                break;
            case BAKER_STATE.COLLECTING_FIREWOOD:
                this._handleCollectingFirewood(entity);
                break;
            case BAKER_STATE.DEPOSITING:
                this._handleDepositing(entity);
                break;
            case BAKER_STATE.WAITING_FOR_TARTS:
                this._handleWaitingForTarts(entity);
                break;
            case BAKER_STATE.WAITING_FOR_APPLES:
                this._handleWaitingForApples(entity);
                break;
            case BAKER_STATE.WAITING_FOR_FIREWOOD:
                this._handleWaitingForFirewood(entity);
                break;
            case BAKER_STATE.COLLECTING_TARTS:
                this._handleCollectingTarts(entity);
                break;
            case BAKER_STATE.DEPOSITING_TARTS:
                this._handleMarketDeposit(entity);
                break;
            case BAKER_STATE.ASSESSING_BAKERY:
                this._handleAssessingBakery(entity);
                break;
            case BAKER_STATE.REMOVING_EXCESS_FIREWOOD:
                this._handleRemovingExcessFirewood(entity);
                break;
            case BAKER_STATE.CLEARING_SLOT_FOR_FIREWOOD:
                this._handleClearingSlotForFirewood(entity);
                break;
        }
    }

    _getMovementTarget(entity) {
        switch (entity.state) {
            case BAKER_STATE.SEEKING_APPLES:
                const tree = this._getAppleTreeData(entity.targetId);
                if (!tree) return null;
                return this._calculateApproachPosition(tree, entity.position, 0.75);

            case BAKER_STATE.SEEKING_FIREWOOD:
            case BAKER_STATE.DELIVERING:
                const market = this.gameState?.getStructureById(entity.targetId);
                if (!market) return null;
                return this._calculateApproachPosition(market, entity.position, 4.0);

            case BAKER_STATE.RETURNING:
                const bakery = this.gameState?.getStructureById(entity.buildingId);
                if (!bakery) {
                    return { x: entity.homePosition.x, z: entity.homePosition.z };
                }
                return this._calculateApproachPosition(bakery, entity.position, 0.75);

            default:
                return null;
        }
    }

    _onArrival(entity) {
        this._setMoving(entity, false);
        entity.path = [];
        entity.pathIndex = 0;

        switch (entity.state) {
            case BAKER_STATE.SEEKING_APPLES:
                entity.state = BAKER_STATE.COLLECTING_APPLES;
                entity.requestSentAt = null;
                break;
            case BAKER_STATE.SEEKING_FIREWOOD:
                entity.state = BAKER_STATE.COLLECTING_FIREWOOD;
                entity.requestSentAt = null;
                break;
            case BAKER_STATE.RETURNING:
                entity.state = BAKER_STATE.ASSESSING_BAKERY;
                entity.requestSentAt = null;
                break;
            case BAKER_STATE.DELIVERING:
                entity.state = BAKER_STATE.DEPOSITING_TARTS;
                entity.requestSentAt = null;
                break;
        }
    }

    // =========================================================================
    // COLLECTION STATES
    // =========================================================================

    _handleCollectingApples(entity) {
        if (!entity.requestSentAt) {
            const treeData = this._getAppleTreeData(entity.targetId);
            if (!treeData) {
                if (entity.targetId) {
                    this._checkedTrees.set(entity.targetId, Date.now());
                }
                const nextTree = this._findNearestAppleTree(entity.homePosition);
                if (nextTree) {
                    entity.state = BAKER_STATE.SEEKING_APPLES;
                    entity.targetId = nextTree.id;
                    entity.path = [];
                } else {
                    entity.state = BAKER_STATE.RETURNING;
                    entity.targetId = null;
                }
                return;
            }

            entity.requestSentAt = Date.now();
            if (this.networkManager) {
                this.networkManager.sendMessage('npc_collect_apples', {
                    npcType: 'baker',
                    bakeryId: entity.buildingId,
                    treeId: entity.targetId,
                    chunkId: treeData.chunkId,
                    maxCount: this._getConfig('APPLES_PER_TRIP')
                });
            }
        }

        if (Date.now() - entity.requestSentAt > 10000) {
            entity.requestSentAt = null;
            if (entity.targetId) {
                this._checkedTrees.set(entity.targetId, Date.now());
            }
            const nextTree = this._findNearestAppleTree(entity.homePosition);
            if (nextTree) {
                entity.state = BAKER_STATE.SEEKING_APPLES;
                entity.targetId = nextTree.id;
                entity.path = [];
            } else {
                entity.state = BAKER_STATE.RETURNING;
                entity.targetId = null;
            }
        }
    }

    _handleCollectingTarts(entity) {
        if (!entity.requestSentAt) {
            entity.requestSentAt = Date.now();

            if (this.networkManager) {
                const bakeryData = this.gameState?.getStructureById(entity.buildingId);
                if (bakeryData) {
                    this.networkManager.sendMessage('npc_collect_from_structure', {
                        npcType: 'baker',
                        bakeryId: entity.buildingId,
                        structureId: entity.buildingId,
                        chunkId: `chunk_${bakeryData.chunkKey}`,
                        itemType: 'appletart',
                        count: 10
                    });
                }
            }
        }

        if (Date.now() - entity.requestSentAt > 10000) {
            entity.requestSentAt = null;
            entity.state = BAKER_STATE.ASSESSING_BAKERY;
        }
    }

    // =========================================================================
    // DEPOSITING STATES
    // =========================================================================

    _handleDepositing(entity) {
        const bakeryData = this.gameState?.getStructureById(entity.buildingId);

        // FIX: Transition out if can't deposit (prevents infinite loop)
        if (!bakeryData || !entity.carrying || entity.carrying.length === 0) {
            entity.state = BAKER_STATE.ASSESSING_BAKERY;
            entity.requestSentAt = null;
            return;
        }

        if (entity.requestSentAt) {
            if (Date.now() - entity.requestSentAt > 10000) {
                entity.requestSentAt = null;
                entity.carrying.length = 0;
                entity.state = BAKER_STATE.ASSESSING_BAKERY;
            }
            return;
        }

        if (this.networkManager) {
            this.networkManager.sendMessage('npc_deposit_inventory', {
                npcType: 'baker',
                bakeryId: entity.buildingId,
                structureId: entity.buildingId,
                chunkId: `chunk_${bakeryData.chunkKey}`,
                items: entity.carrying
            });
            entity.requestSentAt = Date.now();
        }
    }

    // =========================================================================
    // WAITING STATES
    // =========================================================================

    /**
     * Send processing_complete for any items that have finished processing.
     * This uses the same tick-based approach as CrateInventoryUI for player cooking.
     * Fixes issue where NPC doesn't receive broadcast if player is out of range.
     */
    _sendCompletionForReadyItems(inventory, structureId, chunkId) {
        if (!inventory?.items || !this.networkManager) return 0;

        const currentTick = this.gameState?.serverTick || 0;
        let completionsSent = 0;

        for (const item of inventory.items) {
            // Check for processing tick fields (same as CrateInventoryUI)
            if (item.processingStartTick && item.processingDurationTicks) {
                const ticksElapsed = currentTick - item.processingStartTick;

                // If processing complete and we haven't sent completion yet
                if (ticksElapsed >= item.processingDurationTicks && !item._npcCompletionSent) {
                    item._npcCompletionSent = true;
                    completionsSent++;

                    this.networkManager.sendMessage('processing_complete', {
                        structureId,
                        itemId: item.id,
                        chunkId
                    });
                }
            }
        }

        return completionsSent;
    }

    _handleWaitingForTarts(entity) {
        const currentTick = this.gameState?.serverTick || 0;

        // Get bakery data
        const bakeryData = this.gameState?.getStructureById(entity.buildingId);
        const bakeryInv = bakeryData?.object?.userData?.inventory;
        const chunkId = bakeryData ? `chunk_${bakeryData.chunkKey}` : null;

        // Send completion messages for any items that finished processing
        // This is the key fix - directly send completion like player UI does
        if (bakeryInv && chunkId) {
            this._sendCompletionForReadyItems(bakeryInv, entity.buildingId, chunkId);
        }

        // Track total time in WAITING_FOR_TARTS (not reset each check cycle)
        if (!entity._tartWaitStartTick) {
            entity._tartWaitStartTick = currentTick;
        }

        // Timeout: if waiting >130 ticks (~2 min), reassess to recover from
        // stuck states (lost messages, authority transfer, firewood depletion)
        if (currentTick - entity._tartWaitStartTick > 130) {
            entity._tartWaitStartTick = null;
            entity._waitStartTick = null;
            entity.state = BAKER_STATE.ASSESSING_BAKERY;
            return;
        }

        // Record when we started this check cycle (for 5-tick interval)
        if (!entity._waitStartTick) {
            entity._waitStartTick = currentTick;
        }

        // Check every 5 ticks since we're actively sending completions
        const ticksWaited = currentTick - entity._waitStartTick;
        if (ticksWaited < 5) {
            return;  // Brief wait for server response
        }

        // Reset interval timer for next check cycle
        entity._waitStartTick = currentTick;

        // Check for tarts
        const tartCount = this._countItemsOfType(bakeryInv, 'appletart');

        if (tartCount > 0) {
            // Tarts ready! Go back to assessment
            entity._tartWaitStartTick = null;
            entity._waitStartTick = null;
            entity.state = BAKER_STATE.ASSESSING_BAKERY;
            return;
        }

        // No tarts yet - check if apples still processing
        const appleCount = this._countItemsOfType(bakeryInv, 'apple');
        if (appleCount > 0) {
            // Still have apples processing, continue waiting
            // (completion will be sent on next cycle when ready)
            return;
        }

        // No apples, no tarts - reassess
        entity._tartWaitStartTick = null;
        entity._waitStartTick = null;
        entity.state = BAKER_STATE.ASSESSING_BAKERY;
    }

    _handleWaitingForApples(entity) {
        const now = Date.now();
        if (now - entity._lastDecisionTime < 30000) return;
        entity._lastDecisionTime = now;
        if (this._isBuildingDestroyed(entity)) return;

        const tree = this._findNearestAppleTree(entity.homePosition);
        if (tree) {
            entity.state = BAKER_STATE.ASSESSING_BAKERY;
        }
    }

    // =========================================================================
    // SERVER RESPONSE HANDLERS
    // =========================================================================

    handleAppleCollectResponse(data) {
        if (!data) return;
        const { success, collected, treeId, bakeryId } = data;
        if (!bakeryId) return;

        const entity = this.entities.get(bakeryId);
        if (!entity || entity.state !== BAKER_STATE.COLLECTING_APPLES) return;

        entity.requestSentAt = null;

        if (success && Array.isArray(collected) && collected.length > 0) {
            for (const item of collected) {
                if (item?.type) {
                    entity.carrying.push(item);
                }
            }
            // Update local cache to prevent stale reads
            if (treeId) {
                this._updateLocalInventoryCache(treeId, [], collected);
            }
        }

        if (treeId && (!success || !collected || collected.length === 0)) {
            this._checkedTrees.set(treeId, Date.now());
        }

        if (entity.carrying.length < this._getConfig('APPLES_PER_TRIP')) {
            const nextTree = this._findNearestAppleTree(entity.homePosition);
            if (nextTree) {
                entity.state = BAKER_STATE.SEEKING_APPLES;
                entity.targetId = nextTree.id;
                entity.path = [];
            } else {
                entity.state = BAKER_STATE.RETURNING;
                entity.targetId = null;
            }
        } else {
            entity.state = BAKER_STATE.RETURNING;
            entity.targetId = null;
        }
    }

    handleCollectResponse(data) {
        if (!data) return;
        const { success, collected, bakeryId, itemType, marketId, structureId } = data;
        const buildingId = structureId || bakeryId;
        if (!buildingId) return;

        const entity = this.entities.get(buildingId);
        if (!entity) return;

        entity.requestSentAt = null;

        if (success && Array.isArray(collected) && collected.length > 0) {
            for (const item of collected) {
                if (item?.type) {
                    entity.carrying.push(item);
                }
            }
            // Update local cache to prevent stale reads
            const sourceId = structureId || marketId || bakeryId;
            this._updateLocalInventoryCache(sourceId, [], collected);
        }

        if (itemType === 'firewood' || itemType?.endsWith?.('firewood')) {
            entity.state = BAKER_STATE.RETURNING;
            entity.targetId = null;
        } else if (itemType === 'appletart') {
            entity.state = BAKER_STATE.DELIVERING;
            const market = this._findMarketNearPosition(entity.homePosition, this._getConfig('MARKET_MAX_DISTANCE'));
            entity.targetId = market?.id || null;
            entity.path = [];
        }
    }

    handleDepositResponse(data) {
        // Fire-and-forget: state already transitioned, no action needed
    }

    handleRemoveFirewoodResponse(data) {
        if (!data) return;
        const { success, bakeryId, structureId, removedCount } = data;
        const buildingId = structureId || bakeryId;
        if (!buildingId) return;

        const entity = this.entities.get(buildingId);
        if (!entity || entity.state !== BAKER_STATE.REMOVING_EXCESS_FIREWOOD) return;

        entity.requestSentAt = null;
        entity.state = BAKER_STATE.ASSESSING_BAKERY;
    }

    handleClearDepositResponse(data) {
        if (!data) return;
        const { success, bakeryId, structureId, clearedCount } = data;
        const buildingId = structureId || bakeryId;
        if (!buildingId) return;

        const entity = this.entities.get(buildingId);
        if (!entity || entity.state !== BAKER_STATE.CLEARING_SLOT_FOR_FIREWOOD) return;

        entity.requestSentAt = null;

        if (success) {
            const idx = entity.carrying.findIndex(item => item?.type?.endsWith('firewood'));
            if (idx !== -1) {
                entity.carrying.splice(idx, 1);
            }
        }

        entity.state = BAKER_STATE.ASSESSING_BAKERY;
    }

    // =========================================================================
    // APPLE TREE FINDING
    // =========================================================================

    _findNearestAppleTree(position) {
        const maxDistSq = this._getConfig('APPLE_SEARCH_RADIUS_SQ');
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(position.x, position.z);
        const now = Date.now();

        let nearest = null;
        let nearestDistSq = Infinity;

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = `${chunkX + dx},${chunkZ + dz}`;
                const trees = this.gameState?.getDeerTreeStructuresInChunk(key) || [];

                for (const tree of trees) {
                    if (!tree.id?.includes('apple')) continue;

                    const remaining = tree.object?.userData?.remainingResources;
                    if (remaining !== undefined && remaining !== null && remaining <= 0) continue;

                    const checkedAt = this._checkedTrees.get(tree.id);
                    if (checkedAt && (now - checkedAt) < this.TREE_CHECK_COOLDOWN_MS) continue;

                    const tdx = tree.position.x - position.x;
                    const tdz = tree.position.z - position.z;
                    const distSq = tdx * tdx + tdz * tdz;

                    if (distSq <= maxDistSq && distSq < nearestDistSq) {
                        nearest = tree;
                        nearestDistSq = distSq;
                    }
                }
            }
        }

        return nearest;
    }

    _getAppleTreeData(treeId) {
        if (!treeId) return null;

        for (const [chunkKey, trees] of this.gameState?.deerTreeStructuresByChunk || []) {
            for (const tree of trees) {
                if (tree.id === treeId) {
                    return { ...tree, chunkId: `chunk_${chunkKey}` };
                }
            }
        }
        return null;
    }

    // =========================================================================
    // CLEANUP
    // =========================================================================

    dispose() {
        super.dispose();
        this._checkedTrees.clear();
    }

    // =========================================================================
    // AUTHORITY OVERRIDE - Baker uses homePosition (matches old behavior)
    // =========================================================================

    _calculateAuthority(buildingId) {
        return this._calculateAuthorityByHome(buildingId);
    }

    // =========================================================================
    // SYNC OVERRIDE - Baker returns ALL entities (matches old behavior)
    // =========================================================================

    getActiveWorkersForSync() {
        return this.getAllWorkersForSync();
    }

    // =========================================================================
    // PUBLIC API (backwards compatibility)
    // =========================================================================

    get bakers() {
        return this.entities;
    }

    checkBakerSpawn(dockData) {
        return this.checkWorkerSpawn(dockData);
    }

    getBakerDialogueData(bakeryId) {
        return this.getWorkerDialogueData(bakeryId);
    }

    onBakeryDestroyed(bakeryId) {
        return this.onBuildingDestroyed(bakeryId);
    }

    getActiveBakersForSync() {
        return this.getActiveWorkersForSync();
    }

    syncBakersFromPeer(bakerList, peerId) {
        return this.syncWorkersFromPeer(bakerList, peerId);
    }
}

// Singleton instance
export const bakerController = new BakerController();
export { BAKER_STATE };

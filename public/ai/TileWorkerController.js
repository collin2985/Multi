/**
 * TileWorkerController.js
 * Manages TileWorker NPCs that work at tileworks
 *
 * TileWorker behavior loop:
 * 1. Collect clay (5) from market
 * 2. Collect firewood (1) from market
 * 3. Deposit both at tileworks
 * 4. Wait for tileworks to process clay into tile
 * 5. Collect tile from tileworks
 * 6. Deliver tile to market
 * 7. Repeat
 *
 * Extends BaseWorkerController for shared P2P authority and movement logic.
 */

import { CONFIG } from '../config.js';
import { BaseWorkerController } from './BaseWorkerController.js';

// TileWorker-specific configuration (base configs inherited from BaseWorkerController)
const TILEWORKER_CONFIG_DEFAULTS = {
    NPC_COLOR: 0xCD853F,              // Terracotta/clay color
    ITEMS_PER_TRIP: 5
};

// TileWorker states
const TILEWORKER_STATE = {
    IDLE: 'idle',
    SEEKING_INPUT: 'seeking_input',
    COLLECTING_INPUT: 'collecting_input',
    SEEKING_FIREWOOD: 'seeking_firewood',
    COLLECTING_FIREWOOD: 'collecting_firewood',
    RETURNING: 'returning',
    DEPOSITING: 'depositing',
    WAITING_FOR_OUTPUT: 'waiting_for_output',
    WAITING_FOR_INPUT: 'waiting_for_input',
    WAITING_FOR_FIREWOOD: 'waiting_for_firewood',
    COLLECTING_OUTPUT: 'collecting_output',
    DELIVERING: 'delivering',
    DEPOSITING_OUTPUT: 'depositing_output',
    STUCK: 'stuck',
    REMOVING_EXCESS_FIREWOOD: 'removing_excess_firewood',
    CLEARING_SLOT_FOR_FIREWOOD: 'clearing_slot_for_firewood',
    ASSESSING_STRUCTURE: 'assessing_structure'
};

class TileWorkerController extends BaseWorkerController {
    constructor() {
        super({
            workerType: 'tileworker',
            configKey: 'TILEWORKER',
            npcColor: TILEWORKER_CONFIG_DEFAULTS.NPC_COLOR,
            displayName: 'Tile Worker',
            assessmentStateName: 'ASSESSING_STRUCTURE',
            movementStates: [
                TILEWORKER_STATE.SEEKING_INPUT,
                TILEWORKER_STATE.SEEKING_FIREWOOD,
                TILEWORKER_STATE.RETURNING,
                TILEWORKER_STATE.DELIVERING
            ]
        });
    }

    // =========================================================================
    // OVERRIDE: Config helper
    // =========================================================================

    _getConfig(key) {
        return CONFIG.TILEWORKER?.[key] ?? TILEWORKER_CONFIG_DEFAULTS[key] ?? super._getConfig(key);
    }

    // =========================================================================
    // ABSTRACT METHOD IMPLEMENTATIONS
    // =========================================================================

    _getStateEnum() {
        return TILEWORKER_STATE;
    }

    _getStructuresInChunk(chunkKey) {
        return this.gameState?.getTileworksInChunk(chunkKey) || [];
    }

    _createWorkerSpecificState(buildingData) {
        return {
            tileworksId: buildingData.id,  // Alias for backwards compatibility
            previousTask: null,
            _cachedWalkable: true,
            _cachedWalkablePos: { x: 0, z: 0 }
        };
    }

    // =========================================================================
    // STATE HANDLERS
    // =========================================================================

    _handleIdleState(entity) {
        // IDLE is now just a fallback - immediately go to assessment
        const homeDx = entity.position.x - entity.homePosition.x;
        const homeDz = entity.position.z - entity.homePosition.z;
        const homeDistSq = homeDx * homeDx + homeDz * homeDz;

        if (homeDistSq <= 9) {  // Within 3 units of tileworks
            entity.state = TILEWORKER_STATE.ASSESSING_STRUCTURE;
        } else {
            // Not at tileworks, go home first
            entity.state = TILEWORKER_STATE.RETURNING;
            entity.path = [];
        }
    }

    _assessStructureAndDecide(entity) {
        const structureData = this.gameState?.getStructureById(entity.buildingId);
        if (!structureData) {
            return { action: 'stuck', reason: 'Lost connection to tileworks.' };
        }

        const structureInv = structureData.object?.userData?.inventory;
        const market = this._findMarketNearPosition(entity.homePosition, this._getConfig('MARKET_MAX_DISTANCE'));

        // PRIORITY 0: Already carrying output (tile)? -> Deliver it first
        // This handles recovery from stuck/interrupted delivery attempts
        const carryingOutput = entity.carrying.some(item => item?.type === 'tile');
        if (carryingOutput) {
            if (!market) return { action: 'wait' };
            return { action: 'deliver_output', target: market.id };
        }

        // PRIORITY 1: Output (tile) present? -> Take and deliver
        const outputCount = this._countItemsOfType(structureInv, 'tile');
        if (outputCount > 0) {
            if (!market) return { action: 'wait' };
            return { action: 'collect_output', target: market.id };
        }

        // PRIORITY 2: Excess firewood (> 1)? -> Remove excess
        // Use cleanup+count to handle depleted firewood (tick-based durability)
        const firewoodCount = this._cleanupAndCountFirewood(entity.buildingId, structureInv, `chunk_${structureData.chunkKey}`);
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

        // PRIORITY 4: Input (clay) present? -> Wait for processing (62 ticks)
        const inputCount = this._countItemsOfType(structureInv, 'clay');
        if (inputCount > 0) {
            return { action: 'wait_for_output' };
        }

        // PRIORITY 5: No input -> Handle input situation (get from market)
        const carryingInput = entity.carrying.some(item => item?.type === 'clay');
        if (carryingInput) {
            return { action: 'deposit_input' };
        } else {
            // Get input from market
            if (!market) return { action: 'wait' };
            const marketData = this.gameState?.getStructureById(market.id);
            const marketInv = marketData?.object?.userData?.inventory;
            if (!this._marketHasItem(marketInv, 'clay', 1)) {
                return { action: 'wait_for_input' };
            }
            return { action: 'get_input', target: market.id };
        }
    }

    _handleAssessingStructure(entity) {
        const now = Date.now();
        if (now - (entity._lastAssessmentTime || 0) < 2000) return;
        entity._lastAssessmentTime = now;
        const decision = this._assessStructureAndDecide(entity);

        switch (decision.action) {
            case 'deliver_output':
                // Resume interrupted delivery - already carrying tiles
                entity.state = TILEWORKER_STATE.DELIVERING;
                entity.targetId = decision.target;
                entity.path = [];
                break;

            case 'collect_output':
                entity.state = TILEWORKER_STATE.COLLECTING_OUTPUT;
                entity.targetId = decision.target;
                break;

            case 'remove_excess_firewood':
                entity.state = TILEWORKER_STATE.REMOVING_EXCESS_FIREWOOD;
                entity._excessFirewoodCount = decision.excessCount;
                entity.requestSentAt = null;
                break;

            case 'clear_slot_and_deposit_firewood':
                entity.state = TILEWORKER_STATE.CLEARING_SLOT_FOR_FIREWOOD;
                entity.requestSentAt = null;
                break;

            case 'get_firewood':
                entity.state = TILEWORKER_STATE.SEEKING_FIREWOOD;
                entity.targetId = decision.target;
                entity.path = [];
                break;

            case 'wait_for_firewood':
                entity.state = TILEWORKER_STATE.WAITING_FOR_FIREWOOD;
                entity._lastDecisionTime = 0;
                break;

            case 'wait_for_output':
                entity.state = TILEWORKER_STATE.WAITING_FOR_OUTPUT;
                break;

            case 'deposit_input':
                entity.state = TILEWORKER_STATE.DEPOSITING;
                entity.requestSentAt = null;
                break;

            case 'get_input':
                entity.state = TILEWORKER_STATE.SEEKING_INPUT;
                entity.targetId = decision.target;
                entity.path = [];
                break;

            case 'wait_for_input':
                entity.state = TILEWORKER_STATE.WAITING_FOR_INPUT;
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
            case TILEWORKER_STATE.COLLECTING_INPUT:
                this._handleCollectingInput(entity);
                break;
            case TILEWORKER_STATE.COLLECTING_FIREWOOD:
                this._handleCollectingFirewood(entity);
                break;
            case TILEWORKER_STATE.DEPOSITING:
                this._handleDepositing(entity);
                break;
            case TILEWORKER_STATE.WAITING_FOR_OUTPUT:
                this._handleWaitingForOutput(entity);
                break;
            case TILEWORKER_STATE.WAITING_FOR_INPUT:
                this._handleWaitingForInput(entity);
                break;
            case TILEWORKER_STATE.WAITING_FOR_FIREWOOD:
                this._handleWaitingForFirewood(entity);
                break;
            case TILEWORKER_STATE.COLLECTING_OUTPUT:
                this._handleCollectingOutput(entity);
                break;
            case TILEWORKER_STATE.DEPOSITING_OUTPUT:
                this._handleMarketDeposit(entity);
                break;
            case TILEWORKER_STATE.ASSESSING_STRUCTURE:
                this._handleAssessingStructure(entity);
                break;
            case TILEWORKER_STATE.REMOVING_EXCESS_FIREWOOD:
                this._handleRemovingExcessFirewood(entity);
                break;
            case TILEWORKER_STATE.CLEARING_SLOT_FOR_FIREWOOD:
                this._handleClearingSlotForFirewood(entity);
                break;
        }
    }

    _getMovementTarget(entity) {
        switch (entity.state) {
            case TILEWORKER_STATE.SEEKING_INPUT:
            case TILEWORKER_STATE.SEEKING_FIREWOOD:
            case TILEWORKER_STATE.DELIVERING:
                const market = this.gameState?.getStructureById(entity.targetId);
                if (!market) return null;
                return this._calculateApproachPosition(market, entity.position, 4.0);

            case TILEWORKER_STATE.RETURNING:
                const structure = this.gameState?.getStructureById(entity.buildingId);
                if (!structure) {
                    return { x: entity.homePosition.x, z: entity.homePosition.z };
                }
                return this._calculateApproachPosition(structure, entity.position, 2.0);

            default:
                return null;
        }
    }

    _onArrival(entity) {
        this._setMoving(entity, false);
        entity.path = [];
        entity.pathIndex = 0;

        switch (entity.state) {
            case TILEWORKER_STATE.SEEKING_INPUT:
                entity.state = TILEWORKER_STATE.COLLECTING_INPUT;
                entity.requestSentAt = null;
                break;
            case TILEWORKER_STATE.SEEKING_FIREWOOD:
                entity.state = TILEWORKER_STATE.COLLECTING_FIREWOOD;
                entity.requestSentAt = null;
                break;
            case TILEWORKER_STATE.RETURNING:
                entity.state = TILEWORKER_STATE.ASSESSING_STRUCTURE;
                entity.requestSentAt = null;
                break;
            case TILEWORKER_STATE.DELIVERING:
                entity.state = TILEWORKER_STATE.DEPOSITING_OUTPUT;
                entity.requestSentAt = null;
                break;
        }
    }

    // =========================================================================
    // COLLECTION STATES
    // =========================================================================

    _handleCollectingInput(entity) {
        // Collect input (clay) from market
        if (!entity.requestSentAt) {
            entity.requestSentAt = Date.now();

            if (this.networkManager) {
                const marketData = this.gameState?.getStructureById(entity.targetId);
                if (marketData) {
                    this.networkManager.sendMessage('npc_collect_from_market', {
                        npcType: 'tileworker',
                        structureId: entity.buildingId,
                        marketId: entity.targetId,
                        chunkId: `chunk_${marketData.chunkKey}`,
                        itemType: 'clay',
                        count: this._getConfig('ITEMS_PER_TRIP')
                    });
                }
            }
        }

        if (Date.now() - entity.requestSentAt > 10000) {
            entity.requestSentAt = null;
            entity.state = TILEWORKER_STATE.RETURNING;
            entity.targetId = null;
        }
    }

    _handleCollectingFirewood(entity) {
        if (!entity.requestSentAt) {
            entity.requestSentAt = Date.now();

            if (this.networkManager) {
                const marketData = this.gameState?.getStructureById(entity.targetId);
                if (marketData) {
                    this.networkManager.sendMessage('npc_collect_from_market', {
                        npcType: 'tileworker',
                        structureId: entity.buildingId,
                        marketId: entity.targetId,
                        chunkId: `chunk_${marketData.chunkKey}`,
                        itemType: 'firewood',
                        count: 1
                    });
                }
            }
        }

        if (Date.now() - entity.requestSentAt > 10000) {
            entity.requestSentAt = null;
            entity.state = TILEWORKER_STATE.RETURNING;
            entity.targetId = null;
        }
    }

    _handleCollectingOutput(entity) {
        if (!entity.requestSentAt) {
            entity.requestSentAt = Date.now();

            if (this.networkManager) {
                const structureData = this.gameState?.getStructureById(entity.buildingId);
                if (structureData) {
                    this.networkManager.sendMessage('npc_collect_from_structure', {
                        npcType: 'tileworker',
                        structureId: entity.buildingId,
                        chunkId: `chunk_${structureData.chunkKey}`,
                        itemType: 'tile',
                        count: 10
                    });
                }
            }
        }

        if (Date.now() - entity.requestSentAt > 10000) {
            entity.requestSentAt = null;
            entity.state = TILEWORKER_STATE.ASSESSING_STRUCTURE;
        }
    }

    // =========================================================================
    // DEPOSITING STATES
    // =========================================================================

    _handleDepositing(entity) {
        const structureData = this.gameState?.getStructureById(entity.buildingId);

        // FIX: Transition out if can't deposit (prevents infinite loop)
        if (!structureData || !entity.carrying || entity.carrying.length === 0) {
            entity.state = TILEWORKER_STATE.ASSESSING_STRUCTURE;
            entity.requestSentAt = null;
            return;
        }

        if (entity.requestSentAt) {
            if (Date.now() - entity.requestSentAt > 10000) {
                entity.requestSentAt = null;
                entity.carrying.length = 0;
                entity.state = TILEWORKER_STATE.ASSESSING_STRUCTURE;
            }
            return;
        }

        if (this.networkManager) {
            this.networkManager.sendMessage('npc_deposit_inventory', {
                npcType: 'tileworker',
                structureId: entity.buildingId,
                chunkId: `chunk_${structureData.chunkKey}`,
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

    _handleWaitingForOutput(entity) {
        const currentTick = this.gameState?.serverTick || 0;

        // Get structure data
        const structureData = this.gameState?.getStructureById(entity.buildingId);
        const structureInv = structureData?.object?.userData?.inventory;
        const chunkId = structureData ? `chunk_${structureData.chunkKey}` : null;

        // Send completion messages for any items that finished processing
        // This is the key fix - directly send completion like player UI does
        if (structureInv && chunkId) {
            this._sendCompletionForReadyItems(structureInv, entity.buildingId, chunkId);
        }

        // Record when we started waiting (for timeout)
        if (!entity._waitStartTick) {
            entity._waitStartTick = currentTick;
        }

        // Check every 5 ticks (not 62) since we're actively sending completions
        const ticksWaited = currentTick - entity._waitStartTick;
        if (ticksWaited < 5) {
            return;  // Brief wait for server response
        }

        // Reset wait timer for next check cycle
        entity._waitStartTick = currentTick;

        // Check for output (tile)
        const outputCount = this._countItemsOfType(structureInv, 'tile');

        if (outputCount > 0) {
            // Output ready! Go back to assessment
            entity._waitStartTick = null;
            entity.state = TILEWORKER_STATE.ASSESSING_STRUCTURE;
            return;
        }

        // No output yet - check if input still processing
        const inputCount = this._countItemsOfType(structureInv, 'clay');
        if (inputCount > 0) {
            // Still have input processing, continue waiting
            return;
        }

        // No input, no output - reassess
        entity._waitStartTick = null;
        entity.state = TILEWORKER_STATE.ASSESSING_STRUCTURE;
    }

    _handleWaitingForInput(entity) {
        // Check market for input (clay) every 30 seconds
        const now = Date.now();
        if (now - entity._lastDecisionTime < 30000) return;
        entity._lastDecisionTime = now;
        if (this._isBuildingDestroyed(entity)) return;

        const market = this._findMarketNearPosition(entity.homePosition, this._getConfig('MARKET_MAX_DISTANCE'));
        if (market) {
            const marketData = this.gameState?.getStructureById(market.id);
            const marketInv = marketData?.object?.userData?.inventory;
            if (this._marketHasItem(marketInv, 'clay', 1)) {
                entity.state = TILEWORKER_STATE.ASSESSING_STRUCTURE;
            }
        }
    }

    _handleWaitingForFirewood(entity) {
        const now = Date.now();
        if (now - entity._lastDecisionTime < 30000) return;
        entity._lastDecisionTime = now;
        if (this._isBuildingDestroyed(entity)) return;

        const market = this._findMarketNearPosition(entity.homePosition, this._getConfig('MARKET_MAX_DISTANCE'));
        if (market) {
            const marketData = this.gameState?.getStructureById(market.id);
            const marketInv = marketData?.object?.userData?.inventory;
            if (this._marketHasFirewood(marketInv)) {
                entity.state = TILEWORKER_STATE.ASSESSING_STRUCTURE;
            }
        }
    }

    // =========================================================================
    // SERVER RESPONSE HANDLERS
    // =========================================================================

    handleCollectResponse(data) {
        if (!data) return;
        const { success, collected, structureId, itemType, marketId } = data;
        if (!structureId) return;

        const entity = this.entities.get(structureId);
        if (!entity) return;

        entity.requestSentAt = null;

        if (success && Array.isArray(collected) && collected.length > 0) {
            for (const item of collected) {
                if (item?.type) {
                    entity.carrying.push(item);
                }
            }
            // Update local cache to prevent stale reads
            const sourceId = marketId || structureId;
            this._updateLocalInventoryCache(sourceId, [], collected);
        }

        if (itemType === 'firewood' || itemType?.endsWith?.('firewood')) {
            entity.state = TILEWORKER_STATE.RETURNING;
            entity.targetId = null;
        } else if (itemType === 'clay') {
            // Got input from market, return to structure
            entity.state = TILEWORKER_STATE.RETURNING;
            entity.targetId = null;
        } else if (itemType === 'tile') {
            // Got output from structure, deliver to market
            entity.state = TILEWORKER_STATE.DELIVERING;
            const market = this._findMarketNearPosition(entity.homePosition, this._getConfig('MARKET_MAX_DISTANCE'));
            entity.targetId = market?.id || null;
            entity.path = [];
        }
    }

    handleDepositResponse(data) {
        // Fire-and-forget: state already transitioned, no action needed
    }

    _handleRemovingExcessFirewood(entity) {
        if (!entity.requestSentAt) {
            entity.requestSentAt = Date.now();

            if (this.networkManager) {
                const structureData = this.gameState?.getStructureById(entity.buildingId);
                if (structureData) {
                    this.networkManager.sendMessage('npc_remove_excess_firewood', {
                        npcType: 'tileworker',
                        structureId: entity.buildingId,
                        chunkId: `chunk_${structureData.chunkKey}`,
                        keepCount: 1
                    });
                }
            }
        }

        if (Date.now() - entity.requestSentAt > 10000) {
            entity.requestSentAt = null;
            entity.state = TILEWORKER_STATE.ASSESSING_STRUCTURE;
        }
    }

    _handleClearingSlotForFirewood(entity) {
        if (!entity.requestSentAt) {
            entity.requestSentAt = Date.now();

            if (this.networkManager) {
                const structureData = this.gameState?.getStructureById(entity.buildingId);
                if (structureData) {
                    const firewoodItem = entity.carrying.find(item => item?.type?.endsWith('firewood'));
                    this.networkManager.sendMessage('npc_clear_left_slot_and_deposit', {
                        npcType: 'tileworker',
                        structureId: entity.buildingId,
                        chunkId: `chunk_${structureData.chunkKey}`,
                        itemToDeposit: firewoodItem
                    });
                }
            }
        }

        if (Date.now() - entity.requestSentAt > 10000) {
            entity.requestSentAt = null;
            entity.state = TILEWORKER_STATE.ASSESSING_STRUCTURE;
        }
    }

    handleRemoveFirewoodResponse(data) {
        if (!data) return;
        const { success, structureId, removedCount } = data;
        if (!structureId) return;

        const entity = this.entities.get(structureId);
        if (!entity || entity.state !== TILEWORKER_STATE.REMOVING_EXCESS_FIREWOOD) return;

        entity.requestSentAt = null;
        entity.state = TILEWORKER_STATE.ASSESSING_STRUCTURE;
    }

    handleClearDepositResponse(data) {
        if (!data) return;
        const { success, structureId, clearedCount } = data;
        if (!structureId) return;

        const entity = this.entities.get(structureId);
        if (!entity || entity.state !== TILEWORKER_STATE.CLEARING_SLOT_FOR_FIREWOOD) return;

        entity.requestSentAt = null;

        if (success) {
            const idx = entity.carrying.findIndex(item => item?.type?.endsWith('firewood'));
            if (idx !== -1) {
                entity.carrying.splice(idx, 1);
            }
        }

        entity.state = TILEWORKER_STATE.ASSESSING_STRUCTURE;
    }

    // =========================================================================
    // AUTHORITY OVERRIDE - TileWorker uses homePosition (matches baker behavior)
    // =========================================================================

    _calculateAuthority(buildingId) {
        return this._calculateAuthorityByHome(buildingId);
    }

    // =========================================================================
    // SYNC OVERRIDE - TileWorker returns ALL entities (matches baker behavior)
    // =========================================================================

    getActiveWorkersForSync() {
        return this.getAllWorkersForSync();
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    get tileworkers() {
        return this.entities;
    }

    checkTileWorkerSpawn(dockData) {
        return this.checkWorkerSpawn(dockData);
    }

    getTileWorkerDialogueData(tileworksId) {
        return this.getWorkerDialogueData(tileworksId);
    }

    onTileworksDestroyed(tileworksId) {
        return this.onBuildingDestroyed(tileworksId);
    }

    getActiveTileWorkersForSync() {
        return this.getActiveWorkersForSync();
    }

    syncTileWorkersFromPeer(workerList, peerId) {
        return this.syncWorkersFromPeer(workerList, peerId);
    }
}

// Singleton instance
export const tileWorkerController = new TileWorkerController();
export { TILEWORKER_STATE };

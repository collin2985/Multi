/**
 * FishermanController.js
 * Manages Fisherman NPCs that work at fisherman structures
 *
 * Fisherman behavior loop:
 * 1. Find water and fish (8 times, 10 seconds each)
 * 2. Deposit fish at fisherman structure
 * 3. Collect firewood from market
 * 4. Deposit firewood at fisherman structure
 * 5. Wait for structure to process fish into cookedfish
 * 6. Collect cookedfish from structure
 * 7. Deliver cookedfish to market
 * 8. Repeat
 *
 * Extends BaseWorkerController for shared P2P authority and movement logic.
 */

import { CONFIG } from '../config.js';
import { BaseWorkerController } from './BaseWorkerController.js';
import { TERRAIN_CONFIG } from '../terrainsystem.js';
import { QualityGenerator } from '../core/QualityGenerator.js';
import { ChunkCoordinates } from '../core/ChunkCoordinates.js';

// Fisherman-specific configuration (base configs inherited from BaseWorkerController)
const FISHERMAN_CONFIG_DEFAULTS = {
    NPC_COLOR: 0x4682B4,              // Steel blue
    WATER_SEARCH_RADIUS_SQ: 2500,     // 50^2
    FISH_PER_TRIP: 8,
    FISHING_DURATION: 10000,          // 10 seconds per fish
    WATER_APPROACH_DISTANCE: 0.5
};

// Fisherman states
const FISHERMAN_STATE = {
    IDLE: 'idle',
    SEEKING_WATER: 'seeking_water',
    FISHING: 'fishing',
    SEEKING_FIREWOOD: 'seeking_firewood',
    COLLECTING_FIREWOOD: 'collecting_firewood',
    RETURNING: 'returning',
    DEPOSITING: 'depositing',
    WAITING_FOR_OUTPUT: 'waiting_for_output',
    WAITING_FOR_FISH: 'waiting_for_fish',
    WAITING_FOR_FIREWOOD: 'waiting_for_firewood',
    COLLECTING_OUTPUT: 'collecting_output',
    DELIVERING: 'delivering',
    DEPOSITING_OUTPUT: 'depositing_output',
    STUCK: 'stuck',
    REMOVING_EXCESS_FIREWOOD: 'removing_excess_firewood',
    CLEARING_SLOT_FOR_FIREWOOD: 'clearing_slot_for_firewood',
    ASSESSING_STRUCTURE: 'assessing_structure'
};

class FishermanController extends BaseWorkerController {
    constructor() {
        super({
            workerType: 'fisherman',
            configKey: 'FISHERMAN',
            npcColor: FISHERMAN_CONFIG_DEFAULTS.NPC_COLOR,
            displayName: 'Fisherman',
            assessmentStateName: 'ASSESSING_STRUCTURE',
            movementStates: [
                FISHERMAN_STATE.SEEKING_WATER,
                FISHERMAN_STATE.SEEKING_FIREWOOD,
                FISHERMAN_STATE.RETURNING,
                FISHERMAN_STATE.DELIVERING
            ]
        });

        // Water cell cache - stores found water positions
        this._waterCellCache = new Map();
        this._lastCacheCleanup = 0;
    }

    // =========================================================================
    // OVERRIDE: Config helper
    // =========================================================================

    _getConfig(key) {
        return CONFIG.FISHERMAN?.[key] ?? FISHERMAN_CONFIG_DEFAULTS[key] ?? super._getConfig(key);
    }

    // =========================================================================
    // ABSTRACT METHOD IMPLEMENTATIONS
    // =========================================================================

    _getStateEnum() {
        return FISHERMAN_STATE;
    }

    _getStructuresInChunk(chunkKey) {
        return this.gameState?.getFishermanInChunk(chunkKey) || [];
    }

    _createWorkerSpecificState(buildingData) {
        return {
            fishermanId: buildingData.id,
            previousTask: null,
            _failedTargets: new Map(),
            _cachedWalkable: true,
            _cachedWalkablePos: { x: 0, z: 0 },
            // Fishing-specific state
            fishingStartTime: null,
            waterTarget: null,
            fishingAnimationPlaying: false,
            activeSound: null
        };
    }

    // =========================================================================
    // UPDATE LOOP OVERRIDE
    // =========================================================================

    update(deltaTime) {
        const now = Date.now();
        if (!this._lastCacheCleanup || now - this._lastCacheCleanup > 60000) {
            this._lastCacheCleanup = now;
            this._waterCellCache.clear();
        }

        super.update(deltaTime);
    }

    // =========================================================================
    // STATE HANDLERS
    // =========================================================================

    _handleIdleState(entity) {
        const homeDx = entity.position.x - entity.homePosition.x;
        const homeDz = entity.position.z - entity.homePosition.z;
        const homeDistSq = homeDx * homeDx + homeDz * homeDz;

        if (homeDistSq <= 9) {
            entity.state = FISHERMAN_STATE.ASSESSING_STRUCTURE;
        } else {
            entity.state = FISHERMAN_STATE.RETURNING;
            entity.path = [];
        }
    }

    _assessStructureAndDecide(entity) {
        const structureData = this.gameState?.getStructureById(entity.buildingId);
        if (!structureData) {
            return { action: 'stuck', reason: 'Lost connection to fisherman structure.' };
        }

        const structureInv = structureData.object?.userData?.inventory;
        const market = this._findMarketNearPosition(entity.homePosition, this._getConfig('MARKET_MAX_DISTANCE'));

        // PRIORITY 1: Cooked fish present? -> Take and deliver
        const cookedFishCount = this._countItemsOfType(structureInv, 'cookedfish');
        if (cookedFishCount > 0) {
            if (!market) return { action: 'stuck', reason: 'No market nearby for delivery.' };
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
            const carryingFirewood = entity.carrying.some(item => item?.type?.endsWith('firewood'));
            if (carryingFirewood) {
                return { action: 'clear_slot_and_deposit_firewood' };
            } else {
                if (!market) return { action: 'stuck', reason: 'No market nearby for firewood.' };
                const marketData = this.gameState?.getStructureById(market.id);
                const marketInv = marketData?.object?.userData?.inventory;
                if (!this._marketHasFirewood(marketInv)) {
                    return { action: 'wait_for_firewood' };
                }
                return { action: 'get_firewood', target: market.id };
            }
        }

        // PRIORITY 4: Fish present? -> Wait for processing (62 ticks)
        const fishCount = this._countItemsOfType(structureInv, 'fish');
        if (fishCount > 0) {
            return { action: 'wait_for_output' };
        }

        // PRIORITY 5: No fish -> Handle fish situation
        const carryingFish = entity.carrying.some(item => item?.type === 'fish');
        if (carryingFish) {
            return { action: 'deposit_fish' };
        } else {
            // Need to go fishing - pick a wander direction to find water
            return { action: 'go_fishing' };
        }
    }

    _handleAssessingStructure(entity) {
        const decision = this._assessStructureAndDecide(entity);

        switch (decision.action) {
            case 'collect_output':
                entity.state = FISHERMAN_STATE.COLLECTING_OUTPUT;
                entity.targetId = decision.target;
                break;

            case 'remove_excess_firewood':
                entity.state = FISHERMAN_STATE.REMOVING_EXCESS_FIREWOOD;
                entity._excessFirewoodCount = decision.excessCount;
                entity.requestSentAt = null;
                break;

            case 'clear_slot_and_deposit_firewood':
                entity.state = FISHERMAN_STATE.CLEARING_SLOT_FOR_FIREWOOD;
                entity.requestSentAt = null;
                break;

            case 'get_firewood':
                entity.state = FISHERMAN_STATE.SEEKING_FIREWOOD;
                entity.targetId = decision.target;
                entity.path = [];
                break;

            case 'wait_for_firewood':
                entity.state = FISHERMAN_STATE.WAITING_FOR_FIREWOOD;
                break;

            case 'wait_for_output':
                entity.state = FISHERMAN_STATE.WAITING_FOR_OUTPUT;
                break;

            case 'deposit_fish':
                entity.state = FISHERMAN_STATE.DEPOSITING;
                entity.requestSentAt = null;
                break;

            case 'go_fishing':
                entity.state = FISHERMAN_STATE.SEEKING_WATER;
                this._pickNewWanderTarget(entity);
                break;

            case 'stuck':
                this._enterStuckState(entity, decision.reason);
                break;
        }
    }

    _handleWorkerSpecificState(entity, deltaTime) {
        switch (entity.state) {
            case FISHERMAN_STATE.FISHING:
                this._handleFishing(entity, deltaTime);
                break;
            case FISHERMAN_STATE.COLLECTING_FIREWOOD:
                this._handleCollectingFirewood(entity);
                break;
            case FISHERMAN_STATE.DEPOSITING:
                this._handleDepositing(entity);
                break;
            case FISHERMAN_STATE.WAITING_FOR_OUTPUT:
                this._handleWaitingForOutput(entity);
                break;
            case FISHERMAN_STATE.WAITING_FOR_FISH:
                this._handleWaitingForFish(entity);
                break;
            case FISHERMAN_STATE.WAITING_FOR_FIREWOOD:
                this._handleWaitingForFirewood(entity);
                break;
            case FISHERMAN_STATE.COLLECTING_OUTPUT:
                this._handleCollectingOutput(entity);
                break;
            case FISHERMAN_STATE.DEPOSITING_OUTPUT:
                this._handleMarketDeposit(entity);
                break;
            case FISHERMAN_STATE.ASSESSING_STRUCTURE:
                this._handleAssessingStructure(entity);
                break;
            case FISHERMAN_STATE.REMOVING_EXCESS_FIREWOOD:
                this._handleRemovingExcessFirewood(entity);
                break;
            case FISHERMAN_STATE.CLEARING_SLOT_FOR_FIREWOOD:
                this._handleClearingSlotForFirewood(entity);
                break;
        }
    }

    _getMovementTarget(entity) {
        switch (entity.state) {
            case FISHERMAN_STATE.SEEKING_WATER:
                if (!entity.wanderTarget) return null;
                return entity.wanderTarget;

            case FISHERMAN_STATE.SEEKING_FIREWOOD:
            case FISHERMAN_STATE.DELIVERING:
                const market = this.gameState?.getStructureById(entity.targetId);
                if (!market) return null;
                return this._calculateApproachPosition(market, entity.position, 3.0);

            case FISHERMAN_STATE.RETURNING:
                const structure = this.gameState?.getStructureById(entity.buildingId);
                if (!structure) {
                    return { x: entity.homePosition.x, z: entity.homePosition.z };
                }
                return this._calculateApproachPosition(structure, entity.position, 0.75);

            default:
                return null;
        }
    }

    /**
     * Override movement to check for water during SEEKING_WATER state
     */
    _handleMovementState(entity, deltaTime) {
        // Check if we've entered water while seeking it
        if (entity.state === FISHERMAN_STATE.SEEKING_WATER) {
            const currentY = entity.position.y;
            if (currentY < 0) {
                // Found water - stop and start fishing
                this._setMoving(entity, false);
                entity.path = [];
                entity.pathIndex = 0;
                entity.state = FISHERMAN_STATE.FISHING;
                entity.fishingStartTime = Date.now();
                entity.fishingAnimationPlaying = false;
                return;
            }
        }

        // Continue with normal movement handling
        super._handleMovementState(entity, deltaTime);
    }

    _onArrival(entity) {
        this._setMoving(entity, false);
        entity.path = [];
        entity.pathIndex = 0;

        switch (entity.state) {
            case FISHERMAN_STATE.SEEKING_WATER:
                // Arrived at wander target but didn't find water - pick new direction
                this._pickNewWanderTarget(entity);
                break;
            case FISHERMAN_STATE.SEEKING_FIREWOOD:
                entity.state = FISHERMAN_STATE.COLLECTING_FIREWOOD;
                entity.requestSentAt = null;
                break;
            case FISHERMAN_STATE.RETURNING:
                entity.state = FISHERMAN_STATE.ASSESSING_STRUCTURE;
                entity.requestSentAt = null;
                break;
            case FISHERMAN_STATE.DELIVERING:
                entity.state = FISHERMAN_STATE.DEPOSITING_OUTPUT;
                entity.requestSentAt = null;
                break;
        }
    }

    // =========================================================================
    // FISHING STATE - Client-side fish creation
    // =========================================================================

    _handleFishing(entity, deltaTime) {
        const now = Date.now();
        const fishingDuration = this._getConfig('FISHING_DURATION');

        // Start animation and sound if not already playing
        if (!entity.fishingAnimationPlaying) {
            entity.fishingAnimationPlaying = true;
            this._startFishingAnimation(entity);
            this._playFishingSound(entity);
        }

        // Check if fishing duration has elapsed
        if (now - entity.fishingStartTime >= fishingDuration) {
            // Stop animation
            this._stopFishingAnimation(entity);
            entity.fishingAnimationPlaying = false;

            // Create fish client-side (guaranteed catch)
            const fish = this._createFish(entity.position);
            entity.carrying.push(fish);

            // Check if we have enough fish
            const fishPerTrip = this._getConfig('FISH_PER_TRIP');
            if (entity.carrying.length >= fishPerTrip) {
                // Done fishing, return to structure
                entity.state = FISHERMAN_STATE.RETURNING;
                entity.waterTarget = null;
                entity.path = [];
            } else {
                // Need more fish - stay in place and continue fishing
                entity.fishingStartTime = Date.now();
                entity.fishingAnimationPlaying = false;
                // Stay in FISHING state, will restart animation/sound on next update
            }
        }
    }

    _createFish(position) {
        // Get chunk-based quality (same as player fishing)
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(position.x, position.z);
        const worldSeed = TERRAIN_CONFIG.TERRAIN?.seed || TERRAIN_CONFIG.SEED || 12345;

        const fishQuality = QualityGenerator.getQuality(worldSeed, chunkX, chunkZ, 'fish');
        const fishDurability = Math.max(10, Math.floor(60 * (fishQuality / 100)));

        return {
            id: `fish_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'fish',
            x: -1,
            y: -1,
            width: 1,
            height: 1,
            rotation: 0,
            quality: fishQuality,
            durability: fishDurability
        };
    }

    _startFishingAnimation(entity) {
        if (!entity.visual?.mesh) return;

        // Use chopping animation for fishing (similar motion)
        const mixer = entity.visual.animationMixer;
        if (mixer && entity.visual.choppingAction) {
            entity.visual.choppingAction.reset();
            entity.visual.choppingAction.timeScale = 0.3; // Slow to match 10 second duration
            entity.visual.choppingAction.play();
        }

        // Face toward water
        if (entity.waterTarget) {
            const dx = entity.waterTarget.x - entity.position.x;
            const dz = entity.waterTarget.z - entity.position.z;
            entity.rotation = Math.atan2(dx, dz);
            if (entity.visual.mesh) {
                entity.visual.mesh.rotation.y = entity.rotation;
            }
        }
    }

    _stopFishingAnimation(entity) {
        if (!entity.visual?.mesh) return;

        if (entity.visual.choppingAction) {
            entity.visual.choppingAction.stop();
        }
        if (entity.visual.walkAction) {
            entity.visual.walkAction.reset();
            entity.visual.walkAction.play();
            entity.visual.walkAction.paused = true;
        }
    }

    _playFishingSound(entity) {
        // Play fishing sound using audioManager
        const audioManager = this.game?.audioManager;
        if (audioManager && entity.visual?.mesh) {
            entity.activeSound = audioManager.playFishingSound();
        }
    }

    // =========================================================================
    // COLLECTION STATES
    // =========================================================================

    _handleCollectingFirewood(entity) {
        if (!entity.requestSentAt) {
            entity.requestSentAt = Date.now();

            if (this.networkManager) {
                const marketData = this.gameState?.getStructureById(entity.targetId);
                if (marketData) {
                    this.networkManager.sendMessage('npc_collect_from_market', {
                        npcType: 'fisherman',
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
            entity.state = FISHERMAN_STATE.RETURNING;
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
                        npcType: 'fisherman',
                        structureId: entity.buildingId,
                        chunkId: `chunk_${structureData.chunkKey}`,
                        itemType: 'cookedfish',
                        count: 10
                    });
                }
            }
        }

        if (Date.now() - entity.requestSentAt > 10000) {
            entity.requestSentAt = null;
            entity.state = FISHERMAN_STATE.ASSESSING_STRUCTURE;
        }
    }

    // =========================================================================
    // DEPOSITING STATES
    // =========================================================================

    _handleDepositing(entity) {
        const structureData = this.gameState?.getStructureById(entity.buildingId);

        // FIX: Transition out if can't deposit (prevents infinite loop)
        if (!structureData || !entity.carrying || entity.carrying.length === 0) {
            entity.state = FISHERMAN_STATE.ASSESSING_STRUCTURE;
            entity.requestSentAt = null;
            return;
        }

        if (entity.requestSentAt) {
            if (Date.now() - entity.requestSentAt > 10000) {
                entity.requestSentAt = null;
                entity.carrying.length = 0;
                entity.state = FISHERMAN_STATE.ASSESSING_STRUCTURE;
            }
            return;
        }

        if (this.networkManager) {
            this.networkManager.sendMessage('npc_deposit_inventory', {
                npcType: 'fisherman',
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

    _handleWaitingForOutput(entity) {
        const currentTick = this.gameState?.serverTick || 0;

        if (!entity._waitStartTick) {
            entity._waitStartTick = currentTick;

            // Request server to check/complete any processing
            if (this.networkManager) {
                const structureData = this.gameState?.getStructureById(entity.buildingId);
                if (structureData) {
                    this.networkManager.sendMessage('npc_check_structure_processing', {
                        structureId: entity.buildingId,
                        structureType: 'fisherman',
                        chunkId: `chunk_${structureData.chunkKey}`
                    });
                }
            }
        }

        // Wait 62 ticks before checking again
        const ticksWaited = currentTick - entity._waitStartTick;
        if (ticksWaited < 62) {
            return;
        }

        // Done waiting - check for cooked fish
        const structureData = this.gameState?.getStructureById(entity.buildingId);
        const structureInv = structureData?.object?.userData?.inventory;
        const cookedFishCount = this._countItemsOfType(structureInv, 'cookedfish');

        if (cookedFishCount > 0) {
            entity._waitStartTick = null;
            entity.state = FISHERMAN_STATE.ASSESSING_STRUCTURE;
        } else {
            // Check if fish still present
            const fishCount = this._countItemsOfType(structureInv, 'fish');
            if (fishCount > 0) {
                entity._waitStartTick = currentTick;

                if (this.networkManager && structureData) {
                    this.networkManager.sendMessage('npc_check_structure_processing', {
                        structureId: entity.buildingId,
                        structureType: 'fisherman',
                        chunkId: `chunk_${structureData.chunkKey}`
                    });
                }
            } else {
                entity._waitStartTick = null;
                entity.state = FISHERMAN_STATE.ASSESSING_STRUCTURE;
            }
        }
    }

    _handleWaitingForFish(entity) {
        // Water is always available - just reassess
        const now = Date.now();
        if (now - entity._lastDecisionTime < 30000) return;
        entity._lastDecisionTime = now;

        // Water is infinite, so just go back to assessment
        entity.state = FISHERMAN_STATE.ASSESSING_STRUCTURE;
    }

    _handleWaitingForFirewood(entity) {
        const now = Date.now();
        if (now - entity._lastDecisionTime < 30000) return;
        entity._lastDecisionTime = now;

        const market = this._findMarketNearPosition(entity.homePosition, this._getConfig('MARKET_MAX_DISTANCE'));
        if (market) {
            const marketData = this.gameState?.getStructureById(market.id);
            const marketInv = marketData?.object?.userData?.inventory;
            if (this._marketHasFirewood(marketInv)) {
                entity.state = FISHERMAN_STATE.ASSESSING_STRUCTURE;
            }
        }
    }

    // =========================================================================
    // SERVER RESPONSE HANDLERS
    // =========================================================================

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
            const sourceId = structureId || marketId || bakeryId;
            this._updateLocalInventoryCache(sourceId, [], collected);
        }

        if (itemType === 'firewood' || itemType?.endsWith?.('firewood')) {
            entity.state = FISHERMAN_STATE.RETURNING;
            entity.targetId = null;
        } else if (itemType === 'cookedfish') {
            entity.state = FISHERMAN_STATE.DELIVERING;
            const market = this._findMarketNearPosition(entity.homePosition, this._getConfig('MARKET_MAX_DISTANCE'));
            entity.targetId = market?.id || null;
            entity.path = [];
        }
    }

    handleDepositResponse(data) {
        // Fire-and-forget: state already transitioned, no action needed
    }

    // =========================================================================
    // WANDER TARGET - Pick random direction to find water
    // =========================================================================

    _pickNewWanderTarget(entity) {
        // Pick a random angle around the structure
        const angle = Math.random() * Math.PI * 2;

        // Wander distance: 8-15 units from structure (ring around it)
        const minDist = 8;
        const maxDist = 15;
        const dist = minDist + Math.random() * (maxDist - minDist);

        entity.wanderTarget = {
            x: entity.homePosition.x + Math.cos(angle) * dist,
            z: entity.homePosition.z + Math.sin(angle) * dist
        };
        entity.path = [];
        entity.pathIndex = 0;
    }

    // =========================================================================
    // CLEANUP
    // =========================================================================

    dispose() {
        super.dispose();
        this._waterCellCache.clear();
    }

    // =========================================================================
    // AUTHORITY OVERRIDE
    // =========================================================================

    _calculateAuthority(buildingId) {
        return this._calculateAuthorityByHome(buildingId);
    }

    // =========================================================================
    // SYNC OVERRIDE
    // =========================================================================

    getActiveWorkersForSync() {
        return this.getAllWorkersForSync();
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    get fishermen() {
        return this.entities;
    }

    checkFishermanSpawn(dockData) {
        return this.checkWorkerSpawn(dockData);
    }

    getFishermanDialogueData(fishermanId) {
        return this.getWorkerDialogueData(fishermanId);
    }

    onFishermanDestroyed(fishermanId) {
        return this.onBuildingDestroyed(fishermanId);
    }

    getActiveFishermenForSync() {
        return this.getActiveWorkersForSync();
    }

    syncFishermenFromPeer(fishermanList, peerId) {
        return this.syncWorkersFromPeer(fishermanList, peerId);
    }
}

// Singleton instance
export const fishermanController = new FishermanController();
export { FISHERMAN_STATE };

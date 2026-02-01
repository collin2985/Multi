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
    FISH_PER_TRIP: 8,
    FISHING_DURATION: 10000,          // 10 seconds per fish
    PERIMETER_DISTANCE: 2.0           // Distance from building center for perimeter walking
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
    // SPAWN OVERRIDE - Ensure fisherman spawns on land (Y > 0)
    // =========================================================================

    _spawnWorker(buildingData) {
        const buildingId = buildingData.id;
        const buildingPos = buildingData.position;

        const spawnRadius = 1.5;
        const startAngle = Math.random() * Math.PI * 2;
        let spawnX = buildingPos.x;
        let spawnZ = buildingPos.z;
        let spawnY = 0;

        // Find a spawn position on land (Y > 0)
        for (let attempt = 0; attempt < 8; attempt++) {
            const angle = startAngle + (attempt * Math.PI / 4);
            const testX = buildingPos.x + Math.cos(angle) * spawnRadius;
            const testZ = buildingPos.z + Math.sin(angle) * spawnRadius;
            const testY = this.getTerrainHeight?.(testX, testZ) ?? 0;

            // Must be walkable AND on land
            if ((!this.isWalkable || this.isWalkable(testX, testZ)) && testY > 0) {
                spawnX = testX;
                spawnZ = testZ;
                spawnY = testY;
                break;
            }
        }

        // Fallback: use terrain height even if no valid land found
        if (spawnY === 0) {
            spawnY = this.getTerrainHeight?.(spawnX, spawnZ) ?? buildingPos.y ?? 0;
        }

        const entity = this._createBaseEntityState(buildingId, buildingPos, spawnX, spawnY, spawnZ);
        Object.assign(entity, this._createWorkerSpecificState(buildingData));

        // Store owner faction for shirt color and nametag
        entity.ownerFactionId = buildingData.object?.userData?.ownerFactionId ?? null;

        if (!this._createWorkerVisual(entity)) {
            console.warn(`[${this.constructor.name}] Failed to create visual for ${buildingId}`);
            return;
        }

        this.entities.set(buildingId, entity);

        if (this.pendingStates.has(buildingId)) {
            const pendingState = this.pendingStates.get(buildingId);
            this.pendingStates.delete(buildingId);
            this._applyStateMessage(entity, pendingState);
        }

        if (this.broadcastP2P) {
            this.broadcastP2P({
                type: `${this.workerType}_spawn`,
                buildingId: buildingId,
                position: entity.position,
                rotation: entity.rotation,
                homePosition: entity.homePosition,
                spawnedBy: this.clientId,
                spawnTime: entity.spawnTime,
                ownerFactionId: entity.ownerFactionId,
                ...this._getSpawnBroadcastExtra(entity)
            });
        }
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

        // PRIORITY 0: Already carrying output (cookedfish)? -> Deliver it first
        // This handles recovery from stuck/interrupted delivery attempts
        const carryingOutput = entity.carrying.some(item => item?.type === 'cookedfish');
        if (carryingOutput) {
            if (!market) return { action: 'wait' };
            return { action: 'deliver_output', target: market.id };
        }

        // PRIORITY 1: Cooked fish present? -> Take and deliver
        const cookedFishCount = this._countItemsOfType(structureInv, 'cookedfish');
        if (cookedFishCount > 0) {
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
            const carryingFirewood = entity.carrying.some(item => item?.type?.endsWith('firewood'));
            if (carryingFirewood) {
                return { action: 'clear_slot_and_deposit_firewood' };
            } else {
                if (!market) return { action: 'wait' };
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
        const now = Date.now();
        if (now - (entity._lastAssessmentTime || 0) < 2000) return;
        entity._lastAssessmentTime = now;
        const decision = this._assessStructureAndDecide(entity);

        switch (decision.action) {
            case 'deliver_output':
                // Resume interrupted delivery - already carrying cooked fish
                entity.state = FISHERMAN_STATE.DELIVERING;
                entity.targetId = decision.target;
                entity.path = [];
                break;

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
                entity._lastDecisionTime = 0;
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

            case 'wait':
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
                return this._calculateApproachPosition(market, entity.position, 4.0);

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
     * Override movement for SEEKING_WATER: walk directly toward water target
     * bypassing pathfinding (which avoids water cells) and the base class
     * water detection (which blocks entry at WATER_THRESHOLD=0.3).
     */
    _handleMovementState(entity, deltaTime) {
        if (entity.state === FISHERMAN_STATE.SEEKING_WATER) {
            // Already in water? Start fishing
            if (entity.position.y < 0.3) {
                this._setMoving(entity, false);
                entity.path = [];
                entity.pathIndex = 0;
                entity.state = FISHERMAN_STATE.FISHING;
                entity.fishingStartTime = Date.now();
                entity.fishingAnimationPlaying = false;
                return;
            }

            if (!entity.wanderTarget) {
                this._pickNewWanderTarget(entity);
                return;
            }

            // Direct movement toward water target (no pathfinding)
            const dx = entity.wanderTarget.x - entity.position.x;
            const dz = entity.wanderTarget.z - entity.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist < 0.3) {
                // Arrived but no water - pick new target
                this._setMoving(entity, false);
                this._pickNewWanderTarget(entity);
                return;
            }

            const moveSpeed = this._cachedConfig?.MOVE_SPEED ?? this._getConfig('MOVE_SPEED');
            const moveAmount = moveSpeed * (deltaTime / 1000);
            const moveRatio = Math.min(moveAmount / dist, 1.0);

            entity.position.x += dx * moveRatio;
            entity.position.z += dz * moveRatio;
            entity.rotation = Math.atan2(dx, dz);

            if (this.getTerrainHeight) {
                entity.position.y = this.getTerrainHeight(entity.position.x, entity.position.z);
            }

            this._setMoving(entity, true);
            if (entity.mesh) {
                entity.mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
                entity.mesh.rotation.y = entity.rotation;
            }
            return;
        }

        // Non-seeking states use normal pathfinding
        super._handleMovementState(entity, deltaTime);
    }

    _handleWaterDetected(entity, waterX, waterZ) {
        if (entity.state === FISHERMAN_STATE.SEEKING_WATER) {
            return;
        }
        super._handleWaterDetected(entity, waterX, waterZ);
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

        // Check for cooked fish
        const cookedFishCount = this._countItemsOfType(structureInv, 'cookedfish');

        if (cookedFishCount > 0) {
            // Output ready! Go back to assessment
            entity._waitStartTick = null;
            entity.state = FISHERMAN_STATE.ASSESSING_STRUCTURE;
            return;
        }

        // No output yet - check if fish still processing
        const fishCount = this._countItemsOfType(structureInv, 'fish');
        if (fishCount > 0) {
            // Still have fish processing, continue waiting
            return;
        }

        // No fish, no cooked fish - reassess
        entity._waitStartTick = null;
        entity.state = FISHERMAN_STATE.ASSESSING_STRUCTURE;
    }

    _handleWaitingForFish(entity) {
        // Water is always available - just reassess
        const now = Date.now();
        if (now - entity._lastDecisionTime < 30000) return;
        entity._lastDecisionTime = now;
        if (this._isBuildingDestroyed(entity)) return;

        // Water is infinite, so just go back to assessment
        entity.state = FISHERMAN_STATE.ASSESSING_STRUCTURE;
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
    // WANDER TARGET - Walk building perimeter to find water
    // =========================================================================

    _pickNewWanderTarget(entity) {
        const home = entity.homePosition;
        const getTerrainHeight = this.getTerrainHeight;

        if (getTerrainHeight) {
            // Scan outward from home to find water
            for (let dist = 2; dist <= 20; dist += 2) {
                for (let i = 0; i < 8; i++) {
                    const angle = Math.random() * Math.PI * 2 + (i / 8) * Math.PI * 2;
                    const testX = home.x + Math.cos(angle) * dist;
                    const testZ = home.z + Math.sin(angle) * dist;
                    const testY = getTerrainHeight(testX, testZ);
                    if (testY < 0) {
                        entity.wanderTarget = { x: testX, z: testZ };
                        entity.path = [];
                        entity.pathIndex = 0;
                        return;
                    }
                }
            }
        }

        // Fallback: random direction if no water found
        const angle = Math.random() * Math.PI * 2;
        entity.wanderTarget = {
            x: home.x + Math.cos(angle) * 8,
            z: home.z + Math.sin(angle) * 8
        };
        entity.path = [];
        entity.pathIndex = 0;
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

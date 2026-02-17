/**
 * StoneMasonController.js
 * Manages Stone Mason NPCs that work at stonemason buildings
 *
 * Stone Mason behavior loop:
 * 1. Go to market and withdraw 5 limestone or sandstone
 * 2. Return to stonemason building
 * 3. Chisel each stone (6 seconds each) into chiseled form
 * 4. Deliver chiseled stones to market
 * 5. Repeat
 *
 * Extends BaseWorkerController for shared P2P authority and movement logic.
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { ChunkCoordinates } from '../core/ChunkCoordinates.js';
import { BaseWorkerController } from './BaseWorkerController.js';

// StoneMason-specific configuration
const STONEMASON_CONFIG_DEFAULTS = {
    NPC_COLOR: 0x8B7355,              // Tan/stone color
    MARKET_SEARCH_RADIUS_SQ: 2500,    // 50^2
    INTERACTION_RANGE: 5,             // Distance to interact
    STONE_COUNT: 5,                   // Process 5 stones per trip
    STONE_TYPES: ['limestone', 'sandstone']  // Raw stone types to collect
};

// StoneMason states
const STONEMASON_STATE = {
    IDLE: 'idle',
    GOING_TO_MARKET: 'going_to_market',      // Moving to market to get raw stone
    COLLECTING: 'collecting',                 // Waiting for server response for stone withdrawal
    RETURNING: 'returning',                   // Moving back to stonemason building
    CHISELING: 'chiseling',                   // Processing stone into chiseled form
    DELIVERING: 'delivering',                 // Moving to market with chiseled stones
    DEPOSITING: 'depositing',                 // Waiting for deposit response
    STUCK: 'stuck'                            // Cannot find market or resources
};

class StoneMasonController extends BaseWorkerController {
    constructor() {
        super({
            workerType: 'stonemason',
            configKey: 'STONEMASON',
            npcColor: STONEMASON_CONFIG_DEFAULTS.NPC_COLOR,
            displayName: 'Stonemason',
            movementStates: [
                STONEMASON_STATE.GOING_TO_MARKET,
                STONEMASON_STATE.RETURNING,
                STONEMASON_STATE.DELIVERING
            ]
        });
    }

    // =========================================================================
    // OVERRIDE: Config helper
    // =========================================================================

    _getConfig(key) {
        return CONFIG.STONEMASON?.[key] ?? STONEMASON_CONFIG_DEFAULTS[key] ?? super._getConfig(key);
    }

    // =========================================================================
    // ABSTRACT METHOD IMPLEMENTATIONS
    // =========================================================================

    _getStateEnum() {
        return STONEMASON_STATE;
    }

    _getStructuresInChunk(chunkKey) {
        return this.gameState?.getStonemasonInChunk?.(chunkKey) ||
               this.gameState?.getStonemasonsInChunk?.(chunkKey) || [];
    }

    _createWorkerSpecificState(buildingData) {
        return {
            targetId: null,           // Market we're working with
            rawStone: [],                   // Array of raw stones collected
            chiseledStone: [],              // Array of chiseled stones ready to deposit
            currentChiselIndex: 0,          // Which stone we're currently chiseling

            // Mirrors CraftingSystem.gameState.activeAction pattern
            activeChiselAction: null,       // { startTime, duration, stone } - current chiseling action

            // Request tracking
            requestSentAt: null             // Timestamp for timeout handling
        };
    }

    _createBroadcastMessage() {
        const msg = super._createBroadcastMessage();
        msg.chiseling = false;
        msg.rawStoneCount = 0;
        msg.chiseledStoneCount = 0;
        return msg;
    }

    _addBroadcastExtraFields(entity, msg) {
        msg.chiseling = entity.isChiseling || false;
        msg.rawStoneCount = entity.rawStone?.length || 0;
        msg.chiseledStoneCount = entity.chiseledStone?.length || 0;
    }

    _applyExtraStateFields(entity, message) {
        if (message.chiseling !== undefined && message.chiseling !== entity.isChiseling) {
            this._setChiseling(entity, message.chiseling);
        }
    }

    _getSyncExtraFields(entity) {
        return {
            rawStoneCount: entity.rawStone?.length || 0,
            chiseledStoneCount: entity.chiseledStone?.length || 0
        };
    }

    // =========================================================================
    // OVERRIDE HOOKS FOR BASE CLASS DEPOSIT HANDLING
    // =========================================================================

    _getCarriedItems(entity) {
        return entity.chiseledStone || [];
    }

    _clearCarriedItems(entity) {
        entity.chiseledStone = [];
    }

    // =========================================================================
    // ANIMATION SETUP (chiseling)
    // =========================================================================

    _setupExtraAnimations(entity, mixer, animations) {
        // Look for chisel/work animation, fall back to pickaxe or walk
        const chiselAnim = animations.find(a => {
            const name = a.name.toLowerCase();
            return name.includes('chisel') || name.includes('pickaxe') ||
                   name.includes('work') || name.includes('action');
        });

        if (chiselAnim) {
            entity.visual.chiselAction = mixer.clipAction(chiselAnim);
            entity.visual.chiselAction.loop = THREE.LoopRepeat;
        } else if (entity.visual.walkAction) {
            entity.visual.chiselAction = mixer.clipAction(entity.visual.walkAction.getClip());
            entity.visual.chiselAction.loop = THREE.LoopRepeat;
        }

        entity.isChiseling = false;
    }

    _onMovingChanged(entity, isMoving) {
        // Stop chiseling when starting to move
        if (isMoving && entity.isChiseling) {
            this._setChiseling(entity, false);
        }
    }

    /**
     * Control chiseling animation state
     * Models after CraftingSystem.startChiselingAction() (lines 64-78)
     */
    _setChiseling(entity, isChiseling) {
        if (!entity.visual) return;

        const wasChiseling = entity.isChiseling;
        if (wasChiseling === isChiseling) return;

        entity.isChiseling = isChiseling;

        if (isChiseling) {
            // Stop other animations (mirrors CraftingSystem lines 71-78)
            entity.visual.idleAction?.stop();
            entity.visual.walkAction?.stop();

            // Start chisel animation
            if (entity.visual.chiselAction) {
                entity.visual.chiselAction.reset().play();
            }

            // Play chisel sound - mirrors CraftingSystem lines 64-68
            const audioManager = this.game?.audioManager;
            if (audioManager && entity.mesh) {
                if (entity.activeSound?.isPlaying) {
                    entity.activeSound.stop();
                    entity.mesh.remove(entity.activeSound);
                    try { entity.activeSound.disconnect(); } catch (e) { /* already disconnected */ }
                }
                entity.activeSound = audioManager.playPositionalSound('chisel', entity.mesh);
            }
        } else {
            // Stop chisel animation
            entity.visual.chiselAction?.stop();

            // Return to idle
            if (entity.visual.isMoving) {
                entity.visual.walkAction?.reset().play();
            } else {
                entity.visual.idleAction?.reset().play();
            }

            // Stop sound
            if (entity.activeSound?.isPlaying) {
                entity.activeSound.stop();
            }
            if (entity.activeSound) {
                entity.mesh?.remove(entity.activeSound);
                try { entity.activeSound.disconnect(); } catch (e) { /* already disconnected */ }
            }
            entity.activeSound = null;
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

        const decision = this._decideNextTask(entity);

        switch (decision.task) {
            case 'deliver':
                entity.targetId = decision.market?.id || null;
                entity.state = STONEMASON_STATE.DELIVERING;
                entity.path = [];
                // Note: Don't call _setMoving(true) here - let _handleMovementState
                // start the animation only when a path is available to avoid walking in place
                break;

            case 'return_to_chisel':
                entity.state = STONEMASON_STATE.RETURNING;
                entity.path = [];
                // Note: Don't call _setMoving(true) here - let _handleMovementState
                // start the animation only when a path is available to avoid walking in place
                break;

            case 'collect':
                entity.targetId = decision.market?.id || null;
                entity.state = STONEMASON_STATE.GOING_TO_MARKET;
                entity.path = [];
                // Note: Don't call _setMoving(true) here - let _handleMovementState
                // start the animation only when a path is available to avoid walking in place
                break;

            case 'stuck':
            default:
                this._enterStuckState(entity, decision.reason || 'no_market');
                break;
        }
    }

    _decideNextTask(entity) {
        // Use inherited _findMarketNearPosition from BaseWorkerController
        const maxDist = Math.sqrt(this._getConfig('MARKET_SEARCH_RADIUS_SQ'));

        // Priority 1: If carrying chiseled stones, deliver to market
        if (entity.chiseledStone && entity.chiseledStone.length > 0) {
            const market = this._findMarketNearPosition(entity.homePosition, maxDist);
            if (!market) return { task: 'wait' };
            return { task: 'deliver', market: market };
        }

        // Priority 2: If carrying raw stones, return to building to chisel
        if (entity.rawStone && entity.rawStone.length > 0) {
            return { task: 'return_to_chisel' };
        }

        // Priority 3: Go to market to collect raw stone (only if stone is available)
        const market = this._findMarketNearPosition(entity.homePosition, maxDist);
        if (market) {
            const stoneType = this._selectAvailableStoneType(market.id);
            if (stoneType) {
                return { task: 'collect', market: market };
            }
        }

        // Priority 4: No market found or no stone available, wait
        return { task: 'wait' };
    }

    _handleWorkerSpecificState(entity, deltaTime) {
        switch (entity.state) {
            case STONEMASON_STATE.COLLECTING:
                this._handleCollecting(entity);
                break;
            case STONEMASON_STATE.CHISELING:
                this._handleChiseling(entity, deltaTime);
                break;
            case STONEMASON_STATE.DEPOSITING:
                this._handleMarketDeposit(entity);
                break;
        }
    }

    _getMovementTarget(entity) {
        if (entity.state === STONEMASON_STATE.GOING_TO_MARKET ||
            entity.state === STONEMASON_STATE.DELIVERING) {
            const market = this._findMarketById(entity.targetId);
            if (!market) {
                entity.state = STONEMASON_STATE.IDLE;
                this._setMoving(entity, false);
                return null;
            }
            return this._calculateApproachPosition(market, entity.position, 4.0);
        }

        if (entity.state === STONEMASON_STATE.RETURNING) {
            const building = this.gameState?.getStructureById(entity.buildingId);
            if (building) {
                return this._calculateApproachPosition(building, entity.position, 2.0);
            }
            return { x: entity.homePosition.x, z: entity.homePosition.z };
        }

        return null;
    }

    _onArrival(entity) {
        this._setMoving(entity, false);
        entity.path = [];

        switch (entity.state) {
            case STONEMASON_STATE.GOING_TO_MARKET:
                entity.state = STONEMASON_STATE.COLLECTING;
                entity.requestSentAt = null;
                break;
            case STONEMASON_STATE.RETURNING:
                entity.state = STONEMASON_STATE.CHISELING;
                entity.requestSentAt = null;
                break;
            case STONEMASON_STATE.DELIVERING:
                entity.state = STONEMASON_STATE.DEPOSITING;
                entity.requestSentAt = null;
                break;
        }
    }

    // =========================================================================
    // COLLECTING FROM MARKET
    // =========================================================================

    _handleCollecting(entity) {
        // Only send request once
        if (!entity.requestSentAt) {
            // Determine which stone type is available in the market
            const stoneType = this._selectAvailableStoneType(entity.targetId);
            if (!stoneType) {
                this._enterStuckState(entity, 'no_stone');
                return;
            }

            entity.requestSentAt = Date.now();
            entity.collectingStoneType = stoneType;

            if (this.networkManager) {
                const marketData = this.gameState?.getStructureById(entity.targetId);
                if (marketData) {
                    const chunkKey = marketData.chunkKey || ChunkCoordinates.worldToChunkKey(
                        marketData.position.x, marketData.position.z
                    );
                    this.networkManager.sendMessage('npc_collect_from_market', {
                        npcType: 'stonemason',
                        structureId: entity.buildingId,
                        marketId: entity.targetId,
                        chunkId: `chunk_${chunkKey}`,
                        itemType: stoneType,
                        count: this._getConfig('STONE_COUNT')
                    });
                }
            }
        }

        // Timeout after 10 seconds - return to building and retry
        if (entity.requestSentAt && Date.now() - entity.requestSentAt > 10000) {
            entity.requestSentAt = null;
            entity.state = STONEMASON_STATE.RETURNING;
            entity.targetId = null;
        }
    }

    _selectAvailableStoneType(marketId) {
        const marketData = this.gameState?.getStructureById(marketId);
        if (!marketData?.object?.userData?.inventory?.items) return null;

        const items = marketData.object.userData.inventory.items;
        const stoneTypes = this._getConfig('STONE_TYPES');

        // Count each stone type available (market uses object-based inventory)
        // Pattern matches _marketHasItem() from BaseWorkerController
        let bestType = null;
        let bestCount = 0;

        for (const stoneType of stoneTypes) {
            const itemData = items[stoneType];
            if (!itemData) continue;

            let total = 0;
            for (const key of Object.keys(itemData)) {
                total += itemData[key] || 0;
            }

            if (total > bestCount) {
                bestCount = total;
                bestType = stoneType;
            }
        }

        return bestType;
    }

    // =========================================================================
    // CHISELING - Models after CraftingSystem
    // =========================================================================

    _handleChiseling(entity, deltaTime) {
        // Use same duration as player chiseling (CraftingSystem line 58)
        const chiselDuration = CONFIG.ACTIONS?.CHISELING_DURATION || 6000;

        // START CHISELING - mirrors CraftingSystem.startChiselingAction()
        if (!entity.activeChiselAction) {
            if (!entity.rawStone || entity.rawStone.length === 0) {
                // No stones to process
                entity.state = STONEMASON_STATE.IDLE;
                return;
            }

            // Start chiseling the first stone (mirrors lines 55-62)
            entity.activeChiselAction = {
                startTime: Date.now(),
                duration: chiselDuration,
                stone: entity.rawStone[0]
            };
            entity.currentChiselIndex = 0;

            // Start animation and sound (mirrors lines 64-78)
            this._setChiseling(entity, true);

            // Broadcast to peers (mirrors lines 80-87)
            this._broadcastSingleEntityState(entity.buildingId, entity);
            return;
        }

        // CHECK COMPLETION - mirrors CraftingSystem.completeChiselingAction()
        const elapsed = Date.now() - entity.activeChiselAction.startTime;

        if (elapsed >= chiselDuration) {
            // Complete current stone (mirrors lines 131-137)
            const stone = entity.activeChiselAction.stone;
            const chiseledType = this.game.craftingSystem.convertToChiseledType(stone.type);

            // Create chiseled stone with durability 100 (mirrors line 137)
            entity.chiseledStone.push({
                ...stone,
                type: chiseledType,
                durability: 100
            });

            // Remove processed stone from rawStone
            entity.rawStone.shift();
            entity.currentChiselIndex++;

            // Check if more stones to process
            if (entity.rawStone.length > 0) {
                // Start next stone
                entity.activeChiselAction = {
                    startTime: Date.now(),
                    duration: chiselDuration,
                    stone: entity.rawStone[0]
                };

                // Replay chisel sound for next stone
                const audioManager = this.game?.audioManager;
                if (audioManager && entity.mesh) {
                    if (entity.activeSound?.isPlaying) {
                        entity.activeSound.stop();
                        entity.mesh.remove(entity.activeSound);
                        try { entity.activeSound.disconnect(); } catch (e) { /* already disconnected */ }
                    }
                    entity.activeSound = audioManager.playPositionalSound('chisel', entity.mesh);
                }
            } else {
                // All done - clear action and transition (mirrors lines 149-152)
                entity.activeChiselAction = null;
                this._setChiseling(entity, false);
                entity.state = STONEMASON_STATE.DELIVERING;

                // Find market for delivery
                const maxDist = Math.sqrt(this._getConfig('MARKET_SEARCH_RADIUS_SQ'));
                const market = this._findMarketNearPosition(entity.homePosition, maxDist);
                if (market) {
                    entity.targetId = market.id;
                    entity.path = [];
                    // Note: Don't call _setMoving(true) here - let _handleMovementState
                    // start the animation only when a path is available to avoid walking in place
                }
            }
        }
    }

    // =========================================================================
    // SERVER RESPONSE HANDLERS
    // =========================================================================

    handleCollectResponse(data) {
        if (!data) return;
        const { success, collected, structureId, marketId } = data;

        // Find entity by structureId (stonemason building ID)
        const entity = this.entities.get(structureId);
        if (!entity) return;

        entity.requestSentAt = null;

        if (success && Array.isArray(collected) && collected.length > 0) {
            // Add collected stones to rawStone array
            for (const item of collected) {
                if (item?.type) {
                    entity.rawStone.push(item);
                }
            }

            // Update local market cache to prevent stale reads
            this._updateLocalInventoryCache(marketId, [], collected);
        }

        // Transition to returning state (go back to building to chisel)
        entity.state = STONEMASON_STATE.RETURNING;
        entity.path = [];
        // Note: Don't call _setMoving(true) here - let _handleMovementState
        // start the animation only when a path is available to avoid walking in place
    }

    handleDepositResponse(data) {
        // Fire-and-forget: state already transitioned, no action needed
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
        // Stop chiseling animation
        this._setChiseling(entity, false);
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    get stonemasons() {
        return this.entities;
    }

    checkStoneMasonSpawn(dockData) {
        return this.checkWorkerSpawn(dockData);
    }

    getStoneMasonDialogueData(buildingId) {
        return this.getWorkerDialogueData(buildingId);
    }

    onStoneMasonBuildingDestroyed(buildingId) {
        return this.onBuildingDestroyed(buildingId);
    }

    getActiveWorkersForSync() {
        return this.getAllWorkersForSync();
    }

    getActiveStoneMasonsForSync() {
        return this.getActiveWorkersForSync();
    }

    syncStoneMasonsFromPeer(stonemasonList, peerId) {
        return this.syncWorkersFromPeer(stonemasonList, peerId);
    }
}

// Singleton instance
export const stoneMasonController = new StoneMasonController();
export { STONEMASON_STATE };

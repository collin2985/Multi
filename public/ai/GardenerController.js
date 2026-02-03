/**
 * GardenerController.js
 * Manages Gardener NPCs that work at gardener buildings
 *
 * Gardener behavior loop:
 * 1. Plant vegetables in field pattern (23 slots, US flag pattern)
 * 2. Wait for vegetables to mature (30 minutes)
 * 3. Harvest mature vegetables (FIFO - oldest first)
 * 4. Deliver vegetables + rope to market
 * 5. Plant trees during downtime (pine 80%, apple 20%)
 * 6. Repeat
 *
 * Extends BaseWorkerController for shared P2P authority and movement logic.
 */

import { CONFIG } from '../config.js';
import { ChunkCoordinates } from '../core/ChunkCoordinates.js';
import { QualityGenerator } from '../core/QualityGenerator.js';
import { COLLISION_GROUPS } from '../core/PhysicsManager.js';
import { BaseWorkerController } from './BaseWorkerController.js';

// Gardener-specific configuration (base configs inherited from BaseWorkerController)
const GARDENER_CONFIG_DEFAULTS = {
    NPC_COLOR: 0x228B22,              // Forest green

    // Field layout
    MAX_PLANTED: 23,
    PLANT_PATTERN: [5, 4, 5, 4, 5],   // US flag pattern
    ROW_SPACING: 0.75,                // Restored from 1.5
    COL_SPACING: 0.75,                // Restored from 1.5
    FIELD_START_DIST: 2,
    FIELD_DEPTH: 3.0,                 // Restored from 6
    VEGETABLE_RADIUS: 0.2,            // Restored from 0.25
    VEGETABLE_HEIGHT: 0.5,

    // Harvest
    HARVEST_TIME_MS: 30 * 60 * 1000,  // 30 minutes
    HARVEST_CHECK_INTERVAL: 30000,    // Restored from 5000 (30s vs 5s)

    // Tree planting
    TREE_PLANTING_ENABLED: true,
    TREE_MIN_DISTANCE: 3,             // Restored from 10
    TREE_SEARCH_RADIUS: 15,           // Restored from 30
    TREE_PINE_CHANCE: 0.9,            // 1 apple per 9 pine trees
    TREE_MIN_HEIGHT: 4,
    TREE_MAX_HEIGHT: 20,
    TREE_MAX_SLOPE_NORMAL_Y: 0.7986,  // Restored from 0.8 (cos(37 degrees))
    TREE_COLLISION_RADIUS: 0.5,       // Restored from 1.0
    TREE_COLLISION_HEIGHT: 3.0,       // Restored from 4.0
    TREE_GRID_CELL_SIZE: 5,
    TREE_SPACING: 2.5,
    TREE_CLEANUP_INTERVAL: 5 * 60 * 1000  // 5 minutes
};

// Gardener states
const GARDENER_STATE = {
    IDLE: 'idle',
    SEEKING_PLANT_SPOT: 'seeking_plant_spot',
    PLANTING: 'planting',
    WAITING_FOR_HARVEST: 'waiting_for_harvest',
    SEEKING_HARVEST: 'seeking_harvest',
    HARVESTING: 'harvesting',
    DELIVERING: 'delivering',
    DEPOSITING: 'depositing',
    RETURNING: 'returning',
    SEEKING_TREE_SPOT: 'seeking_tree_spot',
    PLANTING_TREE: 'planting_tree',
    STUCK: 'stuck'
};

class GardenerController extends BaseWorkerController {
    constructor() {
        super({
            workerType: 'gardener',
            configKey: 'GARDENER',
            npcColor: GARDENER_CONFIG_DEFAULTS.NPC_COLOR,
            displayName: 'Gardener',
            movementStates: [
                GARDENER_STATE.SEEKING_PLANT_SPOT,
                GARDENER_STATE.SEEKING_HARVEST,
                GARDENER_STATE.RETURNING,
                GARDENER_STATE.DELIVERING,
                GARDENER_STATE.SEEKING_TREE_SPOT
            ]
        });
    }

    // =========================================================================
    // OVERRIDE: Config helper
    // =========================================================================

    _getConfig(key) {
        return CONFIG.GARDENER?.[key] ?? GARDENER_CONFIG_DEFAULTS[key] ?? super._getConfig(key);
    }

    // =========================================================================
    // OVERRIDE: Authority claim - rebuild tree grid from world state
    // =========================================================================

    _claimAuthority(buildingId, entity) {
        super._claimAuthority(buildingId, entity);
        if (entity.authorityId === this.clientId) {
            this._rebuildTreeGridFromWorld(entity);
            this._rebuildPlantedVegetablesFromWorld(entity);
        }
    }

    // =========================================================================
    // ABSTRACT METHOD IMPLEMENTATIONS
    // =========================================================================

    _getStateEnum() {
        return GARDENER_STATE;
    }

    _getStructuresInChunk(chunkKey) {
        return this.gameState?.getGardenersInChunk(chunkKey) || [];
    }

    _createWorkerSpecificState(buildingData) {
        return {
            buildingRotation: buildingData.object?.rotation?.y || 0,
            fieldSlots: new Array(23).fill(false),
            plantedVegetables: [],
            treeGrid: new Map(),
            pendingTreeType: null,
            _lastTreeCleanup: 0,
            _lastWaitCheck: 0
        };
    }

    _createBroadcastMessage() {
        const msg = super._createBroadcastMessage();
        msg.plantedCount = 0;
        return msg;
    }

    _addBroadcastExtraFields(entity, msg) {
        msg.plantedCount = entity.plantedVegetables?.length || 0;
    }

    _applyExtraStateFields(entity, message) {
        // Sync plantedVegetables from authority
        if (message.plantedVegetables && Array.isArray(message.plantedVegetables)) {
            entity.plantedVegetables = message.plantedVegetables.map(v => ({ ...v }));
            this._rebuildFieldSlots(entity);
        }
        // Sync treeGrid from authority
        if (message.treeGridData && Array.isArray(message.treeGridData)) {
            entity.treeGrid = new Map(message.treeGridData);
        }
        // Sync pendingTreeType from authority
        if (message.pendingTreeType !== undefined) {
            entity.pendingTreeType = message.pendingTreeType;
        }
        // Sync buildingRotation from authority
        if (message.buildingRotation !== undefined) {
            entity.buildingRotation = message.buildingRotation;
        }
    }

    _getSyncExtraFields(entity) {
        return {
            plantedVegetables: entity.plantedVegetables?.map(v => ({ ...v })) || [],
            treeGridData: entity.treeGrid ? Array.from(entity.treeGrid.entries()) : [],
            pendingTreeType: entity.pendingTreeType,
            buildingRotation: entity.buildingRotation
        };
    }

    /**
     * Rebuild fieldSlots from plantedVegetables
     * Used during authority transfer to restore field state
     */
    _rebuildFieldSlots(entity) {
        entity.fieldSlots.fill(false);
        for (const planted of entity.plantedVegetables) {
            if (planted.slotIndex !== undefined && planted.slotIndex >= 0 && planted.slotIndex < 23) {
                entity.fieldSlots[planted.slotIndex] = true;
            }
        }
    }

    _getExtraDialogueData(entity) {
        return {
            plantedCount: entity.plantedVegetables?.length || 0
        };
    }

    _getSpawnBroadcastExtra(entity) {
        return {
            buildingRotation: entity.buildingRotation
        };
    }

    _applySpawnMessageExtra(entity, message) {
        if (message.buildingRotation !== undefined) {
            entity.buildingRotation = message.buildingRotation;
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
                entity.state = GARDENER_STATE.DELIVERING;
                entity.targetId = task.target;
                entity.path = [];
                break;
            case 'harvest':
                entity.state = GARDENER_STATE.SEEKING_HARVEST;
                entity.targetId = task.target.vegetableId;
                entity.targetPosition = task.target.position;
                entity.path = [];
                break;
            case 'plant':
                entity.state = GARDENER_STATE.SEEKING_PLANT_SPOT;
                entity.targetPosition = task.target;
                entity.path = [];
                break;
            case 'wait_for_harvest':
                entity.state = GARDENER_STATE.WAITING_FOR_HARVEST;
                break;
            case 'stuck':
                this._enterStuckState(entity, task.reason);
                break;
        }
    }

    _decideNextTask(entity) {
        const market = this._findMarketNearPosition(entity.homePosition, this._getConfig('MARKET_MAX_DISTANCE'));

        // Priority 1: DELIVER - Carrying vegetables?
        const hasVegetables = entity.carrying.some(i => i.type === 'vegetables');
        if (hasVegetables) {
            if (!market) return { task: 'wait' };
            return { task: 'deliver', target: market.id };
        }

        // Priority 2: HARVEST - Any vegetables ready (30+ min)?
        const harvestable = this._findHarvestableVegetable(entity);
        if (harvestable) {
            return { task: 'harvest', target: harvestable };
        }

        // Priority 3: PLANT - Under 23 vegetables?
        if (entity.plantedVegetables.length < this._getConfig('MAX_PLANTED')) {
            const spot = this._findValidPlantingSpot(entity);
            if (spot) {
                return { task: 'plant', target: spot };
            }
        }

        // Priority 4: WAIT
        return { task: 'wait_for_harvest' };
    }

    _handleWorkerSpecificState(entity, deltaTime) {
        switch (entity.state) {
            case GARDENER_STATE.PLANTING:
                this._handlePlanting(entity);
                break;
            case GARDENER_STATE.WAITING_FOR_HARVEST:
                this._handleWaitingForHarvest(entity);
                break;
            case GARDENER_STATE.HARVESTING:
                this._handleHarvesting(entity);
                break;
            case GARDENER_STATE.DEPOSITING:
                this._handleMarketDeposit(entity);
                break;
            case GARDENER_STATE.PLANTING_TREE:
                this._handlePlantingTree(entity);
                break;
        }
    }

    _getMovementTarget(entity) {
        switch (entity.state) {
            case GARDENER_STATE.SEEKING_PLANT_SPOT:
            case GARDENER_STATE.SEEKING_HARVEST:
            case GARDENER_STATE.SEEKING_TREE_SPOT:
                if (entity.targetPosition) {
                    return { x: entity.targetPosition.x, z: entity.targetPosition.z };
                }
                return null;

            case GARDENER_STATE.DELIVERING:
                const market = this.gameState?.getStructureById(entity.targetId);
                if (!market) return null;
                return this._calculateApproachPosition(market, entity.position, 4.0);

            case GARDENER_STATE.RETURNING:
                return this._calculateApproachPosition(
                    { position: entity.homePosition },
                    entity.position,
                    0.75
                );

            default:
                return null;
        }
    }

    _onArrival(entity) {
        this._setMoving(entity, false);
        entity.path = [];
        entity.pathIndex = 0;

        switch (entity.state) {
            case GARDENER_STATE.SEEKING_PLANT_SPOT:
                entity.state = GARDENER_STATE.PLANTING;
                break;
            case GARDENER_STATE.SEEKING_HARVEST:
                entity.state = GARDENER_STATE.HARVESTING;
                break;
            case GARDENER_STATE.DELIVERING:
                entity.state = GARDENER_STATE.DEPOSITING;
                entity.requestSentAt = null;
                break;
            case GARDENER_STATE.RETURNING:
                this._cleanupDuplicatePlantings(entity);
                entity.state = GARDENER_STATE.IDLE;
                break;
            case GARDENER_STATE.SEEKING_TREE_SPOT:
                entity.state = GARDENER_STATE.PLANTING_TREE;
                break;
        }
    }

    // =========================================================================
    // PLANTING (Pattern-based field layout)
    // =========================================================================

    _handlePlanting(entity) {
        if (!entity.targetPosition) {
            entity.state = GARDENER_STATE.IDLE;
            return;
        }

        const success = this._plantVegetable(entity, entity.targetPosition);

        if (success) {
            entity.targetPosition = null;
            entity.state = GARDENER_STATE.RETURNING;
            entity.path = [];
        } else {
            entity.state = GARDENER_STATE.IDLE;
        }
    }

    _indexToRowCol(index) {
        const pattern = this._getConfig('PLANT_PATTERN');
        let remaining = index;
        for (let row = 0; row < pattern.length; row++) {
            if (remaining < pattern[row]) {
                return { row, col: remaining, isOffsetRow: pattern[row] === 4 };
            }
            remaining -= pattern[row];
        }
        return null;
    }

    _getFieldPosition(entity, row, col, isOffsetRow) {
        const ROW_SPACING = this._getConfig('ROW_SPACING');
        const COL_SPACING = this._getConfig('COL_SPACING');
        const FIELD_START_DIST = this._getConfig('FIELD_START_DIST');
        const FIELD_DEPTH = this._getConfig('FIELD_DEPTH');

        const localZ = -(FIELD_START_DIST + FIELD_DEPTH / 2) + (row - 2) * ROW_SPACING;
        const numCols = isOffsetRow ? 4 : 5;
        const totalWidth = (numCols - 1) * COL_SPACING;
        const localX = -totalWidth / 2 + col * COL_SPACING;

        const cos = Math.cos(-entity.buildingRotation);
        const sin = Math.sin(-entity.buildingRotation);

        return {
            x: entity.homePosition.x + (localX * cos - localZ * sin),
            z: entity.homePosition.z + (localX * sin + localZ * cos)
        };
    }

    _findValidPlantingSpot(entity) {
        for (let i = 0; i < 23; i++) {
            if (entity.fieldSlots[i]) continue;

            const rowCol = this._indexToRowCol(i);
            if (!rowCol) continue;

            const pos = this._getFieldPosition(entity, rowCol.row, rowCol.col, rowCol.isOffsetRow);

            if (this._isValidFieldPosition(pos.x, pos.z)) {
                return { x: pos.x, z: pos.z, slotIndex: i };
            }
        }
        return null;
    }

    _isValidFieldPosition(x, z) {
        if (this.isWalkable && !this.isWalkable(x, z)) return false;

        const height = this.getTerrainHeight?.(x, z) || 0;
        if (height < (CONFIG.WATER?.LEVEL || 0)) return false;

        if (this._hasCollisionAt(x, z)) return false;

        return true;
    }

    _hasCollisionAt(x, z) {
        if (!this.game?.physicsManager) return false;

        const height = this.getTerrainHeight?.(x, z) || 0;
        const shape = {
            type: 'cylinder',
            radius: this._getConfig('VEGETABLE_RADIUS'),
            height: this._getConfig('VEGETABLE_HEIGHT')
        };

        return this.game.physicsManager.testShapeOverlap(
            shape,
            { x, y: height, z },
            0,
            COLLISION_GROUPS.STRUCTURE | COLLISION_GROUPS.NATURAL | COLLISION_GROUPS.PLACED
        );
    }

    _plantVegetable(entity, targetPosition) {
        const terrainHeight = this.getTerrainHeight?.(targetPosition.x, targetPosition.z) || 0;
        if (terrainHeight < (CONFIG.WATER?.LEVEL || 0)) return false;

        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(targetPosition.x, targetPosition.z);
        const worldSeed = CONFIG.TERRAIN?.seed || 12345;
        const regionQualityRange = QualityGenerator.getQualityRange(worldSeed, chunkX, chunkZ, 'vegetables');
        const quality = Math.floor(
            regionQualityRange.min + Math.random() * (regionQualityRange.max - regionQualityRange.min)
        );

        if (this.networkManager) {
            this.networkManager.sendMessage('plant_tree', {
                position: [targetPosition.x, terrainHeight, targetPosition.z],
                treeType: 'vegetables',
                quality: quality,
                chunkId: `${chunkX},${chunkZ}`,
                clientId: this.clientId,
                isNpcPlanted: true
            });
        }

        const slotIndex = targetPosition.slotIndex;
        if (slotIndex !== undefined && slotIndex >= 0 && slotIndex < 23) {
            entity.fieldSlots[slotIndex] = true;
        }

        entity.plantedVegetables.push({
            vegetableId: null,
            position: { x: targetPosition.x, y: terrainHeight, z: targetPosition.z },
            plantedAt: Date.now(),
            chunkId: `${chunkX},${chunkZ}`,
            quality: quality,
            slotIndex: slotIndex
        });

        return true;
    }

    handleTreePlanted(payload) {
        const { objectId, position, treeType } = payload;
        if (treeType !== 'vegetables' && treeType !== 'planted_vegetables') return;

        for (const entity of this.entities.values()) {
            for (const planted of entity.plantedVegetables) {
                if (planted.vegetableId) continue;

                const dx = planted.position.x - position[0];
                const dz = planted.position.z - position[2];
                const distSq = dx * dx + dz * dz;

                if (distSq < 1.0) {
                    planted.vegetableId = objectId;
                    return;
                }
            }
        }
    }

    // =========================================================================
    // WAITING & HARVESTING
    // =========================================================================

    _handleWaitingForHarvest(entity) {
        const now = Date.now();
        if (now - entity._lastWaitCheck < this._getConfig('HARVEST_CHECK_INTERVAL')) return;
        entity._lastWaitCheck = now;

        // Rebuild tree grid from world state periodically
        if (now - (entity._lastTreeCleanup || 0) > this._getConfig('TREE_CLEANUP_INTERVAL')) {
            this._rebuildTreeGridFromWorld(entity);
            entity._lastTreeCleanup = now;
        }

        // If no vegetables tracked, try rebuilding from world state and go to IDLE
        // to retry planting (handles authority transfer losing plantedVegetables)
        if (entity.plantedVegetables.length === 0) {
            this._rebuildPlantedVegetablesFromWorld(entity);
            entity.state = GARDENER_STATE.IDLE;
            return;
        }

        // Check for harvestable vegetables
        const harvestable = this._findHarvestableVegetable(entity);
        if (harvestable) {
            entity.state = GARDENER_STATE.IDLE;
            return;
        }

        // Try to plant a tree during downtime
        if (this._getConfig('TREE_PLANTING_ENABLED')) {
            const treeSpot = this._findValidTreePlantingSpot(entity);
            if (treeSpot) {
                entity.state = GARDENER_STATE.SEEKING_TREE_SPOT;
                entity.targetPosition = { x: treeSpot.x, z: treeSpot.z };
                entity.pendingTreeType = treeSpot.treeType;
                entity.path = [];
            }
        }
    }

    _findHarvestableVegetable(entity) {
        const now = Date.now();
        const harvestTime = this._getConfig('HARVEST_TIME_MS');
        let oldest = null;
        let oldestAge = 0;

        for (const planted of entity.plantedVegetables) {
            if (!planted.vegetableId) continue;

            const age = now - planted.plantedAt;
            if (age >= harvestTime && age > oldestAge) {
                oldestAge = age;
                oldest = planted;
            }
        }

        return oldest;
    }

    _handleHarvesting(entity) {
        const planted = entity.plantedVegetables.find(p => p.vegetableId === entity.targetId);
        if (!planted) {
            entity.state = GARDENER_STATE.IDLE;
            return;
        }

        const success = this._harvestVegetable(entity, planted);

        if (success) {
            entity.targetId = null;
            entity.state = GARDENER_STATE.DELIVERING;
            entity.path = [];
        } else {
            entity.state = GARDENER_STATE.IDLE;
        }
    }

    _harvestVegetable(entity, planted) {
        const vegetableObject = this._findVegetableObjectById(planted.vegetableId, planted.chunkId);
        if (!vegetableObject) {
            this._removeFromPlantedVegetables(entity, planted.vegetableId);
            return false;
        }

        const quality = vegetableObject.userData?.quality || planted.quality || 50;

        entity.carrying.push({
            id: `vegetables_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'vegetables',
            x: -1, y: -1,
            width: 1, height: 1,
            rotation: 0,
            quality: quality,
            durability: Math.round(20 * (quality / 100))
        });

        entity.carrying.push({
            id: `rope_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'rope',
            x: -1, y: -1,
            width: 1, height: 1,
            rotation: 0,
            quality: quality,
            durability: 100
        });

        if (this.networkManager) {
            this.networkManager.sendMessage('remove_object_request', {
                chunkId: `chunk_${planted.chunkId}`,
                objectId: planted.vegetableId,
                name: 'vegetables',
                position: [planted.position.x, planted.position.y, planted.position.z],
                quality: quality,
                scale: [1, 1, 1],
                objectData: {
                    name: 'vegetables',
                    position: [planted.position.x, planted.position.y, planted.position.z],
                    quality: quality,
                    scale: [1, 1, 1]
                },
                clientId: this.clientId,
                accountId: null
            });
        }

        this._removeFromPlantedVegetables(entity, planted.vegetableId);
        return true;
    }

    _findVegetableObjectById(vegetableId, chunkId = null) {
        if (this.game?.objectRegistry) {
            const obj = this.game.objectRegistry.get(vegetableId);
            if (obj) return obj;
        }

        if (chunkId && this.game?.chunkManager?.chunkObjects) {
            const objects = this.game.chunkManager.chunkObjects.get(chunkId);
            if (Array.isArray(objects)) {
                for (const obj of objects) {
                    if (obj.userData?.objectId === vegetableId) return obj;
                }
            }
        }

        return null;
    }

    _removeFromPlantedVegetables(entity, vegetableId) {
        const index = entity.plantedVegetables.findIndex(p => p.vegetableId === vegetableId);
        if (index !== -1) {
            const planted = entity.plantedVegetables[index];
            if (planted.slotIndex !== undefined && planted.slotIndex >= 0 && planted.slotIndex < 23) {
                entity.fieldSlots[planted.slotIndex] = false;
            }
            entity.plantedVegetables.splice(index, 1);
        }
    }

    // =========================================================================
    // SERVER RESPONSE HANDLERS
    // =========================================================================

    handleDepositResponse(payload) {
        // Fire-and-forget: state already transitioned, no action needed
    }

    // =========================================================================
    // TREE PLANTING DURING DOWNTIME
    // =========================================================================

    _handlePlantingTree(entity) {
        if (!entity.targetPosition) {
            entity.pendingTreeType = null;
            entity.state = GARDENER_STATE.WAITING_FOR_HARVEST;
            return;
        }

        const treeType = entity.pendingTreeType || 'pine';
        this._plantTree(entity, entity.targetPosition, treeType);

        entity.targetPosition = null;
        entity.pendingTreeType = null;
        entity.path = [];
        entity.state = GARDENER_STATE.RETURNING;
    }

    _findValidTreePlantingSpot(entity) {
        const MIN_DIST = this._getConfig('TREE_MIN_DISTANCE');
        const MAX_DIST = this._getConfig('TREE_SEARCH_RADIUS');
        const MAX_ATTEMPTS = 12;

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = MIN_DIST + Math.random() * (MAX_DIST - MIN_DIST);

            const x = entity.homePosition.x + Math.cos(angle) * distance;
            const z = entity.homePosition.z + Math.sin(angle) * distance;

            if (this._isValidTreePosition(x, z, entity)) {
                const treeType = Math.random() < this._getConfig('TREE_PINE_CHANCE') ? 'pine' : 'apple';
                return { x, z, treeType };
            }
        }

        return null;
    }

    _isValidTreePosition(x, z, entity) {
        if (this.isWalkable && !this.isWalkable(x, z)) return false;

        const height = this.getTerrainHeight?.(x, z) || 0;
        if (height < this._getConfig('TREE_MIN_HEIGHT') || height > this._getConfig('TREE_MAX_HEIGHT')) {
            return false;
        }

        if (!this._isGentleSlope(x, z)) return false;
        if (this._isOnRoad(x, z)) return false;
        if (this._hasTreeCollisionAt(x, z)) return false;
        if (this._isTooCloseToPlantedTrees(x, z, entity)) return false;

        return true;
    }

    _isGentleSlope(x, z) {
        const terrainGen = this.game?.terrainGenerator;
        if (!terrainGen?.getNormalY) return true;

        const normalY = terrainGen.getNormalY(x, z);
        if (typeof normalY !== 'number' || isNaN(normalY)) return true;

        return normalY >= this._getConfig('TREE_MAX_SLOPE_NORMAL_Y');
    }

    _isOnRoad(x, z) {
        if (this.game?.navigationManager?.isOnRoad) {
            return this.game.navigationManager.isOnRoad(x, z);
        }

        const chunkId = ChunkCoordinates.worldToChunkId(x, z);
        const navMap = this.game?.navigationManager?.chunkMaps?.get(chunkId);
        if (navMap?.getMovementSpeedInfo) {
            const info = navMap.getMovementSpeedInfo(x, z);
            return info?.onRoad ?? false;
        }

        return false;
    }

    _hasTreeCollisionAt(x, z) {
        if (!this.game?.physicsManager) return false;

        const height = this.getTerrainHeight?.(x, z) || 0;
        const shape = {
            type: 'cylinder',
            radius: this._getConfig('TREE_COLLISION_RADIUS'),
            height: this._getConfig('TREE_COLLISION_HEIGHT')
        };

        return this.game.physicsManager.testShapeOverlap(
            shape,
            { x, y: height, z },
            0,
            COLLISION_GROUPS.STRUCTURE | COLLISION_GROUPS.NATURAL | COLLISION_GROUPS.PLACED
        );
    }

    _isTooCloseToPlantedTrees(x, z, entity) {
        if (!entity.treeGrid || entity.treeGrid.size === 0) return false;

        const cellSize = this._getConfig('TREE_GRID_CELL_SIZE');
        const minSpacingSq = this._getConfig('TREE_SPACING') * this._getConfig('TREE_SPACING');

        const baseCellX = Math.floor(x / cellSize);
        const baseCellZ = Math.floor(z / cellSize);

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const cellKey = `${baseCellX + dx},${baseCellZ + dz}`;
                const treesInCell = entity.treeGrid.get(cellKey);
                if (!treesInCell) continue;

                for (const tree of treesInCell) {
                    const tdx = x - tree.position.x;
                    const tdz = z - tree.position.z;
                    if (tdx * tdx + tdz * tdz < minSpacingSq) return true;
                }
            }
        }

        return false;
    }

    _plantTree(entity, position, treeType) {
        console.error(`[GardenerPlant] buildingId=${entity.buildingId} type=${treeType} pos=(${position.x.toFixed(1)},${position.z.toFixed(1)}) auth=${entity.authorityId} client=${this.clientId} state=${entity.state} t=${Date.now()}`);
        const terrainHeight = this.getTerrainHeight?.(position.x, position.z) || 0;
        if (terrainHeight < (CONFIG.WATER?.LEVEL || 0)) return false;

        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(position.x, position.z);
        const worldSeed = CONFIG.TERRAIN?.seed || 12345;
        const regionQualityRange = QualityGenerator.getQualityRange(worldSeed, chunkX, chunkZ, treeType);
        const quality = Math.floor(
            regionQualityRange.min + Math.random() * (regionQualityRange.max - regionQualityRange.min)
        );

        if (this.networkManager) {
            this.networkManager.sendMessage('plant_tree', {
                position: [position.x, terrainHeight, position.z],
                treeType: treeType,
                quality: quality,
                chunkId: `${chunkX},${chunkZ}`,
                clientId: this.clientId,
                isNpcPlanted: true
            });
        }

        // Add to spatial grid
        this._addTreeToGrid(entity, {
            position: { x: position.x, z: position.z },
            treeType: treeType,
            plantedAt: Date.now()
        });

        return true;
    }

    _addTreeToGrid(entity, tree) {
        if (!entity.treeGrid) entity.treeGrid = new Map();

        const cellSize = this._getConfig('TREE_GRID_CELL_SIZE');
        const cellKey = `${Math.floor(tree.position.x / cellSize)},${Math.floor(tree.position.z / cellSize)}`;

        if (!entity.treeGrid.has(cellKey)) {
            entity.treeGrid.set(cellKey, []);
        }
        entity.treeGrid.get(cellKey).push(tree);
    }

    /**
     * Rebuild plantedVegetables from actual world objects near the gardener building.
     * Scans chunk objects for planted vegetables and matches them to field slots,
     * so the gardener recovers its field state after authority transfer or page refresh.
     */
    _rebuildPlantedVegetablesFromWorld(entity) {
        const chunkObjects = this.chunkManager?.chunkObjects || this.game?.chunkManager?.chunkObjects;
        if (!chunkObjects) return;

        const home = entity.homePosition;
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(home.x, home.z);
        const currentTick = this.gameState?.serverTick || 0;

        // Collect all planted vegetables near the building
        const foundVegetables = [];
        const searchRadiusSq = 49; // 7^2 - field is within ~5 units

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const chunkKey = `${chunkX + dx},${chunkZ + dz}`;
                const objects = chunkObjects.get(chunkKey);
                if (!objects) continue;

                for (const obj of objects) {
                    const id = obj.userData?.objectId;
                    if (!id) continue;

                    const modelType = obj.userData?.modelType || obj.name;
                    if (modelType !== 'vegetables' && modelType !== 'planted_vegetables') continue;
                    if (!id.startsWith('planted_')) continue;

                    const tdx = obj.position.x - home.x;
                    const tdz = obj.position.z - home.z;
                    if (tdx * tdx + tdz * tdz > searchRadiusSq) continue;

                    foundVegetables.push({
                        objectId: id,
                        position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
                        quality: obj.userData?.quality || 50,
                        plantedAtTick: obj.userData?.plantedAtTick || 0,
                        isGrowing: obj.userData?.isGrowing || false,
                        chunkId: chunkKey
                    });
                }
            }
        }

        if (foundVegetables.length === 0) return;

        // Match each found vegetable to the closest field slot
        entity.plantedVegetables = [];
        entity.fieldSlots.fill(false);
        const usedSlots = new Set();

        for (const veg of foundVegetables) {
            let bestSlot = -1;
            let bestDistSq = 1.5 * 1.5; // max 1.5 unit match distance

            for (let i = 0; i < 23; i++) {
                if (usedSlots.has(i)) continue;

                const rowCol = this._indexToRowCol(i);
                if (!rowCol) continue;

                const slotPos = this._getFieldPosition(entity, rowCol.row, rowCol.col, rowCol.isOffsetRow);
                const sdx = veg.position.x - slotPos.x;
                const sdz = veg.position.z - slotPos.z;
                const distSq = sdx * sdx + sdz * sdz;

                if (distSq < bestDistSq) {
                    bestDistSq = distSq;
                    bestSlot = i;
                }
            }

            // Estimate plantedAt timestamp from tick data
            let plantedAt;
            if (veg.plantedAtTick > 0 && currentTick > 0) {
                const ticksAgo = currentTick - veg.plantedAtTick;
                plantedAt = Date.now() - (ticksAgo * 1000);
            } else {
                // No tick data - assume planted long ago (harvestable)
                plantedAt = Date.now() - (31 * 60 * 1000);
            }

            const slotIndex = bestSlot >= 0 ? bestSlot : undefined;
            if (slotIndex !== undefined) {
                usedSlots.add(slotIndex);
                entity.fieldSlots[slotIndex] = true;
            }

            entity.plantedVegetables.push({
                vegetableId: veg.objectId,
                position: veg.position,
                plantedAt: plantedAt,
                chunkId: veg.chunkId,
                quality: veg.quality,
                slotIndex: slotIndex
            });
        }
    }

    /**
     * Rebuild treeGrid from actual world objects near the gardener building.
     * Replaces the old time-based cleanup - scans chunk objects for planted trees
     * so the gardener never "forgets" existing trees after authority transfer or time.
     */
    _rebuildTreeGridFromWorld(entity) {
        entity.treeGrid = new Map();

        const chunkObjects = this.chunkManager?.chunkObjects || this.game?.chunkManager?.chunkObjects;
        if (!chunkObjects) return;

        const home = entity.homePosition;
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(home.x, home.z);
        const searchRadiusSq = this._getConfig('TREE_SEARCH_RADIUS') * this._getConfig('TREE_SEARCH_RADIUS');

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const chunkKey = `${chunkX + dx},${chunkZ + dz}`;
                const objects = chunkObjects.get(chunkKey);
                if (!objects) continue;

                for (const obj of objects) {
                    const id = obj.userData?.objectId;
                    if (!id) continue;

                    // Match planted trees by ID prefix
                    if (!id.startsWith('planted_pine') && !id.startsWith('planted_apple')) continue;

                    const tdx = obj.position.x - home.x;
                    const tdz = obj.position.z - home.z;
                    if (tdx * tdx + tdz * tdz > searchRadiusSq) continue;

                    this._addTreeToGrid(entity, {
                        position: { x: obj.position.x, z: obj.position.z },
                        treeType: id.startsWith('planted_pine') ? 'pine' : 'apple',
                        plantedAt: Date.now()
                    });
                }
            }
        }
    }

    /**
     * Check for duplicate planted vegetables/trees at the same position.
     * Scans chunk objects near the gardener and if two planted objects share
     * the exact same x,z coordinates, sends remove_object_request for the extra.
     */
    _cleanupDuplicatePlantings(entity) {
        const chunkObjects = this.chunkManager?.chunkObjects || this.game?.chunkManager?.chunkObjects;
        if (!chunkObjects || !this.networkManager) return;

        const home = entity.homePosition;
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(home.x, home.z);
        const searchRadiusSq = 49; // 7^2
        const seen = new Map(); // "x,z" -> first object

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const chunkKey = `${chunkX + dx},${chunkZ + dz}`;
                const objects = chunkObjects.get(chunkKey);
                if (!objects) continue;

                for (const obj of objects) {
                    const id = obj.userData?.objectId;
                    if (!id || !id.startsWith('planted_')) continue;

                    const modelType = obj.userData?.modelType || obj.name;
                    if (modelType !== 'vegetables' && modelType !== 'planted_vegetables' &&
                        modelType !== 'hemp' && modelType !== 'planted_hemp' &&
                        modelType !== 'pine' && modelType !== 'planted_pine' &&
                        modelType !== 'apple' && modelType !== 'planted_apple') continue;

                    const tdx = obj.position.x - home.x;
                    const tdz = obj.position.z - home.z;
                    if (tdx * tdx + tdz * tdz > searchRadiusSq) continue;

                    const posKey = `${obj.position.x},${obj.position.z}`;
                    if (seen.has(posKey)) {
                        this.networkManager.sendMessage('remove_object_request', {
                            chunkId: `chunk_${chunkKey}`,
                            objectId: id,
                            name: modelType.replace('planted_', ''),
                            position: [obj.position.x, obj.position.y, obj.position.z],
                            quality: obj.userData?.quality || 50,
                            scale: [1, 1, 1],
                            objectData: {
                                name: modelType.replace('planted_', ''),
                                position: [obj.position.x, obj.position.y, obj.position.z],
                                quality: obj.userData?.quality || 50,
                                scale: [1, 1, 1]
                            },
                            clientId: this.clientId
                        });
                    } else {
                        seen.set(posKey, id);
                    }
                }
            }
        }
    }

    // =========================================================================
    // CLEANUP
    // =========================================================================

    dispose() {
        super.dispose();
    }

    // =========================================================================
    // SYNC OVERRIDE - Gardener returns ALL entities (matches old behavior)
    // =========================================================================

    getActiveWorkersForSync() {
        return this.getAllWorkersForSync();
    }

    // =========================================================================
    // PUBLIC API (backwards compatibility)
    // =========================================================================

    get gardeners() {
        return this.entities;
    }

    checkGardenerSpawn(dockData) {
        return this.checkWorkerSpawn(dockData);
    }

    getGardenerDialogueData(buildingId) {
        return this.getWorkerDialogueData(buildingId);
    }

    onGardenerBuildingDestroyed(buildingId) {
        return this.onBuildingDestroyed(buildingId);
    }

    getActiveGardenersForSync() {
        return this.getActiveWorkersForSync();
    }

    syncGardenersFromPeer(gardenerList, peerId) {
        return this.syncWorkersFromPeer(gardenerList, peerId);
    }
}

// Singleton instance
export const gardenerController = new GardenerController();
export { GARDENER_STATE };

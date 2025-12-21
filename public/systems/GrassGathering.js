/**
 * GrassGathering.js
 * Handles vines gathering mechanics:
 * - Detecting when player is standing on grass terrain
 * - Managing vines gathering actions (6 second duration)
 * - Creating vines inventory items with quality based on chunk
 */

import { CONFIG } from '../config.js';
import { CONFIG as TERRAIN_CONFIG } from '../TerrainConfig.js';
import { ui } from '../ui.js';
import ChunkCoordinates from '../core/ChunkCoordinates.js';
import { QualityGenerator } from '../core/QualityGenerator.js';

export class GrassGathering {
    /**
     * @param {object} gameState - Main game state object
     * @param {NavigationManager} navigationManager - For terrain detection
     * @param {ResourceManager} resourceManager - For animations, cooldowns, inventory
     * @param {InventoryUI} inventoryUI - For rendering inventory updates
     * @param {NetworkManager} networkManager - For broadcasting actions to peers
     */
    constructor(gameState, navigationManager, resourceManager, inventoryUI, networkManager) {
        this.gameState = gameState;
        this.navigationManager = navigationManager;
        this.resourceManager = resourceManager;
        this.inventoryUI = inventoryUI;
        this.networkManager = networkManager;

        // Reference to main game instance (set after construction)
        this.game = null;

        // Reference to terrain generator for height data access
        this.terrainGenerator = null;
    }

    /**
     * Set reference to main game instance
     * @param {Game} game - Main game instance
     */
    setGameReference(game) {
        this.game = game;
    }

    /**
     * Set reference to terrain generator for height data access
     * @param {TerrainGenerator} terrainGenerator
     */
    setTerrainGenerator(terrainGenerator) {
        this.terrainGenerator = terrainGenerator;
    }

    /**
     * Detect if player is standing on grass terrain
     * @param {number} playerX - Player world X position
     * @param {number} playerZ - Player world Z position
     * @returns {object} - {onGrass: boolean, qualityRange: object|null, chunkId: string|null}
     */
    detectGrassUnderPlayer(playerX, playerZ, playerY) {
        // Get chunk coordinates from world position
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(playerX, playerZ);
        const chunkId = ChunkCoordinates.toChunkId(chunkX, chunkZ);

        // Get navigation map for this chunk
        const navMap = this.navigationManager.getChunk(chunkId);
        if (!navMap) {
            // Chunk not loaded
            return { onGrass: false, qualityRange: null, chunkId: null };
        }

        // Check surface type at player position
        const surfaceInfo = navMap.getMovementSpeedInfo(playerX, playerZ);

        // Check if standing on grass (and not on a road)
        if (surfaceInfo.surfaceType !== 'grass' || surfaceInfo.onRoad) {
            return { onGrass: false, qualityRange: null, chunkId };
        }

        // Check if player is in the forest altitude band (Y 4-22)
        // This prevents gathering on beaches, docks, and mountains
        if (playerY !== undefined) {
            if (playerY < 4 || playerY > 22) {
                return { onGrass: false, qualityRange: null, chunkId };
            }
        }

        // Player is on grass terrain! Get quality range for vines in this chunk
        const worldSeed = TERRAIN_CONFIG.TERRAIN.seed;
        const qualityRange = QualityGenerator.getQualityRange(worldSeed, chunkX, chunkZ, 'vines');

        return {
            onGrass: true,
            qualityRange: qualityRange, // { min, max, name }
            chunkId: chunkId
        };
    }

    /**
     * Check if player can gather vines right now
     * @returns {boolean} - True if gathering is allowed
     */
    canGatherVines() {
        // TODO: Check cooldown, active actions, movement state
    }

    /**
     * Start vines gathering action (6 second duration)
     */
    startGatheringAction() {
        // Guard: Prevent starting new action if one is already in progress
        if (this.gameState.activeAction) {
            return;
        }

        // Check if cooldown is active
        if (this.gameState.harvestCooldown) {
            const remaining = this.gameState.harvestCooldown.endTime - Date.now();
            if (remaining > 0) {
                ui.updateStatus(`Rest needed: ${Math.ceil(remaining / 1000)}s`);
                return;
            } else {
                this.gameState.harvestCooldown = null;
            }
        }

        // Set active action for 6 seconds
        this.gameState.activeAction = {
            object: null, // No world object for vines gathering
            startTime: Date.now(),
            duration: CONFIG.ACTIONS.BUILD_DURATION, // 6 seconds (same as building)
            actionType: 'gather_vines'
        };

        // Play vines gathering sound
        if (this.resourceManager.audioManager) {
            const sound = this.resourceManager.audioManager.playVinesSound();
            this.gameState.activeAction.sound = sound;
        }

        // Start chopping animation (reuse from ResourceManager)
        if (this.resourceManager.animationMixer && this.resourceManager.choppingAction) {
            if (this.game && this.game.animationAction) {
                this.game.animationAction.stop();
            }
            this.resourceManager.choppingAction.reset();
            this.resourceManager.choppingAction.play();
        }

        // Broadcast vines gathering action to peers
        this.networkManager.broadcastP2P({
            type: 'player_vines_gathering',
            payload: {
                startTime: Date.now(),
                duration: CONFIG.ACTIONS.BUILD_DURATION
            }
        });

        // Broadcast sound to peers
        this.networkManager.broadcastP2P({
            type: 'player_sound',
            payload: {
                soundType: 'vines',
                startTime: Date.now()
            }
        });

        ui.updateStatus('Gathering vines...');
    }

    /**
     * Complete vines gathering action and add item to inventory
     */
    completeGatheringAction() {
        if (!this.game || !this.game.playerObject) {
            console.error('GrassGathering: Cannot complete - game or player not available');
            return;
        }

        // Get player position
        const playerX = this.game.playerObject.position.x;
        const playerZ = this.game.playerObject.position.z;

        // Get chunk coordinates and vines quality
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(playerX, playerZ);
        const worldSeed = TERRAIN_CONFIG.TERRAIN.seed;
        const vinesQuality = QualityGenerator.getQuality(worldSeed, chunkX, chunkZ, 'vines');

        // Create vines item (1x1 size)
        const newVines = {
            id: `vines_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'vines',
            x: -1, // Will be set when finding space in inventory
            y: -1,
            width: 1,
            height: 1,
            rotation: 0,
            quality: vinesQuality,
            durability: 100 // Vines starts at full durability
        };

        // Try to add to inventory
        if (this.game.tryAddItemToInventory(newVines)) {
            ui.updateActionStatus(`Gathered vines! (Quality: ${vinesQuality})`, 3000);

            // Re-render inventory if open
            if (this.gameState.inventoryOpen) {
                this.inventoryUI.renderInventory();
            }
            // Update inventory full status indicator
            if (this.game?.playerInventory) {
                ui.updateInventoryFullStatus(this.game.playerInventory.isFull());
            }
        } else {
            ui.showToast(`Inventory full! Need ${newVines.width}x${newVines.height} space`, 'warning');
            ui.updateInventoryFullStatus(true);
        }

        // Start cooldown (reuse ResourceManager's cooldown system)
        this.resourceManager.startHarvestCooldown();
    }

    /**
     * Get vines quality for current chunk
     * @param {string} chunkId - Chunk identifier (e.g., "chunk_0,0")
     * @returns {number} - Vines quality (1-100)
     */
    getVinesQuality(chunkId) {
        // TODO: Retrieve vines quality from chunk data
    }

    /**
     * Check if mushroom button should appear (10% chance)
     * Called when player stops on grass
     * @returns {boolean} - True if mushroom button should appear
     */
    rollForMushroom() {
        return Math.random() < 0.10; // 10% chance
    }

    /**
     * Gather mushroom instantly (no progress bar)
     * Called when player clicks "Gather Mushroom" button
     */
    gatherMushroom() {
        if (!this.game || !this.game.playerObject) {
            console.error('GrassGathering: Cannot gather mushroom - game or player not available');
            return;
        }

        // Get player position
        const playerX = this.game.playerObject.position.x;
        const playerZ = this.game.playerObject.position.z;

        // Get chunk coordinates and mushroom quality
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(playerX, playerZ);
        const worldSeed = TERRAIN_CONFIG.TERRAIN.seed;
        const mushroomQuality = QualityGenerator.getQuality(worldSeed, chunkX, chunkZ, 'mushroom');

        // Create mushroom item (1x1 size)
        const newMushroom = {
            id: `mushroom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'mushroom',
            x: -1, // Will be set when finding space in inventory
            y: -1,
            width: 1,
            height: 1,
            rotation: 0,
            quality: mushroomQuality,
            durability: 10 * (mushroomQuality / 100) // Base durability 10, scaled by quality
        };

        // Try to add to inventory
        if (this.game.tryAddItemToInventory(newMushroom)) {
            ui.updateActionStatus(`Gathered mushroom! (Quality: ${mushroomQuality})`, 3000);

            // Re-render inventory if open
            if (this.gameState.inventoryOpen) {
                this.inventoryUI.renderInventory();
            }
            // Update inventory full status indicator
            if (this.game?.playerInventory) {
                ui.updateInventoryFullStatus(this.game.playerInventory.isFull());
            }
        } else {
            ui.showToast(`Inventory full! Need ${newMushroom.width}x${newMushroom.height} space`, 'warning');
            ui.updateInventoryFullStatus(true);
        }
    }

    /**
     * Check if vegetable seeds button should appear (2.5% chance)
     * Called when player stops on grass (independent from mushroom roll)
     * @returns {boolean} - True if vegetable seeds button should appear
     */
    rollForVegetableSeeds() {
        return Math.random() < 0.025; // 2.5% chance
    }

    /**
     * Gather vegetable seeds instantly (no progress bar)
     * Called when player clicks "Gather Vegetable Seeds" button
     */
    gatherVegetableSeeds() {
        if (!this.game || !this.game.playerObject) {
            console.error('GrassGathering: Cannot gather vegetable seeds - game or player not available');
            return;
        }

        // Get player position
        const playerX = this.game.playerObject.position.x;
        const playerZ = this.game.playerObject.position.z;

        // Get chunk coordinates and vegetable seeds quality
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(playerX, playerZ);
        const worldSeed = TERRAIN_CONFIG.TERRAIN.seed;
        const vegetableSeedsQuality = QualityGenerator.getQuality(worldSeed, chunkX, chunkZ, 'vegetableseeds');

        // Create vegetable seeds item (1x1 size)
        const newVegetableSeeds = {
            id: `vegetableseeds_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'vegetableseeds',
            x: -1, // Will be set when finding space in inventory
            y: -1,
            width: 1,
            height: 1,
            rotation: 0,
            quality: vegetableSeedsQuality,
            durability: 100 // Seeds don't decay
        };

        // Try to add to inventory
        if (this.game.tryAddItemToInventory(newVegetableSeeds)) {
            ui.updateActionStatus(`Gathered vegetable seeds! (Quality: ${vegetableSeedsQuality})`, 3000);

            // Re-render inventory if open
            if (this.gameState.inventoryOpen) {
                this.inventoryUI.renderInventory();
            }
            // Update inventory full status indicator
            if (this.game?.playerInventory) {
                ui.updateInventoryFullStatus(this.game.playerInventory.isFull());
            }
        } else {
            ui.showToast(`Inventory full! Need ${newVegetableSeeds.width}x${newVegetableSeeds.height} space`, 'warning');
            ui.updateInventoryFullStatus(true);
        }
    }

    /**
     * Start a timed gathering action for vegetables (6 seconds)
     * Called when player clicks "Gather Vegetables" button
     * @param {object} vegetableObject - The vegetable object being gathered
     */
    startGatherVegetablesAction(vegetableObject) {
        // Guard: Prevent starting new action if one is already in progress
        if (this.gameState.activeAction) {
            return;
        }

        if (!this.game || !this.game.playerObject) {
            console.error('GrassGathering: Cannot gather vegetables - game or player not available');
            return;
        }

        // Check if vegetables are still growing
        if (vegetableObject.isGrowing) {
            ui.showToast('Vegetables are still growing', 'warning');
            return;
        }

        // Check if cooldown is active
        if (this.gameState.harvestCooldown) {
            const remaining = this.gameState.harvestCooldown.endTime - Date.now();
            if (remaining > 0) {
                ui.updateStatus(`Rest needed: ${Math.ceil(remaining / 1000)}s`);
                return;
            } else {
                this.gameState.harvestCooldown = null;
            }
        }

        // Set active action for 6 seconds
        this.gameState.activeAction = {
            object: vegetableObject, // Store vegetable object for removal after completion
            startTime: Date.now(),
            duration: CONFIG.ACTIONS.BUILD_DURATION, // 6 seconds (same as building)
            actionType: 'gather_vegetables'
        };

        // Play vines gathering sound (reuse for vegetables)
        if (this.resourceManager.audioManager) {
            const sound = this.resourceManager.audioManager.playVinesSound();
            this.gameState.activeAction.sound = sound;
        }

        // Start chopping animation (reuse from ResourceManager)
        if (this.resourceManager.animationMixer && this.resourceManager.choppingAction) {
            if (this.game && this.game.animationAction) {
                this.game.animationAction.stop();
            }
            this.resourceManager.choppingAction.reset();
            this.resourceManager.choppingAction.play();
        }

        // Broadcast gathering action to peers
        this.networkManager.broadcastP2P({
            type: 'player_vines_gathering',
            payload: {
                startTime: Date.now(),
                duration: CONFIG.ACTIONS.BUILD_DURATION
            }
        });

        // Broadcast sound to peers
        this.networkManager.broadcastP2P({
            type: 'player_sound',
            payload: {
                soundType: 'vines',
                startTime: Date.now()
            }
        });

        ui.updateStatus('Gathering vegetables...');
    }

    /**
     * Complete vegetables gathering action and add item to inventory
     * Also removes the vegetable object from the world
     * @param {object} vegetableObject - The vegetable object to gather (passed from ActionManager)
     */
    completeGatherVegetablesAction(vegetableObject) {
        if (!this.game || !this.game.playerObject) {
            console.error('GrassGathering: Cannot complete - game or player not available');
            return;
        }

        if (!vegetableObject) {
            console.error('GrassGathering: No vegetable object provided');
            return;
        }

        // Get quality from vegetable object
        const vegetableQuality = vegetableObject.quality || 50;

        // Create vegetables item (1x1 size)
        const newVegetables = {
            id: `vegetables_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'vegetables',
            x: -1, // Will be set when finding space in inventory
            y: -1,
            width: 1,
            height: 1,
            rotation: 0,
            quality: vegetableQuality,
            durability: 20 * (vegetableQuality / 100) // Food durability scales with quality
        };

        // Try to add to inventory
        if (this.game.tryAddItemToInventory(newVegetables)) {
            ui.updateActionStatus(`Gathered vegetables! (Quality: ${vegetableQuality})`, 3000);

            // Re-render inventory if open
            if (this.gameState.inventoryOpen) {
                this.inventoryUI.renderInventory();
            }
            // Update inventory full status indicator
            if (this.game?.playerInventory) {
                ui.updateInventoryFullStatus(this.game.playerInventory.isFull());
            }

            // Send remove_object_request to remove the vegetable from the world
            // Ensure scale is properly formatted (might be Vector3 or plain object)
            const scaleValue = vegetableObject.scale?.toArray ? vegetableObject.scale.toArray() : vegetableObject.scale;
            this.networkManager.sendMessage('remove_object_request', {
                chunkId: `chunk_${vegetableObject.chunkKey}`,
                objectId: vegetableObject.id,
                name: vegetableObject.name,
                position: vegetableObject.position.toArray(),
                quality: vegetableObject.quality,
                scale: scaleValue,
                objectData: {
                    name: vegetableObject.name,
                    position: vegetableObject.position.toArray(),
                    quality: vegetableObject.quality,
                    scale: scaleValue
                },
                clientId: this.gameState.clientId,
                accountId: this.gameState.accountId || null
            });
        } else {
            ui.showToast(`Inventory full! Need ${newVegetables.width}x${newVegetables.height} space`, 'warning');
            ui.updateInventoryFullStatus(true);
        }
    }

    /**
     * Gather seeds from a tree instantly (no progress bar)
     * Called when player clicks "Gather [Tree] Seed" button
     * @param {string} treeType - Type of tree (oak, pine, fir, cypress, apple)
     * @param {object} treeObject - The tree object being gathered from
     */
    gatherSeeds(treeType, treeObject) {
        if (!this.game || !this.game.playerObject) {
            console.error('GrassGathering: Cannot gather seeds - game or player not available');
            return;
        }

        // Get tree quality from the tree object
        const treeQuality = treeObject.quality || 50;

        // Calculate seed quality: tree quality ± 10 (random), capped at 100
        const qualityVariation = Math.floor(Math.random() * 21) - 10; // Random -10 to +10
        const seedQuality = Math.min(100, Math.max(1, treeQuality + qualityVariation));

        // Create seed item (1x1 size)
        // Special case: vegetables uses 'vegetableseeds' (plural), other trees use '{type}seed'
        const seedType = treeType === 'vegetables' ? 'vegetableseeds' : `${treeType}seed`;
        const newSeed = {
            id: `${seedType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: seedType,
            x: -1, // Will be set when finding space in inventory
            y: -1,
            width: 1,
            height: 1,
            rotation: 0,
            quality: seedQuality,
            durability: 100 // Seeds don't decay
        };

        // Try to add to inventory
        if (this.game.tryAddItemToInventory(newSeed)) {
            const displayName = treeType === 'vegetables' ? 'vegetable seeds' : `${treeType} seed`;
            ui.updateActionStatus(`Gathered ${displayName}! (Quality: ${seedQuality})`, 3000);

            // Re-render inventory if open
            if (this.gameState.inventoryOpen) {
                this.inventoryUI.renderInventory();
            }
            // Update inventory full status indicator
            if (this.game?.playerInventory) {
                ui.updateInventoryFullStatus(this.game.playerInventory.isFull());
            }
        } else {
            ui.showToast(`Inventory full! Need ${newSeed.width}x${newSeed.height} space`, 'warning');
            ui.updateInventoryFullStatus(true);
        }
    }
}

/**
 * GrassGathering.js
 * Handles grass gathering mechanics:
 * - Detecting when player is standing on grass terrain
 * - Managing grass gathering actions (6 second duration)
 * - Creating grass inventory items with quality based on chunk
 */

import { CONFIG } from '../config.js';
import { CONFIG as TERRAIN_CONFIG } from '../terrain.js';
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

        // Reference to terrain renderer for chunk data access
        this.terrainRenderer = null;
    }

    /**
     * Set reference to main game instance
     * @param {Game} game - Main game instance
     */
    setGameReference(game) {
        this.game = game;
    }

    /**
     * Set reference to terrain renderer for chunk data access
     * @param {TerrainRenderer} terrainRenderer
     */
    setTerrainRenderer(terrainRenderer) {
        this.terrainRenderer = terrainRenderer;
    }

    /**
     * Detect if player is standing on grass terrain
     * @param {number} playerX - Player world X position
     * @param {number} playerZ - Player world Z position
     * @returns {object} - {onGrass: boolean, qualityRange: object|null, chunkId: string|null}
     */
    detectGrassUnderPlayer(playerX, playerZ) {
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

        // Player is on grass! Get quality range for this chunk
        const worldSeed = TERRAIN_CONFIG.TERRAIN.seed;
        const qualityRange = QualityGenerator.getGrassQualityRange(worldSeed, chunkX, chunkZ);

        return {
            onGrass: true,
            qualityRange: qualityRange, // { min, max, name }
            chunkId: chunkId
        };
    }

    /**
     * Check if player can gather grass right now
     * @returns {boolean} - True if gathering is allowed
     */
    canGatherGrass() {
        // TODO: Check cooldown, active actions, movement state
    }

    /**
     * Start grass gathering action (6 second duration)
     */
    startGatheringAction() {
        // Check if cooldown is active
        if (this.gameState.harvestCooldown) {
            const remaining = this.gameState.harvestCooldown.endTime - Date.now();
            if (remaining > 0) {
                ui.updateStatus(`⏳ Rest needed: ${Math.ceil(remaining / 1000)}s`);
                return;
            } else {
                this.gameState.harvestCooldown = null;
            }
        }

        // Set active action for 6 seconds
        this.gameState.activeAction = {
            object: null, // No world object for grass gathering
            startTime: Date.now(),
            duration: CONFIG.ACTIONS.BUILD_DURATION, // 6 seconds (same as building)
            actionType: 'gather_grass'
        };

        // Play grass gathering sound
        if (this.resourceManager.audioManager) {
            const sound = this.resourceManager.audioManager.playGrassSound();
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

        // Broadcast grass gathering action to peers
        this.networkManager.broadcastP2P({
            type: 'player_grass_gathering',
            payload: {
                startTime: Date.now(),
                duration: CONFIG.ACTIONS.BUILD_DURATION
            }
        });

        // Broadcast sound to peers
        this.networkManager.broadcastP2P({
            type: 'player_sound',
            payload: {
                soundType: 'grass',
                startTime: Date.now()
            }
        });

        ui.updateStatus('🌾 Gathering grass...');
    }

    /**
     * Complete grass gathering action and add item to inventory
     */
    completeGatheringAction() {
        if (!this.game || !this.game.playerObject) {
            console.error('GrassGathering: Cannot complete - game or player not available');
            return;
        }

        // Get player position
        const playerX = this.game.playerObject.position.x;
        const playerZ = this.game.playerObject.position.z;

        // Get chunk coordinates and grass quality
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(playerX, playerZ);
        const worldSeed = TERRAIN_CONFIG.TERRAIN.seed;
        const grassQuality = QualityGenerator.getGrassQuality(worldSeed, chunkX, chunkZ);

        // Create grass item (1x1 size)
        const newGrass = {
            id: `grass_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'grass',
            x: -1, // Will be set when finding space in inventory
            y: -1,
            width: 1,
            height: 1,
            rotation: 0,
            quality: grassQuality,
            durability: 100 // Grass starts at full durability
        };

        // Try to add to inventory
        if (this.game.tryAddItemToInventory(newGrass)) {
            ui.updateStatusLine1(`✅ Gathered grass (Q${grassQuality})`, 2000);

            // Re-render inventory if open
            if (this.gameState.inventoryOpen) {
                this.inventoryUI.renderInventory();
            }
        } else {
            ui.updateStatusLine1('⚠️ Inventory full!', 3000);
        }

        // Start cooldown (reuse ResourceManager's cooldown system)
        this.resourceManager.startHarvestCooldown();
    }

    /**
     * Get grass quality for current chunk
     * @param {string} chunkId - Chunk identifier (e.g., "chunk_0,0")
     * @returns {number} - Grass quality (1-100)
     */
    getGrassQuality(chunkId) {
        // TODO: Retrieve grass quality from chunk data
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
        const mushroomQuality = QualityGenerator.getMushroomQuality(worldSeed, chunkX, chunkZ);

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
            durability: 5 * (mushroomQuality / 100) // Base durability 5, scaled by quality
        };

        // Try to add to inventory
        if (this.game.tryAddItemToInventory(newMushroom)) {
            ui.updateStatusLine1(`✅ Gathered mushroom (Q${mushroomQuality})`, 2000);

            // Re-render inventory if open
            if (this.gameState.inventoryOpen) {
                this.inventoryUI.renderInventory();
            }
        } else {
            ui.updateStatusLine1('⚠️ Inventory full!', 3000);
        }
    }
}

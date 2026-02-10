/**
 * LoadingScreen.js
 * Multi-phase loading overlay that covers the entire load sequence:
 * 1. Connecting to server
 * 2. Connected (waiting for auth)
 * 3. Loading chunks after spawn
 */

import ChunkCoordinates from '../core/ChunkCoordinates.js';
import { CONFIG } from '../config.js';

export class LoadingScreen {
    constructor(game) {
        this.game = game;
        this.overlay = null;
        this.titleElement = null;
        this.progressBar = null;
        this.progressText = null;
        this.chunksLoaded = 0;
        // Calculate total chunks from LOAD_RADIUS config (21x21 = 441 for radius 10)
        const loadRadius = CONFIG.CHUNKS?.LOAD_RADIUS || 10;
        this.totalChunks = (loadRadius * 2 + 1) * (loadRadius * 2 + 1);
        this.isActive = true;  // Start active since visible by default in HTML
        this.currentPhase = 'connecting';  // connecting, connected, loading
        this.safetyTimeout = null; // Fallback timeout to prevent infinite loading
        this.loadingStartTime = null; // Track when loading started
        this.retryButton = null; // Retry button for connection errors
    }

    /**
     * Initialize DOM references (called after DOM ready)
     */
    initialize() {
        this.overlay = document.getElementById('loadingScreenOverlay');
        this.titleElement = document.getElementById('loadingScreenTitle');
        this.progressBar = document.getElementById('loadingProgressBar');
        this.progressText = document.getElementById('loadingProgressText');
        this.preSpawnLinks = document.getElementById('preSpawnLinks');
        this.spawnTip = document.getElementById('loadingSpawnTip');

        if (!this.overlay) {
            console.error('[LoadingScreen] DOM elements not found');
        }
    }

    /**
     * Show or hide the spawn protection tip (only relevant for random spawns)
     * @param {boolean} show - Whether to show the tip
     */
    showSpawnTip(show) {
        if (this.spawnTip) {
            this.spawnTip.style.display = show ? 'block' : 'none';
        }
    }

    /**
     * Phase 1: Connecting to server
     * Called on initial page load
     */
    setConnecting() {
        this.currentPhase = 'connecting';
        this.isActive = true;
        if (this.titleElement) this.titleElement.textContent = 'CONNECTING';
        if (this.progressText) this.progressText.textContent = 'Connecting to server...';
        if (this.progressBar) this.progressBar.style.width = '0%';
    }

    /**
     * Phase 2: Connected, waiting for auth
     * Called after WebSocket connection established
     */
    setConnected() {
        this.currentPhase = 'connected';
        this.isActive = true;
        if (this.titleElement) this.titleElement.textContent = 'CONNECTED';
        if (this.progressText) this.progressText.textContent = 'Please log in or register';
        if (this.progressBar) this.progressBar.style.width = '10%';
    }

    /**
     * Set arbitrary status during initialization phase
     * Used for progressive loading feedback before chunk loading starts
     * @param {string} text - Status text to display
     * @param {number} percent - Progress percentage (0-100), capped at 10% during init
     */
    setStatus(text, percent = 5) {
        this.currentPhase = 'initializing';
        this.isActive = true;
        if (this.titleElement) this.titleElement.textContent = 'LOADING WORLD';
        if (this.progressText) this.progressText.textContent = text;
        // Cap at 10% since chunk loading takes 10-100%
        if (this.progressBar) this.progressBar.style.width = `${Math.min(percent, 10)}%`;
    }

    /**
     * Phase 3: Loading chunks
     * Called after spawn location selected
     */
    setLoadingChunks() {
        this.currentPhase = 'loading';
        this.isActive = true;
        this.loadingStartTime = Date.now();
        if (this.titleElement) this.titleElement.textContent = 'LOADING WORLD';

        // Hide pre-spawn links once player has clicked to spawn
        if (this.preSpawnLinks) {
            this.preSpawnLinks.style.display = 'none';
        }

        // Calculate how many chunks actually need loading vs already exist
        this.calculateChunkProgress();

        // Disable input during chunk loading
        if (this.game) {
            this.game.inputEnabled = false;
        }

        // Clear any existing safety timeout
        if (this.safetyTimeout) {
            clearTimeout(this.safetyTimeout);
        }

        // Safety timeout: if loading takes longer than 90 seconds, force hide
        // This prevents infinite loading if chunks get stuck
        this.safetyTimeout = setTimeout(() => {
            if (this.currentPhase === 'loading' && this.isActive) {
                console.warn(`[LoadingScreen] Safety timeout triggered after 90s - loaded ${this.chunksLoaded}/${this.totalChunks} chunks`);
                this.hide();
            }
        }, 90000);

    }

    /**
     * Start polling for chunk loading progress
     */
    calculateChunkProgress() {
        // Calculate total from config
        const loadRadius = CONFIG.CHUNKS?.LOAD_RADIUS || 10;
        this.totalChunks = (loadRadius * 2 + 1) * (loadRadius * 2 + 1);
        this.chunksLoaded = 0;

        // Start polling for progress
        this.pollChunkProgress();
    }

    /**
     * Poll the actual loaded chunk count from ChunkObjectGenerator
     * Counts chunks where object generation has actually completed,
     * not just chunks that were created (which happens immediately)
     */
    pollChunkProgress() {
        if (this.currentPhase !== 'loading') return;

        // Count chunks where object generation has actually finished
        if (this.game && this.game.chunkObjectGenerator && this.game.playerObject) {
            const playerPos = this.game.playerObject.position;
            const completedChunks = this.game.chunkObjectGenerator.completedChunks;
            const loadRadius = CONFIG.CHUNKS?.LOAD_RADIUS || 10;

            if (completedChunks) {
                const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(playerPos.x, playerPos.z);

                let count = 0;
                for (let x = -loadRadius; x <= loadRadius; x++) {
                    for (let z = -loadRadius; z <= loadRadius; z++) {
                        const key = `${chunkX + x},${chunkZ + z}`;
                        if (completedChunks.has(key)) {
                            count++;
                        }
                    }
                }
                this.chunksLoaded = count;
            }
        }

        this.updateChunkProgress();

        // Check if done
        const generator = this.game?.chunkObjectGenerator;
        const queueEmpty = generator && !generator.isProcessing && generator.queue?.length === 0;

        if (this.chunksLoaded >= this.totalChunks && queueEmpty) {
            if (this.progressBar) this.progressBar.style.width = '100%';
            if (this.progressText) this.progressText.textContent = 'Ready!';
            setTimeout(() => this.hide(), 100);
        } else {
            // Keep polling
            requestAnimationFrame(() => this.pollChunkProgress());
        }
    }

    /**
     * Called when a chunk finishes loading (from ChunkManager callback)
     * Now just triggers a poll update for immediate feedback
     */
    onChunkLoaded() {
        // Polling handles the actual count, but we can trigger an immediate update
        if (this.currentPhase === 'loading') {
            this.pollChunkProgress();
        }
    }

    /**
     * Update progress bar based on chunks loaded
     */
    updateChunkProgress() {
        const percent = 10 + (this.chunksLoaded / this.totalChunks) * 90;
        if (this.progressBar) this.progressBar.style.width = `${percent}%`;
        if (this.progressText) {
            this.progressText.textContent = `Loading chunks: ${this.chunksLoaded}/${this.totalChunks}`;
        }
    }

    /**
     * Show loading screen (used for respawn)
     */
    show() {
        if (!this.overlay) return;
        this.isActive = true;
        this.overlay.style.display = 'flex';
    }

    /**
     * Hide loading screen and enable input
     */
    hide() {
        if (!this.overlay) return;

        this.isActive = false;
        this.currentPhase = 'done';  // Stop polling loop
        this.overlay.style.display = 'none';

        // Hide spawn tip
        this.showSpawnTip(false);



        // Clear safety timeout since loading completed
        if (this.safetyTimeout) {
            clearTimeout(this.safetyTimeout);
            this.safetyTimeout = null;
        }

        // Reset loading start time
        if (this.loadingStartTime) {
            this.loadingStartTime = null;
        }

        // Initialize navigation maps and physics colliders for the 3x3 grid around player
        if (this.game && this.game.chunkManager && this.game.playerObject) {
            const playerPos = this.game.playerObject.position;
            const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(playerPos.x, playerPos.z);
            this.game.chunkManager.initializeNavMapsAroundPlayer(chunkX, chunkZ);
            // Ensure all objects in physics radius have colliders for interaction
            this.game.chunkManager.initializePhysicsCollidersAroundPlayer(chunkX, chunkZ);
            // Build initial chunk border marker posts
            if (this.game.chunkBorderMarkerSystem) {
                this.game.chunkBorderMarkerSystem.rebuild(chunkX, chunkZ);
            }
        }

        // Re-enable game input
        if (this.game) {
            this.game.inputEnabled = true;
        }

    }

    /**
     * Show permanent connection error (for banned players - generic message)
     */
    showConnectionError() {
        if (!this.overlay) return;

        this.isActive = true;
        this.currentPhase = 'error';
        this.overlay.style.display = 'flex';

        if (this.titleElement) this.titleElement.textContent = 'CONNECTION FAILED';
        if (this.progressText) this.progressText.textContent = 'Unable to connect to server. Please try again later.';
        // Hide the progress bar container (parent of progressBar) to remove the empty bar outline
        if (this.progressBar?.parentElement) {
            this.progressBar.parentElement.style.display = 'none';
        }

        // Add retry button if not already present
        if (!this.retryButton) {
            this.retryButton = document.createElement('button');
            this.retryButton.textContent = 'Retry';
            this.retryButton.className = 'connection-retry-btn';
            this.retryButton.style.cssText = 'margin-top: 20px; padding: 10px 30px; font-size: 16px; cursor: pointer; background: #4a4a4a; color: white; border: none; border-radius: 4px;';
            this.retryButton.onclick = () => location.reload();
            // Append to loading-screen-content (parent of titleElement)
            if (this.titleElement?.parentElement) {
                this.titleElement.parentElement.appendChild(this.retryButton);
            }
        }
        this.retryButton.style.display = 'block';

        // Clear safety timeout since we're in permanent error state
        if (this.safetyTimeout) {
            clearTimeout(this.safetyTimeout);
            this.safetyTimeout = null;
        }
    }

    /**
     * Check if loading screen is currently visible
     */
    isOpen() {
        return this.isActive;
    }
}

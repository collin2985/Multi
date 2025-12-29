/**
 * TickManager.js - Deterministic tick synchronization for P2P simulation
 *
 * Receives authoritative tick from server, buffers player positions by tick,
 * and provides delayed position data for deterministic AI simulation.
 *
 * All clients use the same tick number and position buffer, so AI decisions
 * are identical across all clients without ownership or authority.
 */

export class TickManager {
    constructor() {
        // Current server tick (updated when we receive tick message)
        this.currentTick = 0;

        // Position buffer: tick -> Map<playerId, {x, y, z}>
        // Stores snapshots of all player positions at each tick
        this.positionBuffer = new Map();

        // How many ticks behind to simulate (1 second delay at 1 tick/sec)
        this.simulationDelay = 1;

        // How many ticks to keep in buffer (cleanup older ones)
        this.bufferSize = 20;

        // PERFORMANCE: Pool of reusable Maps to avoid GC
        this._mapPool = [];

        // Callbacks for getting current positions
        this.getLocalPlayerPosition = null;
        this.getPeerPositions = null;
        this.localPlayerId = null;

        // Track if we've received first tick (for initialization)
        this.initialized = false;
    }

    /**
     * Initialize with position getter callbacks
     * @param {object} config
     * @param {string} config.localPlayerId - Our client ID
     * @param {function} config.getLocalPlayerPosition - () => {x, y, z} or null
     * @param {function} config.getPeerPositions - () => Map<peerId, {x, y, z}>
     */
    initialize(config) {
        this.localPlayerId = config.localPlayerId;
        this.getLocalPlayerPosition = config.getLocalPlayerPosition;
        this.getPeerPositions = config.getPeerPositions;

        // Initialization complete
    }

    /**
     * Called when we receive a tick message from server
     * Captures current positions and stores them in buffer
     * @param {number} tick - Server tick number
     */
    onServerTick(tick) {
        this.currentTick = tick;

        if (!this.initialized) {
            this.initialized = true;
        }

        // Capture positions at this tick
        this._capturePositions(tick);

        // Cleanup old ticks
        this._cleanupOldTicks(tick);
    }

    /**
     * Capture all known player positions for a tick
     * PERFORMANCE: Reuses Maps from pool to reduce GC pressure
     * @private
     */
    _capturePositions(tick) {
        // Get a Map from pool or create new one
        const positions = this._mapPool.pop() || new Map();
        positions.clear(); // Ensure it's empty if reused

        // Capture local player position
        if (this.getLocalPlayerPosition && this.localPlayerId) {
            const localPos = this.getLocalPlayerPosition();
            if (localPos) {
                positions.set(this.localPlayerId, {
                    x: localPos.x,
                    y: localPos.y,
                    z: localPos.z
                });
            }
        }

        // Capture peer positions
        if (this.getPeerPositions) {
            const peerPositions = this.getPeerPositions();
            if (peerPositions) {
                for (const [peerId, pos] of peerPositions) {
                    if (pos) {
                        positions.set(peerId, {
                            x: pos.x,
                            y: pos.y,
                            z: pos.z
                        });
                    }
                }
            }
        }

        this.positionBuffer.set(tick, positions);
    }

    /**
     * Remove old ticks from buffer to prevent memory growth
     * PERFORMANCE: Returns old Maps to pool for reuse
     * @private
     */
    _cleanupOldTicks(currentTick) {
        const oldestToKeep = currentTick - this.bufferSize;

        for (const tick of this.positionBuffer.keys()) {
            if (tick < oldestToKeep) {
                // Return Map to pool for reuse
                const oldMap = this.positionBuffer.get(tick);
                if (oldMap) {
                    this._mapPool.push(oldMap);
                }
                this.positionBuffer.delete(tick);
            }
        }
    }

    /**
     * Get the tick to use for simulation (current - delay)
     * @returns {number} Simulation tick
     */
    getSimulationTick() {
        return Math.max(0, this.currentTick - this.simulationDelay);
    }

    /**
     * Get player positions at a specific tick
     * @param {number} tick - Tick to get positions for
     * @returns {Map<playerId, {x, y, z}>} Position map, or empty map if not found
     */
    getPositionsAtTick(tick) {
        return this.positionBuffer.get(tick) || new Map();
    }

    /**
     * Get player positions for simulation (delayed)
     * This is the main method BanditController should use
     * @returns {Map<playerId, {x, y, z}>} Position map for simulation
     */
    getSimulationPositions() {
        const simTick = this.getSimulationTick();
        return this.getPositionsAtTick(simTick);
    }

    /**
     * Get a specific player's position at simulation tick
     * @param {string} playerId - Player ID to look up
     * @returns {{x, y, z}|null} Position or null if not found
     */
    getPlayerSimulationPosition(playerId) {
        const positions = this.getSimulationPositions();
        return positions.get(playerId) || null;
    }

    /**
     * Get all player IDs that were present at simulation tick
     * @returns {Set<string>} Set of player IDs
     */
    getSimulationPlayerIds() {
        const positions = this.getSimulationPositions();
        return new Set(positions.keys());
    }

    /**
     * Check if we have position data for simulation
     * (might not if we just connected and buffer isn't filled yet)
     * @returns {boolean} True if we have data to simulate with
     */
    hasSimulationData() {
        const simTick = this.getSimulationTick();
        return this.positionBuffer.has(simTick);
    }

    /**
     * Get current server tick (for display/debug)
     * @returns {number}
     */
    getCurrentTick() {
        return this.currentTick;
    }

    /**
     * Check if tick system is initialized (received first tick)
     * @returns {boolean}
     */
    isInitialized() {
        return this.initialized;
    }
}

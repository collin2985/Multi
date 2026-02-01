/**
 * InventorySyncSystem.js
 * Provides sendSync() for explicit save-and-exit flow.
 * No auto-sync, no periodic timers, no beforeunload.
 * The only way to save is via the SaveExitOverlay countdown.
 */

export class InventorySyncSystem {
    constructor(gameState, networkManager) {
        this.gameState = gameState;
        this.networkManager = networkManager;
    }

    /** No-op (API compatibility) */
    start() {}

    /** No-op (API compatibility) */
    stop() {}

    /**
     * Check if player state can be safely saved
     * @returns {boolean}
     */
    canSaveState() {
        const game = window.game;
        const gs = this.gameState;

        // Don't save if game/player not ready yet
        if (!game || !game.playerObject) return false;

        // Don't save if dead
        if (game.isDead) return false;

        // Don't save during vehicle transitions
        const vs = gs.vehicleState;
        if (vs && vs.phaseManager) {
            const phase = vs.phaseManager.phase;
            if (phase === 'boarding' || phase === 'disembarking') return false;
        }

        // Don't save while climbing outpost
        if (gs.climbingState && gs.climbingState.isClimbing) return false;

        // Don't save during pending horse sale
        if (gs.hasPendingHorseSale) return false;

        return true;
    }

    /**
     * Check if player is currently on a water vehicle
     * @returns {boolean}
     */
    isOnWaterVehicle() {
        const vs = this.gameState.vehicleState;
        const waterVehicleTypes = ['boat', 'sailboat', 'ship2'];

        if (vs && typeof vs.isActive === 'function' && vs.isActive()) {
            return waterVehicleTypes.includes(vs.pilotingEntityType);
        }

        return false;
    }

    /**
     * Send sync message to server
     */
    sendSync() {
        const pos = window.game.playerObject.position;
        const isOnWaterVehicle = this.isOnWaterVehicle();

        this.networkManager.sendMessage('sync_player_state', {
            inventory: this.gameState.inventory.items,
            slingItem: this.gameState.slingItem || null,
            position: { x: pos.x, y: pos.y, z: pos.z },
            wasOnWaterVehicle: isOnWaterVehicle
        });
    }
}

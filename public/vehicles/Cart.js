/**
 * Cart - Towable cart entity
 *
 * Can be towed by player on foot or mounted on horse.
 * Has speed penalties based on whether cargo is loaded.
 */

import { TowedEntity } from './TowedEntity.js';
import { CONFIG } from '../config.js';

export class Cart extends TowedEntity {
    constructor() {
        super('cart');
    }

    /**
     * Get cart-specific physics config
     */
    getConfig() {
        // Use new consolidated config if available, fall back to legacy
        if (CONFIG.TOWED_ENTITIES?.cart) {
            return {
                ...CONFIG.TOWED_ENTITIES.SHARED,
                ...CONFIG.TOWED_ENTITIES.cart
            };
        }

        // Legacy config fallback
        const legacy = CONFIG.CART_PHYSICS || {};
        return {
            HITCH_OFFSET: legacy.HITCH_OFFSET ?? 0.4,
            TETHER_LENGTH: legacy.TETHER_LENGTH ?? 0.3,
            SPEED: legacy.CART_SPEED ?? 2.5,
            PIVOT_SPEED: legacy.PIVOT_SPEED ?? 0.08,
            MIN_MOVE_THRESHOLD: legacy.MIN_MOVE_THRESHOLD ?? 0.01,
            MIN_DISTANCE_EPSILON: legacy.MIN_DISTANCE_EPSILON ?? 0.001,
            MAX_SAFE_ANGLE: legacy.MAX_SAFE_ANGLE ?? Math.PI * 0.35,
            DANGER_ANGLE: legacy.DANGER_ANGLE ?? Math.PI * 0.5,
            EMERGENCY_PIVOT_SPEED: legacy.EMERGENCY_PIVOT_SPEED ?? 0.3,
            BROADCAST_INTERVAL: legacy.BROADCAST_INTERVAL ?? 150,
            // Speed multipliers
            EMPTY_SPEED_MULTIPLIER: legacy.EMPTY_CART_SPEED_MULTIPLIER ?? 0.9,
            LOADED_SPEED_MULTIPLIER: legacy.LOADED_CART_SPEED_MULTIPLIER ?? 0.5,
            MOUNTED_LOADED_SPEED_MULTIPLIER: legacy.MOUNTED_LOADED_CART_SPEED_MULTIPLIER ?? 0.667,
            // Turn rate
            TURN_RATE_MULTIPLIER: legacy.MOUNTED_TURN_RATE_MULTIPLIER ?? 0.6
        };
    }

    /**
     * Cart can be attached by player on foot or mounted on horse
     */
    canAttach(gameState) {
        // Can always attach cart (foot or mounted)
        return true;
    }

    /**
     * Get speed multiplier when towing cart
     * @param {boolean} hasLoadedCargo - Whether crate is loaded on cart
     * @param {boolean} isMounted - Whether player is on horse
     */
    getSpeedMultiplier(hasLoadedCargo = false, isMounted = false) {
        const config = this.getConfig();

        if (hasLoadedCargo) {
            // Loaded cart - different multipliers for foot vs mounted
            return isMounted
                ? (config.MOUNTED_LOADED_SPEED_MULTIPLIER ?? 0.667)
                : (config.LOADED_SPEED_MULTIPLIER ?? 0.5);
        }

        // Empty cart - same multiplier for both
        return config.EMPTY_SPEED_MULTIPLIER ?? 0.9;
    }

    /**
     * Get turn rate multiplier when towing cart
     */
    getTurnRateMultiplier() {
        const config = this.getConfig();
        return config.TURN_RATE_MULTIPLIER ?? 0.6;
    }
}

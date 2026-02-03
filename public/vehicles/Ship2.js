/**
 * Ship2.js
 * Large cargo/war ship - slowest but can carry cargo
 *
 * Extends WaterVehicle with ship2-specific configuration.
 * Cargo state is managed by VehicleState (not this class).
 */

import { WaterVehicle } from './WaterVehicle.js';
import { CONFIG } from '../config.js';

export class Ship2 extends WaterVehicle {
    constructor() {
        super('ship2', CONFIG.VEHICLES.ship2);
    }
}

/**
 * Sailboat.js
 * Medium sailing vessel - faster than boat, needs deeper water
 *
 * Thin wrapper around WaterVehicle with sailboat-specific config.
 */

import { WaterVehicle } from './WaterVehicle.js';
import { CONFIG } from '../config.js';

export class Sailboat extends WaterVehicle {
    constructor() {
        super('sailboat', CONFIG.VEHICLES.sailboat);
    }
}

/**
 * Boat.js
 * Small rowboat - basic water vehicle
 *
 * Thin wrapper around WaterVehicle with boat-specific config.
 */

import { WaterVehicle } from './WaterVehicle.js';
import { CONFIG } from '../config.js';

export class Boat extends WaterVehicle {
    constructor() {
        super('boat', CONFIG.VEHICLES.boat);
    }
}

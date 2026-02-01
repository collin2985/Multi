/**
 * Vehicle System Exports
 *
 * Unified vehicle/towing system for the game.
 */

// Unified state management (Phase 7)
export { VehicleState } from './VehicleState.js';

// Phase state machine
export { VehiclePhase, VehiclePhaseManager } from './VehiclePhase.js';

// Pilotable vehicle classes - base
export { BaseVehicle } from './BaseVehicle.js';
export { WaterVehicle } from './WaterVehicle.js';
export { LandVehicle } from './LandVehicle.js';

// Pilotable vehicle classes - concrete
export { Boat } from './Boat.js';
export { Sailboat } from './Sailboat.js';
export { Ship2 } from './Ship2.js';
export { Horse } from './Horse.js';

// Towed entities (cart, artillery)
export { TowedEntity } from './TowedEntity.js';
export { Cart } from './Cart.js';
export { Artillery } from './Artillery.js';

// Cargo loading (crates on carts/ships)
export { Cargo } from './Cargo.js';

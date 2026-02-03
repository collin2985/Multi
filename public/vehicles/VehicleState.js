/**
 * VehicleState.js - Unified vehicle state management
 *
 * Single source of truth for all vehicle-related state:
 * - Piloting (boats, horses)
 * - Towing (carts, artillery)
 * - Cargo (crates on carts/ships)
 * - Manning (artillery firing)
 * - Ship cargo (crates, artillery, horses on ships)
 *
 * Replaces: mobileEntityState, towedEntity, cargo, crateLoadState,
 *           mannedArtillery, artilleryShipLoadState, horseShipLoadState
 */

import { VehiclePhase, VehiclePhaseManager } from './VehiclePhase.js';
import { Cart } from './Cart.js';
import { Artillery } from './Artillery.js';
import { Cargo } from './Cargo.js';

export class VehicleState {
    constructor() {
        // === PHASE MANAGEMENT ===
        this._phaseManager = new VehiclePhaseManager();

        // === PILOTING STATE (boats, horses) ===
        this._piloting = {
            isActive: false,
            entity: null,
            entityId: null,
            entityType: null,
            quality: null,
            lastRepairTime: null,
            chunkKey: null,
            owner: null
        };

        // === TRANSITION STATE (boarding/disembarking animations) ===
        this._transition = {
            boardingStartTime: null,
            disembarkStartTime: null,
            originalPosition: null,
            targetPosition: null
        };

        // === SHIP MULTI-OCCUPANCY (ship2 only) ===
        this._shipOccupancy = {
            occupants: null,
            myPosition: null,
            faction: null
        };

        // === HORSE-SPECIFIC STATE ===
        this._horseAnimation = {
            mixer: null,
            walkAction: null
        };
        this._horseSale = {
            pending: false,
            data: null
        };
        this._horseSound = null;

        // === TOWING STATE (cart, artillery) ===
        this._towedEntity = null;

        // === CART CARGO STATE ===
        this._cartCargo = null;

        // === ARTILLERY MANNING STATE ===
        this._mannedArtillery = null;

        // === SHIP CARGO STATE ===
        this._shipCrates = [];
        this._shipArtillery = [];
        this._shipHorses = [];

        // === ACTIVE VEHICLE REFERENCE ===
        this._activeVehicle = null;
    }

    // ==========================================
    // PHASE ACCESSORS
    // ==========================================

    get phase() { return this._phaseManager.phase; }
    get phaseManager() { return this._phaseManager; }

    isIdle() { return this._phaseManager.isIdle(); }
    isBoarding() { return this._phaseManager.isBoarding(); }
    isPiloting() { return this._phaseManager.isPiloting(); }
    isCrewing() { return this._phaseManager.isCrewing(); }
    isDisembarking() { return this._phaseManager.isDisembarking(); }
    isActive() { return this._piloting.isActive; }

    // ==========================================
    // PILOTING ACCESSORS
    // ==========================================

    get pilotingEntity() { return this._piloting.entity; }
    get pilotingEntityId() { return this._piloting.entityId; }
    get pilotingEntityType() { return this._piloting.entityType; }
    get pilotingQuality() { return this._piloting.quality; }
    get pilotingLastRepairTime() { return this._piloting.lastRepairTime; }
    get pilotingChunkKey() { return this._piloting.chunkKey; }
    get pilotingOwner() { return this._piloting.owner; }

    isPilotingBoat() {
        return this._piloting.isActive && ['boat', 'sailboat', 'ship2'].includes(this._piloting.entityType);
    }

    isPilotingHorse() {
        return this._piloting.isActive && this._piloting.entityType === 'horse';
    }

    isPilotingShip() {
        return this._piloting.isActive && this._piloting.entityType === 'ship2';
    }

    // ==========================================
    // TRANSITION ACCESSORS
    // ==========================================

    get boardingStartTime() { return this._transition.boardingStartTime; }
    set boardingStartTime(val) { this._transition.boardingStartTime = val; }

    get disembarkStartTime() { return this._transition.disembarkStartTime; }
    set disembarkStartTime(val) { this._transition.disembarkStartTime = val; }

    get originalPosition() { return this._transition.originalPosition; }
    set originalPosition(val) { this._transition.originalPosition = val; }

    get targetPosition() { return this._transition.targetPosition; }
    set targetPosition(val) { this._transition.targetPosition = val; }

    // ==========================================
    // SHIP OCCUPANCY ACCESSORS
    // ==========================================

    get shipOccupants() { return this._shipOccupancy.occupants; }
    set shipOccupants(val) { this._shipOccupancy.occupants = val; }

    get myShipPosition() { return this._shipOccupancy.myPosition; }
    set myShipPosition(val) { this._shipOccupancy.myPosition = val; }

    get shipFaction() { return this._shipOccupancy.faction; }
    set shipFaction(val) { this._shipOccupancy.faction = val; }

    // ==========================================
    // HORSE ANIMATION ACCESSORS
    // ==========================================

    get horseMixer() { return this._horseAnimation.mixer; }
    set horseMixer(val) { this._horseAnimation.mixer = val; }

    get horseWalkAction() { return this._horseAnimation.walkAction; }
    set horseWalkAction(val) { this._horseAnimation.walkAction = val; }

    get horseSound() { return this._horseSound; }
    set horseSound(val) { this._horseSound = val; }

    // ==========================================
    // HORSE SALE ACCESSORS
    // ==========================================

    get hasPendingHorseSale() { return this._horseSale.pending; }
    get pendingHorseSaleData() { return this._horseSale.data; }

    setPendingHorseSale(data) {
        this._horseSale.pending = true;
        this._horseSale.data = data;
    }

    clearPendingHorseSale() {
        const data = this._horseSale.data;
        this._horseSale.pending = false;
        this._horseSale.data = null;
        return data;
    }

    // ==========================================
    // TOWING ACCESSORS
    // ==========================================

    get towedEntity() { return this._towedEntity; }

    isTowing() {
        return this._towedEntity?.isAttached === true;
    }

    isTowingCart() {
        return this._towedEntity?.isAttached && this._towedEntity?.type === 'cart';
    }

    isTowingArtillery() {
        return this._towedEntity?.isAttached && this._towedEntity?.type === 'artillery';
    }

    getTowedEntityId() {
        return this._towedEntity?.id || null;
    }

    // ==========================================
    // CART CARGO ACCESSORS
    // ==========================================

    get cartCargo() { return this._cartCargo; }

    hasCartCargo() {
        return this._cartCargo?.hasItems() === true;
    }

    // ==========================================
    // ARTILLERY MANNING ACCESSORS
    // ==========================================

    get mannedArtillery() { return this._mannedArtillery; }
    set mannedArtillery(val) { this._mannedArtillery = val; }

    isManningArtillery() {
        return this._mannedArtillery?.manningState?.isManning === true;
    }

    isManningShipArtillery() {
        return this.isManningArtillery() &&
               this._mannedArtillery?.manningState?.isShipMounted === true;
    }

    getMannedArtilleryId() {
        return this._mannedArtillery?.id || null;
    }

    // ==========================================
    // SHIP CARGO ACCESSORS
    // ==========================================

    get shipCrates() { return this._shipCrates; }
    get shipArtillery() { return this._shipArtillery; }
    get shipHorses() { return this._shipHorses; }

    // Aliases for migration (maps old names to new)
    get loadedCrates() { return this._shipCrates; }
    get loadedArtillery() { return this._shipArtillery; }
    get loadedHorses() { return this._shipHorses; }
    set loadedArtillery(val) { this._shipArtillery = val; }
    set loadedHorses(val) { this._shipHorses = val; }

    // Legacy single-crate properties (computed from array)
    get isLoaded() { return this._shipCrates.length > 0; }
    set isLoaded(val) { /* no-op - computed from array */ }
    get loadedCrate() {
        return this._shipCrates.length > 0 ? this._shipCrates[this._shipCrates.length - 1]?.crate : null;
    }
    set loadedCrate(val) { /* no-op - use addShipCrate */ }
    get crateId() {
        return this._shipCrates.length > 0 ? this._shipCrates[this._shipCrates.length - 1]?.crateId : null;
    }
    set crateId(val) { /* no-op - use addShipCrate */ }
    get crateChunkKey() {
        return this._shipCrates.length > 0 ? this._shipCrates[this._shipCrates.length - 1]?.crateChunkKey : null;
    }
    set crateChunkKey(val) { /* no-op */ }
    get crateQuality() {
        return this._shipCrates.length > 0 ? this._shipCrates[this._shipCrates.length - 1]?.crateQuality : null;
    }
    set crateQuality(val) { /* no-op */ }
    get crateLastRepairTime() {
        return this._shipCrates.length > 0 ? this._shipCrates[this._shipCrates.length - 1]?.crateLastRepairTime : null;
    }
    set crateLastRepairTime(val) { /* no-op */ }
    get crateInventory() {
        return this._shipCrates.length > 0 ? this._shipCrates[this._shipCrates.length - 1]?.crateInventory : null;
    }
    set crateInventory(val) { /* no-op */ }

    hasShipCargo() {
        return this._shipCrates.length > 0 ||
               this._shipArtillery.length > 0 ||
               this._shipHorses.length > 0;
    }

    getShipCrateCount() { return this._shipCrates.length; }
    getShipArtilleryCount() { return this._shipArtillery.length; }
    getShipHorseCount() { return this._shipHorses.length; }

    // ==========================================
    // ACTIVE VEHICLE ACCESSOR
    // ==========================================

    get activeVehicle() { return this._activeVehicle; }
    set activeVehicle(val) { this._activeVehicle = val; }

    // ==========================================
    // PILOTING OPERATIONS
    // ==========================================

    /**
     * Start boarding a vehicle
     * @param {THREE.Object3D} entity - Vehicle mesh
     * @param {string} entityId - Entity ID
     * @param {string} entityType - 'boat' | 'sailboat' | 'ship2' | 'horse'
     * @param {object} options - { quality, lastRepairTime, chunkKey, owner, originalPosition }
     * @returns {boolean} - Success
     */
    startBoarding(entity, entityId, entityType, options = {}) {
        if (!this._phaseManager.transitionTo(VehiclePhase.BOARDING, `board ${entityType}`)) {
            return false;
        }

        this._piloting = {
            isActive: true,
            entity,
            entityId,
            entityType,
            quality: options.quality ?? null,
            lastRepairTime: options.lastRepairTime ?? null,
            chunkKey: options.chunkKey ?? null,
            owner: options.owner ?? null
        };

        this._transition.boardingStartTime = performance.now();
        this._transition.originalPosition = options.originalPosition?.clone() ?? null;

        return true;
    }

    /**
     * Complete boarding and start piloting
     * @returns {boolean} - Success
     */
    completeBoardingToPiloting() {
        if (!this._phaseManager.transitionTo(VehiclePhase.PILOTING, 'boarding complete')) {
            return false;
        }

        this._transition.boardingStartTime = null;
        return true;
    }

    /**
     * Start disembarking
     * @param {object} options - { targetPosition }
     * @returns {boolean} - Success
     */
    startDisembarking(options = {}) {
        const reason = this.isCrewing() ? 'crew disembark' : 'pilot disembark';
        if (!this._phaseManager.transitionTo(VehiclePhase.DISEMBARKING, reason)) {
            return false;
        }

        this._transition.disembarkStartTime = performance.now();
        this._transition.targetPosition = options.targetPosition ?? null;

        return true;
    }

    /**
     * Complete disembarking and return to idle
     * @returns {object|null} - Released piloting data for server sync, or null if failed
     */
    completeDisembarking() {
        // Capture data before clearing
        const releasedData = {
            entityId: this._piloting.entityId,
            entityType: this._piloting.entityType,
            quality: this._piloting.quality,
            lastRepairTime: this._piloting.lastRepairTime,
            chunkKey: this._piloting.chunkKey,
            entity: this._piloting.entity
        };

        if (!this._phaseManager.transitionTo(VehiclePhase.IDLE, 'disembark complete')) {
            return null;
        }

        // Clear piloting state
        this._clearPilotingState();

        return releasedData;
    }

    /**
     * Transition from piloting to crewing (ship gunner position)
     * @param {string} position - 'portGunner' | 'starboardGunner'
     * @returns {boolean}
     */
    transitionToCrewPosition(position) {
        if (!this._phaseManager.transitionTo(VehiclePhase.CREWING, `crew ${position}`)) {
            return false;
        }

        this._shipOccupancy.myPosition = position;
        return true;
    }

    /**
     * Start crewing a ship (for external gunners boarding directly)
     * @param {THREE.Object3D} entity - Ship mesh
     * @param {string} entityId - Ship ID
     * @param {string} position - 'portGunner' | 'starboardGunner'
     * @returns {boolean} - Success
     */
    startCrewing(entity, entityId, position) {
        if (!this._phaseManager.transitionTo(VehiclePhase.CREWING, `crew ${position}`)) {
            return false;
        }

        this._piloting = {
            isActive: true,
            entity,
            entityId,
            entityType: 'ship2',
            quality: null,
            lastRepairTime: null,
            chunkKey: null,
            owner: null
        };

        this._shipOccupancy.myPosition = position;
        return true;
    }

    /**
     * Force reset to idle (for death, disconnect, etc.)
     * @param {string} reason - Debug reason
     */
    forceReset(reason = 'forced reset') {
        this._phaseManager.forceTransition(VehiclePhase.IDLE, reason);
        this._clearPilotingState();
        this._clearTowingState();
        this._clearManningState();
        this._clearShipCargoState();
    }

    // ==========================================
    // TOWING OPERATIONS
    // ==========================================

    /**
     * Attach a cart or artillery for towing
     * @param {'cart'|'artillery'} entityType
     * @param {THREE.Object3D} mesh
     * @param {string} id
     * @param {object} options - { chunkKey, quality, lastRepairTime }
     * @returns {Cart|Artillery|null} - The created entity, or null if failed
     */
    attachTowedEntity(entityType, mesh, id, options = {}) {
        // Validate: artillery requires mounted on horse
        if (entityType === 'artillery' && !this.isPilotingHorse()) {
            console.warn('[VehicleState] Cannot attach artillery: not mounted on horse');
            return null;
        }

        // Create appropriate towed entity
        const entity = entityType === 'artillery' ? new Artillery() : new Cart();

        entity.attach(
            mesh,
            id,
            options.chunkKey ?? null,
            options.quality ?? null,
            options.lastRepairTime ?? null
        );

        this._towedEntity = entity;
        return entity;
    }

    /**
     * Set towed entity directly (for existing entity)
     * @param {Cart|Artillery} entity
     */
    setTowedEntity(entity) {
        this._towedEntity = entity;
    }

    /**
     * Detach towed entity
     * @returns {object|null} - Release state for server sync
     */
    detachTowedEntity() {
        if (!this._towedEntity?.isAttached) {
            return null;
        }

        const releaseState = {
            entityType: this._towedEntity.type,
            entityId: this._towedEntity.id,
            mesh: this._towedEntity.mesh,
            chunkKey: this._towedEntity.chunkKey,
            quality: this._towedEntity.quality,
            lastRepairTime: this._towedEntity.lastRepairTime
        };

        this._towedEntity.detach();
        this._towedEntity = null;

        // Also clear cart cargo if detaching cart
        if (releaseState?.entityType === 'cart' && this._cartCargo) {
            this._cartCargo = null;
        }

        return releaseState;
    }

    /**
     * Clear towed entity without returning release state
     */
    clearTowedEntity() {
        if (this._towedEntity) {
            this._towedEntity.detach();
            this._towedEntity = null;
        }
        this._cartCargo = null;
    }

    // ==========================================
    // CART CARGO OPERATIONS
    // ==========================================

    /**
     * Set cart cargo directly
     * @param {Cargo} cargo
     */
    setCartCargo(cargo) {
        this._cartCargo = cargo;
    }

    /**
     * Clear cart cargo
     */
    clearCartCargo() {
        this._cartCargo = null;
    }

    // ==========================================
    // ARTILLERY MANNING OPERATIONS
    // ==========================================

    /**
     * Start manning an artillery piece
     * @param {Artillery} artillery - Artillery instance
     */
    setMannedArtillery(artillery) {
        this._mannedArtillery = artillery;
    }

    /**
     * Stop manning artillery
     * @returns {Artillery|null} - The manned artillery that was cleared
     */
    clearMannedArtillery() {
        const artillery = this._mannedArtillery;
        this._mannedArtillery = null;
        return artillery;
    }

    // ==========================================
    // SHIP CARGO OPERATIONS
    // ==========================================

    /**
     * Add a crate to ship cargo tracking
     * @param {object} crateData - { slotIndex, mesh, id, chunkKey, quality, lastRepairTime, inventory }
     */
    addShipCrate(crateData) {
        this._shipCrates.push(crateData);
    }

    /**
     * Remove a crate from ship cargo by slot index
     * @param {number} slotIndex
     * @returns {object|null} - The removed crate data
     */
    removeShipCrate(slotIndex) {
        const index = this._shipCrates.findIndex(c => c.slotIndex === slotIndex);
        if (index === -1) return null;
        return this._shipCrates.splice(index, 1)[0];
    }

    /**
     * Remove last crate from ship cargo
     * @returns {object|null} - The removed crate data
     */
    popShipCrate() {
        return this._shipCrates.pop() || null;
    }

    /**
     * Add artillery to ship cargo tracking
     * @param {object} artilleryData - { slotIndex, mesh, id, chunkKey, quality, lastRepairTime, side }
     */
    addShipArtillery(artilleryData) {
        this._shipArtillery.push(artilleryData);
    }

    /**
     * Remove artillery from ship cargo by slot index
     * @param {number} slotIndex
     * @returns {object|null}
     */
    removeShipArtillery(slotIndex) {
        const index = this._shipArtillery.findIndex(a => a.slotIndex === slotIndex);
        if (index === -1) return null;
        return this._shipArtillery.splice(index, 1)[0];
    }

    /**
     * Remove last artillery from ship cargo
     * @returns {object|null}
     */
    popShipArtillery() {
        return this._shipArtillery.pop() || null;
    }

    /**
     * Find ship artillery by ID
     * @param {string} artilleryId
     * @returns {object|null}
     */
    findShipArtilleryById(artilleryId) {
        return this._shipArtillery.find(a => a.id === artilleryId) || null;
    }

    /**
     * Add horse to ship cargo tracking
     * @param {object} horseData - { slotIndex, mesh, id, chunkKey, quality, lastRepairTime }
     */
    addShipHorse(horseData) {
        this._shipHorses.push(horseData);
    }

    /**
     * Remove horse from ship cargo by slot index
     * @param {number} slotIndex
     * @returns {object|null}
     */
    removeShipHorse(slotIndex) {
        const index = this._shipHorses.findIndex(h => h.slotIndex === slotIndex);
        if (index === -1) return null;
        return this._shipHorses.splice(index, 1)[0];
    }

    /**
     * Remove last horse from ship cargo
     * @returns {object|null}
     */
    popShipHorse() {
        return this._shipHorses.pop() || null;
    }

    /**
     * Clear all ship cargo
     */
    clearShipCargo() {
        this._shipCrates = [];
        this._shipArtillery = [];
        this._shipHorses = [];
    }

    // ==========================================
    // P2P SYNC METHODS
    // ==========================================

    /**
     * Get full state for P2P sync
     * @returns {object}
     */
    getState() {
        return {
            phase: this._phaseManager.phase,
            piloting: this._piloting.isActive ? {
                entityId: this._piloting.entityId,
                entityType: this._piloting.entityType,
                quality: this._piloting.quality
            } : null,
            towing: this._towedEntity?.isAttached ? {
                type: this._towedEntity.type,
                id: this._towedEntity.id
            } : null,
            manning: this._mannedArtillery?.manningState?.isManning ? {
                id: this._mannedArtillery.id,
                heading: this._mannedArtillery.manningState.heading
            } : null,
            shipCargo: this.hasShipCargo() ? {
                crates: this._shipCrates.map(c => ({ slotIndex: c.slotIndex, id: c.id })),
                artillery: this._shipArtillery.map(a => ({ slotIndex: a.slotIndex, id: a.id })),
                horses: this._shipHorses.map(h => ({ slotIndex: h.slotIndex, id: h.id }))
            } : null,
            shipOccupancy: this._shipOccupancy.occupants ? {
                occupants: this._shipOccupancy.occupants,
                myPosition: this._shipOccupancy.myPosition
            } : null
        };
    }

    // ==========================================
    // PRIVATE HELPERS
    // ==========================================

    _clearPilotingState() {
        this._piloting = {
            isActive: false,
            entity: null,
            entityId: null,
            entityType: null,
            quality: null,
            lastRepairTime: null,
            chunkKey: null,
            owner: null
        };

        this._transition = {
            boardingStartTime: null,
            disembarkStartTime: null,
            originalPosition: null,
            targetPosition: null
        };

        this._shipOccupancy = {
            occupants: null,
            myPosition: null,
            faction: null
        };

        this._clearHorseState();
        this._clearActiveVehicle();
    }

    _clearHorseState() {
        if (this._horseAnimation.mixer) {
            this._horseAnimation.mixer.stopAllAction();
        }
        this._horseAnimation.mixer = null;
        this._horseAnimation.walkAction = null;

        if (this._horseSound?.isPlaying) {
            this._horseSound.stop();
        }
        this._horseSound = null;

        this._horseSale.pending = false;
        this._horseSale.data = null;
    }

    _clearTowingState() {
        if (this._towedEntity) {
            this._towedEntity.detach();
            this._towedEntity = null;
        }
        this._cartCargo = null;
    }

    _clearManningState() {
        if (this._mannedArtillery?.manningState?.isManning) {
            this._mannedArtillery.stopManning();
        }
        this._mannedArtillery = null;
    }

    _clearShipCargoState() {
        this._shipCrates = [];
        this._shipArtillery = [];
        this._shipHorses = [];
    }

    _clearActiveVehicle() {
        if (this._activeVehicle) {
            this._activeVehicle.cleanup?.();
        }
        this._activeVehicle = null;
    }
}

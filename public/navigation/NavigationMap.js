/**
 * NavigationMap.js
 * Client-side navigation grid for AI pathfinding and spatial queries
 *
 * Stores per-chunk data about:
 * - Walkability (terrain, water, obstacles)
 * - Surface types (grass, dirt, rock, road)
 * - Movement costs (slope penalties, road bonuses)
 * - Object locations (for AI queries like "find nearest tree")
 */

// Grid cell bit flags (8 bits per cell)
export const NAV_FLAGS = Object.freeze({
    // Bit 0: Walkability
    WALKABLE: 0b00000001,

    // Bit 1: Road (increases movement speed)
    ROAD: 0b00000010,

    // Bit 2: Water (blocked or slow movement)
    WATER: 0b00000100,

    // Bit 3: Steep slope (>45 degrees, blocked)
    STEEP_SLOPE: 0b00001000,

    // Bits 4-5: Surface type (4 possible types)
    SURFACE_MASK: 0b00110000,
    SURFACE_GRASS: 0b00000000,  // 00
    SURFACE_DIRT: 0b00010000,   // 01
    SURFACE_ROCK: 0b00100000,   // 10
    SURFACE_SAND: 0b00110000,   // 11

    // Bit 6: Obstacle (structure/tree/rock blocking movement)
    OBSTACLE: 0b01000000,

    // Bit 7: Reserved for future use
    RESERVED: 0b10000000
});

// Surface type values for easier access
export const SURFACE_TYPE = Object.freeze({
    GRASS: 0,
    DIRT: 1,
    ROCK: 2,
    SAND: 3
});

// Movement speed multipliers for pathfinding cost calculation
export const MOVEMENT_SPEED = Object.freeze({
    // Surface type multipliers - all set to 1.0 (no terrain speed penalty)
    SURFACE: {
        GRASS: 1.0,
        DIRT: 1.0,
        SAND: 1.0,
        ROCK: 1.0
    },

    // Road bonus (faster movement on roads)
    ROAD: 1.6,  // 60% faster on roads

    // Note: Slope speed is calculated dynamically by getSlopeSpeedMultiplier()
    // - 0° slope = 1.0x speed (full speed)
    // - 45° slope = 0.25x speed (minimum)
    // - >45° slope = blocked (infinite cost)
});

// Grid configuration
export const NAV_CONFIG = Object.freeze({
    CHUNK_SIZE: 50,           // World units (matches terrain chunk size)
    GRID_RESOLUTION: 0.5,     // Meters per cell
    GRID_SIZE: 100,           // Cells per axis (50 / 0.5 = 100)
    TOTAL_CELLS: 10000,       // 100 * 100
    HEIGHT_SAMPLE_SIZE: 20    // Downsample height to 20x20 (saves memory)
});

/**
 * Navigation map for a single chunk
 * Provides spatial awareness for AI pathfinding and object queries
 */
export class ChunkNavigationMap {
    /**
     * @param {string} chunkId - Chunk identifier (e.g., "chunk_0,0")
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @param {PhysicsManager} physicsManager - Optional physics manager for spatial queries
     */
    constructor(chunkId, chunkX, chunkZ, physicsManager = null) {
        this.chunkId = chunkId;
        this.chunkX = chunkX;
        this.chunkZ = chunkZ;

        // World-space origin of this chunk (bottom-left corner)
        // Matches terrain.js chunk coordinate system (centered chunks)
        // Chunk (0,0) spans from (-25,-25) to (25,25)
        const chunkCenterX = chunkX * NAV_CONFIG.CHUNK_SIZE;
        const chunkCenterZ = chunkZ * NAV_CONFIG.CHUNK_SIZE;
        this.worldOriginX = chunkCenterX - NAV_CONFIG.CHUNK_SIZE / 2;
        this.worldOriginZ = chunkCenterZ - NAV_CONFIG.CHUNK_SIZE / 2;

        // Main navigation grid (100x100 cells, 0.5m resolution)
        // Each cell stores bit flags (walkable, surface type, road, etc.)
        this.grid = new Uint8Array(NAV_CONFIG.TOTAL_CELLS);

        // Height samples (downsampled to 20x20 for memory efficiency)
        // Used for slope calculations and smooth height queries
        this.heightSamples = new Float32Array(
            NAV_CONFIG.HEIGHT_SAMPLE_SIZE * NAV_CONFIG.HEIGHT_SAMPLE_SIZE
        );

        // Slope speed multipliers (100x100, pre-calculated for performance)
        // Stores the slope-based speed modifier for each cell (0.25 to 1.0)
        // This avoids expensive slope calculations during runtime movement
        this.slopeSpeedCache = new Float32Array(NAV_CONFIG.TOTAL_CELLS);

        // Object metadata for AI queries (lightweight - just quality/type data)
        // Positions come from PhysicsManager (source of truth)
        // Maps objectId → {type, quality, ...other metadata}
        this.objectMetadata = new Map();

        // Physics manager reference for spatial queries
        this.physicsManager = physicsManager;

        // Version number (incremented on updates, useful for cache invalidation)
        this.version = 0;
    }

    // ============================================================================
    // Grid Access Methods
    // ============================================================================

    /**
     * Convert world coordinates to grid cell coordinates
     * @param {number} worldX - World X position
     * @param {number} worldZ - World Z position
     * @returns {{cellX: number, cellZ: number}} Grid cell coordinates
     */
    worldToCell(worldX, worldZ) {
        const localX = worldX - this.worldOriginX;
        const localZ = worldZ - this.worldOriginZ;
        const cellX = Math.floor(localX / NAV_CONFIG.GRID_RESOLUTION);
        const cellZ = Math.floor(localZ / NAV_CONFIG.GRID_RESOLUTION);
        return { cellX, cellZ };
    }

    /**
     * Convert grid cell to world coordinates (center of cell)
     * @param {number} cellX - Grid cell X
     * @param {number} cellZ - Grid cell Z
     * @returns {{worldX: number, worldZ: number}} World coordinates
     */
    cellToWorld(cellX, cellZ) {
        const worldX = this.worldOriginX + (cellX + 0.5) * NAV_CONFIG.GRID_RESOLUTION;
        const worldZ = this.worldOriginZ + (cellZ + 0.5) * NAV_CONFIG.GRID_RESOLUTION;
        return { worldX, worldZ };
    }

    /**
     * Check if cell coordinates are within grid bounds
     * @param {number} cellX - Grid cell X
     * @param {number} cellZ - Grid cell Z
     * @returns {boolean} True if in bounds
     */
    isValidCell(cellX, cellZ) {
        return cellX >= 0 && cellX < NAV_CONFIG.GRID_SIZE &&
               cellZ >= 0 && cellZ < NAV_CONFIG.GRID_SIZE;
    }

    /**
     * Get grid array index from cell coordinates
     * @param {number} cellX - Grid cell X
     * @param {number} cellZ - Grid cell Z
     * @returns {number} Array index
     */
    cellToIndex(cellX, cellZ) {
        return cellZ * NAV_CONFIG.GRID_SIZE + cellX;
    }

    /**
     * Get cell flags at world position
     * @param {number} worldX - World X position
     * @param {number} worldZ - World Z position
     * @returns {number|null} Bit flags, or null if out of bounds
     */
    getCellFlagsWorld(worldX, worldZ) {
        const { cellX, cellZ } = this.worldToCell(worldX, worldZ);
        return this.getCellFlags(cellX, cellZ);
    }

    /**
     * Get cell flags at grid coordinates
     * @param {number} cellX - Grid cell X
     * @param {number} cellZ - Grid cell Z
     * @returns {number|null} Bit flags, or null if out of bounds
     */
    getCellFlags(cellX, cellZ) {
        if (!this.isValidCell(cellX, cellZ)) return null;
        return this.grid[this.cellToIndex(cellX, cellZ)];
    }

    /**
     * Set cell flags at grid coordinates
     * @param {number} cellX - Grid cell X
     * @param {number} cellZ - Grid cell Z
     * @param {number} flags - Bit flags to set
     */
    setCellFlags(cellX, cellZ, flags) {
        if (!this.isValidCell(cellX, cellZ)) return;
        this.grid[this.cellToIndex(cellX, cellZ)] = flags;
        this.version++;
    }

    /**
     * Add flag bits to a cell (bitwise OR)
     * @param {number} cellX - Grid cell X
     * @param {number} cellZ - Grid cell Z
     * @param {number} flags - Flags to add
     */
    addCellFlags(cellX, cellZ, flags) {
        if (!this.isValidCell(cellX, cellZ)) return;
        const index = this.cellToIndex(cellX, cellZ);
        this.grid[index] |= flags;
        this.version++;
    }

    /**
     * Remove flag bits from a cell (bitwise AND NOT)
     * @param {number} cellX - Grid cell X
     * @param {number} cellZ - Grid cell Z
     * @param {number} flags - Flags to remove
     */
    removeCellFlags(cellX, cellZ, flags) {
        if (!this.isValidCell(cellX, cellZ)) return;
        const index = this.cellToIndex(cellX, cellZ);
        this.grid[index] &= ~flags;
        this.version++;
    }

    /**
     * Check if cell has specific flag(s)
     * @param {number} cellX - Grid cell X
     * @param {number} cellZ - Grid cell Z
     * @param {number} flag - Flag bits to check
     * @returns {boolean} True if all specified flags are set
     */
    hasFlag(cellX, cellZ, flag) {
        const flags = this.getCellFlags(cellX, cellZ);
        if (flags === null) return false;
        return (flags & flag) === flag;
    }

    // ============================================================================
    // Surface Type Methods
    // ============================================================================

    /**
     * Get surface type at grid coordinates
     * @param {number} cellX - Grid cell X
     * @param {number} cellZ - Grid cell Z
     * @returns {number} Surface type (0-3)
     */
    getSurfaceType(cellX, cellZ) {
        const flags = this.getCellFlags(cellX, cellZ);
        if (flags === null) return SURFACE_TYPE.GRASS;
        return (flags & NAV_FLAGS.SURFACE_MASK) >> 4;
    }

    /**
     * Set surface type at grid coordinates
     * @param {number} cellX - Grid cell X
     * @param {number} cellZ - Grid cell Z
     * @param {number} surfaceType - Surface type (0-3)
     */
    setSurfaceType(cellX, cellZ, surfaceType) {
        if (!this.isValidCell(cellX, cellZ)) return;
        const index = this.cellToIndex(cellX, cellZ);
        // Clear surface bits and set new value
        this.grid[index] = (this.grid[index] & ~NAV_FLAGS.SURFACE_MASK) | (surfaceType << 4);
        this.version++;
    }

    // ============================================================================
    // Height Sampling Methods
    // ============================================================================

    /**
     * Get height sample index
     * @param {number} sampleX - Sample X (0-19)
     * @param {number} sampleZ - Sample Z (0-19)
     * @returns {number} Array index
     */
    heightSampleIndex(sampleX, sampleZ) {
        return sampleZ * NAV_CONFIG.HEIGHT_SAMPLE_SIZE + sampleX;
    }

    /**
     * Set height sample
     * @param {number} sampleX - Sample X (0-19)
     * @param {number} sampleZ - Sample Z (0-19)
     * @param {number} height - Height value
     */
    setHeightSample(sampleX, sampleZ, height) {
        if (sampleX < 0 || sampleX >= NAV_CONFIG.HEIGHT_SAMPLE_SIZE ||
            sampleZ < 0 || sampleZ >= NAV_CONFIG.HEIGHT_SAMPLE_SIZE) return;
        this.heightSamples[this.heightSampleIndex(sampleX, sampleZ)] = height;
    }

    /**
     * Get height sample
     * @param {number} sampleX - Sample X (0-19)
     * @param {number} sampleZ - Sample Z (0-19)
     * @returns {number} Height value
     */
    getHeightSample(sampleX, sampleZ) {
        if (sampleX < 0 || sampleX >= NAV_CONFIG.HEIGHT_SAMPLE_SIZE ||
            sampleZ < 0 || sampleZ >= NAV_CONFIG.HEIGHT_SAMPLE_SIZE) return 0;
        return this.heightSamples[this.heightSampleIndex(sampleX, sampleZ)];
    }

    // ============================================================================
    // Object Registry Methods
    // ============================================================================

    // Note: Object position tracking is handled by PhysicsManager
    // NavigationMap only stores non-positional metadata via objectMetadata Map

    // ============================================================================
    // Slope Calculation Methods
    // ============================================================================

    /**
     * Calculate slope at world position (in degrees)
     * Samples height at center and 4 cardinal neighbors, returns max slope
     *
     * @param {number} worldX - World X position
     * @param {number} worldZ - World Z position
     * @param {object} heightProvider - Object with getWorldHeight(x, z), getHeightFast(x, z), or calculateHeight(x, z) method
     * @returns {number} Slope in degrees (0-90)
     */
    calculateSlope(worldX, worldZ, heightProvider) {
        // Sample distance - 1.0m for smoother, more representative slope readings
        const sampleDist = 1.0;

        // Use getWorldHeight (new clipmap), getHeightFast (old terrain), or calculateHeight (fallback)
        const getHeight = heightProvider.getWorldHeight
            ? (x, z) => heightProvider.getWorldHeight(x, z)
            : heightProvider.getHeightFast
                ? (x, z) => heightProvider.getHeightFast(x, z)
                : (x, z) => heightProvider.calculateHeight(x, z);

        // Get height at center position
        const centerHeight = getHeight(worldX, worldZ);

        // Sample heights in 4 cardinal directions
        const northHeight = getHeight(worldX, worldZ - sampleDist);
        const southHeight = getHeight(worldX, worldZ + sampleDist);
        const eastHeight = getHeight(worldX + sampleDist, worldZ);
        const westHeight = getHeight(worldX - sampleDist, worldZ);

        // Calculate slope in each direction (rise / run)
        const slopeNorth = Math.abs(centerHeight - northHeight) / sampleDist;
        const slopeSouth = Math.abs(centerHeight - southHeight) / sampleDist;
        const slopeEast = Math.abs(centerHeight - eastHeight) / sampleDist;
        const slopeWest = Math.abs(centerHeight - westHeight) / sampleDist;

        // Average slope across all directions (more representative than max)
        const avgSlope = (slopeNorth + slopeSouth + slopeEast + slopeWest) / 4;

        // Convert to degrees
        const slopeDegrees = Math.atan(avgSlope) * (180 / Math.PI);

        return slopeDegrees;
    }

    /**
     * Get movement speed multiplier from slope
     *
     * Slope behavior:
     * - 0° to 45°: Linear interpolation from 1.0 (full speed) to 0.10 (10% speed)
     * - >45°: Clamped at 0.10 (10% speed - allows escape, never blocks)
     *
     * @param {number} slopeDegrees - Slope in degrees
     * @returns {number} Speed multiplier (minimum 0.10, maximum 1.0)
     */
    getSlopeSpeedMultiplier(slopeDegrees) {
        const MAX_WALKABLE_SLOPE = 45;  // Degrees
        const MIN_SPEED_MULTIPLIER = 0.10;  // 10% minimum speed

        // Linear interpolation from 1.0 at 0° to 0.10 at 45°+
        // Formula: speed = 1.0 - (slope / 45) * 0.90
        // At 0°: 1.0 - 0 = 1.0 (100% speed)
        // At 22.5°: 1.0 - 0.5 * 0.90 = 0.55 (55% speed)
        // At 45°: 1.0 - 1.0 * 0.90 = 0.10 (10% speed)
        // At >45°: Clamped to 0.10 (always escapable)
        const normalized = Math.min(slopeDegrees / MAX_WALKABLE_SLOPE, 1.0);
        const speedMultiplier = 1.0 - normalized * (1.0 - MIN_SPEED_MULTIPLIER);

        return Math.max(speedMultiplier, MIN_SPEED_MULTIPLIER);
    }

    /**
     * Check if slope is walkable (<=45 degrees)
     * @param {number} slopeDegrees - Slope in degrees
     * @returns {boolean} True if walkable
     */
    isSlopeWalkable(slopeDegrees) {
        return slopeDegrees <= 45;
    }

    /**
     * Calculate slope at grid cell
     * @param {number} cellX - Grid cell X
     * @param {number} cellZ - Grid cell Z
     * @param {object} heightCalculator - Terrain height calculator
     * @returns {number} Slope in degrees
     */
    calculateSlopeAtCell(cellX, cellZ, heightCalculator) {
        const { worldX, worldZ } = this.cellToWorld(cellX, cellZ);
        return this.calculateSlope(worldX, worldZ, heightCalculator);
    }

    // ============================================================================
    // Surface Type Determination (replicates shader texture logic)
    // ============================================================================

    /**
     * Determine dominant surface type at a position
     * Replicates the shader's texture selection logic (terrain.js:500-575)
     *
     * Priority order:
     * Thresholds match terrainsystem.js shader (HEIGHT_SCALE: 40):
     * 1. Slope > 25% (0.25) → ROCK (steep slope override, matches shader rockWeight)
     * 2. Height > 22 → ROCK (snow/rocky elevations, shader: 0.55 * 40 = 22)
     * 3. Height < 4 → SAND or DIRT (beach/lowlands, shader: sand fades 2-4)
     * 4. Height 4-22 → GRASS (main terrain)
     *
     * Note: Water (height < 0) is handled separately via the WATER flag
     *
     * @param {number} worldX - World X position
     * @param {number} worldZ - World Z position
     * @param {number} height - Terrain height at this position
     * @param {number} slopeDegrees - Slope in degrees
     * @returns {number} Surface type (SURFACE_TYPE.GRASS/DIRT/ROCK/SAND)
     */
    determineSurfaceType(worldX, worldZ, height, slopeDegrees) {
        // Steep slopes are always rocky (matches shader rockWeight at slope > 0.25)
        // Convert slope percentage to degrees: atan(0.25) ≈ 14 degrees
        if (slopeDegrees > 14) {
            return SURFACE_TYPE.ROCK;
        }

        // High elevations are rocky/snowy (shader: snow starts at 0.55 * heightScale = 22)
        if (height > 22) {
            return SURFACE_TYPE.ROCK;
        }

        // Low elevations are sandy/dirt (shader: sand full up to 2, fades 2-4)
        // Use 4 as threshold since that's where sand fully fades out
        if (height < 4) {
            // Sand everywhere at low elevations (beaches around continents)
            return SURFACE_TYPE.SAND;
        }

        // Mid elevations (4-22) are grassy
        return SURFACE_TYPE.GRASS;
    }

    /**
     * Determine surface type at grid cell
     * @param {number} cellX - Grid cell X
     * @param {number} cellZ - Grid cell Z
     * @param {object} heightProvider - Terrain height provider (getWorldHeight or calculateHeight)
     * @returns {number} Surface type
     */
    determineSurfaceTypeAtCell(cellX, cellZ, heightProvider) {
        const { worldX, worldZ } = this.cellToWorld(cellX, cellZ);
        const getHeight = heightProvider.getWorldHeight
            ? (x, z) => heightProvider.getWorldHeight(x, z)
            : (x, z) => heightProvider.calculateHeight(x, z);
        const height = getHeight(worldX, worldZ);
        const slope = this.calculateSlope(worldX, worldZ, heightProvider);
        return this.determineSurfaceType(worldX, worldZ, height, slope);
    }

    // ============================================================================
    // Movement Cost Calculation (for A* pathfinding)
    // ============================================================================

    /**
     * Calculate movement cost for a grid cell (used by pathfinding)
     *
     * Movement cost is the inverse of movement speed:
     * - Lower cost = faster movement = preferred path
     * - Higher cost = slower movement = avoided path
     *
     * Cost factors:
     * 1. Slope: 0° = 1.0x speed, 45° = 0.25x speed (minimum)
     * 2. Surface type: grass 1.0x, dirt 0.95x, sand 0.9x, rock 0.85x
     * 3. Road bonus: 1.3x speed on roads
     *
     * Formula: cost = 1.0 / (slopeSpeed * surfaceSpeed * roadMultiplier)
     *
     * @param {number} cellX - Grid cell X
     * @param {number} cellZ - Grid cell Z
     * @param {object} heightCalculator - Terrain height calculator (optional, for slope calc)
     * @returns {number} Movement cost (Infinity if blocked, 0.77-4.0 for walkable)
     */
    getMovementCost(cellX, cellZ, heightCalculator = null) {
        // Get cell flags
        const flags = this.getCellFlags(cellX, cellZ);
        if (flags === null) return Infinity; // Out of bounds

        // Check if cell is walkable
        if ((flags & NAV_FLAGS.WALKABLE) === 0) {
            return Infinity; // Water, steep slope, or obstacle
        }

        // Initialize total speed multiplier
        let totalSpeed = 1.0;

        // 1. Slope speed multiplier (if heightCalculator provided)
        if (heightCalculator) {
            const { worldX, worldZ } = this.cellToWorld(cellX, cellZ);
            const slope = this.calculateSlope(worldX, worldZ, heightCalculator);
            const slopeSpeed = this.getSlopeSpeedMultiplier(slope);

            if (slopeSpeed === 0) {
                return Infinity; // Should not happen if WALKABLE is set correctly
            }

            totalSpeed *= slopeSpeed;
        }
        // Note: If heightCalculator not provided, assume flat terrain (1.0x)

        // 2. Surface type speed multiplier
        const surfaceType = this.getSurfaceType(cellX, cellZ);
        let surfaceSpeed = 1.0;

        switch (surfaceType) {
            case SURFACE_TYPE.GRASS:
                surfaceSpeed = MOVEMENT_SPEED.SURFACE.GRASS;
                break;
            case SURFACE_TYPE.DIRT:
                surfaceSpeed = MOVEMENT_SPEED.SURFACE.DIRT;
                break;
            case SURFACE_TYPE.SAND:
                surfaceSpeed = MOVEMENT_SPEED.SURFACE.SAND;
                break;
            case SURFACE_TYPE.ROCK:
                surfaceSpeed = MOVEMENT_SPEED.SURFACE.ROCK;
                break;
        }

        totalSpeed *= surfaceSpeed;

        // 3. Road bonus (faster movement on roads)
        if ((flags & NAV_FLAGS.ROAD) !== 0) {
            totalSpeed *= MOVEMENT_SPEED.ROAD;
        }

        // Calculate cost as inverse of speed
        // Higher speed = lower cost (preferred by pathfinding)
        const cost = 1.0 / totalSpeed;

        return cost;
    }

    /**
     * Check if a cell is walkable (for quick pathfinding checks)
     * @param {number} cellX - Grid cell X
     * @param {number} cellZ - Grid cell Z
     * @returns {boolean} True if walkable
     */
    isWalkable(cellX, cellZ) {
        return this.hasFlag(cellX, cellZ, NAV_FLAGS.WALKABLE);
    }

    /**
     * Get movement speed multiplier at world position (FAST - uses cached data)
     * Use this for actual player/AI movement to apply terrain effects
     *
     * Speed factors (all pre-calculated and cached):
     * 1. Slope: 0° = 1.0x, 45° = 0.25x (cached in slopeSpeedCache)
     * 2. Surface: grass 1.0x, dirt 0.95x, sand 0.9x, rock 0.85x (in flags)
     * 3. Road: 1.3x bonus (in flags)
     *
     * Performance: ~1-2 microseconds (just array/bit lookups, no calculations)
     *
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {number} Speed multiplier (0.0-1.3x, or 0 if unwalkable)
     */
    getMovementSpeedMultiplier(worldX, worldZ) {
        // Convert world to cell coordinates
        let { cellX, cellZ } = this.worldToCell(worldX, worldZ);

        // Clamp to valid range (handles chunk boundaries gracefully)
        // When exactly on chunk border, we might get cell=100, clamp to 99
        cellX = Math.max(0, Math.min(cellX, NAV_CONFIG.GRID_SIZE - 1));
        cellZ = Math.max(0, Math.min(cellZ, NAV_CONFIG.GRID_SIZE - 1));

        // Check bounds (should always pass now, but keep as safety check)
        if (!this.isValidCell(cellX, cellZ)) {
            return 1.0; // Fallback to normal speed
        }

        // Get cell flags
        const cellIndex = this.cellToIndex(cellX, cellZ);
        const flags = this.grid[cellIndex];

        // Check if walkable - return normal speed regardless (physics handles collision blocking)
        if ((flags & NAV_FLAGS.WALKABLE) === 0) {
            return 1.0; // Let physics handle blocking, don't slow down
        }

        // Get cached slope speed (pre-calculated during terrain building)
        let totalSpeed = this.slopeSpeedCache[cellIndex];

        // Get surface type speed multiplier (from flags, super fast)
        const surfaceType = (flags & NAV_FLAGS.SURFACE_MASK) >> 4;
        switch (surfaceType) {
            case SURFACE_TYPE.GRASS:
                totalSpeed *= MOVEMENT_SPEED.SURFACE.GRASS; // 1.0
                break;
            case SURFACE_TYPE.DIRT:
                totalSpeed *= MOVEMENT_SPEED.SURFACE.DIRT; // 0.95
                break;
            case SURFACE_TYPE.SAND:
                totalSpeed *= MOVEMENT_SPEED.SURFACE.SAND; // 0.9
                break;
            case SURFACE_TYPE.ROCK:
                totalSpeed *= MOVEMENT_SPEED.SURFACE.ROCK; // 0.85
                break;
        }

        // Road bonus (from flags, super fast)
        if ((flags & NAV_FLAGS.ROAD) !== 0) {
            totalSpeed *= MOVEMENT_SPEED.ROAD; // 1.3
        }

        return totalSpeed;
    }

    /**
     * Get detailed movement speed info for debugging (with breakdown of modifiers)
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {object} Detailed speed info {multiplier, onRoad, slope, slopeMultiplier, surfaceType, surfaceMultiplier}
     */
    getMovementSpeedInfo(worldX, worldZ) {
        // Convert world to cell coordinates
        let { cellX, cellZ } = this.worldToCell(worldX, worldZ);

        // Clamp to valid range
        cellX = Math.max(0, Math.min(cellX, NAV_CONFIG.GRID_SIZE - 1));
        cellZ = Math.max(0, Math.min(cellZ, NAV_CONFIG.GRID_SIZE - 1));

        // Get cell data
        const cellIndex = this.cellToIndex(cellX, cellZ);
        const flags = this.grid[cellIndex];

        if (!this.isValidCell(cellX, cellZ) || (flags & NAV_FLAGS.WALKABLE) === 0) {
            return { multiplier: 0, onRoad: false, slope: 0, slopeMultiplier: 0, surfaceType: 'unwalkable', surfaceMultiplier: 0 };
        }

        // Get slope speed from cache
        const slopeMultiplier = this.slopeSpeedCache[cellIndex];

        // Calculate slope angle from speed multiplier (reverse the formula from getSlopeSpeedMultiplier)
        // Original formula: speedMultiplier = 1.0 - (slopeDegrees / 45) * 0.90
        // Reversed: slopeDegrees = ((1.0 - speedMultiplier) / 0.90) * 45
        const slope = slopeMultiplier >= 0.99 ? 0 : ((1.0 - slopeMultiplier) / 0.90) * 45;

        // Get surface type
        const surfaceTypeCode = (flags & NAV_FLAGS.SURFACE_MASK) >> 4;
        const surfaceNames = ['grass', 'dirt', 'sand', 'rock'];
        const surfaceType = surfaceNames[surfaceTypeCode] || 'grass';

        let surfaceMultiplier = 1.0;
        switch (surfaceTypeCode) {
            case SURFACE_TYPE.GRASS: surfaceMultiplier = MOVEMENT_SPEED.SURFACE.GRASS; break;
            case SURFACE_TYPE.DIRT: surfaceMultiplier = MOVEMENT_SPEED.SURFACE.DIRT; break;
            case SURFACE_TYPE.SAND: surfaceMultiplier = MOVEMENT_SPEED.SURFACE.SAND; break;
            case SURFACE_TYPE.ROCK: surfaceMultiplier = MOVEMENT_SPEED.SURFACE.ROCK; break;
        }

        // Check road
        const onRoad = (flags & NAV_FLAGS.ROAD) !== 0;
        const roadMultiplier = onRoad ? MOVEMENT_SPEED.ROAD : 1.0;

        // Total multiplier
        const totalMultiplier = slopeMultiplier * surfaceMultiplier * roadMultiplier;

        return {
            multiplier: totalMultiplier,
            onRoad,
            slope,
            slopeMultiplier,
            surfaceType,
            surfaceMultiplier
        };
    }

    // ============================================================================
    // Grid Building Methods
    // ============================================================================

    /**
     * Build the base terrain grid from height data
     * Populates the 100x100 grid with walkability, surface types, and terrain flags
     *
     * This method:
     * 1. Loops through all grid cells (100x100 = 10,000 cells)
     * 2. Queries terrain height at each cell center
     * 3. Calculates slope from neighboring heights
     * 4. Determines surface type (grass/dirt/rock/sand)
     * 5. Sets flags: WALKABLE, WATER, STEEP_SLOPE, surface type
     * 6. Optionally downsamples heights to 20x20 for later queries
     *
     * @param {object} heightProvider - Terrain height provider (getWorldHeight or calculateHeight)
     * @param {number} waterLevel - Water surface level (default: 0)
     * @returns {object} Build statistics {processedCells, walkableCells, waterCells, blockedCells, timeMs}
     */
    buildTerrainGrid(heightProvider, waterLevel = 0) {
        const startTime = performance.now();

        let walkableCells = 0;
        let waterCells = 0;
        let blockedCells = 0;

        // Use getWorldHeight (new clipmap) or calculateHeight (fallback)
        const getHeight = heightProvider.getWorldHeight
            ? (x, z) => heightProvider.getWorldHeight(x, z)
            : (x, z) => heightProvider.calculateHeight(x, z);

        // Loop through all grid cells (100x100)
        for (let cellZ = 0; cellZ < NAV_CONFIG.GRID_SIZE; cellZ++) {
            for (let cellX = 0; cellX < NAV_CONFIG.GRID_SIZE; cellX++) {
                // Convert cell to world coordinates (center of cell)
                const { worldX, worldZ } = this.cellToWorld(cellX, cellZ);

                // Query terrain height
                const height = getHeight(worldX, worldZ);

                // Calculate slope (in degrees)
                const slope = this.calculateSlope(worldX, worldZ, heightProvider);

                // Calculate and cache slope speed multiplier for runtime performance
                const slopeSpeed = this.getSlopeSpeedMultiplier(slope);
                const cellIndex = this.cellToIndex(cellX, cellZ);
                this.slopeSpeedCache[cellIndex] = slopeSpeed;

                // Initialize cell flags
                let flags = 0;

                // Check water
                if (height < waterLevel) {
                    flags |= NAV_FLAGS.WATER;
                    waterCells++;
                } else {
                    // Only process walkability for above-water cells

                    // Check if slope is too steep
                    if (slope > 45) {
                        flags |= NAV_FLAGS.STEEP_SLOPE;
                        blockedCells++;
                    } else {
                        // Walkable terrain
                        flags |= NAV_FLAGS.WALKABLE;
                        walkableCells++;
                    }

                    // Determine surface type (only for non-water)
                    const surfaceType = this.determineSurfaceType(worldX, worldZ, height, slope);
                    flags |= (surfaceType << 4); // Store in bits 4-5
                }

                // Set cell flags
                this.setCellFlags(cellX, cellZ, flags);

                // Store height sample (downsampled to 20x20)
                // Every 5th cell in each dimension (100/5 = 20)
                if (cellX % 5 === 0 && cellZ % 5 === 0) {
                    const sampleX = cellX / 5;
                    const sampleZ = cellZ / 5;
                    this.setHeightSample(sampleX, sampleZ, height);
                }
            }
        }

        const endTime = performance.now();

        return {
            processedCells: NAV_CONFIG.TOTAL_CELLS,
            walkableCells,
            waterCells,
            blockedCells,
            timeMs: endTime - startTime
        };
    }

    /**
     * Add a road to the navigation grid
     * Marks a circular area around the road position with the ROAD flag
     *
     * @param {number} worldX - World X position of road center
     * @param {number} worldZ - World Z position of road center
     * @param {number} radius - Road radius in meters (default: 1.0 = 2m diameter)
     */
    addRoad(worldX, worldZ, radius = 1.0) {
        // Convert world position to cell coordinates
        const { cellX: centerX, cellZ: centerZ } = this.worldToCell(worldX, worldZ);

        // Calculate radius in grid cells
        const cellRadius = Math.ceil(radius / NAV_CONFIG.GRID_RESOLUTION);

        // Mark all cells within radius as road
        for (let dz = -cellRadius; dz <= cellRadius; dz++) {
            for (let dx = -cellRadius; dx <= cellRadius; dx++) {
                const cellX = centerX + dx;
                const cellZ = centerZ + dz;

                // Check if within circular radius
                const distSq = dx * dx + dz * dz;
                if (distSq <= cellRadius * cellRadius) {
                    // Add ROAD flag to this cell (preserves other flags)
                    this.addCellFlags(cellX, cellZ, NAV_FLAGS.ROAD);
                }
            }
        }
    }

    /**
     * Remove a road from the navigation grid
     * Clears the ROAD flag from a circular area
     *
     * @param {number} worldX - World X position of road center
     * @param {number} worldZ - World Z position of road center
     * @param {number} radius - Road radius in meters (default: 1.0 = 2m diameter)
     */
    removeRoad(worldX, worldZ, radius = 1.0) {
        // Convert world position to cell coordinates
        const { cellX: centerX, cellZ: centerZ } = this.worldToCell(worldX, worldZ);

        // Calculate radius in grid cells
        const cellRadius = Math.ceil(radius / NAV_CONFIG.GRID_RESOLUTION);

        // Clear ROAD flag from all cells within radius
        for (let dz = -cellRadius; dz <= cellRadius; dz++) {
            for (let dx = -cellRadius; dx <= cellRadius; dx++) {
                const cellX = centerX + dx;
                const cellZ = centerZ + dz;

                // Check if within circular radius
                const distSq = dx * dx + dz * dz;
                if (distSq <= cellRadius * cellRadius) {
                    // Remove ROAD flag from this cell
                    this.removeCellFlags(cellX, cellZ, NAV_FLAGS.ROAD);
                }
            }
        }
    }

    /**
     * Add all roads from chunk data to the navigation grid
     * Processes chunk.objectChanges array for road objects
     *
     * @param {object} chunkData - Chunk data containing objectChanges array
     * @param {number} radius - Road radius in meters (default: 1.0 = 2m diameter)
     * @returns {number} Number of roads added
     */
    addRoadsFromChunkData(chunkData, radius = 1.0) {
        let roadCount = 0;

        if (!chunkData || !chunkData.objectChanges) {
            return roadCount;
        }

        // Loop through all object changes
        for (const change of chunkData.objectChanges) {
            // Find roads that were added
            if (change.action === 'add' && change.isRoad && change.position) {
                const [worldX, worldY, worldZ] = change.position;
                this.addRoad(worldX, worldZ, radius);
                roadCount++;
            }
        }

        return roadCount;
    }

    /**
     * Add a cylindrical obstacle to the navigation grid (blocks movement)
     * Used for trees, rocks, and other circular objects
     *
     * @param {number} worldX - World X position of obstacle center
     * @param {number} worldZ - World Z position of obstacle center
     * @param {number} radius - Obstacle radius in meters
     */
    addCylindricalObstacle(worldX, worldZ, radius) {
        // Convert world position to cell coordinates
        const { cellX: centerX, cellZ: centerZ } = this.worldToCell(worldX, worldZ);

        // Calculate radius in grid cells
        const cellRadius = Math.ceil(radius / NAV_CONFIG.GRID_RESOLUTION);

        // Mark all cells within radius as blocked
        for (let dz = -cellRadius; dz <= cellRadius; dz++) {
            for (let dx = -cellRadius; dx <= cellRadius; dx++) {
                const cellX = centerX + dx;
                const cellZ = centerZ + dz;

                // Check if within circular radius
                const distSq = dx * dx + dz * dz;
                if (distSq <= cellRadius * cellRadius) {
                    // Remove WALKABLE flag and add OBSTACLE flag
                    this.removeCellFlags(cellX, cellZ, NAV_FLAGS.WALKABLE);
                    this.addCellFlags(cellX, cellZ, NAV_FLAGS.OBSTACLE);
                }
            }
        }
    }

    /**
     * Add a rectangular obstacle to the navigation grid (blocks movement)
     * Used for structures, logs, and other box-shaped objects
     *
     * @param {number} worldX - World X position of obstacle center
     * @param {number} worldZ - World Z position of obstacle center
     * @param {number} width - Box width (X dimension)
     * @param {number} depth - Box depth (Z dimension)
     * @param {number} rotationY - Y-axis rotation in radians
     */
    addRectangularObstacle(worldX, worldZ, width, depth, rotationY = 0) {
        // Half extents
        const halfWidth = width / 2;
        const halfDepth = depth / 2;

        // Calculate bounding circle radius (for quick culling)
        const boundingRadius = Math.sqrt(halfWidth * halfWidth + halfDepth * halfDepth);
        const cellRadius = Math.ceil(boundingRadius / NAV_CONFIG.GRID_RESOLUTION);

        // Convert center to cell coordinates
        const { cellX: centerX, cellZ: centerZ } = this.worldToCell(worldX, worldZ);

        // Pre-calculate rotation values
        const cosRot = Math.cos(rotationY);
        const sinRot = Math.sin(rotationY);

        // Check all cells within bounding circle
        for (let dz = -cellRadius; dz <= cellRadius; dz++) {
            for (let dx = -cellRadius; dx <= cellRadius; dx++) {
                const cellX = centerX + dx;
                const cellZ = centerZ + dz;

                // Get cell world position
                const { worldX: cellWorldX, worldZ: cellWorldZ } = this.cellToWorld(cellX, cellZ);

                // Transform cell position to obstacle's local space (apply inverse rotation)
                const relX = cellWorldX - worldX;
                const relZ = cellWorldZ - worldZ;
                const localX = relX * cosRot + relZ * sinRot;
                const localZ = -relX * sinRot + relZ * cosRot;

                // Check if point is inside the rotated rectangle
                if (Math.abs(localX) <= halfWidth && Math.abs(localZ) <= halfDepth) {
                    // Remove WALKABLE flag and add OBSTACLE flag
                    this.removeCellFlags(cellX, cellZ, NAV_FLAGS.WALKABLE);
                    this.addCellFlags(cellX, cellZ, NAV_FLAGS.OBSTACLE);
                }
            }
        }
    }

    /**
     * Remove a cylindrical obstacle from the navigation grid (restores walkability)
     * Used when trees or rocks are removed from the world
     *
     * @param {number} worldX - World X position of obstacle center
     * @param {number} worldZ - World Z position of obstacle center
     * @param {number} radius - Obstacle radius in meters
     */
    removeCylindricalObstacle(worldX, worldZ, radius) {
        // Convert world position to cell coordinates
        const { cellX: centerX, cellZ: centerZ } = this.worldToCell(worldX, worldZ);

        // Calculate radius in grid cells
        const cellRadius = Math.ceil(radius / NAV_CONFIG.GRID_RESOLUTION);

        // Restore cells within radius
        for (let dz = -cellRadius; dz <= cellRadius; dz++) {
            for (let dx = -cellRadius; dx <= cellRadius; dx++) {
                const cellX = centerX + dx;
                const cellZ = centerZ + dz;

                // Check if within circular radius
                const distSq = dx * dx + dz * dz;
                if (distSq <= cellRadius * cellRadius) {
                    // Remove OBSTACLE flag and restore WALKABLE flag
                    this.removeCellFlags(cellX, cellZ, NAV_FLAGS.OBSTACLE);
                    this.addCellFlags(cellX, cellZ, NAV_FLAGS.WALKABLE);
                }
            }
        }
    }

    /**
     * Remove a rectangular obstacle from the navigation grid (restores walkability)
     * Used when structures or logs are removed from the world
     *
     * @param {number} worldX - World X position of obstacle center
     * @param {number} worldZ - World Z position of obstacle center
     * @param {number} width - Box width (X dimension)
     * @param {number} depth - Box depth (Z dimension)
     * @param {number} rotationY - Y-axis rotation in radians
     */
    removeRectangularObstacle(worldX, worldZ, width, depth, rotationY = 0) {
        // Half extents
        const halfWidth = width / 2;
        const halfDepth = depth / 2;

        // Calculate bounding circle radius (for quick culling)
        const boundingRadius = Math.sqrt(halfWidth * halfWidth + halfDepth * halfDepth);
        const cellRadius = Math.ceil(boundingRadius / NAV_CONFIG.GRID_RESOLUTION);

        // Convert center to cell coordinates
        const { cellX: centerX, cellZ: centerZ } = this.worldToCell(worldX, worldZ);

        // Pre-calculate rotation values
        const cosRot = Math.cos(rotationY);
        const sinRot = Math.sin(rotationY);

        // Check all cells within bounding circle
        for (let dz = -cellRadius; dz <= cellRadius; dz++) {
            for (let dx = -cellRadius; dx <= cellRadius; dx++) {
                const cellX = centerX + dx;
                const cellZ = centerZ + dz;

                // Get cell world position
                const { worldX: cellWorldX, worldZ: cellWorldZ } = this.cellToWorld(cellX, cellZ);

                // Transform cell position to obstacle's local space (apply inverse rotation)
                const relX = cellWorldX - worldX;
                const relZ = cellWorldZ - worldZ;
                const localX = relX * cosRot + relZ * sinRot;
                const localZ = -relX * sinRot + relZ * cosRot;

                // Check if point is inside the rotated rectangle
                if (Math.abs(localX) <= halfWidth && Math.abs(localZ) <= halfDepth) {
                    // Remove OBSTACLE flag and restore WALKABLE flag
                    this.removeCellFlags(cellX, cellZ, NAV_FLAGS.OBSTACLE);
                    this.addCellFlags(cellX, cellZ, NAV_FLAGS.WALKABLE);
                }
            }
        }
    }

    /**
     * Add all obstacles from PhysicsManager colliders to the navigation grid
     * Reads directly from PhysicsManager.colliderHandles to use exact collision bounds
     *
     * @param {PhysicsManager} physicsManager - Physics manager instance
     * @returns {object} Statistics {cylindrical, rectangular, total}
     */
    addObstaclesFromPhysicsManager(physicsManager) {
        let cylindricalCount = 0;
        let rectangularCount = 0;

        if (!physicsManager || !physicsManager.colliderHandles) {
            return { cylindrical: 0, rectangular: 0, total: 0 };
        }

        // Calculate chunk bounds for filtering
        const chunkMinX = this.worldOriginX;
        const chunkMaxX = this.worldOriginX + NAV_CONFIG.CHUNK_SIZE;
        const chunkMinZ = this.worldOriginZ;
        const chunkMaxZ = this.worldOriginZ + NAV_CONFIG.CHUNK_SIZE;

        // Iterate through all static colliders
        for (const [objectId, collider] of physicsManager.colliderHandles) {
            try {
                // Get collider position
                const translation = collider.translation();
                const worldX = translation.x;
                const worldZ = translation.z;

                // Check if collider is within this chunk's bounds
                if (worldX < chunkMinX || worldX >= chunkMaxX ||
                    worldZ < chunkMinZ || worldZ >= chunkMaxZ) {
                    // Debug: Check if this is an object that should be in this chunk
                    if (objectId.startsWith(`${this.chunkX},${this.chunkZ}_`)) {
                        console.warn(`[NAV DEBUG] Object ${objectId} at (${worldX.toFixed(1)}, ${worldZ.toFixed(1)}) is outside chunk bounds (${chunkMinX}, ${chunkMinZ}) to (${chunkMaxX}, ${chunkMaxZ})`);
                    }
                    continue; // Skip colliders outside this chunk
                }

                // Get collider shape
                const shape = collider.shape;
                const shapeType = shape.type;

                // Get rotation (for cuboids)
                const rotation = collider.rotation();
                // Extract Y-axis rotation from quaternion
                const rotationY = Math.atan2(2 * (rotation.w * rotation.y + rotation.x * rotation.z),
                                             1 - 2 * (rotation.y * rotation.y + rotation.z * rotation.z));

                if (shapeType === 'Cylinder') {
                    // Cylindrical obstacle (trees, rocks)
                    const radius = shape.radius;
                    this.addCylindricalObstacle(worldX, worldZ, radius);
                    cylindricalCount++;
                } else if (shapeType === 'Cuboid') {
                    // Rectangular obstacle (structures, logs)
                    const halfExtents = shape.halfExtents;
                    const width = halfExtents.x * 2;
                    const depth = halfExtents.z * 2;
                    this.addRectangularObstacle(worldX, worldZ, width, depth, rotationY);
                    rectangularCount++;
                }
            } catch (error) {
                console.warn(`[NavigationMap] Failed to process collider ${objectId}:`, error);
            }
        }

        return {
            cylindrical: cylindricalCount,
            rectangular: rectangularCount,
            total: cylindricalCount + rectangularCount
        };
    }

    /**
     * Add obstacles from chunk's object list (PRIMARY METHOD)
     * Reads position, rotation, and dimensions directly from THREE.js objects
     * Works for all chunks regardless of physics radius
     *
     * @param {Array} objects - Array of THREE.js objects from chunkObjects
     * @param {Object} gridDimensions - CONFIG.CONSTRUCTION.GRID_DIMENSIONS
     * @returns {Object} Statistics about obstacles added
     */
    addObstaclesFromObjectList(objects, gridDimensions) {
        let cylindricalCount = 0;
        let rectangularCount = 0;

        if (!objects || objects.length === 0 || !gridDimensions) {
            return { cylindrical: 0, rectangular: 0, total: 0 };
        }

        // Calculate chunk bounds for filtering
        const chunkMinX = this.worldOriginX;
        const chunkMaxX = this.worldOriginX + NAV_CONFIG.CHUNK_SIZE;
        const chunkMinZ = this.worldOriginZ;
        const chunkMaxZ = this.worldOriginZ + NAV_CONFIG.CHUNK_SIZE;

        for (const obj of objects) {
            try {
                // Get object data
                const modelType = obj.userData?.modelType;
                if (!modelType) continue;

                const position = obj.position;
                const worldX = position.x;
                const worldZ = position.z;

                // Check if object is within this chunk's bounds
                if (worldX < chunkMinX || worldX >= chunkMaxX ||
                    worldZ < chunkMinZ || worldZ >= chunkMaxZ) {
                    continue; // Skip objects outside this chunk
                }

                // Get dimensions from config
                const dims = gridDimensions[modelType];
                if (!dims) continue; // No dimensions defined for this type

                // Get scale (default to 1.0 if not specified)
                const scale = obj.userData?.originalScale || obj.scale?.x || 1.0;

                // Get rotation
                const rotationY = obj.rotation?.y || 0;

                // Add obstacle based on shape type
                if (dims.radius !== undefined) {
                    // Cylindrical obstacle (trees, rocks)
                    const radius = dims.radius * scale;
                    this.addCylindricalObstacle(worldX, worldZ, radius);
                    cylindricalCount++;
                } else if (dims.width !== undefined && dims.depth !== undefined) {
                    // Rectangular obstacle (structures, logs)
                    const width = dims.width * scale;
                    const depth = dims.depth * scale;
                    this.addRectangularObstacle(worldX, worldZ, width, depth, rotationY);
                    rectangularCount++;
                }
            } catch (error) {
                console.warn(`[NavigationMap] Failed to process object:`, error);
            }
        }

        return {
            cylindrical: cylindricalCount,
            rectangular: rectangularCount,
            total: cylindricalCount + rectangularCount
        };
    }

    // ============================================================================
    // Object Registry for AI Queries (hybrid approach)
    // ============================================================================

    /**
     * Extract object type from objectId string
     * Handles different objectId formats:
     * - "0,0_oak_202" → "oak"
     * - "oak_log_1762857239323_hs5ejlu48" → "oak_log"
     * - "dock_1763022957880_vby5emexi" → "dock"
     *
     * @param {string} objectId - Object identifier
     * @returns {string} Object type
     */
    static extractTypeFromObjectId(objectId) {
        if (!objectId) return null;

        // Check for log format (contains "_log_")
        if (objectId.includes('_log_')) {
            // "oak_log_123_abc" → "oak_log"
            return objectId.split('_').slice(0, 2).join('_');
        }

        const parts = objectId.split('_');

        // Check for chunk-prefixed format ("0,0_oak_202")
        if (parts.length >= 3 && parts[0].includes(',')) {
            // "0,0_oak_202" → "oak"
            return parts[1];
        }

        // Default format ("dock_123_abc" → "dock")
        return parts[0];
    }

    /**
     * Populate object metadata from chunk data
     * Stores lightweight metadata (type, quality) for all objects
     * Positions are queried from PhysicsManager (source of truth)
     *
     * @param {object} chunkData - Chunk data with objects and objectChanges
     * @returns {number} Number of objects registered
     */
    populateObjectMetadata(chunkData) {
        let count = 0;

        if (!chunkData) return count;

        // Register objects from main objects array
        if (Array.isArray(chunkData.objects)) {
            for (const obj of chunkData.objects) {
                if (obj.id && obj.name) {
                    this.objectMetadata.set(obj.id, {
                        type: obj.name,
                        quality: obj.quality || null,
                        // Add any other metadata AI might need
                    });
                    count++;
                }
            }
        }

        // Register objects from objectChanges (added objects)
        if (Array.isArray(chunkData.objectChanges)) {
            for (const change of chunkData.objectChanges) {
                if (change.action === 'add' && change.id && change.name && !change.isRoad) {
                    this.objectMetadata.set(change.id, {
                        type: change.name,
                        quality: change.quality || null,
                    });
                    count++;
                }
            }
        }

        return count;
    }

    /**
     * Find nearest object of a specific type using PhysicsManager spatial queries
     *
     * @param {number} worldX - Search center X
     * @param {number} worldZ - Search center Z
     * @param {string} objectType - Object type to find (e.g., "oak", "limestone")
     * @param {number} maxRadius - Maximum search radius in meters
     * @returns {object|null} - {id, type, x, z, distance, quality} or null if not found
     */
    findNearestObject(worldX, worldZ, objectType, maxRadius = 20) {
        if (!this.physicsManager || !this.physicsManager.querySphere) {
            console.warn('[NavigationMap] PhysicsManager not available for spatial queries');
            return null;
        }

        // Query PhysicsManager for all colliders within radius (fast BVH query)
        const results = [];
        const shape = { type: 'Ball', radius: maxRadius };
        const center = { x: worldX, y: 0, z: worldZ };

        try {
            // Use PhysicsManager's spatial query
            const colliders = this.physicsManager.querySphere(center, maxRadius);

            // Filter and enrich with metadata
            for (const collider of colliders) {
                const objectId = this.physicsManager.getObjectIdFromCollider(collider);
                if (!objectId) continue;

                // Get metadata (has type and quality)
                const metadata = this.objectMetadata.get(objectId);
                if (!metadata) continue;

                // Check if type matches
                if (metadata.type !== objectType) continue;

                // Get position from collider (source of truth)
                const translation = collider.translation();
                const dx = translation.x - worldX;
                const dz = translation.z - worldZ;
                const distance = Math.sqrt(dx * dx + dz * dz);

                results.push({
                    id: objectId,
                    type: metadata.type,
                    x: translation.x,
                    z: translation.z,
                    distance: distance,
                    quality: metadata.quality
                });
            }

            // Find nearest
            if (results.length === 0) return null;

            results.sort((a, b) => a.distance - b.distance);
            return results[0];

        } catch (error) {
            console.warn('[NavigationMap] Error in findNearestObject:', error);
            return null;
        }
    }

    /**
     * Find all objects within radius, optionally filtered by type
     *
     * @param {number} worldX - Search center X
     * @param {number} worldZ - Search center Z
     * @param {number} radius - Search radius in meters
     * @param {string} objectType - Object type filter (null = all types)
     * @returns {Array} - Array of {id, type, x, z, distance, quality}, sorted by distance
     */
    findObjectsInRadius(worldX, worldZ, radius, objectType = null) {
        if (!this.physicsManager || !this.physicsManager.querySphere) {
            console.warn('[NavigationMap] PhysicsManager not available for spatial queries');
            return [];
        }

        const results = [];
        const center = { x: worldX, y: 0, z: worldZ };

        try {
            // Query PhysicsManager
            const colliders = this.physicsManager.querySphere(center, radius);

            for (const collider of colliders) {
                const objectId = this.physicsManager.getObjectIdFromCollider(collider);
                if (!objectId) continue;

                const metadata = this.objectMetadata.get(objectId);
                if (!metadata) continue;

                // Filter by type if specified
                if (objectType && metadata.type !== objectType) continue;

                // Get position and calculate distance
                const translation = collider.translation();
                const dx = translation.x - worldX;
                const dz = translation.z - worldZ;
                const distance = Math.sqrt(dx * dx + dz * dz);

                results.push({
                    id: objectId,
                    type: metadata.type,
                    x: translation.x,
                    z: translation.z,
                    distance: distance,
                    quality: metadata.quality
                });
            }

            // Sort by distance (closest first)
            results.sort((a, b) => a.distance - b.distance);
            return results;

        } catch (error) {
            console.warn('[NavigationMap] Error in findObjectsInRadius:', error);
            return [];
        }
    }

    /**
     * Get all registered objects of a specific type (in this chunk)
     *
     * @param {string} objectType - Object type (e.g., "oak", "limestone")
     * @returns {Array} - Array of {id, type, quality}
     */
    findAllObjectsOfType(objectType) {
        const results = [];

        for (const [objectId, metadata] of this.objectMetadata.entries()) {
            if (metadata.type === objectType) {
                results.push({
                    id: objectId,
                    type: metadata.type,
                    quality: metadata.quality
                });
            }
        }

        return results;
    }

    // ============================================================================
    // Utility Methods
    // ============================================================================

    /**
     * Clear all grid data and object metadata
     */
    clear() {
        this.grid.fill(0);
        this.heightSamples.fill(0);
        this.objectMetadata.clear();
        this.version++;
    }

    /**
     * Get memory usage in bytes
     * @returns {number} Total memory usage
     */
    getMemoryUsage() {
        return this.grid.byteLength +
               this.heightSamples.byteLength;
    }

    /**
     * Rebuild navigation grid for a rectangular world area (used after terrain leveling)
     * Updates slopes, walkability, surface types, and height samples for the affected region
     *
     * @param {number} worldX - Center X of rectangle
     * @param {number} worldZ - Center Z of rectangle
     * @param {number} width - Rectangle width
     * @param {number} depth - Rectangle depth
     * @param {number} rotationRad - Rotation in radians
     * @param {object} heightProvider - Object with getWorldHeight(x, z), getHeightFast(x, z), or calculateHeight(x, z) method
     * @param {number} waterLevel - Water surface level (default: 0)
     */
    rebuildRegion(worldX, worldZ, width, depth, rotationRad, heightProvider, waterLevel = 0) {
        const halfWidth = width / 2;
        const halfDepth = depth / 2;
        const transitionSize = 1.0; // Match terrain leveling transition

        // Use getWorldHeight (new clipmap), getHeightFast (old terrain), or calculateHeight (fallback)
        const getHeight = heightProvider.getWorldHeight
            ? (x, z) => heightProvider.getWorldHeight(x, z)
            : heightProvider.getHeightFast
                ? (x, z) => heightProvider.getHeightFast(x, z)
                : (x, z) => heightProvider.calculateHeight(x, z);

        // Pre-calculate rotation values
        const cosR = Math.cos(-rotationRad);
        const sinR = Math.sin(-rotationRad);

        // Calculate bounding box in grid space
        const cosRAbs = Math.abs(Math.cos(rotationRad));
        const sinRAbs = Math.abs(Math.sin(rotationRad));
        const boundingHalfWidth = halfWidth * cosRAbs + halfDepth * sinRAbs;
        const boundingHalfDepth = halfWidth * sinRAbs + halfDepth * cosRAbs;

        // Convert world bounds to cell coordinates
        const minWorldX = worldX - boundingHalfWidth - transitionSize;
        const maxWorldX = worldX + boundingHalfWidth + transitionSize;
        const minWorldZ = worldZ - boundingHalfDepth - transitionSize;
        const maxWorldZ = worldZ + boundingHalfDepth + transitionSize;

        const { cellX: minCellX, cellZ: minCellZ } = this.worldToCell(minWorldX, minWorldZ);
        const { cellX: maxCellX, cellZ: maxCellZ } = this.worldToCell(maxWorldX, maxWorldZ);

        let updatedCells = 0;

        // Rebuild all cells in the bounding box
        for (let cellZ = Math.max(0, minCellZ); cellZ <= Math.min(NAV_CONFIG.GRID_SIZE - 1, maxCellZ); cellZ++) {
            for (let cellX = Math.max(0, minCellX); cellX <= Math.min(NAV_CONFIG.GRID_SIZE - 1, maxCellX); cellX++) {
                // Convert cell to world coordinates
                const { worldX: cellWorldX, worldZ: cellWorldZ } = this.cellToWorld(cellX, cellZ);

                // Check if cell is actually affected by the leveled region
                const relX = cellWorldX - worldX;
                const relZ = cellWorldZ - worldZ;
                const structLocalX = relX * cosR - relZ * sinR;
                const structLocalZ = relX * sinR + relZ * cosR;
                const distX = Math.abs(structLocalX);
                const distZ = Math.abs(structLocalZ);
                const edgeDist = Math.max(distX - halfWidth, distZ - halfDepth);

                // Only update cells within the transition zone
                if (edgeDist > transitionSize) continue;

                // Query terrain height (now uses updated heightTextureData via getHeightFast)
                const height = getHeight(cellWorldX, cellWorldZ);

                // Calculate slope (in degrees) - uses getHeightFast if available
                const slope = this.calculateSlope(cellWorldX, cellWorldZ, heightProvider);

                // Calculate and cache slope speed multiplier
                const slopeSpeed = this.getSlopeSpeedMultiplier(slope);
                const cellIndex = this.cellToIndex(cellX, cellZ);
                this.slopeSpeedCache[cellIndex] = slopeSpeed;

                // Initialize cell flags
                let flags = 0;

                // Check water
                if (height < waterLevel) {
                    flags |= NAV_FLAGS.WATER;
                } else {
                    // Check if slope is too steep
                    if (slope > 45) {
                        flags |= NAV_FLAGS.STEEP_SLOPE;
                    } else {
                        // Walkable terrain
                        flags |= NAV_FLAGS.WALKABLE;
                    }

                    // Determine surface type (only for non-water)
                    const surfaceType = this.determineSurfaceType(cellWorldX, cellWorldZ, height, slope);
                    flags |= (surfaceType << 4); // Store in bits 4-5
                }

                // Set cell flags
                this.setCellFlags(cellX, cellZ, flags);

                // Update height sample if this cell corresponds to a sample point
                if (cellX % 5 === 0 && cellZ % 5 === 0) {
                    const sampleX = cellX / 5;
                    const sampleZ = cellZ / 5;
                    this.setHeightSample(sampleX, sampleZ, height);
                }

                updatedCells++;
            }
        }

        return updatedCells;
    }
}

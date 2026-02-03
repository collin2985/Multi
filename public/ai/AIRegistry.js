/**
 * AIRegistry - Central registry for AI controllers
 *
 * Eliminates circular references between controllers by providing
 * a single point of access for cross-controller queries.
 *
 * Benefits:
 * - No initialization order dependency
 * - Controllers don't reference each other directly
 * - Easy to mock for testing
 * - Cross-controller queries are O(1) lookups
 */

export class AIRegistry {
    constructor() {
        this.controllers = new Map(); // 'bandit' -> BanditController, etc.
    }

    /**
     * Register a controller
     * @param {string} type - 'bandit' | 'deer' | 'brownbear'
     * @param {Object} controller - The controller instance
     */
    register(type, controller) {
        this.controllers.set(type, controller);
        // Also set registry reference on controller if it supports it
        if (controller.registry === null || controller.registry === undefined) {
            controller.registry = this;
        }
    }

    /**
     * Get a controller by type
     * @param {string} type - 'bandit' | 'deer' | 'brownbear'
     * @returns {Object|undefined}
     */
    get(type) {
        return this.controllers.get(type);
    }

    /**
     * Check if a controller is registered
     * @param {string} type
     * @returns {boolean}
     */
    has(type) {
        return this.controllers.has(type);
    }

    /**
     * Get all entities of a specific type in an area
     * @param {string} type - Controller type
     * @param {number} x - Center X coordinate
     * @param {number} z - Center Z coordinate
     * @param {number} radius - Search radius
     * @returns {Array} Entities within radius
     */
    getEntitiesOfTypeInArea(type, x, z, radius) {
        const controller = this.controllers.get(type);
        if (!controller || !controller.entities) return [];

        const results = [];
        const radiusSq = radius * radius;

        for (const [id, entity] of controller.entities) {
            if (!entity.position) continue;
            if (entity.isDead || entity.state === 'dead') continue;

            const dx = entity.position.x - x;
            const dz = entity.position.z - z;
            const distSq = dx * dx + dz * dz;

            if (distSq <= radiusSq) {
                results.push({
                    id,
                    type,
                    entity,
                    position: entity.position,
                    distSq
                });
            }
        }

        return results;
    }

    /**
     * Get all entities from all controllers in an area
     * @param {number} x - Center X coordinate
     * @param {number} z - Center Z coordinate
     * @param {number} radius - Search radius
     * @param {string} [excludeType] - Optional type to exclude
     * @returns {Array} All entities within radius
     */
    getEntitiesInArea(x, z, radius, excludeType = null) {
        const results = [];

        for (const [type, controller] of this.controllers) {
            if (type === excludeType) continue;
            results.push(...this.getEntitiesOfTypeInArea(type, x, z, radius));
        }

        return results;
    }

    /**
     * Check if any hostile entity is near a position
     * @param {number} x - X coordinate
     * @param {number} z - Z coordinate
     * @param {number} radius - Search radius
     * @param {string} perspective - 'player' | 'bandit' | 'brownbear' | 'deer'
     * @returns {boolean} True if threats exist
     */
    hasHostilesNear(x, z, radius, perspective) {
        // Define what's hostile from each perspective
        const hostileTypes = {
            player: ['bandit', 'brownbear'],  // Players fear bandits and bears
            bandit: ['brownbear'],            // Bandits fear bears
            brownbear: [],               // Brown bears fear nothing (except structures)
            deer: ['player', 'bandit', 'brownbear']  // Deer fear everything
        };

        const threats = hostileTypes[perspective] || [];

        for (const threatType of threats) {
            const entities = this.getEntitiesOfTypeInArea(threatType, x, z, radius);
            if (entities.length > 0) return true;
        }

        return false;
    }

    /**
     * Find the nearest entity of a specific type
     * @param {string} type - Controller type
     * @param {number} x - X coordinate
     * @param {number} z - Z coordinate
     * @param {number} maxRadius - Maximum search radius
     * @returns {Object|null} Nearest entity info or null
     */
    findNearestOfType(type, x, z, maxRadius) {
        const entities = this.getEntitiesOfTypeInArea(type, x, z, maxRadius);
        if (entities.length === 0) return null;

        // Sort by distance and return nearest
        entities.sort((a, b) => a.distSq - b.distSq);
        return entities[0];
    }

    /**
     * Kill an entity by type and ID
     * @param {string} type - Controller type ('bandit', 'deer', 'brownbear')
     * @param {string} entityId - Entity ID
     * @param {string} killedBy - ID of killer
     * @returns {boolean} True if kill was processed
     */
    killEntity(type, entityId, killedBy) {
        const controller = this.controllers.get(type);
        if (!controller) return false;

        // Each controller has its own kill method
        if (type === 'bandit' && controller.killEntity) {
            controller.killEntity(entityId, killedBy);
            return true;
        } else if (type === 'brownbear' && controller.killEntity) {
            controller.killEntity(entityId, killedBy);
            return true;
        } else if (type === 'deer') {
            // Prefer killEntity if available (new pattern), fallback to killDeer
            if (controller.killEntity) {
                controller.killEntity(entityId, killedBy);
                return true;
            } else if (controller.killDeer) {
                controller.killDeer(entityId, killedBy);
                return true;
            }
        }

        return false;
    }

    /**
     * Get count of alive entities by type
     * @param {string} type - Controller type
     * @returns {number}
     */
    getAliveCount(type) {
        const controller = this.controllers.get(type);
        if (!controller || !controller.entities) return 0;

        let count = 0;
        for (const [id, entity] of controller.entities) {
            if (!entity.isDead && entity.state !== 'dead') {
                count++;
            }
        }
        return count;
    }

    /**
     * Get total count of all alive entities
     * @returns {Object} Counts by type
     */
    getAllAliveCounts() {
        const counts = {};
        for (const [type] of this.controllers) {
            counts[type] = this.getAliveCount(type);
        }
        return counts;
    }
}

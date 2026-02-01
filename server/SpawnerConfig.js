/**
 * SpawnerConfig.js
 * Configuration for server-authoritative AI spawning system
 *
 * Add new AI types here without changing engine code.
 * The server will automatically spawn AI based on these rules
 * when players approach the associated structures.
 */

const SPAWNER_TYPES = {
    'tent': {
        aiType: 'combat_enemy',      // What AI class to spawn on client
        maxCount: 1,                 // How many AI per structure
        triggerDistance: 20,         // Player must be within this range to trigger spawn
        despawnDistance: 50,         // Unload AI if all players go beyond this distance
        respawnTime: -1,             // -1 = Never respawn (Permadeath), >0 = Milliseconds
        spawnOffset: { min: 2, max: 3 }, // Random spawn distance from structure
        aggro: true                  // Metadata passed to client (hostile AI)
    }

    // Future structures go here...
    // 'dock': {
    //     aiType: 'fisherman_npc',
    //     maxCount: 2,
    //     triggerDistance: 15,
    //     despawnDistance: 45,
    //     respawnTime: 120000,
    //     spawnOffset: { min: 1, max: 3 },
    //     aggro: false
    // }
};

module.exports = { SPAWNER_TYPES };

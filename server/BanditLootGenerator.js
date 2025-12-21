/**
 * BanditLootGenerator.js
 * Pure functions for generating deterministic bandit loot
 */

/**
 * Create a seeded random number generator from a string
 * Uses simple hash -> mulberry32 PRNG
 */
function createSeededRNG(seed) {
    // Hash the string seed to a number
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        const char = seed.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }

    // Mulberry32 PRNG
    let state = hash >>> 0;
    return function() {
        state = Math.imul(state ^ (state >>> 15), 1 | state) >>> 0;
        state = (state + Math.imul(state ^ (state >>> 7), 61 | state)) >>> 0;
        return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Generate bandit tent loot (deterministic based on tent ID)
 */
function generateBanditTentLoot(tentId) {
    const rng = createSeededRNG(tentId);
    const items = [];
    let slotX = 0;
    let slotY = 0;

    // Gold: 1-1000 with 1/1000 chance for jackpot
    const isJackpot = rng() < 0.001;
    const goldAmount = isJackpot ? 1000 : Math.floor(rng() * 50) + 1;
    items.push({
        id: `${tentId}_coin`,
        type: 'coin',
        x: slotX,
        y: slotY,
        width: 1,
        height: 1,
        quantity: goldAmount
    });
    slotX++;

    // Random tools (0-3 tools)
    const toolTypes = ['axe', 'pickaxe', 'rifle'];
    const numTools = Math.floor(rng() * 4);

    for (let i = 0; i < numTools; i++) {
        const toolType = toolTypes[Math.floor(rng() * toolTypes.length)];
        const quality = Math.floor(rng() * 80) + 10; // 10-90 quality
        const durability = Math.floor(rng() * 80) + 20; // 20-100 durability

        items.push({
            id: `${tentId}_tool_${i}`,
            type: toolType,
            x: slotX,
            y: slotY,
            width: 2,
            height: 4,
            quality: quality,
            durability: durability
        });
        slotX += 2;
        if (slotX >= 8) {
            slotX = 0;
            slotY += 4;
        }
    }

    return items;
}

/**
 * Generate bandit campfire loot (deterministic based on campfire ID)
 * Campfire inventory is 4x4 grid
 * Layout: Firewood (2x4) on left, 4 meats (1x1 each) in 2x2 block on right
 */
function generateBanditCampfireLoot(campfireId) {
    const items = [];

    // Firewood (2x4) - takes up left side of 4x4 grid
    // Durability equals quality (min 20), consumed at 2/min
    const firewoodQuality = 100;
    items.push({
        id: `${campfireId}_firewood`,
        type: 'oakfirewood',
        x: 0,
        y: 0,
        width: 2,
        height: 4,
        quality: firewoodQuality,
        durability: Math.max(20, firewoodQuality) // 25 min burn time
    });

    // 4 cooked meat in 2x2 block on right side (columns 2-3, rows 0-1)
    const meatPositions = [
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 2, y: 1 },
        { x: 3, y: 1 }
    ];

    for (let i = 0; i < 4; i++) {
        items.push({
            id: `${campfireId}_meat_${i}`,
            type: 'cookedmeat',
            x: meatPositions[i].x,
            y: meatPositions[i].y,
            width: 1,
            height: 1,
            quality: 50
        });
    }

    return items;
}

module.exports = {
    createSeededRNG,
    generateBanditTentLoot,
    generateBanditCampfireLoot
};

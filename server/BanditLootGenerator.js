/**
 * BanditLootGenerator.js
 * Pure functions for generating deterministic bandit loot
 */

// Base durability values for food items (must match PlayerHunger.js)
const FOOD_BASE_DURABILITY = {
    'apple': 10,
    'mushroom': 10,
    'vegetables': 20,
    'roastedvegetables': 40,
    'appletart': 30,
    'cookedfish': 60,
    'cookedmeat': 80,
    'rawmeat': 10
};

/**
 * Calculate food durability based on quality
 * Formula: baseDurability * (quality / 100)
 */
function calculateFoodDurability(foodType, quality) {
    const baseDurability = FOOD_BASE_DURABILITY[foodType] || 50;
    return Math.round(baseDurability * (quality / 100));
}

/**
 * Calculate tool durability based on quality
 * Quality is a cap on durability, minimum 10
 * Formula: max(10, quality)
 */
function calculateToolDurability(quality) {
    return Math.max(10, quality);
}

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
 * Loot table configuration for bandit tents
 * Each item has: chance (0-1), size (width x height), and type-specific properties
 */
const BANDIT_TENT_LOOT_TABLE = {
    // Tools (2x4 size, quality/durability based)
    axe:     { chance: 0.25, width: 2, height: 4, isTool: true },
    pickaxe: { chance: 0.25, width: 2, height: 4, isTool: true },
    rifle:   { chance: 0.15, width: 2, height: 4, isTool: true },
    // Ammo/shells (1x1 size, quantity based)
    ammo:    { chance: 0.40, width: 1, height: 1, isStackable: true, minQty: 5, maxQty: 15 },
    shell:   { chance: 0.20, width: 1, height: 1, isStackable: true, minQty: 2, maxQty: 6 }
};

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

    // Roll for each item type independently
    let itemIndex = 0;
    for (const [itemType, config] of Object.entries(BANDIT_TENT_LOOT_TABLE)) {
        // Roll chance for this item type
        if (rng() < config.chance) {
            const quality = Math.floor(rng() * 80) + 10; // 10-90 quality

            const item = {
                id: `${tentId}_loot_${itemIndex}`,
                type: itemType,
                x: slotX,
                y: slotY,
                width: config.width,
                height: config.height
            };

            if (config.isTool) {
                // Tools have quality and durability
                item.quality = quality;
                item.durability = calculateToolDurability(quality);
            } else if (config.isStackable) {
                // Stackable items (ammo, shell) have quantity
                item.quantity = Math.floor(rng() * (config.maxQty - config.minQty + 1)) + config.minQty;
            }

            items.push(item);
            itemIndex++;

            // Advance slot position based on item size
            slotX += config.width;
            if (slotX >= 8) {
                slotX = 0;
                slotY += config.height;
            }
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

    const meatQuality = 50;
    for (let i = 0; i < 4; i++) {
        items.push({
            id: `${campfireId}_meat_${i}`,
            type: 'cookedmeat',
            x: meatPositions[i].x,
            y: meatPositions[i].y,
            width: 1,
            height: 1,
            quality: meatQuality,
            durability: calculateFoodDurability('cookedmeat', meatQuality)
        });
    }

    return items;
}

/**
 * Generate loot for a dead bandit/militia corpse (deterministic based on entity ID)
 * Used when bandits or militia die - creates lootable corpse inventory
 * @param {string} entityId - Unique entity identifier for deterministic loot
 * @param {boolean} hasRifle - Whether the entity had a rifle (true by default)
 * @returns {object} { items: [], slingItem: rifle|null }
 */
function generateBanditDeathLoot(entityId, hasRifle = true) {
    const rng = createSeededRNG(entityId);
    const items = [];

    // Coins (always, 5-25)
    items.push({
        id: `${entityId}_coins`,
        type: 'coin',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        quantity: Math.floor(rng() * 20) + 5
    });

    // Ammo (if rifle, 70% chance, 3-12)
    if (hasRifle && rng() < 0.7) {
        items.push({
            id: `${entityId}_ammo`,
            type: 'ammo',
            x: 1,
            y: 0,
            width: 1,
            height: 1,
            quantity: Math.floor(rng() * 10) + 3
        });
    }

    // Food (25% chance - cooked meat)
    if (rng() < 0.25) {
        const meatQuality = Math.floor(rng() * 40) + 30;  // 30-70 quality
        items.push({
            id: `${entityId}_food`,
            type: 'cookedmeat',
            x: 2,
            y: 0,
            width: 1,
            height: 1,
            quality: meatQuality,
            durability: calculateFoodDurability('cookedmeat', meatQuality)
        });
    }

    // Sling rifle (if entity had one)
    const slingItem = hasRifle ? {
        id: `${entityId}_rifle`,
        type: 'rifle',
        quality: Math.floor(rng() * 35) + 15,  // 15-50 quality
        durability: Math.floor(rng() * 25) + 10,  // 10-35 durability
        rotation: 90
    } : null;

    return { items, slingItem };
}

module.exports = {
    createSeededRNG,
    generateBanditTentLoot,
    generateBanditCampfireLoot,
    generateBanditDeathLoot
};

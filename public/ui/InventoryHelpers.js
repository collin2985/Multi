// File: public/ui/InventoryHelpers.js
// Pure utility functions extracted from InventoryUI.js

/**
 * Helper function to check if a material is a plank type
 * @param {string} material - Material type to check
 * @returns {boolean}
 */
export function isPlankType(material) {
    return material === 'oakplank' ||
           material === 'pineplank' ||
           material === 'firplank' ||
           material === 'cypressplank' ||
           material === 'appleplank';
}

/**
 * Helper function to check if a material is a raw stone type
 * @param {string} material - Material type to check
 * @returns {boolean}
 */
export function isRawStone(material) {
    return material === 'limestone' || material === 'sandstone';
}

/**
 * Helper function to check if a material is a chiseled stone type
 * @param {string} material - Material type to check
 * @returns {boolean}
 */
export function isChiseledStone(material) {
    return material === 'chiseledlimestone' || material === 'chiseledsandstone';
}

/**
 * Get total quantity of all chiseled stone types in materials object
 * @param {object} materials - Materials object with quantities
 * @returns {number}
 */
export function getTotalChiseledStoneQuantity(materials) {
    let total = 0;
    if (materials.chiseledlimestone) total += materials.chiseledlimestone.quantity || 0;
    if (materials.chiseledsandstone) total += materials.chiseledsandstone.quantity || 0;
    return total;
}

/**
 * Get total quantity of all plank types in materials object
 * @param {object} materials - Materials object with quantities
 * @returns {number}
 */
export function getTotalPlankQuantity(materials) {
    let total = 0;
    if (materials.oakplank) total += materials.oakplank.quantity || 0;
    if (materials.pineplank) total += materials.pineplank.quantity || 0;
    if (materials.firplank) total += materials.firplank.quantity || 0;
    if (materials.cypressplank) total += materials.cypressplank.quantity || 0;
    if (materials.appleplank) total += materials.appleplank.quantity || 0;
    return total;
}

/**
 * Format material name for display
 * Converts plank types to generic "Plank" label
 * @param {string} material - Material type
 * @returns {string}
 */
export function formatMaterialName(material) {
    if (isPlankType(material)) {
        return 'Plank';
    }

    // For interchangeable chiseled stone types, show generic name
    if (isChiseledStone(material)) {
        return 'Chiseled Stone';
    }

    // For interchangeable raw stone types, show generic name
    if (isRawStone(material)) {
        return 'Stone';
    }

    // Handle specific display names
    const displayNames = {
        'chiseledgranite': 'Chiseled Granite',
        'chiseledclay': 'Chiseled Clay',
        'vegetableseeds': 'Vegetable Seeds',
        'hempseeds': 'Hemp Seeds',
        'hempfiber': 'Hemp Fiber',
        'fabric': 'Fabric',
        'appleseed': 'Apple Seed',
        'tile': 'Tile',
        'rope': 'Rope'
    };

    if (displayNames[material]) {
        return displayNames[material];
    }

    // Fallback: split camelCase and capitalize
    return material
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace('_', ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
}


/**
 * Get display name for item types
 * Maps item type IDs to proper display names for tooltips
 * @param {string} itemType - Item type (e.g., 'vegetableseeds', 'mushroom')
 * @returns {string} Display name (e.g., 'Vegetable Seeds', 'Mushroom')
 */
export function getItemDisplayName(itemType) {
    const displayNames = {
        // Seeds
        'vegetableseeds': 'Vegetable Seeds',
        'hempseeds': 'Hemp Seeds',
        'oakseed': 'Oak Seed',
        'pineseed': 'Pine Seed',
        'firseed': 'Fir Seed',
        'cypressseed': 'Cypress Seed',
        'appleseed': 'Apple Seed',

        // Food items
        'mushroom': 'Mushroom',
        'apple': 'Apple',
        'vegetables': 'Vegetables',
        'roastedvegetables': 'Roasted Vegetables',
        'appletart': 'Apple Tart',
        'fish': 'Fish',
        'cookedfish': 'Cooked Fish',
        'rawmeat': 'Raw Meat',
        'cookedmeat': 'Cooked Meat',
        'animalskin': 'Animal Skin',

        // Stone Materials
        'limestone': 'Limestone',
        'sandstone': 'Sandstone',
        'granite': 'Granite',
        'clay': 'Clay',
        'chiseledlimestone': 'Chiseled Limestone',
        'chiseledsandstone': 'Chiseled Sandstone',
        'chiseledgranite': 'Chiseled Granite',
        'tile': 'Tile',

        // Metal/Ore
        'iron': 'Iron',
        'ironingot': 'Iron Ingot',
        'parts': 'Parts',

        // Other Materials
        'vines': 'Vines',
        'rope': 'Rope',
        'hempfiber': 'Hemp Fiber',
        'fabric': 'Fabric',

        // Planks
        'oakplank': 'Oak Plank',
        'pineplank': 'Pine Plank',
        'firplank': 'Fir Plank',
        'cypressplank': 'Cypress Plank',
        'appleplank': 'Apple Plank',

        // Firewood
        'oakfirewood': 'Oak Firewood',
        'pinefirewood': 'Pine Firewood',
        'firfirewood': 'Fir Firewood',
        'cypressfirewood': 'Cypress Firewood',
        'applefirewood': 'Apple Firewood',

        // Tools
        'axe': 'Axe',
        'saw': 'Saw',
        'pickaxe': 'Pickaxe',
        'hammer': 'Hammer',
        'chisel': 'Chisel',
        'fishingnet': 'Fishing Net',
        'improvisedtool': 'Improvised Tool',

        // Weapons
        'rifle': 'Rifle',
        'ammo': 'Ammo',
        'shell': 'Shell',

        // Mounts
        'horse': 'Horse'
    };

    return displayNames[itemType] || itemType;
}

/**
 * Get item size (width x height) for inventory placement
 * @param {string} itemType - Type of item
 * @returns {object} {width, height}
 */
export function getItemSize(itemType) {
    // Define tool types
    const largeTools = ['axe', 'saw', 'pickaxe', 'rifle', 'improvisedtool']; // 2x5
    const smallTools = ['hammer', 'chisel']; // 1x2

    // Define material types
    const woodMaterials = [
        'oakplank', 'pineplank', 'firplank', 'cypressplank', 'appleplank',
        'oakfirewood', 'pinefirewood', 'firfirewood', 'cypressfirewood', 'applefirewood'
    ]; // 2x4
    const stoneMaterials = [
        'limestone', 'sandstone', 'chiseledlimestone', 'chiseledsandstone', 'clay',
        'granite', 'chiseledgranite', 'tile'
    ]; // 1x1
    const metalMaterials = ['iron', 'ironingot', 'parts', 'rope', 'hempfiber']; // 1x1

    // Define food types
    const foodItems = ['apple', 'vegetables', 'fish', 'cookedfish', 'cookedmeat', 'roastedvegetables', 'appletart', 'mushroom', 'rawmeat', 'fishingnet']; // 1x1

    // Define seed types
    const seedItems = ['pineseed', 'appleseed', 'firseed', 'vegetableseeds', 'hempseeds']; // 1x1

    // Define ammo types
    const ammoItems = ['ammo', 'shell']; // 1x1

    // Define animal materials
    const animalMaterials = ['animalskin', 'fabric']; // 2x2

    if (animalMaterials.includes(itemType)) {
        return { width: 2, height: 2 };
    } else if (largeTools.includes(itemType)) {
        return { width: 2, height: 5 };
    } else if (smallTools.includes(itemType)) {
        return { width: 1, height: 2 };
    } else if (woodMaterials.includes(itemType)) {
        return { width: 2, height: 4 };
    } else if (stoneMaterials.includes(itemType)) {
        return { width: 1, height: 1 };
    } else if (metalMaterials.includes(itemType)) {
        return { width: 1, height: 1 };
    } else if (foodItems.includes(itemType)) {
        return { width: 1, height: 1 };
    } else if (seedItems.includes(itemType)) {
        return { width: 1, height: 1 };
    } else if (ammoItems.includes(itemType)) {
        return { width: 1, height: 1 };
    } else {
        // Default to 1x1 for unknown items
        console.warn(`Unknown item type ${itemType}, defaulting to 1x1`);
        return { width: 1, height: 1 };
    }
}

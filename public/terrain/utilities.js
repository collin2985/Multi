// terrain/utilities.js
export const Utilities = {
    mulberry32(seed) {
        return function() {
            let t = seed += 0x6D2B79F5;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    },

    limitCacheSize(cache, maxSize) {
        if (cache.size > maxSize) {
            const keysToDelete = Array.from(cache.keys()).slice(0, cache.size - maxSize);
            keysToDelete.forEach(key => cache.delete(key));
        }
    },

    getChunkRNG(seed, chunkX, chunkZ) {
        const chunkSeed = seed + chunkX * 73856093 + chunkZ * 19349663;
        return Utilities.mulberry32(chunkSeed);
    },

    logError(message, error) {
        console.error(`${message}:`, error);
    }
};
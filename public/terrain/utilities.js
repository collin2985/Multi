





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
        // Remove oldest 25% of entries when limit exceeded
        const entriesToRemove = Math.floor(cache.size * 0.25);
        const keysToDelete = Array.from(cache.keys()).slice(0, entriesToRemove);
        keysToDelete.forEach(key => cache.delete(key));
        
        console.log(`Cache cleanup: removed ${entriesToRemove} entries, ${cache.size} remaining`);
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










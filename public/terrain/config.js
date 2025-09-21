
// terrain/config.js
export const CONFIG = Object.freeze({
    TERRAIN: {
        chunkSize: 50,
        segments: 100,
        renderDistance: 2
    },
    PERFORMANCE: {
        updateThrottle: 100,
        maxCacheSize: 10000
    },
    GRAPHICS: {
        textureSize: 128,
        textureRepeat: 2
    },
    CAMERA: {
        offset: { x: 0, y: 35, z: -20 }
    }
});
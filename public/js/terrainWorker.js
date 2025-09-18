const CONFIG = Object.freeze({
    TERRAIN: {
        chunkSize: 50,
        segments: 25
    }
});

self.onmessage = function(e) {
    try {
        const { type, data } = e.data;
        if (type !== 'calculateHeightBatch') {
            self.postMessage({
                type: 'error',
                data: { message: `Unknown message type: ${type}` }
            });
            return;
        }

        const { points, batchId, seed } = data;
        if (!points || !Array.isArray(points) || !batchId || seed === undefined) {
            self.postMessage({
                type: 'error',
                data: { message: 'Invalid calculateHeightBatch data' }
            });
            return;
        }

        const results = [];
        const scale = 0.1;
        const heightScale = 5;

        // Simple noise function (replace with SimplexNoise or your library if used)
        function noise(x, z, seed) {
            // Placeholder: Import SimplexNoise here if used, e.g.:
            // const noise = new SimplexNoise(seed).noise2D(x * scale, z * scale);
            return Math.sin((x + seed) * scale) * Math.cos((z + seed) * scale) * heightScale;
        }

        for (const point of points) {
            const { x, z, index } = point;
            if (x === undefined || z === undefined || index === undefined) {
                self.postMessage({
                    type: 'error',
                    data: { message: `Invalid point data at index ${index}` }
                });
                continue;
            }
            const height = noise(x, z, seed);
            results.push({ height, index });
        }

        self.postMessage({
            type: 'heightBatchResult',
            data: { results, batchId }
        });
    } catch (error) {
        self.postMessage({
            type: 'error',
            data: { message: `Worker error: ${error.message}` }
        });
    }
};
addTerrainChunk(chunkId) {
    const coords = this.chunkIdToCoords(chunkId);
    const [chunkX, chunkZ] = coords;

    // Check if chunk already exists
    if (this.terrainChunks.has(`${chunkX},${chunkZ}`)) {
        return; 
    }

    const geometry = new THREE.PlaneGeometry(
        CONFIG.TERRAIN.chunkSize,
        CONFIG.TERRAIN.chunkSize,
        CONFIG.TERRAIN.segments,
        CONFIG.TERRAIN.segments
    );
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position.array;
    const pointsToCalculate = [];

    for (let i = 0; i < positions.length; i += 3) {
        const localX = positions[i];
        const localZ = positions[i + 2];

        // ✅ Corrected: add chunk offsets here once
        const worldX = localX + chunkX;
        const worldZ = localZ + chunkZ;

        pointsToCalculate.push({ x: worldX, z: worldZ, index: i });
    }

    if (pointsToCalculate.length > 0) {
        const batchId = chunkId;
        this.pendingChunks.set(batchId, { geometry, chunkX, chunkZ });
        this.terrainWorker.postMessage({
            type: 'calculateHeightBatch',
            data: { points: pointsToCalculate, batchId }
        });
    }
}

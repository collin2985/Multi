/**
 * Visual debug overlay to show navigation grid in 3D
 * Shows where the navigation system thinks obstacles are
 */

function visualizeNavigationGrid(chunkX = 0, chunkZ = 0) {
    const game = window.game;
    if (!game || !game.navigationManager) {
        console.error('Game or NavigationManager not available');
        return;
    }

    // Get THREE from the game's module
    const scene = game.scene;

    // Access THREE from the scene object (it's already imported there)
    const THREE = scene.constructor.THREE || window.THREE;

    // If still not found, try to get it from any mesh in the scene
    if (!THREE) {
        const anyMesh = scene.children.find(child => child.isMesh);
        if (anyMesh) {
            THREE = anyMesh.constructor.THREE;
        } else {
            console.error('Could not find THREE.js library');
            return;
        }
    }

    // Remove old visualization if it exists
    const oldViz = scene.getObjectByName('NavGridVisualization');
    if (oldViz) {
        scene.remove(oldViz);
        oldViz.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
    }

    const chunkId = `chunk_${chunkX},${chunkZ}`;
    const navMap = game.navigationManager.chunkMaps.get(chunkId);

    if (!navMap) {
        console.error(`No navigation map for chunk ${chunkX},${chunkZ}`);
        console.log('Available chunks:', Array.from(game.navigationManager.chunkMaps.keys()));
        return;
    }

    const vizGroup = new THREE.Group();
    vizGroup.name = 'NavGridVisualization';

    // Create materials
    const walkableMat = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide
    });

    const blockedMat = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide
    });

    const roadMat = new THREE.MeshBasicMaterial({
        color: 0xffff00,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide
    });

    // Grid parameters
    const cellSize = 0.5; // 0.5m per cell
    const gridSize = 100;  // 100x100 grid

    // Sample every N cells for performance (1 = show all, 5 = show every 5th cell)
    const sampleRate = 2;

    console.log(`Visualizing navigation grid for chunk (${chunkX}, ${chunkZ})`);
    console.log(`NavMap world origin: (${navMap.worldOriginX}, ${navMap.worldOriginZ})`);

    let walkableCount = 0;
    let blockedCount = 0;
    let roadCount = 0;

    // Create small planes for each cell
    for (let cellZ = 0; cellZ < gridSize; cellZ += sampleRate) {
        for (let cellX = 0; cellX < gridSize; cellX += sampleRate) {
            const index = cellZ * gridSize + cellX;
            const flags = navMap.grid[index];

            const isWalkable = (flags & 1) !== 0;
            const isRoad = (flags & 2) !== 0;
            const isWater = (flags & 4) !== 0;
            const isSteep = (flags & 8) !== 0;

            // Calculate world position
            const worldX = navMap.worldOriginX + (cellX + 0.5) * cellSize;
            const worldZ = navMap.worldOriginZ + (cellZ + 0.5) * cellSize;
            const worldY = game.terrainGenerator.getWorldHeight(worldX, worldZ) + 0.1;

            let material;
            if (!isWalkable) {
                material = blockedMat;
                blockedCount++;
            } else if (isRoad) {
                material = roadMat;
                roadCount++;
            } else {
                material = walkableMat;
                walkableCount++;
            }

            const planeGeom = new THREE.PlaneGeometry(cellSize * sampleRate * 0.9, cellSize * sampleRate * 0.9);
            const plane = new THREE.Mesh(planeGeom, material);
            plane.position.set(worldX, worldY, worldZ);
            plane.rotation.x = -Math.PI / 2;

            vizGroup.add(plane);
        }
    }

    scene.add(vizGroup);

    console.log(`Created navigation visualization:`);
    console.log(`- Walkable cells (green): ${walkableCount}`);
    console.log(`- Blocked cells (red): ${blockedCount}`);
    console.log(`- Road cells (yellow): ${roadCount}`);
    console.log(`Use hideNavigationGrid() to remove the overlay`);

    return vizGroup;
}

function hideNavigationGrid() {
    const game = window.game;
    if (!game) return;

    const scene = game.scene;
    const viz = scene.getObjectByName('NavGridVisualization');
    if (viz) {
        scene.remove(viz);
        viz.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        console.log('Navigation grid visualization removed');
    }
}

// Add marker at specific world position
function addDebugMarker(worldX, worldZ, color = 0x00ffff) {
    const game = window.game;
    if (!game) return;

    const THREE = window.THREE;
    const scene = game.scene;

    // Remove old marker if exists
    const oldMarker = scene.getObjectByName('DebugMarker');
    if (oldMarker) {
        scene.remove(oldMarker);
        oldMarker.geometry.dispose();
        oldMarker.material.dispose();
    }

    const worldY = game.terrainGenerator.getWorldHeight(worldX, worldZ) + 2;

    // Create a tall cylinder as marker
    const geometry = new THREE.CylinderGeometry(0.2, 0.2, 5, 8);
    const material = new THREE.MeshBasicMaterial({ color: color });
    const marker = new THREE.Mesh(geometry, material);
    marker.position.set(worldX, worldY, worldZ);
    marker.name = 'DebugMarker';

    scene.add(marker);
    console.log(`Added debug marker at (${worldX}, ${worldZ})`);
}

// Export functions
window.visualizeNavigationGrid = visualizeNavigationGrid;
window.hideNavigationGrid = hideNavigationGrid;
window.addDebugMarker = addDebugMarker;
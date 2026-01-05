// Signal that worker script started loading
console.log('[NavigationWorker] Script starting...');

const CELL_SIZE = 0.25;
const SQRT2 = 1.41421356;

const nodePool = [];
const MAX_POOL_SIZE = 500;

class Node {
    constructor(worldX, worldZ) {
        this.worldX = worldX;
        this.worldZ = worldZ;
        this.g = 0;
        this.h = 0;
        this.f = 0;
        this.parent = null;
        this.heapIndex = -1;
    }

    reset(worldX, worldZ) {
        this.worldX = worldX;
        this.worldZ = worldZ;
        this.g = 0;
        this.h = 0;
        this.f = 0;
        this.parent = null;
        this.heapIndex = -1;
        return this;
    }
}

function getNode(worldX, worldZ) {
    if (nodePool.length > 0) {
        return nodePool.pop().reset(worldX, worldZ);
    }
    return new Node(worldX, worldZ);
}

function releaseNodes(nodes) {
    for (let i = 0; i < nodes.length && nodePool.length < MAX_POOL_SIZE; i++) {
        nodePool.push(nodes[i]);
    }
}

class MinHeap {
    constructor() {
        this.heap = [];
        this.nodeMap = new Map();
    }

    get length() {
        return this.heap.length;
    }

    insert(key, node) {
        node.heapIndex = this.heap.length;
        this.heap.push(node);
        this.nodeMap.set(key, node);
        this.bubbleUp(node.heapIndex);
    }

    extractMin() {
        if (this.heap.length === 0) return null;
        const min = this.heap[0];
        const last = this.heap.pop();
        if (this.heap.length > 0) {
            this.heap[0] = last;
            last.heapIndex = 0;
            this.bubbleDown(0);
        }
        min.heapIndex = -1;
        return min;
    }

    decreaseKey(node) {
        if (node.heapIndex >= 0) {
            this.bubbleUp(node.heapIndex);
        }
    }

    get(key) {
        return this.nodeMap.get(key);
    }

    removeFromMap(key) {
        this.nodeMap.delete(key);
    }

    bubbleUp(index) {
        const node = this.heap[index];
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2);
            const parent = this.heap[parentIndex];
            if (node.f >= parent.f) break;
            this.heap[index] = parent;
            parent.heapIndex = index;
            index = parentIndex;
        }
        this.heap[index] = node;
        node.heapIndex = index;
    }

    bubbleDown(index) {
        const node = this.heap[index];
        const length = this.heap.length;
        while (true) {
            const leftIndex = 2 * index + 1;
            const rightIndex = 2 * index + 2;
            let smallest = index;
            if (leftIndex < length && this.heap[leftIndex].f < this.heap[smallest].f) {
                smallest = leftIndex;
            }
            if (rightIndex < length && this.heap[rightIndex].f < this.heap[smallest].f) {
                smallest = rightIndex;
            }
            if (smallest === index) break;
            this.heap[index] = this.heap[smallest];
            this.heap[index].heapIndex = index;
            index = smallest;
        }
        this.heap[index] = node;
        node.heapIndex = index;
    }
}

function heuristic(x1, z1, x2, z2) {
    const dx = Math.abs(x1 - x2) / CELL_SIZE;
    const dz = Math.abs(z1 - z2) / CELL_SIZE;
    return dx + dz + (SQRT2 - 2) * Math.min(dx, dz);
}

function snapToCell(worldCoord) {
    return Math.round(worldCoord / CELL_SIZE) * CELL_SIZE;
}

function makeKey(x, z) {
    const ix = Math.round(x / CELL_SIZE) + 500000;
    const iz = Math.round(z / CELL_SIZE) + 500000;
    return ix * 1000000 + iz;
}

const chunkGrids = new Map();

function isWalkable(worldX, worldZ, ignoreSlopes) {
    // Use center-based chunk coordinates (matches ChunkCoordinates.worldToChunk)
    // Chunk (0,0) spans from -25 to +25 on both axes
    const chunkX = Math.floor((worldX + 25) / 50);
    const chunkZ = Math.floor((worldZ + 25) / 50);
    const chunkId = `chunk_${chunkX},${chunkZ}`;

    const chunk = chunkGrids.get(chunkId);
    if (!chunk) return false;

    const localX = worldX - chunk.worldOriginX;
    const localZ = worldZ - chunk.worldOriginZ;
    const cellX = Math.floor(localX / CELL_SIZE);
    const cellZ = Math.floor(localZ / CELL_SIZE);

    if (cellX < 0 || cellX >= 200 || cellZ < 0 || cellZ >= 200) return false;

    const flags = chunk.grid[cellZ * 200 + cellX];

    if (ignoreSlopes) {
        const isObstacle = (flags & 64) !== 0;
        const isWater = (flags & 4) !== 0;
        return !isObstacle && !isWater;
    }

    return (flags & 1) !== 0;
}

function jump(x, z, dx, dz, goalX, goalZ, ignoreSlopes, maxDist = 200) {
    let dist = 0;

    while (dist < maxDist) {
        const nx = x + dx * CELL_SIZE;
        const nz = z + dz * CELL_SIZE;

        if (!isWalkable(nx, nz, ignoreSlopes)) {
            return null;
        }

        x = nx;
        z = nz;
        dist++;

        if (Math.abs(x - goalX) < CELL_SIZE * 0.5 && Math.abs(z - goalZ) < CELL_SIZE * 0.5) {
            return { x, z };
        }

        if (dx !== 0 && dz !== 0) {
            if (!isWalkable(x - dx * CELL_SIZE, z, ignoreSlopes) &&
                isWalkable(x - dx * CELL_SIZE, z + dz * CELL_SIZE, ignoreSlopes)) {
                return { x, z };
            }
            if (!isWalkable(x, z - dz * CELL_SIZE, ignoreSlopes) &&
                isWalkable(x + dx * CELL_SIZE, z - dz * CELL_SIZE, ignoreSlopes)) {
                return { x, z };
            }

            if (jump(x, z, dx, 0, goalX, goalZ, ignoreSlopes, maxDist - dist) !== null ||
                jump(x, z, 0, dz, goalX, goalZ, ignoreSlopes, maxDist - dist) !== null) {
                return { x, z };
            }

            if (!isWalkable(x + dx * CELL_SIZE, z, ignoreSlopes) ||
                !isWalkable(x, z + dz * CELL_SIZE, ignoreSlopes)) {
                return null;
            }
        } else {
            if (dx !== 0) {
                if ((!isWalkable(x, z + CELL_SIZE, ignoreSlopes) &&
                     isWalkable(x + dx * CELL_SIZE, z + CELL_SIZE, ignoreSlopes)) ||
                    (!isWalkable(x, z - CELL_SIZE, ignoreSlopes) &&
                     isWalkable(x + dx * CELL_SIZE, z - CELL_SIZE, ignoreSlopes))) {
                    return { x, z };
                }
            } else {
                if ((!isWalkable(x + CELL_SIZE, z, ignoreSlopes) &&
                     isWalkable(x + CELL_SIZE, z + dz * CELL_SIZE, ignoreSlopes)) ||
                    (!isWalkable(x - CELL_SIZE, z, ignoreSlopes) &&
                     isWalkable(x - CELL_SIZE, z + dz * CELL_SIZE, ignoreSlopes))) {
                    return { x, z };
                }
            }
        }
    }

    return null;
}

function getSuccessors(node, goalX, goalZ, ignoreSlopes) {
    const successors = [];
    const x = node.worldX;
    const z = node.worldZ;

    if (node.parent) {
        const px = node.parent.worldX;
        const pz = node.parent.worldZ;
        const dx = Math.sign(x - px);
        const dz = Math.sign(z - pz);

        if (dx !== 0 && dz !== 0) {
            if (isWalkable(x + dx * CELL_SIZE, z, ignoreSlopes)) {
                const jp = jump(x, z, dx, 0, goalX, goalZ, ignoreSlopes);
                if (jp) successors.push(jp);
            }
            if (isWalkable(x, z + dz * CELL_SIZE, ignoreSlopes)) {
                const jp = jump(x, z, 0, dz, goalX, goalZ, ignoreSlopes);
                if (jp) successors.push(jp);
            }
            if (isWalkable(x + dx * CELL_SIZE, z, ignoreSlopes) &&
                isWalkable(x, z + dz * CELL_SIZE, ignoreSlopes)) {
                const jp = jump(x, z, dx, dz, goalX, goalZ, ignoreSlopes);
                if (jp) successors.push(jp);
            }
            if (!isWalkable(x - dx * CELL_SIZE, z, ignoreSlopes) &&
                isWalkable(x, z + dz * CELL_SIZE, ignoreSlopes)) {
                const jp = jump(x, z, -dx, dz, goalX, goalZ, ignoreSlopes);
                if (jp) successors.push(jp);
            }
            if (!isWalkable(x, z - dz * CELL_SIZE, ignoreSlopes) &&
                isWalkable(x + dx * CELL_SIZE, z, ignoreSlopes)) {
                const jp = jump(x, z, dx, -dz, goalX, goalZ, ignoreSlopes);
                if (jp) successors.push(jp);
            }
        } else if (dx !== 0) {
            if (isWalkable(x + dx * CELL_SIZE, z, ignoreSlopes)) {
                const jp = jump(x, z, dx, 0, goalX, goalZ, ignoreSlopes);
                if (jp) successors.push(jp);
            }
            if (!isWalkable(x, z + CELL_SIZE, ignoreSlopes) &&
                isWalkable(x + dx * CELL_SIZE, z + CELL_SIZE, ignoreSlopes)) {
                const jp = jump(x, z, dx, 1, goalX, goalZ, ignoreSlopes);
                if (jp) successors.push(jp);
            }
            if (!isWalkable(x, z - CELL_SIZE, ignoreSlopes) &&
                isWalkable(x + dx * CELL_SIZE, z - CELL_SIZE, ignoreSlopes)) {
                const jp = jump(x, z, dx, -1, goalX, goalZ, ignoreSlopes);
                if (jp) successors.push(jp);
            }
        } else {
            if (isWalkable(x, z + dz * CELL_SIZE, ignoreSlopes)) {
                const jp = jump(x, z, 0, dz, goalX, goalZ, ignoreSlopes);
                if (jp) successors.push(jp);
            }
            if (!isWalkable(x + CELL_SIZE, z, ignoreSlopes) &&
                isWalkable(x + CELL_SIZE, z + dz * CELL_SIZE, ignoreSlopes)) {
                const jp = jump(x, z, 1, dz, goalX, goalZ, ignoreSlopes);
                if (jp) successors.push(jp);
            }
            if (!isWalkable(x - CELL_SIZE, z, ignoreSlopes) &&
                isWalkable(x - CELL_SIZE, z + dz * CELL_SIZE, ignoreSlopes)) {
                const jp = jump(x, z, -1, dz, goalX, goalZ, ignoreSlopes);
                if (jp) successors.push(jp);
            }
        }
    } else {
        const directions = [
            [1, 0], [-1, 0], [0, 1], [0, -1],
            [1, 1], [1, -1], [-1, 1], [-1, -1]
        ];

        for (const [dx, dz] of directions) {
            if (dx !== 0 && dz !== 0) {
                if (!isWalkable(x + dx * CELL_SIZE, z, ignoreSlopes) ||
                    !isWalkable(x, z + dz * CELL_SIZE, ignoreSlopes)) {
                    continue;
                }
            }

            const jp = jump(x, z, dx, dz, goalX, goalZ, ignoreSlopes);
            if (jp) successors.push(jp);
        }
    }

    return successors;
}

function distance(x1, z1, x2, z2) {
    const dx = Math.abs(x1 - x2) / CELL_SIZE;
    const dz = Math.abs(z1 - z2) / CELL_SIZE;
    return Math.min(dx, dz) * SQRT2 + Math.abs(dx - dz);
}

function reconstructPath(goalNode) {
    const path = [];
    let current = goalNode;

    while (current !== null) {
        path.push({ x: current.worldX, z: current.worldZ });
        current = current.parent;
    }

    path.reverse();
    return path;
}

function findPath(startX, startZ, goalX, goalZ, options = {}) {
    const maxIterations = options.maxIterations || 2000;
    const ignoreSlopes = options.ignoreSlopes || false;

    let startWorldX = snapToCell(startX);
    let startWorldZ = snapToCell(startZ);
    const goalWorldX = snapToCell(goalX);
    const goalWorldZ = snapToCell(goalZ);

    if (!isWalkable(startWorldX, startWorldZ, ignoreSlopes)) {
        const offsets = [
            [0, 1], [1, 0], [0, -1], [-1, 0],
            [1, 1], [-1, -1], [1, -1], [-1, 1]
        ];
        let found = false;
        for (const [dx, dz] of offsets) {
            const nx = startWorldX + dx * CELL_SIZE;
            const nz = startWorldZ + dz * CELL_SIZE;
            if (isWalkable(nx, nz, ignoreSlopes)) {
                startWorldX = nx;
                startWorldZ = nz;
                found = true;
                break;
            }
        }
        if (!found) return null;
    }

    let goalAdjustedX = goalWorldX;
    let goalAdjustedZ = goalWorldZ;

    if (!isWalkable(goalWorldX, goalWorldZ, ignoreSlopes)) {
        let found = false;
        for (let r = 1; r <= 5 && !found; r++) {
            for (let dx = -r; dx <= r && !found; dx++) {
                for (let dz = -r; dz <= r && !found; dz++) {
                    if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
                    const nx = goalWorldX + dx * CELL_SIZE;
                    const nz = goalWorldZ + dz * CELL_SIZE;
                    if (isWalkable(nx, nz, ignoreSlopes)) {
                        goalAdjustedX = nx;
                        goalAdjustedZ = nz;
                        found = true;
                    }
                }
            }
        }
        if (!found) return null;
    }

    if (Math.abs(startWorldX - goalAdjustedX) < CELL_SIZE &&
        Math.abs(startWorldZ - goalAdjustedZ) < CELL_SIZE) {
        return [{ x: startWorldX, z: startWorldZ }];
    }

    const openList = new MinHeap();
    const closedSet = new Set();
    const allNodes = [];

    const startNode = getNode(startWorldX, startWorldZ);
    startNode.g = 0;
    startNode.h = heuristic(startWorldX, startWorldZ, goalAdjustedX, goalAdjustedZ);
    startNode.f = startNode.g + startNode.h;
    allNodes.push(startNode);

    openList.insert(makeKey(startWorldX, startWorldZ), startNode);

    let iterations = 0;
    let result = null;

    while (openList.length > 0 && iterations < maxIterations) {
        iterations++;

        const current = openList.extractMin();
        const currentKey = makeKey(current.worldX, current.worldZ);

        openList.removeFromMap(currentKey);
        closedSet.add(currentKey);

        if (Math.abs(current.worldX - goalAdjustedX) < CELL_SIZE * 0.5 &&
            Math.abs(current.worldZ - goalAdjustedZ) < CELL_SIZE * 0.5) {
            result = reconstructPath(current);
            break;
        }

        const successors = getSuccessors(current, goalAdjustedX, goalAdjustedZ, ignoreSlopes);

        for (const successor of successors) {
            const key = makeKey(successor.x, successor.z);

            if (closedSet.has(key)) continue;

            const g = current.g + distance(current.worldX, current.worldZ, successor.x, successor.z);

            let node = openList.get(key);

            if (!node) {
                node = getNode(successor.x, successor.z);
                node.g = g;
                node.h = heuristic(successor.x, successor.z, goalAdjustedX, goalAdjustedZ);
                node.f = node.g + node.h;
                node.parent = current;
                allNodes.push(node);
                openList.insert(key, node);
            } else if (g < node.g) {
                node.g = g;
                node.f = node.g + node.h;
                node.parent = current;
                openList.decreaseKey(node);
            }
        }
    }

    releaseNodes(allNodes);

    return result;
}

// Debug: track registered chunks and failed path requests
let debugPathFailCount = 0;
let debugLastLogTime = 0;

self.onmessage = function(e) {
    const { type, requestId } = e.data;

    switch (type) {
        case 'register_chunk': {
            const { chunkId, chunkX, chunkZ, worldOriginX, worldOriginZ, grid, version } = e.data;
            chunkGrids.set(chunkId, {
                grid: new Uint8Array(grid),
                chunkX, chunkZ, worldOriginX, worldOriginZ,
                version: version || 0
            });
            console.log(`[NavWorker] Registered ${chunkId}, total chunks: ${chunkGrids.size}`);
            break;
        }

        case 'unregister_chunk': {
            chunkGrids.delete(e.data.chunkId);
            break;
        }

        case 'find_path': {
            const { startX, startZ, goalX, goalZ, maxIterations, ignoreSlopes } = e.data;
            const path = findPath(startX, startZ, goalX, goalZ, { maxIterations, ignoreSlopes });

            // Debug: log path failures (throttled to avoid spam)
            if (!path) {
                debugPathFailCount++;
                const now = Date.now();
                if (now - debugLastLogTime > 5000) {
                    const startChunkX = Math.floor((startX + 25) / 50);
                    const startChunkZ = Math.floor((startZ + 25) / 50);
                    const startChunkId = `chunk_${startChunkX},${startChunkZ}`;
                    const hasStartChunk = chunkGrids.has(startChunkId);
                    console.warn(`[NavWorker] ${debugPathFailCount} path failures. Last: (${startX.toFixed(1)},${startZ.toFixed(1)}) -> (${goalX.toFixed(1)},${goalZ.toFixed(1)}), chunk ${startChunkId} exists: ${hasStartChunk}, total chunks: ${chunkGrids.size}`);
                    debugPathFailCount = 0;
                    debugLastLogTime = now;
                }
            }

            self.postMessage({ type: 'path_result', requestId, path });
            break;
        }
    }
};

console.log('[NavigationWorker] Script fully loaded and ready');

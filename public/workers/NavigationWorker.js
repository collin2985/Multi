// SYNC: Must match NAV_CONFIG.GRID_RESOLUTION in NavigationMap.js
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

// Last-chunk cache: avoids string allocation + Map lookup on ~99% of isWalkable calls
let _lastChunkX = NaN;
let _lastChunkZ = NaN;
let _lastChunk = null;

function isWalkable(worldX, worldZ, ignoreSlopes, ignoreObstacles) {
    // Use center-based chunk coordinates (matches ChunkCoordinates.worldToChunk)
    // Chunk (0,0) spans from -25 to +25 on both axes
    const chunkX = Math.floor((worldX + 25) / 50);
    const chunkZ = Math.floor((worldZ + 25) / 50);

    let chunk;
    if (chunkX === _lastChunkX && chunkZ === _lastChunkZ) {
        chunk = _lastChunk;
    } else {
        chunk = chunkGrids.get(`chunk_${chunkX},${chunkZ}`);
        _lastChunkX = chunkX;
        _lastChunkZ = chunkZ;
        _lastChunk = chunk;
    }

    if (!chunk) return false;

    const localX = worldX - chunk.worldOriginX;
    const localZ = worldZ - chunk.worldOriginZ;
    const cellX = Math.floor(localX / CELL_SIZE);
    const cellZ = Math.floor(localZ / CELL_SIZE);

    if (cellX < 0 || cellX >= 200 || cellZ < 0 || cellZ >= 200) return false;

    const flags = chunk.grid[cellZ * 200 + cellX];

    // ignoreObstacles: only water blocks (for force-return-home)
    if (ignoreObstacles) {
        return (flags & 4) === 0; // only water blocks
    }

    if (ignoreSlopes) {
        const isObstacle = (flags & 64) !== 0;
        const isWater = (flags & 4) !== 0;
        return !isObstacle && !isWater;
    }

    return (flags & 1) !== 0;
}

function jump(x, z, dx, dz, goalX, goalZ, ignoreSlopes, ignoreObstacles, maxDist = 200) {
    let dist = 0;

    while (dist < maxDist) {
        const nx = x + dx * CELL_SIZE;
        const nz = z + dz * CELL_SIZE;

        // Diagonal: prevent corner cutting BEFORE stepping
        if (dx !== 0 && dz !== 0) {
            if (!isWalkable(x + dx * CELL_SIZE, z, ignoreSlopes, ignoreObstacles) ||
                !isWalkable(x, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                return null;
            }
        }

        if (!isWalkable(nx, nz, ignoreSlopes, ignoreObstacles)) {
            return null;
        }

        x = nx;
        z = nz;
        dist++;

        if (Math.abs(x - goalX) < CELL_SIZE * 0.5 && Math.abs(z - goalZ) < CELL_SIZE * 0.5) {
            return { x, z };
        }

        if (dx !== 0 && dz !== 0) {
            if (!isWalkable(x - dx * CELL_SIZE, z, ignoreSlopes, ignoreObstacles) &&
                isWalkable(x - dx * CELL_SIZE, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                return { x, z };
            }
            if (!isWalkable(x, z - dz * CELL_SIZE, ignoreSlopes, ignoreObstacles) &&
                isWalkable(x + dx * CELL_SIZE, z - dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                return { x, z };
            }

            if (jump(x, z, dx, 0, goalX, goalZ, ignoreSlopes, ignoreObstacles, maxDist - dist) !== null ||
                jump(x, z, 0, dz, goalX, goalZ, ignoreSlopes, ignoreObstacles, maxDist - dist) !== null) {
                return { x, z };
            }
        } else {
            if (dx !== 0) {
                if ((!isWalkable(x, z + CELL_SIZE, ignoreSlopes, ignoreObstacles) &&
                     isWalkable(x + dx * CELL_SIZE, z + CELL_SIZE, ignoreSlopes, ignoreObstacles)) ||
                    (!isWalkable(x, z - CELL_SIZE, ignoreSlopes, ignoreObstacles) &&
                     isWalkable(x + dx * CELL_SIZE, z - CELL_SIZE, ignoreSlopes, ignoreObstacles))) {
                    return { x, z };
                }
            } else {
                if ((!isWalkable(x + CELL_SIZE, z, ignoreSlopes, ignoreObstacles) &&
                     isWalkable(x + CELL_SIZE, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) ||
                    (!isWalkable(x - CELL_SIZE, z, ignoreSlopes, ignoreObstacles) &&
                     isWalkable(x - CELL_SIZE, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles))) {
                    return { x, z };
                }
            }
        }
    }

    return null;
}

function getSuccessors(node, goalX, goalZ, ignoreSlopes, ignoreObstacles) {
    const successors = [];
    const x = node.worldX;
    const z = node.worldZ;

    if (node.parent) {
        const px = node.parent.worldX;
        const pz = node.parent.worldZ;
        const dx = Math.sign(x - px);
        const dz = Math.sign(z - pz);

        // Guard against parent at same position (shouldn't happen)
        if (dx === 0 && dz === 0) {
            return successors;
        }

        if (dx !== 0 && dz !== 0) {
            if (isWalkable(x + dx * CELL_SIZE, z, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(x, z, dx, 0, goalX, goalZ, ignoreSlopes, ignoreObstacles);
                if (jp) successors.push(jp);
            }
            if (isWalkable(x, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(x, z, 0, dz, goalX, goalZ, ignoreSlopes, ignoreObstacles);
                if (jp) successors.push(jp);
            }
            if (isWalkable(x + dx * CELL_SIZE, z, ignoreSlopes, ignoreObstacles) &&
                isWalkable(x, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(x, z, dx, dz, goalX, goalZ, ignoreSlopes, ignoreObstacles);
                if (jp) successors.push(jp);
            }
            if (!isWalkable(x - dx * CELL_SIZE, z, ignoreSlopes, ignoreObstacles) &&
                isWalkable(x, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(x, z, -dx, dz, goalX, goalZ, ignoreSlopes, ignoreObstacles);
                if (jp) successors.push(jp);
            }
            if (!isWalkable(x, z - dz * CELL_SIZE, ignoreSlopes, ignoreObstacles) &&
                isWalkable(x + dx * CELL_SIZE, z, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(x, z, dx, -dz, goalX, goalZ, ignoreSlopes, ignoreObstacles);
                if (jp) successors.push(jp);
            }
        } else if (dx !== 0) {
            if (isWalkable(x + dx * CELL_SIZE, z, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(x, z, dx, 0, goalX, goalZ, ignoreSlopes, ignoreObstacles);
                if (jp) successors.push(jp);
            }
            if (!isWalkable(x, z + CELL_SIZE, ignoreSlopes, ignoreObstacles) &&
                isWalkable(x + dx * CELL_SIZE, z + CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(x, z, dx, 1, goalX, goalZ, ignoreSlopes, ignoreObstacles);
                if (jp) successors.push(jp);
            }
            if (!isWalkable(x, z - CELL_SIZE, ignoreSlopes, ignoreObstacles) &&
                isWalkable(x + dx * CELL_SIZE, z - CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(x, z, dx, -1, goalX, goalZ, ignoreSlopes, ignoreObstacles);
                if (jp) successors.push(jp);
            }
        } else {
            if (isWalkable(x, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(x, z, 0, dz, goalX, goalZ, ignoreSlopes, ignoreObstacles);
                if (jp) successors.push(jp);
            }
            if (!isWalkable(x + CELL_SIZE, z, ignoreSlopes, ignoreObstacles) &&
                isWalkable(x + CELL_SIZE, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(x, z, 1, dz, goalX, goalZ, ignoreSlopes, ignoreObstacles);
                if (jp) successors.push(jp);
            }
            if (!isWalkable(x - CELL_SIZE, z, ignoreSlopes, ignoreObstacles) &&
                isWalkable(x - CELL_SIZE, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(x, z, -1, dz, goalX, goalZ, ignoreSlopes, ignoreObstacles);
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
                if (!isWalkable(x + dx * CELL_SIZE, z, ignoreSlopes, ignoreObstacles) ||
                    !isWalkable(x, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                    continue;
                }
            }

            const jp = jump(x, z, dx, dz, goalX, goalZ, ignoreSlopes, ignoreObstacles);
            if (jp) successors.push(jp);
        }
    }

    // JPS fallback: if no jump points found, add immediate walkable neighbors
    // directly (standard A* behavior). This handles tight spaces around buildings
    // where JPS fails because jumps terminate before finding forced neighbors.
    if (successors.length === 0) {
        const fallbackDirs = [
            [1, 0], [-1, 0], [0, 1], [0, -1],
            [1, 1], [1, -1], [-1, 1], [-1, -1]
        ];
        for (const [fdx, fdz] of fallbackDirs) {
            const nx = x + fdx * CELL_SIZE;
            const nz = z + fdz * CELL_SIZE;
            if (fdx !== 0 && fdz !== 0) {
                if (!isWalkable(x + fdx * CELL_SIZE, z, ignoreSlopes, ignoreObstacles) ||
                    !isWalkable(x, z + fdz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                    continue;
                }
            }
            if (isWalkable(nx, nz, ignoreSlopes, ignoreObstacles)) {
                successors.push({ x: nx, z: nz });
            }
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

/**
 * Check if two points have line-of-sight (no obstacles between them)
 * Used for path smoothing to remove unnecessary waypoints
 */
function hasLineOfSight(x1, z1, x2, z2, ignoreSlopes, ignoreObstacles) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const steps = Math.ceil(dist / CELL_SIZE);

    if (steps === 0) return true;

    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const x = x1 + dx * t;
        const z = z1 + dz * t;
        if (!isWalkable(x, z, ignoreSlopes, ignoreObstacles)) {
            return false;
        }
    }
    return true;
}

/**
 * Smooth a path by removing unnecessary waypoints using string-pulling
 * Checks line-of-sight between non-adjacent waypoints and skips intermediate ones
 */
function smoothPath(path, ignoreSlopes, ignoreObstacles) {
    if (!path || path.length <= 2) return path;

    const smoothed = [path[0]];
    let current = 0;

    while (current < path.length - 1) {
        let furthest = current + 1;

        // Find furthest visible waypoint
        for (let i = current + 2; i < path.length; i++) {
            if (hasLineOfSight(
                path[current].x, path[current].z,
                path[i].x, path[i].z,
                ignoreSlopes, ignoreObstacles
            )) {
                furthest = i;
            }
            // Continue checking - later waypoints may be visible even if this one isn't
        }

        smoothed.push(path[furthest]);
        current = furthest;
    }

    return smoothed;
}

// DEBUG: throttled failure reason tracking
let _dbgLastFailLog = 0;

function findPath(startX, startZ, goalX, goalZ, options = {}) {
    const maxIterations = options.maxIterations || 5000;
    const ignoreSlopes = options.ignoreSlopes || false;
    const ignoreObstacles = options.ignoreObstacles || false;

    // Pre-check: verify goal chunk is registered (avoid wasting iterations flooding start chunk)
    const goalChunkX = Math.floor((goalX + 25) / 50);
    const goalChunkZ = Math.floor((goalZ + 25) / 50);
    const goalChunkId = `chunk_${goalChunkX},${goalChunkZ}`;
    if (!chunkGrids.has(goalChunkId)) {
        return null;
    }

    let startWorldX = snapToCell(startX);
    let startWorldZ = snapToCell(startZ);
    const goalWorldX = snapToCell(goalX);
    const goalWorldZ = snapToCell(goalZ);

    if (!isWalkable(startWorldX, startWorldZ, ignoreSlopes, ignoreObstacles)) {
        let found = false;
        for (let r = 1; r <= 5 && !found; r++) {
            for (let dx = -r; dx <= r && !found; dx++) {
                for (let dz = -r; dz <= r && !found; dz++) {
                    if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
                    const nx = startWorldX + dx * CELL_SIZE;
                    const nz = startWorldZ + dz * CELL_SIZE;
                    if (isWalkable(nx, nz, ignoreSlopes, ignoreObstacles)) {
                        startWorldX = nx;
                        startWorldZ = nz;
                        found = true;
                    }
                }
            }
        }
        if (!found) {
            const now = Date.now();
            if (now - _dbgLastFailLog > 10000) {
                _dbgLastFailLog = now;
                const sChunkX = Math.floor((startX + 25) / 50);
                const sChunkZ = Math.floor((startZ + 25) / 50);
                const hasChunk = chunkGrids.has(`chunk_${sChunkX},${sChunkZ}`);
                console.warn(`[NavWorker:DIAG] START blocked | pos=(${startX.toFixed(1)},${startZ.toFixed(1)}) | chunk(${sChunkX},${sChunkZ}) exists=${hasChunk} | totalChunks=${chunkGrids.size}`);
            }
            return null;
        }
    }

    let goalAdjustedX = goalWorldX;
    let goalAdjustedZ = goalWorldZ;

    if (!isWalkable(goalWorldX, goalWorldZ, ignoreSlopes, ignoreObstacles)) {
        let found = false;
        for (let r = 1; r <= 5 && !found; r++) {
            for (let dx = -r; dx <= r && !found; dx++) {
                for (let dz = -r; dz <= r && !found; dz++) {
                    if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
                    const nx = goalWorldX + dx * CELL_SIZE;
                    const nz = goalWorldZ + dz * CELL_SIZE;
                    if (isWalkable(nx, nz, ignoreSlopes, ignoreObstacles)) {
                        goalAdjustedX = nx;
                        goalAdjustedZ = nz;
                        found = true;
                    }
                }
            }
        }
        if (!found) {
            const now = Date.now();
            if (now - _dbgLastFailLog > 10000) {
                _dbgLastFailLog = now;
                const gChunkX = Math.floor((goalX + 25) / 50);
                const gChunkZ = Math.floor((goalZ + 25) / 50);
                const hasChunk = chunkGrids.has(`chunk_${gChunkX},${gChunkZ}`);
                console.warn(`[NavWorker:DIAG] GOAL blocked | goal=(${goalX.toFixed(1)},${goalZ.toFixed(1)}) | chunk(${gChunkX},${gChunkZ}) exists=${hasChunk} | totalChunks=${chunkGrids.size}`);
            }
            return null;
        }
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

        const successors = getSuccessors(current, goalAdjustedX, goalAdjustedZ, ignoreSlopes, ignoreObstacles);

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

    // Partial path: if full path not found, return path to closest explored node
    if (!result && allNodes.length > 1) {
        let bestNode = null;
        let bestH = startNode.h;
        for (let i = 0; i < allNodes.length; i++) {
            const node = allNodes[i];
            if (node.h < bestH && node.parent) {
                bestH = node.h;
                bestNode = node;
            }
        }
        // Only return partial if we gain at least 12 cells of progress
        if (bestNode && (startNode.h - bestH) > 12) {
            result = reconstructPath(bestNode);
        }
    }

    // DEBUG: log when A* exhausts iterations without finding path
    if (!result && iterations >= maxIterations) {
        const now = Date.now();
        if (now - _dbgLastFailLog > 10000) {
            _dbgLastFailLog = now;
            const sChunkX = Math.floor((startX + 25) / 50);
            const sChunkZ = Math.floor((startZ + 25) / 50);
            const gChunkX = Math.floor((goalX + 25) / 50);
            const gChunkZ = Math.floor((goalZ + 25) / 50);
            const crossChunk = (sChunkX !== gChunkX || sChunkZ !== gChunkZ) ? ' CROSS-CHUNK' : '';
            console.warn(`[NavWorker:DIAG] A* exhausted ${iterations} iterations | start=(${startX.toFixed(1)},${startZ.toFixed(1)}) chunk(${sChunkX},${sChunkZ}) -> goal=(${goalX.toFixed(1)},${goalZ.toFixed(1)}) chunk(${gChunkX},${gChunkZ}) exists=${chunkGrids.has(`chunk_${gChunkX},${gChunkZ}`)} | closedSet=${closedSet.size}${crossChunk}`);
        }
    } else if (!result && openList.length === 0) {
        const now = Date.now();
        if (now - _dbgLastFailLog > 10000) {
            _dbgLastFailLog = now;
            console.warn(`[NavWorker:DIAG] A* no path (open list empty) | start=(${startX.toFixed(1)},${startZ.toFixed(1)}) -> goal=(${goalX.toFixed(1)},${goalZ.toFixed(1)}) | explored=${closedSet.size}`);

            // When start is trapped in a small pocket, dump cell flags for neighbors
            if (closedSet.size < 10) {
                const dirs = [[1,0,'E'],[-1,0,'W'],[0,1,'S'],[0,-1,'N'],[1,1,'SE'],[1,-1,'NE'],[-1,1,'SW'],[-1,-1,'NW']];
                const neighborInfo = [];
                for (const [dx, dz, label] of dirs) {
                    const nx = startWorldX + dx * CELL_SIZE;
                    const nz = startWorldZ + dz * CELL_SIZE;
                    const cX = Math.floor((nx + 25) / 50);
                    const cZ = Math.floor((nz + 25) / 50);
                    const cId = `chunk_${cX},${cZ}`;
                    const chunk = chunkGrids.get(cId);
                    if (!chunk) {
                        neighborInfo.push(`${label}:NO_CHUNK(${cId})`);
                    } else {
                        const lx = Math.floor((nx - chunk.worldOriginX) / CELL_SIZE);
                        const lz = Math.floor((nz - chunk.worldOriginZ) / CELL_SIZE);
                        if (lx < 0 || lx >= 200 || lz < 0 || lz >= 200) {
                            neighborInfo.push(`${label}:OOB(${lx},${lz})`);
                        } else {
                            const f = chunk.grid[lz * 200 + lx];
                            const tags = [];
                            if (f & 1) tags.push('W');
                            if (f & 4) tags.push('water');
                            if (f & 64) tags.push('obs');
                            if (f === 0) tags.push('ZERO');
                            neighborInfo.push(`${label}:0x${f.toString(16)}[${tags.join('+')}]`);
                        }
                    }
                }
                // Also dump the start cell flags
                const sChunkId = `chunk_${Math.floor((startWorldX + 25) / 50)},${Math.floor((startWorldZ + 25) / 50)}`;
                const sChunk = chunkGrids.get(sChunkId);
                let startFlags = 'NO_CHUNK';
                if (sChunk) {
                    const slx = Math.floor((startWorldX - sChunk.worldOriginX) / CELL_SIZE);
                    const slz = Math.floor((startWorldZ - sChunk.worldOriginZ) / CELL_SIZE);
                    if (slx >= 0 && slx < 200 && slz >= 0 && slz < 200) {
                        startFlags = '0x' + sChunk.grid[slz * 200 + slx].toString(16);
                    } else {
                        startFlags = `OOB(${slx},${slz})`;
                    }
                }
                // Also check goal cell flags
                const gChunkId = `chunk_${Math.floor((goalAdjustedX + 25) / 50)},${Math.floor((goalAdjustedZ + 25) / 50)}`;
                const gChunk = chunkGrids.get(gChunkId);
                let goalFlags = 'NO_CHUNK';
                if (gChunk) {
                    const glx = Math.floor((goalAdjustedX - gChunk.worldOriginX) / CELL_SIZE);
                    const glz = Math.floor((goalAdjustedZ - gChunk.worldOriginZ) / CELL_SIZE);
                    if (glx >= 0 && glx < 200 && glz >= 0 && glz < 200) {
                        goalFlags = '0x' + gChunk.grid[glz * 200 + glx].toString(16);
                    }
                }

                // Sample a 5x5 area around start to show the pocket shape
                const sChunkForSample = chunkGrids.get(sChunkId);
                let gridSample = '';
                if (sChunkForSample) {
                    const scx = Math.floor((startWorldX - sChunkForSample.worldOriginX) / CELL_SIZE);
                    const scz = Math.floor((startWorldZ - sChunkForSample.worldOriginZ) / CELL_SIZE);
                    const rows = [];
                    for (let dz = -2; dz <= 2; dz++) {
                        let row = '';
                        for (let dx = -2; dx <= 2; dx++) {
                            const cx = scx + dx;
                            const cz = scz + dz;
                            if (cx < 0 || cx >= 200 || cz < 0 || cz >= 200) { row += '?'; continue; }
                            const f = sChunkForSample.grid[cz * 200 + cx];
                            if (dx === 0 && dz === 0) row += 'S'; // start
                            else if (f & 64) row += 'X'; // obstacle
                            else if (f & 4) row += '~'; // water
                            else if (f & 1) row += '.'; // walkable
                            else row += '#'; // blocked (no walkable flag)
                        }
                        rows.push(row);
                    }
                    gridSample = rows.join('|');
                }
                console.warn(`[NavWorker:DIAG] Start TRAPPED (explored=${closedSet.size}) | start=(${startWorldX.toFixed(2)},${startWorldZ.toFixed(2)}) flags=${startFlags} goal=(${goalAdjustedX.toFixed(2)},${goalAdjustedZ.toFixed(2)}) goalFlags=${goalFlags} goalChunk=${gChunkId} | neighbors: ${neighborInfo.join(' ')} | 5x5grid: ${gridSample}`);
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
            const parsedGrid = new Uint8Array(grid);
            chunkGrids.set(chunkId, {
                grid: parsedGrid,
                chunkX, chunkZ, worldOriginX, worldOriginZ,
                version: version || 0
            });
            let wc = 0, obsCount = 0, waterCount = 0, zeroCount = 0;
            for (let i = 0; i < parsedGrid.length; i++) {
                const f = parsedGrid[i];
                if (f & 1) wc++;
                if (f & 64) obsCount++;
                if (f & 4) waterCount++;
                if (f === 0) zeroCount++;
            }
            break;
        }

        case 'unregister_chunk': {
            chunkGrids.delete(e.data.chunkId);
            break;
        }

        case 'update_chunk': {
            const { chunkId, grid } = e.data;
            const chunk = chunkGrids.get(chunkId);
            if (chunk) {
                chunk.grid = new Uint8Array(grid);
                chunk.version = (chunk.version || 0) + 1;
            }
            break;
        }

        case 'update_cells': {
            const { chunkId, changes } = e.data;
            const chunk = chunkGrids.get(chunkId);
            if (chunk) {
                for (const { index, flags } of changes) {
                    chunk.grid[index] = flags;
                }
                chunk.version = (chunk.version || 0) + 1;
            }
            break;
        }

        case 'find_path': {
            const { startX, startZ, goalX, goalZ, maxIterations, ignoreSlopes, ignoreObstacles } = e.data;
            let path = findPath(startX, startZ, goalX, goalZ, { maxIterations, ignoreSlopes, ignoreObstacles });

            // Smooth path to remove unnecessary waypoints (string-pulling)
            if (path && path.length > 2) {
                path = smoothPath(path, ignoreSlopes, ignoreObstacles);
            }

            // Debug: log path failures (throttled to avoid spam)
            if (!path) {
                debugPathFailCount++;
                const now = Date.now();
                if (now - debugLastLogTime > 5000) {
                    const startChunkX = Math.floor((startX + 25) / 50);
                    const startChunkZ = Math.floor((startZ + 25) / 50);
                    const startChunkId = `chunk_${startChunkX},${startChunkZ}`;
                    const goalChunkX2 = Math.floor((goalX + 25) / 50);
                    const goalChunkZ2 = Math.floor((goalZ + 25) / 50);
                    const goalChunkId = `chunk_${goalChunkX2},${goalChunkZ2}`;
                    const hasStartChunk = chunkGrids.has(startChunkId);
                    const hasGoalChunk = chunkGrids.has(goalChunkId);
                    console.warn(`[NavWorker] ${debugPathFailCount} path failures. Last: (${startX.toFixed(1)},${startZ.toFixed(1)}) -> (${goalX.toFixed(1)},${goalZ.toFixed(1)}), startChunk ${startChunkId}: ${hasStartChunk}, goalChunk ${goalChunkId}: ${hasGoalChunk}, total chunks: ${chunkGrids.size}`);
                    debugPathFailCount = 0;
                    debugLastLogTime = now;
                }
            }

            self.postMessage({ type: 'path_result', requestId, path });
            break;
        }
    }
};

/**
 * AStar.js - Jump Point Search (JPS) Pathfinding
 *
 * JPS is an optimization of A* for uniform-cost grids.
 * Instead of exploring every cell, it "jumps" over empty space
 * to find key decision points (jump points).
 *
 * Performance: ~10-100x faster than standard A* on open terrain
 */

import { NAV_CONFIG } from './NavigationMap.js';

const CELL_SIZE = NAV_CONFIG.GRID_RESOLUTION;
const SQRT2 = 1.41421356;

// Node pool to reduce garbage collection
const nodePool = [];
const MAX_POOL_SIZE = 500;

/**
 * Node for JPS pathfinding
 */
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

/**
 * MinHeap for priority queue
 */
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

/**
 * Octile distance heuristic (optimal for 8-directional movement)
 */
function heuristic(x1, z1, x2, z2) {
    const dx = Math.abs(x1 - x2) / CELL_SIZE;
    const dz = Math.abs(z1 - z2) / CELL_SIZE;
    return dx + dz + (SQRT2 - 2) * Math.min(dx, dz);
}

/**
 * Snap world coordinate to cell center
 */
function snapToCell(worldCoord) {
    return Math.round(worldCoord / CELL_SIZE) * CELL_SIZE;
}

/**
 * Make a node key from coordinates (numeric for performance)
 * Uses bit manipulation to create unique integer key
 */
function makeKey(x, z) {
    // Round to cell precision and create numeric key
    // Assumes coords are within ±500000 range
    const ix = Math.round(x / CELL_SIZE) + 500000;
    const iz = Math.round(z / CELL_SIZE) + 500000;
    return ix * 1000000 + iz;
}

/**
 * Check if position is walkable
 * @param {NavigationManager} navManager
 * @param {number} x
 * @param {number} z
 * @param {boolean} ignoreSlopes - If true, use isPassableIgnoreSlope instead
 * @param {boolean} ignoreObstacles - If true, only water blocks (for force-return-home)
 */
function isWalkable(navManager, x, z, ignoreSlopes = false, ignoreObstacles = false) {
    if (ignoreObstacles && navManager.isPassableIgnoreObstacles) {
        return navManager.isPassableIgnoreObstacles(x, z);
    }
    if (ignoreSlopes && navManager.isPassableIgnoreSlope) {
        return navManager.isPassableIgnoreSlope(x, z);
    }
    return navManager.isWalkable(x, z);
}

/**
 * Jump in a direction until we hit an obstacle, goal, or jump point
 * Returns the jump point position or null if blocked
 */
function jump(navManager, x, z, dx, dz, goalX, goalZ, ignoreSlopes, ignoreObstacles, maxDist = 200) {
    let dist = 0;

    while (dist < maxDist) {
        const nx = x + dx * CELL_SIZE;
        const nz = z + dz * CELL_SIZE;

        // Diagonal: prevent corner cutting BEFORE stepping
        if (dx !== 0 && dz !== 0) {
            if (!isWalkable(navManager, x + dx * CELL_SIZE, z, ignoreSlopes, ignoreObstacles) ||
                !isWalkable(navManager, x, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                return null;
            }
        }

        // Hit obstacle or out of bounds
        if (!isWalkable(navManager, nx, nz, ignoreSlopes, ignoreObstacles)) {
            return null;
        }

        x = nx;
        z = nz;
        dist++;

        // Reached goal
        if (Math.abs(x - goalX) < CELL_SIZE * 0.5 && Math.abs(z - goalZ) < CELL_SIZE * 0.5) {
            return { x, z };
        }

        // Diagonal movement
        if (dx !== 0 && dz !== 0) {
            // Check for forced neighbors
            // Blocked horizontally but open diagonally
            if (!isWalkable(navManager, x - dx * CELL_SIZE, z, ignoreSlopes, ignoreObstacles) &&
                isWalkable(navManager, x - dx * CELL_SIZE, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                return { x, z };
            }
            // Blocked vertically but open diagonally
            if (!isWalkable(navManager, x, z - dz * CELL_SIZE, ignoreSlopes, ignoreObstacles) &&
                isWalkable(navManager, x + dx * CELL_SIZE, z - dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                return { x, z };
            }

            // For diagonal, also check horizontal and vertical jumps
            if (jump(navManager, x, z, dx, 0, goalX, goalZ, ignoreSlopes, ignoreObstacles, maxDist - dist) !== null ||
                jump(navManager, x, z, 0, dz, goalX, goalZ, ignoreSlopes, ignoreObstacles, maxDist - dist) !== null) {
                return { x, z };
            }
        } else {
            // Cardinal movement - check for forced neighbors
            if (dx !== 0) {
                // Moving horizontally
                if ((!isWalkable(navManager, x, z + CELL_SIZE, ignoreSlopes, ignoreObstacles) &&
                     isWalkable(navManager, x + dx * CELL_SIZE, z + CELL_SIZE, ignoreSlopes, ignoreObstacles)) ||
                    (!isWalkable(navManager, x, z - CELL_SIZE, ignoreSlopes, ignoreObstacles) &&
                     isWalkable(navManager, x + dx * CELL_SIZE, z - CELL_SIZE, ignoreSlopes, ignoreObstacles))) {
                    return { x, z };
                }
            } else {
                // Moving vertically
                if ((!isWalkable(navManager, x + CELL_SIZE, z, ignoreSlopes, ignoreObstacles) &&
                     isWalkable(navManager, x + CELL_SIZE, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) ||
                    (!isWalkable(navManager, x - CELL_SIZE, z, ignoreSlopes, ignoreObstacles) &&
                     isWalkable(navManager, x - CELL_SIZE, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles))) {
                    return { x, z };
                }
            }
        }
    }

    return null; // Max distance reached
}

/**
 * Get successors (jump points) from current position
 */
function getSuccessors(navManager, node, goalX, goalZ, ignoreSlopes, ignoreObstacles) {
    const successors = [];
    const x = node.worldX;
    const z = node.worldZ;

    // If we have a parent, prune based on direction
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
            // Diagonal: natural neighbors are in direction of travel
            // Horizontal
            if (isWalkable(navManager, x + dx * CELL_SIZE, z, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(navManager, x, z, dx, 0, goalX, goalZ, ignoreSlopes, ignoreObstacles);
                if (jp) successors.push(jp);
            }
            // Vertical
            if (isWalkable(navManager, x, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(navManager, x, z, 0, dz, goalX, goalZ, ignoreSlopes, ignoreObstacles);
                if (jp) successors.push(jp);
            }
            // Diagonal
            if (isWalkable(navManager, x + dx * CELL_SIZE, z, ignoreSlopes, ignoreObstacles) &&
                isWalkable(navManager, x, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(navManager, x, z, dx, dz, goalX, goalZ, ignoreSlopes, ignoreObstacles);
                if (jp) successors.push(jp);
            }
            // Forced neighbors
            if (!isWalkable(navManager, x - dx * CELL_SIZE, z, ignoreSlopes, ignoreObstacles) &&
                isWalkable(navManager, x, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(navManager, x, z, -dx, dz, goalX, goalZ, ignoreSlopes, ignoreObstacles);
                if (jp) successors.push(jp);
            }
            if (!isWalkable(navManager, x, z - dz * CELL_SIZE, ignoreSlopes, ignoreObstacles) &&
                isWalkable(navManager, x + dx * CELL_SIZE, z, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(navManager, x, z, dx, -dz, goalX, goalZ, ignoreSlopes, ignoreObstacles);
                if (jp) successors.push(jp);
            }
        } else if (dx !== 0) {
            // Horizontal movement
            if (isWalkable(navManager, x + dx * CELL_SIZE, z, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(navManager, x, z, dx, 0, goalX, goalZ, ignoreSlopes, ignoreObstacles);
                if (jp) successors.push(jp);
            }
            // Forced neighbors
            if (!isWalkable(navManager, x, z + CELL_SIZE, ignoreSlopes, ignoreObstacles) &&
                isWalkable(navManager, x + dx * CELL_SIZE, z + CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(navManager, x, z, dx, 1, goalX, goalZ, ignoreSlopes, ignoreObstacles);
                if (jp) successors.push(jp);
            }
            if (!isWalkable(navManager, x, z - CELL_SIZE, ignoreSlopes, ignoreObstacles) &&
                isWalkable(navManager, x + dx * CELL_SIZE, z - CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(navManager, x, z, dx, -1, goalX, goalZ, ignoreSlopes, ignoreObstacles);
                if (jp) successors.push(jp);
            }
        } else {
            // Vertical movement
            if (isWalkable(navManager, x, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(navManager, x, z, 0, dz, goalX, goalZ, ignoreSlopes, ignoreObstacles);
                if (jp) successors.push(jp);
            }
            // Forced neighbors
            if (!isWalkable(navManager, x + CELL_SIZE, z, ignoreSlopes, ignoreObstacles) &&
                isWalkable(navManager, x + CELL_SIZE, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(navManager, x, z, 1, dz, goalX, goalZ, ignoreSlopes, ignoreObstacles);
                if (jp) successors.push(jp);
            }
            if (!isWalkable(navManager, x - CELL_SIZE, z, ignoreSlopes, ignoreObstacles) &&
                isWalkable(navManager, x - CELL_SIZE, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                const jp = jump(navManager, x, z, -1, dz, goalX, goalZ, ignoreSlopes, ignoreObstacles);
                if (jp) successors.push(jp);
            }
        }
    } else {
        // No parent - explore all 8 directions
        const directions = [
            [1, 0], [-1, 0], [0, 1], [0, -1],
            [1, 1], [1, -1], [-1, 1], [-1, -1]
        ];

        for (const [dx, dz] of directions) {
            // For diagonal, check if we can move
            if (dx !== 0 && dz !== 0) {
                if (!isWalkable(navManager, x + dx * CELL_SIZE, z, ignoreSlopes, ignoreObstacles) ||
                    !isWalkable(navManager, x, z + dz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                    continue; // Can't cut corner
                }
            }

            const jp = jump(navManager, x, z, dx, dz, goalX, goalZ, ignoreSlopes, ignoreObstacles);
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
                if (!isWalkable(navManager, x + fdx * CELL_SIZE, z, ignoreSlopes, ignoreObstacles) ||
                    !isWalkable(navManager, x, z + fdz * CELL_SIZE, ignoreSlopes, ignoreObstacles)) {
                    continue;
                }
            }
            if (isWalkable(navManager, nx, nz, ignoreSlopes, ignoreObstacles)) {
                successors.push({ x: nx, z: nz });
            }
        }
    }

    return successors;
}

/**
 * Calculate distance between two points
 */
function distance(x1, z1, x2, z2) {
    const dx = Math.abs(x1 - x2) / CELL_SIZE;
    const dz = Math.abs(z1 - z2) / CELL_SIZE;
    return Math.min(dx, dz) * SQRT2 + Math.abs(dx - dz);
}

/**
 * Check line of sight between two points
 */
function hasLineOfSight(navManager, x1, z1, x2, z2, ignoreSlopes, ignoreObstacles) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const steps = Math.ceil(dist / CELL_SIZE);
    if (steps === 0) return true;
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const x = x1 + dx * t;
        const z = z1 + dz * t;
        if (!isWalkable(navManager, x, z, ignoreSlopes, ignoreObstacles)) return false;
    }
    return true;
}

/**
 * Smooth path to remove unnecessary waypoints via line-of-sight checks
 */
function smoothPath(navManager, path, ignoreSlopes, ignoreObstacles) {
    if (!path || path.length <= 2) return path;
    const smoothed = [path[0]];
    let current = 0;
    while (current < path.length - 1) {
        let furthest = current + 1;
        for (let i = current + 2; i < path.length; i++) {
            if (hasLineOfSight(navManager, path[current].x, path[current].z, path[i].x, path[i].z, ignoreSlopes, ignoreObstacles)) {
                furthest = i;
            }
        }
        smoothed.push(path[furthest]);
        current = furthest;
    }
    return smoothed;
}

/**
 * Find path using Jump Point Search
 *
 * @param {NavigationManager} navigationManager - Navigation manager
 * @param {number} startX - Start X (world coordinates)
 * @param {number} startZ - Start Z (world coordinates)
 * @param {number} goalX - Goal X (world coordinates)
 * @param {number} goalZ - Goal Z (world coordinates)
 * @param {number|object} maxIterationsOrOptions - Safety limit (default 2000) or options object
 * @param {number} maxIterationsOrOptions.maxIterations - Safety limit
 * @param {boolean} maxIterationsOrOptions.ignoreSlopes - If true, ignore slope blocking (for AI that can traverse slopes)
 * @returns {Array|null} Path as [{x, z}, ...] or null
 */
export function findPath(navigationManager, startX, startZ, goalX, goalZ, maxIterationsOrOptions = 5000) {
    // Parse options
    let maxIterations = 5000;
    let ignoreSlopes = false;
    let ignoreObstacles = false;
    if (typeof maxIterationsOrOptions === 'object') {
        maxIterations = maxIterationsOrOptions.maxIterations || 5000;
        ignoreSlopes = maxIterationsOrOptions.ignoreSlopes || false;
        ignoreObstacles = maxIterationsOrOptions.ignoreObstacles || false;
    } else {
        maxIterations = maxIterationsOrOptions;
    }

    // Snap to grid
    let startWorldX = snapToCell(startX);
    let startWorldZ = snapToCell(startZ);
    const goalWorldX = snapToCell(goalX);
    const goalWorldZ = snapToCell(goalZ);

    // Validate start - find walkable neighbor if blocked (expanding ring up to 5 cells)
    if (!isWalkable(navigationManager, startWorldX, startWorldZ, ignoreSlopes, ignoreObstacles)) {
        let found = false;
        for (let r = 1; r <= 5 && !found; r++) {
            for (let dx = -r; dx <= r && !found; dx++) {
                for (let dz = -r; dz <= r && !found; dz++) {
                    if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
                    const nx = startWorldX + dx * CELL_SIZE;
                    const nz = startWorldZ + dz * CELL_SIZE;
                    if (isWalkable(navigationManager, nx, nz, ignoreSlopes, ignoreObstacles)) {
                        startWorldX = nx;
                        startWorldZ = nz;
                        found = true;
                    }
                }
            }
        }
        if (!found) return null;
    }

    // Validate goal - find walkable neighbor if blocked
    let goalAdjustedX = goalWorldX;
    let goalAdjustedZ = goalWorldZ;

    if (!isWalkable(navigationManager, goalWorldX, goalWorldZ, ignoreSlopes, ignoreObstacles)) {
        let found = false;
        for (let r = 1; r <= 5 && !found; r++) {
            for (let dx = -r; dx <= r && !found; dx++) {
                for (let dz = -r; dz <= r && !found; dz++) {
                    if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
                    const nx = goalWorldX + dx * CELL_SIZE;
                    const nz = goalWorldZ + dz * CELL_SIZE;
                    if (isWalkable(navigationManager, nx, nz, ignoreSlopes, ignoreObstacles)) {
                        goalAdjustedX = nx;
                        goalAdjustedZ = nz;
                        found = true;
                    }
                }
            }
        }
        if (!found) return null;
    }

    // Already at goal?
    if (Math.abs(startWorldX - goalAdjustedX) < CELL_SIZE &&
        Math.abs(startWorldZ - goalAdjustedZ) < CELL_SIZE) {
        return [{ x: startWorldX, z: startWorldZ }];
    }

    // Initialize
    const openList = new MinHeap();
    const closedSet = new Set();
    const allNodes = []; // Track all nodes for pooling

    const startNode = getNode(startWorldX, startWorldZ);
    startNode.g = 0;
    startNode.h = heuristic(startWorldX, startWorldZ, goalAdjustedX, goalAdjustedZ);
    startNode.f = startNode.g + startNode.h;
    allNodes.push(startNode);

    openList.insert(makeKey(startWorldX, startWorldZ), startNode);

    // Main JPS loop
    let iterations = 0;
    let result = null;

    while (openList.length > 0 && iterations < maxIterations) {
        iterations++;

        const current = openList.extractMin();
        const currentKey = makeKey(current.worldX, current.worldZ);

        openList.removeFromMap(currentKey);
        closedSet.add(currentKey);

        // Check goal
        if (Math.abs(current.worldX - goalAdjustedX) < CELL_SIZE * 0.5 &&
            Math.abs(current.worldZ - goalAdjustedZ) < CELL_SIZE * 0.5) {
            result = reconstructPath(current);
            break;
        }

        // Get jump point successors
        const successors = getSuccessors(navigationManager, current, goalAdjustedX, goalAdjustedZ, ignoreSlopes, ignoreObstacles);

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

    // Smooth path to remove unnecessary waypoints
    if (result && result.length > 2) {
        result = smoothPath(navigationManager, result, ignoreSlopes, ignoreObstacles);
    }

    // Release nodes back to pool
    releaseNodes(allNodes);

    return result;
}

/**
 * Reconstruct path from goal to start
 */
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

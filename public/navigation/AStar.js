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
 * Make a node key from coordinates
 */
function makeKey(x, z) {
    return `${x.toFixed(2)},${z.toFixed(2)}`;
}

/**
 * Check if position is walkable
 */
function isWalkable(navManager, x, z) {
    return navManager.isWalkable(x, z);
}

/**
 * Jump in a direction until we hit an obstacle, goal, or jump point
 * Returns the jump point position or null if blocked
 */
function jump(navManager, x, z, dx, dz, goalX, goalZ, maxDist = 200) {
    let dist = 0;

    while (dist < maxDist) {
        const nx = x + dx * CELL_SIZE;
        const nz = z + dz * CELL_SIZE;

        // Hit obstacle or out of bounds
        if (!isWalkable(navManager, nx, nz)) {
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
            if (!isWalkable(navManager, x - dx * CELL_SIZE, z) &&
                isWalkable(navManager, x - dx * CELL_SIZE, z + dz * CELL_SIZE)) {
                return { x, z };
            }
            // Blocked vertically but open diagonally
            if (!isWalkable(navManager, x, z - dz * CELL_SIZE) &&
                isWalkable(navManager, x + dx * CELL_SIZE, z - dz * CELL_SIZE)) {
                return { x, z };
            }

            // For diagonal, also check horizontal and vertical jumps
            if (jump(navManager, x, z, dx, 0, goalX, goalZ, maxDist - dist) !== null ||
                jump(navManager, x, z, 0, dz, goalX, goalZ, maxDist - dist) !== null) {
                return { x, z };
            }

            // Check if we can continue diagonally
            if (!isWalkable(navManager, x + dx * CELL_SIZE, z) ||
                !isWalkable(navManager, x, z + dz * CELL_SIZE)) {
                return null; // Can't cut corner
            }
        } else {
            // Cardinal movement - check for forced neighbors
            if (dx !== 0) {
                // Moving horizontally
                if ((!isWalkable(navManager, x, z + CELL_SIZE) &&
                     isWalkable(navManager, x + dx * CELL_SIZE, z + CELL_SIZE)) ||
                    (!isWalkable(navManager, x, z - CELL_SIZE) &&
                     isWalkable(navManager, x + dx * CELL_SIZE, z - CELL_SIZE))) {
                    return { x, z };
                }
            } else {
                // Moving vertically
                if ((!isWalkable(navManager, x + CELL_SIZE, z) &&
                     isWalkable(navManager, x + CELL_SIZE, z + dz * CELL_SIZE)) ||
                    (!isWalkable(navManager, x - CELL_SIZE, z) &&
                     isWalkable(navManager, x - CELL_SIZE, z + dz * CELL_SIZE))) {
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
function getSuccessors(navManager, node, goalX, goalZ) {
    const successors = [];
    const x = node.worldX;
    const z = node.worldZ;

    // If we have a parent, prune based on direction
    if (node.parent) {
        const px = node.parent.worldX;
        const pz = node.parent.worldZ;
        const dx = Math.sign(x - px);
        const dz = Math.sign(z - pz);

        if (dx !== 0 && dz !== 0) {
            // Diagonal: natural neighbors are in direction of travel
            // Horizontal
            if (isWalkable(navManager, x + dx * CELL_SIZE, z)) {
                const jp = jump(navManager, x, z, dx, 0, goalX, goalZ);
                if (jp) successors.push(jp);
            }
            // Vertical
            if (isWalkable(navManager, x, z + dz * CELL_SIZE)) {
                const jp = jump(navManager, x, z, 0, dz, goalX, goalZ);
                if (jp) successors.push(jp);
            }
            // Diagonal
            if (isWalkable(navManager, x + dx * CELL_SIZE, z) &&
                isWalkable(navManager, x, z + dz * CELL_SIZE)) {
                const jp = jump(navManager, x, z, dx, dz, goalX, goalZ);
                if (jp) successors.push(jp);
            }
            // Forced neighbors
            if (!isWalkable(navManager, x - dx * CELL_SIZE, z) &&
                isWalkable(navManager, x, z + dz * CELL_SIZE)) {
                const jp = jump(navManager, x, z, -dx, dz, goalX, goalZ);
                if (jp) successors.push(jp);
            }
            if (!isWalkable(navManager, x, z - dz * CELL_SIZE) &&
                isWalkable(navManager, x + dx * CELL_SIZE, z)) {
                const jp = jump(navManager, x, z, dx, -dz, goalX, goalZ);
                if (jp) successors.push(jp);
            }
        } else if (dx !== 0) {
            // Horizontal movement
            if (isWalkable(navManager, x + dx * CELL_SIZE, z)) {
                const jp = jump(navManager, x, z, dx, 0, goalX, goalZ);
                if (jp) successors.push(jp);
            }
            // Forced neighbors
            if (!isWalkable(navManager, x, z + CELL_SIZE) &&
                isWalkable(navManager, x + dx * CELL_SIZE, z + CELL_SIZE)) {
                const jp = jump(navManager, x, z, dx, 1, goalX, goalZ);
                if (jp) successors.push(jp);
            }
            if (!isWalkable(navManager, x, z - CELL_SIZE) &&
                isWalkable(navManager, x + dx * CELL_SIZE, z - CELL_SIZE)) {
                const jp = jump(navManager, x, z, dx, -1, goalX, goalZ);
                if (jp) successors.push(jp);
            }
        } else {
            // Vertical movement
            if (isWalkable(navManager, x, z + dz * CELL_SIZE)) {
                const jp = jump(navManager, x, z, 0, dz, goalX, goalZ);
                if (jp) successors.push(jp);
            }
            // Forced neighbors
            if (!isWalkable(navManager, x + CELL_SIZE, z) &&
                isWalkable(navManager, x + CELL_SIZE, z + dz * CELL_SIZE)) {
                const jp = jump(navManager, x, z, 1, dz, goalX, goalZ);
                if (jp) successors.push(jp);
            }
            if (!isWalkable(navManager, x - CELL_SIZE, z) &&
                isWalkable(navManager, x - CELL_SIZE, z + dz * CELL_SIZE)) {
                const jp = jump(navManager, x, z, -1, dz, goalX, goalZ);
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
                if (!isWalkable(navManager, x + dx * CELL_SIZE, z) ||
                    !isWalkable(navManager, x, z + dz * CELL_SIZE)) {
                    continue; // Can't cut corner
                }
            }

            const jp = jump(navManager, x, z, dx, dz, goalX, goalZ);
            if (jp) successors.push(jp);
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
 * Find path using Jump Point Search
 *
 * @param {NavigationManager} navigationManager - Navigation manager
 * @param {number} startX - Start X (world coordinates)
 * @param {number} startZ - Start Z (world coordinates)
 * @param {number} goalX - Goal X (world coordinates)
 * @param {number} goalZ - Goal Z (world coordinates)
 * @param {number} maxIterations - Safety limit (default 2000, JPS needs fewer)
 * @returns {Array|null} Path as [{x, z}, ...] or null
 */
export function findPath(navigationManager, startX, startZ, goalX, goalZ, maxIterations = 2000) {
    // Snap to grid
    let startWorldX = snapToCell(startX);
    let startWorldZ = snapToCell(startZ);
    const goalWorldX = snapToCell(goalX);
    const goalWorldZ = snapToCell(goalZ);

    // Validate start - find walkable neighbor if blocked
    if (!isWalkable(navigationManager, startWorldX, startWorldZ)) {
        const offsets = [
            [0, 1], [1, 0], [0, -1], [-1, 0],
            [1, 1], [-1, -1], [1, -1], [-1, 1]
        ];
        let found = false;
        for (const [dx, dz] of offsets) {
            const nx = startWorldX + dx * CELL_SIZE;
            const nz = startWorldZ + dz * CELL_SIZE;
            if (isWalkable(navigationManager, nx, nz)) {
                startWorldX = nx;
                startWorldZ = nz;
                found = true;
                break;
            }
        }
        if (!found) return null;
    }

    // Validate goal - find walkable neighbor if blocked
    let goalAdjustedX = goalWorldX;
    let goalAdjustedZ = goalWorldZ;

    if (!isWalkable(navigationManager, goalWorldX, goalWorldZ)) {
        let found = false;
        for (let r = 1; r <= 5 && !found; r++) {
            for (let dx = -r; dx <= r && !found; dx++) {
                for (let dz = -r; dz <= r && !found; dz++) {
                    if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
                    const nx = goalWorldX + dx * CELL_SIZE;
                    const nz = goalWorldZ + dz * CELL_SIZE;
                    if (isWalkable(navigationManager, nx, nz)) {
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

    const startNode = new Node(startWorldX, startWorldZ);
    startNode.g = 0;
    startNode.h = heuristic(startWorldX, startWorldZ, goalAdjustedX, goalAdjustedZ);
    startNode.f = startNode.g + startNode.h;

    openList.insert(makeKey(startWorldX, startWorldZ), startNode);

    // Main JPS loop
    let iterations = 0;

    while (openList.length > 0 && iterations < maxIterations) {
        iterations++;

        const current = openList.extractMin();
        const currentKey = makeKey(current.worldX, current.worldZ);

        openList.removeFromMap(currentKey);
        closedSet.add(currentKey);

        // Check goal
        if (Math.abs(current.worldX - goalAdjustedX) < CELL_SIZE * 0.5 &&
            Math.abs(current.worldZ - goalAdjustedZ) < CELL_SIZE * 0.5) {
            return reconstructPath(current);
        }

        // Get jump point successors
        const successors = getSuccessors(navigationManager, current, goalAdjustedX, goalAdjustedZ);

        for (const successor of successors) {
            const key = makeKey(successor.x, successor.z);

            if (closedSet.has(key)) continue;

            const g = current.g + distance(current.worldX, current.worldZ, successor.x, successor.z);

            let node = openList.get(key);

            if (!node) {
                node = new Node(successor.x, successor.z);
                node.g = g;
                node.h = heuristic(successor.x, successor.z, goalAdjustedX, goalAdjustedZ);
                node.f = node.g + node.h;
                node.parent = current;
                openList.insert(key, node);
            } else if (g < node.g) {
                node.g = g;
                node.f = node.g + node.h;
                node.parent = current;
                openList.decreaseKey(node);
            }
        }
    }

    // No path found
    return null;
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

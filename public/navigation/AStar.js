/**
 * AStar.js
 * A* pathfinding algorithm for navigation
 *
 * UPDATED: Now supports cross-chunk pathfinding using NavigationManager
 * OPTIMIZED: Uses MinHeap for O(log n) operations instead of O(n)
 *
 * How A* works:
 * 1. Start at the START position
 * 2. Look at all neighboring cells (8 directions: up, down, left, right, diagonals)
 * 3. Calculate a "score" for each neighbor:
 *    - G cost: How far we've traveled from START
 *    - H cost: Estimated distance remaining to GOAL (straight line)
 *    - F cost: G + H (total estimated cost)
 * 4. Always explore the cell with the LOWEST F cost next
 * 5. Repeat until we reach GOAL
 * 6. Trace back the path we took
 */

// Cell size in world units (matches NavigationMap grid resolution)
const CELL_SIZE = 0.5;

/**
 * Node represents a single cell in the pathfinding search
 * Now uses world coordinates for cross-chunk support
 */
class Node {
    constructor(worldX, worldZ) {
        this.worldX = worldX;  // World X coordinate
        this.worldZ = worldZ;  // World Z coordinate

        this.g = 0;          // Cost from START to this node
        this.h = 0;          // Estimated cost from this node to GOAL (heuristic)
        this.f = 0;          // Total cost (g + h)

        this.parent = null;  // Previous node in the path (used to trace back the route)
        this.heapIndex = -1; // Index in the heap for O(log n) updates
    }
}

/**
 * MinHeap implementation for efficient A* open list
 * Provides O(log n) insert, extract-min, and decrease-key operations
 */
class MinHeap {
    constructor() {
        this.heap = [];
        this.nodeMap = new Map(); // key -> node for O(1) lookup
    }

    get length() {
        return this.heap.length;
    }

    /**
     * Insert a node into the heap
     * @param {string} key - Unique key for the node
     * @param {Node} node - The node to insert
     */
    insert(key, node) {
        node.heapIndex = this.heap.length;
        this.heap.push(node);
        this.nodeMap.set(key, node);
        this.bubbleUp(node.heapIndex);
    }

    /**
     * Extract and return the node with minimum F cost
     * @returns {Node|null} The minimum node or null if empty
     */
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

    /**
     * Update a node's position after its F cost decreased
     * @param {Node} node - The node that was updated
     */
    decreaseKey(node) {
        if (node.heapIndex >= 0) {
            this.bubbleUp(node.heapIndex);
        }
    }

    /**
     * Check if a key exists in the heap
     * @param {string} key - The key to check
     * @returns {Node|undefined} The node or undefined
     */
    get(key) {
        return this.nodeMap.get(key);
    }

    /**
     * Remove a key from the map (called when node moves to closed set)
     * @param {string} key - The key to remove from map
     */
    removeFromMap(key) {
        this.nodeMap.delete(key);
    }

    /**
     * Bubble up a node to maintain heap property
     * @param {number} index - Index of the node to bubble up
     */
    bubbleUp(index) {
        const node = this.heap[index];

        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2);
            const parent = this.heap[parentIndex];

            if (node.f >= parent.f) break;

            // Swap with parent
            this.heap[index] = parent;
            parent.heapIndex = index;
            index = parentIndex;
        }

        this.heap[index] = node;
        node.heapIndex = index;
    }

    /**
     * Bubble down a node to maintain heap property
     * @param {number} index - Index of the node to bubble down
     */
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

            // Swap with smallest child
            this.heap[index] = this.heap[smallest];
            this.heap[index].heapIndex = index;
            index = smallest;
        }

        this.heap[index] = node;
        node.heapIndex = index;
    }
}

/**
 * Calculate straight-line distance between two points (heuristic for A*)
 * Uses Chebyshev distance for diagonal movement
 *
 * @param {number} x1 - First point X (world coordinates)
 * @param {number} z1 - First point Z (world coordinates)
 * @param {number} x2 - Second point X (world coordinates)
 * @param {number} z2 - Second point Z (world coordinates)
 * @returns {number} Distance in cell units
 */
function heuristic(x1, z1, x2, z2) {
    // Convert world distance to cell distance for heuristic
    const dx = Math.abs(x1 - x2) / CELL_SIZE;
    const dz = Math.abs(z1 - z2) / CELL_SIZE;
    return Math.max(dx, dz);
}

/**
 * Snap world coordinate to nearest cell center
 * This ensures consistent node keys across chunks
 */
function snapToCell(worldCoord) {
    return Math.round(worldCoord / CELL_SIZE) * CELL_SIZE;
}

/**
 * Find a path from start to goal using A* algorithm
 * CROSS-CHUNK VERSION: Works across multiple chunks using NavigationManager
 * OPTIMIZED: Uses MinHeap for O(log n) operations
 *
 * @param {NavigationManager} navigationManager - Navigation manager for cross-chunk queries
 * @param {number} startX - Start position in world coordinates
 * @param {number} startZ - Start position in world coordinates
 * @param {number} goalX - Goal position in world coordinates
 * @param {number} goalZ - Goal position in world coordinates
 * @param {number} maxIterations - Safety limit to prevent infinite loops (default 2000)
 * @returns {Array|null} Array of waypoints [{x, z}, ...] or null if no path found
 */
export function findPath(navigationManager, startX, startZ, goalX, goalZ, maxIterations = 4000) {
    // STEP 1: Snap coordinates to cell grid for consistent node keys
    let startWorldX = snapToCell(startX);
    let startWorldZ = snapToCell(startZ);
    const goalWorldX = snapToCell(goalX);
    const goalWorldZ = snapToCell(goalZ);

    // STEP 2: Validate start and goal positions using NavigationManager
    // FIX: If start is blocked, search for nearest walkable neighbor
    if (!navigationManager.isWalkable(startWorldX, startWorldZ)) {
        console.warn('[AStar] Start position blocked, searching neighbors...');
        let foundNeighbor = false;

        // Check 8 neighbors (in world coordinates, using CELL_SIZE)
        const neighborOffsets = [
            {x: 0, z: CELL_SIZE},
            {x: CELL_SIZE, z: 0},
            {x: 0, z: -CELL_SIZE},
            {x: -CELL_SIZE, z: 0},
            {x: CELL_SIZE, z: CELL_SIZE},
            {x: -CELL_SIZE, z: -CELL_SIZE},
            {x: CELL_SIZE, z: -CELL_SIZE},
            {x: -CELL_SIZE, z: CELL_SIZE}
        ];

        for (const offset of neighborOffsets) {
            const nx = startWorldX + offset.x;
            const nz = startWorldZ + offset.z;

            if (navigationManager.isWalkable(nx, nz)) {
                // Found a valid spot nearby! Use this as start.
                startWorldX = nx;
                startWorldZ = nz;
                foundNeighbor = true;
                console.log('[AStar] Found walkable neighbor at', nx.toFixed(1), nz.toFixed(1));
                break;
            }
        }

        if (!foundNeighbor) {
            console.warn('[AStar] Start position is strictly not walkable (no neighbors free)');
            return null;
        }
    }

    // FIX: If goal is blocked, search for nearest walkable neighbor
    let goalAdjustedX = goalWorldX;
    let goalAdjustedZ = goalWorldZ;

    if (!navigationManager.isWalkable(goalWorldX, goalWorldZ)) {
        console.warn('[AStar] Goal position blocked, searching neighbors...');
        let foundGoalNeighbor = false;

        // Search in expanding rings (up to 3 cells out)
        for (let radius = 1; radius <= 3 && !foundGoalNeighbor; radius++) {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    // Only check perimeter of each ring
                    if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;

                    const nx = goalWorldX + dx * CELL_SIZE;
                    const nz = goalWorldZ + dz * CELL_SIZE;

                    if (navigationManager.isWalkable(nx, nz)) {
                        goalAdjustedX = nx;
                        goalAdjustedZ = nz;
                        foundGoalNeighbor = true;
                        console.log('[AStar] Found walkable goal neighbor at', nx.toFixed(1), nz.toFixed(1));
                        break;
                    }
                }
                if (foundGoalNeighbor) break;
            }
        }

        if (!foundGoalNeighbor) {
            console.warn('[AStar] Goal position is strictly not walkable (no neighbors free)');
            return null;
        }
    }

    // STEP 3: Initialize data structures
    const openList = new MinHeap();  // Priority queue for O(log n) operations
    const closedSet = new Set();     // Nodes we've already explored (key: "x,z")

    // Create the starting node
    const startNode = new Node(startWorldX, startWorldZ);
    startNode.g = 0;
    startNode.h = heuristic(startWorldX, startWorldZ, goalAdjustedX, goalAdjustedZ);
    startNode.f = startNode.g + startNode.h;

    const startKey = `${startWorldX.toFixed(1)},${startWorldZ.toFixed(1)}`;
    openList.insert(startKey, startNode);

    // STEP 4: Main A* loop
    let iterations = 0;

    while (openList.length > 0 && iterations < maxIterations) {
        iterations++;

        // Extract node with lowest F cost - O(log n)
        const currentNode = openList.extractMin();
        const currentKey = `${currentNode.worldX.toFixed(1)},${currentNode.worldZ.toFixed(1)}`;

        // Remove from map and add to closed set
        openList.removeFromMap(currentKey);
        closedSet.add(currentKey);

        // STEP 5: Check if we reached the goal
        if (Math.abs(currentNode.worldX - goalAdjustedX) < CELL_SIZE * 0.5 &&
            Math.abs(currentNode.worldZ - goalAdjustedZ) < CELL_SIZE * 0.5) {
            // SUCCESS! Trace back the path
            return reconstructPath(currentNode);
        }

        // STEP 6: Explore all neighbors (8 directions)
        const neighbors = getNeighbors(currentNode.worldX, currentNode.worldZ);

        for (const neighbor of neighbors) {
            const neighborX = neighbor.x;
            const neighborZ = neighbor.z;
            const neighborKey = `${neighborX.toFixed(1)},${neighborZ.toFixed(1)}`;

            // Skip if already explored
            if (closedSet.has(neighborKey)) {
                continue;
            }

            // Skip if not walkable (NavigationManager handles cross-chunk lookup)
            if (!navigationManager.isWalkable(neighborX, neighborZ)) {
                continue;
            }

            // Prevent diagonal corner-cutting
            // For diagonal moves, both adjacent cardinal directions must be walkable
            if (neighbor.isDiagonal) {
                const dx = neighborX - currentNode.worldX; // CELL_SIZE or -CELL_SIZE
                const dz = neighborZ - currentNode.worldZ; // CELL_SIZE or -CELL_SIZE

                // Check the two cardinal cells adjacent to this diagonal
                const cardinalX = currentNode.worldX + dx; // Horizontal neighbor
                const cardinalZ = currentNode.worldZ + dz; // Vertical neighbor

                if (!navigationManager.isWalkable(cardinalX, currentNode.worldZ) ||
                    !navigationManager.isWalkable(currentNode.worldX, cardinalZ)) {
                    // Can't cut this corner - one of the adjacent cells is blocked
                    continue;
                }
            }

            // Calculate cost to reach this neighbor
            const isDiagonal = neighbor.isDiagonal;
            const movementCost = isDiagonal ? 1.414 : 1.0; // Diagonal movement costs √2 ≈ 1.414
            const terrainCost = navigationManager.getMovementCost(neighborX, neighborZ) || 1.0;
            const gCost = currentNode.g + (movementCost * terrainCost);

            // Check if node is already in open list - O(1)
            let neighborNode = openList.get(neighborKey);

            if (!neighborNode) {
                // New node - add to open list - O(log n)
                neighborNode = new Node(neighborX, neighborZ);
                neighborNode.g = gCost;
                neighborNode.h = heuristic(neighborX, neighborZ, goalAdjustedX, goalAdjustedZ);
                neighborNode.f = neighborNode.g + neighborNode.h;
                neighborNode.parent = currentNode;

                openList.insert(neighborKey, neighborNode);
            } else if (gCost < neighborNode.g) {
                // Found a better path to this node - update it - O(log n)
                neighborNode.g = gCost;
                neighborNode.f = neighborNode.g + neighborNode.h;
                neighborNode.parent = currentNode;
                openList.decreaseKey(neighborNode);
            }
        }
    }

    // STEP 7: No path found
    if (iterations >= maxIterations) {
        console.warn('[AStar] Max iterations reached, no path found');
    } else {
        console.warn('[AStar] No path exists from start to goal');
    }
    return null;
}

/**
 * Get all 8 neighboring cells (up, down, left, right, and 4 diagonals)
 * Returns world coordinates offset by CELL_SIZE
 *
 * @param {number} worldX - World X coordinate
 * @param {number} worldZ - World Z coordinate
 * @returns {Array} Array of neighbor positions in world coordinates
 */
function getNeighbors(worldX, worldZ) {
    return [
        // Cardinal directions (cost = 1.0)
        { x: worldX + CELL_SIZE, z: worldZ, isDiagonal: false },     // Right
        { x: worldX - CELL_SIZE, z: worldZ, isDiagonal: false },     // Left
        { x: worldX, z: worldZ + CELL_SIZE, isDiagonal: false },     // Down
        { x: worldX, z: worldZ - CELL_SIZE, isDiagonal: false },     // Up

        // Diagonal directions (cost = 1.414)
        { x: worldX + CELL_SIZE, z: worldZ + CELL_SIZE, isDiagonal: true },  // Down-Right
        { x: worldX + CELL_SIZE, z: worldZ - CELL_SIZE, isDiagonal: true },  // Up-Right
        { x: worldX - CELL_SIZE, z: worldZ + CELL_SIZE, isDiagonal: true },  // Down-Left
        { x: worldX - CELL_SIZE, z: worldZ - CELL_SIZE, isDiagonal: true }   // Up-Left
    ];
}

/**
 * Trace back the path from goal to start using parent references
 * Then reverse it to get start-to-goal order
 *
 * @param {Node} goalNode - The final node (goal position)
 * @returns {Array} Array of waypoints in world coordinates [{x, z}, ...]
 */
function reconstructPath(goalNode) {
    const path = [];
    let currentNode = goalNode;

    // Trace backwards from goal to start
    while (currentNode !== null) {
        // Already in world coordinates
        path.push({ x: currentNode.worldX, z: currentNode.worldZ });
        currentNode = currentNode.parent;
    }

    // Reverse the path so it goes from start to goal
    path.reverse();

    console.log(`[AStar] Path found with ${path.length} waypoints`);
    return path;
}

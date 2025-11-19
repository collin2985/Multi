/**
 * PathfindingTestAI.js
 * Simple AI to test A* pathfinding - NO COMBAT, just navigation
 *
 * What it does:
 * 1. Spawns at a position
 * 2. Picks ONE random target (15-30 units away)
 * 3. Uses A* to calculate path
 * 4. Follows waypoints
 * 5. Stops when it reaches the goal
 *
 * Restart the game to test a different random target
 */

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { modelManager } from './objects.js';
import { findPath } from './navigation/AStar.js';

export class PathfindingTestAI {
    constructor(game, scene, spawnPosition) {
        this.game = game;
        this.scene = scene;

        // Store initial spawn position (will find walkable position near here)
        this.initialSpawnPosition = spawnPosition.clone();
        this.hasFoundWalkableSpawn = false;

        // Create a visual marker for the AI (simple group)
        this.entity = new THREE.Group();
        this.entity.position.copy(spawnPosition);
        this.scene.add(this.entity);

        // Scale (same as player for consistency)
        this.scale = 0.0325;

        // Movement settings
        this.speed = 0.0003; // Units per millisecond (base speed)
        this.rotationSpeed = 0.005; // Radians per frame

        // Terrain speed modifier (cached for performance)
        this.cachedSpeedMultiplier = 1.0;
        this.frameCounter = 0;

        // Pathfinding state
        this.path = null;           // Array of waypoints [{x, z}, ...]
        this.currentWaypointIndex = 0; // Which waypoint we're moving toward
        this.targetPosition = null; // Final goal position
        this.isMoving = false;
        this.reachedGoal = false;

        // Visual debug (optional - can be enabled/disabled)
        this.debugLines = null;

        // Animation support
        this.animationMixer = null;
        this.walkAction = null;

        // Pathfinding initialization state
        this.navMapsReady = false;
        this.pathfindingInitialized = false;

        // Load the model and setup
        this.setupModel();

        // Don't calculate path yet - will happen in update() once nav maps are ready
    }

    setupModel() {
        const manGLTF = modelManager.getGLTF('man2'); // Using man2 to distinguish from regular AI
        if (!manGLTF) {
            console.error('[PathfindingTestAI] man2 model not loaded');
            return;
        }

        // Clone the model
        const mesh = SkeletonUtils.clone(manGLTF.scene);
        mesh.scale.set(this.scale, this.scale, this.scale);

        // Make it a different color so we can distinguish it (bright green)
        mesh.traverse((child) => {
            if (child.isMesh || child.isSkinnedMesh) {
                child.visible = true;
                child.frustumCulled = false;

                if (child.material) {
                    // Clone material and make it green
                    child.material = child.material.clone();
                    child.material.color.setHex(0x00ff00); // Bright green
                }
            }
        });

        this.entity.add(mesh);

        // Setup animations
        if (manGLTF.animations && manGLTF.animations.length > 0) {
            this.animationMixer = new THREE.AnimationMixer(mesh);

            // Find walk animation (usually index 0 or named "walk")
            const walkAnim = manGLTF.animations.find(a => a.name.toLowerCase().includes('walk'))
                             || manGLTF.animations[0];

            if (walkAnim) {
                this.walkAction = this.animationMixer.clipAction(walkAnim);
                this.walkAction.play();
            }
        }
    }

    /**
     * Find a walkable position near the initial spawn point
     * @returns {boolean} True if found, false if not
     */
    findWalkableSpawnPosition() {
        const navManager = this.game.navigationManager;
        if (!navManager) {
            console.error('[PathfindingTestAI] NavigationManager not available');
            return false;
        }

        const initialX = this.initialSpawnPosition.x;
        const initialZ = this.initialSpawnPosition.z;

        console.log(`[PathfindingTestAI] Searching for walkable position near (${initialX.toFixed(1)}, ${initialZ.toFixed(1)})`);

        // Get the chunk at spawn position
        const chunks = navManager.get3x3ChunkGrid(initialX, initialZ);
        if (!chunks || chunks.length === 0) {
            console.error('[PathfindingTestAI] No navigation chunks available at spawn position');
            return false;
        }

        // Count non-null chunks
        const loadedChunkCount = chunks.filter(c => c !== null).length;
        console.log(`[PathfindingTestAI] Found ${loadedChunkCount}/9 chunks loaded in 3x3 grid`);

        // Log which chunks are loaded
        const chunkStatus = chunks.map((c, i) => c ? '✓' : '✗').join(' ');
        console.log(`[PathfindingTestAI] Chunk grid status: ${chunkStatus} (index 4 is center)`);

        const centerChunk = chunks[4]; // Center of 3x3 grid
        if (!centerChunk) {
            console.error('[PathfindingTestAI] Center chunk (index 4) not loaded yet. Waiting for chunks...');
            console.log('[PathfindingTestAI] Available chunks:', navManager.getStats());
            return false;
        }

        // First check if initial position is walkable
        const initialCell = centerChunk.worldToCell(initialX, initialZ);
        console.log(`[PathfindingTestAI] Initial cell: (${initialCell.cellX}, ${initialCell.cellZ})`);

        if (initialCell.cellX >= 0 && initialCell.cellX < 100 &&
            initialCell.cellZ >= 0 && initialCell.cellZ < 100 &&
            centerChunk.isWalkable(initialCell.cellX, initialCell.cellZ)) {
            console.log('[PathfindingTestAI] Initial spawn position is walkable!');
            return true;
        }

        console.log('[PathfindingTestAI] Initial spawn position not walkable, searching nearby...');

        // Search in expanding circles for a walkable position
        const maxRadius = 40; // Increased from 20 to 40
        const stepSize = 0.5; // Smaller steps for more thorough search

        for (let radius = stepSize; radius <= maxRadius; radius += stepSize) {
            // Check positions in a circle around the initial position
            const numChecks = Math.floor(radius * 12); // More checks for better coverage

            for (let i = 0; i < numChecks; i++) {
                const angle = (i / numChecks) * Math.PI * 2;
                const testX = initialX + Math.cos(angle) * radius;
                const testZ = initialZ + Math.sin(angle) * radius;

                const testCell = centerChunk.worldToCell(testX, testZ);

                // Check if within bounds and walkable
                if (testCell.cellX >= 0 && testCell.cellX < 100 &&
                    testCell.cellZ >= 0 && testCell.cellZ < 100 &&
                    centerChunk.isWalkable(testCell.cellX, testCell.cellZ)) {

                    // Found walkable position! Move the AI there
                    this.entity.position.x = testX;
                    this.entity.position.z = testZ;

                    // Update Y position to terrain height
                    const terrainY = this.game.terrainRenderer.getHeightFast(testX, testZ);
                    this.entity.position.y = terrainY + 0.03;

                    console.log(`[PathfindingTestAI] Found walkable spawn at (${testX.toFixed(1)}, ${testZ.toFixed(1)}), ${radius.toFixed(1)} units from original`);
                    return true;
                }
            }

            // Log progress every 10 units
            if (radius % 10 === 0) {
                console.log(`[PathfindingTestAI] Searched up to ${radius} units, still looking...`);
            }
        }

        console.error(`[PathfindingTestAI] Could not find walkable spawn position within ${maxRadius} units`);
        console.error(`[PathfindingTestAI] Initial position: (${initialX.toFixed(1)}, ${initialZ.toFixed(1)})`);
        return false;
    }

    /**
     * Pick a random target position and calculate path using A*
     * Retries multiple times if target is not walkable
     * @returns {boolean} True if successful, false if failed
     */
    pickRandomTargetAndPath() {
        const currentX = this.entity.position.x;
        const currentZ = this.entity.position.z;

        // Get the navigation manager
        const navManager = this.game.navigationManager;
        if (!navManager) {
            console.error('[PathfindingTestAI] NavigationManager not available');
            return false;
        }

        // Get the 3x3 chunk grid centered on our position
        const chunks = navManager.get3x3ChunkGrid(currentX, currentZ);
        if (!chunks || chunks.length === 0) {
            console.error('[PathfindingTestAI] No navigation chunks available');
            return false;
        }

        // For simplicity, use the center chunk's nav map
        const centerChunk = chunks[4]; // Center of 3x3 grid
        if (!centerChunk) {
            console.error('[PathfindingTestAI] Center chunk not available');
            return false;
        }

        // Try multiple random targets until we find a walkable one
        const maxAttempts = 20; // Increased from 10 to 20 for better chance of success
        let targetX, targetZ;
        let foundWalkableTarget = false;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            // Pick a random target 10-25 units away
            const distance = 10 + Math.random() * 15; // 10-25 units
            const angle = Math.random() * Math.PI * 2; // Random direction

            targetX = currentX + Math.cos(angle) * distance;
            targetZ = currentZ + Math.sin(angle) * distance;

            // Check if target is walkable using NavigationManager (cross-chunk support)
            if (navManager.isWalkable(targetX, targetZ)) {
                foundWalkableTarget = true;
                console.log(`[PathfindingTestAI] Found walkable target on attempt ${attempt + 1}`);
                break;
            }
        }

        if (!foundWalkableTarget) {
            console.warn(`[PathfindingTestAI] Could not find walkable target after ${maxAttempts} attempts`);
            console.log('[PathfindingTestAI] Will retry pathfinding after delay...');
            this.isMoving = false;
            return false;
        }

        this.targetPosition = new THREE.Vector3(targetX, 0, targetZ);

        console.log(`[PathfindingTestAI] Current: (${currentX.toFixed(1)}, ${currentZ.toFixed(1)})`);
        console.log(`[PathfindingTestAI] Target: (${targetX.toFixed(1)}, ${targetZ.toFixed(1)})`);

        // Calculate path using A* with NavigationManager for cross-chunk support
        console.log('[PathfindingTestAI] Calculating path...');
        this.path = findPath(navManager, currentX, currentZ, targetX, targetZ);

        if (this.path && this.path.length > 0) {
            console.log(`[PathfindingTestAI] Path found: ${this.path.length} waypoints`);
            this.currentWaypointIndex = 0;
            this.isMoving = true;
            this.reachedGoal = false;

            // Reset retry flags for clean state
            this.blockedAndNeedsRecalc = false;
            this.recalcAttempts = 0;
            this.retryCounterForBlock = 0;

            // Draw debug lines showing the path
            this.drawDebugPath();
            return true;
        } else {
            console.warn('[PathfindingTestAI] No path found to target (this should not happen with walkable target)');
            this.isMoving = false;
            return false;
        }
    }

    /**
     * Draw debug lines showing the calculated path
     */
    drawDebugPath() {
        // Remove old debug lines
        if (this.debugLines) {
            this.scene.remove(this.debugLines);
            this.debugLines.geometry.dispose();
            this.debugLines.material.dispose();
        }

        if (!this.path || this.path.length === 0) return;

        // Create line geometry
        const points = [];
        for (const waypoint of this.path) {
            const y = this.game.terrainRenderer.getHeightFast(waypoint.x, waypoint.z) + 0.5;
            points.push(new THREE.Vector3(waypoint.x, y, waypoint.z));
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color: 0xffff00, // Yellow
            linewidth: 3
        });

        this.debugLines = new THREE.Line(geometry, material);
        this.scene.add(this.debugLines);

        console.log('[PathfindingTestAI] Debug path drawn (yellow line)');
    }

    /**
     * Called by the game when all navigation maps are complete
     * This is an EVENT-BASED trigger, not polling!
     */
    onAllNavMapsReady() {
        if (this.pathfindingInitialized) {
            return; // Already initialized
        }

        console.log('[PathfindingTestAI] Received nav maps ready event!');
        this.navMapsReady = true;

        // Find a walkable spawn position
        console.log('[PathfindingTestAI] Finding walkable spawn position...');
        const foundWalkableSpawn = this.findWalkableSpawnPosition();

        if (!foundWalkableSpawn) {
            console.warn('[PathfindingTestAI] Center chunk not loaded yet. Will retry...');
            // Don't mark as initialized - will retry on next call
            return;
        }

        // Start pathfinding
        console.log('[PathfindingTestAI] Starting pathfinding from walkable position...');
        const success = this.pickRandomTargetAndPath();

        if (success) {
            console.log('[PathfindingTestAI] Pathfinding initialized successfully!');
        } else {
            console.warn('[PathfindingTestAI] Failed to find initial path, but AI is ready.');
        }

        this.pathfindingInitialized = true;
    }

    /**
     * Update AI each frame
     */
    update(deltaTime, currentTime) {
        // Retry initialization if nav maps are ready but pathfinding not initialized
        // Check every 60 frames (~1 second) to avoid spam
        if (this.navMapsReady && !this.pathfindingInitialized) {
            this.retryCounter = (this.retryCounter || 0) + 1;
            if (this.retryCounter >= 60) {
                this.retryCounter = 0;
                console.log('[PathfindingTestAI] Retrying initialization...');
                this.onAllNavMapsReady();
            }
        }

        // Update animations
        if (this.animationMixer) {
            this.animationMixer.update(deltaTime / 1000);
        }

        // Move toward waypoints
        if (this.isMoving && this.path && this.currentWaypointIndex < this.path.length) {
            this.followPath(deltaTime);
        }

        // Retry pathfinding if blocked
        if (!this.isMoving && this.blockedAndNeedsRecalc && this.targetPosition) {
            this.retryCounterForBlock = (this.retryCounterForBlock || 0) + 1;
            if (this.retryCounterForBlock >= 30) {
                this.retryCounterForBlock = 0;

                // Check max retry limit
                this.recalcAttempts = (this.recalcAttempts || 0) + 1;
                if (this.recalcAttempts > 10) {
                    console.warn('[PathfindingTestAI] Giving up after 10 attempts, picking new target');
                    this.blockedAndNeedsRecalc = false;
                    this.recalcAttempts = 0;
                    this.pickRandomTargetAndPath();
                } else {
                    console.log(`[PathfindingTestAI] Retrying path to target (attempt ${this.recalcAttempts})...`);

                    const navManager = this.game.navigationManager;
                    this.path = findPath(navManager, this.entity.position.x, this.entity.position.z,
                                        this.targetPosition.x, this.targetPosition.z);

                    if (this.path && this.path.length > 0) {
                        console.log(`[PathfindingTestAI] Recalc successful: ${this.path.length} waypoints`);
                        this.currentWaypointIndex = 0;
                        this.isMoving = true;
                        this.drawDebugPath();
                        this.blockedAndNeedsRecalc = false;
                        this.recalcAttempts = 0;
                    }
                }
            }
        }

        // Update Y position to follow terrain
        const terrainY = this.game.terrainRenderer.getHeightFast(
            this.entity.position.x,
            this.entity.position.z
        );
        this.entity.position.y = terrainY + 0.03;
    }


    /**
     * Follow the path waypoints
     */
    followPath(deltaTime) {
        const currentWaypoint = this.path[this.currentWaypointIndex];

        // Calculate distance to current waypoint
        const dx = currentWaypoint.x - this.entity.position.x;
        const dz = currentWaypoint.z - this.entity.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        // If close enough to waypoint, move to next one
        if (distance < 0.5) {
            this.currentWaypointIndex++;

            // Check if we reached the final waypoint
            if (this.currentWaypointIndex >= this.path.length) {
                this.isMoving = false;
                this.reachedGoal = true;
                return;
            }

            return;
        }

        // Update terrain speed modifier (cached for performance - every 5 frames)
        this.frameCounter++;
        if (this.frameCounter % 5 === 0) {
            const navManager = this.game.navigationManager;
            if (navManager) {
                this.cachedSpeedMultiplier = navManager.getMovementSpeedMultiplier(
                    this.entity.position.x,
                    this.entity.position.z
                );
            }
        }

        // Move toward current waypoint with terrain speed modifier
        const actualSpeed = this.speed * this.cachedSpeedMultiplier;
        const moveX = (dx / distance) * actualSpeed * deltaTime;
        const moveZ = (dz / distance) * actualSpeed * deltaTime;

        // Calculate next position
        const nextX = this.entity.position.x + moveX;
        const nextZ = this.entity.position.z + moveZ;

        // Check if next position is walkable (warn but don't stop - let bounding boxes handle collision)
        const navManager = this.game.navigationManager;
        if (navManager && !navManager.isWalkable(nextX, nextZ)) {
            // Log warning but continue moving - physical collisions will stop if needed
            console.warn('[PathfindingTestAI] Clipping unwalkable cell, continuing anyway...');
        }

        this.entity.position.x = nextX;
        this.entity.position.z = nextZ;

        // Rotate toward waypoint
        const targetAngle = Math.atan2(dx, dz);
        let angleDiff = targetAngle - this.entity.rotation.y;

        // Normalize angle difference to -PI to PI
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

        // Smooth rotation
        const rotationStep = Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), this.rotationSpeed);
        this.entity.rotation.y += rotationStep;
    }

    /**
     * Cleanup
     */
    dispose() {
        if (this.debugLines) {
            this.scene.remove(this.debugLines);
            this.debugLines.geometry.dispose();
            this.debugLines.material.dispose();
        }

        if (this.entity) {
            this.scene.remove(this.entity);
        }
    }
}

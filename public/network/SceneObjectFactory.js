/**
 * SceneObjectFactory.js
 * Handles creation of 3D objects in the scene from server data
 * Extracted from MessageRouter.js to reduce file size
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { objectPlacer, modelManager, applyEuclideanFog } from '../objects.js';
import { COLLISION_GROUPS } from '../core/PhysicsManager.js';
import { ChunkPerfTimer } from '../core/PerformanceTimer.js';

export class SceneObjectFactory {
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        this.gameState = game.gameState;

        // Cache for cylindrical billboard shader material
        this.cylindricalBillboardMaterials = new Map();

        // Queue for deferred object creation (prevents stutter on chunk transitions)
        this.pendingCreations = [];
        this.CREATION_BUDGET_MS = 1.0;
    }

    /**
     * Create a cylindrical billboard mesh (Y-axis aligned, rotates on vertical)
     * Similar to BillboardSystem but for individual meshes instead of instanced
     * @param {string} texturePath - Path to texture
     * @param {number} width - Billboard width
     * @param {number} height - Billboard height
     * @param {number} yOffset - Vertical offset from pivot
     * @param {number} brightness - Brightness multiplier (default 1.0)
     * @returns {THREE.Mesh} - Billboard mesh
     */
    createCylindricalBillboard(texturePath, width, height, yOffset = 0, brightness = 1.0, colorTone = { r: 1.0, g: 1.0, b: 1.0 }) {
        // Cache key includes texture path, brightness, and color tone
        const cacheKey = `${texturePath}_${brightness}_${colorTone.r}_${colorTone.g}_${colorTone.b}`;

        // Check if we already have this material cached
        if (!this.cylindricalBillboardMaterials.has(cacheKey)) {
            const texture = new THREE.TextureLoader().load(texturePath);
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.magFilter = THREE.LinearFilter;

            const vertexShader = `
                varying vec2 vUv;
                varying float vFogDepth;

                void main() {
                    vUv = uv;

                    // Extract scale from modelMatrix
                    // Each column's length gives the scale for that axis
                    vec3 scale = vec3(
                        length(modelMatrix[0].xyz),
                        length(modelMatrix[1].xyz),
                        length(modelMatrix[2].xyz)
                    );

                    // Get world position (center of billboard)
                    vec3 worldPos = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;

                    // Direction from billboard to camera (world space)
                    vec3 toCamera = normalize(cameraPosition - worldPos);

                    // Cylindrical billboarding - face camera on XZ plane only
                    vec3 worldUp = vec3(0.0, 1.0, 0.0);
                    vec3 right = normalize(cross(worldUp, toCamera));
                    vec3 up = worldUp;

                    // Build billboard vertex position in world space
                    // Apply scale to vertex positions
                    vec3 vertexPos = worldPos + right * position.x * scale.x + up * position.y * scale.y;

                    // Transform to clip space
                    vec4 mvPosition = viewMatrix * vec4(vertexPos, 1.0);
                    gl_Position = projectionMatrix * mvPosition;

                    // Euclidean fog depth (matches terrain fog for uniform fade in all directions)
                    vFogDepth = length(mvPosition.xyz);
                }
            `;

            const fragmentShader = `
                uniform sampler2D map;
                uniform vec3 fogColor;
                uniform float fogDensity;
                uniform float fogNear;
                uniform float fogFar;
                uniform bool useLinearFog;
                uniform float brightness;
                uniform vec3 colorTone;
                varying vec2 vUv;
                varying float vFogDepth;

                void main() {
                    vec4 texColor = texture2D(map, vUv);

                    // Discard semi-transparent pixels to avoid white edge artifacts
                    if (texColor.a < 0.3) {
                        discard;
                    }

                    // Apply color tone and brightness adjustment (matches BillboardSystem)
                    vec3 adjustedColor = texColor.rgb * colorTone * brightness;

                    // Calculate fog factor based on fog type
                    float fogFactor;
                    if (useLinearFog) {
                        // Linear fog
                        fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
                    } else {
                        // Exponential squared fog
                        fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
                    }
                    fogFactor = clamp(fogFactor, 0.0, 1.0);

                    // Mix billboard color with fog
                    vec3 finalColor = mix(adjustedColor, fogColor, fogFactor);

                    gl_FragColor = vec4(finalColor, texColor.a);
                }
            `;

            // Get fog settings from scene and config
            const fogColor = this.scene.fog ? this.scene.fog.color : new THREE.Color(0xcccccc);
            const useLinearFog = CONFIG.RENDERING.FOG_TYPE === 'linear';
            const fogDensity = this.scene.fog?.density || CONFIG.RENDERING.FOG_DENSITY || 0.02;
            const fogNear = CONFIG.RENDERING.FOG_NEAR || 300;
            const fogFar = CONFIG.RENDERING.FOG_FAR || 500;

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    map: { value: texture },
                    fogColor: { value: fogColor },
                    fogDensity: { value: fogDensity },
                    fogNear: { value: fogNear },
                    fogFar: { value: fogFar },
                    useLinearFog: { value: useLinearFog },
                    brightness: { value: brightness },
                    colorTone: { value: new THREE.Vector3(colorTone.r, colorTone.g, colorTone.b) }
                },
                vertexShader,
                fragmentShader,
                transparent: true,
                depthWrite: true,
                depthTest: true,
                side: THREE.DoubleSide,
                alphaTest: 0.3
            });

            this.cylindricalBillboardMaterials.set(cacheKey, material);
        }

        const material = this.cylindricalBillboardMaterials.get(cacheKey);
        const geometry = new THREE.PlaneGeometry(width, height);
        geometry.translate(0, height / 2 + yOffset, 0); // Pivot at bottom + yOffset

        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = 300; // Match natural trees (renders after water at 200)
        return mesh;
    }

    /**
     * Create a 3D GLB model for a growing tree (pine or apple)
     * Returns null if the model isn't loaded yet (caller should fall back to billboard)
     * @param {string} treeType - 'pine' or 'apple'
     * @param {number} currentScale - Current growth scale (0.25 to 1.0)
     * @returns {THREE.Object3D|null}
     */
    createGrowing3DTree(treeType, currentScale) {
        const modelKey = treeType + '_growing';
        const sourceModel = modelManager.getModel(modelKey);
        if (!sourceModel) return null;

        const clone = sourceModel.clone();

        // Darken materials to match RockModelSystem appearance
        const darkFactor = treeType === 'apple' ? 0.6 : 0.7;
        clone.traverse(child => {
            if (child.isMesh) {
                // Clone material so we don't modify the source
                if (Array.isArray(child.material)) {
                    child.material = child.material.map(m => {
                        const mat = m.clone();
                        if (mat.color) mat.color.multiplyScalar(darkFactor);
                        applyEuclideanFog(mat);
                        return mat;
                    });
                } else {
                    child.material = child.material.clone();
                    if (child.material.color) child.material.color.multiplyScalar(darkFactor);
                    applyEuclideanFog(child.material);
                }
            }
        });

        clone.scale.set(currentScale, currentScale, currentScale);
        clone.userData._is3DGrowingTree = true;
        return clone;
    }

    /**
     * Add object from change data
     * @param {object} change - Change data from server
     * @returns {boolean} - Whether object was added/updated
     */
    addObjectFromChange(change) {
        // Validate change data
        if (!change || !change.chunkId) {
            console.error('[addObjectFromChange] Invalid change data - missing chunkId:', change);
            return false;
        }

        if (!change.position || !Array.isArray(change.position) || change.position.length < 3) {
            console.error('[addObjectFromChange] Invalid change data - missing or invalid position:', {
                change,
                objectType: change.name || change.objectType,
                objectId: change.id
            });
            return false;
        }

        const chunkKey = change.chunkId.replace('chunk_', '');

        // Skip if object already exists in scene (prevents duplicates)
        if (this.game.objectRegistry?.has(change.id)) {
            return false;
        }

        // Check if object was recently deleted
        const removedSet = this.gameState.removedObjectsCache.get(chunkKey);
        if (removedSet && removedSet.has(change.id)) {
            return false; // Skip this object - it was deleted
        }

        // Handle roads specially - they're terrain textures, not 3D objects
        const objectType = change.name || change.objectType;
        if (objectType === 'road' || change.isRoad) {
            const roadRotation = change.rotation || 0;
            const materialType = change.materialType || 'limestone';

            // Paint pill-shaped road onto dirt overlay texture
            if (this.game.dirtOverlay) {
                this.game.dirtOverlay.paintRoadImmediate(change.position[0], change.position[2], roadRotation, materialType);
            }

            // Store road data with rotation for persistence during chunk rebuilds
            if (this.gameState.roads) {
                if (!this.gameState.roads.has(chunkKey)) {
                    this.gameState.roads.set(chunkKey, []);
                }
                // Check for duplicates before adding
                const existingRoads = this.gameState.roads.get(chunkKey);
                const isDuplicate = existingRoads.some(r => r.id === change.id);
                if (!isDuplicate) {
                    existingRoads.push({
                        id: change.id,
                        x: change.position[0],
                        z: change.position[2],
                        rotation: roadRotation,
                        materialType: materialType
                    });
                }
            }

            // Update navigation map - use circular approximation (radius 1.25 covers pill area)
            if (this.game.navigationManager && change.chunkId) {
                const navMap = this.game.navigationManager.getChunk(change.chunkId);
                if (navMap) {
                    navMap.addRoad(change.position[0], change.position[2], 1.25);
                    this.game.navigationManager.syncChunkToWorker(change.chunkId);
                }
            }
            return true; // Don't process roads as regular objects
        }

        // Check if object already exists using O(1) registry lookup (ISSUE-066 fix)
        let existingObject = null;
        if (this.game.objectRegistry && change.id) {
            const cached = this.game.objectRegistry.get(change.id);
            // Safety check: skip bounding box objects (legacy filter)
            if (cached && cached.userData && !cached.userData.isBoundingBox) {
                existingObject = cached;
            }
        }

        if (existingObject) {
            // Object already exists - update its properties
            const modelType = change.name || change.objectType;

            // Update durability values
            if (change.currentDurability !== undefined) {
                existingObject.userData.currentDurability = change.currentDurability;
            }
            if (change.hoursUntilRuin !== undefined) {
                existingObject.userData.hoursUntilRuin = change.hoursUntilRuin;
            }

            // Initialize resources for logs if not present (backwards compatibility)
            if ((modelType === 'log' || modelType.endsWith('_log')) &&
                (change.remainingResources == null || change.totalResources == null)) {
                existingObject.userData.totalResources = 1;
                existingObject.userData.remainingResources = 1;
            } else {
                // Use ?? instead of || to preserve 0 as a valid value
                existingObject.userData.remainingResources = change.remainingResources ?? null;
                existingObject.userData.totalResources = change.totalResources ?? null;
            }

            // Update construction site metadata if this is a construction site
            if (change.isConstructionSite) {
                existingObject.userData.isConstructionSite = true;
                existingObject.userData.targetStructure = change.targetStructure;
                existingObject.userData.requiredMaterials = change.requiredMaterials || {};
                existingObject.userData.materials = change.materials || {};
                existingObject.userData.rotation = change.rotation;
                existingObject.userData.finalFoundationY = change.finalFoundationY;
            }

            // Update storage structure inventory if present
            const structureType = change.name || change.objectType;
            if ((structureType === 'crate' || structureType === 'tent' || structureType === 'house' || structureType === 'market' || structureType === 'campfire' || structureType === 'fisherman' || structureType === 'tileworks' || structureType === 'ironworks' || structureType === 'blacksmith' || structureType === 'bakery') && change.inventory) {
                existingObject.userData.inventory = change.inventory;
            }

            // Update warehouse loaded crates if present
            if (structureType === 'warehouse' && change.loadedCrates) {
                existingObject.userData.loadedCrates = change.loadedCrates;
            }
            return true;
        } else {
            // Create new object
            const objectInstance = this.createObjectInScene(change, chunkKey);

            if (objectInstance) {
                // Register structures with billboard and LOD systems for distant rendering
                // dock and market excluded - rectangular shapes don't billboard well
                const structureType = change.name || change.objectType;
                const LOD_STRUCTURE_TYPES = new Set([
                    'tent', 'outpost', 'campfire', 'horse',
                    'house', 'bakery', 'gardener', 'miner', 'woodcutter',
                    'stonemason', 'wall', 'tileworks', 'blacksmith', 'ironworks', 'fisherman',
                    'boat', 'sailboat', 'ship2', 'bearden', 'crate', 'construction', '2x2construction',
                    '2x8construction', '3x3construction', '10x4construction', 'warehouse'
                ]);

                if (LOD_STRUCTURE_TYPES.has(structureType)) {
                    // Register with StructureModelSystem for LOD (3D model visibility)
                    if (this.game.structureModelSystem) {
                        this.game.structureModelSystem.registerStructure(objectInstance, structureType, chunkKey);
                    }

                    // Register with BillboardSystem for distant rendering
                    if (this.game.billboardSystem) {
                        const billboardIndex = this.game.billboardSystem.addTreeBillboard(
                            objectInstance,
                            structureType,
                            objectInstance.position
                        );
                        if (billboardIndex >= 0) {
                            objectInstance.userData.billboardIndex = billboardIndex;
                        }
                    }
                }
            }

            return objectInstance !== null;
        }
    }

    /**
     * Queue an object for deferred creation
     * @param {object} change - Object change data from server
     */
    queueObjectCreation(change) {
        this.pendingCreations.push(change);
    }

    /**
     * Process pending object creations with frame budget
     * Call once per frame from game loop
     * @returns {object} - { processed, remaining }
     */
    processCreationQueue() {
        if (this.pendingCreations.length === 0) {
            return { processed: 0, remaining: 0 };
        }

        ChunkPerfTimer.start('SceneFactory.processCreationQueue');
        const startTime = performance.now();
        let processed = 0;

        while (this.pendingCreations.length > 0 &&
               performance.now() - startTime < this.CREATION_BUDGET_MS) {
            const change = this.pendingCreations.shift();
            ChunkPerfTimer.start('SceneFactory.addObjectFromChange');
            this.addObjectFromChange(change);
            ChunkPerfTimer.end('SceneFactory.addObjectFromChange');
            processed++;
        }

        ChunkPerfTimer.end('SceneFactory.processCreationQueue');
        return { processed, remaining: this.pendingCreations.length };
    }

    /**
     * Create object in scene from data
     * @param {object} data - Object data from server
     * @param {string} chunkKey - Chunk key (e.g., "0,0")
     * @returns {THREE.Object3D|null} - Created object or null
     */
    createObjectInScene(data, chunkKey) {
        const objectType = data.name || data.objectType;

        // Validate position data
        if (!data.position || !Array.isArray(data.position) || data.position.length < 3 ||
            data.position[0] == null || data.position[1] == null || data.position[2] == null) {
            console.error('[createObjectInScene] Invalid position data:', {
                objectType,
                position: data.position,
                objectId: data.id || data.objectId,
                chunkKey
            });
            return null;
        }

        // Handle roads specially - they're terrain textures, not 3D objects
        if (objectType === 'road' || data.isRoad) {
            const roadRotation = data.rotation || 0;
            const materialType = data.materialType || 'limestone';

            // Paint pill-shaped road onto dirt overlay texture
            if (this.game.dirtOverlay) {
                this.game.dirtOverlay.paintRoadImmediate(data.position[0], data.position[2], roadRotation, materialType);
            }

            // Store road data with rotation for persistence during chunk rebuilds
            if (this.gameState.roads) {
                if (!this.gameState.roads.has(chunkKey)) {
                    this.gameState.roads.set(chunkKey, []);
                }
                // Check for duplicates before adding
                const existingRoads = this.gameState.roads.get(chunkKey);
                const isDuplicate = existingRoads.some(r => r.id === data.id);
                if (!isDuplicate) {
                    existingRoads.push({
                        id: data.id,
                        x: data.position[0],
                        z: data.position[2],
                        rotation: roadRotation,
                        materialType: materialType
                    });
                }
            }

            // Update navigation map - use circular approximation (radius 1.25 covers pill area)
            if (this.game.navigationManager) {
                const chunkId = `chunk_${chunkKey}`;
                const navMap = this.game.navigationManager.getChunk(chunkId);
                if (navMap) {
                    navMap.addRoad(data.position[0], data.position[2], 1.25);
                    this.game.navigationManager.syncChunkToWorker(chunkId);
                }
            }
            return null; // Don't create 3D object for roads
        }

        // Handle docks as terrain-based structures (raised terrain + texture, no 3D model)
        if (objectType === 'dock') {
            const dockRotation = data.rotation || 0;
            const dockX = data.position[0];
            const dockZ = data.position[2];
            const dockId = data.id || data.objectId;
            const dockHeight = CONFIG.CONSTRUCTION.STRUCTURE_PROPERTIES.dock.deckHeight;

            // 1. Raise terrain to dock height (only raises terrain below 1, sharp edges)
            if (this.game.terrainGenerator) {
                this.game.terrainGenerator.addLeveledArea(
                    dockX, dockZ,
                    4, 12,  // 4 units wide, 12 units long (aligned to 4-unit LOD grid)
                    dockHeight,
                    dockRotation,
                    { raiseOnly: true, sharpEdges: true }
                );

                // Force clipmap to refresh the affected terrain region
                if (this.game.clipmap) {
                    this.game.clipmap.forceRefreshRegion(dockX, dockZ, 14);  // 14 unit radius covers 4x12 dock
                }
            }

            // 2. Paint dock texture onto terrain overlay
            if (this.game.dirtOverlay) {
                this.game.dirtOverlay.paintDockImmediate(dockX, dockZ, dockRotation, data.materialType || 'limestone');
            }

            // 3. Store dock data for persistence during chunk rebuilds
            if (!this.gameState.docks) {
                this.gameState.docks = new Map();
            }
            if (!this.gameState.docks.has(chunkKey)) {
                this.gameState.docks.set(chunkKey, []);
            }
            const existingDocks = this.gameState.docks.get(chunkKey);
            const isDuplicate = existingDocks.some(d => d.id === dockId);
            if (!isDuplicate) {
                existingDocks.push({
                    id: dockId,
                    x: dockX,
                    z: dockZ,
                    rotation: dockRotation,
                    quality: data.quality,
                    lastShipSpawn: data.lastShipSpawn,
                    owner: data.owner,
                    materialType: data.materialType || 'limestone'
                });
            }

            // 4. Create minimal invisible Object3D for interaction system
            // This allows the existing proximity detection to work without changes
            const dockPlaceholder = new THREE.Object3D();
            dockPlaceholder.position.set(dockX, dockHeight, dockZ);
            dockPlaceholder.name = 'dock';
            dockPlaceholder.userData = {
                objectId: dockId,
                modelType: 'dock',
                chunkKey: chunkKey,
                quality: data.quality,
                lastRepairTime: data.lastRepairTime,
                owner: data.owner,
                rotation: dockRotation,
                lastShipSpawn: data.lastShipSpawn,
                isTerrainBased: true  // Flag to skip model disposal
            };

            // Add invisible collision box for raycasting (interaction detection)
            const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS['dock'];
            if (dims) {
                const boxWidth = dims.width || 2;
                const boxDepth = dims.depth || 10;
                const boxHeight = dims.height || 1;

                // Create invisible mesh for raycasting
                const geometry = new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth);
                const material = new THREE.MeshBasicMaterial({ visible: false });
                const collisionBox = new THREE.Mesh(geometry, material);
                collisionBox.position.y = boxHeight / 2;
                collisionBox.rotation.y = dockRotation; // Already in radians
                dockPlaceholder.add(collisionBox);
            }

            // 5. Register dock with scheduled ship system
            if (this.game.scheduledShipSystem) {
                const lastShipSpawn = data.lastShipSpawn || 0;
                const dockPositionArray = [dockX, dockHeight, dockZ];
                this.game.scheduledShipSystem.registerDock(
                    dockId,
                    dockPositionArray,
                    dockRotation,
                    lastShipSpawn,
                    `chunk_${chunkKey}`
                );

                // Ensure merchant exists for this dock (for late joiners)
                if (this.game.dockMerchantSystem && lastShipSpawn) {
                    this.game.dockMerchantSystem.ensureMerchantExists(
                        dockId,
                        dockPositionArray,
                        dockRotation,
                        lastShipSpawn
                    );
                }
            }

            // 6. Update navigation map - dock is walkable surface
            if (this.game.navigationManager) {
                const chunkId = `chunk_${chunkKey}`;
                const navMap = this.game.navigationManager.getChunk(chunkId);
                if (navMap) {
                    // Add dock as road surface (walkable at road speed)
                    navMap.addRoad(dockX, dockZ, 5);  // radius covers 2x10 area
                    this.game.navigationManager.syncChunkToWorker(chunkId);
                }
            }

            // Add to scene (invisible placeholder for interaction)
            this.game.scene.add(dockPlaceholder);

            // Add to chunkObjects for proximity detection and duplicate checking
            const chunkObjects = this.game.chunkManager.chunkObjects.get(chunkKey) || [];
            chunkObjects.push(dockPlaceholder);
            this.game.chunkManager.chunkObjects.set(chunkKey, chunkObjects);

            // Add to objectRegistry for fast lookups
            if (this.game.objectRegistry) {
                this.game.objectRegistry.set(dockId, dockPlaceholder);
            }

            return dockPlaceholder;
        }

        // Skip creation if a peer is currently riding/using this mobile entity
        // This prevents ghost entities when chunk loads after P2P message arrives
        // (matches the check in MessageRouter.handleObjectAdded)
        const MOBILE_ENTITY_TYPES = new Set(['horse', 'boat', 'sailboat', 'ship2', 'cart', 'artillery']);
        if (MOBILE_ENTITY_TYPES.has(objectType)) {
            const mobileEntitySystem = this.game?.mobileEntitySystem;
            const entityId = data.id || data.objectId;
            if (mobileEntitySystem?.isOccupied(entityId)) {
                return null;
            }
        }

        // Handle corpse objects (dead players/bandits/militia with lootable inventory)
        if (objectType === 'corpse' || data.isCorpse) {
            return this.createCorpseObject(data, chunkKey);
        }

        const objectPosition = new THREE.Vector3(data.position[0], data.position[1], data.position[2]);

        // Force mobile entities Y to terrain height (server may send incorrect Y)
        if ((objectType === 'horse' || objectType === 'cart' || objectType === 'artillery') && this.game.terrainGenerator) {
            objectPosition.y = this.game.terrainGenerator.getWorldHeight(objectPosition.x, objectPosition.z);
        }

        // Rotation in radians (server sends radians, random fallback if not provided)
        const objectRotation = data.rotation !== undefined ? data.rotation : (Math.random() * Math.PI * 2);

        const finalModelRotation = objectRotation;

        // Normalize planted types for visual rendering (planted_vegetables -> vegetables, etc.)
        const visualType = objectType.startsWith('planted_') ? objectType.replace('planted_', '') : objectType;

        // Check if this is a tree type that should use billboards (includes vegetables)
        const isTree = CONFIG.OBJECTS.TREE_TYPES.has(visualType);

        let objectInstance;
        if (data.isGrowing && isTree) {
            // Calculate current scale based on tick-based growth
            // Vegetables/Hemp: 75% -> 100%, Trees: 25% -> 100%
            const isSmallPlant = visualType === 'vegetables' || visualType === 'hemp';
            const startScale = isSmallPlant ? 0.75 : 0.25;
            const growthRange = 1.0 - startScale;
            const growthDurationTicks = data.growthDurationTicks || 1800;

            let currentScale = data.scale || startScale;
            if (data.plantedAtTick && this.game.gameState?.serverTick) {
                const ticksElapsed = this.game.gameState.serverTick - data.plantedAtTick;
                currentScale = Math.min(1.0, startScale + (growthRange * (ticksElapsed / growthDurationTicks)));
            }

            // Pine/apple: try 3D GLB model first, fall back to billboard
            const use3D = (visualType === 'pine' || visualType === 'apple');
            const tree3D = use3D ? this.createGrowing3DTree(visualType, currentScale) : null;

            if (tree3D) {
                tree3D.position.copy(objectPosition);
                tree3D.name = visualType;
                tree3D.userData.modelType = visualType;
                objectInstance = tree3D;
            } else {
                // Billboard fallback (always used for vegetables/deertree)
                const billboardConfig = {
                    pine: { width: 4, height: 6, yOffset: -0.5, brightness: 0.95, colorR: 1.0, colorG: 1.0, colorB: 1.0, texture: 'pinefinal.webp' },
                    apple: { width: 8.4, height: 5, yOffset: -1.3, brightness: 0.55, colorR: 1.0, colorG: 1.0, colorB: 1.0, texture: 'applefinal.webp' },
                    vegetables: { width: 0.8, height: 0.7, yOffset: -0.25, brightness: 0.85, colorR: 1.65, colorG: 1.0, colorB: 0, texture: 'vegetables.png' },
                    deertree: { width: 4, height: 6, yOffset: -0.5, brightness: 0.95, colorR: 1.0, colorG: 1.0, colorB: 1.0, texture: 'pinefinal.webp' },
                    hemp: { width: 0.6, height: 1.4, yOffset: -0.25, brightness: 0.85, colorR: 0.8, colorG: 1.3, colorB: 0.4, texture: 'hemp.png' }
                };
                const config = billboardConfig[visualType] || billboardConfig.pine;

                const billboard = this.createCylindricalBillboard(
                    `./models/${config.texture}`,
                    config.width,
                    config.height,
                    config.yOffset,
                    config.brightness,
                    { r: config.colorR, g: config.colorG, b: config.colorB }
                );

                billboard.scale.set(currentScale, currentScale, currentScale);
                billboard.position.copy(objectPosition);
                billboard.name = visualType;
                billboard.userData.yOffset = config.yOffset;
                billboard.userData.modelType = visualType;
                objectInstance = billboard;
            }
        } else if (isTree && this.game.billboardSystem) {
            // Fully-grown trees from server: Create lightweight Object3D placeholder with billboard
            // This matches how client-side chunk generation handles trees in objects.js
            objectInstance = new THREE.Object3D();
            objectInstance.name = visualType;
            objectInstance.position.copy(objectPosition);

            // Add invisible collision cylinder for interaction detection
            const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[objectType] || CONFIG.CONSTRUCTION.GRID_DIMENSIONS[visualType];
            if (dims && dims.radius) {
                const interactionHeight = dims.height || 2;
                const geometry = new THREE.CylinderGeometry(dims.radius, dims.radius, interactionHeight, 8);
                const material = new THREE.MeshBasicMaterial({
                    visible: false,
                    side: THREE.DoubleSide
                });
                const interactionMesh = new THREE.Mesh(geometry, material);
                interactionMesh.position.y = interactionHeight / 2; // Center at object center
                objectInstance.add(interactionMesh);
            }

            // Register with billboard system for visual rendering (use visualType for texture lookup)
            const billboardIndex = this.game.billboardSystem.addTreeBillboard(
                objectInstance,
                visualType,
                objectPosition
            );
            objectInstance.userData.billboardIndex = billboardIndex;
        } else {
            // Regular object creation (non-trees, or trees without billboard system)
            objectInstance = objectPlacer.createInstance(
                objectType,
                objectPosition,
                data.scale,
                finalModelRotation,
                this.scene
            );
        }

        if (objectInstance) {
            // Set object metadata
            objectInstance.userData.objectId = data.id || data.objectId;
            objectInstance.userData.chunkKey = chunkKey;
            objectInstance.userData.quality = data.quality;
            objectInstance.userData.lastRepairTime = data.lastRepairTime;
            objectInstance.userData.currentDurability = data.currentDurability;
            objectInstance.userData.hoursUntilRuin = data.hoursUntilRuin;
            objectInstance.userData.modelType = data.name || data.objectType;
            objectInstance.userData.owner = data.owner || null;  // Store owner information
            objectInstance.userData.ownerName = data.ownerName || null;  // Store owner display name
            objectInstance.userData.ownerFactionId = data.ownerFactionId ?? null;  // Store owner faction for artillery targeting
            objectInstance.userData.isBanditStructure = data.isBanditStructure || false;  // Bandit camp marker
            objectInstance.userData.isBrownBearStructure = data.isBrownBearStructure || false;  // Brown bear den marker
            objectInstance.userData.isSoldWorkerStructure = data.isSoldWorkerStructure || false;  // Sold to proprietor
            objectInstance.userData.proprietor = data.proprietor || null;  // Proprietor owner (e.g., 'npc')
            objectInstance.userData.hasMilitia = data.hasMilitia || false;  // Has militia recruited
            objectInstance.userData.militiaOwner = data.militiaOwner || null;  // Militia owner accountId
            objectInstance.userData.militiaFaction = data.militiaFaction || null;  // Militia faction
            objectInstance.userData.militiaType = data.militiaType || null;  // militia/outpostMilitia/artilleryMilitia

            // Initialize resources for logs if not present (backwards compatibility)
            const modelType = data.name || data.objectType;

            if ((modelType === 'log' || modelType.endsWith('_log')) &&
                (data.totalResources == null || data.remainingResources == null)) {
                objectInstance.userData.totalResources = 1;
                objectInstance.userData.remainingResources = 1;
            } else {
                // Use ?? instead of || to preserve 0 as a valid value
                objectInstance.userData.totalResources = data.totalResources ?? null;
                objectInstance.userData.remainingResources = data.remainingResources ?? null;
            }

            // Handle construction site metadata
            if (data.isConstructionSite) {
                objectInstance.userData.isConstructionSite = true;
                objectInstance.userData.targetStructure = data.targetStructure;
                objectInstance.userData.requiredMaterials = data.requiredMaterials || {};
                objectInstance.userData.materials = data.materials || {};
                objectInstance.userData.materialItems = data.materialItems || {};  // For icon rendering
                objectInstance.userData.rotation = data.rotation;
                objectInstance.userData.finalFoundationY = data.finalFoundationY;
            }

            // Handle crate/tent/house/market/campfire/tileworks/apple/ironworks/blacksmith/bakery inventory
            const structureType = data.name || data.objectType;
            if ((structureType === 'crate' || structureType === 'tent' || structureType === 'house' || structureType === 'market' || structureType === 'campfire' || structureType === 'tileworks' || structureType === 'apple' || structureType === 'fisherman' || structureType === 'ironworks' || structureType === 'blacksmith' || structureType === 'bakery') && data.inventory) {
                objectInstance.userData.inventory = data.inventory;
            }

            // Load market state flags
            if (structureType === 'market') {
                objectInstance.userData.shipmentsPaused = data.shipmentsPaused || false;
                objectInstance.userData.merchantShipsEnabled = data.merchantShipsEnabled || false;
            }

            // Load warehouse stored crates
            if (structureType === 'warehouse' && data.loadedCrates) {
                objectInstance.userData.loadedCrates = data.loadedCrates;
            }

            // Handle growing tree metadata (tick-based)
            if (data.isGrowing) {
                objectInstance.userData.isGrowing = true;
                objectInstance.userData.plantedAtTick = data.plantedAtTick;
                objectInstance.userData.growthDurationTicks = data.growthDurationTicks || 1800;
                objectInstance.userData.scale = data.scale || 0.05;

                // Track in GameState for efficient updates (avoids scene.traverse)
                if (this.game?.gameState) {
                    this.game.gameState.growingTrees.add(objectInstance.userData.objectId);
                }
            }

            // Add faction flag to ship2 mast (white for neutral/guest, faction color otherwise)
            if (structureType === 'ship2') {
                this.addFactionFlag(objectInstance, data.ownerFactionId);
            }

            // Add faction flag to market roof
            if (structureType === 'market') {
                this.addMarketFlag(objectInstance, data.ownerFactionId);
            }

            this.scene.add(objectInstance);

            // Track decayable structures for efficient decay checks (avoids scene.traverse)
            const decayableTypes = new Set(['house', 'crate', 'tent', 'outpost', 'campfire',
                                            'market', 'tileworks', 'ship', 'boat', 'sailboat', 'ship2', 'horse', 'cart', 'artillery',
                                            'fisherman', 'ironworks', 'blacksmith', 'bakery', 'gardener', 'miner', 'woodcutter', 'stonemason', 'warehouse']);
            if (this.game?.gameState && !data.isBanditStructure) {
                if (decayableTypes.has(structureType) || data.isRuin || data.isConstructionSite) {
                    this.game.gameState.decayableStructures.add(objectInstance.userData.objectId);
                }
            }

            // Register bandit structures for AI detection
            if (data.isBanditStructure && this.game.gameState) {
                this.game.gameState.registerBanditStructure(chunkKey, {
                    id: objectInstance.userData.objectId,
                    position: { x: objectPosition.x, y: objectPosition.y, z: objectPosition.z },
                    type: structureType,
                    object: objectInstance,
                    banditDeathTime: data.banditDeathTime || null
                });
            }

            // Register brown bear structures for AI detection
            if (data.isBrownBearStructure && this.game.gameState) {
                this.game.gameState.registerBrownBearStructure(chunkKey, {
                    id: objectInstance.userData.objectId,
                    position: { x: objectPosition.x, y: objectPosition.y, z: objectPosition.z },
                    type: structureType,
                    object: objectInstance,
                    bearDeathTime: data.bearDeathTime || null
                });
            }

            // Register deer tree structures for AI detection
            if (data.isDeerTreeStructure && this.game.gameState) {
                this.game.gameState.registerDeerTreeStructure(chunkKey, {
                    id: objectInstance.userData.objectId,
                    position: { x: objectPosition.x, y: objectPosition.y, z: objectPosition.z },
                    type: structureType,
                    object: objectInstance,
                    deerDeathTime: data.deerDeathTime || null
                });
            }

            // Register militia structures (tent/outpost with hasMilitia flag) for AI spawning
            // NOTE: Artillery militia not registered here - they use dynamic lookup due to mobility
            if (data.hasMilitia && this.game.gameState) {
                if (structureType === 'tent' || structureType === 'outpost') {
                    this.game.gameState.registerMilitiaStructure(chunkKey, {
                        id: objectInstance.userData.objectId,
                        position: { x: objectPosition.x, y: objectPosition.y, z: objectPosition.z },
                        type: structureType,
                        militiaOwner: data.militiaOwner,
                        militiaFaction: data.militiaFaction,
                        militiaType: data.militiaType
                    });
                }
            }

            // Register markets for Baker AI detection
            if (structureType === 'market' && this.game.gameState) {
                this.game.gameState.registerMarket(chunkKey, {
                    id: objectInstance.userData.objectId,
                    position: { x: objectPosition.x, y: objectPosition.y, z: objectPosition.z },
                    object: objectInstance
                });
            }

            // Register bakeries for Baker AI detection
            if (structureType === 'bakery' && this.game.gameState) {
                this.game.gameState.registerBakery(chunkKey, {
                    id: objectInstance.userData.objectId,
                    position: { x: objectPosition.x, y: objectPosition.y, z: objectPosition.z },
                    object: objectInstance
                });
            }

            // Register gardener buildings for Gardener AI detection
            if (structureType === 'gardener' && this.game.gameState) {
                this.game.gameState.registerGardener(chunkKey, {
                    id: objectInstance.userData.objectId,
                    position: { x: objectPosition.x, y: objectPosition.y, z: objectPosition.z },
                    object: objectInstance
                });
            }

            // Register woodcutter buildings for Woodcutter AI detection
            if (structureType === 'woodcutter' && this.game.gameState) {
                this.game.gameState.registerWoodcutter(chunkKey, {
                    id: objectInstance.userData.objectId,
                    position: { x: objectPosition.x, y: objectPosition.y, z: objectPosition.z },
                    object: objectInstance
                });
            }

            // Register miner buildings for Miner AI detection
            if (structureType === 'miner' && this.game.gameState) {
                this.game.gameState.registerMiner(chunkKey, {
                    id: objectInstance.userData.objectId,
                    position: { x: objectPosition.x, y: objectPosition.y, z: objectPosition.z },
                    object: objectInstance
                });
            }

            // Register ironworks for IronWorker AI detection
            if (structureType === 'ironworks' && this.game.gameState) {
                this.game.gameState.registerIronworks(chunkKey, {
                    id: objectInstance.userData.objectId,
                    position: { x: objectPosition.x, y: objectPosition.y, z: objectPosition.z },
                    object: objectInstance
                });
            }

            // Register tileworks for TileWorker AI detection
            if (structureType === 'tileworks' && this.game.gameState) {
                this.game.gameState.registerTileworks(chunkKey, {
                    id: objectInstance.userData.objectId,
                    position: { x: objectPosition.x, y: objectPosition.y, z: objectPosition.z },
                    object: objectInstance
                });
            }

            // Register blacksmith for Blacksmith AI detection
            if (structureType === 'blacksmith' && this.game.gameState) {
                this.game.gameState.registerBlacksmith(chunkKey, {
                    id: objectInstance.userData.objectId,
                    position: { x: objectPosition.x, y: objectPosition.y, z: objectPosition.z },
                    object: objectInstance
                });
            }

            // Register stonemason for StoneMason AI detection
            if (structureType === 'stonemason' && this.game.gameState) {
                this.game.gameState.registerStonemason(chunkKey, {
                    id: objectInstance.userData.objectId,
                    position: { x: objectPosition.x, y: objectPosition.y, z: objectPosition.z },
                    object: objectInstance
                });
            }

            // Register fisherman for Fisherman AI detection
            if (structureType === 'fisherman' && this.game.gameState) {
                this.game.gameState.registerFisherman(chunkKey, {
                    id: objectInstance.userData.objectId,
                    position: { x: objectPosition.x, y: objectPosition.y, z: objectPosition.z },
                    object: objectInstance
                });
            }

            // NOTE: Dock handling moved to terrain-based system (returns early above)
            // Docks now use raised terrain + texture overlay instead of 3D model

            // Add smoke effect for campfires
            if (structureType === 'campfire') {
                this.game.addCampfireSmoke(objectInstance.userData.objectId, objectInstance.position);

                // Check initial inventory for firewood
                if (objectInstance.userData.inventory) {
                    const hasFirewood = objectInstance.userData.inventory.items.some(item =>
                        item.type && item.type.endsWith('firewood') && item.durability > 0
                    );

                    if (hasFirewood) {
                        const smokeEffect = this.game.effectManager.smokeEffects.get(objectInstance.userData.objectId);
                        if (smokeEffect && !smokeEffect.active) {
                            smokeEffect.start();
                        }
                    }
                }

                // Store materialType and apply sandstone tint if applicable
                objectInstance.userData.materialType = data.materialType || 'limestone';
                if (data.materialType === 'sandstone') {
                    this.applySandstoneTint(objectInstance);
                }
            }

            // Add smoke effects for tileworks (2 chimneys at diagonal corners)
            if (structureType === 'tileworks') {
                this.game.addTileworksSmoke(objectInstance.userData.objectId, objectInstance.position, finalModelRotation);

                // Check initial inventory for firewood
                if (objectInstance.userData.inventory) {
                    const hasFirewood = objectInstance.userData.inventory.items.some(item =>
                        item.type && item.type.endsWith('firewood') && item.durability > 0
                    );

                    if (hasFirewood) {
                        const smokeEffect1 = this.game.effectManager.smokeEffects.get(objectInstance.userData.objectId + '_1');
                        const smokeEffect2 = this.game.effectManager.smokeEffects.get(objectInstance.userData.objectId + '_2');
                        if (smokeEffect1 && !smokeEffect1.active) {
                            smokeEffect1.start();
                        }
                        if (smokeEffect2 && !smokeEffect2.active) {
                            smokeEffect2.start();
                        }
                    }
                }

                // Store materialType and apply sandstone tint if applicable
                objectInstance.userData.materialType = data.materialType || 'limestone';
                if (data.materialType === 'sandstone') {
                    this.applySandstoneTint(objectInstance);
                }
            }

            // Add smoke effect for ironworks (single centered chimney)
            if (structureType === 'ironworks') {
                this.game.addIronworksSmoke(objectInstance.userData.objectId, objectInstance.position, finalModelRotation);

                // Check initial inventory for firewood
                if (objectInstance.userData.inventory) {
                    const hasFirewood = objectInstance.userData.inventory.items.some(item =>
                        item.type && item.type.endsWith('firewood') && item.durability > 0
                    );

                    if (hasFirewood) {
                        const smokeEffect = this.game.effectManager.smokeEffects.get(objectInstance.userData.objectId);
                        if (smokeEffect && !smokeEffect.active) {
                            smokeEffect.start();
                        }
                    }
                }

                // Store materialType and apply sandstone tint if applicable
                objectInstance.userData.materialType = data.materialType || 'limestone';
                if (data.materialType === 'sandstone') {
                    this.applySandstoneTint(objectInstance);
                }
            }

            // Add smoke effect for blacksmith (single centered chimney, same as ironworks)
            if (structureType === 'blacksmith') {
                this.game.addBlacksmithSmoke(objectInstance.userData.objectId, objectInstance.position, finalModelRotation);

                // Check initial inventory for firewood
                if (objectInstance.userData.inventory) {
                    const hasFirewood = objectInstance.userData.inventory.items.some(item =>
                        item.type && item.type.endsWith('firewood') && item.durability > 0
                    );

                    if (hasFirewood) {
                        const smokeEffect = this.game.effectManager.smokeEffects.get(objectInstance.userData.objectId);
                        if (smokeEffect && !smokeEffect.active) {
                            smokeEffect.start();
                        }
                    }
                }

                // Store materialType and apply sandstone tint if applicable
                objectInstance.userData.materialType = data.materialType || 'limestone';
                if (data.materialType === 'sandstone') {
                    this.applySandstoneTint(objectInstance);
                }
            }

            // Add smoke effect for bakery (single centered chimney, same as blacksmith/ironworks)
            if (structureType === 'bakery') {
                this.game.addBakerySmoke(objectInstance.userData.objectId, objectInstance.position, finalModelRotation);

                // Check initial inventory for firewood
                if (objectInstance.userData.inventory) {
                    const hasFirewood = objectInstance.userData.inventory.items.some(item =>
                        item.type && item.type.endsWith('firewood') && item.durability > 0
                    );

                    if (hasFirewood) {
                        const smokeEffect = this.game.effectManager.smokeEffects.get(objectInstance.userData.objectId);
                        if (smokeEffect && !smokeEffect.active) {
                            smokeEffect.start();
                        }
                    }
                }

                // Store materialType and apply sandstone tint if applicable
                objectInstance.userData.materialType = data.materialType || 'limestone';
                if (data.materialType === 'sandstone') {
                    this.applySandstoneTint(objectInstance);
                }
            }

            // Add smoke effect for fisherman (single centered chimney, same as bakery)
            if (structureType === 'fisherman') {
                this.game.addFishermanSmoke(objectInstance.userData.objectId, objectInstance.position, finalModelRotation);

                // Check initial inventory for firewood
                if (objectInstance.userData.inventory) {
                    const hasFirewood = objectInstance.userData.inventory.items.some(item =>
                        item.type && item.type.endsWith('firewood') && item.durability > 0
                    );

                    if (hasFirewood) {
                        const smokeEffect = this.game.effectManager.smokeEffects.get(objectInstance.userData.objectId);
                        if (smokeEffect && !smokeEffect.active) {
                            smokeEffect.start();
                        }
                    }
                }

                // Store materialType and apply sandstone tint if applicable
                objectInstance.userData.materialType = data.materialType || 'limestone';
                if (data.materialType === 'sandstone') {
                    this.applySandstoneTint(objectInstance);
                }
            }

            // Add smoke effect for houses (chimney)
            if (structureType === 'house') {
                this.game.addHouseSmoke(objectInstance.userData.objectId, objectInstance.position, finalModelRotation);

                // Check initial inventory for firewood
                if (objectInstance.userData.inventory) {
                    const hasFirewood = objectInstance.userData.inventory.items.some(item =>
                        item.type && item.type.endsWith('firewood') && item.durability > 0
                    );

                    if (hasFirewood) {
                        const smokeEffect = this.game.effectManager.smokeEffects.get(objectInstance.userData.objectId);
                        if (smokeEffect && !smokeEffect.active) {
                            smokeEffect.start();
                        }
                    }
                }

                // Store materialType and apply sandstone tint if applicable
                objectInstance.userData.materialType = data.materialType || 'limestone';
                if (data.materialType === 'sandstone') {
                    this.applySandstoneTint(objectInstance);
                }
            }

            // Apply sandstone tint for market structures
            if (structureType === 'market') {
                objectInstance.userData.materialType = data.materialType || 'limestone';
                if (data.materialType === 'sandstone') {
                    this.applySandstoneTint(objectInstance);
                }
            }

            // Apply sandstone tint for wall structures
            if (structureType === 'wall') {
                objectInstance.userData.materialType = data.materialType || 'limestone';
                if (data.materialType === 'sandstone') {
                    this.applySandstoneTint(objectInstance);
                }
            }

            // Apply sandstone tint for worker structures without smoke effects
            if (structureType === 'miner' || structureType === 'woodcutter' || structureType === 'stonemason' || structureType === 'gardener') {
                objectInstance.userData.materialType = data.materialType || 'limestone';
                if (data.materialType === 'sandstone') {
                    this.applySandstoneTint(objectInstance);
                }
            }

            // Register physics collider ONLY if within physics radius
            if (this.game.physicsManager && this.game.physicsManager.initialized) {
                let withinPhysicsRadius = true; // Default to true if player position not set

                // Only apply physics radius check if we have valid player chunk coordinates
                if (typeof this.gameState.currentPlayerChunkX === 'number' &&
                    typeof this.gameState.currentPlayerChunkZ === 'number' &&
                    !isNaN(this.gameState.currentPlayerChunkX) &&
                    !isNaN(this.gameState.currentPlayerChunkZ)) {

                    const playerChunkX = this.gameState.currentPlayerChunkX;
                    const playerChunkZ = this.gameState.currentPlayerChunkZ;
                    const [objChunkX, objChunkZ] = chunkKey.split(',').map(Number);
                    const chunkDistX = Math.abs(objChunkX - playerChunkX);
                    const chunkDistZ = Math.abs(objChunkZ - playerChunkZ);
                    withinPhysicsRadius = chunkDistX <= CONFIG.CHUNKS.PHYSICS_RADIUS &&
                                           chunkDistZ <= CONFIG.CHUNKS.PHYSICS_RADIUS;
                }

                if (withinPhysicsRadius) {
                    const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[modelType];

                    // Skip physics colliders for roads and docks (terrain modifications, walkable surfaces)
                    if (dims && modelType !== 'road' && modelType !== 'dock') {
                        let shape;
                        let collisionGroup;

                        // Determine shape type
                        if (dims.radius !== undefined) {
                            // Cylinder for trees, rocks, artillery, bear dens (objects with radius)
                            shape = {
                                type: 'cylinder',
                                radius: dims.radius,
                                height: dims.height || 1.0
                            };
                            // Determine collision group for cylindrical objects
                            if (modelType === 'artillery') {
                                collisionGroup = COLLISION_GROUPS.PLACED;
                            } else if (modelType === 'bearden' || modelType === 'horse' || modelType === 'cart') {
                                collisionGroup = COLLISION_GROUPS.STRUCTURE;
                            } else {
                                collisionGroup = COLLISION_GROUPS.NATURAL;
                            }
                        } else {
                            // Cuboid for structures, logs, crates
                            shape = {
                                type: 'cuboid',
                                width: dims.width,
                                depth: dims.depth,
                                height: dims.height || 1.0
                            };

                            // Determine collision group based on object type
                            if (modelType === 'log' || modelType.endsWith('_log') || modelType === 'crate') {
                                collisionGroup = COLLISION_GROUPS.PLACED;
                            } else {
                                collisionGroup = COLLISION_GROUPS.STRUCTURE;
                            }
                        }

                        // For walls, compute collider position from mesh's world matrix
                        // Wall model spans local x=0 to x=1, so local center is at (0.5, 0, 0)
                        let colliderPosition = objectPosition;
                        if (modelType === 'wall') {
                            objectInstance.updateMatrixWorld(true);
                            const localCenter = new THREE.Vector3(0.5, 0, 0);
                            const worldCenter = localCenter.applyMatrix4(objectInstance.matrixWorld);
                            colliderPosition = worldCenter;
                        }

                        // Create static collider
                        // DEBUG: Log objects missing IDs
                        if (!objectInstance.userData.objectId) {
                            console.warn('[DEBUG] Object missing ID:', { type: modelType, data_id: data.id, data_objectId: data.objectId, data });
                        }
                        const collider = this.game.physicsManager.createStaticCollider(
                            objectInstance.userData.objectId,
                            shape,
                            colliderPosition,
                            objectRotation,
                            collisionGroup
                        );

                        // Store handle for cleanup
                        if (collider) {
                            objectInstance.userData.physicsHandle = collider;
                        }
                    }
                }
            }

            // Register ships and boats for animation
            const waterVehicleTypes = ['ship', 'boat', 'sailboat', 'ship2'];
            if (waterVehicleTypes.includes(data.objectType) || waterVehicleTypes.includes(data.name)) {
                this.game.animationSystem.registerShip(objectInstance);
            }

            // Add to chunkObjects for proximity detection
            const chunkObjects = this.game.chunkManager.chunkObjects.get(chunkKey) || [];
            chunkObjects.push(objectInstance);
            this.game.chunkManager.chunkObjects.set(chunkKey, chunkObjects);

            // Add to objectRegistry for fast lookups
            if (this.game.objectRegistry && objectInstance.userData.objectId) {
                this.game.objectRegistry.set(objectInstance.userData.objectId, objectInstance);
            }

            // Update navigation map - add obstacle
            if (this.game.navigationManager) {
                const chunkId = `chunk_${chunkKey}`;
                const navMap = this.game.navigationManager.getChunk(chunkId);
                if (navMap) {
                    const scale = objectInstance.userData?.originalScale || objectInstance.scale?.x || 1.0;
                    const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[objectType];
                    if (dims) {
                        // Small natural objects use minimal 1-cell footprint (must match NavigationMap.addObstaclesFromObjectList)
                        const SMALL_OBSTACLE_TYPES = ['pine', 'apple', 'vegetables', 'hemp', 'limestone', 'sandstone', 'clay', 'iron',
                            'planted_pine', 'planted_fir', 'planted_apple', 'planted_vegetables', 'planted_hemp'];
                        if (SMALL_OBSTACLE_TYPES.includes(objectType)) {
                            navMap.addSmallObstacle(objectPosition.x, objectPosition.z, 0.1);
                        } else if (dims.radius !== undefined) {
                            const radius = dims.radius * scale;
                            navMap.addCylindricalObstacle(objectPosition.x, objectPosition.z, radius);
                        } else if (dims.width !== undefined && dims.depth !== undefined) {
                            const width = dims.width * scale;
                            const depth = dims.depth * scale;
                            navMap.addRectangularObstacle(objectPosition.x, objectPosition.z, width, depth, objectRotation);
                        }
                        this.game.navigationManager.syncChunkToWorker(chunkId);
                    }
                }
            }

            // TERRAIN LEVELING DISABLED - uncomment to re-enable
            // Level terrain for structures that require it
            // const structuresToLevel = ['crate', 'house', 'outpost', 'tent', 'market', 'tileworks', 'ironworks', 'blacksmith', 'bakery', 'gardener', 'miner', 'woodcutter', 'stonemason'];
            // const typeToCheck = data.isConstructionSite ? data.targetStructure : structureType;
            //
            // if (structuresToLevel.includes(typeToCheck) && data.finalFoundationY && this.game.terrainGenerator) {
            //     const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS[typeToCheck];
            //
            //     if (dims && dims.width) {  // Skip circular structures (they have radius instead)
            //         // Add leveled area to terrain generator
            //         this.game.terrainGenerator.addLeveledArea(
            //             objectPosition.x,
            //             objectPosition.z,
            //             dims.width,
            //             dims.depth,
            //             data.finalFoundationY - 0.1,  // Lowered by 0.1 for better visual fit
            //             objectRotationDegrees || 0
            //         );
            //
            //         // Force clipmap refresh for the affected region
            //         const radius = Math.max(dims.width, dims.depth) / 2 + 2;
            //         if (this.game.clipmap) {
            //             this.game.clipmap.forceRefreshRegion(
            //                 objectPosition.x,
            //                 objectPosition.z,
            //                 radius
            //             );
            //         } else {
            //             console.warn('[SceneObjectFactory] this.game.clipmap is null/undefined!');
            //         }
            //
            //         // Update navigation for leveled terrain
            //         if (this.game.navigationManager) {
            //             this.game.navigationManager.rebuildRegionForLeveledTerrain(
            //                 objectPosition.x,
            //                 objectPosition.z,
            //                 dims.width,
            //                 dims.depth,
            //                 objectRotationDegrees || 0,
            //                 this.game.terrainGenerator
            //             );
            //         }
            //     }
            // }

            return objectInstance;
        }

        return null;
    }

    /**
     * Apply a subtle yellow/sandy tint to sandstone structures
     * @param {THREE.Object3D} object - The object to tint
     */
    applySandstoneTint(object) {
        // Sandstone tint color (warm tan/beige)
        // Values > 1.0 brighten, < 1.0 darken that channel
        // Tan = subtle warm tint with balanced channels
        const sandstoneTint = new THREE.Color(1.25, 1.10, 0.80);  // Warm tan color

        object.traverse((child) => {
            if (child.isMesh && child.material) {
                // Handle both single materials and material arrays
                const materials = Array.isArray(child.material) ? child.material : [child.material];

                materials.forEach((mat) => {
                    // Clone material to avoid affecting other instances
                    const clonedMat = mat.clone();

                    // Apply tint to diffuse/base color
                    if (clonedMat.color) {
                        clonedMat.color.multiply(sandstoneTint);
                    }

                    // Also tint emissive slightly for consistency
                    if (clonedMat.emissive) {
                        clonedMat.emissive.multiply(new THREE.Color(1.05, 1.02, 0.95));
                    }

                    clonedMat.needsUpdate = true;

                    // Replace original material
                    if (Array.isArray(child.material)) {
                        const idx = child.material.indexOf(mat);
                        child.material[idx] = clonedMat;
                    } else {
                        child.material = clonedMat;
                    }
                });
            }
        });
    }

    /**
     * Create a corpse object (dead player/bandit/militia with lootable inventory)
     * @param {Object} data - Corpse data from server
     * @param {string} chunkKey - Chunk key for the corpse location
     * @returns {THREE.Object3D|null} The created corpse object
     */
    createCorpseObject(data, chunkKey) {
        const baseModel = data.modelType || 'man';
        const pos = Array.isArray(data.position) ? data.position : [data.position.x, data.position.y, data.position.z];
        const objectPosition = new THREE.Vector3(pos[0], pos[1], pos[2]);
        const objectRotation = data.rotation || 0;

        // Create the base model instance
        const instance = objectPlacer.createInstance(baseModel, objectPosition, 1.0, objectRotation, this.scene);

        if (!instance) {
            return null;
        }

        // Apply death pose (90 degree fall) - formula from DeathSystem.js
        // Rotate instance directly (like peer death animation), not children[0]
        if (data.fallDirection !== undefined) {
            const fallAngle = (Math.PI / 2) * data.fallDirection;
            const yRot = objectRotation;
            instance.rotation.x = fallAngle * Math.sin(yRot);
            instance.rotation.z = fallAngle * Math.cos(yRot);
        }

        // Apply shirt color (pattern from ai-enemy.js)
        if (data.shirtColor && baseModel === 'man') {
            instance.traverse(child => {
                if (child.isMesh && child.name === 'Cube001_3') {
                    const mat = child.material.clone();
                    mat.color.setHex(data.shirtColor);
                    child.material = mat;
                }
            });
        }

        // Store metadata
        instance.userData = {
            objectId: data.id || data.objectId,
            modelType: 'corpse',
            isCorpse: true,
            corpseType: data.corpseType,
            inventory: data.inventory,
            displayName: data.displayName,
            quality: data.quality,
            lastRepairTime: data.lastRepairTime,
            chunkKey: chunkKey
        };

        this.scene.add(instance);

        // Track for decay (corpses decay like other structures)
        if (this.game?.gameState) {
            this.game.gameState.decayableStructures.add(instance.userData.objectId);
        }

        // Create physics collider for interaction detection
        if (this.game.physicsManager && this.game.physicsManager.initialized) {
            const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS['corpse'];
            if (dims) {
                const shape = {
                    type: 'cuboid',
                    width: dims.width,
                    depth: dims.depth,
                    height: dims.height || 0.3
                };
                const collider = this.game.physicsManager.createStaticCollider(
                    instance.userData.objectId,
                    shape,
                    objectPosition,
                    objectRotation,
                    COLLISION_GROUPS.PLACED
                );
                if (collider) {
                    instance.userData.physicsHandle = collider;
                }
            }
        }

        // Add to chunkObjects for proximity detection
        const chunkObjects = this.game.chunkManager.chunkObjects.get(chunkKey) || [];
        chunkObjects.push(instance);
        this.game.chunkManager.chunkObjects.set(chunkKey, chunkObjects);

        // Add to objectRegistry for fast lookups
        if (this.game.objectRegistry && instance.userData.objectId) {
            this.game.objectRegistry.set(instance.userData.objectId, instance);
        }

        return instance;
    }

    /**
     * Add a faction flag to a ship2's mast
     * @param {THREE.Object3D} shipObject - The ship2 object
     * @param {number} factionId - The faction ID (1 = Southguard, 3 = Northmen)
     */
    addFactionFlag(shipObject, factionId) {
        // Get faction color - white (0xffffff) for neutral/guest, faction color otherwise
        const factionColors = CONFIG.FACTION_COLORS;
        let flagColor = 0xffffff; // Default white for neutral
        if (factionColors && factionColors[factionId]) {
            flagColor = factionColors[factionId].shirt;
        }

        // Create flag geometry (0.3 x 0.4 in world units)
        const flagGeometry = new THREE.PlaneGeometry(0.3, 0.4);

        // Create flag material with double-sided rendering
        const flagMaterial = new THREE.MeshBasicMaterial({
            color: flagColor,
            side: THREE.DoubleSide
        });

        const flagMesh = new THREE.Mesh(flagGeometry, flagMaterial);

        // Position flag at top of mast (model was pre-scaled in Blender, baseScale is 1.0)
        flagMesh.position.set(0, 7.1, -1);
        flagMesh.rotation.y = Math.PI / 4;  // Angle flag for visibility

        shipObject.add(flagMesh);
        shipObject.userData.factionFlag = flagMesh;
    }

    /**
     * Add a faction flag to a market's roof
     * @param {THREE.Object3D} marketObject - The market object
     * @param {number} factionId - The faction ID (1 = Southguard, 3 = Northmen)
     */
    addMarketFlag(marketObject, factionId) {
        // Get faction color - white (0xffffff) for neutral/guest, faction color otherwise
        const factionColors = CONFIG.FACTION_COLORS;
        let flagColor = 0xffffff; // Default white for neutral
        if (factionColors && factionColors[factionId]) {
            flagColor = factionColors[factionId].shirt;
        }

        // Create flag group to hold post and flag
        const flagGroup = new THREE.Group();

        // Create post (thin pole)
        const postGeometry = new THREE.BoxGeometry(0.1, 1.0, 0.1);
        postGeometry.translate(0, 0.5, 0); // Shift so bottom is at origin
        const postMaterial = new THREE.MeshBasicMaterial({ color: 0x4a3728 }); // Dark brown
        const postMesh = new THREE.Mesh(postGeometry, postMaterial);
        flagGroup.add(postMesh);

        // Create triangular pennant flag using BufferGeometry
        const flagGeometry = new THREE.BufferGeometry();
        const vertices = new Float32Array([
            0, 0, 0,       // Base top (at top of post)
            0, -0.4, 0,    // Base bottom
            0.5, -0.2, 0   // Point (extends 0.5 units horizontally)
        ]);
        flagGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        flagGeometry.computeVertexNormals();

        const flagMaterial = new THREE.MeshBasicMaterial({
            color: flagColor,
            side: THREE.DoubleSide
        });
        const flagMesh = new THREE.Mesh(flagGeometry, flagMaterial);
        flagMesh.position.set(0.05, 1.0, 0); // Position at top of post
        flagMesh.rotation.y = Math.PI / 4; // Angle for visibility
        flagGroup.add(flagMesh);

        // Position entire flag group on roof
        flagGroup.position.set(0, 2.2, 0);

        marketObject.add(flagGroup);
        marketObject.userData.factionFlag = flagGroup;
    }

}

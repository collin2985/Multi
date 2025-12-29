/**
 * SceneObjectFactory.js
 * Handles creation of 3D objects in the scene from server data
 * Extracted from MessageRouter.js to reduce file size
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { objectPlacer } from '../objects.js';
import { COLLISION_GROUPS } from '../core/PhysicsManager.js';

export class SceneObjectFactory {
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        this.gameState = game.gameState;

        // Cache for cylindrical billboard shader material
        this.cylindricalBillboardMaterials = new Map();
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

                    // Calculate fog depth
                    vFogDepth = -mvPosition.z;
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

            // Update navigation map - use circular approximation (radius 1.0 covers pill area)
            if (this.game.navigationManager && change.chunkId) {
                const navMap = this.game.navigationManager.getChunk(change.chunkId);
                if (navMap) {
                    navMap.addRoad(change.position[0], change.position[2], 1.0);
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
                existingObject.userData.remainingResources = change.remainingResources || null;
                existingObject.userData.totalResources = change.totalResources || null;
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
            if ((structureType === 'crate' || structureType === 'tent' || structureType === 'house' || structureType === 'garden' || structureType === 'market' || structureType === 'campfire') && change.inventory) {
                existingObject.userData.inventory = change.inventory;
            }
            return true;
        } else {
            // Create new object
            return this.createObjectInScene(change, chunkKey) !== null;
        }
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

            // Update navigation map - use circular approximation (radius 1.0 covers pill area)
            if (this.game.navigationManager) {
                const chunkId = `chunk_${chunkKey}`;
                const navMap = this.game.navigationManager.getChunk(chunkId);
                if (navMap) {
                    navMap.addRoad(data.position[0], data.position[2], 1.0);
                }
            }
            return null; // Don't create 3D object for roads
        }

        const objectPosition = new THREE.Vector3(data.position[0], data.position[1], data.position[2]);

        // Force dock Y to fixed height regardless of server data
        if (objectType === 'dock') {
            objectPosition.y = CONFIG.CONSTRUCTION.STRUCTURE_PROPERTIES.dock.deckHeight;
        }

        // Force mobile entities Y to terrain height (server may send incorrect Y)
        if ((objectType === 'horse' || objectType === 'cart' || objectType === 'artillery') && this.game.terrainGenerator) {
            objectPosition.y = this.game.terrainGenerator.getWorldHeight(objectPosition.x, objectPosition.z);
        }

        const objectRotation = data.rotation !== undefined ? (data.rotation * Math.PI / 180) : (Math.random() * Math.PI * 2);

        // Store rotation in degrees for reference
        const objectRotationDegrees = data.rotation !== undefined ? data.rotation : (objectRotation * 180 / Math.PI);

        const finalModelRotation = objectRotation;

        // Normalize planted types for visual rendering (planted_vegetables -> vegetables, etc.)
        const visualType = objectType.startsWith('planted_') ? objectType.replace('planted_', '') : objectType;

        // Check if this is a tree type that should use billboards (includes vegetables)
        const TREE_TYPES = ['oak', 'fir', 'pine', 'cypress', 'apple', 'vegetables', 'deertree'];
        const isTree = TREE_TYPES.includes(visualType);

        let objectInstance;
        if (data.isGrowing && isTree) {
            // Growing trees/vegetables: Create cylindrical billboard that scales with growth
            // Config matches BillboardSystem exactly for consistency
            const billboardConfig = {
                pine: { width: 4, height: 6, yOffset: -0.5, brightness: 0.95, colorR: 1.0, colorG: 1.0, colorB: 1.0, texture: 'pinefinal.webp' },
                apple: { width: 8.4, height: 5, yOffset: -1.3, brightness: 0.55, colorR: 1.0, colorG: 1.0, colorB: 1.0, texture: 'applefinal.webp' },
                vegetables: { width: 0.8, height: 0.7, yOffset: -0.25, brightness: 0.85, colorR: 1.65, colorG: 1.0, colorB: 0, texture: 'vegetables.png' },
                deertree: { width: 4, height: 6, yOffset: -0.5, brightness: 0.95, colorR: 1.0, colorG: 1.0, colorB: 1.0, texture: 'pinefinal.webp' }
            };
            const config = billboardConfig[visualType] || billboardConfig.pine;

            // Calculate current scale based on tick-based growth
            // Vegetables: 75% -> 100%, Trees: 25% -> 100%
            const isVegetables = visualType === 'vegetables';
            const startScale = isVegetables ? 0.75 : 0.25;
            const growthRange = 1.0 - startScale;
            const growthDurationTicks = data.growthDurationTicks || 1800;

            let currentScale = data.scale || startScale;
            if (data.plantedAtTick && this.game.gameState?.serverTick) {
                const ticksElapsed = this.game.gameState.serverTick - data.plantedAtTick;
                currentScale = Math.min(1.0, startScale + (growthRange * (ticksElapsed / growthDurationTicks)));
            }

            // Create cylindrical billboard at FULL size (matches natural trees in BillboardSystem)
            // Use object.scale for growth animation - geometry stays fixed
            const billboard = this.createCylindricalBillboard(
                `./models/${config.texture}`,
                config.width,
                config.height,
                config.yOffset,
                config.brightness,
                { r: config.colorR, g: config.colorG, b: config.colorB }
            );

            // Set initial scale based on growth progress
            // updateGrowingTrees and handleTreeGrowthComplete will animate this
            billboard.scale.set(currentScale, currentScale, currentScale);

            billboard.position.copy(objectPosition);
            billboard.userData.yOffset = config.yOffset;  // Store for GUI adjustment
            billboard.userData.modelType = `planted_${visualType}`;  // Store tree type
            objectInstance = billboard;

            // Planted vegetables use same billboard as natural ones - no stake needed
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
            objectInstance.userData.currentDurability = data.currentDurability;
            objectInstance.userData.hoursUntilRuin = data.hoursUntilRuin;
            objectInstance.userData.modelType = data.name || data.objectType;
            objectInstance.userData.owner = data.owner || null;  // Store owner information
            objectInstance.userData.ownerName = data.ownerName || null;  // Store owner display name
            objectInstance.userData.ownerFactionId = data.ownerFactionId ?? null;  // Store owner faction for artillery targeting
            objectInstance.userData.isBanditStructure = data.isBanditStructure || false;  // Bandit camp marker
            objectInstance.userData.isBrownBearStructure = data.isBrownBearStructure || false;  // Brown bear den marker

            // Initialize resources for logs if not present (backwards compatibility)
            const modelType = data.name || data.objectType;

            if ((modelType === 'log' || modelType.endsWith('_log')) &&
                (data.totalResources == null || data.remainingResources == null)) {
                objectInstance.userData.totalResources = 1;
                objectInstance.userData.remainingResources = 1;
            } else {
                objectInstance.userData.totalResources = data.totalResources || null;
                objectInstance.userData.remainingResources = data.remainingResources || null;
            }

            // Handle construction site metadata
            if (data.isConstructionSite) {
                objectInstance.userData.isConstructionSite = true;
                objectInstance.userData.targetStructure = data.targetStructure;
                objectInstance.userData.requiredMaterials = data.requiredMaterials || {};
                objectInstance.userData.materials = data.materials || {};
                objectInstance.userData.rotation = data.rotation;
                objectInstance.userData.finalFoundationY = data.finalFoundationY;
            }

            // Handle crate/tent/house/garden/market/campfire/tileworks/apple inventory
            const structureType = data.name || data.objectType;
            if ((structureType === 'crate' || structureType === 'tent' || structureType === 'house' || structureType === 'garden' || structureType === 'market' || structureType === 'campfire' || structureType === 'tileworks' || structureType === 'apple') && data.inventory) {
                objectInstance.userData.inventory = data.inventory;
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

            this.scene.add(objectInstance);

            // Track decayable structures for efficient decay checks (avoids scene.traverse)
            const decayableTypes = new Set(['house', 'crate', 'tent', 'outpost', 'campfire',
                                            'garden', 'market', 'dock', 'tileworks', 'ship', 'boat', 'horse', 'cart', 'artillery']);
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
                    object: objectInstance
                });
            }

            // Register brown bear structures for AI detection
            if (data.isBrownBearStructure && this.game.gameState) {
                this.game.gameState.registerBrownBearStructure(chunkKey, {
                    id: objectInstance.userData.objectId,
                    position: { x: objectPosition.x, y: objectPosition.y, z: objectPosition.z },
                    type: structureType,
                    object: objectInstance
                });
            }

            // Register deer tree structures for AI detection
            if (data.isDeerTreeStructure && this.game.gameState) {
                this.game.gameState.registerDeerTreeStructure(chunkKey, {
                    id: objectInstance.userData.objectId,
                    position: { x: objectPosition.x, y: objectPosition.y, z: objectPosition.z },
                    type: structureType,
                    object: objectInstance
                });
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

            // Create invisible collision box for docks (for easier raycasting)
            if (structureType === 'dock') {
                const dims = CONFIG.CONSTRUCTION.GRID_DIMENSIONS['dock'];
                if (dims) {
                    // Create box geometry matching bounding box dimensions
                    const boxGeometry = new THREE.BoxGeometry(dims.width, dims.height, dims.depth);
                    // Simple material - invisible but raycastable
                    const boxMaterial = new THREE.MeshBasicMaterial({
                        visible: false // Renderer ignores it (no sorting issues), Raycaster still hits it
                    });
                    const collisionBox = new THREE.Mesh(boxGeometry, boxMaterial);

                    // Position at collider location using config offset
                    const offset = CONFIG.CONSTRUCTION.STRUCTURE_PROPERTIES.dock.raycastBoxOffset;
                    collisionBox.position.set(0, offset, 0); // Relative to parent
                    collisionBox.userData.isDockCollisionBox = true;
                    collisionBox.userData.parentDock = objectInstance;

                    // Add as child of dock object
                    objectInstance.add(collisionBox);
                    objectInstance.userData.collisionBox = collisionBox;
                }

                // Register dock with scheduled ship system
                if (this.game.scheduledShipSystem) {
                    const dockId = data.id || data.objectId;
                    const dockRotation = data.rotation || 0;
                    const lastShipSpawn = data.lastShipSpawn || 0;
                    this.game.scheduledShipSystem.registerDock(
                        dockId,
                        [data.position[0], data.position[1], data.position[2]],
                        dockRotation,
                        lastShipSpawn,
                        `chunk_${chunkKey}` // Pass chunkId for trade processing
                    );

                    // Ensure merchant exists for this dock (for late joiners)
                    if (this.game.dockMerchantSystem && lastShipSpawn) {
                        this.game.dockMerchantSystem.ensureMerchantExists(
                            dockId,
                            [data.position[0], data.position[1], data.position[2]],
                            dockRotation,
                            lastShipSpawn
                        );
                    }
                }
            }

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
                        console.log(`Started tileworks smoke for ${objectInstance.userData.objectId} (initial firewood present)`);
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
                            console.log(`Started ironworks smoke for ${objectInstance.userData.objectId} (initial firewood present)`);
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
                            console.log(`Started blacksmith smoke for ${objectInstance.userData.objectId} (initial firewood present)`);
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
                            console.log(`Started bakery smoke for ${objectInstance.userData.objectId} (initial firewood present)`);
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
                            console.log(`Started house smoke for ${objectInstance.userData.objectId} (initial firewood present)`);
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

            // Apply sandstone tint for garden structures
            if (structureType === 'garden') {
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

                    // Skip physics colliders for roads (terrain modifications)
                    if (dims && modelType !== 'road') {
                        let shape;
                        let collisionGroup;

                        // Determine shape type
                        if (dims.radius !== undefined) {
                            // Cylinder for trees, rocks (natural objects with radius)
                            shape = {
                                type: 'cylinder',
                                radius: dims.radius,
                                height: dims.height || 1.0
                            };
                            collisionGroup = COLLISION_GROUPS.NATURAL;
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

                        // Create static collider
                        const collider = this.game.physicsManager.createStaticCollider(
                            objectInstance.userData.objectId,
                            shape,
                            objectPosition,
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
            if (data.objectType === 'ship' || data.name === 'ship' ||
                data.objectType === 'boat' || data.name === 'boat') {
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
                        if (dims.radius !== undefined) {
                            const radius = dims.radius * scale;
                            navMap.addCylindricalObstacle(objectPosition.x, objectPosition.z, radius);
                        } else if (dims.width !== undefined && dims.depth !== undefined) {
                            const width = dims.width * scale;
                            const depth = dims.depth * scale;
                            navMap.addRectangularObstacle(objectPosition.x, objectPosition.z, width, depth, objectRotation);
                        }
                    }
                }
            }

            // TERRAIN LEVELING DISABLED - uncomment to re-enable
            // Level terrain for structures that require it
            // const structuresToLevel = ['crate', 'house', 'garden', 'outpost', 'tent', 'market', 'tileworks', 'ironworks', 'blacksmith', 'bakery', 'gardener', 'miner', 'woodcutter', 'stonemason'];
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
        const sandstoneTint = new THREE.Color(1.15, 1.08, 0.92);  // Warm tan color
        console.log('[SANDSTONE TINT] Applying to:', object.userData?.modelType || object.name);

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

}

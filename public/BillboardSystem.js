import * as THREE from 'three';
import { CONFIG } from './config.js';
import { TERRAIN_CONFIG } from './terrainsystem.js';
import ChunkCoordinates from './core/ChunkCoordinates.js';

/**
 * BillboardSystem - Manages instanced tree billboards with per-instance opacity
 * Uses custom shader for efficient LOD rendering
 */
export class BillboardSystem {
    constructor(scene, terrainGenerator = null) {
        this.scene = scene;
        this.terrainGenerator = terrainGenerator;
        this.coarseGridSpacing = 16;  // Level 0 grid spacing for height sampling
        this.billboardMeshes = new Map(); // tree type -> InstancedMesh
        this.instanceData = new Map(); // tree object -> {type, index, position}
        this.availableIndices = new Map(); // tree type -> Set of available indices
        this.maxInstancesPerType = TERRAIN_CONFIG.BILLBOARD_MAX_INSTANCES || 100000;  // Quality-gated for GPU performance
        this.activeCountPerType = new Map(); // tree type -> highest used index + 1
        this.treesByChunk = new Map(); // chunkKey -> Set of treeObjects (spatial partitioning)

        // TEST FLAG: Set to false to disable billboard spawning for performance testing
        this.enabled = true;

        // Tree types with available billboard textures (includes rocks and structures for LOD)
        this.treeTypes = [
            // Trees
            'pine', 'apple', 'vegetables', 'deertree',
            // Rocks
            'limestone', 'sandstone', 'clay', 'iron',
            // Structures
            'tent', 'outpost', 'campfire', 'horse'
        ];

        // Billboard configuration per tree type (adjustable via GUI)
        this.billboardConfig = {
            pine: { width: 4, height: 6, yOffset: -0.5, brightness: 0.95, colorR: 1.0, colorG: 1.0, colorB: 1.0 },
            deertree: { width: 4, height: 6, yOffset: -0.5, brightness: 0.95, colorR: 1.0, colorG: 1.0, colorB: 1.0 },
            apple: { width: 8.4, height: 5, yOffset: -1.3, brightness: 0.55, colorR: 1.0, colorG: 1.0, colorB: 1.0 },
            vegetables: { width: 0.8, height: 0.7, yOffset: -0.25, brightness: 0.85, colorR: 1.65, colorG: 1.0, colorB: 0 },
            // Rock billboards (smaller, ground-level)
            limestone: { width: 1.9, height: 1.8, yOffset: -0.6, brightness: 1.2, colorR: 1.0, colorG: 1.0, colorB: 1.0 },
            sandstone: { width: 1.7, height: 2.1, yOffset: -0.9, brightness: 0.8, colorR: 1.0, colorG: 1.0, colorB: 1.0 },
            clay: { width: 0.9, height: 1.0, yOffset: -0.4, brightness: 1.2, colorR: 1.0, colorG: 1.0, colorB: 1.0 },
            iron: { width: 1.1, height: 1.5, yOffset: -0.6, brightness: 1.2, colorR: 1.0, colorG: 1.0, colorB: 1.0 },
            // Structure billboards
            tent: { width: 1.6, height: 1.0, yOffset: -0.1, brightness: 0.6, colorR: 1.0, colorG: 1.0, colorB: 1.0 },
            outpost: { width: 2.7, height: 2.9, yOffset: -0.1, brightness: 0.9, colorR: 1.0, colorG: 1.0, colorB: 1.0 },
            campfire: { width: 0.5, height: 0.5, yOffset: -0.1, brightness: 1.1, colorR: 1.0, colorG: 1.0, colorB: 1.0 },
            horse: { width: 1.0, height: 1.0, yOffset: -0.2, brightness: 0.85, colorR: 1.0, colorG: 1.0, colorB: 1.0 }
        };

        // Debug mode - shows all billboards at full opacity
        this.debugMode = false; // Use distance-based LOD (cross billboards handle close trees)

        // Legacy flag - pine/apple now handled in updateBillboards LOD check
        this.alwaysShowPineApple = false;

        // Reusable matrix to avoid per-object allocations (ISSUE-074)
        this._tempMatrix = new THREE.Matrix4();

        // Track which meshes need GPU buffer update (ISSUE-074)
        this._dirtyMeshes = new Set();

        this.initializeShaderMaterials();
        this.initializeInstancedMeshes();
    }

    /**
     * Sample terrain height at coarse LOD grid points with bilinear interpolation.
     * This matches the height visible on distant terrain LOD levels.
     */
    sampleCoarseHeight(x, z) {
        if (!this.terrainGenerator) return 0;

        const s = this.coarseGridSpacing;
        const gx = Math.floor(x / s), gz = Math.floor(z / s);
        const fx = (x / s) - gx, fz = (z / s) - gz;

        const h00 = this.terrainGenerator.getWorldHeight(gx * s, gz * s);
        const h10 = this.terrainGenerator.getWorldHeight((gx + 1) * s, gz * s);
        const h01 = this.terrainGenerator.getWorldHeight(gx * s, (gz + 1) * s);
        const h11 = this.terrainGenerator.getWorldHeight((gx + 1) * s, (gz + 1) * s);

        return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
    }

    /**
     * Create custom shader material with per-instance opacity support
     */
    createShaderMaterial(texturePath, treeType) {
        const texture = new THREE.TextureLoader().load(texturePath);
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;

        const vertexShader = `
            attribute float instanceOpacity;
            attribute float heightDiff;
            uniform float lodBlendStart;
            uniform float lodBlendEnd;
            varying float vOpacity;
            varying vec2 vUv;
            varying float vFogDepth;

            void main() {
                vOpacity = instanceOpacity;
                vUv = uv;

                // Get the instance position from the instance matrix
                vec3 instancePos = vec3(instanceMatrix[3].x, instanceMatrix[3].y, instanceMatrix[3].z);

                // Blend billboard Y toward coarse terrain height at distance
                float dist = length(cameraPosition.xz - instancePos.xz);
                float lodAlpha = smoothstep(lodBlendStart, lodBlendEnd, dist);
                instancePos.y += heightDiff * lodAlpha;

                // Get scale from instance matrix
                vec2 scale = vec2(
                    length(instanceMatrix[0].xyz),
                    length(instanceMatrix[1].xyz)
                );

                // Calculate camera position in world space
                vec3 cameraPos = cameraPosition;

                // Direction from billboard to camera (world space)
                vec3 toCamera = normalize(cameraPos - instancePos);

                // Cylindrical billboarding - face camera on XZ plane only
                // Keep Y (up) axis, calculate right vector perpendicular to up and toCamera
                vec3 worldUp = vec3(0.0, 1.0, 0.0);
                vec3 right = normalize(cross(worldUp, toCamera));

                // Keep up locked to world up for true cylindrical billboarding
                vec3 up = worldUp;

                // Build billboard vertex position in world space
                vec3 vertexPos = instancePos + right * position.x * scale.x + up * position.y * scale.y;

                // Transform to clip space
                vec4 mvPosition = modelViewMatrix * vec4(vertexPos, 1.0);
                gl_Position = projectionMatrix * mvPosition;

                // View-space fog depth (matches Three.js scene.fog and 3D objects)
                vFogDepth = -mvPosition.z;
            }
        `;

        const fragmentShader = `
            uniform sampler2D map;
            uniform float brightness;
            uniform vec3 colorTone;
            uniform vec3 fogColor;
            uniform float fogDensity;
            uniform float fogNear;
            uniform float fogFar;
            uniform bool useLinearFog;
            varying float vOpacity;
            varying vec2 vUv;
            varying float vFogDepth;

            void main() {
                vec4 texColor = texture2D(map, vUv);

                // Discard faint pixels to avoid depth artifacts
                if (texColor.a * vOpacity < 0.3) {
                    discard;
                }

                // Apply color tone and brightness adjustment
                vec3 adjustedColor = texColor.rgb * colorTone * brightness;

                // Calculate fog factor (view-space depth matches Three.js scene.fog)
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

                // Fade out alpha as fog increases (fully transparent at max fog)
                float alphaFade = 1.0 - fogFactor;
                gl_FragColor = vec4(finalColor, texColor.a * vOpacity * alphaFade);
            }
        `;

        const config = this.billboardConfig[treeType];

        // Get fog settings from the scene and config
        const fogColor = this.scene.fog ? this.scene.fog.color : new THREE.Color(0xcccccc);
        const useLinearFog = CONFIG.RENDERING.FOG_TYPE === 'linear';
        const fogDensity = this.scene.fog?.density || CONFIG.RENDERING.FOG_DENSITY || 0.02;
        const fogNear = CONFIG.RENDERING.FOG_NEAR || 300;
        const fogFar = CONFIG.RENDERING.FOG_FAR || 500;

        return new THREE.ShaderMaterial({
            uniforms: {
                map: { value: texture },
                brightness: { value: config.brightness },
                colorTone: { value: new THREE.Vector3(config.colorR, config.colorG, config.colorB) },
                fogColor: { value: fogColor },
                fogDensity: { value: fogDensity },
                fogNear: { value: fogNear },
                fogFar: { value: fogFar },
                useLinearFog: { value: useLinearFog },
                lodBlendStart: { value: 150.0 },
                lodBlendEnd: { value: 350.0 }
            },
            vertexShader,
            fragmentShader,
            transparent: true,
            depthWrite: true,  // Write to depth buffer for correct sorting
            depthTest: true,   // Test depth (won't render behind terrain)
            side: THREE.FrontSide,  // FrontSide only - saves GPU by not rendering backfaces
            alphaTest: 0.3     // Discard faint pixels to avoid depth artifacts
        });
    }

    /**
     * Initialize shader materials for each tree type
     */
    initializeShaderMaterials() {
        this.materials = new Map();

        for (const treeType of this.treeTypes) {
            // Determine texture path based on type
            // Pine, apple, and rocks use WebP format for better compression
            let texturePath;
            if (treeType === 'pine' || treeType === 'deertree') {
                texturePath = './models/pinefinal.webp';
            } else if (treeType === 'apple') {
                texturePath = './models/applefinal.webp';
            } else if (treeType === 'limestone' || treeType === 'sandstone' || treeType === 'clay' || treeType === 'iron') {
                texturePath = `./models/${treeType}.webp`;
            } else if (treeType === 'tent' || treeType === 'outpost' || treeType === 'campfire' || treeType === 'horse') {
                // Structure billboards use PNG format
                texturePath = `./models/${treeType}.png`;
            } else {
                texturePath = `./models/${treeType}.png`;
            }
            const material = this.createShaderMaterial(texturePath, treeType);
            this.materials.set(treeType, material);
        }
    }

    /**
     * Initialize InstancedMesh for each tree type
     */
    initializeInstancedMeshes() {
        for (const treeType of this.treeTypes) {
            this.createOrUpdateInstancedMesh(treeType);
        }
    }

    /**
     * Update fog uniforms across all billboard materials (call when quality settings change)
     */
    updateFogUniforms() {
        const fogColor = this.scene.fog ? this.scene.fog.color : new THREE.Color(0xcccccc);
        const fogNear = CONFIG.RENDERING.FOG_NEAR || 300;
        const fogFar = CONFIG.RENDERING.FOG_FAR || 500;

        for (const material of this.materials.values()) {
            if (material.uniforms.fogColor) {
                material.uniforms.fogColor.value.copy(fogColor);
            }
            if (material.uniforms.fogNear) {
                material.uniforms.fogNear.value = fogNear;
            }
            if (material.uniforms.fogFar) {
                material.uniforms.fogFar.value = fogFar;
            }
        }
    }

    /**
     * Create or update InstancedMesh for a specific tree type
     */
    createOrUpdateInstancedMesh(treeType) {
        const config = this.billboardConfig[treeType];
        const geometry = new THREE.PlaneGeometry(config.width, config.height);
        geometry.translate(0, config.height / 2 + config.yOffset, 0); // Pivot at bottom + yOffset

        const material = this.materials.get(treeType);

        // Check if mesh already exists
        const existingMesh = this.billboardMeshes.get(treeType);
        if (existingMesh) {
            // Save the old opacity and heightDiff arrays
            const oldOpacityAttribute = existingMesh.geometry.attributes.instanceOpacity;
            const oldOpacityArray = oldOpacityAttribute ? oldOpacityAttribute.array : new Float32Array(this.maxInstancesPerType);
            const oldHeightDiffAttr = existingMesh.geometry.attributes.heightDiff;
            const oldHeightDiffArray = oldHeightDiffAttr ? oldHeightDiffAttr.array : new Float32Array(this.maxInstancesPerType);

            // Update existing mesh geometry
            existingMesh.geometry.dispose();
            existingMesh.geometry = geometry;

            // Re-add the opacity and heightDiff attributes to the new geometry
            geometry.setAttribute('instanceOpacity',
                new THREE.InstancedBufferAttribute(oldOpacityArray, 1)
            );
            geometry.setAttribute('heightDiff',
                new THREE.InstancedBufferAttribute(oldHeightDiffArray, 1)
            );

            // Update brightness and color tone
            if (existingMesh.material.uniforms.brightness) {
                existingMesh.material.uniforms.brightness.value = config.brightness;
            }
            if (existingMesh.material.uniforms.colorTone) {
                existingMesh.material.uniforms.colorTone.value.set(
                    config.colorR,
                    config.colorG,
                    config.colorB
                );
            }
            return;
        }

        // Create new mesh
        const mesh = new THREE.InstancedMesh(geometry, material, this.maxInstancesPerType);

        // Set render order (after water to prevent water rendering on top of billboards)
        mesh.renderOrder = 400;  // Water is 300, so billboards render on top
        mesh.frustumCulled = false; // We handle culling manually
        mesh.count = 0; // Start with 0 visible instances

        // Initialize opacity and heightDiff attributes
        const opacityArray = new Float32Array(this.maxInstancesPerType);
        geometry.setAttribute('instanceOpacity',
            new THREE.InstancedBufferAttribute(opacityArray, 1)
        );
        const heightDiffArray = new Float32Array(this.maxInstancesPerType);
        geometry.setAttribute('heightDiff',
            new THREE.InstancedBufferAttribute(heightDiffArray, 1)
        );

        // Initialize matrices to identity but scaled to 0 (hidden)
        const matrix = new THREE.Matrix4();
        for (let i = 0; i < this.maxInstancesPerType; i++) {
            matrix.makeScale(0, 0, 0);
            mesh.setMatrixAt(i, matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;

        this.billboardMeshes.set(treeType, mesh);
        this.scene.add(mesh);

        // Track available indices for this type if not already tracked
        if (!this.availableIndices.has(treeType)) {
            const indices = new Set();
            for (let i = 0; i < this.maxInstancesPerType; i++) {
                indices.add(i);
            }
            this.availableIndices.set(treeType, indices);
        }
    }

    /**
     * Add a billboard for a tree object
     */
    addTreeBillboard(treeObject, treeType, position) {
        // Skip if billboards are disabled (for performance testing)
        if (!this.enabled) {
            return -1;
        }

        // Skip if not a supported tree type (e.g., apple)
        if (!this.treeTypes.includes(treeType)) {
            return -1;
        }

        const mesh = this.billboardMeshes.get(treeType);
        const availableSet = this.availableIndices.get(treeType);

        if (availableSet.size === 0) {
            const usedCount = this.maxInstancesPerType;
            console.warn(`No available billboard slots for ${treeType} (${usedCount}/${this.maxInstancesPerType} used)`);
            return -1;
        }

        // Get an available index
        const index = availableSet.values().next().value;
        availableSet.delete(index);

        // Calculate chunk key for spatial partitioning
        const { chunkX, chunkZ } = ChunkCoordinates.worldToChunk(position.x, position.z);
        const chunkKey = `${chunkX},${chunkZ}`;

        // Store the mapping
        this.instanceData.set(treeObject, {
            type: treeType,
            index: index,
            position: position.clone(),
            chunkKey: chunkKey
        });

        // Add to chunk tracking
        if (!this.treesByChunk.has(chunkKey)) {
            this.treesByChunk.set(chunkKey, new Set());
        }
        this.treesByChunk.get(chunkKey).add(treeObject);

        // Set initial position with scale=1, opacity handles visibility (ISSUE-074: reuse matrix)
        this._tempMatrix.makeScale(1, 1, 1);
        this._tempMatrix.setPosition(position.x, position.y, position.z);
        mesh.setMatrixAt(index, this._tempMatrix);

        // Set initial opacity to 1 (visible by default - distant trees stay visible)
        // LOD update will set to 0 for nearby trees that use 3D models/cross billboards
        const opacityArray = mesh.geometry.attributes.instanceOpacity.array;
        opacityArray[index] = 1;

        // Calculate height difference between fine and coarse terrain for LOD blending
        const heightDiffArray = mesh.geometry.attributes.heightDiff.array;
        const coarseY = this.terrainGenerator ? this.sampleCoarseHeight(position.x, position.z) : position.y;
        heightDiffArray[index] = coarseY - position.y;

        // Mark mesh as needing update (ISSUE-074: batch updates)
        this._dirtyMeshes.add(mesh);

        // Update mesh.count to cover this index
        const currentCount = this.activeCountPerType.get(treeType) || 0;
        if (index + 1 > currentCount) {
            this.activeCountPerType.set(treeType, index + 1);
            mesh.count = index + 1;
        }

        return index;
    }

    /**
     * Remove a billboard when tree is destroyed
     */
    removeTreeBillboard(treeObject) {
        const data = this.instanceData.get(treeObject);
        if (!data) return;

        const { type, index, chunkKey } = data;
        const mesh = this.billboardMeshes.get(type);

        // Hide the billboard by setting scale to 0 (ISSUE-074: reuse matrix)
        this._tempMatrix.makeScale(0, 0, 0);
        mesh.setMatrixAt(index, this._tempMatrix);

        // Mark mesh as needing update (ISSUE-074: batch updates)
        this._dirtyMeshes.add(mesh);

        // Remove from chunk tracking
        const chunkTrees = this.treesByChunk.get(chunkKey);
        if (chunkTrees) {
            chunkTrees.delete(treeObject);
            if (chunkTrees.size === 0) {
                this.treesByChunk.delete(chunkKey);
            }
        }

        // Return index to available pool
        this.availableIndices.get(type).add(index);
        this.instanceData.delete(treeObject);
    }

    /**
     * Flush pending GPU buffer updates (ISSUE-074)
     * Call this after batch operations to minimize GPU uploads
     */
    flushUpdates() {
        for (const mesh of this._dirtyMeshes) {
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.geometry.attributes.instanceOpacity) {
                mesh.geometry.attributes.instanceOpacity.needsUpdate = true;
            }
            if (mesh.geometry.attributes.heightDiff) {
                mesh.geometry.attributes.heightDiff.needsUpdate = true;
            }
        }
        this._dirtyMeshes.clear();
    }

    /**
     * Update billboard opacity and visibility based on camera distance
     * Called every 60 frames from Game.js
     */
    updateBillboards(cameraPosition) {
        if (!this.enabled) return;

        // Flush any pending updates from add/remove operations (ISSUE-074)
        this.flushUpdates();

        const camX = cameraPosition.x;
        const camZ = cameraPosition.z;

        // Get camera chunk and only check nearby chunks (3x3 grid)
        const { chunkX: camChunkX, chunkZ: camChunkZ } = ChunkCoordinates.worldToChunk(camX, camZ);

        // Pre-compute squared distances for LOD thresholds
        // Pine and apple use 3D models, so billboard fades in later (15-25)
        const model15Sq = 15 * 15;
        const model25Sq = 25 * 25;
        // Other trees use cross billboards, so rotating billboard fades in earlier (10-15)
        const other10Sq = 10 * 10;
        const other15Sq = 15 * 15;

        // Skip thresholds - billboards well outside transition zone don't need checks
        const modelSkipNearSq = model15Sq * 0.7;   // Clearly hidden (close to 3D model)
        const modelSkipFarSq = model25Sq * 1.3;    // Clearly visible (far billboard)
        const otherSkipNearSq = other10Sq * 0.7;   // Clearly hidden (close to cross billboard)
        const otherSkipFarSq = other15Sq * 1.3;    // Clearly visible (far billboard)

        // Structure LOD thresholds from config
        // 40-50: billboard fades in, 50-60: 3D model fades out
        const structBillboardStart = CONFIG.LOD?.STRUCTURE_LOD_START || 40;
        const structBillboardEnd = 50;   // Billboard fully visible at 50
        const structModelEnd = CONFIG.LOD?.STRUCTURE_LOD_END || 60;  // Model hidden at 60
        const structBillboardStartSq = structBillboardStart * structBillboardStart;
        const structBillboardEndSq = structBillboardEnd * structBillboardEnd;
        const structSkipNearSq = structBillboardStartSq * 0.7;     // Skip threshold
        const structSkipFarSq = structBillboardEndSq * 1.3;        // Skip threshold

        // Structure type set for LOD profile selection
        const structureTypes = new Set(['tent', 'outpost', 'campfire', 'horse']);

        // Track which meshes need updates (by type)
        const needsUpdate = new Map();
        for (const treeType of this.treeTypes) {
            needsUpdate.set(treeType, false);
        }

        // Only iterate trees in nearby chunks (3x3 grid around camera)
        const chunkKeys = ChunkCoordinates.get3x3ChunkKeys(camChunkX, camChunkZ);
        for (const chunkKey of chunkKeys) {
            const treesInChunk = this.treesByChunk.get(chunkKey);
            if (!treesInChunk) continue;

            for (const treeObject of treesInChunk) {
                const data = this.instanceData.get(treeObject);
                if (!data) continue;

                const { type: treeType, index, position } = data;

                const mesh = this.billboardMeshes.get(treeType);
                if (!mesh) continue;

                const opacityArray = mesh.geometry.attributes.instanceOpacity?.array;
                if (!opacityArray) continue;

                const currentOpacity = opacityArray[index];
                let opacity = 0;

                // Calculate distance FIRST (needed for all LOD checks including skip thresholds)
                const distX = position.x - camX;
                const distZ = position.z - camZ;
                const distSq = distX * distX + distZ * distZ;

                if (this.debugMode) {
                    opacity = 1;
                } else if (treeType === 'vegetables' || treeType === 'deertree' || treeType === 'pine' || treeType === 'apple') {
                    // Trees without 3D model fallback - always visible (no LOD fade-out)
                    opacity = 1;
                } else {
                    // Determine which LOD profile to use
                    const isStructure = structureTypes.has(treeType);
                    const uses3DModel = treeType === 'limestone' || treeType === 'sandstone' || treeType === 'clay' || treeType === 'iron';

                    if (isStructure) {
                        // Structure LOD: 40-50 billboard fades in
                        // Skip stable billboards (hysteresis)
                        if (distSq < structSkipNearSq && currentOpacity === 0) continue;
                        if (distSq > structSkipFarSq && currentOpacity === 1) continue;

                        // Billboard: 0-40 hidden, 40-50 fade in, 50+ full
                        if (distSq < structBillboardStartSq) {
                            opacity = 0;
                        } else if (distSq < structBillboardEndSq) {
                            const distance = Math.sqrt(distSq);
                            opacity = (distance - structBillboardStart) / (structBillboardEnd - structBillboardStart);
                        } else {
                            opacity = 1;
                        }
                    } else if (uses3DModel) {
                        // Rock LOD (existing code)
                        // Skip stable billboards (well outside transition zone)
                        if (distSq < modelSkipNearSq && currentOpacity === 0) continue;
                        if (distSq > modelSkipFarSq && currentOpacity === 1) continue;

                        // These types use 3D models for close range
                        // Billboard: 0-15 hidden, 15-25 fade in, 25+ full
                        if (distSq < model15Sq) {
                            opacity = 0;
                        } else if (distSq < model25Sq) {
                            const distance = Math.sqrt(distSq);
                            opacity = (distance - 15) / 10;
                        } else {
                            opacity = 1;
                        }
                    } else {
                        // Tree LOD (existing code)
                        // Skip stable billboards (well outside transition zone)
                        if (distSq < otherSkipNearSq && currentOpacity === 0) continue;
                        if (distSq > otherSkipFarSq && currentOpacity === 1) continue;

                        // Other trees: 0-10 hidden, 10-15 fade in, 15+ full
                        if (distSq < other10Sq) {
                            opacity = 0;
                        } else if (distSq < other15Sq) {
                            const distance = Math.sqrt(distSq);
                            opacity = (distance - 10) / 5;
                        } else {
                            opacity = 1;
                        }
                    }
                }

                if (Math.abs(currentOpacity - opacity) > 0.02) {
                    opacityArray[index] = opacity;
                    needsUpdate.set(treeType, true);
                }
            }
        }

        // Update GPU buffers only for types that changed
        for (const treeType of this.treeTypes) {
            if (needsUpdate.get(treeType)) {
                const mesh = this.billboardMeshes.get(treeType);
                if (mesh?.geometry.attributes.instanceOpacity) {
                    mesh.geometry.attributes.instanceOpacity.needsUpdate = true;
                }
            }
        }
    }

    /**
     * Update billboard parameters and rebuild geometry/material if needed
     */
    updateBillboardParameters(treeType, param, value) {
        if (!this.billboardConfig[treeType]) return;

        this.billboardConfig[treeType][param] = value;

        // Update geometry if size or offset changed
        if (param === 'width' || param === 'height' || param === 'yOffset') {
            this.createOrUpdateInstancedMesh(treeType);
            // Force re-update of all positions
            this.updateBillboardPositions(treeType);
        }
        // Update brightness uniform
        else if (param === 'brightness') {
            const mesh = this.billboardMeshes.get(treeType);
            if (mesh && mesh.material.uniforms.brightness) {
                mesh.material.uniforms.brightness.value = value;
            }
        }
        // Update color tone uniforms
        else if (param === 'colorR' || param === 'colorG' || param === 'colorB') {
            const mesh = this.billboardMeshes.get(treeType);
            const config = this.billboardConfig[treeType];
            if (mesh && mesh.material.uniforms.colorTone) {
                mesh.material.uniforms.colorTone.value.set(
                    config.colorR,
                    config.colorG,
                    config.colorB
                );
            }
        }
    }

    /**
     * Update billboard positions after geometry change
     */
    updateBillboardPositions(treeType) {
        const mesh = this.billboardMeshes.get(treeType);
        if (!mesh) return;

        for (const [treeObject, data] of this.instanceData) {
            if (data.type !== treeType) continue;

            const { index, position } = data;
            const matrix = new THREE.Matrix4();
            mesh.getMatrixAt(index, matrix);

            // Preserve scale but update position (in case yOffset changed)
            const scale = matrix.elements[0];
            matrix.makeScale(scale, scale, scale);
            matrix.setPosition(position.x, position.y, position.z);
            mesh.setMatrixAt(index, matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
    }

    /**
     * Get billboard instance data for debugging
     */
    getDebugInfo() {
        const info = {};
        let totalUsed = 0;
        for (const treeType of this.treeTypes) {
            const availableSet = this.availableIndices.get(treeType);
            const used = availableSet ? this.maxInstancesPerType - availableSet.size : 0;
            totalUsed += used;
            info[treeType] = {
                used: used,
                available: availableSet ? availableSet.size : 0,
                total: this.maxInstancesPerType,
                percentage: Math.round((used / this.maxInstancesPerType) * 100)
            };
        }
        info.total = {
            used: totalUsed,
            capacity: this.maxInstancesPerType * this.treeTypes.length,
            percentage: Math.round((totalUsed / (this.maxInstancesPerType * this.treeTypes.length)) * 100)
        };
        return info;
    }

    /**
     * Log billboard usage to console
     */
    logUsage() {
        const info = this.getDebugInfo();
        console.log('Billboard Usage:');
        for (const treeType of this.treeTypes) {
            const data = info[treeType];
            console.log(`  ${treeType}: ${data.used}/${data.total} (${data.percentage}%)`);
        }
        console.log(`  Total: ${info.total.used}/${info.total.capacity} (${info.total.percentage}%)`);
    }
}
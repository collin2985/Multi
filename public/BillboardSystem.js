import * as THREE from 'three';

/**
 * BillboardSystem - Manages instanced tree billboards with per-instance opacity
 * Uses custom shader for efficient LOD rendering
 */
export class BillboardSystem {
    constructor(scene) {
        this.scene = scene;
        this.billboardMeshes = new Map(); // tree type -> InstancedMesh
        this.instanceData = new Map(); // tree object -> {type, index, position}
        this.availableIndices = new Map(); // tree type -> Set of available indices
        this.maxInstancesPerType = 10000;  // Increased to match tree instances (10k per type)

        // TEST FLAG: Set to false to disable billboard spawning for performance testing
        this.enabled = true;

        // Tree types with available billboard textures
        this.treeTypes = ['oak', 'fir', 'pine', 'cypress', 'apple'];

        // Billboard configuration per tree type (adjustable via GUI)
        this.billboardConfig = {
            oak: { width: 8, height: 12, yOffset: 0, brightness: 1.0, colorR: 1.0, colorG: 1.0, colorB: 1.0 },
            fir: { width: 3.5, height: 4, yOffset: -0.5, brightness: 0.2, colorR: 1.0, colorG: 1.0, colorB: 1.0 },
            pine: { width: 4, height: 3.5, yOffset: -0.5, brightness: 1.0, colorR: 1.0, colorG: 1.0, colorB: 1.0 },
            cypress: { width: 5, height: 2.5, yOffset: 0, brightness: 1.0, colorR: 1.0, colorG: 1.0, colorB: 1.0 },
            apple: { width: 2, height: 2, yOffset: -0.5, brightness: 1.0, colorR: 1.0, colorG: 1.0, colorB: 1.0 }
        };

        // Debug mode - shows all billboards at full opacity
        this.debugMode = true; // Show all billboards (no fading since we have no 3D models)

        this.initializeShaderMaterials();
        this.initializeInstancedMeshes();
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
            varying float vOpacity;
            varying vec2 vUv;
            varying float vFogDepth;

            void main() {
                vOpacity = instanceOpacity;
                vUv = uv;

                // Get the instance position from the instance matrix
                vec3 instancePos = vec3(instanceMatrix[3].x, instanceMatrix[3].y, instanceMatrix[3].z);

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

                // Calculate fog depth for fragment shader
                vFogDepth = -mvPosition.z;
            }
        `;

        const fragmentShader = `
            uniform sampler2D map;
            uniform float brightness;
            uniform vec3 colorTone;
            uniform vec3 fogColor;
            uniform float fogDensity;
            varying float vOpacity;
            varying vec2 vUv;
            varying float vFogDepth;

            void main() {
                vec4 texColor = texture2D(map, vUv);

                // Discard fully transparent pixels for better performance
                if (texColor.a * vOpacity < 0.01) {
                    discard;
                }

                // Apply color tone and brightness adjustment
                vec3 adjustedColor = texColor.rgb * colorTone * brightness;

                // Calculate exponential squared fog
                float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
                fogFactor = clamp(fogFactor, 0.0, 1.0);

                // Mix billboard color with fog
                vec3 finalColor = mix(adjustedColor, fogColor, fogFactor);

                gl_FragColor = vec4(finalColor, texColor.a * vOpacity);
            }
        `;

        const config = this.billboardConfig[treeType];

        // Get fog settings from the scene (if available)
        const fogColor = this.scene.fog ? this.scene.fog.color : new THREE.Color(0xcccccc);
        const fogDensity = this.scene.fog ? this.scene.fog.density || 0.02 : 0.02;

        return new THREE.ShaderMaterial({
            uniforms: {
                map: { value: texture },
                brightness: { value: config.brightness },
                colorTone: { value: new THREE.Vector3(config.colorR, config.colorG, config.colorB) },
                fogColor: { value: fogColor },
                fogDensity: { value: fogDensity }
            },
            vertexShader,
            fragmentShader,
            transparent: true,
            depthWrite: false, // Don't write to depth buffer (allows seeing tree through billboard)
            depthTest: true,   // Still test depth (won't render behind terrain)
            side: THREE.DoubleSide,
            alphaTest: 0.01    // Discard very transparent pixels
        });
    }

    /**
     * Initialize shader materials for each tree type
     */
    initializeShaderMaterials() {
        this.materials = new Map();

        for (const treeType of this.treeTypes) {
            const texturePath = `./models/${treeType}.png`;
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
            // Save the old opacity array
            const oldOpacityAttribute = existingMesh.geometry.attributes.instanceOpacity;
            const oldOpacityArray = oldOpacityAttribute ? oldOpacityAttribute.array : new Float32Array(this.maxInstancesPerType);

            // Update existing mesh geometry
            existingMesh.geometry.dispose();
            existingMesh.geometry = geometry;

            // Re-add the opacity attribute to the new geometry
            geometry.setAttribute('instanceOpacity',
                new THREE.InstancedBufferAttribute(oldOpacityArray, 1)
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
        mesh.renderOrder = 300;  // Water is 200, so billboards render on top
        mesh.frustumCulled = false; // We handle culling manually

        // Initialize opacity attributes
        const opacityArray = new Float32Array(this.maxInstancesPerType);
        geometry.setAttribute('instanceOpacity',
            new THREE.InstancedBufferAttribute(opacityArray, 1)
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

        // Store the mapping
        this.instanceData.set(treeObject, {
            type: treeType,
            index: index,
            position: position.clone()
        });

        // Set initial position (but keep scale at 0 initially)
        const matrix = new THREE.Matrix4();
        matrix.makeScale(0, 0, 0);
        matrix.setPosition(position.x, position.y, position.z);
        mesh.setMatrixAt(index, matrix);
        mesh.instanceMatrix.needsUpdate = true;

        return index;
    }

    /**
     * Remove a billboard when tree is destroyed
     */
    removeTreeBillboard(treeObject) {
        const data = this.instanceData.get(treeObject);
        if (!data) return;

        const { type, index } = data;
        const mesh = this.billboardMeshes.get(type);

        // Hide the billboard by setting scale to 0
        const matrix = new THREE.Matrix4();
        matrix.makeScale(0, 0, 0);
        mesh.setMatrixAt(index, matrix);
        mesh.instanceMatrix.needsUpdate = true;

        // Return index to available pool
        this.availableIndices.get(type).add(index);
        this.instanceData.delete(treeObject);
    }

    /**
     * Update billboard opacity and visibility based on camera distance
     * Called every 10 frames from Game.js
     * Note: We process ALL billboards in loaded chunks, not just nearby ones
     */
    updateBillboards(cameraPosition) {
        // Skip if billboards are disabled
        if (!this.enabled) {
            return;
        }

        // Process each tree type
        for (const treeType of this.treeTypes) {
            const mesh = this.billboardMeshes.get(treeType);
            if (!mesh) continue;

            const opacityAttribute = mesh.geometry.attributes.instanceOpacity;
            if (!opacityAttribute) {
                console.warn(`Missing instanceOpacity attribute for ${treeType} billboards`);
                continue;
            }
            const opacityArray = opacityAttribute.array;
            let needsOpacityUpdate = false;
            let needsMatrixUpdate = false;

            // Update each billboard instance (across all loaded chunks 5x5)
            for (const [treeObject, data] of this.instanceData) {
                if (data.type !== treeType) continue;

                const { index, position } = data;
                const dx = position.x - cameraPosition.x;
                const dz = position.z - cameraPosition.z;
                const distanceSquared = dx * dx + dz * dz;
                const distance = Math.sqrt(distanceSquared);

                let opacity = 0;
                let scale = 1;

                if (this.debugMode) {
                    // Debug mode - show all billboards at full opacity
                    opacity = 1;
                    scale = 1;
                } else {
                    // Normal distance-based LOD
                    if (distance < 10) {
                        // Close to camera - hide billboard
                        opacity = 0;
                        scale = 0;
                    } else if (distance < 15) {
                        // Transition zone - fade in billboard
                        opacity = (distance - 10) / 5; // 0 at 10 units, 1 at 15 units
                        scale = 1;
                    } else {
                        // Far from camera - full billboard
                        opacity = 1;
                        scale = 1;
                    }
                }

                // Update opacity if changed
                if (Math.abs(opacityArray[index] - opacity) > 0.01) {
                    opacityArray[index] = opacity;
                    needsOpacityUpdate = true;
                }

                // Update scale/visibility if needed
                const matrix = new THREE.Matrix4();
                mesh.getMatrixAt(index, matrix);
                const currentScale = matrix.elements[0]; // Get X scale

                if (Math.abs(currentScale - scale) > 0.01) {
                    matrix.makeScale(scale, scale, scale);
                    matrix.setPosition(position.x, position.y, position.z);
                    mesh.setMatrixAt(index, matrix);
                    needsMatrixUpdate = true;
                }
            }

            // Update GPU buffers if needed
            if (needsOpacityUpdate) {
                opacityAttribute.needsUpdate = true;
            }
            if (needsMatrixUpdate) {
                mesh.instanceMatrix.needsUpdate = true;
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
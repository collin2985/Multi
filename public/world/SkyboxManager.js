/**
 * SkyboxManager.js
 * Manages skybox rendering for the game world
 * Supports cube map and gradient skyboxes
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class SkyboxManager {
    constructor(scene, renderer) {
        this.scene = scene;
        this.renderer = renderer;
        this.skybox = null;
        this.skyboxType = null;
        this.isEnabled = true;
    }

    /**
     * Create a cube map skybox from 6 texture images
     * @param {Object} texturePaths - Paths to 6 skybox faces
     * @param {string} texturePaths.px - Positive X (right)
     * @param {string} texturePaths.nx - Negative X (left)
     * @param {string} texturePaths.py - Positive Y (top)
     * @param {string} texturePaths.ny - Negative Y (bottom)
     * @param {string} texturePaths.pz - Positive Z (front)
     * @param {string} texturePaths.nz - Negative Z (back)
     * @returns {Promise<THREE.CubeTexture>}
     */
    async loadCubeMapSkybox(texturePaths) {
        return new Promise((resolve, reject) => {
            const loader = new THREE.CubeTextureLoader();
            const paths = [
                texturePaths.px,
                texturePaths.nx,
                texturePaths.py,
                texturePaths.ny,
                texturePaths.pz,
                texturePaths.nz
            ];

            const texture = loader.load(
                paths,
                (loadedTexture) => {
                    this.dispose(); // Clean up existing skybox
                    this.scene.background = loadedTexture;
                    this.skybox = loadedTexture;
                    this.skyboxType = 'cubemap';
                    resolve(loadedTexture);
                },
                undefined,
                (error) => {
                    console.error('Error loading cube map skybox:', error);
                    reject(error);
                }
            );
        });
    }

    /**
     * Create a sphere skybox from a single equirectangular image
     * @param {string} texturePath - Path to equirectangular texture
     * @param {number} radius - Sphere radius (default: 5000)
     * @returns {Promise<THREE.Mesh>}
     */
    async loadSphereSkybox(texturePath, radius = 5000) {
        return new Promise((resolve, reject) => {
            const loader = new THREE.TextureLoader();

            loader.load(
                texturePath,
                (texture) => {
                    this.dispose(); // Clean up existing skybox

                    // Set texture wrapping and filtering
                    texture.wrapS = THREE.RepeatWrapping;
                    texture.wrapT = THREE.ClampToEdgeWrapping;
                    texture.minFilter = THREE.LinearFilter;
                    texture.magFilter = THREE.LinearFilter;

                    // Use 2:1 ratio for width:height segments to match equirectangular format
                    const geometry = new THREE.SphereGeometry(radius, 64, 32);
                    // Flip the geometry inside out so we see the texture from inside
                    geometry.scale(-1, 1, 1);

                    const material = new THREE.MeshBasicMaterial({
                        map: texture,
                        side: THREE.FrontSide,  // Use FrontSide since we flipped the geometry
                        fog: false
                    });

                    const mesh = new THREE.Mesh(geometry, material);
                    mesh.name = 'skybox';
                    // Rotate to fix orientation (adjust as needed)
                    mesh.rotation.y = Math.PI / 2;  // 90 degrees
                    this.scene.add(mesh);

                    this.skybox = mesh;
                    this.skyboxType = 'sphere';
                    resolve(mesh);
                },
                undefined,
                (error) => {
                    console.error('Error loading sphere skybox:', error);
                    reject(error);
                }
            );
        });
    }

    /**
     * Create a cylindrical skybox from a panoramic image
     * Perfect for wide panoramic images that don't cover the full sphere
     * @param {string} texturePath - Path to panoramic texture
     * @param {number} radiusX - Cylinder X-axis radius (default: 5000)
     * @param {number} radiusZ - Cylinder Z-axis radius (default: 5000)
     * @param {number} height - Cylinder height (default: 2000)
     * @param {number} scrollSpeed - Cloud scrolling speed (default: 0.01)
     * @returns {Promise<THREE.Mesh>}
     */
    async loadCylindricalSkybox(texturePath, radiusX = 5000, radiusZ = 5000, height = 2000, scrollSpeed = 0.01) {
        return new Promise((resolve, reject) => {
            const loader = new THREE.TextureLoader();

            loader.load(
                texturePath,
                (texture) => {
                    this.dispose(); // Clean up existing skybox

                    // Set texture wrapping - repeat horizontally for seamless wrapping
                    texture.wrapS = THREE.RepeatWrapping;
                    texture.wrapT = THREE.ClampToEdgeWrapping;
                    texture.minFilter = THREE.LinearFilter;
                    texture.magFilter = THREE.LinearFilter;

                    // Create cylinder geometry with base radius (use average for circular base)
                    const baseRadius = (radiusX + radiusZ) / 2;
                    const geometry = new THREE.CylinderGeometry(baseRadius, baseRadius, height, 64, 1, true);

                    // Scale to create oval shape, and flip geometry to face inward
                    const scaleX = radiusX / baseRadius;
                    const scaleZ = radiusZ / baseRadius;
                    geometry.scale(-scaleX, 1, scaleZ);

                    // Custom shader material with height-based fog and scrolling clouds
                    const vertexShader = `
                        varying vec2 vUv;
                        varying vec3 vWorldPosition;

                        void main() {
                            vUv = uv;
                            vec4 worldPos = modelMatrix * vec4(position, 1.0);
                            vWorldPosition = worldPos.xyz;
                            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                        }
                    `;

                    const fragmentShader = `
                        uniform sampler2D map;
                        uniform vec3 fogColor;
                        uniform float fogHeightMin;
                        uniform float fogHeightMax;
                        uniform float time;
                        uniform float scrollSpeed;

                        varying vec2 vUv;
                        varying vec3 vWorldPosition;

                        void main() {
                            // Scroll UV horizontally based on time
                            vec2 scrolledUv = vUv;
                            scrolledUv.x += time * scrollSpeed;

                            // Create a smooth blend between two offset samples to hide seams
                            // This creates a crossfade as the texture wraps
                            float uvFrac = fract(scrolledUv.x);
                            float blendFactor = smoothstep(0.85, 1.0, uvFrac) + smoothstep(0.15, 0.0, uvFrac);
                            blendFactor = clamp(blendFactor, 0.0, 1.0);

                            // Sample texture at current position
                            vec4 texColor1 = texture2D(map, scrolledUv);

                            // Sample texture at offset position for blending
                            vec2 offsetUv = scrolledUv;
                            offsetUv.x += 0.5; // Offset by half to get opposite side
                            vec4 texColor2 = texture2D(map, offsetUv);

                            // Blend the two samples to create seamless transition
                            vec4 texColor = mix(texColor1, texColor2, blendFactor * 0.3);

                            // Height-based fog: max fog at fogHeightMin, no fog at fogHeightMax
                            float heightFactor = clamp((vWorldPosition.y - fogHeightMin) / (fogHeightMax - fogHeightMin), 0.0, 1.0);
                            float fogFactor = 1.0 - heightFactor; // Invert: low Y = more fog
                            fogFactor = clamp(fogFactor, 0.0, 1.0);

                            // Blend skybox with fog color
                            vec3 finalColor = mix(texColor.rgb, fogColor, fogFactor);

                            gl_FragColor = vec4(finalColor, texColor.a);
                        }
                    `;

                    const material = new THREE.ShaderMaterial({
                        uniforms: {
                            map: { value: texture },
                            fogColor: { value: new THREE.Color(CONFIG.RENDERING.FOG_COLOR) },
                            fogHeightMin: { value: CONFIG.RENDERING.SKYBOX_FOG_HEIGHT_MIN || 0 },
                            fogHeightMax: { value: CONFIG.RENDERING.SKYBOX_FOG_HEIGHT_MAX || 100 },
                            time: { value: 0.0 },
                            scrollSpeed: { value: scrollSpeed }
                        },
                        vertexShader: vertexShader,
                        fragmentShader: fragmentShader,
                        side: THREE.FrontSide,
                        transparent: false,
                        depthWrite: true,  // Enable depth writing so skybox occludes distant objects
                        depthTest: true     // Ensure depth testing is enabled
                    });

                    const mesh = new THREE.Mesh(geometry, material);
                    mesh.name = 'skybox';
                    mesh.rotation.y = Math.PI / 2;  // Align texture properly

                    // Note: Geometry is already flipped inside out via geometry.scale(-scaleX, 1, scaleZ)
                    // No additional mesh scaling needed

                    this.scene.add(mesh);

                    // Compute bounding box to verify actual size
                    geometry.computeBoundingBox();

                    this.skybox = mesh;
                    this.skyboxType = 'cylinder';
                    resolve(mesh);
                },
                undefined,
                (error) => {
                    console.error('Error loading cylindrical skybox:', error);
                    reject(error);
                }
            );
        });
    }

    /**
     * Create a simple gradient skybox using scene background color
     * @param {Object} colors
     * @param {number} colors.top - Top color (hex)
     * @param {number} colors.bottom - Bottom color (hex)
     */
    createGradientSkybox(colors = { top: 0x87CEEB, bottom: 0xFFFFFF }) {
        this.dispose(); // Clean up existing skybox

        // Create gradient using a large sphere
        const geometry = new THREE.SphereGeometry(5000, 32, 15);
        geometry.scale(-1, 1, 1); // Flip inside out

        // Create gradient material
        const vertexShader = `
            varying vec3 vWorldPosition;
            void main() {
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;

        const fragmentShader = `
            uniform vec3 topColor;
            uniform vec3 bottomColor;
            uniform float offset;
            uniform float exponent;
            varying vec3 vWorldPosition;
            void main() {
                float h = normalize(vWorldPosition + offset).y;
                gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
            }
        `;

        const uniforms = {
            topColor: { value: new THREE.Color(colors.top) },
            bottomColor: { value: new THREE.Color(colors.bottom) },
            offset: { value: 0 },
            exponent: { value: 0.6 }
        };

        const material = new THREE.ShaderMaterial({
            uniforms: uniforms,
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            side: THREE.BackSide,
            fog: false
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'skybox';
        this.scene.add(mesh);

        this.skybox = mesh;
        this.skyboxType = 'gradient';
    }

    /**
     * Create a simple solid color skybox
     * @param {number} color - Hex color value
     */
    createSolidColorSkybox(color = 0x87CEEB) {
        this.dispose();
        this.scene.background = new THREE.Color(color);
        this.skybox = color;
        this.skyboxType = 'solid';
    }

    /**
     * Update skybox position to follow camera (for sphere/gradient skyboxes)
     * Also updates time uniform for animated shaders
     * @param {THREE.Camera} camera
     * @param {number} deltaTime - Time elapsed since last frame in seconds
     * @param {number} yOffset - Optional vertical offset for the skybox
     */
    update(camera, deltaTime = 0.016, yOffset = 0) {
        if (this.skybox && this.skybox.isMesh && this.isEnabled) {
            // Keep skybox centered on camera horizontally
            this.skybox.position.x = camera.position.x;
            this.skybox.position.z = camera.position.z;

            // Invert vertical movement to stabilize horizon on screen
            // When camera goes UP (zoom out), skybox goes DOWN to compensate
            const inversionFactor = 0.8;
            this.skybox.position.y = yOffset - (camera.position.y * inversionFactor);

            // Update time uniform for animated shaders (cylindrical skybox with scrolling clouds)
            if (this.skyboxType === 'cylinder' && this.skybox.material && this.skybox.material.uniforms && this.skybox.material.uniforms.time) {
                this.skybox.material.uniforms.time.value += deltaTime;
            }
        }
    }

    /**
     * Enable or disable skybox rendering
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this.isEnabled = enabled;

        if (this.skybox) {
            if (this.skybox.isMesh) {
                this.skybox.visible = enabled;
            } else if (this.skyboxType === 'cubemap') {
                this.scene.background = enabled ? this.skybox : null;
            } else if (this.skyboxType === 'solid') {
                this.scene.background = enabled ? new THREE.Color(this.skybox) : null;
            }
        }
    }

    /**
     * Change skybox at runtime
     * @param {string} type - 'cubemap', 'sphere', 'cylinder', 'gradient', 'solid'
     * @param {*} config - Configuration for the skybox type
     * @returns {Promise<void>}
     */
    async changeSkybox(type, config) {
        switch (type) {
            case 'cubemap':
                await this.loadCubeMapSkybox(config);
                break;
            case 'sphere':
                await this.loadSphereSkybox(config.path, config.radius);
                break;
            case 'cylinder':
                await this.loadCylindricalSkybox(config.path, config.radiusX || config.radius, config.radiusZ || config.radius, config.height);
                break;
            case 'gradient':
                this.createGradientSkybox(config);
                break;
            case 'solid':
                this.createSolidColorSkybox(config);
                break;
            default:
                console.warn(`Unknown skybox type: ${type}`);
        }
    }

    /**
     * Dispose of current skybox and free resources
     */
    dispose() {
        if (this.skybox) {
            if (this.skybox.isMesh) {
                // Dispose sphere/gradient skybox
                if (this.skybox.geometry) this.skybox.geometry.dispose();
                if (this.skybox.material) {
                    if (this.skybox.material.map) this.skybox.material.map.dispose();
                    this.skybox.material.dispose();
                }
                this.scene.remove(this.skybox);
            } else if (this.skybox.isCubeTexture) {
                // Dispose cube map
                this.skybox.dispose();
                this.scene.background = null;
            } else {
                // Solid color
                this.scene.background = null;
            }

            this.skybox = null;
            this.skyboxType = null;
        }
    }

    /**
     * Get current skybox type
     * @returns {string|null}
     */
    getType() {
        return this.skyboxType;
    }

    /**
     * Check if skybox is loaded
     * @returns {boolean}
     */
    isLoaded() {
        return this.skybox !== null;
    }
}

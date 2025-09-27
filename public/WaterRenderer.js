// WaterRenderer.js
import * as THREE from 'three';

// --- Simplified Water Vertex Shader ---
const waterVertexShader = `
    uniform float u_time;
    uniform float u_wave_height;
    uniform float u_wave_frequency;
    uniform vec2 u_chunk_offset;
    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    varying float vWaveHeight;
    varying float vWaveSlope;

    float wave(vec2 pos, float freq, float speed) {
        return sin(pos.x * freq + u_time * speed) * cos(pos.y * freq * 0.7 + u_time * speed * 0.8);
    }

    float waveDerivativeX(vec2 pos, float freq, float speed) {
        return freq * cos(pos.x * freq + u_time * speed) * cos(pos.y * freq * 0.7 + u_time * speed * 0.8);
    }

    float waveDerivativeZ(vec2 pos, float freq, float speed) {
        return -freq * 0.7 * sin(pos.x * freq + u_time * speed) * sin(pos.y * freq * 0.7 + u_time * speed * 0.8);
    }

    void main() {
        vUv = uv;
        vec3 pos = position;
        
        // Apply chunk offset for wave calculations
        vec2 worldPos = pos.xz + u_chunk_offset;
        
        // Calculate wave displacement
        float waveDisplacement = 0.0;
        waveDisplacement += wave(worldPos, u_wave_frequency, 0.5) * 0.5;
        waveDisplacement += wave(worldPos * 1.8, u_wave_frequency * 1.7, 0.7) * 0.3;
        waveDisplacement += wave(worldPos * 2.3, u_wave_frequency * 0.9, 0.6) * 0.2;
        
        pos.y += waveDisplacement * u_wave_height;
        vWaveHeight = waveDisplacement;
        
        // Calculate wave slopes for foam effects
        float slopeX = 0.0;
        float slopeZ = 0.0;
        slopeX += waveDerivativeX(worldPos, u_wave_frequency, 1.5) * 0.5 * u_wave_height;
        slopeX += waveDerivativeX(worldPos * 1.8, u_wave_frequency * 1.7, 2.1) * 0.3 * u_wave_height;
        slopeZ += waveDerivativeZ(worldPos, u_wave_frequency, 1.5) * 0.5 * u_wave_height;
        slopeZ += waveDerivativeZ(worldPos * 1.8, u_wave_frequency * 1.7, 2.1) * 0.3 * u_wave_height;
        vWaveSlope = length(vec2(slopeX, slopeZ));
        
        // Transform to world space
        vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
        vWorldPosition = worldPosition.xyz;
        vViewPosition = cameraPosition - worldPosition.xyz;
        
        // Calculate normal from wave slopes
        vec3 tangentX = normalize(vec3(1.0, slopeX, 0.0));
        vec3 tangentZ = normalize(vec3(0.0, slopeZ, 1.0));
        vWorldNormal = normalize(cross(tangentX, tangentZ));
        
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
`;

// --- Simplified Water Fragment Shader ---
const waterFragmentShader = `
    precision highp float;
    
    // Water rendering uniforms
    uniform float u_time;
    uniform vec4 u_shallow_color;
    uniform vec4 u_deep_color;
    uniform vec4 u_foam_color;
    uniform sampler2D u_normal_map;
    uniform sampler2D u_sky_reflection;
    uniform sampler2D u_foam_texture;
    uniform sampler2D u_caustics_texture;
    uniform sampler2D u_height_texture;  // NEW: Height texture for this chunk
    uniform float u_normal_scale;
    uniform float u_water_level;
    uniform vec3 u_sun_direction;
    uniform vec3 u_sun_color;
    uniform float u_shininess;
    uniform float u_foam_threshold;
    uniform float u_texture_scale;
    uniform float u_chunk_size;
    uniform vec2 u_chunk_offset;
    
    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    varying float vWaveHeight;
    varying float vWaveSlope;

    float sampleTerrainHeight(vec2 worldPos) {
    // Convert world position to UV coordinates for height texture sampling
    vec2 localPos = worldPos - u_chunk_offset;
    vec2 uv = (localPos / u_chunk_size) + 0.5;
    
    // Clamp to valid texture coordinates
    uv = clamp(uv, 0.001, 0.999);
    
    // Sample height from texture (stored in red channel)
    float heightNormalized = texture2D(u_height_texture, uv).r;
    
    // Convert normalized height back to world height
    // Assuming height range of -10 to 50 (adjust based on your terrain)
float terrainHeight = mix(-10.0, 80.0, heightNormalized);
    
    return terrainHeight;
}

    void main() {
        // Sample terrain height at this fragment's world position
        float terrainHeight = sampleTerrainHeight(vWorldPosition.xz);
        float depth = vWorldPosition.y - terrainHeight;


        
        // Discard fragments below terrain
        if (depth < 0.0) discard;
        
        // Animated texture coordinates for water effects
        vec2 scrolledUvA = vUv * 8.0 * u_texture_scale + vec2(u_time * 0.003, u_time * 0.0024);
        vec2 scrolledUvB = vUv * 12.0 * u_texture_scale + vec2(u_time * -0.0018, u_time * 0.0036);
        vec2 scrolledUvC = vUv * 15.0 * u_texture_scale + vec2(u_time * 0.0012, u_time * -0.0021);
vec2 foamUv = fract(vUv * 25.0 + vec2(u_time * 0.015, u_time * 0.009));
        
        // Sample and blend normal maps for water surface detail
        vec3 normalSampleA = texture2D(u_normal_map, scrolledUvA).rgb;
        vec3 normalSampleB = texture2D(u_normal_map, scrolledUvB).rgb;
        vec3 normalSampleC = texture2D(u_normal_map, scrolledUvC).rgb;
        
        vec3 normalA = normalize(normalSampleA * 2.0 - 1.0);
        vec3 normalB = normalize(normalSampleB * 2.0 - 1.0);
        vec3 normalC = normalize(normalSampleC * 2.0 - 1.0);
        
        vec3 blendedNormal = normalize(normalA + normalB * 0.5 + normalC * 0.3);
        vec3 perturbedNormal = normalize(mix(vWorldNormal, blendedNormal, u_normal_scale * 0.3));
        
        // Depth-based color and transparency
float shallowFactor = clamp(depth / 0.4, 0.0, 1.0);
float transitionFactor = smoothstep(0.0, 0.3, depth);        
        vec3 waterBaseColor = mix(u_shallow_color.rgb, u_deep_color.rgb, transitionFactor);
        
        //transparency
                float alpha;

if (depth <= 0.3) {
    alpha = mix(0.0, 0.3, shallowFactor);   // 0–0.3 zone
} else if (depth <= 0.5) {
    alpha = mix(0.3, 1.0, (depth - 0.3) / (0.5 - 0.3)); // 0.3–5 zone
} else {
    alpha = 1.0;  // Deep water fully opaque
}

        
        // Fresnel effect for reflections
        vec3 viewDir = normalize(vViewPosition);
        float fresnel = pow(1.0 - max(dot(viewDir, perturbedNormal), 0.0), 1.5);
        
        // Sky reflection
        vec3 reflectedDir = reflect(-viewDir, perturbedNormal);
        vec2 skyUv = reflectedDir.xz * 0.5 + 0.5;
        vec3 skyColor = texture2D(u_sky_reflection, skyUv).rgb;
        
        // Specular highlights
        vec3 halfVector = normalize(u_sun_direction + viewDir);
        float specular = pow(max(dot(perturbedNormal, halfVector), 0.0), u_shininess);
        vec3 specularColor = u_sun_color * specular;
        
        // Foam effects
        vec3 foamTexColor = texture2D(u_foam_texture, foamUv).rgb;
        float shorelineFoam = 1.0 - smoothstep(0.0, 0.3, depth);
        float waveFoam = smoothstep(u_foam_threshold, u_foam_threshold + 0.3, vWaveSlope);
        float foamNoise = sin(vWaveSlope * 10.0 + u_time * 3.0) * 0.5 + 0.5;
        float foam = max(shorelineFoam * 0.8, waveFoam * (foamNoise * 0.5 + 0.5) * 0.6);        // Temporary debug: show individual foam components

        
        // Caustics effects
        vec2 causticsUv1 = vUv * 6.0 + vec2(u_time * 0.002, u_time * 0.0015);
        vec2 causticsUv2 = vUv * 8.5 + vec2(u_time * -0.0012, u_time * 0.0018);
        vec3 caustics1 = texture2D(u_caustics_texture, causticsUv1).rgb;
        vec3 caustics2 = texture2D(u_caustics_texture, causticsUv2).rgb;
        vec3 causticsColor = mix(caustics1, caustics2, 0.5);
        
        float causticsIntensity = (1.0 - depth) * 0.3;
        causticsIntensity *= sin(u_time * 1.5) * 0.3 + 0.7;
        
        // Combine all effects
        vec3 finalColor = waterBaseColor;
        finalColor = mix(finalColor, skyColor, fresnel * 0.4);
        finalColor += specularColor * 0.6;
        finalColor += causticsColor * causticsIntensity * vec3(0.8, 1.0, 0.9);
        finalColor = mix(finalColor, foamTexColor * u_foam_color.rgb, foam * 0.8);
        
        // Adjust alpha for foam
        alpha = mix(alpha, 1.0, foam * 0.5);
        
        gl_FragColor = vec4(finalColor, alpha);
    }
`;

// --- Main WaterRenderer Class ---
export class WaterRenderer {
    constructor(scene = null, waterLevel = 0.9, terrainRenderer = null) {
        this.scene = scene || this.createTestScene();
        this.waterLevel = waterLevel;
        this.terrainRenderer = terrainRenderer;
        this.waterChunks = new Map();
        this.sharedMaterial = null;
        this.uniforms = {};
        this.heightTextures = new Map(); // Store height textures per chunk
        this.gui = null;
        this.init();
    }

    createTestScene() {
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87CEEB);
        
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1, 1, 0.5);
        scene.add(directionalLight);
        
        // Simple test terrain
        const terrainGeometry = new THREE.PlaneGeometry(200, 200);
        const terrainMaterial = new THREE.MeshLambertMaterial({ color: 0x228B22 });
        const terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
        terrainMesh.rotation.x = -Math.PI / 2;
        terrainMesh.position.y = 0;
        scene.add(terrainMesh);
        
        return scene;
    }

    init() {
        this.loadTextures();
        this.createSharedMaterial();
    }

    loadTextures() {
        const textureLoader = new THREE.TextureLoader();
        
        // Load water textures with error handling
        const loadTexture = (path, name) => {
            const texture = textureLoader.load(
                path,
                (texture) => {
                    console.log(`${name} texture loaded successfully`);
                    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
                    texture.minFilter = THREE.LinearFilter;
                    texture.magFilter = THREE.LinearFilter;
                },
                undefined,
                (err) => {
                    console.error(`Failed to load ${name} texture:`, err);
                }
            );
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            return texture;
        };

        this.textures = {
            normalMap: loadTexture('./terrain/water_normal.png', 'water normal'),
            skyReflection: loadTexture('./terrain/sky_reflection.png', 'sky reflection'),
            foamTexture: loadTexture('./terrain/foam.png', 'foam'),
            causticsTexture: loadTexture('./terrain/caustics.png', 'caustics')
        };
    }

    createSharedMaterial() {
        // Create a default height texture for chunks without terrain data
        const defaultHeightTexture = this.createDefaultHeightTexture();
        
        const shallowColor = new THREE.Color(0x85997F);
        const deepColor = new THREE.Color(0x001f5f);
        const foamColor = new THREE.Color(0xffffff);
        
        this.uniforms = {
            // Time and animation
            u_time: { value: 0.0 },
            
            // Wave parameters
            u_wave_height: { value: 0.01 },
            u_wave_frequency: { value: 0.02 },
            
            // Colors
            u_shallow_color: { value: new THREE.Vector4(shallowColor.r, shallowColor.g, shallowColor.b, 1.0) },
            u_deep_color: { value: new THREE.Vector4(deepColor.r, deepColor.g, deepColor.b, 1.0) },
            u_foam_color: { value: new THREE.Vector4(foamColor.r, foamColor.g, foamColor.b, 1.0) },
            
            // Textures
            u_normal_map: { value: this.textures.normalMap },
            u_sky_reflection: { value: this.textures.skyReflection },
            u_foam_texture: { value: this.textures.foamTexture },
            u_caustics_texture: { value: this.textures.causticsTexture },
            u_height_texture: { value: defaultHeightTexture },
            
            // Material properties
            u_normal_scale: { value: 1.5 },
            u_water_level: { value: this.waterLevel },
            u_shininess: { value: 32.0 },
            u_foam_threshold: { value: 0.8 },
            u_texture_scale: { value: 1.0 },
            u_chunk_size: { value: 50.0 },
            u_chunk_offset: { value: new THREE.Vector2(0, 0) },
            
            // Lighting
            u_sun_direction: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
            u_sun_color: { value: new THREE.Color(0xfff8dc) }
        };
        
        this.sharedMaterial = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: waterVertexShader,
            fragmentShader: waterFragmentShader,
            transparent: true,
            fog: false,
            side: THREE.FrontSide
        });
    }

    createDefaultHeightTexture() {
        // Create a simple flat height texture as fallback
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        // Fill with middle gray (represents height of 0)
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, size, size);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        
        return texture;
    }

    generateHeightTexture(chunkX, chunkZ, heightCalculator) {
        const size = 128;
        const chunkSize = 50;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(size, size);
        const data = imgData.data;
        
        // Height range for normalization (adjust based on your terrain)
        const minHeight = -10;
        const maxHeight = 80;
        const heightRange = maxHeight - minHeight;
        
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                // Convert texture coordinates to world coordinates
                const worldX = chunkX - chunkSize/2 + (x / size) * chunkSize;
                const worldZ = chunkZ - chunkSize/2 + (y / size) * chunkSize;
                
                // Sample terrain height
                const height = heightCalculator.calculateHeight(worldX, worldZ);
                
                // Normalize height to 0-1 range
                const normalizedHeight = Math.max(0, Math.min(1, (height - minHeight) / heightRange));
                const heightValue = Math.floor(normalizedHeight * 255);
                
                const index = (y * size + x) * 4;
                data[index] = heightValue;     // Red channel stores height
                data[index + 1] = heightValue; // Green (unused)
                data[index + 2] = heightValue; // Blue (unused)
                data[index + 3] = 255;         // Alpha
            }
        }
        
        ctx.putImageData(imgData, 0, 0);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.flipY = false;
        
        return texture;
    }

    addWaterChunk(chunkX, chunkZ, heightTexture = null) {
        const key = `${chunkX},${chunkZ}`;
        if (this.waterChunks.has(key)) return;
        
        console.log(`Adding water chunk at (${chunkX}, ${chunkZ})`);
        
        // Create water geometry (reduced resolution for better performance)
        const geometry = new THREE.PlaneGeometry(50, 50, 64, 64);
        geometry.rotateX(-Math.PI / 2);
        
        // Clone the shared material for this chunk
        const material = this.sharedMaterial.clone();
        
        // Set height texture for this chunk
        if (heightTexture) {
            material.uniforms.u_height_texture.value = heightTexture;
            this.heightTextures.set(key, heightTexture);
        } else if (this.terrainRenderer && this.terrainRenderer.heightCalculator) {
            // Generate height texture if terrain renderer is available
            const generatedTexture = this.generateHeightTexture(chunkX, chunkZ, this.terrainRenderer.heightCalculator);
            material.uniforms.u_height_texture.value = generatedTexture;
            this.heightTextures.set(key, generatedTexture);
        }
        
        // Set chunk-specific uniforms
        material.uniforms.u_chunk_offset.value.set(chunkX, chunkZ);
        console.log(`Water chunk created at world position (${chunkX}, ${this.waterLevel}, ${chunkZ}), chunk offset uniform set to (${chunkX}, ${chunkZ})`);
        material.uniforms.u_chunk_size.value = 50.0;
        
        // Create mesh
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(chunkX, this.waterLevel, chunkZ);
        
        this.scene.add(mesh);
        this.waterChunks.set(key, mesh);
        
        console.log(`Water chunk added successfully at (${chunkX}, ${chunkZ})`);
    }

    removeWaterChunk(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        const mesh = this.waterChunks.get(key);
        
        if (mesh) {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
            this.waterChunks.delete(key);
            console.log(`Water chunk removed at (${chunkX}, ${chunkZ})`);
        }
    }

    clearWaterChunks() {
        this.waterChunks.forEach((mesh, key) => {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        });
        this.waterChunks.clear();
        
        // Clean up all height textures
        this.heightTextures.forEach((texture) => texture.dispose());
        this.heightTextures.clear();
    }

    update(time) {
        // Update time uniform for all water chunks
        if (this.sharedMaterial) {
            this.sharedMaterial.uniforms.u_time.value = time * 0.001;
        }
        
        // Update individual chunk materials
        this.waterChunks.forEach((mesh) => {
            if (mesh.material.uniforms.u_time) {
                mesh.material.uniforms.u_time.value = time * 0.001;
            }
        });
    }

    getWaterHeightAt(x, z, time) {
        const freq = this.uniforms.u_wave_frequency.value;
        const height = this.uniforms.u_wave_height.value;
        
        let waveHeight = 0;
        waveHeight += Math.sin(x * freq + time * 1.5) * Math.cos(z * freq * 0.7 + time * 1.2) * 0.5;
        waveHeight += Math.sin(x * freq * 1.8 + time * 2.1) * Math.cos(z * freq * 1.19 + time * 1.68) * 0.3;
        waveHeight += Math.sin(x * freq * 2.3 + time * 1.8) * Math.cos(z * freq * 1.61 + time * 1.44) * 0.2;
        
        return this.waterLevel + waveHeight * height;
    }

    getWaterChunks() {
        return Array.from(this.waterChunks.values());
    }

    setupTestControls() {
        if (typeof window === 'undefined' || !window.dat) {
            console.warn('dat.GUI not available for water controls');
            return;
        }

        const gui = new window.dat.GUI();
        this.gui = gui;
        
        const updateUniforms = () => {
            this.waterChunks.forEach((mesh) => {
                Object.keys(this.uniforms).forEach(key => {
                    if (mesh.material.uniforms[key]) {
                        mesh.material.uniforms[key].value = this.uniforms[key].value;
                    }
                });
            });
        };
        
        const waveFolder = gui.addFolder('Waves');
        waveFolder.add(this.uniforms.u_wave_height, 'value', 0.0, 0.1).name('Height').onChange(updateUniforms);
        waveFolder.add(this.uniforms.u_wave_frequency, 'value', 0.02, 0.2).name('Frequency').onChange(updateUniforms);

        const materialFolder = gui.addFolder('Material');
        materialFolder.add(this.uniforms.u_normal_scale, 'value', 0.0, 3.0).name('Normal Scale').onChange(updateUniforms);
        materialFolder.add(this.uniforms.u_shininess, 'value', 1.0, 128.0).name('Shininess').onChange(updateUniforms);
        materialFolder.add(this.uniforms.u_foam_threshold, 'value', 0.0, 2.0).name('Foam Threshold').onChange(updateUniforms);
        materialFolder.add(this.uniforms.u_texture_scale, 'value', 0.5, 3.0).name('Texture Scale').onChange(updateUniforms);

        const colorFolder = gui.addFolder('Colors');
        const colorControls = {
            shallow: '#4dd0e1',
            deep: '#001f5f',
            foam: '#ffffff'
        };
        
        colorFolder.addColor(colorControls, 'shallow').onChange((val) => {
            const color = new THREE.Color(val);
            this.uniforms.u_shallow_color.value.set(color.r, color.g, color.b, 1.0);
            updateUniforms();
        });
        
        colorFolder.addColor(colorControls, 'deep').onChange((val) => {
            const color = new THREE.Color(val);
            this.uniforms.u_deep_color.value.set(color.r, color.g, color.b, 1.0);
            updateUniforms();
        });
        
        colorFolder.addColor(colorControls, 'foam').onChange((val) => {
            const color = new THREE.Color(val);
            this.uniforms.u_foam_color.value.set(color.r, color.g, color.b, 1.0);
            updateUniforms();
        });

        const debugFolder = gui.addFolder('Debug');
        debugFolder.add({ chunkCount: () => this.waterChunks.size }, 'chunkCount').name('Water Chunks').listen();
        debugFolder.add({ textureCount: () => this.heightTextures.size }, 'textureCount').name('Height Textures').listen();
    }

    dispose() {
        this.clearWaterChunks();
        
        if (this.sharedMaterial) {
            this.sharedMaterial.dispose();
        }
        
        // Dispose textures
        Object.values(this.textures).forEach(texture => {
            if (texture.dispose) texture.dispose();
        });
        
        if (this.gui) {
            this.gui.destroy();
        }
        
        console.log('WaterRenderer disposed');
    }
}
// WaterRenderer.js - Enhanced Realistic Version
import * as THREE from 'three';

// --- Enhanced Water Vertex Shader ---
const waterVertexShader = `
    precision mediump float;
    uniform float u_time;
    uniform float u_wave_height;
    uniform float u_wave_frequency;
    uniform vec2 u_chunk_offset;
    
    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying vec3 vTangent;
    varying vec3 vBitangent;
    varying float vWaveHeight;
    varying vec2 vWorldUv;

    // Enhanced wave function with multiple octaves
    float wave(vec2 pos, float freq, float speed, float phase) {
        return sin(pos.x * freq + u_time * speed + phase) * cos(pos.y * freq * 0.7 + u_time * speed * 0.8 + phase);
    }

    // Calculate tangent space for normal mapping
    vec3 calculateTangent(vec3 position, vec2 uv) {
        vec3 dp1 = dFdx(position);
        vec3 dp2 = dFdy(position);
        vec2 duv1 = dFdx(uv);
        vec2 duv2 = dFdy(uv);
        
        vec3 dp2perp = cross(dp2, vNormal);
        vec3 dp1perp = cross(vNormal, dp1);
        vec3 tangent = dp2perp * duv1.x + dp1perp * duv2.x;
        
        return normalize(tangent);
    }

    void main() {
        vUv = uv;
        vec3 pos = position;
        
        // Apply chunk offset for wave calculations
        vec2 worldPos = pos.xz + u_chunk_offset;
        vWorldUv = worldPos * 0.02; // For texture mapping
        
        // Enhanced wave displacement with more complexity
        float waveDisplacement = 0.0;
        waveDisplacement += wave(worldPos, u_wave_frequency, 1.5, 0.0) * 0.4;
        waveDisplacement += wave(worldPos * 1.8, u_wave_frequency * 1.7, 2.1, 1.57) * 0.3;
        waveDisplacement += wave(worldPos * 0.6, u_wave_frequency * 0.8, 0.9, 3.14) * 0.2;
        waveDisplacement += wave(worldPos * 3.2, u_wave_frequency * 2.3, 2.8, 4.71) * 0.1;
        
        pos.y += waveDisplacement * u_wave_height;
        vWaveHeight = waveDisplacement;
        
        // Transform to world space
        vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
        vWorldPosition = worldPosition.xyz;
        vViewPosition = cameraPosition - worldPosition.xyz;
        
        // Calculate normal for lighting (approximate derivative)
        vec3 offset = vec3(0.1, 0.0, 0.1);
        float hL = wave(worldPos - offset.xz, u_wave_frequency, 1.5, 0.0) * 0.4;
        float hR = wave(worldPos + offset.xz, u_wave_frequency, 1.5, 0.0) * 0.4;
        float hD = wave(worldPos - offset.zx, u_wave_frequency, 1.5, 0.0) * 0.4;
        float hU = wave(worldPos + offset.zx, u_wave_frequency, 1.5, 0.0) * 0.4;
        
        vec3 normal = normalize(vec3(hL - hR, 2.0, hD - hU));
        vNormal = normalize(normalMatrix * normal);
        
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
`;

// --- Enhanced Water Fragment Shader ---
const waterFragmentShader = `
    precision mediump float;
    
    uniform float u_time;
    uniform vec4 u_shallow_color;
    uniform vec4 u_deep_color;
    uniform vec4 u_foam_color;
    uniform sampler2D u_height_texture;
    uniform sampler2D u_normal_texture;
    uniform sampler2D u_caustics_texture;
    uniform sampler2D u_sky_reflection_texture;
    uniform float u_water_level;
    uniform float u_chunk_size;
    uniform vec2 u_chunk_offset;
    uniform vec3 u_light_direction;
    uniform vec3 u_camera_position;
    
    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying float vWaveHeight;
    varying vec2 vWorldUv;

    // Fresnel calculation for realistic water reflectance
    float fresnel(vec3 viewDir, vec3 normal, float power) {
        float dot_product = dot(normalize(viewDir), normalize(normal));
        return pow(1.0 - abs(dot_product), power);
    }

    // Sample terrain height
    float sampleTerrainHeight(vec2 worldPos) {
        vec2 localPos = worldPos - u_chunk_offset;
        vec2 uv = (localPos / u_chunk_size) + 0.5;
        uv = clamp(uv, 0.001, 0.999);
        float heightNormalized = texture2D(u_height_texture, uv).r;
        return mix(-10.0, 80.0, heightNormalized);
    }

    // Enhanced normal mapping
    vec3 getNormalFromMap(vec2 uv) {
        // Sample normal map with animated scrolling
        vec2 normalUV1 = uv * 4.0 + vec2(u_time * 0.02, u_time * 0.015);
        vec2 normalUV2 = uv * 7.0 + vec2(-u_time * 0.018, u_time * 0.025);
        
        vec3 normal1 = texture2D(u_normal_texture, normalUV1).rgb * 2.0 - 1.0;
        vec3 normal2 = texture2D(u_normal_texture, normalUV2).rgb * 2.0 - 1.0;
        
        // Blend two normal samples for more complexity
        vec3 blendedNormal = normalize(normal1 * 0.6 + normal2 * 0.4);
        
        // Combine with vertex normal
        return normalize(vNormal + blendedNormal * 0.3);
    }

    // Caustics calculation
    vec3 getCaustics(vec2 worldPos, float depth) {
        if (depth > 2.0) return vec3(0.0); // No caustics in deep water
        
        // Animated caustics with wave distortion
        vec2 causticsUV1 = worldPos * 0.08 + vec2(u_time * 0.03, u_time * 0.02);
        vec2 causticsUV2 = worldPos * 0.12 + vec2(-u_time * 0.025, u_time * 0.035);
        
        // Add wave-based distortion to caustics
        vec2 distortion = vec2(vWaveHeight * 0.1, vWaveHeight * 0.08);
        causticsUV1 += distortion;
        causticsUV2 += distortion * 1.3;
        
        float caustic1 = texture2D(u_caustics_texture, causticsUV1).r;
        float caustic2 = texture2D(u_caustics_texture, causticsUV2).r;
        
        float causticBlend = (caustic1 * 0.7 + caustic2 * 0.3);
        
        // Fade caustics based on depth and intensity
        float depthFade = 1.0 - smoothstep(0.0, 2.0, depth);
        float causticIntensity = causticBlend * depthFade * 0.8;
        
        return vec3(causticIntensity * 0.9, causticIntensity, causticIntensity * 0.7);
    }

    // Sky reflection calculation
    vec3 getSkyReflection(vec3 viewDir, vec3 normal) {
        // Calculate reflection vector
        vec3 reflectionVector = reflect(-viewDir, normal);
        
        // Convert to UV coordinates for sky texture
        float u = atan(reflectionVector.z, reflectionVector.x) / (2.0 * 3.14159) + 0.5;
        float v = asin(reflectionVector.y) / 3.14159 + 0.5;
        
        // Add subtle animation to reflection
        vec2 skyUV = vec2(u, v) + vec2(u_time * 0.002, 0.0);
        
        return texture2D(u_sky_reflection_texture, skyUV).rgb;
    }

    void main() {
        // Sample terrain height and calculate depth
        float terrainHeight = sampleTerrainHeight(vWorldPosition.xz);
        float depth = vWorldPosition.y - terrainHeight;
        
        // Discard fragments below terrain
        if (depth < 0.0) discard;
        
        // Get enhanced normal from normal map
        vec3 surfaceNormal = getNormalFromMap(vWorldUv);
        
        // View direction for calculations
        vec3 viewDir = normalize(vViewPosition);
        
        // Calculate Fresnel for realistic reflectance
        float fresnelFactor = fresnel(viewDir, surfaceNormal, 2.5);
        
        // Base water colors based on depth
        float shallowFactor = clamp(depth / 1.5, 0.0, 1.0);
        vec3 waterBaseColor = mix(u_shallow_color.rgb, u_deep_color.rgb, shallowFactor);
        
        // Get sky reflection
        vec3 skyReflection = getSkyReflection(viewDir, surfaceNormal);
        
        // Get caustics for shallow areas
        vec3 caustics = getCaustics(vWorldPosition.xz, depth);
        
        // Specular highlights
        vec3 lightDir = normalize(u_light_direction);
        vec3 halfVector = normalize(lightDir + viewDir);
        float specular = pow(max(dot(surfaceNormal, halfVector), 0.0), 128.0);
        vec3 specularColor = vec3(1.0) * specular * 0.8;
        
        // Enhanced foam calculation
        float foamFactor = 0.0;
        if (depth < 0.3) {
            float shorelineFoam = (1.0 - depth / 0.3);
            float waveFoam = clamp(abs(vWaveHeight) * 15.0, 0.0, 1.0);
            foamFactor = max(shorelineFoam * 0.6, waveFoam * 0.4);
        }
        
        // Combine all effects
        vec3 finalColor = waterBaseColor;
        
        // Add caustics to base color (affects underwater areas)
        finalColor += caustics;
        
        // Blend with sky reflection based on Fresnel
        finalColor = mix(finalColor, skyReflection * 1.2, fresnelFactor * 0.7);
        
        // Add specular highlights
        finalColor += specularColor;
        
        // Add foam
        finalColor = mix(finalColor, u_foam_color.rgb, foamFactor);
        
        // Enhanced transparency calculation
        float alpha = depth <= 0.05 ? smoothstep(0.0, 0.05, depth) * 0.2 : 
                     depth <= 0.3 ? mix(0.2, 0.85, smoothstep(0.05, 0.3, depth)) :
                     depth <= 2.0 ? mix(0.85, 0.95, smoothstep(0.3, 2.0, depth)) : 0.95;
        
        // Reduce alpha where there's strong reflection
        alpha = mix(alpha, alpha * 0.7, fresnelFactor);
        
        gl_FragColor = vec4(finalColor, alpha);
    }
`;

// --- Main Enhanced WaterRenderer Class ---
export class WaterRenderer {
    constructor(scene = null, waterLevel = 0.9, terrainRenderer = null) {
        this.scene = scene || this.createTestScene();
        this.waterLevel = waterLevel;
        this.terrainRenderer = terrainRenderer;
        this.waterChunks = new Map();
        this.sharedMaterial = null;
        this.uniforms = {};
        this.heightTextures = new Map();
        this.gui = null;
        
        // Texture references
        this.normalTexture = null;
        this.causticsTexture = null;
        this.skyReflectionTexture = null;
        
        // Performance optimization
        this.lastUpdateTime = 0;
        this.updateInterval = 16; // ~60fps cap
        
        this.init();
    }

    createTestScene() {
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87CEEB);
        
        const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
        scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
        directionalLight.position.set(10, 20, 5);
        scene.add(directionalLight);
        
        return scene;
    }

    async init() {
        await this.loadTextures();
        this.createSharedMaterial();
    }

    async loadTextures() {
        const loader = new THREE.TextureLoader();
        
        try {
            console.log('Loading water textures...');
            
            // Load normal map
            this.normalTexture = await this.loadTexture(loader, './terrain/water_normal.png');
            this.setupTextureProperties(this.normalTexture, true);
            
            // Load caustics
            this.causticsTexture = await this.loadTexture(loader, './terrain/caustics.png');
            this.setupTextureProperties(this.causticsTexture, true);
            
            // Load sky reflection
            this.skyReflectionTexture = await this.loadTexture(loader, './terrain/sky_reflection.png');
            this.setupTextureProperties(this.skyReflectionTexture, false);
            
            console.log('All water textures loaded successfully');
        } catch (error) {
            console.warn('Failed to load some water textures, using fallbacks:', error);
            this.createFallbackTextures();
        }
    }

    loadTexture(loader, path) {
        return new Promise((resolve, reject) => {
            loader.load(
                path,
                (texture) => resolve(texture),
                undefined,
                (error) => reject(error)
            );
        });
    }

    setupTextureProperties(texture, repeat) {
        if (repeat) {
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        } else {
            texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
        }
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
    }

    createFallbackTextures() {
        // Create fallback normal map
        if (!this.normalTexture) {
            this.normalTexture = this.createFallbackNormalTexture();
        }
        
        // Create fallback caustics
        if (!this.causticsTexture) {
            this.causticsTexture = this.createFallbackCausticsTexture();
        }
        
        // Create fallback sky reflection
        if (!this.skyReflectionTexture) {
            this.skyReflectionTexture = this.createFallbackSkyTexture();
        }
    }

    createFallbackNormalTexture() {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        // Create a subtle normal map pattern
        const imgData = ctx.createImageData(size, size);
        const data = imgData.data;
        
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const index = (y * size + x) * 4;
                // Create subtle wave pattern
                const wave = Math.sin(x * 0.2) * Math.cos(y * 0.2);
                data[index] = 128 + wave * 20; // R (X normal)
                data[index + 1] = 128 + wave * 15; // G (Y normal)  
                data[index + 2] = 200; // B (Z normal - pointing up)
                data[index + 3] = 255; // A
            }
        }
        
        ctx.putImageData(imgData, 0, 0);
        const texture = new THREE.CanvasTexture(canvas);
        this.setupTextureProperties(texture, true);
        return texture;
    }

    createFallbackCausticsTexture() {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        // Create caustic-like pattern
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, size, size);
        
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        
        // Draw wavy lines
        for (let i = 0; i < 8; i++) {
            ctx.beginPath();
            ctx.moveTo(0, i * 8);
            for (let x = 0; x < size; x += 2) {
                const y = i * 8 + Math.sin(x * 0.2 + i) * 3;
                ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        this.setupTextureProperties(texture, true);
        return texture;
    }

    createFallbackSkyTexture() {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        // Create gradient sky
        const gradient = ctx.createLinearGradient(0, 0, 0, size);
        gradient.addColorStop(0, '#87CEEB');
        gradient.addColorStop(0.7, '#98D8E8');
        gradient.addColorStop(1, '#B0E0E6');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
        
        const texture = new THREE.CanvasTexture(canvas);
        this.setupTextureProperties(texture, false);
        return texture;
    }

    createDefaultHeightTexture() {
        const size = 32;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, size, size);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        
        return texture;
    }

    createSharedMaterial() {
        const defaultHeightTexture = this.createDefaultHeightTexture();
        
        const shallowColor = new THREE.Color(0x85997F);
        const deepColor = new THREE.Color(0x001f5f);
        const foamColor = new THREE.Color(0xffffff);
        
        this.uniforms = {
            // Time and animation
            u_time: { value: 0.0 },
            
            // Wave parameters
            u_wave_height: { value: 0.008 },
            u_wave_frequency: { value: 0.018 },
            
            // Colors
            u_shallow_color: { value: new THREE.Vector4(shallowColor.r, shallowColor.g, shallowColor.b, 1.0) },
            u_deep_color: { value: new THREE.Vector4(deepColor.r, deepColor.g, deepColor.b, 1.0) },
            u_foam_color: { value: new THREE.Vector4(foamColor.r, foamColor.g, foamColor.b, 1.0) },
            
            // Textures
            u_height_texture: { value: defaultHeightTexture },
            u_normal_texture: { value: this.normalTexture },
            u_caustics_texture: { value: this.causticsTexture },
            u_sky_reflection_texture: { value: this.skyReflectionTexture },
            
            // Lighting
            u_light_direction: { value: new THREE.Vector3(10, 20, 5).normalize() },
            u_camera_position: { value: new THREE.Vector3() },
            
            // Material properties
            u_water_level: { value: this.waterLevel },
            u_chunk_size: { value: 50.0 },
            u_chunk_offset: { value: new THREE.Vector2(0, 0) }
        };
        
        this.sharedMaterial = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: waterVertexShader,
            fragmentShader: waterFragmentShader,
            transparent: true,
            fog: false,
            side: THREE.FrontSide,
            depthWrite: false,
            blending: THREE.NormalBlending
        });
    }

    generateHeightTexture(chunkX, chunkZ, heightCalculator) {
        const size = 64;
        const chunkSize = 50;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(size, size);
        const data = imgData.data;
        
        const minHeight = -10;
        const maxHeight = 80;
        const heightRange = maxHeight - minHeight;
        
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const worldX = chunkX - chunkSize/2 + (x / size) * chunkSize;
                const worldZ = chunkZ - chunkSize/2 + (y / size) * chunkSize;
                
                const height = heightCalculator.calculateHeight(worldX, worldZ);
                const normalizedHeight = Math.max(0, Math.min(1, (height - minHeight) / heightRange));
                const heightValue = Math.floor(normalizedHeight * 255);
                
                const index = (y * size + x) * 4;
                data[index] = heightValue;
                data[index + 1] = heightValue;
                data[index + 2] = heightValue;
                data[index + 3] = 255;
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
        
        console.log(`Adding enhanced water chunk at (${chunkX}, ${chunkZ})`);
        
        // Higher quality geometry for better normal mapping
        const geometry = new THREE.PlaneGeometry(50, 50, 48, 48);
        geometry.rotateX(-Math.PI / 2);
        
        // Clone the shared material for each chunk
        const material = this.sharedMaterial.clone();
        
        // Set chunk-specific uniforms
        material.uniforms.u_chunk_offset.value.set(chunkX, chunkZ);
        
        // Set height texture for this chunk
        if (heightTexture) {
            material.uniforms.u_height_texture.value = heightTexture;
            this.heightTextures.set(key, heightTexture);
        } else if (this.terrainRenderer && this.terrainRenderer.heightCalculator) {
            const generatedTexture = this.generateHeightTexture(chunkX, chunkZ, this.terrainRenderer.heightCalculator);
            material.uniforms.u_height_texture.value = generatedTexture;
            this.heightTextures.set(key, generatedTexture);
        }
        
        // Create mesh
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(chunkX, this.waterLevel, chunkZ);
        
        this.scene.add(mesh);
        this.waterChunks.set(key, mesh);
        
        console.log(`Enhanced water chunk added successfully at (${chunkX}, ${chunkZ})`);
    }

    removeWaterChunk(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        const mesh = this.waterChunks.get(key);
        
        if (mesh) {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
            this.waterChunks.delete(key);
            
            const heightTexture = this.heightTextures.get(key);
            if (heightTexture && heightTexture !== this.uniforms.u_height_texture.value) {
                heightTexture.dispose();
                this.heightTextures.delete(key);
            }
            
            console.log(`Enhanced water chunk removed at (${chunkX}, ${chunkZ})`);
        }
    }

    clearWaterChunks() {
        this.waterChunks.forEach((mesh, key) => {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        });
        this.waterChunks.clear();
        
        this.heightTextures.forEach((texture) => {
            if (texture !== this.uniforms.u_height_texture.value) {
                texture.dispose();
            }
        });
        this.heightTextures.clear();
    }

    update(time, camera = null) {
        if (time - this.lastUpdateTime < this.updateInterval) {
            return;
        }
        this.lastUpdateTime = time;
        
        const timeValue = time * 0.001;
        
        // Update camera position for reflections
        if (camera) {
            this.uniforms.u_camera_position.value.copy(camera.position);
        }
        
        // Update time uniform for each water chunk's material
        this.waterChunks.forEach((mesh) => {
            if (mesh.material && mesh.material.uniforms) {
                if (mesh.material.uniforms.u_time) {
                    mesh.material.uniforms.u_time.value = timeValue;
                }
                if (mesh.material.uniforms.u_camera_position && camera) {
                    mesh.material.uniforms.u_camera_position.value.copy(camera.position);
                }
            }
        });
    }

    getWaterHeightAt(x, z, time) {
        const freq = this.uniforms.u_wave_frequency.value;
        const height = this.uniforms.u_wave_height.value;
        
        // Enhanced wave calculation matching vertex shader
        let waveHeight = 0;
        waveHeight += Math.sin(x * freq + time * 1.5) * Math.cos(z * freq * 0.7 + time * 1.2) * 0.4;
        waveHeight += Math.sin(x * freq * 1.8 + time * 2.1) * Math.cos(z * freq * 1.19 + time * 1.68) * 0.3;
        waveHeight += Math.sin(x * freq * 0.6 + time * 0.9) * Math.cos(z * freq * 0.42 + time * 0.72) * 0.2;
        waveHeight += Math.sin(x * freq * 3.2 + time * 2.8) * Math.cos(z * freq * 2.24 + time * 2.24) * 0.1;
        
        return this.waterLevel + waveHeight * height;
    }

    getWaterChunks() {
        return Array.from(this.waterChunks.values());
    }

    dispose() {
        this.clearWaterChunks();
        
        if (this.sharedMaterial) {
            this.sharedMaterial.dispose();
        }
        
        // Dispose textures
        if (this.normalTexture) this.normalTexture.dispose();
        if (this.causticsTexture) this.causticsTexture.dispose();
        if (this.skyReflectionTexture) this.skyReflectionTexture.dispose();
        
        if (this.uniforms.u_height_texture && this.uniforms.u_height_texture.value.dispose) {
            this.uniforms.u_height_texture.value.dispose();
        }
        
        if (this.gui) {
            this.gui.destroy();
        }
        
        console.log('Enhanced WaterRenderer disposed');
    }
}
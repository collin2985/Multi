// WaterRenderer.js - Enhanced Realistic Version with GUI
import * as THREE from 'three';
import * as dat from 'dat.gui'; // Added for GUI

// --- Enhanced Water Vertex Shader ---
const waterVertexShader = `
    precision mediump float;
    uniform float u_time;
    uniform float u_wave_height;
    uniform float u_wave_frequency;
    uniform float u_wave_speed; // Added for GUI
    uniform vec2 u_chunk_offset;
    
    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying float vWaveHeight;
    varying vec2 vWorldUv;

    // Enhanced wave function with multiple octaves
    float wave(vec2 pos, float freq, float speed, float phase) {
        return sin(pos.x * freq + u_time * speed * u_wave_speed + phase) * cos(pos.y * freq * 0.7 + u_time * speed * 0.8 * u_wave_speed + phase);
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
        
        // Calculate approximate normal for lighting using finite differences
        float epsilon = 0.1;
        float hL = wave(worldPos - vec2(epsilon, 0.0), u_wave_frequency, 1.5, 0.0) * 0.4;
        float hR = wave(worldPos + vec2(epsilon, 0.0), u_wave_frequency, 1.5, 0.0) * 0.4;
        float hD = wave(worldPos - vec2(0.0, epsilon), u_wave_frequency, 1.5, 0.0) * 0.4;
        float hU = wave(worldPos + vec2(0.0, epsilon), u_wave_frequency, 1.5, 0.0) * 0.4;
        
        vec3 normal = normalize(vec3((hL - hR) * u_wave_height, 2.0, (hD - hU) * u_wave_height));
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
    uniform float u_fresnel_power; // Added for GUI
    uniform float u_specular_shininess; // Added for GUI
    uniform float u_foam_threshold; // Added for GUI
    uniform float u_transparency_depth_fade; // Added for GUI
    uniform float u_caustics_intensity; // Added for GUI
    uniform float u_reflection_strength; // Added for GUI
    uniform float u_normal_strength; // Added for GUI
    uniform float u_caustics_speed; // Added for GUI
    uniform bool u_enable_caustics; // Added for GUI
    uniform bool u_enable_foam; // Added for GUI
    uniform bool u_enable_reflections; // Added for GUI
    
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
        return normalize(vNormal + blendedNormal * u_normal_strength);
    }

    // Caustics calculation
    vec3 getCaustics(vec2 worldPos, float depth) {
        if (depth > 2.0 || !u_enable_caustics) return vec3(0.0); // No caustics in deep water or if disabled
        
        // Animated caustics with wave distortion
        vec2 causticsUV1 = worldPos * 0.08 + vec2(u_time * u_caustics_speed, u_time * u_caustics_speed * 0.66);
        vec2 causticsUV2 = worldPos * 0.12 + vec2(-u_time * u_caustics_speed * 0.83, u_time * u_caustics_speed * 1.16);
        
        // Add wave-based distortion to caustics
        vec2 distortion = vec2(vWaveHeight * 0.1, vWaveHeight * 0.08);
        causticsUV1 += distortion;
        causticsUV2 += distortion * 1.3;
        
        float caustic1 = texture2D(u_caustics_texture, causticsUV1).r;
        float caustic2 = texture2D(u_caustics_texture, causticsUV2).r;
        
        float causticBlend = (caustic1 * 0.7 + caustic2 * 0.3);
        
        // Fade caustics based on depth and intensity
        float depthFade = 1.0 - smoothstep(0.0, 2.0, depth);
        float causticIntensity = causticBlend * depthFade * u_caustics_intensity;
        
        return vec3(causticIntensity * 0.9, causticIntensity, causticIntensity * 0.7);
    }

    // Sky reflection calculation
    vec3 getSkyReflection(vec3 viewDir, vec3 normal) {
        if (!u_enable_reflections) return vec3(0.0); // Disable reflections if toggled off
        
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
        float fresnelFactor = fresnel(viewDir, surfaceNormal, u_fresnel_power);
        
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
        float specular = pow(max(dot(surfaceNormal, halfVector), 0.0), u_specular_shininess);
        vec3 specularColor = vec3(1.0) * specular * 0.8;
        
        // Enhanced foam calculation
        float foamFactor = 0.0;
        if (u_enable_foam && depth < u_foam_threshold) {
            float shorelineFoam = (1.0 - depth / u_foam_threshold);
            float waveFoam = clamp(abs(vWaveHeight) * 15.0, 0.0, 1.0);
            foamFactor = max(shorelineFoam * 0.6, waveFoam * 0.4);
        }
        
        // Combine all effects
        vec3 finalColor = waterBaseColor;
        
        // Add caustics to base color (affects underwater areas)
        finalColor += caustics;
        
        // Blend with sky reflection based on Fresnel
        finalColor = mix(finalColor, skyReflection * 1.2, fresnelFactor * u_reflection_strength);
        
        // Add specular highlights
        finalColor += specularColor;
        
        // Add foam
        finalColor = mix(finalColor, u_foam_color.rgb, foamFactor);
        
        // Enhanced transparency calculation
        float alpha = depth <= 0.05 ? smoothstep(0.0, 0.05, depth) * 0.2 : 
                     depth <= u_foam_threshold ? mix(0.2, 0.85, smoothstep(0.05, u_foam_threshold, depth)) :
                     depth <= u_transparency_depth_fade ? mix(0.85, 0.95, smoothstep(u_foam_threshold, u_transparency_depth_fade, depth)) : 0.95;
        
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
        
        // Create fallback textures immediately
        this.createFallbackTextures();
        
        // Create material with fallback textures first
        this.createSharedMaterial();
        
        // Setup GUI
        this.setupGUI();
        
        // Then load better textures asynchronously
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
        // Update the existing material with the loaded textures
        this.updateMaterialTextures();
    }

    async loadTextures() {
        const loader = new THREE.TextureLoader();
        
        try {
            console.log('Loading water textures...');
            
            // Load normal map
            const newNormalTexture = await this.loadTexture(loader, './terrain/water_normal.png');
            this.setupTextureProperties(newNormalTexture, true);
            this.normalTexture = newNormalTexture;
            
            // Load caustics
            const newCausticsTexture = await this.loadTexture(loader, './terrain/caustics.png');
            this.setupTextureProperties(newCausticsTexture, true);
            this.causticsTexture = newCausticsTexture;
            
            // Load sky reflection
            const newSkyReflectionTexture = await this.loadTexture(loader, './terrain/sky_reflection.png');
            this.setupTextureProperties(newSkyReflectionTexture, false);
            this.skyReflectionTexture = newSkyReflectionTexture;
            
            console.log('All water textures loaded successfully');
        } catch (error) {
            console.warn('Failed to load some water textures, using fallbacks:', error);
            // Fallbacks are already created, so we continue
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
        // Create fallback textures with default size
        if (!this.normalTexture) {
            this.normalTexture = this.createFallbackNormalTexture(64);
        }
        
        if (!this.causticsTexture) {
            this.causticsTexture = this.createFallbackCausticsTexture(64);
        }
        
        if (!this.skyReflectionTexture) {
            this.skyReflectionTexture = this.createFallbackSkyTexture(128);
        }
    }

    createFallbackNormalTexture(size = 64) {
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

    createFallbackCausticsTexture(size = 64) {
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
            ctx.moveTo(0, i * (size / 8));
            for (let x = 0; x < size; x += 2) {
                const y = i * (size / 8) + Math.sin(x * 0.2 + i) * (size / 16);
                ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        this.setupTextureProperties(texture, true);
        return texture;
    }

    createFallbackSkyTexture(size = 128) {
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
            u_wave_speed: { value: 1.0 }, // Added for GUI
            
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
            u_chunk_offset: { value: new THREE.Vector2(0, 0) },
            
            // Added for GUI
            u_fresnel_power: { value: 2.5 },
            u_specular_shininess: { value: 128.0 },
            u_foam_threshold: { value: 0.3 },
            u_transparency_depth_fade: { value: 2.0 },
            u_caustics_intensity: { value: 0.8 },
            u_reflection_strength: { value: 0.7 },
            u_normal_strength: { value: 0.3 },
            u_caustics_speed: { value: 0.03 },
            u_enable_caustics: { value: true },
            u_enable_foam: { value: true },
            u_enable_reflections: { value: true }
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

    setupGUI() {
        this.gui = new dat.GUI({ name: 'Water Controls' });
        
        // Helper object to hold adjustable values
        this.controls = {
            waveHeight: this.uniforms.u_wave_height.value,
            waveFrequency: this.uniforms.u_wave_frequency.value,
            waveSpeed: this.uniforms.u_wave_speed.value,
            shallowColor: '#' + new THREE.Color(this.uniforms.u_shallow_color.value.x, this.uniforms.u_shallow_color.value.y, this.uniforms.u_shallow_color.value.z).getHexString(),
            deepColor: '#' + new THREE.Color(this.uniforms.u_deep_color.value.x, this.uniforms.u_deep_color.value.y, this.uniforms.u_deep_color.value.z).getHexString(),
            foamColor: '#' + new THREE.Color(this.uniforms.u_foam_color.value.x, this.uniforms.u_foam_color.value.y, this.uniforms.u_foam_color.value.z).getHexString(),
            fresnelPower: this.uniforms.u_fresnel_power.value,
            specularShininess: this.uniforms.u_specular_shininess.value,
            foamThreshold: this.uniforms.u_foam_threshold.value,
            transparencyDepthFade: this.uniforms.u_transparency_depth_fade.value,
            lightDirectionX: this.uniforms.u_light_direction.value.x,
            lightDirectionY: this.uniforms.u_light_direction.value.y,
            lightDirectionZ: this.uniforms.u_light_direction.value.z,
            causticsIntensity: this.uniforms.u_caustics_intensity.value,
            reflectionStrength: this.uniforms.u_reflection_strength.value,
            normalMapStrength: this.uniforms.u_normal_strength.value,
            causticsSpeed: this.uniforms.u_caustics_speed.value,
            waterLevel: this.waterLevel,
            enableCaustics: this.uniforms.u_enable_caustics.value,
            enableFoam: this.uniforms.u_enable_foam.value,
            enableReflections: this.uniforms.u_enable_reflections.value,
            textureSize: 64
        };
        
        // GUI Folders
        const wavesFolder = this.gui.addFolder('Waves & Animation');
        wavesFolder.add(this.controls, 'waveHeight', 0.001, 0.1).name('Wave Height').onChange((v) => { this.uniforms.u_wave_height.value = v; this.updateMaterials(); });
        wavesFolder.add(this.controls, 'waveFrequency', 0.005, 0.05).name('Wave Frequency').onChange((v) => { this.uniforms.u_wave_frequency.value = v; this.updateMaterials(); });
        wavesFolder.add(this.controls, 'waveSpeed', 0.5, 3.0).name('Wave Speed').onChange((v) => { this.uniforms.u_wave_speed.value = v; this.updateMaterials(); });
        
        const colorsFolder = this.gui.addFolder('Colors & Appearance');
        colorsFolder.addColor(this.controls, 'shallowColor').name('Shallow Color').onChange((v) => { this.updateColor(this.uniforms.u_shallow_color, v); });
        colorsFolder.addColor(this.controls, 'deepColor').name('Deep Color').onChange((v) => { this.updateColor(this.uniforms.u_deep_color, v); });
        colorsFolder.addColor(this.controls, 'foamColor').name('Foam Color').onChange((v) => { this.updateColor(this.uniforms.u_foam_color, v); });
        colorsFolder.add(this.controls, 'fresnelPower', 1.0, 5.0).name('Fresnel Power').onChange((v) => { this.uniforms.u_fresnel_power.value = v; this.updateMaterials(); });
        colorsFolder.add(this.controls, 'specularShininess', 10, 500).name('Specular Shininess').onChange((v) => { this.uniforms.u_specular_shininess.value = v; this.updateMaterials(); });
        colorsFolder.add(this.controls, 'foamThreshold', 0.1, 0.5).name('Foam Threshold').onChange((v) => { this.uniforms.u_foam_threshold.value = v; this.updateMaterials(); });
        colorsFolder.add(this.controls, 'transparencyDepthFade', 1.0, 5.0).name('Transparency Fade Depth').onChange((v) => { this.uniforms.u_transparency_depth_fade.value = v; this.updateMaterials(); });
        
        const lightingFolder = this.gui.addFolder('Lighting & Environment');
        lightingFolder.add(this.controls, 'lightDirectionX', -1, 1).name('Light Dir X').onChange(() => this.updateLightDirection());
        lightingFolder.add(this.controls, 'lightDirectionY', -1, 1).name('Light Dir Y').onChange(() => this.updateLightDirection());
        lightingFolder.add(this.controls, 'lightDirectionZ', -1, 1).name('Light Dir Z').onChange(() => this.updateLightDirection());
        lightingFolder.add(this.controls, 'causticsIntensity', 0.0, 2.0).name('Caustics Intensity').onChange((v) => { this.uniforms.u_caustics_intensity.value = v; this.updateMaterials(); });
        lightingFolder.add(this.controls, 'reflectionStrength', 0.0, 1.0).name('Reflection Strength').onChange((v) => { this.uniforms.u_reflection_strength.value = v; this.updateMaterials(); });
        lightingFolder.add(this.controls, 'normalMapStrength', 0.0, 1.0).name('Normal Map Strength').onChange((v) => { this.uniforms.u_normal_strength.value = v; this.updateMaterials(); });
        lightingFolder.add(this.controls, 'causticsSpeed', 0.01, 0.1).name('Caustics Speed').onChange((v) => { this.uniforms.u_caustics_speed.value = v; this.updateMaterials(); });
        
        const globalFolder = this.gui.addFolder('Global');
        globalFolder.add(this.controls, 'waterLevel', -5, 5).name('Water Level').onChange((v) => { 
            this.waterLevel = v; 
            this.uniforms.u_water_level.value = v; 
            this.waterChunks.forEach(m => m.position.y = v); 
            this.updateMaterials(); 
        });
        globalFolder.add(this.controls, 'enableCaustics').name('Enable Caustics').onChange((v) => { this.uniforms.u_enable_caustics.value = v; this.updateMaterials(); });
        globalFolder.add(this.controls, 'enableFoam').name('Enable Foam').onChange((v) => { this.uniforms.u_enable_foam.value = v; this.updateMaterials(); });
        globalFolder.add(this.controls, 'enableReflections').name('Enable Reflections').onChange((v) => { this.uniforms.u_enable_reflections.value = v; this.updateMaterials(); });
        globalFolder.add(this.controls, 'textureSize', { Small: 64, Medium: 128, Large: 256, ExtraLarge: 512, Max: 1024 }).name('Texture Size').onChange((v) => this.regenerateTextures(v));
    }

    updateColor(uniform, hex) {
        const color = new THREE.Color(hex);
        uniform.value.set(color.r, color.g, color.b, 1.0);
        this.updateMaterials();
    }

    updateLightDirection() {
        this.uniforms.u_light_direction.value.set(
            this.controls.lightDirectionX,
            this.controls.lightDirectionY,
            this.controls.lightDirectionZ
        ).normalize();
        this.updateMaterials();
    }

    updateMaterials() {
        this.waterChunks.forEach((mesh) => {
            if (mesh.material && mesh.material.uniforms) {
                Object.assign(mesh.material.uniforms, this.uniforms);
                mesh.material.needsUpdate = true;
            }
        });
    }

    regenerateTextures(size) {
        // Dispose old textures
        if (this.normalTexture) this.normalTexture.dispose();
        if (this.causticsTexture) this.causticsTexture.dispose();
        if (this.skyReflectionTexture) this.skyReflectionTexture.dispose();
        
        // Regenerate with new size
        this.normalTexture = this.createFallbackNormalTexture(size);
        this.causticsTexture = this.createFallbackCausticsTexture(size);
        this.skyReflectionTexture = this.createFallbackSkyTexture(size);
        
        this.updateMaterialTextures();
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
        const speed = this.uniforms.u_wave_speed.value;
        
        // Enhanced wave calculation matching vertex shader
        let waveHeight = 0;
        waveHeight += Math.sin(x * freq + time * 1.5 * speed) * Math.cos(z * freq * 0.7 + time * 1.2 * speed) * 0.4;
        waveHeight += Math.sin(x * freq * 1.8 + time * 2.1 * speed) * Math.cos(z * freq * 1.19 + time * 1.68 * speed) * 0.3;
        waveHeight += Math.sin(x * freq * 0.6 + time * 0.9 * speed) * Math.cos(z * freq * 0.42 + time * 0.72 * speed) * 0.2;
        waveHeight += Math.sin(x * freq * 3.2 + time * 2.8 * speed) * Math.cos(z * freq * 2.24 + time * 2.24 * speed) * 0.1;
        
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
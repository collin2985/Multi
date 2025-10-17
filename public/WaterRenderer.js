// WaterRenderer.js - Hybrid Version: New GUI + Old Visual Appeal
import * as THREE from 'three';

const dat = window.dat;

// --- Simplified Water Vertex Shader (based on old version) ---
// Replace your existing waterVertexShader with this modified version:

const waterVertexShader = `
    precision mediump float;
    uniform float u_time;
    uniform float u_wave_height;
    uniform float u_wave_frequency;
    uniform float u_wave_speed;
    uniform vec2 u_chunk_offset;
    uniform sampler2D u_height_texture;
    uniform float u_chunk_size;
    uniform float u_water_level;
    
    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;
    varying float vWaveHeight;
    varying float vWaveSlope;

    // Sample terrain height function (same as in fragment shader)
    float sampleTerrainHeight(vec2 worldPos) {
        vec2 localPos = worldPos - u_chunk_offset;
        vec2 uv = (localPos / u_chunk_size) + 0.5;
        uv = clamp(uv, 0.001, 0.999);
        float heightNormalized = texture2D(u_height_texture, uv).r;
        return mix(-10.0, 80.0, heightNormalized);
    }

    // Simplified wave function (from old version)
    float wave(vec2 pos, float freq, float speed) {
        return sin(pos.x * freq + u_time * speed * u_wave_speed) * cos(pos.y * freq * 0.7 + u_time * speed * 0.8 * u_wave_speed);
    }

    float waveDerivativeX(vec2 pos, float freq, float speed) {
        return freq * cos(pos.x * freq + u_time * speed * u_wave_speed) * cos(pos.y * freq * 0.7 + u_time * speed * 0.8 * u_wave_speed);
    }

    float waveDerivativeZ(vec2 pos, float freq, float speed) {
        return -freq * 0.7 * sin(pos.x * freq + u_time * speed * u_wave_speed) * sin(pos.y * freq * 0.7 + u_time * speed * 0.8 * u_wave_speed);
    }

    void main() {
        vUv = uv;
        vec3 pos = position;
        
        // Apply chunk offset for wave calculations
        vec2 worldPos = pos.xz + u_chunk_offset;
        
        // Calculate water depth at this position
        float terrainHeight = sampleTerrainHeight(worldPos);
        float waterDepth = u_water_level - terrainHeight;
        
        // Create depth-based wave damping factor
        // Waves fade to 0 when depth <= 0.1, full strength when depth >= 0.5
        float depthFactor = smoothstep(0.1, 0.5, waterDepth);
        
        // Simplified 3-wave system (from old version)
        float waveDisplacement = 0.0;
        waveDisplacement += wave(worldPos, u_wave_frequency, 1.5) * 0.5;
        waveDisplacement += wave(worldPos * 1.8, u_wave_frequency * 1.7, 2.1) * 0.3;
        waveDisplacement += wave(worldPos * 2.3, u_wave_frequency * 0.9, 1.8) * 0.2;
        
        // Apply depth-based damping to wave displacement
        pos.y += waveDisplacement * u_wave_height * depthFactor;
        vWaveHeight = waveDisplacement * depthFactor;
        
        // Calculate wave slopes for foam and normal calculations (also dampened)
        float slopeX = 0.0;
        float slopeZ = 0.0;
        slopeX += waveDerivativeX(worldPos, u_wave_frequency, 1.5) * 0.5;
        slopeX += waveDerivativeX(worldPos * 1.8, u_wave_frequency * 1.7, 2.1) * 0.3;
        slopeZ += waveDerivativeZ(worldPos, u_wave_frequency, 1.5) * 0.5;
        slopeZ += waveDerivativeZ(worldPos * 1.8, u_wave_frequency * 1.7, 2.1) * 0.3;
        vWaveSlope = length(vec2(slopeX, slopeZ)) * u_wave_height * depthFactor;
        
        // Transform to world space
        vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
        vWorldPosition = worldPosition.xyz;
        vViewPosition = cameraPosition - worldPosition.xyz;
        
        // Calculate normal from wave slopes (also dampened)
        vec3 tangentX = vec3(1.0, slopeX * u_wave_height * depthFactor, 0.0);
        vec3 tangentZ = vec3(0.0, slopeZ * u_wave_height * depthFactor, 1.0);
        vWorldNormal = normalize(cross(tangentX, tangentZ));
        
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
`;

// --- Simplified Water Fragment Shader (based on old version) ---
const waterFragmentShader = `
    precision mediump float;
    
    uniform float u_time;
    uniform vec4 u_shallow_color;
    uniform vec4 u_deep_color;
    uniform vec4 u_foam_color;
    uniform sampler2D u_height_texture;
    uniform sampler2D u_normal_texture;
    uniform sampler2D u_sky_reflection_texture;
    uniform sampler2D u_foam_texture;
    uniform sampler2D u_caustics_texture;
    uniform float u_water_level;
    uniform float u_chunk_size;
    uniform vec2 u_chunk_offset;
    uniform vec3 u_sun_direction;
    uniform vec3 u_sun_color;
    uniform float u_shininess;
    uniform float u_foam_threshold;
    uniform float u_normal_scale;
    uniform float u_texture_scale;
    uniform float u_transparency;
    uniform float u_caustics_intensity;
    uniform bool u_enable_caustics;
    uniform bool u_enable_foam;
    uniform bool u_enable_reflections;
    
    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;
    varying float vWaveHeight;
    varying float vWaveSlope;

    // Sample terrain height
    float sampleTerrainHeight(vec2 worldPos) {
        vec2 localPos = worldPos - u_chunk_offset;
        vec2 uv = (localPos / u_chunk_size) + 0.5;
        uv = clamp(uv, 0.001, 0.999);
        float heightNormalized = texture2D(u_height_texture, uv).r;
        return mix(-10.0, 80.0, heightNormalized);
    }

    void main() {
        // Sample terrain height and calculate depth
        float terrainHeight = sampleTerrainHeight(vWorldPosition.xz);
        float local_depth = vWorldPosition.y - terrainHeight;
        
        // Discard fragments below terrain
        if (local_depth < 0.0) discard;
        
        // Simplified normal mapping (from old version approach)
        vec2 worldUV = vWorldPosition.xz * 0.02; // Scale world coordinates
vec2 scrolledUvA = worldUV * 8.0 * u_texture_scale + vec2(u_time * 0.003, u_time * 0.0024);
vec2 scrolledUvB = worldUV * 12.0 * u_texture_scale + vec2(u_time * -0.0018, u_time * 0.0036);
vec2 scrolledUvC = worldUV * 15.0 * u_texture_scale + vec2(u_time * 0.0012, u_time * -0.0021);
        
        vec3 normalSampleA = texture2D(u_normal_texture, scrolledUvA).rgb;
        vec3 normalSampleB = texture2D(u_normal_texture, scrolledUvB).rgb;
        vec3 normalSampleC = texture2D(u_normal_texture, scrolledUvC).rgb;

        // Fix: Ensure Z component is positive for tangent space normals
        vec3 normalA = vec3(normalSampleA.xy * 2.0 - 1.0, normalSampleA.z);
        vec3 normalB = vec3(normalSampleB.xy * 2.0 - 1.0, normalSampleB.z);
        vec3 normalC = vec3(normalSampleC.xy * 2.0 - 1.0, normalSampleC.z);

        normalA = normalize(normalA);
        normalB = normalize(normalB);
        normalC = normalize(normalC);
        
        vec3 blendedNormal = normalize(normalA + normalB * 0.5 + normalC * 0.3);
        vec3 perturbedNormal = normalize(mix(vWorldNormal, blendedNormal, u_normal_scale * 0.3));
        
        // Clear depth zones (from old version)
        // 0 - 1.5   : shallow
        // 1.5 - 2.0 : transition  
        // > 2.0     : deep
        float shallowFactor = clamp(local_depth / 1.5, 0.0, 1.0);
        float transitionFactor = smoothstep(1.5, 2.0, local_depth);
        
        // Base color with clean depth-based mixing
        vec3 waterBaseColor = mix(u_shallow_color.rgb, u_deep_color.rgb, transitionFactor);
        
        // Clean transparency zones (from old version)
        float alpha;
        if (local_depth <= 1.5) {
            alpha = mix(0.3, 0.8, shallowFactor);  // fade in shallow
        } else if (local_depth <= 2.0) {
            alpha = mix(0.8, 1.0, transitionFactor); // transition zone
        } else {
            alpha = 1.0; // full opacity deep
        }
        alpha *= u_transparency;
        
        // View direction and fresnel
        vec3 viewDir = normalize(vViewPosition);
        float fresnel = pow(1.0 - max(dot(viewDir, perturbedNormal), 0.0), 1.5);
        
        // Sky reflection
        vec3 skyColor = vec3(0.0);
        if (u_enable_reflections) {
            vec3 reflectedDir = reflect(-viewDir, perturbedNormal);
            vec2 skyUv = reflectedDir.xz * 0.5 + 0.5;
            skyColor = texture2D(u_sky_reflection_texture, skyUv).rgb;
        }
        
        // Specular highlights
        vec3 halfVector = normalize(u_sun_direction + viewDir);
        float specular = pow(max(dot(perturbedNormal, halfVector), 0.0), u_shininess);
        vec3 specularColor = u_sun_color * specular;
        
        // Foam calculation (from old version)
        float foam = 0.0;
        if (u_enable_foam) {
            // Use the ACTUAL rendered depth (local_depth) which accounts for wave displacement
            // Foam appears in very shallow water (0 to 0.25 units deep)
            float shorelineFoamFactor = smoothstep(0.0, 0.05, local_depth) * (1.0 - smoothstep(0.05, 0.25, local_depth));

            // Wave-based foam
            float adjustedThreshold = 0.002;
            foam = shorelineFoamFactor * smoothstep(adjustedThreshold, adjustedThreshold + 0.02, vWaveSlope);
            foam *= 2.5; // Moderate foam strength
            foam = clamp(foam, 0.0, 1.0); // Prevent over-brightness

            // Add foam noise variation
            float foamNoise = sin(vWaveSlope * 10.0 + u_time * 3.0) * 0.5 + 0.5;
            foam *= foamNoise * 0.5 + 0.5;
        }
        
        // Caustics (simplified from old version)
        vec3 causticsColor = vec3(0.0);
        if (u_enable_caustics && local_depth < 2.0) {
            vec2 causticsUv1 = vUv * 6.0 + vec2(u_time * 0.002, u_time * 0.0015);
            vec2 causticsUv2 = vUv * 8.5 + vec2(u_time * -0.0012, u_time * 0.0018);
            
            vec3 caustics1 = texture2D(u_caustics_texture, causticsUv1).rgb;
            vec3 caustics2 = texture2D(u_caustics_texture, causticsUv2).rgb;
            causticsColor = mix(caustics1, caustics2, 0.5);
            
            float causticsIntensity = (1.0 - local_depth) * u_caustics_intensity;
            causticsIntensity *= sin(u_time * 1.5) * 0.3 + 0.7;
            causticsColor *= causticsIntensity * vec3(0.8, 1.0, 0.9);
        }
        
        // Final color combination (from old version)
        vec3 finalColor = waterBaseColor;
        
        // Add sky reflection
        finalColor = mix(finalColor, skyColor, fresnel * 0.4);
        
        // Add specular highlights
        finalColor += specularColor * 0.6;
        
        // Add caustics
        finalColor += causticsColor;
        
        // Add foam
        if (u_enable_foam) {
            // Use pure white foam color to avoid pink tint
            vec3 pureWhiteFoam = vec3(1.0, 1.0, 1.0);
            finalColor = mix(finalColor, pureWhiteFoam, foam); // Full foam blend for maximum visibility
            alpha = mix(alpha, 1.0, foam); // Fully opaque foam
        }
        
        gl_FragColor = vec4(finalColor, alpha);
    }
`;

// --- Main Hybrid WaterRenderer Class ---
export class WaterRenderer {
    constructor(scene = null, waterLevel = 1.02, terrainRenderer = null) {  //requires change in game.js
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
        this.foamTexture = null;
        
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
        
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1, 1, 0.5);
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
        
        // Load textures with fallback handling
        try {
            const newNormalTexture = await this.loadTexture(loader, './terrain/water_normal.png');
            this.setupTextureProperties(newNormalTexture, true);
            this.normalTexture = newNormalTexture;
        } catch (e) {
            console.warn('Failed to load normal texture, keeping fallback');
        }
        
        try {
            const newCausticsTexture = await this.loadTexture(loader, './terrain/caustics.png');
            this.setupTextureProperties(newCausticsTexture, true);
            this.causticsTexture = newCausticsTexture;
        } catch (e) {
            console.warn('Failed to load caustics texture, keeping fallback');
        }
        
        try {
            const newSkyTexture = await this.loadTexture(loader, './terrain/sky_reflection.png');
            this.setupTextureProperties(newSkyTexture, false);
            this.skyReflectionTexture = newSkyTexture;
        } catch (e) {
            console.warn('Failed to load sky reflection texture, keeping fallback');
        }
        
        try {
            const newFoamTexture = await this.loadTexture(loader, './terrain/foam.png');
            this.setupTextureProperties(newFoamTexture, true);
            this.foamTexture = newFoamTexture;
        } catch (e) {
            console.warn('Failed to load foam texture, keeping fallback');
        }
        
        console.log('Water texture loading completed');
    } catch (error) {
        console.warn('Texture loading error:', error);
    }
}

    loadTexture(loader, path) {
        return new Promise((resolve, reject) => {
            loader.load(path, resolve, undefined, reject);
        });
    }

setupTextureProperties(texture, repeat) {
    // Only set properties if texture hasn't been uploaded to GPU yet
    if (texture.image && texture.version === 0) {
        if (repeat) {
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        } else {
            texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
        }
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;
    }
}

    createFallbackTextures() {
        // Create fallback textures
        if (!this.normalTexture) {
            this.normalTexture = this.createFallbackNormalTexture(64);
        }
        
        if (!this.causticsTexture) {
            this.causticsTexture = this.createFallbackCausticsTexture(64);
        }
        
        if (!this.skyReflectionTexture) {
            this.skyReflectionTexture = this.createFallbackSkyTexture(128);
        }
        
        if (!this.foamTexture) {
            this.foamTexture = this.createFallbackFoamTexture(64);
        }
    }

    createFallbackNormalTexture(size = 64) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        const imgData = ctx.createImageData(size, size);
        const data = imgData.data;
        
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const index = (y * size + x) * 4;
                const wave = Math.sin(x * 0.2) * Math.cos(y * 0.2);
                data[index] = 128 + wave * 30; // R (X normal)
                data[index + 1] = 128 - wave * 30; // G (Y normal) - inverted for correct direction
                data[index + 2] = 255;
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
        
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, size, size);
        
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        
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

createFallbackSkyTexture(size = 64) {
            const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        
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

    createFallbackFoamTexture(size = 64) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        
        // Add some texture
        for (let i = 0; i < 100; i++) {
            ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.5 + 0.5})`;
            ctx.beginPath();
            ctx.arc(Math.random() * size, Math.random() * size, Math.random() * 3, 0, Math.PI * 2);
            ctx.fill();
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        this.setupTextureProperties(texture, true);
        return texture;
    }

createDefaultHeightTexture() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    
    return texture;
}

    createSharedMaterial() {
        const defaultHeightTexture = this.createDefaultHeightTexture();
        
        // Use old version's appealing colors
        const shallowColor = new THREE.Color(0x00ba71); // Deep blue from old version
        const deepColor = new THREE.Color(0x00ba71);    // Deeper blue from old version
        const foamColor = new THREE.Color(0xffffff);
        
        this.uniforms = {
            // Time and animation
            u_time: { value: 0.0 },
            u_wave_speed: { value: 0.27 },
            
            // Wave parameters (old version defaults)
            u_wave_height: { value: 0.085 },
            u_wave_frequency: { value: 1.1 },
            
            // Colors (old version colors)
            u_shallow_color: { value: new THREE.Vector4(shallowColor.r, shallowColor.g, shallowColor.b, 1.0) },
            u_deep_color: { value: new THREE.Vector4(deepColor.r, deepColor.g, deepColor.b, 1.0) },
            u_foam_color: { value: new THREE.Vector4(foamColor.r, foamColor.g, foamColor.b, 1.0) },
            
            // Textures
            u_height_texture: { value: defaultHeightTexture },
            u_normal_texture: { value: this.normalTexture },
            u_caustics_texture: { value: this.causticsTexture },
            u_sky_reflection_texture: { value: this.skyReflectionTexture },
            u_foam_texture: { value: this.foamTexture },
            
            // Lighting (old version defaults)
            u_sun_direction: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
            u_sun_color: { value: new THREE.Color(0xfff8dc) },
            
            // Material properties
            u_water_level: { value: this.waterLevel },
            u_chunk_size: { value: 50.0 },
            u_chunk_offset: { value: new THREE.Vector2(0, 0) },
            
            // GUI parameters (old version defaults)
            u_shininess: { value: 1.0 },
            u_foam_threshold: { value: 5.0 },
            u_normal_scale: { value: 0.0 },
            u_texture_scale: { value: 0.6 },
            u_transparency: { value: 1.0 },
            u_caustics_intensity: { value: 0.13 },
            u_enable_caustics: { value: true },
            u_enable_foam: { value: true },
            u_enable_reflections: { value: true }
        };
        
        this.sharedMaterial = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: waterVertexShader,
            fragmentShader: waterFragmentShader,
            transparent: true,
            depthWrite: true,  
            depthTest: true,  
            fog: false,
            side: THREE.FrontSide
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
            shininess: this.uniforms.u_shininess.value,
            foamThreshold: this.uniforms.u_foam_threshold.value,
            normalScale: this.uniforms.u_normal_scale.value,
            textureScale: this.uniforms.u_texture_scale.value,
            transparency: this.uniforms.u_transparency.value,
            causticsIntensity: this.uniforms.u_caustics_intensity.value,
            sunDirectionX: this.uniforms.u_sun_direction.value.x,
            sunDirectionY: this.uniforms.u_sun_direction.value.y,
            sunDirectionZ: this.uniforms.u_sun_direction.value.z,
            waterLevel: this.waterLevel,
            enableCaustics: this.uniforms.u_enable_caustics.value,
            enableFoam: this.uniforms.u_enable_foam.value,
            enableReflections: this.uniforms.u_enable_reflections.value
        };
        
        // GUI Folders
        const wavesFolder = this.gui.addFolder('Waves & Animation');
        wavesFolder.add(this.controls, 'waveHeight', 0.001, 0.2).name('Wave Height').onChange((v) => { 
            this.uniforms.u_wave_height.value = v; 
            this.updateMaterials(); 
        });
        wavesFolder.add(this.controls, 'waveFrequency', 0.01, 2.0).name('Wave Frequency').onChange((v) => { 
            this.uniforms.u_wave_frequency.value = v; 
            this.updateMaterials(); 
        });
        wavesFolder.add(this.controls, 'waveSpeed', 0.0, 3.0).name('Wave Speed').onChange((v) => { 
            this.uniforms.u_wave_speed.value = v; 
            this.updateMaterials(); 
        });
        
        const colorsFolder = this.gui.addFolder('Colors & Appearance');
        colorsFolder.addColor(this.controls, 'shallowColor').name('Shallow Color').onChange((v) => { 
            this.updateColor(this.uniforms.u_shallow_color, v); 
        });
        colorsFolder.addColor(this.controls, 'deepColor').name('Deep Color').onChange((v) => { 
            this.updateColor(this.uniforms.u_deep_color, v); 
        });
        colorsFolder.addColor(this.controls, 'foamColor').name('Foam Color').onChange((v) => { 
            this.updateColor(this.uniforms.u_foam_color, v); 
        });
        colorsFolder.add(this.controls, 'transparency', 0.0, 1.0).name('Transparency').onChange((v) => { 
            this.uniforms.u_transparency.value = v; 
            this.updateMaterials(); 
        });
        
        const lightingFolder = this.gui.addFolder('Lighting & Effects');
        lightingFolder.add(this.controls, 'shininess', 1.0, 256.0).name('Shininess').onChange((v) => { 
            this.uniforms.u_shininess.value = v; 
            this.updateMaterials(); 
        });
        lightingFolder.add(this.controls, 'foamThreshold', 0.0, 10.0).name('Foam Threshold').onChange((v) => { 
            this.uniforms.u_foam_threshold.value = v; 
            this.updateMaterials(); 
        });
        lightingFolder.add(this.controls, 'normalScale', 0.0, 5.0).name('Normal Scale').onChange((v) => { 
            this.uniforms.u_normal_scale.value = v; 
            this.updateMaterials(); 
        });
        lightingFolder.add(this.controls, 'textureScale', 0.5, 5.0).name('Texture Scale').onChange((v) => { 
            this.uniforms.u_texture_scale.value = v; 
            this.updateMaterials(); 
        });
        lightingFolder.add(this.controls, 'causticsIntensity', 0.0, 1.0).name('Caustics Intensity').onChange((v) => { 
            this.uniforms.u_caustics_intensity.value = v; 
            this.updateMaterials(); 
        });
        lightingFolder.add(this.controls, 'sunDirectionX', -1, 1).name('Sun Dir X').onChange(() => this.updateSunDirection());
        lightingFolder.add(this.controls, 'sunDirectionY', -1, 1).name('Sun Dir Y').onChange(() => this.updateSunDirection());
        lightingFolder.add(this.controls, 'sunDirectionZ', -1, 1).name('Sun Dir Z').onChange(() => this.updateSunDirection());
        
        const globalFolder = this.gui.addFolder('Global Settings');
        globalFolder.add(this.controls, 'waterLevel', -5, 5).name('Water Level').onChange((v) => { 
            this.waterLevel = v; 
            this.uniforms.u_water_level.value = v; 
            this.waterChunks.forEach(m => m.position.y = v); 
            this.updateMaterials(); 
        });
        globalFolder.add(this.controls, 'enableCaustics').name('Enable Caustics').onChange((v) => { 
            this.uniforms.u_enable_caustics.value = v; 
            this.updateMaterials(); 
        });
        globalFolder.add(this.controls, 'enableFoam').name('Enable Foam').onChange((v) => { 
            this.uniforms.u_enable_foam.value = v; 
            this.updateMaterials(); 
        });
        globalFolder.add(this.controls, 'enableReflections').name('Enable Reflections').onChange((v) => { 
            this.uniforms.u_enable_reflections.value = v; 
            this.updateMaterials(); 
        });

        // Water chunks debug info
        const debugFolder = this.gui.addFolder('Debug Info');
        debugFolder.add({ count: () => this.waterChunks.size }, 'count').name('Active Chunks').listen();
    }

    updateColor(uniform, hex) {
        try {
            const color = new THREE.Color(hex);
            uniform.value.set(color.r, color.g, color.b, 1.0);
            this.updateMaterials();
        } catch (error) {
            console.error('Error updating color:', error);
        }
    }

    updateSunDirection() {
        try {
            this.uniforms.u_sun_direction.value.set(
                this.controls.sunDirectionX,
                this.controls.sunDirectionY,
                this.controls.sunDirectionZ
            ).normalize();
            this.updateMaterials();
        } catch (error) {
            console.error('Error updating sun direction:', error);
        }
    }

    updateMaterials() {
        this.waterChunks.forEach((mesh) => {
            if (mesh.material && mesh.material.uniforms) {
                // Copy all uniforms except chunk-specific ones
                Object.keys(this.uniforms).forEach(key => {
                    if (key !== 'u_chunk_offset' && key !== 'u_height_texture') {
                        if (mesh.material.uniforms[key]) {
                            if (this.uniforms[key].value.copy) {
                                mesh.material.uniforms[key].value.copy(this.uniforms[key].value);
                            } else {
                                mesh.material.uniforms[key].value = this.uniforms[key].value;
                            }
                        }
                    }
                });
                mesh.material.needsUpdate = true;
            }
        });
    }

    updateMaterialTextures() {
    // Dispose old textures before replacing them
    if (this.uniforms.u_normal_texture) {
        const old = this.uniforms.u_normal_texture.value;
        if (old && old.dispose && old !== this.normalTexture) old.dispose();
        this.uniforms.u_normal_texture.value = this.normalTexture;
    }
    if (this.uniforms.u_caustics_texture) {
        const old = this.uniforms.u_caustics_texture.value;
        if (old && old.dispose && old !== this.causticsTexture) old.dispose();
        this.uniforms.u_caustics_texture.value = this.causticsTexture;
    }
    if (this.uniforms.u_sky_reflection_texture) {
        const old = this.uniforms.u_sky_reflection_texture.value;
        if (old && old.dispose && old !== this.skyReflectionTexture) old.dispose();
        this.uniforms.u_sky_reflection_texture.value = this.skyReflectionTexture;
    }
    if (this.uniforms.u_foam_texture) {
        const old = this.uniforms.u_foam_texture.value;
        if (old && old.dispose && old !== this.foamTexture) old.dispose();
        this.uniforms.u_foam_texture.value = this.foamTexture;
    }
    
    // Force material updates
    if (this.sharedMaterial) {
        this.sharedMaterial.needsUpdate = true;
    }
    
    this.updateMaterials();
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
texture.generateMipmaps = false;
texture.flipY = false;

return texture;
    }

    addWaterChunk(chunkX, chunkZ, heightTexture = null) {
        const key = `${chunkX},${chunkZ}`;
        if (this.waterChunks.has(key)) return;
        
        //console.log(`Adding hybrid water chunk at (${chunkX}, ${chunkZ})`);
        
        // Use old version's geometry settings
        const geometry = new THREE.PlaneGeometry(50, 50, 100, 100);
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
        
        //console.log(`Hybrid water chunk added successfully at (${chunkX}, ${chunkZ})`);
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
            
            console.log(`Hybrid water chunk removed at (${chunkX}, ${chunkZ})`);
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
        
        // Update time uniform for each water chunk's material
        this.waterChunks.forEach((mesh, key) => {
            if (mesh.material && mesh.material.uniforms) {
                if (mesh.material.uniforms.u_time) {
                    mesh.material.uniforms.u_time.value = timeValue;
                }
                
                // Update chunk-specific terrain height
                if (this.terrainRenderer) {
                    const [chunkX, chunkZ] = key.split(',').map(Number);
                    // This would need to be implemented in your terrain renderer
                    // const terrainHeight = this.terrainRenderer.getTerrainHeightAt(chunkX, chunkZ);
                    // mesh.material.uniforms.u_terrain_height.value = terrainHeight;
                }
            }
        });
    }

    getWaterHeightAt(x, z, time) {
        const freq = this.uniforms.u_wave_frequency.value;
        const height = this.uniforms.u_wave_height.value;
        const speed = this.uniforms.u_wave_speed.value;
        
        // Use old version's 3-wave system
        let waveHeight = 0;
        waveHeight += Math.sin(x * freq + time * 1.5 * speed) * Math.cos(z * freq * 0.7 + time * 1.2 * speed) * 0.5;
        waveHeight += Math.sin(x * freq * 1.8 + time * 2.1 * speed) * Math.cos(z * freq * 1.19 + time * 1.68 * speed) * 0.3;
        waveHeight += Math.sin(x * freq * 2.3 + time * 1.8 * speed) * Math.cos(z * freq * 1.61 + time * 1.44 * speed) * 0.2;
        
        return this.waterLevel + waveHeight * height;
    }

    getWaterChunks() {
        return Array.from(this.waterChunks.values());
    }

    // Compatibility methods from old version
    setupTestControls() {
        // This method exists for backward compatibility
        // The GUI is automatically set up in the constructor
        console.log('setupTestControls called - GUI already initialized');
    }

    getTestScene() {
        return this.scene;
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
        if (this.foamTexture) this.foamTexture.dispose();
        
        if (this.uniforms.u_height_texture && this.uniforms.u_height_texture.value.dispose) {
            this.uniforms.u_height_texture.value.dispose();
        }
        
        if (this.gui) {
            this.gui.destroy();
        }
        
        console.log('Hybrid WaterRenderer disposed');
    }
}
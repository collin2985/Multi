// WaterRenderer.js
import * as THREE from 'three';
import { CONFIG } from './terrain.js';

const dat = window.dat; 

// --- Vertex Shader ---
const waterVertexShader = `
    uniform float u_time;
    uniform float u_wave_height;
    uniform float u_wave_frequency;
    uniform float u_water_level;
    uniform vec2 u_chunk_offset; // NEW: Chunk position offset
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
        // NEW: Apply chunk offset to position for wave calculations
        vec2 worldPos = pos.xz + u_chunk_offset;
        float waveDisplacement = 0.0;
        waveDisplacement += wave(worldPos, u_wave_frequency, 1.5) * 0.5;
        waveDisplacement += wave(worldPos * 1.8, u_wave_frequency * 1.7, 2.1) * 0.3;
        waveDisplacement += wave(worldPos * 2.3, u_wave_frequency * 0.9, 1.8) * 0.2;
        pos.y += waveDisplacement * u_wave_height;
        vWaveHeight = waveDisplacement;
        float slopeX = 0.0;
        float slopeZ = 0.0;
        slopeX += waveDerivativeX(worldPos, u_wave_frequency, 1.5) * 0.5;
        slopeX += waveDerivativeX(worldPos * 1.8, u_wave_frequency * 1.7, 2.1) * 0.3;
        slopeZ += waveDerivativeZ(worldPos, u_wave_frequency, 1.5) * 0.5;
        slopeZ += waveDerivativeZ(worldPos * 1.8, u_wave_frequency * 1.7, 2.1) * 0.3;
        vWaveSlope = length(vec2(slopeX, slopeZ)) * u_wave_height;
        vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
        vWorldPosition = worldPosition.xyz;
        vViewPosition = cameraPosition - worldPosition.xyz;
        vec3 tangentX = vec3(1.0, slopeX * u_wave_height, 0.0);
        vec3 tangentZ = vec3(0.0, slopeZ * u_wave_height, 1.0);
        vWorldNormal = normalize(cross(tangentX, tangentZ));
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
`;

// --- Fragment Shader ---
const waterFragmentShader = `
    precision highp float;
    
    // Terrain generation uniforms
    uniform int u_terrain_seed;
    uniform float u_base_amplitude;
    uniform float u_base_frequency;
    uniform int u_base_octaves;
    uniform float u_mountain_amplitude;
    uniform float u_mountain_frequency;
    uniform int u_mountain_octaves;
    uniform float u_mountain_scale;
    uniform float u_mask_frequency;
    uniform float u_jagged_frequency1;
    uniform float u_jagged_amplitude1;
    uniform float u_jagged_frequency2;
    uniform float u_jagged_amplitude2;
    uniform float u_jagged_noise_offset1;
    uniform float u_jagged_noise_offset2;
    
    // Water rendering uniforms
    uniform float u_time;
    uniform vec4 u_shallow_color;
    uniform vec4 u_deep_color;
    uniform vec4 u_foam_color;
    uniform sampler2D u_normal_map;
    uniform sampler2D u_sky_reflection;
    uniform sampler2D u_foam_texture;
    uniform sampler2D u_caustics_texture;
    uniform float u_normal_scale;
    uniform float u_transparency;
    uniform float u_water_level;
    uniform vec3 u_sun_direction;
    uniform vec3 u_sun_color;
    uniform float u_shininess;
    uniform float u_foam_threshold;
    uniform float u_texture_scale;
    uniform vec2 u_chunk_offset;
    
    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    varying float vWaveHeight;
    varying float vWaveSlope;

    // Perlin noise implementation
    const float FLOAT_PRECISION = 1000000.0;
    
    float roundCoord(float coord) {
        return floor(coord * FLOAT_PRECISION + 0.5) / FLOAT_PRECISION;
    }
    
    // Permutation table (first 256 values)
    int perm[256] = int[256](
        151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,
        190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,
        125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,
        105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,
        135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,
        82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,
        153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,
        251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,
        157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,
        66,215,61,156,180
    );
    
    int getPermValue(int index) {
        return perm[index & 255];
    }
    
    float fade(float t) {
        return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
    }
    
    float lerp(float t, float a, float b) {
        return a + t * (b - a);
    }
    
    float grad(int hash, float x, float y, float z) {
        int h = hash & 15;
        float u = h < 8 ? x : y;
        float v = h < 4 ? y : (h == 12 || h == 14 ? x : z);
        return ((h & 1) == 0 ? u : -u) + ((h & 2) == 0 ? v : -v);
    }
    
    float noise(float x, float y, float z) {
        int X = int(floor(x)) & 255;
        int Y = int(floor(y)) & 255;
        int Z = int(floor(z)) & 255;
        
        x -= floor(x);
        y -= floor(y);
        z -= floor(z);
        
        float u = fade(x);
        float v = fade(y);
        float w = fade(z);
        
        int A = getPermValue(X) + Y;
        int AA = getPermValue(A) + Z;
        int AB = getPermValue(A + 1) + Z;
        int B = getPermValue(X + 1) + Y;
        int BA = getPermValue(B) + Z;
        int BB = getPermValue(B + 1) + Z;
        
        return lerp(w,
            lerp(v,
                lerp(u, grad(getPermValue(AA), x, y, z), grad(getPermValue(BA), x - 1.0, y, z)),
                lerp(u, grad(getPermValue(AB), x, y - 1.0, z), grad(getPermValue(BB), x - 1.0, y - 1.0, z))
            ),
            lerp(v,
                lerp(u, grad(getPermValue(AA + 1), x, y, z - 1.0), grad(getPermValue(BA + 1), x - 1.0, y, z - 1.0)),
                lerp(u, grad(getPermValue(AB + 1), x, y - 1.0, z - 1.0), grad(getPermValue(BB + 1), x - 1.0, y - 1.0, z - 1.0))
            )
        );
    }
    
    float clampValue(float v, float a, float b) {
        return max(a, min(b, v));
    }
    
    float calculateTerrainHeight(vec2 worldPos) {
        float rx = roundCoord(worldPos.x);
        float rz = roundCoord(worldPos.y);
        
        // Base terrain
        float base = 0.0;
        float amplitude = u_base_amplitude;
        float frequency = u_base_frequency;
        
        for (int octave = 0; octave < 3; octave++) {
            if (octave >= u_base_octaves) break;
            base += noise(rx * frequency, rz * frequency, 10.0 + float(octave) * 7.0) * amplitude;
            amplitude *= 0.5;
            frequency *= 2.0;
        }
        
        // Mountain mask
        float maskRaw = noise(rx * u_mask_frequency, rz * u_mask_frequency, 400.0);
        float mask = pow((maskRaw + 1.0) * 0.5, 3.0);
        
        // Mountains
        float mountain = 0.0;
        amplitude = u_mountain_amplitude;
        frequency = u_mountain_frequency;
        
        for (int octave = 0; octave < 4; octave++) {
            if (octave >= u_mountain_octaves) break;
            mountain += abs(noise(rx * frequency, rz * frequency, 500.0 + float(octave) * 11.0)) * amplitude;
            amplitude *= 0.5;
            frequency *= 2.0;
        }
        mountain *= u_mountain_scale * mask;
        
        float heightBeforeJagged = base + mountain;
        
        // Jagged detail
        float elevNorm = clampValue((heightBeforeJagged + 2.0) / 25.0, 0.0, 1.0);
        float jagged = noise(rx * u_jagged_frequency1, rz * u_jagged_frequency1, u_jagged_noise_offset1) * u_jagged_amplitude1 * elevNorm + 
                       noise(rx * u_jagged_frequency2, rz * u_jagged_frequency2, u_jagged_noise_offset2) * u_jagged_amplitude2 * elevNorm;
        
        return heightBeforeJagged + jagged;
    }

    void main() {
        // Calculate terrain height at this fragment's world position
        float terrainHeight = calculateTerrainHeight(vWorldPosition.xz);
        float local_depth = vWorldPosition.y - terrainHeight;
        
        if (local_depth < 0.0) discard;
        
        vec2 scrolledUvA = vUv * 8.0 * u_texture_scale + vec2(u_time * 0.003, u_time * 0.0024);
        vec2 scrolledUvB = vUv * 12.0 * u_texture_scale + vec2(u_time * -0.0018, u_time * 0.0036);
        vec2 scrolledUvC = vUv * 15.0 * u_texture_scale + vec2(u_time * 0.0012, u_time * -0.0021);
        vec2 foamUv = vUv * 25.0 + vec2(u_time * 0.015, u_time * 0.009);
        
        vec3 normalSampleA = texture2D(u_normal_map, scrolledUvA).rgb;
        vec3 normalSampleB = texture2D(u_normal_map, scrolledUvB).rgb;
        vec3 normalSampleC = texture2D(u_normal_map, scrolledUvC).rgb;
        vec3 normalA = normalize(normalSampleA * 2.0 - 1.0);
        vec3 normalB = normalize(normalSampleB * 2.0 - 1.0);
        vec3 normalC = normalize(normalSampleC * 2.0 - 1.0);
        vec3 blendedNormal = normalize(normalA + normalB * 0.5 + normalC * 0.3);
        vec3 perturbedNormal = normalize(mix(vWorldNormal, blendedNormal, u_normal_scale * 0.3));
        
        // Depth zones with proper per-fragment depth calculation
        // 0 - 1.5   : shallow
        // 1.5 - 2.0 : transition
        // > 2.0     : deep
        float shallowFactor2 = clamp(local_depth / 1.5, 0.0, 1.0);
        float transitionFactor = smoothstep(1.5, 2.0, local_depth);
        float deepFactor = step(2.0, local_depth);

        // Base color
        vec3 waterBaseColor = mix(u_shallow_color.rgb, u_deep_color.rgb, transitionFactor);

        // Transparency / alpha
        float alpha;
        if (local_depth <= 1.5) {
            alpha = mix(0.3, 0.8, shallowFactor2);  // fade in shallow
        } else if (local_depth <= 2.0) {
            alpha = mix(0.8, 1.0, transitionFactor); // transition zone
        } else {
            alpha = 1.0; // full opacity deep
        }
        
        vec3 viewDir = normalize(vViewPosition);
        float fresnel = pow(1.0 - max(dot(viewDir, perturbedNormal), 0.0), 1.5);
        vec3 reflectedDir = reflect(-viewDir, perturbedNormal);
        vec2 skyUv = reflectedDir.xz * 0.5 + 0.5;
        vec3 skyColor = texture2D(u_sky_reflection, skyUv).rgb;
        vec3 halfVector = normalize(u_sun_direction + viewDir);
        float specular = pow(max(dot(perturbedNormal, halfVector), 0.0), u_shininess);
        vec3 specularColor = u_sun_color * specular;
        vec3 foamTexColor = texture2D(u_foam_texture, foamUv).rgb;
        
        float shorelineFoamFactor = smoothstep(0.0, 1.0, local_depth);
        float foam = shorelineFoamFactor * smoothstep(u_foam_threshold, u_foam_threshold + 0.3, vWaveSlope);
        float foamNoise = sin(vWaveSlope * 10.0 + u_time * 3.0) * 0.5 + 0.5;
        foam *= foamNoise * 0.5 + 0.5;
        
        vec2 causticsUv1 = vUv * 6.0 + vec2(u_time * 0.002, u_time * 0.0015);
        vec2 causticsUv2 = vUv * 8.5 + vec2(u_time * -0.0012, u_time * 0.0018);
        vec3 caustics1 = texture2D(u_caustics_texture, causticsUv1).rgb;
        vec3 caustics2 = texture2D(u_caustics_texture, causticsUv2).rgb;
        vec3 causticsColor = mix(caustics1, caustics2, 0.5);
        float causticsIntensity = (1.0 - local_depth) * 0.3;
        causticsIntensity *= sin(u_time * 1.5) * 0.3 + 0.7;
        
        vec3 finalColor = waterBaseColor;
        finalColor = mix(finalColor, skyColor, fresnel * 0.4);
        finalColor += specularColor * 0.6;
        finalColor += causticsColor * causticsIntensity * vec3(0.8, 1.0, 0.9);
        finalColor = mix(finalColor, foamTexColor * u_foam_color.rgb, foam * 0.8);
        alpha = mix(alpha, 1.0, foam * 0.5);
        
        gl_FragColor = vec4(finalColor, alpha);
    }
`;

// --- JavaScript Class ---
export class WaterRenderer {
    constructor(scene = null, waterLevel = 0.9, terrainRenderer = null) {
        this.scene = scene || this.createTestScene();
        this.waterLevel = waterLevel;
        this.terrainRenderer = terrainRenderer; 
        this.waterChunks = new Map(); // NEW: Store water chunks
        this.sharedMaterial = null; // NEW: Shared material for all chunks
        this.uniforms = {};
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
        const terrainGeometry = new THREE.PlaneGeometry(200, 200);
        const terrainMaterial = new THREE.MeshLambertMaterial({ color: 0x228B22 });
        const terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
        terrainMesh.rotation.x = -Math.PI / 2;
        terrainMesh.position.y = 0;
        scene.add(terrainMesh);
        return scene;
    }

    init() {
        const textureLoader = new THREE.TextureLoader();
        
        const normalMap = textureLoader.load('./terrain/water_normal.png');
        const skyReflection = textureLoader.load('./terrain/sky_reflection.png');
        const foamTexture = textureLoader.load('./terrain/foam.png');
        const causticsTexture = textureLoader.load('./terrain/caustics.png');
        
        normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
        skyReflection.wrapS = skyReflection.wrapT = THREE.RepeatWrapping;
        foamTexture.wrapS = foamTexture.wrapT = THREE.RepeatWrapping;
        causticsTexture.wrapS = causticsTexture.wrapT = THREE.RepeatWrapping;
        
        const shallowColor = new THREE.Color(0x000d67);
        const deepColor = new THREE.Color(0x000A40);
        const foamColor = new THREE.Color(0xffffff);
        
        // Get terrain generation parameters from CONFIG
        const noiseConfig = CONFIG.TERRAIN.noise;
        
        this.uniforms = {
            // Terrain generation uniforms
            u_terrain_seed: { value: CONFIG.TERRAIN.seed },
            u_base_amplitude: { value: noiseConfig.baseAmplitude },
            u_base_frequency: { value: noiseConfig.baseFrequency },
            u_base_octaves: { value: noiseConfig.baseOctaves },
            u_mountain_amplitude: { value: noiseConfig.mountainAmplitude },
            u_mountain_frequency: { value: noiseConfig.mountainFrequency },
            u_mountain_octaves: { value: noiseConfig.mountainOctaves },
            u_mountain_scale: { value: noiseConfig.mountainScale },
            u_mask_frequency: { value: noiseConfig.maskFrequency },
            u_jagged_frequency1: { value: noiseConfig.jaggedFrequency1 },
            u_jagged_amplitude1: { value: noiseConfig.jaggedAmplitude1 },
            u_jagged_frequency2: { value: noiseConfig.jaggedFrequency2 },
            u_jagged_amplitude2: { value: noiseConfig.jaggedAmplitude2 },
            u_jagged_noise_offset1: { value: noiseConfig.jaggedNoiseOffset1 },
            u_jagged_noise_offset2: { value: noiseConfig.jaggedNoiseOffset2 },
            
            // Water rendering uniforms
            u_time: { value: 0.0 },
            u_shallow_color: { value: new THREE.Vector4(shallowColor.r, shallowColor.g, shallowColor.b, 1.0) },
            u_deep_color: { value: new THREE.Vector4(deepColor.r, deepColor.g, deepColor.b, 1.0) },
            u_foam_color: { value: new THREE.Vector4(foamColor.r, foamColor.g, foamColor.b, 1.0) },
            u_wave_height: { value: 0.01 },
            u_wave_frequency: { value: 0.1 },
            u_normal_map: { value: normalMap },
            u_sky_reflection: { value: skyReflection },
            u_foam_texture: { value: foamTexture },
            u_caustics_texture: { value: causticsTexture },
            u_normal_scale: { value: 2.0 },
            u_transparency: { value: 0.5 },
            u_water_level: { value: this.waterLevel },
            u_sun_direction: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
            u_sun_color: { value: new THREE.Color(0xfff8dc) },
            u_shininess: { value: 1.0 },
            u_foam_threshold: { value: 5.0 },
            u_texture_scale: { value: 1 },
            u_chunk_offset: { value: new THREE.Vector2(0, 0) }
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

    // NEW: Add a water chunk at the specified coordinates
    addWaterChunk(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        if (this.waterChunks.has(key)) return;
        console.log(`Adding water chunk at (${chunkX}, ${chunkZ})`);
        const geometry = new THREE.PlaneGeometry(50, 50, 100, 100);
        geometry.rotateX(-Math.PI / 2);
        const material = this.sharedMaterial;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(chunkX, this.waterLevel, chunkZ);
        this.scene.add(mesh);
        this.waterChunks.set(key, mesh);
    }

    // NEW: Remove a water chunk
    removeWaterChunk(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        const mesh = this.waterChunks.get(key);
        if (mesh) {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            this.waterChunks.delete(key);
        }
    }

    // NEW: Clear all water chunks
    clearWaterChunks() {
        this.waterChunks.forEach((mesh, key) => {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
        });
        this.waterChunks.clear();
    }

    setupTestControls() {
        this.updateUniforms = () => {
            if (this.sharedMaterial) this.sharedMaterial.uniforms = this.uniforms;
        };

        const gui = new dat.GUI();
        this.gui = gui;
        
        const waveFolder = gui.addFolder('Waves');
        waveFolder.add(this.uniforms.u_wave_height, 'value', 0.0, 0.2).name('Height').onChange(this.updateUniforms.bind(this));
        waveFolder.add(this.uniforms.u_wave_frequency, 'value', 0.1, 2.0).name('Frequency').onChange(this.updateUniforms.bind(this));

        const colorFolder = gui.addFolder('Colors');
        colorFolder.add(this.uniforms.u_transparency, 'value', 0.0, 1.0).name('Transparency').onChange(this.updateUniforms.bind(this));
        
        const colorControls = {
            shallow: '#4dd0e1',
            deep: '#001f5f',
            foam: '#ffffff'
        };
        
        colorFolder.addColor(colorControls, 'shallow').onChange((val) => {
            const color = new THREE.Color(val);
            this.uniforms.u_shallow_color.value.set(color.r, color.g, color.b, 1.0);
        });
        colorFolder.addColor(colorControls, 'deep').onChange((val) => {
            const color = new THREE.Color(val);
            this.uniforms.u_deep_color.value.set(color.r, color.g, color.b, 1.0);
        });
        colorFolder.addColor(colorControls, 'foam').onChange((val) => {
            const color = new THREE.Color(val);
            this.uniforms.u_foam_color.value.set(color.r, color.g, color.b, 1.0);
        });

        const lightFolder = gui.addFolder('Lighting');
        lightFolder.add(this.uniforms.u_shininess, 'value', 1.0, 256.0).name('Shininess').onChange(this.updateUniforms.bind(this));
        lightFolder.add(this.uniforms.u_foam_threshold, 'value', 0.0, 5.0).name('Foam Threshold').onChange(this.updateUniforms.bind(this));
        lightFolder.add(this.uniforms.u_normal_scale, 'value', 0.0, 2.0).name('Normal Scale').onChange(this.updateUniforms.bind(this));

        const textureFolder = gui.addFolder('Texture Scale');
        textureFolder.add(this.uniforms.u_texture_scale, 'value', 0.5, 5.0).name('Overall Scale').onChange(this.updateUniforms.bind(this));

        // NEW: Add debug controls for water chunks
        const chunkFolder = gui.addFolder('Water Chunks');
        chunkFolder.add({ count: () => this.waterChunks.size }, 'count').name('Chunk Count').listen();
    }

    update(time) {
        this.uniforms.u_time.value = time * 0.001;

        // Update each chunk - much simpler now since terrain height is calculated per-fragment
        this.waterChunks.forEach((mesh, key) => {
            const [chunkX, chunkZ] = key.split(',').map(Number);
            // Only need to update chunk offset - terrain height is calculated in shader
            mesh.material.uniforms.u_chunk_offset.value.set(chunkX, chunkZ);
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

    getTestScene() {
        return this.scene;
    }

    // NEW: Expose water chunks for raycasting
    getWaterChunks() {
        return Array.from(this.waterChunks.values());
    }

    // NEW: Dispose method for cleanup
    dispose() {
        this.clearWaterChunks();
        if (this.sharedMaterial) {
            this.sharedMaterial.dispose();
        }
        if (this.gui) {
            this.gui.destroy();
        }
    }
}
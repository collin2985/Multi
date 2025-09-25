// WaterRenderer.js
import * as THREE from 'three';

const dat = window.dat; 

// --- Vertex Shader ---
const waterVertexShader = `
    uniform float u_time;
    uniform float u_wave_height;
    uniform float u_wave_frequency;
    uniform float u_average_terrain_height;
    uniform float u_water_level;
    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    varying float vWaveHeight;
    varying float vDepth;
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
        float waveDisplacement = 0.0;
        waveDisplacement += wave(pos.xz, u_wave_frequency, 1.5) * 0.5;
        waveDisplacement += wave(pos.xz * 1.8, u_wave_frequency * 1.7, 2.1) * 0.3;
        waveDisplacement += wave(pos.xz * 2.3, u_wave_frequency * 0.9, 1.8) * 0.2;
        pos.y += waveDisplacement * u_wave_height;
        vWaveHeight = waveDisplacement;
        float slopeX = 0.0;
        float slopeZ = 0.0;
        slopeX += waveDerivativeX(pos.xz, u_wave_frequency, 1.5) * 0.5;
        slopeX += waveDerivativeX(pos.xz * 1.8, u_wave_frequency * 1.7, 2.1) * 0.3;
        slopeZ += waveDerivativeZ(pos.xz, u_wave_frequency, 1.5) * 0.5;
        slopeZ += waveDerivativeZ(pos.xz * 1.8, u_wave_frequency * 1.7, 2.1) * 0.3;
        vWaveSlope = length(vec2(slopeX, slopeZ)) * u_wave_height;
        vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
        vWorldPosition = worldPosition.xyz;
        vViewPosition = cameraPosition - worldPosition.xyz;
        vec3 tangentX = vec3(1.0, slopeX * u_wave_height, 0.0);
        vec3 tangentZ = vec3(0.0, slopeZ * u_wave_height, 1.0);
        vWorldNormal = normalize(cross(tangentX, tangentZ));
        vDepth = u_water_level - u_average_terrain_height + vWaveHeight * u_wave_height;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
`;

// --- Fragment Shader ---
const waterFragmentShader = `
    precision highp float;
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
    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    varying float vWaveHeight;
    varying float vDepth;
    varying float vWaveSlope;
    
    void main() {
        vec2 scrolledUvA = vUv * 8.0 * u_texture_scale + vec2(u_time * 0.001, u_time * 0.0008);
        vec2 scrolledUvB = vUv * 12.0 * u_texture_scale + vec2(u_time * -0.0006, u_time * 0.0012);
        vec2 scrolledUvC = vUv * 15.0 * u_texture_scale + vec2(u_time * 0.0004, u_time * -0.0007);
        vec3 normalSampleA = texture2D(u_normal_map, scrolledUvA).rgb;
        vec3 normalSampleB = texture2D(u_normal_map, scrolledUvB).rgb;
        vec3 normalSampleC = texture2D(u_normal_map, scrolledUvC).rgb;
        vec3 normalA = normalize(normalSampleA * 2.0 - 1.0);
        vec3 normalB = normalize(normalSampleB * 2.0 - 1.0);
        vec3 normalC = normalize(normalSampleC * 2.0 - 1.0);
        vec3 blendedNormal = normalize(normalA + normalB * 0.5 + normalC * 0.3);
        vec3 perturbedNormal = normalize(mix(vWorldNormal, blendedNormal, u_normal_scale * 0.3));
        float depth = smoothstep(0.01, 0.5 vDepth); // <-- CHANGED RANGE
        depth = clamp(depth, 0.0, 1.0);
        vec3 waterBaseColor = mix(u_shallow_color.rgb, u_deep_color.rgb, depth);
        vec3 viewDir = normalize(vViewPosition);
        float fresnel = pow(1.0 - max(dot(viewDir, perturbedNormal), 0.0), 1.5);
        vec3 reflectedDir = reflect(-viewDir, perturbedNormal);
        vec2 skyUv = reflectedDir.xz * 0.5 + 0.5;
        vec3 skyColor = texture2D(u_sky_reflection, skyUv).rgb;
        vec3 halfVector = normalize(u_sun_direction + viewDir);
        float specular = pow(max(dot(perturbedNormal, halfVector), 0.0), u_shininess);
        vec3 specularColor = u_sun_color * specular;
        float foam = smoothstep(u_foam_threshold, u_foam_threshold + 0.3, vWaveSlope);
        vec2 foamUv = vUv * 25.0 + vec2(u_time * 0.005, u_time * 0.003);
        vec3 foamTexColor = texture2D(u_foam_texture, foamUv).rgb;
        float foamNoise = sin(vWaveSlope * 10.0 + u_time * 3.0) * 0.5 + 0.5;
        foam *= foamNoise * 0.5 + 0.5;
        vec2 causticsUv1 = vUv * 6.0 + vec2(u_time * 0.002, u_time * 0.0015);
        vec2 causticsUv2 = vUv * 8.5 + vec2(u_time * -0.0012, u_time * 0.0018);
        vec3 caustics1 = texture2D(u_caustics_texture, causticsUv1).rgb;
        vec3 caustics2 = texture2D(u_caustics_texture, causticsUv2).rgb;
        vec3 causticsColor = mix(caustics1, caustics2, 0.5);
        float causticsIntensity = (1.0 - depth) * 0.3;
        causticsIntensity *= sin(u_time * 1.5) * 0.3 + 0.7;
        vec3 finalColor = waterBaseColor;
        finalColor = mix(finalColor, skyColor, fresnel * 0.4);
        finalColor += specularColor * 0.6;
        finalColor += causticsColor * causticsIntensity * vec3(0.8, 1.0, 0.9);
        finalColor = mix(finalColor, foamTexColor * u_foam_color.rgb, foam * 0.8);
        float alpha = mix(u_transparency, 0.9, depth);
        alpha = mix(alpha, 1.0, foam * 0.5);
        gl_FragColor = vec4(finalColor, alpha);
    }
`;

// --- JavaScript Class ---
export class WaterRenderer {
    constructor(scene = null, waterLevel = 2, terrainRenderer = null ) {
        this.scene = scene || this.createTestScene();
        this.waterLevel = waterLevel;
        this.terrainRenderer = terrainRenderer; 
        this.mesh = null;
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
        const geometry = new THREE.PlaneGeometry(200, 200, 128, 128);
        const textureLoader = new THREE.TextureLoader();
        
        const normalMap = textureLoader.load('./terrain/water_normal.png');
        const skyReflection = textureLoader.load('./terrain/sky_reflection.png');
        const foamTexture = textureLoader.load('./terrain/foam.png');
        const causticsTexture = textureLoader.load('./terrain/caustics.png');
        
        normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
        skyReflection.wrapS = skyReflection.wrapT = THREE.RepeatWrapping;
        foamTexture.wrapS = foamTexture.wrapT = THREE.RepeatWrapping;
        causticsTexture.wrapS = causticsTexture.wrapT = THREE.RepeatWrapping;
        
        const shallowColor = new THREE.Color(0x4dd0e1);
        const deepColor = new THREE.Color(0x001f5f);
        const foamColor = new THREE.Color(0xffffff);
        
        this.uniforms = {
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
            u_average_terrain_height: { value: 0.0 },
            u_texture_scale: { value: 2.4 }
        };
        
        const material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: waterVertexShader,
            fragmentShader: waterFragmentShader,
            transparent: true,
            fog: false,
            side: THREE.DoubleSide,
            defines: {}
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.rotation.x = -Math.PI / 2;
        this.mesh.position.y = this.waterLevel;
        this.scene.add(this.mesh);
    }

    setupTestControls() {
        this.updateUniforms = () => {
            if (this.mesh) this.mesh.material.uniforms = this.uniforms;
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
    }

update(time) {
        if (this.mesh) {
            this.uniforms.u_time.value = time * 0.001;
            
            // --- MODIFIED LOGIC START ---
            let currentTerrainHeight = 0.0;
            if (this.terrainRenderer) {
                // Get terrain height at the center of the water plane.
                // For a proper implementation, this should be the height under the camera.
                currentTerrainHeight = this.terrainRenderer.getTerrainHeightAt(
                    this.mesh.position.x, 
                    this.mesh.position.z
                );
            }
            this.uniforms.u_average_terrain_height.value = currentTerrainHeight; // <-- USE DYNAMIC HEIGHT
            // --- MODIFIED LOGIC END ---
        }
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

    getMesh() {
        return this.mesh;
    }
}
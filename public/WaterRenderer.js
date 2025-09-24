// WaterRenderer.js
import * as THREE from 'three';

// Enhanced vertex shader with wave displacement
const waterVertexShader = `
    uniform float u_time;
    uniform float u_wave_height;
    uniform float u_wave_frequency;
    uniform float u_average_terrain_height;
    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    varying float vWaveHeight;
    varying float vDepth;

    // Simple wave function for surface displacement
    float wave(vec2 pos, float freq, float speed) {
        return sin(pos.x * freq + u_time * speed) * cos(pos.y * freq * 0.7 + u_time * speed * 0.8);
    }

    void main() {
        vUv = uv;
        
        vec3 pos = position;
        
        // Add multiple wave layers for more realistic water movement
        float waveDisplacement = 0.0;
        waveDisplacement += wave(pos.xz, u_wave_frequency, 2.0) * 0.4;
        waveDisplacement += wave(pos.xz * 1.5, u_wave_frequency * 1.3, 1.5) * 0.3;
        waveDisplacement += wave(pos.xz * 2.1, u_wave_frequency * 0.8, 2.5) * 0.2;
        
        pos.y += waveDisplacement * u_wave_height;
        vWaveHeight = waveDisplacement;
        
        vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
        vWorldPosition = worldPosition.xyz;
        vViewPosition = cameraPosition - worldPosition.xyz;
        
        // Calculate normal for lighting (approximate)
        vWorldNormal = normalize(vec3(
            -u_wave_height * u_wave_frequency * cos(pos.x * u_wave_frequency + u_time * 2.0),
            1.0,
            -u_wave_height * u_wave_frequency * cos(pos.z * u_wave_frequency + u_time * 2.0)
        ));

        // Calculate depth using average terrain height
        vDepth = u_water_level - u_average_terrain_height + vWaveHeight * u_wave_height;
        
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
`;

const waterFragmentShader = `
    uniform float u_time;
    uniform vec3 u_shallow_color;
    uniform vec3 u_deep_color;
    uniform vec3 u_foam_color;
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
    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    varying float vWaveHeight;
    varying float vDepth;

    void main() {
        // --- 1. Enhanced Normal Mapping ---
        vec2 scrolledUvA = vUv * 8.0 + vec2(u_time * 0.02, u_time * 0.015);
        vec2 scrolledUvB = vUv * 6.0 + vec2(u_time * -0.018, u_time * 0.012);
        vec2 scrolledUvC = vUv * 12.0 + vec2(u_time * 0.01, u_time * -0.008);

        vec3 normalSampleA = texture2D(u_normal_map, scrolledUvA).rgb;
        vec3 normalSampleB = texture2D(u_normal_map, scrolledUvB).rgb;
        vec3 normalSampleC = texture2D(u_normal_map, scrolledUvC).rgb;
        
        vec3 normalA = normalize(normalSampleA * 2.0 - 1.0);
        vec3 normalB = normalize(normalSampleB * 2.0 - 1.0);
        vec3 normalC = normalize(normalSampleC * 2.0 - 1.0);
        
        vec3 blendedNormal = normalize(normalA + normalB * 0.7 + normalC * 0.5);
        vec3 perturbedNormal = normalize(mix(vWorldNormal, blendedNormal, u_normal_scale));

        // --- 2. Depth-Based Color Variation ---
        float depth = clamp(vDepth / 20.0, 0.0, 1.0);
        
        // Color transition from shallow turquoise to deep blue
        vec3 waterBaseColor = mix(u_shallow_color, u_deep_color, depth);

        // --- 3. Enhanced Fresnel Effect ---
        vec3 viewDir = normalize(vViewPosition);
        float fresnel = pow(1.0 - max(dot(viewDir, perturbedNormal), 0.0), 2.0);
        
        // --- 4. Reflection ---
        vec3 reflectedDir = reflect(-viewDir, perturbedNormal);
        vec2 skyUv = reflectedDir.xz * 0.5 + 0.5;
        vec3 skyColor = texture2D(u_sky_reflection, skyUv).rgb;

        // --- 5. Specular Highlights (Sun Reflection) ---
        vec3 halfVector = normalize(u_sun_direction + viewDir);
        float specular = pow(max(dot(perturbedNormal, halfVector), 0.0), u_shininess);
        vec3 specularColor = u_sun_color * specular;

        // --- 6. Foam Effect with Texture ---
        float waveIntensity = abs(vWaveHeight);
        float foam = smoothstep(u_foam_threshold - 0.1, u_foam_threshold + 0.1, waveIntensity);
        // Apply foam texture in shallow areas and wave crests
        vec2 foamUv = vUv * 8.0 + vec2(u_time * 0.01, u_time * 0.005);
        vec3 foamColor = texture2D(u_foam_texture, foamUv).rgb;
        foam *= (1.0 - depth) * 0.5 + 0.5; // More foam in shallow areas
        
        // --- 7. Caustics Effect with Texture ---
        vec2 causticsUv = vUv * 10.0 + vec2(u_time * 0.03, u_time * 0.02);
        vec3 causticsColor = texture2D(u_caustics_texture, causticsUv).rgb;
        float causticsIntensity = causticsColor.r * (1.0 - depth); // Caustics stronger in shallow areas

        // --- 8. Final Color Composition ---
        vec3 finalColor = waterBaseColor;
        finalColor = mix(finalColor, skyColor, fresnel * 0.6);
        finalColor += specularColor * 0.8;
        finalColor += causticsColor * causticsIntensity * vec3(0.2, 0.4, 0.4);
        finalColor = mix(finalColor, foamColor, foam * 0.7);

        // --- 9. Transparency ---
        float alpha = mix(u_transparency, 1.0, depth);
        alpha = mix(alpha, 1.0, foam);

        gl_FragColor = vec4(finalColor, alpha);
    }
`;

export class WaterRenderer {
    constructor(scene, waterLevel = 0, terrainRenderer) {
        this.scene = scene;
        this.waterLevel = waterLevel;
        this.terrainRenderer = terrainRenderer; // Store reference
        this.mesh = null;
        this.uniforms = {};

        this.init();
    }

    init() {
        // Create a larger, more detailed plane
        const geometry = new THREE.PlaneGeometry(6000, 6000, 256, 256);
        
        const textureLoader = new THREE.TextureLoader();
        const normalMap = textureLoader.load('./terrain/water_normal.png');
        const skyReflection = textureLoader.load('./terrain/sky_reflection.png');
        const foamTexture = textureLoader.load('./terrain/foam.png');
        const causticsTexture = textureLoader.load('./terrain/caustics.png');

        normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
        skyReflection.wrapS = skyReflection.wrapT = THREE.RepeatWrapping;
        foamTexture.wrapS = foamTexture.wrapT = THREE.RepeatWrapping;
        causticsTexture.wrapS = causticsTexture.wrapT = THREE.RepeatWrapping;

        // Enhanced uniforms for realistic water
        this.uniforms = {
            u_time: { value: 0.0 },
            u_shallow_color: { value: new THREE.Color(0x4dd0e1) }, // Bright turquoise
            u_deep_color: { value: new THREE.Color(0x0d47a1) },    // Deep ocean blue
            u_foam_color: { value: new THREE.Color(0xffffff) },    // White foam (fallback)
            u_wave_height: { value: 0.8 },
            u_wave_frequency: { value: 0.02 },
            u_normal_map: { value: normalMap },
            u_sky_reflection: { value: skyReflection },
            u_foam_texture: { value: foamTexture },
            u_caustics_texture: { value: causticsTexture },
            u_normal_scale: { value: 0.4 },
            u_transparency: { value: 0.7 },
            u_water_level: { value: this.waterLevel },
            u_sun_direction: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
            u_sun_color: { value: new THREE.Color(0xfff8dc) },
            u_shininess: { value: 64.0 },
            u_foam_threshold: { value: 0.6 },
            u_average_terrain_height: { value: 0.0 } // Uniform for depth
        };

        const material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: waterVertexShader,
            fragmentShader: waterFragmentShader,
            transparent: true,
            fog: false,
            side: THREE.DoubleSide
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.rotation.x = -Math.PI / 2;
        this.mesh.position.y = this.waterLevel;

        this.scene.add(this.mesh);
    }

    update(time) {
        if (this.mesh) {
            this.uniforms.u_time.value = time * 0.001;

            // Sample terrain heights for loaded chunks
            const chunkSize = 50;
            const loadedChunks = Array.from(this.terrainRenderer.terrainChunks.keys());
            let totalHeight = 0;
            let count = 0;

            for (const chunkKey of loadedChunks) {
                const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
                const worldX = chunkX * chunkSize;
                const worldZ = chunkZ * chunkSize;
                const height = this.terrainRenderer.getTerrainHeightAt(worldX, worldZ);
                if (height !== undefined) {
                    totalHeight += height;
                    count++;
                }
            }

            this.uniforms.u_average_terrain_height.value = count > 0 ? totalHeight / count : 0;
        }
    }

    updateColors(colors) {
        if (colors.shallow_color) this.uniforms.u_shallow_color.value.setHex(colors.shallow_color);
        if (colors.deep_color) this.uniforms.u_deep_color.value.setHex(colors.deep_color);
        if (colors.foam_color) this.uniforms.u_foam_color.value.setHex(colors.foam_color);
    }

    updateSunLighting(direction, color) {
        this.uniforms.u_sun_direction.value.copy(direction.normalize());
        this.uniforms.u_sun_color.value.setHex(color);
    }

    updateWaves(height, frequency) {
        this.uniforms.u_wave_height.value = height;
        this.uniforms.u_wave_frequency.value = frequency;
    }

    getWaterHeightAt(x, z, time) {
        const freq = this.uniforms.u_wave_frequency.value;
        const height = this.uniforms.u_wave_height.value;
        
        let waveHeight = 0;
        waveHeight += Math.sin(x * freq + time * 2.0) * Math.cos(z * freq * 0.7 + time * 1.6) * 0.4;
        waveHeight += Math.sin(x * freq * 1.5 + time * 1.5) * Math.cos(z * freq * 0.91 + time * 1.2) * 0.3;
        waveHeight += Math.sin(x * freq * 2.1 + time * 2.5) * Math.cos(z * freq * 1.47 + time * 2.0) * 0.2;
        
        return this.waterLevel + waveHeight * height;
    }
}
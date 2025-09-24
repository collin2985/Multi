// public/WaterRenderer.js
import * as THREE from 'three'; // Assumes 'three' is mapped correctly in your import map/script setup

// --- SHADER CODE: Vertex and Fragment Shaders for Animated Water ---

const waterVertexShader = `
    uniform float u_time;
    uniform float u_ripple_scale;
    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vWorldNormal;

    void main() {
        vUv = uv;
        
        // Calculate the world position and view position for reflections/fresnel
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vViewPosition = -worldPosition.xyz;
        vWorldNormal = normalize(modelViewMatrix * vec4(normal, 0.0)).xyz;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const waterFragmentShader = `
    uniform float u_time;
    uniform vec3 u_water_color;
    uniform sampler2D u_normal_map;
    uniform sampler2D u_sky_reflection;
    uniform float u_normal_scale;

    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vWorldNormal;

    void main() {
        // --- 1. Animation: Scrolling the Normal Map ---
        // Scroll the normal map in two different directions and speeds
        // The scale of 5.0 determines how often the pattern repeats across the water plane
        vec2 scrolledUvA = vUv * 5.0 + vec2(u_time * 0.015, u_time * 0.01);
        vec2 scrolledUvB = vUv * 5.0 + vec2(u_time * -0.012, u_time * 0.008);

        // Sample the two normals and blend them for an organic ripple look
        vec3 normalSampleA = texture2D(u_normal_map, scrolledUvA).rgb;
        vec3 normalSampleB = texture2D(u_normal_map, scrolledUvB).rgb;
        
        // Convert the normals from [0, 1] to [-1, 1] space and blend them
        vec3 normalA = normalize(normalSampleA * 2.0 - 1.0);
        vec3 normalB = normalize(normalSampleB * 2.0 - 1.0);
        
        // Use the average of the two perturbed normals
        vec3 perturbedNormal = normalize(normalA + normalB) * u_normal_scale;

        // --- 2. Reflection: Fresnel and Sky Texture (The Dramatic Effect) ---
        // Calculate the Fresnel effect: controls reflection intensity based on viewing angle.
        // reflection is high when looking towards the horizon (low dot product)
        float viewAngleDot = dot(normalize(vViewPosition), perturbedNormal);
        float fresnel = pow(1.0 - abs(viewAngleDot), 3.5); // 3.5 is a common power for water

        // Calculate reflection vector using the perturbed normal
        vec3 reflectedDir = reflect(normalize(vViewPosition), perturbedNormal);
        
        // Create UVs for the sky texture mapping (simple projection)
        vec2 skyUv = reflectedDir.xz * 0.5 + 0.5;

        // Sample the sky texture for a generic reflection
        vec3 skyColor = texture2D(u_sky_reflection, skyUv).rgb;

        // --- 3. Final Color Combination ---
        // Base color (deep blue-green tone)
        vec3 waterBaseColor = u_water_color;

        // Mix the sky reflection with the base color using the fresnel factor
        vec3 finalColor = mix(waterBaseColor, skyColor, fresnel);

        // Visibility set to 1.0 (fully opaque) for now, but ready for depth-based transparency if needed later.
        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

// --- WaterRenderer Class ---

export class WaterRenderer {
    constructor(scene, waterLevel = 1) {
        this.scene = scene;
        this.waterLevel = waterLevel;
        this.mesh = null;
        this.uniforms = {};

        this.init();
    }

    init() {
        // Create a massive plane to cover the entire terrain area
        const geometry = new THREE.PlaneGeometry(5000, 5000, 128, 128);
        
        // Load the textures from the terrain folder
        const textureLoader = new THREE.TextureLoader();
        const normalMap = textureLoader.load('./terrain/water_normal.png');
        const skyReflection = textureLoader.load('./terrain/sky_reflection.png');

        // Set up the textures to repeat seamlessly for tiling
        normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
        skyReflection.wrapS = skyReflection.wrapT = THREE.RepeatWrapping;

        // Define initial shader uniforms
        this.uniforms = {
            u_time: { value: 0.0 },
            u_water_color: { value: new THREE.Color(0x184260) }, // Deep, murky blue-green tone
            u_normal_map: { value: normalMap },
            u_sky_reflection: { value: skyReflection },
            u_normal_scale: { value: 0.5 } // Controls the intensity of the ripples
        };

        // Create the Shader Material
        const material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: waterVertexShader,
            fragmentShader: waterFragmentShader,
            transparent: true,
            fog: false,        
            lights: false,     
        });

        // Create the Mesh
        this.mesh = new THREE.Mesh(geometry, material);
        
        // Rotate the plane to face up
        this.mesh.rotation.x = -Math.PI / 2; 

        // Set the water level at y = -2
        this.mesh.position.y = this.waterLevel;

        this.scene.add(this.mesh);
    }

    /**
     * Updates the water animation in the main game loop.
     * @param {number} time The current game time (in milliseconds from performance.now()).
     */
    update(time) {
        if (this.mesh) {
            this.uniforms.u_time.value = time * 0.001; // Convert ms to seconds
        }
    }
}
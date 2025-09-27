// WaterRenderer.js - Optimized Version
import * as THREE from 'three';

// --- Simplified Water Vertex Shader (Reduced calculations) ---
const waterVertexShader = `
    uniform float u_time;
    uniform float u_wave_height;
    uniform float u_wave_frequency;
    uniform vec2 u_chunk_offset;
    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vWorldPosition;
    varying float vWaveHeight;

    // Simplified wave function - only 2 octaves instead of 3
    float wave(vec2 pos, float freq, float speed) {
        return sin(pos.x * freq + u_time * speed) * cos(pos.y * freq * 0.7 + u_time * speed * 0.8);
    }

    void main() {
        vUv = uv;
        vec3 pos = position;
        
        // Apply chunk offset for wave calculations
        vec2 worldPos = pos.xz + u_chunk_offset;
        
        // Simplified wave displacement - reduced from 3 to 2 waves
        float waveDisplacement = 0.0;
        waveDisplacement += wave(worldPos, u_wave_frequency, 0.5) * 0.6;
        waveDisplacement += wave(worldPos * 1.8, u_wave_frequency * 1.7, 0.7) * 0.4;
        
        pos.y += waveDisplacement * u_wave_height;
        vWaveHeight = waveDisplacement;
        
        // Transform to world space
        vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
        vWorldPosition = worldPosition.xyz;
        vViewPosition = cameraPosition - worldPosition.xyz;
        
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
`;

// --- Simplified Water Fragment Shader ---
const waterFragmentShader = `
    precision mediump float; // Changed from highp to mediump for better performance
    
    uniform float u_time;
    uniform vec4 u_shallow_color;
    uniform vec4 u_deep_color;
    uniform vec4 u_foam_color;
    uniform sampler2D u_height_texture;
    uniform float u_water_level;
    uniform float u_chunk_size;
    uniform vec2 u_chunk_offset;
    
    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vWorldPosition;
    varying float vWaveHeight;

    float sampleTerrainHeight(vec2 worldPos) {
        vec2 localPos = worldPos - u_chunk_offset;
        vec2 uv = (localPos / u_chunk_size) + 0.5;
        uv = clamp(uv, 0.001, 0.999);
        float heightNormalized = texture2D(u_height_texture, uv).r;
        return mix(-10.0, 80.0, heightNormalized);
    }

    void main() {
        // Sample terrain height
        float terrainHeight = sampleTerrainHeight(vWorldPosition.xz);
        float depth = vWorldPosition.y - terrainHeight;
        
        // Discard fragments below terrain
        if (depth < 0.0) discard;
        
        // Simplified depth-based color and transparency
        float shallowFactor = clamp(depth / 0.4, 0.0, 1.0);
        vec3 waterBaseColor = mix(u_shallow_color.rgb, u_deep_color.rgb, shallowFactor);
        
        // Simplified transparency
        float alpha = depth <= 0.1 ? smoothstep(0.0, 0.1, depth) * 0.3 : 
                     depth <= 0.2 ? mix(0.3, 0.8, smoothstep(0.1, 0.2, depth)) : 0.8;
        
        // Simple foam based on depth only (removed complex noise calculations)
        float foam = depth < 0.05 ? (1.0 - depth / 0.05) * 0.5 : 0.0;
        
        // Simplified final color mixing
        vec3 finalColor = mix(waterBaseColor, u_foam_color.rgb, foam);
        alpha = mix(alpha, 1.0, foam * 0.3);
        
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
        this.heightTextures = new Map();
        this.gui = null;
        
        // Performance optimization: Reduce update frequency
        this.lastUpdateTime = 0;
        this.updateInterval = 16; // ~60fps cap instead of unlimited
        
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

    init() {
        this.createSharedMaterial();
    }

    createSharedMaterial() {
        // Create a simple default height texture
        const defaultHeightTexture = this.createDefaultHeightTexture();
        
        const shallowColor = new THREE.Color(0x85997F);
        const deepColor = new THREE.Color(0x001f5f);
        const foamColor = new THREE.Color(0xffffff);
        
        this.uniforms = {
            // Time and animation
            u_time: { value: 0.0 },
            
            // Wave parameters - reduced for better performance
            u_wave_height: { value: 0.005 }, // Reduced from 0.01
            u_wave_frequency: { value: 0.015 }, // Reduced from 0.02
            
            // Colors
            u_shallow_color: { value: new THREE.Vector4(shallowColor.r, shallowColor.g, shallowColor.b, 1.0) },
            u_deep_color: { value: new THREE.Vector4(deepColor.r, deepColor.g, deepColor.b, 1.0) },
            u_foam_color: { value: new THREE.Vector4(foamColor.r, foamColor.g, foamColor.b, 1.0) },
            
            // Textures - only height texture now
            u_height_texture: { value: defaultHeightTexture },
            
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
            // Performance optimizations
            depthWrite: false, // Disable depth writing for transparent water
            blending: THREE.NormalBlending
        });
    }

    createDefaultHeightTexture() {
        // Smaller texture size for better performance
        const size = 32; // Reduced from 64
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

    generateHeightTexture(chunkX, chunkZ, heightCalculator) {
        // Reduced texture size for better performance
        const size = 64; // Reduced from 128
        const chunkSize = 50;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(size, size);
        const data = imgData.data;
        
        const minHeight = -10;
        const maxHeight = 80;
        const heightRange = maxHeight - minHeight;
        
        // Sample every 2nd pixel for performance (reduces calculations by 75%)
        for (let y = 0; y < size; y += 2) {
            for (let x = 0; x < size; x += 2) {
                const worldX = chunkX - chunkSize/2 + (x / size) * chunkSize;
                const worldZ = chunkZ - chunkSize/2 + (y / size) * chunkSize;
                
                const height = heightCalculator.calculateHeight(worldX, worldZ);
                const normalizedHeight = Math.max(0, Math.min(1, (height - minHeight) / heightRange));
                const heightValue = Math.floor(normalizedHeight * 255);
                
                // Fill 2x2 pixel block with same value
                for (let dy = 0; dy < 2 && y + dy < size; dy++) {
                    for (let dx = 0; dx < 2 && x + dx < size; dx++) {
                        const index = ((y + dy) * size + (x + dx)) * 4;
                        data[index] = heightValue;
                        data[index + 1] = heightValue;
                        data[index + 2] = heightValue;
                        data[index + 3] = 255;
                    }
                }
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
        
        // Reduced geometry resolution for better performance
        const geometry = new THREE.PlaneGeometry(50, 50, 32, 32); // Reduced from 64x64
        geometry.rotateX(-Math.PI / 2);
        
        // Use shared material instead of cloning for better performance
        const material = this.sharedMaterial;
        
        // Create mesh
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(chunkX, this.waterLevel, chunkZ);
        
        // Store chunk-specific data separately
        mesh.userData = {
            chunkOffset: new THREE.Vector2(chunkX, chunkZ),
            heightTexture: heightTexture || this.uniforms.u_height_texture.value
        };
        
        this.scene.add(mesh);
        this.waterChunks.set(key, mesh);
        
        if (heightTexture) {
            this.heightTextures.set(key, heightTexture);
        }
        
        console.log(`Water chunk added successfully at (${chunkX}, ${chunkZ})`);
    }

    removeWaterChunk(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        const mesh = this.waterChunks.get(key);
        
        if (mesh) {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            // Don't dispose material since it's shared
            this.waterChunks.delete(key);
            
            // Clean up height texture
            const heightTexture = this.heightTextures.get(key);
            if (heightTexture && heightTexture !== this.uniforms.u_height_texture.value) {
                heightTexture.dispose();
                this.heightTextures.delete(key);
            }
            
            console.log(`Water chunk removed at (${chunkX}, ${chunkZ})`);
        }
    }

    clearWaterChunks() {
        this.waterChunks.forEach((mesh, key) => {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
        });
        this.waterChunks.clear();
        
        // Clean up height textures
        this.heightTextures.forEach((texture) => {
            if (texture !== this.uniforms.u_height_texture.value) {
                texture.dispose();
            }
        });
        this.heightTextures.clear();
    }

    update(time) {
        // Throttle updates for better performance
        if (time - this.lastUpdateTime < this.updateInterval) {
            return;
        }
        this.lastUpdateTime = time;
        
        // Update time uniform only if material exists
        if (this.sharedMaterial && this.sharedMaterial.uniforms.u_time) {
            this.sharedMaterial.uniforms.u_time.value = time * 0.001;
            
            // Update chunk-specific uniforms before rendering
            // This is a simplified approach - in a full implementation you'd want
            // to handle this per-chunk during rendering
            if (this.waterChunks.size > 0) {
                const firstChunk = this.waterChunks.values().next().value;
                if (firstChunk && firstChunk.userData) {
                    this.sharedMaterial.uniforms.u_chunk_offset.value.copy(firstChunk.userData.chunkOffset);
                    this.sharedMaterial.uniforms.u_height_texture.value = firstChunk.userData.heightTexture;
                }
            }
        }
    }

    getWaterHeightAt(x, z, time) {
        const freq = this.uniforms.u_wave_frequency.value;
        const height = this.uniforms.u_wave_height.value;
        
        // Simplified wave calculation
        let waveHeight = 0;
        waveHeight += Math.sin(x * freq + time * 1.5) * Math.cos(z * freq * 0.7 + time * 1.2) * 0.6;
        waveHeight += Math.sin(x * freq * 1.8 + time * 2.1) * Math.cos(z * freq * 1.19 + time * 1.68) * 0.4;
        
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
        
        // Dispose default height texture
        if (this.uniforms.u_height_texture && this.uniforms.u_height_texture.value.dispose) {
            this.uniforms.u_height_texture.value.dispose();
        }
        
        if (this.gui) {
            this.gui.destroy();
        }
        
        console.log('WaterRenderer disposed');
    }
}
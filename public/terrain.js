import * as THREE from 'three';

const CONFIG = Object.freeze({
    TERRAIN: {
        chunkSize: 50,
        segments: 50  // Reduced for better performance and stability
    },
    GRAPHICS: {
        textureSize: 24,
        textureRepeat: 2
    }
});

class SimpleTerrainRenderer {
    constructor(scene) {
        this.scene = scene;
        this.terrainChunks = new Map();
        this.terrainMaterial = null;
        this.textures = this.initializeTextures();
        this.initialize();
    }

    initializeTextures() {
        const size = CONFIG.GRAPHICS.textureSize;
        const textures = {};
        textures.dirt = this.createProceduralTexture({ r: 101, g: 67, b: 33 }, { r: 139, g: 90, b: 43 }, size);
        textures.grass = this.createProceduralTexture({ r: 34, g: 139, b: 34 }, { r: 0, g: 100, b: 0 }, size);
        textures.rock = this.createProceduralTexture({ r: 105, g: 105, b: 105 }, { r: 128, g: 128, b: 128 }, size);
        textures.snow = this.createProceduralTexture({ r: 255, g: 250, b: 250 }, { r: 240, g: 248, b: 255 }, size);
        return textures;
    }

    createProceduralTexture(color1, color2, size) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(size, size);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            const noise = Math.random();
            const c = noise > 0.5 ? color1 : color2;
            data[i] = c.r; data[i + 1] = c.g; data[i + 2] = c.b; data[i + 3] = 255;
        }
        ctx.putImageData(imgData, 0, 0);
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(CONFIG.GRAPHICS.textureRepeat, CONFIG.GRAPHICS.textureRepeat);
        return tex;
    }

    initialize() {
        this.terrainMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vWorldPosition;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D uDirt;
                uniform sampler2D uGrass;
                uniform sampler2D uRock;
                uniform sampler2D uSnow;
                uniform vec3 uLightDir;
                varying vec3 vNormal;
                varying vec3 vWorldPosition;
                void main() {
                    float height = vWorldPosition.y;
                    float slope = 1.0 - abs(vNormal.y);
                    
                    vec2 texCoord = vWorldPosition.xz * 0.02;
                    vec3 dirtColor = texture2D(uDirt, texCoord).rgb;
                    vec3 grassColor = texture2D(uGrass, texCoord).rgb;
                    vec3 rockColor = texture2D(uRock, texCoord).rgb;
                    vec3 snowColor = texture2D(uSnow, texCoord).rgb;
                    
                    float dirtMix = smoothstep(-2.0, 1.0, -height);
                    float grassMix = smoothstep(-5.0, 8.0, height) * smoothstep(0.5, 0.0, slope);
                    float rockMix = smoothstep(0.3, 0.7, slope);
                    float snowMix = smoothstep(5.0, 10.0, height);
                    
                    float sum = dirtMix + grassMix + rockMix + snowMix + 0.001;
                    dirtMix /= sum; grassMix /= sum; rockMix /= sum; snowMix /= sum;
                    
                    vec3 color = dirtColor * dirtMix + grassColor * grassMix + rockColor * rockMix + snowColor * snowMix;
                    
                    float lightIntensity = max(dot(vNormal, normalize(uLightDir)), 0.0);
                    float light = lightIntensity * 0.6 + 0.4;
                    
                    gl_FragColor = vec4(color * light, 1.0);
                }
            `,
            uniforms: {
                uDirt: { value: this.textures.dirt },
                uGrass: { value: this.textures.grass },
                uRock: { value: this.textures.rock },
                uSnow: { value: this.textures.snow },
                uLightDir: { value: new THREE.Vector3(0.5, 1, 0.5).normalize() }
            },
            side: THREE.DoubleSide
        });
    }

    // Simple Perlin-like noise function (inline to avoid worker complexity)
    noise(x, z) {
        // Simple deterministic noise
        const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
        return (n - Math.floor(n)) * 2 - 1;
    }

    // Smooth noise with multiple octaves
    smoothNoise(x, z, octaves = 4) {
        let value = 0;
        let amplitude = 1;
        let frequency = 0.01;
        let maxValue = 0;
        
        for (let i = 0; i < octaves; i++) {
            const sampleX = x * frequency;
            const sampleZ = z * frequency;
            
            // Bilinear interpolation for smoother noise
            const x0 = Math.floor(sampleX);
            const x1 = x0 + 1;
            const z0 = Math.floor(sampleZ);
            const z1 = z0 + 1;
            
            const sx = sampleX - x0;
            const sz = sampleZ - z0;
            
            const n00 = this.noise(x0, z0);
            const n10 = this.noise(x1, z0);
            const n01 = this.noise(x0, z1);
            const n11 = this.noise(x1, z1);
            
            const nx0 = n00 * (1 - sx) + n10 * sx;
            const nx1 = n01 * (1 - sx) + n11 * sx;
            const nxz = nx0 * (1 - sz) + nx1 * sz;
            
            value += nxz * amplitude;
            maxValue += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }
        
        return value / maxValue;
    }

    addTerrainChunk(chunkId) {
        const coords = this.chunkIdToCoords(chunkId);
        const [chunkX, chunkZ] = coords;
        
        const chunkKey = `${chunkX},${chunkZ}`;
        if (this.terrainChunks.has(chunkKey)) {
            return; 
        }
        
        console.log(`Creating terrain chunk at (${chunkX}, ${chunkZ})`);
        
        // Create geometry
        const geometry = new THREE.PlaneGeometry(
            CONFIG.TERRAIN.chunkSize,
            CONFIG.TERRAIN.chunkSize,
            CONFIG.TERRAIN.segments,
            CONFIG.TERRAIN.segments
        );
        
        // Rotate to be horizontal
        geometry.rotateX(-Math.PI / 2);
        
        // Get vertex positions
        const positions = geometry.attributes.position.array;
        const vertexCount = positions.length / 3;
        
        console.log(`Processing ${vertexCount} vertices for chunk ${chunkId}`);
        
        // Generate heights for all vertices
        for (let i = 0; i < vertexCount; i++) {
            const vertexIndex = i * 3;
            
            // Get local vertex position (relative to chunk center)
            const localX = positions[vertexIndex];
            const localZ = positions[vertexIndex + 2];
            
            // Convert to world position
            const worldX = chunkX + localX;
            const worldZ = chunkZ + localZ;
            
            // Generate height using smooth noise
            const height = this.smoothNoise(worldX, worldZ, 3) * 8;
            
            // Set the Y coordinate (height)
            positions[vertexIndex + 1] = height;
        }
        
        // Update geometry
        geometry.attributes.position.needsUpdate = true;
        geometry.computeVertexNormals();
        
        // Create mesh
        const mesh = new THREE.Mesh(geometry, this.terrainMaterial);
        mesh.position.set(chunkX, 0, chunkZ);
        
        // Add to scene and store reference
        this.scene.add(mesh);
        this.terrainChunks.set(chunkKey, mesh);
        
        console.log(`Successfully added terrain chunk at (${chunkX}, ${chunkZ})`);
    }

    removeTerrainChunk(chunkId) {
        const coords = this.chunkIdToCoords(chunkId);
        const [chunkX, chunkZ] = coords;
        const chunkKey = `${chunkX},${chunkZ}`;
        
        const mesh = this.terrainChunks.get(chunkKey);
        if (mesh) {
            this.scene.remove(mesh);
            this.terrainChunks.delete(chunkKey);
            mesh.geometry.dispose();
            console.log(`Removed chunk: ${chunkId}`);
        }
    }
    
    chunkIdToCoords(chunkId) {
        const parts = chunkId.split('_');
        if (parts.length === 3 && parts[0] === 'chunk') {
            const x = parseInt(parts[1]) * CONFIG.TERRAIN.chunkSize;
            const z = parseInt(parts[2]) * CONFIG.TERRAIN.chunkSize;
            return [x, z];
        }
        // Fallback for 'chunkA'
        return [0, 0];
    }

    clearChunks() {
        this.terrainChunks.forEach((mesh) => {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
        });
        this.terrainChunks.clear();
        
        if (this.terrainMaterial) {
            this.terrainMaterial.dispose();
        }
    }
}

export { SimpleTerrainRenderer };
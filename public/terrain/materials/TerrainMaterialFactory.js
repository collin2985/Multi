// terrain/materials/TerrainMaterialFactory.js
import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class TerrainMaterialFactory {
    static createTerrainMaterial() {
        const vertexShader = `
            varying float vHeight;
            varying float vSlope;
            varying vec3 vNormal;
            varying vec2 vUv;
            
            void main() {
                vUv = uv;
                vHeight = position.y;
                vNormal = normal;
                vSlope = 1.0 - dot(normal, vec3(0, 1, 0));
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;

        const fragmentShader = `
            uniform vec3 uLightDir;
            uniform sampler2D uDirt;
            uniform sampler2D uGrass;
            uniform sampler2D uRock;
            uniform sampler2D uSnow;
            uniform sampler2D uSand;
            
            varying float vHeight;
            varying float vSlope;
            varying vec3 vNormal;
            varying vec2 vUv;
            
            void main() {
                float repeat = 12.0;
                vec3 dirt = texture2D(uDirt, vUv * repeat).rgb;
                vec3 grass = texture2D(uGrass, vUv * repeat).rgb;
                vec3 rock = texture2D(uRock, vUv * repeat).rgb;
                vec3 snow = texture2D(uSnow, vUv * repeat).rgb;
                vec3 sand = texture2D(uSand, vUv * repeat).rgb;
                
                float wDirt = 1.0 - smoothstep(-2.0, 1.0, vHeight);
                float wGrass = smoothstep(-2.0, 1.0, vHeight) * (1.0 - smoothstep(1.0, 7.5, vHeight));
                float wSnow = smoothstep(1.0, 7.5, vHeight);
                float wSand = smoothstep(-2.5, -1.5, vHeight) * (1.0 - smoothstep(-1.5, -0.5, vHeight));
                
                float slopeFactor = smoothstep(0.05, 0.2, vSlope);
                
                vec3 baseColor = dirt * wDirt + grass * wGrass + snow * wSnow + sand * wSand;
                baseColor = mix(baseColor, rock, slopeFactor);
                
                float dp = max(0.0, dot(normalize(vNormal), normalize(uLightDir)));
                baseColor *= (0.5 + dp * 0.5);
                
                gl_FragColor = vec4(baseColor, 1.0);
            }
        `;

        const material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                uDirt: { value: null },
                uGrass: { value: null },
                uRock: { value: null },
                uSnow: { value: null },
                uSand: { value: null },
                uLightDir: { value: new THREE.Vector3(1, 1, 1).normalize() }
            },
            side: THREE.FrontSide
        });

        return material;
    }

    static createProceduralTextures() {
        const size = CONFIG.GRAPHICS.textureSize;
        
        const createTexture = (color1, color2) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            const ctx = canvas.getContext('2d');
            const imgData = ctx.createImageData(size, size);
            const data = imgData.data;
            
            for (let i = 0; i < data.length; i += 4) {
                const noise = Math.random();
                const color = noise > 0.5 ? color1 : color2;
                data[i] = color.r;
                data[i + 1] = color.g;
                data[i + 2] = color.b;
                data[i + 3] = 255;
            }
            
            ctx.putImageData(imgData, 0, 0);
            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.minFilter = THREE.NearestFilter;
            texture.magFilter = THREE.NearestFilter;
            return texture;
        };

        return {
            dirt: createTexture({ r: 101, g: 67, b: 33 }, { r: 139, g: 90, b: 43 }),
            grass: createTexture({ r: 34, g: 139, b: 34 }, { r: 0, g: 100, b: 0 }),
            rock: createTexture({ r: 105, g: 105, b: 105 }, { r: 128, g: 128, b: 128 }),
            snow: createTexture({ r: 255, g: 250, b: 250 }, { r: 240, g: 248, b: 255 }),
            sand: createTexture({ r: 194, g: 178, b: 128 }, { r: 210, g: 180, b: 140 })
        };
    }
}